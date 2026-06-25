// Realm bond (#475): the ongoing "skin in the game" on the BUY path. A staker
// locks 1/5/10% of supply and stays a $WOC whale for the realm's life; a buyer
// pays cash once and would otherwise have NO ongoing exposure. The bond closes
// that gap: a bought realm's owner must keep holding a (smaller) $WOC amount in
// their linked wallet. If their wallet falls below the bond they get a grace
// window to top back up; if they do not, the realm lapses (closes, freeing the
// name + cap slot). This gives the buyer real $WOC price exposure, scaled to the
// tier, without forcing them to lock a whale stake.
//
// The bond is a HOLD requirement, not a lock: nothing is escrowed, the $WOC stays
// liquid in the owner's wallet, verified periodically against the same cached
// balance reader the holder-tier badge uses. Bonds across an owner's realms are
// CUMULATIVE (one wallet cannot back three realms with one realm's worth of $WOC):
// the enforcer covers the oldest realms first, so the newest realm a wallet can no
// longer cover is the one that falls short.

import type { Pool } from 'pg';
import { cachedWocBalance } from './woc_balance';
import { walletForAccount } from './db';
import { WOC_DECIMALS } from './woc_config';
import { setRealmStatus } from './realm_db';
import {
  accountsWithActiveBonds,
  listActiveBondsForAccount,
  setRealmBondGrace,
} from './realm_buy_db';

function intEnv(key: string, def: number, min: number, max: number): number {
  const v = Number.parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(v) && v >= min && v <= max ? v : def;
}

// The bond as a fraction of the tier's $WOC threshold (the amount a staker would
// lock). Default 1000 bps = 10%: a buyer holds a tenth of the staker's commitment,
// scaled to the tier. 0 disables bonds entirely (buying carries no ongoing hold).
export const BOND_BPS = intEnv('REALM_BOND_BPS', 1000, 0, 10_000);
// How long an under-bonded wallet has to top back up before the realm lapses.
const GRACE_MS = intEnv('REALM_BOND_GRACE_DAYS', 7, 0, 365) * 24 * 60 * 60 * 1000;

export function bondEnabled(): boolean {
  return BOND_BPS > 0;
}

// The bond a tier requires, in $WOC base units, given the tier's threshold amount.
export function bondBaseForTier(tierWocBase: bigint): bigint {
  return (tierWocBase * BigInt(BOND_BPS)) / 10_000n;
}

const HUMAN_DIVISOR = Number(10n ** BigInt(WOC_DECIMALS));
function toHuman(base: bigint): number {
  return Number(base) / HUMAN_DIVISOR;
}

// The grace state machine, pure + unit-tested. A wallet at/above its bond clears any
// grace ('cure') or is fine ('ok'); a wallet below the bond starts the grace window
// ('enter_grace'), waits it out ('wait'), or lapses once it expires ('lapse').
export type BondAction = 'ok' | 'enter_grace' | 'cure' | 'lapse' | 'wait';

export function bondAction(args: { belowBond: boolean; graceUntil: number | null; now: number }): BondAction {
  if (!args.belowBond) return args.graceUntil != null ? 'cure' : 'ok';
  if (args.graceUntil == null) return 'enter_grace';
  return args.now >= args.graceUntil ? 'lapse' : 'wait';
}

// Periodic bond enforcement (run from reconcileRealmLifecycle: boot + daily). For
// each account that owns active bonded realms, read its linked wallet's $WOC once
// and walk its realms oldest-first against the cumulative bond. A transient RPC
// failure is skipped (state untouched), so a flaky read never lapses a realm; an
// unlinked wallet counts as fully short (you must keep a wallet holding the bond).
export async function reconcileBonds(pool: Pool): Promise<{ entered: number; cured: number; lapsed: number }> {
  if (!bondEnabled()) return { entered: 0, cured: 0, lapsed: 0 };
  let entered = 0;
  let cured = 0;
  let lapsed = 0;
  const now = Date.now();

  for (const accountId of await accountsWithActiveBonds(pool)) {
    const bonds = await listActiveBondsForAccount(pool, accountId);
    if (bonds.length === 0) continue;

    const wallet = await walletForAccount(accountId);
    let balanceHuman: number | null = null;
    if (wallet) {
      balanceHuman = await cachedWocBalance(wallet.pubkey);
      if (balanceHuman === null) continue; // transient RPC failure: leave bonds as-is
    }

    let cumulativeBase = 0n;
    for (const bond of bonds) {
      cumulativeBase += bond.bondBase;
      const belowBond = wallet === null ? true : (balanceHuman as number) < toHuman(cumulativeBase);
      const action = bondAction({ belowBond, graceUntil: bond.graceUntil?.getTime() ?? null, now });
      if (action === 'enter_grace') {
        await setRealmBondGrace(pool, bond.realmId, new Date(now + GRACE_MS));
        entered += 1;
      } else if (action === 'cure') {
        await setRealmBondGrace(pool, bond.realmId, null);
        cured += 1;
      } else if (action === 'lapse') {
        // Terminal: the bond went unmet through the whole grace window. Close the
        // realm (frees the name + the per-account cap slot, like a decommission).
        await setRealmStatus(pool, bond.realmId, 'closed');
        lapsed += 1;
        console.log(`realm bond: realm ${bond.realmId} (account ${accountId}) lapsed, bond unmet past grace`);
      }
    }
  }
  return { entered, cured, lapsed };
}

// The initial grace state for a freshly bought realm: if the buyer's wallet already
// covers the bond at confirm time, null (no grace); otherwise start the grace clock
// so they have the window to top up. A null/failed balance read is treated as
// covered (lenient) since the periodic enforcer will catch a real shortfall.
export function initialGraceUntil(balanceHuman: number | null, bondBase: bigint, now: number): Date | null {
  if (balanceHuman === null) return null;
  return balanceHuman < toHuman(bondBase) ? new Date(now + GRACE_MS) : null;
}

// Whether a wallet balance (human $WOC) currently covers a bond. For the quote-time
// gate + dashboard. A null balance is treated as covered (do not block on RPC).
export function walletCoversBond(balanceHuman: number | null, bondBase: bigint): boolean {
  if (balanceHuman === null) return true;
  return balanceHuman >= toHuman(bondBase);
}
