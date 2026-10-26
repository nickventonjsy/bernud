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
  [/^\/youtube/, "YouTube"], [/^\/orders|^\/reorder/, "order list"], [/^\/home/, "home"], [/^\/shopping/, "shopping list"], [/^\/wakeup/, "wake-up"], [/^\/firetv/, "Fire TV"], [/^\/system/, null],
];
export const routeLabel = (path) => { const r = ROUTES.find(([re]) => re.test(path)); return r ? r[1] : undefined; };

export function createDayLog({ kv, now = () => new Date(), max = 300 } = {}) {
  let cache = null, saving = Promise.resolve();
  const load = async () => { if (cache) return cache; try { cache = JSON.parse((await kv.get("daylog")) || "[]"); } catch { cache = []; } return cache; };

  async function add(kind, text) {
    if (!text) return;
    const list = await load();
    const t = now(), cut = t.getTime() - 2 * 864e5;
    cache = [...list.filter((e) => e.t > cut), { t: t.getTime(), k: kind, x: String(text).replace(/\s+/g, " ").slice(0, 120) }].slice(-max);
    saving = saving.then(() => kv.set("daylog", JSON.stringify(cache))).catch(() => {});
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

  return { add, today, routeLabel };
}
