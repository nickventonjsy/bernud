// Imou cameras through the Imou Open Platform (open.imoulife.com): list cameras, get a live HLS stream, snapshots.
// Request signing as documented by Imou: md5("time:<t>,nonce:<n>,appSecret:<secret>").
import { createHash, randomBytes } from "node:crypto";

const START = "https://openapi.easy4ip.com/openapi";

export function createImou({ appId, appSecret, fetchImpl = fetch, log = console, now = () => Date.now() }) {
  let base = START, token = null, tokenUntil = 0, list = null, listAt = 0;

  async function raw(api, params, url = base) {
    const time = Math.round(now() / 1000), nonce = randomBytes(12).toString("hex");
    const sign = createHash("md5").update(`time:${time},nonce:${nonce},appSecret:${appSecret}`).digest("hex");
    const r = await fetchImpl(`${url}/${api}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ system: { ver: "1.0", sign, appId, time, nonce }, params, id: String(Math.floor(Math.random() * 1e6)) }),
      signal: AbortSignal.timeout(15_000),
    });
    const j = await r.json().catch(() => ({}));
    const res = j.result || {};
    if (!r.ok || res.code === undefined) throw Object.assign(new Error(`Imou ${api}: HTTP ${r.status}`), { code: "http" });
    if (String(res.code) !== "0") throw Object.assign(new Error(`${res.code}: ${res.msg || "Imou error"}`), { code: String(res.code) });
    return res.data || {};
  }

  async function auth(force = false) {
    if (!force && token && now() < tokenUntil) return token;
    const d = await raw("accessToken", {}, START);
    if (!d.accessToken) throw new Error("Imou didn't return an access token");
    token = d.accessToken;
    tokenUntil = now() + Math.max(60, (Number(d.expireTime) || 3600) - 300) * 1000;
    if (d.currentDomain) base = String(d.currentDomain).replace(/:443$/, "").replace(/\/+$/, "") + "/openapi";
    return token;
  }

  async function call(api, params = {}) {
    if (!appId || !appSecret) throw Object.assign(new Error("Imou isn't set up: IMOU_APP_ID and IMOU_APP_SECRET are missing on the server."), { code: "not_set_up" });
    await auth();
    try { return await raw(api, { ...params, token }); }
    catch (e) {
      if (e.code === "TK1002" || e.code === "TK1001") { await auth(true); return raw(api, { ...params, token }); }
      if (e.code === "OP1008" || e.code === "SN1001") e.message = "Imou rejected the App ID or App Secret. Check IMOU_APP_ID and IMOU_APP_SECRET in Render.";
      throw e;
    }
  }

  // Cameras on the Imou account: [{ id, name, channel, online }]
  async function cameras(force = false) {
    if (!force && list && now() - listAt < 10 * 60_000) return list;
    const base = await call("deviceBaseList", { bindId: -1, limit: 50, type: "bindAndShare", needApInfo: false });
    const ids = (base.deviceList || []).map((d) => d.deviceId).filter(Boolean);
    let details = [];
    if (ids.length) {
      try { details = (await call("deviceBaseDetailList", { deviceList: ids.map((deviceId) => ({ deviceId, channelList: "0" })) })).deviceList || []; }
      catch (e) { log.error?.("imou details", e.message); }
    }
    list = ids.map((id) => {
      const d = details.find((x) => x.deviceId === id) || {};
      const ch = (d.channels || [])[0] || ((base.deviceList || []).find((x) => x.deviceId === id)?.channels || [])[0] || {};
      const name = d.name || d.deviceName || ch.channelName || id;
      return { id, name: String(name).replace(new RegExp(`^${id}-?1?$`), id), channel: String(ch.channelId ?? "0"), online: (ch.status || d.status || "online") === "online" };
    });
    listAt = now();
    return list;
  }

  // Find a camera by spoken name ("front door", "garage"), or the only/first one.
  async function find(name = "") {
    const all = await cameras();
    if (!all.length) throw Object.assign(new Error("No cameras found on the Imou account."), { code: "no_cameras" });
    const q = String(name || "").toLowerCase().replace(/\b(the|my|camera|cam)\b/g, "").trim();
    if (!q) return all[0];
    const words = q.split(/\s+/);
    return all.find((c) => c.id.toLowerCase() === q) || all.find((c) => c.name.toLowerCase().includes(q)) ||
      all.find((c) => words.some((w) => w.length > 2 && c.name.toLowerCase().includes(w))) ||
      (all.length === 1 ? all[0] : null) || { ...all[0], guessed: true };
  }

  function pick(streams = [], streamId) {
    const https = streams.filter((s) => String(s.hls || "").startsWith("https://"));
    return https.find((s) => Number(s.streamId) === streamId && String(s.status) === "1") ||
      https.find((s) => Number(s.streamId) === streamId) || https[0] || streams.find((s) => s.hls) || null;
  }

  // Live HLS address for a camera (HD = main stream, SD = sub stream). Creates the live address if needed.
  async function stream(cam, quality = "HD") {
    const streamId = String(quality).toUpperCase() === "SD" ? 1 : 0;
    const p = { deviceId: cam.id, channelId: cam.channel || "0" };
    let info = null;
    try { info = await call("getLiveStreamInfo", p); } catch (e) { if (e.code !== "LV1002") throw e; }
    let s = pick(info?.streams, streamId);
    if (!s) {
      try { await call("bindDeviceLive", { ...p, streamId }); } catch (e) { if (e.code !== "LV1001") throw e; }
      info = await call("getLiveStreamInfo", p);
      s = pick(info?.streams, streamId);
    }
    if (!s?.hls) throw Object.assign(new Error("Imou didn't give a live stream address for that camera."), { code: "no_stream" });
    return { url: s.hls, quality: Number(s.streamId) === 1 ? "SD" : "HD" };
  }

  async function snapshot(cam) {
    const d = await call("setDeviceSnapEnhanced", { deviceId: cam.id, channelId: cam.channel || "0" });
    if (!d.url) throw new Error("Imou didn't return a snapshot.");
    return d.url;
  }

  return { configured: () => !!(appId && appSecret), cameras, find, stream, snapshot };
}

// Allowed hosts for the video relay (Imou / Lechange cloud only).
export const STREAM_HOST = /(^|\.)(lechange\.com|lechange\.cn|easy4ip\.com|easy4ipcloud\.com|imoulife\.com|imou\.com|aliyuncs\.com)$/i;

// Rewrites an HLS playlist so every segment/sub-playlist goes through our relay.
export function rewritePlaylist(text, playlistUrl, relay) {
  return String(text).split("\n").map((line) => {
    const t = line.trim();
    if (!t) return line;
    if (t.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (_, u) => `URI="${relay(new URL(u, playlistUrl).href)}"`);
    return relay(new URL(t, playlistUrl).href);
  }).join("\n");
}
