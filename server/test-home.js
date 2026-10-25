import assert from "node:assert/strict";
import { createHome, sunTimes, isDark } from "./home.js";
// Jersey sunset on 25 Oct 2026 (GMT) is about 16:55 UTC.
const s = sunTimes(new Date("2026-10-25T12:00:00Z"));
assert.ok(Math.abs(s.sunset - new Date("2026-10-25T16:55:00Z")) < 10 * 60_000, "sunset " + s.sunset.toISOString());
assert.ok((s.sunset - s.sunrise) / 3600e3 > 9.6 && (s.sunset - s.sunrise) / 3600e3 < 10.4, "day length");
assert.equal(isDark(new Date("2026-10-25T13:00:00Z")), false);
assert.equal(isDark(new Date("2026-10-25T19:00:00Z")), true);

const store = new Map();
const kv = { get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); } };
const st = { calls: [], connected: async () => true, control: async (x) => { st.calls.push(x.device); return { ok: true }; } };
const said = [];
let t = new Date("2026-10-25T18:30:00Z");
const h = createHome({ kv, smartthings: st, sayOnPhone: async (x) => said.push(x), now: () => t,
  todayEvents: async () => [{ title: "Call Kerr", start: "2026-10-25T19:30:00Z" }, { title: "Old", start: "2026-10-25T09:00:00Z" }] });

let r = await h.arrive(); // first ever arrival counts
assert.equal(r.acted, true); assert.deepEqual(st.calls, ["hall", "front door"]);
assert.match(said[0], /Good evening, Nicholas\. Welcome home\. I've put the hall and front door lights on\. Still on today: Call Kerr at 7:30\s?pm/);
t = new Date("2026-10-25T18:35:00Z"); await h.leave();
t = new Date("2026-10-25T18:40:00Z"); r = await h.arrive(); // Wi-Fi blip
assert.equal(r.acted, false);
t = new Date("2026-10-25T19:00:00Z"); await h.leave();
t = new Date("2026-10-26T13:00:00Z"); r = await h.arrive(); // daytime: greet, no lights
assert.equal(r.acted, true); assert.deepEqual(r.lights_on, []); assert.match(said.at(-1), /Good afternoon/);
r = await h.settings({ action: "set", lights: ["Lamp"], greet: false, away_minutes: 30 });
assert.deepEqual(r.settings.lights, ["Lamp"]); assert.equal(r.settings.greet, false);
console.log("home tests passed");
