// Canvas painter for the painted map of an authored open-air dungeon field
// (plan: field_map_view.ts). Rasterises ONE plate per field, once, at a fixed
// resolution: the sea (or the chasm mist) with its shoals and swell, a drop
// shadow under every terrace, the terraces tinted by their ground and height
// with a stone, cobble, plank or mud texture, stair treads, inked cliffs with
// hachures and surf where they meet the sea, walls with crenels, the kit's
// props, landmark icons (the Fogbeacon, the chapel, towers, wells), the gates
// and seals, and a vignette. The dungeon map painter scales that plate onto
// the M-map and the minimap under the live markers.
//
// Colours are design tokens resolved once (a 2D canvas cannot read CSS
// variables); no raw colour lives here.

import { type FieldMapPlan, type FieldMapSegment, fieldMapHeightShare } from './field_map_view';

/** Plate resolution (pixels per yard). */
export const FIELD_MAP_PX_PER_YARD = 3;

const FIELD_MAP_TOKENS = {
  sea: '--color-field-map-sea',
  seaDeep: '--color-field-map-sea-deep',
  shoal: '--color-field-map-shoal',
  foam: '--color-field-map-foam',
  mist: '--color-field-map-mist',
  mistSwirl: '--color-field-map-mist-swirl',
  canopy: '--color-field-map-canopy',
  canopyDark: '--color-field-map-canopy-dark',
  canopyLight: '--color-field-map-canopy-light',
  ink: '--color-field-map-ink',
  shadow: '--color-field-map-shadow',
  highlight: '--color-field-map-highlight',
  flagstone: '--color-field-map-flagstone',
  earth: '--color-field-map-earth',
  grave: '--color-field-map-grave',
  frost: '--color-field-map-frost',
  bone: '--color-field-map-bone',
  ritual: '--color-field-map-ritual',
  mud: '--color-field-map-mud',
  wetstone: '--color-field-map-wetstone',
  quay: '--color-field-map-quay',
  shallows: '--color-field-map-shallows',
  moss: '--color-field-map-moss',
  basalt: '--color-field-map-basalt',
  plate: '--color-field-map-plate',
  grating: '--color-field-map-grating',
  soot: '--color-field-map-soot',
  snow: '--color-field-map-snow',
  ice: '--color-field-map-ice',
  slate: '--color-field-map-slate',
  crevasse: '--color-field-map-crevasse',
  crevasseDeep: '--color-field-map-crevasse-deep',
  wall: '--color-field-map-wall',
  wallTop: '--color-field-map-wall-top',
  prop: '--color-field-map-prop',
  gate: '--color-field-map-gate',
  seal: '--color-field-map-seal',
  beacon: '--color-field-map-beacon',
  vignette: '--color-field-map-vignette',
  vignetteClear: '--color-field-map-vignette-clear',
} as const;

type FieldMapColors = Record<keyof typeof FIELD_MAP_TOKENS, string>;

function hash(x: number, y: number): number {
  const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

export class FieldMapPlateArt {
  private colors: FieldMapColors | null = null;
  private readonly plates = new WeakMap<FieldMapPlan, HTMLCanvasElement>();

  private resolve(): FieldMapColors {
    if (this.colors) return this.colors;
    const styles = getComputedStyle(document.documentElement);
    const colors = {} as FieldMapColors;
    for (const key of Object.keys(FIELD_MAP_TOKENS) as (keyof typeof FIELD_MAP_TOKENS)[]) {
      colors[key] = styles.getPropertyValue(FIELD_MAP_TOKENS[key]).trim();
    }
    if (colors.sea) this.colors = colors;
    return colors;
  }

  /** The void colour a map canvas fills round the plate. */
  backdrop(plan: FieldMapPlan): string {
    const c = this.resolve();
    if (plan.void === 'crevasse') return c.crevasseDeep;
    return plan.void === 'sea' ? c.seaDeep : plan.void === 'jungle' ? c.canopyDark : c.mist;
  }

  /** The field's painted plate (built once, then cached). */
  plate(plan: FieldMapPlan): HTMLCanvasElement {
    const cached = this.plates.get(plan);
    if (cached) return cached;
    const c = this.resolve();
    const b = plan.bounds;
    const k = FIELD_MAP_PX_PER_YARD;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil((b.maxX - b.minX) * k);
    canvas.height = Math.ceil((b.maxZ - b.minZ) * k);
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    // +X runs map-left, +Z map-up (the dungeon map's projection).
    const px = (x: number): number => (b.maxX - x) * k;
    const py = (z: number): number => (b.maxZ - z) * k;
    const path = (points: readonly [number, number][]): void => {
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const [x, z] = points[i];
        if (i === 0) ctx.moveTo(px(x), py(z));
        else ctx.lineTo(px(x), py(z));
      }
      ctx.closePath();
    };
    const line = (s: FieldMapSegment, ox = 0, oz = 0): void => {
      ctx.beginPath();
      ctx.moveTo(px(s.ax + ox), py(s.az + oz));
      ctx.lineTo(px(s.bx + ox), py(s.bz + oz));
      ctx.stroke();
    };

    // ---- the void: the sea with its shoals and swell, the gorge's jungle
    // canopy with its river, or the chasm mist ----
    ctx.fillStyle = this.backdrop(plan);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (plan.void === 'sea') {
      // Shoals: the water lightens toward every shore, in soft bands.
      for (const [width, alpha] of [
        [26, 0.18],
        [16, 0.22],
        [8, 0.3],
      ] as const) {
        ctx.strokeStyle = c.shoal;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = width * k;
        for (const s of plan.surfaces) {
          path(s.points);
          ctx.stroke();
        }
      }
      // The swell: short crests scattered over the open water.
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = c.sea;
      ctx.lineWidth = 1.2;
      const count = Math.round((canvas.width * canvas.height) / 900);
      for (let i = 0; i < count; i++) {
        const x = hash(i, 1.3) * canvas.width;
        const y = hash(2.7, i) * canvas.height;
        const len = 4 + hash(i, 9.1) * 8;
        ctx.beginPath();
        ctx.arc(x, y + len, len, Math.PI * 1.25, Math.PI * 1.75);
        ctx.stroke();
      }
    } else if (plan.void === 'jungle') {
      this.jungle(ctx, plan, canvas, px, py, c);
    } else if (plan.void === 'crevasse') {
      // Glacier crevasses: the ice glows blue under every lip and darkens into
      // the depth, with long hairline fractures across the dark.
      for (const [width, alpha] of [
        [22, 0.16],
        [12, 0.24],
        [5, 0.34],
      ] as const) {
        ctx.strokeStyle = c.crevasse;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = width * k;
        for (const s of plan.surfaces) {
          path(s.points);
          ctx.stroke();
        }
      }
      ctx.strokeStyle = c.crevasse;
      ctx.lineWidth = 1;
      const cracks = Math.round((canvas.width * canvas.height) / 6000);
      for (let i = 0; i < cracks; i++) {
        ctx.globalAlpha = 0.18 + hash(i, 6.1) * 0.2;
        let x = hash(i, 3.7) * canvas.width;
        let y = hash(8.3, i) * canvas.height;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let j = 0; j < 4; j++) {
          x += (hash(i, j + 0.5) - 0.5) * 40;
          y += 8 + hash(j + 0.3, i) * 26;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = c.mistSwirl;
      for (let i = 0; i < 90; i++) {
        ctx.globalAlpha = 0.08 + hash(i, 4.4) * 0.1;
        ctx.beginPath();
        ctx.ellipse(
          hash(i, 1.1) * canvas.width,
          hash(3.3, i) * canvas.height,
          20 + hash(i, 7.7) * 60,
          8 + hash(i, 5.5) * 20,
          hash(i, 2.2) * Math.PI,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // ---- surf where the cliffs fall into the sea ------------------------------
    if (plan.void === 'sea') {
      ctx.strokeStyle = c.foam;
      for (const [off, alpha, width] of [
        [1.4, 0.75, 1.6],
        [3.2, 0.35, 1.2],
      ] as const) {
        ctx.globalAlpha = alpha;
        ctx.lineWidth = width;
        ctx.setLineDash([6, 4, 2, 5]);
        for (const cl of plan.cliffs) if (cl.intoVoid) line(cl, cl.nx * off, cl.nz * off);
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // ---- the terraces: shadow, fill, texture, rim (in last-wins order) --------
    for (const s of plan.surfaces) {
      const share = fieldMapHeightShare(plan, s.h);
      const drop = 2 + share * 7;
      ctx.save();
      ctx.translate(drop * 0.7, drop);
      ctx.fillStyle = c.shadow;
      path(s.points);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = c[s.ground];
      path(s.points);
      ctx.fill();
      // Height tint: high terraces catch more light than the low yards.
      ctx.globalAlpha = 0.22 * share;
      ctx.fillStyle = c.highlight;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.save();
      path(s.points);
      ctx.clip();
      this.texture(ctx, s.ground, s.points, px, py, c);
      ctx.restore();
      ctx.strokeStyle = c.ink;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.1;
      path(s.points);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // ---- stair treads ------------------------------------------------------------
    ctx.strokeStyle = c.ink;
    ctx.globalAlpha = 0.42;
    ctx.lineWidth = 1;
    for (const t of plan.treads) line(t);
    ctx.globalAlpha = 1;

    // ---- cliffs: an inked lip and hachures down the drop -----------------------
    for (const cl of plan.cliffs) {
      ctx.strokeStyle = c.ink;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = cl.masonry ? 2 : 2.4;
      line(cl);
      if (cl.drop < 1.5) continue;
      const len = Math.hypot(cl.bx - cl.ax, cl.bz - cl.az);
      const n = Math.max(1, Math.floor(len / 1.6));
      const reach = Math.min(4.5, 0.8 + cl.drop * 0.18);
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = cl.ax + (cl.bx - cl.ax) * t;
        const z = cl.az + (cl.bz - cl.az) * t;
        const r = reach * (i % 2 === 0 ? 1 : 0.6);
        ctx.beginPath();
        ctx.moveTo(px(x), py(z));
        ctx.lineTo(px(x + cl.nx * r), py(z + cl.nz * r));
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // ---- walls with crenels -------------------------------------------------------
    for (const w of plan.walls) {
      ctx.fillStyle = c.wall;
      path(w);
      ctx.fill();
      ctx.strokeStyle = c.ink;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      // Crenels along the long side.
      const [a, bb, cc] = w;
      const along = Math.hypot(bb[0] - a[0], bb[1] - a[1]);
      const n = Math.floor(along / 1.8);
      ctx.fillStyle = c.wallTop;
      for (let i = 0; i < n; i += 2) {
        const t0 = i / n;
        const t1 = (i + 1) / n;
        const mid = (p: [number, number], q: [number, number], t: number): [number, number] => [
          p[0] + (q[0] - p[0]) * t,
          p[1] + (q[1] - p[1]) * t,
        ];
        const inner = (t: number): [number, number] => {
          const e = mid(a, bb, t);
          const f = mid([cc[0] - (bb[0] - a[0]), cc[1] - (bb[1] - a[1])], cc, t);
          return mid(e, f, 0.5);
        };
        const p0 = mid(a, bb, t0);
        const p1 = mid(a, bb, t1);
        path([p0, p1, inner(t1), inner(t0)]);
        ctx.fill();
      }
    }

    // ---- the kit's props ------------------------------------------------------------
    for (const p of plan.props) {
      ctx.fillStyle = c.prop;
      ctx.strokeStyle = c.ink;
      ctx.lineWidth = 1;
      if (p.r !== null) {
        ctx.beginPath();
        ctx.arc(px(p.x), py(p.z), Math.max(1.5, p.r * k), 0, Math.PI * 2);
      } else if (p.corners) {
        path(p.corners);
      }
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = c.highlight;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // ---- landmarks -------------------------------------------------------------------
    for (const m of plan.landmarks) this.landmark(ctx, m.kind, px(m.x), py(m.z), c);

    // ---- gateways: a threshold mark across each passage (a SHUT gate is the
    // live marker the dungeon map draws on top; the plate is static) ---------
    for (const g of plan.gates) {
      ctx.strokeStyle = g.seal ? c.seal : c.gate;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([3, 3]);
      line(g);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // ---- vignette ------------------------------------------------------------------------
    const edge = Math.min(canvas.width, canvas.height) * 0.12;
    for (const [x0, y0, x1, y1, rx, ry, rw, rh] of [
      [0, 0, edge, 0, 0, 0, edge, canvas.height],
      [canvas.width, 0, canvas.width - edge, 0, canvas.width - edge, 0, edge, canvas.height],
      [0, 0, 0, edge, 0, 0, canvas.width, edge],
      [0, canvas.height, 0, canvas.height - edge, 0, canvas.height - edge, canvas.width, edge],
    ] as const) {
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, c.vignette);
      g.addColorStop(1, c.vignetteClear);
      ctx.fillStyle = g;
      ctx.fillRect(rx, ry, rw, rh);
    }
    this.plates.set(plan, canvas);
    return canvas;
  }

  /** The gorge floor seen from above: a canopy of crowns, the river winding
   *  through it and the pools under the falls (water, never a sea). */
  private jungle(
    ctx: CanvasRenderingContext2D,
    plan: FieldMapPlan,
    canvas: HTMLCanvasElement,
    px: (x: number) => number,
    py: (z: number) => number,
    c: FieldMapColors,
  ): void {
    const k = FIELD_MAP_PX_PER_YARD;
    // Crowns: a dense scatter, mid-green bodies with lit tops.
    const count = Math.round((canvas.width * canvas.height) / 260);
    for (let i = 0; i < count; i++) {
      const x = hash(i, 3.1) * canvas.width;
      const y = hash(5.7, i) * canvas.height;
      const r = (2.2 + hash(i, 8.3) * 3.4) * k;
      ctx.globalAlpha = 0.55 + hash(i, 2.9) * 0.3;
      ctx.fillStyle = c.canopy;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = c.canopyLight;
      ctx.beginPath();
      ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // The river: a dark bank line, the water, a pale current down its middle.
    const ribbon = (points: readonly [number, number][]): void => {
      ctx.beginPath();
      points.forEach(([x, z], i) => {
        if (i === 0) ctx.moveTo(px(x), py(z));
        else ctx.lineTo(px(x), py(z));
      });
    };
    for (const w of plan.water.lines) {
      ctx.strokeStyle = c.canopyDark;
      ctx.lineWidth = (w.width + 4) * k;
      ribbon(w.points);
      ctx.stroke();
      ctx.strokeStyle = c.shallows;
      ctx.lineWidth = w.width * k;
      ribbon(w.points);
      ctx.stroke();
      ctx.strokeStyle = c.foam;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([7, 6]);
      ribbon(w.points);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    for (const p of plan.water.pools) {
      ctx.fillStyle = c.shallows;
      ctx.beginPath();
      ctx.arc(px(p.x), py(p.z), p.r * k, 0, Math.PI * 2);
      ctx.fill();
      // Foam rings where the falls come down.
      ctx.strokeStyle = c.foam;
      ctx.lineWidth = 1.4;
      for (const [f, a] of [
        [0.4, 0.7],
        [0.7, 0.4],
      ] as const) {
        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.arc(px(p.x), py(p.z), p.r * k * f, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  /** The ground's own texture, clipped to its terrace. */
  private texture(
    ctx: CanvasRenderingContext2D,
    ground: FieldMapPlan['surfaces'][number]['ground'],
    points: readonly [number, number][],
    px: (x: number) => number,
    py: (z: number) => number,
    c: FieldMapColors,
  ): void {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [x, z] of points) {
      minX = Math.min(minX, px(x));
      maxX = Math.max(maxX, px(x));
      minY = Math.min(minY, py(z));
      maxY = Math.max(maxY, py(z));
    }
    const k = FIELD_MAP_PX_PER_YARD;
    ctx.strokeStyle = c.ink;
    ctx.fillStyle = c.ink;
    if (ground === 'grating') {
      // Catwalk grating: fine load bars along the walk.
      ctx.globalAlpha = 0.24;
      ctx.lineWidth = 0.6;
      for (let x = minX; x <= maxX; x += k * 0.7) {
        ctx.beginPath();
        ctx.moveTo(x, minY);
        ctx.lineTo(x, maxY);
        ctx.stroke();
      }
    } else if (ground === 'plate') {
      // Deck plate: a two-yard grid of welded seams.
      const plate = 2 * k;
      ctx.globalAlpha = 0.2;
      ctx.lineWidth = 0.7;
      for (let y = minY; y <= maxY; y += plate) {
        ctx.beginPath();
        ctx.moveTo(minX, y);
        ctx.lineTo(maxX, y);
        ctx.stroke();
      }
      for (let x = minX; x <= maxX; x += plate) {
        ctx.beginPath();
        ctx.moveTo(x, minY);
        ctx.lineTo(x, maxY);
        ctx.stroke();
      }
    } else if (
      ground === 'flagstone' ||
      ground === 'bone' ||
      ground === 'ritual' ||
      ground === 'quay' ||
      ground === 'soot'
    ) {
      // Coursed flags (planks on the quay): staggered joints every two yards.
      const course = 2 * k;
      ctx.globalAlpha = ground === 'quay' ? 0.22 : 0.16;
      ctx.lineWidth = 0.8;
      for (let y = minY; y <= maxY; y += course) {
        ctx.beginPath();
        ctx.moveTo(minX, y);
        ctx.lineTo(maxX, y);
        ctx.stroke();
        if (ground === 'quay') continue;
        const row = Math.round(y / course);
        for (let x = minX + (row % 2) * course * 0.75; x <= maxX; x += course * 1.5) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + course);
          ctx.stroke();
        }
      }
    } else if (ground === 'wetstone') {
      // Sea-worn cobbles: a scatter of rounded stones.
      ctx.globalAlpha = 0.18;
      for (let y = minY; y <= maxY; y += k * 1.4) {
        for (let x = minX; x <= maxX; x += k * 1.4) {
          const h = hash(x, y);
          ctx.beginPath();
          ctx.ellipse(
            x + h * k,
            y + hash(y, x) * k,
            k * (0.35 + h * 0.3),
            k * 0.3,
            h * Math.PI,
            0,
            Math.PI * 2,
          );
          ctx.stroke();
        }
      }
    } else if (ground === 'basalt') {
      // Columnar basalt: the hexagonal tops of the columns.
      ctx.globalAlpha = 0.24;
      ctx.lineWidth = 0.8;
      const r = k * 1.3;
      const w = r * Math.sqrt(3);
      for (let y = minY, row = 0; y <= maxY + r; y += r * 1.5, row++) {
        for (let x = minX + (row % 2) * (w / 2); x <= maxX + w; x += w) {
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
            const hx = x + Math.cos(a) * r * 0.92;
            const hy = y + Math.sin(a) * r * 0.92;
            if (i === 0) ctx.moveTo(hx, hy);
            else ctx.lineTo(hx, hy);
          }
          ctx.closePath();
          ctx.stroke();
        }
      }
    } else if (ground === 'moss') {
      // Jungle moss: soft lit cushions and dark tufts.
      for (let y = minY; y <= maxY; y += k * 1.6) {
        for (let x = minX; x <= maxX; x += k * 1.6) {
          const h = hash(x * 0.9, y * 1.1);
          if (h < 0.4) continue;
          ctx.globalAlpha = 0.16;
          ctx.fillStyle = h > 0.7 ? c.highlight : c.ink;
          ctx.beginPath();
          ctx.arc(x + hash(y, x) * k, y, k * (0.3 + h * 0.4), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (ground === 'shallows') {
      // Standing water: ripple strokes over the flooded bed.
      ctx.strokeStyle = c.foam;
      ctx.globalAlpha = 0.28;
      ctx.lineWidth = 0.9;
      for (let y = minY; y <= maxY; y += k * 2.2) {
        for (let x = minX; x <= maxX; x += k * 3) {
          const h = hash(x, y);
          if (h < 0.45) continue;
          ctx.beginPath();
          ctx.arc(x + h * k, y + k * 2, k * 1.4, Math.PI * 1.2, Math.PI * 1.8);
          ctx.stroke();
        }
      }
    } else if (ground === 'snow') {
      // Wind-packed snow: short sastrugi strokes all running with the wind
      // (from the west), lit on one side, shadowed on the other.
      ctx.lineWidth = 0.8;
      for (let y = minY; y <= maxY; y += k * 1.3) {
        for (let x = minX; x <= maxX; x += k * 2.2) {
          const h = hash(x * 0.7, y * 1.1);
          if (h < 0.45) continue;
          const ox = x + hash(y, x) * k * 1.5;
          const len = k * (0.8 + h * 1.2);
          ctx.globalAlpha = 0.3;
          ctx.strokeStyle = c.highlight;
          ctx.beginPath();
          ctx.moveTo(ox, y);
          ctx.quadraticCurveTo(ox + len * 0.5, y - k * 0.25, ox + len, y);
          ctx.stroke();
          ctx.globalAlpha = 0.14;
          ctx.strokeStyle = c.ink;
          ctx.beginPath();
          ctx.moveTo(ox + len * 0.2, y + 1);
          ctx.lineTo(ox + len, y + 1);
          ctx.stroke();
        }
      }
    } else if (ground === 'ice') {
      // Glacier and lake ice: long pale hairline fractures and a few frosted
      // patches over the clear blue.
      ctx.strokeStyle = c.highlight;
      ctx.lineWidth = 0.7;
      const area = (maxX - minX) * (maxY - minY);
      const cracks = Math.max(2, Math.round(area / (k * k * 40)));
      for (let i = 0; i < cracks; i++) {
        let x = minX + hash(i, minX * 0.01) * (maxX - minX);
        let y = minY + hash(minY * 0.01, i) * (maxY - minY);
        ctx.globalAlpha = 0.22 + hash(i, 3.3) * 0.18;
        ctx.beginPath();
        ctx.moveTo(x, y);
        let a = hash(i, 9.9) * Math.PI * 2;
        for (let j = 0; j < 5; j++) {
          a += (hash(i + j, 1.7) - 0.5) * 1.1;
          x += Math.cos(a) * k * 2.4;
          y += Math.sin(a) * k * 2.4;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.fillStyle = c.highlight;
      for (let y = minY; y <= maxY; y += k * 3) {
        for (let x = minX; x <= maxX; x += k * 3) {
          const h = hash(x * 1.3, y * 0.7);
          if (h < 0.7) continue;
          ctx.globalAlpha = 0.1;
          ctx.beginPath();
          ctx.ellipse(x, y, k * (0.8 + h), k * 0.5, h * Math.PI, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (ground === 'slate') {
      // Thornpeak slate: short cleavage dashes along one diagonal grain,
      // a pale rime fleck here and there.
      ctx.globalAlpha = 0.24;
      ctx.lineWidth = 0.8;
      for (let y = minY; y <= maxY; y += k * 1.1) {
        for (let x = minX; x <= maxX; x += k * 1.6) {
          const h = hash(x * 0.9, y * 1.2);
          if (h < 0.35) continue;
          const ox = x + hash(y, x) * k;
          const len = k * (0.6 + h * 0.9);
          ctx.beginPath();
          ctx.moveTo(ox, y);
          ctx.lineTo(ox + len * 0.8, y - len * 0.6);
          ctx.stroke();
        }
      }
      ctx.fillStyle = c.highlight;
      ctx.globalAlpha = 0.22;
      for (let y = minY; y <= maxY; y += k * 1.7) {
        for (let x = minX; x <= maxX; x += k * 1.7) {
          if (hash(x * 1.7, y * 0.3) < 0.8) continue;
          ctx.fillRect(x, y, 1.4, 1.4);
        }
      }
    } else {
      // Soil, mud, grave earth, frost: speckles and tufts.
      ctx.globalAlpha = ground === 'frost' ? 0.25 : 0.2;
      if (ground === 'frost') ctx.fillStyle = c.highlight;
      for (let y = minY; y <= maxY; y += k * 0.9) {
        for (let x = minX; x <= maxX; x += k * 0.9) {
          if (hash(x * 0.7, y * 1.3) < 0.62) continue;
          ctx.fillRect(x + hash(y, x) * k, y, 1.2, 1.2);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  private landmark(
    ctx: CanvasRenderingContext2D,
    kind: FieldMapPlan['landmarks'][number]['kind'],
    x: number,
    y: number,
    c: FieldMapColors,
  ): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = 1.5;
    if (kind === 'beacon') {
      // The lighthouse: a lit lantern with its beams.
      ctx.fillStyle = c.beacon;
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(0, 0, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = c.beacon;
      ctx.lineWidth = 2;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 11, Math.sin(a) * 11);
        ctx.lineTo(Math.cos(a) * 22, Math.sin(a) * 22);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = c.wallTop;
      ctx.strokeStyle = c.ink;
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = c.beacon;
      ctx.beginPath();
      ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 'chapel') {
      ctx.fillStyle = c.wallTop;
      ctx.fillRect(-2.5, -10, 5, 20);
      ctx.fillRect(-8, -4.5, 16, 5);
      ctx.strokeRect(-2.5, -10, 5, 20);
      ctx.strokeRect(-8, -4.5, 16, 5);
    } else if (kind === 'tower') {
      ctx.fillStyle = c.wallTop;
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = c.wall;
      ctx.beginPath();
      ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 'well') {
      ctx.fillStyle = c.shallows;
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillStyle = c.wallTop;
      ctx.beginPath();
      ctx.moveTo(0, -5);
      ctx.lineTo(4, 0);
      ctx.lineTo(0, 5);
      ctx.lineTo(-4, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
}
