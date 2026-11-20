// The Hammer Council's entrance, "The quarry wakes" (plan:
// council_entrance_core.ts), hosted by ../rift_death_zone.ts beside the
// raid's other fx and updated before the council's own painters: it reads
// the scene's clock off the members' auras (IWorld only, so offline and
// online look the same), sends both rigs' stances through the gesture seam
// (asleep on their Dormant clips and held dark, the Awaken one-shot as each
// breaks out, the Guardian's punch, the Singer's note) and draws the rest:
//  - the thrum: the floor's pebbles hopping (one instanced draw, every hop
//    in its vertex shader), dust trickling off the terraces, the camera's
//    tremor (none under reduced motion), the low rumble;
//  - the five carved columns lighting one by one (a sheath of climbing runes
//    on each, motes and a floor ring at its foot as it wakes);
//  - the Guardian's rock (council_entrance_stone.ts): its cracks, the tear,
//    the slabs, the rubble, the dust, the punch's rolling wall of dust;
//  - the Seam Singer's crystal (council_entrance_crystal.ts): its ringing and
//    its rings, the shatter, her orbiting shards, the note's wave of light;
//  - every crystal in the room (the geodes, the columns' crowns) flaring as
//    the wave passes, the burst of light at the shatter and at the note (a
//    flash on her, never a white-out; none under reduced motion), the thuds
//    at the tear, the punch and the shatter.
// No camera is taken, no control: the player plays through it.
//
// Rules (src/render/CLAUDE.md): every geometry and material is built in the
// constructor under one root attached through attachSceneGroupGated (the
// compile gate links every program before the first frame that draws it);
// fixed pools, no light, no per-frame allocation; the rigs' own materials
// are never written (their dark rides the rig's glow pulse clones). The low
// tier thins the particles, the rubble, the shards and the pebbles; every
// beat plays on every tier.

import * as THREE from 'three';
import { sfx } from '../../game/sfx';
import { HAMMER_PIT, QUARRY_PILLAR_SPOTS } from '../../sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin, instanceSlotForZ } from '../../sim/data';
import { COUNCIL_TEMPLATES } from '../../sim/encounters/smith_heart/council_ids';
import { COUNCIL_INTRO } from '../../sim/encounters/smith_heart/council_intro_plan';
import type { Entity } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { fxAnchor } from '../attached_fx_anchor';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { getFlameTex } from '../ignivar_fire_vfx';
import { setRenderCategory } from '../renderer_diagnostics';
import { EngineParticles } from '../trash_engine_fx/engine_particles';
import {
  AWAKE,
  COLUMN_SHEATH,
  COUNCIL_ENTRANCE,
  COUNCIL_ENTRANCE_GESTURE_AT,
  COUNCIL_ENTRANCE_GESTURES,
  COUNCIL_ENTRANCE_GROW,
  COUNCIL_ENTRANCE_POOLS,
  COUNCIL_ENTRANCE_SOUNDS,
  type CouncilEntranceClock,
  type CouncilEntranceLook,
  type CouncilEntranceStance,
  columnLightAt,
  councilEntranceClock,
  councilEntranceFlash,
  councilEntranceLight,
  councilEntranceLook,
  councilEntrancePicks,
  councilEntranceShake,
  crossedCouncilBeat,
  crystalFlare,
  DUST_SPOTS,
  newCouncilEntranceLook,
  QUARRY_CRYSTALS,
  QUARRY_PEBBLES,
  stepCouncilEntranceTime,
} from './council_entrance_core';
import { CouncilEntranceCrystal } from './council_entrance_crystal';
import {
  GLOW_FRAG,
  GLOW_VERT,
  PEBBLE_VERT,
  SHEATH_FRAG,
  SHEATH_VERT,
  STONE_FRAG,
} from './council_entrance_glsl';
import { CouncilEntranceStone, rockGeometry } from './council_entrance_stone';
import { inSmithHeartClaim } from './council_fx_core';
import { entranceBudgetNow } from './entrance_budget';

const SCAN_SEC = 0.25;
/** Seconds between re-sends of a held stance and of a dark pulse (the
 *  pulse holds 1 s, so a body stays dark while it is re-sent, even on a slow
 *  frame; a rebuilt view picks the stance up on the next send). */
const RESEND_SEC = 0.35;
/** Seconds between two tremors of the thrum. */
const TREMOR_SEC = 0.45;
const E = COUNCIL_ENTRANCE;
const P = COUNCIL_ENTRANCE_POOLS;
const G = COUNCIL_ENTRANCE_GESTURES;
const GA = COUNCIL_ENTRANCE_GESTURE_AT;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _dir: [number, number, number] = [0, -1, 0];

type Role = 'guardian' | 'singer';
const ROLES: readonly Role[] = ['guardian', 'singer'];

/** One rig's stance as last sent, its dark held. */
interface RigSend {
  sent: CouncilEntranceStance | null;
  dimming: boolean;
}

export class CouncilEntranceFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  /** The quarry's middle (instance-local yards for the pebbles, the columns
   *  and the room's crystals). */
  private readonly pit = new THREE.Group();
  readonly uTime = { value: 0 };
  readonly density: number;
  readonly detail: boolean;
  /** The tier draws the cosmetic doubles (the room's crystals flaring with
   *  the note's wave): entrance_budget_core.ts. */
  private readonly secondary: boolean;
  readonly particles: EngineParticles;
  readonly geometries: THREE.BufferGeometry[] = [];
  readonly materials: THREE.Material[] = [];
  private readonly stone: CouncilEntranceStone;
  private readonly crystal: CouncilEntranceCrystal;
  private readonly pebbles: THREE.InstancedMesh;
  private readonly pebbleMat: THREE.ShaderMaterial;
  private readonly pebblePicks: number[];
  private readonly sheaths: THREE.InstancedMesh;
  private readonly flares: THREE.InstancedMesh;
  private readonly flash: THREE.InstancedMesh;
  private readonly look = newCouncilEntranceLook();
  private readonly clockRead: CouncilEntranceClock = { stage: 'none', t: 0 };
  private readonly ids: Record<Role, number> = { guardian: -1, singer: -1 };
  private readonly sends: Record<Role, RigSend> = {
    guardian: { sent: null, dimming: false },
    singer: { sent: null, dimming: false },
  };
  private rosterSeen = Number.NaN;
  private placedX = Number.NaN;
  private placedZ = Number.NaN;
  /** Each set piece stood on its body (a body may resolve a scan late). */
  private readonly placed = { stone: false, crystal: false };
  private time = AWAKE;
  /** The scene was cut short (a forced pull) and jumped to the shatter: only
   *  the breaks themselves play. */
  private cut = false;
  private scanTimer = 0;
  private resendIn = 0;
  private tremorIn = 0;
  private dustOwed = 0;
  private clock = 0;
  private seed = 0x5ea7;
  private disposed = false;
  /** The painter's time a frame ago (the beats' crossing reads it). */
  private beatPrev = AWAKE;
  /** Did the scene cross `at` this frame (any beat)? */
  private readonly crossedAny = (at: number): boolean =>
    crossedCouncilBeat(this.beatPrev, this.time, at);
  /** Did the scene cross `at` this frame, as the painter plays it (a scene cut
   *  short plays only its two breaks)? */
  private readonly crossedPlayed = (at: number): boolean =>
    crossedCouncilBeat(this.beatPrev, this.time, at) &&
    (!this.cut || at === E.tearAt || at === E.shatterAt);

  constructor(
    scene: THREE.Scene,
    private readonly ground: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly motionReduced: () => boolean = () => false,
    private readonly shakeSink?: (amount: number) => void,
    private readonly playGesture?: (entityId: number, gesture: string) => void,
  ) {
    this.root.name = 'smith-heart-council-entrance';
    setRenderCategory(this.root, 'ui3d');
    this.pit.name = 'smithHeartCouncilEntrancePit';
    this.pit.visible = false;
    this.root.add(this.pit);
    const budget = entranceBudgetNow('council');
    this.detail = budget.detail;
    this.secondary = budget.secondary;
    this.density = budget.share;
    const hasDom = typeof document !== 'undefined';
    this.particles = new EngineParticles(
      this.root,
      this.uTime,
      this.density,
      (x, z) => this.ground(x, z),
      () => this.rand(),
      () => this.motionReduced(),
      hasDom ? getFlameTex() : null,
    );
    this.stone = new CouncilEntranceStone(this.root, this);
    this.crystal = new CouncilEntranceCrystal(this.root, this);

    // ---- the pebbles: one instanced draw, every hop in its vertex shader ----
    this.pebblePicks = councilEntrancePicks(QUARRY_PEBBLES.length, this.detail);
    const pebbleGeo = rockGeometry(53, 0.5);
    const aPeb = new Float32Array(this.pebblePicks.length * 2);
    this.pebblePicks.forEach((src, i) => {
      const pb = QUARRY_PEBBLES[src];
      aPeb[i * 2] = pb.seed;
      aPeb[i * 2 + 1] = Math.hypot(pb.x, pb.z);
    });
    pebbleGeo.setAttribute('aPeb', new THREE.InstancedBufferAttribute(aPeb, 2));
    this.geometries.push(pebbleGeo);
    this.pebbleMat = new THREE.ShaderMaterial({
      name: 'smithHeartCouncilEntrancePebbles',
      uniforms: {
        uThrum: { value: 0 },
        uTime: this.uTime,
        uRingR: { value: 0 },
        uRing: { value: 0 },
        uCrack: { value: 0 },
        uHeat: { value: 0 },
        uHeight: { value: 1 },
        uEmber: { value: 0 },
        uTint: { value: 0.55 },
      },
      vertexShader: PEBBLE_VERT,
      fragmentShader: STONE_FRAG,
    });
    this.materials.push(this.pebbleMat);
    this.pebbles = new THREE.InstancedMesh(pebbleGeo, this.pebbleMat, this.pebblePicks.length);
    this.pebbles.name = 'smithHeartCouncilEntrancePebbles';
    this.pebbles.frustumCulled = false;
    this.pit.add(this.pebbles);

    // ---- the columns' runes: a sheath on each ----
    // A square tube (its faces on the column's), uv.x round it, uv.y up it.
    const sheathGeo = new THREE.CylinderGeometry(Math.SQRT2, Math.SQRT2, 1, 4, 1, true)
      .rotateY(Math.PI / 4)
      .translate(0, 0.5, 0);
    this.geometries.push(sheathGeo);
    const sheathMat = new THREE.ShaderMaterial({
      name: 'smithHeartCouncilEntranceColumns',
      uniforms: { uTime: this.uTime },
      vertexShader: SHEATH_VERT,
      fragmentShader: SHEATH_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.materials.push(sheathMat);
    this.sheaths = new THREE.InstancedMesh(sheathGeo, sheathMat, QUARRY_PILLAR_SPOTS.length);
    this.sheaths.name = 'smithHeartCouncilEntranceColumns';
    this.sheaths.frustumCulled = false;
    for (let i = 0; i < QUARRY_PILLAR_SPOTS.length; i++) {
      this.sheaths.setMatrixAt(i, _zero);
      this.sheaths.setColorAt(i, _c.setRGB(0, 0, 0));
    }
    this.pit.add(this.sheaths);

    // ---- light cards: the room's crystals, the flash ----
    const card = new THREE.PlaneGeometry(1, 1);
    this.geometries.push(card);
    const glowMat = (name: string, depthTest: boolean) => {
      const m = new THREE.ShaderMaterial({
        name,
        vertexShader: GLOW_VERT,
        fragmentShader: GLOW_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      this.materials.push(m);
      return m;
    };
    this.flares = new THREE.InstancedMesh(
      card,
      glowMat('smithHeartCouncilEntranceFlares', true),
      QUARRY_CRYSTALS.length,
    );
    this.flares.name = 'smithHeartCouncilEntranceFlares';
    this.flares.frustumCulled = false;
    for (let i = 0; i < QUARRY_CRYSTALS.length; i++) {
      this.flares.setMatrixAt(i, _zero);
      this.flares.setColorAt(i, _c.setRGB(0, 0, 0));
    }
    this.pit.add(this.flares);
    this.flash = new THREE.InstancedMesh(card, glowMat('smithHeartCouncilEntranceFlash', false), 1);
    this.flash.name = 'smithHeartCouncilEntranceFlash';
    this.flash.frustumCulled = false;
    this.flash.visible = false;
    this.flash.renderOrder = 10_000;
    this.flash.setMatrixAt(0, _zero);
    this.flash.setColorAt(0, _c.setRGB(0, 0, 0));
    this.root.add(this.flash);

    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  reducedMotion(): boolean {
    return this.motionReduced();
  }

  groundY(x: number, z: number): number {
    return this.ground(x, z);
  }

  /** The entrance's look (tests read it). */
  get currentLook(): CouncilEntranceLook {
    return this.look;
  }

  update(dt: number): void {
    const world = this.world;
    if (!world || this.disposed) return;
    this.clock += dt;
    this.uTime.value = this.clock;
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = SCAN_SEC;
      this.scan(world);
    }
    const g = this.body(world, 'guardian');
    const s = this.body(world, 'singer');
    const lead = g && !g.dead ? g : s && !s.dead ? s : null;
    if (!lead) {
      if (this.ids.guardian >= 0 || this.ids.singer >= 0) this.release();
      return;
    }
    const prev = this.time;
    const next = stepCouncilEntranceTime(
      prev,
      dt,
      councilEntranceClock(lead.auras, this.clockRead),
    );
    // Cut short (the auras gone before the shatter): the breaks play at once.
    if (prev >= 0 && this.clockRead.stage === 'none' && next >= 0 && next - prev > dt + 0.25)
      this.cut = true;
    if (next < 0) this.cut = false;
    this.time = next;
    this.beatPrev = prev;
    const look = councilEntranceLook(this.time, this.look);
    // Cut short: the breaks play, never the note it never sang (its wave,
    // its flash, its fling, the room's flares).
    if (this.cut) {
      look.wave = 0;
      look.waveR = 0;
      look.sinceNote = -99;
      look.orbitFling = -99;
      if (look.sinceShatter > E.flashFor) look.flash = 0;
    }
    this.stances(g, s, look, dt);
    // The pools run on past the scene, so each one's last particles die and
    // its mesh hides itself.
    this.particles.update(this.clock);
    if (!look.active) {
      if (this.pit.visible) this.hide();
      this.placed.stone = false;
      this.placed.crystal = false;
      return;
    }
    this.place(lead, g, s);
    this.pit.visible = true;
    this.paint(g, s, look, dt);
  }

  private body(world: IWorld, role: Role): Entity | null {
    const id = this.ids[role];
    return id >= 0 ? (world.entities.get(id) ?? null) : null;
  }

  // ---- the scan --------------------------------------------------------------------------------

  private scan(world: IWorld): void {
    for (const role of ROLES) {
      if (this.ids[role] >= 0 && !world.entities.has(this.ids[role])) this.ids[role] = -1;
    }
    const me = world.entities.get(world.playerId);
    if (!me || !inSmithHeartClaim(me.pos.x, me.pos.z)) {
      if (this.ids.guardian >= 0 || this.ids.singer >= 0) this.release();
      this.rosterSeen = Number.NaN;
      return;
    }
    if (this.ids.guardian >= 0 && this.ids.singer >= 0) return;
    if (world.entityRosterVersion === this.rosterSeen) return;
    this.rosterSeen = world.entityRosterVersion;
    for (const e of world.entities.values()) {
      if (e.kind !== 'mob') continue;
      if (e.templateId === COUNCIL_TEMPLATES.guardian && this.ids.guardian < 0)
        this.ids.guardian = e.id;
      else if (e.templateId === COUNCIL_TEMPLATES.singer && this.ids.singer < 0)
        this.ids.singer = e.id;
    }
  }

  private release(): void {
    this.ids.guardian = -1;
    this.ids.singer = -1;
    this.sends.guardian.sent = null;
    this.sends.guardian.dimming = false;
    this.sends.singer.sent = null;
    this.sends.singer.dimming = false;
    this.rosterSeen = Number.NaN;
    this.time = AWAKE;
    this.cut = false;
    this.placedX = Number.NaN;
    this.placedZ = Number.NaN;
    this.placed.stone = false;
    this.placed.crystal = false;
    this.hide();
  }

  private hide(): void {
    this.pit.visible = false;
    this.stone.hide();
    this.crystal.hide();
    this.flash.visible = false;
    this.particles.hideRings();
  }

  /** Stand the pit's stage on the claim's quarry; the pebbles, the columns'
   *  sheaths laid on the floor once per claim; the rock and the vein on their
   *  bodies. */
  private place(lead: Entity, g: Entity | null, s: Entity | null): void {
    const def = DUNGEONS.smith_heart;
    if (!def) return;
    const o = instanceOrigin(def.index, instanceSlotForZ(lead.pos.z));
    if (o.x !== this.placedX || o.z !== this.placedZ) {
      this.placedX = o.x;
      this.placedZ = o.z;
      const px = o.x + HAMMER_PIT.x;
      const pz = o.z + HAMMER_PIT.z;
      const py = this.ground(px, pz);
      this.pit.position.set(px, py, pz);
      this.pit.updateMatrixWorld();
      for (let i = 0; i < this.pebblePicks.length; i++) {
        const pb = QUARRY_PEBBLES[this.pebblePicks[i]];
        _p.set(pb.x, this.ground(px + pb.x, pz + pb.z) - py + pb.size * 0.3, pb.z);
        _q.setFromAxisAngle(_up, pb.seed * Math.PI * 2);
        _s.set(pb.size * 1.3, pb.size, pb.size * 1.1);
        _m.compose(_p, _q, _s);
        this.pebbles.setMatrixAt(i, _m);
      }
      this.pebbles.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < QUARRY_PILLAR_SPOTS.length; i++) {
        const c = QUARRY_PILLAR_SPOTS[i];
        const x = c.x - HAMMER_PIT.x;
        const z = c.z - HAMMER_PIT.z;
        _p.set(x, this.ground(o.x + c.x, o.z + c.z) - py + COLUMN_SHEATH.foot, z);
        _q.setFromAxisAngle(_up, c.rot);
        _s.set(COLUMN_SHEATH.half, COLUMN_SHEATH.height, COLUMN_SHEATH.half);
        _m.compose(_p, _q, _s);
        this.sheaths.setMatrixAt(i, _m);
      }
      this.sheaths.instanceMatrix.needsUpdate = true;
      this.placed.stone = false;
      this.placed.crystal = false;
    }
    if (g && !this.placed.stone) {
      this.stone.place(g.pos.x, g.pos.y, g.pos.z, g.facing);
      this.placed.stone = true;
    }
    if (s && !this.placed.crystal) {
      this.crystal.place(s.pos.x, s.pos.z, s.facing);
      this.placed.crystal = true;
    }
  }

  // ---- the stances -----------------------------------------------------------------------------

  /** Each rig's stance and dark, through the gesture seam; the one-shots on
   *  their beats. */
  private stances(g: Entity | null, s: Entity | null, look: CouncilEntranceLook, dt: number): void {
    if (!this.playGesture) return;
    this.resendIn -= dt;
    const resend = this.resendIn <= 0;
    if (resend) this.resendIn = RESEND_SEC;
    const crossed = this.crossedAny;
    this.rig(
      g,
      'guardian',
      look.active ? look.guardianStance : 'stand',
      look.guardianDim && look.active,
      resend,
      crossed(GA.guardianEmerge),
    );
    this.rig(
      s,
      'singer',
      look.active ? look.singerStance : 'stand',
      look.singerDim && look.active,
      resend,
      crossed(GA.singerEmerge),
    );
    if (!this.cut) {
      if (g && !g.dead && crossed(GA.guardianPunch)) this.playGesture(g.id, G.guardianPunch);
      if (s && !s.dead && crossed(GA.singerNote)) this.playGesture(s.id, G.singerNote);
    }
  }

  /** One rig: asleep (re-sent) and dark, its Awaken once as it breaks out
   *  (sent a breath before the break, so the clip's rise lands on it), then
   *  standing. A break never seen crossing (joined after it): stand, no
   *  replayed Awaken. */
  private rig(
    e: Entity | null,
    role: Role,
    stance: CouncilEntranceStance,
    dim: boolean,
    resend: boolean,
    emergeNow: boolean,
  ): void {
    const send = this.sends[role];
    if (!e || e.dead || !this.playGesture) return;
    const dormant = role === 'guardian' ? G.guardianDormant : G.singerDormant;
    const emerge = role === 'guardian' ? G.guardianEmerge : G.singerEmerge;
    const stand = role === 'guardian' ? G.guardianStand : G.singerStand;
    const dark = role === 'guardian' ? G.guardianDim : G.singerDim;
    // Its Awaken leaves a breath before the break (the clip holds its crouch
    // that long): from then the rig is breaking out, even while the scene's
    // stance still reads asleep.
    let want: CouncilEntranceStance = stance;
    if (emergeNow) want = 'emerge';
    else if (send.sent === 'emerge' && stance === 'dormant') want = 'emerge';
    if (want === 'emerge' && send.sent !== 'emerge' && !emergeNow) want = 'stand';
    if (want !== send.sent) {
      // Never stand a rig nobody has seen asleep: the stance is its own
      // default then.
      if (!(want === 'stand' && send.sent === null)) {
        this.playGesture(e.id, want === 'dormant' ? dormant : want === 'emerge' ? emerge : stand);
      }
      send.sent = want;
    } else if (resend && want === 'dormant') this.playGesture(e.id, dormant);
    if (dim && want === 'dormant') {
      if (resend || !send.dimming) this.playGesture(e.id, dark);
      send.dimming = true;
    } else send.dimming = false;
  }

  // ---- the paint -------------------------------------------------------------------------------

  private paint(g: Entity | null, s: Entity | null, L: CouncilEntranceLook, dt: number): void {
    const reduced = this.motionReduced();
    const cut = this.cut;
    // A beat crossed this frame (a scene joined mid-way plays no one-shot it
    // missed; a scene cut short plays only the two breaks).
    const crossed = this.crossedPlayed;
    // The thrum: the pebbles, the dust off the terraces, the tremor.
    const pu = this.pebbleMat.uniforms;
    pu.uThrum.value = L.thrum;
    pu.uRingR.value = L.ringR;
    pu.uRing.value = L.ring;
    this.pebbles.visible = L.thrum > 0.01 || L.ring > 0.01 || L.dormant;
    this.trickle(L, dt);
    this.tremorIn -= dt;
    if (this.tremorIn <= 0) {
      this.tremorIn = TREMOR_SEC;
      if (L.thrum > 0.2)
        this.thud(E.shakeThrum * L.thrum, this.pit.position.x, this.pit.position.z);
    }
    // The columns.
    let anyColumn = false;
    for (let i = 0; i < QUARRY_PILLAR_SPOTS.length; i++) {
      const c = QUARRY_PILLAR_SPOTS[i];
      const d = s ? Math.hypot(this.placedX + c.x - s.pos.x, this.placedZ + c.z - s.pos.z) : 99;
      const flare = crystalFlare(L, d);
      const glow = councilEntranceLight(L.columnGlow[i] + flare * L.columnClimb[i], reduced);
      this.sheaths.setColorAt(i, _c.setRGB(L.columnClimb[i], glow, 0));
      if (glow > 0.001) anyColumn = true;
      if (crossed(columnLightAt(i))) this.columnWakes(c.x - HAMMER_PIT.x, c.z - HAMMER_PIT.z);
    }
    this.sheaths.visible = anyColumn;
    if (anyColumn && this.sheaths.instanceColor) this.sheaths.instanceColor.needsUpdate = true;
    // Every crystal in the room, as the wave passes (a cosmetic double over
    // the note's own curtain of light: the low tier keeps the curtain only).
    let anyFlare = false;
    for (let i = 0; this.secondary && i < QUARRY_CRYSTALS.length; i++) {
      const k = QUARRY_CRYSTALS[i];
      const d = s ? Math.hypot(this.placedX + k.x - s.pos.x, this.placedZ + k.z - s.pos.z) : 99;
      const f = councilEntranceLight(crystalFlare(L, d), reduced);
      if (f <= 0.01) {
        this.flares.setMatrixAt(i, _zero);
        continue;
      }
      anyFlare = true;
      const x = k.x - HAMMER_PIT.x;
      const z = k.z - HAMMER_PIT.z;
      _p.set(
        x,
        this.ground(this.placedX + k.x, this.placedZ + k.z) - this.pit.position.y + k.lift,
        z,
      );
      _q.identity();
      _s.setScalar(k.size * (0.7 + 0.5 * Math.min(1.4, f)));
      _m.compose(_p, _q, _s);
      this.flares.setMatrixAt(i, _m);
      this.flares.setColorAt(i, _c.setRGB(f, 0.66 * f, 0.3 * f));
    }
    this.flares.visible = anyFlare;
    if (anyFlare) {
      this.flares.instanceMatrix.needsUpdate = true;
      if (this.flares.instanceColor) this.flares.instanceColor.needsUpdate = true;
    }
    // The two bodies' set pieces.
    if (g) this.stone.paint(L, crossed);
    else this.stone.hide();
    if (s) {
      const at = fxAnchor(s);
      this.crystal.paint(L, at, s.facing, dt, crossed);
    } else this.crystal.hide();
    // The thuds.
    if (g && crossed(E.tearAt)) this.thud(E.shakeTear, g.pos.x, g.pos.z);
    if (g && crossed(E.punchAt)) this.thud(E.shakePunch, g.pos.x, g.pos.z);
    if (s && crossed(E.shatterAt)) this.thud(E.shakeShatter, s.pos.x, s.pos.z);
    // The burst of light on her (none under reduced motion).
    const flash = councilEntranceFlash(L, reduced);
    this.flash.visible = flash > 0.002 && s !== null;
    if (this.flash.visible && s) {
      _p.set(s.pos.x, this.ground(s.pos.x, s.pos.z) + 3.2 * COUNCIL_ENTRANCE_GROW.singer, s.pos.z);
      _q.identity();
      _s.setScalar(E.flashSize * (0.7 + 0.3 * flash));
      _m.compose(_p, _q, _s);
      this.flash.setMatrixAt(0, _m);
      const k = flash * E.flashPeak;
      this.flash.setColorAt(0, _c.setRGB(k, 0.8 * k, 0.5 * k));
      this.flash.instanceMatrix.needsUpdate = true;
      if (this.flash.instanceColor) this.flash.instanceColor.needsUpdate = true;
    }
    // The sounds, each on its beat for a scene seen crossing it (a cut-short
    // scene: only the breaks' own).
    for (let si = 0; si < COUNCIL_ENTRANCE_SOUNDS.length; si++) {
      const snd = COUNCIL_ENTRANCE_SOUNDS[si];
      if (cut && snd.at !== E.tearAt && snd.at !== E.shatterAt) continue;
      if (!this.crossedAny(snd.at)) continue;
      const src = snd.at >= E.veinAt - 0.5 ? s : g;
      const at = src ?? g ?? s;
      if (!at) continue;
      sfx.playAt(snd.key, at.pos.x, at.pos.y + 1, at.pos.z, {
        gain: snd.gain,
        rate: snd.rate,
        cooldown: 0.05,
        jitter: false,
        priority: true,
      });
    }
  }

  /** Dust trickling off the terraces' lips with the thrum, pouring at the
   *  tear and the punch. */
  private trickle(L: CouncilEntranceLook, dt: number): void {
    const surge =
      (L.sinceTear >= 0 && L.sinceTear < 1.5 ? 1.5 : 0) +
      (L.sincePunch >= 0 && L.sincePunch < 1.5 ? 2 : 0);
    this.dustOwed += dt * P.dustRate * (L.thrum + surge) * this.density;
    if (this.dustOwed > 20) this.dustOwed = 20;
    while (this.dustOwed >= 1) {
      this.dustOwed -= 1;
      const spot = DUST_SPOTS[Math.floor(this.rand() * DUST_SPOTS.length)];
      const x = this.placedX + spot.x + (this.rand() - 0.5) * 3;
      const z = this.placedZ + spot.z + (this.rand() - 0.5) * 3;
      TRICKLE.floor = this.ground(x, z) + 0.2;
      this.particles.puff(x, spot.y, z, 1, TRICKLE);
    }
  }

  /** A column wakes: motes rising off its foot, a ring on the floor. */
  private columnWakes(x: number, z: number): void {
    const wx = this.pit.position.x + x;
    const wz = this.pit.position.z + z;
    const y = this.ground(wx, wz);
    this.particles.puff(wx, y + 1, wz, P.columnMotes, MOTE);
    this.particles.shockRing(wx, wz, 0xffa848, 6, 0.8, { wake: 0.4, crest: 0.2, strength: 0.8 });
  }

  /** A thud of `amount` at (x, z) for this viewer. */
  private thud(amount: number, x: number, z: number): void {
    const me = this.world?.entities.get(this.world.playerId);
    if (!this.shakeSink || !me) return;
    const k = councilEntranceShake(
      amount,
      Math.hypot(me.pos.x - x, me.pos.z - z),
      this.motionReduced(),
    );
    if (k > 0) this.shakeSink(k);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
    this.root.removeFromParent();
    this.particles.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}

/** The scene's length the painter plays past the hand-back (tests read it). */
export const COUNCIL_ENTRANCE_TAIL = E.end - COUNCIL_INTRO.seconds;

// ---- particles' options (written in place) -----------------------------------------------------

const TRICKLE = {
  speed: 0.3,
  life: 2.6,
  size: [0.5, 1.6] as [number, number],
  color: [0.7, 0.6, 0.46] as [number, number, number],
  alpha: 0.42,
  dir: _dir,
  spread: 0.12,
  gravity: 7,
  drag: 0.4,
  floor: 0,
};
const MOTE = {
  speed: 0.7,
  up: 3.4,
  life: 1.8,
  size: [0.35, 0.08] as [number, number],
  color: [1.0, 0.72, 0.36] as [number, number, number],
  alpha: 1,
  pool: 'glow' as const,
  radius: 2.6,
  drag: 0.5,
};
