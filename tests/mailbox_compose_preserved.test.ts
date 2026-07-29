// @vitest-environment jsdom
// Staging a parcel must not clear the compose form. The bug: stageParcel (the
// bags-window click that attaches an item) ran the FULL window render, and
// renderSend rebuilds the whole form via innerHTML with empty inputs, so the
// typed recipient, subject, body, and coin amounts were all wiped the moment a
// player attached an item. The fix routes stageParcel through the targeted
// renderParcels repaint the +/- quantity stepper already uses (#1695), which
// only rebuilds the parcels row. Drives the REAL MailboxWindow against a jsdom
// container (the bags_window_instance_marker idiom), through the real send-tab
// button and the real stageParcel entry the bags window calls.
import { afterEach, describe, expect, it } from 'vitest';
import type { InvSlot } from '../src/sim/types';
import { MailboxWindow, type MailboxWindowDeps } from '../src/ui/mailbox_window';
import type { IWorld } from '../src/world_api';

// Each test mounts its own window root; drop it so duplicate element ids from
// a prior test's still-open window can never satisfy (or shadow) a lookup.
afterEach(() => {
  document.body.innerHTML = '';
});

function fakeWorld(inventory: InvSlot[]): IWorld {
  return {
    inventory,
    mailInfo: {
      unread: 0,
      messages: [],
      postage: 30,
      maxAttachments: 3,
      deliverySeconds: 60,
    },
    mailMarkRead: () => {},
  } as unknown as IWorld;
}

function openSendTab(inventory: InvSlot[]): { win: MailboxWindow; root: HTMLElement } {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const noop = (): void => {};
  const deps: MailboxWindowDeps = {
    itemIcon: () => '<span class="item-icon"></span>',
    moneyHtml: () => '',
    itemTooltip: () => '',
    attachTooltip: noop,
    root: () => root,
    world: () => fakeWorld(inventory),
    closeOthers: noop,
    hideTooltip: noop,
    captureFocus: () => null,
    restoreFocus: noop,
    showError: noop,
    syncBags: noop,
  };
  const win = new MailboxWindow(deps);
  win.open();
  (root.querySelector('[data-tab="send"]') as HTMLElement).click();
  return { win, root };
}

const WOLF_FANG: InvSlot = { itemId: 'wolf_fang', count: 4 };

describe('mailbox: staging a parcel preserves the typed compose form', () => {
  it('keeps the recipient, subject, body, and coin inputs when an item is attached', () => {
    const { win, root } = openSendTab([WOLF_FANG]);
    const field = <T extends HTMLInputElement | HTMLTextAreaElement>(id: string) =>
      root.querySelector<T>(`#${id}`) as T;
    field<HTMLInputElement>('mail-to').value = 'Mira';
    field<HTMLInputElement>('mail-subject').value = 'For you';
    field<HTMLTextAreaElement>('mail-body').value = 'A fang from the hunt.';
    field<HTMLInputElement>('mail-g').value = '2';

    win.stageParcel('wolf_fang');

    // The parcel chip landed...
    expect(
      root.querySelector('.mail-attachment-item, .mail-parcel-chip, #mail-parcels *'),
    ).not.toBeNull();
    // ...and every typed input survived the attach.
    expect(field<HTMLInputElement>('mail-to').value).toBe('Mira');
    expect(field<HTMLInputElement>('mail-subject').value).toBe('For you');
    expect(field<HTMLTextAreaElement>('mail-body').value).toBe('A fang from the hunt.');
    expect(field<HTMLInputElement>('mail-g').value).toBe('2');
  });

  it('still preserves the form when the SECOND parcel is staged (chips already present)', () => {
    const { win, root } = openSendTab([WOLF_FANG, { itemId: 'linen_scrap', count: 2 }]);
    const to = root.querySelector<HTMLInputElement>('#mail-to') as HTMLInputElement;
    to.value = 'Mira';
    win.stageParcel('wolf_fang');
    win.stageParcel('linen_scrap');
    expect(to.isConnected).toBe(true);
    expect(to.value).toBe('Mira');
  });
});

describe('mailbox: the typeable parcel quantity field', () => {
  function qtyInput(root: HTMLElement): HTMLInputElement {
    return root.querySelector('.mail-parcel-qty-input') as HTMLInputElement;
  }
  function typeQty(root: HTMLElement, value: string): void {
    const input = qtyInput(root);
    input.value = value;
    input.dispatchEvent(new Event('change'));
  }

  it('commits a typed quantity through the real change event', () => {
    const { win, root } = openSendTab([WOLF_FANG]);
    win.stageParcel('wolf_fang');
    typeQty(root, '3');
    // the repaint normalizes the field to the committed value
    expect(qtyInput(root).value).toBe('3');
  });

  it('clamps over-stock and floor-and-clamps junk to the legal 1..owned range', () => {
    const { win, root } = openSendTab([WOLF_FANG]); // owns 4
    win.stageParcel('wolf_fang');
    typeQty(root, '999');
    expect(qtyInput(root).value).toBe('4');
    typeQty(root, '0');
    expect(qtyInput(root).value).toBe('1');
  });

  it('restores the staged count for garbage input instead of accepting it', () => {
    const { win, root } = openSendTab([WOLF_FANG]);
    win.stageParcel('wolf_fang');
    typeQty(root, '3');
    typeQty(root, '');
    expect(qtyInput(root).value).toBe('3');
  });

  it('preserves the typed compose form across a quantity commit (same contract as attach)', () => {
    const { win, root } = openSendTab([WOLF_FANG]);
    const to = root.querySelector('#mail-to') as HTMLInputElement;
    to.value = 'Mira';
    win.stageParcel('wolf_fang');
    typeQty(root, '2');
    expect((root.querySelector('#mail-to') as HTMLInputElement).value).toBe('Mira');
  });

  it('restores focus to the qty input after an arrow-key change, never the Remove button', () => {
    // A number input's arrow keys fire `change` WITHOUT blurring, so the
    // repaint runs while the input is focused. Before the fix the restore
    // switch knew only minus/plus/remove, fell through to Remove, and the
    // player's next Enter/Space removed the parcel mid-adjustment.
    const { win, root } = openSendTab([WOLF_FANG]);
    win.stageParcel('wolf_fang');
    const input = qtyInput(root);
    input.focus();
    expect(document.activeElement).toBe(input);
    input.value = '2';
    input.dispatchEvent(new Event('change'));
    const restored = document.activeElement as HTMLElement;
    expect(restored.className).toBe('mail-parcel-qty-input');
    expect(restored.className).not.toContain('remove');
  });

  it('keeps the +/- steppers working alongside the input', () => {
    const { win, root } = openSendTab([WOLF_FANG]);
    win.stageParcel('wolf_fang');
    typeQty(root, '2');
    (root.querySelectorAll('.mail-parcel-step')[1] as HTMLButtonElement).click(); // plus
    expect(qtyInput(root).value).toBe('3');
  });
});
