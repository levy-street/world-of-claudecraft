// @vitest-environment happy-dom
//
// Mergeable instanced attachments stack in the mailbox compose window the
// same way they stack in bags (issue: "new potions don't stack in mail").
// A rare-quality crafted consumable (Sunpetal Healing Draught and its kin)
// mints a SIGNED instanced payload (#1149) whose only field is the crafter's
// signature, so byte-equal copies already merge into one bag slot
// (item_instance_merge.ts isMergeableInstancePayload). Before this fix the
// mailbox compose window still staged every click as its own single-copy
// slot (mail/post_office.ts's own #1165 "single-copy by design" rule),
// burning one of the letter's MAIL_MAX_ATTACHMENTS(=3) slots per potion.
// Drives the REAL MailboxWindow the way tests/mailbox_compose_preserved.test.ts
// does, through the real stageParcel entry the bags window calls.
import { afterEach, describe, expect, it } from 'vitest';
import type { InvSlot, ItemInstancePayload } from '../src/sim/types';
import { MailboxWindow, type MailboxWindowDeps } from '../src/ui/mailbox_window';
import type { IWorld } from '../src/world_api';

afterEach(() => {
  document.body.innerHTML = '';
});

function fakeWorld(inventory: InvSlot[]): IWorld {
  return {
    inventory,
    mailInfo: { unread: 0, messages: [], postage: 30, maxAttachments: 3, deliverySeconds: 60 },
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

// A non-material, rare-quality crafted potion's real shape (#1149): the only
// payload field is the crafter's own name.
const SIGNED_POTION: ItemInstancePayload = { signer: 'Mira' };

function chips(root: HTMLElement): NodeListOf<Element> {
  return root.querySelectorAll('.mail-parcel-chip');
}

describe("mailbox compose: mergeable instanced attachments stack (issue: potions don't stack in mail)", () => {
  it('stages the WHOLE owned stock of a signed potion as one slot, not one slot per copy', () => {
    const inventory: InvSlot[] = [
      { itemId: 'sunpetal_healing_draught', count: 5, instance: SIGNED_POTION },
    ];
    const { win, root } = openSendTab(inventory);

    win.stageParcel('sunpetal_healing_draught', SIGNED_POTION);

    expect(chips(root)).toHaveLength(1);
    const qty = root.querySelector<HTMLInputElement>('.mail-parcel-qty-input');
    expect(qty?.value).toBe('5');
  });

  it('a re-click on the same staged potion is a no-op (still one slot, not a second)', () => {
    const inventory: InvSlot[] = [
      { itemId: 'sunpetal_healing_draught', count: 5, instance: SIGNED_POTION },
    ];
    const { win, root } = openSendTab(inventory);

    win.stageParcel('sunpetal_healing_draught', SIGNED_POTION);
    win.stageParcel('sunpetal_healing_draught', SIGNED_POTION);

    expect(chips(root)).toHaveLength(1);
    expect(root.querySelector<HTMLInputElement>('.mail-parcel-qty-input')?.value).toBe('5');
  });

  it('the +/- stepper adjusts a staged potion stack, clamped to owned stock', () => {
    // renderParcels wipes and rebuilds #mail-parcels on every commit (the
    // #1444 stepper contract), so re-query the live node after each change
    // rather than reusing a now-detached reference (mailbox_compose_preserved
    // .test.ts's qtyInput() helper does the same).
    const qtyInput = () => root.querySelector<HTMLInputElement>('.mail-parcel-qty-input');
    const inventory: InvSlot[] = [
      { itemId: 'sunpetal_healing_draught', count: 5, instance: SIGNED_POTION },
    ];
    const { win, root } = openSendTab(inventory);
    win.stageParcel('sunpetal_healing_draught', SIGNED_POTION);

    const minus = root.querySelectorAll('.mail-parcel-step')[0] as HTMLButtonElement;
    minus.click();
    expect(qtyInput()?.value).toBe('4');

    const q = qtyInput()!;
    q.value = '999';
    q.dispatchEvent(new Event('change'));
    expect(qtyInput()?.value).toBe('5');
  });

  it('a THIRD unrelated item type can still be attached alongside one bundled potion slot', () => {
    // Before the fix a mere 3 potions alone could exhaust every attachment
    // slot; now one slot carries all of them, leaving room for other goods.
    const inventory: InvSlot[] = [
      { itemId: 'sunpetal_healing_draught', count: 5, instance: SIGNED_POTION },
      { itemId: 'wolf_fang', count: 2 },
      { itemId: 'linen_scrap', count: 2 },
    ];
    const { win, root } = openSendTab(inventory);

    win.stageParcel('sunpetal_healing_draught', SIGNED_POTION);
    win.stageParcel('wolf_fang');
    win.stageParcel('linen_scrap');

    expect(chips(root)).toHaveLength(3);
  });

  it('a non-mergeable, charge-bearing instanced copy still stages one-per-click, no stepper', () => {
    // charges is the structural exclusion from merging (item_instance_merge.ts
    // isMergeableInstancePayload): a counted stack shares one payload object,
    // and charges mutate in place per-unit, so it stays one-per-slot even
    // when two copies happen to be byte-equal (unlike a bare masterwork/
    // enchant/signed payload, which merges whenever its rolled stats match).
    const charged: ItemInstancePayload = { signer: 'Mira', charges: { zap: 2 } };
    const inventory: InvSlot[] = [
      { itemId: 'oiled_boots', count: 1, instance: charged },
      { itemId: 'oiled_boots', count: 1, instance: charged },
    ];
    const { win, root } = openSendTab(inventory);

    win.stageParcel('oiled_boots', charged);
    win.stageParcel('oiled_boots', charged);

    // Two byte-equal but non-mergeable copies stage as TWO single-copy slots
    // (the pre-existing #1165 behavior, unchanged), and neither grows a
    // quantity stepper.
    expect(chips(root)).toHaveLength(2);
    expect(root.querySelector('.mail-parcel-qty-input')).toBeNull();
  });

  it('a locked instanced copy also stays one-per-slot with no stepper', () => {
    const locked: ItemInstancePayload = { signer: 'Mira', locked: true };
    const { win, root } = openSendTab([
      { itemId: 'sunpetal_healing_draught', count: 1, instance: locked },
    ]);

    win.stageParcel('sunpetal_healing_draught', locked);

    expect(chips(root)).toHaveLength(1);
    expect(root.querySelector('.mail-parcel-qty-input')).toBeNull();
  });
});
