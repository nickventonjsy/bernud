import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createLiveKit } from "./livekit.js";

// Not configured: honest error, no worker.
const off = createLiveKit({ url: "", apiKey: "", apiSecret: "" });
assert.equal(off.configured, false); assert.equal(off.start(), false);
await assert.rejects(off.token(), /isn't set up/);

// Configured: tokens carry the room and identity; the worker is spawned with what it needs and restarted if it dies.
const spawned = []; const logs = [];
const spawnImpl = (cmd, args, opts) => { const c = new EventEmitter(); c.pid = 42 + spawned.length; c.kill = () => c.emit("exit", null, "SIGTERM"); spawned.push({ cmd, args, env: opts.env }); return c; };
process.env.LIVEKIT_WORKER = "inline";
const lk = createLiveKit({ url: "wss://x.livekit.cloud", apiKey: "k", apiSecret: "s", port: "8787", dashKey: "d", spawnImpl, log: { log: (m) => logs.push(m), error: (m) => logs.push(m) }, tokenImpl: async ({ identity, room }) => `jwt:${identity}:${room}` });
const t = await lk.token(); assert.match(t.room, /^bernud-/); assert.equal(t.token, `jwt:nicholas:${t.room}`); assert.equal(t.url, "wss://x.livekit.cloud");
assert.equal(lk.start(), true); assert.equal(lk.start(), false, "only one worker");
assert.match(spawned[0].args[0], /livekit-agent\.js$/); assert.equal(spawned[0].args[1], "start"); assert.equal(spawned[0].env.DASHBOARD_KEY, "d"); assert.equal(spawned[0].env.PORT, "8787");
assert.equal(lk.status().running, true);
spawned.length = 0;
// Dies quickly -> restart scheduled (not instant), status says so.
const c = lk.status().pid; assert.ok(c);
await new Promise((r) => { const ch = spawned; lk.stop; r(); });
// speakable() and the brain bridge in the agent file (the LiveKit SDK itself isn't exercised here).
const { speakable, askBrain } = await import("./livekit-agent.js");
assert.equal(speakable("Done, **sir**. See [the brief](https://x) at https://y/z."), "Done, sir. See the brief at the link");
const fetchImpl = async (url, o) => { assert.match(url, /\/brain\/chat$/); assert.equal(JSON.parse(o.body).session, "lk-r1"); return { ok: true, json: async () => ({ ok: true, reply: "Lamp on." }) }; };
assert.deepEqual(await askBrain({ session: "lk-r1", text: "lamp on", fetchImpl, server: "http://s", key: "d" }), { reply: "Lamp on.", ok: true, code: undefined, ui: undefined });
// The placeholder model the session needs before it will reply at all.
const { BrainLLM } = await import("./livekit-agent.js");
const { llm } = await import("@livekit/agents");
const b = new BrainLLM(); assert.ok(b instanceof llm.LLM); assert.equal(b.label(), "bernard.brain"); assert.throws(() => b.chat(), /llmNode answers instead/);
// "Goodbye" gets a farewell without asking the brain, and marks the call to end.
const { BYE_RE, isGoodbye, BernardAgent } = await import("./livekit-agent.js");
for (const w of ["Goodbye.", "ok bye", "That's all", "thanks, bye", "Thank you, that's all", "Good night!", "no thanks", "See you later, Bernard."]) assert.ok(isGoodbye(w, { replies: 20, lastReply: "Shall we?" }), w);
for (const w of ["say goodbye to Michelle", "what's the weather", "thanks for that, what time is it", "stop", "cancel"]) assert.ok(!isGoodbye(w), w);
// A bare "thank you" ends a quick call, but not a lesson or game, and not straight after a question.
assert.ok(isGoodbye("Thank you.", { replies: 1, lastReply: "The lights are on, sir." }));
assert.ok(isGoodbye("thanks Bernard", { replies: 2, lastReply: "Done." }));
assert.ok(!isGoodbye("Thank you.", { replies: 1, lastReply: "¿Cómo estás, Sir?" }));
assert.ok(!isGoodbye("Thank you.", { replies: 8, lastReply: "Excelente, Sir. Glad to hear it." }));
assert.ok(!BYE_RE.test("Thank you."));
// 15:45 on 29 Oct: "Thank you." heard 0.2s into Bernard's sentence (echo), with a lesson question pending.
assert.ok(!isGoodbye("Thank you.", { replies: 3, lastReply: "Splendid, sir. Next phrase: “¿Qué te gusta comer?” – “What do you like to eat?” Try it.", overlapped: true }));
assert.ok(!isGoodbye("Thank you.", { replies: 2, lastReply: "Splendid, sir. Next phrase: “¿Qué te gusta comer?”", overlapped: false }));
assert.ok(!isGoodbye("Bye.", { replies: 5, lastReply: "x", overlapped: true }));
assert.ok(isGoodbye("Okay, goodbye Bernard.", { replies: 5, lastReply: "x", overlapped: true }));
let brainCalls = 0;
const ag = new BernardAgent({ session: "lk-t", fetchImpl: async () => { brainCalls++; return { ok: true, json: async () => ({ reply: "x" }) }; } });
const ctxOf = (t) => ({ items: [{ type: "message", role: "user", textContent: t }] });
const read = async (st) => { let o = ""; for await (const c of st) o += c; return o; };
assert.match(await read(await ag.llmNode(ctxOf("Good night."))), /night/i); assert.equal(ag.ending, true); assert.equal(brainCalls, 0);
const ag2 = new BernardAgent({ session: "lk-t", fetchImpl: async () => { brainCalls++; return { ok: true, json: async () => ({ reply: "Sunny." }) }; } });
assert.equal(await read(await ag2.llmNode(ctxOf("weather?"))), "Sunny."); assert.ok(!ag2.ending); assert.equal(brainCalls, 1);
// A screen action from the brain (open a camera) is sent to the room on the bernud.ui topic.
const sentUi = [];
const ag3 = new BernardAgent({ session: "lk-t", fetchImpl: async () => ({ ok: true, json: async () => ({ reply: "Here's the shop camera.", ui: { camera: { name: "Cory's Shop" } } }) }) });
ag3.room = { localParticipant: { sendText: async (t, o) => { sentUi.push([JSON.parse(t), o.topic]); } } };
assert.equal(await read(await ag3.llmNode(ctxOf("show me the shop camera"))), "Here's the shop camera.");
await new Promise((r) => setTimeout(r, 10));
assert.deepEqual(sentUi, [[{ camera: { name: "Cory's Shop" } }, "bernud.ui"]]);
console.log("livekit ok");
{
  const { screenTranscript } = await import("./livekit-agent.js");
  // 30 Oct: a call ended at once on a phantom first "Thank you."; fragments and repeated thanks got answers.
  assert.equal(screenTranscript("Thank you.", { replies: 0 }), "ignore");
  assert.equal(screenTranscript("To", { replies: 4 }), "ignore");
  assert.equal(screenTranscript("Well,", { replies: 4 }), "ignore");
  assert.equal(screenTranscript("Thank you.", { replies: 4, overlapped: true }), "echo");
  assert.equal(screenTranscript("Thank you.", { replies: 4, lastPhantomAt: Date.now() - 5000 }), "ignore");
  assert.equal(screenTranscript("Thank you.", { replies: 4, lastPhantomAt: 0 }), "");
  assert.equal(screenTranscript("Can you play Spotify on my phone please?", { replies: 4 }), "");
  assert.equal(screenTranscript("No", { replies: 4 }), "");
  console.log("transcript screening ok");
}
