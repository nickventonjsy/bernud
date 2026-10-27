// Today's priorities: the top three from the CCP morning brief plus anything Nicholas adds by voice
// ("add 'ring the accountant' to my priorities"). One list, kept in kv, ticked off from the dashboard or by voice.
// Brief items are refreshed whenever a newer brief exists; voice items stay until done and cleared, or 3 days.
import { parseItems } from "./shopping.js";

const DAY = 864e5;
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const same = (a, b) => { const x = norm(a), y = norm(b); return x === y || (x.length > 12 && y.includes(x)) || (y.length > 12 && x.includes(y)); };

export function createPriorities({ kv, now = () => new Date() }) {
  const load = async () => { try { return JSON.parse((await kv.get("priorities")) || "{}"); } catch { return {}; } };
  const save = (s) => kv.set("priorities", JSON.stringify(s));

  // Bring in the brief's items when there's a newer brief; drop stale voice items.
  function merge(state, brief) {
    const t = now().getTime();
    let items = (state.items || []).filter((i) => i.src !== "voice" || t - Date.parse(i.added) < 3 * DAY);
    if (brief && brief.from && brief.from !== state.brief_from) {
      items = items.filter((i) => i.src !== "brief");
      for (const text of brief.items || []) if (!items.some((i) => same(i.text, text))) items.push({ text, src: "brief", done: false, added: new Date(t).toISOString() });
      state.brief_from = brief.from;
    }
    state.items = items;
    return state;
  }

  async function list(brief = null) {
    const s = merge(await load(), brief);
    await save(s);
    return s.items;
  }

  const view = (items) => ({ ok: true, count: items.length, open: items.filter((i) => !i.done).length, items: items.map((i) => ({ text: i.text, done: i.done, src: i.src })) });

  async function handle({ action = "list", items = "", text = "", brief = null } = {}) {
    const s = merge(await load(), brief);
    const asked = Array.isArray(items) ? items.map(String) : parseItems(items || text);
    const find = (q) => s.items.find((i) => same(i.text, q)) || s.items.find((i) => norm(i.text).includes(norm(q)));
    if (action === "add") {
      const added = [], already = [];
      for (const q of asked) { const x = q.replace(/^(to )?/i, "").trim().slice(0, 90); if (!x) continue; if (find(x)) already.push(x); else { s.items.push({ text: x, src: "voice", done: false, added: now().toISOString() }); added.push(x); } }
      await save(s);
      return { ...view(s.items), added, already };
    }
    if (action === "done" || action === "undone") {
      const changed = [], not_found = [];
      for (const q of asked) { const it = find(q); if (it) { it.done = action === "done"; changed.push(it.text); } else not_found.push(q); }
      await save(s);
      return { ...view(s.items), [action]: changed, not_found };
    }
    if (action === "remove") {
      const removed = [], not_found = [];
      for (const q of asked) { const it = find(q); if (it) { s.items.splice(s.items.indexOf(it), 1); removed.push(it.text); } else not_found.push(q); }
      await save(s);
      return { ...view(s.items), removed, not_found };
    }
    if (action === "clear") { const n = s.items.length; s.items = []; await save(s); return { ok: true, cleared: n, count: 0, open: 0, items: [] }; }
    const v = view(s.items);
    await save(s);
    if (!v.count) return { ...v, message: "No priorities today. Nothing from the brief yet, and he hasn't added any." };
    return { ...v, message: `${v.open} open: ${s.items.filter((i) => !i.done).map((i) => i.text).join("; ")}${v.count > v.open ? `. Done: ${s.items.filter((i) => i.done).map((i) => i.text).join("; ")}` : ""}` };
  }

  return { handle, list };
}
