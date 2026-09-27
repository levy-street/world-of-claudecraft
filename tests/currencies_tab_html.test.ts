import { describe, expect, it } from 'vitest';
import { currenciesTabHtml } from '../src/ui/hud/currencies/currencies_tab_html';
import type { IWorld } from '../src/world_api';

function worldStub(overrides: Partial<Record<string, unknown>> = {}): IWorld {
  return {
    inventory: [
      { itemId: 'heroic_mark', count: 4 },
      { itemId: 'copper_ore', count: 9 },
      { itemId: 'heroic_mark', count: 8 },
    ],
    honor: 340,
    lifetimeHonor: 1_200,
    delveMarks: 5,
    ...overrides,
  } as unknown as IWorld;
}

describe('currencies tab html', () => {
  it('paints the activity group with the bag-counted Heroic Marks and Honor with its lifetime total', () => {
    const html = currenciesTabHtml(worldStub());
    expect(html).toContain('class="char-cur-row is-heroic_mark"');
    expect(html).toContain('Heroic Mark');
    expect(html).toContain('>12<');
    expect(html).toContain('class="char-cur-row is-honor"');
    expect(html).toContain('>340<');
    expect(html).toContain('Lifetime 1,200');
    expect(html).toContain('class="char-cur-row is-delve_mark"');
    expect(html).toContain('currency-delve_mark');
  });

  it('paints one pending row per faction with a zero it never invents a balance for', () => {
    const html = currenciesTabHtml(worldStub());
    expect(html.match(/char-cur-row is-faction is-pending/g)).toHaveLength(3);
    expect(html).toContain('Faction currency: pending Stage 2');
    expect(html).toContain('Rift Watch');
  });

  it('escapes every value and clamps corrupt balances', () => {
    const html = currenciesTabHtml(worldStub({ honor: -3, delveMarks: Number.NaN, inventory: [] }));
    expect(html).not.toContain('<script');
    expect(html).not.toContain('-3');
    expect(html).not.toContain('NaN');
  });
});
