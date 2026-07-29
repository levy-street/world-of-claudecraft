// Makes an authored `LAMP_FLAME` emitter behave like fire instead of a lit
// blob: it licks, leans, breathes, and runs hot at the base into a deeper
// orange at the tip.
//
// This is a shader on the material the fixture already draws, not new geometry
// and not a particle system. Streetlamps are instanced one draw per style per
// zone and a town has dozens in frame, so anything per-fixture would be the
// most expensive thing on the road. The whole effect is a vertex displacement
// plus an emissive tint, on the one shared `sharedUniforms.uTime` clock.
//
// Every lamp of a style shares one material and one program, so the per-fixture
// variation has to come from the instance itself: the phase is derived from the
// instance's own world translation, which makes neighbouring lamps flicker out
// of step without a per-instance attribute or a second draw.
import type * as THREE from 'three';
import { sharedUniforms } from './gfx';

const PROGRAM_CACHE_KEY = 'streetlamp-flame-v1';
const attached = new WeakSet<THREE.Material>();

export interface StreetlampFlameShape {
  /** Local-space Y of the flame's base, in the normalized fixture's space. */
  baseY: number;
  /** Local-space height of the flame. Sway scales off this, so the same shader
   *  suits a hand-lantern wick and a brazier's standing fire. */
  height: number;
}

/** How far the tip may lean, as a fraction of the flame's own height. */
const LEAN = 0.16;
/** How far the tip may stretch and shrink, as a fraction of its height. */
const BREATHE = 0.14;
/** Floor of the brightness flicker: a flame gutters, it never goes out. */
const FLICKER_FLOOR = 0.74;

function replaceRequired(source: string, chunk: string, replacement: string): string {
  if (!source.includes(chunk)) throw new Error(`streetlamp flame shader is missing ${chunk}`);
  return source.replace(chunk, replacement);
}

/**
 * Splice the flame motion into an emitter material. Chainable and idempotent:
 * it wraps whatever `onBeforeCompile` is already there (the biome haze field
 * attaches to the same materials) and attaches once.
 */
export function attachStreetlampFlame(material: THREE.Material, shape: StreetlampFlameShape): void {
  if (attached.has(material)) return;
  attached.add(material);

  const base = { value: shape.baseY };
  const height = { value: Math.max(shape.height, 1e-3) };
  const previousCompile = material.onBeforeCompile.bind(material);
  const previousCacheKey = material.customProgramCacheKey.bind(material);

  material.onBeforeCompile = (shader, renderer) => {
    previousCompile(shader, renderer);
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uFlameBase = base;
    shader.uniforms.uFlameHeight = height;

    shader.vertexShader = replaceRequired(
      shader.vertexShader,
      '#include <common>',
      `#include <common>
uniform float uTime;
uniform float uFlameBase;
uniform float uFlameHeight;
varying float vFlameH;
varying float vFlamePhase;`,
    );
    // After begin_vertex so `transformed` exists, and before project_vertex so
    // every later consumer (the haze field's world position included) sees the
    // displaced flame rather than the rest pose.
    shader.vertexShader = replaceRequired(
      shader.vertexShader,
      '#include <begin_vertex>',
      `#include <begin_vertex>
{
  float flameH = clamp((transformed.y - uFlameBase) / uFlameHeight, 0.0, 1.0);
  float phase = 0.0;
  #ifdef USE_INSTANCING
    phase = dot(instanceMatrix[3].xyz, vec3(0.71, 0.13, 0.37));
  #endif
  vFlameH = flameH;
  vFlamePhase = phase;
  // The base is pinned and the tip does the moving, so the flame stays seated
  // in its bowl or wick: a linear taper would slide the whole body off it.
  float lick = flameH * flameH;
  float sway = sin(uTime * 3.7 + phase) * 0.6 + sin(uTime * 6.1 + phase * 1.7) * 0.4;
  float drift = cos(uTime * 3.1 + phase * 1.3) * 0.6 + cos(uTime * 5.3 + phase) * 0.4;
  transformed.x += sway * ${LEAN.toFixed(3)} * uFlameHeight * lick;
  transformed.z += drift * ${LEAN.toFixed(3)} * uFlameHeight * lick;
  transformed.y += (sin(uTime * 4.3 + phase * 2.1) * 0.5 + 0.5)
    * ${BREATHE.toFixed(3)} * uFlameHeight * lick;
}`,
    );

    shader.fragmentShader = replaceRequired(
      shader.fragmentShader,
      '#include <common>',
      `#include <common>
uniform float uTime;
varying float vFlameH;
varying float vFlamePhase;`,
    );
    // emissivemap_fragment is where totalEmissiveRadiance settles; the emissive
    // uniform already carries emissiveIntensity, so the lamp's day/night drive
    // multiplies through this untouched.
    shader.fragmentShader = replaceRequired(
      shader.fragmentShader,
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
{
  float guttering = sin(uTime * 12.0 + vFlamePhase) * 0.5
    + sin(uTime * 19.0 + vFlamePhase * 2.3) * 0.5;
  float flicker = ${FLICKER_FLOOR.toFixed(2)}
    + ${(1 - FLICKER_FLOOR).toFixed(2)} * (guttering * 0.5 + 0.5);
  // Hot and pale at the wick, deeper orange toward the tip: the gradient is
  // most of what makes a shape read as fire rather than as a lit object.
  vec3 flameTip = totalEmissiveRadiance * vec3(1.0, 0.62, 0.22);
  totalEmissiveRadiance = mix(totalEmissiveRadiance, flameTip, vFlameH) * flicker;
}`,
    );
  };
  material.customProgramCacheKey = () => `${previousCacheKey()}|${PROGRAM_CACHE_KEY}`;
  material.needsUpdate = true;
}

export const streetlampFlameInternalsForTest = {
  programCacheKey: PROGRAM_CACHE_KEY,
  lean: LEAN,
  breathe: BREATHE,
  flickerFloor: FLICKER_FLOOR,
};
