// Heroic loot flair: when a mob dies in a HEROIC dungeon instance, its normal
// epic/rare drops are swapped for a "Heroic" variant (epic -> item level 28,
// rare -> 25, same name as the base with an "[HEROIC]" tooltip tag), while
// green/uncommon drops and the existing
// item-level-31 heroic set are untouched.
import { describe, expect, it } from 'vitest';
import { heroicVariantId } from '../src/sim/content/heroic_variants';
import { ITEMS, MOBS } from '../src/sim/data';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { TWOHAND_DPS_MULT, weaponDpsBudget } from '../src/sim/item_budget';
import { expectedStatBudget, itemLevel, primaryStatSum } from '../src/sim/item_level';
import { Sim } from '../src/sim/sim';
import type { Entity, ItemDef } from '../src/sim/types';
import { itemDisplayName } from '../src/ui/entity_i18n';

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

const variants = () => Object.values(ITEMS).filter((i) => i.heroicOf);
const weaponPower = (item: ItemDef) => {
  const weapon = item.weapon;
  return weapon ? (weapon.min + weapon.max) / 2 / weapon.speed : null;
};

describe('heroic loot flair: variant generation', () => {
  it('generates a Heroic variant for base epic/rare/legendary drops at or above its tier budget', () => {
    // Five-man heroic variants read item level 28 (epic) / 25 (rare). The Nythraxis
    // raid boss's own set pieces and legendaries are one tier up: epics at 33,
    // legendaries at 37 (anchored on the raid boss's normal loot).
    const raidBases = new Set(
      (MOBS.nythraxis_scourge_of_thornpeak?.loot ?? []).flatMap((e: any) =>
        e.itemId ? [e.itemId] : [],
      ),
    );
    const all = variants();
    expect(all.length).toBeGreaterThan(0);
    for (const v of all) {
      expect(['epic', 'rare', 'legendary']).toContain(v.quality);
      if (raidBases.has(v.heroicOf ?? '')) {
        expect(itemLevel(v), v.id).toBe(v.quality === 'legendary' ? 37 : 33);
      } else {
        expect(itemLevel(v), v.id).toBe(v.quality === 'epic' ? 28 : 25);
      }
      // A base item already above the generated budget must retain that extra power.
      expect(primaryStatSum(v)).toBeGreaterThanOrEqual(expectedStatBudget(v) ?? 0);
    }
  });

  it('never lowers realized primary-stat or weapon power below its base item', () => {
    const primaryStatDowngrades: string[] = [];
    const weaponDowngrades: string[] = [];
    for (const variant of variants()) {
      if (!variant.heroicOf) continue;
      const base = ITEMS[variant.heroicOf];
      const baseStats = primaryStatSum(base);
      const variantStats = primaryStatSum(variant);
      if (variantStats < baseStats) {
        primaryStatDowngrades.push(`${variant.id}: ${baseStats} -> ${variantStats}`);
      }
      const baseWeaponPower = weaponPower(base);
      const variantWeaponPower = weaponPower(variant);
      if (
        baseWeaponPower !== null &&
        variantWeaponPower !== null &&
        variantWeaponPower < baseWeaponPower
      ) {
        weaponDowngrades.push(
          `${variant.id}: ${baseWeaponPower.toFixed(3)} -> ${variantWeaponPower.toFixed(3)}`,
        );
      }
    }

    expect({ primaryStatDowngrades, weaponDowngrades }).toEqual({
      primaryStatDowngrades: [],
      weaponDowngrades: [],
    });
  });

  it("preserves Moonwrack Robe's 15 primary-stat points in its Heroic variant", () => {
    const base = ITEMS.moonshroud_robe;
    const variant = ITEMS[heroicVariantId(base.id)];
    expect({ base: primaryStatSum(base), heroic: primaryStatSum(variant) }).toEqual({
      base: 15,
      heroic: 15,
    });
  });

  it('shares the base item name (the heroic distinction is a tooltip tag, not a name prefix)', () => {
    const v = ITEMS[heroicVariantId('deathlord_warplate')];
    expect(v).toBeDefined();
    expect(itemDisplayName(v)).toBe(itemDisplayName(ITEMS.deathlord_warplate));
  });

  it('leaves green/uncommon drops without a variant', () => {
    // boneplate_vest is an uncommon Korzul drop: no Heroic upgrade.
    expect(ITEMS[heroicVariantId('boneplate_vest')]).toBeUndefined();
  });

  it('upgrades a Nythraxis raid set piece to its raid-tier heroic variant (33 over 29)', () => {
    const base = ITEMS.crownforged_dreadhelm; // Nythraxis raid epic, item level 29
    expect(itemLevel(base)).toBe(29);
    const v = ITEMS[heroicVariantId('crownforged_dreadhelm')];
    expect(v).toBeDefined();
    // The raid boss's set pieces upgrade to the raid tier (33), a genuine upgrade
    // over the 29 base, so the heroic swap applies rather than skipping.
    expect(itemLevel(v)).toBe(33);
    expect(itemLevel(v)! > itemLevel(base)!).toBe(true);
  });
});

describe('heroic loot flair: weapon dps tracks item level', () => {
  const dps = (id: string) => {
    const w = ITEMS[id].weapon!;
    return (w.min + w.max) / 2 / w.speed;
  };
  const FIVEMAN_SET_WEAPONS = ['gravewyrm_cleaver', 'mistcallers_fang', 'lunar_tide_greatstaff'];
  // The heroic-only Nythraxis raid weapons are one tier up (item level 33).
  const RAID_WEAPONS = [
    'scepter_of_the_deathless_court',
    'deathless_greatblade',
    'stormcallers_focus',
  ];

  it('every five-man heroic (item level 31) set weapon sits on the dps curve', () => {
    const target = weaponDpsBudget(31);
    for (const id of FIVEMAN_SET_WEAPONS) {
      expect(itemLevel(ITEMS[id]), id).toBe(31);
      expect(Math.abs(dps(id) - target), `${id} dps ${dps(id)}`).toBeLessThan(0.3);
    }
  });

  it('every heroic-only raid weapon (item level 33) sits on the dps curve', () => {
    for (const id of RAID_WEAPONS) {
      const item = ITEMS[id];
      expect(itemLevel(item), id).toBe(33);
      // Two-handers ride the TWOHAND_DPS_MULT premium above the one-hand line
      // (the v0.27.1 stat-for-dps tradeoff).
      const isTwoHand = item.kind === 'weapon' && item.hand === 'twohand';
      const target = weaponDpsBudget(33) * (isTwoHand ? TWOHAND_DPS_MULT : 1);
      expect(Math.abs(dps(id) - target), `${id} dps ${dps(id)}`).toBeLessThan(0.3);
    }
  });

  it('keeps the one-hand ladder ordered and the 2H premium inside its own ladder', () => {
    // Within the one-hand line, higher item level still wins.
    expect(dps('gravewyrm_cleaver')).toBeGreaterThan(weaponDpsBudget(26));
    expect(dps('gravewyrm_cleaver')).toBeLessThan(dps('kingsbane_last_oath'));
    expect(dps('mistcallers_fang')).toBeLessThan(dps('deathless_heartwood'));
    // The 2H ladder ascends by tier too: the ilvl-26 Wyrmfang stays under the
    // ilvl-33 Deathless Greatblade.
    expect(dps('wyrmfang_greatblade')).toBeLessThan(dps('deathless_greatblade'));
  });

  it('a Heroic weapon variant scales its damage to its own item level', () => {
    const v = Object.values(ITEMS).find((i) => i.heroicOf && i.weapon);
    expect(v).toBeDefined();
    const w = v!.weapon!;
    const d = (w.min + w.max) / 2 / w.speed;
    const isTwoHand = v!.kind === 'weapon' && v!.hand === 'twohand';
    const target = weaponDpsBudget(itemLevel(v!)!) * (isTwoHand ? TWOHAND_DPS_MULT : 1);
    expect(Math.abs(d - target)).toBeLessThan(0.6);
  });
});

describe('heroic loot flair: the drop swap in a heroic instance', () => {
  function killKorzul(difficulty: 'normal' | 'heroic'): any[] {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true }) as AnySim;
    const pid = sim.addPlayer('warrior', 'Solo');
    if (difficulty === 'heroic') sim.setDungeonDifficulty('heroic', pid);
    enterDungeon(sim.ctx, 'gravewyrm_sanctum', pid);
    const inst = (sim.instances as any[]).find(
      (i) =>
        i.dungeonId === 'gravewyrm_sanctum' && i.difficulty === difficulty && i.partyKey !== null,
    );
    const korzul = inst.mobIds
      .map((id: number) => sim.entities.get(id))
      .find((e: AnyEntity | undefined) => e?.templateId === 'korzul_the_gravewyrm') as AnyEntity;
    const p = sim.entities.get(pid) as AnyEntity;
    p.pos = { x: korzul.pos.x + 1, y: korzul.pos.y, z: korzul.pos.z };
    p.prevPos = { ...p.pos };
    sim.rebucket(p);
    (sim as any).dealDamage(p, korzul, korzul.hp + 100, false, 'physical', null, 'hit');
    return (korzul.loot?.items ?? []) as any[];
  }

  it('never leaves a swappable base epic un-upgraded on a heroic kill', () => {
    const items = killKorzul('heroic');
    for (const s of items) {
      const def = ITEMS[s.itemId];
      if (!def || def.heroicOf) continue; // variants are already upgraded
      // any base epic that HAS a variant must have been swapped, not dropped raw
      const variant = ITEMS[heroicVariantId(s.itemId)];
      const isUpgrade = variant && (itemLevel(variant) ?? 0) > (itemLevel(def) ?? 0);
      expect(isUpgrade, `un-swapped base epic leaked: ${s.itemId}`).toBeFalsy();
    }
  });

  it('drops base (un-swapped) epics on a normal kill', () => {
    const items = killKorzul('normal');
    // no heroic variant ids appear on a normal difficulty corpse
    expect(items.some((s) => ITEMS[s.itemId]?.heroicOf)).toBe(false);
  });
});
