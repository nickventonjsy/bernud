import assert from "node:assert/strict";
import { londonToDate, nextRepeat, createReminders, londonLabel } from "./reminders.js";
// BST and GMT conversions
assert.equal(londonToDate("2026-10-24T16:00").toISOString(), "2026-10-24T15:00:00.000Z");
assert.equal(londonToDate("2026-11-02T09:00").toISOString(), "2026-11-02T09:00:00.000Z");
assert.equal(londonToDate("nonsense"), null);
// repeats across the clock change (25 Oct 2026): stays 09:00 local
const fri = londonToDate("2026-10-23T09:00");
assert.equal(nextRepeat(fri, "daily", fri).toISOString(), "2026-10-24T08:00:00.000Z");
assert.equal(nextRepeat(fri, "weekdays", fri).toISOString(), "2026-10-26T09:00:00.000Z"); // Monday 09:00 GMT
assert.equal(nextRepeat(fri, "weekly", fri).toISOString(), "2026-10-30T09:00:00.000Z");
assert.equal(nextRepeat(londonToDate("2026-01-31T10:00"), "monthly", londonToDate("2026-01-31T10:00")).toISOString(), "2026-02-28T10:00:00.000Z");
assert.equal(nextRepeat(londonToDate("2026-10-27T09:00"), "yearly", londonToDate("2026-10-27T09:00")).toISOString(), "2027-10-27T08:00:00.000Z");   // same wall-clock time next year (BST in 2027, GMT in 2026)
assert.equal(nextRepeat(londonToDate("2028-02-29T09:00"), "yearly", londonToDate("2028-02-29T09:00")).toISOString(), "2029-02-28T09:00:00.000Z");   // leap day -> 28 Feb
// store
const m = new Map(); const kv = { async get(k) { return m.get(k) ?? null; }, async set(k, v) { m.set(k, v); } };
const notes = []; let clock = new Date("2026-10-24T15:00:00Z"); let price = 52000;
const fetchImpl = async () => ({ json: async () => ({ bitcoin: { usd: price, gbp: Math.round(price * 0.78) } }) });
const R = createReminders({ kv, notify: async (t, o) => notes.push({ t, ...o }), fetchImpl, now: () => clock, log: () => {} });
assert.equal((await R.reminder({ action: "add", text: "Ring Kerr", when: "2026-10-24T15:00" })).ok, false, "past time rejected");
let r = await R.reminder({ action: "add", text: "Ring Kerr", when: "2026-10-24T17:30" });
assert.equal(r.ok, true); assert.match(r.reminder.when, /17:30/);
await R.reminder({ action: "add", text: "Bins out", when: "2026-10-26T19:00", repeat: "weekly" });
assert.equal((await R.reminder({ action: "list" })).count, 2);
clock = new Date("2026-10-24T16:31:00Z");
assert.equal(await R.tickReminders(), 1); assert.equal(notes[0].t, "Ring Kerr"); assert.equal(notes[0].title, "Reminder");
assert.equal(await R.tickReminders(), 0, "fires once");
clock = new Date("2026-10-26T19:00:30Z");
assert.equal(await R.tickReminders(), 1);
const after = (await R.reminder({ action: "list" })).reminders;
assert.equal(after.length, 1); assert.match(after[0].when, /2 Nov.*19:00/);
assert.equal((await R.reminder({ action: "cancel", text: "bins" })).ok, true);
assert.equal((await R.reminder({ action: "list" })).count, 0);
// price alerts
assert.equal((await R.alert({ action: "add", coin: "BTC", direction: "above", price: "50,000" })).ok, false, "already above");
const a = await R.alert({ action: "add", coin: "BTC", direction: "drops below", price: "$50,000" });
assert.equal(a.ok, true); assert.equal(a.alert.condition, "below $50,000");
assert.equal(await R.tickAlerts(), 0);
price = 49800; assert.equal(await R.tickAlerts(), 1); assert.match(notes.at(-1).t, /bitcoin is now \$49,800/);
assert.equal((await R.alert({ action: "list" })).count, 0, "one-shot");
console.log("reminder tests passed"); process.exit(0);
