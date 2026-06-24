// Pure, host-agnostic gamepad math + the default console-MMO button layout.
// No DOM, no `navigator`, no Three.js: every function here is a deterministic
// transform so the analog-stick → movement/camera mapping and the rising-edge
// button detection can be unit-tested without a real controller (mirrors the
// pure-core split used by mobile_controls' `mapJoystickVector`). The thin
// `GamepadManager` consumer in gamepad.ts owns polling and the side effects.

/** Flags consumed by Input.readMoveInput, identical in shape to TouchMoveInput. */
export interface MoveFlags {
  forward: boolean;
  back: boolean;
  strafeLeft: boolean;
  strafeRight: boolean;
}

export interface LookDelta {
  yaw: number;
  pitch: number;
}

// --- W3C "Standard Gamepad" indices --------------------------------------
// https://w3c.github.io/gamepad/#remapping, fixed across Xbox/DualShock/Switch
// pads that report mapping === 'standard'.
export const STANDARD_BUTTON_COUNT = 17;
export const GP = {
  A: 0, B: 1, X: 2, Y: 3,
  LB: 4, RB: 5, LT: 6, RT: 7,
  BACK: 8, START: 9, L3: 10, R3: 11,
  DPAD_UP: 12, DPAD_DOWN: 13, DPAD_LEFT: 14, DPAD_RIGHT: 15,
  GUIDE: 16,
} as const;
export const AXIS = { LEFT_X: 0, LEFT_Y: 1, RIGHT_X: 2, RIGHT_Y: 3 } as const;

// Analog triggers report a 0..1 value; treat them as pressed past this point.
export const TRIGGER_THRESHOLD = 0.5;

// Hardware glyphs for the bindable buttons, shown in the Controller options panel.
// These are physical button names (silk-screened on the pad) and d-pad arrows,
// language-neutral by convention, so they render as-is and are deliberately not
// t() keys (see the hud_chrome.ts controller note). Order is the panel's display
// order. Guide/home (16) is intentionally omitted, the OS usually swallows it.
export const GAMEPAD_BUTTON_LABELS: Record<number, string> = {
  [GP.A]: 'A / Cross',
  [GP.B]: 'B / Circle',
  [GP.X]: 'X / Square',
  [GP.Y]: 'Y / Triangle',
  [GP.LB]: 'LB / L1',
  [GP.RB]: 'RB / R1',
  [GP.LT]: 'LT / L2',
  [GP.RT]: 'RT / R2',
  [GP.BACK]: 'Back / Share',
  [GP.START]: 'Start / Options',
  [GP.L3]: 'L3',
  [GP.R3]: 'R3',
  [GP.DPAD_UP]: 'D-pad ↑',
  [GP.DPAD_DOWN]: 'D-pad ↓',
  [GP.DPAD_LEFT]: 'D-pad ←',
  [GP.DPAD_RIGHT]: 'D-pad →',
};

export const BINDABLE_BUTTONS: number[] = Object.keys(GAMEPAD_BUTTON_LABELS)
  .map(Number)
  .sort((a, b) => a - b);

// Action ids reuse the keyboard Keybinds registry ids (so the gamepad dispatches
// through the same InputCallbacks) plus two specials Keybinds doesn't model:
//   'escape': open/close the game menu (Escape is never a keyboard bind)
//   'none':   explicitly unbound
// 'jump' and 'autorun' are real Keybinds ids and handled by Input directly.
export type GamepadActionId = string;
export const GAMEPAD_NONE = 'none';

// Console-MMO default layout: left stick moves (camera-relative), right stick
// looks, face/shoulder/d-pad reach the first nine action-bar slots plus the
// staple verbs (jump, interact, target, menu). Fully remappable afterwards.
export const DEFAULT_GAMEPAD_BINDINGS: Record<number, GamepadActionId> = {
  [GP.A]: 'jump',
  [GP.B]: 'interact',
  [GP.X]: 'slot0', // Attack
  [GP.Y]: 'target',
  [GP.RB]: 'slot1',
  [GP.LB]: 'slot2',
  [GP.RT]: 'slot3',
  [GP.LT]: 'slot4',
  [GP.DPAD_UP]: 'slot5',
  [GP.DPAD_RIGHT]: 'slot6',
  [GP.DPAD_DOWN]: 'slot7',
  [GP.DPAD_LEFT]: 'slot8',
  [GP.BACK]: 'map',
  [GP.START]: 'escape',
  [GP.L3]: 'autorun',
  [GP.R3]: 'targetFriendly',
};

/**
 * Radial deadzone: zero the whole vector below `dz`, then rescale the surviving
 * magnitude so it ramps 0→1 from the deadzone edge to the unit circle. Keeps
 * resting drift out while preserving full range and fine control near centre.
 */
export function applyRadialDeadzone(x: number, y: number, dz: number): { x: number; y: number } {
  const mag = Math.hypot(x, y);
  if (mag <= dz || mag === 0) return { x: 0, y: 0 };
  const scaled = (mag - dz) / (1 - dz);
  const norm = Math.min(1, scaled) / mag;
  return { x: x * norm, y: y * norm };
}

/**
 * Left-stick vector → 8-way movement flags. Mirrors mobile's mapJoystickVector:
 * past the deadzone, each axis fires once it clears 85% of the deadzone, so the
 * diagonals engage cleanly. Up on the stick (y < 0) is forward.
 */
export function stickToMoveFlags(x: number, y: number, dz: number): MoveFlags {
  const mag = Math.hypot(x, y);
  // `<` (not the `<=` applyRadialDeadzone uses) deliberately mirrors mobile's
  // mapJoystickVector gate; a value landing exactly on dz is rare and harmless,
  // so do not "unify" the two comparisons.
  if (mag < dz) return { forward: false, back: false, strafeLeft: false, strafeRight: false };
  const axis = dz * 0.85;
  return {
    forward: y < -axis,
    back: y > axis,
    strafeLeft: x < -axis,
    strafeRight: x > axis,
  };
}

/**
 * Right-stick vector → per-frame camera yaw/pitch deltas (radians). `speed` is
 * the configured turn rate; `dt` scales by frame time for resolution-independent
 * motion. Pushing the stick right turns the camera right; pushing up looks up
 * unless `invertY`. Returns zero inside the deadzone.
 */
export function stickToLook(
  x: number,
  y: number,
  dz: number,
  speed: number,
  invertY: boolean,
  dt: number,
): LookDelta {
  const v = applyRadialDeadzone(x, y, dz);
  if (v.x === 0 && v.y === 0) return { yaw: 0, pitch: 0 };
  const pitchSign = invertY ? 1 : -1;
  return { yaw: -v.x * speed * dt, pitch: pitchSign * v.y * speed * dt };
}

/** Indices of buttons that went from up→down between the previous and current
 *  pressed-state snapshots (one-shot edge actions: abilities, targeting, menus). */
export function risingEdges(prev: readonly boolean[], cur: readonly boolean[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < cur.length; i++) {
    if (cur[i] && !prev[i]) out.push(i);
  }
  return out;
}
