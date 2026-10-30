// The "Jarvis" extras: house announcements, party mode, live sports, YouTube summaries, conversation rewind,
// the nightly diary, the morning audio news, and the data behind the TV's ambient screen.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TZ = "Europe/London";
const hhmm = (d) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(d);
const whenLabel = (d, now = new Date()) => (londonDay(d) === londonDay(now) ? "today" : new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(d)) + " at " + hhmm(d);
const londonDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);

// ESPN's public scoreboards (no key). Football first, then the big US sports and F1-free alternatives.
export const LEAGUES = [
  ["soccer", "eng.1"], ["soccer", "eng.2"], ["soccer", "uefa.champions"], ["soccer", "uefa.europa"], ["soccer", "eng.fa"], ["soccer", "eng.league_cup"],
  ["soccer", "sco.1"], ["soccer", "esp.1"], ["soccer", "ita.1"], ["soccer", "ger.1"], ["soccer", "fra.1"], ["soccer", "fifa.world"], ["soccer", "uefa.euro"],
  ["rugby", "164205"], ["football", "nfl"], ["basketball", "nba"],
];

// Same house connection: identical IPv4, or the same /64 for IPv6 (each device gets its own v6 address).
export function sameNetwork(a, b) {
  a = String(a || "").toLowerCase(); b = String(b || "").toLowerCase();
  if (!a || !b) return false;
  if (!a.includes(":") || !b.includes(":")) return a === b;
  const p = (x) => { const [h, t = ""] = x.split("::"); const hs = h ? h.split(":") : [], ts = t ? t.split(":") : []; const full = x.includes("::") ? [...hs, ...Array(8 - hs.length - ts.length).fill("0"), ...ts] : hs; return full.slice(0, 4).map((g) => parseInt(g || "0", 16)).join(":"); };
  return p(a) === p(b);
}

export function parseEspn(j) {
  return (j?.events || []).map((e) => {
    const c = e.competitions?.[0] || {};
    const teams = (c.competitors || []).map((t) => ({ name: t.team?.displayName || t.team?.name || "", short: t.team?.shortDisplayName || "", score: String(t.score ?? ""), home: t.homeAway === "home" }));
    const home = teams.find((t) => t.home) || teams[0] || {}, away = teams.find((t) => !t.home) || teams[1] || {};
    return { id: e.id, name: e.name || `${home.name} v ${away.name}`, start: e.date, state: e.status?.type?.state || "", detail: e.status?.type?.shortDetail || e.status?.type?.detail || "", home, away };
  });
}

export function createJarvis({ kv, notify, sayOnPhone, pc, telegram, lights, dj, brain, speakMp3, headlines, dayLog, voiceRequests, saveMemory, imou, eventsToday, parcels,
  elevenKey = "", agentId = "", fetchImpl = fetch, now = () => new Date(), log = console }) {

  // ---------- announcements to the house ----------
  async function announce({ text = "" } = {}) {
    text = String(text).trim().slice(0, 300);
    if (!text) return { ok: false, error: "What should I announce?" };
    const reached = [], missed = [];
    try { await sayOnPhone(text); reached.push("phone (Bernard's voice)"); } catch (e) { missed.push("phone: " + String(e.message).slice(0, 60)); }
    if (pc.online()) { pc.send("say", text); reached.push("PC"); }
    if (telegram?.configured) { const n = await telegram.broadcast(`📢 ${text}`).catch(() => 0); if (n) reached.push(`Telegram (${n} chat${n === 1 ? "" : "s"})`); }
    dayLog?.add("event", "Announcement: " + text.slice(0, 80));
    return { ok: reached.length > 0, reached, missed: missed.length ? missed : undefined, note: "The Echo speakers can't be made to speak by outside apps, so they aren't included." };
  }

  // ---------- party mode ----------
  let party = null;
  const PARTY_COLOURS = ["magenta", "blue", "purple", "orange", "cyan", "red", "green", "pink", "yellow"];
  async function partyMode({ action = "start", minutes = 30, mood = "party", music = true } = {}) {
    if (action === "stop") {
      if (party) { party.stop = true; party = null; }
      await lights.control({ device: "all", action: "white", value: "warm" }).catch(() => {});
      return { ok: true, stopped: true, note: "Lights back to warm white. The music keeps playing unless he asks to pause it." };
    }
    if (party) party.stop = true;
    const p = { stop: false, until: now().getTime() + Math.min(Math.max(Number(minutes) || 30, 1), 240) * 60_000 };
    party = p;
    let mix = null;
    if (music) mix = await dj.mix({ mood: mood || "party" }).catch((e) => ({ ok: false, message: e.message }));
    (async () => {
      let i = 0;
      while (!p.stop && now().getTime() < p.until) {
        await lights.control({ device: "all", action: "colour", value: PARTY_COLOURS[i++ % PARTY_COLOURS.length] }).catch(() => {});
        await sleep(8000);   // Govee allows about ten changes a minute per light
      }
      if (party === p) { party = null; await lights.control({ device: "all", action: "white", value: "warm" }).catch(() => {}); }
    })();
    return { ok: true, started: true, minutes: Math.round((p.until - now().getTime()) / 60_000), music: mix ? (mix.ok ? { title: mix.title, playing_on: mix.playing_on, starts_with: mix.starts_with?.[0] } : { failed: mix.message || mix.error }) : "not asked" };
  }

  // ---------- live sports ----------
  async function scoreboards() {
    const out = [];
    await Promise.all(LEAGUES.map(async ([sport, league]) => {
      try { const r = await fetchImpl(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard`, { signal: AbortSignal.timeout(8000) }); if (r.ok) for (const e of parseEspn(await r.json())) out.push({ ...e, sport, league }); } catch {}
    }));
    return out;
  }
  const matchTeam = (e, q) => { q = q.toLowerCase(); return [e.home.name, e.home.short, e.away.name, e.away.short].some((n) => n && (n.toLowerCase().includes(q) || q.includes(n.toLowerCase()))); };
  const line = (e) => `${e.home.name} ${e.home.score || 0}–${e.away.score || 0} ${e.away.name}`;
  async function sports({ action = "score", team = "" } = {}) {
    const all = await scoreboards();
    if (action === "stop") { await kv.set("sports_follow", ""); return { ok: true, stopped: true }; }
    const q = String(team).trim();
    const hits = q ? all.filter((e) => matchTeam(e, q)) : all.filter((e) => e.state === "in");
    if (action === "follow") {
      const e = hits.find((x) => x.state === "in") || hits.find((x) => x.state === "pre");
      if (!e) return { ok: false, error: "no_match", message: `I can't see an upcoming or live match for ${q || "that team"} in this round of fixtures.` };
      await kv.set("sports_follow", JSON.stringify({ id: e.id, sport: e.sport, league: e.league, last: `${e.home.score}-${e.away.score}`, state: e.state, name: e.name }));
      return { ok: true, following: e.name, status: e.state === "in" ? `${line(e)}, ${e.detail}` : `kicks off ${whenLabel(new Date(e.start), now())}`, note: "Goals and the final score will come to his Telegram." };
    }
    return { ok: true, matches: hits.slice(0, 8).map((e) => ({ match: e.name, league: e.league, status: e.state === "pre" ? `starts ${whenLabel(new Date(e.start), now())}` : e.state === "post" ? `finished: ${line(e)}` : `${line(e)} (${e.detail})` })), note: hits.length ? undefined : (q ? "That team isn't in the current round of fixtures I can see (football, rugby, NFL, NBA). Try web_search for their next match." : "Nothing is being played right now.") };
  }
  async function sportsTick() {
    let f = null; try { f = JSON.parse((await kv.get("sports_follow")) || "null"); } catch {}
    if (!f) return;
    try {
      const r = await fetchImpl(`https://site.api.espn.com/apis/site/v2/sports/${f.sport}/${f.league}/scoreboard`, { signal: AbortSignal.timeout(8000) });
      const e = parseEspn(await r.json()).find((x) => x.id === f.id);
      if (!e) return;
      const score = `${e.home.score}-${e.away.score}`;
      if (e.state === "in" && f.state === "pre") await notify(`Kick-off: ${e.name}.`, { title: "⚽ Under way" });
      if (score !== f.last && e.state !== "pre") await notify(`${line(e)} (${e.detail})`, { title: "⚽ Score update" });
      if (e.state === "post") { await notify(`Full time: ${line(e)}`, { title: "⚽ Final score" }); await kv.set("sports_follow", ""); return; }
      await kv.set("sports_follow", JSON.stringify({ ...f, last: score, state: e.state }));
    } catch (err) { log.error?.("sports", err.message); }
  }

  // ---------- YouTube in a nutshell ----------
  async function youtube({ url = "", question = "" } = {}) {
    const m = String(url).match(/(?:youtu\.be\/|v=|shorts\/|live\/)([\w-]{11})/);
    if (!m) return { ok: false, error: "Which video? I need a YouTube link." };
    const text = await brain.video({ url: `https://www.youtube.com/watch?v=${m[1]}`, prompt: question ? `Answer this about the video, briefly: ${question}` : "Summarise this video for a busy listener: what it's about in one sentence, then the 3 to 6 key points, then any practical takeaway. Plain sentences, no markdown, under 180 words." });
    return { ok: true, summary: text };
  }

  // ---------- conversation rewind ----------
  async function rewind({ query = "", days = 30 } = {}) {
    const q = String(query).trim();
    if (!q) return { ok: false, error: "What should I look back for?" };
    const words = q.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
    const hit = (s) => words.some((w) => String(s).toLowerCase().includes(w));
    const found = [];
    if (elevenKey) {
      const since = Math.floor((now().getTime() - Math.min(Number(days) || 30, 90) * 864e5) / 1000);
      const get = async (p) => (await fetchImpl("https://api.elevenlabs.io/v1/convai" + p, { headers: { "xi-api-key": elevenKey }, signal: AbortSignal.timeout(10_000) })).json();
      try {
        const list = (await get(`/conversations?agent_id=${agentId}&call_start_after_unix=${since}&page_size=30&search=${encodeURIComponent(q)}`)).conversations || [];
        for (const c of list.slice(0, 6)) {
          const d = await get(`/conversations/${c.conversation_id}`).catch(() => null);
          const when = new Date((c.start_time_unix_secs || 0) * 1000);
          for (const t of d?.transcript || []) if (t.message && hit(t.message)) found.push({ when: `${londonDay(when)} ${hhmm(when)}`, who: t.role === "user" ? "Nicholas" : "Bernard", said: String(t.message).slice(0, 240) });
        }
      } catch (e) { log.error?.("rewind", e.message); }
    }
    try { for (const e of await dayLog.search(words)) found.push(e); } catch {}
    return { ok: true, query: q, found: found.slice(0, 12), note: found.length ? "Quote what was said, with when. These are past conversations." : "Nothing found in the last month of conversations." };
  }

  // ---------- nightly diary ----------
  async function writeDiary() {
    const log1 = await dayLog.today().catch(() => ({ asked: [], events: [] }));
    const voice = await voiceRequests().catch(() => []);
    const asked = [...voice, ...(log1.asked || [])].filter((x) => !/good ?night|bed ?time/i.test(x)).slice(-40);
    if (!asked.length) return null;
    const text = await brain.complete({ prefer: "groq", maxTokens: 400, temperature: 0.7,
      system: "You are Bernud, Nicholas's butler, writing tonight's entry in his day diary from what he asked you today. Four to six warm, plain sentences in the first person plural ('we'), past tense: what he got up to, anything notable, one light touch of dry humour. Only use what the notes say; never invent. No lists, no headings.",
      text: `Date: ${londonDay(now())}\nWhat he asked or did today:\n- ${asked.join("\n- ")}` });
    const entry = `Diary ${londonDay(now())}: ${String(text).trim()}`;
    await saveMemory(entry.slice(0, 2000), "diary");
    log.log?.(`diary written (${entry.length} chars)`);
    return entry;
  }

  // ---------- morning audio news ----------
  async function newsAudio({ topics } = {}) {
    let t = topics; if (!t) { try { t = JSON.parse((await kv.get("news_audio_topics")) || "null"); } catch {} }
    t = Array.isArray(t) && t.length ? t : ["uk", "jersey", "tech"];
    const items = [];
    for (const topic of t) { try { for (const h of (await headlines(topic, 4)).slice(0, 4)) items.push(`[${topic}] ${h.title}${h.summary ? " — " + String(h.summary).slice(0, 160) : ""}`); } catch {} }
    if (!items.length) return { ok: false, message: "Couldn't fetch the news." };
    const script = await brain.complete({ prefer: "groq", maxTokens: 450, temperature: 0.6,
      system: "You are Bernud, a dry-witted English butler, reading Nicholas a short morning news bulletin aloud. Write it as one flowing spoken script under 1,000 characters: a one-line greeting, the stories that matter most grouped by topic, plainly told, then a one-line sign-off. Only use the headlines given. No lists, symbols or URLs.",
      text: items.join("\n") });
    const audio = await speakMp3(script);
    if (!audio?.mp3) { log.error?.("news audio: no audio made"); return { ok: false, message: "Couldn't make the audio.", script }; }
    const sent = await telegram.audio(audio.mp3, "🎙 Your morning news from Bernud").catch((e) => { log.error?.("news audio send", e.message); return false; });
    log.log?.(`news audio: ${sent ? "sent" : "NOT sent"} (${script.length} chars, ${audio.voice} voice)`);
    return { ok: Boolean(sent), sent, chars: script.length, voice: audio.voice };
  }

  // ---------- the TV's ambient screen ----------
  let ambientCache = null;
  async function ambient() {
    if (ambientCache && Date.now() - ambientCache.at < 60_000) return ambientCache.value;
    const [weather, news, events, coming, cams] = await Promise.all([
      fetchImpl("https://api.open-meteo.com/v1/forecast?latitude=49.19&longitude=-2.11&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Europe%2FLondon&forecast_days=1", { signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => null),
      headlines("uk", 6).catch(() => []),
      eventsToday().catch(() => []),
      parcels.lines().catch(() => []),
      imou.cameras().catch(() => []),
    ]);
    const snaps = [];
    for (const c of cams.filter((c) => c.online).slice(0, 4)) { try { snaps.push({ camera: c.name, url: await imou.snapshot(c) }); } catch {} }
    const value = { ok: true,
      weather: weather?.current ? { now: Math.round(weather.current.temperature_2m), code: weather.current.weather_code, wind: Math.round(weather.current.wind_speed_10m), high: Math.round(weather.daily?.temperature_2m_max?.[0]), low: Math.round(weather.daily?.temperature_2m_min?.[0]), rain: weather.daily?.precipitation_probability_max?.[0] } : null,
      news: news.map((h) => h.title).slice(0, 6), events: events.slice(0, 4).map((e) => ({ title: e.title, when: e.all_day ? "All day" : hhmm(new Date(e.start)) })), parcels: coming.slice(0, 3), cameras: snaps };
    ambientCache = { at: Date.now(), value };
    return value;
  }

  let timer = null;
  return { announce, partyMode, sports, sportsTick, youtube, rewind, writeDiary, newsAudio, ambient,
    start() { if (timer) return; timer = setInterval(() => sportsTick().catch(() => {}), 60_000); timer.unref?.(); } };
}
