// @vitest-environment jsdom
// The banker's dual price tag (Bank Storage phase 13), end to end: the pure
// core's four-way gating and its money fields, then the REAL BankWindow driven
// against a world double and a spend double.
//
// This file exists at the altitude tests/bank_window.test.ts cannot reach. That
// file is a SOURCE-pin suite (regexes over the painter's text), which is the
// right tool for a layout contract and the wrong one for a money path: a source
// pin cannot tell whether the cost that reaches the wire is the frozen one, and
// it cannot tell an intent that was dropped from one that was kept. Every claim
// below is asserted through executed behavior.
//
// The one gate NOT driven through the window is the native-build arm: NATIVE_APP
// is a build constant folded at import time (src/client_origin.ts), so it is
// exercised against buildBankView directly, which is exactly why the core takes
// it as an INPUT rather than importing it.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_KEY_PATTERN } from '../server/storage_purchases';
import { BANK_EXPANSION_SLOTS } from '../src/sim/bank';
import { STORAGE_SKUS } from '../src/sim/content/storage_charters';
import {
  bankRungNoticeText,
  bankRungNoticeTone,
  bankRungResultHtml,
  bankRungTopUpCopy,
  planBankRungRefusal,
} from '../src/ui/bank_rung_view';
import { type BankClaudiumInput, buildBankView } from '../src/ui/bank_view';
import { BankWindow, type BankWindowDeps } from '../src/ui/bank_window';
import type { StoreSpendResult } from '../src/ui/claudium_purchase_bridge';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import type { BankInfo, IWorld } from '../src/world_api';

const RUNG_COST = 100;

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

function claudiumInput(over: Partial<BankClaudiumInput> = {}): BankClaudiumInput {
  return { storeEnabled: true, nativeBuild: false, ...over };
}

/** The buy sub-model, or the away state's absence. */
function buyOf(info: BankInfo | null, claudium?: BankClaudiumInput) {
  const model = buildBankView(info, () => undefined, claudium);
  return model.kind === 'bank' ? model.buy : null;
}

// ---------------------------------------------------------------------------
// The pure core
// ---------------------------------------------------------------------------

describe('buildBankView: the Claudium side of the next rung (phase 13)', () => {
  it('offers it when every gate passes, with the wired cost and the registry SKU', () => {
    const buy = buyOf(bankInfo({ nextRungClaudiumPrice: RUNG_COST }), claudiumInput());
    expect(buy?.claudium).toEqual({ cost: RUNG_COST, skuId: 'strongbox_rung_01' });
  });

  it('the SKU is the registry rung for the ladder POSITION, never a literal', () => {
    // Walked across the whole ladder, and compared against the registry rather
    // than against a hand-written id list: a renumbering of the SKUs has to
    // move this test's expectation with it, and cannot pass by accident.
    for (const [index, def] of Object.entries(STORAGE_SKUS)
      .map(([, d]) => d)
      .filter((d) => d.ladderIndex !== undefined)
      .map((d) => [d.ladderIndex as number, d] as const)) {
      const buy = buyOf(
        bankInfo({
          purchasedSlots: index * BANK_EXPANSION_SLOTS,
          nextRungClaudiumPrice: RUNG_COST,
        }),
        claudiumInput(),
      );
      expect(buy?.claudium?.skuId).toBe(def.id);
    }
  });

  // Each gate ALONE, with everything else passing, so no arm can be carried by
  // another. Absence is asserted as the KEY being missing, not as undefined:
  // "no Claudium side was offered" and "a Claudium side with a hole in it" are
  // different facts and the painter's truthiness gate must see the first.
  it('is ABSENT (not disabled) when the Claudium hooks are not attached', () => {
    const buy = buyOf(
      bankInfo({ nextRungClaudiumPrice: RUNG_COST }),
      claudiumInput({ storeEnabled: false }),
    );
    expect(buy && 'claudium' in buy).toBe(false);
  });

  it('is ABSENT on a native build', () => {
    const buy = buyOf(
      bankInfo({ nextRungClaudiumPrice: RUNG_COST }),
      claudiumInput({ nativeBuild: true }),
    );
    expect(buy && 'claudium' in buy).toBe(false);
  });

  it('is ABSENT when the wire carried no price, and the gold side is untouched', () => {
    // The service-unreachable fallback, which is NORMAL and not an error: the
    // button is simply gold-only. Pinned by comparing the whole gold sub-model
    // against the same bank WITH a price, so a regression that quietly changed
    // a gold field on the fallback path reds here.
    const withPrice = buyOf(bankInfo({ nextRungClaudiumPrice: RUNG_COST }), claudiumInput());
    const without = buyOf(bankInfo(), claudiumInput());
    expect(without && 'claudium' in without).toBe(false);
    expect(without).toEqual({ nextCost: 500, blockSlots: BANK_EXPANSION_SLOTS, maxed: false });
    const { claudium: _dropped, ...goldOnly } = withPrice ?? {};
    expect(goldOnly).toEqual(without);
  });

  it('is ABSENT when the ladder is maxed, even if a price somehow rode the wire', () => {
    // The server already omits the price at the ceiling, so this is the arm a
    // wire that ever disagreed lands on. nextExpansionCost null IS the maxed
    // answer, reused verbatim rather than re-derived from a slot count.
    //
    // The ladder POSITION here is deliberately 0, not 72. At 72 the registry
    // also has no rung, so the missing-SKU gate would carry this arm and
    // deleting the maxed gate would leave it green (it did: the first version
    // of this test survived that exact mutant). An inconsistent wire, maxed but
    // still quoting a price at a position that HAS a rung, is the only shape
    // that isolates this gate, and it is the shape the gate exists for.
    const buy = buyOf(
      bankInfo({ nextExpansionCost: null, purchasedSlots: 0, nextRungClaudiumPrice: RUNG_COST }),
      claudiumInput(),
    );
    expect(buy?.maxed).toBe(true);
    expect(buy && 'claudium' in buy).toBe(false);
  });

  it('is ABSENT when the registry has no rung at that ladder index', () => {
    // Past the last rung the ladder index misses the registry entirely. The
    // gold side is deliberately left purchasable here so the ONLY thing that
    // can suppress the tag is the missing SKU.
    const buy = buyOf(
      bankInfo({ purchasedSlots: 72, nextRungClaudiumPrice: RUNG_COST }),
      claudiumInput(),
    );
    expect(buy?.maxed).toBe(false);
    expect(buy && 'claudium' in buy).toBe(false);
  });

  it('is ABSENT when no host facts are supplied at all (the offline shape)', () => {
    const buy = buyOf(bankInfo({ nextRungClaudiumPrice: RUNG_COST }));
    expect(buy && 'claudium' in buy).toBe(false);
  });

  it('carries the price and the SKU and nothing else: no client-side affordability', () => {
    // Phase 13 QA dropped `affordable` and `shortfall`. Nothing in src/ ever read
    // either, the server answers insufficient_balance, and an affordability term
    // in the window's repaint signature forced zero-pixel rebuilds. This arm
    // pins their ABSENCE so the decision cannot be silently undone: a re-added
    // field must come back WITH a painter and a test that reads it.
    const buy = buyOf(bankInfo({ nextRungClaudiumPrice: 500 }), claudiumInput());
    expect(Object.keys(buy?.claudium ?? {}).sort()).toEqual(['cost', 'skuId']);
    // And the core takes no balance at all any more, so it cannot grow one back
    // without the input changing too.
    expect(Object.keys(claudiumInput()).sort()).toEqual(['nativeBuild', 'storeEnabled']);
  });

  it('renders the server price verbatim: no rounding, no derivation from gold', () => {
    // An awkward price no rounding rule would produce, against a gold price it
    // bears no relation to. If anything ever computed the Claudium cost from
    // the copper one, this is the arm that catches it.
    const buy = buyOf(
      bankInfo({ nextExpansionCost: 500, nextRungClaudiumPrice: 4237 }),
      claudiumInput(),
    );
    expect(buy?.claudium?.cost).toBe(4237);
  });
});

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------

interface Spend {
  itemId: string;
  kind: string;
  cost: number;
  key: string | undefined;
}

interface Harness {
  window: BankWindow;
  root: HTMLElement;
  world: { bankInfo: BankInfo | null };
  calls: string[];
  spends: Spend[];
  /** Queued answers, one per spend, in order. */
  results: StoreSpendResult[];
  confirms: { title: string; body: string; ok: () => void; cancel?: () => void }[];
  topUps: { onClosed?: () => void }[];
  balance: { value: number | null };
}

function spendResult(over: Partial<StoreSpendResult> = {}): StoreSpendResult {
  return { granted: true, balance: 900, costClaudium: RUNG_COST, reason: null, ...over };
}

function harness(
  info: BankInfo,
  opts: {
    storeEnabled?: boolean;
    balance?: number | null;
    noSpendHook?: boolean;
    /** Give the world double an identity, which is what turns DURABILITY on
     *  (src/ui/purchase_intent_durability.ts derives the storage row from
     *  `<class>_<name>` and writes nothing when the name is empty). Omitted by
     *  default ON PURPOSE: every other arm here predates phase 16 and must keep
     *  running against an inert durable layer, or a record one arm persisted
     *  would be restored by the next. */
    scope?: { playerClass: string; name: string };
  } = {},
): Harness {
  document.body.innerHTML = '<div id="prompt-stack"></div>';
  const root = document.createElement('div');
  root.id = 'bank-window';
  document.body.appendChild(root);
  const calls: string[] = [];
  const spends: Spend[] = [];
  const results: StoreSpendResult[] = [];
  const confirms: Harness['confirms'] = [];
  const topUps: Harness['topUps'] = [];
  const balance = { value: opts.balance === undefined ? 10_000 : opts.balance };
  const world = {
    ...(opts.scope
      ? { cfg: { playerClass: opts.scope.playerClass }, player: { name: opts.scope.name } }
      : {}),
    bankInfo: info,
    guildBankInfo: null,
    vaultInfo: null,
    inventory: [],
    bags: [null, null, null, null],
    copper: 100_000_000,
    bankDeposit: () => calls.push('bankDeposit'),
    bankWithdraw: () => calls.push('bankWithdraw'),
    bankBuySlots: () => calls.push('bankBuySlots'),
    bankUnlockSocket: () => calls.push('bankUnlockSocket'),
    bankSocketBag: () => calls.push('bankSocketBag'),
    bankUnsocketBag: () => calls.push('bankUnsocketBag'),
  };
  const noop = (): void => {};
  const deps: BankWindowDeps = {
    itemIcon: () => '<span class="item-icon"></span>',
    moneyHtml: (c: number) => `<span class="money-inline">${c}</span>`,
    itemTooltip: () => '',
    attachTooltip: noop,
    root: () => root,
    world: () => world as unknown as IWorld,
    closeOthers: noop,
    hideTooltip: noop,
    consumePeek: () => false,
    captureFocus: () => null,
    restoreFocus: noop,
    onClosed: noop,
    onInventoryChanged: noop,
    storeEnabled: () => opts.storeEnabled !== false,
    claudiumBalance: () => balance.value,
    openClaudium: (onClosed) => topUps.push({ onClosed }),
    confirmDialog: (title, body, _ok, _cancel, onOk, onCancel) =>
      confirms.push({ title, body, ok: onOk, cancel: onCancel }),
    ...(opts.noSpendHook
      ? {}
      : {
          spendStoreItem: async (itemId, kind, cost, key) => {
            spends.push({ itemId, kind, cost, key });
            return results.shift() ?? spendResult();
          },
        }),
  };
  return {
    window: new BankWindow(deps),
    root,
    world,
    calls,
    spends,
    results,
    confirms,
    topUps,
    balance,
  };
}

const buyBtn = (h: Harness): HTMLButtonElement =>
  h.root.querySelector('.bank-buy-btn') as HTMLButtonElement;
const prompt = (): HTMLElement | null => document.querySelector<HTMLElement>('.bank-buy-prompt');
const promptButtons = (): HTMLButtonElement[] =>
  Array.from(prompt()?.querySelectorAll<HTMLButtonElement>('.btn') ?? []);
const noticeText = (h: Harness): string | null =>
  h.root.querySelector('.bank-rung-notice')?.textContent ?? null;
const liveText = (h: Harness): string | null =>
  h.root.querySelector('[data-rung-live]')?.textContent ?? null;

/** Open, click the buy button, and take the Claudium rail. Returns after the
 *  spend promise and its result handling have both settled. */
async function buyWithClaudium(h: Harness): Promise<void> {
  buyBtn(h).click();
  const alt = promptButtons()[1];
  alt.click();
  // Two drains: one for the awaited spend, one for the queueMicrotask the live
  // region announcement rides.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('the banker paints one button with two price tags', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders the Claudium tag beside the gold one, with both prices in the aria label', () => {
    const h = harness(bankInfo({ nextRungClaudiumPrice: 250 }));
    h.window.open();
    const tags = h.root.querySelectorAll('.bank-buy-tags .bank-buy-tag');
    expect(tags).toHaveLength(2);
    // Order is the hierarchy: gold FIRST, so the phase 08 sibling rule
    // (.bank-buy-tag + .bank-buy-tag) quiets the Claudium one and not the gold.
    expect(tags[0].classList.contains('bank-buy-tag-gold')).toBe(true);
    expect(tags[1].classList.contains('bank-buy-tag-claudium')).toBe(true);
    expect(tags[1].textContent).toContain('250');
    const aria = buyBtn(h).getAttribute('aria-label') ?? '';
    expect(aria).toContain('250');
    // The gold half rides formatMoney, so the aria says 5s, not 500 copper.
    expect(aria).toContain('5s');
  });

  it('paints NO Claudium tag and no aria override when nothing is offered', () => {
    const h = harness(bankInfo());
    h.window.open();
    expect(h.root.querySelectorAll('.bank-buy-tags .bank-buy-tag')).toHaveLength(1);
    expect(h.root.querySelector('.bank-buy-tag-claudium')).toBeNull();
    // Not merely hidden or disabled: the node does not exist, and the button
    // keeps the plain accessible name Phase 08 gave it.
    expect(buyBtn(h).getAttribute('aria-label')).toBeNull();
    expect(buyBtn(h).disabled).toBe(false);
  });

  it('paints no Claudium tag when the hooks are not attached, price or no price', () => {
    const h = harness(bankInfo({ nextRungClaudiumPrice: 250 }), { storeEnabled: false });
    h.window.open();
    expect(h.root.querySelector('.bank-buy-tag-claudium')).toBeNull();
    expect(h.root.querySelectorAll('.bank-buy-tags .bank-buy-tag')).toHaveLength(1);
  });

  it('a service outage leaves a working gold-only button with no error text', () => {
    const h = harness(bankInfo());
    h.window.open();
    const footer = h.root.querySelector('.bank-footer') as HTMLElement;
    expect(footer.querySelector('.bank-rung-notice')).toBeNull();
    // ...and the gold rail still buys, through the unchanged single-confirm prompt.
    buyBtn(h).click();
    expect(promptButtons()).toHaveLength(2);
    promptButtons()[0].click();
    expect(h.calls).toContain('bankBuySlots');
  });
});

describe('the confirm prompt carries both rails', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('gold-only keeps the phase 08 prompt exactly: one confirm, the price in the body', () => {
    const h = harness(bankInfo());
    h.window.open();
    buyBtn(h).click();
    const buttons = promptButtons();
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toBe('Purchase');
    expect(prompt()?.querySelector('.prompt-text')?.textContent).toBe(
      'Purchase 6 additional bank slots for 5s?',
    );
    expect(prompt()?.querySelector('.bank-buy-alt')).toBeNull();
  });

  it('dual adds a SECOND confirm after the gold one, and keeps the shared disclaimer', () => {
    const h = harness(bankInfo({ nextRungClaudiumPrice: 250 }));
    h.window.open();
    buyBtn(h).click();
    const buttons = promptButtons();
    expect(buttons).toHaveLength(3);
    expect(buttons[0].textContent).toContain('5s');
    expect(buttons[1].textContent).toContain('250');
    expect(buttons[1].textContent).toContain('Claudium');
    expect(buttons[1].classList.contains('bank-buy-alt')).toBe(true);
    // The body names the product only: the two prices sit on their own buttons,
    // so no line anywhere states a rate, an equivalence, or a combined total.
    const body = prompt()?.querySelector('.prompt-text')?.textContent ?? '';
    expect(body).toBe('Purchase 6 additional bank slots?');
    expect(body).not.toContain('Claudium');
    // The Phase 08 disclaimer key, reused rather than duplicated.
    expect(prompt()?.querySelector('.bank-buy-disclaimer')?.textContent).toBe(
      'Prices may change with the game economy.',
    );
  });

  it('the gold rail of the dual prompt still buys with gold and nothing else', () => {
    const h = harness(bankInfo({ nextRungClaudiumPrice: 250 }));
    h.window.open();
    buyBtn(h).click();
    promptButtons()[0].click();
    expect(h.calls).toContain('bankBuySlots');
    expect(h.spends).toEqual([]);
  });
});

describe('the Claudium rail sends the phase 11 spend', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  // STRUCTURAL, not per-arm: the durable purchase row is per ORIGIN and outlives
  // a test by design, so an arm that seeds one must not be the only thing that
  // clears it. Targeted rather than localStorage.clear(), which would also wipe
  // the bank filter key these arms never touch.
  afterEach(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('woc_purchase_intents')) localStorage.removeItem(key);
    }
  });

  it('RESTORES a persisted intent, so the key that survived the page is the key that goes out', () => {
    // THE WIRING PIN for the banker's ledger. Everything else about durability
    // is proven against the ledger and the record core directly; this is the one
    // arm that fails if this window is reverted to a memory-only ledger, which
    // is the single edit that reopens ruling 19 in the product.
    const scope = { playerClass: 'warrior', name: 'Borin' };
    const survived = 'intent-survived-the-page';
    localStorage.setItem(
      `woc_purchase_intents_${scope.playerClass}_${scope.name}`,
      JSON.stringify({
        v: 1,
        scope: `${scope.playerClass}_${scope.name}`,
        // The FROZEN cost, deliberately different from the wired price below, so
        // the assertion cannot pass by coincidence.
        intents: {
          strongbox_rung_03: { key: survived, costClaudium: 77, mintedAtMs: Date.now() - 1_000 },
        },
      }),
    );
    const h = harness(bankInfo({ purchasedSlots: 12, nextRungClaudiumPrice: 250 }), { scope });
    h.window.open();
    buyBtn(h).click();
    promptButtons()[1].click();
    expect(h.spends).toHaveLength(1);
    expect(h.spends[0].key, 'the SURVIVING key, not a fresh mint').toBe(survived);
    expect(h.spends[0].cost, 'and its FROZEN cost, not the wired price').toBe(77);
  });

  it('a GOLD buy KEEPS a restored Claudium record, and drops a freshly minted one', () => {
    // The neighbouring guarantee the restored-intent fix deliberately changed.
    // The gold rail abandons the Claudium intent the prompt minted, which is
    // right while it is provably unsent. A RESTORED key survived a page, so this
    // window cannot know whether it reached the service and the ledger keeps it;
    // the cost is a price_changed round trip, never a second charge. Both
    // directions, or the fix could quietly become "gold never abandons".
    const scope = { playerClass: 'warrior', name: 'Borin' };
    const row = `woc_purchase_intents_${scope.playerClass}_${scope.name}`;
    localStorage.setItem(
      row,
      JSON.stringify({
        v: 1,
        scope: `${scope.playerClass}_${scope.name}`,
        intents: {
          strongbox_rung_03: {
            key: 'intent-from-the-last-page',
            costClaudium: 77,
            mintedAtMs: Date.now() - 1_000,
          },
        },
      }),
    );
    const restored = harness(bankInfo({ purchasedSlots: 12, nextRungClaudiumPrice: 250 }), {
      scope,
    });
    restored.window.open();
    buyBtn(restored).click();
    promptButtons()[0].click();
    expect(restored.calls, 'the gold buy still happens').toContain('bankBuySlots');
    expect(localStorage.getItem(row), 'the restored key outlives the gold buy').toContain(
      'intent-from-the-last-page',
    );

    localStorage.removeItem(row);
    const minted = harness(bankInfo({ purchasedSlots: 12, nextRungClaudiumPrice: 250 }), { scope });
    minted.window.open();
    buyBtn(minted).click();
    promptButtons()[0].click();
    expect(localStorage.getItem(row), 'a freshly minted one is dropped by the gold buy').toBeNull();
  });

  it('sends the next rung SKU, kind storage, the wired cost, and a server-legal key', () => {
    const h = harness(bankInfo({ purchasedSlots: 12, nextRungClaudiumPrice: 250 }));
    h.window.open();
    buyBtn(h).click();
    promptButtons()[1].click();
    expect(h.spends).toHaveLength(1);
    expect(h.spends[0].itemId).toBe('strongbox_rung_03');
    expect(h.spends[0].kind).toBe('storage');
    expect(h.spends[0].cost).toBe(250);
    // Pinned against the SERVER's own pattern: a key outside it comes back
    // invalid_request, which the ledger reads as DEFINITIVE, so a charset
    // regression turns silently into a lost intent rather than an error.
    expect(h.spends[0].key).toMatch(STORAGE_KEY_PATTERN);
  });

  it('never grants a slot client-side on success', async () => {
    const h = harness(bankInfo({ nextRungClaudiumPrice: 250 }));
    h.window.open();
    const before = { ...h.world.bankInfo };
    h.results.push(spendResult());
    await buyWithClaudium(h);
    // No gold command, and the mirror is untouched: the slots arrive on the
    // owner-only snapshot, which is the only thing that may move the meter.
    expect(h.calls).not.toContain('bankBuySlots');
    expect(h.world.bankInfo).toEqual(before);
  });

  it('re-sends the FROZEN cost and the SAME key after an ambiguous outcome', async () => {
    // The second-charge path this freeze exists to close: an ambiguous result
    // retains the key, a background refresh then moves the wired price, and a
    // retry carrying the NEW price would mismatch the server's four-field
    // prior-row identity check and get a definitive-looking already_granted
    // over a still-pending debit.
    const h = harness(bankInfo({ nextRungClaudiumPrice: 250 }));
    h.window.open();
    h.results.push(spendResult({ granted: false, reason: 'unavailable', balance: null }));
    await buyWithClaudium(h);
    // The wire price moves under us, and the window repaints from it.
    (h.world.bankInfo as BankInfo).nextRungClaudiumPrice = 999;
    h.window.refreshIfChanged();
    expect(h.root.querySelector('.bank-buy-tag-claudium')?.textContent).toContain('999');
    // The prompt must QUOTE the frozen cost too, or the player confirms one
    // number while another goes on the wire.
    buyBtn(h).click();
    expect(promptButtons()[1].textContent).toContain('250');
    expect(promptButtons()[1].textContent).not.toContain('999');
    promptButtons()[1].click();
    h.results.push(spendResult());
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.spends).toHaveLength(2);
    expect(h.spends[1].cost).toBe(250);
    expect(h.spends[1].key).toBe(h.spends[0].key);
  });

  it('mints a FRESH key once a definitive refusal has closed the intent', async () => {
    const h = harness(bankInfo({ nextRungClaudiumPrice: 250 }));
    h.window.open();
    h.results.push(spendResult({ granted: false, reason: 'not_next_rung', balance: null }));
    await buyWithClaudium(h);
    h.results.push(spendResult());
    await buyWithClaudium(h);
    expect(h.spends).toHaveLength(2);
    expect(h.spends[1].key).not.toBe(h.spends[0].key);
  });

  it('abandoning the prompt drops an UNSENT intent, so the next attempt is a new key', async () => {
    // RE-PROVEN at Bank Storage phase 17, because its old mechanism stopped
    // isolating the cancel. It used to cancel, buy, CLOSE, reopen, cancel, buy
    // and assert two different keys; phase 17 made close() end an open attempt
    // too, so the close alone satisfied it and removing the prompt's dismiss hook
    // entirely left the arm green. Found by mutation, and it is the general
    // hazard of adding a second door to a decision: the arm that guarded the
    // first one now passes through the second.
    //
    // The mechanism now isolates the cancel with no close in it at all, and reads
    // the answer off the WIRE: a leaked intent replays its FROZEN price, a
    // properly abandoned one is re-minted at whatever the catalog says now.
    const h = harness(bankInfo({ nextRungClaudiumPrice: 250 }));
    h.window.open();
    buyBtn(h).click();
    // Cancel is the last button on both prompt shapes.
    promptButtons().at(-1)?.click();
    expect(h.spends).toEqual([]);

    h.world.bankInfo = bankInfo({ nextRungClaudiumPrice: 400 });
    h.window.render();
    h.results.push(spendResult());
    await buyWithClaudium(h);
    expect(h.spends).toHaveLength(1);
    expect(h.spends[0].cost, 'a fresh intent at the live price, not the cancelled frozen one').toBe(
      400,
    );
  });

  it('a cancel AFTER the spend was sent keeps the key, because a debit may be live', async () => {
    const h = harness(bankInfo({ nextRungClaudiumPrice: 250 }));
    h.window.open();
    h.results.push(spendResult({ granted: false, reason: 'unavailable', balance: null }));
    await buyWithClaudium(h);
    // Open the prompt again and walk away. The intent has reached the service,
    // so the cancel must NOT drop it.
    buyBtn(h).click();
    promptButtons().at(-1)?.click();
    h.results.push(spendResult());
    await buyWithClaudium(h);
    expect(h.spends[1].key).toBe(h.spends[0].key);
  });

  it('refuses to open a second prompt while a spend for the same rung is in flight', () => {
    const h = harness(bankInfo({ nextRungClaudiumPrice: 250 }));
    h.window.open();
    buyBtn(h).click();
    promptButtons()[1].click();
    expect(buyBtn(h).disabled).toBe(true);
    // The disabled attribute is the FIRST line of defence and jsdom honours it,
    // so clicking here would prove nothing about the guard behind it: the
    // listener would simply never run. Stage the world where that first line
    // failed (a rebuild that missed the busy markup, an element the busy write
    // could not find) and drive the click that would then arrive. A second
    // prompt over a live debit is the one thing this flow must never open, so
    // it is guarded twice and both guards are tested.
    buyBtn(h).disabled = false;
    buyBtn(h).click();
    expect(prompt()).toBeNull();
    expect(h.spends).toHaveLength(1);
  });

  it('keeps the button busy through a repaint that lands mid-spend', () => {
    // The busy state is a MARKUP input, not a mutation on the live element: a
    // data repaint during the spend must not rebuild the button enabled.
    const h = harness(bankInfo({ nextRungClaudiumPrice: 250 }));
    h.window.open();
    buyBtn(h).click();
    promptButtons()[1].click();
    (h.world.bankInfo as BankInfo).generalUsed = 3;
    h.window.refreshIfChanged();
    expect(buyBtn(h).disabled).toBe(true);
    expect(buyBtn(h).getAttribute('aria-busy')).toBe('true');
  });
});

describe('the busy release and the announcement address the personal footer only', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('leaves a foreign pane buy button untouched when a tab switch races the spend', async () => {
    // '.bank-buy-btn' is ALSO the guild pane's class and the vault's, painted
    // into the SAME root, and the busy release runs in a finally AFTER an await.
    // Staged directly: a foreign button carrying that class, disabled, must
    // survive the release write.
    const h = harness(bankInfo({ nextRungClaudiumPrice: 250 }));
    h.window.open();
    buyBtn(h).click();
    promptButtons()[1].click();
    const foreign = document.createElement('button');
    foreign.className = 'bank-buy-btn';
    foreign.disabled = true;
    foreign.setAttribute('aria-busy', 'true');
    h.root.appendChild(foreign);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(foreign.disabled).toBe(true);
    expect(foreign.getAttribute('aria-busy')).toBe('true');
  });

  it('writes the announcement into the footer region, not a stray one', async () => {
    const h = harness(bankInfo({ nextRungClaudiumPrice: 250 }));
    h.window.open();
    const stray = document.createElement('span');
    stray.dataset.rungLive = '';
    h.root.insertBefore(stray, h.root.firstChild);
    h.results.push(spendResult());
    await buyWithClaudium(h);
    expect(stray.textContent).toBe('');
    expect(liveText(h)).toContain('bank slots were added');
  });
});

describe('every result state says something true, and none of them lie about the money', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  async function outcome(result: Partial<StoreSpendResult>): Promise<Harness> {
    const h = harness(bankInfo({ nextRungClaudiumPrice: 250 }));
    h.window.open();
    h.results.push(spendResult(result));
    await buyWithClaudium(h);
    return h;
  }

  it('a plain grant reports the slots were added, and announces it', async () => {
    const h = await outcome({ granted: true, reason: null });
    expect(noticeText(h)).toBe(
      'The bank slots were added. The bank of this character is larger now.',
    );
    expect(h.root.querySelector('.bank-rung-notice')?.classList.contains('success')).toBe(true);
    // The visible band carries no aria role; the persistent region announces.
    expect(liveText(h)).toBe(noticeText(h));
  });

  it('apply_deferred leads with payment complete, never a failure', async () => {
    const h = await outcome({ granted: true, reason: 'apply_deferred' });
    expect(noticeText(h)).toBe(
      'Payment complete. The slots apply automatically the next time this character logs in.',
    );
    expect(h.root.querySelector('.bank-rung-notice')?.classList.contains('failure')).toBe(false);
  });

  it('grant_unresolved also leads with payment complete', async () => {
    const h = await outcome({ granted: true, reason: 'grant_unresolved' });
    expect(noticeText(h)).toContain('Payment complete');
    expect(h.root.querySelector('.bank-rung-notice')?.classList.contains('success')).toBe(true);
  });

  it('already_granted means OPPOSITE things on the two arms', async () => {
    // granted TRUE is a successful replay of THIS purchase; granted FALSE means
    // the key was spent on a DIFFERENT one. Reading the flag second would make
    // a real purchase read as a failure.
    const replay = await outcome({ granted: true, reason: 'already_granted' });
    expect(noticeText(replay)).toBe(
      'These slots are already on this character. You were not charged again.',
    );
    const conflict = await outcome({ granted: false, reason: 'already_granted', balance: null });
    expect(noticeText(conflict)).toBe('The purchase could not be completed.');
    expect(conflict.root.querySelector('.bank-rung-notice')?.classList.contains('failure')).toBe(
      true,
    );
  });

  it('purchase_in_progress gets its own line AND keeps the key', async () => {
    const h = await outcome({ granted: false, reason: 'purchase_in_progress', balance: null });
    expect(noticeText(h)).toBe(
      'A purchase for this character is still being completed. Try again in a moment.',
    );
    // It reads like a clean refusal and is not: the concurrent attempt it names
    // is usually THIS intent mid-debit, so the retry must replay under the key.
    h.results.push(spendResult());
    await buyWithClaudium(h);
    expect(h.spends[1].key).toBe(h.spends[0].key);
  });

  it('does_not_fit says the bank cannot fit another expansion', async () => {
    const h = await outcome({ granted: false, reason: 'does_not_fit', balance: null });
    expect(noticeText(h)).toBe('The bank of this character cannot fit another expansion.');
  });

  it('the structural refusals share one not-purchasable line', async () => {
    for (const reason of [
      'unknown_item',
      'not_cosmetic',
      'kind_mismatch',
      'invalid_request',
      'not_next_rung',
      'no_live_character',
    ]) {
      const h = await outcome({ granted: false, reason, balance: null });
      expect(noticeText(h), reason).toBe('These bank slots cannot be purchased right now.');
    }
  });

  it('an ambiguous outcome gets the retry-safe outage line, not a generic failure', async () => {
    const h = await outcome({ granted: false, reason: 'unavailable', balance: null });
    expect(noticeText(h)).toContain('you will not be charged twice');
  });

  it('an unknown token this build does not recognise falls to the same outage line', async () => {
    const h = await outcome({ granted: false, reason: 'some_future_token', balance: null });
    expect(noticeText(h)).toContain('you will not be charged twice');
  });

  it('no spend hook at all reads as an outage and keeps the intent open', async () => {
    const h = harness(bankInfo({ nextRungClaudiumPrice: 250 }), { noSpendHook: true });
    h.window.open();
    await buyWithClaudium(h);
    expect(noticeText(h)).toContain('you will not be charged twice');
  });

  it('an identical repeated message is re-announced rather than silently swallowed', async () => {
    const h = await outcome({ granted: false, reason: 'unavailable', balance: null });
    const live = h.root.querySelector('[data-rung-live]') as HTMLElement;
    expect(live.textContent).not.toBe('');
    h.results.push(spendResult({ granted: false, reason: 'unavailable', balance: null }));
    // The write clears first and re-writes in a microtask, so an unchanged
    // string is still a mutation the live region reports.
    const cleared: string[] = [];
    const observer = new MutationObserver(() => cleared.push(liveText(h) ?? ''));
    observer.observe(h.root, { subtree: true, characterData: true, childList: true });
    await buyWithClaudium(h);
    observer.disconnect();
    expect(cleared).toContain('');
  });
});

describe('the insufficient-balance handoff and the price-changed re-prompt', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('hands off to the top-up window quoting the shortfall, and comes back', async () => {
    const h = harness(bankInfo({ nextRungClaudiumPrice: 250 }), { balance: 40 });
    h.window.open();
    // The service answers with a cost that DIFFERS from the one we sent, which
    // is the only staging that can tell the two apart: with both at 250 the
    // arm passes whichever it reads.
    h.results.push(
      spendResult({
        granted: false,
        reason: 'insufficient_balance',
        balance: 40,
        costClaudium: 400,
      }),
    );
    await buyWithClaudium(h);
    expect(h.confirms).toHaveLength(1);
    expect(h.confirms[0].title).toBe('More Claudium Required');
    // The service's own cost is preferred over the one we sent (400 - 40, not
    // 250 - 40), and the item is named by what it grants: a rung has no product
    // name in the registry by design.
    expect(h.confirms[0].body).toBe('You need 360 more Claudium to purchase 6 bank slots.');
    h.confirms[0].ok();
    expect(h.topUps).toHaveLength(1);
    // The return callback must EXIST and must leave the player able to keep
    // buying. Driving the real handoff showed the top-up window opens OVER the
    // bank rather than closing it, so the ordinary path is a repaint; this arm
    // stages the harder case (the bank closed in the meantime) because that is
    // the one where a missing or inert callback strands the player.
    expect(h.topUps[0].onClosed).toBeTypeOf('function');
    h.window.close();
    expect(h.window.isOpen).toBe(false);
    h.balance.value = 5_000;
    h.topUps[0].onClosed?.();
    expect(h.window.isOpen).toBe(true);
    expect(h.root.querySelector('.bank-buy-tag-claudium')).not.toBeNull();
  });

  it('does not re-open the bank if the player wandered away from the bursar', () => {
    // The bank is proximity gated, so coming back to a null readout must leave
    // it closed rather than paint the away state at a bursar nobody is standing
    // at. Driven through the same return callback the handoff arms.
    const h = harness(bankInfo({ nextRungClaudiumPrice: 250 }), { balance: 40 });
    h.window.open();
    h.results.push(spendResult({ granted: false, reason: 'insufficient_balance', balance: 40 }));
    buyBtn(h).click();
    promptButtons()[1].click();
    return (async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      h.confirms[0].ok();
      h.window.close();
      h.world.bankInfo = null;
      h.topUps[0].onClosed?.();
      expect(h.window.isOpen).toBe(false);
    })();
  });

  it('does not raise the handoff dialog over a bank the player already closed', async () => {
    const h = harness(bankInfo({ nextRungClaudiumPrice: 250 }), { balance: 40 });
    h.window.open();
    h.results.push(spendResult({ granted: false, reason: 'insufficient_balance', balance: 40 }));
    buyBtn(h).click();
    promptButtons()[1].click();
    h.window.close();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // hud.confirmDialog appends an aria-modal focus trap to document.body
    // unconditionally, which over a bare game world is a prompt about a window
    // the player has already walked away from.
    expect(h.confirms).toEqual([]);
    expect(noticeText(h)).toBeNull();
  });

  it('price_changed announces, then re-prompts ONLY at a price that actually moved', async () => {
    const h = harness(bankInfo({ nextRungClaudiumPrice: 250 }));
    h.window.open();
    h.results.push(spendResult({ granted: false, reason: 'price_changed', balance: null }));
    buyBtn(h).click();
    promptButtons()[1].click();
    // The refreshed wire price the re-prompt will read.
    (h.world.bankInfo as BankInfo).nextRungClaudiumPrice = 400;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(noticeText(h)).toContain('price changed');
    expect(promptButtons()[1]?.textContent).toContain('400');
    // ...and the re-prompt is a NEW intent, because price_changed is definitive.
    h.results.push(spendResult());
    promptButtons()[1].click();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.spends[1].cost).toBe(400);
    expect(h.spends[1].key).not.toBe(h.spends[0].key);
  });

  it('caps the automatic re-prompt at one per window open', async () => {
    // The moved-price guard alone is satisfied by a price that OSCILLATES, so
    // without the cap a service flapping between two values would keep
    // reopening a prompt the player never asked for.
    const h = harness(bankInfo({ nextRungClaudiumPrice: 250 }));
    h.window.open();
    h.results.push(spendResult({ granted: false, reason: 'price_changed', balance: null }));
    buyBtn(h).click();
    promptButtons()[1].click();
    (h.world.bankInfo as BankInfo).nextRungClaudiumPrice = 400;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(prompt()).not.toBeNull();
    // Second refusal, price moves again: no THIRD prompt this open.
    h.results.push(spendResult({ granted: false, reason: 'price_changed', balance: null }));
    promptButtons()[1].click();
    (h.world.bankInfo as BankInfo).nextRungClaudiumPrice = 700;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(prompt()).toBeNull();
    // ...and the cap is per OPEN, not for the life of the window.
    h.window.close();
    h.window.open();
    h.results.push(spendResult({ granted: false, reason: 'price_changed', balance: null }));
    buyBtn(h).click();
    promptButtons()[1].click();
    (h.world.bankInfo as BankInfo).nextRungClaudiumPrice = 900;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(prompt()).not.toBeNull();
  });

  it('price_changed at an UNMOVED price does not loop the prompt forever', async () => {
    const h = harness(bankInfo({ nextRungClaudiumPrice: 250 }));
    h.window.open();
    h.results.push(spendResult({ granted: false, reason: 'price_changed', balance: null }));
    await buyWithClaudium(h);
    expect(noticeText(h)).toContain('price changed');
    expect(prompt()).toBeNull();
    expect(h.spends).toHaveLength(1);
  });
});

describe('a result that lands after the window closed changes nothing', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('paints no band and leaves nothing armed for the next open', async () => {
    const h = harness(bankInfo({ nextRungClaudiumPrice: 250 }));
    h.window.open();
    h.results.push(spendResult());
    buyBtn(h).click();
    promptButtons()[1].click();
    h.window.close();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    h.window.open();
    expect(noticeText(h)).toBeNull();
    expect(liveText(h)).toBe('');
  });

  it('but the SPEND still completes and its key still settles', async () => {
    const h = harness(bankInfo({ nextRungClaudiumPrice: 250 }));
    h.window.open();
    h.results.push(spendResult());
    buyBtn(h).click();
    promptButtons()[1].click();
    h.window.close();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.spends).toHaveLength(1);
    // Granted closes the intent, so the next deliberate purchase is a new key
    // rather than a replay of a purchase that already succeeded.
    h.window.open();
    h.results.push(spendResult());
    await buyWithClaudium(h);
    expect(h.spends[1].key).not.toBe(h.spends[0].key);
  });
});

describe('focus survives the purchase outcome', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('lands back on the buy button rather than dropping to body', async () => {
    const h = harness(bankInfo({ nextRungClaudiumPrice: 250 }));
    h.window.open();
    const btn = buyBtn(h);
    btn.focus();
    expect(document.activeElement).toBe(btn);
    h.results.push(spendResult());
    // The key must be captured BEFORE the prompt opens: by the time either
    // confirm arm runs the prompt's own trap has moved focus, and happy-dom's
    // failure to blur on removal is exactly why this is asserted against a
    // STAGED blur rather than trusted from the environment.
    btn.click();
    (document.activeElement as HTMLElement | null)?.blur();
    document.body.focus();
    promptButtons()[1].click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const after = h.root.querySelector('.bank-buy-btn');
    expect(document.activeElement).toBe(after);
  });
});

describe('the repaint signature observes the Claudium side', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('a wired price appearing, moving, and vanishing each repaint the tag', () => {
    const h = harness(bankInfo());
    h.window.open();
    expect(h.root.querySelector('.bank-buy-tag-claudium')).toBeNull();
    // The service comes up: ONLY nextRungClaudiumPrice moves.
    (h.world.bankInfo as BankInfo).nextRungClaudiumPrice = 250;
    h.window.refreshIfChanged();
    expect(h.root.querySelector('.bank-buy-tag-claudium')?.textContent).toContain('250');
    // A retune: still only that field.
    (h.world.bankInfo as BankInfo).nextRungClaudiumPrice = 900;
    h.window.refreshIfChanged();
    expect(h.root.querySelector('.bank-buy-tag-claudium')?.textContent).toContain('900');
    // The service goes away again.
    (h.world.bankInfo as BankInfo).nextRungClaudiumPrice = undefined;
    h.window.refreshIfChanged();
    expect(h.root.querySelector('.bank-buy-tag-claudium')).toBeNull();
  });

  it('the hooks attaching after a fast join repaints the tag in', () => {
    // main.ts attaches the economy hooks after the online handshake, which can
    // be AFTER a bank opened at a bursar. Without a term for it the tag would
    // wait for unrelated bank data to move.
    let attached = false;
    const info = bankInfo({ nextRungClaudiumPrice: 250 });
    const h = harness(info);
    const deps = (h.window as unknown as { deps: BankWindowDeps }).deps;
    deps.storeEnabled = () => attached;
    h.window.open();
    expect(h.root.querySelector('.bank-buy-tag-claudium')).toBeNull();
    attached = true;
    h.window.refreshIfChanged();
    expect(h.root.querySelector('.bank-buy-tag-claudium')).not.toBeNull();
  });

  it('the BALANCE is not a signature term at all: crossing the price repaints nothing', () => {
    // Phase 13 QA dropped the affordability term. It coarsened the balance the
    // way the vault and guild purse terms coarsen copper, but those earn their
    // place because something on screen moves with them and this one never did:
    // the Claudium tag has no short treatment by design. All it bought was a
    // whole-window teardown and rebuild, scroll capture and focus restore
    // included, that changed zero pixels whenever a balance crossed the price.
    const h = harness(bankInfo({ nextRungClaudiumPrice: 250 }), { balance: 1_000 });
    h.window.open();
    // Settle the signature first: open() paints without stamping lastSig, so the
    // very first refreshIfChanged always rebuilds and every arm below would pass
    // on a fresh node either way.
    h.window.refreshIfChanged();
    const first = h.root.querySelector('.bank-footer');
    // Churn on the same side: no repaint, as before.
    h.balance.value = 900;
    h.window.refreshIfChanged();
    expect(h.root.querySelector('.bank-footer')).toBe(first);
    // CROSSING the price is now also no repaint, and the tag still reads the
    // same because affordability was never rendered.
    h.balance.value = 10;
    h.window.refreshIfChanged();
    expect(h.root.querySelector('.bank-footer')).toBe(first);
    expect(h.root.querySelector('.bank-buy-tag-claudium')?.textContent).toContain('250');
    // NEGATIVE ARM, so this is not just "the signature never fires": the wired
    // PRICE moving still rebuilds, which is the term that survived.
    (h.world.bankInfo as BankInfo).nextRungClaudiumPrice = 900;
    h.window.refreshIfChanged();
    expect(h.root.querySelector('.bank-footer')).not.toBe(first);
  });
});

describe('the bank surface states no exchange rate anywhere', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('paints both prices with no comparison between them', () => {
    // The packet's hardest copy rule: two independent per-product price tags,
    // never a rate, an equivalence, a "cheaper than", or a combined total. The
    // scan runs over the WHOLE painted footer and the WHOLE dual prompt, so it
    // covers copy this phase did not write as well as copy it did.
    const h = harness(bankInfo({ nextRungClaudiumPrice: 250 }));
    h.window.open();
    buyBtn(h).click();
    const painted = `${h.root.querySelector('.bank-footer')?.textContent ?? ''} ${
      prompt()?.textContent ?? ''
    } ${buyBtn(h).getAttribute('aria-label') ?? ''}`;
    expect(painted).not.toMatch(/cheaper|equivalent|exchange rate|per claudium|worth/i);
    // Both prices ARE present, so the scan above is running over real copy
    // rather than passing on an empty string.
    expect(painted).toContain('250');
    expect(painted).toContain('5s');
  });

  it('says BANK, never vault: that word belongs to a product with no Claudium path', async () => {
    const h = harness(bankInfo({ nextRungClaudiumPrice: 250 }), { balance: 0 });
    h.window.open();
    buyBtn(h).click();
    const promptText = prompt()?.textContent ?? '';
    expect(promptText.toLowerCase()).not.toContain('vault');
    expect(promptText).toContain('bank slots');
    // ...including every result line and the top-up handoff.
    //
    // PUSH BEFORE THE CLICK. The spend double shifts the queue SYNCHRONOUSLY
    // inside the click, so a result pushed afterwards is consumed by the NEXT
    // attempt and every arm below would read one outcome late, asserting
    // against a stale band. Ordering, not decoration.
    h.results.push(
      spendResult({
        granted: false,
        reason: 'insufficient_balance',
        balance: 0,
        costClaudium: 250,
      }),
    );
    promptButtons()[1].click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    for (const reason of ['does_not_fit', 'not_next_rung', 'unavailable', null]) {
      h.results.push(spendResult({ granted: false, reason, balance: null }));
      await buyWithClaudium(h);
      expect((noticeText(h) ?? '').toLowerCase(), String(reason)).not.toContain('vault');
      // Positive control: this arm really did render THIS outcome's copy, so
      // the no-vault assertion cannot pass on a stale band from a prior one.
      expect(noticeText(h), String(reason)).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 13 QA: the extracted refusal decision, and the flow fixes it enabled
// ---------------------------------------------------------------------------

describe('planBankRungRefusal: the granted-false decision, in isolation', () => {
  it('re-prompts on price_changed only when the fresh price actually MOVED', () => {
    const moved = planBankRungRefusal({
      reason: 'price_changed',
      sentCost: 100,
      serviceCost: null,
      reprompted: false,
      freshCost: 250,
    });
    expect(moved).toEqual({
      notice: { granted: false, reason: 'price_changed' },
      topUpCost: null,
      reprompt: true,
    });
    // The inequality is load-bearing: re-prompting at the price just refused
    // loops the prompt forever. Same inputs, unmoved price.
    expect(
      planBankRungRefusal({
        reason: 'price_changed',
        sentCost: 100,
        serviceCost: null,
        reprompted: false,
        freshCost: 100,
      }).reprompt,
    ).toBe(false);
  });

  it('does not re-prompt once this open has spent its one cap, nor with no live offer', () => {
    const capped = planBankRungRefusal({
      reason: 'price_changed',
      sentCost: 100,
      serviceCost: null,
      reprompted: true,
      freshCost: 250,
    });
    expect(capped.reprompt).toBe(false);
    // Still shows the band: the cap suppresses the PROMPT, never the result.
    expect(capped.notice).toEqual({ granted: false, reason: 'price_changed' });
    // The offer can also vanish outright (the ladder maxed, or the service
    // aged out) between the send and the refusal. Previously unreachable.
    expect(
      planBankRungRefusal({
        reason: 'price_changed',
        sentCost: 100,
        serviceCost: null,
        reprompted: false,
        freshCost: null,
      }).reprompt,
    ).toBe(false);
  });

  it('prefers the SERVICE cost for the top-up, and falls back per guard', () => {
    const base = {
      reason: 'insufficient_balance' as const,
      sentCost: 100,
      reprompted: false,
      freshCost: null,
    };
    // The authoritative number wins over the one we sent.
    expect(planBankRungRefusal({ ...base, serviceCost: 250 }).topUpCost).toBe(250);
    // Each guard gets its OWN arm: a joint check would let one rot unnoticed.
    expect(planBankRungRefusal({ ...base, serviceCost: null }).topUpCost).toBe(100);
    expect(planBankRungRefusal({ ...base, serviceCost: Number.NaN }).topUpCost).toBe(100);
    expect(planBankRungRefusal({ ...base, serviceCost: Number.POSITIVE_INFINITY }).topUpCost).toBe(
      100,
    );
    expect(planBankRungRefusal({ ...base, serviceCost: 0 }).topUpCost).toBe(100);
    expect(planBankRungRefusal({ ...base, serviceCost: -5 }).topUpCost).toBe(100);
    // This is the one refusal that speaks through a dialog, so no band.
    expect(planBankRungRefusal({ ...base, serviceCost: 250 }).notice).toBeNull();
  });

  it('every other refusal is a band and nothing else', () => {
    for (const reason of ['does_not_fit', 'not_next_rung', 'purchase_in_progress', null]) {
      expect(
        planBankRungRefusal({
          reason,
          sentCost: 100,
          serviceCost: 900,
          reprompted: false,
          freshCost: 900,
        }),
      ).toEqual({ notice: { granted: false, reason }, topUpCost: null, reprompt: false });
    }
  });
});

describe('the result band relocalizes, because it stores the RESULT not the sentence', () => {
  afterEach(() => setLanguage('en'));

  it('a band already on screen moves with a runtime language switch', async () => {
    const h = harness(bankInfo({ nextRungClaudiumPrice: RUNG_COST }));
    h.window.open();
    await buyWithClaudium(h);
    const english = noticeText(h);
    expect(english).toBeTruthy();
    // The overlay has to be LOADED before the switch, or t() answers English
    // and the arm passes for the wrong reason in both directions.
    await ensureLocaleLoaded('ja_JP');
    setLanguage('ja_JP');
    h.window.render();
    const japanese = noticeText(h);
    // Decisive: the band is non-empty in BOTH languages and the two differ.
    // Storing the resolved sentence would leave the second equal to the first
    // while every other string in the window moved.
    expect(japanese).toBeTruthy();
    expect(japanese).not.toBe(english);
  });

  it('bankRungNoticeText answers granted BEFORE reason, and routes price_changed', () => {
    // 'already_granted' means OPPOSITE things on the two arms, so the two must
    // not collapse to one sentence.
    const granted = bankRungNoticeText({ granted: true, reason: 'already_granted' });
    const refused = bankRungNoticeText({ granted: false, reason: 'already_granted' });
    expect(granted).toBeTruthy();
    expect(refused).toBeTruthy();
    expect(granted).not.toBe(refused);
    // price_changed is intercepted by the flow, so it is absent from the refusal
    // TABLE; the band still needs its own sentence rather than the outage default.
    expect(bankRungNoticeText({ granted: false, reason: 'price_changed' })).not.toBe(
      bankRungNoticeText({ granted: false, reason: null }),
    );
    expect(bankRungNoticeTone({ granted: true, reason: null })).toBe('success');
    expect(bankRungNoticeTone({ granted: false, reason: null })).toBe('failure');
  });
});

describe('bankRungTopUpCopy floors the shortfall at zero', () => {
  it('never asks the player to buy a negative amount of Claudium', () => {
    // The AUTHORITATIVE cost the service returns can be BELOW the balance the
    // client last read (a price cut landing between the read and the refusal).
    const copy = bankRungTopUpCopy(6, 100, 900);
    expect(copy.body).toContain('0');
    expect(copy.body).not.toContain('-');
    // Positive control, so the assertion above is not passing on empty copy.
    expect(bankRungTopUpCopy(6, 900, 100).body).toContain('800');
  });
});

describe('phase 13 QA flow fixes', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('a price-changed re-prompt that resolves after the bank closed opens NOTHING', async () => {
    const h = harness(bankInfo({ nextRungClaudiumPrice: RUNG_COST }));
    h.window.open();
    h.results.push(spendResult({ granted: false, reason: 'price_changed', costClaudium: 250 }));
    buyBtn(h).click();
    promptButtons()[1].click();
    // The player closes the bank while the spend is still on the wire. The
    // refusal lands afterwards and used to mount an aria-modal purchase confirm
    // over a bare game world, marking the hidden #bank-window inert on the way.
    h.window.close();
    // Move the wire price so the re-prompt's own inequality would be satisfied:
    // without this the arm could pass because the price had not moved.
    (h.world.bankInfo as BankInfo).nextRungClaudiumPrice = 250;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(prompt()).toBeNull();
    expect(h.root.hasAttribute('inert')).toBe(false);
  });

  it('re-opening the bank restores the automatic re-prompt, even after a late refusal', async () => {
    const h = harness(bankInfo({ nextRungClaudiumPrice: RUNG_COST }));
    h.window.open();
    h.results.push(spendResult({ granted: false, reason: 'price_changed', costClaudium: 250 }));
    buyBtn(h).click();
    promptButtons()[1].click();
    h.window.close();
    (h.world.bankInfo as BankInfo).nextRungClaudiumPrice = 250;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // The late refusal set the latch against a window that was not open. If the
    // cap were reset only in close(), THIS open would start with its one
    // automatic re-prompt already spent.
    h.window.open();
    h.results.push(spendResult({ granted: false, reason: 'price_changed', costClaudium: 250 }));
    (h.world.bankInfo as BankInfo).nextRungClaudiumPrice = 900;
    buyBtn(h).click();
    promptButtons()[1].click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(prompt()).not.toBeNull();
  });

  it('buying with GOLD abandons the unsent Claudium intent the same prompt minted', async () => {
    const h = harness(bankInfo({ nextRungClaudiumPrice: RUNG_COST }));
    h.window.open();
    buyBtn(h).click();
    // Take the GOLD rail (index 0), leaving the Claudium intent unsent.
    promptButtons()[0].click();
    expect(h.calls).toContain('bankBuySlots');
    // The wire price then moves. A retained intent would replay the OLD frozen
    // price under the OLD key and be refused for a purchase never made.
    (h.world.bankInfo as BankInfo).nextRungClaudiumPrice = 250;
    h.window.render();
    await buyWithClaudium(h);
    expect(h.spends.at(-1)?.cost).toBe(250);
  });

  it('the Claudium rail lands focus before the await, not on <body>', () => {
    const h = harness(bankInfo({ nextRungClaudiumPrice: RUNG_COST }));
    h.window.open();
    buyBtn(h).click();
    promptButtons()[1].click();
    // Read focus SYNCHRONOUSLY, while the spend is still in flight: the result
    // repaint restores it afterwards, so a post-await read cannot tell the two
    // apart and would pass with the fix removed.
    expect(document.activeElement).not.toBe(document.body);
    expect((document.activeElement as HTMLElement | null)?.hasAttribute('data-close')).toBe(true);
  });

  it('the MARKUP always emits the live region empty, whatever the band says', async () => {
    // This is the contract the two-node split exists for, and it was previously
    // unpinned: pre-filling the span with the notice text passed the suite. A
    // live region that arrives in the DOM already carrying its text is commonly
    // not announced at all; what a screen reader reports is a CHANGE.
    //
    // Asserted on the PURE builder rather than on paint timing: the announcement
    // rides a queueMicrotask, so any drain-counting arm here would be measuring
    // the test's own scheduling rather than the contract.
    for (const notice of [
      { granted: true, reason: null },
      { granted: true, reason: 'apply_deferred' },
      { granted: false, reason: 'does_not_fit' },
    ]) {
      const html = bankRungResultHtml(notice);
      // The band carries the sentence...
      expect(html).toContain(bankRungNoticeText(notice));
      // ...and the region that announces it is emitted with NO text between its
      // tags. A pre-filled region would put the sentence here too.
      expect(html).toContain('aria-atomic="true"></span>');
      expect(html.split('data-rung-live')[1]).not.toContain(bankRungNoticeText(notice));
    }
    // Negative control: with no result there is no band, and the region is
    // STILL emitted, so it is already in the DOM when the first write lands.
    const empty = bankRungResultHtml(null);
    expect(empty).not.toContain('bank-rung-notice');
    expect(empty).toContain('data-rung-live');
    // And the announcement really does arrive through a real purchase.
    const h = harness(bankInfo({ nextRungClaudiumPrice: RUNG_COST }));
    h.window.open();
    await buyWithClaudium(h);
    expect(liveText(h)).toBeTruthy();
  });
});

describe('the gold rail NEVER drops a key that may sit behind a live debit', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps the intent when the Claudium attempt already reached the service', async () => {
    // THE NEGATIVE ARM of the abandon guard added in phase 13 QA, and the more
    // important half: the positive arm only proves an UNSENT intent is dropped,
    // while deleting `&& !this.rungSent.has(...)` would drop a SENT one. That is
    // the worst outcome this packet has: a key abandoned with a live debit
    // behind it means the next attempt mints a fresh one and the service, which
    // dedupes storage spends on the key alone, debits twice.
    const h = harness(bankInfo({ nextRungClaudiumPrice: RUNG_COST }));
    h.window.open();
    // An AMBIGUOUS outcome: 'unavailable' is deliberately not a definitive
    // refusal, so the ledger keeps the key and rungSent keeps the sku.
    h.results.push(spendResult({ granted: false, reason: 'unavailable', balance: null }));
    await buyWithClaudium(h);
    const firstKey = h.spends.at(-1)?.key;
    expect(firstKey).toBeTruthy();

    // The player reopens the prompt and takes GOLD this time.
    buyBtn(h).click();
    promptButtons()[0].click();
    expect(h.calls).toContain('bankBuySlots');

    // The key must be UNCHANGED: the same intent is still open behind the
    // possible debit, so a retry has to replay under it.
    await buyWithClaudium(h);
    expect(h.spends.at(-1)?.key).toBe(firstKey);
    // And the cost is still the FROZEN one, not a re-read.
    expect(h.spends.at(-1)?.cost).toBe(RUNG_COST);
  });

  it('clears a stale result band when the top-up handoff opens', async () => {
    // An unclaimed behaviour change from the refusal extraction, pinned rather
    // than left to drift: the arm now assigns the plan's null notice, so a band
    // from a PRIOR refusal no longer sits under a freshly opened dialog.
    const h = harness(bankInfo({ nextRungClaudiumPrice: RUNG_COST }));
    h.window.open();
    h.results.push(spendResult({ granted: false, reason: 'purchase_in_progress', balance: null }));
    await buyWithClaudium(h);
    expect(noticeText(h)).toBeTruthy();
    h.results.push(
      spendResult({
        granted: false,
        reason: 'insufficient_balance',
        balance: 0,
        costClaudium: 250,
      }),
    );
    await buyWithClaudium(h);
    expect(noticeText(h)).toBeNull();
    // Positive control: the handoff really did open, so the band is gone
    // BECAUSE of this arm and not because nothing happened.
    expect(h.confirms.length).toBe(1);
  });
});

describe('a repaint that tears the confirm prompt down ENDS the attempt (phase 17)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('drops the unsent intent, so the next attempt quotes the price the wire says NOW', async () => {
    // THE LEAK PHASE 13 QA RECORDED AND COULD NOT AFFORD TO FIX. render() tears
    // any open prompt down with dismissBankPrompts(), which removes the NODE:
    // bank_buy_prompt's own dismiss hook never runs, so the intent this prompt
    // minted used to survive the repaint with its cost FROZEN. Phase 16 then made
    // that record DURABLE, so it outlived the page as well.
    //
    // Observed through the WIRE rather than through the ledger, because the cost
    // that reaches the spend is the only place the difference shows: a leaked
    // intent replays the OLD price, a properly ended one is re-minted at the new.
    const h = harness(bankInfo({ nextRungClaudiumPrice: RUNG_COST }));
    h.window.open();
    buyBtn(h).click();
    expect(prompt(), 'the confirm really opened').not.toBeNull();

    // The catalog moves while the prompt stands, then a data repaint lands.
    h.world.bankInfo = bankInfo({ nextRungClaudiumPrice: 250 });
    h.window.render();
    expect(prompt(), 'the repaint tore the prompt down').toBeNull();

    await buyWithClaudium(h);
    expect(h.spends).toHaveLength(1);
    expect(h.spends[0].cost, 'a fresh intent at the live price, not the leaked frozen one').toBe(
      250,
    );
  });

  it('but KEEPS a key that already reached the service, which is the whole guard', async () => {
    // The negative control that stops the fix becoming its own money bug. After
    // an ambiguous outcome the key may be sitting behind a live debit, so a
    // repaint tearing a later prompt down must not abandon it: the retry has to
    // replay under the same key and the same frozen cost.
    const h = harness(bankInfo({ nextRungClaudiumPrice: RUNG_COST }));
    h.window.open();
    h.results.push(spendResult({ granted: false, reason: 'unavailable', balance: null }));
    await buyWithClaudium(h);
    const sentKey = h.spends.at(-1)?.key;
    expect(sentKey).toBeTruthy();

    buyBtn(h).click();
    h.world.bankInfo = bankInfo({ nextRungClaudiumPrice: 250 });
    h.window.render();

    await buyWithClaudium(h);
    expect(h.spends.at(-1)?.key).toBe(sentKey);
    expect(h.spends.at(-1)?.cost).toBe(RUNG_COST);
  });

  it('every teardown site is CLASSIFIED: exactly two are paired with endPrompt()', () => {
    // The census this suite's inert arm rests on, COUNTED rather than stated. Its
    // prose used to name a literal ("eight call sites"), which was already wrong by
    // one and is exactly the kind of number CLAUDE.md's anchor rule bans, because
    // nothing reds when it rots. Here a NEW teardown site fails this arm and has to
    // be classified, which is the only property that matters: a site the author
    // forgot to pair with endPrompt() leaves an unsent, cost-FROZEN and (since
    // phase 16) DURABLE intent behind when the prompt node is raw-removed.
    //
    // The two PAIRED sites are close() and render(): both can tear down a prompt
    // the PLAYER left standing, so both end the attempt.
    // The UNPAIRED sites are safe for one stated reason each, and the reason is
    // never "it does not matter": the two `dismissPrompts` deps are handed to the
    // guild and vault panes, and every one of the panes' own call sites runs while
    // that pane is OPENING a prompt of its own, reachable only from a click on a
    // control inside #bank-window; the three `dismissSiblings` wirings are the
    // same shape one level in. No such click can happen while a rung confirm
    // stands, because the confirm sets #bank-window inert, which is what the arm
    // below drives. showBuySlotsPrompt's own dismissSiblings is the one site that
    // must NEVER end the attempt, because it runs immediately after arming it.
    // resolve(process.cwd(), ...), not import.meta.url: this file runs under jsdom,
    // where import.meta.url is not a file: URL and readFileSync throws.
    const src = readFileSync(resolve(process.cwd(), 'src/ui/bank_window.ts'), 'utf8');
    // Slice PAST the declaration's own name, or its `(): void` counts as a site:
    // that off-by-one is precisely what made the prose census say eight.
    const decl = 'export function dismissBankPrompts';
    const body = src.slice(src.indexOf(decl) + decl.length);
    const sites = [...body.matchAll(/dismissBankPrompts[(,]/g)].map((m) => m.index ?? 0);
    expect(sites.length, 'a NEW dismissBankPrompts site: classify it in the comment above').toBe(7);
    // The attempt is ended in exactly THREE places, and they are classified by
    // NAME below rather than by proximity: a character-budget or next-site window
    // reads showBuySlotsPrompt's own dismissSiblings as paired, because the
    // prompt's onDismiss hook sits inside that site's span and belongs to the HOOK,
    // not to the teardown. Conflating them would have hidden a genuinely unpaired
    // teardown behind a neighbour's hook.
    const END = 'if (this.rungPurchase.endPrompt()) this.rungFocusReturnKey = null;';
    expect((src.match(/if \(this\.rungPurchase\.endPrompt\(\)\)/g) ?? []).length).toBe(3);
    const region = (from: string, to: string): string => {
      const a = src.indexOf(from);
      expect(a, `region start not found: ${from}`).toBeGreaterThan(-1);
      const b = src.indexOf(to, a);
      expect(b, `region end not found: ${to}`).toBeGreaterThan(a);
      return src.slice(a, b);
    };
    // PAIRED 1: close(), the path a player takes by walking away from the banker.
    const closeBody = region('  close(): void {', 'this.clearDepositStatus();');
    expect(closeBody).toContain('dismissBankPrompts();');
    expect(closeBody, 'close() tears down without ending the attempt').toContain(END);
    // PAIRED 2: render()'s repaint-signature teardown, the reachable one.
    const renderBranch = region(
      'if (document.querySelector(BANK_PROMPT_SELECTOR)) {',
      'el.inert = false;',
    );
    expect(renderBranch).toContain('dismissBankPrompts();');
    expect(renderBranch, 'render() tears down without ending the attempt').toContain(END);
    // The THIRD is the prompt's own dismiss hook, which is not a teardown at all:
    // it is the confirm/cancel/Escape path, and it must reach the same one method.
    // Anchored INSIDE showBuySlotsPrompt, not file-wide: `onDismiss: () => {` is a
    // shared prompt-option name, so a guild or vault confirm that later gains one
    // above this line would silently become the region this arm reads, and the
    // rung confirm's own hook would go unchecked while nothing went red.
    const promptFn = region('private showBuySlotsPrompt(', 'private currentRungOffer(');
    expect(
      (promptFn.match(/onDismiss: \(\) => \{/g) ?? []).length,
      'the rung confirm must have exactly one dismiss hook',
    ).toBe(1);
    const hookAt = promptFn.indexOf('onDismiss: () => {');
    const dismissHook = promptFn.slice(hookAt);
    expect(dismissHook).toContain(END);
    expect(dismissHook, 'the hook must not raw-remove the node it is reporting on').not.toContain(
      'dismissBankPrompts(',
    );
    // ...and the two dep injections, which are call sites the panes make on our
    // behalf, are counted separately so a THIRD pane cannot arrive unnoticed.
    expect((src.match(/dismissPrompts: \(\) => dismissBankPrompts\(\)/g) ?? []).length).toBe(2);
    // THE IDIOM, not only the NAME. Counting one identifier is blind to the thing
    // dismissBankPrompts itself does: find the prompt nodes and .remove() them. A
    // second place that raw-removes a prompt, or a wrapper spelled differently, is
    // an unpaired teardown the count above cannot see, and it leaves an unsent,
    // cost-FROZEN, DURABLE intent behind. So the SELECTOR is pinned to its three
    // known readers (the teardown itself, render()'s focus capture, and render()'s
    // branch test), and the two class literals it is built from appear nowhere
    // else in the file.
    expect(
      (src.match(/BANK_PROMPT_SELECTOR/g) ?? []).length,
      'a fourth reader of the prompt selector',
    ).toBe(4);
    for (const cls of ['.bank-quantity-prompt', '.bank-buy-prompt']) {
      expect(
        (src.match(new RegExp(cls.replace('.', '\\.'), 'g')) ?? []).length,
        `${cls} is spelled outside BANK_PROMPT_SELECTOR`,
      ).toBe(1);
    }
    // And exactly one .remove() of a prompt node exists, inside the helper.
    const helper = region('export function dismissBankPrompts', '// The bank');
    expect(helper).toContain('p.remove();');
    expect((src.match(/\.remove\(\)/g) ?? []).length, 'a second raw node removal').toBe(1);
  });

  it('the extracted bonus section mounts INSIDE .bank-scroll, after the grid', () => {
    // The DOM half of the extraction. tests/bank_window.test.ts pins the mount by
    // SOURCE ORDER (it is a scan-only suite with no render harness), and the source
    // order collapsed from two statements to one when the section became a string:
    // a mount re-pointed at `el` instead of `scroll` would keep that pin green
    // while moving the footer outside the scroller. This suite already drives the
    // real window, so the claim is read off the rendered tree instead.
    const h = harness(
      bankInfo({ bonusSlots: 2, bonusSources: [{ id: 'email', slots: 2, maxSlots: 2 }] }),
    );
    h.window.open();
    const bonus = h.root.querySelector('.bank-scroll > .bank-bonus');
    expect(bonus, 'the bonus section is not a child of the scroller').not.toBeNull();
    expect(bonus?.previousElementSibling?.className, 'it must follow the grid').toContain(
      'bank-grid',
    );
  });

  it('the window HANDS the ledger over and never uses it, so there is no second abandon door', () => {
    // The extraction's load-bearing claim, and nothing mechanical was stopping it
    // from decaying: the window still OWNS the ledger (deliberately, so the
    // ruling-19 pin on `durableIntents(() => this.deps.world())` keeps reading for
    // it here), so `this.rungIntents.abandon(skuId)` type-checks anywhere in this
    // file and would consult NEITHER the in-page sent latch NOR the ledger's
    // restored set through the one method that owns both. That is the second-charge
    // path phase 16 closed, re-opened by a plausible one-line addition.
    //
    // ONE `this.` use only, and it is the hand-over. The declaration below names
    // the field without `this.`, so it is asserted separately rather than counted.
    const src = readFileSync(resolve(process.cwd(), 'src/ui/bank_window.ts'), 'utf8');
    const uses = [...src.matchAll(/this\.rungIntents/g)];
    expect(uses.length, 'a SECOND use of the ledger inside the window').toBe(1);
    expect(src).toContain(
      'private readonly rungIntents: PurchaseIntentLedger = durableIntents(() => this.deps.world());',
    );
    expect(src).toContain('intents: this.rungIntents,');
    // ...and the ledger is MINTED once, which is the property the paragraph above
    // actually argues. The use count is name-shaped, so it catches an aliased door
    // (`const led = this.rungIntents`) only because the alias must still read the
    // field; a SECOND durableIntents() view over the same storage would route
    // around it entirely and consult neither half of the sent/restored pair.
    expect((src.match(/durableIntents\(/g) ?? []).length, 'a second ledger was minted').toBe(1);
  });

  it('an open rung confirm INERTS the bank root, which is what the unpaired teardowns rest on', () => {
    // The premise the unpaired sites above rest on, driven rather than argued: a
    // confirm sets #bank-window inert, so nothing in the window (guild pane and
    // vault pane included) is clickable or reachable by Tab while one stands.
    const h = harness(bankInfo({ nextRungClaudiumPrice: RUNG_COST }));
    h.window.open();
    expect(h.root.inert, 'not inert before').toBeFalsy();
    buyBtn(h).click();
    expect(prompt()).not.toBeNull();
    expect(h.root.inert, 'the confirm inerts the window behind it').toBe(true);
    promptButtons().at(-1)?.click();
    expect(h.root.inert, 'and clears it on the way out').toBe(false);
  });

  it('close() ends the attempt too', async () => {
    // The other teardown site, and the one a player reaches by walking away from
    // the banker: close() runs dismissBankPrompts() unconditionally, so it owns
    // the same abandonment the dismiss hook never sees.
    const h = harness(bankInfo({ nextRungClaudiumPrice: RUNG_COST }));
    h.window.open();
    buyBtn(h).click();
    h.window.close();
    expect(prompt()).toBeNull();

    h.world.bankInfo = bankInfo({ nextRungClaudiumPrice: 250 });
    h.window.open();
    await buyWithClaudium(h);
    expect(h.spends).toHaveLength(1);
    expect(h.spends[0].cost, 'the closed attempt was ended, not carried over').toBe(250);
  });
});
