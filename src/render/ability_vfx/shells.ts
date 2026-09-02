import * as THREE from 'three';
import type { VfxAnchorResolver } from '../vfx_anchor';

// Translucent buff/barrier shells (the gallery's receiver shell): a soft
// additive sphere with a fresnel-style rim (rim term in the shader) wrapped
// around an entity while its barrier aura lives, or for a fixed shellDur after
// a buff lands.
//
// ONE InstancedMesh for the whole pool, not a mesh and a cloned material per
// slot. A shell never deforms: every slot is the same sphere at a different
// place, scale, colour and opacity, which is exactly the per-instance shape.
// The pool used to cost eight materials (eight full uniform uploads and eight
// setProgram/VAO binds in a raid frame where several shells are up) to draw
// eight copies of one sphere. Colour and opacity ride instanced attributes; the
// time uniform is shared because every slot was already being written the same
// frame time. Additive blending with depth writes off is order-independent, so
// merging the slots into one draw cannot change the composited result.

const SHELL_SLOTS = 8;

// Per-frame anchor scratch (see ../vfx_anchor.ts): update() resolves one anchor
// per live shell and consumes it before the next resolve into it. That
// consume-before-reuse is what makes a module-level scratch safe to share,
// even when a second engine is alive (the editor viewport composes its own
// Renderer): every reading is spent inside one synchronous update pass.
const anchorScratch = new THREE.Vector3();
const matrixScratch = new THREE.Matrix4();

interface ShellSlot {
  entityId: number;
  age: number;
  // Infinity = held open by a live aura (refreshed by stamp each frame)
  dur: number;
  stamp: number;
  active: boolean;
  color: THREE.Color;
  /** World anchor and radius of the last packed instance. */
  x: number;
  y: number;
  z: number;
  scale: number;
  opacity: number;
}

export class BuffShells {
  private slots: ShellSlot[] = [];
  private readonly geometry: THREE.SphereGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly mesh: THREE.InstancedMesh;
  private readonly colors: THREE.InstancedBufferAttribute;
  private readonly opacities: THREE.InstancedBufferAttribute;
  private disposed = false;

  constructor(scene: THREE.Scene) {
    this.geometry = new THREE.SphereGeometry(1, 24, 16);
    this.colors = new THREE.InstancedBufferAttribute(new Float32Array(SHELL_SLOTS * 3), 3);
    this.opacities = new THREE.InstancedBufferAttribute(new Float32Array(SHELL_SLOTS), 1);
    this.colors.setUsage(THREE.DynamicDrawUsage);
    this.opacities.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aColor', this.colors);
    this.geometry.setAttribute('aOpacity', this.opacities);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        attribute vec3 aColor;
        attribute float aOpacity;
        varying vec3 vNormal;
        varying vec3 vView;
        varying vec3 vColor;
        varying float vOpacity;
        void main() {
          vColor = aColor;
          vOpacity = aOpacity;
          // The instance scale is uniform, so the rotation/scale block can
          // carry the normal without an inverse-transpose.
          vNormal = normalize(normalMatrix * (mat3(instanceMatrix) * normal));
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          vView = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform float uTime;
        varying vec3 vNormal;
        varying vec3 vView;
        varying vec3 vColor;
        varying float vOpacity;
        void main() {
          // max() guards pow() where the surface faces the camera head-on: there
          // abs(dot(...)) of two vectors normalized in shader overshoots 1.0 by
          // an ulp, so the base goes negative and pow() returns NaN. One NaN
          // pixel spreads into a hard-edged black rectangle through the bloom.
          float fres = pow(max(0.0, 1.0 - abs(dot(normalize(vNormal), normalize(vView)))), 2.2);
          float a = vOpacity * (0.12 + 0.88 * fres);
          // A fresnel shell is nearly transparent where it faces the camera,
          // which is most of its area: early-out below the additive floor
          // (../vfx.ts / overlay_sprites.ts idiom, depth writes already off).
          if (a < 0.004) discard;
          float pulse = 0.85 + 0.15 * sin(uTime * 5.0);
          vec3 col = vColor * (0.25 + 1.9 * fres) * pulse;
          gl_FragColor = vec4(col, a);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, SHELL_SLOTS);
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.renderOrder = 6;
    this.mesh.userData.renderCategory = 'vfx';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Refreshed from the packed instances each frame (see pack): three caches
    // an InstancedMesh's own sphere once and would never notice a shell move.
    this.mesh.boundingSphere = new THREE.Sphere();
    scene.add(this.mesh);
    for (let i = 0; i < SHELL_SLOTS; i++) {
      this.slots.push({
        entityId: -1,
        age: 0,
        dur: 0,
        stamp: 0,
        active: false,
        color: new THREE.Color(),
        x: 0,
        y: 0,
        z: 0,
        scale: 1,
        opacity: 0,
      });
    }
  }

  // Timed shell (buff shellDur): plays once and fades out on its own.
  flash(entityId: number, colorHex: number, dur: number): void {
    if (this.disposed) return;
    const slot =
      this.slots.find((s) => s.active && s.entityId === entityId) ??
      this.slots.find((s) => !s.active) ??
      this.slots[0];
    const wasActive = slot.active;
    slot.active = true;
    slot.entityId = entityId;
    slot.age = 0;
    slot.dur = dur;
    slot.color.setHex(colorHex);
    // Pack straight away on the activating call, so a shell spawned outside the
    // update pass (AbilityVfxFx.prewarmSpawn, behind the loading cover) is still
    // submitted that frame at opacity 0, exactly as the per-slot meshes were.
    if (!wasActive) this.pack();
  }

  // Held shell (barrier auras): refreshed every frame while the aura lives;
  // hold() marks it seen, endFrame() releases the ones that stopped arriving.
  hold(entityId: number, colorHex: number, frame: number): void {
    if (this.disposed) return;
    let slot = this.slots.find((s) => s.active && s.entityId === entityId);
    let activated = false;
    if (!slot) {
      slot = this.slots.find((s) => !s.active);
      if (!slot) return;
      slot.active = true;
      slot.entityId = entityId;
      slot.age = 0;
      activated = true;
    }
    slot.dur = Number.POSITIVE_INFINITY;
    slot.stamp = frame;
    slot.color.setHex(colorHex);
    if (activated) this.pack();
  }

  update(dt: number, time: number, frame: number, anchor: VfxAnchorResolver): void {
    if (this.disposed) return;
    this.material.uniforms.uTime.value = time;
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age += dt;
      const held = slot.dur === Number.POSITIVE_INFINITY;
      if (held && slot.stamp !== frame) {
        // the aura dropped: release and fade as a short timed shell
        slot.dur = slot.age + 0.35;
      }
      if (!held && slot.age >= slot.dur) {
        slot.active = false;
        continue;
      }
      const at = anchor(slot.entityId, 0.5, anchorScratch);
      if (!at) {
        slot.active = false;
        continue;
      }
      const grow = Math.min(1, slot.age / 0.18);
      const fadeOut = held ? 1 : Math.min(1, Math.max(0, (slot.dur - slot.age) / 0.35));
      slot.x = at.x;
      slot.y = at.y;
      slot.z = at.z;
      slot.scale = 1.05 * (0.7 + 0.3 * grow);
      slot.opacity = 0.5 * grow * fadeOut;
    }
    this.pack();
  }

  /** Write every live slot into the instance buffers, front-packed, and refresh
   *  the bounding sphere the frustum test reads. */
  private pack(): void {
    let count = 0;
    for (const slot of this.slots) {
      if (!slot.active) continue;
      matrixScratch.makeScale(slot.scale, slot.scale, slot.scale);
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
      cy += slot.y;
      cz += slot.z;
    }
    sphere.center.set(cx / count, cy / count, cz / count);
    let radius = 0;
    for (const slot of this.slots) {
      if (!slot.active) continue;
      const dx = slot.x - sphere.center.x;
      const dy = slot.y - sphere.center.y;
      const dz = slot.z - sphere.center.z;
      radius = Math.max(radius, Math.hypot(dx, dy, dz) + slot.scale);
    }
    sphere.radius = radius;
  }

  sleepEntity(entityId: number): void {
    for (const slot of this.slots) {
      if (!slot.active || slot.entityId !== entityId) continue;
      slot.active = false;
    }
    this.pack();
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
