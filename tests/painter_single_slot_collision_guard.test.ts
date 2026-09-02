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
 * `this.moreEl` there) or written from two modules. That limit is stated rather
 * than hidden, because a guard read as complete when it is not is worse than no
 * guard.
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
// MEASURED FIRST, then shaped on the number. Option A was prototyped (SingleSlotEntry
// as four independent slots, shouldWriteSingleSlot comparing the requested kind's
// slot) and driven through the whole battery it would have to pass: exactly the three
// pins the row predicted go red (the DEFEAT arm, the entry-shape pin, and the
// cross-kind clobber arm in tests/painter_host.test.ts) and nothing else moves, ARM 2's
// deterministic skip-rate and allocation budgets pass unchanged, and
// tests/painter_slot_collision.test.ts passes with its EXACT write and skip literals,
// which means the real painters' steady-state write set is byte-identical under both
// shapes. The tour (scripts/perf_tour.mjs, headless swiftshader, both viewports, two
// runs each way on the same machine and the same Vite tree): hudHotDomWrites before
// 1052 and 1072 desktop, 575 and 575 mobile; after 1062 and 1079 desktop, 585 and 589
// mobile. No reduction exists to measure, and the after runs sit 7 to 14 writes above
// the before runs on both viewports, inside the 20-write run-to-run band the two before
// runs showed on desktop under software rasterization (the headed golden anchor 1062
// was minted from 1054; this mode agrees with it to within two writes on run 1). The
// per-element price is real and small: +16 bytes per routed element for the four-slot
// record (72 to 88 bytes retained per entry, Node v26, median of five GC-fenced runs),
// +144 bytes for a per-element Map. So the number says: Option A removes ZERO live
// writes today, because every one of the seven shipped sites was already fixed in
// Phase 18 and this scan holds the line, and what it buys is the deletion of the class
// (the shapes the scan admits it cannot see) at +16 bytes per element.
// RULED ON THE NUMBER: Option A is ROUTED OUT of this packet as a maintainer-owned
// change (the row's own reading, taken by the maintainer on the figures above), this
// scan stays the defence, and the follow-up is recorded in
// docs/prd/masterwrought/phase-19-routed-followups.md (row D128). If a collision the
// scan cannot see is ever measured, the prototype and the three pins it reds are the
// starting point.
// The two riders ride regardless: this guard stays keyed on the SHAPE and stays an AST
// walk, and ARM 2's exemption rationale already states the per-(element, KIND)
// guarantee exactly (hud_perf_budget.test.ts, landed 2026-08-31, so that rider was
// already true when the phase document named it).
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
