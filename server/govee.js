// Govee lights via the Govee Open API (personal API key from the Govee Home app).
// Same actions as the SmartThings lights: on, off, brightness, white, colour, status.
import { randomUUID } from "node:crypto";

const API = "https://openapi.api.govee.com/router/api/v1";
const RGB = { red: [255, 0, 0], orange: [255, 110, 0], amber: [255, 150, 0], yellow: [255, 220, 0], gold: [255, 180, 40], green: [0, 255, 0], lime: [150, 255, 0], teal: [0, 180, 160], cyan: [0, 255, 255], blue: [0, 60, 255], "light blue": [120, 180, 255], purple: [140, 0, 255], violet: [170, 60, 255], magenta: [255, 0, 200], pink: [255, 100, 160] };
const WHITES = { candle: 2200, "very warm": 2200, warm: 2700, "warm white": 2700, soft: 3000, "soft white": 3000, neutral: 4000, "neutral white": 4000, cool: 5000, "cool white": 5000, daylight: 6500, bright: 6500, white: 4000 };
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

export function createGovee({ apiKey, fetchImpl = fetch, cacheMs = 10 * 60_000 }) {
  let cache = null, cachedAt = 0;

  async function api(path, body) {
    const r = await fetchImpl(API + path, {
      method: body ? "POST" : "GET",
      headers: { "Govee-API-Key": apiKey, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(12_000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || (j.code !== undefined && j.code !== 200)) throw new Error(`Govee: ${j.message || j.msg || r.status}`);
    return j;
  }

  async function devices(force = false) {
    if (!force && cache && Date.now() - cachedAt < cacheMs) return cache;
    const j = await api("/user/devices");
    cache = (j.data || []).filter((d) => /light/i.test(d.type || "") || (d.capabilities || []).some((c) => c.instance === "powerSwitch"));
    cachedAt = Date.now();
    return cache;
  }

  const capOf = (d, instance) => (d.capabilities || []).find((c) => c.instance === instance);
  const name = (d) => d.deviceName || d.sku;

  async function match(q) {
    const all = await devices();
    const n = norm(q);
    if (!n) return null;
    return all.find((d) => norm(name(d)) === n) || all.find((d) => norm(name(d)).includes(n) || n.includes(norm(name(d)))) || null;
  }

  async function send(d, instance, value) {
    const cap = capOf(d, instance);
    if (!cap) throw new Error(`${name(d)} can't do that.`);
    await api("/device/control", { requestId: randomUUID(), payload: { sku: d.sku, device: d.device, capability: { type: cap.type, instance, value } } });
  }

  async function status(d) {
    const j = await api("/device/state", { requestId: randomUUID(), payload: { sku: d.sku, device: d.device } });
    const caps = j.payload?.capabilities || [];
    const v = (inst) => caps.find((c) => c.instance === inst)?.state?.value;
    const rgb = v("colorRgb");
    return {
      name: name(d), type: "light", source: "govee",
      online: v("online") !== false,
      power: v("powerSwitch") === 1 ? "on" : v("powerSwitch") === 0 ? "off" : undefined,
      brightness: v("brightness"),
      white_kelvin: v("colorTemperatureK") || undefined,
      colour_rgb: typeof rgb === "number" && rgb > 0 ? [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255] : undefined,
    };
  }

  async function act(d, action, val) {
    switch (action) {
      case "on": return send(d, "powerSwitch", 1);
      case "off": return send(d, "powerSwitch", 0);
      case "brightness": {
        let n;
        if (/^\d+%?$/.test(val)) n = Number(val.replace("%", ""));
        else if (/up|brighter|down|dimmer|dim/i.test(val)) n = ((await status(d)).brightness ?? 50) + (/up|brighter/i.test(val) ? 20 : -20);
        else if (/full|max/i.test(val)) n = 100;
        else if (/low|min/i.test(val)) n = 10;
        else throw new Error("Brightness: a number 1-100, up, down, full or low.");
        await send(d, "powerSwitch", 1);
        return send(d, "brightness", Math.max(1, Math.min(100, Math.round(n))));
      }
      case "white": {
        const k = /^\d{4}k?$/i.test(val) ? Number(val.replace(/k/i, "")) : WHITES[val.toLowerCase()];
        if (!k) throw new Error("White: warm, soft, neutral, cool, daylight or a number of kelvin.");
        const r = capOf(d, "colorTemperatureK")?.parameters?.range || { min: 2000, max: 9000 };
        await send(d, "powerSwitch", 1);
        return send(d, "colorTemperatureK", Math.max(r.min, Math.min(r.max, k)));
      }
      case "colour": case "color": {
        const c = val.toLowerCase();
        if (c === "white") return act(d, "white", "neutral");
        const rgb = RGB[c];
        if (!rgb) throw new Error(`Colour: one of ${Object.keys(RGB).join(", ")}, white.`);
        await send(d, "powerSwitch", 1);
        return send(d, "colorRgb", (rgb[0] << 16) + (rgb[1] << 8) + rgb[2]);
      }
      default: throw new Error("Unknown action.");
    }
  }

  return {
    configured: () => Boolean(apiKey),
    devices,
    match,
    async list() { return (await devices()).map((d) => ({ id: d.device, name: name(d), type: "light", source: "govee", model: d.sku })); },
    async control(d, { action, value }) {
      const val = String(value ?? "").trim();
      if (action === "status") return { ok: true, device: await status(d) };
      await act(d, action, val);
      return { ok: true, device: name(d), done: action + (val ? " " + val : "") };
    },
    async controlAll({ action, value }) {
      const done = [], failed = [];
      for (const d of await devices()) {
        try { await act(d, action, String(value ?? "").trim()); done.push(name(d)); } catch (e) { failed.push(`${name(d)}: ${String(e.message).slice(0, 80)}`); }
      }
      return { done, failed };
    },
  };
}

// One front door for every light and TV: Govee lights by name, everything else through SmartThings.
const ALL_LIGHTS = /^(all|all lights|all the lights|every light|everything|lights|the lights)$/i;
export function createLights({ smartthings, govee }) {
  const stOn = async () => smartthings && smartthings.configured() && (await smartthings.connected().catch(() => false));
  return {
    async connected() { return (await stOn()) || govee.configured(); },
    async list() {
      const out = [];
      if (await stOn()) out.push(...(await smartthings.list()));
      if (govee.configured()) { try { out.push(...(await govee.list())); } catch (e) { out.push({ name: "Govee", error: String(e.message).slice(0, 120) }); } }
      return out;
    },
    async control({ device, action, value }) {
      if (ALL_LIGHTS.test(String(device || "").trim()) && action !== "status") {
        const devices = [], failed = [];
        if (await stOn()) { try { const r = await smartthings.control({ device, action, value }); devices.push(...(r.devices || [])); if (r.failed) failed.push(...r.failed); } catch (e) { failed.push(String(e.message).slice(0, 100)); } }
        if (govee.configured()) { const r = await govee.controlAll({ action, value }); devices.push(...r.done); failed.push(...r.failed); }
        return { ok: devices.length > 0, devices, failed: failed.length ? failed : undefined, done: action + (value ? " " + value : "") };
      }
      if (govee.configured()) {
        const g = await govee.match(device).catch(() => null);
        if (g) return govee.control(g, { action, value });
      }
      if (!(await stOn())) throw Object.assign(new Error("SmartThings isn't connected, and no Govee light matches that name."), { code: "not_connected" });
      return smartthings.control({ device, action, value });
    },
  };
}
