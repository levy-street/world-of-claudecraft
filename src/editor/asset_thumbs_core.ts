// Pure math + bookkeeping behind the asset browser's real 3D thumbnails:
// the bbox-framing camera pose (fit a bounding sphere into the preview
// frustum at a 3/4 top-down angle) and the snapshot cache/queue state
// machine (FIFO-capped cache, dedupe, stale-skip, permanent failure,
// concurrency accounting). DOM/Three-free so plain-Node Vitest drives it
// (tests/editor_asset_thumbs.test.ts); asset_thumbs.ts is the thin GL
// consumer.

export interface ThumbVec3 {
  x: number;
  y: number;
  z: number;
}

export interface ThumbPose {
  position: ThumbVec3;
  target: ThumbVec3;
}

// The classic catalogue-shot angle: yaw the camera off the model's front and
// pitch it above the horizon so tall and flat assets both read at a glance.
export const THUMB_YAW_RAD = 0.7;
export const THUMB_PITCH_RAD = 0.5;
// Breathing room so the bounding sphere never kisses the frame edge.
export const THUMB_FIT_MARGIN = 1.15;
// Degenerate GLBs (empty scenes, single points) still get a sane camera.
const MIN_RADIUS = 0.05;

/** Deterministic hue from an asset id (shared with the procedural placeholder). */
export function hashHue(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 360;
}

/**
 * Camera distance at which a sphere of `radius` fits both the vertical fov
 * and the horizontal fov it implies at `aspect`, with a small margin.
 */
export function fitDistance(
  radius: number,
  fovDeg: number,
  aspect: number,
  margin = THUMB_FIT_MARGIN,
): number {
  const r = Number.isFinite(radius) && radius > MIN_RADIUS ? radius : MIN_RADIUS;
  const vHalf = (fovDeg * Math.PI) / 360;
  const hHalf = Math.atan(Math.tan(vHalf) * aspect);
  const half = Math.min(vHalf, hHalf);
  return (r * margin) / Math.sin(half);
}

/**
 * Full thumbnail camera pose for a model bounding sphere: position on the
 * fixed 3/4 top-down direction at fit distance, looking at the center.
 */
export function thumbPose(
  center: ThumbVec3,
  radius: number,
  fovDeg: number,
  aspect: number,
): ThumbPose {
  const d = fitDistance(radius, fovDeg, aspect);
  const cosPitch = Math.cos(THUMB_PITCH_RAD);
  const dir = {
    x: Math.sin(THUMB_YAW_RAD) * cosPitch,
    y: Math.sin(THUMB_PITCH_RAD),
    z: Math.cos(THUMB_YAW_RAD) * cosPitch,
  };
  return {
    position: { x: center.x + dir.x * d, y: center.y + dir.y * d, z: center.z + dir.z * d },
    target: { ...center },
  };
}

/**
 * Snapshot bookkeeping: a FIFO-capped cache of finished thumbnails, a
 * permanent failure set (no retry storms), and a pending queue with dedupe,
 * cheap stale-skip (via the caller's isWanted probe), and an in-flight set
 * that enforces the concurrency cap. Value type is generic so tests run it
 * without a canvas.
 */
export class ThumbBook<T> {
  private readonly cache = new Map<string, T>();
  private readonly failed = new Set<string>();
  private readonly pending: string[] = [];
  private readonly queued = new Set<string>();
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly cap: number,
    private readonly concurrency: number,
  ) {}

  get(id: string): T | undefined {
    return this.cache.get(id);
  }

  /** Store a finished thumbnail, evicting the oldest entry past the cap. */
  put(id: string, value: T): void {
    if (!this.cache.has(id) && this.cache.size >= this.cap) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(id, value);
  }

  /** Mark an id permanently failed: the procedural placeholder stays. */
  markFailed(id: string): void {
    this.failed.add(id);
  }

  isFailed(id: string): boolean {
    return this.failed.has(id);
  }

  /** Queue an id for snapshotting; false when nothing new to do. */
  enqueue(id: string): boolean {
    if (this.cache.has(id) || this.failed.has(id)) return false;
    if (this.queued.has(id) || this.inFlight.has(id)) return false;
    this.queued.add(id);
    this.pending.push(id);
    return true;
  }

  canStart(): boolean {
    return this.inFlight.size < this.concurrency;
  }

  /**
   * Pop the next id still worth rendering, skipping entries that resolved,
   * failed, or are no longer wanted (grid re-rendered) since being queued.
   * The returned id is accounted in-flight until settle().
   */
  takeNext(isWanted: (id: string) => boolean): string | null {
    while (this.pending.length > 0) {
      const id = this.pending.shift() as string;
      this.queued.delete(id);
      if (this.cache.has(id) || this.failed.has(id) || this.inFlight.has(id)) continue;
      if (!isWanted(id)) continue;
      this.inFlight.add(id);
      return id;
    }
    return null;
  }

  settle(id: string): void {
    this.inFlight.delete(id);
  }

  /** Drop all queued work (e.g. the GL context is gone for good). */
  clearPending(): void {
    this.pending.length = 0;
    this.queued.clear();
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  get inFlightCount(): number {
    return this.inFlight.size;
  }

  get size(): number {
    return this.cache.size;
  }
}
