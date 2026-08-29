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
  // True while the stick is deflected past the deadzone this frame, independent
  // of whether the scaled yaw/pitch happen to compute to zero (a zero `dt` or
  // `speed` would otherwise mask a real deflection). Lets a consumer drive a
  // "look active" signal (see Input.setGamepadLookActive) off the raw stick
  // state rather than the scaled delta.
  active: boolean;
}

export type PadCastHold =
  | { kind: 'slot'; slot: number }
  | { kind: 'xhb'; action: { type: 'ability' | 'item'; id: string } };

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
// unchanged; only the shown text differs. Like GAMEPAD_BUTTON_LABELS these are
// hardware names, not t() keys.
export type GamepadKind = 'xbox' | 'playstation' | 'nintendo' | 'generic';

/** Translate the persisted Controller-panel choice into a concrete label family.
 *  Zero is Auto and therefore leaves the detected kind in charge. */
export function gamepadKindOverride(value: number): GamepadKind | null {
  if (value === 1) return 'xbox';
  if (value === 2) return 'playstation';
  if (value === 3) return 'nintendo';
  return null;
}

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

// USB vendor ids for the three console brands. Some platform controller layers
// expose the numeric vendor in decimal rather than the usual four-digit hex, so
// both representations are accepted.
const VENDOR_ID: Record<string, GamepadKind> = {
  '054c': 'playstation', // Sony
  '045e': 'xbox', // Microsoft
  '057e': 'nintendo', // Nintendo
  '1356': 'playstation', // Sony, decimal 0x054c
  '1118': 'xbox', // Microsoft, decimal 0x045e
  '1406': 'nintendo', // Nintendo, decimal 0x057e
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
  if (/xbox|x-box|xinput|microsoft/.test(s)) return 'xbox';
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
// through the same InputCallbacks) plus four specials Keybinds doesn't model:
//   'escape':          open/close the game menu (Escape is never a keyboard bind)
//   'zoomIn'/'zoomOut': step the camera distance, gamepad-only (camera zoom has no
//                       keyboard bind, only mouse wheel and touch pinch); handled
//                       in GamepadManager.dispatch() straight against Input.zoomBy,
//                       so they never reach the host's onAction callback.
//   'none':            explicitly unbound
// 'jump' and 'autorun' are real Keybinds ids and handled by Input directly.
export type GamepadActionId = string;
export const GAMEPAD_NONE = 'none';
// Press the focused UI control: the pad's left-mouse-button equivalent. Handled
// in GamepadManager.dispatch() against the focus navigation, so it never reaches
// the host's keybind path (there is no keyboard action for "click").
export const GAMEPAD_CONFIRM = 'confirm';
// Cancel, the way a console MMO means it: back out of the top window, and with
// none open let the target go. Distinct from `escape`, which opens the game menu
// once there is nothing left to close.
export const GAMEPAD_CANCEL = 'cancel';
// Open the target's subcommands (the context menu a mouse gets by right-clicking),
// falling back to the map when nothing is targeted. One button, as FFXIV has it.
export const GAMEPAD_SUBCOMMANDS = 'subcommands';
// Step the pad's selection through the HUD's own components. This is the job the
// bare d-pad used to do, moved to its own button so the d-pad can cycle targets.
export const GAMEPAD_CYCLE_HUD = 'cycleHud';
// Swap the cross hotbar between its sets without holding anything, the way a
// console MMO spends its right bumper. The trigger-tap route stays: this is the
// standing switch, that one is the mid-hold reach.
export const GAMEPAD_CYCLE_SET = 'cycleHotbarSet';
export const GAMEPAD_ZOOM_IN = 'zoomIn';
export const GAMEPAD_ZOOM_OUT = 'zoomOut';
// Matches the step Input's mouse-wheel handler applies per notch (input.ts), so
// gamepad zoom feels identical in speed to wheel and touch pinch-to-zoom.
export const GAMEPAD_ZOOM_STEP = 1.4;

// Console-MMO default layout: left stick moves (camera-relative), right stick
// looks, face/shoulder/d-pad reach the first nine action-bar slots plus the
// staple verbs (jump, interact, target, menu). Fully remappable afterwards.
export const DEFAULT_GAMEPAD_BINDINGS: Record<number, GamepadActionId> = {
  // Face buttons follow the console-MMO convention as FFXIV spells it: bottom
  // confirms AND interacts (talk, loot), right is purely cancel, left opens the
  // target's subcommands or the map, top jumps. Interacting is deliberately NOT on
  // the right button: cancel and interact are different verbs, and pressing "back"
  // to talk to someone is the thing every console player gets wrong once.
  [GP.A]: GAMEPAD_CONFIRM,
  [GP.B]: GAMEPAD_CANCEL,
  [GP.X]: GAMEPAD_SUBCOMMANDS,
  [GP.Y]: 'jump',
  // The bumpers no longer carry ability slots (the bar owns every ability now), so
  // the right one takes the set switch it has on a console pad.
  [GP.RB]: GAMEPAD_CYCLE_SET,
  [GP.LB]: GAMEPAD_NONE,
  // LT/RT are deliberately UNBOUND: they are the cross hotbar's two modifiers, and
  // a modifier that also fires an ability reads as a random cast every time the
  // player reaches for the bar. They stay free for a player who switches the cross
  // hotbar off and wants them back.
  // The d-pad carries no bare action: it is four cross-hotbar cells, and a bare
  // press opens UI navigation instead.
  // View/Share/Minus is the inventory shortcut used by controller tutorials.
  // The right stick click takes the HUD walk, while friendly/NPC selection stays
  // on the bare d-pad, so every interface remains reachable without a pointer.
  [GP.BACK]: 'bags',
  [GP.START]: 'escape',
  [GP.L3]: 'autorun',
  [GP.R3]: GAMEPAD_CYCLE_HUD,
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
  if (v.x === 0 && v.y === 0) return { yaw: 0, pitch: 0, active: false };
  const pitchSign = invertY ? -1 : 1;
  return { yaw: -v.x * speed * dt, pitch: pitchSign * v.y * speed * dt, active: true };
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

export function fallingEdges(prev: readonly boolean[], cur: readonly boolean[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < prev.length; i++) {
    if (prev[i] && !cur[i]) out.push(i);
  }
  return out;
}
