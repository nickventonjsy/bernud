// The household emergency store: what to keep in for riding out a serious emergency at home, how much for the
// household and number of days, what he's got (with optional use-by dates), and a monthly nudge about gaps.
// Same list as the "Jersey Emergency Store" page; ticks are kept here so voice, dashboard and phone agree.

// per: "pd" per person per day, "hd" per household per day, "p" per person, "h" per household, "pet" per day for Vega.
// local: usually can't be posted to Jersey (batteries, gas, lighters, flammable liquids, heavy water): buy on-island.
export const STORE = [
  { t: "Water", why: "3 litres a person a day just to drink; washing and cooking need more.", items: [
    { n: "Bottled drinking water, 5 litre", per: "pd", rate: 0.7, unit: "bottles", q: "5 litre bottled water", local: true },
    { n: "Water storage containers, 20 litre", per: "h", rate: 2, unit: "containers", q: "20 litre water container with tap food grade" },
    { n: "Portable water filter", per: "h", rate: 1, unit: "filter", q: "portable water filter straw Sawyer LifeStraw" },
    { n: "Water purification tablets", per: "pd", rate: 1, unit: "tablets", q: "water purification tablets" },
  ]},
  { t: "Food", why: "Long-life food that needs no fridge and little cooking, about 2,000 calories a person a day.", items: [
    { n: "Tinned meals (chilli, stew, curry, soup)", per: "pd", rate: 1, unit: "tins", q: "tinned meals stew chilli" },
    { n: "Tinned meat (corned beef, chicken, ham)", per: "pd", rate: 0.3, unit: "tins", q: "tinned chicken corned beef" },
    { n: "Tinned vegetables and beans", per: "pd", rate: 1, unit: "tins", q: "tinned vegetables baked beans multipack" },
    { n: "Tinned fruit", per: "pd", rate: 0.5, unit: "tins", q: "tinned fruit in juice multipack" },
    { n: "Rice, 1 kg", per: "pd", rate: 0.08, unit: "bags", q: "long grain rice 1kg" },
    { n: "Pasta, 500 g", per: "pd", rate: 0.16, unit: "bags", q: "dried pasta 500g multipack" },
    { n: "Porridge oats, 1 kg", per: "pd", rate: 0.07, unit: "bags", q: "porridge oats 1kg" },
    { n: "Long-life (UHT) milk, 1 litre", per: "pd", rate: 0.25, unit: "cartons", q: "UHT long life milk 1 litre" },
    { n: "Peanut butter", per: "pd", rate: 0.1, unit: "jars", q: "peanut butter large jar" },
    { n: "Crackers and oatcakes", per: "pd", rate: 0.2, unit: "packs", q: "oatcakes crackers multipack" },
    { n: "Nuts and dried fruit", per: "pd", rate: 0.1, unit: "1 kg bags", q: "mixed nuts dried fruit 1kg" },
    { n: "Cereal or protein bars", per: "pd", rate: 2, unit: "bars", q: "cereal bars bulk box" },
    { n: "Instant noodles", per: "pd", rate: 0.5, unit: "packs", q: "instant noodles box" },
    { n: "Freeze-dried camping meals", per: "pd", rate: 0.3, unit: "pouches", q: "freeze dried meals long shelf life" },
    { n: "Lentils or dried beans, 1 kg", per: "pd", rate: 0.03, unit: "bags", q: "red lentils 1kg" },
    { n: "Honey, sugar, salt, stock cubes", per: "h", rate: 1, unit: "set", q: "stock cubes bulk" },
    { n: "Tea, coffee, hot chocolate", per: "pd", rate: 3, unit: "cups' worth", q: "instant coffee tea bags bulk" },
    { n: "Multivitamins", per: "pd", rate: 1, unit: "tablets", q: "multivitamin tablets 365" },
  ]},
  { t: "Cooking", why: "To heat food and boil water without mains power or gas.", items: [
    { n: "Camping stove", per: "h", rate: 1, unit: "stove", q: "portable butane gas stove" },
    { n: "Gas cartridges for the stove", per: "hd", rate: 0.5, unit: "cartridges", q: "butane gas cartridges", local: true },
    { n: "Matches and lighters", per: "h", rate: 4, unit: "boxes/lighters", q: "storm proof matches", local: true },
    { n: "Manual tin opener", per: "h", rate: 2, unit: "openers", q: "manual tin opener" },
    { n: "Pan and kettle for the stove", per: "h", rate: 1, unit: "set", q: "camping cookware set kettle" },
    { n: "Foil, cling film, zip bags", per: "h", rate: 1, unit: "set", q: "freezer zip lock bags" },
  ]},
  { t: "Light, power and news", why: "Power cuts are the most likely problem; the radio is how instructions arrive.", items: [
    { n: "Wind-up / solar radio with torch", per: "h", rate: 1, unit: "radio", q: "wind up solar radio torch DAB FM" },
    { n: "Head torches", per: "p", rate: 1, unit: "torches", q: "LED head torch" },
    { n: "LED lanterns", per: "h", rate: 2, unit: "lanterns", q: "LED camping lantern battery" },
    { n: "AA and AAA batteries", per: "h", rate: 40, unit: "batteries", q: "AA batteries bulk", local: true },
    { n: "Power banks, 20,000 mAh", per: "p", rate: 1, unit: "power banks", q: "power bank 20000mAh", local: true },
    { n: "Folding solar panel charger", per: "h", rate: 1, unit: "panel", q: "foldable solar panel charger USB" },
    { n: "Walkie-talkies (PMR446)", per: "h", rate: 1, unit: "pair", q: "PMR446 walkie talkie pair rechargeable" },
  ]},
  { t: "Warmth and shelter", why: "Without heating, staying warm matters as much as food.", items: [
    { n: "Sleeping bags (3-season or warmer)", per: "p", rate: 1, unit: "bags", q: "3 season sleeping bag" },
    { n: "Foil emergency blankets", per: "p", rate: 2, unit: "blankets", q: "emergency foil blanket pack" },
    { n: "Thermal base layers", per: "p", rate: 1, unit: "sets", q: "thermal base layer set" },
    { n: "Hand warmers", per: "pd", rate: 0.5, unit: "pairs", q: "hand warmers bulk" },
    { n: "Tarpaulin and heavy plastic sheeting", per: "h", rate: 1, unit: "set", q: "heavy duty tarpaulin waterproof" },
    { n: "Duct tape", per: "h", rate: 3, unit: "rolls", q: "duct tape heavy duty" },
  ]},
  { t: "First aid and health", why: "Ask for repeat prescriptions in good time.", items: [
    { n: "Proper first aid kit", per: "h", rate: 1, unit: "kit", q: "first aid kit home large" },
    { n: "Prescription medicines (a month ahead)", per: "h", rate: 1, unit: "for each person", q: "pill organiser weekly" },
    { n: "Paracetamol and ibuprofen", per: "h", rate: 4, unit: "packs", q: "paracetamol ibuprofen", local: true },
    { n: "Rehydration sachets (e.g. Dioralyte)", per: "p", rate: 6, unit: "sachets", q: "oral rehydration sachets" },
    { n: "Antihistamines", per: "h", rate: 2, unit: "packs", q: "antihistamine tablets cetirizine" },
    { n: "Digital thermometer", per: "h", rate: 1, unit: "thermometer", q: "digital thermometer" },
    { n: "FFP3 masks", per: "p", rate: 5, unit: "masks", q: "FFP3 mask" },
    { n: "Nitrile gloves", per: "h", rate: 1, unit: "box of 100", q: "nitrile gloves box 100" },
  ]},
  { t: "Hygiene and sanitation", why: "If the water or sewers stop, this stops people getting ill.", items: [
    { n: "Toilet roll", per: "pd", rate: 0.4, unit: "rolls", q: "toilet roll bulk" },
    { n: "Emergency toilet bags and gelling powder", per: "pd", rate: 1, unit: "bags", q: "emergency toilet bags gelling" },
    { n: "Bucket with lid", per: "h", rate: 1, unit: "bucket", q: "bucket with lid 20 litre" },
    { n: "Heavy-duty bin bags", per: "pd", rate: 0.5, unit: "bags", q: "heavy duty bin bags" },
    { n: "Wet wipes", per: "pd", rate: 0.25, unit: "packs", q: "wet wipes bulk" },
    { n: "Hand sanitiser", per: "p", rate: 1, unit: "bottles", q: "hand sanitiser gel 500ml", local: true },
    { n: "Soap, toothpaste, toothbrushes", per: "p", rate: 1, unit: "sets", q: "toiletries multipack" },
    { n: "Sanitary products", per: "h", rate: 1, unit: "month's supply", q: "sanitary towels bulk" },
    { n: "Unscented bleach", per: "h", rate: 2, unit: "bottles", q: "unscented bleach", local: true },
  ]},
  { t: "Tools, safety and papers", why: "The small things that get you out of trouble.", items: [
    { n: "Multitool", per: "h", rate: 1, unit: "multitool", q: "multitool" },
    { n: "Work gloves", per: "p", rate: 1, unit: "pairs", q: "work gloves" },
    { n: "Fire blanket and extinguisher", per: "h", rate: 1, unit: "set", q: "fire blanket fire extinguisher home" },
    { n: "Smoke and carbon monoxide alarms", per: "h", rate: 2, unit: "alarms", q: "carbon monoxide alarm" },
    { n: "Whistle", per: "p", rate: 1, unit: "whistles", q: "emergency whistle" },
    { n: "Waterproof document wallet", per: "h", rate: 1, unit: "wallet", q: "waterproof document bag" },
    { n: "Cash in small notes", per: "h", rate: 1, unit: "envelope", q: "cash envelope wallet" },
    { n: "Paper map of Jersey, notebook and pens", per: "h", rate: 1, unit: "set", q: "Jersey Channel Islands map" },
  ]},
  { t: "Vega", why: "Don't forget the cat.", items: [
    { n: "Cat food", per: "pet", rate: 1, unit: "pouches", q: "cat food pouches bulk" },
    { n: "Cat litter", per: "h", rate: 2, unit: "bags", q: "cat litter 10 litre" },
  ]},
  { t: "Keeping sane", why: "Long days indoors without power or a phone.", items: [
    { n: "Cards, board games, puzzle books", per: "h", rate: 1, unit: "set", q: "playing cards board games" },
    { n: "Books", per: "p", rate: 2, unit: "books", q: "paperback books" },
  ]},
];

export const itemKey = (section, name) => (section + "-" + name).toLowerCase().replace(/[^a-z0-9]+/g, "-");
export const amazonLink = (q) => "https://www.amazon.co.uk/s?k=" + encodeURIComponent(q);
export function quantity(it, people, days) {
  if (it.per === "pet") return Math.ceil(it.rate * days);
  if (it.per === "hd") return Math.max(1, Math.ceil(it.rate * days));
  if (it.per === "pd") return Math.max(1, Math.ceil(it.rate * people * days));
  if (it.per === "p") return Math.ceil(it.rate * people);
  return it.rate;
}

const words = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !/^(the|and|for|some|got|bought|have|with)$/.test(w));
// Best match for what he said ("the water containers", "head torches", "cat food").
export function findItem(text) {
  const q = words(text);
  if (!q.length) return null;
  let best = null, score = 0;
  for (const s of STORE) for (const it of s.items) {
    const name = words(it.n + " " + s.t), hits = q.filter((w) => name.some((n) => n.startsWith(w.slice(0, 5)) || w.startsWith(n.slice(0, 5)))).length;
    const sc = hits / q.length + (hits === q.length ? 0.5 : 0);
    if (hits && sc > score) { best = { section: s.t, item: it, key: itemKey(s.t, it.n) }; score = sc; }
  }
  return score >= 0.5 ? best : null;
}

export function createPrepStore({ kv, notify = async () => {}, now = () => new Date() }) {
  const load = async () => { try { return { people: 4, days: 14, have: {}, ...(JSON.parse((await kv.get("prep_store")) || "{}")) }; } catch { return { people: 4, days: 14, have: {} }; } };
  const save = (s) => kv.set("prep_store", JSON.stringify(s));
  const month = (d) => d.toISOString().slice(0, 7);

  function view(s) {
    const sections = STORE.map((sec) => ({ title: sec.t, why: sec.why, items: sec.items.map((it) => {
      const key = itemKey(sec.t, it.n), h = s.have[key];
      return { key, name: it.n, qty: quantity(it, s.people, s.days), unit: it.unit, buy_on_island: Boolean(it.local), link: amazonLink(it.q), have: Boolean(h), got: h?.at || undefined, use_by: h?.use_by || undefined };
    }) }));
    const all = sections.flatMap((x) => x.items), got = all.filter((i) => i.have).length;
    return { people: s.people, days: s.days, sorted: got, total: all.length, sections };
  }
  // Use-by dates within two months (YYYY-MM or YYYY-MM-DD).
  function expiring(v, within = 2) {
    const t = now(), lim = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + within + 1, 0)).toISOString().slice(0, 10);
    return v.sections.flatMap((s) => s.items).filter((i) => i.use_by && (i.use_by.length === 7 ? i.use_by + "-28" : i.use_by) <= lim).map((i) => ({ name: i.name, use_by: i.use_by }));
  }

  async function handle({ action = "status", item = "", have = true, use_by = "", people, days, section = "" } = {}) {
    const s = await load();
    if (action === "settings") {
      if (people != null) s.people = Math.min(Math.max(Math.round(+people) || 4, 1), 12);
      if (days != null) s.days = [3, 7, 14, 30].reduce((a, b) => (Math.abs(b - +days) < Math.abs(a - +days) ? b : a), 14);
      await save(s);
      const v = view(s); return { ok: true, people: v.people, days: v.days, note: "Quantities now cover this household for this many days." };
    }
    if (action === "tick" || action === "untick") {
      const hit = STORE.flatMap((sec) => sec.items.map((it) => ({ key: itemKey(sec.t, it.n), item: it, section: sec.t }))).find((x) => x.key === item) || findItem(item);
      if (!hit) return { ok: false, error: `No item on the list matches "${item}".` };
      if (action === "untick" || have === false) delete s.have[hit.key];
      else s.have[hit.key] = { at: now().toISOString().slice(0, 10), ...(/^\d{4}-\d{2}(-\d{2})?$/.test(String(use_by)) ? { use_by: String(use_by) } : {}) };
      await save(s);
      const v = view(s);
      return { ok: true, item: hit.item.n, have: Boolean(s.have[hit.key]), use_by: s.have[hit.key]?.use_by, sorted: v.sorted, total: v.total };
    }
    const v = view(s);
    if (action === "list") {
      const secs = section ? v.sections.filter((x) => x.title.toLowerCase().includes(String(section).toLowerCase())) : v.sections;
      return { ok: true, people: v.people, days: v.days, sections: secs.map((x) => ({ title: x.title, items: x.items.map((i) => ({ name: i.name, need: `${i.qty} ${i.unit}`, have: i.have, buy_on_island: i.buy_on_island || undefined })) })) };
    }
    if (action === "send") {   // the gaps, with Amazon links, to his phone / Telegram so he can add them to his basket himself
      const pick = String(section || item || "").toLowerCase();
      const miss = v.sections.filter((x) => !pick || x.title.toLowerCase().includes(pick)).flatMap((x) => x.items.filter((i) => !i.have));
      if (!miss.length) return { ok: true, sent: 0, note: "Nothing missing there." };
      const lines = miss.slice(0, 15).map((i) => `• ${i.name}: ${i.qty} ${i.unit}${i.buy_on_island ? " (buy on-island)" : ""}\n${i.link}`);
      const ok = await notify(lines.join("\n") + (miss.length > 15 ? `\n…and ${miss.length - 15} more on the dashboard.` : ""), { title: "🛒 Emergency store: still to get" }).catch(() => false);
      return { ok: ok !== false, sent: Math.min(15, miss.length), missing: miss.length, note: "Sent as Amazon search links. He adds them to his basket himself; Bernud can't reach his Amazon account." };
    }
    if (action === "missing") {
      const miss = v.sections.flatMap((x) => x.items.filter((i) => !i.have).map((i) => ({ section: x.title, name: i.name, need: `${i.qty} ${i.unit}`, buy_on_island: i.buy_on_island || undefined })));
      return { ok: true, missing: miss.length, first: miss.slice(0, 12), note: "Water and food first. 'Buy on-island' items usually can't be posted to Jersey." };
    }
    // status
    return { ok: true, people: v.people, days: v.days, sorted: v.sorted, total: v.total,
      by_section: v.sections.map((x) => ({ section: x.title, have: x.items.filter((i) => i.have).length, of: x.items.length })),
      expiring_soon: expiring(v), note: "The full list with Amazon links is on the dashboard (Features, Emergency store)." };
  }

  // On the 1st of each month after 10am: progress, the next few gaps, and anything near its use-by date.
  async function tick() {
    const t = now();
    if (t.getUTCDate() !== 1 || t.getUTCHours() < 10) return;
    if ((await kv.get("prep_store_nudged")) === month(t)) return;
    await kv.set("prep_store_nudged", month(t));
    const s = await load(), v = view(s), exp = expiring(v);
    const miss = v.sections.flatMap((x) => x.items.filter((i) => !i.have).map((i) => i.name));
    if (!miss.length && !exp.length) return;
    const lines = [`${v.sorted} of ${v.total} sorted for ${v.people} people, ${v.days} days.`];
    if (miss.length) lines.push("Next to get: " + miss.slice(0, 4).join(", ") + (miss.length > 4 ? ` and ${miss.length - 4} more` : "") + ".");
    if (exp.length) lines.push("Use or replace soon: " + exp.map((e) => `${e.name} (${e.use_by})`).join(", ") + ".");
    await notify(lines.join("\n"), { title: "🥫 Emergency store" }).catch(() => {});
  }

  return { handle, tick, view: async () => view(await load()) };
}
