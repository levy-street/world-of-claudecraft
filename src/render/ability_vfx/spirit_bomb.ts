import * as THREE from 'three';
import {
  CAST_VFX_ENGINE,
  type CastVfxSpawnGate,
  OPEN_CAST_VFX_SPAWN_GATE,
  tagCastVfxEngine,
} from '../cast_vfx_family';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { spellEffectsMutedBy } from '../spell_effects_switch';
import {
  SPIRIT_BOMB_VISUAL as BOMB,
  bombChargeRadius,
  bombFlightInto,
  bombParticleInto,
} from '../spirit_bomb_visual_core';
import type { VfxAnchorResolver } from '../vfx_anchor';

const VERTEX = `
  varying vec3 vLocal;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vLocal = position;
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }`;

const NOISE = `
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.11, 0.37, 0.73));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise3(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
      mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
      mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }`;

const CORE = `
  uniform float uTime;
  uniform float uAlpha;
  uniform float uPower;
  varying vec3 vLocal;
  varying vec3 vNormal;
  varying vec3 vView;
  ${NOISE}
  void main() {
    vec3 p = normalize(vLocal);
    float t = uTime * 0.24;
    float n = noise3(p * 4.8 + vec3(t, -t * 1.4, t * 0.7));
    float detail = noise3(p * 13.0 - t * 1.7);
    float fracture = noise3(p * 31.0 + vec3(t * 2.0, 0.0, -t));
    float bands = sin(p.y * 16.0 + atan(p.z, p.x) * 3.0 + n * 19.0 + detail * 3.0 - t * 7.0);
    float veins = pow(max(0.0, 1.0 - abs(bands)), 12.0);
    float rim = pow(max(0.0, 1.0 - abs(dot(normalize(vNormal), normalize(vView)))), 2.4);
    float heat = veins * (0.25 + fracture * 1.7) * (0.6 + uPower);
    vec3 col = mix(vec3(0.009,0.003,0.024), vec3(0.11,0.012,0.24), n * n);
    col += vec3(0.52,0.065,1.1) * heat;
    col += vec3(0.38,0.08,0.9) * rim * (1.4 + n);
    col += vec3(1.0,0.68,1.4) * pow(veins, 4.0) * fracture * 1.1;
    gl_FragColor = vec4(col, uAlpha);
  }`;

// The same program serves the airborne corona and the expanding ground pressure
// wave. Its mode is a uniform, so no new program is linked when the bomb lands.
const HALO = `
  uniform float uTime;
  uniform float uAlpha;
  uniform float uMode;
  varying vec3 vLocal;
  varying vec3 vNormal;
  varying vec3 vView;
  ${NOISE}
  void main() {
    float a;
    float angle = atan(vLocal.z, vLocal.x);
    if (uMode > 0.5) {
      float r = length(vLocal.xz);
      float edge = exp(-pow((r - 0.88) * 32.0, 2.0));
      float inner = exp(-pow((r - 0.69) * 45.0, 2.0)) * 0.32;
      a = (edge + inner) * (0.7 + 0.3 * sin(angle * 19.0 + uTime * 2.0));
    } else {
      float f = max(0.0, 1.0 - abs(dot(normalize(vNormal), normalize(vView))));
      float storm = noise3(vLocal * 12.0 + vec3(0.0, -uTime * 0.4, uTime * 0.2));
      a = pow(f, 4.5) * smoothstep(0.22, 0.8, storm);
    }
    a *= uAlpha;
    if (a < 0.005) discard;
    gl_FragColor = vec4(vec3(0.53,0.12,1.2) * (0.7 + a), a);
  }`;

interface BombSlot {
  root: THREE.Group;
  core: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  halo: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  ring: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  particles: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  positions: THREE.BufferAttribute;
  alphas: THREE.BufferAttribute;
  from: THREE.Vector3;
  to: THREE.Vector3;
  center: THREE.Vector3;
  sourceId: number;
  phase: 'idle' | 'charge' | 'flight' | 'impact';
  progress: number;
  age: number;
  stamp: number;
  radius: number;
  priority: boolean;
}

/** Four reusable stage pieces, three shader programs, no live-cast allocation.
 * All drawables are built at engine construction and join its existing compile
 * and spawn gate. The ground radius cue remains owned by the ordinary painter. */
export class SpiritBombs {
  spawnGate: CastVfxSpawnGate = OPEN_CAST_VFX_SPAWN_GATE;
  private readonly slots: BombSlot[] = [];
  private readonly sphere = new THREE.SphereGeometry(1, 48, 32);
  private readonly plane = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  private readonly scratch = new THREE.Vector3();
  private time = 0;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly anchor: VfxAnchorResolver,
    private readonly groundY: (x: number, z: number) => number,
    private readonly onImpact?: (x: number, y: number, z: number) => void,
  ) {
    for (let i = 0; i < BOMB.slots; i++) {
      const coreMaterial = new THREE.ShaderMaterial({
        name: 'tithe-bomb-core',
        uniforms: { uTime: { value: 0 }, uAlpha: { value: 1 }, uPower: { value: 1 } },
        vertexShader: VERTEX,
        fragmentShader: CORE,
        transparent: true,
        depthWrite: false,
      });
      const haloMaterial = new THREE.ShaderMaterial({
        name: 'tithe-bomb-corona',
        uniforms: { uTime: { value: 0 }, uAlpha: { value: 1 }, uMode: { value: 0 } },
        vertexShader: VERTEX,
        fragmentShader: HALO,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const ringMaterial = haloMaterial.clone();
      ringMaterial.uniforms.uMode.value = 1;
      const core = new THREE.Mesh(this.sphere, coreMaterial);
      const halo = new THREE.Mesh(this.sphere, haloMaterial);
      const ring = new THREE.Mesh(this.plane, ringMaterial);
      ring.renderOrder = floorVfxRenderOrder('player');
      const positions = new THREE.BufferAttribute(new Float32Array(BOMB.particles * 3), 3);
      const alphas = new THREE.BufferAttribute(new Float32Array(BOMB.particles), 1);
      positions.setUsage(THREE.DynamicDrawUsage);
      alphas.setUsage(THREE.DynamicDrawUsage);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', positions);
      geometry.setAttribute('aAlpha', alphas);
      const particleMaterial = new THREE.ShaderMaterial({
        name: 'tithe-bomb-motes',
        uniforms: { uAlpha: { value: 1 } },
        vertexShader: `
          attribute float aAlpha;
          varying float vAlpha;
          void main() {
            vAlpha = aAlpha;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = clamp(90.0 / max(1.0, -mv.z), 1.0, 9.0);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          uniform float uAlpha;
          varying float vAlpha;
          void main() {
            vec2 p = gl_PointCoord * 2.0 - 1.0;
            float a = max(0.0, 1.0 - dot(p,p));
            a = a * a * vAlpha * uAlpha;
            if (a < 0.005) discard;
            gl_FragColor = vec4(vec3(0.9,0.37,1.8), a);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const particles = new THREE.Points(geometry, particleMaterial);
      const root = new THREE.Group();
      root.name = `tithe-bomb-${i}`;
      root.visible = false;
      root.add(core, halo, ring, particles);
      for (const drawable of [core, halo, ring, particles]) tagCastVfxEngine(drawable);
      // Dynamic positions stay within the bounded explosion volume.
      geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 14);
      scene.add(root);
      this.slots.push({
        root,
        core,
        halo,
        ring,
        particles,
        positions,
        alphas,
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
        center: new THREE.Vector3(),
        sourceId: -1,
        phase: 'idle',
        progress: 0,
        age: 0,
        stamp: -1,
        radius: 1,
        priority: false,
      });
    }
  }

  hold(entityId: number, progress: number, frame: number, priority = false): boolean {
    if (this.disposed || !this.spawnGate.allows(CAST_VFX_ENGINE)) return false;
    const at = this.anchor(entityId, 1, this.scratch);
    if (!at) return false;
    let slot = this.slots.find((s) => s.phase === 'charge' && s.sourceId === entityId);
    const started = !slot;
    if (!slot) slot = this.slots.find((s) => s.phase === 'idle');
    if (!slot && priority) slot = this.slots.find((s) => !s.priority && s.phase === 'charge');
    if (!slot) return false;
    slot.sourceId = entityId;
    slot.phase = 'charge';
    slot.priority = priority;
    slot.progress = Math.max(0, Math.min(1, progress));
    slot.stamp = frame;
    slot.age = 0;
    slot.radius = bombChargeRadius(slot.progress);
    slot.center.set(at.x, at.y + BOMB.lift, at.z);
    return started;
  }

  release(sourceId: number, targetId: number): boolean {
    if (this.disposed || !this.spawnGate.allows(CAST_VFX_ENGINE)) return false;
    const at = this.anchor(targetId, 0.35, this.scratch);
    if (!at) {
      this.cancel(sourceId);
      return false;
    }
    const slot =
      this.slots.find((s) => s.phase === 'charge' && s.sourceId === sourceId) ??
      this.slots.find((s) => s.phase === 'idle');
    if (!slot) return false;
    slot.to.copy(at);
    if (slot.phase === 'idle') {
      const from = this.anchor(sourceId, 1, this.scratch);
      if (!from) return false;
      slot.center.set(from.x, from.y + BOMB.lift, from.z);
    }
    slot.from.copy(slot.center);
    slot.sourceId = sourceId;
    slot.phase = 'flight';
    slot.age = 0;
    slot.radius = BOMB.radius;
    slot.progress = 1;
    return true;
  }

  cancel(entityId: number): void {
    for (const slot of this.slots) {
      if (slot.sourceId === entityId && slot.phase === 'charge') this.hide(slot);
    }
  }

  update(dt: number, frame: number, reducedMotion = false, quality = 1): void {
    if (this.disposed) return;
    const step = Math.max(0, dt);
    this.time += step;
    for (const slot of this.slots) {
      if (slot.phase === 'idle') continue;
      if (
        !this.spawnGate.allows(CAST_VFX_ENGINE) ||
        spellEffectsMutedBy(slot.sourceId) ||
        (slot.phase === 'charge' && slot.stamp !== frame)
      ) {
        this.hide(slot);
        continue;
      }
      if (slot.phase !== 'charge') slot.age += step;
      if (slot.phase === 'flight') {
        bombFlightInto(slot.center, slot.from, slot.to, slot.age);
        if (slot.age >= BOMB.flight) {
          slot.phase = 'impact';
          slot.age -= BOMB.flight;
          this.onImpact?.(slot.to.x, slot.to.y, slot.to.z);
        }
      }
      if (slot.phase === 'impact' && slot.age >= BOMB.impact) {
        this.hide(slot);
        continue;
      }
      this.paint(slot, reducedMotion, quality);
    }
  }

  private paint(slot: BombSlot, reduced: boolean, quality: number): void {
    const impact = slot.phase === 'impact';
    const p = impact ? slot.age / BOMB.impact : 0;
    const fade = impact ? (1 - p) ** 1.4 : 1;
    const radius = impact
      ? BOMB.radius * (1 + Math.sin(Math.min(1, p * 3) * Math.PI) * 0.75)
      : slot.radius;
    const motion = reduced ? 0 : this.time;
    slot.root.visible = true;
    slot.root.position.copy(slot.center);
    slot.core.visible = !impact || p < 0.4;
    slot.core.scale.setScalar(radius);
    slot.core.material.uniforms.uTime.value = motion;
    slot.core.material.uniforms.uPower.value = slot.progress;
    slot.core.material.uniforms.uAlpha.value = impact ? Math.max(0, 1 - p * 2.5) : 0.97;
    slot.halo.scale.setScalar(radius * (impact ? 1.35 : 1.075));
    slot.halo.material.uniforms.uTime.value = motion;
    slot.halo.material.uniforms.uAlpha.value = fade * (impact ? 0.9 : 0.58);
    slot.ring.visible = impact;
    if (impact) {
      slot.ring.position.y = this.groundY(slot.center.x, slot.center.z) - slot.center.y + 0.09;
      slot.ring.scale.setScalar(BOMB.blastRadius * Math.min(1, p * 2.8));
      slot.ring.material.uniforms.uTime.value = motion;
      slot.ring.material.uniforms.uAlpha.value = fade;
    }
    slot.particles.material.uniforms.uAlpha.value = fade;
    const count = Math.round(48 + (BOMB.particles - 48) * Math.max(0, Math.min(1, quality)));
    slot.particles.geometry.setDrawRange(0, count);
    for (let i = 0; i < count; i++) {
      const alpha = bombParticleInto(
        this.scratch,
        (i * BOMB.particles) / count,
        motion,
        slot.radius,
        impact ? p : -1,
      );
      slot.positions.setXYZ(i, this.scratch.x, this.scratch.y, this.scratch.z);
      slot.alphas.setX(i, alpha * (0.35 + slot.progress * 0.65));
    }
    slot.positions.clearUpdateRanges();
    slot.positions.addUpdateRange(0, count * 3);
    slot.alphas.clearUpdateRanges();
    slot.alphas.addUpdateRange(0, count);
    slot.positions.needsUpdate = true;
    slot.alphas.needsUpdate = true;
  }

  private hide(slot: BombSlot): void {
    slot.phase = 'idle';
    slot.root.visible = false;
    slot.priority = false;
  }

  clear(): void {
    for (const slot of this.slots) this.hide(slot);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    const errors: unknown[] = [];
    const release = (dispose: () => void) => {
      try {
        dispose();
      } catch (error) {
        errors.push(error);
      }
    };
    for (const slot of this.slots) {
      release(() => slot.root.removeFromParent());
      release(() => slot.core.material.dispose());
      release(() => slot.halo.material.dispose());
      release(() => slot.ring.material.dispose());
      release(() => slot.particles.material.dispose());
      release(() => slot.particles.geometry.dispose());
    }
    release(() => this.sphere.dispose());
    release(() => this.plane.dispose());
    if (errors.length) throw new AggregateError(errors, 'Tithe Bomb resource cleanup failed');
  }
}
