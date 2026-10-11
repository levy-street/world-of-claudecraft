// The Seal Gate's mountain surfaces: the rock spur the tunnel is cut into (and
// the ice tongue's two rock cheeks) shaded as the Thornpeak's own snow-crusted
// granite, and the ice tongue (and the lintel's icicles) as weathered glacier
// ice. Both are ordinary LIT materials (Standard on the PBR tiers, Lambert where
// the tier sheds it), so the scene's sun, sky fill, IBL, fog and zone haze grade
// them exactly as they grade the terrain beside them: day, dusk and night.
//
// The Blender kit is vertex colour only; the detail is procedural, in world
// space, door-local (no texture of its own):
// - rock: the build's carved tone kept as relief, re-toned to cool granite,
//   strata ledges, snow on every upward face and rime plastered in patches on
//   the steep ones, plus the shared Rock026 surface-detail layer (worn_stone.ts,
//   the very set the terrain's cliffs sample) on the tiers that run it;
// - ice: annual layers (clear blue against bubbly white), transverse crevasses
//   going deep blue, a hairline fracture network, frost and old snow on top
//   (the build's baked snow mask), and a cheap view-dependent thin-edge
//   scatter at the margins. No transmission pass, no emissive: the ice never
//   glows at night.
// Inside the tunnel the build's own dark slate stays (sealGateRockInside).
//
// Two programs, built with the gate (a static zone feature attached through
// the gated compile, so they link before its first visible frame) and cached
// per material family and surface-detail tier. Pure constants and the inside
// test: sanctum_seal_gate_core.ts.
import * as THREE from 'three';
import { attachBiomeHaze } from './biome_haze_field';
import { GFX } from './gfx';
import {
  type LinearRgb,
  SANCTUM_GLACIER_ICE,
  SANCTUM_THORNPEAK_ROCK,
} from './sanctum_seal_gate_core';
import { markSharedMaterial } from './shared_resource';
import { applySurfaceDetail } from './worn_stone';

export const SANCTUM_ROCK_PROGRAM_KEY = 'sanctum-thornpeak-rock-v1';
export const SANCTUM_ICE_PROGRAM_KEY = 'sanctum-glacier-ice-v1';

/** 'full' on the PBR tiers; 'lite' (fewer noise octaves, no bump) on Lambert. */
export type SealSurfaceQuality = 'full' | 'lite';

/** The door's world origin (x, terrain height, z), shared by both programs. */
const sealOrigin = { value: new THREE.Vector3() };

export function setSealSurfaceOrigin(x: number, y: number, z: number): void {
  sealOrigin.value.set(x, y, z);
}

function v3(c: LinearRgb): string {
  return `vec3(${c.map((v) => v.toFixed(4)).join(', ')})`;
}

function f(v: number): string {
  return v.toFixed(4);
}

const VERTEX_PARS = `
varying vec3 vSealWPos;
varying vec3 vSealWN;`;

const VERTEX_MAIN = `
{
  vSealWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
  vSealWN = normalize( mat3( modelMatrix ) * objectNormal );
}`;

/** Hash value noise in 3D plus a constant-bound fbm (unrolls on ANGLE). */
function noiseGlsl(octaves: number): string {
  return `
varying vec3 vSealWPos;
varying vec3 vSealWN;
uniform vec3 uSealOrigin;
float sealHash( vec3 p ) {
  p = fract( p * 0.3183099 + 0.1 );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
float sealNoise( vec3 x ) {
  vec3 i = floor( x );
  vec3 w = fract( x );
  w = w * w * ( 3.0 - 2.0 * w );
  return mix(
    mix( mix( sealHash( i ), sealHash( i + vec3( 1.0, 0.0, 0.0 ) ), w.x ),
         mix( sealHash( i + vec3( 0.0, 1.0, 0.0 ) ), sealHash( i + vec3( 1.0, 1.0, 0.0 ) ), w.x ), w.y ),
    mix( mix( sealHash( i + vec3( 0.0, 0.0, 1.0 ) ), sealHash( i + vec3( 1.0, 0.0, 1.0 ) ), w.x ),
         mix( sealHash( i + vec3( 0.0, 1.0, 1.0 ) ), sealHash( i + vec3( 1.0, 1.0, 1.0 ) ), w.x ), w.y ),
    w.z );
}
float sealFbm( vec3 p ) {
  float sum = 0.0;
  float amp = 0.5;
  for ( int i = 0; i < ${octaves}; i++ ) {
    sum += amp * sealNoise( p );
    p = p * 2.03 + vec3( 17.1, 3.7, 9.2 );
    amp *= 0.5;
  }
  return sum / ${f(1 - 0.5 ** octaves)};
}
// three's perturbNormalArb, for a procedural height (bump from derivatives).
vec3 sealPerturb( vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir ) {
  vec3 sx = normalize( dFdx( surfPos ) );
  vec3 sy = normalize( dFdy( surfPos ) );
  vec3 r1 = cross( sy, surfNorm );
  vec3 r2 = cross( surfNorm, sx );
  float det = dot( sx, r1 ) * faceDir;
  vec3 grad = sign( det ) * ( dHdxy.x * r1 + dHdxy.y * r2 );
  return normalize( abs( det ) * surfNorm - grad );
}`;
}

// ---- the rock ----------------------------------------------------------------------

function rockAlbedoGlsl(quality: SealSurfaceQuality): string {
  const r = SANCTUM_THORNPEAK_ROCK;
  const full = quality === 'full';
  return `
  vec3 sealP = vSealWPos - uSealOrigin;
  vec3 sealN = normalize( vSealWN );
  float sealInside = ( abs( sealP.x ) < ${f(r.insideHalfWidth)} && sealP.z < ${f(r.insideEndLz)}
    && ( sealP.z > ${f(r.insideFrontLz)} || sealP.y < ${f(r.insideFloorY)} )
    && sealP.y < ${f(r.roofY0)} + ${f(r.roofSlope)} * sealP.z ) ? 1.0 : 0.0;
  float sealMacro = sealFbm( sealP * 0.21 );
  float sealFine = ${full ? 'sealNoise( sealP * 1.9 )' : '0.5'};
  // the build's carved tone (cracks, overhangs, ledges) kept as relief
  float sealCarve = mix( 1.0,
    clamp( dot( vColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) / ${f(r.bakedLuma)}, 0.55, 1.35 ), 0.35 );
  vec3 sealRock = mix( ${v3(r.rockDark)}, ${v3(r.rock)}, smoothstep( 0.2, 0.8, sealMacro ) ) * sealCarve;
  // strata ledges: thin dark seams across the face, wandering with the macro
  float sealLedge = smoothstep( 0.9, 0.99,
    abs( sin( ( sealP.y + sealMacro * 2.6 ) * ${f(Math.PI / r.strataPeriod)} ) ) )
    * smoothstep( 0.35, 0.65, sealNoise( sealP * vec3( 0.35, 0.9, 0.35 ) + 4.1 ) );
  sealRock *= 1.0 - 0.14 * sealLedge;
  // the granite's fracture network: thin dark joints at two scales, the
  // vertical set longer than the cross joints
  float sealJoint = max(
    smoothstep( 0.9, 0.975, 1.0 - abs( 2.0 * sealNoise( sealP * vec3( 0.55, 0.24, 0.55 ) + vec3( 3.1, 0.7, 5.3 ) ) - 1.0 ) ),
    ${
      full
        ? '0.6 * smoothstep( 0.92, 0.985, 1.0 - abs( 2.0 * sealNoise( sealP * vec3( 1.45, 0.62, 1.45 ) + vec3( 9.2, 4.4, 1.6 ) ) - 1.0 ) )'
        : '0.0'
    } );
  sealRock *= 1.0 - ${f(r.jointDarken)} * sealJoint;
  float sealSnow = smoothstep( ${f(r.snowLo)}, ${f(r.snowHi)},
    sealN.y + ( sealMacro - 0.5 ) * 0.7 + ( sealFine - 0.5 ) * 0.2 );
  float sealRime = ${f(r.rimeAmount)} * smoothstep( 0.45, 0.75, sealMacro * 0.7 + sealFine * 0.45 )
    * ( 1.0 - sealLedge * 0.6 );
  float sealSnowline = ${f(r.snowlineBoost)} * smoothstep( ${f(r.snowlineLo)}, ${f(r.snowlineHi)}, sealP.y );
  float sealCover = clamp( max( sealSnow, sealRime ) + sealSnowline * ( 0.5 + sealMacro ), 0.0, 1.0 )
    * ( 1.0 - sealInside );
  vec3 sealSnowC = ${v3(r.snow)} * ( 0.93 + 0.07 * sealFine );
  vec3 sealOuter = mix( sealRock, sealSnowC, sealCover );
  diffuseColor.rgb = mix( sealOuter, diffuseColor.rgb, sealInside );`;
}

const ROCK_ROUGHNESS = `
  roughnessFactor = mix( ${f(SANCTUM_THORNPEAK_ROCK.roughRock)}, ${f(SANCTUM_THORNPEAK_ROCK.roughSnow)}, sealCover );`;

/** Ledge and crust relief from derivatives (after the material's own normal
 *  layers), softened under snow. */
const ROCK_NORMAL = `
  {
    float sealH = sealMacro * 0.9 - sealLedge * 0.35 + sealFine * 0.12 - sealJoint * 0.25;
    vec2 sealDh = vec2( dFdx( sealH ), dFdy( sealH ) ) * ( 1.0 - sealInside ) * ( 1.0 - 0.6 * sealCover );
    normal = sealPerturb( - vViewPosition, normal, sealDh, faceDirection );
  }`;

function patchRock(shader: THREE.WebGLProgramParametersWithUniforms, quality: SealSurfaceQuality) {
  shader.uniforms.uSealOrigin = sealOrigin;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>${VERTEX_PARS}`)
    .replace('#include <project_vertex>', `#include <project_vertex>${VERTEX_MAIN}`);
  let frag = shader.fragmentShader
    .replace('#include <common>', `#include <common>${noiseGlsl(quality === 'full' ? 4 : 2)}`)
    .replace('#include <color_fragment>', `#include <color_fragment>${rockAlbedoGlsl(quality)}`)
    .replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>${ROCK_ROUGHNESS}`,
    );
  if (quality === 'full') {
    // after every other normal layer (the shared rock detail inserts right
    // after <normal_fragment_maps>), so the snow softens it too
    frag = frag.replace(
      '#include <emissivemap_fragment>',
      `${ROCK_NORMAL}\n#include <emissivemap_fragment>`,
    );
  }
  shader.fragmentShader = frag;
}

// ---- the ice -----------------------------------------------------------------------

function iceAlbedoGlsl(quality: SealSurfaceQuality): string {
  const i = SANCTUM_GLACIER_ICE;
  const full = quality === 'full';
  return `
  vec3 sealP = vSealWPos - uSealOrigin;
  vec3 sealN = normalize( vSealWN );
  float sealMacro = sealFbm( sealP * vec3( 0.16, 0.28, 0.16 ) );
  // The icefall's steps: the tongue breaks over the face into a stack of
  // serac bands, each a blue ice face with a snow cap on its top and a dark
  // transverse crevasse above that. The band lines wander with the macro and
  // across the width, and every band's crevasse opens and closes along x.
  // (bowed: the faster middle of the flow drags each band line down, so the
  // crevasses arc between the margins)
  float sealAcross = sealP.x - ${f(i.tongueLx)};
  float sealStepT = ( sealP.y + sealMacro * ${f(i.stepWander)}
    + sealAcross * sealAcross * ${f(i.stepBow)}
    + ( sealNoise( vec3( sealP.x * 0.28, sealP.y * 0.05, sealP.z * 0.28 ) ) - 0.5 ) * 2.4 ) / ${f(i.stepHeight)};
  float sealStep = fract( sealStepT );
  float sealBand = floor( sealStepT );
  float sealOpen = smoothstep( 0.32, 0.6,
    sealNoise( vec3( sealP.x * 0.22, sealBand * 1.73, sealP.z * 0.22 ) ) );
  float sealCrev = smoothstep( ${f(1 - i.crevasseWidth)}, ${f(1 - i.crevasseWidth * 0.45)}, sealStep ) * sealOpen;
  float sealCap = smoothstep( ${f(1 - i.crevasseWidth - i.capDepth)}, ${f(1 - i.crevasseWidth - 0.02)}, sealStep )
    * ( 1.0 - sealCrev );
  // the crevasse lip just under the gap catches the light through thin ice
  float sealLip = smoothstep( ${f(1 - i.crevasseWidth - 0.05)}, ${f(1 - i.crevasseWidth)}, sealStep )
    * ( 1.0 - smoothstep( ${f(1 - i.crevasseWidth)}, ${f(1 - i.crevasseWidth * 0.6)}, sealStep ) ) * sealOpen;
  // longitudinal splits down a band's face, here and there
  float sealSplit = smoothstep( 0.955, 0.99,
    1.0 - abs( 2.0 * sealNoise( vec3( sealP.x * 0.3 + sealP.y * 0.12, sealBand * 2.9, sealP.z * 0.3 ) ) - 1.0 ) )
    * ( 1.0 - sealCap ) * sealOpen;
  // annual layers on the faces: clear blue against bubbly white winter ice
  float sealLayerT = ( sealP.y + sealP.z * 0.18 ) / ${f(i.layerPeriod)} + sealMacro * 1.4;
  float sealLayer = 0.5 + 0.5 * sin( sealLayerT * 6.2831853 );
  float sealThin = smoothstep( 0.82, 0.98, abs( sin( sealLayerT * 18.849556 + sealMacro * 3.0 ) ) );
  float sealHair = ${
    full
      ? 'smoothstep( 0.95, 0.995, 1.0 - abs( 2.0 * sealNoise( sealP * vec3( 1.1, 2.4, 1.1 ) ) - 1.0 ) )'
      : '0.0'
  };
  vec3 sealIce = mix( ${v3(i.clear)}, ${v3(i.bubbly)}, sealLayer * 0.45 + sealThin * 0.25 + sealMacro * 0.2 );
  sealIce = mix( sealIce, ${v3(i.bubbly)} * 1.12, sealHair * 0.3 );
  sealIce = mix( sealIce, ${v3(i.edge)}, sealLip * 0.7 );
  // snow: the caps, the build's baked old snow on the upper reach, patches of
  // firn, and anything facing up; never down a crevasse
  float sealOld = smoothstep( ${f(i.snowLo)}, ${f(i.snowHi)}, vColor.r );
  float sealFirn = smoothstep( 0.35, 0.75,
    ${f(i.firnBase)} + ( sealMacro - 0.5 ) * ${f(i.firnSwing)} + max( sealN.y, 0.0 ) * ${f(i.firnUp)} );
  float sealFrost = clamp( max( max( sealOld * 0.9, sealFirn ), sealCap ), 0.0, 1.0 ) * ( 1.0 - sealCrev );
  vec3 sealAlb = mix( sealIce, ${v3(i.frost)} * ( 0.94 + 0.06 * sealMacro ), sealFrost );
  sealAlb = mix( sealAlb, ${v3(i.deep)}, max( sealCrev * 0.92, sealSplit * 0.4 ) );
  // thin-edge scatter: the margins and the icicles read translucent blue
  float sealEdge = pow( 1.0 - clamp( abs( dot( normalize( vNormal ), normalize( vViewPosition ) ) ), 0.0, 1.0 ), 3.0 );
  sealAlb = mix( sealAlb, ${v3(i.edge)}, sealEdge * ${f(i.edgeAmount)} * ( 1.0 - 0.5 * sealFrost ) );
  diffuseColor.rgb = sealAlb;`;
}

const ICE_ROUGHNESS = `
  roughnessFactor = mix( ${f(SANCTUM_GLACIER_ICE.roughClear)}, ${f(SANCTUM_GLACIER_ICE.roughFrost)}, sealFrost );`;

/** Step relief (the cap rounds over, the face drops into the crevasse), the
 *  layers and the macro swell, from derivatives. */
const ICE_NORMAL = `
  {
    float sealH = sealCap * 0.35 - sealCrev * 0.9 - sealSplit * 0.3 + sealLayer * 0.12
      + sealMacro * 0.5 - sealHair * 0.05;
    vec2 sealDh = vec2( dFdx( sealH ), dFdy( sealH ) );
    normal = sealPerturb( - vViewPosition, normal, sealDh, faceDirection );
  }`;

function patchIce(shader: THREE.WebGLProgramParametersWithUniforms, quality: SealSurfaceQuality) {
  shader.uniforms.uSealOrigin = sealOrigin;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>${VERTEX_PARS}`)
    .replace('#include <project_vertex>', `#include <project_vertex>${VERTEX_MAIN}`);
  let frag = shader.fragmentShader
    .replace('#include <common>', `#include <common>${noiseGlsl(quality === 'full' ? 3 : 2)}`)
    .replace('#include <color_fragment>', `#include <color_fragment>${iceAlbedoGlsl(quality)}`)
    .replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>${ICE_ROUGHNESS}`,
    );
  if (quality === 'full') {
    frag = frag.replace(
      '#include <emissivemap_fragment>',
      `${ICE_NORMAL}\n#include <emissivemap_fragment>`,
    );
  }
  shader.fragmentShader = frag;
}

// ---- the materials -----------------------------------------------------------------

type SurfaceKind = 'rock' | 'ice';
const cache = new Map<string, THREE.Material>();

function build(kind: SurfaceKind): THREE.Material {
  const standard = GFX.standardMaterials;
  const quality: SealSurfaceQuality = standard ? 'full' : 'lite';
  const material = standard
    ? new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness:
          kind === 'rock' ? SANCTUM_THORNPEAK_ROCK.roughRock : SANCTUM_GLACIER_ICE.roughClear,
        metalness: 0,
      })
    : new THREE.MeshLambertMaterial({ vertexColors: true });
  material.name = kind === 'rock' ? 'SanctumThornpeakRock' : 'SanctumGlacierIce';
  // The rock takes the shared Rock026 detail layer first (high and up; a
  // no-op below), so its normal, AO and roughness detail compose over the
  // re-toned albedo the hook below writes.
  if (kind === 'rock' && material instanceof THREE.MeshStandardMaterial) {
    applySurfaceDetail(material, 'rock', { strength: 0.55 });
  }
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey.bind(material);
  const tag = kind === 'rock' ? SANCTUM_ROCK_PROGRAM_KEY : SANCTUM_ICE_PROGRAM_KEY;
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    if (kind === 'rock') patchRock(shader, quality);
    else patchIce(shader, quality);
  };
  material.customProgramCacheKey = () => `${tag}:${quality}|${prevKey()}`;
  attachBiomeHaze(material);
  return markSharedMaterial(material);
}

/** The mountain-rock or glacier-ice material for the live tier (one instance
 *  per family and surface-detail setting, reused). */
export function sealGateSurfaceMaterial(kind: SurfaceKind): THREE.Material {
  const key = `${kind}|${GFX.standardMaterials ? 'std' : 'lambert'}|${GFX.surfaceDetail ? 'd' : '-'}`;
  let material = cache.get(key);
  if (!material) {
    material = build(kind);
    cache.set(key, material);
  }
  return material;
}

export const sealGateSurfaceInternalsForTest = {
  origin: sealOrigin,
  patchRock,
  patchIce,
  reset(): void {
    cache.clear();
  },
};
