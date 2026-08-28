// The Solana Seeker promotional mount (issue #3628): the one link between the
// Seeker Genesis Token claim ledger (server/seeker_entitlement_db.ts, written
// only by the native-attested, RPC-verified claim route) and mount ownership
// in the sim, which is the reins ITEM in bags or bank (src/sim/mounts.ts
// mountOwned).
//
// Why an item grant and not an account unlock: every mount gate in the sim
// (summon, mid-ride revalidation, channel completion, the Reliquary shelf)
// derives ownership from the reins, and summoning needs a BAGGED reins
// besides. The reins are soulbound, noDiscard, noVendorSell and noMarketList,
// so the only places one can ever be are this character's bags or bank, which
// is exactly what mountOwned reads. That makes the grant idempotent with no
// ledger and no account flag: one reins per character, one claim per account
// (the ledger's UNIQUE (account_id)), one claim per token (its PRIMARY KEY).
//
// Two call sites, both best-effort, neither the source of truth:
// - fresh join (server/game.ts join, beside the PBE kit top-up): covers
//   existing claimants, every new character, and a web or desktop login on
//   the same account. The claim fact rides the join meta from ws_auth's
//   fresh-join arm, as one EXISTS folded into the bank-bonus facts query, so
//   it costs no extra round trip.
// - claim success (server/seeker_entitlement.ts, injected through
//   configureSeekerEntitlementRuntime): the native player who just
//   auto-claimed is already in the world, so the reins land in their live
//   session instead of waiting for a relog.
import { mountOwned } from '../src/sim/mounts';
import type { Sim } from '../src/sim/sim';

export const SEEKER_MOUNT_KEY = 'seeker_board';
export const SEEKER_REINS_ITEM_ID = 'reins_seeker_board';

/** Hand the character the Seeker board reins unless it already owns them.
 *  Ownership is bags OR bank: a banked reins still counts, and re-granting
 *  one every login would be the leak this guard exists to close. NOT a
 *  movement grant: the first grant is the real obtain, so the loot toast, the
 *  deed discovery and the Reliquary first-find stamp land like any other first
 *  acquisition. Returns whether a reins was granted. */
export function grantSeekerBoardIfMissing(sim: Sim, pid: number): boolean {
  const meta = sim.meta(pid);
  if (!meta || mountOwned(meta, SEEKER_MOUNT_KEY)) return false;
  sim.addItem(SEEKER_REINS_ITEM_ID, 1, pid);
  return true;
}

/** Join-time arm. `entitled` is the server-recomputed account fact stamped by
 *  the fresh-join handshake; it is absent on a resume and for meta-less
 *  callers, both of which grant nothing. Never allowed to fail the join. */
export function applySeekerMountAtJoin(
  sim: Sim,
  pid: number,
  entitled: boolean | undefined,
  name: string,
  characterId: number,
): void {
  if (entitled !== true) return;
  try {
    if (grantSeekerBoardIfMissing(sim, pid)) {
      console.log(`seeker mount granted at join: ${name} (character ${characterId})`);
    }
  } catch (err) {
    console.error('seeker mount grant at join failed:', err);
  }
}

/** The slice of a live session the claim-success arm reads. */
export interface SeekerGrantSession {
  accountId: number;
  pid: number;
  name: string;
}

/** Claim-success arm: grant into every live session on the account and force
 *  a save, so the reins do not sit un-persisted for an autosave window after
 *  the claim row is already durable. Offline accounts are a no-op; the join
 *  arm is the backstop, and it is also the recovery if a save is fenced by a
 *  same-account takeover (the character reloads without the reins and is
 *  re-granted at its next fresh join). Returns how many sessions were granted. */
export function grantSeekerMountToLiveSessions<S extends SeekerGrantSession>(
  sessions: Iterable<S>,
  accountId: number,
  sim: Sim,
  save: (session: S) => Promise<boolean>,
): number {
  let granted = 0;
  for (const session of sessions) {
    if (session.accountId !== accountId) continue;
    try {
      if (!grantSeekerBoardIfMissing(sim, session.pid)) continue;
    } catch (err) {
      console.error('seeker mount live grant failed:', err);
      continue;
    }
    granted += 1;
    void save(session)
      .then((landed) => {
        if (!landed) {
          console.error(
            `seeker mount grant for ${session.name} did not persist (save fenced); it re-grants at the next login`,
          );
        }
      })
      .catch((err) => console.error('seeker mount grant save failed:', err));
  }
  return granted;
}
