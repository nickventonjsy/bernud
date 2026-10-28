import assert from "node:assert/strict";
import { createSmartThings } from "./smartthings.js";
const m = new Map(); const kv = { async get(k) { return m.get(k) ?? null; }, async set(k, v) { m.set(k, v); } };
const sent = [], sentBy = []; let rtCount = 0; let revoke = false;
const TV = { deviceId: "tv1", label: "Nick's S95BA 55 Tv", components: [{ id: "main", categories: [{ name: "Television" }], capabilities: ["switch", "audioVolume", "audioMute", "samsungvd.mediaInputSource", "custom.launchapp", "mediaPlayback", "samsungvd.remoteControl", "tvChannel", "healthCheck"].map((id) => ({ id })) }] };
const BULB = { deviceId: "b1", label: "Lounge lamp", components: [{ id: "main", categories: [{ name: "Light" }], capabilities: [{ id: "switch" }, { id: "switchLevel" }, { id: "colorControl" }, { id: "colorTemperature" }] }] };
const BULB2 = { deviceId: "b2", label: "hall", components: [{ id: "main", categories: [{ name: "Light" }], capabilities: [{ id: "switch" }, { id: "switchLevel" }] }] };
const fetchImpl = async (u, o = {}) => {
  const res = (j, ok = true, status = 200) => ({ ok, status, json: async () => j });
  if (u.endsWith("/oauth/token")) {
    assert.match(o.headers.authorization, /^Basic /);
    const p = new URLSearchParams(o.body);
    if (p.get("grant_type") === "refresh_token") { if (revoke) return res({ error: "invalid_grant" }, false, 400); rtCount++; return res({ access_token: "a" + rtCount, refresh_token: "r" + rtCount, expires_in: 86400 }); }
    assert.equal(p.get("redirect_uri"), "https://srv/smartthings/callback");
    return res({ access_token: "a0", refresh_token: "r0", expires_in: 86400 });
  }
  if (u.endsWith("/v1/devices")) return res({ items: [TV, BULB, BULB2] });
  if (u.endsWith("/status")) return res({ components: { main: { switch: { switch: { value: "on" } }, audioVolume: { volume: { value: 11 } }, audioMute: { mute: { value: "unmuted" } }, "samsungvd.mediaInputSource": { inputSource: { value: "HDMI1" }, supportedInputSourcesMap: { value: [{ id: "dtv", name: "TV" }, { id: "HDMI1", name: "PlayStation" }] } } } } });
  if (u.endsWith("/health")) return res({ state: "ONLINE" });
  if (u.endsWith("/commands")) { const c = JSON.parse(o.body).commands; sent.push(c[c.length - 1]); sentBy.push(u.split("/")[5]); return res({ results: [] }); }
  throw new Error("unexpected " + u);
};
const notes = [];
const st = createSmartThings({ kv, clientId: "cid", clientSecret: "sec", redirectUri: "https://srv/smartthings/callback", secret: "k", fetchImpl, log: () => {}, notify: async (t) => notes.push(t) });
assert.equal(await st.connected(), false);
const t = new URL(st.connectLink()).searchParams.get("t");
const auth = new URL(st.startUrl(t));
assert.equal(auth.origin + auth.pathname, "https://api.smartthings.com/oauth/authorize");
assert.equal(auth.searchParams.get("scope"), "r:devices:* x:devices:*");
assert.equal(st.startUrl(t), null, "one-time");
const fin = await st.finish(auth.searchParams.get("state"), "code");
assert.deepEqual(fin, { devices: 3, tvs: ["Nick's S95BA 55 Tv"] });
assert.ok(!m.get("st_refresh_token").includes("r0"), "encrypted");
const list = await st.list(); assert.equal(list.find((d) => d.id === "tv1").type, "tv"); assert.ok(!list[0].capabilities.includes("healthCheck"));
// default device = the only TV
assert.equal((await st.control({ action: "on" })).device, "Nick's S95BA 55 Tv"); assert.deepEqual(sent.at(-1), { component: "main", capability: "switch", command: "on", arguments: [] });
await st.control({ device: "s95", action: "volume", value: "25" }); assert.deepEqual(sent.at(-1).arguments, [25]);
await st.control({ device: "s95", action: "volume", value: "up" }); assert.equal(sent.at(-1).command, "volumeUp");
await st.control({ device: "s95", action: "input", value: "hdmi 2" }); assert.deepEqual(sent.at(-1), { component: "main", capability: "samsungvd.mediaInputSource", command: "setInputSource", arguments: ["HDMI2"] });
await st.control({ device: "s95", action: "app", value: "Netflix" }); assert.deepEqual(sent.at(-1).arguments, ["3201907018807", "Netflix"]);
await st.control({ device: "s95", action: "key", value: "home" }); assert.deepEqual(sent.at(-1).arguments, ["HOME"]);
await assert.rejects(st.control({ device: "s95", action: "key", value: "rm -rf" }), /Key must be/);
await assert.rejects(st.control({ device: "lamp", action: "volume", value: "10" }), /doesn't support/);
assert.equal(list.find((d) => d.id === "b1").type, "light");
await st.control({ device: "lounge lamp", action: "brightness", value: "30%" }); assert.deepEqual(sent.at(-1), { component: "main", capability: "switchLevel", command: "setLevel", arguments: [30] });
await st.control({ device: "lounge", action: "white", value: "warm" }); assert.deepEqual(sent.at(-1).arguments, [2700]);
await st.control({ device: "lounge", action: "colour", value: "blue" }); assert.deepEqual(sent.at(-1).arguments, [{ hue: 66, saturation: 100 }]);
await assert.rejects(st.control({ device: "lounge", action: "colour", value: "plaid" }), /Colour: one of/);
await assert.rejects(st.control({ device: "hall", action: "colour", value: "red" }), /doesn't support/);
sentBy.length = 0;
const all = await st.control({ device: "all lights", action: "off" });
assert.deepEqual(all.devices, ["Lounge lamp", "hall"]); assert.deepEqual(sentBy, ["b1", "b2"], "TV not touched by 'all lights'");
const allCol = await st.control({ device: "lights", action: "colour", value: "red" });
assert.deepEqual(allCol.devices, ["Lounge lamp"]); assert.equal(allCol.failed.length, 1);
await assert.rejects(st.control({ device: "kitchen", action: "on" }), /No SmartThings device called/);
const s = await st.control({ device: "s95", action: "status" });
assert.equal(s.device.power, "on"); assert.equal(s.device.volume, 11); assert.equal(s.device.input, "HDMI1"); assert.deepEqual(s.device.inputs_available, ["TV", "PlayStation"]); assert.equal(s.device.online, "ONLINE");
// Camera on the TV: the TV (already on) gets its web browser opened, without a wake-up wait.
sent.length = 0; sentBy.length = 0;
const ob = await st.openBrowser("the S95B TV", { wait: async () => {} });
assert.deepEqual(ob, { tv: "Nick's S95BA 55 Tv", woke: false }); assert.deepEqual(sentBy, ["tv1"]);
assert.deepEqual(sent[0], { component: "main", capability: "custom.launchapp", command: "launchApp", arguments: ["org.tizen.browser", "Internet"] });
// refresh rotates and stores the new token; revoked -> not connected + notify via keepalive path
await st.refresh(); assert.equal(rtCount, 1);
revoke = true; await assert.rejects(st.refresh(), /reconnect/); assert.equal(await st.connected(), false);
console.log("smartthings tests passed"); process.exit(0);
