// Pure geometry + persistence helpers for the movable target frame. No DOM, no
// Three, no sim deps: just arithmetic and (de)serialization so the clamping rules
// can be unit-tested headlessly. The DOM wiring (the move/lock button, pointer
// events, applying styles) lives in hud.ts; this module only answers "given a
// desired top-left and a viewport, what is the legal position, and how do we
// round-trip it through localStorage?". Mirrors chat_window.ts (its move-only
// sibling: the target frame has a fixed size, so there is no resize half).

// `left`/`top` are the target frame's top-left corner in viewport px.
// `scale` is the OPTIONAL player-chosen UNIFORM zoom multiplier (the SE grip,
// a corner drag, and the arrow-key resize write it; the whole frame zooms
// proportionally). `scaleX`/`scaleY` are the per-axis multipliers a SIDE-edge
// drag writes on a scale-mode frame (east/west stretches width only,
// north/south height only); matching axes collapse back to plain `scale` on
// save. `w`/`h` are the author-space box a SIDE-edge drag writes on a
// BOX-mode frame instead (the chat box, the aura rows), whose contents
// genuinely reflow. Each field is absent until its gesture is used, so a frame
// that only moves still stores exactly {left, top}.
export interface TargetFramePos {
  left: number;
  top: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  w?: number;
  h?: number;
  /** The visual viewport the spot was saved under (both or neither), so a
   *  later apply can re-anchor per axis when the window size changes
   *  (fullscreen exit): see anchorAdjustedPos. */
  vw?: number;
  vh?: number;
}

/** The effective per-axis multipliers a position resolves to: an explicit axis
 *  value wins, else the uniform `scale`, else 1; each clamped into the band. */
export function frameScales(
  pos: Pick<TargetFramePos, 'scale' | 'scaleX' | 'scaleY'> | null | undefined,
): { sx: number; sy: number } {
  return {
    sx: clampFrameScale(pos?.scaleX ?? pos?.scale ?? 1),
    sy: clampFrameScale(pos?.scaleY ?? pos?.scale ?? 1),
  };
}

// The floor for a stretched box, so a drag can never collapse a frame into an
// ungrabbable sliver; author-space px, matching the w/h fields.
export const MIN_FRAME_BOX = 24;
// A sanity ceiling for a persisted box (a corrupt store cannot mint a
// viewport-swallowing frame); generous enough for any real monitor.
export const MAX_FRAME_BOX = 4096;

function clampFrameBox(v: number): number {
  return clamp(v, MIN_FRAME_BOX, MAX_FRAME_BOX);
}

// The gap kept between the frame and every viewport edge, matching the chat box's
// 8px margin so a dragged frame never touches the screen edge.
export const TARGET_FRAME_MARGIN = 8;

// Size multiplier bounds for a scalable frame. The floor keeps a frame
// grabbable rather than collapsing into a sliver, while low enough that even
// the widest frame (the 612px player frame, which a 0.6 floor pinned at 367px,
// far wider than any other frame's minimum) can compact to about 245px; the
// ceiling keeps a frame from swallowing the viewport.
export const FRAME_SCALE_MIN = 0.4;
export const FRAME_SCALE_MAX = 2;

// Keyboard resize steps, the arrow-key mirror of a grip drag. The coarse step
// walks the whole legal band in a handful of presses; the fine (Shift) step is
// the same one-notch-per-press feel the fine MOVE step has, so both gestures on
// a frame answer to the same modifier.
export const FRAME_SCALE_KEY_STEP = 0.05;
export const FRAME_SCALE_KEY_FINE_STEP = 0.01;

/** The arrange-mode snap grid (the frameSnapToGrid setting): coarse enough
 *  that two frames dropped near a shared line land ON it, fine enough that a
 *  layout never feels quantized. Applied to drag positions only, never to
 *  sizes, and only while the setting is on. */
export const FRAME_SNAP_GRID = 16;

/** Round a dragged coordinate onto the snap grid. */
export function snapFrameCoord(value: number, grid: number = FRAME_SNAP_GRID): number {
  if (!Number.isFinite(value) || grid <= 0) return value;
  return Math.round(value / grid) * grid;
}

/** The resize half of Snap to Grid: quantize a dragged SIZE (visual px) onto
 *  the grid pitch, floored to one cell so a resize can never snap a frame to
 *  nothing. Degenerate inputs pass through unchanged. */
export function snapFrameSize(value: number, grid: number = FRAME_SNAP_GRID): number {
  if (!Number.isFinite(value) || grid <= 0) return value;
  return Math.max(grid, snapFrameCoord(value, grid));
}

/** The arrow-key half of Snap to Grid: step a coordinate or size to the NEXT
 *  grid line in the pressed direction. A value already on a line moves one
 *  full cell; an off-grid value lands on the nearest line that way, so a
 *  keyboard-only player reaches exactly the same positions a snapped drag
 *  does (Shift stays the 1px fine step and bypasses this). */
export function stepCoordToGridLine(
  value: number,
  dir: 1 | -1,
  grid: number = FRAME_SNAP_GRID,
): number {
  if (!Number.isFinite(value) || grid <= 0) return value;
  return dir > 0 ? Math.floor(value / grid) * grid + grid : Math.ceil(value / grid) * grid - grid;
}

/** Snap a ZOOM gesture the same way: the scale whose visual extent lands on
 *  the grid. `startVisual` and `startScale` are the gesture-start pair (the
 *  measured size and the scale it was measured under), `nextScale` the
 *  candidate the drag produced; a degenerate start returns it unchanged. */
export function snapScaleToGrid(
  startVisual: number,
  startScale: number,
  nextScale: number,
  grid: number = FRAME_SNAP_GRID,
): number {
  if (!(startVisual > 0) || !(startScale > 0) || !Number.isFinite(nextScale)) return nextScale;
  const unscaled = startVisual / startScale;
  return snapFrameSize(unscaled * nextScale, grid) / unscaled;
}

/** Clamp a desired size multiplier into the legal band. A non-finite read (a
 *  corrupt store, a divide by a zero rect) falls back to 1 rather than blanking
 *  the frame with a degenerate transform. */
export function clampFrameScale(
  scale: number,
  min: number = FRAME_SCALE_MIN,
  max: number = FRAME_SCALE_MAX,
): number {
  if (!Number.isFinite(scale)) return 1;
  return clamp(scale, min, max);
}

/** Size multiplier for a grip drag of (dx, dy) visual px from the session start.
 *  The grip sits at the frame's bottom-right and the transform origin is its
 *  top-left, so pulling away from the origin on EITHER axis grows the frame; the
 *  larger of the two axis ratios wins, which keeps a diagonal pull feeling
 *  direct without letting a purely horizontal one shrink the height. A start box
 *  with no width or height (a frame measured while hidden) cannot produce a
 *  ratio, so the start scale is returned unchanged. */
export function scaleFromGripDrag(
  startScale: number,
  startSize: { w: number; h: number },
  dx: number,
  dy: number,
  min: number = FRAME_SCALE_MIN,
  max: number = FRAME_SCALE_MAX,
): number {
  const base = clampFrameScale(startScale, min, max);
  const ratios: number[] = [];
  if (startSize.w > 0) ratios.push((startSize.w + dx) / startSize.w);
  if (startSize.h > 0) ratios.push((startSize.h + dy) / startSize.h);
  if (ratios.length === 0) return base;
  return clampFrameScale(base * Math.max(...ratios), min, max);
}

/** Size multiplier for ONE keyboard resize press: `direction` is +1 to grow and
 *  -1 to shrink, `fine` picks the Shift step. Additive rather than the drag
 *  path's ratio because a press has no travel to take a ratio from, and an
 *  additive step is what makes the band walkable in a predictable press count;
 *  the result is clamped into the same legal band, so holding a key at either
 *  end simply stops. */
export function scaleFromKeyStep(
  startScale: number,
  direction: number,
  fine: boolean,
  min: number = FRAME_SCALE_MIN,
  max: number = FRAME_SCALE_MAX,
): number {
  const base = clampFrameScale(startScale, min, max);
  const step = fine ? FRAME_SCALE_KEY_FINE_STEP : FRAME_SCALE_KEY_STEP;
  // Rounded to the step grid so repeated presses cannot drift into float dust
  // (0.6000000000000001) and so growing then shrinking returns to where it was.
  const next = Math.round((base + direction * step) / step) * step;
  return clampFrameScale(next, min, max);
}

/** Clamp a real-dimension setting (frame width, bar thickness) that the
 *  'dimensions' resize mode drives. Rounded to whole px, the sliders' grid,
 *  so a drag settles on the same values the options window can produce and
 *  the per-move setting writes elide naturally on sub-pixel travel. */
export function clampFrameDimension(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Which border of a frame a resize gesture rides: the four sides plus the four
 *  corners, named like compass cursors. The SE grip is the 'se' case. */
export type FrameEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** How far INSIDE a frame border a pointer counts as "on the edge". The band is
 *  strictly INSIDE the frame's own box: an outer halo overlapped whatever frame
 *  sat next to it (the action bars are stacked 4px apart), and the neighbour won
 *  the hit test, which is what left the bars resizable only from their corners.
 *  The dashed outline is drawn inside to match (hud.css outline-offset). */
export const FRAME_EDGE_BAND = 8;

/**
 * The band actually used on an axis of `size` px. A thin frame (the 10px XP
 * bar) cannot spare 8px at each end AND a middle to drag from, so the band
 * shrinks to a third of the axis, always leaving a graspable middle.
 */
export function edgeBandFor(size: number, band: number = FRAME_EDGE_BAND): number {
  if (!Number.isFinite(size) || size <= 0) return band;
  return Math.max(1, Math.min(band, Math.floor(size / 3)));
}

/**
 * The edge under a pointer at (x, y), or null when the pointer sits in the
 * frame body or outside the frame. The band is per-axis (see edgeBandFor), so a
 * short bar keeps a middle strip to move by; both adjacent side bands active at
 * once make a corner.
 */
export function frameEdgeAtPoint(
  rect: { left: number; top: number; width: number; height: number },
  x: number,
  y: number,
  band: number = FRAME_EDGE_BAND,
): FrameEdge | null {
  if (x < rect.left || x > rect.left + rect.width) return null;
  if (y < rect.top || y > rect.top + rect.height) return null;
  const bandX = edgeBandFor(rect.width, band);
  const bandY = edgeBandFor(rect.height, band);
  const n = y - rect.top <= bandY;
  const s = rect.top + rect.height - y <= bandY;
  const w = x - rect.left <= bandX;
  const e = rect.left + rect.width - x <= bandX;
  const vertical = n ? 'n' : s ? 's' : '';
  const horizontal = w ? 'w' : e ? 'e' : '';
  const edge = `${vertical}${horizontal}`;
  return edge === '' ? null : (edge as FrameEdge);
}

/** Height a name chip needs above a frame before it would clip off-screen: the
 *  chip box plus its gap, matching the .tf-frame-label offset in hud.css. */
export const FRAME_LABEL_CLEARANCE = 22;

/**
 * Should a frame's name chip render BELOW the frame instead of above it? Above
 * is the default (it never covers the frame's own contents), but a frame parked
 * against the top of the viewport has no room up there and its chip would be
 * clipped away entirely, which is what leaves a frame looking nameless.
 */
export function labelBelowFrame(
  frameTop: number,
  clearance: number = FRAME_LABEL_CLEARANCE,
): boolean {
  return frameTop < clearance;
}

/** The resize cursor for an edge: the game-styled token for that axis (the
 *  gold-blade art in tokens.css, so editing never flips to the OS cursor set)
 *  with the desktop window manager's keyword as the engine fallback. */
export function cursorForFrameEdge(edge: FrameEdge): string {
  switch (edge) {
    case 'n':
    case 's':
      return 'var(--cursor-resize-ns, ns-resize)';
    case 'e':
    case 'w':
      return 'var(--cursor-resize-ew, ew-resize)';
    case 'ne':
    case 'sw':
      return 'var(--cursor-resize-nesw, nesw-resize)';
    default:
      return 'var(--cursor-resize-nwse, nwse-resize)';
  }
}

/**
 * The author-space box after a SIDE-edge drag of (dx, dy) visual px from the
 * gesture start: east/west stretches the width, north/south the height, signed
 * so pulling AWAY from the frame body grows it whichever border is held.
 * `factor` converts visual travel into author px (the live uniform zoom times
 * the UI scale); a non-positive factor (a frame measured while hidden) leaves
 * the box unchanged. This is a LAYOUT resize: the caller writes real
 * width/height, so contents reflow and text is never distorted. Corners do not
 * come here; they stay a uniform zoom (scaleFromCornerDrag).
 */
export function boxFromEdgeDrag(
  edge: FrameEdge,
  start: { w: number; h: number },
  dx: number,
  dy: number,
  factor: number,
): { w: number; h: number } {
  if (!Number.isFinite(factor) || factor <= 0) return { w: start.w, h: start.h };
  let w = start.w;
  let h = start.h;
  if (edge.includes('e')) w = clampFrameBox(start.w + dx / factor);
  if (edge.includes('w')) w = clampFrameBox(start.w - dx / factor);
  if (edge.includes('s')) h = clampFrameBox(start.h + dy / factor);
  if (edge.includes('n')) h = clampFrameBox(start.h - dy / factor);
  return { w, h };
}

/**
 * Per-axis multipliers for an edge drag of (dx, dy) visual px from the gesture
 * start. A SIDE edge stretches ONLY the axis it owns (east/west the width,
 * north/south the height), signed so pulling AWAY from the frame body grows
 * it: this is the horizontal-only / vertical-only adjustment. A CORNER (the SE
 * grip included) multiplies BOTH axes by the larger of its two ratios, so it
 * stays the proportional whole-frame zoom it always was, and a stretched frame
 * keeps its chosen aspect under a corner drag. A start box with no width or
 * height (a frame measured while hidden) cannot produce a ratio, so the start
 * scales return unchanged.
 */
export function sizeFromEdgeDrag(
  edge: FrameEdge,
  start: { sx: number; sy: number },
  startSize: { w: number; h: number },
  dx: number,
  dy: number,
  min: number = FRAME_SCALE_MIN,
  max: number = FRAME_SCALE_MAX,
): { sx: number; sy: number } {
  const sx = clampFrameScale(start.sx, min, max);
  const sy = clampFrameScale(start.sy, min, max);
  let rx: number | null = null;
  let ry: number | null = null;
  if (startSize.w > 0) {
    if (edge.includes('e')) rx = (startSize.w + dx) / startSize.w;
    if (edge.includes('w')) rx = (startSize.w - dx) / startSize.w;
  }
  if (startSize.h > 0) {
    if (edge.includes('s')) ry = (startSize.h + dy) / startSize.h;
    if (edge.includes('n')) ry = (startSize.h - dy) / startSize.h;
  }
  if (edge.length === 2) {
    const ratios = [rx, ry].filter((r): r is number => r !== null);
    if (ratios.length === 0) return { sx, sy };
    const factor = Math.max(...ratios);
    return {
      sx: clampFrameScale(sx * factor, min, max),
      sy: clampFrameScale(sy * factor, min, max),
    };
  }
  return {
    sx: rx === null ? sx : clampFrameScale(sx * rx, min, max),
    sy: ry === null ? sy : clampFrameScale(sy * ry, min, max),
  };
}

/**
 * Where the frame's top-left lands after a resize, holding the OPPOSITE border
 * still: a west or north edge moves the top-left so the right or bottom border
 * stays anchored under the pointer's counterpart, exactly as a desktop window
 * resizes; every other edge leaves the top-left alone (the transform origin is
 * already top-left). Start and new boxes are the VISUAL sizes, so the same
 * anchor rule serves both the layout stretch and the uniform corner zoom; the
 * caller re-clamps into the viewport.
 */
export function posFromEdgeResize(
  edge: FrameEdge,
  start: { left: number; top: number; w: number; h: number },
  next: { w: number; h: number },
): { left: number; top: number } {
  return {
    left: edge.includes('w') ? start.left + (start.w - next.w) : start.left,
    top: edge.includes('n') ? start.top + (start.h - next.h) : start.top,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  // hi can fall below lo on a viewport too small to hold the frame; prefer the
  // lower bound (margin) so the frame stays anchored to the top-left corner.
  return Math.max(lo, Math.min(hi, v));
}

// Clamp a desired position so the whole frame (its measured `size`) stays on
// screen inside the margin. Called on every drag move and on window resize.
export function clampTargetFramePos(
  pos: TargetFramePos,
  viewport: { w: number; h: number },
  size: { w: number; h: number },
  margin: number = TARGET_FRAME_MARGIN,
): TargetFramePos {
  const maxLeft = Math.max(margin, viewport.w - size.w - margin);
  const maxTop = Math.max(margin, viewport.h - size.h - margin);
  // Carry `scale` through untouched: clamping is a POSITION rule, and dropping
  // the multiplier here would silently reset a resized frame on every re-clamp
  // (a drag move, a window resize, a UI Scale change all run through this).
  return {
    ...pos,
    left: clamp(pos.left, margin, maxLeft),
    top: clamp(pos.top, margin, maxTop),
  };
}

// A positive, finite divisor for the UI-scale compensation below. A bad read
// (0, negative, NaN, Infinity) falls back to 1 so a drag never blanks the frame.
function safeScale(scale: number): number {
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

export interface TargetFramePlacement {
  /** Clamped top-left in VISUAL (screen / pointer) space: persist THIS. It stays
   *  scale-independent, so a spot saved at one UI Scale renders at the same visual
   *  place at another (the css write divides by whatever scale is live at paint). */
  pos: TargetFramePos;
  /** Top-left to write to style.left/top, in AUTHOR space (visual / scale): the
   *  frame lives inside #ui (`zoom: var(--ui-scale)`), which re-multiplies the
   *  author length back to `pos` on screen. */
  css: TargetFramePos;
}

// Clamp a desired VISUAL top-left so the whole frame (its visual `size`) stays on
// screen, then derive the AUTHOR-space css write the #ui zoom re-multiplies back.
// Mirrors hud.ts setWindowPixelPosition: getBoundingClientRect() and pointer
// clientX/clientY are post-zoom, but style.left/top are author lengths, so the
// write divides by the live UI scale. `scale` of 1 (the default) is a no-op.
export function placeTargetFrame(
  pos: TargetFramePos,
  viewport: { w: number; h: number },
  size: { w: number; h: number },
  scale: number,
  margin: number = TARGET_FRAME_MARGIN,
): TargetFramePlacement {
  const clamped = clampTargetFramePos(pos, viewport, size, margin);
  const z = safeScale(scale);
  return { pos: clamped, css: { left: clamped.left / z, top: clamped.top / z } };
}

/** How close (visual px) a span's center must sit to the axis center to read
 *  as deliberately centered. Tight on purpose, tuned against a real layout:
 *  the horizontally centered cast bar sits about 15px off, while a debuff row
 *  that merely happened to sit 38px from mid-height must NOT be dragged
 *  toward the center on every resize (it visually hangs under the minimap). */
export const ANCHOR_CENTER_SNAP = 24;

/**
 * One axis of the viewport re-anchoring: where does a `start..start+extent`
 * span land when the axis grows or shrinks from `savedSpan` to `span`? Two
 * rules, tuned against real player layouts. (1) A span centered within
 * ANCHOR_CENTER_SNAP of the axis center is deliberately centered and stays
 * centered. (2) Everything else keeps its distance to its NEAREST edge: a bar
 * (or the tall menu rail) parked near the bottom stays that distance from the
 * bottom, a row against the right edge stays on the right, and frames in the
 * upper / leading region do not move at all. There is deliberately NO special
 * case for tall frames: one shipped briefly, pinning the menu rail's TOP, and
 * a rail whose lower end hugs the bottom edge visibly floated to mid-screen
 * the moment the window gained height (owner report).
 */
export function anchorAxis(start: number, extent: number, savedSpan: number, span: number): number {
  if (Math.abs(start + extent / 2 - savedSpan / 2) <= ANCHOR_CENTER_SNAP) {
    return start + (span - savedSpan) / 2;
  }
  const dEnd = savedSpan - (start + extent);
  return dEnd < start ? start + (span - savedSpan) : start;
}

/**
 * Re-anchor a saved spot to the CURRENT viewport. Positions persist as
 * absolute visual px plus the viewport they were saved under (`vw`/`vh`);
 * when the window size changes (leaving fullscreen), each axis re-derives
 * from its nearest anchor via {@link anchorAxis}, so the stock bottom-anchored
 * HUD and the player's placed frames move TOGETHER instead of tearing apart.
 * A spot saved by an older build carries no viewport and is returned
 * unchanged (it gains one on its next save).
 */
export function anchorAdjustedPos(
  pos: TargetFramePos,
  size: { w: number; h: number },
  viewport: { w: number; h: number },
): TargetFramePos {
  const { vw, vh } = pos;
  if (vw === undefined || vh === undefined) return pos;
  if (vw === viewport.w && vh === viewport.h) return pos;
  return {
    ...pos,
    left: anchorAxis(pos.left, size.w, vw, viewport.w),
    top: anchorAxis(pos.top, size.h, vh, viewport.h),
  };
}

// Size fields are written ONLY when the frame actually carries one, so a
// move-only frame keeps the exact {left, top} payload it has always persisted.
// Matching axes collapse to the single uniform `scale` field (the payload a
// uniformly zoomed frame always had); only a genuinely stretched frame writes
// scaleX/scaleY, and only a box-resized one its w/h.
export function serializeTargetFramePos(pos: TargetFramePos): string {
  const out: Record<string, number> = { left: pos.left, top: pos.top };
  if (pos.scaleX !== undefined || pos.scaleY !== undefined) {
    const { sx, sy } = frameScales(pos);
    if (sx === sy) out.scale = sx;
    else {
      out.scaleX = sx;
      out.scaleY = sy;
    }
  } else if (pos.scale !== undefined) {
    out.scale = pos.scale;
  }
  if (pos.w !== undefined) out.w = pos.w;
  if (pos.h !== undefined) out.h = pos.h;
  // The viewport the spot was saved under, so a later apply can re-anchor it
  // when the window size changes (anchorAdjustedPos).
  if (pos.vw !== undefined && pos.vh !== undefined) {
    out.vw = Math.round(pos.vw);
    out.vh = Math.round(pos.vh);
  }
  return JSON.stringify(out);
}

// Parse persisted position, returning null for missing/corrupt data so callers
// fall back to the CSS default. left/top must both be finite numbers; the size
// fields are optional, and a corrupt one is DROPPED rather than failing the
// whole parse, so a bad multiplier or box costs the player that dimension and
// never their position.
export function parseTargetFramePos(raw: string | null | undefined): TargetFramePos | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const nums = ['left', 'top'].map((k) => o[k]);
    if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null;
    const [left, top] = nums as number[];
    const out: TargetFramePos = { left, top };
    const finiteScale = (v: unknown): number | undefined =>
      typeof v === 'number' && Number.isFinite(v) ? clampFrameScale(v) : undefined;
    const scale = finiteScale(o.scale);
    const scaleX = finiteScale(o.scaleX);
    const scaleY = finiteScale(o.scaleY);
    if (scaleX !== undefined || scaleY !== undefined) {
      // A lone surviving axis falls back to the uniform field (or 1) for the
      // other, so a half-corrupt payload still resolves both axes.
      out.scaleX = scaleX ?? scale ?? 1;
      out.scaleY = scaleY ?? scale ?? 1;
    } else if (scale !== undefined) {
      out.scale = scale;
    }
    if (typeof o.w === 'number' && Number.isFinite(o.w)) out.w = clampFrameBox(o.w);
    if (typeof o.h === 'number' && Number.isFinite(o.h)) out.h = clampFrameBox(o.h);
    // Both viewport fields or neither: a lone axis cannot re-anchor honestly.
    if (
      typeof o.vw === 'number' &&
      Number.isFinite(o.vw) &&
      o.vw > 0 &&
      typeof o.vh === 'number' &&
      Number.isFinite(o.vh) &&
      o.vh > 0
    ) {
      out.vw = o.vw;
      out.vh = o.vh;
    }
    return out;
  } catch {
    return null;
  }
}
