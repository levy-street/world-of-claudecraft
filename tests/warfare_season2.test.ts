// Warfare Season 2 ("Vanguard"): the stock shape, the stat, armor and rating
// rules that keep honor gear under the raid tier in PvE, the set rows, and the
// tank guard (docs/design/warfare-season-2.md, "The PvE promise").
import { describe, expect, it } from 'vitest';
import { meleeSwing } from '../src/sim/combat/auto_attack';
import { effectiveSpellHit } from '../src/sim/combat/spell_resist';
import { ABILITIES } from '../src/sim/content/classes';
import { DEV_KIT_ROLES } from '../src/sim/content/dev_kit_roles';
import { ITEM_SETS } from '../src/sim/content/item_sets';
import { FURY_STOCK, HONOR_QUARTERMASTER_STOCK } from '../src/sim/content/pvp_honor';
import {
  SEASON2_ARMOR_COMBAT_RATING,
  SEASON2_ARMOR_FRACTION,
  SEASON2_ARMOR_SLOTS,
  SEASON2_CASTER_RING_HIT_RATING,
  SEASON2_COMBAT_RATING_SHARE,
  SEASON2_DEFENSE_RATING_MULT,
  SEASON2_HEALER_RING_HASTE_RATING,
  SEASON2_JEWELRY_IDS,
  SEASON2_JEWELRY_PRICES,
  SEASON2_MELEE_RING_HIT_RATING,
  SEASON2_NECK_COMBAT_RATING,
  SEASON2_OFFENSE_RATING_MULT,
  SEASON2_PRICES,
  SEASON2_SETS,
  SEASON2_SOURCE_LEVEL,
  SEASON2_STAT_FRACTION,
  SEASON2_STOCK,
  SEASON2_WEAPON_COMBAT_RATING,
  SEASON2_WEAPON_IDS,
  SEASON2_WEAPON_PRICE,
} from '../src/sim/content/pvp_honor_season2';
import { RELIQUARY_PAGES_BY_ID } from '../src/sim/content/reliquary';
import type { TalentAllocation } from '../src/sim/content/talents';
import { VANGUARD_SET_ENGINE_BONUSES } from '../src/sim/content/vanguard_set_bonuses';
import { DUNGEON_X_THRESHOLD, ITEMS, NPCS } from '../src/sim/data';
import { bestEpicGearFor } from '../src/sim/dev/bis_gear';
import { canEquipItem, maxArmorTypeForClass } from '../src/sim/equipment_rules';
import {
  casterLaneSpTotal,
  healerLaneHpTotal,
  staminaBaseline,
  statIdentity,
  TWOHAND_DPS_MULT,
  weaponDpsBudget,
} from '../src/sim/item_budget';
import { expectedLineBudget, itemLevel, primaryStatSum } from '../src/sim/item_level';
import { countsWarfareRating } from '../src/sim/pvp/power';
import { Sim } from '../src/sim/sim';
import {
  ALL_CLASSES,
  armorReduction,
  type Entity,
  type EquipSlot,
  hitFractionFromRating,
  type ItemDef,
  meleeMissChance,
  type PlayerClass,
  spellHitChance,
} from '../src/sim/types';
import { WEEKLY_POOL_IDS, weeklyLootPool } from '../src/sim/weekly_rewards';

const ARMOR_TYPE: Record<string, string> = {
  warrior: 'mail',
  paladin: 'mail',
  hunter: 'leather',
  shaman: 'mail',
  rogue: 'leather',
  druid: 'leather',
  priest: 'cloth',
  mage: 'cloth',
  warlock: 'cloth',
};

// En and em dash, built from char codes so this file carries neither character.
const DASHES = [String.fromCharCode(0x2013), String.fromCharCode(0x2014)];
const handOf = (it: ItemDef) => (it as { hand?: string }).hand;

// The five set pieces per spec. Jewelry is kind 'armor' too, so filter on the
// set slots rather than the kind.
const armorPieces = (): ItemDef[] =>
  SEASON2_SETS.flatMap((set) => set.itemIds).map((id) => ITEMS[id]);

describe('the Season 2 stock', () => {
  it('is one five-piece set per spec plus five weapons and eight jewelry pieces, sold by both quartermasters', () => {
    expect(SEASON2_SETS).toHaveLength(27);
    expect(SEASON2_WEAPON_IDS).toHaveLength(5);
    expect(SEASON2_JEWELRY_IDS).toHaveLength(8);
    expect(SEASON2_STOCK).toHaveLength(27 * 5 + 5 + 8);
    const specs = Object.entries(DEV_KIT_ROLES).flatMap(([cls, roles]) =>
      roles.map((r) => `vanguard_${cls}_${r.spec}`),
    );
    expect(SEASON2_SETS.map((s) => s.setId).sort()).toEqual([...new Set(specs)].sort());
    for (const npcId of ['fury', 'warmarshal_draven_kole']) {
      const sold = new Set(NPCS[npcId]?.vendorItems ?? []);
      for (const id of SEASON2_STOCK) expect(sold.has(id), `${npcId} sells ${id}`).toBe(true);
    }
    expect(HONOR_QUARTERMASTER_STOCK.slice(-SEASON2_STOCK.length)).toEqual([...SEASON2_STOCK]);
  });

  it('fills the raid slots, locked to its class, in its class armor type, at item level 35', () => {
    expect(SEASON2_SOURCE_LEVEL).toBe(29);
    expect([...SEASON2_ARMOR_SLOTS]).toEqual(['helmet', 'shoulder', 'chest', 'legs', 'gloves']);
    for (const set of SEASON2_SETS) {
      const items = set.itemIds.map((id) => ITEMS[id]);
      expect(
        items.map((it) => it.slot),
        set.setId,
      ).toEqual([...SEASON2_ARMOR_SLOTS]);
      for (const it of items) {
        expect(it.set, it.id).toBe(set.setId);
        expect(it.requiredClass, it.id).toEqual([set.cls]);
        expect(it.armorType, it.id).toBe(ARMOR_TYPE[set.cls]);
        // The class's own heaviest armor, and wearable through the real equip rules.
        expect(it.armorType, it.id).toBe(maxArmorTypeForClass(set.cls as PlayerClass));
        expect(canEquipItem(set.cls as PlayerClass, it), `${set.cls} wears ${it.id}`).toBe(true);
        // Class-locked in earnest: no other class can equip it, even one whose
        // armor type would otherwise allow it (a mage and the priest cloth).
        expect(it.classLocked, it.id).toBe(true);
        for (const other of Object.keys(ARMOR_TYPE) as PlayerClass[]) {
          if (other === set.cls) continue;
          expect(canEquipItem(other, it), `${other} refused ${it.id}`).toBe(false);
        }
      }
    }
    for (const id of SEASON2_STOCK) {
      const it = ITEMS[id];
      expect(itemLevel(it), id).toBe(35);
      expect(it.quality, id).toBe('epic');
      expect(it.soulbound, id).toBe(true);
      expect(it.sellValue, id).toBe(0);
    }
  });

  it('prices every slot at 1.5 times the entry tier, a full set at 6,600 Honor', () => {
    expect({ ...SEASON2_PRICES }).toEqual({
      helmet: 1350,
      shoulder: 1050,
      chest: 1800,
      legs: 1575,
      gloves: 825,
    });
    for (const it of armorPieces())
      expect(it.priceHonor, it.id).toBe(SEASON2_PRICES[it.slot ?? '']);
    for (const id of SEASON2_WEAPON_IDS)
      expect(ITEMS[id].priceHonor, id).toBe(SEASON2_WEAPON_PRICE);
    expect(Object.values(SEASON2_PRICES).reduce((a, b) => a + b, 0)).toBe(6600);
    // Jewelry: 1.5 times the entry tier's old honor prices (neck 400, ring 275),
    // the ring rounded to the 25 the armor prices sit on.
    expect({ ...SEASON2_JEWELRY_PRICES }).toEqual({ neck: 600, ring: 425 });
    expect(SEASON2_JEWELRY_PRICES.neck).toBe(400 * 1.5);
    expect(Math.abs(SEASON2_JEWELRY_PRICES.ring - 275 * 1.5)).toBeLessThanOrEqual(12.5);
    for (const id of SEASON2_JEWELRY_IDS) {
      const it = ITEMS[id];
      expect(it.priceHonor, id).toBe(SEASON2_JEWELRY_PRICES[it.slot as 'neck' | 'ring']);
    }
  });
});

// Owner ruling 2026-10-07: the PvP row of the Weekly Vault pays Warfare Season 2
// and nothing else, filtered to the character's class. Season 2 stays on sale
// at both quartermasters (pinned above); the entry tier is honor-only.
describe('the Weekly Vault PvP row rolls only Season 2, for your class', () => {
  const season2 = new Set(SEASON2_STOCK);

  it.each(ALL_CLASSES)(
    'a %s rolls its own three sets, wieldable weapons and appropriate jewelry',
    (cls) => {
      const pvp = weeklyLootPool('pvp', cls);
      // Nothing outside Season 2, so no entry-tier piece and no other gear.
      expect(pvp.filter((id) => !season2.has(id))).toEqual([]);
      expect(pvp.some((id) => FURY_STOCK.includes(id))).toBe(false);
      // Every piece of the class's own three spec sets, and no other class's.
      const own = SEASON2_SETS.filter((set) => set.cls === cls).flatMap((set) => set.itemIds);
      expect(own).toHaveLength(15);
      const foreign = SEASON2_SETS.filter((set) => set.cls !== cls).flatMap((set) => set.itemIds);
      for (const id of own) expect(pvp, `${cls} rolls ${id}`).toContain(id);
      for (const id of foreign) expect(pvp, `${cls} refused ${id}`).not.toContain(id);
      // The weapons in the row are exactly the season weapons this class can equip.
      const weapons = pvp.filter((id) => SEASON2_WEAPON_IDS.includes(id));
      expect(weapons).toEqual(
        SEASON2_WEAPON_IDS.filter((id) => canEquipItem(cls, ITEMS[id])).sort(),
      );
      const roles = ['warrior', 'rogue', 'hunter'].includes(cls)
        ? ['might', 'precision']
        : cls === 'warlock'
          ? ['focus']
          : ['mage', 'priest'].includes(cls)
            ? ['focus', 'mending']
            : ['might', 'precision', 'focus', 'mending'];
      const jewelry = roles.flatMap((role) => [
        `vanguard_band_of_${role}`,
        `vanguard_pendant_of_${role}`,
      ]);
      expect(pvp.filter((id) => SEASON2_JEWELRY_IDS.includes(id))).toEqual(jewelry.sort());
      expect(pvp).toHaveLength(own.length + weapons.length + jewelry.length);
    },
  );

  it('every season weapon reaches at least one class through the row', () => {
    for (const id of SEASON2_WEAPON_IDS) {
      expect(
        ALL_CLASSES.some((cls) => weeklyLootPool('pvp', cls).includes(id)),
        id,
      ).toBe(true);
    }
  });

  it.each(ALL_CLASSES)('no other vault row offers Season 2 to a %s', (cls) => {
    for (const pool of WEEKLY_POOL_IDS) {
      if (pool === 'pvp') continue;
      expect(
        weeklyLootPool(pool, cls).filter((id) => season2.has(id)),
        pool,
      ).toEqual([]);
    }
  });
});

describe('the stat rules (the honor discount at item level 35)', () => {
  it('offers druids a class-locked Strength and Agility staff at the Season 2 weapon price', () => {
    const staff = ITEMS.vanguard_feral_staff;
    expect(staff.kind).toBe('weapon');
    expect(handOf(staff)).toBe('twohand');
    expect(staff.stats).toEqual({ str: 10, agi: 9, sta: 11 });
    expect(staff.priceHonor).toBe(1800);
    expect(staff.classLocked).toBe(true);
    expect(staff.requiredClass).toEqual(['druid']);
    expect(canEquipItem('druid', staff)).toBe(true);
    expect(canEquipItem('mage', staff)).toBe(false);
    expect(SEASON2_WEAPON_IDS).toContain(staff.id);
  });

  it.each([
    ['helmet', 12],
    ['shoulder', 10],
    ['chest', 15],
    ['legs', 13],
    ['gloves', 9],
  ] as const)('gives the feral %s Strength instead of Agility', (slot, strength) => {
    const item = ITEMS[`vanguard_druid_feral_${slot}`];
    expect(item.stats?.str).toBe(strength);
    expect(item.stats?.agi ?? 0).toBe(0);
  });

  it('prices the line at 90 percent of the budget, stamina lifted to the full-budget floor', () => {
    expect(SEASON2_STAT_FRACTION).toBe(0.9);
    for (const id of SEASON2_STOCK) {
      const it = ITEMS[id];
      const budget = expectedLineBudget(it) as number;
      const floor = staminaBaseline(budget);
      const line = Math.round(budget * SEASON2_STAT_FRACTION);
      const s = it.stats ?? {};
      expect(s.sta, `${id} stamina`).toBe(floor);
      if (statIdentity(s) === 'caster') {
        expect((s.int ?? 0) + (s.spi ?? 0), `${id} caster line`).toBe(line);
      } else {
        expect((s.str ?? 0) + (s.agi ?? 0), `${id} physical line`).toBe(line - floor);
      }
      // Warfare ratings: multiples of the full slot budget (the entry tier is 1x).
      // The jewelry carries the entry-tier jewelry's rating instead: the
      // multipliers were sized with entry-tier jewelry in the kit, and this
      // jewelry replaces it slot for slot, so every cap total is unchanged.
      if (SEASON2_JEWELRY_IDS.includes(id)) {
        const entry = ITEMS[it.slot === 'neck' ? 'final_oath_medallion' : 'iron_vow_band'];
        expect(it.pvpOffenseRating, id).toBe(entry.pvpOffenseRating);
        expect(it.pvpDefenseRating, id).toBe(entry.pvpDefenseRating);
        continue;
      }
      expect(it.pvpOffenseRating, id).toBe(Math.round(budget * SEASON2_OFFENSE_RATING_MULT));
      expect(it.pvpDefenseRating, id).toBe(Math.round(budget * SEASON2_DEFENSE_RATING_MULT));
      // Combat ratings, Spell Power and Healing Power sit off this line; their
      // rules are pinned in "the combat ratings" below.
    }
  });

  it('carries 0.9 of the mean armor of same-slot, same-type item-level-35 raid set pieces', () => {
    expect(SEASON2_ARMOR_FRACTION).toBe(0.9);
    for (const it of armorPieces()) {
      const peers = Object.values(ITEMS).filter(
        (p) =>
          p.kind === 'armor' &&
          p.slot === it.slot &&
          p.armorType === it.armorType &&
          p.set &&
          !SEASON2_STOCK.includes(p.id) &&
          itemLevel(p) === 35 &&
          (p.stats?.armor ?? 0) > 0,
      );
      expect(peers.length, it.id).toBeGreaterThan(0);
      const mean = peers.reduce((a, p) => a + (p.stats?.armor ?? 0), 0) / peers.length;
      expect(it.stats?.armor, it.id).toBe(Math.round(mean * SEASON2_ARMOR_FRACTION));
    }
  });

  it('puts the weapons on the item-level-35 damage curve (two-handers above it)', () => {
    for (const id of SEASON2_WEAPON_IDS) {
      const w = ITEMS[id];
      const dps = ((w.weapon?.min ?? 0) + (w.weapon?.max ?? 0)) / 2 / (w.weapon?.speed ?? 1);
      const target = weaponDpsBudget(35) * (handOf(w) === 'twohand' ? TWOHAND_DPS_MULT : 1);
      expect(Math.abs(dps - target), id).toBeLessThan(0.5);
    }
    // The strength two-hander the entry tier never had.
    expect(handOf(ITEMS.vanguard_verdict_greatsword)).toBe('twohand');
    expect(ITEMS.vanguard_verdict_greatsword.stats?.str).toBeGreaterThan(0);
  });

  it('never out-rolls the raid tier: every weapon has an item-level-35 raid peer that beats it in PvE', () => {
    // The damage curve is shared, so the discount lives where the armor's does:
    // a smaller stat line and half the combat rating. A raid weapon of the same
    // hand and stat identity matches its damage (within curve rounding) and
    // carries a larger line, more crit, hit or haste rating, and at least the
    // Spell Power.
    const dpsOf = (w: ItemDef) =>
      ((w.weapon?.min ?? 0) + (w.weapon?.max ?? 0)) / 2 / (w.weapon?.speed ?? 1);
    const lineOf = (w: ItemDef) => {
      const { sta: _sta, armor: _armor, ...rest } = w.stats ?? {};
      return Object.values(rest).reduce<number>((a, v) => a + (v ?? 0), 0);
    };
    const ratingsOf = (w: ItemDef) =>
      (w.critRating ?? 0) + (w.hitRating ?? 0) + (w.hasteRating ?? 0);
    const raid = Object.values(ITEMS).filter(
      (w) => w.kind === 'weapon' && w.quality === 'epic' && !w.priceHonor && itemLevel(w) === 35,
    );
    for (const id of SEASON2_WEAPON_IDS) {
      const w = ITEMS[id];
      const peer = raid.find(
        (r) =>
          handOf(r) === handOf(w) &&
          statIdentity(r.stats ?? {}) === statIdentity(w.stats ?? {}) &&
          lineOf(r) > lineOf(w) &&
          ratingsOf(r) > ratingsOf(w) &&
          (r.spellPower ?? 0) >= (w.spellPower ?? 0) &&
          dpsOf(r) > dpsOf(w) - 0.5,
      );
      expect(peer, `${id} has a stronger raid peer`).toBeDefined();
    }
  });
});

// Each Season 2 set is calibrated against its spec's raid set, the "PvE ceiling"
// named per spec in docs/design/warfare-season-2.md.
const RAID_PEER_SET: Record<string, string> = {
  vanguard_warrior_arms: 'slagbreaker',
  vanguard_warrior_fury: 'emberfury',
  vanguard_warrior_prot: 'forgewall',
  vanguard_paladin_holy: 'dawnforged',
  vanguard_paladin_protection: 'oathpyre',
  vanguard_paladin_retribution: 'zealfire',
  vanguard_hunter_beast_mastery: 'packlord_emberhide',
  vanguard_hunter_marksmanship: 'coldsight_trackers',
  vanguard_hunter_survival: 'slagsnare',
  vanguard_rogue_assassination: 'cinderfang',
  vanguard_rogue_combat: 'smolderstrike',
  vanguard_rogue_subtlety: 'ashveil',
  vanguard_priest_discipline: 'emberscreed',
  vanguard_priest_holy: 'benison_dawnweave',
  vanguard_priest_shadow: 'vesperash',
  vanguard_shaman_elemental: 'stormkindled',
  vanguard_shaman_enhancement: 'warspirit_emberscale',
  vanguard_shaman_restoration: 'springmender',
  vanguard_mage_arcane: 'chronoweave',
  vanguard_mage_fire: 'pyroclast',
  vanguard_mage_frost: 'frostquench',
  vanguard_warlock_affliction: 'hexthread',
  vanguard_warlock_demonology: 'gravebrand',
  vanguard_warlock_destruction: 'ruincaller',
  vanguard_druid_balance: 'moonscorch',
  vanguard_druid_feral: 'wildfang_emberhide',
  vanguard_druid_restoration: 'grovespring',
};

const ratingTotal = (it: ItemDef) =>
  (it.critRating ?? 0) + (it.hasteRating ?? 0) + (it.hitRating ?? 0);

describe('the combat ratings: a third of the raid piece, the raid Spell and Healing Power', () => {
  it('calibrates every spec set against one raid set', () => {
    expect(Object.keys(RAID_PEER_SET).sort()).toEqual(SEASON2_SETS.map((s) => s.setId).sort());
  });

  it("gives each armor piece a third of its raid peer's rating, as that raid set's main rating", () => {
    expect(SEASON2_COMBAT_RATING_SHARE).toBe(1 / 3);
    expect(SEASON2_ARMOR_COMBAT_RATING).toBe(28);
    for (const set of SEASON2_SETS) {
      for (const id of set.itemIds) {
        const it = ITEMS[id];
        const raid = ITEMS[`${RAID_PEER_SET[set.setId]}_${it.slot}`];
        expect(raid, `${id} raid peer`).toBeDefined();
        expect(itemLevel(raid), raid.id).toBe(35);
        // 60 main plus 25 second on every raid set piece, a third rounded down.
        expect(ratingTotal(raid), raid.id).toBe(85);
        expect(SEASON2_ARMOR_COMBAT_RATING).toBe(
          Math.floor(ratingTotal(raid) * SEASON2_COMBAT_RATING_SHARE),
        );
        const critMain = (raid.critRating ?? 0) > (raid.hasteRating ?? 0);
        expect(critMain ? it.critRating : it.hasteRating, `${id} main rating`).toBe(
          SEASON2_ARMOR_COMBAT_RATING,
        );
        expect(ratingTotal(it), `${id} carries one rating`).toBe(SEASON2_ARMOR_COMBAT_RATING);
        expect(it.hitRating ?? 0, `${id} carries no Hit (the rings do)`).toBe(0);
      }
    }
  });

  it('follows the spec, not the class: arms crit like Slagbreaker, fury haste like Emberfury', () => {
    expect(ITEMS.vanguard_warrior_arms_chest.critRating).toBe(28);
    expect(ITEMS.vanguard_warrior_arms_chest.hasteRating ?? 0).toBe(0);
    expect(ITEMS.vanguard_warrior_fury_chest.hasteRating).toBe(28);
    expect(ITEMS.vanguard_warrior_fury_chest.critRating ?? 0).toBe(0);
  });

  it('gives each weapon a third of the raid weapon rating as crit, and the caster staff both raid lanes', () => {
    expect(SEASON2_WEAPON_COMBAT_RATING).toBe(33);
    for (const raidId of ['forgefire_spire', 'heart_of_the_end_greatblade', 'anvilguard_blade']) {
      expect(ratingTotal(ITEMS[raidId]), raidId).toBe(100);
    }
    expect(SEASON2_WEAPON_COMBAT_RATING).toBe(Math.floor(100 * SEASON2_COMBAT_RATING_SHARE));
    for (const id of SEASON2_WEAPON_IDS) {
      const w = ITEMS[id];
      expect(w.critRating, id).toBe(SEASON2_WEAPON_COMBAT_RATING);
      expect(ratingTotal(w), id).toBe(SEASON2_WEAPON_COMBAT_RATING);
      if (id === 'vanguard_warstaff') continue;
      expect(w.spellPower ?? 0, id).toBe(0);
      expect(w.healPower ?? 0, id).toBe(0);
    }
    // One staff serves damage casters and healers: the raid damage staff's Spell
    // Power, and Healing Power up to the raid healer staff's healing.
    const staff = ITEMS.vanguard_warstaff;
    expect(staff.spellPower).toBe(ITEMS.forgefire_spire.spellPower);
    expect((staff.spellPower ?? 0) + (staff.healPower ?? 0)).toBe(
      ITEMS.staff_of_the_last_spring.healPower,
    );
  });

  it("spreads the raid kit's Spell and Healing Power over the five armor pieces, the waist and feet share included", () => {
    // The entry-tier waist and feet a Season 2 kit wears stay untouched, so the
    // raid waist and feet share rides on the five pieces (helm and legs take
    // the rounding remainder).
    const SP: Record<string, number> = { helmet: 9, shoulder: 6, chest: 10, legs: 9, gloves: 6 };
    const HP: Record<string, number> = {
      helmet: 18,
      shoulder: 12,
      chest: 20,
      legs: 18,
      gloves: 12,
    };
    const waistFeetSp =
      (ITEMS.cord_of_the_last_flame.spellPower ?? 0) +
      (ITEMS.cindersoaked_slippers.spellPower ?? 0);
    const waistFeetHp =
      (ITEMS.springbinder_sash.healPower ?? 0) + (ITEMS.steps_of_quiet_water.healPower ?? 0);
    expect([waistFeetSp, waistFeetHp]).toEqual([8, 16]);
    for (const set of SEASON2_SETS) {
      const raid = set.itemIds.map((id) => ITEMS[`${RAID_PEER_SET[set.setId]}_${ITEMS[id].slot}`]);
      const raidSp = raid.reduce((a, r) => a + (r.spellPower ?? 0), 0);
      const raidHp = raid.reduce((a, r) => a + (r.healPower ?? 0), 0);
      for (const [i, id] of set.itemIds.entries()) {
        const it = ITEMS[id];
        const slot = it.slot ?? '';
        expect(it.spellPower ?? 0, `${id} Spell Power`).toBe(raidSp > 0 ? SP[slot] : 0);
        expect(it.healPower ?? 0, `${id} Healing Power`).toBe(raidHp > 0 ? HP[slot] : 0);
        // Never below the raid piece in the same slot.
        expect(it.spellPower ?? 0, id).toBeGreaterThanOrEqual(raid[i].spellPower ?? 0);
        expect(it.healPower ?? 0, id).toBeGreaterThanOrEqual(raid[i].healPower ?? 0);
      }
      const sp = set.itemIds.reduce((a, id) => a + (ITEMS[id].spellPower ?? 0), 0);
      const hp = set.itemIds.reduce((a, id) => a + (ITEMS[id].healPower ?? 0), 0);
      expect(sp, `${set.setId} Spell Power`).toBe(raidSp > 0 ? raidSp + waistFeetSp : 0);
      expect(hp, `${set.setId} Healing Power`).toBe(raidHp > 0 ? raidHp + waistFeetHp : 0);
    }
    // The entry-tier waist and feet themselves carry none.
    for (const id of [
      'cinderweave_cord',
      'cinderweave_slippers',
      'thornhide_cinch',
      'thornhide_boots',
      'stormbound_waistguard',
      'stormbound_greaves',
    ]) {
      expect(ITEMS[id].spellPower ?? 0, id).toBe(0);
      expect(ITEMS[id].healPower ?? 0, id).toBe(0);
    }
  });

  it('puts the full Season 2 kit on the raid Spell Power and Healing Power lanes', () => {
    // The five pieces and the staff, the Season 2 neck and two rings, plus the
    // entry-tier waist and feet a Season 2 kit wears.
    const ENTRY_WAIST_FEET: Record<string, readonly string[]> = {
      cloth: ['cinderweave_cord', 'cinderweave_slippers'],
      leather: ['thornhide_cinch', 'thornhide_boots'],
      mail: ['stormbound_waistguard', 'stormbound_greaves'],
    };
    const kit = (set: (typeof SEASON2_SETS)[number], neck: string, ring: string) => [
      ...set.itemIds,
      'vanguard_warstaff',
      ...ENTRY_WAIST_FEET[set.armorType],
      neck,
      ring,
      ring,
    ];
    let casters = 0;
    let healers = 0;
    for (const set of SEASON2_SETS) {
      const raidPiece = ITEMS[`${RAID_PEER_SET[set.setId]}_helmet`];
      if (raidPiece.spellPower) {
        casters++;
        const ids = kit(set, 'vanguard_pendant_of_focus', 'vanguard_band_of_focus');
        const sp = ids.reduce((a, id) => a + (ITEMS[id].spellPower ?? 0), 0);
        expect(sp, `${set.setId} Spell Power`).toBe(casterLaneSpTotal(35));
      } else if (raidPiece.healPower) {
        healers++;
        const ids = kit(set, 'vanguard_pendant_of_mending', 'vanguard_band_of_mending');
        const healing = ids.reduce(
          (a, id) => a + (ITEMS[id].spellPower ?? 0) + (ITEMS[id].healPower ?? 0),
          0,
        );
        expect(healing, `${set.setId} healing`).toBe(healerLaneHpTotal(35));
      }
    }
    expect(casterLaneSpTotal(35)).toBe(86);
    expect(healerLaneHpTotal(35)).toBe(172);
    expect([casters, healers]).toEqual([8, 6]);
  });
});

describe('the Season 2 jewelry', () => {
  const ring = (id: string) => ITEMS[id];

  it('carries the PvP hit cap on the rings: two melee rings cancel the base melee miss, two caster rings the spell resist', () => {
    expect([
      SEASON2_MELEE_RING_HIT_RATING,
      SEASON2_CASTER_RING_HIT_RATING,
      SEASON2_HEALER_RING_HASTE_RATING,
    ]).toEqual([25, 20, 20]);
    // Decisive: at level 20 against level 20, two rings are exactly the miss
    // and resist chance a player has against another player.
    expect(hitFractionFromRating(2 * SEASON2_MELEE_RING_HIT_RATING)).toBeCloseTo(
      meleeMissChance(20, 20),
      10,
    );
    expect(hitFractionFromRating(2 * SEASON2_CASTER_RING_HIT_RATING)).toBeCloseTo(
      1 - spellHitChance(20, 20),
      10,
    );
    expect(ring('vanguard_band_of_might').hitRating).toBe(SEASON2_MELEE_RING_HIT_RATING);
    expect(ring('vanguard_band_of_precision').hitRating).toBe(SEASON2_MELEE_RING_HIT_RATING);
    expect(ring('vanguard_band_of_focus').hitRating).toBe(SEASON2_CASTER_RING_HIT_RATING);
    // Heals are never resisted: the healer ring trades its Hit for Haste.
    expect(ring('vanguard_band_of_mending').hitRating ?? 0).toBe(0);
    expect(ring('vanguard_band_of_mending').hasteRating).toBe(SEASON2_HEALER_RING_HASTE_RATING);
    for (const id of SEASON2_JEWELRY_IDS.filter((x) => ITEMS[x].slot === 'ring')) {
      expect(ratingTotal(ITEMS[id]), `${id} carries one rating`).toBe(
        id === 'vanguard_band_of_might' || id === 'vanguard_band_of_precision' ? 25 : 20,
      );
    }
    // No other Season 2 piece carries Hit.
    for (const id of SEASON2_STOCK) {
      if (ITEMS[id].slot === 'ring') continue;
      expect(ITEMS[id].hitRating ?? 0, id).toBe(0);
    }
  });

  it('caps a special attack against a same-level player, but dual-wield auto-attacks keep their extra miss', () => {
    // The real swing path (combat/auto_attack.ts meleeSwing) with a fixed roll of
    // 0.04: inside the base 5 percent miss, and inside the 10 percent dual-wield
    // auto-attack penalty that the rings do not cover (the guide says so).
    const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true });
    const p = sim.player;
    const targetId = sim.addPlayer('mage', 'Target');
    sim.setPlayerLevel(20, p.id);
    sim.setPlayerLevel(20, targetId);
    const target = sim.entities.get(targetId) as Entity;
    p.critChance = 0;
    target.dodgeChance = 0;
    const swing = (white: boolean) =>
      meleeSwing(sim.ctx, p, target, 0, null, {
        cannotBeDodged: true,
        whiteDualWieldPenalty: white,
      });
    sim.rng.next = () => 0.04;
    expect(swing(false), 'no rings: 0.04 is inside the base 5 percent miss').toBe(false);
    for (const slot of ['ring1', 'ring2'] as const) {
      sim.addItem('vanguard_band_of_might', 1, p.id);
      sim.equipItemToSlot('vanguard_band_of_might', slot, p.id);
    }
    sim.ctx.recalcPlayer(p);
    sim.rng.next = () => 0.04;
    expect(p.hitBonus).toBeCloseTo(0.05, 10);
    expect(swing(false), 'two rings: the special attack lands').toBe(true);
    expect(swing(true), 'two rings: a dual-wield auto-attack can still miss').toBe(false);
    // Spells: two caster rings take a same-level resist to zero.
    expect(
      effectiveSpellHit(20, 20, hitFractionFromRating(2 * SEASON2_CASTER_RING_HIT_RATING)),
    ).toBe(1);
  });

  it('gives each neck a third of the raid neck rating and copies the raid jewelry Spell and Healing Power', () => {
    for (const id of [
      'pendant_of_the_first_tempering',
      'ignivars_ember_choker',
      'locket_of_the_last_flame',
      'heartspring_amulet',
    ]) {
      expect(ratingTotal(ITEMS[id]), id).toBe(25);
    }
    expect(SEASON2_NECK_COMBAT_RATING).toBe(Math.floor(25 * SEASON2_COMBAT_RATING_SHARE));
    expect(SEASON2_NECK_COMBAT_RATING).toBe(8);
    for (const id of ['vanguard_pendant_of_might', 'vanguard_pendant_of_precision']) {
      expect(ITEMS[id].critRating, id).toBe(SEASON2_NECK_COMBAT_RATING);
      expect(ratingTotal(ITEMS[id]), id).toBe(SEASON2_NECK_COMBAT_RATING);
    }
    expect(ITEMS.vanguard_pendant_of_focus.critRating).toBe(SEASON2_NECK_COMBAT_RATING);
    expect(ITEMS.vanguard_pendant_of_mending.hasteRating).toBe(SEASON2_NECK_COMBAT_RATING);
    expect(ITEMS.vanguard_pendant_of_focus.spellPower).toBe(
      ITEMS.locket_of_the_last_flame.spellPower,
    );
    expect(ITEMS.vanguard_pendant_of_mending.healPower).toBe(ITEMS.heartspring_amulet.healPower);
    expect(ITEMS.vanguard_band_of_focus.spellPower).toBe(ITEMS.circle_of_cinders.spellPower);
    expect(ITEMS.vanguard_band_of_mending.healPower).toBe(ITEMS.loop_of_quiet_springs.healPower);
    // Damage pieces carry no Healing Power and healer pieces no Spell Power.
    expect(ITEMS.vanguard_band_of_focus.healPower ?? 0).toBe(0);
    expect(ITEMS.vanguard_pendant_of_focus.healPower ?? 0).toBe(0);
    expect(ITEMS.vanguard_band_of_mending.spellPower ?? 0).toBe(0);
    expect(ITEMS.vanguard_pendant_of_mending.spellPower ?? 0).toBe(0);
  });

  it('is never the raid pick: each piece has a raid peer with more primary stats, rating, Spell and Healing Power', () => {
    const raidJewelry = Object.values(ITEMS).filter(
      (r) =>
        (r.slot === 'ring' || r.slot === 'neck') &&
        r.quality === 'epic' &&
        !SEASON2_STOCK.includes(r.id) &&
        itemLevel(r) === 35,
    );
    expect(raidJewelry.length).toBeGreaterThan(0);
    for (const id of SEASON2_JEWELRY_IDS) {
      const it = ITEMS[id];
      const peer = raidJewelry.find(
        (r) =>
          r.slot === it.slot &&
          statIdentity(r.stats ?? {}) === statIdentity(it.stats ?? {}) &&
          primaryStatSum(r) > primaryStatSum(it) &&
          ratingTotal(r) >= ratingTotal(it) &&
          (r.spellPower ?? 0) >= (it.spellPower ?? 0) &&
          (r.healPower ?? 0) >= (it.healPower ?? 0),
      );
      expect(peer, `${id} has a stronger raid peer`).toBeDefined();
    }
  });

  it('has no class lock and no armor type, so every class can buy all eight', () => {
    for (const id of SEASON2_JEWELRY_IDS) {
      const it = ITEMS[id];
      expect(it.requiredClass, id).toBeUndefined();
      expect(it.armorType, id).toBeUndefined();
      expect(it.set, id).toBeUndefined();
      for (const cls of Object.keys(ARMOR_TYPE) as PlayerClass[]) {
        expect(canEquipItem(cls, it), `${cls} wears ${id}`).toBe(true);
      }
    }
  });
});

describe('the set rows', () => {
  it('gives every spec set the raid thresholds, 2 and 4 pieces, with tooltip text', () => {
    for (const set of SEASON2_SETS) {
      const row = ITEM_SETS[set.setId];
      expect(row, set.setId).toBeDefined();
      expect(
        row.bonuses.map((b) => b.pieces),
        set.setId,
      ).toEqual([2, 4]);
      for (const b of row.bonuses) {
        expect(b.text.trim().length, `${set.setId} ${b.pieces}pc text`).toBeGreaterThan(0);
        const dashed = DASHES.some((d) => b.text.includes(d));
        expect(dashed, `${set.setId} ${b.pieces}pc dash`).toBe(false);
      }
    }
  });
});

describe('the PvE promise: never the raid pick for a tank', () => {
  const BOSS_LEVEL = 22;
  const ehp = (e: Entity) => e.maxHp / (1 - armorReduction(e.stats.armor, BOSS_LEVEL));

  function geared(
    cls: PlayerClass,
    spec: string,
    kit: Partial<Record<EquipSlot, string>>,
    bear: boolean,
  ) {
    const sim = new Sim({ seed: 20061, playerClass: cls, noPlayer: true });
    const pid = sim.addPlayer(cls, `T${cls}`);
    sim.setPlayerLevel(20, pid);
    sim.applyTalents({ spec, rows: {} } as TalentAllocation, pid);
    for (const [slot, id] of Object.entries(kit)) {
      sim.addItem(id, 1, pid);
      sim.equipItemToSlot(id, slot as EquipSlot, pid);
    }
    const e = sim.entities.get(pid) as Entity;
    e.pos = { ...e.pos, x: DUNGEON_X_THRESHOLD + 900 };
    e.prevPos = { ...e.pos };
    if (bear) {
      e.auras.push({
        id: 'bear_form',
        name: 'Bear Form',
        kind: 'form_bear',
        remaining: 9999,
        duration: 9999,
        value: 0,
      } as never);
    }
    for (let i = 0; i < 12; i++) sim.tick();
    sim.ctx.recalcPlayer(e);
    return e;
  }

  it('keeps each tank set, with entry-tier waist and feet, below raid best-in-slot on effective health', () => {
    const strExtras = {
      waist: 'furyforged_girdle',
      feet: 'furyforged_sabatons',
      neck: 'final_oath_medallion',
      ring1: 'iron_vow_band',
      ring2: 'unbroken_circle',
      mainhand: 'vanguard_oath_blade',
    };
    const agiExtras = {
      waist: 'ashstalker_waistband',
      feet: 'ashstalker_treads',
      neck: 'razorwind_torque',
      ring1: 'fleetblood_band',
      ring2: 'last_step_signet',
      mainhand: 'vanguard_fang_dagger',
    };
    for (const [cls, spec, extras, bear] of [
      ['warrior', 'prot', strExtras, false],
      ['paladin', 'protection', strExtras, false],
      ['druid', 'feral', agiExtras, true],
    ] as [PlayerClass, string, Partial<Record<EquipSlot, string>>, boolean][]) {
      const set = SEASON2_SETS.find((s) => s.cls === cls && s.spec === spec);
      expect(set, `${cls}/${spec}`).toBeDefined();
      const kit: Partial<Record<EquipSlot, string>> = { ...extras };
      for (const id of set?.itemIds ?? []) kit[ITEMS[id].slot as EquipSlot] = id;
      const honor = geared(cls, spec, kit, bear);
      const raid = geared(cls, spec, bestEpicGearFor(cls, spec), bear);
      expect(honor.pvpVitalityActive, `${cls}/${spec}`).toBe(false);
      expect(ehp(honor), `${cls}/${spec} Season 2 effective health`).toBeLessThan(ehp(raid));
    }
  });
});

describe('the PvP promise: Season 2 is the PvP upgrade over a full Season 1 kit', () => {
  // Level 20, open world. Season 1: the full seven-piece family plus its honor
  // jewelry and weapon. Season 2: the same kit with the five set slots swapped,
  // so the difference is the armor alone.
  const S1 = {
    str: {
      set: 'warfare_furyforged',
      extras: {
        neck: 'final_oath_medallion',
        ring1: 'iron_vow_band',
        ring2: 'unbroken_circle',
        mainhand: 'final_argument_greatblade',
      },
    },
    caster: {
      set: 'warfare_cinderweave',
      extras: {
        neck: 'cinder_sigil_pendant',
        ring1: 'ashen_focus_ring',
        ring2: 'spellbreakers_seal',
        mainhand: 'emberglass_warstaff',
      },
    },
  } as const;

  function inOpenWorld(cls: PlayerClass, spec: string, kit: Partial<Record<EquipSlot, string>>) {
    const sim = new Sim({ seed: 20061, playerClass: cls, noPlayer: true });
    const pid = sim.addPlayer(cls, `P${cls}`);
    sim.setPlayerLevel(20, pid);
    sim.applyTalents({ spec, rows: {} } as TalentAllocation, pid);
    for (const [slot, id] of Object.entries(kit)) {
      sim.addItem(id, 1, pid);
      sim.equipItemToSlot(id, slot as EquipSlot, pid);
    }
    for (let i = 0; i < 12; i++) sim.tick();
    const e = sim.entities.get(pid) as Entity;
    sim.ctx.recalcPlayer(e);
    return e;
  }

  // The Season 2 jewelry each profile wears: the role's neck and two of its ring.
  const S2_JEWELRY = {
    str: { neck: 'vanguard_pendant_of_might', ring: 'vanguard_band_of_might' },
    caster: { neck: 'vanguard_pendant_of_focus', ring: 'vanguard_band_of_focus' },
  } as const;

  // The full Season 2 kit: the spec's five pieces, its Season 2 weapon and the
  // Season 2 jewelry, with the Season 1 family's waist and feet.
  function season2Kit(
    cls: PlayerClass,
    spec: string,
    profile: keyof typeof S1,
    weapon: string,
  ): Partial<Record<EquipSlot, string>> {
    const family = S1[profile];
    const kit: Partial<Record<EquipSlot, string>> = { ...family.extras };
    for (const it of Object.values(ITEMS)) {
      if (it.set === family.set) kit[it.slot as EquipSlot] = it.id;
    }
    const set = SEASON2_SETS.find((s) => s.cls === cls && s.spec === spec);
    for (const id of set?.itemIds ?? []) kit[ITEMS[id].slot as EquipSlot] = id;
    kit.mainhand = weapon;
    const jewelry = S2_JEWELRY[profile];
    kit.neck = jewelry.neck;
    kit.ring1 = jewelry.ring;
    kit.ring2 = jewelry.ring;
    return kit;
  }

  it('reaches every Warfare cap on the full kit and carries more health than Season 1 in PvP', () => {
    // A one-hander lands exactly on the 30 percent Offense cap (the multipliers
    // are the smallest that do), a two-hander one ring's worth over.
    for (const [cls, spec, profile, weapon] of [
      ['warrior', 'arms', 'str', 'vanguard_verdict_greatsword'],
      ['warrior', 'prot', 'str', 'vanguard_oath_blade'],
      ['mage', 'fire', 'caster', 'vanguard_warstaff'],
    ] as [PlayerClass, string, keyof typeof S1, string][]) {
      const family = S1[profile];
      const s1: Partial<Record<EquipSlot, string>> = { ...family.extras };
      for (const it of Object.values(ITEMS)) {
        if (it.set === family.set) s1[it.slot as EquipSlot] = it.id;
      }
      const a = inOpenWorld(cls, spec, s1);
      const b = inOpenWorld(cls, spec, season2Kit(cls, spec, profile, weapon));
      expect(b.stats.pvpOffense, `${cls}/${spec} offense`).toBeCloseTo(0.3, 10);
      expect(b.stats.pvpDefense, `${cls}/${spec} defense`).toBeCloseTo(0.3, 10);
      expect(b.stats.pvpVitality, `${cls}/${spec} vitality`).toBeCloseTo(0.8, 10);
      // Owner target: about 10 percent more health than a full Season 1 kit,
      // each side with its own weapon. Measured 2026-10-02: arms +8.0, prot +5.9,
      // fire +14.7 percent (unchanged by the rebalance: Vitality caps at +80
      // either way). Prot sits lowest because the Season 2 one-hander carries 8
      // stamina against the Season 1 one-hander's 12.
      expect(b.maxHp / a.maxHp, `${cls}/${spec} health over Season 1`).toBeGreaterThan(1.05);
    }
  });

  it('keeps a part kit under the caps: three pieces and a Season 2 weapon are not enough', () => {
    // The reported build (owner rebalance, 2026-10-02): three Season 2 pieces
    // and Season 2 greatswords in both hands, PvE gear everywhere else. At the
    // old 2.2x and 3.4x multipliers it read 29.5 percent Offense and +76
    // percent Vitality, everything the full kit gives.
    const kit: Partial<Record<EquipSlot, string>> = {
      ...bestEpicGearFor('warrior', 'fury'),
      helmet: 'vanguard_warrior_fury_helmet',
      chest: 'vanguard_warrior_fury_chest',
      legs: 'vanguard_warrior_fury_legs',
      mainhand: 'vanguard_verdict_greatsword',
      offhand: 'vanguard_verdict_greatsword',
    };
    const e = inOpenWorld('warrior', 'fury', kit);
    expect(e.offhandItemId, 'Titan grip pair equipped').toBe('vanguard_verdict_greatsword');
    expect(e.stats.pvpOffense).toBeCloseTo(0.182, 10);
    expect(e.stats.pvpOffense).toBeLessThan(0.2);
    expect(e.stats.pvpVitality).toBeLessThan(0.5);
  });

  it('counts only the main hand weapon: an offhand weapon adds no Warfare rating', () => {
    for (const [cls, spec, weapon] of [
      ['warrior', 'fury', 'vanguard_verdict_greatsword'],
      ['rogue', 'combat', 'vanguard_fang_dagger'],
      ['shaman', 'enhancement', 'vanguard_oath_blade'],
    ] as [PlayerClass, string, string][]) {
      const one = inOpenWorld(cls, spec, { mainhand: weapon });
      const two = inOpenWorld(cls, spec, { mainhand: weapon, offhand: weapon });
      expect(two.offhandItemId, `${cls}/${spec} offhand equipped`).toBe(weapon);
      expect(one.stats.pvpOffense, `${cls}/${spec} main hand counts`).toBeGreaterThan(0);
      expect(two.stats.pvpOffense, `${cls}/${spec} offense`).toBe(one.stats.pvpOffense);
      expect(two.stats.pvpDefense, `${cls}/${spec} defense`).toBe(one.stats.pvpDefense);
      expect(two.stats.pvpVitality, `${cls}/${spec} vitality`).toBe(one.stats.pvpVitality);
    }
  });

  it("skips a perfected copy's Warfare bonus in the offhand and keeps it in the main hand", () => {
    // The per-copy bonus (loot_quality/core.ts rolls pvpOffenseRating and
    // pvpDefenseRating onto a perfected copy) is the other half of the main
    // hand rule: without the inner warfareCounts gate it would ride the offhand.
    const sim = new Sim({ seed: 20061, playerClass: 'rogue', noPlayer: true });
    const pid = sim.addPlayer('rogue', 'Twin');
    sim.setPlayerLevel(20, pid);
    sim.applyTalents({ spec: 'combat', rows: {} } as TalentAllocation, pid);
    const dagger = 'vanguard_fang_dagger';
    for (const slot of ['mainhand', 'offhand'] as EquipSlot[]) {
      sim.addItem(dagger, 1, pid);
      sim.equipItemToSlot(dagger, slot, pid);
    }
    const e = sim.entities.get(pid) as Entity;
    const meta = sim.ctx.players.get(pid) as {
      equipmentInstance: Partial<Record<EquipSlot, unknown>>;
    };
    const perfected = { rolled: { stats: { pvpOffenseRating: 40, pvpDefenseRating: 40 } } };
    const read = (): [number, number] => {
      sim.ctx.recalcPlayer(e);
      return [e.stats.pvpOffense, e.stats.pvpDefense];
    };
    const plain = read();
    meta.equipmentInstance.offhand = perfected;
    expect(read(), 'a perfected offhand adds no Warfare rating').toEqual(plain);
    delete meta.equipmentInstance.offhand;
    meta.equipmentInstance.mainhand = perfected;
    const boosted = read();
    expect(boosted[0], 'the main hand copy counts').toBeGreaterThan(plain[0]);
    expect(boosted[1]).toBeGreaterThan(plain[1]);
  });

  it('keeps Warfare rating on a non-weapon offhand', () => {
    const shield = Object.values(ITEMS).find((i) => i.slot === 'offhand');
    expect(shield, 'a non-weapon offhand exists in content').toBeDefined();
    expect(countsWarfareRating('offhand', shield as ItemDef)).toBe(true);
    const weapon = ITEMS.vanguard_fang_dagger;
    expect(countsWarfareRating('mainhand', weapon)).toBe(true);
    expect(countsWarfareRating('offhand', weapon)).toBe(false);
  });
});

describe('the crowd-control promise: no set makes heavy control spammable', () => {
  // Player stuns carry no PvP diminishing returns here (src/sim/stun_dr.ts), so
  // a cooldown cut on a stun is pure extra stun time; fears, roots, pulls and
  // lockouts ride ladders but still gain uptime. Every Season 2 set that
  // shortens a control ability's cooldown, flat or through a cast-triggered
  // refund (with the trigger used on its own cooldown), stays within 20 percent
  // of the base cooldown.
  const CONTROL = new Set([
    'stun',
    'finisherStun',
    'aoeFear',
    'fear',
    'incapacitate',
    'root',
    'aoeRoot',
    'pullTarget',
    'interrupt',
    'polymorph',
    'silence',
    'knockback',
  ]);
  const MAX_CUT = 0.2;

  type Row = { ability: string; cooldownFlat?: number; cooldownPct?: number };
  type Proc = {
    trigger: { on: string; abilities?: string[]; ability?: string; icd?: number };
    responses: { kind: string; ability?: string; seconds?: number | 'reset' }[];
  };

  function isControl(abilityId: string): boolean {
    const def = ABILITIES[abilityId] as unknown as { effects?: Record<string, unknown>[] };
    return (def?.effects ?? []).some((e) => CONTROL.has(String(e.type)) || e.stunSec !== undefined);
  }

  it('cuts no control ability cooldown by more than 20 percent, refunds included', () => {
    const cuts: Record<string, number> = {};
    for (const [setId, tiers] of Object.entries(VANGUARD_SET_ENGINE_BONUSES)) {
      // Every tier of the set together: the worst case is the full four pieces.
      const flat = new Map<string, number>();
      const refundRate = new Map<string, number>();
      for (const tier of tiers) {
        const effect = tier.effect as { ability?: Row[]; proc?: Proc | Proc[] };
        for (const row of effect.ability ?? []) {
          const base = ABILITIES[row.ability]?.cooldown ?? 0;
          const cut = -(row.cooldownFlat ?? 0) - base * (row.cooldownPct ?? 0);
          if (cut > 0) flat.set(row.ability, (flat.get(row.ability) ?? 0) + cut);
        }
        const procs = effect.proc ? (Array.isArray(effect.proc) ? effect.proc : [effect.proc]) : [];
        for (const proc of procs) {
          for (const r of proc.responses) {
            if (r.kind !== 'cooldownRefund' || !r.ability) continue;
            // Seconds refunded per second of play, with the trigger on cooldown.
            const triggers =
              proc.trigger.abilities ?? (proc.trigger.ability ? [proc.trigger.ability] : []);
            const period = Math.max(
              proc.trigger.icd ?? 0,
              ...triggers.map((id) => ABILITIES[id]?.cooldown ?? 0),
            );
            const refunded = r.seconds === 'reset' ? Number.POSITIVE_INFINITY : (r.seconds ?? 0);
            const rate = period > 0 ? refunded / period : Number.POSITIVE_INFINITY;
            refundRate.set(r.ability, (refundRate.get(r.ability) ?? 0) + rate);
          }
        }
      }
      for (const id of new Set([...flat.keys(), ...refundRate.keys()])) {
        if (!isControl(id)) continue;
        const base = ABILITIES[id]?.cooldown ?? 0;
        const effective = (base - (flat.get(id) ?? 0)) / (1 + (refundRate.get(id) ?? 0));
        cuts[`${setId}:${id}`] = base > 0 ? 1 - effective / base : 1;
      }
    }
    for (const [key, cut] of Object.entries(cuts)) {
      expect(cut, `${key} cooldown cut`).toBeLessThanOrEqual(MAX_CUT + 1e-9);
    }
    // Anti-vacuity: the sweep sees the control cuts that do ship.
    expect(Object.keys(cuts).length).toBeGreaterThan(3);
  });
});

describe('the Reliquary page: class-personal stock outside completion', () => {
  it('lists every Season 2 item but never gates the Conquerors capstone', () => {
    const page = RELIQUARY_PAGES_BY_ID.conquerors_vanguard_gallery;
    expect(page.shelf).toBe('conquerors');
    // The sets are class-locked and the shop lists only the viewer's own class,
    // so no single character can fill the page: the Riftbound precedent.
    expect(page.excludeFromCompletion).toBe('personal');
    const listed = new Set(page.relics.map((r) => (r as { itemId?: string }).itemId));
    for (const id of SEASON2_STOCK) expect(listed.has(id), id).toBe(true);
    // Two doors, both named: the two honor quartermasters and the vault's PvP row.
    for (const relic of page.relics) {
      expect(relic.source, JSON.stringify(relic)).toEqual([
        { sourceKind: 'vendor', sourceId: 'fury' },
        { sourceKind: 'vendor', sourceId: 'warmarshal_draven_kole' },
        { sourceKind: 'activity', sourceId: 'weekly_vault_pvp' },
      ]);
    }
  });
});
