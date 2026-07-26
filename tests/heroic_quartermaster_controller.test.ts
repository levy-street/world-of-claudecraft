import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { HEROIC_MARK_ITEM_ID } from '../src/sim/content/dungeon_difficulty';
import { HEROIC_VENDOR_STOCK } from '../src/sim/content/heroic_vendor';
import { ITEMS } from '../src/sim/data';
import {
  HeroicQuartermasterController,
  type HeroicQuartermasterControllerDeps,
} from '../src/ui/hud/vendor/heroic_quartermaster_controller';

interface Confirmation {
  title: string;
  body: string;
  okText: string;
  cancelText: string;
  onOk: () => void;
}

function harness() {
  const element = { style: { display: 'none' } } as HTMLElement;
  const opener = { id: 'opener' } as HTMLElement;
  const confirmations: Confirmation[] = [];
  const renders: Array<{ name: string; status: string | null; pending: boolean }> = [];
  const closeOtherWindows = vi.fn();
  const closeBank = vi.fn();
  const closeCopperVendor = vi.fn();
  const hideTooltip = vi.fn();
  const captureFocus = vi.fn(() => opener);
  const restoreFocus = vi.fn();
  const buy = vi.fn();
  const forge = vi.fn();
  const tune = vi.fn();
  let inRange = true;
  const deps: HeroicQuartermasterControllerDeps = {
    element: () => element,
    npcName: () => 'Quartermaster Vex',
    npcInRange: () => inRange,
    inventory: () => [{ itemId: HEROIC_MARK_ITEM_ID, count: 999 }],
    playerClass: () => 'warrior',
    raidLockoutIds: () => [],
    stock: HEROIC_VENDOR_STOCK,
    items: ITEMS,
    presentation: {
      itemIcon: (item) => `<span data-icon="${item.id}"></span>`,
      moneyHtml: (copper) => String(copper),
      itemTooltip: (item) => item.name,
      attachTooltip: () => {},
    },
    renderWindow: (target, name, _view, renderDeps) => {
      target.style.display = 'block';
      renders.push({ name, status: renderDeps.status, pending: renderDeps.pending });
    },
    focus: { captureFocus, restoreFocus },
    closeOtherWindows,
    closeBank,
    closeCopperVendor,
    hideTooltip,
    confirm: (title, body, okText, cancelText, onOk) => {
      confirmations.push({ title, body, okText, cancelText, onOk });
    },
    buy,
    forge,
    tune,
  };
  return {
    controller: new HeroicQuartermasterController(deps),
    element,
    opener,
    renders,
    confirmations,
    closeOtherWindows,
    closeBank,
    closeCopperVendor,
    hideTooltip,
    captureFocus,
    restoreFocus,
    buy,
    setInRange: (value: boolean) => {
      inRange = value;
    },
  };
}

const stockOffer = HEROIC_VENDOR_STOCK[0];
if (!stockOffer) throw new Error('heroic vendor stock fixture not found');

describe('HeroicQuartermasterController', () => {
  it('owns open/close exclusivity, rendering, and focus return', () => {
    const h = harness();

    h.controller.open(42);

    expect(h.controller.isOpen).toBe(true);
    expect(h.closeOtherWindows).toHaveBeenCalledExactlyOnceWith('#vendor-window');
    expect(h.closeBank).toHaveBeenCalledOnce();
    expect(h.closeCopperVendor).toHaveBeenCalledOnce();
    expect(h.captureFocus).toHaveBeenCalledOnce();
    expect(h.element.style.display).toBe('block');
    expect(h.renders.at(-1)?.name).toBe('Quartermaster Vex');

    h.controller.close();

    expect(h.controller.isOpen).toBe(false);
    expect(h.element.style.display).toBe('none');
    expect(h.hideTooltip).toHaveBeenCalled();
    expect(h.restoreFocus).toHaveBeenCalledExactlyOnceWith(h.opener);
  });

  it('confirms purchases, blocks duplicate submission, and recovers from failure', () => {
    const h = harness();
    h.controller.open(42);

    h.controller.requestPurchase(stockOffer.itemId);

    expect(h.buy).not.toHaveBeenCalled();
    expect(h.confirmations).toHaveLength(1);
    expect(h.confirmations[0].title).toBe('Confirm Purchase');
    expect(h.confirmations[0].body).toContain(ITEMS[stockOffer.itemId].name);
    expect(h.confirmations[0].body).toContain(String(stockOffer.marks));

    h.confirmations[0].onOk();
    expect(h.buy).toHaveBeenCalledExactlyOnceWith(stockOffer.itemId);
    expect(h.renders.at(-1)?.pending).toBe(true);

    h.controller.requestPurchase(stockOffer.itemId);
    expect(h.confirmations).toHaveLength(1);

    expect(h.controller.onError('The forge rejected the request.')).toBe(true);
    expect(h.renders.at(-1)?.status).toBe('The forge rejected the request.');
    h.controller.requestPurchase(stockOffer.itemId);
    expect(h.confirmations).toHaveLength(2);
  });

  it('resolves a pending vendor result and closes when the NPC leaves range', () => {
    const h = harness();
    h.controller.open(42);
    h.controller.requestPurchase(stockOffer.itemId);
    h.confirmations[0].onOk();

    h.controller.onVendorResult();

    expect(h.renders.at(-1)?.status).not.toBe('');
    expect(h.renders.at(-1)?.pending).toBe(false);

    h.setInRange(false);
    h.controller.updateProximity();
    expect(h.controller.isOpen).toBe(false);
  });

  it('ignores purchase ids outside configured stock', () => {
    const h = harness();
    h.controller.requestPurchase('not_a_stock_item');
    expect(h.confirmations).toHaveLength(0);
    expect(h.buy).not.toHaveBeenCalled();
  });
});

describe('Hud architecture boundary', () => {
  const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

  it('delegates Quartermaster state and procedural item presentation', () => {
    expect(hud).toContain('new HeroicQuartermasterController({');
    expect(hud).toContain('this.heroicQuartermaster.onVendorResult()');
    expect(hud).toContain('this.itemPresentation.tooltip(item, compare, instance)');
    expect(hud).not.toContain('HeroicVendorOperationState');
    expect(hud).not.toContain('buildHeroicQuartermasterView');
    expect(hud).not.toContain('proceduralAffixPresentations');
    expect(hud).not.toContain('requestNythraxisForge');
  });
});
