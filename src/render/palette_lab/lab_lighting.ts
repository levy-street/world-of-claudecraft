// The palette lab's lighting arm (`?palette=on` only): a soft rim light on
// rounded shapes, the way anime-styled worlds light a silhouette against its
// sky. Installed at module scope, like the cel patch, so the world renderer
// AND the preview/portrait renderers compile under the same look; without the
// flag nothing here touches a chunk and every program is the shipped one.
//
// One shared value array drives every lit material at once. three gives each
// built-in material its own clone of ShaderLib's uniforms, but cloneUniforms
// passes a typed array BY REFERENCE (it clones Colors and Vectors and slices
// plain Arrays, and leaves everything else alone), so a Float32Array value on
// ShaderLib is one live array every Standard, Lambert, Phong and Toon program
// reads, re-uploaded whenever it changes.
//
// The rim is gated on CURVATURE per yard (the cel material ink's measure), so
// characters, canopies and rocks catch it while terrain, walls and grass cards
// never glow at grazing angles, and it fades out with distance.

import * as THREE from 'three';
import { paletteLabEnabled } from './palette_lab_flag';

/** x strength, y falloff power, z curvature start, w curvature full (per yard). */
const RIM = new Float32Array([0, 3, 0.12, 0.35]);
/** rgb rim colour (linear), a how much of the surface's own colour it takes. */
const RIM_COLOR = new Float32Array([0.8, 0.9, 1, 0.5]);

export const LAB_RIM_MARKER = 'WOC_LAB_RIM';

const RIM_DECLARATIONS = /* glsl */ `
// ${LAB_RIM_MARKER}
uniform vec4 uWocLabRim;
uniform vec4 uWocLabRimColor;
`;

const RIM_GLSL = /* glsl */ `
// ${LAB_RIM_MARKER}
if ( uWocLabRim.x > 0.0 ) {
	vec3 wocRimN = normalize( nonPerturbedNormal );
	float wocRimFacing = saturate( dot( wocRimN, geometryViewDir ) );
	float wocRimCurve = smoothstep( uWocLabRim.z, uWocLabRim.w, length( fwidth( wocRimN ) ) / max( length( fwidth( vViewPosition ) ), 1e-4 ) );
	float wocRimNear = 1.0 - smoothstep( 50.0, 110.0, length( vViewPosition ) );
	float wocRim = pow( 1.0 - saturate( wocRimFacing ), uWocLabRim.y ) * wocRimCurve * wocRimNear * uWocLabRim.x;
	reflectedLight.directDiffuse += material.diffuseColor * mix( vec3( 1.0 ), uWocLabRimColor.rgb, uWocLabRimColor.a ) * ( wocRim * 0.32 );
}
`;

// The ShaderLib entries whose materials compile the lights chunks. `physical`
// was merged from `standard` when three loaded, so both get the entry.
const LIT_SHADERS = ['standard', 'physical', 'lambert', 'phong', 'toon'] as const;

interface LabLightingChunks {
  lights_pars_begin: string;
  lights_fragment_end: string;
}

type ShaderLibLike = Record<string, { uniforms: Record<string, THREE.IUniform> }>;

/**
 * Install the rim arm. Idempotent; returns true only when this call patched.
 * Exported with injectable chunks and ShaderLib for the test.
 */
export function installLabLighting(
  chunks: LabLightingChunks = THREE.ShaderChunk,
  lib: ShaderLibLike = THREE.ShaderLib as unknown as ShaderLibLike,
): boolean {
  if (chunks.lights_fragment_end.includes(LAB_RIM_MARKER)) return false;
  chunks.lights_pars_begin = `${chunks.lights_pars_begin}${RIM_DECLARATIONS}`;
  chunks.lights_fragment_end = `${chunks.lights_fragment_end}${RIM_GLSL}`;
  for (const id of LIT_SHADERS) {
    const entry = lib[id];
    if (!entry) continue;
    entry.uniforms.uWocLabRim = { value: RIM };
    entry.uniforms.uWocLabRimColor = { value: RIM_COLOR };
  }
  return true;
}

/** Set the rim: strength (0 is off), falloff power, linear colour, albedo share. */
export function setLabRim(
  strength: number,
  power: number,
  color: readonly [number, number, number],
  albedo: number,
): void {
  RIM[0] = strength;
  RIM[1] = power;
  RIM_COLOR[0] = color[0];
  RIM_COLOR[1] = color[1];
  RIM_COLOR[2] = color[2];
  RIM_COLOR[3] = albedo;
}

// The live AO pass (N8AO chains, High and up), registered by post.ts like the
// bloom pass. Its colour and intensity are copied into the compositor every
// render, so writing them here is live; the colour is mutated in place so the
// pass never resets its accumulation.
export interface LabAoTarget {
  configuration: { color: { set(hex: number): void }; intensity: number };
}

let liveAo: LabAoTarget | null = null;

export function setPaletteAoPass(pass: LabAoTarget | null): void {
  liveAo = pass;
}

export function livePaletteAoPass(): LabAoTarget | null {
  return liveAo;
}

if (paletteLabEnabled()) installLabLighting();
