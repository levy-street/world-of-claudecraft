// The character sheet's progression-block refresh signature, and the HUD latch
// that consumes it.
//
// The defect this closes (deferred from Phase 19 QA, widened at Phase 20 QA): the
// character sheet is a COLD window absent from the HUD's 2 Hz slow band, and the
// surfaces that move its progression block take no optimistic write, so an
// already-open sheet kept showing PREVIOUS state until it was closed and
// reopened. Three rows had the bug, not one: the Book of Deeds picker repaints
// only itself (the active-title line and the border badge row's "worn" word), and
// a relic fill repaints only the tracker (the Reliquary completion pair and the
// Curator rank).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { catalogCharacterCompletion, isCataloguedRelicItem } from '../src/sim/reliquary';
import { charSheetRefreshSig } from '../src/ui/char_sheet_sig_core';

const readRaw = (rel: string): string =>
  readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
// LINE comments only, deliberately: the naive block-comment strip these suites
// usually share treats the `/\/\*...\*\//` regex literals inside a test file as an
// open comment and swallows the rest of the file, which would turn every pin
// below into a vacuous pass. Line stripping cannot false-open.
const read = (rel: string): string => readRaw(rel).replace(/(^|[^:])\/\/.*$/gm, '$1');
// The CORE is read with BOTH comment forms stripped. The line-only reader above
// left the core's own JSDoc and header block as live text, so the purity pin
// below was really scanning prose: a doc sentence that happened to mention
// `document` or `Date.now` would have failed it, and (the direction that
// matters) a future doc rewrite could have kept it green while describing what
// the code no longer does. Block stripping is safe HERE and nowhere else in this
// file: the core is 80 lines of JSDoc and one JSON.stringify, with no regex
// literal anywhere for `/*` to false-open on. Asserted, not assumed, below.
const readCore = (rel: string): string =>
  readRaw(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** A full parts object; each test moves exactly ONE field off this baseline. */
const base = {
  activeTitle: 'prog_veteran' as string | null,
  activeBorder: 'deepward' as string | null,
  deedsEarned: 12,
  itemsDiscovered: 40,
  marks: 3,
  mounts: 5,
};

describe('charSheetRefreshSig', () => {
  it('is stable for equal input, so an unchanged pass never repaints', () => {
    expect(charSheetRefreshSig(base)).toBe(charSheetRefreshSig({ ...base }));
    const empty = {
      activeTitle: null,
      activeBorder: null,
      deedsEarned: 0,
      itemsDiscovered: 0,
      marks: 0,
      mounts: 0,
    };
    expect(charSheetRefreshSig(empty)).toBe(charSheetRefreshSig({ ...empty }));
  });

  // Per-field negative cases, one per signed field, not one "something changed"
  // case: a signature that dropped any single field would still pass a combined
  // test. Each case holds the other five fixed, so it names the field it covers.
  it('moves when the worn TITLE changes', () => {
    expect(charSheetRefreshSig(base)).not.toBe(
      charSheetRefreshSig({ ...base, activeTitle: 'prog_champion' }),
    );
  });

  it('moves when the worn BORDER changes', () => {
    expect(charSheetRefreshSig(base)).not.toBe(
      charSheetRefreshSig({ ...base, activeBorder: 'col_reliquary_rank_5' }),
    );
  });

  it('moves when a BORDER DEED is earned (the badge row was stale before)', () => {
    // Earning a border deed with the sheet open repainted nothing until this
    // field joined the signature: the row is built by filtering deedsEarned.
    expect(charSheetRefreshSig(base)).not.toBe(
      charSheetRefreshSig({ ...base, deedsEarned: base.deedsEarned + 1 }),
    );
  });

  it('moves when an ITEM RELIC fills (the Reliquary pair was stale before)', () => {
    expect(charSheetRefreshSig(base)).not.toBe(
      charSheetRefreshSig({ ...base, itemsDiscovered: base.itemsDiscovered + 1 }),
    );
  });

  it('moves when a MARK fills', () => {
    expect(charSheetRefreshSig(base)).not.toBe(
      charSheetRefreshSig({ ...base, marks: base.marks + 1 }),
    );
  });

  it('moves when a MOUNT relic is gained or lost', () => {
    // Mounts are the one signed surface that can shrink (reins sold or banked
    // away), so both directions are covered.
    expect(charSheetRefreshSig(base)).not.toBe(
      charSheetRefreshSig({ ...base, mounts: base.mounts + 1 }),
    );
    expect(charSheetRefreshSig(base)).not.toBe(
      charSheetRefreshSig({ ...base, mounts: base.mounts - 1 }),
    );
  });

  it('distinguishes worn from unworn in BOTH id slots (the take-off edge)', () => {
    // Taking a title or a border OFF is the same staleness bug in reverse; the
    // sheet must converge on the way down too.
    expect(charSheetRefreshSig({ ...base, activeTitle: null })).not.toBe(
      charSheetRefreshSig({ ...base, activeTitle: null, activeBorder: null }),
    );
    expect(charSheetRefreshSig({ ...base, activeBorder: null })).not.toBe(
      charSheetRefreshSig({ ...base, activeTitle: null, activeBorder: null }),
    );
  });

  it('never lets the two ID slots swap into the same signature', () => {
    // A signature that concatenated the ids would read the same for a swapped
    // pair; the fixed slot array is what keeps them distinct.
    expect(
      charSheetRefreshSig({ ...base, activeTitle: 'deepward', activeBorder: 'prog_veteran' }),
    ).not.toBe(
      charSheetRefreshSig({ ...base, activeTitle: 'prog_veteran', activeBorder: 'deepward' }),
    );
  });

  it('never lets two COUNT slots swap into the same signature', () => {
    // Four numeric slots is where a summed or concatenated signature would go
    // wrong: 40 discovered + 3 marks and 3 discovered + 40 marks are different
    // collections that a sum would read as one.
    expect(charSheetRefreshSig({ ...base, itemsDiscovered: 40, marks: 3 })).not.toBe(
      charSheetRefreshSig({ ...base, itemsDiscovered: 3, marks: 40 }),
    );
    expect(charSheetRefreshSig({ ...base, deedsEarned: 12, mounts: 5 })).not.toBe(
      charSheetRefreshSig({ ...base, deedsEarned: 5, mounts: 12 }),
    );
  });

  // The two blind spots the core's own comment names and ACCEPTS. Pinned so a
  // later reader meets the documented behavior as a test rather than as prose,
  // and so a future widening that closes one has to move a pin on purpose.
  it('accepts the cancelling-mount blind spot: a swap inside ONE band is invisible', () => {
    // From the core: "a mount add plus a mount remove inside ONE 500 ms band
    // cancel out, the same documented blind spot the tracker's signature
    // carries". The latch samples at band boundaries only, so selling one set of
    // reins and buying another inside a single band leaves the signed SIZE where
    // it started and the sheet keeps the old row until the next real change.
    const start = charSheetRefreshSig(base);
    // The add on its own really does move it (the control that keeps the
    // equality below from being a comparison of a constant with itself) ...
    expect(charSheetRefreshSig({ ...base, mounts: base.mounts + 1 })).not.toBe(start);
    // ... and the matching removal inside the same band puts it back.
    expect(charSheetRefreshSig({ ...base, mounts: base.mounts + 1 - 1 })).toBe(start);
  });

  it('accepts the non-catalogued discovery blind spot: sig moves, the PAIR does not', () => {
    // Also from the core: "a discovery that is not a catalogued relic moves the
    // signature without moving the pair, which costs one repaint of identical
    // HTML". Driven against the real completion helper, so the claim is about
    // what the sheet would print and not only about the counts.
    expect(isCataloguedRelicItem('cryptbone_helm'), 'fixture: a catalogued relic').toBe(true);
    expect(isCataloguedRelicItem('rusty_dagger'), 'fixture: outside the catalog').toBe(false);
    const discovered = new Set(['cryptbone_helm']);
    const pairBefore = catalogCharacterCompletion({ itemsDiscovered: discovered });
    const sigBefore = charSheetRefreshSig({ ...base, itemsDiscovered: discovered.size });

    discovered.add('rusty_dagger');
    const pairAfter = catalogCharacterCompletion({ itemsDiscovered: discovered });
    const sigAfter = charSheetRefreshSig({ ...base, itemsDiscovered: discovered.size });

    expect(pairAfter, 'the pair the sheet prints must not move').toEqual(pairBefore);
    expect(pairAfter.owned, 'and it is a real pair, not two zeroes').toBe(1);
    expect(sigAfter, 'but the size-based signature does, costing one repaint').not.toBe(sigBefore);
  });

  it('is pure: no DOM, no i18n, no world import', () => {
    const src = readCore('src/ui/char_sheet_sig_core.ts');
    // The stripper is only safe while the core stays regex-free; if a regex
    // literal ever lands there, `/*` inside it could false-open and swallow the
    // rest of the file, making every token check below pass vacuously.
    expect(src, 'the core must stay regex-free for the block stripper to be safe').not.toMatch(
      /=\s*\//,
    );
    expect(src.length, 'block stripping must not have swallowed the file').toBeGreaterThan(200);
    expect(src, 'the stripped core must still contain its one expression').toContain(
      'JSON.stringify',
    );
    for (const token of ['document', 'window', './i18n', 'sim/sim', 'Date.now']) {
      expect(src, `the core must not reach ${token}`).not.toContain(token);
    }
  });

  it('is registered as a pure core in the architecture sweep', () => {
    // Anchored to a whole list line, so a commented-out registration
    // (`// 'src/ui/...'`) cannot satisfy it.
    expect(readRaw('tests/architecture.test.ts')).toMatch(
      /^\s*'src\/ui\/char_sheet_sig_core\.ts',$/m,
    );
  });
});

describe('the HUD latch that converges the open character sheet', () => {
  const hud = read('src/ui/hud.ts');

  it('reads every signed surface from the world and latches the signature', () => {
    const at = hud.indexOf('private refreshCharSheetIfChanged(): void {');
    expect(at, 'refreshCharSheetIfChanged is missing from hud.ts').toBeGreaterThan(-1);
    const body = hud.slice(at, at + 620);
    expect(body).toContain('charSheetRefreshSig({');
    // Every field the core signs has to actually be fed from the world, or the
    // widening is cosmetic: a call site that passed a constant would keep the
    // core's own per-field tests green while the sheet stayed stale.
    expect(body).toContain('activeTitle: this.sim.activeTitle,');
    expect(body).toContain('activeBorder: this.sim.activeBorder,');
    expect(body).toContain('deedsEarned: this.sim.deedsEarned.size,');
    expect(body).toContain('itemsDiscovered: this.sim.deedStats.itemsDiscovered.size,');
    expect(body).toContain('marks: this.sim.reliquaryMarks.size,');
    expect(body).toContain('mounts: this.sim.ownedMounts().length,');
    expect(body).toContain('if (sig === this.lastCharSheetSig) return;');
    expect(body).toContain('this.lastCharSheetSig = sig;');
    // ORDER, not just presence: hoisting the assignment above the compare
    // leaves both literals in the body while the sheet never repaints again,
    // which is the exact staleness this latch exists to fix. The slice must
    // stay block-comment-free, or a /* commented copy */ of the compare above
    // a hoisted assignment could satisfy the ordering while the latch is dead
    // (read() strips line comments only for this file).
    expect(body).not.toContain('/*');
    expect(
      body.indexOf('if (sig === this.lastCharSheetSig) return;'),
      'the latch must compare before it assigns',
    ).toBeLessThan(body.indexOf('this.lastCharSheetSig = sig;'));
    // renderIfOpen, not render: a closed sheet must never be painted.
    expect(body).toContain('this.charWindow.renderIfOpen();');
  });

  it('rides the 2 Hz slow band beside its profession sibling', () => {
    expect(hud).toContain('if (slowHud) this.refreshCharSheetIfChanged();');
    // Adjacency to the sibling is the design claim (same band, same cadence),
    // so pin the order rather than mere presence.
    const sibling = hud.indexOf('if (slowHud) this.refreshOpenProfessionSurfacesIfChanged();');
    const mine = hud.indexOf('if (slowHud) this.refreshCharSheetIfChanged();');
    expect(sibling).toBeGreaterThan(-1);
    expect(mine).toBeGreaterThan(sibling);
  });

  it('takes NO optimistic write: the picker still repaints only itself', () => {
    // Both hosts converge through the signature instead (offline the sim setter
    // is synchronous, online the atitle/aborder echo lands inside one band), so
    // the deeds picker must not have grown a charWindow repaint of its own.
    const picker = read('src/ui/deeds_window.ts');
    // Positive control, added at Phase 20 QA: `charWindow` is a token that never
    // appeared in this file, so on its own the negative below is a dead
    // alternate that would stay green over an empty read or a mistyped path.
    // The picker's OWN repaint is what proves the read reached the right source.
    expect(picker, 'the picker must repaint itself').toContain('this.render()');
    expect(picker).not.toContain('charWindow');
  });

  it('the sheet rebuild is a FULL render, so every progression row comes back fresh', () => {
    // The bug spans the whole block (the border badge's worn word, the active
    // title line, the Reliquary pair and rank); a partial repaint would fix one
    // and leave the others. The window's renderIfOpen delegates to the
    // whole-sheet render.
    const win = read('src/ui/char_window.ts');
    const at = win.indexOf('renderIfOpen()');
    expect(at).toBeGreaterThan(-1);
    expect(win.slice(at, at + 160)).toContain('this.render()');
    // And every signed row is painted from the same progression block the HUD
    // builds, which is what makes ONE signature the right shape for all of them.
    const progression = hud.slice(hud.indexOf('private progressionHtml(level: number): string {'));
    const body = progression.slice(0, 2600);
    expect(body).toContain('sim.activeBorder');
    expect(body).toContain('sim.activeTitle');
    expect(body).toContain('sim.deedsEarned.has(id)');
    expect(body).toContain('reliquarySheetProgressionHtml(buildReliquarySheetModel(sim))');
  });
});
