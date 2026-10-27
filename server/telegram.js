// Bernard on Telegram: text him from anywhere, get the shopping list with tick-off buttons, and get his alerts.
// Uses long polling (no webhook to set up). Only chats linked with the code from the dashboard can use him.
import { randomInt } from "node:crypto";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const chunks = (t, n = 3900) => { const out = []; t = String(t || ""); while (t.length > n) { let i = t.lastIndexOf("\n", n); if (i < n / 2) i = n; out.push(t.slice(0, i)); t = t.slice(i); } if (t.trim()) out.push(t); return out; };

// transcribe(buffer, mime) -> text; speak(text) -> { mp3: Buffer } or null. Both optional.
export function createTelegram({ token, kv, chat, shopping, transcribe = null, speak = null, log = console, fetchImpl = fetch }) {
  const base = `https://api.telegram.org/bot${token}`;
  let me = null, running = false, lastError = null;

  async function api(method, body = {}, timeoutMs = 15_000) {
    const r = await fetchImpl(`${base}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw Object.assign(new Error(j.description || `Telegram ${method} failed (${r.status})`), { status: r.status });
    return j.result;
  }

  // ---- who may use him ----
  const getChats = async () => { try { return JSON.parse((await kv.get("tg_chats")) || "[]"); } catch { return []; } };
  const setChats = (c) => kv.set("tg_chats", JSON.stringify(c));
  async function linkCode() {
    let c = await kv.get("tg_link_code");
    if (!c) { c = String(randomInt(100000, 1000000)); await kv.set("tg_link_code", c); }
    return c;
  }

  // Multipart call (files): fields are strings, files are { name, data: Buffer, type }.
  async function apiForm(method, fields, files, timeoutMs = 30_000) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) fd.append(k, typeof v === "string" ? v : JSON.stringify(v));
    for (const [k, f] of Object.entries(files)) fd.append(k, new Blob([f.data], { type: f.type }), f.name);
    const r = await fetchImpl(`${base}/${method}`, { method: "POST", body: fd, signal: AbortSignal.timeout(timeoutMs) });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw Object.assign(new Error(j.description || `Telegram ${method} failed (${r.status})`), { status: r.status });
    return j.result;
  }
  async function download(fileId) {
    const f = await api("getFile", { file_id: fileId });
    const r = await fetchImpl(`https://api.telegram.org/file/bot${token}/${f.file_path}`, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error("Telegram file download failed " + r.status);
    return Buffer.from(await r.arrayBuffer());
  }

  // ---- sending ----
  async function say(chatId, text, extra = {}) {
    for (const part of chunks(text)) await api("sendMessage", { chat_id: chatId, text: part, disable_web_page_preview: true, ...extra });
  }

  function listMessage(list) {
    if (!list.count) return { text: "🛒 The shopping list is empty.", reply_markup: { inline_keyboard: [] } };
    const lines = list.by_aisle.map((g) => `<b>${esc(g.aisle)}</b>\n${g.items.map((i) => "• " + esc(i)).join("\n")}`).join("\n\n");
    const buttons = list.by_aisle.flatMap((g) => g.items).map((i) => [{ text: "✅ " + i.slice(0, 40), callback_data: ("got:" + i).slice(0, 60) }]);
    buttons.push([{ text: "🔄 Refresh", callback_data: "refresh" }, { text: "🗑 Clear all", callback_data: "clear?" }]);
    return { text: `🛒 <b>Shopping list (${list.count})</b>\nTap an item when it's in the trolley.\n\n${lines}`, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } };
  }

  // The shopping list with tick-off buttons, to every linked chat (or one).
  async function sendList(only = null) {
    const chats = only ? [{ id: only }] : await getChats();
    if (!chats.length) return { sent: 0 };
    const m = listMessage(await shopping.handle({ action: "list" }));
    let sent = 0;
    for (const c of chats) { try { await api("sendMessage", { chat_id: c.id, ...m }); sent++; } catch (e) { log.error?.("telegram list", e.message); } }
    return { sent };
  }

  // Alerts (morning brief, watchdog, reminders, camera…) go to the first linked chat: Nicholas.
  // A camera picture is sent as a photo with the text as its caption; a link goes on the end.
  async function alert(text, { title = "", click = "", photo = "" } = {}) {
    const owner = (await getChats())[0];
    if (!owner || !token) return false;
    const body = (title ? `<b>${esc(title)}</b>\n` : "") + esc(text) + (click ? `\n<a href="${esc(click)}">Open</a>` : "");
    try {
      if (photo && body.length <= 1000) { try { await api("sendPhoto", { chat_id: owner.id, photo, caption: body, parse_mode: "HTML" }); return true; } catch (e) { log.error?.("telegram photo", e.message); } }
      await say(owner.id, body, { parse_mode: "HTML" }); return true;
    } catch (e) { log.error?.("telegram alert", e.message); return false; }
  }

  // ---- receiving ----
  async function onMessage(m) {
    const id = m.chat?.id;
    let text = String(m.text || "").trim();
    const voiceIn = m.voice || m.audio || null;
    if (!id || (!text && !voiceIn)) return;
    const chats = await getChats();
    const linked = chats.find((c) => c.id === id);
    if (voiceIn && linked) {
      if (!transcribe) return say(id, "I can't listen to voice notes yet; type it for me.");
      try {
        api("sendChatAction", { chat_id: id, action: "typing" }).catch(() => {});
        text = String(await transcribe(await download(voiceIn.file_id), voiceIn.mime_type || "audio/ogg") || "").trim();
      } catch (e) { log.error?.("telegram transcribe", e.message); return say(id, "I couldn't make out that voice note. Try again, or type it."); }
      if (!text) return say(id, "I couldn't hear anything in that voice note.");
    }
    if (!text) return;
    if (!linked) {
      if (text.replace(/\D/g, "") === (await linkCode())) {
        const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ") || m.chat.username || "someone";
        chats.push({ id, name, at: new Date().toISOString() }); await setChats(chats);
        await kv.set("tg_link_code", "");   // a fresh code next time
        return say(id, `Linked. Good to meet you here, ${chats.length === 1 ? "Nicholas" : m.from?.first_name || "there"}. Text me anything you'd ask me out loud, or send /list for the shopping list.`);
      }
      return say(id, "Hello. I'm Bernard, a private assistant. This chat isn't linked: send the 6-digit code shown in Bernard's dashboard settings.");
    }
    if (/^\/(start|help)\b/i.test(text)) return say(id, "Text me as you'd talk to me: \"we need milk\", \"lights off\", \"what's the weather\".\n/list shows the shopping list with tick-off buttons.");
    if (/^\/list\b|^(?:show|send)(?: me)?(?: the)? shopping list\??$|^shopping list\??$/i.test(text)) return sendList(id);
    api("sendChatAction", { chat_id: id, action: "typing" }).catch(() => {});
    let reply;
    try { reply = (await chat({ session: "tg-" + id, text })).reply; }
    catch (e) { reply = "Sorry, that didn't work: " + String(e.message).slice(0, 150); }
    reply = reply || "Done.";
    // A voice note gets a voice note back (with the words as the caption), when a voice is available.
    if (voiceIn && speak) {
      try {
        const v = await speak(reply);
        if (v?.mp3) { await apiForm("sendVoice", { chat_id: String(id), caption: `🎙 ${text}\n\n${reply}`.slice(0, 1024) }, { voice: { name: "bernard.mp3", data: v.mp3, type: "audio/mpeg" } }); return; }
      } catch (e) { log.error?.("telegram voice reply", e.message); }
    }
    await say(id, (voiceIn ? `🎙 ${text}\n\n` : "") + reply);
  }

  async function onButton(q) {
    const id = q.message?.chat?.id, data = String(q.data || "");
    if (!(await getChats()).some((c) => c.id === id)) return api("answerCallbackQuery", { callback_query_id: q.id, text: "Not linked." });
    let note = "";
    if (data.startsWith("got:")) { const r = await shopping.handle({ action: "remove", items: [data.slice(4)] }); note = r.removed?.length ? `Got ${r.removed[0]}` : "Already gone"; }
    else if (data === "clear?") {
      await api("answerCallbackQuery", { callback_query_id: q.id });
      return api("editMessageReplyMarkup", { chat_id: id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [[{ text: "Yes, clear the whole list", callback_data: "clear!" }], [{ text: "No, keep it", callback_data: "refresh" }]] } }).catch(() => {});
    }
    else if (data === "clear!") { await shopping.handle({ action: "clear" }); note = "List cleared"; }
    const m = listMessage(await shopping.handle({ action: "list" }));
    await api("editMessageText", { chat_id: id, message_id: q.message.message_id, ...m }).catch(() => {});   // "not modified" is fine
    await api("answerCallbackQuery", { callback_query_id: q.id, text: note || undefined }).catch(() => {});
  }

  async function loop() {
    let offset = Number(await kv.get("tg_offset")) || 0;
    while (running) {
      try {
        const updates = await api("getUpdates", { offset, timeout: 50, allowed_updates: ["message", "callback_query"] }, 65_000);
        lastError = null;
        for (const u of updates) {
          offset = u.update_id + 1;
          try { if (u.message) await onMessage(u.message); else if (u.callback_query) await onButton(u.callback_query); }
          catch (e) { log.error?.("telegram update", e.message); }
        }
        if (updates.length) await kv.set("tg_offset", String(offset));
      } catch (e) {
        lastError = e.message;
        // 409 = another copy of the server is polling (during a deploy): back off and let it finish.
        await new Promise((r) => setTimeout(r, e.status === 409 ? 15_000 : 5_000));
      }
    }
  }

  return {
    configured: Boolean(token),
    alert, sendList,
    stop() { running = false; },
    async start() {
      if (!token || running) return;
      try { me = await api("getMe"); await api("deleteWebhook", {}).catch(() => {}); }
      catch (e) { lastError = e.message; log.error?.("telegram start", e.message); return; }
      running = true; loop();
      log.log?.(`telegram: polling as @${me.username}`);
    },
    async status() {
      const chats = await getChats();
      return { configured: Boolean(token), running, bot: me ? "@" + me.username : null, link: me ? `https://t.me/${me.username}` : null, linked: chats.map((c) => ({ id: c.id, name: c.name })), link_code: token ? await linkCode() : null, error: lastError };
    },
    async unlink(chatId) { const c = (await getChats()).filter((x) => String(x.id) !== String(chatId)); await setChats(c); return { ok: true, linked: c.length }; },
  };
}
