// @vitest-environment happy-dom
// The Shardpike lean, client side: the keycaps that show the player's ACTUAL lean keys
// (src/ui/hud/shardpike/shardpike_lean_view.ts), the movement-intent fold that makes the turn
// keys and the keycaps lean while braced (src/game/lance_lean_intent.ts), and the painter's
// press-and-hold keycaps (src/ui/hud/shardpike/shardpike_bar_painter.ts).
//
// The case this exists for is the owner's layout: Q and E moved onto the action bar, which
// the keybind sweep answers by UNBINDING strafe. The beam had no stick; now the keycaps say
// A and D, and A and D lean.
import { beforeEach, describe, expect, it } from 'vitest';
import { Keybinds, keyLabel } from '../src/game/keybinds';
import { applyLanceLean, lanceLeanIntent } from '../src/game/lance_lean_intent';
import { MUSTER_SHARDPIKE_ID } from '../src/sim/lance_balance_core';
import { ShardpikeBarPainter } from '../src/ui/hud/shardpike/shardpike_bar_painter';
import { shardpikeBarState } from '../src/ui/hud/shardpike/shardpike_bar_view';
import { shardpikeLeanKeys } from '../src/ui/hud/shardpike/shardpike_lean_view';
import { shardpikePromptState } from '../src/ui/hud/shardpike/shardpike_prompt_view';
import type { PainterHostWriters } from '../src/ui/painter_host';
import type { LanceTrialView } from '../src/world_api/lance_trial';

const bits = () => ({ strafeLeft: false, strafeRight: false, turnLeft: false, turnRight: false });

describe('the lean keycaps name the live keys', () => {
  beforeEach(() => localStorage.clear());

  it('shows strafe when it is bound (the defaults: Q and E)', () => {
    expect(shardpikeLeanKeys(new Keybinds(), keyLabel)).toEqual({ left: 'Q', right: 'E' });
  });

  it('shows the turn keys once Q and E move onto the action bar and strafe is unbound', () => {
    const kb = new Keybinds();
    expect(kb.bind('slot5', 0, 'KeyQ')).toBe(true);
    expect(kb.bind('slot6', 0, 'KeyE')).toBe(true);
    expect(kb.codesForAction('strafeLeft')).toEqual([]);
    expect(kb.codesForAction('strafeRight')).toEqual([]);
    expect(shardpikeLeanKeys(kb, keyLabel)).toEqual({ left: 'A', right: 'D' });
  });

  it('follows a remap and goes blank (bare arrows) when nothing leans at all', () => {
    const kb = new Keybinds();
    kb.bind('strafeLeft', 0, 'KeyZ');
    expect(shardpikeLeanKeys(kb, keyLabel).left).toBe('Z');
    const none = { codesForAction: () => [] as string[] };
    expect(shardpikeLeanKeys(none, keyLabel)).toEqual({ left: '', right: '' });
    expect(shardpikeLeanKeys(null, keyLabel)).toEqual({ left: '', right: '' });
  });
});

describe('the movement intent folds the lean in only while braced', () => {
  beforeEach(() => {
    lanceLeanIntent.braced = false;
    lanceLeanIntent.hold = 0;
  });

  it('turn keys lean and stop turning while braced', () => {
    lanceLeanIntent.braced = true;
    const mi = applyLanceLean({ ...bits(), turnLeft: true }, lanceLeanIntent);
    expect(mi).toEqual({ strafeLeft: true, strafeRight: false, turnLeft: false, turnRight: false });
    const mr = applyLanceLean({ ...bits(), turnRight: true }, lanceLeanIntent);
    expect(mr.strafeRight).toBe(true);
    expect(mr.turnRight).toBe(false);
  });

  it('the keycap hold leans as a key would', () => {
    lanceLeanIntent.braced = true;
    lanceLeanIntent.hold = -1;
    expect(applyLanceLean(bits(), lanceLeanIntent).strafeLeft).toBe(true);
    lanceLeanIntent.hold = 1;
    expect(applyLanceLean(bits(), lanceLeanIntent).strafeRight).toBe(true);
  });

  it('is a no-op outside a brace, and drops a stale keycap hold', () => {
    lanceLeanIntent.hold = 1;
    const mi = applyLanceLean({ ...bits(), turnLeft: true }, lanceLeanIntent);
    expect(mi).toEqual({ ...bits(), turnLeft: true });
    expect(lanceLeanIntent.hold).toBe(0);
  });
});

const bracing: LanceTrialView = {
  phase: 'bracing',
  balance: 0,
  setProgress: 0.2,
  windowRemaining: 0,
};

describe('the bar and the prompt with the muster pike and the live keys', () => {
  it('shows the bar for the muster pike and carries the lean keys', () => {
    const state = shardpikeBarState({
      mainhandItemId: MUSTER_SHARDPIKE_ID,
      trial: bracing,
      restRemaining: 0,
      dead: false,
      leanKeys: { left: 'A', right: 'D' },
    });
    expect(state.visible).toBe(true);
    expect(state.leanKeys).toEqual({ left: 'A', right: 'D' });
    expect(state.buttons[0].tooltipKey).toBe('hudChrome.shardpike.braceTooltipLean');
  });

  it('names the actual keys in "hold it steady", and the muster pike in the resting line', () => {
    const steady = shardpikePromptState({
      mainhandItemId: MUSTER_SHARDPIKE_ID,
      trial: bracing,
      guidance: null,
      restRemaining: 0,
      dead: false,
      leanKeys: { left: 'A', right: 'D' },
    });
    expect(steady.bodyKey).toBe('hudChrome.shardpike.promptHoldSteadyLean');
    expect(steady.values).toEqual({ left: 'A', right: 'D' });
    const resting = shardpikePromptState({
      mainhandItemId: MUSTER_SHARDPIKE_ID,
      trial: null,
      guidance: null,
      restRemaining: 0,
      dead: false,
    });
    expect(resting.bodyKey).toBe('hudChrome.shardpike.promptFindBossMuster');
  });
});

/** Writers that just write (the painter's elision is not what this suite is about). */
const writers: PainterHostWriters = {
  setText: (el: HTMLElement, text: string) => {
    el.textContent = text;
  },
  setDisplay: (el: HTMLElement, v: string) => {
    el.style.display = v;
  },
  setAttr: (el: HTMLElement, k: string, v: string) => {
    el.setAttribute(k, v);
  },
  toggleClass: (el: HTMLElement, cls: string, on: boolean) => {
    el.classList.toggle(cls, on);
  },
  setStyleProp: (el: HTMLElement, k: string, v: string) => {
    el.style.setProperty(k, v);
  },
} as unknown as PainterHostWriters;

describe('the keycaps are press-and-hold buttons', () => {
  it('draw the keys above the beam and lean while held, by mouse or finger', () => {
    document.body.replaceChildren();
    const root = document.createElement('div');
    document.body.append(root);
    const leans: number[] = [];
    const painter = new ShardpikeBarPainter(
      writers,
      root,
      () => {},
      {},
      (h) => leans.push(h),
    );
    painter.paint(
      shardpikeBarState({
        mainhandItemId: MUSTER_SHARDPIKE_ID,
        trial: bracing,
        restRemaining: 0,
        dead: false,
        leanKeys: { left: 'A', right: 'D' },
      }),
    );
    const lean = root.querySelector('.pike-lean') as HTMLElement;
    expect(lean).not.toBeNull();
    // Above the beam: first in the column.
    expect(root.firstElementChild).toBe(lean);
    expect(lean.classList.contains('active')).toBe(true);
    const left = root.querySelector('.pike-lean-left') as HTMLButtonElement;
    const right = root.querySelector('.pike-lean-right') as HTMLButtonElement;
    expect(left.querySelector('.pike-lean-cap')?.textContent).toBe('A');
    expect(right.querySelector('.pike-lean-cap')?.textContent).toBe('D');
    expect(left.getAttribute('aria-label')).toContain('A');

    left.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, bubbles: true }));
    expect(left.classList.contains('held')).toBe(true);
    left.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
    right.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, bubbles: true }));
    right.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 2, bubbles: true }));
    expect(leans).toEqual([-1, 0, 1, 0]);
    expect(right.classList.contains('held')).toBe(false);
  });
});
