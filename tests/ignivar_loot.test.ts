// Crucible of the Last Spring raid loot: the ilvl-35 tier is budget-exact and
// carries exactly the identities the plan authored (docs/prd/ignivar-raid-loot.md
// + docs/prd/ignivar-raid-loot-items.md). The sweep here is the acceptance gate
// the plan names: every gear piece reads item level 35 by derivation (source 26 +
// epic 6 + raid 3) with primary stats exactly on the item_budget.ts line, the Hit
// program appears only where authored, and Healing Power never rides a damage
// identity.
import { describe, expect, it } from 'vitest';
import { HEROIC_DUNGEON_TUNING } from '../src/sim/content/dungeon_difficulty';
import { DUNGEON_DEFS } from '../src/sim/content/dungeons';
import { HEROIC_BOSS_LOOT } from '../src/sim/content/heroic_loot';
import {
  CRUCIBLE_VENDOR_STOCK,
  IGNIVAR_HELD_ITEMS,
  IGNIVAR_JEWELRY_ITEMS,
  IGNIVAR_LOOT_ITEM_IDS,
  IGNIVAR_LOOT_ITEMS,
  IGNIVAR_OFFSET_ITEMS,
  IGNIVAR_RAID_LOOT_SOURCE_LEVEL,
  IGNIVAR_SET_ITEMS,
  IGNIVAR_SIGIL_ITEMS,
  IGNIVAR_WEAPON_ITEMS,
} from '../src/sim/content/ignivar_loot';
import { SET_ENGINE_BONUSES } from '../src/sim/content/ignivar_set_bonuses';
import { ITEM_SETS } from '../src/sim/content/item_sets';
import { WEAPON_TYPE_BY_ITEM } from '../src/sim/content/weapon_skin_rules';
import { ITEMS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import {
  IGNIVAR_RAID_ARENA_ID,
  IGNIVAR_SECOND_WING_ID,
  VARKHUL_BOSS_ID,
} from '../src/sim/ignivar_raid_ids';
import {
  expectedStatBudget,
  itemFromRaid,
  itemLevel,
  itemSourceLevel,
  primaryStatSum,
} from '../src/sim/item_level';
import { rollLoot } from '../src/sim/loot/loot_roll';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import type { ItemDef, LootEntry } from '../src/sim/types';
import { HIT_RATING_PER_PCT, meleeMissChance, spellHitChance } from '../src/sim/types';
import { ITEM_WEAPON_VARIANTS } from '../src/ui/weapon_variants';

const TIER_SLOTS = ['helmet', 'shoulder', 'chest', 'gloves', 'legs'] as const;

// The settled balanced-mixed sigil partition: one mail, one leather, one cloth
// class per group (docs/prd/ignivar-raid-loot.md, "The three sigil groups").
const SIGIL_GROUPS: Record<string, readonly string[]> = {
  anvil: ['warrior', 'druid', 'mage'],
  ember: ['paladin', 'hunter', 'priest'],
  tempest: ['shaman', 'rogue', 'warlock'],
};

const IGNIVAR_BOSS_ID = 'ignivar_herald_of_the_last_flame';

const gearItems = (): ItemDef[] =>
  Object.values(IGNIVAR_LOOT_ITEMS).filter((item) => item.kind !== 'tool');

describe('ignivar loot: catalog shape', () => {
  it('carries the exact authored counts', () => {
    expect(IGNIVAR_LOOT_ITEM_IDS.length).toBe(201);
    expect(Object.keys(IGNIVAR_SET_ITEMS).length).toBe(29 * 5);
    expect(Object.keys(IGNIVAR_SIGIL_ITEMS).length).toBe(15);
    expect(Object.keys(IGNIVAR_OFFSET_ITEMS).length).toBe(20);
    expect(Object.keys(IGNIVAR_JEWELRY_ITEMS).length).toBe(8);
    expect(Object.keys(IGNIVAR_HELD_ITEMS).length).toBe(4);
    // 9, not 10: the Emberflight Longbow was pulled from the tier (bows wait
    // for the hunter ranged-slot rework; maintainer decision 2026-08-28).
    expect(Object.keys(IGNIVAR_WEAPON_ITEMS).length).toBe(9);
  });

  it('merges every id into ITEMS without collisions', () => {
    for (const id of IGNIVAR_LOOT_ITEM_IDS) {
      expect(ITEMS[id], id).toBeTruthy();
      expect(ITEMS[id].id, id).toBe(id);
    }
  });
});

describe('ignivar loot: every gear piece is item level 35 and budget-exact', () => {
  it('derives ilvl 35 from source 26 + epic + raid for all 186 gear pieces', () => {
    const gear = gearItems();
    expect(gear.length).toBe(186);
    for (const item of gear) {
      expect(itemSourceLevel(item.id), `${item.id} source`).toBe(IGNIVAR_RAID_LOOT_SOURCE_LEVEL);
      expect(itemFromRaid(item.id), `${item.id} raid flag`).toBe(true);
      expect(item.quality, item.id).toBe('epic');
      expect(itemLevel(item), `${item.id} ilvl`).toBe(35);
      expect(item.requiredLevel, item.id).toBe(20);
      expect(item.soulbound, item.id).toBe(true);
    }
  });

  it('every gear piece carries exactly its item-level stat budget', () => {
    // The per-slot budgets the catalog doc was reviewed against, pinned as
    // literals so a budget-formula drift cannot silently reprice the tier.
    const SLOT_BUDGET: Record<string, number> = {
      chest: 25,
      legs: 22,
      helmet: 21,
      shoulder: 18,
      gloves: 17,
      waist: 17,
      feet: 16,
      neck: 16,
      ring: 15,
      mainhand: 25,
      offhand: 18,
    };
    for (const item of gearItems()) {
      const isTwoHand = item.kind === 'weapon' && item.hand === 'twohand';
      const want = expectedStatBudget(item);
      expect(want, `${item.id} has a derivable budget`).toBe(
        // Two-handers carry the TWOHAND_STAT_MULT premium over the mainhand line.
        isTwoHand ? 33 : SLOT_BUDGET[item.slot as string],
      );
      expect(primaryStatSum(item), `${item.id} stat sum == budget`).toBe(want);
    }
  });
});

describe('ignivar loot: the 29 sets', () => {
  it('each set has the five tier slots, one class lock, and its own set tag', () => {
    const bySet = new Map<string, ItemDef[]>();
    for (const item of Object.values(IGNIVAR_SET_ITEMS)) {
      expect(item.set, item.id).toBeTruthy();
      const list = bySet.get(item.set as string) ?? [];
      list.push(item);
      bySet.set(item.set as string, list);
    }
    expect(bySet.size).toBe(29);
    for (const [setId, pieces] of bySet) {
      expect(pieces.length, setId).toBe(5);
      expect(new Set(pieces.map((p) => p.slot)), setId).toEqual(new Set(TIER_SLOTS));
      const classes = new Set(pieces.flatMap((p) => p.requiredClass ?? []));
      expect(classes.size, `${setId} single-class lock`).toBe(1);
      for (const piece of pieces) expect(piece.id, setId).toBe(`${setId}_${piece.slot}`);
    }
  });

  it('the Phase B rollout ledger: all 29 sets are registered and complete', () => {
    // Phase A shipped every set: tag with NO registration; Phase B registered
    // the sets one class wave at a time. The druid wave was the LAST one, so
    // the end state this ledger now pins is: every Crucible set id is
    // registered, and each registration is COMPLETE: an ITEM_SETS record with
    // exactly the 2-piece and 4-piece tiers (tooltip text) AND a matching
    // engine table (content/ignivar_set_bonuses.ts), so a tooltip never
    // promises an unimplemented bonus and an engine payload never ships
    // without its tooltip (docs/prd/ignivar-set-bonus-final.md). The
    // stays-absent arm of the rollout retired with the last wave; the
    // engineless-set posture itself (an id with no engine table folds to
    // nothing) remains guarded per set in tests/set_bonus_mods.test.ts.
    const REGISTERED_SET_IDS = [
      'slagbreaker',
      'emberfury',
      'forgewall',
      'dawnforged',
      'oathpyre',
      'zealfire',
      'packlord_emberhide',
      'coldsight_trackers',
      'slagsnare',
      'cinderfang',
      'smolderstrike',
      'ashveil',
      'emberscreed',
      'benison_dawnweave',
      'vesperash',
      'stormkindled',
      'warspirit_emberscale',
      'stonehearth',
      'springmender',
      'chronoweave',
      'pyroclast',
      'frostquench',
      'hexthread',
      'gravebrand',
      'ruincaller',
      'moonscorch',
      'wildfang_emberhide',
      'cinderbark',
      'grovespring',
    ] as const;
    const setIds = new Set(
      Object.values(IGNIVAR_SET_ITEMS).flatMap((item) => (item.set ? [item.set] : [])),
    );
    expect(setIds.size).toBe(29);
    const registered = new Set<string>(REGISTERED_SET_IDS);
    // The completed rollout, both directions: every ledger id is a real
    // Crucible set tag, and every Crucible set tag is in the ledger.
    for (const setId of registered) expect(setIds.has(setId), setId).toBe(true);
    for (const setId of setIds) expect(registered.has(setId), `${setId} registered`).toBe(true);
    for (const setId of setIds) {
      const set = ITEM_SETS[setId];
      expect(set, setId).toBeDefined();
      expect(
        set?.bonuses.map((tier) => tier.pieces),
        `${setId} breaks at exactly 2 and 4 pieces`,
      ).toEqual([2, 4]);
      // Engine bonuses ride the talent seam, never the stat engine: every
      // registered tier's SetBonusEffect stays EMPTY here.
      for (const tier of set?.bonuses ?? []) {
        expect(Object.keys(tier.effect), `${setId} ${tier.pieces}pc stays stat-free`).toEqual([]);
        expect(tier.text.length, `${setId} ${tier.pieces}pc has tooltip text`).toBeGreaterThan(0);
      }
      expect(
        SET_ENGINE_BONUSES[setId]?.map((tier) => tier.pieces),
        `${setId} engine tiers mirror the tooltip tiers`,
      ).toEqual([2, 4]);
    }
  });

  it('set pieces carry the 60/25 crit+haste rating pair and never Hit', () => {
    for (const item of Object.values(IGNIVAR_SET_ITEMS)) {
      const ratings = [item.critRating ?? 0, item.hasteRating ?? 0].sort((a, b) => b - a);
      expect(ratings, item.id).toEqual([60, 25]);
      expect(item.hitRating ?? 0, item.id).toBe(0);
    }
  });
});

describe('ignivar loot: sigils and redemption stock', () => {
  it('sigils follow the heroic_mark token pattern with the balanced-mixed class groups', () => {
    for (const sigil of Object.values(IGNIVAR_SIGIL_ITEMS)) {
      expect(sigil.kind, sigil.id).toBe('tool');
      expect(sigil.quality, sigil.id).toBe('epic');
      expect(sigil.soulbound, sigil.id).toBe(true);
      // Deliberately discardable, UNLIKE heroic_mark: the class lock plus the
      // ungated loot path means a wrong-class looter must be able to destroy
      // the token, or soulbound + noDiscard wedges a bag slot forever.
      expect(sigil.noDiscard, sigil.id).toBeUndefined();
      expect(sigil.stackSize, sigil.id).toBe(20);
      const group = sigil.id.split('_')[1];
      expect(sigil.requiredClass, sigil.id).toEqual(SIGIL_GROUPS[group]);
      // Tokens are not gear: no slot, so no item level (and no budget gate).
      expect(sigil.slot, sigil.id).toBeUndefined();
      expect(itemLevel(sigil), sigil.id).toBeUndefined();
    }
  });

  it('the stock prices every set piece at one matching-slot sigil of its class group', () => {
    expect(CRUCIBLE_VENDOR_STOCK.length).toBe(29 * 5);
    const seen = new Set<string>();
    for (const offer of CRUCIBLE_VENDOR_STOCK) {
      expect(seen.has(offer.itemId), `${offer.itemId} listed once`).toBe(false);
      seen.add(offer.itemId);
      const piece = IGNIVAR_SET_ITEMS[offer.itemId];
      const sigil = IGNIVAR_SIGIL_ITEMS[offer.sigilId];
      expect(piece, offer.itemId).toBeTruthy();
      expect(sigil, offer.sigilId).toBeTruthy();
      // Slot match: sigil ids end in the tier slot they redeem.
      expect(offer.sigilId.endsWith(`_${piece.slot}`), `${offer.sigilId} slot`).toBe(true);
      // Group match: the sigil's class group contains the piece's class.
      const cls = (piece.requiredClass ?? [])[0];
      expect(sigil.requiredClass, `${offer.sigilId} covers ${cls}`).toContain(cls);
    }
    for (const id of Object.keys(IGNIVAR_SET_ITEMS)) {
      expect(seen.has(id), `${id} redeemable`).toBe(true);
    }
  });
});

describe('ignivar loot: the Hit program and affix directionality', () => {
  it('Hit appears exactly where the rebalanced program authors it', () => {
    // The 2026-08-30 hit rebalance widened the original scattered program to
    // full elective-lane coverage: EVERY waist carries 60, EVERY ring 25,
    // EVERY weapon 30 (each a budget-neutral swap of the piece's minor
    // rating), plus the choker's original 25. Set pieces still carry none
    // (the Hit-scarcity policy holds: hit lives on the elective lanes), and
    // the cap-coverage describe below proves the lanes reach the heroic caps.
    for (const item of Object.values(IGNIVAR_LOOT_ITEMS)) {
      const want =
        item.slot === 'waist'
          ? 60
          : item.slot === 'ring' || item.id === 'ignivars_ember_choker'
            ? 25
            : item.kind === 'weapon'
              ? 30
              : 0;
      expect(item.hitRating ?? 0, item.id).toBe(want);
    }
  });

  it('healer pieces carry Healing Power, damage pieces Spell Damage, never both', () => {
    let healPieces = 0;
    let sdPieces = 0;
    for (const item of gearItems()) {
      const hp = item.healPower ?? 0;
      const sp = item.spellPower ?? 0;
      expect(hp > 0 && sp > 0, `${item.id} never both affixes`).toBe(false);
      if (hp > 0) healPieces++;
      if (sp > 0) sdPieces++;
      // The affix follows the stat identity: Healing Power only on int+spi
      // (heal) lines, Spell Damage only on int-dominant (sd) lines.
      if (hp > 0 || sp > 0) {
        expect((item.stats?.int ?? 0) > 0, `${item.id} caster identity`).toBe(true);
        expect((item.stats?.str ?? 0) + (item.stats?.agi ?? 0), item.id).toBe(0);
      }
    }
    // 6 heal sets x 5 + 3 heal waist/feet pairs + 2 heal jewelry + barrier + orb.
    // ... plus the healing staff and the crozier.
    expect(healPieces).toBe(6 * 5 + 6 + 2 + 2 + 2);
    // 8 sd sets x 5 + 3 sd waist/feet pairs + 2 sd jewelry + the cinder held.
    // ... plus the damage staff and the wand.
    expect(sdPieces).toBe(8 * 5 + 6 + 2 + 1 + 2);
  });
});

describe('ignivar loot: the 10 weapons', () => {
  it('every weapon rides the ilvl-35 dps curve with its full registration', () => {
    // weaponDpsBudget(35) = 17.2; two-handers carry the TWOHAND_DPS_MULT
    // premium (19.78). Damage ranges were authored as round(avg x 0.8) to
    // round(avg x 1.2), so realized dps sits within rounding of the target.
    for (const item of Object.values(IGNIVAR_WEAPON_ITEMS)) {
      expect(item.kind, item.id).toBe('weapon');
      if (item.kind !== 'weapon') continue;
      const weapon = item.weapon;
      expect(weapon, item.id).toBeTruthy();
      if (!weapon) continue;
      const dps = (weapon.min + weapon.max) / 2 / weapon.speed;
      const target = item.hand === 'twohand' ? 17.2 * 1.15 : 17.2;
      expect(Math.abs(dps - target), `${item.id} dps ${dps} vs ${target}`).toBeLessThan(0.35);
      // Full weapon registration: a type row (skin eligibility + the guard in
      // tests/weapon_skins.test.ts) and a held-model variant with painted art.
      expect(WEAPON_TYPE_BY_ITEM[item.id], `${item.id} type row`).toBeTruthy();
      expect(ITEM_WEAPON_VARIANTS[item.id], `${item.id} variant row`).toBeTruthy();
      // Weapons carry the 70/30 rating pair.
      const ratings = [item.critRating ?? 0, item.hasteRating ?? 0, item.hitRating ?? 0].sort(
        (a, b) => b - a,
      );
      expect(ratings, item.id).toEqual([70, 30, 0]);
    }
  });

  it('the kris is a dagger (backstab eligibility)', () => {
    expect(WEAPON_TYPE_BY_ITEM.cinderfang_kris).toBe('dagger');
  });
});

describe('ignivar loot: the boss drop tables (one item per five raiders)', () => {
  // The cadence rule (docs/prd/ignivar-raid-loot.md, "Boss loot tables"): a
  // kill pays ONE item per five raiders on BOTH difficulties, two on the
  // 10-player raid. Slot one is the boss's merged sigil partition; slot two is
  // its Normal-only off-set partition, which a heroic claim skips
  // (LootEntry.normalOnly) so the HEROIC_BOSS_LOOT exclusive partition pays in
  // its place. Heroic therefore differs in WHICH items drop, never in how many.
  const groupsOf = (entries: readonly LootEntry[]) => {
    const groups = new Map<string, { ids: string[]; sum: number; normalOnly: Set<boolean> }>();
    for (const entry of entries) {
      if (!entry.rollGroup) continue;
      const group = groups.get(entry.rollGroup) ?? { ids: [], sum: 0, normalOnly: new Set() };
      if (entry.itemId) group.ids.push(entry.itemId);
      group.sum += entry.chance;
      group.normalOnly.add(entry.normalOnly === true);
      groups.set(entry.rollGroup, group);
    }
    return groups;
  };
  const chanceOf = (entries: readonly LootEntry[], id: string): number =>
    entries.find((entry) => entry.itemId === id)?.chance ?? 0;
  const shareOf = (entries: readonly LootEntry[], ids: readonly string[]): number =>
    ids.reduce((sum, id) => sum + chanceOf(entries, id), 0);
  const SIGIL_FAMILIES = ['anvil', 'ember', 'tempest'] as const;
  const familyShares = (entries: readonly LootEntry[], ids: readonly string[]) =>
    SIGIL_FAMILIES.map((family) =>
      shareOf(
        entries,
        ids.filter((id) => id.includes(`_${family}_`)),
      ),
    );

  it('Ignivar pays one sigil slot plus one Normal-only neck/waist/weapon slot, and the raid copper', () => {
    const loot = MOBS[IGNIVAR_BOSS_ID].loot ?? [];
    const money = loot[0];
    expect(money).toMatchObject({ copper: 150000, chance: 1 });
    expect(money.heroicCopper).toBeGreaterThan(0);
    const groups = groupsOf(loot);
    expect([...groups.keys()]).toEqual(['ignivar_sigils', 'ignivar_offset']);
    const sigils = [
      'sigil_anvil_shoulder',
      'sigil_ember_shoulder',
      'sigil_tempest_shoulder',
      'sigil_anvil_gloves',
      'sigil_ember_gloves',
      'sigil_tempest_gloves',
    ];
    expect(groups.get('ignivar_sigils')?.ids).toEqual(sigils);
    expect(groups.get('ignivar_sigils')?.normalOnly).toEqual(new Set([false]));
    // Both axes of the merged sigil partition stay balanced.
    expect(shareOf(loot, sigils.slice(0, 3))).toBeCloseTo(0.5, 6);
    expect(shareOf(loot, sigils.slice(3))).toBeCloseTo(0.5, 6);
    expect(familyShares(loot, sigils)).toEqual([0.34, 0.33, 0.33]);
    const necks = [
      'pendant_of_the_first_tempering',
      'ignivars_ember_choker',
      'locket_of_the_last_flame',
      'heartspring_amulet',
    ];
    const offset = groups.get('ignivar_offset');
    expect(offset?.ids.slice(0, 4)).toEqual(necks);
    expect(offset?.ids.length).toBe(4 + 10 + 3); // necks, waists, the smaller weapons
    expect(offset?.normalOnly).toEqual(new Set([true]));
    for (const id of offset?.ids.slice(4) ?? []) {
      expect(['waist', 'mainhand', 'offhand', 'ranged'], id).toContain(ITEMS[id].slot);
    }
    // The necks keep the half of the slot they used to own outright; the
    // waists and weapons split the other half on binary-exact weights, so the
    // partition is exactly 1.00 in floating point (see the table comment).
    expect(shareOf(loot, necks)).toBeCloseTo(0.5, 6);
    expect(shareOf(loot, offset?.ids.filter((id) => ITEMS[id].slot === 'waist') ?? [])).toBeCloseTo(
      0.3125,
      6,
    );
    expect(
      shareOf(loot, offset?.ids.filter((id) => ITEMS[id].kind === 'weapon') ?? []),
    ).toBeCloseTo(0.1875, 6);
    for (const [name, group] of groups) expect(group.sum, name).toBeCloseTo(1, 6);
  });

  it('Varkhul pays one sigil slot plus one Normal-only feet/held/ring slot, and copper', () => {
    const loot = MOBS[VARKHUL_BOSS_ID].loot ?? [];
    expect(loot[0]).toMatchObject({ copper: 200000, chance: 1 });
    const groups = groupsOf(loot);
    expect([...groups.keys()]).toEqual(['varkhul_sigils', 'varkhul_offset']);
    const sigils = [
      'sigil_anvil_legs',
      'sigil_ember_legs',
      'sigil_tempest_legs',
      'sigil_anvil_helmet',
      'sigil_ember_helmet',
      'sigil_tempest_helmet',
    ];
    expect(groups.get('varkhul_sigils')?.ids).toEqual(sigils);
    expect(groups.get('varkhul_sigils')?.normalOnly).toEqual(new Set([false]));
    expect(shareOf(loot, sigils.slice(0, 3))).toBeCloseTo(0.5, 6);
    expect(shareOf(loot, sigils.slice(3))).toBeCloseTo(0.5, 6);
    expect(familyShares(loot, sigils)).toEqual([0.34, 0.33, 0.33]);
    // Neither legendary belongs to the Normal table. Emberward is a
    // heroic-only Varkhul drop, while Forgebreaker remains reserved for the
    // crafting professions.
    const legendaryRows = loot.filter(
      (r) => 'itemId' in r && String(r.itemId).startsWith('varkhul_'),
    );
    expect(legendaryRows).toEqual([]);
    const offset = groups.get('varkhul_offset');
    expect(offset?.ids.length).toBe(10 + 2 + 4); // feet, both held offhands, the rings
    expect(offset?.normalOnly).toEqual(new Set([true]));
    expect(offset?.ids).toContain('orb_of_the_last_spring');
    expect(offset?.ids).toContain('cinder_of_the_first_design');
    const rings = [
      'seal_of_the_forgewall',
      'band_of_marked_strikes',
      'circle_of_cinders',
      'loop_of_quiet_springs',
    ];
    expect(offset?.ids.slice(-4)).toEqual(rings);
    for (const id of offset?.ids ?? []) {
      expect(['feet', 'offhand', 'ring'], id).toContain(ITEMS[id].slot);
    }
    // The rings keep the half of the slot they used to own outright; the feet
    // and held offhands split the other half on binary-exact weights, so the
    // partition is exactly 1.00 in floating point (see the table comment).
    expect(shareOf(loot, rings)).toBeCloseTo(0.5, 6);
    expect(shareOf(loot, offset?.ids.filter((id) => ITEMS[id].slot === 'feet') ?? [])).toBeCloseTo(
      0.3125,
      6,
    );
    expect(
      shareOf(loot, offset?.ids.filter((id) => ITEMS[id].slot === 'offhand') ?? []),
    ).toBeCloseTo(0.1875, 6);
    for (const [name, group] of groups) expect(group.sum, name).toBeCloseTo(1, 6);
  });

  it('the Inner Crucible is a registered heroic room, so the Varkhul appends are LIVE', () => {
    // The wing inherits the raid claim's difficulty from the arena
    // (instances/dungeons.ts), so the heroic-only appends below fire on a
    // heroic run. This pin keeps the tuning record and the loot appends in
    // lockstep: without the record a heroic run would reach a vanilla Varkhul
    // while still collecting the appends (free loot for zero difficulty).
    const tuning = HEROIC_DUNGEON_TUNING.ignivar_inner_crucible;
    expect(tuning).toBeDefined();
    expect(tuning?.finalBossId).toBe(VARKHUL_BOSS_ID);
  });

  it('Heroic appends are ONE exclusive slot per boss, Emberward at its absolute 3 percent', () => {
    const ignivar = HEROIC_BOSS_LOOT[IGNIVAR_BOSS_ID] ?? [];
    const varkhul = HEROIC_BOSS_LOOT[VARKHUL_BOSS_ID] ?? [];
    const ignivarGroups = groupsOf(ignivar);
    const varkhulGroups = groupsOf(varkhul);
    expect([...ignivarGroups.keys()]).toEqual(['ignivar_h_exclusive']);
    expect([...varkhulGroups.keys()]).toEqual(['varkhul_h_exclusive']);
    const robes = ['sigil_anvil_chest', 'sigil_ember_chest', 'sigil_tempest_chest'];
    const ignivarWeapons = ['forgefathers_warhammer', 'anvilguard_blade', 'springtouched_crozier'];
    expect(ignivarGroups.get('ignivar_h_exclusive')?.ids).toEqual([...robes, ...ignivarWeapons]);
    expect(shareOf(ignivar, robes)).toBeCloseTo(0.5, 6);
    expect(shareOf(ignivar, ignivarWeapons)).toBeCloseTo(0.5, 6);
    expect(familyShares(ignivar, robes)).toEqual([0.17, 0.17, 0.16]);
    const shields = ['bulwark_of_the_inner_crucible', 'ember_wardens_barrier', 'varkhul_emberward'];
    const varkhulWeapons = [
      'heart_of_the_end_greatblade',
      'forgefire_spire',
      'staff_of_the_last_spring',
    ];
    expect(varkhulGroups.get('varkhul_h_exclusive')?.ids).toEqual([
      ...robes,
      ...shields,
      ...varkhulWeapons,
    ]);
    expect(shareOf(varkhul, robes)).toBeCloseTo(0.35, 6);
    expect(shareOf(varkhul, shields)).toBeCloseTo(0.3, 6);
    expect(shareOf(varkhul, varkhulWeapons)).toBeCloseTo(0.35, 6);
    // The legendary's odds did not move with the re-cut: 3 percent per heroic
    // Varkhul kill, exactly what the shipped shield group paid.
    expect(varkhul.find((entry) => entry.itemId === 'varkhul_emberward')).toMatchObject({
      chance: 0.03,
      rollGroup: 'varkhul_h_exclusive',
    });
    for (const groups of [ignivarGroups, varkhulGroups])
      for (const [name, group] of groups) {
        expect(group.sum, name).toBeCloseTo(1, 6);
        expect(group.normalOnly, name).toEqual(new Set([false]));
      }
  });

  it('pins every row of every partition to its exact chance, in table order', () => {
    // The category shares above cannot see a redistribution INSIDE a category
    // (0.0625 x 3 to 0 / 0.125 / 0.0625 keeps the weapon share at 0.1875), so
    // each row's chance is pinned by id here, in draw order, on both tables.
    // Every chance is strictly positive: a zero-weight row is an unreachable
    // item, never a way to park one.
    const rowsOf = (entries: readonly LootEntry[], group: string): [string, number][] =>
      entries
        .filter((entry) => entry.rollGroup === group)
        .map((entry) => [entry.itemId ?? '', entry.chance]);
    const ignivar = MOBS[IGNIVAR_BOSS_ID].loot;
    const varkhul = MOBS[VARKHUL_BOSS_ID].loot;
    const ignivarHeroic = HEROIC_BOSS_LOOT[IGNIVAR_BOSS_ID] ?? [];
    const varkhulHeroic = HEROIC_BOSS_LOOT[VARKHUL_BOSS_ID] ?? [];
    expect(rowsOf(ignivar, 'ignivar_sigils')).toEqual([
      ['sigil_anvil_shoulder', 0.17],
      ['sigil_ember_shoulder', 0.17],
      ['sigil_tempest_shoulder', 0.16],
      ['sigil_anvil_gloves', 0.17],
      ['sigil_ember_gloves', 0.16],
      ['sigil_tempest_gloves', 0.17],
    ]);
    expect(rowsOf(ignivar, 'ignivar_offset')).toEqual([
      ['pendant_of_the_first_tempering', 0.125],
      ['ignivars_ember_choker', 0.125],
      ['locket_of_the_last_flame', 0.125],
      ['heartspring_amulet', 0.125],
      ['cord_of_the_last_flame', 0.03125],
      ['springbinder_sash', 0.03125],
      ['cinderbark_cinch', 0.03125],
      ['slagstalker_belt', 0.03125],
      ['moonscorch_waistwrap', 0.03125],
      ['grovetender_belt', 0.03125],
      ['forgewall_girdle', 0.03125],
      ['warforged_waistguard', 0.03125],
      ['stormkindled_chain', 0.03125],
      ['tidebinder_links', 0.03125],
      ['cinderfang_kris', 0.0625],
      ['slagrender_cleaver', 0.0625],
      ['wand_of_quenched_sparks', 0.0625],
    ]);
    expect(rowsOf(ignivarHeroic, 'ignivar_h_exclusive')).toEqual([
      ['sigil_anvil_chest', 0.17],
      ['sigil_ember_chest', 0.17],
      ['sigil_tempest_chest', 0.16],
      ['forgefathers_warhammer', 0.17],
      ['anvilguard_blade', 0.17],
      ['springtouched_crozier', 0.16],
    ]);
    expect(rowsOf(varkhul, 'varkhul_sigils')).toEqual([
      ['sigil_anvil_legs', 0.17],
      ['sigil_ember_legs', 0.17],
      ['sigil_tempest_legs', 0.16],
      ['sigil_anvil_helmet', 0.17],
      ['sigil_ember_helmet', 0.16],
      ['sigil_tempest_helmet', 0.17],
    ]);
    expect(rowsOf(varkhul, 'varkhul_offset')).toEqual([
      ['cindersoaked_slippers', 0.03125],
      ['steps_of_quiet_water', 0.03125],
      ['ashenbark_treads', 0.03125],
      ['ashrunner_boots', 0.03125],
      ['scorchgrove_striders', 0.03125],
      ['dewfall_moccasins', 0.03125],
      ['anvilstance_sabatons', 0.03125],
      ['furnace_march_greaves', 0.03125],
      ['thundershock_treads', 0.03125],
      ['springwarden_sabatons', 0.03125],
      ['orb_of_the_last_spring', 0.09375],
      ['cinder_of_the_first_design', 0.09375],
      ['seal_of_the_forgewall', 0.125],
      ['band_of_marked_strikes', 0.125],
      ['circle_of_cinders', 0.125],
      ['loop_of_quiet_springs', 0.125],
    ]);
    expect(rowsOf(varkhulHeroic, 'varkhul_h_exclusive')).toEqual([
      ['sigil_anvil_chest', 0.12],
      ['sigil_ember_chest', 0.12],
      ['sigil_tempest_chest', 0.11],
      ['bulwark_of_the_inner_crucible', 0.135],
      ['ember_wardens_barrier', 0.135],
      ['varkhul_emberward', 0.03],
      ['heart_of_the_end_greatblade', 0.12],
      ['forgefire_spire', 0.12],
      ['staff_of_the_last_spring', 0.11],
    ]);
    // The tables hold nothing else but the money row and the reagent rows.
    for (const [entries, groups] of [
      [ignivar, ['ignivar_sigils', 'ignivar_offset']],
      [varkhul, ['varkhul_sigils', 'varkhul_offset']],
    ] as const) {
      const rest = entries.filter((entry) => !entry.rollGroup);
      expect(rest.map((entry) => entry.itemId ?? 'copper')).toEqual([
        'copper',
        'lastflame_core',
        'lastflame_core',
      ]);
      expect(rest.slice(1).map((entry) => entry.chance)).toEqual([1, 0.5]);
      expect(
        new Set(entries.flatMap((entry) => (entry.rollGroup ? [entry.rollGroup] : []))),
      ).toEqual(new Set(groups));
    }
    for (const entry of [...ignivar, ...varkhul, ...ignivarHeroic, ...varkhulHeroic])
      expect(entry.chance, entry.itemId ?? 'copper').toBeGreaterThan(0);
  });

  it('every drop-table id resolves in the merged item table', () => {
    const all = [
      ...(MOBS[IGNIVAR_BOSS_ID].loot ?? []),
      ...(MOBS[VARKHUL_BOSS_ID].loot ?? []),
      ...(HEROIC_BOSS_LOOT[IGNIVAR_BOSS_ID] ?? []),
      ...(HEROIC_BOSS_LOOT[VARKHUL_BOSS_ID] ?? []),
    ];
    for (const entry of all) {
      if (entry.itemId) expect(ITEMS[entry.itemId], entry.itemId).toBeTruthy();
    }
  });

  it('a kill pays exactly one item per five raiders on BOTH difficulties, through the live roller', () => {
    // Rolls the real tables through rollLoot with and without a live heroic
    // claim (the same claim shape the roller reads in production), so the
    // cadence is pinned where it is paid, not just in the authored weights.
    // The crafting reagent rides outside the cadence (a material, not gear).
    const perKill = DUNGEON_DEFS[IGNIVAR_RAID_ARENA_ID].suggestedPlayers / 5;
    expect(perKill).toBe(2);
    expect(DUNGEON_DEFS[IGNIVAR_SECOND_WING_ID].suggestedPlayers).toBe(
      DUNGEON_DEFS[IGNIVAR_RAID_ARENA_ID].suggestedPlayers,
    );
    const bosses = [
      [IGNIVAR_BOSS_ID, IGNIVAR_RAID_ARENA_ID],
      [VARKHUL_BOSS_ID, IGNIVAR_SECOND_WING_ID],
    ] as const;
    const sim = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Raider');
    const meta = sim.ctx.players.get(pid);
    if (!meta) throw new Error('expected the raider');
    for (const [bossId, dungeonId] of bosses) {
      const template = MOBS[bossId];
      const base = template.loot ?? [];
      const sigilIds = new Set(
        base.filter((e) => e.rollGroup && !e.normalOnly).map((e) => e.itemId),
      );
      const offsetIds = new Set(base.filter((e) => e.normalOnly).map((e) => e.itemId));
      const exclusiveIds = new Set((HEROIC_BOSS_LOOT[bossId] ?? []).map((e) => e.itemId));
      for (const heroic of [false, true]) {
        for (let seed = 0; seed < 25; seed++) {
          sim.rng = new Rng(seed);
          const mob = createMob(-1, template, template.minLevel, { x: 0, y: 0, z: 0 });
          sim.ctx.instances.length = 0;
          if (heroic) {
            sim.ctx.instances.push({
              id: -1,
              dungeonId,
              difficulty: 'heroic',
              partyKey: 'raid',
              mobIds: [mob.id],
            } as unknown as (typeof sim.ctx.instances)[number]);
          }
          rollLoot(sim.ctx, mob, meta);
          const gear = (mob.loot?.items ?? [])
            .map((slot) => slot.itemId)
            .filter((id) => id !== 'lastflame_core');
          const label = `${bossId} ${heroic ? 'heroic' : 'normal'} seed ${seed}`;
          expect(gear.length, label).toBe(perKill);
          expect(gear.filter((id) => sigilIds.has(id)).length, label).toBe(1);
          expect(gear.filter((id) => offsetIds.has(id)).length, label).toBe(heroic ? 0 : 1);
          expect(gear.filter((id) => exclusiveIds.has(id)).length, label).toBe(heroic ? 1 : 0);
        }
      }
    }
  });
});

describe('the Crucible hit program reaches cap for every spec (the 2026-08-30 rebalance)', () => {
  // The lowered above-level ramp puts the heroic-raid caps at
  // (miss at +2) x HIT_RATING_PER_PCT x 100 rating; the tier's elective lanes
  // (waist, rings, weapon) must cover them for EVERY class so upgrading into
  // the tier never sheds cap the old lineage stack carried (the retribution
  // regression the lay-of-the-land study measured). Derived from the live
  // miss functions, so a table change re-decides this suite.
  const HEROIC_LEVEL_GAP_MELEE_MISS = meleeMissChance(20, 22);
  const HEROIC_LEVEL_GAP_SPELL_MISS = 0.99 - spellHitChance(20, 22);
  const meleeCap = Math.round(HEROIC_LEVEL_GAP_MELEE_MISS * HIT_RATING_PER_PCT * 100);
  const spellCap = Math.round(HEROIC_LEVEL_GAP_SPELL_MISS * HIT_RATING_PER_PCT * 100);
  const crucible = Object.values(IGNIVAR_LOOT_ITEMS);

  it('the guaranteed elective floor (any waist + two rings + any weapon) covers both caps', () => {
    const minWaist = Math.min(
      ...crucible.filter((i) => i.slot === 'waist').map((i) => i.hitRating ?? 0),
    );
    const rings = crucible
      .filter((i) => i.slot === 'ring')
      .map((i) => i.hitRating ?? 0)
      .sort((a, b) => a - b);
    const minWeapon = Math.min(
      ...crucible.filter((i) => i.kind === 'weapon').map((i) => i.hitRating ?? 0),
    );
    const floor = minWaist + rings[0] + rings[1] + minWeapon;
    expect(minWaist).toBeGreaterThanOrEqual(60);
    expect(rings[0]).toBeGreaterThanOrEqual(25);
    expect(minWeapon).toBeGreaterThanOrEqual(30);
    expect(floor).toBeGreaterThanOrEqual(meleeCap);
    expect(floor).toBeGreaterThanOrEqual(spellCap);
    // The caps themselves stay honest against the live miss table.
    expect(meleeCap).toBe(130);
    expect(spellCap).toBe(110);
  });

  it('the elective lanes are Normal-only partitions, so the floor is farmed from the Normal lock', () => {
    // The one-item-per-five re-cut made every non-weapon hit elective a
    // Normal-only drop (LootEntry.normalOnly): the waists and necks sit in
    // Ignivar's off-set partition, the rings in Varkhul's, and the Heroic
    // exclusive pools carry hit ONLY on the marquee weapons. A Heroic roster
    // therefore farms its cap from its Normal lock (a separate weekly lockout),
    // which is the intended shape: Heroic pays exclusives, Normal pays the
    // electives. Pinned per difficulty so a future re-cut that strands a lane
    // on neither table, or quietly re-seats one, re-decides this suite.
    const normalOnlyIds = (bossId: string, group: string) =>
      new Set(
        MOBS[bossId].loot
          .filter((entry) => entry.rollGroup === group && entry.normalOnly)
          .map((entry) => entry.itemId),
      );
    const ignivarOffset = normalOnlyIds(IGNIVAR_BOSS_ID, 'ignivar_offset');
    const varkhulOffset = normalOnlyIds(VARKHUL_BOSS_ID, 'varkhul_offset');
    for (const item of crucible.filter((i) => i.slot === 'waist' || i.slot === 'neck'))
      expect(ignivarOffset.has(item.id), item.id).toBe(true);
    for (const item of crucible.filter((i) => i.slot === 'ring'))
      expect(varkhulOffset.has(item.id), item.id).toBe(true);
    // Both partitions are guaranteed Normal draws (sum exactly 1), so the
    // floor above is farmable, never a bonus roll.
    for (const [bossId, group] of [
      [IGNIVAR_BOSS_ID, 'ignivar_offset'],
      [VARKHUL_BOSS_ID, 'varkhul_offset'],
    ] as const) {
      const sum = MOBS[bossId].loot
        .filter((entry) => entry.rollGroup === group)
        .reduce((acc, entry) => acc + entry.chance, 0);
      expect(sum, group).toBe(1);
    }
    // The Heroic-exclusive hit carriers are exactly the six marquee weapons at
    // 30, so a Heroic-only kit tops out at 60 (both hands) against both caps:
    // the Normal lock is load-bearing for hit, by design.
    const heroicIds = [
      ...(HEROIC_BOSS_LOOT[IGNIVAR_BOSS_ID] ?? []),
      ...(HEROIC_BOSS_LOOT[VARKHUL_BOSS_ID] ?? []),
    ].flatMap((entry) => (entry.itemId ? [entry.itemId] : []));
    const heroicHitCarriers = heroicIds.filter((id) => (ITEMS[id].hitRating ?? 0) > 0).sort();
    expect(heroicHitCarriers).toEqual([
      'anvilguard_blade',
      'forgefathers_warhammer',
      'forgefire_spire',
      'heart_of_the_end_greatblade',
      'springtouched_crozier',
      'staff_of_the_last_spring',
    ]);
    for (const id of heroicHitCarriers) expect(ITEMS[id].hitRating, id).toBe(30);
    expect(2 * 30).toBeLessThan(Math.min(meleeCap, spellCap));
  });

  it('every class can wear a hit waist and a hit weapon from the tier', () => {
    const classes = [
      'warrior',
      'paladin',
      'hunter',
      'rogue',
      'priest',
      'shaman',
      'mage',
      'warlock',
      'druid',
    ] as const;
    for (const cls of classes) {
      const wearable = (i: (typeof crucible)[number]) =>
        i.requiredClass === undefined || i.requiredClass.includes(cls);
      const waist = crucible.some(
        (i) => i.slot === 'waist' && wearable(i) && (i.hitRating ?? 0) >= 60,
      );
      const weapon = crucible.some(
        (i) => i.kind === 'weapon' && wearable(i) && (i.hitRating ?? 0) >= 30,
      );
      expect(waist, `${cls} hit waist`).toBe(true);
      expect(weapon, `${cls} hit weapon`).toBe(true);
    }
  });
});
