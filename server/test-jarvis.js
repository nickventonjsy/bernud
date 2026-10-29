import assert from "node:assert/strict";
import { createJarvis, parseEspn, sameNetwork } from "./jarvis.js";
import { createDigests } from "./digests.js";

const mem = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); }, m }; };

// Home Wi-Fi address matching.
assert.equal(sameNetwork("82.1.2.3", "82.1.2.3"), true);
assert.equal(sameNetwork("82.1.2.3", "82.1.2.4"), false);
assert.equal(sameNetwork("2a02:c7c:1234:5600:aaaa::1", "2a02:c7c:1234:5600:bbbb:cccc:dddd:eeee"), true);
assert.equal(sameNetwork("2a02:c7c:1234:5600::1", "2a02:c7c:1234:5601::1"), false);
assert.equal(sameNetwork("", "82.1.2.3"), false);

// ESPN scoreboard parsing.
const board = (home, away, state = "in", id = "1") => ({ events: [{ id, name: "Jersey v Guernsey", date: "2026-10-29T19:45Z", status: { type: { state, shortDetail: state === "post" ? "FT" : "63'" } },
  competitions: [{ competitors: [{ homeAway: "home", score: String(home), team: { displayName: "Jersey Bulls", shortDisplayName: "Jersey" } }, { homeAway: "away", score: String(away), team: { displayName: "Guernsey FC", shortDisplayName: "Guernsey" } }] }] }] });
const ev = parseEspn(board(1, 0))[0];
assert.equal(ev.home.name, "Jersey Bulls"); assert.equal(ev.away.score, "0"); assert.equal(ev.state, "in");

// Shared fakes.
const said = [], pcSaid = [], tg = [], notes = [], lightCalls = [], saved = [];
let espn = board(1, 0);
const fetchImpl = async (url) => {
  if (url.includes("espn.com")) return { ok: true, json: async () => (url.includes("eng.1") ? espn : { events: [] }) };
  if (url.includes("open-meteo")) return { ok: true, json: async () => ({ current: { temperature_2m: 12.4, weather_code: 3, wind_speed_10m: 20 }, daily: { temperature_2m_max: [14], temperature_2m_min: [8], precipitation_probability_max: [40] } }) };
  if (url.includes("/conversations?")) return { json: async () => ({ conversations: [{ conversation_id: "c1", start_time_unix_secs: 1_793_000_000 }] }) };
  if (url.includes("/conversations/c1")) return { json: async () => ({ transcript: [{ role: "user", message: "Remember the spare key is in the blue pot" }, { role: "agent", message: "Noted, sir." }] }) };
  throw new Error("unexpected " + url);
};
const kv = mem();
const j = createJarvis({ kv, fetchImpl, elevenKey: "k", agentId: "a",
  notify: async (t, o) => { notes.push(`${o?.title}|${t}`); return true; },
  sayOnPhone: async (t) => { said.push(t); },
  pc: { online: () => true, send: (a, t) => { pcSaid.push(t); } },
  telegram: { configured: true, broadcast: async (t) => { tg.push(t); return 2; }, audio: async (mp3, cap) => { tg.push("audio:" + mp3.length + ":" + cap); return true; } },
  lights: { control: async (a) => { lightCalls.push(a); return { ok: true }; } },
  dj: { mix: async ({ mood }) => ({ ok: true, title: mood + " mix", playing_on: "Lounge", starts_with: ["Song by Band"] }) },
  brain: { complete: async ({ text }) => (text.includes("Date:") ? "We sorted the lights and asked about the match." : "Good morning, sir. Here is the news."), video: async ({ url }) => "Summary of " + url },
  speakMp3: async (t) => ({ mp3: Buffer.from(t), voice: "test" }),
  headlines: async (topic) => [{ title: `${topic} story`, summary: "details" }],
  dayLog: { add() {}, today: async () => ({ asked: ["09:00 turn the lights on", "10:00 what's the score"] }), search: async () => [{ when: "today 09:00", who: "Nicholas", said: "where is the key" }] },
  voiceRequests: async () => ["good night bernard"],
  saveMemory: async (text, cat) => { saved.push([cat, text]); },
  imou: { cameras: async () => [{ name: "Front", online: true }, { name: "Back", online: false }], snapshot: async (c) => "https://pic/" + c.name },
  eventsToday: async () => [{ title: "Dentist", start: "2026-10-29T15:00:00Z" }],
  parcels: { lines: async () => ["Amazon: arriving today"] },
});

// Announcements: phone voice, PC, every Telegram chat.
let r = await j.announce({ text: "Dinner's ready" });
assert.equal(r.ok, true); assert.deepEqual(said, ["Dinner's ready"]); assert.deepEqual(pcSaid, ["Dinner's ready"]); assert.match(tg[0], /Dinner's ready/);
assert.ok(r.reached.some((x) => /Telegram \(2 chats\)/.test(x)));
assert.equal((await j.announce({ text: "  " })).ok, false);

// Party mode starts music and lights, and stop returns to warm white.
r = await j.partyMode({ minutes: 5 });
assert.equal(r.ok, true); assert.equal(r.music.title, "party mix");
await new Promise((ok) => setTimeout(ok, 20));
assert.ok(lightCalls.some((c) => c.action === "colour"));
r = await j.partyMode({ action: "stop" });
assert.equal(r.stopped, true); assert.deepEqual(lightCalls.at(-1), { device: "all", action: "white", value: "warm" });

// Sports: score, follow, goal notification, full time.
r = await j.sports({ team: "jersey" });
assert.equal(r.matches.length, 1); assert.match(r.matches[0].status, /Jersey Bulls 1–0 Guernsey FC/);
r = await j.sports({ action: "follow", team: "guernsey" });
assert.equal(r.following, "Jersey v Guernsey");
await j.sportsTick(); assert.equal(notes.length, 0);   // nothing new yet
espn = board(1, 1); await j.sportsTick();
assert.match(notes.at(-1), /Score update\|Jersey Bulls 1–1 Guernsey FC/);
espn = board(2, 1, "post"); await j.sportsTick();
assert.match(notes.at(-1), /Final score\|Full time: Jersey Bulls 2–1/);
assert.equal(await kv.get("sports_follow"), "");
assert.equal((await j.sports({ action: "follow", team: "nobody fc" })).ok, false);

// YouTube.
r = await j.youtube({ url: "https://youtu.be/dQw4w9WgXcQ?t=3" });
assert.equal(r.summary, "Summary of https://www.youtube.com/watch?v=dQw4w9WgXcQ");
assert.equal((await j.youtube({ url: "not a link" })).ok, false);

// Rewind: past voice conversations plus the activity log.
r = await j.rewind({ query: "spare key" });
assert.ok(r.found.some((f) => /blue pot/.test(f.said) && f.who === "Nicholas"));
assert.ok(r.found.some((f) => /where is the key/.test(f.said)));

// Diary: written from today's requests (good night left out), saved as category diary.
const entry = await j.writeDiary();
assert.match(entry, /^Diary \d{4}-\d{2}-\d{2}: We sorted the lights/);
assert.equal(saved[0][0], "diary");

// Spoken news goes to Telegram as audio.
r = await j.newsAudio({ topics: ["uk"] });
assert.equal(r.ok, true); assert.match(tg.at(-1), /^audio:\d+:🎙 Your morning news/);

// Ambient screen data (offline cameras left out).
r = await j.ambient();
assert.equal(r.weather.now, 12); assert.equal(r.weather.rain, 40);
assert.deepEqual(r.cameras, [{ camera: "Front", url: "https://pic/Front" }]);
assert.equal(r.events[0].title, "Dentist"); assert.deepEqual(r.parcels, ["Amazon: arriving today"]);

// The digests run the diary at 22:30 and the spoken news at 07:30.
let diaryRuns = 0, newsRuns = 0; const dn = [];
const at = (iso) => () => new Date(iso);
const mk = (iso) => createDigests({ kv: mem(), notify: async (t, o) => { dn.push(o.title); return true; }, needsReply: async () => [], priorities: async () => [], events: async () => [], parcels: { lines: async () => [] }, receipts: { week: async () => ({}) }, camEvents: async () => ({}),
  diary: async () => { diaryRuns++; return "Diary 2026-10-29: A fine day."; }, newsAudio: async () => { newsRuns++; }, now: at(iso) });
await mk("2026-10-29T22:35:00Z").tick();
assert.equal(diaryRuns, 1); assert.ok(dn.includes("📔 Today's diary"));
await mk("2026-10-29T07:31:00Z").tick();
assert.equal(newsRuns, 1);

console.log("jarvis tests passed");
process.exit(0);
