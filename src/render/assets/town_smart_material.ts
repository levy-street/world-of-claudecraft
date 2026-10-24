// The Tidehold town kit's "smart material" layer (scripts/assets/blender_tidehold,
// bl_town.py smart_bake): every building ships its OWN weathering mask in the
// glTF occlusion slot, over a unique second UV set (TEXCOORD_1 -> vAoMapUv):
//
//   R = baked ambient occlusion  (three already feeds it to indirect light)
//   G = grime                     (a band up from the ground, cavities, blotches)
//   B = convex edge wear          (bevel-detected edges that are not occluded)
//
// and every textured material carries its weathering recipe as glTF extras
// (material.userData.townSmart). This layer composes the mask over the shared,
// tiling hand-painted albedo BEFORE lighting, Substance-style: grime tints and
// darkens, moss creeps onto up-facing grimy stone, painted light catches the
// worn edges, and the occlusion is painted into the diffuse too (WoW bakes its
// light into its textures). Two houses on identical textures weather
// differently because their masks differ.
//
// Frame-agnostic (it reads the view matrix and the shading normal, never the
// model matrix), so the batching merge may still combine these materials: the
// `wocFrameAgnostic` flag tells placed_fade.ts not to mark them frame-bound.
import * as THREE from 'three';

const DEFAULT_ON_BEFORE_COMPILE = THREE.Material.prototype.onBeforeCompile;
const DEFAULT_CACHE_KEY = THREE.Material.prototype.customProgramCacheKey;

export interface TownSmartSpec {
  dirt: [number, number, number];
  dirtAmt: number;
  moss: [number, number, number];
  mossAmt: number;
  edge: [number, number, number];
  edgeAmt: number;
  aoDiffuse: number;
}

const PATCHED = new WeakSet<THREE.Material>();

function isSpec(v: unknown): v is TownSmartSpec {
  const s = v as TownSmartSpec | undefined;
  return (
    !!s &&
    Array.isArray(s.dirt) &&
    Array.isArray(s.moss) &&
    Array.isArray(s.edge) &&
    typeof s.dirtAmt === 'number' &&
    typeof s.mossAmt === 'number' &&
    typeof s.edgeAmt === 'number' &&
    typeof s.aoDiffuse === 'number'
  );
}

/** Albedo pass: grime, worn edges, occlusion painted into the diffuse. */
export const TOWN_SMART_ALBEDO_GLSL = /* glsl */ `
#ifdef USE_AOMAP
	vec3 tsMask = texture2D( aoMap, vAoMapUv ).rgb;
	float tsLum = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
	// grime: multiply toward the dirt colour (keeps the painted value range)
	float tsDirt = clamp( tsMask.g * tsSmartDirtAmt, 0.0, 1.0 );
	diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * tsSmartDirt * 2.2, tsDirt * 0.85 );
	// worn edges: a painted, value-aware highlight (bright paint on bright stone)
	float tsEdge = clamp( tsMask.b * tsSmartEdgeAmt * 2.0, 0.0, 1.0 );
	diffuseColor.rgb = mix( diffuseColor.rgb, tsSmartEdge * ( 0.55 + 0.6 * tsLum ), tsEdge * 0.6 );
	// the occlusion painted in (direct light too, not only the ambient term)
	diffuseColor.rgb *= mix( 1.0, 0.25 + 0.75 * tsMask.r, tsSmartAoDiffuse );
#endif
`;

/** Normal pass: moss on up-facing grimy surfaces (world up from the view). */
export const TOWN_SMART_MOSS_GLSL = /* glsl */ `
#ifdef USE_AOMAP
	{
		vec3 tsWorldN = transformDirectionByInverseViewMatrix( normal, viewMatrix );
		float tsUp = smoothstep( 0.25, 0.85, tsWorldN.y );
		float tsMoss = clamp( tsUp * smoothstep( 0.5, 0.92, tsMask.g ) * tsSmartMossAmt * 1.4, 0.0, 1.0 );
		diffuseColor.rgb = mix( diffuseColor.rgb, tsSmartMoss * ( 0.7 + 0.5 * tsLum ), tsMoss );
	}
#endif
`;

const PARS_GLSL = /* glsl */ `
uniform vec3 tsSmartDirt;
uniform float tsSmartDirtAmt;
uniform vec3 tsSmartMoss;
uniform float tsSmartMossAmt;
uniform vec3 tsSmartEdge;
uniform float tsSmartEdgeAmt;
uniform float tsSmartAoDiffuse;
`;

/** Inject the layer into a MeshStandard/Physical fragment shader. Pure string
 *  work (exported for the tests). */
export function patchTownSmartFragment(src: string): string {
  if (
    !src.includes('#include <color_fragment>') ||
    !src.includes('#include <normal_fragment_maps>')
  )
    return src;
  return src
    .replace('void main() {', `${PARS_GLSL}\nvoid main() {`)
    .replace('#include <color_fragment>', `#include <color_fragment>\n${TOWN_SMART_ALBEDO_GLSL}`)
    .replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>\n${TOWN_SMART_MOSS_GLSL}`,
    );
}

/** Attach the layer to one material if it carries a town-smart recipe and a
 *  mask. Idempotent; chains any existing onBeforeCompile and extends the
 *  program cache key. */
export function applyTownSmart(mat: THREE.Material): boolean {
  const std = mat as THREE.MeshStandardMaterial;
  if (!std.isMeshStandardMaterial || !std.aoMap) return false;
  const spec = std.userData?.townSmart;
  if (!isSpec(spec)) return false;
  if (PATCHED.has(mat)) return true;
  PATCHED.add(mat);
  std.userData.wocFrameAgnostic = true;
  const prev = std.onBeforeCompile;
  const prevKey = std.customProgramCacheKey;
  const hadPrev = prev !== DEFAULT_ON_BEFORE_COMPILE;
  std.onBeforeCompile = (shader, renderer) => {
    if (hadPrev) prev.call(std, shader, renderer);
    shader.uniforms.tsSmartDirt = { value: spec.dirt };
    shader.uniforms.tsSmartDirtAmt = { value: spec.dirtAmt };
    shader.uniforms.tsSmartMoss = { value: spec.moss };
    shader.uniforms.tsSmartMossAmt = { value: spec.mossAmt };
    shader.uniforms.tsSmartEdge = { value: spec.edge };
    shader.uniforms.tsSmartEdgeAmt = { value: spec.edgeAmt };
    shader.uniforms.tsSmartAoDiffuse = { value: spec.aoDiffuse };
    shader.fragmentShader = patchTownSmartFragment(shader.fragmentShader);
  };
  std.customProgramCacheKey = function (this: THREE.Material) {
    const base = !hadPrev
      ? ''
      : prevKey === DEFAULT_CACHE_KEY
        ? prev.toString()
        : prevKey.call(this);
    return `${base}|townSmart`;
  };
  std.needsUpdate = true;
  return true;
}

/** Patch every town-smart material under a freshly parsed glTF scene. */
export function applyTownSmartToScene(root: THREE.Object3D): number {
  // A loader stub in a test may hand over a scene with no graph at all (the
  // same guard its siblings in loadGltf's resolve chain carry).
  if (typeof root?.traverse !== 'function') return 0;
  let n = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) if (m && applyTownSmart(m)) n++;
  });
  return n;
}

/** Material.clone() copies userData but drops onBeforeCompile: re-attach. */
export function reapplyTownSmartToClone(clone: THREE.Material): void {
  applyTownSmart(clone);
}
