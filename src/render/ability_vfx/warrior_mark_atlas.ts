/** Etched armor reads for the existing additive overlay atlas. Transparent
 * breaks separate the plates; bright bevels carry the read over real armor.
 * No random stream is consumed, so the other baked canvas cells stay stable. */
export function paintWarriorMark(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  cell: number,
  breach: boolean,
): void {
  g.save();
  g.beginPath();
  g.rect(cx - cell / 2 + 2, cy - cell / 2 + 2, cell - 4, cell - 4);
  g.clip();
  g.translate(cx, cy);
  g.scale(cell / 64, cell / 64);
  const plate = (points: readonly (readonly [number, number])[]) => {
    g.beginPath();
    points.forEach(([x, y], i) => {
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    });
    g.closePath();
    const face = g.createLinearGradient(-20, -24, 22, 26);
    face.addColorStop(0, 'rgba(255,255,255,0.65)');
    face.addColorStop(0.4, 'rgba(120,120,120,0.28)');
    face.addColorStop(1, 'rgba(215,215,215,0.5)');
    g.fillStyle = face;
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.lineWidth = 1.8;
    g.lineJoin = 'miter';
    g.stroke();
  };
  if (breach) {
    // An off-centre rupture through two staggered armor leaves. This is a
    // wound in protection, not a floating shield bubble or a generic star.
    plate([
      [-23, -21],
      [-7, -26],
      [-3, -12],
      [-10, -3],
      [-20, -7],
    ]);
    plate([
      [-20, -3],
      [-11, 0],
      [-6, 9],
      [-13, 24],
      [-23, 12],
    ]);
    plate([
      [1, -26],
      [20, -19],
      [23, -7],
      [10, -2],
      [5, -11],
    ]);
    plate([
      [13, 2],
      [23, -1],
      [20, 14],
      [1, 27],
      [7, 12],
      [3, 6],
    ]);
    g.strokeStyle = 'rgba(255,255,255,1)';
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(-3, -28);
    g.lineTo(2, -13);
    g.lineTo(-5, -2);
    g.moveTo(-1, 4);
    g.lineTo(3, 11);
    g.lineTo(-4, 27);
    g.stroke();
  } else {
    // Two visibly downward load-bearing weights frame an open centre. The
    // stepped shoulders and pointed feet distinguish the attack-speed burden.
    for (const side of [-1, 1]) {
      g.save();
      g.scale(side, 1);
      plate([
        [10, -24],
        [23, -17],
        [23, 9],
        [16, 26],
        [7, 10],
        [12, 11],
      ]);
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(13, -15);
      g.lineTo(19, -12);
      g.moveTo(13, -6);
      g.lineTo(19, -3);
      g.stroke();
      g.restore();
    }
  }
  g.restore();
}
