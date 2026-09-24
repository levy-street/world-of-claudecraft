type Point = readonly [number, number, number];
type Pigment = readonly [number, number, number];

/** Cold atlas authoring only. Project a solid hammer through an oblique turn,
 * so its striking faces, wrapped grip and depth change across the eight cels.
 * The live projectile still uses the existing prepared sprite atlas. */
export function paintWarriorHammer(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  cell: number,
  cel: number,
): void {
  const angle = (cel * Math.PI) / 4;
  const length = Math.hypot(0.6, 0.35, 1);
  const ax = 0.6 / length,
    ay = 0.35 / length,
    az = 1 / length;
  const cosine = Math.cos(angle),
    sine = Math.sin(angle);
  const rotate = ([x, y, z]: Point): Point => {
    const dot = ax * x + ay * y + az * z;
    return [
      x * cosine + (ay * z - az * y) * sine + ax * dot * (1 - cosine),
      y * cosine + (az * x - ax * z) * sine + ay * dot * (1 - cosine),
      z * cosine + (ax * y - ay * x) * sine + az * dot * (1 - cosine),
    ];
  };
  const faces: { points: Point[]; depth: number; color: string; rim: string }[] = [];
  const face = (points: Point[], normal: Point, pigment: Pigment): void => {
    const transformed = points.map(rotate);
    const n = rotate(normal);
    const light = 0.5 + 0.62 * Math.max(0, -n[0] * 0.4 - n[1] * 0.7 + n[2] * 0.59);
    const color = (gain: number) =>
      `rgb(${pigment.map((c) => Math.round(Math.min(255, c * gain))).join(',')})`;
    faces.push({
      points: transformed,
      depth: transformed.reduce((sum, p) => sum + p[2], 0) / transformed.length,
      color: color(light),
      rim: color(light * 1.18),
    });
  };
  const box = (
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: Pigment,
  ) => {
    const a = x - w / 2,
      b = x + w / 2;
    const c = y - h / 2,
      e = y + h / 2;
    const f = z - d / 2,
      k = z + d / 2;
    face(
      [
        [a, c, k],
        [b, c, k],
        [b, e, k],
        [a, e, k],
      ],
      [0, 0, 1],
      color,
    );
    face(
      [
        [b, c, f],
        [a, c, f],
        [a, e, f],
        [b, e, f],
      ],
      [0, 0, -1],
      color,
    );
    face(
      [
        [a, c, f],
        [a, c, k],
        [a, e, k],
        [a, e, f],
      ],
      [-1, 0, 0],
      color,
    );
    face(
      [
        [b, c, k],
        [b, c, f],
        [b, e, f],
        [b, e, k],
      ],
      [1, 0, 0],
      color,
    );
    face(
      [
        [a, c, f],
        [b, c, f],
        [b, c, k],
        [a, c, k],
      ],
      [0, -1, 0],
      color,
    );
    face(
      [
        [a, e, k],
        [b, e, k],
        [b, e, f],
        [a, e, f],
      ],
      [0, 1, 0],
      color,
    );
  };
  // Steel tang runs through the head. Narrow leather wraps leave the steel
  // silhouette intact; broad end faces make the object read as blunt weight.
  box(0, 6, 0, 4.5, 35, 4.5, [73, 174, 202]);
  box(0, 10, 0, 5.3, 22, 5.3, [37, 94, 117]);
  for (let wrap = 0; wrap < 6; wrap++) box(0, 1 + wrap * 3.6, 0, 5.8, 1.1, 5.8, [123, 212, 231]);
  box(0, 23, 0, 8, 4, 8, [176, 237, 247]);
  box(0, -14, 0, 36, 13, 12, [54, 126, 153]);
  for (const side of [-1, 1]) {
    box(side * 19, -14, 0, 6, 17, 14, [127, 219, 238]);
    box(side * 12, -14, 0, 2.2, 14, 12.8, [208, 244, 247]);
    box(side * 18, -14, 0, 1.3, 18, 14.8, [197, 243, 255]);
  }
  // Inset angular thunder mark on the front face, hidden naturally on the
  // back half of the tumble by the depth-sorted solid head.
  face(
    [
      [1, -19, 6.05],
      [-5, -13, 6.05],
      [0, -13, 6.05],
      [-2, -8, 6.05],
      [6, -15, 6.05],
      [1, -15, 6.05],
      [4, -19, 6.05],
    ],
    [0, 0, 1],
    [218, 235, 245],
  );
  faces.sort((a, b) => a.depth - b.depth);
  g.save();
  g.lineJoin = 'round';
  g.lineWidth = cell / 110;
  for (const face of faces) {
    g.beginPath();
    face.points.forEach(([x, y, z], i) => {
      const scale = (cell / 70) * (140 / (140 - z));
      if (i === 0) g.moveTo(cx + x * scale, cy + y * scale);
      else g.lineTo(cx + x * scale, cy + y * scale);
    });
    g.closePath();
    g.fillStyle = face.color;
    g.fill();
    g.strokeStyle = face.rim;
    g.stroke();
  }
  g.restore();
}
