import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { ensureLocaleLoaded, setLanguage, type SupportedLanguage } from '../../src/ui/i18n';
import { BankWindow, type BankWindowDeps } from '../../src/ui/bank_window';
import {
  closeMaterialSourcesDialog,
  openMaterialSourcesDialog,
} from '../../src/ui/material_sources_dialog';
import type { BankInfo, IWorld } from '../../src/world_api';
import { cleanup, host, stubDeps } from './_harness';

let bank: BankWindow | null = null;
afterEach(() => {
  closeMaterialSourcesDialog(false);
  bank?.close();
  bank = null;
  cleanup();
  document.body.className = '';
  setLanguage('en');
  for (const name of ['--app-vw', '--app-vh', '--ui-scale'])
    document.documentElement.style.removeProperty(name);
});

function mount(width: number, height: number) {
  document.body.className = width < 900 ? 'game-active mobile-touch' : 'game-active';
  document.documentElement.style.setProperty('--app-vw', `${width}px`);
  document.documentElement.style.setProperty('--app-vh', `${height}px`);
  document.documentElement.style.setProperty('--ui-scale', '1');
  const root = host('bank-window');
  const stack = document.createElement('div');
  stack.id = 'prompt-stack';
  document.body.appendChild(stack);
  const bankInfo: BankInfo = {
    slots: [
      {
        itemId: 'copper_ore',
        count: 5,
        materialSources: [
          { source: { gatherer: { kind: 'character', id: 1, name: 'Ana' } }, count: 2 },
          { source: { gatherer: { kind: 'character', id: 2, name: 'Bru' } }, count: 3 },
        ],
      },
    ],
    capacity: 24,
    purchasedSlots: 0,
    bonusSlots: 0,
    nextExpansionCost: 500,
    bonusSources: [],
    socketsUnlocked: 0,
    socketBags: [null, null, null, null],
    nextSocketCost: 1_000_000,
    generalCapacity: 24,
    materialsCapacity: 0,
    generalUsed: 1,
    materialsUsed: 0,
  };
  const withdraw = vi.fn();
  const world = {
    bankInfo,
    guildBankInfo: null,
    vaultInfo: null,
    inventory: [],
    bags: [null, null, null, null],
    copper: 1000,
    bankWithdraw: withdraw,
  } as unknown as IWorld;
  bank = new BankWindow(
    stubDeps<BankWindowDeps>({
      root: () => root,
      world: () => world,
      captureFocus: () => null,
      itemIcon: () => '<span class="item-icon"></span>',
      itemTooltip: () => '',
      consumePeek: () => false,
      openMaterialSources: openMaterialSourcesDialog,
      moneyHtml: (count) => String(count),
      storeEnabled: () => false,
    }),
  );
  bank.open();
  return { root, withdraw };
}

describe('material source actions in the real bank window', () => {
  for (const [width, height] of [
    [1280, 720],
    [844, 390],
    [390, 844],
  ]) {
    it(`opens source selection without withdrawing at ${width}x${height}`, async () => {
      await page.viewport(width, height);
      const { root, withdraw } = mount(width, height);
      expect(root.querySelectorAll('.bank-item:not(.empty)')).toHaveLength(1);
      const action = root.querySelector<HTMLButtonElement>('.material-sources-action')!;
      expect(action).not.toBeNull();
      const actionBox = action.getBoundingClientRect();
      expect(actionBox.width).toBeGreaterThanOrEqual(40);
      expect(actionBox.height).toBeGreaterThanOrEqual(40);
      const wrapper = action.closest<HTMLElement>('.material-source-item-cell')!;
      const empty = root.querySelector<HTMLElement>('.bank-item.empty')!;
      expect(
        Math.abs(wrapper.getBoundingClientRect().width - empty.getBoundingClientRect().width),
      ).toBeLessThanOrEqual(1);
      expect(action.scrollWidth).toBeLessThanOrEqual(action.clientWidth);
      expect(actionBox.bottom).toBeLessThanOrEqual(wrapper.getBoundingClientRect().bottom + 1);
      const followingRow = Array.from(root.querySelectorAll<HTMLElement>('.bank-item.empty'))
        .map((cell) => cell.getBoundingClientRect())
        .find((box) => box.top > wrapper.getBoundingClientRect().top + 1);
      expect(followingRow).toBeDefined();
      expect(actionBox.bottom).toBeLessThanOrEqual(followingRow!.top);
      expect(root.querySelector('button button')).toBeNull();
      await page.screenshot({
        path: `../../docs/screenshots/intentional-gathering-pr2/bank-${width}x${height}.png`,
      });
      action.click();
      expect(withdraw).not.toHaveBeenCalled();
      expect(
        document.querySelectorAll('#material-sources-dialog .material-sources-row'),
      ).toHaveLength(2);
    });
  }

  it('fits the source action in each required non-Latin locale', async () => {
    await page.viewport(390, 844);
    for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as SupportedLanguage[]) {
      await ensureLocaleLoaded(language);
      setLanguage(language);
      const { root } = mount(390, 844);
      const action = root.querySelector<HTMLButtonElement>('.material-sources-action')!;
      expect(action.textContent, language).not.toBe('Sources');
      expect(action.scrollWidth, language).toBeLessThanOrEqual(action.clientWidth);
      const wrapper = action.closest<HTMLElement>('.material-source-item-cell')!;
      expect(action.getBoundingClientRect().bottom, language).toBeLessThanOrEqual(
        wrapper.getBoundingClientRect().bottom + 1,
      );
      bank!.close();
      bank = null;
      cleanup();
    }
  });

  it('removes its source prompt when the bank is force-closed', async () => {
    await page.viewport(1280, 720);
    const { root } = mount(1280, 720);
    root.querySelector<HTMLButtonElement>('.material-sources-action')!.click();
    expect(document.getElementById('material-sources-dialog')).not.toBeNull();
    bank!.close();
    expect(document.getElementById('material-sources-dialog')).toBeNull();
    expect(root.inert).toBe(false);
  });
});
