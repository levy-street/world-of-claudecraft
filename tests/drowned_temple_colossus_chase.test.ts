// The Tideglass Colossus walks (sixth pass): it chases its foe across the
// Prism Terrace like any boss, plants its feet while a bar runs (so the
// Moonlight Lance's lane and the Resonant Slam's ring land where they were
// drawn), never steps off its terrace, and its Reflections still rise beside
// their owners wherever the fight has moved.

import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import {
  COLOSSUS_ID,
  COLOSSUS_MOONLIGHT_LANCE,
  COLOSSUS_TUNING,
  REFLECTION_ID,
  TERRACE,
} from '../src/sim/encounters/drowned_temple';
import { dist2d, type Entity } from '../src/sim/types';
import { boss, engage, type Fight, fight, local, put, run, until } from './helpers/temple_fight';

function colossusFight(): { f: Fight; b: Entity } {
  const f = fight();
  const b = boss(f, COLOSSUS_ID);
  put(f, f.tank, TERRACE.x - 14, TERRACE.z - 6);
  put(f, f.others[0], TERRACE.x + 10, TERRACE.z - 10);
  put(f, f.others[1], TERRACE.x + 10, TERRACE.z + 10);
  engage(f, b);
  return { f, b };
}

describe('the Tideglass Colossus chases its foe across the Prism Terrace', () => {
  it('is a walking boss, with a long reach for its size', () => {
    const t = MOBS[COLOSSUS_ID];
    expect(t.moveSpeed).toBeGreaterThan(0);
    expect(t.idleStationary).not.toBe(true);
    // A giant's arms: the reach grows with the template scale.
    expect(t.scale).toBeGreaterThanOrEqual(2);
  });

  it('walks after the tank instead of turning on its plinth', () => {
    const { f, b } = colossusFight();
    const start = dist2d(b.pos, f.tank.pos);
    run(f, 4, () => put(f, f.tank, TERRACE.x - 14, TERRACE.z - 6));
    expect(dist2d(b.pos, f.tank.pos)).toBeLessThan(start - 5);
    expect(b.aiState).toBe('attack');
  });

  it('plants its feet while the Moonlight Lance bar runs', () => {
    const { f, b } = colossusFight();
    const casting = until(
      f,
      () => b.castingAbility === COLOSSUS_MOONLIGHT_LANCE,
      20,
      () => put(f, f.tank, TERRACE.x - 14, TERRACE.z - 6),
    );
    expect(casting).toBe(true);
    const at = local(f, b);
    // The tank runs round it while the bar runs: it does not follow.
    run(f, COLOSSUS_TUNING.lanceCast - 0.2, () => put(f, f.tank, TERRACE.x + 14, TERRACE.z + 8));
    const now = local(f, b);
    expect(Math.hypot(now.x - at.x, now.z - at.z)).toBeLessThan(0.05);
  });

  it('never steps off the Prism Terrace, however far the tank runs', () => {
    const { f, b } = colossusFight();
    // Down the approach stair, past the terrace rim.
    run(f, 12, () => put(f, f.tank, 79, 176));
    const at = local(f, b);
    expect(Math.hypot(at.x - TERRACE.x, at.z - TERRACE.z)).toBeLessThanOrEqual(TERRACE.r);
    expect(b.dead).toBe(false);
  });

  it('raises each Reflection beside its owner wherever the fight has walked to', () => {
    const { f, b } = colossusFight();
    run(f, 3, () => put(f, f.tank, TERRACE.x - 14, TERRACE.z - 6));
    b.hp = Math.floor(b.maxHp * 0.74);
    run(f, COLOSSUS_TUNING.flareCast + 0.4);
    const refl = [...f.sim.ctx.entities.values()].filter(
      (e) => !e.dead && e.templateId.startsWith(REFLECTION_ID),
    );
    expect(refl).toHaveLength(3);
    for (const r of refl) {
      const owner = f.sim.ctx.entities.get(r.mirrorOwnerId as number) as Entity;
      expect(dist2d(r.pos, owner.pos)).toBeLessThan(8);
    }
  });
});
