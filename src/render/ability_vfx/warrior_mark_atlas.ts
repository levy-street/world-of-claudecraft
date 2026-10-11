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
    // Open, diagonal split with short offshoots. Only the broken seam has
    // coverage: the recipient's original armor supplies the surrounding face.
    for (const [width, color, shift] of [
      [6, '#18232c', 0],
      [1.4, '#bacbd5', 2.4],
    ] as const) {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.lineJoin = 'bevel';
      g.beginPath();
      g.moveTo(-23 + shift, 19);
      g.lineTo(-10 + shift, 11);
      g.lineTo(-6 + shift, 2);
      g.lineTo(3 + shift, 0);
      g.lineTo(10 + shift, -13);
      g.lineTo(24 + shift, -23);
      g.stroke();
    }
    g.strokeStyle = '#374651';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-10, 11);
    g.lineTo(-17, 3);
    g.lineTo(-21, 4);
    g.moveTo(10, -13);
    g.lineTo(17, -7);
    g.lineTo(23, -8);
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
