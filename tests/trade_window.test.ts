// @vitest-environment jsdom
//
// Painter-level pin for the instanced-item tooltip (fix F7d/r8#2, review R1). The
// rolled-stats line on an offered instance row must render a LOCALIZED stat label
// (itemUi.stats.*, the same map hud.ts's item tooltips use) and a
// formatNumber-formatted, +/- signed value - never the raw stat id or a bare
// interpolated number, which would leak an untranslated string onto the live
// trade window. The rest of trade_window's painting is covered by trade_view (the
// pure core) plus the trade suites; this file only nails the tooltip string the
// review flagged, by driving renderTradeWindow over a stub deps bag whose
// attachTooltip captures the lazily-built tooltip HTML.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage, t } from '../src/ui/i18n';
import { buildTradeView, type StagedTradeOffer, type TradeItemLookup } from '../src/ui/trade_view';
import { renderTradeWindow, type TradeWindowDeps } from '../src/ui/trade_window';
import type { TradeInfo } from '../src/world_api';

// worn_sword is a real ITEMS id (src/sim/content/items.ts): the painter reads the
// live ITEMS table for the icon + tooltip attach, so an offered row must carry an
// id that exists there or the tooltip never attaches.
const OFFERED_ID = 'worn_sword';
const lookup: TradeItemLookup = () => ({ quality: 'rare' });

function stagedOf(over: Partial<StagedTradeOffer> = {}): StagedTradeOffer {
  return { items: [], copper: 0, claudium: 0, woc: '0', ...over };
}

function offer(over: Partial<TradeInfo['myOffer']> = {}): TradeInfo['myOffer'] {
  return { items: [], copper: 0, claudium: 0, woc: '0', ...over };
}

function tradeInfo(over: Partial<TradeInfo> = {}): TradeInfo {
  return {
    otherPid: 2,
    otherName: 'Bet',
    myOffer: offer(),
    theirOffer: offer(),
    myAccepted: false,
    theirAccepted: false,
    phase: 'open',
    rails: { claudium: false, woc: false },
    ...over,
  };
}

// Capture the lazily-built tooltip HTML for each attached row. The painter calls
// deps.attachTooltip(el, () => itemTooltip(item) + instanceTooltipLine(row)); we
// invoke the captured builder to read what a hovering player would see.
function renderAndCaptureTooltips(info: TradeInfo): string[] {
  const el = document.createElement('div');
  const captured: Array<() => string> = [];
  const deps = {
    itemIcon: () => '<span class="icon"></span>',
    moneyHtml: (copper: number) => `money:${copper}`,
    itemTooltip: () => 'BASE_TOOLTIP',
    attachTooltip: (_el: HTMLElement, html: () => string) => captured.push(html),
    onRemoveOffered: vi.fn(),
    onMoneyChange: vi.fn(),
    onClaudiumChange: vi.fn(),
    onWocChange: vi.fn(),
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    copyToClipboard: vi.fn(),
    captureFocus: () => null,
    restoreFocus: vi.fn(),
  } satisfies TradeWindowDeps;
  renderTradeWindow(el, buildTradeView(info, stagedOf(), lookup), deps);
  return captured.map((build) => build());
}

describe('renderTradeWindow instanced-row tooltip (review R1)', () => {
  beforeEach(() => {
    setLanguage('en');
  });

  it('localizes each rolled-stat label and formats a signed value (no raw stat id, no bare number)', () => {
    const info = tradeInfo({
      myOffer: offer({
        items: [
          { itemId: OFFERED_ID, count: 1, instance: { rolled: { stats: { str: 5, agi: 3 } } } },
        ],
      }),
    });
    const [tooltip] = renderAndCaptureTooltips(info);
    // Localized labels, not the raw stat ids, with formatNumber-signed values.
    expect(tooltip).toContain(`${t('itemUi.stats.str')} +5`);
    expect(tooltip).toContain(`${t('itemUi.stats.agi')} +3`);
    // The bug shipped "str +5" / "agi +3": the raw id must not reach the string.
    expect(tooltip).not.toContain('str +5');
    expect(tooltip).not.toContain('agi +3');
  });

  it('keeps a negative roll signed through formatNumber', () => {
    const info = tradeInfo({
      myOffer: offer({
        items: [{ itemId: OFFERED_ID, count: 1, instance: { rolled: { stats: { armor: -2 } } } }],
      }),
    });
    const [tooltip] = renderAndCaptureTooltips(info);
    expect(tooltip).toContain(`${t('itemUi.stats.armor')} -2`);
  });

  it('falls back to the raw affix id for a non-catalog stat rather than crashing', () => {
    const info = tradeInfo({
      myOffer: offer({
        // A stat id with no itemUi.stats.* entry: the painter must not throw and
        // must render the raw id (fallback) with a formatted, signed value.
        items: [{ itemId: OFFERED_ID, count: 1, instance: { rolled: { stats: { haste: 4 } } } }],
      }),
    });
    const [tooltip] = renderAndCaptureTooltips(info);
    expect(tooltip).toContain('haste +4');
  });
});
