import * as THREE from 'three';

const POOL_SIZE = 24;

const WAKE_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const WAKE_FRAGMENT_SHADER = /* glsl */ `
  uniform float uProgress;
  uniform float uKind;
  uniform float uSeed;
  uniform float uStrength;
  varying vec2 vUv;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    // p in [-1, 1]^2 on the horizontal water plane.
    // For uKind == 0 (breaststroke V-wake): -y is forward (swimming direction), +y is trailing wake.
    vec2 p = (vUv - 0.5) * 2.0;
    float prog = clamp(uProgress, 0.0, 1.0);
    float fadeIn = smoothstep(0.0, 0.11, prog);
    float rem = max(0.0, 1.0 - prog);
    float fadeOut = rem * sqrt(rem);
    float env = fadeIn * fadeOut * clamp(uStrength, 0.35, 1.35);

    float foamCore = 0.0;
    float aquaGlow = 0.0;

    if (uKind < 0.5) {
      // --- Mode 0: Genshin Breaststroke V-Wake & Swept Arm-Pull Ribbons ---
      float ax = abs(p.x);
      // 1. Parabolic V-wake bow ribbon wrapping the swimmer's shoulders and trailing back
      float bowCurve = -0.56 + ax * 0.92 + ax * ax * 0.58 - prog * 0.14;
      float bowDist = abs(p.y - bowCurve);
      float bowSpan = smoothstep(0.88, 0.12, ax) * smoothstep(-0.72, -0.42, p.y);
      float waveWobble = sin(ax * 16.0 - prog * 5.0 + uSeed) * 0.022
        + cos((p.y + ax) * 14.0 + uSeed * 1.7) * 0.018;
      float nLace = noise2(vec2(ax * 7.5, (p.y - prog * 0.35) * 6.5 + uSeed));
      float bowWidth = mix(0.055, 0.115, ax) * (1.0 - prog * 0.25);
      float bowBand = (1.0 - smoothstep(bowWidth * 0.32, bowWidth, bowDist + waveWobble)) * bowSpan;
      // Cel-shaded lacy perforation along the trailing edge of the bow wave
      float bowCut = smoothstep(0.28 + prog * 0.26, 0.58 + prog * 0.22, nLace + (1.0 - ax * 0.55) * 0.28);
      foamCore += bowBand * bowCut * 0.95;
      aquaGlow += (1.0 - smoothstep(0.0, bowWidth * 2.1, bowDist)) * bowSpan * 0.55;

      // 2. Paired breaststroke arm-sweep crescent arcs pushing outward and back
      vec2 wingCenter = vec2(0.20 + prog * 0.22, -0.18 + prog * 0.38);
      vec2 wp = vec2(ax, p.y) - wingCenter;
      float wingR = length(vec2(wp.x * 1.15, wp.y * 0.92));
      float wingTarget = 0.26 + prog * 0.34;
      float wingArcMask = smoothstep(0.14, 0.28, ax)
        * (1.0 - smoothstep(0.68, 0.92, ax))
        * smoothstep(-0.48, -0.10, p.y)
        * (1.0 - smoothstep(0.32, 0.78, p.y));
      float wingRing = 1.0 - smoothstep(0.018, 0.075, abs(wingR - wingTarget) + (nLace - 0.5) * 0.035);
      float wingCut = smoothstep(0.32 + prog * 0.25, 0.56 + prog * 0.25, nLace + 0.18);
      foamCore = max(foamCore, wingRing * wingArcMask * wingCut * 0.92);
      aquaGlow = max(aquaGlow, (1.0 - smoothstep(0.0, 0.15, abs(wingR - wingTarget))) * wingArcMask * 0.52);

      // 3. Central lacy bubble & foam wake streaming behind the swimmer
      float trailMask = (1.0 - smoothstep(0.06, 0.42 + prog * 0.16, ax))
        * smoothstep(-0.22, 0.04, p.y)
        * (1.0 - smoothstep(0.38, 0.92, p.y));
      float nTrail = noise2(vec2(p.x * 9.5 + uSeed, (p.y - prog * 0.45) * 8.5));
      float nTrail2 = noise2(vec2(p.x * 16.0 - uSeed, (p.y - prog * 0.3) * 14.0));
      // Stylized anime foam holes (ring-like cellular lace)
      float lace = smoothstep(0.46 + prog * 0.18, 0.64 + prog * 0.18, nTrail * 0.65 + nTrail2 * 0.35);
      float laceRim = smoothstep(0.36, 0.48, nTrail) * (1.0 - smoothstep(0.58, 0.70, nTrail));
      foamCore = max(foamCore, (lace * 0.72 + laceRim * 0.85) * trailMask);
      aquaGlow = max(aquaGlow, trailMask * smoothstep(0.30, 0.58, nTrail) * 0.45);
    } else {
      // --- Mode 1: Genshin Concentric Broken Anime Ripple Rings ---
      float r = length(p);
      float ang = atan(p.y, p.x);
      float nAng = noise2(vec2(cos(ang) * 2.2 + uSeed, sin(ang) * 2.2 - uSeed));

      // Outer expanding crisp broken ring
      float rOuter = 0.32 + prog * 0.58;
      float wOuter = mix(0.048, 0.026, prog);
      float arcWave1 = sin(ang * 3.0 + uSeed * 6.28) * 0.5 + 0.5 * cos(ang * 5.0 - uSeed * 4.1);
      float arcGap1 = smoothstep(-0.18 + prog * 0.28, 0.22 + prog * 0.28, arcWave1 + (nAng - 0.5) * 0.45);
      float ring1 = (1.0 - smoothstep(wOuter * 0.35, wOuter, abs(r - rOuter))) * arcGap1;
      float glow1 = (1.0 - smoothstep(0.0, wOuter * 2.4, abs(r - rOuter))) * arcGap1 * 0.55;

      // Inner secondary harmonic ring (phase-shifted so arcs interleave)
      float rInner = max(0.10, rOuter - 0.19 - prog * 0.06);
      float wInner = mix(0.038, 0.020, prog);
      float arcWave2 = cos(ang * 4.0 - uSeed * 5.1) * 0.5 + 0.5 * sin(ang * 6.0 + uSeed * 3.3);
      float arcGap2 = smoothstep(-0.10 + prog * 0.32, 0.28 + prog * 0.32, arcWave2 + (nAng - 0.5) * 0.35);
      float ring2 = (1.0 - smoothstep(wInner * 0.35, wInner, abs(r - rInner))) * arcGap2 * 0.82;
      float glow2 = (1.0 - smoothstep(0.0, wInner * 2.2, abs(r - rInner))) * arcGap2 * 0.42;

      foamCore = max(ring1, ring2);
      aquaGlow = max(glow1, glow2);
    }

    float radialClip = 1.0 - smoothstep(0.88, 1.0, length(p));
    float alpha = clamp((foamCore * 0.88 + aquaGlow * 0.46) * env * radialClip, 0.0, 0.92);
    if (alpha < 0.008) discard;

    vec3 aquaCol = vec3(0.44, 0.91, 0.99);
    vec3 whiteCol = vec3(0.97, 0.995, 1.0);
    float coreMix = clamp(foamCore / max(foamCore + aquaGlow * 0.45, 1e-4), 0.0, 1.0);
    vec3 col = mix(aquaCol, whiteCol, smoothstep(0.25, 0.78, coreMix));
    gl_FragColor = vec4(col, alpha);
  }
`;

interface WakeSlot {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  active: boolean;
  age: number;
  maxAge: number;
  startScaleX: number;
  startScaleZ: number;
  endScaleX: number;
  endScaleZ: number;
  vx: number;
  vz: number;
}

/**
 * Horizontal water-surface wake ribbons and concentric anime ripple rings for
 * surface swimmers and water entries. Lies flat on the XZ water plane so wakes
 * never billboard toward the camera.
 */
export class SwimWakeVfx {
  private readonly group = new THREE.Group();
  private readonly geo: THREE.PlaneGeometry;
  private readonly slots: WakeSlot[] = [];
  private cursor = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.group.name = 'swimWakeVfx';
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.geo.rotateX(-Math.PI / 2);

    for (let i = 0; i < POOL_SIZE; i++) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: WAKE_VERTEX_SHADER,
        fragmentShader: WAKE_FRAGMENT_SHADER,
        uniforms: {
          uProgress: { value: 0 },
          uKind: { value: 0 },
          uSeed: { value: i * 0.37 },
          uStrength: { value: 1 },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.slots.push({
        mesh,
        active: false,
        age: 0,
        maxAge: 1,
        startScaleX: 1,
        startScaleZ: 1,
        endScaleX: 2,
        endScaleZ: 2,
        vx: 0,
        vz: 0,
      });
    }
    this.scene.add(this.group);
  }

  private alloc(): WakeSlot {
    for (let i = 0; i < POOL_SIZE; i++) {
      const idx = (this.cursor + i) % POOL_SIZE;
      if (!this.slots[idx].active) {
        this.cursor = (idx + 1) % POOL_SIZE;
        return this.slots[idx];
      }
    }
    const slot = this.slots[this.cursor];
    this.cursor = (this.cursor + 1) % POOL_SIZE;
    return slot;
  }

  private activate(
    kind: 0 | 1,
    x: number,
    y: number,
    z: number,
    yaw: number,
    startX: number,
    startZ: number,
    endX: number,
    endZ: number,
    maxAge: number,
    vx: number,
    vz: number,
    strength: number,
  ): void {
    const slot = this.alloc();
    slot.active = true;
    slot.age = 0;
    slot.maxAge = maxAge;
    slot.startScaleX = startX;
    slot.startScaleZ = startZ;
    slot.endScaleX = endX;
    slot.endScaleZ = endZ;
    slot.vx = vx;
    slot.vz = vz;
    slot.mesh.position.set(x, y, z);
    slot.mesh.rotation.set(0, yaw, 0);
    slot.mesh.scale.set(startX, 1, startZ);
    slot.mesh.material.uniforms.uProgress.value = 0;
    slot.mesh.material.uniforms.uKind.value = kind;
    slot.mesh.material.uniforms.uSeed.value = Math.random() * 10;
    slot.mesh.material.uniforms.uStrength.value = strength;
    slot.mesh.visible = true;
  }

  /** Spawn a breaststroke V-wake ribbon + concentric expanding ripple ring on the water plane. */
  spawnStroke(x: number, y: number, z: number, dirX: number, dirZ: number, strength = 1): void {
    const len = Math.max(Math.hypot(dirX, dirZ), 1e-4);
    const fx = dirX / len;
    const fz = dirZ / len;
    // After rotateX(-PI/2), vUv.y = 0 (p.y = -1, forward bow) sits at local +Z,
    // which under rotation.y = yaw points along world (sin(yaw), 0, cos(yaw)).
    const yaw = Math.atan2(fx, fz);
    const safe = Math.min(1.35, Math.max(0.45, strength));

    // 1. Horizontal V-wake chevron + breaststroke arm-sweep crescents
    this.activate(
      0,
      x + fx * 0.12,
      y + 0.032,
      z + fz * 0.12,
      yaw,
      1.35 * safe,
      1.55 * safe,
      2.65 * safe,
      3.05 * safe,
      1.52,
      -fx * 0.32,
      -fz * 0.32,
      safe,
    );

    // 2. Concentric broken anime ripple ring expanding from the breaststroke pull
    this.activate(
      1,
      x + fx * 0.24,
      y + 0.026,
      z + fz * 0.24,
      Math.random() * Math.PI * 2,
      0.75 * safe,
      0.75 * safe,
      2.55 * safe,
      2.55 * safe,
      1.42,
      -fx * 0.12,
      -fz * 0.12,
      safe * 0.95,
    );
  }

  /** Spawn an expanding horizontal anime ripple ring for water entries and splashes. */
  spawnSplashRing(x: number, y: number, z: number, radius = 0.5, strength = 1): void {
    const safeR = Math.min(2.2, Math.max(0.3, radius));
    const safeS = Math.min(1.4, Math.max(0.45, strength));
    this.activate(
      1,
      x,
      y + 0.028,
      z,
      Math.random() * Math.PI * 2,
      safeR * 0.9,
      safeR * 0.9,
      safeR * 3.8 + 0.9,
      safeR * 3.8 + 0.9,
      1.25,
      0,
      0,
      safeS,
    );
  }

  clear(): void {
    for (let i = 0; i < POOL_SIZE; i++) {
      this.slots[i].active = false;
      this.slots[i].mesh.visible = false;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < POOL_SIZE; i++) {
      const slot = this.slots[i];
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age >= slot.maxAge) {
        slot.active = false;
        slot.mesh.visible = false;
        continue;
      }
      const t = slot.age / slot.maxAge;
      const ease = 1 - (1 - t) * (1 - t);
      slot.mesh.position.x += slot.vx * dt;
      slot.mesh.position.z += slot.vz * dt;
      const sx = slot.startScaleX + (slot.endScaleX - slot.startScaleX) * ease;
      const sz = slot.startScaleZ + (slot.endScaleZ - slot.startScaleZ) * ease;
      slot.mesh.scale.set(sx, 1, sz);
      slot.mesh.material.uniforms.uProgress.value = t;
    }
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.geo.dispose();
    for (const slot of this.slots) {
      slot.mesh.material.dispose();
    }
  }
}

// Surface kick: beats per second at a standstill, quickening with swim speed.
const SWIM_KICK_HZ = 1 / 1.667;

export function stepSwimKickSplash(
  v: { wasSwimming: boolean; swimKickPhase: number },
  dt: number,
  speed: number,
  swimming: boolean,
  touchesWater: boolean,
  moving: boolean,
  submerged: boolean,
  airborne: boolean,
  visuallyDead: boolean,
  charOnScreen: boolean,
  wl: number,
  ax: number,
  az: number,
  contactAxisX: number,
  contactAxisZ: number,
  contactRadius: number,
  vfx: {
    swimKickSplash: (
      x: number,
      y: number,
      z: number,
      fx: number,
      fz: number,
      intensity: number,
    ) => void;
  },
  waterView: { addSplash: (x: number, z: number, radius: number, strength: number) => void },
): void {
  if (swimming && moving && !submerged && !visuallyDead && charOnScreen && Number.isFinite(wl)) {
    if (!v.wasSwimming || v.swimKickPhase <= 0) v.swimKickPhase = 0.76;
    v.swimKickPhase += dt * SWIM_KICK_HZ * THREE.MathUtils.clamp(speed / 4.55, 0.55, 1.4);
    if (v.swimKickPhase >= 1) {
      v.swimKickPhase -= 1;
      const kick = Math.min(1.35, 0.65 + speed * 0.08);
      vfx.swimKickSplash(ax, wl, az, contactAxisX, contactAxisZ, kick);
      waterView.addSplash(ax, az, contactRadius * 0.95, kick * 0.48);
    }
  } else if (
    touchesWater &&
    !swimming &&
    moving &&
    !airborne &&
    !visuallyDead &&
    charOnScreen &&
    Number.isFinite(wl)
  ) {
    v.swimKickPhase += dt * SWIM_KICK_HZ * 1.45 * THREE.MathUtils.clamp(speed / 5.5, 0.6, 1.3);
    if (v.swimKickPhase >= 1) {
      v.swimKickPhase -= 1;
      vfx.swimKickSplash(ax, wl, az, contactAxisX, contactAxisZ, 0.75);
    }
  } else {
    v.swimKickPhase = 0;
  }
}
