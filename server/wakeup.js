// Morning wake-up: lights come up gently, then music, then Bernard says good morning with the weather and first appointment.
const DEFAULTS = { enabled: false, time: "07:00", days: "1-5", lights: "all lights", ramp_min: 10, music: "none", music_what: "", mood: "a gentle, happy start to the morning", announce: true };
const WEATHER = [[0, "clear skies"], [3, "cloud"], [48, "fog"], [57, "drizzle"], [67, "rain"], [77, "snow"], [82, "showers"], [99, "storms"]];

export function dayList(spec) {
  const s = String(spec || "").toLowerCase().trim();
  if (/^(daily|every ?day|1-7|all)$/.test(s)) return [1, 2, 3, 4, 5, 6, 7];
  if (/^(weekdays?|1-5|mon-fri)$/.test(s)) return [1, 2, 3, 4, 5];
  if (/^(weekends?|6-7|6,7|sat-sun)$/.test(s)) return [6, 7];
  const names = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const out = new Set();
  for (const part of s.split(/[ ,]+/)) {
    const r = part.match(/^(\d)-(\d)$/); if (r) { for (let d = +r[1]; d <= +r[2]; d++) out.add(d); continue; }
    if (/^\d$/.test(part)) out.add(+part);
    const i = names.findIndex((n) => part.startsWith(n)); if (i >= 0) out.add(i + 1);
  }
  return [...out].sort();
}
export function normTime(t) {
  const m = String(t || "").trim().toLowerCase().match(/^(\d{1,2})(?:[:.]?(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = +m[1]; const min = +(m[2] || 0);
  if (m[3] === "pm" && h < 12) h += 12; if (m[3] === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function createWakeup({ kv, lights, speakers, sayOnPhone, todayEvents, fetchImpl = fetch, now = () => new Date(), log = console.log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const config = async () => { try { return { ...DEFAULTS, ...JSON.parse((await kv.get("wakeup_config")) || "{}") }; } catch { return { ...DEFAULTS }; } };
  const london = (d) => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", hour: "2-digit", minute: "2-digit", year: "numeric", month: "2-digit", day: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value])); return { day: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday) + 1, hm: `${p.hour}:${p.minute}`, date: `${p.year}-${p.month}-${p.day}` }; };
  const minus = (hm, mins) => { let [h, m] = hm.split(":").map(Number); let t = (h * 60 + m - mins + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
  let running = false;

  async function greeting(cfg) {
    const parts = ["Good morning, Nicholas."];
    const t = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", minute: "2-digit", hour12: true }).format(now());
    parts.push(`It's ${t}.`);
    try {
      const r = await fetchImpl("https://api.open-meteo.com/v1/forecast?latitude=49.19&longitude=-2.11&daily=weather_code,temperature_2m_max,precipitation_probability_max&current=temperature_2m&timezone=Europe%2FLondon&forecast_days=1", { signal: AbortSignal.timeout(8000) });
      const j = await r.json(); const d = j.daily;
      const w = (WEATHER.find(([max]) => d.weather_code[0] <= max) || [0, "mixed weather"])[1];
      parts.push(`It's ${Math.round(j.current.temperature_2m)} degrees out, with ${w} today and a high of ${Math.round(d.temperature_2m_max[0])}${d.precipitation_probability_max[0] >= 40 ? `, and a ${d.precipitation_probability_max[0]} percent chance of rain` : ""}.`);
    } catch {}
    try {
      const day = london(now()).date;
      const ev = (await todayEvents()).filter((e) => String(e.start).slice(0, 10) === day || london(new Date(e.start)).date === day);
      const timed = ev.filter((e) => /T/.test(e.start));
      if (timed.length) { const e = timed[0]; parts.push(`First up today: ${e.title} at ${new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(e.start))}${ev.length > 1 ? `, and ${ev.length - 1} more after that` : ""}.`); }
      else if (ev.length) parts.push(`Today you've got ${ev[0].title}.`);
      else parts.push("Nothing in the calendar today.");
    } catch {}
    return parts.join(" ");
  }

  // The routine itself. test: true runs it now with a quick (one minute) light ramp.
  async function run({ test = false } = {}) {
    if (running) return { ok: false, message: "The wake-up routine is already running." };
    running = true;
    const cfg = await config(), done = [], failed = [];
    try {
      const steps = [5, 20, 40, 60, 80, 100], gap = ((test ? 1 : cfg.ramp_min) * 60_000) / steps.length;
      if (cfg.lights && cfg.lights !== "none") {
        for (let i = 0; i < steps.length; i++) {
          try { await lights.control({ device: cfg.lights, action: i === 0 ? "on" : "brightness", value: i === 0 ? "" : String(steps[i]) }); if (i === 0) await lights.control({ device: cfg.lights, action: "brightness", value: String(steps[0]) }); }
          catch (e) { if (i === 0) failed.push("lights: " + String(e.message).slice(0, 80)); }
          if (i < steps.length - 1) await sleep(gap);
        }
        done.push(`lights up (${cfg.lights})`);
      }
      if (cfg.music && cfg.music !== "none") {
        const device = cfg.music === "echo" ? "michelle's echo" : cfg.music;
        try {
          const r = await speakers.playOn(cfg.music_what ? { device, query: cfg.music_what } : { device, mood: cfg.mood });
          if (r.ok === false) failed.push("music: " + (r.message || r.error)); else done.push(`music on ${r.device}`);
        } catch (e) { failed.push("music: " + String(e.message).slice(0, 80)); }
      }
      if (cfg.announce) { const text = await greeting(cfg); try { await sayOnPhone(text); done.push("good-morning message on the phone"); } catch (e) { failed.push("announcement: " + e.message); } return { ok: true, done, failed: failed.length ? failed : undefined, said: text }; }
      return { ok: true, done, failed: failed.length ? failed : undefined };
    } finally { running = false; }
  }

  async function tick() {
    const cfg = await config();
    if (!cfg.enabled) return;
    const n = london(now());
    if (!dayList(cfg.days).includes(n.day)) return;
    if (n.hm !== minus(cfg.time, cfg.ramp_min)) return;
    if ((await kv.get("wakeup_last")) === n.date) return;
    await kv.set("wakeup_last", n.date);
    log("wake-up: starting");
    run().then((r) => log("wake-up: " + JSON.stringify(r).slice(0, 300))).catch((e) => log("wake-up failed: " + e.message));
  }

  async function handle(b = {}) {
    const cfg = await config();
    if (b.action === "set") {
      if (b.time !== undefined) { const t = normTime(b.time); if (!t) return { ok: false, message: "I didn't understand that time. Try something like 6:45 or 7am." }; cfg.time = t; if (b.enabled === undefined) cfg.enabled = true; }
      if (b.days !== undefined) { if (!dayList(b.days).length) return { ok: false, message: "Which days? Weekdays, every day, weekends, or named days." }; cfg.days = String(b.days); }
      for (const k of ["enabled", "announce"]) if (typeof b[k] === "boolean") cfg[k] = b[k];
      for (const k of ["lights", "music", "music_what", "mood"]) if (typeof b[k] === "string") cfg[k] = b[k].trim();
      if (b.ramp_min !== undefined) cfg.ramp_min = Math.min(30, Math.max(0, Math.round(Number(b.ramp_min) || 0)));
      await kv.set("wakeup_config", JSON.stringify(cfg));
      return { ok: true, settings: cfg, summary: describe(cfg) };
    }
    if (b.action === "test") { run({ test: true }).catch(() => {}); return { ok: true, started: true, note: "Running the wake-up routine now, with a one-minute light ramp." }; }
    return { ok: true, settings: cfg, summary: describe(cfg) };
  }
  const describe = (c) => !c.enabled ? "Wake-up is off." : `Wake-up at ${c.time} on ${c.days === "1-5" ? "weekdays" : c.days === "1-7" ? "every day" : c.days}: ${c.lights !== "none" ? `${c.lights} fade up over ${c.ramp_min} minutes before` : "no lights"}, ${c.music !== "none" ? `then music on ${c.music === "echo" ? "Michelle's Echo" : c.music}` : "no music"}${c.announce ? ", then a good-morning message on the phone" : ""}.`;

  let timer = null;
  function start() { if (!timer) timer = setInterval(() => tick().catch((e) => log("wake-up tick: " + e.message)), 30_000); }
  return { handle, run, tick, start, config };
}
