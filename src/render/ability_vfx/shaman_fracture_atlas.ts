/** Faultwake: opaque broken slate, recessed clefts and granular lips. Painted
 * once for the existing prepared decal pool; no new material or combat draw. */
const grain = (n: number): number => {
  const x = Math.sin(n * 71.37 + 9.14) * 43758.5453;
  return x - Math.floor(x);
};
type Point = readonly [number, number];

function fault(g: CanvasRenderingContext2D, points: Point[], width: number, seed: number): void {
  // Each side is a different broken face, not a continuous luminous stroke.
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / length,
      ny = (b[0] - a[0]) / length;
    const taper = 1 - i / (points.length + 1);
    const w = width * (0.3 + taper * 0.7) * (0.65 + grain(seed + i) * 0.6);
    // Broad depressed seam keeps a dark interior even on the bright stage.
    g.strokeStyle = 'rgba(23,31,32,0.86)';
    g.lineWidth = w * 1.4;
    g.beginPath();
    g.moveTo(...a);
    g.lineTo(...b);
    g.stroke();
    for (const side of [-1, 1]) {
      const edge = w * (1.4 + grain(seed + i * 3 + side) * 1.8);
      g.save();
      g.beginPath();
      g.moveTo(a[0] + nx * w * 0.48 * side, a[1] + ny * w * 0.48 * side);
      g.lineTo(b[0] + nx * w * 0.32 * side, b[1] + ny * w * 0.32 * side);
      g.lineTo(b[0] + nx * edge * 0.7 * side, b[1] + ny * edge * 0.7 * side);
      g.lineTo(
        a[0] + (b[0] - a[0]) * 0.28 + nx * edge * side,
        a[1] + (b[1] - a[1]) * 0.28 + ny * edge * side,
      );
      g.closePath();
      g.fillStyle = side === 1 ? 'rgba(94,108,106,0.78)' : 'rgba(51,66,68,0.76)';
      g.fill();
      g.clip();
      // Persistent striations follow each actual facet, not random frame noise.
      for (let speck = 0; speck < 26; speck++) {
        const u = grain(seed + i * 79 + speck * 13);
        const v = grain(seed + i * 43 + speck * 17);
        const x = a[0] + (b[0] - a[0]) * u + nx * edge * v * side;
        const y = a[1] + (b[1] - a[1]) * u + ny * edge * v * side;
        g.fillStyle = speck % 3 ? 'rgba(23,34,36,0.35)' : 'rgba(181,185,159,0.48)';
        g.fillRect(x, y, 0.35 + v * 0.8, 0.28 + u * 0.4);
      }
      g.restore();
      // Short sunward lips leave shadow and empty space between highlights.
      if (side === 1 && i % 3 !== 0) {
        g.strokeStyle = 'rgba(155,169,150,0.72)';
        g.lineWidth = 0.45;
        g.beginPath();
        g.moveTo(a[0] + nx * w * 0.52, a[1] + ny * w * 0.52);
        g.lineTo(
          a[0] + (b[0] - a[0]) * 0.66 + nx * w * 0.4,
          a[1] + (b[1] - a[1]) * 0.66 + ny * w * 0.4,
        );
        g.stroke();
      }
    }
  }
}

export function paintShamanFracture(g: CanvasRenderingContext2D, size: number): void {
  g.save();
  g.scale(size / 256, size / 256);
  g.translate(128, 128);
  g.lineJoin = 'bevel';
  g.lineCap = 'butt';
  for (let branch = 0; branch < 7; branch++) {
    const angle = branch * 2.399963 + 0.32;
    const reach = 88 + grain(branch + 42) * 29;
    const points: Point[] = [];
    for (let j = 0; j < 12; j++) {
      const u = j / 11;
      const r = 8 + u * reach;
      const bend = (grain(branch * 53 + j) - 0.5) * 13 * Math.sin(u * Math.PI);
      points.push([
        Math.cos(angle) * r - Math.sin(angle) * bend,
        Math.sin(angle) * r + Math.cos(angle) * bend,
      ]);
    }
    fault(g, points, 2.8 + grain(branch + 4) * 2.6, branch * 113);
    for (const at of [4, 7]) {
      const start = points[at],
        side = (branch + at) % 2 ? -1 : 1;
      const a = angle + side * (0.52 + grain(branch + at) * 0.35);
      const fork: Point[] = [start];
      for (let j = 1; j < 5; j++) {
        const r = j * (5 + grain(branch + at + 12) * 2);
        const kink = (grain(branch * 31 + at * 7 + j) - 0.5) * 5;
        fork.push([
          start[0] + Math.cos(a) * r - Math.sin(a) * kink,
          start[1] + Math.sin(a) * r + Math.cos(a) * kink,
        ]);
      }
      fault(g, fork, 1.6, branch * 43 + at * 17);
    }
  }
  g.restore();
}
