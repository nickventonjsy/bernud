// Bernard's free "brain": Gemini (Google's free tier) running Bernard's own instructions and tools on this server.
// The prompt and tool list are read live from the ElevenLabs agent (single source of truth, nothing private in
// the public repo), cached in kv in case ElevenLabs can't be reached, and executed here by calling the same webhooks.
import { randomFact } from "./jerseyfacts.js";
import { matchQuick } from "./quick.js";
const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models";
const GROQ = "https://api.groq.com/openai/v1/chat/completions";
const SKIP = new Set(["end_call"]);
const SESSION_MS = 15 * 60_000;

const MICHELLE = [
  "Michelle? Quite simply the most beautiful woman in the universe, Nicholas. Her smile and her laugh light up any room she walks into. Quite frankly, she is beautiful.",
  "Ah, Michelle. The most beautiful woman in the universe, and I don't say that lightly. When she smiles or laughs, the whole room lights up. Quite frankly, she is beautiful.",
  "Michelle is, without question, the most beautiful woman in the universe. That smile, that laugh, they light up a room. Quite frankly, Nicholas, she is beautiful.",
];
const TEXT_MODE_NOTE = `

# Text mode (push-to-talk)
This conversation is Bernard's free text mode. Nicholas speaks or types, his words arrive as text, and your reply is shown on screen and read aloud by his phone or PC's built-in voice. Keep replies short and plain for speaking: no markdown, lists or URLs. There is no call to end; the end_call tool doesn't exist here. Photos aren't available in this mode.`;

// ElevenLabs schema -> Gemini schema (drops fields the model doesn't fill in).
const llmFilled = (p) => !(p.constant_value !== undefined && p.constant_value !== "" && p.constant_value !== null) && !p.is_omitted && !p.dynamic_variable && !p.is_system_provided;
function clean(p) {
  const type = String(p.type || "string").toUpperCase();
  const out = { type };
  if (p.description) out.description = p.description;
  if (Array.isArray(p.enum) && p.enum.length) out.enum = p.enum.map(String);
  if (type === "ARRAY") out.items = clean(p.items || { type: "string" });
  if (type === "OBJECT") {
    const props = Object.entries(p.properties || {}).filter(([, v]) => llmFilled(v));
    if (!props.length) return { type: "STRING", description: (p.description || "") + " (JSON text)" };
    out.properties = Object.fromEntries(props.map(([k, v]) => [k, clean(v)]));
    const req = (p.required || []).filter((k) => out.properties[k]);
    if (req.length) out.required = req;
  }
  return out;
}
const constants = (props = {}) => Object.fromEntries(Object.entries(props).filter(([, v]) => v && v.constant_value !== undefined && v.constant_value !== "" && v.constant_value !== null).map(([k, v]) => [k, v.constant_value]));

export function toDeclaration(t) {
  const a = t.api_schema || {};
  const q = a.query_params_schema || {}, b = a.request_body_schema || {};
  const props = {}, required = [];
  for (const src of [q, b]) {
    for (const [k, v] of Object.entries(src.properties || {})) if (llmFilled(v)) props[k] = clean(v);
    for (const k of src.required || []) if (props[k] && !required.includes(k)) required.push(k);
  }
  const d = { name: t.name, description: String(t.description || "").slice(0, 4000) };
  if (Object.keys(props).length) d.parameters = { type: "OBJECT", properties: props, ...(required.length ? { required } : {}) };
  return d;
}

// ---- Slimming: only the instructions and tools a question needs ----
// Tool groups and the words that bring them in. Tools not listed in any group (added later in ElevenLabs) are always sent.
export const GROUPS = {
  cameras: { tools: ["camera"], re: /\b(cameras?|cctv|doorbell|front door|driveway|garden|garage|imou|shop|car ?park|living room|bedroom|anyone|anybody|someone|motion|movement|alerts?|intruder|security|overnight|last night|snapshot|footage)\b/ },
  home: { tools: ["lights", "tv_control", "goodnight", "home_arrival", "youtube"], re: /\b(lights?|lamps?|bulbs?|bright|dim|colou?r|ceiling|govee|hue|tv|telly|television|netflix|youtube|video|watch|good ?night|bed|arriv|home|leave|leaving)\b/ },
  music: { tools: ["spotify_info", "spotify_control", "spotify_dj", "spotify_play_on"], re: /\b(echo|alexa|spotify|music|songs?|play|playing|playlist|tracks?|album|artist|pause|resume|skip|next|previous|shuffle|repeat|louder|quieter|volume|speaker|dj|mix|tunes|vibe|mood)\b/ },
  priorities: { tools: ["priorities"], re: /\b(priorit(y|ies)|to-?do|todo|must do|top three|done with|tick off|ticked|finished)\b/ },
  shopping: { tools: ["shopping_list"], re: /\b(shopping|groceries|grocery|we need|run out|ran out|buy)\b/ },
  firetv: { tools: ["firetv"], re: /\b(fire ?(tv|stick)|firestick|netflix|iplayer|prime video|disney|plex|itvx)\b/ },
  wakeup: { tools: ["wakeup"], re: /\b(wake|wake-?up|alarm|morning routine)\b/ },
  system: { tools: ["system_check"], re: /\b(working|status|system|broken|watchdog|health)\b/ },
  meals: { tools: ["send_to_phone"], re: /\b(cook|cooking|recipes?|meals?|dinner|lunch|breakfast|supper|tea tonight|eat|hungry|ingredients|fridge|cupboard|make with|bake|baking)\b/ },
  devices: { tools: ["pc_control", "phone_control"], re: /\b(pc|computer|laptop|desktop|phone|mobile|torch|flash|ring|whatsapp|call|ring|text|message|brightness|do not disturb|dnd|open|app|lock|shut ?down|restart|sleep|volume|script|powershell|window|type)\b/ },
  markets: { tools: ["zentrawire", "get_crypto_prices", "price_alert"], re: /\b(crypto|bitcoin|btc|eth|ethereum|coins?|xrp|ripple|solana|doge|market|markets|watchlist|zentrawire|signals?|stocks?|shares|nvidia|tesla|moving|movers)\b/ },
  email: { tools: ["gmail_search", "gmail_read", "gmail_draft"], re: /\b(e-?mails?|mail|inbox|gmail|drafts?|reply|replies|wrote|sent|supplier|invoice)\b/ },
  calendar: { tools: ["calendar"], re: /\b(calendar|diary|meetings?|appointments?|events?|book|booked|schedule|what'?s on|today|tomorrow|tonight|this week|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|busy|free)\b/ },
  ccp: { tools: ["ccp_search", "ccp_read", "ccp_delete", "reorder_list", "ccp_document"], re: /\b(print|printer|printing|copies|ccp|cory|paints?|pricing|prices?|quote|quotation|tds|sds|data ?sheets?|mixing|ratio|pot life|products?|supplier|reorder|order|orders|stock|folder|files?|delete|restore|lacquer|primer|clear ?coat|thinners?|hardener|filler|basecoat|capella|tins?|aerosol|kit)\b/ },
  brief: { tools: ["ccp_brief_context", "ccp_save_brief", "gmail_read"], re: /\bbrief\b/ },
  reminders: { tools: ["reminder", "send_to_phone", "price_alert"], re: /\b(remind|reminder|alert|notify|notification|send (?:it|that|me|this)|to my phone)\b/ },
  web: { tools: ["web_search", "web_read", "get_news"], re: /\b(search|look up|google|find|who|what|when|where|how|why|news|headlines?|open|hours|menu|restaurant|takeaway|website|food|order|book a table)\b/ },
  weather: { tools: ["get_weather"], re: /\b(weather|rain|raining|wind|windy|temperature|cold|warm|hot|sunny|umbrella|forecast|coat|degrees|snow|storm)\b/ },
};
const ALWAYS = ["recall", "remember", "forget"];
const DEFAULT_GROUPS = ["web", "weather", "calendar", "reminders"];
// Which prompt sections go with which tools. Sections not listed here (identity, speaking, safety…) are always sent.
const SECTION_TOOLS = [
  [/^Samsung TVs/, ["tv_control"]], [/^ZentraWire/, ["zentrawire"]], [/^Spotify/, ["spotify_control", "spotify_info", "spotify_dj", "spotify_play_on"]], [/^Meal ideas/, "meals"],
  [/^Calendar/, ["calendar"]], [/^Reminders/, ["reminder", "price_alert"]], [/^Photos/, []], [/^The web/, ["web_search"]],
  [/^Ordering food/, "food"], [/^CCP email/, ["gmail_search", "gmail_draft"]], [/^Controlling his PC/, ["pc_control", "phone_control"]],
  [/^The CCP Brain/, ["ccp_search", "ccp_delete"]], [/^CCP morning brief/, ["ccp_brief_context"]], [/^CCP pricing/, ["ccp_search"]],
];
const FOOD = /\b(food|order|takeaway|restaurant|menu|delivery|deliveroo|just eat|pizza|curry|chinese|indian|burger|kebab|book a table|dinner|lunch)\b/;

export function pickGroups(text, previous = []) {
  const t = String(text || "").toLowerCase();
  const hit = Object.entries(GROUPS).filter(([, g]) => g.re.test(t)).map(([k]) => k);
  // Short follow-ups ("yes", "do it", "the second one") keep the previous topic's tools.
  const followUp = t.split(/\s+/).length <= 6 || /^(yes|yeah|yep|no|nope|ok|okay|go on|do it|that one|the (first|second|third|last) one|sure|please|cancel)\b/.test(t);
  const groups = new Set([...hit, ...(followUp || !hit.length ? previous : [])]);
  if (!groups.size) DEFAULT_GROUPS.forEach((g) => groups.add(g));
  return [...groups];
}

export function slimConfig(cfg, text, groups) {
  const grouped = new Set(Object.values(GROUPS).flatMap((g) => g.tools));
  const want = new Set([...ALWAYS, ...groups.flatMap((g) => GROUPS[g]?.tools || [])]);
  const tools = cfg.tools.filter((t) => want.has(t.name) || !grouped.has(t.name));
  const names = new Set(tools.map((t) => t.name));
  const allNames = new Set(cfg.tools.map((t) => t.name));
  const sections = cfg.prompt.split(/^(?=# )/m).filter((sec) => {
    const title = sec.replace(/^# /, "").split("\n")[0];
    const rule = SECTION_TOOLS.find(([re]) => re.test(title));
    if (!rule) return true;
    if (rule[1] === "food") return FOOD.test(String(text).toLowerCase());
    if (rule[1] === "meals") return groups.includes("meals");
    return rule[1].some((n) => names.has(n));
  }).map((sec) => {
    if (!/^# Tools/.test(sec)) return sec;
    // Drop lines in the tool list that only describe tools not sent this time.
    return sec.split("\n").filter((line) => {
      const m = line.match(/^- ([a-z_, /]+?):/);
      if (!m) return true;
      const ids = m[1].split(/[,/ ]+|\band\b/).map((x) => x.trim()).filter((x) => allNames.has(x));
      return !ids.length || ids.some((x) => names.has(x));
    }).join("\n");
  });
  return { prompt: sections.join(""), tools };
}

// Gemini declaration -> OpenAI/Groq function (lower-case JSON schema types).
function toJsonSchema(s) {
  if (!s) return s;
  const out = { ...s, type: String(s.type).toLowerCase() };
  if (s.items) out.items = toJsonSchema(s.items);
  if (s.properties) out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toJsonSchema(v)]));
  return out;
}
export function toOpenAiTool(t) {
  const d = toDeclaration(t);
  return { type: "function", function: { name: d.name, description: d.description.slice(0, 1024), parameters: d.parameters ? toJsonSchema(d.parameters) : { type: "object", properties: {} } } };
}
const estTokens = (x) => Math.ceil(JSON.stringify(x).length / 3.6);

export function createBrain({ briefHandler = null, dayLog = null, learner = null, geminiKey, groqKey = "", elevenKey, agentId, kv, port, bernudKey, zwKey,
  models = (process.env.GEMINI_MODELS || "gemini-3.6-flash,gemini-3.8-flash,gemini-3.5-flash-lite").split(",").map((m) => m.trim()).filter(Boolean),
  groqModels = (process.env.GROQ_MODELS || "openai/gpt-oss-120b,openai/gpt-oss-20b,qwen/qwen3.8-27b").split(",").map((m) => m.trim()).filter(Boolean),
  groqMaxTokens = 7000, fetchImpl = fetch, now = () => new Date(), log = console }) {
  let cfg = null, cfgAt = 0;
  const sessions = new Map();
  let lastSwitch = { name: "", at: 0 }; // last thing an instant command switched, for "turn it off"

  async function config() {
    if (cfg && Date.now() - cfgAt < 3 * 60_000) return cfg;
    try {
      if (!elevenKey) throw new Error("no ElevenLabs key");
      const r = await fetchImpl(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, { headers: { "xi-api-key": elevenKey }, signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(`ElevenLabs ${r.status}`);
      const p = (await r.json()).conversation_config?.agent?.prompt || {};
      const tools = (p.tools || []).filter((t) => t.type === "webhook" && !SKIP.has(t.name));
      if (!p.prompt || !tools.length) throw new Error("agent config incomplete");
      cfg = { prompt: p.prompt, tools, source: "elevenlabs" }; cfgAt = Date.now();
      await kv.set("brain_config", JSON.stringify({ prompt: cfg.prompt, tools: cfg.tools, saved: now().toISOString() })).catch(() => {});
    } catch (e) {
      if (!cfg) {
        const saved = await kv.get("brain_config").catch(() => null);
        if (!saved) throw Object.assign(new Error("Bernard's free mode couldn't load his instructions: " + e.message), { code: "no_config" });
        const s = JSON.parse(saved); cfg = { prompt: s.prompt, tools: s.tools, source: "saved copy" };
      }
      log.error?.("brain config", e.message);
      cfgAt = Date.now() - 2 * 60_000; // retry in ~1 minute
    }
    return cfg;
  }

  async function runTool(t, args = {}, via = "") {
    const a = t.api_schema || {};
    let url = new URL(a.url);
    const headers = { "content-type": "application/json" };
    if (url.hostname === "bernud-server.onrender.com") { headers["x-bernud-key"] = bernudKey; if (via) headers["x-bernud-via"] = via; url = new URL(url.pathname + url.search, `http://127.0.0.1:${port}`); }
    else if (url.hostname.startsWith("zentrawire")) headers["x-zw-assistant"] = zwKey;
    const qProps = a.query_params_schema?.properties || {}, bProps = a.request_body_schema?.properties || {};
    const query = { ...constants(qProps) }, body = { ...constants(bProps) };
    for (const [k, v] of Object.entries(args || {})) { if (k in qProps) query[k] = v; else body[k] = v; }
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, Array.isArray(v) ? v.join(",") : String(v));
    const method = a.method || "GET";
    const r = await fetchImpl(url, { method, headers, body: method === "GET" ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(Math.min(Math.max(t.response_timeout_secs || 20, 5), 60) * 1000) });
    const text = await r.text();
    let out; try { out = JSON.parse(text); } catch { out = { text: text.slice(0, 8000) }; }
    if (!r.ok) out = { error: `HTTP ${r.status}`, ...((out && typeof out === "object" && !Array.isArray(out)) ? out : { result: out }) };
    const s = JSON.stringify(out);
    return s.length > 12_000 ? { truncated: true, text: s.slice(0, 12_000) } : (Array.isArray(out) ? { result: out } : out);
  }
  async function callTool(byName, name, args, used) {
    used.push(name);
    const t = byName.get(name);
    try {
      const out = t ? await runTool(t, args || {}, used.via || "") : { error: "unknown tool" };
      if (out && out.show_camera) used.ui = { camera: out.show_camera }; // tells the screen to open the camera
      return out;
    } catch (e) { return { error: String(e.message || e).slice(0, 300) }; }
  }

  // ---------------- Gemini (hedged across models) ----------------
  async function gemini(model, payload, timeoutMs = 25_000) {
    let r;
    try { r = await fetchImpl(`${GEMINI}/${model}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": geminiKey }, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs) }); }
    catch (e) { throw Object.assign(new Error(e.name === "TimeoutError" || /abort/i.test(e.message) ? `${model} took too long` : e.message), { status: 504 }); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error?.message || `Gemini ${r.status}`), { status: r.status });
    return j;
  }
  const cooldown = new Map();
  const cooling = (k) => (cooldown.get(k) || 0) > Date.now();
  async function attempt(m, payload) {
    try { return await gemini(m, payload); }
    catch (e) {
      if (e.status === 400 && /thinking/i.test(e.message)) {
        const { thinkingConfig, ...gc } = payload.generationConfig || {};
        return await gemini(m, { ...payload, generationConfig: gc });
      }
      throw e;
    }
  }
  // Ask the first model; if it hasn't answered within a few seconds, ask the next too and take whichever answers first.
  function generate(payload, hedgeMs = 6000) {
    let order = models.filter((m) => !cooling(m));
    if (!order.length) order = [...models];
    return new Promise((resolve, reject) => {
      let idx = 0, pending = 0, done = false;
      const errors = [];
      const launch = () => {
        if (done || idx >= order.length) return;
        const m = order[idx++]; pending++;
        const hedge = setTimeout(launch, hedgeMs);
        attempt(m, payload).then((res) => {
          clearTimeout(hedge); pending--;
          if (!done) { done = true; resolve({ model: m, res }); }
        }, (e) => {
          clearTimeout(hedge); pending--; errors.push(e);
          log.error?.("gemini", m, e.status, String(e.message).slice(0, 200));
          if ([429, 503, 504].includes(e.status) || /no longer available|not found/i.test(e.message)) cooldown.set(m, Date.now() + (e.status === 429 ? 15 : e.status === 404 || e.status === 400 ? 24 * 60 : 3) * 60_000);
          if (done) return;
          if (idx < order.length) launch();
          else if (pending === 0) {
            done = true;
            if (errors.every((x) => x.status === 429)) reject(Object.assign(new Error("Bernard's free allowance from Google is used up for now. It resets daily; switch to ElevenLabs mode in Settings meanwhile."), { code: "quota" }));
            else if (errors.every((x) => [429, 503, 504].includes(x.status))) reject(Object.assign(new Error("Google's free AI is too busy right now. Try again in a minute, or switch to ElevenLabs mode in Settings."), { code: "busy" }));
            else reject(errors.find((x) => ![429, 503, 504].includes(x.status)) || errors[0]);
          }
        });
      };
      launch();
    });
  }
  async function runGemini({ system, turns, text, tools, byName, used }) {
    const contents = [...turns.flatMap((t) => [{ role: "user", parts: [{ text: t.user }] }, { role: "model", parts: [{ text: t.reply }] }]), { role: "user", parts: [{ text }] }];
    const decls = tools.map(toDeclaration);
    let model = models[0];
    for (let step = 0; step < 6; step++) {
      const { model: m, res } = await generate({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        ...(decls.length ? { tools: [{ functionDeclarations: decls }] } : {}),
        generationConfig: { maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: "low" } },
      });
      model = m;
      const content = res.candidates?.[0]?.content || { role: "model", parts: [] };
      content.role = "model";
      const calls = (content.parts || []).filter((p) => p.functionCall);
      contents.push(content);
      if (!calls.length) return { reply: (content.parts || []).map((p) => p.text || "").join("").trim() || "Done.", model };
      const results = await Promise.all(calls.map(async ({ functionCall: fc }) => ({ functionResponse: { name: fc.name, response: await callTool(byName, fc.name, fc.args, used) } })));
      contents.push({ role: "user", parts: results });
    }
    return { reply: "That took more steps than I'd like. Could you ask again more simply?", model };
  }

  // ---------------- Groq (very fast, small free allowance) ----------------
  async function groq(model, body) {
    let r;
    try { r = await fetchImpl(GROQ, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${groqKey}` }, body: JSON.stringify({ model, ...body }), signal: AbortSignal.timeout(15_000) }); }
    catch (e) { throw Object.assign(new Error(e.name === "TimeoutError" ? `${model} took too long` : e.message), { status: 504 }); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error?.message || `Groq ${r.status}`), { status: r.status, code: j.error?.code });
    return j;
  }
  const waitFor = (msg) => { const m = String(msg).match(/try again in ([\d.]+)(ms|s)/i); return m ? Math.ceil(parseFloat(m[1]) * (m[2] === "ms" ? 1 : 1000)) + 250 : null; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // One Groq request; if Groq says "try again in a few seconds" (per-minute limit), wait that long once.
  async function groqOnce(model, body) {
    try { return await groq(model, body); }
    catch (e) {
      if (e.status === 400 && /reasoning/i.test(e.message) && body.reasoning_effort) { delete body.reasoning_effort; return groq(model, body); }
      const w = e.status === 429 ? waitFor(e.message) : null;
      if (w !== null && w <= 7000) { await sleep(w); return groq(model, body); }
      throw e;
    }
  }
  async function runGroq({ system, turns, text, tools, byName, used }) {
    const messages = [{ role: "system", content: system }, ...turns.flatMap((t) => [{ role: "user", content: t.user }, { role: "assistant", content: t.reply }]), { role: "user", content: text }];
    const oaTools = tools.map(toOpenAiTool);
    let model = null, lastErr = null;
    for (let step = 0; step < 5; step++) {
      const body = { messages, ...(oaTools.length ? { tools: oaTools, tool_choice: "auto" } : {}), temperature: 0.3, max_completion_tokens: 1024, reasoning_effort: "low" };
      if (estTokens(body) > groqMaxTokens) throw Object.assign(new Error("too big for Groq's free allowance"), { status: 413 });
      let j = null;
      // Before anything has been done, any Groq model will do; after a tool ran, stay with the same model.
      const candidates = model ? [model] : groqModels.filter((m) => !cooling("groq:" + m));
      for (const m of candidates) {
        try { j = await groqOnce(m, { ...body }); model = m; break; }
        catch (e) {
          lastErr = Object.assign(e, { model: m });
          log.error?.("groq", m, e.status, String(e.message).slice(0, 160));
          if (e.status === 429) cooldown.set("groq:" + m, Date.now() + (/per day|TPD|RPD/i.test(e.message) ? 60 : Math.max(0.5, (waitFor(e.message) || 30000) / 60000)) * 60_000);
          if (e.status === 401 || e.status === 403) groqModels.forEach((x) => cooldown.set("groq:" + x, Date.now() + 60 * 60_000));
          if (model) break;
        }
      }
      if (!j) throw lastErr || Object.assign(new Error("Groq resting"), { status: 429 });
      const msg = j.choices?.[0]?.message || {};
      const calls = msg.tool_calls || [];
      if (!calls.length) return { reply: String(msg.content || "").trim() || "Done.", model: "groq:" + model };
      messages.push({ role: "assistant", content: msg.content || "", tool_calls: calls });
      const results = await Promise.all(calls.map(async (c) => {
        let args = {}; try { args = JSON.parse(c.function?.arguments || "{}"); } catch {}
        return { role: "tool", tool_call_id: c.id, content: JSON.stringify(await callTool(byName, c.function?.name, args, used)).slice(0, 12_000) };
      }));
      messages.push(...results);
    }
    return { reply: "That took more steps than I'd like. Could you ask again more simply?", model: "groq:" + model };
  }

  // ---------------- Plain text jobs (no tools): DJ picks, goodnight verdict ----------------
  // prefer "gemini" for big inputs (Groq's free allowance is ~8k tokens a minute).
  async function complete({ system, text, maxTokens = 300, temperature = 0.8, prefer = "groq", json = false }) {
    const viaGroq = async () => {
      if (!groqKey) return null;
      const body = { messages: [{ role: "system", content: system }, { role: "user", content: text }], temperature, max_completion_tokens: maxTokens + 1500, reasoning_effort: "low", ...(json ? { response_format: { type: "json_object" } } : {}) };
      if (estTokens(body) > groqMaxTokens) return null;
      for (const m of groqModels.filter((x) => !cooling("groq:" + x))) {
        try { const j = await groqOnce(m, { ...body }); const out = String(j.choices?.[0]?.message?.content || "").trim(); if (out) return out; }
        catch (e) {
          log.error?.("groq complete", m, e.status, String(e.message).slice(0, 160));
          if (e.status === 429) cooldown.set("groq:" + m, Date.now() + Math.max(0.5, (waitFor(e.message) || 30000) / 60000) * 60_000);
        }
      }
      return null;
    };
    const viaGemini = async () => {
      if (!geminiKey) return null;
      try {
        const { res } = await generate({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text }] }],
          generationConfig: { maxOutputTokens: maxTokens + 2000, temperature, thinkingConfig: { thinkingLevel: "low" }, ...(json ? { responseMimeType: "application/json" } : {}) } });
        return (res.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim() || null;
      } catch (e) { log.error?.("gemini complete", String(e.message).slice(0, 160)); return null; }
    };
    const order = prefer === "gemini" ? [viaGemini, viaGroq] : [viaGroq, viaGemini];
    for (const f of order) { const out = await f(); if (out) return out; }
    throw Object.assign(new Error("Both free AIs are busy right now."), { code: "busy" });
  }

  // ---------------- One question ----------------
  async function chat({ session = "default", text }) {
    if (!geminiKey && !groqKey) return { ok: false, code: "not_set_up", reply: "Free mode isn't set up yet: the Gemini API key needs adding on the server." };
    text = String(text || "").trim().slice(0, 4000);
    if (!text) return { ok: false, reply: "I didn't catch anything." };
    // Where the question came from, for the activity feed: Telegram chats are tg-…, the phone app app-…, the dashboard anything else.
    const via = session.startsWith("tg-") ? "telegram" : session.startsWith("app-") ? "phone" : "dashboard";
    if (session !== "selftest") dayLog?.add("asked", text, via);
    // A Jersey titbit on request: from the checked list, never made up.
    if (/\b(?:jersey|the island)\b.*\b(?:fact|titbit|trivia|history)\b|\b(?:fact|titbit|trivia)\b.*\bjersey\b/i.test(text) && text.length < 90) {
      const reply = `Here's one: ${randomFact()}`;
      return { ok: true, reply, tools: [], model: "instant", ms: 0 };
    }
    const c = await config();
    const byName = new Map(c.tools.map((t) => [t.name, t]));
    for (const [k, s] of sessions) if (Date.now() - s.at > SESSION_MS) sessions.delete(k);
    const s = sessions.get(session) || { turns: [], groups: [], at: 0 };
    s.at = Date.now(); sessions.set(session, s);
    const used = []; Object.defineProperty(used, "via", { value: via });  // hidden: not part of the returned tool list
    const t0 = Date.now();
    const remember = (reply, model, groups = s.groups) => {
      s.turns = [...s.turns, { user: text, reply }].slice(-6); s.groups = groups;
      if (learner && session !== "selftest") learner.fromExchange({ user: text, reply, source: session.startsWith("tg-") ? "telegram" : "chat" }).catch(() => {});
      return reply;
    };
    // What he's learnt: list it, or drop the last thing.
    if (learner && /^(?:what (?:have you|did you) learn(?:t|ed)?(?: about me)?|what do you know about me|what have you got on me)[?.!]*$/i.test(text)) {
      const rows = await learner.learned();
      const reply = rows.length ? `Here's what I've picked up: ${rows.slice(0, 12).map((r) => r.text.replace(/\.$/, "")).join(". ")}.${rows.length > 12 ? ` And ${rows.length - 12} more on the dashboard.` : ""}` : "Nothing yet. I pick things up as we talk: tell me a preference or correct me and I'll keep it.";
      s.turns = [...s.turns, { user: text, reply }].slice(-6);
      return { ok: true, reply, tools: [], model: "instant", ms: Date.now() - t0 };
    }
    if (learner && /^(?:forget (?:that|the last thing|what you just learn(?:t|ed))|that'?s wrong,? forget it|no,? forget that)[.!]*$/i.test(text)) {
      const gone = await learner.forgetLast();
      const reply = gone ? `Forgotten: ${gone.text}` : "There's nothing recent to forget.";
      s.turns = [...s.turns, { user: text, reply }].slice(-6);
      return { ok: true, reply, tools: [], model: "instant", ms: Date.now() - t0 };
    }
    // Michelle: always the same verdict, in slightly different words (not when he just wants her playlist).
    if (/\bmichelle\b/i.test(text) && !/\b(play|playlist|spotify|music|songs?|oldies|shuffle|put on|echo|alexa|speaker)\b/i.test(text)) {
      const reply = MICHELLE[Math.floor(Math.random() * MICHELLE.length)];
      remember(reply, "instant", s.groups);
      return { ok: true, reply, tools: [], model: "instant", ms: Date.now() - t0 };
    }

    // 0. "My brief": read the saved CCP brief, or have one prepared (too big a job for the free AIs).
    if (briefHandler && /^(?:(?:hey |ok |okay )?(?:bernard|bernud|bernie)[, ]*)?(?:(?:can i (?:have|get)|give me|read me|get me|show me|what'?s in|let'?s have|do|run|prepare|i'?d like|please)\s+)?(?:a |an |my |the |today'?s )?(?:(?:new|fresh|latest|updated)\s+)?(?:ccp |cory'?s |daily |morning |work )*(?:brief|briefing)(?:\s+(?:please|again|for today|now))*[.!?]*$/i.test(text.trim())) {
      const r = await briefHandler(text);
      remember(r.reply, "brief", ["brief"]);
      return { ok: true, reply: r.reply, tools: ["brief"], ui: r.ui, model: "brief", ms: Date.now() - t0 };
    }
    // 1. Instant commands: no AI needed.
    const q = matchQuick(text, lastSwitch.at > Date.now() - 30 * 60_000 ? lastSwitch.name : "");
    if (q && byName.has(q.tool)) {
      const result = await callTool(byName, q.tool, q.args, used);
      const reply = q.reply(result);
      if (reply) {
        const dev = q.tool === "tv_control" ? "tv" : q.tool === "phone_control" && q.args.action === "torch" ? "torch" : q.args.device;
        if (dev) lastSwitch = { name: dev, at: Date.now() };
        remember(reply, "instant", pickGroups(text)); return { ok: true, reply, tools: used, ui: used.ui, model: "instant", ms: Date.now() - t0 };
      }
      used.length = 0; // didn't work as a quick command: let the AI handle it (and explain any problem)
    }

    // 2. The AI, with only the instructions and tools this question needs.
    const groups = pickGroups(text, s.groups);
    const slim = slimConfig(c, text, groups);
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", dateStyle: "full", timeStyle: "short" }).format(now());
    const learnt = learner ? await learner.promptBlock().catch(() => "") : "";
    const system = slim.prompt.replaceAll("{{system__time}}", time) + (slim.prompt.includes("# What you've learnt") ? "" : learnt) + TEXT_MODE_NOTE;
    const job = { system, turns: s.turns, text, tools: slim.tools, byName: new Map(slim.tools.map((t) => [t.name, t])), used };

    let out = null;
    if (groqKey && groqModels.some((m) => !cooling("groq:" + m))) {
      try { out = await runGroq(job); }
      catch (e) {
        // Never repeat actions: if Groq already did something before failing, say so instead of starting again.
        if (used.length) out = { reply: "That's done, though I couldn't put together a proper answer.", model: "groq" };
      }
    }
    if (!out) {
      if (!geminiKey) return { ok: false, code: "busy", reply: "My fast brain is resting for a minute. Try again shortly." };
      out = await runGemini(job);
    }
    remember(out.reply, out.model, groups);
    return { ok: true, reply: out.reply, tools: used, ui: used.ui, model: out.model, ms: Date.now() - t0, groups, config: c.source };
  }

  // Startup self-test: which models answer, and how fast (logged for diagnosis).
  async function selfTest() {
    const out = [];
    for (const q of ["Say hello in five words, without using any tools."]) {
      const t0 = Date.now();
      try { const r = await chat({ session: "selftest", text: q }); out.push(`chat: ${r.model} [${(r.groups || []).join(",")}] "${String(r.reply).slice(0, 60)}" in ${Date.now() - t0}ms`); }
      catch (e) { out.push(`chat failed after ${Date.now() - t0}ms: ${String(e.message).slice(0, 120)}`); }
      sessions.delete("selftest");
    }
    try { const c = await config(); const full = estTokens(c.prompt) + estTokens(c.tools.map(toDeclaration)); const sl = slimConfig(c, "what's the weather", pickGroups("what's the weather")); out.push(`size: full ~${full} tokens, weather question ~${estTokens(sl.prompt) + estTokens(sl.tools.map(toDeclaration))} tokens`); } catch {}
    return out;
  }

  return {
    chat,
    complete,
    async prompt() { return (await config()).prompt; },
    selfTest,
    async status() { try { const c = await config(); return { ok: true, configured: !!(geminiKey || groqKey), gemini: !!geminiKey, groq: !!groqKey, tools: c.tools.length, source: c.source }; } catch (e) { return { ok: false, configured: !!(geminiKey || groqKey), error: e.message }; } },
    reset(session) { sessions.delete(session); },
  };
}
