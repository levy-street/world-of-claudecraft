// The raid atlas's camera: zoom and pan over one map page, as pure state.
//
// A page is a square of instance-local yards (raid_atlas_plan_core.ts). Page
// space is (u, v) yards from the page's top-left corner, mirrored like the
// existing dungeon map and minimap: u = maxX - x, v = maxZ - z. The camera
// holds a CURRENT view and a TARGET view; input moves the target (a wheel
// notch, a button, the reset) or both (a drag or a pinch follows the finger
// exactly), and `step` eases the current view toward the target on the frame
// clock, so a zoom glides instead of jumping. Every view is clamped: the page
// always fills the canvas, zoom stays in [1, RAID_ATLAS_MAX_ZOOM].
//
// DOM-free and deterministic: time arrives as an argument.

import type { RaidAtlasBounds } from './raid_atlas_plan_core';

export const RAID_ATLAS_MIN_ZOOM = 1;
export const RAID_ATLAS_MAX_ZOOM = 6;
/** The zoom a button press or a reset glides by. */
export const RAID_ATLAS_BUTTON_STEP = 1.6;
/** Easing rate (per second) of the glide toward the target. */
const GLIDE_RATE = 13;
/** Below these the glide snaps home (and stops asking for frames). */
const ZOOM_EPS = 0.002;
const PAN_EPS = 0.02;

export interface RaidAtlasView {
  zoom: number;
  /** View centre in page yards. */
  cu: number;
  cv: number;
}

export interface RaidAtlasScreenPoint {
  sx: number;
  sy: number;
}

/** Page span (yards) of a square page. */
export function pageSpan(bounds: RaidAtlasBounds): number {
  return Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
}

/** Page (u, v) of an instance-local point. */
export function toPage(bounds: RaidAtlasBounds, x: number, z: number): { u: number; v: number } {
  return { u: bounds.maxX - x, v: bounds.maxZ - z };
}

/** Instance-local point of a page (u, v). */
export function fromPage(bounds: RaidAtlasBounds, u: number, v: number): { x: number; z: number } {
  return { x: bounds.maxX - u, z: bounds.maxZ - v };
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return RAID_ATLAS_MIN_ZOOM;
  return Math.max(RAID_ATLAS_MIN_ZOOM, Math.min(RAID_ATLAS_MAX_ZOOM, zoom));
}

/** The view clamped so the page always covers the canvas. */
export function clampView(view: RaidAtlasView, span: number): RaidAtlasView {
  const zoom = clampZoom(view.zoom);
  const half = span / (2 * zoom);
  const clampAxis = (c: number) =>
    Number.isFinite(c) ? Math.max(half, Math.min(span - half, c)) : span / 2;
  return { zoom, cu: clampAxis(view.cu), cv: clampAxis(view.cv) };
}

/** Screen pixels per page yard for a view on a canvas `side` px wide. */
export function viewScale(view: RaidAtlasView, span: number, side: number): number {
  return (side / span) * view.zoom;
}

export function pageToScreen(
  view: RaidAtlasView,
  span: number,
  side: number,
  u: number,
  v: number,
): RaidAtlasScreenPoint {
  const s = viewScale(view, span, side);
  return { sx: (u - view.cu) * s + side / 2, sy: (v - view.cv) * s + side / 2 };
}

export function screenToPage(
  view: RaidAtlasView,
  span: number,
  side: number,
  sx: number,
  sy: number,
): { u: number; v: number } {
  const s = viewScale(view, span, side);
  return { u: (sx - side / 2) / s + view.cu, v: (sy - side / 2) / s + view.cv };
}

/** The view zoomed by `factor` about a screen point: the page point under it
 *  stays under it (the classic cursor-centred zoom). */
export function zoomViewAt(
  view: RaidAtlasView,
  span: number,
  side: number,
  factor: number,
  sx: number,
  sy: number,
): RaidAtlasView {
  const anchor = screenToPage(view, span, side, sx, sy);
  const zoom = clampZoom(view.zoom * factor);
  const s = (side / span) * zoom;
  return clampView(
    { zoom, cu: anchor.u - (sx - side / 2) / s, cv: anchor.v - (sy - side / 2) / s },
    span,
  );
}

/** The view panned so the page moves by a screen delta (a drag). */
export function panView(
  view: RaidAtlasView,
  span: number,
  side: number,
  dx: number,
  dy: number,
): RaidAtlasView {
  const s = viewScale(view, span, side);
  return clampView({ zoom: view.zoom, cu: view.cu - dx / s, cv: view.cv - dy / s }, span);
}

/** The whole page. */
export function homeView(span: number): RaidAtlasView {
  return { zoom: RAID_ATLAS_MIN_ZOOM, cu: span / 2, cv: span / 2 };
}

/** A wheel delta (pixels or lines, normalised to pixels) as a zoom factor:
 *  a mouse notch (about 100 px) is about 1.25, a trackpad's small deltas a
 *  small continuous step. */
export function wheelZoomFactor(deltaPx: number): number {
  if (!Number.isFinite(deltaPx) || deltaPx === 0) return 1;
  const clamped = Math.max(-240, Math.min(240, deltaPx));
  return Math.exp(-clamped * 0.0023);
}

/**
 * The camera: a current view easing toward a target view. Pure state; the
 * controller feeds it input and the frame clock.
 */
export class RaidAtlasCamera {
  private span = 100;
  current: RaidAtlasView = homeView(100);
  target: RaidAtlasView = homeView(100);

  /** Frame a new page (its span): the whole page, no glide. */
  setPage(span: number): void {
    this.span = span > 0 ? span : 100;
    this.current = homeView(this.span);
    this.target = homeView(this.span);
  }

  get pageSpanYd(): number {
    return this.span;
  }

  /** Glide the target by `factor` about a screen point. Successive wheel
   *  notches compound on the target, so a fast spin keeps gliding. */
  zoomAt(factor: number, side: number, sx: number, sy: number): void {
    // Anchor on the CURRENT view's point under the cursor, but compound the
    // zoom on the target: the point under the cursor is what the eye holds.
    const anchor = screenToPage(this.current, this.span, side, sx, sy);
    const zoom = clampZoom(this.target.zoom * factor);
    const s = (side / this.span) * zoom;
    this.target = clampView(
      { zoom, cu: anchor.u - (sx - side / 2) / s, cv: anchor.v - (sy - side / 2) / s },
      this.span,
    );
  }

  /** Zoom immediately (a pinch follows the fingers). */
  zoomNow(factor: number, side: number, sx: number, sy: number): void {
    this.current = zoomViewAt(this.current, this.span, side, factor, sx, sy);
    this.target = { ...this.current };
  }

  /** Pan immediately (a drag holds the paper under the pointer). */
  panNow(dx: number, dy: number, side: number): void {
    this.current = panView(this.current, this.span, side, dx, dy);
    this.target = { ...this.current };
  }

  /** Glide back to the whole page. */
  reset(): void {
    this.target = homeView(this.span);
  }

  /** Glide to centre a page point at a zoom. */
  focus(u: number, v: number, zoom: number): void {
    this.target = clampView({ zoom, cu: u, cv: v }, this.span);
  }

  /** True while the current view still has somewhere to glide. */
  gliding(): boolean {
    const c = this.current;
    const t = this.target;
    return (
      Math.abs(c.zoom - t.zoom) > ZOOM_EPS ||
      Math.abs(c.cu - t.cu) > PAN_EPS ||
      Math.abs(c.cv - t.cv) > PAN_EPS
    );
  }

  /** Ease toward the target over `dt` seconds. Returns true when it moved. */
  step(dt: number): boolean {
    if (!this.gliding()) {
      this.current = { ...this.target };
      return false;
    }
    const k = 1 - Math.exp(-GLIDE_RATE * Math.max(0, Math.min(0.1, dt)));
    const c = this.current;
    const t = this.target;
    // Zoom eases in log space so in and out feel the same.
    const zoom = Math.exp(Math.log(c.zoom) + (Math.log(t.zoom) - Math.log(c.zoom)) * k);
    this.current = clampView(
      { zoom, cu: c.cu + (t.cu - c.cu) * k, cv: c.cv + (t.cv - c.cv) * k },
      this.span,
    );
    if (!this.gliding()) this.current = { ...this.target };
    return true;
  }

  atHome(): boolean {
    return this.target.zoom <= RAID_ATLAS_MIN_ZOOM + ZOOM_EPS;
  }

  atMax(): boolean {
    return this.target.zoom >= RAID_ATLAS_MAX_ZOOM - ZOOM_EPS;
  }
}
