import assert from "node:assert/strict";
import { createPriorities } from "./priorities.js";
const mem = {}; const kv = { get: async (k) => mem[k] ?? null, set: async (k, v) => { mem[k] = v; } };
let t = new Date("2026-10-27T08:00:00Z");
const p = createPriorities({ kv, now: () => t });

// Brief items come in once per brief.
const brief = { from: "2026-10-27T07:00:00Z", items: ["Chase Sherwin order", "Reply to Kerr about pricing", "Pay the Capella invoice"] };
let r = await p.handle({ action: "list", brief });
assert.equal(r.count, 3); assert.equal(r.items[0].src, "brief");
r = await p.handle({ action: "list", brief }); assert.equal(r.count, 3, "no duplicates on a second look");

// Voice add, with "to " trimmed and dupes noticed.
r = await p.handle({ action: "add", items: "to ring the accountant", brief });
assert.deepEqual(r.added, ["ring the accountant"]); assert.equal(r.count, 4);
r = await p.handle({ action: "add", items: "ring the accountant", brief }); assert.deepEqual(r.already, ["ring the accountant"]);

// Done by a loose match, undone, removed.
r = await p.handle({ action: "done", items: "the accountant", brief }); assert.deepEqual(r.done, ["ring the accountant"]); assert.equal(r.open, 3);
r = await p.handle({ action: "undone", items: "accountant", brief }); assert.equal(r.open, 4);
r = await p.handle({ action: "remove", items: "capella invoice", brief }); assert.deepEqual(r.removed, ["Pay the Capella invoice"]);
r = await p.handle({ action: "done", items: "nothing like this", brief }); assert.deepEqual(r.not_found, ["nothing like this"]);

// A newer brief replaces the brief items but keeps voice ones.
const brief2 = { from: "2026-10-28T07:00:00Z", items: ["New thing one", "New thing two"] };
r = await p.handle({ action: "list", brief: brief2 });
assert.deepEqual(r.items.map((i) => i.text), ["ring the accountant", "New thing one", "New thing two"]);

// Voice items expire after 3 days.
t = new Date("2026-10-31T09:00:00Z");
r = await p.handle({ action: "list", brief: brief2 }); assert.equal(r.items.some((i) => i.text === "ring the accountant"), false);
r = await p.handle({ action: "clear" }); assert.equal(r.count, 0);
r = await p.handle({ action: "list" }); assert.match(r.message, /No priorities/);
console.log("priorities ok");
