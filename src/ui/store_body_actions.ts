// Wires the painted WOC Store body's buttons to the window's actions. Split out
// of src/ui/daily_rewards_window.ts's paintStore so each store family (top-up,
// the Armory, the Machine Stable, the Strongbox charters) adds its button here
// instead of growing the window's painter; the window keeps the actions. The
// data attributes are the ones the pure card views emit
// (src/ui/armory_card_view.ts, src/ui/store_mount_card_view.ts,
// src/ui/charter_card_view.ts), read back verbatim so a renamed attribute
// fails the binding test rather than going silently inert.

import { STORE_MOUNT_BUY_ATTR } from './store_mount_card_view';

export interface StoreBodyActions {
  buyClaudium(): void;
  inspectArmorySkin(skinId: string): void;
  buyStoreMount(itemId: string): void;
  buyCharter(itemId: string): void;
}

export const STORE_BUY_CLAUDIUM_SELECTOR = '[data-buy-claudium]';
export const ARMORY_SKIN_ATTR = 'data-armory-skin';
export const CHARTER_BUY_ATTR = 'data-charter-buy';

export function bindStoreBodyActions(body: HTMLElement, actions: StoreBodyActions): void {
  body
    .querySelector<HTMLButtonElement>(STORE_BUY_CLAUDIUM_SELECTOR)
    ?.addEventListener('click', () => actions.buyClaudium());
  bindEach(body, ARMORY_SKIN_ATTR, (id) => actions.inspectArmorySkin(id));
  bindEach(body, STORE_MOUNT_BUY_ATTR, (id) => actions.buyStoreMount(id));
  bindEach(body, CHARTER_BUY_ATTR, (id) => actions.buyCharter(id));
}

/** One click handler per button carrying `attr`, handed the attribute's value
 *  ('' when the markup left it empty, so the action's own lookup decides). Read
 *  through `dataset`, the same view the painters and the window tests use. */
function bindEach(body: HTMLElement, attr: string, action: (id: string) => void): void {
  const key = datasetKey(attr);
  body.querySelectorAll<HTMLButtonElement>(`[${attr}]`).forEach((button) => {
    button.addEventListener('click', () => action(button.dataset[key] ?? ''));
  });
}

/** `data-store-mount-buy` reads back as `dataset.storeMountBuy`. */
function datasetKey(attr: string): string {
  return attr.replace(/^data-/, '').replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}
