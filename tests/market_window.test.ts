import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The market window painter is a DOM module; driving the live DOM + events is the
// opt-in browser suite. This is the no-DOM-suite equivalent: it
// asserts the painter source carries the a11y attributes, the
// token/named-constant discipline, and that filtering is delegated to
// the pure core (no duplicated market_filters logic).
const painter = readFileSync(new URL('../src/ui/market_window.ts', import.meta.url), 'utf8');
const core = readFileSync(new URL('../src/ui/market_view.ts', import.meta.url), 'utf8');
const componentsCss = readFileSync(
  new URL('../src/styles/components.css', import.meta.url),
  'utf8',
);
const mobileCss = readFileSync(
  new URL('../src/styles/hud.mobile.css', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');
const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

describe('market_window: no magic values', () => {
  it('carries no literal color in TS (colors live in the extracted stylesheet/tokens)', () => {
    const hex = painter.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hex, `hex colors must move to tokens/CSS: ${hex.join(', ')}`).toEqual([]);
    expect(painter, 'rgb()/hsl() color literal must move to tokens/CSS').not.toMatch(
      /\b(?:rgba?|hsla?)\(/,
    );
  });

  it('routes the unranked quality fallback through a CSS token, not a hex literal', () => {
    expect(painter).toContain("const QUALITY_DEFAULT_COLOR = 'var(--color-quality-default)'");
  });

  it('names the coin-conversion constants instead of bare 10000 / 100', () => {
    expect(painter).toContain('gg * COPPER_PER_GOLD + ss * COPPER_PER_SILVER + cc');
    expect(painter.match(/\b10000\b/g) ?? [], 'no bare 10000 copper-per-gold literal').toEqual([]);
  });

  it('uses no em or en dashes (ASCII separators only)', () => {
    expect(painter.includes('—'), 'em dash found').toBe(false);
    expect(painter.includes('–'), 'en dash found').toBe(false);
  });
});

describe('market_window: WCAG 2.2 AA', () => {
  it('returns focus to the opener on close', () => {
    expect(painter).toContain('captureFocus');
    expect(painter).toContain('restoreFocus');
    const close = painter.slice(painter.indexOf('close(): void {'));
    expect(close).toContain('this.deps.restoreFocus(this.openerFocus)');
  });

  it('labels its controls and exposes listbox roles on the filter menus', () => {
    expect(painter).toContain('itemUi.market.close'); // close button aria-label key
    expect(painter).toContain('aria-pressed='); // the tab buttons
    expect(painter).toContain('role="listbox"');
    expect(painter).toContain('role="option"');
    expect(painter).toContain('aria-haspopup="listbox"');
    expect(painter).toContain('aria-selected=');
    expect(painter).toContain('aria-label="${esc(t(\'itemUi.market.searchAria\'))}"');
    // buy/reclaim buttons get a programmatic name even though their face text is plain
    expect(painter).toContain("t(l.mine ? 'itemUi.market.reclaimAria' : 'itemUi.market.buyAria'");
  });

  it('makes the filter listboxes keyboard-operable via the shared dropdownKeyNav core', () => {
    // The role=listbox the menus advertise is now actually keyboard-operable. The
    // options are programmatically focusable but out of the Tab order (the roving pattern),
    // and the wiring reuses the existing pure core rather than a bespoke re-implementation,
    // so this guard fails if the keyboard nav is dropped.
    expect(painter).toContain('role="option" tabindex="-1"');
    expect(painter).toContain("import { dropdownKeyNav } from './dropdown_nav'");
    expect(painter).toContain('dropdownKeyNav(');
  });
});

describe('market_window: desktop docking with bags (PR #2107 review round 4)', () => {
  it('toggles a market-open body class on open and close, on every close path', () => {
    const open = painter.slice(
      painter.indexOf('open(): void {'),
      painter.indexOf('close(): void {'),
    );
    expect(open).toContain("document.body.classList.add('market-open')");
    const close = painter.slice(painter.indexOf('close(): void {'));
    expect(close).toContain("document.body.classList.remove('market-open')");
    // The X button routes through this.close() (not a bespoke DOM hide), so the
    // class removal above also covers that close path, not just Esc/closeManagedWindow.
    expect(painter).toContain(
      "querySelector('[data-close]')?.addEventListener('click', () => this.close())",
    );
  });

  it('docks #market-window and #bags off the same 50% split so they can never overlap', () => {
    // Reuses the body.bank-open docking pattern instead of a viewport-width-dependent
    // width cap: market's core Sell-tab workflow needs bags always fully visible
    // alongside it, on every viewport width, not just the ones a cap happens to cover.
    expect(componentsCss).toContain('body.market-open {\n    --bank-dock-gap: 8px;\n  }');
    expect(componentsCss).toContain('body.market-open #market-window {\n    left: 50%;');
    expect(componentsCss).toContain('transform: translateX(calc(-100% - var(--bank-dock-gap)));');
    expect(componentsCss).toContain('body.market-open #bags {\n    left: 50%;');
    expect(componentsCss).toContain('transform: translateX(var(--bank-dock-gap));');
  });

  it('re-clamps #market-window max-width against half the dock split, not the full viewport (PR #2107 review round 4 follow-up)', () => {
    // The generic .window max-width clamp (layout.css) is computed against the FULL
    // app viewport, so it never bites on the half the dock actually leaves this
    // window: #market-window's left edge used to clip outside #ui on common desktop
    // widths below ~1752px. This narrower clamp keeps the docked pair on-screen.
    const dockBlock = componentsCss.slice(
      componentsCss.indexOf('body.market-open #market-window {'),
    );
    const block = dockBlock.slice(0, dockBlock.indexOf('body.market-open #bags {'));
    expect(block).toContain('max-width: calc(');
    expect(block).toContain('var(--app-vw, 100vw) / var(--window-scale) / 2');
    expect(block).toContain('var(--bank-dock-gap)');
  });

  it('exempts the market cluster from the window-cascade position bake (mirrors the bank/vendor guard, PR #2107 review round 5)', () => {
    // placeNewWindow bakes an inline cascade-offset inset the moment a second window
    // is already open; on the market's forced-open-bags cluster that inline inset
    // beats the docking CSS above and re-overlaps the two windows. The market cluster
    // must be exempted exactly as the bank cluster is, or opening a third window
    // (e.g. bags first, then market) silently regresses the docked pairing.
    expect(hud).toMatch(
      /classList\.contains\('market-open'\)\s*&&\s*\(el\.id === 'market-window' \|\| el\.id === 'bags'\)\s*\)\s*return;/,
    );
  });
});

describe('market_window: mobile pairing (hud.mobile.css)', () => {
  // Whitespace-normalized view: biome wraps long selector lists and declarations,
  // so raw multi-line source pins on these rules would rot on a reformat.
  const norm = mobileCss.replace(/\s+/g, ' ');

  it('joins the paired-geometry rule so the desktop dock cannot leak through on touch', () => {
    // The regression this fix exists for: the mobile sheet base never declared
    // height, so the desktop #market-window height: min(640px, calc(85vh - 24px))
    // leaked through the layer order and squeezed the market to a ~308px sliver
    // on a landscape phone (about 1.5 listing rows), while the force-opened
    // #bags companion had no mobile pairing arm at all and stacked fully over
    // the market, burying the Sell staging flow. The paired rule must
    // neutralize every desktop docking property for BOTH halves of the market
    // cluster (max-width/max-height/transform included, mirroring the bank's
    // neutralizer, so no desktop clamp can undercut the 50/50 split).
    const start = norm.indexOf(
      'body.mobile-touch.bank-open #bank-window, body.mobile-touch.bank-open #bags, body.mobile-touch.market-open #market-window, body.mobile-touch.market-open #bags {',
    );
    expect(start, 'the market cluster must join the shared paired-geometry rule').toBeGreaterThan(
      0,
    );
    const block = norm.slice(start, norm.indexOf('}', start));
    expect(block).toContain('max-width: none');
    expect(block).toContain('max-height: none');
    expect(block).toContain('transform: none');
    // Full height above the tray reservation, mirroring the bank/vendor pairing.
    expect(block).toContain('top: max(10px, env(safe-area-inset-top))');
    expect(block).toContain('bottom: calc(72px + env(safe-area-inset-bottom))');
    // The standalone (undocked) mobile arm owns height too: a bags-only close
    // undocks the market onto the sheet base, where the desktop clamp would
    // otherwise re-leak and mis-size the sheet against the viewport. The full
    // block is pinned so the docked pair's overflow-x: hidden (inherited from
    // this lower-specificity rule) cannot silently vanish either.
    expect(norm).toContain(
      'body.mobile-touch #market-window { height: auto; max-height: calc(var(--app-vh) / var(--ui-scale, 1) - 20px); overflow-y: auto; overflow-x: hidden; }',
    );
  });

  it('joins the paired-cluster companion rules: chips one row, titles aligned, own x-btn kept', () => {
    // The market's #bags half sits at the same half-viewport width as the
    // bank's, so it joins the one-scrollable-row chips rule (a wrapped chip
    // row eats the grid on 360px-tall phones) and the 47px title alignment.
    expect(norm).toContain('body.mobile-touch.market-open #bags .bag-chips { flex-wrap: nowrap;');
    expect(norm).toContain('body.mobile-touch.market-open #bags .bag-chip { flex: 0 0 auto; }');
    expect(norm).toContain(
      'body.mobile-touch.market-open #market-window .panel-title, body.mobile-touch.market-open #bags .panel-title { height: 47px;',
    );
    // Deliberate divergence from the bank/vendor pairs: the market KEEPS its
    // own x-btn (bags is only its optional Sell-tab companion, and the bags
    // x-btn deliberately closes bags alone), so no hide rule may appear.
    expect(norm).not.toContain('body.mobile-touch.market-open #market-window .panel-title .x-btn');
  });

  it('disqualifies the market pairing from the fullscreen bottom-bar hide (fairness)', () => {
    // The paired-geometry rule reserves the 72px band FOR the player frame;
    // without the market-open disqualifier the docked bags flips
    // mobile-fullscreen-window-open and hides own HP/resource while the world
    // keeps running. The core pins the flag list; this pins the hud wiring.
    expect(hud).toMatch(
      /isMobileFullscreenWindowOpen\([\s\S]{0,400}?contains\('market-open'\),\s*document\.body\.classList\.contains\('char-bags-paired'\)/,
    );
  });

  it('pairs the market cluster 50/50 at the scale-aware split: market LEFT, bags RIGHT', () => {
    // #ui's zoom multiplies author lengths, so the split divides the shared
    // --app-vw box by the live scale (the bank/vendor split-point rationale).
    const split = 'calc(var(--app-vw) / var(--ui-scale, 1) / 2)';
    const left = norm.indexOf('body.mobile-touch.market-open #market-window {');
    expect(left, 'the market-open left-half rule must exist').toBeGreaterThan(0);
    const leftBlock = norm.slice(left, norm.indexOf('}', left));
    expect(leftBlock).toContain('left: max(10px, env(safe-area-inset-left))');
    expect(leftBlock).toContain(`right: ${split}`);
    // The market keeps its whole-sheet scroll model (PR #2107): height: auto
    // releases the desktop 640px clamp so the top/bottom pins size the sheet
    // and the window scroller gets real room instead of a clipped sliver.
    expect(leftBlock).toContain('height: auto');
    expect(leftBlock).toContain('overflow-y: auto');
    expect(norm).toContain(
      `body.mobile-touch.bank-open #bags, body.mobile-touch.market-open #bags { left: ${split}`,
    );
  });

  it('undocks a still-open market when bags alone closes on touch, and re-docks on re-open', () => {
    // A bags-only close (the bags x-btn or the tray toggle; the market keeps its
    // own x-btn) must not leave the still-open market pinned to the left half of
    // the pairing with nothing on the right: dropping the class lets the
    // standalone mobile sheet rule take the full width back, mirroring the
    // bank undock in onBagsClosed. toggleBags re-docks on re-open.
    expect(hud).toMatch(
      /private onBagsClosed\(\): void \{[\s\S]{0,1200}?contains\('mobile-touch'\) && this\.marketWindow\.isOpen[\s\S]{0,120}?classList\.remove\('market-open'\);/,
    );
    expect(hud).toMatch(
      /this\.bagsWindow\.noteOpener\(\);[\s\S]{0,700}?if \(this\.marketWindow\.isOpen\) document\.body\.classList\.add\('market-open'\);/,
    );
  });
});

describe('market_window: behavior preserved through the core', () => {
  it('renders every state of the view union (no-data + the three tabs)', () => {
    expect(painter).toContain("view.kind === 'no-data'");
    expect(painter).toContain('itemUi.market.noMerchant'); // the loading / no-merchant copy
    expect(painter).toContain("view.kind === 'browse'");
    expect(painter).toContain("view.kind === 'sell'");
    // the three browse empty reasons
    expect(painter).toContain('itemUi.market.emptySearch');
    expect(painter).toContain('itemUi.market.emptyFiltered');
    expect(painter).toContain('itemUi.market.emptyBrowse');
  });

  it('delegates browse rendering to the pure view core, with filtering done server-side', () => {
    expect(painter).toContain('buildMarketView');
    // Neither the painter nor the client view re-derives filtering/pagination: the
    // server filters + paginates the WHOLE market (so a player can page through it all),
    // and the view just renders the page the snapshot carries.
    expect(painter, 'filtering is server-side now').not.toContain('filterMarketListings');
    expect(painter, 'pagination is server-side now').not.toContain('paginateMarketListings');
    expect(core, 'the view renders the server page directly').not.toContain('filterMarketListings');
    const market = readFileSync(new URL('../src/sim/market.ts', import.meta.url), 'utf8');
    expect(market, 'the server is the single source of browse filtering').toContain(
      'marketItemMatches',
    );
  });

  // Source discipline only: the RENDERED menus, their labels, the committed values and the
  // emitted query are asserted for real in tests/browser/keyboard_nav.browser.test.ts. The
  // aria-label grep below is not redundant with it: reverting to a hand-built
  // `${label}: ${current}` produces a byte-identical English string, so the DOM assertion
  // cannot see that regression and this source pin is the only guard against it.
  it('wires the advanced filters through the shared constants and the i18n aria pattern', () => {
    expect(painter).toContain('MARKET_ARMOR_CLASS_FILTERS');
    expect(painter).toContain('MARKET_PRIMARY_STAT_FILTERS');
    expect(painter).toMatch(/this\.renderMarketFilterMenu\(\s*'armorClass'/);
    expect(painter).toMatch(/this\.renderMarketFilterMenu\(\s*'primaryStat'/);
    expect(painter).toContain('armorClass: this.armorClassFilter');
    expect(painter).toContain('primaryStat: this.primaryStatFilter');
    expect(painter).toContain("t('itemUi.market.filterValueAria', { label, value: current })");
  });

  it('preserves the buy / list / cancel / collect dispatch and money formatting', () => {
    expect(painter).toContain('.marketBuy(l.id)');
    expect(painter).toContain('.marketCancel(l.id)');
    expect(painter).toContain('.marketList(view.form.itemId, qty, each * qty)');
    expect(painter).toContain('.marketCollect()');
    expect(painter).toContain('this.deps.moneyHtml(');
    expect(painter).toContain('formatLocalizedMoney(');
  });
});
