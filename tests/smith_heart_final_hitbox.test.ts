// The Masterless Strength's body (the team's playtest of 2026-11-25: "make
// the boss hitbox bigger: melee feel in range when they aren't"). The
// template authors a bodyRadius, so melee reaches its edge (3 yd past it),
// its own swing a yard further, it settles on its tank just past the edge,
// and its target circle is drawn at that edge; its frontal (Forge Fist and
// Mythic's Numbing Frost off it) keeps its own 9 yd from the pivot.

import { describe, expect, it } from 'vitest';
import {
  BODY_EDGE_RINGS,
  SELECTION_RING_OUTER,
  selectionRingScale,
} from '../src/render/selection_ring';
import {
  BODY_EDGE_MELEE_REACH,
  effectivePlayerAttackRange,
} from '../src/sim/combat/player_attack_reach';
import { SMITH_HEART_FINAL_BOSS } from '../src/sim/content/smith_heart';
import { MOBS } from '../src/sim/data';
import { FINAL_BODY_RADIUS, FINAL_DIFFICULTY } from '../src/sim/encounters/smith_heart/final_ids';
import { inFrontal } from '../src/sim/encounters/smith_heart/final_quench';
import type { FinalScope } from '../src/sim/encounters/smith_heart/final_scope';
import { combatProfileForMob } from '../src/sim/mob_combat';
import { MELEE_RANGE } from '../src/sim/types';
import { finalFight } from './helpers/final_fight';

const boss = { kind: 'mob', templateId: SMITH_HEART_FINAL_BOSS };

describe("the Masterless Strength's body", () => {
  it('authors a body the melee reach is measured from', () => {
    const tpl = MOBS[SMITH_HEART_FINAL_BOSS];
    expect(tpl.bodyRadius).toBe(FINAL_BODY_RADIUS);
    // Bigger than the stock 5 yd from the pivot it had: 8 yd now.
    expect(effectivePlayerAttackRange(boss, MELEE_RANGE)).toBe(
      FINAL_BODY_RADIUS + BODY_EDGE_MELEE_REACH,
    );
    expect(FINAL_BODY_RADIUS + BODY_EDGE_MELEE_REACH).toBeGreaterThan(MELEE_RANGE + 2.5);
    // Its swing reaches a yard past where melee reaches it, and it settles on
    // its tank just past its edge (was 10 yd off its pivot: out of the tank's reach).
    const prof = combatProfileForMob(SMITH_HEART_FINAL_BOSS, tpl.scale ?? 1);
    expect(prof.meleeRange).toBeGreaterThanOrEqual(FINAL_BODY_RADIUS + BODY_EDGE_MELEE_REACH + 1);
    expect(prof.desiredRange).toBeCloseTo(FINAL_BODY_RADIUS + 1.5, 6);
    expect(prof.desiredRange).toBeLessThan(FINAL_BODY_RADIUS + BODY_EDGE_MELEE_REACH);
  });

  it('its frontal keeps its own 9 yd from the pivot', () => {
    const f = finalFight(5);
    f.pullIn('quench');
    const b = f.boss();
    const st = f.state();
    if (!st) throw new Error('no fight');
    const s: FinalScope = {
      ctx: f.sim.ctx,
      inst: f.inst,
      st,
      boss: b,
      players: f.players,
      rules: FINAL_DIFFICULTY.mythic,
    };
    const at = f.local(b);
    const ahead = (d: number) => ({
      x: at.x + Math.sin(b.facing) * d,
      z: at.z + Math.cos(b.facing) * d,
    });
    const p = f.players[2];
    const range = MOBS[SMITH_HEART_FINAL_BOSS].arcCleave?.range ?? 0;
    expect(range).toBe(9);
    // Park the rest well behind it, then walk one raider out along its front.
    f.players.forEach((q, i) => {
      if (q !== p) f.put(q, at.x - Math.sin(b.facing) * (20 + i), at.z - Math.cos(b.facing) * 20);
    });
    let spot = ahead(range - 0.6);
    f.put(p, spot.x, spot.z);
    expect(inFrontal(s).map((e) => e.id)).toContain(p.id);
    spot = ahead(range + 1.5);
    f.put(p, spot.x, spot.z);
    expect(inFrontal(s).map((e) => e.id)).not.toContain(p.id);
  });

  it('draws its target circle at its body edge, and no other circle moves', () => {
    const tpl = MOBS[SMITH_HEART_FINAL_BOSS];
    const scale = tpl.scale ?? 1;
    expect(BODY_EDGE_RINGS[SMITH_HEART_FINAL_BOSS]).toBe(FINAL_BODY_RADIUS);
    const ring = selectionRingScale(scale, 20, SMITH_HEART_FINAL_BOSS);
    expect(ring * SELECTION_RING_OUTER).toBeCloseTo(FINAL_BODY_RADIUS, 6);
    // Bigger than the circle it had at its scale alone.
    expect(ring).toBeGreaterThan(selectionRingScale(scale, 20));
    expect(selectionRingScale(2.25, 2.2, 'heart_quench_guardian')).toBeCloseTo(2.25, 6);
    expect(selectionRingScale(1, 1.8, 'wolf')).toBeCloseTo(1, 6);
  });
});
