import * as THREE from 'three';

// Translucent buff/barrier shells (the gallery's receiver shell): a soft
// additive sphere with a fresnel-style rim (rim term in the shader) wrapped
// around an entity while its barrier aura lives, or for a fixed shellDur after
// a buff lands. Fixed slot pool; materials cloned once at construction.

const SHELL_SLOTS = 8;

interface ShellSlot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  entityId: number;
  age: number;
  // Infinity = held open by a live aura (refreshed by stamp each frame)
  dur: number;
  stamp: number;
  active: boolean;
}

export class BuffShells {
  private slots: ShellSlot[] = [];

  constructor(scene: THREE.Scene) {
    const geo = new THREE.SphereGeometry(1, 24, 16);
    const proto = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color() },
        uOpacity: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vView = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        uniform float uTime;
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          float fres = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.2);
          float pulse = 0.85 + 0.15 * sin(uTime * 5.0);
          vec3 col = uColor * (0.25 + 1.9 * fres) * pulse;
          gl_FragColor = vec4(col, uOpacity * (0.12 + 0.88 * fres));
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    for (let i = 0; i < SHELL_SLOTS; i++) {
      const mat = proto.clone();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 6;
      mesh.userData.renderCategory = 'vfx';
      scene.add(mesh);
      this.slots.push({ mesh, mat, entityId: -1, age: 0, dur: 0, stamp: 0, active: false });
    }
    proto.dispose();
  }

  // Timed shell (buff shellDur): plays once and fades out on its own.
  flash(entityId: number, colorHex: number, dur: number): void {
    const slot =
      this.slots.find((s) => s.active && s.entityId === entityId) ??
      this.slots.find((s) => !s.active) ??
      this.slots[0];
    slot.active = true;
    slot.entityId = entityId;
    slot.age = 0;
    slot.dur = dur;
    (slot.mat.uniforms.uColor.value as THREE.Color).setHex(colorHex);
    slot.mesh.visible = true;
  }

  // Held shell (barrier auras): refreshed every frame while the aura lives;
  // hold() marks it seen, endFrame() releases the ones that stopped arriving.
  hold(entityId: number, colorHex: number, frame: number): void {
    let slot = this.slots.find((s) => s.active && s.entityId === entityId);
    if (!slot) {
      slot = this.slots.find((s) => !s.active);
      if (!slot) return;
      slot.active = true;
      slot.entityId = entityId;
      slot.age = 0;
    }
    slot.dur = Number.POSITIVE_INFINITY;
    slot.stamp = frame;
    (slot.mat.uniforms.uColor.value as THREE.Color).setHex(colorHex);
    slot.mesh.visible = true;
  }

  update(
    dt: number,
    time: number,
    frame: number,
    anchor: (id: number, frac: number) => { x: number; y: number; z: number } | null,
  ): void {
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
        slot.mesh.visible = false;
        continue;
      }
      const at = anchor(slot.entityId, 0.5);
      if (!at) {
        slot.active = false;
        slot.mesh.visible = false;
        continue;
      }
      const grow = Math.min(1, slot.age / 0.18);
      const fadeOut = held ? 1 : Math.min(1, Math.max(0, (slot.dur - slot.age) / 0.35));
      slot.mesh.position.set(at.x, at.y, at.z);
      slot.mesh.scale.setScalar(1.05 * (0.7 + 0.3 * grow));
      slot.mat.uniforms.uOpacity.value = 0.5 * grow * fadeOut;
      slot.mat.uniforms.uTime.value = time;
    }
  }

  clear(): void {
    for (const slot of this.slots) {
      slot.active = false;
      slot.mesh.visible = false;
    }
  }
}
