/** Hand-painted steel, brass and leather silhouette. Eight complete cels rotate
 * the object without allocating a projectile mesh or changing its world path. */
export function paintWarriorHammer(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  cell: number,
  cel: number,
): void {
  g.save();
  g.translate(cx, cy);
  g.scale(cell / 64, cell / 64);
  g.rotate((cel * Math.PI) / 4);
  const polygon = (points: readonly number[], color: string): void => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) g.lineTo(points[i], points[i + 1]);
    g.closePath();
    g.fill();
  };
  // Long wrapped grip, flared pommel and a continuous steel tang.
  polygon([-3, -8, 3, -8, 3, 23, -3, 23], '#af7449');
  polygon([-3, -8, -1, -8, -1, 23, -3, 23], '#ffe1a4');
  g.strokeStyle = '#382d32';
  g.lineWidth = 1.35;
  for (let i = 0; i < 6; i++) {
    g.beginPath();
    g.moveTo(-2, 1 + i * 3.1);
    g.lineTo(3, 3 + i * 3.1);
    g.stroke();
  }
  polygon([-4, 20, 4, 20, 5, 24, 0, 26, -5, 24], '#dac194');
  // Broad asymmetric bevels keep the blunt face readable at gameplay distance.
  polygon([-21, -22, 17, -22, 22, -17, 22, -8, 17, -4, -21, -4, -25, -9, -25, -17], '#49556b');
  polygon([-21, -22, 17, -22, 22, -17, -21, -17, -25, -9, -25, -17], '#e4eff3');
  polygon([-21, -17, 17, -17, 17, -7, -21, -7], '#8cabbc');
  polygon([17, -17, 22, -17, 22, -8, 17, -4], '#d2dde6');
  polygon([-21, -7, 17, -7, 17, -4, -21, -4, -25, -9], '#283b51');
  // Gold ferrules and a broken angular thunder engraving, never a round orb.
  polygon([-14, -21, -11, -21, -11, -5, -14, -5], '#e8ca8c');
  polygon([9, -21, 12, -21, 12, -5, 9, -5], '#e8ca8c');
  polygon([0, -18, -5, -12, 0, -12, -3, -7, 6, -14, 1, -14, 4, -18], '#f0faff');
  g.strokeStyle = '#34455a';
  g.lineWidth = 0.9;
  for (const x of [-19, 15]) {
    g.beginPath();
    g.moveTo(x, -14);
    g.lineTo(x + 2, -11);
    g.lineTo(x, -9);
    g.stroke();
  }
  g.restore();
}

/** The motion accessibility option freezes only the decorative tumble. */
export function warriorHammerCel(age: number, reducedMotion: boolean): number {
  return reducedMotion ? 0 : Math.floor(Math.max(0, age) * 24) % 8;
}

/** An accumulating plate scar or a short ankle slash, not an orbiting badge. */
export function paintWarriorControlMark(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  cell: number,
  stacks: number,
): void {
  g.save();
  g.translate(cx, cy);
  g.scale(cell / 64, cell / 64);
  if (stacks === 0) {
    g.fillStyle = '#c35654';
    g.beginPath();
    g.moveTo(-26, 10);
    g.lineTo(-8, -2);
    g.lineTo(8, -6);
    g.lineTo(26, -16);
    g.lineTo(12, -2);
    g.lineTo(-9, 4);
    g.closePath();
    g.fill();
    g.strokeStyle = '#f7bea1';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(-23, 10);
    g.lineTo(-7, 0);
    g.lineTo(10, -4);
    g.stroke();
  } else {
    for (let i = 0; i < Math.min(5, stacks); i++) {
      const x = (i - 2) * 8;
      const y = (i % 2) * 6 - 3;
      g.fillStyle = '#735742';
      g.beginPath();
      g.moveTo(x - 3, y - 21);
      g.lineTo(x + 3, y - 8);
      g.lineTo(x - 1, y + 2);
      g.lineTo(x + 3, y + 17);
      g.lineTo(x - 4, y + 23);
      g.lineTo(x - 6, y + 1);
      g.closePath();
      g.fill();
      g.strokeStyle = '#e7c797';
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(x - 3, y - 21);
      g.lineTo(x + 3, y - 8);
      g.lineTo(x - 1, y + 2);
      g.lineTo(x + 3, y + 17);
      g.stroke();
    }
  }
  g.restore();
}
