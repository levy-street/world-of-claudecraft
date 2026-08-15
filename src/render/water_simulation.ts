import * as THREE from 'three';
import { GFX } from './gfx';
import {
  advanceWaterSchedule,
  snapWaterFieldOrigin,
  WATER_IMPULSE_CAPACITY,
  WATER_MAX_GLOBAL_PASSES_PER_FRAME,
  WATER_MAX_STEPS_PER_FRAME,
  WATER_SCHEDULE_SLEEP,
  WATER_SCHEDULE_WAKE,
  type WaterFieldPlan,
  type WaterScheduleState,
  waterFieldNeedsReanchor,
  waterFieldPlan,
} from './water_core';

const IMPULSE_CAPACITY = WATER_IMPULSE_CAPACITY;
const WAVE_FADE_SECONDS = 1.25;

export interface WaterWaveUniforms {
  uWaveState: THREE.IUniform<THREE.Texture>;
  uWaveEnabled: THREE.IUniform<number>;
  /** World-space min corner of the field window. */
  uWaveOrigin: THREE.IUniform<THREE.Vector2>;
  /** World-space side length of the field window. */
  uWaveSize: THREE.IUniform<number>;
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
  uniform vec2 uOrigin;
  uniform float uFieldSize;
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

    vec2 worldPoint = uOrigin + vUv * uFieldSize;
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

    // The field is a WINDOW on a continuous surface, not a closed lake: absorb
    // at the rim so an outgoing wake leaves instead of reflecting back inward
    // as a phantom ripple from the edge of a region the player cannot see.
    float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float interior = smoothstep(0.0, 0.12, edge);
    velocity *= mix(0.55, 1.0, interior);
    height *= mix(0.72, 1.0, interior);

    float invSpan = 0.5 / max(uCellSize, 0.001);
    vec2 slope = vec2(east - west, north - south) * invSpan;
    gl_FragColor = vec4(
      clamp(height, -0.65, 0.65),
      clamp(velocity, -0.24, 0.24),
      clamp(slope, vec2(-0.5), vec2(0.5))
    );
  }
`;

// Re-anchoring shifts the window in world space. The state is resampled at an
// integer texel offset (the anchor is snapped to the lattice), so waves keep
// their world position; texels scrolled in from outside start calm.
const SCROLL_FRAG = /* glsl */ `
  precision highp float;

  uniform sampler2D uInput;
  uniform vec2 uShift;
  varying vec2 vUv;

  void main() {
    vec2 source = vUv + uShift;
    if (any(lessThan(source, vec2(0.0))) || any(greaterThan(source, vec2(1.0)))) {
      gl_FragColor = vec4(0.0);
      return;
    }
    gl_FragColor = texture2D(uInput, source);
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
 * Persistent wave state for the open surface: ONE tier-bounded height field
 * anchored near the camera, rather than one field per declared lake. The world
 * water is continuous (per-zone strips plus the horizon apron), so there is no
 * lake list to key fields off; a single window follows the camera, is scrolled
 * on re-anchor, advances at a fixed rate, and performs no draws while asleep.
 */
export class WaterSimulation {
  readonly enabled: boolean;
  readonly uniforms: WaterWaveUniforms;

  private readonly plan: WaterFieldPlan;
  private readonly zeroTexture: THREE.DataTexture;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.OrthographicCamera;
  private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly stepMaterial: THREE.ShaderMaterial;
  private readonly scrollMaterial: THREE.ShaderMaterial;
  private readonly impulseEndpoints: THREE.Vector4[];
  private readonly impulseShapes: THREE.Vector4[];
  private readonly pending: WaterImpulse[];
  private readonly damping: number;
  private readonly waveCoefficient: number;
  private readonly stepSeconds: number;

  /** Live scheduler state, mutated in place by advanceWaterSchedule (water_core). */
  private readonly schedule: WaterScheduleState;

  private targets: TargetPair | null = null;
  private needsReset = true;
  private anchored = false;
  private lastTime = -1;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.enabled = supportsSimulation(renderer);
    this.plan = waterFieldPlan(GFX.waterTier);
    this.stepSeconds = 1 / this.plan.stepHz;
    const propagationDistance = 10.5 * this.stepSeconds;
    this.damping = 0.74 ** this.stepSeconds;
    this.waveCoefficient = Math.min(
      0.38,
      (propagationDistance * propagationDistance) / (this.plan.cellSize * this.plan.cellSize),
    );

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

    this.uniforms = {
      uWaveState: { value: this.zeroTexture },
      uWaveEnabled: { value: 0 },
      uWaveOrigin: { value: new THREE.Vector2() },
      uWaveSize: { value: this.plan.size },
    };

    this.schedule = {
      active: false,
      pendingCount: 0,
      accumulator: 0,
      awakeUntil: 0,
      stepSeconds: this.stepSeconds,
    };
    this.pending = Array.from({ length: IMPULSE_CAPACITY }, () => ({
      fromX: 0,
      fromZ: 0,
      toX: 0,
      toZ: 0,
      axisX: 0,
      axisZ: 0,
      radius: 0,
      strength: 0,
    }));
    this.impulseEndpoints = Array.from({ length: IMPULSE_CAPACITY }, () => new THREE.Vector4());
    this.impulseShapes = Array.from({ length: IMPULSE_CAPACITY }, () => new THREE.Vector4());

    this.stepMaterial = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: STEP_FRAG,
      uniforms: {
        uInput: { value: this.zeroTexture },
        uTexel: {
          value: new THREE.Vector2(1 / this.plan.resolution, 1 / this.plan.resolution),
        },
        uOrigin: { value: new THREE.Vector2() },
        uFieldSize: { value: this.plan.size },
        uCellSize: { value: this.plan.cellSize },
        uDamping: { value: this.damping },
        uWaveCoefficient: { value: this.waveCoefficient },
        uImpulseCount: { value: 0 },
        uImpulseEndpoints: { value: this.impulseEndpoints },
        uImpulseShapes: { value: this.impulseShapes },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NoBlending,
    });
    this.scrollMaterial = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: SCROLL_FRAG,
      uniforms: {
        uInput: { value: this.zeroTexture },
        uShift: { value: new THREE.Vector2() },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NoBlending,
    });

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.stepMaterial);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    if (this.enabled) this.prewarm();
  }

  addSplash(x: number, z: number, radius: number, strength = 1): void {
    this.enqueue(x, z, x, z, 0, 0, radius, -0.16 * clamp(strength, 0.15, 1.8));
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
    const safeHalfLength = clamp(halfLength, 0, 1.6);
    const axisScale = safeHalfLength / Math.max(Math.hypot(axisX, axisZ), 0.0001);
    this.enqueue(
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
    const amplitude = 0.075 * clamp(strength, 0.2, 1.8);
    const safeHalfLength = clamp(halfLength, 0, 1.6);
    const axisScale = safeHalfLength / Math.max(Math.hypot(axisX, axisZ), 0.0001);
    const shapeX = axisX * axisScale;
    const shapeZ = axisZ * axisScale;
    const fromInside = this.insideField(oldX, oldZ);
    const toInside = this.insideField(x, z);
    if (fromInside && toInside) {
      this.enqueue(oldX, oldZ, x, z, shapeX, shapeZ, radius, amplitude);
      return;
    }
    // Only one endpoint is in the window: press or refill that end alone, so a
    // contact crossing the boundary never drags a full-width trough across it.
    if (fromInside) this.enqueue(oldX, oldZ, oldX, oldZ, shapeX, shapeZ, radius, amplitude);
    if (toInside) this.enqueue(x, z, x, z, shapeX, shapeZ, radius, -amplitude);
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
    const safeHalfLength = clamp(halfLength, 0, 1.6);
    const axisScale = safeHalfLength / Math.max(Math.hypot(axisX, axisZ), 0.0001);
    this.enqueue(
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

  update(time: number, cameraX: number, cameraZ: number): number {
    if (!this.enabled) return 0;
    if (this.lastTime < 0) this.lastTime = time;
    const dt = clamp(time - this.lastTime, 0, 0.1);
    this.lastTime = time;

    let passes = 0;
    if (this.reanchor(cameraX, cameraZ)) passes++;

    // The window is anchored ON the camera, so it is visible whenever water is
    // drawn at all; sleep is driven by "nothing has disturbed it", not by fog.
    const transition = advanceWaterSchedule(this.schedule, true, time, dt);
    if ((transition & WATER_SCHEDULE_SLEEP) !== 0) {
      this.sleep();
      return passes;
    }
    if ((transition & WATER_SCHEDULE_WAKE) !== 0) this.uniforms.uWaveEnabled.value = 1;
    if (!this.schedule.active) return passes;
    if (this.schedule.pendingCount === 0) {
      this.uniforms.uWaveEnabled.value = clamp(
        (this.schedule.awakeUntil - time) / WAVE_FADE_SECONDS,
        0,
        1,
      );
    }

    let steps = 0;
    while (
      passes < WATER_MAX_GLOBAL_PASSES_PER_FRAME &&
      steps < WATER_MAX_STEPS_PER_FRAME &&
      this.schedule.accumulator >= this.stepSeconds
    ) {
      this.step(steps === 0);
      this.schedule.accumulator -= this.stepSeconds;
      steps++;
      passes++;
    }
    return passes;
  }

  reset(): void {
    this.lastTime = -1;
    this.anchored = false;
    this.sleep();
  }

  dispose(): void {
    if (this.targets) {
      this.targets.read.dispose();
      this.targets.write.dispose();
      this.targets = null;
    }
    this.quad.geometry.dispose();
    this.stepMaterial.dispose();
    this.scrollMaterial.dispose();
    this.zeroTexture.dispose();
  }

  private insideField(x: number, z: number): boolean {
    const origin = this.uniforms.uWaveOrigin.value;
    return (
      this.anchored &&
      x >= origin.x &&
      x <= origin.x + this.plan.size &&
      z >= origin.y &&
      z <= origin.y + this.plan.size
    );
  }

  /** Re-centers the window on the camera. Returns true when a scroll pass ran. */
  private reanchor(cameraX: number, cameraZ: number): boolean {
    const origin = this.uniforms.uWaveOrigin.value;
    const half = this.plan.size * 0.5;
    const centerX = origin.x + half;
    const centerZ = origin.y + half;
    if (
      this.anchored &&
      !waterFieldNeedsReanchor(cameraX, cameraZ, centerX, centerZ, this.plan.size)
    ) {
      return false;
    }
    const nextX = snapWaterFieldOrigin(cameraX - half, this.plan.cellSize);
    const nextZ = snapWaterFieldOrigin(cameraZ - half, this.plan.cellSize);
    if (this.anchored && nextX === origin.x && nextZ === origin.y) return false;

    const wasAnchored = this.anchored;
    const shiftX = (nextX - origin.x) / this.plan.size;
    const shiftZ = (nextZ - origin.y) / this.plan.size;
    origin.set(nextX, nextZ);
    this.anchored = true;
    // Nothing to carry over: an unanchored or sleeping field is already calm.
    if (!wasAnchored || !this.schedule.active || this.needsReset) return false;
    this.ensureTargets();
    if (!this.targets) return false;
    this.scroll(shiftX, shiftZ);
    return true;
  }

  private scroll(shiftX: number, shiftZ: number): void {
    if (!this.targets) return;
    this.scrollMaterial.uniforms.uInput.value = this.targets.read.texture;
    this.scrollMaterial.uniforms.uShift.value.set(shiftX, shiftZ);
    this.quad.material = this.scrollMaterial;
    const previousTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.targets.write);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(previousTarget);
    this.quad.material = this.stepMaterial;
    this.swap();
  }

  private sleep(): void {
    this.schedule.active = false;
    this.schedule.accumulator = 0;
    this.schedule.pendingCount = 0;
    this.needsReset = true;
    this.uniforms.uWaveEnabled.value = 0;
    this.uniforms.uWaveState.value = this.zeroTexture;
  }

  private enqueue(
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
    // A disturbance outside the window has nowhere to land: the field only
    // covers the camera's neighbourhood, and clamping it to the rim would
    // paint a wake against the border where nothing happened.
    if (!this.insideField(toX, toZ) && !this.insideField(fromX, fromZ)) return;
    const index = Math.min(this.schedule.pendingCount, IMPULSE_CAPACITY - 1);
    const impulse = this.pending[index];
    impulse.fromX = fromX;
    impulse.fromZ = fromZ;
    impulse.toX = toX;
    impulse.toZ = toZ;
    impulse.axisX = axisX;
    impulse.axisZ = axisZ;
    impulse.radius = clamp(radius, this.plan.cellSize * 0.8, 2.8);
    impulse.strength = strength;
    this.schedule.pendingCount = Math.min(IMPULSE_CAPACITY, this.schedule.pendingCount + 1);
  }

  private ensureTargets(): void {
    if (this.targets) return;
    const options: THREE.RenderTargetOptions = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    };
    const resolution = this.plan.resolution;
    const read = new THREE.WebGLRenderTarget(resolution, resolution, options);
    const write = new THREE.WebGLRenderTarget(resolution, resolution, options);
    read.texture.name = 'water-wave-state-a';
    write.texture.name = 'water-wave-state-b';
    this.targets = { read, write };
  }

  private prewarm(): void {
    this.renderer.compile(this.scene, this.camera);
    this.ensureTargets();
    this.clearState();
  }

  private clearState(): void {
    if (!this.targets) return;
    const previousTarget = this.renderer.getRenderTarget();
    const previousColor = new THREE.Color();
    this.renderer.getClearColor(previousColor);
    const previousAlpha = this.renderer.getClearAlpha();
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setRenderTarget(this.targets.read);
    this.renderer.clear();
    this.renderer.setRenderTarget(this.targets.write);
    this.renderer.clear();
    this.renderer.setRenderTarget(previousTarget);
    this.renderer.setClearColor(previousColor, previousAlpha);
    this.uniforms.uWaveState.value = this.targets.read.texture;
    this.needsReset = false;
  }

  private swap(): void {
    if (!this.targets) return;
    const previousRead = this.targets.read;
    this.targets.read = this.targets.write;
    this.targets.write = previousRead;
    this.uniforms.uWaveState.value = this.targets.read.texture;
  }

  private step(injectPending: boolean): void {
    this.ensureTargets();
    if (this.needsReset) this.clearState();
    if (!this.targets) return;
    const impulseCount = injectPending ? this.schedule.pendingCount : 0;
    for (let i = 0; i < IMPULSE_CAPACITY; i++) {
      const impulse = this.pending[i];
      if (i < impulseCount && impulse) {
        this.impulseEndpoints[i].set(impulse.fromX, impulse.fromZ, impulse.toX, impulse.toZ);
        this.impulseShapes[i].set(impulse.axisX, impulse.axisZ, impulse.radius, impulse.strength);
      } else {
        this.impulseEndpoints[i].set(0, 0, 0, 0);
        this.impulseShapes[i].set(0, 0, 0, 0);
      }
    }
    if (injectPending) this.schedule.pendingCount = 0;

    const uniforms = this.stepMaterial.uniforms;
    uniforms.uInput.value = this.targets.read.texture;
    uniforms.uOrigin.value.copy(this.uniforms.uWaveOrigin.value);
    uniforms.uFieldSize.value = this.plan.size;
    uniforms.uImpulseCount.value = impulseCount;

    const previousTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.targets.write);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(previousTarget);
    this.swap();
  }
}
