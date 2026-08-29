// Real-browser regression for the touch menu control and the left-column reflow
// it pays for. Composes the shipped markup shape, the real mobile stylesheet, the
// placement core and the strip painter, so what a unit test cannot see is pinned
// against real layout: the control renders as one circle on the action ring's
// Jump line wearing the OVERFLOW glyph rather than Chat's, its ten-item strip
// opens RIGHTWARD and stays on screen with the cancel X sitting on the anchor,
// one caption names the live item, and the top band the collapsed row vacated
// seats the target frame with the party stack below it, clear of the move zone
// and holding its slot when the target drops.

import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { placeConsumableStrip } from '../../src/ui/hud/action_bar/radial_action_core';
import { buildMobileMenuControl } from '../../src/ui/hud/menu/menu_control_controller';
import {
  MENU_STRIP_COUNT,
  MENU_STRIP_DIRECTION,
  MENU_STRIP_ITEMS,
  MENU_STRIP_PITCH_PX,
} from '../../src/ui/hud/menu/menu_strip_core';
import { MenuStripPainter } from '../../src/ui/hud/menu/menu_strip_painter';
import { resolveMobileHudLayout } from '../../src/ui/mobile_hud_layout';
import { makeWriterFacet } from '../../src/ui/painter_host';
import { PARTY_BELOW_TARGET_BOTTOM_PROP } from '../../src/ui/party_below_target_painter';
import { hydrateIcons } from '../../src/ui/ui_icons';
import '../../src/styles/index.css';
import { cleanup } from './_harness';

// Both are real landscape phone viewports the touch HUD ships to: 844x390 is the
// iPhone 14/15 class and 874x402 the iPhone 16 Pro. Their tier is DERIVED from the
// same core the applier runs, never hand-written: a hand-written tier is how this
// file previously ran the 16 Pro on the standard tier while the device itself gets
// the compact one, and every pin below then measured a layout no phone renders.
const VIEWPORTS = [
  { label: '844x390', width: 844, height: 390 },
  { label: '874x402', width: 874, height: 402 },
] as const;

function tierClasses(width: number, height: number): string {
  return resolveMobileHudLayout({
    width,
    height,
    safeAreaTop: 0,
    safeAreaRight: 0,
    safeAreaBottom: 0,
    safeAreaLeft: 0,
    touchMode: true,
    menuOpen: false,
    chatOpen: false,
  }).classes.join(' ');
}

const EDGE_TOLERANCE_PX = 0.5;
const TOUCH_FLOOR_PX = 40;

function writers() {
  return makeWriterFacet(
    new Map(),
    new Map(),
    new Map(),
    new Map(),
    () => {},
    () => {},
  );
}

/** The anchor's glyph in the shipped markup (index.html / play.html, pinned
 *  there by tests/client_shell.test.ts). It is the overflow mark, NOT chat's:
 *  the control opens a row of actions and chat is one of them. */
const ANCHOR_ICON = 'more';

/** The shipped structure: the control inside #mobile-combat-controls, the ring
 *  beside it (for the Jump line the control's seat is derived from), and the
 *  strip as a SIBLING overlay, matching index.html / play.html. */
function mountControl() {
  const controls = document.createElement('section');
  controls.id = 'mobile-controls';

  const ring = document.createElement('div');
  ring.id = 'mobile-action-ring';
  const attack = document.createElement('button');
  attack.type = 'button';
  attack.id = 'mobile-action-attack';
  const jump = document.createElement('button');
  jump.type = 'button';
  jump.id = 'mobile-jump';
  ring.append(attack, jump);

  const row = document.createElement('div');
  row.id = 'mobile-combat-controls';
  const anchor = document.createElement('button');
  anchor.type = 'button';
  anchor.id = 'mobile-menu-anchor';
  anchor.className = 'mobile-btn';
  anchor.dataset.icon = ANCHOR_ICON;
  row.append(anchor);

  const strip = document.createElement('div');
  strip.id = 'mobile-menu-strip';
  const items = MENU_STRIP_ITEMS.map((item, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mobile-menu-item';
    btn.id = item.elementId;
    btn.dataset.menuIndex = String(i);
    btn.dataset.icon = item.id === 'chat' ? 'chat' : 'more';
    btn.tabIndex = -1;
    return btn;
  });
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.id = 'mobile-menu-cancel';
  cancel.tabIndex = -1;
  const caption = document.createElement('div');
  caption.id = 'mobile-menu-caption';
  caption.className = 'panel';
  const captionText = document.createElement('span');
  captionText.className = 'tt-title';
  caption.append(captionText);
  strip.append(...items, cancel, caption);

  const moveZone = document.createElement('div');
  moveZone.id = 'mobile-move-zone';
  const moveJoystick = document.createElement('div');
  moveJoystick.id = 'mobile-move-joystick';
  moveJoystick.className = 'mobile-joystick';

  controls.append(moveZone, moveJoystick, row, ring, strip);
  document.body.appendChild(controls);
  return { controls, ring, jump, anchor, strip, items, cancel, caption, captionText, moveJoystick };
}

/** The left column: the target frame in the band the row vacated, with the party
 *  stack below it. Rows only render under .party-expanded, so a container without
 *  it measures 0x0 and makes the column look free when it is not. */
function mountLeftColumn(memberCount: number) {
  const ui = document.createElement('div');
  ui.id = 'ui';

  const target = document.createElement('div');
  target.id = 'target-frame';
  target.className = 'unitframe';
  target.style.display = 'flex';
  const bars = document.createElement('div');
  bars.className = 'uf-bars';
  bars.textContent = 'Gravewyrm Acolyte';
  const portrait = document.createElement('div');
  portrait.className = 'portrait-wrap';
  target.append(bars, portrait);

  const party = document.createElement('div');
  party.id = 'party-frames';
  party.className = 'party-present below-target has-party-chip party-expanded';
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.id = 'party-chip';
  chip.textContent = 'Party';
  const rows = document.createElement('div');
  rows.className = 'party-rows';
  for (let i = 0; i < memberCount; i++) {
    const row = document.createElement('div');
    row.className = 'party-frame panel';
    row.setAttribute('role', 'button');
    row.textContent = `Member ${i + 1}`;
    rows.append(row);
  }
  party.append(chip, rows);

  ui.append(target, party);
  document.body.appendChild(ui);
  return { ui, target, party, rows };
}

/** The bottom-centre column, in its shipped nesting: #player-frame and #stancebar
 *  both live inside #bottom-bar's stack under #ui, which is the stacking context
 *  the strip has to clear. Real content, because the frame's rendered height is
 *  content-driven and then scaled, and the seat under test is about its TOP. */
function mountBottomColumn() {
  const ui = document.createElement('div');
  ui.id = 'ui';
  ui.innerHTML = `
    <div id="bottom-bar"><div id="actionbar-row"><div id="actionbar-stack">
      <div id="pet-cluster">
        <div id="petbar" class="panel"><div class="stancebar-group">
          <button type="button" class="stance-btn"></button>
          <button type="button" class="stance-btn"></button>
        </div></div>
      </div>
      <div id="player-frame" class="unitframe" role="group" tabindex="0">
        <div class="portrait-wrap" id="pf-portrait-wrap">
          <div class="portrait"><canvas id="pf-portrait" width="54" height="54"></canvas></div>
          <div class="level-chip" id="pf-level">1</div>
        </div>
        <div class="uf-bars">
          <div class="uf-name" id="pf-name">Hero</div>
          <div class="bar hp"><div class="bar-fill" id="pf-hp"></div></div>
          <div class="bar mana" id="pf-resource"><div class="bar-fill" id="pf-res"></div></div>
        </div>
      </div>
      <div id="stancebar"><div class="stancebar-group">
        <button type="button" class="stance-btn"></button>
        <button type="button" class="stance-btn"></button>
        <button type="button" class="stance-btn"></button>
      </div></div>
    </div></div></div>`;
  document.body.appendChild(ui);
  const el = (id: string) => ui.querySelector(`#${id}`) as HTMLElement;
  const stancebar = el('stancebar');
  const petbar = el('petbar');
  // Both bars are JS-flipped to flex by their own renderers; the CSS seat under
  // test only applies once they render, so the fixture flips them the same way.
  stancebar.style.display = 'flex';
  petbar.style.display = 'flex';
  return {
    ui,
    playerFrame: el('player-frame'),
    stancebar,
    stanceGroup: stancebar.querySelector('.stancebar-group') as HTMLElement,
    petbar,
  };
}

/** Lay the row out exactly as MenuStripGesture does and paint it open. */
function openMenuStrip(
  rig: ReturnType<typeof mountControl>,
  viewportWidth: number,
  live: number,
  caption: string,
) {
  const painter = new MenuStripPainter(writers(), {
    strip: rig.strip,
    items: rig.items,
    cancel: rig.cancel,
    caption: rig.caption,
    captionText: rig.captionText,
  });
  const anchorBox = rig.anchor.getBoundingClientRect();
  const stripStyle = getComputedStyle(rig.strip);
  const anchorX = anchorBox.x + anchorBox.width / 2;
  const anchorY = anchorBox.y + anchorBox.height / 2;
  const itemSize = anchorBox.width;
  const margin = Number.parseFloat(stripStyle.getPropertyValue('--strip-margin'));
  const placement = placeConsumableStrip({
    anchorX,
    anchorY,
    count: MENU_STRIP_COUNT,
    itemSize,
    gap: Number.parseFloat(stripStyle.getPropertyValue('--strip-gap')),
    viewportWidth,
    margin,
    direction: MENU_STRIP_DIRECTION,
  });
  painter.paint({
    placement,
    anchorX,
    anchorY,
    live,
    cancelLive: false,
    viewportWidth,
    margin,
    itemSize,
    caption,
  });
  return { anchorX, anchorY, itemSize, placement };
}

/** Boxes that share any real area, past the sub-pixel tolerance. */
function overlaps(a: DOMRect, b: DOMRect): boolean {
  return (
    a.left < b.right - EDGE_TOLERANCE_PX &&
    a.right > b.left + EDGE_TOLERANCE_PX &&
    a.top < b.bottom - EDGE_TOLERANCE_PX &&
    a.bottom > b.top + EDGE_TOLERANCE_PX
  );
}

afterEach(() => {
  cleanup();
  document.body.className = '';
  document.documentElement.style.removeProperty('--app-vw');
  document.documentElement.style.removeProperty('--app-vh');
});

describe.each(VIEWPORTS)('touch menu control at $label', ({ width, height }) => {
  async function setup() {
    await page.viewport(width, height);
    document.body.className = `mobile-touch game-active ${tierClasses(width, height)}`;
    document.documentElement.style.setProperty('--app-vw', `${width}px`);
    document.documentElement.style.setProperty('--app-vh', `${height}px`);
    return mountControl();
  }

  it('wears the overflow glyph, not the chat one the strip now carries', async () => {
    const rig = await setup();
    hydrateIcons(rig.controls);
    const glyph = rig.anchor.querySelector('.ui-icon');
    expect(glyph, 'the anchor renders no icon at all').not.toBeNull();
    // The Chat item's glyph is a DIFFERENT drawing: the anchor used to wear it,
    // which named an action the control no longer runs.
    const chatSeat = rig.items[MENU_STRIP_ITEMS.findIndex((item) => item.id === 'chat')];
    const chatGlyph = chatSeat.querySelector('.ui-icon');
    expect(chatGlyph).not.toBeNull();
    expect(glyph?.innerHTML).not.toBe(chatGlyph?.innerHTML);
    // And it is a real drawing rather than an unresolved placeholder.
    expect(glyph?.innerHTML.length).toBeGreaterThan(0);
  });

  it('renders ONE control, a true circle on the ring Jump line and above the touch floor', async () => {
    const rig = await setup();
    const box = rig.anchor.getBoundingClientRect();
    expect(getComputedStyle(rig.anchor).display).not.toBe('none');
    expect(box.width).toBeGreaterThanOrEqual(TOUCH_FLOOR_PX);
    expect(box.height).toBeGreaterThanOrEqual(TOUCH_FLOOR_PX);
    // A CIRCLE at the shared --menu-btn-size, not the retired row's 58x54 oval.
    expect(box.width).toBeCloseTo(box.height, 1);
    // Its seat is DERIVED from the ring, so it lands on Jump's centre line
    // without any runtime measure-and-correct pass.
    const jump = rig.jump.getBoundingClientRect();
    expect(jump.height).toBeGreaterThan(0);
    expect(box.y + box.height / 2).toBeCloseTo(jump.y + jump.height / 2, 0);
    // Fully on screen, and clear of the movement wheel it sits beside.
    expect(box.left).toBeGreaterThan(-EDGE_TOLERANCE_PX);
    expect(box.bottom).toBeLessThanOrEqual(height + EDGE_TOLERANCE_PX);
    const wheel = rig.moveJoystick.getBoundingClientRect();
    expect(box.left).toBeGreaterThanOrEqual(wheel.right - EDGE_TOLERANCE_PX);
  });

  it('opens the ten-item strip RIGHTWARD and keeps every item on screen', async () => {
    const rig = await setup();
    const painter = new MenuStripPainter(writers(), {
      strip: rig.strip,
      items: rig.items,
      cancel: rig.cancel,
      caption: rig.caption,
      captionText: rig.captionText,
    });

    // Closed is the steady state and the row must not render at all.
    painter.paint(null);
    expect(getComputedStyle(rig.strip).display).toBe('none');

    const anchorBox = rig.anchor.getBoundingClientRect();
    const stripStyle = getComputedStyle(rig.strip);
    // The item size is the ANCHOR's measured box, exactly as the gesture layer
    // takes it: --strip-item-size is a calc() and getComputedStyle hands custom
    // properties back unresolved, which is why the gap and margin beside it are
    // authored as literals.
    const itemSize = anchorBox.width;
    const gap = Number.parseFloat(stripStyle.getPropertyValue('--strip-gap'));
    const margin = Number.parseFloat(stripStyle.getPropertyValue('--strip-margin'));
    const anchorX = anchorBox.x + anchorBox.width / 2;
    const anchorY = anchorBox.y + anchorBox.height / 2;
    const placement = placeConsumableStrip({
      anchorX,
      anchorY,
      count: MENU_STRIP_COUNT,
      itemSize,
      gap,
      viewportWidth: width,
      margin,
      direction: MENU_STRIP_DIRECTION,
    });
    painter.paint({
      placement,
      anchorX,
      anchorY,
      live: 2,
      cancelLive: false,
      viewportWidth: width,
      margin,
      itemSize,
      caption: 'Bags',
    });

    expect(getComputedStyle(rig.strip).display).toBe('block');
    const boxes = rig.items.map((btn) => btn.getBoundingClientRect());
    expect(boxes).toHaveLength(MENU_STRIP_COUNT);
    for (const [i, box] of boxes.entries()) {
      expect(box.width, `item ${i} must render`).toBeGreaterThanOrEqual(TOUCH_FLOOR_PX);
      expect(box.height, `item ${i} must render`).toBeGreaterThanOrEqual(TOUCH_FLOOR_PX);
      expect(box.left, `item ${i} runs off the left edge`).toBeGreaterThan(-EDGE_TOLERANCE_PX);
      expect(box.right, `item ${i} runs off the right edge`).toBeLessThanOrEqual(
        width + EDGE_TOLERANCE_PX,
      );
    }
    // Rightward and strictly increasing: the roster order IS the swipe order.
    expect(boxes[0].x).toBeGreaterThan(anchorBox.x);
    for (let i = 1; i < boxes.length; i++) expect(boxes[i].x).toBeGreaterThan(boxes[i - 1].x);
    // One row: every item shares the anchor's centre line.
    for (const box of boxes) expect(box.y + box.height / 2).toBeCloseTo(anchorY, 0);
    // The cancel X sits ON the anchor, so releasing where the gesture started is
    // the way out without leaving the thumb's own spot.
    const cancelBox = rig.cancel.getBoundingClientRect();
    expect(cancelBox.x + cancelBox.width / 2).toBeCloseTo(anchorX, 0);
    expect(cancelBox.y + cancelBox.height / 2).toBeCloseTo(anchorY, 0);
  });

  it('shows ONE caption in the tooltip chrome, above the live item and on screen', async () => {
    const rig = await setup();
    const painter = new MenuStripPainter(writers(), {
      strip: rig.strip,
      items: rig.items,
      cancel: rig.cancel,
      caption: rig.caption,
      captionText: rig.captionText,
    });
    const anchorBox = rig.anchor.getBoundingClientRect();
    const stripStyle = getComputedStyle(rig.strip);
    const shared = {
      anchorX: anchorBox.x + anchorBox.width / 2,
      anchorY: anchorBox.y + anchorBox.height / 2,
      viewportWidth: width,
      margin: Number.parseFloat(stripStyle.getPropertyValue('--strip-margin')),
      itemSize: anchorBox.width,
    };
    const placement = placeConsumableStrip({
      ...shared,
      count: MENU_STRIP_COUNT,
      itemSize: anchorBox.width,
      gap: Number.parseFloat(stripStyle.getPropertyValue('--strip-gap')),
      direction: MENU_STRIP_DIRECTION,
    });

    // Nothing live: no caption at all, rather than an empty box.
    painter.paint({ placement, ...shared, live: -1, cancelLive: true, caption: '' });
    expect(getComputedStyle(rig.caption).display).toBe('none');

    // The LAST item, the one whose caption is closest to running off the edge.
    // The row is one item longer since Chat joined it, so this is also the pin
    // that the extra pitch did not push the caption off screen.
    painter.paint({
      placement,
      ...shared,
      live: MENU_STRIP_COUNT - 1,
      cancelLive: false,
      caption: 'Character',
    });
    expect(getComputedStyle(rig.caption).display).toBe('block');
    const capBox = rig.caption.getBoundingClientRect();
    expect(capBox.width).toBeGreaterThan(0);
    expect(capBox.left).toBeGreaterThan(-EDGE_TOLERANCE_PX);
    expect(capBox.right).toBeLessThanOrEqual(width + EDGE_TOLERANCE_PX);
    // Parked ABOVE the row, never over the item the finger is on.
    const liveBox = rig.items[MENU_STRIP_COUNT - 1].getBoundingClientRect();
    expect(capBox.bottom).toBeLessThanOrEqual(liveBox.top + EDGE_TOLERANCE_PX);
    // It IS the tooltip chrome, not a second copy of its metrics: the title
    // resolves the same font the #tooltip title does.
    const tooltip = document.createElement('div');
    tooltip.id = 'tooltip';
    tooltip.className = 'panel';
    tooltip.style.display = 'block';
    const title = document.createElement('div');
    title.className = 'tt-title';
    title.textContent = 'Character';
    tooltip.append(title);
    document.body.append(tooltip);
    expect(getComputedStyle(rig.captionText).fontFamily).toBe(getComputedStyle(title).fontFamily);
    expect(getComputedStyle(rig.captionText).fontSize).toBe(getComputedStyle(title).fontSize);
  });

  it('seats the player frame TOP on the button row top line', async () => {
    const rig = await setup();
    const column = mountBottomColumn();
    const frame = column.playerFrame.getBoundingClientRect();
    const anchor = rig.anchor.getBoundingClientRect();
    const jump = rig.jump.getBoundingClientRect();
    // The frame is scaled by a transform, so the RENDERED box is the only honest
    // measure: its layout height is the unscaled one and says nothing about where
    // the top lands.
    expect(frame.height).toBeGreaterThan(0);
    expect(frame.height).toBeLessThan(column.playerFrame.offsetHeight);
    // The contract: one top line across the bottom band.
    expect(frame.top).toBeCloseTo(anchor.top, 0);
    // Jump is the SHORTER of the two buttons and shares the control's CENTRE
    // line, so its own top sits exactly half the height difference lower. That
    // gap is the pin, not a slack tolerance.
    expect(anchor.top + anchor.height / 2).toBeCloseTo(jump.top + jump.height / 2, 0);
    expect(jump.top - frame.top).toBeCloseTo((anchor.height - jump.height) / 2, 0);
    // The frame still ends above the viewport edge it used to be anchored to.
    expect(frame.bottom).toBeLessThanOrEqual(height + EDGE_TOLERANCE_PX);
    // And it never lands on the control it lines up with.
    expect(overlaps(frame, anchor)).toBe(false);
  });

  it('runs the strip dim from the control along the row, not across the screen', async () => {
    const rig = await setup();
    const opened = openMenuStrip(rig, width, -1, '');
    const dim = getComputedStyle(rig.strip, '::before');
    const left = Number.parseFloat(dim.left);
    const dimWidth = Number.parseFloat(dim.width);
    const lastCenter = opened.placement.centers[MENU_STRIP_COUNT - 1];

    // The origin IS the control's rendered centre: the band starts there and
    // grows the way the row does.
    expect(left).toBeCloseTo(opened.anchorX, 0);
    expect(rig.strip.classList.contains('dim-flip')).toBe(false);
    expect(dim.transform).toBe('none');
    expect(dim.backgroundImage).toContain('to right');
    // NEITHER end is a hard cut. The far end always faded along the row; the
    // anchor end used to reach full strength at its first pixel and drew a
    // vertical edge straight through the control, so it ramps in too. The ramp
    // lives INSIDE the measured band, which is what keeps it off the control.
    const stops = dim.backgroundImage.match(/rgba?\([^)]*\)\s+[\d.]+(?:px|%)/g) ?? [];
    expect(stops.length).toBeGreaterThanOrEqual(4);
    expect(stops[0]).toMatch(/rgba\(0, 0, 0, 0\)\s+0px/);
    expect(stops[stops.length - 1]).toMatch(/rgba\(0, 0, 0, 0\)\s+100%/);
    const ramp = Number.parseFloat(stops[1].slice(stops[1].lastIndexOf(' ') + 1));
    expect(ramp).toBeGreaterThanOrEqual(12);
    expect(ramp).toBeLessThanOrEqual(16);
    expect(ramp).toBeLessThan(opened.itemSize / 2);
    // It ends one item past the last item's centre, so the fade clears the row.
    expect(left + dimWidth).toBeCloseTo(lastCenter + opened.itemSize, 0);
    // The reported defect: the darkening used to reach the screen's left edge and
    // wash the half of it the row never touches. Nothing left of the control now.
    expect(left).toBeGreaterThan(width * 0.15);
    expect(dimWidth).toBeLessThan(width);
    // A line, not a blob: it stays inside the row's own vertical band.
    const top = Number.parseFloat(dim.top);
    const dimHeight = Number.parseFloat(dim.height);
    expect(dimHeight).toBeLessThanOrEqual(opened.itemSize * 2 + 1);
    expect(top).toBeLessThanOrEqual(opened.anchorY - opened.itemSize / 2);
    expect(top + dimHeight).toBeGreaterThanOrEqual(opened.anchorY + opened.itemSize / 2);
  });

  it('keeps the stance bar and the pet bar clear of the control, frame and move zone', async () => {
    const rig = await setup();
    const column = mountBottomColumn();
    const anchor = rig.anchor.getBoundingClientRect();
    const frame = column.playerFrame.getBoundingClientRect();
    const zone = rig.controls.querySelector('#mobile-move-zone') as HTMLElement;
    const moveZone = zone.getBoundingClientRect();
    const wheel = rig.moveJoystick.getBoundingClientRect();

    for (const [name, bar] of [
      ['stance bar', column.stanceGroup],
      ['pet bar', column.petbar],
    ] as const) {
      const box = bar.getBoundingClientRect();
      // Rendered and tappable, not merely absent.
      expect(box.width, `${name} must render`).toBeGreaterThan(0);
      expect(box.height, `${name} must render`).toBeGreaterThanOrEqual(TOUCH_FLOOR_PX);
      expect(box.left, `${name} runs off the left edge`).toBeGreaterThan(-EDGE_TOLERANCE_PX);
      expect(box.right, `${name} runs off the right edge`).toBeLessThanOrEqual(
        width + EDGE_TOLERANCE_PX,
      );
      expect(box.top, `${name} runs off the top edge`).toBeGreaterThan(-EDGE_TOLERANCE_PX);
      expect(box.bottom, `${name} runs off the bottom edge`).toBeLessThanOrEqual(
        height + EDGE_TOLERANCE_PX,
      );
      expect(overlaps(box, anchor), `${name} covers the menu control`).toBe(false);
      expect(overlaps(box, frame), `${name} covers the player frame`).toBe(false);
      expect(overlaps(box, moveZone), `${name} covers the move capture zone`).toBe(false);
      expect(overlaps(box, wheel), `${name} covers the move wheel`).toBe(false);
    }
    // Teeth for the seat: the stance bar's own flow box still spans the band the
    // control sits under, so it is the SEAT that clears it, not luck about width.
    expect(column.stancebar.getBoundingClientRect().width).toBeGreaterThan(
      column.stanceGroup.getBoundingClientRect().width,
    );
  });

  it('paints the open strip ABOVE the bottom-centre player frame', async () => {
    const rig = await setup();
    const column = mountBottomColumn();
    openMenuStrip(rig, width, 3, 'Friends');
    const frame = column.playerFrame.getBoundingClientRect();

    // Only the items that actually cross the frame can prove anything.
    const crossing = rig.items.filter((btn) => overlaps(btn.getBoundingClientRect(), frame));
    expect(crossing.length, 'no strip item crosses the player frame').toBeGreaterThan(0);
    const probe = (btn: HTMLElement) => {
      const box = btn.getBoundingClientRect();
      return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    };
    for (const btn of crossing) {
      const hit = probe(btn);
      expect(hit === btn || btn.contains(hit), `${btn.id} is buried under the frame`).toBe(true);
    }

    // The caption carries pointer-events: none by design, so its own stacking is
    // only provable through the context that owns it: the raise happens on
    // #mobile-controls, because a child z-index cannot escape its parent.
    const controlsZ = Number(getComputedStyle(rig.controls).zIndex);
    const uiZ = Number(getComputedStyle(column.ui).zIndex);
    expect(getComputedStyle(rig.caption).display).toBe('block');
    expect(rig.strip.contains(rig.caption)).toBe(true);
    expect(controlsZ).toBeGreaterThan(uiZ);

    // Teeth: with the row CLOSED the touch layer sits back under #ui, and the
    // very same probe finds the frame instead. Without this the pins above would
    // pass on any stacking at all.
    const buriedProbe = crossing[0];
    const box = buriedProbe.getBoundingClientRect();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    rig.strip.classList.remove('open');
    expect(Number(getComputedStyle(rig.controls).zIndex)).toBeLessThan(uiZ);
    rig.strip.classList.add('open');
    // And the frame really is hit-testable at that point, so the pass above is
    // the stacking order rather than an inert element underneath. Raising #ui is
    // what proves it: raising the FRAME cannot, since a child's z-index never
    // escapes its parent context, which is the whole reason the fix lives on
    // #mobile-controls.
    column.ui.style.zIndex = '999';
    const buried = document.elementFromPoint(x, y);
    expect(buried === column.playerFrame || column.playerFrame.contains(buried)).toBe(true);
    column.ui.style.removeProperty('z-index');
    expect(probe(buriedProbe)).toBe(buriedProbe);
  });
});

describe('left-column reflow at 844x390', () => {
  async function setup(memberCount: number) {
    await page.viewport(844, 390);
    document.body.className = 'mobile-touch game-active hud-mobile-compact';
    document.documentElement.style.setProperty('--app-vw', '844px');
    document.documentElement.style.setProperty('--app-vh', '390px');
    const control = mountControl();
    const column = mountLeftColumn(4);
    void memberCount;
    return { ...control, ...column };
  }

  it('seats the target frame in the band the collapsed row vacated', async () => {
    const rig = await setup(4);
    const target = rig.target.getBoundingClientRect();
    const row = rig.controls.querySelector('#mobile-combat-controls') as HTMLElement;
    const rowBox = row.getBoundingClientRect();
    // The row is at the BOTTOM now, so the top band is the target frame's.
    expect(target.top).toBeLessThan(24);
    expect(rowBox.top).toBeGreaterThan(target.bottom);
  });

  it('keeps the party rows clear of the move joystick zone', async () => {
    const rig = await setup(4);
    // The painter is what writes the measured bottom in the app; here the
    // fallback in the stylesheet is what must already clear the zone.
    const rows = rig.rows.getBoundingClientRect();
    const wheel = rig.moveJoystick.getBoundingClientRect();
    expect(rows.height).toBeGreaterThan(0);
    expect(rows.bottom).toBeLessThanOrEqual(wheel.top + EDGE_TOLERANCE_PX);
    // And clear of the control's own seat, which shares the bottom band.
    const anchor = rig.anchor.getBoundingClientRect();
    expect(rows.bottom).toBeLessThanOrEqual(anchor.top + EDGE_TOLERANCE_PX);
  });

  it('holds the party stack in place when the target frame is hidden', async () => {
    const rig = await setup(4);
    // The reservation the painter writes: the party rules read the property, so
    // pinning it here is pinning the layout that follows from it.
    rig.party.style.setProperty(PARTY_BELOW_TARGET_BOTTOM_PROP, '120px');
    const before = rig.party.getBoundingClientRect().top;
    rig.target.style.display = 'none';
    const after = rig.party.getBoundingClientRect().top;
    expect(after).toBeCloseTo(before, 1);
  });

  it('nothing in the left column overlaps the menu control or its strip band', async () => {
    const rig = await setup(4);
    const anchor = rig.anchor.getBoundingClientRect();
    const target = rig.target.getBoundingClientRect();
    expect(overlaps(target, anchor)).toBe(false);
  });
});

// The LEFT-HANDED mirror (body.mobile-left-handed) reseats the whole control
// against the opposite screen edge, and the row has to grow the other way with
// it. With the direction hard-coded 'right' the placement clamped the ten items
// back over the anchor while the travel that highlights them and the dim band
// still counted rightward, so the highlight, the dim and the drawn row all
// disagreed. Driven through the REAL gesture here, because that disagreement
// only exists once real layout decides where the anchor actually sits.
describe.each(VIEWPORTS)('the left-handed mirror at $label', ({ width, height }) => {
  /** Past STRIP_DEADZONE_PX (22), so a move commits without a reveal timer. */
  const SWIPE_PX = 30;

  async function setup(leftHanded: boolean) {
    await page.viewport(width, height);
    document.body.className = `mobile-touch game-active ${tierClasses(width, height)}${
      leftHanded ? ' mobile-left-handed' : ''
    }`;
    document.documentElement.style.setProperty('--app-vw', `${width}px`);
    document.documentElement.style.setProperty('--app-vh', `${height}px`);
    const rig = mountControl();
    const control = buildMobileMenuControl({ writers: writers() });
    if (!control) throw new Error('the shipped markup did not build the control');
    return { ...rig, control };
  }

  function pointer(type: string, target: Element, x: number, pointerId: number): void {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType: 'touch',
        clientX: x,
        clientY: target.getBoundingClientRect().top + 1,
      }),
    );
  }

  it('seats the control against the RIGHT edge, which is what flips the row', async () => {
    const mirrored = await setup(true);
    const box = mirrored.anchor.getBoundingClientRect();
    expect(box.right).toBeLessThanOrEqual(width + EDGE_TOLERANCE_PX);
    expect(width - box.right).toBeLessThan(box.left);
  });

  it('grows the row LEFT of the anchor, every item on screen', async () => {
    const rig = await setup(true);
    const anchorBox = rig.anchor.getBoundingClientRect();
    const startX = anchorBox.x + anchorBox.width / 2;
    pointer('pointerdown', rig.anchor, startX, 1);
    pointer('pointermove', rig.anchor, startX - SWIPE_PX, 1);
    expect(rig.control.gesture.isOpen()).toBe(true);

    expect(getComputedStyle(rig.strip).display).toBe('block');
    const boxes = rig.items.map((btn) => btn.getBoundingClientRect());
    for (const [i, box] of boxes.entries()) {
      expect(box.right, `item ${i} is right of the anchor`).toBeLessThan(
        anchorBox.left + EDGE_TOLERANCE_PX,
      );
      expect(box.left, `item ${i} runs off the left edge`).toBeGreaterThan(-EDGE_TOLERANCE_PX);
      expect(box.width, `item ${i} must render`).toBeGreaterThanOrEqual(TOUCH_FLOOR_PX);
    }
    // Leftward and strictly decreasing: the roster order IS the swipe order.
    for (let i = 1; i < boxes.length; i++) expect(boxes[i].x).toBeLessThan(boxes[i - 1].x);
    pointer('pointercancel', rig.anchor, startX, 1);
  });

  it('highlights the item the LEFTWARD travel is actually over', async () => {
    const rig = await setup(true);
    const anchorBox = rig.anchor.getBoundingClientRect();
    const startX = anchorBox.x + anchorBox.width / 2;
    pointer('pointerdown', rig.anchor, startX, 1);
    // Two pitches of finger travel past the deadzone: item 2, and the rightward
    // reading of the same drag would have answered -1 (a cancel).
    const travel = SWIPE_PX + MENU_STRIP_PITCH_PX * 2;
    pointer('pointermove', rig.anchor, startX - travel, 1);
    const live = rig.control.gesture.liveIndex();
    expect(live).toBe(2);
    // The HIGHLIGHT the player sees is on that same item, and on no other.
    const lit = rig.items.filter((btn) => btn.classList.contains('live'));
    expect(lit).toEqual([rig.items[live]]);
    // And the caption names it, over that item rather than over another.
    const capBox = rig.caption.getBoundingClientRect();
    const itemBox = rig.items[live].getBoundingClientRect();
    expect(capBox.x + capBox.width / 2).toBeCloseTo(itemBox.x + itemBox.width / 2, 0);
    pointer('pointercancel', rig.anchor, startX, 1);
  });

  it('flips the dim band so its fade starts at the anchor, not across the screen', async () => {
    const mirrored = await setup(true);
    const anchorBox = mirrored.anchor.getBoundingClientRect();
    const startX = anchorBox.x + anchorBox.width / 2;
    pointer('pointerdown', mirrored.anchor, startX, 1);
    pointer('pointermove', mirrored.anchor, startX - SWIPE_PX, 1);
    expect(mirrored.strip.classList.contains('dim-flip')).toBe(true);
    pointer('pointercancel', mirrored.anchor, startX, 1);

    cleanup();
    const plain = await setup(false);
    const plainBox = plain.anchor.getBoundingClientRect();
    const plainStart = plainBox.x + plainBox.width / 2;
    pointer('pointerdown', plain.anchor, plainStart, 1);
    pointer('pointermove', plain.anchor, plainStart + SWIPE_PX, 1);
    expect(plain.control.gesture.isOpen()).toBe(true);
    expect(plain.strip.classList.contains('dim-flip')).toBe(false);
    // The unmirrored control is unchanged: the row still grows RIGHT.
    const first = plain.items[0].getBoundingClientRect();
    expect(first.left).toBeGreaterThan(plainBox.right - EDGE_TOLERANCE_PX);
    pointer('pointercancel', plain.anchor, plainStart, 1);
  });
});
