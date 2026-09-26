// The "mobs forget the leaving player" leg of Sim.removePlayer, moved out
// verbatim behind SimContext (the monolith ratchet: sim.ts sat at its exact
// ceiling when the placed mobile-station object needed one drop call in
// removePlayer, so this self-contained sweep paid for it). Statements and
// order preserved: every mob drops the leaver from its threat table, forced
// target and aggro target (re-targeting a live, unowned mob at once), a live
// tap on the leaver clears, and every remaining player who had the leaver
// targeted loses that target. Draws no rng.

import type { SimContext } from '../sim_context';

export function forgetLeavingPlayer(ctx: SimContext, pid: number): void {
  for (const m of ctx.entities.values()) {
    if (m.kind !== 'mob') continue;
    m.threat.delete(pid);
    if (m.forcedTargetId === pid) {
      m.forcedTargetId = null;
      m.forcedTargetTimer = 0;
    }
    if (m.aggroTargetId === pid) {
      m.aggroTargetId = null;
      if (!m.dead && m.aiState !== 'dead' && m.ownerId === null) ctx.retargetMob(m);
    }
    if (m.tappedById === pid && !m.dead) m.tappedById = null;
  }
  for (const other of ctx.players.values()) {
    const e = ctx.entities.get(other.entityId);
    if (e && e.targetId === pid) e.targetId = null;
  }
}
