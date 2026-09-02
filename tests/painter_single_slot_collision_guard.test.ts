// THE GUARD for the single-slot write-elision collision.
//
// makeWriterFacet's four single-slot writers (setText / setDisplay /
// setTransform / setWidth) share ONE `{ kind, value }` cache entry per element.
// Two DIFFERENT single-slot writers on the same element therefore flip that
// entry on every call and BOTH bypass elision forever. Nothing renders wrong, so
// no behavior test anywhere fails; the writes simply never elide and they count
// as real writes in hotDomWrites. The mechanism is pinned in
// tests/painter_host.test.ts and the real painters in
// tests/painter_slot_collision.test.ts. This file stops it coming back.
//
// WHY A SCAN AND NOT A TYPE. The cache shape is what makes the collision
// possible, and a slot key on the four writers would delete the class outright
// (see the recommendation in this file's tail comment). That is a change to the
// hottest cache in the HUD and to the allocation contract painter_host.test.ts
// pins in three places, so it is a maintainer decision, measured against
// tests/hud_perf_budget.baseline.md, not something a fix unit slips in. Until
// then this scan holds the line at no cost to the running client.
// (RULED 2026-09-02: that decision was taken, on a measurement; see the tail comment.
// The slot key is routed out of the packet and this scan stays the defence.)
//
// AST, NOT REGEX, and that is load-bearing: the shape is a CALL, so a parameter
// declaration (`setText(el: HTMLElement, text: string): void` in
// painter_host.ts's own interface) and a helper's signature are not call
// expressions and never reach the finding list. A text scan reports both as
// collisions, which is exactly the noise that makes a guard get muted.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { tsFilesUnder } from './helpers/ts_files_under';

const require_ = createRequire(import.meta.url);
// The TypeScript 6 JS API wrapper (CONTRIBUTING.md, "TypeScript toolchain"): the
// `tsc` binary is the TS7 native one and exposes no createSourceFile.
// biome-ignore lint/suspicious/noExplicitAny: the JS API ships no types at this entry.
const ts = require_('typescript') as any;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UI_ROOT = path.join(repoRoot, 'src/ui');

/** The four writers that share one cache entry per element. */
const SINGLE_SLOT = new Set(['setText', 'setDisplay', 'setTransform', 'setWidth']);

interface Collision {
  file: string;
  /** The receiver expression, e.g. `this.writers`. */
  receiver: string;
  /** The first-argument source text, e.g. `rec.stacks`. */
  element: string;
  /** Each colliding kind with the lines it is called on. */
  kinds: { kind: string; lines: number[] }[];
}

interface ScanResult {
  files: number;
  filesWithWriterCalls: number;
  callSites: number;
  collisions: Collision[];
}

/**
 * Group every single-slot writer CALL in every `.ts` under `root` by
 * (receiver expression, first-argument expression), and report each group
 * reached by more than one kind.
 *
 * Keyed on the SOURCE TEXT of the receiver and the element expression, which is
 * what makes this cheap and also bounds what it can see: it catches the shape
 * that actually ships, two writers naming one node in one module. It does NOT
 * catch an element reached through two different expressions (`d.more` here,
 * `this.moreEl` there) or written from two modules, and it walks src/ui only
 * (UI_ROOT), which is lossless today because no module under src outside src/ui
 * imports painter_host. That limit is stated rather than hidden, because a guard read as
 * complete when it is not is worse than no guard.
 */
function scanSingleSlotCollisions(root: string): ScanResult {
  const files = tsFilesUnder(root);
  let filesWithWriterCalls = 0;
  let callSites = 0;
  const collisions: Collision[] = [];
  for (const { file, full } of files) {
    const text = readFileSync(full, 'utf8');
    let mayCall = false;
    for (const kind of SINGLE_SLOT) if (text.includes(`${kind}(`)) mayCall = true;
    if (!mayCall) continue;
    const sf = ts.createSourceFile(full, text, ts.ScriptTarget.Latest, true);
    // key -> kind -> lines
    const groups = new Map<string, Map<string, number[]>>();
    let sawCall = false;
    // biome-ignore lint/suspicious/noExplicitAny: untyped TS AST nodes.
    const visit = (node: any): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const kind = node.expression.name.text as string;
        if (SINGLE_SLOT.has(kind) && node.arguments.length >= 1) {
          sawCall = true;
          callSites++;
          // NUL joins the two halves because it is the one character that cannot
          // occur in TypeScript source text, so no receiver or element expression can
          // forge a boundary (`d.objectives[i + 1]` carries spaces, and a space
          // separator would split it in the wrong place). Spelled as the ESCAPE and
          // never as a raw byte: a literal 0x00 in the file makes git classify this
          // .ts as BINARY, so `git diff` renders it as `Bin` and every review of this
          // guard goes blind. It shipped that way once, in d8feee8fa8.
          const key = `${node.expression.expression.getText(sf)}\u0000${node.arguments[0].getText(sf)}`;
          let kinds = groups.get(key);
          if (kinds === undefined) {
            kinds = new Map();
            groups.set(key, kinds);
          }
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          const lines = kinds.get(kind);
          if (lines === undefined) kinds.set(kind, [line]);
          else lines.push(line);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    if (sawCall) filesWithWriterCalls++;
    for (const [key, kinds] of groups) {
      if (kinds.size < 2) continue;
      const [receiver, element] = key.split('\u0000');
      collisions.push({
        file,
        receiver,
        element,
        kinds: [...kinds.entries()].map(([kind, lines]) => ({ kind, lines })),
      });
    }
  }
  return { files: files.length, filesWithWriterCalls, callSites, collisions };
}

function describeCollision(c: Collision): string {
  const where = c.kinds.map((k) => `${k.kind}@${k.lines.join(',')}`).join(' + ');
  return `${c.file}: ${c.receiver}.<writer>(${c.element}) reached by ${where}`;
}

describe('single-slot writer collisions: none in src/ui', () => {
  const result = scanSingleSlotCollisions(UI_ROOT);

  it('no element takes two different single-slot writers', () => {
    // Seven shipped before this guard: auras_painter (the stacks badge, per
    // frame, per stacking aura), quest_strip_painter three times (the complete
    // marker, every objective line, the "+N more" line), yumi_match_painter (the
    // sub line), battleground_scoreboard_painter (the respawn line) and hud.ts
    // (#map-level-toggle). Each was fixed by giving the second facet its OWN
    // cache slot: visibility moved to setStyleProp, keyed (element, 'display'),
    // which writes the same inline display it always did.
    expect(
      result.collisions.map(describeCollision),
      'give the second facet its own cache slot (setStyleProp / toggleClass / setAttr), or use two elements',
    ).toEqual([]);
  });

  it('actually scanned the tree (vacuity floors)', () => {
    // Floors near the real counts, so a detector that quietly stopped matching
    // (a renamed writer, a broken walk, an AST shape change) fails here instead
    // of reporting a clean tree. MEASURED on 2026-08-31, never guessed: 812 .ts
    // files under src/ui, 35 of them CALLING a single-slot writer, 185 call
    // sites. Each floor sits just under its measurement, close enough that
    // losing one painter's worth of calls reds it.
    //
    // 35, not the 40 a text scan reports: five more files NAME a writer without
    // calling one (painter_host.ts's own interface, hud.ts's private mirrors,
    // the type-only importers). That gap is the AST's whole value here, which is
    // why the floor is pinned to the AST's number and not the text scan's.
    expect(result.files).toBeGreaterThanOrEqual(780);
    expect(result.filesWithWriterCalls).toBeGreaterThanOrEqual(32);
    expect(result.callSites).toBeGreaterThanOrEqual(175);
  });

  it('reads the tree only through the shared walker', () => {
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under']);
  });
});

describe('the detector itself, driven over a fixture tree', () => {
  // The repo rule for a scan guard (tests/CLAUDE.md): pin the RECURSION and the
  // detection against a temp tree driving the guard's own producer, because over
  // the real tree a recursive walk and a flat one return the same list today and
  // no assertion can tell them apart.
  function fixture(files: Record<string, string>): string {
    const root = mkdtempSync(path.join(tmpdir(), 'slot-collision-'));
    for (const [rel, body] of Object.entries(files)) {
      const full = path.join(root, rel);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, body, 'utf8');
    }
    return root;
  }

  it('finds a collision nested in a SUBDIRECTORY, not just at the root', () => {
    const root = fixture({
      'deep/nested/painter.ts': [
        'export function paint(w: W, el: E): void {',
        "  w.setText(el, 'x');",
        "  w.setDisplay(el, 'none');",
        '}',
      ].join('\n'),
    });
    const found = scanSingleSlotCollisions(root).collisions;
    expect(found).toHaveLength(1);
    expect(found[0].file).toBe('deep/nested/painter.ts');
    expect(found[0].element).toBe('el');
    expect(found[0].kinds.map((k) => k.kind).sort()).toEqual(['setDisplay', 'setText']);
  });

  it('passes a painter that gives the second facet its own slot', () => {
    const root = fixture({
      'ok.ts': [
        'export function paint(w: W, el: E): void {',
        "  w.setText(el, 'x');",
        "  w.setStyleProp(el, 'display', 'none');",
        "  w.toggleClass(el, 'done', true);",
        '}',
      ].join('\n'),
    });
    expect(scanSingleSlotCollisions(root).collisions).toEqual([]);
  });

  it('passes two DIFFERENT elements taking one writer each', () => {
    const root = fixture({
      'ok2.ts': [
        'export function paint(w: W, a: E, b: E): void {',
        "  w.setText(a, 'x');",
        "  w.setDisplay(b, 'none');",
        '}',
      ].join('\n'),
    });
    expect(scanSingleSlotCollisions(root).collisions).toEqual([]);
  });

  it('passes the same writer twice on one element (that is ordinary, and elides)', () => {
    const root = fixture({
      'ok3.ts': [
        'export function paint(w: W, el: E, on: boolean): void {',
        "  if (on) w.setDisplay(el, 'block');",
        "  else w.setDisplay(el, 'none');",
        '}',
      ].join('\n'),
    });
    expect(scanSingleSlotCollisions(root).collisions).toEqual([]);
  });

  it('ignores a DECLARATION of the same names, which a text scan reports', () => {
    // painter_host.ts's own interface declares all four, and hud.ts declares its
    // private mirrors. Neither is a call, so neither can collide. This is the
    // arm that keeps the guard quiet enough to stay switched on.
    const root = fixture({
      'iface.ts': [
        'export interface W {',
        '  setText(el: E, text: string): void;',
        '  setDisplay(el: E, display: string): void;',
        '}',
      ].join('\n'),
    });
    const result = scanSingleSlotCollisions(root);
    expect(result.collisions).toEqual([]);
    expect(result.callSites).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// THE RECOMMENDATION the head comment defers to, written down rather than acted
// on, because both options below are maintainer calls (one changes the hottest
// cache in the HUD, the other widens a standing gate's reach).
//
// RULED (qr-19-single-slot-writer-slot-key, 2026-09-02, under qr-19-best-for-project):
// MEASURED FIRST, then shaped on the number; the evidence is committed under
// docs/screenshots/masterwrought-phase-19e/ (the prototype as
// d128-option-a-prototype.patch, the tour summaries, the heap probe and its output).
//
// THE PROOF OF ZERO is deductive, and the tour corroborates it. With all seven shipped
// sites fixed, every element the HUD routes a write through carries ONE kind, and for a
// single-kind element the two predicates (`entry.kind === kind && entry.value === value`
// against `entry[kind] === value`) are the same predicate, so Option A changes no live
// write. The prototype (SingleSlotEntry as four independent slots, shouldWriteSingleSlot
// comparing the requested kind's slot) was driven through the four suites that touch
// the seam (this file, tests/painter_host.test.ts, tests/painter_slot_collision.test.ts,
// tests/hud_perf_budget.test.ts: 195 cases, 188 passed, 3 failed, 4 skipped, the
// skipped four being ARM 3 with its tour env unset). The three reds are exactly the
// three pins the row predicted (the DEFEAT arm, the entry-shape pin inside the
// "skip path neither re-sets the cache nor mints" arm, and the cross-kind clobber arm),
// and no fourth arm moves. What the green arms prove is bounded: ARM 2's floors and
// `extra === 0` are immune to added skips, so they show nothing got WORSE, and
// tests/painter_slot_collision.test.ts drives two painters with exact write literals
// and positive skip floors, so it shows those two painters' steady-state write sets
// are empty under both shapes, no more.
//
// THE TOUR (scripts/perf_tour.mjs, headless swiftshader, both viewports, two runs each
// way on one Vite process and one tree, the merge tip 2ebe95e731, Chrome 152 headless,
// macOS 26.5.2, Node v26.5.0): hudHotDomWrites before 1052 and 1072 desktop, 575 and
// 575 mobile; after 1062 and 1079 desktop, 585 and 589 mobile. The per-step series
// is in the committed summary, and what it shows is bounded. Through the first
// four steps the eight series agree exactly, except where one run rendered
// markedly fewer frames at that step (before-run2 desktop at the fourth step, 20
// frames against 33 to 39; before-run1 mobile at the second, 9 against 21 to 24).
// At the look and final steps the count is still climbing (desktop 5.3 to 6.5
// writes per frame, mobile 6.1 to 9.8: the headless mode renders 39 to 100 frames
// against the headed golden's 1,400 plus, so the world never reaches the steady
// state where this metric becomes the run-length-independent anchor the baseline
// defines), and there the series vary run to run on BOTH sides independent of the
// shape: the one desktop pair at equal frames reads identical (+37 over 7 frames on
// before-run1 and after-run1), while mobile's after runs sit 7 to 10 writes above
// its before runs at comparable frame counts (+46 at 6 frames against +39 at 6).
// That mobile excess cannot be the shape: the four-slot cache elides a superset of
// what the single slot elides, so Option A can only remove writes, and any after
// figure above a before figure is tour variation. So the tour is corroboration,
// not the proof: no reduction appeared inside a 27-write spread across the four
// runs, which bounds the scan's admitted blind spot (a hidden hot per-frame
// cross-kind site would add roughly 80 to 200 writes over that window), and a
// reduction smaller than that window would be invisible here. Every tour exited 1
// on pre-existing console lines (character asset
// not preloaded: two on desktop, one on mobile), with zero budget or FCT failures;
// the after runs served the four-slot shape (the Vite log records the painter_host
// reload between the before and after runs and the reload of the revert after).
// THESE ARTIFACTS MUST NEVER BE FED TO ARM 3: three of the four desktop captures sit
// at or above the committed anchor 1062 (before-run2 read 1072 on UNMODIFIED code),
// and they are frame-floor-ineligible anyway (ARM 3 never checks an artifact's gpuMode,
// a pre-existing gap the frame floor covers; carried for the maintainer); a golden
// update, if the shape ever lands and the anchor moves, is a headed PERF_GPU=1
// two-run capture, never this mode.
//
// THE PRICE: the establishing write still allocates ONE object per element, only
// bigger (a four-slot record; only a per-element Map would add an allocation). Retained
// per entry, Node v26 without pointer compression, 200,000 entries in an array,
// GC-fenced heapUsed delta, median of five, shared value strings (the harness is the
// committed d128-slot-entry-heap-probe.mjs, run with node --expose-gc): 72 bytes for
// the two-field entry, 88 for
// the four-slot record, 216 for a Map, so +16 bytes per routed element in Node and
// about +8 in Chrome, whose V8 runs pointer compression; the absolutes include the
// array slot and the value string and exclude the WeakMap entry, so the delta is the
// sound number.
//
// So the number says: Option A removes ZERO live writes today and costs about +8
// bytes per routed element in the browser, and what it buys is the deletion of the
// class for the shapes this scan cannot see. RULED ON THE NUMBER: Option A is ROUTED
// OUT of this packet as a maintainer-owned change (the row's own reading, taken by the
// maintainer on the figures above), this scan stays the defence, and the follow-up is
// recorded in docs/prd/masterwrought/phase-19-routed-followups.md (row D128). If a
// collision the scan cannot see is ever measured, the committed patch and the three
// pins it reds are the starting point.
// The one rider rides regardless: this guard stays keyed on the SHAPE and stays an AST
// walk; ARM 2's exemption rationale already states the per-(element, KIND) guarantee
// exactly (hud_perf_budget.test.ts, landed 2026-08-31, before the phase document named
// it as a rider).
//
// The scan above is the CHEAP half and it is already in place. What follows is
// what would make the class impossible rather than merely detected, with what
// each actually costs, so the choice is between two priced options and not
// between a proposal and silence.
//
// OPTION A, delete the class: give the four single-slot writers a slot key, the
// way setStyleProp / toggleClass / setAttr already have one.
//   The change: `SingleSlotEntry` stops being `{ kind, value }` (ONE facet per
//   element) and becomes four independent slots, either a small fixed-shape
//   record or a per-element Map keyed by SingleSlotKind. `shouldWriteSingleSlot`
//   compares the slot for the requested kind instead of comparing `kind` at all,
//   and the collision cannot be expressed: two kinds on one element are then two
//   entries, exactly as two style props are today.
//   COST, and it is real:
//    - Memory on the hot path. The cache is a WeakMap over EVERY element the HUD
//      ever routes a write through (party and raid rows, aura nodes, the FCT
//      pool, every action-bar slot). Today each holds one 2-field object; a
//      four-slot record makes every such element pay for four, and almost all of
//      them only ever take ONE kind. A per-element Map is worse per element and
//      allocates on first write. This is the reason the shape is what it is: the
//      2-field entry was chosen so the elided path allocates NOTHING after an
//      element's first routed write.
//    - `shouldWriteSingleSlot` is shared VERBATIM by Hud's own private writers
//      and by makeWriterFacet, over the SAME cache, so the two can never disagree
//      about an element. Both sides change together or the invariant goes.
//    - tests/painter_host.test.ts pins the allocation-free skip path and the
//      decision table (including the arm proving two kinds on one element must
//      NOT false-elide, which under Option A becomes a different assertion about
//      a different structure). Those pins are rewritten, not adjusted.
//    - It must be MEASURED against tests/hud_perf_budget.baseline.md, not argued:
//      the payoff is real writes removed, the price is per-element memory and a
//      slightly longer lookup, and only a tour capture can say which wins.
//   WHAT IT BUYS beyond this scan: it also fixes the shapes this scan admits it
//   cannot see (one element reached through two different expressions, or written
//   from two modules), because it removes the collision rather than reporting it.
//
// OPTION B, keep the scan and widen it. Cheaper, and strictly a detection story.
//   The change: extend the grouping key past a single module, so an element
//   reached as `d.more` in one file and `this.moreEl` in another is one group.
//   COST: it needs an identity the scan does not have today. Source text is what
//   makes this cheap; going cross-module means either a naming convention nobody
//   has agreed to, or type resolution (a real TS program, not createSourceFile),
//   which turns a 40 ms scan into a full-program typecheck inside a Vitest.
//   It also cannot ever cover a receiver held in a variable that crosses a call
//   boundary, so it buys reach, never completeness.
//
// WHICHEVER IS CHOSEN, key the guard on the SHAPE, never on names, and keep it an
// AST walk. Two of the seven shipped sites had a LOOP VARIABLE as the receiver
// (quest_strip_painter's objective lines, battleground_scoreboard_painter's
// respawn line), which is exactly what a name-keyed or regex detector walks past:
// the original defect list named four sites, and the AST scan found seven.
