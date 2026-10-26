// DJ, goodnight verdict, day log and Jersey titbits.
import assert from "node:assert/strict";
import { createDJ, parsePicks } from "./dj.js";
import { createDayLog } from "./daylog.js";
import { createRoutines } from "./routines.js";
import { matchQuick } from "./quick.js";
import { FACTS, factFor } from "./jerseyfacts.js";
import { pickGroups, slimConfig } from "./brain.js";

// Jersey titbits: same all day, changes the next day.
assert.ok(FACTS.length >= 40);
assert.equal(factFor(new Date("2026-10-26T06:00:00Z")), factFor(new Date("2026-10-26T22:30:00Z")));
assert.notEqual(factFor(new Date("2026-10-26T12:00:00Z")), factFor(new Date("2026-10-27T12:00:00Z")));

// DJ picks parsing
assert.deepEqual(parsePicks('```json\n{"title":"Friday Feeling","picks":[3,1,3,99,"2"]}\n```', 10), { title: "Friday Feeling", picks: [3, 1, 2] });
assert.equal(parsePicks("no json", 5), null);

// DJ end to end with a fake ZentraWire
const lib = Array.from({ length: 40 }, (_, i) => ({ n: "Song " + i, a: "Artist " + (i % 7), y: "1999", u: "spotify:track:" + String(i).padStart(22, "x") }));
const sent = [];
const fetchImpl = async (url, o = {}) => {
  if (url.endsWith("what=library")) return { status: 200, json: async () => ({ count: lib.length, tracks: lib }) };
  sent.push(JSON.parse(o.body)); return { status: 200, json: async () => ({ ok: true }) };
};
let asked = null;
const dj = createDJ({ zw: { url: "https://zw", key: "k" }, fetchImpl, complete: async (o) => { asked = o; return '{"title":"Friday Feeling","picks":[5,6,7,8,9,10]}'; } });
const mixed = await dj.mix({ mood: "a Friday evening" });
assert.equal(mixed.ok, true);
assert.equal(mixed.tracks, 6);
assert.equal(asked.prefer, "gemini");
assert.match(asked.text, /Mood: a Friday evening/);
const play = sent.find((b) => b.action === "play");
assert.deepEqual(play.uris, lib.slice(4, 10).map((t) => t.u));
assert.ok(sent.findIndex((b) => b.action === "shuffle") < sent.indexOf(play));
assert.equal((await dj.mix({ mood: "" })).ok, false);

// Quick command for the DJ
assert.deepEqual(matchQuick("Play something for a Friday evening, Bernard").args, { mood: "a friday evening", count: 25 });
assert.equal(matchQuick("make me a mix for a long drive").args.mood, "a long drive");
assert.equal(matchQuick("play some music while i'm cooking").args.mood, "cooking");
assert.notEqual(matchQuick("play something by oasis")?.tool, "spotify_dj");

// Day log
const store = new Map(); const kv = { get: async (k) => store.get(k), set: async (k, v) => store.set(k, v) };
let clock = new Date("2026-10-26T09:15:00Z");
const log = createDayLog({ kv, now: () => clock });
await log.add("asked", "turn the lights on");
await log.add("tool", log.routeLabel("/tv"));
await log.add("tool", log.routeLabel("/tv"));
clock = new Date("2026-10-27T09:15:00Z");
await log.add("asked", "tomorrow's thing");
clock = new Date("2026-10-26T21:00:00Z");
const today = await log.today();
assert.deepEqual(today.asked, ["09:15 turn the lights on"]);
assert.deepEqual(today.used, { "lights or TV": 2 });
assert.equal(log.routeLabel("/routine/goodnight"), null);

// Goodnight includes the verdict, and survives a failing one
const base = { kv, lights: { control: async () => ({ ok: true, devices: ["a"] }) }, smartthings: { configured: () => false }, phone: { online: () => false }, pc: { online: () => false },
  zw: { url: "", key: "" }, events: async () => [], fetchImpl: async () => ({ json: async () => ({ daily: { weather_code: [1, 1], temperature_2m_max: [1, 12], temperature_2m_min: [1, 1], precipitation_probability_max: [0, 0], wind_speed_10m_max: [1, 1] } }) }) };
const gn = await createRoutines({ ...base, verdict: async () => "A productive day, by your standards." }).goodnight();
assert.equal(gn.verdict, "A productive day, by your standards.");
const reply = matchQuick("goodnight").reply(gn);
assert.match(reply, /by your standards\. Sleep well\.$/);
const gn2 = await createRoutines({ ...base, verdict: async () => { throw new Error("busy"); } }).goodnight();
assert.equal(gn2.ok, true); assert.equal(gn2.verdict, undefined);

// Meal ideas: the section and send_to_phone come with cooking questions only
const cfg = { prompt: "# Identity\nBernud\n# Meal ideas\nSuggest meals\n# Spotify\nmusic\n", tools: [{ name: "send_to_phone" }, { name: "spotify_dj" }, { name: "spotify_control" }, { name: "spotify_info" }] };
const g = pickGroups("what can I make with chicken, peppers and rice");
assert.ok(g.includes("meals"));
const slim = slimConfig(cfg, "what can I make with chicken", g);
assert.match(slim.prompt, /Meal ideas/); assert.doesNotMatch(slim.prompt, /# Spotify/);
assert.ok(slim.tools.some((t) => t.name === "send_to_phone"));
assert.doesNotMatch(slimConfig(cfg, "play something", pickGroups("play something")).prompt, /Meal ideas/);
console.log("extras ok");
