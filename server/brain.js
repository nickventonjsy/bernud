// Bernard's free "brain": Gemini (Google's free tier) running Bernard's own instructions and tools on this server.
// The prompt and tool list are read live from the ElevenLabs agent (single source of truth, nothing private in
// the public repo), cached in kv in case ElevenLabs can't be reached, and executed here by calling the same webhooks.
const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models";
const SKIP = new Set(["end_call"]);
const SESSION_MS = 15 * 60_000;
// Keep recent history, always starting at one of Nicholas's own messages (never mid tool call).
function trim(contents, max = 30) {
  let start = Math.max(0, contents.length - max);
  while (start < contents.length && !(contents[start].role === "user" && contents[start].parts?.some((p) => p.text))) start++;
  return contents.slice(start);
}

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

export function createBrain({ geminiKey, elevenKey, agentId, kv, port, bernudKey, zwKey, models = (process.env.GEMINI_MODELS || "gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash-lite").split(",").map((m) => m.trim()).filter(Boolean), fetchImpl = fetch, now = () => new Date(), log = console }) {
  let cfg = null, cfgAt = 0;
  const sessions = new Map();

  async function config() {
    if (cfg && Date.now() - cfgAt < 10 * 60_000) return cfg;
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
      cfgAt = Date.now() - 8 * 60_000; // retry in ~2 minutes
    }
    return cfg;
  }

  async function runTool(t, args = {}) {
    const a = t.api_schema || {};
    let url = new URL(a.url);
    const headers = { "content-type": "application/json" };
    if (url.hostname === "bernud-server.onrender.com") { headers["x-bernud-key"] = bernudKey; url = new URL(url.pathname + url.search, `http://127.0.0.1:${port}`); }
    else if (url.hostname.startsWith("zentrawire")) headers["x-zw-assistant"] = zwKey;
    const qProps = a.query_params_schema?.properties || {}, bProps = a.request_body_schema?.properties || {};
    const query = { ...constants(qProps) }, body = { ...constants(bProps) };
    for (const [k, v] of Object.entries(args)) { if (k in qProps) query[k] = v; else body[k] = v; }
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, Array.isArray(v) ? v.join(",") : String(v));
    const method = a.method || "GET";
    const r = await fetchImpl(url, { method, headers, body: method === "GET" ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(Math.min(Math.max(t.response_timeout_secs || 20, 5), 60) * 1000) });
    const text = await r.text();
    let out; try { out = JSON.parse(text); } catch { out = { text: text.slice(0, 8000) }; }
    if (!r.ok) out = { error: `HTTP ${r.status}`, ...((out && typeof out === "object" && !Array.isArray(out)) ? out : { result: out }) };
    const s = JSON.stringify(out);
    return s.length > 12_000 ? { truncated: true, text: s.slice(0, 12_000) } : (Array.isArray(out) ? { result: out } : out);
  }

  async function gemini(model, payload, timeoutMs = 25_000) {
    let r;
    try { r = await fetchImpl(`${GEMINI}/${model}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": geminiKey }, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs) }); }
    catch (e) { throw Object.assign(new Error(e.name === "TimeoutError" || /abort/i.test(e.message) ? `${model} took too long` : e.message), { status: 504 }); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error?.message || `Gemini ${r.status}`), { status: r.status });
    return j;
  }

  async function generate(payload) {
    let last;
    for (const m of models) {
      try { return { model: m, res: await gemini(m, payload) }; }
      catch (e) {
        last = e;
        // Some models reject the "think less" setting: try once without it.
        if (e.status === 400 && /thinking/i.test(e.message)) {
          const { thinkingConfig, ...gc } = payload.generationConfig || {};
          try { return { model: m, res: await gemini(m, { ...payload, generationConfig: gc }) }; } catch (e2) { last = e2; }
        }
        log.error?.("gemini", m, last.status, String(last.message).slice(0, 200));
        const retired = /no longer available|not found|not supported|deprecated|model/i.test(last.message || "");
        if (!(last.status === 429 || last.status >= 500 || last.status === 404 || (last.status === 400 && retired) || last.status === 403 && retired)) break;
      }
    }
    if (last?.status === 429) throw Object.assign(new Error("Bernard's free allowance from Google is used up for now. It resets daily; switch to ElevenLabs mode in Settings meanwhile."), { code: "quota" });
    throw last;
  }

  async function chat({ session = "default", text }) {
    if (!geminiKey) return { ok: false, code: "not_set_up", reply: "Free mode isn't set up yet: the Gemini API key needs adding on the server." };
    text = String(text || "").trim().slice(0, 4000);
    if (!text) return { ok: false, reply: "I didn't catch anything." };
    const c = await config();
    const byName = new Map(c.tools.map((t) => [t.name, t]));
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", dateStyle: "full", timeStyle: "short" }).format(now());
    const system = c.prompt.replaceAll("{{system__time}}", time) + TEXT_MODE_NOTE;

    for (const [k, s] of sessions) if (Date.now() - s.at > SESSION_MS) sessions.delete(k);
    const s = sessions.get(session) || { history: [], at: 0 };
    s.at = Date.now(); sessions.set(session, s);
    const contents = [...s.history, { role: "user", parts: [{ text }] }];
    const used = [];
    let model = models[0];

    for (let step = 0; step < 6; step++) {
      const { model: m, res } = await generate({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        tools: [{ functionDeclarations: c.tools.map(toDeclaration) }],
        generationConfig: { maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: "low" } },
      });
      model = m;
      const content = res.candidates?.[0]?.content || { role: "model", parts: [] };
      content.role = "model";
      const calls = (content.parts || []).filter((p) => p.functionCall);
      contents.push(content);
      if (!calls.length) {
        const reply = (content.parts || []).map((p) => p.text || "").join("").trim() || "Done.";
        s.history = trim(contents);
        return { ok: true, reply, tools: used, model, config: c.source };
      }
      const results = await Promise.all(calls.map(async ({ functionCall: fc }) => {
        used.push(fc.name);
        const t = byName.get(fc.name);
        let response;
        try { response = t ? await runTool(t, fc.args || {}) : { error: "unknown tool" }; }
        catch (e) { response = { error: String(e.message || e).slice(0, 300) }; }
        return { functionResponse: { name: fc.name, response } };
      }));
      contents.push({ role: "user", parts: results });
    }
    s.history = trim(contents);
    return { ok: true, reply: "That took more steps than I'd like. Could you ask again more simply?", tools: used, model };
  }

  // Startup self-test: which models answer, and how fast (logged for diagnosis).
  async function selfTest() {
    const out = [];
    for (const m of models) {
      const t0 = Date.now();
      try { const j = await gemini(m, { contents: [{ role: "user", parts: [{ text: "Reply with the single word OK." }] }] }, 30_000); out.push(`${m}: ${(j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim().slice(0, 20)} in ${Date.now() - t0}ms`); }
      catch (e) { out.push(`${m}: ${e.status || ""} ${String(e.message).slice(0, 120)} after ${Date.now() - t0}ms`); }
    }
    const t0 = Date.now();
    try { const r = await chat({ session: "selftest", text: "Say hello in five words, without using any tools." }); out.push(`full chat: ${r.model} "${String(r.reply).slice(0, 60)}" in ${Date.now() - t0}ms`); }
    catch (e) { out.push(`full chat failed after ${Date.now() - t0}ms: ${String(e.message).slice(0, 120)}`); }
    sessions.delete("selftest");
    return out;
  }

  return {
    chat,
    selfTest,
    async status() { try { const c = await config(); return { ok: true, configured: !!geminiKey, tools: c.tools.length, source: c.source }; } catch (e) { return { ok: false, configured: !!geminiKey, error: e.message }; } },
    reset(session) { sessions.delete(session); },
  };
}
