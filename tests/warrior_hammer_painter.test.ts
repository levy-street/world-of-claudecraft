import { expect, it } from 'vitest';
import { paintWarriorHammer } from '../src/render/ability_vfx/warrior_hammer_painter';

type Point = [number, number];
type Polygon = { points: Point[]; color: string; stroke: boolean; lineWidth: number };

function canvas() {
  const polygons: Polygon[] = [];
  const stack: { fillStyle: string; strokeStyle: string; lineWidth: number; lineJoin: string }[] =
    [];
  let path: Point[] = [];
  const context = {
    fillStyle: '#123456',
    strokeStyle: '#654321',
    lineWidth: 3,
    lineJoin: 'bevel',
    save() {
      stack.push({
        fillStyle: this.fillStyle,
        strokeStyle: this.strokeStyle,
        lineWidth: this.lineWidth,
        lineJoin: this.lineJoin,
      });
    },
    restore() {
      const state = stack.pop();
      if (!state) throw new Error('Unbalanced canvas restore');
      Object.assign(this, state);
    },
    beginPath() {
      path = [];
    },
    moveTo(x: number, y: number) {
      path.push([x, y]);
    },
    lineTo(x: number, y: number) {
      path.push([x, y]);
    },
    closePath() {},
    fill() {
      polygons.push({
        points: path.map(([x, y]) => [x, y]),
        color: this.fillStyle,
        stroke: false,
        lineWidth: 0,
      });
    },
    stroke() {
      polygons.push({
        points: path.map(([x, y]) => [x, y]),
        color: this.strokeStyle,
        stroke: true,
        lineWidth: this.lineWidth,
      });
    },
  };
  return { context, polygons, stack };
}

function paint(cel: number, cell = 64, cx = 320, cy = 192) {
  const recording = canvas();
  paintWarriorHammer(recording.context as unknown as CanvasRenderingContext2D, cx, cy, cell, cel);
  expect(recording.stack).toHaveLength(0);
  return recording;
}

it.each([64, 128, 256])(
  'keeps all eight %spx cels finite and inside a one-pixel atlas gutter, including stroke',
  (cell) => {
    const cx = cell * 3.5,
      cy = cell * 2.5;
    for (let cel = 0; cel < 8; cel++) {
      const { polygons } = paint(cel, cell, cx, cy);
      expect(polygons.length).toBeGreaterThan(10);
      for (const polygon of polygons) {
        expect(polygon.points.length).toBeGreaterThanOrEqual(3);
        expect(Number.isFinite(polygon.lineWidth)).toBe(true);
        expect(polygon.color).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
        for (const [x, y] of polygon.points) {
          expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
          const reach = polygon.lineWidth / 2;
          expect(x - reach, `cel ${cel} left edge`).toBeGreaterThanOrEqual(cx - cell / 2 + 1);
          expect(x + reach, `cel ${cel} right edge`).toBeLessThanOrEqual(cx + cell / 2 - 1);
          expect(y - reach, `cel ${cel} upper edge`).toBeGreaterThanOrEqual(cy - cell / 2 + 1);
          expect(y + reach, `cel ${cel} lower edge`).toBeLessThanOrEqual(cy + cell / 2 - 1);
        }
      }
    }
  },
);

it('draws a substantial striking head and a separate extended grip', () => {
  const { polygons } = paint(0, 64, 0, 0);
  const filled = polygons.filter((polygon) => !polygon.stroke);
  const head = filled.filter(({ points }) => {
    const xs = points.map(([x]) => x),
      ys = points.map(([, y]) => y);
    return Math.max(...ys) < 0 && Math.max(...xs) - Math.min(...xs) > 25;
  });
  const grip = filled.filter(({ points }) => {
    const xs = points.map(([x]) => x),
      ys = points.map(([, y]) => y);
    return (
      Math.max(...ys) > 18 &&
      Math.max(...ys) - Math.min(...ys) > 15 &&
      Math.max(...xs) - Math.min(...xs) < 10
    );
  });
  expect(head.length).toBeGreaterThan(0);
  expect(grip.length).toBeGreaterThan(0);
});

it('wraps the projected shape and lighting cleanly from cel eight to cel zero', () => {
  const signature = (cel: number) =>
    paint(cel)
      .polygons.map((polygon) =>
        JSON.stringify({
          ...polygon,
          points: polygon.points.map((point) =>
            point.map((value) => Math.round(value * 1e6) / 1e6),
          ),
        }),
      )
      .sort();
  expect(signature(8)).toEqual(signature(0));
});

it('changes projected edge lengths across the tumble instead of rotating a flat icon', () => {
  const edges = (cel: number) => {
    const lengths: number[] = [];
    for (const polygon of paint(cel).polygons) {
      if (polygon.stroke) continue;
      polygon.points.forEach(([x, y], i) => {
        const next = polygon.points[(i + 1) % polygon.points.length];
        lengths.push(Math.hypot(next[0] - x, next[1] - y) / 64);
      });
    }
    return lengths.sort((a, b) => a - b);
  };
  const initial = edges(0);
  for (const cel of [1, 2, 3, 4]) {
    const turned = edges(cel);
    expect(turned).toHaveLength(initial.length);
    const changed = turned.filter((length, i) => Math.abs(length - initial[i]) > 0.01);
    expect(changed.length).toBeGreaterThan(initial.length / 10);
  }
});

it('honors atlas translation and scale and restores caller drawing styles', () => {
  const original = paint(3, 64, 0, 0);
  const shifted = paint(3, 128, 273, 419);
  expect(shifted.polygons).toHaveLength(original.polygons.length);
  shifted.polygons.forEach((polygon, i) => {
    expect(polygon.color).toBe(original.polygons[i].color);
    polygon.points.forEach(([x, y], j) => {
      expect(x).toBeCloseTo(original.polygons[i].points[j][0] * 2 + 273, 8);
      expect(y).toBeCloseTo(original.polygons[i].points[j][1] * 2 + 419, 8);
    });
  });
  expect(shifted.context.fillStyle).toBe('#123456');
  expect(shifted.context.strokeStyle).toBe('#654321');
  expect(shifted.context.lineWidth).toBe(3);
  expect(shifted.context.lineJoin).toBe('bevel');
});
