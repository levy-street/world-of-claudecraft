import * as THREE from 'three';
import type { WeaponAuraFlowPlan, WeaponAuraPlan } from './weapon_aura_core';

export interface WeaponAuraHandle {
  readonly meshCount: number;
  readonly flowCount: number;
  update(dt: number): void;
  dispose(): void;
}

interface FlowClock {
  readonly uniform: { value: number };
  readonly phase: number;
}

interface BladeFrame {
  readonly start: THREE.Vector3;
  readonly end: THREE.Vector3;
  readonly sideA: THREE.Vector3;
  readonly sideB: THREE.Vector3;
  readonly length: number;
}

const AURA_VERTEX_SHADER = /* glsl */ `
  varying vec2 vAuraUv;

  void main() {
    vAuraUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const AURA_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uColor;
  varying vec2 vAuraUv;

  float auraHash(vec2 point) {
    return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float auraNoise(vec2 point) {
    vec2 cell = floor(point);
    vec2 local = fract(point);
    local = local * local * (3.0 - 2.0 * local);
    float a = auraHash(cell);
    float b = auraHash(cell + vec2(1.0, 0.0));
    float c = auraHash(cell + vec2(0.0, 1.0));
    float d = auraHash(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
  }

  void main() {
    float y = clamp(vAuraUv.y, 0.0, 1.0);
    float radial = abs(vAuraUv.x - 0.5) * 2.0;
    float arc = pow(max(0.0, sin(3.14159265 * y)), 0.28);
    float broadFlow = auraNoise(vec2(radial * 2.8 + uTime * 0.7, y * 9.0 - uTime * 3.6));
    float fineFlow = auraNoise(vec2(radial * 5.5 - uTime * 1.1, y * 18.0 - uTime * 6.5));
    float edgeWave = (broadFlow - 0.5) * 0.2 + sin(y * 19.0 - uTime * 7.0) * 0.035;
    float edge = mix(0.22, 0.98, arc) + edgeWave * (1.0 - y * 0.35);
    float body = 1.0 - smoothstep(edge - 0.18, edge + 0.04, radial);
    float core = 1.0 - smoothstep(0.04, 0.46, radial);
    float stream = smoothstep(0.3, 0.9, broadFlow) * 0.7 + fineFlow * 0.3;
    float wisp = pow(0.5 + 0.5 * sin(y * 31.0 - uTime * 9.0 - radial * 7.0), 3.0);
    float rootFade = smoothstep(0.0, 0.09, y);
    float tipFade = 1.0 - smoothstep(0.78, 1.0, y);
    float alpha =
      (body * (0.38 + stream * 0.34 + wisp * 0.1) + core * 0.58) *
      rootFade * tipFade * uOpacity;
    if (alpha < 0.008) discard;

    vec3 hotCore = vec3(0.72, 0.96, 1.0) * core * 1.65;
    vec3 turquoiseEdge = vec3(0.14, 1.0, 0.74) * body * (1.0 - core) * 0.38;
    vec3 glow = uColor * (1.28 + stream * 0.62 + wisp * 0.2) + hotCore + turquoiseEdge;
    gl_FragColor = vec4(glow, alpha);
  }
`;

const FLOW_VERTEX_SHADER = /* glsl */ `
  attribute float aPhase;
  attribute float aAngle;
  attribute float aRadius;
  attribute float aPulse;
  uniform float uTime;
  uniform float uSpeed;
  uniform float uWidth;
  uniform float uSize;
  uniform vec3 uStart;
  uniform vec3 uEnd;
  uniform vec3 uSideA;
  uniform vec3 uSideB;
  varying float vAlpha;

  void main() {
    float progress = fract(aPhase + uTime * uSpeed);
    float travelFade =
      smoothstep(0.0, 0.11, progress) * (1.0 - smoothstep(0.76, 1.0, progress));
    float orbitAngle = aAngle + progress * 8.5 + uTime * 2.2;
    float orbitRadius = uWidth * aRadius * sin(3.14159265 * progress);
    vec3 orbit =
      uSideA * cos(orbitAngle) * orbitRadius +
      uSideB * sin(orbitAngle) * orbitRadius;
    vec3 localPosition = mix(uStart, uEnd, progress) + orbit;
    vec4 mvPosition = modelViewMatrix * vec4(localPosition, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = max(
      1.0,
      uSize * (340.0 / max(1.0, -mvPosition.z)) * (0.72 + aPulse * 0.55)
    );
    vAlpha = travelFade * (0.72 + aPulse * 0.28);
  }
`;

const FLOW_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;

  void main() {
    float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
    float halo = 1.0 - smoothstep(0.12, 1.0, radius);
    float core = 1.0 - smoothstep(0.0, 0.24, radius);
    float alpha = (halo * 0.72 + core) * vAlpha;
    if (alpha < 0.01) discard;
    vec3 color = uColor * 2.15 + vec3(0.78, 0.97, 1.0) * core * 1.8;
    gl_FragColor = vec4(color, alpha);
  }
`;

class PaintedWeaponAura implements WeaponAuraHandle {
  private elapsed = 0;

  constructor(
    private readonly roots: THREE.Object3D[],
    private readonly materials: THREE.Material[],
    private readonly geometries: THREE.BufferGeometry[],
    private readonly clocks: FlowClock[],
    readonly meshCount: number,
  ) {}

  get flowCount(): number {
    return this.clocks.length;
  }

  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.elapsed = (this.elapsed + dt) % 4096;
    for (const clock of this.clocks) clock.uniform.value = this.elapsed + clock.phase;
  }

  dispose(): void {
    for (const root of this.roots) root.removeFromParent();
    for (const material of this.materials) material.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    this.roots.length = 0;
    this.materials.length = 0;
    this.geometries.length = 0;
    this.clocks.length = 0;
  }
}

function axisValue(vector: THREE.Vector3, axis: number): number {
  return axis === 0 ? vector.x : axis === 1 ? vector.y : vector.z;
}

function setAxisValue(vector: THREE.Vector3, axis: number, value: number): void {
  if (axis === 0) vector.x = value;
  else if (axis === 1) vector.y = value;
  else vector.z = value;
}

function bladeFrame(geometry: THREE.BufferGeometry): BladeFrame | null {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return null;
  const size = box.getSize(new THREE.Vector3());
  const length = Math.max(size.x, size.y, size.z);
  if (length <= 1e-4) return null;
  const axis = size.x === length ? 0 : size.y === length ? 1 : 2;
  const min = axisValue(box.min, axis);
  const max = axisValue(box.max, axis);
  // Weapon models are authored with the blade tip on the positive long axis.
  // For mirrored or offset variants, prefer the end furthest from local zero.
  const tipIsMax = Math.abs(max) >= Math.abs(min);
  const startCoord = tipIsMax ? min + length * 0.2 : max - length * 0.2;
  const endCoord = tipIsMax ? max + length * 0.08 : min - length * 0.08;
  const center = box.getCenter(new THREE.Vector3());
  const start = center.clone();
  const end = center.clone();
  setAxisValue(start, axis, startCoord);
  setAxisValue(end, axis, endCoord);
  const sideA = new THREE.Vector3();
  const sideB = new THREE.Vector3();
  setAxisValue(sideA, (axis + 1) % 3, 1);
  setAxisValue(sideB, (axis + 2) % 3, 1);
  return { start, end, sideA, sideB, length };
}

function bladeScore(mesh: THREE.Mesh): number {
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  if (!box) return 0;
  const size = box.getSize(new THREE.Vector3());
  return Math.max(size.x, size.y, size.z);
}

function crossedEnvelopeGeometry(frame: BladeFrame, width: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const halfWidth = width * 0.5;

  for (const side of [frame.sideA, frame.sideB]) {
    const base = positions.length / 3;
    const a = frame.start.clone().addScaledVector(side, -halfWidth);
    const b = frame.start.clone().addScaledVector(side, halfWidth);
    const c = frame.end.clone().addScaledVector(side, halfWidth);
    const d = frame.end.clone().addScaledVector(side, -halfWidth);
    for (const point of [a, b, c, d]) positions.push(point.x, point.y, point.z);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function flowGeometry(count: number): THREE.BufferGeometry {
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const angles = new Float32Array(count);
  const radii = new Float32Array(count);
  const pulses = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    phases[i] = (i + 0.35) / count;
    angles[i] = i * 2.399963 + (i % 2) * 0.41;
    radii[i] = 0.16 + ((i * 7) % 5) * 0.045;
    pulses[i] = 0.25 + ((i * 11) % 7) / 8;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('aAngle', new THREE.BufferAttribute(angles, 1));
  geometry.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
  geometry.setAttribute('aPulse', new THREE.BufferAttribute(pulses, 1));
  return geometry;
}

function markAuraObject(
  object: THREE.Object3D,
  plan: WeaponAuraPlan,
  layer: 'root' | 'shell' | 'envelope' | 'flow',
): void {
  object.userData.weaponVfxMesh = true;
  object.userData.weaponAuraId = plan.id;
  object.userData.weaponAuraLayer = layer;
}

function addFlowRig(
  root: THREE.Group,
  geometry: THREE.BufferGeometry,
  plan: WeaponAuraPlan,
  flow: WeaponAuraFlowPlan,
  phase: number,
  materials: THREE.Material[],
  geometries: THREE.BufferGeometry[],
): FlowClock | null {
  const frame = bladeFrame(geometry);
  if (!frame) return null;
  const width = frame.length * flow.envelopeWidth;
  const clock = { value: phase };

  const envelopeGeometry = crossedEnvelopeGeometry(frame, width);
  const envelopeMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: clock,
      uOpacity: { value: flow.envelopeOpacity },
      uColor: { value: new THREE.Color(plan.color) },
    },
    vertexShader: AURA_VERTEX_SHADER,
    fragmentShader: AURA_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const envelope = new THREE.Mesh(envelopeGeometry, envelopeMaterial);
  envelope.renderOrder = 4;
  markAuraObject(envelope, plan, 'envelope');
  root.add(envelope);

  const particlesGeometry = flowGeometry(flow.particleCount);
  const particlesMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: clock,
      uSpeed: { value: flow.speed },
      uWidth: { value: width },
      uSize: { value: flow.particleSize },
      uStart: { value: frame.start },
      uEnd: { value: frame.end },
      uSideA: { value: frame.sideA },
      uSideB: { value: frame.sideB },
      uColor: { value: new THREE.Color(plan.color) },
    },
    vertexShader: FLOW_VERTEX_SHADER,
    fragmentShader: FLOW_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const particles = new THREE.Points(particlesGeometry, particlesMaterial);
  particles.frustumCulled = false;
  particles.renderOrder = 5;
  markAuraObject(particles, plan, 'flow');
  root.add(particles);

  materials.push(envelopeMaterial, particlesMaterial);
  geometries.push(envelopeGeometry, particlesGeometry);
  return { uniform: clock, phase };
}

/** Paint additive weapon shells and, when authored by the pure plan, a broad
 * crossed flame envelope with deterministic hilt-to-tip particle streams. All
 * VFX nodes follow the live weapon graph and own only their small materials and
 * procedural geometries. */
export function paintWeaponAura(model: THREE.Object3D, plan: WeaponAuraPlan): WeaponAuraHandle {
  const slots = new Set(plan.slots);
  const holders: THREE.Object3D[] = [];
  model.traverse((object) => {
    if (
      (object.userData.swapWeaponHolder || object.userData.swapOffhandHolder) &&
      slots.has(object.userData.heldSlot as number)
    ) {
      holders.push(object);
    }
  });

  const roots: THREE.Object3D[] = [];
  const materials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const clocks: FlowClock[] = [];
  let meshCount = 0;
  let flowIndex = 0;

  for (const holder of holders) {
    const weapons: THREE.Mesh[] = [];
    holder.traverse((object) => {
      const weapon = object as THREE.Mesh;
      if (weapon.isMesh && weapon.userData.weaponMesh && weapon.parent) weapons.push(weapon);
    });
    let flowWeapon: THREE.Mesh | null = null;
    if (plan.flow) {
      for (const weapon of weapons) {
        if (!flowWeapon || bladeScore(weapon) > bladeScore(flowWeapon)) flowWeapon = weapon;
      }
    }

    for (const weapon of weapons) {
      const root = new THREE.Group();
      root.position.copy(weapon.position);
      root.quaternion.copy(weapon.quaternion);
      root.scale.copy(weapon.scale);
      markAuraObject(root, plan, 'root');

      const shellMaterial = new THREE.MeshBasicMaterial({
        color: plan.color,
        transparent: true,
        opacity: plan.opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const shell = new THREE.Mesh(weapon.geometry, shellMaterial);
      shell.scale.setScalar(plan.scale);
      shell.renderOrder = 3;
      markAuraObject(shell, plan, 'shell');
      root.add(shell);
      materials.push(shellMaterial);
      meshCount++;

      if (plan.flow && weapon === flowWeapon) {
        const phase = flowIndex * 0.37;
        const flowClock = addFlowRig(
          root,
          weapon.geometry,
          plan,
          plan.flow,
          phase,
          materials,
          geometries,
        );
        if (flowClock) {
          clocks.push(flowClock);
          flowIndex++;
        }
      }

      weapon.parent?.add(root);
      roots.push(root);
    }
  }
  return new PaintedWeaponAura(roots, materials, geometries, clocks, meshCount);
}
