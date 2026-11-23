import { describe, expect, it } from 'vitest';
import {
  TAVERN_FLAME_HEIGHT,
  TAVERN_FLAME_RADIUS,
  TAVERN_FLAME_SWELL,
  TAVERN_WALL_FIRE_EMBERS,
  TAVERN_WALL_FIRE_FLAMES,
  TAVERN_WALL_FIRE_GLOW,
  TAVERN_WALL_FIRE_LIGHT,
  TAVERN_WALL_FIRE_LOGS,
  TAVERN_WALL_FIRE_MOUTH,
  tavernWallFireFlicker,
} from '../src/render/mirefen_tavern_wall_fire_core';
import { TAVERN_PROPS } from '../src/sim/content/mirefen_tavern';

// The Mirefen tavern's wall fire layout (src/render/mirefen_tavern_wall_fire_core.ts): the
// model's firebox is a shallow soot panel, so everything that burns stands in the mouth, in
// front of the panel (never inside the solid breast, where the old flame burned unseen),
// within the opening's sides, under its lintel and on the hearthstone.

const M = TAVERN_WALL_FIRE_MOUTH;
const fire = TAVERN_PROPS.find((p) => p.kind === 'fireplace');

describe('mirefen tavern wall fire layout', () => {
  it('reads the mouth off the fireplace in the content', () => {
    if (!fire) throw new Error('fireplace');
    expect(M.face).toBeCloseTo(fire.x - (fire.hw ?? 0), 6);
    expect((M.z0 + M.z1) / 2).toBeCloseTo(fire.z, 6);
    expect(M.back).toBeGreaterThan(M.face);
    expect(M.z1 - M.z0).toBeLessThan(2 * (fire.hd ?? 0));
  });

  it('keeps every flame, at its fullest flicker, in the mouth and in front of the soot', () => {
    expect(TAVERN_WALL_FIRE_FLAMES.length).toBeGreaterThanOrEqual(3);
    for (const f of TAVERN_WALL_FIRE_FLAMES) {
      const r = TAVERN_FLAME_RADIUS * f.scale * TAVERN_FLAME_SWELL.r;
      // its back short of the soot panel: never inside the breast's stone
      expect(f.x + r * f.depth).toBeLessThanOrEqual(M.back);
      // across the mouth, between its sides
      expect(f.z - r).toBeGreaterThanOrEqual(M.z0);
      expect(f.z + r).toBeLessThanOrEqual(M.z1);
      // from the bed of embers to under the lintel
      expect(f.y).toBeGreaterThanOrEqual(M.hearth);
      expect(f.y + TAVERN_FLAME_HEIGHT * f.scale * TAVERN_FLAME_SWELL.h).toBeLessThan(M.lintel);
    }
  });

  it('lays the logs on the hearth inside the mouth, clear of the soot', () => {
    for (const log of TAVERN_WALL_FIRE_LOGS) {
      const half = log.length / 2;
      const dx = Math.sin(log.yaw) * Math.cos(log.pitch) * half;
      const dy = Math.sin(log.pitch) * half;
      const dz = Math.cos(log.yaw) * Math.cos(log.pitch) * half;
      for (const s of [-1, 1]) {
        const x = log.x + s * dx;
        const y = log.y + s * dy;
        const z = log.z + s * dz;
        expect(x + log.r).toBeLessThanOrEqual(M.back);
        expect(z - log.r).toBeGreaterThanOrEqual(M.z0);
        expect(z + log.r).toBeLessThanOrEqual(M.z1);
        expect(y - log.r).toBeGreaterThanOrEqual(M.hearth - 1e-6);
        expect(y + log.r).toBeLessThan(M.lintel);
      }
    }
  });

  it('beds the embers on the hearthstone in the mouth, lights and glows it from the front', () => {
    const e = TAVERN_WALL_FIRE_EMBERS;
    expect(e.x1).toBeLessThanOrEqual(M.back);
    expect(e.z0).toBeGreaterThanOrEqual(M.z0);
    expect(e.z1).toBeLessThanOrEqual(M.z1);
    expect(e.y).toBe(M.hearth);
    // the glow on the soot stands just proud of it, filling the opening
    const back = TAVERN_WALL_FIRE_GLOW.back;
    expect(back.x).toBeLessThan(M.back);
    expect(back.x).toBeGreaterThan(M.face);
    expect(back.y + back.height / 2).toBeLessThan(M.lintel);
    // the light burns before the mouth, low over the fire
    expect(TAVERN_WALL_FIRE_LIGHT.x).toBeLessThan(M.face);
    expect(TAVERN_WALL_FIRE_LIGHT.y).toBeLessThan(M.lintel);
  });

  it('flickers the glow round 1, never out, and holds it still under reduced motion', () => {
    const seen = new Set<number>();
    for (let t = 0; t < 10; t += 0.05) {
      const f = tavernWallFireFlicker(t);
      expect(f).toBeGreaterThan(0.7);
      expect(f).toBeLessThanOrEqual(1.2);
      seen.add(Math.round(f * 1e3));
    }
    expect(seen.size).toBeGreaterThan(20);
    expect(tavernWallFireFlicker(3.3, true)).toBe(1);
  });
});
