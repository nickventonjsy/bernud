import assert from "node:assert/strict";
import { createReceipts, parseReceipt, monthFor } from "./receipts.js";

// Parsing what the vision model returns.
assert.equal(parseReceipt("nonsense"), null);
assert.deepEqual(parseReceipt('{"is_receipt": false, "notes": "a cat"}'), { is_receipt: false, notes: "a cat" });
const p = parseReceipt('```json\n{"is_receipt":true,"shop":"Waitrose","date":"2026-10-25","total":"64.2","items":[{"name":"Milk 2L","qty":1,"price":1.45},{"name":"","price":2}],"confidence":"high"}\n```');
assert.equal(p.total, 64.2); assert.equal(p.items.length, 1); assert.equal(p.shop, "Waitrose");

// Month words.
const now = new Date("2026-10-27T12:00:00Z");
assert.equal(monthFor("", now), "2026-10"); assert.equal(monthFor("last month", now), "2026-09");
assert.equal(monthFor("september", now), "2026-09"); assert.equal(monthFor("november", now), "2025-11"); assert.equal(monthFor("2026-08", now), "2026-08");

// Ingest + questions, with a fake vision model and fake Drive.
const mem = {}; const kv = { get: async (k) => mem[k] ?? null, set: async (k, v) => { mem[k] = v; } };
let t = new Date("2026-10-27T17:00:00Z");
const answers = [];
const vision = async () => answers.shift();
const uploads = [];
const drive = { uploadFile: async (a) => { uploads.push(a.name); return { link: "https://drive/x", folder_link: "https://drive/f" }; } };
const rc = createReceipts({ kv, vision, drive, now: () => t, log: { error() {} } });

answers.push(JSON.stringify({ is_receipt: true, shop: "Co-op", date: "2026-10-27", total: 23.5, items: [{ name: "Milk 2L", price: 1.45 }, { name: "Bread", price: 1.2 }], confidence: "high" }));
let r = await rc.ingest({ data: Buffer.from("jpg"), via: "telegram" });
assert.ok(r.ok); assert.match(r.message, /Co-op, £23\.50, 2 items\. Saved\./); assert.equal(uploads[0], "2026-10-27 Co-op £23.50.jpg");
// Same again within minutes = duplicate.
answers.push(JSON.stringify({ is_receipt: true, shop: "Co-op", date: "2026-10-27", total: 23.5, items: [], confidence: "high" }));
r = await rc.ingest({ data: Buffer.from("jpg") }); assert.ok(r.duplicate);
// Not a receipt.
answers.push(JSON.stringify({ is_receipt: false, notes: "a dog" }));
r = await rc.ingest({ data: Buffer.from("jpg") }); assert.equal(r.ok, false); assert.ok(r.not_receipt);
// Another shop, earlier in the month; and one last month.
t = new Date("2026-10-27T18:00:00Z");
answers.push(JSON.stringify({ is_receipt: true, shop: "Waitrose", date: "2026-10-18", total: 64.2, items: [{ name: "Milk 2L", price: 1.45 }, { name: "Eggs", price: 2.5 }], confidence: "medium" }));
r = await rc.ingest({ data: Buffer.from("jpg") }); assert.match(r.message, /dated 2026-10-18/); assert.match(r.message, /£87\.70 on October 2026/);
answers.push(JSON.stringify({ is_receipt: true, shop: "Waitrose", date: "2026-09-20", total: 40, items: [{ name: "Milk 2L", price: 1.45 }], confidence: "high" }));
await rc.ingest({ data: Buffer.from("jpg") });

r = await rc.handle({ action: "summary" });
assert.equal(r.total, 87.7); assert.equal(r.receipts, 2); assert.equal(r.shops[0].shop, "Waitrose"); assert.equal(r.previous.total, 40);
r = await rc.handle({ action: "summary", month: "last month" }); assert.equal(r.total, 40);
r = await rc.handle({ action: "summary", shop: "co-op" }); assert.equal(r.total, 23.5);
r = await rc.handle({ action: "list" }); assert.equal(r.count, 3); assert.equal(r.receipts[0].shop, "Waitrose");
r = await rc.handle({ action: "receipt", query: "co-op" }); assert.match(r.message, /Co-op on 2026-10-27.*Milk 2L £1\.45/);
r = await rc.handle({ action: "receipt", query: "2026-10-18" }); assert.equal(r.receipt.total, 64.2);
r = await rc.handle({ action: "usual" }); assert.equal(r.items[0].name, "Milk 2L"); assert.equal(r.items[0].times, 3);
const d = await rc.dash(); assert.equal(d.month.total, 87.7); assert.equal(d.recent.length, 3);
r = await rc.handle({ action: "delete_last" }); assert.equal(r.deleted.total, 40);

// No Drive permission: figures still kept, message says so.
const rc2 = createReceipts({ kv: { get: async () => null, set: async () => {} }, vision: async () => JSON.stringify({ is_receipt: true, shop: "Tesco", total: 5, items: [] }), drive: { uploadFile: async () => { throw Object.assign(new Error("x"), { code: "needs_permission" }); } }, now: () => t, log: { error() {} } });
r = await rc2.ingest({ data: Buffer.from("jpg") }); assert.ok(r.ok); assert.match(r.message, /photo wasn't filed: Drive isn't connected/);
console.log("receipts ok");
