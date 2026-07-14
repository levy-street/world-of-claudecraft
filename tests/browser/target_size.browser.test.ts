// Mobile target-size pass: under a real landscape phone viewport (the
// in-game view is landscape-only on web mobile), every primary gameplay control
// must render at least 48x48px, not merely the >=24px absolute desktop floor.
// This measures REAL rendered geometry (getBoundingClientRect under the real style barrel +
// the body.mobile-touch.game-active state), never a CSS-text assertion, mirroring the V16
// mobile_button_size / mobile_joystick_size harnesses but with an actual numeric floor the
// older screenshot harnesses never asserted.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { BagItemActionMenu } from '../../src/ui/bag_item_action_menu';
import { FocusManager } from '../../src/ui/focus_manager';
import { MobileHudEditor } from '../../src/ui/mobile_hud_editor';
import { MOBILE_HUD_REGISTRY } from '../../src/ui/mobile_hud_registry';
import { cleanup } from './_harness';

const TOUCH_FLOOR = 48;
const LEGACY_TOUCH_FLOOR = 40;
// The HUD editor sizes its drag proxies to the same roomy 48px floor (a drag
// handle needs full finger room), so the editor suites assert TOUCH_FLOOR.
const EDITOR_PROXY_FLOOR = 48;
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

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function roundedBuckets(values: readonly number[]): number[] {
  return [...new Set(values.map((value) => Math.round(value)))].sort((a, b) => a - b);
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
    const a5 = el('button', { class: 'mobile-action-slot', 'data-mobile-index': '4' });
    const attack = el('button', { id: 'mobile-action-attack' });
    const targetCycle = el('button', { id: 'mobile-target-cycle' });
    const toggle = el('button', { id: 'mobile-action-page-toggle' });
    const a3 = el('button', { class: 'mobile-action-slot', 'data-mobile-index': '2' });
    const a4 = el('button', { class: 'mobile-action-slot', 'data-mobile-index': '3' });
    const jump = el('button', { id: 'mobile-jump' });
    ring.append(a1, a2, a5, targetCycle, toggle, a3, a4, attack, jump);
    document.body.appendChild(ring);
    expectAtLeastFloor(a1, '.mobile-action-slot');
    expectAtLeastFloor(attack, '#mobile-action-attack');
    expectAtLeastFloor(targetCycle, '#mobile-target-cycle');
    expectAtLeastFloor(jump, '#mobile-jump');
    expectAtLeastFloor(toggle, '#mobile-action-page-toggle');
    const actionFace = getComputedStyle(a1, '::before');
    const targetFace = getComputedStyle(targetCycle, '::before');
    const jumpFace = getComputedStyle(jump, '::before');
    expect(parseFloat(targetFace.width)).toBeGreaterThan(parseFloat(actionFace.width));
    expect(parseFloat(targetFace.width)).toBeLessThan(parseFloat(jumpFace.width));
    expect(new DOMMatrixReadOnly(targetFace.transform).f).toBeLessThan(
      new DOMMatrixReadOnly(actionFace.transform).f,
    );
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

  it('compact Consumables render beside the toggle in two ordered rows and mirror', async () => {
    await page.viewport(740, 360);
    document.body.className = 'mobile-touch game-active hud-mobile-compact mobile-consumables-open';
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
    document.body.appendChild(consumables);
    await nextFrame();

    const rightHanded = slots.map((slot) => slot.getBoundingClientRect());
    expect(roundedBuckets(rightHanded.map((rect) => rect.top))).toHaveLength(2);
    expect(roundedBuckets(rightHanded.map((rect) => rect.left))).toHaveLength(3);
    expect(rightHanded.slice(0, 3).every((rect) => rect.top > rightHanded[3].top)).toBe(true);
    expect(rightHanded[0].left).toBeLessThan(rightHanded[1].left);
    expect(rightHanded[1].left).toBeLessThan(rightHanded[2].left);

    slots[5].style.display = 'none';
    await nextFrame();
    const partial = slots.slice(0, 5).map((slot) => slot.getBoundingClientRect());
    expect(roundedBuckets(partial.map((rect) => rect.top))).toHaveLength(2);
    expect(partial[3].left).toBeCloseTo(partial[0].left, 0);
    expect(partial[4].left).toBeCloseTo(partial[1].left, 0);

    slots[5].style.display = '';
    document.body.classList.add('mobile-left-handed');
    await nextFrame();
    const leftHanded = slots.map((slot) => slot.getBoundingClientRect());
    expect(roundedBuckets(leftHanded.map((rect) => rect.top))).toHaveLength(2);
    expect(roundedBuckets(leftHanded.map((rect) => rect.left))).toHaveLength(3);
    expect(leftHanded.slice(0, 3).every((rect) => rect.top > leftHanded[3].top)).toBe(true);
    expect(leftHanded[0].left).toBeGreaterThan(leftHanded[1].left);
    expect(leftHanded[1].left).toBeGreaterThan(leftHanded[2].left);
  });

  it('player, Target, cast, and swing geometry grows monotonically by landscape tier', async () => {
    const tiers = [
      { className: 'hud-mobile-compact', width: 740, minimumPlayerWidth: 180 },
      { className: 'hud-mobile-standard', width: 844, minimumPlayerWidth: 250 },
      { className: 'hud-mobile-tablet', width: 1180, minimumPlayerWidth: 275 },
    ] as const;
    const measuredPlayerWidths: number[] = [];

    for (const tier of tiers) {
      document.body.innerHTML = '';
      document.body.className = `mobile-touch game-active ${tier.className}`;
      await page.viewport(tier.width, 390);
      const ui = el('div', { id: 'ui' });
      const player = el('div', { id: 'player-frame', class: 'unitframe' });
      player.style.height = '68px';
      const target = el('div', { id: 'target-frame', class: 'unitframe' });
      target.style.display = 'block';
      target.style.width = '300px';
      target.style.height = '68px';
      const cast = el('div', { id: 'castbar' });
      const swing = el('div', { id: 'swingbar' });
      cast.style.display = 'block';
      swing.style.display = 'block';
      ui.append(player, target, cast, swing);
      document.body.appendChild(ui);
      await nextFrame();

      const playerRect = player.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const castRect = cast.getBoundingClientRect();
      const swingRect = swing.getBoundingClientRect();
      measuredPlayerWidths.push(playerRect.width);
      expect(playerRect.width).toBeGreaterThanOrEqual(tier.minimumPlayerWidth - EPSILON);
      expect(targetRect.width / playerRect.width).toBeCloseTo(0.9, 2);
      expect(targetRect.width).toBeLessThan(playerRect.width);
      expect(castRect.width).toBeCloseTo(playerRect.width, 1);
      expect(swingRect.width).toBeCloseTo(playerRect.width, 1);
      expect((playerRect.left + playerRect.right) / 2).toBeCloseTo(tier.width / 2, 1);
      expect((targetRect.left + targetRect.right) / 2).toBeCloseTo(tier.width / 2, 1);
    }

    expect(measuredPlayerWidths[1]).toBeGreaterThan(measuredPlayerWidths[0]);
    expect(measuredPlayerWidths[2]).toBeGreaterThan(measuredPlayerWidths[1]);
  });

  it('party-member rows (role=button tap targets)', () => {
    // The mobile party UI collapses behind the disclosure chip; member rows are
    // interactive only in the expanded state, so measure them there.
    const frames = el('div', { id: 'party-frames', class: 'party-expanded' });
    const rows = el('div', { class: 'party-rows' });
    const row = el('div', { class: 'party-frame', role: 'button', tabindex: '0' });
    rows.appendChild(row);
    frames.appendChild(rows);
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
    expectAtLeastFloor(close, '#mobile-more-close');
  });

  it('does not expose the desktop community HUD on touch', () => {
    // On touch the community entry lives in the More drawer; the desktop
    // details/summary toggle is display: none, so it must measure 0x0 rather
    // than present an undersized tap target.
    const hud = el('div', { id: 'community-hud' });
    const menu = el('details', { id: 'community-menu' });
    const toggle = el('summary', { class: 'community-toggle' });
    menu.appendChild(toggle);
    hud.appendChild(menu);
    document.body.appendChild(hud);
    expect(measure(toggle)).toEqual({ w: 0, h: 0 });
  });

  it('the always-present Donate button in the mobile More tray', () => {
    document.body.className = 'mobile-touch game-active mobile-more-open';
    const tray = el('div', { id: 'mobile-extra-controls', class: 'window panel' });
    const grid = el('div', { id: 'mobile-extra-grid' });
    const donate = el('button', { id: 'mobile-donate', class: 'mobile-btn' });
    donate.textContent = 'Donate';
    grid.appendChild(donate);
    tray.appendChild(grid);
    document.body.appendChild(tray);
    expectAtLeastFloor(donate, '#mobile-donate');
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

  it('the Bags item action sheet renders 40px controls, names them, and returns focus', () => {
    const host = el('div', { id: 'bags' });
    const opener = el('button');
    document.body.append(opener, host);
    opener.focus();
    const menu = new BagItemActionMenu({
      showError: () => undefined,
      restoreFocus: (target) => target?.focus(),
      onDismiss: () => undefined,
    });
    menu.open({
      host,
      itemId: 'bread',
      itemName: 'Bread',
      itemDetailsHtml: '<div class="tt-desc">Restores health.</div>',
      actions: [{ id: 'consume' }, { id: 'linkToChat' }, { id: 'destroy', destructive: true }],
      canAssignConsumable: true,
      layout: ['healing_potion', 'bread', null, null, null, null],
      itemNameForId: (id) => id,
      onAction: () => true,
      onAssign: () => true,
      onReset: () => true,
      opener,
    });
    const controls = Array.from(
      host.querySelectorAll<HTMLElement>(
        '.bag-item-action, .bag-item-destination, .bag-item-action-reset, .bag-item-action-close',
      ),
    );
    expect(controls.length).toBe(11);
    for (const [index, control] of controls.entries()) {
      expectAtLeastFloor(control, `bag item action control ${index}`, LEGACY_TOUCH_FLOOR);
      expect(control.getAttribute('aria-label')).toBeTruthy();
    }
    expect(host.querySelector('.bag-item-action-details')?.textContent).toContain(
      'Restores health.',
    );
    const layout = host.querySelector<HTMLElement>('.bag-item-action-layout');
    expect(getComputedStyle(layout as HTMLElement).gridTemplateColumns.split(' ')).toHaveLength(2);
    expect(document.activeElement).toBe(host.querySelector('.bag-item-action'));
    const close = host.querySelector<HTMLElement>('.bag-item-action-close');
    close?.focus();
    close?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
    );
    expect(document.activeElement).toBe(host.querySelector('.bag-item-action-reset'));
    host
      .querySelector('.bag-item-action-menu')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu.isOpen).toBe(false);
    expect(document.activeElement).toBe(opener);
  });
});

describe('mobile HUD editor target-size matrix', () => {
  it.each([
    { width: 740, height: 360, profileId: 'phone', handedness: 'right', leftInset: 0 },
    { width: 844, height: 390, profileId: 'phone', handedness: 'right', leftInset: 50 },
    { width: 932, height: 430, profileId: 'phone', handedness: 'right', leftInset: 0 },
    { width: 740, height: 360, profileId: 'phone', handedness: 'left', leftInset: 0 },
    { width: 1024, height: 768, profileId: 'tablet', handedness: 'right', leftInset: 0 },
  ] as const)('keeps editor controls usable at $width x $height, $handedness hand, inset $leftInset', async ({
    width,
    height,
    profileId,
    handedness,
    leftInset,
  }) => {
    await page.viewport(width, height);
    document.body.className = `mobile-touch game-active ${profileId === 'tablet' ? 'hud-mobile-tablet' : 'hud-mobile-compact'}`;
    const editor = new MobileHudEditor({
      document,
      registry: MOBILE_HUD_REGISTRY,
      canOpen: () => true,
      getDocument: () => ({
        schemaVersion: 1,
        enabled: false,
        profiles: MOBILE_HUD_REGISTRY.defaults,
      }),
      getProfileId: () => profileId,
      getSceneId: () => 'world',
      getContextId: () => 'world.base',
      getGeometry: () => ({
        id: `target-size-${width}x${height}-${leftInset}`,
        width,
        height,
        visualOffsetX: 0,
        visualOffsetY: 0,
        safeAreaInsets: { top: 0, right: 0, bottom: 0, left: leftInset },
      }),
      getHandedness: () => handedness,
      beginPreview: () => undefined,
      updatePreview: () => undefined,
      storage: { load: async () => null, save: async () => undefined },
      commitValidatedDocument: () => undefined,
      endPreview: () => undefined,
      focusManager: new FocusManager(),
      confirmDiscard: () => true,
      translate: (key) => String(key),
      onOpenChange: () => undefined,
    });
    editor.open();
    editor.setLocked(false);
    editor.selectSurface('action.attack');

    for (const surfaceId of [
      'action.attack',
      'utility.consumables',
      'auras.player_buffs',
      'auras.player_debuffs',
    ]) {
      const proxy = document.querySelector<HTMLElement>(
        `[data-mobile-hud-surface-id="${surfaceId}"]`,
      );
      expect(proxy, `${surfaceId} proxy missing`).toBeTruthy();
      expectAtLeastFloor(proxy as HTMLElement, `${surfaceId} editor proxy`, EDITOR_PROXY_FLOOR);
    }
    for (const surfaceId of ['party', 'pet.commands']) {
      const proxy = document.querySelector<HTMLElement>(
        `[data-mobile-hud-surface-id="${surfaceId}"]`,
      );
      expect(proxy, `${surfaceId} proxy missing`).toBeTruthy();
      expectAtLeastFloor(proxy as HTMLElement, `${surfaceId} editor proxy`, EDITOR_PROXY_FLOOR);
    }
    for (const control of document.querySelectorAll<HTMLElement>(
      '.mobile-hud-editor-dock button, .mobile-hud-editor-inspector button',
    )) {
      // The editor dock/inspector chrome ships compact 40px buttons by design
      // (the proxies, not the chrome, carry the 48px drag floor).
      expectAtLeastFloor(control, 'editor chrome button', LEGACY_TOUCH_FLOOR);
    }
    editor.cancel();
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
