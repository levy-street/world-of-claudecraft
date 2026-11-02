// Gourdlight Eve's two GLBs (scripts/assets/gourdlight_eve/model.py): the city
// dressing kit and the wearable pumpkin head. Loaded ON DEMAND, the first time
// the world reports the event open: a world that never sees the event (most of
// the year) never fetches, parses or links any of it.
//
// Each named node of the kit becomes a list of PARTS (one geometry + one shared
// material per glTF primitive, baked into the node's own frame) that the decor
// view instances and the worn head clones. Materials are cloned ONCE from the
// cache (the loader's results are immutable) and shared by every instance and
// every head; the glow ones (the carved rind, the candle, the paper) join the
// one seasonal glow driver (seasonal_glow.ts). On the Lambert tier each becomes
// the Lambert equivalent, vertex colour and emissive kept.
import * as THREE from 'three';
import { loadGltf } from './assets/loader';
import { attachBiomeHaze } from './biome_haze_field';
import { GFX } from './gfx';
import { registerSeasonalGlowMaterial, resetSeasonalGlowMaterials } from './seasonal_glow';

export const GOURDLIGHT_DECOR_URL = '/models/props/gourdlight_decor.glb';
export const GOURDLIGHT_HEAD_URL = '/models/props/gourdlight_pumpkin_head.glb';

/** The kit's named nodes (the factory's contract). */
export const GOURDLIGHT_DECOR_NODES = [
  'pumpkin_lit',
  'pumpkin_small',
  'gourd',
  'lantern',
  'garland_pole',
  'garland_leaf',
  'garland_bead',
  'keeper_stall',
  'corn_shock',
  'hay_bale',
  'road_lantern',
] as const;
export type GourdlightDecorNode = (typeof GOURDLIGHT_DECOR_NODES)[number];

/** Glow materials and their strength and flicker family (the paper and the
 *  rind flicker on different phases, so a street never pulses in unison). */
const GLOW_MATERIALS: Readonly<
  Record<string, { base: number; phase: number; rim: number; paper: boolean; skin?: boolean }>
> = {
  GourdGlow: { base: 1.4, phase: 0, rim: 0.7, paper: false },
  GourdInner: { base: 1.0, phase: 0.4, rim: 0.55, paper: false },
  GourdFlesh: { base: 0.7, phase: 0.8, rim: 0.6, paper: false },
  LanternPaper: { base: 0.32, phase: 2.1, rim: 0.36, paper: true },
  // a carved pumpkin's rind: the candle inside showing faintly through it after
  // dark, tinted by the rind's own painted colour (so the grooves stay darker)
  GourdLitSkin: { base: 0.13, phase: 0.2, rim: 0.75, paper: false, skin: true },
};

/** Shape a glow material's light the way a lit shell reads (the standard tier only;
 *  Lambert keeps the flat glow): brightest where the surface faces the eye, dimmer
 *  toward its silhouette (`rim`), and on paper darker along the ribs and the caps,
 *  read off the vertex colour the factory painted, so a lantern at night is a glowing
 *  ribbed globe instead of a flat disc. One extra cached program per glow material. */
function shapeGlow(
  material: THREE.MeshStandardMaterial,
  rim: number,
  paper: boolean,
  skin = false,
): void {
  const tag = `woc-seasonal-glow:${rim}:${paper ? 1 : 0}:${skin ? 1 : 0}`;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      {
        float wocFace = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
        float wocShape = mix(${rim.toFixed(3)}, 1.0, wocFace);
        #if ${paper ? 1 : 0} && defined( USE_COLOR )
          float wocLum = dot(vColor.rgb, vec3(0.299, 0.587, 0.114));
          wocShape *= clamp(wocLum * 1.7, 0.3, 1.15);
        #endif
        #if ${skin ? 1 : 0} && defined( USE_COLOR )
          // light through the rind takes the rind's colour, deepest in the grooves
          totalEmissiveRadiance *= vColor.rgb * 1.8;
        #endif
        totalEmissiveRadiance *= wocShape;
      }`,
    );
  };
  material.customProgramCacheKey = () => tag;
}

export interface SeasonalPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

export interface GourdlightAssets {
  decor: Readonly<Record<GourdlightDecorNode, readonly SeasonalPart[]>>;
  head: readonly SeasonalPart[];
}

type LoadState = 'idle' | 'loading' | 'ready' | 'failed';
let state: LoadState = 'idle';
let assets: GourdlightAssets | null = null;
const sharedMaterials = new Map<THREE.Material, THREE.Material>();
/** The material tier the ready kit was built for (GFX.standardMaterials): a graphics
 *  rebuild that changes it rebuilds the kit's materials on the next ask. */
let builtTier: boolean | null = null;

function prepareMaterial(source: THREE.Material): THREE.Material {
  const cached = sharedMaterials.get(source);
  if (cached) return cached;
  const src = source as THREE.MeshStandardMaterial;
  const glow = GLOW_MATERIALS[src.name];
  const opts = {
    name: src.name,
    color: src.color?.clone() ?? new THREE.Color(1, 1, 1),
    vertexColors: true,
    emissive: glow ? (src.emissive?.clone() ?? new THREE.Color(1, 0.5, 0.1)) : new THREE.Color(0),
    emissiveIntensity: glow ? 1 : 0,
    // the factory authors every shell (paper, leaves, the cut rind) two sided
    side: source.side,
  };
  const material = GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({
        ...opts,
        roughness: src.roughness ?? 0.7,
        metalness: src.metalness ?? 0,
      })
    : new THREE.MeshLambertMaterial(opts);
  // the glow's shape first: the haze chains onto whatever hook the material carries
  if (glow && material instanceof THREE.MeshStandardMaterial) {
    shapeGlow(material, glow.rim, glow.paper, glow.skin === true);
  }
  attachBiomeHaze(material);
  if (glow) registerSeasonalGlowMaterial(material, glow.base, glow.phase);
  sharedMaterials.set(source, material);
  return material;
}

/** A copy whose attributes are plain, non-interleaved floats: the optimizer
 *  quantizes them (normalized integers) and, on a big mesh, interleaves them;
 *  baking a transform into a normalized attribute would clamp it back into
 *  [-1, 1], and an interleaved one would be skipped. Read through the
 *  accessor getters, which denormalize either kind. */
const COMPONENT = ['getX', 'getY', 'getZ', 'getW'] as const;
export function floatGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geometry = source.clone();
  for (const name of Object.keys(geometry.attributes)) {
    const attr = geometry.getAttribute(name);
    const plain = attr instanceof THREE.BufferAttribute;
    if (plain && !attr.normalized && attr.array instanceof Float32Array) continue;
    const size = attr.itemSize;
    const out = new Float32Array(attr.count * size);
    for (let i = 0; i < attr.count; i++) {
      for (let k = 0; k < size; k++) {
        out[i * size + k] = k < COMPONENT.length ? attr[COMPONENT[k]](i) : attr.getComponent(i, k);
      }
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(out, size));
  }
  return geometry;
}

/** Every mesh under `node`, its geometry baked into the FILE's frame: every
 *  piece is authored at the origin, and the node's own transform is the
 *  quantization the optimizer (meshopt) stored, which must be applied, not
 *  dropped. A single-primitive node IS its mesh in three, so the bake reads the
 *  mesh's world matrix (the file root is identity), never node-relative. */
function partsOf(node: THREE.Object3D): SeasonalPart[] {
  let root: THREE.Object3D = node;
  while (root.parent) root = root.parent;
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const parts: SeasonalPart[] = [];
  node.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = floatGeometry(mesh.geometry);
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld));
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    parts.push({ geometry, material: prepareMaterial(materials[0]) });
  });
  return parts;
}

/** The event's assets once loaded, or null; the first ask starts the fetch. */
export function gourdlightAssets(): GourdlightAssets | null {
  if (state === 'ready' && builtTier !== GFX.standardMaterials) {
    // a tier change since the build: the loader's cache re-serves the files
    for (const material of sharedMaterials.values()) material.dispose();
    sharedMaterials.clear();
    resetSeasonalGlowMaterials();
    assets = null;
    state = 'idle';
  }
  if (state === 'ready') return assets;
  if (state === 'idle') {
    state = 'loading';
    Promise.all([loadGltf(GOURDLIGHT_DECOR_URL), loadGltf(GOURDLIGHT_HEAD_URL)])
      .then(([decorGltf, headGltf]) => {
        const decor = {} as Record<GourdlightDecorNode, readonly SeasonalPart[]>;
        for (const name of GOURDLIGHT_DECOR_NODES) {
          const node = decorGltf.scene.getObjectByName(name);
          decor[name] = node ? partsOf(node) : [];
        }
        const headNode = headGltf.scene.getObjectByName('pumpkin_head') ?? headGltf.scene;
        assets = { decor, head: partsOf(headNode) };
        builtTier = GFX.standardMaterials;
        state = 'ready';
      })
      .catch((err) => {
        state = 'failed';
        console.warn('Gourdlight Eve assets failed to load', err);
      });
  }
  return null;
}
