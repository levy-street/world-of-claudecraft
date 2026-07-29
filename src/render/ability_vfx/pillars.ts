import * as THREE from 'three';

// Vertical light pillars (the gallery's shaft/skybeam/pillars read): a tapered
// additive column that rises, holds, and fades. Fixed slot pool, one shared
// geometry, one material clone per slot at construction; nothing cloned per
// spawn. Used by the pillars motif, shaft specs, and skybeam bursts.

const PILLAR_SLOTS = 10;

interface PillarSlot {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  dur: number;
  radius: number;
  height: number;
  active: boolean;
}

export class LightPillars {
  private slots: PillarSlot[] = [];
  private next = 0;

  constructor(scene: THREE.Scene) {
    // Slight taper reads as a beam falling from above; open-ended so the
    // camera never sees a hard cap disc.
    const geo = new THREE.CylinderGeometry(0.55, 1, 1, 10, 1, true);
    geo.translate(0, 0.5, 0); // pivot at the base
    for (let i = 0; i < PILLAR_SLOTS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 6;
      mesh.userData.renderCategory = 'vfx';
      scene.add(mesh);
      this.slots.push({ mesh, mat, age: 0, dur: 0.55, radius: 1, height: 12, active: false });
    }
  }

  spawn(
    x: number,
    y: number,
    z: number,
    radius: number,
    height: number,
    colorHex: number,
    dur: number,
  ): void {
    const slot = this.slots[this.next];
    this.next = (this.next + 1) % PILLAR_SLOTS;
    slot.active = true;
    slot.age = 0;
    slot.dur = dur;
    slot.radius = radius;
    slot.height = height;
    slot.mat.color.setHex(colorHex).multiplyScalar(1.7);
    slot.mat.opacity = 0;
    slot.mesh.position.set(x, y, z);
    slot.mesh.visible = true;
  }

  update(dt: number): void {
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age += dt;
      const t = slot.age / slot.dur;
      if (t >= 1) {
        slot.active = false;
        slot.mesh.visible = false;
        continue;
      }
      // fast rise (12%), hold bright, fade with a slight widen
      const rise = Math.min(1, t / 0.12);
      const fade = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
      slot.mat.opacity = 0.5 * rise * fade;
      slot.mesh.scale.set(
        slot.radius * (0.85 + 0.3 * t),
        slot.height * (0.25 + 0.75 * rise),
        slot.radius * (0.85 + 0.3 * t),
      );
    }
  }

  clear(): void {
    for (const slot of this.slots) {
      slot.active = false;
      slot.mesh.visible = false;
    }
  }
}
