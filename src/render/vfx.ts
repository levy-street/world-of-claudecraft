import * as THREE from 'three';
import { loadTexture } from './assets/loader';
import { registerPreload } from './assets/preload';
import { GFX } from './gfx';

// Spell & ambience particle system. One pooled THREE.Points cloud drawn with
// additive blending; projectiles are lightweight emitters that home on their
// target and burst on arrival. Particles sample a 4x4 atlas of Kenney
// particle-pack sprites (black-background, additive-ready, CC0) — flames,
// sparks, magic wisps, smoke — built once at startup from the preloaded PNGs.
//
// On the composer tiers, colors are pushed past 1.0 (the HDR HalfFloat target
// preserves them) so projectile cores, novas and heal pillars bloom; the low
// tier keeps plain colors (same sprites, no HDR boost).

const CAPACITY = 4096;

// HDR multipliers (graphics-plan step 9); 1.0 on the no-composer path
function hdr(k: number): number {
  return GFX.composer ? k : 1;
}

// Per-school projectile colors, cached: a bolt burst used to allocate three
// THREE.Color per launch. spawn() copies components into the attribute buffers
// (and update() copies before mutating), never retaining the reference, so the
// cached instances are effectively immutable. Keyed on GFX.composer so a tier
// flip rebuilds the HDR-boosted variants.
const projectileColorCache = new Map<
  string,
  { base: THREE.Color; core: THREE.Color; trail: THREE.Color }
>();
let projectileColorComposer: boolean | null = null;
function projectileSchoolColors(school: string): {
  base: THREE.Color;
  core: THREE.Color;
  trail: THREE.Color;
} {
  if (projectileColorComposer !== GFX.composer) {
    projectileColorCache.clear();
    projectileColorComposer = GFX.composer;
  }
  let c = projectileColorCache.get(school);
  if (!c) {
    const base = new THREE.Color(SCHOOL_COLORS[school] ?? 0xffffff);
    c = {
      base,
      core: base.clone().multiplyScalar(hdr(2.5)),
      trail: base.clone().multiplyScalar(hdr(1.4)),
    };
    projectileColorCache.set(school, c);
  }
  return c;
}

// ---------------------------------------------------------------------------
// Sprite atlas: 16 cherry-picked Kenney sprites in a 4x4 grid. Order defines
// the cell index used by the shader — append only.
// ---------------------------------------------------------------------------

const ATLAS_GRID = 4;
const ATLAS_CELL = 256;

const SPRITE_FILES = [
  'light_01',
  'light_02',
  'flare_01',
  'spark_04',
  'spark_06',
  'star_07',
  'magic_01',
  'magic_04',
  'twirl_01',
  'flame_03',
  'fire_01',
  'smoke_05',
  'trace_05',
  'slash_02',
  'dirt_02',
  'circle_05',
] as const;

// Named cell indices (keep in sync with SPRITE_FILES order)
const SPR = {
  glowSoft: 0,
  glowCore: 1,
  flash: 2,
  sparkle: 3,
  sparkBurst: 4,
  star: 5,
  magicWisp: 6,
  magicRune: 7,
  twirl: 8,
  flame: 9,
  firePuff: 10,
  smoke: 11,
  trace: 12,
  slash: 13,
  debris: 14,
  ring: 15,
} as const;

const spriteImages: (TexImageSource | null)[] = SPRITE_FILES.map(() => null);
for (let i = 0; i < SPRITE_FILES.length; i++) {
  registerPreload(
    loadTexture(`/vfx/${SPRITE_FILES[i]}.png`, { srgb: true }).then((tex) => {
      spriteImages[i] = tex.image as TexImageSource;
      return tex;
    }),
  );
}

// Compose the atlas once. Any cell whose PNG is unavailable (e.g. unit tests
// that construct Vfx without the preload gate) falls back to a soft painted
// disc so the system always renders something sane.
function buildAtlasTexture(): THREE.CanvasTexture {
  const size = ATLAS_GRID * ATLAS_CELL;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < SPRITE_FILES.length; i++) {
    const x = (i % ATLAS_GRID) * ATLAS_CELL;
    const y = Math.floor(i / ATLAS_GRID) * ATLAS_CELL;
    const img = spriteImages[i];
    if (img) {
      ctx.drawImage(img as CanvasImageSource, x, y, ATLAS_CELL, ATLAS_CELL);
    } else {
      const g = ctx.createRadialGradient(
        x + ATLAS_CELL / 2,
        y + ATLAS_CELL / 2,
        2,
        x + ATLAS_CELL / 2,
        y + ATLAS_CELL / 2,
        ATLAS_CELL / 2,
      );
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, ATLAS_CELL, ATLAS_CELL);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

export const SCHOOL_COLORS: Record<string, number> = {
  fire: 0xff7a2a,
  frost: 0x8ed2ff,
  arcane: 0xd98aff,
  shadow: 0x9a5df0,
  holy: 0xffe9a0,
  nature: 0x86e86a,
  // warm steel-spark — near-white crossed the bloom threshold colorlessly and
  // melee hits read as faint white noise
  physical: 0xffd28a,
};

interface Projectile {
  pos: THREE.Vector3;
  targetId: number;
  color: THREE.Color; // base school color (impact burst = x1.6)
  coreColor: THREE.Color; // HDR core (x2.5)
  trailColor: THREE.Color; // sparkling trail (x1.4)
  speed: number;
  ttl: number;
  coreSprite: number;
  trailSprite: number;
  // When set, the flying head renders as a short jagged electric bolt streak
  // (a lightning "bolt-shaped" projectile) instead of a smooth glowing comet.
  lightning?: boolean;
}

// fire reads as flame tongues; everything else as sparkling magic
function projectileSprites(school: string): { core: number; trail: number } {
  return school === 'fire'
    ? { core: SPR.firePuff, trail: SPR.flame }
    : { core: SPR.glowCore, trail: SPR.sparkle };
}

export type EntityAnchor = (id: number, heightFrac: number) => THREE.Vector3 | null;

export class Vfx {
  private points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private life: Float32Array; // remaining
  private maxLife: Float32Array;
  private grav: Float32Array;
  private alphaAttr: Float32Array;
  private spriteAttr: Float32Array;
  private rotAttr: Float32Array;
  private head = 0;
  private projectiles: Projectile[] = [];
  private tmpColor = new THREE.Color();
  // fireworkBurst palette scratch, reused across shells (spawn() copies
  // components, never retaining the reference): a goal volley allocates
  // no Color objects.
  private fwCols: THREE.Color[] = [];
  private fwFlash = new THREE.Color();
  private quality = 1;

  constructor(
    scene: THREE.Scene,
    private anchor: EntityAnchor,
  ) {
    this.pos = new Float32Array(CAPACITY * 3);
    this.vel = new Float32Array(CAPACITY * 3);
    this.col = new Float32Array(CAPACITY * 3);
    this.size = new Float32Array(CAPACITY);
    this.life = new Float32Array(CAPACITY);
    this.maxLife = new Float32Array(CAPACITY);
    this.grav = new Float32Array(CAPACITY);
    this.alphaAttr = new Float32Array(CAPACITY);
    this.spriteAttr = new Float32Array(CAPACITY);
    this.rotAttr = new Float32Array(CAPACITY);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphaAttr, 1));
    geo.setAttribute('aSprite', new THREE.BufferAttribute(this.spriteAttr, 1));
    geo.setAttribute('aRot', new THREE.BufferAttribute(this.rotAttr, 1));
    // huge static bounding sphere: particles fly everywhere, skip recompute
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(450, 0, 0), 2400);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uScale: { value: 600 },
        uAtlas: { value: buildAtlasTexture() },
      },
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        attribute float aSprite;
        attribute float aRot;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vSprite;
        varying float vRot;
        uniform float uScale;
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vSprite = aSprite;
          vRot = aRot;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(aSize * uScale / max(1.0, -mv.z), 0.0, 110.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform sampler2D uAtlas;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vSprite;
        varying float vRot;
        void main() {
          // rotate the point coord around its centre, clamped inside the cell
          vec2 pc = gl_PointCoord - 0.5;
          float cs = cos(vRot), sn = sin(vRot);
          pc = vec2(pc.x * cs - pc.y * sn, pc.x * sn + pc.y * cs);
          pc = clamp(pc + 0.5, 0.01, 0.99);
          float idx = floor(vSprite + 0.5);
          vec2 cell = vec2(mod(idx, ${ATLAS_GRID}.0), floor(idx / ${ATLAS_GRID}.0));
          vec2 uv = (cell + pc) / ${ATLAS_GRID}.0;
          uv.y = 1.0 - uv.y; // canvas row 0 is the visual top
          vec3 tex = texture2D(uAtlas, uv).rgb;
          float lum = max(tex.r, max(tex.g, tex.b));
          if (lum * vAlpha < 0.012) discard;
          gl_FragColor = vec4(vColor * tex, vAlpha);
        }
      `,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.userData.renderCategory = 'vfx';
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  setViewportScale(heightPx: number, fovDeg: number): void {
    const mat = this.points.material as THREE.ShaderMaterial;
    mat.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  setQuality(level: number): void {
    this.quality = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 1));
  }

  prewarm(at: THREE.Vector3): void {
    const sprites = Object.values(SPR);
    for (let i = 0; i < sprites.length; i++) {
      const a = (i / sprites.length) * Math.PI * 2;
      this.spawn(
        at.x + Math.sin(a) * 1.2,
        at.y + 0.6 + (i % 4) * 0.25,
        at.z + Math.cos(a) * 1.2,
        0,
        0,
        0,
        i % 3 === 0 ? 0xffd28a : i % 3 === 1 ? 0x8ed2ff : 0xd98aff,
        0.35 + (i % 4) * 0.08,
        1.0,
        0,
        sprites[i],
        0,
      );
    }
    this.update(0);
  }

  clear(): void {
    this.projectiles.length = 0;
    this.life.fill(0);
    this.size.fill(0);
    this.alphaAttr.fill(0);
    const geo = this.points.geometry;
    (geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }

  private scaledCount(count: number): number {
    if (count <= 1) return count;
    const scale = 0.45 + 0.55 * this.quality;
    return Math.max(1, Math.min(count, Math.round(count * scale)));
  }

  private emitChance(ratePerSecond: number, dt: number): boolean {
    return Math.random() <= dt * ratePerSecond * (0.35 + 0.65 * this.quality);
  }

  // Frame-rate-independent variant for continuous auras: emitChance caps at one
  // spawn per frame, which starves a steady aura on a slow frame (a 15 fps
  // client would show a third of the particles a 60 fps client does). Returns
  // the whole expected count plus a Bernoulli draw on the fraction.
  private emitCount(ratePerSecond: number, dt: number): number {
    const expected = dt * ratePerSecond * (0.35 + 0.65 * this.quality);
    const n = Math.floor(expected);
    return n + (Math.random() <= expected - n ? 1 : 0);
  }

  private spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    color: THREE.Color | number,
    size: number,
    lifetime: number,
    gravity = 0,
    sprite: number = SPR.glowSoft,
    rot: number = Math.random() * Math.PI * 2,
  ): void {
    const i = this.head;
    this.head = (this.head + 1) % CAPACITY;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.tmpColor.set(color as THREE.ColorRepresentation);
    this.col[i * 3] = this.tmpColor.r;
    this.col[i * 3 + 1] = this.tmpColor.g;
    this.col[i * 3 + 2] = this.tmpColor.b;
    this.size[i] = size;
    this.life[i] = lifetime;
    this.maxLife[i] = lifetime;
    this.grav[i] = gravity;
    this.alphaAttr[i] = 1;
    this.spriteAttr[i] = sprite;
    this.rotAttr[i] = rot;
  }

  // ---------------------------------------------------------------------
  // High-level effects
  // ---------------------------------------------------------------------

  projectile(sourceId: number, targetId: number, school: string): void {
    const from = this.anchor(sourceId, 0.62);
    if (!from) return;
    const colors = projectileSchoolColors(school);
    const sprites = projectileSprites(school);
    this.projectiles.push({
      pos: from.clone(),
      targetId,
      color: colors.base,
      coreColor: colors.core,
      trailColor: colors.trail,
      speed: 26,
      ttl: 3,
      coreSprite: sprites.core,
      trailSprite: sprites.trail,
    });
  }

  beam(sourceId: number, targetId: number, school: string): void {
    const from = this.anchor(sourceId, 0.62);
    const to = this.anchor(targetId, 0.55);
    if (!from || !to) return;
    const color = new THREE.Color(SCHOOL_COLORS[school] ?? 0xffffff).multiplyScalar(hdr(1.9));
    const dir = to.clone().sub(from);
    const len = dir.length();
    if (len <= 0.001) return;
    dir.multiplyScalar(1 / len);
    const steps = Math.min(30, Math.max(8, Math.ceil(len / 1.25)));
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const jitter = (Math.random() - 0.5) * 0.18;
      const x = from.x + (to.x - from.x) * f + (Math.random() - 0.5) * 0.12;
      const y = from.y + (to.y - from.y) * f + jitter;
      const z = from.z + (to.z - from.z) * f + (Math.random() - 0.5) * 0.12;
      this.spawn(x, y, z, -dir.x * 0.8, 0.08, -dir.z * 0.8, color, 0.34, 0.18, 0, SPR.glowCore);
    }
    this.spawn(to.x, to.y, to.z, 0, 0.2, 0, color, 0.9, 0.2, 0, SPR.magicRune);
  }

  // A "bolt-shaped" traveling projectile: fires a homing bolt with the SAME
  // travel + impact timing as a normal spell projectile (so the damage lands when
  // Chain Heal's signature arc: a bright green cord that lifts in a gentle parabola
  // from the source ally to the target, denser and softer than a nuke beam so it
  // reads as flowing healing water rather than crackling lightning. Each hop of the
  // chain emits one; the per-target heal glow (healGlow, on the heal2 event) lands
  // the burst at each ally, so this method only draws the connecting cord.
  chainHealArc(sourceId: number, targetId: number): void {
    const from = this.anchor(sourceId, 0.62);
    const to = this.anchor(targetId, 0.55);
    if (!from || !to) return;
    const core = new THREE.Color(0xbaf7a0).multiplyScalar(hdr(2.4));
    const soft = new THREE.Color(0x86e86a).multiplyScalar(hdr(1.7));
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dz);
    if (len <= 0.001 && Math.abs(dy) <= 0.001) return;
    // Arc height scales with distance so a long jump bows more; capped so a short
    // hop still curves. The lift peaks at the midpoint (sin(pi*f)).
    const lift = Math.min(1.6, 0.5 + len * 0.12);
    const steps = Math.min(34, Math.max(12, Math.ceil(len / 0.8)));
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const arc = Math.sin(f * Math.PI) * lift;
      const jitterX = (Math.random() - 0.5) * 0.1;
      const jitterZ = (Math.random() - 0.5) * 0.1;
      // Alternate a bright core sprite and a soft glow so the cord has depth.
      const bright = i % 2 === 0;
      this.spawn(
        from.x + dx * f + jitterX,
        from.y + dy * f + arc + (Math.random() - 0.5) * 0.08,
        from.z + dz * f + jitterZ,
        0,
        0.4,
        0,
        bright ? core : soft,
        bright ? 0.42 : 0.55,
        0.5 + Math.random() * 0.18,
        -0.4,
        bright ? SPR.glowCore : SPR.glowSoft,
      );
    }
    // A few rising sparkles along the cord for the living-water feel.
    const sparkles = this.scaledCount(8);
    for (let i = 0; i < sparkles; i++) {
      const f = Math.random();
      const arc = Math.sin(f * Math.PI) * lift;
      this.spawn(
        from.x + dx * f + (Math.random() - 0.5) * 0.3,
        from.y + dy * f + arc + 0.1,
        from.z + dz * f + (Math.random() - 0.5) * 0.3,
        0,
        1.3 + Math.random() * 0.8,
        0,
        core,
        0.28,
        0.55 + Math.random() * 0.3,
        -1.4,
        SPR.sparkle,
      );
    }
  }

  // it arrives, no flash-then-wait), but its flying head renders as a short jagged
  // blue-white electric streak instead of a round glowing comet (the shape is
  // drawn in the projectile update loop). Original procedural effect (no assets).
  lightningProjectile(sourceId: number, targetId: number): void {
    const from = this.anchor(sourceId, 0.62);
    if (!from) return;
    this.projectiles.push({
      pos: from.clone(),
      targetId,
      color: new THREE.Color(0x66b8ff).multiplyScalar(hdr(1.7)), // electric blue (impact tint)
      coreColor: new THREE.Color(0xeaf6ff).multiplyScalar(hdr(3.0)), // hot white-blue head
      trailColor: new THREE.Color(0x3f9bff).multiplyScalar(hdr(1.9)), // crackle
      speed: 26,
      ttl: 3,
      coreSprite: SPR.glowCore,
      trailSprite: SPR.sparkle,
      lightning: true,
    });
  }

  burst(at: THREE.Vector3, school: string, count = 18, power = 1): void {
    const c = new THREE.Color(SCHOOL_COLORS[school] ?? 0xffffff).multiplyScalar(hdr(1.6));
    const isFire = school === 'fire';
    const scaledCount = this.scaledCount(count);
    for (let i = 0; i < scaledCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.9 + 0.1;
      const sp = (2 + Math.random() * 4.5) * power;
      // fire bursts read as flame puffs; everything else as spark showers
      const sprite = isFire
        ? i % 3 === 0
          ? SPR.firePuff
          : SPR.flame
        : i % 3 === 0
          ? SPR.star
          : i % 2 === 0
            ? SPR.sparkle
            : SPR.sparkBurst;
      this.spawn(
        at.x,
        at.y,
        at.z,
        Math.sin(a) * sp,
        up * sp * 0.8,
        Math.cos(a) * sp,
        c,
        0.34 + Math.random() * 0.3 * power,
        0.45 + Math.random() * 0.35,
        7,
        sprite,
      );
    }
  }

  tick(targetId: number, school: string): void {
    const at = this.anchor(targetId, 0.55);
    if (at) this.burst(at, school, 7, 0.6);
  }

  nova(centerId: number, school: string): void {
    const at = this.anchor(centerId, 0.12);
    if (!at) return;
    const c = new THREE.Color(SCHOOL_COLORS[school] ?? 0xffffff).multiplyScalar(hdr(1.6));
    // one expanding rune ring at the centre sells the shockwave
    this.spawn(at.x, at.y + 0.3, at.z, 0, 0.3, 0, c, 1.5, 0.4, 0, SPR.ring, 0);
    const count = this.scaledCount(34);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const sp = 11 + Math.random() * 3;
      this.spawn(
        at.x,
        at.y + 0.25,
        at.z,
        Math.sin(a) * sp,
        1.2,
        Math.cos(a) * sp,
        c,
        0.5,
        0.55,
        6,
        i % 4 === 0 ? SPR.magicRune : SPR.sparkle,
      );
    }
  }

  healGlow(targetId: number): void {
    const at = this.anchor(targetId, 0.1);
    if (!at) return;
    const green = new THREE.Color(0xbaf7a0).multiplyScalar(hdr(1.8));
    const gold = new THREE.Color(0xffe9a0).multiplyScalar(hdr(1.8));
    for (let i = 0; i < this.scaledCount(22); i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.4 + Math.random() * 0.7;
      this.spawn(
        at.x + Math.sin(a) * r,
        at.y + Math.random() * 0.4,
        at.z + Math.cos(a) * r,
        Math.sin(a) * 0.25,
        1.6 + Math.random() * 1.4,
        Math.cos(a) * 0.25,
        i % 3 === 0 ? green : gold,
        0.3 + Math.random() * 0.25,
        0.9 + Math.random() * 0.5,
        -1.2,
        i % 2 === 0 ? SPR.star : SPR.sparkle,
      );
    }
  }

  buffSwirl(targetId: number, color = 0xffe9a0): void {
    const at = this.anchor(targetId, 0.2);
    if (!at) return;
    const count = this.scaledCount(14);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      this.spawn(
        at.x + Math.sin(a) * 0.85,
        at.y + 0.2,
        at.z + Math.cos(a) * 0.85,
        -Math.cos(a) * 1.6,
        2.1,
        Math.sin(a) * 1.6,
        color,
        0.3,
        0.8,
        -1.5,
        SPR.magicWisp,
      );
    }
  }

  meleeSpark(targetId: number, crit: boolean): void {
    const at = this.anchor(targetId, 0.55);
    if (!at) return;
    // a single slash arc reads as the hit itself...
    const steel = new THREE.Color(0xffe6c0).multiplyScalar(hdr(crit ? 2.0 : 1.5));
    this.spawn(at.x, at.y + 0.1, at.z, 0, 0.4, 0, steel, crit ? 1.0 : 0.75, 0.18, 0, SPR.slash);
    // ...backed by a steel-spark shower big enough to read at 1600x900
    this.burst(at, 'physical', crit ? 20 : 9, crit ? 1.4 : 0.85);
  }

  levelUpPillar(targetId: number): void {
    const at = this.anchor(targetId, 0);
    if (!at) return;
    const white = new THREE.Color(0xfff8e0).multiplyScalar(hdr(1.8));
    const gold = new THREE.Color(0xffd14d).multiplyScalar(hdr(1.8));
    for (let i = 0; i < this.scaledCount(46); i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.3 + Math.random() * 0.9;
      this.spawn(
        at.x + Math.sin(a) * r,
        at.y + Math.random() * 0.3,
        at.z + Math.cos(a) * r,
        0,
        4.5 + Math.random() * 3.5,
        0,
        i % 4 === 0 ? white : gold,
        0.42,
        1.1 + Math.random() * 0.4,
        -1,
        i % 3 === 0 ? SPR.star : SPR.sparkle,
      );
    }
  }

  // Vale Cup celebration: one team-colored firework shell (per-particle colors,
  // the levelUpPillar/burst pattern). The renderer staggers several calls per
  // goal to read as a volley; colors alternate through the scoring nation's
  // flag palette. A slow confetti sprinkle rides along under lighter gravity.
  fireworkBurst(at: THREE.Vector3, colors: readonly number[], count = 46, power = 1): void {
    const colCount = Math.max(1, colors.length);
    while (this.fwCols.length < colCount) this.fwCols.push(new THREE.Color());
    for (let i = 0; i < colCount; i++) {
      this.fwCols[i].setHex(colors.length > 0 ? colors[i] : 0xffd14d).multiplyScalar(hdr(1.8));
    }
    const cols = this.fwCols;
    // the report flash
    this.spawn(
      at.x,
      at.y,
      at.z,
      0,
      0.3,
      0,
      this.fwFlash.setHex(0xfff6e0).multiplyScalar(hdr(2.2)),
      1.5 * power,
      0.2,
      0,
      SPR.flash,
    );
    const n = this.scaledCount(count);
    for (let i = 0; i < n; i++) {
      // even-ish spherical shell
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const s = Math.sqrt(Math.max(0, 1 - u * u));
      const sp = (6 + Math.random() * 2.6) * power;
      this.spawn(
        at.x,
        at.y,
        at.z,
        Math.cos(a) * s * sp,
        u * sp * 0.85 + 1.2,
        Math.sin(a) * s * sp,
        cols[i % colCount],
        0.4 + Math.random() * 0.2,
        0.95 + Math.random() * 0.5,
        4.5,
        i % 3 === 0 ? SPR.star : SPR.sparkle,
      );
    }
    // confetti flecks: slower, tumbling, longer-lived
    const confetti = this.scaledCount(Math.round(count * 0.4));
    for (let i = 0; i < confetti; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (1.5 + Math.random() * 2) * power;
      this.spawn(
        at.x,
        at.y,
        at.z,
        Math.sin(a) * sp,
        Math.random() * 1.5,
        Math.cos(a) * sp,
        cols[(i + 1) % colCount],
        0.22,
        1.4 + Math.random() * 0.6,
        1.6,
        SPR.debris,
      );
    }
  }

  // continuous emitters (called per frame)
  castSparkle(entityId: number, school: string, dt: number): void {
    if (!this.emitChance(30, dt)) return;
    const at = this.anchor(entityId, 0.66);
    if (!at) return;
    const c = SCHOOL_COLORS[school] ?? 0xffffff;
    const a = Math.random() * Math.PI * 2;
    this.spawn(
      at.x + Math.sin(a) * 0.5,
      at.y,
      at.z + Math.cos(a) * 0.5,
      0,
      0.9 + Math.random(),
      0,
      c,
      0.26,
      0.5,
      -0.5,
      school === 'fire' ? SPR.flame : SPR.magicWisp,
    );
  }

  // Shapeshift-form aura (continuous, called per frame while the form aura is
  // on). Each form reads distinctly at a glance: metamorph = flame tongues +
  // stray embers, moonkin = drifting star motes, shadowform = gloom wisps +
  // smoke curls.
  formAura(entityId: number, form: 'metamorph' | 'moonkin' | 'shadowform', dt: number): void {
    if (form === 'metamorph') {
      const n = this.emitCount(48, dt);
      if (!n) return;
      const at = this.anchor(entityId, 0.3);
      if (!at) return;
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2;
        // wide ring: Metamorphosis also grows the body (Entity.scale), so the
        // flames must clear the fattened silhouette or they vanish inside it
        const r = 0.6 + Math.random() * 0.45;
        const ember = Math.random() < 0.45;
        this.spawn(
          at.x + Math.sin(a) * r,
          at.y + Math.random() * 0.9,
          at.z + Math.cos(a) * r,
          Math.sin(a) * 0.25,
          0.9 + Math.random() * 0.8,
          Math.cos(a) * 0.25,
          ember ? 0xffe08a : 0xffa040,
          ember ? 0.24 : 0.62,
          0.8 + Math.random() * 0.4,
          -0.3,
          ember ? SPR.sparkBurst : SPR.flame,
          (Math.random() - 0.5) * 0.6,
        );
      }
      return;
    }
    if (form === 'moonkin') {
      const n = this.emitCount(30, dt);
      if (!n) return;
      const at = this.anchor(entityId, 0.55);
      if (!at) return;
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2;
        const r = 0.45 + Math.random() * 0.5;
        this.spawn(
          at.x + Math.sin(a) * r,
          at.y + (Math.random() - 0.3) * 0.8,
          at.z + Math.cos(a) * r,
          Math.sin(a) * 0.15,
          0.35 + Math.random() * 0.5,
          Math.cos(a) * 0.15,
          Math.random() < 0.35 ? 0xd98aff : 0xfff2c0,
          0.24 + Math.random() * 0.18,
          1.1 + Math.random() * 0.5,
          -0.15,
          SPR.star,
        );
      }
      return;
    }
    // shadowform: dark wisps curling around the silhouette, the odd smoke curl
    const n = this.emitCount(24, dt);
    if (!n) return;
    const at = this.anchor(entityId, 0.45);
    if (!at) return;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.4 + Math.random() * 0.4;
      const smoke = Math.random() < 0.25;
      this.spawn(
        at.x + Math.sin(a) * r,
        at.y + (Math.random() - 0.2) * 0.7,
        at.z + Math.cos(a) * r,
        -Math.cos(a) * 0.6,
        0.4 + Math.random() * 0.5,
        Math.sin(a) * 0.6,
        smoke ? 0x3a2a55 : 0x9a5df0,
        smoke ? 0.5 : 0.34,
        0.85 + Math.random() * 0.5,
        -0.2,
        smoke ? SPR.smoke : SPR.magicWisp,
      );
    }
  }

  swimRipple(at: THREE.Vector3, dt: number): void {
    if (!this.emitChance(9, dt)) return;
    const a = Math.random() * Math.PI * 2;
    this.spawn(
      at.x + Math.sin(a) * 0.5,
      at.y + 0.55,
      at.z + Math.cos(a) * 0.5,
      Math.sin(a) * 1.2,
      1.1,
      Math.cos(a) * 1.2,
      0xcfe9ff,
      0.3,
      0.55,
      5,
      SPR.glowSoft,
    );
  }

  campfireEmber(at: THREE.Vector3, dt: number): void {
    if (!this.emitChance(6, dt)) return;
    if (Math.random() < 0.3) {
      // faint additive smoke puff drifting off the flame tip
      this.spawn(
        at.x + (Math.random() - 0.5) * 0.3,
        at.y + 1.0,
        at.z + (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 0.35,
        0.8 + Math.random() * 0.5,
        (Math.random() - 0.5) * 0.35,
        0x36322e,
        0.7 + Math.random() * 0.5,
        1.8 + Math.random() * 0.9,
        -0.25,
        SPR.smoke,
      );
      return;
    }
    // flame-tongue embers, mostly upright with a little flicker tilt
    this.spawn(
      at.x + (Math.random() - 0.5) * 0.5,
      at.y + 0.5,
      at.z + (Math.random() - 0.5) * 0.5,
      (Math.random() - 0.5) * 0.5,
      1.6 + Math.random() * 1.2,
      (Math.random() - 0.5) * 0.5,
      Math.random() < 0.4 ? 0xffd14d : 0xff7a2a,
      0.2,
      1.0 + Math.random() * 0.6,
      -0.4,
      SPR.flame,
      (Math.random() - 0.5) * 0.6,
    );
  }

  // ---------------------------------------------------------------------

  update(dt: number): void {
    // projectiles home on their (moving) target
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.ttl -= dt;
      const target = this.anchor(pr.targetId, 0.5);
      if (!target || pr.ttl <= 0) {
        this.projectiles.splice(i, 1);
        continue;
      }
      const dir = target.clone().sub(pr.pos);
      const dist = dir.length();
      const step = pr.speed * dt;
      if (dist <= Math.max(0.7, step)) {
        // impact: school-tinted cross-flash + burst that survives a 30fps frame
        this.tmpColor.copy(pr.color).multiplyScalar(hdr(1.6));
        this.spawn(target.x, target.y, target.z, 0, 0.5, 0, this.tmpColor, 1.1, 0.22, 0, SPR.flash);
        for (let k = 0; k < this.scaledCount(22); k++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 2.5 + Math.random() * 4;
          this.spawn(
            target.x,
            target.y,
            target.z,
            Math.sin(a) * sp,
            Math.random() * 3,
            Math.cos(a) * sp,
            this.tmpColor,
            0.44,
            0.55,
            7,
            k % 2 === 0 ? SPR.sparkle : SPR.sparkBurst,
          );
        }
        this.projectiles.splice(i, 1);
        continue;
      }
      const ux = dir.x / dist; // unit travel direction (before the step scale below)
      const uy = dir.y / dist;
      const uz = dir.z / dist;
      dir.multiplyScalar(step / dist);
      pr.pos.add(dir);
      if (pr.lightning) {
        // The flying head is a short jagged electric streak trailing back along
        // the travel direction: a few segments, each kicked perpendicular for the
        // zig-zag, so it reads as a lightning bolt shape rather than a round comet.
        const ph = Math.hypot(ux, uz) || 1;
        const perpX = -uz / ph;
        const perpZ = ux / ph;
        let lat = 0;
        let vy = 0;
        for (let s = 0; s < 5; s++) {
          lat = lat * 0.45 + (Math.random() - 0.5) * 0.75;
          vy = vy * 0.45 + (Math.random() - 0.5) * 0.55;
          const back = s * 0.55;
          const x = pr.pos.x - ux * back + perpX * lat;
          const y = pr.pos.y - uy * back + vy;
          const z = pr.pos.z - uz * back + perpZ * lat;
          const head = s === 0;
          this.spawn(
            x,
            y,
            z,
            0,
            0,
            0,
            head ? pr.coreColor : pr.color,
            head ? 0.5 : 0.36,
            0.13,
            0,
            SPR.glowCore,
          );
          this.spawn(x, y, z, 0, 0, 0, pr.trailColor, head ? 0.7 : 0.5, 0.15, 0, SPR.glowSoft);
        }
        // an occasional crackle spark flung off the head
        if (Math.random() < 0.6) {
          this.spawn(
            pr.pos.x + (Math.random() - 0.5) * 0.3,
            pr.pos.y + (Math.random() - 0.5) * 0.3,
            pr.pos.z + (Math.random() - 0.5) * 0.3,
            (Math.random() - 0.5) * 1.4,
            0.3,
            (Math.random() - 0.5) * 1.4,
            pr.trailColor,
            0.22,
            0.3,
            1.5,
            SPR.sparkle,
          );
        }
      } else {
        // bright HDR core (blooms into a comet) + sparkling trail
        this.spawn(
          pr.pos.x,
          pr.pos.y,
          pr.pos.z,
          0,
          0,
          0,
          pr.coreColor,
          1.0,
          0.12,
          0,
          pr.coreSprite,
        );
        if (Math.random() < 0.35 + 0.65 * this.quality) {
          this.spawn(
            pr.pos.x + (Math.random() - 0.5) * 0.25,
            pr.pos.y + (Math.random() - 0.5) * 0.25,
            pr.pos.z + (Math.random() - 0.5) * 0.25,
            (Math.random() - 0.5) * 0.8,
            0.4,
            (Math.random() - 0.5) * 0.8,
            pr.trailColor,
            0.32,
            0.6,
            1.5,
            pr.trailSprite,
          );
        }
      }
    }

    // advance the pool
    for (let i = 0; i < CAPACITY; i++) {
      if (this.life[i] <= 0) {
        if (this.size[i] !== 0) this.size[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const f = Math.max(0, this.life[i] / this.maxLife[i]);
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.alphaAttr[i] = f < 0.25 ? f * 4 : 1;
      if (this.life[i] <= 0) this.size[i] = 0;
    }
    const geo = this.points.geometry;
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aSprite as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aRot as THREE.BufferAttribute).needsUpdate = true;
  }
}
