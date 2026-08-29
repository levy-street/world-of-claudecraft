// Real-browser regression for the touch stance control and the bottom-centre
// column it shares a screen with. Composes the shipped markup shape, the real
// mobile stylesheet, the placement core and the stance painter, so what a unit
// test cannot see is pinned against real layout: the anchor renders as ONE
// circle whose centre sits on the button row's line with Jump and the Quick
// Actions control, its radial opens with the alternatives on the four
// directions and stays on screen, picking one switches the face the anchor
// wears, and the pet health frame sits BELOW the player frame with real
// clearance at both ends.

import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { placeRadial } from '../../src/ui/hud/action_bar/radial_action_core';
import {
  STANCE_PETAL_DIRECTIONS,
  stanceRadialView,
} from '../../src/ui/hud/stance/stance_radial_core';
import { StanceRadialPainter } from '../../src/ui/hud/stance/stance_radial_painter';
import { resolveMobileHudLayout } from '../../src/ui/mobile_hud_layout';
import { makeWriterFacet } from '../../src/ui/painter_host';
import { stanceBarView } from '../../src/ui/stance_bar_view';
import '../../src/styles/index.css';
import { cleanup } from './_harness';

// Both are real landscape phone viewports the touch HUD ships to: 844x390 is the
// iPhone 14/15 class and 874x402 the iPhone 16 Pro. Portrait is not a supported
// in-game layout (the #rotate-device gate), so landscape is the whole matrix.
const VIEWPORTS = [
  { label: '844x390', width: 844, height: 390 },
  { label: '874x402', width: 874, height: 402 },
] as const;

const STANCES = ['battle_stance', 'defensive_stance', 'berserker_stance'];
/** Centres are compared against the row line with a sub-pixel tolerance: the
 *  seat is derived in CSS calc() from the same literals Jump's is. */
const CENTRE_TOLERANCE_PX = 0.6;
/** WCAG 2.2 SC 2.5.8's absolute minimum. The anchor is a --menu-btn-size circle
 *  and clears the preferred 40px floor; the pet frame is the documented
 *  trade-down this tier already ships. */
const MIN_TARGET_PX = 24;

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

/** The shipped structure: the ring holding Jump and the stance anchor, the Quick
 *  Actions control beside it, and the stance radial as a SIBLING overlay,
 *  matching index.html / play.html. */
function mountControls() {
  const controls = document.createElement('section');
  controls.id = 'mobile-controls';
  controls.innerHTML = `
    <div id="mobile-move-zone"></div>
    <div id="mobile-move-joystick" class="mobile-joystick"><div id="mobile-move-stick" class="mobile-stick"></div></div>
    <div id="mobile-combat-controls">
      <button class="mobile-btn" type="button" id="mobile-menu-anchor"></button>
    </div>
    <div id="mobile-action-ring">
      <button type="button" id="mobile-action-attack"></button>
      <button type="button" id="mobile-interact"></button>
      <button type="button" id="mobile-jump"></button>
      <button class="mobile-btn" type="button" id="mobile-stance-anchor" aria-haspopup="true" aria-expanded="false" aria-pressed="false"><span class="icon-label"></span></button>
    </div>
    <div id="mobile-stance-radial" role="group">
      ${STANCE_PETAL_DIRECTIONS.map(
        (d) =>
          `<button type="button" class="mobile-stance-petal" data-radial-dir="${d}" tabindex="-1"><span class="icon-label"></span></button>`,
      ).join('')}
      <button type="button" id="mobile-stance-cancel" tabindex="-1"></button>
    </div>`;
  document.body.appendChild(controls);
  const el = (id: string) => controls.querySelector(`#${id}`) as HTMLElement;
  return {
    controls,
    menuAnchor: el('mobile-menu-anchor'),
    jump: el('mobile-jump'),
    attack: el('mobile-action-attack'),
    moveZone: el('mobile-move-zone'),
    anchor: el('mobile-stance-anchor') as HTMLButtonElement,
    anchorIcon: controls.querySelector('#mobile-stance-anchor .icon-label') as HTMLElement,
    overlay: el('mobile-stance-radial'),
    cancel: el('mobile-stance-cancel'),
    petals: [...controls.querySelectorAll<HTMLElement>('.mobile-stance-petal')].map((btn) => ({
      btn,
      icon: btn.querySelector('.icon-label') as HTMLElement,
    })),
  };
}

/** The bottom-centre column, in its shipped nesting: the player frame on the row
 *  line with the pet health frame hanging below it. Real content, because both
 *  frames' rendered heights are content-driven and then scaled, and the seat
 *  under test is about the gap between them. */
function mountColumn() {
  const ui = document.createElement('div');
  ui.id = 'ui';
  ui.innerHTML = `
    <div id="bottom-bar"><div id="actionbar-row"><div id="actionbar-stack">
      <div id="pet-cluster">
        <div id="petbar" class="panel"><div class="petbar-group">
          <button type="button" class="pet-btn"></button>
          <button type="button" class="pet-btn"></button>
          <button type="button" class="pet-btn"></button>
        </div></div>
        <div id="pet-frame" class="unitframe">
          <div class="portrait-wrap"><div class="portrait"><canvas width="54" height="54"></canvas></div></div>
          <div class="uf-bars">
            <div class="uf-name">Snarl</div>
            <div class="bar hp"><div class="bar-fill"></div></div>
          </div>
        </div>
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
      </div></div>
    </div></div></div>`;
  document.body.appendChild(ui);
  const el = (id: string) => ui.querySelector(`#${id}`) as HTMLElement;
  // Both pet surfaces are JS-flipped to flex by their own renderers, so the
  // fixture flips them the same way: the CSS seats under test only apply once
  // the element renders.
  const petFrame = el('pet-frame');
  const petBar = el('petbar');
  petFrame.style.display = 'flex';
  petBar.style.display = 'flex';
  return { ui, playerFrame: el('player-frame'), petFrame, petBar, stancebar: el('stancebar') };
}

interface Viewport {
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

async function setViewport(vp: Viewport) {
  await page.viewport(vp.width, vp.height);
  document.body.className = `mobile-touch game-active ${tierClasses(vp.width, vp.height)}`;
  document.body.style.setProperty('--app-vw', `${vp.width}px`);
  document.body.style.setProperty('--app-vh', `${vp.height}px`);
}

/** Seat the radial exactly as RadialGesture does, then paint it open. */
function openRadial(
  rig: ReturnType<typeof mountControls>,
  model: ReturnType<typeof stanceRadialView>,
  vp: Viewport,
) {
  const painter = new StanceRadialPainter(writers(), rig, {
    iconBackground: (key) =>
      `data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==#${key}`,
    name: (id) => id,
    anchorName: (m) => `stance ${m.activeId ?? 'none'}`,
  });
  painter.paintAnchor(model);
  const box = rig.anchor.getBoundingClientRect();
  const style = getComputedStyle(rig.overlay);
  const petalSize = box.width;
  const placement = placeRadial({
    buttonCx: box.x + box.width / 2,
    buttonCy: box.y + box.height / 2,
    viewportWidth: Number.parseFloat(style.getPropertyValue('--app-vw')) || vp.width,
    viewportHeight: Number.parseFloat(style.getPropertyValue('--app-vh')) || vp.height,
    radius: petalSize * Number.parseFloat(style.getPropertyValue('--radial-radius-ratio')),
    petalHalf: petalSize / 2,
    margin: Number.parseFloat(style.getPropertyValue('--radial-margin')),
  });
  painter.paintOpen(placement, STANCE_PETAL_DIRECTIONS[0], false);
  return { painter, placement };
}

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

afterEach(() => {
  cleanup();
  document.body.className = '';
  document.body.style.removeProperty('--app-vw');
  document.body.style.removeProperty('--app-vh');
});

describe('the touch stance control seats on the button row', () => {
  for (const vp of VIEWPORTS) {
    it(`${vp.label}: the anchor's centre is on Jump's and Quick Actions' line`, async () => {
      await setViewport(vp);
      const rig = mountControls();
      const anchor = rig.anchor.getBoundingClientRect();
      const jump = rig.jump.getBoundingClientRect();
      const menu = rig.menuAnchor.getBoundingClientRect();
      const centre = (r: DOMRect) => r.y + r.height / 2;
      // The SAME assertion the menu control's own seat holds: three circles, one
      // line. The anchor derives its `bottom` from Jump's expression, so this
      // fails the moment either side is re-tuned alone.
      expect(Math.abs(centre(anchor) - centre(jump))).toBeLessThan(CENTRE_TOLERANCE_PX);
      expect(Math.abs(centre(anchor) - centre(menu))).toBeLessThan(CENTRE_TOLERANCE_PX);
      // A real circle, comfortably past the preferred 40px touch floor.
      expect(anchor.width).toBeGreaterThanOrEqual(40);
      expect(Math.abs(anchor.width - anchor.height)).toBeLessThan(0.5);
    });

    it(`${vp.label}: the anchor keeps a clear circle from Jump and the bottom column`, async () => {
      await setViewport(vp);
      const rig = mountControls();
      const column = mountColumn();
      const anchor = rig.anchor.getBoundingClientRect();
      // A real GAP from Jump on one side and the player frame on the other: this
      // span is the only one on the row line wide enough for the control, so a
      // regression on either neighbour lands here.
      expect(anchor.right).toBeLessThan(rig.jump.getBoundingClientRect().left);
      expect(anchor.left).toBeGreaterThan(column.playerFrame.getBoundingClientRect().right);
      expect(overlaps(anchor, rig.moveZone.getBoundingClientRect())).toBe(false);
      expect(overlaps(anchor, rig.attack.getBoundingClientRect())).toBe(false);
      // And on screen at both ends.
      expect(anchor.bottom).toBeLessThanOrEqual(vp.height);
      expect(anchor.right).toBeLessThanOrEqual(vp.width);
    });
  }
});

describe('the stance radial opens with the alternatives', () => {
  it('844x390: the petals hold the stances the anchor is not wearing, on screen', async () => {
    const vp = VIEWPORTS[0];
    await setViewport(vp);
    const rig = mountControls();
    const model = stanceRadialView(stanceBarView('warrior', STANCES, STANCES[0]));
    openRadial(rig, model, vp);
    expect(rig.overlay.classList.contains('open')).toBe(true);
    // Two alternatives on the first two directions; the other two stay down.
    const open = rig.petals.filter((p) => getComputedStyle(p.btn).display !== 'none');
    expect(open).toHaveLength(2);
    for (const petal of open) {
      const box = petal.btn.getBoundingClientRect();
      expect(box.width).toBeGreaterThanOrEqual(MIN_TARGET_PX);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(vp.width);
      expect(box.bottom).toBeLessThanOrEqual(vp.height);
    }
    // The cancel target sits ON the anchor's own centre, so releasing where the
    // gesture started backs out. placeRadial clamps the origin inward at an
    // edge, which is exactly what keeps the petals on screen above.
    const cancel = rig.cancel.getBoundingClientRect();
    expect(cancel.width).toBeGreaterThanOrEqual(MIN_TARGET_PX);
    expect(cancel.right).toBeLessThanOrEqual(vp.width);
  });

  it('844x390: picking a stance switches the face the anchor wears', async () => {
    const vp = VIEWPORTS[0];
    await setViewport(vp);
    const rig = mountControls();
    const before = stanceRadialView(stanceBarView('warrior', STANCES, STANCES[0]));
    const { painter } = openRadial(rig, before, vp);
    expect(rig.anchorIcon.style.backgroundImage).toContain(STANCES[0]);
    const firstPetalIcon = rig.petals[0].icon.style.backgroundImage;
    expect(firstPetalIcon).toContain(STANCES[1]);

    // The cast lands and the world reports the new stance: the anchor now wears
    // it and the petal it came from holds the stance just left behind.
    painter.paintAnchor(stanceRadialView(stanceBarView('warrior', STANCES, STANCES[1])));
    expect(rig.anchorIcon.style.backgroundImage).toContain(STANCES[1]);
    expect(rig.petals[0].icon.style.backgroundImage).toContain(STANCES[0]);
    expect(rig.anchor.getAttribute('aria-label')).toContain(STANCES[1]);
  });
});

describe('the pet health frame hangs below the player frame', () => {
  for (const vp of VIEWPORTS) {
    it(`${vp.label}: seated under the frame, clear of it and of the screen edge`, async () => {
      await setViewport(vp);
      const rig = mountControls();
      const column = mountColumn();
      const player = column.playerFrame.getBoundingClientRect();
      const pet = column.petFrame.getBoundingClientRect();
      // BELOW, with a real gap: the old seat was ABOVE the frame at
      // --mobile-button-row-lift + 24px, sharing the stance row's slot.
      expect(pet.top).toBeGreaterThan(player.bottom);
      expect(overlaps(pet, player)).toBe(false);
      // And inside the screen: the band it drops into is the row-lift token,
      // which already carries env(safe-area-inset-bottom).
      expect(pet.bottom).toBeLessThanOrEqual(vp.height);
      expect(pet.height).toBeGreaterThanOrEqual(MIN_TARGET_PX);
      // Clear of the two things that share the bottom band with it.
      expect(overlaps(pet, rig.moveZone.getBoundingClientRect())).toBe(false);
      expect(overlaps(pet, rig.jump.getBoundingClientRect())).toBe(false);
      // The stance anchor is disjoint by CLASS (warrior/paladin versus a
      // permanent pet), but the seat must not depend on that, so pin it anyway.
      expect(overlaps(pet, rig.anchor.getBoundingClientRect())).toBe(false);
    });
  }

  it('740x360: the narrowest landscape phone still fits both, with room at each end', async () => {
    // The tightest profile the touch HUD ships to (galaxy-s8 class), where the
    // centred column is nudged to 50% - 44px to clear Jump's crescent. It is the
    // binding case for BOTH seats: the row line's free span between the player
    // frame and Jump, and the band under the frame.
    const vp = { label: '740x360', width: 740, height: 360 } as const;
    await setViewport(vp);
    const rig = mountControls();
    const column = mountColumn();
    const anchor = rig.anchor.getBoundingClientRect();
    const player = column.playerFrame.getBoundingClientRect();
    const pet = column.petFrame.getBoundingClientRect();
    expect(anchor.left).toBeGreaterThan(player.right);
    expect(anchor.right).toBeLessThan(rig.jump.getBoundingClientRect().left);
    expect(pet.top).toBeGreaterThan(player.bottom);
    expect(pet.bottom).toBeLessThanOrEqual(vp.height);
    expect(overlaps(pet, rig.moveZone.getBoundingClientRect())).toBe(false);
  });

  it('844x390: the pet COMMAND bar is untouched at the top of the screen', async () => {
    const vp = VIEWPORTS[0];
    await setViewport(vp);
    const column = mountColumn();
    const bar = column.petBar.getBoundingClientRect();
    // Only the health frame moved. The command bar keeps its top-centre seat,
    // under the thumb, and must not follow the frame down into the bottom band.
    expect(bar.top).toBeLessThan(vp.height / 4);
    expect(overlaps(bar, column.playerFrame.getBoundingClientRect())).toBe(false);
    expect(overlaps(bar, column.petFrame.getBoundingClientRect())).toBe(false);
  });

  it('844x390: the desktop stance ROW stands down on touch', async () => {
    const vp = VIEWPORTS[0];
    await setViewport(vp);
    const column = mountColumn();
    // The anchor is the touch shape, and drawing both would show the same choice
    // twice. The sheet is the belt (nothing flashes before the first frame runs)
    // and stance_bar_controller.ts writes the inline display:none that outranks
    // any display the desktop path left behind (pinned in
    // tests/stance_control_controller.test.ts).
    column.stancebar.style.removeProperty('display');
    expect(getComputedStyle(column.stancebar).display).toBe('none');
  });
});
