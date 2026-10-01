// @vitest-environment happy-dom

// The Item history prompt (src/ui/item_history_dialog.ts): mounts in the
// shared #prompt-stack, renders the history rows with no item ID anywhere,
// closes on Escape and on its close buttons, and never dismisses another
// window's prompt.
import { afterEach, describe, expect, it } from 'vitest';
import type { ItemProvenance } from '../src/sim/types';
import {
  closeItemHistoryDialog,
  closeItemHistoryDialogForOwner,
  ItemHistoryDialog,
  openItemHistoryDialog,
} from '../src/ui/item_history_dialog';

const GUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const provenance: ItemProvenance = {
  at: Date.UTC(2026, 8, 30),
  by: 'Alice',
  byId: 101,
  source: 'mob:forest_wolf',
  owners: [{ at: Date.UTC(2026, 9, 1), by: 'Bob', byId: 202 }],
  transfers: 1,
};

function mount(): { opener: HTMLButtonElement; window: HTMLElement } {
  document.body.innerHTML =
    '<div id="prompt-stack"></div><section class="window" id="bags"><button id="opener">Item</button></section>';
  const opener = document.getElementById('opener') as HTMLButtonElement;
  return { opener, window: opener.closest('.window') as HTMLElement };
}

afterEach(() => {
  closeItemHistoryDialog(false);
  document.body.innerHTML = '';
});

describe('item history prompt', () => {
  it('renders the origin and each hand, with no item ID in the markup', () => {
    const { opener } = mount();
    openItemHistoryDialog({ itemName: 'Duskforged Warblade', provenance, opener });
    const root = document.getElementById('item-history-dialog') as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.closest('#prompt-stack')).not.toBeNull();
    expect(root.textContent).toContain('Duskforged Warblade: history');
    expect(root.textContent).toContain('Looted by Alice on ');
    expect(root.textContent).toContain('Passed to Bob on ');
    expect(root.innerHTML).not.toContain(GUID);
    expect(root.innerHTML).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/);
    expect(root.querySelectorAll('.item-history-row')).toHaveLength(2);
  });

  it('sets the opener window inert and clears it on Escape', () => {
    const { opener, window: bags } = mount();
    const dialog = new ItemHistoryDialog();
    dialog.open({ itemName: 'Warblade', provenance, opener });
    expect(dialog.isOpen()).toBe(true);
    expect(bags.inert).toBe(true);
    const root = document.getElementById('item-history-dialog') as HTMLElement;
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dialog.isOpen()).toBe(false);
    expect(document.getElementById('item-history-dialog')).toBeNull();
    expect(bags.inert).toBe(false);
  });

  it('closes through its close button and only for its own owner window', () => {
    const { opener, window: bags } = mount();
    openItemHistoryDialog({ itemName: 'Warblade', provenance, opener });
    const other = document.createElement('section');
    expect(closeItemHistoryDialogForOwner(other)).toBe(false);
    expect(document.getElementById('item-history-dialog')).not.toBeNull();
    expect(closeItemHistoryDialogForOwner(bags)).toBe(true);
    expect(document.getElementById('item-history-dialog')).toBeNull();

    openItemHistoryDialog({ itemName: 'Warblade', provenance, opener });
    const close = document.querySelector<HTMLButtonElement>('[data-item-history-close]');
    expect(close).not.toBeNull();
    close?.click();
    expect(document.getElementById('item-history-dialog')).toBeNull();
  });

  it('does nothing without a prompt stack or a window opener', () => {
    document.body.innerHTML = '<button id="lonely">Item</button>';
    openItemHistoryDialog({
      itemName: 'Warblade',
      provenance,
      opener: document.getElementById('lonely'),
    });
    expect(document.getElementById('item-history-dialog')).toBeNull();
  });
});
