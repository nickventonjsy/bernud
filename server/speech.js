// Bernard's own voice for the phone: text -> ElevenLabs TTS (his agent voice) -> short-lived MP3 link
// that Tasker downloads and plays. Clips live in memory for 10 minutes under an unguessable id.
import { randomBytes } from "node:crypto";

export const BERNUD_VOICE = { voiceId: "FSPps0MvpXbfUL4sNQRC", stability: 0.7, similarity_boost: 0.8, speed: 0.95 };
const MODELS = ["eleven_v4_turbo", "eleven_turbo_v2_5", "eleven_multilingual_v2"];

export function createSpeech({ apiKey, publicUrl, voice = BERNUD_VOICE, fetchImpl = fetch, ttlMs = 10 * 60_000, now = () => Date.now() }) {
  const clips = new Map();
  const sweep = () => { for (const [id, c] of clips) if (c.exp < now()) clips.delete(id); };

  async function tts(text) {
    let lastErr = "";
    for (const model_id of MODELS) {
      const r = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${voice.voiceId}?output_format=mp3_44100_64`, {
        method: "POST",
        headers: { "xi-api-key": apiKey, "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id, voice_settings: { stability: voice.stability, similarity_boost: voice.similarity_boost, speed: voice.speed } }),
        signal: AbortSignal.timeout(20_000),
      });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      lastErr = `${r.status} ${(await r.text().catch(() => "")).slice(0, 200)}`;
      if (r.status === 401 || r.status === 429) break; // bad key / out of credits: another model won't help
    }
    throw new Error("ElevenLabs TTS failed: " + lastErr);
  }

  return {
    enabled: () => Boolean(apiKey),
    // The spoken clip as MP3 bytes (for Telegram voice notes).
    mp3(text) { text = String(text || "").trim().slice(0, 1500); if (!text) throw new Error("nothing to say"); return tts(text); },
    // Returns a public URL for the spoken clip.
    async clip(text) {
      sweep();
      text = String(text || "").trim().slice(0, 600);
      if (!text) throw new Error("nothing to say");
      const audio = await tts(text);
      const id = randomBytes(16).toString("hex");
      clips.set(id, { audio, exp: now() + ttlMs });
      while (clips.size > 50) clips.delete(clips.keys().next().value);
      return `${publicUrl}/phone/audio/${id}.mp3`;
    },
    get(id) {
      sweep();
      const c = clips.get(String(id));
      return c ? c.audio : null;
    },
  };
}
