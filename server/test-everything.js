import assert from "node:assert/strict";
import { createJarvis } from "./jarvis.js";
import { createSpeakers } from "./speakers.js";

const mem = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; };
const calls = [];
const j = createJarvis({ kv: mem(), notify: async () => true, sayOnPhone: async () => {}, pc: { online: () => false }, telegram: {}, brain: {}, speakMp3: async () => null,
  headlines: async () => [], dayLog: { add() {} }, voiceRequests: async () => [], saveMemory: async () => {}, imou: {}, eventsToday: async () => [], parcels: {}, dj: {},
  lights: { control: async (a) => { calls.push(`lights ${a.device} ${a.action}`); return { ok: true, devices: ["Lounge", "Hall"] }; } },
  tvOn: async (d) => calls.push(`tv ${d} on`), tvOff: async (d) => calls.push(`tv ${d} off`), mainTv: async () => "55" });

// "Turn everything on": all lights, and only the main TV (S95B).
let r = await j.everything({ action: "on" });
assert.equal(r.ok, true); assert.deepEqual(calls, ["lights all on", "tv 55 on"]); assert.deepEqual(r.done, ["lights on (2)", "the S95B TV on"]);
// A TV failure is reported, not hidden.
const j2 = createJarvis({ kv: mem(), notify: async () => true, sayOnPhone: async () => {}, pc: {}, telegram: {}, brain: {}, speakMp3: async () => null, headlines: async () => [], dayLog: { add() {} }, voiceRequests: async () => [], saveMemory: async () => {}, imou: {}, eventsToday: async () => [], parcels: {}, dj: {},
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
process.exit(0);
