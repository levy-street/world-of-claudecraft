import { describe, expect, it } from 'vitest';
import { currenciesTabHtml } from '../src/ui/hud/currencies/currencies_tab_html';
import type { IWorld } from '../src/world_api';

function worldStub(overrides: Partial<Record<string, unknown>> = {}): IWorld {
  return {
    // A legacy bag stack is deliberately present: the tab must read the
    // currency balance, never count the bags.
    inventory: [
      { itemId: 'heroic_mark', count: 7 },
      { itemId: 'lantern_seal', count: 99 },
    ],
    heroicMarks: 12,
    guildContracts: { week: '', offered: [], done: [], lifetime: 0, seals: 31 },
    honor: 340,
    lifetimeHonor: 1_200,
    delveMarks: 5,
    ...overrides,
  } as unknown as IWorld;
}

describe('currencies tab html', () => {
  it('paints the activity group with the Heroic Marks balance and Honor with its lifetime total', () => {
    const html = currenciesTabHtml(worldStub());
    expect(html).toContain('class="char-cur-row is-heroic_mark"');
    expect(html).toContain('Heroic Mark');
    expect(html).toContain('>12<');
    // Lantern Seals: the guild's currency balance (never the legacy bag stack of 99)
    expect(html).toContain('class="char-cur-row is-lantern_seal"');
    expect(html).toContain('Lantern Seal');
    expect(html).toContain('currency-lantern-seal');
    expect(html).toContain('>31<');
    expect(html).not.toContain('>99<');
    expect(html).toContain('class="char-cur-row is-honor"');
    expect(html).toContain('>340<');
    expect(html).toContain('Lifetime 1,200');
    expect(html).toContain('class="char-cur-row is-delve_mark"');
    expect(html).toContain('currency-delve_mark');
  });

  it('paints one row per faction with its currency icon, name, note and balance', () => {
    const html = currenciesTabHtml(
      worldStub({
        factionCurrencies: { rift_watch: 50, church_order: 20, automatons: 5 },
      }),
    );
    expect(html.match(/char-cur-row is-faction/g)).toHaveLength(3);
    expect(html).toContain('currency-rift_watch_mark');
    expect(html).toContain('Rift Watch Mark');
    expect(html).toContain('>50<');
    expect(html).toContain('currency-church_order_crest');
    expect(html).toContain('Order Crest');
    expect(html).toContain('>20<');
    expect(html).toContain('currency-automaton_cog');
    expect(html).toContain('Automaton Cog');
    expect(html).toContain('>5<');
  });

  it('escapes every value and clamps corrupt balances', () => {
    const html = currenciesTabHtml(
      worldStub({ honor: -3, delveMarks: Number.NaN, heroicMarks: -2 }),
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('-3');
    expect(html).not.toContain('NaN');
  });
});
