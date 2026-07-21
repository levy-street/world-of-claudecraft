import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS, ITEMS, CAMPS } from '../src/sim/data';

// Brutok Skullsmasher — the ogre family's rare elite in Thornpeak Heights,
// filling the ogre rare gap (ogres previously had only the Crusher elite and
// the Drogmar boss). These tests pin the content contract (a tougher named
// mob with a guaranteed quality drop and a mutually-exclusive rare chase
// group) and verify the loot roll honours it deterministically through the
// real Sim rng.

describe('rare spawn: Brutok Skullsmasher', () => {
  it('is defined as a rare elite ogre with sensible scaling', () => {
    const b = MOBS['brutok_skullsmasher'];
    expect(b).toBeTruthy();
    expect(b.rare).toBe(true);
    expect(b.elite).toBe(true);
    expect(b.family).toBe('ogre');
    // tougher than the trash ogres it prowls above (Thornpeak Crusher)
    expect(b.hpBase).toBeGreaterThan(MOBS['ogre_crusher'].hpBase);
    expect(b.respawnMult).toBeGreaterThan(1); // rares come back slowly
    // has a signature pulse mechanic
    expect(b.aoePulse?.name).toBe('Skull Smash');
  });

  it('spawns from a single-mob camp in the crags', () => {
    const camps = CAMPS.filter((c) => c.mobId === 'brutok_skullsmasher');
    expect(camps).toHaveLength(1);
    expect(camps[0].count).toBe(1);
  });

  it('every loot itemId resolves and the chase group is all rare quality', () => {
    const b = MOBS['brutok_skullsmasher'];
    for (const l of b.loot) {
      if (l.itemId) expect(ITEMS[l.itemId], `loot ${l.itemId}`).toBeTruthy();
    }
    const chase = b.loot.filter((l) => l.rollGroup === 'brutok_chase');
    expect(chase.length).toBeGreaterThanOrEqual(2);
    for (const l of chase) expect(ITEMS[l.itemId!].quality).toBe('rare');
  });

  it('always drops the guaranteed loot and at most one chase item', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true });
    const meta = [...(sim as any).players.values()][0];
    // a throwaway corpse entity to receive rolled loot
    const mob: any = { templateId: 'brutok_skullsmasher', loot: null, lootable: false };
    const chaseIds = new Set(['brutoks_maul', 'crag_warden_cudgel', 'skullsplitter_dirk']);

    for (let i = 0; i < 300; i++) {
      mob.loot = null; mob.lootable = false;
      (sim as any).rollLoot(mob, meta);
      const items: string[] = (mob.loot?.items ?? []).map((s: any) => s.itemId);
      // guaranteed entries (chance 1) are always present
      expect(items).toContain('cracked_ogre_tusk');
      expect(mob.loot.copper).toBeGreaterThan(0);
      // the rollGroup is mutually exclusive: never more than one chase item
      expect(items.filter((id) => chaseIds.has(id)).length).toBeLessThanOrEqual(1);
    }
  });
});
