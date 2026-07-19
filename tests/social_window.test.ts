import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Source-level guards for the social painter. The pure row + signature decisions are
// unit-tested in social_view.test.ts; here we pin the no-magic-values
// contract (no raw hex, no bare cadence literal) and the load-bearing listener
// delegation: social repaints on the slow-HUD divider, so a content refresh must NOT
// re-attach per-row handlers (one delegated listener on the persistent body does it).
const painter = readFileSync(new URL('../src/ui/social_window.ts', import.meta.url), 'utf8');
const componentsCss = readFileSync(
  new URL('../src/styles/components.css', import.meta.url),
  'utf8',
);

describe('social_window: .soc-body layout never uses CSS multicol', () => {
  // Regression for a review finding on the wide-landscape relayout: `.soc-body` is a
  // flex item inside `#social-window`, which has a DEFINED height (`height: 480px`). A
  // multicol container (`columns:`/`column-count:`) with a bounded, non-auto block size
  // does not grow vertically: it spills rows past the box into extra INLINE columns
  // instead, and `overflow-x: hidden` (also set here) clips them with no scroll path to
  // reach them, so friends/guild/ignored/blocked rows past roughly the first two columns
  // silently vanish and are unreachable. `overflow-y: auto` on a grid, by contrast, keeps
  // working because grid rows wrap and grow the scrollable block axis. Pin the fix as
  // grid, not multicol, so this cannot regress back to `columns:`.
  const body = (() => {
    const start = componentsCss.indexOf('.soc-body {');
    expect(start, '.soc-body rule not found in components.css').toBeGreaterThan(-1);
    const end = componentsCss.indexOf('}', start);
    return componentsCss.slice(start, end);
  })();

  it('lays friend/guild/ignore/block rows out with CSS grid', () => {
    expect(body).toContain('display: grid');
    expect(body).toContain('grid-template-columns: repeat(auto-fill, minmax(260px, 1fr))');
  });

  it('never declares columns or column-count (the bug: overflow columns get clipped, not scrolled)', () => {
    expect(body).not.toMatch(/(?:^|[;{\s])columns\s*:/);
    expect(body).not.toMatch(/(?:^|[;{\s])column-count\s*:/);
  });

  it('keeps overflow-y auto so the grid rows remain reachable by scroll', () => {
    expect(body).toContain('overflow-y: auto');
  });
});

describe('social_window: no magic values', () => {
  it('carries no literal hex color in TS (status dots are CSS-classed)', () => {
    const hex = painter.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hex, `hex colors must move to tokens/CSS: ${hex.join(', ')}`).toEqual([]);
  });

  it('contains no bare 500 cadence literal (the slow-HUD divider lives in hud.ts)', () => {
    expect(painter).not.toMatch(/\b500\b/);
  });

  it('names the typeahead timing constants instead of bare literals', () => {
    expect(painter).toContain('SUGGEST_DEBOUNCE_MS');
    expect(painter).toContain('SUGGEST_BLUR_CLEAR_MS');
  });

  it('uses no em or en dashes (ASCII separators only)', () => {
    expect(painter.includes('—'), 'em dash found').toBe(false);
    expect(painter.includes('–'), 'en dash found').toBe(false);
  });
});

describe('social_window: WAI-ARIA tabs', () => {
  // The tab-strip markup (role=tablist/tab, aria-selected, roving tabindex) and the
  // roving Arrow/Home/End wiring both moved onto the shared tab_strip_view.ts /
  // tab_strip_painter.ts building blocks (their own contracts are pinned in
  // tab_strip_view.test.ts / tab_strip_painter.test.ts); this file now pins that
  // social_window composes them with its five real tabs (friends / guild / ignore /
  // block / raid: ignore and block are two distinct tiers and get a tab each) instead
  // of hand-rolling the markup or the keyboard handler itself.
  it('builds its tab strip from the shared tab_strip_view / tab_strip_painter modules', () => {
    expect(painter).toContain("from './tab_strip_view'");
    expect(painter).toContain("from './tab_strip_painter'");
    expect(painter).toContain('tabStripHtml(');
    expect(painter).toContain('tabStripModel(');
    expect(painter).toContain('wireTabStrip(');
    expect(painter).toContain("panelId: 'soc-body-panel'");
    expect(painter).toContain("stripClass: 'soc-tabs'");
    expect(painter).toContain("tabClass: 'soc-tab'");
    expect(painter).toContain("selectedClass: 'on'");
    for (const id of ['friends', 'guild', 'ignore', 'block', 'raid']) {
      expect(painter).toContain(`{ id: '${id}',`);
    }
  });

  it('makes .soc-body the labelled tabpanel (refreshList still queries it by class)', () => {
    expect(painter).toContain('id="soc-body-panel"');
    expect(painter).toContain('role="tabpanel"');
    expect(painter).toContain('class="soc-body"');
  });

  it('drops aria-pressed entirely (a tab is not a toggle button)', () => {
    expect(painter).not.toContain('aria-pressed');
  });

  it('refocuses the newly active tab only on a keyboard move, matching the shared wiring contract', () => {
    expect(painter).toContain('(id, focusFollow) => {');
    expect(painter).toContain('if (focusFollow) focusActiveTab(el,');
  });
});

describe('social_window: delegated row listeners (no per-tick churn)', () => {
  it('wires ONE delegated click listener on the body in render(), dispatched by onBodyClick', () => {
    expect(painter).toMatch(/body\.addEventListener\('click'/);
    expect(painter).toContain('private onBodyClick(');
  });

  it('the content refresh only swaps innerHTML and re-attaches no row handlers', () => {
    // Isolate refreshList(): it must not addEventListener (the delegated body listener
    // from render() keeps working across the innerHTML swap, so a cadence tick that
    // only refreshes the list never churns per-row handlers).
    const start = painter.indexOf('private refreshList(): void {');
    expect(start).toBeGreaterThan(-1);
    const next = painter.indexOf('private onBodyClick(', start);
    expect(next).toBeGreaterThan(start);
    const body = painter.slice(start, next);
    expect(body).toContain('body.innerHTML');
    expect(body).not.toContain('addEventListener');
  });
});

describe('social_window: Book of Deeds title spans (both roster surfaces)', () => {
  // The pure row model carries the deed ID (social_view.test.ts); these pins
  // hold the RENDER arm: each surface localizes through deedTitleText, hides
  // entirely on '' (untitled/stale, never an empty decorated span), and emits
  // the muted .soc-title INSIDE the ellipsized name cell. Deleting either
  // span emission, either hide guard, or the localization call reds here.
  it('friends rows localize the id, gate on it, and emit .soc-title inside the name', () => {
    expect(painter).toContain(
      "const titleText = f.activeTitle ? deedTitleText(f.activeTitle) : '';",
    );
    expect(painter).toContain(
      'const titleSpan = titleText ? `<span class="soc-title">${esc(titleText)}</span>` : \'\';',
    );
    expect(painter).toContain('${esc(f.name)}${titleSpan}');
  });

  it('guild rows localize the id, gate on it, and place the title AFTER the rank chip', () => {
    expect(painter).toContain(
      "const memberTitle = m.activeTitle ? deedTitleText(m.activeTitle) : '';",
    );
    expect(painter).toContain('<span class="soc-title">${esc(memberTitle)}</span>');
    // name, then rank chip, then title: a long title trims off the tail and
    // can never push the chip out of the ellipsized cell.
    expect(painter).toContain(
      '${esc(m.name)}<span class="rank">${esc(rankLabel(m.rank))}</span>${memberTitleSpan}',
    );
  });
});
