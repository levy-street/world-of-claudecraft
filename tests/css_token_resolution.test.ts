// Every `var(--name)` a shipped stylesheet reads WITHOUT a fallback must name a
// custom property something declares: tokens.css and the other modules, the
// theme derivations src/ui/theme.ts writes, or an inline `--name:` setter in a
// painter's markup. Nothing else checked this: css_value_validity looks only at
// what FOLLOWS a var(), so a never-declared or misspelt name shipped silently
// (the marketplace's `var(--accent)` resolved to inherit / currentColor for
// months: the spinner ring's arc, the money row's accent, the selected mode
// tab). The known pre-existing gaps are ratcheted below as an EXACT set: a new
// undeclared name fails, and a fixed one must leave the list.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cssTreeUnder } from './helpers/css_tree_under';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { stripComments } from './helpers/strip_comments';
import { tsFilesUnder } from './helpers/ts_files_under';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const STYLES_DIR = `${REPO}src/styles/`;

const stripCss = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** var(--name) reads with NO fallback (a `,` after the name is a fallback and
 *  resolves on its own; that shape is not this guard's concern). */
function varReadsWithoutFallback(css: string): string[] {
  const names: string[] = [];
  for (const m of stripCss(css).matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*\)/g)) names.push(m[1]);
  return names;
}

/** `--name:` declarations (a stylesheet block, an inline style attribute in a
 *  template string, an html style attribute) plus the quoted names theme.ts
 *  writes onto the root. */
function declaredNames(sources: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const src of sources) {
    for (const m of src.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) out.add(m[1]);
    for (const m of src.matchAll(/['"`](--[A-Za-z0-9_-]+)['"`]/g)) out.add(m[1]);
  }
  return out;
}

// Pre-existing debt outside the marketplace pass, each read without a
// declaration today (the DESIGN.md chrome retune retires them onto tokens):
// exact set, so a NEW undeclared read fails and a fix must delete its row.
const KNOWN_UNDECLARED = [
  // DESIGN.md 4.3 names this alias and components.css already consumes it, at
  // 13 sites that are ALL in the Dungeon Finder section. Declaring it is
  // therefore not a token cleanup: it switches on 13 borders that have never
  // painted, and grows those content-sized chips by 2px, in a window the
  // marketplace pass neither owns nor captured. Owed by the DESIGN.md chrome
  // retune, WITH a Dungeon Finder before/after (desktop and 900x420).
  '--panel-border',
  '--color-bg-deep', // hud.css: the boss level chip and the spectate badge
  '--color-text', // components.css / hud.css: the generic text alias never minted
  '--color-text-primary', // shell.css: the pre-game shell's alias
  '--cursor-pointer', // components.css: the cursor family spells --cursor-point
  '--dev-outline', // hud.css: a dev overlay outline never tokenized
  '--shadow-panel', // hud.css: the spectate badge shadow
].sort();

describe('css_token_resolution: every var() read names a declared custom property', () => {
  const sheets = cssTreeUnder(STYLES_DIR).files.map(({ full }) => readFileSync(full, 'utf8'));
  const declared = declaredNames([
    ...sheets.map(stripCss),
    ...tsFilesUnder('src').map(({ full }) => stripComments(readFileSync(full, 'utf8'))),
    readFileSync(`${REPO}index.html`, 'utf8'),
    readFileSync(`${REPO}play.html`, 'utf8'),
  ]);

  it('reads only declared names, apart from the ratcheted pre-existing gaps', () => {
    const undeclared = new Set<string>();
    for (const css of sheets) {
      for (const name of varReadsWithoutFallback(css)) {
        if (!declared.has(name)) undeclared.add(name);
      }
    }
    expect(
      [...undeclared].sort(),
      'a var(--name) read with no declaration anywhere (tokens.css, a module, theme.ts, an inline setter): declare it, or, for a fixed row, remove it from KNOWN_UNDECLARED',
    ).toEqual(KNOWN_UNDECLARED);
  });

  it('the marketplace accent reads the themed token, never the undeclared --accent', () => {
    // The defect this guard was written after: seven marketplace declarations
    // read var(--accent), which nothing declared.
    for (const css of sheets) expect(varReadsWithoutFallback(css)).not.toContain('--accent');
    expect(declared.has('--color-accent')).toBe(true);
    // The latent DESIGN.md token stays UNDECLARED for now, on the ratchet above
    // with its reason: declaring it repaints another window's borders.
    expect(declared.has('--panel-border')).toBe(false);
  });

  it('positive control: the reader sees a bare var() and skips one with a fallback', () => {
    expect(varReadsWithoutFallback('a { color: var(--nope); }')).toEqual(['--nope']);
    expect(varReadsWithoutFallback('a { color: var( --nope ); }')).toEqual(['--nope']);
    expect(varReadsWithoutFallback('a { color: var(--nope, red); }')).toEqual([]);
    expect(varReadsWithoutFallback('/* var(--commented) */ a { }')).toEqual([]);
    expect(declaredNames(['x { --token: 1px; }']).has('--token')).toBe(true);
    expect(declaredNames(["'--from-theme': text,"]).has('--from-theme')).toBe(true);
    expect(declaredNames(['`<span style="--i:${index}">`']).has('--i')).toBe(true);
    expect(declaredNames(['a { color: var(--read-only); }']).has('--read-only')).toBe(false);
  });

  it('walks the corpus through the shared walkers only', () => {
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['css_tree_under', 'ts_files_under']);
  });
});
