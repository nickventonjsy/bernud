// Shopping list by voice: add, remove, read out, send to the phone grouped by aisle.
const AISLES = [
  ["Fruit & veg", /\b(apples?|bananas?|oranges?|lemons?|limes?|grapes?|berr(y|ies)|strawberr|blueberr|melon|pears?|potato|onions?|garlic|carrots?|peppers?|tomato|lettuce|salad|cucumber|mushroom|broccoli|spinach|courgette|aubergine|avocado|herbs?|coriander|basil|parsley|ginger|chill?i|veg|fruit|leeks?|celery|cabbage|sweetcorn|beansprouts|kale)\b/],
  ["Meat & fish", /\b(chicken|beef|mince|pork|lamb|bacon|sausages?|ham|steak|turkey|fish|salmon|cod|haddock|tuna|prawns?|chorizo|burgers?|meatballs)\b/],
  ["Dairy & eggs", /\b(milk|cheese|cheddar|mozzarella|butter|yog(h)?urt|cream|eggs?|marg(arine)?|cr[eè]me)\b/],
  ["Bakery", /\b(bread|rolls?|bagels?|wraps?|croissants?|pittas?|naans?|cakes?|muffins?|baguette|crumpets?|teacakes?)\b/],
  ["Frozen", /\b(frozen|ice ?cream|oven chips|peas|pizza|ice)\b/],
  ["Food cupboard", /\b(pasta|spaghetti|rice|noodles?|flour|sugar|salt|oil|vinegar|sauce|ketchup|mayo(nnaise)?|tins?|tinned|beans|soup|cereal|oats|porridge|tea|coffee|jam|honey|stock|spices?|crisps|biscuits?|chocolate|nuts|peanut butter|marmite|gravy|curry paste)\b/],
  ["Drinks", /\b(water|juice|squash|coke|cola|pepsi|lemonade|beer|lager|wine|prosecco|cider|gin|vodka|whisky|rum|drinks?|tonic|energy drinks?)\b/],
  ["Household", /\b(bin bags?|bin liners|toilet (roll|paper)|loo roll|kitchen roll|washing (up )?liquid|washing powder|detergent|fabric softener|soap|bleach|cleaner|sponges?|foil|cling ?film|batter(y|ies)|light ?bulbs?|tissues|dishwasher tablets?|sandwich bags)\b/],
  ["Toiletries & medicine", /\b(shampoo|conditioner|toothpaste|toothbrush|deodorant|razors?|shower gel|body wash|lotion|plasters|paracetamol|ibuprofen|cotton|hand wash|sun ?cream)\b/],
  ["Pets", /\b(dog|cat|pet|kitten|puppy)\b/],
];
export const aisleOf = (item) => (AISLES.find(([, re]) => re.test(item.toLowerCase())) || ["Other"])[0];

// "milk, bread and two tins of beans" -> ["milk", "bread", "two tins of beans"]
export function parseItems(text) {
  return String(text || "").split(/,|;|\band\b|&|\bplus\b/i)
    .map((s) => s.replace(/^\s*(some|a few|an?|the)\s+/i, "").replace(/[.!?]+$/, "").trim())
    .filter((s) => s && s.length <= 60);
}

export function createShopping({ kv, notify, openNote = null, telegram = null }) {
  const load = async () => { try { return JSON.parse((await kv.get("shopping_list")) || "[]"); } catch { return []; } };
  const save = (l) => kv.set("shopping_list", JSON.stringify(l));
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  const grouped = (l) => {
    const by = {};
    for (const it of l) (by[aisleOf(it.item)] ||= []).push(it.item);
    const order = [...AISLES.map(([n]) => n), "Other"];
    return order.filter((n) => by[n]).map((n) => ({ aisle: n, items: by[n] }));
  };

  async function handle({ action = "list", items = "", text = "" } = {}) {
    const list = await load();
    const asked = Array.isArray(items) ? items.map(String) : parseItems(items || text);
    if (action === "add") {
      const added = [];
      for (const i of asked) if (!list.some((x) => same(x.item, i))) { list.push({ item: i, added: new Date().toISOString() }); added.push(i); }
      await save(list);
      return { ok: true, added, already: asked.filter((i) => !added.includes(i)), count: list.length };
    }
    if (action === "remove") {
      const removed = [];
      for (const i of asked) {
        const k = list.findIndex((x) => same(x.item, i)) >= 0 ? list.findIndex((x) => same(x.item, i)) : list.findIndex((x) => x.item.toLowerCase().includes(i.toLowerCase()));
        if (k >= 0) removed.push(list.splice(k, 1)[0].item);
      }
      await save(list);
      return { ok: true, removed, not_found: asked.filter((i) => !removed.some((r) => r.toLowerCase().includes(i.toLowerCase()))), count: list.length };
    }
    if (action === "clear") { await save([]); return { ok: true, cleared: list.length }; }
    const body = () => grouped(list).map((g) => `${g.aisle}:\n${g.items.map((i) => "• " + i).join("\n")}`).join("\n\n");
    if (action === "send") {
      if (!list.length) return { ok: true, empty: true, message: "The shopping list is empty." };
      // Telegram gets it with tick-off buttons; the phone notification is the fallback.
      const tg = telegram ? await telegram().sendList().catch(() => ({ sent: 0 })) : { sent: 0 };
      if (!tg.sent) await notify(body(), { title: `Shopping list (${list.length})`, tags: "shopping_cart", telegram: false });
      return { ok: true, sent: true, count: list.length, via: tg.sent ? "Telegram (with tick-off buttons)" : "phone notification" };
    }
    if (action === "note") {
      if (!list.length) return { ok: true, empty: true, message: "The shopping list is empty, so there's nothing to put in a note." };
      if (!openNote) return { ok: false, message: "Opening notes needs the Bernard phone app." };
      const r = await openNote("Shopping list\n\n" + body());
      return r.ok ? { ok: true, opened: true, done: r.done, count: list.length } : { ok: false, message: r.message };
    }
    return { ok: true, count: list.length, items: list.map((x) => x.item), by_aisle: grouped(list) };
  }
  return { handle };
}
