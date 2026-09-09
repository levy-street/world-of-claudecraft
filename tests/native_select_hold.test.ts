// @vitest-environment happy-dom
//
// The native-dropdown repaint hold (native_select_hold.ts): the module owns
// its delegated listeners over a real root, so every case here dispatches
// REAL bubbling events; the consumer behavior (holding the $WOC Exchange's
// background repaints, resuming on the pick) lives in
// tests/woc_market_window_rig.test.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createNativeSelectHold, type NativeSelectHold } from '../src/ui/native_select_hold';

afterEach(() => {
  document.body.innerHTML = '';
});

function rig(now?: () => number): {
  hold: NativeSelectHold;
  sel: HTMLSelectElement;
  outside: HTMLButtonElement;
} {
  const root = document.createElement('div');
  const sel = document.createElement('select');
  const opt = document.createElement('option');
  opt.value = 'epic';
  sel.appendChild(opt);
  root.appendChild(sel);
  const outside = document.createElement('button');
  root.appendChild(outside);
  document.body.appendChild(root);
  return { hold: createNativeSelectHold(root, now), sel, outside };
}

describe('createNativeSelectHold', () => {
  it('holds after mousedown on a focused select, releases on mousedown elsewhere', () => {
    const { hold, sel, outside } = rig();
    expect(hold.holdRepaints()).toBe(false);
    sel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    sel.focus();
    expect(hold.holdRepaints()).toBe(true);
    // A press that reached the page means no dropdown swallowed it.
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(hold.holdRepaints()).toBe(false);
  });

  it('a pick (change) releases even though the select keeps focus', () => {
    const { hold, sel } = rig();
    sel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    sel.focus();
    expect(hold.holdRepaints()).toBe(true);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(document.activeElement).toBe(sel);
    expect(hold.holdRepaints()).toBe(false);
  });

  it('never holds without focus: armed state cannot outlive the select', () => {
    const { hold, sel } = rig();
    sel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    // Armed but unfocused (a dismissal path that moved focus): no hold.
    expect(hold.holdRepaints()).toBe(false);
    sel.focus();
    expect(hold.holdRepaints()).toBe(true);
    sel.blur();
    expect(hold.holdRepaints()).toBe(false);
  });

  it('arms only for the dropdown-opening keys', () => {
    const { hold, sel } = rig();
    sel.focus();
    for (const key of [' ', 'Enter', 'ArrowDown', 'ArrowUp']) {
      sel.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      expect(hold.holdRepaints(), key).toBe(true);
    }
    sel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(hold.holdRepaints()).toBe(false);
    sel.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    sel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(hold.holdRepaints()).toBe(false);
  });

  it('a touch arms through pointerdown, with no compatibility mousedown', () => {
    // iOS and Android open the picker sheet from a tap: the pointer event is
    // the one the tap delivers directly, the mousedown after it is the
    // browser's to send or skip, and the hold must not depend on the latter.
    const { hold, sel, outside } = rig();
    sel.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    sel.focus();
    expect(hold.holdRepaints()).toBe(true);
    // On a mouse the pair agrees: the compatibility mousedown re-arms.
    sel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(hold.holdRepaints()).toBe(true);
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(hold.holdRepaints()).toBe(false);
  });

  it('a pointercancel releases it: the gesture became a scroll, no dropdown opened', () => {
    // A touch drag that begins on a select the player just picked from
    // (still focused) would otherwise hold for the whole read on mobile.
    const { hold, sel } = rig();
    sel.focus();
    sel.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(hold.holdRepaints()).toBe(true);
    sel.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
    expect(document.activeElement).toBe(sel);
    expect(hold.holdRepaints()).toBe(false);
  });

  it("a wheel reaching the page releases it, unless it is the arming flick's tail", () => {
    // A dropdown dismissed WITHOUT a pick (an outside click the popup
    // swallowed, Escape, re-picking the current value) leaves the watch armed
    // while the select keeps focus, and the reader then wheel-scrolling the
    // list is exactly who a frozen countdown would punish. A wheel that
    // reaches the page means no native popup is capturing input. A trackpad
    // flick, though, keeps delivering wheel events after the fingers lift, so
    // one arriving inside the settle window after the press leaves the arm.
    let ms = 10_000;
    const { hold, sel } = rig(() => ms);
    sel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    sel.focus();
    expect(hold.holdRepaints()).toBe(true);
    ms += 200;
    sel.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
    expect(hold.holdRepaints()).toBe(true);
    ms += 2_000;
    sel.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
    expect(document.activeElement).toBe(sel);
    expect(hold.holdRepaints()).toBe(false);
  });

  it('registers the wheel listener PASSIVE', () => {
    // A source pin, because no event can observe the option: a blocking wheel
    // listener on the window root stalls every scroll of the Exchange body.
    const source = readFileSync(join(process.cwd(), 'src/ui/native_select_hold.ts'), 'utf8');
    expect(source).toMatch(/addEventListener\(\s*'wheel',[\s\S]*?\{ passive: true \},?\s*\)/);
  });

  it('non-select interactions never arm it', () => {
    const { hold, sel, outside } = rig();
    outside.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    outside.dispatchEvent(new Event('change', { bubbles: true }));
    sel.focus();
    expect(hold.holdRepaints()).toBe(false);
  });
});
