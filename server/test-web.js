import assert from "node:assert/strict";
import { createWeb, checkUrl, isPrivateAddress, htmlToText } from "./web.js";
const pub = async () => [{ address: "93.184.216.34" }];
for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.5", "172.20.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:10.0.0.1"]) assert.equal(isPrivateAddress(ip), true, ip);
for (const ip of ["93.184.216.34", "8.8.8.8", "2a00:1450::1"]) assert.equal(isPrivateAddress(ip), false, ip);
await assert.rejects(checkUrl("http://localhost:3000"), /Private/);
await assert.rejects(checkUrl("http://169.254.169.254/latest/meta-data"), /Private/);
await assert.rejects(checkUrl("file:///etc/passwd"), /Only web pages/);
await assert.rejects(checkUrl("https://evil.example", async () => [{ address: "10.0.0.2" }]), /Private/);
await assert.rejects(checkUrl("https://user:pw@example.com", pub), /embedded/);
assert.equal((await checkUrl("example.com/menu", pub)).href, "https://example.com/menu");
const h = htmlToText("<html><title>Menu &amp; prices</title><style>.x{}</style><script>alert(1)</script><h1>Starters</h1><ul><li>Soup &pound;6.50</li><li>Bread</li></ul><p>Call 01534 123456</p></html>");
const junk = htmlToText("<ul><li></li><li> </li></ul>\r\n\r\n\r\n<p>Hello</p>"); assert.equal(junk.text, "Hello");
assert.equal(h.title, "Menu & prices"); assert.match(h.text, /• Soup £6\.50/); assert.doesNotMatch(h.text, /alert/);
// read: direct page, redirect to private blocked, find filter, extractor fallback
const pages = {
  "https://good.je/menu": { status: 200, type: "text/html", body: "<title>Good</title>" + "<p>Pizza Margherita £11</p><p>Garlic bread £5</p>".repeat(30) },
  "https://bounce.je/": { status: 302, location: "http://127.0.0.1/admin" },
  "https://spa.je/": { status: 200, type: "text/html", body: "<div id=root></div>" },
};
const fetchImpl = async (u, o) => {
  if (u.startsWith("https://api.tavily.com/search")) { assert.match(o.headers.authorization, /^Bearer k$/); return { ok: true, json: async () => ({ answer: "A", results: [{ title: "T", url: "https://good.je", content: "x".repeat(900) }] }) }; }
  if (u.startsWith("https://api.tavily.com/extract")) return { ok: true, json: async () => ({ results: [{ url: "https://spa.je/", raw_content: "Menu: Burger £12. " .repeat(40) }] }) };
  const p = pages[u]; if (!p) throw new Error("no " + u);
  return { ok: p.status < 300, status: p.status, headers: { get: (k) => (k === "location" ? p.location : k === "content-type" ? p.type : null) }, text: async () => p.body };
};
const w = createWeb({ apiKey: "k", fetchImpl, resolve: pub });
const s = await w.search("pizza st helier", { max: 3 });
assert.equal(s.answer, "A"); assert.equal(s.results[0].snippet.length, 400);
const r = await w.read("https://good.je/menu", { find: "garlic" });
assert.equal(r.title, "Good"); assert.match(r.text, /Garlic bread £5/); assert.equal(r.via, "direct");
const wPriv = createWeb({ apiKey: "k", fetchImpl, resolve: async (h) => [{ address: h === "bounce.je" ? "93.1.1.1" : "127.0.0.1" }] });
await assert.rejects(wPriv.read("https://bounce.je/"), /Private/);
const spa = await w.read("https://spa.je/"); assert.equal(spa.via, "extractor"); assert.match(spa.text, /Burger £12/);
await assert.rejects(createWeb({ apiKey: "" }).search("x"), /isn't set up/);
console.log("web tests passed"); process.exit(0);
