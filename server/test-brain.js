import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createBrain, toDeclaration } from "./brain.js";

// Every real tool must convert to a valid-looking Gemini declaration (run when a local copy of the agent's tools exists).
const real = process.env.BRAIN_TOOLS && existsSync(process.env.BRAIN_TOOLS) ? JSON.parse(readFileSync(process.env.BRAIN_TOOLS, "utf8")) : [];
for (const t of real.filter((t) => t.type === "webhook")) {
  const d = toDeclaration(t);
  assert.match(d.name, /^[a-zA-Z0-9_-]+$/);
  const walk = (s) => { assert.ok(/^(STRING|NUMBER|INTEGER|BOOLEAN|ARRAY|OBJECT)$/.test(s.type), t.name + " " + s.type); if (s.items) walk(s.items); for (const v of Object.values(s.properties || {})) walk(v); if (s.type === "OBJECT") assert.ok(Object.keys(s.properties || {}).length); };
  if (d.parameters) walk(d.parameters);
}
if (real.length) { const w = toDeclaration(real.find((t) => t.name === "get_weather")); assert.deepEqual(Object.keys(w.parameters.properties).sort(), ["latitude", "longitude"]); }

const store = new Map(); const kv = { get: async (k) => store.get(k), set: async (k, v) => store.set(k, v) };
const tools = [
  { type: "webhook", name: "get_weather", description: "weather", api_schema: { url: "https://api.open-meteo.com/v1/forecast", method: "GET", query_params_schema: { properties: { latitude: { type: "number", description: "lat" }, timezone: { type: "string", constant_value: "Europe/Jersey" } }, required: ["latitude"] } } },
  { type: "webhook", name: "lights", description: "lights", api_schema: { url: "https://bernud-server.onrender.com/tv", method: "POST", request_body_schema: { type: "object", properties: { device: { type: "string", description: "d" }, kind: { type: "string", constant_value: "light" } }, required: ["device"] } } },
  { type: "system", name: "end_call" },
];
const calls = []; let geminiN = 0; let elevenOk = true;
const fetchImpl = async (url, o = {}) => {
  url = String(url);
  if (url.includes("api.elevenlabs.io")) return elevenOk ? { ok: true, json: async () => ({ conversation_config: { agent: { prompt: { prompt: "You are Bernud. Time {{system__time}}.", tools } } } }) } : { ok: false, status: 401, json: async () => ({}) };
  if (url.includes("generativelanguage")) {
    const body = JSON.parse(o.body); geminiN++;
    assert.match(body.systemInstruction.parts[0].text, /Text mode/);
    assert.ok(!body.systemInstruction.parts[0].text.includes("{{system__time}}"));
    assert.equal(body.tools[0].functionDeclarations.length, 2);
    const last = body.contents.at(-1);
    if (last.parts[0].text === "lights off please") return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ functionCall: { name: "lights", args: { device: "all lights" } } }, { functionCall: { name: "get_weather", args: { latitude: 49.19 } } }] } }] }) };
    if (last.parts[0].functionResponse) { assert.equal(last.parts.length, 2); return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "Lights off, Nicholas." }] } }] }) }; }
    if (last.parts[0].text === "quota") return { ok: false, status: 429, json: async () => ({ error: { message: "quota" } }) };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "Hello Nicholas." }] } }] }) };
  }
  calls.push({ url, o });
  if (url.startsWith("http://127.0.0.1:10000/tv")) { assert.equal(o.headers["x-bernud-key"], "BK"); assert.deepEqual(JSON.parse(o.body), { kind: "light", device: "all lights" }); return { ok: true, text: async () => '{"ok":true}' }; }
  if (url.includes("open-meteo")) { assert.match(url, /latitude=49.19/); assert.match(url, /timezone=Europe%2FJersey/); return { ok: true, text: async () => '{"current":{}}' }; }
  throw new Error("unexpected " + url);
};
const brain = createBrain({ geminiKey: "G", elevenKey: "E", agentId: "a", kv, port: 10000, bernudKey: "BK", zwKey: "ZK", fetchImpl, log: { error() {} } });
let r = await brain.chat({ session: "s1", text: "lights off please" });
assert.equal(r.ok, true); assert.equal(r.reply, "Lights off, Nicholas."); assert.deepEqual(r.tools.sort(), ["get_weather", "lights"]); assert.equal(calls.length, 2);
r = await brain.chat({ session: "s1", text: "hi" });
assert.equal(r.reply, "Hello Nicholas.");
r = await brain.chat({ session: "s2", text: "quota" }).catch((e) => e);
assert.equal(r.code, "quota");
// ElevenLabs unreachable later: falls back to the kv copy.
const b2 = createBrain({ geminiKey: "G", elevenKey: "E", agentId: "a", kv, port: 10000, bernudKey: "BK", zwKey: "ZK", fetchImpl: async (u, o) => (String(u).includes("elevenlabs") ? { ok: false, status: 500 } : fetchImpl(u, o)), log: { error() {} } });
assert.equal((await b2.status()).source, "saved copy");
assert.equal((await createBrain({ geminiKey: "", kv, fetchImpl }).chat({ text: "x" })).code, "not_set_up");
console.log("brain ok");
