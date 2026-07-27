import * as THREE from 'three';
import { GFX } from './gfx';
import {
  advanceWaterSchedule,
  WATER_IMPULSE_CAPACITY,
  WATER_MAX_GLOBAL_PASSES_PER_FRAME,
  WATER_MAX_STEPS_PER_FRAME,
  WATER_SCHEDULE_SLEEP,
  WATER_SCHEDULE_WAKE,
  waterResidentBodyBudget,
  waterSimulationPlan,
} from './water_core';

const IMPULSE_CAPACITY = WATER_IMPULSE_CAPACITY;
const WAVE_FADE_SECONDS = 1.25;

export interface WaterWaveUniforms {
  uWaveState: THREE.IUniform<THREE.Texture>;
  uWaveEnabled: THREE.IUniform<number>;
}

interface WaterBody {
  x: number;
  z: number;
  radius: number;
}

interface WaterImpulse {
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  axisX: number;
  axisZ: number;
  radius: number;
  strength: number;
}

interface TargetPair {
  read: THREE.WebGLRenderTarget;
  write: THREE.WebGLRenderTarget;
  resolution: number;
}

interface BodyState {
  body: WaterBody;
  resolution: number;
  stepSeconds: number;
  cellSize: number;
  damping: number;
  waveCoefficient: number;
  uniforms: WaterWaveUniforms;
  targets: TargetPair | null;
  pending: WaterImpulse[];
  pendingCount: number;
  accumulator: number;
  awakeUntil: number;
  active: boolean;
  needsReset: boolean;
  stepsThisFrame: number;
  visible: boolean;
}

const FULLSCREEN_VERT = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const STEP_FRAG = /* glsl */ `
  precision highp float;

  uniform sampler2D uInput;
  uniform vec2 uTexel;
  uniform vec2 uCenter;
  uniform float uRadius;
  uniform float uCellSize;
  uniform float uDamping;
  uniform float uWaveCoefficient;
  uniform int uImpulseCount;
  uniform vec4 uImpulseEndpoints[${IMPULSE_CAPACITY}];
  uniform vec4 uImpulseShapes[${IMPULSE_CAPACITY}];
  varying vec2 vUv;

  float capsuleProfile(vec2 point, vec2 center, vec2 axis, float radius) {
    vec2 offset = point - center;
    float axisSq = dot(axis, axis);
    float along = clamp(dot(offset, axis) / max(axisSq, 0.0001), -1.0, 1.0);
    float radial = max(0.0, 1.0 - length(offset - axis * along) / max(radius, 0.05));
    return radial * radial * (3.0 - 2.0 * radial);
  }

  void main() {
    vec4 state = texture2D(uInput, vUv);
    float height = state.r;
    float velocity = state.g;
    float east = texture2D(uInput, vUv + vec2(uTexel.x, 0.0)).r;
    float west = texture2D(uInput, vUv - vec2(uTexel.x, 0.0)).r;
    float north = texture2D(uInput, vUv + vec2(0.0, uTexel.y)).r;
    float south = texture2D(uInput, vUv - vec2(0.0, uTexel.y)).r;
    float laplacian = east + west + north + south - 4.0 * height;

    velocity = (velocity + laplacian * uWaveCoefficient) * uDamping;
    height += velocity;

    vec2 worldPoint = uCenter + (vUv - 0.5) * (uRadius * 2.0);
    float impact = 0.0;
    for (int i = 0; i < ${IMPULSE_CAPACITY}; i++) {
      if (i >= uImpulseCount) break;
      vec4 endpoints = uImpulseEndpoints[i];
      vec4 shape = uImpulseShapes[i];
      vec2 motion = endpoints.zw - endpoints.xy;
      float newVolume = capsuleProfile(worldPoint, endpoints.zw, shape.xy, shape.z);
      if (dot(motion, motion) > 0.000001) {
        float oldVolume = capsuleProfile(worldPoint, endpoints.xy, shape.xy, shape.z);
        impact += (oldVolume - newVolume) * shape.w;
      } else {
        impact += newVolume * shape.w;
      }
    }
    height += impact;

    float lakeDistance = length((vUv - 0.5) * 2.0);
    if (lakeDistance >= 1.0) {
      height = 0.0;
      velocity = 0.0;
    } else {
      float shore = 1.0 - smoothstep(0.76, 0.98, lakeDistance);
      velocity *= mix(0.68, 1.0, shore);
      height *= mix(0.92, 1.0, shore);
    }

    float invSpan = 0.5 / max(uCellSize, 0.001);
    vec2 slope = vec2(east - west, north - south) * invSpan;
    gl_FragColor = vec4(
      clamp(height, -0.65, 0.65),
      clamp(velocity, -0.24, 0.24),
      clamp(slope, vec2(-0.5), vec2(0.5))
    );
  }
`;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function supportsSimulation(renderer: THREE.WebGLRenderer): boolean {
  return (
    GFX.standardMaterials &&
    renderer.capabilities.isWebGL2 &&
    renderer.capabilities.maxVertexTextures > 0 &&
    renderer.extensions.has('EXT_color_buffer_float')
  );
}

/**
 * Persistent wave state for the declared lakes. A tier-bounded target pool is
 * allocated and cleared during setup, advances at a fixed rate, and performs
 * no draws while asleep. Every target has the same tier size, so assigning a
 * mixed-radius lake never allocates or resizes GPU attachments on contact.
 */
export class WaterSimulation {
  readonly enabled: boolean;

  private readonly zeroTexture: THREE.DataTexture;
  private readonly states: BodyState[];
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.OrthographicCamera;
  private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly material: THREE.ShaderMaterial;
  private readonly impulseEndpoints: THREE.Vector4[];
  private readonly impulseShapes: THREE.Vector4[];
  private readonly maxResidentBodies: number;
  private readonly targetPairs: TargetPair[] = [];
  private readonly freeTargets: TargetPair[] = [];
  private lastTime = -1;
  private fairnessCursor = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    bodies: readonly WaterBody[],
  ) {
    this.enabled = supportsSimulation(renderer);
    this.maxResidentBodies = waterResidentBodyBudget(GFX.tier);
    this.zeroTexture = new THREE.DataTexture(
      new Uint8Array([0, 0, 0, 0]),
      1,
      1,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    this.zeroTexture.minFilter = THREE.NearestFilter;
    this.zeroTexture.magFilter = THREE.NearestFilter;
    this.zeroTexture.generateMipmaps = false;
    this.zeroTexture.needsUpdate = true;
    this.zeroTexture.name = 'water-wave-zero';

    this.states = bodies.map((body) => {
      const plan = waterSimulationPlan(body.radius, GFX.tier);
      const cellSize = (body.radius * 2) / plan.resolution;
      const stepSeconds = 1 / plan.stepHz;
      const propagationDistance = 10.5 * stepSeconds;
      return {
        body,
        resolution: plan.resolution,
        stepSeconds,
        cellSize,
        damping: 0.74 ** stepSeconds,
        waveCoefficient: Math.min(
          0.38,
          (propagationDistance * propagationDistance) / (cellSize * cellSize),
        ),
        uniforms: {
          uWaveState: { value: this.zeroTexture },
          uWaveEnabled: { value: 0 },
        },
        targets: null,
        pending: Array.from({ length: IMPULSE_CAPACITY }, () => ({
          fromX: 0,
          fromZ: 0,
          toX: 0,
          toZ: 0,
          axisX: 0,
          axisZ: 0,
          radius: 0,
          strength: 0,
        })),
        pendingCount: 0,
        accumulator: 0,
        awakeUntil: 0,
        active: false,
        needsReset: true,
        stepsThisFrame: 0,
        visible: false,
      };
    });

    this.impulseEndpoints = Array.from({ length: IMPULSE_CAPACITY }, () => new THREE.Vector4());
    this.impulseShapes = Array.from({ length: IMPULSE_CAPACITY }, () => new THREE.Vector4());
    this.material = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: STEP_FRAG,
      uniforms: {
        uInput: { value: this.zeroTexture },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uCenter: { value: new THREE.Vector2() },
        uRadius: { value: 1 },
        uCellSize: { value: 1 },
        uDamping: { value: 0.99 },
        uWaveCoefficient: { value: 0.1 },
        uImpulseCount: { value: 0 },
        uImpulseEndpoints: { value: this.impulseEndpoints },
        uImpulseShapes: { value: this.impulseShapes },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NoBlending,
    });
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    if (this.enabled) this.prewarmPool();
  }

  uniforms(bodyIndex: number): WaterWaveUniforms {
    return this.states[bodyIndex].uniforms;
  }

  addSplash(x: number, z: number, radius: number, strength = 1): void {
    const bodyIndex = this.bodyAt(x, z);
    if (bodyIndex < 0) return;
    this.enqueue(bodyIndex, x, z, x, z, 0, 0, radius, -0.16 * clamp(strength, 0.15, 1.8));
  }

  enterContact(
    x: number,
    z: number,
    radius: number,
    halfLength: number,
    axisX: number,
    axisZ: number,
    strength = 1,
  ): void {
    const bodyIndex = this.bodyAt(x, z);
    if (bodyIndex < 0) return;
    const safeHalfLength = clamp(halfLength, 0, 1.6);
    const axisScale = safeHalfLength / Math.max(Math.hypot(axisX, axisZ), 0.0001);
    this.enqueue(
      bodyIndex,
      x,
      z,
      x,
      z,
      axisX * axisScale,
      axisZ * axisScale,
      radius,
      -0.13 * clamp(strength, 0.15, 1.8),
    );
  }

  moveContact(
    oldX: number,
    oldZ: number,
    x: number,
    z: number,
    radius: number,
    halfLength: number,
    axisX: number,
    axisZ: number,
    strength = 1,
  ): void {
    const oldBodyIndex = this.bodyAt(oldX, oldZ);
    const bodyIndex = this.bodyAt(x, z);
    const amplitude = 0.075 * clamp(strength, 0.2, 1.8);
    const safeHalfLength = clamp(halfLength, 0, 1.6);
    const axisScale = safeHalfLength / Math.max(Math.hypot(axisX, axisZ), 0.0001);
    const shapeX = axisX * axisScale;
    const shapeZ = axisZ * axisScale;
    if (oldBodyIndex >= 0 && oldBodyIndex === bodyIndex) {
      this.enqueue(bodyIndex, oldX, oldZ, x, z, shapeX, shapeZ, radius, amplitude);
      return;
    }
    if (oldBodyIndex >= 0) {
      this.enqueue(oldBodyIndex, oldX, oldZ, oldX, oldZ, shapeX, shapeZ, radius, amplitude);
    }
    if (bodyIndex >= 0) {
      this.enqueue(bodyIndex, x, z, x, z, shapeX, shapeZ, radius, -amplitude);
    }
  }

  releaseContact(
    x: number,
    z: number,
    radius: number,
    halfLength: number,
    axisX: number,
    axisZ: number,
    strength = 1,
  ): void {
    const bodyIndex = this.bodyAt(x, z);
    if (bodyIndex < 0) return;
    const safeHalfLength = clamp(halfLength, 0, 1.6);
    const axisScale = safeHalfLength / Math.max(Math.hypot(axisX, axisZ), 0.0001);
    this.enqueue(
      bodyIndex,
      x,
      z,
      x,
      z,
      axisX * axisScale,
      axisZ * axisScale,
      radius,
      0.09 * clamp(strength, 0.15, 1.8),
    );
  }

  update(time: number, visibleBodies: readonly boolean[]): number {
    if (!this.enabled || this.states.length === 0) return 0;
    if (this.lastTime < 0) this.lastTime = time;
    const dt = clamp(time - this.lastTime, 0, 0.1);
    this.lastTime = time;

    for (let i = 0; i < this.states.length; i++) {
      const state = this.states[i];
      state.visible = visibleBodies[i] !== false;
      state.stepsThisFrame = 0;
      const schedule = advanceWaterSchedule(state, state.visible, time, dt);
      if ((schedule & WATER_SCHEDULE_SLEEP) !== 0) {
        this.sleep(state);
        continue;
      }
      if ((schedule & WATER_SCHEDULE_WAKE) !== 0) state.uniforms.uWaveEnabled.value = 1;
      if (!state.active) continue;
      if (state.pendingCount === 0) {
        state.uniforms.uWaveEnabled.value = clamp(
          (state.awakeUntil - time) / WAVE_FADE_SECONDS,
          0,
          1,
        );
      }
    }

    let passes = 0;
    let inspected = 0;
    const maxInspections = this.states.length * WATER_MAX_STEPS_PER_FRAME;
    while (passes < WATER_MAX_GLOBAL_PASSES_PER_FRAME && inspected < maxInspections) {
      const index = this.fairnessCursor % this.states.length;
      this.fairnessCursor = (this.fairnessCursor + 1) % this.states.length;
      inspected++;
      const state = this.states[index];
      if (
        !state.active ||
        !state.visible ||
        state.stepsThisFrame >= WATER_MAX_STEPS_PER_FRAME ||
        state.accumulator < state.stepSeconds
      ) {
        continue;
      }
      this.step(state, state.stepsThisFrame === 0);
      state.accumulator -= state.stepSeconds;
      state.stepsThisFrame++;
      passes++;
    }
    return passes;
  }

  reset(): void {
    this.lastTime = -1;
    for (const state of this.states) this.sleep(state);
  }

  dispose(): void {
    for (const targets of this.targetPairs) this.disposeTargetPair(targets);
    this.quad.geometry.dispose();
    this.material.dispose();
    this.zeroTexture.dispose();
  }

  private sleep(state: BodyState): void {
    state.active = false;
    state.needsReset = true;
    state.accumulator = 0;
    state.pendingCount = 0;
    state.uniforms.uWaveEnabled.value = 0;
    state.uniforms.uWaveState.value = this.zeroTexture;
    if (state.targets) {
      const targets = state.targets;
      state.targets = null;
      this.freeTargets.push(targets);
    }
  }

  private bodyAt(x: number, z: number): number {
    let nearest = -1;
    let nearestDistanceSq = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.states.length; i++) {
      const body = this.states[i].body;
      const dx = x - body.x;
      const dz = z - body.z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq <= body.radius * body.radius && distanceSq < nearestDistanceSq) {
        nearest = i;
        nearestDistanceSq = distanceSq;
      }
    }
    return nearest;
  }

  private enqueue(
    bodyIndex: number,
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    axisX: number,
    axisZ: number,
    radius: number,
    strength: number,
  ): void {
    if (!this.enabled) return;
    const state = this.states[bodyIndex];
    const index = Math.min(state.pendingCount, IMPULSE_CAPACITY - 1);
    const impulse = state.pending[index];
    impulse.fromX = fromX;
    impulse.fromZ = fromZ;
    impulse.toX = toX;
    impulse.toZ = toZ;
    impulse.axisX = axisX;
    impulse.axisZ = axisZ;
    impulse.radius = clamp(radius, state.cellSize * 0.8, 2.8);
    impulse.strength = strength;
    state.pendingCount = Math.min(IMPULSE_CAPACITY, state.pendingCount + 1);
  }

  private createTargetPair(resolution: number): TargetPair {
    const options: THREE.RenderTargetOptions = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    };
    const read = new THREE.WebGLRenderTarget(resolution, resolution, options);
    const write = new THREE.WebGLRenderTarget(resolution, resolution, options);
    read.texture.name = 'water-wave-state-a';
    write.texture.name = 'water-wave-state-b';
    const targets = { read, write, resolution };
    this.targetPairs.push(targets);
    return targets;
  }

  private prewarmPool(): void {
    this.renderer.compile(this.scene, this.camera);
    if (this.states.length === 0) return;
    const poolSize = Math.min(this.maxResidentBodies, this.states.length);
    for (let i = 0; i < poolSize; i++) {
      this.freeTargets.push(this.createTargetPair(this.states[i].resolution));
    }
    const previousTarget = this.renderer.getRenderTarget();
    const previousColor = new THREE.Color();
    this.renderer.getClearColor(previousColor);
    const previousAlpha = this.renderer.getClearAlpha();
    this.renderer.setClearColor(0x000000, 0);
    for (const targets of this.freeTargets) {
      this.renderer.setRenderTarget(targets.read);
      this.renderer.clear();
      this.renderer.setRenderTarget(targets.write);
      this.renderer.clear();
    }
    this.renderer.setRenderTarget(previousTarget);
    this.renderer.setClearColor(previousColor, previousAlpha);
  }

  private ensureTargets(state: BodyState): void {
    if (state.targets) return;
    let targets: TargetPair | undefined;
    for (let i = 0; i < this.freeTargets.length; i++) {
      if (this.freeTargets[i].resolution !== state.resolution) continue;
      targets = this.freeTargets[i];
      const last = this.freeTargets.pop();
      if (last && i < this.freeTargets.length) this.freeTargets[i] = last;
      break;
    }
    if (!targets) targets = this.freeTargets.pop();
    if (!targets) {
      let candidate: BodyState | null = null;
      for (const other of this.states) {
        if (other === state || !other.targets || other.stepsThisFrame > 0) continue;
        if (
          !candidate ||
          (other.pendingCount === 0 && candidate.pendingCount > 0) ||
          (other.pendingCount === candidate.pendingCount && other.awakeUntil < candidate.awakeUntil)
        ) {
          candidate = other;
        }
      }
      if (!candidate) return;
      this.sleep(candidate);
      targets = this.freeTargets.pop();
    }
    if (!targets) return;
    state.targets = targets;
  }

  private clearState(state: BodyState): void {
    if (!state.targets) return;
    const previousTarget = this.renderer.getRenderTarget();
    const previousColor = new THREE.Color();
    this.renderer.getClearColor(previousColor);
    const previousAlpha = this.renderer.getClearAlpha();
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setRenderTarget(state.targets.read);
    this.renderer.clear();
    this.renderer.setRenderTarget(state.targets.write);
    this.renderer.clear();
    this.renderer.setRenderTarget(previousTarget);
    this.renderer.setClearColor(previousColor, previousAlpha);
    state.uniforms.uWaveState.value = state.targets.read.texture;
    state.needsReset = false;
  }

  private disposeTargetPair(targets: TargetPair): void {
    targets.read.dispose();
    targets.write.dispose();
  }

  private step(state: BodyState, injectPending: boolean): void {
    this.ensureTargets(state);
    if (state.needsReset) this.clearState(state);
    if (!state.targets) return;
    const impulseCount = injectPending ? state.pendingCount : 0;
    for (let i = 0; i < IMPULSE_CAPACITY; i++) {
      const impulse = state.pending[i];
      if (i < impulseCount && impulse) {
        this.impulseEndpoints[i].set(impulse.fromX, impulse.fromZ, impulse.toX, impulse.toZ);
        this.impulseShapes[i].set(impulse.axisX, impulse.axisZ, impulse.radius, impulse.strength);
      } else {
        this.impulseEndpoints[i].set(0, 0, 0, 0);
        this.impulseShapes[i].set(0, 0, 0, 0);
      }
    }
    if (injectPending) state.pendingCount = 0;

    const uniforms = this.material.uniforms;
    uniforms.uInput.value = state.targets.read.texture;
    uniforms.uTexel.value.set(1 / state.resolution, 1 / state.resolution);
    uniforms.uCenter.value.set(state.body.x, state.body.z);
    uniforms.uRadius.value = state.body.radius;
    uniforms.uCellSize.value = state.cellSize;
    uniforms.uDamping.value = state.damping;
    uniforms.uWaveCoefficient.value = state.waveCoefficient;
    uniforms.uImpulseCount.value = impulseCount;

    const previousTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(state.targets.write);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(previousTarget);

    const previousRead = state.targets.read;
    state.targets.read = state.targets.write;
    state.targets.write = previousRead;
    state.uniforms.uWaveState.value = state.targets.read.texture;
  }
}
