// @vitest-environment happy-dom
//
// The WOC Store body's button wiring (src/ui/store_body_actions.ts), split out
// of the window's paintStore. A real DOM because the whole module IS the DOM
// binding: each arm paints a body with the attributes the pure card views emit
// and proves a click reaches the right action with the right id, and that a
// body without a family's buttons binds nothing for it.

import { describe, expect, it, vi } from 'vitest';
import {
  ARMORY_SKIN_ATTR,
  bindStoreBodyActions,
  CHARTER_BUY_ATTR,
  STORE_BUY_CLAUDIUM_SELECTOR,
  type StoreBodyActions,
} from '../src/ui/store_body_actions';
import { STORE_MOUNT_BUY_ATTR } from '../src/ui/store_mount_card_view';

function actions(): { [K in keyof StoreBodyActions]: ReturnType<typeof vi.fn> } {
  return {
    buyClaudium: vi.fn(),
    inspectArmorySkin: vi.fn(),
    buyStoreMount: vi.fn(),
    buyCharter: vi.fn(),
  };
}

function body(html: string): HTMLElement {
  document.body.innerHTML = `<div class="dr-body">${html}</div>`;
  return document.querySelector<HTMLElement>('.dr-body') as HTMLElement;
}

function click(selector: string): void {
  const button = document.querySelector<HTMLButtonElement>(selector);
  if (!button) throw new Error(`no button for ${selector}`);
  button.click();
}

describe('bindStoreBodyActions', () => {
  it('routes each family of button to its action with the id off the attribute', () => {
    const a = actions();
    bindStoreBodyActions(
      body(
        `<button type="button" data-buy-claudium>top up</button>` +
          `<button type="button" ${ARMORY_SKIN_ATTR}="guildmark_arming_sword">skin</button>` +
          `<button type="button" ${STORE_MOUNT_BUY_ATTR}="reins_mech_bird">mount</button>` +
          `<button type="button" ${CHARTER_BUY_ATTR}="storage_charter_small">charter</button>`,
      ),
      a as unknown as StoreBodyActions,
    );
    click(STORE_BUY_CLAUDIUM_SELECTOR);
    click(`[${ARMORY_SKIN_ATTR}]`);
    click(`[${STORE_MOUNT_BUY_ATTR}]`);
    click(`[${CHARTER_BUY_ATTR}]`);
    expect(a.buyClaudium).toHaveBeenCalledTimes(1);
    expect(a.inspectArmorySkin).toHaveBeenCalledWith('guildmark_arming_sword');
    expect(a.buyStoreMount).toHaveBeenCalledWith('reins_mech_bird');
    expect(a.buyCharter).toHaveBeenCalledWith('storage_charter_small');
  });

  it('binds every button of a family, each with its own id', () => {
    const a = actions();
    bindStoreBodyActions(
      body(
        `<button type="button" id="m1" ${STORE_MOUNT_BUY_ATTR}="reins_a">a</button>` +
          `<button type="button" id="m2" ${STORE_MOUNT_BUY_ATTR}="reins_b">b</button>`,
      ),
      a as unknown as StoreBodyActions,
    );
    click('#m2');
    click('#m1');
    expect(a.buyStoreMount.mock.calls).toEqual([['reins_b'], ['reins_a']]);
  });

  it('passes an empty id for an attribute the markup left empty, and binds nothing absent', () => {
    const a = actions();
    bindStoreBodyActions(
      body(`<button type="button" ${CHARTER_BUY_ATTR}>x</button>`),
      a as unknown as StoreBodyActions,
    );
    click(`[${CHARTER_BUY_ATTR}]`);
    expect(a.buyCharter).toHaveBeenCalledWith('');
    expect(a.buyClaudium).not.toHaveBeenCalled();
    expect(a.inspectArmorySkin).not.toHaveBeenCalled();
    expect(a.buyStoreMount).not.toHaveBeenCalled();
  });
});
