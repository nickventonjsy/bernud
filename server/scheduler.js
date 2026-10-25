// Scheduled CCP morning brief: at the set time on set days (Europe/London), start a
// text-only Bernard conversation, wait for him to save the written brief, then notify the phone.

const TZ = "Europe/London";
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function londonNow(d = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
  }).formatToParts(d).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour) % 24;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour, minute: Number(parts.minute), dow: DAY_NAMES.indexOf(parts.weekday) };
}

// days: "1-5" (Mon-Fri) or "0-6" or "1,3,5"; time: "09:00". Window: minutes after the set time still allowed to run (covers restarts).
export function isDue(now, { time = "09:00", days = "1-5", windowMin = 30 } = {}) {
  const [h, m] = time.split(":").map(Number);
  const set = new Set();
  for (const part of days.split(",")) {
    const [a, b] = part.split("-").map(Number);
    for (let i = a; i <= (Number.isFinite(b) ? b : a); i++) set.add(i);
  }
  if (!set.has(now.dow)) return false;
  const mins = now.hour * 60 + now.minute, start = h * 60 + m;
  return mins >= start && mins < start + windowMin;
}

// Pull the useful lines out of the saved markdown brief for a short notification.
export function notificationText(md) {
  const section = (name) => {
    const re = new RegExp(`^##\\s*(?:\\d+\\.\\s*)?${name}[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|$(?![\\s\\S]))`, "mi");
    const m = md.match(re);
    return m ? m[1].replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*/g, "").replace(/^\s*[-*]\s*/gm, "• ").trim() : "";
  };
  const first = section("Recommended first move");
  const pri = section("Top three priorities").split("\n").filter((l) => l.startsWith("•")).map((l) => l.split(/\.\s/)[0].replace(/\.$/, "")).slice(0, 3);
  let out = "";
  if (pri.length) out += "Priorities:\n" + pri.join("\n") + "\n\n";
  if (first) out += "First move: " + first.replace(/^•\s*/, "");
  return (out || md.slice(0, 300)).slice(0, 900);
}

// One text-only conversation with the ElevenLabs agent over its public WebSocket.
export function converse(agentId, text, { until, timeoutMs = 240_000, WS = globalThis.WebSocket, log = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WS(`wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${encodeURIComponent(agentId)}`);
    const said = [];
    let done = false, checker = null;
    const finish = (err) => {
      if (done) return; done = true;
      clearInterval(checker); clearTimeout(timer);
      try { ws.close(); } catch {}
      err ? reject(Object.assign(err, { said })) : resolve(said);
    };
    const timer = setTimeout(() => finish(new Error("timed out waiting for the brief")), timeoutMs);
    ws.addEventListener("open", () => ws.send(JSON.stringify({ type: "conversation_initiation_client_data", conversation_config_override: { conversation: { text_only: true } }, dynamic_variables: { greeting: "Good morning, Nicholas." } })));
    ws.addEventListener("message", (e) => {
      let m; try { m = JSON.parse(typeof e.data === "string" ? e.data : e.data.toString()); } catch { return; }
      if (m.type === "ping") ws.send(JSON.stringify({ type: "pong", event_id: m.ping_event?.event_id }));
      else if (m.type === "conversation_initiation_metadata") {
        ws.send(JSON.stringify({ type: "user_message", text }));
        checker = setInterval(async () => { try { if (await until()) finish(); } catch {} }, 3000);
      } else if (m.type === "agent_response") { const t = m.agent_response_event?.agent_response; if (t) { said.push(t); log("agent: " + t.slice(0, 200)); } }
    });
    ws.addEventListener("error", (e) => log("ws error " + (e?.message || "")));
    ws.addEventListener("close", async () => {
      if (done) return;
      // The save tool runs asynchronously; give it a moment before deciding.
      for (let i = 0; i < 5 && !done; i++) { await new Promise((r) => setTimeout(r, 3000)); try { if (await until()) return finish(); } catch {} }
      finish(new Error("conversation ended before the brief was saved"));
    });
  });
}

export const SCHEDULED_MESSAGE = "This is your scheduled 9am run. Give me my CCP morning brief. I'm not listening live, so save the full written brief as usual and keep the spoken part to one sentence.";

export function createScheduler({ kv, ccp, notify, agentId, config = {}, log = console.log, converseImpl = converse }) {
  const cfg = { time: config.time || "09:00", days: config.days || "1-5" };
  let running = false, last = null;

  async function runBrief(reason = "manual") {
    if (running) return { started: false, note: "A brief is already being prepared." };
    running = true;
    const started = Date.now();
    const saved = async () => { const b = await ccp.latestBrief(); return b && new Date(b.created_at).getTime() >= started - 1000 ? b : null; };
    let error = null;
    try { await converseImpl(agentId, SCHEDULED_MESSAGE, { until: async () => Boolean(await saved()), log }); }
    catch (e) { error = e; }
    const brief = await saved().catch(() => null);
    try {
      if (brief) await notify(notificationText(brief.text), { title: "CCP morning brief ready", tags: "briefcase", click: "https://bernud.onrender.com/?open=brief" });
      else await notify(`Bernard couldn't prepare this morning's CCP brief (${error ? error.message : "unknown reason"}). Ask him for it directly or check the dashboard.`, { title: "CCP brief failed", tags: "warning", priority: 4, click: "https://bernud.onrender.com/" });
    } catch (e) { log("notify failed: " + e.message); }
    last = { reason, at: new Date(started).toISOString(), ok: Boolean(brief), error: error && !brief ? error.message : null };
    await kv.set("brief_last_result", JSON.stringify(last)).catch(() => {});
    running = false;
    log(`scheduled brief (${reason}): ${brief ? "saved and notified" : "failed: " + (error && error.message)}`);
    return { started: true, ...last };
  }

  async function tick(now = londonNow()) {
    if (!isDue(now, cfg)) return false;
    // Atomic claim: only one run per day even across restarts.
    if (!(await kv.claim("brief_last_date", now.date))) return false;
    runBrief("scheduled");
    return true;
  }

  return {
    config: cfg,
    runBrief, tick,
    start() { const t = setInterval(() => tick().catch((e) => log("scheduler: " + e.message)), 30_000); t.unref?.(); tick().catch(() => {}); },
    async status() { return { schedule: `${cfg.time} Europe/London, days ${cfg.days} (1=Mon … 5=Fri)`, running, last_result: last || JSON.parse((await kv.get("brief_last_result")) || "null"), last_run_date: await kv.get("brief_last_date") }; },
  };
}
