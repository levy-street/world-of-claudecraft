// Pure, DOM-free core for the first-run camera-mode prompt (Classic vs Mouse
// Camera), shown once on world entry. It owns the option model (which mode maps to
// the mouseCamera setting, which is preselected, which is recommended) and the pure
// visibility decision; the thin painter (camera_mode_prompt.ts) renders it and wires
// the apply/persist effect. Host-agnostic: it imports nothing from game/render (only
// the compile-time TranslationKey type for the t() keys it names), so a Vitest can
// drive it directly (mirrors the pure-core split of the other HUD windows).

import type { TranslationKey } from './i18n';

/** The two camera modes offered by the first-run prompt. */
export type CameraModeId = 'classic' | 'mouse';

export interface CameraModeOption {
  id: CameraModeId;
  /** Value written to the mouseCamera BOOL setting when this option is confirmed. */
  mouseCamera: boolean;
  /** t() key for the option's short name (resolved by the painter). */
  labelKey: TranslationKey;
  /** t() key for the one-line description under the name. */
  descKey: TranslationKey;
  /** True for the option that carries the "Recommended" badge and is preselected. */
  recommended: boolean;
}

// Order is display order: Classic first, Mouse Camera second. Mouse Camera is the
// recommended, preselected option (modern free-look); Classic is the hold-to-turn
// alternative. mouseCamera:true means the setting is ON.
export const CAMERA_MODE_OPTIONS: readonly CameraModeOption[] = [
  {
    id: 'classic',
    mouseCamera: false,
    labelKey: 'hudChrome.cameraMode.classicLabel',
    descKey: 'hudChrome.cameraMode.classicDesc',
    recommended: false,
  },
  {
    id: 'mouse',
    mouseCamera: true,
    labelKey: 'hudChrome.cameraMode.mouseLabel',
    descKey: 'hudChrome.cameraMode.mouseDesc',
    recommended: true,
  },
];

// The non-option t() keys the painter renders (title/body/note/badge/confirm/dismiss).
export const CAMERA_MODE_PROMPT_KEYS = {
  title: 'hudChrome.cameraMode.title',
  body: 'hudChrome.cameraMode.body',
  note: 'hudChrome.cameraMode.note',
  recommended: 'hudChrome.cameraMode.recommended',
  confirm: 'hudChrome.cameraMode.confirm',
  dismiss: 'hudChrome.cameraMode.dismiss',
} as const;

/** The option selected when the prompt opens: Mouse Camera (recommended). */
export const DEFAULT_CAMERA_MODE: CameraModeId = 'mouse';

/** Resolve an option by id, falling back to the first option for an unknown id. */
export function cameraModeById(id: CameraModeId): CameraModeOption {
  return CAMERA_MODE_OPTIONS.find((o) => o.id === id) ?? CAMERA_MODE_OPTIONS[0];
}

export interface CameraModePromptState {
  /** The browser has already seen (and answered/dismissed) the prompt. */
  seen: boolean;
  /** The device drives the joystick touch interface (phone), where the prompt is skipped. */
  isPhone: boolean;
}

/**
 * The first-run prompt shows exactly once per browser and never on a phone touch
 * device (its camera is the on-screen joystick, not a Classic/Mouse choice).
 */
export function shouldShowCameraModePrompt(state: CameraModePromptState): boolean {
  return !state.seen && !state.isPhone;
}

/**
 * The ARIA radiogroup arrow-key model: the option to check next for a keydown, or
 * null when the key does not move the selection. Arrow Down/Right advance and
 * Up/Left retreat (both wrap around), Home/End jump to the first/last option. Pure
 * so the painter stays a thin consumer and the navigation is unit-tested directly.
 */
export function nextCameraModeForKey(current: CameraModeId, key: string): CameraModeId | null {
  const ids = CAMERA_MODE_OPTIONS.map((o) => o.id);
  const cur = ids.indexOf(current);
  if (cur < 0) return null;
  let next = -1;
  if (key === 'ArrowDown' || key === 'ArrowRight') next = (cur + 1) % ids.length;
  else if (key === 'ArrowUp' || key === 'ArrowLeft') next = (cur - 1 + ids.length) % ids.length;
  else if (key === 'Home') next = 0;
  else if (key === 'End') next = ids.length - 1;
  if (next < 0) return null;
  return ids[next];
}
