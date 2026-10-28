// Bernard on Telegram: text him from anywhere, get the shopping list with tick-off buttons, and get his alerts.
// Uses long polling (no webhook to set up). Only chats linked with the code from the dashboard can use him.
import { randomInt } from "node:crypto";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const chunks = (t, n = 3900) => { const out = []; t = String(t || ""); while (t.length > n) { let i = t.lastIndexOf("\n", n); if (i < n / 2) i = n; out.push(t.slice(0, i)); t = t.slice(i); } if (t.trim()) out.push(t); return out; };

// transcribe(buffer, mime) -> text; speak(text) -> { mp3: Buffer } or null. Both optional.
// photo({ data: Buffer, mime, note }) -> { ok, message } handles a photo (a receipt). Optional.
// What a downloaded picture really is, from its first bytes.
export function pictureKind(b) {
  if (b[0] === 0xff && b[1] === 0xd8) return "jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP") return "webp";
  if (b.subarray(4, 8).toString() === "ftyp") return "heic";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "gif";
  return "unknown";
}

export function createTelegram({ token, kv, chat, shopping, transcribe = null, speak = null, photo = null, requests = null, log = console, fetchImpl = fetch, photoRetryMs = 2500 }) {
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
  async function linkCode(key = "tg_link_code") {
    let c = await kv.get(key);
    if (!c) { c = String(randomInt(100000, 1000000)); await kv.set(key, c); }
    return c;
  }
  // Two codes: Nicholas's (full Bernard) and a guest code that links a chat for the shopping list only.
  const guestCode = () => linkCode("tg_guest_code");
  const roleOf = (c) => c.role || "owner";   // chats linked before roles existed are Nicholas's

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
    // only: one chat id, "owner" for Nicholas's chats only, or nothing for every linked chat.
    const chats = only === "owner" ? (await getChats()).filter((c) => roleOf(c) === "owner") : only ? [{ id: only }] : await getChats();
    if (!chats.length) return { sent: 0 };
    const m = listMessage(await shopping.handle({ action: "list" }));
    let sent = 0;
    for (const c of chats) { try { await api("sendMessage", { chat_id: c.id, ...m }); sent++; } catch (e) { log.error?.("telegram list", e.message); } }
    return { sent };
  }

  // Alerts (morning brief, watchdog, reminders, camera…) go to the first linked chat: Nicholas.
  // A camera picture is sent as a photo with the text as its caption; a link goes on the end.
  async function alert(text, { title = "", click = "", photo = "" } = {}) {
    const owner = (await getChats()).find((c) => roleOf(c) === "owner");
    if (!owner || !token) return false;
    const body = (title ? `<b>${esc(title)}</b>\n` : "") + esc(text) + (click ? `\n<a href="${esc(click)}">Open</a>` : "");
    try {
      if (photo && body.length <= 1000) {
        try { await api("sendPhoto", { chat_id: owner.id, photo, caption: body, parse_mode: "HTML" }); return true; }
        catch (e) {
          // Telegram won't fetch some camera picture links itself (e.g. ones with an unusual port): fetch it here and upload it.
          try {
            // Imou makes the picture a few seconds after giving its address, so an early fetch gets nothing: try a few times.
            let r = null, data = null;
            for (let i = 0; i < 4; i++) {
              if (i) await new Promise((ok) => setTimeout(ok, photoRetryMs));
              r = await fetchImpl(photo, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
              const type = r?.headers?.get?.("content-type") || "image/jpeg";
              if (r?.ok && /^image\//.test(type)) { data = Buffer.from(await r.arrayBuffer()); if (data.length > 1000) break; }
              data = null;
            }
            if (!data) throw new Error(`picture not ready (${r?.status || "no answer"})`);
            const kind = pictureKind(data);
            try {
              if (kind !== "jpeg" && kind !== "png") throw new Error(`not a JPEG or PNG (${kind})`);
              await apiForm("sendPhoto", { chat_id: String(owner.id), caption: body, parse_mode: "HTML" }, { photo: { name: "camera." + (kind === "png" ? "png" : "jpg"), data, type: kind === "png" ? "image/png" : "image/jpeg" } });
            } catch (e3) {
              // Telegram couldn't process it as a photo: say what it was (for diagnosis) and send it as a file instead.
              log.error?.("telegram photo", `${data.length} bytes, ${kind}, starts ${data.subarray(0, 12).toString("hex")}:`, e3.message);
              await apiForm("sendDocument", { chat_id: String(owner.id), caption: body, parse_mode: "HTML" }, { document: { name: "camera." + (kind === "unknown" ? "bin" : kind === "jpeg" ? "jpg" : kind), data, type: r.headers?.get?.("content-type") || "application/octet-stream" } });
            }
            return true;
          } catch (e2) { log.error?.("telegram photo", e.message, "| upload:", e2.message); }
        }
      }
      await say(owner.id, body, { parse_mode: "HTML" }); return true;
    } catch (e) { log.error?.("telegram alert", e.message); return false; }
  }

  // A shopping-only chat (Michelle): add, remove, show. Nothing else, and no way into the rest of Bernard.
  async function onGuestMessage(id, text, name) {
    const t = text.trim();
    if (/^\/(start|help)\b/i.test(t)) return say(id, `Hello ${name}. I keep the shopping list here. Text me things to add ("milk, bread and bin bags"), "remove bread", or /list to see it with tick-off buttons. Send me a photo of a shop receipt and I'll file it.`);
    if (/^\/list\b|^(?:show|send|what'?s on)(?: me)?(?: the)? (?:shopping )?list\??$|^(?:shopping )?list\??$/i.test(t)) return sendList(id);
    let m;
    if ((m = t.match(/^(?:remove|take off|delete|got|we have|cross off)\s*:?\s*(.+)$/i))) {
      const r = await shopping.handle({ action: "remove", items: m[1] });
      return say(id, r.removed?.length ? `Taken off: ${r.removed.join(", ")}.${r.not_found?.length ? ` Not on the list: ${r.not_found.join(", ")}.` : ""}` : `That isn't on the list.`);
    }
    if (/^\/|\?$/.test(t) || /\b(turn|lights?|tv|play|remind|email|camera|weather|news|price|call|open)\b/i.test(t)) return say(id, "I only do the shopping list in this chat. Text me items to add, \"remove …\", or /list.");
    const items = t.replace(/^(?:add|please add|can you add|we need|need|put)\s*:?\s*/i, "").replace(/\s+(?:to the list|on the list|please)\.?$/i, "");
    const r = await shopping.handle({ action: "add", items });
    if (!r.added?.length && !r.already?.length) return say(id, "Nothing I could add there. Try \"milk, bread and eggs\".");
    return say(id, `${r.added?.length ? `Added ${r.added.join(", ")}. ` : ""}${r.already?.length ? `Already on it: ${r.already.join(", ")}. ` : ""}${r.count} on the list.`);
  }

  // ---- receiving ----
  async function onMessage(m) {
    const id = m.chat?.id;
    let text = String(m.text || "").trim();
    const voiceIn = m.voice || m.audio || null;
    const photoIn = m.photo?.length ? m.photo[m.photo.length - 1] : (m.document && /^image\//.test(m.document.mime_type || "") ? m.document : null);
    if (!id || (!text && !voiceIn && !photoIn)) return;
    const chats = await getChats();
    const linked = chats.find((c) => c.id === id);
    const guest = linked && roleOf(linked) === "shopping";
    if (guest && voiceIn) return say(id, "Text or a receipt photo in this chat, please: items to add, \"remove …\", /list, or a photo of a receipt.");
    if (guest && !photoIn) return onGuestMessage(id, text, linked.name.split(" ")[0]);
    // A photo from Nicholas or Michelle is a receipt to file (the caption is a note), unless the caption says otherwise.
    if (photoIn && linked) {
      const cap = String(m.caption || "").trim();
      if (!photo) return say(id, "I can't do anything with photos here yet.");
      if (/\b(not a receipt|ignore|just a photo)\b/i.test(cap)) return say(id, "Noted, not a receipt.");
      api("sendChatAction", { chat_id: id, action: "typing" }).catch(() => {});
      try {
        const r = await photo({ data: await download(photoIn.file_id), mime: photoIn.mime_type || "image/jpeg", note: cap, by: guest ? linked.name.split(" ")[0] : "" });
        return say(id, (r.ok ? "🧾 " : "") + (r.message || (r.ok ? "Saved." : "That didn't work.")));
      } catch (e) { log.error?.("telegram photo in", e.message); return say(id, "I couldn't read that photo: " + String(e.message).slice(0, 120)); }
    }
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
      const digits = text.replace(/\D/g, "");
      const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ") || m.chat.username || "someone";
      if (digits && digits === (await linkCode())) {
        chats.push({ id, name, role: "owner", at: new Date().toISOString() }); await setChats(chats);
        await kv.set("tg_link_code", "");   // a fresh code next time
        return say(id, `Linked. Good to meet you here, ${chats.filter((c) => roleOf(c) === "owner").length === 1 ? "Nicholas" : m.from?.first_name || "there"}. Text me anything you'd ask me out loud, or send /list for the shopping list.`);
      }
      if (digits && digits === (await guestCode())) {
        chats.push({ id, name, role: "shopping", at: new Date().toISOString() }); await setChats(chats);
        await kv.set("tg_guest_code", "");
        return say(id, `Linked, ${m.from?.first_name || "there"}. This chat is for the shopping list: text me things to add ("milk, bread and bin bags"), "remove bread", or /list to see it with tick-off buttons. You can also send me a photo of a shop receipt and I'll file it.`);
      }
      return say(id, "Hello. I'm Bernard, a private assistant. This chat isn't linked: send the 6-digit code from Bernard's dashboard settings.");
    }
    if (/^\/(start|help)\b/i.test(text)) return say(id, "Text me as you'd talk to me: \"we need milk\", \"lights off\", \"what's the weather\".\n/list shows the shopping list with tick-off buttons.");
    if (/^\/claude\b/i.test(text) && requests) { const r = await requests.handle({ action: "list" }); return say(id, r.message); }
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
    const who = (await getChats()).find((c) => c.id === id);
    if (!who) return api("answerCallbackQuery", { callback_query_id: q.id, text: "Not linked." });
    if (roleOf(who) === "shopping" && /^clear/.test(data)) return api("answerCallbackQuery", { callback_query_id: q.id, text: "Only Nicholas can clear the whole list." });
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
      return { configured: Boolean(token), running, bot: me ? "@" + me.username : null, link: me ? `https://t.me/${me.username}` : null, linked: chats.map((c) => ({ id: c.id, name: c.name, role: roleOf(c) })), link_code: token ? await linkCode() : null, guest_code: token ? await guestCode() : null, error: lastError };
    },
    async unlink(chatId) { const c = (await getChats()).filter((x) => String(x.id) !== String(chatId)); await setChats(c); return { ok: true, linked: c.length }; },
  };
}
