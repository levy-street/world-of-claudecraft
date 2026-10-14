// The Skull Bag pane: the sub-inventory's view, docked inside the bags window
// under the grid. Clicking the Skull Bag item in the bags toggles it
// (bags_view.ts routes that click to 'openSkullBag'); the bags window mounts it
// on every rebuild and its slow-band refresh repaints it only when the view
// signature moves (a skull looted straight into the bag changes nothing in
// the bags themselves). Closing the bags closes the pane.
//
// Cold painter: no layout read, no driver of its own. Every DOM touch is
// createElement + textContent, so a victim's name never reaches innerHTML.
// The rows and the signature come from skull_bag_view.ts; the commands go
// through IWorld.skullBagAction, and the sim re-validates every one.

import type { IWorld } from '../../../world_api';
import { captureFocusKey, findFocusKey, restoreFirstEnabled } from '../../focus_restore';
import { formatNumber, t } from '../../i18n';
import { svgIcon } from '../../ui_icons';
import {
  type SkullBagPaneView,
  type SkullBagRowView,
  skullBagPaneView,
  skullBagTakeAction,
} from './skull_bag_view';

type SkullBagWorld = Pick<IWorld, 'worldPvpInfo' | 'inventory' | 'skullBagAction'>;

export interface SkullBagPaneDeps {
  world(): SkullBagWorld;
  /** Where keyboard focus lands when the player closes the pane with its own
   *  button (the removed button would otherwise drop focus to the page). */
  focusAfterClose?(): void;
}

function count(value: number): string {
  return formatNumber(value, { maximumFractionDigits: 0 });
}

function rowLabel(row: SkullBagRowView): string {
  return row.victim === null
    ? t('hudChrome.skullBag.unrecorded')
    : t('hudChrome.worldPvp.skullName', { name: row.victim });
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class SkullBagPaneController {
  private openState = false;
  private host: HTMLElement | null = null;
  private lastSignature: string | null = null;

  constructor(private readonly deps: SkullBagPaneDeps) {}

  get isOpen(): boolean {
    return this.openState;
  }

  /** The Skull Bag item's bag click: show the pane, or hide it when shown. */
  toggle(): void {
    this.openState = !this.openState;
  }

  /** Hide the pane (the bags window closed, or the pane's own close button). */
  close(): void {
    this.openState = false;
    this.host?.remove();
    this.host = null;
    this.lastSignature = null;
  }

  /** Called by the bags window's full rebuild: append the pane to `parent`
   *  when it is open and there is anything to show. */
  mount(parent: HTMLElement): void {
    this.host = null;
    this.lastSignature = null;
    if (!this.openState) return;
    const view = this.view();
    if (!view) {
      this.openState = false;
      return;
    }
    const host = el('section', 'skull-bag-pane');
    host.setAttribute('aria-label', t('hudChrome.skullBag.title'));
    parent.appendChild(host);
    this.host = host;
    this.paint(view);
  }

  /** The bags window's slow-band refresh: repaint in place only when the
   *  view changed, keeping keyboard focus on the same control. */
  refreshIfChanged(): void {
    const host = this.host;
    if (!this.openState || !host?.isConnected) return;
    const view = this.view();
    if (!view) {
      this.close();
      return;
    }
    if (view.signature === this.lastSignature) return;
    const focusKey = captureFocusKey(host);
    this.paint(view);
    // The exact control when it survived, else the next live control: a row
    // that emptied (or a bag that was banked) removes its buttons.
    if (focusKey !== null) {
      restoreFirstEnabled([
        findFocusKey(host, focusKey),
        findFocusKey(host, 'skull-bag-store'),
        findFocusKey(host, 'skull-bag-close'),
      ]);
    }
  }

  private view(): SkullBagPaneView | null {
    const world = this.deps.world();
    return skullBagPaneView(world.worldPvpInfo?.skullBag, world.inventory);
  }

  private paint(view: SkullBagPaneView): void {
    const host = this.host;
    if (!host) return;
    this.lastSignature = view.signature;
    host.textContent = '';
    const head = el('div', 'skull-bag-head');
    head.appendChild(el('span', 'skull-bag-title', t('hudChrome.skullBag.title')));
    head.appendChild(
      el('span', 'skull-bag-total', t('hudChrome.skullBag.total', { count: count(view.total) })),
    );
    const close = el('button', 'x-btn ui-x-btn');
    close.type = 'button';
    close.dataset.focusKey = 'skull-bag-close';
    close.setAttribute('aria-label', t('hudChrome.skullBag.close'));
    close.innerHTML = svgIcon('close');
    close.addEventListener('click', (ev) => {
      this.close();
      // Keyboard activation only (detail 0): parking focus on a button after a
      // mouse close would let the next Enter-to-chat press it (bags_window.ts
      // paintMoneyRow records the same hazard).
      if (ev.detail === 0) this.deps.focusAfterClose?.();
    });
    head.appendChild(close);
    host.appendChild(head);

    if (!view.owned) {
      host.appendChild(el('p', 'skull-bag-note', t('hudChrome.skullBag.notCarried')));
    } else if (view.rows.length === 0) {
      host.appendChild(el('p', 'skull-bag-note', t('hudChrome.skullBag.empty')));
    }
    if (view.rows.length > 0) {
      const list = el('ul', 'skull-bag-rows');
      // list-style: none drops the list role in WebKit; restore it.
      list.setAttribute('role', 'list');
      for (const row of view.rows) list.appendChild(this.rowElement(row, view.owned));
      host.appendChild(list);
    }
    if (view.owned) {
      const store = el(
        'button',
        'ui-btn skull-bag-store',
        view.carried > 0
          ? t('hudChrome.skullBag.store', { count: count(view.carried) })
          : t('hudChrome.skullBag.storeNone'),
      );
      store.type = 'button';
      store.dataset.focusKey = 'skull-bag-store';
      store.disabled = view.carried === 0;
      store.addEventListener('click', () => this.deps.world().skullBagAction({ op: 'store' }));
      host.appendChild(store);
    }
  }

  private rowElement(row: SkullBagRowView, owned: boolean): HTMLElement {
    const item = el('li', 'skull-bag-row');
    const label = rowLabel(row);
    item.appendChild(el('span', 'skull-bag-name', label));
    item.appendChild(
      el('span', 'skull-bag-count', t('itemUi.bags.stackCount', { count: count(row.count) })),
    );
    if (owned) {
      item.appendChild(this.takeButton(row, 1, label));
      if (row.count > 1) item.appendChild(this.takeButton(row, row.count, label));
    }
    return item;
  }

  private takeButton(row: SkullBagRowView, take: number, label: string): HTMLButtonElement {
    const all = take > 1;
    const button = el(
      'button',
      'ui-btn skull-bag-take',
      t(all ? 'hudChrome.skullBag.takeAll' : 'hudChrome.skullBag.takeOne'),
    );
    button.type = 'button';
    button.dataset.focusKey = `skull-bag-${all ? 'all' : 'one'}-${row.key}`;
    button.setAttribute(
      'aria-label',
      t(all ? 'hudChrome.skullBag.takeAllAria' : 'hudChrome.skullBag.takeOneAria', {
        item: label,
      }),
    );
    button.addEventListener('click', () =>
      this.deps.world().skullBagAction(skullBagTakeAction(row, take)),
    );
    return button;
  }
}
