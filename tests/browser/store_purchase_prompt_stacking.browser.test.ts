// Real-browser regression for the store purchase confirm that painted UNDER the
// Armory inspect overlay. The page mounts #prompt-stack inside #ui, which the
// shipped CSS makes a position:fixed z-index:10 stacking context, while the
// inspector mounts on <body> at 90: a decision raised in #prompt-stack could
// never clear it, so a real click on Purchase Skin opened a prompt nobody could
// see (its focused Confirm still took Enter, the field workaround). The Node
// suites pin the host choice; this file proves the PAINT ORDER with the shipped
// CSS, a real pointer click, and the game input layer's post-click focus drop.
//
// The paint-order probe: hit-testing skips inert subtrees, and the controller
// makes the overlay inert, so elementFromPoint alone reaches a covered prompt
// and would pass on the broken build. The probe lifts inert for one read, so
// the overlay competes for the point and only a prompt painted ABOVE it wins.
import '../../src/styles/index.css';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

vi.mock('../../src/render/armory_preview', () => ({
  createArmoryPreview: () => ({
    setActive() {},
    setAppearance() {},
    setScene() {},
    setMode() {},
    setSkin() {},
    prewarm: async () => undefined,
    finishPrewarm() {},
    dispose() {},
  }),
}));

import { Input, type InputCallbacks } from '../../src/game/input';
import { Keybinds } from '../../src/game/keybinds';
import { DailyRewardsWindow, type DailyRewardsWindowDeps } from '../../src/ui/daily_rewards_window';
import type { WocStoreItemInput } from '../../src/ui/woc_store_view';
import type { IWorld } from '../../src/world_api';
import { cleanup, stubDeps } from './_harness';

const SKIN_ID = 'guildmark_arming_sword';
const CHARTER_ID = 'strongbox_charter_1';
const ITEMS: WocStoreItemInput[] = [
  {
    itemId: SKIN_ID,
    name: 'Guildmark Arming Sword',
    kind: 'skin',
    costClaudium: 200,
    owned: false,
  },
  // A priced charter, so the no-inspector control below has an enabled Buy.
  {
    itemId: CHARTER_ID,
    name: 'catalog-owned-name',
    kind: 'storage',
    costClaudium: 500,
    owned: false,
  },
];

let input: Input | null = null;
const mounted: Array<{ close(): void }> = [];

function center(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** The topmost PAINTED element at the point, with the overlay competing (inert lifted). */
function paintedAt(overlay: HTMLElement, x: number, y: number): Element | null {
  const wasInert = overlay.inert;
  overlay.inert = false;
  try {
    return document.elementFromPoint(x, y);
  } finally {
    overlay.inert = wasInert;
  }
}

function mountStore(
  width = 1280,
  height = 720,
): {
  root: HTMLElement;
  win: DailyRewardsWindow;
  spend: ReturnType<typeof vi.fn>;
} {
  document.documentElement.style.setProperty('--app-vw', `${width}px`);
  document.documentElement.style.setProperty('--app-vh', `${height}px`);
  document.documentElement.style.setProperty('--ui-scale', '1');
  // The real page shape: the canvas the input layer owns, then #ui holding
  // both #prompt-stack and the store window (index.html).
  const canvas = document.createElement('canvas');
  canvas.id = 'game-canvas';
  document.body.appendChild(canvas);
  if (!input) input = new Input(canvas, stubDeps<InputCallbacks>({}), new Keybinds());
  const ui = document.createElement('div');
  ui.id = 'ui';
  ui.tabIndex = -1;
  document.body.appendChild(ui);
  const stack = document.createElement('div');
  stack.id = 'prompt-stack';
  ui.appendChild(stack);
  const root = document.createElement('div');
  root.id = 'daily-rewards-window';
  root.className = 'window panel ui-window';
  root.style.display = 'none';
  ui.appendChild(root);
  const world = {
    player: {
      templateId: 'warrior',
      mainhandItemId: null,
      offhandItemId: null,
      skin: 'warrior_a',
      skinCatalog: 'class',
      mountSkinId: null,
    },
    accountCosmetics: { weaponSkinIds: [], weaponSkinLoadout: {}, mountSkinIds: [] },
    ownedMounts: () => [],
    bankPurchasedSlots: 0,
    changeWeaponSkin: () => undefined,
    changeMountSkin: () => undefined,
  };
  const spend = vi.fn(async () => ({
    granted: true,
    balance: 4_800,
    costClaudium: 200,
    reason: null,
  }));
  const deps: DailyRewardsWindowDeps = {
    root: () => root,
    world: () => world as unknown as IWorld,
    closeOthers: () => undefined,
    captureFocus: () => null,
    restoreFocus: () => undefined,
    storeEnabled: () => true,
    storeSnapshot: async () => ({ available: true, balance: 5_000, items: ITEMS }),
    spendStoreItem: spend,
  };
  const win = new DailyRewardsWindow(deps);
  mounted.push(win);
  win.openStore();
  return { root, win, spend };
}

afterEach(() => {
  for (const win of mounted.splice(0)) win.close();
  cleanup();
  document.body.className = '';
  for (const property of ['--app-vw', '--app-vh', '--ui-scale']) {
    document.documentElement.style.removeProperty(property);
  }
});

describe('Armory purchase confirm over the inspect overlay (real click)', () => {
  it('paints the confirm above the inspector and a second real click buys the skin', async () => {
    await page.viewport(1280, 720);
    document.body.className = 'game-active';
    const { root, spend } = mountStore();
    await vi.waitFor(() => {
      expect(root.querySelector(`[data-armory-skin="${SKIN_ID}"]`)).not.toBeNull();
    });
    const card = root.querySelector<HTMLElement>(`[data-armory-skin="${SKIN_ID}"]`) as HTMLElement;
    card.scrollIntoView({ block: 'center' });
    await userEvent.click(card);
    await vi.waitFor(() => {
      expect(document.querySelector('.armory-inspect-overlay [data-armory-buy]')).not.toBeNull();
    });
    const overlay = document.querySelector<HTMLElement>('.armory-inspect-overlay') as HTMLElement;
    const buy = overlay.querySelector<HTMLButtonElement>('[data-armory-buy]') as HTMLButtonElement;
    expect(overlay.parentElement, 'the inspector is a body-level overlay').toBe(document.body);
    expect(getComputedStyle(overlay).zIndex).toBe('90');
    expect(getComputedStyle(document.getElementById('ui') as HTMLElement).zIndex).toBe('10');

    await userEvent.click(buy);

    const prompt = document.querySelector<HTMLElement>('.woc-store-prompt');
    expect(prompt, 'a real click must open the purchase confirm').not.toBeNull();
    const confirm = prompt?.querySelector<HTMLButtonElement>(
      '[data-store-prompt-confirm]',
    ) as HTMLButtonElement;
    expect(confirm).not.toBeNull();
    expect(overlay.inert, 'the inspector is blocked behind the modal').toBe(true);
    // The input layer's post-click focus drop must leave the modal's focus alone.
    expect(document.activeElement).toBe(confirm);
    // THE bug: painted ABOVE the inspector. With inert lifted, the point must
    // still resolve to the prompt's own control rather than the overlay or its
    // dialog (on the broken build this read the inspector's dialog panel).
    const at = center(confirm);
    const painted = paintedAt(overlay, at.x, at.y);
    expect(painted).not.toBeNull();
    expect(prompt?.contains(painted), 'the confirm must not be covered').toBe(true);
    const promptRect = prompt?.getBoundingClientRect() as DOMRect;
    expect(promptRect.top).toBeGreaterThanOrEqual(0);
    expect(promptRect.bottom).toBeLessThanOrEqual(window.innerHeight);
    // How: the decision left #prompt-stack (inside #ui) for the body-level host.
    const host = prompt?.parentElement as HTMLElement;
    expect(host.id).toBe('store-prompt-stack');
    expect(host.parentElement).toBe(document.body);

    await userEvent.click(confirm);
    await vi.waitFor(() => expect(spend).toHaveBeenCalledTimes(1));
    expect(spend.mock.calls[0]?.[0]).toBe(SKIN_ID);
    // Confirm tore the prompt and its host down and released the inspector.
    expect(document.querySelector('.woc-store-prompt')).toBeNull();
    expect(document.getElementById('store-prompt-stack')).toBeNull();
    expect(overlay.inert).toBe(false);
  });

  it('a charter purchase (no inspector) still confirms in #prompt-stack', async () => {
    await page.viewport(1280, 720);
    document.body.className = 'game-active';
    const { root } = mountStore();
    await vi.waitFor(() => {
      expect(root.querySelector(`[data-charter-buy="${CHARTER_ID}"]`)).not.toBeNull();
    });
    const buy = root.querySelector<HTMLButtonElement>(
      `[data-charter-buy="${CHARTER_ID}"]`,
    ) as HTMLButtonElement;
    expect(buy.disabled).toBe(false);
    buy.scrollIntoView({ block: 'center' });
    await userEvent.click(buy);
    const prompt = document.querySelector<HTMLElement>('.woc-store-prompt');
    expect(prompt).not.toBeNull();
    expect(prompt?.parentElement?.id).toBe('prompt-stack');
    expect(document.getElementById('store-prompt-stack')).toBeNull();
    prompt?.querySelector<HTMLButtonElement>('[data-store-prompt-cancel]')?.click();
    expect(document.querySelector('.woc-store-prompt')).toBeNull();
  });

  // The touch sheet: the same click flow on the mobile landscape profile, where
  // the host takes the hud.mobile.css top-centre geometry and its pointer-events
  // shield (the host is click-through, the prompt opts back in).
  it('on mobile landscape the confirm is painted above the inspector, tappable, and inside the viewport', async () => {
    await page.viewport(844, 390);
    document.body.className = 'mobile-touch game-active hud-mobile-compact';
    const { root } = mountStore(844, 390);
    await vi.waitFor(() => {
      expect(root.querySelector(`[data-armory-skin="${SKIN_ID}"]`)).not.toBeNull();
    });
    const card = root.querySelector<HTMLElement>(`[data-armory-skin="${SKIN_ID}"]`) as HTMLElement;
    card.scrollIntoView({ block: 'center' });
    await userEvent.click(card);
    await vi.waitFor(() => {
      expect(document.querySelector('.armory-inspect-overlay [data-armory-buy]')).not.toBeNull();
    });
    const overlay = document.querySelector<HTMLElement>('.armory-inspect-overlay') as HTMLElement;
    const buy = overlay.querySelector<HTMLButtonElement>('[data-armory-buy]') as HTMLButtonElement;
    await userEvent.click(buy);

    const prompt = document.querySelector<HTMLElement>('.woc-store-prompt') as HTMLElement;
    expect(prompt).not.toBeNull();
    expect(prompt.parentElement?.id).toBe('store-prompt-stack');
    const confirm = prompt.querySelector<HTMLButtonElement>(
      '[data-store-prompt-confirm]',
    ) as HTMLButtonElement;
    const cancel = prompt.querySelector<HTMLButtonElement>(
      '[data-store-prompt-cancel]',
    ) as HTMLButtonElement;
    const rect = prompt.getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(window.innerWidth);
    expect(rect.top).toBeGreaterThanOrEqual(0);
    expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight);
    // The 44px touch floor on these buttons comes from a (pointer: coarse)
    // media rule (components.css) that viewport emulation alone does not
    // trigger, so it is not asserted here; the paint order and the real tap are.
    for (const control of [confirm, cancel]) {
      const at = center(control);
      const painted = paintedAt(overlay, at.x, at.y);
      expect(prompt.contains(painted), 'the control must not be covered').toBe(true);
    }
    expect(overlay.inert).toBe(true);

    // A real tap on Cancel lands through the host's pointer-events shield.
    await userEvent.click(cancel);
    expect(document.querySelector('.woc-store-prompt')).toBeNull();
    expect(document.getElementById('store-prompt-stack')).toBeNull();
    expect(overlay.inert).toBe(false);
  });
});
