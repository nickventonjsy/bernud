import assert from "node:assert/strict";
import { createOrders } from "./orders.js";
const store = new Map();
const kv = { get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); } };
const drafts = [], notes = [];
let t = new Date("2026-10-29T10:00:00Z"); // Thursday
const o = createOrders({ kv, gmail: { createDraft: async (d) => { drafts.push(d); return { id: "d1", link: "L" }; } }, notify: async (m) => notes.push(m), now: () => t });

let r = await o.handle({ action: "set_supplier", supplier: "Capella", email: "orders@capella.example", contact: "Dave" });
assert.equal(r.ok, true);
assert.equal((await o.handle({ action: "set_supplier", supplier: "X", email: "bad" })).ok, false);
r = await o.handle({ action: "add", item: "2K clear", qty: "2 x 5L", supplier: "capella" });
assert.equal(r.added.supplier, "Capella"); assert.equal(r.supplier_known, true);
r = await o.handle({ action: "add", item: "2k Clear", qty: "3 x 5L", supplier: "Capella" });
assert.equal(r.updated.qty, "3 x 5L");
await o.handle({ action: "add", item: "Masking tape 24mm", qty: "10", supplier: "Tape Co" });
r = await o.handle({ action: "list" });
assert.equal(r.count, 2); assert.deepEqual(Object.keys(r.by_supplier).sort(), ["Capella", "Tape Co"]);
assert.equal((await o.handle({ action: "draft" })).ok, false); // several suppliers
r = await o.handle({ action: "draft", supplier: "Tape Co" });
assert.match(r.error, /email address/);
r = await o.handle({ action: "draft", supplier: "capella" });
assert.equal(r.ok, true); assert.equal(drafts[0].to, "orders@capella.example");
assert.match(drafts[0].body, /Hi Dave/); assert.match(drafts[0].body, /- 3 x 5L x 2K clear/); assert.match(drafts[0].subject, /29\/10\/2026/);
r = await o.handle({ action: "mark_ordered", supplier: "Capella" });
assert.equal(r.cleared, 1); assert.equal(r.remaining, 1);
assert.equal((await o.handle({ action: "history", item: "clear" })).orders.length, 1);
assert.equal((await o.handle({ action: "remove", item: "masking" })).ok, true);
// order-day nudge
await o.handle({ action: "add", item: "Thinners", qty: "4" });
assert.equal((await o.handle({ action: "set_order_day", day: "Thursday", time: "09:30" })).ok, true);
assert.equal(await o.tick(), true); assert.equal(await o.tick(), false); // once per day
assert.match(notes[0], /1 item on the reorder list/);
t = new Date("2026-10-30T10:00:00Z"); assert.equal(await o.tick(), false); // Friday
assert.deepEqual(await o.summary(), ["4 x Thinners"]);
console.log("orders tests passed");
