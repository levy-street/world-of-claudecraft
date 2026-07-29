import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';

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
const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

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

describe('market_window: the Collect tab sale ledger', () => {
  // The ledger is its own repaint axis: a sale whose proceeds floor to 0 copper
  // moves neither collectionCopper nor collectionItems, so a signature watching
  // only those two would leave an open Collect tab showing a stale list.
  it('watches the ledger in the refresh signature, not just the purse and the goods', () => {
    const sig = painter.slice(
      painter.indexOf('const sig = JSON.stringify(['),
      painter.indexOf('if (sig === this.lastSig) return;'),
    );
    expect(sig).toContain('info?.collectionSales');
    expect(sig).toContain('info?.collectionSalesOmitted');
  });

  it('escapes the buyer name before it reaches innerHTML', () => {
    expect(painter).toContain("esc(t('itemUi.market.saleBuyer', { buyer: buyerName }))");
  });

  it('drives the ledger rows from CSS classes the stylesheet actually defines', () => {
    for (const cls of ['mkt-sale-list', 'mkt-sale', 'mkt-sale-name', 'mkt-sale-buyer']) {
      expect(painter, `painter must use .${cls}`).toContain(cls);
      expect(componentsCss, `components.css must define .${cls}`).toContain(`.${cls}`);
    }
  });

  it('builds the rows in the pure core, leaving the painter no item resolution', () => {
    expect(core).toContain('collectionSales');
    // The painter consumes MarketCollectSaleRow; it never reaches into ITEMS itself.
    expect(painter).toContain('MarketCollectSaleRow');
    expect(painter.includes("from '../sim/data'")).toBe(false);
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

  // Issue #2189. WHICH menus each item type shows is decided in the pure core and pinned
  // behaviorally in tests/market_view.test.ts (marketFilterMenus); the rendered DOM is
  // driven in tests/browser/keyboard_nav.browser.test.ts. What is left for a source pin
  // is exactly the thing neither can see: that the painter DELEGATES instead of
  // re-deriving the gate inline, which would pass both of those suites while drifting
  // from the tested core. Comments are stripped so prose cannot satisfy a pin.
  it('delegates the per-item-type menu shape to the view core instead of re-deriving it', () => {
    const code = painter.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    expect(code).toContain('marketFilterMenus(this.itemTypeFilter)');
    expect(code).toContain('const subtypeKind = menus.subtypeKind;');
    expect(code).toMatch(
      /\(menus\.subtype\s*&&\s*subtypeKind\s*\?\s*this\.renderMarketFilterMenu\(\s*'subtype'/,
    );
    expect(code).toMatch(
      /\(menus\.armorClass\s*\?\s*this\.renderMarketFilterMenu\(\s*'armorClass'/,
    );
    expect(code).toMatch(
      /\(menus\.primaryStat\s*\?\s*this\.renderMarketFilterMenu\(\s*'primaryStat'/,
    );
    // No inline gate may survive alongside the delegation, or the core stops being the
    // single source of truth for the menu shape.
    // No inline re-derivation may survive in ANY form (ternary, ||, a hoisted const),
    // or the core stops being the single source of truth for the menu shape. The painter
    // switches on the core's subtypeKind, so it needs no item-type test of its own: the
    // one legitimate 'bag' comparison left is marketItemTypeLabel's, on its `filter`
    // argument rather than on this.itemTypeFilter.
    expect(code, 'the menu shape must not be re-derived on the painter').not.toContain(
      "this.itemTypeFilter === 'bag'",
    );
    expect(code, 'subtype wording must switch on the core discriminator').toMatch(
      /kind === 'bagCapacity'/,
    );
    // The option VALUE is escaped too. Every option used to be a source-authored literal
    // from an `as const` tuple; the bag capacities are the first derived from content, so
    // what made this interpolation safe by construction no longer holds on its own.
    expect(code).toContain('data-market-filter-option="${esc(option)}"');
    // The bag labels are i18n dispatch, which a pure core may not do, so they stay here.
    expect(code).toContain("t('itemUi.market.filterTypeBag')");
    expect(code).toContain("t('itemUi.market.filterBagSize')");
    expect(code).toContain("t('itemUi.market.filterBagAll')");
    // Capacity option labels reuse the bag tooltip template, already translated in every
    // locale, instead of minting a new per-size string.
    expect(code).toContain("t('itemUi.tooltip.bagSlots'");
  });

  // MKT_MENU_PREFERRED_HEIGHT drives the runtime open-up/clamp decision and must agree
  // with the stylesheet's static cap, or the two disagree about where a menu ends. The
  // bag capacity menu is the first new consumer of that pair since it was introduced.
  it('keeps the dropdown menu height in the painter and the stylesheet in agreement', () => {
    const preferred = painter.match(/const MKT_MENU_PREFERRED_HEIGHT = (\d+);/)?.[1];
    expect(preferred, 'MKT_MENU_PREFERRED_HEIGHT must exist').toBe('236');
    // Scoped to the .mkt-select-menu rule rather than searched across the whole sheet,
    // so the agreement is proved against the rule that actually caps this menu.
    const rule = componentsCss.match(/\.mkt-select-menu\s*\{[^}]*\}/)?.[0];
    expect(rule, '.mkt-select-menu rule must exist').toBeTruthy();
    expect(rule).toContain(`max-height: ${preferred}px`);
  });

  it('preserves the buy / list / cancel / collect dispatch and money formatting', () => {
    // Buy now lands behind the confirm prompt (the id it sends is the one the
    // prompt captured and rechecked); the behavior itself is driven end to end in
    // tests/market_buy_confirm.test.ts. Reclaim is unchanged: one click.
    expect(painter).toContain('this.promptBuy(l, itemName)');
    expect(painter).toContain('.marketBuy(pending.listingId)');
    expect(painter).toContain('.marketCancel(l.id)');
    expect(painter).toContain('.marketList(view.form.itemId, qty, each * qty)');
    expect(painter).toContain('.marketCollect()');
    expect(painter).toContain('this.deps.moneyHtml(');
    expect(painter).toContain('formatLocalizedMoney(');
  });
});

describe('market_window: stale tooltip on re-filter (#2456)', () => {
  // Typing in the search box, or picking a type/subtype/rarity filter that then narrows
  // the async listings update, drives the signature-checked refresh path
  // (refreshIfChanged -> renderContent), not the full render() rebuild. renderContent()
  // tears down and rebuilds every `.mkt-row` node (`list.innerHTML = ''`); a row removed
  // this way fires no mouseleave, so a tooltip left open on a row whose item no longer
  // matches the query would otherwise linger, still describing an item the list no
  // longer shows. render() already hides the tooltip on every full rebuild; this pins
  // the same guard on the signature-driven refresh path.
  it('hides the tooltip once the listings signature changes, before renderContent rebuilds the rows', () => {
    const method = painter.slice(
      painter.indexOf('refreshIfChanged(): void {'),
      painter.indexOf('render(): void {'),
    );
    expect(method, 'refreshIfChanged must exist').toContain('if (sig === this.lastSig) return;');
    const afterSigChange = method.slice(method.indexOf('this.lastSig = sig;'));
    const hideIdx = afterSigChange.indexOf('this.deps.hideTooltip();');
    const renderIdx = afterSigChange.indexOf('this.renderContent();');
    expect(hideIdx, 'hideTooltip() must run once the signature actually changed').toBeGreaterThan(
      -1,
    );
    expect(
      hideIdx,
      'hideTooltip() must run before renderContent() tears down the row nodes',
    ).toBeLessThan(renderIdx);
  });

  it('still guards the full render() rebuild path (tab switch, filter-menu click) the same way', () => {
    const render = painter.slice(painter.indexOf('render(): void {'));
    expect(render.indexOf('this.deps.hideTooltip();')).toBeLessThan(
      render.indexOf('this.renderContent();'),
    );
  });

  it('also guards the Browse-tab pager click, a third `.mkt-row` teardown path', () => {
    // The pager's Prev/Next button is built inside renderBrowse() and calls pushQuery()
    // then renderContent() directly: neither the full render() rebuild (which hides the
    // tooltip unconditionally at its top) nor the guarded refreshIfChanged() path covers
    // it, so it needs its own hideTooltip() before the rebuild.
    const pagerStart = painter.indexOf(
      "pager.querySelectorAll<HTMLButtonElement>('[data-market-page]').forEach((button) => {",
    );
    expect(pagerStart, 'pager click wiring must exist').toBeGreaterThan(-1);
    const pagerHandler = painter.slice(pagerStart, painter.indexOf('list.appendChild(pager);'));
    const hideIdx = pagerHandler.indexOf('this.deps.hideTooltip();');
    const renderIdx = pagerHandler.indexOf('this.renderContent();');
    expect(hideIdx, 'hideTooltip() must run in the pager click handler').toBeGreaterThan(-1);
    expect(
      hideIdx,
      'hideTooltip() must run before renderContent() tears down the row nodes',
    ).toBeLessThan(renderIdx);
  });
});

describe('market_window: reconnect resync (#2416)', () => {
  // A fresh join (the server's linkdead grace expired before the socket came back)
  // resets the session-only browse query to default; the window's own filter
  // controls live in the client and survive the drop untouched. onReconnected must
  // detect that drift off the echoed query, not blindly re-push on every reconnect
  // (an ordinary resume keeps the same session, so nothing changed to re-send).
  // onReconnected() fires synchronously inside the client's `hello` handler,
  // before the resent world's first snapshot has decoded: at that instant
  // marketInfo (if present at all) is still the pre-drop echo, which by
  // construction matches currentQuery(), so comparing right there would never
  // detect the fresh-join reset. It arms a flag instead; the drift check runs
  // later, once refreshIfChanged() actually observes a MarketInfo.
  it('is a no-op when closed, otherwise only arms the deferred resync flag', () => {
    const method = painter.slice(
      painter.indexOf('onReconnected(): void {'),
      painter.indexOf('// Runs the deferred reconnect-drift check'),
    );
    expect(method, 'onReconnected must exist').toContain('onReconnected(): void {');
    expect(method).toContain('if (!this.opened) return;');
    expect(method).toContain('this.pendingReconnectResync = true;');
    expect(method, 'must not compare against a possibly-stale echo inline').not.toContain(
      'queryDiffersFromEcho',
    );
  });

  it('resolvePendingReconnectResync compares both filter axes and the settled search box, and re-pushes only on real drift', () => {
    const method = painter.slice(
      painter.indexOf('private resolvePendingReconnectResync'),
      painter.indexOf('refreshIfChanged(): void {'),
    );
    expect(method, 'resolvePendingReconnectResync must exist').toContain(
      'resolvePendingReconnectResync',
    );
    expect(method).toContain('if (!this.pendingReconnectResync || !info) return;');
    expect(method).toContain('this.pendingReconnectResync = false;');
    expect(method).toContain('queryDiffersFromEcho(query, info)');
    expect(method).toContain('searchDiffersFromEcho(query, info)');
    expect(method).toContain('this.pushQuery();');
  });

  it('refreshIfChanged resolves the pending resync even on the Sell tab (before the sell-tab early return)', () => {
    const method = painter.slice(
      painter.indexOf('refreshIfChanged(): void {'),
      painter.indexOf('render(): void {'),
    );
    const resolveIdx = method.indexOf('this.resolvePendingReconnectResync(info);');
    const sellReturnIdx = method.indexOf("if (this.tab === 'sell') return;");
    expect(resolveIdx, 'must call resolvePendingReconnectResync').toBeGreaterThan(-1);
    expect(
      sellReturnIdx,
      'must still early-return before the browse/collect signature work',
    ).toBeGreaterThan(-1);
    expect(resolveIdx).toBeLessThan(sellReturnIdx);
  });

  it('imports queryDiffersFromEcho and searchDiffersFromEcho from the world_api seam (the pure drift checks, not re-derived comparisons)', () => {
    expect(painter).toContain(
      "import {\n  type IWorld,\n  type MarketInfo,\n  type MarketListingView,\n  queryDiffersFromEcho,\n  searchDiffersFromEcho,\n} from '../world_api';",
    );
  });

  it('wires the window through a hud.ts method, chained onto the ClientWorld reconnect hook in main.ts', () => {
    const method = hud.slice(
      hud.indexOf('marketResyncAfterReconnect(): void {'),
      hud.indexOf('marketResyncAfterReconnect(): void {') + 200,
    );
    expect(method, 'Hud.marketResyncAfterReconnect must exist').toContain(
      'this.marketWindow.onReconnected();',
    );
    // hud does not exist yet when enterWorld() first arms world.onReconnected (the
    // reconnect-overlay teardown), so startGame chains its own handler onto
    // whatever enterWorld already set, once hud is actually constructed, instead
    // of replacing it.
    const chain = mainSrc.slice(
      mainSrc.indexOf('const priorOnReconnected = online.onReconnected;'),
      mainSrc.indexOf('const priorOnReconnected = online.onReconnected;') + 600,
    );
    expect(chain, 'main.ts must chain onto the prior handler, not replace it').toContain(
      'priorOnReconnected?.();',
    );
    expect(chain, 'main.ts must call the hud resync hook on reconnect').toContain(
      'hud.marketResyncAfterReconnect();',
    );
  });
});

// Bug found in review of #2723: onReconnected() fires from inside the client's
// `hello` handler BEFORE `this.connected` flips true, so a command sent from an
// onReconnected callback (main.ts used to re-push stopAutoAttackOnTargetSwitch
// there) is silently dropped by canSendCommand(). ClientWorld now owns the
// re-push itself: it remembers the last value passed to
// setStopAutoAttackOnTargetSwitch and replays it once sends can genuinely reach
// the socket again, both after a reconnect `hello` and after spectate ends
// (cmd() drops every non-chat command while spectating too). This is a
// BEHAVIORAL pin, not a grep over main.ts: it drives onMessage with a real
// reconnect `hello` frame against a stub socket and asserts the command frame
// actually lands.
describe('ClientWorld: reconnect re-push of session preferences (#2723 review)', () => {
  function bareClientWithSocket(): { client: any; sent: Array<Record<string, unknown>> } {
    const client: any = Object.create(ClientWorld.prototype);
    client.cfg = { seed: 1, playerClass: 'warrior' };
    client.entities = new Map();
    client.playerId = 1;
    client.ownPlayerId = 1;
    client.ownPlayerClass = 'warrior';
    client.spectating = null;
    client.spectateFacingPending = false;
    client.pendingSpectateFacing = null;
    client.pendingTargetEcho = null;
    client.pendingInputSeqSentAt = new Map();
    client.inputEchoSamples = [];
    client.missingSince = new Map();
    client.marketInfo = null;
    client.profanityWords = [];
    client.profanityDirty = false;
    client.moveInput = {};
    client.mouselookFacing = null;
    client.onReconnected = null;
    const sent: Array<Record<string, unknown>> = [];
    client.ws = { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) };
    return { client, sent };
  }

  it('re-sends the last stopAutoAttackOnTargetSwitch value once a reconnect hello lands, not before', () => {
    const oldWebSocket = (globalThis as any).WebSocket;
    (globalThis as any).WebSocket = { OPEN: 1 };
    try {
      const { client, sent } = bareClientWithSocket();
      client.connected = true;
      client.setStopAutoAttackOnTargetSwitch(true);
      expect(sent, 'the initial toggle sends normally while connected').toContainEqual({
        t: 'cmd',
        cmd: 'stopAutoAttackOnTargetSwitch',
        enabled: true,
      });
      sent.length = 0;

      // The socket drops and a reconnect is under way: connected is false, so
      // canSendCommand() would reject anything sent right now.
      client.connected = false;
      client.reconnectAttempts = 3;
      client.conflictRejections = 0;
      client.timeoutRejections = 0;
      client.inputSeq = 0;
      client.lastInputSig = '';
      client.lastInputSentAt = 0;
      client.ackedInputSeq = 0;
      client.lastSnapAt = 0;

      (client as any).onMessage(
        JSON.stringify({ t: 'hello', pid: 1, seed: 1, realm: 'Claudemoon' }),
      );

      expect(
        sent,
        'the reconnect hello must re-push the preference now that sends actually reach the socket',
      ).toContainEqual({ t: 'cmd', cmd: 'stopAutoAttackOnTargetSwitch', enabled: true });
    } finally {
      (globalThis as any).WebSocket = oldWebSocket;
    }
  });

  it('does not send anything on a plain (non-reconnect) hello when the preference was never set', () => {
    const oldWebSocket = (globalThis as any).WebSocket;
    (globalThis as any).WebSocket = { OPEN: 1 };
    try {
      const { client, sent } = bareClientWithSocket();
      client.connected = false;
      client.reconnectAttempts = 0;

      (client as any).onMessage(
        JSON.stringify({ t: 'hello', pid: 1, seed: 1, realm: 'Claudemoon' }),
      );

      expect(sent).toEqual([]);
    } finally {
      (globalThis as any).WebSocket = oldWebSocket;
    }
  });
});
