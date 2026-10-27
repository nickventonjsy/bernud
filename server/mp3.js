// PCM (16-bit mono) -> MP3, in pure JavaScript (lamejs), for Telegram voice notes from the free Gemini voice.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let lame = null;
const load = () => (lame ||= require("lamejs"));

export function pcmToMp3(pcm, sampleRate = 24000, kbps = 48) {
  const { Mp3Encoder } = load();
  const enc = new Mp3Encoder(1, sampleRate, kbps);
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
  const parts = [];
  for (let i = 0; i < samples.length; i += 1152 * 8) {
    const out = enc.encodeBuffer(samples.subarray(i, i + 1152 * 8));
    if (out.length) parts.push(Buffer.from(out));
  }
  const tail = enc.flush();
  if (tail.length) parts.push(Buffer.from(tail));
  return Buffer.concat(parts);
}
