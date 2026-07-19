// WCAG 2.2 AA gate: axe-core over the cold + async + per-frame-host windows that carry
// extracted painters (talents, social, options, arena, questlog, spellbook, leaderboard, char,
// market, bags), in a seeded/populated state, with the async windows (leaderboard, market) run
// under BOTH a Sim-shaped and a ClientWorld-mirror-shaped fixture. Each window's
// real painter renders into a host element with the real style barrel loaded, then axe asserts
// zero SERIOUS or CRITICAL violations. This is the OPT-IN browser suite (npm run test:browser);
// a bare `vitest run` never launches a browser.
//
// Canvas/3D surfaces stay OUT of scope: the arena host carries a label + honest
// summary and is axed as a host window; the map window is a canvas painter covered by its
// static-HTML host aria (#map-canvas role=img, #map-summary) + tests/client_shell.test.ts, not
// by this painter-mount harness; their pixels get no faked per-marker aria.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TalentAllocation } from '../../src/sim/content/talents';
import { ITEMS, QUESTS } from '../../src/sim/data';
import { ALL_CLASSES } from '../../src/sim/types';
import { ArenaWindow } from '../../src/ui/arena_window';
import { BagsWindow } from '../../src/ui/bags_window';
import { CharWindow } from '../../src/ui/char_window';
import { FOCUSABLE_SELECTOR } from '../../src/ui/focus_manager';
import { resolveActionBarVisibility } from '../../src/ui/hud/action_bar/action_bar_visibility_core';
import { QuestLogWindow } from '../../src/ui/hud/quest/questlog_window';
import { t } from '../../src/ui/i18n';
import { LeaderboardWindow } from '../../src/ui/leaderboard_window';
import { MarketWindow } from '../../src/ui/market_window';
import { OptionsWindow } from '../../src/ui/options_window';
import { SocialWindow } from '../../src/ui/social_window';
import { SpellbookWindow } from '../../src/ui/spellbook_window';
import { TalentsWindow } from '../../src/ui/talents_window';
import type {
  LeaderboardEntry,
  LeaderboardPage,
  MarketInfo,
  MarketListingView,
} from '../../src/world_api';
import {
  axeSeriousViolations,
  cleanup,
  formatViolations,
  host,
  stubDeps,
  type WorldShape,
} from './_harness';

afterEach(cleanup);

async function expectClean(el: HTMLElement): Promise<void> {
  const violations = await axeSeriousViolations(el);
  expect(violations, formatViolations(violations)).toEqual([]);
}

// ---------------------------------------------------------------------------
// Leaderboard (#leaderboard-window) - the async/paged decision-15 centerpiece.
// ---------------------------------------------------------------------------

function entry(over: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  return {
    rank: 1,
    name: 'Aurelia',
    cls: 'warrior',
    level: 60,
    virtualLevel: 12,
    lifetimeXp: 5_000_000,
    prestigeRank: 0,
    ...over,
    title: over.title ?? null,
  };
}

// A resolved page. The sim shape carries extra fields the core must ignore (the online-only
// -shape trap exists to catch); the client mirror carries only the decoded fields.
function page(shape: WorldShape, leaders: LeaderboardEntry[]): LeaderboardPage {
  const junk = shape === 'sim' ? { _serverSeq: 7, _dirty: true } : {};
  return {
    leaders,
    page: 0,
    pageCount: 1,
    total: leaders.length,
    pageSize: 50,
    ...junk,
  } as unknown as LeaderboardPage;
}

function leaderboardWindow(leaderboard: () => Promise<LeaderboardPage>): {
  root: HTMLElement;
  win: LeaderboardWindow;
} {
  const root = host('leaderboard-window');
  root.style.display = 'none'; // toggle() opens it
  const win = new LeaderboardWindow(
    stubDeps({
      root: () => root,
      world: () =>
        ({
          realm: 'Claudemoon',
          player: { name: 'Aurelia', level: 60 },
          lifetimeXp: 5_000_000,
          leaderboard,
        }) as never,
      captureFocus: () => null,
    }),
  );
  return { root, win };
}

describe('axe: leaderboard window (Sim + ClientWorld shapes)', () => {
  for (const shape of ['sim', 'client'] as const) {
    it(`ranked page is clean under the ${shape} shape`, async () => {
      const leaders = [
        entry({ rank: 1, name: 'Aurelia', me: true } as Partial<LeaderboardEntry>),
        entry({ rank: 2, name: 'Bramblefoot', cls: 'druid', prestigeRank: 2 }),
        entry({ rank: 3, name: 'Cinderhowl', cls: 'mage' }),
      ];
      const { root, win } = leaderboardWindow(async () => page(shape, leaders));
      win.toggle();
      await vi.waitFor(() => expect(root.querySelector('.lb-row')).toBeTruthy());
      await expectClean(root);
    });
  }

  it('error state (rejecting leaderboard) is clean and announced', async () => {
    const { root, win } = leaderboardWindow(async () => {
      throw new Error('offline');
    });
    win.toggle();
    await vi.waitFor(() => expect(root.querySelector('.lb-error')).toBeTruthy());
    expect(root.querySelector('.lb-error')?.getAttribute('role')).toBe('alert');
    await expectClean(root);
  });
});

// ---------------------------------------------------------------------------
// Talents (#talents-window) - dialog role, the close button, the tablist + radiogroup.
// ---------------------------------------------------------------------------

describe('axe: talents window', () => {
  it('warrior talent tree is clean (dialog role + close button + tablist)', async () => {
    const root = host('talents-window');
    root.style.display = 'none';
    const allocation: TalentAllocation = { spec: null, rows: {} };
    const win = new TalentsWindow(
      stubDeps({
        root: () => root,
        playerClass: () => 'warrior',
        playerLevel: () => 20,
        currentAllocation: () => allocation,
        activeLoadout: () => -1,
        loadouts: () => [],
        currentBar: () => [],
        captureFocus: () => null,
      }),
    );
    win.open();
    expect(root.getAttribute('role')).toBe('dialog');
    expect(root.querySelector('button[data-close]')).toBeTruthy();
    await expectClean(root);
  });

  it('puts every specialization role on its own line instead of joining the spec name', () => {
    for (const cls of ALL_CLASSES) {
      const root = host(`talents-window-${cls}`);
      root.style.display = 'none';
      const allocation: TalentAllocation = { spec: null, rows: {} };
      const win = new TalentsWindow(
        stubDeps({
          root: () => root,
          playerClass: () => cls,
          playerLevel: () => 20,
          currentAllocation: () => allocation,
          activeLoadout: () => -1,
          loadouts: () => [],
          currentBar: () => [],
          captureFocus: () => null,
        }),
      );
      win.open();

      const cards = Array.from(root.querySelectorAll<HTMLElement>('.ts-panel'));
      expect(cards, `${cls} specialization cards`).toHaveLength(3);
      for (const card of cards) {
        const name = card.querySelector<HTMLElement>('.ts-name');
        const role = card.querySelector<HTMLElement>('.ts-role');
        expect(name, `${cls} spec name`).toBeTruthy();
        expect(role, `${cls} spec role`).toBeTruthy();
        expect(getComputedStyle(name!).display, `${cls} spec name display`).toBe('block');
        expect(getComputedStyle(role!).display, `${cls} spec role display`).toBe('block');
        expect(role!.getBoundingClientRect().top, `${cls} spec role line`).toBeGreaterThan(
          name!.getBoundingClientRect().top,
        );
      }
      root.remove();
    }
  });
});

// ---------------------------------------------------------------------------
// Arena (#arena-window) - the offline host (dialog role + named title + close).
// ---------------------------------------------------------------------------

describe('axe: arena window', () => {
  it('offline host is clean (dialog role, labelled title)', async () => {
    const root = host('arena-window');
    root.style.display = 'none';
    const win = new ArenaWindow(
      stubDeps({
        root: () => root,
        world: () =>
          ({
            arenaInfo: null,
            playerId: 1,
            player: { name: 'Aurelia' },
            partyInfo: null,
          }) as never,
        captureFocus: () => null,
      }),
    );
    win.toggle();
    expect(root.getAttribute('aria-labelledby')).toBe('arena-title');
    expect(root.querySelector('#arena-title')).toBeTruthy();
    await expectClean(root);
  });
});

// ---------------------------------------------------------------------------
// Quest log (#quest-log-window) - a populated list with selectable rows.
// ---------------------------------------------------------------------------

describe('axe: quest log window', () => {
  it('active quest list is clean', async () => {
    const root = host('quest-log-window');
    root.style.display = 'none';
    const found = Object.entries(QUESTS).find(([, q]) => q.objectives.length >= 1);
    if (!found) throw new Error('fixture: no quest with objectives');
    const [questId, quest] = found;
    const progress = { questId, counts: quest.objectives.map(() => 0), state: 'active' };
    const win = new QuestLogWindow(
      stubDeps({
        root: () => root,
        world: () =>
          ({
            cfg: { playerClass: 'warrior' },
            player: { name: 'Aurelia' },
            questLog: new Map([[questId, progress]]),
            questsDone: new Set<string>(),
          }) as never,
        captureFocus: () => null,
      }),
    );
    win.toggle();
    expect(root.getAttribute('role')).toBe('dialog');
    await expectClean(root);
  });
});

// ---------------------------------------------------------------------------
// Spellbook (#spellbook) - the class kit rows (locked, so no resolved-ability deps).
// ---------------------------------------------------------------------------

describe('axe: spellbook window', () => {
  it('class kit rows are clean', async () => {
    const root = host('spellbook');
    root.style.display = 'none';
    const win = new SpellbookWindow(
      stubDeps({
        root: () => root,
        // The render reads world.player.level for the spec/level learn gate
        // (IWorld always carries a player); level 1 keeps every row locked.
        world: () =>
          ({ cfg: { playerClass: 'warrior' }, known: [], player: { level: 1 } }) as never,
        barAbilityIds: () => [],
        hasFreeSlot: () => true,
        hasFormBars: () => false,
        captureFocus: () => null,
      }),
    );
    win.toggle();
    expect(root.getAttribute('role')).toBe('dialog');
    await expectClean(root);
  });
});

// ---------------------------------------------------------------------------
// Options / Esc menu (#options-menu) - the main drill-down menu.
// ---------------------------------------------------------------------------

describe('axe: options menu', () => {
  function optionsWindow(): { root: HTMLElement; win: OptionsWindow } {
    const root = host('options-menu');
    root.style.display = 'none';
    const win = new OptionsWindow(
      stubDeps({
        root: () => root,
        world: () =>
          ({
            realm: 'Claudemoon',
            player: { name: 'Aurelia', pos: { x: 0, y: 0, z: 0 } },
          }) as never,
        options: () => null,
        bugReport: () => null,
        captureFocus: () => null,
      }),
    );
    return { root, win };
  }

  it('main menu is clean (dialog role, labelled title that resolves)', async () => {
    const { root, win } = optionsWindow();
    win.toggle();
    expect(root.getAttribute('aria-labelledby')).toBe('options-title');
    // The idref must resolve to a real element, else the dialog is nameless (the arena
    // test pins the same for its title; this strengthening would have caught the perf
    // sub-view's dangling reference, the fix below).
    expect(root.querySelector('#options-title')).toBeTruthy();
    await expectClean(root);
  });

  it('Performance sub-view names the dialog with aria-label, no dangling idref', async () => {
    const { root, win } = optionsWindow();
    win.toggle(); // main menu first
    // Navigate to the Performance sub-view the real way: click its menu entry. Its title
    // comes from the self-contained perf panel (no id=options-title), so the dialog must
    // name itself via aria-label, NOT keep the now-dangling aria-labelledby.
    const perfBtn = Array.from(root.querySelectorAll<HTMLElement>('.opt-btn')).find(
      (b) => b.textContent === t('hudChrome.perf.title'),
    );
    expect(perfBtn, 'performance menu entry present').toBeTruthy();
    perfBtn?.click();
    expect(root.getAttribute('aria-label')).toBe(t('hudChrome.perf.title'));
    expect(root.getAttribute('aria-labelledby')).toBeNull();
    await expectClean(root);
  });

  it('enables the third action row through the secondary row and preserves keyboard focus', () => {
    const values: Record<string, number | boolean> = {
      showSecondaryActionBar: false,
      showThirdActionBar: false,
    };
    const settings = {
      get: (key: string) => values[key] ?? false,
      set: (key: string, value: number | boolean) => {
        values[key] = value;
        return value;
      },
    };
    const hooks = {
      settings,
      onSettingChange: (key: string, value: number | boolean) => {
        if (key !== 'showSecondaryActionBar' && key !== 'showThirdActionBar') return;
        const visibility = resolveActionBarVisibility(
          {
            secondary: Boolean(values.showSecondaryActionBar),
            third: Boolean(values.showThirdActionBar),
          },
          key,
          Boolean(value),
        );
        values.showSecondaryActionBar = visibility.secondary;
        values.showThirdActionBar = visibility.third;
      },
      theme: {
        get: () => ({ preset: 'classic', custom: {} }),
        setPreset: () => {},
        setCustom: () => {},
        resetCustom: () => {},
      },
      perfOverlay: { setPlacement: () => {} },
    };
    const root = host('options-menu');
    root.style.display = 'none';
    const win = new OptionsWindow(
      stubDeps({
        root: () => root,
        world: () =>
          ({
            realm: 'Claudemoon',
            player: { name: 'Aurelia', pos: { x: 0, y: 0, z: 0 } },
          }) as never,
        options: () => hooks as never,
        bugReport: () => null,
        buildDropdown: () => document.createElement('div'),
        captureFocus: () => null,
      }),
    );
    const toggle = (key: string) =>
      root.querySelector<HTMLButtonElement>(`[data-setting-key="${key}"]`);

    win.toggle();
    const interfaceButton = Array.from(root.querySelectorAll<HTMLButtonElement>('.opt-btn')).find(
      (button) => button.textContent === t('hud.options.interface'),
    );
    interfaceButton?.click();

    expect(toggle('showThirdActionBar')?.disabled).toBe(true);
    const secondary = toggle('showSecondaryActionBar');
    secondary?.focus();
    secondary?.click();
    expect(values.showSecondaryActionBar).toBe(true);
    expect(toggle('showThirdActionBar')?.disabled).toBe(false);
    expect(document.activeElement).toBe(toggle('showSecondaryActionBar'));

    toggle('showThirdActionBar')?.click();
    expect(values.showThirdActionBar).toBe(true);
    toggle('showSecondaryActionBar')?.click();
    expect(values.showSecondaryActionBar).toBe(false);
    expect(values.showThirdActionBar).toBe(false);
    expect(toggle('showThirdActionBar')?.disabled).toBe(true);
    expect(document.activeElement).toBe(toggle('showSecondaryActionBar'));
  });
});

// ---------------------------------------------------------------------------
// Social (#social-window) - the offline state AND the online friends tab, so the
// ARIA-1.2 typeahead combobox (role=combobox + aria-controls/expanded) is axed in BOTH
// its collapsed state and its EXPANDED listbox state: the driven case types
// into the combobox, waits out the debounced async search to populate the listbox, then
// ArrowDown to move aria-activedescendant, and axes the live expanded combobox. The tab
// strip is a real role=tablist, also covered here.
// ---------------------------------------------------------------------------

describe('axe: social window', () => {
  it('offline state is clean (dialog role, tabs)', async () => {
    const root = host('social-window');
    const win = new SocialWindow(
      stubDeps({
        root: () => root,
        world: () =>
          ({
            socialInfo: null,
            partyInfo: null,
            realm: 'Claudemoon',
            player: { name: 'Aurelia' },
          }) as never,
        captureFocus: () => null,
      }),
    );
    win.toggle();
    expect(root.getAttribute('role')).toBe('dialog');
    await expectClean(root);
  });

  it('online friends tab is clean (the ARIA-1.2 typeahead combobox, collapsed)', async () => {
    const root = host('social-window');
    const win = new SocialWindow(
      stubDeps({
        root: () => root,
        world: () =>
          ({
            socialInfo: { friends: [], guild: null, ignored: [] },
            partyInfo: null,
            realm: 'Claudemoon',
            player: { name: 'Aurelia' },
          }) as never,
        captureFocus: () => null,
      }),
    );
    win.toggle();
    const input = root.querySelector('input[role="combobox"]');
    expect(input, 'the friends typeahead renders a combobox when online').toBeTruthy();
    // aria-controls must resolve to the sibling listbox (a dangling idref is an axe fail).
    const listId = input?.getAttribute('aria-controls');
    expect(listId && root.querySelector(`#${listId}`)?.getAttribute('role')).toBe('listbox');
    expect(input?.getAttribute('aria-expanded')).toBe('false');
    await expectClean(root);
  });

  it('online friends typeahead is clean when EXPANDED (listbox + moving aria-activedescendant)', async () => {
    // Drive the ARIA-1.2 combobox to its expanded state: type -> the debounced async search
    // populates the listbox -> ArrowDown moves aria-activedescendant. Real timers run in
    // browser mode, so wait out the debounce + the async microtask before asserting.
    const SETTLE_MS = 300; // covers SUGGEST_DEBOUNCE_MS (160) + the async search settle
    const root = host('social-window');
    const win = new SocialWindow(
      stubDeps({
        root: () => root,
        world: () =>
          ({
            socialInfo: { friends: [], guild: null, ignored: [] },
            partyInfo: null,
            realm: 'Claudemoon',
            player: { name: 'Aurelia' },
            // 3 same-realm matches, none the local player (so none is filtered out).
            searchCharacters: async () => [
              { name: 'Borin', cls: 'warrior', level: 42 },
              { name: 'Celes', cls: 'mage', level: 37 },
              { name: 'Dorn', cls: 'priest', level: 28 },
            ],
          }) as never,
        captureFocus: () => null,
      }),
    );
    win.toggle();
    const input = root.querySelector('input[role="combobox"]') as HTMLInputElement;
    expect(input, 'the friends typeahead renders a combobox when online').toBeTruthy();
    input.value = 'bo';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    // Expanded: aria-expanded flips true and the listbox holds rendered options.
    expect(input.getAttribute('aria-expanded')).toBe('true');
    const listId = input.getAttribute('aria-controls') ?? '';
    const listbox = root.querySelector(`#${CSS.escape(listId)}`) as HTMLElement | null;
    expect(listbox?.getAttribute('role')).toBe('listbox');
    const options = listbox?.querySelectorAll('[role="option"]') ?? [];
    expect(options.length).toBeGreaterThanOrEqual(1);
    // aria-activedescendant resolves to a rendered option INSIDE the listbox.
    const active = input.getAttribute('aria-activedescendant') ?? '';
    expect(active).toBeTruthy();
    expect(root.querySelector(`#${CSS.escape(active)}`)?.closest('[role="listbox"]')).toBe(listbox);
    await expectClean(root);
  });

  it('the tablist is keyboard-operable: Arrow/Home/End move, activate, and focus the new tab', () => {
    const root = host('social-window');
    const win = new SocialWindow(
      stubDeps({
        root: () => root,
        world: () =>
          ({
            socialInfo: { friends: [], guild: null, ignored: [] },
            partyInfo: null,
            realm: 'Claudemoon',
            player: { name: 'Aurelia' },
          }) as never,
        captureFocus: () => null,
      }),
    );
    win.toggle();
    // The single active tab (the styling `.on` and aria-selected stay in lockstep).
    const active = () =>
      (root.querySelector('.soc-tab.on[aria-selected="true"]') as HTMLElement | null)?.dataset.tab;
    const focused = () => (document.activeElement as HTMLElement | null)?.dataset.tab;
    const press = (key: string) =>
      (document.activeElement as HTMLElement | null)?.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true }),
      );
    expect(active()).toBe('friends');
    (root.querySelector('.soc-tab[data-tab="friends"]') as HTMLElement).focus();
    // ArrowRight: friends -> guild; render() rebuilds the strip, so focus follows the
    // freshly active tab (selection-follows-focus, the WAI-ARIA tabs pattern).
    press('ArrowRight');
    expect(active()).toBe('guild');
    expect(focused()).toBe('guild');
    // End jumps to the last tab; ArrowRight then wraps back to the first.
    press('End');
    expect(active()).toBe('raid');
    expect(focused()).toBe('raid');
    press('ArrowRight');
    expect(active()).toBe('friends');
    // ArrowLeft wraps the other way (friends -> raid).
    press('ArrowLeft');
    expect(active()).toBe('raid');
    expect(focused()).toBe('raid');
    // Enter activates the focused tab (idempotent here: selection already followed focus).
    press('Enter');
    expect(active()).toBe('raid');
    expect(focused()).toBe('raid');
  });

  it('roving tabs are ONE Tab stop: only the active tab is in the canonical focusable set', () => {
    // The roving tabindex must survive the window's Tab trap: the inactive tabs carry
    // tabindex="-1" and so must be EXCLUDED from FOCUSABLE_SELECTOR (which the trap cycles),
    // or Tab would stop on every inactive tab instead of treating the tablist as one stop.
    const root = host('social-window');
    const win = new SocialWindow(
      stubDeps({
        root: () => root,
        world: () =>
          ({
            socialInfo: { friends: [], guild: null, ignored: [] },
            partyInfo: null,
            realm: 'Claudemoon',
            player: { name: 'Aurelia' },
          }) as never,
        captureFocus: () => null,
      }),
    );
    win.toggle();
    const focusableTabs = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (el) => el.classList.contains('soc-tab'),
    );
    expect(focusableTabs).toHaveLength(1);
    expect(focusableTabs[0]?.dataset.tab).toBe('friends');
    expect(focusableTabs[0]?.getAttribute('aria-selected')).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// Character window (#char-window) - the paperdoll sheet: dialog root named by the title,
// plus the role=img 3D-preview HOST (the canvas pixels stay OUT of scope).
// ---------------------------------------------------------------------------

describe('axe: character window', () => {
  it('paperdoll sheet is clean (dialog role + role=img preview host)', async () => {
    const root = host('char-window');
    root.style.display = 'none';
    const win = new CharWindow(
      stubDeps({
        root: () => root,
        world: () =>
          ({
            cfg: { playerClass: 'warrior' },
            player: { name: 'Aurelia', level: 60, skin: 0 },
            equipment: {},
            professionsState: { skills: [] },
          }) as never,
        statCellHtml: () => '',
        statTooltipHtml: () => '',
        talentSummaryHtml: () => '',
        progressionHtml: () => '',
        slotName: (s: string) => s,
        // The 3D turntable + skin picker are HUD-owned (rendered by callback). The skin
        // row is a role=list, so populate one listitem (as the real picker does) to keep
        // the list valid; the 3D preview HOST keeps its role=img with the pixels OUT.
        renderSkinPicker: () => {
          const row = root.querySelector('#char-skin-row');
          if (row) row.innerHTML = '<button type="button" role="listitem">1</button>';
        },
        captureFocus: () => null,
      }),
    );
    win.toggle();
    expect(root.getAttribute('role')).toBe('dialog');
    expect(root.getAttribute('aria-labelledby')).toBe('char-title');
    expect(root.querySelector('#char-title')).toBeTruthy();
    expect(root.querySelector('#char-model-preview')?.getAttribute('role')).toBe('img');
    // The role=img preview HOST carries its OWN name, not a duplicate of the
    // title's level/class subtitle.
    const previewName = root.querySelector('#char-model-preview')?.getAttribute('aria-label');
    const titleSubtitle = root.querySelector('#char-title .panel-subtitle')?.textContent ?? '';
    expect(previewName).toBe(t('hudChrome.character.modelPreview'));
    expect(previewName).not.toBe(titleSubtitle);
    await expectClean(root);
  });
});

// ---------------------------------------------------------------------------
// Market (#market-window) - the async Browse window: dialog name + the persistent
// role=status live region, under BOTH world shapes (like leaderboard).
// ---------------------------------------------------------------------------

function marketInfo(shape: WorldShape): MarketInfo {
  // A populated listing so the Browse body renders real rows (the buy button + the row
  // controls), not the empty-state short-circuit: an empty window passes axe vacuously
  // (the populated-fixture requirement), so axe must see the row controls.
  const listing: MarketListingView = {
    id: 1,
    sellerName: 'Bramblefoot',
    itemId: Object.keys(ITEMS)[0],
    count: 1,
    price: 1234,
    mine: false,
    house: false,
  };
  const base: MarketInfo = {
    listings: [listing],
    totalCount: 1,
    filter: 'all',
    page: 0,
    pageCount: 1,
    collectionCopper: 0,
    collectionItems: [],
    cutPct: 5,
    maxListings: 10,
    myListingCount: 0,
  };
  // The sim shape may carry extra server-only fields the view ignores; the client mirror
  // carries only the decoded fields (the offline-only-shape trap catches).
  return shape === 'sim' ? ({ ...base, _serverSeq: 3 } as unknown as MarketInfo) : base;
}

describe('axe: market window (Sim + ClientWorld shapes)', () => {
  for (const shape of ['sim', 'client'] as const) {
    it(`browse state is clean and names the dialog under the ${shape} shape`, async () => {
      const root = host('market-window');
      root.style.display = 'none';
      const win = new MarketWindow(
        stubDeps({
          root: () => root,
          world: () =>
            ({ marketInfo: marketInfo(shape), copper: 0, marketSearch: () => undefined }) as never,
          hideTooltip: () => undefined,
          captureFocus: () => null,
        }),
      );
      win.open();
      expect(root.getAttribute('role')).toBe('dialog');
      expect(root.getAttribute('aria-label')).toBe(t('itemUi.market.title'));
      // The async-results live region is persistent + polite (the lazy-load a11y fix).
      expect(root.querySelector('.mkt-status')?.getAttribute('role')).toBe('status');
      await expectClean(root);
    });
  }
});

// ---------------------------------------------------------------------------
// Bags (#bags-window) - the ad-hoc discard prompt, which got role=dialog +
// aria-modal + a self-contained Tab trap (appended to #prompt-stack, outside the bags root).
// ---------------------------------------------------------------------------

describe('axe: bags discard prompt', () => {
  it('is a clean, named modal dialog with a resolving label', async () => {
    const root = host('bags-window');
    root.style.display = 'none';
    // The ad-hoc prompts append to #prompt-stack, which must exist in the DOM.
    const stack = document.createElement('div');
    stack.id = 'prompt-stack';
    document.body.appendChild(stack);
    const win = new BagsWindow(
      stubDeps({
        root: () => root,
        world: () => ({ inventory: [], copper: 0 }) as never,
      }),
    );
    const itemId = Object.keys(ITEMS)[0];
    (
      win as unknown as { showDiscardItemPrompt(id: string, max: number): void }
    ).showDiscardItemPrompt(itemId, 5);
    const prompt = stack.querySelector('.discard-item-prompt') as HTMLElement | null;
    expect(prompt?.getAttribute('role')).toBe('dialog');
    expect(prompt?.getAttribute('aria-modal')).toBe('true');
    // aria-labelledby must resolve to the prompt's own title (not dangle).
    const lbl = prompt?.getAttribute('aria-labelledby');
    expect(lbl && prompt?.querySelector(`#${CSS.escape(lbl)}`)).toBeTruthy();
    await expectClean(stack);
  });

  it('clears #bags inert after a prompt CONFIRM, not only cancel/Escape (inert must not leak)', async () => {
    const root = host('bags-window');
    root.style.display = 'flex';
    const stack = document.createElement('div');
    stack.id = 'prompt-stack';
    document.body.appendChild(stack);
    const win = new BagsWindow(
      stubDeps({
        root: () => root,
        world: () => ({ inventory: [], copper: 0, sellItem: () => {} }) as never,
      }),
    );
    const itemId = Object.keys(ITEMS)[0];
    (
      win as unknown as { showSellQuantityPrompt(id: string, max: number): void }
    ).showSellQuantityPrompt(itemId, 5);
    // The bag grid behind the modal prompt is inert while it is open.
    expect(root.inert).toBe(true);
    const confirmBtn = Array.from(stack.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent === t('itemUi.vendor.sellQuantityConfirm'),
    );
    expect(confirmBtn, 'sell prompt has a confirm button').toBeTruthy();
    confirmBtn?.click();
    // Confirm tears the prompt down through the SAME dismiss() path as cancel/Escape, so
    // inert is cleared; a regression here strands the entire grid non-interactive and out
    // of the a11y tree.
    expect(root.inert).toBe(false);
    expect(stack.querySelector('.sell-quantity-prompt')).toBeNull();
  });

  it('force-closed out from under an open prompt: clears #bags inert AND tears down the prompt', () => {
    const root = host('bags-window');
    root.style.display = 'flex';
    const stack = document.createElement('div');
    stack.id = 'prompt-stack';
    document.body.appendChild(stack);
    const win = new BagsWindow(
      stubDeps({
        root: () => root,
        world: () => ({ inventory: [], copper: 0, discardItem: () => {} }) as never,
        captureFocus: () => null,
        restoreFocus: () => {},
      }),
    );
    const itemId = Object.keys(ITEMS)[0];
    // A unique-item discard (maxCount 1) opens the prompt with focus on the confirm BUTTON,
    // which input.ts does NOT suppress, so the bags keybind can fire and toggleBags ->
    // close() the window while the prompt is still open. That path never runs the prompt's
    // dismiss(), so close() must clear inert itself or the grid is left dead on reopen.
    (
      win as unknown as { showDiscardItemPrompt(id: string, max: number): void }
    ).showDiscardItemPrompt(itemId, 1);
    expect(root.inert).toBe(true);
    win.close();
    expect(root.style.display).toBe('none');
    // A hidden bags window must never stay inert; otherwise the next open shows a grid that
    // is non-interactive and out of the a11y tree.
    expect(root.inert).toBe(false);
    // The prompt is torn down too, not left an orphaned aria-modal dialog floating over the
    // (re-openable) window.
    expect(stack.querySelector('.discard-item-prompt')).toBeNull();
  });

  it('returns focus to the opener on close (non-modal capture-and-return, no trap)', () => {
    const root = host('bags-window');
    root.style.display = 'none';
    // A real opener outside #bags (the minimap bag button analog).
    const opener = document.createElement('button');
    opener.textContent = 'open bags';
    document.body.appendChild(opener);
    const win = new BagsWindow(
      stubDeps({
        root: () => root,
        world: () => ({ inventory: [], copper: 0 }) as never,
        // Wire the real capture-and-return contract (no Tab trap): note the focused
        // opener on open, refocus it on close.
        captureFocus: () => document.activeElement as HTMLElement | null,
        restoreFocus: (target: HTMLElement | null) => target?.focus(),
      }),
    );
    opener.focus();
    win.noteOpener();
    root.style.display = 'flex';
    win.close();
    expect(root.style.display).toBe('none');
    expect(document.activeElement).toBe(opener);
  });
});
