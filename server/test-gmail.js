import assert from "node:assert/strict";
import { createGmail, bodyText } from "./gmail.js";
const m = new Map();
const kv = { async get(k) { return m.get(k) ?? null; }, async set(k, v) { m.set(k, v); } };
let profileEmail = "corycarpaints@gmail.com", revoked = 0, lastQ = [], grantBad = false;
const b64 = (s) => Buffer.from(s).toString("base64url");
const msg = (id, subj, labels = ["INBOX", "UNREAD"]) => ({ id, internalDate: String(Date.parse("2026-10-24T08:00:00Z")), labelIds: labels, snippet: "Hi &amp; thanks", payload: { headers: [{ name: "From", value: "Supplier <s@x.com>" }, { name: "Subject", value: subj }], parts: [{ mimeType: "text/plain", body: { data: b64("Order 123 ships Monday.\n\n\n\nThanks") } }, { filename: "invoice.pdf", mimeType: "application/pdf", body: {} }] } });
const fetchImpl = async (u, o = {}) => {
  const res = (j, ok = true, status = 200) => ({ ok, status, json: async () => j });
  if (u.startsWith("https://oauth2.googleapis.com/token")) {
    const p = new URLSearchParams(o.body);
    if (p.get("grant_type") === "authorization_code") return res({ access_token: "at1", refresh_token: "rt-secret", expires_in: 3600, scope: "https://www.googleapis.com/auth/gmail.readonly" });
    if (grantBad) return res({ error: "invalid_grant" }, false, 400);
    assert.equal(p.get("refresh_token"), "rt-secret"); return res({ access_token: "at2", expires_in: 3600 });
  }
  if (u.startsWith("https://oauth2.googleapis.com/revoke")) { revoked++; return res({}); }
  if (u.endsWith("/profile")) return res({ emailAddress: profileEmail });
  if (u.includes("/messages?")) { const q = new URL(u).searchParams.get("q"); lastQ.push(q); return res(q.includes("category:promotions OR") ? { messages: [{ id: "p1" }, { id: "p2" }] } : q.includes("before:") ? { messages: [{ id: "o1" }] } : q === "in:inbox is:unread" ? { messages: [{ id: "u" }], resultSizeEstimate: 200 } : { messages: [{ id: "a" }, { id: "b" }], resultSizeEstimate: 5 }); }
  const id = u.match(/messages\/([^?]+)/)[1];
  return res(msg(id, "Subject " + id));
};
const g = createGmail({ kv, clientId: "cid", clientSecret: "cs", redirectUri: "https://srv/google/callback", account: "corycarpaints@gmail.com", secret: "k", fetchImpl });
assert.equal(await g.connected(), false);
const link = g.connectLink(); assert.match(link, /^https:\/\/srv\/google\/connect\?t=/);
const t = new URL(link).searchParams.get("t");
const start = new URL(g.startUrl(t));
assert.equal(start.searchParams.get("scope"), "https://www.googleapis.com/auth/gmail.readonly");
assert.equal(start.searchParams.get("access_type"), "offline");
assert.equal(start.searchParams.get("login_hint"), "corycarpaints@gmail.com");
assert.equal(g.startUrl(t), null, "connect link is one-time");
await assert.rejects(g.finish("bogus", "c"), /expired/);
// wrong account is rejected and revoked
profileEmail = "other@gmail.com";
let st = new URL(g.startUrl(new URL(g.connectLink()).searchParams.get("t"))).searchParams.get("state");
await assert.rejects(g.finish(st, "code"), /sign in as corycarpaints/);
assert.equal(revoked, 1); assert.equal(await g.connected(), false);
// right account
profileEmail = "corycarpaints@gmail.com";
st = new URL(g.startUrl(new URL(g.connectLink()).searchParams.get("t"))).searchParams.get("state");
assert.equal(await g.finish(st, "code"), "corycarpaints@gmail.com");
assert.equal(await g.connected(), true);
assert.ok(!m.get("gmail_refresh_token").includes("rt-secret"), "token stored encrypted");
// brief emails
const be = await g.briefEmails("2026-10-23T08:00:00Z");
assert.equal(be.messages.length, 2); assert.equal(be.messages[0].snippet, "Hi & thanks"); assert.equal(be.messages[0].unread, true); assert.equal(be.messages[0].has_attachment, true);
assert.match(be.messages[0].link, /mail\.google\.com.*#all\/a/);
assert.equal(be.more_not_shown, 3); assert.equal(be.promotions_or_social_in_window_skipped, 2); assert.equal(be.unread_older_than_window_excluding_promotions_social, 1); assert.ok(be.unread_in_inbox_total_approx >= 1);
assert.match(lastQ[0], /^in:inbox -category:promotions -category:social after:\d+$/);
assert.equal(be.window.basis, "since the previous brief");
const none = await g.briefEmails(null); assert.equal(none.window.basis, "last 24 hours (no previous brief)");
const old = await g.briefEmails("2020-01-01"); assert.ok(Date.now() - Date.parse(old.window.since) <= 7 * 864e5 + 1000, "window capped at 7 days");
// read
const r = await g.read("a"); assert.equal(r.body, "Order 123 ships Monday.\n\nThanks"); assert.deepEqual(r.attachments, ["invoice.pdf"]);
// html body
assert.equal(bodyText({ mimeType: "text/html", body: { data: b64("<style>x{}</style><p>Hello&nbsp;<b>there</b></p><br>Bye") } }).replace(/\s+/g, " "), "Hello there Bye");
// revoked token -> not connected
grantBad = true; const g2 = createGmail({ kv, clientId: "cid", clientSecret: "cs", redirectUri: "https://srv/google/callback", account: "corycarpaints@gmail.com", secret: "k", fetchImpl });
await assert.rejects(g2.search("x"), /reconnect/); assert.equal(await g2.connected(), false);
console.log("gmail tests passed"); process.exit(0);
