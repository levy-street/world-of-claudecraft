import { describe, expect, it } from 'vitest';
import { applyHandleDrag, handleDefs } from '../src/editor/3d/hitbox_handles';
import type { MapHitbox } from '../src/sim/map_doc';

const box = (over: Partial<MapHitbox> = {}): MapHitbox => ({
  x: 0,
  y: 1,
  z: 0,
  hx: 1,
  hy: 1,
  hz: 1,
  ...over,
});

describe('handleDefs', () => {
  it('produces the Blender counts: 8 vertices, 12 edges, 6 faces', () => {
    expect(handleDefs('vertex')).toHaveLength(8);
    expect(handleDefs('edge')).toHaveLength(12);
    expect(handleDefs('face')).toHaveLength(6);
  });
});

describe('applyHandleDrag', () => {
  it('face drag moves ONE face: the opposite face stays planted', () => {
    const out = applyHandleDrag(box(), { sx: 1, sy: 0, sz: 0 }, { x: 2, y: 0, z: 0 });
    expect(out.hx).toBe(2);
    expect(out.x).toBe(1);
    // spans: old [-1, 1] -> new [-1, 3]; the -1 face never moved.
    expect(out.x - out.hx).toBe(-1);
    expect(out.x + out.hx).toBe(3);
    // untouched axes stay put
    expect(out.hy).toBe(1);
    expect(out.hz).toBe(1);
  });

  it('negative-side face drag grows the other way', () => {
    const out = applyHandleDrag(box(), { sx: 0, sy: -1, sz: 0 }, { x: 0, y: -1, z: 0 });
    expect(out.hy).toBe(1.5);
    expect(out.y).toBe(0.5);
    expect(out.y + out.hy).toBe(2); // top face planted
  });

  it('clamps a collapse at the minimum half extent, keeping the anchor face', () => {
    const out = applyHandleDrag(box(), { sx: 1, sy: 0, sz: 0 }, { x: -10, y: 0, z: 0 });
    expect(out.hx).toBeCloseTo(0.02, 5);
    expect(out.x - out.hx).toBeCloseTo(-1, 5); // opposite face still at -1
  });

  it('vertex drag reshapes all three axes at once', () => {
    const out = applyHandleDrag(box(), { sx: 1, sy: 1, sz: -1 }, { x: 1, y: 0.5, z: -0.5 });
    expect(out.hx).toBe(1.5);
    expect(out.hy).toBe(1.25);
    expect(out.hz).toBe(1.25);
    // -z corner moved by -0.5 with sz -1: hz grows, center shifts -0.25 in z
    expect(out.z).toBe(-0.25);
  });

  it('edge drag ignores the edge direction axis', () => {
    const out = applyHandleDrag(box(), { sx: 1, sy: 0, sz: 1 }, { x: 1, y: 99, z: 1 });
    expect(out.hy).toBe(1); // sy 0: y untouched no matter the delta
    expect(out.y).toBe(1);
    expect(out.hx).toBe(1.5);
    expect(out.hz).toBe(1.5);
  });

  it('rotated boxes shift their center in the local frame', () => {
    // ry = 90°: local X points along world -Z.
    const out = applyHandleDrag(
      box({ ry: Math.PI / 2 }),
      { sx: 1, sy: 0, sz: 0 },
      { x: 1, y: 0, z: 0 },
    );
    expect(out.hx).toBe(1.5);
    expect(out.x).toBeCloseTo(0, 10);
    expect(out.z).toBeCloseTo(-0.5, 10);
    expect(out.ry).toBe(Math.PI / 2);
  });
});
