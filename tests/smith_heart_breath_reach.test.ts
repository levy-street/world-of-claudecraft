// The Guardian of the Breath's reach at its own model's size (sim, design doc
// 7.2): the model stands some thirteen yards tall (render/smith_heart_fx/
// breath_body_core.ts), so melee strikes the column of wind round its chest
// and tail (its bodyRadius) rather than its pivot, short-reach abilities
// measure to that edge too, and its own swing settles the tank at the body's
// edge instead of pawing from ten yards out.

import { describe, expect, it } from 'vitest';
import {
  BREATH_BODY_HEIGHT,
  BREATH_BODY_SCALE,
  BREATH_SOCKETS,
  BREATH_YD_PER_UNIT,
} from '../src/render/smith_heart_fx/breath_body_core';
import {
  BODY_EDGE_MELEE_REACH,
  effectivePlayerAttackRange,
} from '../src/sim/combat/player_attack_reach';
import { SMITH_HEART_MOBS } from '../src/sim/content/smith_heart';
import { inBreathArena } from '../src/sim/encounters/smith_heart/breath_geometry';
import { BREATH_BODY_RADIUS, BREATH_GUARDIAN } from '../src/sim/encounters/smith_heart/breath_ids';
import { combatProfileForMob, scaledDefaultMobMeleeRange } from '../src/sim/mob_combat';
import { MELEE_RANGE } from '../src/sim/types';
import { breathFight } from './helpers/breath_fight';

const target = { kind: 'mob', templateId: BREATH_GUARDIAN };

describe('the Guardian of the Breath reaches as big as it is drawn', () => {
  it('authors its body radius', () => {
    expect(SMITH_HEART_MOBS[BREATH_GUARDIAN].bodyRadius).toBe(BREATH_BODY_RADIUS);
    expect(SMITH_HEART_MOBS[BREATH_GUARDIAN].scale).toBe(BREATH_BODY_SCALE);
  });

  it('is struck from its body edge, its taunts too', () => {
    expect(effectivePlayerAttackRange(target, MELEE_RANGE)).toBe(
      BREATH_BODY_RADIUS + BODY_EDGE_MELEE_REACH,
    );
    expect(effectivePlayerAttackRange(target, 8)).toBe(8 + BREATH_BODY_RADIUS);
    // A long-range spell keeps its own range.
    expect(effectivePlayerAttackRange(target, 30)).toBe(30);
  });

  it('settles its tank at the body edge and still out-reaches the melee on it', () => {
    const p = combatProfileForMob(BREATH_GUARDIAN, BREATH_BODY_SCALE);
    expect(p.meleeRange).toBe(scaledDefaultMobMeleeRange(BREATH_BODY_SCALE));
    expect(p.meleeRange).toBeGreaterThan(BREATH_BODY_RADIUS + BODY_EDGE_MELEE_REACH);
    expect(p.desiredRange).toBe(BREATH_BODY_RADIUS + 1.5);
    // Inside the reach of its own claws as drawn (the hand's rest place out
    // from its axis), never pawing from ten yards out as before.
    const hand = BREATH_SOCKETS.find((s) => s.id === 'clawL');
    const clawReach = Math.hypot(hand?.at[0] ?? 0, hand?.at[2] ?? 0) * BREATH_YD_PER_UNIT;
    expect(p.desiredRange).toBeLessThan(clawReach);
    expect(p.desiredRange).toBeLessThan(scaledDefaultMobMeleeRange(BREATH_BODY_SCALE) * 0.8);
  });

  it('keeps its body radius inside the column it draws', () => {
    // The pauldrons span the widest point of the body (about 2.9 model units
    // either side); the radius stays inside them.
    const shoulder = BREATH_SOCKETS.find((s) => s.id === 'shoulderL');
    expect(BREATH_BODY_RADIUS).toBeLessThan((shoulder?.at[0] ?? 0) * BREATH_YD_PER_UNIT * 1.3);
    expect(BREATH_BODY_HEIGHT * BREATH_BODY_SCALE).toBeGreaterThan(BREATH_BODY_RADIUS * 4);
  });
});

describe('in the fight, the tighter settle never drags it off its ground', () => {
  it('follows its tank across the Cornice and never off the floor', () => {
    const f = breathFight(4);
    expect(f.dev('/dev heart breath pull')).toBe(true);
    const tank = f.players[0];
    const g0 = f.local(f.boss());
    f.put(tank, g0.x - 14, g0.z);
    for (let i = 0; i < 20 * 8; i++) {
      f.tick(1);
      const g = f.local(f.boss());
      expect(inBreathArena(g.x, g.z), `tick ${i}`).toBe(true);
    }
  });
});
