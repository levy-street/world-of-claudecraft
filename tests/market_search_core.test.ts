import { describe, expect, it, vi } from 'vitest';
import { encodeMarketLocalizedItemMask } from '../src/sim/market_query';
import { marketLocalizedItemMask } from '../src/ui/market_search_core';

interface Candidate {
  id: string;
}

const candidate = (id: string): Candidate => ({ id });

describe('marketLocalizedItemMask', () => {
  it('encodes a localized-only, case-insensitive partial match', () => {
    const names: Record<string, string> = {
      wolf_fang: 'Colmillo de lobo quebrado',
      keen_dirk: 'Daga afilada',
    };

    expect(
      marketLocalizedItemMask(
        'LOBO',
        [candidate('wolf_fang'), candidate('keen_dirk')],
        (item) => names[item.id],
      ),
    ).toBe(encodeMarketLocalizedItemMask(['wolf_fang']));
  });

  it('returns an empty hint for empty or whitespace-only search without resolving names', () => {
    const displayNameOf = vi.fn(() => 'Anything');

    expect(marketLocalizedItemMask('', [candidate('wolf_fang')], displayNameOf)).toBe('');
    expect(marketLocalizedItemMask('   \t\n ', [candidate('wolf_fang')], displayNameOf)).toBe('');
    expect(displayNameOf).not.toHaveBeenCalled();
  });

  it('is deterministic across candidate order and duplicate ids', () => {
    const names: Record<string, string> = {
      wolf_fang: 'Shared localized name',
      keen_dirk: 'Shared localized name',
    };
    const displayNameOf = (item: Candidate): string => names[item.id];
    const expected = encodeMarketLocalizedItemMask(['keen_dirk', 'wolf_fang']);

    expect(
      marketLocalizedItemMask(
        'localized',
        [candidate('wolf_fang'), candidate('keen_dirk'), candidate('wolf_fang')],
        displayNameOf,
      ),
    ).toBe(expected);
    expect(
      marketLocalizedItemMask(
        'localized',
        [candidate('keen_dirk'), candidate('wolf_fang')],
        displayNameOf,
      ),
    ).toBe(expected);
  });

  it('follows the injected resolver for heroic base names and display fallbacks', () => {
    const names: Record<string, string> = {
      moonshroud_robe: 'Robe de la nuit',
      heroic_moonshroud_robe: 'Robe de la nuit',
      bone_fragments: 'Fallback bone fragments',
    };
    const candidates = [
      candidate('moonshroud_robe'),
      candidate('heroic_moonshroud_robe'),
      candidate('bone_fragments'),
    ];
    const displayNameOf = (item: Candidate): string => names[item.id];

    expect(marketLocalizedItemMask('nuit', candidates, displayNameOf)).toBe(
      encodeMarketLocalizedItemMask(['moonshroud_robe', 'heroic_moonshroud_robe']),
    );
    expect(marketLocalizedItemMask('fallback', candidates, displayNameOf)).toBe(
      encodeMarketLocalizedItemMask(['bone_fragments']),
    );
  });

  it('uses only the first 40 raw characters as the effective search', () => {
    const forty = 'q'.repeat(40);
    const names: Record<string, string> = {
      wolf_fang: `${forty} tail`,
      keen_dirk: `${'q'.repeat(39)}r tail`,
    };

    expect(
      marketLocalizedItemMask(
        `${forty}r`,
        [candidate('wolf_fang'), candidate('keen_dirk')],
        (item) => names[item.id],
      ),
    ).toBe(encodeMarketLocalizedItemMask(['wolf_fang']));
  });
});
