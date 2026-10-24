// The Mirefen muster camps' plan for a world seed: the one list the camp art and the camp
// colliders both read (muster_camp_layout.ts plans it, from the real heightfield and the
// trunk and boulder scatter the sim and the foliage already share).
//
// Moved here from src/render/muster_camps.ts when the camps gained collision: a wall the
// renderer draws from one computation and the sim collides from another is a wall that
// drifts. Computed once per seed. Built-in world only: an editor document has no muster.

import {
  MUSTER_BOSS_TEMPLATE_ID,
  MUSTER_CAMPS,
  MUSTER_CIRCUIT,
  MUSTER_RACK,
} from './content/mirefen_muster';
import { type MusterPlacement, planMusterCamps } from './muster_camp_layout';
import { generateDecorationsInBounds, terrainHeight, WATER_LEVEL } from './world';
import { WORLD_BOSSES } from './world_boss';

/** Balgath's lair: his opening leg starts here (the world-boss spawn record). */
function balgathLair(): { x: number; z: number } {
  const def = WORLD_BOSSES.find((boss) => boss.templateId === MUSTER_BOSS_TEMPLATE_ID);
  if (!def) throw new Error('muster camps: no balgath_cyclops world-boss record');
  return def.pos;
}

/** Trunks and boulders around the camps (the scatter the sim and foliage share). */
function campObstacles(seed: number): { x: number; z: number; r: number }[] {
  const out: { x: number; z: number; r: number }[] = [];
  for (const camp of MUSTER_CAMPS) {
    const reach = 26;
    for (const d of generateDecorationsInBounds(seed, {
      minX: camp.center.x - reach,
      maxX: camp.center.x + reach,
      minZ: camp.center.z - reach,
      maxZ: camp.center.z + reach,
    })) {
      out.push({ x: d.x, z: d.z, r: (d.kind === 'rock' ? 1.0 : 0.9) * d.scale });
    }
  }
  return out;
}

const planBySeed = new Map<number, MusterPlacement[]>();

/** The full muster plan (both tier classes) for a world seed, computed once. */
export function musterCampPlan(seed: number): readonly MusterPlacement[] {
  let plan = planBySeed.get(seed);
  if (!plan) {
    plan = planMusterCamps({
      camps: MUSTER_CAMPS,
      circuit: MUSTER_CIRCUIT,
      lair: balgathLair(),
      rack: MUSTER_RACK,
      heightAt: (x, z) => terrainHeight(x, z, seed),
      obstacles: campObstacles(seed),
      minGroundY: WATER_LEVEL + 0.5,
    });
    planBySeed.set(seed, plan);
  }
  return plan;
}
