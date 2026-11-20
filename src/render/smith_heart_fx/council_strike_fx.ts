// The Guardian of the Hammer's blows' cast and impact look (plan:
// council_strike_core.ts), a part of CouncilFx: Mountain's Wrath (on its
// holder, the Guardian or its heir the Singer) and Mountain's Rush (on the
// Guardian). The telegraphs stay their painters' and draw on every tier
// (the Wrath's sight field and shelters, the Rush's lane, mark and arrow);
// this adds the power behind them:
//   - through the bar: light swelling in the caster's fists (its own Hand.L
//     and Hand.R bones, council_body_sockets.ts), motes of its light
//     streaming into them off a ring round its feet, cracks of that light
//     splitting open under it with rings drawn in over the floor toward it,
//     pebbles lifting off the floor and hanging round it, shivering at the
//     end;
//   - the Wrath's release (its `nova` cue, which the renderer's generic nova
//     and the sight field still draw): a white flash, a burst of light out
//     of the fists, the pebbles blasted outward, rock flung and a dust wall
//     rolling out, rings racing over the Quarry, the camera's thud (none
//     under reduced motion);
//   - the Rush's wind-up cue: the fists flare and the pebbles are blasted
//     away as it plants; its stop: a flash and the cracks bursting open
//     under the stop, over CouncilRushFx's own rings, rock and dust.
// The low tier draws fewer pebbles, motes and rocks; every telegraph is
// untouched.
//
// Rules (src/render/CLAUDE.md): every geometry and material is built in the
// constructor under the host's root (its one gated attach links them), no
// light, fixed pools, no per-frame allocation; the particles are the host's
// (WORLD points); the cracks sit on their own rung of the council's ladder.

import * as THREE from 'three';
import {
  COUNCIL_CASTS,
  type CouncilRole,
  councilRoleOf,
} from '../../sim/encounters/smith_heart/council_ids';
import type { Entity } from '../../sim/types';
import { fxAnchor } from '../attached_fx_anchor';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import type { SanctumPuffOptions } from '../gravewyrm_sanctum_fx/sanctum_fx_core';
import { radialGlowTexture } from '../textures';
import { councilHands } from './council_body_sockets';
import { markFill } from './council_fx_core';
import type { CouncilFxHost } from './council_pillars_fx';
import {
  type CouncilStrikeKind,
  newStrikeGather,
  newStrikePebble,
  newStrikeRelease,
  pebbleFlung,
  pebbleHang,
  STRIKE_FX,
  STRIKE_LOOKS,
  strikeGather,
  strikeRelease,
  strikeShake,
} from './council_strike_core';
import { STRIKE_CRACKS_FRAG, STRIKE_FLOOR_VERT } from './council_strike_glsl';

/** The cracks' rung on the council's floor ladder (under every telegraph:
 *  the lanes, fans and marks stay on top). */
export const STRIKE_CRACKS_STEP = 9;

const ROLES: readonly CouncilRole[] = ['guardian', 'singer'];
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _hang = newStrikePebble();
const _fly = newStrikePebble();
const _dir: [number, number, number] = [0, 1, 0];
const _color: [number, number, number] = [1, 1, 1];

const MOTE: SanctumPuffOptions = {
  speed: 9,
  life: 0.6,
  size: [0.4, 0.12],
  color: _color,
  alpha: 1,
  pool: 'glow',
  drag: 0,
  dir: _dir,
  spread: 0.05,
};
const BURST: SanctumPuffOptions = {
  speed: 26,
  up: 2,
  life: 0.8,
  size: [0.55, 0.08],
  color: _color,
  alpha: 1,
  pool: 'glow',
  gravity: 10,
  drag: 0.9,
};
const WALL: SanctumPuffOptions = {
  speed: 15,
  up: 1.2,
  life: 2,
  size: [2.4, 7.5],
  color: [0.74, 0.64, 0.5],
  alpha: 0.5,
  drag: 1.8,
  dir: _dir,
  spread: 0.2,
};

interface Gather {
  role: CouncilRole;
  id: number;
  kind: CouncilStrikeKind | null;
  /** The bar's fill last frame (a release reads where it stood). */
  fill: number;
  hands: [THREE.Sprite, THREE.Sprite];
  cores: [THREE.Sprite, THREE.Sprite];
  handMats: THREE.SpriteMaterial[];
  cracks: THREE.Mesh;
  cracksU: {
    uCrack: { value: number };
    uHeat: { value: number };
    uDraw: { value: number };
    uAlpha: { value: number };
    uLight: { value: THREE.Color };
    uCore: { value: THREE.Color };
  };
  flash: THREE.Sprite;
  flashMat: THREE.SpriteMaterial;
  /** The last release: its kind, when, where, its scale, the gather's
   *  clock and lift it left the pebbles at. */
  relKind: CouncilStrikeKind;
  relAt: number;
  relX: number;
  relY: number;
  relZ: number;
  relScale: number;
  relT: number;
  relLift: number;
  /** Where the caster stood while gathering (the pebbles hang there). */
  x: number;
  y: number;
  z: number;
  scale: number;
  moteDebt: number;
}

export class CouncilStrikeFx {
  private readonly gathers: Record<CouncilRole, Gather>;
  private readonly pebbles: THREE.InstancedMesh;
  private readonly pebbleMat: THREE.MeshLambertMaterial;
  private readonly perSet: number;
  private readonly glowTex: THREE.Texture | null;
  private readonly look = newStrikeGather();
  private readonly rel = newStrikeRelease();
  private readonly scanIds: Record<CouncilRole, number> = { guardian: -1, singer: -1 };
  private clock = 0;

  constructor(
    private readonly h: CouncilFxHost,
    private readonly me: () => { x: number; z: number } | null,
    private readonly shakeSink?: (amount: number) => void,
  ) {
    const hasDom = typeof document !== 'undefined';
    this.glowTex = hasDom ? radialGlowTexture() : null;
    const crackGeo = new THREE.CircleGeometry(1, 96).rotateX(-Math.PI / 2);
    const pebbleGeo = new THREE.DodecahedronGeometry(1, 0);
    pebbleGeo.scale(1, 0.75, 0.88);
    h.geometries.push(crackGeo, pebbleGeo);
    const sprite = (name: string, size: number, mats: THREE.SpriteMaterial[]) => {
      const mat = new THREE.SpriteMaterial({
        name,
        map: this.glowTex,
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      });
      h.materials.push(mat);
      mats.push(mat);
      const s = new THREE.Sprite(mat);
      s.name = name;
      s.visible = false;
      s.frustumCulled = false;
      s.scale.setScalar(size);
      h.root.add(s);
      return s;
    };
    const build = (role: CouncilRole, seed: number): Gather => {
      const handMats: THREE.SpriteMaterial[] = [];
      const hands: [THREE.Sprite, THREE.Sprite] = [
        sprite('smithHeartCouncilStrikeHand', 3, handMats),
        sprite('smithHeartCouncilStrikeHand', 3, handMats),
      ];
      const cores: [THREE.Sprite, THREE.Sprite] = [
        sprite('smithHeartCouncilStrikeCore', 1.2, handMats),
        sprite('smithHeartCouncilStrikeCore', 1.2, handMats),
      ];
      // Depth-tested: a pillar between the raid and the caster hides its
      // fists' light too (hiding behind a pillar is how the Wrath is dodged,
      // so nothing may read as "still in sight" through it). The halo is
      // drawn wider than the fist so it shows round the stone.
      const flashMats: THREE.SpriteMaterial[] = [];
      const flash = sprite('smithHeartCouncilStrikeFlash', 20, flashMats);
      flash.material.depthTest = false;
      const cracksU = {
        uCrack: { value: 0 },
        uHeat: { value: 0 },
        uDraw: { value: 0 },
        uAlpha: { value: 1 },
        uLight: { value: new THREE.Color() },
        uCore: { value: new THREE.Color() },
      };
      const cracksMat = new THREE.ShaderMaterial({
        name: 'smithHeartCouncilStrikeCracks',
        uniforms: { uTime: h.uTime, uSeed: { value: seed }, ...cracksU },
        vertexShader: STRIKE_FLOOR_VERT,
        fragmentShader: STRIKE_CRACKS_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      h.materials.push(cracksMat);
      const cracks = new THREE.Mesh(crackGeo, cracksMat);
      cracks.name = 'smithHeartCouncilStrikeCracks';
      cracks.visible = false;
      cracks.frustumCulled = false;
      cracks.renderOrder = floorVfxRenderOrder('encounter', STRIKE_CRACKS_STEP);
      h.root.add(cracks);
      return {
        role,
        id: -1,
        kind: null,
        fill: 0,
        hands,
        cores,
        handMats,
        cracks,
        cracksU,
        flash,
        flashMat: flashMats[0],
        relKind: 'wrath',
        relAt: -99,
        relX: 0,
        relY: 0,
        relZ: 0,
        relScale: 1,
        relT: 0,
        relLift: 0,
        x: 0,
        y: 0,
        z: 0,
        scale: 1,
        moteDebt: 0,
      };
    };
    this.gathers = { guardian: build('guardian', 3.1), singer: build('singer', 11.7) };
    this.perSet = h.detail ? STRIKE_FX.pebbles : STRIKE_FX.pebblesLow;
    this.pebbleMat = new THREE.MeshLambertMaterial({
      name: 'smithHeartCouncilStrikePebbles',
      color: 0x332b25,
      emissive: 0x000000,
      flatShading: true,
    });
    h.materials.push(this.pebbleMat);
    this.pebbles = new THREE.InstancedMesh(pebbleGeo, this.pebbleMat, this.perSet * ROLES.length);
    this.pebbles.name = 'smithHeartCouncilStrikePebbles';
    this.pebbles.frustumCulled = false;
    this.pebbles.visible = false;
    this.pebbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < this.perSet * ROLES.length; i++) this.pebbles.setMatrixAt(i, _zero);
    h.root.add(this.pebbles);
  }

  // ---- the scan (the host's pace) ----

  beginScan(): void {
    this.scanIds.guardian = -1;
    this.scanIds.singer = -1;
  }

  /** A living council member the host's scan found. */
  see(e: Entity, role: CouncilRole): void {
    this.scanIds[role] = e.id;
  }

  endScan(): void {
    for (const r of ROLES) this.gathers[r].id = this.scanIds[r];
  }

  // ---- the cues ----

  /** Mountain's Wrath lands from `sourceId` (its `nova` cue). */
  wrathLand(sourceId: number): void {
    const e = this.h.entity(sourceId);
    const role = e ? councilRoleOf(e.templateId) : null;
    if (!e || !role) return;
    const g = this.gathers[role];
    this.release(g, e, 'wrath');
    const at = fxAnchor(e);
    const x = at.x;
    const z = at.z;
    const y = this.h.groundY(x, z);
    const s = Math.max(1, e.scale ?? 1);
    const L = STRIKE_LOOKS.wrath;
    const P = this.h.particles;
    // The rings racing out over the Quarry: white, the vein's, the dust's.
    P.shockRing(x, z, 0xfff2d8, 8 * s, 0.35);
    P.shockRing(x, z, 0xffb050, 16 * s, 0.9);
    if (this.h.detail)
      P.shockRing(x, z, 0x9a7650, 26 * s, 1.5, { wake: 0.15, crest: 0.06, strength: 0.5 });
    // A burst of its light out of the fists.
    this.handPoint(g, e, 0, _v);
    _color[0] = L.core[0];
    _color[1] = L.core[1];
    _color[2] = L.core[2];
    BURST.radius = 1.2;
    P.puff(_v.x, _v.y, _v.z, 110, BURST);
    // The dust wall rolling out, and rock flung.
    const wall = Math.round(48 * this.h.density) + 8;
    for (let i = 0; i < wall; i++) {
      const a = (i / wall) * Math.PI * 2 + this.h.rand() * 0.2;
      _dir[0] = Math.sin(a);
      _dir[1] = 0.06;
      _dir[2] = Math.cos(a);
      P.puff(x + Math.sin(a) * 3 * s, y + 0.6, z + Math.cos(a) * 3 * s, 1, WALL);
    }
    this.fling(x, y, z, Math.round(36 * this.h.density) + 4, 1.4 * s, 10, 22);
    const me = this.me();
    if (me && this.shakeSink) {
      const amount = strikeShake('wrath', Math.hypot(me.x - x, me.z - z), this.h.reducedMotion());
      if (amount > 0) this.shakeSink(amount);
    }
  }

  /** Mountain's Rush plants for its wind-up: its fists flare, the pebbles
   *  are blasted away. */
  rushWindup(guardianId: number | undefined): void {
    const g = this.gathers.guardian;
    const e = this.h.entity(guardianId ?? g.id);
    if (!e) return;
    this.release(g, e, 'rush');
    this.handPoint(g, e, 0, _v);
    const L = STRIKE_LOOKS.rush;
    _color[0] = L.core[0];
    _color[1] = L.core[1];
    _color[2] = L.core[2];
    BURST.radius = 1;
    this.h.particles.puff(_v.x, _v.y, _v.z, 50, BURST);
  }

  /** Mountain's Rush stops here: a flash and the cracks bursting open. */
  rushImpact(x: number, z: number): void {
    const g = this.gathers.guardian;
    const y = this.h.groundY(x, z);
    g.relKind = 'rush';
    g.relAt = this.clock;
    g.relX = x;
    g.relY = y;
    g.relZ = z;
    g.relLift = 0;
    const L = STRIKE_LOOKS.rush;
    _color[0] = L.core[0];
    _color[1] = L.core[1];
    _color[2] = L.core[2];
    BURST.radius = 2;
    this.h.particles.puff(x, y + 1.5, z, 70, BURST);
    this.fling(x, y, z, Math.round(18 * this.h.density) + 3, 2, 7, 15);
  }

  private release(g: Gather, e: Entity, kind: CouncilStrikeKind): void {
    const at = fxAnchor(e);
    g.relKind = kind;
    g.relAt = this.clock;
    g.relX = at.x;
    g.relZ = at.z;
    g.relY = this.h.groundY(at.x, at.z);
    g.relScale = Math.max(1, (e.scale ?? 1) * 0.5);
    g.relT = this.clock;
    g.relLift = g.kind === kind ? strikeGather(g.fill, this.look).lift : 0;
    g.kind = null;
  }

  /** Rock flung out of (x, y, z) through the host's rubble. */
  private fling(
    x: number,
    y: number,
    z: number,
    n: number,
    size: number,
    sp0: number,
    sp1: number,
  ): void {
    const k = Math.round(n * (this.h.reducedMotion() ? 0.5 : 1));
    for (let i = 0; i < k; i++) {
      const a = this.h.rand() * Math.PI * 2;
      const sp = sp0 + this.h.rand() * (sp1 - sp0);
      this.h.debris.throw(
        x + Math.sin(a) * 1.5,
        y + 1,
        z + Math.cos(a) * 1.5,
        Math.sin(a) * sp,
        5 + this.h.rand() * 9,
        Math.cos(a) * sp,
        (0.3 + this.h.rand() * 0.7) * size,
      );
    }
  }

  // ---- the frame ----

  update(dt: number): void {
    this.clock = this.h.now();
    let anyPebble = false;
    for (let ri = 0; ri < ROLES.length; ri++) {
      const g = this.gathers[ROLES[ri]];
      const e = g.id >= 0 ? this.h.entity(g.id) : undefined;
      const cast = e && !e.dead ? e.castingAbility : null;
      const kind: CouncilStrikeKind | null =
        cast === COUNCIL_CASTS.wrath ? 'wrath' : cast === COUNCIL_CASTS.rush ? 'rush' : null;
      // A bar the release just ended (a snapshot behind its cue) gathers no
      // more.
      const justReleased = g.relKind === kind && this.clock - g.relAt < 0.3;
      if (e && kind && !justReleased) {
        if (g.kind !== kind) g.moteDebt = 0;
        g.kind = kind;
        g.fill = markFill(e.castRemaining, e.castTotal);
        anyPebble = this.paintGather(g, e, kind, dt, ri) || anyPebble;
      } else {
        g.kind = null;
        this.hideGather(g);
        anyPebble = this.paintRelease(g, ri) || anyPebble;
      }
    }
    this.pebbles.visible = anyPebble;
    if (anyPebble) this.pebbles.instanceMatrix.needsUpdate = true;
  }

  /** The gather on a caster through its bar. True when pebbles show. */
  private paintGather(
    g: Gather,
    e: Entity,
    kind: CouncilStrikeKind,
    dt: number,
    ri: number,
  ): boolean {
    const L = strikeGather(g.fill, this.look);
    const pal = STRIKE_LOOKS[kind];
    const at = fxAnchor(e);
    g.x = at.x;
    g.z = at.z;
    g.y = this.h.groundY(at.x, at.z);
    g.scale = Math.max(1, (e.scale ?? 1) * 0.5);
    g.flash.visible = false;
    // The fists.
    // Reduced motion: no shiver in the pulse or the pebbles.
    const shiver = this.h.reducedMotion() ? 0 : L.shiver;
    const pulse = 1 + 0.12 * Math.sin(this.clock * (8 + 14 * shiver));
    for (let k = 0; k < 2; k++) {
      this.handPoint(g, e, k, _v);
      const hand = g.hands[k];
      const core = g.cores[k];
      hand.position.copy(_v);
      core.position.copy(_v);
      hand.scale.setScalar((3 + 5.5 * L.glow) * pulse * g.scale * 0.6);
      core.scale.setScalar((0.8 + 1.6 * L.glow) * pulse * g.scale * 0.6);
      hand.visible = true;
      core.visible = true;
    }
    for (let k = 0; k < 4; k++) {
      const mat = g.handMats[k];
      const c = k < 2 ? pal.light : pal.core;
      mat.color.setRGB(c[0], c[1], c[2]);
      mat.opacity = k < 2 ? 0.35 + 0.6 * L.glow : 0.5 + 0.5 * L.glow;
    }
    // The cracks and the rings drawn in.
    g.cracks.position.set(g.x, g.y + 0.06, g.z);
    g.cracks.scale.setScalar(STRIKE_FX.crackReach * g.scale);
    g.cracksU.uCrack.value = L.crack;
    g.cracksU.uHeat.value = L.heat;
    g.cracksU.uDraw.value = 0.4 + 0.6 * L.glow;
    g.cracksU.uAlpha.value = 1;
    g.cracksU.uLight.value.setRGB(pal.light[0], pal.light[1], pal.light[2]);
    g.cracksU.uCore.value.setRGB(pal.core[0], pal.core[1], pal.core[2]);
    g.cracks.visible = true;
    // Motes streaming in to the fists off a ring round its feet.
    g.moteDebt += L.motes * this.h.density * dt;
    while (g.moteDebt >= 1) {
      g.moteDebt -= 1;
      const k = this.h.rand() < 0.5 ? 0 : 1;
      this.handPoint(g, e, k, _v);
      const a = this.h.rand() * Math.PI * 2;
      const r = (4 + 4 * this.h.rand()) * g.scale;
      const sx = g.x + Math.sin(a) * r;
      const sz = g.z + Math.cos(a) * r;
      const sy = g.y + 0.3 + this.h.rand() * 2;
      const dx = _v.x - sx;
      const dy = _v.y - sy;
      const dz = _v.z - sz;
      const len = Math.hypot(dx, dy, dz) || 1;
      _dir[0] = dx / len;
      _dir[1] = dy / len;
      _dir[2] = dz / len;
      MOTE.speed = len / 0.55;
      MOTE.life = 0.55;
      const c = this.h.rand() < 0.3 ? pal.core : pal.light;
      _color[0] = c[0];
      _color[1] = c[1];
      _color[2] = c[2];
      this.h.particles.puff(sx, sy, sz, 1, MOTE);
    }
    // The pebbles hanging round it.
    const t = this.clock;
    const base = ri * this.perSet;
    for (let i = 0; i < this.perSet; i++) {
      pebbleHang(i, this.perSet, L.lift, t, shiver, _hang);
      this.setPebble(base + i, g.x, g.y, g.z, g.scale, _hang);
    }
    this.pebbleMat.emissive.setRGB(
      0.07 * L.glow * pal.light[0],
      0.07 * L.glow * pal.light[1],
      0.07 * L.glow * pal.light[2],
    );
    return true;
  }

  /** The release's aftermath. True when pebbles show. */
  private paintRelease(g: Gather, ri: number): boolean {
    const since = this.clock - g.relAt;
    const R = strikeRelease(since, this.h.reducedMotion(), this.rel);
    const pal = STRIKE_LOOKS[g.relKind];
    g.flash.visible = R.flash > 0.004;
    if (g.flash.visible) {
      g.flash.position.set(g.relX, g.relY + 4 * g.relScale, g.relZ);
      g.flash.scale.setScalar((g.relKind === 'wrath' ? 30 : 18) * (0.6 + 0.4 * (1 - R.flash)));
      g.flashMat.color.setRGB(pal.core[0], pal.core[1], pal.core[2]);
      g.flashMat.opacity = R.flash;
    }
    g.cracks.visible = R.live && R.heat > 0.003;
    if (g.cracks.visible) {
      g.cracks.position.set(g.relX, g.relY + 0.06, g.relZ);
      g.cracks.scale.setScalar(
        STRIKE_FX.crackReach * g.relScale * (g.relKind === 'wrath' ? 1.5 : 1),
      );
      g.cracksU.uCrack.value = R.crack;
      g.cracksU.uHeat.value = R.heat;
      g.cracksU.uDraw.value = 0;
      g.cracksU.uAlpha.value = 1;
      g.cracksU.uLight.value.setRGB(pal.light[0], pal.light[1], pal.light[2]);
      g.cracksU.uCore.value.setRGB(pal.core[0], pal.core[1], pal.core[2]);
    }
    const base = ri * this.perSet;
    const flying = g.relLift > 0 && since >= 0 && since < STRIKE_FX.flungFor;
    for (let i = 0; i < this.perSet; i++) {
      if (!flying) {
        this.pebbles.setMatrixAt(base + i, _zero);
        continue;
      }
      pebbleHang(i, this.perSet, g.relLift, g.relT, 0, _hang);
      pebbleFlung(i, since, _hang, _fly);
      this.setPebble(base + i, g.x, g.y, g.z, g.scale, _fly);
    }
    return flying;
  }

  private setPebble(
    slot: number,
    x: number,
    y: number,
    z: number,
    scale: number,
    p: { x: number; y: number; z: number; spin: number; size: number },
  ): void {
    if (p.size <= 0) {
      this.pebbles.setMatrixAt(slot, _zero);
      return;
    }
    _e.set(p.spin * 0.7, p.spin, p.spin * 0.4);
    _q.setFromEuler(_e);
    _p.set(x + p.x * scale, y + p.y * scale + p.size * scale * 0.5, z + p.z * scale);
    _s.setScalar(p.size * scale);
    _m.compose(_p, _q, _s);
    this.pebbles.setMatrixAt(slot, _m);
  }

  /** Where fist `k` is this frame: its bone on the live view, else a stand-in
   *  either side of the body at shoulder height. */
  private handPoint(g: Gather, e: Entity, k: 0 | 1 | number, out: THREE.Vector3): THREE.Vector3 {
    const hands = councilHands(g.role);
    const bone = hands ? hands[k === 0 ? 0 : 1] : null;
    if (bone) return bone.getWorldPosition(out);
    const at = fxAnchor(e);
    const s = Math.max(1, e.scale ?? 1);
    const side = k === 0 ? -1 : 1;
    const c = Math.cos(e.facing);
    const sn = Math.sin(e.facing);
    return out.set(
      at.x + c * side * 1.1 * s,
      this.h.groundY(at.x, at.z) + 2.6 * s,
      at.z - sn * side * 1.1 * s,
    );
  }

  private hideGather(g: Gather): void {
    for (const s of g.hands) s.visible = false;
    for (const s of g.cores) s.visible = false;
    g.cracks.visible = false;
  }

  /** Everything hidden (the host left the Quarry or tears down). */
  hide(): void {
    for (const r of ROLES) {
      const g = this.gathers[r];
      this.hideGather(g);
      g.flash.visible = false;
      g.relAt = -99;
      g.kind = null;
    }
    this.pebbles.visible = false;
  }

  dispose(): void {
    this.pebbles.dispose();
    this.glowTex?.dispose();
  }
}
