import { describe, expect, it } from 'vitest';
import { CAMPS, ITEMS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';

describe('Old Cragmaw - rare elite ridge beast (Thornpeak Heights)', () => {
  it('is registered as a rare elite beast at the ridge entry level', () => {
    const m = MOBS.old_cragmaw;
    expect(m).toBeTruthy();
    expect(m.name).toBe('Old Cragmaw');
    expect(m.family).toBe('beast');
    expect(m.rare).toBe(true);
    expect(m.elite).toBe(true);
    expect(m.minLevel).toBe(14);
    expect(m.maxLevel).toBe(14);
  });

  it('carries only existing, composable mechanics (a rending pounce + wounded enrage)', () => {
    const m = MOBS.old_cragmaw;
    expect(m.aoePulse).toMatchObject({ name: 'Savage Pounce', school: 'physical' });
    expect(m.enrage).toMatchObject({ belowHpPct: 0.35, dmgMult: 1.4, hasteMult: 1.3 });
  });

  it('drops its unique rare boots and every loot itemId resolves', () => {
    const m = MOBS.old_cragmaw;
    const drop = m.loot.find((l) => l.itemId === 'cragmaw_prowlboots');
    expect(drop).toBeTruthy();
    expect(drop?.chance).toBeGreaterThan(0);
    for (const l of m.loot) {
      if (l.itemId) expect(ITEMS[l.itemId], `loot item ${l.itemId} must exist`).toBeTruthy();
    }

    const boots = ITEMS.cragmaw_prowlboots;
    expect(boots).toMatchObject({ kind: 'armor', slot: 'feet', quality: 'rare' });
    // A clear upgrade over the uncommon Ridgestalker Treads it sits beside.
    const bootsArmor = boots.stats?.armor;
    const treadsArmor = ITEMS.ridgestalker_treads.stats?.armor;
    expect(bootsArmor).toBeDefined();
    expect(treadsArmor).toBeDefined();
    expect(bootsArmor ?? 0).toBeGreaterThan(treadsArmor ?? 0);
  });

  it('guarantees a unique boss trophy distinct from the shared quest pelt', () => {
    const m = MOBS.old_cragmaw;
    const sharedQuestPelt = m.loot.find((l) => l.itemId === 'ridge_stalker_pelt');
    expect(sharedQuestPelt).toBeUndefined();

    const trophy = m.loot.find((l) => l.itemId === 'old_cragmaws_pelt');
    expect(trophy).toBeTruthy();
    expect(trophy?.chance).toBe(1); // always rewards a kill of the rare elite

    const pelt = ITEMS.old_cragmaws_pelt;
    expect(pelt.name).toBe("Old Cragmaw's Pelt");
    expect(pelt).toMatchObject({ kind: 'junk', quality: 'common' });
    expect(pelt.sellValue).toBeGreaterThan(0);
    // It is a pure vendor trophy, not the q_stalker_pelts turn-in pelt the trash mob shares.
    expect(pelt.questId).toBeUndefined();
    expect(ITEMS.ridge_stalker_pelt.kind).toBe('quest');
  });

  it('offers a chance at a waist piece that pairs with the prowlboots', () => {
    const m = MOBS.old_cragmaw;
    const drop = m.loot.find((l) => l.itemId === 'cragmaw_huntcord');
    expect(drop).toBeTruthy();
    expect(drop?.chance).toBeGreaterThan(0);
    expect(drop?.chance).toBeLessThan(1); // rarer than the guaranteed trophy

    const belt = ITEMS.cragmaw_huntcord;
    expect(belt).toMatchObject({ kind: 'armor', slot: 'waist', quality: 'rare' });
    // Agility-leaning leather, like the boots; waist armor sits under the feet slot.
    const beltAgility = belt.stats?.agi;
    const beltArmor = belt.stats?.armor;
    const bootsArmor = ITEMS.cragmaw_prowlboots.stats?.armor;
    expect(beltAgility).toBeDefined();
    expect(beltArmor).toBeDefined();
    expect(bootsArmor).toBeDefined();
    expect(beltAgility ?? 0).toBeGreaterThan(0);
    expect(beltArmor ?? 0).toBeLessThan(bootsArmor ?? 0);
  });

  it('has exactly one lone overworld spawn placed on the Thornpeak ridge', () => {
    const camps = CAMPS.filter((c) => c.mobId === 'old_cragmaw');
    expect(camps).toHaveLength(1);
    expect(camps[0].count).toBe(1);
    expect(camps[0].center.z).toBeGreaterThanOrEqual(540); // inside Thornpeak (zMin 540)
  });

  it('spawns into a live sim with elite-scaled health above a normal Ridge Stalker', () => {
    const cragmaw = createMob(1, MOBS.old_cragmaw, 14, { x: 0, y: 0, z: 560 });
    const stalker = createMob(2, MOBS.ridge_stalker, 14, {
      x: 4,
      y: 0,
      z: 560,
    });
    // Elite scaling (~2.3x health) puts Cragmaw well above a normal Ridge Stalker.
    expect(cragmaw.maxHp).toBeGreaterThan(stalker.maxHp * 2);
  });
});
