// "Arriving home": Tasker on Nicholas's phone tells the server when it joins / leaves the home Wi-Fi.
// On a real arrival (away long enough, not a Wi-Fi blip) Bernard switches on chosen lights if it's dark
// and greets him through the phone in his own voice.

const JERSEY = { lat: 49.19, lon: -2.11 };

// Sunrise / sunset (NOAA approximation, good to a couple of minutes). Returns Date objects (UTC).
export function sunTimes(date, { lat, lon } = JERSEY) {
  const rad = Math.PI / 180;
  const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const n = Math.round((day - Date.UTC(2000, 0, 1, 12)) / 864e5 + 0.0008);
  const Js = n - lon / 360;
  const M = (357.5291 + 0.98560028 * Js) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const L = (M + C + 180 + 102.9372) % 360;
  const Jt = 2451545 + Js + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * L * rad);
  const dec = Math.asin(Math.sin(L * rad) * Math.sin(23.44 * rad));
  const cosW = (Math.sin(-0.83 * rad) - Math.sin(lat * rad) * Math.sin(dec)) / (Math.cos(lat * rad) * Math.cos(dec));
  const w = Math.acos(Math.max(-1, Math.min(1, cosW))) / rad;
  const toDate = (j) => new Date((j - 2440587.5) * 864e5);
  return { sunrise: toDate(Jt - w / 360), sunset: toDate(Jt + w / 360) };
}

export function isDark(d = new Date(), marginMin = 30) {
  const { sunrise, sunset } = sunTimes(d);
  const m = marginMin * 60_000;
  return d < new Date(sunrise.getTime() + m) || d > new Date(sunset.getTime() - m);
}

const DEFAULTS = { enabled: true, lights: ["hall", "front door"], only_when_dark: true, greet: true, away_minutes: 20 };

export function createHome({ kv, smartthings, sayOnPhone, todayEvents = async () => [], now = () => new Date(), log = console.log }) {
  const load = async (k, d) => { try { return JSON.parse((await kv.get(k)) || "null") ?? d; } catch { return d; } };
  const config = async () => ({ ...DEFAULTS, ...(await load("home_config", {})) });

  function greeting(d) {
    const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hour12: false }).format(d)) % 24;
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  }

  async function arrive() {
    const cfg = await config();
    const t = now();
    const state = await load("home_state", {});
    const leftAt = state.left_at ? new Date(state.left_at) : null;
    const lastArrive = state.arrived_at ? new Date(state.arrived_at) : null;
    // Ignore Wi-Fi blips: only count it if he was away long enough, or (no leave seen) the last arrival was hours ago.
    const awayLongEnough = leftAt ? t - leftAt >= cfg.away_minutes * 60_000 && (!lastArrive || leftAt > lastArrive) : !lastArrive || t - lastArrive > 6 * 3600_000;
    await kv.set("home_state", JSON.stringify({ ...state, arrived_at: t.toISOString(), home: true }));
    if (!cfg.enabled) return { ok: true, acted: false, reason: "disabled" };
    if (!awayLongEnough) return { ok: true, acted: false, reason: "not away long enough" };

    const done = [];
    const dark = isDark(t);
    if (cfg.lights.length && (!cfg.only_when_dark || dark) && smartthings && (await smartthings.connected().catch(() => false))) {
      for (const name of cfg.lights) {
        try { const r = await smartthings.control({ device: name, action: "on" }); if (r && r.ok !== false) done.push(name); } catch (e) { log(`home: ${name}: ${e.message}`); }
      }
    }
    let spoken = null;
    if (cfg.greet) {
      const parts = [`${greeting(t)}, sir. Welcome home.`];
      if (done.length) parts.push(`I've put the ${done.length === 1 ? done[0] + " light" : done.slice(0, -1).join(", ") + " and " + done.at(-1) + " lights"} on.`);
      try {
        const ev = (await todayEvents()).filter((e) => new Date(e.start) > t).slice(0, 2);
        if (ev.length) parts.push(`Still on today: ${ev.map((e) => `${e.title} at ${new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(e.start))}`).join(", and ")}.`);
      } catch {}
      spoken = parts.join(" ");
      try { await sayOnPhone(spoken); } catch (e) { log("home greet: " + e.message); spoken = null; }
    }
    return { ok: true, acted: true, dark, lights_on: done, said: spoken };
  }

  async function leave() {
    const state = await load("home_state", {});
    await kv.set("home_state", JSON.stringify({ ...state, left_at: now().toISOString(), home: false }));
    return { ok: true };
  }

  return {
    arrive, leave, config,
    // Bernard's settings tool.
    async settings(b) {
      const cfg = await config();
      if (String(b.action || "status") === "set") {
        if (typeof b.enabled === "boolean") cfg.enabled = b.enabled;
        if (typeof b.greet === "boolean") cfg.greet = b.greet;
        if (typeof b.only_when_dark === "boolean") cfg.only_when_dark = b.only_when_dark;
        if (Array.isArray(b.lights)) cfg.lights = b.lights.map((x) => String(x).trim().slice(0, 40)).filter(Boolean).slice(0, 10);
        if (Number(b.away_minutes) >= 5 && Number(b.away_minutes) <= 600) cfg.away_minutes = Math.round(Number(b.away_minutes));
        await kv.set("home_config", JSON.stringify(cfg));
      }
      const state = await load("home_state", {});
      const { sunset } = sunTimes(now());
      return { ok: true, settings: cfg, home_now: state.home ?? null, last_arrived: state.arrived_at || null, last_left: state.left_at || null, sunset_today: new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" }).format(sunset) };
    },
  };
}
