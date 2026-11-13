// The painted town kit's stone where the sun does not reach it.
//
// A wall in shade is lit by the sky fill alone, and under that blue light the kit's rubble
// stone drops to a deep cobalt: a town seen from its shaded side is a row of near-black
// blue walls. A lighter, warmer stone tone fixed the shaded side but washed the sunlit side
// out to pale beige, because a tone on the albedo moves both. So the lift goes on the light,
// not the paint: every building stone fragment the sun (or a lamp) does not carry has its
// INDIRECT diffuse light scaled, and a fragment in direct light is left exactly as painted.
// Shade reads as warm grey stone, sun keeps the paint, and a cast shadow's edge blends
// between the two with the light itself.
//
// Frame-agnostic (it reads the accumulated light, never a matrix), so the batching merge
// may still combine these materials: `wocFrameAgnostic` tells placed_fade.ts not to mark
// them frame-bound (town_smart_material.ts is the same case).
import * as THREE from 'three';
import { isPaintedKitBuildingUrl } from './shared_kit_textures';

const DEFAULT_ON_BEFORE_COMPILE = THREE.Material.prototype.onBeforeCompile;
const DEFAULT_CACHE_KEY = THREE.Material.prototype.customProgramCacheKey;

export type KitShadeLift = readonly [number, number, number];

/** The lift each kit surface takes, by material name: a per-channel scale of the indirect
 *  diffuse light of a fragment in shade. Stone is the only surface that needs one. */
export const KIT_SHADE_LIFTS: Readonly<Record<string, KitShadeLift>> = {
  // Half of the tone first tried (1.9, 1.6, 1.15): in the towns this strength looked a
  // touch better than the full lift or none, and stronger or warmer lifts looked worse.
  // The lift is for the eye: stone, not cobalt, in shade.
  eh_stone: [1.45, 1.3, 1.08],
};

const PATCHED = new WeakSet<THREE.Material>();
const LIGHTS_END = '#include <lights_fragment_end>';

const PARS_GLSL = /* glsl */ `
uniform vec3 kitShadeLift;
`;

/** After every light is in: scale the indirect diffuse term by how little direct light the
 *  fragment carries (0 in shade: the whole lift, 1 where direct light is at least as
 *  strong as the fill: none). */
export const KIT_SHADE_LIFT_GLSL = /* glsl */ `
	{
		vec3 kslLuma = vec3( 0.2126, 0.7152, 0.0722 );
		float kslDirect = dot( reflectedLight.directDiffuse, kslLuma );
		float kslFill = dot( reflectedLight.indirectDiffuse, kslLuma );
		float kslLit = clamp( kslDirect / max( kslFill, 1e-4 ), 0.0, 1.0 );
		reflectedLight.indirectDiffuse *= mix( kitShadeLift, vec3( 1.0 ), kslLit );
	}
`;

/** Inject the lift into a lit fragment shader. Pure string work (exported for the tests);
 *  a shader without the light accumulation anchor comes back untouched. */
export function patchKitShadeLiftFragment(src: string): string {
  if (!src.includes(LIGHTS_END) || src.includes('kitShadeLift')) return src;
  return src
    .replace('void main() {', `${PARS_GLSL}\nvoid main() {`)
    .replace(LIGHTS_END, `${LIGHTS_END}\n${KIT_SHADE_LIFT_GLSL}`);
}

function isLift(value: unknown): value is KitShadeLift {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((channel) => typeof channel === 'number' && Number.isFinite(channel))
  );
}

/** Attach the lift to one material that carries a lift in `userData.kitShadeLift`.
 *  Idempotent; chains any existing onBeforeCompile and extends the program cache key. */
export function applyKitShadeLift(mat: THREE.Material): boolean {
  const lit = mat as THREE.MeshStandardMaterial;
  if (!lit.isMeshStandardMaterial) return false;
  const lift = lit.userData?.kitShadeLift;
  if (!isLift(lift)) return false;
  if (PATCHED.has(mat)) return true;
  PATCHED.add(mat);
  lit.userData.wocFrameAgnostic = true;
  const prev = lit.onBeforeCompile;
  const prevKey = lit.customProgramCacheKey;
  const hadPrev = prev !== DEFAULT_ON_BEFORE_COMPILE;
  lit.onBeforeCompile = (shader, renderer) => {
    if (hadPrev) prev.call(lit, shader, renderer);
    const patched = patchKitShadeLiftFragment(shader.fragmentShader);
    if (patched === shader.fragmentShader) return;
    shader.uniforms.kitShadeLift = { value: lift };
    shader.fragmentShader = patched;
  };
  lit.customProgramCacheKey = function (this: THREE.Material) {
    const base = !hadPrev
      ? ''
      : prevKey === DEFAULT_CACHE_KEY
        ? prev.toString()
        : prevKey.call(this);
    return `${base}|kitShadeLift:${lift.join(',')}`;
  };
  lit.needsUpdate = true;
  return true;
}

/** Stamp and patch the stone of a freshly parsed painted-kit BUILDING (a town lot, a placed
 *  house or a one-prop building). The kit's small props, the castle kit and every other
 *  model are left alone: a prop's stone is tuned where it stands, and the castle kit also
 *  builds the palaces' rooms, which are lit by their own lamps. */
export function applyKitShadeLiftToScene(root: THREE.Object3D, url: string): number {
  // A loader stub in a test may hand over a scene with no graph at all (the same guard
  // its siblings in loadGltf's resolve chain carry).
  if (typeof root?.traverse !== 'function' || !isPaintedKitBuildingUrl(url)) return 0;
  let n = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const lift = m ? KIT_SHADE_LIFTS[m.name] : undefined;
      if (!m || !lift) continue;
      m.userData.kitShadeLift = [...lift];
      if (applyKitShadeLift(m)) n++;
    }
  });
  return n;
}

/** Material.clone() copies userData but drops onBeforeCompile: re-attach. */
export function reapplyKitShadeLiftToClone(clone: THREE.Material): void {
  applyKitShadeLift(clone);
}
