// accessibility guard: the focus ring must be STEADY and VISIBLE.
//
// The carried "FB lesson": a visible :focus-visible ring must NEVER be
// animated, blurred, transitioned, or filtered away. This Node guard scans the extracted
// stylesheets (src/styles/*.css) and asserts, for every :focus-visible rule block, that the
// block declares no transition / animation / filter / backdrop-filter / blur (which would
// fade, slide, or smear the ring), and that no rule anywhere animates the `outline` property
// from a base rule (which would animate the ring indirectly). It also pins, for
// the focus ring, that a :focus-visible `outline` must reference a token / system color, never a
// raw hex literal (the focus token is var(--color-border-focus); forced-colors uses the
// Highlight system keyword).
//
// This is a pure source scan, so it stays in the default Node suite (no browser) and always
// runs cheaply. It is OUTLINE-scoped by design: it guards the steady, tokenized outline ring
// the chrome draws on :focus-visible. A focus indicator carried instead by a box-shadow /
// border (a few pre-game shell controls do this) is out of scope here: the forced-colors net
// forces a steady system outline on every :focus-visible regardless, so those stay steady for
// high-contrast users. A live computed-style version over the box-shadow / border indicators
// now lives in the opt-in browser suite (tests/browser/focus_indicator.browser.test.ts, run
// via npm run test:browser): it keyboard-focuses each shell control and asserts a present,
// steady focus indicator (box-shadow, outline, or border-color), complementing this scan.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const STYLES_DIR = fileURLToPath(new URL('../src/styles/', import.meta.url));

// Strip comments so a property named inside a comment never trips the scan.
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function cssFiles(): { name: string; css: string }[] {
  return readdirSync(STYLES_DIR)
    .filter((f) => f.endsWith('.css'))
    .sort()
    .map((name) => ({ name, css: stripComments(readFileSync(STYLES_DIR + name, 'utf8')) }));
}

// Every :focus-visible rule block in a stylesheet, as { selector, body } pairs. The
// extracted CSS has no nested declaration braces (only @layer / @media wrap rules), so a
// leaf rule body runs from the selector's `{` to the next `}`. We key by the block-open
// index so a multi-selector group (e.g. the shared `.x-btn, .action-btn, ... :focus-visible`
// rule) is checked once, not once per selector.
function focusVisibleBlocks(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const seenOpen = new Set<number>();
  const re = /:focus-visible/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop.
  while ((m = re.exec(css)) !== null) {
    const open = css.indexOf('{', m.index);
    if (open < 0 || seenOpen.has(open)) continue;
    seenOpen.add(open);
    const close = css.indexOf('}', open + 1);
    if (close < 0) continue;
    // The selector is the run of text after the previous `}` or `{` up to this `{`.
    const prev = Math.max(css.lastIndexOf('}', open), css.lastIndexOf('{', open - 1));
    out.push({
      selector: css
        .slice(prev + 1, open)
        .trim()
        .replace(/\s+/g, ' '),
      body: css.slice(open + 1, close),
    });
  }
  return out;
}

// Does a :focus-visible block actually DRAW an outline ring (vs `outline: none`/`0`, where
// the focus emphasis is carried some other accessible way and there is no ring to destroy)?
function drawsOutlineRing(body: string): boolean {
  for (const decl of body.split(';')) {
    const m = /^\s*outline\s*:\s*(.+)$/i.exec(decl);
    if (m) return !/^(none|0)\b/i.test(m[1].trim());
  }
  return false;
}

// On a block that draws a ring, these would move / smear / fade THAT ring: a transition that
// names `outline` (or `all`), any keyframe animation (which could drive outline-color), or a
// blur() (filter or backdrop-filter) that smears the focused box. A plain `filter:
// brightness()` emphasis or a transition of an unrelated property (background) leaves the
// ring steady, so it is not flagged.
const RING_TRANSITION = /transition(?:-property)?\s*:[^;}]*\b(outline|all)\b/i;
const RING_ANIMATION = /\banimation\s*:/i;
const BLUR_FN = /\bblur\s*\(/i;

describe(':focus-visible ring is steady and visible (the FB lesson)', () => {
  const files = cssFiles();

  it('finds the focus-ring rules it is meant to guard (sanity: the scan is not vacuous)', () => {
    const total = files.reduce((n, f) => n + focusVisibleBlocks(f.css).length, 0);
    // There are dozens of :focus-visible rules across the chrome; pin a floor so an
    // accidental rename/refactor that stops matching is caught instead of passing empty.
    expect(total).toBeGreaterThan(10);
  });

  it('never animates / blurs / transitions the drawn outline ring on any :focus-visible block', () => {
    const offenders: string[] = [];
    for (const { name, css } of files) {
      for (const { selector, body } of focusVisibleBlocks(css)) {
        if (!drawsOutlineRing(body)) continue; // outline:none emphasis has no ring to destroy
        if (RING_TRANSITION.test(body) || RING_ANIMATION.test(body) || BLUR_FN.test(body)) {
          offenders.push(`${name}: ${selector} { ${body.trim().replace(/\s+/g, ' ')} }`);
        }
      }
    }
    expect(offenders, `animated/blurred focus rings:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('never transitions the outline property from a base rule (indirect ring animation)', () => {
    // A `transition: outline ...` (or transition-property naming outline) anywhere would
    // animate the ring even though the :focus-visible block itself looks clean.
    const offenders: string[] = [];
    for (const { name, css } of files) {
      const re = /transition(?:-property)?\s*:[^;}]*\boutline\b[^;}]*/gi;
      for (const hit of css.match(re) ?? []) offenders.push(`${name}: ${hit.trim()}`);
    }
    expect(offenders, `outline is transitioned:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('draws every :focus-visible outline from a token / system color, never a raw hex', () => {
    // The focus ring color must be var(--color-border-focus) (or the forced-colors Highlight
    // keyword), not a literal hex. Other declarations in the block (e.g. a background tint)
    // may still carry a hex; we only constrain the `outline` declaration.
    const offenders: string[] = [];
    for (const { name, css } of files) {
      for (const { selector, body } of focusVisibleBlocks(css)) {
        for (const decl of body.split(';')) {
          if (!/^\s*outline\s*:/i.test(decl)) continue;
          if (/#[0-9a-fA-F]{3,8}\b/.test(decl)) {
            offenders.push(`${name}: ${selector} { ${decl.trim()} }`);
          }
        }
      }
    }
    expect(offenders, `hardcoded focus-ring hex:\n${offenders.join('\n')}`).toEqual([]);
  });
});
