// WCAG-chrome + wiring guard for the Collections window DOM painter.
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
const icons = read('../src/ui/ui_icons.ts');

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
    // Escape closes through the painter too, not a raw hide.
    expect(hud).toContain("case 'collections-window':");
    expect(hud).toContain('this.collectionsWindow.close();');
  });

  it('marks the dialog root once on open and relocalizes by clearing the sig', () => {
    expect(code).toContain("markDialogRoot(root, { labelledBy: 'collections-title' })");
    expect(code).toContain('relocalize()');
    expect(hud).toContain('this.collectionsWindow.relocalize();');
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
    expect(hud).toContain(
      "if ($('#collections-window').style.display === 'block') this.collectionsWindow.render();",
    );
  });

  it('keeps the view core free of any renderer import', () => {
    // Mount visual keys are injected by the host; the core stays render-free so
    // it runs in the Node suite unchanged.
    expect(view).not.toContain("from '../../render");
    expect(host).toContain("from '../../render/mount_visuals'");
  });

  it('ships the window root and a micro-menu launcher beside the PvP icon', () => {
    expect(html).toContain('<div id="collections-window" class="window panel"></div>');
    expect(html).toContain('id="mm-collections"');
    // Beside the PvP (G) button, which is what the launcher row promises.
    expect(html.indexOf('id="mm-collections"')).toBeGreaterThan(html.indexOf('id="mm-arena"'));
    expect(hud).toContain("$('#mm-collections').addEventListener('click', () =>");
  });

  it('groups the buddy tab by pet kind and paints its headings', () => {
    expect(code).toContain('buddyListHtml(');
    expect(code).toContain('PET_KIND_LABEL');
    // The painter never re-sorts: the view core owns kind and rarity order.
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

  it('launches as Hunting, behind the animal-face glyph', () => {
    expect(html).toContain('data-icon="hunting"');
    expect(icons).toContain("  | 'hunting'");
  });

  it('binds the window to a keybind of its own', () => {
    const bind = BIND_ACTIONS.find((entry) => entry.id === 'collections');
    expect(bind?.defaults).toEqual(['Shift+KeyC']);
    expect(bind?.category).toBe('Interface');
  });

  it('states the live-price limits instead of painting a blank or stale figure', () => {
    // Both price rows have an explicit "where this comes from" state: the
    // market figure only streams at the Merchant, and the Exchange is
    // browser-web only.
    expect(code).toContain('marketAtMerchant');
    expect(code).toContain('exchangeUnavailable');
  });
});
