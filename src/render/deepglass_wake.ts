// Water push: the wake a body drags through the bell.
//
// Flying underwater with nothing shedding off you reads as floating in fog. The
// water has to visibly resist and part — so a moving body sheds a ribbon of
// bubbles from its back, and a boosting one adds a cavitation cone of fine,
// fast mist. Both scale off real speed, so the effect IS the speedometer.
//
// One THREE.Points for every wearer in the bout, ring-buffered on the CPU: a
// particle is stamped at the emitter's position with a velocity and an age, and
// the shader just advances it. That is affordable because the emitter count is
// the roster (at most ten) and each carries a small fixed pool.

import * as THREE from 'three';

/** Particles per body. Ten bodies at this pool is ~1.4k points total. */
const POOL = 140;
/** Seconds a shed bubble lives. */
const LIFE = 1.15;
/** Below this speed nothing sheds — a hanging body should be still. */
const MIN_SPEED = 3.5;
/** Speed at which the wake is at full strength. */
const FULL_SPEED = 24;

const VERT = /* glsl */ `
  attribute vec3 aVel;
  attribute vec2 aBirth;   // x = spawn time, y = size
  uniform float uTime;
  uniform float uLife;
  varying float vFade;
  varying float vSize;
  void main() {
    float age = uTime - aBirth.x;
    if (age < 0.0 || age > uLife) {
      // Park dead particles behind the camera rather than branching the draw.
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    float t = age / uLife;
    vSize = aBirth.y;
    // Shed bubbles slow fast (drag) and then rise (buoyancy), so a wake curls
    // upward behind you instead of hanging in a straight line.
    vec3 p = position + aVel * (1.0 - exp(-age * 2.6)) / 2.6;
    p.y += 1.9 * age * age;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    // Fade in over the first tenth, out over the rest.
    vFade = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.35, 1.0, t));
    gl_PointSize = clamp(aBirth.y * 26.0 / max(0.7, -mv.z), 1.0, 22.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  precision mediump float;
  uniform vec3 uColor;
  varying float vFade;
  varying float vSize;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    if (r > 1.0) discard;
    float rim = smoothstep(0.45, 0.95, r);
    float a = vFade * (0.12 + rim * 0.75);
    if (a <= 0.003) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

// ---------------------------------------------------------------------------
// Exhaust. The burners do not just glow, they LEAVE something: a long rope of
// churned bubbles rolling out behind a boosting fighter, which is what turns a
// burn from a light on a model into a thing that happened in the water.
//
// This is exhaust UNDERWATER, so it is not smoke — it is froth. The first pass
// drew soft opaque puffs and read as a blob of fog stuck to your back; these
// are many small rimmed bubbles instead, and they live long enough (SMOKE_LIFE
// seconds against the wake's 1.15) that at boost speed the trail runs the best
// part of forty yards behind you.
// ---------------------------------------------------------------------------

/** Exhaust bubbles per body. Only boosting bodies ever stamp one. */
const SMOKE_POOL = 260;
const SMOKE_LIFE = 4.2;

const SMOKE_VERT = /* glsl */ `
  attribute vec3 aVel;
  attribute vec2 aBirth;
  uniform float uTime;
  uniform float uLife;
  varying float vFade;
  void main() {
    float age = uTime - aBirth.x;
    if (age < 0.0 || age > uLife) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    float t = age / uLife;
    // Laid down and left: the bubble coasts to a near stop almost at once, then
    // wanders up on the same buoyancy every bubble in here obeys. The wander is
    // position-seeded so a trail churns instead of marching in a neat line.
    vec3 p = position + aVel * (1.0 - exp(-age * 3.2)) / 3.2;
    p.y += 0.55 * age * age;
    p.x += sin(age * 2.7 + position.z * 1.7) * 0.18 * age;
    p.z += cos(age * 2.3 + position.x * 1.9) * 0.18 * age;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    // Swells gently — froth expanding as the pressure comes off it, not a puff
    // of smoke ballooning.
    float grow = aBirth.y * (0.7 + t * 0.9);
    // Long, flat fade: the far end of the trail thins out rather than ending.
    vFade = smoothstep(0.0, 0.04, t) * (1.0 - smoothstep(0.25, 1.0, t));
    gl_PointSize = clamp(grow * 26.0 / max(0.7, -mv.z), 1.0, 26.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const SMOKE_FRAG = /* glsl */ `
  precision mediump float;
  uniform vec3 uColor;
  varying float vFade;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    if (r > 1.0) discard;
    // A bubble, not a puff: bright rim, hollow middle. Same read as the wake's
    // spray, which is what makes the trail look like churned water rather than
    // a grey blob following you around.
    float rim = smoothstep(0.35, 0.92, r) * (1.0 - smoothstep(0.92, 1.0, r));
    float core = (1.0 - smoothstep(0.0, 0.75, r)) * 0.18;
    float a = vFade * (rim * 0.7 + core);
    if (a <= 0.003) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

interface Pool {
  points: THREE.Points;
  pos: THREE.BufferAttribute;
  vel: THREE.BufferAttribute;
  birth: THREE.BufferAttribute;
  cursor: number;
  /** Fractional particles owed, so a slow body still emits at a steady rate. */
  debt: number;
}

interface Emitter {
  bubbles: Pool;
  smoke: Pool;
}

export interface WakeSample {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  boosting: boolean;
  /** Thrust intent (Entity.dgWish), the same vector the burners are aimed down
   *  the reverse of. The exhaust rope leaves along the PLUMES; the bubble wake
   *  still trails the body, because that one is water being parted rather than
   *  water being thrown. Absent (all zero) falls back to the line of travel. */
  wx?: number;
  wy?: number;
  wz?: number;
}

export class DeepglassWake {
  readonly group = new THREE.Group();
  private readonly emitters = new Map<number, Emitter>();
  private readonly material: THREE.ShaderMaterial;
  private readonly smokeMaterial: THREE.ShaderMaterial;
  private time = 0;

  constructor() {
    this.group.name = 'deepglass-wake';
    this.group.frustumCulled = false;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLife: { value: LIFE },
        uColor: { value: new THREE.Color(0xdff4ff) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    // Additive like the wake, because this is froth rather than smoke: churned
    // water catches light, it does not block it. Normal blending (the first
    // pass) put a grey film over everything behind the trail.
    this.smokeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLife: { value: SMOKE_LIFE },
        uColor: { value: new THREE.Color(0xcfeaff) },
      },
      blending: THREE.AdditiveBlending,
      vertexShader: SMOKE_VERT,
      fragmentShader: SMOKE_FRAG,
      transparent: true,
      depthWrite: false,
    });
  }

  private makePool(size: number, material: THREE.ShaderMaterial, order: number): Pool {
    const geo = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array(size * 3), 3);
    const vel = new THREE.BufferAttribute(new Float32Array(size * 3), 3);
    // Birth time starts far in the past so nothing draws until first stamped.
    const birthData = new Float32Array(size * 2);
    for (let i = 0; i < size; i++) birthData[i * 2] = -1000;
    const birth = new THREE.BufferAttribute(birthData, 2);
    pos.setUsage(THREE.DynamicDrawUsage);
    vel.setUsage(THREE.DynamicDrawUsage);
    birth.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', pos);
    geo.setAttribute('aVel', vel);
    geo.setAttribute('aBirth', birth);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const points = new THREE.Points(geo, material);
    points.frustumCulled = false;
    points.renderOrder = order;
    this.group.add(points);
    return { points, pos, vel, birth, cursor: 0, debt: 0 };
  }

  private emitterFor(id: number): Emitter {
    const found = this.emitters.get(id);
    if (found) return found;
    const emitter: Emitter = {
      bubbles: this.makePool(POOL, this.material, 12),
      // Under the bubbles: the exhaust is the backdrop they sparkle against.
      smoke: this.makePool(SMOKE_POOL, this.smokeMaterial, 11),
    };
    this.emitters.set(id, emitter);
    return emitter;
  }

  /** Deterministic-enough scatter; this is ambience, never gameplay. */
  private static jitter(seed: number): number {
    const h = Math.sin(seed * 12.9898) * 43758.5453;
    return (h - Math.floor(h)) * 2 - 1;
  }

  update(dt: number, samples: Iterable<WakeSample>): void {
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
    this.smokeMaterial.uniforms.uTime.value = this.time;
    const live = new Set<number>();

    for (const s of samples) {
      live.add(s.id);
      const speed = Math.hypot(s.vx, s.vy, s.vz);
      const emitter = this.emitterFor(s.id);
      const em = emitter.bubbles;
      this.stampSmoke(emitter.smoke, s, speed, dt);
      if (speed < MIN_SPEED) {
        em.debt = 0;
        continue;
      }
      const strength = Math.min(1, (speed - MIN_SPEED) / (FULL_SPEED - MIN_SPEED));
      // A boosting body cavitates: many more, much finer bubbles.
      const rate = (s.boosting ? 90 : 28) * strength;
      em.debt += rate * dt;
      const n = Math.floor(em.debt);
      em.debt -= n;
      if (n <= 0) continue;

      const inv = 1 / Math.max(1e-3, speed);
      const bx = -s.vx * inv;
      const by = -s.vy * inv;
      const bz = -s.vz * inv;
      for (let k = 0; k < n && k < 12; k++) {
        const i = em.cursor;
        em.cursor = (em.cursor + 1) % POOL;
        const seed = this.time * 60 + i * 7.13 + k;
        const spread = s.boosting ? 0.35 : 0.6;
        // Stamp just behind the body, scattered across its width.
        em.pos.setXYZ(
          i,
          s.x + bx * 0.7 + DeepglassWake.jitter(seed) * spread,
          s.y + by * 0.7 + DeepglassWake.jitter(seed + 31) * spread,
          s.z + bz * 0.7 + DeepglassWake.jitter(seed + 61) * spread,
        );
        // Shed backwards at a fraction of the body's pace, plus scatter.
        const back = s.boosting ? 0.45 : 0.28;
        em.vel.setXYZ(
          i,
          bx * speed * back + DeepglassWake.jitter(seed + 97) * 1.3,
          by * speed * back + DeepglassWake.jitter(seed + 131) * 1.3,
          bz * speed * back + DeepglassWake.jitter(seed + 167) * 1.3,
        );
        const size = s.boosting
          ? 0.35 + Math.abs(DeepglassWake.jitter(seed + 7)) * 0.45
          : 0.5 + Math.abs(DeepglassWake.jitter(seed + 7)) * 0.9;
        em.birth.setXY(i, this.time, size);
      }
      em.pos.needsUpdate = true;
      em.vel.needsUpdate = true;
      em.birth.needsUpdate = true;
    }

    for (const [id, em] of this.emitters) {
      if (live.has(id)) continue;
      DeepglassWake.disposePool(em.bubbles);
      DeepglassWake.disposePool(em.smoke);
      this.emitters.delete(id);
    }
  }

  /**
   * The burner exhaust: only a BOOSTING body lays it, and it is stamped behind
   * the shoulders rather than at the feet, because that is where the nozzles
   * are. Slow, fat and rolling — the counterpart to the fine fast bubbles.
   */
  private stampSmoke(pool: Pool, s: WakeSample, speed: number, dt: number): void {
    if (!s.boosting) {
      pool.debt = 0;
      return;
    }
    // Dense: a long trail of small bubbles needs a lot of them, and the pool is
    // sized to hold SMOKE_LIFE seconds' worth at this rate.
    pool.debt += 58 * dt;
    const n = Math.floor(pool.debt);
    pool.debt -= n;
    if (n <= 0) return;

    // Out of the NOZZLES: down the reverse of the thrust intent, which is where
    // the plumes are pointing. A body burning to hold station has no travel to
    // trail along but is very much throwing water — off velocity alone that
    // case laid nothing, or laid it in the wrong place the moment the thrust
    // and the momentum disagreed. Falls back to the line of travel, then to
    // straight down, for a sample that carries no intent.
    const push = Math.hypot(s.wx ?? 0, s.wy ?? 0, s.wz ?? 0);
    let bx: number;
    let by: number;
    let bz: number;
    if (push > 1e-3) {
      bx = -(s.wx ?? 0) / push;
      by = -(s.wy ?? 0) / push;
      bz = -(s.wz ?? 0) / push;
    } else if (speed > 1e-3) {
      const inv = 1 / speed;
      bx = -s.vx * inv;
      by = -s.vy * inv;
      bz = -s.vz * inv;
    } else {
      bx = 0;
      by = -1;
      bz = 0;
    }
    for (let k = 0; k < n && k < 10; k++) {
      const i = pool.cursor;
      pool.cursor = (pool.cursor + 1) % SMOKE_POOL;
      const seed = this.time * 60 + i * 3.77 + k;
      // Stamped along the LAST TICK's travel rather than all at one point, so
      // the rope is continuous at speed instead of arriving in visible clumps
      // once per frame.
      const back = 1.1 + (k / Math.max(1, n)) * speed * dt;
      pool.pos.setXYZ(
        i,
        s.x + bx * back + DeepglassWake.jitter(seed) * 0.4,
        s.y + by * back + DeepglassWake.jitter(seed + 41) * 0.4,
        s.z + bz * back + DeepglassWake.jitter(seed + 83) * 0.4,
      );
      // Thrown down the plume, never after the body: a fixed ejection out of the
      // nozzle plus a little of the body's own pace, so a fighter burning to
      // hold station still visibly blows water away from itself.
      const eject = 3.4 + speed * 0.1;
      pool.vel.setXYZ(
        i,
        bx * eject + DeepglassWake.jitter(seed + 107) * 0.7,
        by * eject + DeepglassWake.jitter(seed + 149) * 0.7,
        bz * eject + DeepglassWake.jitter(seed + 181) * 0.7,
      );
      pool.birth.setXY(i, this.time, 0.22 + Math.abs(DeepglassWake.jitter(seed + 13)) * 0.34);
    }
    pool.pos.needsUpdate = true;
    pool.vel.needsUpdate = true;
    pool.birth.needsUpdate = true;
  }

  private static disposePool(pool: Pool): void {
    pool.points.removeFromParent();
    pool.points.geometry.dispose();
  }

  dispose(): void {
    for (const [, em] of this.emitters) {
      DeepglassWake.disposePool(em.bubbles);
      DeepglassWake.disposePool(em.smoke);
    }
    this.emitters.clear();
    this.material.dispose();
    this.smokeMaterial.dispose();
  }
}
