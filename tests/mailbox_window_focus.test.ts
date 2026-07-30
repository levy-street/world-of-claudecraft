// @vitest-environment jsdom
//
// The mailbox parcel list's rebuild-refocus ladder, behaviorally.
//
// renderParcels is a full wipe of #mail-parcels, and a +/- click is what triggers it, so
// a keyboard player who pressed + had the button destroyed under them mid-adjustment.
// The window has carried focus across that wipe since #1444, but only through source
// pins in tests/mailbox_window.test.ts (that the focus keys are written at all), never
// behaviorally. #2528 moved the two mechanical halves of the idiom into
// src/ui/focus_restore.ts, and a source pin cannot tell whether that migration preserved
// the LADDER, which is the part the window still owns. So this drives the real
// MailboxWindow through the real stepper buttons, on the tests/mailbox_compose_preserved
// harness, and asserts where focus actually lands.
//
// The rungs, in the window's order: the same control, then the quantity input, then `-`,
// then `+`, then Remove. Only three of the five are REACHABLE, and the extraction is what
// made that visible rather than causing it (the old hand-rolled if/else chain had the same
// shape). `minus`, `plus` and `qty` are created together inside the one `if (owned > 1)`
// block in the painter, and `qty` is never disabled, so whenever the preferred control is
// skipped and a stepper exists at all, `qty` intercepts: `-` and `+` can only ever be
// reached AS the preferred control, never as a fallback. They stay in the array as the
// defensive rungs they were before. The cases below cover every rung that can actually
// win: the preferred one, `qty`, and Remove (only when the stepper vanishes between
// renders, which needs the owned count to drop under two).

import { afterEach, describe, expect, it } from 'vitest';
import type { InvSlot } from '../src/sim/types';
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

/**
 * A real MailboxWindow on the Send tab with `itemId` staged as a parcel.
 *
 * The returned `inventory` is the LIVE array the fake world reads, so a case can shrink
 * the owned count between renders. That is the only way to reach the Remove rung: the
 * painter drops the whole stepper once `owned <= 1`.
 */
function stagedParcel(
  itemId: string,
  owned: number,
): { root: HTMLElement; win: MailboxWindow; inventory: InvSlot[] } {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const inventory: InvSlot[] = [{ itemId, count: owned }];
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
  win.stageParcel(itemId);
  return { root, win, inventory };
}

const FANG = 'wolf_fang';
const control = <T extends HTMLElement>(root: HTMLElement, role: string): T =>
  root.querySelector<T>(`[data-focus-key="${FANG}:${role}"]`) as T;

/**
 * Force a parcel-list rebuild without touching focus, for the two cases that assert
 * focus does NOT move. `-` and not `+`: the parcel is staged at its owned ceiling, so
 * `+` comes back disabled and a disabled button dispatches no click at all, which would
 * make these two cases pass against any implementation (the rebuild would never run).
 */
function rebuildParcels(root: HTMLElement): void {
  const minus = control<HTMLButtonElement>(root, 'minus');
  expect(minus.disabled).toBe(false);
  const before = control<HTMLInputElement>(root, 'qty');
  minus.click();
  // Proof the wipe really happened: the qty input is a fresh node.
  expect(control<HTMLInputElement>(root, 'qty')).not.toBe(before);
}

describe('the mailbox parcel list carries keyboard focus across its own rebuild', () => {
  it('hands focus back to the rebuilt equivalent of the stepper that was pressed', () => {
    // Owned 4, staged at 4, so pressing `-` goes 4 -> 3 and `-` is still enabled on the
    // way back: the plain case, and the one that reds if the capture is dropped.
    const { root } = stagedParcel(FANG, 4);
    const minus = control<HTMLButtonElement>(root, 'minus');
    minus.focus();
    minus.click();
    const rebuilt = control<HTMLButtonElement>(root, 'minus');
    expect(rebuilt).not.toBe(minus); // really a fresh node, so this is a rebuild
    expect(rebuilt.disabled).toBe(false);
    expect(document.activeElement).toBe(rebuilt);
    expect(document.activeElement).not.toBe(document.body);
  });

  it('hands focus back to `+` too, not just `-`', () => {
    // The `plus` arm of the preferred-control resolution had no test anywhere: the only
    // `+` clicks in the suite were at a ceiling where the button is disabled and so
    // dispatches nothing. Mis-resolving this arm to Remove is silent AND destructive,
    // since the player's next Enter would delete the parcel, which is exactly what the
    // painter's own comment warns about. Step down to 2 of 4 first so `+` is live, and so
    // the rebuilt `+` comes back enabled (3 < 4) rather than degrading.
    const { root } = stagedParcel(FANG, 4);
    control<HTMLButtonElement>(root, 'minus').click();
    control<HTMLButtonElement>(root, 'minus').click();
    const plus = control<HTMLButtonElement>(root, 'plus');
    expect(plus.disabled).toBe(false);
    plus.focus();
    plus.click();
    const rebuilt = control<HTMLButtonElement>(root, 'plus');
    expect(rebuilt).not.toBe(plus);
    expect(rebuilt.disabled).toBe(false);
    expect(document.activeElement).toBe(rebuilt);
    expect(document.activeElement).not.toBe(control<HTMLButtonElement>(root, 'remove'));
  });

  it('degrades to the quantity input when the pressed stepper comes back DISABLED', () => {
    // Owned 2, staged at 2: pressing `-` drops the count to 1, which is the floor, so
    // the rebuilt `-` is disabled and cannot take focus. The qty input is the next rung
    // and the one that matters most: a number input fires `change` WITHOUT blurring, so
    // falling through to Remove instead would turn the player's next Enter into
    // deleting the parcel mid-adjustment.
    const { root } = stagedParcel(FANG, 2);
    control<HTMLButtonElement>(root, 'minus').focus();
    control<HTMLButtonElement>(root, 'minus').click();
    expect(control<HTMLButtonElement>(root, 'minus').disabled).toBe(true);
    expect(document.activeElement).toBe(control<HTMLInputElement>(root, 'qty'));
  });

  it('keeps the quantity input when the typed field had focus', () => {
    const { root } = stagedParcel(FANG, 4);
    const qty = control<HTMLInputElement>(root, 'qty');
    qty.focus();
    qty.value = '2';
    qty.dispatchEvent(new Event('change'));
    const rebuilt = control<HTMLInputElement>(root, 'qty');
    expect(rebuilt).not.toBe(qty);
    expect(rebuilt.value).toBe('2');
    expect(document.activeElement).toBe(rebuilt);
  });

  it('degrades to Remove when the whole stepper vanishes between renders', () => {
    // The last REACHABLE rung, and the case the painter's own comment names ("the
    // stepper dropped once owned <= 1") but nothing exercised. The player is standing on
    // `-` when their stock of the item drops under two, so the rebuild emits no stepper
    // at all: `-`, `+` and the qty input are all absent, not merely disabled, and Remove
    // is the only control left for that parcel. Driven through setParcelQty, which
    // repaints unconditionally, so the rebuild does not depend on the count changing.
    const { root, inventory } = stagedParcel(FANG, 4);
    const minus = control<HTMLButtonElement>(root, 'minus');
    minus.focus();
    inventory[0].count = 1;
    control<HTMLInputElement>(root, 'qty').dispatchEvent(new Event('change'));
    // The stepper really is gone, so this is the absent-rung path and not a disabled one.
    expect(control<HTMLButtonElement>(root, 'minus')).toBeNull();
    expect(control<HTMLInputElement>(root, 'qty')).toBeNull();
    const remove = control<HTMLButtonElement>(root, 'remove');
    expect(remove).not.toBeNull();
    expect(document.activeElement).toBe(remove);
  });

  it('takes focus from NOBODY when the player was not in the parcel list', () => {
    // The containment check, in the real window. Focus sits on the compose recipient
    // field, outside #mail-parcels; a parcel repaint must leave it there.
    const { root } = stagedParcel(FANG, 4);
    const to = root.querySelector<HTMLInputElement>('#mail-to') as HTMLInputElement;
    to.focus();
    rebuildParcels(root);
    expect(document.activeElement).toBe(to);
  });

  it('captures against the PARCEL LIST, not the whole mailbox window', () => {
    // The root argument is a contract, not a detail: renderParcels rebuilds only
    // #mail-parcels, so passing the window root would widen what gets captured to the
    // whole compose form, whose nodes this repaint does not touch. The case above
    // cannot see that (the recipient field carries no key, so both roots capture
    // nothing), so plant a keyed control inside the window and OUTSIDE the parcel list.
    // With the parcel list as the root this is not captured and focus stays put; with
    // the window root it is, and the repaint drags the player into a list they had
    // already left.
    const { root } = stagedParcel(FANG, 4);
    const elsewhere = document.createElement('button');
    elsewhere.dataset.focusKey = `${FANG}:plus`;
    root.appendChild(elsewhere);
    expect(root.querySelector('#mail-parcels')?.contains(elsewhere)).toBe(false);
    elsewhere.focus();
    rebuildParcels(root);
    // The rung the widened root would have resolved to really is available, so this is
    // a refusal to capture and not just an empty ladder.
    expect(control<HTMLButtonElement>(root, 'plus').disabled).toBe(false);
    expect(document.activeElement).toBe(elsewhere);
  });

  it('never reads a focus key off a control OUTSIDE the window', () => {
    // The shared namespace hazard the extraction is about: town_focus_window keys its
    // allocation steppers with the SAME data-focus-key attribute in the same
    // <id>:<role> shape. Plant one of those outside the mailbox, focus it, and repaint:
    // the parcel list must not pull focus into itself.
    const { root } = stagedParcel(FANG, 4);
    const outside = document.createElement('button');
    outside.dataset.focusKey = `${FANG}:plus`;
    document.body.appendChild(outside);
    outside.focus();
    rebuildParcels(root);
    // Same proof as the case above: the rung the key names is available, so this is a
    // refusal to capture rather than an empty ladder.
    expect(control<HTMLButtonElement>(root, 'plus').disabled).toBe(false);
    expect(document.activeElement).toBe(outside);
  });
});
