// Bernard learns as he goes: after each exchange, a cheap AI pass pulls out anything durable Nicholas said
// (corrections, preferences, facts about his life) and files it in his memory under the "learned" category.
// What he's learnt is shown to him at the start of every conversation, so he doesn't have to think to recall it.
const SYSTEM = `You read one exchange between Nicholas and his assistant Bernard and decide whether Nicholas said anything worth remembering for good.
Keep ONLY durable facts, preferences and corrections about Nicholas, his home, his family and friends, his work or his habits. Examples worth keeping: "Nicholas doesn't eat mushrooms", "The lounge lamp is the Govee one, not the SmartThings one", "Michelle's birthday is 14 March", "Nicholas prefers the brief read in under a minute", "Nicholas's mum is called Pat".
Never keep: one-off requests or commands ("turn the lights on"), anything about today only, questions, things Bernard said, passwords, codes, card or account numbers, addresses, health details unless he states them as a lasting preference ("I'm allergic to nuts" is fine), or anything already in the "known" list (or a trivial rewording of it).
A correction ("no, …", "actually …", "it's … not …") is the most valuable kind: keep it as the corrected fact.
Never turn a one-off instruction about the app, the dashboard or this conversation into a preference ("don't read the list back", "turn it down", "open it in Notes"): those are requests for the moment, not facts about Nicholas. Only keep a preference he states as lasting ("I always want…", "I never…").
Write each item as one short plain sentence in the third person starting with the subject (Nicholas, Michelle, The lounge lamp…). At most 3 items; usually none.
Reply with JSON only: {"learn": ["…"]} or {"learn": []}.`;

const norm = (s) => String(s).toLowerCase().replace(/n't\b/g, " not").replace(/'s\b/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const words = (s) => new Set(norm(s).split(" ").filter((w) => w.length > 2));
// Two sentences are "the same fact" if most of the longer one's words appear in the other.
export function similar(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return false;
  let hit = 0; for (const w of A) if (B.has(w)) hit++;
  return hit / Math.max(A.size, B.size) >= 0.7;
}

export function parseLearn(raw) {
  const m = String(raw || "").match(/\{[\s\S]*\}/);
  if (!m) return [];
  try { const j = JSON.parse(m[0]); return (Array.isArray(j.learn) ? j.learn : []).map((s) => String(s).trim()).filter((s) => s.length >= 8 && s.length <= 200).slice(0, 3); }
  catch { return []; }
}

// Things that should never be learnt however they're phrased.
const BLOCK = /\b(password|passcode|pin\b|card number|account number|sort code|iban|api key|token|secret)\b|\b\d{6,}\b/i;

export function createLearner({ db, complete, log = console, enabled = true, maxShown = 70 }) {
  let busy = 0;

  async function learned() {
    const rows = (await db.all()).filter((r) => r.category === "learned");
    return rows.slice(0, 200);
  }

  // The block that goes into Bernard's instructions: everything he's been told to remember or has picked up
  // (people first), so he knows it without having to look it up. Saved recipes are listed by name only.
  async function promptBlock() {
    const all = await db.all();
    const isRecipe = (r) => /^recipes?$/.test(r.category || "");
    const facts = all.filter((r) => !isRecipe(r) && String(r.text).length <= 300);
    const order = (r) => (r.category === "people" ? 0 : r.category === "learned" ? 2 : 1);
    const rows = facts.sort((a, b) => order(a) - order(b)).slice(0, maxShown);
    const recipes = all.filter(isRecipe).map((r) => (String(r.text).match(/^Recipe:\s*([^.(\n]+)/i) || [])[1]).filter(Boolean).slice(0, 30);
    if (!rows.length && !recipes.length) return "";
    return "\n\n# What you know about Nicholas and his people\nThings he has told you to remember or that you've picked up. You know these already: use them without being asked and without calling recall, and correct them if he tells you otherwise.\n"
      + rows.map((r) => "- " + r.text).join("\n")
      + (recipes.length ? `\n- Recipes saved in his memory (use recall for the full recipe): ${recipes.join("; ")}.` : "");
  }

  async function save(text, { source = "learned" } = {}) {
    text = String(text || "").trim().replace(/\s+/g, " ").slice(0, 200);
    if (!text || BLOCK.test(text)) return null;
    const all = await db.all();
    if (all.some((r) => similar(r.text, text))) return null;
    const row = await db.save(text, "learned");
    log.log?.(`learned (${source}): ${text}`);
    try { api.onLearned?.(); } catch {}
    return row;
  }

  // Called after an exchange. Never throws, never blocks the reply.
  async function fromExchange({ user, reply, source = "chat" }) {
    if (!enabled || !complete) return [];
    user = String(user || "").trim(); reply = String(reply || "").trim();
    if (user.split(/\s+/).length < 4) return [];                       // "lamp on" has nothing to learn
    if (!/\b(i|i'm|i am|my|me|we|our|michelle|mum|dad|no,|actually|not|don't|dont|never|always|prefer|hate|love|like|call|is|are|lives?|birthday|allerg)\b/i.test(user)) return [];
    if (busy > 2) return [];
    busy++;
    try {
      const known = (await learned()).slice(0, 60).map((r) => "- " + r.text).join("\n");
      const raw = await complete({ system: SYSTEM, text: `Known already:\n${known || "(nothing yet)"}\n\nNicholas: ${user.slice(0, 1500)}\nBernard: ${reply.slice(0, 600)}`, maxTokens: 200, temperature: 0, prefer: "groq", json: true });
      const out = [];
      for (const t of parseLearn(raw)) { const row = await save(t, { source }); if (row) out.push(row.text); }
      return out;
    } catch (e) { log.error?.("learn", String(e.message).slice(0, 120)); return []; }
    finally { busy--; }
  }

  // A whole voice conversation (ElevenLabs transcript) at once.
  async function fromTranscript(turns, { source = "voice" } = {}) {
    const pairs = [];
    for (let i = 0; i < turns.length; i++) {
      if (turns[i].role !== "user" || !turns[i].message) continue;
      const next = turns.slice(i + 1).find((t) => t.role === "agent" && t.message);
      pairs.push({ user: turns[i].message, reply: next?.message || "" });
    }
    const out = [];
    for (const p of pairs) out.push(...(await fromExchange({ ...p, source })));
    return out;
  }

  async function forgetLast() {
    const rows = await learned();
    if (!rows.length) return null;
    return db.remove(rows[0].id);
  }

  const api = { learned, promptBlock, save, fromExchange, fromTranscript, forgetLast, onLearned: null };
  return api;
}
