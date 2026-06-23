// Stake-to-provision orchestration (#475): the server side of founding a realm.
// Issues a provision quote (name + cap + supply/tier validation), verifies the
// finalized on-chain stake lock, records it (ledger-quarantined) and brings the
// realm online, and runs the decommission + release-finalize lifecycle. Reuses
// the proven finalized-tx verify core (solana_tx), the escrow PDA derivation
// (realm_escrow), and the registry/stake/quote persistence. No SQL here; this is
// the logic module main.ts calls.

import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { PublicKey } from '@solana/web3.js';
import { getFinalizedTx, ownerCreditedBase, ownerSpentBase, txSucceeded, usesToken2022 } from './solana_tx';
import { solanaRpc } from './solana_rpc';
import { WOC_MINT, WOC_DECIMALS } from './woc_config';
import { offensiveName } from './auth';
import { isUniqueViolation } from './http_util';
import { resolveRealm, type RealmType } from './realm';
import { REALM_ESCROW_PROGRAM_ID, realmStakePda, realmVaultAddress } from './realm_escrow';
import {
  activateRealm,
  addRealmRole,
  countOwnedRealms,
  createProvisioningRealm,
  getLiveRealmByName,
  getRealmById,
  listRealmIdsByStatus,
  requestDecommission,
  setRealmStatus,
} from './realm_db';
import { getActiveStakeByRealm, insertStake, setStakeReleased, setStakeReleasing, type RealmStakeRow } from './realm_stake_db';
import {
  countOpenQuotesForAccount,
  createRealmQuote,
  deleteRealmQuote,
  getRealmQuote,
  reclaimExpiredProvisioning,
} from './realm_quote_db';
import { minStakeBase, tierForStake, TIER_BPS, tierThreshold } from './realm_tiers';
import { invalidateWalletHoldings } from './realm_stake_holdings';

function intEnv(key: string, def: number, min: number, max: number): number {
  const v = Number.parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(v) && v >= min && v <= max ? v : def;
}

// Max live realms (plus open quotes) per account: anti name-squatting. With a
// whale-tier stake this is also naturally throttled by capital.
const MAX_REALMS_PER_ACCOUNT = intEnv('REALM_MAX_PER_ACCOUNT', 3, 1, 1000);
// How long a provision quote stays valid for the client to lock + confirm.
// Generous headroom over the on-chain lock + finalization + the verify RPC so a
// timely confirm never races quote expiry.
const QUOTE_TTL_MS = intEnv('REALM_QUOTE_TTL_MINUTES', 30, 1, 1440) * 60_000;
// The off-chain decommission timelock the UI shows. The on-chain RealmStake
// unlock_eligible_slot set by the program is authoritative for the release.
const UNSTAKE_TIMELOCK_MS = intEnv('REALM_UNSTAKE_TIMELOCK_SECONDS', 259_200, 0, 31_536_000) * 1000;

export type Result<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };
function fail(status: number, error: string): { ok: false; status: number; error: string } {
  return { ok: false, status, error };
}

export type StakeVerdict = { ok: true; amountBase: bigint } | { ok: false; reason: string };

// Verify that `lockSig` is a finalized lock of exactly `expectedAmount` $WOC by
// `stakerWallet` into the escrow vault for `realmId`. Pure verification against
// the chain (no DB writes): mirrors the marketplace verifier (finalized, not
// Token-2022, exact on-chain deltas, payer-bound).
export async function verifyStakeLock(args: {
  lockSig: string;
  realmId: number;
  stakerWallet: string;
  mint: string;
  expectedAmount: bigint;
}): Promise<StakeVerdict> {
  const tx = await getFinalizedTx(args.lockSig);
  if (!tx) return { ok: false, reason: 'tx_not_finalized' };
  if (!txSucceeded(tx)) return { ok: false, reason: 'tx_failed' };
  if (usesToken2022(tx, args.mint)) return { ok: false, reason: 'token_2022' };

  // The vault is owned by the stake PDA, so a credit to the PDA owner is the
  // staked principal landing in the program-owned vault.
  const credited = ownerCreditedBase(tx, realmStakePda(args.realmId).toBase58(), args.mint);
  if (credited !== args.expectedAmount) return { ok: false, reason: 'wrong_vault_amount' };

  // The linked staker wallet must be the one that funded it (payer-bound).
  if (ownerSpentBase(tx, args.stakerWallet, args.mint) < args.expectedAmount) {
    return { ok: false, reason: 'wrong_payer' };
  }

  return { ok: true, amountBase: credited };
}

// Record a verified stake and bring its realm online, atomically: flip the realm
// active, insert the (ledger-quarantined) stake row, and grant the owner role.
// The realm_stakes UNIQUE(lock_tx_sig) is the replay guard, so a re-confirmed
// lock rolls back the whole transaction.
export async function recordProvisionedStake(
  pool: Pool,
  s: {
    realmId: number;
    accountId: number;
    stakerWallet: string;
    mint: string;
    amountBase: bigint;
    tier: number;
    lockTxSig: string;
  },
): Promise<RealmStakeRow> {
  const stakePda = realmStakePda(s.realmId);
  const vault = realmVaultAddress(stakePda, new PublicKey(s.mint)).toBase58();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const stake = await insertStake(client, {
      realmId: s.realmId,
      accountId: s.accountId,
      ownerWallet: s.stakerWallet,
      pda: stakePda.toBase58(),
      vault,
      mint: s.mint,
      amountBase: s.amountBase,
      tier: s.tier,
      lockTxSig: s.lockTxSig,
    });
    await activateRealm(client, s.realmId);
    await addRealmRole(client, s.realmId, s.accountId, 'owner', s.accountId);
    await client.query('COMMIT');
    return stake;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Total $WOC supply in base units, read on chain. Drives the percent-of-supply
// tier thresholds. null on a read failure (the quote route returns 503).
const SUPPLY_CACHE_MS = intEnv('REALM_SUPPLY_CACHE_SECONDS', 15, 0, 3600) * 1000;
const supplyCache = new Map<string, { at: number; value: bigint }>();

export async function getMintSupplyBase(mint: string): Promise<bigint | null> {
  const hit = supplyCache.get(mint);
  if (hit && Date.now() - hit.at < SUPPLY_CACHE_MS) return hit.value;
  const res = await solanaRpc<{ value: { amount: string } }>('getTokenSupply', [mint, { commitment: 'confirmed' }]);
  const amount = res?.value?.amount;
  if (typeof amount !== 'string' || !/^[0-9]+$/.test(amount)) {
    console.error(`realm: $WOC supply read failed for mint ${mint} (rpc returned ${res === null ? 'null' : 'unexpected shape'})`);
    return null;
  }
  const value = BigInt(amount);
  supplyCache.set(mint, { at: Date.now(), value });
  return value;
}

export interface RealmTierOption {
  tier: number; // 1 bronze, 2 silver, 3 gold
  name: 'bronze' | 'silver' | 'gold';
  bps: number; // basis points of supply this tier locks
  amountBase: string; // base-unit stake required at the current supply
}

export interface RealmTiersInfo {
  mint: string;
  decimals: number;
  supplyBase: string;
  timelockSeconds: number; // stake-release timelock the founding UI quotes to the player
  maxPerAccount: number; // realm cap per account, so the UI can explain the limit
  tiers: RealmTierOption[];
}

// Display data for the founding UI: the live $WOC supply and the base-unit stake
// each tier costs against it, so the client renders the price of a realm without
// re-deriving the threshold math. Reuses the cached supply read; returns null
// when the supply RPC is unavailable (the route then 503s, like a quote does).
export async function realmTiersInfo(): Promise<RealmTiersInfo | null> {
  const supply = await getMintSupplyBase(WOC_MINT);
  if (supply === null) return null;
  const order: RealmTierOption['name'][] = ['bronze', 'silver', 'gold'];
  const tiers = order.map((name, i) => ({
    tier: i + 1,
    name,
    bps: TIER_BPS[name],
    amountBase: tierThreshold(TIER_BPS[name], supply).toString(),
  }));
  return {
    mint: WOC_MINT,
    decimals: WOC_DECIMALS,
    supplyBase: supply.toString(),
    timelockSeconds: Math.floor(UNSTAKE_TIMELOCK_MS / 1000),
    maxPerAccount: MAX_REALMS_PER_ACCOUNT,
    tiers,
  };
}

export interface ProvisionQuote {
  quoteId: string;
  realmId: number;
  name: string;
  type: RealmType;
  tier: number;
  amountBase: string;
  mint: string;
  programId: string;
  stakePda: string;
  vault: string;
  expiresAt: string;
}

// Issue a provision quote: validate the name (charset, profanity, uniqueness)
// and the per-account cap, read supply, require at least the bronze (1%) stake,
// derive the tier, create the realm in 'provisioning', and pin the quote. The
// client locks exactly amountBase into the returned vault, then calls confirm.
export async function prepareProvisionQuote(
  pool: Pool,
  args: { accountId: number; ownerWallet: string; name: string; type: RealmType; amountBase: bigint },
): Promise<Result<ProvisionQuote>> {
  // Cheap, no-DB name checks first so a bad name short-circuits before any query.
  const name = args.name.trim();
  if (!name || resolveRealm(name) !== name) return fail(400, 'invalid_realm_name');
  if (offensiveName(name)) return fail(400, 'realm_name_not_allowed');

  await reclaimExpiredProvisioning(pool); // free expired names before uniqueness + cap
  if (await getLiveRealmByName(pool, name)) return fail(409, 'realm_name_taken');

  const owned = await countOwnedRealms(pool, args.accountId);
  const open = await countOpenQuotesForAccount(pool, args.accountId);
  if (owned + open >= MAX_REALMS_PER_ACCOUNT) return fail(409, 'realm_cap_reached');

  const supply = await getMintSupplyBase(WOC_MINT);
  if (supply === null) return fail(503, 'supply_unavailable');
  if (args.amountBase < minStakeBase(supply)) return fail(400, 'stake_below_minimum');
  const tier = tierForStake(args.amountBase, supply);

  let realmId: number;
  try {
    const realm = await createProvisioningRealm(pool, {
      name,
      type: args.type,
      ownerAccountId: args.accountId,
      tier,
    });
    realmId = realm.realmId;
  } catch (err) {
    if (isUniqueViolation(err)) return fail(409, 'realm_name_taken'); // lost a name race
    throw err;
  }

  const quoteId = randomUUID();
  const expiresAt = new Date(Date.now() + QUOTE_TTL_MS);
  await createRealmQuote(pool, {
    quoteId,
    accountId: args.accountId,
    realmId,
    ownerWallet: args.ownerWallet,
    amountBase: args.amountBase,
    tier,
    mint: WOC_MINT,
    expiresAt,
  });

  const stakePda = realmStakePda(realmId);
  const vault = realmVaultAddress(stakePda, new PublicKey(WOC_MINT));
  return {
    ok: true,
    quoteId,
    realmId,
    name,
    type: args.type,
    tier,
    amountBase: args.amountBase.toString(),
    mint: WOC_MINT,
    programId: REALM_ESCROW_PROGRAM_ID.toBase58(),
    stakePda: stakePda.toBase58(),
    vault: vault.toBase58(),
    expiresAt: expiresAt.toISOString(),
  };
}

// Redeem a quote with the finalized lock signature: verify the lock matches the
// quote, then record the stake + activate the realm + grant the owner role.
export async function confirmProvisionQuote(
  pool: Pool,
  args: { accountId: number; quoteId: string; lockSig: string },
): Promise<Result<{ realmId: number; tier: number }>> {
  const quote = await getRealmQuote(pool, args.quoteId);
  if (!quote) return fail(404, 'quote_not_found');
  if (quote.accountId !== args.accountId) return fail(403, 'not_your_quote');
  if (quote.expiresAt.getTime() <= Date.now()) return fail(410, 'quote_expired');

  const verdict = await verifyStakeLock({
    lockSig: args.lockSig,
    realmId: quote.realmId,
    stakerWallet: quote.ownerWallet,
    mint: quote.mint,
    expectedAmount: quote.amountBase,
  });
  if (!verdict.ok) return fail(400, verdict.reason);

  try {
    await recordProvisionedStake(pool, {
      realmId: quote.realmId,
      accountId: quote.accountId,
      stakerWallet: quote.ownerWallet,
      mint: quote.mint,
      amountBase: quote.amountBase,
      tier: quote.tier,
      lockTxSig: args.lockSig,
    });
  } catch (err) {
    // The lock signature was already recorded (replay guard). Consume the quote
    // so it cannot be re-confirmed with another lock against this realm.
    if (isUniqueViolation(err)) {
      await deleteRealmQuote(pool, args.quoteId);
      return fail(409, 'stake_already_recorded');
    }
    throw err;
  }
  await deleteRealmQuote(pool, args.quoteId);
  // The wallet just moved its stake into the escrow vault; refresh its holdings
  // caches so the holder-tier badge counts the escrowed $WOC right away (#475).
  invalidateWalletHoldings(quote.ownerWallet);
  return { ok: true, realmId: quote.realmId, tier: quote.tier };
}

// Owner begins decommissioning: mark the realm decommissioning + the stake
// releasing, and return the (UI) release-eligible time. The owner separately
// signs the on-chain request_decommission + release.
export async function requestRealmDecommission(
  pool: Pool,
  args: { accountId: number; realmId: number },
): Promise<Result<{ realmId: number; releaseEligibleAt: string }>> {
  const realm = await getRealmById(pool, args.realmId);
  if (!realm || realm.status === 'closed') return fail(404, 'realm_not_found');
  if (realm.ownerAccountId !== args.accountId) {
    console.warn(`realm: account ${args.accountId} tried to decommission realm ${args.realmId} it does not own`);
    return fail(403, 'not_realm_owner');
  }
  if (realm.status !== 'active') return fail(409, 'realm_not_active');

  const eligibleAt = new Date(Date.now() + UNSTAKE_TIMELOCK_MS);
  const updated = await requestDecommission(pool, args.realmId, eligibleAt);
  if (!updated) return fail(409, 'realm_not_active');
  const stake = await getActiveStakeByRealm(pool, args.realmId);
  if (stake) await setStakeReleasing(pool, stake.stakeId);
  return { ok: true, realmId: args.realmId, releaseEligibleAt: eligibleAt.toISOString() };
}

// True if the on-chain RealmStake PDA no longer exists (the program closes it in
// release). A read failure returns false (do not assume released).
async function isStakeAccountClosed(realmId: number): Promise<boolean> {
  const pda = realmStakePda(realmId).toBase58();
  const res = await solanaRpc<{ value: unknown | null }>('getAccountInfo', [
    pda,
    { encoding: 'base64', commitment: 'finalized' },
  ]);
  if (res === null) {
    // Transient RPC failure: do not assume released (the caller returns a
    // retryable 409), but log it so it is not indistinguishable from a real
    // not-yet-released state.
    console.error(`realm: PDA-closed read failed for realm ${realmId} (rpc null); treating as not released`);
    return false;
  }
  return res.value === null;
}

// Reconcile the DB after the owner's on-chain release closed the escrow PDA:
// mark the stake released and close the realm (frees the name). Confirms the PDA
// is actually gone on chain before doing so.
export async function finalizeRealmRelease(
  pool: Pool,
  args: { accountId: number; realmId: number },
): Promise<Result<{ realmId: number }>> {
  const realm = await getRealmById(pool, args.realmId);
  if (!realm || realm.status === 'closed') return fail(404, 'realm_not_found');
  if (realm.ownerAccountId !== args.accountId) return fail(403, 'not_realm_owner');
  if (realm.status !== 'decommissioning') return fail(409, 'realm_not_decommissioning');

  // Enforce the server-advertised migration window before closing the realm.
  // The on-chain program enforces its own release timelock independently; this
  // makes the DB-side window real too, and the two cannot silently diverge.
  if (!realm.releaseEligibleAt || realm.releaseEligibleAt.getTime() > Date.now()) {
    return fail(409, 'timelock_not_elapsed');
  }

  if (!(await isStakeAccountClosed(args.realmId))) return fail(409, 'stake_not_released_onchain');

  const stake = await getActiveStakeByRealm(pool, args.realmId);
  if (stake) await setStakeReleased(pool, stake.stakeId, `pda-closed:${realmStakePda(args.realmId).toBase58()}`);
  await setRealmStatus(pool, args.realmId, 'closed');
  // The stake left escrow and returned to the wallet; refresh its holdings caches
  // so the badge re-reads (the released stake no longer counts as escrow, and the
  // returned $WOC is now visible to the balance RPC, so the tier is unchanged).
  if (stake) invalidateWalletHoldings(stake.ownerWallet);
  return { ok: true, realmId: args.realmId };
}

// Periodic lifecycle reconciliation (boot + daily, see server/main.ts). Runs
// independently of any user request so abandoned realms never deadlock the
// per-account cap: (1) close provisioning realms whose quote expired without a
// confirmed lock, freeing the name + slot; (2) finalize decommissioning realms
// whose owner already released on chain (the escrow PDA is closed) but never
// called /release, so they do not stay stuck counting against the cap. Returns
// counts for logging. Never force-closes a realm whose stake is still on chain.
export async function reconcileRealmLifecycle(pool: Pool): Promise<{ reclaimed: number; finalized: number }> {
  const reclaimed = await reclaimExpiredProvisioning(pool);
  let finalized = 0;
  for (const realmId of await listRealmIdsByStatus(pool, 'decommissioning')) {
    const realm = await getRealmById(pool, realmId);
    if (!realm || realm.status !== 'decommissioning') continue;
    if (realm.releaseEligibleAt && realm.releaseEligibleAt.getTime() > Date.now()) continue;
    if (!(await isStakeAccountClosed(realmId))) continue; // stake still escrowed; leave it
    const stake = await getActiveStakeByRealm(pool, realmId);
    if (stake) await setStakeReleased(pool, stake.stakeId, `pda-closed:${realmStakePda(realmId).toBase58()}`);
    await setRealmStatus(pool, realmId, 'closed');
    finalized += 1;
  }
  return { reclaimed, finalized };
}
