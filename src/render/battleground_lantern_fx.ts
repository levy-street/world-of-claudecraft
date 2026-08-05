// The flame inside every rune lantern on the Thornhollow Fields.
//
// ONE draw for the whole field. Each mote carries its own lamp's world
// position in `position` and its motion is derived in the vertex shader from a
// baked seed and the renderer's shared `uTime`, so the field's two dozen
// lanterns cost a single Points object and ZERO per-frame CPU, there is no
// update() here on purpose, and nothing to tick.
//
// The lamp positions come from battleground_lantern_fx_core.ts, which resolves
// each post's placement through the model's arm. That is the whole reason the
// math lives in a core: a flame that misses its lantern is a geometry bug, and
// it is cheaper to catch in a unit test than by walking to a pad in game.
import * as THREE from 'three';
import {
  LANTERN_FLAME,
  LANTERN_SEED_STRIDE,
  type LanternPlacement,
  lanternLampWorld,
  lanternMoteSeeds,
} from './battleground_lantern_fx_core';
import { sharedUniforms } from './gfx';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';

const FLAME_VERTEX = /* glsl */ `
  const float TAU = 6.28318530718;
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uRise;
  uniform float uRadius;
  uniform float uSize;
  uniform float uCycle;
  varying float vAlpha;
  void main() {
    float rate = 0.65 + 0.7 * aSeed.w;
    float life = fract(aSeed.z + uTime * rate / uCycle);
    // Quick off the wick, slowing as it cools: the shape of a small flame
    // rather than of a fountain.
    float climb = sqrt(life);
    float ang = aSeed.x * TAU + sin(uTime * 1.7 + aSeed.z * TAU) * 0.6;
    // Contracts as it rises, so the flame tapers instead of mushrooming.
    float r = uRadius * (0.25 + 0.75 * aSeed.y) * (1.0 - 0.75 * climb);
    vec3 p = position + vec3(cos(ang) * r, climb * uRise, sin(ang) * r);
    float flicker = 0.55 + 0.45 * sin(uTime * (14.0 + 8.0 * aSeed.w) + aSeed.z * TAU);
    vAlpha = smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.25, 1.0, life)) * flicker;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    // Fixed-pixel size over depth, and shrinking as the mote burns out.
    gl_PointSize = (uSize / max(-mv.z, 1.0)) * (0.45 + 0.55 * (1.0 - climb));
    gl_Position = projectionMatrix * mv;
  }
`;

// A hot core falling off to amber. The core is what stops a small warm mote
// from reading as a dirty orange smudge against a lit daytime field.
const FLAME_FRAGMENT = /* glsl */ `
  uniform vec3 uCore;
  uniform vec3 uEdge;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    float core = smoothstep(0.5, 0.05, d);
    float a = core * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(mix(uEdge, uCore, pow(max(core, 0.0), 2.2)), a);
  }
`;

/**
 * Build the field's lantern flames, or null when there is nothing to light
 * (no lanterns, or a tier that does not pay for cosmetic particles).
 *
 * `placements` is the whole field list; this picks its own out of it, so the
 * caller does not have to know which asset id is a lantern.
 */
export function buildLanternFlames(
  placements: readonly (LanternPlacement & { assetId: string })[],
  opts: {
    lowGfx: boolean;
    assetId?: string;
    /** Where the fire sits in the fixture's own frame (lamp glass, torch cage). */
    local?: { readonly x: number; readonly y: number; readonly z: number };
    /** Flame tuning: a caged torch burns bigger and slower than a lamp. */
    flame?: {
      readonly perLantern: number;
      readonly rise: number;
      readonly radius: number;
      readonly size: number;
      readonly cycleSec: number;
      readonly colorCore: number;
      readonly colorEdge: number;
    };
  },
): THREE.Points | null {
  if (opts.lowGfx) return null;
  const assetId = opts.assetId ?? 'dungeon/post_lantern';
  const local = opts.local;
  const tuning = opts.flame ?? LANTERN_FLAME;
  const posts = placements.filter((p) => p.assetId === assetId);
  if (posts.length === 0) return null;

  const per = tuning.perLantern;
  const count = posts.length * per;
  const pos = new Float32Array(count * 3);
  // Seeded across the WHOLE field, not per lantern: a shared block would give
  // every ring of four the same phases and the pad would strobe instead of
  // burn.
  const seeds = lanternMoteSeeds(count);
  for (let i = 0; i < posts.length; i++) {
    const lamp = lanternLampWorld(posts[i], local);
    for (let m = 0; m < per; m++) {
      const o = (i * per + m) * 3;
      pos[o] = lamp.x;
      pos[o + 1] = lamp.y;
      pos[o + 2] = lamp.z;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, LANTERN_SEED_STRIDE));
  // The shader lifts motes above their lamp, so widen the sphere the renderer
  // culls against rather than leaving it fitted to the bare lamp points.
  geo.computeBoundingSphere();
  if (geo.boundingSphere) geo.boundingSphere.radius += tuning.rise + tuning.radius;
  markSharedGeometry(geo);

  const mat = markSharedMaterial(
    new THREE.ShaderMaterial({
      vertexShader: FLAME_VERTEX,
      fragmentShader: FLAME_FRAGMENT,
      uniforms: {
        uTime: sharedUniforms.uTime,
        uRise: { value: tuning.rise },
        uRadius: { value: tuning.radius },
        uSize: { value: tuning.size },
        uCycle: { value: tuning.cycleSec },
        uCore: { value: new THREE.Color(tuning.colorCore) },
        uEdge: { value: new THREE.Color(tuning.colorEdge) },
      },
      transparent: true,
      depthWrite: false,
      // depthTest OFF, and this is the whole trick. The flame sits at the
      // centre of the lamp's glass, and that glass is an OPAQUE panel in the
      // model, depth-tested, the effect is perfectly positioned and perfectly
      // invisible, sealed inside its own lantern. Drawn over the shell it reads
      // as the light INSIDE the lamp, which is what it is. The cost is that a
      // lantern's flame is not occluded by geometry in front of it; at this
      // size (a third of a yard) that is not something a player can catch.
      depthTest: false,
      blending: THREE.AdditiveBlending,
    }),
  );

  const points = new THREE.Points(geo, mat);
  points.name = `battleground-flames-${assetId.replace('/', '-')}`;
  points.renderOrder = 4;
  return points;
}
