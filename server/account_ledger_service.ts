// The live-session side of the account ledger (src/sim/account_ledger.ts):
// when one character on an account earns a deed or finds a relic, every OTHER
// live session on the same account learns of it in the same tick, so an alt's
// open Book or Reliquary fills without a relog. The acting session's own
// ledger was already appended by the sim (grantDeed / recordRelic); this
// service copies that exact earner entry sideways and marks each sibling
// heavy-dirty so its next snapshot re-ships the `acct` key. Extracted from
// GameServer behind a narrow host seam (the AccountCosmeticsService shape) so
// the coordinator stays a thin consumer and a Vitest drives it with fakes.
// Persistence is NOT here: the durable rows land through the deeds and relic
// record observers after the acting character's save.
//
// The fan-out also re-runs the sibling's account-derived Reliquary grant
// syncs, but only when the growth can move a rank or completion read: a relic
// always, a deed only when it is a Horizons title (the same isHorizonsTitleDeed
// gate grantDeed's own hook uses). A kill, quest, craft, or level deed is
// display-only for the sibling, and the sync it would trigger costs an
// inventory + bank scan plus a catalog walk per online sibling per deed.

import {
  type AccountEarner,
  type AccountLedger,
  recordAccountDeed,
  recordAccountRelic,
} from '../src/sim/account_ledger';
import { isHorizonsTitleDeed } from '../src/sim/reliquary';

/** The slice of a live session this service reads and writes. */
export interface LedgerSession {
  accountId: number;
  characterId: number;
  pid: number;
  /** Set true to force the session's next snapshot to re-ship heavy self. */
  selfHeavyDirty: boolean;
}

/** The slice of the Sim the service reads. */
export interface LedgerSim {
  meta(pid: number): { accountLedger: AccountLedger } | null | undefined;
}

export interface AccountLedgerHost {
  sim(): LedgerSim;
  /** Every live session, any account (the service filters by accountId). */
  sessions(): Iterable<LedgerSession>;
  /** Re-run the account-derived Reliquary grant syncs for a live character
   *  whose ledger just grew with something the reads score (a relic, or a
   *  Horizons title deed; syncAccountRelicGrants over the union), so the
   *  deeds the account now qualifies for land on it in the same tick. `opts`
   *  is always SIBLING_GRANT_OPTS; the host threads it through unchanged. */
  syncGrants(pid: number, opts: Readonly<{ retro?: boolean }>): void;
}

/** The sibling's grants are retro-flagged, exactly like the join path's: the
 *  finder's own fill chain is the one celebration (its banner, its guild
 *  marquee, the feed card), so a find another character made never marquees
 *  under this character's name (the `ev.retro` gate on deedUnlocked in
 *  GameServer.routeEvents). The deed still lands, is still recorded under
 *  this character, and still persists: retro is only the celebration gate. */
export const SIBLING_GRANT_OPTS: Readonly<{ retro: true }> = { retro: true };

function earnerFor(
  list: readonly AccountEarner[] | undefined,
  characterId: number,
): AccountEarner | undefined {
  return list?.find((e) => e.characterId === characterId);
}

export class AccountLedgerService {
  constructor(private readonly host: AccountLedgerHost) {}

  /** Fan the acting character's fresh deed earn out to its account siblings.
   *  Reads the earner entry the sim already wrote on the actor's ledger (exact
   *  day stamp, no second derivation); a missing entry means nothing to copy.
   *  Returns how many sibling ledgers changed. */
  noteDeedEarned(actor: LedgerSession, deedId: string): number {
    const sim = this.host.sim();
    const own = sim.meta(actor.pid)?.accountLedger;
    const earner = earnerFor(own?.deeds.get(deedId), actor.characterId);
    if (!earner) return 0;
    return this.fanOut(
      actor,
      (ledger) => recordAccountDeed(ledger, deedId, earner),
      isHorizonsTitleDeed(deedId),
    );
  }

  /** The relic twin of noteDeedEarned, keyed by accountRelicKey. */
  noteRelicFound(actor: LedgerSession, relicKey: string): number {
    const sim = this.host.sim();
    const own = sim.meta(actor.pid)?.accountLedger;
    const earner = earnerFor(own?.relics.get(relicKey), actor.characterId);
    if (!earner) return 0;
    return this.fanOut(actor, (ledger) => recordAccountRelic(ledger, relicKey, earner), true);
  }

  private fanOut(
    actor: LedgerSession,
    apply: (ledger: AccountLedger) => boolean,
    /** Whether this growth can move a sibling's rank or completion read. */
    syncGrants: boolean,
  ): number {
    const sim = this.host.sim();
    let changed = 0;
    for (const live of this.host.sessions()) {
      if (live.accountId !== actor.accountId || live.pid === actor.pid) continue;
      const ledger = sim.meta(live.pid)?.accountLedger;
      if (!ledger) continue;
      if (apply(ledger)) {
        live.selfHeavyDirty = true;
        if (syncGrants) this.host.syncGrants(live.pid, SIBLING_GRANT_OPTS);
        changed++;
      }
    }
    return changed;
  }
}
