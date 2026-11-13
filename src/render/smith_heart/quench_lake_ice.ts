// The Frozen Lake's and the Singing Ice's surface (phase 2H): the field's
// `lake_ice` tops drawn with the ice's depth (the authored field's
// `topMaterial` seam). Over the painted skin of frost (field_textures.ts
// lakeIceDetail: the frosted pressure cracks, the powder, the clouded
// patches) the clear ice looks down into dark water: bubbles hang at three
// depths and old cracks deep in the ice, shifting with the view (parallax),
// the polished face takes the pale sky at grazing angles, and snow drifts in
// at every edge where the ice meets the shelf. The Singing Ice is crazed
// with a web of fine frost cracks on top (its set piece's look; the mechanic
// is not built).
//
// A lit standard material (it takes the vein's light, the braziers' warm
// pools and the shadows like any floor), opaque, so every telegraph and
// floor mark draws over it as over stone; its value stays dark and calm
// under them. Cosmetic depth: the low tier draws one bubble layer and no
// deep cracks; the Lambert tier the painted skin alone. No light, no extra
// texture (the family's own pair).

import * as THREE from 'three';
import { QUENCH } from '../../sim/content/smith_heart_layout';
import { FIELD_GROUND_COLORS } from '../authored_field/field_mesh_core';
import type { DetailPair } from '../authored_field/field_textures';
import { GFX } from '../gfx';
import { markSharedMaterial } from '../shared_resource';

/** The ice's colours (linear): the dark water under it, the deep cracks,
 *  the bubbles, the sky it takes at grazing angles, the edge snow. */
export const LAKE_ICE_LOOK = {
  water: [0.012, 0.034, 0.058],
  body: [0.06, 0.15, 0.22],
  crack: [0.3, 0.48, 0.6],
  bubble: [0.5, 0.66, 0.76],
  sky: [0.46, 0.56, 0.66],
  snow: [0.72, 0.78, 0.86],
  /** The bubbles' depths (yards under the face). */
  depths: [0.3, 0.75, 1.35],
  /** The old cracks' depth. */
  crackDepth: 0.95,
} as const;

/** The key light's highlight on the lake's polish, as a share of its full peak,
 *  and the most it may add to a channel: a glint, never a white sheet over the
 *  slashes' lines (tests/smith_heart_quench_glare.test.ts). */
export const LAKE_ICE_GLARE = 0.3;
export const LAKE_ICE_GLARE_CAP = 0.18;

/** How far in from an edge the snow drifts over the ice (yards). */
export const LAKE_ICE_EDGE = 1.5;

/** The painted lake (the Quench's painted rebuild, quench_env_kit.ts): the painting is the
 *  ice's face, dark teal under pale cracks. `skin` is where its pale cracks and frost turn
 *  opaque (linear luminance), `depth` how much of the bubbles and old cracks under the
 *  face shows through its clear ice, `gain` the painting's level over the field's vertex
 *  paint (the base divided out, its broad clouds kept), `graze` the sky's share at grazing
 *  angles (the night keeps the lake dark from a player's eye). */
export const LAKE_ICE_PAINTED = {
  skin: [0.12, 0.34],
  depth: 0.4,
  gain: 0.74,
  graze: 0.12,
  /** The painting's tile in the field's UV (the `lake_ice` family lays one unit every 18
   *  yd, so 0.85 tiles the cracks every 21 yd), read in the shader so the shared painting
   *  keeps its own repeat. */
  repeat: 0.85,
} as const;

const v3 = (c: readonly number[]) => `vec3( ${c.map((v) => v.toFixed(3)).join(', ')} )`;

/** The depth's GLSL (fragment: `vIceLocal` the instance-local position,
 *  `vIceWorld` the world position; writes `iceSkin` and `iceSnow`). `painted`: the map is
 *  the painted lake, the face the depth shows under (LAKE_ICE_PAINTED). */
export function lakeIceDepthGlsl(layers: number, deepCracks: boolean, painted = false): string {
  const L = LAKE_ICE_LOOK;
  const P = LAKE_ICE_PAINTED;
  const bubbleLayers = L.depths
    .slice(0, layers)
    .map(
      (d, k) => `
          {
            vec2 q = iceP + iceOff * ${d.toFixed(2)};
            float stream = smoothstep( 0.45, 0.7, iceNoise( q * 0.07 + ${(k * 17.3).toFixed(1)} ) );
            vec2 cell = floor( q / 0.6 );
            vec2 f = fract( q / 0.6 ) - 0.5;
            float h = iceHash( cell + ${(k * 31.7).toFixed(1)} );
            vec2 jit = vec2( iceHash( cell + 3.1 ), iceHash( cell + 7.7 ) ) - 0.5;
            float r = 0.06 + 0.1 * iceHash( cell + 11.3 );
            float disc = 1.0 - smoothstep( r * 0.6, r, length( f - jit * 0.5 ) );
            float on = step( 1.0 - ( 0.025 + 0.2 * stream ), h );
            iceDeep += ${v3(L.bubble)} * disc * on * ${(1 - k * 0.28).toFixed(2)};
          }`,
    )
    .join('');
  const cracks = deepCracks
    ? `
          {
            // Old cracks deep in the ice: the edges of broad cells, thin and
            // straight-run like real fractures, only some of them open.
            vec2 q = ( iceP + iceOff * ${L.crackDepth.toFixed(2)} ) / 11.0;
            float e = iceCellEdge( q );
            float open = smoothstep( 0.5, 0.75, iceNoise( q * 1.3 + 4.0 ) );
            float line = 1.0 - smoothstep( 0.0, fwidth( e ) * 1.6 + 0.004, e );
            iceDeep += ${v3(L.crack)} * line * open * 0.8;
          }`
    : '';
  return `
        float iceSkin = 0.0;
        float iceSnow = 0.0;
        float iceGraze = 0.0;
        float iceSheet = 0.0;
        {
          vec2 iceP = vIceLocal.xz;
          vec3 iceV = normalize( cameraPosition - vIceWorld );
          float iceVy = max( iceV.y, 0.14 );
          vec2 iceOff = -iceV.xz / iceVy;
          iceGraze = pow( 1.0 - clamp( iceV.y, 0.0, 1.0 ), 4.0 );
          // The frost skin (the painted cracks, the powder, the clouds) is
          // opaque; the clear ice between lets the depth through.
          float m = dot( sampledDiffuseColor.rgb, vec3( 0.3, 0.59, 0.11 ) );
          iceSkin = ${painted ? `smoothstep( ${P.skin[0].toFixed(2)}, ${P.skin[1].toFixed(2)}, m )` : 'smoothstep( 0.4, 0.72, m )'};
          vec3 iceDeep = ${painted ? 'vec3( 0.0 )' : v3(L.water)};${bubbleLayers}${cracks}
          ${painted ? '' : `iceDeep = mix( iceDeep, ${v3(L.body)}, 0.35 );`}
          // Snow drifted in at every edge: the lake's rim and the Singing
          // Ice's sides, ragged.
          vec2 lk = ( iceP - uIceLake.xy ) / uIceLake.zw;
          float lakeIn = ( 1.0 - length( lk ) ) * min( uIceLake.z, uIceLake.w );
          vec2 sm = min( iceP - uIceSheet.xy, uIceSheet.zw - iceP );
          float sheetIn = min( sm.x, sm.y );
          float inside = max( lakeIn, sheetIn );
          // The ice clears paler over the shallows near its shore and sinks
          // to the dark deep water toward the lake's middle.
          float shallow = ( 1.0 - smoothstep( 0.0, 12.0, lakeIn ) ) * step( 0.0, lakeIn );
          float deepMid = smoothstep( 14.0, 30.0, lakeIn );
          ${
            painted
              ? ''
              : `iceDeep = mix( iceDeep, iceDeep * 1.6 + vec3( 0.025, 0.06, 0.08 ), shallow * 0.6 );
          iceDeep *= 1.0 - deepMid * 0.35;`
          }
          float rag = iceNoise( iceP * 0.35 ) * 0.8 + iceNoise( iceP * 1.3 ) * 0.35;
          iceSnow = 1.0 - smoothstep( 0.0, ${LAKE_ICE_EDGE.toFixed(1)}, inside - rag + 0.4 );
          // The Singing Ice is crazed with fine frost cracks on top.
          float sheet = step( lakeIn, sheetIn ) * step( 0.0, sheetIn );
          iceSheet = sheet;
          vec2 g = iceP / 3.4;
          float ce = iceCellEdge( g );
          float craze = ( 1.0 - smoothstep( 0.0, fwidth( ce ) * 1.4 + 0.003, ce ) )
            * smoothstep( 0.42, 0.7, iceNoise( g * 0.8 + 2.0 ) );
          iceSkin = max( iceSkin, craze * sheet );
          vec3 skin = diffuseColor.rgb;
          ${
            painted
              ? `// The painted face: paler over the shallows, sinking toward the middle; the
          // bubbles and old cracks seen through its clear ice; the Singing Ice's crazing
          // a pale web over it.
          skin = mix( skin, skin * 1.35 + vec3( 0.008, 0.02, 0.026 ), shallow * 0.5 );
          skin *= 1.0 - deepMid * 0.25;
          diffuseColor.rgb = skin + iceDeep * ( 1.0 - iceSkin ) * ${P.depth.toFixed(2)};
          diffuseColor.rgb = mix( diffuseColor.rgb, ${v3(L.crack)}, craze * sheet * 0.6 );`
              : 'diffuseColor.rgb = mix( iceDeep, skin, iceSkin );'
          }
          float drift = 0.86 + 0.14 * iceNoise( iceP * 0.8 + 11.0 );
          diffuseColor.rgb = mix( diffuseColor.rgb, ${v3(L.snow)} * drift, iceSnow );
        }`;
}

const NOISE_GLSL = /* glsl */ `
varying vec3 vIceLocal;
varying vec3 vIceWorld;
uniform vec4 uIceLake;
uniform vec4 uIceSheet;
float iceHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
// The distance to the nearest edge of a jittered cell grid (unit cells):
// the second-nearest centre's distance less the nearest's, halved.
float iceCellEdge( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  float d1 = 8.0;
  float d2 = 8.0;
  for ( int y = -1; y <= 1; y++ ) {
    for ( int x = -1; x <= 1; x++ ) {
      vec2 o = vec2( float( x ), float( y ) );
      vec2 c = o + vec2( iceHash( i + o ), iceHash( i + o + 19.7 ) ) * 0.8 + 0.1;
      float d = length( c - f );
      if ( d < d1 ) { d2 = d1; d1 = d; } else if ( d < d2 ) { d2 = d; }
    }
  }
  return ( d2 - d1 ) * 0.5;
}
float iceNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( iceHash( i ), iceHash( i + vec2( 1.0, 0.0 ) ), u.x ),
              mix( iceHash( i + vec2( 0.0, 1.0 ) ), iceHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
`;

const mats = new Map<string, THREE.Material>();

/** The lake's material for the field's `lake_ice` tops (shared, built once
 *  per tier: the compile gate links it with the interior). With `painted` (the Quench's
 *  painted lake and its relief), the painting is the ice's face. */
export function lakeIceMaterial(
  pair: DetailPair,
  lowGfx: boolean,
  painted: DetailPair | null = null,
): THREE.Material {
  const key = `${GFX.standardMaterials ? 'std' : 'lambert'}|${lowGfx ? 'low' : 'full'}|${painted ? 'painted' : 'frost'}`;
  const cached = mats.get(key);
  if (cached) return cached;
  const skin = painted ?? pair;
  let m: THREE.Material;
  if (!GFX.standardMaterials) {
    m = new THREE.MeshLambertMaterial({
      map: skin.map,
      vertexColors: true,
      name: 'SmithHeartLakeIce',
    });
  } else {
    const std = new THREE.MeshStandardMaterial({
      map: skin.map,
      normalMap: lowGfx ? null : skin.normalMap,
      normalScale: new THREE.Vector2(0.6, 0.6),
      vertexColors: true,
      roughness: 0.36,
      metalness: 0.02,
      name: 'SmithHeartLakeIce',
    });
    const L = QUENCH.lake;
    const I = QUENCH.ice;
    const lake = new THREE.Vector4(L.x, L.z, L.rx, L.rz);
    const sheet = new THREE.Vector4(I.x0, I.z0, I.x1, I.z1);
    const depth = lakeIceDepthGlsl(lowGfx ? 1 : 3, !lowGfx, !!painted);
    const graze = painted ? LAKE_ICE_PAINTED.graze : 0.5;
    std.onBeforeCompile = (shader) => {
      shader.uniforms.uIceLake = { value: lake };
      shader.uniforms.uIceSheet = { value: sheet };
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vIceLocal;\nvarying vec3 vIceWorld;',
        )
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
        vIceLocal = transformed;
        vIceWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${NOISE_GLSL}`)
        .replace(
          '#include <map_fragment>',
          painted
            ? `#ifdef USE_MAP
        // The painted face read twice, the second turned and scaled, over broad
        // patches: its cracks never line up into a grid across the lake.
        vec2 iceUv = vMapUv * ${LAKE_ICE_PAINTED.repeat.toFixed(2)};
        vec4 sampledDiffuseColor = texture2D( map, iceUv );
        vec4 iceTileB = texture2D( map, mat2( 0.8, 0.6, -0.6, 0.8 ) * iceUv * 0.71 + vec2( 0.37, 0.61 ) );
        sampledDiffuseColor = mix( sampledDiffuseColor, iceTileB, smoothstep( 0.35, 0.65, iceNoise( vIceLocal.xz * 0.03 ) ) );
        diffuseColor *= sampledDiffuseColor;
        #endif`
            : '#include <map_fragment>',
        )
        .replace('#include <color_fragment>', `#include <color_fragment>\n${depth}`)
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
        // The crazed Singing Ice is rougher than the lake's polish (no sun
        // glare washing a telegraph out), the frost and the snow matte.
        roughnessFactor = mix( roughnessFactor, 0.78, iceSheet );
        roughnessFactor = mix( roughnessFactor, 0.85, max( iceSkin * 0.55, iceSnow ) );`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
        totalEmissiveRadiance += ${v3(LAKE_ICE_LOOK.sky)} * iceGraze * ${graze.toFixed(2)} * ( 1.0 - iceSnow ) * ( 1.0 - iceSkin * 0.5 );`,
        )
        .replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
        // The key's highlight on the polish is a hint, never a sheet: at its
        // full GGX peak it washed a slash's line white across the lake's
        // sunward half (the bot pass of 2026-11-04). Its colour kept, its
        // peak held to LAKE_ICE_GLARE_CAP of the light.
        reflectedLight.directSpecular = min( reflectedLight.directSpecular * ${LAKE_ICE_GLARE.toFixed(2)}, vec3( ${LAKE_ICE_GLARE_CAP.toFixed(2)} ) );`,
        );
    };
    std.customProgramCacheKey = () =>
      `smith-heart-lake-ice-glint|${lowGfx ? 'low' : 'full'}|${painted ? 'painted' : 'frost'}`;
    m = std;
  }
  if (painted) {
    // The field's vertex paint's base divided out (its broad clouds kept), at the
    // painting's own level.
    const B = FIELD_GROUND_COLORS.lake_ice;
    const k = LAKE_ICE_PAINTED.gain;
    (m as THREE.MeshStandardMaterial | THREE.MeshLambertMaterial).color.setRGB(
      k / B[0],
      k / B[1],
      k / B[2],
    );
  }
  markSharedMaterial(m);
  mats.set(key, m);
  return m;
}
