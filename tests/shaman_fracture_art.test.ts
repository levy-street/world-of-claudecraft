import { describe, expect, it } from 'vitest';
import { paintShamanFractureBurst } from '../src/render/ability_vfx/shaman_fracture_art';

function draw(time: number) {
  let x = 0,
    y = 0,
    angle = 0;
  const stack: number[][] = [];
  const points: number[][] = [];
  const colours: string[] = [];
  const point = (px: number, py: number) => {
    points.push([
      x + px * Math.cos(angle) - py * Math.sin(angle),
      y + px * Math.sin(angle) + py * Math.cos(angle),
    ]);
  };
  const g = {
    save: () => stack.push([x, y, angle]),
    restore: () => {
      const prior = stack.pop();
      if (!prior) throw new Error('Unbalanced fracture atlas transform');
      [x, y, angle] = prior;
    },
    rotate: (a: number) => {
      angle += a;
    },
    translate: (px: number, py: number) => {
      x += px * Math.cos(angle) - py * Math.sin(angle);
      y += px * Math.sin(angle) + py * Math.cos(angle);
    },
    moveTo: point,
    lineTo: point,
    ellipse: (px: number, py: number, rx: number, ry: number) => {
      point(px - rx, py - ry);
      point(px + rx, py + ry);
    },
    createLinearGradient: () => ({
      addColorStop: (_at: number, color: string) => colours.push(color),
    }),
    beginPath() {},
    closePath() {},
    stroke() {},
    fill() {},
    set fillStyle(value: string) {
      if (typeof value === 'string') colours.push(value);
    },
    set strokeStyle(value: string) {
      colours.push(value);
    },
  } as unknown as CanvasRenderingContext2D;
  paintShamanFractureBurst(g, time);
  return { points, colours, stack, origin: [x, y, angle] };
}

describe('Shaman mineral contact atlas', () => {
  it('keeps moving material within its prepared atlas cell and restores transforms', () => {
    for (let frame = 0; frame < 64; frame++) {
      const result = draw(frame / 63);
      expect(result.stack).toEqual([]);
      expect(result.origin).toEqual([0, 0, 0]);
      for (const coordinate of result.points.flat()) {
        expect(Number.isFinite(coordinate)).toBe(true);
        expect(Math.abs(coordinate)).toBeLessThan(64);
      }
    }
  });
  it('preserves seeded material positions and the bright contact through the second tick', () => {
    const early = draw(0.1 / 0.46);
    expect(early).toEqual(draw(0.1 / 0.46));
    const seam = early.colours.find((colour) => colour.startsWith('rgba(255,255,235,'));
    expect(seam).toBeDefined();
    if (!seam) throw new Error('Missing early contact seam');
    expect(Number(seam.split(',')[3].replace(')', ''))).toBeGreaterThan(0.8);
    const late = draw(0.9);
    const lateSeam = late.colours.find((colour) => colour.startsWith('rgba(255,255,235,'));
    if (!lateSeam) throw new Error('Missing late contact seam');
    expect(Number(lateSeam.split(',')[3].replace(')', ''))).toBeLessThan(0.01);
  });
});
