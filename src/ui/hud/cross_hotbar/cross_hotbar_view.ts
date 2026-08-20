// Pure, DOM-free model for the cross-hotbar overlay.
//
// The bar shows a WHOLE SET at once: sixteen cells in two halves, the left
// trigger's eight and the right trigger's eight, each half a d-pad diamond plus a
// face diamond. Holding a trigger does not swap the contents, it HIGHLIGHTS that
// half, so a player reads both halves at rest and sees which one is armed. (An
// eight-cell design that swapped contents per trigger hides half the set, which
// makes the resting bar a poor replacement for the action-bar rows.)
//
// Deliberately self-contained: it names no gamepad button, because a registered UI
// pure core stays host-agnostic (it may not reach into src/game). The CELL ORDER
// here must stay in step with CROSS_HOTBAR_LAYER_BUTTONS in game/cross_hotbar.ts,
// which is a cross-module contract, so tests/cross_hotbar_view.test.ts pins the two
// against each other rather than an import doing it.
//
// The per-cell icon, cooldown and usability state is NOT re-derived here: the
// overlay reuses the desktop action bar's already-ticked ActionBarState, so a
// cross-hotbar cell and its action-bar button can never disagree.

/** Which trigger a half belongs to. Structurally the game core's CrossHotbarLayer. */
export type CrossHotbarOverlayLayer = 'left' | 'right';

/** One cell's action. Structurally the game core's CrossHotbarAction; redeclared
 *  so this registered pure core stays host-agnostic and imports no src/game. */
export type CrossHotbarOverlayAction = { type: 'ability' | 'item'; id: string } | null;

export type CrossHotbarCluster = 'dpad' | 'face';
export type CrossHotbarPoint = 'top' | 'left' | 'right' | 'bottom';

/** One overlay cell: which half it belongs to and where it sits in its diamond. */
export interface CrossHotbarCell {
  /** 0 to 15, matching the set position the game core resolves a press to. */
  index: number;
  layer: CrossHotbarOverlayLayer;
  cluster: CrossHotbarCluster;
  point: CrossHotbarPoint;
}

// Each diamond is read top, left, right, bottom; each half is d-pad then face.
const POINTS: readonly CrossHotbarPoint[] = ['top', 'left', 'right', 'bottom'];
const CLUSTERS: readonly CrossHotbarCluster[] = ['dpad', 'face'];
const LAYERS: readonly CrossHotbarOverlayLayer[] = ['left', 'right'];

export const CROSS_HOTBAR_CELLS: readonly CrossHotbarCell[] = LAYERS.flatMap((layer, l) =>
  CLUSTERS.flatMap((cluster, c) =>
    POINTS.map((point, p) => ({
      index: l * CLUSTERS.length * POINTS.length + c * POINTS.length + p,
      layer,
      cluster,
      point,
    })),
  ),
);

export const CROSS_HOTBAR_CELL_COUNT = CROSS_HOTBAR_CELLS.length;

export interface CrossHotbarOverlayState {
  visible: boolean;
  /** The half a held trigger has armed, or null for the resting bar. */
  activeLayer: CrossHotbarOverlayLayer | null;
  /** Whether the second (double) set is showing, for the overlay's set marker. */
  expanded: boolean;
  /** The action on each cell, always sixteen entries; null where empty. */
  cellActions: readonly CrossHotbarOverlayAction[];
}

export const HIDDEN_CROSS_HOTBAR: CrossHotbarOverlayState = {
  visible: false,
  activeLayer: null,
  expanded: false,
  cellActions: CROSS_HOTBAR_CELLS.map(() => null),
};

/** What the HUD is handed: the whole set, plus which half (if any) is armed. */
export interface CrossHotbarHold {
  /** The armed half, or null for the resting bar (still shown). */
  layer: CrossHotbarOverlayLayer | null;
  /** The SIXTEEN actions of the active set, in cell order. */
  slots: readonly CrossHotbarOverlayAction[];
  expanded: boolean;
  /** The hardware glyph under each cell, in CROSS_HOTBAR_CELLS order. */
  buttons: readonly string[];
  /** The two trigger glyphs, so each half says which trigger opens it and the
   *  bar can advertise the both-triggers route to the second set. */
  triggers: { left: string; right: string };
  /** The arrange chord's glyphs, so the resting bar can name the way into edit
   *  mode instead of hiding it in the options panel. */
  arrange: { bumper: string; button: string };
}

/**
 * Build the overlay state. A null hold hides the bar outright (no pad, or the
 * cross hotbar switched off); any hold shows all sixteen cells, arming at most one
 * half. A short or missing slot list still yields sixteen cells, so the painter
 * never indexes past its own elements.
 */
export function crossHotbarOverlayState(hold: CrossHotbarHold | null): CrossHotbarOverlayState {
  if (hold === null) return HIDDEN_CROSS_HOTBAR;
  const cellActions: CrossHotbarOverlayAction[] = [];
  for (let i = 0; i < CROSS_HOTBAR_CELL_COUNT; i++) {
    cellActions.push(hold.slots[i] ?? null);
  }
  return { visible: true, activeLayer: hold.layer, expanded: hold.expanded, cellActions };
}

/** The rebind surface the options panel and any edit mode both consume. Declared
 *  here so the HUD's hooks interface can extend it rather than restate it. */
export interface CrossHotbarPanelHooks {
  /** Offer a cell to any newly learned ability, so levelling into a spell puts it
   *  in reach instead of leaving a pad player to find the arrange chord first. */
  syncCrossHotbarKnown(abilityIds: readonly string[]): void;
  crossHotbarSets(): readonly (readonly CrossHotbarOverlayAction[])[];
  bindCrossHotbar(set: number, position: number, action: CrossHotbarOverlayAction): void;
  resetCrossHotbar(): void;
}
