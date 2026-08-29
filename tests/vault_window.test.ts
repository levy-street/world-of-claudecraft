// @vitest-environment jsdom
// Drives the REAL BankWindow with its composed VaultTab pane (vault_window.ts)
// against a jsdom container, the guild_bank_window.test.ts harness shape: the
// Vault tab renders ONLY while vaultInfo is non-null and snaps back to
// Personal when it disappears, the locked pane renders the unlock offer FROM
// THE WIRE PRICE, every action round-trips through the IWorldBank vault
// commands (deposit-all is ONE command, never a send loop), and the transient
// summary / shortfall lines are the pure core's click-time replay.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvSlot } from '../src/sim/types';
import { BankWindow, type BankWindowDeps } from '../src/ui/bank_window';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import { vaultWithdrawFit, vaultWithdrawNotice } from '../src/ui/vault_view';
import type { BankInfo, IWorld, VaultInfo, VaultSpecialRef } from '../src/world_api';

function personalInfo(): BankInfo {
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
  };
}

// The default vault snapshot is UNLOCKED at rung 1 (cap 40, next rung 50000);
// the locked suite overrides with the pinned rung-0 wire shape.
function vaultInfo(over: Partial<VaultInfo> = {}): VaultInfo {
  return {
    stock: {},
    special: [],
    upgrades: 1,
    perMaterialCap: 40,
    nextUpgradeCost: 50000,
    ...over,
  };
}

interface Harness {
  window: BankWindow;
  root: HTMLElement;
  /** attachTooltip recordings, keyed by element (the shared-tooltip pins). */
  tooltips: Map<HTMLElement, () => string>;
  world: {
    bankInfo: BankInfo | null;
    vaultInfo: VaultInfo | null;
    inventory: InvSlot[];
    bags: (string | null)[];
    copper: number;
    player: { dead: boolean };
    /** Reassignable so the offline-shape arm can install a MUTATING double. */
    vaultDepositAll: () => void;
    /** Reassignable for the same reason, on the withdraw side (both call sites). */
    vaultWithdraw: (itemId: string, count?: number, special?: VaultSpecialRef) => void;
  };
  calls: string[];
}

function harness(vault: VaultInfo | null, opts: { consumePeek?: () => boolean } = {}): Harness {
  document.body.innerHTML = '<div id="prompt-stack"></div>';
  const root = document.createElement('div');
  root.id = 'bank-window';
  document.body.appendChild(root);
  const calls: string[] = [];
  const world = {
    bankInfo: personalInfo(),
    guildBankInfo: null,
    vaultInfo: vault,
    inventory: [] as InvSlot[],
    bags: [null, null, null, null] as (string | null)[],
    copper: 100_000,
    // The pane reads world.player.dead to keep the deposit-all summary and
    // the shortfall line honest while dead (the sim silently no-ops).
    player: { dead: false },
    bankDeposit: (...a: unknown[]) => calls.push(`bankDeposit:${a.join(',')}`),
    bankWithdraw: (...a: unknown[]) => calls.push(`bankWithdraw:${a.join(',')}`),
    bankBuySlots: () => calls.push('bankBuySlots'),
    vaultDeposit: (...a: unknown[]) => calls.push(`vaultDeposit:${a.join(',')}`),
    vaultWithdraw: (itemId: string, count?: number, special?: VaultSpecialRef) => {
      const countArg = count === undefined ? '' : `,${count}`;
      const specialArg = special === undefined ? '' : `,${JSON.stringify(special)}`;
      calls.push(`vaultWithdraw:${itemId}${countArg}${specialArg}`);
    },
    vaultDepositAll: () => calls.push('vaultDepositAll'),
    vaultBuyUpgrade: () => calls.push('vaultBuyUpgrade'),
  };
  const noop = (): void => {};
  // Recorded so a control's hover affordance (the shared tooltip, never a
  // native title) is assertable per element.
  const tooltips = new Map<HTMLElement, () => string>();
  const deps: BankWindowDeps = {
    itemIcon: () => '<span class="item-icon"></span>',
    moneyHtml: (c: number) => `<span class="money-inline">${c}</span>`,
    itemTooltip: () => '',
    attachTooltip: (el, html) => tooltips.set(el, html),
    root: () => root,
    world: () => world as unknown as IWorld,
    closeOthers: noop,
    hideTooltip: noop,
    consumePeek: opts.consumePeek ?? (() => false),
    captureFocus: () => null,
    restoreFocus: noop,
    onClosed: noop,
    onInventoryChanged: noop,
  };
  return { window: new BankWindow(deps), root, world, calls, tooltips };
}

const vaultTabButton = (h: Harness): HTMLElement | null =>
  h.root.querySelector('.bank-tab[data-tab="vault"]');

function clickVaultTab(h: Harness): void {
  (vaultTabButton(h) as HTMLElement).click();
}

beforeEach(() => {
  localStorage.clear();
});

describe('the Vault tab strip entry', () => {
  it('ACCEPTANCE: renders only while vaultInfo is non-null and snaps back to Personal when it disappears', () => {
    const h = harness(vaultInfo());
    h.window.open();
    expect(vaultTabButton(h)).not.toBeNull();
    clickVaultTab(h);
    expect(h.root.querySelector('#bank-panel-vault')).not.toBeNull();

    // The mirror nulls (walk-away tick, reconcile window): the next
    // signature-driven repaint drops the tab and the pane falls back to
    // Personal on the SAME paint; bankInfo stays live so the whole-window
    // grace-close never enters it.
    h.world.vaultInfo = null;
    h.window.refreshIfChanged();
    expect(vaultTabButton(h)).toBeNull();
    expect(h.root.querySelector('#bank-panel-vault')).toBeNull();
    // The personal pane is showing again (its footer meter, phase 08, is
    // unique to it).
    expect(h.root.querySelector('.bank-meter')).not.toBeNull();
  });

  it('a vault-less world (explicit null) never renders the tab', () => {
    const h = harness(null);
    h.window.open();
    expect(vaultTabButton(h)).toBeNull();
  });

  it('a world with NO vaultInfo member at all never renders the tab (the loose != arm)', () => {
    // The fix-round-2 regression class: a world double or host that OMITS the
    // member reads undefined, which a strict !== null check would count as
    // available and paint a spurious Vault tab over an 'away' model (an empty
    // pane). An explicit-null fixture cannot see the difference (both
    // operators refuse null), so this arm DELETES the property.
    const h = harness(null);
    delete (h.world as { vaultInfo?: unknown }).vaultInfo;
    h.window.open();
    expect(vaultTabButton(h)).toBeNull();
    // With the guild pane also absent there is nothing to switch between, so
    // no tab strip renders at all: the assertion that actually reds under a
    // reverted !== (which would render Personal + Vault).
    expect(h.root.querySelector('.bank-tab')).toBeNull();
  });
});

describe('the locked pane (the unlock offer)', () => {
  // The exact rung-0 wire shape tests/vault_wire.test.ts pins.
  const locked = (): VaultInfo =>
    vaultInfo({ upgrades: 0, perMaterialCap: 0, nextUpgradeCost: 20000 });

  it('renders the pitch and the unlock button priced FROM THE WIRE', () => {
    const h = harness(locked());
    h.window.open();
    clickVaultTab(h);
    expect(h.root.querySelector('.vault-locked-intro')).not.toBeNull();
    const btn = h.root.querySelector('.vault-unlock-btn') as HTMLElement;
    // The injected moneyHtml stub renders the raw copper number: 20000 comes
    // from the SNAPSHOT, not any client table.
    expect(btn.querySelector('.money-inline')?.textContent).toBe('20000');
    // No rows, no footer, no deposit-all on a locked pane.
    expect(h.root.querySelector('.vault-row')).toBeNull();
    expect(h.root.querySelector('.vault-deposit-all')).toBeNull();
  });

  it('a null unlock price (defensive arm) renders the pitch with NO buy row', () => {
    // Impossible from a sane snapshot (a locked vault always prices rung 0),
    // but the arm exists and must not render a 0-price offer.
    const h = harness(vaultInfo({ upgrades: 0, perMaterialCap: 0, nextUpgradeCost: null }));
    h.window.open();
    clickVaultTab(h);
    expect(h.root.querySelector('.vault-locked-intro')).not.toBeNull();
    expect(h.root.querySelector('.vault-unlock-btn')).toBeNull();
  });

  it('the unlock confirm mounts in the prompt stack with the bank family classes and sends ONE vaultBuyUpgrade', () => {
    const h = harness(locked());
    h.window.open();
    clickVaultTab(h);
    (h.root.querySelector('.vault-unlock-btn') as HTMLElement).click();
    const prompt = document.querySelector('#prompt-stack .vault-buy-prompt') as HTMLElement;
    expect(prompt).not.toBeNull();
    // The family teardown selector must reach it (dismissBankPrompts).
    expect(prompt.classList.contains('bank-buy-prompt')).toBe(true);
    const [confirm] = Array.from(prompt.querySelectorAll('button'));
    confirm.click();
    expect(h.calls).toEqual(['vaultBuyUpgrade']);
    expect(document.querySelector('.vault-buy-prompt')).toBeNull(); // dismissed
  });

  it('holds an unlock busy across a stale mirror and ignores a second activation', () => {
    const h = harness(locked());
    h.window.open();
    clickVaultTab(h);
    (h.root.querySelector('.vault-unlock-btn') as HTMLElement).click();
    (document.querySelector('.vault-buy-prompt .btn') as HTMLElement).click();

    const stale = h.root.querySelector('.vault-unlock-btn') as HTMLButtonElement;
    expect(h.calls.filter((call) => call === 'vaultBuyUpgrade')).toHaveLength(1);
    expect(stale.disabled).toBe(true);
    expect(stale.getAttribute('aria-busy')).toBe('true');
    stale.click();
    expect(document.querySelector('.vault-buy-prompt')).toBeNull();
    expect(h.calls.filter((call) => call === 'vaultBuyUpgrade')).toHaveLength(1);

    h.world.vaultInfo = vaultInfo();
    h.window.refreshIfChanged();
    const echoed = h.root.querySelector('.vault-upgrade-btn') as HTMLButtonElement;
    expect(echoed.disabled).toBe(false);
    expect(echoed.hasAttribute('aria-busy')).toBe(false);
  });

  it('refuses a stale visible offer, announces the refreshed price, and focuses that offer', async () => {
    const h = harness(locked());
    h.window.open();
    clickVaultTab(h);
    (h.root.querySelector('.vault-unlock-btn') as HTMLElement).click();
    h.world.vaultInfo = vaultInfo();

    (document.querySelector('.vault-buy-prompt .btn') as HTMLElement).click();

    expect(h.calls).not.toContain('vaultBuyUpgrade');
    expect(document.querySelector('.vault-buy-prompt')).toBeNull();
    const refreshed = h.root.querySelector('.vault-upgrade-btn') as HTMLButtonElement;
    expect(refreshed.textContent).toContain('50000');
    expect(document.activeElement).toBe(refreshed);
    const visible = h.root.querySelector('.vault-status');
    const live = h.root.querySelector('[data-vault-status-live]');
    const message =
      'The price changed before the purchase completed. Review the refreshed price and confirm again.';
    // Visible feedback is synchronous, while the announcing node first mounts
    // empty so assistive tech observes a subsequent content change.
    expect(visible?.textContent).toBe(message);
    expect(visible?.getAttribute('aria-live')).toBeNull();
    expect(live?.getAttribute('role')).toBe('status');
    expect(live?.getAttribute('aria-live')).toBe('polite');
    expect(live?.textContent).toBe('');
    await Promise.resolve();
    expect(live?.textContent).toBe(message);
  });

  it('keeps the latch across close, ignores generic errors, and releases on a vault refusal', () => {
    const h = harness(locked());
    h.window.open();
    clickVaultTab(h);
    (h.root.querySelector('.vault-unlock-btn') as HTMLElement).click();
    (document.querySelector('.vault-buy-prompt .btn') as HTMLElement).click();
    h.window.close();
    h.window.open();
    clickVaultTab(h);

    const reopened = h.root.querySelector('.vault-unlock-btn') as HTMLButtonElement;
    expect(reopened.disabled).toBe(true);
    h.window.observeStorageText('You are busy.');
    expect(reopened.disabled).toBe(true);
    expect(reopened.getAttribute('aria-busy')).toBe('true');

    h.window.observeStorageText('You cannot afford that vault upgrade.');
    const released = h.root.querySelector('.vault-unlock-btn') as HTMLButtonElement;
    expect(released.disabled).toBe(false);
    expect(released.hasAttribute('aria-busy')).toBe(false);
  });

  it('repaints and re-enables the stale offer at the literal 12,000ms lost-echo bound', () => {
    vi.useFakeTimers();
    try {
      const h = harness(locked());
      h.window.open();
      clickVaultTab(h);
      (h.root.querySelector('.vault-unlock-btn') as HTMLElement).click();
      (document.querySelector('.vault-buy-prompt .btn') as HTMLElement).click();

      vi.advanceTimersByTime(11_999);
      expect(h.root.querySelector<HTMLButtonElement>('.vault-unlock-btn')?.disabled).toBe(true);
      vi.advanceTimersByTime(1);
      const released = h.root.querySelector('.vault-unlock-btn') as HTMLButtonElement;
      expect(released.disabled).toBe(false);
      expect(released.hasAttribute('aria-busy')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the unlock/upgrade confirm carries the economy disclaimer (tunable since phase 09)', () => {
    // Phase 09 put the vault ladder on the STORAGE_PRICES override, so this
    // price is retunable between sessions and the shared confirm adopts the
    // disclaimer line (the buy-slots rule; pricing-and-skus.md: purchase
    // surfaces carry the disclaimer key), wired as the accessible description.
    const h = harness(locked());
    h.window.open();
    clickVaultTab(h);
    (h.root.querySelector('.vault-unlock-btn') as HTMLElement).click();
    const prompt = document.querySelector('#prompt-stack .vault-buy-prompt') as HTMLElement;
    const disclaimer = prompt.querySelector('.bank-buy-disclaimer') as HTMLElement;
    expect(disclaimer?.textContent).toBe('Prices may change with the game economy.');
    expect(disclaimer.id).not.toBe('');
    expect(prompt.getAttribute('aria-describedby')).toBe(disclaimer.id);
  });
});

describe('the stocked pane', () => {
  it('renders rows SORTED by id with count/cap readouts, unknown ids included', () => {
    const h = harness(vaultInfo({ stock: { frost_lotus: 2, copper_ore: 40, not_a_real_id: 3 } }));
    h.window.open();
    clickVaultTab(h);
    const rows = Array.from(h.root.querySelectorAll('.vault-row'));
    expect(rows.map((r) => (r as HTMLElement).dataset.itemId)).toEqual([
      'copper_ore',
      'frost_lotus',
      'not_a_real_id',
    ]);
    // The at-cap row carries its class; the readout carries the fact in text.
    expect((rows[0] as HTMLElement).classList.contains('at-cap')).toBe(true);
    expect(rows[0].querySelector('.vault-row-count')?.textContent).toBe('40/40');
    // The dormant unknown id renders its raw id as the label (recoverable).
    expect(rows[2].querySelector('.vault-row-name')?.textContent).toBe('not_a_real_id');
  });

  it('a fine-grade row wears the rim and the corner seal beside its base (mark family)', () => {
    // The release's all-surfaces mark-family rule (item_instance_glyph_mark):
    // a fine grade is marked in bags, bank, AND guild bank; the vault row in
    // the same window marks it the same way, and sorts it beside its base.
    const h = harness(vaultInfo({ stock: { fine_copper_ore: 2, copper_ore: 3 } }));
    h.window.open();
    clickVaultTab(h);
    const rows = Array.from(h.root.querySelectorAll('.vault-row')) as HTMLElement[];
    expect(rows.map((r) => r.dataset.itemId)).toEqual(['copper_ore', 'fine_copper_ore']);
    expect(rows[1].classList.contains('bag-fine')).toBe(true);
    expect(rows[1].querySelector('.bi-fine-seal')).not.toBeNull();
    // The base row is unmarked: the mark is a decision, not decoration.
    expect(rows[0].classList.contains('bag-fine')).toBe(false);
    expect(rows[0].querySelector('.bi-fine-seal')).toBeNull();
  });

  it('the fine mark CSS actually REACHES the vault row (the fix-round B1 class)', () => {
    // The class-presence arms above cannot see a scoping gap: the family's
    // rim and seal rules were cell-scoped (.bag-item/.bank-item) and a
    // .vault-row wearing the classes rendered UNstyled, which is exactly how
    // the first fix shipped. Pin the reach: the vault selectors sit inside
    // the shared family groups (one rule each, prepended so the release's
    // own selector-order pins stay green) and the row-geometry seal
    // placement rule exists with the row anchored relative.
    const css = readFileSync(resolve(process.cwd(), 'src/styles/components.css'), 'utf8');
    expect(css).toMatch(
      /\.vault-row\.bag-fine,\s*\.bag-item\.bag-fine,\s*\.bank-item\.bag-fine \{/,
    );
    expect(css).toMatch(
      /\.vault-row \.bi-fine-seal,\s*\.bag-item \.bi-fine-seal,\s*\.bank-item \.bi-fine-seal \{/,
    );
    // The THIRD family group (the delta review's D1): the glyph inside the
    // seal takes width/height 100% of the seal box; without the vault arm it
    // fell back to base.css's 1em inline-block .ui-icon, coupling its size
    // to the row's font-size and dropping it onto a text baseline.
    expect(css).toMatch(/\.vault-row \.bi-fine-seal \.ui-icon,/);
    const placeAt = css.indexOf('.vault-row .bi-fine-seal {');
    expect(placeAt, 'the row-geometry seal placement rule is missing').toBeGreaterThan(-1);
    const placeBody = css.slice(placeAt, css.indexOf('}', placeAt));
    expect(placeBody).toContain('position: absolute');
    // Newline-plus-indent anchor (the op: scrape idiom): a future compound
    // rule like `.vault-list .vault-row {` above the base rule must not
    // silently rebind this slice.
    const rowAt = css.indexOf('\n  .vault-row {') + 1;
    expect(rowAt, 'the .vault-row base rule anchor').toBeGreaterThan(0);
    const rowBody = css.slice(rowAt, css.indexOf('}', rowAt));
    expect(rowBody, 'the row must be the seal anchor').toContain('position: relative');
  });

  it('a plain row click withdraws the whole count by itemId', () => {
    const h = harness(vaultInfo({ stock: { copper_ore: 7 } }));
    h.window.open();
    clickVaultTab(h);
    (h.root.querySelector('.vault-row') as HTMLElement).click();
    expect(h.calls).toEqual(['vaultWithdraw:copper_ore']);
  });

  it('shift-click opens the shared quantity prompt; submit sends the clamped count', () => {
    const h = harness(vaultInfo({ stock: { copper_ore: 7 } }));
    h.window.open();
    clickVaultTab(h);
    const row = h.root.querySelector('.vault-row') as HTMLElement;
    row.dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
    const prompt = document.querySelector('#prompt-stack .vault-quantity-prompt') as HTMLElement;
    expect(prompt).not.toBeNull();
    expect(prompt.classList.contains('bank-quantity-prompt')).toBe(true); // family teardown reach
    const input = prompt.querySelector('input') as HTMLInputElement;
    input.value = '999'; // the prompt clamps to the LIVE stock at submit
    const confirm = Array.from(prompt.querySelectorAll('button')).find(
      (b) => b.textContent === 'Withdraw',
    ) as HTMLElement;
    confirm.click();
    expect(h.calls).toEqual(['vaultWithdraw:copper_ore,7']);
  });

  it('item-labels every pooled-row partial action and restores the chosen one after submit', () => {
    const h = harness(vaultInfo({ stock: { copper_ore: 7, iron_ore: 4 } }));
    h.window.open();
    clickVaultTab(h);
    const partials = Array.from(h.root.querySelectorAll<HTMLButtonElement>('.vault-row-partial'));
    expect(partials).toHaveLength(2);
    const full = partials[0].closest('.vault-row-wrap')?.querySelector('.vault-row');
    expect(full).not.toBeNull();
    const accessibleLabels = partials.map((partial) => partial.getAttribute('aria-label'));
    expect(accessibleLabels).toEqual([
      'Quantity to withdraw: Copper Ore',
      'Quantity to withdraw: Iron Ore',
    ]);
    expect(new Set(accessibleLabels)).toHaveLength(partials.length);
    expect(partials[0].getAttribute('aria-label')).not.toBe(full?.getAttribute('aria-label'));
    // The hover affordance is the SHARED tooltip (deps.attachTooltip, every
    // sibling control's rule), never a native title beside it.
    expect(partials.map((partial) => partial.title)).toEqual(['', '']);
    expect(h.tooltips.get(partials[0])?.()).toContain('Quantity to withdraw: Copper Ore');
    expect(h.tooltips.get(partials[1])?.()).toContain('Quantity to withdraw: Iron Ore');
    // The tooltip's SECOND line repeats the chip's own visible label: the
    // 72px chip ellipsis-caps that text, and neither the aria-label nor the
    // action line above repeats its words, so the tooltip is the one place
    // the elided text is recoverable.
    expect(h.tooltips.get(partials[0])?.()).toContain('Quantity to withdraw');
    expect(h.tooltips.get(partials[1])?.()).toContain('Quantity to withdraw');
    for (const partial of partials) {
      expect(partial.textContent).toContain('Quantity to withdraw');
    }

    partials[0].focus();
    partials[0].click();
    const prompt = document.querySelector('#prompt-stack .vault-quantity-prompt') as HTMLElement;
    expect(prompt).not.toBeNull();
    const input = prompt.querySelector('input') as HTMLInputElement;
    input.value = '3';
    const confirm = Array.from(prompt.querySelectorAll('button')).find(
      (button) => button.textContent === 'Withdraw',
    ) as HTMLButtonElement;
    confirm.click();

    expect(h.calls).toEqual(['vaultWithdraw:copper_ore,3']);
    expect(document.activeElement).toBe(
      h.root.querySelector<HTMLElement>('[data-focus-key="vault:partial:pooled:copper_ore"]'),
    );
  });

  it('renders a special instance with canonical glyph/lock marks and withdraws its exact ref whole', () => {
    const h = harness(
      vaultInfo({
        special: [
          {
            itemId: 'copper_ore',
            count: 2,
            instance: { signer: 'Ada', locked: true },
          },
          { itemId: 'future_material', count: 1, instance: { signer: 'Rin' } },
        ],
      }),
    );
    h.window.open();
    clickVaultTab(h);
    const row = h.root.querySelector<HTMLElement>('[data-vault-special-index="0"]');
    expect(row).not.toBeNull();
    expect(row?.classList.contains('vault-row-special')).toBe(true);
    expect(row?.querySelector('.bi-glyph-signed')).not.toBeNull();
    expect(row?.querySelector('.bi-lock-seal')).not.toBeNull();
    const css = readFileSync(resolve(process.cwd(), 'src/styles/components.css'), 'utf8');
    expect(css).toMatch(/\.vault-row \.bi-glyph,\s*\.bag-item \.bi-glyph,/);
    expect(css).toMatch(/\.vault-row \.bi-lock-seal,\s*\.bag-item \.bi-lock-seal,/);
    expect(css).toMatch(
      /body\.mobile-touch \.vault-row,[\s\S]*?body\.mobile-touch \.vault-unlock-btn,[\s\S]*?min-height:\s*44px/,
    );
    expect(row?.closest('.vault-row-wrap')?.querySelector('.vault-row-partial')).toBeNull();
    expect(row?.getAttribute('aria-label')).toBe('Withdraw Copper Ore');
    const described = row?.getAttribute('aria-describedby')?.split(' ') ?? [];
    const lockedDescription = described
      .map((id) => h.root.querySelector(`#${id}`)?.textContent)
      .join(' ');
    // The bottom-left lock seal is aria-hidden, so the row description must
    // carry the same owner-protection fact the personal and guild bank cells
    // announce. Locked outranks the still-visible signed glyph: assistive tech
    // hears the actionable state instead of only "maker-marked copy".
    expect(lockedDescription).toContain('Copper Ore, quantity 2, locked');
    expect(lockedDescription).not.toContain('maker-marked copy');
    const unknown = h.root.querySelector<HTMLElement>('[data-vault-special-index="1"]');
    expect(unknown?.querySelector('.bi-glyph-signed')).not.toBeNull();
    expect(unknown?.querySelector('.vault-row-name')?.textContent).toBe('future_material');
    expect(unknown?.getAttribute('aria-label')).toBe('Withdraw future_material');
    const unknownDescription = (unknown?.getAttribute('aria-describedby')?.split(' ') ?? [])
      .map((id) => h.root.querySelector(`#${id}`)?.textContent)
      .join(' ');
    // Keep the unlocked-glyph arm decisive while the locked sibling switches
    // to the higher-priority lock wording above.
    expect(unknownDescription).toContain('maker-marked copy');

    row?.dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
    expect(document.querySelector('.vault-quantity-prompt')).toBeNull();
    expect(h.calls).toEqual([
      'vaultWithdraw:copper_ore,{"index":0,"instance":{"signer":"Ada","locked":true}}',
    ]);
  });

  it('re-resolves a recipe-only special row by fingerprint before quantity submit', () => {
    const target: InvSlot = {
      itemId: 'copper_ore',
      count: 5,
      craftedRecipeId: 'smelt_copper',
    };
    const other: InvSlot = {
      itemId: 'copper_ore',
      count: 2,
      craftedRecipeId: 'smelt_other',
    };
    const h = harness(vaultInfo({ special: [target, other] }));
    h.window.open();
    clickVaultTab(h);
    const wrap = h.root
      .querySelector<HTMLElement>('[data-vault-special-index="0"]')
      ?.closest('.vault-row-wrap');
    const partial = wrap?.querySelector<HTMLButtonElement>('.vault-row-partial');
    expect(partial).not.toBeNull();
    partial?.click();

    // The row moved and shrank while the prompt was open. Submit must scan by
    // exact recipe fingerprint, clamp to the live count, and send its new index.
    (h.world.vaultInfo as VaultInfo).special = [other, { ...target, count: 3 }];
    const prompt = document.querySelector('.vault-quantity-prompt') as HTMLElement;
    (prompt.querySelector('input') as HTMLInputElement).value = '999';
    (
      Array.from(prompt.querySelectorAll('button')).find(
        (button) => button.textContent === 'Withdraw',
      ) as HTMLButtonElement
    ).click();

    expect(h.calls).toEqual([
      'vaultWithdraw:copper_ore,3,{"index":1,"craftedRecipeId":"smelt_copper"}',
    ]);
  });

  it('keeps duplicate exact special rows separately selectable by snapshot index', () => {
    const copy = (): InvSlot => ({
      itemId: 'copper_ore',
      count: 1,
      instance: { signer: 'Ada' },
    });
    const h = harness(vaultInfo({ special: [copy(), copy()] }));
    h.window.open();
    clickVaultTab(h);
    const rows = h.root.querySelectorAll<HTMLElement>('.vault-row-special');
    expect(rows).toHaveLength(2);
    rows[1].click();
    expect(h.calls).toEqual(['vaultWithdraw:copper_ore,{"index":1,"instance":{"signer":"Ada"}}']);
  });

  it('explains and announces a partial-fit withdraw from the click-time snapshot', async () => {
    // Bags: 14 gear fillers + a 15/20 copper stack = 15 of 16 base slots used,
    // so a 40-count withdraw fits only 25 (5 stack headroom + one free slot).
    const h = harness(vaultInfo({ stock: { copper_ore: 40 } }));
    h.world.inventory = [
      ...Array.from({ length: 14 }, (_, i) => ({ itemId: `gear_${i}`, count: 1 })),
      { itemId: 'copper_ore', count: 15 },
    ];
    h.window.open();
    clickVaultTab(h);
    (h.root.querySelector('.vault-row') as HTMLElement).click();
    expect(h.calls).toEqual(['vaultWithdraw:copper_ore']);
    const status = h.root.querySelector('.vault-status');
    expect(status?.textContent).toBe('Only 25 of 40 fit in your bags.');
    expect(status?.getAttribute('aria-live')).toBeNull();
    const live = h.root.querySelector('[data-vault-status-live]');
    expect(live?.getAttribute('role')).toBe('status');
    expect(live?.getAttribute('aria-live')).toBe('polite');
    expect(live?.getAttribute('aria-atomic')).toBe('true');
    expect(live?.textContent).toBe('');
    await Promise.resolve();
    expect(live?.textContent).toBe('Only 25 of 40 fit in your bags.');
  });

  // Both withdraw call sites note the shortfall BEFORE sending, and the ordering
  // is only observable against a MUTATING world. Offline, IWorld.inventory is the
  // LIVE sim array and vaultWithdraw fills it synchronously before the handler's
  // next line; online the mirror is a snapshot that cannot move under the
  // handler at all. So a swapped pair is silent in the online-shaped doubles the
  // suite above uses, and wrong in exactly one host: noteShortfall would measure
  // the fit against POST-withdraw bags, which this rig leaves completely full,
  // and vaultWithdrawNotice reads that fit of 0 as its stay-quiet arm (where the
  // sim emits its own bags-full line). The pane would go SILENT about a withdraw
  // that left 15 behind. These two arms install the mutation the deposit-all
  // OFFLINE SHAPE arm pioneered, one per call site.
  function mutatingWithdrawHarness(): Harness {
    // The partial-fit rig: 15 of 16 base slots used, so a 40-count withdraw
    // fits only 25 and the bags end FULL.
    const h = harness(vaultInfo({ stock: { copper_ore: 40 } }));
    h.world.inventory = [
      ...Array.from({ length: 14 }, (_, i) => ({ itemId: `gear_${i}`, count: 1 })),
      { itemId: 'copper_ore', count: 15 },
    ];
    const spy = h.world.vaultWithdraw;
    h.world.vaultWithdraw = (itemId, count, special) => {
      spy(itemId, count, special);
      // The sim's own outcome for this rig, applied IN PLACE on the live array
      // (a reassignment would not be the offline shape): the carried stack tops
      // out at 20, a second 20 takes the last free slot, and the vault keeps the
      // 15 that never fit. The carried stack is found by ITEM ID, not by the
      // index the gear fillers happen to leave it at.
      const carriedAt = h.world.inventory.findIndex((s) => s.itemId === 'copper_ore');
      h.world.inventory[carriedAt].count = 20;
      h.world.inventory.push({ itemId: 'copper_ore', count: 20 });
      h.world.vaultInfo = vaultInfo({ stock: { copper_ore: 15 } });
    };
    h.window.open();
    clickVaultTab(h);
    return h;
  }

  // Keeps both arms from quietly going vacuous. They only prove an ORDERING if
  // the post-send snapshot would answer differently, so assert that against the
  // arrays the double actually produced (never a second copy of the rig's
  // literals, which could drift out of step with the harness): the bags are now
  // full, the fit measured after the send is 0, and the pure core reads 0 as its
  // stay-quiet arm. A swapped pair therefore renders NO line at all, not merely
  // a wrong number.
  function expectPostSendWouldBeSilent(h: Harness): void {
    const postFit = vaultWithdrawFit(h.world.inventory, h.world.bags, 'copper_ore', 40);
    expect(postFit).toBe(0);
    expect(vaultWithdrawNotice(postFit, 40)).toEqual({ kind: 'none' });
  }

  it('OFFLINE SHAPE: a row click predicts the fit from PRE-withdraw bags', () => {
    const h = mutatingWithdrawHarness();
    (h.root.querySelector('.vault-row') as HTMLElement).click();
    expect(h.calls).toEqual(['vaultWithdraw:copper_ore']);
    expectPostSendWouldBeSilent(h);
    expect(h.root.querySelector('.vault-status')?.textContent).toBe(
      'Only 25 of 40 fit in your bags.',
    );
  });

  it('OFFLINE SHAPE: the prompt submit predicts the fit from PRE-withdraw bags', () => {
    const h = mutatingWithdrawHarness();
    const row = h.root.querySelector('.vault-row') as HTMLElement;
    row.dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
    const prompt = document.querySelector('#prompt-stack .vault-quantity-prompt') as HTMLElement;
    expect(prompt).not.toBeNull();
    (prompt.querySelector('input') as HTMLInputElement).value = '40';
    (
      Array.from(prompt.querySelectorAll('button')).find(
        (b) => b.textContent === 'Withdraw',
      ) as HTMLElement
    ).click();
    expect(h.calls).toEqual(['vaultWithdraw:copper_ore,40']);
    expectPostSendWouldBeSilent(h);
    expect(h.root.querySelector('.vault-status')?.textContent).toBe(
      'Only 25 of 40 fit in your bags.',
    );
  });

  it('the upgrade footer prices the next rung FROM THE WIRE and confirms through the prompt stack', () => {
    const h = harness(vaultInfo({ stock: { copper_ore: 1 }, nextUpgradeCost: 77777 }));
    h.window.open();
    clickVaultTab(h);
    const btn = h.root.querySelector('.vault-upgrade-btn') as HTMLElement;
    expect(btn.querySelector('.money-inline')?.textContent).toBe('77777');
    // The label advertises the NEXT ceiling: wire cap 40 + the 40 step.
    expect(btn.textContent).toContain('80');
    btn.click();
    const prompt = document.querySelector('#prompt-stack .vault-buy-prompt') as HTMLElement;
    (prompt.querySelector('button') as HTMLElement).click();
    expect(h.calls).toEqual(['vaultBuyUpgrade']);
  });

  it('rejects a same-rung price retune and focuses the refreshed Vault upgrade', async () => {
    const h = harness(vaultInfo({ stock: { copper_ore: 1 }, nextUpgradeCost: 50_000 }));
    h.window.open();
    clickVaultTab(h);
    (h.root.querySelector('.vault-upgrade-btn') as HTMLButtonElement).click();

    // Keep the revision fixed so only the exact quoted-cost guard can refuse
    // this stale confirmation. Storage prices are server-tunable at runtime.
    h.world.vaultInfo = vaultInfo({
      stock: { copper_ore: 1 },
      upgrades: 1,
      nextUpgradeCost: 77_777,
    });
    (document.querySelector('.vault-buy-prompt .btn') as HTMLButtonElement).click();

    expect(h.calls).not.toContain('vaultBuyUpgrade');
    const refreshed = h.root.querySelector('.vault-upgrade-btn') as HTMLButtonElement;
    expect(refreshed.querySelector('.money-inline')?.textContent).toBe('77777');
    expect(document.activeElement).toBe(refreshed);
    expect(h.root.querySelector('.vault-status')?.textContent).toBe(
      'The price changed before the purchase completed. Review the refreshed price and confirm again.',
    );
    const live = h.root.querySelector('[data-vault-status-live]');
    expect(live?.textContent).toBe('');
    await Promise.resolve();
    expect(live?.textContent).toContain('The price changed before the purchase completed.');
  });

  it('renders rows past the ceiling with BOTH cap classes (tolerated over-stock)', () => {
    const h = harness(vaultInfo({ stock: { copper_ore: 90 } }));
    h.window.open();
    clickVaultTab(h);
    const row = h.root.querySelector('.vault-row') as HTMLElement;
    expect(row.classList.contains('at-cap')).toBe(true);
    expect(row.classList.contains('over-cap')).toBe(true);
    // The fact rides in TEXT either way; the classes are reinforcement.
    expect(row.querySelector('.vault-row-count')?.textContent).toBe('90/40');
  });

  it('marks the unlock and upgrade buttons purse-short without ever disabling them', () => {
    // The guild open-row idiom: enabled always (the sim refuses with its own
    // line), a visible marker when the purse cannot cover the wire price.
    const locked = harness(vaultInfo({ upgrades: 0, perMaterialCap: 0, nextUpgradeCost: 20000 }));
    locked.world.copper = 19999;
    locked.window.open();
    (locked.root.querySelector('.bank-tab[data-tab="vault"]') as HTMLElement).click();
    const unlock = locked.root.querySelector('.vault-unlock-btn') as HTMLButtonElement;
    expect(unlock.disabled).toBe(false);
    expect(unlock.classList.contains('bank-buy-short')).toBe(true);
    expect(unlock.querySelector('.bank-buy-short-label')).not.toBeNull();

    const rich = harness(vaultInfo({ stock: { copper_ore: 1 }, nextUpgradeCost: 50000 }));
    rich.world.copper = 50000; // exactly affordable: no marker
    rich.window.open();
    (rich.root.querySelector('.bank-tab[data-tab="vault"]') as HTMLElement).click();
    const upgrade = rich.root.querySelector('.vault-upgrade-btn') as HTMLButtonElement;
    expect(upgrade.classList.contains('bank-buy-short')).toBe(false);
    expect(upgrade.querySelector('.bank-buy-short-label')).toBeNull();

    rich.world.copper = 49999; // one short: the marker appears via the purse sig term
    rich.window.refreshIfChanged();
    const short = rich.root.querySelector('.vault-upgrade-btn') as HTMLButtonElement;
    expect(short.disabled).toBe(false);
    expect(short.classList.contains('bank-buy-short')).toBe(true);
  });

  it('the exhausted ladder renders the maxed label and no upgrade button', () => {
    const h = harness(
      vaultInfo({
        stock: { copper_ore: 1 },
        upgrades: 5,
        perMaterialCap: 200,
        nextUpgradeCost: null,
      }),
    );
    h.window.open();
    clickVaultTab(h);
    expect(h.root.querySelector('.vault-upgrade-btn')).toBeNull();
    expect(h.root.querySelector('.vault-footer .bank-buy-maxed')).not.toBeNull();
  });
});

describe('deposit-all (ONE batched command)', () => {
  it('disabled with nothing depositable; RE-ENABLED by loot through the signature alone', () => {
    const h = harness(vaultInfo());
    h.window.open();
    clickVaultTab(h);
    expect((h.root.querySelector('.vault-deposit-all') as HTMLButtonElement).disabled).toBe(true);

    // Looting a material while the pane is open must repaint through the
    // depositable signature term ALONE (the fix for the stale-disabled
    // button); no manual render() here, or the term is untested.
    h.world.inventory = [{ itemId: 'copper_ore', count: 5 }];
    h.window.refreshIfChanged();
    expect((h.root.querySelector('.vault-deposit-all') as HTMLButtonElement).disabled).toBe(false);
  });

  it('one click sends EXACTLY ONE vaultDepositAll (never a vault_deposit loop) and summarizes the predicted move', () => {
    const h = harness(vaultInfo({ stock: { copper_ore: 35 } }));
    // 10 carried: headroom 5 -> a partial 5 move, full flagged.
    h.world.inventory = [{ itemId: 'copper_ore', count: 10 }];
    h.window.open();
    clickVaultTab(h);
    (h.root.querySelector('.vault-deposit-all') as HTMLElement).click();
    expect(h.calls).toEqual(['vaultDepositAll']);
    const status = h.root.querySelector('.vault-status');
    expect(status?.textContent).toBe('Materials deposited: 5. Some ceilings are full.');
    // Held disabled until the mirror echoes (the pending guard).
    expect((h.root.querySelector('.vault-deposit-all') as HTMLButtonElement).disabled).toBe(true);

    // The echo lands (stock moved): the signature repaint re-enables it.
    h.world.vaultInfo = vaultInfo({ stock: { copper_ore: 40 } });
    h.world.inventory = [{ itemId: 'copper_ore', count: 5 }];
    h.window.refreshIfChanged();
    expect((h.root.querySelector('.vault-deposit-all') as HTMLButtonElement).disabled).toBe(false);
  });

  it('OFFLINE SHAPE: a synchronously-mutating world still gets the click-time summary', () => {
    // Offline, IWorld.inventory is the LIVE sim array and vaultDepositAll
    // mutates it synchronously before the handler's next line. The summary
    // must come from the CLICK-TIME snapshot, so a fully successful sweep
    // reads "Materials deposited: N.", never the none arm a post-send replay
    // would produce (the regression the cross-platform review caught: the
    // online-shaped non-mutating spy alone could not see it).
    const h = harness(vaultInfo({ stock: { copper_ore: 35 } }));
    h.world.inventory = [{ itemId: 'copper_ore', count: 10 }];
    const spy = h.world.vaultDepositAll;
    h.world.vaultDepositAll = () => {
      spy();
      // The sim's own outcome for this rig: headroom 5 of the carried 10
      // moves, the stack decrements in place, the mirror-equivalent updates.
      h.world.vaultInfo = vaultInfo({ stock: { copper_ore: 40 } });
      h.world.inventory[0].count = 5;
    };
    h.window.open();
    clickVaultTab(h);
    (h.root.querySelector('.vault-deposit-all') as HTMLElement).click();
    expect(h.calls).toEqual(['vaultDepositAll']);
    expect(h.root.querySelector('.vault-status')?.textContent).toBe(
      'Materials deposited: 5. Some ceilings are full.',
    );
    // The pending guard armed off the same click-time prediction.
    expect((h.root.querySelector('.vault-deposit-all') as HTMLButtonElement).disabled).toBe(true);
  });

  it('while dead the click still sends (server decides) but claims NO deposit', () => {
    // The sim silently no-ops every vault op for a dead player (the recorded
    // dead-at-banker decision keeps the window enabled), so the predicted
    // "Materials deposited: N." would be a false claim: the command goes, the
    // summary stays quiet, and no pending guard arms.
    const h = harness(vaultInfo());
    h.world.inventory = [{ itemId: 'copper_ore', count: 5 }];
    h.world.player.dead = true;
    h.window.open();
    clickVaultTab(h);
    (h.root.querySelector('.vault-deposit-all') as HTMLElement).click();
    expect(h.calls).toEqual(['vaultDepositAll']);
    expect(h.root.querySelector('.vault-status')).toBeNull();
    expect((h.root.querySelector('.vault-deposit-all') as HTMLButtonElement).disabled).toBe(false);
  });

  it('a fully ceiling-blocked click still sends (server decides) and reports the none arm', () => {
    const h = harness(vaultInfo({ stock: { copper_ore: 40 } }));
    h.world.inventory = [{ itemId: 'copper_ore', count: 5 }];
    h.window.open();
    clickVaultTab(h);
    (h.root.querySelector('.vault-deposit-all') as HTMLElement).click();
    expect(h.calls).toEqual(['vaultDepositAll']);
    expect(h.root.querySelector('.vault-status')?.textContent).toBe(
      'Vault ceilings full: nothing deposited.',
    );
  });
});

describe('assistive-tech wiring and focus continuity', () => {
  it('publishes only into the current mounted Vault status region after a repaint', async () => {
    const h = harness(vaultInfo({ stock: { copper_ore: 40 } }));
    h.world.inventory = [{ itemId: 'copper_ore', count: 5 }];
    h.window.open();
    clickVaultTab(h);
    (h.root.querySelector('.vault-deposit-all') as HTMLButtonElement).click();
    const detached = h.root.querySelector('[data-vault-status-live]') as HTMLElement;
    expect(detached.textContent).toBe('');

    // Repaint before either microtask runs. The first callback must not write
    // into its detached region; the replacement is the one that announces.
    h.window.render();
    const current = h.root.querySelector('[data-vault-status-live]') as HTMLElement;
    expect(current).not.toBe(detached);
    expect(current.textContent).toBe('');
    await Promise.resolve();
    expect(detached.textContent).toBe('');
    expect(current.textContent).toBe('Vault ceilings full: nothing deposited.');
  });

  it('the pane is a role=tabpanel labelled by its tab, and the tab controls it', () => {
    const h = harness(vaultInfo({ stock: { copper_ore: 5 } }));
    h.window.open();
    clickVaultTab(h);
    const panel = h.root.querySelector('#bank-panel-vault') as HTMLElement;
    expect(panel.getAttribute('role')).toBe('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe('bank-tab-vault');
    const tab = h.root.querySelector('#bank-tab-vault') as HTMLElement;
    expect(tab.getAttribute('aria-controls')).toBe('bank-panel-vault');
  });

  it('an echo repaint lands focus back on the row the keyboard user was on', () => {
    const h = harness(vaultInfo({ stock: { ashwood_log: 3, copper_ore: 5 } }));
    h.window.open();
    clickVaultTab(h);
    const rows = h.root.querySelectorAll<HTMLElement>('.vault-row');
    expect(rows[1].dataset.focusKey).toBe('vault:row:pooled:copper_ore');
    rows[1].focus();
    // A data change (another client's echo) drives a signature repaint; the
    // material focus key re-lands focus on the same row, never <body> and
    // never the close button while the row survives.
    h.world.vaultInfo = vaultInfo({ stock: { ashwood_log: 3, copper_ore: 9 } });
    h.window.refreshIfChanged();
    const fresh = h.root.querySelectorAll<HTMLElement>('.vault-row');
    expect(document.activeElement).toBe(fresh[1]);
    expect(fresh[1].dataset.itemId).toBe('copper_ore');
  });

  it('an inserted earlier row keeps focus and activation on the same material', () => {
    // A repaint may insert or re-sort stock above the focused material. Focus
    // identity follows the MATERIAL, not its old row position, so pressing
    // Enter after the echo can never withdraw a different item.
    const h = harness(vaultInfo({ stock: { ashwood_log: 3, copper_ore: 5 } }));
    h.window.open();
    clickVaultTab(h);
    h.root.querySelectorAll<HTMLElement>('.vault-row')[1].focus(); // copper_ore
    h.world.vaultInfo = vaultInfo({
      stock: { aa_new_material: 2, ashwood_log: 3, copper_ore: 5 },
    });
    h.window.refreshIfChanged();
    const fresh = h.root.querySelectorAll<HTMLElement>('.vault-row');
    expect(fresh).toHaveLength(3);
    const copper = Array.from(fresh).find((row) => row.dataset.itemId === 'copper_ore');
    expect(document.activeElement).toBe(copper);
    (document.activeElement as HTMLElement).click();
    expect(h.calls).toEqual(['vaultWithdraw:copper_ore']);
  });

  it('a hostile stock id (an attribute-breaking quote) cannot fault the repaint', () => {
    // The captured focus key includes this server-supplied stock id. Resolution
    // must compare dataset values, never splice it into an attribute selector.
    const hostile = 'a"b]';
    const h = harness(vaultInfo({ stock: { [hostile]: 3, copper_ore: 5 } }));
    h.window.open();
    clickVaultTab(h);
    const rows = h.root.querySelectorAll<HTMLElement>('.vault-row');
    expect(rows[0].dataset.itemId).toBe(hostile); // sorts first; renders fine
    rows[0].focus();
    h.world.vaultInfo = vaultInfo({ stock: { [hostile]: 4, copper_ore: 5 } });
    expect(() => h.window.refreshIfChanged()).not.toThrow();
    expect(document.activeElement).toBe(h.root.querySelectorAll<HTMLElement>('.vault-row')[0]);
  });
});

describe('signature-driven repaints', () => {
  it('the signature is CONTENT-keyed: identical content elides, an in-place change repaints', () => {
    // Identity is the wrong signal in both directions (the signature comment's
    // rationale), and each wrong direction gets its own decisive arm here.
    const h = harness(vaultInfo({ stock: { copper_ore: 5 } }));
    h.window.open();
    clickVaultTab(h);
    expect(h.root.querySelector('.vault-row-count')?.textContent).toBe('5/40');
    // Sync lastSig first: the tab click rendered directly without moving it.
    h.window.refreshIfChanged();

    // Arm 1: a FRESH object with identical content must NOT rebuild (offline
    // mints a new clone every read, so identity-keying would repaint every
    // poll). The probe stamp only survives an elided repaint.
    (h.root.querySelector('.vault-row') as HTMLElement).dataset.probe = 'kept';
    h.world.vaultInfo = vaultInfo({ stock: { copper_ore: 5 } });
    h.window.refreshIfChanged();
    expect((h.root.querySelector('.vault-row') as HTMLElement).dataset.probe).toBe('kept');

    // Arm 2: the SAME object mutated in place must rebuild (online adopts the
    // wire object by reference; an identity check would sleep through this).
    (h.world.vaultInfo as VaultInfo).stock.copper_ore = 9;
    h.window.refreshIfChanged();
    expect(h.root.querySelector('.vault-row-count')?.textContent).toBe('9/40');
  });

  it('an in-place special-row change repaints while the vault pane is showing', () => {
    const h = harness(
      vaultInfo({
        special: [{ itemId: 'copper_ore', count: 1, instance: { signer: 'Ada' } }],
      }),
    );
    h.window.open();
    clickVaultTab(h);
    h.window.refreshIfChanged();
    const row = h.root.querySelector('.vault-row-special') as HTMLElement;
    row.dataset.probe = 'stale';

    (h.world.vaultInfo as VaultInfo).special[0].count = 2;
    h.window.refreshIfChanged();

    const fresh = h.root.querySelector('.vault-row-special') as HTMLElement;
    expect(fresh.dataset.probe).toBeUndefined();
    expect(fresh.querySelector('.vault-row-stack-count')?.textContent).toContain('2');
  });

  it('a special-row reorder repaints exact index selectors even when fingerprints duplicate', () => {
    const h = harness(
      vaultInfo({
        special: [
          { itemId: 'copper_ore', count: 1, instance: { signer: 'Ada' } },
          { itemId: 'copper_ore', count: 2, instance: { signer: 'Ada' } },
        ],
      }),
    );
    h.window.open();
    clickVaultTab(h);
    h.window.refreshIfChanged();
    const first = h.root.querySelector<HTMLElement>('[data-vault-special-index="0"]');
    expect(first?.querySelector('.vault-row-stack-count')?.textContent).toContain('1');
    if (first) first.dataset.probe = 'stale-index';

    // The wire selector's index is authoritative when two payload fingerprints
    // are otherwise identical. Reordering must repaint even though the sorted
    // multiset of row contents did not change.
    (h.world.vaultInfo as VaultInfo).special.reverse();
    h.window.refreshIfChanged();

    const fresh = h.root.querySelector<HTMLElement>('[data-vault-special-index="0"]');
    expect(fresh?.dataset.probe).toBeUndefined();
    expect(fresh?.querySelector('.vault-row-stack-count')?.textContent).toContain('2');
  });

  it('a stock change on ANOTHER tab elides (the gated term), and re-entry paints fresh', () => {
    // The signature's stock term is scoped to the vault tab: no other pane
    // renders stock, so its churn must not rebuild them (deleting the gate
    // restores a sort-plus-serialize on every poll of every tab with nothing
    // else red, which is exactly the perf this arm pins). Re-entering the
    // tab renders directly, so the elision can never show stale rows.
    const h = harness(vaultInfo({ stock: { copper_ore: 5 } }));
    h.window.open(); // personal tab
    h.window.refreshIfChanged(); // sync lastSig on the personal-tab signature
    (h.root.querySelector('.panel-title') as HTMLElement).dataset.probe = 'kept';
    (h.world.vaultInfo as VaultInfo).stock.copper_ore = 9; // in place: no new identity
    h.window.refreshIfChanged();
    expect((h.root.querySelector('.panel-title') as HTMLElement).dataset.probe).toBe('kept');
    // Re-entry: the tab click renders unconditionally and shows the change.
    clickVaultTab(h);
    expect(h.root.querySelector('.vault-row-count')?.textContent).toBe('9/40');
  });

  it('a rung purchase repaints the footer even when the stock is byte-identical', () => {
    // The three scalar signature terms (upgrades / perMaterialCap /
    // nextUpgradeCost) lack any stock echo. The fixture moves all three at
    // once, so this arm reds when the GROUP is dropped (a single dropped
    // term hides behind the other two); the group is how a real rung
    // purchase moves them, and dropping the whole vault arm is the
    // regression that ships a footer advertising the rung just bought.
    const h = harness(vaultInfo({ stock: { copper_ore: 1 }, nextUpgradeCost: 50000 }));
    h.window.open();
    clickVaultTab(h);
    expect(
      (h.root.querySelector('.vault-upgrade-btn') as HTMLElement).querySelector('.money-inline')
        ?.textContent,
    ).toBe('50000');
    h.window.refreshIfChanged();
    h.world.vaultInfo = vaultInfo({
      stock: { copper_ore: 1 }, // byte-identical stock
      upgrades: 2,
      perMaterialCap: 80,
      nextUpgradeCost: 100000,
    });
    h.window.refreshIfChanged();
    const upgrade = h.root.querySelector('.vault-upgrade-btn') as HTMLElement;
    expect(upgrade.querySelector('.money-inline')?.textContent).toBe('100000');
    expect(upgrade.textContent).toContain('120'); // the next ceiling: wire 80 + the 40 step
    expect(h.root.querySelector('.vault-cap-note')?.textContent).toBe(
      'Each material holds up to 80.',
    );
  });

  it('a tab switch pauses the status timer so it cannot rebuild an unrelated pane', () => {
    vi.useFakeTimers();
    try {
      // The ceiling-blocked rig arms the STATUS timer alone (the None arm
      // sets a status but never the pending guard, whose fallback timer
      // legitimately fires wherever it must to re-enable the button).
      const h = harness(vaultInfo({ stock: { copper_ore: 40 } }));
      h.world.inventory = [{ itemId: 'copper_ore', count: 5 }];
      h.window.open();
      clickVaultTab(h);
      (h.root.querySelector('.vault-deposit-all') as HTMLElement).click();
      expect(h.root.querySelector('.vault-status')).not.toBeNull();
      // Switch to Personal: the render pauses the timer. Mark the fresh DOM;
      // a late timer firing render() would wipe the probe.
      (h.root.querySelector('.bank-tab[data-tab="personal"]') as HTMLElement).click();
      (h.root.querySelector('.panel-title') as HTMLElement).dataset.probe = 'kept';
      vi.advanceTimersByTime(10_000);
      expect((h.root.querySelector('.panel-title') as HTMLElement).dataset.probe).toBe('kept');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a language switch relocalizes a live status line (key plus params storage)', async () => {
    try {
      const h = harness(vaultInfo({ stock: { copper_ore: 35 } }));
      h.world.inventory = [{ itemId: 'copper_ore', count: 10 }];
      h.window.open();
      clickVaultTab(h);
      (h.root.querySelector('.vault-deposit-all') as HTMLElement).click();
      expect(h.root.querySelector('.vault-status')?.textContent).toBe(
        'Materials deposited: 5. Some ceilings are full.',
      );
      // zh_CN carries a REAL fill for the key (the M16 set), so the rebuilt
      // line must come out translated: a resolved-string store would keep
      // the English (the bank's recorded family gap). The dense table is
      // lazy-loaded, so it must be resident BEFORE the synchronous switch
      // (the src/main.ts bootstrap order).
      await ensureLocaleLoaded('zh_CN');
      setLanguage('zh_CN');
      h.window.render();
      expect(h.root.querySelector('.vault-status')?.textContent).toContain('已存入材料');
      const live = h.root.querySelector('[data-vault-status-live]');
      expect(live?.textContent).toBe('');
      await Promise.resolve();
      expect(live?.textContent).toContain('已存入材料');
    } finally {
      setLanguage('en');
    }
  });

  it('close() drops the vault transient state so a reopen never flashes a stale line', () => {
    vi.useFakeTimers();
    try {
      const h = harness(vaultInfo({ stock: { copper_ore: 35 } }));
      h.world.inventory = [{ itemId: 'copper_ore', count: 10 }];
      h.window.open();
      clickVaultTab(h);
      (h.root.querySelector('.vault-deposit-all') as HTMLElement).click();
      expect(h.root.querySelector('.vault-status')).not.toBeNull();
      h.window.close();
      h.window.open();
      clickVaultTab(h);
      expect(h.root.querySelector('.vault-status')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('vaultTabActive (the bags-companion arming getter)', () => {
  it('true only while OPEN on the vault tab with the vault UNLOCKED', () => {
    const h = harness(vaultInfo());
    expect(h.window.vaultTabActive).toBe(false); // closed
    h.window.open();
    expect(h.window.vaultTabActive).toBe(false); // personal tab showing
    clickVaultTab(h);
    expect(h.window.vaultTabActive).toBe(true);
    h.window.close();
    expect(h.window.vaultTabActive).toBe(false); // closed again
  });

  it('the LOCKED pane arms nothing even while its panel is showing (the purchase-surface rule)', () => {
    const h = harness(vaultInfo({ upgrades: 0, perMaterialCap: 0, nextUpgradeCost: 20000 }));
    h.window.open();
    clickVaultTab(h);
    expect(h.root.querySelector('#bank-panel-vault')).not.toBeNull();
    expect(h.window.vaultTabActive).toBe(false);
  });
});

describe('the vault render sinks resolve their catalog keys', () => {
  // A dropped or mis-wired sink renders blank with tsc still green (the key
  // union catches renames, never a missing t() call), so every player-facing
  // vault surface pins its resolved ENGLISH here.
  it('tab label, capacity note, row aria, and the stocked row name', () => {
    const h = harness(vaultInfo({ stock: { copper_ore: 40 } }));
    h.window.open();
    expect(vaultTabButton(h)?.textContent).toBe('Vault');
    clickVaultTab(h);
    expect(h.root.querySelector('.vault-cap-note')?.textContent).toBe(
      'Each material holds up to 40.',
    );
    const row = h.root.querySelector('.vault-row') as HTMLElement;
    expect(row.getAttribute('aria-label')).toBe('Withdraw Copper Ore');
    expect(h.root.querySelector(`#${row.getAttribute('aria-describedby')}`)?.textContent).toBe(
      'Copper Ore: 40 of 40 stored',
    );
    // The KNOWN item renders its display name, never the raw id, and carries
    // its quality custom property (the core's known/qualityKey decisions).
    expect(row.querySelector('.vault-row-name')?.textContent).toBe('Copper Ore');
    expect(row.style.getPropertyValue('--bank-slot-quality')).not.toBe('');
  });

  it('the empty state line', () => {
    const h = harness(vaultInfo());
    h.window.open();
    clickVaultTab(h);
    expect(h.root.querySelector('.bank-empty')?.textContent).toBe(
      'Your vault is empty. Click a material in your bags to deposit it.',
    );
  });

  it('the locked pitch, the unlock button label, and the unlock confirm body', () => {
    const h = harness(vaultInfo({ upgrades: 0, perMaterialCap: 0, nextUpgradeCost: 20000 }));
    h.window.open();
    clickVaultTab(h);
    expect(h.root.querySelector('.vault-locked-intro')?.textContent).toBe(
      'Unlock the Materials Vault to stockpile crafting materials beside your bank. Every material gets its own room, up to 40 apiece.',
    );
    const unlock = h.root.querySelector('.vault-unlock-btn') as HTMLElement;
    expect(unlock.querySelector('.bank-buy-label')?.textContent).toBe('Unlock the Materials Vault');
    unlock.click();
    const prompt = document.querySelector('#prompt-stack .vault-buy-prompt') as HTMLElement;
    expect(prompt.querySelector('.prompt-text')?.textContent).toBe(
      'Unlock the Materials Vault for 2g 0s?',
    );
  });

  it('the upgrade confirm body', () => {
    const h = harness(vaultInfo({ stock: { copper_ore: 1 } }));
    h.window.open();
    clickVaultTab(h);
    (h.root.querySelector('.vault-upgrade-btn') as HTMLElement).click();
    const prompt = document.querySelector('#prompt-stack .vault-buy-prompt') as HTMLElement;
    expect(prompt.querySelector('.prompt-text')?.textContent).toBe(
      'Widen every material ceiling to 80 for 5g 0s?',
    );
  });

  it('the deposit-all button label, its title, and the aria-describedby pair', () => {
    const h = harness(vaultInfo({ stock: { copper_ore: 1 } }));
    h.window.open();
    clickVaultTab(h);
    const btn = h.root.querySelector('.vault-deposit-all') as HTMLButtonElement;
    expect(btn.textContent).toBe('Deposit all materials');
    const tooltip =
      'Sends every material from your bags to your vault in one trip, filling each material up to its ceiling. Gear, tools, quest items, and consumables are never touched.';
    expect(btn.title).toBe(tooltip);
    expect(btn.getAttribute('aria-describedby')).toBe('vault-deposit-all-desc');
    const desc = h.root.querySelector('#vault-deposit-all-desc') as HTMLElement;
    expect(desc.textContent).toBe(tooltip);
    expect(desc.classList.contains('visually-hidden')).toBe(true);
  });
});

describe('deposit-all pending guard timers and dead-honesty arms', () => {
  it('the lost-echo fallback re-enables the button after the status window', () => {
    vi.useFakeTimers();
    try {
      const h = harness(vaultInfo({ stock: { copper_ore: 35 } }));
      h.world.inventory = [{ itemId: 'copper_ore', count: 10 }];
      h.window.open();
      clickVaultTab(h);
      (h.root.querySelector('.vault-deposit-all') as HTMLElement).click();
      expect((h.root.querySelector('.vault-deposit-all') as HTMLButtonElement).disabled).toBe(true);
      // No signature move arrives (the echo was lost): the fallback timer,
      // not the signature, must re-enable the button.
      vi.advanceTimersByTime(4000);
      expect((h.root.querySelector('.vault-deposit-all') as HTMLButtonElement).disabled).toBe(
        false,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('the status line self-expires while the pane stays on screen', () => {
    vi.useFakeTimers();
    try {
      const h = harness(vaultInfo({ stock: { copper_ore: 40 } }));
      h.world.inventory = [{ itemId: 'copper_ore', count: 5 }]; // ceiling-blocked: None arm
      h.window.open();
      clickVaultTab(h);
      (h.root.querySelector('.vault-deposit-all') as HTMLElement).click();
      expect(h.root.querySelector('.vault-status')).not.toBeNull();
      vi.advanceTimersByTime(4000);
      expect(h.root.querySelector('.vault-status')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('while dead a row click still sends but the shortfall line stays quiet', () => {
    // The partial-fit rig from the shortfall test, dead: predicting a
    // shortfall would explain a withdraw the sim silently refuses.
    const h = harness(vaultInfo({ stock: { copper_ore: 40 } }));
    h.world.inventory = [
      ...Array.from({ length: 14 }, (_, i) => ({ itemId: `gear_${i}`, count: 1 })),
      { itemId: 'copper_ore', count: 15 },
    ];
    h.world.player.dead = true;
    h.window.open();
    clickVaultTab(h);
    (h.root.querySelector('.vault-row') as HTMLElement).click();
    expect(h.calls).toEqual(['vaultWithdraw:copper_ore']);
    expect(h.root.querySelector('.vault-status')).toBeNull();
  });

  it('a long-press tooltip peek release never withdraws (consumePeek)', () => {
    // The bank grid rule: the release of a mobile long-press tooltip peek is
    // a CLICK the row handler must swallow, or every peek ships a phantom
    // whole-count withdraw.
    const h = harness(vaultInfo({ stock: { copper_ore: 7 } }), { consumePeek: () => true });
    h.window.open();
    clickVaultTab(h);
    (h.root.querySelector('.vault-row') as HTMLElement).click();
    expect(h.calls).toEqual([]); // suppressed: no withdraw sent
  });

  it('resolveCount refuses a row that emptied under the open prompt (the UI hasOwn read)', () => {
    // stock {toString: 5}: a prototype-named DORMANT id. The prompt opens off
    // the rendered row (max 5); the mirror then empties. At submit the live
    // re-resolve must read the OWN stock only: without the hasOwn guard,
    // stock['toString'] resolves to the inherited function, the <= 0 refusal
    // misses, and Math.min(5, fn, requested) sends vaultWithdraw with NaN.
    const h = harness(vaultInfo({ stock: JSON.parse('{"toString": 5}') }));
    h.window.open();
    clickVaultTab(h);
    const row = h.root.querySelector('.vault-row') as HTMLElement;
    row.dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
    const prompt = document.querySelector('#prompt-stack .vault-quantity-prompt') as HTMLElement;
    expect(prompt).not.toBeNull();
    h.world.vaultInfo = vaultInfo({ stock: {} }); // the row empties mid-prompt
    const input = prompt.querySelector('input') as HTMLInputElement;
    input.value = '3';
    const confirm = Array.from(prompt.querySelectorAll('button')).find(
      (b) => b.textContent === 'Withdraw',
    ) as HTMLElement;
    confirm.click();
    expect(h.calls).toEqual([]); // refused: nothing sent, no NaN on the wire
    expect(document.querySelector('#prompt-stack .vault-quantity-prompt')).toBeNull();
  });
});

describe('vault focus keys (the ordinal ruling, beyond the rows)', () => {
  it('the three buttons carry their literal focus keys and focus survives a repaint', () => {
    const h = harness(vaultInfo({ stock: { copper_ore: 5 } }));
    h.window.open();
    clickVaultTab(h);
    const deposit = h.root.querySelector('.vault-deposit-all') as HTMLElement;
    const upgrade = h.root.querySelector('.vault-upgrade-btn') as HTMLElement;
    expect(deposit.dataset.focusKey).toBe('vault:deposit-all');
    expect(upgrade.dataset.focusKey).toBe('vault:upgrade');
    // The upgrade button carries the focus-survival probe: the deposit-all
    // button is DISABLED in this bagless harness (nothing depositable), and a
    // disabled control can neither hold focus nor be restored to.
    upgrade.focus();
    h.window.refreshIfChanged();
    (h.world.vaultInfo as VaultInfo).stock.copper_ore = 9; // in-place: forces a rebuild
    h.window.refreshIfChanged();
    expect(document.activeElement).toBe(h.root.querySelector('.vault-upgrade-btn'));
  });

  it('the unlock button carries its focus key on the locked pane', () => {
    const h = harness(vaultInfo({ upgrades: 0, perMaterialCap: 0, nextUpgradeCost: 20000 }));
    h.window.open();
    clickVaultTab(h);
    expect((h.root.querySelector('.vault-unlock-btn') as HTMLElement).dataset.focusKey).toBe(
      'vault:unlock',
    );
  });
});

describe('the personal footer meter and the vault tab (phase 08 QA)', () => {
  it('the footer renders on the personal pane and not while the vault tab is active', () => {
    // The meter is personal-pane chrome: the vault pane keeps its own note +
    // buy row, so a footer bleeding through the tab switch would double the
    // purchase affordances the hard rules cap at one.
    const h = harness(vaultInfo());
    h.window.open();
    expect(h.root.querySelector('.bank-footer')).not.toBeNull();
    (h.root.querySelector('.bank-tab[data-tab="vault"]') as HTMLElement).click();
    expect(h.root.querySelector('.bank-footer')).toBeNull();
    // And back: the personal pane returns with its one footer.
    (h.root.querySelector('.bank-tab[data-tab="personal"]') as HTMLElement).click();
    expect(h.root.querySelectorAll('.bank-footer')).toHaveLength(1);
  });
});
