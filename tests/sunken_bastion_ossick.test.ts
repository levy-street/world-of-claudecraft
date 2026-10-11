// Gaoler Ossick (src/sim/encounters/sunken_bastion/ossick.ts): the Drowned Anchor
// (the drag toward the Drowning Pit and the chain the group breaks) and the
// Shackle Pair (the distance bite), their heroic extras, the wipe and the deed.

import { describe, expect, it, vi } from 'vitest';
import {
  anchorDragSpeed,
  bastionWardHitPoints,
  DROWNED_ANCHOR_ID,
  OSSICK_ANCHOR,
  OSSICK_ANCHOR_MARK,
  OSSICK_ANCHORED,
  OSSICK_ID,
  OSSICK_KEELHAULED,
  OSSICK_SHACKLE,
  OSSICK_SHACKLED,
  OSSICK_TUNING,
  PIT_RIM,
  shackleStrained,
  WINCH,
} from '../src/sim/encounters/sunken_bastion';
import { DT, type Entity } from '../src/sim/types';
import {
  aura,
  boss,
  earned,
  engage,
  type Fight,
  fight,
  put,
  run,
  took,
  until,
} from './helpers/bastion_fight';

// Whole-fight scenarios over many sim ticks: room for a loaded worker.
vi.setConfig({ testTimeout: 60_000 });

// ---------------------------------------------------------------------------
describe('Gaoler Ossick: the Drowned Anchor and the Shackle Pair', () => {
  function yard(difficulty: 'normal' | 'heroic' = 'normal'): { f: Fight; ossick: Entity } {
    const f = fight(difficulty);
    const ossick = boss(f, OSSICK_ID);
    put(f, ossick, -2, 12);
    put(f, f.tank, -2, 9);
    // On the yard's axes, 18 yd out: no haul toward the winch from here passes
    // within reach of a Mooring Post (they stand on the diagonals).
    const spots = [
      [-2, 42],
      [16, 24],
      [-20, 24],
    ];
    for (const [i, p] of f.others.entries()) put(f, p, spots[i][0], spots[i][1]);
    engage(f, ossick);
    return { f, ossick };
  }

  function winchDist(f: Fight, p: Entity): number {
    return Math.hypot(p.pos.x - f.ox - WINCH.x, p.pos.z - f.oz - WINCH.z);
  }

  function anchored(f: Fight): { victim: Entity; anchor: Entity } {
    run(f, OSSICK_TUNING.anchorFirst + OSSICK_TUNING.anchorCast + DT * 3);
    const victim = f.others.find((p) => aura(p, OSSICK_ANCHORED));
    if (!victim) throw new Error('nobody anchored');
    const anchor = f.sim.ctx.entities.get(aura(victim, OSSICK_ANCHORED)?.sourceId ?? -1);
    if (!anchor) throw new Error('no anchor');
    return { victim, anchor };
  }

  it('marks a non-tank through a 1.8 s bar, then hooks them with a 12-link anchor', () => {
    const { f, ossick } = yard();
    run(f, OSSICK_TUNING.anchorFirst + DT * 2);
    expect(ossick.castingAbility).toBe(OSSICK_ANCHOR);
    const marked = f.others.find((p) => aura(p, OSSICK_ANCHOR_MARK));
    expect(marked).toBeDefined();
    expect(aura(f.tank, OSSICK_ANCHOR_MARK)).toBeUndefined();
    run(f, OSSICK_TUNING.anchorCast);
    const a = aura(marked as Entity, OSSICK_ANCHORED);
    // A tether, not a root: the victim keeps their feet.
    expect(a?.kind).toBe('forced_move');
    expect(a?.unbreakableControl).toBe(true);
    const anchor = f.sim.ctx.entities.get(a?.sourceId ?? -1);
    expect(anchor?.templateId).toBe(DROWNED_ANCHOR_ID);
    expect(anchor?.maxHp).toBe(OSSICK_TUNING.anchorHits);
  });

  it('the winch waits out the settle, then hauls about 8 s from anywhere to the rim', () => {
    const { f } = yard();
    const { victim } = anchored(f);
    const d0 = winchDist(f, victim);
    run(f, OSSICK_TUNING.anchorSettle - 0.3);
    expect(winchDist(f, victim)).toBeCloseTo(d0, 1);
    // The speed is set so the rim is about dragSeconds away from here.
    expect(anchorDragSpeed(d0, false)).toBeCloseTo((d0 - PIT_RIM) / OSSICK_TUNING.dragSeconds, 5);
    run(f, 3);
    const d1 = winchDist(f, victim);
    expect(d1).toBeLessThan(d0 - 2);
    expect(aura(victim, OSSICK_ANCHORED)).toBeDefined();
  });

  it('breaking the chain (twelve hits from anyone) frees the victim before the pit', () => {
    const { f } = yard();
    const { victim, anchor } = anchored(f);
    expect(bastionWardHitPoints(f.tank, anchor)).toBe(1);
    run(f, OSSICK_TUNING.anchorSettle + 1);
    for (let k = 0; k < OSSICK_TUNING.anchorHits; k++) {
      const hitter = k % 2 === 0 ? f.tank : victim;
      f.sim.dealDamage(hitter, anchor, 999, false, 'physical', 'Strike', 'hit', false);
    }
    run(f, DT * 2);
    expect(aura(victim, OSSICK_ANCHORED)).toBeUndefined();
    const d = winchDist(f, victim);
    run(f, 2);
    expect(winchDist(f, victim)).toBeCloseTo(d, 1);
    expect(aura(victim, OSSICK_KEELHAULED)).toBeUndefined();
  });

  it('unbroken, the chain drags them into the pit: 60 percent, a stun, and no deed', () => {
    const { f, ossick } = yard();
    const { victim } = anchored(f);
    const from = f.hits.length;
    const fell = until(f, () => aura(victim, OSSICK_KEELHAULED) !== undefined, 14);
    expect(fell).toBe(true);
    expect(winchDist(f, victim)).toBeLessThanOrEqual(PIT_RIM + 0.05);
    expect(took(f, victim, 'Drowning Pit', from)).toBeGreaterThanOrEqual(
      Math.round(victim.maxHp * OSSICK_TUNING.pitShare) - 1,
    );
    f.sim.ctx.handleDeath(ossick, f.tank);
    run(f, DT * 2);
    expect(earned(f, f.tank, 'dgn_ossick_moored')).toBe(false);
  });

  it('heroic: the landing crushes everyone near the victim, and the chain is heavier', () => {
    const { f } = yard('heroic');
    run(f, OSSICK_TUNING.anchorFirst + DT * 2);
    const marked = f.others.find((p) => aura(p, OSSICK_ANCHOR_MARK)) as Entity;
    const near = f.others.find((p) => p !== marked) as Entity;
    const far = f.others.find((p) => p !== marked && p !== near) as Entity;
    const at = { x: marked.pos.x - f.ox, z: marked.pos.z - f.oz };
    const hold = () => {
      put(f, marked, at.x, at.z);
      put(f, near, at.x + 3, at.z);
      put(f, far, at.x - 14, at.z);
    };
    const from = f.hits.length;
    run(f, OSSICK_TUNING.anchorCast + DT, hold);
    expect(took(f, near, 'Anchor Crash', from)).toBeGreaterThan(0);
    expect(took(f, far, 'Anchor Crash', from)).toBe(0);
    expect(took(f, marked, 'Anchor Crash', from)).toBe(0);
    const anchor = f.sim.ctx.entities.get(aura(marked, OSSICK_ANCHORED)?.sourceId ?? -1);
    expect(anchor?.maxHp).toBe(OSSICK_TUNING.anchorHitsHeroic);
  });

  it('the Shackle Pair chains two players; only a stretched chain bites, both of them', () => {
    const { f, ossick } = yard();
    ossick.bastionFight = undefined;
    run(f, DT * 2);
    const st = ossick.bastionFight as Entity['bastionFight'];
    if (st?.kind !== 'ossick') throw new Error('no fight');
    st.anchorTimer = 999;
    st.shackleTimer = 0;
    run(f, DT * 2);
    expect(ossick.castingAbility).toBe(OSSICK_SHACKLE);
    run(f, OSSICK_TUNING.shackleCast + DT);
    const pair = [f.tank, ...f.others].filter((p) => aura(p, OSSICK_SHACKLED));
    expect(pair).toHaveLength(2);
    const [a, b] = pair;
    expect(aura(a, OSSICK_SHACKLED)?.sourceId).toBe(b.id);
    expect(aura(b, OSSICK_SHACKLED)?.sourceId).toBe(a.id);
    // Close together: no strain.
    const close = () => {
      put(f, a, -10, 36);
      put(f, b, -4, 36);
    };
    const calm = f.hits.length;
    run(f, 2.2, close);
    expect(took(f, a, 'Shackle Strain', calm)).toBe(0);
    expect(took(f, b, 'Shackle Strain', calm)).toBe(0);
    // Stretched past 8 yd: both bleed every second.
    const apart = () => {
      put(f, a, -14, 36);
      put(f, b, 2, 36);
    };
    const tense = f.hits.length;
    run(f, 2.2, apart);
    expect(took(f, a, 'Shackle Strain', tense)).toBeGreaterThan(0);
    expect(took(f, b, 'Shackle Strain', tense)).toBeGreaterThan(0);
    expect(shackleStrained(7, false)).toBe(false);
    expect(shackleStrained(7, true)).toBe(true);
    run(f, OSSICK_TUNING.shackleSeconds);
    expect(aura(a, OSSICK_SHACKLED)).toBeUndefined();
  });

  it('a wipe drops the anchors and shackles; a clean kill earns Safe Harbor', () => {
    const { f, ossick } = yard();
    const { victim, anchor } = anchored(f);
    ossick.aiState = 'evade';
    run(f, DT * 2);
    expect(aura(victim, OSSICK_ANCHORED)).toBeUndefined();
    expect(f.sim.ctx.entities.has(anchor.id)).toBe(false);
    const again = yard();
    run(again.f, 1);
    again.f.sim.ctx.handleDeath(again.ossick, again.f.tank);
    run(again.f, DT * 2);
    expect(earned(again.f, again.f.tank, 'dgn_ossick_moored')).toBe(true);
  });
});
