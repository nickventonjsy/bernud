import assert from "node:assert/strict";
import { createDigests, recyclingFor, workingDay } from "./digests.js";
import { createParcels, parseParcels } from "./parcels.js";

// St Brelade 2026 planner weeks.
assert.equal(recyclingFor("2026-11-03").box, "blue box");
assert.equal(recyclingFor("2026-11-10").box, "red box");
assert.equal(recyclingFor("2026-11-24").box, "black box");
assert.equal(recyclingFor("2026-12-08").box, "red box");
assert.equal(recyclingFor("2026-12-22").box, "black box");
assert.equal(recyclingFor("2026-12-29").box, "blue box");
// Weekend dates move back to the Friday.
assert.equal(workingDay("2026-10", 25), "2026-10-23");
assert.equal(workingDay("2026-11", 25), "2026-11-25");
assert.equal(workingDay("2026-11", 15), "2026-11-13");

const mem = {}; const kv = { get: async (k) => mem[k] ?? null, set: async (k, v) => { mem[k] = v; } };
const sent = []; const notify = async (text, o) => { sent.push({ text, ...o }); return true; };
let t = new Date("2026-11-02T17:35:00Z"); // Monday 17:35 London
const d = createDigests({ kv, notify, now: () => t,
  needsReply: async () => [{ from: "Kerr <k@x.je>", subject: "Price for a bumper" }],
  priorities: async () => [{ text: "Chase Sherwin", done: false }, { text: "Pay Capella", done: true }],
  events: async () => [{ title: "MOT", start: "2026-11-03T10:00:00Z", all_day: false }],
  parcels: { lines: async () => ["Masking tape from Toolstation: dispatched"] },
  receipts: { week: async () => ({ total: 84.5, receipts: 3, previous_total: 60, shops: [{ shop: "Co-op", total: 50, visits: 2 }], month: { month_name: "November 2026", total: 84.5 } }) },
  camEvents: async () => ({ summary: [{ camera: "Shop", kinds: { person: 2 }, first: "02:10", last: "02:14" }] }) });
assert.equal(await d.tick(), 1);
assert.match(sent[0].text, /Kerr: Price for a bumper/); assert.match(sent[0].text, /Chase Sherwin/); assert.doesNotMatch(sent[0].text, /Capella/);
assert.match(sent[0].text, /Tuesday:\n• 10:00 MOT/); assert.match(sent[0].text, /Masking tape/);
assert.equal(await d.tick(), 0, "once a day");
// Bins: set Tuesday collection; Monday 19:05 reminder with the blue box.
let r = await d.handle({ action: "set", bin_day: "tuesday" }); assert.match(r.bins, /on, collected Tuesdays/);
t = new Date("2026-11-02T19:05:00Z"); await d.tick();
assert.equal(sent.at(-1).title, "Bins tonight"); assert.match(sent.at(-1).text, /blue box/);
// Payroll on the 25th (Wednesday) and the deadline on the 10th.
t = new Date("2026-11-25T09:10:00Z"); await d.tick(); assert.equal(sent.at(-1).title, "Payroll day");
t = new Date("2026-11-10T09:10:00Z"); await d.tick(); assert.match(sent.at(-1).text, /due on the 15th/);
// Previews.
r = await d.handle({ action: "preview", which: "spend" }); assert.match(r.text, /£84.50 across 3 receipts \(£24.50 more/);
r = await d.handle({ action: "preview", which: "cameras" }); assert.match(r.text, /Shop: 2 person \(02:10 to 02:14\)/);
r = await d.handle({ action: "set", wrapup: false }); assert.equal(r.wrapup, "off");

// Parcels.
assert.equal(parseParcels('{"parcels":[{"what":"Tape","from":"Toolstation","status":"bogus","inbox":"personal"}]}')[0].status, "dispatched");
let calls = 0;
const fake = (msgs, ok = true) => ({ configured: () => true, connected: async () => ok, search: async () => ({ messages: msgs }) });
const p = createParcels({ inboxes: { ccp: fake([{ id: "a1", date: "x", from: "DPD", subject: "Out for delivery", snippet: "today" }]), personal: fake([], false) },
  complete: async () => { calls++; return '{"parcels":[{"what":"Paint","from":"Sherwin","status":"delivered"},{"what":"Gun","from":"Amazon","status":"out_for_delivery","expected":"2026-11-02"}]}'; } });
r = await p.list();
assert.deepEqual(r.checked, ["ccp"]); assert.deepEqual(r.not_connected, ["personal"]); assert.equal(r.parcels[0].what, "Gun"); assert.equal(r.coming, 1);
await p.list(); assert.equal(calls, 1, "cached");
assert.deepEqual(await p.lines(), ["Gun from Amazon: out for delivery, due 2026-11-02"]);
console.log("digests + parcels ok");
// Meal ideas: different cuisines, avoid list, preferences passed through.
const { createMeals } = await import("./meals.js");
{
  const mem = {}; const kv = { get: async (k) => mem[k] ?? null, set: async (k, v) => { mem[k] = v; } };
  let seen = "";
  const m = createMeals({ kv, memories: async () => [{ text: "Michelle doesn't like fish.", category: "learned" }, { text: "Recipe: Chicken Jambalaya (suggested 28 October 2026). Serves four.", category: "recipe" }, { text: "Oakley is Michelle's son.", category: "people" }],
    complete: async ({ text }) => { seen = text; return '{"ideas":[{"name":"Lamb Kofta","why":"x","extra":"lamb mince","minutes":30},{"name":"Pad Thai","why":"y"},{"name":"Chilli","why":"z"}]}'; } });
  let r = await m.ideas({ ingredients: "chicken" });
  assert.equal(r.ideas.length, 3); assert.match(seen, /doesn't like fish/); assert.match(seen, /Avoid[^\n]*Chicken Jambalaya/); assert.doesNotMatch(seen, /Oakley is/);
  await m.ideas({}); assert.match(seen, /Avoid[^\n]*Lamb Kofta/, "last time's ideas are avoided");
}
console.log("meals ok");
{
  const { createMeals } = await import("./meals.js");
  const mem = {}; const kv = { get: async (k) => mem[k] ?? null, set: async (k, v) => { mem[k] = v; } };
  const m = createMeals({ kv, memories: async () => [{ text: "Michelle doesn't like fish.", category: "learned" }], complete: async () => { throw new Error("busy"); } });
  const r = await m.ideas({ people: "just me" });
  assert.equal(r.ok, true); assert.equal(r.ideas.length, 3);
  console.log("meals fallback ok");
}
