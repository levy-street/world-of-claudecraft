import { describe, expect, it } from 'vitest';
import type { CourierInfo } from '../src/sim/courier/types';
import type { InvSlot } from '../src/sim/types';
import {
  canDispatchCourier,
  emptyCourierDraft,
  reconcileCourierDraft,
  toggleCourierStack,
} from '../src/ui/hud/courier/courier_core';

describe('courier selection custody', () => {
  const bags: InvSlot[] = [
    { itemId: 'linen_cloth', count: 8 },
    { itemId: 'healing_potion', count: 2 },
  ];
  it('selects the exact whole stack and deselects without touching inventory', () => {
    const before = structuredClone(bags);
    const selected = toggleCourierStack(emptyCourierDraft(), 'deposits', 0, bags);
    expect(selected.deposits).toHaveLength(1);
    expect(toggleCourierStack(selected, 'deposits', 0, bags)).toEqual(emptyCourierDraft());
    expect(bags).toEqual(before);
  });
  it('never selects quest items in either direction', () => {
    const quest = [{ itemId: 'clue_scroll', count: 1 }];
    const draft = emptyCourierDraft();
    expect(toggleCourierStack(draft, 'deposits', 0, quest)).toEqual(draft);
    expect(toggleCourierStack(draft, 'withdrawals', 0, quest)).toEqual(draft);
  });
  it('drops a draft when a slot moves, changes quantity or changes instance identity', () => {
    const selected = toggleCourierStack(emptyCourierDraft(), 'deposits', 0, bags);
    expect(reconcileCourierDraft(selected, bags.slice(1), []).deposits).toEqual([]);
    expect(reconcileCourierDraft(selected, [{ ...bags[0], count: 7 }], []).deposits).toEqual([]);
    const gear: InvSlot[] = [{ itemId: 'membership_head', count: 1, instance: { name: 'One' } }];
    const gearDraft = toggleCourierStack(emptyCourierDraft(), 'withdrawals', 0, gear);
    expect(
      reconcileCourierDraft(gearDraft, [], [{ ...gear[0], instance: { name: 'Two' } }]).withdrawals,
    ).toEqual([]);
  });
  it('caps combined selections and leaves deselection available at the cap', () => {
    const slots = Array.from({ length: 25 }, (_, index) => ({ itemId: `item_${index}`, count: 1 }));
    let draft = emptyCourierDraft();
    for (let index = 0; index < 12; index++)
      draft = toggleCourierStack(draft, 'deposits', index, slots);
    for (let index = 0; index < 13; index++)
      draft = toggleCourierStack(draft, 'withdrawals', index, slots);
    expect(draft.deposits.length + draft.withdrawals.length).toBe(24);
    draft = toggleCourierStack(draft, 'withdrawals', 0, slots);
    expect(draft.withdrawals).toHaveLength(11);
  });
  it('requires membership and a ready courier for dispatch', () => {
    const draft = toggleCourierStack(emptyCourierDraft(), 'deposits', 0, bags);
    const info = { active: true, phase: 'ready' } as CourierInfo;
    expect(canDispatchCourier(info, draft)).toBe(true);
    expect(canDispatchCourier({ ...info, active: false }, draft)).toBe(false);
    expect(canDispatchCourier({ ...info, phase: 'returning' }, draft)).toBe(false);
    expect(canDispatchCourier(info, emptyCourierDraft())).toBe(false);
  });
});
