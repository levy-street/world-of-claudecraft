// The Guardian of the Quench's reach at her own model's size (sim, design doc
// 7.3): she stands some eleven yards tall (render/smith_heart_fx/
// quench_body_core.ts), so melee strikes the column of her gown round her hips
// (her bodyRadius) rather than her pivot, short-reach abilities measure to that
// edge too, and her own fists settle the tank at the body's edge, inside the
// reach of her arms as drawn.

import { describe, expect, it } from 'vitest';
import {
  QUENCH_BODY_SCALE,
  QUENCH_SOCKETS,
  QUENCH_YD_PER_UNIT,
} from '../src/render/smith_heart_fx/quench_body_core';
import {
  BODY_EDGE_MELEE_REACH,
  effectivePlayerAttackRange,
} from '../src/sim/combat/player_attack_reach';
import { SMITH_HEART_MOBS } from '../src/sim/content/smith_heart';
import { insideRimewall } from '../src/sim/encounters/smith_heart/quench_geometry';
import { QUENCH_BODY_RADIUS, QUENCH_GUARDIAN } from '../src/sim/encounters/smith_heart/quench_ids';
import { combatProfileForMob, scaledDefaultMobMeleeRange } from '../src/sim/mob_combat';
import { MELEE_RANGE } from '../src/sim/types';
import { quenchFight } from './helpers/quench_fight';

const target = { kind: 'mob', templateId: QUENCH_GUARDIAN };

describe('the Guardian of the Quench reaches as big as she is drawn', () => {
  it('authors her body radius', () => {
    expect(SMITH_HEART_MOBS[QUENCH_GUARDIAN].bodyRadius).toBe(QUENCH_BODY_RADIUS);
    expect(SMITH_HEART_MOBS[QUENCH_GUARDIAN].scale).toBe(QUENCH_BODY_SCALE);
  });

  it('is struck from her body edge, her taunts too', () => {
    expect(effectivePlayerAttackRange(target, MELEE_RANGE)).toBe(
      QUENCH_BODY_RADIUS + BODY_EDGE_MELEE_REACH,
    );
    expect(effectivePlayerAttackRange(target, 8)).toBe(8 + QUENCH_BODY_RADIUS);
    // A long-range spell keeps its own range.
    expect(effectivePlayerAttackRange(target, 30)).toBe(30);
  });

  it('settles her tank at the body edge, inside the reach of her fists', () => {
    const p = combatProfileForMob(QUENCH_GUARDIAN, QUENCH_BODY_SCALE);
    expect(p.meleeRange).toBeGreaterThan(QUENCH_BODY_RADIUS + BODY_EDGE_MELEE_REACH);
    expect(p.desiredRange).toBe(QUENCH_BODY_RADIUS + 1.5);
    // Her hand's rest place out from her axis (the T-pose's reach).
    const hand = QUENCH_SOCKETS.find((s) => s.id === 'handL');
    const fistReach = Math.hypot(hand?.at[0] ?? 0, hand?.at[2] ?? 0) * QUENCH_YD_PER_UNIT;
    expect(p.desiredRange).toBeLessThan(fistReach);
    expect(p.desiredRange).toBeLessThan(scaledDefaultMobMeleeRange(QUENCH_BODY_SCALE));
  });
});

describe('in the fight, the tighter settle keeps her on her lake', () => {
  it('follows her tank across the ice and never past the shore ice', () => {
    const f = quenchFight(4);
    expect(f.dev('/dev heart quench pull')).toBe(true);
    const tank = f.players[0];
    const g0 = f.local(f.boss());
    f.put(tank, g0.x - 12, g0.z);
    for (let i = 0; i < 20 * 8; i++) {
      f.tick(1);
      const g = f.local(f.boss());
      expect(insideRimewall(g.x, g.z), `tick ${i}`).toBe(true);
    }
  });
});
