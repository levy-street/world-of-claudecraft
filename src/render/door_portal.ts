import * as THREE from 'three';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';

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

// Portal shimmer tint by kind. Violet marks dungeon entrances, blue instance
// exits; `pad` is the pale silver shimmer of the Mirror World's standing
// mirrors (buildMirrorBody rides it on the glass).
const PORTAL_TINTS = {
  enter: 0x9a5df0,
  exit: 0x6ab8ff,
  pad: 0xb9c2dd,
} as const;
type PortalKind = keyof typeof PORTAL_TINTS;

function doorPortalMaterial(kind: PortalKind, lowGfx: boolean): THREE.MeshBasicMaterial {
  const key = `${kind}:${lowGfx}`;
  const existing = portalMats.get(key);
  if (existing) return existing;
  const material = markSharedMaterial(
    new THREE.MeshBasicMaterial({
      color: PORTAL_TINTS[kind],
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
  const portal = new THREE.Mesh(
    doorPortalGeometry(),
    doorPortalMaterial(entering ? 'enter' : 'exit', lowGfx),
  );
  portal.position.y = 2.15;
  portal.scale.set(1, 1.35, 1);
  body.add(portal);
  return { body, portal };
}

// Shared frame/glass materials for the Mirror World's standing mirrors. Process-
// lifetime like the door resources above, so the renderer's per-view disposal
// guard leaves them alone (the mirror's per-view body geometry is not shared and
// is freed on interest churn).
let mirrorFrameMat: THREE.Material | null = null;
let mirrorGlassMat: THREE.Material | null = null;

function mirrorFrameMaterial(): THREE.Material {
  mirrorFrameMat ??= markSharedMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x2e2a3e,
      roughness: 0.55,
      metalness: 0.35,
      emissive: 0x14122a,
      emissiveIntensity: 0.6,
    }),
  );
  return mirrorFrameMat;
}

function mirrorGlassMaterial(): THREE.Material {
  mirrorGlassMat ??= markSharedMaterial(
    new THREE.MeshStandardMaterial({
      color: 0xcfd6e6,
      roughness: 0.05,
      metalness: 1,
      envMapIntensity: 2.5,
      emissive: 0x0c0c18,
      emissiveIntensity: 0.3,
    }),
  );
  return mirrorGlassMat;
}

// A standing mirror — every Mirror World portal pad renders as one: a dark
// ornate frame on a plinth around a polished metal oval, with the pad-tinted
// door shimmer riding the returned `portal` mesh so the renderer's existing
// portal animation path (spin + opacity pulse) breathes it for free. High
// metalness + the scene env map make the glass read as a true reflection of its
// surroundings (bright sky on the Thornpeak ridge, pale gloaming inside the
// dome).
export function buildMirrorBody(lowGfx: boolean): { body: THREE.Group; portal?: THREE.Mesh } {
  const frameMat = mirrorFrameMaterial();
  const glassMat = mirrorGlassMaterial();
  const body = new THREE.Group();
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 1.4), frameMat);
  plinth.position.y = 0.25;
  plinth.castShadow = true;
  body.add(plinth);
  const frame = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.16, 10, 40), frameMat);
  frame.position.y = 2.5;
  frame.scale.set(1, 1.45, 1);
  frame.castShadow = true;
  body.add(frame);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(1.3, 40), glassMat);
  glass.position.y = 2.5;
  glass.scale.set(1, 1.45, 1);
  body.add(glass);
  const backing = new THREE.Mesh(new THREE.CircleGeometry(1.3, 40), frameMat);
  backing.position.set(0, 2.5, -0.03);
  backing.scale.set(1, 1.45, 1);
  backing.rotation.y = Math.PI;
  body.add(backing);
  const portal = new THREE.Mesh(doorPortalGeometry(), doorPortalMaterial('pad', lowGfx));
  portal.position.set(0, 2.5, 0.06);
  portal.scale.set(0.62, 0.9, 1);
  body.add(portal);
  return { body, portal };
}
