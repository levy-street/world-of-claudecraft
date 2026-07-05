import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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
// THE CORPUS IS A UNION: both entries' inline <style> text UNION the contents of
// src/styles/*.css. Today src/styles/ does not exist, so the union is just the
// two inline blocks. That union is the whole point: when the extraction moves a section
// out of an inline block and into a src/styles module keyed on the SAME ten-dash
// marker, the section leaves the inline block but reappears in the module, so the
// union stays complete and this guard stays green. A section that vanishes from
// BOTH the inline blocks and src/styles fails the guard, which is exactly the
// "a rule was dropped during extraction" regression we want to catch.
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

// Every CSS module already migrated into src/styles/. None exist yet and the
// directory itself is absent, so glob it and tolerate a missing dir. This is the
// extension seam: as the extraction moves sections out of the inline blocks, they land
// here and the union below picks them up with no edit to this guard.
function extractedStyleCss(): string {
  if (!existsSync(stylesDir)) return '';
  const parts: string[] = [''];
  for (const name of readdirSync(stylesDir).sort()) {
    if (name.endsWith('.css')) parts.push(readFileSync(join(stylesDir, name), 'utf8'));
  }
  return parts.join('\n');
}

// The whole game-HUD CSS corpus: both entries' inline <style> UNION src/styles.
const CORPUS = [
  inlineStyleCss('index.html'),
  inlineStyleCss('play.html'),
  extractedStyleCss(),
].join('\n');
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
  'prompts (invite/trade/duel)',
  'trade window',
  'elite target frame',
  'Collapsible Controls Drawer',
  'Clean up styles (previously inline)',
  'Premium Class Details Panel',
  'mobile touch controls (runtime-gated with body.mobile-touch + game-active)',
  'Unified Character Select Layout',
  'Cosmetic skin-select event overlay',
  // accessibility infra: three global sections added to base.css (loaded by both
  // game entries, so each lands in the union corpus for both).
  'skip links',
  'forced-colors',
  'print reset',
];

// The two index-only sections play.html does not ship, so its count is 57 (plus the
// three global sections both entries load via base.css = 60).
const PLAY_OMITS = ['new-adventurer tutorial', 'UI theme picker'];
const PLAY_SECTIONS = INDEX_SECTIONS.filter((name) => !PLAY_OMITS.includes(name));

// play's set is a subset of index's, so the union manifest is just INDEX_SECTIONS.
const MANIFEST = INDEX_SECTIONS;

describe('css_corpus section manifest', () => {
  it('pins a non-vacuous manifest: 62 index + 60 play sections, no duplicate names', () => {
    expect(INDEX_SECTIONS.length).toBe(62);
    expect(PLAY_SECTIONS.length).toBe(60);
    expect(MANIFEST.length).toBe(62);
    expect(new Set(INDEX_SECTIONS).size).toBe(62);
    expect(new Set(PLAY_SECTIONS).size).toBe(60);
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
