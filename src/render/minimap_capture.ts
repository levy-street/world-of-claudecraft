// Live top-down capture that feeds the HUD minimap.
//
// The minimap used to upscale a PAINTED plate: a 140px canvas covering the
// whole 1080x2600 yard world (0.13 px/yard, blown up ~26x at zoom 1 and ~79x
// at zoom 3), with a per-zone 480px plate blitted over it when one had been
// rendered. In the editor's playtest that plate is never a baked asset —
// bakedMapBgEligible() is false the moment the active world is maker content —
// so it had to be re-painted procedurally on the idle lane, and until it
// landed the minimap was a green smudge.
//
// This renders the REAL scene instead: an orthographic camera straight down
// over the player, into a small render target, read back asynchronously into a
// canvas the 2D painter blits. That is sharp at every zoom (the captured yard
// span follows the zoom, so pixels-per-yard is always matched to the display),
// it always agrees with the world — a maker's painted terrain, their
// placements, their water — and it needs no plates, no prewarm and no cache.
//
// COST CONTROL, in order of how much they matter:
//   * the capture is a plain forward render of geometry that is ALREADY
//     resident and already culled for this frame, at 384x384 = 147k pixels
//     (about 3% of a 1080p frame's fill), with no post-processing pass;
//   * shadow map auto-update is off for the capture, so the shadow pass does
//     not run a second time;
//   * it runs at most every MIN_CAPTURE_MS, and not at all while the player is
//     standing still with the view unchanged (past IDLE_REFRESH_MS);
//   * the readback is `readRenderTargetPixelsAsync`, which fences instead of
//     stalling the pipeline the way a synchronous readPixels would;
//   * one capture is in flight at a time.
//
// Between captures the painter blits the last frame at a sub-pixel offset from
// the player's live position, so motion stays continuous at the full HUD
// redraw rate rather than stepping at the capture rate.

import * as THREE from 'three';

/** Render-target edge, in pixels. Sized so the disc (162 CSS px) is covered at
 *  device-pixel-ratio 2 with the movement margin still inside the frame:
 *  384 / CAPTURE_MARGIN = 325 px across the visible circle vs the 324 a DPR-2
 *  display asks for. */
const CAPTURE_PX = 384;

/** Captured span over visible span. The overshoot is what lets the painter
 *  keep blitting a slightly stale frame at a sub-pixel offset while the player
 *  moves, instead of running short at the edges. */
const CAPTURE_MARGIN = 1.18;

/** Floor on the interval between captures (ms). ~8Hz while running. */
const MIN_CAPTURE_MS = 120;

/** Recapture even when nothing about the view changed, so water, weather light
 *  and the day/night cycle stay current on a stationary player. */
const IDLE_REFRESH_MS = 900;

/** Movement (yards) that makes a capture worth redoing before IDLE_REFRESH_MS. */
const MOVE_EPSILON = 0.3;

/** Height above the player the ortho camera sits at, and its depth range. Well
 *  clear of the tallest terrain while keeping the near plane off the canopy. */
const CAMERA_HEIGHT = 520;
const CAMERA_NEAR = 1;
const CAMERA_FAR = 1400;

/** The last completed capture: an image plus the world square it covers. */
export interface MinimapCaptureFrame {
  canvas: HTMLCanvasElement;
  /** World centre of the captured square. */
  centerX: number;
  centerZ: number;
  /** Half-extent of the captured square, in yards. */
  halfYards: number;
}

/**
 * Owns the render target, the ortho camera and the readback for the HUD
 * minimap. The caller (Renderer) is responsible for hiding what must not
 * appear and restoring it afterwards — this class only knows how to point a
 * camera down and turn the result into a canvas.
 */
export class MinimapCapture {
  private rt: THREE.WebGLRenderTarget | null = null;
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, CAMERA_NEAR, CAMERA_FAR);
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private image: ImageData | null = null;
  private pixels: Uint8Array | null = null;
  /** A capture whose readback has not resolved yet; only one runs at a time. */
  private reading = false;
  /** Set once an async readback fails (no WebGL2 / lost context): the HUD then
   *  keeps using the painted-plate fallback for the rest of the session. */
  private unsupported = false;
  private frame: MinimapCaptureFrame | null = null;
  private lastCaptureAt = 0;
  private lastCenterX = Number.NaN;
  private lastCenterZ = Number.NaN;
  private lastHalfYards = 0;

  constructor() {
    // Screen-right is -X and screen-down is -Z, matching the marker projection
    // in minimap_markers.ts (`mx = half - (x - px) * s`). With the view
    // direction straight down, an up vector of +Z puts +Z at the top of the
    // image, which lands the camera's own +X axis on world -X.
    this.camera.up.set(0, 0, 1);
  }

  /** The most recent completed capture, or null before the first one lands. */
  latest(): MinimapCaptureFrame | null {
    return this.frame;
  }

  /** False once the platform has proven it cannot do an async readback. */
  available(): boolean {
    return !this.unsupported;
  }

  /**
   * Whether a capture is worth doing this frame. Split out from `capture` so
   * the caller can skip its own hide/restore bookkeeping on the (common)
   * frames where nothing would be rendered.
   */
  isDue(centerX: number, centerZ: number, visibleHalfYards: number, now: number): boolean {
    if (this.unsupported || this.reading) return false;
    if (now - this.lastCaptureAt < MIN_CAPTURE_MS) return false;
    const halfYards = Math.max(1, visibleHalfYards * CAPTURE_MARGIN);
    const moved =
      Math.abs(centerX - this.lastCenterX) > MOVE_EPSILON ||
      Math.abs(centerZ - this.lastCenterZ) > MOVE_EPSILON ||
      Math.abs(halfYards - this.lastHalfYards) > 0.01;
    return moved || now - this.lastCaptureAt >= IDLE_REFRESH_MS;
  }

  /**
   * Render the top-down view. `visibleHalfYards` is the half-extent the
   * minimap actually shows at the current zoom; the captured square is that
   * plus the movement margin. Call only when `isDue` said so — the caller is
   * expected to have hidden what must not appear.
   */
  capture(
    webgl: THREE.WebGLRenderer,
    scene: THREE.Scene,
    centerX: number,
    centerZ: number,
    visibleHalfYards: number,
    now: number,
  ): void {
    if (this.unsupported || this.reading) return;
    const halfYards = Math.max(1, visibleHalfYards * CAPTURE_MARGIN);
    const rt = this.ensureTarget();
    this.camera.left = -halfYards;
    this.camera.right = halfYards;
    this.camera.top = halfYards;
    this.camera.bottom = -halfYards;
    this.camera.position.set(centerX, CAMERA_HEIGHT, centerZ);
    this.camera.lookAt(centerX, 0, centerZ);
    this.camera.updateProjectionMatrix();

    const previousTarget = webgl.getRenderTarget();
    // Re-running the shadow pass for this camera would double the frame's
    // shadow cost for a 384px thumbnail. The map rendered for the main camera
    // is still bound and is the correct one — same light, same world.
    const shadowAuto = webgl.shadowMap.autoUpdate;
    // The post-processing composer leaves autoClear off inside its own passes;
    // this runs after it, but pin the flag rather than inherit whatever the
    // last pass left, so the target can never accumulate the previous capture.
    const autoClear = webgl.autoClear;
    webgl.shadowMap.autoUpdate = false;
    webgl.autoClear = true;
    webgl.setRenderTarget(rt);
    webgl.clear();
    webgl.render(scene, this.camera);
    webgl.setRenderTarget(previousTarget);
    webgl.autoClear = autoClear;
    webgl.shadowMap.autoUpdate = shadowAuto;

    this.lastCaptureAt = now;
    this.lastCenterX = centerX;
    this.lastCenterZ = centerZ;
    this.lastHalfYards = halfYards;
    void this.readBack(webgl, rt, centerX, centerZ, halfYards);
  }

  private async readBack(
    webgl: THREE.WebGLRenderer,
    rt: THREE.WebGLRenderTarget,
    centerX: number,
    centerZ: number,
    halfYards: number,
  ): Promise<void> {
    const pixels = this.pixels;
    const image = this.image;
    const ctx = this.ctx;
    const canvas = this.canvas;
    if (!pixels || !image || !ctx || !canvas) return;
    this.reading = true;
    try {
      await webgl.readRenderTargetPixelsAsync(rt, 0, 0, CAPTURE_PX, CAPTURE_PX, pixels);
    } catch {
      // No async readback on this platform (or the context went away): stop
      // trying. The painter's plate fallback covers it.
      this.unsupported = true;
      this.reading = false;
      return;
    }
    this.reading = false;
    // GL hands back rows bottom-up; the canvas wants them top-down.
    const stride = CAPTURE_PX * 4;
    const out = image.data;
    for (let row = 0; row < CAPTURE_PX; row++) {
      const from = (CAPTURE_PX - 1 - row) * stride;
      out.set(pixels.subarray(from, from + stride), row * stride);
    }
    ctx.putImageData(image, 0, 0);
    this.frame = { canvas, centerX, centerZ, halfYards };
  }

  private ensureTarget(): THREE.WebGLRenderTarget {
    if (this.rt) return this.rt;
    this.rt = new THREE.WebGLRenderTarget(CAPTURE_PX, CAPTURE_PX, {
      // Linear filtering: the painter draws this at roughly 1:1, and the
      // occasional fractional scale should soften rather than alias.
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });
    const canvas = document.createElement('canvas');
    canvas.width = CAPTURE_PX;
    canvas.height = CAPTURE_PX;
    const ctx = canvas.getContext('2d');
    this.canvas = canvas;
    this.ctx = ctx;
    if (ctx) this.image = ctx.createImageData(CAPTURE_PX, CAPTURE_PX);
    this.pixels = new Uint8Array(CAPTURE_PX * CAPTURE_PX * 4);
    return this.rt;
  }

  dispose(): void {
    this.rt?.dispose();
    this.rt = null;
    this.canvas = null;
    this.ctx = null;
    this.image = null;
    this.pixels = null;
    this.frame = null;
  }
}

/** Visible half-extent (yards) of a minimap disc `sizePx` across drawn at
 *  `pxPerYard`. Pure so the capture extent and the painter's blit can be
 *  derived from one definition. */
export function minimapVisibleHalfYards(sizePx: number, pxPerYard: number): number {
  return sizePx / 2 / Math.max(0.0001, pxPerYard);
}

/** Destination rect (minimap canvas pixels) for blitting a captured frame. */
export interface MinimapBlitRect {
  x: number;
  y: number;
  size: number;
}

/**
 * Where to draw a captured frame on the minimap so its world square lands
 * exactly where the markers for the same world points land.
 *
 * The marker projection (minimap_markers.ts) is `mx = S/2 - (x - px) * s`, so
 * screen-right is world -X and screen-down is world -Z; the capture camera's
 * up vector is set to +Z to match. The capture image's top-left pixel is
 * therefore the world corner (centerX + halfYards, centerZ + halfYards), and
 * the image spans 2 * halfYards on each axis.
 *
 * Note it is placed by where the capture WAS TAKEN, not by where the player is
 * now: that is what keeps the picture sliding continuously with the player
 * between captures instead of stepping at the capture rate.
 */
export function minimapCaptureBlitRect(
  frame: MinimapCaptureFrame,
  playerX: number,
  playerZ: number,
  sizePx: number,
  pxPerYard: number,
): MinimapBlitRect {
  const h = frame.halfYards;
  return {
    x: sizePx / 2 - (frame.centerX + h - playerX) * pxPerYard,
    y: sizePx / 2 - (frame.centerZ + h - playerZ) * pxPerYard,
    size: h * 2 * pxPerYard,
  };
}
