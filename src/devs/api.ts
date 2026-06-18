// Devs portal API client — talks to the WOC server's /api/devs/* routes using
// the player's existing session token (passed in from the game client).

export interface ContributionScore {
  prsMerged: number;
  prReviews: number;
  issuesOpened: number;
  issuesClosed: number;
  commits: number;
  points: number;
  level: number;
  nextLevelPoints: number;
  progressToNext: number;
}

export interface WocBalance {
  address: string;
  mint: string;
  decimals: number;
  uiAmount: number;
}

export interface DevsProfile {
  repo: string;
  mint: string;
  points: Record<string, number>;
  username: string | null;
  githubUsername: string | null;
  githubVerified: boolean;
  solanaAddress: string | null;
  character: { name: string; class: string; level: number; lifetimeXp: number } | null;
  contribution: ContributionScore | { error: string } | null;
  woc: WocBalance | { error: string; address: string } | null;
  rewards: RewardsInfo;
}

export interface RewardsInfo {
  enabled: boolean;
  decimals: number;
  rateBaseUnits: string;
  claimedBaseUnits: string;
  claimableBaseUnits: string;
  claimableUi: number;
  walletLinked: boolean;
}

export type ClaimResult =
  | { ok: true; signature: string; amountBaseUnits: string; amountUi: number }
  | { ok: false; reason: string };

export interface LeaderboardRow {
  githubUsername: string;
  username: string;
  points: number;
  level: number;
  prsMerged: number;
}

export interface DevsApiConfig {
  base: string;
  getToken: () => string | null;
}

function isContribution(c: DevsProfile['contribution']): c is ContributionScore {
  return !!c && typeof (c as ContributionScore).points === 'number';
}
function isWocBalance(w: DevsProfile['woc']): w is WocBalance {
  return !!w && typeof (w as WocBalance).uiAmount === 'number';
}
export { isContribution, isWocBalance };

async function request<T>(cfg: DevsApiConfig, path: string, init?: RequestInit): Promise<T> {
  const token = cfg.getToken();
  const res = await fetch(cfg.base + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `request failed (${res.status})`);
  return body as T;
}

export function getProfile(cfg: DevsApiConfig): Promise<DevsProfile> {
  return request<DevsProfile>(cfg, '/api/devs/profile');
}

export function getLeaderboard(cfg: DevsApiConfig): Promise<LeaderboardRow[]> {
  return request<{ leaderboard: LeaderboardRow[] }>(cfg, '/api/devs/leaderboard').then((r) => r.leaderboard);
}

export function startGithubLink(cfg: DevsApiConfig, githubUsername: string): Promise<{ githubUsername: string; code: string; verified: boolean }> {
  return request(cfg, '/api/devs/link-github/start', { method: 'POST', body: JSON.stringify({ githubUsername }) });
}

export function verifyGithubLink(cfg: DevsApiConfig): Promise<{ githubUsername: string; verified: boolean }> {
  return request(cfg, '/api/devs/link-github/verify', { method: 'POST' });
}

export function unlinkGithub(cfg: DevsApiConfig): Promise<{ githubUsername: null; verified: boolean }> {
  return request(cfg, '/api/devs/link-github/unlink', { method: 'POST' });
}

export function linkWallet(cfg: DevsApiConfig, solanaAddress: string): Promise<{ solanaAddress: string | null }> {
  return request(cfg, '/api/devs/link-wallet', { method: 'POST', body: JSON.stringify({ solanaAddress }) });
}

export function claimRewards(cfg: DevsApiConfig): Promise<ClaimResult> {
  return request<ClaimResult>(cfg, '/api/devs/claim', { method: 'POST' });
}
