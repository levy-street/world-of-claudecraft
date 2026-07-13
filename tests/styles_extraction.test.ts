import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Rule-level guard for the v0.16.0 CSS extraction. The css_corpus
// guard keys on ten-dash HUD section banners; the tokens/base blocks carry none (they
// sit above the first banner), so css_corpus provides NO rule-level protection for THIS
// move. These assertions pin the load-bearing pieces so a later edit that drops a
// runtime-written :root default, re-relativizes a cursor url(), promotes --range-fill to
// :root, breaks the @layer order, or drops the barrel import goes red in Vitest rather than
// only in an out-of-band build. Later CSS extraction work can extend this with its own
// describe blocks.

const root = new URL('../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8').replace(/\r\n/g, '\n');
// CSS comments carry token names in prose (the tokens.css header documents --range-fill,
// for example), so strip them to test declarations, not documentation.
const stripCssComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const tokens = read('src/styles/tokens.css');
const tokensCode = stripCssComments(tokens);
const base = read('src/styles/base.css');
const baseCode = stripCssComments(base);
const barrel = read('src/styles/index.css');
const gameStyles = read('src/styles/game.css');
const mainTs = read('src/main.ts');
const viteConfig = read('vite.config.ts');

describe('CSS extraction: tokens.css', () => {
  it('keeps the runtime-written custom props as :root defaults (overridden at runtime)', () => {
    // theme.ts writes the --color-* accents and the resizer writes --app-vw/--app-vh, both
    // onto documentElement.style, which beats this stylesheet rule. They MUST stay as
    // :root defaults so the runtime overrides have a base to cascade over.
    for (const v of [
      '--app-vw',
      '--app-vh',
      '--color-gold',
      '--color-accent',
      '--color-text-overlay',
      '--color-hp',
      '--color-mana',
      '--color-rage',
      '--color-energy',
    ]) {
      expect(tokensCode, `${v} default missing from tokens.css`).toContain(`${v}:`);
    }
  });

  it('absolutizes the cursor url()s (a relative url in bundled CSS / a custom prop breaks Lightning)', () => {
    for (const png of ['arrow.png', 'gauntlet.png', 'hand-grab.png']) {
      expect(tokensCode).toContain(`/ui/cursors/${png}`);
    }
    expect(tokensCode, 'page-relative ./ui/cursors must not survive in bundled CSS').not.toContain(
      './ui/cursors/',
    );
  });

  it('does NOT promote --range-fill to a :root token (it is the slider inline fallback)', () => {
    expect(tokensCode).not.toContain('--range-fill');
  });

  it('wraps the tokens under @layer tokens', () => {
    expect(tokens).toContain('@layer tokens {');
  });
});

describe('CSS extraction: base.css', () => {
  it('keeps the slider track --range-fill inline fallback (never promoted to :root)', () => {
    expect(baseCode).toMatch(/var\(--range-fill,\s*0%\)/);
  });

  it('keeps the load-bearing base rules that moved out of index.html', () => {
    expect(baseCode).toContain('body.game-active');
    expect(baseCode).toContain('#ui {');
    expect(baseCode).toContain('#game-canvas');
    expect(baseCode).toMatch(/::-webkit-scrollbar/);
    // the documented iOS 16px text-input zoom floor (a load-bearing !important rule)
    expect(baseCode).toMatch(/@media \(pointer: coarse\)/);
  });

  it('wraps the base block under @layer base', () => {
    expect(base).toContain('@layer base {');
  });
});

describe('CSS extraction: initial/deferred style seams', () => {
  const canonicalOrder =
    '@layer tokens, base, layout, components, hud, shell, hud-mobile, index-extra, play-extra;';

  it('declares the same flat @layer order in both style chunks', () => {
    expect(barrel).toContain(canonicalOrder);
    expect(gameStyles).toContain(canonicalOrder);
  });

  it('keeps only landing-shell modules in the initial style chunk', () => {
    for (const module of ['tokens.css', 'base.css', 'shell.css', 'hud.mobile.css']) {
      expect(barrel).toContain(`@import "./${module}";`);
    }
    for (const module of ['layout.css', 'hud.css', 'components.css']) {
      expect(barrel).not.toContain(`@import "./${module}";`);
    }
  });

  it('loads every in-world style module once in the deferred chunk', () => {
    for (const module of ['layout.css', 'hud.css', 'components.css']) {
      const statement = `@import "./${module}";`;
      expect(gameStyles).toContain(statement);
      expect(gameStyles.split(statement).length - 1).toBe(1);
    }
    expect(gameStyles.indexOf('@import "./hud.css";')).toBeLessThan(
      gameStyles.indexOf('@import "./components.css";'),
    );
  });

  it('statically imports landing CSS and dynamically imports in-world CSS', () => {
    expect(mainTs).toContain("import './styles/index.css'");
    expect(mainTs).toContain("import('./styles/game.css')");
  });

  it('flips Vite to the Lightning CSS transformer with browserslist-derived targets', () => {
    expect(viteConfig).toContain("transformer: 'lightningcss'");
    expect(viteConfig).toContain('browserslistToTargets');
    expect(viteConfig).toContain('loadBrowserslistFloors');
  });
});
