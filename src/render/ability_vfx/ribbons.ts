import * as THREE from 'three';
import type { VfxAnchorResolver } from '../vfx_anchor';
import { type AbilityVfxTextures, OVERLAY_CELL } from './fx_textures';
import { slashWidthScale } from './spectacle';

// Camera-facing ribbon trails, ported from the gallery's RibbonMesh +
// genBolt/smoothArc (arc_bolt_preview.js, ribbons section). One pooled dynamic
// mesh redrawn immediate-mode every frame from three fixed slot families:
// jagged flicker bolts (lightning cracks), comet trails that chase the pooled
// Vfx projectile, and slash arcs (melee strike reads). Hard caps on verts and
// slots; every point buffer is preallocated, so steady state allocates nothing.

const MAX_VERTS = 4096;
const MAX_INDICES = MAX_VERTS * 3;
const BOLT_SLOTS = 10;
const BOLT_PTS = 17; // 4 midpoint-displacement passes on a 2-point seed
const TRAIL_SLOTS = 12;
const TRAIL_PTS = 9;
const ARC_SLOTS = 20;
const ARC_PTS = 12;
const TRAIL_SPEED = 26; // yards/sec, matches Vfx.projectile so the trail rides the comet
const WHITE = new THREE.Color(0xffffff);
const COIL_PTS = 14; // gallery coil resolution: 14 samples over the 1.9 yd tail
const COIL_DIRS = [1, -1]; // twin counter-rotating helices

// Per-style projectile identity, ported from the gallery's buildProjMesh +
// trail feel (arc_bolt_preview.js bolt archetype). Styled trails carry their
// own head sprite (drawHeads), so the generic Vfx comet stays off for them.
export type BoltTrailStyle = 'comet' | 'rock' | 'shard' | 'arrow' | 'wisp';

// Trail strip DNA per style: width and brightness multipliers over the
// baseline comet ribbon (glow strip / core strip).
const TRAIL_DNA: Record<
  BoltTrailStyle,
  { wGlow: number; mGlow: number; wCore: number; mCore: number }
> = {
  comet: { wGlow: 1, mGlow: 1, wCore: 1, mCore: 1 },
  rock: { wGlow: 1.35, mGlow: 1, wCore: 1.2, mCore: 0.7 }, // fat dim molten wake
  shard: { wGlow: 0.65, mGlow: 0.85, wCore: 0.6, mCore: 1.3 }, // narrow crisp glint
  arrow: { wGlow: 0.4, mGlow: 0.55, wCore: 0.4, mCore: 1.1 }, // whisper-thin streak
  wisp: { wGlow: 1.25, mGlow: 1.25, wCore: 1, mCore: 0.65 }, // soft smoky drift
};

// Spawn-time options for a styled projectile trail (the full spec's bolt DNA).
// Garnish flags (coils/jagTrail/forkEvery/tracer) are pre-gated by the caller's
// degrade tier; delay staggers volley followers, aim offsets their landing.
export interface StyledTrailOpts {
  speed: number;
  style: BoltTrailStyle;
  headSize: number; // 0 = no head sprite (legacy trails riding a Vfx comet)
  coils: boolean;
  jagTrail: boolean;
  forkEvery: number;
  tracer: boolean;
  delay: number;
  aimX: number;
  aimY: number;
  aimZ: number;
  groundY: ((x: number, z: number) => number) | null;
}

const LEGACY_TRAIL_OPTS: StyledTrailOpts = {
  speed: TRAIL_SPEED,
  style: 'comet',
  headSize: 0,
  coils: false,
  jagTrail: false,
  forkEvery: 0,
  tracer: false,
  delay: 0,
  aimX: 0,
  aimY: 0,
  aimZ: 0,
  groundY: null,
};

function allocPts(n: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) pts.push(new THREE.Vector3());
  return pts;
}

interface BoltSlot {
  active: boolean;
  age: number;
  life: number;
  lastGen: number;
  sourceId: number;
  targetId: number;
  // fixed-endpoint mode (motif ground cracks): endpoints in world space
  // instead of live entity anchors
  fixed: boolean;
  fromP: THREE.Vector3;
  toP: THREE.Vector3;
  width: number;
  jagScale: number;
  core: THREE.Color;
  glow: THREE.Color;
  pts: THREE.Vector3[];
  count: number;
}

interface TrailSlot {
  active: boolean;
  targetId: number;
  sourceId: number;
  ttl: number;
  width: number;
  core: THREE.Color;
  glow: THREE.Color;
  colorHex: number;
  coreHex: number;
  head: THREE.Vector3;
  ring: THREE.Vector3[]; // last TRAIL_PTS head positions, oldest overwritten
  ringHead: number;
  ringCount: number;
  onArrive: ((x: number, y: number, z: number) => void) | null;
  // fixed world-point target (ground-aimed volleys): when set, the head flies
  // to fixedTo instead of chasing a live entity anchor
  fixedTarget: boolean;
  fixedTo: THREE.Vector3;
  // styled-bolt DNA (see StyledTrailOpts); legacy comet trails zero these out
  speed: number;
  style: BoltTrailStyle;
  headSize: number;
  delay: number;
  coils: boolean;
  coilPhase: number;
  jagTrail: boolean;
  jagTimer: number;
  forkEvery: number;
  forkTimer: number;
  tracer: boolean;
  origin: THREE.Vector3; // launch point (tracer etch endpoint)
  aim: THREE.Vector3; // target-anchor offset (volley spread)
  dir: THREE.Vector3; // unit travel direction (coils/jag/forks)
  groundY: ((x: number, z: number) => number) | null;
  seed: number; // per-slot phase for head shimmer/writhe
}

interface ArcSlot {
  active: boolean;
  age: number;
  life: number;
  width: number;
  core: THREE.Color;
  glow: THREE.Color;
  pts: THREE.Vector3[];
}

// The shared VFX anchor resolver (src/render/vfx_anchor.ts). `out` lets a
// per-frame path resolve into its own scratch instead of allocating.
export type RibbonAnchor = VfxAnchorResolver;

// Plain world point (structurally satisfied by THREE.Vector3).
export interface RibbonPoint {
  x: number;
  y: number;
  z: number;
}

export class AbilityVfxRibbons {
  private geo = new THREE.BufferGeometry();
  private pos = new Float32Array(MAX_VERTS * 3);
  private col = new Float32Array(MAX_VERTS * 3);
  private uv = new Float32Array(MAX_VERTS * 2);
  private idx = new Uint32Array(MAX_INDICES);
  private mat: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;
  private v = 0;
  private i = 0;
  private wasEmpty = true;
  private time = 0;

  private bolts: BoltSlot[] = [];
  private trails: TrailSlot[] = [];
  private arcs: ArcSlot[] = [];

  private t1 = new THREE.Vector3();
  private t2 = new THREE.Vector3();
  private t3 = new THREE.Vector3();
  // s1/s2 survive across a whole coil/fork computation (t1..t3 are clobbered
  // by add()/genBolt, so style garnish gets its own scratch pair)
  private s1 = new THREE.Vector3();
  private s2 = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  // Per-frame anchor scratch (see ../vfx_anchor.ts): update() resolves a trail's
  // source or target every frame and genBolt() resolves both ends of a live
  // bolt. a1/a2 are separate because genBolt holds both readings at once; each
  // is consumed before the next resolve into it.
  private a1 = new THREE.Vector3();
  private a2 = new THREE.Vector3();
  private ordered: THREE.Vector3[] = allocPts(TRAIL_PTS + 1); // scratch, holds refs only
  private coilScratch: THREE.Vector3[] = allocPts(COIL_PTS); // reused for both helices

  constructor(
    scene: THREE.Scene,
    private anchor: RibbonAnchor,
    tex: AbilityVfxTextures,
  ) {
    this.geo.setAttribute(
      'position',
      new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.geo.setAttribute(
      'aCol',
      new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.geo.setAttribute(
      'uv',
      new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage),
    );
    this.geo.setIndex(new THREE.BufferAttribute(this.idx, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(450, 0, 0), 2400);
    // Energy visibly flows along the strip: scrolling fBm over the soft ribbon
    // cross-section (the gallery's aFlow collapsed to a constant scroll).
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: tex.ribbon }, uNoise: { value: tex.noise }, uTime: { value: 0 } },
      vertexShader: `
        attribute vec3 aCol;
        varying vec2 vUv;
        varying vec3 vColor;
        void main() {
          vUv = uv;
          vColor = aCol;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D uMap;
        uniform sampler2D uNoise;
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vColor;
        void main() {
          vec4 base = texture2D(uMap, vUv);
          float flow = 0.6 + 0.9 * texture2D(uNoise, vec2(vUv.x * 1.1 - uTime * 1.8, vUv.y * 0.4)).r;
          gl_FragColor = vec4(vColor * flow, base.a * min(flow, 1.1));
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.userData.renderCategory = 'vfx';
    scene.add(this.mesh);
    for (let i = 0; i < BOLT_SLOTS; i++) {
      this.bolts.push({
        active: false,
        age: 0,
        life: 0,
        lastGen: -1,
        sourceId: 0,
        targetId: 0,
        fixed: false,
        fromP: new THREE.Vector3(),
        toP: new THREE.Vector3(),
        width: 0.1,
        jagScale: 1,
        core: new THREE.Color(),
        glow: new THREE.Color(),
        pts: allocPts(BOLT_PTS),
        count: 0,
      });
    }
    for (let i = 0; i < TRAIL_SLOTS; i++) {
      this.trails.push({
        active: false,
        targetId: 0,
        sourceId: 0,
        ttl: 0,
        width: 0.2,
        core: new THREE.Color(),
        glow: new THREE.Color(),
        colorHex: 0xffffff,
        coreHex: 0xffffff,
        head: new THREE.Vector3(),
        ring: allocPts(TRAIL_PTS),
        ringHead: 0,
        ringCount: 0,
        onArrive: null,
        fixedTarget: false,
        fixedTo: new THREE.Vector3(),
        speed: TRAIL_SPEED,
        style: 'comet',
        headSize: 0,
        delay: 0,
        coils: false,
        coilPhase: 0,
        jagTrail: false,
        jagTimer: 0,
        forkEvery: 0,
        forkTimer: 0,
        tracer: false,
        origin: new THREE.Vector3(),
        aim: new THREE.Vector3(),
        dir: new THREE.Vector3(1, 0, 0),
        groundY: null,
        seed: 0,
      });
    }
    for (let i = 0; i < ARC_SLOTS; i++) {
      this.arcs.push({
        active: false,
        age: 0,
        life: 0,
        width: 0.3,
        core: new THREE.Color(),
        glow: new THREE.Color(),
        pts: allocPts(ARC_PTS),
      });
    }
  }

  // A jagged electric crack from caster to target, regenerated every ~45ms so
  // it flickers (the gallery genBolt read, main line only: branches cost too
  // much churn for a crowd scene). Tracks both moving anchors. jagScale near 0
  // turns the crack into a wavering channel beam (drains, mind rays).
  spawnBolt(
    sourceId: number,
    targetId: number,
    colorHex: number,
    life = 0.22,
    width = 0.09,
    jagScale = 1,
  ): void {
    const slot = this.bolts.find((b) => !b.active) ?? this.bolts[0];
    slot.active = true;
    slot.age = 0;
    slot.life = life;
    slot.lastGen = -1;
    slot.sourceId = sourceId;
    slot.targetId = targetId;
    slot.fixed = false;
    slot.width = width;
    slot.jagScale = jagScale;
    slot.core.setHex(colorHex).lerp(WHITE, 0.55);
    slot.glow.setHex(colorHex);
    slot.count = 0;
  }

  // Fixed-endpoint variant (motif ground cracks, sky strikes): same flicker
  // regeneration between two world points instead of live entity anchors.
  // delay holds the slot dark before it first draws (the lightning family's
  // return stroke answering its leader).
  spawnBoltPoints(
    fx: number,
    fy: number,
    fz: number,
    tx: number,
    ty: number,
    tz: number,
    colorHex: number,
    life = 0.3,
    width = 0.12,
    jagScale = 1,
    delay = 0,
  ): void {
    const slot = this.bolts.find((b) => !b.active) ?? this.bolts[0];
    slot.active = true;
    slot.age = -delay;
    slot.life = life;
    slot.lastGen = -1;
    slot.fixed = true;
    slot.fromP.set(fx, fy, fz);
    slot.toP.set(tx, ty, tz);
    slot.width = width;
    slot.jagScale = jagScale;
    slot.core.setHex(colorHex).lerp(WHITE, 0.55);
    slot.glow.setHex(colorHex);
    slot.count = 0;
  }

  // A generic short-lived path ribbon: the caller fills the slot's
  // preallocated points (helix climbs, chain sags, fountain streams, gavel
  // strokes) and returns how many it wrote. Spawn-time-only closure cost.
  spawnPath(
    colorHex: number,
    width: number,
    life: number,
    fill: (pts: THREE.Vector3[]) => number,
  ): void {
    const slot = this.arcs.find((a) => !a.active) ?? this.arcs[0];
    const count = Math.min(ARC_PTS, Math.max(0, fill(slot.pts)));
    if (count < 2) return;
    // pad the unwritten tail onto the last point so the strip stays degenerate
    for (let i = count; i < ARC_PTS; i++) slot.pts[i].copy(slot.pts[count - 1]);
    slot.active = true;
    slot.age = 0;
    slot.life = life;
    slot.width = width;
    slot.core.setHex(colorHex).lerp(WHITE, 0.5);
    slot.glow.setHex(colorHex);
  }

  // A comet trail chasing the pooled Vfx projectile: advances with the same
  // speed/anchors, leaving a tapered ribbon through its recent positions.
  spawnTrail(
    sourceId: number,
    targetId: number,
    colorHex: number,
    width: number,
    onArrive: ((x: number, y: number, z: number) => void) | null = null,
  ): void {
    this.spawnTrailStyled(sourceId, targetId, colorHex, width, LEGACY_TRAIL_OPTS, onArrive);
  }

  // A styled projectile trail carrying the full spec's bolt DNA: its own head
  // sprite (the trail IS the projectile - no Vfx comet rides along), authored
  // speed, and the tier-gated garnish the caller enabled in opts.
  spawnTrailStyled(
    sourceId: number,
    targetId: number,
    colorHex: number,
    width: number,
    opts: StyledTrailOpts,
    onArrive: ((x: number, y: number, z: number) => void) | null = null,
  ): void {
    this.spawnTrailSlot(sourceId, targetId, null, colorHex, width, opts, onArrive);
  }

  // Point-target variant (ground-aimed bolt volleys): the trail flies from the
  // caster's hand to a FIXED world point instead of a live entity anchor, so
  // an aimed cast's projectiles visibly cross the air to where it was aimed.
  // opts.aim still offsets the landing (the volley fan spread).
  spawnTrailStyledTo(
    sourceId: number,
    tx: number,
    ty: number,
    tz: number,
    colorHex: number,
    width: number,
    opts: StyledTrailOpts,
    onArrive: ((x: number, y: number, z: number) => void) | null = null,
  ): void {
    this.s2.set(tx, ty, tz);
    this.spawnTrailSlot(sourceId, -1, this.s2, colorHex, width, opts, onArrive);
  }

  private spawnTrailSlot(
    sourceId: number,
    targetId: number,
    fixedTo: THREE.Vector3 | null,
    colorHex: number,
    width: number,
    opts: StyledTrailOpts,
    onArrive: ((x: number, y: number, z: number) => void) | null,
  ): void {
    const from = this.anchor(sourceId, 0.62);
    if (!from) return;
    const slot = this.trails.find((t) => !t.active) ?? this.trails[0];
    slot.active = true;
    slot.targetId = targetId;
    slot.sourceId = sourceId;
    slot.fixedTarget = fixedTo !== null;
    if (fixedTo) slot.fixedTo.copy(fixedTo);
    slot.width = width;
    slot.core.setHex(colorHex).lerp(WHITE, 0.4);
    slot.glow.setHex(colorHex);
    slot.colorHex = colorHex;
    slot.coreHex = slot.core.getHex();
    slot.head.copy(from);
    slot.ring[0].copy(from);
    slot.ringHead = 1 % TRAIL_PTS;
    slot.ringCount = 1;
    slot.onArrive = onArrive;
    slot.speed = Math.max(4, opts.speed);
    slot.style = opts.style;
    slot.headSize = opts.headSize;
    slot.delay = opts.delay;
    slot.coils = opts.coils;
    slot.coilPhase = 0;
    slot.jagTrail = opts.jagTrail;
    slot.jagTimer = 0;
    slot.forkEvery = opts.forkEvery;
    slot.forkTimer = opts.forkEvery * (0.4 + Math.random() * 0.6);
    slot.tracer = opts.tracer;
    slot.origin.copy(from);
    slot.aim.set(opts.aimX, opts.aimY, opts.aimZ);
    slot.groundY = opts.groundY;
    slot.seed = Math.random() * Math.PI * 2;
    // life scales with the real flight time (a 7 yd/s orb crossing 30 yd
    // must not evaporate at the legacy 3 s cap)
    const to = slot.fixedTarget ? slot.fixedTo : this.anchor(targetId, 0.5);
    if (to) {
      this.s1.copy(to).add(slot.aim).sub(from);
      const dist = this.s1.length();
      if (dist > 1e-6) slot.dir.copy(this.s1).multiplyScalar(1 / dist);
      else slot.dir.set(1, 0, 0);
      slot.ttl = opts.delay + Math.min(10, Math.max(3, dist / slot.speed + 1.5));
    } else {
      slot.dir.set(1, 0, 0);
      slot.ttl = opts.delay + 3;
    }
  }

  // A bowed slash arc through a world point (melee strike read): computed once
  // into the slot's preallocated points, fades fast.
  spawnSlash(at: RibbonPoint, colorHex: number, span = 1.15, life = 0.22): void {
    this.slashOne(at, colorHex, span, life, (Math.random() - 0.5) * 1.1, 0, 0.34);
  }

  // The gallery's authored slash/trail vocabulary: every strike arc style and
  // impact trail style maps onto oriented slash strips through the target.
  // Strip width follows the span scale (slashWidthScale) so a scaled-up arc
  // keeps its aspect instead of thinning into a hoop.
  spawnSlashStyled(at: RibbonPoint, colorHex: number, style: string, scale = 1): void {
    const w = slashWidthScale(scale);
    switch (style) {
      case 'vertical':
      case 'overhead':
        // overhead chop: top-to-bottom, nearly no horizontal travel
        this.slashOne(at, colorHex, 0.35 * scale, 0.26, 3.2, 0.55 * scale, 0.3 * w);
        break;
      case 'uppercut':
        // rising cut: bottom-to-top with a forward kick
        this.slashOne(at, colorHex, 0.5 * scale, 0.26, -2.6, 0.5 * scale, 0.3 * w);
        break;
      case 'thrust':
        // straight lunge: long, narrow, almost flat
        this.slashOne(at, colorHex, 1.5 * scale, 0.18, 0.05, 0, 0.12 * w);
        break;
      case 'low':
        // ankle-height reap
        this.slashOne(at, colorHex, 1.1 * scale, 0.2, 0.15, -0.45, 0.28 * w);
        break;
      case 'sweep':
        // extra-wide retaliatory sweep
        this.slashOne(at, colorHex, 1.6 * scale, 0.26, 0.25, 0, 0.4 * w);
        break;
      case 'riposte':
        this.slashOne(at, colorHex, 1.0 * scale, 0.2, 0.9, 0.15, 0.26 * w);
        break;
      case 'x':
      case 'cross':
        // two crossing diagonals
        this.slashOne(at, colorHex, 1.05 * scale, 0.26, 1.1, 0.1, 0.3 * w);
        this.slashOne(at, colorHex, 1.05 * scale, 0.3, -1.1, 0.1, 0.3 * w);
        break;
      case 'claws':
        // three parallel raking gashes
        for (let k = -1; k <= 1; k++)
          this.slashOne(at, colorHex, 0.85 * scale, 0.24, 1.4, 0.3 * k, 0.16 * w);
        break;
      case 'bite':
        // two opposing jaw arcs snapping shut
        this.slashOne(at, colorHex, 0.7 * scale, 0.2, 2.4, 0.4, 0.22 * w);
        this.slashOne(at, colorHex, 0.7 * scale, 0.22, -2.4, -0.4, 0.22 * w);
        break;
      case 'crescent':
        // one moon-blade: wide, heavily bowed
        this.slashOne(at, colorHex, 1.3 * scale, 0.3, 0.4, 0.2, 0.5 * w);
        break;
      case 'wire':
        // the garrote filament: a short TAUT strip between the strangler's
        // fists - hair-thin, dead straight (no bow, no tilt), steel-bright
        // (the metallic glint outlives the spec hue via the heavier white
        // lerp in wireOne). Deliberately small next to every sword arc.
        this.wireOne(at, colorHex, 0.12 * scale, 0.3, 0.05 * w);
        break;
      default:
        // 'horizontal' / 'arc': the flat baseline sweep with a random tilt
        this.slashOne(at, colorHex, 1.15 * scale, 0.22, (Math.random() - 0.5) * 1.1, 0, 0.34 * w);
        break;
    }
  }

  // The taut wire strip: same pooled arc slot as slashOne but dead straight
  // across the camera-facing side axis, with a heavier white lerp so the
  // filament reads as drawn steel rather than a colored energy arc.
  private wireOne(
    at: RibbonPoint,
    colorHex: number,
    span: number,
    life: number,
    width: number,
  ): void {
    const slot = this.arcs.find((a) => !a.active) ?? this.arcs[0];
    slot.active = true;
    slot.age = 0;
    slot.life = life;
    slot.width = width;
    slot.core.setHex(colorHex).lerp(WHITE, 0.85);
    slot.glow.setHex(colorHex).lerp(WHITE, 0.4);
    const dx = at.x - this.camPos.x;
    const dz = at.z - this.camPos.z;
    const len = Math.hypot(dx, dz) || 1;
    const sx = -dz / len;
    const sz = dx / len;
    for (let i = 0; i < ARC_PTS; i++) {
      const u = i / (ARC_PTS - 1);
      const swing = (u - 0.5) * 2;
      slot.pts[i].set(at.x + sx * swing * span, at.y, at.z + sz * swing * span);
    }
  }

  // One oriented slash strip: tilt skews the vertical travel across the swing
  // (large = vertical chop, negative = rising), lift offsets the whole arc.
  private slashOne(
    at: RibbonPoint,
    colorHex: number,
    span: number,
    life: number,
    tilt: number,
    lift: number,
    width: number,
  ): void {
    const slot = this.arcs.find((a) => !a.active) ?? this.arcs[0];
    slot.active = true;
    slot.age = 0;
    slot.life = life;
    slot.width = width;
    slot.core.setHex(colorHex).lerp(WHITE, 0.5);
    slot.glow.setHex(colorHex);
    // side axis perpendicular to the camera ray on XZ, so the arc always shows
    // its face
    const dx = at.x - this.camPos.x;
    const dz = at.z - this.camPos.z;
    const len = Math.hypot(dx, dz) || 1;
    const sx = -dz / len;
    const sz = dx / len;
    for (let i = 0; i < ARC_PTS; i++) {
      const u = i / (ARC_PTS - 1);
      const swing = (u - 0.5) * 2; // -1..1 across the target
      const bowY = Math.sin(u * Math.PI) * 0.34;
      slot.pts[i].set(
        at.x + sx * swing * span,
        at.y + lift + bowY + swing * tilt * 0.4,
        at.z + sz * swing * span,
      );
    }
  }

  update(dt: number, camPos: THREE.Vector3): void {
    this.time += dt;
    this.camPos.copy(camPos);
    this.v = 0;
    this.i = 0;

    for (const b of this.bolts) {
      if (!b.active) continue;
      b.age += dt;
      if (b.age >= b.life) {
        b.active = false;
        continue;
      }
      if (b.age < 0) continue; // delayed strike (a return stroke) still pending
      if (b.age - b.lastGen >= 0.045) {
        b.lastGen = b.age;
        this.genBolt(b);
      }
      if (b.count < 2) continue;
      const k = (1 - b.age / b.life) ** 0.7;
      this.add(b.pts, b.count, b.width * 3.2, b.glow, 1.3 * k, 1);
      this.add(b.pts, b.count, b.width, b.core, 2.6 * k, 1);
    }

    for (const t of this.trails) {
      if (!t.active) continue;
      if (t.delay > 0) {
        // staggered volley follower: ride the caster's hand until launch
        t.delay -= dt;
        t.ttl -= dt;
        const from = this.anchor(t.sourceId, 0.62, this.a1);
        if (from) {
          t.head.copy(from);
          t.origin.copy(from);
          t.ring[0].copy(from);
          t.ringHead = 1 % TRAIL_PTS;
          t.ringCount = 1;
        }
        continue;
      }
      t.ttl -= dt;
      const target = t.fixedTarget ? t.fixedTo : this.anchor(t.targetId, 0.5, this.a1);
      if (!target || t.ttl <= 0) {
        t.active = false;
        continue;
      }
      this.s1.copy(target).add(t.aim);
      this.t1.subVectors(this.s1, t.head);
      const dist = this.t1.length();
      const step = t.speed * dt;
      if (dist <= Math.max(0.7, step)) {
        if (t.tracer) this.spawnTracer(t, this.s1.x, this.s1.y, this.s1.z);
        if (t.onArrive) t.onArrive(this.s1.x, this.s1.y, this.s1.z);
        t.active = false;
        continue;
      }
      t.dir.copy(this.t1).multiplyScalar(1 / dist);
      t.head.addScaledVector(t.dir, step);
      t.ring[t.ringHead].copy(t.head);
      t.ringHead = (t.ringHead + 1) % TRAIL_PTS;
      if (t.ringCount < TRAIL_PTS) t.ringCount++;
      // style garnish (the spawner already gated these by degrade tier)
      if (t.coils) this.drawCoils(t, dt);
      if (t.jagTrail) {
        // the gallery's flicker cadence: regen the electric tail every ~45ms
        t.jagTimer -= dt;
        if (t.jagTimer <= 0) {
          t.jagTimer = 0.045;
          const len = Math.min(4, dist * 0.5 + 1);
          this.s1.copy(t.head).addScaledVector(t.dir, -len);
          this.spawnBoltPoints(
            this.s1.x,
            this.s1.y,
            this.s1.z,
            t.head.x,
            t.head.y,
            t.head.z,
            t.colorHex,
            0.1,
            t.width * 0.6,
            0.8,
          );
        }
      }
      if (t.forkEvery > 0 && t.groundY) {
        // periodic small fork bolts spitting off the head into the ground
        t.forkTimer -= dt;
        if (t.forkTimer <= 0) {
          t.forkTimer = t.forkEvery * (0.7 + Math.random() * 0.8);
          const fwd = 0.5 + Math.random() * 1.8;
          const side = (Math.random() - 0.5) * 4;
          const fxp = t.head.x + t.dir.x * fwd - t.dir.z * side;
          const fzp = t.head.z + t.dir.z * fwd + t.dir.x * side;
          this.spawnBoltPoints(
            t.head.x,
            t.head.y,
            t.head.z,
            fxp,
            t.groundY(fxp, fzp) + 0.08,
            fzp,
            t.colorHex,
            0.08 + Math.random() * 0.06,
            0.09,
            1.2,
          );
        }
      }
      // oldest-to-newest through the ring, head last (scratch holds refs only)
      let n = 0;
      for (let k = 0; k < t.ringCount; k++) {
        const idx = (t.ringHead - t.ringCount + k + TRAIL_PTS * 2) % TRAIL_PTS;
        this.ordered[n++] = t.ring[idx];
      }
      if (n >= 2) {
        const dna = TRAIL_DNA[t.style];
        this.add(this.ordered, n, t.width * 2.6 * dna.wGlow, t.glow, 1.2 * dna.mGlow, 0.85);
        this.add(this.ordered, n, t.width * dna.wCore, t.core, 2.2 * dna.mCore, 0.85);
      }
    }

    for (const a of this.arcs) {
      if (!a.active) continue;
      a.age += dt;
      if (a.age >= a.life) {
        a.active = false;
        continue;
      }
      const k = (1 - a.age / a.life) ** 2;
      this.add(a.pts, ARC_PTS, a.width * 2.4, a.glow, 1.1 * k, 0.9);
      this.add(a.pts, ARC_PTS, a.width, a.core, 2.4 * k, 0.9);
    }

    this.commit();
  }

  clear(): void {
    for (const b of this.bolts) b.active = false;
    for (const t of this.trails) t.active = false;
    for (const a of this.arcs) a.active = false;
  }

  // Per-style head sprites for the styled trails, emitted through the fx
  // engine's overlay batch (called between beginFrame and commit). The sink is
  // a stable closure owned by the caller; nothing here allocates.
  drawHeads(
    time: number,
    sink: (
      x: number,
      y: number,
      z: number,
      colorHex: number,
      size: number,
      cell: number,
      alpha: number,
      brightness: number,
    ) => void,
  ): void {
    for (const t of this.trails) {
      if (!t.active || t.headSize <= 0 || t.delay > 0) continue;
      const hs = t.headSize;
      const h = t.head;
      const pulse = 1 + 0.12 * Math.sin(time * 40 + t.seed);
      switch (t.style) {
        case 'shard':
          // elongated crystal glint: the thin spark flash over a faint halo
          sink(h.x, h.y, h.z, t.coreHex, 0.4 * hs * pulse, OVERLAY_CELL.spark, 0.95, 2.8);
          sink(h.x, h.y, h.z, t.colorHex, 0.3 * hs, OVERLAY_CELL.glow, 0.6, 1.1);
          break;
        case 'rock': {
          // molten boulder: a dim fat glow with two embers tumbling around it
          sink(h.x, h.y, h.z, t.colorHex, 0.5 * hs, OVERLAY_CELL.glow, 0.9, 1.15);
          for (let k = 0; k < 2; k++) {
            const a = time * 9 + t.seed + k * Math.PI;
            sink(
              h.x + Math.cos(a) * 0.18 * hs,
              h.y + Math.sin(a * 1.4) * 0.12 * hs,
              h.z + Math.sin(a) * 0.18 * hs,
              t.coreHex,
              0.15 * hs,
              OVERLAY_CELL.spark,
              0.85,
              2.1,
            );
          }
          break;
        }
        case 'wisp': {
          // three writhing blobs, no bright core (the gallery writhe read)
          for (let k = 0; k < 3; k++) {
            const ph = time * 6 + t.seed + k * 2.1;
            sink(
              h.x + Math.sin(ph) * 0.16 * hs,
              h.y + Math.cos(ph * 1.3 + k) * 0.13 * hs,
              h.z + Math.sin(ph * 0.7 + k * 4) * 0.16 * hs,
              t.colorHex,
              0.28 * hs,
              OVERLAY_CELL.glow,
              0.8,
              1.5,
            );
          }
          break;
        }
        case 'arrow':
          // near-invisible tip glint; the thin streak trail is the read
          sink(h.x, h.y, h.z, t.coreHex, 0.2 * hs, OVERLAY_CELL.spark, 0.9, 2.3);
          break;
        default:
          // comet: the classic bright core in a soft halo
          sink(h.x, h.y, h.z, t.colorHex, 0.55 * hs * pulse, OVERLAY_CELL.glow, 0.85, 1.5);
          sink(h.x, h.y, h.z, t.coreHex, 0.26 * hs * pulse, OVERLAY_CELL.star, 0.9, 2.6);
          break;
      }
    }
  }

  // Twin counter-rotating helical ribbons around the trail tail (the gallery
  // coil read: 1.9 yd behind the head, radius tapering toward the tail).
  private drawCoils(t: TrailSlot, dt: number): void {
    t.coilPhase += dt * 9 * Math.PI * 2;
    this.s1.set(0, 1, 0).cross(t.dir);
    if (this.s1.lengthSq() < 1e-6) this.s1.set(1, 0, 0);
    this.s1.normalize();
    this.s2.crossVectors(t.dir, this.s1);
    for (const dirn of COIL_DIRS) {
      for (let k = 0; k < COIL_PTS; k++) {
        const u = k / (COIL_PTS - 1);
        const ang = t.coilPhase * dirn + u * 7.5 * dirn;
        const r = 0.3 * (1 - u * 0.5);
        this.coilScratch[k]
          .copy(t.head)
          .addScaledVector(t.dir, -u * 1.9)
          .addScaledVector(this.s1, Math.cos(ang) * r)
          .addScaledVector(this.s2, Math.sin(ang) * r);
      }
      this.add(this.coilScratch, COIL_PTS, 0.08, t.core, 1.7, 0.5);
    }
  }

  // The etched flight path left behind on arrival: a slow-fading narrow
  // ribbon from the launch point to the impact, on an arc slot.
  private spawnTracer(t: TrailSlot, x: number, y: number, z: number): void {
    const slot = this.arcs.find((a) => !a.active) ?? this.arcs[0];
    slot.active = true;
    slot.age = 0;
    slot.life = 1.1;
    slot.width = 0.05;
    slot.core.copy(t.core);
    slot.glow.copy(t.glow);
    for (let i = 0; i < ARC_PTS; i++) {
      const u = i / (ARC_PTS - 1);
      slot.pts[i].set(
        t.origin.x + (x - t.origin.x) * u,
        t.origin.y + (y - t.origin.y) * u + Math.sin(u * Math.PI) * 0.15,
        t.origin.z + (z - t.origin.z) * u,
      );
    }
  }

  // Midpoint displacement into the slot's preallocated points (no branches).
  private genBolt(b: BoltSlot): void {
    const from = b.fixed ? b.fromP : this.anchor(b.sourceId, 0.62, this.a1);
    const to = b.fixed ? b.toP : this.anchor(b.targetId, 0.5, this.a2);
    if (!from || !to) {
      b.count = 0;
      return;
    }
    const pts = b.pts;
    pts[0].copy(from);
    pts[BOLT_PTS - 1].copy(to);
    this.t1.subVectors(to, from);
    const totalLen = this.t1.length() || 1;
    this.t1.multiplyScalar(1 / totalLen);
    this.t2
      .set(this.t1.y, -this.t1.x + 0.31, this.t1.z + 0.17)
      .cross(this.t1)
      .normalize();
    this.t3.crossVectors(this.t1, this.t2);
    let stride = BOLT_PTS - 1;
    let amp = totalLen * 0.14 * b.jagScale;
    while (stride > 1) {
      const half = stride / 2;
      for (let s = 0; s + stride < BOLT_PTS; s += stride) {
        const mid = pts[s + half];
        mid.lerpVectors(pts[s], pts[s + stride], 0.5);
        mid.addScaledVector(this.t2, (Math.random() * 2 - 1) * amp);
        mid.addScaledVector(this.t3, (Math.random() * 2 - 1) * amp);
      }
      stride = half;
      amp *= 0.52;
    }
    b.count = BOLT_PTS;
  }

  // Append one camera-facing tapered strip (the gallery RibbonMesh.add).
  private add(
    pts: THREE.Vector3[],
    n: number,
    width: number,
    color: THREE.Color,
    mul: number,
    taper: number,
  ): void {
    if (n < 2 || this.v + n * 2 > MAX_VERTS || this.i + (n - 1) * 6 > MAX_INDICES) return;
    const base = this.v;
    for (let k = 0; k < n; k++) {
      const p = pts[k];
      const prev = pts[Math.max(0, k - 1)];
      const next = pts[Math.min(n - 1, k + 1)];
      this.t1.subVectors(next, prev);
      this.t2.subVectors(this.camPos, p);
      this.t1.cross(this.t2);
      const tl = this.t1.length();
      if (tl > 1e-6) this.t1.multiplyScalar(1 / tl);
      const u = k / (n - 1);
      const pinch = taper > 0 ? Math.min(1, 4 * u * (1 - u) + (1 - taper)) : 1;
      const w = width * pinch * 0.5;
      const vi = (base + k * 2) * 3;
      this.pos[vi] = p.x + this.t1.x * w;
      this.pos[vi + 1] = p.y + this.t1.y * w;
      this.pos[vi + 2] = p.z + this.t1.z * w;
      this.pos[vi + 3] = p.x - this.t1.x * w;
      this.pos[vi + 4] = p.y - this.t1.y * w;
      this.pos[vi + 5] = p.z - this.t1.z * w;
      const r = color.r * mul;
      const g = color.g * mul;
      const bl = color.b * mul;
      this.col[vi] = r;
      this.col[vi + 1] = g;
      this.col[vi + 2] = bl;
      this.col[vi + 3] = r;
      this.col[vi + 4] = g;
      this.col[vi + 5] = bl;
      const ui = (base + k * 2) * 2;
      this.uv[ui] = u * 3;
      this.uv[ui + 1] = 0;
      this.uv[ui + 2] = u * 3;
      this.uv[ui + 3] = 1;
    }
    for (let k = 0; k < n - 1; k++) {
      const a = base + k * 2;
      this.idx[this.i++] = a;
      this.idx[this.i++] = a + 1;
      this.idx[this.i++] = a + 2;
      this.idx[this.i++] = a + 1;
      this.idx[this.i++] = a + 3;
      this.idx[this.i++] = a + 2;
    }
    this.v += n * 2;
  }

  private commit(): void {
    this.mat.uniforms.uTime.value = this.time % 3600;
    if (this.i === 0) {
      if (!this.wasEmpty) {
        this.wasEmpty = true;
        this.geo.setDrawRange(0, 0);
      }
      return;
    }
    this.wasEmpty = false;
    // Upload only the prefix this frame actually wrote (the pooled cloud's
    // idiom, ../vfx.ts packRenderCloud). The buffers are sized for the worst
    // case (MAX_VERTS is thousands of vertices, ~180 KB across the three
    // attributes plus the index), while a typical frame draws a handful of
    // strips: without a range every live ribbon frame re-uploaded the whole
    // set. Everything past the prefix is stale by design and unreachable,
    // because setDrawRange below stops at this.i. clearUpdateRanges first, so
    // a range queued on a frame the mesh was never submitted cannot pile up.
    const posAttr = this.geo.attributes.position as THREE.BufferAttribute;
    const colAttr = this.geo.attributes.aCol as THREE.BufferAttribute;
    const uvAttr = this.geo.attributes.uv as THREE.BufferAttribute;
    posAttr.clearUpdateRanges();
    posAttr.addUpdateRange(0, this.v * 3);
    posAttr.needsUpdate = true;
    colAttr.clearUpdateRanges();
    colAttr.addUpdateRange(0, this.v * 3);
    colAttr.needsUpdate = true;
    uvAttr.clearUpdateRanges();
    uvAttr.addUpdateRange(0, this.v * 2);
    uvAttr.needsUpdate = true;
    if (this.geo.index) {
      this.geo.index.clearUpdateRanges();
      this.geo.index.addUpdateRange(0, this.i);
      this.geo.index.needsUpdate = true;
    }
    this.geo.setDrawRange(0, this.i);
  }
}
