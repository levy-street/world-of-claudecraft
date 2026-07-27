import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cssTreeUnder } from './helpers/css_tree_under';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { tsFilesUnder } from './helpers/ts_files_under';

// Phase 5 mobile-HUD-parity coverage guard.
//
// Every desktop HUD window (an element with class `window` and an id) must have a
// deliberate mobile-touch decision: either it is brought into the shared "mobile
// sheet base" pattern (at least one `body.mobile-touch ... #id ...` rule that also
// carries a real pin/size/floor property, not merely a cosmetic z-index/border), or
// it is listed in MOBILE_WINDOW_EXCEPTIONS with a reason.
//
// This is the future-proofing half of the phase: a NEW window added to the markup
// without a mobile rule and without an exception entry FAILS this test, so it can
// never silently ship as an unstyled desktop-only box on touch.
//
// The window ids come from BOTH build entries (index.html at `/`, play.html at
// `/play`; vite.config.ts) since the HUD chrome ships in both, PLUS any window
// created dynamically in src/ui (scraped below). The mobile-touch rules are read
// from every src/styles/*.css module (the flattened cascade an entry loads via the
// src/styles/index.css barrel).
const HTML_ENTRIES = ['../index.html', '../play.html'];
const STYLES_DIR = '../src/styles';
const UI_DIR = '../src/ui';

function read(relPath: string): string {
  return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8');
}

// The static `.window` ids from a markup entry. Attribute-ORDER-TOLERANT: it scans
// whole opening tags and tests `id=` and a `window` className INDEPENDENTLY per tag,
// so a future class-first element (class="..." before id="...") is still picked up
// (the old id-then-class regex would have silently missed it).
function windowIdsFromHtml(html: string): string[] {
  const ids: string[] = [];
  // Every opening tag's inner attribute text (between `<tag` and the closing `>`). The
  // `<[a-z]` start skips a close tag's `</` and a comment's OWN `<!--` delimiter, but it
  // does NOT strip HTML comments: a `.window` tag written literally inside `<!-- ... -->`
  // would still be scraped here. That is acceptable because the failure direction is loud
  // (a scraped window with no mobile rule and no exception FAILS the coverage assertion),
  // so a commented-out window can never SILENTLY pass; it just needs an exception entry.
  // A tag's attributes never contain a raw '>', so [^>]* is safe here.
  for (const tag of html.matchAll(/<[a-z][a-z0-9]*\s+([^>]*?)\/?>/gi)) {
    const attrs = tag[1];
    const idMatch = attrs.match(/\bid="([a-z0-9-]+)"/);
    const classMatch = attrs.match(/\bclass="([^"]*)"/);
    if (idMatch && classMatch && /\bwindow\b/.test(classMatch[1])) {
      ids.push(idMatch[1]);
    }
  }
  return ids;
}

// Windows created at runtime carry a `window` className in a src/ui module rather
// than living in the static markup (today only #confirm-dialog, reused by the input
// dialog). To pick a future dynamic window up automatically, pair a `<var>.id = 'X'`
// assignment with a `<var>.className = 'window ...'` on the SAME variable within a
// short line-distance. Matching the id AND the window className on the same element
// is what keeps sibling containers (#emote-wheel, #loot-rolls, #skin-event: divs in
// the same module that are NOT .window boxes) from being mis-scraped as windows.
// The walk goes to any depth (#2489). The single-level read this replaces was
// pointed at exactly the directory the repo tells contributors NOT to add new
// components to: src/ui/CLAUDE.md sends a new HUD component to
// src/ui/hud/<domain>/, and much of the window family already lives there. Those
// stay visible only because they paint into ids that exist in the static markup;
// the day one mints its own `.window` root, a flat read would go blind while
// every assertion below stayed green, which is the exact failure this closes.
// Takes a root so the recursion case can drive the real scraper over a fixture.
function dynamicWindowIds(dir: string = fileURLToPath(new URL(UI_DIR, import.meta.url))): {
  ids: string[];
  files: string[];
  windowClassFiles: string[];
} {
  const sources = tsFilesUnder(dir);
  const ids = new Set<string>();
  const windowClassFiles: string[] = [];
  const idRe = /(\w+)\.id\s*=\s*['"]([a-z0-9-]+)['"]/g;
  for (const { file, full } of sources) {
    const src = readFileSync(full, 'utf8');
    if (!/\.className\s*=\s*['"]window(?:\s+[^'"]*)?['"]/.test(src)) continue;
    windowClassFiles.push(file);
    for (const m of src.matchAll(idRe)) {
      const [, varName, id] = m;
      // Require the same variable to receive a `window` className nearby (within the
      // element's construction block, allow generous slack for id/aria/style lines).
      const near = src.slice(m.index, m.index + 600);
      const classRe = new RegExp(`${varName}\\.className\\s*=\\s*['"]window(?:\\s+[^'"]*)?['"]`);
      if (classRe.test(near)) ids.add(id);
    }
  }
  return { ids: [...ids], files: sources.map((s) => s.file), windowClassFiles };
}

// Windows deliberately NOT brought into the mobile sheet pattern, each with a
// reason. These pass coverage without a mobile-touch positioning rule.
const MOBILE_WINDOW_EXCEPTIONS: Record<string, string> = {
  'loot-window':
    'cursor-popped by design: the loot roll popup spawns at the drop, not as a docked sheet',
  'confirm-dialog':
    'small centered modal (dynamic, reused by the input dialog); the base .window centering is correct on touch',
  'profession-tutorial':
    'small centered modal (dynamic, the first-tier profession tutorial); centered and clamped by its own base #profession-tutorial rule plus the shared .window viewport clamp, with its z-index floored above the mobile sheet (96) in JS',
  'delve-rite-panel': 'in-run gameplay overlay, not a menu window that docks to a sheet',
  'lockpick-panel': 'in-run gameplay overlay, not a menu window that docks to a sheet',
};

// A src/styles/*.css module contains a positioning/floor rule for #id on touch when
// some `body.mobile-touch ... #id ...` selector names the id. Comments are stripped
// so a commented id cannot spoof coverage.
//
// This read stays SINGLE-LEVEL on purpose, unlike the src/ui walk above (#2489).
// It models the sheets that actually reach a browser, not the files on disk:
// all 10 ship, as the index.css barrel itself, the 7 it imports, and the two
// .extra.css pulled in by a <link> in each entry (pinned by
// tests/per_entry_css_wiring.test.ts). Recursing would be worse than a no-op
// (src/styles has no subdirectories today): it would let a component-local or
// experimental sheet parked in a subfolder count as mobile coverage for a rule
// that never loads. The failure directions differ too. A src/ui module missed
// by a flat read is a silent PASS, which is the bug #2489 is about; a src/styles
// module missed here makes its windows read as unclassified and turns the
// coverage assertion RED, which needs no depth fix to be noticed.
// Takes a root, like dynamicWindowIds above, so the refusal below is reachable
// from a fixture: src/styles is flat, so nothing asserted over the real tree can
// tell this read from one that quietly stopped meaning anything.
function stylesText(dir: string = fileURLToPath(new URL(STYLES_DIR, import.meta.url))): string {
  const tree = cssTreeUnder(dir);
  // The premise, checked rather than asserted in prose: the reasoning above
  // holds only while every sheet sits at the top level. The day one lands in a
  // subdirectory this throws here, where the comment explaining the decision
  // is, so the choice gets re-made deliberately instead of quietly meaning
  // something else. Derived from the SAME read as the file list, so this file
  // still owns exactly one directory read (and no reader of its own: the shared
  // walk reports the subdirectories, which the hand-rolled `e.isDirectory()`
  // this replaces could not see through a SYMLINKED one, #2502).
  if (tree.dirs.length > 0) {
    throw new Error(
      `src/styles gained a subdirectory (${tree.dirs.join(', ')}): re-read the note above stylesText()`,
    );
  }
  return tree.files
    .map(({ full }) => readFileSync(full, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''))
    .join('\n');
}

// A window counts as sheeted on mobile only when a `body.mobile-touch ... #id ...`
// rule ALSO carries at least one real pin/size/floor declaration in its block, so a
// purely cosmetic id rule (a lone z-index, border, or color) cannot spoof coverage.
// The block scanned is the leaf declaration block after the selector: CSS
// declarations hold no nested braces, so the first `{`..`}` after a selector match
// is exactly that rule's body even inside the file's @layer/@media wrappers (which
// is why this scans per-rule rather than brace-parsing the whole nested file).
const PIN_PROP_RE = /(?:^|[;{\s])(?:left|right|top|max-height|min-height|transform)\s*:/;

function hasMobileRule(css: string, id: string): boolean {
  // A selector that starts with `body.mobile-touch` (optionally with extra state
  // classes) and names `#id` as the target or an ancestor of the target.
  const selRe = new RegExp(`body\\.mobile-touch[^,{}]*#${id}(?![-a-z0-9])`, 'g');
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop.
  while ((m = selRe.exec(css)) !== null) {
    const open = css.indexOf('{', m.index + m[0].length);
    if (open === -1) continue;
    const close = css.indexOf('}', open + 1);
    if (close === -1) continue;
    if (PIN_PROP_RE.test(css.slice(open + 1, close))) return true;
  }
  return false;
}

// A rule that targets the WINDOW ITSELF on touch, rather than something inside
// it: the id (with any pseudo-classes) is the last thing in its selector before
// the comma or the brace, and the block carries a real pin property. Only the
// exception-necessity check below uses this; hasMobileRule above stays looser on
// purpose, because a sheeted window is usually positioned through its parts.
// Across the 142 ids named in a body.mobile-touch selector today the two answers
// differ for 7, every one of them an ancestor-only rule (#deed-tracker's own
// block is a font-size, its max-height sits on .dt-list).
// It misses `#id.state { ... }`, where a class follows the id: that reads as
// "not id-scoped" and keeps an exception alive, which is the safe direction for
// the only caller (a wrongly-kept exception is inert; a wrongly-dropped one
// would demand mobile CSS that nobody decided to write).
function hasOwnSheetRule(css: string, id: string): boolean {
  const selRe = new RegExp(
    // No id-boundary lookahead here, unlike hasMobileRule: the trailing `[,{]`
    // already does that job, since a longer id (#beta-extended searched for as
    // #beta) leaves `-extended` where a comma or brace has to be. Mutation
    // showed a lookahead here is unreachable, so it is not written.
    `body\\.mobile-touch[^,{}]*#${id}(?::[a-z-]+(?:\\([^)]*\\))?)*\\s*[,{]`,
    'g',
  );
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop.
  while ((m = selRe.exec(css)) !== null) {
    const open = css.indexOf('{', m.index + m[0].length - 1);
    if (open === -1) continue;
    const close = css.indexOf('}', open + 1);
    if (close === -1) continue;
    if (PIN_PROP_RE.test(css.slice(open + 1, close))) return true;
  }
  return false;
}

describe('mobile window coverage (Phase 5 parity)', () => {
  const htmlIds = HTML_ENTRIES.flatMap((e) => windowIdsFromHtml(read(e)));
  const dyn = dynamicWindowIds();
  const allIds = [...new Set([...htmlIds, ...dyn.ids])].sort();
  const css = stylesText();

  it('scrapes a plausible set of window ids from both entries plus src/ui', () => {
    // Sanity floors: the static markup carries the full HUD window family; if
    // this collapses, the scrape regex broke and the coverage assertions are
    // hollow. PER ENTRY, not on the union: both entries ship the same window
    // family (37 ids each today), so a union floor stays green while one
    // entry's scrape collapses entirely.
    for (const entry of HTML_ENTRIES) {
      expect(windowIdsFromHtml(read(entry)).length, entry).toBeGreaterThanOrEqual(35);
    }
    expect(allIds.length).toBeGreaterThanOrEqual(38);
    // The recursion pin that lives in the REAL tree rather than a fixture: the
    // single-level read this replaces saw 295 files, the walk sees 450, so a
    // quiet return to a flat read cannot clear this floor.
    expect(
      dyn.files.length,
      'the src/ui scrape reads the whole tree, not one level (#2489)',
    ).toBeGreaterThanOrEqual(400);
    // Exact, not a floor. Minting a window at runtime is a rare, deliberate act,
    // and it is the arm the recursion widens: a fourth module joins this list in
    // the same change that gives its window a mobile rule or an exception below.
    expect(dyn.windowClassFiles).toEqual([
      'dev_command_window.ts',
      'hud.ts',
      'profession_tutorial_window.ts',
    ]);
    expect([...dyn.ids].sort()).toEqual([
      'confirm-dialog',
      'dev-command-window',
      'profession-tutorial',
    ]);
  });

  it('the src/ui scrape descends, so a window minted in a SUBDIRECTORY is seen (#2489)', () => {
    // Every window-minting module sits at the top of src/ui today, so no
    // assertion over the real tree can tell a recursive walk from the flat one
    // it replaces. Drive the real scraper over a fixture tree instead, in the
    // shape the repo actually asks for: a component under a hud domain folder.
    const fixture = mkdtempSync(path.join(tmpdir(), 'woc-ui-scrape-'));
    try {
      mkdirSync(path.join(fixture, 'hud', 'trade'), { recursive: true });
      writeFileSync(
        path.join(fixture, 'hud', 'trade', 'haggle_window.ts'),
        "const root = document.createElement('div');\n" +
          "root.id = 'haggle-window';\n" +
          "root.className = 'window haggle';\n",
      );
      // The pairing rule has to survive the recursion: a sibling id in the same
      // nested module that never receives a window className is NOT a window
      // (the real tree's #emote-wheel, #loot-rolls, #skin-event are this shape).
      writeFileSync(
        path.join(fixture, 'hud', 'trade', 'haggle_tray.ts'),
        "const tray = document.createElement('div');\n" +
          "tray.id = 'haggle-tray';\n" +
          "tray.className = 'tray';\n" +
          "const box = document.createElement('div');\n" +
          "box.className = 'window';\n",
      );
      const found = dynamicWindowIds(fixture);
      expect(found.ids).toEqual(['haggle-window']);
      expect(found.windowClassFiles).toEqual([
        'hud/trade/haggle_tray.ts',
        'hud/trade/haggle_window.ts',
      ]);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('both scans read through the shared walkers, with no flat reader beside them', () => {
    // The fixture pins the SCRAPER, and the file-count floor above pins that the
    // real scrape reaches the whole tree. This closes the remaining gap: a
    // second producer built on its own flat read would return the same window
    // IDS today, since every window-minting module is at the top level, so the
    // ids and windowClassFiles pins would not notice it. NO hand-rolled
    // directory read is left in this file: src/ui goes through the recursive .ts
    // walk, and stylesText's src/styles read goes through the .css walk, whose
    // subdirectory report is what keeps that read single-level BY DECISION (see
    // its comment) rather than by a `Dirent` test blind to a symlinked folder.
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under', 'css_tree_under']);
  });

  it('stylesText refuses a src/styles subdirectory rather than reading past it', () => {
    // The refusal was unreachable while stylesText hardcoded its root: the arm
    // the #2499 ruling rests on, never once executed by the suite.
    const fixture = mkdtempSync(path.join(tmpdir(), 'woc-mobile-styles-'));
    try {
      writeFileSync(
        path.join(fixture, 'hud.mobile.css'),
        'body.mobile-touch #bags-window { left: 0; }\n',
      );
      // Flat first, so a stylesText that threw unconditionally could not pass
      // this pair, and so the read is shown to work at a fixture root at all.
      expect(stylesText(fixture)).toContain('#bags-window');
      mkdirSync(path.join(fixture, 'experimental'), { recursive: true });
      writeFileSync(
        path.join(fixture, 'experimental', 'parked.css'),
        'body.mobile-touch #parked-window { left: 0; }\n',
      );
      expect(() => stylesText(fixture)).toThrow(/gained a subdirectory \(experimental\)/);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('every window is either sheeted on mobile or an explicit exception', () => {
    const unclassified: string[] = [];
    for (const id of allIds) {
      if (id in MOBILE_WINDOW_EXCEPTIONS) continue;
      if (hasMobileRule(css, id)) continue;
      unclassified.push(id);
    }
    expect(
      unclassified,
      'these windows have no body.mobile-touch rule naming their id and are not in ' +
        `MOBILE_WINDOW_EXCEPTIONS (add a mobile sheet rule or an exception with a reason):\n${unclassified.join('\n')}`,
    ).toEqual([]);
  });

  it('each Phase 5 sheeted window carries a mobile-touch rule', () => {
    const phase5 = [
      'calendar-window',
      'crafting-window',
      'mailbox-window',
      'emote-editor',
      'arena-window',
      'valecup-window',
      'delve-board',
      'leaderboard-window',
      'loot-settings-window',
    ];
    const missing = phase5.filter((id) => !hasMobileRule(css, id));
    expect(missing, `Phase 5 windows missing a mobile-touch rule:\n${missing.join('\n')}`).toEqual(
      [],
    );
  });

  it('every exception id names a real window and carries a reason string', () => {
    for (const [id, reason] of Object.entries(MOBILE_WINDOW_EXCEPTIONS)) {
      expect(allIds, `exception #${id} is not a scraped window id`).toContain(id);
      expect(reason.length, `exception #${id} needs a non-empty reason`).toBeGreaterThan(10);
    }
  });

  it('every exception is still NEEDED (none shadows a window that already qualifies)', () => {
    // The sweep consults the exception map BEFORE hasMobileRule, so an entry
    // whose window later gained a real mobile rule keeps passing while its
    // stated reason quietly goes false, and nothing notices. That is what
    // happened to #daily-rewards-window: it was excused for carrying "only a
    // z-index bump" long after src/styles/hud.mobile.css gave it an id-scoped
    // max-height, so the entry was removed rather than left to rot.
    //
    // This asks a STRICTER question than hasMobileRule, deliberately. That one
    // credits a rule where the id is merely an ANCESTOR of the target, which is
    // right for coverage (a sheeted window is usually styled through its parts)
    // but wrong here: #loot-window is named only by `#loot-window .btn`, which
    // gives its buttons a min-height and sheets nothing, so treating that as
    // "already qualifies" would delete a legitimate exception. An excused
    // window is one that carries no rule targeting the window ITSELF.
    const shadowed = Object.keys(MOBILE_WINDOW_EXCEPTIONS).filter((id) => hasOwnSheetRule(css, id));
    expect(
      shadowed,
      'these ids are excused but already carry an id-scoped body.mobile-touch rule with a real pin; drop the exception',
    ).toEqual([]);
    // Both controls, or the sweep above could pass by answering false to
    // everything. #daily-rewards-window is the window whose dead exception this
    // replaced (an id-scoped max-height); #loot-window is the one that keeps its
    // exception, named in hud.mobile.css only through `#loot-window .btn`.
    expect(hasOwnSheetRule(css, 'daily-rewards-window')).toBe(true);
    expect(hasOwnSheetRule(css, 'loot-window')).toBe(false);
    expect(hasMobileRule(css, 'loot-window')).toBe(true);
    // The real cascade happens to satisfy both controls through one plain
    // `#id { ... }` rule, so neither of the regex's other two clauses is
    // exercised by it: delete the pseudo-class group or the id-boundary
    // lookahead and the two controls above still pass. Drive those arms over a
    // fixture cascade instead.
    const fixtureCss = [
      'body.mobile-touch #alpha:not(.docked) { max-height: 10px; }',
      'body.mobile-touch #beta-extended { top: 0; }',
      'body.mobile-touch #gamma .inner { min-height: 40px; }',
    ].join('\n');
    // The pseudo-class group: the id is still the target, `:not(.docked)` and
    // all, so this is an id-scoped rule.
    expect(hasOwnSheetRule(fixtureCss, 'alpha')).toBe(true);
    // The boundary lookahead: #beta must not match the longer #beta-extended,
    // or a window would inherit a namesake prefix's rule and lose its exception.
    expect(hasOwnSheetRule(fixtureCss, 'beta')).toBe(false);
    expect(hasOwnSheetRule(fixtureCss, 'beta-extended')).toBe(true);
    // ... and the descendant shape stays out, which is the whole distinction.
    expect(hasOwnSheetRule(fixtureCss, 'gamma')).toBe(false);
  });
});
