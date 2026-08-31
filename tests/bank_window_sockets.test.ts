// @vitest-environment jsdom
// Drives the REAL BankWindow's bag-socket row (Bank Storage phase 07) against
// a world double, at the altitude tests/bank_window.test.ts (source pins) and
// tests/bank_view.test.ts (the pure cell model) cannot reach: the rendered
// cells, the clicks that dispatch the IWorld socket verbs (the row is
// bankUnsocketBag's and bankUnlockSocket's REAL player caller), the unlock
// confirm prompt, and the repaint signature's socket terms (an unlock at the
// banker moves ONLY socketsUnlocked and nextSocketCost, so without the terms
// the row sits stale until unrelated bank data happens to move).
import { describe, expect, it, vi } from 'vitest';
import { BankWindow, type BankWindowDeps } from '../src/ui/bank_window';
import type { BankInfo, IWorld } from '../src/world_api';

// Real catalog ids so the row reads real bag facts: linen_pouch is a 6-slot
// general bag, burlap_reagent_pouch an 8-slot materials-only satchel
// (src/sim/content/items.ts); their slot counts ride the aria label.
const GENERAL_BAG = 'linen_pouch';
const SATCHEL = 'burlap_reagent_pouch';

function bankInfo(over: Partial<BankInfo> = {}): BankInfo {
  return {
    slots: [],
    capacity: 24,
    purchasedSlots: 0,
    bonusSlots: 0,
    nextExpansionCost: 500,
    bonusSources: [],
    socketsUnlocked: 0,
    socketBags: [null, null, null, null],
    nextSocketCost: 1000000,
    generalCapacity: 24,
    materialsCapacity: 0,
    generalUsed: 0,
    materialsUsed: 0,
    ...over,
  };
}

interface Harness {
  window: BankWindow;
  root: HTMLElement;
  world: { bankInfo: BankInfo | null };
  calls: string[];
  /** Every attachTooltip call, in mount order: the phase 08 meter arms read
   *  the lazily built html off the recorded builder. */
  tooltips: { el: HTMLElement; html: () => string }[];
}

function harness(info: BankInfo, opts: { peekOnce?: boolean } = {}): Harness {
  // peekOnce arms ONE long-press peek: the first consumePeek() call returns
  // true and disarms, exactly the hud.ts peek-guard contract (the peek is
  // consumed by the release click it belongs to, never a later one).
  const peek = { armed: opts.peekOnce === true };
  document.body.innerHTML = '<div id="prompt-stack"></div>';
  const root = document.createElement('div');
  root.id = 'bank-window';
  document.body.appendChild(root);
  const calls: string[] = [];
  const world = {
    bankInfo: info,
    guildBankInfo: null,
    vaultInfo: null,
    inventory: [],
    bags: [null, null, null, null],
    copper: 100_000_000,
    bankDeposit: (...a: unknown[]) => calls.push(`bankDeposit:${a.join(',')}`),
    bankWithdraw: (...a: unknown[]) => calls.push(`bankWithdraw:${a.join(',')}`),
    bankBuySlots: () => calls.push('bankBuySlots'),
    bankUnlockSocket: () => calls.push('bankUnlockSocket'),
    bankSocketBag: (...a: unknown[]) => calls.push(`bankSocketBag:${a.join(',')}`),
    bankUnsocketBag: (socket: number) => calls.push(`bankUnsocketBag:${socket}`),
  };
  const noop = (): void => {};
  const tooltips: Harness['tooltips'] = [];
  const deps: BankWindowDeps = {
    itemIcon: () => '<span class="item-icon"></span>',
    moneyHtml: (c: number) => `<span class="money-inline">${c}</span>`,
    itemTooltip: () => '',
    attachTooltip: (el, html) => tooltips.push({ el, html }),
    root: () => root,
    world: () => world as unknown as IWorld,
    closeOthers: noop,
    hideTooltip: noop,
    consumePeek: () => {
      const armed = peek.armed;
      peek.armed = false;
      return armed;
    },
    captureFocus: () => null,
    restoreFocus: noop,
    onClosed: noop,
    onInventoryChanged: noop,
  };
  return { window: new BankWindow(deps), root, world, calls, tooltips };
}

const cells = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>('.bank-sockets .bank-socket'));

describe('the bank socket row renders one cell per socket state', () => {
  it('paints filled, empty, next-locked (with the wire price), and later-locked cells', () => {
    const h = harness(
      bankInfo({
        socketsUnlocked: 2,
        socketBags: [SATCHEL, null, null, null],
        nextSocketCost: 3500000,
      }),
    );
    h.window.open();
    const row = cells(h.root);
    expect(row).toHaveLength(4);
    // Filled: an icon cell whose aria carries the bag name AND the materials
    // slots line (what the socketed slots actually buy).
    expect(row[0].querySelector('.item-icon')).not.toBeNull();
    expect(row[0].getAttribute('aria-label')).toContain('Burlap Reagent Pouch');
    expect(row[0].getAttribute('aria-label')).toContain('8');
    expect(row[0].getAttribute('aria-label')).toContain('Materials');
    // Empty unlocked: informational.
    expect(row[1].classList.contains('empty')).toBe(true);
    expect(row[1].getAttribute('aria-disabled')).toBe('true');
    // The NEXT locked socket is actionable and priced from the wire.
    expect(row[2].classList.contains('locked')).toBe(true);
    expect(row[2].getAttribute('aria-disabled')).toBeNull();
    expect(row[2].getAttribute('aria-label')).toContain('Unlock');
    // The later locked socket is informational: no price exists for it yet.
    expect(row[3].classList.contains('locked')).toBe(true);
    expect(row[3].getAttribute('aria-disabled')).toBe('true');
  });

  it('an unknown socketed id admits the unknown in its aria, never a fabricated slot count (R34)', () => {
    // The cell itself must survive (the pure core's R34 rule, pinned in
    // tests/bank_view.test.ts), but the PAINTER must not voice the model's
    // zero-slot fallback: the bag's real slots ARE feeding the pool
    // server-side, the client just cannot name them. The aria pairs the raw
    // id (the grid's own R34 pattern) with the same unknown-item admission
    // the cell's tooltip makes, via the existing keys only.
    const h = harness(
      bankInfo({ socketsUnlocked: 1, socketBags: ['ghost_bag', null, null, null] }),
    );
    h.window.open();
    const aria = cells(h.root)[0].getAttribute('aria-label');
    expect(aria).toBe('ghost_bag: Unknown item');
  });
});

describe('a long-press peek consumes the release click (the mobile inspect rule)', () => {
  it('a peeked release on a filled socket inspects, and the NEXT click unsockets', () => {
    const h = harness(
      bankInfo({ socketsUnlocked: 2, socketBags: [null, GENERAL_BAG, null, null] }),
      { peekOnce: true },
    );
    h.window.open();
    // The release click that ends the long-press: tooltip already shown, so
    // the click must move nothing.
    cells(h.root)[1].click();
    expect(h.calls).toEqual([]);
    // The peek is consumed by exactly that one release: a following plain
    // click acts normally (the work-remaining arm; a guard that swallowed
    // every click would fail here).
    cells(h.root)[1].click();
    expect(h.calls).toEqual(['bankUnsocketBag:1']);
  });

  it('a peeked release on the priced locked socket opens no confirm; the next click does', () => {
    const h = harness(bankInfo({ socketsUnlocked: 0, nextSocketCost: 1000000 }), {
      peekOnce: true,
    });
    h.window.open();
    cells(h.root)[0].click();
    expect(document.querySelector('.bank-buy-prompt')).toBeNull();
    expect(h.calls).toEqual([]);
    cells(h.root)[0].click();
    expect(document.querySelector('.bank-buy-prompt')).not.toBeNull();
  });
});

describe('the socket clicks dispatch the IWorld verbs (the real player callers)', () => {
  it('clicking a filled socket sends bankUnsocketBag with that socket index', () => {
    const h = harness(
      bankInfo({ socketsUnlocked: 2, socketBags: [null, GENERAL_BAG, null, null] }),
    );
    h.window.open();
    cells(h.root)[1].click();
    expect(h.calls).toEqual(['bankUnsocketBag:1']);
  });

  it('clicking the priced locked socket opens the confirm; confirming sends bankUnlockSocket', () => {
    const h = harness(bankInfo({ socketsUnlocked: 0, nextSocketCost: 1000000 }));
    h.window.open();
    cells(h.root)[0].click();
    // The confirm mounts into #prompt-stack (the buy-slots chrome) and nothing
    // has been sent yet: the click is an offer, the confirm is the intent.
    expect(h.calls).toEqual([]);
    const prompt = document.querySelector<HTMLElement>('.bank-buy-prompt');
    expect(prompt).not.toBeNull();
    expect(prompt?.textContent).toContain('Unlock a bank bag socket');
    // The first .btn is the confirm (bank_buy_prompt.ts appends confirm, cancel).
    const confirm = prompt?.querySelector<HTMLElement>('.btn');
    expect(confirm?.textContent).toBe('Unlock');
    confirm?.click();
    expect(h.calls).toEqual(['bankUnlockSocket']);
  });

  it('holds the confirmed offer busy across a stale mirror and sends exactly one unlock', () => {
    const h = harness(bankInfo({ socketsUnlocked: 0, nextSocketCost: 1000000 }));
    h.window.open();
    cells(h.root)[0].click();
    const confirm = document.querySelector('.bank-buy-prompt .btn') as HTMLButtonElement;
    confirm.click();
    // The arm check also protects the deepest boundary: even a queued second
    // activation on the now-detached confirm cannot send another command.
    confirm.click();

    const stale = cells(h.root)[0] as HTMLButtonElement;
    expect(h.calls.filter((call) => call === 'bankUnlockSocket')).toHaveLength(1);
    expect(h.root.querySelector('.bank-socket-purchase-status')).toBeNull();
    expect(stale.disabled).toBe(true);
    // disabled + aria-busy, the vault/guild busy form: aria-disabled on a
    // natively disabled button is redundant, so markBusy must not add it.
    expect(stale.hasAttribute('aria-disabled')).toBe(false);
    expect(stale.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(h.root.querySelector('[data-close]'));

    // The online mirror still advertises the exact offer that was just sent.
    // A rapid second activation cannot open another confirm or send the
    // argument-free command that would buy the next authoritative rung.
    stale.click();
    expect(document.querySelector('.bank-buy-prompt')).toBeNull();
    expect(h.calls.filter((call) => call === 'bankUnlockSocket')).toHaveLength(1);

    // Only the expected authoritative revision releases the guard. The next
    // rung is a fresh, independently actionable offer with its own live price.
    h.world.bankInfo = bankInfo({ socketsUnlocked: 1, nextSocketCost: 2000000 });
    h.window.refreshIfChanged();
    const echoed = cells(h.root);
    expect(echoed[0].classList.contains('empty')).toBe(true);
    expect((echoed[1] as HTMLButtonElement).disabled).toBe(false);
    expect(echoed[1].hasAttribute('aria-disabled')).toBe(false);
    expect(echoed[1].hasAttribute('aria-busy')).toBe(false);
  });

  it('refuses a stale revision, announces the refreshed price, and focuses that offer', async () => {
    const h = harness(bankInfo({ socketsUnlocked: 0, nextSocketCost: 1000000 }));
    h.window.open();
    cells(h.root)[0].click();

    // An authoritative rung advance lands while the socket-0 confirmation is
    // open. Sending now would act on socket 1, which was never shown.
    h.world.bankInfo = bankInfo({ socketsUnlocked: 1, nextSocketCost: 1000000 });
    (document.querySelector('.bank-buy-prompt .btn') as HTMLButtonElement).click();

    expect(h.calls).not.toContain('bankUnlockSocket');
    expect(document.querySelector('.bank-buy-prompt')).toBeNull();
    const fresh = cells(h.root);
    expect(fresh[0].classList.contains('empty')).toBe(true);
    const refreshed = fresh[1] as HTMLButtonElement;
    expect(refreshed.getAttribute('aria-label')).toContain('100');
    expect(document.activeElement).toBe(refreshed);

    const message =
      'The price changed before the purchase completed. Review the refreshed price and confirm again.';
    const visible = h.root.querySelector('.bank-socket-purchase-status');
    const detachedLive = h.root.querySelector('[data-bank-socket-purchase-live]') as HTMLElement;
    expect(visible?.textContent).toBe(message);
    expect(visible?.getAttribute('aria-live')).toBeNull();
    expect(detachedLive.getAttribute('role')).toBe('status');
    expect(detachedLive.getAttribute('aria-live')).toBe('polite');
    expect(detachedLive.getAttribute('aria-atomic')).toBe('true');
    expect(detachedLive.textContent).toBe('');

    // A repaint before publication cannot make the detached region speak.
    // Its mounted replacement publishes once and retains focus on the offer.
    h.window.render();
    const currentLive = h.root.querySelector('[data-bank-socket-purchase-live]') as HTMLElement;
    const currentOffer = cells(h.root)[1] as HTMLButtonElement;
    expect(currentLive).not.toBe(detachedLive);
    expect(currentLive.textContent).toBe('');
    expect(document.activeElement).toBe(currentOffer);
    await Promise.resolve();
    expect(detachedLive.textContent).toBe('');
    expect(currentLive.textContent).toBe(message);
  });

  it('refuses a visible offer whose price changed before confirmation', () => {
    const h = harness(bankInfo({ socketsUnlocked: 0, nextSocketCost: 1000000 }));
    h.window.open();
    cells(h.root)[0].click();

    // The same rung is still live, but the tunable price no longer matches
    // the amount in the confirmation. It needs a fresh consent prompt too.
    h.world.bankInfo = bankInfo({ socketsUnlocked: 0, nextSocketCost: 1500000 });
    (document.querySelector('.bank-buy-prompt .btn') as HTMLButtonElement).click();

    expect(h.calls).not.toContain('bankUnlockSocket');
    expect(document.querySelector('.bank-buy-prompt')).toBeNull();
    const refreshed = cells(h.root)[0];
    expect(refreshed.getAttribute('aria-label')).toContain('150');
    expect(document.activeElement).toBe(refreshed);
    expect(h.root.querySelector('.bank-socket-purchase-status')).not.toBeNull();
  });

  it('falls back to Close when a stale confirmation no longer has a socket offer', () => {
    const h = harness(bankInfo({ socketsUnlocked: 3, nextSocketCost: 4000000 }));
    h.window.open();
    cells(h.root)[3].click();

    h.world.bankInfo = bankInfo({ socketsUnlocked: 4, nextSocketCost: null });
    (document.querySelector('.bank-buy-prompt .btn') as HTMLButtonElement).click();

    expect(h.calls).not.toContain('bankUnlockSocket');
    expect(document.activeElement).toBe(h.root.querySelector('[data-close]'));
    expect(h.root.querySelector('.bank-socket-purchase-status')).not.toBeNull();
  });

  it('keeps the socket latch across close, ignores generic errors, and releases on refusal', () => {
    const h = harness(bankInfo({ socketsUnlocked: 0, nextSocketCost: 1000000 }));
    h.window.open();
    cells(h.root)[0].click();
    (document.querySelector('.bank-buy-prompt .btn') as HTMLButtonElement).click();
    h.window.close();
    h.window.open();

    const reopened = cells(h.root)[0] as HTMLButtonElement;
    expect(reopened.disabled).toBe(true);
    expect(reopened.getAttribute('aria-busy')).toBe('true');
    h.window.observeStorageText('You are busy.');
    expect(reopened.disabled).toBe(true);

    h.window.observeStorageText('You cannot afford that bag socket.');
    const released = cells(h.root)[0] as HTMLButtonElement;
    expect(released.disabled).toBe(false);
    expect(released.hasAttribute('aria-busy')).toBe(false);
  });

  it('releases the socket latch on the authoritative max-sockets refusal too', () => {
    const h = harness(bankInfo({ socketsUnlocked: 0, nextSocketCost: 1000000 }));
    h.window.open();
    cells(h.root)[0].click();
    (document.querySelector('.bank-buy-prompt .btn') as HTMLButtonElement).click();

    h.window.observeStorageText('Your bank has no more bag sockets to unlock.');
    const released = cells(h.root)[0] as HTMLButtonElement;
    expect(released.disabled).toBe(false);
    expect(released.hasAttribute('aria-busy')).toBe(false);
  });

  it('re-enables the stale socket offer at the bounded 12,000ms lost-echo timeout', () => {
    vi.useFakeTimers();
    try {
      const h = harness(bankInfo({ socketsUnlocked: 0, nextSocketCost: 1000000 }));
      h.window.open();
      cells(h.root)[0].click();
      (document.querySelector('.bank-buy-prompt .btn') as HTMLButtonElement).click();

      vi.advanceTimersByTime(11_999);
      expect((cells(h.root)[0] as HTMLButtonElement).disabled).toBe(true);
      vi.advanceTimersByTime(1);
      const released = cells(h.root)[0] as HTMLButtonElement;
      expect(released.disabled).toBe(false);
      expect(released.hasAttribute('aria-busy')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the empty and later-locked cells dispatch nothing', () => {
    const h = harness(bankInfo({ socketsUnlocked: 1 }));
    h.window.open();
    const row = cells(h.root);
    row[0].click(); // empty unlocked
    row[2].click(); // later locked (no price)
    row[3].click();
    expect(h.calls).toEqual([]);
    expect(document.querySelector('.bank-buy-prompt')).toBeNull();
  });
});

describe('the repaint signature carries the socket terms (state.md owes item 6)', () => {
  it('an unlock that moves ONLY socketsUnlocked and nextSocketCost repaints the row', () => {
    const h = harness(bankInfo({ socketsUnlocked: 0, nextSocketCost: 1000000 }));
    h.window.open();
    h.window.refreshIfChanged(); // settle the signature on the opened state
    expect(cells(h.root)[0].classList.contains('locked')).toBe(true);

    // The exact post-unlock echo: capacity, slots, purse, and every other
    // signed term hold still (an empty socket adds zero capacity); only the
    // two unlock fields move. Without the socket terms in the signature this
    // refresh is a no-op and the row keeps offering the unlock it just sold.
    h.world.bankInfo = bankInfo({ socketsUnlocked: 1, nextSocketCost: 2000000 });
    h.window.refreshIfChanged();
    const row = cells(h.root);
    expect(row[0].classList.contains('empty')).toBe(true);
    expect(row[1].classList.contains('locked')).toBe(true);
    expect(row[1].getAttribute('aria-disabled')).toBeNull(); // the price moved to socket 1
  });

  it('a price move ALONE repaints the offer (the phase 09 tunable-price echo)', () => {
    // The third signed term pinned independently: socketsUnlocked and
    // socketBags hold still while nextSocketCost moves (a server-side price
    // retune landing mid-session), so deleting info.nextSocketCost from the
    // signature is the ONLY thing that can red this arm.
    const h = harness(bankInfo({ socketsUnlocked: 0, nextSocketCost: 1000000 }));
    h.window.open();
    h.window.refreshIfChanged();
    const before = cells(h.root)[0].getAttribute('aria-label');
    expect(before).toContain('100'); // formatMoney(1000000) = 100 gold

    h.world.bankInfo = bankInfo({ socketsUnlocked: 0, nextSocketCost: 1500000 });
    h.window.refreshIfChanged();
    const after = cells(h.root)[0].getAttribute('aria-label');
    expect(after).toContain('150'); // formatMoney(1500000) = 150 gold
    expect(after).not.toBe(before);
  });

  it('an UNCHANGED mirror does not repaint (the signature is content, never identity)', () => {
    // The no-op direction: a signature degenerating to an always-changing
    // value (object identity, a timestamp) would repaint the cold window on
    // every slow-band poll. Node identity across two refreshes with the same
    // data is the observable.
    const h = harness(bankInfo({ socketsUnlocked: 1 }));
    h.window.open();
    h.window.refreshIfChanged();
    const node = cells(h.root)[0];
    const footerNode = h.root.querySelector('.bank-footer');
    // A FRESH object with equal content: identity-keyed signatures red here.
    h.world.bankInfo = bankInfo({ socketsUnlocked: 1 });
    h.window.refreshIfChanged();
    expect(cells(h.root)[0]).toBe(node);
    // The footer holds too: the pool-four move arms below observe footer
    // rebuild, so their no-op direction must be pinned on the SAME node, not
    // inferred from cell identity.
    expect(h.root.querySelector('.bank-footer')).toBe(footerNode);
  });

  it.each([
    { field: 'generalCapacity', value: 23 },
    { field: 'materialsCapacity', value: 8 },
    { field: 'generalUsed', value: 1 },
    { field: 'materialsUsed', value: 1 },
  ] as const)(
    'a lone $field move repaints the footer meter (phase 08 wire-split term)',
    ({ field, value }) => {
      // A server-side reclassification or allocation-rule change moves pool
      // numbers while capacity, slots, socketBags, and every other signed term
      // hold still; each rig moves EXACTLY one of the pool four. The observable
      // is the footer node being rebuilt (the cold window repaints wholesale);
      // the no-op direction lives in the UNCHANGED-mirror arm above.
      const h = harness(bankInfo());
      h.window.open();
      h.window.refreshIfChanged();
      const before = h.root.querySelector('.bank-footer');
      expect(before).not.toBeNull();
      h.world.bankInfo = bankInfo({ [field]: value } as Partial<BankInfo>);
      h.window.refreshIfChanged();
      const after = h.root.querySelector('.bank-footer');
      expect(after).not.toBeNull();
      expect(after).not.toBe(before);
    },
  );

  it('a same-capacity bag swap (socketBags moves alone) repaints the row too', () => {
    // Two distinct 6-slot general bags would hold every capacity field equal;
    // this rig goes further and holds EVERY non-socketBags field constant, so
    // only the socketBags term can trigger the repaint.
    const h = harness(
      bankInfo({ socketsUnlocked: 1, socketBags: [GENERAL_BAG, null, null, null] }),
    );
    h.window.open();
    h.window.refreshIfChanged();
    expect(cells(h.root)[0].getAttribute('aria-label')).toContain('Linen Pouch');

    h.world.bankInfo = bankInfo({ socketsUnlocked: 1, socketBags: [SATCHEL, null, null, null] });
    h.window.refreshIfChanged();
    expect(cells(h.root)[0].getAttribute('aria-label')).toContain('Burlap Reagent Pouch');
  });
});

// ---------------------------------------------------------------------------
// The footer capacity meter (Bank Storage phase 08): the meter + buy row share
// ONE always-visible band below the scroll region, the legacy header capacity
// band is gone, and every rendered number is the wire pool four through the
// pure model (tests/bank_view.test.ts owns the model arms; these read the DOM).

const filled = (n: number): { itemId: string; count: number }[] =>
  Array.from({ length: n }, () => ({ itemId: 'x', count: 1 }));

// A split fixture: the satchel's 8 materials slots beside a 24-slot general
// pool, part-filled on both sides (12/24 general, 6/8 materials, 18/32 summed).
const splitInfo = (): BankInfo =>
  bankInfo({
    slots: filled(18),
    capacity: 32,
    socketsUnlocked: 1,
    socketBags: [SATCHEL, null, null, null],
    generalCapacity: 24,
    materialsCapacity: 8,
    generalUsed: 12,
    materialsUsed: 6,
  });

describe('the footer band renders one meter and one expand affordance', () => {
  it('exactly one footer, one meter, one buy button, and NO legacy capacity band', () => {
    const h = harness(bankInfo({ slots: filled(3), generalUsed: 3 }));
    h.window.open();
    expect(h.root.querySelectorAll('.bank-footer')).toHaveLength(1);
    expect(h.root.querySelectorAll('.bank-meter')).toHaveLength(1);
    expect(h.root.querySelectorAll('.bank-buy-btn')).toHaveLength(1);
    expect(h.root.querySelector('.bank-capacity')).toBeNull();
    expect(h.root.querySelector('.bank-meter-text')?.textContent).toBe('3 of 24 slots');
    // The meter and the buy row both live INSIDE the footer, meter first.
    const footer = h.root.querySelector('.bank-footer') as HTMLElement;
    expect(footer.firstElementChild?.classList.contains('bank-meter')).toBe(true);
    expect(footer.querySelector('.bank-buy-row')).not.toBeNull();
    // And the footer sits BELOW the scroll region in the rendered pane order
    // (the behavioral pin behind bank_window.test.ts's source-order scan): a
    // comment-gamed source pin cannot satisfy this one.
    const pane = footer.parentElement as HTMLElement;
    const kids = Array.from(pane.children);
    const scroll = pane.querySelector('.bank-scroll');
    expect(scroll).not.toBeNull();
    expect(kids.indexOf(scroll as Element)).toBeLessThan(kids.indexOf(footer));
  });

  it('a maxed ladder replaces the button with the maxed label inside the footer; meter stays', () => {
    const h = harness(bankInfo({ nextExpansionCost: null }));
    h.window.open();
    const footer = h.root.querySelector('.bank-footer') as HTMLElement;
    expect(footer.querySelector('.bank-buy-maxed')).not.toBeNull();
    expect(footer.querySelector('.bank-buy-btn')).toBeNull();
    expect(footer.querySelector('.bank-meter')).not.toBeNull();
  });

  it('the buy price rides ONE gold tag inside ONE tags container (the phase 13 seam)', () => {
    const h = harness(bankInfo());
    h.window.open();
    const tags = h.root.querySelectorAll('.bank-buy-tags');
    expect(tags).toHaveLength(1);
    expect(h.root.querySelector('.bank-buy-btn .bank-buy-tags')).not.toBeNull();
    const children = tags[0].children;
    expect(children).toHaveLength(1);
    expect(children[0].classList.contains('bank-buy-tag')).toBe(true);
    expect(children[0].classList.contains('bank-buy-tag-gold')).toBe(true);
    expect(children[0].querySelector('.money-inline')?.textContent).toBe('500');
  });
});

describe('the footer state classes (near-full keys on the general pool)', () => {
  it('wears near-full AT the threshold (34/40) and not just below (33/40)', () => {
    const at = harness(
      bankInfo({ slots: filled(34), capacity: 40, generalCapacity: 40, generalUsed: 34 }),
    );
    at.window.open();
    const atFooter = at.root.querySelector('.bank-footer') as HTMLElement;
    expect(atFooter.classList.contains('near-full')).toBe(true);
    expect(atFooter.classList.contains('over')).toBe(false);

    const below = harness(
      bankInfo({ slots: filled(33), capacity: 40, generalCapacity: 40, generalUsed: 33 }),
    );
    below.window.open();
    const belowFooter = below.root.querySelector('.bank-footer') as HTMLElement;
    expect(belowFooter.classList.contains('near-full')).toBe(false);
    expect(belowFooter.classList.contains('over')).toBe(false);
  });

  it('wears over (and near-full) in the tolerated over-capacity state', () => {
    const h = harness(
      bankInfo({ slots: filled(26), capacity: 24, generalCapacity: 24, generalUsed: 26 }),
    );
    h.window.open();
    const footer = h.root.querySelector('.bank-footer') as HTMLElement;
    expect(footer.classList.contains('over')).toBe(true);
    expect(footer.classList.contains('near-full')).toBe(true);
  });

  it('over keys on the SUMMED pair, deliberately not a per-pool flag', () => {
    // A general pool over ITS budget while the summed pair sits under total:
    // the footer must stay un-red (the segment and warmth carry the per-pool
    // story). This is the state that discriminates meter.over from
    // meter.general.over; a painter swapped to the per-pool flag reds here.
    // The wire four are fed directly (today's materials-first allocation
    // cannot emit this split; the arm pins the DEFENSIVE rendering contract,
    // the same one the showMaterials disjunct in bank_view.ts keeps).
    const h = harness(
      bankInfo({
        slots: filled(21),
        capacity: 36,
        generalCapacity: 20,
        materialsCapacity: 16,
        generalUsed: 21,
        materialsUsed: 0,
      }),
    );
    h.window.open();
    const footer = h.root.querySelector('.bank-footer') as HTMLElement;
    expect(footer.classList.contains('over')).toBe(false);
    expect(footer.classList.contains('near-full')).toBe(true);
  });
});

describe('the meter custom properties (unitless strings on the meter element)', () => {
  it('sets shares from each pool capacity over the total and fills from the fractions', () => {
    const h = harness(splitInfo());
    h.window.open();
    const meter = h.root.querySelector('.bank-meter') as HTMLElement;
    expect(meter.style.getPropertyValue('--bank-meter-general-share')).toBe('0.75');
    expect(meter.style.getPropertyValue('--bank-meter-materials-share')).toBe('0.25');
    expect(meter.style.getPropertyValue('--bank-meter-general-fill')).toBe('0.5');
    expect(meter.style.getPropertyValue('--bank-meter-materials-fill')).toBe('0.75');
    // Both segments exist as real nodes with their own fill divs.
    expect(meter.querySelectorAll('.bank-meter-track .bank-meter-fill')).toHaveLength(2);
  });

  it('clamps the drawn fill at 1 in the over state (the model fraction stays honest)', () => {
    const h = harness(
      bankInfo({ slots: filled(30), capacity: 24, generalCapacity: 24, generalUsed: 30 }),
    );
    h.window.open();
    const meter = h.root.querySelector('.bank-meter') as HTMLElement;
    expect(meter.style.getPropertyValue('--bank-meter-general-fill')).toBe('1');
    expect(meter.style.getPropertyValue('--bank-meter-general-share')).toBe('1');
  });

  it('a satchel-less bank still renders the materials segment, collapsed to share 0', () => {
    const h = harness(bankInfo());
    h.window.open();
    const meter = h.root.querySelector('.bank-meter') as HTMLElement;
    expect(meter.querySelectorAll('.bank-meter-seg-materials')).toHaveLength(1);
    expect(meter.style.getPropertyValue('--bank-meter-materials-share')).toBe('0');
    expect(meter.style.getPropertyValue('--bank-meter-materials-fill')).toBe('0');
  });
});

describe('the meter aria and tooltip speak the per-pool truth', () => {
  it('the meter is a focusable labelled group (keyboard users reach the tooltip)', () => {
    // The pool lines and the materials note live ONLY in the tooltip, whose
    // host serves hover, long-press, and focusin: without the tab stop the
    // note has no keyboard surface at all (QA 08). role=group keeps the
    // aria-label conformant on the composite.
    const h = harness(splitInfo());
    h.window.open();
    const meter = h.root.querySelector('.bank-meter') as HTMLElement;
    expect(meter.getAttribute('tabindex')).toBe('0');
    expect(meter.getAttribute('role')).toBe('group');
  });

  it('keyboard focus parked on the meter survives a mirror-driven rebuild', () => {
    // restoreControlFocus resolves by data-focus-key, else the close button:
    // without bank:meter a parked reader was yanked to Close (and the tooltip
    // hidden) on every refreshIfChanged, defeating the tab stop's purpose.
    const h = harness(splitInfo());
    h.window.open();
    const meter = h.root.querySelector('.bank-meter') as HTMLElement;
    meter.focus();
    expect(document.activeElement).toBe(meter);
    h.world.bankInfo = { ...splitInfo(), generalUsed: 13 };
    h.window.refreshIfChanged();
    const rebuilt = h.root.querySelector('.bank-meter') as HTMLElement;
    expect(rebuilt).not.toBe(meter);
    expect(document.activeElement).toBe(rebuilt);
  });

  it('uses the pools composition in the split state and the simple line otherwise', () => {
    const split = harness(splitInfo());
    split.window.open();
    expect(split.root.querySelector('.bank-meter')?.getAttribute('aria-label')).toBe(
      'Bank slots used: 18 of 32. General items: 12 of 24. Materials: 6 of 8.',
    );
    const plain = harness(bankInfo({ slots: filled(3), generalUsed: 3 }));
    plain.window.open();
    expect(plain.root.querySelector('.bank-meter')?.getAttribute('aria-label')).toBe(
      'Bank slots used: 3 of 24',
    );
  });

  it('the tooltip carries the general line always; materials line + note only when split', () => {
    const split = harness(splitInfo());
    split.window.open();
    const meterEl = split.root.querySelector('.bank-meter');
    const tip = split.tooltips.find((entry) => entry.el === meterEl);
    expect(tip).toBeDefined();
    const html = tip?.html() ?? '';
    expect(html).toContain('General: 12 of 24');
    expect(html).toContain('Materials: 6 of 8');
    expect(html).toContain(
      'Materials-only space from socketed satchels. Other items cannot use it.',
    );

    const plain = harness(bankInfo({ slots: filled(3), generalUsed: 3 }));
    plain.window.open();
    const plainTip = plain.tooltips.find(
      (entry) => entry.el === plain.root.querySelector('.bank-meter'),
    );
    expect(plainTip).toBeDefined();
    const plainHtml = plainTip?.html() ?? '';
    expect(plainHtml).toContain('General: 3 of 24');
    expect(plainHtml).not.toContain('Materials');
  });
});

describe('the buy confirm carries the economy disclaimer (click-gated, phase 08)', () => {
  it('the buy-slots confirm shows the disclaimer line', () => {
    const h = harness(bankInfo());
    h.window.open();
    (h.root.querySelector('.bank-buy-btn') as HTMLElement).click();
    const prompt = document.querySelector('.bank-buy-prompt');
    expect(prompt).not.toBeNull();
    expect(prompt?.querySelector('.bank-buy-disclaimer')?.textContent).toBe(
      'Prices may change with the game economy.',
    );
    // The disclaimer joins the dialog's accessible DESCRIPTION: labelledby
    // names only .prompt-text, so without describedby the line would never
    // be announced on open, yet it is part of the purchase decision (QA 08).
    const disclaimer = prompt?.querySelector('.bank-buy-disclaimer') as HTMLElement;
    expect(disclaimer.id).not.toBe('');
    expect(prompt?.getAttribute('aria-describedby')).toBe(disclaimer.id);
  });

  it('the socket-unlock confirm carries it too (tunable since phase 09)', () => {
    // Phase 08 deliberately scoped the disclaimer to the slots confirm; phase
    // 09 put the socket ladder on the STORAGE_PRICES override, so this price
    // is now retunable between sessions and the confirm adopts the line
    // (pricing-and-skus.md: purchase surfaces carry the disclaimer key).
    const h = harness(bankInfo({ socketsUnlocked: 0, nextSocketCost: 1000000 }));
    h.window.open();
    cells(h.root)[0].click();
    const prompt = document.querySelector('.bank-buy-prompt');
    expect(prompt).not.toBeNull();
    const disclaimer = prompt?.querySelector('.bank-buy-disclaimer') as HTMLElement;
    expect(disclaimer?.textContent).toBe('Prices may change with the game economy.');
    expect(disclaimer.id).not.toBe('');
    expect(prompt?.getAttribute('aria-describedby')).toBe(disclaimer.id);
  });
});
