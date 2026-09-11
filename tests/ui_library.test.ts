import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  PRESET_ORDER,
  resolveTheme,
  THEME_PRESETS,
  themeCssVars,
} from '../src/ui/theme';

// The interface primitive library contract (src/ui/library/CLAUDE.md): the
// selector manifest in the doc and the classes declared in src/styles/library.css
// agree both ways, the sheet sits in its own layer, the size and radius tokens it
// reads exist, the quality tokens mirror the classic anchor in icons.ts, and the
// theme derivations that back the library's text and surface tokens reproduce the
// static defaults for the classic preset and clear AA on every preset.
//
// Two explicit reads, no directory scan, so the shared-walker rule does not apply.

const root = new URL('../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8').replace(/\r\n/g, '\n');

const library = read('src/styles/library.css');
const tokens = read('src/styles/tokens.css');
const doc = read('src/ui/library/CLAUDE.md');
const icons = read('src/ui/icons.ts');

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

// Shared chrome classes the library composes but does not own (base.css glyph sizing
// and the .ui-dd dropdown family); they are not primitives and stay off the manifest.
const EXTERNAL_UI_CLASSES = new Set(['.ui-icon', '.ui-icon-art']);

/** Every `.ui-*` class selector token in the sheet, compound state forms included. */
function declaredSelectors(css: string): Set<string> {
  const out = new Set<string>();
  const code = stripComments(css).replace(/\{[^{}]*\}/g, '{}');
  // Compound states: the library's is-* names plus the action-bar painter classes the
  // socket family accepts as aliases (empty, used, proc, oor, unusable).
  for (const m of code.matchAll(
    /\.ui-[a-z0-9-]+(?:\.(?:is-[a-z0-9-]+|empty|used|proc|oor|unusable))?/g,
  )) {
    if (!EXTERNAL_UI_CLASSES.has(m[0])) out.add(m[0]);
  }
  return out;
}

function manifestSelectors(md: string): string[] {
  const block = md.match(/## Selector manifest[\s\S]*?```text\n([\s\S]*?)```/);
  if (!block) throw new Error('src/ui/library/CLAUDE.md has no selector manifest block');
  return block[1]
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

describe('ui library: sheet and manifest agree', () => {
  const declared = declaredSelectors(library);
  const manifest = manifestSelectors(doc);

  it('lets a heading minted as a button inherit its host colour', () => {
    // The review finding: the quest tracker's QUESTS heading is a <button> and
    // neither type helper sets a colour, so it took the UA's black button text.
    expect(library).toMatch(/button\.ui-cin,\s*\n\s*button\.ui-outline \{\s*\n\s*color: inherit;/);
  });

  it('centres the rail label INSIDE the rail and swaps it on hover or focus', () => {
    // Pin moved with the review finding: the readout now rides the rail itself
    // (percent centred inside it) instead of hanging above it, and the detail
    // form arrives through the ::after content on hover / keyboard focus.
    expect(library).toMatch(/\.ui-rail-label \{[^}]*justify-content: center;/);
    expect(library).not.toMatch(/\.ui-rail-label \{[^}]*bottom: calc\(100% \+ 2px\);/);
    expect(library).toMatch(/\.ui-rail-label::after \{[^}]*content: attr\(data-total\);/);
    expect(library).toContain('.ui-rail:focus-within .ui-rail-label::after {');
  });

  it('keeps the window head at its authored height inside a flex column window', () => {
    expect(library).toMatch(/\.ui-win-head \{\s*display: flex;\s*flex: none;/);
  });

  it('gives a window with a .ui-win-body ONE scroller and a foot that cannot scroll away', () => {
    // The maintainer finding W25 fixes: a settings page with an Apply / Reset /
    // Confirm row must keep that row visible. The shell is the mechanism, so all
    // three halves are pinned: the window stops scrolling itself and becomes a
    // column, the body is the one scrollport, and the foot never shrinks.
    expect(library).toMatch(
      /\.ui-window:has\(> \.ui-win-body\) \{\s*flex-direction: column;\s*padding: 0;\s*overflow: hidden;\s*\}/,
    );
    expect(library).toMatch(
      /\.ui-win-body \{\s*flex: 1 1 auto;\s*min-height: 0;\s*overflow-y: auto;/,
    );
    expect(library).toMatch(/\.ui-win-foot \{[^}]*flex: none;/);
    expect(library).toMatch(
      /\.ui-win-foot \{[^}]*border-top: 1px solid var\(--color-border-showcase\);/,
    );
    // The shell must NOT declare a display of its own: a `.window` is opened by
    // an inline style.display, which no stylesheet rule can outrank, so a
    // display here would leave every closed window visible instead.
    expect(library).not.toMatch(/\.ui-window:has\(> \.ui-win-body\) \{[^}]*display:/);
  });

  it('puts the head, the body and the foot on the ONE window gutter', () => {
    // Finding 2 ("a lot of padding in the menus not nicely aligned"): the head's
    // inline start, the body's padding and the foot's buttons all read the same
    // --window-pad, so a label, a tab and a button line up on one x.
    const gutter = /padding: [^;]*var\(--window-pad, 12px\)/;
    expect(library.match(/\.ui-win-head \{[^}]*\}/)?.[0]).toMatch(gutter);
    expect(library.match(/\.ui-win-body \{[^}]*\}/)?.[0]).toMatch(gutter);
    expect(library.match(/\.ui-win-foot \{[^}]*\}/)?.[0]).toMatch(gutter);
  });

  it('paints card text with the text token even when the card is a button', () => {
    expect(library).toMatch(/\.ui-card \{[^}]*color: var\(--color-text\);/);
    expect(library).toMatch(/button\.ui-card \{\s*font: inherit;/);
  });

  it('lists a real primitive set (anti-vacuity)', () => {
    expect(declared.size).toBeGreaterThanOrEqual(50);
    expect(manifest.length).toBeGreaterThanOrEqual(50);
    for (const sentinel of [
      '.ui-window',
      '.ui-socket',
      '.ui-aura',
      '.ui-tabs',
      '.ui-range',
      '.ui-btn',
    ]) {
      expect(declared.has(sentinel), `${sentinel} missing from library.css`).toBe(true);
    }
  });

  it('every manifest line is declared in library.css', () => {
    const missing = manifest.filter((s) => !declared.has(s));
    expect(missing, 'manifest names a class library.css does not declare').toEqual([]);
  });

  it('every declared ui-* class is in the manifest', () => {
    const set = new Set(manifest);
    const undocumented = [...declared].filter((s) => !set.has(s)).sort();
    expect(undocumented, 'library.css declares a class the manifest does not name').toEqual([]);
  });

  it('keeps the manifest sorted and duplicate-free', () => {
    expect(manifest).toEqual([...new Set(manifest)].sort());
  });
});

describe('ui library: the sheet', () => {
  it('sits inside @layer library under its banner', () => {
    expect(stripComments(library).trimStart().startsWith('@layer library {')).toBe(true);
    expect(library).toContain('/* ---------- ui library (shared primitives) ---------- */');
  });

  it('is imported by the barrel between layout and components', () => {
    const barrel = read('src/styles/index.css');
    expect(barrel).toContain(
      '@layer tokens, base, layout, library, components, hud, shell, hud-mobile, index-extra, play-extra;',
    );
    const at = (m: string) => barrel.indexOf(`@import "./${m}";`);
    expect(at('library.css')).toBeGreaterThan(at('layout.css'));
    // The claim in the title is layout < library < components; hud.css sits between
    // the last two, so it is pinned as well rather than standing in for components.
    expect(at('library.css')).toBeLessThan(at('hud.css'));
    expect(at('library.css')).toBeLessThan(at('components.css'));
  });

  it('declares every size, radius and duration token the primitives read', () => {
    const code = stripComments(tokens);
    for (const name of [
      '--socket-size',
      '--socket-size-bag',
      '--socket-size-bank',
      '--socket-size-stance',
      // The coarse-pointer arm of the stance disc: the board's 30px on a
      // mouse, the 40px touch floor under @media (pointer: coarse).
      '--socket-size-stance-coarse',
      '--socket-gap',
      '--socket-row-gap',
      '--action-rail-w',
      '--aura-size',
      '--aura-size-own',
      '--portrait-size',
      '--level-chip-size',
      '--bar-h',
      '--bar-h-hp',
      '--bar-h-res',
      '--bar-h-res-empty',
      '--bar-notch',
      '--castbar-w',
      '--castbar-h',
      '--xp-rail-h',
      '--win-head-h',
      '--btn-h',
      '--tab-h',
      '--input-h',
      '--radius-2xs',
      '--radius-xs',
      '--radius-card',
      '--radius-panel',
      '--radius-socket',
      '--radius-cell',
      '--radius-window',
      '--radius-pill',
      '--dur-fast',
      '--dur-press',
      '--dur-panel',
      '--dur-frame',
    ]) {
      expect(code, `${name} missing from tokens.css`).toContain(`${name}:`);
    }
  });

  it('lifts the stance disc to the touch floor on a coarse pointer', () => {
    // The stance disc is the one socket species drawn under 40px. The shipped
    // .stance-btn was 40x40, so a touch device must keep that box even though
    // the board draws a 30px disc for a mouse. Playwright's context is always
    // fine-pointer, so this media arm can only be pinned from the source.
    const coarse = stripComments(library).match(
      /@media \(pointer: coarse\) \{\s*\.ui-socket--stance \{([^}]*)\}/,
    );
    expect(coarse, 'library.css is missing the coarse-pointer stance arm').not.toBeNull();
    expect(coarse?.[1]).toContain('--ui-socket-size: var(--socket-size-stance-coarse);');
    expect(stripComments(tokens)).toContain('--socket-size-stance-coarse: 40px;');
  });

  it('keeps the action rail exactly twelve sockets wide', () => {
    expect(stripComments(tokens)).toContain(
      '--action-rail-w: calc(12 * var(--socket-size) + 11 * var(--socket-gap));',
    );
  });

  it('mirrors QUALITY_COLOR in the quality tokens (icons.ts stays the anchor)', () => {
    const block = icons.match(/export const QUALITY_COLOR[^{]*\{([\s\S]*?)\};/);
    if (!block) throw new Error('QUALITY_COLOR not found in icons.ts');
    const anchor = new Map<string, string>();
    for (const m of block[1].matchAll(/(\w+):\s*'(#[0-9a-fA-F]{6})'/g))
      anchor.set(m[1], m[2].toLowerCase());
    expect(anchor.size).toBe(6);
    for (const [quality, hex] of anchor) {
      expect(stripComments(tokens)).toContain(`--color-quality-${quality}: ${hex};`);
    }
  });
});

describe('ui library: theme derivations back the text and surface tokens', () => {
  const classic = themeCssVars(THEME_PRESETS.classic);
  const staticDefault = (name: string) => {
    const m = stripComments(tokens).match(new RegExp(`${name}:\\s*([^;]+);`));
    if (!m) throw new Error(`${name} missing from tokens.css`);
    // Biome wraps long values across lines; compare the single-line form.
    return m[1].replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();
  };

  it('the classic preset reproduces the static defaults exactly (one value, two homes agree)', () => {
    expect(classic['--color-text-secondary']).toBe(staticDefault('--color-text-secondary'));
    expect(classic['--color-text-faint']).toBe(staticDefault('--color-text-faint'));
    expect(classic['--panel-bg-soft']).toBe(staticDefault('--panel-bg-soft'));
    expect(classic['--panel-bg-strong']).toBe(staticDefault('--panel-bg-strong'));
    for (const name of [
      '--color-info',
      '--color-warning',
      '--color-socket-hi',
      '--color-panel-hi',
      '--color-glint',
      '--color-control-border',
    ]) {
      expect(classic[name], name).toBe(staticDefault(name));
    }
  });

  it('secondary, faint, info and warning text clear the text tier on every preset', () => {
    for (const id of PRESET_ORDER) {
      const vars = themeCssVars(resolveTheme({ preset: id, custom: {} }));
      for (const bg of [vars['--panel-base'], vars['--panel-edge']]) {
        expect(
          contrastRatio(vars['--color-text-secondary'], bg),
          `${id} secondary on ${bg}`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(vars['--color-text-faint'], bg),
          `${id} faint on ${bg}`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(vars['--color-info'], bg),
          `${id} info on ${bg}`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(vars['--color-warning'], bg),
          `${id} warning on ${bg}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('the soft and strong panel fills keep the panel gradient shape at their alphas', () => {
    for (const id of PRESET_ORDER) {
      const vars = themeCssVars(resolveTheme({ preset: id, custom: {} }));
      expect(vars['--panel-bg-soft']).toMatch(
        /^linear-gradient\(170deg, rgba\(\d+, \d+, \d+, 0\.74\) 0%/,
      );
      expect(vars['--panel-bg-strong']).toMatch(
        /^linear-gradient\(170deg, rgba\(\d+, \d+, \d+, 0\.97\) 0%/,
      );
    }
  });
});

// The Parchment contrast family (maintainer review): several primitives paired a
// PRESET-DERIVED foreground with a FIXED-DARK surface, so the derived text went
// dark under Parchment and the pair collapsed toward 1:1. The AA test above could
// not see it, because it only pairs derived text against the derived --panel-base
// / --panel-edge, which move together. The fix is a fixed light foreground per
// fixed surface; this table is the pair list, asserted for real.
//
// Threshold: 4.5:1 everywhere. Not one of these primitives renders at the WCAG
// large tier (the biggest is the 13px .ui-input; the 12px display-font buttons
// and tabs are nowhere near 18.66px bold), so none earns the 3:1 relaxation.
interface ContrastPair {
  /** The library rule that must READ the foreground token. */
  selector: string;
  fg: string;
  /** Every fixed stop of that rule's surface: the worst one has to clear AA. */
  surfaces: string[];
  min: number;
}

const LIBRARY_CONTRAST_PAIRS: ContrastPair[] = [
  { selector: '.ui-keycap', fg: '--color-text-on-ink-soft', surfaces: ['--color-ink'], min: 4.5 },
  {
    selector: '.ui-socket-key',
    fg: '--color-text-on-ink-soft',
    surfaces: ['--color-ink-deep'],
    min: 4.5,
  },
  {
    selector: '.ui-pill',
    fg: '--color-text-on-ink-soft',
    surfaces: ['--color-ink-deep'],
    min: 4.5,
  },
  { selector: '.ui-input', fg: '--color-text-on-ink', surfaces: ['--color-bg-input'], min: 4.5 },
  {
    selector: '.ui-card-tile',
    fg: '--color-text-on-ink',
    surfaces: ['--color-card-hi', '--color-card-lo'],
    min: 4.5,
  },
  {
    selector: '.ui-btn--red',
    fg: '--color-text-on-red',
    surfaces: ['--color-btn-red-hi', '--color-btn-red-lo'],
    min: 4.5,
  },
  {
    selector: '.ui-btn--gold',
    fg: '--color-text-on-gold-btn',
    surfaces: ['--color-btn-gold-hi', '--color-medal-hi', '--color-btn-gold-lo'],
    min: 4.5,
  },
  {
    selector: '.ui-btn[aria-pressed="true"]',
    fg: '--color-text-on-medal',
    surfaces: ['--color-medal-hi', '--color-medal-lo'],
    min: 4.5,
  },
  {
    selector: '.ui-chip[aria-pressed="true"]',
    fg: '--color-text-on-medal',
    surfaces: ['--color-medal-hi', '--color-medal-lo'],
    min: 4.5,
  },
  {
    selector: '.ui-medal',
    fg: '--color-text-on-medal',
    surfaces: ['--color-medal-hi', '--color-medal-lo'],
    min: 4.5,
  },
  {
    selector: '.ui-tab[aria-selected="true"]',
    fg: '--color-text-on-tab-on',
    surfaces: ['--color-tab-on-hi', '--color-tab-on-lo'],
    min: 4.5,
  },
  {
    selector: '.ui-seg-tab[aria-selected="true"]',
    fg: '--color-text-on-tab-on',
    surfaces: ['--color-tab-on-hi', '--color-tab-on-lo'],
    min: 4.5,
  },
];

describe('ui library: fixed foregrounds on the fixed-dark surfaces', () => {
  const code = stripComments(library);
  const tokenHex = (name: string): string => {
    const m = stripComments(tokens).match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6});`));
    if (!m) throw new Error(`${name} is not a plain hex token in tokens.css`);
    return m[1];
  };

  it('reads the fixed foreground token in every primitive that sits on a fixed surface', () => {
    for (const pair of LIBRARY_CONTRAST_PAIRS) {
      // The selector may sit in a comma list, so walk to its rule's own brace.
      const at = code.indexOf(pair.selector);
      expect(at, `library.css has no rule for ${pair.selector}`).toBeGreaterThan(-1);
      const open = code.indexOf('{', at);
      const body = code.slice(open, code.indexOf('}', open));
      expect(body, `${pair.selector} must read ${pair.fg}`).toContain(`color: var(${pair.fg});`);
    }
  });

  it('never lets a preset re-emit a fixed foreground or a fixed surface token', () => {
    // This is the whole mechanism: the moment theme.ts derives one of these, the
    // pair goes back to derived-on-fixed and Parchment breaks again.
    const fixed = new Set(LIBRARY_CONTRAST_PAIRS.flatMap((pair) => [pair.fg, ...pair.surfaces]));
    for (const id of PRESET_ORDER) {
      const vars = themeCssVars(resolveTheme({ preset: id, custom: {} }));
      for (const name of fixed) {
        expect(vars[name], `${id} re-emits ${name}`).toBeUndefined();
      }
    }
  });

  it.each(PRESET_ORDER)('every primitive pair clears AA on the %s preset', (id) => {
    const vars = themeCssVars(resolveTheme({ preset: id, custom: {} }));
    for (const pair of LIBRARY_CONTRAST_PAIRS) {
      // Fixed on both sides, so a preset can only break this by starting to
      // derive one of them; read through the preset map anyway so it would.
      const fg = vars[pair.fg] ?? tokenHex(pair.fg);
      for (const surface of pair.surfaces) {
        const bg = vars[surface] ?? tokenHex(surface);
        expect(
          contrastRatio(fg, bg),
          `${id}: ${pair.selector} ${pair.fg} on ${surface}`,
        ).toBeGreaterThanOrEqual(pair.min);
      }
    }
  });
});

// W20 correctness sweep: three library-side findings.
describe('ui library: hover states and the orphan tokens', () => {
  const code = stripComments(library);
  const hudCss = read('src/styles/hud.css');

  const ruleBody = (css: string, selector: string): string => {
    const at = css.indexOf(`\n  ${selector} {`);
    expect(at, `no rule for ${selector}`).toBeGreaterThan(-1);
    const open = css.indexOf('{', at);
    return css.slice(open + 1, css.indexOf('}', open));
  };

  // A disabled control must not light a gold edge under the pointer. The guard is
  // written :where(:not(:disabled)) so it adds no specificity: an unguarded
  // .ui-tab:hover at (0,2,0) already lost to .ui-tab[aria-selected="true"], and a
  // plain :not() would have flipped that tie and de-accented the selected tab.
  it('guards every hover state against :disabled without gaining specificity', () => {
    for (const family of ['.ui-btn', '.ui-icon-btn', '.ui-disc', '.ui-tab']) {
      expect(code, `${family}:hover must be guarded`).toContain(
        `${family}:hover:where(:not(:disabled)) {`,
      );
      expect(code, `${family}:hover must not stay unguarded`).not.toContain(
        `\n  ${family}:hover {`,
      );
    }
  });

  // .vendor-item:hover was narrowed to :not(.ui-card), which left every card and
  // chip that IS a button with no pointer feedback at all.
  it('gives an interactive card or chip pointer feedback, and a static one none', () => {
    for (const selector of [
      'button.ui-card:hover:where(:not(:disabled)),\n  .ui-card[role="button"]:hover',
      'button.ui-chip:hover:where(:not(:disabled)),\n  .ui-chip[role="button"]:hover',
    ]) {
      const at = code.indexOf(`  ${selector} {`);
      expect(at, `no interactive hover for ${selector}`).toBeGreaterThan(-1);
      const open = code.indexOf('{', at);
      expect(code.slice(open + 1, code.indexOf('}', open))).toContain('filter: brightness(1.06);');
    }
    // A plain .ui-card / .ui-chip stays inert: the hover is on the button forms only.
    expect(code).not.toContain('\n  .ui-card:hover {');
    expect(code).not.toContain('\n  .ui-chip:hover {');
  });

  // --tracker-w, --chat-w and --dur-press were declared with zero consumers while
  // the rules they were meant to drive spelled the literal.
  it('reads --dur-press for the button press instead of a literal', () => {
    expect(ruleBody(code, '.ui-btn')).toContain('transition: transform var(--dur-press);');
    // Every transition here drops under reduced motion; the pressed offset still lands.
    expect(code).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.ui-toggle-thumb,\s*\.ui-btn \{/,
    );
    expect(code).toContain('body.reduce-motion .ui-btn {');
  });

  it('reads --tracker-w and --chat-w at the sites that hard-coded them', () => {
    for (const [token, literal, count] of [
      ['--tracker-w', '240px', 3],
      ['--chat-w', '370px', 2],
    ] as const) {
      expect(tokens, `${token} must still be declared`).toContain(`${token}:`);
      expect(
        (hudCss.match(new RegExp(`var\\(${token}\\)`, 'g')) ?? []).length,
        `${token} has no consumers`,
      ).toBe(count);
      // Anti-vacuity: the token's own value is still the literal it replaced.
      expect(tokens).toContain(`${token}: ${literal};`);
    }
  });
});
