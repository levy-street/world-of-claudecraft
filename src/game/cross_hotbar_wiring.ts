// The composition seam for the cross hotbar: it owns the persisted layout and
// hands the client the four small surfaces that need wiring (the pad's hold
// callback, the pad constructor argument, the settings arm, and the options
// panel's rebind hooks). It lives here rather than in main.ts because main.ts is
// a firewall, not a home (src/game/CLAUDE.md): the client carries calls, not the
// shape of a feature.

import {
  CROSS_HOTBAR_ARRANGE_CHORD,
  CROSS_HOTBAR_DPAD_GLYPHS,
  CROSS_HOTBAR_EXPANDED_SET,
  CROSS_HOTBAR_LAYER_BUTTONS,
  CROSS_HOTBAR_PRIMARY_SET,
  CROSS_HOTBAR_TRIGGERS,
  type CrossHotbarAction,
  type CrossHotbarLayer,
} from './cross_hotbar';
import { CrossHotbarBindings } from './cross_hotbar_bindings';
import { type GamepadKind, gamepadButtonLabel } from './gamepad_map';

export interface CrossHotbarHoldInfo {
  /** The armed half, or null for the resting bar (which still shows). */
  layer: CrossHotbarLayer | null;
  slots: readonly CrossHotbarAction[];
  expanded: boolean;
  /** The hardware glyph under each cell, for the connected pad's brand. */
  buttons: readonly string[];
  /** The two trigger glyphs (LT/RT, L2/R2, ZL/ZR) for the half labels. */
  triggers: { left: string; right: string };
  /** The arrange chord's own glyphs, so the way into edit mode is on the bar
   *  rather than only in the options panel. */
  arrange: { bumper: string; button: string };
}

/** The HUD surface the overlay is driven through. */
export interface CrossHotbarOverlayHost {
  setCrossHotbar(hold: CrossHotbarHoldInfo | null): void;
  refreshControllerLabels(): void;
  /** What to fill an untouched bar from: the player's action bar, plus the class
   *  abilities a pad needs that the bar does not carry (a stance is known at
   *  level one yet unbound, so a pad player could never otherwise reach it). */
  crossHotbarSeed(): { bar: readonly CrossHotbarAction[]; extras: readonly string[] };
  /** The bar's arrange surface, or null before the overlay exists. */
  crossHotbarEdit(): CrossHotbarEditSurface | null;
}

/** What arranging needs off the live bar: which cell is focused, and a place to
 *  show what is being carried. */
export interface CrossHotbarEditSurface {
  focusedCell(): number | null;
  setEditing(active: boolean, carriedFrom: number | null, carried: string | null): void;
}

/** The live pad, for the connection-driven half of pad mode. */
export interface CrossHotbarPadState {
  isConnected(): boolean;
  getKind(): GamepadKind;
}

/** The live pad the settings arm pushes to. */
export interface CrossHotbarPad extends CrossHotbarPadState {
  setCrossHotbar(on: boolean): void;
  setCrossHotbarExpand(on: boolean): void;
}

/** The pad the layout is handed to once it exists. */
export interface CrossHotbarPadTarget {
  setCrossHotbarBindings(bindings: CrossHotbarBindings): void;
}

/** The persisted-settings store the arm writes through. */
export interface CrossHotbarSettingsStore {
  set(key: CrossHotbarSettingKey, value: boolean): boolean;
  set(key: CrossHotbarSettingKey, value: number): number;
}

export type CrossHotbarSettingKey =
  | 'gamepadCrossHotbar'
  | 'gamepadCrossHotbarExpand'
  | 'gamepadCrossHotbarDisplay';

/** The rebind surface the Controller options panel consumes. */
export interface CrossHotbarPanelHooks {
  /** Offer a cell to any newly learned ability. Called where the action bar does
   *  its own auto-place, so both bars react to a level-up on the same beat. */
  syncCrossHotbarKnown(abilityIds: readonly string[]): void;
  crossHotbarSets(): readonly (readonly CrossHotbarAction[])[];
  bindCrossHotbar(set: number, position: number, action: CrossHotbarAction): void;
  resetCrossHotbar(): void;
}

export interface CrossHotbarWiring {
  /** Passed to the GamepadManager so a held trigger resolves against this layout. */
  bindings: CrossHotbarBindings;
  /** The pad's onCrossHotbar callback: opens, swaps, and closes the overlay. */
  onHold(layer: CrossHotbarLayer | null, set: number, kind: GamepadKind): void;
  /** The two cross-hotbar settings. Answers whether the key was one of them, so
   *  the caller's settings chain can return on a match. */
  applySetting(
    pad: CrossHotbarPad,
    store: CrossHotbarSettingsStore,
    key: string,
    value: number | boolean,
  ): boolean;
  hooks: CrossHotbarPanelHooks;
  /** The pad callbacks, in the shape GamepadCallbacks declares them. */
  padCallbacks(kind: () => GamepadKind): {
    onCrossHotbar(layer: CrossHotbarLayer | null, set: number): void;
    onCrossHotbarEdit(active: boolean, carriedFrom: number | null, carried: string | null): void;
    focusedCrossHotbarCell(): number | null;
  };
  /** Hand the layout to the pad. Separate from construction because the pad is
   *  built after this wiring, from callbacks this wiring supplies. */
  attach(pad: CrossHotbarPadTarget): void;
  /** Re-evaluate pad mode after a connect, disconnect, or settings change. */
  syncPadMode(pad: CrossHotbarPadState): void;
}

/** The overlay payload for a held trigger, or null once none is held. */
export function crossHotbarHold(
  bindings: CrossHotbarBindings,
  layer: CrossHotbarLayer | null,
  set: number,
  kind: GamepadKind,
): CrossHotbarHoldInfo {
  return {
    layer,
    // The WHOLE set: the bar shows both halves and only ARMS one.
    slots: bindings.setActions(set),
    expanded: set === CROSS_HOTBAR_EXPANDED_SET,
    buttons: crossHotbarButtonLabels(kind),
    triggers: {
      left: gamepadButtonLabel(CROSS_HOTBAR_TRIGGERS.left, kind),
      right: gamepadButtonLabel(CROSS_HOTBAR_TRIGGERS.right, kind),
    },
    arrange: {
      bumper: gamepadButtonLabel(CROSS_HOTBAR_ARRANGE_CHORD.bumper, kind),
      button: gamepadButtonLabel(CROSS_HOTBAR_ARRANGE_CHORD.button, kind),
    },
  };
}

/** The bar a pad player sees with no trigger down: the first set's left eight,
 *  shown but not armed. Keeping it on screen is what lets the desktop rows stand
 *  down without leaving the player with no hotbar at all. */
export function crossHotbarResting(
  bindings: CrossHotbarBindings,
  kind: GamepadKind,
): CrossHotbarHoldInfo {
  return crossHotbarHold(bindings, null, CROSS_HOTBAR_PRIMARY_SET, kind);
}

/** The sixteen hardware glyphs under the cells (the left half's eight then the
 *  right half's, the same buttons twice because the trigger is what separates
 *  them). The d-pad four collapse to bare arrows: the cell already sits in the
 *  position it names, so the full "D-pad up" only crowds a 44px cell. */
export function crossHotbarButtonLabels(kind: GamepadKind): string[] {
  const half = CROSS_HOTBAR_LAYER_BUTTONS.map(
    (button) => CROSS_HOTBAR_DPAD_GLYPHS[button] ?? gamepadButtonLabel(button, kind),
  );
  return [...half, ...half];
}

// Pad mode is the cross hotbar being both enabled AND reachable. A player with no
// pad keeps the desktop rows even though the setting defaults on, which is the
// whole reason this is not just the setting.
const PAD_MODE_CLASS = 'xhb-mode';
// How much of itself the bar shows. A class per preset rather than a pile of
// toggles: each is a coherent look, and CSS owns the whole difference.
export const CROSS_HOTBAR_DISPLAY_CLASSES = ['xhb-full', 'xhb-compact', 'xhb-minimal'] as const;

/**
 * Set the lift from the bar's MEASURED height rather than a constant.
 *
 * Three different constants were wrong in three different ways: tuned for the
 * framed bar it left a gap on a desktop window, and every value that fitted one
 * viewport pushed the player frame into the cast bar on another. The distance
 * depends on how tall the bar actually renders, which depends on the interface
 * scale, so it has to be read rather than guessed.
 *
 * A layout read, deliberately: it runs when the bar appears, its preset changes,
 * or the window resizes. Never per frame.
 */
let liftObserver: ResizeObserver | null = null;

/**
 * Re-measure whenever the bar's own box changes size.
 *
 * The explicit calls all fire at moments the bar is still hidden (pad connect and
 * the startup settings pass both run long before the world is entered), so they
 * measured zero, gave up and never came back. The bar getting its size IS the
 * event worth listening to, and it covers the rest for free: a preset change, an
 * interface-scale change, a window resize.
 */
function watchBarForLift(): void {
  if (liftObserver || typeof ResizeObserver === 'undefined') return;
  const bar = document.getElementById('cross-hotbar');
  if (!bar) return;
  liftObserver = new ResizeObserver(() => measureCrossHotbarLift());
  liftObserver.observe(bar);
}

export function measureCrossHotbarLift(): void {
  // Deferred a frame: every caller runs at the moment the bar is turned on or its
  // preset changes, which is BEFORE the browser has laid it out. Measured there it
  // reads zero, gives up, and leaves the CSS fallback in place, which is the whole
  // problem this replaced.
  const run = () => {
    try {
      measureNow();
    } catch {
      /* no DOM (headless/tests) */
    }
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else run();
}

function measureNow(): void {
  const bar = document.getElementById('cross-hotbar');
  const frame = document.getElementById('player-frame');
  if (!bar || !frame) return;
  const barRect = bar.getBoundingClientRect();
  const frameRect = frame.getBoundingClientRect();
  if (barRect.height <= 0 || frameRect.height <= 0) return;
  // Undo the lift already applied, so the sum is computed from where the frame
  // WOULD sit. Read off the live transform rather than the variable: the variable
  // may still be unset and answering from the CSS fallback.
  const applied = -new DOMMatrix(getComputedStyle(frame).transform).m42;
  const restingBottom = frameRect.bottom + applied;
  // What the frame has to clear: the bar, plus the hint sitting above it.
  const hint = bar.querySelector<HTMLElement>('.xhb-hint');
  const hintHeight = hint && getComputedStyle(hint).display !== 'none' ? hint.offsetHeight : 0;
  const target = barRect.top - hintHeight - LIFT_GAP_PX;
  const lift = Math.max(0, Math.round(restingBottom - target));
  document.body.style.setProperty('--xhb-lift', `${lift}px`);
}

// Breathing room between the player frame and the topmost thing the bar draws.
const LIFT_GAP_PX = 10;

function applyDisplayClass(preset: number): void {
  try {
    const wanted = CROSS_HOTBAR_DISPLAY_CLASSES[preset] ?? CROSS_HOTBAR_DISPLAY_CLASSES[0];
    for (const cls of CROSS_HOTBAR_DISPLAY_CLASSES) {
      document.body.classList.toggle(cls, cls === wanted);
    }
    watchBarForLift();
    measureCrossHotbarLift();
  } catch {
    /* no DOM (headless/tests) */
  }
}

function applyPadModeClass(on: boolean): void {
  try {
    document.body.classList.toggle(PAD_MODE_CLASS, on);
  } catch {
    /* no DOM (headless/tests) */
  }
}

/**
 * Build the whole cross-hotbar wiring. The host arrives as a THUNK because the
 * pad is constructed before the HUD in the client's boot order; resolving it per
 * call keeps the wiring independent of that order instead of pinning it.
 *
 * `scope` is the character the layout is stored under, the same string `Keybinds`
 * takes, so two characters on one machine never share a pad layout. It is required
 * rather than defaulted, or an unscoped caller shares one key across characters.
 */
export function createCrossHotbar(
  host: () => CrossHotbarOverlayHost,
  scope: string,
): CrossHotbarWiring {
  const bindings = new CrossHotbarBindings(scope);
  let enabled = true;
  const syncPadMode = (pad: CrossHotbarPadState): void => {
    const on = enabled && pad.isConnected();
    applyPadModeClass(on);
    const ui = host();
    ui.refreshControllerLabels();
    // Seed on the first poll where a pad is actually present: the action bar has
    // loaded by then, and seeding earlier would fill from an empty one.
    if (on) {
      const seed = ui.crossHotbarSeed();
      bindings.seedOnce(seed.bar, seed.extras);
    }
    ui.setCrossHotbar(on ? crossHotbarResting(bindings, pad.getKind()) : null);
    if (on) {
      watchBarForLift();
      measureCrossHotbarLift();
    }
  };
  return {
    bindings,
    attach: (pad) => pad.setCrossHotbarBindings(bindings),
    syncPadMode,
    onHold: (layer, set, kind) =>
      host().setCrossHotbar(crossHotbarHold(bindings, layer, set, kind)),
    padCallbacks: (kind) => ({
      onCrossHotbar: (layer, set) =>
        host().setCrossHotbar(crossHotbarHold(bindings, layer, set, kind())),
      onCrossHotbarEdit: (active, carriedFrom, carried) =>
        host().crossHotbarEdit()?.setEditing(active, carriedFrom, carried),
      focusedCrossHotbarCell: () => host().crossHotbarEdit()?.focusedCell() ?? null,
    }),
    applySetting: (pad, store, key, value) => {
      if (key === 'gamepadCrossHotbar') {
        enabled = store.set(key, !!value);
        pad.setCrossHotbar(enabled);
        syncPadMode(pad);
        return true;
      }
      if (key === 'gamepadCrossHotbarExpand') {
        pad.setCrossHotbarExpand(store.set(key, !!value));
        return true;
      }
      if (key === 'gamepadCrossHotbarDisplay') {
        applyDisplayClass(store.set(key, Number(value)));
        return true;
      }
      return false;
    },
    hooks: {
      syncCrossHotbarKnown: (abilityIds) => bindings.syncKnown(abilityIds),
      crossHotbarSets: () => bindings.all(),
      bindCrossHotbar: (set, position, action) => bindings.bind(set, position, action),
      resetCrossHotbar: () => bindings.reset(),
    },
  };
}
