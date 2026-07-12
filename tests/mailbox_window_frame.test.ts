// @vitest-environment jsdom
//
// Behavioral guards for the Ravenpost mailbox painter AFTER the AAA window-frame
// adoption (the send-tab glue + autocomplete stay in mailbox_window.test.ts /
// mailbox_view.test.ts). These render the real DOM through the shared window-frame
// builder and assert: the frame chrome is stamped on an inner mount (the root
// stays a pristine .window.panel), the titlebar is a Hud drag handle but the close
// is not, the inbox/send tabs still live in the scrolling body (behavior
// preserved), a tab switch flips the reader/send state and re-syncs the bags
// companion, the close control routes to close(), and a hostile player-mail sender
// name is escaped.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { MailboxWindow, type MailboxWindowDeps } from '../src/ui/mailbox_window';
import { isWindowDragHandle } from '../src/ui/window_drag_handle';
import type { IWorld, MailInfo } from '../src/world_api';

function mailInfo(over: Partial<MailInfo> = {}): MailInfo {
  return {
    messages: [],
    unread: 0,
    totalCount: 0,
    postage: 30,
    maxAttachments: 3,
    deliverySeconds: 3600,
    ...over,
  } as unknown as MailInfo;
}

function fakeWorld(info: MailInfo | null): IWorld {
  return {
    mailInfo: info,
    inventory: [],
    copper: 1000,
    player: { name: 'Hero' },
    mailMarkRead: vi.fn(),
    mailSend: vi.fn(),
    mailTake: vi.fn(),
    mailDelete: vi.fn(),
    searchCharacters: vi.fn(async () => []),
  } as unknown as IWorld;
}

function fakeDeps(overrides: Partial<MailboxWindowDeps> = {}): MailboxWindowDeps {
  const el = document.createElement('div');
  el.id = 'mailbox-window';
  el.className = 'window panel';
  document.body.appendChild(el);
  return {
    root: () => el,
    world: () => fakeWorld(mailInfo()),
    closeOthers: () => {},
    hideTooltip: () => {},
    captureFocus: () => null,
    restoreFocus: () => {},
    showError: () => {},
    syncBags: () => {},
    itemIcon: () => '<img class="item-icon" alt="">',
    moneyHtml: (copper: number) => `<span class="money-inline">${copper}</span>`,
    itemTooltip: () => '<div>tt</div>',
    attachTooltip: () => {},
    ...overrides,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
});

describe('MailboxWindow: frame adoption', () => {
  it('stamps the window-frame chrome on an INNER mount with titlebar, body, close', () => {
    const deps = fakeDeps();
    const w = new MailboxWindow(deps);
    w.open();
    const root = deps.root();
    expect(root.classList.contains('window-frame')).toBe(false);
    expect(root.hasAttribute('role')).toBe(false);
    const frame = root.querySelector<HTMLElement>(':scope > .window-frame');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('role')).toBe('dialog');
    expect(frame?.getAttribute('aria-labelledby')).toBe('mailbox-window-title');
    expect(frame?.querySelector('.window-titlebar')).not.toBeNull();
    expect(frame?.querySelector('.window-body')).not.toBeNull();
    expect(frame?.querySelector('[data-window-close]')).not.toBeNull();
    expect(root.style.display).toBe('flex');
  });

  it('keeps the inbox/send tabs inside the scrolling body (behavior preserved)', () => {
    const deps = fakeDeps();
    const w = new MailboxWindow(deps);
    w.open();
    const tabs = deps.root().querySelectorAll('.window-body .mail-tabs [data-tab]');
    expect(tabs.length).toBe(2);
    expect(deps.root().querySelector('.window-body #mailbox-body')).not.toBeNull();
  });

  it('reuses the frame on a re-open instead of rebuilding it cold', () => {
    const deps = fakeDeps();
    const w = new MailboxWindow(deps);
    w.open();
    const firstBody = deps.root().querySelector('.window-body');
    w.close();
    w.open();
    expect(deps.root().querySelector('.window-body')).toBe(firstBody);
    expect(deps.root().querySelectorAll('.window-titlebar').length).toBe(1);
  });
});

describe('MailboxWindow: move / resize / fit parity', () => {
  it('makes the titlebar a Hud drag handle, but never the close control', () => {
    const deps = fakeDeps();
    const w = new MailboxWindow(deps);
    w.open();
    const root = deps.root();
    const titlebar = root.querySelector<HTMLElement>('.window-titlebar') as HTMLElement;
    const closeBtn = root.querySelector<HTMLElement>('[data-window-close]') as HTMLElement;
    expect(isWindowDragHandle(titlebar, root)).toBe(true);
    expect(isWindowDragHandle(closeBtn, root)).toBe(false);
  });

  it('frames a bounded flex column: titlebar then a scrollable body', () => {
    const deps = fakeDeps();
    const w = new MailboxWindow(deps);
    w.open();
    const frame = deps.root().querySelector<HTMLElement>(':scope > .window-frame');
    const order = Array.from(frame?.children ?? []).map((c) => (c as HTMLElement).className);
    expect(order[0]).toBe('window-titlebar');
    expect(order).toContain('window-body');
  });
});

describe('MailboxWindow: tab switch + callbacks', () => {
  it('switching to Send shows the send form and re-syncs the bags companion', () => {
    const syncBags = vi.fn();
    const deps = fakeDeps({ syncBags, world: () => fakeWorld(mailInfo()) });
    const w = new MailboxWindow(deps);
    w.open();
    expect(w.isSendTab).toBe(false);
    const sendTab = deps.root().querySelector<HTMLElement>('[data-tab="send"]') as HTMLElement;
    sendTab.click();
    expect(w.isSendTab).toBe(true);
    expect(deps.root().querySelector('.mail-send-form')).not.toBeNull();
    // syncBags(true) fires as the Send tab opens (parcels ride alongside).
    expect(syncBags).toHaveBeenCalledWith(true);
  });

  it('routes the frame close control to close(): hidden + focus restored', () => {
    const restoreFocus = vi.fn();
    const deps = fakeDeps({ restoreFocus });
    const w = new MailboxWindow(deps);
    w.open();
    expect(w.isOpen).toBe(true);
    deps.root().querySelector<HTMLElement>('[data-window-close]')?.click();
    expect(w.isOpen).toBe(false);
    expect(deps.root().style.display).toBe('none');
    expect(restoreFocus).toHaveBeenCalled();
  });
});

describe('MailboxWindow: reader attachments use the .item-cell grammar', () => {
  it('renders an attachment as .item-cell with a rarity border, count corner, and a working take flow', () => {
    const item = Object.values(ITEMS)[0];
    const info = mailInfo({
      unread: 0,
      totalCount: 1,
      messages: [
        {
          id: 7,
          read: true,
          copper: 0,
          items: [{ itemId: item.id, count: 5 }],
          kind: 'player',
          letterId: null,
          senderName: 'Bob',
          subject: 'loot',
          body: 'here you go',
        },
      ],
    } as unknown as Partial<MailInfo>);
    const world = fakeWorld(info);
    const deps = fakeDeps({ world: () => world });
    const w = new MailboxWindow(deps);
    w.open();
    // Read flow: clicking the row opens the reader (unchanged).
    (deps.root().querySelector('.mail-row') as HTMLElement).click();
    const cell = deps.root().querySelector<HTMLElement>('.mail-attachments .item-cell');
    expect(cell).not.toBeNull();
    expect(cell?.getAttribute('data-quality')).toBe(item.quality ?? 'common');
    // The stack count sits in the cell corner (the vendor precedent), not an xN suffix.
    expect(cell?.querySelector('.item-cell-count')?.textContent).toBe('5');
    // Take flow byte-identical: the take action still routes IWorld.mailTake(id).
    (deps.root().querySelector('#mail-actions .mail-action-btn') as HTMLElement).click();
    expect(world.mailTake).toHaveBeenCalledWith(7);
  });
});

describe('MailboxWindow: hostile-string escaping', () => {
  it('escapes an injected player-mail sender name through esc() (no live img)', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const info = mailInfo({
      unread: 1,
      totalCount: 1,
      messages: [
        {
          id: 1,
          read: false,
          copper: 0,
          items: [],
          kind: 'player',
          letterId: null,
          senderName: hostile,
          subject: 'hi',
          body: 'body',
        },
      ],
    } as unknown as Partial<MailInfo>);
    const deps = fakeDeps({ world: () => fakeWorld(info) });
    const w = new MailboxWindow(deps);
    w.open();
    const list = deps.root().querySelector('.mail-list') as HTMLElement;
    expect(list).not.toBeNull();
    expect(list.querySelector('img')).toBeNull();
    expect(list.innerHTML).toContain('&lt;img');
  });
});
