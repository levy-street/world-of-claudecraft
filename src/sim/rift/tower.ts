// The Demon Tower runtime: the per-tick driver that releases waves, tracks what
// is still alive on the floor, and opens the ascent when the floor is clear.
//
// A self-contained system module behind the SimContext seam. It holds FUNCTIONS
// only: every piece of state lives on the RiftInstance (towerWave,
// towerWaveMobIds, towerBossId, towerCoreId), which is a Sim field exposed to
// this module as a live ctx view, exactly like the rest of the rift runtime.
//
// How a floor plays, and why it is shaped this way:
//   - The floor arrives EMPTY. Every other rift floor spawns its population at
//     entry; the tower's comes out of the core wave by wave, which is the whole
//     feel of the place.
//   - A wave lands only when the floor is clear of the last one. Waiting on a
//     clear rather than a timer means a raid is never punished for a slow kill
//     with a second pack on top, and it bounds the live-demon count with no
//     throttling maths.
//   - On a boss floor the LAST wave releases the boss alongside its demons, so
//     the fight is earned rather than a door you walk through.
//   - The floor is done when the last wave and any released boss are dead. That
//     flips `puzzleSolved`, and the shared logic in runs.ts opens the ascent
//     exactly as it does for a full set of lit pylons: no bespoke descent path.
//
// Determinism: wave composition and placement are pure functions of the floor
// index (rift/tower_waves.ts), and the tower deliberately does NOT apply the
// per-run colour/scale re-grade the procedural rift spawn path draws. The tower
// is a fixed landmark, so its demons should look the same on every visit, and as
// a result this driver draws ZERO rng: releasing a wave cannot shift the shared
// stream for anything else in the world.

import { DEMON_TOWER_SEED, DEMON_TOWER_THEME_NAME } from '../content/rift/demon_tower';
import { MOBS, riftInstanceOrigin } from '../data';
import { createGroundObject, createMob } from '../entity';
import type { SimContext } from '../sim_context';
import { RIFT_RANK_BASE_LEVEL, riftHeroicTemplate } from './ranks';
import {
  DEMON_TOWER_FLOOR_COUNT,
  DEMON_TOWER_MAX_LIVE_DEMONS,
  demonTowerFloorTuning,
  isDemonTowerBossFloor,
} from './tower_scaling';
import { demonTowerBossFor, demonTowerWavePlan } from './tower_waves';
import type { RiftInstance } from './types';

/** The floor plan's puzzle kind that marks an instance as a tower floor. */
export const DEMON_TOWER_PUZZLE_KIND = 'demon_waves';

/** Where the tower stands: the eastern reach of Thornpeak Heights (zone 3, the
 * endgame zone, z 540..900), clear of the authored points of interest so the
 * landmark never lands on top of one. A FIXED position, because the whole point
 * of the tower is that it is always in the same place. */
export const DEMON_TOWER_DOOR = { x: 140, z: 850 } as const;

/**
 * Spawn the permanent Demon Tower door, once per world.
 *
 * The entry mechanism is deliberately the one rift portals already use: a ground
 * object carrying `templateId: 'rift_portal'` plus a `riftSeed`. Walking into it
 * enters the rift with that seed, and because the tower's seed is the reserved
 * sentinel, that is the tower. No new entry path, no new trigger, and the
 * descriptor stays exactly what every host already regenerates content from.
 *
 * Unlike a scheduled portal this one has no tier, no event, and no expiry: it is
 * a landmark, not a world event, so it never announces, never collapses, and is
 * never sealed by a clear.
 */
export function spawnDemonTowerDoor(ctx: SimContext): number {
  const door = createGroundObject(
    ctx.nextId++,
    '',
    DEMON_TOWER_THEME_NAME,
    ctx.groundPos(DEMON_TOWER_DOOR.x, DEMON_TOWER_DOOR.z),
  );
  door.templateId = 'rift_portal';
  door.objectItemId = null;
  door.lootable = true;
  door.riftSeed = DEMON_TOWER_SEED;
  // Entered at the top rank's base level: the tower is endgame raid content and
  // its own per-floor curve carries the difficulty from there.
  door.riftBaseLevel = RIFT_RANK_BASE_LEVEL.S;
  ctx.addEntity(door);
  return door.id;
}

/** Reset the tower bookkeeping for a freshly built floor. Called from the shared
 * floor-spawn path, so a slot reused by a later run never inherits wave state. */
export function resetTowerFloor(inst: RiftInstance): void {
  inst.towerWave = 0;
  inst.towerWaveMobIds = [];
  inst.towerBossId = null;
  inst.towerCoreId = null;
}

/** Demons of the current wave still standing. */
function liveWaveCount(ctx: SimContext, inst: RiftInstance): number {
  let alive = 0;
  for (const id of inst.towerWaveMobIds) {
    const m = ctx.entities.get(id);
    if (m && !m.dead) alive++;
  }
  return alive;
}

function towerBossAlive(ctx: SimContext, inst: RiftInstance): boolean {
  if (inst.towerBossId === null) return false;
  const boss = ctx.entities.get(inst.towerBossId);
  return !!boss && !boss.dead;
}

/**
 * Spawn one demon for the tower. The stat transform is the SHARED
 * `riftHeroicTemplate` (the tower's per-floor tuning is structurally the same
 * four multipliers a heroic rank uses), so there is one scaling implementation in
 * the codebase rather than a second copy that can drift. What differs is where
 * the multipliers come from: how high the raid has climbed, not which rank of
 * portal it walked through.
 */
function spawnTowerDemon(
  ctx: SimContext,
  inst: RiftInstance,
  templateId: string,
  x: number,
  z: number,
  level: number,
  asBoss: boolean,
): number | null {
  const template = MOBS[templateId];
  if (!template) return null;
  const tuning = demonTowerFloorTuning(inst.floorIndex);
  const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);
  const mob = createMob(
    ctx.nextId++,
    riftHeroicTemplate(template, tuning),
    level,
    ctx.groundPos(origin.x + x, origin.z + z),
  );
  // Mechanic damage/heal numbers are read from the base MOBS table at fire time,
  // so the template transform above cannot reach them; these per-entity
  // multipliers apply on top.
  mob.mechanicDamageMult = tuning.damageMultiplier;
  mob.mechanicHealMult = tuning.healthMultiplier;
  if (asBoss) mob.riftMechanicLimit = tuning.mechanicLimit;
  mob.facing = Math.PI;
  mob.prevFacing = mob.facing;
  ctx.addEntity(mob);
  inst.mobIds.push(mob.id);
  return mob.id;
}

/** Release the next wave (and, on the last wave of a boss floor, its boss). */
function releaseWave(
  ctx: SimContext,
  inst: RiftInstance,
  floorLevel: number,
  playerIds: readonly number[],
): void {
  const plan = demonTowerWavePlan(inst.floorIndex);
  const wave = plan[inst.towerWave];
  if (!wave) return;

  inst.towerWaveMobIds = [];
  for (const spawn of wave.spawns) {
    // The live cap is a backstop, not the pacing rule: waves already land one at
    // a time. It matters when a boss and its summoned adds share the floor with
    // the final wave, which is exactly where a raid-scale spawn storm would hurt.
    if (inst.towerWaveMobIds.length >= DEMON_TOWER_MAX_LIVE_DEMONS) break;
    const id = spawnTowerDemon(ctx, inst, spawn.templateId, spawn.x, spawn.z, floorLevel, false);
    if (id !== null) inst.towerWaveMobIds.push(id);
  }

  if (wave.releasesBoss) {
    const bossTemplate = demonTowerBossFor(inst.floorIndex);
    if (bossTemplate) {
      const id = spawnTowerDemon(ctx, inst, bossTemplate, 0, 0, floorLevel, true);
      if (id !== null) {
        inst.towerBossId = id;
        // Only the SUMMIT boss takes the run's boss slot: that death is what
        // opens the way home and pays out (runs.ts). Claiming bossId for the
        // floor-5 gatekeeper would let the shared clear logic end the run five
        // floors early.
        if (inst.floorIndex === DEMON_TOWER_FLOOR_COUNT - 1) inst.bossId = id;
      }
    }
  }

  inst.towerWave++;
  const total = demonTowerFloorTuning(inst.floorIndex).waveCount;
  // Each announcement is emitted from its own site with a LITERAL text, rather
  // than one emit fed by a ternary: the S3 drift guard
  // (tests/localization_fixes.test.ts) only sees string literals at the emit
  // site, so a variable-routed text would silently drop out of its coverage.
  for (const pid of playerIds) {
    if (wave.releasesBoss) {
      ctx.emit({
        type: 'log',
        text: 'The core splits open. Something far worse steps through.',
        color: '#f67',
        pid,
      });
    } else {
      ctx.emit({
        type: 'log',
        text: `The Demon Core howls. Wave ${inst.towerWave} of ${total}.`,
        color: '#f67',
        pid,
      });
    }
  }
}

/**
 * Per-tick driver for one tower instance. Idempotent and cheap: it walks the
 * current wave's ids and otherwise does nothing until that wave is dead.
 */
export function updateDemonTower(
  ctx: SimContext,
  inst: RiftInstance,
  floorLevel: number,
  playerIds: readonly number[],
): void {
  if (inst.partyKey === null || inst.puzzleSolved) return;
  const tuning = demonTowerFloorTuning(inst.floorIndex);

  // Still fighting: nothing to do.
  if (liveWaveCount(ctx, inst) > 0 || towerBossAlive(ctx, inst)) return;

  if (inst.towerWave < tuning.waveCount) {
    releaseWave(ctx, inst, floorLevel, playerIds);
    return;
  }

  // Every wave sent and nothing left standing. A boss floor additionally has to
  // have actually released and buried its boss: without this guard a floor whose
  // boss failed to spawn would hand out a free clear.
  if (isDemonTowerBossFloor(inst.floorIndex) && inst.towerBossId === null) return;
  inst.puzzleSolved = true;
  const summit = inst.floorIndex === DEMON_TOWER_FLOOR_COUNT - 1;
  for (const pid of playerIds) {
    if (summit) {
      ctx.emit({
        type: 'log',
        text: 'The Demon Core goes dark. The tower is yours.',
        color: '#9f6',
        pid,
      });
    } else {
      ctx.emit({
        type: 'log',
        text: 'The Demon Core cracks. The way up is open.',
        color: '#9f6',
        pid,
      });
    }
  }
}
