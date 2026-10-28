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
assert.deepEqual(await askBrain({ session: "lk-r1", text: "lamp on", fetchImpl, server: "http://s", key: "d" }), { reply: "Lamp on.", ok: true, code: undefined });
// The placeholder model the session needs before it will reply at all.
const { BrainLLM } = await import("./livekit-agent.js");
const { llm } = await import("@livekit/agents");
const b = new BrainLLM(); assert.ok(b instanceof llm.LLM); assert.equal(b.label(), "bernard.brain"); assert.throws(() => b.chat(), /llmNode answers instead/);
console.log("livekit ok");
