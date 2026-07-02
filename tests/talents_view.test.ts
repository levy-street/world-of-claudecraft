import { describe, expect, it } from 'vitest';
import { emptyAllocation, type TalentAllocation } from '../src/sim/content/talents';
import { buildTalentsView } from '../src/ui/talents_view';

const alloc = (over: Partial<TalentAllocation> = {}): TalentAllocation => ({
  ...emptyAllocation(),
  ...over,
});

describe('talents view model', () => {
  it('derives spec cards and row counts from a rows-only allocation', () => {
    const view = buildTalentsView(
      alloc({ spec: 'arms', rows: { 5: 'war_r5_juggernaut', 8: 'war_r8_pummel' } }),
      'warrior',
      10,
    );

    expect(view.hasTalents).toBe(true);
    expect(view.pickedRows).toBe(2);
    expect(view.unlockedRows).toBe(2);
    expect(view.totalRows).toBe(6);
    expect(view.selectedSpec?.id).toBe('arms');
    expect(view.specs.map((entry) => entry.spec.id)).toEqual(['arms', 'fury', 'prot']);
    expect(view.specs.find((entry) => entry.spec.id === 'arms')?.selected).toBe(true);
    expect(view.valid).toBe(true);
  });

  it('marks a future row pick invalid at the current level', () => {
    const view = buildTalentsView(alloc({ rows: { 20: 'war_r20_avatar' } }), 'warrior', 10);
    expect(view.pickedRows).toBe(1);
    expect(view.unlockedRows).toBe(2);
    expect(view.valid).toBe(false);
  });

  it('returns an empty view for an unknown class table', () => {
    const view = buildTalentsView(alloc(), 'not-a-class' as any, 20);
    expect(view.hasTalents).toBe(false);
    expect(view.specs).toEqual([]);
    expect(view.valid).toBe(false);
  });
});
