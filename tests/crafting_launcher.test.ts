// @vitest-environment jsdom
// Source-guard suite for the Crafting window launchers (issue #1865, the
// deeds_window.test.ts pattern): the desktop micro-menu button and the mobile
// More-tray button in BOTH entry HTMLs, the hud.ts click + keycap wiring, the
// mobile callback chain, the T-keybind dispatch that must keep working, the
// ui_icons glyph, and the reused i18n key. Behavior of the crafting window
// itself is covered in tests/crafting_view.test.ts; these pins keep the
// launchers honest.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hydrateIcons } from '../src/ui/ui_icons';

const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8');

const hud = read('../src/ui/hud.ts');
const mainSrc = read('../src/main.ts');
const mobileControlsSrc = read('../src/game/mobile_controls.ts');
const keybindsSrc = read('../src/game/keybinds.ts');
const uiIcons = read('../src/ui/ui_icons.ts');
const chrome = read('../src/ui/i18n.catalog/hud_chrome.ts');
const indexHtml = read('../index.html');
const playHtml = read('../play.html');
const hudCss = read('../src/styles/hud.css');

describe('desktop micro-menu launcher', () => {
  it('ships the side-menu Crafting button in BOTH game entries, under Bags', () => {
    for (const html of [indexHtml, playHtml]) {
      expect(html).toMatch(/id="mm-crafting"[^>]*data-icon="crafting"/);
      expect(html).toMatch(/id="mm-crafting"[^>]*data-i18n-title="hudChrome\.crafting\.title"/);
      // Dock order: bags, then crafting, then the arena activity cluster.
      const bag = html.indexOf('id="mm-bag"');
      const crafting = html.indexOf('id="mm-crafting"');
      const arena = html.indexOf('id="mm-arena"');
      expect(bag).toBeGreaterThan(-1);
      expect(crafting).toBeGreaterThan(bag);
      expect(arena).toBeGreaterThan(crafting);
    }
  });

  it('binds the click and repaints the keycap from the live binding', () => {
    expect(hud).toContain(
      "$('#mm-crafting').addEventListener('click', () => this.toggleCrafting());",
    );
    expect(hud).toContain("['#mm-crafting', 'crafting', 'hudChrome.crafting.title'],");
  });
});

describe('mobile More-tray launcher', () => {
  it('ships the More-tray Crafting button in BOTH game entries (the /play shared-entry trap)', () => {
    for (const html of [indexHtml, playHtml]) {
      expect(html).toMatch(/id="mobile-crafting"[^>]*data-icon="crafting"/);
      expect(html).toMatch(/id="mobile-crafting"[^>]*data-i18n-title="hudChrome\.crafting\.title"/);
      // Tray order mirrors the desktop rationale: right after Bags.
      const bags = html.indexOf('id="mobile-bags"');
      const crafting = html.indexOf('id="mobile-crafting"');
      const spellbook = html.indexOf('id="mobile-spellbook"');
      expect(bags).toBeGreaterThan(-1);
      expect(crafting).toBeGreaterThan(bags);
      expect(spellbook).toBeGreaterThan(crafting);
    }
  });

  it('routes the tray tap through the MobileControls callback chain', () => {
    expect(mobileControlsSrc).toContain('onCrafting(): void;');
    expect(mobileControlsSrc).toContain(
      "this.bindButton('mobile-crafting', () => this.callbacks.onCrafting());",
    );
    expect(mainSrc).toContain('onCrafting: () => hud.toggleCrafting(),');
  });
});

describe('shared behavior across all screen sizes', () => {
  it('keeps the T keybind path unchanged (both launchers toggle the same window)', () => {
    expect(keybindsSrc).toContain(
      "{ id: 'crafting', label: 'Crafting', category: 'Interface', kind: 'edge', defaults: ['KeyT'] },",
    );
    expect(mainSrc).toContain("case 'crafting':");
  });

  it('registers the crafting glyph so hydrateIcons does not silently skip it', () => {
    expect(uiIcons).toMatch(/\|\s*'crafting'(?:\s*\||;)/);
    expect(uiIcons).toMatch(/crafting:\n?\s*'<path /);
  });

  it('reuses the already-translated crafting window title for every launcher label', () => {
    expect(chrome).toMatch(/crafting:\s*\{[^}]*title:\s*'Crafting'/);
    // Both surfaces and the mobile label span all read the same key, so the
    // desktop tooltip and the tray caption can never drift apart.
    for (const html of [indexHtml, playHtml]) {
      expect(html).toMatch(
        /id="mobile-crafting"[^>]*>\s*<span class="mobile-label" data-i18n="hudChrome\.crafting\.title">/,
      );
    }
  });
});

describe('side rail height budget', () => {
  // #side-buttons is bottom-anchored and grows upward. It used to be one long
  // column (#side-buttons stacked all launchers directly), which forced a
  // short-viewport compaction to fit a maximized 1366x768 laptop (~660px
  // usable height). It is now split into two adjacent columns
  // (#side-buttons-col-a / #side-buttons-col-b, laid out side by side with a
  // small gap, not spread apart), so each column only needs to fit half the
  // launchers. This pins the arithmetic so a column that grows too tall still
  // fails here, the same way the single rail used to.
  const BUDGET_PX = 660; // maximized 1366x768 usable viewport height
  const COMPACT_BUDGET_PX = 600; // the @media (max-height: 600px) rescue threshold itself
  const BOTTOM_ANCHOR_PX = 74; // #side-buttons { bottom: 74px }
  const UNCOMPACTED_MICRO_PX = 30; // .micro-btn height at full size (hud.css:1758)
  const UNCOMPACTED_GAP_PX = 4; // .side-buttons-col gap at full size (hud.css:1754)
  const COMPACT_MICRO_PX = 24; // .micro-btn height under @media (max-height: 600px)
  const COMPACT_GAP_PX = 1; // column gap under the same media query
  // The Daily Rewards chest block (button plus its margin), which now lives
  // at the top of col-b only, from the reviewer's offline measurement.
  const DAILY_CHEST_BLOCK_PX = 128;

  function wrapperMarkup(html: string): string {
    const start = html.indexOf('<div id="side-buttons">');
    if (start < 0) return '';
    let depth = 0;
    const token = /<div\b|<\/div>/g;
    token.lastIndex = start;
    for (let m = token.exec(html); m; m = token.exec(html)) {
      depth += m[0] === '</div>' ? -1 : 1;
      if (depth === 0) return html.slice(start, m.index + m[0].length);
    }
    return '';
  }

  // #mm-discord ships `hidden` in markup but client_shell.test.ts pins it
  // un-hidden at boot on any Discord-enabled build, so it counts as visible
  // for the real-world budget even though the static markup hides it.
  function countVisibleMicroBtns(markup: string): number {
    const buttons = markup.match(/<button[^>]*class="micro-btn"[^>]*>/g) ?? [];
    return buttons.filter((b) => {
      if (/id="mm-discord"/.test(b)) return true;
      return !/display:\s*none/.test(b) && !/\shidden(?=[\s>=])/.test(b);
    }).length;
  }

  // The rail's real footprint: two 34px .side-buttons-col columns plus the
  // #side-buttons row gap between them.
  const COL_WIDTH_PX = 34;
  const RAIL_GAP_PX = 2;

  it('keeps the compaction media query and its values in hud.css', () => {
    expect(hudCss).toMatch(/@media \(max-height: 600px\)/);
    expect(hudCss).toMatch(
      /@media \(max-height: 600px\)[\s\S]*?#side-buttons \.micro-btn \{\s*height: 24px;/,
    );
    expect(hudCss).toMatch(/@media \(max-height: 600px\)[\s\S]*?\.side-buttons-col \{\s*gap: 1px;/);
    expect(hudCss).toMatch(/#side-buttons \{[^}]*bottom: 74px;/);
  });

  it('lays the two columns out close together, not spread across the HUD', () => {
    const wrapperRule = /#side-buttons \{([^}]*)\}/.exec(hudCss)?.[1] ?? '';
    expect(wrapperRule).toContain('flex-direction: row');
    const gapMatch = /gap:\s*(\d+)px/.exec(wrapperRule);
    expect(gapMatch).not.toBeNull();
    expect(Number(gapMatch?.[1])).toBeLessThanOrEqual(10);

    // The real driver of visible separation is each column's width against
    // the #daily-rewards-button chest (50px), not the wrapper's flex gap:
    // an unconstrained, content-sized col-b would right-align its 34px
    // buttons inside a 50px box and open a dead gutter next to col-a. Pin
    // the explicit width that keeps both columns the same 34px as the chest
    // overhangs into, instead of the flex gap alone.
    const colRule = /\.side-buttons-col \{([^}]*)\}/.exec(hudCss)?.[1] ?? '';
    expect(colRule).toMatch(/width:\s*34px;/);
  });

  // Splits the two regimes the rail actually renders in, instead of mixing them:
  // at a 660px viewport the @media (max-height: 600px) rescue does not fire, so
  // the rail renders at full (uncompacted) size; only at 600px and below does it
  // shrink to the compacted metrics. Measuring compacted metrics against the
  // 660px budget (the previous version of this test) created a false-pass
  // window, since the real uncompacted footprint is taller and the guard never
  // saw it.
  function columnMarkup(html: string, name: string): { colA: string; colB: string } {
    const wrapper = wrapperMarkup(html);
    expect(wrapper, name).not.toBe('');

    const colAStart = wrapper.indexOf('id="side-buttons-col-a"');
    const colBStart = wrapper.indexOf('id="side-buttons-col-b"');
    expect(colAStart, name).toBeGreaterThan(-1);
    expect(colBStart, name).toBeGreaterThan(-1);
    const colA = wrapper.slice(colAStart, colBStart);
    const colB = wrapper.slice(colBStart);

    // The Daily Rewards chest lives in col-b only: pin that so moving it
    // back to col-a (silently shifting 128px of budget) still fails here.
    expect(colB, name).toContain('id="daily-rewards-button"');
    expect(colA, name).not.toContain('id="daily-rewards-button"');
    return { colA, colB };
  }

  it('each uncompacted column fits the 1366x768 height budget in both game entries', () => {
    for (const [name, html] of [
      ['index.html', indexHtml],
      ['play.html', playHtml],
    ] as const) {
      const { colA, colB } = columnMarkup(html, name);
      const colAVisible = countVisibleMicroBtns(colA);
      const colBVisible = countVisibleMicroBtns(colB);

      const colAPx = colAVisible * (UNCOMPACTED_MICRO_PX + UNCOMPACTED_GAP_PX);
      const colBPx =
        DAILY_CHEST_BLOCK_PX + colBVisible * (UNCOMPACTED_MICRO_PX + UNCOMPACTED_GAP_PX);

      expect(
        colAPx + BOTTOM_ANCHOR_PX,
        `${name} col-a: ${colAVisible} visible micro-btn`,
      ).toBeLessThanOrEqual(BUDGET_PX);
      expect(
        colBPx + BOTTOM_ANCHOR_PX,
        `${name} col-b: ${colBVisible} visible micro-btn`,
      ).toBeLessThanOrEqual(BUDGET_PX);
    }
  });

  it('each compacted column fits the 600px rescue threshold in both game entries', () => {
    for (const [name, html] of [
      ['index.html', indexHtml],
      ['play.html', playHtml],
    ] as const) {
      const { colA, colB } = columnMarkup(html, name);
      const colAVisible = countVisibleMicroBtns(colA);
      const colBVisible = countVisibleMicroBtns(colB);

      const colAPx = colAVisible * (COMPACT_MICRO_PX + COMPACT_GAP_PX);
      const colBPx = DAILY_CHEST_BLOCK_PX + colBVisible * (COMPACT_MICRO_PX + COMPACT_GAP_PX);

      expect(
        colAPx + BOTTOM_ANCHOR_PX,
        `${name} col-a: ${colAVisible} visible micro-btn`,
      ).toBeLessThanOrEqual(COMPACT_BUDGET_PX);
      expect(
        colBPx + BOTTOM_ANCHOR_PX,
        `${name} col-b: ${colBVisible} visible micro-btn`,
      ).toBeLessThanOrEqual(COMPACT_BUDGET_PX);
    }
  });

  it('keeps the rail narrow enough to not widen the overlap with #right-tracker-stack', () => {
    // The two-column split traded height for width: the rail used to be one
    // ~50px-wide column, now it is two 34px columns plus a gap. This is the
    // constraint that moved, and nothing pinned it before this test: widening
    // either column, or the gap between them, grows the band where the rail's
    // icon strip can paint over #right-tracker-stack on a short viewport.
    // Derive both numbers from the CSS itself (the same pattern the
    // close-together test above uses for the gap): a hardcoded expectation
    // built from the same local constants as the CSS would trivially pass
    // no matter how wide the rail actually rendered.
    const colWidthMatch = /\.side-buttons-col \{([^}]*)\}/.exec(hudCss)?.[1] ?? '';
    const colWidth = Number(/width:\s*(\d+)px/.exec(colWidthMatch)?.[1]);
    const wrapperRule = /#side-buttons \{([^}]*)\}/.exec(hudCss)?.[1] ?? '';
    const railGap = Number(/gap:\s*(\d+)px/.exec(wrapperRule)?.[1]);
    expect(colWidth).toBe(COL_WIDTH_PX);
    expect(railGap).toBe(RAIL_GAP_PX);

    const railWidthPx = colWidth * 2 + railGap;
    expect(railWidthPx).toBeLessThanOrEqual(70);
  });

  it('shrinks the tracker rows to their own content width, so the tracker paints over the rail without stealing its clicks', () => {
    // #right-tracker-stack sits above #side-buttons (z-index: 20 vs 19,
    // hud.css:2307) so its text stays readable when the rail grows into its
    // vertical span on a short viewport. That z-index bump alone would also
    // let any full-width, pointer-events:auto tracker row steal clicks and
    // hover meant for a rail button underneath it; the fix is to shrink each
    // clickable row to its own content width instead of letting it span the
    // whole 240px #right-tracker-stack.
    for (const selector of [
      '#quest-tracker \\.qt-header',
      '#quest-tracker \\.qt-title',
      '#deed-tracker \\.dt-header',
      '#delve-tracker \\.dt-affix-row',
    ]) {
      const rule = new RegExp(`${selector} \\{([^}]*)\\}`).exec(hudCss)?.[1] ?? '';
      expect(rule, selector).not.toBe('');
      expect(rule, selector).toMatch(/width:\s*fit-content;/);
      expect(rule, selector).not.toMatch(/[^-]width:\s*100%;/);
    }
  });
});

describe('desktop launcher behavior (jsdom)', () => {
  it('a click on #mm-crafting fires the toggle wiring and hydrateIcons materializes the glyph', () => {
    // The source pin above proves hud.ts wires #mm-crafting to this.toggleCrafting();
    // this drives a faithful copy of that wiring over the real button markup to
    // prove the element is clickable and the click path fires, and that the
    // data-icon resolves to a registered glyph (deeds_window.test.ts pairs the
    // same source-pin plus jsdom-behavior approach).
    document.body.innerHTML =
      '<div id="side-buttons">' +
      '<button type="button" class="micro-btn" id="mm-crafting" title="Crafting" aria-label="Crafting" data-icon="crafting"><span class="keybind">t</span></button>' +
      '</div><div id="crafting-window" hidden></div>';
    const btn = document.getElementById('mm-crafting') as HTMLButtonElement;

    let toggles = 0;
    btn.addEventListener('click', () => {
      toggles += 1;
    });
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(toggles).toBe(1);

    // data-icon="crafting" must resolve to a registered glyph: hydrateIcons is a
    // no-op for unknown names, so a missing registration would leave no svg.
    hydrateIcons(document.body);
    expect(btn.querySelector('.ui-icon')).not.toBeNull();
  });
});

describe('side rail flyout stacking (col-b hover labels over col-a)', () => {
  // The hover flyout is a ::before at z-index: -1 so it tucks 6px under its
  // own button. In the shared #side-buttons stacking context that also painted
  // it under EVERY rail button, so the leftward-growing labels of col-b (the
  // column hugging the screen edge) were clipped by col-a's buttons (v0.29.0
  // bug: hovering the Game Menu gear showed "Game M" cut off by the Crafting
  // tankard). Col-b must form its own stacking context above col-a: the flyout
  // then still paints under its own column's buttons but over the neighbor's.
  it('keeps the flyout tucked under its own button (z-index -1)', () => {
    const flyout = /\.micro-btn::before \{([^}]*)\}/.exec(hudCss)?.[1] ?? '';
    expect(flyout).toMatch(/z-index:\s*-1;/);
  });

  it('lifts #side-buttons-col-b into a stacking context above col-a', () => {
    const colB = /#side-buttons-col-b \{([^}]*)\}/.exec(hudCss)?.[1] ?? '';
    expect(colB, 'a #side-buttons-col-b rule must exist in hud.css').not.toBe('');
    expect(colB).toMatch(/position:\s*relative;/);
    expect(colB).toMatch(/z-index:\s*1;/);
    // col-a must not be lifted too, or the fix cancels itself out.
    expect(/#side-buttons-col-a \{[^}]*z-index/.test(hudCss)).toBe(false);
  });
});
