// @vitest-environment happy-dom
//
// DOM behavioral guard for The Reliquary window: the real ReliquaryWindow driven
// over happy-dom with stub deps and the LIVE RELIQUARY_PAGES catalog (ownership
// is synthetic, the catalog never is, so a source line resolves through the same
// content the game ships). Ten behaviors: opener focus capture and return,
// data-focus-key restore across a rebuild, scroll preservation, refreshIfChanged
// elision plus per-dimension repaint, nav/page/back navigation, cell and chip
// tooltips, dialog-root labeling, search filtering, the owned/missing chips, and
// the roving grid tab stop.
//
// The source-scrape pins live in tests/reliquary_window.test.ts and the pure
// model in tests/reliquary_view.test.ts; this file asserts only what a player
// can observe, through the real code path.
//
// Every visible-text assertion compares against a LIVE t() / label-module call
// (reliquaryPageName, reliquaryPageDesc, reliquaryRelicDisplayName,
// reliquarySourceLineText), never hardcoded English: a locale fill must not turn
// a green pin red, and an English-only regression must not hide behind one.
// Where a test depends on a fact about the shipped catalog (a needle that lives
// in a page DESC but not its NAME, a relic the catalog leaves un-hinted), that
// fact is asserted as an explicit premise first, so content drift fails loudly
// instead of quietly making the test vacuous.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RELIQUARY_PAGES,
  RELIQUARY_PAGES_BY_ID,
  type ReliquaryRelicDef,
  reliquaryRelicSource,
} from '../src/sim/content/reliquary';
import { ITEMS } from '../src/sim/data';
import { pageCompletion } from '../src/sim/reliquary';
import { tEntity, zoneDisplayName } from '../src/ui/entity_i18n';
import { esc } from '../src/ui/esc';
import {
  ensureLocaleLoaded,
  formatNumber,
  getLanguage,
  languageTag,
  setLanguage,
  t,
  tPlural,
} from '../src/ui/i18n';
import { reliquaryPageDesc, reliquaryPageName } from '../src/ui/reliquary_i18n';
import { reliquaryRelicDisplayName, reliquarySourceLineText } from '../src/ui/reliquary_labels';
import { RELIQUARY_TRACK_CAP } from '../src/ui/reliquary_tracker_view';
import { reliquarySourceLinePlan } from '../src/ui/reliquary_view';
import {
  type ReliquaryNavId,
  ReliquaryWindow,
  type ReliquaryWindowDeps,
} from '../src/ui/reliquary_window';

// happy-dom ships no 2D canvas, so the procedural item-icon compositor cannot
// run here; the painter only ever uses the returned string as an <img src>. The
// kind and id are echoed into the URL rather than returned as a constant, so a
// cell painted from the wrong relic id fails a comparison instead of coming back
// byte-identical to its neighbour.
vi.mock('../src/ui/icons', () => ({
  iconDataUrl: (kind: string, id: string) => `data:,${kind}:${id}`,
}));

// The page every grid test drives: five item relics, a dungeon clear source, and
// a page-level sourceDefault, so its missing cells exercise the two-part
// "bossDungeon" source arm rather than the degenerate one.
const PAGE_ID = 'conquerors_hollow_crypt';
// The Horizons mounts page: seven mounts name every door that awards their
// reins and two remain content gaps, so it is the page that exercises BOTH the
// hinted and the un-hinted arm at once.
const UNHINTED_PAGE_ID = 'horizons_mounts';
// The mount the catalog leaves un-hinted (no live table awards it), for the
// missing cell that must render NO source line rather than an invented one.
const UNHINTED_MOUNT_ID = 'drakemaw_raptor';
// A Sanctum relic content really awards through three comparable doors, for the
// multi-source tooltip and the joined aria label.
const MULTI_SOURCE_PAGE_ID = 'conquerors_gravewyrm_sanctum';
const MULTI_SOURCE_RELIC_ID = 'boundstone_helm';
// A set-page relic whose two hints are one rare plus the zone it camps in: the
// pair that composes a single "Drops from {rare} in {zone}" line.
const BOSS_ZONE_PAGE_ID = 'conquerors_set_deathlord';
const BOSS_ZONE_RELIC_ID = 'deathlord_sabatons';

const TAG = languageTag(getLanguage());
const fmt = (n: number): string => formatNumber(n, { maximumFractionDigits: 0 });

const pageDef = (pageId: string) => {
  const def = RELIQUARY_PAGES_BY_ID[pageId];
  if (!def) throw new Error(`content premise: ${pageId} is a live Reliquary page`);
  return def;
};

/** Every item id on a page, in catalog order (the order the grid paints). */
function relicIds(pageId: string): string[] {
  return pageDef(pageId).relics.map((relic) => (relic.kind === 'item' ? relic.itemId : ''));
}

/** The SLOT id of one relic, whatever its kind (the mounts page holds no item
 *  relics at all, so relicIds above cannot answer for it). */
function slotId(relic: ReliquaryRelicDef): string {
  if (relic.kind === 'item') return relic.itemId;
  if (relic.kind === 'mark') return relic.markId;
  if (relic.kind === 'mount') return relic.mountId;
  if (relic.kind === 'weapon_skin') return relic.skinId;
  return relic.deedId;
}

/** Every slot id on a page, in the catalog order the grid paints. */
function slotIds(pageId: string): string[] {
  return pageDef(pageId).relics.map(slotId);
}

/** Catalog order index of one relic slot on a page, by its slot id. */
function relicIndex(pageId: string, relicId: string): number {
  const index = slotIds(pageId).indexOf(relicId);
  if (index < 0) throw new Error(`content premise: ${pageId} holds ${relicId}`);
  return index;
}

/** Every localized source sentence the catalog authors for one slot, derived
 *  from the live page def through the same pure arm-picker the painter uses.
 *  Each line is resolved one at a time rather than through the painter's own
 *  list helper, so a bug that drops lines inside that helper cannot cancel out. */
function sourceLinesFor(pageId: string, index: number): string[] {
  const def = pageDef(pageId);
  const relic = def.relics[index];
  if (!relic) throw new Error(`content premise: ${pageId} has a relic at ${index}`);
  return reliquarySourceLinePlan(reliquaryRelicSource(def, relic), def.clearSource)
    .map((plan) => reliquarySourceLineText(plan))
    .filter((line) => line !== '');
}

/** Those lines folded the way an aria label has to fold them: through an
 *  INDEPENDENT Intl.ListFormat instance rather than the painter's helper, so
 *  the punctuation itself stays under test (the production fold is formatList,
 *  which shares nothing with this oracle but CLDR). */
function joinSourceLines(lines: readonly string[]): string {
  if (lines.length === 0) return '';
  if (lines.length === 1) return lines[0] ?? '';
  return new Intl.ListFormat(languageTag(getLanguage()), {
    style: 'long',
    type: 'conjunction',
  }).format(lines);
}

// ---------------------------------------------------------------------------
// Stub world + deps
// ---------------------------------------------------------------------------

interface WorldState {
  /**
   * The character the pin store keys off (woc_reliquary_pins_<class>_<name>).
   * Mutable, because the key-change reload can only be observed by walking ONE
   * live window across a switch: a second window instance reloads anyway, from a
   * cold key, so it would pass whether or not the reload exists.
   */
  identity: { playerClass: string; name: string };
  itemsDiscovered: Set<string>;
  marks: Set<string>;
  recent: string[];
  firstFind: Record<string, { clears?: number }>;
  /** reliquaryObtainCounts: sparse, catalogued item ids only, >= 1. */
  obtainCounts: Record<string, number>;
  mounts: string[];
  weaponSkinIds: string[];
  deedsEarned: Map<string, string>;
  /** reliquaryCatalogCompletion(): signature-only, so it can move alone. */
  catalog: { owned: number; total: number };
  /** reliquaryCuratorRank(): signature-only. */
  curatorRank: number;
  /** reliquaryPageClearCount(pageId). */
  clears: Map<string, number>;
  /**
   * world.deedStats.counters, the block the display-only SECOND clear meter
   * reads. Optional on purpose: a host that has not mirrored the facet (and a
   * stub that never seeds it) is a live path the meter must survive, so the
   * default state leaves it absent and one test drives that arm directly.
   */
  counters?: Record<string, number>;
  /** reliquaryPageCompletion(pageId).owned (the signature, and the pin prune). */
  pageOwned: Map<string, number>;
  /** Overrides reliquaryPageCompletion(pageId).total; the catalog count otherwise. */
  pageTotal: Map<string, number>;
  /**
   * reliquaryRarity(): the population aggregate the fetch-per-open resolves.
   * Null is the default AND the offline arm (the Sim always answers null), so
   * every pre-existing test observes the no-rarity render; a with-data test
   * seeds this BEFORE makeWindow and flushes the microtask fetch.
   */
  rarity: {
    totalEligible: number;
    found: Record<string, number>;
    illuminated: Record<string, number>;
  } | null;
  /**
   * How many times the painter actually READ each of the two ownership seams
   * the view needs as Sets. Both are copied per repaint and must never be
   * touched by an elided slow-band poll, so a call count is the decisive
   * observation: a Set allocated in buildInput would show up here as a read on
   * a poll that painted nothing.
   */
  reads: { ownedMounts: number; weaponSkinIds: number };
}

function baseState(): WorldState {
  return {
    identity: { playerClass: 'warrior', name: 'Testwright' },
    itemsDiscovered: new Set(),
    marks: new Set(),
    recent: [],
    firstFind: {},
    obtainCounts: {},
    mounts: [],
    weaponSkinIds: [],
    deedsEarned: new Map(),
    catalog: { owned: 0, total: 100 },
    curatorRank: 0,
    clears: new Map(),
    pageOwned: new Map(),
    pageTotal: new Map(),
    rarity: null,
    reads: { ownedMounts: 0, weaponSkinIds: 0 },
  };
}

interface Rig {
  w: ReliquaryWindow;
  el: HTMLElement;
  state: WorldState;
  /** The element deps.captureFocus hands back on open. */
  opener: HTMLElement;
  /** Every attachTooltip call, in order (newest last). */
  tooltips: Array<{ node: HTMLElement; html: () => string }>;
  /** Every deps.restoreFocus argument, in order. */
  restored: Array<HTMLElement | null>;
  counts: {
    closeOthers: number;
    hideTooltip: number;
    captureFocus: number;
    /** onPinChanged: the immediate HUD-tracker nudge a pin toggle owes. */
    pinChanged: number;
  };
}

function makeWindow(state: WorldState, opts: { open?: boolean; nav?: ReliquaryNavId } = {}): Rig {
  const el = document.createElement('div');
  el.id = 'reliquary-window';
  document.body.appendChild(el);
  const opener = document.createElement('button');
  opener.id = 'opener';
  document.body.appendChild(opener);

  const tooltips: Rig['tooltips'] = [];
  const restored: Rig['restored'] = [];
  const counts = { closeOthers: 0, hideTooltip: 0, captureFocus: 0, pinChanged: 0 };

  const deps: ReliquaryWindowDeps = {
    root: () => el,
    world: () =>
      ({
        // The pin store keys off the character (woc_reliquary_pins_<class>_<name>),
        // so every ReliquaryWindow world needs the identity pair a real IWorld has.
        // Read through state on every call, exactly as a real world answers after
        // a character switch, rather than frozen into the deps at construction.
        cfg: { playerClass: state.identity.playerClass },
        player: { name: state.identity.name },
        deedStats: { itemsDiscovered: state.itemsDiscovered, counters: state.counters },
        reliquaryMarks: state.marks,
        reliquaryRecent: state.recent,
        reliquaryFirstFind: state.firstFind,
        // Handed over as the LIVE record, exactly as both real worlds expose it,
        // so a mutation in a test is visible to the next poll without rebuilding
        // the stub (and so the painter is observed reading it, not copying it).
        reliquaryObtainCounts: state.obtainCounts,
        ownedMounts: () => {
          state.reads.ownedMounts++;
          return state.mounts;
        },
        accountCosmetics: {
          get weaponSkinIds() {
            state.reads.weaponSkinIds++;
            return state.weaponSkinIds;
          },
        },
        deedsEarned: state.deedsEarned,
        reliquaryPageClearCount: (pageId: string) => state.clears.get(pageId),
        reliquaryCatalogCompletion: () => state.catalog,
        reliquaryCuratorRank: () => state.curatorRank,
        // Read through state on every call (the identity discipline above), so
        // a test can swap the aggregate between opens without a new rig.
        reliquaryRarity: () => Promise.resolve(state.rarity),
        // Both hosts answer for EVERY live catalog page and null only for an id
        // the catalog does not hold, so the stub does the same: null is the
        // content-drift signal the pin prune keys on, not "this test did not
        // seed a count". The answer folds the SAME ownership the view model
        // folds, through the same pageCompletion, so the facet and the painted
        // shelf row can never disagree about whether a page is illuminated.
        // pageOwned / pageTotal stay available as signature-only overrides.
        reliquaryPageCompletion: (pageId: string) => {
          const def = RELIQUARY_PAGES_BY_ID[pageId];
          if (!def) return null;
          // Read through the raw state fields, never the counted world
          // accessors, so this does not disturb the ownership-read counters.
          const real = pageCompletion(def, {
            itemsDiscovered: state.itemsDiscovered,
            marks: state.marks,
            ownedMounts: new Set(state.mounts),
            weaponSkins: new Set(state.weaponSkinIds),
            deedsEarned: state.deedsEarned,
          });
          const owned = state.pageOwned.get(pageId) ?? real.owned;
          const total = state.pageTotal.get(pageId) ?? real.total;
          // complete mirrors production exactly (sim pageCompletion: owned === total).
          return { owned, total, complete: total > 0 && owned === total };
        },
      }) as never,
    closeOthers: () => {
      counts.closeOthers++;
    },
    hideTooltip: () => {
      counts.hideTooltip++;
    },
    consumePeek: () => false,
    captureFocus: () => {
      counts.captureFocus++;
      return opener;
    },
    restoreFocus: (target) => {
      restored.push(target);
    },
    onPinChanged: () => {
      counts.pinChanged++;
    },
    itemIcon: (item) => `<img data-item-icon="${item.id}" alt="">`,
    moneyHtml: () => '',
    itemTooltip: (item) => `<div data-item-tooltip="${item.id}"></div>`,
    attachTooltip: (node, html) => {
      tooltips.push({ node, html });
    },
  };

  const w = new ReliquaryWindow(deps);
  if (opts.open !== false) w.open(opts.nav);
  return { w, el, state, opener, tooltips, restored, counts };
}

// ---------------------------------------------------------------------------
// Query + interaction helpers
// ---------------------------------------------------------------------------

const cells = (el: HTMLElement): HTMLElement[] => [
  ...el.querySelectorAll<HTMLElement>('.reliquary-cell'),
];
const pageIds = (el: HTMLElement): string[] =>
  [...el.querySelectorAll<HTMLElement>('[data-page]')].map((node) => node.dataset.page ?? '');
const liveRegion = (el: HTMLElement): HTMLElement | null =>
  el.querySelector<HTMLElement>('[data-reliquary-live]');
const searchField = (el: HTMLElement): HTMLInputElement => {
  const input = el.querySelector<HTMLInputElement>('.reliquary-search');
  if (!input) throw new Error('contract: .reliquary-search is the window search field');
  return input;
};
const must = (el: HTMLElement, selector: string): HTMLElement => {
  const node = el.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`missing ${selector}`);
  return node;
};

/** Click without touching focus (the mouse shape). */
function click(el: HTMLElement, selector: string): HTMLElement {
  const node = must(el, selector);
  node.click();
  return node;
}

/** Focus then click: the keyboard Enter activation shape. */
function focusClick(el: HTMLElement, selector: string): HTMLElement {
  const node = must(el, selector);
  node.focus();
  node.click();
  return node;
}

/** Type into the search field the way a player does: focus, set, dispatch. */
function typeSearch(el: HTMLElement, value: string, range?: [number, number]): void {
  const input = searchField(el);
  input.focus();
  input.value = value;
  if (range) input.setSelectionRange(range[0], range[1]);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function keydown(node: HTMLElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  node.dispatchEvent(event);
  return event;
}

/** The index of the single roving tab stop, asserting the roving invariant on
 *  the way through: exactly one cell at 0 and every other at -1. */
function tabStopIndex(el: HTMLElement): number {
  const stops = cells(el).map((node) => node.tabIndex);
  expect(
    stops.filter((v) => v === 0),
    'exactly one grid cell is a tab stop',
  ).toHaveLength(1);
  expect(
    stops.every((v) => v === 0 || v === -1),
    'every non-stop cell is -1 (reachable by Arrow keys only)',
  ).toBe(true);
  return stops.indexOf(0);
}

/** The most recent tooltip callback attached to `node`, or null. Renders are
 *  full rebuilds, so a node from the current paint can never collide with a
 *  stale entry from a previous one. */
function tooltipFor(rig: Rig, node: HTMLElement): (() => string) | null {
  for (let i = rig.tooltips.length - 1; i >= 0; i--) {
    const entry = rig.tooltips[i];
    if (entry && entry.node === node) return entry.html;
  }
  return null;
}

/** Record every raw markup string the painter assigns to el.innerHTML while
 *  `run` executes. The live region's contract is that it is EMITTED empty and
 *  written after insertion, which is only observable in the pre-insertion
 *  string: by the time the DOM settles the announcement is already in place. */
function captureRawMarkup(el: HTMLElement, run: () => void): string[] {
  const seen: string[] = [];
  let proto: object | null = Object.getPrototypeOf(el);
  let desc: PropertyDescriptor | undefined;
  while (proto !== null && desc === undefined) {
    desc = Object.getOwnPropertyDescriptor(proto, 'innerHTML');
    proto = Object.getPrototypeOf(proto);
  }
  const getter = desc?.get;
  const setter = desc?.set;
  if (!getter || !setter) {
    throw new Error('contract: innerHTML is an accessor somewhere on the prototype chain');
  }
  Object.defineProperty(el, 'innerHTML', {
    configurable: true,
    get: () => getter.call(el),
    set: (value: string) => {
      seen.push(String(value));
      setter.call(el, value);
    },
  });
  try {
    run();
  } finally {
    delete (el as unknown as Record<string, unknown>).innerHTML;
  }
  return seen;
}

/** Open the window straight onto a page grid. */
function openPage(state: WorldState, pageId = PAGE_ID, nav: ReliquaryNavId = 'conquerors'): Rig {
  const rig = makeWindow(state, { nav });
  click(rig.el, `[data-page="${pageId}"]`);
  return rig;
}

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// 1. Open/close focus capture and return
// ---------------------------------------------------------------------------

describe('ReliquaryWindow: opener focus capture and return', () => {
  it('captures the opener on open and hands the SAME element back on close', () => {
    const rig = makeWindow(baseState(), { open: false });
    rig.opener.focus();
    rig.w.open();
    expect(rig.counts.captureFocus).toBe(1);
    expect(rig.restored).toHaveLength(0);
    rig.w.close();
    // Identity, not truthiness: a window that restored SOME element (or null)
    // would strand the keyboard player somewhere other than where they were.
    expect(rig.restored).toEqual([rig.opener]);
  });

  it('focuses the Close button on cold open so a keyboard user enters the dialog', () => {
    const rig = makeWindow(baseState());
    expect(document.activeElement).toBe(rig.el.querySelector('[data-close]'));
  });

  it('closes the sibling windows exactly once, on the cold open only', () => {
    const rig = makeWindow(baseState());
    expect(rig.counts.closeOthers).toBe(1);
    rig.w.open('conquerors');
    expect(rig.counts.closeOthers).toBe(1);
  });

  it('does not re-capture the opener when open() lands on an already-open window', () => {
    const rig = makeWindow(baseState(), { open: false });
    rig.opener.focus();
    rig.w.open();
    // A second open() (the minimap click, a keybind press) repaints but must not
    // overwrite the captured opener with whatever holds focus now, or close will
    // hand the player back to a control inside the window it just closed.
    must(rig.el, '[data-close]').focus();
    rig.w.open('horizons');
    expect(rig.counts.captureFocus).toBe(1);
    rig.w.close();
    expect(rig.restored).toEqual([rig.opener]);
  });

  it('ignores close() on an already-closed window (no second restore)', () => {
    const rig = makeWindow(baseState());
    rig.w.close();
    rig.w.close();
    expect(rig.restored).toHaveLength(1);
    expect(rig.w.isOpen).toBe(false);
  });

  it('hides the shared tooltip on close so no card outlives the window', () => {
    const rig = makeWindow(baseState());
    const before = rig.counts.hideTooltip;
    rig.w.close();
    expect(rig.counts.hideTooltip).toBeGreaterThan(before);
  });
});

// ---------------------------------------------------------------------------
// 2. data-focus-key restore across a rebuild
// ---------------------------------------------------------------------------

describe('ReliquaryWindow: focus survives a rebuild', () => {
  it('keeps focus on the same filter chip across a data-driven rebuild', () => {
    const rig = openPage(baseState());
    const before = must(rig.el, '[data-filter="owned"]');
    before.focus();
    rig.state.curatorRank = 3;
    rig.w.refreshIfChanged();
    const fresh = must(rig.el, '[data-filter="owned"]');
    expect(fresh).not.toBe(before);
    expect(document.activeElement).toBe(fresh);
  });

  it('keeps focus on the same shelf page row across a data-driven rebuild', () => {
    const rig = makeWindow(baseState(), { nav: 'conquerors' });
    const before = must(rig.el, `[data-page="${PAGE_ID}"]`);
    before.focus();
    rig.state.curatorRank = 2;
    rig.w.refreshIfChanged();
    const fresh = must(rig.el, `[data-page="${PAGE_ID}"]`);
    expect(fresh).not.toBe(before);
    expect(document.activeElement).toBe(fresh);
  });

  it('keeps focus on the back button across a data-driven rebuild', () => {
    const rig = openPage(baseState());
    const before = must(rig.el, '[data-back]');
    before.focus();
    rig.state.curatorRank = 4;
    rig.w.refreshIfChanged();
    const fresh = must(rig.el, '[data-back]');
    expect(fresh).not.toBe(before);
    expect(document.activeElement).toBe(fresh);
  });

  it('never pulls focus into the window when the repaint finds it elsewhere', () => {
    const rig = makeWindow(baseState(), { nav: 'conquerors' });
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    rig.state.curatorRank = 2;
    rig.w.refreshIfChanged();
    // The slow band repaints in the background whether or not the player is
    // looking at this window. A painter that restored focus unconditionally
    // would yank them out of the chat box every time an unlock landed.
    expect(document.activeElement).toBe(outside);
  });

  it('falls back to Close when the focused control is gone after the rebuild', () => {
    const state = baseState();
    const ids = relicIds(PAGE_ID);
    // Four of five owned puts the page on the nearly-complete strip; owning the
    // fifth completes it, so the row the player is standing on is destroyed by
    // a rebuild they did not initiate.
    for (const id of ids.slice(0, 4)) state.itemsDiscovered.add(id);
    const rig = makeWindow(state, { nav: 'overview' });
    const before = must(rig.el, `[data-focus-key="nearly:${PAGE_ID}"]`);
    before.focus();
    state.itemsDiscovered.add(ids[4] ?? '');
    rig.w.refreshIfChanged();
    expect(rig.el.querySelector(`[data-focus-key="nearly:${PAGE_ID}"]`)).toBeNull();
    const after = document.activeElement as HTMLElement | null;
    expect(after?.hasAttribute('data-close')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Scroll preservation
// ---------------------------------------------------------------------------

describe('ReliquaryWindow: scroll preservation', () => {
  it('preserves the scroll offset across a data-driven rebuild', () => {
    const rig = makeWindow(baseState(), { nav: 'conquerors' });
    const scroll = rig.el.querySelector<HTMLElement>('.reliquary-scroll');
    if (!scroll) throw new Error('contract: .reliquary-scroll is the window scroll container');
    scroll.scrollTop = 140;
    rig.state.curatorRank = 5;
    rig.w.refreshIfChanged();
    const fresh = rig.el.querySelector<HTMLElement>('.reliquary-scroll');
    // Node identity proves the container really was rebuilt, so a preserved
    // offset is a carry rather than an untouched element.
    expect(fresh).not.toBe(scroll);
    expect(fresh?.scrollTop).toBe(140);
  });

  it('preserves the scroll offset across a page grid rebuild', () => {
    const rig = openPage(baseState());
    const scroll = must(rig.el, '.reliquary-scroll');
    scroll.scrollTop = 96;
    rig.state.clears.set(PAGE_ID, 11);
    rig.w.refreshIfChanged();
    const fresh = must(rig.el, '.reliquary-scroll');
    expect(fresh).not.toBe(scroll);
    expect(fresh.scrollTop).toBe(96);
  });
});

// ---------------------------------------------------------------------------
// 4. refreshIfChanged elision + per-dimension repaint
// ---------------------------------------------------------------------------

/**
 * Both directions for one signature dimension: an unchanged world must elide,
 * and the mutation must repaint. Asserting only the repaint half would pass on
 * a painter that rebuilt unconditionally.
 */
function expectDimension(rig: Rig, label: string, mutate: () => void): void {
  const settled = rig.el.firstElementChild;
  rig.w.refreshIfChanged();
  expect(rig.el.firstElementChild, `${label}: an unchanged signature must elide`).toBe(settled);
  mutate();
  rig.w.refreshIfChanged();
  expect(rig.el.firstElementChild, `${label}: the changed dimension must repaint`).not.toBe(
    settled,
  );
}

describe('ReliquaryWindow: refreshIfChanged elision and per-dimension repaint', () => {
  it('performs no DOM writes when the refresh signature is unchanged', () => {
    const rig = makeWindow(baseState(), { nav: 'conquerors' });
    // Deliberately NO leading refreshIfChanged() to settle a catch-up repaint:
    // render() latches lastSig at its END, so an open window is already settled
    // and the first poll must elide. A settling call here would mask exactly the
    // latch regression this test exists to catch.
    const closeBtn = rig.el.querySelector('[data-close]');
    const firstChild = rig.el.firstElementChild;
    const html = rig.el.innerHTML;
    rig.w.refreshIfChanged();
    rig.w.refreshIfChanged();
    // Node identity is the decisive check: a rebuild replaces every child even
    // when the markup comes back byte-identical.
    expect(rig.el.querySelector('[data-close]')).toBe(closeBtn);
    expect(rig.el.firstElementChild).toBe(firstChild);
    expect(rig.el.innerHTML).toBe(html);
  });

  it('does nothing at all while the window is closed', () => {
    const rig = makeWindow(baseState());
    rig.w.close();
    const html = rig.el.innerHTML;
    rig.state.curatorRank = 4;
    rig.state.catalog = { owned: 40, total: 100 };
    rig.w.refreshIfChanged();
    expect(rig.el.innerHTML).toBe(html);
  });

  it('repaints on each world-driven signature dimension, one at a time', () => {
    const state = baseState();
    state.pageOwned.set(PAGE_ID, 1);
    const rig = openPage(state);

    // Catalog completion, curator rank, and page completion feed ONLY the
    // signature (the painted progress is recomputed by the pure core from the
    // ownership sets), so each of these moves the signature and nothing else:
    // a repaint is proof the dimension is carried.
    expectDimension(rig, 'catalog owned', () => {
      state.catalog = { owned: state.catalog.owned + 1, total: state.catalog.total };
    });
    expectDimension(rig, 'catalog total', () => {
      state.catalog = { owned: state.catalog.owned, total: state.catalog.total + 1 };
    });
    expectDimension(rig, 'curator rank', () => {
      state.curatorRank += 1;
    });
    expectDimension(rig, 'active page owned', () => {
      state.pageOwned.set(PAGE_ID, (state.pageOwned.get(PAGE_ID) ?? 0) + 1);
    });
    expectDimension(rig, 'page clear count', () => {
      state.clears.set(PAGE_ID, (state.clears.get(PAGE_ID) ?? 0) + 1);
    });
    expectDimension(rig, 'recent find ring', () => {
      state.recent.push('cryptbone_helm');
    });
    expectDimension(rig, 'marks', () => {
      state.marks.add('masterwork:blacksmithing');
    });
    expectDimension(rig, 'items discovered', () => {
      state.itemsDiscovered.add(relicIds(PAGE_ID)[0] ?? '');
    });
    expectDimension(rig, 'first-find meta', () => {
      state.firstFind[relicIds(PAGE_ID)[1] ?? ''] = { clears: 3 };
    });
    // A FIRST counted obtain (new key) and then a REPEAT one (value bump). The
    // repeat is the load-bearing half: it fills no silhouette, mints no
    // first-find key, and moves no total, so the counts digest is the only
    // dimension that can carry it into an open window.
    expectDimension(rig, 'first counted obtain', () => {
      state.obtainCounts[relicIds(PAGE_ID)[2] ?? ''] = 1;
    });
    expectDimension(rig, 'repeat obtain', () => {
      const id = relicIds(PAGE_ID)[2] ?? '';
      state.obtainCounts[id] = (state.obtainCounts[id] ?? 0) + 1;
    });
  });

  it('latches the new painter state so an interaction is not followed by a second paint', () => {
    // nav, pageId, search, and the ownership chip are PAINTER state: each is
    // changed only by a handler that calls render() unconditionally, so the
    // observable contract is this pair rather than a signature diff. The
    // interaction repaints, and that repaint latches the new state, so the next
    // slow-band poll elides instead of throwing away the focus and scroll the
    // rebuild just restored.
    const rig = makeWindow(baseState());
    const steps: Array<[string, () => void]> = [
      ['nav', () => click(rig.el, '[data-nav="conquerors"]')],
      ['pageId', () => click(rig.el, `[data-page="${PAGE_ID}"]`)],
      ['ownedFilter', () => click(rig.el, '[data-filter="missing"]')],
      ['search', () => typeSearch(rig.el, 'crypt')],
      ['back', () => click(rig.el, '[data-back]')],
    ];
    for (const [label, act] of steps) {
      const before = rig.el.firstElementChild;
      act();
      expect(rig.el.firstElementChild, `${label}: the interaction repaints`).not.toBe(before);
      const painted = rig.el.firstElementChild;
      rig.w.refreshIfChanged();
      expect(rig.el.firstElementChild, `${label}: the repaint latched the signature`).toBe(painted);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Nav / page / back navigation
// ---------------------------------------------------------------------------

describe('ReliquaryWindow: nav, page, and back navigation', () => {
  it('switches shelves on a rail click and marks the active one pressed', () => {
    const rig = makeWindow(baseState());
    expect(rig.el.querySelector('.reliquary-overview')).not.toBeNull();
    click(rig.el, '[data-nav="conquerors"]');
    const expected = RELIQUARY_PAGES.filter((p) => p.shelf === 'conquerors').map((p) => p.id);
    expect(pageIds(rig.el)).toEqual(expected);
    expect(must(rig.el, '[data-nav="conquerors"]').getAttribute('aria-pressed')).toBe('true');
    expect(must(rig.el, '[data-nav="horizons"]').getAttribute('aria-pressed')).toBe('false');
    expect(rig.el.querySelector('.reliquary-overview')).toBeNull();
  });

  it('gives the shelf list real ul/li semantics with the blurb as a second line', () => {
    const rig = makeWindow(baseState(), { nav: 'conquerors' });
    const list = must(rig.el, 'ul.reliquary-page-list');
    expect(list.getAttribute('role')).toBe('list');
    const row = must(rig.el, `[data-page="${PAGE_ID}"]`);
    expect(row.closest('li.reliquary-page-item')).not.toBeNull();
    expect(must(row, '.reliquary-page-name').textContent).toBe(reliquaryPageName(PAGE_ID));
    const desc = reliquaryPageDesc(PAGE_ID);
    expect(desc, 'content premise: the page authors a blurb').not.toBe('');
    expect(must(row, '.reliquary-page-sub').textContent).toBe(desc);
  });

  it('opens the page detail on a row click, with the localized name and blurb', () => {
    const rig = makeWindow(baseState(), { nav: 'conquerors' });
    click(rig.el, `[data-page="${PAGE_ID}"]`);
    expect(must(rig.el, '.reliquary-page-title').textContent).toBe(reliquaryPageName(PAGE_ID));
    expect(must(rig.el, '.reliquary-page-desc').textContent).toBe(reliquaryPageDesc(PAGE_ID));
    expect(rig.el.querySelector('.reliquary-page-list')).toBeNull();
    expect(cells(rig.el)).toHaveLength(relicIds(PAGE_ID).length);
    expect(rig.el.querySelector('[data-back]')).not.toBeNull();
  });

  it('clears the open page when the rail moves to another shelf', () => {
    const rig = openPage(baseState());
    expect(rig.el.querySelector('.reliquary-page-detail')).not.toBeNull();
    click(rig.el, '[data-nav="horizons"]');
    // A shelf switch is a navigation, not an overlay. The page detail resolves
    // its header from the WHOLE catalog when the id is not on the active shelf,
    // so a stale pageId here would leave a Conquerors page rendered under the
    // Horizons rail rather than failing loudly.
    expect(rig.el.querySelector('.reliquary-page-detail')).toBeNull();
    expect(pageIds(rig.el)).toEqual(
      RELIQUARY_PAGES.filter((p) => p.shelf === 'horizons').map((p) => p.id),
    );
  });

  it('returns to the shelf list on back, keeping the shelf it came from', () => {
    const rig = openPage(baseState());
    click(rig.el, '[data-back]');
    expect(rig.el.querySelector('.reliquary-page-detail')).toBeNull();
    expect(must(rig.el, '[data-nav="conquerors"]').getAttribute('aria-pressed')).toBe('true');
    expect(pageIds(rig.el)).toContain(PAGE_ID);
  });

  it('follows an Overview nearly-complete row onto that page and its shelf', () => {
    const state = baseState();
    for (const id of relicIds(PAGE_ID).slice(0, 4)) state.itemsDiscovered.add(id);
    const rig = makeWindow(state, { nav: 'overview' });
    click(rig.el, `[data-focus-key="nearly:${PAGE_ID}"]`);
    // The jump crosses shelves: the rail must follow the page, not stay on the
    // Overview the player launched from.
    expect(must(rig.el, '.reliquary-page-title').textContent).toBe(reliquaryPageName(PAGE_ID));
    expect(must(rig.el, '[data-nav="conquerors"]').getAttribute('aria-pressed')).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// 6. Tooltips and the keyboard-parity aria labels
// ---------------------------------------------------------------------------

describe('ReliquaryWindow: cell tooltips and aria labels', () => {
  it('attaches a tooltip to every grid cell', () => {
    const rig = openPage(baseState());
    const grid = cells(rig.el);
    expect(grid.length).toBeGreaterThan(0);
    for (const node of grid) {
      expect(tooltipFor(rig, node), `cell ${node.dataset.cellId} has a tooltip`).not.toBeNull();
    }
  });

  it('tells a missing cell where the relic comes from, in tooltip AND label', () => {
    const rig = openPage(baseState());
    const id = relicIds(PAGE_ID)[0] ?? '';
    const node = must(rig.el, `[data-cell-id="${id}"]`);
    expect(node.dataset.cellOwned).toBe('0');
    const name = reliquaryRelicDisplayName('item', id);
    const lines = sourceLinesFor(PAGE_ID, 0);
    expect(lines.length, 'content premise: this page authors a source hint').toBeGreaterThan(0);

    const html = tooltipFor(rig, node)?.() ?? '';
    expect(html).toContain(esc(name));
    expect(html).toContain(esc(t('hudChrome.reliquary.missingTooltipStatus')));
    for (const line of lines) expect(html).toContain(esc(line));
    // Keyboard parity: the label carries the same hunting directions the hover
    // card does, so nothing actionable is mouse-only.
    expect(node.getAttribute('aria-label')).toBe(
      t('hudChrome.reliquary.cellMissingSourceAria', { name, source: joinSourceLines(lines) }),
    );
  });

  it('renders no source line at all for a relic the catalog leaves un-hinted', () => {
    const rig = openPage(baseState(), UNHINTED_PAGE_ID, 'horizons');
    const def = pageDef(UNHINTED_PAGE_ID);
    expect(
      def.sourceDefault,
      'content premise: the page authors no default source',
    ).toBeUndefined();
    const index = relicIndex(UNHINTED_PAGE_ID, UNHINTED_MOUNT_ID);
    const relic = def.relics[index];
    expect(relic, `content premise: ${UNHINTED_MOUNT_ID} is a live slot`).toBeTruthy();
    // Premise: this relic really resolves ZERO hints, so the assertions below
    // test the un-hinted arm and not a relic that quietly gained a source.
    expect(
      relic ? reliquaryRelicSource(def, relic) : ['drift'],
      'content premise: the mount is still un-hinted',
    ).toEqual([]);
    const node = must(rig.el, `[data-cell-id="${UNHINTED_MOUNT_ID}"]`);
    const name = reliquaryRelicDisplayName('mount', UNHINTED_MOUNT_ID);
    // The un-hinted arm: the authored "not found yet" copy and nothing invented
    // in its place.
    expect(node.getAttribute('aria-label')).toBe(
      t('hudChrome.reliquary.cellMissingAria', { name }),
    );
    const html = tooltipFor(rig, node)?.() ?? '';
    expect(html).toContain(esc(t('hudChrome.reliquary.missingTooltipStatus')));
    expect(html).toContain(esc(name));
    // No stray empty line either: the tooltip carries the name and the status
    // and nothing else.
    expect(html.match(/tt-line/g) ?? []).toHaveLength(1);
  });

  it('shows EVERY door on a multi-source relic, one tooltip line each', () => {
    const rig = openPage(baseState(), MULTI_SOURCE_PAGE_ID);
    const def = pageDef(MULTI_SOURCE_PAGE_ID);
    const index = relicIndex(MULTI_SOURCE_PAGE_ID, MULTI_SOURCE_RELIC_ID);
    const relic = def.relics[index];
    expect(relic, 'content premise: the relic is a live slot').toBeTruthy();
    // Premise: the relic really carries THREE authored doors, so this case
    // cannot rot into a single-source test if the catalog is trimmed.
    expect(
      relic ? reliquaryRelicSource(def, relic).length : 0,
      'content premise: the relic keeps three authored sources',
    ).toBe(3);
    const lines = sourceLinesFor(MULTI_SOURCE_PAGE_ID, index);
    expect(lines, 'every authored door resolves to real text').toHaveLength(3);
    expect(new Set(lines).size, 'the three lines are distinct sentences').toBe(3);

    const node = must(rig.el, `[data-cell-id="${MULTI_SOURCE_RELIC_ID}"]`);
    expect(node.dataset.cellOwned).toBe('0');
    const html = tooltipFor(rig, node)?.() ?? '';
    for (const line of lines) {
      expect(html, `tooltip carries: ${line}`).toContain(`<div class="tt-line">${esc(line)}</div>`);
    }
    // The label cannot carry separate lines, so the same three fold into the
    // one {source} slot through the localized join.
    const name = reliquaryRelicDisplayName('item', MULTI_SOURCE_RELIC_ID);
    expect(node.getAttribute('aria-label')).toBe(
      t('hudChrome.reliquary.cellMissingSourceAria', { name, source: joinSourceLines(lines) }),
    );
  });

  it('joins the aria source lines with the LOCALE separator, never a literal comma', async () => {
    // ja_JP joins lists with the ideographic comma, so a painter that spelled
    // ', ' itself would put Latin punctuation inside a Japanese sentence a
    // screen reader then reads aloud. Rendering under ja is the only way to see
    // the difference: an English conjunction list and a hand-rolled ', ' join
    // agree on too many bytes to tell apart.
    const previous = getLanguage();
    await ensureLocaleLoaded('ja_JP');
    setLanguage('ja_JP');
    try {
      // Oracle premise: CLDR's ja list join really differs from the ASCII
      // fallback, so the negative assertion below can actually discriminate.
      const jaJoin = new Intl.ListFormat('ja', { style: 'long', type: 'conjunction' }).format([
        'A',
        'B',
      ]);
      expect(jaJoin, 'locale premise: ja joins with its own comma').not.toBe('A, B');
      const rig = openPage(baseState(), MULTI_SOURCE_PAGE_ID);
      const index = relicIndex(MULTI_SOURCE_PAGE_ID, MULTI_SOURCE_RELIC_ID);
      const lines = sourceLinesFor(MULTI_SOURCE_PAGE_ID, index);
      expect(lines.length, 'premise: still a multi-source relic under ja').toBe(3);
      const node = must(rig.el, `[data-cell-id="${MULTI_SOURCE_RELIC_ID}"]`);
      const label = node.getAttribute('aria-label') ?? '';
      expect(label).toBe(
        t('hudChrome.reliquary.cellMissingSourceAria', {
          name: reliquaryRelicDisplayName('item', MULTI_SOURCE_RELIC_ID),
          source: joinSourceLines(lines),
        }),
      );
      // Direct form of the same claim: the ASCII fallback never appears
      // between the first two lines under ja.
      expect(label).not.toContain(`${lines[0]}, ${lines[1]}`);
    } finally {
      setLanguage(previous);
    }
  });

  it('renders a heroic reins mount with every boss AND the rift rank, one line each', () => {
    // The acceptance criterion's second named case: a mount slot resolves its
    // doors through the reins seam, and the rift line reaches a REAL rendered
    // surface here (everywhere else it is only unit-tested text). grag_bear is
    // the four-door maximum, so this also exercises the no-cap rule at today's
    // widest authored relic.
    const rig = openPage(baseState(), UNHINTED_PAGE_ID, 'horizons');
    const def = pageDef(UNHINTED_PAGE_ID);
    const index = relicIndex(UNHINTED_PAGE_ID, 'grag_bear');
    const relic = def.relics[index];
    expect(relic, 'content premise: grag_bear is a live slot').toBeTruthy();
    const hints = relic ? reliquaryRelicSource(def, relic) : [];
    expect(
      hints.map((hint) => hint.sourceKind).sort(),
      'content premise: three bosses plus the rift ladder',
    ).toEqual(['boss', 'boss', 'boss', 'rift']);
    const lines = sourceLinesFor(UNHINTED_PAGE_ID, index);
    expect(lines, 'every door resolves to real text').toHaveLength(4);
    expect(new Set(lines).size, 'four distinct sentences').toBe(4);

    const node = must(rig.el, '[data-cell-id="grag_bear"]');
    expect(node.dataset.cellOwned).toBe('0');
    const html = tooltipFor(rig, node)?.() ?? '';
    for (const line of lines) {
      expect(html, `tooltip carries: ${line}`).toContain(`<div class="tt-line">${esc(line)}</div>`);
    }
    expect(node.getAttribute('aria-label')).toBe(
      t('hudChrome.reliquary.cellMissingSourceAria', {
        name: reliquaryRelicDisplayName('mount', 'grag_bear'),
        source: joinSourceLines(lines),
      }),
    );
  });

  it('composes the rare and the zone it camps in into ONE line', () => {
    const rig = openPage(baseState(), BOSS_ZONE_PAGE_ID);
    const def = pageDef(BOSS_ZONE_PAGE_ID);
    const index = relicIndex(BOSS_ZONE_PAGE_ID, BOSS_ZONE_RELIC_ID);
    const relic = def.relics[index];
    expect(relic, 'content premise: the relic is a live slot').toBeTruthy();
    // Premise: exactly one boss hint and one zone hint, which is the shape that
    // composes. Anything else and this case would be testing a different rule.
    const hints = relic ? reliquaryRelicSource(def, relic) : [];
    expect(
      hints.map((hint) => hint.sourceKind),
      'content premise: the relic pairs a rare with a zone',
    ).toEqual(['boss', 'zone']);
    // Two hints, ONE line: the pair is one answer, not two.
    const lines = sourceLinesFor(BOSS_ZONE_PAGE_ID, index);
    expect(lines).toHaveLength(1);
    const composed = t('hudChrome.reliquary.sourceBossZone', {
      boss: tEntity({ kind: 'mob', id: hints[0]?.sourceId ?? '', field: 'name' }),
      zone: zoneDisplayName(hints[1]?.sourceId ?? ''),
    });
    expect(lines[0]).toBe(composed);

    const node = must(rig.el, `[data-cell-id="${BOSS_ZONE_RELIC_ID}"]`);
    const html = tooltipFor(rig, node)?.() ?? '';
    expect(html).toContain(`<div class="tt-line">${esc(composed)}</div>`);
    expect(node.getAttribute('aria-label')).toBe(
      t('hudChrome.reliquary.cellMissingSourceAria', {
        name: reliquaryRelicDisplayName('item', BOSS_ZONE_RELIC_ID),
        source: composed,
      }),
    );
  });

  it('serves the full item tooltip for an owned item relic', () => {
    const state = baseState();
    const id = relicIds(PAGE_ID)[1] ?? '';
    state.itemsDiscovered.add(id);
    const rig = openPage(state);
    const node = must(rig.el, `[data-cell-id="${id}"]`);
    expect(node.dataset.cellOwned).toBe('1');
    // Exact equality, against a stub that echoes the id it was handed: this
    // fails both if the painter stops delegating and if it delegates the wrong
    // ItemDef.
    expect(tooltipFor(rig, node)?.()).toBe(`<div data-item-tooltip="${id}"></div>`);
    expect(ITEMS[id], 'content premise: the relic is a catalogued item').toBeDefined();
    expect(node.getAttribute('aria-label')).toBe(
      t('hudChrome.reliquary.cellOwnedAria', { name: reliquaryRelicDisplayName('item', id) }),
    );
  });

  it('adds the first-find clear number to an owned relic that has one', () => {
    const state = baseState();
    const id = relicIds(PAGE_ID)[2] ?? '';
    state.itemsDiscovered.add(id);
    state.firstFind[id] = { clears: 7 };
    const rig = openPage(state);
    const node = must(rig.el, `[data-cell-id="${id}"]`);
    const clearsLine = t('hudChrome.reliquary.firstFindClears', { count: fmt(7) });
    const html = tooltipFor(rig, node)?.() ?? '';
    expect(html).toContain(`<div data-item-tooltip="${id}"></div>`);
    expect(html).toContain(esc(clearsLine));
    expect(node.getAttribute('aria-label')).toBe(
      t('hudChrome.reliquary.cellOwnedClearsAria', {
        name: reliquaryRelicDisplayName('item', id),
        count: fmt(7),
      }),
    );
  });

  it('adds the obtain tally to an owned relic the world has counted', () => {
    const state = baseState();
    const id = relicIds(PAGE_ID)[1] ?? '';
    state.itemsDiscovered.add(id);
    state.obtainCounts[id] = 3;
    const rig = openPage(state);
    const node = must(rig.el, `[data-cell-id="${id}"]`);
    const line = tPlural('hudChrome.plurals.reliquaryObtainedTimes', 3, { count: fmt(3) });
    const html = tooltipFor(rig, node)?.() ?? '';
    // The full item tooltip branch: the stub body first, then the tally line.
    expect(html).toContain(`<div data-item-tooltip="${id}"></div>`);
    expect(html).toContain(`<div class="tt-line">${esc(line)}</div>`);
    // Keyboard parity (the agreement contract): whatever the tooltip gained,
    // the label gained, through the count-bearing owned aria arm.
    expect(node.getAttribute('aria-label')).toBe(
      tPlural('hudChrome.plurals.reliquaryCellOwnedObtainedAria', 3, {
        name: reliquaryRelicDisplayName('item', id),
        count: fmt(3),
      }),
    );
  });

  it('reads the SINGULAR leaf at exactly one obtain', () => {
    // Pinned against the `.one` leaf itself, not against tPlural: a painter that
    // resolved the base's `.other` directly would render "Obtained 1 times" and
    // red here, while a tPlural-vs-tPlural comparison would be a tautology.
    const state = baseState();
    const id = relicIds(PAGE_ID)[1] ?? '';
    state.itemsDiscovered.add(id);
    state.obtainCounts[id] = 1;
    const rig = openPage(state);
    const node = must(rig.el, `[data-cell-id="${id}"]`);
    const singular = t('hudChrome.plurals.reliquaryObtainedTimes.one', { count: fmt(1) });
    expect(tooltipFor(rig, node)?.()).toContain(`<div class="tt-line">${esc(singular)}</div>`);
    expect(node.getAttribute('aria-label')).toBe(
      t('hudChrome.plurals.reliquaryCellOwnedObtainedAria.one', {
        name: reliquaryRelicDisplayName('item', id),
        count: fmt(1),
      }),
    );
  });

  it('renders NO tally line for an owned relic the world reports no count for', () => {
    // The transfer arm of the doctrine: a relic that arrived by trade, mail, or
    // market has no counted obtain, and the tooltip must say nothing at all
    // rather than "Obtained 0 times". Exact equality against the item-tooltip
    // stub is the decisive shape: any extra line at all fails it.
    const state = baseState();
    const id = relicIds(PAGE_ID)[1] ?? '';
    state.itemsDiscovered.add(id);
    const rig = openPage(state);
    const node = must(rig.el, `[data-cell-id="${id}"]`);
    expect(tooltipFor(rig, node)?.()).toBe(`<div data-item-tooltip="${id}"></div>`);
    expect(node.getAttribute('aria-label')).toBe(
      t('hudChrome.reliquary.cellOwnedAria', { name: reliquaryRelicDisplayName('item', id) }),
    );
  });

  it('carries the clear number AND the tally when an owned relic has both', () => {
    const state = baseState();
    const id = relicIds(PAGE_ID)[2] ?? '';
    state.itemsDiscovered.add(id);
    state.firstFind[id] = { clears: 7 };
    state.obtainCounts[id] = 4;
    const rig = openPage(state);
    const node = must(rig.el, `[data-cell-id="${id}"]`);
    const html = tooltipFor(rig, node)?.() ?? '';
    expect(html).toContain(esc(t('hudChrome.reliquary.firstFindClears', { count: fmt(7) })));
    expect(html).toContain(
      esc(tPlural('hudChrome.plurals.reliquaryObtainedTimes', 4, { count: fmt(4) })),
    );
    // ONE label, both facts: the clear number rides its own {clears} slot so
    // the CLDR selection stays on the obtain count.
    expect(node.getAttribute('aria-label')).toBe(
      tPlural('hudChrome.plurals.reliquaryCellOwnedClearsObtainedAria', 4, {
        name: reliquaryRelicDisplayName('item', id),
        clears: fmt(7),
        count: fmt(4),
      }),
    );
  });

  it('selects the singular leaf on the combined clears-and-tally base at exactly one', () => {
    const state = baseState();
    const id = relicIds(PAGE_ID)[2] ?? '';
    state.itemsDiscovered.add(id);
    state.firstFind[id] = { clears: 7 };
    state.obtainCounts[id] = 1;
    const rig = openPage(state);
    const node = must(rig.el, `[data-cell-id="${id}"]`);
    // Pinned through t() on the LEAF, not tPlural against tPlural: the
    // combined base's plural-selection arm would otherwise be a tautology,
    // and a painter collapsed onto .other would stay green (the sibling
    // single-fact bases already pin their singulars the same way).
    expect(node.getAttribute('aria-label')).toBe(
      t('hudChrome.plurals.reliquaryCellOwnedClearsObtainedAria.one', {
        name: reliquaryRelicDisplayName('item', id),
        clears: fmt(7),
        count: fmt(1),
      }),
    );
  });

  it('appends the tally to the plain body when an owned item has no live ItemDef', () => {
    // The second owned tooltip branch. It is reachable only when the client
    // cannot resolve the relic's ItemDef (a stale bundle against a newer
    // catalog), which is exactly why it must carry the line too: the branch
    // that drops it would ship a tooltip that silently loses a fact. Simulated
    // by removing the def for the duration of the test and restoring it, so the
    // live catalog is unchanged for every other case in this file.
    const state = baseState();
    const id = relicIds(PAGE_ID)[1] ?? '';
    state.itemsDiscovered.add(id);
    state.obtainCounts[id] = 2;
    const def = ITEMS[id];
    expect(def, 'content premise: the relic normally HAS a live ItemDef').toBeDefined();
    delete ITEMS[id];
    try {
      const rig = openPage(state);
      const node = must(rig.el, `[data-cell-id="${id}"]`);
      const html = tooltipFor(rig, node)?.() ?? '';
      // Premise: this really is the body branch, not the item-tooltip one.
      expect(html).not.toContain('data-item-tooltip');
      expect(html).toContain(esc(t('hudChrome.reliquary.ownedTooltipStatus')));
      expect(html).toContain(
        `<div class="tt-line">${esc(
          tPlural('hudChrome.plurals.reliquaryObtainedTimes', 2, { count: fmt(2) }),
        )}</div>`,
      );
      expect(node.getAttribute('aria-label')).toBe(
        tPlural('hudChrome.plurals.reliquaryCellOwnedObtainedAria', 2, {
          name: reliquaryRelicDisplayName('item', id),
          count: fmt(2),
        }),
      );
    } finally {
      if (def) ITEMS[id] = def;
    }
  });

  it('gives every recent-strip chip its full localized name through the shared tooltip', () => {
    const state = baseState();
    const id = relicIds(PAGE_ID)[0] ?? '';
    state.recent.push(id);
    const rig = makeWindow(state, { nav: 'overview' });
    const chip = must(rig.el, '.reliquary-recent-item');
    const name = reliquaryRelicDisplayName('item', id);
    expect(chip.dataset.recentName).toBe(name);
    expect(tooltipFor(rig, chip)?.()).toContain(esc(name));
  });

  it('never uses a native title attribute anywhere in the window', () => {
    const state = baseState();
    state.recent.push(relicIds(PAGE_ID)[0] ?? '');
    state.itemsDiscovered.add(relicIds(PAGE_ID)[1] ?? '');
    const overview = makeWindow(state, { nav: 'overview' });
    expect(overview.el.innerHTML).not.toContain('title=');
    const page = openPage(baseState());
    expect(page.el.innerHTML).not.toContain('title=');
  });
});

// ---------------------------------------------------------------------------
// 7. Dialog root labeling
// ---------------------------------------------------------------------------

describe('ReliquaryWindow: dialog root labeling', () => {
  it('marks the root a named dialog with exactly one accessible name', () => {
    const rig = makeWindow(baseState());
    expect(rig.el.getAttribute('role')).toBe('dialog');
    expect(rig.el.getAttribute('aria-modal')).toBe('false');
    expect(rig.el.getAttribute('tabindex')).toBe('-1');
    expect(rig.el.getAttribute('aria-label')).toBe(t('hudChrome.reliquary.title'));
    // aria-labelledby SHADOWS aria-label, so carrying both would leave the root
    // with a name nobody authored.
    expect(rig.el.hasAttribute('aria-labelledby')).toBe(false);
  });

  it('localizes the visible title, the close button, and the search field', () => {
    const rig = makeWindow(baseState());
    expect(must(rig.el, '.panel-title span').textContent).toBe(t('hudChrome.reliquary.title'));
    expect(must(rig.el, '[data-close]').getAttribute('aria-label')).toBe(
      t('hudChrome.reliquary.close'),
    );
    const input = searchField(rig.el);
    expect(input.getAttribute('placeholder')).toBe(t('hudChrome.reliquary.searchPlaceholder'));
    expect(input.getAttribute('aria-label')).toBe(t('hudChrome.reliquary.searchAria'));
    expect(input.type).toBe('search');
  });

  it('describes the roving keys on every CELL, where a description is announced', () => {
    const rig = openPage(baseState());
    const grid = must(rig.el, '.reliquary-grid');
    expect(grid.getAttribute('role')).toBe('list');
    // The hint SPAN still ships with the grid (it is the describedby target),
    // but the references live on the cells: aria-describedby is announced from
    // the FOCUSED element, and a role="list" container never takes focus here,
    // so pointing it at the grid would describe something nobody lands on.
    const hint = must(rig.el, '#reliquary-grid-hint');
    expect(hint.textContent).toBe(t('hudChrome.reliquary.gridKeyboardHint'));
    const all = cells(rig.el);
    expect(all.length).toBeGreaterThan(1);
    for (const cell of all) {
      expect(cell.getAttribute('aria-describedby')).toBe('reliquary-grid-hint');
      // aria-keyshortcuts takes key VALUES, never localized prose, and must
      // name exactly the keys roving_index owns for orientation 'both'.
      expect(cell.getAttribute('aria-keyshortcuts')).toBe(
        'ArrowLeft ArrowRight ArrowUp ArrowDown Home End',
      );
    }
    // And the grid itself no longer carries them, or a screen reader would
    // read the same hint twice on entering the list.
    expect(grid.getAttribute('aria-describedby')).toBeNull();
    expect(grid.getAttribute('aria-keyshortcuts')).toBeNull();
  });

  it('labels the filter chips and both lists with real localized text', () => {
    // Every visible chip label and every list name is a t() key, not a literal
    // that happens to read as English. Compared against live t() calls so a
    // catalog reword moves both sides together instead of pinning stale copy.
    const rig = openPage(baseState());
    const chipText = (filter: string) => must(rig.el, `[data-filter="${filter}"]`).textContent;
    expect(chipText('all')).toBe(t('hudChrome.reliquary.filterAll'));
    expect(chipText('owned')).toBe(t('hudChrome.reliquary.filterOwned'));
    expect(chipText('missing')).toBe(t('hudChrome.reliquary.filterMissing'));
    expect(must(rig.el, '.reliquary-filterbar').getAttribute('role')).toBe('group');
    expect(must(rig.el, '.reliquary-filterbar').getAttribute('aria-label')).toBe(
      t('hudChrome.reliquary.filterGroupAria'),
    );
    // The shelf list names the shelf it is listing.
    const shelf = makeWindow(baseState(), { nav: 'conquerors' });
    const list = must(shelf.el, '.reliquary-page-list');
    expect(list.tagName).toBe('UL');
    expect(list.getAttribute('role')).toBe('list');
    expect(list.getAttribute('aria-label')).toBe(t('hudChrome.reliquary.navConquerors'));
  });

  it('names the right CAUSE in every empty state', () => {
    // Three different reasons a surface can be empty, three different lines. A
    // player who clicked Catalogued and never typed must not be told their
    // search matched nothing: they would go looking for a search box to clear.
    const emptyText = (el: HTMLElement) => must(el, '.reliquary-empty').textContent;

    // 1. Grid emptied by the CHIP alone, no needle typed.
    const chipOnly = openPage(baseState());
    click(chipOnly.el, '[data-filter="owned"]');
    expect(cells(chipOnly.el)).toHaveLength(0);
    expect(searchField(chipOnly.el).value).toBe('');
    expect(emptyText(chipOnly.el)).toBe(t('hudChrome.reliquary.filterEmpty'));

    // 2. Grid emptied by a SEARCH that matches nothing.
    const gridMiss = openPage(baseState());
    typeSearch(gridMiss.el, 'zzz_no_such_relic');
    expect(cells(gridMiss.el)).toHaveLength(0);
    expect(emptyText(gridMiss.el)).toBe(t('hudChrome.reliquary.searchEmpty'));

    // 3. Shelf list emptied by a search that matches no page AND no relic.
    const shelfMiss = makeWindow(baseState(), { nav: 'conquerors' });
    typeSearch(shelfMiss.el, 'zzz_no_such_page');
    expect(pageIds(shelfMiss.el)).toEqual([]);
    expect(emptyText(shelfMiss.el)).toBe(t('hudChrome.reliquary.searchEmpty'));

    // Search beats the chip when both are engaged: it is the narrowing the
    // player just performed.
    const both = openPage(baseState());
    click(both.el, '[data-filter="owned"]');
    typeSearch(both.el, 'zzz_no_such_relic');
    expect(emptyText(both.el)).toBe(t('hudChrome.reliquary.searchEmpty'));
  });

  it('omits the grid hint entirely when the grid is empty', () => {
    const rig = openPage(baseState());
    click(rig.el, '[data-filter="owned"]');
    expect(cells(rig.el)).toHaveLength(0);
    expect(rig.el.querySelector('#reliquary-grid-hint')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 8. Search filtering
// ---------------------------------------------------------------------------

describe('ReliquaryWindow: search filtering', () => {
  it('narrows the shelf list on a needle that lives only in a page BLURB', () => {
    const rig = makeWindow(baseState(), { nav: 'conquerors' });
    const all = pageIds(rig.el);
    const needle = 'morthen';
    // Premises, so content drift fails loudly rather than making this vacuous:
    // the needle must be absent from the NAME and present in the DESC, which is
    // what makes the row's survival proof that the blurb is searchable.
    expect(reliquaryPageName(PAGE_ID).toLocaleLowerCase(TAG)).not.toContain(needle);
    expect(reliquaryPageDesc(PAGE_ID).toLocaleLowerCase(TAG)).toContain(needle);

    typeSearch(rig.el, needle);
    const shown = pageIds(rig.el);
    expect(shown).toContain(PAGE_ID);
    expect(shown.length).toBeLessThan(all.length);
    const expected = RELIQUARY_PAGES.filter(
      (p) =>
        p.shelf === 'conquerors' &&
        `${reliquaryPageName(p.id)} ${reliquaryPageDesc(p.id)}`
          .toLocaleLowerCase(TAG)
          .includes(needle),
    ).map((p) => p.id);
    expect(shown).toEqual(expected);
  });

  it('narrows an open page grid to the relics whose localized names match', () => {
    const rig = openPage(baseState());
    const ids = relicIds(PAGE_ID);
    const needle = 'cryptbone';
    const expected = ids.filter((id) =>
      reliquaryRelicDisplayName('item', id).toLocaleLowerCase(TAG).includes(needle),
    );
    expect(expected.length, 'content premise: some relic names match').toBeGreaterThan(0);
    expect(expected.length, 'content premise: not all of them do').toBeLessThan(ids.length);

    typeSearch(rig.el, needle);
    expect(cells(rig.el).map((node) => node.dataset.cellId)).toEqual(expected);
  });

  it('treats a whitespace-only needle as no search at all', () => {
    const rig = makeWindow(baseState(), { nav: 'conquerors' });
    const all = pageIds(rig.el);
    typeSearch(rig.el, '   ');
    expect(pageIds(rig.el)).toEqual(all);
    // And the announcement stays silent: a surface that is empty for an
    // unrelated reason must not be described as a narrowed result set.
    expect(liveRegion(rig.el)?.textContent).toBe('');
  });

  it('carries the caret across the rebuild so typing mid-word does not jump', () => {
    const rig = makeWindow(baseState(), { nav: 'conquerors' });
    const before = searchField(rig.el);
    typeSearch(rig.el, 'hollow crypt', [2, 5]);
    const fresh = searchField(rig.el);
    expect(fresh).not.toBe(before);
    expect(document.activeElement).toBe(fresh);
    expect(fresh.value).toBe('hollow crypt');
    // Both ends, not just the start: a rebuild that dropped the range would
    // land the caret at 0 or at the end of the value, never at 2..5.
    expect([fresh.selectionStart, fresh.selectionEnd]).toEqual([2, 5]);
  });

  it('announces the surviving count only while a narrowing control is engaged', () => {
    const rig = makeWindow(baseState(), { nav: 'conquerors' });
    expect(liveRegion(rig.el)?.textContent).toBe('');
    typeSearch(rig.el, 'morthen');
    const count = pageIds(rig.el).length;
    expect(count).toBeGreaterThan(0);
    expect(liveRegion(rig.el)?.textContent).toBe(
      tPlural('hudChrome.plurals.reliquarySearchResults', count, { count: fmt(count) }),
    );
  });

  it('announces the count for the ownership chip too, with no search typed', () => {
    const state = baseState();
    state.itemsDiscovered.add(relicIds(PAGE_ID)[0] ?? '');
    const rig = openPage(state);
    expect(liveRegion(rig.el)?.textContent).toBe('');
    click(rig.el, '[data-filter="owned"]');
    const count = cells(rig.el).length;
    expect(count).toBe(1);
    expect(liveRegion(rig.el)?.textContent).toBe(
      tPlural('hudChrome.plurals.reliquarySearchResults', count, { count: fmt(count) }),
    );
  });

  it('keeps ONE live-region node alive across rebuilds, never re-minting it', () => {
    const rig = makeWindow(baseState(), { nav: 'conquerors' });
    const before = liveRegion(rig.el);
    expect(before, 'the region exists from the first paint').toBeTruthy();

    const markup = captureRawMarkup(rig.el, () => {
      typeSearch(rig.el, 'morthen');
    });
    const raw = markup.at(-1) ?? '';
    expect(raw, 'the painter rebuilds the whole subtree on a keystroke').not.toBe('');
    // A live region must be REGISTERED with the AT before its text changes. A
    // node created and mutated inside the same task does not reliably announce,
    // so the region must not be part of the rebuilt markup at all.
    expect(raw).not.toMatch(/data-reliquary-live/);
    // Node IDENTITY is the real contract, and it is strictly stronger than the
    // old "shipped empty" pin: emitting an empty span into the markup would
    // satisfy that one while still handing the AT a brand-new node each paint.
    const after = liveRegion(rig.el);
    expect(after).toBe(before);
    expect(after?.isConnected, 'still attached after the rebuild').toBe(true);
    expect(after?.textContent).not.toBe('');
  });

  it('re-announces an identical count so a second keystroke is not silent', () => {
    const rig = makeWindow(baseState(), { nav: 'conquerors' });
    typeSearch(rig.el, 'morthen');
    const first = liveRegion(rig.el)?.textContent ?? '';
    expect(first).not.toBe('');
    // A needle that narrows to the SAME count would otherwise leave textContent
    // byte-identical, and an unchanged live region is silent on a screen reader.
    typeSearch(rig.el, 'morthen ');
    const second = liveRegion(rig.el)?.textContent ?? '';
    expect(second).not.toBe(first);
    // The marker is invisible: it must not change how the line READS.
    expect(second.trim()).toBe(first.trim());
  });

  it('goes silent again when Back leaves a page whose chip is still set', () => {
    const state = baseState();
    state.itemsDiscovered.add(relicIds(PAGE_ID)[0] ?? '');
    const rig = openPage(state);
    click(rig.el, '[data-filter="owned"]');
    expect(liveRegion(rig.el)?.textContent).not.toBe('');

    // ownedFilter is sticky for the session, so a gate that read the CHIP would
    // keep announcing a count on the shelf that nothing narrowed, on every
    // slow-band repaint. The gate reads what THIS paint narrowed instead. (The
    // chip row lives inside the page detail, so it is gone from the shelf; its
    // persistence is proven by re-entering the page below.)
    click(rig.el, '[data-back]');
    expect(rig.el.querySelector('.reliquary-filterbar')).toBeNull();
    expect(liveRegion(rig.el)?.textContent).toBe('');
    rig.w.render();
    expect(liveRegion(rig.el)?.textContent).toBe('');

    // Re-entering the page: the chip really did survive, and the announcement
    // comes back with it, so the silence above was the gate and not a reset.
    click(rig.el, `[data-page="${PAGE_ID}"]`);
    expect(must(rig.el, '[data-filter="owned"]').getAttribute('aria-pressed')).toBe('true');
    expect(liveRegion(rig.el)?.textContent).not.toBe('');
  });

  it('does not re-announce an unchanged count on a world-driven repaint', () => {
    const state = baseState();
    state.itemsDiscovered.add(relicIds(PAGE_ID)[0] ?? '');
    const rig = openPage(state);
    click(rig.el, '[data-filter="missing"]');
    const announced = liveRegion(rig.el)?.textContent ?? '';
    expect(announced).not.toBe('');

    // A slow-band signature move while the window sits open (a relic from a
    // DIFFERENT page catalogued, so this grid's count is untouched) repaints,
    // and the marker returns byte-different text for identical input on
    // purpose: writing it here would make the reader re-read "N results." on
    // a world event the player never asked about. The repaint itself is
    // proven by node identity so elision cannot satisfy this vacuously; the
    // player-driven re-mark is the previous test.
    const settled = rig.el.firstElementChild;
    state.itemsDiscovered.add(relicIds('conquerors_sunken_bastion')[0] ?? '');
    rig.w.refreshIfChanged();
    expect(rig.el.firstElementChild, 'the world change must really repaint').not.toBe(settled);
    expect(liveRegion(rig.el)?.textContent).toBe(announced);
  });

  it('announces the Overview strips when a needle narrows them', () => {
    const state = baseState();
    const ids = relicIds(PAGE_ID);
    state.recent.push(ids[0] ?? '', ids[3] ?? '');
    const rig = makeWindow(state, { nav: 'overview' });
    expect(liveRegion(rig.el)?.textContent).toBe('');
    const needle = reliquaryRelicDisplayName('item', ids[0] ?? '').toLocaleLowerCase(TAG);
    typeSearch(rig.el, needle);
    const shown =
      rig.el.querySelectorAll('.reliquary-recent-item').length +
      rig.el.querySelectorAll('.reliquary-nearly-row').length;
    // Premise: something survived, or this compares "0 results." to itself and
    // proves nothing about the announced count.
    expect(shown).toBeGreaterThan(0);
    expect(liveRegion(rig.el)?.textContent).toBe(
      tPlural('hudChrome.plurals.reliquarySearchResults', shown, { count: fmt(shown) }),
    );
  });

  it('clears the search per visit but keeps the chip, shelf, and page for the session', () => {
    const state = baseState();
    state.itemsDiscovered.add(relicIds(PAGE_ID)[0] ?? '');
    const rig = openPage(state);
    click(rig.el, '[data-filter="missing"]');
    typeSearch(rig.el, 'cryptbone');
    expect(searchField(rig.el).value).toBe('cryptbone');

    rig.w.close();
    rig.w.open();
    // A needle typed last visit must not silently hide most of the catalog on
    // the next open; the chip, shelf, and open page read as "where I was" and
    // stay put.
    expect(searchField(rig.el).value).toBe('');
    expect(must(rig.el, '.reliquary-page-title').textContent).toBe(reliquaryPageName(PAGE_ID));
    expect(must(rig.el, '[data-filter="missing"]').getAttribute('aria-pressed')).toBe('true');
    expect(must(rig.el, '[data-nav="conquerors"]').getAttribute('aria-pressed')).toBe('true');
  });

  it('narrows the Overview strips with the same needle', () => {
    const state = baseState();
    const ids = relicIds(PAGE_ID);
    state.recent.push(ids[0] ?? '', ids[3] ?? '');
    const rig = makeWindow(state, { nav: 'overview' });
    expect(rig.el.querySelectorAll('.reliquary-recent-item')).toHaveLength(2);
    const first = reliquaryRelicDisplayName('item', ids[0] ?? '');
    const other = reliquaryRelicDisplayName('item', ids[3] ?? '');
    const needle = first.toLocaleLowerCase(TAG);
    expect(other.toLocaleLowerCase(TAG), 'content premise: the two names differ').not.toContain(
      needle,
    );
    typeSearch(rig.el, needle);
    const chips = [...rig.el.querySelectorAll<HTMLElement>('.reliquary-recent-item')];
    expect(chips.map((c) => c.dataset.recentName)).toEqual([first]);
  });

  it('stays silent when the needle narrows nothing because every row matches', () => {
    const rig = makeWindow(baseState(), { nav: 'conquerors' });
    const all = pageIds(rig.el);
    // A one-letter needle every conquerors page text happens to contain. The
    // premise assertion keeps this honest: if the catalog ever ships a page
    // without an "e", the toEqual below reds and the needle gets re-chosen.
    typeSearch(rig.el, 'e');
    expect(pageIds(rig.el), 'content premise: the needle matches every page').toEqual(all);
    // Nothing was narrowed, so announcing "N results." would be noise about a
    // filter that did not filter.
    expect(liveRegion(rig.el)?.textContent).toBe('');
  });

  it('keeps a shelf row alive on a relic-name match its page text cannot claim', () => {
    const rig = makeWindow(baseState(), { nav: 'conquerors' });
    const needle = 'cryptbone';
    // Premise: no conquerors page can claim the needle with its own text, so
    // the row below can only survive through the deep relic match.
    for (const id of pageIds(rig.el)) {
      expect(
        `${reliquaryPageName(id)} ${reliquaryPageDesc(id)}`.toLocaleLowerCase(TAG),
        `content premise: ${id} page text does not contain the needle`,
      ).not.toContain(needle);
    }
    typeSearch(rig.el, needle);
    expect(pageIds(rig.el)).toContain('conquerors_hollow_crypt');
  });

  it('forgets the reannounce marker when the region clears, so a re-narrowing reads clean', () => {
    const rig = makeWindow(baseState(), { nav: 'conquerors' });
    typeSearch(rig.el, 'morthen');
    const first = liveRegion(rig.el)?.textContent ?? '';
    expect(first).not.toBe('');
    // The clear branch must both empty the region and forget the marker.
    typeSearch(rig.el, '');
    expect(liveRegion(rig.el)?.textContent).toBe('');
    // Re-narrowing to the same count must read as the CLEAN line: a marker
    // that survived the clear would come back with a stray trailing U+00A0,
    // which exact equality with the unmarked tPlural output catches.
    typeSearch(rig.el, 'morthen');
    const count = pageIds(rig.el).length;
    expect(liveRegion(rig.el)?.textContent).toBe(
      tPlural('hudChrome.plurals.reliquarySearchResults', count, { count: fmt(count) }),
    );
  });

  it('defers the rebuild while an IME composition is assembling', () => {
    const rig = makeWindow(baseState(), { nav: 'conquerors' });
    const field = searchField(rig.el);
    const all = pageIds(rig.el);
    field.focus();
    field.value = 'zzz';
    // Mid-composition input: rebuilding here rips the IME's composition
    // session out from under a CJK player on every intermediate candidate.
    const composing = new Event('input', { bubbles: true });
    Object.defineProperty(composing, 'isComposing', { value: true });
    field.dispatchEvent(composing);
    expect(searchField(rig.el), 'no rebuild while composing').toBe(field);
    expect(pageIds(rig.el)).toEqual(all);
    // compositionend commits the composed value through the normal path.
    field.dispatchEvent(new Event('compositionend', { bubbles: true }));
    expect(searchField(rig.el)).not.toBe(field);
    expect(pageIds(rig.el)).toEqual([]);
    expect(searchField(rig.el).value).toBe('zzz');
  });

  it('treats the trailing event after a composition commit as a no-op, in either order', () => {
    const rig = makeWindow(baseState(), { nav: 'conquerors' });
    const field = searchField(rig.el);
    field.focus();
    field.value = 'zzz';
    // Order B host: the final input (isComposing false) lands FIRST and
    // applies the needle...
    field.dispatchEvent(new Event('input', { bubbles: true }));
    const rebuilt = searchField(rig.el);
    expect(rebuilt).not.toBe(field);
    const announced = liveRegion(rig.el)?.textContent ?? '';
    expect(announced).not.toBe('');
    // ...then compositionend fires on the old field with the same committed
    // value. The applier's equality guard must swallow it: a second rebuild
    // would toggle the reannounce marker and the reader would hear the count
    // twice for one commit.
    field.dispatchEvent(new Event('compositionend', { bubbles: true }));
    expect(searchField(rig.el)).toBe(rebuilt);
    expect(liveRegion(rig.el)?.textContent).toBe(announced);
  });

  it('stamps data-cell-source with the RESOLVED line count on exactly the missing hinted cells', () => {
    // The PR shot picker selects on this attribute and now prefers the highest
    // count (scripts/pr_shot_targets), so four things matter: present wherever
    // a plan resolves on a MISSING cell, absent wherever the relic is a
    // content gap, absent on OWNED cells (whose tooltip paints no hunting
    // directions, so a stamped count would promise lines that never render),
    // and carrying the real number in between. The mounts page ships every
    // arm once one hinted mount is owned.
    const page = RELIQUARY_PAGES_BY_ID[UNHINTED_PAGE_ID];
    expect(page, 'content premise: the mounts page exists').toBeTruthy();
    const ownedState = baseState();
    const OWNED_HINTED_MOUNT = 'grag_bear';
    ownedState.mounts = [OWNED_HINTED_MOUNT];
    const rig = openPage(ownedState, UNHINTED_PAGE_ID, 'horizons');
    const grid = cells(rig.el);
    expect(grid.length).toBeGreaterThan(0);
    let withSource = 0;
    let withoutSource = 0;
    let ownedSeen = 0;
    for (const node of grid) {
      const slot = node.dataset.cellId ?? '';
      const relic = page?.relics.find((r) => r.kind === 'mount' && r.mountId === slot);
      expect(relic, `catalog premise: ${slot}`).toBeTruthy();
      const hints = relic && page ? reliquaryRelicSource(page, relic) : [];
      // RESOLVED lines, not authored plans: the painter stamps what the
      // tooltip will really paint, so a plan whose id went stale never
      // inflates the count the shot picker chases.
      const lines = reliquarySourceLinePlan(hints, page?.clearSource)
        .map((plan) => reliquarySourceLineText(plan))
        .filter((line) => line !== '');
      if (slot === OWNED_HINTED_MOUNT) {
        // The owned arm: hints resolve (premise below), yet the cell carries
        // no attribute, matching the tooltip that paints no source lines.
        ownedSeen += 1;
        expect(lines.length, 'premise: the owned mount is genuinely hinted').toBeGreaterThan(0);
        expect(node.dataset.cellOwned, slot).toBe('1');
        expect(node.hasAttribute('data-cell-source'), slot).toBe(false);
        continue;
      }
      if (lines.length > 0) withSource += 1;
      else withoutSource += 1;
      expect(node.hasAttribute('data-cell-source'), slot).toBe(lines.length > 0);
      // The stamped value is the real line count, not a constant "1": the shot
      // picker reads it as a number to find the richest cell.
      expect(node.dataset.cellSource, slot).toBe(
        lines.length > 0 ? String(lines.length) : undefined,
      );
    }
    // Premise: the page really exercises every arm, and at least one cell is
    // genuinely multi-source, so the count pin above is not all ones.
    expect(ownedSeen).toBe(1);
    expect(withSource).toBeGreaterThan(0);
    expect(withoutSource).toBeGreaterThan(0);
    const counts = grid.map((node) => Number(node.dataset.cellSource ?? 0));
    expect(Math.max(...counts), 'content premise: some mount names several doors').toBeGreaterThan(
      1,
    );
  });

  it('never announces on the render that opens the window, even with a sticky chip', () => {
    const state = baseState();
    state.itemsDiscovered.add(relicIds(PAGE_ID)[0] ?? '');
    const rig = openPage(state);
    click(rig.el, '[data-filter="owned"]');
    expect(liveRegion(rig.el)?.textContent).not.toBe('');

    // close() ends the visit: the region's state leaves with it.
    rig.w.close();
    expect(liveRegion(rig.el)?.textContent).toBe('');

    // Reopening paints the same narrowed grid, but the narrowing is state the
    // player left behind, not an action they just performed: announcing it
    // would read out a count nobody asked for.
    rig.w.open();
    expect(must(rig.el, '[data-filter="owned"]').getAttribute('aria-pressed')).toBe('true');
    expect(liveRegion(rig.el)?.textContent).toBe('');

    // The silent open still latched the text: a world-driven repaint with the
    // grid's count unchanged stays silent too.
    state.itemsDiscovered.add(relicIds('conquerors_sunken_bastion')[0] ?? '');
    rig.w.refreshIfChanged();
    expect(liveRegion(rig.el)?.textContent).toBe('');

    // And the next PLAYER narrowing announces normally.
    click(rig.el, '[data-filter="missing"]');
    expect(liveRegion(rig.el)?.textContent).not.toBe('');
  });
});

// ---------------------------------------------------------------------------
// 9. Owned / missing filter chips
// ---------------------------------------------------------------------------

describe('ReliquaryWindow: owned and missing filter chips', () => {
  it('shows only missing cells under the missing chip, and moves the pressed state', () => {
    const state = baseState();
    const ids = relicIds(PAGE_ID);
    state.itemsDiscovered.add(ids[0] ?? '');
    state.itemsDiscovered.add(ids[1] ?? '');
    const rig = openPage(state);
    click(rig.el, '[data-filter="missing"]');
    const shown = cells(rig.el);
    expect(shown).toHaveLength(ids.length - 2);
    expect(shown.every((node) => node.dataset.cellOwned === '0')).toBe(true);
    const missing = must(rig.el, '[data-filter="missing"]');
    expect(missing.getAttribute('aria-pressed')).toBe('true');
    expect(missing.classList.contains('active')).toBe(true);
    expect(must(rig.el, '[data-filter="all"]').getAttribute('aria-pressed')).toBe('false');
    expect(must(rig.el, '[data-filter="owned"]').getAttribute('aria-pressed')).toBe('false');
  });

  it('shows only owned cells under the owned chip', () => {
    const state = baseState();
    const ids = relicIds(PAGE_ID);
    state.itemsDiscovered.add(ids[0] ?? '');
    state.itemsDiscovered.add(ids[1] ?? '');
    const rig = openPage(state);
    click(rig.el, '[data-filter="owned"]');
    const shown = cells(rig.el);
    expect(shown.map((node) => node.dataset.cellId)).toEqual([ids[0], ids[1]]);
    expect(shown.every((node) => node.dataset.cellOwned === '1')).toBe(true);
  });

  it('keeps the header meter on TRUE completion, never the filtered count', () => {
    const state = baseState();
    const ids = relicIds(PAGE_ID);
    state.itemsDiscovered.add(ids[0] ?? '');
    state.itemsDiscovered.add(ids[1] ?? '');
    const rig = openPage(state);
    const trueProgress = t('hudChrome.reliquary.progressText', {
      owned: fmt(2),
      total: fmt(ids.length),
    });
    expect(must(rig.el, '.reliquary-page-progress').textContent).toBe(trueProgress);
    click(rig.el, '[data-filter="missing"]');
    // Three cells are on screen, but the player has still found two of five:
    // a meter that read 0/3 here would be lying about their collection.
    expect(cells(rig.el)).toHaveLength(3);
    expect(must(rig.el, '.reliquary-page-progress').textContent).toBe(trueProgress);
  });

  it('rejects a forged filter value instead of applying it raw', () => {
    const state = baseState();
    state.itemsDiscovered.add(relicIds(PAGE_ID)[0] ?? '');
    const rig = openPage(state);
    click(rig.el, '[data-filter="missing"]');
    expect(cells(rig.el)).toHaveLength(relicIds(PAGE_ID).length - 1);
    // The DOM is the untrusted half of this round trip. An unvalidated cast
    // would carry 'sneaky' into the pure core, where it falls through to the
    // missing branch and leaves no chip pressed at all.
    const chip = must(rig.el, '[data-filter="missing"]');
    chip.dataset.filter = 'sneaky';
    chip.click();
    expect(cells(rig.el)).toHaveLength(relicIds(PAGE_ID).length);
    expect(must(rig.el, '[data-filter="all"]').getAttribute('aria-pressed')).toBe('true');
  });

  it('resets the grid cursor to the front when a chip renumbers the grid', () => {
    const state = baseState();
    const ids = relicIds(PAGE_ID);
    state.itemsDiscovered.add(ids[0] ?? '');
    const rig = openPage(state);
    keydown(cells(rig.el)[0] as HTMLElement, 'End');
    expect(tabStopIndex(rig.el)).toBe(ids.length - 1);
    // Activating the chip moves focus onto the chip (the real click shape), so
    // nothing claims the cursor and the narrowed, renumbered grid starts at the
    // front rather than deep inside a list that is now shorter.
    focusClick(rig.el, '[data-filter="missing"]');
    expect(tabStopIndex(rig.el)).toBe(0);
  });

  it('lets a surviving focused cell keep the cursor over the chip reset', () => {
    const state = baseState();
    const ids = relicIds(PAGE_ID);
    state.itemsDiscovered.add(ids[0] ?? '');
    const rig = openPage(state);
    keydown(cells(rig.el)[0] as HTMLElement, 'End');
    const held = cells(rig.el).at(-1)?.dataset.cellId ?? '';
    // The chip reset and the focus-key restore both fire on this paint. The
    // restore is the more specific rule and has to win: a cursor left at the
    // front while focus sits on the last cell would put the next Tab press
    // somewhere the player is not standing.
    click(rig.el, '[data-filter="missing"]');
    const fresh = must(rig.el, `[data-cell-id="${held}"]`);
    expect(document.activeElement).toBe(fresh);
    expect(tabStopIndex(rig.el)).toBe(cells(rig.el).indexOf(fresh));
  });
});

// ---------------------------------------------------------------------------
// 10. Roving tabindex
// ---------------------------------------------------------------------------

describe('ReliquaryWindow: the roving grid tab stop', () => {
  it('starts with exactly one tab stop, on the first cell', () => {
    const rig = openPage(baseState());
    expect(cells(rig.el).length).toBeGreaterThan(1);
    expect(tabStopIndex(rig.el)).toBe(0);
  });

  it('moves focus and the tab stop together, and claims the key', () => {
    const rig = openPage(baseState());
    const grid = cells(rig.el);
    const event = keydown(grid[0] as HTMLElement, 'ArrowRight');
    expect(event.defaultPrevented, 'a claimed key must not also scroll the page').toBe(true);
    expect(document.activeElement).toBe(grid[1]);
    // Together, not just one: a tab stop left behind on the old cell would put
    // the next Tab press somewhere the player is not looking.
    expect(tabStopIndex(rig.el)).toBe(1);
  });

  it('treats ArrowDown/ArrowUp as one step, the orientation "both" contract', () => {
    const rig = openPage(baseState());
    const grid = cells(rig.el);
    // roving_index owns ArrowDown as NEXT and ArrowUp as PREV for orientation
    // 'both'; it models visible siblings, not grid rows, so neither jumps a row.
    keydown(grid[0] as HTMLElement, 'ArrowDown');
    expect(tabStopIndex(rig.el)).toBe(1);
    expect(document.activeElement).toBe(grid[1]);
    keydown(grid[1] as HTMLElement, 'ArrowUp');
    expect(tabStopIndex(rig.el)).toBe(0);
    expect(document.activeElement).toBe(grid[0]);
  });

  it('jumps to the ends with Home and End', () => {
    const rig = openPage(baseState());
    const grid = cells(rig.el);
    const last = grid.length - 1;
    keydown(grid[0] as HTMLElement, 'End');
    expect(tabStopIndex(rig.el)).toBe(last);
    expect(document.activeElement).toBe(grid[last]);
    keydown(grid[last] as HTMLElement, 'Home');
    expect(tabStopIndex(rig.el)).toBe(0);
    expect(document.activeElement).toBe(grid[0]);
  });

  it('wraps at both edges', () => {
    const rig = openPage(baseState());
    const grid = cells(rig.el);
    const last = grid.length - 1;
    keydown(grid[0] as HTMLElement, 'ArrowLeft');
    expect(tabStopIndex(rig.el)).toBe(last);
    keydown(grid[last] as HTMLElement, 'ArrowRight');
    expect(tabStopIndex(rig.el)).toBe(0);
  });

  it('ignores a key it does not own and never repaints for one it does', () => {
    const rig = openPage(baseState());
    const grid = cells(rig.el);
    const gridNode = must(rig.el, '.reliquary-grid');
    (grid[0] as HTMLElement).focus();
    const ignored = keydown(grid[0] as HTMLElement, 'Enter');
    expect(ignored.defaultPrevented, 'Enter falls through to the activation tail').toBe(false);
    expect(tabStopIndex(rig.el)).toBe(0);
    keydown(grid[0] as HTMLElement, 'ArrowRight');
    // Arrow movement restamps in place: a rebuild here would drop the caret,
    // the scroll offset, and the tooltip wiring on every keypress.
    expect(must(rig.el, '.reliquary-grid')).toBe(gridNode);
    expect(cells(rig.el)[1]).toBe(grid[1]);
  });

  it('keeps the tab stop with the focused cell across a data-driven rebuild', () => {
    // Scope note: the cursor already sits on the End cell BEFORE the rebuild
    // (the keydown wrote gridIndex), so this case proves the stop does not
    // snap back to the front, not that syncGridRoving repointed it. The
    // decisive syncGridRoving pin is the chip-reset restore above, where only
    // the restore can move the cursor off 0.
    const rig = openPage(baseState());
    const grid = cells(rig.el);
    keydown(grid[0] as HTMLElement, 'End');
    const targetId = grid[grid.length - 1]?.dataset.cellId ?? '';
    expect(document.activeElement).toBe(grid[grid.length - 1]);

    rig.state.curatorRank = 3;
    rig.w.refreshIfChanged();
    const fresh = must(rig.el, `[data-cell-id="${targetId}"]`);
    expect(fresh).not.toBe(grid[grid.length - 1]);
    expect(document.activeElement).toBe(fresh);
    // The one tab stop follows the player's last cell instead of snapping back
    // to the front of the grid.
    expect(tabStopIndex(rig.el)).toBe(cells(rig.el).length - 1);
  });

  it('drops focus to Close when the focused cell vanishes, without moving the cursor there', () => {
    const state = baseState();
    const ids = relicIds(PAGE_ID);
    const rig = openPage(state);
    click(rig.el, '[data-filter="missing"]');
    const grid = cells(rig.el);
    keydown(grid[0] as HTMLElement, 'ArrowRight');
    const vanishing = cells(rig.el)[1]?.dataset.cellId ?? '';
    expect(document.activeElement).toBe(cells(rig.el)[1]);

    // Finding the relic removes its cell from a missing-only grid, so the
    // rebuild destroys the control the player is standing on.
    state.itemsDiscovered.add(vanishing);
    rig.w.refreshIfChanged();
    expect(rig.el.querySelector(`[data-cell-id="${vanishing}"]`)).toBeNull();
    const after = document.activeElement as HTMLElement | null;
    expect(after?.hasAttribute('data-close')).toBe(true);
    // The grid keeps exactly one tab stop, and Close is not a grid cell: a
    // fallback restore must not drag the roving cursor out of the grid. The
    // cursor stays clamped exactly where the player left it (index 1 of the
    // renumbered grid), neither dragged to Close nor snapped to the front.
    expect(cells(rig.el)).toHaveLength(ids.length - 1);
    expect(tabStopIndex(rig.el)).toBe(1);
  });

  it('leaves the grid cursor alone when the restore lands on Close by choice', () => {
    const rig = openPage(baseState());
    const grid = cells(rig.el);
    keydown(grid[0] as HTMLElement, 'ArrowRight');
    keydown(cells(rig.el)[1] as HTMLElement, 'ArrowRight');
    expect(tabStopIndex(rig.el)).toBe(2);
    // Focus deliberately parked on Close: syncGridRoving matches on the captured
    // KEY, so a Close restore must leave the cursor where the player left it
    // rather than resetting it to the first cell.
    must(rig.el, '[data-close]').focus();
    rig.state.curatorRank = 2;
    rig.w.refreshIfChanged();
    expect((document.activeElement as HTMLElement | null)?.hasAttribute('data-close')).toBe(true);
    expect(tabStopIndex(rig.el)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 11. Overview flagship: recent jump chips, strip hints, shelf cards
// ---------------------------------------------------------------------------

/** Does the synthetic world own this relic slot? One arm per catalog kind, so
 *  the shelf oracle below never leans on the core it is checking. */
function ownsSlot(state: WorldState, relic: ReliquaryRelicDef): boolean {
  if (relic.kind === 'item') return state.itemsDiscovered.has(relic.itemId);
  if (relic.kind === 'mark') return state.marks.has(relic.markId);
  if (relic.kind === 'mount') return state.mounts.includes(relic.mountId);
  if (relic.kind === 'weapon_skin') return state.weaponSkinIds.includes(relic.skinId);
  return state.deedsEarned.has(relic.deedId);
}

/** owned/total across every LIVE page on one shelf, summed here rather than
 *  read back off the painted rail: a card and the rail agreeing on a number
 *  both got wrong would otherwise pass. */
function shelfAggregate(shelf: string, state: WorldState): { owned: number; total: number } {
  let owned = 0;
  let total = 0;
  for (const page of RELIQUARY_PAGES) {
    if (page.shelf !== shelf) continue;
    for (const relic of page.relics) {
      total += 1;
      if (ownsSlot(state, relic)) owned += 1;
    }
  }
  return { owned, total };
}

const recentChips = (el: HTMLElement): HTMLElement[] => [
  ...el.querySelectorAll<HTMLElement>('.reliquary-recent-item'),
];
const shelfCards = (el: HTMLElement): HTMLElement[] => [
  ...el.querySelectorAll<HTMLElement>('.reliquary-shelf-card'),
];
const textsOf = (el: HTMLElement, selector: string): (string | null)[] =>
  [...el.querySelectorAll<HTMLElement>(selector)].map((node) => node.textContent);

describe('ReliquaryWindow: the recent-find strip jumps to the relic', () => {
  it('jumps to the find OWN page and shelf, not the shelf the player left', () => {
    const state = baseState();
    const id = relicIds(PAGE_ID)[1] ?? '';
    state.recent.push(id);
    state.itemsDiscovered.add(id);
    // Park the window on another shelf first, so the hop below can only land
    // on conquerors by reading the relic's own page rather than sticky state.
    const rig = makeWindow(state, { nav: 'horizons' });
    expect(pageDef(PAGE_ID).shelf, 'content premise: the find lives off Horizons').not.toBe(
      'horizons',
    );
    click(rig.el, '[data-nav="overview"]');

    const chip = must(rig.el, '.reliquary-recent-item');
    expect(chip.tagName).toBe('BUTTON');
    expect(chip.dataset.page).toBe(PAGE_ID);
    const name = reliquaryRelicDisplayName('item', id);
    expect(chip.getAttribute('aria-label')).toBe(t('hudChrome.reliquary.recentJumpAria', { name }));
    // The chip's own tooltip goes through the shared HUD tooltip seam, the same
    // route every other hover surface in this window takes.
    expect(tooltipFor(rig, chip)?.()).toContain(esc(name));

    chip.click();
    expect(must(rig.el, '[data-nav="conquerors"]').getAttribute('aria-pressed')).toBe('true');
    expect(must(rig.el, '[data-nav="horizons"]').getAttribute('aria-pressed')).toBe('false');
    expect(must(rig.el, '.reliquary-page-title').textContent).toBe(reliquaryPageName(PAGE_ID));
    // The grid really painted the page the chip promised.
    expect(cells(rig.el).map((node) => node.dataset.cellId)).toEqual(slotIds(PAGE_ID));
  });

  it('draws an INERT chip for a find no page can claim', () => {
    const stray = 'wire_only_relic';
    // Premise: the catalog genuinely cannot place it, so the inert arm below is
    // the arm under test rather than an accident of a renamed relic.
    expect(
      RELIQUARY_PAGES.some((page) => page.relics.some((relic) => slotId(relic) === stray)),
    ).toBe(false);
    const state = baseState();
    state.recent.push(stray);
    const rig = makeWindow(state, { nav: 'overview' });
    const chip = must(rig.el, '.reliquary-recent-item');
    // A button that navigates nowhere is a broken promise; the chip stays a
    // plain element instead, keeping its icon, its name, and its tooltip.
    expect(chip.tagName).not.toBe('BUTTON');
    expect(chip.hasAttribute('data-page')).toBe(false);
    const name = reliquaryRelicDisplayName('unknown', stray);
    expect(chip.dataset.recentName).toBe(name);
    expect(tooltipFor(rig, chip)?.()).toContain(esc(name));
  });

  it('labels both strips always, and explains each one while it is empty', () => {
    const rig = makeWindow(baseState(), { nav: 'overview' });
    // An Overview whose sections appear only after the first find reads as a
    // broken window: the labels are unconditional and the hints say what will
    // fill them.
    expect(textsOf(rig.el, '.reliquary-strip-label')).toEqual([
      t('hudChrome.reliquary.recentLabel'),
      t('hudChrome.reliquary.nearlyLabel'),
    ]);
    expect(textsOf(rig.el, '.reliquary-strip-hint')).toEqual([
      t('hudChrome.reliquary.recentEmpty'),
      t('hudChrome.reliquary.nearlyEmpty'),
    ]);
  });

  it('drops each hint as soon as its own strip has something to show', () => {
    const state = baseState();
    const ids = relicIds(PAGE_ID);
    // All but the last relic on the page: one find for the ring, and a page one
    // relic short of Illumination for the nearly strip.
    for (const id of ids.slice(0, -1)) state.itemsDiscovered.add(id);
    state.recent.push(ids[0] ?? '');
    const rig = makeWindow(state, { nav: 'overview' });
    // Premise: both strips really painted something.
    expect(recentChips(rig.el).length).toBeGreaterThan(0);
    expect(rig.el.querySelectorAll('.reliquary-nearly-row').length).toBeGreaterThan(0);
    expect(textsOf(rig.el, '.reliquary-strip-hint')).toEqual([]);
    expect(textsOf(rig.el, '.reliquary-strip-label')).toEqual([
      t('hudChrome.reliquary.recentLabel'),
      t('hudChrome.reliquary.nearlyLabel'),
    ]);
  });

  it('explains a strip the needle emptied, and stands aside when the needle emptied both', () => {
    const state = baseState();
    const ids = relicIds(PAGE_ID);
    // One find for the ring, and the page one relic short for the nearly strip.
    for (const id of ids.slice(0, -1)) state.itemsDiscovered.add(id);
    state.recent.push(ids[0] ?? '');
    const rig = makeWindow(state, { nav: 'overview' });
    // 'morthen' lives only in the page BLURB (the premise the shelf-list test
    // pins), so it keeps the nearly row and empties the recent strip: exactly
    // one strip goes empty under a live needle.
    const needle = 'morthen';
    expect(
      reliquaryRelicDisplayName('item', ids[0] ?? '').toLocaleLowerCase(TAG),
      'content premise: the ring find does not match the needle',
    ).not.toContain(needle);
    typeSearch(rig.el, needle);
    expect(recentChips(rig.el)).toHaveLength(0);
    expect(rig.el.querySelectorAll('.reliquary-nearly-row').length).toBeGreaterThan(0);
    // The emptied strip explains itself; the whole-Overview line stays out of
    // it because the other strip still has matches to show.
    expect(textsOf(rig.el, '.reliquary-strip-hint')).toEqual([
      t('hudChrome.reliquary.stripNoMatch'),
    ]);
    expect(rig.el.querySelector('.reliquary-empty')).toBeNull();

    // A needle that empties BOTH strips hands the answer to the shared
    // searchEmpty line: no per-strip hint doubles it.
    typeSearch(rig.el, 'zzz_no_such_relic');
    expect(recentChips(rig.el)).toHaveLength(0);
    expect(rig.el.querySelectorAll('.reliquary-nearly-row')).toHaveLength(0);
    expect(textsOf(rig.el, '.reliquary-strip-hint')).toEqual([]);
    expect(must(rig.el, '.reliquary-empty').textContent).toBe(t('hudChrome.reliquary.searchEmpty'));
  });

  it('composes both structural hints WITH the shared line on a fresh character needle', () => {
    // Row 3 of the hint table, both strips at once: nothing was ever there to
    // match, so each strip keeps its structural hint, and the typed needle
    // still earns the shared acknowledgement. Four statements, all true.
    const rig = makeWindow(baseState(), { nav: 'overview' });
    typeSearch(rig.el, 'zzz_no_such_relic');
    expect(recentChips(rig.el)).toHaveLength(0);
    expect(rig.el.querySelectorAll('.reliquary-nearly-row')).toHaveLength(0);
    expect(textsOf(rig.el, '.reliquary-strip-hint')).toEqual([
      t('hudChrome.reliquary.recentEmpty'),
      t('hudChrome.reliquary.nearlyEmpty'),
    ]);
    expect(must(rig.el, '.reliquary-empty').textContent).toBe(t('hudChrome.reliquary.searchEmpty'));
  });

  it('keeps a structurally empty strip on its own hint while a needle is live', () => {
    // One find in the ring, but the page is nowhere near completion, so the
    // nearly strip is empty with or without a needle. A needle that keeps the
    // recent chip must leave the nearly strip saying what it always says: a
    // "no match" line there would assert a false cause, and clearing the
    // search would swap it for the structural hint it should have kept.
    const state = baseState();
    const ids = relicIds(PAGE_ID);
    const first = ids[0] ?? '';
    state.itemsDiscovered.add(first);
    state.recent.push(first);
    const rig = makeWindow(state, { nav: 'overview' });
    // Premise: the single find does not qualify the page for the nearly strip.
    expect(rig.el.querySelectorAll('.reliquary-nearly-row')).toHaveLength(0);
    expect(textsOf(rig.el, '.reliquary-strip-hint')).toEqual([
      t('hudChrome.reliquary.nearlyEmpty'),
    ]);
    const needle = reliquaryRelicDisplayName('item', first).toLocaleLowerCase(TAG);
    typeSearch(rig.el, needle);
    expect(recentChips(rig.el).length, 'premise: the needle keeps the chip').toBeGreaterThan(0);
    expect(textsOf(rig.el, '.reliquary-strip-hint')).toEqual([
      t('hudChrome.reliquary.nearlyEmpty'),
    ]);
    expect(rig.el.querySelector('.reliquary-empty')).toBeNull();
  });

  it('says once, on the Overview, why the totals do not add up, from the first open', () => {
    // Unconditional on purpose: the shelf denominators disagree with the
    // catalog total at owned 0 already (every shared relic is one catalog row
    // but a slot on each page that shows it), so the fresh Overview needs the
    // reconciliation as much as a veteran's.
    const rig = makeWindow(baseState(), { nav: 'overview' });
    expect(must(rig.el, '.reliquary-uniques-note').textContent).toBe(
      t('hudChrome.reliquary.sharedUniquesNote'),
    );
    // Overview only: the note explains the two numbers where they sit side by
    // side, and would be noise on a page grid.
    const page = openPage(baseState());
    expect(page.el.querySelector('.reliquary-uniques-note')).toBeNull();
  });

  it('gives a nearly row its own mini bar and a localized "to go" readout', () => {
    const state = baseState();
    const ids = relicIds(PAGE_ID);
    for (const id of ids.slice(0, -2)) state.itemsDiscovered.add(id);
    const rig = makeWindow(state, { nav: 'overview' });
    const row = must(rig.el, '.reliquary-nearly-row');
    const owned = ids.length - 2;
    const remaining = ids.length - owned;
    expect(must(row, '.reliquary-to-go').textContent).toBe(
      tPlural('hudChrome.plurals.reliquaryToGo', remaining, { count: fmt(remaining) }),
    );
    expect(must(row, '.reliquary-progress-text').textContent).toBe(
      t('hudChrome.reliquary.progressText', { owned: fmt(owned), total: fmt(ids.length) }),
    );
    expect(must(row, '.reliquary-bar-fill').getAttribute('style')).toBe(
      `--reliquary-fill:${Math.round((owned / ids.length) * 100)}%`,
    );
  });
});

describe('ReliquaryWindow: the Overview shelf cards', () => {
  it('renders exactly three cards, in the rail order, each one a shelf jump', () => {
    const rig = makeWindow(baseState(), { nav: 'overview' });
    const cards = shelfCards(rig.el);
    expect(cards.map((card) => card.dataset.nav)).toEqual([
      'conquerors',
      'professions',
      'horizons',
    ]);
    // Same order the rail lists, minus the virtual Overview entry: a player
    // reading the cards and then the rail sees one catalog, not two.
    expect(
      [...rig.el.querySelectorAll<HTMLElement>('.reliquary-rail [data-nav]')].map(
        (node) => node.dataset.nav,
      ),
    ).toEqual(['overview', 'conquerors', 'professions', 'horizons']);
  });

  it('opens that shelf on a click', () => {
    const rig = makeWindow(baseState(), { nav: 'overview' });
    click(rig.el, '.reliquary-shelf-card[data-nav="horizons"]');
    expect(must(rig.el, '[data-nav="horizons"]').getAttribute('aria-pressed')).toBe('true');
    expect(rig.el.querySelector('.reliquary-shelf-cards')).toBeNull();
    // The shelf really opened: its page list is the painted surface now.
    expect(pageIds(rig.el)).toEqual(
      RELIQUARY_PAGES.filter((page) => page.shelf === 'horizons').map((page) => page.id),
    );
  });

  it('lands keyboard focus on the shelf rail button a card jump opens, not on Close', () => {
    // The card does not survive the rebuild it triggers, so the exact
    // data-focus-key restore finds nothing; the fallback names the destination
    // (the shelf's own rail button) instead of falling through to Close, one
    // Enter press from closing the window the player just asked to open.
    const rig = makeWindow(baseState(), { nav: 'overview' });
    const card = must(rig.el, '.reliquary-shelf-card[data-nav="horizons"]');
    card.focus();
    expect(document.activeElement).toBe(card);
    card.click();
    const after = document.activeElement as HTMLElement | null;
    expect(after?.dataset.focusKey).toBe('nav:horizons');
    expect(after?.hasAttribute('data-close')).toBe(false);
  });

  it('lands keyboard focus on Back after a jump into a page detail', () => {
    const state = baseState();
    const ids = relicIds(PAGE_ID);
    for (const id of ids.slice(0, -1)) state.itemsDiscovered.add(id);
    state.recent.push(ids[0] ?? '');
    const rig = makeWindow(state, { nav: 'overview' });
    // The nearly row and the recent chip both vanish with the Overview they
    // lived on; Back is the control that names where the jump landed.
    const row = must(rig.el, '.reliquary-nearly-row');
    row.focus();
    row.click();
    expect((document.activeElement as HTMLElement | null)?.dataset.focusKey).toBe('back');

    click(rig.el, '[data-back]');
    click(rig.el, '[data-nav="overview"]');
    const chip = must(rig.el, `button.reliquary-recent-item`);
    chip.focus();
    chip.click();
    expect((document.activeElement as HTMLElement | null)?.dataset.focusKey).toBe('back');
  });

  it('carries the shelf pair, its latest find, and a localized open label', () => {
    const state = baseState();
    const id = relicIds(PAGE_ID)[2] ?? '';
    state.recent.push(id);
    state.itemsDiscovered.add(id);
    const rig = makeWindow(state, { nav: 'overview' });
    const card = must(rig.el, '.reliquary-shelf-card[data-nav="conquerors"]');
    const totals = shelfAggregate('conquerors', state);
    expect(totals.owned).toBe(1);
    expect(must(card, '.reliquary-shelf-card-name').textContent).toBe(
      t('hudChrome.reliquary.navConquerors'),
    );
    expect(must(card, '.reliquary-progress-text').textContent).toBe(
      t('hudChrome.reliquary.progressText', {
        owned: fmt(totals.owned),
        total: fmt(totals.total),
      }),
    );
    expect(must(card, '.reliquary-shelf-card-recent').textContent).toBe(
      t('hudChrome.reliquary.shelfRecent', { name: reliquaryRelicDisplayName('item', id) }),
    );
    expect(card.getAttribute('aria-label')).toBe(
      t('hudChrome.reliquary.shelfOpenAria', {
        name: t('hudChrome.reliquary.navConquerors'),
        owned: fmt(totals.owned),
        total: fmt(totals.total),
      }),
    );
    // A shelf the ring never touched AND with nothing owned says so, rather
    // than borrowing the find from the shelf next to it.
    const quiet = must(rig.el, '.reliquary-shelf-card[data-nav="professions"]');
    expect(shelfAggregate('professions', state).owned).toBe(0);
    expect(must(quiet, '.reliquary-shelf-card-recent').textContent).toBe(
      t('hudChrome.reliquary.shelfNoFinds'),
    );
    // The third ternary arm carries the description wiring too: a rendered
    // shelfNoFinds line is described exactly like a rendered find line.
    expect(quiet.getAttribute('aria-describedby')).toBe(
      must(quiet, '.reliquary-shelf-card-recent').id,
    );
    // The latest line is NEW information the aria-label would otherwise
    // replace: the button folds it back in through aria-describedby.
    expect(card.getAttribute('aria-describedby')).toBe(
      must(card, '.reliquary-shelf-card-recent').id,
    );
    expect(must(card, '.reliquary-shelf-card-recent').id).not.toBe('');
  });

  it('says nothing when relics are owned but the ring cannot know the latest', () => {
    // Two real production shapes reach this arm: the Horizons shelf (mounts,
    // skins, and titles never enter the recent ring: pushRecent's only call
    // sites are the item and mark first-finds) and a retro-seeded veteran
    // (owned counts refill silently with NO recent push, per the locked retro
    // policy). "Nothing catalogued yet" would contradict the pair printed
    // above the line, so the card omits the line entirely.
    const state = baseState();
    state.mounts.push(UNHINTED_MOUNT_ID);
    const rig = makeWindow(state, { nav: 'overview' });
    const horizons = must(rig.el, '.reliquary-shelf-card[data-nav="horizons"]');
    const totals = shelfAggregate('horizons', state);
    expect(totals.owned, 'premise: the mount really counts as owned').toBeGreaterThan(0);
    expect(state.recent, 'premise: the ring is empty').toEqual([]);
    expect(horizons.querySelector('.reliquary-shelf-card-recent')).toBeNull();
    expect(horizons.textContent).not.toContain(t('hudChrome.reliquary.shelfNoFinds'));
    // No dangling describedby when the line it points at is not rendered.
    expect(horizons.getAttribute('aria-describedby')).toBeNull();
  });

  it('keeps the latest-find line while a needle narrows the strip above it', () => {
    const state = baseState();
    const ids = relicIds(PAGE_ID);
    state.recent.push(ids[0] ?? '', ids[1] ?? '');
    state.itemsDiscovered.add(ids[0] ?? '');
    state.itemsDiscovered.add(ids[1] ?? '');
    const rig = makeWindow(state, { nav: 'overview' });
    const newest = reliquaryRelicDisplayName('item', ids[1] ?? '');
    const oldest = reliquaryRelicDisplayName('item', ids[0] ?? '');
    // Premise: the needle picks out the OLDER find only, so a card that
    // followed the needle would change its line.
    expect(newest.toLocaleLowerCase(TAG), 'content premise: the two names differ').not.toContain(
      oldest.toLocaleLowerCase(TAG),
    );
    typeSearch(rig.el, oldest.toLocaleLowerCase(TAG));
    expect(recentChips(rig.el).map((chip) => chip.dataset.recentName)).toEqual([oldest]);
    // The card summarizes the SHELF, not the search: it still reads the newest
    // find, which the strip beside it is no longer showing.
    expect(
      must(rig.el, '.reliquary-shelf-card[data-nav="conquerors"] .reliquary-shelf-card-recent')
        .textContent,
    ).toBe(t('hudChrome.reliquary.shelfRecent', { name: newest }));
  });
});

describe('ReliquaryWindow: every bar fill rides the custom property', () => {
  it('writes --reliquary-fill and never an inline width, on every bar it paints', () => {
    const state = baseState();
    const ids = relicIds(PAGE_ID);
    for (const id of ids.slice(0, 2)) state.itemsDiscovered.add(id);
    const rig = openPage(state);
    const fills = [...rig.el.querySelectorAll<HTMLElement>('.reliquary-bar-fill')];
    // Premise: the page really paints several bars (summary and page header at
    // least), so the loop is not vacuous.
    expect(fills.length).toBeGreaterThan(1);
    for (const fill of fills) {
      const style = fill.getAttribute('style') ?? '';
      expect(style).toContain('--reliquary-fill:');
      // The stylesheet owns the geometry now: an inline width would fight the
      // one rule that covers every bar in the window.
      expect(style).not.toContain('width:');
    }
    // And the value is the real percentage, not a constant.
    expect(must(rig.el, '.reliquary-page-bar .reliquary-bar-fill').getAttribute('style')).toBe(
      `--reliquary-fill:${Math.round((2 / ids.length) * 100)}%`,
    );
  });
});

// ---------------------------------------------------------------------------
// 12. Illumination celebration and the fill flash (one-shots, no timers)
// ---------------------------------------------------------------------------

/** The Hud arm exactly: arm both one-shots, then refreshIfChanged (never a bare
 *  render), so what these tests drive is the production sequence. Flash keys
 *  are kind:id (the grid-cell key) exactly as the Hud builds them from the
 *  drain's logs; every relic these drains flash is an item. */
function drainInto(rig: Rig, opts: { flash?: string[]; illuminated?: string | null }): void {
  rig.w.flashRelics((opts.flash ?? []).map((id) => `item:${id}`));
  if (opts.illuminated) rig.w.celebrateIllumination(opts.illuminated);
  rig.w.refreshIfChanged();
}

const section = (el: HTMLElement): HTMLElement => must(el, '.reliquary-page-detail');
const flashed = (el: HTMLElement): string[] =>
  cells(el)
    .filter((node) => node.classList.contains('reliquary-cell-flash'))
    .map((node) => node.dataset.cellId ?? '');

describe('ReliquaryWindow: the Illumination celebration', () => {
  it('celebrates on the paint that fills the page, and only that paint', () => {
    const state = baseState();
    const rig = openPage(state);
    const ids = relicIds(PAGE_ID);
    expect(section(rig.el).classList.contains('reliquary-page-celebrate')).toBe(false);

    for (const id of ids) state.itemsDiscovered.add(id);
    drainInto(rig, { flash: [ids[4] ?? ''], illuminated: PAGE_ID });
    const celebrating = section(rig.el);
    expect(celebrating.classList.contains('reliquary-page-celebrate')).toBe(true);
    // The standing treatment lands in the same paint: the page is complete now
    // and stays framed after the animation is over.
    expect(celebrating.classList.contains('is-illuminated')).toBe(true);

    // One-shot: the next world-driven repaint paints the settled page.
    state.curatorRank += 1;
    rig.w.refreshIfChanged();
    const settled = section(rig.el);
    expect(settled).not.toBe(celebrating);
    expect(settled.classList.contains('reliquary-page-celebrate')).toBe(false);
    expect(settled.classList.contains('is-illuminated')).toBe(true);
  });

  it('holds the moment until the page it belongs to is actually painted', () => {
    // Online the event frame can arrive while the player is on Overview, or a
    // snapshot behind. The id is sticky, so the celebration waits for the paint
    // that shows the page instead of firing at a surface that cannot show it.
    const state = baseState();
    const rig = makeWindow(state, { nav: 'overview' });
    for (const id of relicIds(PAGE_ID)) state.itemsDiscovered.add(id);
    drainInto(rig, { illuminated: PAGE_ID });
    expect(rig.el.querySelector('.reliquary-page-celebrate')).toBeNull();

    click(rig.el, '[data-nav="conquerors"]');
    click(rig.el, `[data-page="${PAGE_ID}"]`);
    expect(section(rig.el).classList.contains('reliquary-page-celebrate')).toBe(true);
    // Still one-shot after the wait: leaving and returning paints it settled.
    click(rig.el, '[data-back]');
    click(rig.el, `[data-page="${PAGE_ID}"]`);
    expect(section(rig.el).classList.contains('reliquary-page-celebrate')).toBe(false);
  });

  it('stays ARMED across a repaint of its OWN page while that page still reads incomplete', () => {
    // The online snapshot-lag shape, on the page itself: the event frame says
    // the page illuminated, the ownership mirror has not caught up, and
    // something else in the same snapshot (rank) makes the refresh genuinely
    // repaint. The gate must check illuminated BEFORE consuming: the swapped
    // order spends the one-shot on this paint and the earned celebration is
    // lost permanently, not merely delayed.
    const state = baseState();
    const ids = relicIds(PAGE_ID);
    for (const id of ids.slice(0, -1)) state.itemsDiscovered.add(id);
    const rig = openPage(state);
    expect(section(rig.el).classList.contains('is-illuminated')).toBe(false);

    drainInto(rig, { illuminated: PAGE_ID });
    state.curatorRank += 1;
    const settled = rig.el.firstElementChild;
    rig.w.refreshIfChanged();
    expect(rig.el.firstElementChild, 'premise: the page really repainted').not.toBe(settled);
    expect(section(rig.el).classList.contains('reliquary-page-celebrate')).toBe(false);

    // The snapshot lands: the celebration the player earned plays now.
    state.itemsDiscovered.add(ids[ids.length - 1] ?? '');
    rig.w.refreshIfChanged();
    const arrived = section(rig.el);
    expect(arrived.classList.contains('is-illuminated')).toBe(true);
    expect(
      arrived.classList.contains('reliquary-page-celebrate'),
      'the moment was held, not spent on the paint that could not show it',
    ).toBe(true);
  });

  it('never celebrates a page other than the one that filled', () => {
    const state = baseState();
    const other = 'conquerors_sunken_bastion';
    const rig = openPage(state, other);
    expect(other).not.toBe(PAGE_ID);
    for (const id of relicIds(PAGE_ID)) state.itemsDiscovered.add(id);
    drainInto(rig, { illuminated: PAGE_ID });
    expect(section(rig.el).classList.contains('reliquary-page-celebrate')).toBe(false);
  });

  it('removes the class on animationend, without a rebuild', () => {
    const state = baseState();
    const rig = openPage(state);
    for (const id of relicIds(PAGE_ID)) state.itemsDiscovered.add(id);
    drainInto(rig, { illuminated: PAGE_ID });
    const node = section(rig.el);
    expect(node.classList.contains('reliquary-page-celebrate')).toBe(true);
    node.dispatchEvent(new Event('animationend', { bubbles: true }));
    // Removal only, in place: the same node settles rather than the window
    // repainting itself on an animation event.
    expect(section(rig.el)).toBe(node);
    expect(node.classList.contains('reliquary-page-celebrate')).toBe(false);
  });

  it('survives the cell flash finishing first (bubbling animationend)', () => {
    // The headline drain composes BOTH one-shots in the same paint: the 1s
    // cell flash ends before the 1.6s page celebration, and animationend
    // bubbles up through the section. Without the target guard the cell's
    // event would strip the page class 0.6s early.
    const state = baseState();
    const rig = openPage(state);
    const ids = relicIds(PAGE_ID);
    for (const id of ids) state.itemsDiscovered.add(id);
    drainInto(rig, { flash: [ids[0] ?? ''], illuminated: PAGE_ID });
    const node = section(rig.el);
    expect(node.classList.contains('reliquary-page-celebrate')).toBe(true);
    const flashCell = must(rig.el, '.reliquary-cell-flash');
    flashCell.dispatchEvent(new Event('animationend', { bubbles: true }));
    expect(node.classList.contains('reliquary-page-celebrate')).toBe(true);
    // The section's own animationend still settles it.
    node.dispatchEvent(new Event('animationend', { bubbles: true }));
    expect(node.classList.contains('reliquary-page-celebrate')).toBe(false);
  });

  it('close() drops an unspent moment instead of replaying it next visit', () => {
    const state = baseState();
    const rig = makeWindow(state, { nav: 'overview' });
    const ids = relicIds(PAGE_ID);
    for (const id of ids) state.itemsDiscovered.add(id);
    // Armed while on Overview, so the one-shot is still pending when the
    // player closes the window without ever visiting the page.
    drainInto(rig, { flash: [ids[0] ?? ''], illuminated: PAGE_ID });
    expect(rig.el.querySelector('.reliquary-page-celebrate')).toBeNull();
    rig.w.close();
    rig.w.open();
    click(rig.el, '[data-nav="conquerors"]');
    click(rig.el, `[data-page="${PAGE_ID}"]`);
    expect(section(rig.el).classList.contains('reliquary-page-celebrate')).toBe(false);
    expect(flashed(rig.el)).toEqual([]);
  });

  it('clears on the next rebuild when animationend never fires (reduced motion)', () => {
    // Under prefers-reduced-motion the stylesheet swaps the animation for a
    // static frame, so animationend never arrives. The class must still not
    // survive: the one-shot is spent, so the next rebuild simply drops it and
    // nothing re-adds it.
    const state = baseState();
    const rig = openPage(state);
    for (const id of relicIds(PAGE_ID)) state.itemsDiscovered.add(id);
    drainInto(rig, { illuminated: PAGE_ID });
    expect(section(rig.el).classList.contains('reliquary-page-celebrate')).toBe(true);
    // A player-driven rebuild, with no animationend anywhere in between.
    click(rig.el, '[data-filter="owned"]');
    expect(section(rig.el).classList.contains('reliquary-page-celebrate')).toBe(false);
    click(rig.el, '[data-filter="all"]');
    expect(section(rig.el).classList.contains('reliquary-page-celebrate')).toBe(false);
  });
});

describe('ReliquaryWindow: the fill flash', () => {
  it('flashes exactly the relics one drain catalogued, on exactly one paint', () => {
    const state = baseState();
    const rig = openPage(state);
    const ids = relicIds(PAGE_ID);
    expect(flashed(rig.el)).toEqual([]);

    const first = ids[1] ?? '';
    state.itemsDiscovered.add(first);
    drainInto(rig, { flash: [first] });
    expect(flashed(rig.el)).toEqual([first]);
    expect(must(rig.el, `[data-cell-id="${first}"]`).dataset.cellOwned).toBe('1');

    // One-shot: any later repaint shows the settled cell.
    state.curatorRank += 1;
    rig.w.refreshIfChanged();
    expect(flashed(rig.el)).toEqual([]);
  });

  it('matches the whole kind:id key, never the bare id', () => {
    // Slot ids are un-namespaced across kinds, so the flash key carries the
    // kind: a mark-keyed arming must not light an item cell that happens to
    // share the id.
    const state = baseState();
    const rig = openPage(state);
    const id = relicIds(PAGE_ID)[1] ?? '';
    state.itemsDiscovered.add(id);
    rig.w.flashRelics([`mark:${id}`]);
    rig.w.refreshIfChanged();
    // The paint happened (the fill shows) but the wrong-kind key flashed nothing.
    expect(must(rig.el, `[data-cell-id="${id}"]`).dataset.cellOwned).toBe('1');
    expect(flashed(rig.el)).toEqual([]);
  });

  it('replaces the previous drain instead of accumulating ids', () => {
    const state = baseState();
    const rig = openPage(state);
    const ids = relicIds(PAGE_ID);
    const first = ids[0] ?? '';
    const second = ids[3] ?? '';
    // Two drains with NO paint in between (the first refresh elides, the online
    // snapshot-lag case): if the armed ids were unioned instead of replaced,
    // this is the only sequence where the older one could survive to the paint.
    const settled = rig.el.firstElementChild;
    drainInto(rig, { flash: [first] });
    expect(rig.el.firstElementChild, 'premise: the first drain really elided').toBe(settled);

    state.itemsDiscovered.add(second);
    drainInto(rig, { flash: [second] });
    // A flash means "this just happened", so the newest drain is the whole
    // answer: the earlier relic must not light up alongside it.
    expect(flashed(rig.el)).toEqual([second]);
  });

  it('waits for the paint that shows the fill when the refresh elides', () => {
    // Online the event can land a snapshot ahead of the mirror, so the refresh
    // elides. The armed flash must survive that and ride the paint that finally
    // shows the relic, rather than being spent on nothing.
    const state = baseState();
    const rig = openPage(state);
    const id = relicIds(PAGE_ID)[2] ?? '';
    const settled = rig.el.firstElementChild;
    drainInto(rig, { flash: [id] });
    expect(rig.el.firstElementChild, 'premise: the refresh really elided').toBe(settled);
    state.itemsDiscovered.add(id);
    rig.w.refreshIfChanged();
    expect(flashed(rig.el)).toEqual([id]);
  });

  it('close() drops a flash that never found a paint to spend it', () => {
    // The companion of the celebration's close() case, armed so that NOTHING
    // paints before the close: the drain's refresh elides (the snapshot-lag
    // shape above), so the set is still pending when the window closes. A
    // reopen after the relic is catalogued must paint it settled, not replay
    // a stale fanfare minutes later.
    const state = baseState();
    const rig = openPage(state);
    const id = relicIds(PAGE_ID)[2] ?? '';
    const settled = rig.el.firstElementChild;
    drainInto(rig, { flash: [id] });
    expect(rig.el.firstElementChild, 'premise: the arming refresh really elided').toBe(settled);
    rig.w.close();
    state.itemsDiscovered.add(id);
    rig.w.open();
    click(rig.el, '[data-nav="conquerors"]');
    click(rig.el, `[data-page="${PAGE_ID}"]`);
    expect(must(rig.el, `[data-cell-id="${id}"]`).dataset.cellOwned).toBe('1');
    expect(flashed(rig.el), 'a stale moment must not replay as a fanfare').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 13. Elided polls copy nothing (the two ownership Sets)
// ---------------------------------------------------------------------------

describe('ReliquaryWindow: an elided poll touches no ownership seam', () => {
  it('reads ownedMounts and the account skins ONCE per real repaint, never on an elided poll', () => {
    const state = baseState();
    const rig = openPage(state);
    // The open render already paid for its copies; the polls below are what a
    // player standing still costs.
    state.reads = { ownedMounts: 0, weaponSkinIds: 0 };
    rig.w.refreshIfChanged();
    rig.w.refreshIfChanged();
    // Zero, not "few": the slow band builds an input on every poll, and copying
    // the mount list plus the account skin list on a poll that paints nothing
    // is pure waste. The signature path asks the world directly instead.
    expect(state.reads).toEqual({ ownedMounts: 0, weaponSkinIds: 0 });

    state.curatorRank += 1;
    rig.w.refreshIfChanged();
    expect(state.reads).toEqual({ ownedMounts: 1, weaponSkinIds: 1 });
    // And a second settled poll after the repaint costs nothing again.
    rig.w.refreshIfChanged();
    expect(state.reads).toEqual({ ownedMounts: 1, weaponSkinIds: 1 });
  });

  it('still hands the view REAL ownership sets on the repaint', () => {
    // The cheap half is only correct if the paint still sees the seams: a
    // window that elided by never reading them would show an owned mount as a
    // silhouette forever.
    const state = baseState();
    const owned = 'grag_bear';
    const rig = openPage(state, UNHINTED_PAGE_ID, 'horizons');
    expect(must(rig.el, `[data-cell-id="${owned}"]`).dataset.cellOwned).toBe('0');
    state.mounts = [owned];
    // Rig artifact, not a missing signature dimension: the stub's
    // reliquaryCatalogCompletion is a hand-set literal, so the rank bump
    // stands in for the owned-count move a real mount fill makes on both
    // hosts (catalogRelicCompletion counts mounts in the same surfaces).
    state.curatorRank += 1;
    rig.w.refreshIfChanged();
    expect(must(rig.el, `[data-cell-id="${owned}"]`).dataset.cellOwned).toBe('1');
  });
});

// ---------------------------------------------------------------------------
// 12. The HUD-tracker pin control (shelf rows + the page-detail header)
// ---------------------------------------------------------------------------

describe('pinning a page to the HUD tracker', () => {
  /** The shelf-row pin button for one page. */
  const pinButton = (el: HTMLElement, pageId: string): HTMLElement =>
    must(el, `.reliquary-pin[data-pin="${pageId}"]`);

  /** The exact production key this rig's stub world produces, spelled out rather
   *  than rebuilt from the module's prefix: the untrusted-storage arms below seed
   *  the store BEFORE the window reads it, which only tests anything if the key
   *  they write is the one the window will look under. */
  const PIN_KEY = 'woc_reliquary_pins_warrior_Testwright';

  /** Live Conquerors page ids in catalog order. Real ids, so a seeded pin is one
   *  the catalog can resolve; a fabricated id would be indistinguishable from a
   *  pin the loader correctly refused. */
  const shelfPageIds = RELIQUARY_PAGES.filter((p) => p.shelf === 'conquerors').map((p) => p.id);

  it('renders the pin control as a SIBLING of the row, never nested inside it', () => {
    // A button inside a button is invalid markup and unreachable to a keyboard:
    // the row IS a button, so the pin has to be its sibling in the listitem.
    const rig = makeWindow(baseState(), { nav: 'conquerors' });
    const pin = pinButton(rig.el, PAGE_ID);
    expect(pin.closest('.reliquary-page-row')).toBeNull();
    expect(pin.parentElement?.classList.contains('reliquary-page-item')).toBe(true);
    expect(pin.getAttribute('aria-pressed')).toBe('false');
  });

  it('flips aria-pressed and exposes the page through ReliquaryWindow.pinned', () => {
    const rig = makeWindow(baseState(), { nav: 'conquerors' });
    expect([...rig.w.pinned]).toEqual([]);
    pinButton(rig.el, PAGE_ID).click();
    expect([...rig.w.pinned]).toEqual([PAGE_ID]);
    expect(pinButton(rig.el, PAGE_ID).getAttribute('aria-pressed')).toBe('true');
    // The accessible name flips with it, so a screen reader hears what the
    // second press will DO, not what the first one did.
    expect(pinButton(rig.el, PAGE_ID).getAttribute('aria-label')).toBe(
      t('hudChrome.reliquary.unpinAria', { name: reliquaryPageName(PAGE_ID) }),
    );
    pinButton(rig.el, PAGE_ID).click();
    expect([...rig.w.pinned]).toEqual([]);
    expect(pinButton(rig.el, PAGE_ID).getAttribute('aria-pressed')).toBe('false');
  });

  it('nudges the HUD tracker on an accepted toggle so the strip never lags the button', () => {
    const rig = makeWindow(baseState(), { nav: 'conquerors' });
    const before = rig.counts.pinChanged;
    pinButton(rig.el, PAGE_ID).click();
    expect(rig.counts.pinChanged).toBe(before + 1);
    pinButton(rig.el, PAGE_ID).click();
    expect(rig.counts.pinChanged).toBe(before + 2);
  });

  it('refuses an add at the cap visibly: aria-disabled, still a tab stop, and says why', () => {
    const rig = makeWindow(baseState(), { nav: 'conquerors' });
    const shelfPages = RELIQUARY_PAGES.filter((p) => p.shelf === 'conquerors');
    expect(
      shelfPages.length,
      'content premise: the Conquerors shelf holds more pages than the pin cap',
    ).toBeGreaterThan(RELIQUARY_TRACK_CAP);
    for (const page of shelfPages.slice(0, RELIQUARY_TRACK_CAP)) {
      pinButton(rig.el, page.id).click();
    }
    expect(rig.w.pinned.size).toBe(RELIQUARY_TRACK_CAP);
    const extra = shelfPages[RELIQUARY_TRACK_CAP];
    const refused = pinButton(rig.el, extra.id) as HTMLButtonElement;
    // aria-disabled, never native disabled: the control keeps its tab stop, so
    // a keyboard player still reaches the refusal instead of tabbing past a
    // control that silently vanished from the order.
    expect(refused.disabled).toBe(false);
    expect(refused.getAttribute('aria-disabled')).toBe('true');
    // The accessible NAME stays the action (label-in-name: it contains the
    // visible "Pin" label); the refusal rides aria-describedby to the shared
    // cap note, never a native title attribute (this window's rule), so it is
    // the same string in every locale.
    expect(refused.getAttribute('aria-label')).toBe(
      t('hudChrome.reliquary.pinAria', { name: reliquaryPageName(extra.id) }),
    );
    expect(refused.getAttribute('aria-describedby')).toBe('reliquary-pin-cap-note');
    expect(rig.el.querySelector('#reliquary-pin-cap-note')?.textContent).toBe(
      t('hudChrome.reliquary.pinFull', { cap: fmt(RELIQUARY_TRACK_CAP) }),
    );
    expect(refused.hasAttribute('title')).toBe(false);
    // The note is ONE node and keeps its clip-only class across the paints
    // that got the window here: visible cap prose on every open would be the
    // regression the class loss causes.
    expect(rig.el.querySelectorAll('#reliquary-pin-cap-note')).toHaveLength(1);
    expect(
      rig.el.querySelector('#reliquary-pin-cap-note')?.classList.contains('visually-hidden'),
    ).toBe(true);
    const capText = t('hudChrome.reliquary.pinFull', { cap: fmt(RELIQUARY_TRACK_CAP) });
    // The region does not carry the refusal yet, so the announce below is
    // provably the click's own doing.
    expect(liveRegion(rig.el)?.textContent ?? '').not.toContain(capText);
    const nudges = rig.counts.pinChanged;
    const stored = localStorage.getItem(PIN_KEY);
    refused.click();
    expect(rig.w.pinned.size).toBe(RELIQUARY_TRACK_CAP);
    expect(rig.counts.pinChanged).toBe(nudges);
    // "Nothing to persist" is literal: the refusal writes no storage.
    expect(localStorage.getItem(PIN_KEY)).toBe(stored);
    // A reachable control that answers a click with nothing reads as broken,
    // so the refused activation announces through the polite region (the
    // reannounce marker may pad the text; the payload must be present).
    const firstAnnounce = liveRegion(rig.el)?.textContent ?? '';
    expect(firstAnnounce).toContain(capText);
    // A SECOND identical refusal must still re-announce: byte-identical live
    // text is silent to a reader, which is the one reason the write goes
    // through the reannounce marker instead of a plain assignment.
    refused.click();
    const secondAnnounce = liveRegion(rig.el)?.textContent ?? '';
    expect(secondAnnounce).toContain(capText);
    expect(secondAnnounce).not.toBe(firstAnnounce);
    // An UNPIN at the cap still works, which is what makes the cap navigable.
    pinButton(rig.el, shelfPages[0].id).click();
    expect(rig.w.pinned.size).toBe(RELIQUARY_TRACK_CAP - 1);
    const freed = pinButton(rig.el, extra.id) as HTMLButtonElement;
    expect(freed.hasAttribute('aria-disabled')).toBe(false);
    expect(freed.hasAttribute('aria-describedby')).toBe(false);
    // And with no at-cap control on this paint, the shared note goes EMPTY:
    // the clip-only class keeps it in the accessibility tree, and browse mode
    // must not read a false full state.
    expect(rig.el.querySelector('#reliquary-pin-cap-note')?.textContent).toBe('');
  });

  it('persists the pins per character across window instances', () => {
    const state = baseState();
    const first = makeWindow(state, { nav: 'conquerors' });
    pinButton(first.el, PAGE_ID).click();
    first.w.close();
    document.body.innerHTML = '';

    const second = makeWindow(state, { nav: 'conquerors' });
    expect([...second.w.pinned]).toEqual([PAGE_ID]);
    expect(pinButton(second.el, PAGE_ID).getAttribute('aria-pressed')).toBe('true');
    // Per CHARACTER: the key carries class and name, so another character on
    // the same browser starts with an empty strip.
    expect(localStorage.getItem('woc_reliquary_pins_warrior_Testwright')).toBe(
      JSON.stringify([PAGE_ID]),
    );
    expect(localStorage.getItem('woc_reliquary_pins_mage_Testwright')).toBeNull();
  });

  it('retires an illuminated page from the store and the markup', () => {
    // The pin control is what releases a pinned page, and an illuminated page
    // does not render one: without the prune the slot would be wedged forever.
    const state = baseState();
    const rig = makeWindow(state, { nav: 'conquerors' });
    pinButton(rig.el, PAGE_ID).click();
    expect([...rig.w.pinned]).toEqual([PAGE_ID]);

    // Fill the page for real, through the same ownership seams the game fills
    // them through, so the facet and the painted row agree it is illuminated.
    for (const relic of pageDef(PAGE_ID).relics) {
      switch (relic.kind) {
        case 'item':
          state.itemsDiscovered.add(relic.itemId);
          break;
        case 'mark':
          state.marks.add(relic.markId);
          break;
        case 'mount':
          state.mounts.push(relic.mountId);
          break;
        case 'weapon_skin':
          state.weaponSkinIds.push(relic.skinId);
          break;
        case 'title':
          state.deedsEarned.set(relic.deedId, '2026-01-01');
          break;
      }
    }
    const nudges = rig.counts.pinChanged;
    rig.w.render();
    expect([...rig.w.pinned]).toEqual([]);
    expect(rig.el.querySelector(`.reliquary-pin[data-pin="${PAGE_ID}"]`)).toBeNull();
    // The row itself is still there (illuminated, badged), so this is the pin
    // control retiring, not the page vanishing.
    expect(rig.el.querySelector(`[data-page="${PAGE_ID}"]`)).not.toBeNull();
    // The prune's other two effects, each independently droppable with the
    // suite otherwise green: the shrunk set is PERSISTED (the doc comment's
    // "in memory or in storage" guarantee), and the HUD tracker is nudged so
    // the strip does not lag the retirement by a whole slow band.
    expect(localStorage.getItem(PIN_KEY)).toBe('[]');
    expect(rig.counts.pinChanged).toBe(nudges + 1);
  });

  it('keeps the pins working in-session when persisting throws (private mode)', () => {
    const rig = makeWindow(baseState(), { nav: 'conquerors' });
    const before = rig.counts.pinChanged;
    // Spy on the INSTANCE: happy-dom's localStorage does not dispatch setItem
    // through a shared Storage.prototype, so a prototype spy never fires (the
    // first draft of this test proved that by passing vacuously).
    const denied = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'QuotaExceededError');
    });
    try {
      pinButton(rig.el, PAGE_ID).click();
      // The write was really attempted: a debounced or flag-gated persist
      // would leave this test green while exercising nothing.
      expect(denied).toHaveBeenCalled();
      // The toggle still lands in memory and the strip still gets nudged
      // EXACTLY once; an uncaught throw would leave the count unmoved. Only
      // the cross-session copy is lost, which is all private mode can offer.
      expect([...rig.w.pinned]).toEqual([PAGE_ID]);
      expect(rig.counts.pinChanged).toBe(before + 1);
    } finally {
      denied.mockRestore();
    }
    // Outside the finally (an assert in there would supersede a real failure
    // from the try body), and behavioral: the restored store really stores.
    localStorage.setItem('woc_restore_probe', '1');
    expect(localStorage.getItem('woc_restore_probe')).toBe('1');
    localStorage.removeItem('woc_restore_probe');
  });

  it('keeps focus on the pin control across the repaint its own click triggers', () => {
    const rig = makeWindow(baseState(), { nav: 'conquerors' });
    focusClick(rig.el, `.reliquary-pin[data-pin="${PAGE_ID}"]`);
    const focused = document.activeElement as HTMLElement | null;
    expect(focused?.dataset.focusKey).toBe(`pin:${PAGE_ID}`);
    // Not the exact same NODE (innerHTML replaced it), which is exactly why the
    // key-based restore has to exist.
    expect(focused?.getAttribute('aria-pressed')).toBe('true');
  });

  it('offers the same control on the page-detail header', () => {
    const rig = openPage(baseState());
    const header = must(rig.el, '.reliquary-page-header');
    const pin = must(header, `.reliquary-pin[data-pin="${PAGE_ID}"]`);
    expect(pin.getAttribute('aria-pressed')).toBe('false');
    pin.click();
    expect([...rig.w.pinned]).toEqual([PAGE_ID]);
    // One page, one pin control per paint: the shelf list and a page detail are
    // mutually exclusive surfaces, so the focus key stays unique.
    expect(rig.el.querySelectorAll(`[data-focus-key="pin:${PAGE_ID}"]`).length).toBe(1);
  });

  it('retires the pin control from an illuminated page DETAIL too', () => {
    // A separate arm from the shelf retirement above, not a restatement of it:
    // the row passes page.complete and the detail header passes page.illuminated,
    // two fields off two different models, so one call site can lose the flag
    // while the other keeps it. The detail is also the surface a player reaches
    // by finishing the page they were reading, so a pin left here would hand back
    // the one control the prune assumes has already gone.
    const state = baseState();
    // Fill the page through the same ownership seams the game fills them
    // through, so the facet and the painted detail agree it is illuminated.
    for (const relic of pageDef(PAGE_ID).relics) {
      switch (relic.kind) {
        case 'item':
          state.itemsDiscovered.add(relic.itemId);
          break;
        case 'mark':
          state.marks.add(relic.markId);
          break;
        case 'mount':
          state.mounts.push(relic.mountId);
          break;
        case 'weapon_skin':
          state.weaponSkinIds.push(relic.skinId);
          break;
        case 'title':
          state.deedsEarned.set(relic.deedId, '2026-01-01');
          break;
      }
    }
    const rig = openPage(state);
    // Premise: this really is the illuminated page's detail surface, so the
    // missing button below cannot be a missing PAGE.
    const detail = must(rig.el, '.reliquary-page-detail');
    expect(detail.classList.contains('is-illuminated')).toBe(true);
    expect(must(rig.el, '.reliquary-page-header').querySelector('.reliquary-pin')).toBeNull();
    expect(rig.el.querySelector(`.reliquary-pin[data-pin="${PAGE_ID}"]`)).toBeNull();
  });

  // Stored pins are UNTRUSTED input. Nothing between another tab, an older build
  // with a different cap, or a hand-edited value and the strip but the loader:
  // the pin BUTTON enforces the cap and the id on the way in, and a stored set
  // never passes through it. Each arm below seeds the real key BEFORE the window
  // reads it and opens with `open: false`, so no paint (and no catalog-unknown
  // prune) can stand in for a load the loader should have refused itself.

  it('truncates an oversized stored pin list to the cap', () => {
    const oversized = shelfPageIds.slice(0, RELIQUARY_TRACK_CAP + 3);
    expect(
      oversized.length,
      'content premise: the Conquerors shelf holds more pages than the cap, so this is oversized',
    ).toBe(RELIQUARY_TRACK_CAP + 3);
    localStorage.setItem(PIN_KEY, JSON.stringify(oversized));
    const rig = makeWindow(baseState(), { open: false });
    // The FIRST cap ids, in the stored order: pin order is display order, so a
    // truncation that kept the tail would silently reshuffle the strip.
    expect([...rig.w.pinned]).toEqual(oversized.slice(0, RELIQUARY_TRACK_CAP));
  });

  it('resets to empty for a stored value that is not an array', () => {
    // Positive control first, because an empty answer is what a WRONG KEY looks
    // like too: seed the same key with a valid list and watch it load, so the
    // two refusals below are refusals rather than a store nobody ever read.
    localStorage.setItem(PIN_KEY, JSON.stringify([PAGE_ID]));
    expect([...makeWindow(baseState(), { open: false }).w.pinned]).toEqual([PAGE_ID]);
    document.body.innerHTML = '';

    // Two corrupt shapes, because they fail at different points: a value that
    // PARSES to a non-array (an older shape, or another key's value) has to be
    // refused by the shape check, and one that does not parse at all has to be
    // caught rather than thrown at whichever paint asked for the pins.
    localStorage.setItem(PIN_KEY, '{"nope":1}');
    expect([...makeWindow(baseState(), { open: false }).w.pinned]).toEqual([]);
    document.body.innerHTML = '';
    localStorage.setItem(PIN_KEY, 'not json at all');
    expect([...makeWindow(baseState(), { open: false }).w.pinned]).toEqual([]);
  });

  it('skips a non-string element and still loads the ids around it', () => {
    // Per element, not per list: a partially corrupt array must not cost the
    // player the pins that are fine. The 42 is fabricated on purpose, because
    // what is under test is the element's TYPE and no page id could carry that;
    // the ids around it are live, so what survives is a real load.
    const [first, second] = shelfPageIds;
    localStorage.setItem(PIN_KEY, JSON.stringify([first, 42, second]));
    const rig = makeWindow(baseState(), { open: false });
    expect([...rig.w.pinned]).toEqual([first, second]);
  });

  it('re-reads the store when the character changes under one window instance', () => {
    // The HUD keeps ONE ReliquaryWindow for the session, so a character switch
    // has to move the pin set with it. A loader that latched on the first key
    // would leave the new character wearing the old one's strip, and then
    // persist that strip onto whichever key it last read.
    const state = baseState();
    const other = { playerClass: 'mage', name: 'Otherwright' };
    // Disjoint seeds under both keys: neither answer below can be produced by
    // reading the wrong store, and an empty set is not an answer either.
    localStorage.setItem(PIN_KEY, JSON.stringify([PAGE_ID]));
    localStorage.setItem(
      `woc_reliquary_pins_${other.playerClass}_${other.name}`,
      JSON.stringify([UNHINTED_PAGE_ID]),
    );
    const rig = makeWindow(state, { open: false });
    expect([...rig.w.pinned]).toEqual([PAGE_ID]);
    state.identity = other;
    expect([...rig.w.pinned]).toEqual([UNHINTED_PAGE_ID]);
    // And back, because a loader that re-read exactly once and then latched
    // passes the switch above on its own.
    state.identity = { playerClass: 'warrior', name: 'Testwright' };
    expect([...rig.w.pinned]).toEqual([PAGE_ID]);
  });
});

// ---------------------------------------------------------------------------
// 11. The display-only SECOND clear meter, and the outside-completion chips
// ---------------------------------------------------------------------------

describe('ReliquaryWindow: the S-rank second clear meter', () => {
  // The live page that authors a secondaryClearSource. Asserted as a premise so
  // a content move fails loudly here instead of making both arms vacuous.
  const RIFT_PAGE_ID = 'conquerors_the_rift';

  it('paints the S-rank line from the deed counter block', () => {
    const def = pageDef(RIFT_PAGE_ID);
    expect(
      def.secondaryClearSource?.stat,
      'content premise: the Rift page names the S counter',
    ).toBe('riftSRankClears');
    const state = baseState();
    state.counters = { riftSRankClears: 7 };
    const rig = openPage(state, RIFT_PAGE_ID);
    const meters = [...rig.el.querySelectorAll<HTMLElement>('[data-secondary-clears]')];
    expect(meters).toHaveLength(1);
    // Live t() call, never hardcoded English: a locale fill must not red this.
    expect(meters[0]?.textContent).toBe(
      t('hudChrome.reliquary.srankClearsLabel', { count: fmt(7) }),
    );
  });

  it('renders the meter as zero, without throwing, when the world has NO counters block', () => {
    // The default stub omits deedStats.counters entirely, which is the shape a
    // host that has not mirrored the facet really presents. This path executes
    // today; it must degrade to 0 rather than throw mid-paint.
    const state = baseState();
    expect(state.counters).toBeUndefined();
    const rig = openPage(state, RIFT_PAGE_ID);
    const meters = [...rig.el.querySelectorAll<HTMLElement>('[data-secondary-clears]')];
    expect(meters).toHaveLength(1);
    expect(meters[0]?.textContent).toBe(
      t('hudChrome.reliquary.srankClearsLabel', { count: fmt(0) }),
    );
  });

  it('paints NO second meter on a page that authors no secondaryClearSource', () => {
    const state = baseState();
    state.counters = { riftSRankClears: 7 };
    const rig = openPage(state, PAGE_ID);
    expect(pageDef(PAGE_ID).secondaryClearSource).toBeUndefined();
    expect(rig.el.querySelectorAll('[data-secondary-clears]')).toHaveLength(0);
  });
});

describe('ReliquaryWindow: the outside-completion chips', () => {
  const VAULT_PAGE_ID = 'horizons_vault_of_ages';
  const RIFTBOUND_PAGE_ID = 'horizons_riftbound';

  it('wears the Retired chip on the vault shelf row AND its page header', () => {
    expect(pageDef(VAULT_PAGE_ID).excludeFromCompletion).toBe('retired');
    const rig = makeWindow(baseState(), { nav: 'horizons' });
    // Shelf row first, before any navigation. The compound query pins the
    // selector reach (class + hook on one element); the bare-attribute count
    // beside it keeps a STRAY hook without the badge class from hiding on
    // the flagged page (the two counts must always agree).
    const rowChips = [
      ...rig.el.querySelectorAll<HTMLElement>('.reliquary-complete-badge[data-retired]'),
    ];
    expect(rowChips).toHaveLength(1);
    expect(rig.el.querySelectorAll('[data-retired]')).toHaveLength(1);
    expect(rowChips[0]?.textContent).toBe(t('hudChrome.reliquary.retiredLabel'));
    // Then the page header, on the same live window (bare count mirrored so
    // a stray hook cannot hide on this surface either).
    click(rig.el, `[data-page="${VAULT_PAGE_ID}"]`);
    const headerChips = [
      ...rig.el.querySelectorAll<HTMLElement>('.reliquary-complete-badge[data-retired]'),
    ];
    expect(headerChips).toHaveLength(1);
    expect(rig.el.querySelectorAll('[data-retired]')).toHaveLength(1);
    expect(headerChips[0]?.textContent).toBe(t('hudChrome.reliquary.retiredLabel'));
  });

  it('wears the Personal chip on the riftbound row AND its page header, never the Retired word', () => {
    expect(pageDef(RIFTBOUND_PAGE_ID).excludeFromCompletion).toBe('personal');
    const rig = makeWindow(baseState(), { nav: 'horizons' });
    const row = must(rig.el, `[data-page="${RIFTBOUND_PAGE_ID}"]`);
    const chip = row.querySelector<HTMLElement>('.reliquary-complete-badge[data-personal]');
    expect(chip, 'the riftbound shelf row carries the personal chip').toBeTruthy();
    expect(chip?.textContent).toBe(t('hudChrome.reliquary.personalLabel'));
    // The two reasons never wear each other's word: this row carries no
    // data-retired hook, and the vault row (same paint) carries no personal one.
    expect(row.querySelector('[data-retired]')).toBeNull();
    const vaultRow = must(rig.el, `[data-page="${VAULT_PAGE_ID}"]`);
    expect(vaultRow.querySelector('[data-personal]')).toBeNull();
    // Then the page header, on the same live window (the vault arm's mirror,
    // bare count included so a stray personal hook cannot hide either).
    click(rig.el, `[data-page="${RIFTBOUND_PAGE_ID}"]`);
    const headerChips = [
      ...rig.el.querySelectorAll<HTMLElement>('.reliquary-complete-badge[data-personal]'),
    ];
    expect(headerChips).toHaveLength(1);
    expect(rig.el.querySelectorAll('[data-personal]')).toHaveLength(1);
    expect(headerChips[0]?.textContent).toBe(t('hudChrome.reliquary.personalLabel'));
    expect(rig.el.querySelectorAll('[data-retired]')).toHaveLength(0);
  });

  it('paints no chip at all on an ordinary page', () => {
    const rig = openPage(baseState(), PAGE_ID);
    expect(pageDef(PAGE_ID).excludeFromCompletion).toBeUndefined();
    expect(rig.el.querySelectorAll('[data-retired]')).toHaveLength(0);
    expect(rig.el.querySelectorAll('[data-personal]')).toHaveLength(0);
  });

  it('a full-holding veteran illuminates the vault WITH the Retired chip still on the header', () => {
    // The one paint where .reliquary-page-detail.is-illuminated and the
    // Retired chip coexist (the vault deliberately still illuminates,
    // pinned sim-side): the gold-frame opt-out rules in components.css key
    // on exactly this DOM state, and no other test produces it. The chip
    // must carry BOTH the badge class and the reason hook here, or the
    // opt-out selector cannot reach it and the chip inherits the
    // celebratory frame this page must never wear.
    const state = baseState();
    for (const relic of pageDef(VAULT_PAGE_ID).relics) {
      if (relic.kind === 'item') state.itemsDiscovered.add(relic.itemId);
    }
    const rig = openPage(state, VAULT_PAGE_ID, 'horizons');
    const detail = must(rig.el, '.reliquary-page-detail');
    expect(detail.classList.contains('is-illuminated')).toBe(true);
    const chip = detail.querySelector<HTMLElement>('.reliquary-complete-badge[data-retired]');
    expect(chip, 'the illuminated vault header keeps its Retired chip').toBeTruthy();
    expect(chip?.textContent).toBe(t('hudChrome.reliquary.retiredLabel'));
  });
});

// ---------------------------------------------------------------------------
// Phase 22: realm population rarity (tooltip line, aria composition, page
// header line). The aggregate arrives through the fetch-per-open
// reliquaryRarity() read; null (the default state, the offline Sim, and every
// failure arm) must render NOTHING, so all of the suites above double as the
// no-rarity byte-identity proof.
// ---------------------------------------------------------------------------

describe('population rarity', () => {
  /** Land the fetched aggregate: flush the microtask then drive the slow
   *  band. The landing only stores the aggregate and moves the refresh
   *  signature (rarityGen); the NEXT refreshIfChanged paints it through the
   *  normal world-driven path, so these tests drive exactly that. */
  const landRarity = async (rig: Rig): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    rig.w.refreshIfChanged();
  };

  const rarityPercent = (fraction: number): string =>
    formatNumber(fraction, { style: 'percent', maximumFractionDigits: 1 });

  /** Rarity for the Hollow Crypt page: relic 0 found by 3 of 200, the page
   *  illuminated by 5 of 200; every OTHER id is deliberately absent (the
   *  zero-found endpoint contract) so sibling cells prove the per-id gate. */
  function seededState(): { state: WorldState; relicId: string } {
    const relic = pageDef(PAGE_ID).relics[0];
    if (!relic || relic.kind !== 'item') {
      throw new Error(`content premise: ${PAGE_ID} keeps a first ITEM relic slot`);
    }
    const state = baseState();
    state.rarity = {
      totalEligible: 200,
      found: { [relic.itemId]: 3, 'slain:old_greyjaw': 2 },
      illuminated: { [PAGE_ID]: 5 },
    };
    return { state, relicId: relic.itemId };
  }

  it('a missing relic tooltip gains the rarity line and the aria composes it', async () => {
    const { state, relicId } = seededState();
    const rig = openPage(state, PAGE_ID);
    await landRarity(rig);
    const node = must(rig.el, `[data-cell-id="${relicId}"]`);
    expect(node.dataset.cellOwned).toBe('0');
    const line = t('hudChrome.reliquary.rarityLine', { percent: rarityPercent(3 / 200) });
    const html = tooltipFor(rig, node)?.() ?? '';
    expect(html).toContain(`<div class="tt-line">${esc(line)}</div>`);
    // The aria mirrors through the ONE composition key: base sentence first,
    // rarity second, the key owning the punctuation between them.
    const aria = node.getAttribute('aria-label') ?? '';
    expect(aria).toContain(line);
    expect(aria.endsWith(line)).toBe(true);
    expect(aria.startsWith(reliquaryRelicDisplayName('item', relicId))).toBe(true);
  });

  it('a sibling cell whose id is absent from the aggregate renders NO rarity line', async () => {
    const { state, relicId } = seededState();
    const rig = openPage(state, PAGE_ID);
    await landRarity(rig);
    const other = pageDef(PAGE_ID).relics[1];
    if (!other || other.kind !== 'item') {
      throw new Error(`content premise: ${PAGE_ID} keeps a second ITEM relic slot`);
    }
    // Positive control on the SAME paint: the seeded sibling shows the line,
    // so the absent-id assertions below discriminate the per-id gate rather
    // than a feature that never rendered at all.
    const seededHtml = tooltipFor(rig, must(rig.el, `[data-cell-id="${relicId}"]`))?.() ?? '';
    expect((seededHtml.match(/of collectors/g) ?? []).length).toBe(1);
    const node = must(rig.el, `[data-cell-id="${other.itemId}"]`);
    const html = tooltipFor(rig, node)?.() ?? '';
    // Absent-from-map is the zero-found wire shape AND the skin/title/mount
    // shape (the server never counts those kinds), so this arm is the whole
    // "no data means no node" contract for a live aggregate.
    expect(html).not.toContain('of collectors');
    const aria = node.getAttribute('aria-label') ?? '';
    expect(aria).not.toContain('of collectors');
  });

  it('mount and weapon-skin cells render no rarity line even with a live aggregate', async () => {
    // The aggregate never counts possession-based or account-scoped kinds
    // (the ReliquaryRarity facet doc): a mount cell keys on the MOUNT id, not
    // the reins item id, so nothing in the maps can match it. Pin one real
    // cell per kind rather than arguing by equivalence to "absent id".
    const { state } = seededState();
    const rig = openPage(state, UNHINTED_PAGE_ID, 'horizons');
    await landRarity(rig);
    const mountNode = must(rig.el, `[data-cell-id="${UNHINTED_MOUNT_ID}"]`);
    expect(tooltipFor(rig, mountNode)?.() ?? '').not.toContain('of collectors');
    // A real weapon-skin slot from the live catalog, wherever it lives.
    let skinPage: string | null = null;
    let skinId: string | null = null;
    for (const page of RELIQUARY_PAGES_BY_ID ? Object.values(RELIQUARY_PAGES_BY_ID) : []) {
      const skin = page.relics.find((r) => r.kind === 'weapon_skin');
      if (skin && skin.kind === 'weapon_skin') {
        skinPage = page.id;
        skinId = skin.skinId;
        break;
      }
    }
    if (skinPage === null || skinId === null) {
      throw new Error('content premise: the catalog keeps at least one weapon-skin slot');
    }
    const rig2 = makeWindow(seededState().state, { open: false });
    rig2.w.openWithPage(skinPage);
    await landRarity(rig2);
    const skinNode = must(rig2.el, `[data-cell-id="${skinId}"]`);
    expect(tooltipFor(rig2, skinNode)?.() ?? '').not.toContain('of collectors');
  });

  // The tooltip/label agreement contract in reliquary_window.ts says every
  // fact the tooltip gains, the aria gains in the same change. The
  // account-scope badge is the one non-source, non-count tooltip line, so a
  // keyboard or screen-reader player must hear it too.
  it('a weapon-skin cell carries the account-scope fact in its aria, not hover-only', () => {
    let skinPage: string | null = null;
    let skinId: string | null = null;
    for (const page of RELIQUARY_PAGES_BY_ID ? Object.values(RELIQUARY_PAGES_BY_ID) : []) {
      const skin = page.relics.find((r) => r.kind === 'weapon_skin');
      if (skin && skin.kind === 'weapon_skin') {
        skinPage = page.id;
        skinId = skin.skinId;
        break;
      }
    }
    if (skinPage === null || skinId === null) {
      throw new Error('content premise: the catalog keeps at least one weapon-skin slot');
    }
    const badge = t('hudChrome.reliquary.accountScopeBadge');
    const rig = makeWindow(baseState(), { open: false });
    rig.w.openWithPage(skinPage);
    const skinNode = must(rig.el, `[data-cell-id="${skinId}"]`);
    const skinAria = skinNode.getAttribute('aria-label') ?? '';
    // The tooltip carries it (the premise this test guards parity against).
    expect(tooltipFor(rig, skinNode)?.() ?? '').toContain(badge);
    expect(skinAria).toContain(badge);
    // Composed through the key, which owns the punctuation: the whole base
    // sentence (name plus its store source hint) leads, the scope follows.
    const skinLines = sourceLinesFor(skinPage, relicIndex(skinPage, skinId));
    expect(
      skinLines.length,
      'content premise: a weapon skin lists its store route',
    ).toBeGreaterThan(0);
    expect(skinAria).toBe(
      t('hudChrome.reliquary.cellAriaWithAccountScope', {
        base: t('hudChrome.reliquary.cellMissingSourceAria', {
          name: reliquaryRelicDisplayName('weapon_skin', skinId),
          source: joinSourceLines(skinLines),
        }),
        scope: badge,
      }),
    );
    // Negative control on a DIFFERENT kind, so the assertion above
    // discriminates the weapon-skin arm rather than a badge glued to every
    // cell: an item relic's label must not carry the account-scope fact.
    const itemRig = openPage(baseState(), PAGE_ID);
    const itemRelic = pageDef(PAGE_ID).relics[0];
    if (!itemRelic || itemRelic.kind !== 'item') {
      throw new Error(`content premise: ${PAGE_ID} keeps a first ITEM relic slot`);
    }
    const itemNode = must(itemRig.el, `[data-cell-id="${itemRelic.itemId}"]`);
    expect(itemNode.getAttribute('aria-label') ?? '').not.toContain(badge);
  });

  it('an OWNED item relic keeps the rarity line on the full-item-tooltip branch', async () => {
    const { state, relicId } = seededState();
    state.itemsDiscovered.add(relicId);
    const rig = openPage(state, PAGE_ID);
    await landRarity(rig);
    const node = must(rig.el, `[data-cell-id="${relicId}"]`);
    expect(node.dataset.cellOwned).toBe('1');
    const html = tooltipFor(rig, node)?.() ?? '';
    // The owned item arm REPLACES the plain body with the full item tooltip
    // (an early return), so a rarity line appended only to the plain body
    // would vanish exactly here; the line must follow the item tooltip stub.
    expect(html).toContain(`data-item-tooltip="${relicId}"`);
    const line = t('hudChrome.reliquary.rarityLine', { percent: rarityPercent(3 / 200) });
    expect(html).toContain(`<div class="tt-line">${esc(line)}</div>`);
    expect(html.indexOf(esc(line))).toBeGreaterThan(html.indexOf(`data-item-tooltip="${relicId}"`));
  });

  it('an owned MARK cell carries the rarity line on the plain-body arm', async () => {
    const state = baseState();
    state.rarity = {
      totalEligible: 200,
      found: { 'slain:old_greyjaw': 2 },
      illuminated: {},
    };
    state.marks.add('slain:old_greyjaw');
    const rig = openPage(state, 'conquerors_rares_of_the_realm');
    await landRarity(rig);
    const node = must(rig.el, '[data-cell-id="slain:old_greyjaw"]');
    expect(node.dataset.cellOwned).toBe('1');
    const line = t('hudChrome.reliquary.rarityLine', { percent: rarityPercent(2 / 200) });
    const html = tooltipFor(rig, node)?.() ?? '';
    expect(html).toContain(`<div class="tt-line">${esc(line)}</div>`);
    const aria = node.getAttribute('aria-label') ?? '';
    expect(aria.endsWith(line)).toBe(true);
  });

  it('the page header shows the illumination line only for a counted page', async () => {
    const { state } = seededState();
    const rig = openPage(state, PAGE_ID);
    await landRarity(rig);
    const node = must(rig.el, '.reliquary-page-rarity');
    expect(node.textContent).toBe(
      t('hudChrome.reliquary.pageRarityLine', { percent: rarityPercent(5 / 200) }),
    );
    // A page absent from the illuminated map (nobody has illuminated it, the
    // permanent Riftbound state) renders NO node, never a zero line.
    const other = openPage(seededState().state, MULTI_SOURCE_PAGE_ID);
    await landRarity(other);
    expect(other.el.querySelector('.reliquary-page-rarity')).toBeNull();
  });

  it('a null aggregate renders no rarity nodes anywhere (the offline arm)', async () => {
    const state = baseState();
    expect(state.rarity).toBeNull();
    const rig = openPage(state, PAGE_ID);
    await landRarity(rig);
    expect(rig.el.querySelector('.reliquary-page-rarity')).toBeNull();
    const relic = pageDef(PAGE_ID).relics[0];
    const relicId = relic?.kind === 'item' ? relic.itemId : '';
    const node = must(rig.el, `[data-cell-id="${relicId}"]`);
    const html = tooltipFor(rig, node)?.() ?? '';
    expect(html).not.toContain('of collectors');
  });

  it('the landing paint never re-announces the result count (world-driven path)', async () => {
    // close() keeps the ownership chip for the session, so a reopen onto a
    // filtered page is the reachable shape where a player-driven landing
    // would have announced "N relics" out of nowhere (the live-region
    // discipline the fresh review flagged). The band paint is world-driven
    // and the text is unchanged, so the region must stay silent.
    const { state } = seededState();
    const rig = openPage(state, PAGE_ID);
    await landRarity(rig);
    click(rig.el, '[data-filter="missing"]');
    rig.w.close();
    rig.w.open();
    const live = liveRegion(rig.el);
    expect(live?.textContent ?? '').toBe('');
    await landRarity(rig);
    expect(must(rig.el, '.reliquary-page-rarity').textContent).toContain('of collectors');
    expect(live?.textContent ?? '').toBe('');
  });

  it('the landing paint keeps focus on a deep-linked page header', async () => {
    // A cold openWithPage parks the reading position on the page header; the
    // fetch lands moments later and rebuilds the window. The header carries a
    // focus key exactly so this rebuild restores the position instead of
    // dropping a keyboard player onto Close.
    const { state } = seededState();
    const rig = makeWindow(state, { open: false });
    rig.w.openWithPage(PAGE_ID);
    const headerBefore = must(rig.el, '.reliquary-page-header');
    expect(document.activeElement).toBe(headerBefore);
    await landRarity(rig);
    const headerAfter = must(rig.el, '.reliquary-page-header');
    expect(document.activeElement).toBe(headerAfter);
    expect(must(rig.el, '.reliquary-page-rarity').textContent).toContain('of collectors');
  });

  it('a response landing after close is dropped, and a reopen fetch wins a race', async () => {
    // Late landing: the guard drops a response that resolves after close.
    const { state } = seededState();
    const rig = openPage(state, PAGE_ID);
    rig.w.close();
    await Promise.resolve();
    await Promise.resolve();
    expect((rig.w as unknown as { rarity: unknown }).rarity).toBeNull();
    // Reopen: close() kept the page, so the fresh fetch lands on it normally.
    rig.w.open();
    await landRarity(rig);
    expect(must(rig.el, '.reliquary-page-rarity').textContent).toContain('of collectors');
  });
});
