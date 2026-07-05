import { describe, expect, it } from 'vitest';
import { CAMPS, ITEMS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';

// Sloomtooth the Drowned — a rare elite murloc tyrant lurking by the Drowned
// Chapel in Mirefen Marsh (content-integrity coverage for the new rare).
describe('Sloomtooth the Drowned (rare elite)', () => {
  it('is registered as a rare elite murloc at level 11', () => {
    const m = MOBS.sloomtooth_the_drowned;
    expect(m).toBeDefined();
    expect(m.family).toBe('mudfin');
    expect(m.rare).toBe(true);
    expect(m.elite).toBe(true);
    expect(m.minLevel).toBe(11);
    expect(m.maxLevel).toBe(11);
  });

  it('carries its two signature mechanics', () => {
    const m = MOBS.sloomtooth_the_drowned;
    expect(m.cleave).toEqual({ radius: 8, mult: 0.5, name: 'Tidal Sweep' });
    expect(m.desperateHeal).toEqual({ belowHpPct: 0.3, healPct: 0.25 });
  });

  it('only drops one of its three class chase weapons per kill', () => {
    const chase = MOBS.sloomtooth_the_drowned.loot.filter(
      (l) => l.rollGroup === 'sloomtooth_chase',
    );
    expect(chase.map((l) => l.itemId)).toEqual([
      'tidereaver_gaff',
      'sloomtooth_tidefang',
      'drowned_tide_scepter',
    ]);
  });

  it('references only loot items that actually exist', () => {
    for (const l of MOBS.sloomtooth_the_drowned.loot) {
      if (l.itemId) expect(ITEMS[l.itemId], `missing item ${l.itemId}`).toBeDefined();
    }
  });

  it('drops rare mainhand weapons, one per archetype', () => {
    const drops = ['tidereaver_gaff', 'sloomtooth_tidefang', 'drowned_tide_scepter'].map(
      (id) => ITEMS[id],
    );
    for (const d of drops) {
      expect(d.quality).toBe('rare');
      expect(d.slot).toBe('mainhand');
      expect(d.weapon).toBeDefined();
      expect(d.requiredClass).toBeDefined();
    }
    // warrior / rogue / mage archetypes are mutually exclusive
    expect(drops[0].requiredClass).toContain('warrior');
    expect(drops[1].requiredClass).toContain('rogue');
    expect(drops[2].requiredClass).toContain('mage');
  });

  it('is spawned exactly once, near the Drowned Chapel', () => {
    const camps = CAMPS.filter((c) => c.mobId === 'sloomtooth_the_drowned');
    expect(camps).toHaveLength(1);
    expect(camps[0].count).toBe(1);
    // Drowned Chapel sits around (100, 435); the rare lurks in its shallows.
    expect(camps[0].center.z).toBeGreaterThan(420);
  });

  it('actually surges back to life the first time it is brought low', () => {
    const sim = new Sim({ seed: 20061, playerClass: 'warrior' });
    const mob = createMob(990201, MOBS.sloomtooth_the_drowned, 11, { x: 0, y: 0, z: 0 });
    mob.hp = Math.round(mob.maxHp * 0.25);
    mob.inCombat = true;
    const before = mob.hp;
    (sim as unknown as { updateBossMechanics(m: typeof mob): void }).updateBossMechanics(mob);
    expect(mob.hp).toBe(before + Math.round(mob.maxHp * 0.25));
  });
});
