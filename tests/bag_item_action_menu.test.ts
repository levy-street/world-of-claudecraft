import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BagItemActionMenu } from '../src/ui/bag_item_action_menu';

type Handler = (event: FakeEvent) => void;
class FakeEvent {
  constructor(
    readonly type: string,
    readonly target: FakeElement,
    readonly key = '',
  ) {}
  preventDefault(): void {}
  stopPropagation(): void {}
}

class FakeElement {
  children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  className = '';
  innerHTML = '';
  textContent = '';
  type = '';
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  listeners = new Map<string, Handler[]>();
  disabled = false;

  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  append(...children: FakeElement[]): void {
    for (const child of children) this.appendChild(child);
  }
  remove(): void {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
      this.parentElement = null;
    }
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  addEventListener(type: string, handler: Handler): void {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
  }
  dispatch(type: string, key = ''): void {
    for (const handler of this.listeners.get(type) ?? []) handler(new FakeEvent(type, this, key));
  }
  focus(): void {
    fakeDocument.activeElement = this;
  }
  querySelectorAll(selector: string): FakeElement[] {
    const out: FakeElement[] = [];
    const className = selector.startsWith('.') ? selector.slice(1) : '';
    const walk = (node: FakeElement): void => {
      for (const child of node.children) {
        if (className && child.className.split(' ').includes(className)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
}

const fakeDocument = {
  activeElement: null as FakeElement | null,
  createElement: () => new FakeElement(),
};

const el = (value: FakeElement): HTMLElement => value as unknown as HTMLElement;

beforeEach(() => {
  fakeDocument.activeElement = null;
  vi.stubGlobal('document', fakeDocument);
});
afterEach(() => vi.unstubAllGlobals());

describe('BagItemActionMenu', () => {
  it('notifies its owner when the player explicitly dismisses the menu', () => {
    const host = new FakeElement();
    const onDismiss = vi.fn();
    const menu = new BagItemActionMenu({
      showError: vi.fn(),
      restoreFocus: vi.fn(),
      onDismiss,
    });
    menu.open({
      host: el(host),
      itemId: 'elixir',
      itemName: 'Elixir',
      itemDetailsHtml: '<div class="tt-desc">Effect</div>',
      actions: [{ id: 'use' }],
      canAssignConsumable: false,
      layout: null,
      onAction: () => true,
      onAssign: () => false,
      onReset: () => false,
      opener: null,
    });

    host.querySelectorAll('.bag-item-action-close')[0].dispatch('click');

    expect(menu.isOpen).toBe(false);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('keeps the menu lifecycle active while dismiss restores the opener focus', () => {
    const host = new FakeElement();
    const opener = new FakeElement();
    let menu!: BagItemActionMenu;
    const restoreStates: boolean[] = [];
    menu = new BagItemActionMenu({
      showError: vi.fn(),
      restoreFocus: (target) => {
        expect(target).toBe(el(opener));
        restoreStates.push(menu.isOpen);
      },
      onDismiss: vi.fn(),
    });
    menu.open({
      host: el(host),
      itemId: 'elixir',
      itemName: 'Elixir',
      itemDetailsHtml: '<div class="tt-desc">Effect</div>',
      actions: [{ id: 'use' }],
      canAssignConsumable: false,
      layout: null,
      onAction: () => true,
      onAssign: () => false,
      onReset: () => false,
      opener: el(opener),
    });

    host.querySelectorAll('.bag-item-action-close')[0].dispatch('click');

    expect(restoreStates).toEqual([true]);
    expect(menu.isOpen).toBe(false);
  });

  it('reuses the shared confirmation-dialog chrome for its panel and actions', () => {
    const host = new FakeElement();
    const menu = new BagItemActionMenu({
      showError: vi.fn(),
      restoreFocus: vi.fn(),
      onDismiss: vi.fn(),
    });
    menu.open({
      host: el(host),
      itemId: 'sword',
      itemName: 'Sword',
      itemDetailsHtml: '<div class="tt-desc">A sharp sword.</div>',
      actions: [{ id: 'equip' }, { id: 'linkToChat' }, { id: 'destroy', destructive: true }],
      canAssignConsumable: false,
      layout: null,
      onAction: () => true,
      onAssign: () => false,
      onReset: () => false,
      opener: null,
    });

    expect(host.querySelectorAll('.panel')).toHaveLength(1);
    expect(host.querySelectorAll('.panel-title')).toHaveLength(1);
    expect(host.querySelectorAll('.x-btn')).toHaveLength(1);
    expect(host.querySelectorAll('.cd-actions')).toHaveLength(1);
    expect(host.querySelectorAll('.btn')).toHaveLength(3);
    expect(host.querySelectorAll('.cd-ok')).toEqual([host.querySelectorAll('.bag-item-action')[0]]);
  });

  it('opens without dispatching and focuses the first item action', () => {
    const host = new FakeElement();
    const dispatched: string[] = [];
    const menu = new BagItemActionMenu({
      showError: vi.fn(),
      restoreFocus: vi.fn(),
      onDismiss: vi.fn(),
    });
    menu.open({
      host: el(host),
      itemId: 'bread',
      itemName: 'Bread',
      itemDetailsHtml: '<div class="tt-desc">Restores health.</div>',
      actions: [{ id: 'consume' }, { id: 'linkToChat' }, { id: 'destroy', destructive: true }],
      canAssignConsumable: true,
      layout: null,
      onAction: (action) => {
        dispatched.push(action);
        return true;
      },
      onAssign: () => true,
      onReset: () => true,
      opener: null,
    });
    expect(dispatched).toEqual([]);
    const actions = host.querySelectorAll('.bag-item-action');
    expect(actions).toHaveLength(3);
    expect(fakeDocument.activeElement).toBe(actions[0]);
    expect(host.querySelectorAll('.bag-item-destination')).toHaveLength(6);
    expect(host.querySelectorAll('.bag-item-action-reset')).toHaveLength(0);
  });

  it('shows Reset only for custom mode and gives every destination an accessible name', () => {
    const host = new FakeElement();
    const menu = new BagItemActionMenu({
      showError: vi.fn(),
      restoreFocus: vi.fn(),
      onDismiss: vi.fn(),
    });
    menu.open({
      host: el(host),
      itemId: 'bread',
      itemName: 'Bread',
      itemDetailsHtml: '<div class="tt-desc">Restores health.</div>',
      actions: [{ id: 'consume' }],
      canAssignConsumable: true,
      layout: ['potion', 'bread', null, null, null, null],
      customLayout: true,
      itemNameForId: (id) => id,
      onAction: () => true,
      onAssign: () => true,
      onReset: () => true,
      opener: null,
    });
    expect(host.querySelectorAll('.bag-item-action-reset')).toHaveLength(1);
    for (const destination of host.querySelectorAll('.bag-item-destination')) {
      expect(destination.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('shows automatic assignments without exposing Reset', () => {
    const host = new FakeElement();
    const menu = new BagItemActionMenu({
      showError: vi.fn(),
      restoreFocus: vi.fn(),
      onDismiss: vi.fn(),
    });
    menu.open({
      host: el(host),
      itemId: 'bread',
      itemName: 'Bread',
      itemDetailsHtml: '<div class="tt-desc">Restores health.</div>',
      actions: [{ id: 'consume' }],
      canAssignConsumable: true,
      layout: ['potion', 'bread', null, null, null, null],
      customLayout: false,
      onAction: () => true,
      onAssign: () => true,
      onReset: () => true,
      opener: null,
    });
    expect(host.querySelectorAll('.bag-item-action-reset')).toHaveLength(0);
    expect(host.querySelectorAll('.bag-item-destination')[1].getAttribute('aria-label')).toContain(
      '2',
    );
  });

  it('keeps the menu open and reports feedback when an action fails', () => {
    const host = new FakeElement();
    const showError = vi.fn();
    const menu = new BagItemActionMenu({
      showError,
      restoreFocus: vi.fn(),
      onDismiss: vi.fn(),
    });
    menu.open({
      host: el(host),
      itemId: 'sword',
      itemName: 'Sword',
      itemDetailsHtml: '<div class="tt-desc">A sharp sword.</div>',
      actions: [{ id: 'equip' }],
      canAssignConsumable: false,
      layout: null,
      onAction: () => false,
      onAssign: () => false,
      onReset: () => false,
      opener: null,
    });
    host.querySelectorAll('.bag-item-action')[0].dispatch('click');
    expect(menu.isOpen).toBe(true);
    expect(showError).toHaveBeenCalledOnce();
  });

  it('closes successfully and restores focus to the originating row', () => {
    const host = new FakeElement();
    const opener = new FakeElement();
    const restoreFocus = vi.fn();
    const menu = new BagItemActionMenu({ showError: vi.fn(), restoreFocus, onDismiss: vi.fn() });
    menu.open({
      host: el(host),
      itemId: 'sword',
      itemName: 'Sword',
      itemDetailsHtml: '<div class="tt-desc">A sharp sword.</div>',
      actions: [{ id: 'equip' }],
      canAssignConsumable: false,
      layout: null,
      onAction: () => true,
      onAssign: () => false,
      onReset: () => false,
      opener: el(opener),
    });
    host.querySelectorAll('.bag-item-action')[0].dispatch('click');
    expect(menu.isOpen).toBe(false);
    expect(restoreFocus).toHaveBeenCalledWith(el(opener));
  });

  it('keeps the menu lifecycle active while focus returns to the originating row', () => {
    const host = new FakeElement();
    const opener = new FakeElement();
    let menu!: BagItemActionMenu;
    const openStateDuringRestore: boolean[] = [];
    menu = new BagItemActionMenu({
      showError: vi.fn(),
      restoreFocus: () => openStateDuringRestore.push(menu.isOpen),
      onDismiss: vi.fn(),
    });
    menu.open({
      host: el(host),
      itemId: 'sword',
      itemName: 'Sword',
      itemDetailsHtml: '<div class="tt-desc">A sharp sword.</div>',
      actions: [{ id: 'equip' }],
      canAssignConsumable: false,
      layout: null,
      onAction: () => true,
      onAssign: () => false,
      onReset: () => false,
      opener: el(opener),
    });

    host.querySelectorAll('.bag-item-action')[0].dispatch('click');

    expect(openStateDuringRestore).toEqual([true]);
    expect(menu.isOpen).toBe(false);
  });

  it('renders the trusted full item detail before the action controls', () => {
    const host = new FakeElement();
    const menu = new BagItemActionMenu({
      showError: vi.fn(),
      restoreFocus: vi.fn(),
      onDismiss: vi.fn(),
    });
    const itemDetailsHtml =
      '<div class="tt-title">Elixir</div><div class="tt-desc">Increases Stamina by 12.</div>';
    menu.open({
      host: el(host),
      itemId: 'elixir',
      itemName: 'Elixir',
      itemDetailsHtml,
      actions: [{ id: 'use' }, { id: 'linkToChat' }],
      canAssignConsumable: true,
      layout: null,
      onAction: () => true,
      onAssign: () => true,
      onReset: () => true,
      opener: null,
    });

    const details = host.querySelectorAll('.bag-item-action-details')[0];
    const detailPane = host.querySelectorAll('.bag-item-action-detail-pane')[0];
    const layout = host.querySelectorAll('.bag-item-action-layout')[0];
    const controls = host.querySelectorAll('.bag-item-action-controls')[0];
    expect(details.innerHTML).toBe(itemDetailsHtml);
    expect(details.getAttribute('role')).toBe('region');
    expect(details.getAttribute('aria-labelledby')).toBeTruthy();
    expect(layout.children.indexOf(detailPane)).toBeLessThan(layout.children.indexOf(controls));
  });

  it('successful Link to Chat closes without restoring focus over the composer', () => {
    const host = new FakeElement();
    const restoreFocus = vi.fn();
    const menu = new BagItemActionMenu({ showError: vi.fn(), restoreFocus, onDismiss: vi.fn() });
    menu.open({
      host: el(host),
      itemId: 'elixir',
      itemName: 'Elixir',
      itemDetailsHtml: '<div class="tt-desc">Effect</div>',
      actions: [{ id: 'linkToChat' }],
      canAssignConsumable: false,
      layout: null,
      onAction: () => true,
      onAssign: () => false,
      onReset: () => false,
      opener: el(new FakeElement()),
    });

    host.querySelectorAll('.bag-item-action')[0].dispatch('click');
    expect(menu.isOpen).toBe(false);
    expect(restoreFocus).not.toHaveBeenCalled();
  });

  it('failed Link to Chat stays open with focus on Link and localized feedback', () => {
    const host = new FakeElement();
    const showError = vi.fn();
    const restoreFocus = vi.fn();
    const menu = new BagItemActionMenu({ showError, restoreFocus, onDismiss: vi.fn() });
    menu.open({
      host: el(host),
      itemId: 'stale',
      itemName: 'Stale Item',
      itemDetailsHtml: '<div class="tt-desc">Effect</div>',
      actions: [{ id: 'linkToChat' }],
      canAssignConsumable: false,
      layout: null,
      onAction: () => false,
      onAssign: () => false,
      onReset: () => false,
      opener: el(new FakeElement()),
    });

    const link = host.querySelectorAll('.bag-item-action')[0];
    link.dispatch('click');
    expect(menu.isOpen).toBe(true);
    expect(fakeDocument.activeElement).toBe(link);
    expect(showError).toHaveBeenCalledOnce();
    expect(restoreFocus).not.toHaveBeenCalled();
  });
});
