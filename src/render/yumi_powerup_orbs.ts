// The mystery power-up boxes on the Protect Yumi maze: a growing/pulsing
// telegraph while 'spawning', then a bright bobbing crate once 'ready'. Every
// box is identical (the star-crate GLB plus the `?` billboard); the TYPE is
// never revealed on the ground (that is the whole point). A self-contained
// visual system the renderer drives once per frame (the module-first rule for
// new visual systems); it owns the mesh pool (by power-up id), the shared `?`
// billboard material, and their disposal: per-box CLONED materials free as
// each box leaves (the GLB geometry and texture stay with the loader cache,
// like every other prop), and the shared sprite material + its CanvasTexture
// free once the maze empties (rebuilt lazily on the next bout), so nothing
// bespoke lingers for the rest of the session.
//
// The crate model is public/models/props/yumi_powerup_box.glb (a Meshy
// image-to-3D prop, meshopt + 1024 webp, see CREDITS.md), normalized to
// BOX_HEIGHT yards from its measured bounds like placed_assets.ts does. If
// the GLB somehow is not resolved (the preload gate normally guarantees it
// is), buildOrb falls back to the original procedural gold octahedron so the
// pickup can never be invisible.

import * as THREE from 'three';
import { groundHeight } from '../sim/world';
import type { YumiGroundPowerupView } from '../world_api/duel_arena';
import { loadGltf } from './assets/loader';
import { registerPreload } from './assets/preload';

const BOX_URL = '/models/props/yumi_powerup_box.glb';
// Yards, the normalized crate height. The procedural octahedron it replaced
// spanned ~1.7yd; the crate reads denser, so slightly smaller still pops as
// the objective pickup without crowding a fighter (~1.8yd tall).
const BOX_HEIGHT = 1.15;
// The night maze is dark: the crate self-lights through its own base map so
// the pickup stays readable (a gameplay cue), breathing brighter while ready.
const BOX_EMISSIVE_BASE = 0.25;
const BOX_EMISSIVE_PULSE = 0.3;

interface BoxTemplate {
  geometry: THREE.BufferGeometry; // shared with the loader cache, never disposed here
  material: THREE.MeshStandardMaterial; // the cache original; clone per box
  norm: number; // scale factor to BOX_HEIGHT
}

let boxTemplate: BoxTemplate | null = null;

// Module-load fetch, registered as a preload (the render boot gate awaits it),
// so buildOrb can read the template synchronously in-game. The window guard
// keeps a plain-Node import (vitest scans) from fetching.
if (typeof window !== 'undefined') {
  registerPreload(
    loadGltf(BOX_URL).then((gltf) => {
      let mesh: THREE.Mesh | null = null;
      gltf.scene.traverse((o) => {
        if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
      });
      if (!mesh) return;
      const found = mesh as THREE.Mesh;
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = new THREE.Vector3();
      box.getSize(size);
      boxTemplate = {
        geometry: found.geometry,
        material: found.material as THREE.MeshStandardMaterial,
        norm: BOX_HEIGHT / (size.y || 1),
      };
    }),
  );
}

export class YumiPowerupOrbs {
  // Pooled boxes (crate mesh + billboard glyph) by power-up id, and the
  // shared `?` sprite material built once per non-empty stretch.
  private meshes = new Map<number, THREE.Group>();
  private spriteMat: THREE.SpriteMaterial | null = null;

  constructor(private scene: THREE.Scene) {}

  // The shared billboard material for the mystery `(?)` glyph. A static canvas
  // glyph (not procedural-random), so no seeded rnd() here.
  private getSpriteMat(): THREE.SpriteMaterial {
    if (this.spriteMat) return this.spriteMat;
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const cx = c.getContext('2d');
    if (cx) {
      cx.font = 'bold 92px sans-serif';
      cx.fillStyle = '#ffffff';
      cx.textAlign = 'center';
      cx.textBaseline = 'middle';
      cx.shadowColor = '#000000';
      cx.shadowBlur = 10;
      cx.fillText('?', 64, 70);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.spriteMat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      depthTest: false, // the glyph floats readably over the crate
    });
    return this.spriteMat;
  }

  private buildOrb(): THREE.Group {
    const group = new THREE.Group();
    if (boxTemplate) {
      // The star crate: shared geometry, per-box CLONED material (the opacity
      // and emissive animate per frame; the texture stays shared).
      const mat = boxTemplate.material.clone() as THREE.MeshStandardMaterial;
      mat.transparent = true;
      mat.emissive = new THREE.Color(0xffffff);
      mat.emissiveMap = mat.map;
      mat.emissiveIntensity = BOX_EMISSIVE_BASE;
      const crate = new THREE.Mesh(boxTemplate.geometry, mat);
      crate.scale.setScalar(boxTemplate.norm);
      crate.userData.sharedGeometry = true;
      group.add(crate);
    } else {
      // Fallback (the preload gate should make this unreachable): the original
      // procedural mystery-gold octahedron.
      const geo = new THREE.OctahedronGeometry(0.85, 0);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffe066,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      group.add(new THREE.Mesh(geo, mat));
    }
    const spr = new THREE.Sprite(this.getSpriteMat());
    spr.scale.setScalar(0.8);
    spr.position.y = BOX_HEIGHT; // floats above the crate
    group.add(spr);
    return group;
  }

  /** Reconcile the pool against the live orb views, once per frame. `time` is
   *  the renderer clock (bob/pulse phases) and `seed` the world seed (terrain
   *  height at each box). */
  update(list: readonly YumiGroundPowerupView[], time: number, dt: number, seed: number): void {
    if (list.length === 0 && this.meshes.size === 0) {
      // Idle between bouts: also release the shared glyph material + texture
      // so a finished match leaves nothing bespoke resident for the session.
      this.disposeSharedMat();
      return;
    }
    const seen = new Set<number>();
    for (const p of list) {
      seen.add(p.id);
      let g = this.meshes.get(p.id);
      if (!g) {
        g = this.buildOrb();
        this.meshes.set(p.id, g);
        this.scene.add(g);
      }
      const gy = groundHeight(p.x, p.z, seed);
      const crate = g.children[0] as THREE.Mesh;
      const mat = crate.material as THREE.MeshStandardMaterial;
      if (p.state === 'spawning') {
        // Materializing: grow in while pulsing ghost-transparent.
        g.scale.setScalar(0.3 + p.frac * 0.85);
        g.position.set(p.x, gy + 0.95, p.z);
        mat.opacity = 0.3 + Math.abs(Math.sin(time * 9)) * 0.45; // urgent pulse
      } else {
        // Ready: solid crate, bobbing, its star glow breathing.
        g.scale.setScalar(1);
        g.position.set(p.x, gy + 1.05 + Math.sin(time * 2 + p.id) * 0.2, p.z);
        mat.opacity = 1;
        if (mat.emissiveMap) {
          mat.emissiveIntensity =
            BOX_EMISSIVE_BASE + Math.abs(Math.sin(time * 3)) * BOX_EMISSIVE_PULSE;
        }
      }
      crate.rotation.y += dt * 1.6;
    }
    for (const [id, g] of this.meshes) {
      if (seen.has(id)) continue;
      this.removeOrb(id, g);
    }
  }

  private removeOrb(id: number, g: THREE.Group): void {
    this.scene.remove(g);
    const crate = g.children[0] as THREE.Mesh;
    (crate.material as THREE.Material).dispose(); // the per-box clone (textures stay cached)
    // The GLB geometry belongs to the loader cache; only the fallback owns its own.
    if (!crate.userData.sharedGeometry) crate.geometry.dispose();
    this.meshes.delete(id);
  }

  private disposeSharedMat(): void {
    if (!this.spriteMat) return;
    this.spriteMat.map?.dispose();
    this.spriteMat.dispose();
    this.spriteMat = null;
  }

  /** Free everything at once (world teardown). */
  dispose(): void {
    for (const [id, g] of this.meshes) this.removeOrb(id, g);
    this.disposeSharedMat();
  }
}
