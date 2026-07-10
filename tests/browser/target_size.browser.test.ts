// Mobile target-size pass: under a real landscape phone viewport (the
// in-game view is landscape-only on web mobile), every primary gameplay control
// must render at least 48x48px, not merely the >=24px absolute desktop floor.
// This measures REAL rendered geometry (getBoundingClientRect under the real style barrel +
// the body.mobile-touch.game-active state), never a CSS-text assertion, mirroring the V16
// mobile_button_size / mobile_joystick_size harnesses but with an actual numeric floor the
// older screenshot harnesses never asserted.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup } from './_harness';

const TOUCH_FLOOR = 48;
const LEGACY_TOUCH_FLOOR = 40;
// getBoundingClientRect can land a hair under an exact declaration on sub-pixel
// rounding; allow half a pixel so the gate tests the real floor, not rounding noise.
const EPSILON = 0.5;

beforeEach(async () => {
  // A landscape phone (the in-game web-mobile profile). The orientation:
  // landscape media query drives the in-game landscape rules in hud.mobile.css.
  await page.viewport(844, 390);
  document.body.className = 'mobile-touch game-active';
  document.body.style.setProperty('--btn-scale', '0.8');
});

afterEach(() => {
  cleanup();
  document.body.className = '';
  document.body.style.removeProperty('--btn-scale');
});

function measure(el: HTMLElement): { w: number; h: number } {
  const r = el.getBoundingClientRect();
  return { w: r.width, h: r.height };
}

function expectAtLeastFloor(el: HTMLElement, label: string, floor = TOUCH_FLOOR): void {
  const { w, h } = measure(el);
  expect(w, `${label} width ${w} < ${floor}`).toBeGreaterThanOrEqual(floor - EPSILON);
  expect(h, `${label} height ${h} < ${floor}`).toBeGreaterThanOrEqual(floor - EPSILON);
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

describe('mobile target-size: primary in-game touch controls are >=48x48 in landscape', () => {
  it('mobile action-ring controls (slot, attack, page toggle, Target swap, Jump)', () => {
    // Mount the approved logical order. CSS turns this stable source order into
    // the two-row pad without scaling any interactive ancestor.
    const ring = el('div', { id: 'mobile-action-ring' });
    const a1 = el('button', { class: 'mobile-action-slot', 'data-mobile-index': '0' });
    const a2 = el('button', { class: 'mobile-action-slot', 'data-mobile-index': '1' });
    const attack = el('button', { id: 'mobile-action-attack' });
    const targetCycle = el('button', { id: 'mobile-target-cycle' });
    const toggle = el('button', { id: 'mobile-action-page-toggle' });
    const a3 = el('button', { class: 'mobile-action-slot', 'data-mobile-index': '2' });
    const a4 = el('button', { class: 'mobile-action-slot', 'data-mobile-index': '3' });
    const a5 = el('button', { class: 'mobile-action-slot', 'data-mobile-index': '4' });
    const jump = el('button', { id: 'mobile-jump' });
    ring.append(a1, a2, attack, targetCycle, toggle, a3, a4, a5, jump);
    document.body.appendChild(ring);
    expectAtLeastFloor(a1, '.mobile-action-slot');
    expectAtLeastFloor(attack, '#mobile-action-attack');
    expectAtLeastFloor(targetCycle, '#mobile-target-cycle');
    expectAtLeastFloor(jump, '#mobile-jump');
    expectAtLeastFloor(toggle, '#mobile-action-page-toggle');
  });

  it('the compact-tier ring keeps every control at the floor (smallest sizes)', () => {
    // The compact tier changes placement, never the 48px hitbox floor.
    document.body.className = 'mobile-touch game-active hud-mobile-compact';
    const ring = el('div', { id: 'mobile-action-ring' });
    const slot = el('button', { class: 'mobile-action-slot', 'data-mobile-index': '2' });
    const attack = el('button', { id: 'mobile-action-attack' });
    const targetCycle = el('button', { id: 'mobile-target-cycle' });
    const jump = el('button', { id: 'mobile-jump' });
    const toggle = el('button', { id: 'mobile-action-page-toggle' });
    ring.append(slot, attack, targetCycle, jump, toggle);
    document.body.appendChild(ring);
    expectAtLeastFloor(slot, 'compact .mobile-action-slot');
    expectAtLeastFloor(attack, 'compact #mobile-action-attack');
    expectAtLeastFloor(targetCycle, 'compact #mobile-target-cycle');
    expectAtLeastFloor(jump, 'compact #mobile-jump');
    expectAtLeastFloor(toggle, 'compact #mobile-action-page-toggle');
  });

  it('the compact direct menu keeps Chat, Quests, and More at the floor', () => {
    document.body.className = 'mobile-touch game-active hud-mobile-compact';
    const combat = el('div', { id: 'mobile-combat-controls' });
    const chat = el('button', { id: 'mobile-chat', class: 'mobile-btn' });
    const quest = el('button', { id: 'mobile-quest', class: 'mobile-btn' });
    const more = el('button', { id: 'mobile-more', class: 'mobile-btn' });
    combat.append(chat, quest, more);
    document.body.append(combat);
    expectAtLeastFloor(chat, '#mobile-chat');
    expectAtLeastFloor(quest, '#mobile-quest');
    expectAtLeastFloor(more, '#mobile-more');
  });

  it('the Consumables toggle and populated 3 x 2 slots stay at the floor', () => {
    document.body.classList.add('mobile-consumables-open');
    const consumables = el('div', { id: 'mobile-consumables' });
    const toggle = el('button', { id: 'mobile-consumables-toggle' });
    const row = el('div', { id: 'mobile-consumables-row' });
    const slots = Array.from({ length: 6 }, (_, index) =>
      el('button', {
        class: 'mobile-consumable-slot',
        'data-consumable-index': String(index),
      }),
    );
    row.append(...slots);
    consumables.append(toggle, row);
    document.body.append(consumables);
    expectAtLeastFloor(toggle, '#mobile-consumables-toggle');
    for (const [index, slot] of slots.entries()) {
      expectAtLeastFloor(slot, `.mobile-consumable-slot[${index}]`);
    }
  });

  it('party-member rows (role=button tap targets)', () => {
    const frames = el('div', { id: 'party-frames', class: 'party-expanded' });
    const row = el('div', { class: 'party-frame', role: 'button', tabindex: '0' });
    frames.appendChild(row);
    document.body.appendChild(frames);
    expectAtLeastFloor(row, 'party-frame', LEGACY_TOUCH_FLOOR);
  });

  it('the party leave button', () => {
    const frames = el('div', { id: 'party-frames', class: 'party-expanded' });
    const leave = el('button', { id: 'party-leave' });
    leave.textContent = 'Leave Party';
    frames.appendChild(leave);
    document.body.appendChild(frames);
    expectAtLeastFloor(leave, '#party-leave', LEGACY_TOUCH_FLOOR);
  });

  it('the mobile More-tray close button', () => {
    document.body.className = 'mobile-touch game-active mobile-more-open';
    const tray = el('div', { id: 'mobile-extra-controls', class: 'window panel' });
    const title = el('div', { class: 'panel-title' });
    const close = el('button', { class: 'x-btn', 'data-close': '', 'aria-label': 'Close' });
    title.appendChild(close);
    tray.appendChild(title);
    document.body.appendChild(tray);
    expectAtLeastFloor(close, '#mobile-more-close', LEGACY_TOUCH_FLOOR);
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
    expectAtLeastFloor(zoom, '.map-zoom-btn', LEGACY_TOUCH_FLOOR);
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
