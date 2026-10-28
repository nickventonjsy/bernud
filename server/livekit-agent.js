// Bernard on LiveKit: the third voice engine. LiveKit carries the audio (WebRTC, turn-taking, interruptions);
// Groq's Whisper hears, Bernard's own free brain (brain.js, with all his tools) thinks, and ElevenLabs speaks
// in Bernard's own voice through plain text-to-speech, which costs a fraction of ElevenLabs Agents.
//
// Runs as a separate process (index.js starts it when LIVEKIT_URL/API_KEY/API_SECRET are set):
//   node server/livekit-agent.js start
// It talks to the main server over localhost for the brain, so it needs DASHBOARD_KEY and PORT in its env.
import { fileURLToPath } from "node:url";
import { cli, WorkerOptions, defineAgent, voice, InferenceRunner, llm } from "@livekit/agents";

// Memory: the Render instance has 512MB. Out of the box this library starts ~900MB of processes; three things trim it.
// 1) Don't preload LiveKit's local inference models into every call process (child processes inherit this).
process.env.LIVEKIT_AGENTS_PRELOAD_LOCAL_INFERENCE ??= "0";
// 2) Don't start LiveKit's audio end-of-turn model (~340MB process): Bernard decides turns from pauses (VAD), so it's
//    unused. The library registers it whenever its native binding is installed and has no off switch, so its slot in
//    the runner registry is made a silent, invisible no-op.
if (process.env.LIVEKIT_LOCAL_EOT !== "on") {
  const runners = {};
  Object.defineProperty(runners, "lk_eot_audio", { get: () => undefined, set: () => {}, enumerable: false, configurable: true });
  InferenceRunner.registeredRunners = runners;
}
// The speech plugins (and onnxruntime behind the VAD) are loaded only inside the job process that needs them,
// so the supervising worker process stays small: memory on Render is shared with the main server.

// Where Bernard's brain is: the main server. As its own Render service (bernud-voice) that's the public URL;
// run inline beside the main server it's localhost.
const SERVER = process.env.BERNUD_SERVER_URL || process.env.BERNUD_LOCAL || `http://127.0.0.1:${process.env.PORT || 10000}`;
const DASH_KEY = process.env.DASHBOARD_KEY || "";
const VOICE_ID = process.env.BERNARD_VOICE_ID || "FSPps0MvpXbfUL4sNQRC";   // Bernard's voice, the same one his ElevenLabs agent uses
// Same model as his ElevenLabs agent: the voice was made for v4 and sounds like someone else on older models.
const TTS_MODEL = process.env.LIVEKIT_TTS_MODEL || "eleven_v4_turbo";
const STT_MODEL = process.env.LIVEKIT_STT_MODEL || "whisper-large-v3-turbo";
// How long a pause counts as "finished speaking". Nicholas thinks mid-sentence, so err long.
const PAUSE_MS = Number(process.env.LIVEKIT_PAUSE_MS || 1400);

const GREETINGS = ["Hello, sir.", "Sir.", "At your service, sir.", "Good to hear you, Nicholas.", "Yes, sir?"];

// Bernard's brain lives in the main server (free mode's /brain/chat): one call per turn, with the same session
// so the conversation carries on. The reply comes back as plain text for ElevenLabs to speak.
export async function askBrain({ session, text, fetchImpl = fetch, server = SERVER, key = DASH_KEY }) {
  const r = await fetchImpl(`${server}/brain/chat`, {
    method: "POST", headers: { "content-type": "application/json", "x-dashboard-key": key },
    body: JSON.stringify({ session, text }), signal: AbortSignal.timeout(45_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `brain ${r.status}`);
  return { reply: String(j.reply || "").trim() || "I'm afraid I've nothing to say to that.", ok: j.ok !== false, code: j.code };
}

// Spoken replies shouldn't carry markdown, links or control tags meant for a screen.
export function speakable(text) {
  return String(text || "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/https?:\/\/\S+/g, "the link").replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
}

// The session refuses to reply at all unless it has an LLM ("trying to generate reply without an LLM model", raised
// silently inside its reply task). Bernard's thinking happens in his own brain via BernardAgent.llmNode, so this is a
// placeholder that satisfies that check and is never asked to chat.
export class BrainLLM extends llm.LLM {
  label() { return "bernard.brain"; }
  get model() { return "bernard-brain"; }
  get provider() { return "bernud-server"; }
  chat() { throw new Error("BrainLLM.chat should not be called: BernardAgent.llmNode answers instead"); }
}

// One plain line per event in Render's log, so a call that goes quiet can be traced.
const say = (msg) => console.log("[bernard] " + msg);

export class BernardAgent extends voice.Agent {
  constructor({ session, fetchImpl } = {}) {
    super({ instructions: "You are Bernud, Nicholas's butler. (The real instructions and tools live in Bernard's server.)" });
    this.session_id = session || "lk-" + Math.random().toString(36).slice(2);
    this.fetchImpl = fetchImpl || fetch;
  }
  // The whole "LLM" step: hand the last thing he said to Bernard's brain and stream the answer as text.
  async llmNode(chatCtx) {
    const last = [...chatCtx.items].reverse().find((i) => i.type === "message" && i.role === "user");
    const text = last ? (last.textContent ?? "") : "";
    if (!text.trim()) { say("brain: nothing to answer (empty transcript)"); return null; }
    let reply; const t0 = Date.now();
    try { reply = speakable((await askBrain({ session: this.session_id, text, fetchImpl: this.fetchImpl })).reply); say(`brain: ${Date.now() - t0}ms -> "${reply.slice(0, 80)}"`); }
    catch (e) { reply = "I'm afraid my brain didn't answer: " + String(e.message || e).slice(0, 80) + "."; say("brain error: " + String(e.message || e).slice(0, 200)); }
    return new ReadableStream({ start(c) { c.enqueue(reply); c.close(); } });
  }
}

export default defineAgent({
  prewarm: async (proc) => { const silero = await import("@livekit/agents-plugin-silero"); proc.userData.vad = await silero.VAD.load(); },
  entry: async (ctx) => {
    const [elevenlabs, openai] = await Promise.all([import("@livekit/agents-plugin-elevenlabs"), import("@livekit/agents-plugin-openai")]);
    await ctx.connect();
    const session = new voice.AgentSession({
      vad: ctx.proc.userData.vad,
      llm: new BrainLLM(),
      stt: openai.STT.withGroq({ model: STT_MODEL, apiKey: process.env.GROQ_API_KEY, language: "en" }),
      // Same voice and settings as his ElevenLabs agent (stability .7, similarity .8, a touch slower).
      tts: new elevenlabs.TTS({ voiceId: VOICE_ID, model: TTS_MODEL, apiKey: process.env.ELEVENLABS_API_KEY, language: "en", voiceSettings: { stability: 0.7, similarity_boost: 0.8, speed: 0.95, use_speaker_boost: true } }),
      turnHandling: { turnDetection: "vad", endpointing: { mode: "fixed", minDelay: PAUSE_MS, maxDelay: Math.max(PAUSE_MS + 1500, 3000), alpha: 0.9 } },
      voiceOptions: { allowInterruptions: true, minInterruptionDuration: 600, minInterruptionWords: 2 },
      userAwayTimeout: null,
    });
    say(`call in room ${ctx.room.name}; keys: groq ${process.env.GROQ_API_KEY ? "set" : "MISSING"}, elevenlabs ${process.env.ELEVENLABS_API_KEY ? "set" : "MISSING"}, dashboard ${DASH_KEY ? "set" : "MISSING"}; brain at ${SERVER}`);
    session.on("user_state_changed", (e) => say(`you: ${e.oldState} -> ${e.newState}`));
    session.on("agent_state_changed", (e) => say(`bernard: ${e.oldState} -> ${e.newState}`));
    session.on("user_input_transcribed", (e) => { if (e.isFinal) say(`heard: "${String(e.transcript).slice(0, 120)}"`); });
    session.on("speech_created", (e) => say(`speech created (${e.source}${e.userInitiated ? ", user-initiated" : ""})`));
    session.on("agent_false_interruption", () => say("false interruption (noise or echo cut him off)"));
    session.on("metrics_collected", (e) => { const m = e.metrics || {}; if (m.type === "stt_metrics") say(`stt: ${Math.round((m.audioDurationMs ?? m.audioDuration * 1000) || 0)}ms audio in ${Math.round(m.durationMs ?? m.duration * 1000 ?? 0)}ms`); else if (m.type === "tts_metrics") say(`tts: "${String(m.characters ?? "").slice(0, 6)}" chars, first audio after ${Math.round(m.ttfbMs ?? m.ttfb * 1000 ?? 0)}ms`); });
    session.on("error", (e) => say("ERROR " + (e.source?.constructor?.name || e.source || "") + ": " + String(e.error?.message || e.error || e).slice(0, 300)));
    session.on("close", (e) => say("closed: " + (e.reason || "") + (e.error ? " " + String(e.error.message || e.error).slice(0, 200) : "")));
    const agent = new BernardAgent({ session: "lk-" + ctx.room.name });
    await session.start({ agent, room: ctx.room, outputOptions: { transcriptionEnabled: true, syncTranscription: true } });
    // The greeting can't be interrupted, so the phone speaker's echo or a cough can't cut it off before it's heard.
    session.say(GREETINGS[Math.floor(Math.random() * GREETINGS.length)], { allowInterruptions: false });
  },
});

// Only when run directly (not when a test imports it).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // No warm spare job process: memory is shared with the main server on Render. A job starts on demand (~1s).
  // loadThreshold Infinity: on Render's shared CPUs the machine load reads ~100% all the time, which would make the
  // worker mark itself unavailable and never take a call. It's one person; always take the job.
  const opts = new WorkerOptions({ agent: fileURLToPath(import.meta.url), production: true, loadThreshold: Infinity, loadFunc: async () => 0,
    // Health port: localhost only when running beside the main server; 0.0.0.0:$PORT when this is its own Render service.
    host: process.env.LIVEKIT_HEALTH_HOST || "127.0.0.1", port: Number(process.env.LIVEKIT_HEALTH_PORT || 8081) });
  // 3) No warm spare call processes (each ~180MB); a call starts its own in about a second. The library treats 0 as
  //    "unset" (and the CLI rebuilds these options, so setting it afterwards is lost), but anything not > 0 means none:
  //    hence -1.
  opts.numIdleProcesses = Number(process.env.LIVEKIT_IDLE_PROCESSES || -1);
  cli.runApp(opts);
}
