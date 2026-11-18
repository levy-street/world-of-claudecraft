// The Stillstones (encounters/smith_heart/breath_isles.ts: the bodyless
// `heart_breath_stillstone` on each chain's last isle, the G3 use a player
// channels), a part of BreathIslesFx (looks: breath_isle_phase_core.ts):
//
//  - a great floating crystal over each last isle's stone spot, ALWAYS there:
//    dormant (dim, its light all but out, caged in three rings of wind
//    racing round it) until its body rises once the isle's adds are dead;
//    awake (bright, pulsing, its cage loosened, a rune circle burning under
//    it, motes drawn to it: it calls the raid);
//  - channelled (ISLE_CASTS.still, castTargetId the stone): a beam of calm
//    from the channeller's hands into the crystal, the cage unwinding and
//    the crystal turning gold as the bar fills;
//  - stilled (its body wears the cocoon marker, ISLE_CUES.stilled): a burst
//    of gold, the seal's bolt racing home to the guardian (breath_cocoon_fx.ts),
//    then a calm gold crystal turning slowly with no cage.
// On EVERY tier (the raid acts on its state); the motes thin on the low
// tier. Built in the constructor under the isles' own groups (it rides the
// isle's bob) and the host's root; fixed pools, no per-frame allocation.

import * as THREE from 'three';
import { BREATH_ISLES } from '../../sim/content/smith_heart_layout';
import { isleSpots } from '../../sim/encounters/smith_heart/breath_isle_geometry';
import { ISLE_CASTS } from '../../sim/encounters/smith_heart/breath_isle_ids';
import type { Entity } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { fxAnchor } from '../attached_fx_anchor';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { IsleBeam } from './breath_isle_beam';
import {
  PHASE_COLORS as PC,
  PHASE_POOLS,
  phaseRgb,
  STILLSTONE,
  STILLSTONE_ISLES,
  type StoneLook,
  type StoneState,
  stoneLook,
  stoneState,
} from './breath_isle_phase_core';
import { CRYSTAL_FRAG, PHASE_SHELL_VERT } from './breath_isle_phase_glsl';
import type { BreathIslesHost } from './breath_isles_fx';
import { ISLE_RIBBON_FRAG, ISLE_RUNE_FRAG, ISLE_UV_VERT } from './breath_isles_glsl';
import { ribbonGeometry } from './breath_ride_fx';

interface StoneSlot {
  isle: number;
  /** The crystal's group (isle-local, at its hover). */
  group: THREE.Group;
  crystalMat: THREE.ShaderMaterial;
  crystal: THREE.Mesh;
  rings: THREE.Mesh[];
  ringMat: THREE.ShaderMaterial;
  runeMat: THREE.ShaderMaterial;
  halo: THREE.Sprite;
  haloMat: THREE.SpriteMaterial;
  /** Its body (-1: none yet) and the state last frame. */
  bodyId: number;
  state: StoneState;
  flare: number;
}

interface ChannelSlot {
  beam: IsleBeam;
  /** The channeller's id (-1: none). */
  id: number;
}

const STONE_RGB = phaseRgb(PC.stone);
const GOLD_RGB = phaseRgb(PC.stilled);
const _look: StoneLook = { glow: 0, gold: 0, cage: 0, cageSpin: 0, spin: 0, bob: 0, pulse: 0 };
const _from = { x: 0, y: 0, z: 0 };
const _to = { x: 0, y: 0, z: 0 };
const _wp = new THREE.Vector3();
const _teal = new THREE.Color(PC.stone);
const _gold = new THREE.Color(PC.stilled);

/** The crystal: a long faceted bipyramid (six faces, flat shaded). */
function crystalGeometry(): THREE.BufferGeometry {
  const H = STILLSTONE.height;
  const W = STILLSTONE.width;
  const pts = [
    new THREE.Vector2(0, -H * 0.5),
    new THREE.Vector2(W * 0.72, -H * 0.18),
    new THREE.Vector2(W, H * 0.05),
    new THREE.Vector2(W * 0.8, H * 0.25),
    new THREE.Vector2(0, H * 0.5),
  ];
  const lathe = new THREE.LatheGeometry(pts, 6);
  const flat = lathe.toNonIndexed();
  lathe.dispose();
  flat.computeVertexNormals();
  return flat;
}

export class BreathStillstoneFx {
  private readonly stones: StoneSlot[] = [];
  private readonly channels: ChannelSlot[] = [];
  private readonly bodies: number[] = [];
  private readonly channellers: number[] = [];
  private seed = 0x3b71;

  constructor(
    private readonly h: BreathIslesHost,
    isles: readonly THREE.Group[],
    glowTex: THREE.Texture | null,
  ) {
    const crystalGeo = crystalGeometry();
    const shardGeo = new THREE.OctahedronGeometry(0.4, 0);
    shardGeo.computeVertexNormals();
    // The cage of wind: ribbons wrapping the crystal, each a helix bulging
    // round its waist and drawn in at its tips, turning its own way.
    const wraps: THREE.BufferGeometry[] = [];
    for (let k = 0; k < STILLSTONE.rings; k++) {
      const pts: { x: number; y: number; z: number }[] = [];
      const turns = 1.4 + 0.35 * k;
      for (let i = 0; i <= 72; i++) {
        const f = i / 72;
        const a = f * Math.PI * 2 * turns + (k * Math.PI * 2) / STILLSTONE.rings;
        const r = 1.15 + 1.05 * Math.sin(f * Math.PI) + 0.12 * k;
        pts.push({
          x: Math.sin(a) * r,
          y: (f - 0.5) * (STILLSTONE.height + 1.6),
          z: Math.cos(a) * r,
        });
      }
      wraps.push(ribbonGeometry(pts, 0.16, true));
    }
    const runeGeo = new THREE.RingGeometry(2.4, 3.1, 64, 1);
    const pos = runeGeo.getAttribute('position');
    const uv = runeGeo.getAttribute('uv') as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k);
      const y = pos.getY(k);
      uv.setXY(k, (Math.atan2(y, x) / (Math.PI * 2) + 1) % 1, (Math.hypot(x, y) - 2.4) / 0.7);
    }
    runeGeo.rotateX(-Math.PI / 2);
    runeGeo.translate(0, 0.1, 0);
    h.geometries.push(crystalGeo, shardGeo, runeGeo, ...wraps);
    for (const i of STILLSTONE_ISLES) {
      const sp = isleSpots()[i];
      const at = sp.stone ?? { x: sp.x, z: sp.z };
      const base = new THREE.Group();
      base.name = `smithHeartBreathStillstone${i}`;
      base.position.set(at.x - sp.x, 0, at.z - sp.z);
      isles[i].add(base);
      const group = new THREE.Group();
      group.position.y = STILLSTONE.hover;
      base.add(group);
      const crystalMat = new THREE.ShaderMaterial({
        name: 'smithHeartBreathStillstone',
        uniforms: {
          uTime: h.uTime,
          uColor: { value: new THREE.Color(PC.stone) },
          uGold: { value: new THREE.Color(PC.stilled) },
          uCore: { value: new THREE.Color(PC.stoneCore) },
          uGlow: { value: 0.3 },
          uGoldK: { value: 0 },
          uPulse: { value: 0 },
        },
        vertexShader: PHASE_SHELL_VERT,
        fragmentShader: CRYSTAL_FRAG,
      });
      h.materials.push(crystalMat);
      const crystal = new THREE.Mesh(crystalGeo, crystalMat);
      crystal.name = 'smithHeartBreathStillstoneCrystal';
      group.add(crystal);
      // Three small shards hanging round it (they turn with the crystal).
      for (let k = 0; k < 3; k++) {
        const s = new THREE.Mesh(shardGeo, crystalMat);
        const a = (k / 3) * Math.PI * 2;
        s.position.set(Math.sin(a) * 2.1, -0.6 + k * 0.5, Math.cos(a) * 2.1);
        s.scale.set(0.7, 1.4, 0.7);
        crystal.add(s);
      }
      // The cage of wind: three rings at their own tilts.
      const ringMat = new THREE.ShaderMaterial({
        name: 'smithHeartBreathStillstoneCage',
        uniforms: {
          uTime: h.uTime,
          uColor: { value: new THREE.Color(PC.ward) },
          uCore: { value: new THREE.Color(0xffffff) },
          uGlow: { value: 1 },
          uFlow: { value: 2.4 },
          uDash: { value: 5 },
          uFade: { value: 0 },
        },
        vertexShader: ISLE_UV_VERT,
        fragmentShader: ISLE_RIBBON_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      h.materials.push(ringMat);
      const rings: THREE.Mesh[] = [];
      for (let k = 0; k < STILLSTONE.rings; k++) {
        const r = new THREE.Mesh(wraps[k], ringMat);
        r.frustumCulled = false;
        group.add(r);
        rings.push(r);
      }
      // The rune circle under it (the floor ladder).
      const runeMat = new THREE.ShaderMaterial({
        name: 'smithHeartBreathStillstoneRunes',
        uniforms: {
          uTime: h.uTime,
          uColor: { value: new THREE.Color(PC.stone) },
          uWake: { value: 0 },
        },
        vertexShader: ISLE_UV_VERT,
        fragmentShader: ISLE_RUNE_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      h.materials.push(runeMat);
      const rune = new THREE.Mesh(runeGeo, runeMat);
      rune.renderOrder = floorVfxRenderOrder('encounter', 8);
      base.add(rune);
      const haloMat = new THREE.SpriteMaterial({
        map: glowTex,
        color: PC.stone,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        name: 'smithHeartBreathStillstoneHalo',
      });
      h.materials.push(haloMat);
      const halo = new THREE.Sprite(haloMat);
      halo.scale.setScalar(9);
      group.add(halo);
      this.stones.push({
        isle: i,
        group,
        crystalMat,
        crystal,
        rings,
        ringMat,
        runeMat,
        halo,
        haloMat,
        bodyId: -1,
        state: 'dormant',
        flare: 0,
      });
    }
    for (let k = 0; k < PHASE_POOLS.channels; k++)
      this.channels.push({
        beam: new IsleBeam(h, 'smithHeartBreathStillBeam', PC.stone, PC.stoneCore),
        id: -1,
      });
  }

  beginScan(): void {
    this.bodies.length = 0;
    this.channellers.length = 0;
  }

  /** A Stillstone's body (alive or stilled). */
  takeStone(e: Entity): void {
    this.bodies.push(e.id);
  }

  /** A player: channelling a stone? */
  takePlayer(e: Entity): void {
    if (e.castingAbility === ISLE_CASTS.still && e.castTargetId !== null)
      this.channellers.push(e.id);
  }

  endScan(world: IWorld): void {
    const o = this.h.local.position;
    for (const s of this.stones) s.bodyId = -1;
    for (const id of this.bodies) {
      const e = world.entities.get(id);
      if (!e) continue;
      let best: StoneSlot | null = null;
      let bestD = 1e9;
      for (const s of this.stones) {
        const sp = isleSpots()[s.isle];
        const at = sp.stone ?? sp;
        const d = Math.hypot(e.pos.x - o.x - at.x, e.pos.z - o.z - at.z);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      if (best && bestD < 12) best.bodyId = id;
    }
    this.channels.forEach((c, k) => {
      c.id = k < this.channellers.length ? this.channellers[k] : -1;
    });
  }

  /** Which stones the scan saw stilled ([east, west]: the cocoon's seals). */
  stilledSides(world: IWorld, out: [boolean, boolean]): [boolean, boolean] {
    out[0] = false;
    out[1] = false;
    for (const s of this.stones) {
      const e = s.bodyId >= 0 ? world.entities.get(s.bodyId) : undefined;
      if (e && stoneState(e, false) === 'stilled') out[BREATH_ISLES[s.isle].side] = true;
    }
    return out;
  }

  /** A stone was stilled (the cue from its body): its burst. */
  stilled(world: IWorld, stoneId: number): void {
    const e = world.entities.get(stoneId);
    const s = this.stones.find((q) => q.bodyId === stoneId) ?? this.nearest(e);
    if (!s) return;
    s.flare = 1.6;
    s.group.getWorldPosition(_wp);
    const p = this.h.particles;
    const n = Math.round(60 * (0.4 + 0.6 * this.h.density));
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const up = this.rand() * 1.4 - 0.4;
      p.puff(_wp.x, _wp.y, _wp.z, 1, {
        speed: 10 + this.rand() * 10,
        life: 1.1,
        size: [0.8, 0.12],
        color: this.rand() < 0.5 ? GOLD_RGB : [1, 1, 1],
        alpha: 1,
        pool: 'glow',
        dir: [Math.sin(a), up, Math.cos(a)],
        spread: 0.3,
        drag: 1,
        floor: -1e6,
      });
    }
    p.shockRing(_wp.x, _wp.z, PC.stilled, 16, 1.0, { wake: 0.7, crest: 0.12, strength: 1.2 });
    p.shockRing(_wp.x, _wp.z, 0xffffff, 9, 0.5);
    this.h.shakeNear(_wp.x, _wp.z, 0.35, 30);
  }

  private nearest(e: Entity | undefined): StoneSlot | null {
    if (!e) return null;
    const o = this.h.local.position;
    let best: StoneSlot | null = null;
    let bestD = 1e9;
    for (const s of this.stones) {
      const sp = isleSpots()[s.isle];
      const d = Math.hypot(e.pos.x - o.x - sp.x, e.pos.z - o.z - sp.z);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  update(world: IWorld, dt: number): void {
    const t = this.h.uTime.value;
    for (const s of this.stones) {
      const body = s.bodyId >= 0 ? (world.entities.get(s.bodyId) ?? null) : null;
      let channel = 0;
      let channelling = false;
      for (const c of this.channels) {
        if (c.id < 0 || !body) continue;
        const p = world.entities.get(c.id);
        if (p && p.castingAbility === ISLE_CASTS.still && p.castTargetId === body.id) {
          channelling = true;
          channel = Math.max(channel, 1 - p.castRemaining / Math.max(0.01, p.castTotal));
        }
      }
      s.state = stoneState(body, channelling);
      s.flare = Math.max(0, s.flare - dt * 1.2);
      const L = stoneLook(s.state, t, channel, _look);
      s.group.position.y = STILLSTONE.hover + L.bob;
      s.crystal.rotation.y += dt * L.spin;
      const u = s.crystalMat.uniforms;
      u.uGlow.value = L.glow + s.flare;
      u.uGoldK.value = L.gold;
      u.uPulse.value = L.pulse;
      s.ringMat.uniforms.uGlow.value = L.cage * 1.1;
      s.ringMat.uniforms.uFlow.value = L.cageSpin;
      for (let k = 0; k < s.rings.length; k++) {
        const r = s.rings[k];
        r.visible = L.cage > 0.02;
        r.rotation.y += dt * L.cageSpin * (k % 2 === 0 ? 1 : -0.7) * 0.8;
      }
      s.runeMat.uniforms.uWake.value =
        s.state === 'dormant' ? 0 : s.state === 'stilled' ? 0.4 : 0.8 + 0.6 * channel;
      (s.runeMat.uniforms.uColor.value as THREE.Color).copy(_teal).lerp(_gold, L.gold);
      s.haloMat.color.copy(_teal).lerp(_gold, L.gold);
      s.haloMat.opacity = 0.12 + 0.3 * L.glow + 0.4 * s.flare;
      s.halo.scale.setScalar(7 + 3 * L.pulse * (s.state === 'awake' ? 1 : 0.3) + 6 * s.flare);
      // Awake, motes drawn into it from round about (cosmetic).
      if ((s.state === 'awake' || s.state === 'channel') && this.rand() < dt * 9 * this.h.density) {
        s.group.getWorldPosition(_wp);
        const a = this.rand() * Math.PI * 2;
        const d = 4 + this.rand() * 3;
        this.h.particles.puff(
          _wp.x + Math.sin(a) * d,
          _wp.y - 1 + this.rand() * 3,
          _wp.z + Math.cos(a) * d,
          1,
          {
            speed: d * 1.3,
            life: 0.75,
            size: [0.12, 0.45],
            color: s.state === 'channel' ? GOLD_RGB : STONE_RGB,
            alpha: 0.95,
            pool: 'glow',
            dir: [-Math.sin(a), 0.1, -Math.cos(a)],
            spread: 0.05,
            drag: 0.3,
            floor: -1e6,
          },
        );
      }
    }
    // The channellers' beams into their stones.
    for (const c of this.channels) {
      const p = c.id >= 0 ? world.entities.get(c.id) : undefined;
      const s =
        p && p.castingAbility === ISLE_CASTS.still
          ? this.stones.find((q) => q.bodyId === p.castTargetId)
          : undefined;
      if (!p || !s) {
        c.beam.hide();
        continue;
      }
      const a = fxAnchor(p);
      _from.x = a.x;
      _from.y = p.pos.y + 1.6;
      _from.z = a.z;
      s.group.getWorldPosition(_wp);
      _to.x = _wp.x;
      _to.y = _wp.y;
      _to.z = _wp.z;
      const k = 1 - p.castRemaining / Math.max(0.01, p.castTotal);
      c.beam.lay(_from, _to, 0.5 + 0.4 * k, 1.2, 0.15, t);
      c.beam.paint(1.2 + 1.2 * k + 0.3 * Math.sin(t * 13), 0);
      (c.beam.mat.uniforms.uColor.value as THREE.Color).copy(_teal).lerp(_gold, k * 0.7);
    }
  }

  /** The state of the stone on isle `i` (the tests read it). */
  stateOf(i: number): StoneState | null {
    return this.stones.find((s) => s.isle === i)?.state ?? null;
  }

  leave(): void {
    for (const s of this.stones) {
      s.bodyId = -1;
      s.state = 'dormant';
      s.flare = 0;
    }
    for (const c of this.channels) {
      c.id = -1;
      c.beam.hide();
    }
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }
}
