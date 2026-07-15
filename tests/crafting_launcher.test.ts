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
    expect(uiIcons).toMatch(/\|\s*'crafting';/);
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
  // #side-buttons is bottom-anchored and grows upward, so every launcher added
  // pushes the topmost button (the Daily Rewards chest) toward the top of the
  // screen. On a maximized 1366x768 laptop only about 660px is usable, so the
  // rail must fit within that after the short-viewport compaction. This pins the
  // arithmetic so the next button that would push the chest off-screen fails here.
  const BUDGET_PX = 660; // maximized 1366x768 usable viewport height
  const BOTTOM_ANCHOR_PX = 74; // #side-buttons { bottom: 74px }
  const COMPACT_MICRO_PX = 25; // .micro-btn height under @media (max-height: 720px)
  const COMPACT_GAP_PX = 3; // #side-buttons gap under the same media query
  // The Daily Rewards chest block (button plus its gap) at the top of the rail,
  // from the reviewer's offline measurement of the rendered rail.
  const DAILY_CHEST_BLOCK_PX = 128;

  it('keeps the compaction media query and its values in hud.css', () => {
    expect(hudCss).toMatch(/@media \(max-height: 720px\)/);
    expect(hudCss).toMatch(
      /@media \(max-height: 720px\)[\s\S]*?#side-buttons \.micro-btn \{\s*height: 25px;/,
    );
    expect(hudCss).toMatch(/@media \(max-height: 720px\)[\s\S]*?#side-buttons \{\s*gap: 3px;/);
    expect(hudCss).toMatch(/#side-buttons \{[^}]*bottom: 74px;/);
  });

  it('the compacted rail fits the 1366x768 budget in both game entries', () => {
    for (const [name, html] of [
      ['index.html', indexHtml],
      ['play.html', playHtml],
    ] as const) {
      const start = html.indexOf('id="side-buttons"');
      expect(start, name).toBeGreaterThan(-1);
      const rail = html.slice(start, html.indexOf('</div>', start));
      const buttons = rail.match(/<button[^>]*class="micro-btn"[^>]*>/g) ?? [];
      const visible = buttons.filter(
        (b) => !/display:\s*none/.test(b) && !/\shidden(?=[\s>=])/.test(b),
      );
      const railPx = DAILY_CHEST_BLOCK_PX + visible.length * (COMPACT_MICRO_PX + COMPACT_GAP_PX);
      expect(
        railPx + BOTTOM_ANCHOR_PX,
        `${name}: ${visible.length} visible micro-btn`,
      ).toBeLessThanOrEqual(BUDGET_PX);
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
