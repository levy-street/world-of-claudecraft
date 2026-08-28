// @vitest-environment happy-dom

// The unbind list's rows on the cell authority (worn_item_cell_view.ts, the
// phase 13 QA round-3 frontend finding): the row already carried the FIRST
// bound copy's instance for its tooltip while the label, the icon rim, and
// the quality glow read the def alone, so a named or legendary-rolled bound
// copy rendered def name, def rim, def glow beside a tooltip that said
// otherwise. The rig drives the real painter with a recording icon dep.
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { ItemDef } from '../src/sim/types';
import type { UnbindView } from '../src/ui/hud/vendor/unbind_view';
import { renderUnbindWindow, type UnbindWindowDeps } from '../src/ui/hud/vendor/unbind_window';
import { QUALITY_COLOR } from '../src/ui/icons';

const plainId = 'worn_sword';
const plainDef: ItemDef = ITEMS[plainId];

function render(view: UnbindView): { el: HTMLElement; qualities: (string | undefined)[] } {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const qualities: (string | undefined)[] = [];
  const deps: UnbindWindowDeps = {
    itemIcon: (_item, quality) => {
      qualities.push(quality);
      return '<img>';
    },
    moneyHtml: (copper) => `${copper}c`,
    itemTooltip: () => '',
    attachTooltip: () => {},
    hideTooltip: () => {},
    onUnbind: () => {},
    onClose: () => {},
  };
  renderUnbindWindow(el, 'Master', view, deps);
  return { el, qualities };
}

describe('unbind window rows read the cell authority for the copy they unbind', () => {
  it('a named legendary-rolled bound copy reads as itself: name, rim, and glow', () => {
    const { el, qualities } = render({
      rows: [
        {
          itemId: plainId,
          item: plainDef,
          boundCount: 1,
          instance: {
            rolled: { quality: 'legendary' },
            name: '<b>Oath</b> of "Vel\'tara"',
            boundTo: 7,
          },
          feeCopper: 500,
          affordable: true,
        },
        { itemId: plainId, item: plainDef, boundCount: 1, feeCopper: 500, affordable: true },
      ],
    });
    const rows = el.querySelectorAll<HTMLElement>('.vendor-item');
    expect(rows.length).toBe(2);
    // The hostile spelling: raw into the aria, escaped at the innerHTML sink.
    expect(rows[0].getAttribute('aria-label')).toContain('<b>Oath</b> of "Vel\'tara"');
    const name = rows[0].querySelector('.vi-name');
    expect(name?.textContent).toContain('<b>Oath</b> of "Vel\'tara"');
    expect(name?.innerHTML).toContain('&lt;b&gt;');
    expect(name?.querySelector('b')).toBeNull();
    // The glow reads the copy's tier; the plain row keeps its def tier.
    const socket = rows[0].querySelector<HTMLElement>('.crafting-recipe-socket');
    // qualityGlowShadow spells the tier's hex as rgba: #ff8000 is 255, 128, 0.
    expect(QUALITY_COLOR.legendary).toBe('#ff8000');
    expect(socket?.getAttribute('style') ?? '').toContain('rgba(255, 128, 0');
    expect(rows[1].getAttribute('aria-label')).toContain(plainDef.name);
    expect(rows[1].getAttribute('aria-label')).not.toContain('Oath');
    // The icon dep was asked for each row's OWN effective quality.
    expect(qualities).toEqual(['legendary', plainDef.quality]);
    expect(plainDef.quality).toBeDefined();
  });
});
