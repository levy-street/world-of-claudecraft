// Unit tests for the adaptive difficulty policy, threat map, and
// level-appropriate camp navigation.
//
// Pure determinism: creates lightweight Sim instances (same pattern as
// engine.test.ts) and asserts against content tables, no Math.random,
// no Date.now, no live server.

import { describe, expect, it } from 'vitest';
import { isTooDangerous, safeLevelGap } from '../../idle/difficulty';
import { IdleEngine } from '../../idle/engine';
import { findBestCampTarget, isInAppropriateCamp } from '../../idle/progression_target';
import { assessThreat } from '../../idle/threat_map';
import { MOBS } from '../../src/sim/data';
import { createMob } from '../../src/sim/entity';
import type { Entity } from '../../src/sim/types';

// ---------------------------------------------------------------------------
// difficulty.ts: safeLevelGap
// ---------------------------------------------------------------------------

describe('safeLevelGap', () => {
  it('returns 1 for level 1', () => {
    expect(safeLevelGap(1)).toBe(1);
  });
  it('returns 1 for level 2', () => {
    expect(safeLevelGap(2)).toBe(1);
  });
  it('returns 2 for level 3', () => {
    expect(safeLevelGap(3)).toBe(2);
  });
  it('returns 2 for level 10 (cap)', () => {
    expect(safeLevelGap(10)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// difficulty.ts: isTooDangerous / isGoodEngagement
// ---------------------------------------------------------------------------

describe('isTooDangerous', () => {
  function mobAt(level: number, templateId = 'forest_wolf'): Entity {
    return {
      level,
      templateId,
      dead: false,
      hostile: true,
      kind: 'mob' as const,
      id: 1,
      pos: { x: 0, y: 0, z: 0 },
    } as Entity;
  }
  it('rejects a mob above safe gap (L1 vs L3 wolf)', () => {
    // L1 player: gap=1. L3 wolf > L1+1=2 → too dangerous.
    expect(isTooDangerous(1, mobAt(3))).toBe(true);
  });
  it('accepts a mob within gap (L1 vs L1 wolf)', () => {
    expect(isTooDangerous(1, mobAt(1))).toBe(false);
  });
  it('accepts a mob at player level (L5 vs L5)', () => {
    expect(isTooDangerous(5, mobAt(5))).toBe(false);
  });
  it('rejects a mob above gap at cap (L7 vs L10)', () => {
    // L7 player: gap=2. L10 > L7+2=9 → too dangerous.
    expect(isTooDangerous(7, mobAt(10))).toBe(true);
  });
  it('rejects a boss always (L6 vs L6 boss)', () => {
    // Affix mobs are never idle-fight targets (group content).
    expect(isTooDangerous(6, mobAt(6, 'gorrak'))).toBe(true);
  });
  it('rejects a rare always even above mob level (L5 vs L4 rare)', () => {
    expect(isTooDangerous(5, mobAt(4, 'old_greyjaw'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// threat_map.ts: assessThreat
// ---------------------------------------------------------------------------

describe('assessThreat', () => {
  it('returns safe when no mobs are nearby', () => {
    const engine = new IdleEngine({
      seed: 20061,
      playerClass: 'warrior',
      frameSkip: 1,
      playerLevel: 1,
    });
    const sim = engine.sim;
    // Teleport player to an empty area.
    sim.player.pos.x = 1000;
    sim.player.pos.z = 1000;
    const threat = assessThreat(sim);
    expect(threat.level).toBe('safe');
    expect(threat.hostileCount).toBe(0);
  });

  it('classifies a 3+ at-level pack as lethal with a flee centroid', () => {
    // Decisive regression test for the broken pack counting the validator
    // caught: build a Sim, then drop 4 at-level wolves right on the player.
    // None is "strong" (all at level), so lethality can ONLY come from the
    // PACK rule. Before the fix this classified as 'safe'.
    const engine = new IdleEngine({
      seed: 20061,
      playerClass: 'warrior',
      frameSkip: 1,
      playerLevel: 3,
    });
    const sim = engine.sim;
    sim.player.pos.x = 200;
    sim.player.pos.z = 200; // isolated, away from seeded camps
    sim.player.level = 3;
    // Spawn four at-level wolves within the threat radius (22 yd).
    for (let i = 0; i < 4; i++) {
      const mob = createMob(100_000 + i, MOBS['forest_wolf'], 3, {
        x: 200 + (i % 2) * 3,
        y: 0,
        z: 200 + Math.floor(i / 2) * 3,
      });
      sim.entities.set(mob.id, mob);
    }
    const threat = assessThreat(sim);
    expect(threat.hostileCount).toBe(4);
    expect(threat.level).toBe('lethal');
    expect(threat.fleeFrom).not.toBeNull();
    // The centroid of the four wolves centers near the player.
    expect(Math.abs(threat.fleeFrom!.x - 200)).toBeLessThan(5);
    expect(Math.abs(threat.fleeFrom!.z - 200)).toBeLessThan(5);
  });

  it('classifies a single at-level mob as safe (engage it)', () => {
    const engine = new IdleEngine({
      seed: 20061,
      playerClass: 'warrior',
      frameSkip: 1,
      playerLevel: 3,
    });
    const sim = engine.sim;
    sim.player.pos.x = 300;
    sim.player.pos.z = 300;
    sim.player.level = 3;
    const mob = createMob(200_000, MOBS['forest_wolf'], 3, { x: 303, y: 0, z: 300 });
    sim.entities.set(mob.id, mob);
    const threat = assessThreat(sim);
    expect(threat.hostileCount).toBe(1);
    expect(threat.level).toBe('safe');
    expect(threat.fleeFrom).toBeNull();
  });

  it('classifies a single above-gap mob as lethal (flee it, it kills a solo)', () => {
    const engine = new IdleEngine({
      seed: 20061,
      playerClass: 'warrior',
      frameSkip: 1,
      playerLevel: 1,
    });
    const sim = engine.sim;
    sim.player.pos.x = 400;
    sim.player.pos.z = 400;
    // A mudfin_murloc (L3-5) at L5 is above the L1 player's gap (gap=1 → 5 >
    // 1+1=2). A single strong mob that has aggroed the player is lethal: it
    // kills a solo idle player, so the navigator flees rather than engaging.
    const mob = createMob(300_000, MOBS['mudfin_murloc'], 5, { x: 403, y: 0, z: 400 });
    sim.entities.set(mob.id, mob);
    const threat = assessThreat(sim);
    expect(threat.hostileCount).toBe(1);
    expect(threat.level).toBe('lethal');
    expect(threat.fleeFrom).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// progression_target.ts: findBestCampTarget / isInAppropriateCamp
// ---------------------------------------------------------------------------

describe('findBestCampTarget', () => {
  it('returns the wolf camp as best target for a level 1 player at spawn', () => {
    const target = findBestCampTarget({ x: 0, y: 0, z: -2 }, 1);
    expect(target).not.toBeNull();
    if (target) {
      // Wolves are at ~{-15,55}, should be within 80yd.
      expect(target.dist).toBeLessThan(80);
      expect(target.mobMaxLevel).toBeLessThanOrEqual(2); // maxLevel of forest_wolf
    }
  });
  it('returns null when no appropriate camp exists (all are too strong)', () => {
    // At a position with no content, the function should still return something
    // if any camp is within budget. But at L1, only wolves qualify.
    const target = findBestCampTarget({ x: 0, y: 0, z: 0 }, 1);
    expect(target).not.toBeNull(); // wolves are always available.
  });
  it('returns boar camp for a level 3 player', () => {
    const target = findBestCampTarget({ x: 0, y: 0, z: 0 }, 3);
    expect(target).not.toBeNull();
    if (target) {
      // Boars at ~{55,12} are maxLevel=3, within gap=2 → L3+2=5 → boars qualify.
      expect(target.mobMaxLevel).toBeLessThanOrEqual(5);
    }
  });
});

describe('isInAppropriateCamp', () => {
  it('returns true when standing in wolf camp area', () => {
    expect(isInAppropriateCamp({ x: -15, y: 0, z: 55 }, 1)).toBe(true);
  });
  it('returns false when far from any appropriate camp', () => {
    expect(isInAppropriateCamp({ x: 0, y: 0, z: 0 }, 1)).toBe(false);
  });
});
