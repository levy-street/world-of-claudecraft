// The Wraithwood's dressing, render-only: the giant overgrown trees the
// realm is named for (the Eldergleam's twisted-elder model, cloned dark at
// the same WRAITHWOOD_PROPS.greatTrees spots that give the sim its solid
// trunk colliders), a low ground mist that never lifts, and ghost-lights
// drifting between the trunks. Same contract as the sibling
// realm modules: build once, update(time) animates gently, glowLights join
// the renderer's rank-culled fireLights budget.
import * as THREE from 'three';
import { WRAITHWOOD_PROPS } from '../sim/content/wraithwood';
import { hash2 } from '../sim/rng';
import { terrainHeight, WATER_LEVEL } from '../sim/world';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';

export interface HauntFeaturesView {
  group: THREE.Group;
  glowLights: THREE.PointLight[];
  update(time: number): void;
}

const WOOD_ZMIN = 1260;
const WOOD_ZMAX = 1820;

// The giant trees are the Eldergleam's twisted-elder model (realm_flora
// already preloads the same URL, so the loader cache makes this free),
// cloned per greatTrees record and darkened into haunted silhouettes.
const GREAT_TREE_URL = '/models/foliage/twisted_1.glb';
let greatTreeScene: THREE.Group | null = null;
registerDeferredPreload(() =>
  loadGltf(GREAT_TREE_URL).then((gltf) => {
    greatTreeScene = gltf.scene;
  }),
);

// Ground-mist banks: wide soft sheets pooled in the realm's low spots.
const MISTS = [
  { x: 360, z: 1390, r: 46, phase: 0 },
  { x: 290, z: 1500, r: 40, phase: 1.6 }, // Widow's Thicket pools
  { x: 436, z: 1522, r: 42, phase: 3.1 }, // the Hanging Glade
  { x: 304, z: 1626, r: 38, phase: 4.5 }, // the chapel tarn
  { x: 376, z: 1680, r: 44, phase: 2.2 }, // the Huntsman's clearing
  { x: 340, z: 1560, r: 40, phase: 5.3 },
] as const;

// Ghost-lights: pale will-o-wisps that circle slowly between the trunks.
const WISP_HOMES = [
  { x: 298, z: 1608, r: 9, phase: 0.4 }, // the chapel graves
  { x: 384, z: 1674, r: 10, phase: 2.1 }, // the Huntsman's ring
  { x: 280, z: 1492, r: 8, phase: 3.8 },
  { x: 420, z: 1548, r: 9, phase: 5.0 },
  { x: 384, z: 1418, r: 7, phase: 1.2 }, // Gallowmere's own graveyard
] as const;

function mistTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.5)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.22)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

function glowTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

export function buildHauntFeatures(seed: number): HauntFeaturesView {
  const group = new THREE.Group();
  group.name = 'haunt-features';
  const glowLights: THREE.PointLight[] = [];

  // --- the giant trees: the Eldergleam's twisted elder, grown grim ---
  // One clone per greatTrees record (the same spots the sim's trunk
  // colliders use), scaled from the record's radius the way the Hollow's
  // centerpiece is (r 2.6 = scale 6.5), turned and sized with a little
  // hash jitter, and darkened toward dead grey-green. Materials are cloned
  // once per source material (the loader cache is immutable) and shared
  // across every tree here.
  {
    const darkened = new Map<string, THREE.Material>();
    const darken = (source: THREE.Material): THREE.Material => {
      let m = darkened.get(source.uuid);
      if (!m) {
        m = source.clone();
        const c = (m as THREE.MeshStandardMaterial).color;
        if (c) c.multiply(new THREE.Color(0.42, 0.48, 0.42));
        darkened.set(source.uuid, m);
      }
      return m;
    };
    if (greatTreeScene) {
      for (const t of WRAITHWOOD_PROPS.greatTrees ?? []) {
        const y = terrainHeight(t.x, t.z, seed);
        if (y < WATER_LEVEL) continue;
        const tree = greatTreeScene.clone(true);
        tree.position.set(t.x, y - 0.2, t.z);
        tree.scale.setScalar(t.r * (2.4 + hash2(t.x, t.z, seed + 4101) * 0.5));
        tree.rotation.y = hash2(t.z, t.x, seed + 4111) * Math.PI * 2;
        tree.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.material = Array.isArray(mesh.material)
              ? mesh.material.map(darken)
              : darken(mesh.material);
          }
        });
        group.add(tree);
      }
    }
  }

  // --- ground mist: soft sheets that breathe and slide ---
  const mists: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; phase: number }[] = [];
  const mistTex = mistTexture();
  if (mistTex) {
    for (const m of MISTS) {
      const material = new THREE.MeshBasicMaterial({
        map: mistTex,
        color: 0xaebbac,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        fog: false,
      });
      const y = Math.max(terrainHeight(m.x, m.z, seed), WATER_LEVEL) + 1.4;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(m.r * 2, m.r * 2), material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(m.x, y, m.z);
      mesh.renderOrder = 3;
      mists.push({ mesh, mat: material, phase: m.phase });
      group.add(mesh);
    }
  }

  // --- ghost-lights: drifting will-o-wisps with a dim halo each ---
  const wisps: {
    sprite: THREE.Sprite;
    light: THREE.PointLight;
    home: { x: number; z: number; r: number };
    phase: number;
    baseY: number;
  }[] = [];
  const glowTex = glowTexture();
  if (glowTex) {
    for (const w of WISP_HOMES) {
      if (w.z < WOOD_ZMIN + 8 || w.z > WOOD_ZMAX - 8) continue;
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTex,
          color: 0xbfe8c8,
          transparent: true,
          opacity: 0.75,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
        }),
      );
      sprite.scale.setScalar(1.6);
      const baseY = Math.max(terrainHeight(w.x, w.z, seed), WATER_LEVEL) + 2.2;
      sprite.position.set(w.x, baseY, w.z);
      const light = new THREE.PointLight(0x9fe0b0, 1.1, 20, 2);
      light.position.copy(sprite.position);
      group.add(sprite);
      group.add(light);
      glowLights.push(light);
      wisps.push({ sprite, light, home: w, phase: w.phase, baseY });
    }
  }

  return {
    group,
    glowLights,
    update(time: number): void {
      // the mist breathes and slowly slides; the ghost-lights wander their
      // little circuits like someone pacing a grave row
      for (const m of mists) {
        m.mat.opacity = 0.13 + 0.05 * Math.sin(time * 0.17 + m.phase);
        m.mesh.rotation.z = time * 0.008 + m.phase;
      }
      for (const w of wisps) {
        const a = time * 0.16 + w.phase;
        w.sprite.position.set(
          w.home.x + Math.sin(a) * w.home.r,
          w.baseY + Math.sin(time * 0.5 + w.phase * 2) * 0.7,
          w.home.z + Math.cos(a * 0.8) * w.home.r,
        );
        w.light.position.copy(w.sprite.position);
        const flicker = 0.9 + 0.25 * Math.sin(time * 2.3 + w.phase * 3);
        w.light.intensity = 1.1 * flicker;
        (w.sprite.material as THREE.SpriteMaterial).opacity = 0.55 + 0.25 * flicker;
      }
    },
  };
}
