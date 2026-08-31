import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Regression guard for the mobile-controller cross-hotbar overlap bug: a large
// tail of hud.css (proc-overlay, the breath bar, and the whole .xhb
// cross-hotbar family) had fallen OUTSIDE @layer components. The file's TOTAL
// brace balance still summed to zero (css_corpus's per-file check stayed
// green: every rule closed its own braces correctly), because one `@layer
// components {` block simply closed one brace too early and nothing reopened
// it for the rest of the file. Per the CSS Cascade Layers spec, an unlayered
// rule always outranks a layered one regardless of specificity or source
// order, so hud.mobile.css's `body.mobile-touch .xhb { display: none; }`
// guard (meant to stand the cross-hotbar overlay down whenever the touch
// interface owns the action-bar band, see its own comment) was silently
// inert: pairing a gamepad to a phone kept the cross-hotbar's face-diamond
// and arrange-chord hint drawn over the mobile action ring's touch buttons.
//
// css_corpus's brace-balance check cannot catch this class of bug (a rule
// that is individually well-formed but nested at the WRONG depth), so this
// guard walks each barrel-imported module and asserts every top-level rule or
// at-rule sits inside the module's own `@layer <name>` wrapper -- multiple
// same-named `@layer` blocks in one file are fine (several modules use that),
// but a bare top-level rule between them is not.

const root = new URL('../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8').replace(/\r\n/g, '\n');

/** Replace comments and quoted strings with same-length whitespace (preserving
 *  newlines), so brace/line counting never trips over a literal brace inside
 *  `content: "}"` or a commented-out rule, while keeping line numbers intact
 *  for a useful failure message (unlike css_corpus's braceBalance, which
 *  deletes matches outright since it only needs a final count). */
function maskCommentsAndStrings(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, (m) => ' '.repeat(m.length));
}

/** Every TOP-LEVEL (brace-depth 0) rule/at-rule opener that is not itself an
 *  `@layer <expectedName> {` block, as 1-indexed line numbers with the
 *  offending selector/at-rule text. Line-oriented (one opener per line,
 *  Biome's own formatting convention for this tree), matching the convention
 *  every module in src/styles already follows. */
function unlayeredTopLevelOpeners(css: string, expectedLayerName: string): string[] {
  const masked = maskCommentsAndStrings(css);
  const lines = masked.split('\n');
  const rawLines = css.split('\n');
  const violations: string[] = [];
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();
    const layerOpen = /^@layer\s+([\w.-]+)\s*\{$/.exec(stripped);
    if (layerOpen) {
      if (depth === 0 && layerOpen[1] !== expectedLayerName) {
        violations.push(
          `line ${i + 1}: @layer ${layerOpen[1]} (expected @layer ${expectedLayerName}): ${rawLines[i].trim()}`,
        );
      }
      depth++;
      continue;
    }
    if (depth === 0 && stripped.endsWith('{') && !stripped.startsWith('@')) {
      violations.push(`line ${i + 1}: ${rawLines[i].trim()}`);
    }
    // Depth-0 at-rules other than @layer (@media/@supports/@keyframes/...) are
    // also unlayered top-level content: their entire block sits outside the
    // named layer even though nothing INSIDE them is individually malformed.
    if (depth === 0 && stripped.endsWith('{') && stripped.startsWith('@') && !layerOpen) {
      violations.push(`line ${i + 1}: ${rawLines[i].trim()}`);
    }
    for (const ch of lines[i]) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
  }
  return violations;
}

// One entry per barrel-imported module that targets exactly one named layer
// (src/styles/CLAUDE.md's module table). The two per-entry `.extra.css`
// sheets are excluded on purpose: index.extra.css is documented as
// DELIBERATELY unlayered (it must outrank every layered rule).
//
// components.css and shell.css are DELIBERATELY left off this list: running
// this same check against them turned up their own pre-existing unlayered
// leaks (components.css's #talents-window rows, shell.css's
// .appearance-customizer block), which are a real instance of the same
// defect class but unrelated to the mobile-controller cross-hotbar overlap
// this suite guards, so they are out of scope for this change and tracked
// separately (issue #3667) rather than fixed here.
const LAYERED_MODULES: { file: string; layer: string }[] = [
  { file: 'src/styles/tokens.css', layer: 'tokens' },
  { file: 'src/styles/base.css', layer: 'base' },
  { file: 'src/styles/layout.css', layer: 'layout' },
  { file: 'src/styles/hud.css', layer: 'components' },
  { file: 'src/styles/hud.mobile.css', layer: 'hud-mobile' },
];

describe('src/styles layer containment', () => {
  it.each(LAYERED_MODULES)(
    'every top-level rule in $file sits inside @layer $layer',
    ({ file, layer }) => {
      const css = read(file);
      const violations = unlayeredTopLevelOpeners(css, layer);
      expect(
        violations,
        `${file} has top-level content outside @layer ${layer} (an unlayered rule always ` +
          `outranks a layered one, regardless of specificity or source order, so any override ` +
          `for it in a later-cascading layer like hud-mobile silently stops applying):\n` +
          violations.slice(0, 10).join('\n'),
      ).toEqual([]);
    },
  );

  it('teeth: a rule stranded between two @layer blocks is flagged', () => {
    const css = `
@layer components {
  .a { color: red; }
}
.stray {
  color: blue;
}
@layer components {
  .b { color: green; }
}
`;
    expect(unlayeredTopLevelOpeners(css, 'components')).toEqual([
      expect.stringContaining('.stray'),
    ]);
  });

  it('teeth: several same-named @layer blocks in one file are fine on their own', () => {
    const css = `
@layer components {
  .a { color: red; }
}
@layer components {
  .b { color: green; }
}
`;
    expect(unlayeredTopLevelOpeners(css, 'components')).toEqual([]);
  });

  it('pins the exact defect: the cross-hotbar overlay stays inside @layer components', () => {
    const hud = read('src/styles/hud.css');
    const violations = unlayeredTopLevelOpeners(hud, 'components');
    const xhbViolations = violations.filter((v) => /\.xhb\b|#proc-overlay|\.breath-bar/.test(v));
    expect(
      xhbViolations,
      `cross-hotbar / proc-overlay / breath-bar rules must stay layered:\n${xhbViolations.join('\n')}`,
    ).toEqual([]);
  });
});
