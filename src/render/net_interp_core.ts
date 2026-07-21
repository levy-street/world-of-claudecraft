// Per-entity render-interpolation clock for online remote entities, factored
// out of the renderer so it can be unit-tested without a WebGL context.
//
// Online, each non-self entity interpolates prevPos/prevFacing toward pos/
// facing on its own measured update cadence (Entity.netUpdatedAt/netInterval,
// maintained by ClientWorld.applyWire). ClientWorld only LEARNS netInterval
// from gaps in (5, 450) ms, so an entity that only ever receives sparse
// records (an idle mob whose sole update is a wander turn every few seconds)
// keeps netInterval undefined forever. The renderer used to fall back to the
// global frame alpha for those, and that alpha cycles 0 -> 1 every sim tick:
// the entity's last state transition was REPLAYED every tick until its next
// record, which could be minutes away. One turn became a continuous strobing
// pirouette (the "immobile characters flicker" report). A fixed fallback
// interval makes the transition play once and saturate instead.
export const DEFAULT_NET_INTERVAL_MS = 120;

// Positions may extrapolate slightly past the last update so a steadily
// walking entity does not stall between records. Extrapolation is earned by a
// MEASURED cadence: on the fallback clock the next record is far away, so a
// sustained 25% overshoot would just snap back when it lands; unknown-cadence
// entities cap at 1.
export const POS_EXTRAPOLATION_CAP = 1.25;

/**
 * Interpolation alpha for a non-self entity. `netUpdatedAt` undefined means
 * an offline world (the sim refreshes prev* every tick), where the global
 * frame alpha is the correct clock.
 *
 * LOCKSTEP: ClientWorld.applyWire (src/net/online.ts) re-anchors prevPos/
 * prevFacing with this same clock (same fallback interval, same caps) so the
 * anchor is the pose the renderer actually drew; net/ cannot import render/,
 * so change both together.
 */
export function remoteEntityAlpha(
  nowMs: number,
  netUpdatedAt: number | undefined,
  netInterval: number | undefined,
  globalAlpha: number,
): number {
  if (netUpdatedAt === undefined) return globalAlpha;
  return Math.min(
    netInterval === undefined ? 1 : POS_EXTRAPOLATION_CAP,
    (nowMs - netUpdatedAt) / Math.max(20, netInterval ?? DEFAULT_NET_INTERVAL_MS),
  );
}

/**
 * Facing never extrapolates: overshooting a turn by 25% and snapping back on
 * the next record reads as a flick on every sparsely-updated entity.
 */
export function facingAlpha(alpha: number): number {
  return Math.min(1, alpha);
}
