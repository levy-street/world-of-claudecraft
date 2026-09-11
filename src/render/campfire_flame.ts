// The game's campfire flame: a two-part lathed fire, a soft orange body with a
// hot yellow-white core inside it, that licks and breathes in the vertex
// shader.
//
// props.ts builds one of these at every world campfire and hands it to the
// renderer's scenery-flame lane, which samples a slow breath on it and trails
// embers. It is what a campfire looks like in the live game.
//
// It lives here because the EDITOR needs the same thing. A world campfire that
// has been promoted to an editable placement carries the legacy `fire: true`
// flag, and the placed-fire system answered that with its generic emitter, a
// billboard tongue plane plus a hot-core sphere, sized for authored bonfires
// and wildfires. On a knee-high campfire that reads as a pale cone standing
// over a white blob, nothing like the fire beside it in game. Same recipe,
// same look, one definition.
//
// WHY THE MOTION IS IN THE SHADER. The old flame was one opaque lathe that a
// CPU lane rescaled a few times a second: at any instant it is a flat
// hard-edged teardrop, and a whole-object scale pulse reads as a balloon
// inflating, not as fire. The licking now happens per vertex, higher rings
// sway further, the waist pinches, the tip fades out, and the per-fire phase
// comes from `modelMatrix[3].xz`, so every campfire in the world moves
// differently while sharing ONE material recipe and therefore ONE linked
// program. That last point is not incidental: this world litters campfires,
// and a per-fire uniform would have meant a per-fire program link.

import * as THREE from 'three';
import { sharedUniforms } from './gfx';

/** The authored height of one unscaled flame, for callers that size against it. */
export const CAMPFIRE_FLAME_HEIGHT = 0.95;

/** Profile of the outer body, in yards: radius against height. Fuller through
 *  the waist than the old teardrop and drawn out to a finer tip, so the
 *  silhouette tapers into the alpha fade instead of stopping. */
const FLAME_PROFILE: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.14, 0.05],
  [0.21, 0.16],
  [0.24, 0.3],
  [0.235, 0.45],
  [0.2, 0.6],
  [0.14, 0.74],
  [0.07, 0.87],
  [0.001, 1],
];

/** The core: the bright heart, roughly two thirds the height and half the
 *  girth, so the body always reads around it. */
const CORE_PROFILE: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.085, 0.05],
  [0.12, 0.15],
  [0.125, 0.28],
  [0.095, 0.42],
  [0.045, 0.55],
  [0.001, 0.64],
];

function lathe(
  profile: readonly (readonly [number, number])[],
  segments: number,
): THREE.LatheGeometry {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y * CAMPFIRE_FLAME_HEIGHT)),
    segments,
  );
}

/** Twenty radial segments. Not for roundness, the old seven were plenty for
 *  that, but for the three-lobe tongue wave the vertex shader rides around the
 *  axis: at seven segments that wave ALIASES, and the flame came out covered in
 *  bright zigzag shards. The lathe is nine rings of cheap triangles either way. */
export function campfireFlameGeometry(): THREE.LatheGeometry {
  return lathe(FLAME_PROFILE, 20);
}

/** The inner core's lathe. Fewer segments than the body: it is small and always
 *  inside the translucent body, but it carries the same lobe wave, so it still
 *  needs enough to sample it. */
export function campfireFlameCoreGeometry(): THREE.LatheGeometry {
  return lathe(CORE_PROFILE, 14);
}

export interface CampfireFlameOptions {
  /** Emissive strength; props.ts passes its PBR-tier constant. */
  emissiveIntensity?: number;
  color?: number;
  emissive?: number;
  opacity?: number;
}

// ---------------------------------------------------------------------------
// The shared vertex/fragment patch. Both hooks are module-level constants, so
// every flame material's default customProgramCacheKey (which IS
// onBeforeCompile.toString()) matches and three hands them all one program.
// ---------------------------------------------------------------------------

const FLAME_VERTEX_HEAD = /* glsl */ `
uniform float uTime;
varying float vFlameH;
varying vec3 vFlameNormal;
varying vec3 vFlameView;
varying float vFlamePhase;
`;

/** `height` is baked in so the normalized height is exact per layer. */
function flameVertexBody(height: number, sway: number): string {
  return /* glsl */ `
  float flameH = clamp(transformed.y / ${height.toFixed(4)}, 0.0, 1.0);
  // One phase per fire, read from where the fire stands. Same material, same
  // program, but no two campfires in a camp lick together.
  float flamePhase = modelMatrix[3].x * 0.73 + modelMatrix[3].z * 1.31;
  // Higher rings travel further: the base stays seated in the embers while the
  // tip whips. Two frequencies per axis so the path never reads as a circle.
  float lick = pow(flameH, 1.7) * ${sway.toFixed(3)};
  transformed.x +=
    (sin(uTime * 5.1 + flamePhase + flameH * 6.2) * 0.055 +
     sin(uTime * 11.3 + flamePhase * 1.9) * 0.022) * lick;
  transformed.z +=
    (cos(uTime * 4.3 + flamePhase * 1.7 + flameH * 5.1) * 0.055 +
     cos(uTime * 9.7 + flamePhase * 0.6) * 0.02) * lick;
  // Waist pinch and a shallow breath: the fire necks in low down and rises,
  // which is the motion the old whole-object scale was reaching for.
  transformed.xz *= 1.0 + sin(uTime * 7.3 + flamePhase) * 0.09 * (1.0 - flameH);
  transformed.y *= 1.0 + sin(uTime * 6.1 + flamePhase * 0.7) * 0.07;
  // Three travelling lobes around the axis, opening up toward the tip. This is
  // what stops a lathe reading as a lathe: the silhouette is no longer a circle
  // of revolution, so the fire has tongues instead of a waistline.
  float flameAngle = atan(position.z, position.x);
  transformed.xz *= 1.0 + 0.14 * sin(flameAngle * 3.0 + uTime * 3.1 + flamePhase) * flameH;
  vFlameH = flameH;
  vFlamePhase = flamePhase;
  vFlameNormal = normalize(normalMatrix * objectNormal);
`;
}

const FLAME_FRAGMENT_HEAD = /* glsl */ `
uniform float uTime;
varying float vFlameH;
varying vec3 vFlameNormal;
varying vec3 vFlameView;
varying float vFlamePhase;
`;

/**
 * Alpha shaping, which is most of why the old flame read as a plastic blob:
 *  - the tip dissolves instead of ending in a hard point,
 *  - the base is solid so the fire has a seat in the embers, and
 *  - grazing angles soften, so the silhouette has no cut edge against the sky.
 */
/**
 * The body's alpha and heat shaping, most of why the old flame read as a
 * plastic blob:
 *  - the tip dissolves instead of ending in a hard point,
 *  - the base is solid so the fire has a seat in the embers,
 *  - grazing angles soften, so the silhouette has no cut edge against the sky,
 *  - and a real flame is not ONE colour. It burns yellow-white where the fuel
 *    is and cools to red on the way up; flat orange top to bottom is what a
 *    plastic toy looks like.
 * The tint multiplies the material's own colour, so props.ts's per-tier
 * emissive tuning still lands.
 */
const FLAME_FRAGMENT_BODY = /* glsl */ `
  float flameTip = 1.0 - smoothstep(0.5, 1.0, vFlameH);
  float flameSeat = smoothstep(0.0, 0.1, vFlameH);
  float flameRim = abs(dot(normalize(vFlameNormal), normalize(vFlameView)));
  // Opaque through the middle, translucent only at the silhouette. A fire that
  // is see-through everywhere shows whatever it stands in, a campfire in tall
  // grass came out looking scratched, because every blade its own light had
  // blown out read straight through the flame.
  gl_FragColor.a *= flameTip * mix(0.7, 1.0, flameSeat) * mix(0.42, 1.0, smoothstep(0.0, 0.5, flameRim));
  gl_FragColor.rgb *= mix(vec3(1.45, 1.18, 0.6), vec3(0.95, 0.34, 0.12), smoothstep(0.05, 0.85, vFlameH));
  // Gas rising INSIDE the flame, not just a wobbling outline: two bands
  // scrolling up at different rates, so the body is never uniformly lit.
  float flameFlow =
    sin(vFlameH * 13.0 - uTime * 5.4 + vFlamePhase) * 0.5 +
    sin(vFlameH * 7.0 - uTime * 3.1 + vFlamePhase * 1.7) * 0.5;
  gl_FragColor.rgb *= 1.0 + flameFlow * 0.14 * (1.0 - vFlameH * 0.5);
`;

/**
 * The core's. It stays hot to its tip, the whole point of a second layer is
 * that the body's cooling gradient has something bright to cool AWAY from, so
 * it only fades out, and does it early enough to disappear inside the body
 * rather than poking through the top.
 */
const FLAME_FRAGMENT_CORE = /* glsl */ `
  float coreRim = abs(dot(normalize(vFlameNormal), normalize(vFlameView)));
  gl_FragColor.a *= (1.0 - smoothstep(0.3, 0.92, vFlameH)) * smoothstep(0.0, 0.1, vFlameH) *
    mix(0.15, 1.0, smoothstep(0.0, 0.7, coreRim));
`;

function attachFlameMotion(
  material: THREE.Material,
  height: number,
  sway: number,
  kind: 'body' | 'core',
): void {
  const vertexBody = flameVertexBody(height, sway);
  const fragmentBody = kind === 'core' ? FLAME_FRAGMENT_CORE : FLAME_FRAGMENT_BODY;
  // MANDATORY, not tidiness. three's default program cache key IS
  // onBeforeCompile.toString(), and this hook's SOURCE is identical for both
  // layers, only the captured height/sway/kind differ. Without an explicit key
  // the core would be handed the body's compiled program (or the reverse),
  // whichever linked first. The key is coarse on purpose: two programs for
  // every fire in the world.
  material.customProgramCacheKey = () => `campfire-flame:${kind}:${height}:${sway}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.vertexShader = (FLAME_VERTEX_HEAD + shader.vertexShader)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${vertexBody}`)
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvFlameView = -mvPosition.xyz;',
      );
    shader.fragmentShader = (FLAME_FRAGMENT_HEAD + shader.fragmentShader).replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>\n${fragmentBody}`,
    );
  };
}

/**
 * The outer body. Kept a MeshLambertMaterial: the scenery lane reads
 * `material.color.r > material.color.b` off it to decide a flame is warm enough
 * to trail embers, and props.ts tunes its emissive by graphics tier.
 */
export function campfireFlameMaterial(
  options: CampfireFlameOptions = {},
): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({
    color: options.color ?? 0xff8a2a,
    emissive: options.emissive ?? 0xff5500,
    emissiveIntensity: options.emissiveIntensity ?? 1.4,
    transparent: true,
    opacity: options.opacity ?? 1,
    // Fire is not a solid: writing depth made the body clip its own core and
    // punch a hole in whatever haze drew after it.
    depthWrite: false,
    // FrontSide, and this one is load-bearing. A transparent DoubleSide mesh
    // draws its far wall and its near wall in geometry order with no sorting
    // between them, so once the vertex shader displaces the two differently the
    // overlap breaks into bright tapering shards, the flame came out looking
    // scratched. The core is what gives the fire its depth instead.
    side: THREE.FrontSide,
  });
  attachFlameMotion(material, CAMPFIRE_FLAME_HEIGHT, 1, 'body');
  return material;
}

/**
 * The hot core. Additive and unlit, so it blows past the body's orange into
 * yellow-white where the two overlap, the part of a real fire that carries the
 * heat. Additive keeps it honest in daylight too: it adds to whatever is behind
 * it rather than pasting a pale shape over it.
 */
export function campfireFlameCoreMaterial(
  options: CampfireFlameOptions = {},
): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: options.color ?? 0xfff0b4,
    transparent: true,
    opacity: options.opacity ?? 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    // FrontSide, unlike the body: an additive back face shows THROUGH the front
    // one and the core reads as bright streaks inside the flame instead of a
    // solid heart.
    side: THREE.FrontSide,
  });
  // The core sways HARDER than the body it sits in, so the two never move as
  // one rigid piece, the tell that gave the old single lathe away.
  // Swaying a LITTLE harder than the body reads as heat rising through it;
  // much harder and the core punches out through the body's skin.
  attachFlameMotion(material, CAMPFIRE_FLAME_HEIGHT * 0.64, 1.2, 'core');
  return material;
}

let sharedBody: THREE.LatheGeometry | null = null;
let sharedCore: THREE.LatheGeometry | null = null;

export interface CampfireFlame {
  /** The outer body. Parent of the core, so one transform moves both. */
  flame: THREE.Mesh;
  core: THREE.Mesh;
  /** Both materials, for callers that own disposal. */
  materials: THREE.Material[];
}

/**
 * One complete campfire flame: body + core, already parented.
 *
 * Callers that track flames (the scenery lane's `flames` list, the placed-asset
 * emitter) keep holding the BODY mesh, exactly as they held the old single
 * lathe, and the core rides its transform.
 */
export function buildCampfireFlame(options: CampfireFlameOptions = {}): CampfireFlame {
  // Both lathes are module-shared: a world litters campfires, and the previous
  // code was careful to build ONE geometry for all of them.
  sharedBody ??= campfireFlameGeometry();
  sharedCore ??= campfireFlameCoreGeometry();
  const bodyMaterial = campfireFlameMaterial(options);
  const coreMaterial = campfireFlameCoreMaterial();
  const flame = new THREE.Mesh(sharedBody, bodyMaterial);
  flame.name = 'campfire-flame';
  const core = new THREE.Mesh(sharedCore, coreMaterial);
  core.name = 'campfire-flame-core';
  // Drawn after the body so the additive heart reads through it.
  flame.renderOrder = 2;
  core.renderOrder = 3;
  flame.add(core);
  return { flame, core, materials: [bodyMaterial, coreMaterial] };
}

/**
 * The slow breath the renderer's scenery lane applies on top, as a pure
 * function of time.
 *
 * Extracted so a flame OUTSIDE that lane (the editor's placed campfires, which
 * animate from their own onBeforeRender) moves identically instead of
 * inventing a second wobble. `index` decorrelates neighbouring fires.
 *
 * Deliberately gentle now that the shader owns the licking: this is the swell
 * of a log catching, sampled at a perceptual-LOD cadence, not the flicker. The
 * two used to be the same number and the flame pumped like a bellows.
 */
export function campfireFlameScale(time: number, index: number): { xz: number; y: number } {
  const xz =
    0.97 + Math.sin(time * 1.7 + index * 2.4) * 0.035 + Math.sin(time * 4.1 + index) * 0.02;
  return { xz, y: xz * (1 + Math.sin(time * 2.3 + index) * 0.05) };
}
