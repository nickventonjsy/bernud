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

// Crypto in dollars for the brief
const { createCrypto, spokenCrypto, fmtUsd } = await import("./crypto.js");
const cp = createCrypto({ fetchImpl: async (u) => { assert.match(u, /vs_currencies=usd/); return { ok: true, json: async () => ({ bitcoin: { usd: 67250.4, usd_24h_change: 1.234 }, ethereum: { usd: 2510, usd_24h_change: -0.56 }, solana: { usd: 150.2, usd_24h_change: 0 }, ripple: { usd: 0.5123, usd_24h_change: 2 } }) }; } });
const coins = await cp.usd();
assert.equal(fmtUsd(67250.4), "$67,250"); assert.equal(fmtUsd(0.5123), "$0.5123"); assert.equal(fmtUsd(2.4), "$2.40");
assert.equal(spokenCrypto(coins), "Crypto in dollars: Bitcoin $67,250, up 1.2 percent; Ethereum $2,510, down 0.6 percent; Solana $150, flat; XRP $0.5123, up 2 percent.");
console.log("crypto ok");

// Michelle's Echo
const q1 = matchQuick("Play Michelle's oldies on Michelle's Echo");
assert.equal(q1.tool, "spotify_play_on"); assert.deepEqual(q1.args, { device: "michelle's echo", query: "michelle's oldies" });
assert.deepEqual(matchQuick("play something for a friday evening on the echo").args, { device: "michelle's echo", mood: "a friday evening" });
assert.deepEqual(matchQuick("move the music to michelle's echo").args, { device: "michelle's echo" });
assert.deepEqual(matchQuick("play it on the echo").args, { device: "michelle's echo" });
const { createSpeakers } = await import("./speakers.js");
const calls2 = [];
const sp = createSpeakers({ zw: { url: "https://zw", key: "k" }, dj: { mix: async (o) => ({ ok: true, title: "Mix", ...o }) }, fetchImpl: async (u, o = {}) => {
  calls2.push([u, o.body && JSON.parse(o.body)]);
  if (u.includes("what=devices")) return { json: async () => ({ devices: [{ id: "p1", name: "Nicholas's S24", type: "Smartphone" }, { id: "e1", name: "Michelle's Echo Dot", type: "Speaker" }] }) };
  if (u.includes("what=shortcuts")) return { json: async () => ({ shortcuts: [{ label: "Michelle", name: "Michelle Shelley's oldies", uri: "spotify:playlist:abc" }] }) };
  return { json: async () => ({ ok: true }) };
} });
const r1 = await sp.playOn({ device: "michelle's echo", query: "michelle's oldies" });
assert.equal(r1.device, "Michelle's Echo Dot"); assert.equal(r1.playing, "Michelle Shelley's oldies");
assert.deepEqual(calls2.at(-1)[1], { action: "play", uri: "spotify:playlist:abc", device_id: "e1" });
const r2 = await sp.playOn({ device: "michelle's echo" }); assert.equal(r2.moved, true); assert.deepEqual(calls2.at(-1)[1], { action: "transfer", value: "e1" });
console.log("echo ok");
