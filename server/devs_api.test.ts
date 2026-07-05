// Route-logic tests for /api/devs/*: the HTTP helpers (json/readBody) and the
// data layer are mocked so the REAL routing — gating order, input validation,
// reserve-then-pay orchestration, 404s — is exercised and its responses asserted.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./http_util', () => ({
  json: vi.fn((res: { _s?: number; _b?: unknown }, status: number, body: unknown) => { res._s = status; res._b = body; }),
  readBody: vi.fn(),
}));
vi.mock('./devs_db', () => ({
  getDevsLinks: vi.fn(), startGithubLink: vi.fn(), getGithubChallenge: vi.fn(), markGithubVerified: vi.fn(),
  unlinkGithub: vi.fn(), githubVerifiedElsewhere: vi.fn(), setSolanaAddress: vi.fn(), leadCharacter: vi.fn(),
  upsertContributionScore: vi.fn(), contributionLeaderboard: vi.fn(), getClaimedBaseUnits: vi.fn(),
  reserveClaim: vi.fn(), releaseClaim: vi.fn(), finalizeClaim: vi.fn(), grantContributionXp: vi.fn(),
}));
vi.mock('./devs', () => ({
  fetchContributionStats: vi.fn(), scoreContributions: vi.fn(), fetchWocBalance: vi.fn(), fetchGithubBio: vi.fn(),
  rewardsEnabled: vi.fn(() => false), rewardRateBaseUnits: vi.fn(() => BigInt(0)), computeClaimable: vi.fn(() => BigInt(0)),
  transferWoc: vi.fn(), loadTreasuryKeypair: vi.fn(), contributionXpFor: vi.fn((p: number) => p * 25), xpPerPoint: vi.fn(() => 25),
  POINTS: {}, DEVS_GITHUB_REPO: 'levy-street/world-of-claudecraft', DEVS_WOC_MINT: 'MINT', DEVS_WOC_DECIMALS: 6,
}));

import { handleDevsApi } from './devs_api';
import { readBody } from './http_util';
import * as db from './devs_db';
import * as devs from './devs';

const req = (method: string) => ({ method }) as never;
const mkres = () => ({}) as { _s?: number; _b?: { error?: string; reason?: string } };
beforeEach(() => vi.clearAllMocks());

describe('claim gating', () => {
  it('503 when rewards are disabled', async () => {
    vi.mocked(devs.rewardsEnabled).mockReturnValue(false);
    const res = mkres();
    await handleDevsApi('/api/devs/claim', req('POST'), res as never, 1);
    expect(res._s).toBe(503);
    expect(res._b?.error).toMatch(/not enabled/);
  });

  it('400 when GitHub is not verified', async () => {
    vi.mocked(devs.rewardsEnabled).mockReturnValue(true);
    vi.mocked(db.getDevsLinks).mockResolvedValue({ username: 'u', githubUsername: 'x', githubVerified: false, solanaAddress: 'addr' });
    const res = mkres();
    await handleDevsApi('/api/devs/claim', req('POST'), res as never, 1);
    expect(res._s).toBe(400);
    expect(res._b?.error).toMatch(/verify your GitHub/);
  });

  it('400 when no wallet is linked', async () => {
    vi.mocked(devs.rewardsEnabled).mockReturnValue(true);
    vi.mocked(db.getDevsLinks).mockResolvedValue({ username: 'u', githubUsername: 'x', githubVerified: true, solanaAddress: null });
    const res = mkres();
    await handleDevsApi('/api/devs/claim', req('POST'), res as never, 1);
    expect(res._s).toBe(400);
    expect(res._b?.error).toMatch(/wallet/);
  });
});

describe('link validation', () => {
  it('rejects an invalid GitHub username (start)', async () => {
    vi.mocked(readBody).mockResolvedValue({ githubUsername: 'not a valid name!' });
    const res = mkres();
    await handleDevsApi('/api/devs/link-github/start', req('POST'), res as never, 1);
    expect(res._s).toBe(400);
    expect(res._b?.error).toMatch(/invalid GitHub username/);
    expect(db.startGithubLink).not.toHaveBeenCalled();
  });

  it('409 when the GitHub handle is verified by another account (start)', async () => {
    vi.mocked(readBody).mockResolvedValue({ githubUsername: 'realuser' });
    vi.mocked(db.githubVerifiedElsewhere).mockResolvedValue(true);
    const res = mkres();
    await handleDevsApi('/api/devs/link-github/start', req('POST'), res as never, 1);
    expect(res._s).toBe(409);
    expect(db.startGithubLink).not.toHaveBeenCalled();
  });

  it('rejects a malformed Solana address (link-wallet)', async () => {
    vi.mocked(readBody).mockResolvedValue({ solanaAddress: 'totally-not-base58-0OIl' });
    const res = mkres();
    await handleDevsApi('/api/devs/link-wallet', req('POST'), res as never, 1);
    expect(res._s).toBe(400);
    expect(db.setSolanaAddress).not.toHaveBeenCalled();
  });

  it('accepts a well-shaped Solana address', async () => {
    vi.mocked(readBody).mockResolvedValue({ solanaAddress: '3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth' });
    const res = mkres();
    await handleDevsApi('/api/devs/link-wallet', req('POST'), res as never, 1);
    expect(res._s).toBe(200);
    expect(db.setSolanaAddress).toHaveBeenCalledWith(1, '3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth');
  });
});

describe('verify flow', () => {
  it('400 when no challenge has been started', async () => {
    vi.mocked(db.getGithubChallenge).mockResolvedValue(null);
    const res = mkres();
    await handleDevsApi('/api/devs/link-github/verify', req('POST'), res as never, 1);
    expect(res._s).toBe(400);
    expect(db.markGithubVerified).not.toHaveBeenCalled();
  });

  it('does NOT verify when the code is absent from the bio', async () => {
    vi.mocked(db.getGithubChallenge).mockResolvedValue({ githubUsername: 'realuser', code: 'woc-verify-abc' });
    vi.mocked(db.githubVerifiedElsewhere).mockResolvedValue(false);
    vi.mocked(devs.fetchGithubBio).mockResolvedValue('a bio with no code');
    const res = mkres();
    await handleDevsApi('/api/devs/link-github/verify', req('POST'), res as never, 1);
    expect(res._s).toBe(400);
    expect(db.markGithubVerified).not.toHaveBeenCalled();
  });

  it('verifies when the code is present in the bio', async () => {
    vi.mocked(db.getGithubChallenge).mockResolvedValue({ githubUsername: 'realuser', code: 'woc-verify-abc' });
    vi.mocked(db.githubVerifiedElsewhere).mockResolvedValue(false);
    vi.mocked(devs.fetchGithubBio).mockResolvedValue('hello woc-verify-abc world');
    const res = mkres();
    await handleDevsApi('/api/devs/link-github/verify', req('POST'), res as never, 1);
    expect(res._s).toBe(200);
    expect(db.markGithubVerified).toHaveBeenCalledWith(1);
  });
});

describe('routing', () => {
  it('404s an unknown /api/devs path', async () => {
    const res = mkres();
    await handleDevsApi('/api/devs/nope', req('GET'), res as never, 1);
    expect(res._s).toBe(404);
  });
});
