// The Wildheart Basin open-field builder. Generated jungle-kit GLBs and their
// procedural fallbacks consume the same sim-side placement table as collision.

import * as THREE from 'three';
import {
  WILDHEART_FIELD_COLLIDER_SPECS,
  WILDHEART_FIELD_PLACEMENTS,
  type WildheartPropKind,
  wildheartFieldHeight,
} from '../sim/wildheart_field';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { surfaceMat } from './gfx';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';
import { radialGlowTexture } from './textures';
import { buildWildheartTerrain } from './wildheart_terrain';

const FIRE_FLAME = 0xffc45f;
const FIRE_EMISSIVE = 0xc85b20;
const FIRE_LIGHT = 0xffa640;

const WILDHEART_ASSET_URL: Record<WildheartPropKind, string> = {
  wildheart_limestone_cliff: '/models/props/wildheart_limestone_cliff.glb',
  wildheart_jaguar_gate: '/models/props/wildheart_jaguar_gate.glb',
  wildheart_ritual_pyramid: '/models/props/wildheart_ritual_pyramid.glb',
  wildheart_canopy_platform: '/models/props/wildheart_canopy_platform.glb',
  wildheart_rope_bridge: '/models/props/wildheart_rope_bridge.glb',
  wildheart_beast_den: '/models/props/wildheart_beast_den.glb',
  wildheart_mask_totem: '/models/props/wildheart_mask_totem.glb',
  wildheart_jungle_canopy_tree: '/models/props/wildheart_jungle_canopy_tree.glb',
  wildheart_giant_fern: '/models/props/wildheart_giant_fern.glb',
  wildheart_ancestor_ruin: '/models/props/wildheart_ancestor_ruin.glb',
};

const WILDHEART_TARGET_HEIGHT: Record<WildheartPropKind, number> = {
  wildheart_limestone_cliff: 14,
  wildheart_jaguar_gate: 13,
  wildheart_ritual_pyramid: 19,
  wildheart_canopy_platform: 11,
  wildheart_rope_bridge: 3.2,
  wildheart_beast_den: 7,
  wildheart_mask_totem: 7,
  wildheart_jungle_canopy_tree: 12,
  wildheart_giant_fern: 3.5,
  wildheart_ancestor_ruin: 7,
};

const WILDHEART_ASSET_YAW: Partial<Record<WildheartPropKind, number>> = {
  // The generated maw's face is authored on +X. Rotate it to the field-kit
  // convention where a zero-yaw placement faces +Z.
  wildheart_jaguar_gate: -Math.PI / 2,
};

type WildheartGltf = Awaited<ReturnType<typeof loadGltf>>;
const loadedWildheartGltf = new Map<WildheartPropKind, WildheartGltf | null>();

if (typeof window !== 'undefined') {
  for (const [kind, url] of Object.entries(WILDHEART_ASSET_URL) as [WildheartPropKind, string][]) {
    registerDeferredPreload(() =>
      loadGltf(url)
        .then((gltf: WildheartGltf) => {
          gltf.scene.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            markSharedGeometry(child.geometry);
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            for (const material of materials) markSharedMaterial(material);
          });
          loadedWildheartGltf.set(kind, gltf);
        })
        .catch(() => loadedWildheartGltf.set(kind, null)),
    );
  }
}

export const wildheartPropsPreloadInternalsForTest = {
  assetUrl: WILDHEART_ASSET_URL,
  targetHeight: WILDHEART_TARGET_HEIGHT,
  placements: WILDHEART_FIELD_PLACEMENTS,
  colliderSpecs: WILDHEART_FIELD_COLLIDER_SPECS,
};

interface FallbackSpec {
  w: number;
  h: number;
  d: number;
  color: number;
}

const FALLBACK: Record<WildheartPropKind, FallbackSpec> = {
  wildheart_limestone_cliff: { w: 11, h: 14, d: 8, color: 0xb9aa76 },
  wildheart_jaguar_gate: { w: 25, h: 12, d: 6, color: 0xbfac78 },
  wildheart_ritual_pyramid: { w: 28, h: 18, d: 22, color: 0xa89560 },
  wildheart_canopy_platform: { w: 6, h: 10, d: 6, color: 0x55422b },
  wildheart_rope_bridge: { w: 15, h: 2.8, d: 3.5, color: 0x665036 },
  wildheart_beast_den: { w: 8, h: 6.2, d: 7, color: 0x70573a },
  wildheart_mask_totem: { w: 2, h: 6.4, d: 1.5, color: 0x80673e },
  wildheart_jungle_canopy_tree: { w: 11, h: 12, d: 9, color: 0x42653a },
  wildheart_giant_fern: { w: 4.2, h: 3.5, d: 4.2, color: 0x3b7541 },
  wildheart_ancestor_ruin: { w: 7, h: 7, d: 4.5, color: 0xb9aa76 },
};

function shadow(mesh: THREE.Mesh): THREE.Mesh {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildFallback(kind: WildheartPropKind): THREE.Group {
  const spec = FALLBACK[kind];
  const group = new THREE.Group();
  const stone = surfaceMat({ color: spec.color, roughness: 0.96 });
  const wood = surfaceMat({ color: 0x503a25, roughness: 0.94 });
  const bone = surfaceMat({ color: 0xd7c895, roughness: 0.9 });
  const cloth = surfaceMat({ color: 0xb84e35, roughness: 0.92 });

  if (kind === 'wildheart_jaguar_gate') {
    for (const x of [-10.5, 10.5]) {
      const pylon = shadow(new THREE.Mesh(new THREE.BoxGeometry(5, 10, 6), stone));
      pylon.position.set(x, 5, 0);
      group.add(pylon);
      const fang = shadow(new THREE.Mesh(new THREE.ConeGeometry(0.7, 3.5, 6), bone));
      fang.position.set(x > 0 ? 6.8 : -6.8, 7.2, 0.8);
      fang.rotation.z = x > 0 ? -0.35 : 0.35;
      group.add(fang);
    }
    const lintel = shadow(new THREE.Mesh(new THREE.BoxGeometry(17, 1.4, 4), stone));
    lintel.position.y = 10.5;
    group.add(lintel);
  } else if (kind === 'wildheart_ritual_pyramid') {
    for (let i = 0; i < 4; i++) {
      const width = spec.w - i * 4.6;
      const tier = shadow(
        new THREE.Mesh(new THREE.BoxGeometry(width, 2.5, spec.d - i * 3.6), stone),
      );
      tier.position.set(0, 1.25 + i * 2.45, 1.5 + i * 1.5);
      group.add(tier);
    }
    const shrine = shadow(new THREE.Mesh(new THREE.BoxGeometry(10, 7, 7), stone));
    shrine.position.set(0, 13, 4.5);
    group.add(shrine);
    for (let i = -3; i <= 3; i++) {
      const step = shadow(new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.65, 1.25), stone));
      step.position.set(0, 0.32 + (i + 3) * 1.25, -9.4 + (i + 3) * 1.6);
      group.add(step);
    }
  } else if (kind === 'wildheart_canopy_platform') {
    for (const x of [-2, 2]) {
      for (const z of [-2, 2]) {
        const post = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.38, 8, 7), wood));
        post.position.set(x, 4, z);
        group.add(post);
      }
    }
    const deck = shadow(new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.5, 0.7, 8), wood));
    deck.position.y = 7.5;
    group.add(deck);
    const canopy = shadow(new THREE.Mesh(new THREE.ConeGeometry(3.8, 2.2, 7), cloth));
    canopy.position.y = 9.4;
    group.add(canopy);
  } else if (kind === 'wildheart_rope_bridge') {
    for (let i = -6; i <= 6; i++) {
      const plank = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.18, 3.2), wood));
      plank.position.set(i * 1.08, 0.55 - (1 - Math.abs(i) / 6) * 0.45, 0);
      plank.rotation.z = Math.sin(i * 1.7) * 0.025;
      group.add(plank);
    }
    for (const x of [-7, 7]) {
      for (const z of [-1.8, 1.8]) {
        const post = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 2.6, 6), wood));
        post.position.set(x, 1.3, z);
        group.add(post);
      }
    }
  } else if (kind === 'wildheart_beast_den') {
    const hut = shadow(new THREE.Mesh(new THREE.CylinderGeometry(3.8, 4.3, 3.7, 8), wood));
    hut.position.y = 1.85;
    group.add(hut);
    const roof = shadow(new THREE.Mesh(new THREE.ConeGeometry(4.8, 3.1, 8), cloth));
    roof.position.y = 5;
    group.add(roof);
    const mouth = new THREE.Mesh(
      new THREE.CircleGeometry(1.25, 10),
      surfaceMat({ color: 0x1b1612 }),
    );
    mouth.position.set(0, 1.65, 3.82);
    group.add(mouth);
  } else if (kind === 'wildheart_mask_totem') {
    const pole = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.42, 5.6, 7), wood));
    pole.position.y = 2.8;
    group.add(pole);
    const mask = shadow(new THREE.Mesh(new THREE.DodecahedronGeometry(1.05, 0), bone));
    mask.scale.set(0.75, 1.2, 0.45);
    mask.position.set(0, 5.1, 0.2);
    group.add(mask);
  } else if (kind === 'wildheart_jungle_canopy_tree') {
    const trunk = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.75, 1.2, 7, 8), wood));
    trunk.position.y = 3.5;
    group.add(trunk);
    for (const [x, y, z, scale] of [
      [0, 8.5, 0, 2.7],
      [-2.2, 8.1, 0.8, 2.1],
      [2, 8.4, -0.7, 2.25],
      [0.4, 10.2, 0.2, 2.15],
    ] as const) {
      const crown = shadow(
        new THREE.Mesh(
          new THREE.DodecahedronGeometry(scale, 0),
          surfaceMat({ color: y > 9 ? 0x4f813f : 0x376635, roughness: 0.95 }),
        ),
      );
      crown.scale.y = 0.72;
      crown.position.set(x, y, z);
      group.add(crown);
    }
  } else if (kind === 'wildheart_giant_fern') {
    for (let i = 0; i < 9; i++) {
      const angle = (i / 9) * Math.PI * 2;
      const leaf = shadow(
        new THREE.Mesh(
          new THREE.ConeGeometry(0.62, 2.8, 6),
          surfaceMat({ color: i % 2 ? 0x4d8a49 : 0x356f3e, roughness: 0.96 }),
        ),
      );
      leaf.position.set(Math.sin(angle) * 0.75, 1.25, Math.cos(angle) * 0.75);
      leaf.rotation.z = 0.55;
      leaf.rotation.y = angle;
      group.add(leaf);
    }
  } else if (kind === 'wildheart_ancestor_ruin') {
    for (const [x, height, rot] of [
      [-2.1, 5.8, -0.16],
      [1.7, 6.6, 0.12],
      [0, 3.8, 0],
    ] as const) {
      const slab = shadow(new THREE.Mesh(new THREE.BoxGeometry(2.2, height, 1.5), stone));
      slab.position.set(x, height / 2, 0);
      slab.rotation.z = rot;
      group.add(slab);
    }
  } else {
    const body = shadow(new THREE.Mesh(new THREE.BoxGeometry(spec.w, spec.h, spec.d), stone));
    body.position.y = spec.h / 2;
    group.add(body);
  }
  return group;
}

function cloneLoaded(loaded: WildheartGltf, targetHeight: number, yaw = 0): THREE.Object3D {
  const instance = loaded.scene.clone(true);
  instance.rotation.y = yaw;
  const bounds = new THREE.Box3().setFromObject(instance);
  const rawHeight = bounds.max.y - bounds.min.y;
  instance.scale.setScalar(rawHeight > 1e-4 ? targetHeight / rawHeight : 1);
  const scaled = new THREE.Box3().setFromObject(instance);
  instance.position.y -= scaled.min.y;
  instance.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return instance;
}

function buildProp(kind: WildheartPropKind): THREE.Object3D {
  const loaded = loadedWildheartGltf.get(kind);
  return loaded
    ? cloneLoaded(loaded, WILDHEART_TARGET_HEIGHT[kind], WILDHEART_ASSET_YAW[kind])
    : buildFallback(kind);
}

export interface WildheartFieldInteriorDeps {
  lowGfx: boolean;
  flames: THREE.Mesh[];
  fireLights: THREE.PointLight[];
}

let flameGeometry: THREE.BufferGeometry | null = null;
let flameMaterial: THREE.MeshLambertMaterial | null = null;
let glowGeometry: THREE.BufferGeometry | null = null;
let glowMaterial: THREE.MeshBasicMaterial | null = null;

function addFire(
  group: THREE.Group,
  deps: WildheartFieldInteriorDeps,
  x: number,
  y: number,
  z: number,
  glowScale = 1,
): void {
  flameGeometry ??= new THREE.ConeGeometry(0.24, 0.7, 7);
  markSharedGeometry(flameGeometry);
  flameMaterial ??= new THREE.MeshLambertMaterial({
    color: FIRE_FLAME,
    emissive: FIRE_EMISSIVE,
    emissiveIntensity: deps.lowGfx ? 1.5 : 2.2,
    transparent: true,
    opacity: 0.94,
  });
  markSharedMaterial(flameMaterial);
  const flame = new THREE.Mesh(flameGeometry, flameMaterial);
  flame.position.set(x, y, z);
  group.add(flame);
  deps.flames.push(flame);

  const light = new THREE.PointLight(FIRE_LIGHT, deps.lowGfx ? 7 : 10, deps.lowGfx ? 16 : 25, 2);
  if (!deps.lowGfx) light.userData.baseIntensity = 23;
  light.position.set(x, y + 1.2, z);
  group.add(light);
  deps.fireLights.push(light);

  if (deps.lowGfx) return;
  glowGeometry ??= new THREE.CircleGeometry(6, 20).rotateX(-Math.PI / 2);
  markSharedGeometry(glowGeometry);
  glowMaterial ??= new THREE.MeshBasicMaterial({
    map: radialGlowTexture(),
    color: FIRE_LIGHT,
    transparent: true,
    opacity: 0.28,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  markSharedMaterial(glowMaterial);
  const glow = new THREE.Mesh(glowGeometry, glowMaterial);
  glow.position.set(x, wildheartFieldHeight(x, z) + 0.08, z);
  glow.scale.setScalar(glowScale);
  glow.renderOrder = 3;
  group.add(glow);
}

export function buildWildheartFieldInterior(deps: WildheartFieldInteriorDeps): THREE.Group {
  const group = new THREE.Group();
  group.name = 'wildheartField';
  group.add(buildWildheartTerrain(deps.lowGfx));

  const fillHemi = new THREE.HemisphereLight(0xdff4da, 0x6d5131, deps.lowGfx ? 1.7 : 0.9);
  const fillSun = new THREE.DirectionalLight(0xffe0a6, deps.lowGfx ? 1.4 : 0.88);
  fillSun.position.set(-45, 72, -35);
  fillSun.target.position.set(0, 2, 135);
  group.add(fillHemi, fillSun, fillSun.target);

  for (const placement of WILDHEART_FIELD_PLACEMENTS) {
    const holder = new THREE.Group();
    holder.add(buildProp(placement.kind));
    holder.position.set(
      placement.x,
      wildheartFieldHeight(placement.x, placement.z) - 0.05,
      placement.z,
    );
    holder.rotation.y = placement.rot;
    holder.scale.setScalar(placement.scale ?? 1);
    group.add(holder);
  }

  // Warm ritual fire is concentrated at thresholds and the high shrine so the
  // route remains legible without flattening the sunlit jungle palette.
  for (const [x, z, lift, scale] of [
    [-10, 15, 3.2, 0.75],
    [10, 15, 3.2, 0.75],
    [-18, 205, 2.1, 0.9],
    [18, 205, 2.1, 0.9],
    [-9, 227, 4.2, 1.1],
    [9, 227, 4.2, 1.1],
  ] as const) {
    addFire(group, deps, x, wildheartFieldHeight(x, z) + lift, z, scale);
  }
  return group;
}
