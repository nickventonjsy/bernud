// Bernud's backend: long-term memory and news headlines.
// Called by the Bernud ElevenLabs agent through webhook tools.
// No framework; Node 20+ built-ins only, plus `pg` when DATABASE_URL is set.

import http from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT || 10000);
const API_KEY = process.env.BERNUD_KEY || "";
const DATABASE_URL = process.env.DATABASE_URL || "";

// ---------------------------------------------------------------------------
// Storage: Postgres in production, in-memory for local testing.
// ---------------------------------------------------------------------------

function memoryStore() {
  const rows = [];
  return {
    kind: "memory",
    async init() {},
    async save(text, category) {
      const row = { id: randomUUID(), text, category, created_at: new Date().toISOString() };
      rows.push(row);
      return row;
    },
    async all() { return [...rows].reverse(); },
    async remove(id) {
      const i = rows.findIndex((r) => r.id === id);
      if (i === -1) return null;
      return rows.splice(i, 1)[0];
    },
  };
}

async function postgresStore(url) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url, ssl: url.includes("render.com") ? { rejectUnauthorized: false } : undefined, max: 5 });
  return {
    kind: "postgres",
    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS memories (
          id UUID PRIMARY KEY,
          text TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'general',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
    },
    async save(text, category) {
      const { rows } = await pool.query(
        "INSERT INTO memories (id, text, category) VALUES ($1, $2, $3) RETURNING id, text, category, created_at",
        [randomUUID(), text, category],
      );
      return rows[0];
    },
    async all() {
      const { rows } = await pool.query("SELECT id, text, category, created_at FROM memories ORDER BY created_at DESC LIMIT 2000");
      return rows;
    },
    async remove(id) {
      const { rows } = await pool.query("DELETE FROM memories WHERE id = $1 RETURNING id, text, category, created_at", [id]);
      return rows[0] || null;
    },
  };
}

const db = DATABASE_URL ? await postgresStore(DATABASE_URL) : memoryStore();

// ---------------------------------------------------------------------------
// Memory search: simple keyword scoring, good enough for a personal list.
// ---------------------------------------------------------------------------

const STOP = new Set("a an and are at be did do does for from have how i in is it me my of on or remember the to was what when where which who why with you your about".split(" "));

export function tokens(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9£$%.'\s-]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, "").replace(/'s$/, ""))
    .filter((w) => w.length > 1 && !STOP.has(w));
}

export function rank(rows, query, limit = 8) {
  const q = tokens(query);
  if (!q.length) return rows.slice(0, limit);
  return rows
    .map((r) => {
      const t = tokens(r.text + " " + r.category);
      let score = 0;
      for (const w of q) {
        if (t.includes(w)) score += 2;
        else if (t.some((x) => x.startsWith(w) || w.startsWith(x))) score += 1;
      }
      return { r, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || String(b.r.created_at).localeCompare(String(a.r.created_at)))
    .slice(0, limit)
    .map((x) => x.r);
}

function present(r) {
  const d = new Date(r.created_at);
  return {
    id: r.id,
    text: r.text,
    category: r.category,
    saved: d.toLocaleString("en-GB", { timeZone: "Europe/Jersey", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
  };
}

// ---------------------------------------------------------------------------
// News: RSS headlines, cached for 10 minutes per topic.
// ---------------------------------------------------------------------------

export const FEEDS = {
  uk: ["https://feeds.bbci.co.uk/news/uk/rss.xml"],
  world: ["https://feeds.bbci.co.uk/news/world/rss.xml"],
  business: ["https://feeds.bbci.co.uk/news/business/rss.xml"],
  tech: ["https://feeds.bbci.co.uk/news/technology/rss.xml"],
  crypto: ["https://www.coindesk.com/arc/outboundfeeds/rss/", "https://cointelegraph.com/rss"],
  jersey: ["https://feeds.bbci.co.uk/news/world/europe/jersey/rss.xml", "https://jerseyeveningpost.com/feed/"],
  sport: ["https://feeds.bbci.co.uk/sport/rss.xml"],
  f1: ["https://feeds.bbci.co.uk/sport/formula1/rss.xml"],
};

function decode(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&#8217;|&rsquo;/g, "'")
    .replace(/&#8216;|&lsquo;/g, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#8211;|&ndash;/g, "-").replace(/&#8212;|&mdash;/g, "-").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]) : "";
}

export function parseRss(xml, source) {
  const items = [];
  for (const m of String(xml).matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const b = m[0];
    const title = tag(b, "title");
    if (!title) continue;
    const summary = tag(b, "description").slice(0, 240);
    const pub = tag(b, "pubDate") || tag(b, "dc:date");
    const t = pub ? Date.parse(pub) : NaN;
    items.push({ title, summary, source, published: Number.isNaN(t) ? null : new Date(t).toISOString() });
  }
  return items;
}

function sourceName(url) {
  if (url.includes("bbc")) return "BBC";
  if (url.includes("coindesk")) return "CoinDesk";
  if (url.includes("cointelegraph")) return "Cointelegraph";
  if (url.includes("jerseyeveningpost")) return "Jersey Evening Post";
  return new URL(url).hostname;
}

const newsCache = new Map();

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "BernudAssistant/1.0 (+https://bernud.onrender.com)" } });
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function headlines(topic, limit) {
  const cached = newsCache.get(topic);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.items.slice(0, limit);
  const results = await Promise.allSettled(FEEDS[topic].map(async (u) => parseRss(await fetchText(u), sourceName(u))));
  const all = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const seen = new Set();
  const items = all
    .sort((a, b) => String(b.published).localeCompare(String(a.published)))
    .filter((i) => { const k = i.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  if (items.length) newsCache.set(topic, { at: Date.now(), items });
  return items.slice(0, limit);
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const PUBLIC_ORIGINS = new Set(["https://bernud.onrender.com"]);

function send(res, status, body, req) {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  const origin = req && req.headers.origin;
  if (origin && (PUBLIC_ORIGINS.has(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin))) {
    headers["access-control-allow-origin"] = origin;
    headers["vary"] = "origin";
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 20000) throw Object.assign(new Error("too large"), { status: 413 });
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error("invalid JSON"), { status: 400 }); }
}

export async function handle(req, res) {
  const url = new URL(req.url, "http://x");
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path === "/" || path === "/health") return send(res, 200, { ok: true, service: "bernud", storage: db.kind }, req);

  // Headlines are public information, so the dashboard can show them without the secret key.
  if (req.method === "GET" && path === "/public/news") {
    const topic = String(url.searchParams.get("topic") || "uk").toLowerCase();
    if (!FEEDS[topic]) return send(res, 400, { error: "unknown topic" }, req);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 4, 1), 8);
    try {
      const items = await headlines(topic, limit);
      return send(res, 200, { topic, headlines: items.map(({ title, source, published }) => ({ title, source, published })) }, req);
    } catch {
      return send(res, 200, { topic, headlines: [] }, req);
    }
  }

  if (!API_KEY || req.headers["x-bernud-key"] !== API_KEY) return send(res, 401, { error: "unauthorised" });

  try {
    if (req.method === "POST" && path === "/memory/save") {
      const body = await readJson(req);
      const text = String(body.text || "").trim().slice(0, 1000);
      const category = String(body.category || "general").trim().toLowerCase().slice(0, 40) || "general";
      if (!text) return send(res, 400, { error: "text is required" });
      const row = await db.save(text, category);
      return send(res, 200, { saved: true, memory: present(row) });
    }

    if (req.method === "GET" && path === "/memory/search") {
      const q = url.searchParams.get("query") || url.searchParams.get("q") || "";
      const rows = await db.all();
      const found = rank(rows, q, 8).map(present);
      return send(res, 200, { query: q, count: found.length, total_memories: rows.length, memories: found,
        note: found.length ? undefined : (rows.length ? "Nothing saved matches that." : "No memories saved yet.") });
    }

    if (req.method === "POST" && path === "/memory/forget") {
      const body = await readJson(req);
      const rows = await db.all();
      let target = null;
      if (body.id) target = rows.find((r) => r.id === body.id) || null;
      else if (body.query) target = rank(rows, body.query, 1)[0] || null;
      if (!target) return send(res, 200, { forgotten: false, note: "No matching memory found." });
      const removed = await db.remove(target.id);
      return send(res, 200, { forgotten: Boolean(removed), memory: removed ? present(removed) : null });
    }

    if (req.method === "GET" && path === "/news") {
      const topic = String(url.searchParams.get("topic") || "uk").toLowerCase();
      if (!FEEDS[topic]) return send(res, 400, { error: `Unknown topic. Use one of: ${Object.keys(FEEDS).join(", ")}` });
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 5, 1), 10);
      const items = await headlines(topic, limit);
      if (!items.length) return send(res, 200, { topic, headlines: [], note: "Couldn't fetch headlines right now." });
      return send(res, 200, { topic, headlines: items });
    }

    return send(res, 404, { error: "not found" });
  } catch (err) {
    console.error(err);
    return send(res, err.status || 500, { error: err.status ? err.message : "server error" });
  }
}

await db.init();

if (process.env.NODE_ENV !== "test") {
  http.createServer((req, res) => { handle(req, res); }).listen(PORT, () => {
    console.log(`Bernud backend listening on ${PORT} (storage: ${db.kind}${API_KEY ? "" : ", WARNING: BERNUD_KEY not set"})`);
  });
}
