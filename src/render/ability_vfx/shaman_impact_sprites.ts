import { paintShamanFractureBurst } from './shaman_fracture_art';
import { paintShamanGale } from './shaman_gale_art';

// Authored 128px contact cels. Seeds identify material pieces for the whole
// animation: time advects those pieces, never replaces the drawing with noise.
export type ShamanSheet =
  | 'shaman_storm'
  | 'shaman_ember'
  | 'shaman_rime'
  | 'shaman_dust'
  | 'shaman_gale';
type Point = readonly [number, number];
const hash = (n: number): number => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const rgba = (rgb: string, alpha: number): string =>
  `rgba(${rgb},${Math.max(0, Math.min(1, alpha))})`;
function polygon(g: CanvasRenderingContext2D, points: readonly Point[]): void {
  g.beginPath();
  for (const [i, point] of points.entries()) {
    if (i === 0) g.moveTo(...point);
    else g.lineTo(...point);
  }
  g.closePath();
}
function stroke(
  g: CanvasRenderingContext2D,
  points: readonly Point[],
  width: number,
  rgb: string,
  alpha: number,
): void {
  if (alpha <= 0 || points.length < 2) return;
  g.strokeStyle = rgba(rgb, alpha);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    if (!a || !b) continue;
    g.lineWidth = width * (1 - (i / points.length) * 0.77);
    g.beginPath();
    g.moveTo(...a);
    g.lineTo(...b);
    g.stroke();
  }
}
function fleck(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  length: number,
  width: number,
  angle: number,
  rgb: string,
  alpha: number,
): void {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.fillStyle = rgba(rgb, alpha);
  polygon(g, [
    [-length * 0.6, 0],
    [length * 0.16, -width],
    [length * 0.5, width * 0.12],
    [-length * 0.18, width * 0.6],
  ]);
  g.fill();
  g.restore();
}

function storm(g: CanvasRenderingContext2D, t: number): void {
  // The first cel already carries the return stroke. Lightning strikes rather
  // than growing like a vine; only the fine ejecta keeps travelling afterward.
  const expand = 0.78 + 0.22 * (1 - (1 - t) ** 12);
  const fade = (1 - t) ** 2;
  const snap = Math.exp(-((t / 0.34) ** 3));
  const afterglow = 0.32 * Math.exp(-(((t - 0.29) / 0.055) ** 2));
  g.lineCap = 'butt';
  g.lineJoin = 'miter';
  // A transverse collision and one crooked rising leader, with an abbreviated
  // downstroke. Unequal lengths and empty wedges avoid a radial snowflake.
  const leaders = [
    [-0.12, 58],
    [2.87, 48],
    [-1.84, 51],
    [1.22, 24],
  ];
  for (const [k, leader] of leaders.entries()) {
    const [angle = 0, reach = 0] = leader;
    const points: Point[] = [];
    for (let j = 0; j <= 18; j++) {
      const u = j / 18;
      const bend =
        ((hash(k * 77 + j + 4) - 0.5) * 15 + (j % 3 === 0 ? 2 : -1)) * Math.sin(u * Math.PI);
      points.push([
        Math.cos(angle) * reach * u * expand - Math.sin(angle) * bend * expand,
        Math.sin(angle) * reach * u * expand + Math.cos(angle) * bend * expand,
      ]);
    }
    const returnPulse = 0.06 + snap + afterglow;
    stroke(g, points, 4.2, '46,110,218', fade * returnPulse * 0.2);
    stroke(g, points, k === 0 ? 2.8 : 2.05, '89,190,255', fade * returnPulse * 0.72);
    stroke(g, points, k === 0 ? 1.85 : 1.2, '250,255,255', fade * returnPulse);
    for (let fork = 0; fork < 8; fork++) {
      const rootIndex = 3 + Math.floor(hash(k * 31 + fork) * 13);
      const root = points[rootIndex];
      if (!root) continue;
      const direction = angle + (fork % 2 ? -1 : 1) * (0.38 + hash(fork + k * 8) * 0.85);
      // Tip forks shorten near the cel edge; no branch is cut by an atlas cell.
      const margin = Math.max(1, 59 - Math.max(Math.abs(root[0]), Math.abs(root[1])));
      const reach = Math.min(5 + hash(k * 39 + fork + 10) * 19, margin) * expand;
      const branch: Point[] = [root];
      for (let j = 1; j <= 7; j++) {
        const u = j / 7;
        const kink = (hash(k * 101 + fork * 13 + j) - 0.5) * 5 * Math.sin(u * Math.PI);
        branch.push([
          root[0] + Math.cos(direction) * reach * u - Math.sin(direction) * kink,
          root[1] + Math.sin(direction) * reach * u + Math.cos(direction) * kink,
        ]);
      }
      const branchPulse = 0.06 + snap * 0.73 + afterglow * (fork % 3 === 0 ? 1.5 : 0.4);
      stroke(g, branch, 0.85 + hash(fork + 3) * 0.45, '194,238,255', fade * branchPulse);
      // Secondary hairs split from actual parent knots; no detached antlers.
      const knot = branch[3];
      if (knot)
        stroke(
          g,
          [
            knot,
            [
              knot[0] + Math.cos(direction + 0.65) * reach * 0.23,
              knot[1] + Math.sin(direction + 0.65) * reach * 0.23,
            ],
            [
              knot[0] + Math.cos(direction + 0.8) * reach * 0.4,
              knot[1] + Math.sin(direction + 0.8) * reach * 0.4,
            ],
          ],
          0.8,
          '207,240,255',
          fade * branchPulse * 0.66,
        );
    }
  }
  for (let k = 0; k < 6; k++) {
    const angle = k * 2.399 + 0.18;
    const reach = (k < 2 ? 23 : 9 + hash(k + 612) * 9) * expand;
    const points: Point[] = [
      [0, 0],
      [Math.cos(angle) * reach * 0.42, Math.sin(angle) * reach * 0.25],
      [Math.cos(angle) * reach, Math.sin(angle) * reach * 0.52],
    ];
    stroke(g, points, 3.4, '167,225,255', snap * 0.72);
    stroke(g, points, 1.65, '255,255,255', snap);
  }
  // Long narrow ion splinters, clustered along the transverse collision axis.
  // Fine cool tails outlive the hot skeleton without a second broad flash.
  for (let k = 0; k < 88; k++) {
    const angle =
      k % 3 === 0
        ? hash(k + 291) * Math.PI * 2
        : (k % 2 ? Math.PI : 0) + (hash(k + 291) - 0.5) * 1.3;
    const travel = 0.18 + 0.82 * (1 - (1 - t) ** 4);
    const distance = (5 + hash(k + 19) * 47) * travel;
    const life = Math.max(0, 1 - t / (0.35 + hash(k + 83) * 0.65));
    const x = Math.cos(angle) * distance,
      y = Math.sin(angle) * distance * 0.73;
    fleck(
      g,
      x,
      y,
      (2.5 + hash(k + 63) * 8.2) * (0.5 + travel * 0.5),
      0.55 + hash(k + 64) * 0.35,
      angle,
      k % 5 ? '145,210,255' : '255,255,255',
      life * 0.85,
    );
  }
}

function flame(g: CanvasRenderingContext2D, t: number): void {
  const expansion = 0.2 + 0.8 * (1 - (1 - t) ** 5);
  const fade = (1 - t) ** 1.2;
  // Three torn rising rolls dominate; secondary tongues throw sideways only
  // near the collision. Roots remain narrow, exposing soot pockets between rolls.
  for (let k = 0; k < 11; k++) {
    const side = k % 2 ? -1 : 1;
    const root = side * (2 + hash(k + 14) * 8) * expansion;
    const endX = side * (k < 3 ? 9 + hash(k + 20) * 13 : 15 + hash(k + 20) * 30) * expansion;
    const endY = -(k < 3 ? 47 + hash(k + 41) * 10 : 15 + hash(k + 41) * 24) * expansion - t * 3;
    const width = (k < 3 ? 8 + hash(k) * 3 : 3 + hash(k) * 5) * (1 - t * 0.66);
    const curl = side * (5 + hash(k + 77) * 10);
    const center = (u: number): Point => [
      root * (1 - u) + endX * u + curl * Math.sin(u * Math.PI * 1.65),
      6 * (1 - u) + endY * u,
    ];
    const left: Point[] = [],
      right: Point[] = [];
    for (let j = 0; j <= 28; j++) {
      const u = j / 28,
        p = center(u);
      const belly = width * Math.sin(Math.PI * u) ** 0.7 * (1 - u * 0.35);
      const ripple =
        0.62 + 0.24 * Math.sin(u * 35 + k * 1.8 - t * 4) + 0.14 * Math.sin(u * 79 + k * 3.4);
      left.push([p[0] - belly * ripple, p[1]]);
      right.push([p[0] + belly * (0.75 + 0.25 * Math.sin(u * 51 + k * 2.1 + t * 3)), p[1]]);
    }
    g.save();
    polygon(g, [...left, ...right.reverse()]);
    const heat = g.createLinearGradient(root, 6, endX, endY);
    heat.addColorStop(0, rgba('255,247,197', fade));
    heat.addColorStop(0.2, rgba('255,203,76', fade));
    heat.addColorStop(0.58, rgba('245,91,22', fade * 0.94));
    heat.addColorStop(1, rgba('148,30,13', 0));
    g.fillStyle = heat;
    g.fill();
    g.clip();
    // Long advected soot slits and curled holes cut across the same hot body.
    // Their roots are seeded once, so a slit moves rather than boils randomly.
    for (let tear = 0; tear < 16; tear++) {
      const u = 0.17 + hash(k * 97 + tear) * 0.69;
      const p = center(u),
        shift = (hash(k * 31 + tear + 10) - 0.5) * width;
      g.globalCompositeOperation = 'destination-out';
      g.strokeStyle = 'rgba(0,0,0,.68)';
      g.lineWidth = 0.65 + hash(tear + 6) * 1.9;
      g.beginPath();
      g.moveTo(p[0] + shift, p[1] + 2 - t * 4);
      g.bezierCurveTo(
        p[0] + shift + side * 4,
        p[1] - 1 - t * 4,
        p[0] + shift - side * 2,
        p[1] - 4 - t * 4,
        p[0] + shift + side * 2,
        p[1] - 7 - t * 4,
      );
      g.stroke();
      g.globalCompositeOperation = 'source-over';
      g.strokeStyle = rgba('255,232,133', fade * 0.66);
      g.lineWidth = 0.35;
      g.beginPath();
      g.moveTo(p[0] + shift + side, p[1] + 1 - t * 4);
      g.quadraticCurveTo(
        p[0] + shift + side * 4,
        p[1] - 2 - t * 4,
        p[0] + shift + side * 2,
        p[1] - 5 - t * 4,
      );
      g.stroke();
    }
    g.restore();
    stroke(g, left.slice(4, 21), 0.65, '255,210,83', fade * 0.48);
  }
  for (let k = 0; k < 84; k++) {
    const side = k % 2 ? -1 : 1;
    const x = side * (4 + hash(k + 181) * 49) * expansion;
    const y = -(hash(k + 212) * 48) * expansion + hash(k + 219) * 9 - t * t * 8;
    const life = Math.max(0, 1 - t / (0.46 + hash(k + 83) * 0.54));
    fleck(
      g,
      x,
      y,
      0.65 + hash(k + 18) * 3,
      0.15 + hash(k + 53) * 0.6,
      -1.3 + side * 0.6,
      k % 4 ? '255,128,26' : '255,242,176',
      life * (0.4 + hash(k + 29) * 0.6),
    );
  }
}

function rime(g: CanvasRenderingContext2D, t: number): void {
  const expansion = 0.18 + 0.82 * (1 - (1 - t) ** 4),
    fade = (1 - t) ** 1.3;
  // A forward/upward shatter fan, not a full-circle confetti wheel. Hero
  // splinters have three planes, a dark interior seam and broken frosted tips.
  for (let k = 0; k < 26; k++) {
    const angle = -Math.PI + 0.15 + hash(k + 321) * (Math.PI - 0.3);
    const distance = (k < 8 ? 18 + hash(k + 82) * 24 : 6 + hash(k + 82) * 48) * expansion;
    const length = (k < 8 ? 12 + hash(k + 67) * 14 : 2 + hash(k + 67) * 7) * (1 - t * 0.43);
    const width = length * (0.13 + hash(k + 19) * 0.2);
    g.save();
    g.translate(Math.cos(angle) * distance, Math.sin(angle) * distance * 0.8 + t * t * 10);
    g.rotate(angle + (hash(k + 21) - 0.5) * t * 0.9);
    const a: Point = [-length * 0.55, -width * 0.16],
      b: Point = [length * 0.47, -width * 0.64];
    const c: Point = [length * 0.24, width * 0.43],
      d: Point = [-length * 0.4, width * 0.5],
      ridge: Point = [length * 0.06, -0.1];
    g.fillStyle = rgba('40,90,129', fade * 0.88);
    polygon(g, [a, b, c, d]);
    g.fill();
    g.fillStyle = rgba('177,230,247', fade * 0.94);
    polygon(g, [a, b, ridge]);
    g.fill();
    g.fillStyle = rgba('99,163,202', fade * 0.78);
    polygon(g, [b, c, ridge]);
    g.fill();
    g.fillStyle = rgba('233,252,255', fade * 0.72);
    polygon(g, [c, d, ridge]);
    g.fill();
    stroke(g, [a, b, c], 0.7, '247,255,255', fade);
    stroke(
      g,
      [
        [-length * 0.28, 0],
        [length * 0.02, width * 0.1],
        [length * 0.16, -width * 0.26],
      ],
      0.42,
      '34,100,144',
      fade,
    );
    for (let chip = 0; chip < 4; chip++)
      fleck(
        g,
        -length * 0.4 + hash(chip + k * 31) * length * 0.75,
        -width * 0.5 + hash(chip + k * 9) * width,
        0.4 + hash(chip + 18) * 1.3,
        0.25,
        0.4,
        '239,252,255',
        fade * 0.7,
      );
    g.restore();
  }
  // Fine icy powder trails the hero planes, staying translucent around the body.
  for (let k = 0; k < 112; k++) {
    const angle = -Math.PI + hash(k + 780) * Math.PI;
    const radius = (5 + hash(k + 602) * 51) * expansion;
    const x = Math.cos(angle) * radius,
      y = Math.sin(angle) * radius * 0.72 + t * t * 14;
    fleck(
      g,
      x,
      y,
      0.4 + hash(k + 98) * 2.1,
      0.2 + hash(k + 79) * 0.5,
      angle,
      k % 3 ? '153,217,242' : '244,255,255',
      fade * (0.25 + hash(k) * 0.5),
    );
  }
}

export function drawShamanImpactSprite(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  time: number,
  style: ShamanSheet,
): void {
  if (!Number.isFinite(time) || !Number.isFinite(cx) || !Number.isFinite(cy)) return;
  const t = Math.max(0, Math.min(1, time));
  if (t === 1) return;
  g.save();
  g.translate(cx, cy);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.globalCompositeOperation = 'source-over';
  if (style === 'shaman_storm') storm(g, t);
  else if (style === 'shaman_ember') flame(g, t);
  else if (style === 'shaman_rime') rime(g, t);
  else if (style === 'shaman_gale') paintShamanGale(g, t);
  else paintShamanFractureBurst(g, t);
  g.restore();
}
