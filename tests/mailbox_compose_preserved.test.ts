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
