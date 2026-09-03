import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STORAGE_SKUS } from '../src/sim/content/storage_charters';

// Strip comments so a pin can never be satisfied by prose. Every assertion in
// this file is a source scan, so a commented-out copy of a load-bearing line
// (or a comment that merely NAMES a token) would otherwise read as the code
// itself: `// const result = await hooks.spend(a, b, c, key);` satisfies a bare
// toContain while every retry mints a fresh key at runtime.
//
// This walks the source rather than running two regexes, because both naive
// orders are wrong on real files here: stripping `//` first eats the tail of any
// line holding an `https://` string literal, and stripping blocks first leaves a
// `/*` inside a line comment able to swallow real code after it. Tracking string
// state (', ", `, with escapes) makes both cases correct, and it is the same
// pass for CSS, which only has the block form.
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (quote !== null) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

// EVERY source read in this file is comment-stripped, so no pin here can be
// gamed by prose. Read raw only when a pin is deliberately about a comment.
function readSource(path: string): string {
  return stripComments(
    readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n?/g, '\n'),
  );
}

/** indexOf that REFUSES to return -1. A lost anchor otherwise silently turns a
 *  slice into '' (every negative assertion passes vacuously) or into the whole
 *  rest of the file (every containment goes proximity-blind). */
function anchor(source: string, needle: string, from = 0): number {
  const at = source.indexOf(needle, from);
  expect(at, `anchor not found, the pin below is vacuous: ${needle}`).toBeGreaterThan(-1);
  return at;
}

const storeWindow = readSource('../src/ui/daily_rewards_window.ts');
const charterCardView = readSource('../src/ui/charter_card_view.ts');
// The armory's markup twin, split out of the window in Bank Storage phase 15.
// Three pins below moved with it; each says so where it reads.
const armoryCardView = readSource('../src/ui/armory_card_view.ts');
// The focus decision and its DOM ladder, split out of the window in Phase 15 QA
// so the background exemption and the degrade rule could be unit-tested. The
// pins that used to read the window's own restoreStoreFocus read this instead,
// and the window keeps a NEGATIVE pin so the seam cannot quietly move back.
const storeFocusPolicy = readSource('../src/ui/store_focus_policy.ts');
const storeDecisionPrompt = readSource('../src/ui/store_decision_prompt.ts');
const storeSurfaceRuntime = readSource('../src/ui/store_surface_runtime.ts');
const storeArmoryPurchase = readSource('../src/ui/store_armory_purchase.ts');
const storeSpendControllers = readSource('../src/ui/store_spend_controllers.ts');
const dailyRewardsChrome = readSource('../src/ui/daily_rewards_chrome_view.ts');
const claudiumWindow = readSource('../src/ui/claudium_window.ts');
const hud = readSource('../src/ui/hud.ts');
// The Claudium spend seam moved OUT of the hud deps literal in Bank Storage
// phase 13 (a second window now spends), so the pins that used to hunt those
// closures in hud.ts follow them here. The BEHAVIOUR they describe is now
// executed in tests/claudium_purchase_bridge.test.ts, which is the executed
// test state.md ruling 20 asked for and could not have while both halves were
// closures inside files at their monolith ceilings.
const bridge = readSource('../src/ui/claudium_purchase_bridge.ts');
const main = readSource('../src/main.ts');
const inspect = readSource('../src/ui/armory_inspect.ts');
const componentsCss = readSource('../src/styles/components.css');
const mobileCss = readSource('../src/styles/hud.mobile.css');
const hudChromeCatalog = readSource('../src/ui/i18n.catalog/hud_chrome.ts');

describe('WOC Store window contract', () => {
  it('opens on the Store tab and keeps Daily Rewards as a sub-tab', () => {
    expect(storeWindow).toContain("private tab: 'store' | 'rewards' = 'store'");
    expect(dailyRewardsChrome).toContain('data-woc-store-tab="store"');
    expect(dailyRewardsChrome).toContain('data-woc-store-tab="rewards"');
  });

  it('offers a Claudium top-up when the selected skin is unaffordable', () => {
    const purchase = storeArmoryPurchase.slice(
      anchor(storeArmoryPurchase, '  request(row: ArmorySkinRow): void {'),
      anchor(storeArmoryPurchase, '  async purchase('),
    );
    expect(purchase).toContain('if (!row.affordable)');
    expect(purchase).toContain('this.deps.showNeedMore(');
    expect(storeSurfaceRuntime).toContain("title: t('hudChrome.wocStore.needMoreTitle')");
    expect(storeWindow).toContain('onConfirm: () => this.openClaudiumFromStore()');
  });

  it('uses the authoritative insufficient-balance response for the top-up flow', () => {
    const purchase = storeArmoryPurchase.slice(anchor(storeArmoryPurchase, '  async purchase('));
    expect(purchase).toContain("result?.reason === 'insufficient_balance'");
    expect(purchase).toContain('result.costClaudium');
    expect(purchase).toContain('result.balance');
    expect(purchase).toContain('this.deps.showNeedMore(');
    expect(purchase).toContain('this.deps.needMoreText(');
    expect(purchase).toContain('this.deps.surfaceIsCurrent(generation)');
    expect(main).toContain('costClaudium: result.costClaudium');
    expect(main).toContain('reason: result.reason');
  });

  it('marks owned skins and prevents another purchase attempt', () => {
    // The MARK is markup and lives in the extracted core; the REFUSAL is flow
    // and lives in the purchase controller. Both halves are pinned where their
    // respective modules own them, so moving one without the other reds here.
    expect(armoryCardView).toContain('armory-state');
    // The negative half its two neighbours already carry: a PARTIAL move that
    // duplicated the markup back into the window would not red without it.
    expect(storeWindow).not.toContain('armory-state');
    const request = storeArmoryPurchase.slice(
      anchor(storeArmoryPurchase, '  request(row: ArmorySkinRow): void {'),
      anchor(storeArmoryPurchase, '  async purchase('),
    );
    expect(request).toContain('row.owned');
    expect(request).toContain('!row.purchasable');
    expect(request).toContain('row.costClaudium === null');
    expect(request).toContain('this.inFlight.has(row.skin.id)');
  });

  it('sells only the Season 1 Armory (no legacy cosmetics grid)', () => {
    expect(storeWindow).not.toContain('woc-store-grid');
    expect(storeWindow).not.toContain('storeCardHtml');
    expect(storeWindow).not.toContain('buildWocStoreRows');
  });

  it('uses a denser cosmetic grid on wide desktop layouts only', () => {
    const baseGrid = componentsCss.match(/\.armory-grid \{([^}]*)\}/);
    const desktopGrid = componentsCss.match(
      /@media \(min-width: 900px\) \{\s*body:not\(\.mobile-touch\) \.armory-grid \{([^}]*)\}/,
    );
    const mobileGrid = mobileCss.match(/body\.mobile-touch \.armory-grid \{([^}]*)\}/);
    const mobileLandscape = mobileCss.slice(mobileCss.indexOf('@media (orientation: landscape)'));
    expect(baseGrid?.[1]).toContain('grid-template-columns: repeat(4, minmax(0, 1fr));');
    expect(desktopGrid).not.toBeNull();
    expect(desktopGrid?.[1]).toContain('grid-template-columns: repeat(5, minmax(0, 1fr));');
    expect(mobileGrid?.[1]).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(mobileLandscape).toContain(
      'grid-template-columns: repeat(auto-fit, minmax(104px, 1fr));',
    );
  });

  it('implements roving keyboard tabs with explicit tabpanel ownership', () => {
    expect(storeWindow).toContain("rovingTarget(ke.key, i, tabs.length, 'horizontal')");
    expect(dailyRewardsChrome).toContain('aria-controls="woc-store-panel"');
    expect(dailyRewardsChrome).toContain('role="tabpanel"');
    expect(storeWindow).toContain("panel?.setAttribute(\n      'aria-labelledby'");
  });

  it('keeps Escape scoped to the top Armory inspector and exposes toggle state', () => {
    expect(inspect).toMatch(/event\.key === 'Escape'[\s\S]{0,180}event\.preventDefault\(\)/);
    expect(inspect).toMatch(/event\.key === 'Escape'[\s\S]{0,220}event\.stopPropagation\(\)/);
    expect(inspect).toContain("button.setAttribute('aria-pressed'");
  });

  it('keeps scrollable inspect details separate from the fixed action row', () => {
    const panelMarkup = inspect.slice(
      inspect.indexOf('`<div class="armory-inspect-panel">`'),
      inspect.indexOf('document.body.appendChild(overlay)'),
    );
    expect(panelMarkup).toContain('`<div class="armory-inspect-details">`');
    expect(panelMarkup).toMatch(
      /armory-lore[^`]*<\/div>` \+\s*`<\/div>` \+\s*`<div class="armory-inspect-actions"/,
    );
  });

  it('hydrates repeated class portraits without embedding their data URLs in store markup', () => {
    // The deferral is a property of the MARKUP (the extracted core) and the
    // hydration is a DOM step (the window), which is exactly the line the split
    // was drawn on: portrait_chip's markup half moved, its DOM half did not.
    expect(armoryCardView).toContain('deferSource: true');
    expect(armoryCardView).toContain('decoding="async"');
    expect(storeWindow).toContain('hydratePortraits(body)');
    expect(storeWindow).not.toContain('deferSource: true');
  });

  it('keeps the Claudium window focused on currency purchases', () => {
    expect(claudiumWindow).not.toContain('private storeHtml(');
    expect(claudiumWindow).not.toContain('data-item=');
    expect(claudiumWindow).toContain('cl-pack-art');
    expect(claudiumWindow).toContain('/claudium/icons/stack_');
  });

  it('keeps Claudium packs mounted while their snapshot refreshes', () => {
    const render = claudiumWindow.slice(
      claudiumWindow.indexOf('async render('),
      claudiumWindow.indexOf('private ensureShell'),
    );
    expect(render).toContain('this.syncRefreshing(true);');
    expect(render).toContain('if (!this.hasRenderedSnapshot) this.paintLoading();');
    expect(render).toContain('snapshot.available === false) && this.currentView');
    expect(render).toContain("this.announce(t('hudChrome.claudium.unavailable'))");
    expect(claudiumWindow).toContain('data-refresh-status');
    expect(claudiumWindow).toContain('data-cl-live-status');
    expect(claudiumWindow).toContain("querySelector<HTMLElement>('.cl-body')");
    expect(claudiumWindow).toContain("setAttribute('aria-busy', refreshing ? 'true' : 'false')");
    expect(claudiumWindow).toContain("querySelectorAll<HTMLButtonElement>('[data-sku]')");
    const refreshSync = claudiumWindow.slice(
      claudiumWindow.indexOf('private syncRefreshing('),
      claudiumWindow.indexOf('private announce('),
    );
    expect(refreshSync).not.toContain('[data-rail]');
    expect(claudiumWindow).toContain('cl-sku-buy-spinner');
    expect(claudiumWindow).toContain('this.syncPendingPurchase(body, rail, sku);');
    expect(claudiumWindow).toContain(
      'const refreshFocus = restoreTarget ?? this.captureBodyFocus();',
    );
    expect(claudiumWindow).toContain(
      "const purchaseFocus = this.captureBodyFocus() ?? { kind: 'sku', value: sku };",
    );
    expect(claudiumWindow).toContain('void this.render(null, purchaseFocus);');
    expect(claudiumWindow).toContain('this.restoreBodyFocus(focused);');
    expect(claudiumWindow).toContain('this.paint(this.currentView ?? view);');
  });

  it('keeps refresh-disabled Claudium packs visually stable', () => {
    expect(componentsCss).toContain(
      '.cl-body[aria-busy="true"] .cl-sku:disabled {\n    opacity: 1;',
    );
  });

  it('keeps stacked opaque store windows out of the backdrop blur compositor', () => {
    const rule = componentsCss.match(
      /body\.frosted-panels #daily-rewards-window,\s*body\.frosted-panels #claudium-window \{([^}]*)\}/,
    );
    expect(rule).not.toBeNull();
    expect(rule?.[1]).toMatch(/(?:^|\n)\s+-webkit-backdrop-filter: none;/);
    expect(rule?.[1]).toMatch(/(?:^|\n)\s+backdrop-filter: none;/);
  });

  it('isolates stacked store paint and pauses decorative raster work during window drag', () => {
    const containment = componentsCss.match(
      /#daily-rewards-window,\s*#claudium-window \{([^}]*)\}/,
    );
    expect(containment).not.toBeNull();
    expect(containment?.[1]).toContain('contain: paint;');
    expect(containment?.[1]).toContain('isolation: isolate;');
    const stackSync = hud.slice(
      hud.indexOf("const storeWindow = document.getElementById('daily-rewards-window')"),
      hud.indexOf("document.body.classList.toggle(\n      'mobile-map-quest-open'"),
    );
    expect(stackSync).toContain('stackedWindowsVisible(');
    expect(stackSync).toContain('!!storeWindow && this.isWindowVisible(storeWindow)');
    expect(stackSync).toContain('!!claudiumWindow && this.isWindowVisible(claudiumWindow)');
    expect(stackSync).toContain("document.body.classList.toggle('store-stack-open'");
    expect(stackSync).toContain('recordStoreStackSample(');
    expect(hud).toContain('isWindowDragPreviewMutation(m.attributeName, m.target)');
    const dailyRewardsDeps = hud.slice(
      hud.indexOf('private readonly dailyRewardsWindow = new DailyRewardsWindow({'),
      hud.indexOf('// Claudium (server-authoritative soft currency) window.'),
    );
    expect(dailyRewardsDeps).toContain("root: () => $('#daily-rewards-window')");
    expect(dailyRewardsDeps).toContain('onVisibilityChange: () => this.syncAnyWindowOpenState()');
    const claudiumDeps = hud.slice(
      hud.indexOf('private readonly claudiumWindow = new ClaudiumWindow({'),
      hud.indexOf('// Spellbook window painter'),
    );
    expect(claudiumDeps).toContain("root: () => $('#claudium-window')");
    expect(claudiumDeps).toContain('walletState: () => walletConnectionView()');
    expect(claudiumDeps).toContain('onVisibilityChange: () => this.syncAnyWindowOpenState()');
    const walletUiSubscription = hud.slice(
      hud.indexOf('onWalletUiChange(() => {'),
      hud.indexOf("$('#pf-name').textContent"),
    );
    expect(walletUiSubscription).toContain('this.claudiumWindow.onWalletChanged();');
    expect(walletUiSubscription).toContain('this.wocMarketWindow.onWalletChanged();');
    // No conditional GPU promotion on the store windows: the old
    // body.store-stack-open will-change rule dropped the promotion in the same
    // frame a window's inline display flipped, racing Chromium's layer
    // teardown. A promoted layer stranded by that race composites as an opaque
    // near-black rectangle over the play area (the intermittent black-window
    // report). contain: paint + isolation: isolate above stay; promotion must
    // not come back conditionally or permanently.
    expect(componentsCss).not.toMatch(/store-stack-open[^{}]*\{[^}]*will-change/);
    expect(componentsCss).not.toMatch(/#(?:daily-rewards|claudium)-window[^{}]*\{[^}]*will-change/);
    expect(componentsCss).toContain(
      'body.window-drag-active .armory-section.rarity-legendary .armory-card',
    );
    expect(componentsCss).toContain('animation-play-state: paused;');
  });

  it('shows a visible loading state in the store body until the first snapshot paints', () => {
    // An opaque store shell awaiting an un-timed snapshot fetch must read as
    // "loading", never as a bare black box (the fallback black-window lead).
    const loading = dailyRewardsChrome.slice(
      anchor(dailyRewardsChrome, 'export function dailyRewardsLoadingHtml('),
    );
    expect(loading).toContain('cl-loading');
    expect(loading).toContain('cl-spinner');
    expect(loading).toContain("t('hudChrome.wocStore.loading')");
    expect(loading).toContain("t('hudChrome.dailyRewards.loading')");
  });

  it('routes the Escape close of both store windows through their painters', () => {
    const dailyCase = hud.slice(hud.indexOf("case 'daily-rewards-window':"));
    expect(dailyCase.slice(0, 300)).toContain('this.dailyRewardsWindow.close();');
    const claudiumCase = hud.slice(hud.indexOf("case 'claudium-window':"));
    expect(claudiumCase.slice(0, 300)).toContain('this.claudiumWindow.close();');
  });

  it('keeps storefront content mounted while a background refresh is loading', () => {
    expect(dailyRewardsChrome).toContain('data-woc-store-loading');
    expect(storeSurfaceRuntime).toContain(
      "indicator.setAttribute('aria-busy', loading ? 'true' : 'false')",
    );
    expect(storeWindow).not.toContain('if (this.storeLoading) {\n      body.innerHTML');
    expect(storeWindow).toContain('if (!snapshot.available || snapshot.balance === null)');
    expect(storeWindow).toContain('this.storeError = !this.storeReady;');
  });

  it('keeps the store and Claudium out of native builds while gating Daily Rewards by wallet capability', () => {
    expect(main).toContain('dailyRewardsEnabled: NATIVE_APP ? await walletCapabilityReady : true');
    expect(main).toContain('devCommandsEnabled: import.meta.env.DEV');
    const economyWiring = main.slice(
      anchor(main, 'if (!NATIVE_APP) {', anchor(main, 'const claudiumHooks')),
      anchor(main, 'function interactKey'),
    );
    expect(economyWiring).toContain('hud.attachClaudium(claudiumHooks);');
    expect(economyWiring).toContain('shouldShowStorePromo({');
    expect(economyWiring).toContain('nativeApp: NATIVE_APP');
    expect(economyWiring).toContain('desktopApp: DESKTOP_APP');
    expect(economyWiring).toContain(
      "mobileTouch: document.body.classList.contains('mobile-touch')",
    );
    expect(economyWiring).toContain('hud.attachStorePromoCard();');
    expect(hud).toContain("returnFocusTo: () => document.getElementById('daily-rewards-button')");
    // The enabled answer is one expression in the shared bridge, and hud.ts
    // supplies the hooks reference it reads. Both halves pinned: dropping
    // either one would leave a store that is enabled on a native build.
    expect(bridge).toContain('storeEnabled: () => host.hooks() !== null');
    expect(hud).toContain('hooks: () => this.claudiumHooks');
    expect(hud).toContain(
      'private dailyRewardsEnabled(): boolean {\n    return this.features.dailyRewardsEnabled;',
    );
    expect(hud).toContain(
      'toggleDailyRewards(): void {\n    if (!this.dailyRewardsEnabled()) return;',
    );
    expect(hud).toContain("dailyRewardsButton?.setAttribute('hidden', '');");
    expect(hud).toContain("mobileDailyRewardsButton?.setAttribute('hidden', '');");
    expect(hud).toContain('if (!this.claudiumHooks) return;');
    expect(hud).toContain("? 'hudChrome.wocStore.title'");
    expect(hud).toContain(": 'hudChrome.dailyRewards.title';");
    expect(hud).toContain('this.syncDailyRewardsSurfaceLabels();');
    expect(storeWindow).toContain("if (!this.storeEnabled()) this.tab = 'rewards';");
    expect(storeWindow).toContain("(storeEnabled ? wocStoreTabsHtml() : '')");
    expect(storeWindow).toContain('dailyRewardsLoadingHtml(storeEnabled)');
  });

  it('refreshes only store balance and catalog while the WOC Store is open', () => {
    const storeWiring = hud.slice(hud.indexOf('storeSnapshot: async () =>'));
    expect(storeWiring.slice(0, storeWiring.indexOf('spendStoreItem:'))).toContain(
      'this.claudiumHooks?.storeSnapshot()',
    );

    const hook = main.slice(main.indexOf('storeSnapshot: async () =>'));
    const storeSnapshot = hook.slice(0, hook.indexOf('snapshot: async () =>'));
    expect(storeSnapshot).toContain('economy.storeSnapshot()');
    expect(storeSnapshot).not.toContain('economy.skus()');
    expect(storeSnapshot).not.toContain("economy.price('woc')");
    expect(storeSnapshot).not.toContain('economy.nativePrice(');
  });

  it('distinguishes a complete Claudium pack refresh from typed economy fallbacks', () => {
    const hook = main.slice(main.indexOf('snapshot: async () =>'));
    const snapshot = hook.slice(0, hook.indexOf('buy: async'));
    expect(snapshot).toContain('economy.packSnapshot()');
    expect(snapshot).toContain('if (!pack.available)');
    expect(snapshot).toContain('available: false');
    expect(snapshot).toContain('available: true');
  });
  it('gates the Strongbox charter category on NATIVE_APP exactly like the rest of the store', () => {
    // One gate, not two. The charter category is painted by the store body, the
    // store body exists only when the HUD holds Claudium hooks, and main.ts
    // attaches those hooks in exactly ONE place: inside the non-native block. A
    // native build therefore has no store window and no charter row, with
    // nothing charter-specific to keep in step.
    expect(main.match(/hud\.attachClaudium\(/g)).toHaveLength(1);
    const economyWiring = main.slice(
      anchor(main, 'if (!NATIVE_APP) {', anchor(main, 'const claudiumHooks')),
      anchor(main, 'function interactKey'),
    );
    expect(economyWiring).toContain('hud.attachClaudium(claudiumHooks);');
    expect(bridge).toContain('storeEnabled: () => host.hooks() !== null');
    expect(hud).toContain('hooks: () => this.claudiumHooks');
    // The charter markup has exactly one emitter, and it is inside paintStore
    // (the store-tab painter), never the rewards paint.
    const paintStore = storeWindow.slice(
      anchor(storeWindow, 'private paintStore('),
      anchor(storeWindow, 'private replaceStoreBody('),
    );
    expect(paintStore).toContain('this.rebuildCharterSection();');
    expect(paintStore).toContain('charterSectionHtml(this.charterSection, this.charterInFlight)');
    // Exactly one emitter, and it is that call: a second one, or one reached
    // from the rewards paint, would put a real-money category somewhere the
    // store gate does not cover.
    expect(storeWindow.match(/charterSectionHtml\(/g)).toHaveLength(1);
    expect(storeWindow).toContain("} from './charter_card_view';");
    const rewardsPaint = storeWindow.slice(
      anchor(storeWindow, 'private paint(view: DailyRewardsView)'),
      anchor(storeWindow, 'private async spin('),
    );
    expect(rewardsPaint).not.toContain('charter');
  });

  it('keeps the banker ladder rungs out of the store catalog', () => {
    // The twelve strongbox_rung_* SKUs are the BANKER's next-rung surface. The
    // store list is the registry minus everything carrying a ladderIndex, so a
    // rung can never become a card.
    expect(storeWindow).toContain('(sku) => sku.ladderIndex === undefined');
    const storeCharters = Object.values(STORAGE_SKUS)
      .filter((sku) => sku.ladderIndex === undefined)
      .map((sku) => sku.id);
    expect(storeCharters).toEqual([
      'strongbox_charter_1',
      'strongbox_charter_2',
      'strongbox_charter_3',
      'strongbox_charter_complete',
    ]);
    // Every rung really does carry the index that excludes it (a rung that lost
    // its ladderIndex would silently become a store row).
    const rungs = Object.values(STORAGE_SKUS).filter((sku) => sku.id.startsWith('strongbox_rung_'));
    expect(rungs).toHaveLength(12);
    expect(rungs.every((sku) => typeof sku.ladderIndex === 'number')).toBe(true);
    // No rung id is ever written as a string literal in the painter or its copy
    // (the painter's prose names the family; only a literal could become a row).
    expect(storeWindow).not.toMatch(/['"`]strongbox_rung/);
    expect(hudChromeCatalog).not.toMatch(/['"`]?strongbox_rung/);
  });

  it('reuses the Phase 08 economy disclaimer and mints no second disclaimer string', () => {
    expect(charterCardView).toContain("t('hudChrome.bank.priceDisclaimer')");
    // Exactly one English disclaimer value in the whole HUD-chrome catalog, and
    // none of it duplicated into the wocStore namespace.
    expect(hudChromeCatalog.match(/'Prices may change with the game economy\.'/g)).toHaveLength(1);
    const wocStore = hudChromeCatalog.slice(
      anchor(hudChromeCatalog, '  wocStore: {'),
      anchor(hudChromeCatalog, '  claudium: {'),
    );
    expect(wocStore).not.toContain('Prices may change');
    expect(wocStore).not.toMatch(/disclaimer/i);
    // No gold-to-Claudium rate, equivalence, or "cheaper than gold" comparison.
    expect(wocStore).not.toMatch(/cheaper|equivalent|exchange rate|worth of gold|per gold/i);
    // The scope line says bank, scopes to this character, and never says vault.
    expect(wocStore).toContain(
      'A charter expands the bank of this character only. The bursar sells the same slots for gold.',
    );
    expect(storeWindow).not.toMatch(/vault/i);
  });

  it('scopes charter copy to the bank of THIS character, never a vault or a gold rate', () => {
    const charterCopy = hudChromeCatalog.slice(
      anchor(hudChromeCatalog, '    charter: {'),
      anchor(hudChromeCatalog, '  claudium: {'),
    );
    expect(charterCopy).toContain('names: {');
    const scope = charterCopy.match(/scope:\s*\n?\s*'([^']*)'/)?.[1];
    expect(scope).toBe(
      'A charter expands the bank of this character only. The bursar sells the same slots for gold.',
    );
    expect(scope).toMatch(/\bbank\b/);
    expect(scope).not.toMatch(/vault/i);
    expect(scope).toMatch(/this character/);
    // The Materials Vault has no Claudium path, so the word must never appear in
    // charter copy or charter code; and no gold-to-Claudium rate, equivalence, or
    // "cheaper than gold" comparison anywhere in the category's copy, names included.
    expect(charterCopy).not.toMatch(/vault/i);
    expect(charterCopy).not.toMatch(
      /cheaper|equivalent|exchange rate|worth of gold|per gold|\d+\s*gold/i,
    );
    expect(storeWindow).not.toMatch(/vault/i);
    // The five non-Latin M16 fills carry the same two constraints.
    for (const lang of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU']) {
      const overlay = readSource(`../src/ui/i18n.locales/${lang}.ts`);
      const rows = overlay
        .split('\n')
        .filter((line) => line.includes("'hudChrome.wocStore.charter."));
      expect(rows.length).toBeGreaterThanOrEqual(21);
      expect(rows.join('\n')).not.toMatch(/vault/i);
    }
  });

  it('leaves the key lifecycle to the ledger and never re-classifies a refusal', () => {
    // purchase_in_progress and no_live_character READ like clean refusals but are
    // returned before the pending row for this key is read, so they must RETAIN
    // the key. The window must not carry a second classifier that drifts from
    // store_purchase_intent.ts: it passes every authoritative result through.
    const purchase = storeWindow.slice(
      anchor(storeWindow, 'private async purchaseCharter('),
      anchor(storeWindow, 'private async refuseCharterPurchase('),
    );
    expect(purchase).toContain(
      'this.charterIntents.settle(itemId, { granted: result.granted, reason: result.reason });',
    );
    expect(purchase).not.toContain('DEFINITIVE');
    expect(purchase).not.toContain('purchase_in_progress');
    expect(purchase).not.toContain('no_live_character');
    // The refusal COPY table may name those tokens; it must not consult or
    // second-guess the ledger from there. It lives in the extracted pure core
    // now, which is the stronger arrangement: a module that imports neither the
    // ledger nor the window CANNOT grow a second classifier.
    expect(storeWindow).not.toContain('function charterRefusalText(');
    expect(charterCardView).not.toContain('store_purchase_intent');
    const copyTable = charterCardView.slice(
      anchor(charterCardView, 'export function charterRefusalText('),
      anchor(charterCardView, 'export function charterCardHtml('),
    );
    expect(copyTable).toContain("case 'purchase_in_progress':");
    expect(copyTable).toContain("case 'no_live_character':");
    expect(copyTable).not.toContain('charterIntents');
    expect(copyTable).not.toContain('DEFINITIVE_SPEND_REFUSALS');
  });

  it('sends the FROZEN intent cost on the wire, never a re-read catalog price', () => {
    // server/storage_purchases.ts checks the prior row's four-field identity
    // (account, character, item, expectedCostClaudium) and answers a mismatch
    // with refusal('already_granted') BEFORE it tests prior.status, so it fires
    // on a still-PENDING row too. A retry carrying a refreshed price would
    // therefore look definitive, close the intent, and let the next click mint
    // a second key over a live debit.
    const purchase = storeWindow.slice(
      anchor(storeWindow, 'private async purchaseCharter('),
      anchor(storeWindow, 'private async refuseCharterPurchase('),
    );
    // Minted at REQUEST time, before the confirm dialog, so the number the
    // player confirms is the number that goes on the wire.
    const request = storeWindow.slice(
      anchor(storeWindow, 'private requestCharterPurchase('),
      anchor(storeWindow, 'private abandonCharterIntent('),
    );
    expect(request).toContain('this.charterIntents.intentFor(itemId, row.costClaudium)');
    expect(request).toContain(
      'cost: formatNumber(intent.costClaudium, { maximumFractionDigits: 0 }),',
    );
    // The row's refreshed price must not reach the confirmation body.
    expect(request).not.toContain('cost: formatNumber(row.costClaudium');
    expect(purchase).toContain('this.charterIntents.intentFor(itemId, row?.costClaudium ?? 0)');
    // The wire cost and the key BOTH come off the intent, and the caller's
    // expectedCostClaudium reaches the wire nowhere.
    const wire = purchase.slice(
      anchor(purchase, 'this.deps.spendStoreItem?.('),
      anchor(purchase, 'if (!result) {'),
    );
    // The exact argument list: the frozen cost and the intent's key, in that
    // order, and the caller's re-read price nowhere in the call.
    expect(wire).toContain("(itemId, 'storage', intent.costClaudium, intent.key)");
    expect(wire).not.toContain('expectedCostClaudium');
    // The refusal handler judges against what was SENT, not the caller's value.
    expect(purchase).toContain(
      'this.refuseCharterPurchase(itemId, intent.costClaudium, result, surfaceGeneration)',
    );
    const refuse = storeWindow.slice(
      anchor(storeWindow, 'private async refuseCharterPurchase('),
      anchor(storeWindow, 'private repaintStore('),
    );
    expect(refuse).toContain('sentCostClaudium');
    expect(refuse).not.toContain('expectedCostClaudium');
  });

  it('holds ONE idempotency key per charter purchase intent and none on the skin path', () => {
    // The money bug: a repeatable storage SKU dedupes only on the client key, so
    // a retry under a fresh key is a second real charge. Every source here is
    // comment-stripped (see readSource), and each load-bearing line is pinned by
    // OCCURRENCE COUNT so a commented-out or duplicated copy cannot satisfy it.
    expect(main.match(/idempotencyKey: idempotencyKey \?\? newIdempotencyKey\(\)/g)).toHaveLength(
      1,
    );
    expect(main.match(/idempotencyKey: newIdempotencyKey\(\)/g)).toBeNull();
    // The shared bridge must FORWARD the 4th argument. Dropping it type-checks
    // (the parameter is optional) and silently mints a fresh key per retry, so
    // pin the parameter in the signature AND its use at the call, both exactly
    // once. tests/claudium_purchase_bridge.test.ts proves the same claim by
    // EXECUTION; these stay because occurrence-bounded source pins also catch a
    // duplicated second spend path an executed test would never visit.
    expect(
      bridge.match(
        /spendStoreItem: async \(itemId, kind, expectedCostClaudium, idempotencyKey\) => \{/g,
      ),
    ).toHaveLength(1);
    expect(
      bridge.match(/\.spend\(itemId, kind, expectedCostClaudium, idempotencyKey\)/g),
    ).toHaveLength(1);
    expect(bridge.match(/\.spend\(/g)).toHaveLength(1);
    // ...and hud.ts keeps NO spend path of its own, so there is exactly one.
    expect(hud.match(/claudiumHooks\?\.spend\(/g)).toBeNull();
    // The hook the bridge calls declares the optional key and the storage kind.
    const hooks = hud.slice(
      anchor(hud, 'export interface ClaudiumHooks {'),
      anchor(hud, 'export interface HudFeatures {'),
    );
    expect(hooks).toContain('idempotencyKey?: string,');
    expect(hooks).toContain("kind: 'cosmetic' | 'skin' | 'item' | 'storage',");
    // The ledger construction moved behind src/ui/purchase_intent_durability.ts
    // when phase 16 made an intent survive the page; the factory owns the ONE
    // minter now. BOTH spending windows are pinned here rather than just this
    // one, because reverting either to a memory-only ledger reopens ruling 19.
    expect(storeWindow).toContain('durableIntents(() => this.deps.world())');
    expect(readSource('../src/ui/bank_window.ts')).toContain(
      'durableIntents(() => this.deps.world())',
    );
    // THE HANDOFF OPENS, IT DOES NOT TOGGLE (Bank Storage phase 17). Both
    // spending windows reach the top-up through this facet member, and routing it
    // at the TOGGLE closed a Claudium window the player already had open and fired
    // the return callback against an unchanged balance. The bags panel's launcher
    // is deliberately still a toggle: it is an affordance, not a one-way handoff,
    // and unifying the two would be the wrong answer to the same line.
    expect(hud).toContain(
      'openClaudium: (onClosed) => this.claudiumHooks !== null && this.claudiumWindow.open(onClosed),',
    );
    expect(hud).toContain('openClaudium: () => this.toggleClaudium(),');
    // The verb really exists, so the pin above cannot pass over a method that
    // does not; its behaviour is driven in tests/claudium_window.test.ts.
    expect(readSource('../src/ui/claudium_window.ts')).toContain(
      'open(onClosed?: () => void): void {',
    );

    // Weapon skins keep passing NO key: main.ts then mints one per attempt,
    // byte-identical to the behavior before the charter path existed.
    const skinPurchase = storeArmoryPurchase.slice(
      anchor(storeArmoryPurchase, '  async purchase('),
      anchor(storeArmoryPurchase, '  private fail('),
    );
    expect(skinPurchase).toContain('result = await this.deps.spend(row.skin.id, cost)');
    expect(skinPurchase).not.toContain('idempotencyKey');
    expect(skinPurchase).not.toContain('charterIntents');
    // The window's one spend seam carries (itemId, kind, cost) and nothing else;
    // the grant-family factory is where 'skin' is chosen, still with no key.
    expect(storeWindow).toContain(
      'spend: async (itemId, kind, cost) => this.deps.spendStoreItem?.(itemId, kind, cost)',
    );
    expect(storeSpendControllers).toContain("spend: (itemId, cost) => spend(itemId, 'skin', cost)");
    expect(storeSpendControllers).not.toContain('idempotencyKey');
  });

  it('carries keyboard focus across its own rebuild through the shared seam', () => {
    // The repo's focus_restore class: a painter that assigns innerHTML destroys
    // the control the player is standing on. This one now fires on EVERY
    // purchase outcome, so it is the surface that will actually be hit.
    // focusKeyAttr joined the import when the top-up button gained a key (phase 17
    // QA): a pin on the whole import LINE is a same-change obligation for any
    // widening, which is the point of pinning the line rather than the symbols.
    expect(storeWindow).toContain(
      "import { captureFocusKey, focusedWithin, focusKeyAttr } from './focus_restore'",
    );
    // restoreFirstEnabled moved BEHIND store_focus_policy in Phase 15 QA, so the
    // reach this pin used to have over the shared helper is kept by following it
    // there: the window routes through the policy, the policy reads the seam, and
    // the window may no longer reach the helper itself (one reader, one place).
    expect(storeWindow).toContain("from './store_focus_policy'");
    for (const symbol of ['planStoreFocus', 'restoreStoreFocus', 'StoreFocusStash']) {
      expect(storeWindow).toContain(symbol);
    }
    // Counted on both sides rather than a bare substring scan: the window's own
    // comments legitimately discuss the seam, and a count says "no CALL here,
    // and at least one there" without depending on prose avoiding the name.
    expect((storeWindow.match(/restoreFirstEnabled\(/g) ?? []).length).toBe(0);
    expect(storeFocusPolicy).toContain("from './focus_restore'");
    expect((storeFocusPolicy.match(/restoreFirstEnabled\(/g) ?? []).length).toBeGreaterThan(0);
    // Never a hand-rolled activeElement read (src/ui/CLAUDE.md).
    expect(storeWindow).not.toContain('document.activeElement');
    // Both keyed families in the rebuilt subtree carry the shared attribute, and
    // NEITHER markup core hand-spells it: both go through the
    // namespace's one builder, which is what keeps a markup-only emitter inside
    // the single-reader rule (tests/focus_restore.test.ts pins the rule itself,
    // and caught the armory half the moment the extraction landed).
    expect(charterCardView).toContain(`focusKeyAttr(\`charter-\${row.itemId}\`)`);
    expect(charterCardView).not.toContain('data-focus-key=');
    expect(armoryCardView).toContain(`focusKeyAttr(\`armory-\${row.skin.id}\`)`);
    expect(armoryCardView).not.toContain('data-focus-key=');
    expect(storeWindow).not.toContain('data-focus-key=');
    const paintStore = storeWindow.slice(
      anchor(storeWindow, 'private paintStore('),
      anchor(storeWindow, 'private charterButton('),
    );
    // Captured BEFORE the wipe, restored after, in that order.
    expect(paintStore).toContain('captureFocusKey(body)');
    expect(paintStore).toContain('restoreStoreFocus(body, plan');
    expect(paintStore.indexOf('captureFocusKey(body)')).toBeLessThan(
      paintStore.indexOf('this.replaceStoreBody(body, markup)'),
    );
    expect(paintStore.indexOf('this.replaceStoreBody(body, markup)')).toBeLessThan(
      paintStore.indexOf('restoreStoreFocus(body, plan'),
    );
    // The stash is spent by a paint that HAPPENED. Clearing it above the
    // identity check would consume it on an elided paint that destroyed no
    // control, leaving the purchase outcome nothing to hand focus back to.
    expect(paintStore.indexOf('this.replaceStoreBody(body, markup)')).toBeLessThan(
      paintStore.indexOf('this.charterFocus.clear()'),
    );
    // THE ERROR BODY IS A WIPE TOO (Bank Storage phase 17), and it has its own
    // slice for a mechanical reason: the pin above reads the FIRST occurrence of
    // three literals inside paintStore, so a second copy of them in the error
    // branch would read as the order being wrong. Same three steps, own method,
    // own anchors, placed outside that slice.
    const paintStoreError = storeWindow.slice(
      anchor(storeWindow, 'private paintStoreError('),
      anchor(storeWindow, 'private setCharterBusy('),
    );
    expect(paintStoreError.length).toBeGreaterThan(0);
    // NOT `not.toContain('private setCharterBusy')`, which is what this arm said
    // first: slice() is end-EXCLUSIVE, so a slice can never contain its own end
    // anchor and that guard is constant true. What can actually go wrong is the
    // slice SWALLOWING a method declared between the two anchors, which would let
    // the ordering pins below read literals out of someone else's body. The
    // slice STARTS at its own declaration, so a correct one carries no FURTHER
    // declaration at all.
    expect(
      (paintStoreError.match(/\n {2}private /g) ?? []).length,
      'no second method declaration was swallowed into the slice',
    ).toBe(0);
    expect(paintStoreError).toContain('captureFocusKey(body)');
    expect(paintStoreError).toContain('restoreStoreErrorFocus(plan, this.deps.root())');
    expect(paintStoreError.indexOf('captureFocusKey(body)')).toBeLessThan(
      paintStoreError.indexOf('this.replaceStoreBody('),
    );
    expect(paintStoreError.indexOf('this.replaceStoreBody(')).toBeLessThan(
      paintStoreError.indexOf('restoreStoreErrorFocus(plan'),
    );
    // Spent by a paint that HAPPENED, exactly as on the normal path: an elided
    // error repaint destroyed no control, so its target is still the right one.
    expect(paintStoreError.indexOf('if (!wiped) return;')).toBeLessThan(
      paintStoreError.indexOf('this.charterFocus.clear()'),
    );
    // The window still routes through the policy rather than reaching the shared
    // helper itself, which is what the zero-count arm above is guarding; the
    // policy is where the new ladder lives.
    expect(storeFocusPolicy).toContain('export function restoreStoreErrorFocus');
    // EXACT, not a floor. The count is knowable (the foreground degrade, the
    // background family degrade, and the error ladder; the import carries no
    // paren so the regex does not see it), and a FOURTH call site is a fourth
    // restore ladder free to drift from the other three, which is the drift this
    // whole block exists to catch. A >= bound cannot see one arriving.
    expect((storeFocusPolicy.match(/restoreFirstEnabled\(/g) ?? []).length).toBe(3);
    // The top-up button carries a focus key, minted through the namespace's one
    // builder rather than hand-spelled (the zero-count arm above bans the literal
    // attribute in this window). It was the only focusable control in the store
    // body without one, so captureFocusKey read null while focus sat on a real
    // element and every wipe dropped a keyboard player standing on it to <body>.
    expect(storeWindow).toContain(`data-buy-claudium\${focusKeyAttr('topup')}`);

    // Focuses nothing when focus was not in this subtree, and degrades through
    // the shared helper rather than a bare focus() on candidates[0]. The degrade
    // arms are reachable ONLY when the plan allows it, which is what keeps a
    // background repaint from walking to the top of the scroller.
    // It cannot join UI_PURE_CORES (it queries the passed subtree), so the
    // determinism scan that list buys does not reach the decision function. Pin
    // the banned tokens here instead: a clock or an rng draw in a focus decision
    // would make the same repaint land somewhere different each time.
    for (const banned of ['Date.now', 'Math.random', 'performance.now']) {
      expect(storeFocusPolicy).not.toContain(banned);
    }
    expect(storeFocusPolicy).toContain('if (plan.focusKey === null) return;');
    // The top-up button is EXCLUDED from the middle rung rather than repeated in
    // it (phase 17 QA gave it a key, which made it a member of `keyed` and, being
    // painted first in the store body, the first fallback). The ladder's order is
    // the claim: same control, then any other keyed control in the GRID, then the
    // top-up button last. tests/store_focus_policy.test.ts drives both halves.
    // Pinned as PIECES rather than as one formatted line: the exclusion grew a
    // second clause in the QA round's own review (identity alone lapses if a
    // caller ever resolves topUp from a different root), biome then wrapped the
    // call across four lines, and a whole-line pin reds on the reformat rather
    // than on the semantics. The ORDER claim is driven in
    // tests/store_focus_policy.test.ts against a fixture that paints the top-up
    // FIRST, exactly as production does; these hold the spelling.
    expect(storeFocusPolicy).toContain('...keyed.filter(');
    expect(storeFocusPolicy).toContain("el !== topUp && !el.hasAttribute('data-buy-claudium')");
    expect(storeFocusPolicy).toContain('topUp,');
    expect(storeFocusPolicy).toContain('restoreFirstEnabled([exact, ...siblings]);');
  });

  it('holds the buy button for the duration of the spend', () => {
    const purchase = storeWindow.slice(
      anchor(storeWindow, 'private async purchaseCharter('),
      anchor(storeWindow, 'private async refuseCharterPurchase('),
    );
    expect(purchase).toContain('if (this.charterInFlight.has(itemId)) return;');
    expect(purchase).toContain('this.setCharterBusy(itemId, true);');
    // Released in a finally, so a throwing hook cannot strand the button.
    expect(purchase).toContain('} finally {');
    expect(purchase).toContain('this.charterInFlight.delete(itemId);');
    expect(purchase).toContain('this.setCharterBusy(itemId, false);');
    const busy = storeWindow.slice(
      anchor(storeWindow, 'private setCharterBusy('),
      anchor(storeWindow, 'private requestCharterPurchase('),
    );
    expect(busy).toContain("button.setAttribute('aria-busy', 'true')");
    expect(busy).toContain('button.disabled = true;');
    // The stash is NOT taken here. setCharterBusy runs inside the confirm
    // dialog's onOk, by which point the dialog element is gone and focus is
    // already on <body>, so a capture here always reads null (measured in a real
    // browser). requestCharterPurchase takes it while the button still holds
    // focus, BEFORE the dialog opens.
    expect(busy).not.toContain('captureFocusKey(');
    const request = storeWindow.slice(
      anchor(storeWindow, 'private requestCharterPurchase('),
      anchor(storeWindow, 'private abandonCharterIntent('),
    );
    expect(request).toContain('this.charterFocus.arm(body ? captureFocusKey(body) : null);');
    expect(request.indexOf('captureFocusKey(body)')).toBeLessThan(
      request.indexOf('this.showStoreDecision({'),
    );
    // The other entry point refuses too, so a card click cannot open a second
    // dialog over a live spend.
    expect(request).toContain('if (this.charterInFlight.has(itemId)) return;');
  });

  it('owns Store decisions in the prompt stack instead of the HUD confirm dialog', () => {
    expect(storeWindow).not.toContain('this.deps.confirmDialog?.(');
    expect(storeWindow).toContain('private readonly storeRuntime = new StoreSurfaceRuntime');
    expect(storeSurfaceRuntime).toContain('this.prompts = new StoreDecisionPrompts(root)');
    expect(storeDecisionPrompt).toContain("document.getElementById('prompt-stack')");
    expect(storeDecisionPrompt).toContain("prompt.id = 'confirm-dialog'");
    expect(storeDecisionPrompt).toContain('installPromptDialog(prompt, opener, close');
    expect(storeDecisionPrompt).toContain("result.setAttribute('role', 'status')");
  });

  it('announces results through one persistent live region, not a freshly written role', () => {
    // A role="status" node created in the same innerHTML write as its text is
    // commonly never announced, and success is the status case.
    const tabs = dailyRewardsChrome.slice(
      anchor(dailyRewardsChrome, 'export function wocStoreTabsHtml('),
      anchor(dailyRewardsChrome, 'export function dailyRewardsLoadingHtml('),
    );
    expect(tabs).toContain('data-charter-live');
    expect(tabs).toContain('role="status"');
    expect(tabs).toContain('aria-live="polite"');
    // The visible band carries NO role of its own (that is the shape that fails).
    const band = storeWindow.slice(
      anchor(storeWindow, 'private charterNoticeHtml('),
      anchor(storeWindow, 'private setCharterNotice('),
    );
    expect(band).toContain('woc-store-notice charter-notice');
    expect(band).not.toContain('role=');
    // Every result goes through the ONE setter that also announces: the field
    // has exactly one writer, and it is that setter. A future arm that assigned
    // the field directly would paint a result no screen reader ever hears.
    const setter = storeWindow.slice(
      anchor(storeWindow, 'private setCharterNotice('),
      anchor(storeWindow, 'private charterRowById('),
    );
    expect(storeWindow.match(/this\.charterNotice = \{/g)).toHaveLength(1);
    expect(setter).toContain('this.charterNotice = { tone, text };');
    expect(setter).toContain("querySelector<HTMLElement>('[data-charter-live]')");
    // Four callers now: the no-hook outage, the granted band, the generic
    // refusal band, and the price_changed announcement. The shared banner alone
    // is written into the same innerHTML as its own text, the shape this suite
    // pins as the one that never announces, so the charter arm routes through
    // the setter that owns the persistent region.
    expect(storeWindow.match(/this\.setCharterNotice\(/g)).toHaveLength(4);
    const refuse = storeWindow.slice(
      anchor(storeWindow, 'private async refuseCharterPurchase('),
      anchor(storeWindow, 'private repaintStore('),
    );
    expect(refuse).toContain(
      "this.setCharterNotice('failure', t('hudChrome.wocStore.priceChanged'));",
    );
  });

  it('styles both notice tones and keeps the buy target at the comfortable floor', () => {
    // The failure tone was emitted with no rule, so it rendered identically to a
    // success.
    expect(componentsCss).toContain('.charter-notice.failure {');
    expect(componentsCss).toContain('.charter-notice.success {');
    const buy = componentsCss.match(/\.charter-buy \{([^}]*)\}/);
    expect(buy?.[1]).toContain('min-height: 40px;');
    const mobileBuy = mobileCss.match(/body\.mobile-touch \.charter-buy \{([^}]*)\}/);
    expect(mobileBuy?.[1]).toContain('min-height: 44px;');
    expect(componentsCss).toContain('.charter-empty {');
  });

  it('routes the Claudium top-up return through one explicit per-handoff hook', () => {
    // No module global and no timer: the store hands the Claudium window ONE
    // callback, armed by the call that opens it and cleared as it fires.
    expect(storeWindow).toContain('this.deps.openClaudium?.(() => this.openStore());');
    // RE-POINTED at open() by Bank Storage phase 17: routing a HANDOFF at the
    // toggle closed a window the player already had open. The arm below still
    // pins that the handoff reaches the window through ONE hook; which verb it
    // uses, and why the bags launcher keeps the toggle, is pinned in the ruling-19
    // block above and driven in tests/claudium_window.test.ts.
    expect(hud).toContain('this.claudiumWindow.open(onClosed)');
    expect(hud).toContain('this.claudiumWindow.toggle(onClosed);');
    expect(claudiumWindow).toContain('toggle(onClosed?: () => void): void {');
    expect(claudiumWindow).toContain('this.closeReturn = onClosed ?? null;');
    // The already-open arm ARMS rather than dropping, on BOTH verbs, which is
    // what makes "exactly one callback whichever state it found" true.
    // EXACT, not a floor: the count is knowable (toggle's already-open arm and
    // open's), and a stray third copy is a third place the single-shot rule could
    // drift.
    expect(
      (claudiumWindow.match(/if \(onClosed\) this\.closeReturn = onClosed;/g) ?? []).length,
    ).toBe(2);
    const close = claudiumWindow.slice(
      claudiumWindow.indexOf('  close(): void {'),
      claudiumWindow.indexOf('  async render('),
    );
    expect(close).toContain('const armed = this.closeReturn;');
    expect(close).toContain('this.closeReturn = null;');
    expect(close).toContain('armed?.();');
    expect(close.indexOf('this.closeReturn = null;')).toBeLessThan(close.indexOf('armed?.();'));
    expect(claudiumWindow).not.toMatch(/setTimeout|setInterval/);
  });

  it('gives the charter grid a mobile-usable layout and thumb-sized buy targets', () => {
    const grid = componentsCss.match(/\.charter-grid \{([^}]*)\}/);
    expect(grid?.[1]).toContain('grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));');
    const mobileGrid = mobileCss.match(/body\.mobile-touch \.charter-grid \{([^}]*)\}/);
    expect(mobileGrid?.[1]).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    const mobileBuy = mobileCss.match(/body\.mobile-touch \.charter-buy \{([^}]*)\}/);
    expect(mobileBuy?.[1]).toContain('min-height: 44px;');
    const landscape = mobileCss.slice(anchor(mobileCss, '@media (orientation: landscape)'));
    expect(landscape).toContain('body.mobile-touch .charter-grid {');
    expect(landscape).toContain('grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));');
    // Nothing a buyer needs is hover-only: name, grant, price and button are all
    // painted as always-visible content, with no :hover-gated card body.
    expect(componentsCss).not.toMatch(
      /\.charter-card:hover[^{}]*\{[^}]*(?:display|visibility|opacity)/,
    );
    expect(componentsCss).toContain('.charter-buy:focus-visible {');
  });
});

/** The balanced `{ ... }` object literal that follows `needle`, so a
 *  containment claim really is about THAT literal. A fixed-size slice would be
 *  proximity, not containment: it can overrun into the next field and pass on a
 *  line that belongs to a different window. */
function objectLiteralAfter(source: string, needle: string): string {
  const start = source.indexOf('{', anchor(source, needle));
  expect(start, `no object literal after ${needle}`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced object literal after ${needle}`);
}

describe('the one Claudium spend seam reaches BOTH windows', () => {
  // Phase 13 moved the money-handling closures out of hud.ts into
  // createClaudiumPurchaseFacet so a SECOND window could take them without a
  // second copy. Nothing pinned the wiring: deleting either spread left the
  // whole suite green, because both windows tolerate the hooks being absent
  // (that is the offline shape), so the tag simply vanishes and every gating
  // test still passes. A player online would silently lose the Claudium rail.
  it('each window deps literal spreads the facet, and hud.ts mints exactly one', () => {
    const hud = readSource('../src/ui/hud.ts');
    expect((hud.match(/createClaudiumPurchaseFacet\(/g) ?? []).length).toBe(1);
    // Exactly two spreads, so a third window cannot join without this pin moving.
    expect((hud.match(/\.\.\.this\.claudiumPurchase,/g) ?? []).length).toBe(2);
    // And each one is INSIDE its own window's deps literal.
    expect(objectLiteralAfter(hud, 'new BankWindow(')).toContain('...this.claudiumPurchase,');
    expect(objectLiteralAfter(hud, 'new DailyRewardsWindow(')).toContain(
      '...this.claudiumPurchase,',
    );
  });

  it('the facet is the ONLY provider of the four money deps in hud.ts', () => {
    // A hand-rolled key beside the spread would shadow the facet's own and
    // reintroduce exactly the second copy the extraction removed. Counted over
    // the two deps literals rather than the file, because unrelated windows may
    // legitimately carry a key of the same name.
    const hud = readSource('../src/ui/hud.ts');
    for (const site of ['new BankWindow(', 'new DailyRewardsWindow(']) {
      const literal = objectLiteralAfter(hud, site);
      for (const key of ['spendStoreItem:', 'storeEnabled:', 'claudiumBalance:', 'openClaudium:']) {
        expect(literal, `${site} must take ${key} from the facet, not its own`).not.toContain(key);
      }
    }
    // Positive control, so the four negatives above cannot pass on an empty or
    // mis-anchored slice: each literal really was found and really has content.
    expect(objectLiteralAfter(hud, 'new BankWindow(').length).toBeGreaterThan(200);
    expect(objectLiteralAfter(hud, 'new DailyRewardsWindow(').length).toBeGreaterThan(200);
  });
});
