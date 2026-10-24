// CCP "Brain": read-only access to the Cory Car Paints Google Drive knowledge folder,
// a persistent source map, and the material Bernard needs for the CCP morning brief.
//
// Access model: a Google service account with the drive.readonly scope. It can only
// see files that have been explicitly shared with its email address (the CCP folder),
// and this code never writes to Drive.
//
// Env:
//   GOOGLE_SERVICE_ACCOUNT_JSON  service account key JSON (set in Render, never committed)
//   CCP_FOLDER_ID                Drive folder id of the CCP knowledge folder
//   DATABASE_URL                 Postgres (source map, cached text, brief history)

import { createSign, randomUUID } from "node:crypto";

export const TZ = "Europe/London";
const FOLDER_ID = process.env.CCP_FOLDER_ID || "";
const MAX_TEXT = 400_000;
const CONCURRENCY = 4;
const DRIVE = "https://www.googleapis.com/drive/v3";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";

// ---------------------------------------------------------------------------
// Dates (UK formats first: 01/11/2026 is 1 November)
// ---------------------------------------------------------------------------

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DATE_PATTERNS = [
  // 1 November 2026 / 1st Nov 2026
  { re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}\\.?,?\\s+(\\d{4})\\b`, "gi"), f: (m) => ymd(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]) },
  // November 1, 2026
  { re: new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "gi"), f: (m) => ymd(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]) },
  // 2026-11-01
  { re: /\b(\d{4})-(\d{2})-(\d{2})\b/g, f: (m) => ymd(+m[1], +m[2] - 1, +m[3]) },
  // 01/11/2026 or 1.11.26 (UK day-first)
  { re: /\b(\d{1,2})[\/.](\d{1,2})[\/.](\d{2}|\d{4})\b/g, f: (m) => ymd(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2] - 1, +m[1]) },
  // November 2026 (month only: first of month)
  { re: new RegExp(`\\b${MONTH_RE}\\s+(\\d{4})\\b`, "gi"), f: (m) => ymd(+m[2], MONTHS[m[1].slice(0, 3).toLowerCase()], 1), monthOnly: true },
];

function ymd(y, mo, d) {
  if (!(y > 1990 && y < 2100) || !(mo >= 0 && mo <= 11) || !(d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, mo, d));
  if (dt.getUTCMonth() !== mo) return null;
  return dt.toISOString().slice(0, 10);
}

export function findDates(text) {
  const out = [];
  const taken = [];
  for (const p of DATE_PATTERNS) {
    for (const m of String(text).matchAll(p.re)) {
      const start = m.index, end = m.index + m[0].length;
      if (taken.some(([a, b]) => start < b && end > a)) continue;
      const iso = p.f(m);
      if (!iso) continue;
      taken.push([start, end]);
      out.push({ iso, index: start, raw: m[0], monthOnly: Boolean(p.monthOnly) });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

export function todayLondon(now = new Date()) {
  return now.toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD
}
function addDays(iso, n) { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

// ---------------------------------------------------------------------------
// Document classification for the source map
// ---------------------------------------------------------------------------

function firstDateAfter(text, re) {
  const m = re.exec(text);
  if (!m) return null;
  const d = findDates(text.slice(m.index, m.index + m[0].length + 60));
  return d.length ? d[0].iso : null;
}

// Labels come from the file NAME first (reliable), then only from strong phrases in the content.
// Body words like "conditions", "notes" or "order" appear in most data sheets, so they are ignored.
const NAME_TOPICS = [
  ["price list", /(price\s*list|pricelist|prices|tariff|\brrp\b|trade[ _-]?price)/i],
  ["offer / promotion", /(offer|promo|\bspecials?\b|black[ _-]?friday|\bdeals?\b|bundle|bundel|discount|clearance)/i],
  ["supplier terms", /(terms|t&c|trading|rebate|account[ _-]?terms|carriage)/i],
  ["notice", /(closure|closing|holiday|notice|announcement|update[ _-]?letter)/i],
  ["safety data sheet", /(\bsds\b|_sds|-sds|msds|safety[ _-]?data)/i],
  ["technical data sheet", /(\btds\b|_tds|-tds|tds[_-]|technical[ _-]?data)/i],
  ["procedures", /(procedure|process|policy|how[ _-]?to|\bsop\b|checklist)/i],
  ["notes / priorities", /(notes|priorit|actions|to[ _-]?do|minutes|meeting|plan\b|deadlines?)/i],
  ["quotes / orders", /(quote|quotation|order|invoice|\bpo[ _-]?\d)/i],
  ["product information", /(catalogue|catalog|brochure|range|testimonial)/i],
];
const CONTENT_TOPICS = [
  ["safety data sheet", /safety data sheet[\s\S]{0,400}section\s*1|according to regulation \(ec\) no\.? ?1907\/2006/i],
  ["technical data sheet", /technical data sheet|\btds\b/i],
  ["price list", /\bprice\s*list\b/i],
  ["supplier terms", /terms (and|&) conditions of (sale|supply|business)/i],
];

export function classify(doc, today = todayLondon()) {
  const name = doc.name || "";
  const head = (doc.text || "").slice(0, 6000);
  const both = name + "\n" + head;
  let covers = NAME_TOPICS.filter(([, re]) => re.test(name)).map(([t]) => t);
  if (!covers.length) covers = CONTENT_TOPICS.filter(([, re]) => re.test(head)).map(([t]) => t).slice(0, 1);

  const effective =
    firstDateAfter(both, /\b(effective(?:\s+(?:from|date))?|valid\s+from|w\.?e\.?f\.?|applies\s+from|from)\b\s*[:\-]?\s*/i) ||
    null;
  const expires = firstDateAfter(both, /\b(valid\s+(?:until|to|till|through)|expir(?:es|y|ing)(?:\s+date)?|until|ends?)\b\s*[:\-]?\s*/i);
  // Version from the file name (e.g. "_v2", "rev3"); a version printed inside a data sheet
  // template ("Version 1.0") is recorded but isn't enough on its own to call a file current.
  const nvm = name.match(/(?:^|[\s_-])(?:version|ver|v|rev)[\s._-]?(\d+(?:\.\d+)*)(?!\d)/i);
  const cvm = head.match(/\b(?:version|revision|rev\.?)\s?(\d+(?:\.\d+)*)\b/i);
  const version = nvm ? "v" + nvm[1] : cvm ? "v" + cvm[1] + " (in document)" : null;
  const nameVersion = Boolean(nvm);
  const nameDates = findDates(name);
  const nameDate = nameDates.length ? nameDates[nameDates.length - 1].iso : null;
  const sup = both.match(/\b(supersedes|replaces)\s+["“']?([^\n"”']{3,80})/i);
  const supBy = both.match(/\b(superseded\s+by|replaced\s+by)\s+["“']?([^\n"”']{3,80})/i);

  let status = "uncertain";
  const reasons = [];
  const where = doc.path || name;
  if (/\b(old|archived?|archive|historical|historic|previous|legacy|superseded|obsolete|expired|do not use)\b/i.test(where)) { status = "historical"; reasons.push(/historic/i.test(where) ? "file or folder name marks it as HISTORICAL" : "file or folder name marks it as old/archived"); }
  else if (supBy) { status = "historical"; reasons.push(`says it is ${supBy[1].toLowerCase()} "${supBy[2].trim()}"`); }
  else if (expires && expires < today) { status = "historical"; reasons.push(`validity ended ${expires}`); }
  else if (effective && effective > today) { status = "uncertain"; reasons.push(`not effective until ${effective}`); }
  else if (effective || (expires && expires >= today) || nameVersion || nameDate) {
    status = "current";
    if (effective) reasons.push(`effective ${effective}`);
    if (expires) reasons.push(`valid until ${expires}`);
    if (nameVersion) reasons.push(`${version} in file name`);
    if (!effective && !expires && nameDate) reasons.push(`dated ${nameDate} in name`);
  } else {
    reasons.push(version ? `only ${version}; no effective date or replacement notice` : "no effective date, version or replacement notice found");
  }
  if (!doc.text && doc.readable === false) reasons.push("contents could not be read");

  return {
    covers: covers.length ? covers : ["general"],
    effective, expires, version, name_date: nameDate,
    supersedes: sup ? sup[2].trim() : null,
    superseded_by: supBy ? supBy[2].trim() : null,
    status, status_reason: reasons.join("; "),
  };
}

// Normalised "family" name used to spot competing versions of the same document.
export function family(name) {
  // Keep product codes (XPRESS405 ≠ XPRESS605); drop versions, dates and copy suffixes (_2, -1, "copy").
  return String(name)
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/, "")
    .replace(/[ _-]?\(\d+\)$/, "")
    .replace(/(?:[ _-](?:v|ver|version|rev)[ ._-]?\d+(?:\.\d+)*)+/g, " ")
    .replace(new RegExp(`[ _-]${MONTH_RE}[ _-]?(19|20)\\d{2}`, "gi"), " ")
    .replace(/[ _-](19|20)\d{2}\b/g, " ")
    .replace(/\b\d{1,2}[\/.\-]\d{1,2}([\/.\-]\d{2,4})?\b/g, " ")
    .replace(/[ _-](copy|final|draft|new|updated?|latest|old|current)\b/g, " ")
    .replace(/(?:[ _-]\d)+$/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function findConflicts(docs) {
  const groups = new Map();
  for (const d of docs) {
    if (d.status !== "current" && d.status !== "uncertain") continue;
    const f = family(d.name);
    if (f.length < 4) continue;
    if (!groups.has(f)) groups.set(f, []);
    groups.get(f).push(d);
  }
  const out = [];
  for (const [f, list] of groups) {
    const live = list.filter((d) => d.status === "current");
    if (live.length > 1 || (list.length > 1 && live.length === 0)) {
      out.push({ family: f, issue: live.length > 1 ? "More than one version looks current" : "Several versions, none clearly current", documents: list.map((d) => ({ name: d.name, link: d.link, status: d.status, reason: d.status_reason })) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Google auth (service account JWT, no SDK)
// ---------------------------------------------------------------------------

let token = null;
function serviceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
  if (!raw) return null;
  try {
    const j = JSON.parse(raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"));
    if (!j.client_email || !j.private_key) return null;
    return j;
  } catch { return null; }
}
export function configured() { return Boolean(serviceAccount() && FOLDER_ID); }
export function serviceEmail() { return serviceAccount()?.client_email || null; }

const b64url = (b) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

async function accessToken() {
  if (token && token.exp > Date.now() + 60_000) return token.value;
  const sa = serviceAccount();
  if (!sa) throw Object.assign(new Error("Google service account not configured"), { code: "not_configured" });
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/drive.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sig = createSign("RSA-SHA256").update(`${head}.${claim}`).sign(sa.private_key);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claim}.${b64url(sig)}` }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error("Google sign-in failed: " + (j.error_description || j.error || res.status)), { code: "auth_failed" });
  token = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return token.value;
}

async function gget(url, as = "json") {
  const res = await fetch(url, { headers: { authorization: `Bearer ${await accessToken()}` } });
  if (!res.ok) {
    let msg = String(res.status);
    try { const j = await res.json(); msg = j.error?.message || msg; } catch {}
    throw Object.assign(new Error(`Google API ${res.status}: ${msg}`), { status: res.status });
  }
  return as === "json" ? res.json() : as === "text" ? res.text() : Buffer.from(await res.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Drive listing and reading (read-only)
// ---------------------------------------------------------------------------

const FIELDS = "nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,size,shortcutDetails,parents)";

async function listChildren(folderId) {
  const out = [];
  let page = "";
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const j = await gget(`${DRIVE}/files?q=${q}&fields=${encodeURIComponent(FIELDS)}&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true${page ? "&pageToken=" + page : ""}`);
    out.push(...(j.files || []));
    page = j.nextPageToken || "";
  } while (page);
  return out;
}

export async function listFolderTree(rootId = FOLDER_ID, maxFiles = 1500) {
  const files = [];
  const queue = [{ id: rootId, path: "" }];
  const seen = new Set();
  while (queue.length && files.length < maxFiles) {
    const { id, path } = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const f of await listChildren(id)) {
      let file = f;
      if (f.mimeType === "application/vnd.google-apps.shortcut" && f.shortcutDetails?.targetId) {
        try { file = { ...(await gget(`${DRIVE}/files/${f.shortcutDetails.targetId}?fields=id,name,mimeType,modifiedTime,webViewLink,size&supportsAllDrives=true`)), name: f.name }; } catch { continue; }
      }
      if (file.mimeType === "application/vnd.google-apps.folder") queue.push({ id: file.id, path: path + file.name + "/" });
      else files.push({ ...file, path: path + file.name });
    }
  }
  return files;
}

function colLetter(i) { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

export function rowsToText(sheetName, rows) {
  const lines = [`[Sheet: ${sheetName}]`];
  rows.forEach((row, r) => {
    const cells = (row || []).map((v, c) => (v === "" || v == null ? null : `${colLetter(c)}${r + 1}: ${String(v).replace(/\s+/g, " ").trim()}`)).filter(Boolean);
    if (cells.length) lines.push(cells.join(" | "));
  });
  return lines.join("\n");
}

export async function readFileText(file) {
  const mt = file.mimeType;
  if (mt === "application/vnd.google-apps.document" || mt === "application/vnd.google-apps.presentation") {
    return gget(`${DRIVE}/files/${file.id}/export?mimeType=text%2Fplain`, "text");
  }
  if (mt === "application/vnd.google-apps.spreadsheet") {
    const meta = await gget(`${SHEETS}/${file.id}?fields=sheets.properties.title`);
    const titles = (meta.sheets || []).map((s) => s.properties.title);
    const parts = [];
    for (const t of titles) {
      const v = await gget(`${SHEETS}/${file.id}/values/${encodeURIComponent(`'${t.replace(/'/g, "''")}'`)}?valueRenderOption=FORMATTED_VALUE`);
      parts.push(rowsToText(t, v.values || []));
    }
    return parts.join("\n\n");
  }
  if (mt.startsWith("application/vnd.google-apps.")) return null; // forms, drawings, etc.

  const big = Number(file.size || 0) > 25 * 1024 * 1024;
  if (big) return null;
  const buf = await gget(`${DRIVE}/files/${file.id}?alt=media&supportsAllDrives=true`, "buffer");
  const lower = (file.name || "").toLowerCase();

  if (mt === "application/pdf" || lower.endsWith(".pdf")) {
    const { default: pdf } = await import("pdf-parse/lib/pdf-parse.js");
    let page = 0;
    const res = await pdf(buf, {
      pagerender: (pd) => pd.getTextContent().then((tc) => { page++; let last, s = ""; for (const it of tc.items) { s += (last == null || last === it.transform[5] ? "" : "\n") + it.str; last = it.transform[5]; } return `\n[Page ${page}]\n${s}`; }),
    });
    return res.text;
  }
  if (/sheet|excel|csv/.test(mt) || /\.(xlsx|xlsm|xls|csv|ods)$/.test(lower)) {
    const XLSX = await import("xlsx");
    const wb = (XLSX.read || XLSX.default.read)(buf, { type: "buffer", cellDates: true });
    const utils = XLSX.utils || XLSX.default.utils;
    return wb.SheetNames.map((n) => rowsToText(n, utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: "" }))).join("\n\n");
  }
  if (/wordprocessingml/.test(mt) || lower.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const r = await (mammoth.extractRawText || mammoth.default.extractRawText)({ buffer: buf });
    return r.value;
  }
  if (mt.startsWith("text/") || /\.(txt|md|csv|json)$/.test(lower)) return buf.toString("utf8");
  return null;
}

// ---------------------------------------------------------------------------
// Storage (Postgres, or memory for tests)
// ---------------------------------------------------------------------------

function memStore() {
  const docs = new Map(); const briefs = [];
  return {
    async init() {},
    async allDocs() { return [...docs.values()]; },
    async getDoc(id) { return docs.get(id) || null; },
    async upsertDoc(d) { docs.set(d.id, d); },
    async removeDocs(keep) { for (const id of [...docs.keys()]) if (!keep.has(id)) docs.delete(id); },
    async lastBrief() { return briefs[briefs.length - 1] || null; },
    async saveBrief(b) { briefs.push(b); return b; },
    async updateBriefText(id, text) { const b = briefs.find((x) => x.id === id); if (b) b.text = text; return b || null; },
    async latestWithText() { return [...briefs].reverse().find((b) => b.text) || null; },
  };
}

async function pgStore(url) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url, ssl: url.includes("render.com") ? { rejectUnauthorized: false } : undefined, max: 4 });
  const cols = "id, name, path, mime, link, modified, size, text, readable, covers, effective, expires, version, name_date, supersedes, superseded_by, status, status_reason, indexed_at";
  return {
    async init() {
      await pool.query(`CREATE TABLE IF NOT EXISTS ccp_docs (
        id TEXT PRIMARY KEY, name TEXT, path TEXT, mime TEXT, link TEXT, modified TIMESTAMPTZ, size BIGINT,
        text TEXT, readable BOOLEAN, covers TEXT[], effective DATE, expires DATE, version TEXT, name_date DATE,
        supersedes TEXT, superseded_by TEXT, status TEXT, status_reason TEXT, indexed_at TIMESTAMPTZ DEFAULT now())`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ccp_briefs (
        id UUID PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now(), snapshot JSONB NOT NULL, text TEXT)`);
    },
    async allDocs() {
      const { rows } = await pool.query(`SELECT ${cols} FROM ccp_docs ORDER BY path`);
      return rows.map((r) => ({ ...r, modified: r.modified && new Date(r.modified).toISOString(), effective: r.effective && iso(r.effective), expires: r.expires && iso(r.expires), name_date: r.name_date && iso(r.name_date) }));
    },
    async getDoc(id) { const all = await this.allDocs(); return all.find((d) => d.id === id) || null; },
    async upsertDoc(d) {
      await pool.query(`INSERT INTO ccp_docs (${cols}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,now())
        ON CONFLICT (id) DO UPDATE SET name=$2,path=$3,mime=$4,link=$5,modified=$6,size=$7,text=$8,readable=$9,covers=$10,effective=$11,expires=$12,version=$13,name_date=$14,supersedes=$15,superseded_by=$16,status=$17,status_reason=$18,indexed_at=now()`,
        [d.id, d.name, d.path, d.mime, d.link, d.modified, d.size || null, d.text, d.readable, d.covers, d.effective, d.expires, d.version, d.name_date, d.supersedes, d.superseded_by, d.status, d.status_reason]);
    },
    async removeDocs(keep) { await pool.query("DELETE FROM ccp_docs WHERE NOT (id = ANY($1))", [[...keep]]); },
    async lastBrief() { const { rows } = await pool.query("SELECT id, created_at, snapshot, text FROM ccp_briefs ORDER BY created_at DESC LIMIT 1"); return rows[0] || null; },
    async saveBrief(b) { await pool.query("INSERT INTO ccp_briefs (id, created_at, snapshot, text) VALUES ($1, $2, $3, $4)", [b.id, b.created_at, JSON.stringify(b.snapshot), b.text || null]); return b; },
    async updateBriefText(id, text) { const { rows } = await pool.query("UPDATE ccp_briefs SET text = $2 WHERE id = $1 RETURNING id, created_at", [id, text]); return rows[0] || null; },
    async latestWithText() { const { rows } = await pool.query("SELECT id, created_at, text FROM ccp_briefs WHERE text IS NOT NULL ORDER BY created_at DESC LIMIT 1"); return rows[0] || null; },
  };
}
function iso(d) { return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10); }

export const store = process.env.DATABASE_URL && process.env.NODE_ENV !== "test" ? await pgStore(process.env.DATABASE_URL) : memStore();

// ---------------------------------------------------------------------------
// Indexing: refresh the source map incrementally (only changed files are re-read)
// ---------------------------------------------------------------------------

let lastIndex = null;
let indexing = null;

export async function refreshIndex({ budgetMs = 25_000, force = false, lister = listFolderTree, reader = readFileText } = {}) {
  if (indexing) return indexing;
  indexing = (async () => {
    const started = Date.now();
    const files = await lister();
    const existing = new Map((await store.allDocs()).map((d) => [d.id, d]));
    let read = 0, skipped = 0, failed = 0, pending = 0;
    const today = todayLondon();
    const todo = [];
    for (const f of files) {
      const prev = existing.get(f.id);
      const unchanged = prev && prev.modified === new Date(f.modifiedTime).toISOString() && !force;
      if (unchanged) {
        // Re-classify anyway: "current" vs "historical" depends on today's date.
        const c = classify({ name: prev.name, path: prev.path, text: prev.text, readable: prev.readable }, today);
        const changed = ["status", "status_reason", "version", "effective", "expires"].some((k) => (c[k] || null) !== (prev[k] || null)) || JSON.stringify(c.covers) !== JSON.stringify(prev.covers);
        if (changed) await store.upsertDoc({ ...prev, ...c });
        skipped++;
      } else todo.push(f);
    }
    // Read changed files a few at a time.
    let next = 0;
    async function worker() {
      while (next < todo.length) {
        const f = todo[next++];
        if (Date.now() - started > budgetMs) { pending++; continue; }
        let text = null, readable = false;
        try { text = await reader(f); readable = text != null; if (text && text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT); read++; }
        catch (e) { failed++; console.error("read failed", f.name, e.message); }
        const doc = { id: f.id, name: f.name, path: f.path || f.name, mime: f.mimeType, link: f.webViewLink, modified: new Date(f.modifiedTime).toISOString(), size: f.size ? Number(f.size) : null, text, readable };
        await store.upsertDoc({ ...doc, ...classify(doc, today) });
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length || 1) }, worker));
    if (!pending) await store.removeDocs(new Set(files.map((f) => f.id)));
    lastIndex = { at: new Date().toISOString(), files: files.length, read, unchanged: skipped, failed, pending };
    return lastIndex;
  })();
  try { return await indexing; } finally { indexing = null; }
}

export function indexState() { return { ...(lastIndex || {}), background_running: backgroundRunning }; }

// Keep indexing in the background until every file has been read (large folders).
let backgroundRunning = false;
export function startBackgroundIndex(opts = {}) {
  if (backgroundRunning) return false;
  backgroundRunning = true;
  (async () => {
    try {
      for (let pass = 0; pass < 60; pass++) {
        const r = await refreshIndex({ budgetMs: 120_000, ...opts });
        if (!r.pending) break;
      }
    } catch (e) { console.error("background index", e.message); }
    finally { backgroundRunning = false; }
  })();
  return true;
}

// ---------------------------------------------------------------------------
// Search and read
// ---------------------------------------------------------------------------

const STOP = new Set("a an and are at be by for from has have how i in is it its of on or per the to was what when where which who with this that these those".split(" "));
function terms(q) { return String(q || "").toLowerCase().split(/[^a-z0-9£$€%.\-\/]+/).filter((w) => w.length > 1 && !STOP.has(w)); }

export function snippets(text, query, { max = 8, radius = 1 } = {}) {
  const t = terms(query);
  if (!t.length || !text) return [];
  const lines = text.split("\n");
  // Track locator context: current page / sheet heading
  let where = null;
  const scored = [];
  lines.forEach((line, i) => {
    const h = line.match(/^\[(Page \d+|Sheet: [^\]]+)\]$/);
    if (h) { where = h[1]; return; }
    const low = line.toLowerCase();
    let s = 0; for (const w of t) if (low.includes(w)) s += w.length > 3 ? 2 : 1;
    if (s) scored.push({ i, s, where });
  });
  scored.sort((a, b) => b.s - a.s);
  const out = []; const used = new Set();
  for (const { i, where: w } of scored) {
    if (out.length >= max) break;
    if (used.has(i)) continue;
    const from = Math.max(0, i - radius), to = Math.min(lines.length - 1, i + radius);
    for (let k = from; k <= to; k++) used.add(k);
    out.push({ location: w || `line ${i + 1}`, text: lines.slice(from, to + 1).filter((l) => !/^\[(Page|Sheet)/.test(l)).join("\n").slice(0, 900) });
  }
  return out;
}

export function sourceMapEntry(d) {
  return {
    id: d.id, name: d.name, path: d.path, link: d.link,
    covers: d.covers, last_modified: d.modified ? d.modified.slice(0, 10) : null,
    effective: d.effective || null, valid_until: d.expires || null, version: d.version || null,
    status: d.status, why: d.status_reason, readable: d.readable,
  };
}

export async function search(query, limit = 6) {
  const docs = await store.allDocs();
  const t = terms(query);
  const ranked = docs.map((d) => {
    const name = d.name.toLowerCase();
    let s = 0;
    for (const w of t) { if (name.includes(w)) s += 5; }
    const hits = snippets(d.text || "", query, { max: 3, radius: 0 });
    s += hits.length * 2;
    if (d.status === "current") s += 1;
    if (d.status === "historical") s -= 2;
    return { d, s, hits };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit);
  return ranked.map(({ d, hits }) => ({ ...sourceMapEntry(d), matches: hits }));
}

export async function readDoc(idOrName, query) {
  const docs = await store.allDocs();
  const d = docs.find((x) => x.id === idOrName) || docs.find((x) => x.name.toLowerCase() === String(idOrName).toLowerCase()) || docs.find((x) => x.name.toLowerCase().includes(String(idOrName).toLowerCase()));
  if (!d) return null;
  const base = sourceMapEntry(d);
  if (!d.text) return { ...base, note: "This file's contents couldn't be read (unsupported type, too large, or unreadable)." };
  if (query) return { ...base, matches: snippets(d.text, query, { max: 10, radius: 2 }), total_chars: d.text.length };
  return { ...base, text: d.text.slice(0, 14_000), truncated: d.text.length > 14_000, total_chars: d.text.length };
}

// ---------------------------------------------------------------------------
// Morning brief context
// ---------------------------------------------------------------------------

export function deadlines(docs, today, days = 7) {
  const end = addDays(today, days);
  const out = [];
  for (const d of docs) {
    if (!d.text || d.status === "historical") continue;
    const lines = d.text.split("\n");
    let where = null;
    lines.forEach((line, i) => {
      const h = line.match(/^\[(Page \d+|Sheet: [^\]]+)\]$/);
      if (h) { where = h[1]; return; }
      for (const dt of findDates(line)) {
        if (dt.monthOnly) continue;
        if (dt.iso >= today && dt.iso <= end) {
          out.push({ date: dt.iso, document: d.name, link: d.link, location: where || `line ${i + 1}`, text: line.trim().slice(0, 220) });
        }
      }
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 25);
}

export function priceWatch(docs, today, days = 30) {
  const soon = addDays(today, days);
  const out = [];
  for (const d of docs) {
    if (!d.covers?.some((c) => c === "price list" || c === "supplier terms" || c === "offer / promotion")) continue;
    if (d.expires && d.expires >= today && d.expires <= soon) out.push({ document: d.name, link: d.link, issue: `Validity ends ${d.expires}` });
    if (d.effective && d.effective > today && d.effective <= soon) out.push({ document: d.name, link: d.link, issue: `New pricing/terms take effect ${d.effective}` });
    if (d.status === "historical" && d.expires) out.push({ document: d.name, link: d.link, issue: `Expired ${d.expires}; don't quote from it` });
    if (!d.effective && !d.expires && !d.version) out.push({ document: d.name, link: d.link, issue: "No effective date or validity stated; confirm it's current before quoting" });
  }
  return out.slice(0, 15);
}

export async function briefContext({ now = new Date(), refresh = true } = {}) {
  let index = null;
  // Don't wait on a long background pass; the brief uses what's indexed so far and says so.
  if (refresh && !indexing && !backgroundRunning) index = await refreshIndex({ budgetMs: 20_000 });
  else index = { ...indexState(), note: "Background indexing still in progress; brief uses documents indexed so far." };
  const docs = await store.allDocs();
  const today = todayLondon(now);
  const prev = await store.lastBrief();
  const snapshot = Object.fromEntries(docs.map((d) => [d.id, { m: d.modified, n: d.name }]));

  let changes;
  if (prev) {
    const old = prev.snapshot || {};
    changes = {
      compared_with: `previous brief at ${new Date(prev.created_at).toLocaleString("en-GB", { timeZone: TZ })}`,
      added: docs.filter((d) => !old[d.id]).map((d) => ({ name: d.name, link: d.link, modified: d.modified })),
      modified: docs.filter((d) => old[d.id] && old[d.id].m !== d.modified).map((d) => ({ name: d.name, link: d.link, modified: d.modified })),
      removed: Object.entries(old).filter(([id]) => !snapshot[id]).map(([, v]) => ({ name: v.n })),
    };
  } else {
    const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
    changes = {
      compared_with: "no previous brief; showing only files Google Drive reports as modified in the last 24 hours",
      modified: docs.filter((d) => d.modified >= since).map((d) => ({ name: d.name, link: d.link, modified: d.modified })),
    };
  }
  const changedIds = new Set([...(changes.added || []), ...(changes.modified || [])].map((c) => docs.find((d) => d.name === c.name && d.link === c.link)?.id));

  // Short excerpts: priority/notes docs and anything changed, so Bernard can see what's going on.
  const FOCUS = ["notes / priorities", "notice", "offer / promotion", "price list", "supplier terms", "quotes / orders"];
  const focus = docs.filter((d) => d.text && d.status !== "historical" && (changedIds.has(d.id) || d.covers?.some((c) => FOCUS.includes(c))))
    .sort((a, b) => String(b.modified).localeCompare(String(a.modified))).slice(0, 6)
    .map((d) => ({ name: d.name, link: d.link, modified: d.modified, excerpt: d.text.slice(0, 2500) }));

  const brief = { id: randomUUID(), created_at: now.toISOString(), snapshot };
  await store.saveBrief(brief);

  return {
    brief_id: brief.id,
    date: now.toLocaleDateString("en-GB", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    time: now.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }),
    index,
    source_map: docs.map(sourceMapEntry),
    conflicts: findConflicts(docs),
    changes,
    deadlines_next_7_days: deadlines(docs, today),
    pricing_and_supplier_watch: priceWatch(docs, today),
    focus_documents: focus,
    not_connected: ["email", "calendar", "orders / stock system"],
  };
}

export async function saveBriefText(id, text) {
  const t = String(text || "").slice(0, 20_000);
  if (!t.trim()) return null;
  let row = id ? await store.updateBriefText(id, t) : null;
  if (!row) { const b = { id: randomUUID(), created_at: new Date().toISOString(), snapshot: {}, text: t }; await store.saveBrief(b); row = b; }
  return row;
}

export async function latestBrief() { return store.latestWithText(); }

await store.init();
