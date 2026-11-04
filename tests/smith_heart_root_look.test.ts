// The roots of the mountain readable again and the four wall landmarks in one
// painted grammar (the AAA pass's third round): the roots' hand-painted stone
// draws in its own colours with a shade floor and a warm rim from the heart
// below (src/render/smith_heart/heart_root_look_core.ts), a dim vein keeps a
// low glow of its colour (a lit one still burns several times brighter), and
// every landmark's stone, the Heat's too, draws in its painted colours
// (docs/design/raid/kit/landmark_crag.py: the one sculpt grammar).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { heartVeinGlowMaterial } from '../src/render/smith_heart/heart_room_kit';
import {
  HEART_ROOT_LOOK,
  HEART_VEIN_DIM,
  heartRootEmissiveGlsl,
  heartVeinDimGlsl,
} from '../src/render/smith_heart/heart_root_look_core';

describe('heart_root_look_core: the roots read on the dark crown', () => {
  it('keeps a shade floor of the root’s own paint and a warm rim from below', () => {
    const glsl = heartRootEmissiveGlsl();
    expect(glsl).toContain(`diffuseColor.rgb * ${HEART_ROOT_LOOK.shadeFloor.toFixed(2)}`);
    expect(glsl).toContain('rootRim * rootRim');
    expect(HEART_ROOT_LOOK.shadeFloor).toBeGreaterThan(0.15);
    expect(HEART_ROOT_LOOK.shadeFloor).toBeLessThan(0.4);
  });

  it('dims a vein to a low glow of its colour, never black, a lit one far brighter', () => {
    const frag = heartVeinGlowMaterial(0x6cc8ff, 'probe').fragmentShader;
    expect(frag).toContain(heartVeinDimGlsl());
    expect(frag).not.toContain('vec3(0.05, 0.05, 0.06)');
    // Lit: its colour times the facets at 1.15 and more; dim: this share.
    expect(HEART_VEIN_DIM).toBeLessThan(1.15 / 3);
    expect(HEART_VEIN_DIM).toBeGreaterThan(0.15);
  });

  it('paints the roots’ stone and every landmark’s in their own colours', () => {
    const kit = readFileSync('src/render/smith_heart/heart_room_kit.ts', 'utf8');
    expect(kit).toContain("(p.piece === 'Kit_HeartRoot' || p.piece === 'Kit_AltarHeat') &&");
    expect(kit).toContain('m.material = rootPainted;');
    const lm = readFileSync('src/render/smith_heart/heart_landmarks.ts', 'utf8');
    expect(lm).toContain("else if (m.name.endsWith(':stone')) m.material = painted;");
    expect(lm).not.toContain("vein !== 'heat'");
  });

  it('builds the four landmarks on the one crag grammar', () => {
    const py = readFileSync('docs/design/raid/kit/landmark_pieces.py', 'utf8');
    for (const vein of ['heat', 'hammer', 'quench', 'breath'])
      expect(py, vein).toContain(`_crag(f, F, rng, '${vein}'`);
    // The old languages are gone: the quarry's courses, the wind's shelves, the swells.
    expect(py).not.toMatch(/^\s+_hammer_benches\(f, F, rng\)/m);
    expect(py).not.toMatch(/^\s+_shelves\(f, /m);
    expect(py).not.toMatch(/^\s+_swell\(f, F, rng, /m);
    // The Hammer's key mark and runes (an icon on the head) are gone.
    expect(py).not.toContain("The Smith's mark cut into the head's face");
  });
});
