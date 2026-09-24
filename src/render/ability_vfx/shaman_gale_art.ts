// A contact-local pressure cut, drawn in a 128px atlas cel around (0, 0).
// Stable seeded pieces travel through the burst; no frame-random replacement.
type GalePoint = readonly [number, number];
const hash = (seed: number): number => {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};
const rgba = (rgb: string, alpha: number): string =>
  `rgba(${rgb},${Math.max(0, Math.min(1, alpha))})`;
function path(g: CanvasRenderingContext2D, points: readonly GalePoint[], close = false): void {
  g.beginPath();
  for (let i = 0; i < points.length; i++) {
    if (i === 0) g.moveTo(...points[i]);
    else g.lineTo(...points[i]);
  }
  if (close) g.closePath();
}

/** One sharp diagonal shear, two unequal wake laminae and granular condensation.
 * Paints no full circle, orbital trail, lightning fork or broad opaque glow. */
export function paintShamanGale(g: CanvasRenderingContext2D, time: number): void {
  if (!Number.isFinite(time) || time >= 1) return;
  const t = Math.max(0, time);
  const grow = 0.86 + 0.14 * (1 - (1 - t) ** 8);
  const fade = (1 - t) ** 1.15;
  const edgeFade = fade * (0.48 + 0.52 * Math.exp(-t * 3.6));
  const cs = Math.cos(-0.58),
    sn = Math.sin(-0.58);
  const point = (x: number, y: number): GalePoint => [
    (x * cs - y * sn) * grow,
    (x * sn + y * cs) * grow,
  ];
  g.save();
  g.globalCompositeOperation = 'source-over';
  g.lineCap = 'butt';
  g.lineJoin = 'miter';
  // The wider secondary trail stays behind the blade with two recessed gaps.
  // It is an open wake, not another complete copy of the primary crescent.
  for (let lamina = 2; lamina >= 0; lamina--) {
    const lead: GalePoint[] = [],
      tail: GalePoint[] = [];
    const start = lamina === 0 ? -51 : lamina === 1 ? -43 : -30;
    const length = lamina === 0 ? 101 : lamina === 1 ? 80 : 61;
    const offset = lamina === 0 ? -4 : lamina === 1 ? 9 : 21;
    const thickness = lamina === 0 ? 7.4 : lamina === 1 ? 5.6 : 3.9;
    for (let j = 0; j <= 32; j++) {
      const u = j / 32;
      const x = start + length * u + t * (lamina === 0 ? 2 : 4);
      const belly = Math.sin(Math.PI * u);
      const y = offset - 13 * belly + t * (lamina === 0 ? -1 : 3 + lamina);
      const tear = 0.78 + 0.13 * Math.sin(u * 31 + lamina) + 0.09 * Math.sin(u * 77 + lamina * 4);
      const width = thickness * belly ** 0.8 * tear * (1 - 0.34 * u);
      lead.push(point(x, y));
      tail.push(point(x, y + width));
    }
    path(g, [...lead, ...tail.slice().reverse()], true);
    const fill = g.createLinearGradient(-30, -14, 22, 21);
    fill.addColorStop(0, rgba('184,244,245', fade * (lamina === 0 ? 0.9 : 0.36)));
    fill.addColorStop(0.38, rgba('239,255,255', fade * (lamina === 0 ? 0.95 : 0.48)));
    fill.addColorStop(0.65, rgba('69,149,163', fade * (lamina === 0 ? 0.58 : 0.32)));
    fill.addColorStop(1, rgba('25,65,84', fade * 0.06));
    g.fillStyle = fill;
    g.fill();
    path(g, lead);
    g.strokeStyle = rgba(
      lamina === 0 ? '250,255,252' : '168,227,232',
      edgeFade * (lamina === 0 ? 1 : 0.64),
    );
    g.lineWidth = lamina === 0 ? 1.65 : 0.95;
    g.stroke();
    // Hairline contour seams inside the wake expose its layered pressure.
    for (let seam = 0; seam < 3; seam++) {
      const contour: GalePoint[] = [];
      for (let j = 0; j <= 17; j++) {
        const u = 0.12 + (j / 17) * (0.55 + seam * 0.075);
        const x = start + length * u + t * (lamina === 0 ? 2 : 4);
        const y =
          offset -
          13 * Math.sin(Math.PI * u) +
          (seam + 1) * 1.1 +
          t * (lamina === 0 ? -1 : 3 + lamina);
        contour.push(point(x, y));
      }
      path(g, contour);
      g.lineWidth = 0.8;
      g.strokeStyle = rgba(
        seam === 1 ? '26,67,78' : '206,246,246',
        fade * (seam === 1 ? 0.58 : 0.27),
      );
      g.stroke();
    }
  }
  // Torn pressure slivers share the shear direction but vary in aspect and
  // spacing. Empty intervals keep the blade readable through the particle field.
  for (let k = 0; k < 24; k++) {
    const progress = 1 - (1 - t) ** 3;
    const x = -40 + hash(k + 2) * 70 + progress * (3 + hash(k + 12) * 7);
    const side = k % 3 === 0 ? -1 : 1;
    const y = side * (9 + hash(k + 37) * 17 + progress * 5);
    const length = 4 + hash(k + 91) * 10;
    const width = 0.45 + hash(k + 113) * 0.75;
    path(
      g,
      [
        point(x - length * 0.5, y),
        point(x + length * 0.5, y - 1),
        point(x + length * 0.1, y + width),
      ],
      true,
    );
    g.fillStyle = rgba(
      k % 4 === 0 ? '246,255,255' : '133,207,221',
      fade * (0.35 + hash(k + 210) * 0.45),
    );
    g.fill();
  }
  // Condensation grains are flecks rather than a soft mist cloud. Their stable
  // angled trajectories carry mass after the blade's brief white contact edge.
  for (let k = 0; k < 68; k++) {
    const travel = 0.3 + 0.7 * (1 - (1 - t) ** 4);
    const x = (-45 + hash(k + 307) * 86) * travel + t * 4;
    const y = (hash(k + 391) - 0.5) * 65 * travel;
    const width = 0.4 + hash(k + 401) * 0.4;
    const length = 0.8 + hash(k + 433) * 2.5;
    path(
      g,
      [point(x - length, y), point(x, y - width), point(x + length, y), point(x, y + width)],
      true,
    );
    g.fillStyle = rgba(
      k % 5 === 0 ? '255,255,247' : '171,224,231',
      fade * (0.4 + hash(k + 517) * 0.4),
    );
    g.fill();
  }
  g.restore();
}
