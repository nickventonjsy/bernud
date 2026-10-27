// Bernard's week in review: sent on Sunday evening. Counts come from the day log (requests, tools, alerts),
// voice conversations from ElevenLabs, and credits from the ElevenLabs account.
const londonParts = (d) => Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(d).map((p) => [p.type, p.value]));
const weekId = (d) => { const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d); return "wk-" + day; };
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function summaryText({ log, voice = null, credits = null, creditsBefore = null, failed = [] }) {
  const lines = [];
  const spoken = voice?.conversations || 0, minutes = Math.round((voice?.seconds || 0) / 60);
  lines.push(`Requests: ${log.asked} typed or texted${voice ? `, ${plural(spoken, "voice conversation")} (about ${plural(minutes, "minute")})` : ""}.`);
  if (log.tools.length) lines.push("Most used: " + log.tools.slice(0, 5).map(([k, n]) => `${k} ×${n}`).join(", ") + ".");
  const briefs = log.tools.find(([k]) => k === "morning brief")?.[1] || 0;
  const reminders = log.alerts.find(([k]) => k === "Reminder")?.[1] || 0;
  const priceAlerts = log.alerts.find(([k]) => k === "Price alert")?.[1] || 0;
  lines.push(`Morning briefs: ${briefs}. Reminders fired: ${reminders}. Price alerts fired: ${priceAlerts}.`);
  const problems = log.alerts.filter(([k]) => /^Bernard: |failed/i.test(k) && !/back to normal/i.test(k));
  if (problems.length) lines.push("Problems flagged: " + problems.map(([k, n]) => `${k.replace(/^Bernard: /, "")} ×${n}`).join(", ") + ".");
  else lines.push("Problems flagged: none.");
  if (failed.length) lines.push("Still not right: " + failed.join(", ") + ".");
  if (credits?.ok) {
    let used = "";
    if (creditsBefore?.ok) { const diff = creditsBefore.left - credits.left; used = diff >= 0 ? ` Used this week: about ${diff.toLocaleString("en-GB")}.` : " They renewed this week."; }
    lines.push(`ElevenLabs credits left: ${credits.left.toLocaleString("en-GB")} (about ${credits.minutes_left} minutes of talking).${used}`);
  }
  return lines.join("\n");
}

export function createWeekly({ kv, dayLog, notify, credits = null, voiceWeek = null, failing = null, complete = null, now = () => new Date(), log = console.log, day = "Sun", hour = 19 }) {
  async function build() {
    const [logw, cr, voice, failed] = await Promise.all([
      dayLog.week(), credits ? credits().catch(() => null) : null, voiceWeek ? voiceWeek().catch(() => null) : null, failing ? failing().catch(() => []) : [],
    ]);
    let before = null; try { before = JSON.parse((await kv.get("weekly_credits")) || "null"); } catch {}
    const text = summaryText({ log: logw, voice, credits: cr, creditsBefore: before, failed });
    let verdict = "";
    if (complete) {
      try {
        verdict = String(await complete({
          system: "You are Bernard, Nicholas's dry, polished British butler. Given a week's statistics, write ONE sentence (max 30 words) of wry, warm verdict on the week, addressed to Nicholas. No lists, no numbers repeated, no quotes.",
          text, maxTokens: 80, temperature: 0.8, prefer: "groq",
        }) || "").trim().replace(/^["“]|["”]$/g, "");
      } catch {}
    }
    if (cr?.ok) await kv.set("weekly_credits", JSON.stringify(cr)).catch(() => {});
    return text + (verdict ? "\n\n" + verdict : "");
  }

  async function run(reason = "manual") {
    const text = await build();
    await notify(text, { title: "Bernard's week", tags: "calendar" });
    log(`weekly summary sent (${reason})`);
    return text;
  }

  async function tick() {
    const d = now(), p = londonParts(d);
    if (p.weekday !== day || Number(p.hour) !== hour) return false;
    if (!(await kv.claim("weekly_last", weekId(d)))) return false;
    await run("scheduled");
    return true;
  }

  return {
    build, run, tick,
    start() { const t = setInterval(() => tick().catch((e) => log("weekly: " + e.message)), 5 * 60_000); t.unref?.(); },
  };
}
