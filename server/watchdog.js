// Watchdog: checks each part of Bernard every hour and messages Nicholas only when something breaks or recovers.
// A check must fail twice in a row before it alerts (one blip isn't worth a notification).
export function createWatchdog({ kv, notify, checks, now = () => new Date(), log = console.log, everyMs = 60 * 60_000 }) {
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("took too long")), ms))]);

  async function runChecks() {
    const out = [];
    for (const c of checks) {
      let r;
      try { r = await withTimeout(c.run(), 20_000); } catch (e) { r = { ok: false, detail: String(e.message || e).slice(0, 160) }; }
      if (r && r.skip) continue;
      if (Array.isArray(r)) for (const x of r) out.push({ name: x.name, alert: c.alert !== false, ok: !!x.ok, detail: x.detail || "" });
      else out.push({ name: c.name, alert: c.alert !== false, ok: !!r?.ok, detail: r?.detail || "" });
    }
    return out;
  }

  async function sweep() {
    const results = await runChecks();
    let prev = {}; try { prev = JSON.parse((await kv.get("watchdog_state")) || "{}"); } catch {}
    const next = {}, broke = [], fixed = [];
    for (const r of results) {
      const p = prev[r.name] || { fails: 0, alerted: false };
      const fails = r.ok ? 0 : p.fails + 1;
      let alerted = p.alerted;
      if (r.alert && !r.ok && fails >= 2 && !p.alerted) { broke.push(r); alerted = true; }
      if (r.ok && p.alerted) { fixed.push(r); alerted = false; }
      next[r.name] = { fails, alerted, ok: r.ok, detail: r.detail, at: now().toISOString() };
    }
    await kv.set("watchdog_state", JSON.stringify(next)).catch(() => {});
    if (broke.length) await notify(broke.map((r) => `• ${r.name}: ${r.detail || "not working"}`).join("\n") + "\n\nAsk Bernard \"is everything working?\" for a full check.", { title: `Bernard: ${broke.length === 1 ? broke[0].name + " isn't working" : broke.length + " things aren't working"}`, tags: "warning", priority: 4 }).catch((e) => log("watchdog notify: " + e.message));
    if (fixed.length) await notify(fixed.map((r) => `• ${r.name}`).join("\n"), { title: "Bernard: back to normal", tags: "white_check_mark" }).catch(() => {});
    log(`watchdog: ${results.filter((r) => r.ok).length}/${results.length} ok${broke.length ? ", alerted " + broke.map((r) => r.name).join(", ") : ""}`);
    return { results, broke, fixed };
  }

  // A fresh check for "is everything working?"
  async function status() {
    const results = await runChecks();
    const bad = results.filter((r) => !r.ok);
    return { ok: true, all_ok: !bad.length, working: results.filter((r) => r.ok).map((r) => r.name), not_working: bad.map((r) => ({ name: r.name, problem: r.detail })) };
  }

  let timer = null;
  function start() { if (timer) return; setTimeout(() => sweep().catch((e) => log("watchdog: " + e.message)), 5 * 60_000); timer = setInterval(() => sweep().catch((e) => log("watchdog: " + e.message)), everyMs); }
  return { start, sweep, status };
}
