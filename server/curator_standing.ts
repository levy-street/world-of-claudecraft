// One player's Curator standing (rank + the completion pair) for the inspect
// card's Reliquary line and the rank-5 sigil, moved whole out of GameServer
// (the monolith ratchet). Cosmetic identity only: the sim never reads these
// back, and no client command can set them, so the numbers are
// server-computed or they do not exist.
//
// Pure CPU off the LIVE sim meta (one catalog walk, no DB row, no RPC), so it
// is synchronous and needs no "did the player leave mid-fetch" guard.
//
// What inspect and /c/ share: ONE formula (catalogCharacterCompletion) over
// EQUIVALENT ownership surfaces. Since the account ledger the surfaces are
// ACCOUNT-wide (accountReliquaryOwnership): the inspect card's standing is
// the same union the Reliquary window shows its owner. That is NOT a promise
// inspect and /c/ agree at every instant: this reads LIVE meta, the public
// sheet reads the PERSISTED per-character blob, so /c/ lags live meta until
// the next save and reads the character's own fills only.
//
// Unranked reads as ABSENT, not zero: an owned count of 0 clears all three
// fields so a fresh character's identity record carries no standing at all.
import {
  accountReliquaryOwnership,
  catalogCharacterCompletion,
  curatorRankFromOwned,
} from '../src/sim/reliquary';
import type { PlayerMeta } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

export function stampCuratorStanding(e: Entity, meta: PlayerMeta): void {
  // Cleared BEFORE the walk so a throw inside the resolution fails to ABSENT,
  // not to a stale stamp riding the wire (both call sites catch). Assigning
  // unconditionally is free: wireCacheFor diffs the identity JSON, so an
  // unchanged stamp re-broadcasts nothing and a changed one re-broadcasts
  // itself, exactly like the flair refreshers beside it.
  e.curatorRank = undefined;
  e.relicsOwned = undefined;
  e.relicsTotal = undefined;
  const { owned, total } = catalogCharacterCompletion(accountReliquaryOwnership(meta));
  const rank = curatorRankFromOwned(owned);
  // Gated on the RANK, not the raw count, so all three move as one by
  // construction: a raised rank-1 threshold could otherwise strand the pair
  // on the wire with the rank absent. Today rank >= 1 iff owned >= 1.
  if (rank > 0) {
    e.curatorRank = rank;
    e.relicsOwned = owned;
    e.relicsTotal = total;
  }
}
