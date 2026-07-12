// Mobile target-size pass: under a real landscape phone viewport (the
// in-game view is landscape-only on web mobile), every TOUCH control must render >=40x40px,
// the PREFERRED mobile floor, not merely the >=24px absolute desktop floor.
// This measures REAL rendered geometry (getBoundingClientRect under the real style barrel +
// the body.mobile-touch.game-active state), never a CSS-text assertion, mirroring the V16
// mobile_button_size / mobile_joystick_size harnesses but with an actual numeric floor the
// older screenshot harnesses never asserted.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup } from './_harness';

const TOUCH_FLOOR = 40;
// getBoundingClientRect can land a hair under an exact 40px declaration on sub-pixel
// rounding; allow half a pixel so the gate tests the real floor, not rounding noise.
const EPSILON = 0.5;

beforeEach(async () => {
  // A landscape phone (the in-game web-mobile profile). The orientation:
  // landscape media query drives the in-game landscape rules in hud.mobile.css.
  await page.viewport(844, 390);
  document.body.className = 'mobile-touch game-active';
});

afterEach(() => {
  cleanup();
  document.body.className = '';
});

function measure(el: HTMLElement): { w: number; h: number } {
  const r = el.getBoundingClientRect();
  return { w: r.width, h: r.height };
}

function expectAtLeastFloor(el: HTMLElement, label: string): void {
  const { w, h } = measure(el);
  expect(w, `${label} width ${w} < ${TOUCH_FLOOR}`).toBeGreaterThanOrEqual(TOUCH_FLOOR - EPSILON);
  expect(h, `${label} height ${h} < ${TOUCH_FLOOR}`).toBeGreaterThanOrEqual(TOUCH_FLOOR - EPSILON);
}

function el(tag: string, attrs: Record<string, string> = {}): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'id') node.id = v;
    else node.setAttribute(k, v);
  }
  return node;
}

describe('mobile target-size: in-game touch controls are >=40x40 in landscape', () => {
  it('mobile action-ring controls (slot, attack, page toggle, Target swap, Use)', () => {
    // The paged action ring replaced the desktop #actionbar on touch (which is
    // display:none under body.mobile-touch); its sizes resolve from the
    // --mobile-ring-* variables on the ring container, so the buttons must be
    // measured inside it, mirroring the real index.html/play.html markup (the
    // Target swap and Use helpers live in the ring's crescent hollow, not the
    // left utility cluster).
    const ring = el('div', { id: 'mobile-action-ring' });
    const slot = el('button', { class: 'mobile-action-slot', 'data-mobile-index': '1' });
    const attack = el('button', { id: 'mobile-action-attack' });
    const targetCycle = el('button', { id: 'mobile-target-cycle' });
    const interact = el('button', { id: 'mobile-interact' });
    const toggle = el('button', { id: 'mobile-action-page-toggle' });
    ring.append(slot, attack, targetCycle, interact, toggle);
    document.body.appendChild(ring);
    expectAtLeastFloor(slot, '.mobile-action-slot');
    expectAtLeastFloor(attack, '#mobile-action-attack');
    expectAtLeastFloor(targetCycle, '#mobile-target-cycle');
    expectAtLeastFloor(interact, '#mobile-interact');
    expectAtLeastFloor(toggle, '#mobile-action-page-toggle');
  });

  it('the compact-tier ring keeps every control at the floor (smallest sizes)', () => {
    // hud-mobile-compact re-tunes every --mobile-ring-* var downward for short
    // landscape phones, then the 0.85 mobile-chrome-scale shrinks them further; the
    // smallest (toggle 46 * 0.85 = 39.1) is clamped back up to the 40px floor via
    // max(40px, ...), and Target/Use (50 * 0.85 = 42.5) still clear it.
    document.body.className = 'mobile-touch game-active hud-mobile-compact';
    const ring = el('div', { id: 'mobile-action-ring' });
    const slot = el('button', { class: 'mobile-action-slot', 'data-mobile-index': '2' });
    const attack = el('button', { id: 'mobile-action-attack' });
    const targetCycle = el('button', { id: 'mobile-target-cycle' });
    const interact = el('button', { id: 'mobile-interact' });
    const toggle = el('button', { id: 'mobile-action-page-toggle' });
    ring.append(slot, attack, targetCycle, interact, toggle);
    document.body.appendChild(ring);
    expectAtLeastFloor(slot, 'compact .mobile-action-slot');
    expectAtLeastFloor(attack, 'compact #mobile-action-attack');
    expectAtLeastFloor(targetCycle, 'compact #mobile-target-cycle');
    expectAtLeastFloor(interact, 'compact #mobile-interact');
    expectAtLeastFloor(toggle, 'compact #mobile-action-page-toggle');
  });

  it('the ring Jump seat, the expanded menu grid, and the collapse handle', () => {
    // The old left utility cluster (#mobile-utility-cluster with its Autorun
    // button) was retired upstream by the joystick autorun lock (#1724): autorun
    // is now a lock affordance on the move pad, not a tappable satellite. Jump
    // stays a real button, seated on the action ring's bottom row.
    const ring = el('div', { id: 'mobile-action-ring' });
    const jump = el('button', { id: 'mobile-jump', class: 'mobile-btn' });
    ring.append(jump);
    const combat = el('div', { id: 'mobile-combat-controls' });
    // The collapse handle is the always-visible 40px chip; it must hold the floor
    // even collapsed (its default). The five menu buttons live INSIDE the
    // #mobile-combat-buttons grid, where their width comes from the constrained
    // 5-column track under the band's 0.85 chrome-scale (NOT the base .mobile-btn
    // 58x54), so they must be measured there, expanded, or the real shrink is
    // missed. body.mobile-menu-open reveals the grid (visibility:visible).
    const handle = el('button', { id: 'mobile-menu-collapse-toggle' });
    const buttons = el('div', { id: 'mobile-combat-buttons' });
    const chat = el('button', { id: 'mobile-chat', class: 'mobile-btn' });
    const social = el('button', { id: 'mobile-social', class: 'mobile-btn' });
    const quest = el('button', { id: 'mobile-quest', class: 'mobile-btn' });
    const menu = el('button', { id: 'mobile-menu', class: 'mobile-btn' });
    const more = el('button', { id: 'mobile-more', class: 'mobile-btn' });
    buttons.append(chat, social, quest, menu, more);
    combat.append(handle, buttons);
    document.body.append(ring, combat);
    document.body.classList.add('mobile-menu-open');
    expectAtLeastFloor(jump, '#mobile-action-ring #mobile-jump');
    expectAtLeastFloor(chat, '#mobile-combat-buttons #mobile-chat');
    expectAtLeastFloor(menu, '#mobile-combat-buttons #mobile-menu');
    expectAtLeastFloor(more, '#mobile-combat-buttons #mobile-more');
    expectAtLeastFloor(handle, '#mobile-menu-collapse-toggle');
  });

  it('the two top-left disclosure chips render the SAME size at every Button Size setting', () => {
    // Live user feedback: the menu collapse handle and the consumables chevron rendered
    // as two different-sized arrows because one inherited the band's --btn-scale
    // transform and the other its own container's. Both now sit on UNSCALED containers
    // (the scale transforms moved inward to #mobile-combat-buttons and
    // #mobile-consumables-row), so their rendered rects must be IDENTICAL and hold the
    // 40px floor across the whole Button Size slider range (settings.ts
    // actionButtonScale: min 0.25, max 2). Mirrors the real markup: main.ts writes
    // --btn-scale onto #mobile-controls, the chips live in their real containers.
    const controls = el('section', { id: 'mobile-controls' });
    controls.style.display = 'block';
    const combat = el('div', { id: 'mobile-combat-controls' });
    const handle = el('button', { id: 'mobile-menu-collapse-toggle' });
    const buttons = el('div', { id: 'mobile-combat-buttons' });
    combat.append(handle, buttons);
    const consumables = el('div', { id: 'mobile-consumables' });
    const chevron = el('button', { id: 'mobile-consumables-toggle' });
    const row = el('div', { id: 'mobile-consumables-row' });
    consumables.append(chevron, row);
    controls.append(combat, consumables);
    document.body.appendChild(controls);
    for (const scale of ['0.25', '1', '2']) {
      controls.style.setProperty('--btn-scale', scale);
      const h = measure(handle);
      const c = measure(chevron);
      expect(
        Math.abs(h.w - c.w),
        `chip widths diverge at --btn-scale ${scale}: handle ${h.w} vs chevron ${c.w}`,
      ).toBeLessThanOrEqual(EPSILON);
      expect(
        Math.abs(h.h - c.h),
        `chip heights diverge at --btn-scale ${scale}: handle ${h.h} vs chevron ${c.h}`,
      ).toBeLessThanOrEqual(EPSILON);
      expectAtLeastFloor(handle, `#mobile-menu-collapse-toggle at --btn-scale ${scale}`);
      expectAtLeastFloor(chevron, `#mobile-consumables-toggle at --btn-scale ${scale}`);
    }
  });

  it('party-member rows (role=button tap targets)', () => {
    const frames = el('div', { id: 'party-frames' });
    const row = el('div', { class: 'party-frame', role: 'button', tabindex: '0' });
    frames.appendChild(row);
    document.body.appendChild(frames);
    expectAtLeastFloor(row, 'party-frame');
  });

  it('the party leave button', () => {
    const frames = el('div', { id: 'party-frames' });
    const leave = el('button', { id: 'party-leave' });
    frames.appendChild(leave);
    document.body.appendChild(frames);
    expectAtLeastFloor(leave, '#party-leave');
  });

  it('the mobile More-drawer close button, menu tiles, and solid frame', () => {
    // Mirrors the real static anatomy (index.html/play.html): the drawer root
    // hosts the AAA .window-frame (titlebar + close + scrolling body) around
    // the 15-tile #mobile-extra-grid.
    document.body.className = 'mobile-touch game-active mobile-more-open';
    const tray = el('div', { id: 'mobile-extra-controls', class: 'window panel' });
    const frame = el('div', { class: 'window-frame' });
    const titlebar = el('div', { class: 'window-titlebar' });
    const title = el('span', { class: 'window-title', id: 'mobile-more-title' });
    title.textContent = 'More';
    const close = el('button', {
      class: 'window-close',
      id: 'mobile-more-close',
      'aria-label': 'Close',
    });
    titlebar.append(title, close);
    const body = el('div', { class: 'window-body' });
    const grid = el('div', { id: 'mobile-extra-grid' });
    for (let i = 0; i < 15; i++) {
      const tile = el('button', { class: 'mobile-btn' });
      const label = el('span', { class: 'mobile-label' });
      label.textContent = 'Spellbook';
      tile.appendChild(label);
      grid.appendChild(tile);
    }
    body.appendChild(grid);
    frame.append(titlebar, body);
    tray.appendChild(frame);
    document.body.appendChild(tray);
    expectAtLeastFloor(close, '#mobile-more-close');
    // The redesigned drawer uses roomy icon-over-label tiles, gated at 56px so
    // a regression back toward the cramped 34-44px pills fails here (the 40px
    // floor still gates the width).
    const TILE_FLOOR = 56;
    for (const tile of Array.from(grid.querySelectorAll<HTMLElement>('.mobile-btn'))) {
      const { w, h } = measure(tile);
      expect(h, `More tile height ${h} < ${TILE_FLOOR}`).toBeGreaterThanOrEqual(
        TILE_FLOOR - EPSILON,
      );
      expect(w, `More tile width ${w} < ${TOUCH_FLOOR}`).toBeGreaterThanOrEqual(
        TOUCH_FLOOR - EPSILON,
      );
    }
    // Never-see-through: the frame rides the fully opaque L2 base (an rgb()
    // computed color, no alpha channel), so the world cannot read through the
    // open drawer.
    expect(getComputedStyle(frame).backgroundColor).toMatch(/^rgb\(/);
  });

  it('the community HUD toggle', () => {
    const menu = el('details', { id: 'community-menu' });
    const toggle = el('summary', { class: 'community-toggle' });
    menu.appendChild(toggle);
    document.body.appendChild(menu);
    expectAtLeastFloor(toggle, '.community-toggle');
  });

  it('the movement / camera joystick', () => {
    const controls = el('div', { id: 'mobile-controls' });
    const joystick = el('div', { id: 'mobile-move-joystick', class: 'mobile-joystick' });
    controls.appendChild(joystick);
    document.body.appendChild(controls);
    expectAtLeastFloor(joystick, '.mobile-joystick');
  });

  it('the map +/- zoom buttons (raised to the floor)', () => {
    // These were raised from the 32x32 desktop size to the 40x40 mobile touch floor via
    // body.mobile-touch .map-zoom-btn { min-width/height: 40px } (no ancestor needed, so
    // mount on body directly, NOT inside #map-window which is display:none until opened).
    // On a real phone the box itself (display:flex, 32px) comes from the @media (pointer:
    // coarse) base rule in components.css, which Playwright's fine-pointer context does not
    // match, so stand in that base box here; the under-test mobile floor then decides the
    // size (drop it below 40 and this fails at the new smaller value).
    const zoom = el('button', { class: 'map-zoom-btn' });
    zoom.style.display = 'flex';
    zoom.style.width = '32px';
    zoom.style.height = '32px';
    document.body.appendChild(zoom);
    expectAtLeastFloor(zoom, '.map-zoom-btn');
  });
});

// Touch slot-grid comfort floor: live user feedback on the bank-open 50/50 dock ("the
// icons on the right seem too small for mobile screens"). On touch the bags/bank item
// grids re-track to the --touch-cell floor (56px, tokens.css) and REFLOW to fewer
// columns, and the bag-bar sockets grow to the same floor, in EVERY dock state: bags
// standalone (full-screen), bank-open (bags right at half width), market-open (bags
// right at half width). Old sizes (42px tracks -> ~43-47px cells, 40px sockets) fail
// these floors. Real rendered geometry, mirroring the painter nesting
// (#bags > .window-frame > .window-body, bags_window.ts / bank_window.ts render()).
const CELL_FLOOR = 56;

describe('mobile target-size: bag/bank slot cells stay comfortable in every dock state', () => {
  beforeEach(() => {
    // The mobile 50/50 dock split point is calc(var(--app-vw) / var(--ui-scale) / 2);
    // main.ts (app_viewport.ts) syncs --app-vw on the real client, so the test must
    // stand it in for the dock rules to resolve.
    document.documentElement.style.setProperty('--app-vw', '844px');
  });

  afterEach(() => {
    document.documentElement.style.removeProperty('--app-vw');
  });

  function expectAtLeast(node: HTMLElement, floor: number, label: string): void {
    const { w, h } = measure(node);
    expect(w, `${label} width ${w} < ${floor}`).toBeGreaterThanOrEqual(floor - EPSILON);
    expect(h, `${label} height ${h} < ${floor}`).toBeGreaterThanOrEqual(floor - EPSILON);
  }

  // The real bags DOM: #bags > .window-frame > .window-body > bag bar + filter row +
  // slot grid (bags_window.ts render()); hud.ts shows it with inline display:flex.
  function buildBags(): { cell: HTMLElement; icon: HTMLElement; socket: HTMLElement } {
    const bags = el('div', { id: 'bags', class: 'window panel' });
    bags.style.display = 'flex';
    const frame = el('div', { class: 'window-frame' });
    const body = el('div', { class: 'window-body' });
    const bar = el('div', { class: 'bag-bar' });
    const socket = el('button', { class: 'bag-socket backpack' });
    const emptySocket = el('button', { class: 'bag-socket empty' });
    const capacity = el('span', { class: 'bag-capacity' });
    capacity.textContent = '7/16';
    bar.append(socket, emptySocket, capacity);
    const filterBar = el('div', { class: 'bag-filter-bar' });
    const chips = el('div', { class: 'filter-row' });
    const chip = el('button', { class: 'chip' });
    chip.textContent = 'All';
    chips.appendChild(chip);
    filterBar.appendChild(chips);
    const grid = el('div', { class: 'bag-grid' });
    const cell = el('button', { class: 'item-cell', 'data-quality': 'common' });
    const icon = el('img', { class: 'item-icon', alt: '' });
    cell.appendChild(icon);
    grid.appendChild(cell);
    for (let i = 0; i < 7; i++)
      grid.appendChild(el('button', { class: 'item-cell', 'data-quality': 'common' }));
    for (let i = 0; i < 4; i++)
      grid.appendChild(el('div', { class: 'item-cell is-empty', 'aria-hidden': 'true' }));
    body.append(bar, filterBar, grid);
    frame.appendChild(body);
    bags.appendChild(frame);
    document.body.appendChild(bags);
    return { cell, socket, icon };
  }

  // The bank half: #bank-window > .window-frame > .window-body > .bank-scroll >
  // .bank-grid (bank_window.ts render()).
  function buildBank(): { cell: HTMLElement } {
    const bank = el('div', { id: 'bank-window', class: 'window panel' });
    bank.style.display = 'flex';
    const frame = el('div', { class: 'window-frame' });
    const body = el('div', { class: 'window-body' });
    const scroll = el('div', { class: 'bank-scroll' });
    const grid = el('div', { class: 'bank-grid' });
    const cell = el('button', { class: 'item-cell', 'data-quality': 'common' });
    grid.appendChild(cell);
    for (let i = 0; i < 7; i++)
      grid.appendChild(el('button', { class: 'item-cell', 'data-quality': 'common' }));
    scroll.appendChild(grid);
    body.appendChild(scroll);
    frame.appendChild(body);
    bank.appendChild(frame);
    document.body.appendChild(bank);
    return { cell };
  }

  it('bags item cells, bag-bar sockets, and filter chips in each dock state', () => {
    // '' = standalone full-screen bags; the dock classes halve the window width
    // (bags right), which is exactly where the cells used to render smallest.
    for (const dock of ['', 'bank-open', 'market-open']) {
      document.body.className = `mobile-touch game-active ${dock}`.trim();
      const { cell, socket, icon } = buildBags();
      const state = dock === '' ? 'standalone' : dock;
      expectAtLeast(cell, CELL_FLOOR, `${state} #bags .item-cell`);
      expectAtLeast(socket, CELL_FLOOR, `${state} .bag-socket`);
      // The icon fills its cell (inset 2px): easily clickable AND visibly larger.
      const cellRect = measure(cell);
      const iconRect = measure(icon);
      expect(
        iconRect.w,
        `${state} .item-icon width ${iconRect.w} does not fill the ${cellRect.w} cell`,
      ).toBeGreaterThanOrEqual(cellRect.w - 6);
      expect(
        iconRect.h,
        `${state} .item-icon height ${iconRect.h} does not fill the ${cellRect.h} cell`,
      ).toBeGreaterThanOrEqual(cellRect.h - 6);
      // The category chips keep the shared 40px tap floor (text chips, not icons).
      const chip = document.querySelector('#bags .filter-row .chip') as HTMLElement;
      expectAtLeastFloor(chip, `${state} #bags .chip`);
      cleanup();
    }
  });

  it('bank grid cells at the docked half width', () => {
    document.body.className = 'mobile-touch game-active bank-open';
    const { cell } = buildBank();
    expectAtLeast(cell, CELL_FLOOR, 'bank-open #bank-window .item-cell');
  });

  it('desktop keeps the dense 42px slot tracks (no touch re-track leak)', () => {
    // Without body.mobile-touch the grid must keep the desktop density: a 412px
    // container (the dock half width) still fits at least 8 columns of 42px tracks,
    // so a desktop cell stays UNDER the touch floor. This pins the scoping: if the
    // touch re-track ever leaks to desktop, the cell balloons past 56px and this
    // fails (and 24px SC 2.5.8 still bounds it from below).
    document.body.className = '';
    const bags = el('div', { id: 'bags', class: 'window panel' });
    bags.style.display = 'flex';
    bags.style.width = '412px';
    const frame = el('div', { class: 'window-frame' });
    const body = el('div', { class: 'window-body' });
    const grid = el('div', { class: 'bag-grid' });
    const cell = el('button', { class: 'item-cell', 'data-quality': 'common' });
    grid.appendChild(cell);
    for (let i = 0; i < 7; i++)
      grid.appendChild(el('button', { class: 'item-cell', 'data-quality': 'common' }));
    body.appendChild(grid);
    frame.appendChild(body);
    bags.appendChild(frame);
    document.body.appendChild(bags);
    const { w, h } = measure(cell);
    expect(w, `desktop .item-cell width ${w} ballooned to the touch floor`).toBeLessThan(
      CELL_FLOOR,
    );
    expect(w, `desktop .item-cell width ${w} under the 24px absolute floor`).toBeGreaterThanOrEqual(
      24 - EPSILON,
    );
    expect(
      h,
      `desktop .item-cell height ${h} under the 24px absolute floor`,
    ).toBeGreaterThanOrEqual(24 - EPSILON);
  });
});

// Desktop (fine-pointer, non-mobile) target-size: the dense list controls the WCAG row
// named (bag cells, social rows / tabs) but never measured. Here the mobile 40px floors do
// NOT apply (no body.mobile-touch class), so each must still clear the 24px SC 2.5.8 absolute
// floor. Real rendered geometry under the style barrel, with representative text content (an
// empty flex row collapses to its padding and would not reflect the lived size).
const DESKTOP_FLOOR = 24;

describe('desktop target-size: dense list controls clear the >=24px SC 2.5.8 floor', () => {
  beforeEach(async () => {
    // A fine-pointer desktop viewport with NO mobile-touch class (this overrides the file
    // -level mobile setup), so the mobile min-height: 40px rules do not apply here.
    await page.viewport(1280, 800);
    document.body.className = '';
  });

  function expectAtLeastDesktopFloor(node: HTMLElement, label: string): void {
    const { h } = measure(node);
    expect(h, `${label} height ${h} < ${DESKTOP_FLOOR}`).toBeGreaterThanOrEqual(
      DESKTOP_FLOOR - EPSILON,
    );
  }

  it('bag item rows (raised to the 24px floor via min-height)', () => {
    const item = el('button', { class: 'bag-item' });
    item.textContent = 'Health Potion x5';
    document.body.appendChild(item);
    expectAtLeastDesktopFloor(item, '.bag-item');
  });

  it('social list rows', () => {
    const row = el('div', { class: 'soc-row' });
    row.textContent = 'Guildmate Name';
    document.body.appendChild(row);
    expectAtLeastDesktopFloor(row, '.soc-row');
  });

  it('social tabs', () => {
    const tab = el('button', { class: 'soc-tab' });
    tab.textContent = 'Friends';
    document.body.appendChild(tab);
    expectAtLeastDesktopFloor(tab, '.soc-tab');
  });
});
