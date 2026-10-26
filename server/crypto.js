// Crypto prices in US dollars for the brief (same coins as the dashboard watchlist).
export const BRIEF_COINS = [["bitcoin", "Bitcoin", "BTC"], ["ethereum", "Ethereum", "ETH"], ["solana", "Solana", "SOL"], ["ripple", "XRP", "XRP"]];

export function createCrypto({ fetchImpl = fetch } = {}) {
  let cache = null, at = 0;
  async function usd() {
    if (cache && Date.now() - at < 120_000) return cache;
    const r = await fetchImpl(`https://api.coingecko.com/api/v3/simple/price?ids=${BRIEF_COINS.map((c) => c[0]).join(",")}&vs_currencies=usd&include_24hr_change=true`, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`CoinGecko ${r.status}`);
    const j = await r.json();
    cache = BRIEF_COINS.filter(([id]) => j[id]?.usd != null).map(([id, name, symbol]) => ({
      name, symbol, usd: j[id].usd, change_24h_pct: j[id].usd_24h_change == null ? null : Math.round(j[id].usd_24h_change * 10) / 10,
    }));
    at = Date.now();
    return cache;
  }
  return { usd };
}

// "$67,250" / "$2.41": whole dollars above $100, cents below.
export const fmtUsd = (v) => "$" + (v >= 100 ? Math.round(v).toLocaleString("en-US") : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 }));

// One spoken sentence: "Crypto in dollars: Bitcoin $67,250, up 1.2 percent; …"
export function spokenCrypto(list) {
  if (!list?.length) return "";
  const part = (c) => `${c.name} ${fmtUsd(c.usd)}${c.change_24h_pct == null ? "" : c.change_24h_pct === 0 ? ", flat" : `, ${c.change_24h_pct > 0 ? "up" : "down"} ${Math.abs(c.change_24h_pct)} percent`}`;
  return `Crypto in dollars: ${list.map(part).join("; ")}.`;
}
