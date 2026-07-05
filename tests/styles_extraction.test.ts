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

describe('CSS extraction: barrel + seam wiring', () => {
  it('declares the single @layer order once, with hud-mobile after shell and the per-entry extras last', () => {
    // Flat (hyphenated) layer names: a DOT would make hud-mobile/index-extra/play-extra
    // SUBLAYERS, not top-level layers. hud-mobile is ordered AFTER shell so the
    // in-game mobile overrides of pre-game shell elements win as they did when inline.
    expect(barrel).toContain(
      '@layer tokens, base, layout, components, hud, shell, hud-mobile, index-extra, play-extra;',
    );
  });

  it('@imports every shared module exactly once (a dropped @import ships the game unstyled with a green suite)', () => {
    // Every other CSS guard (css_corpus, client_shell, charselect, mobile_window_transform)
    // reads the modules off disk directly, so deleting an @import line here leaves the whole
    // suite green while that layer never loads at runtime. Pin the seam itself.
    for (const m of [
      'tokens.css',
      'base.css',
      'layout.css',
      'hud.css',
      'components.css',
      'shell.css',
      'hud.mobile.css',
    ]) {
      const imp = `@import "./${m}";`;
      expect(barrel, `barrel must @import ${m}`).toContain(imp);
      expect(barrel.split(imp).length - 1, `barrel must @import ${m} exactly once`).toBe(1);
    }
  });

  it('@imports in cascade order, with hud.css BEFORE components.css (same @layer components tie-break)', () => {
    // Import order roughly follows the @layer cascade. The one deliberate exception:
    // hud.css and components.css both target @layer components, so components.css is
    // imported LAST of the pair to win equal-specificity ties (the pre-extraction
    // unlayered precedence). hud-mobile is imported after shell so its in-game overrides
    // of pre-game shell elements win.
    const at = (m: string) => barrel.indexOf(`@import "./${m}";`);
    const order = [
      'tokens.css',
      'base.css',
      'layout.css',
      'hud.css',
      'components.css',
      'shell.css',
      'hud.mobile.css',
    ];
    for (let i = 1; i < order.length; i++) {
      expect(at(order[i]), `${order[i]} must be imported after ${order[i - 1]}`).toBeGreaterThan(
        at(order[i - 1]),
      );
    }
  });

  it('imports the barrel once from the shared game bootstrap (covers index.html + play.html)', () => {
    expect(mainTs).toContain("import './styles/index.css'");
  });

  it('flips Vite to the Lightning CSS transformer with browserslist-derived targets', () => {
    expect(viteConfig).toContain("transformer: 'lightningcss'");
    expect(viteConfig).toContain('browserslistToTargets');
    expect(viteConfig).toContain('loadBrowserslistFloors');
  });
});
