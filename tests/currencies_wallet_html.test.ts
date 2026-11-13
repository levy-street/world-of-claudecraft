// The Bags wallet strip (menu consolidation step 3): the currencies that left
// the Character sheet, painted as one compact chip row under the bag grid.
import { describe, expect, it } from 'vitest';
import { currenciesWalletHtml } from '../src/ui/hud/currencies/currencies_tab_html';
import { setLanguage } from '../src/ui/i18n';
import type { IWorld } from '../src/world_api';

const world = (over: Record<string, unknown> = {}): IWorld =>
  ({
    heroicMarks: 7,
    honor: 2_980,
    lifetimeHonor: 9_000,
    delveMarks: 12,
    factionCurrencies: { rift_watch: 3, church_order: 0, automatons: 1 },
    ...over,
  }) as unknown as IWorld;

describe('currenciesWalletHtml', () => {
  it('paints one named chip per activity and faction currency, never $WOC', () => {
    setLanguage('en');
    const html = currenciesWalletHtml(world());
    expect(html).toContain('class="bag-wallet-chips"');
    expect(html.match(/class="bag-wallet-chip /g)?.length).toBeGreaterThanOrEqual(6);
    expect(html).toContain('is-honor');
    expect(html).toContain('is-heroic_mark');
    expect(html).toContain('is-rift_watch');
    expect(html).not.toContain('is-woc_token');
    // Each chip carries its accessible name; the visible digits are aria-hidden.
    expect(html).toMatch(/role="img" aria-label="[^"]+: 2,980"/);
  });

  it('is the repaint signature: a moved balance changes the string', () => {
    expect(currenciesWalletHtml(world())).toBe(currenciesWalletHtml(world()));
    expect(currenciesWalletHtml(world({ honor: 3_000 }))).not.toBe(currenciesWalletHtml(world()));
  });
});
