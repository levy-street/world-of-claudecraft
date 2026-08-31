import { describe, expect, it } from 'vitest';
import { ALWAYS_VISIBLE_AURA_IDS, selectShedSlots } from '../src/ui/aura_overflow_priority';
import type { AuraSlotState } from '../src/ui/auras_view';

function slot(over: Partial<AuraSlotState> & { key: string }): AuraSlotState {
  return {
    iconKey: over.key,
    isDebuff: false,
    school: '',
    own: false,
    expiring: false,
    durationText: '',
    stacksText: '',
    name: over.key,
    remaining: 0,
    cancelable: false,
    effectHtml: '',
    toggle: false,
    alwaysRender: false,
    shortDuration: false,
    ...over,
  };
}

function shedKeys(slots: AuraSlotState[], cap: number): string[] {
  const out: boolean[] = [];
  selectShedSlots(slots, slots.length, cap, out);
  return slots.filter((_, i) => out[i]).map((s) => s.key);
}

describe('aura_overflow_priority: selectShedSlots', () => {
  it('sheds nothing when count is within the cap', () => {
    const slots = Array.from({ length: 3 }, (_, i) => slot({ key: `b${i}` }));
    expect(shedKeys(slots, 8)).toEqual([]);
  });

  it('sheds the trailing long buffs first, in application order, when over cap', () => {
    const slots = Array.from({ length: 5 }, (_, i) => slot({ key: `b${i}` }));
    // cap 3, all long (no shortDuration): the last 2 applied shed.
    expect(shedKeys(slots, 3)).toEqual(['b3', 'b4']);
  });

  it('PRIORITY: a short-duration buff survives the cap over a long buff applied earlier', () => {
    // Player feedback on PR #3668: a tank's Raised Guard (6 sec active
    // mitigation) applied AFTER several long raid buffs must not lose its
    // icon to them.
    const slots = [
      slot({ key: 'raid_buff_1' }), // long (no duration -> not short)
      slot({ key: 'raid_buff_2' }),
      slot({ key: 'raid_buff_3' }),
      slot({ key: 'raised_guard_dr', shortDuration: true }), // applied LAST, but short
    ];
    // cap 3: without priority, raised_guard_dr (index 3) would be the one shed.
    // With priority, a long buff sheds in its place.
    expect(shedKeys(slots, 3)).toEqual(['raid_buff_3']);
  });

  it('fills leftover budget with long buffs once every short buff fits', () => {
    const slots = [
      slot({ key: 'short_a', shortDuration: true }),
      slot({ key: 'short_b', shortDuration: true }),
      slot({ key: 'long_a' }),
      slot({ key: 'long_b' }),
      slot({ key: 'long_c' }),
    ];
    // cap 4: both short buffs fit (2), leaving budget 2 for the 3 long buffs;
    // the third (application-order) long buff sheds.
    expect(shedKeys(slots, 4)).toEqual(['long_c']);
  });

  it('sheds a short buff too once even the short bucket exceeds the cap, by application order', () => {
    const slots = Array.from({ length: 4 }, (_, i) => slot({ key: `s${i}`, shortDuration: true }));
    expect(shedKeys(slots, 2)).toEqual(['s2', 's3']);
  });

  it('FAIRNESS: an exempt slot (debuff / alwaysRender / always-visible id) never sheds, and does not shrink the ordinary buff budget', () => {
    const slots = [
      ...Array.from({ length: 4 }, (_, i) => slot({ key: `b${i}` })),
      slot({ key: 'boss_curse', isDebuff: true }),
      slot({ key: 'bg_carried_flag', alwaysRender: true }),
      slot({ key: [...ALWAYS_VISIBLE_AURA_IDS][0] }),
    ];
    const out: boolean[] = [];
    const shedCount = selectShedSlots(slots, slots.length, 2, out);
    // Only ordinary buffs beyond the flat cap-of-2 budget shed; the three
    // exempt slots always render on top of that budget.
    expect(shedCount).toBe(2);
    expect(shedKeys(slots, 2)).toEqual(['b2', 'b3']);
  });

  it('is deterministic and allocation-stable: repeat calls with a caller-reused array agree', () => {
    const slots = Array.from({ length: 6 }, (_, i) => slot({ key: `b${i}` }));
    const out: boolean[] = [];
    const first = selectShedSlots(slots, slots.length, 3, out);
    const firstShed = [...out];
    const second = selectShedSlots(slots, slots.length, 3, out);
    expect(second).toBe(first);
    expect(out).toEqual(firstShed);
  });
});
