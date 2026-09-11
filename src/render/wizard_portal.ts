// Baldemar's gate: the purple walk-in portal his cast opens
// (src/game/portal_travel_core.ts drives WHEN; this module is only the prop).
//
// Body is a bespoke Blender-authored arch (public/models/props/
// portal_baldemar.glb), preloaded and cloned per view like the rift gate in
// door_portal.ts, with a procedural stone-ring fallback for pre-load races.
// The swirl disc, base ring and light stay procedural: they are animated
// additive VFX, not part of the static body, and they reuse the rift portal's
// cached spiral texture so no new texture memory is spent.

import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { riftPortalTexture } from './door_portal';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';

const WIZARD_PORTAL_URL = '/models/props/portal_baldemar.glb';
/** World height (yards) the authored arch is scaled to: tall enough to walk
 *  through without ducking, short of the rift gate's 6 yd loom, since this one
 *  stands in town squares next to a wizard, not alone on a ridge. */
const WIZARD_PORTAL_HEIGHT = 4.4;

/** The arcane purple family: disc at the blink/arcane violet, light at the
 *  delve mouth's deep purple, rim darker still. */
const PORTAL_DISC_COLOR = 0xb04fff;
const PORTAL_LIGHT_COLOR = 0x7010b0;
const PORTAL_RING_COLOR = 0x8a3df0;

let wizardPortalGltf: GLTF | null = null;

if (typeof window !== 'undefined') {
  registerDeferredPreload(() =>
    loadGltf(WIZARD_PORTAL_URL)
      .then((gltf) => {
        // Clones share geometry/materials with this cached original; mark them
        // shared so per-view disposal never frees them (door_portal contract).
        gltf.scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          markSharedGeometry(mesh.geometry);
          const mat = mesh.material;
          if (Array.isArray(mat)) mat.forEach(markSharedMaterial);
          else markSharedMaterial(mat);
        });
        wizardPortalGltf = gltf;
      })
      .catch(() => {
        // Missing asset: the procedural stone ring below carries the scene.
        wizardPortalGltf = null;
      }),
  );
}

/** Everything per-view and disposable (the arch clone's resources are shared
 *  and skipped; the disc/ring materials are per-view so the spawn fade can
 *  drive opacity without cross-talk between two open gates). */
export class WizardPortalView {
  readonly group = new THREE.Group();
  private readonly disc: THREE.Mesh;
  private readonly baseRing: THREE.Mesh;
  private readonly light: THREE.PointLight;
  private readonly discMat: THREE.MeshBasicMaterial;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly ownedGeometries: THREE.BufferGeometry[] = [];
  private readonly ownedMaterials: THREE.Material[] = [];
  /** Seconds since spawn, drives the scale-in and the idle churn. */
  private age = 0;

  constructor(lowGfx: boolean) {
    // -- the body: authored arch, or the fallback stone ring -----------------
    if (wizardPortalGltf) {
      const model = wizardPortalGltf.scene.clone(true);
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const s = WIZARD_PORTAL_HEIGHT / Math.max(size.y, 1e-3);
      model.scale.setScalar(s);
      model.position.set(
        -((box.min.x + box.max.x) / 2) * s,
        -box.min.y * s,
        -((box.min.z + box.max.z) / 2) * s,
      );
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.castShadow = true;
      });
      this.group.add(model);
    } else {
      const torusGeo = new THREE.TorusGeometry(1.7, 0.22, 10, 40);
      const torusMat = new THREE.MeshLambertMaterial({
        color: 0x241833,
        emissive: PORTAL_RING_COLOR,
        emissiveIntensity: 0.35,
      });
      this.ownedGeometries.push(torusGeo);
      this.ownedMaterials.push(torusMat);
      const torus = new THREE.Mesh(torusGeo, torusMat);
      torus.position.y = 2.1;
      torus.castShadow = true;
      this.group.add(torus);
    }

    // -- the swirl disc ------------------------------------------------------
    const discGeo = new THREE.CircleGeometry(1.5, 40);
    this.discMat = new THREE.MeshBasicMaterial({
      color: PORTAL_DISC_COLOR,
      map: riftPortalTexture() ?? undefined,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    if (!lowGfx) this.discMat.color.multiplyScalar(2.4);
    this.ownedGeometries.push(discGeo);
    this.ownedMaterials.push(this.discMat);
    this.disc = new THREE.Mesh(discGeo, this.discMat);
    this.disc.position.y = 2.1;
    this.disc.renderOrder = 3;
    this.group.add(this.disc);

    // -- the base ring the gate stands in ------------------------------------
    const ringGeo = new THREE.RingGeometry(1.4, 2.2, 40);
    this.ringMat = new THREE.MeshBasicMaterial({
      color: PORTAL_RING_COLOR,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.ownedGeometries.push(ringGeo);
    this.ownedMaterials.push(this.ringMat);
    this.baseRing = new THREE.Mesh(ringGeo, this.ringMat);
    this.baseRing.rotation.x = -Math.PI / 2;
    this.baseRing.position.y = 0.06;
    this.baseRing.renderOrder = 2;
    this.group.add(this.baseRing);

    // -- the glow ------------------------------------------------------------
    this.light = new THREE.PointLight(PORTAL_LIGHT_COLOR, 0, 16);
    this.light.position.y = 2.1;
    this.group.add(this.light);
  }

  /** Seat the view in the world. `facing` turns the disc to face the player. */
  place(x: number, y: number, z: number, facing: number): void {
    this.group.position.set(x, y, z);
    this.group.rotation.y = facing;
  }

  update(dt: number): void {
    this.age += dt;
    // Scale-in: the gate churns up out of nothing over ~0.6 s.
    const grow = Math.min(1, this.age / 0.6);
    const ease = 1 - (1 - grow) * (1 - grow);
    this.disc.scale.setScalar(Math.max(0.001, ease));
    // Idle churn: the spiral texture spins, the light and disc breathe.
    this.disc.rotation.z -= dt * 1.7;
    const breathe = 0.9 + 0.1 * Math.sin(this.age * 2.3);
    this.discMat.opacity = 0.95 * ease * breathe;
    this.ringMat.opacity = 0.5 * ease * breathe;
    this.light.intensity = 9 * ease * breathe;
  }

  dispose(): void {
    for (const g of this.ownedGeometries) g.dispose();
    for (const m of this.ownedMaterials) m.dispose();
    this.group.removeFromParent();
  }
}

export function buildWizardPortal(lowGfx: boolean): WizardPortalView {
  return new WizardPortalView(lowGfx);
}
