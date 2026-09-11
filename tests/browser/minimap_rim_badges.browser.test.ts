// Real-browser regression for the minimap rim satellites (raid lockout, Ravenpost
// envelope, World Market coin, day/night dial). tests/minimap_rim_badges.test.ts reads
// the sheets as TEXT, so it can say which corner a rule claims but never where the
// widget actually lands: the touch defect was a valid declaration
// (`right: calc(100% + 138px)`) resolving against the disc box and painting the badges
// in empty world space to the LEFT of the map, an offset only real layout shows.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { hydrateIcons, svgIcon } from '../../src/ui/ui_icons';
import { cleanup } from './_harness';

const RIM_WIDGETS = ['#raid-lockout', '#mail-indicator', '#market-indicator'] as const;

const MARKUP = `
<div id="minimap-wrap">
  <div id="zone-label" class="ui-cin ui-outline">Eastbrook Vale</div>
  <div id="minimap-disc">
    <canvas id="minimap" width="162" height="162" aria-hidden="true"></canvas>
    <button id="raid-lockout" class="ui-disc" type="button" aria-label="Raid Lockouts"></button>
    <button id="mail-indicator" class="ui-disc" type="button" data-icon="mail" aria-label="Mail">
      <span class="mail-indicator-count ui-badge ui-badge--corner">2</span>
    </button>
    <button id="market-indicator" class="ui-disc" type="button" data-icon="market" aria-label="Market"></button>
    <canvas id="minimap-daynight" class="ui-disc" width="88" height="88" aria-hidden="true"></canvas>
  </div>
  <button id="minimap-clock" class="ui-cin ui-num" type="button">12:00</button>
  <div id="compass" class="ui-outline" role="img" aria-label="Heading">
    <div id="compass-strip"><div id="compass-track"></div></div>
    <div id="compass-center"></div>
    <div id="compass-heading" class="ui-cin">N</div>
  </div>
  <div id="minimap-coords" class="ui-chip ui-num" role="status" aria-label="Coordinates">0, 0</div>
  <div id="minimap-zoom" role="group" aria-label="Minimap zoom">
    <button type="button" class="minimap-zoom-btn ui-disc ui-cin" id="minimap-zoom-out">-</button>
    <span id="minimap-zoom-label" class="ui-disc ui-num">1x</span>
    <button type="button" class="minimap-zoom-btn ui-disc ui-cin" id="minimap-zoom-in">+</button>
  </div>
</div>`;

function mountMinimap(zoneTitle?: string): void {
  const ui = document.createElement('div');
  ui.id = 'ui';
  ui.innerHTML = MARKUP;
  document.body.appendChild(ui);
  if (zoneTitle !== undefined) {
    const label = ui.querySelector<HTMLElement>('#zone-label');
    if (label) label.textContent = zoneTitle;
  }
  // The same two steps HUD init runs on this cluster: the envelope and coin take
  // their glyph from [data-icon], the lockout badge from an svgIcon() write, and
  // all three ship hidden until their state goes live. The glyph is load-bearing
  // here: it is what gives each badge its real box.
  hydrateIcons(ui);
  const lockout = ui.querySelector<HTMLElement>('#raid-lockout');
  if (lockout) lockout.innerHTML = svgIcon('lock');
  for (const selector of RIM_WIDGETS) {
    const el = ui.querySelector<HTMLElement>(selector);
    if (el) el.hidden = false;
  }
}

function centerOf(el: Element): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function expectOnTheRim(selector: string, label: string): void {
  const disc = document.querySelector('#minimap-disc');
  const widget = document.querySelector(selector);
  expect(disc, '#minimap-disc is mounted').not.toBeNull();
  expect(widget, `${selector} is mounted`).not.toBeNull();
  if (disc === null || widget === null) return;
  const discRect = disc.getBoundingClientRect();
  const widgetRect = widget.getBoundingClientRect();
  const discCenter = centerOf(disc);
  const center = centerOf(widget);
  const radius = discRect.width / 2;

  expect(
    center.x,
    `${label}: ${selector} centre is ${(discRect.left - center.x).toFixed(1)}px left of the minimap`,
  ).toBeGreaterThanOrEqual(discRect.left);
  expect(center.x, `${label}: ${selector} centre is right of the minimap`).toBeLessThanOrEqual(
    discRect.right,
  );
  expect(center.y, `${label}: ${selector} centre is above the minimap`).toBeGreaterThanOrEqual(
    discRect.top,
  );
  expect(center.y, `${label}: ${selector} centre is below the minimap`).toBeLessThanOrEqual(
    discRect.bottom,
  );

  // A satellite may overhang into the box corner (the desktop envelope pill does),
  // but its own box has to reach the painted circle: that is what "on the rim"
  // means, and what a badge parked beside the map fails by a wide margin.
  const distance = Math.hypot(center.x - discCenter.x, center.y - discCenter.y);
  const reach = distance - Math.hypot(widgetRect.width, widgetRect.height) / 2;
  expect(
    reach,
    `${label}: ${selector} clears the disc rim by ${(reach - radius).toFixed(1)}px, so it floats free of the minimap`,
  ).toBeLessThanOrEqual(radius);
}

afterEach(() => {
  cleanup();
  document.body.className = '';
  document.documentElement.style.removeProperty('--app-vw');
  document.documentElement.style.removeProperty('--app-vh');
  document.documentElement.style.removeProperty('--ui-scale');
});

beforeEach(() => {
  document.body.className = '';
});

describe('minimap rim satellites stay on the disc', () => {
  it.each([
    // The two landscape phones this HUD targets both resolve to the compact tier,
    // whose minimap scale is the smallest, so a badge offset bites hardest there;
    // the tablet tier and desktop keep the other two minimap scales honest.
    { label: 'compact phone', width: 844, height: 390, uiScale: 1, tier: 'hud-mobile-compact' },
    {
      label: 'compact phone, large UI',
      width: 844,
      height: 390,
      uiScale: 1.4,
      tier: 'hud-mobile-compact',
    },
    {
      label: 'tall landscape phone',
      width: 874,
      height: 402,
      uiScale: 1,
      tier: 'hud-mobile-compact',
    },
    { label: 'touch tablet', width: 1024, height: 768, uiScale: 1, tier: 'hud-mobile-tablet' },
    { label: 'desktop', width: 1280, height: 720, uiScale: 1, tier: '' },
  ])(
    '$label at $width x $height and UI scale $uiScale',
    async ({ label, width, height, uiScale, tier }) => {
      await page.viewport(width, height);
      document.body.className =
        tier === '' ? 'game-active' : `mobile-touch game-active ${tier} hud-mobile-landscape`;
      document.documentElement.style.setProperty('--app-vw', `${width}px`);
      document.documentElement.style.setProperty('--app-vh', `${height}px`);
      document.documentElement.style.setProperty('--ui-scale', String(uiScale));
      mountMinimap();

      for (const selector of [...RIM_WIDGETS, '#minimap-daynight']) {
        expectOnTheRim(selector, label);
      }
    },
  );
});

// The clock medallion and the zoom discs are absolutely positioned in the seat
// between the ring's lower edge and the compass strip. They hang off the wrap's
// BOTTOM, not its top, precisely so a zone title that wraps to two lines (every
// long localized zone name does) moves them WITH the ring instead of letting the
// ring slide down over them. A top offset passes the single-line case and fails
// only in the locales nobody screenshots, so it is pinned here in real layout.
describe('minimap lower-arc controls follow the ring', () => {
  it.each([
    { label: 'one-line zone title', zone: 'Eastbrook Vale' },
    { label: 'wrapped zone title', zone: 'Thornhollow Fields of the Long Reckoning' },
  ])('$label', async ({ label, zone }) => {
    await page.viewport(1280, 720);
    document.body.className = 'game-active';
    mountMinimap(zone);

    const disc = document.querySelector('#minimap-disc') as HTMLElement;
    const clock = document.querySelector('#minimap-clock') as HTMLElement;
    const zoom = document.querySelector('#minimap-zoom') as HTMLElement;
    const compass = document.querySelector('#compass') as HTMLElement;
    const discRect = disc.getBoundingClientRect();
    const clockRect = clock.getBoundingClientRect();
    const zoomRect = zoom.getBoundingClientRect();
    const compassRect = compass.getBoundingClientRect();

    // The zone title actually wraps in the second case, so the two rows are not
    // measuring the same layout twice.
    const label2 = document.querySelector('#zone-label') as HTMLElement;
    const wrapped = label2.getBoundingClientRect().height > 20;
    expect(wrapped, `${label}: zone title wrapping`).toBe(zone !== 'Eastbrook Vale');

    // Straddles the ring's lower edge: the medallion's box crosses it.
    expect(clockRect.top, `${label}: clock top above the ring edge`).toBeLessThan(discRect.bottom);
    expect(clockRect.bottom, `${label}: clock bottom below the ring edge`).toBeGreaterThan(
      discRect.bottom,
    );
    // The zoom discs hug the arc under the medallion, clear of both.
    expect(zoomRect.top, `${label}: zoom below the clock`).toBeGreaterThanOrEqual(clockRect.bottom);
    expect(zoomRect.bottom, `${label}: zoom above the compass`).toBeLessThanOrEqual(
      compassRect.top,
    );
  });
});
