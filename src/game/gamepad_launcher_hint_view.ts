import { type GamepadBindingEntry, labelForGamepadAction } from './gamepad_bindings';
import { GAMEPAD_CYCLE_HUD, type GamepadKind } from './gamepad_map';

export interface LauncherHintView {
  buttonLabel: string;
}

export function launcherHintView(
  entries: readonly GamepadBindingEntry[],
  kind: GamepadKind,
): LauncherHintView | null {
  const buttonLabel = labelForGamepadAction(entries, GAMEPAD_CYCLE_HUD, kind);
  return buttonLabel === null ? null : { buttonLabel };
}
