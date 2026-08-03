// @vitest-environment jsdom
// Drives the REAL BankWindow (with its composed GuildBankTab pane) against a
// jsdom container: the Guild tab renders ONLY while guildBankInfo is non-null
// (officer-plus at a banker, online), every action round-trips through the
// IWorldGuildBank facet commands, dormant (pipe-refused) slots render visibly
// distinct and are NEVER hidden (the carried-forward Phase 3 QA line), and
// walking away / losing the rank empties the Guild tab state cleanly.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { stackSizeOf } from '../src/sim/bags';
import { ITEMS } from '../src/sim/data';
import { GUILD_BANK_EXPANSION_PRICES } from '../src/sim/guild_bank';
import type { InvSlot } from '../src/sim/types';
import { BankWindow, type BankWindowDeps } from '../src/ui/bank_window';
import type { BankInfo, GuildBankInfo, IWorld } from '../src/world_api';

// Real merged-table ids so the pane renders true defs: a plain stackable, a
// quest def, and a soulbound def (each derived, never hardcoded, so a content
// rename cannot silently rot this suite into the unknown-id path).
const plainId = Object.keys(ITEMS).find((id) => {
  const d = ITEMS[id];
  return !d.soulbound && !d.noMarketList && d.kind !== 'quest' && stackSizeOf(d) > 1;
}) as string;
const questId = Object.keys(ITEMS).find((id) => ITEMS[id].kind === 'quest') as string;
const soulboundId = Object.keys(ITEMS).find(
  (id) => ITEMS[id].soulbound && ITEMS[id].kind !== 'quest',
) as string;

function personalInfo(): BankInfo {
  return {
    slots: [],
    capacity: 24,
    purchasedSlots: 0,
    bonusSlots: 0,
    nextExpansionCost: 500,
    bonusSources: [],
  };
}

function guildInfo(over: Partial<GuildBankInfo> = {}): GuildBankInfo {
  return {
    treasury: 60_000,
    slots: [],
    capacity: 12,
    purchasedSlots: 0,
    nextExpansionPrice: GUILD_BANK_EXPANSION_PRICES[0],
    ...over,
  };
}

interface Harness {
  window: BankWindow;
  root: HTMLElement;
  world: {
    bankInfo: BankInfo | null;
    guildBankInfo: GuildBankInfo | null;
    inventory: InvSlot[];
    copper: number;
  };
  calls: string[];
}

function harness(guild: GuildBankInfo | null): Harness {
  document.body.innerHTML = '<div id="prompt-stack"></div>';
  const root = document.createElement('div');
  root.id = 'bank-window';
  document.body.appendChild(root);
  const calls: string[] = [];
  const world = {
    bankInfo: personalInfo(),
    guildBankInfo: guild,
    inventory: [] as InvSlot[],
    copper: 5_000,
    bankDeposit: (...a: unknown[]) => calls.push(`bankDeposit:${a.join(',')}`),
    bankWithdraw: (...a: unknown[]) => calls.push(`bankWithdraw:${a.join(',')}`),
    bankBuySlots: () => calls.push('bankBuySlots'),
    guildBankDepositGold: (amount: number) => calls.push(`guildBankDepositGold:${amount}`),
    guildBankWithdrawGold: (amount: number) => calls.push(`guildBankWithdrawGold:${amount}`),
    guildBankDeposit: (...a: unknown[]) => calls.push(`guildBankDeposit:${a.join(',')}`),
    guildBankWithdraw: (...a: unknown[]) =>
      calls.push(`guildBankWithdraw:${a.filter((x) => x !== undefined).join(',')}`),
    guildBankBuySlots: () => calls.push('guildBankBuySlots'),
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
  };
  return { window: new BankWindow(deps), root, world, calls };
}

function clickGuildTab(h: Harness): void {
  (h.root.querySelector('.bank-tab[data-tab="guild"]') as HTMLElement).click();
}

beforeEach(() => {
  localStorage.clear();
});

describe('guild_bank_window: no magic values (the bank_window twin)', () => {
  // Plain repo-relative paths: under the jsdom environment import.meta.url is
  // not a file: URL, so the sibling suites' new URL(...) idiom cannot be used.
  const painter = readFileSync('src/ui/guild_bank_window.ts', 'utf8');
  const components = readFileSync('src/styles/components.css', 'utf8');

  it('carries no literal hex color in TS (quality color comes from QUALITY_COLOR + a token)', () => {
    const hex = painter.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hex, `hex colors must move to tokens: ${hex.join(', ')}`).toEqual([]);
  });

  it('uses the --color-quality-default token for the unranked-quality fallback', () => {
    expect(painter).toContain('var(--color-quality-default)');
  });

  it('uses no em or en dashes (ASCII separators only)', () => {
    expect(painter.includes('—'), 'em dash found').toBe(false);
    expect(painter.includes('–'), 'en dash found').toBe(false);
  });

  it('gives the tab strip and the gold buttons a tokenized :focus-visible ring', () => {
    expect(components).toMatch(
      /\.bank-tab:focus-visible \{\s*outline: 2px solid var\(--color-border-focus\);/,
    );
    expect(components).toMatch(
      /\.gbank-gold-btn:focus-visible \{\s*outline: 2px solid var\(--color-border-focus\);/,
    );
  });
});

describe('guild tab visibility', () => {
  it('renders NO tab strip while guildBankInfo is null (member / offline)', () => {
    const h = harness(null);
    h.window.open();
    expect(h.root.querySelector('.bank-tabs')).toBeNull();
    expect(h.root.querySelector('.bank-tab')).toBeNull();
    // The personal pane still renders normally.
    expect(h.root.querySelector('.bank-capacity')).not.toBeNull();
  });

  it('renders the WAI-ARIA Personal/Guild strip while guildBankInfo is non-null', () => {
    const h = harness(guildInfo());
    h.window.open();
    const strip = h.root.querySelector('.bank-tabs');
    expect(strip?.getAttribute('role')).toBe('tablist');
    const tabs = h.root.querySelectorAll('.bank-tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0].getAttribute('data-tab')).toBe('personal');
    expect(tabs[1].getAttribute('data-tab')).toBe('guild');
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    // Opens on Personal: the guild pane is opt-in per open.
    expect(h.root.querySelector('.gbank-treasury')).toBeNull();
  });

  it('switching to Guild renders the treasury, grid, and buy row; guildTabActive flips', () => {
    const h = harness(guildInfo({ treasury: 60_000 }));
    h.window.open();
    expect(h.window.guildTabActive).toBe(false);
    clickGuildTab(h);
    expect(h.window.guildTabActive).toBe(true);
    expect(h.root.querySelector('.gbank-treasury .money-inline')?.textContent).toBe('60000');
    expect(h.root.querySelector('.bank-grid')).not.toBeNull();
    expect(h.root.querySelector('.gbank-buy-row')).not.toBeNull();
    // The personal filter toolbar does not exist on the guild pane.
    expect(h.root.querySelector('.bank-filter-bar')).toBeNull();
  });

  it('falls back to Personal (strip gone, state emptied) when guildBankInfo goes null mid-open', () => {
    const h = harness(guildInfo());
    h.window.open();
    clickGuildTab(h);
    expect(h.window.guildTabActive).toBe(true);
    // Demotion / leave / reconcile window: the mirror nulls, the slow band refreshes.
    h.world.guildBankInfo = null;
    h.window.refreshIfChanged();
    expect(h.window.guildTabActive).toBe(false);
    expect(h.root.querySelector('.bank-tabs')).toBeNull();
    expect(h.root.querySelector('.gbank-treasury')).toBeNull();
    expect(h.root.querySelector('.bank-capacity')).not.toBeNull(); // personal pane back
  });

  it('close() resets the pane to Personal for the next open', () => {
    const h = harness(guildInfo());
    h.window.open();
    clickGuildTab(h);
    h.window.close();
    h.window.open();
    expect(h.window.guildTabActive).toBe(false);
    expect(
      h.root.querySelector('.bank-tab[data-tab="personal"]')?.getAttribute('aria-selected'),
    ).toBe('true');
  });
});

describe('guild pane rendering', () => {
  it('renders every slot at its wire index, dormant ones visibly distinct, NEVER hidden', () => {
    const slots: InvSlot[] = [
      { itemId: plainId, count: 5 },
      { itemId: questId, count: 1 },
      { itemId: soulboundId, count: 1 },
      { itemId: 'zz_removed_item', count: 2 }, // unknown id: renders, withdrawable
    ];
    const h = harness(guildInfo({ slots, capacity: 12 }));
    h.window.open();
    clickGuildTab(h);
    const cells = h.root.querySelectorAll('.bank-grid .bank-item:not(.empty)');
    expect(cells).toHaveLength(4);
    expect(cells[0].classList.contains('gbank-dormant')).toBe(false);
    expect(cells[1].classList.contains('gbank-dormant')).toBe(true);
    expect(cells[2].classList.contains('gbank-dormant')).toBe(true);
    // The dormant cells carry the lock mark and the dormant aria wording.
    expect(cells[1].querySelector('.gbank-dormant-mark')).not.toBeNull();
    expect(cells[1].getAttribute('aria-label')).toContain('cannot be withdrawn');
    // The unknown-id slot renders the localized unknown label, not an icon.
    expect(cells[3].classList.contains('gbank-unknown')).toBe(true);
    expect(cells[3].textContent).toContain('Unknown item');
    // The always-visible dormant legend (never tooltip-only) is present.
    expect(h.root.querySelector('.gbank-dormant-note')).not.toBeNull();
    // Empty pad fills the remaining capacity.
    expect(h.root.querySelectorAll('.bank-grid .bank-item.empty')).toHaveLength(8);
  });

  it('shows no dormant legend when nothing is dormant', () => {
    const h = harness(guildInfo({ slots: [{ itemId: plainId, count: 2 }] }));
    h.window.open();
    clickGuildTab(h);
    expect(h.root.querySelector('.gbank-dormant-note')).toBeNull();
  });

  it('disables withdraw-gold at zero treasury and deposit-gold at the cap', () => {
    const h = harness(guildInfo({ treasury: 0 }));
    h.window.open();
    clickGuildTab(h);
    const [deposit, withdraw] = Array.from(
      h.root.querySelectorAll<HTMLButtonElement>('.gbank-gold-btn'),
    );
    expect(deposit.disabled).toBe(false);
    expect(withdraw.disabled).toBe(true);
  });

  it('marks an unaffordable expansion with visible text and keeps the button enabled (sim-authoritative refusal)', () => {
    const price = GUILD_BANK_EXPANSION_PRICES[0];
    const h = harness(guildInfo({ treasury: price - 1 }));
    h.window.open();
    clickGuildTab(h);
    const btn = h.root.querySelector<HTMLButtonElement>('.bank-buy-btn');
    expect(btn?.disabled).toBe(false);
    expect(btn?.classList.contains('gbank-buy-short')).toBe(true);
    expect(btn?.querySelector('.gbank-buy-short-label')?.textContent).toBe('Treasury short');
    expect(h.root.querySelector('.gbank-buy-note')).not.toBeNull();
  });

  it('shows the maxed label once the ladder is exhausted', () => {
    const h = harness(guildInfo({ nextExpansionPrice: null, purchasedSlots: 36, capacity: 48 }));
    h.window.open();
    clickGuildTab(h);
    expect(h.root.querySelector('.bank-buy-btn')).toBeNull();
    expect(h.root.querySelector('.bank-buy-maxed')).not.toBeNull();
  });
});

describe('guild pane actions round-trip through the facet', () => {
  it('a plain click withdraws the whole stack via guildBankWithdraw(slotIndex)', () => {
    const h = harness(guildInfo({ slots: [{ itemId: plainId, count: 5 }] }));
    h.window.open();
    clickGuildTab(h);
    (h.root.querySelector('.bank-grid .bank-item') as HTMLElement).click();
    expect(h.calls).toContain('guildBankWithdraw:0');
  });

  it('a DORMANT slot click still sends the withdraw (the sim refusal round-trips), never a split prompt', () => {
    const h = harness(guildInfo({ slots: [{ itemId: questId, count: 1 }] }));
    h.window.open();
    clickGuildTab(h);
    (h.root.querySelector('.bank-grid .gbank-dormant') as HTMLElement).click();
    expect(h.calls).toContain('guildBankWithdraw:0');
    expect(document.querySelector('.gbank-quantity-prompt')).toBeNull();
  });

  it('shift-click on a splittable stack prompts, and the submit sends guildBankWithdraw(index, count)', () => {
    const h = harness(guildInfo({ slots: [{ itemId: plainId, count: 5 }] }));
    h.window.open();
    clickGuildTab(h);
    const cell = h.root.querySelector('.bank-grid .bank-item') as HTMLElement;
    cell.dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
    const prompt = document.querySelector('.gbank-quantity-prompt') as HTMLElement;
    expect(prompt).not.toBeNull();
    const input = prompt.querySelector('.prompt-number') as HTMLInputElement;
    input.value = '3';
    (prompt.querySelector('.btn') as HTMLElement).click();
    expect(h.calls).toContain('guildBankWithdraw:0,3');
  });

  it('the gold deposit prompt composes the coin fields and sends guildBankDepositGold', () => {
    const h = harness(guildInfo());
    h.world.copper = 50_000;
    h.window.open();
    clickGuildTab(h);
    (h.root.querySelectorAll('.gbank-gold-btn')[0] as HTMLElement).click();
    const prompt = document.querySelector('.gbank-gold-prompt') as HTMLElement;
    expect(prompt).not.toBeNull();
    const inputs = Array.from(prompt.querySelectorAll<HTMLInputElement>('.coininput'));
    inputs[0].value = '2'; // 2g
    inputs[1].value = '3'; // 3s
    inputs[2].value = '45'; // 45c
    (prompt.querySelector('.btn') as HTMLElement).click();
    expect(h.calls).toContain('guildBankDepositGold:20345');
  });

  it('an over-purse gold deposit REFUSES with the sim wording and sends nothing (never clamps down)', () => {
    // The sim's semantics are refuse-and-keep ('Not enough money.'); a silent
    // clamp-down would drain the whole purse on a typo.
    const h = harness(guildInfo());
    h.world.copper = 1_000;
    h.window.open();
    clickGuildTab(h);
    (h.root.querySelectorAll('.gbank-gold-btn')[0] as HTMLElement).click();
    const prompt = document.querySelector('.gbank-gold-prompt') as HTMLElement;
    const inputs = Array.from(prompt.querySelectorAll<HTMLInputElement>('.coininput'));
    inputs[0].value = '9'; // 9g requested, only 1000c held
    (prompt.querySelector('.btn') as HTMLElement).click();
    expect(h.calls.filter((c) => c.startsWith('guildBankDepositGold'))).toEqual([]);
    // The prompt stays open and voices the refusal in its live-region line.
    expect(document.querySelector('.gbank-gold-prompt')).not.toBeNull();
    expect(document.querySelector('.gbank-gold-error')?.textContent).toBe('Not enough money.');
  });

  it('a deposit past the treasury headroom refuses with the treasury-cap sim line', () => {
    const h = harness(guildInfo({ treasury: 999_999_000 })); // 1000c of headroom
    h.world.copper = 50_000;
    h.window.open();
    clickGuildTab(h);
    (h.root.querySelectorAll('.gbank-gold-btn')[0] as HTMLElement).click();
    const prompt = document.querySelector('.gbank-gold-prompt') as HTMLElement;
    const inputs = Array.from(prompt.querySelectorAll<HTMLInputElement>('.coininput'));
    inputs[0].value = '2'; // 2g > 1000c headroom (and within the purse)
    (prompt.querySelector('.btn') as HTMLElement).click();
    expect(h.calls.filter((c) => c.startsWith('guildBankDepositGold'))).toEqual([]);
    expect(document.querySelector('.gbank-gold-error')?.textContent).toBe(
      'The guild treasury cannot hold that much.',
    );
  });

  it('a stale plain click (another officer shifted the grid) sends NOTHING on an identity mismatch', () => {
    const h = harness(guildInfo({ slots: [{ itemId: plainId, count: 5 }] }));
    h.window.open();
    clickGuildTab(h);
    const cell = h.root.querySelector('.bank-grid .bank-item') as HTMLElement;
    // Another officer's op lands between the paint and the click: index 0 now
    // holds a DIFFERENT item in the mirror.
    h.world.guildBankInfo = guildInfo({ slots: [{ itemId: questId, count: 1 }] });
    cell.click();
    expect(h.calls.filter((c) => c.startsWith('guildBankWithdraw'))).toEqual([]);
  });

  it('the gold withdraw prompt sends guildBankWithdrawGold clamped to the treasury', () => {
    const h = harness(guildInfo({ treasury: 700 }));
    h.window.open();
    clickGuildTab(h);
    (h.root.querySelectorAll('.gbank-gold-btn')[1] as HTMLElement).click();
    const prompt = document.querySelector('.gbank-gold-prompt') as HTMLElement;
    const inputs = Array.from(prompt.querySelectorAll<HTMLInputElement>('.coininput'));
    inputs[0].value = '1'; // 1g requested, treasury holds 700c
    (prompt.querySelector('.btn') as HTMLElement).click();
    expect(h.calls).toContain('guildBankWithdrawGold:700');
  });

  it('a zero-amount gold submit sends NOTHING (the sim treats 0 as malformed-silent)', () => {
    const h = harness(guildInfo());
    h.window.open();
    clickGuildTab(h);
    (h.root.querySelectorAll('.gbank-gold-btn')[0] as HTMLElement).click();
    const prompt = document.querySelector('.gbank-gold-prompt') as HTMLElement;
    (prompt.querySelector('.btn') as HTMLElement).click(); // all fields still 0
    expect(h.calls.filter((c) => c.startsWith('guildBankDepositGold'))).toEqual([]);
  });

  it('the expansion confirm sends guildBankBuySlots (price is never client-supplied)', () => {
    const h = harness(guildInfo());
    h.window.open();
    clickGuildTab(h);
    (h.root.querySelector('.bank-buy-btn') as HTMLElement).click();
    const prompt = document.querySelector('.gbank-buy-prompt') as HTMLElement;
    expect(prompt).not.toBeNull();
    (prompt.querySelector('.btn') as HTMLElement).click();
    expect(h.calls).toContain('guildBankBuySlots');
  });

  it('opening a second guild prompt tears the first down (dismissPrompts at every opener)', () => {
    const h = harness(guildInfo());
    h.window.open();
    clickGuildTab(h);
    (h.root.querySelectorAll('.gbank-gold-btn')[0] as HTMLElement).click();
    expect(document.querySelectorAll('.gbank-gold-prompt')).toHaveLength(1);
    (h.root.querySelector('.bank-buy-btn') as HTMLElement).click();
    // The buy prompt replaced the gold prompt; prompts never stack.
    expect(document.querySelector('.gbank-gold-prompt')).toBeNull();
    expect(document.querySelectorAll('.gbank-buy-prompt')).toHaveLength(1);
  });

  it('force-closing the window tears down an open guild prompt (no orphaned aria-modal)', () => {
    const h = harness(guildInfo());
    h.window.open();
    clickGuildTab(h);
    (h.root.querySelectorAll('.gbank-gold-btn')[0] as HTMLElement).click();
    expect(document.querySelector('.gbank-gold-prompt')).not.toBeNull();
    h.window.close();
    expect(document.querySelector('.gbank-gold-prompt')).toBeNull();
    expect(h.root.inert).toBe(false);
  });
});
