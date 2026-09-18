export { paintWarriorHammer } from './warrior_hammer_painter';

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
      g.fillStyle = '#35434d';
      g.beginPath();
      g.moveTo(x - 3, y - 21);
      g.lineTo(x + 3, y - 8);
      g.lineTo(x - 1, y + 2);
      g.lineTo(x + 3, y + 17);
      g.lineTo(x - 4, y + 23);
      g.lineTo(x - 6, y + 1);
      g.closePath();
      g.fill();
      g.strokeStyle = '#d2dce4';
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
