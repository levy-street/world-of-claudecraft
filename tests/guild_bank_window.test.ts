// @vitest-environment jsdom
// Drives the REAL BankWindow (with its composed GuildBankTab pane) against a
// jsdom container: the Guild tab renders ONLY while guildBankInfo is non-null
// (officer-plus at a banker, online), every action round-trips through the
// IWorldGuildBank facet commands, dormant (pipe-refused) slots render visibly
// distinct and are NEVER hidden (the carried-forward Phase 3 QA line), and
// walking away / losing the rank empties the Guild tab state cleanly.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stackSizeOf } from '../src/sim/bags';
import { ITEMS } from '../src/sim/data';
import { GUILD_BANK_RUNG_PRICES, GUILD_BANK_TREASURY_CAP } from '../src/sim/guild_bank';
import type { InvSlot } from '../src/sim/types';
import { BankWindow, type BankWindowDeps } from '../src/ui/bank_window';
import {
  type BankInfo,
  GUILD_BANK_LOG_LIMIT,
  type GuildBankInfo,
  type GuildBankLogView,
  type IWorld,
} from '../src/world_api';

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

// The default snapshot is an OPENED bank (rung 0 bought); the unopened-pane
// suite overrides purchasedSlots to 0.
function guildInfo(over: Partial<GuildBankInfo> = {}): GuildBankInfo {
  return {
    treasury: 60_000,
    slots: [],
    capacity: 12,
    purchasedSlots: 24,
    nextExpansionPrice: GUILD_BANK_RUNG_PRICES[1],
    canEdit: true,
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
    /** The activity log the pane's on-demand read answers with. */
    logView: GuildBankLogView;
  };
  calls: string[];
  /** Tooltip factories in attach order (the escape pin renders them). */
  tooltips: Array<() => string>;
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
    // The activity log's on-demand read. Every call is recorded, so a test can
    // prove the log is fetched only while its view is OPEN.
    logView: { state: 'loading', entries: [] } as GuildBankLogView,
    guildBankLog: () => {
      calls.push('guildBankLog');
      return world.logView;
    },
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
  const tooltips: Array<() => string> = [];
  const deps: BankWindowDeps = {
    itemIcon: () => '<span class="item-icon"></span>',
    moneyHtml: (c: number) => `<span class="money-inline">${c}</span>`,
    itemTooltip: () => '',
    attachTooltip: (_el: HTMLElement, fn: () => string) => {
      tooltips.push(fn);
    },
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
  return { window: new BankWindow(deps), root, world, calls, tooltips };
}

function clickGuildTab(h: Harness): void {
  (h.root.querySelector('.bank-tab[data-tab="guild"]') as HTMLElement).click();
}

function clickLogTab(h: Harness): void {
  (h.root.querySelector('.gbank-view-tab[data-tab="log"]') as HTMLElement).click();
}

const logRows = (h: Harness): string[] =>
  Array.from(h.root.querySelectorAll('.gbank-log-row .gbank-log-text')).map(
    (n) => n.textContent ?? '',
  );

beforeEach(() => {
  localStorage.clear();
});

describe('guild_bank_window: no magic values (the bank_window twin)', () => {
  // Plain repo-relative paths: under the jsdom environment import.meta.url is
  // not a file: URL, so the sibling suites' new URL(...) idiom cannot be used.
  // BOTH guild painters. The repo's no-magic guard is deliberately
  // DECENTRALIZED (each painter scans its own source), so a new painter nobody
  // scans is a hole even while it happens to be clean.
  const painters = ['src/ui/guild_bank_window.ts', 'src/ui/guild_bank_log_window.ts'] as const;
  const painter = readFileSync('src/ui/guild_bank_window.ts', 'utf8');
  const components = readFileSync('src/styles/components.css', 'utf8');

  it('carries no literal hex color in TS (quality color comes from QUALITY_COLOR + a token)', () => {
    for (const file of painters) {
      const hex = readFileSync(file, 'utf8').match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
      expect(hex, `${file}: hex colors must move to tokens: ${hex.join(', ')}`).toEqual([]);
    }
  });

  it('uses the --color-quality-default token for the unranked-quality fallback', () => {
    expect(painter).toContain('var(--color-quality-default)');
  });

  it('uses no em or en dashes (ASCII separators only)', () => {
    for (const file of painters) {
      const src = readFileSync(file, 'utf8');
      expect(src.includes('\u2014'), `${file}: em dash found`).toBe(false);
      expect(src.includes('\u2013'), `${file}: en dash found`).toBe(false);
    }
  });

  it('gives the tab strips and the gold buttons a tokenized :focus-visible ring', () => {
    expect(components).toMatch(
      /\.bank-tab:focus-visible \{\s*outline: 2px solid var\(--color-border-focus\);/,
    );
    // The log's own sub-strip is chrome the keyboard lands on too.
    expect(components).toMatch(
      /\.gbank-view-tab:focus-visible \{\s*outline: 2px solid var\(--color-border-focus\);/,
    );
    expect(components).toMatch(
      /\.gbank-gold-btn:focus-visible \{\s*outline: 2px solid var\(--color-border-focus\);/,
    );
  });

  it('pins the mobile touch floor for the guild tab controls and the gold-prompt coin fields', () => {
    // The .gbank-* selectors match NEITHER anchor of bank_window.test.ts's
    // generic >=40px mobile scan (it keys on .bank-*), so their presence is
    // pinned here: deleting either rule must go red.
    const mobileCss = readFileSync('src/styles/hud.mobile.css', 'utf8');
    expect(mobileCss).toMatch(
      /body\.mobile-touch #bank-window \.bank-tab,\s*body\.mobile-touch #bank-window \.gbank-view-tab,\s*body\.mobile-touch #bank-window \.gbank-gold-btn \{\s*min-height: 40px;/,
    );
    expect(mobileCss).toMatch(
      /body\.mobile-touch \.gbank-coin-row \.coininput \{\s*min-height: 40px;\s*font-size: 16px;/,
    );
  });
});

describe('guild tab visibility', () => {
  it('renders NO tab strip while guildBankInfo is null (guildless / offline / away)', () => {
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

  it('guildTabActive goes false the INSTANT the mirror nulls, BEFORE any repaint', () => {
    // The one-frame stale-mode window: between the mirror nulling and the
    // slow-band repaint, a bag click must not route at guildBankDeposit. The
    // getter's third conjunct (live guildBankInfo) closes it; this pin fails
    // if that conjunct is dropped, because no render() has reset the tab yet.
    const h = harness(guildInfo());
    h.window.open();
    clickGuildTab(h);
    expect(h.window.guildTabActive).toBe(true);
    h.world.guildBankInfo = null; // deliberately NO refreshIfChanged here
    expect(h.window.guildTabActive).toBe(false);
  });

  it('keeps keyboard focus on the guild control across an EXTERNAL signature repaint', () => {
    // Another officer's op echoes through refreshIfChanged while a keyboard
    // user sits on a guild cell: focus must re-land on the SAME control in the
    // rebuilt tree (data-focus-key), never yank to the close button.
    const h = harness(guildInfo({ slots: [{ itemId: plainId, count: 5 }], treasury: 700 }));
    h.window.open();
    clickGuildTab(h);
    const cell = h.root.querySelector('.bank-grid .bank-item') as HTMLButtonElement;
    cell.focus();
    expect(document.activeElement).toBe(cell);
    h.world.guildBankInfo = guildInfo({ slots: [{ itemId: plainId, count: 5 }], treasury: 900 });
    h.window.refreshIfChanged();
    const fresh = h.root.querySelector('.bank-grid .bank-item') as HTMLButtonElement;
    expect(fresh).not.toBe(cell); // the tree really was rebuilt
    expect(document.activeElement).toBe(fresh);
    // Same for the tab strip: focus parked on the Guild tab stays there.
    const tab = h.root.querySelector('.bank-tab[data-tab="guild"]') as HTMLButtonElement;
    tab.focus();
    h.world.guildBankInfo = guildInfo({ slots: [{ itemId: plainId, count: 5 }], treasury: 950 });
    h.window.refreshIfChanged();
    expect((document.activeElement as HTMLElement | null)?.getAttribute('data-focus-key')).toBe(
      'tab:guild',
    );
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
    const empty = harness(guildInfo({ treasury: 0 }));
    empty.window.open();
    clickGuildTab(empty);
    const [deposit, withdraw] = Array.from(
      empty.root.querySelectorAll<HTMLButtonElement>('.gbank-gold-btn'),
    );
    expect(deposit.disabled).toBe(false);
    expect(withdraw.disabled).toBe(true);
    // The cap arm, independently: deposit disables, withdraw stays live.
    const full = harness(guildInfo({ treasury: GUILD_BANK_TREASURY_CAP }));
    full.window.open();
    clickGuildTab(full);
    const [depositFull, withdrawFull] = Array.from(
      full.root.querySelectorAll<HTMLButtonElement>('.gbank-gold-btn'),
    );
    expect(depositFull.disabled).toBe(true);
    expect(withdrawFull.disabled).toBe(false);
  });

  it('marks an unaffordable expansion with visible text and keeps the button enabled (sim-authoritative refusal)', () => {
    const price = GUILD_BANK_RUNG_PRICES[1]; // rung 1: the first treasury expansion
    const h = harness(guildInfo({ treasury: price - 1 }));
    h.window.open();
    clickGuildTab(h);
    const btn = h.root.querySelector<HTMLButtonElement>('.bank-buy-btn');
    expect(btn?.disabled).toBe(false);
    expect(btn?.classList.contains('gbank-buy-short')).toBe(true);
    expect(btn?.querySelector('.gbank-buy-short-label')?.textContent).toBe('Treasury short');
    expect(h.root.querySelector('.gbank-buy-note')).not.toBeNull();
    // The affordable arm carries NO marker (a painter that always appends it
    // must fail here).
    const rich = harness(guildInfo({ treasury: price }));
    rich.window.open();
    clickGuildTab(rich);
    const richBtn = rich.root.querySelector<HTMLButtonElement>('.bank-buy-btn');
    expect(richBtn?.disabled).toBe(false);
    expect(richBtn?.classList.contains('gbank-buy-short')).toBe(false);
    expect(richBtn?.querySelector('.gbank-buy-short-label')).toBeNull();
  });

  it('escapes interpolated text: a hostile unknown item id cannot inject markup', () => {
    const hostile = '<img src=x onerror="window.pwned=1">';
    const h = harness(guildInfo({ slots: [{ itemId: hostile, count: 1 }] }));
    h.window.open();
    clickGuildTab(h);
    // The cell itself renders no unescaped markup off the id.
    expect(h.root.querySelector('.bank-grid img')).toBeNull();
    // The tooltip factory interpolates the raw id (the only name a removed def
    // has): render it and prove esc() is in the path.
    const html = h.tooltips.map((fn) => fn()).join('');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    const probe = document.createElement('div');
    probe.innerHTML = html;
    expect(probe.querySelector('img')).toBeNull();
    expect(probe.textContent).toContain(hostile);
  });

  it('shows the maxed label once the ladder is exhausted', () => {
    const h = harness(guildInfo({ nextExpansionPrice: null, purchasedSlots: 60, capacity: 60 }));
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
    const err = document.querySelector('.gbank-gold-error');
    expect(err?.textContent).toBe('Not enough money.');
    // The line is a polite live region (screen readers hear the refusal).
    expect(err?.getAttribute('role')).toBe('status');
    expect(err?.getAttribute('aria-live')).toBe('polite');
    // A REPEATED identical refusal re-announces: the text lands as a fresh
    // child node each time (a same-text write is not a DOM change AT voices).
    const firstNode = err?.firstChild;
    (document.querySelector('.gbank-gold-prompt .btn') as HTMLElement).click();
    expect(err?.textContent).toBe('Not enough money.');
    expect(err?.firstChild).not.toBe(firstNode);
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

  it('a zero-amount gold submit sends NOTHING and cancels SILENTLY (dismiss, no error line)', () => {
    const h = harness(guildInfo());
    h.window.open();
    clickGuildTab(h);
    (h.root.querySelectorAll('.gbank-gold-btn')[0] as HTMLElement).click();
    const prompt = document.querySelector('.gbank-gold-prompt') as HTMLElement;
    (prompt.querySelector('.btn') as HTMLElement).click(); // all fields still 0
    expect(h.calls.filter((c) => c.startsWith('guildBankDepositGold'))).toEqual([]);
    // Cancel semantics: the prompt is gone (nothing was asked), never a
    // refusal line left behind.
    expect(document.querySelector('.gbank-gold-prompt')).toBeNull();
  });

  it('a gold withdraw with zero headroom refuses inline and keeps the prompt open', () => {
    // The clampGoldAmount null arm: the integer-safe purse bound leaves no
    // headroom (max 0), so the submit voices guildGoldCannotMove and sends
    // nothing rather than dismissing or sending a malformed 0.
    const h = harness(guildInfo({ treasury: 700 }));
    h.world.copper = Number.MAX_SAFE_INTEGER;
    h.window.open();
    clickGuildTab(h);
    (h.root.querySelectorAll('.gbank-gold-btn')[1] as HTMLElement).click();
    const prompt = document.querySelector('.gbank-gold-prompt') as HTMLElement;
    const inputs = Array.from(prompt.querySelectorAll<HTMLInputElement>('.coininput'));
    inputs[0].value = '1'; // 1g asked, zero headroom to receive it
    (prompt.querySelector('.btn') as HTMLElement).click();
    expect(h.calls.filter((c) => c.startsWith('guildBankWithdrawGold'))).toEqual([]);
    expect(document.querySelector('.gbank-gold-prompt')).not.toBeNull();
    expect(document.querySelector('.gbank-gold-error')?.textContent).toBe(
      'That amount cannot be moved right now.',
    );
  });

  it('an unknown-id cell click still sends the withdraw (the recovery path)', () => {
    const h = harness(guildInfo({ slots: [{ itemId: 'zz_removed_item', count: 2 }] }));
    h.window.open();
    clickGuildTab(h);
    (h.root.querySelector('.bank-grid .gbank-unknown') as HTMLElement).click();
    expect(h.calls).toContain('guildBankWithdraw:0');
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

describe('the UNOPENED pane (rung 0: open the guild bank from the officer purse)', () => {
  const unopened = (over: Partial<GuildBankInfo> = {}) =>
    guildInfo({ capacity: 0, purchasedSlots: 0, nextExpansionPrice: 90_000, slots: [], ...over });

  it('renders the treasury as normal plus the open row INSTEAD of the slot grid', () => {
    const h = harness(unopened({ treasury: 60_000 }));
    h.window.open();
    clickGuildTab(h);
    // The tab strip still exists (the pane is reachable) and the treasury
    // section works from day one.
    expect(h.root.querySelector('.bank-tabs')).not.toBeNull();
    expect(h.root.querySelector('.gbank-treasury .money-inline')?.textContent).toBe('60000');
    const [deposit, withdraw] = Array.from(
      h.root.querySelectorAll<HTMLButtonElement>('.gbank-gold-btn'),
    );
    expect(deposit.disabled).toBe(false);
    expect(withdraw.disabled).toBe(false);
    // No grid, no capacity counter, no expansion note text: the open row
    // replaces them.
    expect(h.root.querySelector('.bank-grid')).toBeNull();
    expect(h.root.querySelector('.bank-capacity')).toBeNull();
    const open = h.root.querySelector('.gbank-open-row .bank-buy-btn') as HTMLButtonElement;
    expect(open).not.toBeNull();
    expect(open.textContent).toContain('Open the guild bank');
    expect(open.querySelector('.money-inline')?.textContent).toBe('90000'); // 9g literal
    // The payer note is always-visible text: this is the officer's own money.
    expect(h.root.querySelector('.gbank-open-row .gbank-buy-note')?.textContent).toBe(
      'Paid from your own money, not the guild treasury',
    );
  });

  it('marks a purse-poor officer with visible text and keeps the button enabled (sim-authoritative refusal)', () => {
    const h = harness(unopened({ treasury: 10_000_000 })); // treasury wealth must NOT count
    h.world.copper = 89_999; // one copper short of 9g
    h.window.open();
    clickGuildTab(h);
    const btn = h.root.querySelector<HTMLButtonElement>('.gbank-open-row .bank-buy-btn');
    expect(btn?.disabled).toBe(false);
    expect(btn?.classList.contains('gbank-buy-short')).toBe(true);
    expect(btn?.querySelector('.gbank-buy-short-label')?.textContent).toBe('Not enough money');
    // The affordable arm carries NO marker.
    const rich = harness(unopened());
    rich.world.copper = 90_000;
    rich.window.open();
    clickGuildTab(rich);
    const richBtn = rich.root.querySelector<HTMLButtonElement>('.gbank-open-row .bank-buy-btn');
    expect(richBtn?.classList.contains('gbank-buy-short')).toBe(false);
    expect(richBtn?.querySelector('.gbank-buy-short-label')).toBeNull();
  });

  it('the open confirm sends guildBankBuySlots (the same token; the sim decides the rung)', () => {
    const h = harness(unopened());
    h.world.copper = 100_000;
    h.window.open();
    clickGuildTab(h);
    (h.root.querySelector('.gbank-open-row .bank-buy-btn') as HTMLElement).click();
    const prompt = document.querySelector('.gbank-open-prompt') as HTMLElement;
    expect(prompt).not.toBeNull();
    expect(prompt.textContent).toContain('paid from your own money');
    (prompt.querySelector('.btn') as HTMLElement).click();
    expect(h.calls).toContain('guildBankBuySlots');
  });

  it('a purse change repaints the unopened pane (the one purse read in the signature)', () => {
    // The refresh signature is deliberately purse-free for the OPENED pane;
    // while unopened, the shortfall marker reads the purse, so a purse change
    // must repaint or the marker goes stale.
    const h = harness(unopened());
    h.world.copper = 89_999;
    h.window.open();
    clickGuildTab(h);
    expect(
      h.root.querySelector('.gbank-open-row .bank-buy-btn')?.classList.contains('gbank-buy-short'),
    ).toBe(true);
    h.world.copper = 90_000;
    h.window.refreshIfChanged();
    expect(
      h.root.querySelector('.gbank-open-row .bank-buy-btn')?.classList.contains('gbank-buy-short'),
    ).toBe(false);
  });

  it('an OPENED pane stays purse-free: a copper change alone never repaints', () => {
    // The negative arm of the signature's one purse read: once the bank is
    // opened, enablement is snapshot-only again, so a purse change must NOT
    // enter the signature (a repaint per copper tick would thrash the pane
    // and yank keyboard focus for no data change).
    const h = harness(guildInfo({ slots: [{ itemId: plainId, count: 5 }] }));
    h.window.open();
    clickGuildTab(h);
    // Prime the signature: the very first refreshIfChanged always repaints
    // (lastSig starts empty), so grab the node from a settled pane.
    h.window.refreshIfChanged();
    const cell = h.root.querySelector('.bank-grid .bank-item');
    expect(cell).not.toBeNull();
    h.world.copper += 12_345;
    h.window.refreshIfChanged();
    // Same DOM node: no rebuild happened (a repaint recreates the grid).
    expect(h.root.querySelector('.bank-grid .bank-item')).toBe(cell);
    // Positive control on the same fixture: a SNAPSHOT change still repaints.
    h.world.guildBankInfo = guildInfo({ slots: [{ itemId: plainId, count: 5 }], treasury: 999 });
    h.window.refreshIfChanged();
    expect(h.root.querySelector('.bank-grid .bank-item')).not.toBe(cell);
  });

  it('after opening (the echo flips purchasedSlots to 24) the normal pane renders', () => {
    const h = harness(unopened());
    h.window.open();
    clickGuildTab(h);
    expect(h.root.querySelector('.bank-grid')).toBeNull();
    h.world.guildBankInfo = guildInfo({ capacity: 24 }); // opened: 24 slots, rung-1 next
    h.window.refreshIfChanged();
    expect(h.root.querySelector('.gbank-open-row')).toBeNull();
    expect(h.root.querySelector('.bank-grid')).not.toBeNull();
    expect(h.root.querySelector('.bank-capacity')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The ACTIVITY LOG view inside the Guild pane. The log is the social trust
// mechanism the officer-only bank rests on, so the properties that matter are:
// it is fetched ONLY when its view is open (cold data, never the 20 Hz stream),
// its three non-row states are three distinct renderings, and a player-authored
// character name reaches the DOM as TEXT and never as markup.
// ---------------------------------------------------------------------------

const AT = Date.UTC(2026, 7, 3, 12, 30);

const logEntry = (over: Record<string, unknown> = {}) =>
  ({
    id: 5,
    at: AT,
    actor: 'Kara',
    op: 'withdraw',
    itemId: plainId,
    count: 3,
    copper: null,
    ...over,
  }) as GuildBankLogView['entries'][number];

describe('guild_bank_window: the activity log view', () => {
  it('renders the Contents / Log sub-strip on the Guild pane, with Contents selected', () => {
    const h = harness(guildInfo());
    h.window.open();
    clickGuildTab(h);
    const tabs = Array.from(h.root.querySelectorAll('.gbank-view-tab')).map(
      (t) => (t as HTMLElement).dataset.tab,
    );
    expect(tabs).toEqual(['contents', 'log']);
    expect(h.root.querySelector('.gbank-view-tab.on')?.getAttribute('data-tab')).toBe('contents');
    // The nested strip carries its OWN aria-label: two identically-named tab
    // lists in one dialog would be indistinguishable to a screen reader.
    const strips = Array.from(h.root.querySelectorAll('[role="tablist"]')).map((s) =>
      s.getAttribute('aria-label'),
    );
    expect(new Set(strips).size).toBe(strips.length);
  });

  it('the sub-strip is nested in the A11Y tree, not just visually', () => {
    // Two peer tablists with no stated relationship read to a screen reader as
    // a second, unrelated top-level tab list appearing from nowhere. The Guild
    // pane is a real tabpanel, the outer Guild tab controls it, the panel names
    // that tab back, and the inner strip lives INSIDE the panel.
    const h = harness(guildInfo());
    h.window.open();
    clickGuildTab(h);
    const panel = h.root.querySelector('[role="tabpanel"]') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.id.length).toBeGreaterThan(0);
    const guildTab = h.root.querySelector('.bank-tab[data-tab="guild"]') as HTMLElement;
    expect(guildTab.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(guildTab.id);
    expect(guildTab.id.length).toBeGreaterThan(0);
    const innerStrip = h.root.querySelector('.gbank-view-tabs') as HTMLElement;
    expect(panel.contains(innerStrip)).toBe(true);
    // ...and the pane content is inside it too, not stranded beside it.
    expect(panel.querySelector('.gbank-treasury')).not.toBeNull();
  });

  it('does NOT read the log while the contents view is showing (on demand, not a poll)', () => {
    // Reading guildBankLog() is what REQUESTS it, so a pane that read it every
    // paint would turn every officer standing at a banker into a poller.
    const h = harness(guildInfo());
    h.window.open();
    clickGuildTab(h);
    h.window.refreshIfChanged();
    expect(h.calls).not.toContain('guildBankLog');
  });

  it('stops reading the log once the player switches back to the Personal tab', () => {
    // REGRESSION: the on-demand guard used to gate only on the pane's
    // remembered sub-view, so a player who opened the log and then went back to
    // Personal kept re-requesting it every TTL for a pane nobody was looking
    // at. The guard has to be "is this pane VISIBLE", not "was Log selected".
    const h = harness(guildInfo());
    h.window.open();
    clickGuildTab(h);
    clickLogTab(h);
    (h.root.querySelector('.bank-tab[data-tab="personal"]') as HTMLElement).click();
    h.calls.length = 0;
    h.window.refreshIfChanged();
    h.window.refreshIfChanged();
    expect(h.calls).not.toContain('guildBankLog');
  });

  it('stops reading the log when the guild bank mirror goes away (a demotion)', () => {
    // The worse arm of the same regression: losing the mirror re-arms the
    // client's request gate, so a demoted player was sending a request the
    // server refuses, once per TTL, indefinitely.
    const h = harness(guildInfo());
    h.window.open();
    clickGuildTab(h);
    clickLogTab(h);
    h.world.guildBankInfo = null;
    h.calls.length = 0;
    h.window.refreshIfChanged();
    h.window.refreshIfChanged();
    expect(h.calls).not.toContain('guildBankLog');
    // ...and the pane forgot the log view with the tab, so a re-approach starts
    // on the contents rather than silently refetching.
    h.world.guildBankInfo = guildInfo();
    h.window.refreshIfChanged();
    clickGuildTab(h);
    expect(h.root.querySelector('.gbank-view-tab.on')?.getAttribute('data-tab')).toBe('contents');
  });

  it('reads the log as soon as its view is opened', () => {
    const h = harness(guildInfo());
    h.window.open();
    clickGuildTab(h);
    clickLogTab(h);
    expect(h.calls).toContain('guildBankLog');
    expect(h.root.querySelector('.gbank-view-tab.on')?.getAttribute('data-tab')).toBe('log');
  });

  it('renders the LOADING line while no answer has arrived', () => {
    const h = harness(guildInfo());
    h.window.open();
    clickGuildTab(h);
    clickLogTab(h);
    const notice = h.root.querySelector('.gbank-log-notice');
    expect(notice?.classList.contains('gbank-log-loading')).toBe(true);
    expect(notice?.textContent?.length).toBeGreaterThan(0);
    expect(h.root.querySelectorAll('.gbank-log-row').length).toBe(0);
  });

  it('renders an EMPTY history in words, distinct from the refusal', () => {
    const h = harness(guildInfo());
    h.world.logView = { state: 'ready', entries: [] };
    h.window.open();
    clickGuildTab(h);
    clickLogTab(h);
    const notice = h.root.querySelector('.gbank-log-notice');
    expect(notice?.classList.contains('gbank-log-empty')).toBe(true);
    expect(notice?.getAttribute('aria-live')).toBeNull();
  });

  it('renders a REFUSAL as a refusal, never as an empty history', () => {
    // The load-bearing distinction: "you may not read this" and "nobody has
    // done anything" are opposite facts, and a drained bank must never be able
    // to look like an untouched one.
    const h = harness(guildInfo());
    h.world.logView = { state: 'refused', entries: [] };
    h.window.open();
    clickGuildTab(h);
    clickLogTab(h);
    const notice = h.root.querySelector('.gbank-log-notice');
    expect(notice?.classList.contains('gbank-log-refused')).toBe(true);
    expect(notice?.classList.contains('gbank-log-empty')).toBe(false);
    // It can appear WHILE the pane is being read (a demotion mid-view), so it
    // announces rather than changing silently.
    expect(notice?.getAttribute('role')).toBe('status');
    expect(notice?.getAttribute('aria-live')).toBe('polite');
    // ...and the ATTRIBUTES ALONE would be decoration: a live region inserted
    // already-populated is generally not announced, because AT announces a
    // CHANGE inside a region that already exists. The pane therefore re-writes
    // the same text one task later, which is a real mutation on a live region
    // by then in the tree and invisible to sighted players (no paint between).
    const before = notice?.textContent;
    vi.useFakeTimers();
    try {
      const fresh = harness(guildInfo());
      fresh.world.logView = { state: 'refused', entries: [] };
      fresh.window.open();
      clickGuildTab(fresh);
      clickLogTab(fresh);
      const line = fresh.root.querySelector('.gbank-log-notice') as HTMLElement;
      // Node IDENTITY, not text equality: the announcement IS the replacement,
      // and the text is deliberately identical (a visible flash would be a
      // regression, not the feature).
      const originalTextNode = line.firstChild;
      expect(originalTextNode).not.toBeNull();
      vi.runOnlyPendingTimers();
      expect(line.firstChild, 'the refusal must re-write its live region').not.toBe(
        originalTextNode,
      );
      expect(line.textContent).toBe(before);
    } finally {
      vi.useRealTimers();
    }
    // The two lines must not be the same string, or the distinction is cosmetic.
    const refusedText = notice?.textContent ?? '';
    const empty = harness(guildInfo());
    empty.world.logView = { state: 'ready', entries: [] };
    empty.window.open();
    clickGuildTab(empty);
    clickLogTab(empty);
    expect(refusedText).not.toBe(empty.root.querySelector('.gbank-log-notice')?.textContent);
  });

  it('renders one plain-language row per entry, newest first, with a formatted time', () => {
    const h = harness(guildInfo());
    h.world.logView = {
      state: 'ready',
      entries: [logEntry({ id: 4 }), logEntry({ id: 9, actor: 'Bren', op: 'deposit' })],
    };
    h.window.open();
    clickGuildTab(h);
    clickLogTab(h);
    const rows = logRows(h);
    expect(rows.length).toBe(2);
    expect(rows[0]).toContain('Bren'); // id 9 sorts first
    expect(rows[1]).toContain('Kara');
    // A real item NAME, not the raw id.
    expect(rows[0]).not.toContain(plainId);
    // Every row carries a rendered timestamp (the i18n date formatter's output,
    // never a raw epoch number).
    for (const time of h.root.querySelectorAll('.gbank-log-time')) {
      expect(time.textContent?.length).toBeGreaterThan(0);
      expect(time.textContent).not.toContain(String(AT));
    }
  });

  it('renders money rows through formatMoney, never a raw copper count', () => {
    const h = harness(guildInfo());
    h.world.logView = {
      state: 'ready',
      entries: [logEntry({ id: 3, op: 'deposit_gold', itemId: null, count: null, copper: 25_000 })],
    };
    h.window.open();
    clickGuildTab(h);
    clickLogTab(h);
    expect(logRows(h)[0]).not.toContain('25000');
    expect(logRows(h)[0]).toContain('Kara');
  });

  it('names NOBODY on an operator purge', () => {
    // The ledger row behind an admin_purge carries the escrow CARRIER, a
    // bystander. Naming them would tell the guild a guildmate destroyed their
    // property.
    const h = harness(guildInfo());
    h.world.logView = {
      state: 'ready',
      entries: [logEntry({ id: 3, op: 'admin_purge', actor: 'Carrier' })],
    };
    h.window.open();
    clickGuildTab(h);
    clickLogTab(h);
    expect(logRows(h)[0]).not.toContain('Carrier');
    expect(logRows(h)[0].length).toBeGreaterThan(0);
  });

  it('splices a hostile character name as TEXT, never as markup', () => {
    const h = harness(guildInfo());
    h.world.logView = {
      state: 'ready',
      entries: [logEntry({ id: 3, actor: '<img src=x onerror=alert(1)>' })],
    };
    h.window.open();
    clickGuildTab(h);
    clickLogTab(h);
    expect(h.root.querySelector('.gbank-log-list img')).toBeNull();
    expect(logRows(h)[0]).toContain('<img src=x onerror=alert(1)>');
  });

  it('a missing actor renders a localized stand-in, not a blank gap', () => {
    const h = harness(guildInfo());
    h.world.logView = { state: 'ready', entries: [logEntry({ id: 3, actor: null })] };
    h.window.open();
    clickGuildTab(h);
    clickLogTab(h);
    expect(logRows(h)[0].trim().length).toBeGreaterThan(0);
    expect(logRows(h)[0].startsWith(' ')).toBe(false);
  });

  it('bag clicks route to NEITHER bank while the log is showing', () => {
    // The bag-deposit routing exists because a GRID is on screen to drop into.
    // On a reading surface a bag click must not silently deposit, and that
    // holds for the PERSONAL grid too: it is off screen behind the guild pane
    // exactly like the guild grid is, so disarming only the guild side just
    // moved the same trap one bank over (the fallback used to be
    // `isBankOpen() && !isGuildBankTab()`, which is true here).
    const h = harness(guildInfo());
    h.window.open();
    clickGuildTab(h);
    expect(h.window.guildTabActive).toBe(true);
    expect(h.window.personalTabActive).toBe(false);
    clickLogTab(h);
    expect(h.window.guildTabActive).toBe(false);
    expect(h.window.personalTabActive).toBe(false);
    // Positive control: back on the Personal tab, the personal deposit IS armed.
    (h.root.querySelector('.bank-tab[data-tab="personal"]') as HTMLElement).click();
    expect(h.window.personalTabActive).toBe(true);
    expect(h.window.guildTabActive).toBe(false);
  });

  it('closing the window resets the pane to Contents (a reopen never refetches unasked)', () => {
    const h = harness(guildInfo());
    h.window.open();
    clickGuildTab(h);
    clickLogTab(h);
    h.window.close();
    h.calls.length = 0;
    h.window.open();
    clickGuildTab(h);
    expect(h.root.querySelector('.gbank-view-tab.on')?.getAttribute('data-tab')).toBe('contents');
    expect(h.calls).not.toContain('guildBankLog');
  });

  it('the UNOPENED bank still offers the log (the treasury works from day one)', () => {
    const h = harness(
      guildInfo({ purchasedSlots: 0, capacity: 0, nextExpansionPrice: GUILD_BANK_RUNG_PRICES[0] }),
    );
    h.window.open();
    clickGuildTab(h);
    expect(h.root.querySelector('.gbank-view-tab[data-tab="log"]')).not.toBeNull();
    clickLogTab(h);
    expect(h.calls).toContain('guildBankLog');
  });

  it('says how big the window is, from the ONE seam constant, never a baked number', () => {
    // A hardcoded "50" in the copy would have lied in six languages the moment
    // the cap moved (and it lived in three places at once).
    const h = harness(guildInfo());
    h.world.logView = { state: 'ready', entries: [logEntry({ id: 3 })] };
    h.window.open();
    clickGuildTab(h);
    clickLogTab(h);
    const note = h.root.querySelector('.gbank-log-note')?.textContent ?? '';
    expect(note).toContain(String(GUILD_BANK_LOG_LIMIT));
    expect(note).not.toContain('{count}');
  });

  it('repaints when the log answer lands, without a driver of its own', () => {
    const h = harness(guildInfo());
    h.window.open();
    clickGuildTab(h);
    clickLogTab(h);
    h.window.refreshIfChanged(); // latch the loading signature
    h.world.logView = { state: 'ready', entries: [logEntry({ id: 3 })] };
    h.window.refreshIfChanged();
    expect(logRows(h).length).toBe(1);
  });

  it('keyboard focus survives a repaint driven by another officer op', () => {
    const h = harness(guildInfo());
    h.world.logView = { state: 'ready', entries: [logEntry({ id: 3 })] };
    h.window.open();
    clickGuildTab(h);
    clickLogTab(h);
    const tab = h.root.querySelector('.gbank-view-tab[data-tab="log"]') as HTMLElement;
    expect(tab.dataset.focusKey).toBe('gbank:view:log');
    tab.focus();
    h.world.guildBankInfo = guildInfo({ treasury: 99_000 });
    h.window.refreshIfChanged();
    expect((document.activeElement as HTMLElement)?.dataset.focusKey).toBe('gbank:view:log');
  });
});

describe('the READ-ONLY member pane (canEdit false)', () => {
  const memberInfo = (over: Partial<GuildBankInfo> = {}) => guildInfo({ canEdit: false, ...over });

  it('a member gets the Guild tab and the full contents, read-only', () => {
    const h = harness(memberInfo({ treasury: 60_000, slots: [{ itemId: 'sword', count: 1 }] }));
    h.window.open();
    clickGuildTab(h);
    // The pane renders: treasury readout, grid, the slot itself.
    expect(h.root.querySelector('.gbank-treasury .money-inline')?.textContent).toBe('60000');
    expect(h.root.querySelectorAll('.bank-grid .bank-item:not(.empty)')).toHaveLength(1);
    // Every mutating affordance is withheld: both gold buttons disabled, no
    // expansion footer, and the always-visible read-only note says why.
    const buttons = Array.from(h.root.querySelectorAll('.gbank-gold-btn')) as HTMLButtonElement[];
    expect(buttons).toHaveLength(2);
    expect(buttons.every((b) => b.disabled)).toBe(true);
    expect(h.root.querySelector('.gbank-buy-row')).toBeNull();
    expect(h.root.querySelector('.gbank-readonly-note')?.textContent).toBe(
      'Only guild officers can make changes to the guild bank.',
    );
  });

  it('a member slot click dispatches NOTHING (plain and shift both inert)', () => {
    const h = harness(memberInfo({ slots: [{ itemId: plainId, count: 5 }] }));
    h.window.open();
    clickGuildTab(h);
    const cell = h.root.querySelector('.bank-grid .bank-item') as HTMLElement;
    cell.click();
    cell.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    expect(h.calls.filter((c) => c.startsWith('guildBankWithdraw'))).toEqual([]);
    // No split prompt either.
    expect(document.querySelector('.gbank-quantity-prompt')).toBeNull();
  });

  it('a member cell tooltip advertises no withdraw affordance', () => {
    // plainId: a real splittable def, so the OFFICER arm below renders BOTH
    // hints and the member arm's absence is decisively the read-only gate.
    const h = harness(memberInfo({ slots: [{ itemId: plainId, count: 5 }] }));
    h.window.open();
    clickGuildTab(h);
    const tooltip = h.tooltips.map((fn) => fn()).join('');
    // The exact English hint literals (the suite runs under the en catalog):
    // neither the plain nor the partial withdraw affordance may show.
    expect(tooltip).not.toContain('Click to withdraw');
    expect(tooltip).not.toContain('Shift-click to withdraw a partial amount');
    // Positive control: the same slot under an officer DOES advertise both,
    // so the absence above is the read-only arm, not a hint that never renders.
    const officer = harness(guildInfo({ slots: [{ itemId: plainId, count: 5 }] }));
    officer.window.open();
    clickGuildTab(officer);
    const officerTooltip = officer.tooltips.map((fn) => fn()).join('');
    expect(officerTooltip).toContain('Click to withdraw');
    expect(officerTooltip).toContain('Shift-click to withdraw a partial amount');
  });

  it('the member UNOPENED pane names the state: treasury + both notes, never the open row', () => {
    const h = harness(memberInfo({ capacity: 0, purchasedSlots: 0, nextExpansionPrice: 90_000 }));
    h.window.open();
    clickGuildTab(h);
    expect(h.root.querySelector('.gbank-treasury')).not.toBeNull();
    expect(h.root.querySelector('.gbank-open-row')).toBeNull();
    // Two legend lines: why the pane is inert, and what state the bank is in
    // (the officer pane says "unopened" through the open row this viewer does
    // not get; without this line the member pane reads as broken).
    const notes = Array.from(h.root.querySelectorAll('.gbank-readonly-note')).map(
      (n) => n.textContent,
    );
    expect(notes).toEqual([
      'Only guild officers can make changes to the guild bank.',
      'The guild bank has not been opened yet.',
    ]);
  });

  it('a member slot cell is focusable but announces aria-disabled; an officer cell does not', () => {
    const h = harness(memberInfo({ slots: [{ itemId: plainId, count: 5 }] }));
    h.window.open();
    clickGuildTab(h);
    const cell = h.root.querySelector('.bank-grid .bank-item') as HTMLButtonElement;
    // Focusable (tooltip inspection is the point), but announced inert: the
    // click dispatches nothing, and a control that promises action it will
    // not take is the accessibility bug this pins against.
    expect(cell.disabled).toBe(false);
    expect(cell.getAttribute('aria-disabled')).toBe('true');
    const officer = harness(guildInfo({ slots: [{ itemId: plainId, count: 5 }] }));
    officer.window.open();
    clickGuildTab(officer);
    const officerCell = officer.root.querySelector('.bank-grid .bank-item') as HTMLButtonElement;
    expect(officerCell.getAttribute('aria-disabled')).toBeNull();
  });

  it('guildTabActive stays FALSE for a member: bag clicks never arm the guild deposit', () => {
    const h = harness(memberInfo());
    h.window.open();
    clickGuildTab(h);
    expect(h.window.guildTabActive).toBe(false);
  });

  it('the read-only note announces ONLY on the demotion edge, never on steady repaints', () => {
    // First paint as a member: informational, not an event; no live region.
    const h = harness(memberInfo({ treasury: 60_000 }));
    h.window.open();
    clickGuildTab(h);
    const first = h.root.querySelector('.gbank-readonly-note');
    expect(first?.getAttribute('role')).toBeNull();
    expect(first?.getAttribute('aria-live')).toBeNull();
    // Promotion, then demotion mid-view: the surface changed under the viewer,
    // so THIS paint's note is a polite status (the gold-prompt errorLine
    // precedent) and screen readers hear the rank change.
    h.world.guildBankInfo = guildInfo({ treasury: 60_000 });
    h.window.refreshIfChanged();
    h.world.guildBankInfo = memberInfo({ treasury: 60_000 });
    h.window.refreshIfChanged();
    const onEdge = h.root.querySelector('.gbank-readonly-note');
    expect(onEdge?.getAttribute('role')).toBe('status');
    expect(onEdge?.getAttribute('aria-live')).toBe('polite');
    // A steady read-only repaint (another member's op echoed): silent again.
    h.world.guildBankInfo = memberInfo({ treasury: 70_000 });
    h.window.refreshIfChanged();
    const steady = h.root.querySelector('.gbank-readonly-note');
    expect(steady?.textContent).toBe('Only guild officers can make changes to the guild bank.');
    expect(steady?.getAttribute('role')).toBeNull();
  });

  it('a canEdit flip mid-open repaints: promotion enables, demotion disables', () => {
    const h = harness(memberInfo({ treasury: 60_000 }));
    h.window.open();
    clickGuildTab(h);
    expect(h.window.guildTabActive).toBe(false);
    // Promotion lands on the mirror (the re-stamp echoes through the snapshot).
    h.world.guildBankInfo = guildInfo({ treasury: 60_000 });
    h.window.refreshIfChanged();
    expect(h.window.guildTabActive).toBe(true);
    expect(h.root.querySelector('.gbank-readonly-note')).toBeNull();
    const buttons = Array.from(h.root.querySelectorAll('.gbank-gold-btn')) as HTMLButtonElement[];
    expect(buttons.some((b) => !b.disabled)).toBe(true);
    // And back: the demote repaints to the locked pane.
    h.world.guildBankInfo = memberInfo({ treasury: 60_000 });
    h.window.refreshIfChanged();
    expect(h.window.guildTabActive).toBe(false);
    expect(h.root.querySelector('.gbank-readonly-note')).not.toBeNull();
  });
});
