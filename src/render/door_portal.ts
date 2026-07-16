import * as THREE from 'three';
import { loadGltf } from './assets/loader';
import { registerPreload } from './assets/preload';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';

// GLB-backed arch body (Tripo-generated, see public/models/props), with a
// procedural fallback (arch + keystone + plinths below) for pre-load races /
// headless test hosts, mirroring the gather_nodes.ts pattern. The portal
// swirl disc stays procedural (an animated additive VFX, not part of the
// static stone body).
const DOOR_ARCH_ASSET_URL = '/models/props/dungeon_door_arch.glb';
let loadedDoorArchGltf: THREE.Group | null = null;

if (typeof window !== 'undefined') {
  registerPreload(
    loadGltf(DOOR_ARCH_ASSET_URL).then((gltf) => {
      const scene = gltf.scene;
      // The GLB opening faces its local X axis; the procedural arch it
      // replaces (and the portal swirl it frames) faces Z, so rotate the
      // authored geometry into place once, before any clone is taken.
      scene.rotation.y = Math.PI / 2;
      scene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          markSharedGeometry(child.geometry);
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          for (const mat of mats) markSharedMaterial(mat);
        }
      });
      loadedDoorArchGltf = scene;
    }),
  );
}

/** Test-only window into the preload asset set (mirrors gather_nodes.ts). */
export const doorPortalPreloadInternalsForTest = {
  doorArchAssetUrl: DOOR_ARCH_ASSET_URL,
};

// The dungeon door / exit-portal visual system, lifted out of renderer.ts so the
// orchestrator only calls buildDoorBody() (the same shape as buildProps /
// buildMailboxPillar / buildDelveInteractable). Geometry and materials are
// shared, process-lifetime resources tagged via shared_resource so the renderer's
// per-view disposal guard never frees them (see the note there).

// Additive boost applied to the portal shimmer on non-low tiers so it blooms on
// the composer.
const PORTAL_BOOST = 2;

let stoneMat: THREE.Material | null = null;
let archGeo: THREE.BufferGeometry | null = null;
let keystoneGeo: THREE.BufferGeometry | null = null;
let plinthGeo: THREE.BufferGeometry | null = null;
let portalGeo: THREE.BufferGeometry | null = null;
let nythraxisClickGeo: THREE.BufferGeometry | null = null;
let nythraxisClickMat: THREE.MeshBasicMaterial | null = null;
// Keyed by `${entering}:${lowGfx}`. In production lowGfx is fixed for the
// renderer's lifetime, so only two entries are ever created (identical to the
// previous per-entering caching that captured lowGfx at first build); keying it
// on both inputs just keeps the builder correct for any caller and unit-testable.
const portalMats = new Map<string, THREE.MeshBasicMaterial>();

function doorStoneMaterial(): THREE.Material {
  stoneMat ??= markSharedMaterial(new THREE.MeshLambertMaterial({ color: 0x6a6a72 }));
  return stoneMat;
}

function doorArchGeometry(): THREE.BufferGeometry {
  if (!archGeo) {
    const outer = new THREE.Shape();
    outer.moveTo(-2.1, 0);
    outer.lineTo(-2.1, 3.1);
    outer.quadraticCurveTo(-2.1, 4.85, 0, 5.05);
    outer.quadraticCurveTo(2.1, 4.85, 2.1, 3.1);
    outer.lineTo(2.1, 0);
    outer.closePath();
    const inner = new THREE.Path();
    inner.moveTo(-1.3, -0.5);
    inner.lineTo(-1.3, 2.9);
    inner.quadraticCurveTo(-1.3, 4.05, 0, 4.22);
    inner.quadraticCurveTo(1.3, 4.05, 1.3, 2.9);
    inner.lineTo(1.3, -0.5);
    inner.closePath();
    outer.holes.push(inner);
    const geo = new THREE.ExtrudeGeometry(outer, {
      depth: 0.7,
      bevelEnabled: true,
      bevelThickness: 0.07,
      bevelSize: 0.07,
      bevelSegments: 1,
    });
    geo.translate(0, 0, -0.35);
    archGeo = markSharedGeometry(geo);
  }
  return archGeo;
}

function doorKeystoneGeometry(): THREE.BufferGeometry {
  keystoneGeo ??= markSharedGeometry(new THREE.BoxGeometry(0.7, 1.0, 0.95));
  return keystoneGeo;
}

function doorPlinthGeometry(): THREE.BufferGeometry {
  plinthGeo ??= markSharedGeometry(new THREE.BoxGeometry(1.15, 0.7, 1.15));
  return plinthGeo;
}

function doorPortalGeometry(): THREE.BufferGeometry {
  portalGeo ??= markSharedGeometry(new THREE.CircleGeometry(1.55, 24));
  return portalGeo;
}

function doorNythraxisClickGeometry(): THREE.BufferGeometry {
  nythraxisClickGeo ??= markSharedGeometry(new THREE.BoxGeometry(4.6, 4.2, 2.4));
  return nythraxisClickGeo;
}

function doorNythraxisClickMaterial(): THREE.MeshBasicMaterial {
  nythraxisClickMat ??= markSharedMaterial(
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.001,
      depthWrite: false,
    }),
  );
  return nythraxisClickMat;
}

function doorPortalMaterial(entering: boolean, lowGfx: boolean): THREE.MeshBasicMaterial {
  const key = `${entering}:${lowGfx}`;
  const existing = portalMats.get(key);
  if (existing) return existing;
  const tint = entering ? 0x9a5df0 : 0x6ab8ff;
  const material = markSharedMaterial(
    new THREE.MeshBasicMaterial({
      color: tint,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  if (!lowGfx) material.color.multiplyScalar(PORTAL_BOOST);
  portalMats.set(key, material);
  return material;
}

// Build a dungeon-door (entering) or dungeon-exit (leaving) body: a stone arch +
// keystone + plinths framing an additive portal swirl. The Nythraxis crypt door
// is a bespoke invisible click-box instead (the visible arch is baked into that
// dungeon's geometry). Returns the portal mesh separately so the renderer can
// animate its swirl per frame.
export function buildDoorBody(
  entering: boolean,
  dungeonId: string | null | undefined,
  lowGfx: boolean,
): { body: THREE.Group; portal?: THREE.Mesh } {
  const body = new THREE.Group();
  if (entering && dungeonId === 'nythraxis_crypt') {
    const clickBox = new THREE.Mesh(doorNythraxisClickGeometry(), doorNythraxisClickMaterial());
    clickBox.position.y = 2.1;
    body.add(clickBox);
    return { body };
  }

  if (loadedDoorArchGltf) {
    const inst = loadedDoorArchGltf.clone(true);
    inst.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    body.add(inst);
  } else {
    const stone = doorStoneMaterial();
    const arch = new THREE.Mesh(doorArchGeometry(), stone);
    arch.castShadow = true;
    body.add(arch);
    const keystone = new THREE.Mesh(doorKeystoneGeometry(), stone);
    keystone.position.set(0, 4.75, 0);
    keystone.castShadow = true;
    body.add(keystone);
    for (const sx of [-1.7, 1.7]) {
      const plinth = new THREE.Mesh(doorPlinthGeometry(), stone);
      plinth.position.set(sx, 0.35, 0);
      plinth.castShadow = true;
      body.add(plinth);
    }
  }
  const portal = new THREE.Mesh(doorPortalGeometry(), doorPortalMaterial(entering, lowGfx));
  portal.position.y = 2.15;
  portal.scale.set(1, 1.35, 1);
  body.add(portal);
  return { body, portal };
}
