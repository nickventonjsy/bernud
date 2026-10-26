// "Goodnight Bernard": one command that settles the house for the night and gives a look at tomorrow.
// Each step is optional (settings stored in kv) and runs independently, so one failure doesn't stop the rest.
const DEFAULTS = { lights_off: true, tvs_off: true, music_pause: true, phone_dnd: true, pc_sleep: false };

const WEATHER_CODES = [[0, "clear"], [3, "cloudy"], [48, "foggy"], [57, "drizzly"], [67, "rainy"], [77, "snowy"], [82, "showery"], [99, "stormy"]];
const describe = (c) => (WEATHER_CODES.find(([max]) => c <= max) || [0, "mixed"])[1];

export function createRoutines({ kv, lights, smartthings, phone, pc, zw, events, fetchImpl = fetch, now = () => new Date() }) {
  const config = async () => { try { return { ...DEFAULTS, ...JSON.parse((await kv.get("goodnight_config")) || "{}") } } catch { return { ...DEFAULTS }; } };
  const londonDate = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);

  async function tomorrow() {
    const day = londonDate(new Date(now().getTime() + 864e5));
    const out = { date: day };
    try {
      const all = await events();
      out.events = all.filter((e) => String(e.start).slice(0, 10) === day || londonDate(new Date(e.start)) === day)
        .map((e) => ({ title: e.title, time: /T/.test(e.start) ? new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(e.start)) : "all day" }));
    } catch { out.events_error = "Calendar couldn't be read."; }
    try {
      const r = await fetchImpl("https://api.open-meteo.com/v1/forecast?latitude=49.19&longitude=-2.11&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max&timezone=Europe%2FLondon&forecast_days=2", { signal: AbortSignal.timeout(10_000) });
      const d = (await r.json()).daily;
      out.weather = { summary: describe(d.weather_code[1]), high_c: Math.round(d.temperature_2m_max[1]), low_c: Math.round(d.temperature_2m_min[1]), rain_chance_pct: d.precipitation_probability_max[1], wind_kmh: Math.round(d.wind_speed_10m_max[1]) };
    } catch { out.weather_error = "Weather couldn't be fetched."; }
    return out;
  }

  async function step(name, fn, done, failed) {
    try { const r = await fn(); if (r === null) return; done.push(r || name); } catch (e) { failed.push(`${name}: ${String(e.message || e).slice(0, 120)}`); }
  }

  async function goodnight(b = {}) {
    const cfg = { ...(await config()), ...(b.only ? Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, b.only.includes(k)])) : {}) };
    const done = [], failed = [];
    await Promise.all([
      cfg.lights_off && step("lights off", async () => {
        const r = await lights.control({ device: "all lights", action: "off" });
        if (!r.ok) throw new Error((r.failed || []).join("; ") || "no lights responded");
        return `lights off (${r.devices.length})`;
      }, done, failed),
      cfg.tvs_off && step("TVs off", async () => {
        if (!smartthings.configured() || !(await smartthings.connected().catch(() => false))) return null;
        const tvs = (await smartthings.list()).filter((d) => d.type === "tv");
        const off = [];
        for (const t of tvs) { try { await smartthings.control({ device: t.name, action: "off" }); off.push(t.name); } catch {} }
        return off.length ? `TVs off (${off.join(", ")})` : null;
      }, done, failed),
      cfg.music_pause && step("music paused", async () => {
        if (!zw.url || !zw.key) return null;
        const r = await fetchImpl(`${zw.url}/api/assistant/spotify/control`, { method: "POST", headers: { "x-zw-assistant": zw.key, "content-type": "application/json" }, body: JSON.stringify({ action: "pause" }), signal: AbortSignal.timeout(10_000) });
        const j = await r.json().catch(() => ({}));
        if (j.ok === false && !/no active|nothing|not playing|404/i.test(JSON.stringify(j))) throw new Error(j.error || j.message || "Spotify didn't pause");
        return "Spotify paused";
      }, done, failed),
      cfg.phone_dnd && step("phone Do Not Disturb", async () => {
        if (!phone.online()) throw new Error("the Bernard app on the phone isn't connected");
        const r = await phone.send("dnd", "on");
        if (!r.ok) throw new Error(r.message || r.output || "phone refused");
        return "phone on Do Not Disturb";
      }, done, failed),
      cfg.pc_sleep && step("PC asleep", async () => {
        if (!pc.online()) return null;
        // Give Bernard time to finish speaking before the PC sleeps.
        setTimeout(() => pc.send("power", "sleep").catch(() => {}), 20_000);
        return "PC going to sleep in 20 seconds";
      }, done, failed),
    ]);
    return { ok: true, done, failed: failed.length ? failed : undefined, tomorrow: await tomorrow() };
  }

  return {
    goodnight,
    async settings(b = {}) {
      const cfg = await config();
      if (b.action === "set") {
        for (const k of Object.keys(DEFAULTS)) if (typeof b[k] === "boolean") cfg[k] = b[k];
        await kv.set("goodnight_config", JSON.stringify(cfg));
      }
      return { ok: true, settings: cfg };
    },
  };
}
