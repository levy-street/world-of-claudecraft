// The managed-window close registry (#2517).
//
// `Hud.closeAll()` reaches a window through `topmostOpenWindow()`, whose whole vocabulary is
// the CSS selector `.window.panel`. Whatever it finds goes to `closeManagedWindow`, which
// switches on `el.id`; anything with no `case` falls to `default:`, a bare
// `el.style.display = 'none'` plus `hideTooltip()`. So membership in that selector is what
// enrols a window, and a `case` is what gives it a real teardown. Nothing connected the two:
// `#lockpick-panel` sat on the default arm for its whole life, leaking a 100ms countdown and
// a focus trap on every gamepad escape, and no test could notice.
//
// This is the connection. Every id in the family is classified exactly once, and a new
// `.window.panel` in the markup fails the suite until its author says which bucket it is in.
// The point is not the ids; it is that "needs no teardown" becomes a claim someone WROTE
// rather than the silent default of having forgotten.
//
// The case list is read with the TypeScript compiler API rather than a regex over the source
// text. `src/ui/hud.ts` carries dozens of regex literals in its server-text matchers, some
// holding an apostrophe or an escaped slash, and a hand-rolled scan over it has already
// been wrong twice invisibly (see tests/helpers/method_call_sites.ts). A `case '...'` inside
// one of the file's other switches, or inside a comment or a string, must not count.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { tsFilesUnder } from './helpers/ts_files_under';

const root = fileURLToPath(new URL('..', import.meta.url));
const hudTs = readFileSync(`${root}src/ui/hud.ts`, 'utf8');
const indexHtml = readFileSync(`${root}index.html`, 'utf8');
const playHtml = readFileSync(`${root}play.html`, 'utf8');

/**
 * `.window.panel` ids that are built in code instead of shipped in the markup, so
 * `topmostOpenWindow()` still selects them but no HTML entry lists them. Value = the module
 * that creates the element. A fourth site written as `className = '...'` or
 * `classList.add(...)` fails the count pin below; a panel minted through innerHTML,
 * setAttribute('class', ...), or `className +=` is out of that scan's reach and would need
 * its own row here.
 */
const CODE_BUILT: Record<string, string> = {
  'confirm-dialog': 'src/ui/hud.ts (confirmDialog + inputDialog share the one id)',
  'profession-tutorial': 'src/ui/profession_tutorial_window.ts',
  'dev-command-window': 'src/ui/dev_command_window.ts',
};

/**
 * Ids an EARLIER arm of `closeAll()` claims before the `topmostOpenWindow()` scan ever runs,
 * so `closeManagedWindow` is unreachable for them and a `case` would be dead code. Each is
 * checked below to really precede the scan in the source.
 */
const CLOSED_BEFORE_THE_SCAN: Record<string, string> = {
  'delve-rite-panel':
    "closeAll's `$('#delve-rite-panel').style.display === 'block'` arm routes it to " +
    'closeRitePanel -> RiteController.close(), which releases its focus trap. That arm is its ' +
    'only teardown ON THE closeAll PATH (its own X, choose(), and the delveRitePulse handler ' +
    'close it otherwise), so the ordering pin below is what defends it: move the arm under the scan ' +
    'and the panel falls to the default hide with its trap still armed, the #2517 defect.',
};

/**
 * Ids deliberately left on the `default:` arm: their own close affordance is the same bare
 * hide, and they own no trap, no timer, and no state the next open does not re-seed. This is
 * the "recorded as not needing one" half of the contract, and each entry is a claim its
 * author checked, not a leftover.
 */
const NO_MANAGED_TEARDOWN: Record<string, string> = {
  'map-window':
    "#map-close's own handler is the identical hide + hideTooltip, and closeManagedWindow " +
    'adds the same syncAnyWindowOpenState. No trap, no timer: updateMapWindow is driven by ' +
    "Hud.update()'s mediumHud band behind a display === 'block' gate, so the hide stops it, " +
    'and the mapPing / mapZoneOverride the toggle clears are re-seeded by the next open.',
  'report-window':
    "Its X and Cancel buttons are literally `el.style.display = 'none'` and nothing else, so " +
    'the default arm is a strict superset of its own close path. No trap, no timer, and the ' +
    'reason dropdown lives on a node the next open replaces. (Its in-flight submit closure ' +
    'captures the PANEL, which persists, so a stale resolve can still touch a reopened ' +
    'window: pre-existing on every close path alike, and no business of this arm.)',
};

/**
 * The switch inside `Hud.closeManagedWindow`: what it keys on, and its `case '<id>':` labels.
 *
 * The discriminant comes back too, because the case labels only mean "a window id" for as long
 * as the switch is still keyed on one. Rewritten to switch on a class or a state enum, the
 * labels would parse exactly the same and every diff below would compare two unrelated sets.
 */
function readCloseManagedWindowSwitch(source: string): {
  on: string;
  cases: string[];
  /** Each case label mapped to its OWN statements, comments excluded by construction. */
  bodies: Record<string, string[]>;
  /** The `default:` arm, the premise every NO_MANAGED_TEARDOWN row leans on. */
  fallback: string[];
} {
  const file = ts.createSourceFile('hud.ts', source, ts.ScriptTarget.Latest, true);
  let method: ts.MethodDeclaration | null = null;
  const findMethod = (node: ts.Node): void => {
    if (ts.isMethodDeclaration(node) && node.name.getText() === 'closeManagedWindow') method = node;
    else ts.forEachChild(node, findMethod);
  };
  ts.forEachChild(file, findMethod);
  if (!method) throw new Error('closeManagedWindow not found in the source');
  // The switch this method OWNS, not one nested inside a callback it happens to contain.
  let found: ts.SwitchStatement | null = null;
  const findSwitch = (node: ts.Node): void => {
    if (found) return;
    if (ts.isSwitchStatement(node)) {
      found = node;
      return;
    }
    ts.forEachChild(node, findSwitch);
  };
  ts.forEachChild((method as ts.MethodDeclaration).body as ts.Block, findSwitch);
  if (!found) throw new Error('closeManagedWindow has no switch statement');
  const stmt = found as ts.SwitchStatement;
  const cases: string[] = [];
  const bodies: Record<string, string[]> = {};
  let fallback: string[] = [];
  for (const clause of stmt.caseBlock.clauses) {
    if (ts.isDefaultClause(clause)) {
      fallback = clause.statements.map((s) => s.getText());
      continue;
    }
    // REFUSE rather than skip. Rewriting `case 'lockpick-panel':` to `case LOCKPICK_ID:`
    // would otherwise make the id vanish from the list instead of failing the parse, and a
    // registry whose reader can silently return less is the shape this file exists to stop.
    if (!ts.isStringLiteral(clause.expression))
      throw new Error(
        `closeManagedWindow case is not a string literal: ${clause.expression.getText()}`,
      );
    const label = clause.expression.text;
    cases.push(label);
    bodies[label] = clause.statements.map((s) => s.getText());
  }
  return { on: stmt.expression.getText(), cases, bodies, fallback };
}

/** Every `id` carrying BOTH the `window` and `panel` classes, whatever the tag. */
function readPanelIds(html: string): string[] {
  const ids: string[] = [];
  for (const tag of html.match(/<[a-z][a-z0-9-]*\b[^>]*>/gi) ?? []) {
    const id = tag.match(/\bid=("|')([^"']+)\1/)?.[2];
    const cls = tag.match(/\bclass=("|')([^"']+)\1/)?.[2];
    if (!id || !cls) continue;
    const classes = cls.split(/\s+/);
    if (classes.includes('window') && classes.includes('panel')) ids.push(id);
  }
  return ids;
}

// The two populations on the day this was written. They are equal by coincidence, not by
// construction (37 cases = 34 markup panels with a case + 3 code-built; 37 markup ids = those
// 34 + the 3 without one), so they get two names and must be bumped independently.
const CASE_COUNT = 37;
const MARKUP_COUNT = 37;

const closeSwitch = readCloseManagedWindowSwitch(hudTs);
const caseIds = closeSwitch.cases;
// The UNION of both game shells. tests/entry_window_parity.test.ts owns the index-vs-play
// comparison and is where a divergence is reported; taking the union here means this registry
// still classifies every reachable window while that guard is red, rather than silently
// excusing a play.html-only window because index.html never mentioned it.
const markupIds = [...new Set([...readPanelIds(indexHtml), ...readPanelIds(playHtml)])];

describe('closeManagedWindow case registry', () => {
  it('reads the real switch, not a `case` label from anywhere else in the file', () => {
    // Without this the walk could be silently returning [] (or the cases of some other
    // switch) and every diff below would pass by agreeing on nothing.
    // The labels are window ids only while the switch is still keyed on the id.
    expect(closeSwitch.on).toBe('el.id');
    expect(caseIds).toContain('confirm-dialog');
    expect(caseIds).toContain('lockpick-panel');
    // AT the real count on the day this was written, not under it: a floor sitting below is
    // what lets a case quietly leave (tests/CLAUDE.md). Bump it when the family grows.
    expect(caseIds.length).toBeGreaterThanOrEqual(CASE_COUNT);
    expect(new Set(caseIds).size, 'no duplicate case labels').toBe(caseIds.length);

    // A synthetic source with the same shapes the real file has: a decoy case in another
    // method, one in a nested callback switch, and one inside a string and a comment.
    const planted = readCloseManagedWindowSwitch(`
      class Hud {
        private other(el: HTMLElement): void {
          switch (el.id) {
            case 'decoy-other-method':
              break;
          }
        }
        private closeManagedWindow(el: HTMLElement): void {
          // case 'decoy-comment':
          const s = "case 'decoy-string':";
          switch (el.id) {
            case 'real-one':
              this.a();
              break;
            case 'real-two': {
              el.addEventListener('x', () => {
                switch (s) {
                  case 'decoy-nested':
                    break;
                }
              });
              break;
            }
            default:
              break;
          }
        }
      }
    `);
    expect(planted.on).toBe('el.id');
    expect(planted.cases).toEqual(['real-one', 'real-two']);
    // Statements, not raw text: the decoy comment and string above are not in any body.
    expect(planted.bodies['real-one']).toEqual(['this.a();', 'break;']);
    expect(planted.fallback).toEqual(['break;']);

    // A computed label must REFUSE, not quietly shrink the list.
    expect(() =>
      readCloseManagedWindowSwitch(`
        class Hud {
          private closeManagedWindow(el: HTMLElement): void {
            switch (el.id) {
              case LOCKPICK_PANEL_ID:
                break;
            }
          }
        }
      `),
    ).toThrow(/not a string literal/);
  });

  it('scrapes the real panel family out of the shells', () => {
    // A markup change that broke the scrape would empty this set, and an empty set makes
    // every classification below pass by having nothing to classify. Floored AT the real
    // count for the same reason as the case list.
    expect(markupIds.length).toBeGreaterThanOrEqual(MARKUP_COUNT);
    expect(markupIds).toContain('lockpick-panel');
    expect(markupIds).toContain('bags');
    // Tags other than <div> count, and extra classes and attribute order are tolerated.
    expect(readPanelIds('<section id="a" class="window panel dev">')).toEqual(['a']);
    expect(readPanelIds('<div class="panel window" id="b">')).toEqual(['b']);
    // A panel that is not a window (#ctx-menu's shape) is NOT in the family: closeAll's scan
    // is `.window.panel`, and mistaking those for members would demand cases for elements it
    // can never hand to closeManagedWindow.
    expect(readPanelIds('<div id="c" class="panel">')).toEqual([]);
    expect(readPanelIds('<div id="d" class="window">')).toEqual([]);
    // PER TAG, not a document-wide scrape: the two classes must sit on ONE element. Every
    // decoy above is a single tag, so they cannot tell the two implementations apart.
    expect(readPanelIds('<div id="e" class="window"><div id="f" class="panel">')).toEqual([]);
    // TOKEN-exact, not substring: `classes.includes(...)` and `cls.includes(...)` agree on
    // every input above and part company here.
    expect(readPanelIds('<div id="g" class="windowed paneling">')).toEqual([]);
    // Single-quoted attributes count too: both shells use double quotes today, so without
    // this a quote-style change would drop panels out of the family unnoticed.
    expect(readPanelIds(`<div id='h' class='window panel'>`)).toEqual(['h']);
  });

  it('classifies every `.window.panel` exactly once', () => {
    const buckets = markupIds.map((id) => ({
      id,
      in: [
        caseIds.includes(id) ? 'case' : null,
        id in CLOSED_BEFORE_THE_SCAN ? 'closed-before-the-scan' : null,
        id in NO_MANAGED_TEARDOWN ? 'no-teardown' : null,
      ].filter(Boolean),
    }));
    // Named rather than counted, so the failure message says WHICH window is unclassified.
    expect(buckets.filter((b) => b.in.length === 0).map((b) => b.id)).toEqual([]);
    // The direction people forget: an excused id that later grew a real case keeps a stale
    // excuse, and the next reader trusts the excuse instead of the code.
    expect(
      buckets.filter((b) => b.in.length > 1).map((b) => `${b.id}: ${b.in.join(' + ')}`),
    ).toEqual([]);
  });

  it('keeps every case pointed at a window that still exists', () => {
    // The other direction: a renamed or deleted window leaves a case that can never fire,
    // and the next reader assumes the id is still covered.
    const known = new Set([...markupIds, ...Object.keys(CODE_BUILT)]);
    expect(caseIds.filter((id) => !known.has(id))).toEqual([]);
  });

  it('keeps every registry row pointed at a window that still exists', () => {
    const live = new Set(markupIds);
    const rows = { ...CLOSED_BEFORE_THE_SCAN, ...NO_MANAGED_TEARDOWN };
    expect(Object.keys(rows).filter((id) => !live.has(id))).toEqual([]);
    // A row is a claim someone made, so it has to say something. An empty or one-word
    // reason is the same silence the default arm already gives.
    for (const [id, reason] of Object.entries(rows)) {
      expect(reason.length, `${id} needs a real reason`).toBeGreaterThan(60);
    }
  });

  it('reaches the closed-before-the-scan windows from an arm that really does precede the scan', () => {
    // The whole justification for those rows is ORDER. If the early arm moved below the
    // topmost scan (or was deleted), they would silently fall to the default hide.
    const body = hudTs.slice(hudTs.indexOf('  closeAll(): boolean {'));
    const closeAll = body.slice(0, body.indexOf('\n  }'));
    const scanAt = closeAll.indexOf('this.topmostOpenWindow()');
    expect(scanAt).toBeGreaterThan(-1);
    for (const id of Object.keys(CLOSED_BEFORE_THE_SCAN)) {
      const armAt = closeAll.indexOf(`#${id}`);
      expect(armAt, `${id} has no arm in closeAll`).toBeGreaterThan(-1);
      expect(armAt, `${id}'s arm must run before the topmost scan`).toBeLessThan(scanAt);
    }
  });

  it('pins the code-built panels so a fourth module has to be classified', () => {
    // These carry no markup entry, so the shell sweep cannot see them. The claim in
    // CODE_BUILT's doc comment is that a NEW creation site fails here, and that only holds
    // if the scan reads the whole tree: three hard-coded readFileSync calls would miss a
    // panel minted in src/ui/foo_window.ts entirely, leaving it unclassified AND unseen.
    const sites: Record<string, number> = {};
    for (const { file, full } of tsFilesUnder(`${root}src`)) {
      const code = readFileSync(full, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      // Both spellings, and extra classes tolerated in each: an exact 'window panel' regex
      // is blind to `className = 'window panel dev-tool'`, which is how the third one is
      // already written, and to the classList form nothing uses yet.
      const n =
        [...code.matchAll(/className = (['"`])([^'"`]*)\1/g)].filter(([, , cls]) => {
          const tokens = cls.split(/\s+/);
          return tokens.includes('window') && tokens.includes('panel');
        }).length +
        [...code.matchAll(/classList\.add\(([^)]*)\)/g)].filter(
          ([, args]) => /['"`]window['"`]/.test(args) && /['"`]panel['"`]/.test(args),
        ).length;
      if (n > 0) sites[file] = n;
    }
    // EXACT, not a floor: a floor cannot notice a new module joining.
    expect(sites).toEqual({
      'ui/dev_command_window.ts': 1,
      'ui/hud.ts': 2, // confirmDialog + inputDialog share the one #confirm-dialog id
      'ui/profession_tutorial_window.ts': 1,
    });
    for (const id of Object.keys(CODE_BUILT)) expect(caseIds).toContain(id);
  });

  it('reads the tree through the shared walker', () => {
    // tests/CLAUDE.md's shared-walker rule. A hand-rolled readdirSync returns the same list
    // as tsFilesUnder today and diverges the day a panel module moves down a level, which is
    // the silent narrowing this pin exists to stop (#2485, #2489, #2502).
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under']);
    // The shared audit proves the walker is IMPORTED and that nothing reads a directory
    // directly. It cannot see a scan that keeps the import and hard-codes its file list
    // again, which is the exact revert this file has to survive, so count the call too.
    // The needle is split, or this assertion line would satisfy itself (the trap
    // helpers/scan_guard_self_audit.ts documents as its own first mistake).
    const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    expect(
      self.split(`tsFilesUnder${'('}`).length - 1,
      'the walker is called, not just imported',
    ).toBe(1);
  });

  it('routes #lockpick-panel through the controller, not a bare hide (#2517)', () => {
    // The regression this registry was written for. The behavioral proof lives in
    // tests/lockpick_managed_close.test.ts; this is the source-level half, so deleting the
    // case fails here even if someone also deletes that suite's harness.
    //
    // Over the parsed STATEMENTS, not a raw slice of the source. A slice from the label to
    // the first `break;` swallows the arm's own comment, so the pin would be satisfiable by
    // a comment that merely quotes the call while the call itself is gone.
    expect(closeSwitch.bodies['lockpick-panel']).toEqual([
      'this.lockpickController.requestClose();',
      'this.hideTooltip();',
      'break;',
    ]);
  });

  it('keeps the `default:` arm the bare hide the no-teardown rows assume', () => {
    // Both NO_MANAGED_TEARDOWN rows are justified by "the default arm is a strict superset
    // of that window's own close path". Nothing else in the repo pins what the default arm
    // DOES, so swapping it for an el.remove(), or dropping the tooltip hide, would falsify
    // both excuses with every other assertion here still green.
    expect(closeSwitch.fallback).toEqual([
      "el.style.display = 'none';",
      'this.hideTooltip();',
      'break;',
    ]);
  });
});
