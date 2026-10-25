// CCP reorder list: Nicholas says "we're low on X", Bernard keeps the list (grouped by supplier),
// drafts the order email when he's ready, and nudges him on order day if anything is waiting.
import { randomUUID } from "node:crypto";

const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const clean = (s, n = 120) => String(s ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, n);
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function londonNow(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${String(+p.hour % 24).padStart(2, "0")}:${p.minute}`, wd: DAYS.indexOf(p.weekday.toLowerCase().slice(0, 3)) };
}

export function createOrders({ kv, gmail, notify, now = () => new Date(), log = console.log }) {
  const load = async (k, d) => { try { return JSON.parse((await kv.get(k)) || "null") ?? d; } catch { return d; } };
  const save = (k, v) => kv.set(k, JSON.stringify(v));
  const list = () => load("order_list", []);
  const suppliers = () => load("order_suppliers", {});
  const view = (x) => ({ id: x.id.slice(0, 8), item: x.item, qty: x.qty || undefined, supplier: x.supplier || "unassigned", note: x.note || undefined });
  const supKey = (s) => norm(s);
  const findSupplier = (all, name) => {
    const q = supKey(name);
    if (!q) return null;
    return Object.keys(all).find((k) => k === q) || Object.keys(all).find((k) => k.includes(q) || q.includes(k)) || null;
  };
  const match = (items, q) => {
    q = norm(q);
    if (!q) return [];
    const byId = items.filter((x) => x.id.startsWith(q));
    if (byId.length) return byId;
    return items.filter((x) => norm(x.item).includes(q) || q.includes(norm(x.item)));
  };

  function emailBody(items, contact) {
    const lines = items.map((x) => `- ${x.qty ? x.qty + " x " : ""}${x.item}${x.note ? ` (${x.note})` : ""}`);
    return `Hi ${contact || "there"},\n\nCould we please order the following:\n\n${lines.join("\n")}\n\nPlease let me know if anything is out of stock or on a longer lead time.\n\nThanks`;
  }

  async function handle(b) {
    const action = String(b.action || "list");
    const items = await list();

    if (action === "add") {
      const item = clean(b.item);
      if (!item) return { ok: false, error: "What needs reordering?" };
      const sups = await suppliers();
      const supplier = b.supplier ? (findSupplier(sups, b.supplier) ? sups[findSupplier(sups, b.supplier)].name : clean(b.supplier, 60)) : "";
      const existing = items.find((x) => norm(x.item) === norm(item) && norm(x.supplier) === norm(supplier));
      if (existing) {
        if (b.qty) existing.qty = clean(b.qty, 40);
        if (b.note) existing.note = clean(b.note);
        await save("order_list", items);
        return { ok: true, updated: view(existing), count: items.length };
      }
      if (items.length >= 200) return { ok: false, error: "The list is full; draft or clear some first." };
      const x = { id: randomUUID(), item, qty: clean(b.qty, 40), supplier, note: clean(b.note), added: now().toISOString() };
      items.push(x);
      await save("order_list", items);
      return { ok: true, added: view(x), count: items.length, supplier_known: supplier ? Boolean(findSupplier(sups, supplier)) : false };
    }

    if (action === "list") {
      const shown = b.supplier ? items.filter((x) => norm(x.supplier).includes(norm(b.supplier))) : items;
      const groups = {};
      for (const x of shown) (groups[x.supplier || "unassigned"] ||= []).push(view(x));
      return { ok: true, count: shown.length, by_supplier: groups };
    }

    if (action === "remove") {
      const hit = match(items, b.item || b.id);
      if (!hit.length) return { ok: false, error: "Nothing on the list matches that." };
      if (hit.length > 1) return { ok: false, error: "More than one item matches; which one?", matches: hit.map(view) };
      await save("order_list", items.filter((x) => x !== hit[0]));
      return { ok: true, removed: view(hit[0]) };
    }

    if (action === "update") {
      const hit = match(items, b.item || b.id);
      if (hit.length !== 1) return { ok: false, error: hit.length ? "More than one item matches; which one?" : "Nothing on the list matches that." };
      if (b.qty !== undefined && b.qty !== "") hit[0].qty = clean(b.qty, 40);
      if (b.note) hit[0].note = clean(b.note);
      if (b.supplier) { const sups = await suppliers(); const k = findSupplier(sups, b.supplier); hit[0].supplier = k ? sups[k].name : clean(b.supplier, 60); }
      await save("order_list", items);
      return { ok: true, updated: view(hit[0]) };
    }

    if (action === "set_supplier") {
      const name = clean(b.supplier, 60);
      if (!name) return { ok: false, error: "Which supplier?" };
      const email = clean(b.email, 120);
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "That email address doesn't look right." };
      const sups = await suppliers();
      const k = findSupplier(sups, name) || supKey(name);
      sups[k] = { name: sups[k]?.name || name, email: email || sups[k]?.email || "", contact: clean(b.contact, 60) || sups[k]?.contact || "" };
      await save("order_suppliers", sups);
      return { ok: true, supplier: sups[k] };
    }

    if (action === "suppliers") return { ok: true, suppliers: Object.values(await suppliers()) };

    if (action === "draft") {
      const sups = await suppliers();
      const k = findSupplier(sups, b.supplier);
      const name = k ? sups[k].name : clean(b.supplier, 60);
      const chosen = items.filter((x) => (name ? norm(x.supplier) === norm(name) : true));
      if (!chosen.length) return { ok: false, error: name ? `Nothing on the list for ${name}.` : "The reorder list is empty." };
      if (!name && new Set(chosen.map((x) => norm(x.supplier))).size > 1) return { ok: false, error: "The list covers several suppliers; which one should I draft?", suppliers: [...new Set(chosen.map((x) => x.supplier || "unassigned"))] };
      const to = clean(b.to, 120) || (k ? sups[k].email : "");
      if (!to) return { ok: false, error: `I don't have an email address for ${name || "this supplier"}. Tell me it and I'll save it.` };
      const d = londonNow(now());
      const r = await gmail.createDraft({ to, subject: `Order from Cory Car Paints – ${d.date.split("-").reverse().join("/")}`, body: emailBody(chosen, k ? sups[k].contact : "") });
      return { ok: true, drafted_for: name || to, to, items: chosen.length, draft: r, note: "Saved as a draft in the CCP Gmail; nothing has been sent. Once Nicholas sends it, use mark_ordered." };
    }

    if (action === "mark_ordered") {
      const name = b.supplier ? clean(b.supplier, 60) : "";
      const done = items.filter((x) => (name ? norm(x.supplier).includes(norm(name)) : true));
      if (!done.length) return { ok: false, error: "Nothing to mark as ordered." };
      const history = await load("order_history", []);
      history.push({ ordered: now().toISOString(), supplier: name || "all", items: done.map((x) => ({ item: x.item, qty: x.qty })) });
      await save("order_history", history.slice(-100));
      await save("order_list", items.filter((x) => !done.includes(x)));
      return { ok: true, cleared: done.length, remaining: items.length - done.length };
    }

    if (action === "history") {
      const history = await load("order_history", []);
      const q = norm(b.item);
      const rows = q ? history.filter((h) => h.items.some((i) => norm(i.item).includes(q))) : history;
      return { ok: true, orders: rows.slice(-10).reverse() };
    }

    if (action === "set_order_day") {
      const day = DAYS.indexOf(norm(b.day).slice(0, 3));
      if (b.day && norm(b.day) === "off") { await save("order_day", null); return { ok: true, nudge: "off" }; }
      if (day < 0) return { ok: false, error: "Which day? e.g. Thursday, or 'off'." };
      const time = /^\d{1,2}:\d{2}$/.test(String(b.time || "")) ? String(b.time).padStart(5, "0") : "09:30";
      await save("order_day", { day, time });
      return { ok: true, nudge: `${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day]}s at ${time}` };
    }

    return { ok: false, error: "Unknown action." };
  }

  // Order-day nudge: one phone notification if the list has anything on it.
  async function tick() {
    const cfg = await load("order_day", null);
    if (!cfg) return false;
    const t = londonNow(now());
    if (t.wd !== cfg.day || t.hm < cfg.time) return false;
    if ((await kv.get("order_nudged")) === t.date) return false;
    await kv.set("order_nudged", t.date);
    const items = await list();
    if (!items.length) return false;
    const sups = [...new Set(items.map((x) => x.supplier || "unassigned"))];
    await notify(`${items.length} item${items.length > 1 ? "s" : ""} on the reorder list (${sups.join(", ")}). Ask Bernard to draft the order.`, { title: "Order day", tags: "package", click: "https://bernud.onrender.com/" });
    return true;
  }

  return {
    handle,
    tick,
    async summary() { const items = await list(); return items.length ? items.map((x) => `${x.qty ? x.qty + " x " : ""}${x.item}${x.supplier ? ` (${x.supplier})` : ""}`) : []; },
    start() { const t = setInterval(() => tick().catch((e) => log("orders: " + e.message)), 60_000); t.unref?.(); },
  };
}
