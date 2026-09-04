import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bagCapacity } from '../src/sim/bags';
import { ITEMS } from '../src/sim/data';
import {
  equipCandidateIndex,
  equipCandidateInstance,
  equipCandidateQuality,
  MASTERWROUGHT_EQUIP_CAP,
  MASTERWROUGHT_LEGENDARY_CAP,
  masterwroughtConflictSlot,
} from '../src/sim/equipment_rules';
import { Sim } from '../src/sim/sim';
import { type EquipSlot, type ItemDef, isEquipSlot } from '../src/sim/types';
import { supportedLanguages } from '../src/ui/i18n';
import { guideStrings } from '../src/ui/i18n.catalog/guide';
import { ja_JP } from '../src/ui/i18n.locales/ja_JP';
import { ko_KR } from '../src/ui/i18n.locales/ko_KR';
import { ru_RU } from '../src/ui/i18n.locales/ru_RU';
import { zh_CN } from '../src/ui/i18n.locales/zh_CN';
import { zh_TW } from '../src/ui/i18n.locales/zh_TW';
import { DICT } from '../src/ui/sim_i18n';
import { EMPTY_TEST_WORLD } from './sim_shared';

// The five non-Latin overlays, keyed for the guide cap-copy sweep below.
const GUIDE_FILL_BY_LOCALE: Record<string, Partial<Record<string, string>>> = {
  ru_RU,
  ja_JP,
  ko_KR,
  zh_CN,
  zh_TW,
};

// Masterwrought is a COUNTED equip family, not a per-item one: a character may
// wear at most two flagged pieces, and at most one of those may be legendary by
// EFFECTIVE quality (a copy's rolled quality overrides its def's). Duplicate
// copies of one flagged item are legal inside the cap, a two-hander occupies a
// single slot and so counts once, and a save written before the rule existed
// keeps every piece it was wearing: only the NEXT flagged equip is refused.

const CAP_ERROR = 'You can only equip two Masterwrought items.';
const LEGENDARY_ERROR = 'You can only equip one legendary Masterwrought item.';

// Synthetic pieces covering the slot shapes the rule has to count: two jewelry
// sockets plus a neck (three flagged pieces with no armor-weight or dual-wield
// preconditions), a shield the two-hander displaces, and the two-hander itself.
// Injected into the live ITEMS table the way unique_equipped/grant_line_view do,
// and removed afterward. Since phase 08 the flag also SHIPS on the apex armor,
// and since phase 09 on the apex weapons/shield/jewelry/held gear
// (tests/masterwrought_budget.test.ts owns that catalog); the shipped-gear R6
// interplay has its own describe below, while the synthetic set stays for the
// shapes no shipped item carries (legendary quality, preconditions-free
// pieces, and the worn offhand).
const RING_ID = 'test_masterwrought_ring';
const AMULET_ID = 'test_masterwrought_amulet';
const EMBER_ID = 'test_masterwrought_ember_band';
const ASH_ID = 'test_masterwrought_ash_band';
const BULWARK_ID = 'test_masterwrought_bulwark';
const GREATSWORD_ID = 'test_masterwrought_greatsword';
const UNFLAGGED_ID = 'test_masterwrought_unflagged_signet';
const WORN_OFFHAND_ID = 'test_masterwrought_worn_quiver';

beforeAll(() => {
  ITEMS[RING_ID] = {
    id: RING_ID,
    name: 'Test Masterwrought Ring',
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    masterwrought: true,
    requiredLevel: 20,
    stats: { sta: 1 },
    sellValue: 1,
  } as ItemDef;
  ITEMS[AMULET_ID] = {
    id: AMULET_ID,
    name: 'Test Masterwrought Amulet',
    kind: 'armor',
    slot: 'neck',
    quality: 'epic',
    masterwrought: true,
    requiredLevel: 20,
    stats: { sta: 1 },
    sellValue: 1,
  } as ItemDef;
  ITEMS[EMBER_ID] = {
    id: EMBER_ID,
    name: 'Test Masterwrought Ember Band',
    kind: 'armor',
    slot: 'ring',
    quality: 'legendary',
    masterwrought: true,
    requiredLevel: 20,
    stats: { sta: 2 },
    sellValue: 1,
  } as ItemDef;
  ITEMS[ASH_ID] = {
    id: ASH_ID,
    name: 'Test Masterwrought Ash Band',
    kind: 'armor',
    slot: 'ring',
    quality: 'legendary',
    masterwrought: true,
    requiredLevel: 20,
    stats: { sta: 2 },
    sellValue: 1,
  } as ItemDef;
  ITEMS[BULWARK_ID] = {
    id: BULWARK_ID,
    name: 'Test Masterwrought Bulwark',
    kind: 'armor',
    slot: 'offhand',
    shield: true,
    quality: 'epic',
    masterwrought: true,
    requiredLevel: 20,
    stats: { armor: 40 },
    sellValue: 1,
  } as ItemDef;
  ITEMS[GREATSWORD_ID] = {
    id: GREATSWORD_ID,
    name: 'Test Masterwrought Greatsword',
    kind: 'weapon',
    slot: 'mainhand',
    hand: 'twohand',
    quality: 'epic',
    masterwrought: true,
    requiredLevel: 20,
    weapon: { min: 10, max: 20, speed: 3.0 },
    requiredClass: ['warrior', 'rogue', 'hunter', 'shaman', 'paladin'],
    stats: { str: 1 },
    sellValue: 1,
  } as ItemDef;
  ITEMS[UNFLAGGED_ID] = {
    id: UNFLAGGED_ID,
    name: 'Test Unflagged Signet',
    kind: 'armor',
    slot: 'ring',
    quality: 'legendary',
    requiredLevel: 20,
    stats: { sta: 1 },
    sellValue: 1,
  } as ItemDef;
  ITEMS[WORN_OFFHAND_ID] = {
    id: WORN_OFFHAND_ID,
    name: 'Test Masterwrought Worn Quiver',
    kind: 'held_offhand',
    slot: 'offhand',
    // The quiver shape: WORN rather than held, so a two-hander coexists
    // with it (no shipped flagged item carries this yet; synthetic idiom).
    occupiesHand: false,
    quality: 'epic',
    masterwrought: true,
    requiredLevel: 20,
    stats: { sta: 1 },
    sellValue: 1,
  } as ItemDef;
});

afterAll(() => {
  for (const id of [
    RING_ID,
    AMULET_ID,
    EMBER_ID,
    ASH_ID,
    BULWARK_ID,
    GREATSWORD_ID,
    UNFLAGGED_ID,
    WORN_OFFHAND_ID,
  ]) {
    delete ITEMS[id];
  }
});

// EMPTY_TEST_WORLD (the gate-perf trim): every case here is addItem/equip
// driven against synthetic ids, so no arm reads a camp, npc, or ground
// object; zones/terrain/playerStart stay identical to the built-in world.
function makeWarrior(seed: number): Sim {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: true, world: EMPTY_TEST_WORLD });
  sim.setPlayerLevel(60);
  return sim;
}

// The shipped-gear R6 cases need a class inside BOTH phase 09 gate lists:
// shaman sits in the HEAVY melee group (ridgebreaker) and the caster
// proficiency group (the held offhands).
function makeShaman(seed: number): Sim {
  const sim = new Sim({ seed, playerClass: 'shaman', autoEquip: true, world: EMPTY_TEST_WORLD });
  sim.setPlayerLevel(60);
  return sim;
}

// Grant without the auto-equip convenience firing: every enforcement case below
// drives the explicit equip path, which is where the refusal toast belongs.
function grant(sim: Sim, itemId: string, count = 1, pid?: number): void {
  const meta = sim.meta(pid ?? sim.playerId);
  if (meta) meta.autoEquip = false;
  sim.addItem(itemId, count, pid);
}

function tickErrors(sim: Sim, pid?: number): string[] {
  return sim
    .tick()
    .filter((e) => e.type === 'error' && (pid === undefined || e.pid === pid))
    .map((e) => (e.type === 'error' ? e.text : ''));
}

describe('masterwrought cap constants', () => {
  it('pins the two caps the player-facing copy is written against', () => {
    // Both numbers are spelled out as PROSE in the refusal lines ("two", "one")
    // in every locale, and the tooltip {count} interpolates the equip cap.
    // Retuning either cap means rewriting that copy everywhere, so it can
    // never be a quiet one-line constant edit: this pin is the reminder.
    expect(MASTERWROUGHT_EQUIP_CAP).toBe(2);
    expect(MASTERWROUGHT_LEGENDARY_CAP).toBe(1);
    // The suite's literals ARE the registered English matcher rows; the S3
    // guard ties those rows to the emit site in items.ts, so this closes the
    // chain from test literal to matcher to emit with no self-comparison link.
    expect(DICT.en['error.masterwroughtCap']).toBe(CAP_ERROR);
    expect(DICT.en['error.masterwroughtLegendary']).toBe(LEGENDARY_ERROR);
    // The guide gear page spells BOTH caps as prose too, in English and five
    // non-Latin fills: one more copy site the cap retune sweep above must
    // reach. The live key is masterwroughtBodyLegendary (phase 13 reword-as-
    // new-key; the retired masterwroughtBody stays in the catalog until the
    // release fill retires it and is no longer pinned here). Both expected
    // words are DERIVED from the constants so a retune itself reds here, not
    // only a reword.
    const CAP_WORDS: Record<number, string> = { 1: 'one', 2: 'two', 3: 'three', 4: 'four' };
    expect(guideStrings.gear.masterwroughtBodyLegendary).toContain(
      `at most ${CAP_WORDS[MASTERWROUGHT_EQUIP_CAP]} Masterwrought`,
    );
    expect(guideStrings.gear.masterwroughtBodyLegendary).toContain(
      `at most ${CAP_WORDS[MASTERWROUGHT_LEGENDARY_CAP]} legendary Masterwrought`,
    );
    // The five non-Latin fills restate both numbers in their own scripts; each
    // is pinned by the wording that carries the cap in that locale, so a
    // stale fill after a cap retune reds per locale instead of hiding behind
    // the English pin. The tables are the cap-2/legendary-1 edition: a retune
    // re-cuts them beside the copy, which is the point.
    expect(MASTERWROUGHT_EQUIP_CAP).toBe(2);
    expect(MASTERWROUGHT_LEGENDARY_CAP).toBe(1);
    const CAP_PROSE_BY_LOCALE: Record<string, string> = {
      ru_RU: 'не более двух',
      ja_JP: '最大2つまで',
      ko_KR: '최대 두 개까지만',
      zh_CN: '最多只能穿戴两件',
      zh_TW: '最多只能穿戴兩件',
    };
    const LEGENDARY_PROSE_BY_LOCALE: Record<string, string> = {
      ru_RU: 'не более одного',
      ja_JP: '伝説の名匠鍛造の品は最大1つまで',
      ko_KR: '전설 명장 제작 장비는 동시에 최대 한 개까지만',
      zh_CN: '最多只能有一件传说品质的大师锻造装备',
      zh_TW: '最多只能有一件傳說品質的大師鍛造裝備',
    };
    for (const [locale, prose] of Object.entries(CAP_PROSE_BY_LOCALE)) {
      expect(
        GUIDE_FILL_BY_LOCALE[locale]?.['guide.gear.masterwroughtBodyLegendary'],
        locale,
      ).toContain(prose);
    }
    for (const [locale, prose] of Object.entries(LEGENDARY_PROSE_BY_LOCALE)) {
      expect(
        GUIDE_FILL_BY_LOCALE[locale]?.['guide.gear.masterwroughtBodyLegendary'],
        locale,
      ).toContain(prose);
    }
  });

  it('carries a real translation of both refusals in every non-English locale', () => {
    // The sim DICT scope is invisible to the release-fill worklist, and the
    // DICT assembly backfills a dropped row with English, so the S2 key-count
    // parity can never notice one going missing. Byte-identical English in a
    // non-en block is exactly that silent leak, and this is the guard for it.
    // en_CA deliberately inherits English; en_XA is not a supported language.
    const locales = supportedLanguages.filter((lang) => lang !== 'en' && lang !== 'en_CA');
    expect(locales.length).toBeGreaterThanOrEqual(20);
    for (const lang of locales) {
      for (const key of ['error.masterwroughtCap', 'error.masterwroughtLegendary'] as const) {
        const row = DICT[lang][key];
        expect(row && row.trim().length > 0, `${lang}.${key} empty or missing`).toBe(true);
        expect(row, `${lang}.${key} left as English`).not.toBe(DICT.en[key]);
      }
    }
  });
});

describe('equip unit selection (pure equipment_rules)', () => {
  const def: ItemDef = {
    id: 'pure_selection_ring',
    name: 'Pure Selection Ring',
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    stats: {},
    sellValue: 1,
  } as ItemDef;

  it('selects the highest matching index and reads that copy quality', () => {
    const inventory = [
      { itemId: 'pure_selection_ring', count: 1, instance: { rolled: { quality: 'legendary' } } },
      { itemId: 'other', count: 1 },
      { itemId: 'pure_selection_ring', count: 1 },
    ];
    expect(equipCandidateIndex(inventory, 'pure_selection_ring')).toBe(2);
    // Index 2 is a plain copy, so the def quality answers; the legendary roll
    // sitting lower in the bags is NOT what an equip would take.
    expect(equipCandidateQuality(inventory, 'pure_selection_ring', def)).toBe('epic');
  });

  it('falls back to the def quality when the item is not carried at all', () => {
    expect(equipCandidateIndex([], 'pure_selection_ring')).toBe(-1);
    expect(equipCandidateQuality([], 'pure_selection_ring', def)).toBe('epic');
    const rolled = [
      { itemId: 'pure_selection_ring', count: 1, instance: { rolled: { quality: 'legendary' } } },
    ];
    expect(equipCandidateQuality(rolled, 'pure_selection_ring', def)).toBe('legendary');
  });

  it('an explicit slotIndex naming a valid cell judges exactly that copy', () => {
    // The 2026-08-27 review: the consume honors slotIndex, so the peek must
    // judge the SAME cell, in both directions (a promoted copy under a
    // plain one, and a plain copy under a promoted one).
    const inventory = [
      { itemId: 'pure_selection_ring', count: 1, instance: { rolled: { quality: 'legendary' } } },
      { itemId: 'other', count: 1 },
      { itemId: 'pure_selection_ring', count: 1 },
    ];
    expect(equipCandidateIndex(inventory, 'pure_selection_ring', 0)).toBe(0);
    expect(equipCandidateQuality(inventory, 'pure_selection_ring', def, 0)).toBe('legendary');
    expect(equipCandidateInstance(inventory, 'pure_selection_ring', 0)).toBe(inventory[0].instance);
    expect(equipCandidateQuality(inventory, 'pure_selection_ring', def, 2)).toBe('epic');
    expect(equipCandidateInstance(inventory, 'pure_selection_ring', 2)).toBeUndefined();
  });

  it('an invalid slotIndex falls back to the highest-index rule, never another cell', () => {
    const inventory = [
      { itemId: 'pure_selection_ring', count: 1, instance: { rolled: { quality: 'legendary' } } },
      { itemId: 'other', count: 1 },
      { itemId: 'pure_selection_ring', count: 1 },
    ];
    // Wrong id at the named cell, out of range, negative, fractional: each
    // answers the id-only walk (index 2, the plain copy).
    for (const bad of [1, 99, -1, 0.5]) {
      expect(equipCandidateIndex(inventory, 'pure_selection_ring', bad), String(bad)).toBe(2);
      expect(equipCandidateQuality(inventory, 'pure_selection_ring', def, bad)).toBe('epic');
    }
  });

  it('an emptied cell (count 0) is not a candidate on either arm', () => {
    // The named-cell arm has always required count >= 1; the highest-index
    // fallback walk matched on itemId alone, so a stale count-0 cell above a
    // real copy answered as the unit an id-only equip would take. Both arms now
    // read the same rule: a cell holding nothing holds nothing.
    const inventory = [
      { itemId: 'pure_selection_ring', count: 1, instance: { rolled: { quality: 'legendary' } } },
      { itemId: 'other', count: 1 },
      { itemId: 'pure_selection_ring', count: 0 },
    ];
    // The fallback walk skips the emptied top cell for the real copy below it,
    // and reads THAT copy's rolled quality rather than the def's.
    expect(equipCandidateIndex(inventory, 'pure_selection_ring')).toBe(0);
    expect(equipCandidateQuality(inventory, 'pure_selection_ring', def)).toBe('legendary');
    // Naming the emptied cell explicitly falls back to the same answer, never
    // to the emptied cell itself.
    expect(equipCandidateIndex(inventory, 'pure_selection_ring', 2)).toBe(0);
    // With no other copy carried, an emptied cell means the item is not held.
    const onlyEmpty = [{ itemId: 'pure_selection_ring', count: 0 }];
    expect(equipCandidateIndex(onlyEmpty, 'pure_selection_ring')).toBe(-1);
    expect(equipCandidateIndex(onlyEmpty, 'pure_selection_ring', 0)).toBe(-1);
    // A negative count is the same non-holding: the check is >= 1, not != 0.
    const negative = [{ itemId: 'pure_selection_ring', count: -1 }];
    expect(equipCandidateIndex(negative, 'pure_selection_ring')).toBe(-1);
  });
});

describe('masterwrought counted family (pure equipment_rules)', () => {
  const flaggedRing: ItemDef = {
    id: 'pure_mw_ring',
    name: 'Pure Masterwrought Ring',
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    masterwrought: true,
    stats: {},
    sellValue: 1,
  } as ItemDef;
  const flaggedNeck: ItemDef = {
    ...flaggedRing,
    id: 'pure_mw_neck',
    slot: 'neck',
  } as ItemDef;
  const flaggedLegendary: ItemDef = {
    ...flaggedRing,
    id: 'pure_mw_legendary',
    quality: 'legendary',
  } as ItemDef;
  const flaggedLegendaryTwin: ItemDef = {
    ...flaggedLegendary,
    id: 'pure_mw_legendary_twin',
  } as ItemDef;
  const unflagged: ItemDef = {
    ...flaggedRing,
    id: 'pure_plain_ring',
    masterwrought: false,
  } as ItemDef;
  const defs: Record<string, ItemDef> = {
    pure_mw_ring: flaggedRing,
    pure_mw_neck: flaggedNeck,
    pure_mw_legendary: flaggedLegendary,
    pure_mw_legendary_twin: flaggedLegendaryTwin,
    pure_plain_ring: unflagged,
  };
  const lookup = (id: string) => defs[id];
  const none: readonly EquipSlot[] = [];

  it('reports a cap conflict once two flagged pieces are already worn', () => {
    const equipment = { neck: 'pure_mw_neck', ring1: 'pure_mw_ring' };
    // ALL_EQUIP_SLOTS order decides which slot is named: neck precedes ring1.
    expect(masterwroughtConflictSlot(flaggedRing, equipment, lookup, none)).toEqual({
      slot: 'neck',
      reason: 'cap',
    });
  });

  it('permits a second flagged piece when only one is worn', () => {
    expect(masterwroughtConflictSlot(flaggedRing, { ring1: 'pure_mw_ring' }, lookup, none)).toBe(
      null,
    );
  });

  it('exempts the target slot and a displaced slot from the count', () => {
    const equipment = { mainhand: 'pure_mw_ring', offhand: 'pure_mw_neck', ring1: 'pure_mw_ring' };
    // Without the exemption these three worn pieces are a cap conflict; the
    // swap empties two of them, leaving one.
    expect(masterwroughtConflictSlot(flaggedRing, equipment, lookup, none)).not.toBeNull();
    expect(
      masterwroughtConflictSlot(flaggedRing, equipment, lookup, ['mainhand', 'offhand']),
    ).toBeNull();
  });

  it('allows duplicate copies of one flagged item inside the cap', () => {
    expect(
      masterwroughtConflictSlot(flaggedRing, { ring1: 'pure_mw_ring' }, lookup, ['ring2']),
    ).toBeNull();
    // The duplicate pair still counts toward the cap: a THIRD copy is refused
    // for being third, never for sharing an id.
    expect(
      masterwroughtConflictSlot(
        flaggedRing,
        { ring1: 'pure_mw_ring', ring2: 'pure_mw_ring' },
        lookup,
        none,
      ),
    ).toEqual({ slot: 'ring1', reason: 'cap' });
  });

  it('never conflicts for an unflagged item however many flagged pieces are worn', () => {
    const equipment = {
      neck: 'pure_mw_neck',
      ring1: 'pure_mw_legendary',
      ring2: 'pure_mw_legendary_twin',
    };
    expect(masterwroughtConflictSlot(unflagged, equipment, lookup, none)).toBeNull();
    expect(
      masterwroughtConflictSlot(
        { ...unflagged, masterwrought: undefined } as ItemDef,
        equipment,
        lookup,
        none,
      ),
    ).toBeNull();
  });

  it('refuses a second legendary flagged piece while a plain one still fits', () => {
    const equipment = { ring1: 'pure_mw_legendary' };
    expect(masterwroughtConflictSlot(flaggedLegendaryTwin, equipment, lookup, none)).toEqual({
      slot: 'ring1',
      reason: 'legendary',
    });
    expect(masterwroughtConflictSlot(flaggedRing, equipment, lookup, none)).toBeNull();
  });

  it('reads a worn piece by its rolled quality, above the def quality', () => {
    const equipment = { ring1: 'pure_mw_ring' };
    // Epic def, legendary roll: it occupies the legendary sub-cap.
    expect(
      masterwroughtConflictSlot(flaggedLegendary, equipment, lookup, none, {
        ring1: { rolled: { quality: 'legendary' } },
      }),
    ).toEqual({ slot: 'ring1', reason: 'legendary' });
    // And the same override downward: a legendary def worn as an epic roll
    // leaves the sub-cap free.
    expect(
      masterwroughtConflictSlot(flaggedLegendary, { ring1: 'pure_mw_legendary' }, lookup, none, {
        ring1: { rolled: { quality: 'epic' } },
      }),
    ).toBeNull();
  });

  it('reads the incoming piece by the caller-supplied quality, above the def quality', () => {
    const worn = { ring1: 'pure_mw_legendary' };
    // Epic def carried as a legendary copy: refused.
    expect(
      masterwroughtConflictSlot(flaggedRing, worn, lookup, none, undefined, 'legendary'),
    ).toEqual({ slot: 'ring1', reason: 'legendary' });
    // Legendary def carried as an epic copy: allowed.
    expect(
      masterwroughtConflictSlot(flaggedLegendary, worn, lookup, none, undefined, 'epic'),
    ).toBeNull();
  });

  it('names the cap reason ahead of the legendary reason when both would apply', () => {
    const atCap = { neck: 'pure_mw_legendary', ring1: 'pure_mw_legendary_twin' };
    expect(masterwroughtConflictSlot(flaggedLegendary, atCap, lookup, none)?.reason).toBe('cap');
    const oneWorn = { ring1: 'pure_mw_legendary' };
    expect(masterwroughtConflictSlot(flaggedLegendary, oneWorn, lookup, none)?.reason).toBe(
      'legendary',
    );
  });

  it('treats an unrecognized quality string as non-legendary (the sub-cap fails open)', () => {
    // Both compares are strict === 'legendary': a typo or a future tier name
    // never consumes the sub-cap and never blocks an equip as if it did. The
    // piece COUNT is quality-blind either way, so only the sub-cap is at stake.
    expect(
      masterwroughtConflictSlot(
        flaggedRing,
        { ring1: 'pure_mw_legendary' },
        lookup,
        none,
        undefined,
        'mythic',
      ),
    ).toBeNull();
    expect(
      masterwroughtConflictSlot(flaggedLegendary, { ring1: 'pure_mw_ring' }, lookup, none, {
        ring1: { rolled: { quality: 'Legendary' } },
      }),
    ).toBeNull();
  });
});

describe('masterwrought cap enforcement (equipItem)', () => {
  it('wears two flagged pieces and refuses a third', () => {
    const sim = makeWarrior(7101);
    grant(sim, RING_ID);
    grant(sim, AMULET_ID);
    grant(sim, BULWARK_ID);

    sim.equipItem(RING_ID);
    sim.equipItem(AMULET_ID);
    sim.tick();
    expect(sim.equipment.ring1).toBe(RING_ID);
    expect(sim.equipment.neck).toBe(AMULET_ID);

    const before = { ...sim.equipment };
    sim.equipItemToSlot(BULWARK_ID, 'offhand');
    const errors = tickErrors(sim);

    expect(errors).toContain(CAP_ERROR);
    expect({ ...sim.equipment }).toEqual(before);
    expect(sim.countItem(BULWARK_ID)).toBe(1);
  });

  it('refuses a second legendary flagged piece but still takes a plain one', () => {
    const sim = makeWarrior(7102);
    grant(sim, EMBER_ID);
    grant(sim, ASH_ID);
    grant(sim, AMULET_ID);

    sim.equipItem(EMBER_ID);
    sim.tick();
    expect(sim.equipment.ring1).toBe(EMBER_ID);

    sim.equipItem(ASH_ID);
    const refusals = tickErrors(sim);
    expect(refusals).toContain(LEGENDARY_ERROR);
    expect(refusals).not.toContain(CAP_ERROR);
    expect(sim.equipment.ring2).toBeUndefined();
    expect(sim.countItem(ASH_ID)).toBe(1);

    // The sub-cap is about legendaries only: the second flagged piece may still
    // be worn as long as it is not one.
    sim.equipItem(AMULET_ID);
    expect(tickErrors(sim)).toHaveLength(0);
    expect(sim.equipment.neck).toBe(AMULET_ID);
  });

  it('allows swapping a flagged piece into an occupied flagged slot at the cap', () => {
    const sim = makeWarrior(7103);
    grant(sim, RING_ID);
    grant(sim, AMULET_ID);
    grant(sim, EMBER_ID);

    sim.equipItem(RING_ID);
    sim.equipItem(AMULET_ID);
    sim.tick();

    // At the cap, but the target slot is emptied by this very equip.
    sim.equipItemToSlot(EMBER_ID, 'ring1');
    expect(tickErrors(sim)).toHaveLength(0);
    expect(sim.equipment.ring1).toBe(EMBER_ID);
    expect(sim.equipment.neck).toBe(AMULET_ID);
    expect(sim.countItem(RING_ID)).toBe(1);
  });

  it('counts a flagged two-hander once and does not double count what it displaces', () => {
    const sim = makeWarrior(7104);
    grant(sim, RING_ID);
    grant(sim, BULWARK_ID);
    grant(sim, GREATSWORD_ID);
    grant(sim, AMULET_ID);

    sim.equipItem(RING_ID);
    sim.equipItemToSlot(BULWARK_ID, 'offhand');
    sim.tick();
    expect(sim.equipment.offhand).toBe(BULWARK_ID);

    // Ring plus shield is already the cap, but the two-hander benches the
    // shield, so the pieces actually worn afterward are ring plus two-hander.
    sim.equipItemToSlot(GREATSWORD_ID, 'mainhand');
    expect(tickErrors(sim)).toHaveLength(0);
    expect(sim.equipment.mainhand).toBe(GREATSWORD_ID);
    expect(sim.equipment.offhand).toBeUndefined();
    expect(sim.equipment.ring1).toBe(RING_ID);
    expect(sim.countItem(BULWARK_ID)).toBe(1);

    // Two occupied slots, so the neck piece is the third and is refused.
    sim.equipItem(AMULET_ID);
    expect(tickErrors(sim)).toContain(CAP_ERROR);
    expect(sim.equipment.neck).toBeUndefined();
  });

  it('auto-equip fills up to the cap and then skips without a toast', () => {
    const sim = makeWarrior(7108);
    // autoEquip stays on: the loot path equips the first two flagged pieces
    // into their empty slots, then must decline the third SILENTLY (auto-equip
    // is a convenience; the explicit equip path owns the refusal).
    sim.addItem(RING_ID, 1);
    sim.addItem(AMULET_ID, 1);
    sim.tick();
    expect(sim.equipment.ring1).toBe(RING_ID);
    expect(sim.equipment.neck).toBe(AMULET_ID);

    sim.addItem(RING_ID, 1);
    expect(tickErrors(sim)).toHaveLength(0);
    expect(sim.equipment.ring2).toBeUndefined();
    expect(sim.countItem(RING_ID)).toBe(1);
  });

  it('lets the unique-equipped rule answer first for a def-legendary duplicate', () => {
    const sim = makeWarrior(7109);
    grant(sim, EMBER_ID, 2);

    sim.equipItem(EMBER_ID);
    sim.tick();
    expect(sim.equipment.ring1).toBe(EMBER_ID);

    // Every legendary is unique-equipped by quality, and that check runs ahead
    // of this one, so a second copy of the SAME legendary is refused as a
    // duplicate and never reaches the counted-family arms.
    sim.equipItem(EMBER_ID);
    const errors = tickErrors(sim);
    expect(errors).toContain('You can only equip one of those.');
    expect(errors).not.toContain(LEGENDARY_ERROR);
    expect(errors).not.toContain(CAP_ERROR);
    expect(sim.equipment.ring2).toBeUndefined();
  });

  it('answers with the cap refusal rather than a bags-full one when both apply', () => {
    const sim = makeWarrior(7110);
    grant(sim, RING_ID);
    grant(sim, AMULET_ID);
    sim.equipItem(RING_ID);
    sim.equipItem(AMULET_ID);
    sim.tick();

    // Fill every bag slot, keeping one greatsword. Equipping it into the
    // mainhand would bench BOTH the worn sword and the displaced buckler, which
    // the full bags cannot take: the cap refusal has to come first, or the
    // player is told the wrong thing about a swap that was never legal.
    const meta = sim.meta(sim.playerId)!;
    meta.inventory.length = 0;
    meta.inventory.push({ itemId: GREATSWORD_ID, count: 1 });
    while (meta.inventory.length < bagCapacity(meta.bags)) {
      meta.inventory.push({ itemId: UNFLAGGED_ID, count: 1 });
    }
    const equipmentBefore = { ...sim.equipment };
    const bagsBefore = meta.inventory.length;

    sim.equipItemToSlot(GREATSWORD_ID, 'mainhand');
    const errors = tickErrors(sim);

    expect(errors).toContain(CAP_ERROR);
    expect(errors).not.toContain('Your bags are full.');
    expect({ ...sim.equipment }).toEqual(equipmentBefore);
    expect(meta.inventory.length).toBe(bagsBefore);
    expect(sim.countItem(GREATSWORD_ID)).toBe(1);
  });

  it('skips an auto-equip whose carried copy rolled legendary against a legendary worn piece', () => {
    const sim = makeWarrior(7111);
    const meta = sim.meta(sim.playerId)!;
    grant(sim, RING_ID);
    sim.equipItem(RING_ID);
    sim.tick();
    // An epic def worn as a legendary-rolled copy: it occupies the sub-cap.
    meta.equipmentInstance.ring1 = { rolled: { quality: 'legendary' } };

    // addItemInstance has no auto-equip hook, so the arm is driven directly;
    // addItem's only job here would be to call it.
    sim.addItemInstance(AMULET_ID, { rolled: { quality: 'legendary' } });
    sim.tick();
    (sim as unknown as { maybeAutoEquip(id: string, m: typeof meta): void }).maybeAutoEquip(
      AMULET_ID,
      meta,
    );
    expect(tickErrors(sim)).toHaveLength(0);
    expect(sim.equipment.neck).toBeUndefined();

    // Control: a PLAIN copy on top of the bags is the candidate instead, and
    // the very same call equips it. So the skip above was the rolled quality
    // talking, not an inert reach-in.
    grant(sim, AMULET_ID);
    (sim as unknown as { maybeAutoEquip(id: string, m: typeof meta): void }).maybeAutoEquip(
      AMULET_ID,
      meta,
    );
    expect(sim.equipment.neck).toBe(AMULET_ID);
  });

  it('wears duplicate copies of one epic flagged item inside the cap (no id comparison)', () => {
    // R16 through the REAL equip path, not just the pure rule: the counted
    // family compares no ids or families, so two copies of one flagged epic
    // fill both fingers with no refusal.
    const sim = makeWarrior(7113);
    grant(sim, RING_ID, 2);

    sim.equipItemToSlot(RING_ID, 'ring1');
    sim.equipItemToSlot(RING_ID, 'ring2');
    expect(tickErrors(sim)).toHaveLength(0);
    expect(sim.equipment.ring1).toBe(RING_ID);
    expect(sim.equipment.ring2).toBe(RING_ID);
    expect(sim.countItem(RING_ID)).toBe(0);
  });
});

describe('masterwrought cap with the shipped phase 09 gear (R6)', () => {
  // The budget sweep (tests/masterwrought_budget.test.ts) pins the DEFS; this
  // is the cap INTERPLAY through the real equip path with the real ids, so a
  // def change that alters how the counted family reads a shipped piece
  // (slot, hand, occupiesHand, the flag itself) reds here, not only there.
  it('wears the flagged two-hander beside one flagged piece and refuses a third', () => {
    const sim = makeWarrior(7116);
    grant(sim, 'ridgebreaker');
    grant(sim, 'wyrmfall_pendant');
    grant(sim, 'warhewn_signet');

    // A two-hander occupies a single SLOT and so counts once: with the
    // pendant it exactly fills the cap.
    sim.equipItemToSlot('ridgebreaker', 'mainhand');
    sim.equipItem('wyrmfall_pendant');
    sim.tick();
    expect(sim.equipment.mainhand).toBe('ridgebreaker');
    expect(sim.equipment.neck).toBe('wyrmfall_pendant');

    const before = { ...sim.equipment };
    sim.equipItem('warhewn_signet');
    const errors = tickErrors(sim);
    expect(errors).toContain(CAP_ERROR);
    expect({ ...sim.equipment }).toEqual(before);
    expect(sim.countItem('warhewn_signet')).toBe(1);
  });

  it('the two-hander benches a flagged HELD offhand, which then stops counting', () => {
    const sim = makeShaman(7117);
    grant(sim, 'gyrelens_array');
    grant(sim, 'wyrmfall_pendant');
    grant(sim, 'ridgebreaker');
    grant(sim, 'prismglass_loop');

    sim.equipItemToSlot('gyrelens_array', 'offhand');
    sim.equipItem('wyrmfall_pendant');
    sim.tick();
    expect(sim.equipment.offhand).toBe('gyrelens_array');
    expect(sim.equipment.neck).toBe('wyrmfall_pendant');

    // At the cap, but the held offhand occupies the hand the two-hander
    // needs, so the equip benches it (displacedSlotForEquip names offhand;
    // the ignoreSlots exemption in equipItem then leaves the benched copy
    // out of the count): worn afterward are the pendant plus the two-hander.
    sim.equipItemToSlot('ridgebreaker', 'mainhand');
    expect(tickErrors(sim)).toHaveLength(0);
    expect(sim.equipment.mainhand).toBe('ridgebreaker');
    expect(sim.equipment.offhand).toBeUndefined();
    expect(sim.countItem('gyrelens_array')).toBe(1);

    // Still two worn pieces: the ring is the third and is refused.
    sim.equipItem('prismglass_loop');
    expect(tickErrors(sim)).toContain(CAP_ERROR);
    expect(sim.equipment.ring1).toBeUndefined();
    expect(sim.countItem('prismglass_loop')).toBe(1);
  });

  it('a flagged WORN offhand coexists with the two-hander and still counts', () => {
    // DECIDED here (the pin owed since phase 03 QA): coexistence stands. A
    // worn offhand (occupiesHand false, the quiver shape) is outside the
    // two-hand exclusion, so displacedSlotForEquip (src/sim/equipment_rules.ts)
    // returns null for it and it never enters equipItem's ignoreSlots: the
    // 2H equip does NOT bench it, and the counted family keeps counting it.
    // The pair therefore sits AT the cap; freeing the slot is the player's
    // move, never the rule's side effect.
    const sim = makeWarrior(7118);
    grant(sim, WORN_OFFHAND_ID);
    grant(sim, 'ridgebreaker');
    grant(sim, RING_ID);

    sim.equipItemToSlot(WORN_OFFHAND_ID, 'offhand');
    sim.tick();
    expect(sim.equipment.offhand).toBe(WORN_OFFHAND_ID);

    sim.equipItemToSlot('ridgebreaker', 'mainhand');
    expect(tickErrors(sim)).toHaveLength(0);
    expect(sim.equipment.mainhand).toBe('ridgebreaker');
    expect(sim.equipment.offhand).toBe(WORN_OFFHAND_ID);

    // Both counted: the pair is the cap, so a third flagged equip refuses.
    const before = { ...sim.equipment };
    sim.equipItemToSlot(RING_ID, 'ring1');
    expect(tickErrors(sim)).toContain(CAP_ERROR);
    expect({ ...sim.equipment }).toEqual(before);
    expect(sim.countItem(RING_ID)).toBe(1);
  });
});

describe('masterwrought content shape', () => {
  it('keeps the flag on equippable defs only, so no flagged piece can go uncounted', () => {
    // The count walks ALL_EQUIP_SLOTS, so a flagged item that lands anywhere
    // else (a bag socket, a consumable, a bogus slot string) would wear for
    // free. equipItem's own gate admits exactly these three kinds; jewelry is
    // not a fourth, it IS kind 'armor' (JewelryItemDef). The slot must be a
    // REAL equip slot (or the 'ring' KIND, which resolves to ring1/ring2), not
    // merely truthy: a typo'd slot would never reach the walk.
    const equippable = new Set(['weapon', 'armor', 'held_offhand']);
    const flagged = Object.values(ITEMS).filter((def) => def.masterwrought === true);
    // Vacuity floor: this suite's own synthetics keep the check honest until
    // shipped content carries the flag.
    expect(flagged.length).toBeGreaterThan(0);
    for (const def of flagged) {
      const slotIsReal = def.slot === 'ring' || (!!def.slot && isEquipSlot(def.slot));
      expect(slotIsReal, `${def.id} carries the flag on unknown slot ${String(def.slot)}`).toBe(
        true,
      );
      expect(equippable.has(def.kind), `${def.id} has non-equippable kind ${def.kind}`).toBe(true);
    }
  });
});

describe('masterwrought sub-cap reads the copy being worn', () => {
  it('refuses a carried legendary roll of an epic piece and equips the plain copy', () => {
    const sim = makeWarrior(7105);
    const meta = sim.meta(sim.playerId)!;
    meta.autoEquip = false;
    grant(sim, EMBER_ID);
    sim.equipItem(EMBER_ID);
    sim.tick();
    expect(sim.equipment.ring1).toBe(EMBER_ID);

    // An epic-def amulet whose specific copy rolled legendary. equipItem lifts
    // the highest-index matching unit, so this one is what the equip would wear.
    sim.addItemInstance(AMULET_ID, { rolled: { quality: 'legendary' } });
    sim.tick();
    sim.equipItem(AMULET_ID);
    expect(tickErrors(sim)).toContain(LEGENDARY_ERROR);
    expect(sim.equipment.neck).toBeUndefined();

    // A plain copy lands on top of the bags and is the one the next equip
    // takes, which is exactly the unit the refusal above peeked at.
    grant(sim, AMULET_ID);
    sim.equipItem(AMULET_ID);
    expect(tickErrors(sim)).toHaveLength(0);
    expect(sim.equipment.neck).toBe(AMULET_ID);
    expect(sim.equipmentInstances.neck?.rolled?.quality).toBeUndefined();
    const stillCarried = meta.inventory.find(
      (s) => s.itemId === AMULET_ID && s.instance?.rolled?.quality === 'legendary',
    );
    expect(stillCarried).toBeDefined();
  });

  it('wears a legendary roll of an epic def beside a plain copy and it then holds the sub-cap', () => {
    // This block used to document the deliberate disagreement recorded in
    // equipment_rules.ts (the unique-equipped rule read DEF quality only, so
    // a legendary-ROLLED copy of an epic def was never unique-equipped).
    // 2026-08-27, phase 13: the orange promotion mints legendary-rolled
    // instances (NOT the first legal ones, as this comment first claimed:
    // legacy masterwork bumps wrote rolled.quality too, crafting.ts says
    // so; corrected 2026-08-27), and isUniqueEquipped is instance-aware for
    // PROMOTION-STAMPED (`perfected`) copies only, so a legacy rolled-only
    // payload like this fixture's stays outside the unique rule (a second
    // PROMOTED copy is what it refuses, pinned in
    // tests/orange_promotion.test.ts). The BEHAVIOR here still holds: the
    // rolled copy equips BESIDE A PLAIN COPY of its own id, and once worn
    // its live payload is what the sub-cap counts.
    const sim = makeWarrior(7112);
    grant(sim, RING_ID);
    sim.equipItemToSlot(RING_ID, 'ring1');
    sim.tick();
    expect(sim.equipment.ring1).toBe(RING_ID);

    sim.addItemInstance(RING_ID, { rolled: { quality: 'legendary' } });
    sim.tick();
    sim.equipItemToSlot(RING_ID, 'ring2');
    expect(tickErrors(sim)).toHaveLength(0);
    expect(sim.equipment.ring2).toBe(RING_ID);
    expect(sim.equipmentInstances.ring2?.rolled?.quality).toBe('legendary');

    // The worn roll occupies the sub-cap, read off the live worn payload the
    // equip itself wrote, never a hand-written instance map.
    grant(sim, EMBER_ID);
    const before = { ...sim.equipment };
    sim.equipItemToSlot(EMBER_ID, 'ring1');
    expect(tickErrors(sim)).toContain(LEGENDARY_ERROR);
    expect({ ...sim.equipment }).toEqual(before);
  });

  it('a slotIndex naming a LOWER-index promoted copy is judged as that copy (refused)', () => {
    // The 2026-08-27 review probe: the consume honors slotIndex while the
    // peek judged the highest-index copy, so naming a promoted copy sitting
    // UNDER a plain one equipped the promoted unit past the sub-cap (a
    // second worn legendary). The peek now judges the named cell.
    const sim = makeWarrior(7119);
    const meta = sim.meta(sim.playerId)!;
    meta.autoEquip = false;
    grant(sim, EMBER_ID);
    sim.equipItem(EMBER_ID);
    sim.tick();
    expect(sim.equipment.ring1).toBe(EMBER_ID);

    // The promoted copy first (lower index), a plain copy on top.
    sim.addItemInstance(AMULET_ID, { perfected: true, rolled: { quality: 'legendary' } });
    grant(sim, AMULET_ID);
    const promotedIdx = meta.inventory.findIndex(
      (s) => s.itemId === AMULET_ID && s.instance?.rolled?.quality === 'legendary',
    );
    expect(promotedIdx).toBeGreaterThanOrEqual(0);
    sim.tick();

    sim.equipItem(AMULET_ID, { slotIndex: promotedIdx });
    expect(tickErrors(sim)).toContain(LEGENDARY_ERROR);
    expect(sim.equipment.neck).toBeUndefined();
    expect(sim.countItem(AMULET_ID), 'nothing consumed on the refusal').toBe(2);
  });

  it('a slotIndex naming a PLAIN copy equips even when a promoted copy sits highest', () => {
    // The mirror direction: the id-only peek judged the highest-index
    // (promoted) copy and falsely refused the plain unit the player named.
    const sim = makeWarrior(7120);
    const meta = sim.meta(sim.playerId)!;
    meta.autoEquip = false;
    grant(sim, EMBER_ID);
    sim.equipItem(EMBER_ID);
    sim.tick();
    expect(sim.equipment.ring1).toBe(EMBER_ID);

    // The plain copy first (lower index), the promoted copy on top.
    grant(sim, AMULET_ID);
    const plainIdx = meta.inventory.findIndex(
      (s) => s.itemId === AMULET_ID && s.instance === undefined,
    );
    expect(plainIdx).toBeGreaterThanOrEqual(0);
    sim.addItemInstance(AMULET_ID, { perfected: true, rolled: { quality: 'legendary' } });
    sim.tick();

    sim.equipItem(AMULET_ID, { slotIndex: plainIdx });
    expect(tickErrors(sim)).toHaveLength(0);
    expect(sim.equipment.neck).toBe(AMULET_ID);
    expect(sim.equipmentInstances.neck?.rolled?.quality).toBeUndefined();
    // The promoted copy stays in the bags, untouched.
    const promoted = meta.inventory.find(
      (s) => s.itemId === AMULET_ID && s.instance?.rolled?.quality === 'legendary',
    );
    expect(promoted).toBeDefined();
  });
});

describe('masterwrought legacy save tolerance', () => {
  it('loads a save wearing three flagged pieces and refuses only the next equip', () => {
    const source = makeWarrior(7106);
    const state = source.serializeCharacter(source.playerId)!;
    state.equipment.ring1 = RING_ID;
    state.equipment.ring2 = RING_ID;
    state.equipment.neck = AMULET_ID;

    const sim = new Sim({
      seed: 7107,
      playerClass: 'warrior',
      noPlayer: true,
      world: EMPTY_TEST_WORLD,
    });
    const pid = sim.addPlayer('warrior', 'Restored', { state });
    const meta = sim.meta(pid)!;

    // No load-time sweep for this family: the character keeps everything it
    // was wearing before the rule existed.
    expect(meta.equipment.ring1).toBe(RING_ID);
    expect(meta.equipment.ring2).toBe(RING_ID);
    expect(meta.equipment.neck).toBe(AMULET_ID);
    expect(sim.countItem(RING_ID, pid)).toBe(0);

    grant(sim, BULWARK_ID, 1, pid);
    const before = { ...meta.equipment };
    sim.equipItemToSlot(BULWARK_ID, 'offhand', pid);
    expect(tickErrors(sim, pid)).toContain(CAP_ERROR);
    expect({ ...meta.equipment }).toEqual(before);
    expect(sim.countItem(BULWARK_ID, pid)).toBe(1);
  });

  it('keeps three DISTINCT flagged pieces, two of them legendary, and refuses only the next', () => {
    // The KEEP half is what exercises the sub-cap here: a load-time legendary
    // sweep would bench one of the two worn legendary defs, so the ring
    // assertions below are the tolerance proof. The next-equip refusal is the
    // CAP reason by design (three worn trip the count, which answers ahead of
    // the legendary arm). Distinct ids on purpose, so the duplicate-unique
    // load bench (benchDuplicateUniqueEquipped) stays out of the picture and
    // the tolerance proven is this family's own.
    const source = makeWarrior(7114);
    const state = source.serializeCharacter(source.playerId)!;
    state.equipment.ring1 = EMBER_ID;
    state.equipment.ring2 = ASH_ID;
    state.equipment.neck = AMULET_ID;

    const sim = new Sim({
      seed: 7115,
      playerClass: 'warrior',
      noPlayer: true,
      world: EMPTY_TEST_WORLD,
    });
    const pid = sim.addPlayer('warrior', 'Overcap', { state });
    const meta = sim.meta(pid)!;
    expect(meta.equipment.ring1).toBe(EMBER_ID);
    expect(meta.equipment.ring2).toBe(ASH_ID);
    expect(meta.equipment.neck).toBe(AMULET_ID);

    grant(sim, BULWARK_ID, 1, pid);
    const before = { ...meta.equipment };
    sim.equipItemToSlot(BULWARK_ID, 'offhand', pid);
    expect(tickErrors(sim, pid)).toContain(CAP_ERROR);
    expect({ ...meta.equipment }).toEqual(before);
    expect(sim.countItem(BULWARK_ID, pid)).toBe(1);
  });
});
