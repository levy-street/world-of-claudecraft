import * as THREE from 'three';
import { STREETLAMP_FIXTURE_HEIGHT, type StreetlampStyleId } from '../sim/streetlamp_style';
import { loadGltf, releaseGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { attachBiomeHaze } from './biome_haze_field';
import { GFX } from './gfx';
import {
  captureStreetlampEmissive,
  type StreetlampEmissiveState,
  streetlampEmissiveRole,
} from './streetlamp_emissive';
import { attachStreetlampFlame } from './streetlamp_flame';

export interface StreetlampAssetDef {
  url: string;
  targetHeight: number;
  /** Fallback anchor for the procedural fixture only; a real GLB carries its
   *  own authored LIGHT_SOCKET, which always wins. */
  lightOffset: readonly [number, number, number];
  lightColor: number;
  fieldColor: readonly [number, number, number];
}

export interface StreetlampAssetPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
}

export interface StreetlampAsset {
  parts: readonly StreetlampAssetPart[];
  glowStates: readonly StreetlampEmissiveState[];
  /** Authored LIGHT_SOCKET, in the same normalized space as `parts`. */
  socket: readonly [number, number, number];
  /**
   * The fixture's horizontal LIGHT AXIS: from the centre of its own footprint
   * to its socket, in the normalized space `parts` live in. This is what says
   * "the light hangs off THIS edge", so `lampFixtureYaw` can turn that edge out
   * over the road and leave the post standing on the verge. Near zero for a
   * lantern carried straight above its post, which has no lit side.
   */
  lightAxis: readonly [number, number];
  width: number;
  height: number;
  depth: number;
}

/** The authored anchor node every lamp GLB carries at the centre of its source. */
export const LIGHT_SOCKET_NODE = 'LIGHT_SOCKET';
const LIGHT_SOCKET_FLAG = 'woc_light_socket';

/** Converted materials keep the authored name behind this tag, so the GLB's
 *  role contract survives the conversion and stays readable in a debugger. */
const MATERIAL_PREFIX = 'streetlamp:';

function authoredName(material: THREE.Material): string {
  const name = material.name ?? '';
  return name.startsWith(MATERIAL_PREFIX) ? name.slice(MATERIAL_PREFIX.length) : name;
}

// Read from the sim, not re-declared: colliders.ts derives a post's visual top
// (the sight-blocking height) from the same number, and a fixture scaled to a
// height its collider does not know about is a lamp you can cast through.
const TARGET_HEIGHT = STREETLAMP_FIXTURE_HEIGHT;
const MAX_FOOTPRINT = 2.0;
/** The bottom slice of a fixture that counts as its footing, as a fraction of
 *  its height. Deep enough to catch a plinth or a splayed set of legs, shallow
 *  enough that an arm or a hanging head never drags the foot toward itself. */
const FOOT_BAND = 0.12;

// Meshopt-quantized GLBs arrive as normalized integer attributes. Three's
// geometry transforms write through BufferAttribute.setXYZ(), which clamps
// those writes back into the integer's normalized range and can collapse a
// five-yard lamp down to its base. Expand transform-bearing attributes before
// applying either the source world matrix or our runtime normalization.
function attributeToFloat(geometry: THREE.BufferGeometry, name: string): void {
  const attribute = geometry.getAttribute(name);
  if (!attribute || (attribute.array instanceof Float32Array && !attribute.normalized)) return;
  const values = new Float32Array(attribute.count * attribute.itemSize);
  for (let index = 0; index < attribute.count; index++) {
    for (let component = 0; component < attribute.itemSize; component++) {
      values[index * attribute.itemSize + component] = attribute.getComponent(index, component);
    }
  }
  geometry.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize));
}

export const STREETLAMP_ASSET_DEFS: Readonly<Record<StreetlampStyleId, StreetlampAssetDef>> = {
  eastbrook_civic: {
    url: '/models/props/streetlamp_eastbrook_civic.glb',
    targetHeight: TARGET_HEIGHT,
    lightOffset: [0, 4.55, 0],
    lightColor: 0xff651b,
    fieldColor: [1, 0.4, 0.11],
  },
  mirefen_witchflame: {
    url: '/models/props/streetlamp_mirefen_witchflame.glb',
    targetHeight: TARGET_HEIGHT,
    lightOffset: [-0.48, 4.45, 0],
    lightColor: 0xee6f23,
    fieldColor: [0.93, 0.44, 0.14],
  },
  thornpeak_beacon: {
    url: '/models/props/streetlamp_thornpeak_beacon.glb',
    targetHeight: TARGET_HEIGHT,
    lightOffset: [0, 4.55, 0],
    lightColor: 0xfa6d31,
    fieldColor: [0.98, 0.43, 0.19],
  },
  veiled_crystal: {
    url: '/models/props/streetlamp_veiled_crystal.glb',
    targetHeight: TARGET_HEIGHT,
    lightOffset: [-0.52, 4.25, 0],
    lightColor: 0xf75e31,
    fieldColor: [0.97, 0.37, 0.19],
  },
  drakelands_brazier: {
    url: '/models/props/streetlamp_drakelands_brazier.glb',
    targetHeight: TARGET_HEIGHT,
    lightOffset: [0, 4.45, 0],
    lightColor: 0xff5e16,
    fieldColor: [1, 0.37, 0.09],
  },
  frostveil_icicle: {
    url: '/models/props/streetlamp_frostveil_icicle.glb',
    targetHeight: TARGET_HEIGHT,
    lightOffset: [0, 4.65, 0],
    lightColor: 0xef6b31,
    fieldColor: [0.94, 0.42, 0.19],
  },
  amberfall_crystal: {
    url: '/models/props/streetlamp_amberfall_crystal.glb',
    targetHeight: TARGET_HEIGHT,
    lightOffset: [-0.42, 4.5, 0],
    lightColor: 0xff681b,
    fieldColor: [1, 0.41, 0.11],
  },
  willowfen_reed: {
    url: '/models/props/streetlamp_willowfen_reed.glb',
    targetHeight: TARGET_HEIGHT,
    lightOffset: [-0.48, 4.45, 0],
    lightColor: 0xf16f29,
    fieldColor: [0.95, 0.44, 0.16],
  },
  nightbloom_moonflower: {
    url: '/models/props/streetlamp_nightbloom_moonflower.glb',
    targetHeight: TARGET_HEIGHT,
    lightOffset: [0, 4.55, 0],
    lightColor: 0xf36d31,
    fieldColor: [0.95, 0.43, 0.19],
  },
  wraithwood_ghost: {
    url: '/models/props/streetlamp_wraithwood_ghost.glb',
    targetHeight: TARGET_HEIGHT,
    lightOffset: [-0.45, 4.4, 0],
    lightColor: 0xf16f2d,
    fieldColor: [0.95, 0.44, 0.18],
  },
  palmreach_totem: {
    url: '/models/props/streetlamp_palmreach_totem.glb',
    targetHeight: TARGET_HEIGHT,
    lightOffset: [0, 4.35, 0],
    lightColor: 0xff6419,
    fieldColor: [1, 0.39, 0.1],
  },
  evergarden_flower: {
    url: '/models/props/streetlamp_evergarden_flower.glb',
    targetHeight: TARGET_HEIGHT,
    lightOffset: [0, 4.52, 0],
    lightColor: 0xff6b26,
    fieldColor: [1, 0.42, 0.15],
  },
  galecrest_mast: {
    url: '/models/props/streetlamp_galecrest_mast.glb',
    targetHeight: TARGET_HEIGHT,
    lightOffset: [-0.4, 4.55, 0],
    lightColor: 0xf66b31,
    fieldColor: [0.97, 0.42, 0.19],
  },
  farshore_coral: {
    url: '/models/props/streetlamp_farshore_coral.glb',
    targetHeight: TARGET_HEIGHT,
    lightOffset: [-0.42, 4.35, 0],
    lightColor: 0xee6e2d,
    fieldColor: [0.93, 0.43, 0.18],
  },
};

const loadedSources = new Map<StreetlampStyleId, THREE.Group>();
const preparedAssets = new Map<StreetlampStyleId, StreetlampAsset>();

if (typeof window !== 'undefined') {
  for (const [style, def] of Object.entries(STREETLAMP_ASSET_DEFS) as [
    StreetlampStyleId,
    StreetlampAssetDef,
  ][]) {
    registerDeferredPreload(() =>
      loadGltf(def.url).then((gltf) => {
        loadedSources.set(style, gltf.scene);
      }),
    );
  }
}

function convertedMaterial(
  source: THREE.Material,
  glowStates: StreetlampEmissiveState[],
): THREE.Material {
  const material = source as THREE.MeshStandardMaterial;
  const color = material.color?.clone() ?? new THREE.Color(0xffffff);
  // Every authored surface flag is carried across verbatim. The pane materials
  // ship alphaMode BLEND with an authored opacity and no depth write, and some
  // fixtures are authored double sided; re-deriving any of that here is what
  // used to make a lantern read as a solid block from one side.
  const common = {
    name: `${MATERIAL_PREFIX}${source.name}`,
    color,
    map: material.map ?? null,
    vertexColors: material.vertexColors === true,
    side: material.side,
    flatShading: material.flatShading === true,
    emissive: material.emissive?.clone() ?? new THREE.Color(0x000000),
    emissiveMap: material.emissiveMap ?? null,
    emissiveIntensity: material.emissiveIntensity ?? 1,
    transparent: material.transparent === true,
    opacity: material.opacity ?? 1,
    alphaTest: material.alphaTest ?? 0,
    alphaMap: material.alphaMap ?? null,
    depthWrite: material.depthWrite !== false,
    toneMapped: material.toneMapped !== false,
  };
  const converted = GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({
        ...common,
        normalMap: material.normalMap ?? null,
        roughnessMap: material.roughnessMap ?? null,
        metalnessMap: material.metalnessMap ?? null,
        aoMap: material.aoMap ?? null,
        roughness: material.roughness ?? 0.8,
        metalness: material.metalness ?? 0,
      })
    : new THREE.MeshLambertMaterial(common);
  // A blended pane must not write depth, or it occludes the emitter behind it
  // and the fixture reads unlit from the side the pane happens to draw first.
  // Draw order needs nothing further: the emitter is opaque and the pane is
  // transparent, so Three already draws the source before the glass over it.
  if (converted.transparent) converted.depthWrite = false;
  const glow = captureStreetlampEmissive(source.name, converted);
  if (glow) glowStates.push(glow);
  attachBiomeHaze(converted);
  return converted;
}

/**
 * The authored socket in the source model's own space. Falls back to null so a
 * caller can use the def's procedural anchor rather than guessing a centre.
 */
function authoredSocket(source: THREE.Object3D): THREE.Vector3 | null {
  let found: THREE.Object3D | null = null;
  source.traverse((object) => {
    if (found) return;
    // Name first (the export contract), then the authored extras flag, which
    // survives even if a later tool renames or suffixes the node.
    const extras = (object.userData ?? {}) as Record<string, unknown>;
    if (object.name === LIGHT_SOCKET_NODE || extras[LIGHT_SOCKET_FLAG] === true) found = object;
  });
  if (!found) return null;
  const node = found as THREE.Object3D;
  return node.getWorldPosition(new THREE.Vector3());
}

/**
 * The XZ centre of the fixture's footing, in the normalized space the parts
 * already live in. Measured from the BOUNDS of the bottom band rather than a
 * vertex average, so a finely tessellated boss on one side of the base cannot
 * drag the centre off the post the fixture actually stands on.
 */
function footprintCentre(
  parts: readonly StreetlampAssetPart[],
  bounds: THREE.Box3,
): [number, number] {
  const ceiling = bounds.min.y + (bounds.max.y - bounds.min.y) * FOOT_BAND;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const part of parts) {
    const position = part.geometry.getAttribute('position');
    if (!position) continue;
    for (let index = 0; index < position.count; index++) {
      if (position.getY(index) > ceiling) continue;
      const x = position.getX(index);
      const z = position.getZ(index);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  if (minX > maxX) return [0, 0];
  return [(minX + maxX) * 0.5, (minZ + maxZ) * 0.5];
}

export function prepareStreetlampAsset(
  style: StreetlampStyleId,
  source: THREE.Object3D,
): StreetlampAsset {
  const def = STREETLAMP_ASSET_DEFS[style];
  const instance = source.clone(true);
  instance.updateMatrixWorld(true);
  const sourceMaterials = new Map<THREE.Material, THREE.Material>();
  const parts: StreetlampAssetPart[] = [];
  const glowStates: StreetlampEmissiveState[] = [];
  const nativeBounds = new THREE.Box3();
  const nativeSocket = authoredSocket(instance);

  instance.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry.clone();
    attributeToFloat(geometry, 'position');
    attributeToFloat(geometry, 'normal');
    attributeToFloat(geometry, 'tangent');
    geometry.applyMatrix4(mesh.matrixWorld);
    geometry.computeBoundingBox();
    if (geometry.boundingBox) nativeBounds.union(geometry.boundingBox);
    const convert = (material: THREE.Material): THREE.Material => {
      const cached = sourceMaterials.get(material);
      if (cached) return cached;
      const next = convertedMaterial(material, glowStates);
      sourceMaterials.set(material, next);
      return next;
    };
    const material = Array.isArray(mesh.material)
      ? mesh.material.map(convert)
      : convert(mesh.material);
    parts.push({ geometry, material });
  });

  if (parts.length === 0 || nativeBounds.isEmpty()) {
    throw new Error(`streetlamp asset has no mesh geometry: ${style}`);
  }
  const nativeHeight = nativeBounds.max.y - nativeBounds.min.y;
  if (!Number.isFinite(nativeHeight) || nativeHeight <= 1e-4) {
    throw new Error(`streetlamp asset has invalid height: ${style}`);
  }
  const uniformScale = def.targetHeight / nativeHeight;
  const nativeWidth = nativeBounds.max.x - nativeBounds.min.x;
  const nativeDepth = nativeBounds.max.z - nativeBounds.min.z;
  const radialScale = Math.min(
    1,
    MAX_FOOTPRINT / Math.max(nativeWidth * uniformScale, nativeDepth * uniformScale, 1e-4),
  );
  const centerX = (nativeBounds.min.x + nativeBounds.max.x) * 0.5;
  const centerZ = (nativeBounds.min.z + nativeBounds.max.z) * 0.5;

  const finalBounds = new THREE.Box3();
  for (const part of parts) {
    part.geometry.scale(uniformScale * radialScale, uniformScale, uniformScale * radialScale);
    part.geometry.translate(
      -centerX * uniformScale * radialScale,
      -nativeBounds.min.y * uniformScale,
      -centerZ * uniformScale * radialScale,
    );
    part.geometry.computeBoundingBox();
    part.geometry.computeBoundingSphere();
    if (part.geometry.boundingBox) finalBounds.union(part.geometry.boundingBox);
    // A flame animates around its OWN extent, so it is measured after the
    // fixture has taken its final scale: the shader leans and breathes by a
    // fraction of the flame's height, which is only known here.
    const box = part.geometry.boundingBox;
    if (!box) continue;
    for (const material of Array.isArray(part.material) ? part.material : [part.material]) {
      if (streetlampEmissiveRole(authoredName(material)) !== 'flame') continue;
      attachStreetlampFlame(material, { baseY: box.min.y, height: box.max.y - box.min.y });
    }
  }

  // The socket rides the SAME transform the geometry just took, so the anchor
  // the artist placed at the centre of the flame stays at the centre of the
  // flame after the runtime scales the fixture to its five-and-a-half yards.
  const socket: [number, number, number] = nativeSocket
    ? [
        (nativeSocket.x - centerX) * uniformScale * radialScale,
        (nativeSocket.y - nativeBounds.min.y) * uniformScale,
        (nativeSocket.z - centerZ) * uniformScale * radialScale,
      ]
    : [def.lightOffset[0], def.lightOffset[1], def.lightOffset[2]];

  // Foot to socket: the direction the fixture reaches its light out in. The
  // renderer turns THIS onto the road, which is why a hanging lantern ends up
  // over the track with its post out on the verge without any per-style table.
  const [footX, footZ] = footprintCentre(parts, finalBounds);
  const lightAxis: [number, number] = [socket[0] - footX, socket[2] - footZ];

  return {
    parts,
    glowStates,
    socket,
    lightAxis,
    width: finalBounds.max.x - finalBounds.min.x,
    height: finalBounds.max.y - finalBounds.min.y,
    depth: finalBounds.max.z - finalBounds.min.z,
  };
}

export function streetlampAsset(style: StreetlampStyleId): StreetlampAsset | null {
  const cached = preparedAssets.get(style);
  if (cached) return cached;
  const source = loadedSources.get(style);
  if (!source) return null;
  const prepared = prepareStreetlampAsset(style, source);
  preparedAssets.set(style, prepared);
  loadedSources.delete(style);
  releaseGltf(STREETLAMP_ASSET_DEFS[style].url);
  return prepared;
}

export const streetlampPreloadInternalsForTest = {
  assetDefs: STREETLAMP_ASSET_DEFS,
  maxFootprint: MAX_FOOTPRINT,
  installSource(style: StreetlampStyleId, source: THREE.Group): void {
    loadedSources.set(style, source);
    preparedAssets.delete(style);
  },
  reset(): void {
    loadedSources.clear();
    preparedAssets.clear();
  },
};
