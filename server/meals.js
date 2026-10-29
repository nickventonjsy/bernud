// Meal ideas with real variety: a different set of cuisines each time, the household's likes and dislikes from
// memory, and the dishes suggested in the last few weeks left out, so Bernard doesn't keep offering the same three.
const CUISINES = ["Italian", "Indian", "Thai", "Mexican", "Chinese", "Japanese", "Greek", "Spanish", "French", "Moroccan",
  "Lebanese", "Korean", "Vietnamese", "Caribbean", "Cajun", "Turkish", "classic British", "American diner", "Portuguese",
  "Middle Eastern", "Sri Lankan", "Malaysian", "Persian", "Hungarian", "pub classic", "Tex-Mex", "Indonesian", "Ethiopian"];
const STYLES = ["a one-pot", "a traybake", "a quick stir-fry", "a slow-cooked", "a pasta dish", "a rice dish", "a burger or wrap",
  "a pie or bake", "a curry", "a grill or barbecue", "a soup or stew", "a fakeaway"];

const SYSTEM = `You suggest home-cooked dinners for a household in Jersey (UK ingredients, metric, UK names like courgette, coriander, mince).
Return JSON only: {"ideas":[{"name":"dish name","why":"one short appealing line","extra":"main ingredients he may need to buy, short","minutes":40}]}
Rules: exactly the number of ideas asked for; each from a DIFFERENT cuisine, following the cuisines and styles given;
never suggest anything in the avoid list (or a near copy of it); respect every like, dislike and allergy given; realistic weeknight cooking.`;

const pick = (arr, n, rnd) => { const a = [...arr]; const out = []; while (out.length < n && a.length) out.push(a.splice(Math.floor(rnd() * a.length), 1)[0]); return out; };
const FOOD = /\b(like|likes|love|loves|hate|hates|doesn'?t|don'?t|won'?t|allerg|vegetarian|vegan|spicy|fish|chips|meat|chicken|beef|pork|eat|eats|food|dish|meal|serves|for four|people)\b/i;

export function parseIdeas(raw, n) {
  const m = String(raw || "").match(/\{[\s\S]*\}/);
  if (!m) return [];
  let j; try { j = JSON.parse(m[0]); } catch { return []; }
  return (Array.isArray(j.ideas) ? j.ideas : []).map((i) => ({ name: String(i.name || "").trim().slice(0, 80), why: String(i.why || "").slice(0, 140), extra: String(i.extra || "").slice(0, 140), minutes: Number(i.minutes) || undefined })).filter((i) => i.name).slice(0, n);
}

export function createMeals({ kv, memories, complete, rnd = Math.random, now = () => Date.now() }) {
  async function recent() { try { return JSON.parse((await kv.get("meal_suggestions")) || "[]"); } catch { return []; } }

  async function ideas({ ingredients = "", count = 3, people = "", note = "" } = {}) {
    const n = Math.min(Math.max(Number(count) || 3, 1), 5);
    const past = (await recent()).filter((x) => now() - x.t < 30 * 864e5);
    const all = await memories().catch(() => []);
    const saved = all.filter((r) => /^recipes?$/.test(r.category)).map((r) => (String(r.text).match(/^Recipe:\s*([^.(\n]+)/i) || [])[1]).filter(Boolean);
    const prefs = all.filter((r) => !/^recipes?$/.test(r.category) && FOOD.test(r.text)).map((r) => r.text).slice(0, 25);
    const avoid = [...new Set([...past.map((x) => x.name), ...saved])].slice(-60);
    const cuisines = pick(CUISINES, n, rnd), styles = pick(STYLES, n, rnd);
    const text = [
      `Ideas wanted: ${n}.`,
      ingredients ? `Build them mainly around what he has: ${ingredients}.` : "He hasn't said what he has in; assume a normal supermarket shop.",
      people ? `Cooking for: ${people}.` : "",
      note ? `He also said: ${note}.` : "",
      `Use these cuisines, one each: ${cuisines.join(", ")} (swap one only if it really can't work with his ingredients).`,
      `Styles to lean towards: ${styles.join(", ")}.`,
      prefs.length ? `Household likes, dislikes and notes (must respect):\n- ${prefs.join("\n- ")}` : "",
      avoid.length ? `Avoid (suggested recently or already saved): ${avoid.join("; ")}.` : "",
    ].filter(Boolean).join("\n");
    const list = parseIdeas(await complete({ system: SYSTEM, text, maxTokens: 700, temperature: 1.0, json: true, prefer: "gemini" }), n);
    if (!list.length) return { ok: false, error: "no_ideas", message: "I couldn't come up with ideas just now. Ask me again in a moment." };
    await kv.set("meal_suggestions", JSON.stringify([...past, ...list.map((i) => ({ name: i.name, t: now() }))].slice(-80)));
    return { ok: true, ideas: list, note: "Give him the dish names (and the one-line why) only, unless he asks for more. These are fresh: different from what you've suggested in the last month." };
  }
  return { ideas };
}
