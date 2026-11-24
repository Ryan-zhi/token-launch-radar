// Token launch radar: the valuation model and board builder.
//
// The idea, in one paragraph: a protocol with no token has no market price,
// so the board prices it the way the market prices its closest relatives.
// Every token-bearing protocol in the snapshot contributes a multiple
// (market cap / TVL). A pre-token protocol's implied value is its own TVL
// times the median multiple of its category's traded peers, nudged by two
// small, published adjustments: a growth tilt from its 7-day TVL change and
// a freshness tilt from its age. The model is deliberately simple and fully
// reproducible from the sealed snapshot: anyone can recompute every row.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  base_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  on_watchlist: boolean;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  live_size: number;
  peer_count: number;
  global_multiple: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export const MODEL_VERSION = 'peerradar-1';

export class SnapshotError extends Error {}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot is not valid JSON');
  }
  const s = raw as Snapshot;
  if (typeof s.as_of !== 'string' || !Array.isArray(s.protocols) || !Array.isArray(s.watchlist)) {
    throw new SnapshotError('snapshot is missing as_of, protocols or watchlist');
  }
  return s;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((a - b) / 86_400_000));
}

function median(values: number[]): number {
  const v = [...values].sort((x, y) => x - y);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

// Category families: when a category has too few traded peers of its own,
// the model falls back to the median of its family's peers, then to the
// global peer median. Families group categories whose tokens the market
// prices on the same logic (credit, exchange, yield, infrastructure).
const FAMILIES: Record<string, string[]> = {
  credit: ['Lending', 'CDP', 'Uncollateralized Lending', 'Leveraged Farming', 'Risk Curators'],
  exchange: ['Dexs', 'Derivatives', 'Perps', 'Options', 'Prediction Market'],
  yield: ['Yield', 'Yield Aggregator', 'Basis Trading', 'Indexes', 'Farm'],
  realworld: ['RWA', 'RWA Lending'],
  infra: ['Cross Chain Bridge', 'Bridge', 'Canonical Bridge', 'Oracles', 'Services', 'Privacy'],
};

function familyOf(category: string | null): string | null {
  if (category === null) return null;
  for (const [fam, cats] of Object.entries(FAMILIES)) if (cats.includes(category)) return fam;
  return null;
}

export interface PeerStats {
  byCategory: Map<string, number>;
  byFamily: Map<string, number>;
  global: number;
  count: number;
}

export function peerStats(snapshot: Snapshot): PeerStats {
  const peers = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const catVals = new Map<string, number[]>();
  const famVals = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of peers) {
    const m = p.mcap_usd! / p.tvl_usd;
    all.push(m);
    if (p.category !== null) {
      const arr = catVals.get(p.category) ?? [];
      arr.push(m);
      catVals.set(p.category, arr);
      const fam = familyOf(p.category);
      if (fam !== null) {
        const fa = famVals.get(fam) ?? [];
        fa.push(m);
        famVals.set(fam, fa);
      }
    }
  }
  const byCategory = new Map<string, number>();
  for (const [cat, vals] of catVals) if (vals.length >= 3) byCategory.set(cat, median(vals));
  const byFamily = new Map<string, number>();
  for (const [fam, vals] of famVals) if (vals.length >= 3) byFamily.set(fam, median(vals));
  return { byCategory, byFamily, global: median(all), count: peers.length };
}

export function baseMultiple(p: SnapshotProtocol, stats: PeerStats): number {
  if (p.category !== null) {
    const own = stats.byCategory.get(p.category);
    if (own !== undefined) return own;
    const fam = familyOf(p.category);
    if (fam !== null) {
      const f = stats.byFamily.get(fam);
      if (f !== undefined) return f;
    }
  }
  return stats.global;
}

// The rankable set mirrors the watchlist's exclusions (versioned names,
// wrapped/staked/bridged exchange products) but drops the $50M floor: the
// floor is where the house started reading, not where the radar stops.
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

function growthMultiplier(change7d: number | null): { pct: number; mult: number } {
  const pct = change7d ?? 0;
  return { pct, mult: clamp(1 + clamp(pct, -30, 60) / 200, 0.85, 1.3) };
}

function maturityMultiplier(age: number | null): number {
  if (age === null) return 1;
  return clamp(1.15 - age / 3650, 0.85, 1.15);
}

export function impliedValue(p: SnapshotProtocol, asOf: string, stats: PeerStats): BoardRow['model'] & { implied: number; base: number } {
  const base = baseMultiple(p, stats);
  const { pct, mult } = growthMultiplier(p.change_7d);
  const age = ageDays(asOf, p.listed_at);
  const mat = maturityMultiplier(age);
  const implied = Math.max(1, Math.round(p.tvl_usd * base * mult * mat));
  return {
    implied,
    base,
    base_multiple: Math.round(base * 10000) / 10000,
    growth_pct: pct,
    growth_multiplier: Math.round(mult * 10000) / 10000,
    maturity_multiplier: Math.round(mat * 10000) / 10000,
    age_days: age,
  };
}

// ---- Farm plans -----------------------------------------------------------
// One playbook per product kind. Each step is a concrete action a reader can
// take this week, written for the protocol in the row: its name, its main
// chain and its size decide the wording. No step promises a token; the plans
// say plainly that farming an unannounced launch is speculative.

function chainPhrase(p: SnapshotProtocol): string {
  if (p.chains.length === 0) return 'its main chain';
  if (p.chains.length === 1) return p.chains[0]!;
  return `${p.chains[0]} (it also runs on ${p.chains.slice(1, 3).join(' and ')})`;
}

function sizePhrase(p: SnapshotProtocol): string {
  if (p.tvl_usd >= 500_000_000) return 'one of the largest pools in its category, so positions can be sized up without moving it';
  if (p.tvl_usd >= 50_000_000) return 'large enough that ordinary position sizes fill without slippage worries';
  return 'still small, so early users are a visible share of its activity';
}

type Playbook = (p: SnapshotProtocol) => string[];

const PLAYBOOKS: Record<string, Playbook> = {
  credit: (p) => [
    `Open ${p.name} on ${chainPhrase(p)} and connect a wallet you control; it is ${sizePhrase(p)}. Deposit a stablecoin or ETH position you can leave untouched for a few months, since lenders who churn rarely qualify for anything.`,
    `Borrow a modest amount against your deposit and repay it in full. A completed borrow-and-repay cycle is the clearest on-chain proof you used the credit side of ${p.name}, not just parked funds.`,
    `Repeat the supply side on a schedule: add a small amount every week or two rather than one large deposit, so your history shows a steady user across many snapshots instead of a single drive-by.`,
    `Watch ${p.name}'s own announcements for a points or season program and join it the week it opens if one appears. Until then this is speculative farming: no token has been announced, and activity may never be rewarded.`,
  ],
  exchange: (p) => [
    `Trade on ${p.name} through ${chainPhrase(p)} with your main wallet: swap the pairs you would trade anyway, in normal sizes, a few times a week. Consistent organic volume is what exchange farms have historically rewarded.`,
    `Add a small liquidity position in one of ${p.name}'s core pools and leave it in place. Liquidity providers are usually counted separately from traders, so holding both roles covers more of any future distribution.`,
    `Use one advanced feature at least once: a limit order, a cross-margin position or a bridge-in trade, whichever ${p.name} offers. Feature breadth is a common filter against one-click farmers.`,
    `Keep a simple log of your volume and fees on ${p.name}. If a points program or token is announced, you will know immediately whether your history is worth continuing; nothing has been announced yet, so treat the time as speculation.`,
  ],
  yield: (p) => [
    `Deposit into ${p.name}'s flagship vault on ${chainPhrase(p)}; it is ${sizePhrase(p)}. Pick the vault holding assets you already own so the farm does not force you into an extra trade.`,
    `Split a second, smaller deposit into a different vault or strategy of ${p.name}. Holding more than one position makes your account read as a real allocator rather than a single mercenary deposit.`,
    `Harvest or compound at least once and leave the position in afterwards. A claim followed by staying is a stronger signal than a claim followed by an exit.`,
    `Revisit monthly: yields on ${p.name} rotate, and moving with them keeps your history current. No token has been announced; you are farming the chance that vault share and loyalty are one day measured.`,
  ],
  realworld: (p) => [
    `Start on ${chainPhrase(p)}: read ${p.name}'s asset documentation first, because real-world-asset products carry issuer and redemption terms that pure DeFi does not. Know the lock-up before you deposit anything.`,
    `Make a first deposit you are comfortable holding to term. RWA positions are sticky by design, and early, patient holders are exactly the users a launch would want to keep.`,
    `If ${p.name} offers more than one asset or tranche, hold two small positions rather than one larger one, so your account shows considered use of the product range.`,
    `Track ${p.name}'s attestations and announcements monthly. RWA protocols announce institutional milestones before token news; nothing is promised, and the farm only makes sense if the underlying yield already does.`,
  ],
  infra: (p) => [
    `Use ${p.name} for a transfer or query you actually need, routed through ${chainPhrase(p)}. Infrastructure products count real usage, and a genuine first transaction is the cheapest position to open.`,
    `Repeat the usage across at least three separate weeks. One-off bridge or oracle interactions are the classic sybil shape; a slow drip of real activity is not.`,
    `Try a second route, asset or integration of ${p.name} if one exists, so your history covers more than a single path through the product.`,
    `Follow ${p.name}'s developer and governance channels. Infrastructure tokens, when they come, usually follow a public roadmap; until one is announced this remains speculative, low-cost farming.`,
  ],
};

const GENERIC: Playbook = (p) => [
  `Open ${p.name} on ${chainPhrase(p)} and complete its core action once with a wallet you control; it is ${sizePhrase(p)}. A genuine first use is the position everything else builds on.`,
  `Come back on a cadence: use ${p.name} again in at least three separate weeks, in normal sizes. Recency and repetition are the two signals nearly every retroactive distribution has measured.`,
  `Use a second feature or market of ${p.name} if it offers one, so your account is not a single repeated click. Breadth is a standard filter against scripted farming.`,
  `Watch ${p.name}'s official channels for a points program, season or governance forum and join early if one opens. No token has been announced; treat every step above as speculation that may never pay.`,
];

export function farmSteps(p: SnapshotProtocol): string[] {
  const fam = familyOf(p.category);
  const book = (fam !== null ? PLAYBOOKS[fam] : undefined) ?? GENERIC;
  return book(p);
}

// ---- Board ----------------------------------------------------------------

export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const stats = peerStats(snapshot);
  const rows: BoardRow[] = [];
  for (const p of snapshot.protocols) {
    if (!isRankable(p)) continue;
    const m = impliedValue(p, snapshot.as_of, stats);
    rows.push({
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token',
      age_days: m.age_days,
      implied_value_usd: m.implied,
      model: {
        base_multiple: m.base_multiple,
        growth_pct: m.growth_pct,
        growth_multiplier: m.growth_multiplier,
        maturity_multiplier: m.maturity_multiplier,
        age_days: m.age_days,
      },
      farm_steps: farmSteps(p),
    });
  }
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || a.slug.localeCompare(b.slug));
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

export function buildRadar(snapshot: Snapshot, board: BoardRow[]): RadarData {
  const stats = peerStats(snapshot);
  const watch = new Set(snapshot.watchlist);
  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !isPreToken(p))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? Math.round((p.mcap_usd / p.tvl_usd) * 10000) / 10000 : null,
    }))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0));
  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    live_size: live.length,
    peer_count: stats.count,
    global_multiple: Math.round(stats.global * 10000) / 10000,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      base_multiple: r.model.base_multiple,
      growth_multiplier: r.model.growth_multiplier,
      maturity_multiplier: r.model.maturity_multiplier,
      on_watchlist: watch.has(r.slug),
      farm_steps: r.farm_steps,
    })),
    live,
  };
}

/** The gate's shape, checked before anything is written: same rules the scorer states. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < board.length; i++) if (board[i]!.rank !== i + 1) return `rank ${i + 1} is ${board[i]!.rank}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
