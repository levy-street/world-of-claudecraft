// Editor-only performance overlay: a small live readout pinned to the 3D
// viewport corner (FPS, frame time, draw calls, triangles, placed-asset count,
// terrain-edit count). Configurable from the Camera tab; purely presentational
// (dev tooling), so it never affects the world or playtest. Self-contained: it
// owns its DOM node and is fed a stats snapshot each frame by the viewport.

/** Which readouts the overlay shows (all independently toggleable). */
export interface PerfOverlayConfig {
  enabled: boolean;
  fps: boolean;
  frameMs: boolean;
  assets: boolean;
  /** Triangles the renderer drew last frame (the whole scene, after culling). */
  tris: boolean;
  /** Triangles in the selected placements' models (all members of a multi-selection). */
  selTris: boolean;
  terrain: boolean;
  streaming: boolean;
  coords: boolean;
}

/** One frame's measured stats. */
export interface PerfStats {
  fps: number;
  frameMs: number;
  assets: number;
  tris: number;
  selTris: number;
  terrain: number;
  streaming: string;
  /** The camera's world focus point (orbit pivot / look target). */
  coordX: number;
  coordZ: number;
}

/** Localized labels for each row (the viewport passes these; this module stays
 *  i18n-free so it is trivially unit-testable). */
export interface PerfOverlayLabels {
  fps: string;
  frameMs: string;
  assets: string;
  tris: string;
  selTris: string;
  terrain: string;
  streaming: string;
  coords: string;
}

type Field = 'fps' | 'frameMs' | 'assets' | 'tris' | 'selTris' | 'terrain' | 'streaming' | 'coords';

const FIELDS: Field[] = [
  'fps',
  'frameMs',
  'assets',
  'tris',
  'selTris',
  'terrain',
  'streaming',
  'coords',
];

/** Group thousands with a plain separator (no locale dependency, no Intl churn
 *  on a per-frame path). */
function groupThousands(n: number): string {
  const s = String(Math.round(n));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatValue(field: Field, stats: PerfStats): string {
  switch (field) {
    case 'fps':
      return String(Math.round(stats.fps));
    case 'frameMs':
      return stats.frameMs.toFixed(1);
    case 'coords':
      // World X, Z of the camera focus (rounded to whole yards).
      return `${Math.round(stats.coordX)}, ${Math.round(stats.coordZ)}`;
    case 'streaming':
      return stats.streaming;
    default:
      return groupThousands(stats[field]);
  }
}

export class EditorPerfOverlay {
  private readonly root: HTMLElement;
  private readonly rows = new Map<Field, { row: HTMLElement; value: HTMLElement }>();
  private cfg: PerfOverlayConfig = {
    enabled: false,
    fps: true,
    frameMs: true,
    assets: true,
    tris: true,
    selTris: true,
    terrain: true,
    streaming: true,
    coords: true,
  };

  constructor(parent: HTMLElement, labels: PerfOverlayLabels) {
    this.root = document.createElement('div');
    this.root.className = 'editor-perf-overlay';
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'off');
    this.root.style.display = 'none';
    for (const field of FIELDS) {
      const row = document.createElement('div');
      row.className = 'editor-perf-row';
      const label = document.createElement('span');
      label.className = 'editor-perf-label';
      label.textContent = labels[field];
      const value = document.createElement('span');
      value.className = 'editor-perf-value';
      value.textContent = '-';
      row.append(label, value);
      this.root.appendChild(row);
      this.rows.set(field, { row, value });
    }
    parent.appendChild(this.root);
  }

  /** Swap the visible readouts (and overall on/off). */
  setConfig(cfg: PerfOverlayConfig): void {
    this.cfg = cfg;
    this.root.style.display = cfg.enabled ? '' : 'none';
    for (const field of FIELDS) {
      const entry = this.rows.get(field);
      if (entry) entry.row.style.display = cfg[field] ? '' : 'none';
    }
  }

  get enabled(): boolean {
    return this.cfg.enabled;
  }

  /** Write the latest stats into the visible rows (no-op while hidden). */
  update(stats: PerfStats): void {
    if (!this.cfg.enabled) return;
    for (const field of FIELDS) {
      if (!this.cfg[field]) continue;
      const entry = this.rows.get(field);
      if (entry) entry.value.textContent = formatValue(field, stats);
    }
  }

  dispose(): void {
    this.root.remove();
    this.rows.clear();
  }
}
