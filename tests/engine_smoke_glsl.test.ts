// The engine kit's smoke (src/render/trash_engine_fx/engine_smoke_glsl.ts): the two
// cuts the Smith's Heart audit found stay fixed (points 13 and 20).
import { expect, it } from 'vitest';
import { PARTICLE_VERT } from '../src/render/hollow_crypt/crypt_fx_particles';
import {
  SMOKE_FLOOR_LIFT,
  SMOKE_FRAG,
  SMOKE_VERT,
} from '../src/render/trash_engine_fx/engine_smoke_glsl';

it('lifts each smoke sprite until its lower edge clears its floor (no straight cut in the ground)', () => {
  expect(SMOKE_VERT).not.toBe(PARTICLE_VERT);
  expect(SMOKE_VERT).toContain('p.y = max(p.y, aLife.w + size * 0.48);');
  // Lifted before it is billboarded, and a quad of side `size` clears the floor.
  expect(SMOKE_VERT.indexOf('aLife.w + size')).toBeLessThan(
    SMOKE_VERT.indexOf('billboard(p, size,'),
  );
  expect(SMOKE_FLOOR_LIFT).toBeGreaterThanOrEqual(0.45);
});

it("windows the billow well inside its quad (the quad's sides never cut it)", () => {
  expect(SMOKE_FRAG).toContain('body *= 1.0 - smoothstep(0.66, 0.97, r);');
  // Lobed and torn, never a disc.
  expect(SMOKE_FRAG).toContain('lobes');
  expect(SMOKE_FRAG).toContain('fray');
});
