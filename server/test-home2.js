// Shopping list, watchdog and wake-up.
import assert from "node:assert/strict";
import { createShopping, parseItems, aisleOf } from "./shopping.js";
import { createWatchdog } from "./watchdog.js";
import { createWakeup, dayList, normTime } from "./wakeup.js";
const mkKv = () => { const m = new Map(); return { get: async (k) => m.get(k), set: async (k, v) => m.set(k, v) }; };

// Shopping
assert.deepEqual(parseItems("milk, bread and two tins of beans"), ["milk", "bread", "two tins of beans"]);
assert.equal(aisleOf("semi-skimmed milk"), "Dairy & eggs"); assert.equal(aisleOf("bin bags"), "Household"); assert.equal(aisleOf("widgets"), "Other");
const sent = [];
const shop = createShopping({ kv: mkKv(), notify: async (b, o) => sent.push([b, o]) });
let r = await shop.handle({ action: "add", items: "milk, bread and bin bags" }); assert.deepEqual(r.added, ["milk", "bread", "bin bags"]); assert.equal(r.count, 3);
r = await shop.handle({ action: "add", items: "Milk and eggs" }); assert.deepEqual(r.added, ["eggs"]); assert.deepEqual(r.already, ["Milk"]);
r = await shop.handle({ action: "remove", items: "bread" }); assert.deepEqual(r.removed, ["bread"]); assert.equal(r.count, 3);
r = await shop.handle({ action: "send" }); assert.equal(r.sent, true);
assert.match(sent[0][0], /^Dairy & eggs:\n• milk\n• eggs\n\nHousehold:\n• bin bags$/); assert.equal(sent[0][1].title, "Shopping list (3)");
r = await shop.handle({ action: "list" }); assert.deepEqual(r.items, ["milk", "bin bags", "eggs"]);

// Watchdog: alert only after two failures in a row, and again when fixed
let gmailOk = true; const notes = [];
const wd = createWatchdog({ kv: mkKv(), notify: async (b, o) => notes.push(o.title), log: () => {}, checks: [
  { name: "Gmail", run: async () => ({ ok: gmailOk, detail: gmailOk ? "" : "disconnected" }) },
  { name: "PC", alert: false, run: async () => ({ ok: false, detail: "asleep" }) },
  { name: "Cameras", run: async () => [{ name: "Camera: Shop", ok: true }] },
] });
await wd.sweep(); assert.equal(notes.length, 0);
gmailOk = false; await wd.sweep(); assert.equal(notes.length, 0);
await wd.sweep(); assert.deepEqual(notes, ["Bernard: Gmail isn't working"]);
await wd.sweep(); assert.equal(notes.length, 1);
gmailOk = true; await wd.sweep(); assert.deepEqual(notes.at(-1), "Bernard: back to normal");
const st = await wd.status(); assert.equal(st.all_ok, false); assert.deepEqual(st.not_working, [{ name: "PC", problem: "asleep" }]);

// Wake-up
assert.deepEqual(dayList("weekdays"), [1, 2, 3, 4, 5]); assert.deepEqual(dayList("mon, wed"), [1, 3]); assert.deepEqual(dayList("1-7"), [1, 2, 3, 4, 5, 6, 7]);
assert.equal(normTime("6:45"), "06:45"); assert.equal(normTime("7am"), "07:00"); assert.equal(normTime("6.30pm"), "18:30"); assert.equal(normTime("25:00"), null);
const calls = []; let clock = new Date("2026-10-27T06:35:00Z"); // Tue 06:35 London (GMT)
const wk = createWakeup({ kv: mkKv(), now: () => clock, log: () => {}, sleep: async () => {},
  lights: { control: async (b) => calls.push(["light", b.action, b.value]) },
  speakers: { playOn: async (b) => (calls.push(["music", b.device, b.mood || b.query]), { ok: true, device: "Michelle's Echo Dot" }) },
  sayOnPhone: async (t) => calls.push(["say", t]),
  todayEvents: async () => [{ title: "Paint rep", start: "2026-10-27T10:00:00Z" }],
  fetchImpl: async () => ({ json: async () => ({ current: { temperature_2m: 9.6 }, daily: { weather_code: [61], temperature_2m_max: [13.2], precipitation_probability_max: [70] } }) }) });
let s = await wk.handle({ action: "set", time: "6:45", days: "weekdays", music: "echo" });
assert.equal(s.settings.enabled, true); assert.match(s.summary, /^Wake-up at 06:45 on weekdays: all lights fade up over 10 minutes before, then music on Michelle's Echo/);
await wk.tick(); await new Promise((r) => setTimeout(r, 20));
assert.deepEqual(calls.filter((c) => c[0] === "light").map((c) => c[2]).filter(Boolean), ["5", "20", "40", "60", "80", "100"]);
assert.deepEqual(calls.find((c) => c[0] === "music"), ["music", "michelle's echo", "a gentle, happy start to the morning"]);
const said = calls.find((c) => c[0] === "say")[1];
assert.match(said, /^Good morning, sir\. It's 6:35 am\. It's 10 degrees out, with rain today and a high of 13, and a 70 percent chance of rain\. First up today: Paint rep at 10:00 am\.$/);
const n = calls.length; await wk.tick(); assert.equal(calls.length, n);   // once a day
clock = new Date("2026-10-31T06:35:00Z"); await wk.tick(); assert.equal(calls.length, n);   // Saturday: off
console.log("home2 ok");
