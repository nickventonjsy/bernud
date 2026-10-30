// "Play X on Michelle's Echo": find a Spotify Connect speaker by name and play there (music only; Bernard stays on the phone).
export function createSpeakers({ zw, dj, fetchImpl = fetch, wakePhone = null, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const call = async (path, body) => {
    if (!zw.url || !zw.key) throw new Error("Spotify isn't linked: ZentraWire's assistant key is missing on the server.");
    const r = await fetchImpl(`${zw.url}${path}`, { method: body ? "POST" : "GET", headers: { "x-zw-assistant": zw.key, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) });
    return r.json().catch(() => ({}));
  };
  const words = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !["the", "my", "s", "speaker"].includes(w));

  const isPhone = (d) => /smartphone/i.test(d?.type || "");
  async function findDevice(name) {
    const j = await call("/api/assistant/spotify?what=devices");
    if (j.ok === false) throw new Error(j.error || "Couldn't read your Spotify speakers.");
    const list = j.devices || [];
    const want = words(name || "echo").concat(/michelle/i.test(name || "") ? ["echo"] : []);
    const score = (d) => words(d.name + " " + d.type).filter((w) => want.some((x) => w.startsWith(x) || x.startsWith(w))).length;
    // "my phone" / "mobile" means the Spotify device of type Smartphone (named e.g. "Nick's S24 Ultra").
    if (/\b(phone|mobile|s2\d|galaxy)\b/i.test(name || "")) { const ph = list.find((d) => /smartphone/i.test(d.type)); if (ph) return { device: ph, all: list.map((d) => d.name) }; }
    const best = list.map((d) => [score(d), d]).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0])[0];
    return { device: best ? best[1] : null, all: list.map((d) => d.name) };
  }

  async function pick(query) {
    const q = String(query || "").trim();
    const sc = await call("/api/assistant/spotify?what=shortcuts").catch(() => ({}));
    const short = (sc.shortcuts || []).find((s) => s.uri && (q.toLowerCase().includes(String(s.label).toLowerCase()) || (s.name && q.toLowerCase().includes(String(s.name).toLowerCase().slice(0, 12)))));
    if (short) return { uri: short.uri, label: short.name || short.label };
    const r = await call(`/api/assistant/spotify?what=search&q=${encodeURIComponent(q.replace(/\b(playlist|song|album|by)\b/gi, " ").trim())}`);
    if (/\bplaylist\b/i.test(q) && r.playlists?.[0]) return { uri: r.playlists[0].uri, label: r.playlists[0].name };
    const artist = r.artists?.[0];
    if (artist && artist.name.toLowerCase() === q.toLowerCase()) return { uri: artist.uri, label: artist.name };
    if (r.tracks?.[0]) return { uri: r.tracks[0].uri, label: `${r.tracks[0].name} by ${r.tracks[0].artists}` };
    if (r.playlists?.[0]) return { uri: r.playlists[0].uri, label: r.playlists[0].name };
    return null;
  }

  // { device: "michelle's echo", query: "Michelle's oldies" | mood: "a Friday evening" | neither = move what's playing }
  async function playOn({ device = "echo", query = "", mood = "" } = {}) {
    let { device: d, all } = await findDevice(device);
    // His phone only shows up in Spotify while the Spotify app is open on it: open it there, then wait for it to appear.
    if (!d && wakePhone && /\b(phone|mobile|s2\d|galaxy)\b/i.test(device || "")) {
      try {
        await wakePhone();
        for (let i = 0; i < 8 && !d; i++) { await sleep(1500); ({ device: d, all } = await findDevice(device)); }
      } catch {}
      if (!d) return { ok: false, error: "phone_not_in_spotify", message: "I opened Spotify on his phone but it still hasn't shown up as a Spotify device. Ask him to tap play once in Spotify on the phone, then try again." };
    }
    if (!d) return { ok: false, error: "speaker_not_found", message: `Spotify isn't listing ${device || "that speaker"} for you right now${all.length ? ` (I can see: ${all.join(", ")})` : ""}. Pick it once from the Spotify app on your phone (speaker icon), then ask me again.` };
    if (mood) {
      const r = await dj.mix({ mood, device_id: d.id });
      return r.ok ? { ...r, device: d.name, phone: isPhone(d) } : r;
    }
    if (!String(query).trim()) {
      const r = await call("/api/assistant/spotify/control", { action: "transfer", value: d.id });
      return r.ok === false ? { ok: false, error: "transfer_failed", message: r.error || "Spotify wouldn't move the music." } : { ok: true, device: d.name, moved: true, phone: isPhone(d) };
    }
    const found = await pick(query);
    if (!found) return { ok: false, error: "not_found", message: `I couldn't find "${query}" on Spotify.` };
    const r = await call("/api/assistant/spotify/control", { action: "play", uri: found.uri, device_id: d.id });
    return r.ok === false ? { ok: false, error: "play_failed", message: r.error || "Spotify wouldn't start it on that speaker." } : { ok: true, device: d.name, playing: found.label, phone: isPhone(d) };
  }
  return { playOn, findDevice, isPhone };
}
