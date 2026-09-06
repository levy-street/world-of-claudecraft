// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import type { MaterialComposition } from '../src/sim/material_sources';
import type { InvSlot } from '../src/sim/types';
import { MailboxWindow, type MailboxWindowDeps } from '../src/ui/mailbox_window';
import type { MaterialSourcesDialogOptions } from '../src/ui/material_sources_dialog';
import type { IWorld } from '../src/world_api';

afterEach(() => {
  document.body.innerHTML = '';
});

function sourceCounts(sources: MaterialComposition | undefined): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { source, count } of sources ?? []) {
    const key = source.signer ?? source.gatherer?.name ?? '-';
    counts[key] = (counts[key] ?? 0) + count;
  }
  return counts;
}

function mount(
  inventory: InvSlot[],
  maxAttachments = 5,
): {
  root: HTMLElement;
  win: MailboxWindow;
  openedSources: MaterialSourcesDialogOptions[];
  sent: InvSlot[][];
} {
  const root = document.createElement('section');
  root.className = 'window';
  document.body.appendChild(root);
  const openedSources: MaterialSourcesDialogOptions[] = [];
  const sent: InvSlot[][] = [];
  const world = {
    inventory,
    copper: 1_000,
    player: { name: 'Sender' },
    mailInfo: {
      unread: 0,
      messages: [],
      postage: 30,
      maxAttachments,
      deliverySeconds: 60,
    },
    mailMarkRead: () => {},
    mailSend: (
      _to: string,
      _subject: string,
      _letter: string,
      _copper: number,
      attachments: InvSlot[],
    ) => sent.push(structuredClone(attachments)),
  } as unknown as IWorld;
  const noop = (): void => {};
  const deps: MailboxWindowDeps = {
    itemIcon: () => '<span class="item-icon"></span>',
    moneyHtml: () => '',
    itemTooltip: () => '',
    attachTooltip: noop,
    openMaterialSources: (options) => openedSources.push(options),
    root: () => root,
    world: () => world,
    closeOthers: noop,
    hideTooltip: noop,
    captureFocus: () => null,
    restoreFocus: noop,
    showError: noop,
    syncBags: noop,
  };
  const win = new MailboxWindow(deps);
  win.open();
  root.querySelector<HTMLElement>('[data-tab="send"]')?.click();
  return { root, win, openedSources, sent };
}

function openEverySourceAction(root: HTMLElement): void {
  for (const action of root.querySelectorAll<HTMLButtonElement>('.material-sources-action')) {
    action.click();
  }
}

describe('mailbox material source previews', () => {
  it('plans legacy needles sequentially before the remaining plain pool', () => {
    const inventory: InvSlot[] = [
      {
        itemId: 'copper_ore',
        count: 5,
        materialSources: [
          { source: {}, count: 3 },
          { source: { signer: 'Ana' }, count: 2 },
        ],
      },
    ];
    const { root, win, openedSources } = mount(inventory);

    win.stageParcel('copper_ore', { signer: 'Ana' });
    win.stageParcel('copper_ore', { signer: 'Ana' });
    win.stageParcel('copper_ore', { signer: 'Ana' });
    win.stageParcel('copper_ore');

    const chips = root.querySelectorAll('.mail-parcel-chip');
    expect(chips).toHaveLength(3);
    const qty = root.querySelector('.mail-parcel-qty-input') as HTMLInputElement;
    expect(qty.value).toBe('3');
    expect(qty.max).toBe('3');
    openEverySourceAction(root);
    expect(openedSources).toHaveLength(3);
    expect(sourceCounts(openedSources[0]?.sources)).toEqual({ Ana: 1 });
    expect(sourceCounts(openedSources[1]?.sources)).toEqual({ Ana: 1 });
    expect(sourceCounts(openedSources[2]?.sources)).toEqual({ '-': 3 });
    for (const preview of openedSources) expect(preview.onConfirm).toBeUndefined();
  });

  it('shows every contributor selected by one pooled plain request', () => {
    const inventory: InvSlot[] = [
      {
        itemId: 'copper_ore',
        count: 4,
        materialSources: [
          { source: {}, count: 1 },
          { source: { signer: 'Ana' }, count: 3 },
        ],
      },
    ];
    const { root, win, openedSources } = mount(inventory);

    win.stageParcel('copper_ore');
    root.querySelector<HTMLButtonElement>('.material-sources-action')?.click();

    expect(openedSources).toHaveLength(1);
    expect(sourceCounts(openedSources[0]?.sources)).toEqual({ '-': 1, Ana: 3 });
  });

  it('replans from live inventory without clearing the typed compose form', () => {
    const inventory: InvSlot[] = [
      {
        itemId: 'copper_ore',
        count: 2,
        materialSources: [{ source: { signer: 'Ana' }, count: 2 }],
      },
    ];
    const { root, win, openedSources } = mount(inventory);
    win.stageParcel('copper_ore');
    const recipient = root.querySelector('#mail-to') as HTMLInputElement;
    recipient.value = 'Mira';
    root.querySelector<HTMLButtonElement>('.material-sources-action')?.click();
    expect(sourceCounts(openedSources.at(-1)?.sources)).toEqual({ Ana: 2 });

    inventory.splice(0, 1, {
      itemId: 'copper_ore',
      count: 2,
      materialSources: [{ source: { signer: 'Bru' }, count: 2 }],
    });
    root.querySelector<HTMLButtonElement>('.material-sources-action')?.click();

    expect(sourceCounts(openedSources.at(-1)?.sources)).toEqual({ Bru: 2 });
    expect((root.querySelector('#mail-to') as HTMLInputElement).value).toBe('Mira');

    win.relocalize();
    expect((root.querySelector('#mail-to') as HTMLInputElement).value).toBe('Mira');
  });

  it('shows no source attribution when refreshed inventory cannot produce a valid plan', () => {
    const inventory: InvSlot[] = [
      {
        itemId: 'copper_ore',
        count: 2,
        materialSources: [{ source: { signer: 'Ana' }, count: 2 }],
      },
    ];
    const { root, win, openedSources } = mount(inventory);
    win.stageParcel('copper_ore');
    const sourceAction = root.querySelector<HTMLButtonElement>('.material-sources-action');
    sourceAction?.click();
    expect(openedSources).toHaveLength(1);

    inventory[0] = {
      itemId: 'copper_ore',
      count: 2,
      materialSources: [{ source: { signer: 'Ana' }, count: 1 }],
    };
    sourceAction?.click();
    expect(openedSources).toHaveLength(1);

    win.relocalize();
    expect(root.querySelector('.material-sources-action')).toBeNull();
  });

  it('keeps a non-material parcel and its count controls unchanged', () => {
    const { root, win } = mount([{ itemId: 'baked_bread', count: 4 }]);
    win.stageParcel('baked_bread');

    expect(root.querySelectorAll('.mail-parcel-chip')).toHaveLength(1);
    const qty = root.querySelector('.mail-parcel-qty-input') as HTMLInputElement;
    expect(qty.value).toBe('4');
    expect(qty.max).toBe('4');
    expect(root.querySelector('.material-sources-action')).toBeNull();
  });

  it('sends the original pool request without adding preview provenance', () => {
    const inventory: InvSlot[] = [
      {
        itemId: 'copper_ore',
        count: 2,
        materialSources: [{ source: { signer: 'Ana' }, count: 2 }],
      },
    ];
    const { root, win, sent } = mount(inventory);
    win.stageParcel('copper_ore');
    (root.querySelector('#mail-to') as HTMLInputElement).value = 'Mira';
    root.querySelector<HTMLButtonElement>('#mail-send-btn')?.click();

    expect(sent).toEqual([[{ itemId: 'copper_ore', count: 2 }]]);
  });
});
