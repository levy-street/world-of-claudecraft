// Regional threat assessment for the Idle Classic engine.
//
// The classic auto-combat ladder reacts to ONE mob. That is not enough in a
// world where murloc packs ("where there is one mudfin, there are five") and
// boss camps kill a low-level player before any single mob trips the danger
// gate. This module reads the AREA around the player, counts how many hostile
// mobs are within a radius, and classifies the region as safe, cautious, or
// lethal. When lethal, it returns the centroid to flee FROM (pack-aware), so
// the navigator runs out of the pack instead of away from just one member.
//
// Host-agnostic leaf (like sim/threat.ts): no DOM, no rng, no Sim mutation.
// Reads only live entity state + content template tables. Vitest-imported.

import { MOBS } from '../src/sim/data';
import type { Sim } from '../src/sim/sim';
import { dist2d, type Entity, type Vec3 } from '../src/sim/types';
import { safeLevelGap } from './difficulty';

/** Classification of the area immediately around the player. */
export type DangerLevel = 'safe' | 'caution' | 'lethal';

/**
 * Radius around the player within which hostiles count toward the threat
 * assessment. Bigger than any camp mob's aggro radius (the longest is 13),
 * so a pack has to actually be ON the player to count as a pack threat.
 */
const THREAT_RADIUS = 22;
/**
 * Number of hostiles (regardless of level) that constitutes a pack the idle
 * player should flee from. Even at-level, three mobs summed damage outpaces a
 * solo player's healing, so the navigator disengages the pack as a unit.
 */
const PACK_SIZE = 3;

export interface ThreatAssessment {
  readonly level: DangerLevel;
  /** Hostile mobs within the threat radius that the player fled from (the pack). */
  readonly mobs: ReadonlyArray<Entity>;
  /** Centroid of the pack, to flee FROM. Null when level is safe. */
  readonly fleeFrom: Vec3 | null;
  /** Number of hostile mobs in the threat radius. */
  readonly hostileCount: number;
  /** Whether any in-radius mob is boss/rare/elite/wb (affix danger). */
  readonly hasAffixDanger: boolean;
}

/** True when the mob template carries a solo-unfriendly affix flag. */
function hasAffix(e: Entity): boolean {
  const template = MOBS[e.templateId];
  return (
    !!template && (!!template.boss || !!template.rare || !!template.elite || !!template.worldBoss)
  );
}

/** Shared strong-test: a mob is a lurking threat when above the gap OR affixed. */
function isStrong(playerLevel: number, e: Entity): boolean {
  return e.level > playerLevel + safeLevelGap(playerLevel) || hasAffix(e);
}

/**
 * Assess the danger of the area around the player.
 *
 * - `lethal`: any in-radius mob the player should not engage (above-gap OR
 *   affixed), OR a pack of `PACK_SIZE` or more hostiles regardless of level
 *   (the murloc-swarm / bandit-camp case where summed damage kills even when
 *   each individual mob is level-appropriate). A single strong mob also counts
 *   as lethal: it has already aggrod the player and will kill a solo, so the
 *   navigator flees rather than trying to out-damage it.
 * - `caution`: two level-appropriate hostiles (still survivable, but the
 *   player should not pull a third).
 * - `safe`: at most one level-appropriate hostile.
 */
export function assessThreat(sim: Sim): ThreatAssessment {
  const p = sim.player;
  const nearby: Entity[] = [];
  let affixDanger = false;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead || !e.hostile) continue;
    if (dist2d(p.pos, e.pos) > THREAT_RADIUS) continue;
    nearby.push(e);
    if (hasAffix(e)) affixDanger = true;
  }

  const strongNearby = nearby.filter((e) => isStrong(p.level, e));
  const isPack = nearby.length >= PACK_SIZE;
  const lethal = strongNearby.length > 0 || isPack;

  let level: DangerLevel;
  if (lethal) {
    level = 'lethal';
  } else if (nearby.length >= 2) {
    level = 'caution';
  } else if (nearby.length === 1) {
    // A single strong mob is already caught by `lethal`. This branch
    // is only reached when the single mob is level-appropriate → safe.
    level = 'safe';
  } else {
    level = 'safe';
  }

  // The pack to flee FROM: when a strong mob lurks, flee from every strong one;
  // when it is a pure at-level pack, flee from the whole nearby ring so the
  // centroid leads the player out of the cluster, not between two members.
  let fleeFrom: Vec3 | null = null;
  if (level === 'lethal') {
    const fleeSet = strongNearby.length > 0 ? strongNearby : nearby;
    let cx = 0;
    let cz = 0;
    for (const m of fleeSet) {
      cx += m.pos.x;
      cz += m.pos.z;
    }
    fleeFrom = { x: cx / fleeSet.length, y: 0, z: cz / fleeSet.length };
  }

  return {
    level,
    mobs: nearby.slice(),
    fleeFrom,
    hostileCount: nearby.length,
    hasAffixDanger: affixDanger,
  };
}
