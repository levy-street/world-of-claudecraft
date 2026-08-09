// The gear-set planner behind saved loadouts (src/sim/loadout_gear.ts).
//
// The feature exists so a player can keep a PvP set and a PvE set on two talent
// loadouts. The assertions below are built around the one way it could be worse
// than useless: re-equipping the WRONG copy. Equipment is stored as bare item ids
// with per-copy payloads in a parallel map, so a plain and an enchanted Furyforged
// Girdle are the same id, and a set that silently re-equipped the plain one every
// swap would quietly strip the enchant a player paid for.
//
// Pure leaf, so this drives the whole decision with plain arrays: no Sim, no
// SimContext, no equip command.

import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { slotAcceptsItem } from '../src/sim/equipment_rules';
import { itemCopyPin } from '../src/sim/item_copy_ref';
import { buildGearSet, planGearSwap, type SavedGearSet } from '../src/sim/loadout_gear';
import { repairTalentLoadouts } from '../src/sim/talent_loadouts';
import {
  ALL_EQUIP_SLOTS,
  type EquipSlot,
  type InvSlot,
  type ItemInstancePayload,
} from '../src/sim/types';

const GIRDLE = 'warfare_girdle';
const BOOTS = 'warfare_boots';

const enchant = (id: string): ItemInstancePayload => ({ enchantId: id }) as ItemInstancePayload;

const plain = (itemId: string, count = 1): InvSlot => ({ itemId, count });
const withPayload = (itemId: string, instance: ItemInstancePayload, count = 1): InvSlot => ({
  itemId,
  count,
  instance,
});

/** The pin a bag slot carries, via the shared function the planner uses.
 *  No instance short-circuit: itemCopyPin is the single authority, which is what
 *  lets a crafted-but-unenchanted copy match itself across worn and bagged. */
const pinOf = (slot: InvSlot): string => itemCopyPin(slot);

describe('buildGearSet: capturing what is worn', () => {
  it('records the id and the payload pin for an instanced piece', () => {
    const power = enchant('power');
    const set = buildGearSet({ waist: GIRDLE }, { waist: power });
    expect(set.waist?.itemId).toBe(GIRDLE);
    expect(set.waist?.pin).toBe(itemCopyPin({ itemId: GIRDLE, count: 1, instance: power }));
  });

  it('pins a plain piece to the same fingerprint a plain BAG copy has', () => {
    // Deliberately not the empty string. The old convention short-circuited an
    // absent payload to '', which gave a crafted-but-unenchanted piece the empty
    // pin on one side and a real fingerprint on the other, so a crafted copy could
    // never match itself. itemCopyPin is now the single authority on both sides.
    const set = buildGearSet({ waist: GIRDLE }, undefined);
    expect(set.waist?.pin).toBe(pinOf(plain(GIRDLE)));
    expect(set.waist?.pin, 'and it is a real fingerprint, not empty').not.toBe('');
  });

  it('pins a CRAFTED worn piece to match the same copy sitting in a bag', () => {
    // The blocker this normalization fixes: equipmentPayloadFor packs
    // craftedRecipeId INTO the worn payload while a bag slot carries it as its own
    // field, so the two shapes pinned differently and a crafted piece read as gone.
    const worn = buildGearSet({ waist: GIRDLE }, { waist: { craftedRecipeId: 'r_test' } } as never);
    const bagCopy: InvSlot = { itemId: GIRDLE, count: 1, craftedRecipeId: 'r_test' };
    expect(worn.waist?.pin).toBe(pinOf(bagCopy));
  });

  it('captures only slots that hold something', () => {
    const set = buildGearSet({ waist: GIRDLE, feet: undefined }, undefined);
    expect(Object.keys(set)).toEqual(['waist']);
  });

  it('pins the same value the bag side computes, so worn and bagged copies compare equal', () => {
    // The whole scheme rests on this: a set saved off the body has to match the
    // same copy once it is sitting in the bags. If these two ever diverge, every
    // swap reports the copy missing.
    const power = enchant('power');
    const set = buildGearSet({ waist: GIRDLE }, { waist: power });
    expect(set.waist?.pin).toBe(pinOf(withPayload(GIRDLE, power)));
  });
});

describe('planGearSwap: which copy comes back', () => {
  it('equips the SAVED copy, not merely the id', () => {
    // The headline case. Both copies are in the bags; the saved one is enchanted
    // and sits at index 0, and a plain duplicate was looted after it. Every legacy
    // picker in the tree takes the newest, which is the wrong one here.
    const power = enchant('power');
    const inventory = [withPayload(GIRDLE, power), plain(GIRDLE)];
    const set: SavedGearSet = { waist: { itemId: GIRDLE, pin: pinOf(inventory[0]) } };

    const plan = planGearSwap(set, inventory, {}, undefined);
    expect(plan.equips).toEqual([{ slot: 'waist', itemId: GIRDLE, bagIndex: 0 }]);
    expect(plan.unavailable).toEqual([]);
  });

  it('reports a saved enchanted copy as gone rather than settling for a plain one', () => {
    // The refusal that makes the feature honest. A plain copy of the id IS in the
    // bags, but it is not the piece that was saved, and equipping it would put a
    // stat-less shell in the slot while looking correct on the paperdoll.
    const inventory = [plain(GIRDLE)];
    const set: SavedGearSet = {
      waist: { itemId: GIRDLE, pin: itemCopyPin(withPayload(GIRDLE, enchant('power'))) },
    };

    const plan = planGearSwap(set, inventory, {}, undefined);
    expect(plan.equips).toEqual([]);
    expect(plan.unavailable).toEqual([{ slot: 'waist', itemId: GIRDLE, reason: 'copyGone' }]);
  });

  it('treats plain copies as interchangeable, because they are', () => {
    const inventory = [plain(GIRDLE), plain(GIRDLE)];
    const set: SavedGearSet = { waist: { itemId: GIRDLE, pin: pinOf(plain(GIRDLE)) } };
    const plan = planGearSwap(set, inventory, {}, undefined);
    expect(plan.equips).toHaveLength(1);
    expect(plan.unavailable).toEqual([]);
  });

  it('distinguishes "none held" from "that copy is gone"', () => {
    // Two different player stories: sold the item entirely, versus still owning one
    // but not the enchanted copy. The reasons let a caller word the refusal.
    const plan = planGearSwap(
      { waist: { itemId: GIRDLE, pin: pinOf(plain(GIRDLE)) } },
      [plain(BOOTS)],
      {},
      undefined,
    );
    expect(plan.unavailable).toEqual([{ slot: 'waist', itemId: GIRDLE, reason: 'notHeld' }]);
  });

  it('skips a slot already wearing the exact saved copy', () => {
    const power = enchant('power');
    const set = buildGearSet({ waist: GIRDLE }, { waist: power });
    const plan = planGearSwap(set, [], { waist: GIRDLE }, { waist: power });
    expect(plan.alreadyWorn).toEqual(['waist']);
    expect(plan.equips).toEqual([]);
  });

  it('does NOT skip when the same id is worn but a different copy', () => {
    // Wearing the plain girdle while the set wants the enchanted one is precisely
    // the state a swap must correct, and an id-only comparison would call it done.
    const power = enchant('power');
    const set = buildGearSet({ waist: GIRDLE }, { waist: power });
    const inventory = [withPayload(GIRDLE, power)];
    const plan = planGearSwap(set, inventory, { waist: GIRDLE }, undefined);
    expect(plan.alreadyWorn).toEqual([]);
    expect(plan.equips).toEqual([{ slot: 'waist', itemId: GIRDLE, bagIndex: 0 }]);
  });

  it('never resolves two slots onto the same bag stack', () => {
    // Two rings, one held copy. Without the claim set both slots would plan the
    // same index and the second equip would find nothing there.
    const set: SavedGearSet = {
      ring1: { itemId: GIRDLE, pin: pinOf(plain(GIRDLE)) },
      ring2: { itemId: GIRDLE, pin: pinOf(plain(GIRDLE)) },
    };
    const plan = planGearSwap(set, [plain(GIRDLE)], {}, undefined);
    expect(plan.equips).toHaveLength(1);
    expect(plan.unavailable).toHaveLength(1);
    // Reported as taken by the other slot, NOT as gone: the player holds the ring,
    // they just hold one. Telling them the copy is gone would be misinformation.
    expect(plan.unavailable[0].reason).toBe('takenByOtherSlot');
  });

  it('is deterministic regardless of key insertion order', () => {
    // The sim runs on three hosts; the same inputs must produce the same plan.
    const a: SavedGearSet = {
      waist: { itemId: GIRDLE, pin: pinOf(plain(GIRDLE)) },
      feet: { itemId: BOOTS, pin: pinOf(plain(BOOTS)) },
    };
    const b: SavedGearSet = {
      feet: { itemId: BOOTS, pin: pinOf(plain(BOOTS)) },
      waist: { itemId: GIRDLE, pin: pinOf(plain(GIRDLE)) },
    };
    const inv = [plain(GIRDLE), plain(BOOTS)];
    expect(planGearSwap(a, inv, {}, undefined)).toEqual(planGearSwap(b, inv, {}, undefined));
  });

  it('ignores a zero-count stack', () => {
    const plan = planGearSwap(
      { waist: { itemId: GIRDLE, pin: pinOf(plain(GIRDLE)) } },
      [{ itemId: GIRDLE, count: 0 }],
      {},
      undefined,
    );
    expect(plan.equips).toEqual([]);
    expect(plan.unavailable[0].reason, 'a zero stack is not held').toBe('notHeld');
  });
});

describe('the persisted gear set is sanitized on load (untrusted JSONB)', () => {
  // REAL ids here, unlike the planner tests above: the sanitizer now refuses an id
  // that names no item or does not fit the slot, so fabricated fixtures would be
  // dropped and the assertions would be vacuous.
  const realFor = (slot: string): string => {
    const found = Object.values(ITEMS).find((d) => d.slot === slot && d.kind === 'armor');
    if (!found) throw new Error(`no real item for ${slot}`);
    return found.id;
  };
  const REAL_WAIST = realFor('waist');
  const REAL_LEGS = realFor('legs');

  it('drops an id that names no item, or one that does not fit the slot', () => {
    const { loadouts } = repairTalentLoadouts(
      'warrior',
      20,
      [
        {
          name: 'A',
          alloc: { spec: null, rows: {} },
          bar: [],
          gear: {
            waist: { itemId: 'no_such_item_at_all', pin: '' },
            legs: { itemId: REAL_WAIST, pin: '' },
          },
        },
      ],
      0,
    );
    // A corrupt or stale row would otherwise survive load and become per-slot
    // refusal spam on every single switch.
    expect(Object.hasOwn(loadouts[0], 'gear'), 'nothing survivable, so no key').toBe(false);
  });

  it('keeps well-formed slots and drops everything else', () => {
    // repairGearSet had no direct test; the hostile matrix below is the pin.
    const { loadouts } = repairTalentLoadouts(
      'warrior',
      20,
      [
        {
          name: 'PvP',
          alloc: { spec: null, rows: {} },
          bar: [],
          gear: {
            waist: { itemId: REAL_WAIST, pin: 'p1' },
            notASlot: { itemId: REAL_WAIST, pin: 'p2' },
            feet: { itemId: '', pin: 'p3' },
            chest: { itemId: 42, pin: 'p4' },
            head: 'nonsense',
            legs: { itemId: REAL_LEGS },
          },
        },
      ],
      0,
    );
    const gear = loadouts[0]?.gear;
    expect(Object.keys(gear ?? {}).sort(), 'only real slots with a real id').toEqual([
      'legs',
      'waist',
    ]);
    expect(gear?.waist).toEqual({ itemId: REAL_WAIST, pin: 'p1' });
    expect(gear?.legs, 'a missing pin coerces to empty rather than dropping the slot').toEqual({
      itemId: REAL_LEGS,
      pin: '',
    });
  });

  it('omits the gear key entirely when nothing survives, rather than storing {}', () => {
    // Load-shape stability: an always-present key would change the persisted and
    // snapshot payload for every loadout that never captured gear.
    const { loadouts } = repairTalentLoadouts(
      'warrior',
      20,
      [
        { name: 'A', alloc: { spec: null, rows: {} }, bar: [], gear: { nope: 1 } },
        { name: 'B', alloc: { spec: null, rows: {} }, bar: [] },
      ],
      0,
    );
    expect(Object.hasOwn(loadouts[0], 'gear')).toBe(false);
    expect(Object.hasOwn(loadouts[1], 'gear')).toBe(false);
  });

  it('survives prototype-pollution shaped keys', () => {
    const { loadouts } = repairTalentLoadouts(
      'warrior',
      20,
      [
        {
          name: 'A',
          alloc: { spec: null, rows: {} },
          bar: [],
          gear: { __proto__: { polluted: true }, waist: { itemId: REAL_WAIST, pin: '' } },
        },
      ],
      0,
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(loadouts[0]?.gear ?? {})).toEqual(['waist']);
  });
});

describe('the worn-slot limitation is real and pinned', () => {
  it('reports pieces worn in EACH OTHER slots as unavailable (documented limit)', () => {
    // Not a bug being hidden: planGearSwap searches the bags only, so two rings
    // exchanged between ring1 and ring2 cannot resolve. Pinned so the limit is a
    // decision rather than a surprise, and so a future fix has a test to flip.
    const set: SavedGearSet = {
      ring1: { itemId: GIRDLE, pin: pinOf(plain(GIRDLE)) },
      ring2: { itemId: BOOTS, pin: pinOf(plain(BOOTS)) },
    };
    const plan = planGearSwap(set, [], { ring1: BOOTS, ring2: GIRDLE }, undefined);
    expect(plan.equips, 'neither can be resolved from an empty bag').toEqual([]);
    expect(plan.unavailable.map((u) => u.reason)).toEqual(['notHeld', 'notHeld']);
  });
});

describe('every equip slot survives save, serialize, repair and apply', () => {
  // The reviewer's closing point, as a test. Both rounds of blockers lived in a
  // slot family the fixtures never reached: multi-piece first, then rings and
  // offhand weapons, which the earlier `realFor` helper could not produce because
  // it only ever found direct-slot armor. Walking ALL_EQUIP_SLOTS closes the class
  // instead of the two instances.
  //
  // A ring declares the slot KIND 'ring' and a weapon declares 'mainhand' even when
  // it legally sits in the offhand, so slot EQUALITY silently deleted both at load.
  // This drives the real sanitizer, so any future slot family with an indirect
  // declaration fails here rather than in play.
  const itemForSlot = (slot: EquipSlot): string | null => {
    const found = Object.values(ITEMS).find((d) => slotAcceptsItem(d, slot));
    return found?.id ?? null;
  };

  it('finds a real item for every slot, so the sweep below is not vacuous', () => {
    const missing = ALL_EQUIP_SLOTS.filter((slot) => itemForSlot(slot) === null);
    expect(missing, 'every equip slot needs a fixture for the sweep to mean anything').toEqual([]);
  });

  it.each([...ALL_EQUIP_SLOTS])('a %s piece survives the load sanitizer', (slot) => {
    const itemId = itemForSlot(slot);
    if (!itemId) throw new Error(`no item for ${slot}`);
    const { loadouts } = repairTalentLoadouts(
      'warrior',
      20,
      [
        {
          name: 'All',
          alloc: { spec: null, rows: {} },
          bar: [],
          gear: { [slot]: { itemId, pin: 'p' } },
        },
      ],
      0,
    );
    expect(loadouts[0]?.gear?.[slot], `${slot} was dropped at load`).toEqual({
      itemId,
      pin: 'p',
    });
  });

  it('keeps a WHOLE-body set intact through the sanitizer', () => {
    const gear: Record<string, { itemId: string; pin: string }> = {};
    for (const slot of ALL_EQUIP_SLOTS) {
      const itemId = itemForSlot(slot);
      if (itemId) gear[slot] = { itemId, pin: `pin_${slot}` };
    }
    const { loadouts } = repairTalentLoadouts(
      'warrior',
      20,
      [{ name: 'Full', alloc: { spec: null, rows: {} }, bar: [], gear }],
      0,
    );
    expect(Object.keys(loadouts[0]?.gear ?? {}).sort()).toEqual(Object.keys(gear).sort());
  });
});
