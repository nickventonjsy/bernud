// Gemini's own voices (Gemini 3.8 Flash TTS, free on Google's free tier) for Bernard's free mode.
// The server turns Bernard's reply into a WAV and the phone/PC just plays it.
const API = "https://generativelanguage.googleapis.com/v1beta";

export const PREBUILT = [
  ["Zephyr", "Bright"], ["Puck", "Upbeat"], ["Charon", "Informative"], ["Kore", "Firm"], ["Fenrir", "Excitable"],
  ["Leda", "Youthful"], ["Orus", "Firm"], ["Aoede", "Breezy"], ["Callirrhoe", "Easy-going"], ["Autonoe", "Bright"],
  ["Enceladus", "Breathy"], ["Iapetus", "Clear"], ["Umbriel", "Easy-going"], ["Algieba", "Smooth"], ["Despina", "Smooth"],
  ["Erinome", "Clear"], ["Algenib", "Gravelly"], ["Rasalgethi", "Informative"], ["Laomedeia", "Upbeat"], ["Achernar", "Soft"],
  ["Alnilam", "Firm"], ["Schedar", "Even"], ["Gacrux", "Mature"], ["Pulcherrima", "Forward"], ["Achird", "Friendly"],
  ["Zubenelgenubi", "Casual"], ["Sadachbia", "Lively"], ["Sadaltager", "Knowledgeable"], ["Sulafat", "Warm"], ["Vindemiatrix", "Gentle"],
].map(([id, d]) => ({ id, name: id, description: d, source: "prebuilt" }));

// How the voice should say his name: spelt out phonetically, because Gemini reads "Bernud" as "Bernard".
export const DEFAULT_NAME_SOUND = "Bur-nud";
export function sayName(text, sound = DEFAULT_NAME_SOUND) {
  return String(text).replace(/\bB(?:e|u)rn(?:u|a|ou)r?d+\b/gi, sound || DEFAULT_NAME_SOUND);
}
export const DEFAULT_STYLE = "A calm, well-spoken English butler with a dry wit: measured pace, warm and quietly amused, never rushed.";

// Find the base64 audio wherever the response puts it (steps[].content[] in REST, output_audio in SDKs).
export function findAudio(j) {
  if (!j || typeof j !== "object") return null;
  if (j.output_audio?.data) return j.output_audio.data;
  const items = [];
  for (const s of j.steps || j.outputs || []) for (const c of s.content || []) items.push(c);
  const a = items.filter((c) => c && (c.type === "audio" || /^audio\//.test(c.mime_type || c.mimeType || "")) && c.data).pop();
  if (a) return a.data;
  const inline = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
  return inline || null;
}

// Wrap raw 24 kHz mono 16-bit PCM in a WAV header (only needed if Google sends headerless audio).
export function toWav(buf, rate = 24000) {
  if (buf.subarray(0, 4).toString("ascii") === "RIFF") return buf;
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + buf.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(buf.length, 40);
  return Buffer.concat([h, buf]);
}

export function createGeminiVoice({ apiKey, models = ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"], fetchImpl = fetch, log = console }) {
  let library = null, libraryAt = 0;

  async function voices() {
    if (library && Date.now() - libraryAt < 24 * 3600_000) return library;
    let british = [];
    try {
      const u = new URL(`${API}/voices`);
      u.searchParams.set("language_code", "en-GB"); u.searchParams.set("page_size", "200");
      const r = await fetchImpl(u, { headers: { "x-goog-api-key": apiKey }, signal: AbortSignal.timeout(15_000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error?.message || `voices ${r.status}`);
      british = (j.voices || []).filter((v) => v.id).map((v) => ({
        id: v.id, name: v.display_name || v.displayName || v.id,
        gender: v.gender || "", description: [v.gender, v.accent, v.pitch && `${v.pitch} voice`].filter(Boolean).join(", ").slice(0, 80), source: "british",
      })).sort((a, b) => (a.gender === "male" ? 0 : 1) - (b.gender === "male" ? 0 : 1) || a.description.localeCompare(b.description));
    } catch (e) { log.error?.("gemini voices", e.message); }
    library = [...british, ...PREBUILT]; libraryAt = Date.now();
    if (!british.length) libraryAt = Date.now() - 23 * 3600_000; // retry the British list within the hour
    return library;
  }

  async function speak({ text, voice = "Charon", style = DEFAULT_STYLE, nameSound = DEFAULT_NAME_SOUND }) {
    if (!apiKey) throw Object.assign(new Error("No Gemini key"), { status: 503 });
    text = sayName(String(text || "").trim().slice(0, 3000), String(nameSound || DEFAULT_NAME_SOUND).slice(0, 40));
    if (!text) throw Object.assign(new Error("Nothing to say"), { status: 400 });
    let last;
    for (const model of models) {
      try {
        const body = {
          model,
          input: [{ type: "user_input", content: [{ type: "text", text, annotations: [{ type: "speech_metadata", style: String(style || DEFAULT_STYLE).slice(0, 400) }] }] }],
          response_format: { type: "audio" },
          generation_config: { speech_config: [{ voice: String(voice || "Charon") }] },
        };
        const r = await fetchImpl(`${API}/interactions`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": apiKey }, body: JSON.stringify(body), signal: AbortSignal.timeout(25_000) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw Object.assign(new Error(j.error?.message || `TTS ${r.status}`), { status: r.status });
        const b64 = findAudio(j);
        if (!b64) throw Object.assign(new Error("No audio in Google's reply"), { status: 502 });
        return { model, wav: toWav(Buffer.from(b64, "base64")) };
      } catch (e) {
        last = e.name === "TimeoutError" ? Object.assign(new Error("Google's voice took too long"), { status: 504 }) : e;
        log.error?.("gemini tts", model, last.status, String(last.message).slice(0, 200));
        if (!(last.status === 429 || last.status >= 500 || last.status === 404)) break;
      }
    }
    throw last;
  }

  return { voices, speak, configured: () => !!apiKey };
}
