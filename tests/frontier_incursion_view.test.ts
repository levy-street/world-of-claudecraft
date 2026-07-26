import { describe, expect, it } from 'vitest';
import { frontierIncursionBarView } from '../src/ui/frontier_incursion_view';

describe('frontierIncursionBarView', () => {
  it('hides when the viewer is not in the band (null state)', () => {
    const v = frontierIncursionBarView({ state: null, rareName: '' });
    expect(v.visible).toBe(false);
    expect(v.active).toBe(false);
    expect(v.fillFrac).toBe(0);
  });

  it('shows the meter while building', () => {
    const v = frontierIncursionBarView({
      state: { progress: 0.42, active: false, rareTemplateId: null, rareHpFrac: 0 },
      rareName: '',
    });
    expect(v.visible).toBe(true);
    expect(v.active).toBe(false);
    expect(v.fillFrac).toBeCloseTo(0.42, 5);
    expect(v.label).toContain('42%');
  });

  it('flips to the rare name + HP while a rare is up', () => {
    const v = frontierIncursionBarView({
      state: { progress: 0, active: true, rareTemplateId: 'rimefang_stalker', rareHpFrac: 0.73 },
      rareName: 'Rimefang Stalker',
    });
    expect(v.visible).toBe(true);
    expect(v.active).toBe(true);
    expect(v.fillFrac).toBeCloseTo(0.73, 5);
    expect(v.label).toContain('Rimefang Stalker');
    expect(v.label).toContain('73%');
  });

  it('clamps fractions to 0..1', () => {
    const over = frontierIncursionBarView({
      state: { progress: 1.5, active: false, rareTemplateId: null, rareHpFrac: 0 },
      rareName: '',
    });
    expect(over.fillFrac).toBe(1);
  });
});
