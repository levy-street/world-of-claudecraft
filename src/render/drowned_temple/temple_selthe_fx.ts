// Choirmother Selthe's water magic (sim: src/sim/encounters/drowned_temple/
// selthe.ts; her clips: Bolt, Beam, Surge), composed by temple_fx.ts:
//  - Moonwater Bolt: moonlit water gathers into an orb at her hands over the
//    2 s bar, spiralling in, then the orb is flung at her foe trailing spray
//    and bursts on them in a splash and a ring of foam;
//  - Drowning Aria: a torrent sung from her palms to whoever the beam strikes
//    now (the cast's target, or a body that stepped into it): a bright core
//    in a twisting sheath of turquoise water, spray boiling off the struck
//    body, a flare at every pulse, a burst of spray when it breaks;
//  - Mere Surge: while the bar runs the pool heaves and spray rises along the
//    wedge's front; on the crash a wall of water with a foaming crest rolls out
//    through the wedge to its 30 yd edge, with a camera kick for a player in
//    it. The wedge itself is the shared floor telegraph (temple_fx.ts).
// Cosmetic layer only (the actionable floor marks are temple_fx.ts's and draw
// on every tier); particle density sheds on the low tier.
//
// Rules (src/render/CLAUDE.md): every mesh and material is built once here,
// under the gated temple root and collapsed until that gate has linked them;
// after it the whole layer is hidden while Selthe is out of range and nothing
// plays (no idle draws anywhere in the world). No lights; the idle frame
// allocates nothing (a live effect's particle specs are short-lived literals,
// as in the crypt and Ysolei layers). Reduced motion stills the beam's
// flicker; the camera kicks ride the renderer's own reduced-motion gate.
// State is read off IWorld (her cast bar and cast target, the spellfx cues),
// so offline and online look the same.

import * as THREE from 'three';
import {
  SELTHE_ARIA_BROKEN,
  SELTHE_ARIA_PULSE,
  SELTHE_DROWNING_ARIA,
  SELTHE_ID,
  SELTHE_MERE_SURGE,
  SELTHE_MOONWATER_BOLT,
  SELTHE_TUNING,
} from '../../sim/encounters/drowned_temple/ids';
import type { SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { GLOW_FRAG, PARTICLE_VERT, ParticlePool } from '../hollow_crypt/crypt_fx_particles';

const COLLAPSED = 1e-4;
const SCAN_SEC = 0.5;
/** Her hands at a cast: this high over her pool and this far ahead (her
 *  drawn 9 yd body; the art guide's Bolt holds the orb 5.4 up and 2.0 ahead
 *  through its bar, the aria's palms reach on to 3 ahead). */
const HAND_UP = 5.4;
const HAND_AHEAD = 2.2;
/** A player's chest over their feet. */
const CHEST = 1.3;
/** A bolt's flight time (seconds): fast, it lands with its damage. */
const BOLT_FLIGHT = 0.26;
const SURGE_LIFE = 0.75;
/** Beyond this range of the player her layer sleeps (yards). */
const AWAKE_RANGE = 160;

const NOISE = /* glsl */ `
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
`;

// Water droplets and foam: a translucent bead with a white highlight and a
// bright rim (never the crypt's smoky dust).
const SPRAY_FRAG = /* glsl */ `
varying float vT;
varying float vSeed;
varying vec4 vColor;
varying vec2 vUv;
void main() {
  vec2 d = vUv - 0.5;
  float r = length(d) * 2.0;
  float body = 1.0 - smoothstep(0.6, 1.0, r);
  float rim = smoothstep(0.45, 0.85, r) * body;
  float hi = 1.0 - smoothstep(0.0, 0.3, length(d - vec2(-0.14, 0.14)) * 2.0);
  float fade = smoothstep(0.0, 0.06, vT) * (1.0 - smoothstep(0.45, 1.0, vT));
  vec3 water = vColor.rgb * vec3(0.5, 0.86, 1.0);
  vec3 col = mix(water, vec3(1.0), clamp(hi * 0.85 + rim * 0.5, 0.0, 1.0));
  gl_FragColor = vec4(col, body * fade * vColor.a * (0.55 + 0.45 * rim + 0.4 * hi));
}
`;

const UV_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalV;
void main() {
  vUv = uv;
  vNormalV = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// The bolt's orb: moonwater with a white core and a swirling rim (additive).
const ORB_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
varying vec3 vNormalV;
${NOISE}
void main() {
  float rim = 1.0 - abs(vNormalV.z);
  float swirl = vnoise(vec2(vUv.x * 12.0 + uTime * 3.0, vUv.y * 6.0 - uTime * 2.0));
  vec3 col = mix(vec3(0.35, 0.85, 1.0), vec3(0.95, 1.0, 1.0), pow(max(1.0 - rim, 0.0), 2.0));
  col += vec3(0.6, 0.95, 1.0) * swirl * rim;
  gl_FragColor = vec4(col, uAlpha * (0.45 + 0.55 * (1.0 - rim) + 0.4 * swirl * rim));
  #include <colorspace_fragment>
}
`;

// The aria: a cylinder along +y. The core is a bright additive thread; the
// sheath a twisting turquoise torrent with streaks racing toward the target.
const BEAM_CORE_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
uniform float uFlare;
varying vec2 vUv;
varying vec3 vNormalV;
${NOISE}
void main() {
  float face = abs(vNormalV.z);
  float streak = vnoise(vec2(vUv.x * 10.0, vUv.y * 18.0 - uTime * 22.0));
  vec3 col = mix(vec3(0.55, 0.95, 1.0), vec3(1.0), face);
  gl_FragColor = vec4(col * (0.9 + 0.6 * streak + uFlare), uAlpha * pow(max(face, 0.0), 2.0) * (0.45 + 0.55 * streak));
  #include <colorspace_fragment>
}
`;

const BEAM_SHEATH_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
uniform float uFlare;
varying vec2 vUv;
varying vec3 vNormalV;
${NOISE}
void main() {
  float face = abs(vNormalV.z);
  // A twist: the streaks wind round the beam as they race along it.
  vec2 q = vec2(vUv.x * 6.0 + vUv.y * 9.0 - uTime * 3.0, vUv.y * 14.0 - uTime * 16.0);
  float n = vnoise(q) * 0.6 + vnoise(q * 2.3) * 0.4;
  float foam = smoothstep(0.62, 0.9, n);
  vec3 col = mix(vec3(0.08, 0.45, 0.6), vec3(0.55, 0.92, 1.0), n);
  col = mix(col, vec3(0.95, 1.0, 1.0), foam);
  // Transparent at the silhouette, torn into streaks: a torrent, not a tube.
  float tear = smoothstep(0.35, 0.75, n);
  float a = uAlpha * pow(max(face, 0.0), 1.6) * (0.06 + 0.5 * tear + 0.45 * foam);
  gl_FragColor = vec4(col * (1.0 + uFlare * 0.8), a);
  #include <colorspace_fragment>
}
`;

// A wall of water on an arc (an open cylinder segment): foam on its crest.
const WALL_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
${NOISE}
void main() {
  float n = vnoise(vec2(vUv.x * 40.0, vUv.y * 3.0 - uTime * 4.0));
  float m = vnoise(vec2(vUv.x * 14.0 - uTime * 0.8, vUv.y * 5.0 - uTime * 2.0));
  vec3 body = mix(vec3(0.02, 0.26, 0.4), vec3(0.18, 0.72, 0.86), vUv.y * (0.6 + 0.5 * m));
  // Moonlight caught in the face of the wave.
  body += vec3(0.5, 0.85, 1.0) * pow(max(m, 0.0), 4.0) * 0.8;
  float crest = smoothstep(0.62, 0.95, vUv.y + (n - 0.5) * 0.35);
  vec3 col = mix(body, vec3(0.94, 0.99, 1.0), crest);
  float sides = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
  float a = uAlpha * sides * (0.5 + 0.45 * vUv.y + 0.3 * crest) * (1.0 - smoothstep(0.95, 1.0, vUv.y) * 0.6);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

// A ring of foam on the floor (the bolt's splash, the aria's churn).
const FOAM_VERT = /* glsl */ `
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const FOAM_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
varying vec3 vLocal;
${NOISE}
void main() {
  float r = length(vLocal.xy);
  float band = 1.0 - smoothstep(0.0, 0.22, abs(r - 0.78));
  float n = vnoise(vLocal.xy * 6.0 + uTime * 2.0);
  vec3 col = mix(vec3(0.6, 0.92, 1.0), vec3(1.0), n);
  gl_FragColor = vec4(col, uAlpha * band * (0.5 + 0.5 * n));
  #include <colorspace_fragment>
}
`;

type EntityView = IWorld['entities'] extends Map<number, infer E> ? E : never;
type Uni = { uTime: { value: number }; uAlpha: { value: number }; uFlare?: { value: number } };

interface Flight {
  age: number;
  x0: number;
  y0: number;
  z0: number;
  targetId: number;
}

interface Splash {
  mesh: THREE.Mesh;
  alpha: { value: number };
  age: number;
  life: number;
  size: number;
}

export class TempleSeltheFx {
  private readonly root = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly glow: ParticlePool;
  private readonly spray: ParticlePool;
  private readonly gatherOrb: THREE.Mesh;
  private readonly gatherAlpha = { value: 0 };
  private readonly flyOrb: THREE.Mesh;
  private readonly flyAlpha = { value: 0 };
  private flight: Flight | null = null;
  private readonly core: THREE.Mesh;
  private readonly coreU: Required<Uni>;
  private readonly sheath: THREE.Mesh;
  private readonly sheathU: Required<Uni>;
  private beamLevel = 0;
  private flare = 0;
  private readonly wall: THREE.Mesh;
  private readonly wallAlpha = { value: 0 };
  private wallAge = -1;
  private wallYaw = 0;
  private readonly wallAt = new THREE.Vector3();
  private readonly splashes: Splash[] = [];
  private readonly density: number;
  private bossId: number | null = null;
  private rosterSeen = -1;
  private gated = false;
  private scan = 0;
  private seed = 23;
  private debt = 0;
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(
    parent: THREE.Group,
    private readonly world: IWorld | undefined,
    private readonly groundY: (x: number, z: number) => number,
    detail: boolean,
    private readonly shake?: (amount: number) => void,
    private readonly calm: () => boolean = () => false,
  ) {
    this.root.name = 'drowned-temple-selthe-fx';
    parent.add(this.root);
    this.density = detail ? 1 : 0.35;
    const particleMat = (frag: string, blending: THREE.Blending) => {
      const m = new THREE.ShaderMaterial({
        uniforms: { uTime: this.uTime },
        vertexShader: PARTICLE_VERT,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending,
      });
      this.materials.push(m);
      return m;
    };
    this.glow = new ParticlePool(
      Math.round(1400 * this.density),
      particleMat(GLOW_FRAG, THREE.AdditiveBlending),
      floorVfxRenderOrder('encounter', 8),
    );
    this.spray = new ParticlePool(
      Math.round(900 * this.density),
      particleMat(SPRAY_FRAG, THREE.NormalBlending),
      floorVfxRenderOrder('encounter', 7),
    );
    this.root.add(this.glow.mesh, this.spray.mesh);

    const shader = (
      vert: string,
      frag: string,
      uniforms: Record<string, THREE.IUniform>,
      additive: boolean,
    ) => {
      const m = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      this.materials.push(m);
      return m;
    };
    const orbGeo = new THREE.SphereGeometry(1, 24, 16);
    this.geometries.push(orbGeo);
    const orbMat = (alpha: { value: number }) =>
      shader(UV_VERT, ORB_FRAG, { uTime: this.uTime, uAlpha: alpha }, true);
    this.gatherOrb = this.collapsed(new THREE.Mesh(orbGeo, orbMat(this.gatherAlpha)), 9);
    this.flyOrb = this.collapsed(new THREE.Mesh(orbGeo, orbMat(this.flyAlpha)), 9);

    // The aria: unit cylinders along +y from the origin, stretched each frame.
    const coreGeo = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true).translate(0, 0.5, 0);
    const sheathGeo = new THREE.CylinderGeometry(1, 0.7, 1, 24, 6, true).translate(0, 0.5, 0);
    this.geometries.push(coreGeo, sheathGeo);
    this.coreU = { uTime: this.uTime, uAlpha: { value: 0 }, uFlare: { value: 0 } };
    this.sheathU = { uTime: this.uTime, uAlpha: { value: 0 }, uFlare: { value: 0 } };
    this.core = this.collapsed(
      new THREE.Mesh(coreGeo, shader(UV_VERT, BEAM_CORE_FRAG, this.coreU, true)),
      9,
    );
    this.sheath = this.collapsed(
      new THREE.Mesh(sheathGeo, shader(UV_VERT, BEAM_SHEATH_FRAG, this.sheathU, false)),
      8,
    );

    // The Surge's wall: an open arc of the wedge's width, unit radius and height.
    const arc = (SELTHE_TUNING.surgeArcDeg * Math.PI) / 180;
    const wallGeo = new THREE.CylinderGeometry(1, 1, 1, 40, 1, true, -arc / 2, arc).translate(
      0,
      0.5,
      0,
    );
    this.geometries.push(wallGeo);
    this.wall = this.collapsed(
      new THREE.Mesh(
        wallGeo,
        shader(UV_VERT, WALL_FRAG, { uTime: this.uTime, uAlpha: this.wallAlpha }, false),
      ),
      7,
    );

    // Foam rings (a unit ring in local XY, laid flat).
    const ringGeo = new THREE.RingGeometry(0.5, 1, 40);
    ringGeo.rotateX(-Math.PI / 2);
    this.geometries.push(ringGeo);
    for (let i = 0; i < 6; i++) {
      const alpha = { value: 0 };
      // The ring shader reads local XY: rebuild that frame from XZ.
      const m = shader(
        FOAM_VERT.replace('vLocal = position;', 'vLocal = vec3(position.x, -position.z, 0.0);'),
        FOAM_FRAG,
        { uTime: this.uTime, uAlpha: alpha },
        false,
      );
      const mesh = this.collapsed(new THREE.Mesh(ringGeo, m), 3);
      this.splashes.push({ mesh, alpha, age: -1, life: 0.6, size: 1 });
    }
  }

  private collapsed(mesh: THREE.Mesh, step: number): THREE.Mesh {
    mesh.frustumCulled = false;
    mesh.renderOrder = floorVfxRenderOrder('encounter', step);
    mesh.scale.setScalar(COLLAPSED);
    this.root.add(mesh);
    return mesh;
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  private boss(): EntityView | null {
    if (!this.world || this.bossId === null) return null;
    return this.world.entities.get(this.bossId) ?? null;
  }

  /** The temple root's gate has linked every program: idle, hide the layer. */
  markGated(): void {
    this.gated = true;
  }

  private rescan(force = false): void {
    const world = this.world;
    // She comes and goes with the roster: walk it only on a change.
    if (!world || (!force && world.entityRosterVersion === this.rosterSeen)) return;
    this.rosterSeen = world.entityRosterVersion;
    const me = world.entities.get(world.playerId);
    let best: EntityView | null = null;
    let bestD = Infinity;
    for (const e of world.entities.values()) {
      if (e.kind !== 'mob' || e.templateId !== SELTHE_ID) continue;
      const d = me ? Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z) : 0;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    this.bossId = best?.id ?? null;
  }

  /** Her hands, out ahead along her facing. */
  private hands(b: EntityView, out: THREE.Vector3): THREE.Vector3 {
    return out.set(
      b.pos.x + Math.sin(b.facing) * HAND_AHEAD,
      b.pos.y + HAND_UP,
      b.pos.z + Math.cos(b.facing) * HAND_AHEAD,
    );
  }

  /** True when the cue is hers (the renderer skips its generic draw). */
  handleEvent(ev: SimEvent): boolean {
    if (ev.type !== 'spellfx') return false;
    const ab = ev.ability;
    if (
      ab !== SELTHE_MOONWATER_BOLT &&
      ab !== SELTHE_ARIA_PULSE &&
      ab !== SELTHE_ARIA_BROKEN &&
      ab !== SELTHE_MERE_SURGE
    )
      return false;
    if (this.bossId === null || ev.sourceId !== this.bossId) this.rescan(true);
    const b = this.boss();
    if (!b || ev.sourceId !== b.id) return true;
    const target = this.world?.entities.get(ev.targetId);
    if (ab === SELTHE_MOONWATER_BOLT && target) {
      this.hands(b, this.a);
      this.flight = { age: 0, x0: this.a.x, y0: this.a.y, z0: this.a.z, targetId: target.id };
      this.gatherAlpha.value = 0;
      this.gatherOrb.scale.setScalar(COLLAPSED);
    } else if (ab === SELTHE_ARIA_PULSE && target) {
      this.flare = 1;
      this.burstAt(target.pos.x, target.pos.y + CHEST, target.pos.z, 26, 6);
    } else if (ab === SELTHE_ARIA_BROKEN && target) {
      this.burstAt(target.pos.x, target.pos.y + CHEST, target.pos.z, 60, 9);
      this.ring(target.pos.x, target.pos.z, 3.2);
    } else if (ab === SELTHE_MERE_SURGE) {
      this.crash(b);
    }
    return true;
  }

  /** A burst of moonwater spray (and a few glints) at a spot. */
  private burstAt(x: number, y: number, z: number, n: number, speed: number): void {
    const count = Math.round(n * this.density);
    for (let i = 0; i < count; i++) {
      const a = this.rand() * Math.PI * 2;
      const e = this.rand() * 1.2 - 0.2;
      const s = speed * (0.4 + this.rand() * 0.8);
      const p = {
        x,
        y,
        z,
        vx: Math.cos(a) * Math.cos(e) * s,
        vy: Math.sin(e) * s + 2,
        vz: Math.sin(a) * Math.cos(e) * s,
        ay: -14,
        drag: 0.7,
        life: 0.5 + this.rand() * 0.5,
      };
      if (i % 3 === 0)
        this.glow.emit(this.uTime.value, {
          ...p,
          size0: 0.45,
          size1: 0.1,
          r: 0.7,
          g: 0.95,
          b: 1,
          a: 1,
        });
      else
        this.spray.emit(this.uTime.value, {
          ...p,
          size0: 0.35 + this.rand() * 0.35,
          size1: 0.15,
          r: 0.8,
          g: 0.95,
          b: 1,
          a: 0.9,
        });
    }
  }

  private ring(x: number, z: number, size: number): void {
    let s = this.splashes[0];
    for (const k of this.splashes)
      if (k.age < 0) {
        s = k;
        break;
      }
    s.age = 0;
    s.size = size;
    s.mesh.position.set(x, this.groundY(x, z) + 0.08, z);
  }

  /** The Mere Surge crashes: the wall rolls out, spray along its crest. */
  private crash(b: EntityView): void {
    this.wallAge = 0;
    this.wallYaw = b.facing;
    this.wallAt.set(b.pos.x, this.groundY(b.pos.x, b.pos.z), b.pos.z);
    const half = (SELTHE_TUNING.surgeArcDeg * Math.PI) / 360;
    const n = Math.round(160 * this.density);
    for (let i = 0; i < n; i++) {
      const a = b.facing + (this.rand() * 2 - 1) * half;
      const r = 3 + this.rand() * 4;
      const s = SELTHE_TUNING.surgeRange / SURGE_LIFE;
      this.spray.emit(this.uTime.value, {
        x: b.pos.x + Math.sin(a) * r,
        y: this.wallAt.y + 0.5 + this.rand() * 2,
        z: b.pos.z + Math.cos(a) * r,
        vx: Math.sin(a) * s * (0.7 + this.rand() * 0.4),
        vy: 3 + this.rand() * 6,
        vz: Math.cos(a) * s * (0.7 + this.rand() * 0.4),
        ay: -12,
        drag: 0.85,
        life: 0.8 + this.rand() * 0.5,
        size0: 0.5 + this.rand() * 0.6,
        size1: 0.2,
        r: 0.85,
        g: 0.96,
        b: 1,
        a: 0.95,
      });
      if (i % 4 === 0)
        this.glow.emit(this.uTime.value, {
          x: b.pos.x + Math.sin(a) * r,
          y: this.wallAt.y + 1 + this.rand() * 3,
          z: b.pos.z + Math.cos(a) * r,
          vx: Math.sin(a) * s,
          vy: 2 + this.rand() * 5,
          vz: Math.cos(a) * s,
          ay: -10,
          drag: 0.85,
          life: 0.7 + this.rand() * 0.4,
          size0: 0.6,
          size1: 0.15,
          r: 0.55,
          g: 0.9,
          b: 1,
          a: 1,
        });
    }
    // A kick for a player the wave rolls over, a nudge for one nearby.
    const world = this.world;
    const me = world?.entities.get(world.playerId);
    if (!me || !this.shake) return;
    const dx = me.pos.x - b.pos.x;
    const dz = me.pos.z - b.pos.z;
    const d = Math.hypot(dx, dz);
    let off = Math.atan2(dx, dz) - b.facing;
    off = Math.atan2(Math.sin(off), Math.cos(off));
    if (d <= SELTHE_TUNING.surgeRange && Math.abs(off) <= half) this.shake(0.38);
    else if (d <= SELTHE_TUNING.surgeRange + 10) this.shake(0.12);
  }

  update(dt: number, clock: number): void {
    this.uTime.value = clock;
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = SCAN_SEC;
      this.rescan();
    }
    const b = this.boss();
    const casting = b && !b.dead ? b.castingAbility : null;
    this.stepGather(b, casting === SELTHE_MOONWATER_BOLT, dt);
    this.stepFlight(dt);
    this.stepBeam(b, casting === SELTHE_DROWNING_ARIA, dt);
    if (b && casting === SELTHE_MERE_SURGE) this.heave(b, dt);
    this.stepWall(dt);
    for (const s of this.splashes) {
      if (s.age < 0) continue;
      s.age += dt;
      const k = s.age / s.life;
      if (k >= 1) {
        s.age = -1;
        s.alpha.value = 0;
        s.mesh.scale.setScalar(COLLAPSED);
        continue;
      }
      s.mesh.scale.setScalar(s.size * (0.4 + 0.8 * k));
      s.alpha.value = 1 - k;
    }
    this.glow.update(clock);
    this.spray.update(clock);
    // Until the gate has linked the layer it stays drawn (collapsed); after,
    // it sleeps while she is far and nothing plays.
    const me = this.world?.entities.get(this.world.playerId);
    const near = !!b && !!me && Math.hypot(b.pos.x - me.pos.x, b.pos.z - me.pos.z) <= AWAKE_RANGE;
    const playing =
      this.flight !== null ||
      this.wallAge >= 0 ||
      this.beamLevel > 0.02 ||
      this.glow.lastDeath > clock ||
      this.spray.lastDeath > clock;
    this.root.visible = !this.gated || near || playing;
  }

  /** The orb swelling at her hands while the bolt's bar runs, moonwater
   *  spiralling in to it. */
  private stepGather(b: EntityView | null, on: boolean, dt: number): void {
    if (!b || !on || b.castTotal <= 0) {
      this.gatherAlpha.value = 0;
      this.gatherOrb.scale.setScalar(COLLAPSED);
      return;
    }
    const k = Math.min(1, Math.max(0, 1 - b.castRemaining / b.castTotal));
    const at = this.hands(b, this.a);
    this.gatherOrb.position.copy(at);
    this.gatherOrb.scale.setScalar(0.25 + 0.75 * k);
    this.gatherAlpha.value = 0.4 + 0.6 * k;
    this.debt += (20 + 50 * k) * this.density * dt;
    while (this.debt >= 1) {
      this.debt -= 1;
      const a = this.rand() * Math.PI * 2;
      const r = 2 + this.rand() * 2.5;
      const x = at.x + Math.cos(a) * r;
      const y = at.y + (this.rand() - 0.5) * 2.5;
      const z = at.z + Math.sin(a) * r;
      const t = 0.45;
      this.glow.emit(this.uTime.value, {
        x,
        y,
        z,
        vx: (at.x - x) / t - Math.sin(a) * 3,
        vy: (at.y - y) / t,
        vz: (at.z - z) / t + Math.cos(a) * 3,
        life: t,
        size0: 0.35,
        size1: 0.7,
        r: 0.6,
        g: 0.92,
        b: 1,
        a: 0.9,
      });
    }
  }

  private stepFlight(dt: number): void {
    const f = this.flight;
    if (!f) {
      this.flyAlpha.value = 0;
      this.flyOrb.scale.setScalar(COLLAPSED);
      return;
    }
    f.age += dt;
    const t = this.world?.entities.get(f.targetId);
    const k = Math.min(1, f.age / BOLT_FLIGHT);
    if (!t) {
      this.flight = null;
      return;
    }
    const tx = t.pos.x;
    const ty = t.pos.y + CHEST;
    const tz = t.pos.z;
    const x = f.x0 + (tx - f.x0) * k;
    const y = f.y0 + (ty - f.y0) * k + Math.sin(Math.PI * k) * 1.2;
    const z = f.z0 + (tz - f.z0) * k;
    this.flyOrb.position.set(x, y, z);
    this.flyOrb.scale.setScalar(0.9);
    this.flyAlpha.value = 1;
    // The trail.
    const n = Math.max(1, Math.round(5 * this.density));
    for (let i = 0; i < n; i++)
      this.glow.emit(this.uTime.value, {
        x: x + (this.rand() - 0.5) * 0.5,
        y: y + (this.rand() - 0.5) * 0.5,
        z: z + (this.rand() - 0.5) * 0.5,
        vx: 0,
        vy: 0.6,
        vz: 0,
        life: 0.35,
        size0: 0.7,
        size1: 0.15,
        r: 0.65,
        g: 0.95,
        b: 1,
        a: 0.9,
      });
    if (k >= 1) {
      this.flight = null;
      this.burstAt(tx, ty, tz, 50, 8);
      this.ring(tx, tz, 2.6);
    }
  }

  /** The aria's torrent from her hands to whoever it strikes now. */
  private stepBeam(b: EntityView | null, on: boolean, dt: number): void {
    const struck =
      on && b && b.castTargetId !== null ? this.world?.entities.get(b.castTargetId) : null;
    const want = struck ? 1 : 0;
    this.beamLevel += (want - this.beamLevel) * Math.min(1, dt * 10);
    this.flare = Math.max(0, this.flare - dt * 3);
    if (!b || !struck || this.beamLevel < 0.02) {
      this.core.scale.setScalar(COLLAPSED);
      this.sheath.scale.setScalar(COLLAPSED);
      this.coreU.uAlpha.value = 0;
      this.sheathU.uAlpha.value = 0;
      return;
    }
    const from = this.hands(b, this.a);
    const to = this.b.set(struck.pos.x, struck.pos.y + CHEST, struck.pos.z);
    this.dir.subVectors(to, from);
    const len = Math.max(0.1, this.dir.length());
    this.dir.multiplyScalar(1 / len);
    const width =
      (0.55 + 0.25 * this.flare + (this.calm() ? 0 : 0.08 * Math.sin(this.uTime.value * 18))) *
      this.beamLevel;
    this.lay(this.core, from, width * 0.32, len);
    this.lay(this.sheath, from, width * 1.8, len);
    this.coreU.uAlpha.value = this.beamLevel;
    this.sheathU.uAlpha.value = this.beamLevel;
    this.coreU.uFlare.value = this.flare;
    this.sheathU.uFlare.value = this.flare;
    // Spray boiling off the struck body, and the churn at its feet.
    this.debt += 90 * this.density * dt;
    while (this.debt >= 1) {
      this.debt -= 1;
      const a = this.rand() * Math.PI * 2;
      const s = 3 + this.rand() * 4;
      this.spray.emit(this.uTime.value, {
        x: to.x - this.dir.x * 0.6,
        y: to.y,
        z: to.z - this.dir.z * 0.6,
        vx: Math.cos(a) * s + this.dir.x * 4,
        vy: 1 + this.rand() * 4,
        vz: Math.sin(a) * s + this.dir.z * 4,
        ay: -12,
        drag: 0.7,
        life: 0.45 + this.rand() * 0.3,
        size0: 0.3 + this.rand() * 0.3,
        size1: 0.12,
        r: 0.8,
        g: 0.95,
        b: 1,
        a: 0.9,
      });
      // Moonwater racing down the torrent toward the struck body.
      if (this.rand() < 0.6) {
        const k = this.rand();
        const t = 0.25;
        const fx = from.x + (to.x - from.x) * k;
        const fy = from.y + (to.y - from.y) * k;
        const fz = from.z + (to.z - from.z) * k;
        this.glow.emit(this.uTime.value, {
          x: fx + (this.rand() - 0.5) * width * 1.6,
          y: fy + (this.rand() - 0.5) * width * 1.6,
          z: fz + (this.rand() - 0.5) * width * 1.6,
          vx: ((to.x - from.x) * (1 - k)) / t,
          vy: ((to.y - from.y) * (1 - k)) / t,
          vz: ((to.z - from.z) * (1 - k)) / t,
          life: t,
          size0: 0.45,
          size1: 0.2,
          r: 0.6,
          g: 0.95,
          b: 1,
          a: 0.9,
        });
      }
    }
    let churning = false;
    for (const s of this.splashes) if (s.age >= 0 && s.age <= 0.3) churning = true;
    if (!churning) this.ring(struck.pos.x, struck.pos.z, 2);
  }

  /** Stretch a unit beam cylinder from `from` along the aim, `w` wide. */
  private lay(mesh: THREE.Mesh, from: THREE.Vector3, w: number, len: number): void {
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(this.up, this.dir);
    mesh.scale.set(w, len, w);
  }

  /** The pool heaves while the Surge's bar runs: spray rising along the
   *  wedge's front, building to the crash. */
  private heave(b: EntityView, dt: number): void {
    const k = b.castTotal > 0 ? 1 - b.castRemaining / b.castTotal : 1;
    const half = (SELTHE_TUNING.surgeArcDeg * Math.PI) / 360;
    const y = this.groundY(b.pos.x, b.pos.z);
    this.debt += (15 + 60 * k) * this.density * dt;
    while (this.debt >= 1) {
      this.debt -= 1;
      const a = b.facing + (this.rand() * 2 - 1) * half;
      const r = 2.5 + this.rand() * 3;
      this.spray.emit(this.uTime.value, {
        x: b.pos.x + Math.sin(a) * r,
        y: y + 0.3,
        z: b.pos.z + Math.cos(a) * r,
        vx: Math.sin(a) * 1.5,
        vy: 2 + this.rand() * 4 * (0.4 + k),
        vz: Math.cos(a) * 1.5,
        ay: -8,
        drag: 0.6,
        life: 0.7 + this.rand() * 0.4,
        size0: 0.4 + this.rand() * 0.4,
        size1: 0.15,
        r: 0.78,
        g: 0.93,
        b: 1,
        a: 0.9,
      });
    }
  }

  private stepWall(dt: number): void {
    if (this.wallAge < 0) return;
    this.wallAge += dt;
    const k = Math.min(1, this.wallAge / SURGE_LIFE);
    if (k >= 1) {
      this.wallAge = -1;
      this.wallAlpha.value = 0;
      this.wall.scale.setScalar(COLLAPSED);
      return;
    }
    const r = 2 + (SELTHE_TUNING.surgeRange - 2) * (1 - (1 - k) * (1 - k));
    const h = 6 * Math.sin(Math.PI * Math.min(1, k * 1.15)) + 0.6;
    this.wall.position.copy(this.wallAt);
    // CylinderGeometry's theta 0 lies on +z: the arc opens along her facing.
    this.wall.rotation.set(0, this.wallYaw, 0);
    this.wall.scale.set(r, h, r);
    this.wallAlpha.value = 1 - k * k;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.glow.dispose();
    this.spray.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
