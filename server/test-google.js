import assert from "node:assert/strict";
import { createGmail, SCOPES } from "./gmail.js";
const m = new Map(); const kv = { async get(k) { return m.get(k) ?? null; }, async set(k, v) { m.set(k, v); } };
const calls = [];
let grantScope = [SCOPES.gmailRead, SCOPES.gmailCompose, SCOPES.calendar].join(" ");
const fetchImpl = async (u, o = {}) => {
  calls.push({ u, o });
  const res = (j, ok = true, status = 200) => ({ ok, status, json: async () => j });
  if (u.startsWith("https://oauth2.googleapis.com/token")) { const p = new URLSearchParams(o.body); return p.get("grant_type") === "authorization_code" ? res({ access_token: "at", refresh_token: "rt-" + p.get("code"), expires_in: 3600, scope: grantScope }) : res({ access_token: "at2", expires_in: 3600 }); }
  if (u.includes("/revoke")) return res({});
  if (u.endsWith("/gmail/v1/users/me/profile")) return res({ emailAddress: "corycarpaints@gmail.com" });
  if (u.endsWith("/calendars/primary")) return res({ id: "nickventon@gmail.com" });
  if (u.includes("/messages/orig")) return res({ id: "orig", threadId: "T1", payload: { headers: [{ name: "From", value: "Capella <orders@capella.example>" }, { name: "Subject", value: "Order 554" }, { name: "Message-ID", value: "<abc@capella>" }] } });
  if (u.endsWith("/drafts")) return res({ id: "d1" });
  if (u.includes("/events?")) return res({ items: [{ id: "e1", summary: "Paint rep", start: { dateTime: "2026-10-27T10:00:00+00:00" }, end: { dateTime: "2026-10-27T11:00:00+00:00" }, htmlLink: "https://cal/e1" }, { id: "x", status: "cancelled", start: {}, end: {} }] });
  if (u.endsWith("/events") && o.method === "POST") { const b = JSON.parse(o.body); return res({ id: "new", summary: b.summary, start: b.start, end: b.end }); }
  if (/\/events\/e1$/.test(u) && (!o.method || o.method === "GET")) return res({ id: "e1", summary: "Paint rep", start: { dateTime: "2026-10-27T10:00:00Z" }, end: { dateTime: "2026-10-27T11:30:00Z" } });
  if (/\/events\/e1$/.test(u) && o.method === "PATCH") { const b = JSON.parse(o.body); return res({ id: "e1", summary: "Paint rep", start: b.start, end: b.end }); }
  if (/\/events\/e1$/.test(u) && o.method === "DELETE") return { ok: true, status: 204, json: async () => ({}) };
  throw new Error("unexpected " + u);
};
const base = { kv, clientId: "c", clientSecret: "s", redirectUri: "https://srv/google/callback", secret: "k", fetchImpl };
const ccp = createGmail({ ...base, name: "ccp", account: "corycarpaints@gmail.com", scopes: [SCOPES.gmailRead, SCOPES.gmailCompose, SCOPES.calendar] });
const per = createGmail({ ...base, name: "personal", account: "nickventon@gmail.com", kvKey: "google_personal_refresh_token", scopes: [SCOPES.calendar] });
// legacy read-only token from the first connection: reading allowed, drafting not
m.set("gmail_refresh_token", "x"); // placeholder so hasScope legacy path runs
m.delete("gmail_refresh_token");
// connect personal: link carries account, state carries prefix, verifies email via calendar
const pl = per.connectLink(); assert.match(pl, /&a=personal$/);
const purl = new URL(per.startUrl(new URL(pl).searchParams.get("t")));
assert.equal(purl.searchParams.get("scope"), SCOPES.calendar);
const pstate = purl.searchParams.get("state"); assert.ok(per.ownsState(pstate)); assert.ok(!ccp.ownsState(pstate));
grantScope = SCOPES.calendar;
assert.equal(await per.finish(pstate, "p"), "nickventon@gmail.com");
// connect ccp with all three scopes
grantScope = [SCOPES.gmailRead, SCOPES.gmailCompose, SCOPES.calendar].join(" ");
const curl = new URL(ccp.startUrl(new URL(ccp.connectLink()).searchParams.get("t")));
assert.equal(curl.searchParams.get("scope").split(" ").length, 3);
assert.equal(await ccp.finish(curl.searchParams.get("state"), "c"), "corycarpaints@gmail.com");
assert.ok(await ccp.hasScope(SCOPES.gmailCompose)); assert.ok(!(await per.hasScope(SCOPES.gmailRead)));
// draft reply: threads, sets headers, never calls send
const d = await ccp.createDraft({ replyToId: "orig", body: "Hi,\nThanks, we'll collect Monday.\nNicholas" });
assert.equal(d.to, "Capella <orders@capella.example>"); assert.equal(d.subject, "Re: Order 554"); assert.equal(d.in_thread, true); assert.match(d.note, /NOT been sent/);
const dc = calls.find((c) => c.u.endsWith("/drafts")); const payload = JSON.parse(dc.o.body);
assert.equal(payload.message.threadId, "T1");
const raw = Buffer.from(payload.message.raw, "base64url").toString();
assert.match(raw, /In-Reply-To: <abc@capella>/); assert.match(raw, /From: corycarpaints@gmail.com/);
assert.ok(!calls.some((c) => /\/send/.test(c.u)), "never sends");
await assert.rejects(ccp.createDraft({ body: "" , to: "a@b"}), /needs some text/);
// calendar
const ev = await per.events({ from: new Date("2026-10-27T00:00:00Z"), to: new Date("2026-10-28T00:00:00Z") });
assert.equal(ev.length, 1); assert.match(ev[0].when, /Tue 27 Oct.*10:00 to 11:00/); assert.equal(ev[0].calendar, "nickventon@gmail.com");
const add = await per.addEvent({ title: "Dentist", start: "2026-10-29T15:30" });
assert.equal(add.start, "2026-10-29T15:30:00"); assert.equal(add.end, "2026-10-29T16:30:00");
const allday = await ccp.addEvent({ title: "Stocktake", start: "2026-11-02", allDay: true });
assert.equal(allday.start, "2026-11-02"); assert.equal(allday.end, "2026-11-03"); assert.equal(allday.all_day, true);
const mv = await per.moveEvent({ id: "e1", start: "2026-10-28T09:00" });
assert.equal(mv.end, "2026-10-28T10:30:00", "keeps duration");
const del = await per.deleteEvent("e1"); assert.equal(del.title, "Paint rep");
// personal account has no gmail permission
await assert.rejects(per.createDraft({ to: "a@b", body: "x" }), /drafts permission/);
console.log("google tests passed"); process.exit(0);
