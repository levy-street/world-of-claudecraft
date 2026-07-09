// The mystery `(?)` orbs on the Protect Yumi maze: a growing/pulsing telegraph
// while 'spawning', then a bright bobbing orb once 'ready'. Every orb is
// identical mystery gold; the TYPE is never revealed on the ground (that is
// the whole point). A self-contained visual system the renderer drives once
// per frame (the module-first rule for new visual systems); it owns the mesh
// pool (by power-up id), the shared `?` billboard material, and their
// disposal: per-orb resources free as each orb leaves, and the shared sprite
// material + its CanvasTexture free once the maze empties (rebuilt lazily on
// the next bout), so nothing lingers for the rest of the session.

import * as THREE from 'three';
import { groundHeight } from '../sim/world';
import type { YumiGroundPowerupView } from '../world_api/duel_arena';

export class YumiPowerupOrbs {
  // Pooled `(?)` orbs (orb mesh + billboard glyph) by power-up id, and the
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
      depthTest: false, // the glyph floats readably over the orb
    });
    return this.spriteMat;
  }

  private buildOrb(): THREE.Group {
    const group = new THREE.Group();
    const geo = new THREE.OctahedronGeometry(0.85, 0);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffe066, // uniform mystery gold; the TYPE is never revealed here
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    group.add(new THREE.Mesh(geo, mat));
    const spr = new THREE.Sprite(this.getSpriteMat());
    spr.scale.setScalar(1.1);
    spr.position.y = 0.05;
    group.add(spr);
    return group;
  }

  /** Reconcile the pool against the live orb views, once per frame. `time` is
   *  the renderer clock (bob/pulse phases) and `seed` the world seed (terrain
   *  height at each orb). */
  update(list: readonly YumiGroundPowerupView[], time: number, dt: number, seed: number): void {
    if (list.length === 0 && this.meshes.size === 0) {
      // Idle between bouts: also release the shared glyph material + texture
      // so a finished match leaves nothing resident for the session.
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
      const orb = g.children[0] as THREE.Mesh;
      const mat = orb.material as THREE.MeshBasicMaterial;
      if (p.state === 'spawning') {
        g.scale.setScalar(0.3 + p.frac * 0.85);
        g.position.set(p.x, gy + 0.95, p.z);
        mat.opacity = 0.3 + Math.abs(Math.sin(time * 9)) * 0.45; // urgent pulse
      } else {
        g.scale.setScalar(1);
        g.position.set(p.x, gy + 1.25 + Math.sin(time * 2 + p.id) * 0.25, p.z);
        mat.opacity = 0.7 + Math.abs(Math.sin(time * 3)) * 0.25; // steady shimmer
      }
      orb.rotation.y += dt * 1.6;
    }
    for (const [id, g] of this.meshes) {
      if (seen.has(id)) continue;
      this.removeOrb(id, g);
    }
  }

  private removeOrb(id: number, g: THREE.Group): void {
    this.scene.remove(g);
    const orb = g.children[0] as THREE.Mesh;
    (orb.material as THREE.Material).dispose();
    orb.geometry.dispose(); // the `?` sprite material is shared; freed on empty
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
