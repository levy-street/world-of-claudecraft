import * as THREE from 'three';
import { bindSceneSamples, SCENE_SAMPLE_GLSL } from '../scene_sampling';
import { detailCell, type Substance } from './signature_core';
import { signatureTexture } from './signature_texture';

const CAPACITY = 12;
interface DetailSlot {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  age: number;
  duration: number;
  size: number;
  rise: number;
  y: number;
  active: boolean;
  ground: boolean;
}

/** Authored masks with advected texture detail, dark bodies and a narrow luminous dissolve edge.
 * Twelve prepared quads, one shared shader. Slots and uniforms are allocated only at construction. */
export class SignatureDetails {
  private readonly geometry = new THREE.PlaneGeometry(1, 1, 8, 8);
  private readonly slots: DetailSlot[] = [];
  private disposed = false;
  private readonly unbind: Array<() => void> = [];
  constructor(scene: THREE.Scene) {
    const proto = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: signatureTexture() },
        uCell: { value: 0 },
        uAge: { value: 0 },
        uTint: { value: new THREE.Color() },
        uAccent: { value: new THREE.Color() },
        uMotion: { value: 1 },
        uOpacity: { value: 0.65 },
        uKind: { value: 0 },
      },
      vertexShader: `varying vec2 vUv; varying float vViewDepth; uniform float uAge, uMotion, uKind;
        void main() {
          vUv = uv; vec3 p = position;
          if (uKind < 2.5) p.z += sin(uv.x * 9.0 + uAge * 3.0 * uMotion) * sin(uv.y * 3.14159265) * 0.08;
          vec4 view = modelViewMatrix * vec4(p, 1.0); vViewDepth = -view.z;
          gl_Position = projectionMatrix * view;
        }`,
      fragmentShader: `${SCENE_SAMPLE_GLSL}
        varying float vViewDepth;
        uniform sampler2D uMap;
        uniform float uCell, uAge, uMotion, uOpacity, uKind;
        uniform vec3 uTint, uAccent; varying vec2 vUv;
        float mask(vec2 uv) {
          vec2 cell = vec2(mod(uCell, 2.0), 1.0 - floor(uCell / 2.0));
          return texture2D(uMap, (cell + clamp(uv, 0.015, 0.985)) * 0.5).r;
        }
        void main() {
          vec2 uv = vUv;
          float turbulent = sin(uv.x*27.0 + sin(uv.y*18.0)) * sin(uv.y*23.0);
          uv.x += turbulent * 0.013 * sin(uAge*3.14) * uMotion;
          uv.y += sin(uv.x*19.0 + uAge*4.0*uMotion) * 0.012 * uMotion;
          float density = mask(uv);
          float threshold = mix(0.02, 0.58, smoothstep(0.2, 1.0, uAge));
          float body = smoothstep(threshold, threshold+0.15, density);
          float edge = (1.0-smoothstep(0.015, 0.075, abs(density-threshold))) * step(0.04,density);
          float frame = smoothstep(0.0,0.08,vUv.x)*smoothstep(0.0,0.08,vUv.y)
            *(1.0-smoothstep(0.92,1.0,vUv.x))*(1.0-smoothstep(0.92,1.0,vUv.y));
          float fade = smoothstep(0.0,0.055,uAge)*(1.0-smoothstep(0.7,1.0,uAge));
          float heat = uKind < 0.5 ? pow(max(0.0,density),3.0)*(1.0-uAge) : 0.0;
          vec3 colour = uTint*(0.2+density*0.8) + uAccent*(edge*(uKind>2.5?0.06:0.62) + heat*1.5);
          gl_FragColor = vec4(colour, min(0.78,(body*0.72+edge*0.18)*fade*uOpacity)*frame*sceneSoftness(vViewDepth,0.18));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    for (let i = 0; i < CAPACITY; i++) {
      const mesh = new THREE.Mesh(this.geometry.clone(), proto.clone());
      this.unbind.push(bindSceneSamples(scene, mesh));
      mesh.name = 'signatureDetail';
      mesh.visible = false;
      mesh.renderOrder = 6;
      mesh.userData.renderCategory = 'vfx';
      scene.add(mesh);
      mesh.frustumCulled = false;
      this.slots.push({
        mesh,
        age: 0,
        duration: 1,
        size: 1,
        rise: 0,
        y: 0,
        active: false,
        ground: false,
      });
    }
    proto.dispose();
  }
  spawn(
    x: number,
    y: number,
    z: number,
    size: number,
    tint: number,
    accent: number,
    substance: Substance,
    delay = 0,
    duration = 1.3,
  ): DetailSlot | null {
    if (
      this.disposed ||
      !signatureTexture() ||
      ![x, y, z, size, delay, duration].every(Number.isFinite) ||
      size <= 0 ||
      duration <= 0
    )
      return null;
    const slot = this.slots.find((s) => !s.active);
    if (!slot) return null; // existing detail keeps its silhouette under a crowd burst
    slot.ground = false;
    const positions = slot.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    positions.copy(this.geometry.getAttribute('position') as THREE.BufferAttribute);
    positions.needsUpdate = true;
    slot.active = true;
    slot.age = -Math.max(0, delay);
    slot.duration = Math.min(3, duration);
    slot.size = Math.min(7, size);
    slot.y = y;
    slot.rise =
      substance === 'fire' ? 0.9 : substance === 'water' || substance === 'ice' ? -0.3 : 0.4;
    const u = slot.mesh.material.uniforms;
    u.uMap.value = signatureTexture();
    u.uCell.value = detailCell(substance);
    u.uTint.value.setHex(tint);
    u.uAccent.value.setHex(accent);
    u.uKind.value = substance === 'fire' ? 0 : 1;
    u.uAge.value = 0;
    u.uOpacity.value = substance === 'shadow' ? 0.85 : 0.72;
    slot.mesh.position.set(x, y, z);
    slot.mesh.scale.setScalar(size * 0.7);
    slot.mesh.visible = false;
    return slot;
  }
  residue(
    x: number,
    z: number,
    radius: number,
    tint: number,
    substance: Substance,
    groundY: (x: number, z: number) => number,
  ): void {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(radius)) return;
    const gy = groundY(x, z);
    if (!Number.isFinite(gy)) return;
    const s = this.spawn(x, gy, z, radius * 2, tint, tint, substance, 0.1, 3);
    if (!s) return;
    s.ground = true;
    s.mesh.quaternion.identity();
    s.mesh.scale.setScalar(1);
    s.mesh.renderOrder = 2;
    s.mesh.material.uniforms.uKind.value = 3;
    const positions = s.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const base = this.geometry.getAttribute('position');
    const r = Math.min(2.2, Math.max(0.1, radius));
    for (let i = 0; i < positions.count; i++) {
      const px = base.getX(i) * r * 2,
        pz = base.getY(i) * r * 2,
        h = groundY(x + px, z + pz);
      positions.setXYZ(i, px, (Number.isFinite(h) ? h : gy) - gy + 0.075, pz);
    }
    positions.needsUpdate = true;
  }
  update(dt: number, camera: THREE.Quaternion, reducedMotion: boolean): void {
    if (this.disposed) return;
    const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age += step;
      if (slot.age < 0) continue;
      if (slot.age >= slot.duration) {
        slot.active = false;
        slot.mesh.visible = false;
        continue;
      }
      const t = slot.age / slot.duration;
      slot.mesh.visible = true;
      slot.mesh.material.uniforms.uAge.value = t;
      slot.mesh.material.uniforms.uMotion.value = reducedMotion || slot.ground ? 0 : 1;
      if (!slot.ground) {
        slot.mesh.renderOrder = 6;
        slot.mesh.quaternion.copy(camera);
        slot.mesh.scale.setScalar(
          slot.size * (reducedMotion ? 0.86 : 0.7 + 0.3 * (1 - (1 - t) ** 3)),
        );
        slot.mesh.position.y = slot.y + (reducedMotion ? 0 : slot.rise * t);
      }
    }
  }
  clear(): void {
    for (const s of this.slots) {
      s.active = false;
      s.mesh.visible = false;
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
    for (const unbind of this.unbind) unbind();
    for (const s of this.slots) {
      s.mesh.removeFromParent();
      s.mesh.material.dispose();
      s.mesh.geometry.dispose();
    }
    this.geometry.dispose();
  }
}
