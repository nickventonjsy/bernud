// Samsung SmartThings (TVs and other devices) for Bernard.
// OAuth-In app registered by Nicholas with the SmartThings CLI; he signs in once.
// Access tokens last 24h; refresh tokens 30 days and are renewed on every refresh,
// so the server refreshes daily to keep the connection alive. Tokens are stored encrypted.
import { randomBytes, createHash, createCipheriv, createDecipheriv } from "node:crypto";

const API = "https://api.smartthings.com";
export const ST_SCOPES = "r:devices:* x:devices:*";

export function createSmartThings({ kv, clientId, clientSecret, redirectUri, secret, fetchImpl = fetch, log = console.log, notify = async () => {} }) {
  const key = createHash("sha256").update("bernud-smartthings:" + (secret || "")).digest();
  const enc = (s) => { const iv = randomBytes(12); const c = createCipheriv("aes-256-gcm", key, iv); const d = Buffer.concat([c.update(s, "utf8"), c.final()]); return [iv, c.getAuthTag(), d].map((b) => b.toString("base64")).join("."); };
  const dec = (s) => { const [iv, tag, d] = s.split(".").map((x) => Buffer.from(x, "base64")); const c = createDecipheriv("aes-256-gcm", key, iv); c.setAuthTag(tag); return Buffer.concat([c.update(d), c.final()]).toString("utf8"); };
  const links = new Map(), states = new Map();
  const sweep = (m) => { const n = Date.now(); for (const [k, e] of m) if (e < n) m.delete(k); };
  let cached = null, refreshing = null;

  async function tokenRequest(params) {
    const r = await fetchImpl(API + "/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64") },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error_description || j.error || `SmartThings token ${r.status}`), { code: j.error });
    return j;
  }
  const getRT = async () => { const v = await kv.get("st_refresh_token"); return v ? dec(v) : null; };
  async function store(j) {
    if (j.refresh_token) { await kv.set("st_refresh_token", enc(j.refresh_token)); await kv.set("st_refreshed_at", new Date().toISOString()); }
    cached = { token: j.access_token, exp: Date.now() + (j.expires_in || 86400) * 1000 };
  }
  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const rt = await getRT();
      if (!rt) throw Object.assign(new Error("SmartThings isn't connected yet."), { code: "not_connected" });
      try { await store(await tokenRequest({ grant_type: "refresh_token", refresh_token: rt })); }
      catch (e) {
        if (e.code === "invalid_grant") { await kv.set("st_refresh_token", ""); throw Object.assign(new Error("SmartThings access expired or was removed. Nicholas needs to reconnect it."), { code: "not_connected" }); }
        throw e;
      }
      return cached.token;
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  async function token() { return cached && cached.exp > Date.now() + 120_000 ? cached.token : refresh(); }

  async function api(path, { method = "GET", body } = {}) {
    const r = await fetchImpl(API + path, { method, headers: { authorization: `Bearer ${await token()}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error?.message || j.message || `SmartThings ${r.status}`), { status: r.status, detail: j });
    return j;
  }

  const capsOf = (d) => new Set((d.components || []).flatMap((c) => (c.capabilities || []).map((x) => x.id)));
  const isTv = (d) => (d.components || []).some((c) => (c.categories || []).some((k) => /television|tv/i.test(k.name))) || /tv/i.test(d.ocf?.ocfDeviceType || "") || capsOf(d).has("samsungvd.mediaInputSource") || capsOf(d).has("tvChannel");
  const view = (d) => ({ id: d.deviceId, name: d.label || d.name, room: d.roomId || undefined, type: isTv(d) ? "tv" : (d.components?.[0]?.categories?.[0]?.name || "device"), capabilities: [...capsOf(d)].filter((c) => !/^(healthCheck|refresh|execute|ocf)$/.test(c)).slice(0, 25) });

  async function devices() { const j = await api("/v1/devices"); return (j.items || []); }
  async function find(nameOrId) {
    const all = await devices();
    const q = String(nameOrId || "").toLowerCase().trim();
    if (!q) { const tvs = all.filter(isTv); if (tvs.length === 1) return tvs[0]; throw new Error(tvs.length ? `Which TV? ${tvs.map((d) => d.label || d.name).join(", ")}` : "No TVs found in SmartThings."); }
    const hit = all.find((d) => d.deviceId === nameOrId) || all.find((d) => (d.label || d.name || "").toLowerCase() === q) || all.find((d) => (d.label || d.name || "").toLowerCase().includes(q));
    if (!hit) throw new Error(`No SmartThings device called '${nameOrId}'. Devices: ${all.map((d) => d.label || d.name).join(", ")}`);
    return hit;
  }
  const cmd = (capability, command, args = []) => ({ component: "main", capability, command, arguments: args });

  async function status(d) {
    const s = await api(`/v1/devices/${d.deviceId}/status`).catch(() => null);
    const m = s?.components?.main || {};
    const v = (cap, attr) => m[cap]?.[attr]?.value;
    return {
      name: d.label || d.name,
      power: v("switch", "switch") || null,
      volume: v("audioVolume", "volume") ?? null,
      muted: v("audioMute", "mute") === "muted" ? true : v("audioMute", "mute") === "unmuted" ? false : null,
      input: v("samsungvd.mediaInputSource", "inputSource") || v("mediaInputSource", "inputSource") || null,
      inputs_available: v("samsungvd.mediaInputSource", "supportedInputSourcesMap")?.map?.((x) => x.name || x.id) || v("mediaInputSource", "supportedInputSources") || undefined,
      channel: v("tvChannel", "tvChannel") || undefined,
      online: (await api(`/v1/devices/${d.deviceId}/health`).catch(() => null))?.state || undefined,
    };
  }

  async function control({ device, action, value }) {
    const d = await find(device);
    const caps = capsOf(d);
    const need = (c) => { if (!caps.has(c)) throw new Error(`${d.label || d.name} doesn't support that (no ${c}).`); };
    const val = String(value ?? "").trim();
    let commands;
    switch (action) {
      case "status": return { ok: true, device: await status(d) };
      case "on": need("switch"); commands = [cmd("switch", "on")]; break;
      case "off": need("switch"); commands = [cmd("switch", "off")]; break;
      case "volume": {
        need("audioVolume");
        if (/^\d+$/.test(val)) commands = [cmd("audioVolume", "setVolume", [Math.max(0, Math.min(100, Number(val)))])];
        else if (/up|louder/i.test(val)) commands = [cmd("audioVolume", "volumeUp")];
        else if (/down|quieter/i.test(val)) commands = [cmd("audioVolume", "volumeDown")];
        else throw new Error("Volume: a number 0-100, up or down.");
        break;
      }
      case "mute": need("audioMute"); commands = [cmd("audioMute", /^(off|false|unmute)$/i.test(val) ? "unmute" : "mute")]; break;
      case "input": {
        if (!val) throw new Error("Which input? e.g. HDMI1, HDMI2, TV.");
        const src = val.toUpperCase().replace(/\s+/g, "");
        if (caps.has("samsungvd.mediaInputSource")) commands = [cmd("samsungvd.mediaInputSource", "setInputSource", [src])];
        else { need("mediaInputSource"); commands = [cmd("mediaInputSource", "setInputSource", [src])]; }
        break;
      }
      case "app": {
        need("custom.launchapp");
        const APPS = { netflix: "3201907018807", youtube: "111299001912", "prime video": "3201910019365", "amazon prime": "3201910019365", "disney+": "3201901017640", disney: "3201901017640", spotify: "3201606009684", "apple tv": "3201807016597", "bbc iplayer": "3201602007865", iplayer: "3201602007865", itvx: "121299000089", "channel 4": "3201608010191", "now": "3201603008746", plex: "3201512006963", "internet": "org.tizen.browser", browser: "org.tizen.browser" };
        const id = APPS[val.toLowerCase()];
        commands = [cmd("custom.launchapp", "launchApp", id ? [id, val] : [val, val])];
        break;
      }
      case "channel": need("tvChannel"); commands = [cmd("tvChannel", /up/i.test(val) ? "channelUp" : /down/i.test(val) ? "channelDown" : "setTvChannel", /up|down/i.test(val) ? [] : [val])]; break;
      case "play": case "pause": case "stop": need("mediaPlayback"); commands = [cmd("mediaPlayback", action)]; break;
      case "key": {
        need("samsungvd.remoteControl");
        const k = val.toUpperCase();
        if (!/^(UP|DOWN|LEFT|RIGHT|OK|BACK|HOME|MENU|EXIT|PLAY|PAUSE|STOP|REWIND|FF|PLAY_BACK)$/.test(k)) throw new Error("Key must be one of UP, DOWN, LEFT, RIGHT, OK, BACK, HOME, MENU, EXIT, PLAY, PAUSE, STOP, REWIND, FF.");
        commands = [cmd("samsungvd.remoteControl", "send", [k])];
        break;
      }
      default: throw new Error("Unknown action.");
    }
    await api(`/v1/devices/${d.deviceId}/commands`, { method: "POST", body: { commands } });
    return { ok: true, device: d.label || d.name, done: action + (val ? " " + val : ""), note: action === "on" ? "If the TV doesn't wake, enable 'Power on with mobile' (Settings > General > Network > Expert Settings) so SmartThings can turn it on from standby." : undefined };
  }

  return {
    configured: () => Boolean(clientId && clientSecret && redirectUri),
    connected: async () => Boolean(await getRT().catch(() => null)),
    connectLink() { sweep(links); const t = randomBytes(18).toString("base64url"); links.set(t, Date.now() + 15 * 60_000); return redirectUri.replace(/\/smartthings\/callback$/, "") + "/smartthings/connect?t=" + t; },
    startUrl(t) {
      sweep(links); if (!links.has(t)) return null; links.delete(t);
      const state = randomBytes(18).toString("base64url"); states.set(state, Date.now() + 15 * 60_000);
      return API + "/oauth/authorize?" + new URLSearchParams({ client_id: clientId, response_type: "code", redirect_uri: redirectUri, scope: ST_SCOPES, state });
    },
    async finish(state, code) {
      sweep(states);
      if (!states.has(state)) throw new Error("This sign-in link has expired. Ask for a new one.");
      states.delete(state);
      const j = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri, scope: ST_SCOPES });
      if (!j.refresh_token) throw new Error("SmartThings didn't return a long-lived token.");
      await store(j);
      const all = await devices().catch(() => []);
      return { devices: all.length, tvs: all.filter(isTv).map((d) => d.label || d.name) };
    },
    async list() { const all = await devices(); return all.map(view); },
    control,
    refresh,
    // Keep the 30-day refresh token alive: refresh once a day.
    startKeepAlive() {
      const tick = async () => {
        try {
          if (!(await getRT())) return;
          const at = await kv.get("st_refreshed_at");
          if (!at || Date.now() - Date.parse(at) > 20 * 3600e3) { await refresh(); log("smartthings: token refreshed"); }
        } catch (e) {
          log("smartthings keep-alive: " + e.message);
          if (e.code === "not_connected") await notify("SmartThings access for your TVs has expired. Ask Bernud or Claude for a new SmartThings sign-in link.", { title: "Bernud: TVs need reconnecting", tags: "warning" }).catch(() => {});
        }
      };
      const t = setInterval(tick, 3600e3); t.unref?.(); setTimeout(tick, 30_000).unref?.();
    },
  };
}
