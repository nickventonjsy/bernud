import assert from "node:assert";
import { createDayLog } from "./daylog.js";
import { createWeekly, summaryText } from "./weekly.js";
const store = new Map(); const kv = { get: async (k) => store.get(k) ?? null, set: async (k, v) => store.set(k, v), claim: async (k, v) => (store.get(k) === v ? false : (store.set(k, v), true)) };
let t = new Date("2026-10-25T10:00:00Z");
const dayLog = createDayLog({ kv, now: () => t });
await dayLog.add("asked", "lights on"); await dayLog.add("tool", "lights"); await dayLog.add("tool", "lights"); await dayLog.add("tool", "morning brief");
await dayLog.add("alert", "Reminder"); await dayLog.add("alert", "Bernard: 2 things need attention");
t = new Date("2026-10-27T10:00:00Z"); await dayLog.add("asked", "weather"); await dayLog.add("tool", "weather");
await new Promise((r) => setTimeout(r, 20));
const w = await dayLog.week();
assert.equal(w.asked, 2); assert.deepEqual(w.tools[0], ["lights", 2]); assert.equal(w.days, 2);
const text = summaryText({ log: w, voice: { conversations: 4, seconds: 600 }, credits: { ok: true, left: 40000, minutes_left: 81 }, creditsBefore: { ok: true, left: 52000 }, failed: ["Camera: Bedroom"] });
assert.match(text, /2 typed or texted, 4 voice conversations \(about 10 minutes\)/); assert.match(text, /Most used: lights ×2/); assert.match(text, /Morning briefs: 1\. Reminders fired: 1/);
assert.match(text, /Problems flagged: 2 things need attention ×1/); assert.match(text, /Still not right: Camera: Bedroom/); assert.match(text, /Used this week: about 12,000/);
const notes = []; let now = new Date("2026-11-01T19:10:00Z"); // Sunday 19:10 London
const wk = createWeekly({ kv, dayLog, notify: async (x, o) => notes.push({ x, o }), credits: async () => ({ ok: true, left: 39000, minutes_left: 79 }), complete: async () => '"A quiet week, Nicholas."', now: () => now, log: () => {} });
assert.equal(await wk.tick(), true); assert.equal(notes.length, 1); assert.equal(notes[0].o.title, "Bernard's week"); assert.match(notes[0].x, /A quiet week, Nicholas\.$/);
assert.equal(await wk.tick(), false);                       // once per week
now = new Date("2026-11-02T19:10:00Z"); assert.equal(await wk.tick(), false);   // Monday: no
console.log("weekly tests passed"); process.exit(0);
