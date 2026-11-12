// The set-tier swap check (item_set_swap_view.ts) against the real catalog:
// the Strength lineage (deathlord tier 1 plus crownforged tier 2 share one
// 2/4/6 ladder) and a single-family Crucible set with one 2-piece tier.
import { describe, expect, it } from 'vitest';
import { ITEM_SETS, ITEMS } from '../src/sim/data';
import { setTierChangesOnSwap } from '../src/ui/item_set_swap_view';

const FOUR_DEATHLORD = {
  helmet: 'deathlords_dread_visage',
  chest: 'deathlord_warplate',
  legs: 'deathlord_legguards',
  feet: 'deathlord_sabatons',
} as const;

// A real chest that belongs to no set.
const PLAIN_CHEST = Object.values(ITEMS).find((i) => i.slot === 'chest' && !i.set)?.id ?? '';

describe('setTierChangesOnSwap', () => {
  it('pins the ladders these cases lean on', () => {
    expect(ITEM_SETS.deathlord.bonuses.map((b) => b.pieces)).toEqual([2, 4, 6]);
    expect(ITEM_SETS.deathlord.lineage).toBe(ITEM_SETS.crownforged.lineage);
    expect(ITEM_SETS.crucible_str_mail.bonuses.map((b) => b.pieces)).toEqual([2]);
    expect(PLAIN_CHEST).not.toBe('');
  });

  it('breaks exactly the tier the count drops below', () => {
    const changes = setTierChangesOnSwap(FOUR_DEATHLORD, 'chest', PLAIN_CHEST);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ setId: 'deathlord', pieces: 4, gained: false, have: 3 });
  });

  it('says nothing when the count stays inside the same tier', () => {
    // Five worn across the lineage, down to four: the 4-piece tier still holds.
    const five = { ...FOUR_DEATHLORD, gloves: 'crownforged_gauntlets' };
    expect(setTierChangesOnSwap(five, 'gloves', 'cmp_unknown_item')).toEqual([]);
  });

  it('lights the tier a new piece reaches, into an empty slot too', () => {
    const changes = setTierChangesOnSwap(
      { legs: 'deathlord_legguards' },
      'chest',
      'deathlord_warplate',
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ setId: 'deathlord', pieces: 2, gained: true, have: 2 });
  });

  it('a swap within one lineage keeps the shared count, so nothing flips', () => {
    // Tier-1 helm out, tier-2 helm in: both climb the Strength ladder.
    expect(setTierChangesOnSwap(FOUR_DEATHLORD, 'helmet', 'crownforged_dreadhelm')).toEqual([]);
  });

  it('a swap across sets reports the loss before the gain', () => {
    const worn = {
      chest: 'deathlord_warplate',
      legs: 'deathlord_legguards',
      waist: 'crucible_str_mail_waist',
    };
    const changes = setTierChangesOnSwap(worn, 'chest', 'crucible_str_mail_chest');
    expect(changes.map((c) => [c.setId, c.pieces, c.gained])).toEqual([
      ['deathlord', 2, false],
      ['crucible_str_mail', 2, true],
    ]);
  });

  it('ignores a swap where neither piece belongs to a set', () => {
    expect(setTierChangesOnSwap({ chest: PLAIN_CHEST }, 'chest', 'cmp_unknown_item')).toEqual([]);
  });
});
