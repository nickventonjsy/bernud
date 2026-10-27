// Receipts: Nicholas photographs a shop receipt (Bernard app or Telegram), Bernard reads it, files the photo in
// his personal Google Drive ("Bernard Receipts") and keeps the figures, so he can say what's been spent and what
// gets bought regularly. The total is the figure to trust; item lines are best-effort from the photo.
const SYSTEM = `You read a photo of a shop receipt and return JSON only:
{"is_receipt": true, "shop": "Waitrose", "date": "2026-10-27", "time": "17:42", "total": 64.20, "currency": "GBP",
 "items": [{"name": "Semi skimmed milk 2L", "qty": 1, "price": 1.45}], "payment": "card", "confidence": "high", "notes": ""}
Rules: shop is the trading name as printed (short). date is ISO (YYYY-MM-DD) if printed, else null. total is the amount actually paid
after discounts and vouchers (the "TOTAL" / "Amount due" / card line), as a number. items: one entry per line bought, with the printed
price for that line (quantity × unit price); skip subtotals, savings lines, loyalty points and VAT lines; at most 80 items.
confidence: "high" if the total and shop are clearly legible, "medium" if partly, "low" if guessing. notes: anything you couldn't read.
If the photo is not a receipt at all, return {"is_receipt": false, "notes": "what it shows instead"}.`;

const DAY = 864e5;
const londonDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);
const monthOf = (day) => String(day || "").slice(0, 7);
const gbp = (n) => "£" + Number(n || 0).toFixed(2);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthName = (ym) => { const [y, m] = String(ym).split("-").map(Number); return `${MONTHS[(m || 1) - 1]} ${y}`; };
const norm = (s) => String(s || "").toLowerCase().replace(/\b\d+(\.\d+)?\s*(ml|l|g|kg|x|pk|pack)\b/g, "").replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();

export function parseReceipt(raw) {
  const m = String(raw || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j; try { j = JSON.parse(m[0]); } catch { return null; }
  if (j.is_receipt === false) return { is_receipt: false, notes: String(j.notes || "").slice(0, 200) };
  const total = Number(j.total);
  if (!Number.isFinite(total) || total < 0) return null;
  const items = (Array.isArray(j.items) ? j.items : []).map((i) => ({ name: String(i.name || "").trim().slice(0, 60), qty: Number(i.qty) > 0 ? Number(i.qty) : 1, price: Number.isFinite(Number(i.price)) ? Math.round(Number(i.price) * 100) / 100 : null })).filter((i) => i.name).slice(0, 80);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(j.date || "")) ? j.date : null;
  return { is_receipt: true, shop: String(j.shop || "Unknown shop").trim().slice(0, 40), date, time: String(j.time || "").slice(0, 5), total: Math.round(total * 100) / 100, currency: String(j.currency || "GBP").slice(0, 3), items, payment: String(j.payment || "").slice(0, 20), confidence: ["high", "medium", "low"].includes(j.confidence) ? j.confidence : "medium", notes: String(j.notes || "").slice(0, 200) };
}

// Which month a question means: "this month" (default), "last month", "September", "2026-09".
export function monthFor(text, now = new Date()) {
  const t = String(text || "").toLowerCase().trim();
  const cur = londonDay(now).slice(0, 7);
  if (!t || /\bthis month\b|\bso far\b/.test(t)) return cur;
  if (/\blast month\b|\bprevious month\b/.test(t)) { const [y, m] = cur.split("-").map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return d.toISOString().slice(0, 7); }
  if (/^\d{4}-\d{2}$/.test(t)) return t;
  const idx = MONTHS.findIndex((m) => t.includes(m.toLowerCase()));
  if (idx >= 0) { const [y, m] = cur.split("-").map(Number); const year = (idx + 1) <= m ? y : y - 1; return `${year}-${String(idx + 1).padStart(2, "0")}`; }
  return cur;
}

export function createReceipts({ kv, vision, drive = null, now = () => new Date(), log = console, max = 600 }) {
  const load = async () => { try { return JSON.parse((await kv.get("receipts")) || "[]"); } catch { return []; } };
  const save = (l) => kv.set("receipts", JSON.stringify(l.slice(-max)));

  // Read a photo, file it, keep the figures. via: "phone" | "telegram" | "dashboard".
  async function ingest({ data, mime = "image/jpeg", note = "", via = "", by = "" }) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "base64");
    if (buf.length > 12 * 1024 * 1024) return { ok: false, message: "That photo is too big. Try a smaller one." };
    const raw = await vision({ system: SYSTEM, text: "Read this receipt." + (note ? ` Nicholas added: "${String(note).slice(0, 200)}"` : ""), image: { mime, data: buf.toString("base64") } });
    const r = parseReceipt(raw);
    if (!r) return { ok: false, message: "I couldn't make out a receipt in that photo. Try again with the whole receipt flat and in good light." };
    if (!r.is_receipt) return { ok: false, not_receipt: true, message: `That doesn't look like a receipt${r.notes ? ` (${r.notes})` : ""}. Nothing saved.` };
    const t = now();
    const rec = { id: t.getTime().toString(36), created: t.toISOString(), day: r.date || londonDay(t), shop: r.shop, total: r.total, currency: r.currency, items: r.items, payment: r.payment, confidence: r.confidence, notes: r.notes, via, by: String(by || "").slice(0, 30), photo: null };
    // The photo goes to Drive when the personal account allows it; the figures are kept regardless.
    let drive_error = null;
    if (drive) {
      try { const up = await drive.uploadFile({ name: `${rec.day} ${rec.shop} ${gbp(rec.total)}.jpg`, mime, data: buf, folder: "Bernard Receipts" }); rec.photo = up.link; rec.folder = up.folder_link; }
      catch (e) { drive_error = e.code === "needs_permission" || e.code === "not_connected" ? "Drive isn't connected for receipts yet (reconnect the personal Google account in Settings)" : String(e.message).slice(0, 120); log.error?.("receipt drive", drive_error); }
    }
    const list = await load();
    // The same receipt twice (same shop, day and total within a minute's re-send) is kept once.
    const dup = list.find((x) => x.shop === rec.shop && x.day === rec.day && x.total === rec.total && t.getTime() - Date.parse(x.created) < 10 * 60e3);
    if (dup) return { ok: true, duplicate: true, receipt: dup, message: `I've already got that one: ${dup.shop}, ${gbp(dup.total)}.` };
    list.push(rec); await save(list);
    const month = await summary({ month: monthOf(rec.day) });
    const conf = rec.confidence === "low" ? " I wasn't sure of the figures, so check them." : rec.confidence === "medium" ? " Worth a glance at the total." : "";
    return { ok: true, receipt: rec, drive_error, month_total: month.total, message: `${rec.shop}, ${gbp(rec.total)}, ${rec.items.length} item${rec.items.length === 1 ? "" : "s"}${rec.day !== londonDay(t) ? ` (dated ${rec.day})` : ""}. Saved.${conf} That's ${gbp(month.total)} on ${monthName(monthOf(rec.day))} so far.${drive_error ? " The photo wasn't filed: " + drive_error + "." : ""}` };
  }

  async function summary({ month = null, shop = "" } = {}) {
    const ym = month || londonDay(now()).slice(0, 7);
    const list = (await load()).filter((r) => monthOf(r.day) === ym && (!shop || norm(r.shop).includes(norm(shop))));
    const by = {};
    for (const r of list) { const b = (by[r.shop] ||= { shop: r.shop, total: 0, visits: 0 }); b.total += r.total; b.visits++; }
    const shops = Object.values(by).map((b) => ({ ...b, total: Math.round(b.total * 100) / 100 })).sort((a, b) => b.total - a.total);
    return { month: ym, month_name: monthName(ym), total: Math.round(list.reduce((s, r) => s + r.total, 0) * 100) / 100, receipts: list.length, shops };
  }

  // Things bought on two or more different days in the last 90 days, with how often, so Bernard can guess what's running low.
  async function usual({ days = 90, limit = 25 } = {}) {
    const t = now().getTime();
    const list = (await load()).filter((r) => t - Date.parse(r.day + "T12:00:00Z") < days * DAY);
    const seen = {};
    for (const r of list) for (const i of r.items) { const k = norm(i.name); if (!k) continue; const s = (seen[k] ||= { name: i.name, days: new Set(), last: "" }); s.days.add(r.day); if (r.day > s.last) s.last = r.day; }
    const out = [];
    for (const s of Object.values(seen)) {
      if (s.days.size < 2) continue;
      const ds = [...s.days].sort(); const span = (Date.parse(ds.at(-1)) - Date.parse(ds[0])) / DAY;
      const every = Math.max(1, Math.round(span / (ds.length - 1)));
      const since = Math.round((t - Date.parse(s.last + "T12:00:00Z")) / DAY);
      out.push({ name: s.name, times: ds.length, every_days: every, last: s.last, days_since: since, due: since >= every });
    }
    return out.sort((a, b) => (b.due - a.due) || (b.times - a.times)).slice(0, limit);
  }

  async function handle({ action = "summary", month = "", shop = "", query = "", limit = 8 } = {}) {
    if (action === "summary" || action === "month") {
      const ym = monthFor(month, now()), s = await summary({ month: ym, shop });
      if (!s.receipts) return { ok: true, ...s, message: `No receipts for ${s.month_name}${shop ? ` from ${shop}` : ""}.` };
      const prevYm = monthFor("last month", new Date(Date.parse(ym + "-15T12:00:00Z"))); const prev = await summary({ month: prevYm, shop });
      return { ok: true, ...s, previous: { month: prevYm, total: prev.total, receipts: prev.receipts }, message: `${gbp(s.total)} across ${s.receipts} receipt${s.receipts === 1 ? "" : "s"} in ${s.month_name}${shop ? ` at ${shop}` : ""}: ${s.shops.slice(0, 5).map((b) => `${b.shop} ${gbp(b.total)} (${b.visits})`).join(", ")}.${prev.receipts ? ` ${monthName(prevYm)} was ${gbp(prev.total)}.` : ""}` };
    }
    if (action === "list") {
      const list = (await load()).filter((r) => !shop || norm(r.shop).includes(norm(shop))).slice(-Math.min(Number(limit) || 8, 30)).reverse();
      return { ok: true, count: list.length, receipts: list.map((r) => ({ id: r.id, day: r.day, shop: r.shop, total: r.total, items: r.items.length, photo: r.photo })), message: list.length ? list.map((r) => `${r.day} ${r.shop} ${gbp(r.total)}`).join("; ") : "No receipts saved yet." };
    }
    if (action === "receipt") {
      // One receipt in detail: by shop and/or date words ("Saturday", "2026-10-25"), else the latest.
      const list = (await load()).reverse();
      const q = String(query || shop || "").toLowerCase();
      const iso = (q.match(/\d{4}-\d{2}-\d{2}/) || [])[0];
      const r = list.find((x) => (!iso || x.day === iso) && (!q || norm(x.shop).includes(norm(q.replace(iso || "", ""))) || !!iso)) || list[0];
      if (!r) return { ok: true, message: "No receipts saved yet." };
      return { ok: true, receipt: r, message: `${r.shop} on ${r.day}, ${gbp(r.total)}: ${r.items.map((i) => i.name + (i.price != null ? ` ${gbp(i.price)}` : "")).join(", ") || "no item lines read"}.${r.photo ? " The photo is in Drive." : ""}` };
    }
    if (action === "usual") {
      const u = await usual();
      if (!u.length) return { ok: true, items: [], message: "Not enough receipts yet to know what he buys regularly (it needs the same thing on two different days)." };
      const due = u.filter((i) => i.due);
      return { ok: true, items: u, message: (due.length ? `Probably running low: ${due.slice(0, 10).map((i) => i.name).join(", ")}. ` : "Nothing obviously due. ") + `Bought regularly: ${u.slice(0, 10).map((i) => `${i.name} (about every ${i.every_days} days)`).join(", ")}.` };
    }
    if (action === "delete_last") {
      const list = await load(); const r = list.pop(); await save(list);
      return r ? { ok: true, deleted: { day: r.day, shop: r.shop, total: r.total }, message: `Removed ${r.shop}, ${gbp(r.total)} from ${r.day}.` } : { ok: true, message: "Nothing to remove." };
    }
    return { ok: false, message: "Unknown action." };
  }

  // For the dashboard panel.
  async function dash() {
    const cur = await summary(), prev = await summary({ month: monthFor("last month", now()) });
    const recent = (await load()).slice(-8).reverse().map((r) => ({ id: r.id, day: r.day, shop: r.shop, total: r.total, items: r.items.length, photo: r.photo, by: r.by || "" }));
    return { month: cur, previous: prev, recent };
  }
  // One receipt in full, for the dashboard's receipt window.
  async function get(id) { return (await load()).find((r) => r.id === id) || null; }

  return { ingest, handle, summary, usual, dash, get };
}
