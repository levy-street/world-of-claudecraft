// The heart seal crystal (docs/design/raid/smith_heart.md, "The heart seal"):
// the one crystal at the centre of the Ring's dais, a claim object
// (content/smith_heart.ts SMITH_HEART_SEAL_CRYSTAL_OBJECT, appended last to
// the dungeon's objects) that stands for the seal. It lights as each guardian
// falls (the render side reads the veins off the seal markers), it is CHARGED
// once all four veins burn and the Ring is clear (the markers' READY bit,
// seal.ts), and the first tick a living player of the claim then stands in the
// middle circle (the dais, `SEAL_CRYSTAL_TRIGGER_R`) it bursts (seal.ts
// tickSmithHeartSeal): the portal to the Heart stands in its place. The owner's
// call of 2026-11-18: no press, the raid arriving in the middle sets it off.
//
// This module is the crystal as an OBJECT, and a leaf under seal.ts (it
// imports nothing of the seal, so seal.ts can drive it every tick without a
// cycle; seal_burst.ts, the forced burst, sits above both):
//   Inert      never lootable, so no client offers it a press or a click, and
//              its `respawnTimer` is held at Infinity: the generic object sweep
//              (sim.ts) re-arms any non-lootable object once its timer runs out
//              (it is 0 on a fresh claim object; the battleground flag's
//              precedent).
//   Solid      while it stands it is a combat wall (instances/
//              combat_wall_state.ts, a round row the size of SEAL_CRYSTAL.r):
//              bodies and sight lines stop at it, offline and online alike
//              (net/combat_wall_wire.ts mirrors the wall off the entity). The
//              wall state is given to the object once, as the council's carved
//              columns are given theirs (council_pillars.ts ensurePillarWalls),
//              and the trash engine publishes it every tick. A body that finds
//              itself inside the circle is pushed out of it by the ordinary
//              depenetration, never held in it.
//   Trigger    `sealCrystalTriggered`: a living player of the claim inside the
//              middle circle (the dead and released spirits never count).
//   Burst      the crystal LEAVES the claim (`retireSealCrystal`): its wall
//              goes the same tick and the entity is dropped, so the online
//              mirror's wall leaves with the entity one snapshot later (the
//              pillars' contract). That a crystal has burst is the PORTAL bit
//              of the seal markers, never anything kept here.
//   Markers    the seal's 14 markers are inert anchors, held non-lootable the
//              same way (`holdSealMarkerInert`).
//
// Draws NO rng and reads no clock. Its per-tick cost is one walk of the claim's
// authored objects (the dungeon's `objects` list, a content-bounded few dozen),
// and, only while the crystal is charged and whole, one walk of the players.

import { SMITH_HEART_SEAL_CRYSTAL_TEMPLATE } from '../../content/smith_heart';
import { SEAL_DAIS } from '../../content/smith_heart_layout';
import { syncCombatWallCollision } from '../../mob/trash_kit/combat_walls';
import { dropKitObject, kitObjectsOf } from '../../mob/trash_kit/kit_objects';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import type { Entity } from '../../types';

/** How long the crystal's wall stands: the claim's, never a clock's (the
 *  trash engine counts a wall down every tick, combat_walls.ts stepCombatWall,
 *  so it is given a lifetime no claim outlives). */
const CRYSTAL_WALL_LIFE = 1e9;

/** The middle circle (yards from the crystal): the dais the four stairs land on. A living
 *  player of the claim standing in it once the crystal is charged bursts it. */
export const SEAL_CRYSTAL_TRIGGER_R = SEAL_DAIS.r;

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

/** Does a living player stand in the middle circle round `crystal`? The circle is
 *  the claim's own (claims stand hundreds of yards apart, so it reaches nobody of
 *  another); the dead and released spirits never count. The dais is the only floor
 *  over that circle, so no height band is asked (the intros' band is for stacked
 *  floors). */
export function sealCrystalTriggered(ctx: SimContext, crystal: Entity): boolean {
  const r2 = SEAL_CRYSTAL_TRIGGER_R * SEAL_CRYSTAL_TRIGGER_R;
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e || e.dead || e.ghost) continue;
    const dx = e.pos.x - crystal.pos.x;
    const dz = e.pos.z - crystal.pos.z;
    if (dx * dx + dz * dz <= r2) return true;
  }
  return false;
}

/** Keep a seal marker (an inert anchor) inert: never lootable, never re-armed by the
 *  generic object sweep. */
export function holdSealMarkerInert(marker: Entity): void {
  if (marker.lootable) marker.lootable = false;
  marker.respawnTimer = Number.POSITIVE_INFINITY;
}

/**
 * One tick of the claim's crystal, after the seal derived this tick's value:
 * while it has not burst it stays inert (never lootable, never re-armed by the
 * sweep) and stands as a wall; once `burst` it leaves the claim. A claim with no
 * crystal left costs one walk of its objects.
 */
export function tickSealCrystal(ctx: SimContext, inst: InstanceSlot, burst: boolean): void {
  const crystal = sealCrystalOf(ctx, inst);
  if (!crystal) return;
  if (burst) {
    retireSealCrystal(ctx, inst);
    return;
  }
  if (crystal.lootable) crystal.lootable = false;
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
