// Devs portal data layer — native to the WOC server.
//
// The companion "Devs portal" turns a player's GitHub contributions to the
// World of ClaudeCraft repo into in-game progression and $WOC rewards. This
// module computes a contributor's stats live from the GitHub API, scores them
// into contribution points + a contribution level, and reads a linked Solana
// wallet's $WOC balance over raw JSON-RPC. Reward CLAIMS (gated) transfer $WOC
// from a treasury via @solana/spl-token; balance reads stay on raw `fetch`.
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, getOrCreateAssociatedTokenAccount, transferChecked } from '@solana/spl-token';

const GITHUB_REPO = process.env.DEVS_GITHUB_REPO?.trim() || 'levy-street/world-of-claudecraft';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN?.trim() || process.env.DEVS_GITHUB_TOKEN?.trim() || '';

// $WOC — Solana mainnet, Token-2022, 6 decimals (fixed supply, mintAuthority null).
const WOC_MINT = process.env.WOC_MINT?.trim() || '3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth';
const WOC_DECIMALS = 6;
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL?.trim() || 'https://api.mainnet-beta.solana.com';

// Contribution point weights — a merged PR is the headline act; reviews, issues,
// and commits round out the picture. Kept deliberately simple and legible.
export const POINTS = {
  prMerged: 50,
  prReviewed: 15,
  issueClosed: 10,
  issueOpened: 3,
  commit: 5,
} as const;

export interface ContributionStats {
  prsMerged: number;
  prReviews: number;
  issuesOpened: number;
  issuesClosed: number;
  commits: number;
}

export interface ContributionScore extends ContributionStats {
  points: number;
  level: number;
  nextLevelPoints: number;
  progressToNext: number; // 0..1
}

// Level curve: each level costs a bit more than the last (quadratic-ish), so
// early contributions feel rewarding and sustained ones keep mattering.
// pointsForLevel(L) = 100 * L * (L - 1) / 2  →  L1=0, L2=100, L3=300, L4=600 …
function pointsForLevel(level: number): number {
  return Math.round((100 * level * (level - 1)) / 2);
}
export function levelForPoints(points: number): { level: number; nextLevelPoints: number; progressToNext: number } {
  let level = 1;
  while (pointsForLevel(level + 1) <= points) level++;
  const cur = pointsForLevel(level);
  const next = pointsForLevel(level + 1);
  const span = next - cur || 1;
  return { level, nextLevelPoints: next, progressToNext: Math.max(0, Math.min(1, (points - cur) / span)) };
}

export function scoreContributions(stats: ContributionStats): ContributionScore {
  const points =
    stats.prsMerged * POINTS.prMerged +
    stats.prReviews * POINTS.prReviewed +
    stats.issuesClosed * POINTS.issueClosed +
    stats.issuesOpened * POINTS.issueOpened +
    stats.commits * POINTS.commit;
  const { level, nextLevelPoints, progressToNext } = levelForPoints(points);
  return { ...stats, points, level, nextLevelPoints, progressToNext };
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'world-of-claudecraft-devs-portal',
  };
  if (GITHUB_TOKEN) h.Authorization = `Bearer ${GITHUB_TOKEN}`;
  return h;
}

async function ghSearchCount(q: string): Promise<number> {
  const res = await fetch(`https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=1`, {
    headers: ghHeaders(),
  });
  if (!res.ok) throw new Error(`github search ${res.status}`);
  const body = (await res.json()) as { total_count?: number };
  return body.total_count ?? 0;
}

async function ghCommitCount(githubUser: string): Promise<number> {
  const res = await fetch(
    `https://api.github.com/search/commits?q=${encodeURIComponent(`repo:${GITHUB_REPO} author:${githubUser}`)}&per_page=1`,
    { headers: { ...ghHeaders(), Accept: 'application/vnd.github.cloak-preview+json' } },
  );
  if (!res.ok) return 0; // commit search is best-effort (stricter rate limits)
  const body = (await res.json()) as { total_count?: number };
  return body.total_count ?? 0;
}

const statsCache = new Map<string, { at: number; stats: ContributionStats }>();
const CACHE_MS = 5 * 60 * 1000;

export async function fetchContributionStats(githubUser: string): Promise<ContributionStats> {
  const key = githubUser.toLowerCase();
  const hit = statsCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < CACHE_MS) return hit.stats;

  const repo = GITHUB_REPO;
  const [prsMerged, prReviews, issuesOpened, issuesClosed, commits] = await Promise.all([
    ghSearchCount(`repo:${repo} author:${githubUser} is:pr is:merged`),
    ghSearchCount(`repo:${repo} reviewed-by:${githubUser} is:pr`),
    ghSearchCount(`repo:${repo} author:${githubUser} is:issue`),
    ghSearchCount(`repo:${repo} author:${githubUser} is:issue is:closed`),
    ghCommitCount(githubUser),
  ]);
  const stats: ContributionStats = { prsMerged, prReviews, issuesOpened, issuesClosed, commits };
  statsCache.set(key, { at: now, stats });
  return stats;
}

// Read a user's public GitHub bio — used to confirm they placed the one-time
// verification code there before we credit their contributions.
export async function fetchGithubBio(githubUser: string): Promise<string | null> {
  const res = await fetch(`https://api.github.com/users/${encodeURIComponent(githubUser)}`, { headers: ghHeaders() });
  if (!res.ok) return null;
  const body = (await res.json()) as { bio?: string | null };
  return body.bio ?? null;
}

// ---------------------------------------------------------------------------
// $WOC balance (raw Solana JSON-RPC, Token-2022 aware via mint filter)
// ---------------------------------------------------------------------------

export interface WocBalance {
  address: string;
  mint: string;
  decimals: number;
  uiAmount: number;
}

export async function fetchWocBalance(owner: string): Promise<WocBalance> {
  const res = await fetch(SOLANA_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTokenAccountsByOwner',
      params: [owner, { mint: WOC_MINT }, { encoding: 'jsonParsed' }],
    }),
  });
  if (!res.ok) throw new Error(`solana rpc ${res.status}`);
  const body = (await res.json()) as {
    result?: { value?: Array<{ account: { data: { parsed: { info: { tokenAmount: { uiAmount: number | null } } } } } }> };
  };
  const uiAmount = (body.result?.value ?? []).reduce(
    (sum, acc) => sum + (acc.account.data.parsed.info.tokenAmount.uiAmount ?? 0),
    0,
  );
  return { address: owner, mint: WOC_MINT, decimals: WOC_DECIMALS, uiAmount };
}

// ---------------------------------------------------------------------------
// $WOC rewards (GATED — real money). Inert unless a treasury keypair AND a
// positive reward rate are configured. Rewards are TRANSFERS from a pre-funded
// treasury (the mint has no mint authority), never new mints.
// ---------------------------------------------------------------------------

const ZERO = BigInt(0);

export function rewardRateBaseUnits(): bigint {
  const raw = process.env.WOC_REWARD_RATE_BASE_UNITS?.trim();
  if (!raw || !/^\d+$/.test(raw)) return ZERO;
  return BigInt(raw);
}

/** Treasury keypair from a Solana CLI keypair JSON byte array, or null. */
export function loadTreasuryKeypair(): Keypair | null {
  const raw = process.env.SOLANA_TREASURY_KEYPAIR;
  if (!raw) return null;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[]));
}

export function rewardsEnabled(): boolean {
  return rewardRateBaseUnits() > ZERO && process.env.SOLANA_TREASURY_KEYPAIR != null;
}

export function computeClaimable(points: number, claimedBaseUnits: bigint): bigint {
  const earned = BigInt(Math.max(0, Math.trunc(points))) * rewardRateBaseUnits();
  const claimable = earned - claimedBaseUnits;
  return claimable > ZERO ? claimable : ZERO;
}

/** Build, sign, and send a Token-2022 transfer of `amount` base units of $WOC. */
export async function transferWoc(treasury: Keypair, recipientAddress: string, amount: bigint): Promise<string> {
  const conn = new Connection(SOLANA_RPC_URL, 'confirmed');
  const mint = new PublicKey(WOC_MINT);
  const fromAta = await getOrCreateAssociatedTokenAccount(
    conn, treasury, mint, treasury.publicKey, false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID,
  );
  const toAta = await getOrCreateAssociatedTokenAccount(
    conn, treasury, mint, new PublicKey(recipientAddress), false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID,
  );
  return transferChecked(
    conn, treasury, fromAta.address, mint, toAta.address, treasury, amount, WOC_DECIMALS, [], { commitment: 'confirmed' }, TOKEN_2022_PROGRAM_ID,
  );
}

export const DEVS_GITHUB_REPO = GITHUB_REPO;
export const DEVS_WOC_MINT = WOC_MINT;
export const DEVS_WOC_DECIMALS = WOC_DECIMALS;
