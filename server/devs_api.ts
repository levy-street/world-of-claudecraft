// Devs portal REST surface — /api/devs/*. All routes are account-scoped: the
// caller is already resolved to an accountId (bearer token) by the dispatcher.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { json, readBody } from './http_util';
import {
  getDevsLinks,
  startGithubLink,
  getGithubChallenge,
  markGithubVerified,
  unlinkGithub,
  githubVerifiedElsewhere,
  setSolanaAddress,
  leadCharacter,
  upsertContributionScore,
  contributionLeaderboard,
} from './devs_db';
import {
  fetchContributionStats,
  scoreContributions,
  fetchWocBalance,
  fetchGithubBio,
  POINTS,
  DEVS_GITHUB_REPO,
  DEVS_WOC_MINT,
} from './devs';

const GITHUB_USERNAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;
// Base58, 32–44 chars — the shape of a Solana public key.
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function newVerifyCode(): string {
  return `woc-verify-${randomBytes(6).toString('hex')}`;
}
function cleanGithub(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().replace(/^@/, '') : '';
}

export async function handleDevsApi(
  url: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  const method = req.method ?? 'GET';

  if (url === '/api/devs/profile' && method === 'GET') {
    const links = await getDevsLinks(accountId);
    const character = await leadCharacter(accountId);

    // Contributions only count once GitHub ownership is proven — otherwise
    // anyone could claim a prolific contributor's handle and farm the board.
    let contribution: unknown = null;
    if (links?.githubUsername && links.githubVerified) {
      try {
        const scored = scoreContributions(await fetchContributionStats(links.githubUsername));
        await upsertContributionScore(accountId, links.githubUsername, scored.points, scored.level, scored.prsMerged);
        contribution = scored;
      } catch (err) {
        console.error('[devs] contribution fetch failed:', (err as Error).message);
        contribution = { error: 'contribution_fetch_failed' };
      }
    }

    let woc: unknown = null;
    if (links?.solanaAddress) {
      try {
        woc = await fetchWocBalance(links.solanaAddress);
      } catch (err) {
        console.error('[devs] $WOC balance failed:', (err as Error).message);
        woc = { error: 'balance_fetch_failed', address: links.solanaAddress };
      }
    }

    return json(res, 200, {
      repo: DEVS_GITHUB_REPO,
      mint: DEVS_WOC_MINT,
      points: POINTS,
      username: links?.username ?? null,
      githubUsername: links?.githubUsername ?? null,
      githubVerified: links?.githubVerified ?? false,
      solanaAddress: links?.solanaAddress ?? null,
      character,
      contribution,
      woc,
    });
  }

  // Step 1: claim a username + get the one-time code to drop in your GitHub bio.
  if (url === '/api/devs/link-github/start' && method === 'POST') {
    const body = await readBody(req);
    const raw = cleanGithub(body.githubUsername);
    if (!raw || !GITHUB_USERNAME_RE.test(raw)) return json(res, 400, { error: 'invalid GitHub username' });
    if (await githubVerifiedElsewhere(accountId, raw)) {
      return json(res, 409, { error: 'that GitHub account is already linked to another player' });
    }
    const code = newVerifyCode();
    await startGithubLink(accountId, raw, code);
    return json(res, 200, { githubUsername: raw, verified: false, code });
  }

  // Step 2: prove ownership — we read your public bio and look for the code.
  if (url === '/api/devs/link-github/verify' && method === 'POST') {
    const challenge = await getGithubChallenge(accountId);
    if (!challenge) return json(res, 400, { error: 'start the GitHub link first' });
    if (await githubVerifiedElsewhere(accountId, challenge.githubUsername)) {
      return json(res, 409, { error: 'that GitHub account is already linked to another player' });
    }
    const bio = await fetchGithubBio(challenge.githubUsername);
    if (bio === null) return json(res, 502, { error: 'could not read your GitHub profile — try again shortly' });
    if (!bio.includes(challenge.code)) {
      return json(res, 400, { error: 'verification code not found in your GitHub bio yet', verified: false });
    }
    await markGithubVerified(accountId);
    return json(res, 200, { githubUsername: challenge.githubUsername, verified: true });
  }

  if (url === '/api/devs/link-github/unlink' && method === 'POST') {
    await unlinkGithub(accountId);
    return json(res, 200, { githubUsername: null, verified: false });
  }

  if (url === '/api/devs/link-wallet' && method === 'POST') {
    const body = await readBody(req);
    const raw = typeof body.solanaAddress === 'string' ? body.solanaAddress.trim() : '';
    if (raw && !SOLANA_ADDRESS_RE.test(raw)) return json(res, 400, { error: 'invalid Solana address' });
    await setSolanaAddress(accountId, raw || null);
    return json(res, 200, { solanaAddress: raw || null });
  }

  if (url === '/api/devs/leaderboard' && method === 'GET') {
    return json(res, 200, { leaderboard: await contributionLeaderboard(25) });
  }

  return json(res, 404, { error: 'not found' });
}
