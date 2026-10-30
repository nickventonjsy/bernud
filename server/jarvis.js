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
  elevenKey = "", agentId = "", fetchImpl = fetch, now = () => new Date(), log = console,
  pauseMusic = async () => {}, tvOff = async () => {} }) {

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

  // ---------- "remind me when I get home" ----------
  const loadJ = async (k, d) => { try { return JSON.parse((await kv.get(k)) || "null") ?? d; } catch { return d; } };
  async function homeReminders({ action = "list", text = "", id = "" } = {}) {
    let list = await loadJ("home_reminders", []);
    if (action === "add") {
      text = String(text).trim().slice(0, 300);
      if (!text) return { ok: false, error: "What should I remind him of when he gets home?" };
      list.push({ id: Math.random().toString(36).slice(2, 8), text, at: now().toISOString() });
      await kv.set("home_reminders", JSON.stringify(list.slice(-20)));
      return { ok: true, added: text, waiting: list.length, note: "It goes off the next time his phone joins the home Wi-Fi after he's been out (the Bernard app needs to be running, and the home Wi-Fi set once from the dashboard)." };
    }
    if (action === "cancel") {
      const q = String(id || text).toLowerCase();
      const keep = list.filter((r) => r.id !== q && !(q && r.text.toLowerCase().includes(q)));
      await kv.set("home_reminders", JSON.stringify(keep));
      return { ok: true, removed: list.length - keep.length, waiting: keep.length };
    }
    return { ok: true, reminders: list.map((r) => ({ id: r.id, text: r.text })), note: list.length ? undefined : "No reminders waiting for when he gets home." };
  }
  // Called when he arrives home: say them on the phone and send them to Telegram, then clear them.
  async function arrivedHome() {
    const list = await loadJ("home_reminders", []);
    if (!list.length) return [];
    await kv.set("home_reminders", "[]");
    const lines = list.map((r) => r.text);
    try { await sayOnPhone(`Welcome back, sir. You asked me to remind you: ${lines.join(". And ")}.`); } catch {}
    await notify(lines.map((l) => "• " + l).join("\n"), { title: "🏠 Now you're home" }).catch(() => {});
    dayLog?.add("event", `Home reminders: ${lines.length}`);
    return lines;
  }

  // ---------- sleep timer: music / TV / lights off later ----------
  const WHAT = { music: "the music", tv: "the TV", lights: "the lights", all: "the music, TV and lights" };
  async function sleepTimer({ action = "set", what = "music", minutes = 30, device = "" } = {}) {
    let list = await loadJ("sleep_timers", []);
    if (action === "cancel") { const before = list.length; list = what && what !== "all_timers" ? list.filter((t) => t.what !== what) : []; await kv.set("sleep_timers", JSON.stringify(list)); return { ok: true, cancelled: before - list.length }; }
    if (action === "list") return { ok: true, timers: list.map((t) => ({ what: WHAT[t.what], at: hhmm(new Date(t.due)) })) };
    if (!WHAT[what]) return { ok: false, error: "Which: music, tv, lights or all?" };
    const m = Math.min(Math.max(Number(minutes) || 30, 1), 600);
    const due = now().getTime() + m * 60_000;
    list = [...list.filter((t) => t.what !== what), { what, due, device: String(device || "").slice(0, 40) }];
    await kv.set("sleep_timers", JSON.stringify(list));
    return { ok: true, what: WHAT[what], minutes: m, at: hhmm(new Date(due)) };
  }
  async function sleepTick() {
    const list = await loadJ("sleep_timers", []);
    if (!list.length) return;
    const t = now().getTime(), due = list.filter((x) => x.due <= t);
    if (!due.length) return;
    await kv.set("sleep_timers", JSON.stringify(list.filter((x) => x.due > t)));
    for (const x of due) {
      if (x.what === "music" || x.what === "all") await pauseMusic().catch((e) => log.error?.("sleep timer music", e.message));
      if (x.what === "tv" || x.what === "all") await tvOff(x.device || "").catch((e) => log.error?.("sleep timer tv", e.message));
      if (x.what === "lights" || x.what === "all") await lights.control({ device: "all", action: "off" }).catch((e) => log.error?.("sleep timer lights", e.message));
      dayLog?.add("event", `Sleep timer: ${WHAT[x.what]} off`);
      log.log?.(`sleep timer: ${x.what} off`);
    }
  }

  // ---------- countdowns: "how many days until my holiday?" ----------
  const londonDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);   // YYYY-MM-DD
  const dayNum = (ymd) => Math.round(Date.parse(ymd + "T12:00:00Z") / 864e5);
  const BUILT_IN = { christmas: "12-25", "christmas day": "12-25", "christmas eve": "12-24", "new year": "01-01", "new year's day": "01-01", "new year's eve": "12-31", halloween: "10-31", "bonfire night": "11-05", "valentine's day": "02-14", "liberation day": "05-09" };
  function nextDate(c, today) {
    if (!c.yearly) return c.date;
    const md = c.date.slice(5), y = Number(today.slice(0, 4));
    return `${y}-${md}` >= today ? `${y}-${md}` : `${y + 1}-${md}`;
  }
  async function countdown({ action = "list", name = "", date = "", yearly = false } = {}) {
    let list = await loadJ("countdowns", []);
    const today = londonDay(now());
    const view = (c) => { const d = nextDate(c, today), n = dayNum(d) - dayNum(today); return { name: c.name, date: d, days: n, weeks: n >= 14 ? Math.floor(n / 7) : undefined, says: n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days` }; };
    const key = String(name).toLowerCase().trim();
    if (action === "add") {
      if (!key) return { ok: false, error: "What's the countdown called?" };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return { ok: false, error: "Give the date as YYYY-MM-DD." };
      if (date < today && !yearly) return { ok: false, error: "That date has already passed." };
      list = [...list.filter((c) => c.name.toLowerCase() !== key), { name: String(name).trim().slice(0, 60), date, yearly: Boolean(yearly) }];
      await kv.set("countdowns", JSON.stringify(list.slice(-30)));
      return { ok: true, ...view(list.at(-1)) };
    }
    if (action === "remove") {
      const keep = list.filter((c) => !c.name.toLowerCase().includes(key));
      await kv.set("countdowns", JSON.stringify(keep));
      return { ok: true, removed: list.length - keep.length };
    }
    // "how long until X": a saved one, else a built-in date like Christmas.
    if (key) {
      const hit = list.find((c) => c.name.toLowerCase() === key) || list.find((c) => c.name.toLowerCase().includes(key) || key.includes(c.name.toLowerCase()));
      if (hit) return { ok: true, ...view(hit) };
      const b = Object.keys(BUILT_IN).find((k) => key === k || key.replace(/^the /, "") === k);
      if (b) return { ok: true, ...view({ name: b.replace(/\b\w/g, (m) => m.toUpperCase()), date: "2000-" + BUILT_IN[b], yearly: true }) };
      return { ok: false, error: `No countdown called "${name}". Ask him for the date and add it.`, saved: list.map((c) => c.name) };
    }
    return { ok: true, countdowns: list.map(view).sort((a, b) => a.days - b.days), note: list.length ? undefined : "No countdowns saved yet." };
  }
  // Once a day after 8am: a nudge for anything a week away or tomorrow; one-off countdowns are tidied once passed.
  async function countdownTick() {
    const t = now(), today = londonDay(t);
    if (Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "numeric", hour12: false }).format(t)) % 24 < 8) return;
    if ((await kv.get("countdown_checked")) === today) return;
    await kv.set("countdown_checked", today);
    const list = await loadJ("countdowns", []);
    const keep = list.filter((c) => c.yearly || c.date >= today);
    if (keep.length !== list.length) await kv.set("countdowns", JSON.stringify(keep));
    for (const c of keep) {
      const n = dayNum(nextDate(c, today)) - dayNum(today);
      if (n === 7 || n === 1 || n === 0) await notify(n === 0 ? `It's ${c.name} today.` : `${c.name} is ${n === 1 ? "tomorrow" : "a week today"}.`, { title: "⏳ Countdown" }).catch(() => {});
    }
  }

  // ---------- life log: "log that I changed the oil" / "when did I last…" ----------
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\b(the|a|an|my|i|did|last|time|that|of|to|went|go|was|have|had)\b/g, " ").replace(/\s+/g, " ").trim();
  const sameThing = (a, b) => { const x = norm(a), y = norm(b); if (!x || !y) return false; if (x.includes(y) || y.includes(x)) return true; const xs = x.split(" ").filter((w) => w.length > 2); return xs.length > 0 && xs.filter((w) => y.split(" ").some((v) => v.startsWith(w.slice(0, 4)))).length >= Math.ceil(xs.length / 2); };
  const ago = (ms) => { const d = Math.floor(ms / 864e5); return d === 0 ? "today" : d === 1 ? "yesterday" : d < 14 ? `${d} days ago` : d < 60 ? `${Math.round(d / 7)} weeks ago` : `${Math.round(d / 30)} months ago`; };
  async function lifeLog({ action = "list", thing = "", note = "", days = 30, when = "" } = {}) {
    let list = await loadJ("life_log", []);
    const t = now();
    if (action === "log") {
      thing = String(thing).trim().slice(0, 80);
      if (!thing) return { ok: false, error: "What should I log?" };
      const at = /^\d{4}-\d{2}-\d{2}/.test(String(when)) ? new Date(when).toISOString() : t.toISOString();
      list.push({ thing, note: String(note || "").slice(0, 200), at });
      await kv.set("life_log", JSON.stringify(list.slice(-1500)));
      const before = list.filter((e) => sameThing(e.thing, thing) && e.at < at).at(-1);
      return { ok: true, logged: thing, previous: before ? ago(Date.parse(at) - Date.parse(before.at)) + " before that" : "first time logged" };
    }
    if (action === "last") {
      const hit = list.filter((e) => sameThing(e.thing, thing)).sort((a, b) => a.at.localeCompare(b.at)).at(-1);
      if (!hit) return { ok: true, found: false, note: `Nothing logged for "${thing}". It only knows what he's told it to log.` };
      return { ok: true, found: true, thing: hit.thing, when: ago(t - new Date(hit.at)), date: londonDay(new Date(hit.at)), note: hit.note || undefined };
    }
    if (action === "count") {
      const since = t.getTime() - Math.min(Math.max(Number(days) || 30, 1), 3650) * 864e5;
      const hits = list.filter((e) => sameThing(e.thing, thing) && Date.parse(e.at) >= since);
      return { ok: true, thing, times: hits.length, days: Number(days) || 30, dates: hits.slice(-10).map((e) => londonDay(new Date(e.at))) };
    }
    if (action === "undo") { const gone = list.pop(); await kv.set("life_log", JSON.stringify(list)); return { ok: true, removed: gone?.thing || null }; }
    const counts = {};
    for (const e of list) { const k = e.thing.toLowerCase(); counts[k] = { thing: e.thing, times: (counts[k]?.times || 0) + 1, last: e.at }; }
    return { ok: true, things: Object.values(counts).sort((a, b) => b.last.localeCompare(a.last)).slice(0, 25).map((c) => ({ thing: c.thing, times: c.times, last: ago(t - new Date(c.last)) })) };
  }

  // ---------- focus mode: bright cool light, focus music, a break call when time's up ----------
  async function focus({ action = "start", minutes = 25, music = true, light = true } = {}) {
    const cur = await loadJ("focus_session", null);
    const t = now().getTime();
    if (action === "status") return cur ? { ok: true, running: true, minutes_left: Math.max(0, Math.ceil((cur.due - t) / 60_000)), ends: hhmm(new Date(cur.due)) } : { ok: true, running: false };
    if (action === "stop") {
      if (!cur) return { ok: true, running: false };
      await kv.set("focus_session", "null");
      const done = Math.round((t - cur.started) / 60_000);
      if (done >= 5) await lifeLog({ action: "log", thing: "focus session", note: `${done} minutes (stopped early)` });
      return { ok: true, stopped: true, minutes_done: done };
    }
    const m = Math.min(Math.max(Number(minutes) || 25, 5), 180);
    const s = { started: t, due: t + m * 60_000, minutes: m };
    await kv.set("focus_session", JSON.stringify(s));
    const did = [];
    if (light) { try { const r = await lights.control({ device: "all", action: "white", value: "cool" }); if (r?.ok !== false) did.push("lights to cool white"); } catch (e) { log.error?.("focus lights", e.message); } }
    if (music && dj?.mix) { try { const r = await dj.mix({ mood: "focus: deep work, steady and calm, few vocals" }); if (r?.ok) did.push(`focus music on ${r.playing_on || "Spotify"}`); } catch (e) { log.error?.("focus music", e.message); } }
    return { ok: true, minutes: m, ends: hhmm(new Date(s.due)), done: did, note: "He gets a spoken break call on the phone and a notification when it ends." };
  }
  async function focusTick() {
    const cur = await loadJ("focus_session", null);
    if (!cur || cur.due > now().getTime()) return;
    await kv.set("focus_session", "null");
    await lifeLog({ action: "log", thing: "focus session", note: `${cur.minutes} minutes` });
    const n = (await lifeLog({ action: "count", thing: "focus session", days: 1 })).times;
    const line = `Time's up, sir. That's ${cur.minutes} minutes of focus${n > 1 ? `, and ${n} sessions today` : ""}. Take a short break.`;
    await pauseMusic().catch(() => {});
    try { await sayOnPhone(line); } catch {}
    await notify(line, { title: "🎯 Focus done" }).catch(() => {});
  }

  // ---------- away check: did he leave lights or a TV on? ----------
  const AWAY = { enabled: true, auto_off: false, after_minutes: 10 };
  async function awayCheck({ action = "status" } = {}) {
    const cfg = { ...AWAY, ...(await loadJ("away_check", {})) };
    if (action === "on" || action === "off") cfg.enabled = action === "on";
    if (action === "auto_on" || action === "auto_off") cfg.auto_off = action === "auto_on";
    if (action !== "status" && action !== "check_now") await kv.set("away_check", JSON.stringify(cfg));
    if (action === "check_now") return { ok: true, ...(await whatsOn()) };
    return { ok: true, enabled: cfg.enabled, auto_off: cfg.auto_off, after_minutes: cfg.after_minutes,
      note: cfg.enabled ? `About ${cfg.after_minutes} minutes after he leaves home, it checks the lights and TVs and ${cfg.auto_off ? "switches off anything left on, then tells him" : "tells him what's still on"}.` : "Away check is off." };
  }
  async function whatsOn() {
    const devs = (await lights.list?.().catch(() => [])) || [];
    const on = [], unknown = [];
    for (const d of devs.filter((x) => x.name && !x.error && (x.type === "light" || x.type === "tv")).slice(0, 20)) {
      try { const r = await lights.control({ device: d.name, action: "status" }); const p = r?.device?.power ?? r?.power ?? r?.status?.power; if (p === "on") on.push(d.name); else if (p == null) unknown.push(d.name); }
      catch { unknown.push(d.name); }
    }
    return { on, checked: devs.length, unknown: unknown.length ? unknown : undefined };
  }
  async function leftHome() {
    const cfg = { ...AWAY, ...(await loadJ("away_check", {})) };
    if (cfg.enabled) await kv.set("away_check_due", String(now().getTime() + cfg.after_minutes * 60_000));
  }
  async function awayTick() {
    const due = Number(await kv.get("away_check_due")) || 0;
    if (!due || due > now().getTime()) return;
    await kv.set("away_check_due", "0");
    const st = await loadJ("home_state", {});
    if (st.home) return;   // came back already
    const cfg = { ...AWAY, ...(await loadJ("away_check", {})) };
    const { on } = await whatsOn();
    if (!on.length) return;
    if (cfg.auto_off) {
      const off = [];
      for (const name of on) { try { await lights.control({ device: name, action: "off" }); off.push(name); } catch {} }
      await notify(`You left ${off.join(", ")} on, so I've switched ${off.length === 1 ? "it" : "them"} off.`, { title: "🔌 Away check" }).catch(() => {});
    } else {
      await notify(`Still on at home: ${on.join(", ")}. Ask me to turn ${on.length === 1 ? "it" : "them"} off.`, { title: "🔌 Away check" }).catch(() => {});
    }
    dayLog?.add("event", `Away check: ${on.length} left on`);
  }

  let timer = null;
  return { countdown, countdownTick, lifeLog, focus, focusTick, awayCheck, leftHome, awayTick, homeReminders, arrivedHome, sleepTimer, sleepTick, announce, partyMode, sports, sportsTick, youtube, rewind, writeDiary, newsAudio, ambient,
    start() { if (timer) return; timer = setInterval(() => { sportsTick().catch(() => {}); sleepTick().catch(() => {}); focusTick().catch(() => {}); awayTick().catch(() => {}); countdownTick().catch(() => {}); }, 30_000); timer.unref?.(); } };
}
