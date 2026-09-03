import type { GamepadBindingEntry } from '../game/gamepad_bindings';
import { launcherHintView } from '../game/gamepad_launcher_hint_view';
import type { GamepadKind } from '../game/gamepad_map';
import { t } from './i18n';

export interface LauncherHintBindingSource {
  entries(): readonly GamepadBindingEntry[];
  kind(): GamepadKind;
}

export interface LauncherHintController {
  refresh(): void;
  relocalize(): void;
  setSuppressed(suppressed: boolean): void;
}

export function createLauncherHintController(
  root: HTMLElement,
  source: LauncherHintBindingSource,
): LauncherHintController {
  const key = root.querySelector<HTMLElement>('.launcher-cycle-hint-key');
  const label = root.querySelector<HTMLElement>('.launcher-cycle-hint-label');
  if (!key || !label) throw new Error('Launcher hint markup is incomplete');
  let suppressed = false;
  let available = false;

  const refresh = (): void => {
    const view = launcherHintView(source.entries(), source.kind());
    available = view !== null;
    key.textContent = view?.buttonLabel ?? '';
    label.textContent = t('hudChrome.controller.cycleHudAction');
    root.hidden = suppressed || !available;
  };

  return {
    refresh,
    relocalize: refresh,
    setSuppressed(next) {
      if (suppressed === next) return;
      suppressed = next;
      root.hidden = suppressed || !available;
    },
  };
}
