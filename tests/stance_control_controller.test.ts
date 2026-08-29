// @vitest-environment happy-dom
// The touch stance control end to end over the real DOM: the anchor built from
// the shipped markup, the radial it opens, and the cast that a picked petal
// routes through. The RULES are pinned elsewhere (stance_radial_core.test.ts for
// the model, radial_gesture_core/controller for the gesture); what this file
// covers is the WIRING, which is the part a pure test cannot see: that a tap
// opens rather than casts, that a petal casts the stance that direction holds,
// and that the anchor's face follows the worn stance.

import { beforeEach, describe, expect, it } from 'vitest';
import { StanceBarController } from '../src/ui/hud/stance/stance_bar_controller';
import {
  buildStanceControl,
  type StanceControl,
} from '../src/ui/hud/stance/stance_control_controller';
import { STANCE_PETAL_DIRECTIONS, stanceRadialView } from '../src/ui/hud/stance/stance_radial_core';
import { makeWriterFacet } from '../src/ui/painter_host';
import { stanceBarView } from '../src/ui/stance_bar_view';

const STANCES = ['battle_stance', 'defensive_stance', 'berserker_stance'];

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

/** The shipped markup shape (index.html / play.html), pinned there by
 *  tests/client_shell.test.ts. */
function mount(): void {
  document.body.innerHTML = `
    <div id="mobile-action-ring">
      <button class="mobile-btn" type="button" id="mobile-stance-anchor" aria-haspopup="true" aria-expanded="false" aria-pressed="false"><span class="icon-label"></span></button>
    </div>
    <div id="mobile-stance-radial" role="group">
      ${STANCE_PETAL_DIRECTIONS.map(
        (d) =>
          `<button type="button" class="mobile-stance-petal" data-radial-dir="${d}" tabindex="-1"><span class="icon-label"></span></button>`,
      ).join('')}
      <button type="button" id="mobile-stance-cancel" tabindex="-1"></button>
    </div>`;
}

interface Rig {
  control: StanceControl;
  casts: string[];
  anchor: HTMLButtonElement;
  petals: HTMLButtonElement[];
}

function makeRig(): Rig {
  mount();
  const casts: string[] = [];
  const control = buildStanceControl({
    writers: writers(),
    iconBackground: (key) => `icon:${key}`,
    name: (id) => `name:${id}`,
    anchorName: (model) => (model.activeId === null ? 'no stance' : `stance ${model.activeId}`),
    cast: (id) => casts.push(id),
  });
  if (control === null) throw new Error('the shipped markup did not build the control');
  return {
    control,
    casts,
    anchor: control.anchor,
    petals: [...document.querySelectorAll<HTMLButtonElement>('.mobile-stance-petal')],
  };
}

function render(rig: Rig, active: string | null): void {
  rig.control.render(stanceRadialView(stanceBarView('warrior', STANCES, active)));
}

function press(el: HTMLElement, pointerId = 1): void {
  el.dispatchEvent(
    Object.assign(new MouseEvent('pointerdown', { bubbles: true, button: 0 }), {
      pointerId,
      pointerType: 'touch',
      clientX: 0,
      clientY: 0,
    }),
  );
  el.dispatchEvent(
    Object.assign(new MouseEvent('pointerup', { bubbles: true, button: 0 }), {
      pointerId,
      pointerType: 'touch',
      clientX: 0,
      clientY: 0,
    }),
  );
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('the touch stance control', () => {
  it('wears the worn stance and repaints when it changes', () => {
    const rig = makeRig();
    render(rig, STANCES[0]);
    const face = rig.anchor.querySelector<HTMLElement>('.icon-label');
    expect(face?.style.backgroundImage).toContain(`icon:${STANCES[0]}`);
    expect(rig.anchor.classList.contains('active')).toBe(true);
    expect(rig.anchor.getAttribute('aria-pressed')).toBe('true');
    expect(rig.anchor.getAttribute('aria-label')).toBe(`stance ${STANCES[0]}`);

    render(rig, STANCES[2]);
    expect(face?.style.backgroundImage).toContain(`icon:${STANCES[2]}`);
    expect(rig.anchor.getAttribute('aria-label')).toBe(`stance ${STANCES[2]}`);
  });

  it('hides the whole control for a class with no stances', () => {
    const rig = makeRig();
    rig.control.render(stanceRadialView(stanceBarView('mage', [], null)));
    expect(rig.anchor.style.display).toBe('none');
  });

  it('a bare tap OPENS the radial instead of casting, and the next press closes it', () => {
    const rig = makeRig();
    render(rig, STANCES[0]);
    press(rig.anchor);
    expect(rig.casts).toEqual([]);
    expect(rig.anchor.getAttribute('aria-expanded')).toBe('true');
    // The petals are real focusable buttons once open (WCAG 2.5.1's half of it).
    expect(rig.petals.slice(0, 2).map((p) => p.tabIndex)).toEqual([0, 0]);
    press(rig.anchor, 2);
    expect(rig.anchor.getAttribute('aria-expanded')).toBe('false');
    expect(rig.casts).toEqual([]);
  });

  it('picking a petal casts the stance THAT direction holds', () => {
    const rig = makeRig();
    render(rig, STANCES[0]);
    press(rig.anchor);
    // Warriors know three stances, so 'up' and 'right' hold the two the anchor
    // is not wearing, in the shared model's order.
    rig.petals[0].click();
    expect(rig.casts).toEqual([STANCES[1]]);
    expect(rig.anchor.getAttribute('aria-expanded')).toBe('false');

    press(rig.anchor, 2);
    rig.petals[1].click();
    expect(rig.casts).toEqual([STANCES[1], STANCES[2]]);
  });

  it('a direction with no stance on it is hidden, out of the a11y tree and inert', () => {
    const rig = makeRig();
    render(rig, STANCES[0]);
    // Two alternatives, four directions: the last two hold nothing.
    expect(rig.petals[2].style.display).toBe('none');
    expect(rig.petals[2].getAttribute('aria-hidden')).toBe('true');
    press(rig.anchor);
    rig.petals[3].click();
    expect(rig.casts).toEqual([]);
  });

  // A sticky open moves focus onto the first petal in the same call, and a petal
  // the frame has not painted yet is display:none and refuses it. The control
  // rides Hud's frame for its ordinary paints, so it hands the shared gesture a
  // repaint of its own for this one moment.
  it('paints the radial before focus lands on the first petal', () => {
    const rig = makeRig();
    render(rig, STANCES[0]);
    const overlay = document.getElementById('mobile-stance-radial') as HTMLElement;
    expect(overlay.classList.contains('open')).toBe(false);
    let openAtFocus: boolean | null = null;
    const focus = rig.petals[0].focus.bind(rig.petals[0]);
    rig.petals[0].focus = () => {
      openAtFocus = overlay.classList.contains('open');
      focus();
    };

    press(rig.anchor);
    expect(openAtFocus).toBe(true);
    expect(document.activeElement).toBe(rig.petals[0]);
    // And the petal was seated by that same paint rather than left at the origin.
    expect(rig.petals[0].style.left).not.toBe('');
  });

  it('re-reads the live model at press time, so a stance switch is never stale', () => {
    const rig = makeRig();
    render(rig, STANCES[0]);
    // The player switches by some other route (a keybind, the cross hotbar).
    render(rig, STANCES[1]);
    press(rig.anchor);
    // 'up' now holds the FIRST stance, because the worn one moved to the anchor.
    rig.petals[0].click();
    expect(rig.casts).toEqual([STANCES[0]]);
  });
});

// The owning controller's ONE host-shaped decision: which shape this build wears.
// Everything else it does (the row's markup, classes, tooltips and click path) is
// a verbatim move out of hud.ts and stays covered by stance_bar_view.test.ts.
describe('StanceBarController chooses the shape', () => {
  function makeBar(isMobileLayout: boolean) {
    mount();
    const bar = document.createElement('div');
    bar.id = 'stancebar';
    document.body.append(bar);
    const casts: string[] = [];
    const controller = new StanceBarController({
      writers: writers(),
      bar,
      world: () => ({
        playerClass: 'warrior',
        known: STANCES.map((id) => ({ def: { id, exclusiveGroup: 'warrior_stance' } })) as never,
        auras: [{ id: STANCES[0], sourceId: 7 }] as never,
        ownerId: 7,
      }),
      isMobileLayout: () => isMobileLayout,
      iconBackground: (key) => `icon:${key}`,
      abilityName: (known) => `name:${known.def.id}`,
      anchorName: (stance) => `stance ${stance ?? 'none'}`,
      abilityTooltip: () => 'tip',
      attachTooltip: () => {},
      hideTooltip: () => {},
      consumePeekGuard: () => false,
      clickSfx: () => {},
      cast: (id) => casts.push(id),
    });
    return { controller, bar, casts, anchor: document.getElementById('mobile-stance-anchor') };
  }

  it('builds the desktop row and leaves it byte-identical', () => {
    const rig = makeBar(false);
    rig.controller.render();
    expect(rig.bar.style.display).toBe('flex');
    const buttons = [
      ...rig.bar.querySelectorAll<HTMLButtonElement>('.stancebar-group .stance-btn'),
    ];
    expect(buttons).toHaveLength(STANCES.length);
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    expect(buttons[0].title).toBe(`name:${STANCES[0]}`);
    buttons[1].click();
    expect(rig.casts).toEqual([STANCES[1]]);
  });

  it('stands the row down on touch and wears the anchor instead', () => {
    const rig = makeBar(true);
    rig.controller.render();
    // The inline write is what outranks any display the desktop path left behind
    // on a mid-session flip; the sheet's own display:none is the belt.
    expect(rig.bar.style.display).toBe('none');
    expect(rig.bar.querySelector('.stance-btn')).toBeNull();
    expect(rig.anchor?.getAttribute('aria-label')).toBe(`stance name:${STANCES[0]}`);
  });
});
