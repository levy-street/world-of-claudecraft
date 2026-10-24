// The primary player's active procedural Rift floor as the IWorld read
// (`riftFloor`): the descriptor the renderer regenerates geometry and style
// from, null outside a rift. A pure read over the SimContext views; Sim keeps
// the per-tick cache and the thin getter.
import type { RiftFloorView } from '../../world_api/dungeons';
import { riftInstanceOrigin } from '../data';
import type { SimContext } from '../sim_context';
import { generateRiftFloor } from './rift_gen';
import { riftInstanceAtPos } from './runs';

export function buildRiftFloorView(ctx: SimContext): RiftFloorView | null {
  const p = ctx.entities.get(ctx.primaryId);
  if (!p) return null;
  const inst = riftInstanceAtPos(ctx, p.pos);
  if (!inst || inst.partyKey === null) return null;
  const floor = generateRiftFloor(inst.seed, inst.baseLevel, inst.floorIndex, inst.upgrade);
  const event =
    inst.eventId === null
      ? null
      : (ctx.riftEvents.find((candidate) => candidate.eventId === inst.eventId) ?? null);
  const contentId = event?.contentId ?? `procedural-v1:${inst.seed}:${inst.baseLevel}`;
  return {
    eventId: inst.eventId,
    instanceId: inst.instanceId,
    seed: inst.seed,
    baseLevel: inst.baseLevel,
    floorIndex: inst.floorIndex,
    floorCount: inst.floorCount,
    origin: riftInstanceOrigin(inst.slot, inst.floorIndex),
    contentId,
    contentHash: event?.contentHash ?? contentId,
    upgrade: inst.upgrade,
    name: floor.name,
    themeName: floor.themeName,
    tier: inst.tier,
  };
}

// Milliseconds remaining before the current rift's backing event stops admitting
// parties (null outside a rift, or for a dev-spawned rift with no
// backing RiftEvent). Sim-clock arithmetic only (event.expiresAt and ctx.time are
// both sim-clock seconds), recomputed fresh on every call so a repeated read ticks
// down like raidLockouts() does, with no caching to go stale between ticks.
export function riftEventMsRemainingFor(
  ctx: SimContext,
  view: RiftFloorView | null,
): number | null {
  if (!view || view.eventId === null) return null;
  const event = ctx.riftEvents.find((candidate) => candidate.eventId === view.eventId);
  if (!event) return null;
  return Math.max(0, Math.round((event.expiresAt - ctx.time) * 1000));
}
