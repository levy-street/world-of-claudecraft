// The Moonbridge forming (the Temple encounter pass), composed by temple_fx.ts:
// when the Tideglass Colossus falls, the prism in its chest charges and fires
// a beam of moonlight west across the lagoon to the Altar Landing, and the
// bridge's slabs build along it (the slabs themselves are temple_gates.ts's
// rig, on the same timeline, temple_moonbridge_core.ts):
//  - the prism blazes in the fallen chest (a white-violet flare);
//  - the beam: a white core and a cyan sheath of streaming light, its front a
//    bright star racing west, sparks shed along it;
//  - every slab bursts in silver sparks as the front passes it;
//  - at the landing the beam strikes in a ring of light; it holds a breath,
//    then fades as the balustrades rise;
//  - a choir-and-glass chord (reused samples: the hoard door's opening, a holy
//    impact, the temple gong) and a gentle camera shake on the terrace.
// The centre-screen line is the HUD's (src/ui/log_event_cues.ts), beside the
// chat line the sim sends.
//
// State: the gate memory's reveal clock (the gate object's template, observed
// by gate_objects.ts), so it plays once for a party that watched the gate
// change and never for one arriving at an open bridge. Rules
// (src/render/CLAUDE.md): every mesh, material and particle pool is built once
// here, under the gated temple root, collapsed until that gate links them;
// after it the layer is hidden while no bridge is forming. No lights; the
// idle frame allocates nothing (a burst's particle specs are short-lived
// literals, as in the other temple layers). Reduced motion keeps the beam
// but holds the flares down and skips the shake. Cosmetic only: the bridge's
// walkable deck is the sim's gate.

import * as THREE from 'three';
import { sfx } from '../../game/sfx';
import { MOONBRIDGE, PRISM_PLINTH } from '../../sim/content/drowned_temple_layout';
import { DUNGEONS, instanceOrigin, instanceSlotForZ } from '../../sim/data';
import { COLOSSUS_ID } from '../../sim/encounters/drowned_temple/ids';
import type { SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import type { TelegraphKit } from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { sharedUniforms } from '../gfx';
import { GLOW_FRAG, PARTICLE_VERT, ParticlePool } from '../hollow_crypt/crypt_fx_particles';
import { gateMemoryKey, gateView } from '../hollow_crypt/crypt_gate_state_core';
import {
  MOONBRIDGE_BEAT,
  MOONBRIDGE_MOMENT,
  MOONBRIDGE_MOMENT_SECONDS,
  MOONBRIDGE_PLANKS,
  moonbridgeBeamFront,
  moonbridgeBeamStrength,
  moonbridgeBeatsBetween,
  moonbridgePlankAppears,
  moonbridgePlankX,
  moonbridgePrismGlow,
} from './temple_moonbridge_core';
import { moonbridgeSpan } from './temple_rising_stair_core';

const COLLAPSED = 1e-4;
/** The fallen Colossus's prism: it topples onto its back, so the prism faces
 *  the sky this high over the floor and this far behind where it stood
 *  (yards, its Death's last frame). */
const CHEST_UP = 4.2;
const CHEST_BACK = 7;
/** The beam's end, above the landing's floor. */
const LANDING_UP = 1.4;
const SOUNDS = ['impact_holy', 'hoard_entrance_open', 'ui_aura_temple_gong'] as const;

const BEAM_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// A tube of moonlight along +y: streaks race up it (toward the landing),
// solid in the core, streaked and soft in the sheath.
const BEAM_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
uniform float uCore;
uniform vec3 uColor;
varying vec2 vUv;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  float streak = vn(vec2(vUv.x * 18.0, vUv.y * 9.0 - uTime * 14.0));
  float streak2 = vn(vec2(vUv.x * 7.0 + 3.0, vUv.y * 3.0 - uTime * 6.0));
  float rim = 0.55 + 0.45 * sin(vUv.x * 6.2832);
  float k = mix(0.45 + 0.55 * streak * streak2, 1.0, uCore);
  vec3 col = mix(uColor, vec3(1.0), uCore * 0.8 + 0.25 * streak);
  gl_FragColor = vec4(col * (0.8 + 0.6 * k), uAlpha * k * mix(rim, 1.0, uCore));
  #include <colorspace_fragment>
}
`;

// A camera-facing star (the beam's front, the prism): a hot core, a soft
// halo and four thin rays.
const STAR_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv - 0.5;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float s = length(modelMatrix[0].xyz);
  mv.xy += position.xy * s;
  gl_Position = projectionMatrix * mv;
}
`;

const STAR_FRAG = /* glsl */ `
precision highp float;
uniform float uAlpha;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float r = length(vUv) * 2.0;
  float core = exp(-r * r * 22.0);
  float halo = exp(-r * 3.2) * 0.55;
  float rays = (exp(-abs(vUv.x) * 60.0) + exp(-abs(vUv.y) * 60.0)) * exp(-r * 1.6) * 0.6;
  float a = (core + halo + rays) * uAlpha;
  vec3 col = mix(uColor, vec3(1.0), core);
  gl_FragColor = vec4(col * a, a);
  #include <colorspace_fragment>
}
`;

// The landing's ring of light: an expanding band.
const RING_FRAG = /* glsl */ `
precision highp float;
uniform float uAlpha;
uniform float uBand;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float band = exp(-pow(max((r - uBand) * 9.0, 0.0), 2.0));
  float inner = (1.0 - smoothstep(0.0, uBand, r)) * 0.25;
  float a = (band + inner) * uAlpha * (1.0 - smoothstep(0.96, 1.0, r));
  gl_FragColor = vec4(mix(uColor, vec3(1.0), band * 0.5) * a, a);
  #include <colorspace_fragment>
}
`;

interface FxMat {
  mat: THREE.ShaderMaterial;
  alpha: { value: number };
}

type EntityView = IWorld['entities'] extends Map<number, infer E> ? E : never;

interface MoonbridgeClaim {
  slot: number;
  ox: number;
  oz: number;
  key: string;
}

export class TempleMoonbridgeFx {
  private readonly root = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly meshes: THREE.Mesh[] = [];
  private readonly core: THREE.Mesh;
  private readonly sheath: THREE.Mesh;
  private readonly coreMat: FxMat;
  private readonly sheathMat: FxMat;
  private readonly front: THREE.Mesh;
  private readonly frontMat: FxMat;
  private readonly prism: THREE.Mesh;
  private readonly prismMat: FxMat;
  private readonly landRing: THREE.Mesh;
  private readonly landMat: FxMat;
  private readonly landBand = { value: 0 };
  private readonly glow: ParticlePool;
  private readonly density: number;
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private readonly tip = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly span = moonbridgeSpan();
  private gated = false;
  private bandX: number | null = null;
  private claim: MoonbridgeClaim | null = null;
  private lastSince = -1;
  private lastKey = '';
  private seed = 23;
  private sparkDebt = 0;

  constructor(
    parent: THREE.Group,
    private readonly world: IWorld | undefined,
    private readonly groundY: (x: number, z: number) => number,
    detail: boolean,
    _kit: TelegraphKit,
    private readonly shake?: (amount: number) => void,
    private readonly calm: () => boolean = () => false,
  ) {
    this.root.name = 'drowned-temple-moonbridge-fx';
    parent.add(this.root);
    this.density = detail ? 1 : 0.35;
    const beamMat = (color: number, core: number): FxMat => {
      const alpha = { value: 0 };
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: this.uTime,
          uAlpha: alpha,
          uCore: { value: core },
          uColor: { value: new THREE.Color(color) },
        },
        vertexShader: BEAM_VERT,
        fragmentShader: BEAM_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      this.materials.push(mat);
      return { mat, alpha };
    };
    const starMat = (color: number): FxMat => {
      const alpha = { value: 0 };
      const mat = new THREE.ShaderMaterial({
        uniforms: { uAlpha: alpha, uColor: { value: new THREE.Color(color) } },
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      });
      this.materials.push(mat);
      return { mat, alpha };
    };
    const tube = new THREE.CylinderGeometry(1, 1, 1, 18, 1, true).translate(0, 0.5, 0);
    const quad = new THREE.PlaneGeometry(1, 1);
    const disc = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.geometries.push(tube, quad, disc);
    this.coreMat = beamMat(0xd8ecff, 1);
    this.sheathMat = beamMat(0x7fe6ff, 0);
    this.core = new THREE.Mesh(tube, this.coreMat.mat);
    this.sheath = new THREE.Mesh(tube, this.sheathMat.mat);
    this.frontMat = starMat(0xcfe8ff);
    this.front = new THREE.Mesh(quad, this.frontMat.mat);
    this.prismMat = starMat(0xc9b8ff);
    this.prism = new THREE.Mesh(quad, this.prismMat.mat);
    const landAlpha = { value: 0 };
    const land = new THREE.ShaderMaterial({
      uniforms: {
        uAlpha: landAlpha,
        uBand: this.landBand,
        uColor: { value: new THREE.Color(0xbfe6ff) },
      },
      vertexShader: BEAM_VERT,
      fragmentShader: RING_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.materials.push(land);
    this.landMat = { mat: land, alpha: landAlpha };
    this.landRing = new THREE.Mesh(disc, land);
    this.landRing.renderOrder = floorVfxRenderOrder('encounter', 6);
    this.core.renderOrder = 14;
    this.sheath.renderOrder = 13;
    this.front.renderOrder = 15;
    this.prism.renderOrder = 15;
    this.meshes.push(this.core, this.sheath, this.front, this.prism, this.landRing);
    for (const m of this.meshes) {
      m.frustumCulled = false;
      m.scale.setScalar(COLLAPSED);
      this.root.add(m);
    }
    const glowMat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.uTime },
      vertexShader: PARTICLE_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.materials.push(glowMat);
    this.glow = new ParticlePool(Math.round(1400 * this.density), glowMat, 14);
    this.root.add(this.glow.mesh);
    if (world) for (const key of SOUNDS) sfx.preload(key);
  }

  /** The temple root's gate has linked every program: idle, hide the layer. */
  markGated(): void {
    this.gated = true;
  }

  /** The bridge is the gate's, never an event's: nothing to claim. */
  handleEvent(_ev: SimEvent): boolean {
    return false;
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /** The local player's claim (its origin and the Moonbridge's gate memory
   *  key), or null outside the Temple. Cached per instance slot: the origin
   *  and the key are built once a slot, never per frame. */
  private claimOf(me: EntityView): MoonbridgeClaim | null {
    const def = DUNGEONS.drowned_temple;
    if (!def) return null;
    // The Temple's slots share one x band: anything far off it is elsewhere.
    if (this.bandX === null) this.bandX = instanceOrigin(def.index, 0).x;
    if (Math.abs(me.pos.x - this.bandX) > 160) return null;
    const slot = instanceSlotForZ(me.pos.z);
    if (this.claim?.slot !== slot) {
      const o = instanceOrigin(def.index, slot);
      this.claim = { slot, ox: o.x, oz: o.z, key: gateMemoryKey(o.x, o.z, 'moonbridge') };
    }
    return Math.abs(me.pos.z - this.claim.oz) > 300 ? null : this.claim;
  }

  /** The fallen Colossus nearest the terrace (its corpse), if in view. */
  private colossusNear(x: number, z: number): EntityView | null {
    const world = this.world;
    if (!world) return null;
    let best: EntityView | null = null;
    let bestD = 40;
    for (const e of world.entities.values()) {
      if (e.kind !== 'mob' || e.templateId !== COLOSSUS_ID) continue;
      const d = Math.hypot(e.pos.x - x, e.pos.z - z);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  update(dt: number, clock: number): void {
    this.uTime.value = clock;
    const world = this.world;
    const me = world?.entities.get(world.playerId);
    const claim = me ? this.claimOf(me) : null;
    let since = -1;
    if (claim) {
      const view = gateView(claim.key, sharedUniforms.uTime.value);
      if (view.state === 'open' && view.changed && view.since < MOONBRIDGE_MOMENT_SECONDS)
        since = view.since;
      if (claim.key !== this.lastKey) {
        this.lastKey = claim.key;
        this.lastSince = since;
      }
    }
    if (since >= 0 && claim && me) this.paint(claim.ox, claim.oz, me, since, dt, clock);
    else for (const m of this.meshes) m.scale.setScalar(COLLAPSED);
    this.lastSince = since;
    this.glow.update(clock);
    const busy = since >= 0 || this.glow.lastDeath > clock;
    this.root.visible = !this.gated || busy;
  }

  private paint(
    ox: number,
    oz: number,
    me: EntityView,
    since: number,
    dt: number,
    clock: number,
  ): void {
    const calm = this.calm();
    const M = MOONBRIDGE_MOMENT;
    // The prism in the fallen chest, and the landing's edge.
    const plinthX = ox + PRISM_PLINTH.x;
    const plinthZ = oz + PRISM_PLINTH.z;
    const body = this.colossusNear(plinthX, plinthZ);
    const cx = body ? body.pos.x - Math.sin(body.facing) * CHEST_BACK : plinthX;
    const cz = body ? body.pos.z - Math.cos(body.facing) * CHEST_BACK : plinthZ;
    this.from.set(cx, this.groundY(cx, cz) + CHEST_UP, cz);
    const lx = ox + this.span.toX;
    const lz = oz + MOONBRIDGE.z;
    this.to.set(lx, this.groundY(lx, lz) + LANDING_UP, lz);
    const front = moonbridgeBeamFront(since);
    const strength = moonbridgeBeamStrength(since);
    this.tip.lerpVectors(this.from, this.to, front);
    // The beam, from the prism to its front.
    this.dir.subVectors(this.tip, this.from);
    const len = this.dir.length();
    const fired = since >= M.charge && len > 0.05;
    const thick = 0.6 + 0.4 * strength;
    if (fired) {
      this.dir.multiplyScalar(1 / len);
      this.core.position.copy(this.from);
      this.core.quaternion.setFromUnitVectors(this.up, this.dir);
      this.core.scale.set(0.32 * thick, len, 0.32 * thick);
      this.sheath.position.copy(this.from);
      this.sheath.quaternion.copy(this.core.quaternion);
      this.sheath.scale.set(1.25 * thick, len, 1.25 * thick);
    } else {
      this.core.scale.setScalar(COLLAPSED);
      this.sheath.scale.setScalar(COLLAPSED);
    }
    this.coreMat.alpha.value = fired ? 0.95 * strength : 0;
    this.sheathMat.alpha.value = fired ? 0.6 * strength : 0;
    // The racing star at the front, the prism's flare.
    const running = fired && front < 1;
    this.front.position.copy(this.tip);
    this.front.scale.setScalar(
      running ? 6 : fired ? Math.max(COLLAPSED, 4.5 * strength) : COLLAPSED,
    );
    this.frontMat.alpha.value = (running ? 1 : 0.6 * strength) * (calm ? 0.5 : 1);
    const prism = moonbridgePrismGlow(since);
    this.prism.position.copy(this.from);
    this.prism.scale.setScalar(prism > 0.01 ? 4 + 10 * prism : COLLAPSED);
    this.prismMat.alpha.value = prism * (calm ? 0.5 : 1);
    // The landing's ring once the beam strikes it.
    const hitAge = since - (M.charge + M.travel);
    if (hitAge >= 0 && hitAge < 1.4) {
      const k = hitAge / 1.4;
      this.landRing.position.set(this.to.x, this.to.y - LANDING_UP + 0.15, this.to.z);
      this.landRing.scale.setScalar(4 + 16 * k);
      this.landBand.value = 0.35 + 0.6 * k;
      this.landMat.alpha.value = (1 - k) ** 1.5 * (calm ? 0.5 : 1);
    } else this.landRing.scale.setScalar(COLLAPSED);
    this.emitSparks(dt, clock, running, strength);
    this.slabBursts(ox, oz, since, clock);
    this.beats(me, since, clock);
  }

  /** Sparks shed along the beam and off its racing front. */
  private emitSparks(dt: number, clock: number, running: boolean, strength: number): void {
    if (strength <= 0.01) return;
    this.sparkDebt += (running ? 140 : 40 * strength) * this.density * dt;
    while (this.sparkDebt >= 1) {
      this.sparkDebt -= 1;
      const t = running ? 0.85 + this.rand() * 0.15 : this.rand();
      const x = this.from.x + (this.tip.x - this.from.x) * t;
      const y = this.from.y + (this.tip.y - this.from.y) * t;
      const z = this.from.z + (this.tip.z - this.from.z) * t;
      const cold = this.rand();
      this.glow.emit(clock, {
        x: x + (this.rand() - 0.5) * 1.2,
        y: y + (this.rand() - 0.5) * 1.2,
        z: z + (this.rand() - 0.5) * 1.2,
        vx: (this.rand() - 0.5) * 2,
        vy: running ? 0.5 + this.rand() * 2 : -0.6 - this.rand() * 1.4,
        vz: (this.rand() - 0.5) * 2,
        drag: 0.8,
        life: 0.7 + this.rand() * 0.9,
        size0: running ? 0.7 : 0.45,
        size1: 0.1,
        spin: 3,
        r: 0.75 + 0.25 * cold,
        g: 0.9,
        b: 1,
        a: 0.95,
      });
    }
  }

  /** Each slab bursts in silver sparks as the beam's front lays it. */
  private slabBursts(ox: number, oz: number, since: number, clock: number): void {
    const prev = this.lastSince;
    const { fromX, toX, deckAt } = this.span;
    for (let i = 0; i < MOONBRIDGE_PLANKS; i++) {
      const t = moonbridgePlankAppears(i, fromX, toX);
      if (!(prev >= 0 && prev < t && since >= t)) continue;
      const lxp = moonbridgePlankX(i, fromX, toX);
      const x = ox + lxp;
      const z = oz + MOONBRIDGE.z;
      // The deck's height is the interior frame's own (the gate rig lays the
      // slabs at deckAt with no lift).
      const y = deckAt(lxp);
      const n = Math.round(26 * this.density);
      for (let k = 0; k < n; k++) {
        const a = this.rand() * Math.PI * 2;
        const s = 1.5 + this.rand() * 4;
        this.glow.emit(clock, {
          x: x + (this.rand() - 0.5) * 1.2,
          y: y + 0.3,
          z: z + (this.rand() - 0.5) * 7,
          vx: Math.cos(a) * s * 0.5,
          vy: 2.5 + this.rand() * 5,
          vz: Math.sin(a) * s,
          ay: -7,
          drag: 0.9,
          life: 0.6 + this.rand() * 0.6,
          size0: 0.6,
          size1: 0.12,
          spin: 5,
          r: 0.85,
          g: 0.93,
          b: 1,
          a: 1,
        });
      }
    }
  }

  /** The moment's one-shots: the chord and the camera, once each. A player
   *  who walks in mid-moment hears nothing of what already passed. */
  private beats(me: EntityView, since: number, clock: number): void {
    const prev = this.lastSince;
    if (prev < 0) return;
    const bits = moonbridgeBeatsBetween(prev, since, this.span.fromX, this.span.toX);
    if (bits === 0) return;
    const near = Math.hypot(me.pos.x - this.from.x, me.pos.z - this.from.z) < 70;
    if (bits & MOONBRIDGE_BEAT.fire) {
      sfx.playAt('impact_holy', this.from.x, this.from.y, this.from.z, { gain: 1.4 });
      const mx = (this.from.x + this.to.x) / 2;
      const mz = (this.from.z + this.to.z) / 2;
      sfx.playAt('hoard_entrance_open', mx, this.to.y, mz, { gain: 1.2, rate: 0.85 });
      if (near && !this.calm()) this.shake?.(0.14);
      this.burstAt(this.from, clock, 70, 0.85, 0.8, 1);
    }
    if (bits & MOONBRIDGE_BEAT.arrive) {
      sfx.playAt('impact_holy', this.to.x, this.to.y, this.to.z, { gain: 1.1, rate: 1.2 });
      this.burstAt(this.to, clock, 90, 0.75, 0.92, 1);
    }
    if (bits & MOONBRIDGE_BEAT.laid) {
      sfx.playAt('ui_aura_temple_gong', this.to.x, this.to.y, this.to.z, { gain: 0.9 });
      if (near && !this.calm()) this.shake?.(0.07);
    }
  }

  private burstAt(
    p: THREE.Vector3,
    clock: number,
    count: number,
    r: number,
    g: number,
    b: number,
  ): void {
    const n = Math.round(count * this.density);
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const e = (this.rand() - 0.3) * Math.PI * 0.6;
      const s = 4 + this.rand() * 9;
      this.glow.emit(clock, {
        x: p.x,
        y: p.y,
        z: p.z,
        vx: Math.cos(a) * Math.cos(e) * s,
        vy: Math.sin(e) * s + 2,
        vz: Math.sin(a) * Math.cos(e) * s,
        ay: -5,
        drag: 1.4,
        life: 0.8 + this.rand() * 0.8,
        size0: 1.1,
        size1: 0.15,
        spin: 4,
        r,
        g,
        b,
        a: 1,
      });
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.glow.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
