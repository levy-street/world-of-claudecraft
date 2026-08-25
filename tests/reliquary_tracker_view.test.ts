// Pure-core pins for the always-on Reliquary tracker (src/ui/reliquary_tracker_view.ts):
// which pages the strip shows and in what order, the fill-delta flash, the pin
// cap and prune helpers, and the container-reuse contract that lets an
// always-on surface run on the slow band without allocating. Plus the chrome
// pins the strip depends on outside this module: the container in BOTH game
// entries, the hud.ts delegation, the stylesheet floors, and the settings row.
//
// The painter's own DOM contract lives in tests/reliquary_tracker_painter.test.ts;
// the window-side pin control in tests/reliquary_window_behavior.test.ts.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEED_WATCH_CAP } from '../src/ui/deeds_view';
import {
  buildReliquaryTrackerViewInto,
  makeReliquaryTrackerInput,
  makeReliquaryTrackerView,
  pruneReliquaryPins,
  RELIQUARY_FLASH_BUILDS,
  RELIQUARY_TRACK_CAP,
  type ReliquaryTrackerView,
  type ReliquaryTrackerWorld,
  reliquaryTrackerOwnershipSig,
  toggleReliquaryPin,
} from '../src/ui/reliquary_tracker_view';
import { isReliquaryNearlyComplete, rankNearlyComplete } from '../src/ui/reliquary_view';
import type { ReliquaryPageCompletion } from '../src/world_api/reliquary';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

// A synthetic catalog: page ids and their (owned, total) progress. The tracker
// core takes pageIds + a completion callback, so the selection rules can be
// driven exactly; its ONE authored-catalog read is the retired-page skip in
// the default scan (RELIQUARY_PAGES_BY_ID excludeFromCompletion), which never
// fires for these synthetic ids and is pinned with the real vault id in
// tests/reliquary_view.test.ts.
type Progress = Record<string, { owned: number; total: number }>;

function completionFrom(progress: Progress): (pageId: string) => ReliquaryPageCompletion | null {
  return (pageId) => {
    const p = progress[pageId];
    if (p === undefined) return null;
    // complete mirrors production exactly (sim pageCompletion: owned === total,
    // owned counted over the page's own relic list), so the rig teaches the
    // real rule to the next reader.
    return { owned: p.owned, total: p.total, complete: p.total > 0 && p.owned === p.total };
  };
}

function build(
  out: ReliquaryTrackerView,
  progress: Progress,
  opts: { pinned?: string[]; sig?: number; collapsed?: boolean; enabled?: boolean } = {},
): ReliquaryTrackerView {
  return buildReliquaryTrackerViewInto(out, {
    pinned: new Set(opts.pinned ?? []),
    pageIds: Object.keys(progress),
    completion: completionFrom(progress),
    ownershipSig: () => opts.sig ?? 0,
    collapsed: opts.collapsed ?? false,
    enabled: opts.enabled ?? true,
  });
}

const shown = (view: ReliquaryTrackerView): string[] =>
  view.lines.slice(0, view.count).map((line) => line.pageId);

describe('tracker constants', () => {
  it('caps the strip at five, the deed watchlist number, and holds a flash two builds', () => {
    // The cap mirrors DEED_WATCH_CAP on purpose: the two trackers stack in one
    // right-hand column, so the shared five is what keeps a fully pinned player
    // inside the small-viewport HUD. Pinned to the LITERAL as well as to the
    // deed constant, or a change to both at once would slip through unnoticed.
    expect(RELIQUARY_TRACK_CAP).toBe(5);
    expect(RELIQUARY_TRACK_CAP).toBe(DEED_WATCH_CAP);
    // Two slow-band builds is about a second, the room the CSS pulse needs.
    expect(RELIQUARY_FLASH_BUILDS).toBe(2);
  });
});

describe('buildReliquaryTrackerViewInto: selection', () => {
  it('shows pinned pages in pin order, not catalog order', () => {
    const progress: Progress = {
      alpha: { owned: 1, total: 10 },
      beta: { owned: 2, total: 10 },
      gamma: { owned: 3, total: 10 },
    };
    const view = build(makeReliquaryTrackerView(), progress, { pinned: ['gamma', 'alpha'] });
    expect(shown(view)).toEqual(['gamma', 'alpha']);
    expect(view.visible).toBe(true);
    // The rows carry the live progress the painter draws, not just the ids.
    expect(view.lines[0].owned).toBe(3);
    expect(view.lines[0].total).toBe(10);
  });

  it('drops an illuminated pin and a catalog-unknown pin, keeping the rest', () => {
    const progress: Progress = {
      done: { owned: 10, total: 10 },
      live: { owned: 4, total: 10 },
    };
    const view = build(makeReliquaryTrackerView(), progress, {
      pinned: ['done', 'ghost', 'live'],
    });
    expect(shown(view)).toEqual(['live']);
  });

  it('hides itself entirely when nothing qualifies', () => {
    const view = build(makeReliquaryTrackerView(), { done: { owned: 10, total: 10 } });
    expect(view.count).toBe(0);
    expect(view.visible).toBe(false);
  });

  it('falls back to the nearly-complete ranking when nothing is pinned', () => {
    // close: 1 relic to go. closer: already full-fraction. far: neither arm.
    const progress: Progress = {
      far: { owned: 1, total: 40 },
      close: { owned: 9, total: 10 },
      closer: { owned: 19, total: 20 },
      untouched: { owned: 0, total: 10 },
    };
    const view = build(makeReliquaryTrackerView(), progress);
    // Both qualifying pages are one relic from Illumination, so the tie breaks
    // on the higher owned fraction (closer, 95%, before close, 90%).
    expect(shown(view)).toEqual(['closer', 'close']);
    // A page nobody has started never appears: the strip is a chase, not a
    // to-do list of the whole catalog.
    expect(shown(view)).not.toContain('untouched');
    expect(shown(view)).not.toContain('far');
  });

  it('lets one pin outrank the whole default ranking', () => {
    const progress: Progress = {
      close: { owned: 9, total: 10 },
      barely: { owned: 1, total: 40 },
    };
    const withoutPin = build(makeReliquaryTrackerView(), progress);
    expect(shown(withoutPin)).toEqual(['close']);
    // `barely` does not qualify as nearly complete at all, so only an explicit
    // pin can put it on the strip: the player's choice is the higher authority.
    const withPin = build(makeReliquaryTrackerView(), progress, { pinned: ['barely'] });
    expect(shown(withPin)).toEqual(['barely']);
  });

  it('caps the strip at RELIQUARY_TRACK_CAP on both the pinned and default paths', () => {
    const progress: Progress = {};
    const pins: string[] = [];
    for (let i = 0; i < RELIQUARY_TRACK_CAP + 3; i++) {
      const id = `p${i}`;
      progress[id] = { owned: 9, total: 10 };
      pins.push(id);
    }
    const pinned = build(makeReliquaryTrackerView(), progress, { pinned: pins });
    expect(pinned.count).toBe(RELIQUARY_TRACK_CAP);
    const dflt = build(makeReliquaryTrackerView(), progress);
    expect(dflt.count).toBe(RELIQUARY_TRACK_CAP);
  });

  it('carries the collapse flag straight through', () => {
    const progress: Progress = { close: { owned: 9, total: 10 } };
    const view = makeReliquaryTrackerView();
    build(view, progress, { collapsed: true });
    expect(view.collapsed).toBe(true);
    build(view, progress, { collapsed: false });
    expect(view.collapsed).toBe(false);
  });

  it('never touches chip, which the host sets from the body classes', () => {
    const view = makeReliquaryTrackerView();
    view.chip = true;
    build(view, { close: { owned: 9, total: 10 } });
    expect(view.chip).toBe(true);
  });
});

describe('buildReliquaryTrackerViewInto: the fill flash', () => {
  const progress = (owned: number): Progress => ({ page: { owned, total: 10 } });

  it('never flashes the first sighting of a page', () => {
    const view = build(makeReliquaryTrackerView(), progress(4), { pinned: ['page'] });
    expect(view.lines[0].flash).toBe(false);
  });

  it('flashes a risen owned count, then clears once the hold runs out', () => {
    const view = makeReliquaryTrackerView();
    build(view, progress(4), { pinned: ['page'] });
    build(view, progress(5), { pinned: ['page'] });
    expect(view.lines[0].flash).toBe(true);
    // The hold rides RELIQUARY_FLASH_BUILDS builds total so the CSS pulse is not
    // cut off half way; after that the row goes quiet on its own.
    for (let i = 1; i < RELIQUARY_FLASH_BUILDS; i++) {
      build(view, progress(5), { pinned: ['page'] });
      expect(view.lines[0].flash).toBe(true);
    }
    build(view, progress(5), { pinned: ['page'] });
    expect(view.lines[0].flash).toBe(false);
  });

  it('does not flash an unchanged count, or a count that went down', () => {
    const view = makeReliquaryTrackerView();
    build(view, progress(4), { pinned: ['page'] });
    build(view, progress(4), { pinned: ['page'] });
    expect(view.lines[0].flash).toBe(false);
    build(view, progress(3), { pinned: ['page'] });
    expect(view.lines[0].flash).toBe(false);
  });

  it('stays dark when a reorder alone moves a bigger count into a slot', () => {
    // The decisive case against an index-keyed diff: NOTHING was found here.
    // Re-pinning just swaps which page sits in slot 0, and a slot-keyed diff
    // would compare b's 7 against a's 4, call it a gain, and pulse a row the
    // player earned nothing on.
    const steady: Progress = { a: { owned: 4, total: 10 }, b: { owned: 7, total: 10 } };
    const view = makeReliquaryTrackerView();
    build(view, steady, { pinned: ['a', 'b'] });
    build(view, steady, { pinned: ['b', 'a'] });
    expect(shown(view)).toEqual(['b', 'a']);
    expect(view.lines[0].flash).toBe(false);
    expect(view.lines[1].flash).toBe(false);
  });

  it('burns the flash hold while collapsed, so a later expand shows no pulse', () => {
    // This pins the documented READ of current behavior, not a bug. The core is
    // told whether the strip is collapsed but deliberately does not model it in
    // the flash: a fill that lands under a folded header still starts its hold
    // and still spends it, build by build, unseen. Expanding after the hold has
    // run out is therefore quiet. Saving the pulse for the next expand would
    // mean the core tracking visibility, which is a different contract than the
    // one shipped; changing that intentionally means changing this test.
    const view = makeReliquaryTrackerView();
    build(view, progress(4), { pinned: ['page'], collapsed: true });
    expect(view.lines[0].flash).toBe(false);
    // The fill lands with the rows folded away, and the flag is set anyway.
    build(view, progress(5), { pinned: ['page'], collapsed: true });
    expect(view.lines[0].flash).toBe(true);
    for (let i = 1; i < RELIQUARY_FLASH_BUILDS; i++) {
      build(view, progress(5), { pinned: ['page'], collapsed: true });
      expect(view.lines[0].flash).toBe(true);
    }
    // Expanded again, and the pulse is already spent: the player sees the new
    // number, never the animation that announced it.
    build(view, progress(5), { pinned: ['page'], collapsed: false });
    expect(view.lines[0].flash).toBe(false);
  });

  it('does not flash a page that left the strip and came back richer', () => {
    // The first-sighting rule covers RETURNS too: the previous table is bounded
    // by the last build's live line count, so a page that dropped off has no
    // entry left to have risen from, however much it gained while away. The
    // filler pin is what makes this decisive rather than incidental: it keeps
    // the departed page's stale slot alive PAST prevCount, so a diff that
    // scanned the whole prev array would find the old 4, read 7 against it, and
    // pulse a row for relics the player collected on some other screen.
    const away: Progress = { filler: { owned: 2, total: 10 }, page: { owned: 4, total: 10 } };
    const view = makeReliquaryTrackerView();
    build(view, away, { pinned: ['filler', 'page'] });
    expect(shown(view)).toEqual(['filler', 'page']);
    build(view, away, { pinned: ['filler'] });
    expect(shown(view)).toEqual(['filler']);
    const back: Progress = { filler: { owned: 2, total: 10 }, page: { owned: 7, total: 10 } };
    build(view, back, { pinned: ['filler', 'page'] });
    expect(shown(view)).toEqual(['filler', 'page']);
    expect(view.lines[1].flash).toBe(false);
    // And it is a real first sighting, not a hidden hold: the NEXT gain, now
    // that the page has a previous count again, does flash.
    const gained: Progress = { filler: { owned: 2, total: 10 }, page: { owned: 8, total: 10 } };
    build(view, gained, { pinned: ['filler', 'page'] });
    expect(view.lines[1].flash).toBe(true);
  });

  it('lights the page that actually gained, wherever the reorder put it', () => {
    // The other half: `a` gained while the order changed under it, so the flash
    // has to travel with the page into its new slot.
    const before: Progress = { a: { owned: 4, total: 10 }, b: { owned: 7, total: 10 } };
    const after: Progress = { a: { owned: 5, total: 10 }, b: { owned: 7, total: 10 } };
    const view = makeReliquaryTrackerView();
    build(view, before, { pinned: ['a', 'b'] });
    build(view, after, { pinned: ['b', 'a'] });
    expect(shown(view)).toEqual(['b', 'a']);
    expect(view.lines[0].flash).toBe(false);
    expect(view.lines[1].flash).toBe(true);
  });
});

describe('buildReliquaryTrackerViewInto: allocation contract', () => {
  it('returns the SAME container and the SAME lines array across builds', () => {
    const view = makeReliquaryTrackerView();
    const lines = view.lines;
    const firstLine = view.lines[0];
    const returned = build(view, { close: { owned: 9, total: 10 } });
    expect(returned).toBe(view);
    expect(view.lines).toBe(lines);
    expect(view.lines[0]).toBe(firstLine);
    expect(view.lines.length).toBe(RELIQUARY_TRACK_CAP);
  });

  it('re-runs the default scan only when the ownership signature moves', () => {
    // Every completion() call mints a fresh ownership bag in both hosts, so an
    // always-on strip that re-folded the whole catalog every slow tick would be
    // a real cost. Counting the calls is the decisive observation.
    const progress: Progress = {
      a: { owned: 9, total: 10 },
      b: { owned: 5, total: 10 },
      c: { owned: 2, total: 10 },
    };
    let calls = 0;
    const counting = (pageId: string): ReliquaryPageCompletion | null => {
      calls++;
      return completionFrom(progress)(pageId);
    };
    const view = makeReliquaryTrackerView();
    let sigCalls = 0;
    const run = (sig: number): void => {
      buildReliquaryTrackerViewInto(view, {
        pinned: new Set(),
        pageIds: Object.keys(progress),
        completion: counting,
        enabled: true,
        ownershipSig: () => {
          sigCalls++;
          return sig;
        },
        collapsed: false,
      });
    };
    run(1);
    const cold = calls;
    expect(cold).toBe(3);
    run(1);
    run(1);
    expect(calls).toBe(cold);
    // Ownership moved: the ranking is stale by definition, so it re-runs.
    run(2);
    expect(calls).toBe(cold * 2);
    // The default branch does need the signature, but exactly once per build:
    // it is the memo key, not something to be re-gathered mid-scan.
    expect(sigCalls).toBe(4);
  });

  it('reads pinned pages live on every build, memo or not, and never asks for the signature', () => {
    // The pages the player explicitly chose are never served from a memo: their
    // counts are the whole point of the strip.
    const progress: Progress = { page: { owned: 4, total: 10 } };
    let calls = 0;
    const counting = (pageId: string): ReliquaryPageCompletion | null => {
      calls++;
      return completionFrom(progress)(pageId);
    };
    let sigCalls = 0;
    const view = makeReliquaryTrackerView();
    for (let i = 0; i < 3; i++) {
      buildReliquaryTrackerViewInto(view, {
        pinned: new Set(['page']),
        pageIds: ['page'],
        completion: counting,
        enabled: true,
        ownershipSig: () => {
          sigCalls++;
          return 7;
        },
        collapsed: false,
      });
    }
    expect(calls).toBe(3);
    // The signature is a thunk for exactly this: producing one costs the host
    // five live ownership reads (one of them a bags-plus-bank copy), and the
    // pinned branch never consults it, so a pinned player must not pay for it
    // on every 500ms band.
    expect(sigCalls).toBe(0);
  });

  it('picks the default ranking up the moment the last pin is removed', () => {
    // The memo is keyed on the signature alone, so the first build after an
    // unpin must not show an empty strip while ownership has not moved.
    const progress: Progress = { close: { owned: 9, total: 10 } };
    const view = makeReliquaryTrackerView();
    build(view, progress, { pinned: ['close'], sig: 5 });
    expect(shown(view)).toEqual(['close']);
    build(view, progress, { pinned: [], sig: 5 });
    expect(shown(view)).toEqual(['close']);
  });
});

describe('reliquaryTrackerOwnershipSig', () => {
  const base = {
    itemsDiscovered: 3,
    marks: 1,
    deedsEarned: 2,
    mounts: 4,
    weaponSkins: 5,
  };

  it('moves when any single ownership surface moves', () => {
    const sig = reliquaryTrackerOwnershipSig(base);
    for (const key of Object.keys(base) as (keyof typeof base)[]) {
      const bumped = reliquaryTrackerOwnershipSig({ ...base, [key]: base[key] + 1 });
      expect(bumped, key).not.toBe(sig);
    }
  });

  it('does not let a gain on one surface cancel a loss on another', () => {
    const sig = reliquaryTrackerOwnershipSig(base);
    expect(
      reliquaryTrackerOwnershipSig({ ...base, marks: base.marks + 1, mounts: base.mounts - 1 }),
    ).not.toBe(sig);
    expect(
      reliquaryTrackerOwnershipSig({
        ...base,
        itemsDiscovered: base.itemsDiscovered + 1,
        weaponSkins: base.weaponSkins - 1,
      }),
    ).not.toBe(sig);
  });

  it('is stable for an unchanged set of counts', () => {
    expect(reliquaryTrackerOwnershipSig(base)).toBe(reliquaryTrackerOwnershipSig({ ...base }));
  });

  it('still moves at magnitudes where float accumulation rounds a step away', () => {
    // The Math.imul rationale, pinned: under the pre-imul float expression
    // these two inputs COLLIDE (both -712415344; the +1 on weaponSkins is
    // rounded away once the intermediate passes 2^53), so this case reddens on
    // a revert to a single trailing |0 over float products.
    const big = { itemsDiscovered: 8691, marks: 1, deedsEarned: 2, mounts: 4, weaponSkins: 5 };
    expect(reliquaryTrackerOwnershipSig({ ...big, weaponSkins: 6 })).not.toBe(
      reliquaryTrackerOwnershipSig(big),
    );
  });
});

describe('rankNearlyComplete', () => {
  const rows = [
    { pageId: 'far', owned: 1, total: 10 },
    { pageId: 'closest', owned: 9, total: 10 },
    { pageId: 'tie_b', owned: 8, total: 10 },
    { pageId: 'tie_a', owned: 4, total: 5 },
  ];

  it('orders by fewest remaining, then highest fraction, then page id', () => {
    // closest and tie_a are both 1 to go: 90% beats 80%. tie_b is 2 to go.
    expect(rankNearlyComplete(rows).map((r) => r.pageId)).toEqual([
      'closest',
      'tie_a',
      'tie_b',
      'far',
    ]);
  });

  it('breaks a full tie on the page id, so equal pages never trade places', () => {
    const tied = [
      { pageId: 'zulan', owned: 9, total: 10 },
      { pageId: 'aerie', owned: 9, total: 10 },
    ];
    expect(rankNearlyComplete(tied).map((r) => r.pageId)).toEqual(['aerie', 'zulan']);
  });

  it('copies: the caller array keeps its own order and its own element objects', () => {
    const input = [...rows];
    const before = input.map((r) => r.pageId);
    const ranked = rankNearlyComplete(input);
    expect(input.map((r) => r.pageId)).toEqual(before);
    expect(ranked).not.toBe(input);
    // Not a deep copy: the rows themselves are shared, which is what makes the
    // helper free to call on a reused container.
    expect(ranked[0]).toBe(input.find((r) => r.pageId === 'closest'));
  });
});

describe('isReliquaryNearlyComplete', () => {
  it('accepts a page within reach of Illumination, on either arm', () => {
    expect(isReliquaryNearlyComplete(9, 10)).toBe(true);
    // Second arm: far from done by count, but already past the fraction floor.
    expect(isReliquaryNearlyComplete(28, 40)).toBe(true);
  });

  it('rejects the finished, the empty, the untouched, and the barely started', () => {
    expect(isReliquaryNearlyComplete(10, 10)).toBe(false);
    expect(isReliquaryNearlyComplete(0, 0)).toBe(false);
    expect(isReliquaryNearlyComplete(0, 10)).toBe(false);
    expect(isReliquaryNearlyComplete(1, 40)).toBe(false);
  });
});

describe('toggleReliquaryPin', () => {
  it('adds, removes, and refuses at the cap without mutating the input set', () => {
    const empty: ReadonlySet<string> = new Set();
    const added = toggleReliquaryPin(empty, 'a');
    expect([...added.pinned]).toEqual(['a']);
    expect(added.changed).toBe(true);
    expect(added.full).toBe(false);
    expect(empty.size).toBe(0);

    const removed = toggleReliquaryPin(added.pinned, 'a');
    expect([...removed.pinned]).toEqual([]);
    expect(removed.changed).toBe(true);
    expect([...added.pinned]).toEqual(['a']);
  });

  it('refuses an add at the cap and returns the SAME set, flagged full', () => {
    const full = new Set<string>();
    for (let i = 0; i < RELIQUARY_TRACK_CAP; i++) full.add(`p${i}`);
    const refused = toggleReliquaryPin(full, 'one-too-many');
    expect(refused.full).toBe(true);
    expect(refused.changed).toBe(false);
    expect(refused.pinned).toBe(full);
    // An UNPIN at the cap still works: the cap only bounds adds.
    const unpinned = toggleReliquaryPin(full, 'p0');
    expect(unpinned.changed).toBe(true);
    expect(unpinned.pinned.size).toBe(RELIQUARY_TRACK_CAP - 1);
  });

  it('appends to the end, so pin order is the order the player pinned in', () => {
    let pins: ReadonlySet<string> = new Set(['a', 'b']);
    pins = toggleReliquaryPin(pins, 'c').pinned;
    expect([...pins]).toEqual(['a', 'b', 'c']);
    // Re-pinning after an unpin moves the page to the END, the way a fresh pin
    // does; there is no hidden slot memory.
    pins = toggleReliquaryPin(pins, 'a').pinned;
    pins = toggleReliquaryPin(pins, 'a').pinned;
    expect([...pins]).toEqual(['b', 'c', 'a']);
  });
});

describe('pruneReliquaryPins', () => {
  const progress: Progress = {
    live: { owned: 4, total: 10 },
    done: { owned: 10, total: 10 },
    empty: { owned: 0, total: 0 },
  };

  it('returns the SAME set instance when nothing is stale', () => {
    const pins: ReadonlySet<string> = new Set(['live']);
    const result = pruneReliquaryPins(pins, completionFrom(progress));
    expect(result.changed).toBe(false);
    expect(result.pinned).toBe(pins);
  });

  it('drops illuminated, empty, and catalog-unknown pages and keeps the rest', () => {
    const pins: ReadonlySet<string> = new Set(['done', 'live', 'empty', 'ghost']);
    const result = pruneReliquaryPins(pins, completionFrom(progress));
    expect(result.changed).toBe(true);
    expect([...result.pinned]).toEqual(['live']);
    // The caller's set is untouched; the prune answers, it does not mutate.
    expect(pins.size).toBe(4);
  });

  it('keeps the survivors walked BEFORE the first drop, in order', () => {
    // The single-pass back-fill arm: with the drop in the middle, survivors on
    // both sides must land, in pin order. A broken back-fill silently unpins
    // everything the player pinned before the completed page, and a drop-first
    // input (like the case above) never exercises it.
    const wide: Progress = { ...progress, live2: { owned: 2, total: 9 } };
    const result = pruneReliquaryPins(new Set(['live', 'done', 'live2']), completionFrom(wide));
    expect(result.changed).toBe(true);
    expect([...result.pinned]).toEqual(['live', 'live2']);
  });

  it('applies the same skip predicate the tracker build applies', () => {
    // The two must never disagree: a page the strip refuses to show but the
    // store keeps would hold a cap slot no button can release.
    const pins = ['done', 'live', 'empty', 'ghost'];
    const view = build(makeReliquaryTrackerView(), progress, { pinned: pins });
    const pruned = pruneReliquaryPins(new Set(pins), completionFrom(progress));
    expect(shown(view)).toEqual([...pruned.pinned]);
  });
});

// ---------------------------------------------------------------------------
describe('makeReliquaryTrackerInput', () => {
  const makeWorld = (): ReliquaryTrackerWorld & {
    itemsDiscovered: Set<string>;
    mounts: string[];
  } => {
    const itemsDiscovered = new Set<string>();
    const mounts: string[] = [];
    return {
      itemsDiscovered,
      mounts,
      reliquaryPageCompletion: (pageId) =>
        pageId === 'page' ? { owned: 1, total: 4, complete: false } : null,
      deedStats: { itemsDiscovered },
      reliquaryMarks: new Set<string>(),
      deedsEarned: new Map<string, string>(),
      ownedMounts: () => mounts,
      accountCosmetics: { weaponSkinIds: [] },
    };
  };

  it('routes completion reads to the LIVE world (a swap is picked up, not the minted one)', () => {
    let world = makeWorld();
    const input = makeReliquaryTrackerInput(() => world);
    expect(input.completion('page')).toEqual({ owned: 1, total: 4, complete: false });
    // Swap the world behind the thunk (the offline-to-online transition): the
    // REUSED input must follow without being re-minted.
    world = makeWorld();
    world.reliquaryPageCompletion = () => null;
    expect(input.completion('page')).toBeNull();
  });

  it('moves the ownership signature when any surface grows', () => {
    const world = makeWorld();
    const input = makeReliquaryTrackerInput(() => world);
    const before = input.ownershipSig();
    world.itemsDiscovered.add('relic');
    const afterItem = input.ownershipSig();
    expect(afterItem).not.toBe(before);
    world.mounts.push('mount');
    expect(input.ownershipSig()).not.toBe(afterItem);
  });

  it('mints the per-build fields at their safe defaults (shown, expanded, unpinned)', () => {
    const input = makeReliquaryTrackerInput(makeWorld);
    expect(input.enabled).toBe(true);
    expect(input.collapsed).toBe(false);
    expect(input.pinned.size).toBe(0);
  });
});

describe('the master switch (enabled)', () => {
  it('hides the strip and pays for no world reads while disabled', () => {
    const view = makeReliquaryTrackerView();
    let completionCalls = 0;
    let sigCalls = 0;
    buildReliquaryTrackerViewInto(view, {
      pinned: new Set(['page']),
      pageIds: ['page'],
      completion: (pageId) => {
        completionCalls++;
        return completionFrom({ page: { owned: 1, total: 4 } })(pageId);
      },
      ownershipSig: () => {
        sigCalls++;
        return 1;
      },
      collapsed: false,
      enabled: false,
    });
    expect(view.visible).toBe(false);
    expect(view.count).toBe(0);
    // The whole point of the early-out: a player who turned the strip off
    // pays nothing for it, pinned or not, every slow band.
    expect(completionCalls).toBe(0);
    expect(sigCalls).toBe(0);
  });

  it('still carries the collapse through, so re-enable restores the same fold state', () => {
    const view = makeReliquaryTrackerView();
    build(
      view,
      { page: { owned: 1, total: 4 } },
      { pinned: ['page'], enabled: false, collapsed: true },
    );
    expect(view.collapsed).toBe(true);
  });

  it('re-enabling is a first sighting: fills that happened while hidden do not flash', () => {
    const progress: Progress = { page: { owned: 1, total: 4 } };
    const view = makeReliquaryTrackerView();
    build(view, progress, { pinned: ['page'] });
    expect(view.lines[0].flash).toBe(false);
    // Hidden across the fill: the previous-build table is cleared, so the
    // owned rise is invisible to the delta pass when the strip returns.
    build(view, progress, { pinned: ['page'], enabled: false });
    progress.page.owned = 3;
    const shown = build(view, progress, { pinned: ['page'] });
    expect(shown.visible).toBe(true);
    expect(shown.lines[0].owned).toBe(3);
    expect(shown.lines[0].flash).toBe(false);
  });

  it('a fill while VISIBLE still flashes after an enabled build (control arm)', () => {
    // The control for the test above: same fill, no hidden build in between,
    // so a broken prev-table clear cannot pass both.
    const progress: Progress = { page: { owned: 1, total: 4 } };
    const view = makeReliquaryTrackerView();
    build(view, progress, { pinned: ['page'] });
    progress.page.owned = 3;
    const shown = build(view, progress, { pinned: ['page'] });
    expect(shown.lines[0].flash).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Chrome the strip depends on outside this module
// ---------------------------------------------------------------------------

describe('tracker chrome', () => {
  const indexHtml = read('../index.html');
  const playHtml = read('../play.html');
  const hud = read('../src/ui/hud.ts');
  const hudCss = read('../src/styles/hud.css');
  const hudMobile = read('../src/styles/hud.mobile.css');
  const settingsSrc = read('../src/game/settings.ts');
  const painter = read('../src/ui/reliquary_tracker_painter.ts');

  // The updateReliquaryTracker body alone, comment-stripped. Scoped to the
  // method rather than the whole file so a matching line living in the deed
  // tracker's twin (or in the prose that names these very fields) can never
  // satisfy one of the ownership pins below.
  const sliceBetween = (src: string, from: string, to: string): string => {
    const start = src.indexOf(from);
    if (start < 0) throw new Error(`source premise: hud.ts no longer contains ${from}`);
    const end = src.indexOf(to, start);
    if (end < 0) throw new Error(`source premise: hud.ts no longer contains ${to} after ${from}`);
    return src.slice(start, end);
  };
  const trackerBody = stripComments(
    sliceBetween(
      hud,
      'private updateReliquaryTracker(): void {',
      'private toggleReliquaryTrackerCollapsed(',
    ),
  );

  it('feeds every ownership surface into the memo signature', () => {
    // Five surfaces fold into a page's owned count, and the default scan re-runs
    // only when this signature moves. Drop any ONE of them and the strip holds a
    // stale ranking straight through the fill that should have re-ranked it,
    // which is invisible in the pure core (it takes the number, not the reads).
    // Pinned as five separate lines so the failure names the missing surface.
    // The reads live in makeReliquaryTrackerInput (this module) since the
    // input construction was extracted out of hud.ts; the factory body is the
    // scope so a matching line elsewhere can never satisfy a pin.
    const viewSrc = read('../src/ui/reliquary_tracker_view.ts');
    const factoryBody = stripComments(
      sliceBetween(viewSrc, 'export function makeReliquaryTrackerInput(', '\nexport function'),
    );
    expect(factoryBody, 'itemsDiscovered').toContain(
      'itemsDiscovered: w.deedStats.itemsDiscovered.size,',
    );
    expect(factoryBody, 'reliquaryMarks').toContain('marks: w.reliquaryMarks.size,');
    expect(factoryBody, 'deedsEarned').toContain('deedsEarned: w.deedsEarned.size,');
    expect(factoryBody, 'ownedMounts').toContain('mounts: w.ownedMounts().length,');
    expect(factoryBody, 'weaponSkinIds').toContain(
      'weaponSkins: w.accountCosmetics.weaponSkinIds.length,',
    );
    // The input object is minted once by the factory and reused (the deed
    // tracker's allocation-free drive precedent): the lazy-init spelling over
    // the live-world thunk is the pin.
    expect(trackerBody, 'reused input').toContain(
      'this.reliquaryTrackerInput ??= makeReliquaryTrackerInput(() => this.sim);',
    );
  });

  it('repaints the strip the moment a pin toggles, not on the next slow band', () => {
    // The deeds precedent (onWatchChanged): without this hook a pin lands and
    // the strip keeps showing the old set for up to a whole 500ms band, which
    // reads as the button having done nothing.
    expect(stripComments(hud)).toContain('onPinChanged: () => this.updateReliquaryTracker(),');
  });

  it('wires the master switch to the ONE persisted key, read and written alike', () => {
    // The literal key is the contract three surfaces share (the tracker build,
    // the window eye, the Options row): a drifted spelling on any one of them
    // would fork the switch into two settings that both look right alone.
    expect(trackerBody, 'enabled read').toContain(
      "input.enabled = (settings?.get('showReliquaryTracker') ?? true) === true;",
    );
    // Scoped to the reliquaryWindow deps bag (the same discipline as
    // trackerBody above): a matching line in another window's deps could not
    // satisfy these.
    const windowDeps = stripComments(
      sliceBetween(hud, 'private readonly reliquaryWindow = new ReliquaryWindow({', '});'),
    );
    expect(windowDeps, 'window read').toContain(
      "trackerShown: () => (this.optionsHooks?.settings.get('showReliquaryTracker') ?? true) === true,",
    );
    // The write routes through the options seam (the playtime-eye doctrine),
    // never a bare settings.set, AND nudges the strip in the same handler: the
    // whole body is the pin so dropping the immediate repaint (the onPinChanged
    // immediacy contract) cannot pass either.
    expect(windowDeps, 'window write plus nudge').toContain(
      "this.optionsHooks?.onSettingChange('showReliquaryTracker', shown);\n      this.updateReliquaryTracker();",
    );
  });

  it('couples the empty-tracker gap reclaim to the quest tracker really emptying', () => {
    // hud.css drops an EMPTY stack child from the flex flow so the strip sits
    // where the quest tracker would (no phantom gap with zero quests). CSS
    // :empty matches only a childless, textless node, so the rule only works
    // while the questless render is the empty STRING; pin both halves so
    // either drifting alone fails here. The DECLARATION is part of the pin:
    // an opacity/visibility swap would keep the selector while restoring the
    // phantom gap.
    expect(hudCss).toMatch(/#right-tracker-stack > :empty \{\s*display: none;/);
    const questController = read('../src/ui/hud/quest/quest_tracker_controller.ts');
    expect(stripComments(questController)).toContain("if (!view.visible) return '';");
  });

  // An invisible ::after hit extension only works while it is a live, painted
  // box: `pointer-events: none` (the "this overlay should not eat clicks" edit
  // a later reader is tempted into) or `display: none` keeps every geometry pin
  // green while killing the tap target outright. Bounded to the extracted
  // three-declaration block, with the positive `inset` match on the same
  // string as its control, so it is not the vacuous file-wide negative shape.
  // The inset is -9px, not -8px: an absolutely positioned pseudo-element's
  // inset is measured from the host's PADDING edge, so on a 1px-bordered
  // button -9px is the 8px beyond the visual edge every sum below relies on
  // (-8px really measured 2px short in tests/browser/target_size, which pins
  // the LIVE reach; this source pin holds the exact value beside it).
  const expectLiveHitExtension = (afterBlock: string): void => {
    expect(afterBlock).toMatch(/content: "";\s*position: absolute;\s*inset: -9px;/);
    expect(afterBlock).not.toMatch(/pointer-events|display:\s*none|visibility/);
  };

  it('keeps the eye toggle a legal pointer target on desktop (DESIGN.md 10.1, 36px)', () => {
    // The visual chip measures 20px tall in Chrome (the 14px icon is the
    // tallest item in the centered flex row, the 11px label's line box sits
    // under it; plus 2x2px padding and 2x1px border); the invisible ::after
    // hit extension (the char-playtime-eye idiom) is what lifts it to the 36px
    // desktop floor DESIGN.md 10.1 names for new chrome (20 + 2x8, the 8 being
    // the reach beyond the 1px border, see expectLiveHitExtension), and it is
    // inert without position: relative on the host. The first cut's -6px
    // stopped at 30px and a naive -8px at 34px: past the WCAG 2.5.8 24px floor
    // but under the house one, which is why the exact inset is the pin. The
    // mobile arm keeps the 40px coarse floor instead. COMMENT-STRIPPED first:
    // a commented-out declaration followed by
    // a retuned one is the realistic edit shape in these heavily commented
    // sheets, and a raw read would let the comment satisfy every pin.
    const componentsCss = stripComments(read('../src/styles/components.css'));
    expect(componentsCss).toMatch(/\.reliquary-tracker-toggle \{\s*position: relative;/);
    const eyeAfter = /\.reliquary-tracker-toggle::after \{([^}]*)\}/.exec(componentsCss)?.[1] ?? '';
    expectLiveHitExtension(eyeAfter);
    // The mobile arm sizes the box itself to the 40px floor and zeroes the
    // reach (the idiom scopes per pointer: a 40px box plus 8px each way would
    // overreach the sticky panel-title row on the full-bleed phone layout).
    expect(componentsCss).toMatch(
      /body\.mobile-touch \.reliquary-tracker-toggle \{\s*min-height: 40px;/,
    );
    expect(componentsCss).toMatch(
      /body\.mobile-touch \.reliquary-tracker-toggle::after \{\s*inset: 0;/,
    );
    // Not a pill: the window's button family (.reliquary-pin) is a 4px chip and
    // DESIGN.md 14 rules out pill buttons, so the radius is pinned too, through
    // the one named token (--radius-sm is 4px in tokens.css).
    expect(componentsCss).toMatch(
      /\.reliquary-tracker-toggle \{[^}]*border-radius: var\(--radius-sm\);/,
    );
  });

  it('keeps the compact mobile chip a 40px tap target while its visual stays small', () => {
    // The compact-tier chip (both trackers share the rule) is a 24px visual
    // under a minimap column that renders about 82px wide; the 40px coarse
    // floor (DESIGN.md 13.5) rides the same invisible ::after hit extension as
    // the eye above (24 + 2x8 = 40), which is inert without position: relative
    // on the chip. The first cut let the base sheet's pointer-coarse
    // min-height: 40px size the chip itself (109x40, measured), which is the
    // oversize this pin exists to keep out: the height half is min-height,
    // the width half is the type size and padding (the first cut's 12px and
    // 2px 12px are exactly what grew it), so both halves are pinned. The rule
    // lives in hud.mobile.css (the hud-mobile layer), which is what lets its
    // min-height: 24px beat the base coarse rule regardless of specificity.
    // Comment-stripped for the same reason as the eye pin above.
    const mobileCss = stripComments(read('../src/styles/hud.mobile.css'));
    // Both trackers in ONE selector list (the rule spans them on purpose), so
    // a pin over either half alone could not pass on a rule that dropped the
    // other tracker. Resolved by selector MEMBERSHIP rather than a literal
    // ordered list: a third tracker joining the rule, or the two swapping
    // order, is the same rule, while dropping either tracker is not. `suffix`
    // is '' for the chip rule and '::after' for its hit extension.
    const chipRule = (suffix: string): string => {
      const want = ['deed', 'reliquary'].map(
        (id) => `body.mobile-touch.hud-mobile-compact #${id}-tracker .dt-header${suffix}`,
      );
      for (const m of mobileCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selectors = m[1].split(',').map((s) => s.trim());
        if (want.every((w) => selectors.includes(w))) return m[2];
      }
      return '';
    };
    const chip = chipRule('');
    expect(chip).toContain('position: relative;');
    expect(chip).toContain('min-height: 24px;');
    // 11px is the tracker's own mobile type size (body.mobile-touch
    // #reliquary-tracker), not a new step.
    expect(chip).toContain('font-size: 11px;');
    expect(chip).toContain('padding: 2px 8px;');
    // `auto` is the right-rail hug; the 6px is half of the inter-chip
    // separation the ::after comment reasons about (below).
    expect(chip).toContain('margin: 0 0 6px auto;');
    // Clock family, not a pill (DESIGN.md 14): the #minimap-clock radius,
    // through the one named token (--radius-md is 8px in tokens.css).
    expect(chip).toContain('border-radius: var(--radius-md);');
    expectLiveHitExtension(chipRule('::after'));
    // Two stacked chips must not trade hit area: their 8px extensions (16px
    // combined reach) clear each other only because the chips sit 6px (margin,
    // above) plus the stack's 14px flex gap apart. That gap lives in hud.css
    // and no mobile rule re-declares it; both halves are pinned here because
    // the no-overlap property depends on a constant in a different sheet.
    const hudCss = stripComments(read('../src/styles/hud.css'));
    const stackRule = /#right-tracker-stack \{([^}]*)\}/.exec(hudCss)?.[1] ?? '';
    expect(stackRule).toContain('gap: 14px;');
    for (const m of mobileCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/#right-tracker-stack\s*$/.test(m[1].trim())) {
        expect(m[2], `mobile #right-tracker-stack rule must not re-declare gap`).not.toMatch(
          /\bgap:/,
        );
      }
    }
  });

  it('wires the tracker container in BOTH game entries, under the deed tracker', () => {
    for (const html of [indexHtml, playHtml]) {
      // No aria-hidden on the container: the collapse header is a real,
      // keyboard-reachable toggle (the quest-tracker contract).
      expect(html).toContain('<div id="reliquary-tracker"></div>');
      expect(html).not.toContain('id="reliquary-tracker" aria-hidden');
      const deed = html.indexOf('<div id="deed-tracker"></div>');
      const reliquary = html.indexOf('<div id="reliquary-tracker"></div>');
      expect(deed).toBeGreaterThan(-1);
      expect(reliquary).toBeGreaterThan(deed);
      // Inside the one positioned wrapper, never a free-floating overlay.
      const stack = html.indexOf('<div id="right-tracker-stack">');
      expect(stack).toBeGreaterThan(-1);
      expect(reliquary).toBeGreaterThan(stack);
    }
  });

  it('arms Enter/Space on #reliquary-tracker, stopped before the game binds hijack them', () => {
    const arm = hud.match(
      /\$\('#reliquary-tracker'\)\.addEventListener\('keydown',[\s\S]*?\n {4}\}\);/,
    )?.[0] as string;
    expect(arm).toBeTruthy();
    expect(arm).toContain("if (e.key !== 'Enter' && e.key !== ' ' && e.code !== 'Space') return;");
    expect(arm).toContain('e.preventDefault();');
    expect(arm).toContain('e.stopPropagation();');
    // Keys landing anywhere else in the strip (a row, the bar) must not toggle
    // the collapse: only the header is the control. The WHOLE guard statement,
    // comment-stripped, so a prose mention or a captured-but-unused closest()
    // cannot satisfy it.
    expect(stripComments(arm)).toContain(
      "if (!(e.target as HTMLElement).closest('.dt-header')) return;",
    );
    // The same compact-touch branch as the click delegation: the count chip
    // opens the window, the desktop header toggles the collapse. Ordered, so
    // nothing says openReliquary merely appears somewhere in the arm.
    expect(arm).toMatch(
      /body\.contains\('mobile-touch'\) && body\.contains\('hud-mobile-compact'\)[\s\S]{0,80}?this\.openReliquary\(\);/,
    );
    expect(arm).toContain('this.toggleReliquaryTrackerCollapsed();');
  });

  it('routes the compact-touch tap to the window rather than the invisible collapse', () => {
    const arm = hud.match(
      /\$\('#reliquary-tracker'\)\.addEventListener\('click',[\s\S]*?\n {4}\}\);/,
    )?.[0] as string;
    expect(arm).toBeTruthy();
    expect(arm).toMatch(
      /body\.contains\('mobile-touch'\) && body\.contains\('hud-mobile-compact'\)[\s\S]{0,80}?this\.openReliquary\(\);/,
    );
    // Clicks landing anywhere else in the strip must not toggle the collapse:
    // the whole guard statement, comment-stripped (see the keydown arm).
    expect(stripComments(arm)).toContain(
      "if (!(e.target as HTMLElement).closest('.dt-header')) return;",
    );
  });

  it('persists the tracker collapse as its own settings row', () => {
    expect(settingsSrc).toContain('reliquaryTrackerCollapsed: { def: false },');
    expect(hud).toContain(
      "settings.set('reliquaryTrackerCollapsed', !settings.get('reliquaryTrackerCollapsed'));",
    );
  });

  it('paints the gold focus ring on the focused header', () => {
    expect(hudCss).toMatch(
      /#reliquary-tracker \.dt-header:focus-visible \{\s*outline: 2px solid var\(--gold\);\s*outline-offset: 2px;\s*border-radius: 2px;\s*\}/,
    );
  });

  it('keeps the 40px coarse-pointer floor on the header', () => {
    expect(hudCss).toMatch(
      /@media \(pointer: coarse\) \{\s*#reliquary-tracker \.dt-header \{\s*min-height: 40px;/,
    );
  });

  // The tracker used to fold to a count chip on the compact touch tier. It is now
  // hidden on touch outright: the folded line still landed directly under the
  // minimap in #right-tracker-stack, and the Reliquary window keeps its own touch
  // entry point in the More tray, so hiding it strands nothing.
  it('is hidden outright on touch, and only on touch', () => {
    expect(hudMobile).toMatch(/body\.mobile-touch #reliquary-tracker \{\s*display: none;\s*\}/);
    // The per-tier folds went with it: a hidden element cannot fold.
    expect(hudMobile).not.toContain('#reliquary-tracker .dt-list');
    expect(hudMobile).not.toContain('#reliquary-tracker .dt-chevron');
    // Desktop is untouched: the base rule still paints the strip.
    expect(hudCss).not.toMatch(/#reliquary-tracker \{[^}]*display: none/);
    // And the touch path to the window itself survives the hide.
    expect(read('../index.html')).toContain('id="mobile-reliquary"');
    expect(read('../play.html')).toContain('id="mobile-reliquary"');
  });

  it('never positions itself: the stack wrapper owns the placement', () => {
    const rule = /#reliquary-tracker \{([^}]*)\}/.exec(hudCss)?.[1] ?? '';
    expect(rule).not.toBe('');
    expect(rule).not.toContain('position: absolute');
    expect(rule).not.toMatch(/\btop:/);
  });

  it('carries the fill pulse in CSS and drops it under reduced motion', () => {
    // The flag is computed in the pure core; the motion itself is the
    // stylesheet's job, so a reduced-motion player still sees the new number.
    expect(stripComments(painter)).toContain("w.toggleClass(els.line, 'dt-flash', line.flash);");
    expect(hudCss).toMatch(/#reliquary-tracker \.dt-flash \{\s*animation: reliquary-tracker-flash/);
    expect(hudCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*#reliquary-tracker \.dt-flash \{\s*animation: none;/,
    );
    expect(hudCss).toContain('@keyframes reliquary-tracker-flash');
  });

  it('is registered as a pure core (no DOM reach) in the architecture sweep', () => {
    expect(read('../tests/architecture.test.ts')).toContain("'src/ui/reliquary_tracker_view.ts'");
  });

  it('adds every new chrome key, with its five non-Latin fills (M16)', () => {
    const NEW_KEYS = [
      'trackerLabel',
      'collapseHint',
      'expandHint',
      'openWindowHint',
      'pin',
      'unpin',
      'pinFull',
      'pinAria',
      'unpinAria',
    ];
    // Comment-stripped like every scrape in this family: a commented-out key or
    // an example fill line must never satisfy a presence or value pin.
    const chrome = stripComments(read('../src/ui/i18n.catalog/hud_chrome.ts'));
    for (const key of NEW_KEYS) {
      expect(chrome, key).toContain(`${key}:`);
    }
    // i18n_completeness only sees a leak once en and the locale are byte
    // identical; this pin fails on an omitted row directly. Reads the fill's
    // VALUE, tolerating the line break biome inserts when a long value wraps.
    const fillValue = (table: string, key: string): string | undefined =>
      table.match(new RegExp(`'${key.replace(/\./g, '\\.')}':\\s*\\n?\\s*'([^']*)'`))?.[1];
    for (const locale of ['ja_JP', 'ko_KR', 'ru_RU', 'zh_CN', 'zh_TW']) {
      const table = stripComments(read(`../src/ui/i18n.locales/${locale}.ts`));
      for (const key of NEW_KEYS) {
        const value = fillValue(table, `hudChrome.reliquary.${key}`);
        expect(typeof value, `${locale} ${key} missing`).toBe('string');
        expect(value?.trim(), `${locale} ${key} empty`).not.toBe('');
      }
      // The two templated rows must keep their placeholder, or the count and
      // the page name silently vanish from the translated string.
      expect(fillValue(table, 'hudChrome.reliquary.pinFull'), `${locale} pinFull`).toContain(
        '{cap}',
      );
      expect(fillValue(table, 'hudChrome.reliquary.pinAria'), `${locale} pinAria`).toContain(
        '{name}',
      );
      expect(fillValue(table, 'hudChrome.reliquary.unpinAria'), `${locale} unpinAria`).toContain(
        '{name}',
      );
    }
  });

  it('reuses the shared count and progress keys instead of minting duplicates', () => {
    // Two surfaces already own these shapes; a second copy is a second thing to
    // translate and a second thing to drift.
    expect(stripComments(painter)).toContain("t('hudChrome.questTracker.count'");
    expect(stripComments(painter)).toContain("t('hudChrome.reliquary.progressText'");
  });
});
