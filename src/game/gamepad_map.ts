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
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  BACK: 8,
  START: 9,
  L3: 10,
  R3: 11,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
  GUIDE: 16,
} as const;
export const AXIS = { LEFT_X: 0, LEFT_Y: 1, RIGHT_X: 2, RIGHT_Y: 3 } as const;

// Analog triggers report a 0..1 value; treat them as pressed past this point.
export const TRIGGER_THRESHOLD = 0.5;

// D-pad arrows are identical across every brand; defined once here and spread into
// the generic combined set below and each per-brand set, so the four glyphs have a
// single source of truth and cannot drift between the label tables.
const DPAD_LABELS: Record<number, string> = {
  [GP.DPAD_UP]: 'D-pad ↑',
  [GP.DPAD_DOWN]: 'D-pad ↓',
  [GP.DPAD_LEFT]: 'D-pad ←',
  [GP.DPAD_RIGHT]: 'D-pad →',
};

// Hardware glyphs for the bindable buttons, shown in the Controller options panel.
// These are physical button names (silk-screened on the pad) and d-pad arrows,
// language-neutral by convention, so they render as-is and are deliberately not
// t() keys (see the hud_chrome.ts controller note). This brand-neutral combined
// set is the fallback when the connected pad's brand is unknown. Order is the
// panel's display order. Guide/home (16) is intentionally omitted, the OS usually
// swallows it.
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
  ...DPAD_LABELS,
};

export const BINDABLE_BUTTONS: number[] = Object.keys(GAMEPAD_BUTTON_LABELS)
  .map(Number)
  .sort((a, b) => a - b);

// --- Per-brand button glyphs ---------------------------------------------
// The W3C standard mapping keys buttons by physical POSITION, not silk-screen:
// index 0 is always the bottom face button, 1 the right, 2 the left, 3 the top.
// That position is stable across pads, but the letter printed on it is not, so a
// single "A / Cross" label misleads a player looking at their actual controller,
// most sharply on Nintendo pads, whose A/B and X/Y are mirror-swapped versus an
// Xbox pad (the bottom button reads "B" on a Switch pad, "A" on an Xbox pad).
// We detect the brand from Gamepad.id and label each button with the glyph that
// player sees. Bindings stay position-indexed, so the DEFAULT layout is
// unchanged: "bottom face button = jump" holds on every pad; only the shown text
// differs. Like GAMEPAD_BUTTON_LABELS these are hardware names, not t() keys.
export type GamepadKind = 'xbox' | 'playstation' | 'nintendo' | 'generic';

export const GAMEPAD_BUTTON_LABELS_BY_KIND: Record<GamepadKind, Record<number, string>> = {
  generic: GAMEPAD_BUTTON_LABELS,
  xbox: {
    [GP.A]: 'A',
    [GP.B]: 'B',
    [GP.X]: 'X',
    [GP.Y]: 'Y',
    [GP.LB]: 'LB',
    [GP.RB]: 'RB',
    [GP.LT]: 'LT',
    [GP.RT]: 'RT',
    [GP.BACK]: 'View',
    [GP.START]: 'Menu',
    [GP.L3]: 'L3',
    [GP.R3]: 'R3',
    ...DPAD_LABELS,
  },
  playstation: {
    [GP.A]: 'Cross',
    [GP.B]: 'Circle',
    [GP.X]: 'Square',
    [GP.Y]: 'Triangle',
    [GP.LB]: 'L1',
    [GP.RB]: 'R1',
    [GP.LT]: 'L2',
    [GP.RT]: 'R2',
    // DualShock 4 silk-screens "Share"; DualSense renamed it "Create". Both report
    // as this one 'playstation' kind, so show both to cover either generation.
    [GP.BACK]: 'Share / Create',
    [GP.START]: 'Options',
    [GP.L3]: 'L3',
    [GP.R3]: 'R3',
    ...DPAD_LABELS,
  },
  // Face buttons carry the Nintendo silk-screen for each POSITION: the bottom
  // button (index 0) reads B, the right (1) A, the left (2) Y, the top (3) X.
  nintendo: {
    [GP.A]: 'B',
    [GP.B]: 'A',
    [GP.X]: 'Y',
    [GP.Y]: 'X',
    [GP.LB]: 'L',
    [GP.RB]: 'R',
    [GP.LT]: 'ZL',
    [GP.RT]: 'ZR',
    [GP.BACK]: 'Minus',
    [GP.START]: 'Plus',
    [GP.L3]: 'L Stick',
    [GP.R3]: 'R Stick',
    ...DPAD_LABELS,
  },
};

// USB vendor ids for the three console brands.
const VENDOR_ID: Record<string, GamepadKind> = {
  '054c': 'playstation', // Sony
  '045e': 'xbox', // Microsoft
  '057e': 'nintendo', // Nintendo
};

// Classify a controller from its Gamepad.id string. Product-NAME keywords are the
// primary signal: they are unambiguous and appear in both the Chrome format
// ("DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)")
// and the Firefox format ("054c-0ce6-DualSense Wireless Controller"). Only if no
// name matches do we fall back to the USB VENDOR id, read from its specific field
// so a matching PRODUCT id cannot be mistaken for a vendor (Chrome's "Vendor: XXXX"
// or Firefox's leading "XXXX-YYYY-" pair). Anything unrecognized returns 'generic'
// so the brand-neutral combined labels are shown.
export function detectGamepadKind(id: string): GamepadKind {
  const s = id.toLowerCase();
  if (/dualsense|dualshock|playstation/.test(s)) return 'playstation';
  if (/xbox|x-box|xinput/.test(s)) return 'xbox';
  if (/switch|joy-?con|pro controller/.test(s)) return 'nintendo';
  const vendor =
    /vendor:\s*([0-9a-f]{4})/.exec(s)?.[1] ?? /^([0-9a-f]{4})-[0-9a-f]{4}-/.exec(s)?.[1];
  return (vendor && VENDOR_ID[vendor]) || 'generic';
}

// Label for a button on a given brand, falling back to the generic combined
// label and finally to a raw index so every bindable button always renders.
export function gamepadButtonLabel(button: number, kind: GamepadKind): string {
  return (
    GAMEPAD_BUTTON_LABELS_BY_KIND[kind][button] ??
    GAMEPAD_BUTTON_LABELS_BY_KIND.generic[button] ??
    `#${button}`
  );
}

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
