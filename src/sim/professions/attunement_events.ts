// Attunement celebration events (Professions 2.0): when a quest-
// validated pair attunement lands (new OR return: returning to a held pair is
// also a celebration), the celebrant gets a personal `attuned` event and every
// overworld player in their zone gets a soft `attunedZone` broadcast. Sim-pure
// and text-free: the sim emits ids plus names only, the client renders the
// localized lines.
//
// This rides the SAME shared prologue as professions/gather_events.ts
// announceMasterworkZone (announceZoneCelebration: the entity lookup, the
// instance-space exclusion, the emitToZonePlayers fanout), so the
// celebrations route to online clients the same way (the generic pid-scoped
// SimEvent path in server/game.ts routeEvents: each per-recipient copy
// carries pid = the recipient and is delivered to that session, no per-type
// server wiring).
//
// This module is `src/sim`-pure (see src/sim/CLAUDE.md): no DOM/render/ui/game/net
// imports, no Math.random/Date.now, host-agnostic.

import type { SimContext } from '../sim_context';
import { announceZoneCelebration } from './gather_events';

/** Announce a successful pair attunement for `pid`. Emits the personal `attuned`
 *  event unconditionally, then the zone-wide `attunedZone` broadcast (one copy
 *  per overworld player in the celebrant's zone, the celebrant included) unless
 *  the celebrant is in instance space, where the personal event alone fires (the
 *  masterworkZone rule). Draws NO rng, so its position in the turn-in path cannot
 *  fork the deterministic draw order.
 *
 *  Lifetime-counter hook: every quest-validated attunement (new or return) bumps
 *  the attunementsCompleted lifetime counter behind prog_guildsworn. The bump
 *  sits before the instance-space early return below (a celebrant attuning from
 *  instance space still attuned) and draws nothing. Veterans whose once-ever
 *  attunement predates the counter are healed by the retroFallbackGrants arm in
 *  src/sim/deeds.ts (attunedPairs is the proof). */
export function announceAttunement(ctx: SimContext, pid: number, pairId: string): void {
  const meta = ctx.players.get(pid);
  if (!meta) return;
  ctx.emit({ type: 'attuned', pid, pairId });
  ctx.bumpDeedStat(meta, 'attunementsCompleted', 1);
  // The shared celebration prologue (gather_events.ts) owns the entity
  // lookup, the instance-space skip, and the zone fanout; the bump above
  // stays BEFORE it so an instanced celebrant still counts.
  announceZoneCelebration(ctx, pid, (recipientPid, zoneId) => ({
    type: 'attunedZone',
    pid: recipientPid,
    celebrantPid: pid,
    celebrantName: meta.name,
    pairId,
    zoneId,
  }));
}
