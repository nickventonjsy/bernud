// Reminders (one-off or repeating, Europe/London time) and crypto price alerts.
// Both are delivered as phone notifications through ntfy. Stored as JSON in the kv table.
import { randomUUID } from "node:crypto";

const TZ = "Europe/London";
const REPEATS = ["none", "daily", "weekdays", "weekly", "monthly"];

function parts(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short", hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second, wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) };
}

// "2026-10-27T16:00" (London wall-clock) -> Date (UTC instant). Handles BST/GMT.
export function londonToDate(local) {
  const m = String(local).trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] || "0"].map(Number);
  let guess = Date.UTC(y, mo - 1, d, h, mi, s);
  for (let i = 0; i < 3; i++) {
    const p = parts(new Date(guess));
    const diff = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Date.UTC(y, mo - 1, d, h, mi, s);
    if (!diff) break;
    guess -= diff;
  }
  return new Date(guess);
}

export function londonLabel(d) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

// Next occurrence after `from`, keeping the same London wall-clock time.
export function nextRepeat(due, repeat, from = new Date()) {
  const p = parts(due);
  const at = (y, mo, d) => londonToDate(`${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`);
  let y = p.y, mo = p.mo, d = p.d;
  for (let i = 0; i < 400; i++) {
    if (repeat === "monthly") { mo++; if (mo > 12) { mo = 1; y++; } }
    else { const n = new Date(Date.UTC(y, mo - 1, d + (repeat === "weekly" ? 7 : 1))); y = n.getUTCFullYear(); mo = n.getUTCMonth() + 1; d = n.getUTCDate(); }
    const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const cand = at(y, mo, repeat === "monthly" ? Math.min(p.d, lastDay) : d);
    const wd = parts(cand).wd;
    if (repeat === "weekdays" && (wd === 0 || wd === 6)) continue;
    if (cand > from) return cand;
  }
  return null;
}

export const COIN_IDS = { btc: "bitcoin", bitcoin: "bitcoin", eth: "ethereum", ethereum: "ethereum", sol: "solana", solana: "solana", xrp: "ripple", ripple: "ripple", doge: "dogecoin", dogecoin: "dogecoin", ada: "cardano", cardano: "cardano", bnb: "binancecoin", link: "chainlink", chainlink: "chainlink", avax: "avalanche-2", dot: "polkadot", ltc: "litecoin", sui: "sui", pepe: "pepe", shib: "shiba-inu" };

export function createReminders({ kv, notify, fetchImpl = fetch, now = () => new Date(), log = console.log }) {
  const load = async (k) => { try { return JSON.parse((await kv.get(k)) || "[]"); } catch { return []; } };
  const save = (k, v) => kv.set(k, JSON.stringify(v));
  let lastPrices = {};

  const view = (r) => ({ id: r.id.slice(0, 8), text: r.text, when: londonLabel(new Date(r.due)), repeat: r.repeat });
  const aview = (a) => ({ id: a.id.slice(0, 8), coin: a.coin, condition: `${a.direction} £${a.price.toLocaleString("en-GB")}`, last_price_gbp: lastPrices[a.coin] ?? null });
  const pick = (list, idOrText) => {
    const q = String(idOrText || "").toLowerCase().trim();
    if (!q) return null;
    return list.find((x) => x.id.startsWith(q)) || list.find((x) => (x.text || x.coin || "").toLowerCase().includes(q)) || null;
  };

  async function addReminder({ text, when, repeat = "none" }) {
    text = String(text || "").trim().slice(0, 300);
    if (!text) return { ok: false, error: "What should the reminder say?" };
    const due = londonToDate(when);
    if (!due) return { ok: false, error: "Give the time as YYYY-MM-DDTHH:MM in Jersey time." };
    repeat = REPEATS.includes(repeat) ? repeat : "none";
    if (due <= now() && repeat === "none") return { ok: false, error: `That time (${londonLabel(due)}) has already passed.` };
    let first = due;
    if (due <= now()) first = nextRepeat(due, repeat, now());
    const list = await load("reminders");
    if (list.length >= 200) return { ok: false, error: "Too many reminders saved; cancel some first." };
    const r = { id: randomUUID(), text, due: first.toISOString(), repeat, created: now().toISOString() };
    list.push(r); await save("reminders", list);
    return { ok: true, reminder: view(r) };
  }

  async function addAlert({ coin, direction, price }) {
    const id = COIN_IDS[String(coin || "").toLowerCase().trim()] || String(coin || "").toLowerCase().trim();
    const p = Number(String(price).replace(/[£,\s]/g, ""));
    if (!id) return { ok: false, error: "Which coin?" };
    if (!(p > 0)) return { ok: false, error: "Give the price in pounds." };
    const dir = /below|under|drop|fall|less/i.test(direction) ? "below" : "above";
    const r = await fetchImpl(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=gbp`, { signal: AbortSignal.timeout(10000) }).then((x) => x.json()).catch(() => ({}));
    const cur = r[id]?.gbp;
    if (cur === undefined) return { ok: false, error: `I couldn't find a live price for '${coin}'.` };
    lastPrices[id] = cur;
    if ((dir === "above" && cur >= p) || (dir === "below" && cur <= p)) return { ok: false, error: `It's already ${dir} that: currently £${cur.toLocaleString("en-GB")}.` };
    const list = await load("price_alerts");
    if (list.length >= 50) return { ok: false, error: "Too many alerts; cancel some first." };
    const a = { id: randomUUID(), coin: id, direction: dir, price: p, created: now().toISOString() };
    list.push(a); await save("price_alerts", list);
    return { ok: true, alert: aview(a), current_price_gbp: cur };
  }

  async function tickReminders() {
    const list = await load("reminders");
    if (!list.length) return 0;
    const t = now(); let fired = 0; const keep = [];
    for (const r of list) {
      if (new Date(r.due) > t) { keep.push(r); continue; }
      try { await notify(r.text, { title: "Reminder", tags: "alarm_clock", priority: 4 }); fired++; } catch (e) { log("reminder notify failed: " + e.message); keep.push(r); continue; }
      if (r.repeat !== "none") { const n = nextRepeat(new Date(r.due), r.repeat, t); if (n) keep.push({ ...r, due: n.toISOString() }); }
    }
    if (fired) await save("reminders", keep);
    return fired;
  }

  async function tickAlerts() {
    const list = await load("price_alerts");
    if (!list.length) return 0;
    const ids = [...new Set(list.map((a) => a.coin))].join(",");
    const r = await fetchImpl(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=gbp`, { signal: AbortSignal.timeout(10000) }).then((x) => x.json()).catch(() => null);
    if (!r) return 0;
    let fired = 0; const keep = [];
    for (const a of list) {
      const p = r[a.coin]?.gbp;
      if (p !== undefined) lastPrices[a.coin] = p;
      if (p !== undefined && ((a.direction === "above" && p >= a.price) || (a.direction === "below" && p <= a.price))) {
        try { await notify(`${a.coin} is now £${p.toLocaleString("en-GB")} (${a.direction} your £${a.price.toLocaleString("en-GB")} alert).`, { title: "Price alert", tags: a.direction === "above" ? "chart_with_upwards_trend" : "chart_with_downwards_trend", priority: 4 }); fired++; continue; }
        catch (e) { log("alert notify failed: " + e.message); }
      }
      keep.push(a);
    }
    if (fired) await save("price_alerts", keep);
    return fired;
  }

  return {
    async reminder({ action, text, when, repeat, id }) {
      if (action === "add") return addReminder({ text, when, repeat });
      const list = await load("reminders");
      if (action === "list") return { ok: true, count: list.length, reminders: list.sort((a, b) => a.due.localeCompare(b.due)).map(view) };
      if (action === "cancel") {
        const r = pick(list, id || text);
        if (!r) return { ok: false, error: "No reminder matches that." };
        await save("reminders", list.filter((x) => x !== r));
        return { ok: true, cancelled: view(r) };
      }
      return { ok: false, error: "action must be add, list or cancel" };
    },
    async alert({ action, coin, direction, price, id }) {
      if (action === "add") return addAlert({ coin, direction, price });
      const list = await load("price_alerts");
      if (action === "list") return { ok: true, count: list.length, alerts: list.map(aview) };
      if (action === "cancel") {
        const a = pick(list, id || coin);
        if (!a) return { ok: false, error: "No alert matches that." };
        await save("price_alerts", list.filter((x) => x !== a));
        return { ok: true, cancelled: aview(a) };
      }
      return { ok: false, error: "action must be add, list or cancel" };
    },
    tickReminders, tickAlerts,
    start() {
      const t1 = setInterval(() => tickReminders().catch((e) => log("reminders: " + e.message)), 20_000);
      const t2 = setInterval(() => tickAlerts().catch((e) => log("alerts: " + e.message)), 120_000);
      t1.unref?.(); t2.unref?.();
    },
  };
}
