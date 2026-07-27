// Force-rename instance-signer sweep (src/sim/character_rename.ts):
// the rewrite matrix over carried inventory, bank inventory, and the
// equipped-instance map, the never-merges guarantee for slots the sweep
// leaves byte-equal, and the behavior-follows pins: the #1145 self-signed
// crafting discount and Battlefield Experience attribution both fire under
// the NEW name over a swept state, through the real predicates.
import { describe, expect, it } from 'vitest';
import { rekeyInstanceSigner } from '../src/sim/character_rename';
import {
  canStackInstancePayloads,
  itemInstancePayloadsEqual,
} from '../src/sim/item_instance_merge';
import {
  BATTLEFIELD_XP_TRICKLE,
  battlefieldExperienceTrickle,
} from '../src/sim/professions/battlefield_xp';
import { requiredReagentCount } from '../src/sim/professions/crafting';
import { emptyCraftSkills } from '../src/sim/professions/wheel';
import type { CharacterState, PlayerMeta } from '../src/sim/sim';

/** A loose CharacterState stand-in; the sweep only reads the three stores. */
function st(partial: Record<string, unknown>): CharacterState {
  return partial as unknown as CharacterState;
}

describe('rekeyInstanceSigner (force-rename sweep)', () => {
  it('rewrites the old-name signer across bags, bank, and the equipped-instance map, nothing else', () => {
    const state = st({
      inventory: [
        { itemId: 'bone_fragments', count: 1, instance: { signer: 'Oldname' }, slot: 3 },
        { itemId: 'bone_fragments', count: 1, instance: { signer: 'SomeoneElse' } },
        { itemId: 'linen_scrap', count: 4 },
      ],
      bank: {
        inventory: [
          {
            itemId: 'iron_bar',
            count: 1,
            instance: { signer: 'Oldname', rolled: { stats: { str: 2 }, masterwork: true } },
          },
        ],
        purchasedSlots: 8,
        bonusSlots: 0,
      },
      equipmentInstance: {
        chest: { signer: 'Oldname', enchant: 'ench_minor_stamina' },
        mainhand: { signer: 'SomeoneElse', rolled: { stats: { agi: 1 } } },
      },
    });

    expect(rekeyInstanceSigner(state, 'Oldname', 'Newname')).toBe(true);

    // Whole-store deep equality pins slot order, counts, manual cells, and
    // every non-signer payload field as untouched, foreign signers included.
    expect(state.inventory).toEqual([
      { itemId: 'bone_fragments', count: 1, instance: { signer: 'Newname' }, slot: 3 },
      { itemId: 'bone_fragments', count: 1, instance: { signer: 'SomeoneElse' } },
      { itemId: 'linen_scrap', count: 4 },
    ]);
    expect(state.bank).toEqual({
      inventory: [
        {
          itemId: 'iron_bar',
          count: 1,
          instance: { signer: 'Newname', rolled: { stats: { str: 2 }, masterwork: true } },
        },
      ],
      purchasedSlots: 8,
      bonusSlots: 0,
    });
    expect(state.equipmentInstance).toEqual({
      chest: { signer: 'Newname', enchant: 'ench_minor_stamina' },
      mainhand: { signer: 'SomeoneElse', rolled: { stats: { agi: 1 } } },
    });
  });

  it('keeps a count-3 same-signer stack as one slot at count 3 under the new name', () => {
    const state = st({
      inventory: [{ itemId: 'bone_fragments', count: 3, instance: { signer: 'Oldname' }, slot: 7 }],
    });
    expect(rekeyInstanceSigner(state, 'Oldname', 'Newname')).toBe(true);
    expect(state.inventory).toEqual([
      { itemId: 'bone_fragments', count: 3, instance: { signer: 'Newname' }, slot: 7 },
    ]);
  });

  it('returns false and touches nothing when no signer matches (optional stores absent)', () => {
    const state = st({
      inventory: [
        { itemId: 'bone_fragments', count: 1, instance: { signer: 'SomeoneElse' } },
        { itemId: 'linen_scrap', count: 2 },
      ],
    });
    const before = structuredClone(state);
    expect(rekeyInstanceSigner(state, 'Oldname', 'Newname')).toBe(false);
    expect(state).toEqual(before);
  });

  it('never merges: two slots left byte-equal by the sweep stay separate slots', () => {
    // Slot A is old-signed, slot B already carries the new name with an
    // otherwise identical payload; the sweep makes them byte-equal but MUST
    // leave them as two slots. The merge points (bags/bank/trade
    // adds) unify byte-equal stacks on a future add; the sweep never does.
    const state = st({
      inventory: [
        {
          itemId: 'iron_bar',
          count: 1,
          instance: { signer: 'Oldname', rolled: { stats: { str: 2 } } },
        },
        {
          itemId: 'iron_bar',
          count: 1,
          instance: { signer: 'Newname', rolled: { stats: { str: 2 } } },
        },
      ],
    });
    expect(rekeyInstanceSigner(state, 'Oldname', 'Newname')).toBe(true);
    expect(state.inventory).toHaveLength(2);
    expect(state.inventory[0].count).toBe(1);
    expect(state.inventory[1].count).toBe(1);
    // Post-sweep the two payloads ARE byte-equal and legally stackable, so a
    // future add may merge them; the sweep itself did not.
    expect(
      itemInstancePayloadsEqual(state.inventory[0].instance, state.inventory[1].instance),
    ).toBe(true);
    expect(canStackInstancePayloads(state.inventory[0].instance, state.inventory[1].instance)).toBe(
      true,
    );
  });

  it('the #1145 self-signed discount follows the new name (the real crafting predicate)', () => {
    const state = st({
      inventory: [{ itemId: 'bone_fragments', count: 1, instance: { signer: 'Oldname' } }],
    });
    // hasSelfSignedInstance compares slot signer to meta.name, so a renamed
    // character reads its own signed material through a NEW-name meta.
    const meta = { name: 'Newname', inventory: state.inventory } as unknown as PlayerMeta;
    const reagent = { itemId: 'bone_fragments', count: 2 };

    // Before the sweep the old-signed copy no longer counts as self-signed.
    const before = requiredReagentCount(meta, reagent, {}, 'alchemy');
    expect(before.count).toBe(2);
    expect(before.selfSignedBonusApplied).toBe(false);

    rekeyInstanceSigner(state, 'Oldname', 'Newname');
    const after = requiredReagentCount(meta, reagent, {}, 'alchemy');
    expect(after.count).toBe(1);
    expect(after.selfSignedBonusApplied).toBe(true);
  });

  it('Battlefield Experience attribution follows the new observer name over a swept payload', () => {
    const state = st({
      inventory: [
        {
          itemId: 'minor_healing_potion',
          count: 1,
          instance: { signer: 'Oldname', rolled: { quality: 'rare' } },
        },
      ],
    });
    const observe = () =>
      battlefieldExperienceTrickle(skills, {
        itemId: 'minor_healing_potion',
        instance: state.inventory[0].instance,
        observerName: 'Newname',
        observerActiveArchetype: 'alchemy',
      });

    // Before the sweep the old-signed payload attributes to nobody present.
    let skills = emptyCraftSkills();
    expect(observe()).toBe(0);
    expect(skills.alchemy ?? 0).toBe(0);

    rekeyInstanceSigner(state, 'Oldname', 'Newname');
    skills = emptyCraftSkills();
    expect(observe()).toBe(BATTLEFIELD_XP_TRICKLE);
    expect(skills.alchemy).toBe(BATTLEFIELD_XP_TRICKLE);
  });
});
