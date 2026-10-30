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

// Home reminders and the sleep timer.
{
  const kv2 = mem(); let t = Date.parse("2026-10-30T21:00:00Z"); const spoken = [], sent = [], acts = [];
  const j2 = createJarvis({ kv: kv2, now: () => new Date(t), notify: async (x, o) => { sent.push(o.title + "|" + x); return true; }, sayOnPhone: async (x) => spoken.push(x),
    pc: { online: () => false }, telegram: {}, lights: { control: async (a) => { acts.push("lights " + a.action); return { ok: true }; } }, dj: {}, brain: {}, speakMp3: async () => null,
    headlines: async () => [], dayLog: { add() {} }, voiceRequests: async () => [], saveMemory: async () => {}, imou: {}, eventsToday: async () => [], parcels: {},
    pauseMusic: async () => acts.push("music paused"), tvOff: async (d) => acts.push("tv off " + d) });
  await j2.homeReminders({ action: "add", text: "put the bins out" });
  await j2.homeReminders({ action: "add", text: "ring Mum" });
  assert.equal((await j2.homeReminders({})).reminders.length, 2);
  const got = await j2.arrivedHome();
  assert.deepEqual(got, ["put the bins out", "ring Mum"]);
  assert.match(spoken[0], /remind you: put the bins out\. And ring Mum/); assert.match(sent[0], /Now you're home/);
  assert.equal((await j2.arrivedHome()).length, 0);   // cleared after going off once
  let r = await j2.sleepTimer({ what: "music", minutes: 30 });
  assert.equal(r.ok, true); assert.equal(r.minutes, 30);
  await j2.sleepTimer({ what: "tv", minutes: 60, device: "bedroom" });
  t += 31 * 60_000; await j2.sleepTick();
  assert.deepEqual(acts, ["music paused"]);
  t += 30 * 60_000; await j2.sleepTick();
  assert.deepEqual(acts, ["music paused", "tv off bedroom"]);
  assert.equal((await j2.sleepTimer({ action: "list" })).timers.length, 0);
  console.log("home reminders + sleep timer ok");
}

// Countdowns, life log, focus mode, away check.
{
  const kv3 = mem(); let t = Date.parse("2026-12-18T09:00:00Z"); const sent = [], spoken = [], acts = []; const power = { "Lounge lamp": "on", "Hall": "off", "55 TV": "on" };
  const j3 = createJarvis({ kv: kv3, now: () => new Date(t), notify: async (x, o) => { sent.push(o.title + "|" + x); return true; }, sayOnPhone: async (x) => spoken.push(x),
    pc: { online: () => false }, telegram: {}, brain: {}, speakMp3: async () => null, headlines: async () => [], dayLog: { add() {} }, voiceRequests: async () => [], saveMemory: async () => {}, imou: {}, eventsToday: async () => [], parcels: {},
    dj: { mix: async ({ mood }) => { acts.push("mix " + mood); return { ok: true, playing_on: "PC" }; } }, pauseMusic: async () => acts.push("paused"),
    lights: { list: async () => [{ name: "Lounge lamp", type: "light" }, { name: "Hall", type: "light" }, { name: "55 TV", type: "tv" }],
      control: async (a) => { if (a.action === "status") return { ok: true, device: { power: power[a.device] } }; acts.push(`${a.device} ${a.action}${a.value ? " " + a.value : ""}`); if (a.action === "off") power[a.device] = "off"; return { ok: true }; } } });
  // Countdowns
  let r = await j3.countdown({ name: "Christmas" });
  assert.equal(r.days, 7); assert.equal(r.says, "in 7 days");
  r = await j3.countdown({ action: "add", name: "Tenerife holiday", date: "2026-12-19" });
  assert.equal(r.says, "tomorrow");
  assert.equal((await j3.countdown({ name: "holiday" })).name, "Tenerife holiday");
  assert.equal((await j3.countdown({ action: "add", name: "x", date: "2026-01-01" })).ok, false);
  await j3.countdown({ action: "add", name: "Mum's birthday", date: "1960-03-02", yearly: true });
  assert.equal((await j3.countdown({ name: "mum's birthday" })).date, "2027-03-02");
  await j3.countdownTick(); await j3.countdownTick();   // once a day only
  assert.equal(sent.filter((x) => x.startsWith("⏳")).length, 1); assert.match(sent[0], /Tenerife holiday is tomorrow/);
  // Life log
  await j3.lifeLog({ action: "log", thing: "changed the car oil", when: "2026-09-01" });
  r = await j3.lifeLog({ action: "last", thing: "oil change on the car" });
  assert.equal(r.found, true); assert.equal(r.date, "2026-09-01"); assert.match(r.when, /months? ago|weeks ago/);
  await j3.lifeLog({ action: "log", thing: "gym" }); await j3.lifeLog({ action: "log", thing: "gym", when: "2026-12-15" });
  assert.equal((await j3.lifeLog({ action: "count", thing: "went to the gym", days: 7 })).times, 2);
  assert.equal((await j3.lifeLog({ action: "last", thing: "dentist" })).found, false);
  assert.equal((await j3.lifeLog({})).things.length, 2);
  // Focus mode
  r = await j3.focus({ minutes: 25 });
  assert.equal(r.ok, true); assert.deepEqual(acts.slice(0, 2), ["all white cool", "mix focus: deep work, steady and calm, few vocals"]);
  assert.equal((await j3.focus({ action: "status" })).minutes_left, 25);
  t += 26 * 60_000; await j3.focusTick();
  assert.match(spoken.at(-1), /Time's up, sir\. That's 25 minutes of focus/); assert.ok(acts.includes("paused"));
  assert.equal((await j3.focus({ action: "status" })).running, false);
  assert.equal((await j3.lifeLog({ action: "count", thing: "focus session", days: 1 })).times, 1);
  // Away check: tells him what's on; then auto-off switches it off.
  await kv3.set("home_state", JSON.stringify({ home: false }));
  await j3.leftHome(); await j3.awayTick(); assert.ok(!sent.some((x) => x.startsWith("🔌")));   // not yet
  t += 11 * 60_000; await j3.awayTick();
  assert.match(sent.at(-1), /🔌 Away check\|Still on at home: Lounge lamp, 55 TV/);
  await j3.awayCheck({ action: "auto_on" }); await j3.leftHome(); t += 11 * 60_000; await j3.awayTick();
  assert.match(sent.at(-1), /switched them off/); assert.equal(power["55 TV"], "off");
  await kv3.set("home_state", JSON.stringify({ home: true })); power.Hall = "on"; await j3.leftHome(); t += 11 * 60_000; const n = sent.length; await j3.awayTick();
  assert.equal(sent.length, n);   // he came back, no check
  console.log("countdowns + life log + focus + away check ok");
}

// Scenes, upkeep jobs, routine spotting.
{
  const kv4 = mem(); let t = Date.parse("2026-10-30T19:00:00Z"); const sent = [], calls = [];
  const state = { "Lounge lamp": { power: "on", brightness: 30, white_kelvin: 2700 }, "Strip": { power: "on", brightness: 80, colour_rgb: [128, 0, 255] }, "Hall": { power: "off" } };
  const j4 = createJarvis({ kv: kv4, now: () => new Date(t), notify: async (x, o) => { sent.push(o.title + "|" + x); return true; }, sayOnPhone: async () => {},
    pc: { online: () => false }, telegram: {}, brain: {}, speakMp3: async () => null, headlines: async () => [], dayLog: { add() {} }, voiceRequests: async () => [], saveMemory: async () => {}, imou: {}, eventsToday: async () => [], parcels: {},
    dj: { mix: async ({ mood }) => ({ ok: true, title: mood + " mix" }) },
    lights: { list: async () => Object.keys(state).map((name) => ({ name, type: "light" })).concat([{ name: "55 TV", type: "tv" }]),
      control: async (a) => { if (a.action === "status") return { ok: true, device: state[a.device] }; calls.push(`${a.device} ${a.action}${a.value ? " " + a.value : ""}`); return { ok: true }; } } });
  let r = await j4.scene({ action: "save", name: "Movie night", music: "film night chill" });
  assert.equal(r.ok, true); assert.deepEqual(r.lights_on, ["Lounge lamp", "Strip"]);
  r = await j4.scene({ name: "the movie night scene" });
  assert.equal(r.set, 3); assert.equal(r.music, "film night chill mix");
  assert.deepEqual(calls, ["Lounge lamp on", "Lounge lamp white 2700K", "Lounge lamp brightness 30", "Strip on", "Strip colour purple", "Strip brightness 80", "Hall off"]);
  assert.equal((await j4.scene({ name: "disco" })).ok, false);
  assert.equal((await j4.scene({ action: "list" })).scenes.length, 1);
  // Upkeep: due from when he last logged it; the morning nudge once; logging restarts the clock.
  await j4.lifeLog({ action: "log", thing: "descaled the kettle", when: "2026-08-01" });
  r = await j4.upkeep({ action: "add", thing: "descale the kettle", every_days: 60 });
  assert.match(r.added.due, /overdue by \d+ days/);
  await j4.upkeep({ action: "add", thing: "bleed the radiators", every_days: 365 });
  t = Date.parse("2026-10-31T09:30:00Z"); await j4.upkeepTick(); await j4.upkeepTick();
  assert.equal(sent.filter((x) => x.startsWith("🔧")).length, 1); assert.match(sent.at(-1), /descale the kettle: overdue/); assert.doesNotMatch(sent.at(-1), /radiators/);
  r = await j4.upkeep({ action: "done", thing: "kettle" });
  assert.equal(r.next, "in 60 days");
  // Routines: weather around 7am on most weekdays gets spotted, once.
  for (let d = 0; d < 21; d++) { const day = new Date(Date.parse("2026-10-12T07:10:00Z") + d * 864e5); if (day.getUTCDay() % 6 === 0) continue; t = day.getTime(); await j4.notePattern("weather"); await j4.notePattern("weather"); }
  t = Date.parse("2026-11-01T18:30:00Z");   // a Sunday evening
  r = await j4.routineIdeas();
  assert.equal(r.ideas[0].what, "weather"); assert.equal(r.ideas[0].when, "weekdays around 7am"); assert.equal(r.ideas[0].times, 15);
  await j4.routineTick(); await j4.routineTick();
  assert.equal(sent.filter((x) => x.startsWith("🧭")).length, 1);
  await j4.routineIdeas({ action: "dismiss", label: "weather" });
  assert.equal((await j4.routineIdeas()).ideas.length, 0);
  console.log("scenes + upkeep + routine spotting ok");
}
console.log("jarvis tests passed");
process.exit(0);
