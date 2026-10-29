// Scheduled Telegram round-ups and reminders, each sent once a day at most (Europe/London):
//   wrapup   weekdays 17:30  emails needing a reply, open priorities, tomorrow's calendar, parcels on the way
//   spend    Sundays 18:00   the week's receipts against the week before
//   cameras  daily 08:00     who/what the cameras saw overnight
//   payroll  payroll day (default the 25th) plus the Combined Employer Return / ITIS / Social Security deadline
//            (15 days after the month ends, per gov.je), reminded on the 10th and on the 15th
//   diary    daily 22:30     Bernud writes up the day from what was asked, saves it to memory (category diary) and sends it
//   news_audio daily 07:30   a spoken news bulletin in Bernard's voice, sent to Telegram as audio
//   bins     19:00 the evening before collection (Thursdays in St Brelade, so Wednesday evening), with that week's St Brelade recycling box
// Settings live in kv "digests"; each can be switched off.
import { londonNow, isDue } from "./scheduler.js";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DEFAULTS = { wrapup: true, wrapup_time: "17:30", spend: true, cameras: true, payroll: true, payroll_day: 25, bins: true, bin_day: 4, diary: true, news_audio: true, news_time: "07:30" };

// St Brelade 2026 planner: blue (paper) every other week, red (plastic) and black (metals) alternating between.
// Week starting Mon 2 Nov 2026 is blue, 9 Nov red, 16 Nov blue, 23 Nov black. The pattern is carried on after that.
const BOXES = [["blue box", "paper and card"], ["red box", "plastic bottles"], ["blue box", "paper and card"], ["black box", "metal packaging"]];
export function recyclingFor(dateStr) {
  const d = Date.parse(dateStr + "T12:00:00Z");
  const monday = d - ((new Date(d).getUTCDay() + 6) % 7) * 864e5;
  const wk = Math.round((monday - Date.parse("2026-11-02T12:00:00Z")) / (7 * 864e5));
  const [box, what] = BOXES[((wk % 4) + 4) % 4];
  return { box, what };
}

const dowOf = (date) => new Date(date + "T12:00:00Z").getUTCDay();
const addDays = (date, n) => new Date(Date.parse(date + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
// A date in this month, moved back to the Friday if it lands on a weekend.
export function workingDay(ym, day) {
  const last = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
  let d = `${ym}-${String(Math.min(day, last)).padStart(2, "0")}`;
  while ([0, 6].includes(dowOf(d))) d = addDays(d, -1);
  return d;
}
const gbp = (n) => "£" + Number(n || 0).toFixed(2);

export function createDigests({ kv, notify, needsReply, priorities, events, parcels, receipts, camEvents, diary = null, newsAudio = null, now = () => new Date(), log = console }) {
  async function settings() { try { return { ...DEFAULTS, ...JSON.parse((await kv.get("digests")) || "{}") }; } catch { return { ...DEFAULTS }; } }
  async function ran() { try { return JSON.parse((await kv.get("digests_ran")) || "{}"); } catch { return {}; } }

  const safe = async (f, d) => { try { return await f(); } catch (e) { log.error?.("digest part", e.message); return d; } };

  async function wrapup() {
    const t = londonNow(now());
    const tomorrow = addDays(t.date, 1);
    const [mail, pri, cal, par] = await Promise.all([
      safe(needsReply, null), safe(priorities, null), safe(() => events(tomorrow), null), safe(() => parcels.lines(), null),
    ]);
    const out = [];
    if (mail) out.push(mail.length ? `📧 ${mail.length} email${mail.length === 1 ? "" : "s"} waiting for a reply:\n` + mail.slice(0, 6).map((m) => `• ${m.from.replace(/<.*>/, "").trim()}: ${m.subject}`).join("\n") : "📧 No emails waiting for a reply.");
    if (pri) { const open = pri.filter((i) => !i.done); out.push(open.length ? `✅ Still open:\n` + open.map((i) => "• " + i.text).join("\n") : "✅ All priorities done."); }
    if (cal) out.push(cal.length ? `📅 ${DAYS[dowOf(tomorrow)]}:\n` + cal.slice(0, 8).map((e) => `• ${e.all_day ? "All day" : String(e.start).slice(11, 16)} ${e.title}`).join("\n") : `📅 Nothing in the calendar for ${DAYS[dowOf(tomorrow)]}.`);
    if (par && par.length) out.push("📦 On the way:\n" + par.slice(0, 6).map((l) => "• " + l).join("\n"));
    return { title: "End of the day", text: out.join("\n\n") || "Nothing to report." };
  }

  async function spend() {
    const w = await receipts.week();
    if (!w.receipts && !w.previous_total) return { title: "This week's spending", text: "No receipts this week. Send photos of receipts to Bernard on Telegram and they'll be counted." };
    const diff = Math.round((w.total - w.previous_total) * 100) / 100;
    const vs = w.previous_total ? ` (${diff >= 0 ? gbp(diff) + " more" : gbp(-diff) + " less"} than last week)` : "";
    const shops = w.shops.slice(0, 6).map((s) => `• ${s.shop}: ${gbp(s.total)}${s.visits > 1 ? ` (${s.visits} visits)` : ""}`).join("\n");
    return { title: "This week's spending", text: `${gbp(w.total)} across ${w.receipts} receipt${w.receipts === 1 ? "" : "s"}${vs}.\n${shops}\n\n${w.month.month_name} so far: ${gbp(w.month.total)}.` };
  }

  async function cameras() {
    const r = await camEvents({ hours: 14 });
    const s = (r.summary || []).filter((c) => c.kinds.person || c.kinds.vehicle || c.kinds.doorbell);
    if (!s.length) return { title: "Overnight cameras", text: "A quiet night: no people or vehicles on the cameras." };
    return { title: "Overnight cameras", text: s.map((c) => `• ${c.camera}: ${[c.kinds.person && `${c.kinds.person} person`, c.kinds.vehicle && `${c.kinds.vehicle} vehicle`, c.kinds.doorbell && `${c.kinds.doorbell} doorbell`].filter(Boolean).join(", ")} (${c.first === c.last ? c.first : `${c.first} to ${c.last}`})`).join("\n") };
  }

  function payrollFor(t, cfg) {
    const ym = t.date.slice(0, 7);
    if (t.date === workingDay(ym, cfg.payroll_day)) return { title: "Payroll day", text: `It's payroll day at Cory Car Paints${t.date.slice(8) !== String(cfg.payroll_day).padStart(2, "0") ? ` (the ${cfg.payroll_day}th is at the weekend)` : ""}.` };
    if (t.date === workingDay(ym, 10)) return { title: "Payroll deadline coming", text: "Last month's Combined Employer Return, ITIS and Social Security payments are due on the 15th." };
    if (t.date === workingDay(ym, 15)) return { title: "Payroll deadline today", text: "Last month's Combined Employer Return, ITIS and Social Security payments are due today (15 days after the month ended)." };
    return null;
  }

  function binsFor(t, cfg) {
    if (cfg.bin_day == null) return null;
    const tomorrow = addDays(t.date, 1);
    if (dowOf(tomorrow) !== Number(cfg.bin_day)) return null;
    const r = recyclingFor(tomorrow);
    return { title: "Bins tonight", text: `Rubbish goes out tonight, plus the ${r.box} (${r.what}).` };
  }

  const JOBS = {
    wrapup: { when: (c) => ({ time: c.wrapup_time, days: "1-5" }), make: () => wrapup() },
    spend: { when: () => ({ time: "18:00", days: "0" }), make: () => spend() },
    cameras: { when: () => ({ time: "08:00", days: "0-6" }), make: () => cameras() },
    payroll: { when: () => ({ time: "09:00", days: "1-5" }), make: (c, t) => payrollFor(t, c) },
    bins: { when: () => ({ time: "19:00", days: "0-6" }), make: (c, t) => binsFor(t, c) },
    diary: { when: () => ({ time: "22:30", days: "0-6" }), make: async () => { const e = diary ? await diary() : null; return e ? { title: "📔 Today's diary", text: e.replace(/^Diary [\d-]+:\s*/, "") } : null; } },
    // Sends itself (as audio), so nothing comes back to send as text.
    news_audio: { when: (c) => ({ time: c.news_time, days: "0-6" }), make: async () => { if (newsAudio) await newsAudio(); return null; } },
  };

  async function tick() {
    const cfg = await settings(), t = londonNow(now()), done = await ran();
    let sent = 0;
    for (const [name, job] of Object.entries(JOBS)) {
      if (!cfg[name] || done[name] === t.date) continue;
      if (!isDue(t, { ...job.when(cfg), windowMin: 60 })) continue;
      done[name] = t.date; await kv.set("digests_ran", JSON.stringify(done));
      try { const m = await job.make(cfg, t); if (m) { await notify(m.text, { title: m.title, tags: "memo" }); sent++; } }
      catch (e) { log.error?.("digest", name, e.message); }
    }
    return sent;
  }

  async function handle(b = {}) {
    const action = b.action || "status";
    if (action === "set") {
      const cur = JSON.parse((await kv.get("digests")) || "{}");
      for (const k of ["wrapup", "spend", "cameras", "payroll", "bins", "diary", "news_audio"]) if (typeof b[k] === "boolean") cur[k] = b[k];
      if (/^\d{1,2}:\d{2}$/.test(String(b.wrapup_time || ""))) cur.wrapup_time = String(b.wrapup_time).padStart(5, "0");
      if (/^\d{1,2}:\d{2}$/.test(String(b.news_time || ""))) cur.news_time = String(b.news_time).padStart(5, "0");
      if (Number(b.payroll_day) >= 1 && Number(b.payroll_day) <= 31) cur.payroll_day = Number(b.payroll_day);
      if (b.bin_day != null) {
        const i = typeof b.bin_day === "number" ? b.bin_day : DAYS.findIndex((d) => d.toLowerCase().startsWith(String(b.bin_day).toLowerCase().slice(0, 3)));
        if (i < 0 || i > 6) return { ok: false, error: "Which weekday are the bins collected?" };
        cur.bin_day = i; if (typeof b.bins !== "boolean") cur.bins = true;
      }
      await kv.set("digests", JSON.stringify(cur));
    }
    if (action === "run" || action === "preview") {
      const job = JOBS[b.which];
      if (b.which === "news_audio" && action === "preview") return { ok: true, which: b.which, message: "That one is audio only: use run to send it." };
      if (!job) return { ok: false, error: "Which one: wrapup, spend, cameras, payroll, bins, diary or news_audio?" };
      const m = await job.make(await settings(), londonNow(now()));
      if (!m) return { ok: true, which: b.which, message: b.which === "news_audio" ? (action === "run" ? "The spoken news has been sent to his Telegram." : "That one is audio only: use run to send it.") : "Nothing due today for that one." };
      if (action === "run") await notify(m.text, { title: m.title, tags: "memo" });
      return { ok: true, which: b.which, sent: action === "run", ...m };
    }
    const c = await settings(), t = londonNow(now());
    const next = c.bin_day != null ? recyclingFor(addDays(t.date, ((Number(c.bin_day) - t.dow + 7) % 7) || 7)) : null;
    return { ok: true, wrapup: c.wrapup ? `on, weekdays ${c.wrapup_time}` : "off", spend: c.spend ? "on, Sundays 18:00" : "off", cameras: c.cameras ? "on, daily 08:00" : "off",
      payroll: c.payroll ? `on, payroll day the ${c.payroll_day}th; deadline reminders on the 10th and 15th` : "off",
      diary: c.diary ? "on, written 22:30 each night and sent to Telegram" : "off",
      news_audio: c.news_audio ? `on, spoken news to Telegram daily ${c.news_time}` : "off",
      bins: c.bin_day == null ? "not set up (which day are the bins collected?)" : `${c.bins ? "on" : "off"}, collected ${DAYS[c.bin_day]}s, reminder 19:00 the night before; next recycling: ${next.box} (${next.what})` };
  }

  let timer = null;
  return { tick, handle, settings, wrapup, spend, cameras, start() { if (timer) return; timer = setInterval(() => tick().catch((e) => log.error?.("digests", e.message)), 5 * 60_000); timer.unref?.(); setTimeout(() => tick().catch(() => {}), 30_000).unref?.(); } };
}
