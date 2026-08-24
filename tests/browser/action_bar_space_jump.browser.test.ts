// Real-browser regression for "Space over a used action-bar slot only blocks
// jump, without re-casting" (a sibling of the "Space reopens the last-used
// menu" bug class): buildActionBar's per-slot keydown guard used to call
// BOTH e.preventDefault() AND e.stopPropagation() for Space. preventDefault
// correctly kills the native click-on-keyup replay (no re-cast), but
// stopPropagation ALSO stopped the keydown from ever reaching Input's
// window-level handler, so the jump-latch logic never ran either: Space over
// a focused action-bar slot did nothing at all. Runs in Browser Mode because
// proving preventDefault suppresses the native click-on-keyup replay needs a
// TRUSTED key event; a Node DOM fake cannot express that half of the bug.
//
// Mirrors the same slot fixture hud.ts's buildActionBar wires (a <button>
// whose own keydown listener preventDefaults Space without stopping
// propagation, matching PR #3438's bags-row precedent: Space always reaches
// the game's jump key, never re-triggers the row/slot's own action), driven
// against the REAL Input class exactly like tests/browser/stale_focus_space
// wires it.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { Input } from '../../src/game/input';
import { Keybinds } from '../../src/game/keybinds';

let input: Input;

beforeAll(() => {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  input = new Input(
    canvas,
    {
      onTab: () => undefined,
      onTabPrev: () => undefined,
      onTargetFriendly: () => undefined,
      onCycleFriendly: () => undefined,
      onPet: () => undefined,
      onTargetPet: () => undefined,
      onAbility: () => undefined,
      onAbilityDown: () => undefined,
      onAbilityUp: () => undefined,
      onUiKey: () => undefined,
      onEmoteWheel: () => undefined,
      onClickPick: () => undefined,
      canUseGameKeys: () => true,
    },
    new Keybinds(),
  );
  canvas.remove();
});

afterEach(async () => {
  await userEvent.keyboard('[/Space]').catch(() => undefined);
  document.body.innerHTML = '';
});

/** The exact per-slot Space wiring buildActionBar installs on every action-btn
 *  (hud.ts): the button's own click handler casts, and its keydown listener
 *  cancels Space's native default (killing the click-on-keyup replay) WITHOUT
 *  stopping propagation, so the SAME Space keydown still reaches Input for
 *  the jump key. */
function makeSlot(): { btn: HTMLButtonElement; casts: () => number } {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'action-btn';
  let casts = 0;
  btn.addEventListener('click', () => {
    casts++;
    btn.blur();
  });
  btn.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.key !== 'Spacebar') return;
    e.preventDefault();
  });
  document.body.appendChild(btn);
  return { btn, casts: () => casts };
}

describe('action-bar slot Space handling (issue: Space over a used slot only blocked jump)', () => {
  it('mouse-click a slot, then Space: no re-cast, jump requested', async () => {
    const { btn, casts } = makeSlot();
    await userEvent.click(btn);
    expect(casts()).toBe(1);
    // The slot's own click handler already blurs on cast, so Space is not
    // even reaching a focused slot here; this asserts the baseline still
    // jumps once the button is out of the way.
    await userEvent.keyboard('[Space>]');
    expect(input.readMoveInput().jump).toBe(true);
    await userEvent.keyboard('[/Space]');
    expect(casts()).toBe(1);
  });

  it('a slot left focused (Tab navigation): Space jumps and does not re-cast', async () => {
    const { btn, casts } = makeSlot();
    btn.focus();
    expect(document.activeElement).toBe(btn);
    await userEvent.keyboard('[Space>]');
    // preventDefault ran (no native click-on-keyup will fire), and the press
    // still reached Input: jump is requested on the SAME keydown.
    expect(input.readMoveInput().jump).toBe(true);
    await userEvent.keyboard('[/Space]');
    // The native activation that preventDefault killed never re-cast the slot.
    expect(casts()).toBe(0);
  });
});
