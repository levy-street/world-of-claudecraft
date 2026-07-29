import { describe, expect, it } from 'vitest';
import {
  BODY_LIGHT_INTENSITY,
  BODY_LIGHT_RANGE,
  collectBodyNightLights,
  NIGHT_LIGHT_BOUND_FLOATS,
  NIGHT_LIGHT_DYNAMIC_SLOTS,
  NIGHT_LIGHT_SLOTS,
  NIGHT_LIGHT_STATIC_SLOTS,
  NIGHT_LIGHT_TAIL_TAPER,
  type NightLightSite,
  nightLightFalloff,
  nightLightFlicker,
  packNightLights,
} from '../src/render/night_light_field_core';

// night_light_field_core: which small lights shine on the ground this frame
// and how they pack into the terrain shader's uniform slots. Pure, so the
// selection and the falloff shape are asserted here instead of eyeballed.

function site(x: number, z: number, overrides: Partial<NightLightSite> = {}): NightLightSite {
  return { x, y: 5, z, radius: 10, r: 1, g: 0.6, b: 0.3, intensity: 2, ...overrides };
}

function pack(
  statics: NightLightSite[],
  dynamics: NightLightSite[],
  staticGlow = 1,
  dynamicGlow = 1,
  camX = 0,
  camZ = 0,
  time = 0,
): { count: number; posRadius: Float32Array; color: Float32Array; bound: Float32Array } {
  const posRadius = new Float32Array(NIGHT_LIGHT_SLOTS * 4);
  const color = new Float32Array(NIGHT_LIGHT_SLOTS * 4);
  const bound = new Float32Array(NIGHT_LIGHT_BOUND_FLOATS);
  const count = packNightLights(
    statics,
    dynamics,
    dynamics.length,
    camX,
    camZ,
    staticGlow,
    dynamicGlow,
    time,
    posRadius,
    color,
    bound,
  );
  return { count, posRadius, color, bound };
}

describe('the slot layout', () => {
  it('reserves room for both fixed lights and moving bodies', () => {
    expect(NIGHT_LIGHT_STATIC_SLOTS + NIGHT_LIGHT_DYNAMIC_SLOTS).toBe(NIGHT_LIGHT_SLOTS);
    expect(NIGHT_LIGHT_STATIC_SLOTS).toBeGreaterThan(0);
    expect(NIGHT_LIGHT_DYNAMIC_SLOTS).toBeGreaterThan(0);
  });

  it('holds enough fixed-light slots to light the road ahead, not only underfoot', () => {
    // The static window IS the range the lit world reaches: a light outside it
    // casts nothing at all. Lamps stand about 26 yd apart on a town street and
    // camps add braziers on top, so a ten-slot window shut inside 60 yd and the
    // next lamp up the road stood over dark ground while the one overhead lit a
    // pool. The companion pin against the real network (how many lamps fall
    // inside a hundred yards) lives in tests/streetlamp_layout.test.ts.
    expect(NIGHT_LIGHT_STATIC_SLOTS).toBeGreaterThanOrEqual(24);
  });

  it('holds enough body slots for a busy camp pull', () => {
    // The disc layer this stands in for pooled 64 discs; the field spends
    // per-fragment shader work per slot, so it cannot match that, but it must
    // cover an ordinary pull's bodies within the short body-light reach. The
    // disc side's companion pin lives in tests/night_lighting_core.test.ts.
    expect(NIGHT_LIGHT_DYNAMIC_SLOTS).toBeGreaterThanOrEqual(14);
  });
});

describe('nightLightFalloff (the reference the GLSL mirrors)', () => {
  it('is the punctual decay-2 curve: bright at the flame, exactly 0 at the cutoff', () => {
    // 1/d^2 with the pow4 cutoff window: the identical curve THREE.PointLight
    // shades with, so field light and budget light agree about reach.
    expect(nightLightFalloff(0.5, 0, 0, 10)).toBeCloseTo(1 / 0.25, 2);
    expect(nightLightFalloff(10, 0, 0, 10)).toBe(0);
    expect(nightLightFalloff(0, 14, 0, 10)).toBe(0);
  });

  it('falls monotonically, so a light edge never pops', () => {
    let last = Number.POSITIVE_INFINITY;
    for (let d = 0.5; d <= 10; d += 0.5) {
      const v = nightLightFalloff(d, 0, 0, 10);
      expect(v).toBeLessThanOrEqual(last);
      last = v;
    }
  });

  it('measures in 3D: a lamp head above the ground still reaches it', () => {
    expect(nightLightFalloff(0, 6, 0, 10)).toBeGreaterThan(0);
    expect(nightLightFalloff(0, 6, 0, 10)).toBeLessThan(nightLightFalloff(0, 3, 0, 10));
  });
});

describe('nightLightFlicker (the live waver)', () => {
  it('holds a zero-amplitude light perfectly steady', () => {
    expect(nightLightFlicker(3.7, 10, 20, 0)).toBe(1);
  });

  it('wavers an open fire around 1, bounded by its amplitude', () => {
    for (let t = 0; t < 5; t += 0.13) {
      const v = nightLightFlicker(t, 10, 20, 0.22);
      expect(v).toBeGreaterThan(1 - 0.22);
      expect(v).toBeLessThan(1 + 0.22);
    }
  });

  it('is deterministic, and two fires never pulse in unison', () => {
    expect(nightLightFlicker(2.5, 10, 20, 0.2)).toBe(nightLightFlicker(2.5, 10, 20, 0.2));
    const a = Array.from({ length: 8 }, (_, i) => nightLightFlicker(i * 0.4, 10, 20, 0.2));
    const b = Array.from({ length: 8 }, (_, i) => nightLightFlicker(i * 0.4, -44, 3, 0.2));
    expect(a).not.toEqual(b);
  });
});

describe('packNightLights', () => {
  it('packs a small set fully, position, radius, and glow-scaled colour', () => {
    const { count, posRadius, color } = pack([site(3, 4, { y: 7, radius: 12 })], [], 0.5);
    expect(count).toBe(1);
    // the radius arrives SQUARED: the fragment loop compares against squared
    // distance, so squaring a constant once per frame beats once per fragment
    expect(Array.from(posRadius.slice(0, 4))).toEqual([3, 7, 4, 144]);
    // colour = channel * intensity * glow = (1, .6, .3) * 2 * 0.5
    expect(color[0]).toBeCloseTo(1, 5);
    expect(color[1]).toBeCloseTo(0.6, 5);
    expect(color[2]).toBeCloseTo(0.3, 5);
  });

  it('keeps the NEAREST statics when there are more than the slots hold', () => {
    const statics: NightLightSite[] = [];
    for (let i = 0; i < 40; i++) statics.push(site(100 + i * 10, 0));
    const { count, posRadius } = pack(statics, []);
    expect(count).toBe(NIGHT_LIGHT_STATIC_SLOTS);
    const xs: number[] = [];
    for (let k = 0; k < count; k++) xs.push(posRadius[k * 4]);
    // the nearest N sites are x = 100, 110, ..., whatever order they packed in
    const expected = Array.from({ length: NIGHT_LIGHT_STATIC_SLOTS }, (_, i) => 100 + i * 10);
    expect(xs.sort((a, b) => a - b)).toEqual(expected);
  });

  it('appends dynamics after statics, capped to their own slots', () => {
    const statics = [site(5, 0)];
    const dynamics: NightLightSite[] = [];
    for (let i = 0; i < NIGHT_LIGHT_DYNAMIC_SLOTS + 4; i++) dynamics.push(site(i, 1));
    const { count } = pack(statics, dynamics);
    expect(count).toBe(1 + NIGHT_LIGHT_DYNAMIC_SLOTS);
  });

  it('honours the dynamics COUNT, not the pooled array length (stale tails)', () => {
    const dynamics = [site(1, 1), site(2, 2), site(999, 999)];
    const posRadius = new Float32Array(NIGHT_LIGHT_SLOTS * 4);
    const color = new Float32Array(NIGHT_LIGHT_SLOTS * 4);
    const bound = new Float32Array(NIGHT_LIGHT_BOUND_FLOATS);
    const count = packNightLights(SITES_NONE, dynamics, 2, 0, 0, 1, 1, 0, posRadius, color, bound);
    expect(count).toBe(2);
  });

  it('tapers the tail of a full window, so slot eviction steps instead of pops', () => {
    const statics: NightLightSite[] = [];
    for (let i = 0; i < NIGHT_LIGHT_STATIC_SLOTS; i++) statics.push(site(10 + i * 5, 0));
    const { color } = pack(statics, []);
    const level = (k: number) => color[k * 4];
    // the nearest entries carry full weight
    expect(level(0)).toBeCloseTo(2, 5);
    // the last entries step down through the published taper
    const tail = NIGHT_LIGHT_TAIL_TAPER;
    for (let t = 0; t < tail.length; t++) {
      const rank = NIGHT_LIGHT_STATIC_SLOTS - tail.length + t;
      expect(level(rank)).toBeCloseTo(2 * tail[t], 5);
    }
  });

  it('wavers a flickering site over time and holds a steady one still', () => {
    const fire = [site(3, 3, { flicker: 0.22 })];
    const early = pack(fire, [], 1, 1, 0, 0, 1.1).color[0];
    const late = pack(fire, [], 1, 1, 0, 0, 1.6).color[0];
    expect(early).not.toBeCloseTo(late, 5);
    const lamp = [site(3, 3)];
    expect(pack(lamp, [], 1, 1, 0, 0, 1.1).color[0]).toBe(pack(lamp, [], 1, 1, 0, 0, 1.6).color[0]);
  });

  it('contributes nothing at zero glow, so daylight costs the shader nothing', () => {
    const { count } = pack([site(1, 1)], [site(2, 2)], 0, 0);
    expect(count).toBe(0);
  });

  it('gates each family on its own driver (lamps at dusk, bodies later)', () => {
    const { count: lampsOnly } = pack([site(1, 1)], [site(2, 2)], 1, 0);
    expect(lampsOnly).toBe(1);
    const { count: bodiesOnly } = pack([site(1, 1)], [site(2, 2)], 0, 1);
    expect(bodiesOnly).toBe(1);
  });

  it('is deterministic: the same inputs pack the same slots', () => {
    const statics = Array.from({ length: 30 }, (_, i) => site(i * 7 - 100, i * 3 - 40));
    const first = pack(statics, [site(0, 0)]);
    const second = pack(statics, [site(0, 0)]);
    expect(first.count).toBe(second.count);
    expect(Array.from(first.posRadius)).toEqual(Array.from(second.posRadius));
    expect(Array.from(first.color)).toEqual(Array.from(second.color));
  });
});

const SITES_NONE: NightLightSite[] = [];

// The two exits the terrain fragment loop takes are the reason this pack is
// shaped the way it is, and they are only safe while they stay CONSERVATIVE:
// the shader must never skip a light that would have added irradiance. That is
// a property of the packed numbers, so it is provable here without a GPU.
describe('the early exits the fragment loop takes', () => {
  /** Replay the shader's decision: which slots does it actually evaluate? */
  function evaluatedSlots(
    packed: { count: number; posRadius: Float32Array; color: Float32Array; bound: Float32Array },
    fx: number,
    fz: number,
  ): number[] {
    const [ax, az, boundSq] = packed.bound;
    const anchor2 = (fx - ax) ** 2 + (fz - az) ** 2;
    if (packed.count === 0 || anchor2 >= boundSq) return [];
    const anchorD = Math.sqrt(anchor2);
    const slots: number[] = [];
    for (let i = 0; i < packed.count; i++) {
      if (packed.color[i * 4 + 3] >= anchorD) break;
      slots.push(i);
    }
    return slots;
  }

  /** A town-sized spread: lamps on a grid of streets plus a couple of bodies. */
  function townPack(): ReturnType<typeof pack> {
    const statics: NightLightSite[] = [];
    for (let row = -2; row <= 2; row++) {
      for (let step = -4; step <= 4; step++) {
        statics.push(site(step * 26, row * 30, { y: 4.7, radius: 48, intensity: 205 }));
      }
    }
    const bodies = [site(3, 2, { y: 1.1, radius: 10 }), site(-18, 9, { y: 1.1, radius: 10 })];
    return pack(statics, bodies, 1, 1, 4, -3);
  }

  it('never skips a slot that would have lit the fragment', () => {
    const packed = townPack();
    // the static window is genuinely full, so the sweep below is over the real
    // worst case rather than a handful of lamps
    expect(packed.count).toBe(NIGHT_LIGHT_STATIC_SLOTS + 2);
    for (let fx = -260; fx <= 260; fx += 17) {
      for (let fz = -260; fz <= 260; fz += 19) {
        const kept = new Set(evaluatedSlots(packed, fx, fz));
        for (let i = 0; i < packed.count; i++) {
          if (kept.has(i)) continue;
          const radius = Math.sqrt(packed.posRadius[i * 4 + 3]);
          const lit = nightLightFalloff(
            fx - packed.posRadius[i * 4],
            // the fragment is ground, the lamp head hangs above it
            0 - packed.posRadius[i * 4 + 1],
            fz - packed.posRadius[i * 4 + 2],
            radius,
          );
          expect(lit).toBe(0);
        }
      }
    }
  });

  it('actually stops early, or the exits would be pure overhead', () => {
    const packed = townPack();
    // standing at the anchor: only the lamps whose windows still reach it
    expect(evaluatedSlots(packed, 4, -3).length).toBeLessThan(packed.count * 0.6);
    // out past the whole lit blob: the loop never runs at all
    expect(evaluatedSlots(packed, 900, 900)).toEqual([]);
  });

  it('orders slots by reach, which is what makes the break legal', () => {
    const packed = townPack();
    for (let i = 1; i < packed.count; i++) {
      expect(packed.color[i * 4 + 3]).toBeGreaterThanOrEqual(packed.color[(i - 1) * 4 + 3]);
    }
  });

  it('bounds the packed set at the anchor, and collapses to nothing by day', () => {
    const packed = pack([site(60, 0, { radius: 20 }), site(-10, 0, { radius: 9 })], []);
    expect(packed.bound[0]).toBe(0);
    expect(packed.bound[1]).toBe(0);
    // the farthest reach is the 60 yd lamp plus its own 20 yd radius
    expect(Math.sqrt(packed.bound[2])).toBeCloseTo(80, 4);
    const dark = pack([site(60, 0, { radius: 20 })], [], 0, 0);
    expect(dark.count).toBe(0);
    expect(dark.bound[2]).toBe(0);
  });
});

describe('collectBodyNightLights', () => {
  const makeViews = (
    bodies: { id: number; x: number; z: number; visible?: boolean }[],
  ): [number, { group: { visible: boolean; position: { x: number; y: number; z: number } } }][] =>
    bodies.map((b) => [
      b.id,
      { group: { visible: b.visible ?? true, position: { x: b.x, y: 2, z: b.z } } },
    ]);
  const entities = (kinds: Record<number, { kind: string; scale: number }>) => ({
    get: (id: number) => kinds[id],
  });

  it('lights nearby visible characters and skips objects and hidden views', () => {
    const out: NightLightSite[] = [];
    const count = collectBodyNightLights(
      makeViews([
        { id: 1, x: 3, z: 3 },
        { id: 2, x: 5, z: 5 },
        { id: 3, x: 6, z: 6, visible: false },
      ]),
      entities({
        1: { kind: 'mob', scale: 1 },
        2: { kind: 'object', scale: 1 },
        3: { kind: 'mob', scale: 1 },
      }),
      0,
      0,
      out,
    );
    expect(count).toBe(1);
    expect(out[0].x).toBe(3);
  });

  it('skips bodies past the glow range', () => {
    const out: NightLightSite[] = [];
    const count = collectBodyNightLights(
      makeViews([{ id: 1, x: BODY_LIGHT_RANGE + 5, z: 0 }]),
      entities({ 1: { kind: 'mob', scale: 1 } }),
      0,
      0,
      out,
    );
    expect(count).toBe(0);
  });

  it('eases a body out over the last stretch of range instead of popping', () => {
    // the disc layer's own smoothstep window (mobGlowStrength), carried into
    // the packed intensity so a body walking out of range fades off
    const out: NightLightSite[] = [];
    collectBodyNightLights(
      makeViews([
        { id: 1, x: 5, z: 0 },
        { id: 2, x: BODY_LIGHT_RANGE - 3, z: 0 },
      ]),
      entities({
        1: { kind: 'mob', scale: 1 },
        2: { kind: 'mob', scale: 1 },
      }),
      0,
      0,
      out,
    );
    expect(out[0].intensity).toBeCloseTo(BODY_LIGHT_INTENSITY, 5);
    expect(out[1].intensity).toBeGreaterThan(0);
    expect(out[1].intensity).toBeLessThan(BODY_LIGHT_INTENSITY * 0.5);
  });

  it('reuses pooled slots across calls instead of reallocating', () => {
    const out: NightLightSite[] = [];
    collectBodyNightLights(
      makeViews([{ id: 1, x: 1, z: 1 }]),
      entities({ 1: { kind: 'mob', scale: 1 } }),
      0,
      0,
      out,
    );
    const pooled = out[0];
    const count = collectBodyNightLights(
      makeViews([{ id: 1, x: 9, z: 9 }]),
      entities({ 1: { kind: 'mob', scale: 1 } }),
      0,
      0,
      out,
    );
    expect(count).toBe(1);
    expect(out[0]).toBe(pooled);
    expect(out[0].x).toBe(9);
  });

  it('scales a big body a bigger pool of light', () => {
    const out: NightLightSite[] = [];
    collectBodyNightLights(
      makeViews([
        { id: 1, x: 0, z: 0 },
        { id: 2, x: 5, z: 5 },
      ]),
      entities({
        1: { kind: 'mob', scale: 1 },
        2: { kind: 'mob', scale: 2 },
      }),
      0,
      0,
      out,
    );
    expect(out[1].radius).toBeGreaterThan(out[0].radius);
  });
});
