// Map-editor camera and hit-testing. Pure: no DOM, no canvas, no Three. The DOM
// app (app.ts) owns mouse events and pixels; this module owns the world<->screen
// transform and which handle a click lands on, so it can be unit-tested in Node.
//
// World convention matches the sim's top-down plane: +x is east (screen right),
// +z is south (screen down). One world unit is one yard.

export interface Vec2 {
  x: number;
  z: number;
}

export interface ScreenPoint {
  sx: number;
  sy: number;
}

export interface Viewport {
  width: number;
  height: number;
}

// A draggable point on the map. `radius` is its world-space pick radius (yards);
// markers with no inherent size use a small default so they stay clickable.
export interface Handle extends Vec2 {
  id: string;
  radius: number;
}

// Camera state: the world point pinned to the viewport centre, and the zoom in
// screen pixels per world yard. Mutated in place by pan()/zoomAt() so the app can
// hold one instance across frames.
export class Camera {
  center: Vec2;
  pxPerYard: number;
  readonly minZoom: number;
  readonly maxZoom: number;

  constructor(center: Vec2 = { x: 0, z: 0 }, pxPerYard = 2, minZoom = 0.25, maxZoom = 16) {
    this.center = { x: center.x, z: center.z };
    this.pxPerYard = clamp(pxPerYard, minZoom, maxZoom);
    this.minZoom = minZoom;
    this.maxZoom = maxZoom;
  }

  worldToScreen(p: Vec2, vp: Viewport): ScreenPoint {
    return {
      sx: vp.width / 2 + (p.x - this.center.x) * this.pxPerYard,
      sy: vp.height / 2 + (p.z - this.center.z) * this.pxPerYard,
    };
  }

  screenToWorld(s: ScreenPoint, vp: Viewport): Vec2 {
    return {
      x: this.center.x + (s.sx - vp.width / 2) / this.pxPerYard,
      z: this.center.z + (s.sy - vp.height / 2) / this.pxPerYard,
    };
  }

  // Pan by a screen-pixel delta (e.g. a mouse drag of the background).
  panByPixels(dxPx: number, dyPx: number): void {
    this.center.x -= dxPx / this.pxPerYard;
    this.center.z -= dyPx / this.pxPerYard;
  }

  // Zoom by a multiplicative factor while keeping the world point under the cursor
  // fixed on screen (the standard scroll-to-cursor feel).
  zoomAt(anchor: ScreenPoint, factor: number, vp: Viewport): void {
    const before = this.screenToWorld(anchor, vp);
    this.pxPerYard = clamp(this.pxPerYard * factor, this.minZoom, this.maxZoom);
    const after = this.screenToWorld(anchor, vp);
    // Shift the centre so `before` and `after` coincide: the anchor stays put.
    this.center.x += before.x - after.x;
    this.center.z += before.z - after.z;
  }

  // Fit a world-space bounding box into the viewport with a margin (fraction of the
  // smaller viewport dimension). Used to frame a zone when it is selected.
  frame(min: Vec2, max: Vec2, vp: Viewport, margin = 0.08): void {
    this.center = { x: (min.x + max.x) / 2, z: (min.z + max.z) / 2 };
    const spanX = Math.max(1, max.x - min.x);
    const spanZ = Math.max(1, max.z - min.z);
    const usableW = vp.width * (1 - 2 * margin);
    const usableH = vp.height * (1 - 2 * margin);
    const fit = Math.min(usableW / spanX, usableH / spanZ);
    this.pxPerYard = clamp(fit, this.minZoom, this.maxZoom);
  }
}

// Topmost handle under a screen point, or null. `handles` is treated as
// back-to-front; the LAST match wins so the visually-on-top marker is picked.
// `slopPx` widens every handle's pick area so tiny markers remain grabbable.
export function pickHandle(
  handles: readonly Handle[],
  s: ScreenPoint,
  cam: Camera,
  vp: Viewport,
  slopPx = 6,
): Handle | null {
  let hit: Handle | null = null;
  for (const h of handles) {
    const c = cam.worldToScreen(h, vp);
    const rPx = h.radius * cam.pxPerYard + slopPx;
    const dx = s.sx - c.sx;
    const dy = s.sy - c.sy;
    if (dx * dx + dy * dy <= rPx * rPx) hit = h;
  }
  return hit;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
