import assert from "node:assert";
import { createTelegram } from "./telegram.js";
import { createShopping } from "./shopping.js";
const store = new Map(); const kv = { get: async (k) => store.get(k) ?? null, set: async (k, v) => store.set(k, v) };
const calls = []; let updates = [];
const fetchImpl = async (url, o) => { const method = url.split("/").pop(); const body = JSON.parse(o.body || "{}"); calls.push({ method, body });
  const result = method === "getMe" ? { username: "BernardBot" } : method === "getUpdates" ? updates.splice(0) : true;
  if (method === "getUpdates" && !result.length) await new Promise((r) => setTimeout(r, 20));
  return { status: 200, json: async () => ({ ok: true, result }) }; };
let tg;
const shopping = createShopping({ kv, notify: async () => {}, telegram: () => tg });
tg = createTelegram({ token: "x", kv, shopping, chat: async ({ text }) => ({ reply: "echo " + text }), fetchImpl, log: {} });
const sent = () => calls.filter((c) => c.method === "sendMessage").map((c) => c.body);
const wait = () => new Promise((r) => setTimeout(r, 80));
await tg.start();
const code = (await tg.status()).link_code;
updates.push({ update_id: 1, message: { chat: { id: 5 }, from: { first_name: "Stranger" }, text: "hello" } }); await wait();
assert.match(sent().at(-1).text, /isn't linked/);
updates.push({ update_id: 2, message: { chat: { id: 7 }, from: { first_name: "Nick" }, text: code } }); await wait();
assert.match(sent().at(-1).text, /Linked/);
updates.push({ update_id: 3, message: { chat: { id: 7 }, text: "lights off" } }); await wait();
assert.equal(sent().at(-1).text, "echo lights off");
await shopping.handle({ action: "add", items: "milk, bin bags" });
const r = await shopping.handle({ action: "send" }); assert.equal(r.via, "Telegram (with tick-off buttons)");
const list = sent().at(-1); assert.match(list.text, /Shopping list \(2\)/); assert.equal(list.reply_markup.inline_keyboard[0][0].callback_data, "got:milk");
updates.push({ update_id: 4, callback_query: { id: "q", data: "got:milk", message: { chat: { id: 7 }, message_id: 9 } } }); await wait();
assert.deepEqual((await shopping.handle({ action: "list" })).items, ["bin bags"]);
assert.ok(calls.some((c) => c.method === "editMessageText" && /\(1\)/.test(c.body.text)));
updates.push({ update_id: 5, callback_query: { id: "q2", data: "got:milk", message: { chat: { id: 5 }, message_id: 9 } } }); await wait();
assert.ok(calls.some((c) => c.method === "answerCallbackQuery" && c.body.text === "Not linked."));
assert.equal(await tg.alert("Brief ready", { title: "CCP" }), true);
assert.equal(sent().at(-1).chat_id, 7);
// Michelle links with the guest code: shopping list only.
const guest = (await tg.status()).guest_code; assert.notEqual(guest, code);
updates.push({ update_id: 10, message: { chat: { id: 9 }, from: { first_name: "Michelle" }, text: guest } }); await wait();
assert.match(sent().at(-1).text, /Linked, Michelle.*shopping list/);
assert.equal((await tg.status()).linked.find((c) => c.id === 9).role, "shopping");
updates.push({ update_id: 11, message: { chat: { id: 9 }, text: "we need milk and bread please" } }); await wait();
assert.match(sent().at(-1).text, /Added milk, bread/); assert.deepEqual((await shopping.handle({ action: "list" })).items.sort(), ["bin bags", "bread", "milk"]);
updates.push({ update_id: 12, message: { chat: { id: 9 }, text: "remove bread" } }); await wait();
assert.match(sent().at(-1).text, /Taken off: bread/);
updates.push({ update_id: 13, message: { chat: { id: 9 }, text: "turn the lights off" } }); await wait();
assert.match(sent().at(-1).text, /only do the shopping list/);
updates.push({ update_id: 14, message: { chat: { id: 9 }, text: "/list" } }); await wait();
assert.match(sent().at(-1).text, /Shopping list \(2\)/); assert.equal(sent().at(-1).chat_id, 9);
updates.push({ update_id: 15, callback_query: { id: "q3", data: "clear?", message: { chat: { id: 9 }, message_id: 9 } } }); await wait();
assert.ok(calls.some((c) => c.method === "answerCallbackQuery" && /Only Nicholas/.test(c.body.text)));
updates.push({ update_id: 16, message: { chat: { id: 9 }, voice: { file_id: "v" } } }); await wait();
assert.match(sent().at(-1).text, /Text or a receipt photo/);
// Alerts still go to Nicholas only.
await tg.alert("Reminder", { title: "R" }); assert.equal(sent().at(-1).chat_id, 7);
// Voice note in -> transcribed, answered, voice note back with caption.
const fetchFiles = async (url, o) => { if (url.includes("/file/bot")) return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }; return fetchImpl(url, { body: o.body instanceof FormData ? JSON.stringify({ chat_id: o.body.get("chat_id"), caption: o.body.get("caption"), hasVoice: !!o.body.get("voice") }) : o.body }); };
const tg2 = createTelegram({ token: "x", kv, shopping, chat: async ({ text }) => ({ reply: "Lamp on, Nicholas." }), fetchImpl: fetchFiles, log: {},
  transcribe: async (buf, mime) => { assert.equal(buf.length, 3); assert.equal(mime, "audio/ogg"); return "turn the lamp on"; }, speak: async (t) => ({ mp3: Buffer.from("mp3") }) });
tg.stop(); await wait(); calls.length = 0; await tg2.start();
updates.push({ update_id: 10, message: { chat: { id: 7 }, voice: { file_id: "f1", mime_type: "audio/ogg" } } }); await wait();
const sv = calls.find((c) => c.method === "sendVoice"); assert.ok(sv, "sendVoice called"); assert.match(sv.body.caption, /turn the lamp on[\s\S]*Lamp on, Nicholas/); assert.equal(sv.body.hasVoice, true);
// No voice available -> text with the transcript
const tg3 = createTelegram({ token: "x", kv, shopping, chat: async () => ({ reply: "Done." }), fetchImpl: fetchFiles, log: {}, transcribe: async () => "hello", speak: async () => null });
tg2.stop(); await wait(); calls.length = 0; await tg3.start(); updates.push({ update_id: 11, message: { chat: { id: 7 }, voice: { file_id: "f2" } } }); await wait();
assert.match(sent().at(-1).text, /🎙 hello/);
// Alert with photo + link
calls.length = 0; await tg3.alert("Someone at the door", { title: "Person: Living Room", click: "https://bernud.onrender.com/camera.html", photo: "https://x/p.jpg" });
const ph = calls.find((c) => c.method === "sendPhoto"); assert.ok(ph); assert.match(ph.body.caption, /Person: Living Room[\s\S]*Open/);
console.log("telegram tests passed"); process.exit(0);
