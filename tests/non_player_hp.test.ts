import { describe, expect, it } from 'vitest';
import { nonPlayerMaxHpAfterAura, nonPlayerMaxHpWithAuras } from '../src/sim/pet/non_player_hp';
import type { Aura } from '../src/sim/types';

function aura(kind: Aura['kind'], value: number): Pick<Aura, 'kind' | 'value'> {
  return { kind, value };
}

describe('non-player max-health aura folds', () => {
  it('composes flat stamina before percentage stamina in aura order', () => {
    expect(nonPlayerMaxHpWithAuras(100, [aura('buff_sta', 2), aura('buff_sta_pct', 5)])).toBe(126);
    expect(
      nonPlayerMaxHpWithAuras(100, [aura('buff_allstats', 2), aura('buff_stats_pct', 5)]),
    ).toBe(126);
  });

  it('reverses the same percentage and flat folds back to the authored pool', () => {
    const withoutPercent = nonPlayerMaxHpAfterAura(126, aura('buff_sta_pct', 5), -1);
    expect(withoutPercent).toBe(120);
    expect(nonPlayerMaxHpAfterAura(withoutPercent, aura('buff_sta', 2), -1)).toBe(100);
  });

  it('ignores unrelated auras and clamps a drained pool to one health', () => {
    expect(nonPlayerMaxHpAfterAura(100, aura('buff_armor', 50), 1)).toBe(100);
    expect(nonPlayerMaxHpAfterAura(10, aura('buff_sta', -5), 1)).toBe(1);
  });
});
