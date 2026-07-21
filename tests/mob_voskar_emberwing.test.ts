import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS, CAMPS, ITEMS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';

const SEED = 1942;
const makeSim = () => new Sim({ seed: SEED, playerClass: 'warrior' });

describe('Voskar the Emberwing (rare elite dragonkin)', () => {
  it('is a rare elite dragonkin with classic rare-spawn flags', () => {
    const v = MOBS.voskar_emberwing;
    expect(v).toBeDefined();
    expect(v.family).toBe('dragonkin');
    expect(v.rare).toBe(true);
    expect(v.elite).toBe(true);
    expect(v.ccImmune).toBe(true);
    expect(v.respawnMult).toBeGreaterThan(0);
    expect(v.maxLevel).toBe(19);
  });

  it('carries a fire Ember Breath pulse, a Searing Maw bite, and an enrage', () => {
    const v = MOBS.voskar_emberwing;
    expect(v.aoePulse).toMatchObject({ name: 'Ember Breath', school: 'fire' });
    expect(v.mortalStrike).toMatchObject({ name: 'Searing Maw', school: 'fire', healReduction: 0.5 });
    expect(v.mortalStrike!.chance).toBeGreaterThan(0);
    expect(v.mortalStrike!.chance).toBeLessThanOrEqual(1);
    expect(v.enrage!.belowHpPct).toBeGreaterThan(0);
    expect(v.enrage!.dmgMult).toBeGreaterThan(1);
  });

  it('spawns as a single isolated rare in Thornpeak Heights', () => {
    const camp = CAMPS.find((c) => c.mobId === 'voskar_emberwing');
    expect(camp).toBeDefined();
    expect(camp!.count).toBe(1);
    // Thornpeak Heights occupies the z-band [540, 880]
    expect(camp!.center.z).toBeGreaterThanOrEqual(540);
    expect(camp!.center.z).toBeLessThanOrEqual(880);
  });

  it('every loot entry references a defined item', () => {
    for (const entry of MOBS.voskar_emberwing.loot) {
      if (entry.itemId) expect(ITEMS[entry.itemId], entry.itemId).toBeDefined();
    }
    // the two chase blues share one mutually-exclusive roll group
    const chase = MOBS.voskar_emberwing.loot.filter((l) => l.rollGroup === 'voskar_emberwing_chase');
    expect(chase).toHaveLength(2);
  });

  it("a landed Searing Maw swing inflicts a Mortal Wound that blunts the victim's healing", () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000;
    p.hp = 100000; // survive every swing so we can observe the debuff
    const saved = MOBS.voskar_emberwing.mortalStrike!.chance;
    MOBS.voskar_emberwing.mortalStrike!.chance = 1; // force the proc
    try {
      const mob = createMob(940700, MOBS.voskar_emberwing, 19, { x: 0, y: 0, z: 0 });
      let applied = false;
      for (let i = 0; i < 60 && !applied; i++) {
        (sim as any).mobSwing(mob, p);
        applied = p.auras.some((a) => a.kind === 'mortal_wound');
      }
      expect(applied).toBe(true);
      const a = p.auras.find((x) => x.kind === 'mortal_wound')!;
      expect(a.name).toBe('Searing Maw');
      expect(a.value).toBe(0.5);
    } finally {
      MOBS.voskar_emberwing.mortalStrike!.chance = saved;
    }
  });
});
