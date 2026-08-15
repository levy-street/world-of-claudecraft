import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cssTreeUnder } from './helpers/css_tree_under';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';

// Section-by-section completeness guard for the game-HUD CSS, the floor the CSS
// extraction regresses against. That extraction relocates CSS section by
// section out of the inline <style> blocks in index.html / play.html into
// src/styles/*.css, then flip the build to Lightning CSS. A whitespace- or
// byte-level check would either go red on every cosmetic reformat or, worse,
// pass while a whole rule block is silently dropped. So this guard keys on the
// LIVE section structure instead: every authored section is fenced by a ten-dash
// banner comment /* ---------- name ---------- */, and the guard asserts that the
// full set of those section names still exists somewhere in the corpus.
//
// THE CORPUS IS A UNION: both entries' inline <style> text UNION the src/styles
// sheets. That union is the whole point: when the extraction moves a section out of
// an inline block and into a src/styles module keyed on the SAME ten-dash
// marker, the section leaves the inline block but reappears in the module, so the
// union stays complete and this guard stays green. A section that vanishes from
// BOTH the inline blocks and src/styles fails the guard, which is exactly the
// "a rule was dropped during extraction" regression we want to catch.
//
// The extraction is now COMPLETE, so today the union is lopsided: both inline
// <style> blocks are comment-only (pinned by tests/per_entry_css_wiring.test.ts) and
// carry no ten-dash banner, so every pinned section below is accounted for by
// src/styles alone. The union side stays because it is what makes the guard
// indifferent to WHERE a section lives, which is the property being guarded, but it
// means the src/styles read below is now the whole corpus rather than a supplement
// to it.
//
// TWO TRAPS this guard is built to avoid (both are silent false greens):
//   1. Vacuous marker pattern. V16 authored the banners with exactly ten dashes.
//      A four-dash /* ---- name ---- */ pattern matches none of them, so a guard
//      keyed on four dashes would capture zero sections and pass trivially. The
//      ten-dash floor below is load-bearing; the teeth tests prove a four-dash
//      fence is NOT treated as a boundary.
//   2. Re-deriving the expected set from the live inline blocks each run. That
//      would silently forget a section the instant the extraction moved it out. So the
//      expected manifest is PINNED (enumerated once from the shipped HTML), and
//      the guard asserts the pinned set against the union corpus.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const stylesDir = join(repoRoot, 'src', 'styles');

// A live section banner: /* ---------- name ---------- */ with at least ten
// dashes on each side. A bare prose comment that is NOT fenced by ten dashes
// (e.g. /* keep this above the fold */) is section BODY, never a boundary, so it
// must not open a new section. Section names contain no '*', so [^*] cannot run
// past a comment terminator and swallow a CSS body.
const MARKER_RE = /\/\*\s*-{10,}\s*([^*]+?)\s*-{10,}\s*\*\//g;

function sectionNames(css: string): string[] {
  const names: string[] = [];
  for (const m of css.matchAll(MARKER_RE)) names.push(m[1].trim());
  return names;
}

// All CSS an HTML entry ships inline today, concatenated. Assumes well-formed
// <style> blocks (no `</style>` token inside a CSS string), true for these
// hand-authored entries.
function inlineStyleCss(entryFile: string): string {
  const html = readFileSync(join(repoRoot, entryFile), 'utf8').replace(/\r\n/g, '\n');
  const parts: string[] = [''];
  for (const block of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) parts.push(block[1]);
  return parts.join('\n');
}

// The src/styles sheets, read ONCE for this whole file: the union corpus below and
// the per-file brace balance at the bottom both consume this list, so neither can
// drift from the other and the file owns exactly one directory reader.
//
// This read stays FLAT deliberately, the same ruling #2499 made for
// tests/mobile_window_coverage.test.ts and for the same reason: the corpus CREDITS
// a pinned section to whatever text it finds, so a sheet parked in a subfolder
// (component-local, experimental, half-migrated) would let a section that no entry
// loads count as still shipping. That is a false green, which is strictly worse than
// the narrowed scan recursing would fix. Only the top level ships: the index.css
// barrel, the 7 modules it @imports, and the two .extra.css that a <link> pulls in
// per entry (pinned by tests/per_entry_css_wiring.test.ts).
//
// The premise is CHECKED rather than asserted in prose (#2502): the day a sheet
// lands in a subdirectory this throws, HERE, next to the reasoning, so the choice
// gets re-made deliberately instead of quietly meaning something else. `dirs` comes
// out of the same walk as the files, so checking it costs no second read, and it
// sees a SYMLINKED subdirectory that a `Dirent.isDirectory()` test reads as a file.
// A missing or renamed src/styles now throws out of the walk too: this used to fall
// back to an empty corpus, and while that fails the completeness assertion loudly
// today, the teeth case below would pass over the empty corpus vacuously.
function styleSheets(root = stylesDir): { file: string; css: string }[] {
  const tree = cssTreeUnder(root);
  if (tree.dirs.length > 0) {
    throw new Error(
      `src/styles gained a subdirectory (${tree.dirs.join(', ')}): re-read the note above styleSheets()`,
    );
  }
  return tree.files.map(({ file, full }) => ({ file, css: readFileSync(full, 'utf8') }));
}

const STYLE_SHEETS = styleSheets();

// Every CSS module migrated into src/styles/, concatenated. This is the extension
// seam: a section moved out of an inline block lands here and the union below picks
// it up with no edit to this guard, as long as it lands at the top level, where the
// entries load it from.
function extractedStyleCss(): string {
  return ['', ...STYLE_SHEETS.map((sheet) => sheet.css)].join('\n');
}

// The whole game-HUD CSS corpus: both entries' inline <style> UNION src/styles.
const CORPUS = [
  inlineStyleCss('index.html'),
  inlineStyleCss('play.html'),
  extractedStyleCss(),
].join('\n');
const MOBILE_HUD_CSS = readFileSync(join(stylesDir, 'hud.mobile.css'), 'utf8');
const DESKTOP_HUD_CSS = readFileSync(join(stylesDir, 'hud.css'), 'utf8');
const CORPUS_SECTIONS = new Set(sectionNames(CORPUS));

// PINNED manifest: the ten-dash section banners, enumerated live from the shipped
// HTML at authoring time (not invented). 47 were inline in index.html; the 48th came
// from upgrading the lowercase tooltip banner to a ten-dash marker as it moved to
// src/styles/hud.css. The windows were relocated out of the inline <style> into
// src/styles/layout.css (the .window shell) + components.css (the bodies), and split
// the single coarse "windows" banner into per-window banners as it went, adding 11
// (window shell, character window, spellbook, quest log, leaderboard, talents, modals
// and dropdown, vendor, bags, social, map) so one window's body can no longer be
// dropped without this guard going red. As the extraction migrates sections out of the inline
// <style> they reappear in src/styles modules, so the union corpus stays complete.
// play.html is a near-clone that ships 57 of these (it omits the two in PLAY_OMITS;
// tooltip is shared via hud.css and the windows via components.css / layout.css, all of
// which play loads). play's set is a subset of index's, so this is the union.
const INDEX_SECTIONS = [
  'UI chrome icons (inline SVG from ui_icons.ts, tinted via currentColor)',
  'nameplates',
  'chat bubbles (/say, /yell)',
  'new-adventurer tutorial',
  'unit frames',
  'buff bar',
  'cast bar',
  'bottom cluster',
  'chat frame',
  'bug report (options sub-view)',
  'quest tracker',
  'delve tracker',
  'delve board',
  'lockpicking minigame ("Tumbler\'s Path")',
  'combat meters',
  'minimap',
  'community HUD',
  'windows',
  'window shell',
  'character window',
  'spellbook',
  'quest log',
  'leaderboard',
  'talents',
  'modals and dropdown',
  'vendor',
  'bags',
  'social',
  'map',
  'Dungeon Finder',
  'Ashen Coliseum (arena)',
  "The World Market (the Merchant's auction house)",
  'options / game menu (Esc)',
  'UI theme picker',
  'emote wheel',
  'tooltip',
  'floating combat text',
  '2v2 Fiesta HUD',
  'center messages',
  'low-health screen vignette',
  'death overlay',
  'start screen layout overhaul',
  'loading screen (entering the world)',
  'play console (realm selector + Play CTA)',
  'Skin picker (alternate body textures)',
  'Premium Accessible Login Form styling',
  'Animated Backdrop',
  'looping cinematic backdrop',
  'chat',
  'party frames',
  'context menu',
  // the operator-set AI-account tag: one shared animated-gradient class serving the
  // chat line, the nameplate .np-ai span, and the target frame's flair line.
  'ai account tag',
  'prompts (invite/trade/duel)',
  'trade window',
  'elite target frame',
  'Collapsible Controls Drawer',
  'Clean up styles (previously inline)',
  'Premium Class Details Panel',
  'mobile touch controls (runtime-gated with body.mobile-touch + game-active)',
  'mobile window backdrop',
  'mobile action ring (paged combat buttons)',
  'mobile hud layout tiers',
  'Unified Character Select Layout',
  'Cosmetic skin-select event overlay',
  // accessibility infra: three global sections added to base.css (loaded by both
  // game entries, so each lands in the union corpus for both).
  'skip links',
  'forced-colors',
  'print reset',
  // Book of Deeds: the window/tracker bodies (components.css) and the
  // standalone touch layout (hud.mobile.css); both modules load in both entries.
  'deeds',
  'mobile deeds (standalone window + tracker)',
  // The set-divided WARFARE quartermaster shop (components.css); loads in both
  // entries, so it is not a PLAY_OMITS row.
  'WARFARE quartermaster shop',
];

// The two index-only sections play.html does not ship, so its count is 58 (plus the
// three global sections both entries load via base.css = 61).
const PLAY_OMITS = ['new-adventurer tutorial', 'UI theme picker'];
const PLAY_SECTIONS = INDEX_SECTIONS.filter((name) => !PLAY_OMITS.includes(name));

// play's set is a subset of index's, so the union manifest is just INDEX_SECTIONS.
const MANIFEST = INDEX_SECTIONS;

describe('css_corpus section manifest', () => {
  it('pins a non-vacuous manifest: 70 index + 68 play sections, no duplicate names', () => {
    expect(INDEX_SECTIONS.length).toBe(70);
    expect(PLAY_SECTIONS.length).toBe(68);
    expect(MANIFEST.length).toBe(70);
    expect(new Set(INDEX_SECTIONS).size).toBe(70);
    expect(new Set(PLAY_SECTIONS).size).toBe(68);
  });

  it('captures the live corpus markers (the marker regex is non-vacuous, not a zero match)', () => {
    // CORPUS is both entries' inline <style> UNION src/styles. Even after the
    // extraction relocates sections into src/styles, every section stays in this union, so
    // the captured set never drops below the manifest size. A vacuous pattern (the
    // four-dash trap) would make this zero; the teeth tests below prove the dash
    // floor is what prevents that.
    expect(CORPUS_SECTIONS.size).toBeGreaterThanOrEqual(MANIFEST.length);
  });
});

describe('css_corpus section completeness (inline UNION src/styles)', () => {
  it('accounts for every pinned section in the corpus (no rule block silently dropped)', () => {
    const missing = MANIFEST.filter((name) => !CORPUS_SECTIONS.has(name));
    expect(
      missing,
      `section banners missing from index/play inline <style> UNION src/styles/*.css ` +
        `(a section dropped during CSS extraction, or a renamed banner):\n${missing.join('\n')}`,
    ).toEqual([]);
  });
});

describe('Paladin Ascension action indicators remain accessible across HUD tiers', () => {
  it('stops the mobile empowered pulse when reduced motion is requested', () => {
    expect(MOBILE_HUD_CSS).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?#mobile-action-ring button\.empowered\s*\{\s*animation:\s*none;/,
    );
  });

  it('restores system colors for the mobile cost badge after mobile-layer styling', () => {
    expect(MOBILE_HUD_CSS).toMatch(
      /@media \(forced-colors: active\)[\s\S]*?#mobile-action-ring button\.ascension-spender::after\s*\{[\s\S]*?border-color:\s*Highlight;[\s\S]*?background:\s*Canvas;[\s\S]*?color:\s*Highlight;/,
    );
  });

  it('renders the localized painter-provided cost instead of a CSS number literal', () => {
    expect(DESKTOP_HUD_CSS).toContain('content: attr(data-ascension-cost);');
    expect(MOBILE_HUD_CSS).toContain('content: attr(data-ascension-cost);');
    expect(`${DESKTOP_HUD_CSS}\n${MOBILE_HUD_CSS}`).not.toMatch(/content:\s*["']-1["']/);
  });
});

describe('css_corpus guard has teeth (fixture-proven, touches no product files)', () => {
  // A self-contained corpus fragment exercising the boundary rules: two real
  // ten-dash banners, a bare prose comment, and a four-dash decoy fence.
  const fixture = [
    '/* ---------- alpha ---------- */',
    '.a { color: red; }',
    '/* a bare prose note that is not a section boundary */',
    '.b { color: blue; }',
    '/* ---- four-dash decoy, not a ten-dash boundary ---- */',
    '.c { color: green; }',
    '/* ---------- omega ---------- */',
    '.d { color: black; }',
  ].join('\n');

  it('treats only ten-dash banners as boundaries; bare prose and four-dash fences are body', () => {
    // If this captured the prose note or the four-dash decoy, the guard would
    // over-split; if it captured neither real banner, the pattern would be vacuous.
    expect(sectionNames(fixture)).toEqual(['alpha', 'omega']);
  });

  it('detects a dropped section: removing a banner from the corpus makes it report missing', () => {
    // Strip the "windows" banner from a COPY of the real corpus (both entries
    // ship it, so remove all occurrences) and confirm the completeness check
    // would now flag it. This is the regression the guard exists to catch.
    const dropped = CORPUS.replace(
      /\/\*\s*-{10,}\s*windows\s*-{10,}\s*\*\//g,
      '/* windows banner stripped */',
    );
    const present = new Set(sectionNames(dropped));
    expect(present.has('windows')).toBe(false);
    expect(MANIFEST.filter((name) => !present.has(name))).toContain('windows');
  });
});

// ---------------------------------------------------------------------------
// Per-file brace balance. A merge-resolution hand-union once dropped a closing
// brace mid-file (components.css, the v0.24.0 merge): the sheet stays lintable
// text and every text-scan guard above still matches, but the browser treats
// each rule from the unbalanced point to EOF as invalid declarations inside the
// unterminated block and silently discards thousands of lines. Balance is
// checked per FILE, not on the union: a +1 in one file and a -1 in another must
// not cancel out.
// ---------------------------------------------------------------------------

/** Curly-brace balance with comments and quoted strings stripped first, so a
 *  literal brace inside content: "}" or a commented-out rule never miscounts. */
function braceBalance(css: string): number {
  const stripped = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '');
  let balance = 0;
  for (const ch of stripped) {
    if (ch === '{') balance++;
    else if (ch === '}') balance--;
  }
  return balance;
}

describe('css_corpus per-file brace balance', () => {
  it('balances every src/styles module exactly', () => {
    // Consumes the ONE read at the top of the file (this used to be a second,
    // separately-flat readdirSync, so the two could drift, #2502).
    //
    // The vacuity floor sits at the live module count, 10, which an empty OR a
    // truncated scan cannot clear: the `> 0` floor it replaces was satisfied by a
    // single sheet, so a walk that lost the other nine, or that returned only the
    // one file whose name survived a filter typo, passed while checking almost
    // nothing. The names pin that the 10 are the real modules.
    const names = STYLE_SHEETS.map((sheet) => sheet.file);
    expect(names.length).toBeGreaterThanOrEqual(10);
    expect(names).toEqual(
      expect.arrayContaining(['index.css', 'components.css', 'hud.mobile.css', 'tokens.css']),
    );
    for (const { file, css } of STYLE_SHEETS) {
      expect(braceBalance(css), `src/styles/${file} must have balanced braces`).toBe(0);
    }
  });

  it('balances both entries inline style blocks', () => {
    for (const entry of ['index.html', 'play.html']) {
      expect(braceBalance(inlineStyleCss(entry)), `${entry} inline styles`).toBe(0);
    }
  });

  it('teeth: an unterminated block is flagged and string/comment braces are ignored', () => {
    expect(braceBalance('.a { color: red;')).toBe(1);
    expect(braceBalance('.a { color: red; } }')).toBe(-1);
    expect(braceBalance('.a { content: "}"; } /* } */ .b { color: blue; }')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The flat-read premise, pinned. src/styles is flat today, so nothing asserted
// over the real tree can tell this reader from one that quietly stopped at the
// top level: only a fixture root can, and it has to drive styleSheets() itself
// rather than the shared walk (helpers/css_tree_under.test.ts owns that).
// ---------------------------------------------------------------------------

describe('css_corpus src/styles read is flat BY RULING, and refuses instead of narrowing', () => {
  let root = '';

  const write = (relative: string, body: string): void => {
    const full = join(root, ...relative.split('/'));
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'woc-css-corpus-styles-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('is the only reader of src/styles in this file', () => {
    // The collapse of the two independently-flat reads into one STYLE_SHEETS is
    // the part of this guard that nothing else can pin: a re-added reader in the
    // brace-balance case would return the same 10 sheets today, every assertion
    // would stay green, and the two would be free to drift apart again.
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['css_tree_under']);
  });

  it('reads the top-level sheets of a flat root', () => {
    // The other polarity of the two refusals below: without this, a reader that
    // threw unconditionally would pass them both.
    write('a.css', '/* ---------- alpha ---------- */\n.a { color: red; }\n');
    write('b.css', '.b { color: blue; }\n');
    expect(styleSheets(root).map((sheet) => sheet.file)).toEqual(['a.css', 'b.css']);
    expect(
      sectionNames(
        styleSheets(root)
          .map((sheet) => sheet.css)
          .join('\n'),
      ),
    ).toEqual(['alpha']);
  });

  it('throws when a sheet lands in a subdirectory, naming it', () => {
    write('a.css', '.a { color: red; }\n');
    write('nested/sunk.css', '/* ---------- sunk ---------- */\n.s { color: red; }\n');
    // The failure the ruling is worth having: a section (or a brace bug) inside a
    // sheet no entry loads must not read as covered, and the day one appears the
    // decision gets re-made here rather than silently meaning something else.
    expect(() => styleSheets(root)).toThrow(/gained a subdirectory \(nested\)/);
  });

  it('throws for a subdirectory that holds no sheet at all', () => {
    write('a.css', '.a { color: red; }\n');
    mkdirSync(join(root, 'experimental'), { recursive: true });
    // Keyed on the DIRECTORY, not on finding a .css inside it, so the choice is
    // re-made when the shape changes rather than on the later day something lands.
    expect(() => styleSheets(root)).toThrow(/gained a subdirectory \(experimental\)/);
  });

  it('throws for a missing root instead of reporting an empty corpus', () => {
    // The hole this replaces: `if (!existsSync(stylesDir)) return ''` answered a
    // moved or renamed src/styles with an empty corpus. The completeness assertion
    // would go red on that today, but the dropped-section teeth case above passes
    // over an empty corpus vacuously, so the read is the place to fail.
    expect(() => styleSheets(join(root, 'no_such_dir'))).toThrow(/ENOENT/);
  });
});
