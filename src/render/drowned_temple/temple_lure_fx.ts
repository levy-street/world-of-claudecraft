// The Moonlit Siren's Call of the Shallows, composed by temple_fx.ts; the
// plan (every height, beat and pace) is temple_lure_fx_core.ts:
//  - while her song runs: a moon-silver tether from her mouth to the
//    victim's chest, rippling like a sound wave, its crests running toward
//    her; silver musical notes riding it from the victim into her voice; a
//    silver ring under the victim whose chevrons point at her and scroll at
//    the drag's own pace. All of it brightens as the bar fills: "you are
//    being pulled: break her sight or kick her";
//  - the song breaking on a column: the tether snaps, its halves spring back
//    to each end and silver shards drift off the break;
//  - the song landing: a flash ring and a burst of notes on the victim, and
//    while they are Song-Struck a slow ring of silver notes and stars
//    orbiting their head.
//
// Rules (src/render/CLAUDE.md): everything built once here under the gated
// temple root, collapsed until used, the layer hidden while nothing shows; no
// lights; every renderOrder off the floor ladder (encounter band). The
// actionable reads (the tether, the ring and its chevrons, the halo) draw on
// every tier; only the particles thin on the low tier. Reduced motion holds
// the tether's ripple and the flashes down. State is read off IWorld only.

import * as THREE from 'three';
import {
  TEMPLE_CALL_OF_THE_SHALLOWS,
  TEMPLE_SHALLOWS_BROKEN,
} from '../../sim/mob/trash_kit/temple_cast_ids';
import type { SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import type { TelegraphKit } from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import {
  GLOW_FRAG,
  PARTICLE_VERT,
  ParticlePool,
  type ParticleSpec,
} from '../hollow_crypt/crypt_fx_particles';
import {
  LURE_HALO_RADIUS,
  LURE_HALO_UP,
  LURE_LAND_SECONDS,
  LURE_RING_RADIUS,
  LURE_SIREN,
  LURE_SNAP_SECONDS,
  LURE_VICTIM_CHEST,
  lureChevronYaw,
  lureFill,
  lureIntensity,
  lureLandRing,
  lureMouthUp,
  lureNoteFlight,
  lureNoteRate,
  lurePullPace,
  lureSnapLook,
  lureVictimOf,
  songStruckHalo,
} from './temple_lure_fx_core';

const COLLAPSED = 1e-4;
const SCAN_SEC = 0.1;
const TETHERS = 4;
const LANDS = 3;
const HALOS = 6;
const STATIONS = 40;

const UV_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// The tether: a camera-facing ribbon from uA (the victim's chest) to uB (the
// singer's mouth), sagging a little, rippling sideways like a sound wave
// (the ripple travels toward her). On a snap its two halves spring back to
// their own ends (uSnap 0..1).
const TETHER_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
uniform vec3 uA;
uniform vec3 uB;
uniform float uWidth;
uniform float uWave;
uniform float uSnap;
uniform float uTime;
attribute float aT;
attribute float aSide;
varying float vT;
varying float vSide;
void main() {
  float t = aT;
  float k = 1.0 - 0.92 * uSnap;
  float tt = t < 0.5 ? t * k : 1.0 - (1.0 - t) * k;
  vec3 dir = uB - uA;
  float len = max(length(dir), 1e-3);
  vec3 d = dir / len;
  vec3 up = abs(d.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 s1 = normalize(cross(d, up));
  vec3 s2 = cross(s1, d);
  vec3 p = uA + dir * tt;
  p.y -= 0.06 * len * sin(3.14159 * tt);
  float env = sin(3.14159 * tt);
  float wave = sin(tt * len * 1.7 - uTime * 9.0) * env;
  p += (s1 * wave + s2 * 0.45 * cos(tt * len * 1.1 - uTime * 6.0) * env) * uWave;
  // A curl as the snapped halves recoil.
  p += s2 * uSnap * env * 0.8 * sin(tt * 18.0);
  vec3 toCam = normalize(cameraPosition - p);
  vec3 side = cross(d, toCam);
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : s1;
  p += side * aSide * uWidth * (0.75 + 0.25 * env);
  vT = t;
  vSide = aSide;
  gl_Position = projectionMatrix * wocCamRelView(p);
}
`;

// Moon-silver: a white-hot core, a pale blue-violet sheath, bright wave
// crests running from the victim (vT 0) into her voice (vT 1). A snap opens
// a widening gap at its middle.
const TETHER_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
uniform float uIntensity;
uniform float uLen;
uniform float uSnap;
varying float vT;
varying float vSide;
void main() {
  float x = abs(vSide);
  float core = 1.0 - smoothstep(0.0, 0.32, x);
  float ix = max(1.0 - x, 0.0);
  float sheath = ix * sqrt(ix);
  float cw = 0.5 + 0.5 * sin((vT * uLen * 0.9 - uTime * 3.4) * 6.28318);
  float cw2 = cw * cw;
  float cw4 = cw2 * cw2;
  float crest = cw4 * cw4 * cw2;
  float fine = 0.5 + 0.5 * sin((vT * uLen * 4.0 - uTime * 9.0) * 6.28318);
  vec3 silver = mix(vec3(0.66, 0.74, 1.0), vec3(0.93, 0.95, 1.0), vT);
  vec3 col = silver * (0.55 + 0.6 * fine * sheath) + vec3(1.0) * (core * 0.8 + crest * 1.2);
  col *= 0.75 + 0.6 * uIntensity;
  float ends = smoothstep(0.0, 0.04, vT) * (1.0 - smoothstep(0.96, 1.0, vT));
  float gap = smoothstep(uSnap * 0.5 - 0.02, uSnap * 0.5 + 0.02, abs(vT - 0.5));
  float a = (sheath * 0.42 + core * 0.55 + crest * sheath * 0.8) * uIntensity * uAlpha * ends;
  a *= uSnap > 0.0 ? gap : 1.0;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

// The drag ring under the victim: a silver band, a soft inner shimmer, and
// three chevrons pointing at the singer (uYaw, the sim's facing convention)
// scrolling toward her at the drag's pace.
const RING_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
uniform float uIntensity;
uniform float uYaw;
uniform float uScroll;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  vec2 w = vec2(p.x, -p.y);
  float r = length(w);
  vec2 fwd = vec2(sin(uYaw), cos(uYaw));
  vec2 rgt = vec2(cos(uYaw), -sin(uYaw));
  float along = dot(w, fwd);
  float across = dot(w, rgt);
  float bd = (r - 0.86) * 18.0;
  float band = exp(-bd * bd);
  float inner = (1.0 - smoothstep(0.55, 0.86, r)) * 0.18;
  float ripple = 0.5 + 0.5 * sin(r * 22.0 - uTime * 5.0);
  float chev = fract(along * 2.2 - abs(across) * 1.9 - uScroll);
  float stripe = smoothstep(0.0, 0.08, chev) * (1.0 - smoothstep(0.32, 0.42, chev));
  float lane = (1.0 - smoothstep(0.42, 0.55, abs(across))) * step(r, 0.8);
  float lead = smoothstep(-0.7, 0.6, along);
  vec3 col = vec3(0.86, 0.9, 1.0) + vec3(0.14, 0.1, 0.0) * stripe;
  float a = (band * 0.85 + inner * ripple + stripe * lane * lead * 0.95) * uAlpha * uIntensity;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

// The landing's flash ring: a bright silver band racing out with note-shaped
// beads round it.
const LAND_FRAG = /* glsl */ `
precision highp float;
uniform float uAlpha;
uniform float uReach;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float a0 = atan(p.y, p.x);
  float bd = (r - uReach) * 16.0;
  float band = exp(-bd * bd);
  float bw = 0.5 + 0.5 * sin(a0 * 9.0);
  float bw2 = bw * bw;
  float bw4 = bw2 * bw2;
  float bb = (r - uReach * 0.82) * 22.0;
  float beads = bw4 * bw4 * bw4 * exp(-bb * bb);
  vec3 col = mix(vec3(0.8, 0.85, 1.0), vec3(1.0), band);
  gl_FragColor = vec4(col, clamp((band + beads) * uAlpha, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

// The dazed halo: a flat ring over the head carrying six glyphs, notes and
// four-point stars in turn, orbiting slowly (uTurn).
const HALO_FRAG = /* glsl */ `
precision highp float;
uniform float uAlpha;
uniform float uTurn;
uniform float uTime;
varying vec2 vUv;
float note(vec2 q) {
  float head = 1.0 - smoothstep(0.85, 1.0, length((q - vec2(-0.12, -0.18)) * vec2(3.6, 5.2)));
  float stem = step(abs(q.x - 0.08), 0.035) * step(-0.18, q.y) * step(q.y, 0.34);
  float flag = step(abs(q.y - (0.34 - (q.x - 0.08) * 1.3)), 0.06) * step(0.08, q.x) * step(q.x, 0.3);
  return max(head, max(stem, flag));
}
float star(vec2 q) {
  vec2 a = abs(q);
  float s = 1.0 - smoothstep(0.0, 0.05, min(a.x * 5.0 + a.y, a.y * 5.0 + a.x) - 0.32);
  return s;
}
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float ang = atan(p.y, p.x) - uTurn;
  float cell = floor((ang + 3.14159) / 6.28318 * 6.0);
  float ca = (cell + 0.5) / 6.0 * 6.28318 - 3.14159;
  vec2 q = vec2((ang - ca) * 0.68, (r - 0.66)) * 3.0;
  float glyph = mod(cell, 2.0) < 0.5 ? note(q) : star(q);
  float td = (r - 0.66) * 14.0;
  float trail = exp(-td * td) * 0.22;
  float tw = 0.75 + 0.25 * sin(uTime * 6.0 + cell * 1.7);
  vec3 col = mix(vec3(0.78, 0.84, 1.0), vec3(1.0), glyph);
  gl_FragColor = vec4(col, clamp((glyph * tw + trail) * uAlpha, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

// A silver musical note on a sprite: an eighth note, or (vSeed) a beamed
// pair, a soft glow round the glyph.
const NOTE_FRAG = /* glsl */ `
varying float vT;
varying float vSeed;
varying vec4 vColor;
varying vec2 vUv;
float head(vec2 uv, vec2 c) {
  vec2 d = uv - c;
  float cs = cos(-0.45), sn = sin(-0.45);
  d = vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs);
  return length(d * vec2(1.0, 1.5));
}
float glyph(vec2 uv, float grow) {
  float beamed = step(0.5, fract(vSeed * 37.0));
  float h1 = head(uv, vec2(0.32, 0.26));
  float h2 = head(uv, vec2(0.66, 0.32));
  float heads = min(h1, mix(10.0, h2, beamed));
  float m = 1.0 - smoothstep(0.13 + grow, 0.16 + grow, heads);
  float s1 = step(abs(uv.x - 0.43), 0.025 + grow) * step(0.26, uv.y) * step(uv.y, 0.86 + grow);
  float s2 = step(abs(uv.x - 0.77), 0.025 + grow) * step(0.32, uv.y) * step(uv.y, 0.9 + grow) * beamed;
  float beam = step(abs(uv.y - (0.86 + (uv.x - 0.43) * 0.12)), 0.045 + grow) * step(0.41, uv.x) * step(uv.x, 0.79) * beamed;
  float fx = uv.x - 0.43;
  float flag = step(abs(uv.y - (0.86 - fx * 1.25)), 0.05 + grow) * step(0.0, fx) * step(fx, 0.2) * (1.0 - beamed);
  return max(m, max(max(s1, s2), max(beam, flag)));
}
void main() {
  float sharp = glyph(vUv, 0.0);
  float soft = glyph(vUv, 0.07) * 0.45;
  float fade = smoothstep(0.0, 0.12, vT) * (1.0 - smoothstep(0.72, 1.0, vT));
  float a = max(sharp, soft) * fade * vColor.a;
  gl_FragColor = vec4(vColor.rgb * (0.7 + 0.9 * sharp), a);
}
`;

type Uniforms = Record<string, { value: number | THREE.Vector3 }>;
type EntityView = IWorld['entities'] extends Map<number, infer E> ? E : never;

interface Piece {
  mesh: THREE.Mesh;
  u: Uniforms;
}

interface TetherSlot extends Piece {
  sirenId: number;
  victimId: number;
  /** -1 while live; else seconds since it snapped. */
  snap: number;
  noteDebt: number;
  ring: Piece;
}

interface TimedSlot extends Piece {
  age: number;
}

interface HaloSlot extends Piece {
  entityId: number;
  moteDebt: number;
}

const num = (u: Uniforms, k: string): { value: number } => u[k] as { value: number };
const vec = (u: Uniforms, k: string): THREE.Vector3 => u[k].value as THREE.Vector3;

export class TempleLureFx {
  private readonly root = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly notes: ParticlePool;
  private readonly glow: ParticlePool;
  private readonly tethers: TetherSlot[] = [];
  private readonly lands: TimedSlot[] = [];
  private readonly halos: HaloSlot[] = [];
  private readonly density: number;
  private readonly pace = lurePullPace();
  private readonly spec: ParticleSpec = {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 1,
    size0: 0.5,
    size1: 0.5,
    r: 1,
    g: 1,
    b: 1,
    a: 1,
  };
  private scan = 0;
  private gated = false;
  private seed = 73;

  constructor(
    parent: THREE.Group,
    private readonly world: IWorld | undefined,
    private readonly groundY: (x: number, z: number) => number,
    detail: boolean,
    _kit: TelegraphKit,
    private readonly calm: () => boolean = () => false,
  ) {
    this.root.name = 'drowned-temple-lure-fx';
    parent.add(this.root);
    this.density = detail ? 1 : 0.35;
    const particleMat = (frag: string) => {
      const m = new THREE.ShaderMaterial({
        uniforms: { uTime: this.uTime },
        vertexShader: PARTICLE_VERT,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.materials.push(m);
      return m;
    };
    this.notes = new ParticlePool(
      Math.round(500 * this.density),
      particleMat(NOTE_FRAG),
      floorVfxRenderOrder('encounter', 29),
    );
    this.glow = new ParticlePool(
      Math.round(700 * this.density),
      particleMat(GLOW_FRAG),
      floorVfxRenderOrder('encounter', 28),
    );
    this.root.add(this.notes.mesh, this.glow.mesh);
    const disc = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    const ribbon = lureRibbonGeometry(STATIONS);
    this.geometries.push(disc, ribbon);
    for (let i = 0; i < TETHERS; i++) {
      const tether = this.piece(ribbon, TETHER_VERT, TETHER_FRAG, 27, {
        uA: { value: new THREE.Vector3() },
        uB: { value: new THREE.Vector3() },
        uWidth: { value: 0.16 },
        uWave: { value: 0 },
        uSnap: { value: 0 },
        uAlpha: { value: 0 },
        uIntensity: { value: 0 },
        uLen: { value: 1 },
      });
      const ring = this.piece(disc, UV_VERT, RING_FRAG, 6, {
        uAlpha: { value: 0 },
        uIntensity: { value: 0 },
        uYaw: { value: 0 },
        uScroll: { value: 0 },
      });
      this.tethers.push({ ...tether, sirenId: -1, victimId: -1, snap: -1, noteDebt: 0, ring });
    }
    for (let i = 0; i < LANDS; i++)
      this.lands.push({
        ...this.piece(disc, UV_VERT, LAND_FRAG, 7, { uAlpha: { value: 0 }, uReach: { value: 0 } }),
        age: -1,
      });
    for (let i = 0; i < HALOS; i++)
      this.halos.push({
        ...this.piece(disc, UV_VERT, HALO_FRAG, 26, {
          uAlpha: { value: 0 },
          uTurn: { value: 0 },
        }),
        entityId: -1,
        moteDebt: 0,
      });
  }

  private piece(
    geo: THREE.BufferGeometry,
    vert: string,
    frag: string,
    rung: number,
    uniforms: Uniforms,
  ): Piece {
    const u: Uniforms = { uTime: this.uTime, ...uniforms };
    const m = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.materials.push(m);
    const mesh = new THREE.Mesh(geo, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = floorVfxRenderOrder('encounter', rung);
    mesh.scale.setScalar(COLLAPSED);
    this.root.add(mesh);
    return { mesh, u };
  }

  /** The temple root's gate has linked every program: idle, hide the layer. */
  markGated(): void {
    this.gated = true;
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /** The song breaking on a column and the song landing are the siren's cues. */
  handleEvent(ev: SimEvent): boolean {
    if (ev.type !== 'spellfx') return false;
    if (ev.ability !== TEMPLE_SHALLOWS_BROKEN && ev.ability !== TEMPLE_CALL_OF_THE_SHALLOWS)
      return false;
    const siren = this.world?.entities.get(ev.sourceId);
    if (!siren || siren.templateId !== LURE_SIREN) return false;
    const slot = this.tethers.find((t) => t.sirenId === ev.sourceId && t.snap < 0);
    if (ev.ability === TEMPLE_SHALLOWS_BROKEN) {
      if (slot) this.snapTether(slot);
      return true;
    }
    if (slot) this.release(slot);
    const victim = this.world?.entities.get(ev.targetId);
    if (victim) this.landed(victim);
    return true;
  }

  private claimTether(sirenId: number, victimId: number): void {
    const live = this.tethers.find((t) => t.sirenId === sirenId && t.snap < 0);
    if (live) {
      live.victimId = victimId;
      return;
    }
    const free = this.tethers.find((t) => t.sirenId < 0);
    if (!free) return;
    free.sirenId = sirenId;
    free.victimId = victimId;
    free.snap = -1;
    free.noteDebt = 0;
  }

  private release(t: TetherSlot): void {
    t.sirenId = -1;
    t.victimId = -1;
    t.snap = -1;
    t.mesh.scale.setScalar(COLLAPSED);
    t.ring.mesh.scale.setScalar(COLLAPSED);
  }

  private scanWorld(world: IWorld): void {
    for (const e of world.entities.values()) {
      if (e.kind === 'mob') {
        const victim = lureVictimOf(e);
        if (victim !== null) this.claimTether(e.id, victim);
        continue;
      }
      if (e.dead || !songStruckHalo(e.auras, 0)) continue;
      if (this.halos.some((h) => h.entityId === e.id)) continue;
      const free = this.halos.find((h) => h.entityId < 0);
      if (free) {
        free.entityId = e.id;
        free.moteDebt = 0;
      }
    }
  }

  update(dt: number, clock: number): void {
    this.uTime.value = clock;
    const world = this.world;
    this.scan -= dt;
    if (world && this.scan <= 0) {
      this.scan = SCAN_SEC;
      this.scanWorld(world);
    }
    let busy = this.notes.lastDeath > clock || this.glow.lastDeath > clock;
    if (world) {
      for (const t of this.tethers) if (this.stepTether(world, t, dt, clock)) busy = true;
      for (const h of this.halos) if (this.stepHalo(world, h, dt, clock)) busy = true;
    }
    for (const l of this.lands) if (this.stepLand(l, dt)) busy = true;
    this.notes.update(clock);
    this.glow.update(clock);
    this.root.visible = !this.gated || busy;
  }

  /** One tether's frame. Returns true while it shows. */
  private stepTether(world: IWorld, t: TetherSlot, dt: number, clock: number): boolean {
    if (t.sirenId < 0) return false;
    if (t.snap >= 0) {
      t.snap += dt;
      const look = lureSnapLook(t.snap);
      num(t.u, 'uSnap').value = look.spring;
      num(t.u, 'uAlpha').value = look.alpha;
      num(t.ring.u, 'uAlpha').value = look.alpha * 0.6;
      if (t.snap >= LURE_SNAP_SECONDS) this.release(t);
      return true;
    }
    const siren = world.entities.get(t.sirenId);
    const victimId = siren ? lureVictimOf(siren) : null;
    const victim = victimId !== null ? world.entities.get(victimId) : undefined;
    if (!siren || !victim || victim.dead) {
      this.release(t);
      return false;
    }
    t.victimId = victim.id;
    const fill = lureFill(siren.castRemaining, siren.castTotal);
    const strength = lureIntensity(fill);
    const a = vec(t.u, 'uA');
    const b = vec(t.u, 'uB');
    a.set(victim.pos.x, victim.pos.y + LURE_VICTIM_CHEST, victim.pos.z);
    b.set(siren.pos.x, siren.pos.y + lureMouthUp(siren.templateId), siren.pos.z);
    const len = a.distanceTo(b);
    t.mesh.scale.setScalar(1);
    num(t.u, 'uLen').value = len;
    num(t.u, 'uSnap').value = 0;
    num(t.u, 'uAlpha').value = 1;
    num(t.u, 'uIntensity').value = strength;
    num(t.u, 'uWave').value = this.calm() ? 0 : 0.1 + 0.16 * fill;
    num(t.u, 'uWidth').value = 0.12 + 0.1 * fill;
    // The drag ring under the victim, its chevrons toward her.
    const ring = t.ring;
    ring.mesh.position.set(
      victim.pos.x,
      this.groundY(victim.pos.x, victim.pos.z) + 0.06,
      victim.pos.z,
    );
    ring.mesh.scale.setScalar(LURE_RING_RADIUS);
    num(ring.u, 'uAlpha').value = 1;
    num(ring.u, 'uIntensity').value = strength;
    num(ring.u, 'uYaw').value = lureChevronYaw(victim.pos, siren.pos);
    num(ring.u, 'uScroll').value = (clock * this.pace) / LURE_RING_RADIUS;
    this.flowNotes(t, a, b, len, fill, dt, clock);
    return true;
  }

  /** Notes born at the victim riding the tether into her voice. */
  private flowNotes(
    t: TetherSlot,
    a: THREE.Vector3,
    b: THREE.Vector3,
    len: number,
    fill: number,
    dt: number,
    clock: number,
  ): void {
    t.noteDebt += lureNoteRate(fill, this.density) * dt;
    const flight = lureNoteFlight(len);
    const s = this.spec;
    while (t.noteDebt >= 1) {
      t.noteDebt -= 1;
      const k = this.rand() * 0.25;
      s.x = a.x + (b.x - a.x) * k + (this.rand() - 0.5) * 0.5;
      s.y = a.y + (b.y - a.y) * k + (this.rand() - 0.5) * 0.4;
      s.z = a.z + (b.z - a.z) * k + (this.rand() - 0.5) * 0.5;
      const left = (1 - k) / flight.life;
      s.vx = (b.x - a.x) * left;
      s.vy = (b.y - a.y) * left + 0.4;
      s.vz = (b.z - a.z) * left;
      s.ax = 0;
      s.ay = -0.8;
      s.az = 0;
      s.drag = 0.001;
      s.life = flight.life * (1 - k);
      s.size0 = 0.42 + 0.18 * fill;
      s.size1 = 0.22;
      s.spin = 0;
      s.seed = this.rand() * 0.03;
      s.r = 0.88;
      s.g = 0.92;
      s.b = 1;
      s.a = 0.95;
      this.notes.emit(clock, s);
    }
  }

  /** The tether snaps where the victim broke her sight. */
  private snapTether(t: TetherSlot): void {
    t.snap = 0;
    const a = vec(t.u, 'uA');
    const b = vec(t.u, 'uB');
    const clock = this.uTime.value;
    const n = Math.round(70 * this.density);
    const s = this.spec;
    for (let i = 0; i < n; i++) {
      const k = 0.3 + this.rand() * 0.4;
      const ang = this.rand() * Math.PI * 2;
      const sp = 1.5 + this.rand() * 3.5;
      s.x = a.x + (b.x - a.x) * k;
      s.y = a.y + (b.y - a.y) * k;
      s.z = a.z + (b.z - a.z) * k;
      s.vx = Math.cos(ang) * sp;
      s.vy = 0.5 + this.rand() * 2.5;
      s.vz = Math.sin(ang) * sp;
      s.ax = 0;
      s.ay = -3;
      s.az = 0;
      s.drag = 1.4;
      s.life = 0.7 + this.rand() * 0.5;
      s.size0 = 0.32;
      s.size1 = 0.06;
      s.spin = 9;
      s.seed = this.rand();
      s.r = 0.85;
      s.g = 0.9;
      s.b = 1;
      s.a = 1;
      this.glow.emit(clock, s);
    }
    // A few notes knocked loose, tumbling off the break.
    const m = Math.round(10 * this.density);
    for (let i = 0; i < m; i++) {
      const ang = this.rand() * Math.PI * 2;
      s.x = (a.x + b.x) * 0.5;
      s.y = (a.y + b.y) * 0.5;
      s.z = (a.z + b.z) * 0.5;
      s.vx = Math.cos(ang) * 2;
      s.vy = 1 + this.rand() * 1.5;
      s.vz = Math.sin(ang) * 2;
      s.ay = -4;
      s.drag = 0.8;
      s.life = 0.9;
      s.size0 = 0.45;
      s.size1 = 0.2;
      s.spin = 4;
      s.seed = this.rand() * 0.03;
      s.a = 0.8;
      this.notes.emit(clock, s);
    }
  }

  /** The song lands: a flash ring and a burst of notes on the victim. */
  private landed(victim: EntityView): void {
    const slot = this.lands.find((l) => l.age < 0) ?? this.lands[0];
    slot.age = 0;
    const y = this.groundY(victim.pos.x, victim.pos.z);
    slot.mesh.position.set(victim.pos.x, y + 0.07, victim.pos.z);
    const clock = this.uTime.value;
    const s = this.spec;
    const n = Math.round(26 * this.density) + 6;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + this.rand() * 0.3;
      const sp = 2 + this.rand() * 2.5;
      s.x = victim.pos.x;
      s.y = y + LURE_VICTIM_CHEST;
      s.z = victim.pos.z;
      s.vx = Math.cos(ang) * sp;
      s.vy = 1.2 + this.rand() * 2;
      s.vz = Math.sin(ang) * sp;
      s.ax = 0;
      s.ay = -1.5;
      s.az = 0;
      s.drag = 1.5;
      s.life = 0.9 + this.rand() * 0.4;
      s.size0 = 0.55;
      s.size1 = 0.25;
      s.spin = 0;
      s.seed = this.rand() * 0.03;
      s.r = 0.9;
      s.g = 0.93;
      s.b = 1;
      s.a = 1;
      this.notes.emit(clock, s);
    }
    const g = Math.round(50 * this.density);
    for (let i = 0; i < g; i++) {
      const ang = this.rand() * Math.PI * 2;
      const sp = 3 + this.rand() * 4;
      s.x = victim.pos.x;
      s.y = y + LURE_VICTIM_CHEST;
      s.z = victim.pos.z;
      s.vx = Math.cos(ang) * sp;
      s.vy = (this.rand() - 0.3) * 3;
      s.vz = Math.sin(ang) * sp;
      s.ay = 0;
      s.drag = 2;
      s.life = 0.5 + this.rand() * 0.3;
      s.size0 = 0.4;
      s.size1 = 0.08;
      s.spin = 0;
      s.seed = this.rand();
      s.a = this.calm() ? 0.5 : 1;
      this.glow.emit(clock, s);
    }
  }

  private stepLand(l: TimedSlot, dt: number): boolean {
    if (l.age < 0) return false;
    l.age += dt;
    if (l.age >= LURE_LAND_SECONDS) {
      l.age = -1;
      l.mesh.scale.setScalar(COLLAPSED);
      return false;
    }
    const look = lureLandRing(l.age);
    l.mesh.scale.setScalar(3.4);
    num(l.u, 'uReach').value = look.radius / 3.4;
    num(l.u, 'uAlpha').value = look.alpha * (this.calm() ? 0.5 : 1);
    return true;
  }

  /** A Song-Struck player's orbiting halo of notes and stars. */
  private stepHalo(world: IWorld, h: HaloSlot, dt: number, clock: number): boolean {
    if (h.entityId < 0) return false;
    const e = world.entities.get(h.entityId);
    const look = e && !e.dead ? songStruckHalo(e.auras, clock) : null;
    if (!e || !look) {
      h.entityId = -1;
      h.mesh.scale.setScalar(COLLAPSED);
      return false;
    }
    h.mesh.position.set(e.pos.x, e.pos.y + LURE_HALO_UP, e.pos.z);
    h.mesh.scale.setScalar(LURE_HALO_RADIUS * 1.55);
    num(h.u, 'uAlpha').value = look.alpha;
    num(h.u, 'uTurn').value = look.turn;
    // A few silver motes shed off the ring.
    h.moteDebt += 10 * this.density * dt;
    const s = this.spec;
    while (h.moteDebt >= 1) {
      h.moteDebt -= 1;
      const ang = look.turn + this.rand() * Math.PI * 2;
      s.x = e.pos.x + Math.cos(ang) * LURE_HALO_RADIUS;
      s.y = e.pos.y + LURE_HALO_UP;
      s.z = e.pos.z + Math.sin(ang) * LURE_HALO_RADIUS;
      s.vx = 0;
      s.vy = -0.4;
      s.vz = 0;
      s.ax = 0;
      s.ay = 0;
      s.az = 0;
      s.drag = 1;
      s.life = 0.6;
      s.size0 = 0.18;
      s.size1 = 0.04;
      s.spin = 0;
      s.seed = this.rand();
      s.r = 0.9;
      s.g = 0.93;
      s.b = 1;
      s.a = 0.8 * look.alpha;
      this.glow.emit(clock, s);
    }
    return true;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.notes.dispose();
    this.glow.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}

/** A ribbon's strip: `stations` pairs of vertices along aT 0..1, aSide -1/1
 *  (positions are the vertex shader's; the attribute only sizes the draw). */
function lureRibbonGeometry(stations: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const n = stations * 2;
  const t = new Float32Array(n);
  const side = new Float32Array(n);
  for (let i = 0; i < stations; i++) {
    const k = i / (stations - 1);
    t[i * 2] = k;
    t[i * 2 + 1] = k;
    side[i * 2] = -1;
    side[i * 2 + 1] = 1;
  }
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('aT', new THREE.BufferAttribute(t, 1));
  g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  const index: number[] = [];
  for (let i = 0; i + 1 < stations; i++) {
    const base = i * 2;
    index.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  g.setIndex(index);
  return g;
}
