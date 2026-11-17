// The heart seal crystal (docs/design/raid/smith_heart.md, "The heart seal"):
// the one crystal at the centre of the Ring's dais, a claim object
// (content/smith_heart.ts SMITH_HEART_SEAL_CRYSTAL_OBJECT, appended last to
// the dungeon's objects) that stands for the seal. It lights as each guardian
// falls (the render side reads the veins off the seal markers), it is CHARGED
// once all four veins burn and the Ring is clear (the markers' READY bit,
// seal.ts), and a player's press then bursts it (seal_burst.ts): the portal to
// the Heart stands in its place.
//
// This module is the crystal as an OBJECT, and a leaf under seal.ts (it
// imports nothing of the seal, so seal.ts can drive it every tick without a
// cycle; seal_burst.ts, the press and the burst, sits above both):
//   Pressable  `lootable` is true ONLY while the seal is READY and the crystal
//              has not burst: the clients' interact press and click take
//              lootable objects only, so a dark crystal offers no press. The
//              generic object sweep (sim.ts) re-arms any non-lootable object
//              once its `respawnTimer` runs out (it is 0 on a fresh claim
//              object), so the crystal's is held at Infinity and it never
//              re-arms by itself (the battleground flag's precedent).
//   Solid      while it stands it is a combat wall (instances/
//              combat_wall_state.ts, a round row the size of SEAL_CRYSTAL.r):
//              bodies and sight lines stop at it, offline and online alike
//              (net/combat_wall_wire.ts mirrors the wall off the entity). The
//              wall state is given to the object once, as the council's carved
//              columns are given theirs (council_pillars.ts ensurePillarWalls),
//              and the trash engine publishes it every tick. A body that finds
//              itself inside the circle is pushed out of it by the ordinary
//              depenetration, never held in it.
//   Burst      the crystal LEAVES the claim (`retireSealCrystal`): its wall
//              goes the same tick and the entity is dropped, so the online
//              mirror's wall leaves with the entity one snapshot later (the
//              pillars' contract). That a crystal has burst is the PORTAL bit
//              of the seal markers, never anything kept here.
//   Markers    the seal's 14 markers are inert anchors, one of them at the
//              same spot as the crystal. They are held non-lootable the same
//              way (`holdSealMarkerInert`), or a marker could tie the crystal
//              in the interact scan and take the press.
//
// Draws NO rng and reads no clock. Its per-tick cost is one walk of the claim's
// authored objects (the dungeon's `objects` list, a content-bounded few dozen),
// never a collection that grows with the realm's age.

import { SMITH_HEART_SEAL_CRYSTAL_TEMPLATE } from '../../content/smith_heart';
import { SEAL_CRYSTAL } from '../../content/smith_heart_layout';
import { instanceHalfWidthOf } from '../../instances/instance_footprint';
import { syncCombatWallCollision } from '../../mob/trash_kit/combat_walls';
import { dropKitObject, kitObjectsOf } from '../../mob/trash_kit/kit_objects';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { dist2d, type Entity, INTERACT_RANGE } from '../../types';

/** How long the crystal's wall stands: the claim's, never a clock's (the
 *  trash engine counts a wall down every tick, combat_walls.ts stepCombatWall,
 *  so it is given a lifetime no claim outlives). */
const CRYSTAL_WALL_LIFE = 1e9;

/** Is `templateId` the heart seal crystal's? */
export function isSealCrystalTemplate(templateId: string): boolean {
  return templateId === SMITH_HEART_SEAL_CRYSTAL_TEMPLATE;
}

/** The claim's crystal while it stands, or null (it burst, or the claim has
 *  none). */
export function sealCrystalOf(ctx: SimContext, inst: InstanceSlot): Entity | null {
  for (const id of inst.objectIds) {
    const e = ctx.entities.get(id);
    if (e && isSealCrystalTemplate(e.templateId)) return e;
  }
  return null;
}

/** Has the claim's crystal burst (left the claim)? */
export function sealCrystalBurst(ctx: SimContext, inst: InstanceSlot): boolean {
  return sealCrystalOf(ctx, inst) === null;
}

/** The live claim that holds `crystal`, or null for a crystal in no claim. */
export function sealCrystalClaim(ctx: SimContext, crystal: Entity): InstanceSlot | null {
  for (const inst of ctx.instances) {
    if (inst.partyKey !== null && inst.dungeonId === crystal.dungeonId) {
      if (inst.objectIds.includes(crystal.id)) return inst;
    }
  }
  return null;
}

/** Is `body` inside the crystal's claim and within reach of the crystal? Reach
 *  is the classic interact range measured from the crystal's EDGE (its wall
 *  keeps a body a body's width off the rim, so a press from beside it counts). */
export function inSealCrystalReach(
  ctx: SimContext,
  inst: InstanceSlot,
  crystal: Entity,
  body: Entity,
): boolean {
  const o = ctx.instanceOriginOf(inst);
  // The claim's envelope: the dungeon's half width in x and the slot's 250 yd
  // half depth in z (the same shape instances/dungeons.ts instanceContains
  // and the seal's own announce read).
  if (
    Math.abs(body.pos.x - o.x) >= instanceHalfWidthOf(inst.dungeonId) ||
    Math.abs(body.pos.z - o.z) >= 250
  )
    return false;
  return dist2d(body.pos, crystal.pos) <= INTERACT_RANGE + SEAL_CRYSTAL.r;
}

/** Keep a seal marker (an inert anchor) out of the press: never lootable,
 *  never re-armed by the generic object sweep. */
export function holdSealMarkerInert(marker: Entity): void {
  if (marker.lootable) marker.lootable = false;
  marker.respawnTimer = Number.POSITIVE_INFINITY;
}

/**
 * One tick of the claim's crystal, after the seal derived this tick's value:
 * while it has not burst it is pressable exactly while the seal is `ready`
 * (never re-armed by the sweep) and stands as a wall; once `burst` it leaves
 * the claim. A claim with no crystal left costs one walk of its objects.
 */
export function tickSealCrystal(
  ctx: SimContext,
  inst: InstanceSlot,
  ready: boolean,
  burst: boolean,
): void {
  const crystal = sealCrystalOf(ctx, inst);
  if (!crystal) return;
  if (burst) {
    retireSealCrystal(ctx, inst);
    return;
  }
  crystal.lootable = ready;
  crystal.respawnTimer = Number.POSITIVE_INFINITY;
  if (!crystal.kitObject) {
    crystal.kitObject = { kind: 'wall', remaining: CRYSTAL_WALL_LIFE };
    syncCombatWallCollision(ctx, inst, kitObjectsOf(ctx, inst, 'wall').length);
  }
}

/**
 * The crystal bursts: it leaves the claim and its wall goes this very tick
 * (the portal's trigger at the dais centre is then reachable). A no-op for a
 * claim whose crystal has already gone.
 */
export function retireSealCrystal(ctx: SimContext, inst: InstanceSlot): void {
  const crystal = sealCrystalOf(ctx, inst);
  if (!crystal) return;
  dropKitObject(ctx, inst, crystal.id);
  syncCombatWallCollision(ctx, inst, kitObjectsOf(ctx, inst, 'wall').length);
}
