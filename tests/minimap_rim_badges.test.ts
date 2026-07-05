// Regression guard for the minimap rim satellites (src/styles/hud.css). The
// raid-lockout badge and the Ravenpost mail indicator are both absolutely
// positioned children of #minimap-disc. Both originally anchored to the same
// corner (left + bottom), so whenever unread mail and the lockout badge were
// visible at once they stacked on top of each other. Each rim badge must claim
// exactly one horizontal and one vertical inset, and no two badges may share a
// corner.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);

const RIM_BADGE_SELECTORS = ['#raid-lockout', '#mail-indicator'];

// The base rule for each badge is the bare selector followed by "{" (the
// pseudo-class, descendant, and [hidden] rules never match that shape), and
// none of these blocks nest braces.
function declarationBlock(selector: string): string {
  const match = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`missing ${selector} rule in src/styles/hud.css`);
  return match[1];
}

function anchoredCorner(selector: string): string {
  const block = declarationBlock(selector);
  const anchoredSides = (sides: string[]) =>
    sides.filter((side) => new RegExp(`(?:^|[\\s;])${side}\\s*:`).test(block));
  const horizontal = anchoredSides(['left', 'right']);
  const vertical = anchoredSides(['top', 'bottom']);
  expect(horizontal, `${selector} must anchor exactly one of left/right`).toHaveLength(1);
  expect(vertical, `${selector} must anchor exactly one of top/bottom`).toHaveLength(1);
  return `${horizontal[0]}+${vertical[0]}`;
}

describe('minimap rim badges', () => {
  it('anchors each rim badge to a distinct corner of the minimap disc', () => {
    const corners = RIM_BADGE_SELECTORS.map(anchoredCorner);
    expect(
      new Set(corners).size,
      `rim badges share a corner: ${RIM_BADGE_SELECTORS.map((s, i) => `${s} at ${corners[i]}`).join(', ')}`,
    ).toBe(corners.length);
  });
});
