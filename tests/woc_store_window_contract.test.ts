import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const storeWindow = readFileSync(
  new URL('../src/ui/daily_rewards_window.ts', import.meta.url),
  'utf8',
);
const claudiumWindow = readFileSync(
  new URL('../src/ui/claudium_window.ts', import.meta.url),
  'utf8',
);
const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const inspect = readFileSync(new URL('../src/ui/armory_inspect.ts', import.meta.url), 'utf8');
const componentsCss = readFileSync(
  new URL('../src/styles/components.css', import.meta.url),
  'utf8',
);
const mobileCss = readFileSync(new URL('../src/styles/hud.mobile.css', import.meta.url), 'utf8');

describe('WOC Store window contract', () => {
  it('opens on the Store tab and keeps Daily Rewards as a sub-tab', () => {
    expect(storeWindow).toContain("private tab: 'store' | 'rewards' = 'store'");
    expect(storeWindow).toContain('data-woc-store-tab="store"');
    expect(storeWindow).toContain('data-woc-store-tab="rewards"');
  });

  it('offers a Claudium top-up when the selected skin is unaffordable', () => {
    const purchase = storeWindow.slice(storeWindow.indexOf('private requestArmoryPurchase'));
    expect(purchase).toContain('if (!row.affordable)');
    expect(purchase).toContain("t('hudChrome.wocStore.needMoreTitle')");
    expect(purchase).toContain('this.openClaudiumFromStore()');
  });

  it('uses the authoritative insufficient-balance response for the top-up flow', () => {
    const purchase = storeWindow.slice(storeWindow.indexOf('private async purchaseArmorySkin'));
    expect(purchase).toContain("result?.reason === 'insufficient_balance'");
    expect(purchase).toContain('result.costClaudium');
    expect(purchase).toContain('result.balance');
    expect(purchase).toContain('this.openNeedMoreDialog');
    expect(purchase.indexOf("result?.reason === 'insufficient_balance'")).toBeLessThan(
      purchase.indexOf('this.storeError = true'),
    );
    expect(main).toContain('costClaudium: result.costClaudium');
    expect(main).toContain('reason: result.reason');
  });

  it('marks owned skins and prevents another purchase attempt', () => {
    expect(storeWindow).toContain('armory-state');
    expect(storeWindow).toContain(
      'if (row.owned || !row.purchasable || row.costClaudium === null) return;',
    );
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
    expect(storeWindow).toContain('aria-controls="woc-store-panel"');
    expect(storeWindow).toContain('role="tabpanel"');
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
      hud.indexOf("document.body.classList.toggle(\n      'store-stack-open'"),
      hud.indexOf("document.body.classList.toggle(\n      'mobile-map-quest-open'"),
    );
    expect(stackSync).toContain('stackedWindowsVisible(');
    expect(stackSync).toContain('!!storeWindow && this.isWindowVisible(storeWindow)');
    expect(stackSync).toContain('!!claudiumWindow && this.isWindowVisible(claudiumWindow)');
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
    expect(claudiumDeps).toContain('onVisibilityChange: () => this.syncAnyWindowOpenState()');
    const stackedLayers = componentsCss.match(
      /body\.store-stack-open #daily-rewards-window,\s*body\.store-stack-open #claudium-window \{([^}]*)\}/,
    );
    expect(stackedLayers?.[1]).toContain('will-change: transform;');
    expect(componentsCss).toContain(
      'body.window-drag-active .armory-section.rarity-legendary .armory-card',
    );
    expect(componentsCss).toContain('animation-play-state: paused;');
  });

  it('keeps storefront content mounted while a background refresh is loading', () => {
    expect(storeWindow).toContain('data-woc-store-loading');
    expect(storeWindow).toContain(
      "setAttribute('aria-busy', this.storeLoading ? 'true' : 'false')",
    );
    expect(storeWindow).not.toContain('if (this.storeLoading) {\n      body.innerHTML');
    expect(storeWindow).toContain('if (!snapshot.available || snapshot.balance === null)');
    expect(storeWindow).toContain('this.storeError = !this.storeReady;');
  });

  it('keeps the store, Claudium, and Daily Rewards surfaces out of native builds', () => {
    expect(main).toContain(
      'hud = new Hud(world, renderer, keybinds, { dailyRewardsEnabled: !NATIVE_APP });',
    );
    const economyWiring = main.slice(
      main.indexOf('if (!NATIVE_APP) {', main.indexOf('const claudiumHooks')),
      main.indexOf('function interactKey'),
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
    expect(hud).toContain('storeEnabled: () => this.claudiumHooks !== null');
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
    expect(storeWindow).toContain("(storeEnabled ? this.tabsHtml() : '')");
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
});
