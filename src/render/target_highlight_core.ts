// Pure core for the Style of Enemy Highlight options (Options > Interface >
// Combat): which of the four cues are on, which setting drives which cue, and
// where the screen-edge arrow sits for a target that is off camera.
//
// Three/DOM/i18n-free (RENDER_PURE_CORES, tests/architecture.test.ts). The
// painters are thin consumers: selection_reticle.ts draws the heavier reticle,
// nameplate_painter.ts + nameplate_target_highlight.ts draw the framed plate,
// the overhead chevron and the edge arrow. Every cue applies only to a HOSTILE
// current target, and the four are independent: any mix works together.

/** The four cues, each its own checkbox and its own bool setting. */
export interface TargetHighlightFlags {
  /** An arrow pinned to the screen edge, pointing at the target while it is off camera. */
  edgeArrow: boolean;
  /** The target's nameplate drawn larger inside a gold frame. */
  nameplate: boolean;
  /** A chevron floating above the target's head (above its plate when one shows). */
  overhead: boolean;
  /** The ground reticle with a wider band, a tinted inner disc and an outer dashed ring. */
  reticle: boolean;
}

export type TargetHighlightSettingKey =
  | 'targetHighlightEdgeArrow'
  | 'targetHighlightNameplate'
  | 'targetHighlightOverhead'
  | 'targetHighlightReticle';

/** Which flag each setting key drives (main.ts applySetting reads this). */
export const TARGET_HIGHLIGHT_SETTING_FLAG: Readonly<
  Record<TargetHighlightSettingKey, keyof TargetHighlightFlags>
> = {
  targetHighlightEdgeArrow: 'edgeArrow',
  targetHighlightNameplate: 'nameplate',
  targetHighlightOverhead: 'overhead',
  targetHighlightReticle: 'reticle',
};

/** The flag a settings key drives, or null for any other key. */
export function targetHighlightFlagFor(key: string): keyof TargetHighlightFlags | null {
  return Object.hasOwn(TARGET_HIGHLIGHT_SETTING_FLAG, key)
    ? TARGET_HIGHLIGHT_SETTING_FLAG[key as TargetHighlightSettingKey]
    : null;
}

/** All four cues off: the classic reticle alone. */
export function newTargetHighlightFlags(): TargetHighlightFlags {
  return { edgeArrow: false, nameplate: false, overhead: false, reticle: false };
}

/** Plate scale while the framed-nameplate cue is on. */
export const TARGET_PLATE_EMPHASIS_SCALE = 1.25;

/** The floor (CSS px) of the edge arrow's inset from any viewport edge. */
export const EDGE_ARROW_MARGIN_PX = 56;
/** The arrow's inset as a share of the viewport: wide enough that it clears the
 *  HUD along the edges (the side button rail, the minimap, the unit frames and
 *  action bars along the bottom) instead of drawing underneath them. */
export const EDGE_ARROW_INSET_X = 0.15;
export const EDGE_ARROW_INSET_Y = 0.22;

/** The arrow's horizontal inset for a viewport this wide. */
export function edgeArrowMarginX(width: number): number {
  return Math.max(EDGE_ARROW_MARGIN_PX, width * EDGE_ARROW_INSET_X);
}

/** The arrow's vertical inset for a viewport this tall. */
export function edgeArrowMarginY(height: number): number {
  return Math.max(EDGE_ARROW_MARGIN_PX, height * EDGE_ARROW_INSET_Y);
}

/** Where the edge arrow sits. Filled in place by edgeArrowInto. */
export interface EdgeArrowPlacement {
  /** Arrow tip position in CSS px from the viewport's top-left. */
  x: number;
  y: number;
  /** Direction the arrow points, radians, screen space (0 = right, PI/2 = down). */
  angle: number;
}

export function newEdgeArrowPlacement(): EdgeArrowPlacement {
  return { x: 0, y: 0, angle: 0 };
}

/**
 * Place the edge arrow for a target, or report that it is on screen.
 *
 * Inputs are the target's camera-space position (x right, y up, z toward the
 * viewer, so a point IN FRONT of the camera has z < 0) and its projected NDC
 * (only meaningful in front). A target in front and inside the NDC square is on
 * screen: returns false and leaves `out` untouched. Otherwise the arrow points
 * from the viewport centre toward the target and is pushed out to the inset
 * rectangle inset by edgeArrowMarginX/Y. A target behind the camera uses its
 * camera-space x/y for direction (a projection behind the eye mirrors), and one
 * dead behind with no sideways offset points straight down.
 */
export function edgeArrowInto(
  out: EdgeArrowPlacement,
  camX: number,
  camY: number,
  camZ: number,
  ndcX: number,
  ndcY: number,
  width: number,
  height: number,
): boolean {
  const inFront = camZ < 0;
  if (inFront && Math.abs(ndcX) <= 1 && Math.abs(ndcY) <= 1) return false;
  let dx: number;
  let dy: number;
  if (inFront) {
    dx = ndcX * width * 0.5;
    dy = -ndcY * height * 0.5;
  } else {
    dx = camX;
    dy = -camY;
  }
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
    dx = 0;
    dy = 1;
  }
  const halfW = Math.max(1, width * 0.5 - edgeArrowMarginX(width));
  const halfH = Math.max(1, height * 0.5 - edgeArrowMarginY(height));
  const tx = Math.abs(dx) > 1e-9 ? halfW / Math.abs(dx) : Number.POSITIVE_INFINITY;
  const ty = Math.abs(dy) > 1e-9 ? halfH / Math.abs(dy) : Number.POSITIVE_INFINITY;
  const k = Math.min(tx, ty);
  out.x = width * 0.5 + dx * k;
  out.y = height * 0.5 + dy * k;
  out.angle = Math.atan2(dy, dx);
  return true;
}
