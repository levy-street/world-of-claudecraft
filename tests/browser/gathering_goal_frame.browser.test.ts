// Real-browser regression for the gathering goal tracker's MovableFrame wiring
// (Intentional Gathering PR4 x "Unlock interface"). Drives the production
// `InterfaceUnlock` + `MovableFrame` + `makeUiRootDetacher` trio over the real
// `HUD_FRAME_SPECS` `gatheringGoalTracker` row, against the real CSS cascade
// (`src/styles/index.css`), never a hand-toggled class or a fake reset.
//
// Proves: (1) an empty tracker stays invisible and locked, then gains the
// unlocked move affordance at a real touch target; (2) a real keyboard move
// on the corner button detaches the panel to #ui with an absolute,
// width-bounded box; (3) the docked corner button is anchored to the panel
// and hit-testable past its own top-right edge, with a visible focus ring;
// (4) resetAll re-docks the panel, drops the saved spot, and the tracked
// content stays scrollable (via #gathering-goal-body, not the panel, once
// unlocked) both before and after the reset round trip.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import '../../src/styles/index.css';
import { InterfaceUnlock, makeUiRootDetacher } from '../../src/ui/interface_unlock';
import { HUD_FRAME_SPECS } from '../../src/ui/interface_unlock_core';
import { MovableFrame } from '../../src/ui/movable_frame';

const SPEC =
  HUD_FRAME_SPECS.find((s) => s.id === 'gatheringGoalTracker') ??
  (() => {
    throw new Error('gatheringGoalTracker row missing from HUD_FRAME_SPECS');
  })();

// Every mover created by a test is tracked here so afterEach can dispose it
// for real, instead of relying on document.body.innerHTML wiping listeners.
const movers: MovableFrame[] = [];

function mountTracker() {
  const root = document.createElement('div');
  root.id = 'ui';
  const stack = document.createElement('div');
  stack.id = 'right-tracker-stack';
  const panel = document.createElement('div');
  panel.id = SPEC.elementId;
  panel.className = 'gathering-goal-panel';
  const body = document.createElement('div');
  body.id = 'gathering-goal-body';
  panel.appendChild(body);
  stack.appendChild(panel);
  root.appendChild(stack);
  document.body.appendChild(root);
  return { root, stack, panel, body };
}

function mountMover(panel: HTMLElement) {
  const unlock = new InterfaceUnlock({ document });
  const detach = makeUiRootDetacher(document, SPEC, panel);
  const mover = new MovableFrame({
    frame: panel,
    storageKey: SPEC.storageKey,
    unlockLabelKey: 'hudChrome.interfaceUnlock.unlockFrame',
    lockLabelKey: 'hudChrome.interfaceUnlock.lockFrame',
    resizeLabelKey: 'hudChrome.interfaceUnlock.resizeFrame',
    frameLabelKey: () => 'hudChrome.gatheringGoal.title',
    draggingBodyClass: 'hud-frame-dragging',
    fallbackSize: SPEC.fallbackSize,
    isMobileLayout: () => false,
    scalable: true,
    buttonOnlyWhenUnlocked: true,
    onPositioned: detach,
  });
  unlock.register({ id: SPEC.id, mover, isActive: () => true });
  movers.push(mover);
  return { unlock, mover };
}

function moveRightWithKeyboard(btn: HTMLButtonElement, presses = 20): void {
  btn.focus();
  for (let i = 0; i < presses; i++) {
    btn.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, composed: true }),
    );
  }
}

describe('gathering goal tracker: real MovableFrame + InterfaceUnlock wiring', () => {
  let savedBodyClassName = '';

  beforeEach(() => {
    savedBodyClassName = document.body.className;
    document.body.innerHTML = '';
    localStorage.removeItem(SPEC.storageKey);
    document.body.className = 'game-active';
  });

  afterEach(() => {
    movers.splice(0).forEach((mover) => {
      mover.dispose();
    });
    document.body.innerHTML = '';
    localStorage.removeItem(SPEC.storageKey);
    document.body.className = savedBodyClassName;
  });

  it('stays invisible and locked when empty, then gains the unlocked move affordance at >=48px', () => {
    const { panel } = mountTracker();
    const { unlock } = mountMover(panel);

    expect(getComputedStyle(panel).display).toBe('none');

    unlock.setUnlocked(true);
    const unlockedStyle = getComputedStyle(panel);
    expect(unlockedStyle.display).not.toBe('none');
    expect(parseFloat(unlockedStyle.minHeight)).toBeGreaterThanOrEqual(48);
    expect(unlockedStyle.outlineStyle).toBe('dashed');
    expect(unlockedStyle.touchAction).toBe('none');

    unlock.setUnlocked(false);
    expect(getComputedStyle(panel).display).toBe('none');
  });

  it('detaches to #ui with an absolute, width-bounded box on a real keyboard move', () => {
    const { root, panel } = mountTracker();
    const { unlock } = mountMover(panel);
    unlock.setUnlocked(true);

    const btn = panel.querySelector<HTMLButtonElement>('.tf-move-btn');
    if (!btn) throw new Error('corner move button missing');
    moveRightWithKeyboard(btn);

    expect(panel.classList.contains('hud-frame-detached')).toBe(true);
    expect(panel.parentElement).toBe(root);
    expect(getComputedStyle(panel).position).toBe('absolute');
    expect(parseFloat(getComputedStyle(panel).width)).toBe(240);
  });

  it('anchors the docked corner button to the panel, hit-testable past its top-right edge with a focus ring', () => {
    const { panel } = mountTracker();
    const { unlock } = mountMover(panel);
    unlock.setUnlocked(true);

    expect(getComputedStyle(panel).position).toBe('relative');
    expect(getComputedStyle(panel).overflow).toBe('visible');

    const btn = panel.querySelector<HTMLButtonElement>('.tf-move-btn');
    if (!btn) throw new Error('corner move button missing');
    const panelRect = panel.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    // The move button sits astride the panel's own top-right corner; only
    // `overflow: visible` on the panel keeps the overhang hit-testable
    // instead of clipped by the scroll box.
    expect(btnRect.top).toBeLessThan(panelRect.top);
    expect(btnRect.right).toBeGreaterThan(panelRect.right);

    // The real tracker stack docks away from the viewport edge, so a
    // point just past the panel corner still hits the button overhang.
    const x = panelRect.right + 3;
    const y = panelRect.top + 2;
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(window.innerWidth);
    expect(y).toBeLessThanOrEqual(window.innerHeight);
    expect(x).toBeGreaterThanOrEqual(btnRect.left);
    expect(x).toBeLessThanOrEqual(btnRect.right);
    expect(y).toBeGreaterThanOrEqual(btnRect.top);
    expect(y).toBeLessThanOrEqual(btnRect.bottom);
    expect(document.elementFromPoint(x, y)).toBe(btn);

    btn.focus();
    expect(document.activeElement).toBe(btn);
    const btnStyle = getComputedStyle(btn);
    expect(btnStyle.outlineStyle).toBe('solid');
    // The shared shell focus rule overrides the local 2px mover ring.
    expect(parseFloat(btnStyle.outlineWidth)).toBe(3);
  });

  it('resetAll re-docks the panel, drops the saved spot, and keeps content scrollable', () => {
    const { root, stack, panel, body } = mountTracker();
    // Force the visible, populated state a real fetch would set, then give
    // every row a fixed flex-basis so the flex column cannot shrink them to fit.
    panel.style.display = 'flex';
    for (let i = 0; i < 40; i++) {
      const row = document.createElement('div');
      row.textContent = 'reagent row';
      row.style.flex = '0 0 20px';
      body.appendChild(row);
    }
    const { unlock } = mountMover(panel);

    // Locked: the panel itself is the scroll container.
    expect(panel.scrollHeight).toBeGreaterThan(panel.clientHeight);
    panel.scrollTop = 10;
    expect(panel.scrollTop).toBeGreaterThan(0);
    panel.scrollTop = 0;

    unlock.setUnlocked(true);
    const btn = panel.querySelector<HTMLButtonElement>('.tf-move-btn');
    if (!btn) throw new Error('corner move button missing');
    moveRightWithKeyboard(btn);
    expect(panel.parentElement).toBe(root);

    // Unlocked: the panel stops scrolling (overflow: visible, for the corner
    // button above) and #gathering-goal-body takes over the 40vh cap.
    const bodyStyle = getComputedStyle(body);
    expect(bodyStyle.overflowY).toBe('auto');
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
    expect(parseFloat(bodyStyle.maxHeight)).toBeLessThanOrEqual(window.innerHeight * 0.4 + 1);
    body.scrollTop = 10;
    expect(body.scrollTop).toBeGreaterThan(0);
    const scrollHeightBeforeReset = body.scrollHeight;

    unlock.resetAll();
    expect(panel.classList.contains('hud-frame-detached')).toBe(false);
    expect(panel.parentElement).toBe(stack);
    expect(localStorage.getItem(SPEC.storageKey)).toBeNull();
    expect(body.childElementCount).toBe(40);
    expect(panel.style.display).toBe('flex');

    // Locked again: the panel is back to being the real scroll container,
    // and the unlocked-only body scroll rule no longer applies.
    expect(getComputedStyle(panel).overflowY).toBe('auto');
    expect(panel.scrollHeight).toBeGreaterThan(panel.clientHeight);
    expect(getComputedStyle(body).overflowY).toBe('visible');

    // Unlocking again proves the content survived the detach/re-dock/reset
    // round trip and is still scrollable, not just visually present.
    unlock.setUnlocked(true);
    expect(body.scrollHeight).toBe(scrollHeightBeforeReset);
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
  });
});
