// Tests for the CCP Brain module with a fake Drive (no network).
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
process.env.NODE_ENV = "test";
process.env.CCP_FOLDER_ID = "root";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "bernard@proj.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) });
const ccp = await import("./ccp.js");

// --- dates
assert.deepEqual(ccp.findDates("Effective 1st November 2026").map((d) => d.iso), ["2026-11-01"]);
assert.deepEqual(ccp.findDates("valid until 01/12/2026").map((d) => d.iso), ["2026-12-01"]);
assert.deepEqual(ccp.findDates("on 2026-10-27 and Nov 3, 2026").map((d) => d.iso), ["2026-10-27", "2026-11-03"]);
assert.equal(ccp.findDates("31/02/2026").length, 0);
assert.equal(ccp.todayLondon(new Date("2026-10-24T23:30:00Z")), "2026-10-25"); // BST

// --- classification
const today = "2026-10-24";
let c = ccp.classify({ name: "Supplier X Price List 2026.xlsx", text: "Prices effective from 1 September 2026\nValid until 31/12/2026" }, today);
assert.equal(c.status, "current"); assert.equal(c.effective, "2026-09-01"); assert.equal(c.expires, "2026-12-31"); assert.ok(c.covers.includes("price list"));
c = ccp.classify({ name: "Supplier X Price List 2025.xlsx", text: "Valid until 31 December 2025" }, today);
assert.equal(c.status, "historical");
c = ccp.classify({ name: "Notes.docx", text: "random notes" }, today);
assert.equal(c.status, "uncertain");
c = ccp.classify({ name: "Trade terms v3.pdf", text: "Superseded by Trade terms v4" }, today);
assert.equal(c.status, "historical");
c = ccp.classify({ name: "Price list Jan 2027", text: "Effective from 1 January 2027" }, today);
assert.equal(c.status, "uncertain"); assert.match(c.status_reason, /not effective until/);

// --- family / conflicts
assert.equal(ccp.family("Lechler Price List v2 March 2026.xlsx"), ccp.family("Lechler price list v3 2026.xlsx"));
const conf = ccp.findConflicts([{ name: "Lechler Price List v2.xlsx", status: "current" }, { name: "Lechler Price List v3.xlsx", status: "current" }, { name: "Other.pdf", status: "current" }]);
assert.equal(conf.length, 1);

// --- sheet rendering & snippets
const sheet = ccp.rowsToText("Prices", [["Code", "Description", "Pack", "Trade £"], ["CL-100", "2K Clear", "5L", "48.20"], ["HD-20", "Hardener", "2.5L", "31.00"]]);
assert.match(sheet, /\[Sheet: Prices\]/); assert.match(sheet, /A2: CL-100 \| B2: 2K Clear \| C2: 5L \| D2: 48.20/);
const sn = ccp.snippets(sheet, "clear 5L", { radius: 0 });
assert.equal(sn[0].location, "Sheet: Prices"); assert.match(sn[0].text, /CL-100/);

// --- full index + brief with fake Drive
let files = [
  { id: "a", name: "Lechler Price List 2026.xlsx", path: "Prices/Lechler Price List 2026.xlsx", mimeType: "x", modifiedTime: "2026-10-01T09:00:00Z", webViewLink: "https://d/a" },
  { id: "b", name: "Priorities and notes.docx", path: "Priorities and notes.docx", mimeType: "x", modifiedTime: "2026-10-24T07:00:00Z", webViewLink: "https://d/b" },
  { id: "c", name: "Photo.jpg", path: "Photo.jpg", mimeType: "image/jpeg", modifiedTime: "2026-09-01T07:00:00Z", webViewLink: "https://d/c" },
];
const texts = {
  a: "[Sheet: Prices]\nA1: Prices effective from 1 September 2026, valid until 15 November 2026\nA2: CL-100 | B2: 2K Clear | C2: 5L | D2: £48.20",
  b: "Actions\nChase Lechler rebate form by 28 October 2026\nQuote for Smith Motors expires 30/10/2026\nStocktake 15 December 2026",
  c: null,
};
let reads = 0;
const lister = async () => files;
const reader = async (f) => { reads++; return texts[f.id]; };
let idx = await ccp.refreshIndex({ lister, reader });
assert.equal(idx.files, 3); assert.equal(idx.read, 3); assert.equal(idx.pending, 0);
idx = await ccp.refreshIndex({ lister, reader });
assert.equal(idx.unchanged, 3); assert.equal(reads, 3, "unchanged files are not re-read");

const s = await ccp.search("2K clear 5L");
assert.equal(s[0].name, "Lechler Price List 2026.xlsx"); assert.equal(s[0].matches[0].location, "Sheet: Prices");
const r = await ccp.readDoc("Priorities", "rebate");
assert.match(r.matches[0].text, /Chase Lechler rebate/);
assert.match((await ccp.readDoc("Photo.jpg")).note, /couldn't be read/);

const now = new Date("2026-10-24T07:30:00Z");
let ctx = await ccp.briefContext({ now, refresh: false });
assert.match(ctx.date, /Saturday,? 24 October 2026/);
assert.match(ctx.changes.compared_with, /no previous brief/);
assert.deepEqual(ctx.changes.modified.map((m) => m.name), ["Priorities and notes.docx"]);
assert.deepEqual(ctx.deadlines_next_7_days.map((d) => d.date), ["2026-10-28", "2026-10-30"]);
assert.ok(ctx.focus_documents.some((d) => d.name === "Priorities and notes.docx"));
assert.deepEqual(ctx.source_map_summary.unreadable, ["Photo.jpg"]);

assert.ok(ctx.business_documents.length >= 1 && ctx.source_map_summary.total === 3);
await ccp.saveBriefText(ctx.brief_id, "first brief");
// an abandoned attempt (no text) must not become the comparison point
await ccp.briefContext({ now: new Date("2026-10-24T08:00:00Z"), refresh: false });
// a file changes between briefs
files = files.map((f) => (f.id === "a" ? { ...f, modifiedTime: "2026-10-25T06:00:00Z" } : f));
texts.a = texts.a.replace("48.20", "49.10");
await ccp.refreshIndex({ lister, reader });
ctx = await ccp.briefContext({ now: new Date("2026-10-25T07:30:00Z"), refresh: false });
assert.match(ctx.changes.compared_with, /previous brief at 24\/10\/2026, 08:30/);
assert.deepEqual(ctx.changes.modified.map((m) => m.name), ["Lechler Price List 2026.xlsx"]);
assert.ok(ctx.pricing_and_supplier_watch.some((p) => /Validity ends 2026-11-15/.test(p.issue)));

assert.ok(await ccp.saveBriefText(ctx.brief_id, "## CCP brief\nTest"));
assert.equal((await ccp.latestBrief()).text, "## CCP brief\nTest");

// --- service-account JWT is well formed and correctly signed
const realFetch = globalThis.fetch;
let assertion;
globalThis.fetch = async (u, opt) => { assertion = new URLSearchParams(opt.body).get("assertion"); return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 })); };
// listFolderTree triggers token then Drive call; stub Drive after token
let calls = 0;
globalThis.fetch = async (u, opt) => {
  calls++;
  if (String(u).startsWith("https://oauth2")) { assertion = new URLSearchParams(opt.body).get("assertion"); return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 })); }
  assert.equal(opt.headers.authorization, "Bearer tok");
  assert.match(String(u), /'root'%20in%20parents/);
  return new Response(JSON.stringify({ files: [] }));
};
assert.deepEqual(await ccp.listFolderTree(), []);
const [h, p, sig] = assertion.split(".");
const claims = JSON.parse(Buffer.from(p, "base64url").toString());
assert.equal(claims.iss, "bernard@proj.iam.gserviceaccount.com");
assert.equal(claims.scope, "https://www.googleapis.com/auth/drive.readonly");
assert.ok(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(sig, "base64url")));
globalThis.fetch = realFetch;

// response stays small even for a big folder
files = Array.from({ length: 700 }, (_, i) => ({ id: "t" + i, name: `PRODUCT${i}_TDS${i % 3 ? "" : "_2"}.pdf`, path: `99 INBOX/PRODUCT${i}_TDS.pdf`, mimeType: "x", modifiedTime: "2026-10-02T09:00:00Z", webViewLink: "https://d/t" + i }));
for (const f of files) texts[f.id] = "Technical Data Sheet\nApplication conditions 20C\nNotes: mix 2:1 ".repeat(40);
await ccp.refreshIndex({ lister: async () => files, reader, budgetMs: 60000 });
const big = await ccp.briefContext({ now: new Date("2026-10-26T07:30:00Z"), refresh: false });
const size = JSON.stringify(big).length;
assert.ok(size < 30000, "brief context too large: " + size);
console.log("ccp tests passed (brief context " + size + " bytes for 700 files)");
