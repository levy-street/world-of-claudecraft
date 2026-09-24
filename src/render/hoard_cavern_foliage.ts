import * as THREE from 'three';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { hoardCavernHeroSpots } from './hoard_cavern_foliage_core';
import type { HoardValleyPlan } from './hoard_valley_core';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';

const URLS = {
  autumn_tree: '/models/foliage/oak_1_field.glb',
  basalt_spire: '/models/foliage/dead_1.glb',
  ice_spire: '/models/foliage/pine_1_field.glb',
  windswept_grass: '/models/foliage/oak_1_field.glb',
  moon_bloom: '/models/foliage/oak_1_field.glb',
  palm: '/models/biome/beach_palm_1.glb',
  reeds: '/models/props/willow_tree.glb',
  dead_tree: '/models/foliage/dead_1.glb',
} as const;

interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshBasicMaterial | THREE.MeshBasicMaterial[];
}
interface Model {
  parts: Part[];
  radius: number;
}
const models = new Map<string, Model>();
const materialColors = new Map<THREE.MeshBasicMaterial, THREE.Color>();
const currentTint = new THREE.Color(1, 1, 1);

/** Follow the valley's readable day/night grade without changing cached GLB materials. */
export function updateHoardCavernFoliageTint(tint: readonly [number, number, number]): void {
  currentTint.setRGB(tint[0], tint[1], tint[2]);
  for (const [material, color] of materialColors) material.color.copy(color).multiply(currentTint);
}

/** Bake immutable loader geometry into shared, foot-seated, eight-yard trees. */
function bake(scene: THREE.Group): Model {
  const source = scene.clone(true);
  source.updateMatrixWorld(true);
  const parts: Part[] = [];
  const bounds = new THREE.Box3();
  const materials = new Map<THREE.Material, THREE.MeshBasicMaterial>();
  source.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const geometry = new THREE.BufferGeometry();
    // Quantized GLBs need decoded float streams before matrix application.
    for (const name of ['position', 'normal', 'uv', 'color']) {
      const attr = node.geometry.getAttribute(name);
      if (!attr) continue;
      const values = new Float32Array(attr.count * attr.itemSize);
      for (let i = 0; i < attr.count; i++)
        for (let j = 0; j < attr.itemSize; j++)
          values[i * attr.itemSize + j] = attr.getComponent(i, j);
      geometry.setAttribute(name, new THREE.BufferAttribute(values, attr.itemSize));
    }
    if (node.geometry.index) geometry.setIndex(node.geometry.index.clone());
    geometry.groups = node.geometry.groups.map(
      (group: { start: number; count: number; materialIndex?: number }) => ({ ...group }),
    );
    geometry.applyMatrix4(node.matrixWorld);
    geometry.computeBoundingBox();
    if (geometry.boundingBox) bounds.union(geometry.boundingBox);
    const convertMaterial = (original: THREE.MeshStandardMaterial): THREE.MeshBasicMaterial => {
      let material = materials.get(original);
      if (!material) {
        material = markSharedMaterial(
          new THREE.MeshBasicMaterial({
            color: original.color,
            map: original.map,
            vertexColors: geometry.hasAttribute('color'),
            side: original.side,
            alphaTest: Math.max(original.alphaTest, /leav/i.test(original.name) ? 0.4 : 0),
            fog: true,
          }),
        );
        material.name = original.name;
        if (/leav/i.test(original.name)) {
          // Green albedo multiplied by orange becomes olive. Preserve the painted
          // texture's value before the autumn instance tint supplies its new hue.
          material.onBeforeCompile = (shader) => {
            shader.fragmentShader = shader.fragmentShader.replace(
              '#include <map_fragment>',
              `#include <map_fragment>
              #ifdef USE_COLOR
                if (vColor.r > vColor.g * 1.4) {
                  diffuseColor.rgb = vec3(max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)));
                }
              #endif`,
            );
          };
          material.customProgramCacheKey = () => 'hoard-cavern-seasonal-leaves-v1';
        }
        materialColors.set(material, material.color.clone());
        material.color.multiply(currentTint);
        materials.set(original, material);
      }
      return material;
    };
    const material = Array.isArray(node.material)
      ? node.material.map((item) => convertMaterial(item as THREE.MeshStandardMaterial))
      : convertMaterial(node.material as THREE.MeshStandardMaterial);
    parts.push({ geometry: markSharedGeometry(geometry), material });
  });
  if (bounds.isEmpty()) return { parts, radius: 0 };
  const scale = 8 / Math.max(0.01, bounds.max.y - bounds.min.y);
  for (const part of parts) {
    part.geometry.translate(
      -(bounds.min.x + bounds.max.x) / 2,
      -bounds.min.y,
      -(bounds.min.z + bounds.max.z) / 2,
    );
    part.geometry.scale(scale, scale, scale);
    part.geometry.computeBoundingBox();
    part.geometry.computeBoundingSphere();
  }
  return {
    parts,
    radius: (Math.hypot(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) * scale) / 2,
  };
}

if (typeof window !== 'undefined') {
  for (const url of new Set(Object.values(URLS))) {
    registerDeferredPreload(() =>
      loadGltf(url).then((gltf) => {
        if (!models.has(url)) models.set(url, bake(gltf.scene));
      }),
    );
  }
}

/** Parent owns scene attachment and compile gating; only instance buffers are per visit. */
export function buildHoardCavernFoliage(plan: HoardValleyPlan, shadows: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'HoardCavernHeroTrees';
  const model = models.get(URLS[plan.zone.dressing]);
  if (!model) return group;
  const spots = hoardCavernHeroSpots(plan, model.radius);
  if (!spots.length) return group;
  const transform = new THREE.Object3D();
  for (const part of model.parts) {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, spots.length);
    mesh.name = 'HoardCavernTree';
    spots.forEach((spot, i) => {
      transform.position.set(spot.x, spot.y - 0.05, spot.z);
      transform.rotation.set(0, spot.yaw, 0);
      transform.scale.setScalar(0.8 + Math.min(spot.scale, 1.5) * 0.15);
      transform.updateMatrix();
      mesh.setMatrixAt(i, transform.matrix);
      mesh.setColorAt(
        i,
        new THREE.Color(
          plan.zone.dressing === 'autumn_tree' &&
            (Array.isArray(part.material)
              ? part.material.every((material) => /leav/i.test(material.name))
              : /leav/i.test(part.material.name))
            ? 0xeeb471
            : 0xffffff,
        ),
      );
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = shadows;
    mesh.receiveShadow = false;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}

export const hoardCavernFoliagePreloadInternalsForTest = {
  urls: [...new Set(Object.values(URLS))],
  seedScene(url: string, scene: THREE.Group): void {
    models.set(url, bake(scene));
  },
  clear(): void {
    models.clear();
    materialColors.clear();
    currentTint.setRGB(1, 1, 1);
  },
};
