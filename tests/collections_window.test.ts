// Retained Collections painter contracts and active-game retirement guards.
//
// The painter's DOM methods need a document, so they are not exercised in this
// Node suite; the decisions it renders are covered by tests/collections_view
// .test.ts and tests/collections_sources.test.ts. This guard pins the
// a11y-bearing markup (focusable controls, aria labels, focus-return), the
// coordinator wiring the window depends on, and the two contracts that are
// easy to break silently: one shared preview canvas, and no second copy of the
// content tables.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BIND_ACTIONS } from '../src/game/keybinds';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
const strip = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const code = strip(read('../src/ui/collections/collections_window.ts'));
const host = strip(read('../src/ui/collections/collections_host.ts'));
const view = strip(read('../src/ui/collections/collections_view.ts'));
const hud = read('../src/ui/hud.ts');
const html = read('../index.html');
const css = read('../src/styles/components.css');

describe('collections_window: WCAG chrome and window contract', () => {
  it('drives every panel from the pure view core', () => {
    expect(code).toContain('buildCollectionsView(');
    // The painter holds no catalog of its own: the tables are the view core's.
    expect(code).not.toContain('BUDDIES');
    expect(code).not.toContain('MOUNTS');
    expect(code).not.toContain('ITEM_SETS');
  });

  it('gives the close control a real button with an aria-label', () => {
    expect(code).toContain('class="x-btn" data-close');
    expect(code).toContain("t('hudChrome.collections.close')");
  });

  it('renders the tab strip as real buttons carrying selection state', () => {
    expect(code).toContain('role="tablist"');
    expect(code).toContain('role="tab"');
    expect(code).toContain('aria-selected=');
  });

  it('routes every close path through close() so focus returns to the opener', () => {
    expect(code).toContain("data-close]')?.addEventListener('click', () => this.close())");
    expect(code).toContain('this.deps.restoreFocus(this.openerFocus)');
    expect(code).toContain('this.openerFocus = this.deps.captureFocus()');
  });

  it('marks the retained dialog root once on open', () => {
    expect(code).toContain("markDialogRoot(root, { labelledBy: 'collections-title' })");
  });

  it('mounts the SHARED turntable rather than standing up a second WebGL context', () => {
    // The window asks its host to mount a preview; it never constructs one.
    expect(code).toContain('this.deps.mountPreview(');
    expect(code).not.toContain('new CharacterPreview');
    expect(hud).toContain('this.mountSharedPreview(');
    expect(host).toContain('collectionsPreviewOptions');
  });

  it('keeps the render-skip signature text-independent, so a repaint band is cheap', () => {
    expect(code).toContain('if (sig === this.lastSig) return;');
  });

  it('keeps the view core free of any renderer import', () => {
    // Mount visual keys are injected by the host; the core stays render-free so
    // it runs in the Node suite unchanged.
    expect(view).not.toContain("from '../../render");
    expect(host).toContain("from '../../render/mount_visuals'");
  });

  it('removes the retired window from both shells and the HUD lifecycle', () => {
    for (const shell of [html, read('../play.html')]) {
      expect(shell).not.toContain('id="collections-window"');
      expect(shell).not.toContain('id="mm-collections"');
      expect(shell).not.toContain('data-icon="hunting"');
    }
    expect(hud).not.toMatch(
      /collectionsWindow|toggleCollections|collections-window|mm-collections/,
    );
    expect(hud).not.toContain("from './collections'");
    expect(read('../src/main.ts')).not.toContain('toggleCollections');
    expect(read('../src/guide/pages/controls.ts')).not.toContain(
      'hudChrome.collections.launcherTitle',
    );
    expect(read('../src/game/input.ts')).not.toContain("'collections'");
    expect(read('../src/ui/hud/menu/side_buttons.ts')).not.toContain('#mm-collections');
  });

  it('paints the complete buddy list without kind headings', () => {
    expect(code).toContain('this.entryListHtml(rows, selectedKey)');
    expect(code).not.toContain('PET_KIND_LABEL');
    expect(code).not.toContain('buddyListHtml(');
    expect(code).not.toContain('rarityRank(');
  });

  it('marks owned set pieces and hangs the real item tooltip on the row', () => {
    // A tick beside the name and a class the stylesheet rings in green.
    expect(code).toContain('col-tick');
    expect(code).toContain("' col-owned'");
    expect(css).toContain('.col-piece.col-owned .item-icon');
    // The tooltip is the HUD's own item tooltip, not a second rendering.
    expect(code).toContain('this.deps.attachTooltip(row, () => this.deps.itemTooltip(item))');
  });

  it('shows item level and set bonuses, wording the bonus like the tooltip does', () => {
    expect(code).toContain('collections.set.itemLevel');
    expect(code).toContain('collections.set.bonusLabel');
    // The bonus TEXT comes from the shared entity key, never a local copy.
    expect(code).toContain('itemSetBonusField(pieces)');
  });

  it('removes Hunting from keybind settings and releases its default shortcut', () => {
    expect(BIND_ACTIONS.find((entry) => entry.id === 'collections')).toBeUndefined();
    expect(BIND_ACTIONS.flatMap((entry) => entry.defaults)).not.toContain('Shift+KeyC');
  });

  it('states the live-price limits instead of painting a blank or stale figure', () => {
    // Both price rows have an explicit "where this comes from" state: the
    // market figure only streams at the Merchant, and the Exchange is
    // browser-web only.
    expect(code).toContain('marketAtMerchant');
    expect(code).toContain('exchangeUnavailable');
  });
});
