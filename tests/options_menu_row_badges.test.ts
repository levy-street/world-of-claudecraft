// Regression: the Esc menu's row badges (the Wiki row's external-hop chevron and
// the Report a Bug row's "Online" status) are absolutely positioned at the
// inline end of a .ui-btn (options_window.ts renderMain). Absolute positioning
// takes them out of the button's flex flow, so with only the inline-end inset
// declared they sat at the top of the plate instead of on the label's centre
// line (the chevron a few px high, the status text pinned to the top edge).
// Pin the explicit vertical centring so a later restyle cannot drop it again.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const componentsCss = readFileSync(
  new URL('../src/styles/components.css', import.meta.url),
  'utf8',
);

function stripCssComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** The body of the one rule block whose selector list is exactly `selector`. */
function ruleBody(css: string, selector: string): string {
  const needle = `${selector} {`;
  const start = css.indexOf(needle);
  expect(start, `could not find rule "${selector}"`).toBeGreaterThanOrEqual(0);
  const body = css.slice(start + needle.length);
  return stripCssComments(body.slice(0, body.indexOf('}')));
}

describe('options menu row badges sit on the button centre line', () => {
  const shared = ruleBody(componentsCss, '.opt-btn-chevron,\n  .opt-btn-status');

  it('the chevron and status share one absolutely positioned, inline-end anchored rule', () => {
    expect(shared).toMatch(/position:\s*absolute/);
    expect(shared).toMatch(/inset-inline-end:\s*\d+px/);
  });

  it('centres both vertically instead of leaving them at the static top position', () => {
    // top: 50% + translateY(-50%) is the height-agnostic pair: the chevron is a
    // 12px box and the status is 10px text, so a fixed top offset would centre
    // at most one of them.
    expect(shared).toMatch(/\btop:\s*50%/);
    expect(shared).toMatch(/transform:\s*translateY\(-50%\)/);
  });

  it('the button plate is the positioning context, at the specificity the menu reset demands', () => {
    // `#options-menu button.ui-btn { all: revert-layer }` (id + element + class)
    // discards a bare `.opt-btn` rule, which is how the badges came to resolve
    // against the whole window; the plate rule has to outrank that reset.
    expect(ruleBody(componentsCss, '#options-menu .opt-btn.ui-btn')).toMatch(
      /position:\s*relative/,
    );
    expect(componentsCss).not.toMatch(/\n {2}\.opt-btn \{/);
  });
});
