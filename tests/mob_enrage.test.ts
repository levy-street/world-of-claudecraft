// Enrage frenzy: an enraged mob with a template hasteMult swings faster, not
// just harder. The damage half (dmgMult) was already applied inline in
// mobSwing; this covers the swing-speed half folded into swingIntervalMult.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { dist2d } from '../src/sim/types';
import type { Entity } from '../src/sim/types';
import { MOBS } from '../src/sim/data';

function makeSim(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true });
}

function anyMob(sim: Sim): Entity {
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead || e.ownerId !== null) continue;
    const d = dist2d(sim.player.pos, e.pos);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best!;
}

function swingMult(sim: Sim, e: Entity): number {
  return (sim as any).swingIntervalMult(e);
}

describe('enrage frenzy (swing-speed haste)', () => {
  it('an enraged mob with hasteMult swings faster than normal', () => {
    const sim = makeSim();
    const mob = anyMob(sim);
    mob.templateId = 'elder_bristleback'; // enrage: { ..., hasteMult: 1.3 }
    const haste = MOBS['elder_bristleback'].enrage!.hasteMult!;
    expect(haste).toBeGreaterThan(1);

    mob.enraged = false;
    expect(swingMult(sim, mob)).toBeCloseTo(1, 6);

    mob.enraged = true;
    expect(swingMult(sim, mob)).toBeCloseTo(1 / haste, 6);
    expect(swingMult(sim, mob)).toBeLessThan(1); // faster swings
  });

  it('does nothing when the mob is not enraged', () => {
    const sim = makeSim();
    const mob = anyMob(sim);
    mob.templateId = 'elder_bristleback';
    mob.enraged = false;
    expect(swingMult(sim, mob)).toBeCloseTo(1, 6);
  });

  it('is a no-op for an enraged mob whose template has no hasteMult', () => {
    const sim = makeSim();
    const mob = anyMob(sim);
    // forest_wolf has no enrage block at all -> no haste even if flagged
    mob.templateId = 'forest_wolf';
    expect(MOBS['forest_wolf'].enrage).toBeUndefined();
    mob.enraged = true;
    expect(swingMult(sim, mob)).toBeCloseTo(1, 6);
  });

  it('composes multiplicatively with a slow aura', () => {
    const sim = makeSim();
    const mob = anyMob(sim);
    mob.templateId = 'elder_bristleback';
    const haste = MOBS['elder_bristleback'].enrage!.hasteMult!;
    mob.enraged = true;
    // attackspeed aura: value > 1 slows (multiplies the interval)
    mob.auras.push({ kind: 'attackspeed', value: 2, name: 'Thunder Clap', remaining: 10, stacks: 1, sourceId: null } as any);
    expect(swingMult(sim, mob)).toBeCloseTo(2 / haste, 6);
  });

  it('every enrage template defines a frenzy hasteMult', () => {
    const enraged = Object.values(MOBS).filter((m) => m.enrage);
    expect(enraged.length).toBeGreaterThan(0);
    for (const m of enraged) {
      expect(m.enrage!.hasteMult, `${m.id} should frenzy`).toBeGreaterThan(1);
    }
  });
});
