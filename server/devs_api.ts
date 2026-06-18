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
  getClaimedBaseUnits,
  reserveClaim,
  releaseClaim,
  finalizeClaim,
} from './devs_db';
import {
  fetchContributionStats,
  scoreContributions,
  fetchWocBalance,
  fetchGithubBio,
  rewardsEnabled,
  rewardRateBaseUnits,
  computeClaimable,
  transferWoc,
  loadTreasuryKeypair,
  POINTS,
  DEVS_GITHUB_REPO,
  DEVS_WOC_MINT,
  DEVS_WOC_DECIMALS,
} from './devs';

function baseUnitsToUi(v: bigint): number {
  return Number(v) / 10 ** DEVS_WOC_DECIMALS;
}

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
    let earnedPoints = 0;
    if (links?.githubUsername && links.githubVerified) {
      try {
        const scored = scoreContributions(await fetchContributionStats(links.githubUsername));
        await upsertContributionScore(accountId, links.githubUsername, scored.points, scored.level, scored.prsMerged);
        contribution = scored;
        earnedPoints = scored.points;
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

    const claimed = links?.githubVerified ? await getClaimedBaseUnits(accountId) : BigInt(0);
    const claimable = computeClaimable(earnedPoints, claimed);
    const rewards = {
      enabled: rewardsEnabled(),
      decimals: DEVS_WOC_DECIMALS,
      rateBaseUnits: rewardRateBaseUnits().toString(),
      claimedBaseUnits: claimed.toString(),
      claimableBaseUnits: claimable.toString(),
      claimableUi: baseUnitsToUi(claimable),
      walletLinked: !!links?.solanaAddress,
    };

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
      rewards,
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

  // Claim accrued $WOC — reserve-then-pay so a retry/concurrent claim can never
  // double-pay. GATED: inert unless a treasury keypair + positive rate are set.
  if (url === '/api/devs/claim' && method === 'POST') {
    if (!rewardsEnabled()) return json(res, 503, { error: 'rewards are not enabled' });
    const links = await getDevsLinks(accountId);
    if (!links?.githubUsername || !links.githubVerified) return json(res, 400, { error: 'verify your GitHub first' });
    if (!links.solanaAddress) return json(res, 400, { error: 'link a Solana wallet first' });
    const treasury = loadTreasuryKeypair();
    if (!treasury) return json(res, 503, { error: 'rewards are not enabled' });

    // Recompute live so the claim reflects current contributions, and ensure the
    // ledger row exists before we lock it.
    const scored = scoreContributions(await fetchContributionStats(links.githubUsername));
    await upsertContributionScore(accountId, links.githubUsername, scored.points, scored.level, scored.prsMerged);
    const earned = BigInt(scored.points) * rewardRateBaseUnits();

    const { amount, priorClaimed } = await reserveClaim(accountId, earned);
    if (amount <= BigInt(0)) return json(res, 200, { ok: false, reason: 'nothing_to_claim' });

    let signature: string;
    try {
      signature = await transferWoc(treasury, links.solanaAddress, amount);
    } catch (err) {
      // The reservation committed first, so this can only have UNDER-paid —
      // release it so the player can retry.
      await releaseClaim(accountId, priorClaimed);
      console.error('[devs] $WOC transfer failed:', (err as Error).message);
      return json(res, 502, { error: 'transfer failed — try again shortly' });
    }
    await finalizeClaim(accountId, signature);
    return json(res, 200, {
      ok: true,
      signature,
      amountBaseUnits: amount.toString(),
      amountUi: baseUnitsToUi(amount),
    });
  }

  if (url === '/api/devs/leaderboard' && method === 'GET') {
    return json(res, 200, { leaderboard: await contributionLeaderboard(25) });
  }

  return json(res, 404, { error: 'not found' });
}
