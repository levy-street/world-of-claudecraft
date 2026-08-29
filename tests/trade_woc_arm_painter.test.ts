// @vitest-environment happy-dom
// The trade window's $WOC arm, at the DOM boundary.
//
// The view core's own tests cover what the arm DECIDES; these cover what it
// renders and rewires, and in particular the one property that is easy to lose
// in a refactor: the derived fee/net lines update IN PLACE, without replacing
// the price input, so a seller's caret survives every estimate that lands while
// they are still typing.

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvSlot, ItemDef } from '../src/sim/types';
import { durationText } from '../src/ui/duration_text';
import { captureFocusKey } from '../src/ui/focus_restore';
import { formatDateTime, t } from '../src/ui/i18n';
import {
  refreshWocTradeArm,
  restoreWocTradeFocus,
  type WocTradeArmDeps,
  wireWocTradeArm,
  wocTradeArmHtml,
  wocTradeModelFrom,
  wocTradeMoneyText,
} from '../src/ui/trade_woc_arm_painter';
import type { WocTradeQuoteReview } from '../src/ui/trade_woc_view';
import { usdText } from '../src/ui/usd_text';

const EPIC: ItemDef = {
  id: 'panel_epic_blade',
  name: 'Panel Blade',
  quality: 'epic',
  slot: 'mainhand',
} as unknown as ItemDef;
const TABLE: Record<string, ItemDef> = { [EPIC.id]: EPIC };
const slot = (id: string): InvSlot => ({ itemId: id, count: 1 });

// Comment-stripped BEFORE any pin reads them: the controller is roughly 40
// percent prose, so an unstripped pin can be satisfied (or false-red) by a
// comment quoting the pinned expression (the comment-gameable trap; the
// sibling tests/trade_view.test.ts strips for the same reason). The line strip
// is the URL-guarded form so a :// never eats the rest of its line (#2499).
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const CONTROLLER = stripComments(
  readFileSync('src/ui/hud/woc_trade/woc_trade_controller.ts', 'utf8'),
);
const VIEW = stripComments(readFileSync('src/ui/hud/woc_trade/woc_trade_offer_view.ts', 'utf8'));

function deps(over: Partial<WocTradeArmDeps> = {}): WocTradeArmDeps {
  return {
    staged: [],
    theirStaged: [slot(EPIC.id)],
    goldCopper: 0,
    partnerGoldCopper: 0,
    walletTokens: null,
    pendingOffer: null,
    items: TABLE,
    marketEnabled: true,
    selfWalletVerified: true,
    partner: { name: 'Aldan', walletVerified: true },
    partnerResolved: true,
    mode: 'woc',
    usdCents: 5000,
    tokens: 1234.5,
    split: { sellerCents: 4500, burnCents: 150, treasuryCents: 350 },
    onModeChange: vi.fn(),
    onPriceInput: vi.fn(),
    onSendOffer: vi.fn(),
    onCancelOffer: vi.fn(),
    onDeclineOffer: vi.fn(),
    onCancelSale: vi.fn(),
    onPayOffer: vi.fn(),
    onTermsChange: vi.fn(),
    onSignQuote: vi.fn(),
    onQuoteCancel: vi.fn(),
    // Durable acceptance by default so the standing render tests keep their
    // face shapes; the consent-row tests flip it off explicitly.
    termsAccepted: true,
    ...over,
  };
}

/** Paint the arm into a detached root, exactly as the trade window does. */
function paint(d: WocTradeArmDeps): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = wocTradeArmHtml(wocTradeModelFrom(d), d.usdCents);
  wireWocTradeArm(root, d);
  refreshWocTradeArm(root, wocTradeModelFrom(d));
  return root;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('trade_woc_arm_painter: no magic values', () => {
  // The no-magic guard is DECENTRALIZED (src/styles/CLAUDE.md): each migrated
  // painter scans its OWN source, and this file had none of its own after the
  // rename pulled it into the *_painter.ts namespace. It is clean today, which
  // is exactly when a guard is worth adding.
  const PAINTER = stripComments(readFileSync('src/ui/trade_woc_arm_painter.ts', 'utf8'));

  it('carries no raw hex, rgb() or hsl() colour literal', () => {
    // The (?<!&) guard skips numeric HTML entities, whose digits are hex
    // characters but are not colours.
    const hex = PAINTER.match(/(?<!&)#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hex, `colours belong in the stylesheet: ${hex.join(', ')}`).toEqual([]);
    expect(PAINTER).not.toMatch(/\b(?:rgba?|hsla?)\(/);
  });

  it('sizes and spaces nothing from the painter: no px, rem, em or vh literal', () => {
    const units = PAINTER.match(/\b\d+(?:\.\d+)?(?:px|rem|em|vh|vw)\b/g) ?? [];
    expect(units, `sizing belongs in the stylesheet: ${units.join(', ')}`).toEqual([]);
  });

  it('positive control: the scan sees a literal it is given', () => {
    expect(stripComments("const c = '#a335ee';")).toContain('#a335ee');
    expect(stripComments("const w = '12px';")).toContain('12px');
  });
});

describe('what the arm renders', () => {
  it('shows the price field, the equivalent, and both money lines', () => {
    const root = paint(deps());
    expect(root.querySelector('#trade-woc-usd')).toBeTruthy();
    expect(root.querySelector('[data-woc-equiv]')?.textContent).toContain('1,234.5');
    // The fee is the two fee legs together; the net is the seller leg. Both come
    // from the server split, never from a percentage computed here.
    expect(root.querySelector('[data-woc-fee]')?.textContent).toContain('5.00');
    expect(root.querySelector('[data-woc-net]')?.textContent).toContain('45.00');
  });

  it('renders the ineligible count and its reason as two lines, never one joined string', () => {
    // An item the table does not carry is ineligible by the predicate, which is
    // the cheapest way to arm this line. The two sentences render into their own
    // elements: joining them in code with a hard ' ' would be this caller
    // deciding a locale's sentence spacing (CJK sets none) and its order.
    const root = paint(deps({ theirStaged: [slot(EPIC.id), slot('not_in_the_table')] }));
    const count = root.querySelector('[data-woc-ineligible]')?.textContent ?? '';
    const why = root.querySelector('[data-woc-ineligible-why]')?.textContent ?? '';
    expect(count).toContain('1');
    expect(count).toContain(t('hudChrome.plurals.wocTradeIneligible.one').replace('{count}', '1'));
    expect(why).toBe(t('hudChrome.trade.woc.ineligibleReason'));
    // Neither line carries the other's sentence.
    expect(count).not.toContain(t('hudChrome.trade.woc.ineligibleReason'));
    expect(why).not.toContain('1');
  });

  it('clears both ineligible lines when everything staged is sellable', () => {
    const root = paint(deps({ theirStaged: [slot(EPIC.id)] }));
    expect(root.querySelector('[data-woc-ineligible]')?.textContent).toBe('');
    expect(root.querySelector('[data-woc-ineligible-why]')?.textContent).toBe('');
  });

  it('renders the block reason instead of the form, and keeps the tabs', () => {
    const root = paint(deps({ partner: { name: 'Aldan', walletVerified: false } }));
    expect(root.querySelector('.trade-woc-block')?.textContent).toBeTruthy();
    expect(root.querySelector('#trade-woc-usd'), 'no price field while blocked').toBeNull();
    expect(root.querySelectorAll('[data-woc-mode]')).toHaveLength(2);
  });

  it('renders nothing at all when the realm has no exchange', () => {
    expect(wocTradeArmHtml(wocTradeModelFrom(deps({ marketEnabled: false })), null)).toBe('');
  });

  it('shows no money lines when the server sent no split', () => {
    const root = paint(deps({ split: null, tokens: null }));
    expect(root.querySelector('[data-woc-fee]')?.textContent).toBe('');
    expect(root.querySelector('[data-woc-net]')?.textContent).toBe('');
  });

  it('renders the rounding edges honestly: zero fee, one cent, and the price floor', () => {
    // A zero-fee split is a real $0.00, never a blank line; a one-cent fee
    // must not round away; the smallest legal listing (the 25-cent floor)
    // shows the exact ceil-and-remainder legs the dev split computes for it.
    const zero = paint(deps({ split: { sellerCents: 100, burnCents: 0, treasuryCents: 0 } }));
    expect(zero.querySelector('[data-woc-fee]')?.textContent).toContain('0.00');
    expect(zero.querySelector('[data-woc-net]')?.textContent).toContain('1.00');
    const cent = paint(deps({ split: { sellerCents: 0, burnCents: 1, treasuryCents: 0 } }));
    expect(cent.querySelector('[data-woc-fee]')?.textContent).toContain('0.01');
    expect(cent.querySelector('[data-woc-net]')?.textContent).toContain('0.00');
    const floor = paint(deps({ split: { sellerCents: 22, burnCents: 1, treasuryCents: 2 } }));
    expect(floor.querySelector('[data-woc-fee]')?.textContent).toContain('0.03');
    expect(floor.querySelector('[data-woc-net]')?.textContent).toContain('0.22');
  });

  it('escapes a hostile counterparty name wherever it is interpolated', () => {
    // The name is server-fed player text, so it must never reach innerHTML raw.
    const root = paint(
      deps({ partner: { name: '<img src=x onerror=alert(1)>', walletVerified: false } }),
    );
    expect(root.querySelector('img')).toBeNull();
  });
});

describe('the derived lines update WITHOUT replacing the price input', () => {
  it('keeps the very same input node across an estimate landing', () => {
    // This is the property that makes typing survivable. If a refresh rebuilt
    // the subtree, the node identity would change and the caret would be gone.
    const d = deps({ tokens: null, split: null });
    const root = paint(d);
    const before = root.querySelector('#trade-woc-usd');
    refreshWocTradeArm(
      root,
      wocTradeModelFrom({
        ...d,
        tokens: 999,
        split: { sellerCents: 4500, burnCents: 150, treasuryCents: 350 },
      }),
    );
    expect(root.querySelector('#trade-woc-usd')).toBe(before);
    expect(root.querySelector('[data-woc-equiv]')?.textContent).toContain('999');
  });

  it('elides a write when the value has not changed', () => {
    const d = deps();
    const root = paint(d);
    const line = root.querySelector('[data-woc-equiv]') as HTMLElement;
    const spy = vi.spyOn(line, 'textContent', 'set');
    refreshWocTradeArm(root, wocTradeModelFrom(d));
    expect(spy, 'an unchanged estimate must cost no DOM write').not.toHaveBeenCalled();
  });

  it('disables send, and the $WOC tab, once gold is on the table', () => {
    // The form stays rendered so the seller can see what they typed; only the
    // action is withheld. Hiding it would make the numbers vanish without
    // explaining why, and gold and $WOC are exclusive rather than one erasing
    // the other.
    const root = paint(deps({ goldCopper: 500 }));
    expect(root.querySelector('#trade-woc-usd'), 'the typed price stays visible').toBeTruthy();
    expect(root.querySelector<HTMLButtonElement>('[data-woc-send]')?.disabled).toBe(true);
    expect(
      root.querySelector<HTMLButtonElement>('[data-woc-mode="woc"]')?.disabled,
      'and the tab cannot be re-entered',
    ).toBe(true);
  });

  it('enables send on a clean, priced, eligible offer', () => {
    const root = paint(deps());
    expect(root.querySelector<HTMLButtonElement>('[data-woc-send]')?.disabled).toBe(false);
  });
});

describe('what the arm reports back', () => {
  it('reports a mode change from either tab', () => {
    const d = deps();
    const root = paint(d);
    root.querySelector<HTMLElement>('[data-woc-mode="gold"]')?.click();
    expect(d.onModeChange).toHaveBeenCalledWith('gold');
  });

  it('reports the typed price in CENTS', () => {
    const d = deps();
    const root = paint(d);
    const input = root.querySelector<HTMLInputElement>('#trade-woc-usd');
    if (!input) throw new Error('no price input');
    input.value = '12.34';
    input.dispatchEvent(new Event('input'));
    expect(d.onPriceInput).toHaveBeenCalledWith(1234);
  });

  it('reports an empty field as no price, never as zero', () => {
    const d = deps();
    const root = paint(d);
    const input = root.querySelector<HTMLInputElement>('#trade-woc-usd');
    if (!input) throw new Error('no price input');
    input.value = '';
    input.dispatchEvent(new Event('input'));
    expect(d.onPriceInput).toHaveBeenCalledWith(null);
  });

  it('reports a non-numeric field as no price rather than NaN cents', () => {
    // A number input can still yield an unparseable value; NaN cents would
    // travel to the server as a malformed price.
    const d = deps();
    const root = paint(d);
    const input = root.querySelector<HTMLInputElement>('#trade-woc-usd');
    if (!input) throw new Error('no price input');
    input.value = 'abc';
    input.dispatchEvent(new Event('input'));
    expect(d.onPriceInput).toHaveBeenCalledWith(null);
  });

  it('reports a send press', () => {
    const d = deps();
    const root = paint(d);
    root.querySelector<HTMLElement>('[data-woc-send]')?.click();
    expect(d.onSendOffer).toHaveBeenCalled();
  });
});

describe('a disabled send button carries its reason in the DOM', () => {
  it('renders the hint beside the button and clears it when sendable', () => {
    // The shipped defect: an empty side gave a dead button and no text at all.
    const blocked = paint(deps({ staged: [slot(EPIC.id)] }));
    expect(blocked.querySelector<HTMLButtonElement>('[data-woc-send]')?.disabled).toBe(true);
    expect(blocked.querySelector('[data-woc-hint]')?.textContent ?? '').not.toBe('');

    const ready = paint(deps());
    expect(ready.querySelector<HTMLButtonElement>('[data-woc-send]')?.disabled).toBe(false);
    expect(ready.querySelector('[data-woc-hint]')?.textContent).toBe('');
  });
});

describe('the trade window actually applies the gold lock', () => {
  // The view core decides goldDisabled, but the coin inputs live in the
  // trade-window controller's own render string (src/ui/hud/woc_trade/), which
  // no behavioural test drives. That gap shipped the bug this pins:
  // goldDisabled was computed and never used, so entering $WOC mode left the
  // gold fields live. A source pin is weaker than driving the DOM; it catches
  // deletion, which is how the defect actually occurred.
  it('derives the attribute from the model, not a constant', () => {
    expect(CONTROLLER).toContain("wocModel.goldDisabled ? ' disabled' : ''");
  });

  it('applies it to ALL THREE coin inputs', () => {
    // One missed field is a full hole: a seller could still type silver.
    for (const coin of ['g', 's', 'c']) {
      expect(CONTROLLER, `#trade-${coin} must honour the lock`).toContain(
        `id="trade-${coin}"\${goldAttr}`,
      );
    }
  });
});

describe('a standing offer becomes a REVIEW surface for both sides', () => {
  const offer = {
    id: 7,
    usdCents: 100,
    tokens: 7812.5,
    role: 'buyer' as const,
    phase: 'review' as const,
    listingId: null,
    buyerAccepted: false,
    sellerAccepted: false,
  };

  it('renders the agreed price for the Money row, in the asked-for shape', () => {
    // "$1.00 (~ 7,812.5 $WOC)". The tilde is load-bearing: the token figure
    // is a preview, and the exact number is set by a fresh quote at payment.
    // The currency comes from the Intl formatter alone: a ' USD' suffix on
    // top of it doubled the code in every locale whose formatter already
    // spells USD (pl 'USD USD', en-CA 'US$1.00 USD').
    const text = wocTradeMoneyText(offer);
    expect(text).toContain(usdText(100));
    expect(text).not.toContain(`${usdText(100)} USD`);
    expect(text).toContain('7,812.5');
    expect(text).toContain('~');
  });

  it('falls back to the USD alone when no quote is available', () => {
    const text = wocTradeMoneyText({ ...offer, tokens: null });
    expect(text).toBe(usdText(100));
    expect(text).not.toContain('~');
  });

  it('renders nothing for the Money row when no offer stands', () => {
    expect(wocTradeMoneyText(null)).toBe('');
  });

  it('replaces the price form: you cannot stack a second offer on the first', () => {
    const root = paint(deps({ pendingOffer: offer }));
    expect(root.querySelector('#trade-woc-usd')).toBeNull();
    expect(root.querySelector('[data-woc-send]')).toBeNull();
  });

  it('gives the BUYER withdraw and no accept', () => {
    const root = paint(deps({ pendingOffer: offer }));
    expect(root.querySelector('[data-woc-cancel]')).toBeTruthy();
    expect(
      root.querySelector('[data-woc-accept]'),
      'a buyer must not accept their own offer',
    ).toBeNull();
  });

  it("adds NO accept button of its own: the window's Accept does the agreeing", () => {
    // A second accept control beside the trade window's own would be two ways to
    // say the same thing, and only one of them would drive the sim's state.
    for (const role of ['buyer', 'seller'] as const) {
      const root = paint(deps({ pendingOffer: { ...offer, role }, staged: [slot(EPIC.id)] }));
      expect(root.querySelector('[data-woc-accept]'), role).toBeNull();
    }
  });

  it('still tells the seller when they have nothing staged to accept with', () => {
    const root = paint(deps({ pendingOffer: { ...offer, role: 'seller' }, staged: [] }));
    expect(root.querySelector('[data-woc-hint]')?.textContent).toBe(
      t('hudChrome.trade.woc.hintAcceptNeedsItem'),
    );
  });

  it('tells the seller to leave ONE item when the table holds the sword plus a companion', () => {
    // The wrong-WHY repro: with the agreed item plainly staged beside a
    // companion, "add the item you are selling" contradicts the visible
    // table; the model's acceptHint picks the one_item copy instead and the
    // panel renders it verbatim.
    const root = paint(
      deps({
        pendingOffer: { ...offer, role: 'seller' },
        staged: [slot(EPIC.id), slot(EPIC.id)],
      }),
    );
    expect(root.querySelector('[data-woc-hint]')?.textContent).toBe(
      t('hudChrome.trade.woc.hintOneItem'),
    );
  });

  it('renders the accept WHY from the AUTHORITATIVE table, not the compose list', () => {
    // The pass-through pin: dropping stagedAuthoritative from
    // wocTradeModelFrom (or feeding it the compose list) renders '' here,
    // which is exactly the shipped wrong-WHY bug coming back. The compose
    // list is a clean single slot on purpose, so only the authoritative
    // two-slot table can produce the one_item copy.
    const root = paint(
      deps({
        pendingOffer: { ...offer, role: 'seller' },
        staged: [slot(EPIC.id)],
        stagedAuthoritative: [slot(EPIC.id), slot(EPIC.id)],
      }),
    );
    expect(root.querySelector('[data-woc-hint]')?.textContent).toBe(
      t('hudChrome.trade.woc.hintOneItem'),
    );
  });

  it('keeps every hint paragraph a polite live region', () => {
    // The accept WHY changes in place after a rebuild (the partner drops a
    // second item mid-review); without role=status the change is silent to a
    // screen reader until the user navigates back to it. Checked across the
    // arm shapes that render a hint, with a floor so an arm losing its hint
    // node entirely cannot pass vacuously.
    let seen = 0;
    for (const d of [deps(), deps({ pendingOffer: offer })]) {
      const root = paint(d);
      for (const hint of root.querySelectorAll('[data-woc-hint]')) {
        expect(hint.getAttribute('role')).toBe('status');
        seen += 1;
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('the controller feeds the accept arm the same authoritative-first read as the belt', () => {
    // Source pin on the ONE line that makes the model judge the table the
    // player is looking at; losing it silently reverts the hint to the
    // compose list while every behavioral suite stays green (the panel
    // tests above drive the model directly).
    expect(CONTROLLER).toContain(
      'stagedAuthoritative: this.sim.tradeInfo?.myOffer.items ?? this.stagedTrade.items,',
    );
  });

  it('reports a withdraw press', () => {
    const buyer = deps({ pendingOffer: offer });
    paint(buyer).querySelector<HTMLElement>('[data-woc-cancel]')?.click();
    expect(buyer.onCancelOffer).toHaveBeenCalled();
  });

  it('gives the SELLER a live Decline on the review face, and the buyer never sees it', () => {
    // H13's dead wiring: the seller had no way out of an incoming offer. Each
    // side gets exactly its own way out, never the other's.
    const seller = deps({ pendingOffer: { ...offer, role: 'seller' as const } });
    const sellerRoot = paint(seller);
    const decline = sellerRoot.querySelector<HTMLElement>('[data-woc-decline]');
    expect(decline?.textContent).toBe(t('hudChrome.trade.woc.decline'));
    expect(sellerRoot.querySelector('[data-woc-cancel]'), 'withdraw is the buyer verb').toBeNull();
    decline?.click();
    expect(seller.onDeclineOffer).toHaveBeenCalled();
    expect(seller.onCancelOffer).not.toHaveBeenCalled();
    const buyerRoot = paint(deps({ pendingOffer: offer }));
    expect(buyerRoot.querySelector('[data-woc-decline]')).toBeNull();
  });

  it('says when the offer lapses, and stays silent when the wire did not say', () => {
    const withExpiry = paint(deps({ pendingOffer: { ...offer, expiresAtMs: 1_800_000_000_000 } }));
    // The exact line, not merely "something": a swapped-in unrelated note
    // (the notInstant warn, say) must not satisfy the deadline promise.
    expect(withExpiry.querySelector('.trade-woc-note')?.textContent).toBe(
      t('hudChrome.trade.woc.offerExpiresAt', {
        time: formatDateTime(1_800_000_000_000, { timeStyle: 'short' }),
      }),
    );
    const without = paint(deps({ pendingOffer: offer }));
    // No fabricated deadline: absent means say nothing (the notInstant warn
    // still renders, so scope the check to the expiry note class).
    const notes = [...without.querySelectorAll('.trade-woc-note')];
    expect(notes).toHaveLength(0);
  });
});

describe('the seller cancel-sale control', () => {
  const escrowed = {
    id: 7,
    usdCents: 100,
    tokens: 7812.5,
    role: 'seller' as const,
    phase: 'awaiting_payment' as const,
    listingId: 41,
    buyerAccepted: true,
    sellerAccepted: true,
  };

  it('renders for the seller while the buyer has not paid, and reports the press', () => {
    const d = deps({ pendingOffer: escrowed });
    const root = paint(d);
    const btn = root.querySelector<HTMLElement>('[data-woc-cancel-sale]');
    expect(btn?.textContent).toBe(t('hudChrome.trade.woc.cancelSale'));
    btn?.click();
    expect(d.onCancelSale).toHaveBeenCalled();
  });

  it('disappears once a payment is in flight, and never renders for the buyer', () => {
    // The server would refuse settlement_in_flight; offering the button then
    // is a control that cannot work.
    const payingSeller = paint(deps({ pendingOffer: { ...escrowed, phase: 'paying' as const } }));
    expect(payingSeller.querySelector('[data-woc-cancel-sale]')).toBeNull();
    const buyer = paint(deps({ pendingOffer: { ...escrowed, role: 'buyer' as const } }));
    expect(buyer.querySelector('[data-woc-cancel-sale]')).toBeNull();
  });
});

describe('the below-minimum courtesy hint', () => {
  it('names the floor when the typed price is under it', () => {
    const d = deps({ usdCents: 50, minPriceCents: 100, theirStaged: [slot(EPIC.id)] });
    const root = paint(d);
    const hint = root.querySelector('[data-woc-hint]')?.textContent ?? '';
    expect(hint).toBe(t('hudChrome.trade.woc.hintBelowMin', { usd: usdText(100) }));
  });

  it('an unknown floor never blocks: no hint, send stays live', () => {
    const model = wocTradeModelFrom(deps({ usdCents: 50, minPriceCents: null }));
    expect(model.sendHint).toBeNull();
    expect(model.canSend).toBe(true);
  });

  it('at the floor exactly, the hint clears (the bound is exclusive)', () => {
    const model = wocTradeModelFrom(deps({ usdCents: 100, minPriceCents: 100 }));
    expect(model.sendHint).toBeNull();
  });
});

describe('the payment phase, in the window rather than elsewhere', () => {
  const paying = {
    id: 7,
    usdCents: 100,
    tokens: 7812.5,
    role: 'buyer' as const,
    phase: 'awaiting_payment' as const,
    listingId: 41,
    buyerAccepted: true,
    sellerAccepted: true,
  };

  it('gives the BUYER a pay button naming the agreed price', () => {
    const root = paint(deps({ pendingOffer: paying }));
    const btn = root.querySelector('[data-woc-pay]');
    expect(btn?.textContent).toContain('1.00');
  });

  it('gives the SELLER a waiting state and NO control', () => {
    // They can do nothing at this point, so offering a button would be a lie.
    const root = paint(deps({ pendingOffer: { ...paying, role: 'seller' } }));
    expect(root.querySelector('.trade-woc-waiting')?.textContent ?? '').not.toBe('');
    expect(root.querySelector('[data-woc-pay]')).toBeNull();
    expect(
      root.querySelector('[data-woc-cancel]'),
      'escrow is done; no withdrawing now',
    ).toBeNull();
    // And no accept hint either: the goods are escrowed, so the table is
    // CORRECTLY empty and the old add-the-item copy here was a lie. Only
    // this panel-level pin keeps a re-inlined hint expression from quietly
    // restoring it (the model-level null alone would not).
    expect(root.querySelector('[data-woc-hint]')?.textContent ?? '').toBe('');
  });

  it('shows both sides the settled state once paid', () => {
    for (const role of ['buyer', 'seller'] as const) {
      const root = paint(deps({ pendingOffer: { ...paying, role, phase: 'settled' } }));
      expect(root.querySelector('.trade-woc-done')?.textContent ?? '', role).not.toBe('');
      expect(root.querySelector('[data-woc-pay]'), role).toBeNull();
    }
  });

  it('offers NO action on a closed deal, for either side', () => {
    // The controller clears a closed offer synchronously, so this face should
    // be unreachable; the pin exists because without an explicit arm a closed
    // row falls through to the review face and offers Decline / Withdraw on a
    // listing the server already closed.
    const actions = [
      '[data-woc-decline]',
      '[data-woc-cancel]',
      '[data-woc-pay]',
      '[data-woc-sign]',
      '[data-woc-cancel-sale]',
      '[data-woc-send]',
    ];
    for (const role of ['buyer', 'seller'] as const) {
      const root = paint(deps({ pendingOffer: { ...paying, role, phase: 'closed' } }));
      for (const sel of actions) {
        expect(root.querySelector(sel), `${role} ${sel}`).toBeNull();
      }
    }
  });

  it('reports a pay press', () => {
    const d = deps({ pendingOffer: paying });
    paint(d).querySelector<HTMLElement>('[data-woc-pay]')?.click();
    expect(d.onPayOffer).toHaveBeenCalled();
  });

  it('never offers pay to the seller, nor before escrow', () => {
    // Paying before the goods are escrowed would take money for an item still
    // sitting in someone's bags.
    expect(wocTradeModelFrom(deps({ pendingOffer: { ...paying, role: 'seller' } })).canPay).toBe(
      false,
    );
    expect(
      wocTradeModelFrom(deps({ pendingOffer: { ...paying, phase: 'review', listingId: null } }))
        .canPay,
    ).toBe(false);
    // The case the listingId check alone does NOT catch: a settled offer still
    // carries its listing id, so without the phase test it would stay payable
    // and a second click would buy the same item twice.
    expect(wocTradeModelFrom(deps({ pendingOffer: { ...paying, phase: 'settled' } })).canPay).toBe(
      false,
    );
    expect(wocTradeModelFrom(deps({ pendingOffer: paying })).canPay).toBe(true);
  });

  it('takes the Pay button away once the payment is in flight', () => {
    // Otherwise a buyer watching a slow confirmation can press it again, which
    // takes a second lock and quote for one purchase.
    const model = wocTradeModelFrom(deps({ pendingOffer: { ...paying, phase: 'paying' } }));
    expect(model.canPay).toBe(false);
    expect(model.busy).toBe(true);
  });

  it('shows BOTH sides a pending face, in their own words', () => {
    // One sentence cannot honestly cover both: the buyer is waiting on their own
    // transaction, the seller on someone else's money.
    for (const role of ['buyer', 'seller'] as const) {
      const root = paint(deps({ pendingOffer: { ...paying, role, phase: 'paying' } }));
      const line = root.querySelector('.trade-woc-waiting');
      expect(line, role).not.toBeNull();
      expect(line?.textContent ?? '', role).not.toBe('');
      // Announced, because a chain confirmation is exactly the change a screen
      // reader user cannot otherwise perceive.
      expect(line?.getAttribute('role'), role).toBe('status');
      expect(root.querySelector('.woc-spinner'), role).not.toBeNull();
      expect(root.querySelector('[data-woc-pay]'), role).toBeNull();
    }
    // And the two sides do NOT read the same, which is the point of the split.
    const buyerText = paint(
      deps({ pendingOffer: { ...paying, role: 'buyer', phase: 'paying' } }),
    ).querySelector('.trade-woc-waiting')?.textContent;
    const sellerText = paint(
      deps({ pendingOffer: { ...paying, role: 'seller', phase: 'paying' } }),
    ).querySelector('.trade-woc-waiting')?.textContent;
    expect(buyerText).not.toBe(sellerText);
  });

  it('does not spin while merely waiting on the other player to act', () => {
    // Waiting on a human is not progress. A spinner there teaches the player
    // that the indicator means nothing.
    const seller = wocTradeModelFrom(
      deps({ pendingOffer: { ...paying, role: 'seller', phase: 'awaiting_payment' } }),
    );
    expect(seller.busy).toBe(false);
    expect(seller.statusKey).not.toBeNull();
    const root = paint(deps({ pendingOffer: { ...paying, role: 'seller' } }));
    expect(root.querySelector('.woc-spinner')).toBeNull();
  });
});

describe('the window follows a $WOC deal THROUGH acceptance', () => {
  // The two defects this pins, which compounded into a dead end in real play:
  // the client dropped any offer that was no longer 'pending', and a successful
  // acceptance closed the window. Between them the payment phase was
  // unreachable and both sides were left holding a stale offer id to press.
  it('polls accepted offers, not only pending ones (the selector decides)', () => {
    expect(CONTROLLER).toContain(
      'selectStandingWocOffer(res.offers, otherName, this.wocTradeFinished)',
    );
    expect(VIEW).toContain("o.status === 'pending' || o.status === 'accepted'");
  });

  it('does not cancel the trade when an acceptance succeeds', () => {
    // The acceptance handler must leave the window open; only the buyer's own
    // withdraw and the sim's own cancel may close it. Bounded at the NEXT
    // member so the window covers acceptWocTradeOffer alone.
    const accept = CONTROLLER.slice(
      CONTROLLER.indexOf('private async acceptWocTradeOffer'),
      CONTROLLER.indexOf('private async payWocTradeOffer'),
    );
    expect(accept).not.toContain('tradeCancel');
    expect(accept, 'it should advance the phase instead').toContain("phase: 'awaiting_payment'");
  });

  it('the SELLER acceptance mints and signs the step-up; the buyer sends none (B6/R1)', () => {
    const accept = CONTROLLER.slice(
      CONTROLLER.indexOf('private async acceptWocTradeOffer'),
      CONTROLLER.indexOf('private async payWocTradeOffer'),
    );
    // The mint sits INSIDE the seller-role branch, so a buyer accept stays
    // bearer-only (their money path signs its own payment later).
    const iRole = accept.indexOf("if (offer.role === 'seller') {", accept.indexOf('stepUpFields'));
    const iMint = accept.indexOf('client.stepUpChallenge({');
    const iSign = accept.indexOf('hooks.signMessageBase58(');
    const iSend = accept.indexOf('client.acceptOffer(');
    // The signer receives the SERVER message and the challenge nonce (the
    // desktop arm resolves the server-stored message by that nonce).
    expect(accept).toContain('issued.challenge.message,');
    expect(accept).toContain('issued.challenge.nonce,');
    expect(iRole, 'the seller-role gate').toBeGreaterThanOrEqual(0);
    expect(iMint, 'the mint').toBeGreaterThan(iRole);
    expect(iSign, 'the wallet signs the server message').toBeGreaterThan(iMint);
    expect(iSend, 'the accept send comes last').toBeGreaterThan(iSign);
    expect(accept).toContain("operation: 'accept_directed_offer'");
    expect(accept).toContain('stepUp: { nonce: issued.challenge.nonce, signature }');
    // Devsig is explicit-permission-only, and a wallet decline logs the
    // player-facing message with the catalog fallback.
    expect(accept).toContain('issued.challenge.signatureRequired === false');
    expect(accept).toContain('devsig:${issued.challenge.nonce}');
    // A wallet failure renders the CLASSIFIED sign-flavored line (whose
    // generic arm is signFailedConfirm, never the payment copy), and raw
    // err.message never renders; the raw error logs on the dev channel.
    expect(accept).toContain("walletBridgeErrorText(err, 'sign')");
    expect(accept).not.toContain('err.message');
    expect(accept).toContain('console.warn');
  });

  it('drives the Accept button from the OFFER, not the sim trade', () => {
    // A $WOC deal never confirms the sim trade, so info.myAccepted never moves:
    // reading it left the button saying "Accept" after the player had accepted.
    expect(CONTROLLER).toContain('wocModel.pendingOffer.buyerAccepted');
    expect(CONTROLLER).toContain('wocModel.pendingOffer.sellerAccepted');
  });

  it('closes the loop for BOTH sides when the sale completes', () => {
    // What shipped: the window simply emptied. Nothing said the payment had
    // landed, so the item looked like it had been sent for free.
    //
    // The CALL first, then the body. Asserting only on the method's contents
    // passes with nothing invoking it, which is the same silent no-op as the
    // bug: verified by deleting the call and watching this stay green.
    const poll = CONTROLLER.slice(
      CONTROLLER.indexOf('private pollWocTradeOffer'),
      CONTROLLER.indexOf('private finishWocTrade'),
    );
    expect(poll, 'the poll must act on the settle step').toContain("step.kind === 'settle'");
    expect(poll).toContain('this.finishWocTrade(mine)');
    expect(VIEW, 'and the settled phase is what maps to that step').toContain(
      "if (phase === 'settled') return { kind: 'settle' };",
    );
    const finish = CONTROLLER.slice(
      CONTROLLER.indexOf('private finishWocTrade'),
      CONTROLLER.indexOf('private resolveClosedWocTrade'),
    );
    expect(finish, 'a seller line and a buyer line, not one shared line').toContain(
      'hudChrome.trade.woc.paidSeller',
    );
    expect(finish).toContain('hudChrome.trade.woc.paidBuyer');
    // The tokens moved on-chain, so the footer figure is stale for both of them.
    expect(finish, 'the bag balance must be re-read').toContain('refreshWocBalance');
    // And the window goes away, since it has nothing left to offer.
    expect(finish, 'ends the session (as a close, pinned separately below)').toContain(
      'this.sim.tradeClose()',
    );
  });

  it('reports a finished sale exactly once, and never re-opens it', () => {
    // The row lingers server-side for a grace window so both clients can see it
    // complete. Without a retired-id set the poll re-adopts it every 2s: the
    // window reopens, the message repeats, and the pair cannot start a new deal.
    expect(CONTROLLER).toContain('wocTradeFinished');
    const finish = CONTROLLER.slice(
      CONTROLLER.indexOf('private finishWocTrade'),
      CONTROLLER.indexOf('private resolveClosedWocTrade'),
    );
    expect(finish, 'an early return on an already-reported id').toContain(
      'if (this.wocTradeFinished.has(row.id)) return;',
    );
    expect(CONTROLLER, 'and the poll must pass the retired-id set to the selector').toContain(
      'selectStandingWocOffer(res.offers, otherName, this.wocTradeFinished)',
    );
    expect(VIEW, 'which skips retired ids').toContain('!finished.has(o.id)');
  });

  it('the repaint signature projects the quote structurally and carries the in-flight flags', () => {
    // The seam round's anti-property: the sig rides the quote's FIGURES, never
    // the transaction blob (serializing it every medium-band pass buys no
    // repaint), and the Pay / resolve / cancel-pending flags are render state
    // (a pressed button that keeps reading pressable is the elision bug).
    const sig = CONTROLLER.slice(
      CONTROLLER.indexOf('const sig = JSON.stringify(['),
      CONTROLLER.indexOf('if (sig === this.lastTradeSig) return;'),
    );
    expect(sig.length).toBeGreaterThan(0);
    expect(sig).toContain('this.wocTradeQuote.totalTokens');
    expect(sig).toContain('this.wocTradeQuote.expiresAtMs');
    expect(sig).not.toContain('transactionBase64');
    expect(sig).toContain('this.wocTradeSettlement.deadlineAtMs');
    for (const flag of [
      'this.wocTradePaying',
      'this.wocTradeResolving',
      'this.wocTradeCancelPendingFor',
      'this.wocTradeAccepting',
    ]) {
      expect(sig, flag).toContain(flag);
    }
  });

  it('resolves the outcome even when the OTHER side closed the window first', () => {
    // The race that shipped: finishWocTrade ends the trade for both players, and
    // the offer poll runs only while a trade is open. Whichever side noticed
    // 'settled' second had its window closed out from under it and never ran
    // finishWocTrade at all: no payment line, no balance refresh, a stale bag.
    // The recovery must therefore hang off the CLOSE path, not the poll.
    const close = CONTROLLER.slice(
      CONTROLLER.indexOf('private resolveClosedWocTrade'),
      CONTROLLER.indexOf('private async acceptWocTradeOffer'),
    );
    expect(close, 'it re-reads the offer off the window entirely').toContain('client.offers()');
    expect(close).toContain("if (phase === 'settled')");
    expect(close).toContain('this.finishWocTrade(row)');
    // The dead-deal twin: a cancelled/suspended/unpaid close found after the
    // window closed reports its honest reason, never the paid line.
    expect(close).toContain("if (phase === 'closed')");
    expect(close).toContain('this.finishClosedWocTrade(row)');
    // And the cleanup branch must actually call it, or it is dead code.
    const updateStart = CONTROLLER.indexOf('updateTradeWindow(): void {');
    // updateTradeWindow is the LAST member, so the method close is the file's
    // last two-space-indented brace: an end bound template-literal content
    // inside the body can never fake (it all sits before the close). The tail
    // assertion fails loudly if a member ever lands after the method, forcing
    // this bound to be re-derived rather than silently mis-slicing.
    const updateEnd = CONTROLLER.lastIndexOf('\n  }');
    expect(updateStart).toBeGreaterThan(-1);
    expect(updateEnd).toBeGreaterThan(updateStart);
    expect(CONTROLLER.slice(updateEnd).trimEnd()).toBe('\n  }\n}');
    // BOTH bounds must agree: first-match could only end EARLY (template
    // content), last-match could only end LATE (an appended member keeps the
    // tail shape identical). A disagreement is loud instead of a silent
    // widening or narrowing.
    expect(CONTROLLER.indexOf('\n  }', updateStart)).toBe(updateEnd);
    const update = CONTROLLER.slice(updateStart, updateEnd);
    expect(update, 'the window-closed branch must invoke it').toContain(
      'this.resolveClosedWocTrade(this.wocTradeSigning)',
    );
  });

  it('ends a COMPLETED trade with a close, never a cancellation', () => {
    // "Trade cancelled." contradicts the payment line printed a moment earlier,
    // and both players saw it.
    const finish = CONTROLLER.slice(
      CONTROLLER.indexOf('private finishWocTrade'),
      CONTROLLER.indexOf('private resolveClosedWocTrade'),
    );
    expect(finish).toContain('this.sim.tradeClose()');
    expect(finish).not.toContain('tradeCancel');
    // Positive control: the scanner CAN see the cancel token where it lives
    // (the cancel-button wiring), so the absence above is a real absence and
    // survives a future move of the cancel wiring.
    expect(CONTROLLER).toContain('this.sim.tradeCancel()');
  });

  it('does not announce DELIVERY while the chain is still confirming', () => {
    // The mirror of the loss that cost real money: a correct payment can come
    // back still confirming, and "on its way by mail" is a claim about
    // delivery. The ladder: review parks to its own line, only 'confirming'
    // takes the pending mapper, a CONFIRMED or DELIVERING answer takes its
    // own decided-but-undelivered sentence (claiming the mail before the
    // finalize ran was the softer half of the same lie), and only the
    // remaining decided arm (delivered; a failed retry is refused
    // server-side and never reaches the ok arm) takes the settled line.
    const pay = CONTROLLER.slice(
      CONTROLLER.indexOf('private async payWocTradeOffer'),
      CONTROLLER.indexOf('private async cancelWocTradeOffer'),
    );
    expect(pay).toContain("done.state === 'review'");
    expect(pay).toContain("done.state === 'confirming'");
    expect(pay).toContain('wocPaymentPendingText(done.reason)');
    expect(pay).toContain('hudChrome.wocMarket.settlementReview');
    expect(pay).toContain("done.state === 'confirmed' || done.state === 'delivering'");
    expect(pay).toContain('hudChrome.trade.woc.paymentConfirmed');
    // The pending arm must be decided BEFORE the confirmed arm, and that
    // before the settled else-arm.
    expect(pay.indexOf("done.state === 'confirming'")).toBeLessThan(
      pay.indexOf('hudChrome.trade.woc.paymentConfirmed'),
    );
    expect(pay.indexOf('hudChrome.trade.woc.paymentConfirmed')).toBeLessThan(
      pay.indexOf('hudChrome.trade.woc.settled'),
    );
    // The held offer adopts the answered settlement state, so the status
    // sentence stops claiming "confirming" for decided money.
    expect(pay).toContain('settlementState: done.state');
    // And the buyer sees the pending face the instant they commit, not when a
    // poll next happens to notice.
    expect(pay).toContain("phase: 'paying'");
    // The payment path may never cancel the trade either (coverage the accept
    // window held incidentally before it was narrowed to accept alone).
    expect(pay).not.toContain('tradeCancel');
  });
});

describe('the wallet is skipped only on explicit server permission', () => {
  it('requires an explicit false, so an absent flag still signs', () => {
    // Fail-safe direction: a service that omits the field is not saying "no
    // signature needed". A truthiness check here would skip signing whenever
    // the field were missing, which is the one mistake that must not happen.
    // The staged (reviewed) quote carries the flag; the sign step reads it.
    expect(CONTROLLER).toContain('staged.signatureRequired === false');
    expect(CONTROLLER).not.toContain('!staged.signatureRequired');
    expect(CONTROLLER).not.toContain('!quoted.quote.signatureRequired');
  });

  it('paints the estimate red and kills Send when the wallet is short', () => {
    const root = paint(deps({ tokens: 6000, walletTokens: 10 }));
    const equiv = root.querySelector('[data-woc-equiv]');
    expect(equiv?.classList.contains('over-balance')).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('[data-woc-send]')?.disabled).toBe(true);
    // Never colour alone: the hint states the reason in words.
    expect(root.querySelector('[data-woc-hint]')?.textContent ?? '').not.toBe('');
  });

  it('clears the red once the price comes back within the balance', () => {
    // The class is toggled, not only added: a shortfall that resolves must stop
    // looking like one.
    const d = deps({ tokens: 6000, walletTokens: 10 });
    const root = paint(d);
    expect(root.querySelector('[data-woc-equiv]')?.classList.contains('over-balance')).toBe(true);
    refreshWocTradeArm(root, wocTradeModelFrom({ ...d, tokens: 5 }));
    expect(root.querySelector('[data-woc-equiv]')?.classList.contains('over-balance')).toBe(false);
  });

  it('leaves the estimate alone while the balance is unknown', () => {
    const root = paint(deps({ tokens: 6000, walletTokens: null }));
    expect(root.querySelector('[data-woc-equiv]')?.classList.contains('over-balance')).toBe(false);
    expect(root.querySelector<HTMLButtonElement>('[data-woc-send]')?.disabled).toBe(false);
  });

  it('reads the VERIFIED balance, not a merely-connected wallet', () => {
    // An unverified figure belongs to a wallet that will not be paying, so
    // gating on it would refuse (or permit) the wrong offer.
    expect(CONTROLLER).toContain('walletTokens: verifiedWocBalance()');
  });

  it('disables the Gold TAB once a $WOC deal stands, for either side', () => {
    const standing = {
      id: 7,
      usdCents: 100,
      tokens: null,
      role: 'seller' as const,
      phase: 'review' as const,
      listingId: null,
      buyerAccepted: false,
      sellerAccepted: false,
    };
    for (const role of ['buyer', 'seller'] as const) {
      const root = paint(deps({ mode: 'gold', pendingOffer: { ...standing, role } }));
      expect(root.querySelector<HTMLButtonElement>('[data-woc-mode="gold"]')?.disabled, role).toBe(
        true,
      );
    }
  });

  it('leaves the Gold tab pressable while a price is only being composed', () => {
    // The way back out of the arm. Losing it was a regression this pins.
    const root = paint(deps({ mode: 'woc', usdCents: 500 }));
    expect(root.querySelector<HTMLButtonElement>('[data-woc-mode="gold"]')?.disabled).toBe(false);
  });

  it('disables the $WOC tab when only the PARTNER has gold down', () => {
    // Their coin, not yours: the arm still has to close.
    const root = paint(deps({ mode: 'gold', goldCopper: 0, partnerGoldCopper: 500 }));
    expect(root.querySelector<HTMLButtonElement>('[data-woc-mode="woc"]')?.disabled).toBe(true);
  });

  it('reads the partner gold from the shared trade state, not a local echo', () => {
    expect(CONTROLLER).toContain('partnerGoldCopper: this.sim.tradeInfo?.theirOffer.copper ?? 0');
  });

  it('hides the coin inputs for BOTH sides once a $WOC deal stands', () => {
    // Gold and $WOC are mutually exclusive, so the fields are removed rather
    // than left greyed beside an amount in another currency. Keyed on the DEAL,
    // not on whose money row shows the figure: the seller's row shows nothing,
    // so the earlier wocMoneyMine test left their coin fields on screen under a
    // deal priced in $WOC.
    expect(CONTROLLER).toContain('class="trade-coins"${wocModel.wocDealStanding');
  });
});

describe('the Hud side of the seam, and the E2E reach-through', () => {
  it('Hud hands the controller the LIVE staged object, never a copy', () => {
    // The deps contract (WocTradeControllerDeps.staged) requires the live
    // object: the unstage click and the coin-input write mutate it in place.
    // The controller side is pinned behaviorally in
    // tests/woc_trade_controller.test.ts; this is the HUD side, where a
    // defensive spread would break item unstaging with every test still green.
    const HUD_TS = stripComments(readFileSync('src/ui/hud.ts', 'utf8'));
    const pin = 'staged: () => this.stagedTrade,';
    expect(HUD_TS.split(pin).length - 1, 'exactly one live-object staged binding').toBe(1);
  });

  it('the E2E scripts reach the controller under the names the source keeps', () => {
    // scripts/*.mjs are outside tsc and outside the gate: a rename of the
    // wocTrade field or the lastTradeSig latch breaks them silently. The
    // source-side names are pinned by tests/hud_update_drive.test.ts; this
    // pins the SCRIPT side of the same coupling so the two stay linked.
    // Stripped like every other read here: a header comment mentioning the
    // reach-through must not satisfy the pin.
    const moneyShot = stripComments(readFileSync('scripts/trade_money_shot.mjs', 'utf8'));
    expect(moneyShot).toContain('hud.wocTrade.updateTradeWindow()');
    expect(moneyShot).toContain('hud.wocTrade.lastTradeSig');
    const localization = stripComments(readFileSync('scripts/localization_e2e.mjs', 'utf8'));
    expect(localization).toContain('hud.wocTrade.updateTradeWindow()');
  });
});

describe('the consent row and the quote review (R9 + informed commitment)', () => {
  const payable = {
    id: 7,
    usdCents: 100,
    tokens: 7812.5,
    role: 'buyer' as const,
    phase: 'awaiting_payment' as const,
    listingId: 41,
    buyerAccepted: true,
    sellerAccepted: true,
  };

  it('the compose face shows the consent row with a live terms link until accepted', () => {
    const d = deps({ termsAccepted: false });
    const root = paint(d);
    const box = root.querySelector<HTMLInputElement>('[data-woc-terms]');
    expect(box).not.toBeNull();
    const link = root.querySelector<HTMLAnchorElement>('.trade-woc-terms-link');
    expect(link?.getAttribute('href')).toBe('/terms');
    // Off-site in a new tab with no opener: the game keeps running (the
    // deal is live), and the terms page never gets a handle on the game.
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    box?.click();
    box?.dispatchEvent(new Event('change'));
    expect(d.onTermsChange).toHaveBeenCalledWith(true);
  });

  it('durable acceptance hides the row (the Exchange checkbox contract)', () => {
    expect(paint(deps({ termsAccepted: true })).querySelector('[data-woc-terms]')).toBeNull();
  });

  it('the pay face carries the consent row too: buyNow is terms-gated server-side', () => {
    const root = paint(deps({ termsAccepted: false, pendingOffer: payable }));
    expect(root.querySelector('[data-woc-pay]')).not.toBeNull();
    expect(root.querySelector('[data-woc-terms]')).not.toBeNull();
    // The SELLER's surfaces never show it: their accept is not terms-gated.
    const seller = paint(
      deps({ termsAccepted: false, pendingOffer: { ...payable, role: 'seller' as const } }),
    );
    expect(seller.querySelector('[data-woc-terms]')).toBeNull();
  });

  it('a staged quote replaces Pay with the review panel: total, expiry, sign, back out', () => {
    const d = deps({
      pendingOffer: payable,
      quote: {
        sellerTokens: null,
        burnTokens: null,
        treasuryTokens: null,
        totalTokens: 812.5,
        usdCents: 100,
        expiresAtMs: 1_800_000_000_000,
      },
    });
    const root = paint(d);
    expect(root.querySelector('[data-woc-pay]'), 'Pay yields to the review').toBeNull();
    const text = root.textContent ?? '';
    expect(text).toContain('812.5');
    // The quote's own expiry, in the shared Exchange wording, and the title
    // announced (role=status) so a screen reader hears the face swap.
    expect(text).toContain(
      t('hudChrome.wocMarket.quoteExpiresAt', {
        time: formatDateTime(1_800_000_000_000, { timeStyle: 'short' }),
      }),
    );
    expect(
      [...root.querySelectorAll<HTMLElement>('p[role="status"]')].map((p) => p.textContent),
    ).toContain(t('hudChrome.wocMarket.quoteTitle'));
    const sign = root.querySelector<HTMLElement>('[data-woc-sign]');
    expect(sign?.textContent).toBe(t('hudChrome.wocMarket.quoteSign'));
    sign?.click();
    expect(d.onSignQuote).toHaveBeenCalled();
    root.querySelector<HTMLElement>('[data-woc-quote-cancel]')?.click();
    expect(d.onQuoteCancel).toHaveBeenCalled();
  });

  it('a quote with no expiry on the wire says nothing about lapsing (no fabricated deadline)', () => {
    const root = paint(
      deps({
        pendingOffer: payable,
        quote: {
          sellerTokens: null,
          burnTokens: null,
          treasuryTokens: null,
          totalTokens: 812.5,
          usdCents: 100,
          expiresAtMs: null,
        },
      }),
    );
    expect(root.querySelector('[data-woc-sign]'), 'the review still renders').not.toBeNull();
    const prefix = t('hudChrome.wocMarket.quoteExpiresAt', { time: 'X' }).split('X')[0].trim();
    expect(prefix.length).toBeGreaterThan(0);
    expect(root.textContent ?? '').not.toContain(prefix);
  });

  it('the review never renders on the seller side: the quote is the buyer money', () => {
    const root = paint(
      deps({
        pendingOffer: { ...payable, role: 'seller' as const },
        quote: {
          sellerTokens: null,
          burnTokens: null,
          treasuryTokens: null,
          totalTokens: 812.5,
          usdCents: 100,
          expiresAtMs: null,
        },
      }),
    );
    expect(root.querySelector('[data-woc-sign]')).toBeNull();
  });
});

describe('the QA round faces: pressed Pay, expired Sign, keyed controls', () => {
  const escrowed = {
    id: 7,
    usdCents: 100,
    tokens: 7812.5,
    role: 'buyer' as const,
    phase: 'awaiting_payment' as const,
    listingId: 41,
    buyerAccepted: true,
    sellerAccepted: true,
  };
  const quote: WocTradeQuoteReview = {
    totalTokens: 5000,
    sellerTokens: null,
    burnTokens: null,
    treasuryTokens: null,
    usdCents: 100,
    expiresAtMs: 1_000,
  };

  it('disables the pressed Pay button and spins while the claim round trips', () => {
    const busy = paint(deps({ pendingOffer: escrowed, paying: true }));
    const btn = busy.querySelector<HTMLButtonElement>('[data-woc-pay]');
    expect(btn?.disabled).toBe(true);
    expect(btn?.querySelector('.woc-spinner')).not.toBeNull();
    const idle = paint(deps({ pendingOffer: escrowed }));
    const idleBtn = idle.querySelector<HTMLButtonElement>('[data-woc-pay]');
    expect(idleBtn?.disabled).toBe(false);
    expect(idleBtn?.querySelector('.woc-spinner')).toBeNull();
  });

  it('the claim in flight makes the model busy; an idle wait does not', () => {
    expect(wocTradeModelFrom(deps({ pendingOffer: escrowed, paying: true })).busy).toBe(true);
    expect(wocTradeModelFrom(deps({ pendingOffer: escrowed })).busy).toBe(false);
  });

  it('quoteExpired needs a real lapse: an absent clock or expiry never fires it', () => {
    const at = (nowMs?: number, q = quote) =>
      wocTradeModelFrom(deps({ pendingOffer: escrowed, quote: q, nowMs })).quoteExpired;
    expect(at(2_000)).toBe(true);
    expect(at(500)).toBe(false);
    expect(at(undefined)).toBe(false);
    expect(at(2_000, { ...quote, expiresAtMs: null })).toBe(false);
  });

  it('renders Sign disabled once the staged quote lapsed at paint time', () => {
    const lapsed = paint(deps({ pendingOffer: escrowed, quote, nowMs: 2_000 }));
    expect(lapsed.querySelector<HTMLButtonElement>('[data-woc-sign]')?.disabled).toBe(true);
    const live = paint(deps({ pendingOffer: escrowed, quote, nowMs: 500 }));
    expect(live.querySelector<HTMLButtonElement>('[data-woc-sign]')?.disabled).toBe(false);
  });

  it('keys every actionable control so a rebuild cannot drop focus to body', () => {
    const has = (root: HTMLElement, sel: string): void => {
      expect(root.querySelector(sel), sel).not.toBeNull();
    };
    const compose = paint(deps({ termsAccepted: false }));
    has(compose, '[data-woc-send][data-focus-key="trade-woc-send"]');
    has(compose, '[data-woc-terms][data-focus-key="trade-woc-terms"]');
    const pay = paint(deps({ pendingOffer: escrowed }));
    has(pay, '[data-woc-pay][data-focus-key="trade-woc-pay"]');
    const seller = paint(deps({ pendingOffer: { ...escrowed, role: 'seller' as const } }));
    has(seller, '[data-woc-cancel-sale][data-focus-key="trade-woc-cancel-sale"]');
    const reviewBuyer = paint(
      deps({ pendingOffer: { ...escrowed, phase: 'review' as const, listingId: null } }),
    );
    has(reviewBuyer, '[data-woc-cancel][data-focus-key="trade-woc-withdraw"]');
    const reviewSeller = paint(
      deps({
        pendingOffer: {
          ...escrowed,
          phase: 'review' as const,
          listingId: null,
          role: 'seller' as const,
        },
      }),
    );
    has(reviewSeller, '[data-woc-decline][data-focus-key="trade-woc-decline"]');
    const quoteFace = paint(
      deps({ pendingOffer: escrowed, quote: { ...quote, expiresAtMs: null } }),
    );
    has(quoteFace, '[data-woc-sign][data-focus-key="trade-woc-sign"]');
    has(quoteFace, '[data-woc-quote-cancel][data-focus-key="trade-woc-quote-cancel"]');
  });

  it('carries the consent checkbox focus across a rebuild', () => {
    const d = deps({ termsAccepted: false, pendingOffer: escrowed });
    const root = paint(d);
    document.body.appendChild(root);
    root.querySelector<HTMLInputElement>('[data-woc-terms]')?.focus();
    const key = captureFocusKey(root);
    expect(key).toBe('trade-woc-terms');
    root.innerHTML = wocTradeArmHtml(wocTradeModelFrom(d), d.usdCents);
    restoreWocTradeFocus(root, key);
    expect(document.activeElement?.hasAttribute('data-woc-terms')).toBe(true);
  });
});

describe('the QA session faces: fee block, commitment note, quote legs, focus ladder', () => {
  const escrowed = {
    id: 7,
    usdCents: 100,
    tokens: 7812.5,
    role: 'buyer' as const,
    phase: 'awaiting_payment' as const,
    listingId: 41,
    buyerAccepted: true,
    sellerAccepted: true,
  };
  const review = { ...escrowed, phase: 'review' as const, listingId: null };
  const split = { sellerCents: 90, burnCents: 7, treasuryCents: 3 };

  it("the review face carries the fee and the net for BOTH sides, in each side's own words", () => {
    // The seller commits by accepting, so the fee and THEIR net must be on
    // the review face before that click; the buyer reads the seller's net.
    const seller = paint(
      deps({ pendingOffer: { ...review, role: 'seller' }, split, mode: 'gold' }),
    );
    expect(seller.querySelector('[data-woc-fee]')?.textContent).toBe(
      t('hudChrome.trade.woc.feeLine', { fee: usdText(10) }),
    );
    expect(seller.querySelector('[data-woc-net]')?.textContent).toBe(
      t('hudChrome.trade.woc.netLine', { net: usdText(90) }),
    );
    const buyer = paint(deps({ pendingOffer: review, split, mode: 'gold' }));
    expect(buyer.querySelector('[data-woc-net]')?.textContent).toBe(
      t('hudChrome.trade.woc.netLineBuyer', { net: usdText(90) }),
    );
    // The waiting faces carry the block too; an unknown split renders nothing.
    const waiting = paint(
      deps({ pendingOffer: { ...escrowed, role: 'seller' }, split, mode: 'gold' }),
    );
    expect(waiting.querySelector('[data-woc-net]')?.textContent).toContain(usdText(90));
    const unknown = paint(deps({ pendingOffer: review, split: null, mode: 'gold' }));
    expect(unknown.querySelector('[data-woc-net]')?.textContent).toBe('');
    // The compose face (the buyer's) reads the seller's net as well.
    const compose = paint(deps({ split }));
    expect(compose.querySelector('[data-woc-net]')?.textContent).toBe(
      t('hudChrome.trade.woc.netLineBuyer', { net: usdText(90) }),
    );
  });

  it('the buyer reads the payment hold and the strike BEFORE the shared Accept, and on the pay face', () => {
    const timed = paint(deps({ pendingOffer: review, directedHoldSeconds: 600 }));
    expect(timed.querySelector('[data-woc-binding]')?.textContent).toBe(
      t('hudChrome.trade.woc.p2pBindingNote', { duration: durationText(600) }),
    );
    const untimed = paint(deps({ pendingOffer: review, directedHoldSeconds: null }));
    expect(untimed.querySelector('[data-woc-binding]')?.textContent).toBe(
      t('hudChrome.trade.woc.p2pBindingNoteUntimed'),
    );
    const pay = paint(deps({ pendingOffer: escrowed, directedHoldSeconds: 600 }));
    expect(pay.querySelector('[data-woc-binding]')?.textContent).toContain(durationText(600));
    // Never for the seller (their accept is not the one that owes payment).
    const seller = paint(deps({ pendingOffer: { ...review, role: 'seller' } }));
    expect(seller.querySelector('[data-woc-binding]')).toBeNull();
    // A hold figure that never renders raw seconds; a zero or negative hold
    // is no figure at all (the untimed twin).
    expect(durationText(600)).not.toContain('600');
    for (const bad of [0, -5]) {
      const zero = paint(deps({ pendingOffer: review, directedHoldSeconds: bad }));
      expect(zero.querySelector('[data-woc-binding]')?.textContent, String(bad)).toBe(
        t('hudChrome.trade.woc.p2pBindingNoteUntimed'),
      );
    }
    // Once a claim exists, its OWN deadline replaces the note on the pay face
    // (the pressed Pay shortened the window) and the quote face shows it too.
    const claimed = paint(deps({ pendingOffer: escrowed, paymentDueAtMs: 1_800_000_270_000 }));
    const due = t('hudChrome.trade.woc.p2pPaymentDueAt', {
      time: formatDateTime(1_800_000_270_000, { timeStyle: 'short' }),
    });
    expect(claimed.textContent).toContain(due);
    expect(claimed.querySelector('[data-woc-binding]')).toBeNull();
    const quoteFace = paint(
      deps({
        pendingOffer: escrowed,
        paymentDueAtMs: 1_800_000_270_000,
        quote: {
          totalTokens: 1,
          sellerTokens: null,
          burnTokens: null,
          treasuryTokens: null,
          usdCents: 100,
          expiresAtMs: null,
        },
      }),
    );
    expect(quoteFace.textContent).toContain(due);
    // Never on the seller's face, and never for the review (pre-claim) face.
    const sellerWait = paint(
      deps({ pendingOffer: { ...escrowed, role: 'seller' }, paymentDueAtMs: 1_800_000_270_000 }),
    );
    expect(sellerWait.textContent).not.toContain(due);
  });

  it('the quote face shows the fee legs beside the total, and says so when the quote lapsed', () => {
    const quote: WocTradeQuoteReview = {
      totalTokens: 5000,
      sellerTokens: 4500,
      burnTokens: 350,
      treasuryTokens: 150,
      usdCents: 100,
      expiresAtMs: 1_000,
    };
    const live = paint(deps({ pendingOffer: escrowed, quote, nowMs: 500 }));
    const text = live.textContent ?? '';
    expect(text).toContain(t('hudChrome.wocMarket.quoteSeller', { tokens: '4,500' }));
    expect(text).toContain(t('hudChrome.wocMarket.quoteBurn', { tokens: '350' }));
    expect(text).toContain(t('hudChrome.wocMarket.quoteTreasury', { tokens: '150' }));
    expect(text).not.toContain(t('hudChrome.trade.woc.quoteExpiredTrade'));
    // No consent row here: the claim that staged the quote was the
    // terms-gated send, so acceptance is durable by the time it renders.
    expect(live.querySelector('[data-woc-terms]')).toBeNull();
    // In this arm's own words: no request control here, the way back is Not
    // now, then Pay.
    const lapsed = paint(deps({ pendingOffer: escrowed, quote, nowMs: 2_000 }));
    expect(lapsed.textContent).toContain(t('hudChrome.trade.woc.quoteExpiredTrade'));
    expect(lapsed.textContent).not.toContain(t('hudChrome.wocMarket.quoteExpired'));
    expect(lapsed.querySelector<HTMLButtonElement>('[data-woc-sign]')?.disabled).toBe(true);
    // Absent legs render nothing (an older service answers no split), and a
    // leg a stub left UNDEFINED renders nothing rather than NaN.
    const bare = paint(
      deps({
        pendingOffer: escrowed,
        quote: { ...quote, sellerTokens: null, burnTokens: null, treasuryTokens: null },
      }),
    );
    expect(bare.textContent).not.toContain('Seller receives');
    const undef = paint(
      deps({
        pendingOffer: escrowed,
        quote: {
          ...quote,
          sellerTokens: undefined as unknown as null,
          burnTokens: undefined as unknown as null,
          treasuryTokens: undefined as unknown as null,
        },
      }),
    );
    expect(undef.textContent).not.toContain('NaN');
    expect(undef.textContent).not.toContain('Seller receives');
  });

  it('a resolve in flight disables Decline, Withdraw and Cancel sale (one click, one request)', () => {
    const decline = paint(
      deps({ pendingOffer: { ...review, role: 'seller' }, resolving: true, mode: 'gold' }),
    );
    expect(decline.querySelector<HTMLButtonElement>('[data-woc-decline]')?.disabled).toBe(true);
    const withdraw = paint(deps({ pendingOffer: review, resolving: true, mode: 'gold' }));
    expect(withdraw.querySelector<HTMLButtonElement>('[data-woc-cancel]')?.disabled).toBe(true);
    const cancelSale = paint(
      deps({ pendingOffer: { ...escrowed, role: 'seller' }, resolving: true, mode: 'gold' }),
    );
    expect(cancelSale.querySelector<HTMLButtonElement>('[data-woc-cancel-sale]')?.disabled).toBe(
      true,
    );
    const idle = paint(deps({ pendingOffer: { ...review, role: 'seller' }, mode: 'gold' }));
    expect(idle.querySelector<HTMLButtonElement>('[data-woc-decline]')?.disabled).toBe(false);
  });

  it('a pending cancel is RECORDED on the seller face: Cancel sale withdrawn, the wait says so', () => {
    const pending = paint(
      deps({ pendingOffer: { ...escrowed, role: 'seller' }, cancelPending: true, mode: 'gold' }),
    );
    expect(pending.querySelector('[data-woc-cancel-sale]')).toBeNull();
    expect(pending.querySelector('.trade-woc-waiting')?.textContent).toBe(
      t('hudChrome.trade.woc.cancelPendingSeller'),
    );
    const model = wocTradeModelFrom(
      deps({ pendingOffer: { ...escrowed, role: 'seller' }, cancelPending: true, mode: 'gold' }),
    );
    expect(model.busy, 'a pending cancel is a wait, not progress').toBe(false);
    // The buyer's face is untouched by the seller's local mark.
    const buyer = paint(deps({ pendingOffer: escrowed, cancelPending: true }));
    expect(buyer.querySelector('[data-woc-pay]')).not.toBeNull();
  });

  it('a payment under review reads as parked, per side, with no spinner', () => {
    for (const role of ['buyer', 'seller'] as const) {
      const d = deps({
        pendingOffer: { ...escrowed, role, phase: 'paying', settlementState: 'review' },
        mode: 'gold',
      });
      const model = wocTradeModelFrom(d);
      expect(model.statusKey).toBe(
        role === 'buyer'
          ? 'hudChrome.trade.woc.statusReviewBuyer'
          : 'hudChrome.trade.woc.statusReviewSeller',
      );
      expect(model.busy).toBe(false);
      expect(paint(d).querySelector('.woc-spinner')).toBeNull();
    }
    // Confirming still spins, and a delivered answer reads as decided money.
    const confirming = wocTradeModelFrom(
      deps({ pendingOffer: { ...escrowed, phase: 'paying', settlementState: 'confirming' } }),
    );
    expect(confirming.busy).toBe(true);
    expect(confirming.statusKey).toBe('hudChrome.trade.woc.statusPayingBuyer');
    const delivered = wocTradeModelFrom(
      deps({ pendingOffer: { ...escrowed, phase: 'paying', settlementState: 'delivered' } }),
    );
    expect(delivered.statusKey).toBe('hudChrome.trade.woc.statusConfirmedBuyer');
  });

  it('the settled face speaks per side (the copy went to the BUYER)', () => {
    const buyer = paint(deps({ pendingOffer: { ...escrowed, phase: 'settled' } }));
    expect(buyer.textContent).toContain(t('hudChrome.trade.woc.settled'));
    const seller = paint(deps({ pendingOffer: { ...escrowed, phase: 'settled', role: 'seller' } }));
    expect(seller.textContent).toContain(t('hudChrome.trade.woc.settledSeller'));
    expect(seller.textContent).not.toContain(t('hudChrome.trade.woc.settled'));
  });

  it('a rebuild that retires the focused control lands focus on the ladder, never on body', () => {
    // Pressed Pay renders disabled through the claim: the single-candidate
    // restore of old dropped focus to body; the ladder catches it.
    const d = deps({ pendingOffer: escrowed });
    const root = paint(d);
    document.body.appendChild(root);
    root.querySelector<HTMLButtonElement>('[data-woc-pay]')?.focus();
    const key = captureFocusKey(root);
    expect(key).toBe('trade-woc-pay');
    const busy = deps({ pendingOffer: escrowed, paying: true, termsAccepted: false });
    root.innerHTML = wocTradeArmHtml(wocTradeModelFrom(busy), busy.usdCents);
    restoreWocTradeFocus(root, key);
    expect(document.activeElement, 'not body').not.toBe(document.body);
    expect(root.contains(document.activeElement)).toBe(true);
    // The face change (pay -> quote review) drops the pay key entirely: focus
    // lands on Sign, the first rung.
    const quoted = deps({
      pendingOffer: escrowed,
      quote: {
        totalTokens: 1,
        sellerTokens: null,
        burnTokens: null,
        treasuryTokens: null,
        usdCents: 100,
        expiresAtMs: null,
      },
    });
    root.innerHTML = wocTradeArmHtml(wocTradeModelFrom(quoted), quoted.usdCents);
    restoreWocTradeFocus(root, 'trade-woc-pay');
    expect(document.activeElement?.hasAttribute('data-woc-sign')).toBe(true);
    // The tabs are keyed too, and they are the ladder's last rungs: a pressed
    // Pay under DURABLE consent (no consent row, no other keyed control) still
    // keeps focus inside the arm rather than dropping it to body.
    expect(
      root.querySelector('[data-woc-mode="gold"][data-focus-key="trade-woc-tab-gold"]'),
    ).not.toBeNull();
    const durable = deps({ pendingOffer: escrowed, paying: true, termsAccepted: true });
    root.innerHTML = wocTradeArmHtml(wocTradeModelFrom(durable), durable.usdCents);
    restoreWocTradeFocus(root, 'trade-woc-pay');
    expect(document.activeElement, 'not body').not.toBe(document.body);
    expect(root.contains(document.activeElement)).toBe(true);
  });

  it('the consent row names the same document on both surfaces, through one resolver', () => {
    // One label key for the pair (the trade arm borrows the Exchange's), and
    // the href from the shared terms_link resolver: same-origin here (the
    // test document is an http origin outside the native app).
    const compose = paint(deps({ termsAccepted: false }));
    expect(compose.querySelector('.trade-woc-terms')?.textContent).toContain(
      t('hudChrome.wocMarket.termsLabel'),
    );
    // Absent host input renders the site path; the controller supplies the
    // shell-resolved href (it owns the browser state the painter must not
    // read), and the painter renders exactly what it is handed.
    expect(compose.querySelector('.trade-woc-terms-link')?.getAttribute('href')).toBe('/terms');
    const native = paint(
      deps({ termsAccepted: false, termsHref: 'https://worldofclaudecraft.com/terms' }),
    );
    expect(native.querySelector('.trade-woc-terms-link')?.getAttribute('href')).toBe(
      'https://worldofclaudecraft.com/terms',
    );
    expect(CONTROLLER).toContain("termsHref: termsUrlFor(globalThis.location?.origin ?? '')");
    expect(CONTROLLER).not.toContain('trade.woc.termsLabel');
  });
});
