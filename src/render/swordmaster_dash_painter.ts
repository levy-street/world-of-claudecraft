import * as THREE from 'three';
import type { SwordmasterDashVisualPlan } from './swordmaster_fx_core';

interface DashSlot {
  readonly root: THREE.Group;
  readonly trail: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly particles: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly afterimages: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>[];
  elapsed: number;
  duration: number;
  effectKey: string | null;
}

const DASH_POOL_SIZE = 4;
const PARTICLE_CAPACITY = 28;
const AFTERIMAGE_CAPACITY = 3;

const TRAIL_VERTEX_SHADER = /* glsl */ `
  varying vec2 vDashUv;

  void main() {
    vDashUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const TRAIL_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uProgress;
  uniform vec3 uColor;
  varying vec2 vDashUv;

  void main() {
    float across = abs(vDashUv.y - 0.5) * 2.0;
    float core = 1.0 - smoothstep(0.04, 0.56, across);
    float edge = 1.0 - smoothstep(0.28, 1.0, across);
    float ends =
      smoothstep(0.0, 0.06, vDashUv.x) * (1.0 - smoothstep(0.72, 1.0, vDashUv.x));
    float streak = pow(
      0.5 + 0.5 * sin(vDashUv.x * 46.0 - uTime * 31.0 + across * 5.0),
      5.0
    );
    float fade = pow(max(0.0, 1.0 - uProgress), 1.25);
    float alpha = (edge * (0.28 + streak * 0.5) + core * 0.82) * ends * fade;
    if (alpha < 0.008) discard;
    vec3 hot = vec3(0.72, 0.96, 1.0) * core * 1.5;
    gl_FragColor = vec4(uColor * (1.25 + streak * 0.8) + hot, alpha);
  }
`;

const PARTICLE_VERTEX_SHADER = /* glsl */ `
  attribute vec3 aVelocity;
  attribute float aPhase;
  attribute float aSize;
  uniform float uTime;
  uniform float uProgress;
  varying float vAlpha;

  void main() {
    vec3 drifted = position + aVelocity * uTime;
    vec4 mvPosition = modelViewMatrix * vec4(drifted, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = max(1.0, aSize * (350.0 / max(1.0, -mvPosition.z)));
    float flicker = 0.72 + 0.28 * sin(aPhase * 17.0 + uTime * 24.0);
    vAlpha = pow(max(0.0, 1.0 - uProgress), 1.45) * flicker;
  }
`;

const PARTICLE_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;

  void main() {
    float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
    float halo = 1.0 - smoothstep(0.12, 1.0, radius);
    float core = 1.0 - smoothstep(0.0, 0.24, radius);
    float alpha = (halo * 0.75 + core) * vAlpha;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(uColor * 2.1 + vec3(0.78, 0.97, 1.0) * core * 1.7, alpha);
  }
`;

function trailGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions = new THREE.BufferAttribute(new Float32Array(8 * 3), 3);
  positions.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positions);
  geometry.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1], 2),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  return geometry;
}

function particleGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions = new THREE.BufferAttribute(new Float32Array(PARTICLE_CAPACITY * 3), 3);
  const velocities = new THREE.BufferAttribute(new Float32Array(PARTICLE_CAPACITY * 3), 3);
  positions.setUsage(THREE.DynamicDrawUsage);
  velocities.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positions);
  geometry.setAttribute('aVelocity', velocities);
  geometry.setAttribute(
    'aPhase',
    new THREE.BufferAttribute(new Float32Array(PARTICLE_CAPACITY), 1),
  );
  geometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(PARTICLE_CAPACITY), 1));
  geometry.setDrawRange(0, 0);
  return geometry;
}

function setPoint(
  attribute: THREE.BufferAttribute,
  index: number,
  x: number,
  y: number,
  z: number,
): void {
  attribute.setXYZ(index, x, y, z);
}

function writeTrail(
  geometry: THREE.BufferGeometry,
  start: THREE.Vector3,
  end: THREE.Vector3,
  width: number,
): void {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const distance = Math.max(1e-4, Math.hypot(dx, dz));
  const sideX = -dz / distance;
  const sideZ = dx / distance;
  const halfWidth = width * 0.5;
  const halfHeight = width * 0.44;
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;

  setPoint(positions, 0, start.x - sideX * halfWidth, start.y, start.z - sideZ * halfWidth);
  setPoint(positions, 1, end.x - sideX * halfWidth, end.y, end.z - sideZ * halfWidth);
  setPoint(positions, 2, end.x + sideX * halfWidth, end.y, end.z + sideZ * halfWidth);
  setPoint(positions, 3, start.x + sideX * halfWidth, start.y, start.z + sideZ * halfWidth);
  setPoint(positions, 4, start.x, start.y - halfHeight, start.z);
  setPoint(positions, 5, end.x, end.y - halfHeight, end.z);
  setPoint(positions, 6, end.x, end.y + halfHeight, end.z);
  setPoint(positions, 7, start.x, start.y + halfHeight, start.z);
  positions.needsUpdate = true;
  geometry.boundingBox = null;
  geometry.boundingSphere = null;
}

function writeParticles(
  geometry: THREE.BufferGeometry,
  start: THREE.Vector3,
  end: THREE.Vector3,
  plan: SwordmasterDashVisualPlan,
): void {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const distance = Math.max(1e-4, Math.hypot(dx, dz));
  const forwardX = dx / distance;
  const forwardZ = dz / distance;
  const sideX = -forwardZ;
  const sideZ = forwardX;
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const velocities = geometry.getAttribute('aVelocity') as THREE.BufferAttribute;
  const phases = geometry.getAttribute('aPhase') as THREE.BufferAttribute;
  const sizes = geometry.getAttribute('aSize') as THREE.BufferAttribute;

  for (let i = 0; i < plan.particleCount; i++) {
    const t = (i + 0.45) / plan.particleCount;
    const side = ((((i * 7) % 13) / 12) * 2 - 1) * plan.width * 0.43;
    const rise = (((i * 5) % 9) / 8 - 0.28) * plan.width * 0.62;
    setPoint(
      positions,
      i,
      start.x + dx * t + sideX * side,
      start.y + dy * t + rise,
      start.z + dz * t + sideZ * side,
    );
    const scatter = ((((i * 11) % 17) / 16) * 2 - 1) * plan.width * 0.72;
    setPoint(
      velocities,
      i,
      -forwardX * (0.75 + (i % 4) * 0.18) + sideX * scatter,
      0.35 + (i % 5) * 0.14,
      -forwardZ * (0.75 + (i % 4) * 0.18) + sideZ * scatter,
    );
    phases.setX(i, (i + 0.5) / plan.particleCount);
    sizes.setX(i, plan.width * (0.09 + (i % 4) * 0.018));
  }
  positions.needsUpdate = true;
  velocities.needsUpdate = true;
  phases.needsUpdate = true;
  sizes.needsUpdate = true;
  geometry.setDrawRange(0, plan.particleCount);
  geometry.boundingBox = null;
  geometry.boundingSphere = null;
}

/** Pooled, render-only SwordMaster dash trails. The path endpoints come from
 * the old rendered anchor and the new authoritative sim anchor, so collision-
 * shortened lunges leave exactly the distance the character really covered. */
export class SwordmasterDashPainter {
  private readonly slots: DashSlot[] = [];
  private readonly afterimageGeometry = new THREE.RingGeometry(0.54, 0.82, 24, 1, -0.9, 1.8);
  private nextSlot = 0;

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < DASH_POOL_SIZE; i++) {
      const root = new THREE.Group();
      root.visible = false;
      root.userData.swordmasterDash = true;
      root.userData.renderCategory = 'vfx';

      const trailMaterial = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uProgress: { value: 0 },
          uColor: { value: new THREE.Color() },
        },
        vertexShader: TRAIL_VERTEX_SHADER,
        fragmentShader: TRAIL_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const trail = new THREE.Mesh(trailGeometry(), trailMaterial);
      trail.visible = false;
      trail.frustumCulled = false;
      trail.renderOrder = 4;
      trail.userData.swordmasterDashLayer = 'trail';
      root.add(trail);

      const particlesMaterial = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uProgress: { value: 0 },
          uColor: { value: new THREE.Color() },
        },
        vertexShader: PARTICLE_VERTEX_SHADER,
        fragmentShader: PARTICLE_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      });
      const particles = new THREE.Points(particleGeometry(), particlesMaterial);
      particles.visible = false;
      particles.frustumCulled = false;
      particles.renderOrder = 5;
      particles.userData.swordmasterDashLayer = 'particles';
      root.add(particles);

      const afterimages: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>[] = [];
      for (let image = 0; image < AFTERIMAGE_CAPACITY; image++) {
        const material = new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          depthWrite: false,
          depthTest: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(this.afterimageGeometry, material);
        mesh.visible = false;
        mesh.renderOrder = 4;
        mesh.userData.swordmasterDashLayer = 'afterimage';
        root.add(mesh);
        afterimages.push(mesh);
      }

      scene.add(root);
      this.slots.push({
        root,
        trail,
        particles,
        afterimages,
        elapsed: 0,
        duration: 0,
        effectKey: null,
      });
    }
  }

  paint(
    plan: SwordmasterDashVisualPlan,
    sourceId: number,
    start: THREE.Vector3,
    end: THREE.Vector3,
  ): void {
    if (start.distanceToSquared(end) < 0.25) return;
    const effectKey = `${sourceId}:${plan.abilityId}:${start.x.toFixed(2)}:${start.z.toFixed(2)}:${end.x.toFixed(2)}:${end.z.toFixed(2)}`;
    if (this.slots.some((slot) => slot.root.visible && slot.effectKey === effectKey)) return;

    const slot = this.slots[this.nextSlot];
    this.nextSlot = (this.nextSlot + 1) % this.slots.length;
    slot.elapsed = 0;
    slot.duration = plan.duration;
    slot.effectKey = effectKey;
    slot.root.visible = true;
    slot.trail.visible = true;
    slot.particles.visible = true;
    writeTrail(slot.trail.geometry, start, end, plan.width);
    writeParticles(slot.particles.geometry, start, end, plan);
    for (const material of [slot.trail.material, slot.particles.material]) {
      material.uniforms.uTime.value = 0;
      material.uniforms.uProgress.value = 0;
      (material.uniforms.uColor.value as THREE.Color).setHex(plan.color);
    }

    const facing = Math.atan2(end.x - start.x, end.z - start.z);
    for (let i = 0; i < slot.afterimages.length; i++) {
      const image = slot.afterimages[i];
      const visible = i < plan.afterimages;
      image.visible = visible;
      if (!visible) continue;
      const t = (i + 1) / (plan.afterimages + 1);
      image.position.lerpVectors(start, end, t);
      image.rotation.set(0, facing, (i % 2 === 0 ? 1 : -1) * 0.48);
      image.scale.setScalar(plan.width * (0.78 + i * 0.12));
      image.material.color.setHex(plan.color);
      image.material.opacity = 0.72 - i * 0.1;
    }
  }

  update(dt: number): void {
    for (const slot of this.slots) {
      if (!slot.root.visible) continue;
      slot.elapsed += dt;
      const progress = Math.min(1, slot.elapsed / slot.duration);
      if (progress >= 1) {
        slot.root.visible = false;
        slot.trail.visible = false;
        slot.particles.visible = false;
        for (const image of slot.afterimages) image.visible = false;
        slot.effectKey = null;
        continue;
      }
      slot.trail.material.uniforms.uTime.value = slot.elapsed;
      slot.trail.material.uniforms.uProgress.value = progress;
      slot.particles.material.uniforms.uTime.value = slot.elapsed;
      slot.particles.material.uniforms.uProgress.value = progress;
      const fade = (1 - progress) ** 1.35;
      for (let i = 0; i < slot.afterimages.length; i++) {
        const image = slot.afterimages[i];
        if (!image.visible) continue;
        image.material.opacity = (0.72 - i * 0.1) * fade;
        image.scale.multiplyScalar(1 + dt * 0.75);
      }
    }
  }

  dispose(): void {
    for (const slot of this.slots) {
      slot.root.removeFromParent();
      slot.trail.geometry.dispose();
      slot.trail.material.dispose();
      slot.particles.geometry.dispose();
      slot.particles.material.dispose();
      for (const image of slot.afterimages) image.material.dispose();
    }
    this.afterimageGeometry.dispose();
  }
}
