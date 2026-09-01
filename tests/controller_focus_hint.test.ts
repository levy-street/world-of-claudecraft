// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CONTROLLER_FOCUS_CONFIRM_ATTR,
  CONTROLLER_FOCUS_STATIC_ATTR,
  CONTROLLER_SUBCOMMANDS_ATTR,
  createControllerFocusHint,
} from '../src/game/controller_focus_hint';
import { markPadActivity } from '../src/game/input_hint_mode';

describe('controller focused-control hint', () => {
  beforeEach(() => {
    document.body.className = '';
    document.body.innerHTML = '';
  });

  it('tracks only the pad-owned activation control and live Confirm label', () => {
    document.body.innerHTML = '<button class="pad-focus">Bags</button><input type="text">';
    markPadActivity();
    let label: string | null = 'Cross';
    const hint = createControllerFocusHint({
      confirmLabel: () => label,
      subcommandsLabel: () => null,
      gameplayAllowed: () => true,
      virtualMouse: () => false,
    });
    const button = document.querySelector('button') as HTMLElement;

    hint.refresh();
    expect(button.getAttribute(CONTROLLER_FOCUS_CONFIRM_ATTR)).toBe('Cross');
    label = null;
    hint.refresh();
    expect(button.hasAttribute(CONTROLLER_FOCUS_CONFIRM_ATTR)).toBe(false);

    button.classList.remove('pad-focus');
    const input = document.querySelector('input') as HTMLElement;
    input.classList.add('pad-focus');
    label = 'A';
    hint.refresh();
    expect(input.hasAttribute(CONTROLLER_FOCUS_CONFIRM_ATTR)).toBe(false);
  });

  it('preserves positioned controls while giving static controls a prompt anchor', () => {
    document.body.innerHTML = '<button class="pad-focus" style="position: absolute">Close</button>';
    markPadActivity();
    const button = document.querySelector('button') as HTMLElement;
    const hint = createControllerFocusHint({
      confirmLabel: () => 'A',
      subcommandsLabel: () => null,
      gameplayAllowed: () => true,
      virtualMouse: () => false,
    });

    hint.refresh();

    expect(button.getAttribute(CONTROLLER_FOCUS_CONFIRM_ATTR)).toBe('A');
    expect(button.hasAttribute(CONTROLLER_FOCUS_STATIC_ATTR)).toBe(false);
    expect(getComputedStyle(button).position).toBe('absolute');
  });

  it('removes the label immediately on keyboard, mouse, pointer, and touch handoff', () => {
    document.body.innerHTML = '<button class="pad-focus">Bags</button>';
    markPadActivity();
    const button = document.querySelector('button') as HTMLElement;
    const hint = createControllerFocusHint({
      confirmLabel: () => 'A',
      subcommandsLabel: () => null,
      gameplayAllowed: () => true,
      virtualMouse: () => false,
    });
    hint.refresh();
    expect(button.getAttribute(CONTROLLER_FOCUS_CONFIRM_ATTR)).toBe('A');
    expect(button.hasAttribute(CONTROLLER_FOCUS_STATIC_ATTR)).toBe(true);

    for (const event of [
      new KeyboardEvent('keydown'),
      new MouseEvent('mousedown'),
      new PointerEvent('pointerdown'),
      new TouchEvent('touchstart'),
    ]) {
      Object.defineProperty(event, 'isTrusted', { value: true });
      window.dispatchEvent(event);
      expect(button.hasAttribute(CONTROLLER_FOCUS_CONFIRM_ATTR)).toBe(false);
      expect(button.hasAttribute(CONTROLLER_FOCUS_STATIC_ATTR)).toBe(false);
      markPadActivity();
      button.classList.add('pad-focus');
      hint.refresh();
    }
    hint.dispose();
  });

  it('shows contextual Subcommands on target before player alongside Confirm', () => {
    document.body.innerHTML =
      '<button class="pad-focus">Use</button><div id="target-frame"></div><div id="player-frame"></div>';
    markPadActivity();
    const target = document.getElementById('target-frame') as HTMLElement;
    const player = document.getElementById('player-frame') as HTMLElement;
    target.style.display = 'flex';
    let allowed = true;
    let mouse = false;
    let subcommands: string | null = 'X';
    const hint = createControllerFocusHint({
      confirmLabel: () => 'A',
      subcommandsLabel: () => subcommands,
      gameplayAllowed: () => allowed,
      virtualMouse: () => mouse,
    });
    hint.refresh();
    expect(document.querySelector('button')?.getAttribute(CONTROLLER_FOCUS_CONFIRM_ATTR)).toBe('A');
    expect(target.getAttribute(CONTROLLER_SUBCOMMANDS_ATTR)).toBe('X');
    expect(player.hasAttribute(CONTROLLER_SUBCOMMANDS_ATTR)).toBe(false);

    target.style.display = 'none';
    hint.refresh();
    expect(target.hasAttribute(CONTROLLER_SUBCOMMANDS_ATTR)).toBe(false);
    expect(player.getAttribute(CONTROLLER_SUBCOMMANDS_ATTR)).toBe('X');
    subcommands = null;
    hint.refresh();
    expect(player.hasAttribute(CONTROLLER_SUBCOMMANDS_ATTR)).toBe(false);
    subcommands = 'Y';
    allowed = false;
    hint.refresh();
    expect(player.hasAttribute(CONTROLLER_SUBCOMMANDS_ATTR)).toBe(false);
    allowed = true;
    mouse = true;
    hint.refresh();
    expect(player.hasAttribute(CONTROLLER_SUBCOMMANDS_ATTR)).toBe(false);
  });

  it('does not duplicate death or cross-hotbar specialized Confirm glyphs', () => {
    document.body.innerHTML =
      '<button class="pad-focus" data-gamepad-confirm-label="A">Release</button>';
    markPadActivity();
    const hint = createControllerFocusHint({
      confirmLabel: () => 'A',
      subcommandsLabel: () => null,
      gameplayAllowed: () => true,
      virtualMouse: () => false,
    });
    const death = document.querySelector('button') as HTMLElement;
    hint.refresh();
    expect(death.hasAttribute(CONTROLLER_FOCUS_CONFIRM_ATTR)).toBe(false);

    document.body.innerHTML = '<div class="xhb"><button class="pad-focus">Cast</button></div>';
    hint.refresh();
    expect(document.querySelector('button')?.hasAttribute(CONTROLLER_FOCUS_CONFIRM_ATTR)).toBe(
      false,
    );
  });
});
