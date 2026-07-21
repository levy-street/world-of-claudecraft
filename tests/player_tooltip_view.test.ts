import { describe, expect, it } from 'vitest';
import {
  type PlayerTooltipI18n,
  type PlayerTooltipModel,
  playerTooltipHtml,
} from '../src/ui/player_tooltip_view';

const fakeT = (key: string, params?: Record<string, string>): string =>
  params
    ? `${key}(${Object.entries(params)
        .map(([k, v]) => `${k}=${v}`)
        .join(',')})`
    : key;
const fakeFmt = (v: number): string => String(v);
const deps: PlayerTooltipI18n = { t: fakeT, fmt: fakeFmt };

const model = (over: Partial<PlayerTooltipModel> = {}): PlayerTooltipModel => ({
  name: 'Aldwin',
  classLabel: 'Mage',
  classColor: '#69ccf0',
  level: 12,
  ...over,
});

describe('playerTooltipHtml', () => {
  it('renders a class-colored name and localized level/class line', () => {
    const html = playerTooltipHtml(model(), deps);

    expect(html).toContain('<div class="tt-title" style="color:#69ccf0">Aldwin</div>');
    expect(html).toContain(
      '<div class="tt-sub">itemUi.equipment.levelClass(level=12,className=Mage)</div>',
    );
  });

  it('renders a guild line only when the guild is non-empty', () => {
    expect(playerTooltipHtml(model({ guild: 'The Azure Order' }), deps)).toContain(
      '<div class="tt-sub">The Azure Order</div>',
    );
    expect(playerTooltipHtml(model({ guild: '' }), deps).match(/class="tt-sub"/g)).toHaveLength(1);
    expect(playerTooltipHtml(model(), deps).match(/class="tt-sub"/g)).toHaveLength(1);
  });

  it('escapes player-controlled name and guild text', () => {
    const html = playerTooltipHtml(model({ name: '<Aldwin>', guild: '<The Azure Order>' }), deps);

    expect(html).not.toContain('<Aldwin>');
    expect(html).not.toContain('<The Azure Order>');
    expect(html).toContain('&lt;Aldwin&gt;');
    expect(html).toContain('&lt;The Azure Order&gt;');
  });

  it('is deterministic for the same model', () => {
    expect(playerTooltipHtml(model({ guild: 'The Azure Order' }), deps)).toBe(
      playerTooltipHtml(model({ guild: 'The Azure Order' }), deps),
    );
  });
});
