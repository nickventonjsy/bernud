// A light record of what Nicholas asked Bernard to do today, for Bernard's verdict on the day at goodnight.
// Kept in kv for two days only.
const londonDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);
const londonTime = (d) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" }).format(d);

// Friendly names for the tool routes Bernard's voice agent calls.
const ROUTES = [
  [/^\/lights/, "lights"], [/^\/tv$/, "lights or TV"], [/^\/smartthings/, "TV"], [/^\/spotify|^\/music/, "music"], [/^\/weather/, "weather"],
  [/^\/news/, "news"], [/^\/crypto|^\/prices|^\/zentrawire|^\/price-alert/, "markets"], [/^\/reminder/, "reminders"],
  [/^\/calendar/, "calendar"], [/^\/gmail/, "email"], [/^\/ccp\/document/, "printing"], [/^\/ccp\/brief/, "morning brief"],
  [/^\/ccp/, "CCP documents"], [/^\/web/, "web search"], [/^\/device\/pc|^\/pc/, "PC"], [/^\/device\/phone|^\/phone/, "phone"],
  [/^\/camera/, "cameras"], [/^\/memory/, "memory"], [/^\/notify/, "sent to phone"], [/^\/routine\/goodnight/, null],
  [/^\/priorities/, "priorities"], [/^\/youtube/, "YouTube"], [/^\/orders|^\/reorder/, "order list"], [/^\/home/, "home"], [/^\/shopping/, "shopping list"], [/^\/wakeup/, "wake-up"], [/^\/firetv/, "Fire TV"], [/^\/system/, null],
];
export const routeLabel = (path) => { const r = ROUTES.find(([re]) => re.test(path)); return r ? r[1] : undefined; };

export function createDayLog({ kv, now = () => new Date(), max = 300 } = {}) {
  let cache = null, saving = Promise.resolve();
  const load = async () => { if (cache) return cache; try { cache = JSON.parse((await kv.get("daylog")) || "[]"); } catch { cache = []; } return cache; };

  // Per-day counts kept for 10 days, for the weekly summary: { "2026-10-27": { asked: 12, tool: { lights: 3 }, alert: { Reminder: 2 } } }
  let weekCache = null;
  const loadWeek = async () => { if (weekCache) return weekCache; try { weekCache = JSON.parse((await kv.get("weeklog")) || "{}"); } catch { weekCache = {}; } return weekCache; };

  // via: where it came from (voice, dashboard, phone, telegram) for the activity feed.
  async function add(kind, text, via = "") {
    if (!text) return;
    const list = await load();
    const t = now(), cut = t.getTime() - 2 * 864e5;
    cache = [...list.filter((e) => e.t > cut), { t: t.getTime(), k: kind, x: String(text).replace(/\s+/g, " ").slice(0, 120), ...(via ? { v: via } : {}) }].slice(-max);
    saving = saving.then(() => kv.set("daylog", JSON.stringify(cache))).catch(() => {});
    const w = await loadWeek(), day = londonDay(t), d = (w[day] ||= { asked: 0, tool: {}, alert: {} });
    if (kind === "asked") d.asked++;
    else if (kind === "tool" || kind === "alert") { const key = String(text).slice(0, 60); d[kind][key] = (d[kind][key] || 0) + 1; }
    for (const k of Object.keys(w)) if (Date.parse(k) < t.getTime() - 10 * 864e5) delete w[k];
    saving = saving.then(() => kv.set("weeklog", JSON.stringify(w))).catch(() => {});
  }

  // The last seven days added up: { days: 7, asked, tools: [[label, n]…] (most used first), alerts: [[title, n]…] }
  async function week() {
    const w = await loadWeek(), t = now().getTime();
    const out = { days: 0, asked: 0, tools: {}, alerts: {} };
    for (const [day, d] of Object.entries(w)) {
      if (Date.parse(day) < t - 7 * 864e5 || Date.parse(day) > t) continue;
      out.days++; out.asked += d.asked || 0;
      for (const [k, n] of Object.entries(d.tool || {})) out.tools[k] = (out.tools[k] || 0) + n;
      for (const [k, n] of Object.entries(d.alert || {})) out.alerts[k] = (out.alerts[k] || 0) + n;
    }
    const sorted = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);
    return { days: out.days, asked: out.asked, tools: sorted(out.tools), alerts: sorted(out.alerts) };
  }

  // Today's entries as short lines: "09:14 asked: turn the lights on", plus a count of tools used.
  async function today() {
    const day = londonDay(now());
    const list = (await load()).filter((e) => londonDay(new Date(e.t)) === day);
    const asked = list.filter((e) => e.k === "asked").map((e) => `${londonTime(new Date(e.t))} ${e.x}`);
    const used = {};
    for (const e of list.filter((e) => e.k === "tool")) used[e.x] = (used[e.x] || 0) + 1;
    return { asked: asked.slice(-40), used };
  }

  // The last few things that happened, newest first, for the dashboard's activity feed.
  async function recent(n = 10) {
    const list = await load();
    return list.slice(-n).reverse().map((e) => ({ t: e.t, time: londonTime(new Date(e.t)), kind: e.k, text: e.x, via: e.v || "" }));
  }
  return { add, today, week, recent, routeLabel };
}
