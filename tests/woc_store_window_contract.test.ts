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
    expect(purchase).toContain('() => this.deps.openClaudium?.()');
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
    expect(storeWindow).toContain('if (row.owned || !row.purchasable) return;');
  });

  it('sells only the Season 1 Armory (no legacy cosmetics grid)', () => {
    expect(storeWindow).not.toContain('woc-store-grid');
    expect(storeWindow).not.toContain('storeCardHtml');
    expect(storeWindow).not.toContain('buildWocStoreRows');
  });

  it('keeps the Claudium window focused on currency purchases', () => {
    expect(claudiumWindow).not.toContain('private storeHtml(');
    expect(claudiumWindow).not.toContain('data-item=');
    expect(claudiumWindow).toContain('cl-pack-art');
    expect(claudiumWindow).toContain('/claudium/icons/stack_');
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
    expect(main).toContain('if (!NATIVE_APP) hud.attachClaudium(claudiumHooks);');
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
});
