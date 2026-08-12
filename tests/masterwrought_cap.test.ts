import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bagCapacity } from '../src/sim/bags';
import { ITEMS } from '../src/sim/data';
import {
  equipCandidateIndex,
  equipCandidateQuality,
  MASTERWROUGHT_EQUIP_CAP,
  MASTERWROUGHT_LEGENDARY_CAP,
  masterwroughtConflictSlot,
} from '../src/sim/equipment_rules';
import { Sim } from '../src/sim/sim';
import { type EquipSlot, type ItemDef, isEquipSlot } from '../src/sim/types';
import { supportedLanguages } from '../src/ui/i18n';
import { guideStrings } from '../src/ui/i18n.catalog/guide';
import { DICT } from '../src/ui/sim_i18n';

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
// and removed afterward. Since phase 08 the flag also SHIPS on the nine apex
// armor pieces (tests/masterwrought_budget.test.ts owns that catalog); the
// synthetic set stays because it covers slot shapes no shipped item exercises
// yet (jewelry sockets, the shield displacement, the two-hander).
const RING_ID = 'test_masterwrought_ring';
const AMULET_ID = 'test_masterwrought_amulet';
const EMBER_ID = 'test_masterwrought_ember_band';
const ASH_ID = 'test_masterwrought_ash_band';
const BULWARK_ID = 'test_masterwrought_bulwark';
const GREATSWORD_ID = 'test_masterwrought_greatsword';
const UNFLAGGED_ID = 'test_masterwrought_unflagged_signet';

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
  ]) {
    delete ITEMS[id];
  }
});

function makeWarrior(seed: number): Sim {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: true });
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
    // The guide gear page (phase 08) spells the equip cap as prose too, in
    // English and five non-Latin fills: one more copy site the cap retune
    // sweep above must reach.
    expect(guideStrings.gear.masterwroughtBody).toContain('at most two Masterwrought');
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

  it('wears a legendary roll of an epic def (not unique-equipped) and it then holds the sub-cap', () => {
    // The deliberate disagreement documented in equipment_rules.ts: the
    // unique-equipped rule reads DEF quality only, so a legendary-ROLLED copy
    // of an epic def is never unique-equipped, while this counted family reads
    // that same copy as legendary-effective. Both halves through the REAL
    // path: the copy equips beside a plain copy of its own id, and once worn
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
});

describe('masterwrought legacy save tolerance', () => {
  it('loads a save wearing three flagged pieces and refuses only the next equip', () => {
    const source = makeWarrior(7106);
    const state = source.serializeCharacter(source.playerId)!;
    state.equipment.ring1 = RING_ID;
    state.equipment.ring2 = RING_ID;
    state.equipment.neck = AMULET_ID;

    const sim = new Sim({ seed: 7107, playerClass: 'warrior', noPlayer: true });
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

    const sim = new Sim({ seed: 7115, playerClass: 'warrior', noPlayer: true });
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
