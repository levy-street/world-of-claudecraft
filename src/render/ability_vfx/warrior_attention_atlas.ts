/** Three hand-shaped cels in the shared atlas: opposed notched brows and a
 * centre bite. Bright bevels, darker faces and open space keep the model visible. */
export function paintWarriorAttention(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  cell: number,
  cel: number,
): void {
  g.save();
  g.beginPath();
  g.rect(cx - cell / 2 + 2, cy - cell / 2 + 2, cell - 4, cell - 4);
  g.clip();
  g.translate(cx, cy);
  g.scale(cell / 64, cell / 64);
  const spread = [5, 2, 0][cel];
  for (const side of [-1, 1]) {
    g.save();
    g.scale(side, 1);
    g.translate(spread, 0);
    g.beginPath();
    g.moveTo(5, -3);
    g.lineTo(19, -19);
    g.lineTo(26, -13);
    g.lineTo(19, -9);
    g.lineTo(26, 1);
    g.lineTo(21, 17);
    g.lineTo(15, 7);
    g.lineTo(17, 0);
    g.lineTo(11, -1);
    g.closePath();
    const face = g.createLinearGradient(5, -20, 25, 18);
    face.addColorStop(0, 'rgba(255,255,255,1)');
    face.addColorStop(0.42, 'rgba(185,185,185,.62)');
    face.addColorStop(1, 'rgba(100,100,100,.18)');
    g.fillStyle = face;
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,.95)';
    g.lineWidth = 1.4;
    g.stroke();
    g.beginPath();
    g.moveTo(10, -3);
    g.lineTo(19, -13);
    g.lineTo(22, -12);
    g.strokeStyle = 'rgba(255,255,255,1)';
    g.lineWidth = 2;
    g.stroke();
    g.restore();
  }
  g.beginPath();
  g.moveTo(-3, -1);
  g.lineTo(0, 5);
  g.lineTo(3, -1);
  g.lineTo(2, -5);
  g.lineTo(-2, -5);
  g.closePath();
  g.fillStyle = 'rgba(255,255,255,.9)';
  g.fill();
  g.restore();
}
