import * as THREE from 'three';

// Vertical light pillars (the gallery's shaft/skybeam/pillars read): a tapered
// additive column that rises, holds, and fades. Used by the pillars motif,
// shaft specs, and skybeam bursts.
//
// ONE InstancedMesh for the whole pool. A pillar never deforms: every slot is
// the same tapered cylinder at a different place, scale, colour and opacity,
// which is exactly the per-instance shape. The pool used to hold ten
// MeshBasicMaterials to draw ten copies of one geometry, so a motif that fires
// six columns paid six setProgram/VAO binds and six full uniform uploads for
// what is now one draw. The colour and opacity a MeshBasicMaterial carried as
// material state ride instanced attributes instead; the shader reproduces
// basic-additive exactly (toneMapped was already off, and a ShaderMaterial
// takes no tone mapping either), so the composited result is unchanged.
// Additive blending with depth writes off is order-independent, so merging the
// slots into one draw cannot reorder anything that matters.

const PILLAR_SLOTS = 10;

const matrixScratch = new THREE.Matrix4();

interface PillarSlot {
  age: number;
  dur: number;
  radius: number;
  height: number;
  active: boolean;
  color: THREE.Color;
  x: number;
  y: number;
  z: number;
  opacity: number;
  scaleXZ: number;
  scaleY: number;
}

export class LightPillars {
  private slots: PillarSlot[] = [];
  private next = 0;
  private readonly geometry: THREE.CylinderGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly mesh: THREE.InstancedMesh;
  private readonly colors: THREE.InstancedBufferAttribute;
  private readonly opacities: THREE.InstancedBufferAttribute;
  private disposed = false;

  constructor(scene: THREE.Scene) {
    // Slight taper reads as a beam falling from above; open-ended so the
    // camera never sees a hard cap disc.
    this.geometry = new THREE.CylinderGeometry(0.55, 1, 1, 10, 1, true);
    this.geometry.translate(0, 0.5, 0); // pivot at the base
    this.colors = new THREE.InstancedBufferAttribute(new Float32Array(PILLAR_SLOTS * 3), 3);
    this.opacities = new THREE.InstancedBufferAttribute(new Float32Array(PILLAR_SLOTS), 1);
    this.colors.setUsage(THREE.DynamicDrawUsage);
    this.opacities.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aColor', this.colors);
    this.geometry.setAttribute('aOpacity', this.opacities);
    this.material = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: `
        attribute vec3 aColor;
        attribute float aOpacity;
        varying vec3 vColor;
        varying float vOpacity;
        void main() {
          vColor = aColor;
          vOpacity = aOpacity;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vColor;
        varying float vOpacity;
        void main() {
          // The additive floor (../vfx.ts / overlay_sprites.ts idiom): a rising
          // or fading column spends most of its life below it, and depth writes
          // are off, so nothing depends on the discarded fragments landing.
          if (vOpacity < 0.004) discard;
          gl_FragColor = vec4(vColor, vOpacity);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, PILLAR_SLOTS);
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.renderOrder = 6;
    this.mesh.userData.renderCategory = 'vfx';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Refreshed from the packed instances each frame (see pack): three caches
    // an InstancedMesh's own sphere once and would never notice a column move.
    this.mesh.boundingSphere = new THREE.Sphere();
    scene.add(this.mesh);
    for (let i = 0; i < PILLAR_SLOTS; i++) {
      this.slots.push({
        age: 0,
        dur: 0.55,
        radius: 1,
        height: 12,
        active: false,
        color: new THREE.Color(),
        x: 0,
        y: 0,
        z: 0,
        opacity: 0,
        scaleXZ: 1,
        scaleY: 1,
      });
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
    if (this.disposed) return;
    const slot = this.slots[this.next];
    this.next = (this.next + 1) % PILLAR_SLOTS;
    slot.active = true;
    slot.age = 0;
    slot.dur = dur;
    slot.radius = radius;
    slot.height = height;
    // The MeshBasicMaterial carried this same 1.7x lift on its colour.
    slot.color.setHex(colorHex).multiplyScalar(1.7);
    slot.opacity = 0;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.scaleXZ = radius;
    slot.scaleY = height * 0.25;
    // Pack straight away, so a pillar spawned outside the update pass
    // (AbilityVfxFx.prewarmSpawn, behind the loading cover) is still submitted
    // that frame at opacity 0, exactly as the per-slot meshes were.
    this.pack();
  }

  update(dt: number): void {
    if (this.disposed) return;
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age += dt;
      const t = slot.age / slot.dur;
      if (t >= 1) {
        slot.active = false;
        continue;
      }
      // fast rise (12%), hold bright, fade with a slight widen
      const rise = Math.min(1, t / 0.12);
      const fade = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
      slot.opacity = 0.5 * rise * fade;
      slot.scaleXZ = slot.radius * (0.85 + 0.3 * t);
      slot.scaleY = slot.height * (0.25 + 0.75 * rise);
    }
    this.pack();
  }

  /** Write every live slot into the instance buffers, front-packed, and refresh
   *  the bounding sphere the frustum test reads. */
  private pack(): void {
    let count = 0;
    for (const slot of this.slots) {
      if (!slot.active) continue;
      matrixScratch.makeScale(slot.scaleXZ, slot.scaleY, slot.scaleXZ);
      matrixScratch.setPosition(slot.x, slot.y, slot.z);
      this.mesh.setMatrixAt(count, matrixScratch);
      this.colors.setXYZ(count, slot.color.r, slot.color.g, slot.color.b);
      this.opacities.setX(count, slot.opacity);
      count++;
    }
    this.mesh.count = count;
    this.mesh.visible = count > 0;
    if (count === 0) return;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, count * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.colors.clearUpdateRanges();
    this.colors.addUpdateRange(0, count * 3);
    this.colors.needsUpdate = true;
    this.opacities.clearUpdateRanges();
    this.opacities.addUpdateRange(0, count);
    this.opacities.needsUpdate = true;

    const sphere = this.mesh.boundingSphere as THREE.Sphere;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const slot of this.slots) {
      if (!slot.active) continue;
      cx += slot.x;
      cy += slot.y + slot.scaleY * 0.5;
      cz += slot.z;
    }
    sphere.center.set(cx / count, cy / count, cz / count);
    let radius = 0;
    for (const slot of this.slots) {
      if (!slot.active) continue;
      const dx = slot.x - sphere.center.x;
      const dy = slot.y + slot.scaleY * 0.5 - sphere.center.y;
      const dz = slot.z - sphere.center.z;
      // The column's own half-extent: its taper never exceeds the base radius.
      radius = Math.max(radius, Math.hypot(dx, dy, dz) + Math.hypot(slot.scaleXZ, slot.scaleY / 2));
    }
    sphere.radius = radius;
  }

  clear(): void {
    for (const slot of this.slots) slot.active = false;
    if (!this.disposed) this.pack();
  }

  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
    this.mesh.removeFromParent();
    this.material.dispose();
    this.geometry.dispose();
  }
}
