// "Tell Claude…": change requests Nicholas gives Bernard by voice or text, kept for the next Claude session.
// Bernard can't reach Claude himself; this is the in-tray. The dashboard shows the open ones with a copy button,
// so Nicholas can paste them into a chat with Claude in one go, and ticks them off when they're done.
const MAX = 200;

export function createRequests({ kv, now = () => new Date() }) {
  const load = async () => { try { return JSON.parse((await kv.get("claude_requests")) || "[]"); } catch { return []; } };
  const save = (l) => kv.set("claude_requests", JSON.stringify(l.slice(-MAX)));
  const open = (l) => l.filter((r) => r.status === "open");

  async function handle({ action = "list", text = "", id = "", via = "" } = {}) {
    const list = await load();
    if (action === "add") {
      text = String(text || "").trim().replace(/\s+/g, " ").slice(0, 600);
      if (text.length < 4) return { ok: false, message: "Tell me what to pass on, in a sentence." };
      const dup = open(list).find((r) => r.text.toLowerCase() === text.toLowerCase());
      if (dup) return { ok: true, duplicate: true, id: dup.id, open: open(list).length, message: "That's already on the list for Claude." };
      const r = { id: now().getTime().toString(36), text, created: now().toISOString(), status: "open", via: String(via || "").slice(0, 12) };
      list.push(r); await save(list);
      return { ok: true, id: r.id, open: open(list).length, message: `Noted for Claude: "${text}". ${open(list).length === 1 ? "It's the only thing on the list" : `That's ${open(list).length} things waiting`}; Nicholas passes the list to Claude from the dashboard (the "For Claude" panel has a copy button).` };
    }
    if (action === "done" || action === "remove") {
      const r = list.find((x) => x.id === id) || (text ? open(list).find((x) => x.text.toLowerCase().includes(String(text).toLowerCase())) : open(list).at(-1));
      if (!r) return { ok: false, message: "I can't find that one." };
      if (action === "remove") list.splice(list.indexOf(r), 1); else { r.status = "done"; r.done_at = now().toISOString(); }
      await save(list);
      return { ok: true, [action === "remove" ? "removed" : "done"]: r.text, open: open(list).length };
    }
    if (action === "clear_done") { const n = list.filter((r) => r.status === "done").length; await save(list.filter((r) => r.status !== "done")); return { ok: true, cleared: n }; }
    const o = open(list);
    return { ok: true, open: o.length, requests: o.map((r) => ({ id: r.id, text: r.text, created: r.created, via: r.via })), done: list.filter((r) => r.status === "done").slice(-10).reverse().map((r) => ({ id: r.id, text: r.text, done_at: r.done_at })),
      message: o.length ? `${o.length} waiting for Claude: ${o.map((r, i) => `${i + 1}. ${r.text}`).join(" ")}` : "Nothing waiting for Claude." };
  }

  // Plain text for pasting into a chat with Claude.
  async function asText() {
    const o = open(await load());
    if (!o.length) return "";
    return `Requests I gave Bernard for you (${o.length}):\n` + o.map((r, i) => `${i + 1}. ${r.text}  (${r.created.slice(0, 10)}${r.via ? ", by " + r.via : ""})`).join("\n");
  }

  return { handle, asText };
}
