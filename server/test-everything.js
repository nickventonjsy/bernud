import assert from "node:assert/strict";
import { createJarvis } from "./jarvis.js";
import { createSpeakers } from "./speakers.js";

const mem = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; };
const calls = [];
const j = createJarvis({ kv: mem(), notify: async () => true, sayOnPhone: async () => {}, pc: { online: () => false }, telegram: {}, brain: {}, speakMp3: async () => null,
  headlines: async () => [], dayLog: { add() {} }, voiceRequests: async () => [], saveMemory: async () => {}, eventsToday: async () => [], parcels: {}, dj: {},
  lights: { control: async (a) => { calls.push(`lights ${a.device} ${a.action}`); return { ok: true, devices: ["Lounge", "Hall"] }; } },
  tvOn: async (d) => calls.push(`tv ${d} on`), tvOff: async (d) => calls.push(`tv ${d} off`), mainTv: async () => "55" });

// "Turn everything on": all lights, and only the main TV (S95B).
let r = await j.everything({ action: "on" });
assert.equal(r.ok, true); assert.deepEqual(calls, ["lights all on", "tv 55 on"]); assert.deepEqual(r.done, ["lights on (2)", "the S95B TV on"]);
// A TV failure is reported, not hidden.
const j2 = createJarvis({ kv: mem(), notify: async () => true, sayOnPhone: async () => {}, pc: {}, telegram: {}, brain: {}, speakMp3: async () => null, headlines: async () => [], dayLog: { add() {} }, voiceRequests: async () => [], saveMemory: async () => {}, eventsToday: async () => [], parcels: {}, dj: {},
  lights: { control: async () => ({ ok: true, devices: ["Lounge"] }) }, tvOn: async () => { throw new Error("SmartThings isn't connected"); }, mainTv: async () => "55" });
r = await j2.everything({});
assert.equal(r.ok, true); assert.match(r.failed[0], /TV: SmartThings isn't connected/);

// Spotify on the TV: not listed until Spotify is opened on it, then it appears and plays.
let tvOpen = false; const opened = [];
const fetchImpl = async (url, o = {}) => {
  const json = (x) => ({ json: async () => x });
  if (url.includes("what=devices")) return json({ devices: tvOpen ? [{ id: "tv1", name: "[TV] Samsung S95B 55", type: "TV" }, { id: "ph", name: "Nick's S24 Ultra", type: "Smartphone" }] : [{ id: "ph", name: "Nick's S24 Ultra", type: "Smartphone" }] });
  if (url.includes("what=shortcuts")) return json({ shortcuts: [] });
  if (url.includes("what=search")) return json({ artists: [{ name: "Ella Langley", uri: "spotify:artist:ella" }], tracks: [] });
  if (url.includes("/control")) return json({ ok: true, sent: JSON.parse(o.body) });
  throw new Error(url);
};
const sp = createSpeakers({ zw: { url: "https://zw", key: "k" }, dj: {}, fetchImpl, sleep: async () => {}, wakeTv: async (d) => { opened.push(d); tvOpen = true; } });
r = await sp.playOn({ device: "TV", query: "Ella Langley" });
assert.equal(r.ok, true); assert.equal(r.device, "[TV] Samsung S95B 55"); assert.equal(r.playing, "Ella Langley"); assert.deepEqual(opened, ["TV"]);
console.log("everything on + Spotify on the TV ok");

// Light show: music mode on every Govee light that has it; festive cycle; stop back to warm white.
{
  const { createGovee } = await import("./govee.js");
  const sent = [];
  const devs = [{ sku: "H6008", device: "a", deviceName: "Lounge lamp", type: "devices.types.light", capabilities: [{ type: "devices.capabilities.on_off", instance: "powerSwitch" }, { type: "devices.capabilities.music_setting", instance: "musicMode", parameters: { fields: [{ fieldName: "musicMode", options: [{ name: "Spectrum", value: 3 }, { name: "Energic", value: 5 }] }] } }] },
    { sku: "H6001", device: "b", deviceName: "Hall bulb", type: "devices.types.light", capabilities: [{ type: "devices.capabilities.on_off", instance: "powerSwitch" }] }];
  const gv = createGovee({ apiKey: "k", fetchImpl: async (url, o) => { if (url.endsWith("/user/devices")) return { ok: true, json: async () => ({ code: 200, data: devs }) }; sent.push(JSON.parse(o.body).payload); return { ok: true, json: async () => ({ code: 200 }) }; } });
  const lc = [];
  const j3 = createJarvis({ govee: gv, kv: mem(), notify: async () => true, sayOnPhone: async () => {}, pc: {}, telegram: {}, brain: {}, speakMp3: async () => null, headlines: async () => [], dayLog: { add() {} }, voiceRequests: async () => [], saveMemory: async () => {}, eventsToday: async () => [], parcels: {}, dj: {},
    lights: { control: async (a) => { lc.push(`${a.action} ${a.value}`); return { ok: true }; } } });
  let r = await j3.lightShow({ action: "music" });
  assert.deepEqual(r.dancing, ["Lounge lamp"]); assert.match(r.cant[0], /Hall bulb/);
  assert.deepEqual(sent.at(-1).capability, { type: "devices.capabilities.music_setting", instance: "musicMode", value: { musicMode: 5, sensitivity: 100, autoColor: 1 } });
  r = await j3.lightShow({ action: "festive", minutes: 5 }); assert.equal(r.started, "festive");
  await new Promise((ok) => setTimeout(ok, 20)); assert.equal(lc[0], "colour red");
  r = await j3.lightShow({ action: "stop" }); assert.equal(r.stopped, true); assert.equal(lc.at(-1), "white warm");
  console.log("light show ok");
}
process.exit(0);
