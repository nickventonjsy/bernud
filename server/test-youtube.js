import assert from "node:assert/strict";
import { createYouTube, videoIdFrom } from "./youtube.js";
const sent = [], notes = [];
let online = true, castOut = "CAST_OK: Nick's S95BA 55 Tv (201)";
const pc = { online: () => online, send: async (a, t) => { sent.push({ a, t }); if (a !== "powershell") return { ok: true, output: "Opened " + t }; return { ok: true, output: t.includes("$vid = ''") ? "CAST_DEVICES: Nick's S95BA 55 Tv | Amazon FireTV Stick 4K" : castOut }; } };
const web = { search: async (q) => ({ results: [
  { title: "How to polish a car - YouTube", url: "https://www.youtube.com/watch?v=AAAAAAAAAAA", content: "Great guide" },
  { title: "Dup", url: "https://youtu.be/AAAAAAAAAAA" },
  { title: "Channel page", url: "https://www.youtube.com/@cars" },
  { title: "Short", url: "https://www.youtube.com/shorts/BBBBBBBBBBB" } ] }) };
const yt = createYouTube({ web, pc, notify: async (t, o) => notes.push(o), zw: { url: "", key: "" } });
const s = await yt.handle({ action: "search", query: "car polishing" });
assert.deepEqual(s.videos.map((v) => v.id), ["AAAAAAAAAAA", "BBBBBBBBBBB"]); assert.equal(s.videos[0].title, "How to polish a car");
let r = await yt.handle({ action: "play", id: "https://youtu.be/AAAAAAAAAAA", where: "pc" });
assert.equal(sent.at(-1).a, "open_url"); assert.equal(sent.at(-1).t, "https://www.youtube.com/watch?v=AAAAAAAAAAA");
r = await yt.handle({ action: "play", id: "AAAAAAAAAAA", where: "phone" });
assert.equal(r.sent_to, "phone"); assert.equal(notes.at(-1).click, "https://www.youtube.com/watch?v=AAAAAAAAAAA");
r = await yt.handle({ action: "play", id: "AAAAAAAAAAA", where: "tv", tv: "S95" });
assert.equal(r.ok, true); assert.match(r.played_on, /S95BA/); assert.match(sent.at(-1).t, /\$want = 'S95'/);
castOut = "CAST_FAILED: no TV matching 'x' on the network. Found: nothing";
r = await yt.handle({ action: "play", id: "AAAAAAAAAAA", where: "tv", tv: "x" }); assert.equal(r.ok, false); assert.match(r.message, /no TV matching/);
r = await yt.handle({ action: "cast_devices" }); assert.deepEqual(r.devices, ["Nick's S95BA 55 Tv", "Amazon FireTV Stick 4K"]);
online = false;
r = await yt.handle({ action: "play", id: "AAAAAAAAAAA", where: "tv" }); assert.equal(r.error, "pc_offline");
r = await yt.handle({ action: "play", id: "AAAAAAAAAAA", where: "phone" }); assert.equal(r.ok, true, "phone works without the PC");
await assert.rejects(yt.handle({ action: "play", id: "not a video", where: "pc" }), /video id/);
await assert.rejects(yt.handle({ action: "new" }), /isn't linked/);
assert.equal(videoIdFrom("https://www.youtube.com/live/CCCCCCCCCCC?si=x"), "CCCCCCCCCCC");
console.log("youtube tests passed"); process.exit(0);
