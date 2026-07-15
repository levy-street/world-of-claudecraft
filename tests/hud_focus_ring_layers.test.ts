// Cascade-layer focus-ring guard for HUD chrome controls.
//
// The shared keyboard focus ring lives in base.css (@layer base):
//   .action-btn:focus-visible, .micro-btn:focus-visible, ... {
//     outline: 2px solid var(--color-border-focus); outline-offset: 2px }
// hud.css sits in the LATER @layer components (see the src/styles/index.css layer
// order), and for normal declarations a later layer wins the cascade regardless of
// specificity. So the moment a component rule in hud.css puts ANY outline longhand or
// shorthand on one of those focus-net controls (e.g. the decorative 1px bezel ring the
// micro-dock redesign gave .action-btn / .micro-btn), the base-layer focus ring is
// silently defeated for that control: a keyboard-focused slot shows only its dim
// resting bezel. base.css documents the same mechanic in its forced-colors block,
// which survives only because it is !important.
//
// Neither existing guard can see this class of bug: focus_visible_guard.test.ts only
// scans :focus-visible blocks (which look fine), and the opt-in browser suite runs
// against the dev-served stylesheet where Vite flattens the @layer structure, so the
// defeat does not reproduce there. This Node scan closes the gap at the source level:
// every focus-net control that hud.css decorates with an outline must ALSO have its
// accent focus ring re-declared in hud.css (same layer, so :focus-visible specificity
// wins again).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string): string =>
  fs.readFileSync(path.resolve(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n');

// Split a stylesheet into flat `selector { body }` pairs, ignoring at-rule nesting
// (rules inside @layer/@media blocks are still found: the scanner walks to each `{`
// and, when the preceding selector is not an at-rule, captures until the balancing
// `}`). Good enough for this file's hand-authored, non-nested CSS.
function rules(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  let i = 0;
  let start = 0;
  const stack: number[] = [];
  while (i < css.length) {
    const ch = css[i];
    if (ch === '{') {
      const selector = css.slice(start, i).trim();
      if (selector.startsWith('@')) {
        // at-rule block: descend into it, treating its contents as top level
        stack.push(0);
        start = i + 1;
      } else {
        // plain rule: capture to the balancing close brace
        let depth = 1;
        let j = i + 1;
        while (j < css.length && depth > 0) {
          if (css[j] === '{') depth++;
          else if (css[j] === '}') depth--;
          j++;
        }
        out.push({ selector, body: css.slice(i + 1, j - 1) });
        i = j;
        start = j;
        continue;
      }
    } else if (ch === '}') {
      stack.pop();
      start = i + 1;
    }
    i++;
  }
  return out;
}

// Strip comments so a commented-out declaration never counts.
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('hud.css outline decorations never defeat the base-layer focus ring', () => {
  const base = stripComments(read('src/styles/base.css'));
  const hud = stripComments(read('src/styles/hud.css'));
  const hudRules = rules(hud);

  // The focus-net control classes: the selector list of the base.css rule that draws
  // the shared 2px accent ring. Parsed, not hardcoded, so the net can grow. Anchored
  // on .micro-btn (a stable net member) because base.css has other rules that draw
  // the same accent outline (e.g. the checkbox/radio pair).
  const focusNetRule = rules(base).find(
    (r) =>
      r.selector.includes('.micro-btn:focus-visible') &&
      r.body.includes('outline: 2px solid var(--color-border-focus)'),
  );
  if (!focusNetRule) throw new Error('base.css shared :focus-visible ring rule not found');
  const netClasses = [
    ...new Set([...focusNetRule.selector.matchAll(/\.([a-z-]+):focus-visible/g)].map((m) => m[1])),
  ];

  it('parses a plausible focus net from base.css', () => {
    expect(netClasses).toContain('action-btn');
    expect(netClasses).toContain('micro-btn');
    expect(netClasses.length).toBeGreaterThanOrEqual(8);
  });

  // Every focus-net class that any hud.css rule decorates with an outline (shorthand
  // or longhand, resting or state variant) must have its accent ring re-declared by a
  // hud.css :focus-visible rule, so the ring wins again within the same layer.
  const outlineDecl = /(?:^|;|\{)\s*outline(?:-color|-width|-style)?\s*:/;
  for (const cls of netClasses) {
    const classToken = new RegExp(`\\.${cls}(?![a-z-])`);
    const decorated = hudRules.some(
      (r) =>
        classToken.test(r.selector) &&
        !r.selector.includes(':focus-visible') &&
        outlineDecl.test(r.body),
    );
    if (!decorated) continue;
    it(`.${cls} carries a decorative outline in hud.css, so hud.css must re-declare its accent focus ring`, () => {
      const redeclared = hudRules.some(
        (r) =>
          r.selector.split(',').some((s) => s.trim() === `.${cls}:focus-visible`) &&
          r.body.includes('outline: 2px solid var(--color-border-focus)') &&
          r.body.includes('outline-offset: 2px'),
      );
      expect(
        redeclared,
        `hud.css gives .${cls} a decorative outline (later @layer components beats the ` +
          `base-layer focus ring), but never re-declares ` +
          `".${cls}:focus-visible { outline: 2px solid var(--color-border-focus); ` +
          `outline-offset: 2px }" in hud.css`,
      ).toBe(true);
    });
  }

  it('covers at least the two bezel-on-outline controls of the micro-dock redesign', () => {
    // If a future refactor moves the bezel off `outline` entirely this pin goes stale
    // on purpose: delete it together with the per-class checks above becoming empty.
    const decoratedNow = netClasses.filter((cls) => {
      const classToken = new RegExp(`\\.${cls}(?![a-z-])`);
      return hudRules.some(
        (r) =>
          classToken.test(r.selector) &&
          !r.selector.includes(':focus-visible') &&
          outlineDecl.test(r.body),
      );
    });
    expect(decoratedNow).toContain('action-btn');
    expect(decoratedNow).toContain('micro-btn');
  });
});
