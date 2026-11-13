// The weak-spots pass's second round (2026-11-04): the roots clamp the platform's lip,
// the Heat's lava and veins lie on its rock and smoulder asleep, the Hammer's crystals
// frame its head instead of screening it.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { landmarkGlowFrag } from '../src/render/smith_heart/heart_landmarks_glsl';
import {
  HEART_ROOT_GRIP,
  heartRootGripPoint,
} from '../src/render/smith_heart/heart_room_kit_plan_core';
import { HEART_ROOM } from '../src/sim/content/smith_heart_layout';

const kit = (f: string) => readFileSync(`docs/design/raid/kit/${f}`, 'utf8');

describe("Smith's Heart art, second round", () => {
  it('every root grips the platform lip, the Hammer turned one too', () => {
    for (const vein of ['breath', 'quench', 'hammer', 'heat'] as const) {
      const g = heartRootGripPoint(vein);
      const r = Math.hypot(g.x - HEART_ROOM.x, g.z - HEART_ROOM.z);
      // On the rim, within a yard either side: never short in the air, never out on
      // the walk.
      expect(Math.abs(r - HEART_ROOM.r)).toBeLessThan(1);
    }
    // The Blender piece's own numbers are the plan's.
    const src = kit('heart_pieces.py');
    expect(src).toContain(`ROOT_GRIP_X = ${HEART_ROOT_GRIP.across}`);
    expect(src).toContain(`ROOT_RIM_Y = ${HEART_ROOT_GRIP.out}`);
    expect(src).toContain('arm = _root_grip(f, rng, frame_at)');
  });

  it("the Heat's lava and veins lie on the rock, never draped sheets", () => {
    const src = kit('landmark_pieces.py');
    // The draped net only takes its draws (the approved crystals keep their places).
    expect(src).toContain(
      "_vein_net(p, tree, F, prng, 'heat', 18, w=(0.14, 0.26), shade=0.8, draw=False)",
    );
    expect(src).toContain('_ember_veins(p, tree, F, np.random.default_rng(6907))');
    // The rivers are found by rays onto the rock, not a flat ribbon dropped on it.
    const river = src.slice(src.indexOf('def _river('), src.indexOf('def _lip_fall('));
    expect(river).toContain('surface_ribbon(');
    expect(river).not.toContain('ribbon(p, [(q[0], q[1])');
  });

  it('the Heat smoulders asleep in its hot cores, and only the Heat', () => {
    const heat = landmarkGlowFrag('heat');
    expect(heat).toContain('float ember = smoothstep(0.95, 0.985, vShade.r);');
    // A glow of its own however low the idle, gone when it wakes or the room goes dark.
    expect(heat).toContain('(0.3 + uQuiet) * (1.0 - uLit) * (1.0 - uDark)');
    for (const v of ['hammer', 'quench', 'breath'])
      expect(landmarkGlowFrag(v)).not.toContain('ember');
    // The veins' core is painted inside the ember band.
    expect(kit('landmark_pieces.py')).toContain('surface_ribbon(p, tree, rays, w, 0.985,');
  });

  it("the Hammer's crystals stand off its head", () => {
    const src = kit('landmark_pieces.py');
    const block = src.slice(src.indexOf('HAMMER_CLUSTERS = ('), src.indexOf('# The quarry'));
    const rows = [...block.matchAll(/^\s+\((-?[\d.]+), ([\d.]+), [\d.]+, \d+, ([\d.]+),/gm)];
    expect(rows.length).toBe(5);
    // The head spans about 8 degrees either side of the landmark's bearing: the two
    // low clusters by it stand well past that.
    for (const [, d, r] of rows.slice(0, 2)) {
      expect(Math.abs(Number(d))).toBeGreaterThan(14);
      expect(Number(r)).toBeLessThan(70);
    }
  });
});
