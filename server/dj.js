// Spotify DJ: builds a mix for a mood ("Friday evening", "a long drive") from Nicholas's own liked songs,
// then plays it through ZentraWire's Spotify connection. The AI only picks from his library, so every track is real.
const SYSTEM = `You are a DJ picking music from one person's own liked songs.
You get a mood or occasion and a numbered list of their songs (title, artist, year).
Pick the songs that best fit the mood, using what you know about each song's feel, tempo and genre, and order them so the mix flows (ease in, build, land well).
Only use numbers from the list. Don't repeat a song. Avoid more than two songs in a row by the same artist.
Reply with JSON only: {"title": "a short, fun name for the mix (max 5 words)", "picks": [numbers]}`;

const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export function parsePicks(raw, max) {
  const m = String(raw || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j; try { j = JSON.parse(m[0]); } catch { return null; }
  const seen = new Set();
  const picks = (Array.isArray(j.picks) ? j.picks : []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= max && !seen.has(n) && seen.add(n));
  return { title: String(j.title || "").replace(/["“”]/g, "").slice(0, 60).trim(), picks };
}

export function createDJ({ zw, complete, fetchImpl = fetch, sample = 300 }) {
  const zwCall = async (path, body) => {
    if (!zw.url || !zw.key) throw Object.assign(new Error("Spotify isn't linked: ZentraWire's assistant key is missing on the server."), { code: "not_set_up" });
    const r = await fetchImpl(`${zw.url}${path}`, { method: body ? "POST" : "GET", headers: { "x-zw-assistant": zw.key, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) throw new Error("ZentraWire refused Bernard's key.");
    return j;
  };

  async function mix({ mood = "", count = 25, device_id = "" } = {}) {
    mood = String(mood || "").trim().slice(0, 120);
    if (!mood) return { ok: false, error: "no_mood", message: "What sort of mood or occasion is the mix for?" };
    count = Math.min(Math.max(Math.round(Number(count) || 25), 8), 50);
    const lib = await zwCall("/api/assistant/spotify?what=library");
    if (lib.ok === false) return { ok: false, error: "spotify", message: lib.error || "Couldn't read your Spotify library." };
    const all = lib.tracks || [];
    if (all.length < 15) return { ok: false, error: "small_library", message: `Your Spotify liked songs only has ${all.length} tracks, which isn't enough to build a mix. Like a few more songs, or ask for a playlist instead.` };
    const pool = all.length > sample ? shuffle(all).slice(0, sample) : all;
    const list = pool.map((t, i) => `${i + 1}. ${t.n} - ${t.a}${t.y ? ` (${t.y})` : ""}`).join("\n");
    const raw = await complete({ system: SYSTEM, text: `Mood: ${mood}\nPick about ${count} songs.\n\n${list}`, maxTokens: 400, temperature: 0.7, prefer: "gemini", json: true });
    const got = parsePicks(raw, pool.length);
    if (!got || got.picks.length < 5) return { ok: false, error: "no_picks", message: "I couldn't find enough of your songs to fit that. Try a different mood." };
    const tracks = got.picks.slice(0, count).map((n) => pool[n - 1]);
    await zwCall("/api/assistant/spotify/control", { action: "shuffle", value: false, device_id: device_id || undefined }).catch(() => {}); // keep the running order
    const play = await zwCall("/api/assistant/spotify/control", { action: "play", uris: tracks.map((t) => t.u), device_id: device_id || undefined });
    if (play.ok === false) return { ok: false, error: "play_failed", message: play.error || "Spotify wouldn't start the mix.", hint: "No Spotify device could be woken. Open Spotify once on the device he wants so it shows up, then try again." };
    return { ok: true, title: got.title || "Your mix", mood, ...(play.device ? { playing_on: play.device } : {}), tracks: tracks.length, from_library: all.length, starts_with: tracks.slice(0, 3).map((t) => `${t.n} by ${t.a}`) };
  }

  return { mix };
}
