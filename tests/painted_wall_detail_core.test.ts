// The re-baked painted walls' runtime layer, pure half
// (src/render/painted_wall_detail_core.ts). Pinned here:
//  - the handshake with the bake (detail_normal_contract.json): url, attribute, tile, strength;
//  - the gate: only `painted_walls@<one of the six>` on a primitive carrying uv1, the relief
//    on the Standard tiers only, the mask guard on every tier, nothing anywhere else;
//  - the distance fade, derived from the tile's texel density;
//  - the GLSL against the installed three's own Standard and Lambert programs: the mask read
//    from the map alpha and the opacity restored RIGHT after map_fragment, the relief built
//    on a uv1 derivative frame after normal_fragment_maps, the strength knob, the fade;
//  - the sign: the detail lights from the correct side because it never borrows the atlas's
//    glTF normalScale flip (a numeric check on the GLSL's own frame math).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  isPaintedWallDetailMaterialName,
  PAINTED_WALL_DETAIL_FADE,
  PAINTED_WALL_DETAIL_MARKER,
  PAINTED_WALL_DETAIL_MODELS,
  PAINTED_WALL_DETAIL_SIGN,
  PAINTED_WALL_DETAIL_STONE_YARDS,
  PAINTED_WALL_DETAIL_STRENGTH,
  PAINTED_WALL_DETAIL_STRENGTH_MAX,
  PAINTED_WALL_DETAIL_UNIFORM_NAMES,
  PAINTED_WALL_DETAIL_URL,
  PAINTED_WALL_DETAIL_UV_ATTRIBUTE,
  type PaintedWallDetailInputs,
  paintedWallDetailFadeBand,
  paintedWallDetailProgramKey,
  paintedWallDetailStrengthFromQuery,
  paintedWallDetailVariant,
  patchPaintedWallDetailShader,
} from '../src/render/painted_wall_detail_core';

const ROOT = path.join(__dirname, '..');
const CONTRACT = JSON.parse(
  readFileSync(
    path.join(ROOT, 'scripts/assets/painted_buildings/detail_normal_contract.json'),
    'utf8',
  ),
) as Record<string, unknown>;

const STANDARD = {
  vertexShader: THREE.ShaderLib.standard.vertexShader,
  fragmentShader: THREE.ShaderLib.standard.fragmentShader,
};
const LAMBERT = {
  vertexShader: THREE.ShaderLib.lambert.vertexShader,
  fragmentShader: THREE.ShaderLib.lambert.fragmentShader,
};

const WALLS: PaintedWallDetailInputs = {
  materialName: 'painted_walls@bank',
  hasUv1: true,
  standard: true,
  detailReady: true,
  strength: PAINTED_WALL_DETAIL_STRENGTH,
};

/** The source text right after `anchor` (the block an `after()` insert put there). */
function textAfter(source: string, anchor: string): string {
  const at = source.indexOf(anchor);
  expect(at, anchor).toBeGreaterThanOrEqual(0);
  return source.slice(at + anchor.length);
}

/** GLSL without its line comments: what the compiler reads. */
function code(glsl: string): string {
  return glsl.replace(/\/\/[^\n]*/g, '');
}

/** The inserted relief block, from its marker to the end of its braces. */
function reliefBlock(fragment: string): string {
  const start = fragment.indexOf(`${PAINTED_WALL_DETAIL_MARKER} relief`);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = fragment.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < fragment.length; index++) {
    if (fragment[index] === '{') depth++;
    if (fragment[index] === '}' && --depth === 0) return fragment.slice(start, index + 1);
  }
  throw new Error('unbalanced relief block');
}

describe('the handshake with the wall bake', () => {
  it('reads the texture, the attribute and the tile the contract names', () => {
    expect(PAINTED_WALL_DETAIL_URL).toBe(CONTRACT.textureUrl);
    expect(PAINTED_WALL_DETAIL_UV_ATTRIBUTE).toBe(CONTRACT.threeAttribute);
    expect(CONTRACT.uvAttribute).toBe('TEXCOORD_1');
    // the stones the fade is measured on
    const stones = CONTRACT.stoneWidthYards as { median: number };
    expect(PAINTED_WALL_DETAIL_STONE_YARDS).toBeCloseTo(stones.median, 2);
    expect(PAINTED_WALL_DETAIL_STRENGTH).toBe(CONTRACT.suggestedStrength);
    // the sign below rests on these statements of the contract
    expect(CONTRACT.normalConvention).toMatch(/\+R along \+u, \+G along \+v/);
    expect(CONTRACT.vAxis).toMatch(/^world up/);
    expect(CONTRACT.flippedAtEncode).toBe(true);
    expect(CONTRACT.mask).toMatch(/ALPHA/);
  });
});

describe('which materials take the layer', () => {
  it('names the six re-baked walls and nothing else', () => {
    expect([...PAINTED_WALL_DETAIL_MODELS].sort()).toEqual(
      ['bank', 'hall', 'house_b', 'shop_a', 'smithy', 'tavern'].sort(),
    );
    for (const model of PAINTED_WALL_DETAIL_MODELS) {
      expect(isPaintedWallDetailMaterialName(`painted_walls@${model}`), model).toBe(true);
    }
    for (const name of [
      'painted_roof@bank',
      'painted_props@bank',
      'painted_props_gold@bank',
      'painted_interior@bank',
      'painted_walls@house_a',
      'painted_walls@tavern_b',
      'painted_walls@guild',
      'painted_walls_x@bank',
      'painted_walls@bank.001',
      'town_atlas',
      '',
    ]) {
      expect(isPaintedWallDetailMaterialName(name), name).toBe(false);
    }
  });

  it('draws the relief on the Standard tiers and the mask guard on every re-baked walls', () => {
    expect(paintedWallDetailVariant(WALLS)).toBe('detail');
    // Lambert (Low, iOS): no normal maps, but the atlas alpha is still a mask
    expect(paintedWallDetailVariant({ ...WALLS, standard: false })).toBe('mask');
    // the texture is not resident (a failed or unbaked load): the guard alone
    expect(paintedWallDetailVariant({ ...WALLS, detailReady: false })).toBe('mask');
    // ?walldetail=off
    expect(paintedWallDetailVariant({ ...WALLS, strength: 0 })).toBe('mask');
  });

  it('is a no-op without uv1 (a look, an old file) and on every other role', () => {
    expect(paintedWallDetailVariant({ ...WALLS, hasUv1: false })).toBeNull();
    expect(paintedWallDetailVariant({ ...WALLS, hasUv1: false, standard: false })).toBeNull();
    for (const materialName of ['painted_roof@bank', 'painted_props@bank', 'town_glow']) {
      expect(paintedWallDetailVariant({ ...WALLS, materialName }), materialName).toBeNull();
    }
  });

  it('keys one program per variant, never per building', () => {
    expect(paintedWallDetailProgramKey('detail')).toBe('painted-wall-detail-v1:detail');
    expect(paintedWallDetailProgramKey('mask')).toBe('painted-wall-detail-v1:mask');
  });

  it('reads the strength knob from the URL, off and clamped', () => {
    expect(paintedWallDetailStrengthFromQuery('')).toBe(PAINTED_WALL_DETAIL_STRENGTH);
    expect(paintedWallDetailStrengthFromQuery('?walldetail=off')).toBe(0);
    expect(paintedWallDetailStrengthFromQuery('?walldetail=0')).toBe(0);
    expect(paintedWallDetailStrengthFromQuery('?walldetail=1.5')).toBe(1.5);
    expect(paintedWallDetailStrengthFromQuery('?walldetail=99')).toBe(
      PAINTED_WALL_DETAIL_STRENGTH_MAX,
    );
    expect(paintedWallDetailStrengthFromQuery('?walldetail=-2')).toBe(0);
    expect(paintedWallDetailStrengthFromQuery('?walldetail=soft')).toBe(
      PAINTED_WALL_DETAIL_STRENGTH,
    );
    expect(paintedWallDetailStrengthFromQuery('?walldetail=')).toBe(PAINTED_WALL_DETAIL_STRENGTH);
  });
});

describe('the distance fade', () => {
  it('runs from a stone 8 px across to 4 px, head-on at the reference viewport', () => {
    // 900 px tall at 60 degrees: 779.4 px a yard at one yard
    const pxPerYd = 900 / (2 * Math.tan(Math.PI / 6));
    const stone = PAINTED_WALL_DETAIL_STONE_YARDS;
    expect((stone * pxPerYd) / PAINTED_WALL_DETAIL_FADE.start).toBeCloseTo(8, 9);
    expect((stone * pxPerYd) / PAINTED_WALL_DETAIL_FADE.end).toBeCloseTo(4, 9);
    // full relief through every chase-camera distance and across the town; the stylised
    // blocks are big enough to keep it to about 185 yd before they shrink under 4 px
    expect(PAINTED_WALL_DETAIL_FADE.start).toBeGreaterThan(45);
    expect(PAINTED_WALL_DETAIL_FADE.end).toBeLessThan(200);
    expect(PAINTED_WALL_DETAIL_FADE.end).toBe(2 * PAINTED_WALL_DETAIL_FADE.start);
    // bigger stones keep their relief farther out, in proportion to their size
    expect(paintedWallDetailFadeBand(2 * stone).end).toBeCloseTo(
      2 * PAINTED_WALL_DETAIL_FADE.end,
      9,
    );
  });
});

describe('the GLSL, on the installed three programs', () => {
  it('finds every anchor it patches in the stock Standard and Lambert programs', () => {
    for (const anchor of ['#include <common>', '#include <uv_vertex>']) {
      expect(STANDARD.vertexShader, anchor).toContain(anchor);
    }
    for (const anchor of [
      '#include <common>',
      '#include <map_fragment>',
      '#include <normal_fragment_maps>',
      'uniform float opacity;',
      'varying vec3 vViewPosition;',
    ]) {
      expect(STANDARD.fragmentShader, anchor).toContain(anchor);
    }
    expect(LAMBERT.fragmentShader).toContain('#include <map_fragment>');
    expect(LAMBERT.fragmentShader).toContain('uniform float opacity;');
    // map_fragment declares the sampled colour at main scope, where the mask is read
    expect(THREE.ShaderChunk.map_fragment).toMatch(
      /#ifdef USE_MAP\s+vec4 sampledDiffuseColor = texture2D\( map, vMapUv \);/,
    );
    // and normal_fragment_begin declares the faceDirection the two-sided frame reads
    expect(THREE.ShaderChunk.normal_fragment_begin).toMatch(/^\s*float faceDirection =/);
  });

  it('restores the opacity right after map_fragment, on the Standard and the Lambert program', () => {
    for (const [label, source, variant] of [
      ['standard relief', STANDARD, 'detail'],
      ['standard guard', STANDARD, 'mask'],
      ['lambert guard', LAMBERT, 'mask'],
    ] as const) {
      const { fragmentShader } = patchPaintedWallDetailShader(source, variant);
      const tail = textAfter(fragmentShader, '#include <map_fragment>');
      const restore = tail.indexOf('diffuseColor.a = opacity;');
      expect(restore, label).toBeGreaterThan(0);
      // nothing three runs between the map read and the restore: the very next chunk
      // (vertex colour, alpha map, alpha test) comes after it
      expect(tail.indexOf('#include <color_fragment>'), label).toBeGreaterThan(restore);
      expect(tail.indexOf('#include <alphatest_fragment>'), label).toBeGreaterThan(restore);
      expect(tail.slice(0, restore).includes('#include'), label).toBe(false);
    }
  });

  it('reads the stone mask from the map alpha before the restore drops it', () => {
    const { fragmentShader } = patchPaintedWallDetailShader(STANDARD, 'detail');
    const tail = textAfter(fragmentShader, '#include <map_fragment>');
    const read = tail.indexOf('float paintedStoneMask = sampledDiffuseColor.a;');
    expect(read).toBeGreaterThan(0);
    expect(read).toBeLessThan(tail.indexOf('diffuseColor.a = opacity;'));
    // and the relief is weighted by it
    expect(reliefBlock(fragmentShader)).toMatch(/float pwdK = paintedStoneMask \*/);
  });

  it('carries uv1 to the fragment, declaring it only where three does not', () => {
    const { vertexShader } = patchPaintedWallDetailShader(STANDARD, 'detail');
    expect(vertexShader).toMatch(/#ifndef USE_UV1\s+attribute vec2 uv1;\s+#endif/);
    expect(textAfter(vertexShader, '#include <uv_vertex>')).toMatch(
      /^\s*\S+ PAINTED_WALL_DETAIL uv\s+vUv1 = uv1;/,
    );
    // the guard variant leaves the vertex program alone: no varying, no attribute
    expect(patchPaintedWallDetailShader(STANDARD, 'mask').vertexShader).toBe(STANDARD.vertexShader);
    expect(patchPaintedWallDetailShader(LAMBERT, 'mask').vertexShader).toBe(LAMBERT.vertexShader);
  });

  it('builds the relief on a uv1 derivative frame, after the atlas normal map', () => {
    const { fragmentShader } = patchPaintedWallDetailShader(STANDARD, 'detail');
    const block = reliefBlock(fragmentShader);
    expect(fragmentShader.indexOf(block)).toBeGreaterThan(
      fragmentShader.indexOf('#include <normal_fragment_maps>'),
    );
    expect(fragmentShader.indexOf(block)).toBeLessThan(
      fragmentShader.indexOf('#include <lights_fragment_begin>'),
    );
    // derivatives of uv1 and of the view-space position, in uniform control flow
    expect(block).toContain('dFdx( vUv1 )');
    expect(block).toContain('dFdy( vUv1 )');
    expect(block).toContain('dFdx( - vViewPosition )');
    expect(block).toContain('dFdy( - vViewPosition )');
    expect(block.indexOf('dFdx( vUv1 )')).toBeLessThan(block.indexOf('if ( pwdK > 0.0 )'));
    // the read inside the branch takes those gradients explicitly
    expect(block).toMatch(
      /textureGrad\( uPaintedWallDetailMap, vUv1, pwdSt0, pwdSt1 \)\.xyz \* 2\.0 - 1\.0/,
    );
    expect(block).toContain('paintedWallDetailFrame( pwdQ0, pwdQ1, pwdSt0, pwdSt1, normal )');
    expect(block).toContain('normal = normalize( pwdTbn * pwdN );');
    // the frame itself: three's getTangentFrame over the passed derivatives
    expect(fragmentShader).toMatch(
      /mat3 paintedWallDetailFrame\( vec3 q0, vec3 q1, vec2 st0, vec2 st1, vec3 n \)/,
    );
  });

  it('weights the relief by the named strength knob and a distance fade', () => {
    const { fragmentShader } = patchPaintedWallDetailShader(STANDARD, 'detail');
    const { map, strength, fade } = PAINTED_WALL_DETAIL_UNIFORM_NAMES;
    expect(fragmentShader).toContain(`uniform sampler2D ${map};`);
    expect(fragmentShader).toContain(`uniform float ${strength};`);
    expect(fragmentShader).toContain(`uniform vec2 ${fade};`);
    const block = reliefBlock(fragmentShader);
    expect(block).toContain(`paintedStoneMask * ${strength}`);
    expect(block).toContain(
      `( 1.0 - smoothstep( ${fade}.x, ${fade}.y, length( vViewPosition ) ) )`,
    );
    // past the fade, and off the mask, the tap is skipped
    expect(block).toContain('if ( pwdK > 0.0 ) {');
  });

  it('never borrows the atlas normalScale, and keeps three two-sided convention', () => {
    const block = reliefBlock(patchPaintedWallDetailShader(STANDARD, 'detail').fragmentShader);
    expect(code(block)).not.toContain('normalScale');
    expect(PAINTED_WALL_DETAIL_SIGN).toEqual({ x: 1, y: 1 });
    expect(block).toContain('pwdN.xy *= vec2( 1.0, 1.0 ) * pwdK;');
    expect(block).toMatch(
      /#ifdef DOUBLE_SIDED[\s\S]*pwdTbn\[0\] \*= faceDirection;\s+pwdTbn\[1\] \*= faceDirection;[\s\S]*#endif/,
    );
  });

  it('is idempotent and leaves a program it cannot patch whole untouched', () => {
    const once = patchPaintedWallDetailShader(STANDARD, 'detail');
    expect(patchPaintedWallDetailShader(once, 'detail')).toBe(once);
    expect(patchPaintedWallDetailShader(once, 'mask')).toBe(once);
    const noMap = {
      vertexShader: STANDARD.vertexShader,
      fragmentShader: STANDARD.fragmentShader.replace('#include <map_fragment>', ''),
    };
    expect(patchPaintedWallDetailShader(noMap, 'detail')).toBe(noMap);
    expect(patchPaintedWallDetailShader(noMap, 'mask')).toBe(noMap);
    const noNormals = {
      vertexShader: STANDARD.vertexShader,
      fragmentShader: STANDARD.fragmentShader.replace('#include <normal_fragment_maps>', ''),
    };
    expect(patchPaintedWallDetailShader(noNormals, 'detail')).toBe(noNormals);
    // each anchor is patched once (the anchors stay for a later layer)
    for (const anchor of ['#include <map_fragment>', '#include <normal_fragment_maps>']) {
      expect(once.fragmentShader.split(anchor)).toHaveLength(2);
    }
  });
});

/** The GLSL frame (paintedWallDetailFrame) in plain numbers, operation for operation. */
function frame(
  q0: THREE.Vector3,
  q1: THREE.Vector3,
  st0: THREE.Vector2,
  st1: THREE.Vector2,
  n: THREE.Vector3,
): { t: THREE.Vector3; b: THREE.Vector3; n: THREE.Vector3 } {
  const q1perp = new THREE.Vector3().crossVectors(q1, n);
  const q0perp = new THREE.Vector3().crossVectors(n, q0);
  const t = q1perp.clone().multiplyScalar(st0.x).addScaledVector(q0perp, st1.x);
  const b = q1perp.clone().multiplyScalar(st0.y).addScaledVector(q0perp, st1.y);
  const det = Math.max(t.lengthSq(), b.lengthSq());
  const scale = det === 0 ? 0 : 1 / Math.sqrt(det);
  return { t: t.multiplyScalar(scale), b: b.multiplyScalar(scale), n };
}

describe('the sign: the detail lights its stones from the correct side', () => {
  // A wall facing the camera (view space: x right, y up, the camera looking down -z).
  // One pixel right moves 0.01 yd along +x, one pixel up 0.01 yd along +y; uv1 runs
  // along the wall's horizontal tangent (u) and world up (v), in tile units.
  const tile = CONTRACT.tileWorldYards as number;
  const q0 = new THREE.Vector3(0.01, 0, 0);
  const q1 = new THREE.Vector3(0, 0.01, 0);
  const st0 = new THREE.Vector2(0.01 / tile, 0);
  const st1 = new THREE.Vector2(0, 0.01 / tile);
  const n = new THREE.Vector3(0, 0, 1);
  // A texel on the TOP bevel of a stone: its slope faces up the tile, +G (OpenGL, +v).
  const texel = new THREE.Vector3(0, 0.4, Math.sqrt(1 - 0.16));

  function perturbed(sign: { x: number; y: number }): THREE.Vector3 {
    const f = frame(q0, q1, st0, st1, n);
    const x = texel.x * sign.x;
    const y = texel.y * sign.y;
    return f.t
      .clone()
      .multiplyScalar(x)
      .addScaledVector(f.b, y)
      .addScaledVector(f.n, texel.z)
      .normalize();
  }

  it('builds the frame from uv1 alone: tangent along +u, bitangent world up', () => {
    const f = frame(q0, q1, st0, st1, n);
    expect(f.t.x).toBeGreaterThan(0.99);
    expect(f.b.y).toBeGreaterThan(0.99);
    expect(new THREE.Vector3().crossVectors(f.t, f.b).dot(n)).toBeGreaterThan(0.99);
  });

  it('tilts an up-facing bevel toward world up with the shipped sign', () => {
    const shipped = perturbed(PAINTED_WALL_DETAIL_SIGN);
    expect(shipped.y).toBeGreaterThan(0.35);
    // so a sun from above lights the top edge (a normal-dot-light against straight up)
    expect(shipped.dot(new THREE.Vector3(0, 1, 0))).toBeGreaterThan(0);
  });

  it('would light it from below with the atlas glTF convention, which is why it is never used', () => {
    // GLTFLoader writes a tangent-less glTF normal map as normalScale (s, -s); that flip is
    // the ATLAS uv's (its v runs down the image). Applied to the uv1 detail it inverts the
    // stones: the top bevel faces down.
    const loader = new THREE.MeshStandardMaterial();
    loader.normalScale.set(1, -1);
    const flipped = perturbed({ x: loader.normalScale.x, y: loader.normalScale.y });
    expect(flipped.y).toBeLessThan(-0.35);
  });
});
