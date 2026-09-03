import { createLauncherHintController } from '../ui/launcher_hint_controller';
import { createControllerFocusHint } from './controller_focus_hint';
import type { GamepadBindingEntry } from './gamepad_bindings';
import { labelForGamepadAction } from './gamepad_bindings';
import { GAMEPAD_CONFIRM, GAMEPAD_SUBCOMMANDS, type GamepadKind } from './gamepad_map';

export interface ControllerUiPromptSource {
  entries(): readonly GamepadBindingEntry[];
  kind(): GamepadKind;
  gameplayAllowed(): boolean;
  virtualMouse(): boolean;
}

export interface ControllerUiPromptCoordinator {
  refreshBindings(): void;
  syncFrame(): void;
  relocalize(): void;
  confirmLabel(): string | null;
  dispose(): void;
}

export function createControllerUiPromptCoordinator(
  launcherRoot: HTMLElement,
  source: ControllerUiPromptSource,
): ControllerUiPromptCoordinator {
  const launcher = createLauncherHintController(launcherRoot, source);
  const confirmLabel = () =>
    labelForGamepadAction(source.entries(), GAMEPAD_CONFIRM, source.kind());
  const subcommandsLabel = () =>
    labelForGamepadAction(source.entries(), GAMEPAD_SUBCOMMANDS, source.kind());
  const focus = createControllerFocusHint({
    confirmLabel,
    subcommandsLabel,
    gameplayAllowed: source.gameplayAllowed,
    virtualMouse: source.virtualMouse,
  });
  let virtualMouse = false;
  return {
    refreshBindings() {
      launcher.refresh();
      focus.refresh();
    },
    syncFrame() {
      const nextVirtualMouse = source.virtualMouse();
      if (virtualMouse !== nextVirtualMouse) {
        virtualMouse = nextVirtualMouse;
        launcher.setSuppressed(virtualMouse);
      }
      focus.refresh();
    },
    relocalize() {
      launcher.relocalize();
      focus.refresh();
    },
    confirmLabel,
    dispose() {
      focus.dispose();
    },
  };
}
