// Local tests: in-memory storage, no network. Run with `node test.js`.
import assert from "node:assert/strict";
import http from "node:http";
process.env.NODE_ENV = "test";
process.env.BERNUD_KEY = "k";
const { handle, rank, parseRss, tokens } = await import("./index.js");

const srv = http.createServer(handle).listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const call = (p, opt = {}) => fetch(base + p, { ...opt, headers: { "x-bernud-key": "k", "content-type": "application/json", ...(opt.headers || {}) } }).then(async (r) => ({ status: r.status, body: await r.json() }));

assert.equal((await fetch(base + "/health").then((r) => r.json())).ok, true);
assert.equal((await fetch(base + "/memory/search")).status, 401);
assert.equal((await call("/memory/search", { headers: { "x-bernud-key": "wrong" } })).status, 401);

let r = await call("/memory/search?query=flight");
assert.equal(r.body.count, 0); assert.match(r.body.note, /No memories/);

await call("/memory/save", { method: "POST", body: JSON.stringify({ text: "Kerr's flight to Spain is on Tuesday at 7am", category: "people" }) });
await call("/memory/save", { method: "POST", body: JSON.stringify({ text: "Nicholas prefers his coffee black" }) });
await call("/memory/save", { method: "POST", body: JSON.stringify({ text: "Payroll is due on the 25th each month", category: "work" }) });
assert.equal((await call("/memory/save", { method: "POST", body: JSON.stringify({ text: "  " }) })).status, 400);

r = await call("/memory/search?query=" + encodeURIComponent("when is Kerr's flight?"));
assert.equal(r.body.memories[0].text, "Kerr's flight to Spain is on Tuesday at 7am");
r = await call("/memory/search?query=coffee");
assert.equal(r.body.count, 1);
r = await call("/memory/search?query=payroll");
assert.match(r.body.memories[0].text, /25th/);
r = await call("/memory/search");
assert.equal(r.body.count, 3); assert.equal(r.body.total_memories, 3);

r = await call("/memory/forget", { method: "POST", body: JSON.stringify({ query: "coffee" }) });
assert.equal(r.body.forgotten, true);
assert.equal((await call("/memory/search?query=coffee")).body.count, 0);
r = await call("/memory/forget", { method: "POST", body: JSON.stringify({ query: "zebra" }) });
assert.equal(r.body.forgotten, false);

assert.equal((await call("/news?topic=nope")).status, 400);

const xml = `<rss><channel><item><title><![CDATA[Bitcoin rises &amp; falls]]></title><description>&lt;p&gt;Markets move&lt;/p&gt;</description><pubDate>Sat, 24 Oct 2026 10:00:00 GMT</pubDate></item><item><title>Second</title></item></channel></rss>`;
const items = parseRss(xml, "BBC");
assert.equal(items.length, 2); assert.equal(items[0].title, "Bitcoin rises & falls"); assert.equal(items[0].summary, "Markets move");
assert.ok(items[0].published.startsWith("2026-10-24"));
assert.deepEqual(tokens("What's Kerr's flight?"), ["what", "kerr", "flight"].filter((w) => w !== "what"));

srv.close();
console.log("all tests passed");
