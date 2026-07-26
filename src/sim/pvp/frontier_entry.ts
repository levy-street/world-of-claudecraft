// Frostreach Frontier enter/leave: the teleport surface the PvP window drives so a
// player joins the always-on Frontier the same way they queue Fiesta or the Arena.
// Unlike those matchmade brackets the Frontier is a persistent zone, so there is no
// queue: entering hard-teleports the player to the safe hub and remembers where they
// came from; leaving teleports them back. Free functions taking SimContext (the
// quest_commands pattern); Sim keeps thin same-named delegates for the IWorld surface,
// server/game.ts, and tests. Draws NO rng (a deterministic pid fan-out around the hub).
//
// The only player-facing text is the shared "can't while dead" toast (already under
// the sim_i18n matcher); every other rejection is a silent no-op the PvP window guards
// by enabling Enter/Leave only when the action is valid, so this module adds no new
// localized strings.
import { DUNGEON_X_THRESHOLD } from '../data';
import type { SimContext } from '../sim_context';
import { FRONTIER_HUB, FRONTIER_MIN_LEVEL, isFrontierPos } from './frontier';

// A deterministic per-player ring around the hub centre so simultaneous arrivals do
// not stack on one point. No rng: purely a function of the entity id.
function hubSpawn(pid: number): { x: number; z: number } {
  const ring = pid % 8;
  const angle = (ring / 8) * Math.PI * 2;
  const radius = 4 + (pid % 3) * 2;
  return {
    x: FRONTIER_HUB.x + Math.cos(angle) * radius,
    z: FRONTIER_HUB.z + Math.sin(angle) * radius,
  };
}

export function frontierEnter(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { e, meta } = r;
  if (e.dead) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return;
  }
  if (isFrontierPos(e.pos.x)) return; // already inside: no-op
  // Never an escape hatch out of a live arena/fiesta/yumi match (a seated fighter is
  // not inCombat during the countdown), matching every queue command's guard. Without
  // it the player deserts the match AND frontierReturn records the arena-slot
  // coordinates, so a later frontier_leave teleports them back into the match band.
  if (ctx.arenaMatches.has(meta.entityId)) return;
  // Nor from inside any far-off instance band (dungeon, arena, delve, yumi, practice
  // pitch): the same DUNGEON_X_THRESHOLD position gate the arena queue uses. The
  // Frontier band itself was already handled by the isFrontierPos no-op above.
  if (e.pos.x > DUNGEON_X_THRESHOLD) return;
  if (e.level < FRONTIER_MIN_LEVEL) return; // endgame gate: no-op (button disabled)
  if (e.inCombat) return; // cannot teleport away mid-fight: no-op (button disabled)
  // Remember the overworld spot to return to, then hard-teleport to the safe hub.
  meta.frontierReturn = { x: e.pos.x, z: e.pos.z, facing: e.facing };
  const spot = hubSpawn(meta.entityId);
  e.pos = ctx.groundPos(spot.x, spot.z);
  e.prevPos = { ...e.pos };
}

export function frontierLeave(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { e, meta } = r;
  if (!isFrontierPos(e.pos.x)) return; // not inside: no-op
  if (e.inCombat) return; // cannot teleport away mid-fight: no-op (button disabled)
  // Validate the recorded return spot before using it: a poisoned record (an old save,
  // or one written before the instance guards above existed) must never teleport the
  // player into a dungeon/arena/delve instance band. Fall back to the same sane
  // overworld origin an absent record uses.
  const saved = meta.frontierReturn;
  const ret =
    saved && Number.isFinite(saved.x) && Number.isFinite(saved.z) && saved.x <= DUNGEON_X_THRESHOLD
      ? saved
      : { x: 0, z: 0, facing: 0 };
  e.pos = ctx.groundPos(ret.x, ret.z);
  e.prevPos = { ...e.pos };
  e.facing = ret.facing;
  meta.frontierReturn = undefined;
}
