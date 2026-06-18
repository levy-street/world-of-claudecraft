// Devs portal REST surface — /api/devs/*. All routes are account-scoped: the
// caller is already resolved to an accountId (bearer token) by the dispatcher.
import http from 'node:http';
import { json, readBody } from './http_util';
import {
  getDevsLinks,
  setGithubUsername,
  setSolanaAddress,
  leadCharacter,
  upsertContributionScore,
  contributionLeaderboard,
} from './devs_db';
import {
  fetchContributionStats,
  scoreContributions,
  fetchWocBalance,
  POINTS,
  DEVS_GITHUB_REPO,
  DEVS_WOC_MINT,
} from './devs';

const GITHUB_USERNAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;
// Base58, 32–44 chars — the shape of a Solana public key.
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

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

    let contribution: unknown = null;
    if (links?.githubUsername) {
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
      solanaAddress: links?.solanaAddress ?? null,
      character,
      contribution,
      woc,
    });
  }

  if (url === '/api/devs/link-github' && method === 'POST') {
    const body = await readBody(req);
    const raw = typeof body.githubUsername === 'string' ? body.githubUsername.trim().replace(/^@/, '') : '';
    if (raw && !GITHUB_USERNAME_RE.test(raw)) return json(res, 400, { error: 'invalid GitHub username' });
    await setGithubUsername(accountId, raw || null);
    return json(res, 200, { githubUsername: raw || null });
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
