import * as THREE from 'three';
import { SUN_DIR } from '../gfx';
import { bindSceneSamples, SCENE_SAMPLE_GLSL } from '../scene_sampling';
import type { SeqPoint } from './sequencer';
import {
  SHAMAN_WATER_FRAGMENT,
  SHAMAN_WATER_VERTEX,
  type ShamanWaterFlow,
} from './shaman_water_material';

const CAPACITY = 12;
const LENGTH_STEPS = 32;
const SIDES = 8;

/** One prepared draw for twelve liquid volumes. Spawn uploads only instance
 * data; animation is uniform driven and never allocates or resamples actors.
 * Normal alpha preserves a dark liquid body under the existing HDR glints. */
export class RestorativeWaterVolumes {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly ends = new Float64Array(CAPACITY);
  private readonly priorities = new Uint8Array(CAPACITY);
  private readonly color = new THREE.Color();
  private time = 0;
  private disposed = false;
  private readonly unbind: () => void;

  constructor(scene: THREE.Scene) {
    const geometry = new THREE.InstancedBufferGeometry();
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let row = 0; row <= LENGTH_STEPS; row++) {
      for (let side = 0; side <= SIDES; side++) {
        positions.push(0, 0, 0);
        uvs.push(row / LENGTH_STEPS, side / SIDES);
        if (row < LENGTH_STEPS && side < SIDES) {
          const a = row * (SIDES + 1) + side;
          indices.push(a, a + 1, a + SIDES + 1, a + 1, a + SIDES + 2, a + SIDES + 1);
        }
      }
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    for (const name of ['aFrom', 'aTo', 'aTint', 'aAccent'])
      geometry.setAttribute(
        name,
        new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3).setUsage(
          THREE.DynamicDrawUsage,
        ),
      );
    geometry.setAttribute(
      'aLife',
      new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    geometry.instanceCount = CAPACITY;
    geometry.setAttribute(
      'aFlow',
      new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    const material = new THREE.ShaderMaterial({
      name: 'ShamanRestorativeWater',
      uniforms: {
        uTime: { value: 0 },
        uMotion: { value: 1 },
        uSunWorld: { value: SUN_DIR.clone() },
      },
      vertexShader: `
        attribute vec3 aFrom, aTo, aTint, aAccent;
        attribute vec4 aLife;
        uniform float uTime, uMotion;
        varying vec3 vNormal, vView, vTint, vAccent;
        varying vec2 vUv;
        varying float vAge, vValid;
        const float PI = 3.14159265;
        ${SHAMAN_WATER_VERTEX}
        void main() {
          float age = (uTime - aLife.x) / max(0.01, aLife.y);
          float u = uv.x;
          float angle = uv.y * 2.0 * PI;
          vec3 delta = aTo - aFrom;
          // Primary links arc across allies; recipient sheets pour downward.
          float link = aLife.w;
          float lift = mix(0.12, min(1.8, 0.35 + length(delta.xz) * 0.14), link);
          vec3 center = mix(aFrom, aTo, u) + vec3(0.0, sin(u * PI) * lift, 0.0);
          vec3 tangent = normalize(delta + vec3(0.0, cos(u * PI) * PI * lift, 0.001));
          vec3 side = normalize(cross(tangent, abs(tangent.y) > 0.97 ? vec3(1,0,0) : vec3(0,1,0)));
          vec3 up = normalize(cross(side, tangent));
          // Flatten the cross-section into a moving sheet, with a thick meniscus.
          float breadth = mix(2.8, 1.25, link);
          float thickness = mix(0.16, 0.42, link);
          float wave = sin(u * 15.0 - age * 11.0 * uMotion + angle * 2.0);
          float pulse = wave * 0.65 + sin(u * 29.0 + angle * 3.0 - age * 8.0 * uMotion) * 0.35;
          vec3 normal = normalize(side * cos(angle) / breadth + up * sin(angle) / thickness);
          vec3 section = side * cos(angle) * breadth + up * sin(angle) * thickness;
          float taper = pow(max(0.0, sin(u * PI)), mix(0.16, 0.35, link));
          center += up * wave * sin(u * PI) * mix(0.11, 0.065, link);
          float life = smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.62, 1.0, age));
          vec3 point = center + section * aLife.z * taper * (1.0 + 0.18 * pulse) * life;
          vFlow = aFlow;
          if (aFlow > 0.5) {
            float across = uv.y*2.0-1.0;
            point = shamanWaterPoint(u,across,age);
            vec3 du = shamanWaterPoint(min(1.0,u+0.002),across,age)-shamanWaterPoint(max(0.0,u-0.002),across,age);
            vec3 dv = shamanWaterPoint(u,across+0.002,age)-shamanWaterPoint(u,across-0.002,age);
            normal = normalize(cross(du,dv)+vec3(0.0000001));
          }
          vec4 view = modelViewMatrix * vec4(point, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vView = -view.xyz;
          vTint = aTint; vAccent = aAccent; vUv = uv; vAge = age;
          vValid = step(0.0, age) * (1.0 - step(1.0, age)) * step(0.01, aLife.y);
          gl_Position = projectionMatrix * view;
        }`,
      fragmentShader: `${SCENE_SAMPLE_GLSL}
        uniform float uMotion;
        uniform vec3 uSunWorld;
        varying vec3 vNormal, vView, vTint, vAccent;
        varying vec2 vUv;
        varying float vAge, vValid;
        ${SHAMAN_WATER_FRAGMENT}
        void main() {
          if (vValid < 0.5) discard;
          vec3 normal = normalize(vNormal);
          float fresnel = pow(max(0.0, 1.0 - abs(dot(normal, normalize(vView)))), 3.0);
          vec3 lightDirection = normalize((viewMatrix * vec4(uSunWorld, 0.0)).xyz);
          float light = max(0.0, dot(normal, lightDirection));
          float along = vUv.x * 28.0 - vAge * 13.0 * uMotion;
          float wave = sin(along + sin(vUv.y * 13.0 + along * 0.37) * 2.2);
          float breakup = sin(along * 1.71 + vUv.y * 31.0) * sin(vUv.y * 17.0 - along * 0.43);
          float foam = pow(max(0.0, wave), 18.0) * smoothstep(-0.1, 0.65, breakup);
          float meniscus = pow(max(0.0, fresnel), 1.7) * (0.3 + 0.7 * smoothstep(-0.3, 0.7, wave));
          vec3 halfVector = lightDirection + normalize(vView);
          halfVector *= inversesqrt(max(dot(halfVector, halfVector), 0.000001));
          float glint = pow(max(0.0, dot(normal, halfVector)), 48.0);
          vec3 body = vTint * (0.38 + light * 0.76) * (0.82 + wave * 0.18);
          vec3 colour = mix(body, vAccent * 1.35, meniscus * 0.65) + vAccent * (foam * 0.85 + glint * 1.5);
          float fade = smoothstep(0.0, 0.1, vAge) * (1.0 - smoothstep(0.6, 1.0, vAge));
          colour = sceneRefract(colour, normal.xy * 7.0 * uMotion, vView.z, (1.0-fresnel)*0.38*uMotion);
          gl_FragColor = vec4(colour, (0.58 + fresnel * 0.28) * fade * sceneSoftness(vView.z, 0.3));
          if (vFlow > 0.5) gl_FragColor = shamanWaterSurface(normal,normalize(vView),lightDirection);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.unbind = bindSceneSamples(scene, this.mesh);
    this.mesh.name = 'restorativeWaterVolumes';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 5;
    this.mesh.userData.renderCategory = 'vfx';
    scene.add(this.mesh);
  }

  spawn(
    from: SeqPoint,
    to: SeqPoint,
    tint: number,
    accent: number,
    width: number,
    duration = 0.8,
    priority: 0 | 1 = 0,
    flow: ShamanWaterFlow = 0,
  ): void {
    if (
      this.disposed ||
      ![from.x, from.y, from.z, to.x, to.y, to.z, width, duration].every(Number.isFinite)
    )
      return;
    if (
      duration <= 0 ||
      width <= 0 ||
      Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) < 0.001
    )
      return;
    let slot = -1;
    for (let i = 0; i < CAPACITY; i++) {
      if (this.ends[i] <= this.time) {
        slot = i;
        break;
      }
      // Actual chain links outrank recipient decoration. Even an expiring
      // link remains intact while a decorative fold can yield its slot.
      if (this.priorities[i] > priority) continue;
      if (
        slot < 0 ||
        this.priorities[i] < this.priorities[slot] ||
        (this.priorities[i] === this.priorities[slot] && this.ends[i] < this.ends[slot])
      )
        slot = i;
    }
    if (slot < 0) return;
    this.priorities[slot] = priority;
    const flowAttribute = this.mesh.geometry.getAttribute(
      'aFlow',
    ) as THREE.InstancedBufferAttribute;
    flowAttribute.setX(slot, flow);
    flowAttribute.addUpdateRange(slot, 1);
    flowAttribute.needsUpdate = true;
    const set = (name: string, x: number, y: number, z: number) => {
      const attr = this.mesh.geometry.getAttribute(name) as THREE.InstancedBufferAttribute;
      attr.setXYZ(slot, x, y, z);
      attr.addUpdateRange(slot * 3, 3);
      attr.needsUpdate = true;
    };
    set('aFrom', from.x, from.y, from.z);
    set('aTo', to.x, to.y, to.z);
    this.color.setHex(tint);
    set('aTint', this.color.r, this.color.g, this.color.b);
    this.color.setHex(accent);
    set('aAccent', this.color.r, this.color.g, this.color.b);
    const life = this.mesh.geometry.getAttribute('aLife') as THREE.InstancedBufferAttribute;
    const span = Math.min(2, duration);
    life.setXYZW(slot, this.time, span, Math.min(0.4, width), priority);
    life.addUpdateRange(slot * 4, 4);
    life.needsUpdate = true;
    this.ends[slot] = this.time + span;
    this.mesh.visible = true;
  }

  update(dt: number, reducedMotion: boolean): void {
    if (this.disposed) return;
    this.time += Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.mesh.material.uniforms.uTime.value = this.time;
    this.mesh.material.uniforms.uMotion.value = reducedMotion ? 0 : 1;
    let active = false;
    for (let i = 0; i < CAPACITY; i++) if (this.ends[i] > this.time) active = true;
    this.mesh.visible = active;
  }
  clear(): void {
    this.ends.fill(0);
    this.priorities.fill(0);
    const life = this.mesh.geometry.getAttribute('aLife') as THREE.InstancedBufferAttribute;
    life.array.fill(0);
    life.clearUpdateRanges();
    life.addUpdateRange(0, CAPACITY * 4);
    life.needsUpdate = true;
    this.mesh.visible = false;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mesh.visible = false;
    const errors: unknown[] = [];
    const release = (work: () => void): void => {
      try {
        work();
      } catch (error) {
        errors.push(error);
      }
    };
    release(() => this.clear());
    release(this.unbind);
    release(() => this.mesh.removeFromParent());
    release(() => this.mesh.geometry.dispose());
    release(() => this.mesh.material.dispose());
    if (errors.length) throw new AggregateError(errors, 'Restorative water cleanup failed');
  }
}
