import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createBrain, toDeclaration, toOpenAiTool, pickGroups, slimConfig } from "./brain.js";
import { matchQuick } from "./quick.js";

// ---- Real agent config (when a local copy exists): every tool converts, and slimming really shrinks things.
const real = process.env.BRAIN_TOOLS && existsSync(process.env.BRAIN_TOOLS) ? JSON.parse(readFileSync(process.env.BRAIN_TOOLS, "utf8")) : [];
const realPrompt = process.env.BRAIN_PROMPT && existsSync(process.env.BRAIN_PROMPT) ? readFileSync(process.env.BRAIN_PROMPT, "utf8") : "";
const webhooks = real.filter((t) => t.type === "webhook");
for (const t of webhooks) {
  const d = toDeclaration(t);
  assert.match(d.name, /^[a-zA-Z0-9_-]+$/);
  const walk = (s) => { assert.ok(/^(STRING|NUMBER|INTEGER|BOOLEAN|ARRAY|OBJECT)$/.test(s.type), t.name + " " + s.type); if (s.items) walk(s.items); for (const v of Object.values(s.properties || {})) walk(v); if (s.type === "OBJECT") assert.ok(Object.keys(s.properties || {}).length); };
  if (d.parameters) walk(d.parameters);
  assert.equal(toOpenAiTool(t).function.parameters.type, "object");
}
if (webhooks.length && realPrompt) {
  const cfg = { prompt: realPrompt, tools: webhooks };
  const size = (c) => JSON.stringify(c.prompt).length + JSON.stringify(c.tools.map(toDeclaration)).length;
  const w = slimConfig(cfg, "what's the weather tomorrow", pickGroups("what's the weather tomorrow"));
  assert.ok(w.tools.some((t) => t.name === "get_weather"));
  assert.ok(!w.tools.some((t) => t.name === "gmail_draft"));
  assert.ok(!w.prompt.includes("# CCP morning brief"));
  assert.ok(w.prompt.includes("# Identity") && w.prompt.includes("# Safety rules"));
  assert.ok(size(w) < size(cfg) / 3, `weather slim ${size(w)} vs ${size(cfg)}`);
  const e = slimConfig(cfg, "draft a reply to the supplier email", pickGroups("draft a reply to the supplier email"));
  assert.ok(e.tools.some((t) => t.name === "gmail_draft") && e.prompt.includes("# CCP email"));
  const b = slimConfig(cfg, "give me my CCP morning brief", pickGroups("give me my CCP morning brief"));
  assert.ok(b.prompt.includes("# CCP morning brief") && b.tools.some((t) => t.name === "ccp_brief_context"));
  console.log("slim sizes: full", size(cfg), "weather", size(w), "email", size(e), "brief", size(b));
}
// Follow-ups keep the topic.
assert.ok(pickGroups("yes do it", ["email"]).includes("email"));
assert.ok(pickGroups("turn the lamp on").includes("home"));

// ---- Instant commands
const q = (t) => matchQuick(t);
assert.deepEqual(q("Turn the lamp on").args, { action: "on", device: "lamp", value: "" });
assert.deepEqual(q("Hey Bernard, switch off all the lights please.").args, { action: "off", device: "all lights", value: "" });
assert.deepEqual(q("lights off").args, { action: "off", device: "all lights", value: "" });
assert.equal(q("turn the ceiling light off").args.device, "ceiling light");
assert.equal(q("turn the TV off").tool, "tv_control");
assert.equal(q("torch on").args.action, "torch");
assert.equal(q("pause the music").args.action, "pause");
assert.equal(q("skip this song").args.action, "next");
assert.equal(q("Goodnight Bernard").tool, "goodnight");
assert.equal(q("find my phone").args.action, "ring");
assert.equal(q("put the kettle on"), null);
assert.deepEqual(q("show me the front door camera").args, { action: "show", camera: "front door", screen: "" });
assert.deepEqual(q("Show the camera on the TV").args, { action: "show", camera: "", screen: "tv" });
assert.equal(q("open the camera").tool, "camera");
assert.equal(q("turn the music up"), null);
assert.equal(q("what's the weather like"), null);
assert.equal(q("turn on do not disturb").args.action, "dnd");
assert.match(q("goodnight").reply({ ok: true, done: ["lights off (3)", "TVs off (Lounge)", "Spotify paused"], tomorrow: { events: [{ title: "Site visit", time: "9:30 am" }], weather: { summary: "rainy", high_c: 13, rain_chance_pct: 70 } } }), /Goodnight, sir\. Lights off, TVs off and Spotify paused\. Tomorrow you've got Site visit at 9:30 am\. It'll be rainy, 13 degrees, with a 70 percent chance of rain\. Sleep well\./);

// ---- Brain with fake ElevenLabs/Gemini/Groq/tools
const store = new Map(); const kv = { get: async (k) => store.get(k), set: async (k, v) => store.set(k, v) };
const tools = [
  { type: "webhook", name: "get_weather", description: "weather", api_schema: { url: "https://api.open-meteo.com/v1/forecast", method: "GET", query_params_schema: { properties: { latitude: { type: "number", description: "lat" }, timezone: { type: "string", constant_value: "Europe/Jersey" } }, required: ["latitude"] } } },
  { type: "webhook", name: "lights", description: "lights", api_schema: { url: "https://bernud-server.onrender.com/tv", method: "POST", request_body_schema: { type: "object", properties: { device: { type: "string", description: "d" }, action: { type: "string", description: "a" }, value: { type: "string", description: "v" }, kind: { type: "string", constant_value: "light" } }, required: ["device"] } } },
  { type: "webhook", name: "gmail_search", description: "mail", api_schema: { url: "https://bernud-server.onrender.com/gmail/search", method: "GET", query_params_schema: { properties: { q: { type: "string", description: "q" } } } } },
  { type: "system", name: "end_call" },
];
const prompt = "# Identity\nYou are Bernud. Time {{system__time}}.\n# Tools\n- get_weather: weather\n- gmail_search: mail\n# CCP email (x)\nEmail rules.\n# Safety rules (always)\nBe safe.";
const calls = []; const gemBodies = []; const groqBodies = [];
let groqMode = "ok";
const fetchImpl = async (url, o = {}) => {
  url = String(url);
  if (url.includes("api.elevenlabs.io")) return { ok: true, json: async () => ({ conversation_config: { agent: { prompt: { prompt, tools } } } }) };
  if (url.includes("generativelanguage")) {
    const body = JSON.parse(o.body); gemBodies.push(body);
    const last = body.contents.at(-1);
    if (/\[Already done/.test(last.parts[0].text || "")) { assert.match(last.parts[0].text, /get_weather\(\{"latitude":49.19\}\) -> /); return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "Taken over: twelve degrees." }] } }] }) }; }
    if (last.parts[0].functionResponse) return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "Twelve degrees, Nicholas." }] } }] }) };
    if (/weather/.test(last.parts[0].text)) return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ functionCall: { name: "get_weather", args: { latitude: 49.19 } } }] } }] }) };
    if (last.parts[0].text === "quota") return { ok: false, status: 429, json: async () => ({ error: { message: "quota" } }) };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "Hello Nicholas." }] } }] }) };
  }
  if (url.includes("api.groq.com")) {
    const body = JSON.parse(o.body); groqBodies.push(body);
    assert.equal(o.headers.authorization, "Bearer GQ");
    if (groqMode === "429") return { ok: false, status: 429, json: async () => ({ error: { message: "Rate limit reached on tokens per minute (TPM)" } }) };
    const last = body.messages.at(-1);
    if (last.role === "tool") return { ok: true, json: async () => ({ choices: [{ message: { content: "Groq says twelve degrees." } }] }) };
    if (/weather/.test(last.content)) return { ok: true, json: async () => ({ choices: [{ message: { content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "get_weather", arguments: '{"latitude":49.19}' } }] } }] }) };
    return { ok: true, json: async () => ({ choices: [{ message: { content: "Groq hello." } }] }) };
  }
  calls.push({ url, o });
  if (url.startsWith("http://127.0.0.1:10000/tv")) { assert.equal(o.headers["x-bernud-key"], "BK"); return { ok: true, text: async () => JSON.stringify({ ok: true, devices: ["Lamp"] }) }; }
  if (url.includes("open-meteo")) { assert.match(url, /latitude=49.19/); assert.match(url, /timezone=Europe%2FJersey/); return { ok: true, text: async () => '{"current":{}}' }; }
  throw new Error("unexpected " + url);
};
const mk = (extra = {}) => createBrain({ geminiKey: "G", elevenKey: "E", agentId: "a", kv, port: 10000, bernudKey: "BK", zwKey: "ZK", fetchImpl, log: { error() {} }, ...extra });

// Instant command: no AI call at all.
let brain = mk();
let r = await brain.chat({ session: "s1", text: "turn the lamp on" });
assert.equal(r.model, "instant"); assert.equal(r.reply, "Lamp on."); assert.equal(gemBodies.length, 0);
assert.deepEqual(JSON.parse(calls[0].o.body), { kind: "light", action: "on", device: "lamp", value: "" });

// "turn it off" remembers what was just switched (even in a new conversation).
r = await brain.chat({ session: "s9", text: "now turn it off" });
assert.equal(r.model, "instant"); assert.deepEqual(JSON.parse(calls.at(-1).o.body), { kind: "light", action: "off", device: "lamp", value: "" });
assert.equal(matchQuick("switch them back on", "lamp").args.action, "on");

// Gemini path with a tool, slimmed: weather question doesn't get the email tool or email rules.
r = await brain.chat({ session: "s1", text: "what's the weather" });
assert.equal(r.reply, "Twelve degrees, Nicholas."); assert.deepEqual(r.tools, ["get_weather"]);
const sent = gemBodies[0];
assert.ok(!sent.tools[0].functionDeclarations.some((d) => d.name === "gmail_search"));
assert.ok(!sent.systemInstruction.parts[0].text.includes("Email rules"));
assert.ok(!sent.systemInstruction.parts[0].text.includes("- gmail_search"));
assert.ok(sent.systemInstruction.parts[0].text.includes("Be safe") && !sent.systemInstruction.parts[0].text.includes("{{system__time}}"));
// History carries over as plain text turns.
r = await brain.chat({ session: "s1", text: "hi" });
assert.equal(gemBodies.at(-1).contents.length, 5);
assert.equal(gemBodies.at(-1).contents[0].parts[0].text, "turn the lamp on");
r = await brain.chat({ session: "s2", text: "quota" }).catch((e) => e);
assert.equal(r.code, "quota");

// Groq first when configured; Gemini untouched.
const gBefore = gemBodies.length;
brain = mk({ groqKey: "GQ" });
r = await brain.chat({ session: "g1", text: "what's the weather" });
assert.equal(r.reply, "Groq says twelve degrees."); assert.match(r.model, /^groq:/); assert.equal(gemBodies.length, gBefore);
assert.equal(groqBodies[0].tools[0].function.parameters.type, "object");
assert.equal(groqBodies[1].messages.at(-1).role, "tool");
// Groq rate-limited before doing anything: tries the other Groq models, then Gemini; then rests.
groqMode = "429";
const nG0 = groqBodies.length;
r = await brain.chat({ session: "g2", text: "hello there" });
assert.equal(r.reply, "Hello Nicholas."); assert.ok(!/^groq/.test(r.model));
assert.equal(groqBodies.length, nG0 + 3); assert.equal(new Set(groqBodies.slice(nG0).map((b) => b.model)).size, 3);
r = await brain.chat({ session: "g2", text: "hello again" });
assert.equal(groqBodies.length, nG0 + 3); // all resting now
// "Try again in 1.2s": waits and retries the same model instead of giving up.
let waits = 0;
const bw = mk({ groqKey: "GQ", fetchImpl: async (u, o) => {
  if (String(u).includes("api.groq.com") && waits++ === 0) return { ok: false, status: 429, json: async () => ({ error: { message: "Rate limit reached on tokens per minute (TPM): Limit 8000, Used 7000. Please try again in 1.2s." } }) };
  return fetchImpl(u, o);
} });
groqMode = "ok";
const tw = Date.now(); r = await bw.chat({ session: "w1", text: "hello there" });
assert.equal(r.reply, "Groq hello."); assert.ok(Date.now() - tw >= 1200);
// Groq fails after already running a tool: Gemini takes over with the results, without running the tool again.
groqMode = "ok";
const b2 = mk({ groqKey: "GQ", fetchImpl: async (u, o) => {
  if (String(u).includes("api.groq.com") && JSON.parse(o.body).messages.at(-1).role === "tool") return { ok: false, status: 500, json: async () => ({ error: { message: "boom" } }) };
  return fetchImpl(u, o);
} });
const nCalls = calls.length, nGem = gemBodies.length;
r = await b2.chat({ session: "g3", text: "what's the weather" });
assert.equal(calls.length, nCalls + 1); assert.equal(gemBodies.length, nGem + 1); assert.equal(r.reply, "Taken over: twelve degrees.");

// Camera on the TV by voice: straight to the camera tool with the TV named.
assert.deepEqual(matchQuick("play the living room camera on the sb95 tv", "").args, { action: "show", camera: "living room", screen: "S95B tv" });
assert.deepEqual(matchQuick("put the car park camera on the telly", "").args, { action: "show", camera: "car park", screen: "telly" });
assert.equal(matchQuick("show me the shop camera", "").args.screen, "");

// "Close the camera" / "go back to you": shuts the camera window, nothing else.
{ const { CLOSE_CAMERA } = await import("./brain.js");
  for (const w of ["close the camera", "Close that camera.", "go back to you", "Bernard, go back", "close the shop camera please", "take me back", "get rid of the camera", "back to you", "close it"]) assert.ok(CLOSE_CAMERA.test(w), w);
  for (const w of ["show me the shop camera", "go back to the living room camera", "close the curtains", "turn off the lights"]) assert.ok(!CLOSE_CAMERA.test(w), w);
  const rc = await mk().chat({ session: "cc", text: "close the camera" }); assert.deepEqual(rc.ui, { closeCamera: true }); assert.equal(rc.model, "instant"); }

// Groq's minute allowance: a request that won't fit isn't sent to Groq at all; Gemini answers straight away.
{ const nGq = groqBodies.length, nGm2 = gemBodies.length;
  const tiny = mk({ groqKey: "GQ", groqTpm: 50 });
  const rt = await tiny.chat({ session: "tpm", text: "hi" });
  assert.equal(groqBodies.length, nGq, "Groq not called"); assert.equal(gemBodies.length, nGm2 + 1); assert.ok(!/^groq/.test(rt.model)); }

// Cerebras, when its key is set, is asked first (same gpt-oss model, its own address and key).
{ const cb = []; const bc = mk({ groqKey: "GQ", cerebrasKey: "CB", fetchImpl: async (u, o) => {
    if (String(u).includes("api.cerebras.ai")) { cb.push(JSON.parse(o.body)); assert.equal(o.headers.authorization, "Bearer CB"); return { ok: true, json: async () => ({ choices: [{ message: { content: "Cerebras hello." } }], usage: { total_tokens: 900 } }) }; }
    return fetchImpl(u, o); } });
  const rc = await bc.chat({ session: "cb", text: "hi" });
  assert.equal(rc.reply, "Cerebras hello."); assert.equal(cb[0].model, "gpt-oss-120b"); assert.match(rc.model, /cerebras/); }

// Michelle: a different nice thing each time, instantly, never repeating the last few, never "Nicholas".
{ const lrn = (rows) => ({ learned: async () => rows, promptBlock: async () => "", fromExchange: async () => {} });
  const b = mk({ learner: lrn([{ text: "Nicholas wants different things said about Michelle" }]) });
  const seen = new Set();
  for (let i = 0; i < 8; i++) { const r = await b.chat({ session: "m" + i, text: "Michelle" }); assert.equal(r.model, "instant"); assert.ok(!/Nicholas/.test(r.reply)); seen.add(r.reply); }
  assert.equal(seen.size, 8, "no repeats within 8"); }

// ElevenLabs unreachable later: falls back to the kv copy. Not set up: says so.
const b3 = createBrain({ geminiKey: "G", elevenKey: "E", agentId: "a", kv, port: 10000, bernudKey: "BK", zwKey: "ZK", fetchImpl: async (u, o) => (String(u).includes("elevenlabs") ? { ok: false, status: 500 } : fetchImpl(u, o)), log: { error() {} } });
assert.equal((await b3.status()).source, "saved copy");
assert.equal((await createBrain({ geminiKey: "", kv, fetchImpl }).chat({ text: "x" })).code, "not_set_up");

// A retired Gemini model falls through to the next one; all busy -> "busy".
const tried = [];
const b4 = mk({ models: ["old", "new"], fetchImpl: async (u, o) => {
  if (String(u).includes("/old:")) { tried.push("old"); return { ok: false, status: 404, json: async () => ({ error: { message: "This model is no longer available to new users" } }) }; }
  if (String(u).includes("/new:")) tried.push("new");
  return fetchImpl(u, o);
} });
assert.equal((await b4.chat({ session: "z", text: "hi" })).model, "new"); assert.deepEqual(tried, ["old", "new"]);
const b5 = mk({ models: ["a1", "a2"], fetchImpl: async (u, o) => (String(u).includes("generativelanguage") ? { ok: false, status: 503, json: async () => ({ error: { message: "high demand" } }) } : fetchImpl(u, o)) });
assert.equal((await b5.chat({ session: "q", text: "hi" }).catch((e) => e)).code, "busy");
// "My daily brief" goes to the brief handler, not the AI.
const bb = mk({ briefHandler: async (t) => ({ reply: "Brief: " + t, ui: { brief: true } }) });
for (const t of ["give me my daily brief", "Morning brief please", "CCP brief", "can I have my brief?", "Hey Bernard, my daily briefing", "a new brief"]) {
  const x = await bb.chat({ session: "b1", text: t }); assert.equal(x.model, "brief", t); assert.deepEqual(x.ui, { brief: true });
}
assert.notEqual((await bb.chat({ session: "b2", text: "what was in the brief about the supplier" })).model, "brief");
console.log("brain ok");

{ const { isAboutMichelle, pickGroups } = await import("./brain.js");
  assert.ok(isAboutMichelle("What do you think of Michelle?"));
  assert.ok(!isAboutMichelle("Can you send a WhatsApp message to Michelle and say hello Michelle?"));
  assert.ok(pickGroups("Yeah, can you send that to her please?").includes("devices"));
  console.log("michelle + whatsapp routing ok"); }
{ const { SAID_YES } = await import("./brain.js");
  for (const y of ["Yes.", "yeah send it", "Yes please", "go ahead", "Send it.", "Yep, that's right.", "OK, send it now", "Do it"]) assert.ok(SAID_YES.test(y), y);
  for (const n of ["Do you need anything from the shop? Kiss emoji, kiss emoji.", "No", "yes but change it to hello", "Can you send a message to Michelle on WhatsApp and say hi", "wait"]) assert.ok(!SAID_YES.test(n), n);
  console.log("said-yes ok"); }
{ const { BRIEF_ASK } = await import("./brain.js");
  // 30 Oct: this phrasing missed the instant path and took 19.5 seconds.
  assert.ok(BRIEF_ASK.test("Can you give me my CCP morning brief, please?"));
  assert.ok(!BRIEF_ASK.test("Can you send the brief to Kerr"));
  console.log("brief phrasing ok"); }

// New tools are reachable in phone voice mode.
{ const has = (t, g) => assert.ok(pickGroups(t).includes(g), `${t} -> ${pickGroups(t)}`);
  has("how many days until Christmas", "countdown"); has("log that I changed the car oil", "lifelog");
  has("when did I last cut the grass", "lifelog"); has("focus mode for 45 minutes", "focus");
  has("did I leave anything on", "awaycheck"); assert.ok(!pickGroups("turn the lights off").includes("awaycheck"));
  console.log("new tool groups ok"); }
{ const has = (t, g) => assert.ok(pickGroups(t).includes(g), `${t} -> ${pickGroups(t)}`);
  has("movie night", "scene"); has("save this as reading", "scene"); has("remind me to descale the kettle every two months", "upkeep");
  has("I've descaled the kettle", "upkeep"); has("what jobs are due", "upkeep"); has("what routines have you spotted", "routines");
  console.log("scene/upkeep/routine groups ok"); }
