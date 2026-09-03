// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';
import { createControllerUiPromptCoordinator } from '../src/game/controller_ui_prompt_coordinator';
import type { GamepadBindingEntry } from '../src/game/gamepad_bindings';
import {
  GAMEPAD_CONFIRM,
  GAMEPAD_CYCLE_HUD,
  GAMEPAD_SUBCOMMANDS,
  GP,
} from '../src/game/gamepad_map';
import { markPadActivity } from '../src/game/input_hint_mode';

function launcherRoot(): HTMLElement {
  const root = document.createElement('div');
  root.hidden = true;
  root.innerHTML = `
    <span class="launcher-cycle-hint-key"></span>
    <span class="launcher-cycle-hint-label"></span>
  `;
  document.body.append(root);
  return root;
}

describe('controller UI prompt coordinator', () => {
  let entries: GamepadBindingEntry[];

  beforeEach(() => {
    document.body.className = '';
    document.body.innerHTML = '';
    entries = [
      { button: GP.R3, action: GAMEPAD_CYCLE_HUD },
      { button: GP.A, action: GAMEPAD_CONFIRM },
      { button: GP.X, action: GAMEPAD_SUBCOMMANDS },
    ];
  });

  it('coordinates launcher, focused control, and target prompts from live bindings', () => {
    const launcher = launcherRoot();
    const focused = document.createElement('button');
    focused.className = 'pad-focus';
    document.body.append(focused);
    const target = document.createElement('div');
    target.id = 'target-frame';
    target.style.display = 'flex';
    document.body.append(target);
    let virtualMouse = false;
    const coordinator = createControllerUiPromptCoordinator(launcher, {
      entries: () => entries,
      kind: () => 'xbox',
      gameplayAllowed: () => true,
      virtualMouse: () => virtualMouse,
    });

    markPadActivity();
    coordinator.refreshBindings();
    expect(launcher.hidden).toBe(false);
    expect(launcher.querySelector('.launcher-cycle-hint-key')?.textContent).toBe('R3');
    expect(focused.getAttribute('data-pad-focus-confirm-label')).toBe('A');
    expect(target.getAttribute('data-pad-subcommands-label')).toBe('X');

    entries = entries.map((entry) =>
      entry.action === GAMEPAD_CONFIRM ? { ...entry, button: GP.B } : entry,
    );
    coordinator.refreshBindings();
    expect(focused.getAttribute('data-pad-focus-confirm-label')).toBe('B');

    virtualMouse = true;
    coordinator.syncFrame();
    expect(launcher.hidden).toBe(true);
    expect(focused.hasAttribute('data-pad-focus-confirm-label')).toBe(false);
    expect(target.hasAttribute('data-pad-subcommands-label')).toBe(false);

    virtualMouse = false;
    coordinator.syncFrame();
    expect(launcher.hidden).toBe(false);
    expect(focused.getAttribute('data-pad-focus-confirm-label')).toBe('B');
    coordinator.dispose();
  });

  it('keeps gameplay prompts hidden while spectating without hiding the launcher hint', () => {
    const launcher = launcherRoot();
    const focused = document.createElement('button');
    focused.className = 'pad-focus';
    document.body.append(focused);
    const target = document.createElement('div');
    target.id = 'target-frame';
    target.style.display = 'flex';
    document.body.append(target);
    const coordinator = createControllerUiPromptCoordinator(launcher, {
      entries: () => entries,
      kind: () => 'xbox',
      gameplayAllowed: () => false,
      virtualMouse: () => false,
    });

    markPadActivity();
    coordinator.refreshBindings();

    expect(launcher.hidden).toBe(false);
    expect(focused.getAttribute('data-pad-focus-confirm-label')).toBe('A');
    expect(target.hasAttribute('data-pad-subcommands-label')).toBe(false);
    coordinator.dispose();
  });
});
