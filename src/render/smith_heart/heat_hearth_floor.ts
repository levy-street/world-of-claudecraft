// The Heat's floors (phase 2I): the field's `hearth` tops (the hall, the
// casting floor, the bridge, the Forge) drawn through the authored field's
// `topMaterial` seam. Over the painted heads of the basalt columns
// (field_textures.ts hearthDetail) the joints the painter marked as burning
// (its HEARTH_SEAM_PAINT hue, found in the map) are drawn as fire: the
// stone in them scorched dark, the first flame's white-gold light breathing
// in them, slow and uneven along each band (never a pulse that reads as a
// warning, never a threat colour), a value under every telegraph.
//
// A lit standard material (it takes the vein's light and the shadows like
// any floor), opaque, so every telegraph and floor mark draws over it as
// over stone. Cosmetic breath: the low tier keeps the light, steady; the
// Lambert tier the painted joints alone. No light, no extra texture (the
// family's own pair).

import * as THREE from 'three';
import type { DetailPair } from '../authored_field/field_textures';
import { HEARTH_SEAM_PAINT } from '../authored_field/field_textures';
import { GFX, sharedUniforms } from '../gfx';
import { markSharedMaterial } from '../shared_resource';

/** The joints' fire (linear): its glow at rest and its breath's reach (a
 *  share of the glow the slow wave adds and takes away). */
export const HEARTH_FLOOR_LOOK = {
  fire: [0.86, 0.52, 0.16],
  core: [1.0, 0.78, 0.4],
  scorch: [0.05, 0.042, 0.036],
  glow: 0.9,
  breath: 0.35,
} as const;

const v3 = (c: readonly number[]) => `vec3( ${c.map((v) => v.toFixed(3)).join(', ')} )`;

/** How the map's sampled colour (linear, stored at 1/1.6) reads as a burning
 *  joint: the seam hue's red over its blue, far past anything else's. */
export function hearthSeamMask(r: number, b: number): number {
  const sat = r - b;
  const t = Math.max(0, Math.min(1, (sat - 0.42) / (0.62 - 0.42)));
  return t * t * (3 - 2 * t);
}

/** The joints' hue as the map stores it (linear, at 1/1.6): how far its
 *  red stands over its blue (the mask's threshold sits well under it). */
export const HEARTH_SEAM_SAT = (HEARTH_SEAM_PAINT[0] - HEARTH_SEAM_PAINT[2]) / 1.6;

/** The fire's GLSL (fragment: `sampledDiffuseColor` the map's linear
 *  sample; writes `hearthSeam` and scorches the joint's albedo). */
export function hearthFloorGlsl(): string {
  const L = HEARTH_FLOOR_LOOK;
  return `
        float hearthSeam = 0.0;
        {
          float sat = sampledDiffuseColor.r - sampledDiffuseColor.b;
          hearthSeam = smoothstep( 0.42, 0.62, sat );
          diffuseColor.rgb = mix( diffuseColor.rgb, ${v3(L.scorch)}, hearthSeam );
        }`;
}

const mats = new Map<string, THREE.Material>();

/** The Heat's floor material for the field's `hearth` tops (shared, built
 *  once per tier: the compile gate links it with the interior). */
export function hearthFloorMaterial(pair: DetailPair, lowGfx: boolean): THREE.Material {
  const key = `${GFX.standardMaterials ? 'std' : 'lambert'}|${lowGfx ? 'low' : 'full'}`;
  const cached = mats.get(key);
  if (cached) return cached;
  let m: THREE.Material;
  if (!GFX.standardMaterials) {
    m = new THREE.MeshLambertMaterial({
      map: pair.map,
      vertexColors: true,
      name: 'SmithHeartHearthFloor',
    });
  } else {
    const L = HEARTH_FLOOR_LOOK;
    const std = new THREE.MeshStandardMaterial({
      map: pair.map,
      normalMap: lowGfx ? null : pair.normalMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      vertexColors: true,
      roughness: 0.84,
      metalness: 0.02,
      name: 'SmithHeartHearthFloor',
    });
    const breathe = !lowGfx;
    std.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = sharedUniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vHearthWorld;')
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
        vHearthWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vHearthWorld;
uniform float uTime;
float hearthHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float hearthNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( hearthHash( i ), hearthHash( i + vec2( 1.0, 0.0 ) ), u.x ),
              mix( hearthHash( i + vec2( 0.0, 1.0 ) ), hearthHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}`,
        )
        .replace('#include <color_fragment>', `#include <color_fragment>\n${hearthFloorGlsl()}`)
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
        // The scorched joints are glassy where the fire glazed them.
        roughnessFactor = mix( roughnessFactor, 0.5, hearthSeam );`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
        {
          // The fire breathing in the joints: a slow wave along the bands
          // (uneven, never in step across the floor), hotter at its crest.
          float wave = ${breathe ? 'hearthNoise( vHearthWorld.xz * 0.08 + vec2( uTime * 0.11, -uTime * 0.07 ) )' : '0.5'};
          float k = ${L.glow.toFixed(2)} * ( 1.0 - ${L.breath.toFixed(2)} + ${(2 * L.breath).toFixed(2)} * wave );
          vec3 fire = mix( ${v3(L.fire)}, ${v3(L.core)}, smoothstep( 0.55, 0.95, wave ) );
          totalEmissiveRadiance += fire * hearthSeam * k;
        }`,
        );
    };
    std.customProgramCacheKey = () => `smith-heart-hearth-floor|${breathe ? 'breathe' : 'steady'}`;
    m = std;
  }
  markSharedMaterial(m);
  mats.set(key, m);
  return m;
}
