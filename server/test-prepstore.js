import assert from "node:assert/strict";
import { createPrepStore, findItem, quantity, STORE } from "./prepstore.js";

const mem = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; };
let t = new Date("2026-10-30T19:00:00Z"); const sent = [];
const p = createPrepStore({ kv: mem(), now: () => t, notify: async (x, o) => { sent.push(o.title + "|" + x); return true; } });

// Matching what he says to the list.
assert.equal(findItem("the water containers").item.n, "Water storage containers, 20 litre");
assert.equal(findItem("head torches").item.n, "Head torches");
assert.equal(findItem("cat food").item.n, "Cat food");
assert.equal(findItem("a unicorn"), null);

// Quantities scale with household and days (4 people, 14 days by default).
let r = await p.handle({});
assert.equal(r.total, STORE.flatMap((s) => s.items).length); assert.equal(r.sorted, 0); assert.equal(r.people, 4);
assert.equal(quantity(STORE[1].items[0], 4, 14), 56);   // a tin a person a day

r = await p.handle({ action: "tick", item: "tinned meals", use_by: "2026-12" });
assert.equal(r.ok, true); assert.equal(r.item, "Tinned meals (chilli, stew, curry, soup)"); assert.equal(r.sorted, 1);
await p.handle({ action: "tick", item: "water containers" });
assert.equal((await p.handle({ action: "untick", item: "water containers" })).have, false);
assert.equal((await p.handle({ action: "tick", item: "a unicorn" })).ok, false);

r = await p.handle({ action: "settings", people: 2, days: 10 });
assert.deepEqual([r.people, r.days], [2, 7]);
r = await p.handle({ action: "missing" });
assert.equal(r.missing, r.missing); assert.ok(r.first[0].need.includes("bottles"));
assert.deepEqual((await p.handle({})).expiring_soon, [{ name: "Tinned meals (chilli, stew, curry, soup)", use_by: "2026-12" }]);

r = await p.handle({ action: "send", section: "water" });
assert.equal(r.sent, 4); assert.match(sent.pop(), /🛒 Emergency store: still to get\|• Bottled drinking water.*\nhttps:\/\/www\.amazon\.co\.uk\/s\?k=/s);
// Monthly nudge on the 1st, once.
t = new Date("2026-11-01T10:30:00Z"); await p.tick(); await p.tick();
assert.equal(sent.length, 1); assert.match(sent[0], /🥫 Emergency store\|1 of \d+ sorted for 2 people, 7 days/); assert.match(sent[0], /Use or replace soon: Tinned meals/);
console.log("emergency store ok");
process.exit(0);
