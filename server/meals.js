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

const FALLBACK = [
  { name: "Chicken fajitas", why: "Quick, smoky and done in 20 minutes", extra: "chicken, peppers, wraps", minutes: 20 },
  { name: "Thai green curry", why: "Fragrant and creamy with rice", extra: "green curry paste, coconut milk, chicken", minutes: 30 },
  { name: "Spaghetti carbonara", why: "Proper Roman comfort food", extra: "pancetta, eggs, parmesan", minutes: 20 },
  { name: "Beef stir-fry with noodles", why: "Fast and fresh", extra: "steak strips, noodles, pak choi", minutes: 15 },
  { name: "Chilli con carne", why: "Hearty and better the next day", extra: "beef mince, kidney beans, chopped tomatoes", minutes: 45 },
  { name: "Lamb kofta with flatbreads", why: "Spiced and great with yoghurt", extra: "lamb mince, flatbreads, yoghurt", minutes: 25 },
  { name: "Chicken katsu curry", why: "Crispy chicken with a mild curry sauce", extra: "chicken breast, panko, curry sauce", minutes: 35 },
  { name: "Sausage and mash with onion gravy", why: "A pub classic", extra: "sausages, potatoes, onions", minutes: 35 },
  { name: "Halloumi and vegetable traybake", why: "One tray, hardly any washing up", extra: "halloumi, peppers, courgette", minutes: 35 },
  { name: "Pork gyoza with rice", why: "Little effort, big flavour", extra: "frozen gyoza, rice, soy", minutes: 15 },
  { name: "Steak with peppercorn sauce", why: "A treat for one", extra: "sirloin, cream, peppercorns", minutes: 20 },
  { name: "Chicken shawarma bowl", why: "Spiced chicken, rice and salad", extra: "chicken thighs, pittas, salad", minutes: 30 },
  { name: "Mushroom risotto", why: "Slow-stirred and comforting", extra: "arborio rice, mushrooms, parmesan", minutes: 35 },
  { name: "Salmon teriyaki", why: "Sticky, sweet and quick", extra: "salmon fillet, teriyaki sauce, rice", minutes: 20, fish: true },
  { name: "Smash burgers", why: "Crispy-edged and quick", extra: "beef mince, brioche buns, cheese", minutes: 20 },
  { name: "Prawn and chorizo paella", why: "Smoky Spanish one-pan", extra: "prawns, chorizo, paella rice", minutes: 40, fish: true },
];

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
    // The fast brain first (Gemini was timing out at busy times), with a hard time limit so Bernard is never left waiting.
    let raw = "";
    try { raw = await Promise.race([complete({ system: SYSTEM, text, maxTokens: 700, temperature: 1.0, json: true, prefer: "groq" }), new Promise((_, no) => setTimeout(() => no(new Error("slow")), 18_000))]); } catch {}
    let list = parseIdeas(raw, n);
    // If the AIs are busy, pick from a built-in list instead of coming back empty.
    if (!list.length) {
      const dislikes = prefs.join(" ").toLowerCase();
      const pool = FALLBACK.filter((d) => !avoid.some((a) => a.toLowerCase() === d.name.toLowerCase()) && !(d.fish && /fish/.test(dislikes)));
      list = pick(pool, n, rnd);
    }
    await kv.set("meal_suggestions", JSON.stringify([...past, ...list.map((i) => ({ name: i.name, t: now() }))].slice(-80)));
    return { ok: true, ideas: list, note: "Give him the dish names (and the one-line why) only, unless he asks for more. These are fresh: different from what you've suggested in the last month." };
  }
  return { ideas };
}
