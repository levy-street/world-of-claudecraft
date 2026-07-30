import { describe, expect, it } from 'vitest';
import { HEROIC_BOSS_LOOT, NYTHRAXIS_RAID_BOSS_ID } from '../src/sim/content/heroic_loot';
import { RIFT_EPIC_ITEM_IDS, RIFT_LEGENDARY_ITEM_IDS } from '../src/sim/content/rift/items';
import { ITEMS } from '../src/sim/data';
import { canEquipItem, weaponArchetypeForItem } from '../src/sim/equipment_rules';
import {
  expectedStatBudget,
  itemLevel,
  itemSourceLevel,
  primaryStatSum,
} from '../src/sim/item_level';
import {
  RIFT_NORMAL_LOOT_SOURCE_LEVEL,
  resetRiftLootPoolCache,
  riftHeroicClearPool,
  riftNormalClearPool,
} from '../src/sim/rift/loot_pools';

const CLASSES = [
  'warrior',
  'paladin',
  'shaman',
  'rogue',
  'hunter',
  'druid',
  'mage',
  'priest',
  'warlock',
] as const;

function usableBy(ids: readonly string[], cls: string): string[] {
  return ids.filter((id) => {
    const required = ITEMS[id]?.requiredClass;
    return !required || (required as readonly string[]).includes(cls);
  });
}

describe('rift clear-loot pools', () => {
  it('the C pool is the level-20 NORMAL five-man rare/epic gear, and nothing else', () => {
    const pool = riftNormalClearPool();
    expect(pool.length).toBeGreaterThan(0);
    for (const id of pool) {
      const item = ITEMS[id];
      expect(item, id).toBeDefined();
      expect(item.slot, `${id} is equippable`).toBeTruthy();
      // Rares and epics only: an uncommon guaranteed reward would be a dead drop.
      expect(['rare', 'epic'], `${id} quality`).toContain(item.quality);
      expect(itemSourceLevel(id), `${id} source level`).toBe(RIFT_NORMAL_LOOT_SOURCE_LEVEL);
      // Normal tier: rares land at ilvl 23, epics at 26. Nothing heroic-tier.
      expect(itemLevel(item), `${id} item level`).toBeLessThanOrEqual(26);
    }
  });

  it('the B/A/S pool is the heroic FIVE-MAN epics plus the rift-signature epics', () => {
    const pool = riftHeroicClearPool();
    for (const id of pool) {
      const item = ITEMS[id];
      expect(item.quality, `${id} quality`).toBe('epic');
      // Every member reads as heroic five-man tier (source 25 -> ilvl 31). This is
      // the assertion that catches a re-pricing regression: if a rift entry ever
      // bumped an item's source level, this number would move.
      expect(itemLevel(item), `${id} item level`).toBe(31);
    }
    // Every heroic five-man epic is present.
    for (const [bossId, entries] of Object.entries(HEROIC_BOSS_LOOT)) {
      if (bossId === NYTHRAXIS_RAID_BOSS_ID) continue;
      for (const entry of entries) {
        const item = entry.itemId ? ITEMS[entry.itemId] : undefined;
        if (!item?.slot || item.quality !== 'epic') continue;
        expect(pool, `${entry.itemId} from ${bossId}`).toContain(entry.itemId);
      }
    }
    // ... and so is every rift-signature epic.
    for (const id of RIFT_EPIC_ITEM_IDS) expect(pool).toContain(id);
  });

  it('the raid tier is NOT reachable through a rift: no Nythraxis item is in either pool', () => {
    const both = new Set([...riftNormalClearPool(), ...riftHeroicClearPool()]);
    const raidIds = (HEROIC_BOSS_LOOT[NYTHRAXIS_RAID_BOSS_ID] ?? [])
      .map((entry) => entry.itemId)
      .filter((id): id is string => Boolean(id));
    expect(raidIds.length, 'the raid table is non-empty (guards a vacuous pass)').toBeGreaterThan(
      0,
    );
    for (const id of raidIds) expect(both.has(id), `${id} must not be rift-reachable`).toBe(false);
    // The pools are also disjoint from each other: C can never pay heroic gear.
    const heroic = new Set(riftHeroicClearPool());
    for (const id of riftNormalClearPool()) expect(heroic.has(id), id).toBe(false);
  });

  it('every class has real depth in both pools (the dead-clear guard)', () => {
    const normal = riftNormalClearPool();
    const heroic = riftHeroicClearPool();
    for (const cls of CLASSES) {
      // The pre-change rift table gave each class 2 epics, so a third useful drop
      // was impossible and every later S clear was dead. Six is the floor that
      // keeps a class chasing, and matches the heroic five-man spread.
      expect(usableBy(heroic, cls).length, `${cls} heroic-pool depth`).toBeGreaterThanOrEqual(6);
      expect(usableBy(normal, cls).length, `${cls} normal-pool depth`).toBeGreaterThanOrEqual(6);
    }
  });

  it('the pools are sorted and stable, which is what makes the rng pick deterministic', () => {
    const first = riftHeroicClearPool();
    const firstNormal = riftNormalClearPool();
    expect([...first]).toEqual([...first].sort());
    expect([...firstNormal]).toEqual([...firstNormal].sort());
    // Memoized: the same array identity comes back.
    expect(riftHeroicClearPool()).toBe(first);
    // ... and a rebuild after a cache reset produces the identical order.
    resetRiftLootPoolCache();
    expect([...riftHeroicClearPool()]).toEqual([...first]);
    expect([...riftNormalClearPool()]).toEqual([...firstNormal]);
  });

  it('a rift legendary weapon is either fully open or names a WHOLE proficiency group', () => {
    // Regression: voidsong_dirk shipped with the rift file's CASTER constant, which
    // is the CLOTH ARMOR group (no shaman/paladin, who wear mail/plate). Weapons are
    // proficiency-based, so that both locked two healer hybrids out of a weapon they
    // should wield AND dropped the item out of the 'caster' archetype, since
    // weaponArchetypeForItem matches a whole group exactly and returns null otherwise.
    //
    // The rule this pins is the general one: a bespoke subset is always wrong. Either
    // declare no lock at all (the stat line decides who wants it) or name a complete
    // group. A null archetype WITH a requiredClass is the exact bug signature.
    for (const id of RIFT_LEGENDARY_ITEM_IDS) {
      const item = ITEMS[id];
      if (item.kind !== 'weapon') continue;
      if (item.requiredClass === undefined) {
        expect(weaponArchetypeForItem(item), `${id} is open, so it has no archetype`).toBeNull();
        continue;
      }
      expect(
        weaponArchetypeForItem(item),
        `${id} declares requiredClass ${JSON.stringify(item.requiredClass)}, which is a bespoke subset rather than a whole proficiency group`,
      ).not.toBeNull();
    }
  });

  it('voidsong_dirk is equippable by every class: the stat line is the only gate', () => {
    // The maintainer's call: a class lock is a nerf, so an int/spi weapon stays open
    // and the useless stat block is what keeps a warrior away, not a rule.
    const item = ITEMS.voidsong_dirk;
    expect(item.requiredClass, 'no class lock').toBeUndefined();
    for (const cls of CLASSES) {
      expect(canEquipItem(cls, item), `${cls} can equip voidsong_dirk`).toBe(true);
    }
    // ... and it stays a real dagger for the rogue positional abilities.
    expect(item.kind === 'weapon' && item.weapon.dagger).toBe(true);
  });

  it('voidsong_dirk sits below the EPIC dagger floor, so no melee class is tempted', () => {
    // It carries no class lock, so a rogue may equip it and it counts as a dagger
    // for Craven Thrust / Ambush (weaponMult 1.5 multiplies weapon damage). The
    // ONLY thing keeping melee away is the weak weapon line, so pin it against the
    // real ladder rather than a hardcoded number: it must lose to the WEAKEST epic
    // dagger, not merely to the best one. Adding a weaker epic dagger, or buffing
    // this line, reds here.
    const item = ITEMS.voidsong_dirk;
    expect(item.kind).toBe('weapon');
    if (item.kind !== 'weapon') return;
    const dps = (w: { min: number; max: number; speed: number }) => (w.min + w.max) / 2 / w.speed;
    const epicDaggers = Object.values(ITEMS).filter(
      (d) =>
        d.id !== 'voidsong_dirk' && d.kind === 'weapon' && d.weapon.dagger && d.quality === 'epic',
    );
    expect(epicDaggers.length, 'the epic dagger ladder is non-empty').toBeGreaterThan(0);
    for (const other of epicDaggers) {
      if (other.kind !== 'weapon') continue;
      expect(
        dps(item.weapon),
        `voidsong_dirk dps must stay under ${other.id} (${dps(other.weapon).toFixed(1)})`,
      ).toBeLessThan(dps(other.weapon));
      // Top-end damage matters independently: Craven Thrust scales off the roll,
      // so a high max with low dps would still be a burst lure.
      expect(
        item.weapon.max,
        `voidsong_dirk max damage must stay under ${other.id} (${other.weapon.max})`,
      ).toBeLessThan(other.weapon.max);
    }
    // The stat block, by contrast, stays at FULL ilvl-37 legendary budget: the
    // nerf is aimed at melee only and must not touch what casters come for.
    expect(primaryStatSum(item)).toBe(expectedStatBudget(item));
  });

  it('the legendaries are chase-only: never in either clear pool', () => {
    const both = new Set([...riftNormalClearPool(), ...riftHeroicClearPool()]);
    for (const id of RIFT_LEGENDARY_ITEM_IDS) expect(both.has(id), id).toBe(false);
  });
});
