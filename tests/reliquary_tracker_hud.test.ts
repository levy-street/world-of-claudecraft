// @vitest-environment happy-dom

// Behavioral pin for Hud.updateReliquaryTracker(), the one seam between the
// live world and the always-on #reliquary-tracker strip. The pure core is
// covered in tests/reliquary_tracker_view.test.ts and the painter's DOM
// contract in tests/reliquary_tracker_painter.test.ts, which left the method
// that FEEDS them both unpinned end to end: nothing said the persisted collapse
// setting reaches the view, nothing said the compact-touch chip flag needs BOTH
// body classes, and nothing said a pinned page really travels from the window's
// store into a tracker line.
//
// The rig is the reliquary_unlock_chat_link.test.ts one: Object.create over the
// real Hud.prototype with only the fields this method touches assigned onto the
// instance, so the assertions run the shipped code rather than a copy of it.
// The tracker view is the REAL reused container (makeReliquaryTrackerView), the
// container-reuse contract being what makes the immediate-assert style below
// necessary: the painter is handed the same object every build, so a captured
// reference is never a snapshot.
//
// The stub world is SIM-SHAPED (the offline shapes: a Map of earned deeds, an
// ownedMounts() call, live Sets), which the online mirror matches member for
// member (the IWorld parity pin); the one online-only state this rig also
// drives is the COLD mirror (the last describe below): before the first
// snapshot lands, ClientWorld answers with every surface empty and every
// completion() null, and the method must produce the hidden strip, not a
// throw.

import { beforeEach, describe, expect, it } from 'vitest';
import { RELIQUARY_PAGES_BY_ID } from '../src/sim/content/reliquary';
import { Hud } from '../src/ui/hud';
import { reliquaryPageName } from '../src/ui/reliquary_i18n';
import {
  makeReliquaryTrackerView,
  type ReliquaryTrackerView,
} from '../src/ui/reliquary_tracker_view';
import type { ReliquaryPageCompletion } from '../src/world_api/reliquary';

// A LIVE catalog page, so the pin travels the same road a player's pin does.
const PINNED_PAGE = 'conquerors_gravewyrm_sanctum';
// Deliberately not this page's real relic count: the assertion below proves the
// numbers came from the stubbed completion read, not from the content table.
const OWNED = 3;
const TOTAL = 7;
// Two more live pages, for the nothing-pinned default ranking. Real ids because
// the default scan walks RELIQUARY_PAGE_ORDER: a fabricated id would simply
// never be asked about.
const CANDIDATE_A = 'conquerors_hollow_crypt';
const CANDIDATE_B = 'professions_field_notes';

/** Page progress the stubbed completion read answers from. */
type Progress = Record<string, { owned: number; total: number }>;

interface TrackerHarness {
  sim: {
    reliquaryPageCompletion(pageId: string): ReliquaryPageCompletion | null;
    deedStats: { itemsDiscovered: Set<string> };
    reliquaryMarks: Set<string>;
    // A Map, the shape both real worlds expose (deed id to earned date). Only
    // .size is read here, but a Set would misteach the contract to the next
    // reader of this rig.
    deedsEarned: Map<string, string>;
    ownedMounts(): string[];
    accountCosmetics: { weaponSkinIds: string[] };
  };
  optionsHooks: {
    settings: { get(key: string): unknown; set(key: string, value: unknown): void };
  };
  reliquaryWindow: { pinned: Set<string> };
  reliquaryTrackerView: ReliquaryTrackerView;
  reliquaryTrackerPainter: { update(view: ReliquaryTrackerView): void };
  updateReliquaryTracker(): void;
}

interface TrackerRig {
  hud: TrackerHarness;
  /** The settings bag the persisted collapse row is read out of. */
  settings: Record<string, unknown>;
  /** Every view the painter was handed, in call order (same container each time). */
  painted: ReliquaryTrackerView[];
  /** Live page progress: a test moves this the way a relic drain moves it. */
  progress: Progress;
  /** The mount keys ownedMounts() answers with (one ownership surface). */
  mounts: string[];
  /** How often the method asked for each read whose cost the design bounds. */
  counts: { ownedMounts: number };
}

function makeRig(): TrackerRig {
  const hud = Object.create(Hud.prototype) as unknown as TrackerHarness;
  const settings: Record<string, unknown> = {};
  const painted: ReliquaryTrackerView[] = [];
  // Only the pinned page starts with progress: every other catalog page reads
  // as absent, so the nothing-pinned default scan finds nothing and cannot
  // quietly supply the line a pin assertion is looking for.
  const progress: Progress = { [PINNED_PAGE]: { owned: OWNED, total: TOTAL } };
  const mounts: string[] = [];
  const counts = { ownedMounts: 0 };
  hud.optionsHooks = {
    settings: {
      get: (key) => settings[key],
      set: (key, value) => {
        settings[key] = value;
      },
    },
  };
  hud.sim = {
    reliquaryPageCompletion: (pageId) => {
      const p = progress[pageId];
      if (!p) return null;
      // complete mirrors production exactly (sim pageCompletion: owned === total).
      return { owned: p.owned, total: p.total, complete: p.total > 0 && p.owned === p.total };
    },
    deedStats: { itemsDiscovered: new Set<string>() },
    reliquaryMarks: new Set<string>(),
    deedsEarned: new Map<string, string>(),
    ownedMounts: () => {
      counts.ownedMounts++;
      return mounts;
    },
    accountCosmetics: { weaponSkinIds: [] },
  };
  hud.reliquaryWindow = { pinned: new Set<string>() };
  hud.reliquaryTrackerView = makeReliquaryTrackerView();
  hud.reliquaryTrackerPainter = {
    update: (view) => {
      painted.push(view);
    },
  };
  return { hud, settings, painted, progress, mounts, counts };
}

/** The page ids the strip is actually showing, in display order. */
const shown = (view: ReliquaryTrackerView): string[] =>
  view.lines.slice(0, view.count).map((line) => line.pageId);

beforeEach(() => {
  document.body.className = '';
  // Content premise: a page rename would leave every pin assertion below
  // passing over a page the player can never actually pin.
  for (const pageId of [PINNED_PAGE, CANDIDATE_A, CANDIDATE_B]) {
    if (!RELIQUARY_PAGES_BY_ID[pageId]) {
      throw new Error(`content premise: ${pageId} is a live Reliquary page`);
    }
  }
});

describe('Hud.updateReliquaryTracker: the persisted collapse', () => {
  it('carries the reliquaryTrackerCollapsed setting into the painted view, both ways', () => {
    // Both arms are driven: a method that hardcoded either value would pass a
    // single-arm test, and the collapsed arm is the one the painter uses to
    // skip the whole row loop.
    const { hud, settings, painted } = makeRig();
    hud.reliquaryWindow.pinned.add(PINNED_PAGE);

    settings.reliquaryTrackerCollapsed = true;
    hud.updateReliquaryTracker();
    expect(painted).toHaveLength(1);
    expect(painted[0].collapsed).toBe(true);

    settings.reliquaryTrackerCollapsed = false;
    hud.updateReliquaryTracker();
    expect(painted[1].collapsed).toBe(false);

    // The reuse contract, and the reason each assertion above sits directly
    // after its own call: the painter is handed ONE container for the session.
    expect(painted[1]).toBe(painted[0]);
    expect(painted[0]).toBe(hud.reliquaryTrackerView);
  });

  it('falls back to expanded when no setting has ever been stored', () => {
    const { hud, painted } = makeRig();
    hud.reliquaryWindow.pinned.add(PINNED_PAGE);
    hud.updateReliquaryTracker();
    expect(painted[0].collapsed).toBe(false);
  });
});

describe('Hud.updateReliquaryTracker: the compact-touch chip flag', () => {
  // All four combinations, because the flag is an AND and either half alone is
  // a real HUD state: a landscape phone carries mobile-touch without the
  // compact tier, and the compact class is set from viewport size alone.
  const CASES: { classes: string[]; chip: boolean }[] = [
    { classes: [], chip: false },
    { classes: ['mobile-touch'], chip: false },
    { classes: ['hud-mobile-compact'], chip: false },
    { classes: ['mobile-touch', 'hud-mobile-compact'], chip: true },
  ];

  for (const { classes, chip } of CASES) {
    const label = classes.length > 0 ? classes.join(' plus ') : 'neither class';
    it(`sets chip ${String(chip)} with ${label} on the body`, () => {
      const { hud, painted } = makeRig();
      hud.reliquaryWindow.pinned.add(PINNED_PAGE);
      for (const cls of classes) document.body.classList.add(cls);
      hud.updateReliquaryTracker();
      expect(painted[0].chip).toBe(chip);
    });
  }

  it('re-reads the body on every build, so leaving the compact tier drops the chip', () => {
    // The flag is not latched anywhere: a rotation or a resize has to be able
    // to hand the header its disclosure role back on the very next slow band.
    const { hud, painted } = makeRig();
    hud.reliquaryWindow.pinned.add(PINNED_PAGE);
    document.body.classList.add('mobile-touch', 'hud-mobile-compact');
    hud.updateReliquaryTracker();
    expect(painted[0].chip).toBe(true);
    document.body.classList.remove('hud-mobile-compact');
    hud.updateReliquaryTracker();
    expect(painted[1].chip).toBe(false);
  });
});

describe('Hud.updateReliquaryTracker: the window pin store', () => {
  it('puts a page pinned in the Reliquary window onto the strip with its live progress', () => {
    const { hud, painted } = makeRig();
    hud.reliquaryWindow.pinned.add(PINNED_PAGE);
    hud.updateReliquaryTracker();

    const view = painted[0];
    expect(view.visible).toBe(true);
    expect(view.count).toBe(1);
    expect(view.lines[0].pageId).toBe(PINNED_PAGE);
    // The numbers are the stubbed completion read's, not the catalog's, so the
    // pin proves the completion callback is wired rather than merely present.
    expect(view.lines[0].owned).toBe(OWNED);
    expect(view.lines[0].total).toBe(TOTAL);
    // And the id the painter will label with really resolves through the
    // reliquary_i18n channel instead of falling back to the raw id.
    expect(reliquaryPageName(view.lines[0].pageId)).not.toBe(PINNED_PAGE);
  });

  it('shows nothing at all while the store is empty (no default page qualifies)', () => {
    // The negative half: without it the pin assertion above could be satisfied
    // by a strip that shows this page whether or not anyone pinned it.
    const { hud, painted } = makeRig();
    hud.updateReliquaryTracker();
    expect(painted[0].count).toBe(0);
    expect(painted[0].visible).toBe(false);
  });

  it('re-reads the pin set REFERENCE every build, not a captured one', () => {
    // Production reassigns ReliquaryWindow.pinnedSet to a NEW Set on every
    // accepted toggle and on every prune, so the reused-input drive must
    // refresh input.pinned per build. Mutating one shared Set (like every
    // other test here) cannot tell a live re-read from a stale capture; only
    // a wholesale replacement can, and dropping the refresh line freezes the
    // strip at whatever was pinned when the input was first minted.
    const rig = makeRig();
    rig.hud.reliquaryWindow.pinned.add(PINNED_PAGE);
    rig.hud.updateReliquaryTracker();
    expect(shown(rig.painted[0])).toEqual([PINNED_PAGE]);
    rig.progress[CANDIDATE_A] = { owned: 1, total: 8 };
    rig.hud.reliquaryWindow.pinned = new Set([CANDIDATE_A]);
    rig.hud.updateReliquaryTracker();
    expect(shown(rig.painted[1])).toEqual([CANDIDATE_A]);
  });
});

describe('Hud.updateReliquaryTracker: the ownership signature feed', () => {
  // Five surfaces fold into a page's owned count, and the default scan re-runs
  // only when the signature this method feeds moves. The source pins in
  // tests/reliquary_tracker_view.test.ts name each line; this is the behavioral
  // half, which survives a rename: drop any ONE surface from the feed and the
  // strip holds a stale ranking straight through the fill that should have
  // re-ranked it.
  const SURFACES: { name: string; move(rig: TrackerRig): void }[] = [
    {
      name: 'itemsDiscovered',
      move: (rig) => rig.hud.sim.deedStats.itemsDiscovered.add('some_relic'),
    },
    { name: 'marks', move: (rig) => rig.hud.sim.reliquaryMarks.add('some_mark') },
    { name: 'deedsEarned', move: (rig) => rig.hud.sim.deedsEarned.set('some_deed', '2026-01-01') },
    { name: 'mounts', move: (rig) => rig.mounts.push('some_mount') },
    { name: 'weaponSkins', move: (rig) => rig.hud.sim.accountCosmetics.weaponSkinIds.push('skin') },
  ];

  it('re-ranks the nothing-pinned default rows when ANY single surface moves', () => {
    for (const surface of SURFACES) {
      // A fresh rig per surface: the memo is per container, so a rig reused
      // across surfaces would carry the previous one's signature into the next.
      const rig = makeRig();
      // A is one relic from Illumination, B is four away: fewest remaining wins.
      rig.progress[CANDIDATE_A] = { owned: 9, total: 10 };
      rig.progress[CANDIDATE_B] = { owned: 16, total: 20 };
      rig.hud.updateReliquaryTracker();
      expect(shown(rig.painted[0]), surface.name).toEqual([CANDIDATE_A, CANDIDATE_B]);

      // The find lands on B: now also one away, and at the higher fraction, so
      // the two have to trade places. The progress read alone cannot cause that
      // (the default scan is memoized); only the moved surface reaching the
      // signature releases the memo.
      rig.progress[CANDIDATE_B] = { owned: 19, total: 20 };
      surface.move(rig);
      rig.hud.updateReliquaryTracker();
      expect(shown(rig.painted[1]), surface.name).toEqual([CANDIDATE_B, CANDIDATE_A]);
    }
  });
});

describe('Hud.updateReliquaryTracker: the lazy ownership signature', () => {
  it('skips the bags-plus-bank mount read entirely while the player has pins', () => {
    // Sim.ownedMounts() copies bags plus bank before scanning it, and only the
    // nothing-pinned branch consults the signature it feeds. A pinned player
    // pays nothing for it, on a surface that rebuilds every 500ms for the whole
    // session.
    const rig = makeRig();
    rig.hud.reliquaryWindow.pinned.add(PINNED_PAGE);
    rig.hud.updateReliquaryTracker();
    rig.hud.updateReliquaryTracker();
    expect(rig.counts.ownedMounts).toBe(0);

    // And the other arm, or "lazy" could just mean "dropped": the default
    // branch still gathers the signature, once per build, or its memo would
    // freeze on whatever ranking it first computed.
    rig.hud.reliquaryWindow.pinned.clear();
    rig.hud.updateReliquaryTracker();
    expect(rig.counts.ownedMounts).toBe(1);
    rig.hud.updateReliquaryTracker();
    expect(rig.counts.ownedMounts).toBe(2);
  });
});

describe('Hud.updateReliquaryTracker: the all-empty cold shape', () => {
  it('paints the hidden strip when every surface is empty and no page resolves, pinned or not', () => {
    // The shape a cold ClientWorld mirror presents before its first snapshot:
    // every surface empty and reliquaryPageCompletion answering null for
    // every page. (That premise is a reading of src/net/online.ts's
    // at-declaration initializers, not something this stub can prove; the
    // IWorld parity pin owns the member shapes.) The method reads .size off
    // two Sets and a Map and .length off two arrays across five facets, so
    // all-empty is the shape most likely to surface an undefined read; it
    // must produce the hidden strip instead.
    const rig = makeRig();
    for (const key of Object.keys(rig.progress)) delete rig.progress[key];
    rig.hud.updateReliquaryTracker();
    expect(rig.painted[0]?.visible).toBe(false);
    // A stored pin whose page the mirror cannot answer for yet stays a hidden
    // line, not a crash: the reconnect race every online session can hit.
    rig.hud.reliquaryWindow.pinned.add(PINNED_PAGE);
    rig.hud.updateReliquaryTracker();
    expect(rig.painted[1]?.visible).toBe(false);
  });
});
