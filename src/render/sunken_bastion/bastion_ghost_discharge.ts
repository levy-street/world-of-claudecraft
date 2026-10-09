// Cosmetic punctuation for the haunted broadside and boarding stroke. Two
// fixed instanced draws, prepared with BastionFx: additive fire/embers and
// translucent soul smoke. No lights, canvas textures or per-frame objects.
import * as THREE from 'three';
import type { GhostLaneKind } from './bastion_ghost_fx_core';

const BURSTS = 8;
const FIRE_PER_BURST = 15;
const SMOKE_PER_BURST = 8;
const LIFE = 1.15;
const VERT = /* glsl */ `
attribute vec4 aDischarge;
varying vec2 vUv;
varying vec4 vFx;
void main() {
  vUv = uv;
  vFx = aDischarge;
  // The origin is camera-relative through modelViewMatrix; particle centres
  // are small offsets from the local player, never 100,000-yard attributes.
  vec4 centre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  centre.xy += position.xy * vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
  gl_Position = projectionMatrix * centre;
}
`;
const FRAG = /* glsl */ `
uniform float uSmoke;
varying vec2 vUv;
varying vec4 vFx;
float noise(vec2 p) {
  return sin(p.x * 7.3 + sin(p.y * 6.1)) * sin(p.y * 5.7 + sin(p.x * 4.3));
}
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float radius = length(p);
  float angle = atan(p.y, p.x);
  float curl = noise(p * 1.6 + vec2(vFx.y, -vFx.x * 2.0));
  float alpha;
  vec3 color;
  if (uSmoke > 0.5) {
    float edge = 1.0 - smoothstep(0.35, 1.0, radius + curl * 0.15);
    alpha = edge * (0.65 + curl * 0.25) * vFx.w;
    color = mix(vec3(0.035, 0.15, 0.16), vec3(0.24, 0.64, 0.52), 0.5 + curl * 0.5);
  } else {
    float rays = pow(abs(cos(angle * 7.0 + vFx.y)), 12.0);
    float flame = max(0.0, 1.0 - radius * (2.2 - rays * 1.35));
    float core = pow(max(0.0, 1.0 - radius), 5.0);
    float collar = exp(-pow((radius - 0.68 - curl * 0.045) * 18.0, 2.0));
    float shape = mix(flame + core, collar, vFx.z);
    alpha = shape * vFx.w;
    color = mix(vec3(0.12, 1.35, 0.85), vec3(2.8, 3.0, 2.3), min(1.0, core * 2.5));
  }
  gl_FragColor = vec4(color, alpha);
  #include <colorspace_fragment>
}
`;

interface Burst {
  id: number;
  age: number;
  kind: GhostLaneKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  length: number;
}
interface Batch {
  mesh: THREE.InstancedMesh;
  geometry: THREE.PlaneGeometry;
  material: THREE.ShaderMaterial;
  fx: THREE.InstancedBufferAttribute;
}

function batch(parent: THREE.Group, smoke: boolean, count: number): Batch {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const fx = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  fx.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aDischarge', fx);
  const material = new THREE.ShaderMaterial({
    name: 'bastionGhostDischarge',
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: { uSmoke: { value: smoke ? 1 : 0 } },
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    blending: smoke ? THREE.NormalBlending : THREE.AdditiveBlending,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = smoke ? 'ghost-discharge-smoke' : 'ghost-discharge-fire';
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  parent.add(mesh);
  return { mesh, geometry, material, fx };
}

export class BastionGhostDischarge {
  private readonly slots: Burst[] = [];
  private readonly fire: Batch;
  private readonly smoke: Batch;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();

  constructor(parent: THREE.Group) {
    this.fire = batch(parent, false, BURSTS * FIRE_PER_BURST);
    this.smoke = batch(parent, true, BURSTS * SMOKE_PER_BURST);
    for (let i = 0; i < BURSTS; i++)
      this.slots.push({ id: -1, age: 0, kind: 'broadside', x: 0, y: 0, z: 0, yaw: 0, length: 0 });
  }

  /** Object clocks reconstruct an impact received halfway through its life.
   *  Repeated snapshots cannot restart a live burst. A saturated pool sheds
   *  cosmetics only, never stealing an existing slot or its gameplay tell. */
  observe(
    id: number,
    kind: GhostLaneKind,
    x: number,
    y: number,
    z: number,
    yaw: number,
    length: number,
    elapsed: number,
  ): void {
    if (kind === 'anchor') return;
    let slot: Burst | undefined;
    for (const candidate of this.slots) {
      if (candidate.id === id) return;
      if (!slot && (candidate.id < 0 || candidate.age >= LIFE)) slot = candidate;
    }
    if (!slot) return;
    slot.id = id;
    slot.kind = kind;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.yaw = yaw;
    slot.length = length;
    slot.age = Math.max(0, elapsed);
  }

  private put(
    target: Batch,
    index: number,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    age: number,
    seed: number,
    ring: number,
    alpha: number,
  ): void {
    this.position.set(x, y, z);
    this.scale.set(width, height, 1);
    this.matrix.compose(this.position, this.rotation, this.scale);
    target.mesh.setMatrixAt(index, this.matrix);
    target.fx.setXYZW(index, age, seed, ring, alpha);
  }

  update(dt: number, origin: { x: number; y: number; z: number }, reducedMotion: boolean): void {
    this.fire.mesh.position.set(origin.x, origin.y, origin.z);
    this.smoke.mesh.position.copy(this.fire.mesh.position);
    let flames = 0;
    let clouds = 0;
    for (const slot of this.slots) {
      if (slot.id < 0) continue;
      slot.age += Math.max(0, dt);
      if (slot.age >= LIFE) continue;
      if (reducedMotion) continue;
      const t = slot.age;
      const ax = Math.sin(slot.yaw);
      const az = Math.cos(slot.yaw);
      const x = slot.x - origin.x;
      const y = slot.y - origin.y;
      const z = slot.z - origin.z;
      if (slot.kind === 'broadside') {
        const flash = Math.max(0, 1 - t / 0.55);
        if (flash > 0) {
          // A tall spiked flare and a thin expanding pressure collar. These
          // stand above the muzzle, not on the safe-gap floor footprint.
          this.put(
            this.fire,
            flames++,
            x,
            y,
            z,
            2.2 + t * 2,
            3.2 + t * 3,
            t,
            slot.id,
            0,
            flash * 0.95,
          );
          this.put(
            this.fire,
            flames++,
            x + ax * t * 3,
            y,
            z + az * t * 3,
            1.2 + t * 5,
            1.2 + t * 5,
            t,
            slot.id,
            1,
            flash * 0.7,
          );
        }
      }
      // Embers or boarding slash echoes along the already-hit lane. All
      // strokes appear together; none suggests delayed travelling damage.
      for (let i = 0; i < 12; i++) {
        const seed = i * 2.399963 + slot.id * 0.17;
        const fade = Math.max(0, 1 - t / (0.5 + (i % 3) * 0.12));
        if (!fade) continue;
        const boarding = slot.kind === 'boarding';
        const along = boarding ? (slot.length * (i + 0.5)) / 12 : t * (2 + i * 0.5);
        const side = Math.sin(seed) * Math.min(1, t * 2.5);
        this.put(
          this.fire,
          flames++,
          x + ax * along + az * side,
          y + t * (1.5 + Math.cos(seed)) - t * t,
          z + az * along - ax * side,
          boarding ? 0.65 : 0.22,
          boarding ? 1.8 * fade : 0.5 * fade,
          t,
          seed,
          0,
          fade * (boarding ? 0.35 : 0.85),
        );
      }
      for (let i = 0; i < SMOKE_PER_BURST; i++) {
        const seed = i * 2.399963 + slot.id * 0.17;
        const boarding = slot.kind === 'boarding';
        const along = boarding
          ? (slot.length * (i + 0.5)) / SMOKE_PER_BURST
          : 0.4 + t * (1 + i * 0.27);
        const side = Math.sin(seed) * (0.2 + t * 0.6);
        const alpha = Math.min(1, t * 8) * Math.max(0, 1 - t / LIFE) * (boarding ? 0.15 : 0.27);
        this.put(
          this.smoke,
          clouds++,
          x + ax * along + az * side,
          y + t * (0.8 + (i % 3) * 0.4),
          z + az * along - ax * side,
          1.0 + t * 1.8,
          1.4 + t * 2.4,
          t,
          seed,
          0,
          alpha,
        );
      }
    }
    this.fire.mesh.count = flames;
    this.smoke.mesh.count = clouds;
    this.fire.mesh.instanceMatrix.needsUpdate = true;
    this.smoke.mesh.instanceMatrix.needsUpdate = true;
    this.fire.fx.needsUpdate = true;
    this.smoke.fx.needsUpdate = true;
  }

  clear(): void {
    for (const slot of this.slots) slot.id = -1;
    this.fire.mesh.count = 0;
    this.smoke.mesh.count = 0;
  }

  dispose(): void {
    for (const target of [this.fire, this.smoke]) {
      target.mesh.removeFromParent();
      target.mesh.dispose();
      target.geometry.dispose();
      target.material.dispose();
    }
  }
}
