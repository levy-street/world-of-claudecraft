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

  it('the left utility cluster (Autorun/Jump) and the Chat/More pair', () => {
    const cluster = el('div', { id: 'mobile-utility-cluster' });
    const autorun = el('button', { id: 'mobile-autorun', class: 'mobile-btn' });
    const jump = el('button', { id: 'mobile-jump', class: 'mobile-btn' });
    cluster.append(autorun, jump);
    const combat = el('div', { id: 'mobile-combat-controls' });
    const chat = el('button', { id: 'mobile-chat', class: 'mobile-btn' });
    const more = el('button', { id: 'mobile-more', class: 'mobile-btn' });
    combat.append(chat, more);
    document.body.append(cluster, combat);
    expectAtLeastFloor(autorun, '#mobile-autorun');
    expectAtLeastFloor(jump, '#mobile-jump');
    expectAtLeastFloor(chat, '#mobile-chat');
    expectAtLeastFloor(more, '#mobile-more');
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

  it('the mobile More-tray close button', () => {
    document.body.className = 'mobile-touch game-active mobile-more-open';
    const tray = el('div', { id: 'mobile-extra-controls', class: 'window panel' });
    const title = el('div', { class: 'panel-title' });
    const close = el('button', { class: 'x-btn', 'data-close': '', 'aria-label': 'Close' });
    title.appendChild(close);
    tray.appendChild(title);
    document.body.appendChild(tray);
    expectAtLeastFloor(close, '#mobile-more-close');
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
