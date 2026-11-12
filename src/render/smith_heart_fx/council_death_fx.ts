// The Hammer Council's deaths, "The quarry falls silent" (plan:
// council_death_core.ts), hosted by ../rift_death_zone.ts beside the raid's
// other fx and updated after the council's own painters. It reads each
// member's death off IWorld (its body dead: offline and online alike), runs
// each one's scene clock (a death seen live plays it; a corpse first seen
// dead is long past it and shows only its rubble and its husk; a dev replay
// cue, `/dev heart council death`, plays it on a living body), reads where
// each rock and crystal of the bodies is through their bones' sockets
// (council_body_sockets.ts), sends the husks' shade and a replay's fall
// through the gesture seam, and draws:
//  - the Guardian's death (council_death_stone.ts): its cracks blazing gold,
//    the kneel, the split into slumping slabs, the core guttering out;
//  - the Seam Singer's (council_death_crystal.ts): her last note's rings,
//    the light leaking out of her fracturing crystal, the shatter, the shards
//    hanging a beat and raining down;
//  - the encounter's end, when the second one falls: the five carved columns
//    surging with light and powering down one by one (the entrance's runes
//    draining from their crowns to their feet), the room's crystals settling
//    dark, a last dust drifting down over the quarry;
//  - the light cards, the flashes, the thuds and the sounds on their beats.
// No camera is taken, no control, nothing held back from loot or exit.
//
// Rules (src/render/CLAUDE.md): every geometry and material is built in the
// constructor under one root attached through attachSceneGroupGated (the
// compile gate links every program before the first frame that draws it; all
// but the light shafts' are the entrance's own); fixed pools, no light, no
// per-frame allocation; the rigs' own materials are never written (their
// dark rides the rig's glow pulse clones). The low tier thins the rubble,
// the shards and the particles and sheds the room's crystals' flare
// (`COUNCIL_DEATH_SECONDARY_LAYERS`); every beat plays on every tier.

import * as THREE from 'three';
import { sfx } from '../../game/sfx';
import { HAMMER_PIT, QUARRY_PILLAR_SPOTS } from '../../sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin, instanceSlotForZ } from '../../sim/data';
import {
  COUNCIL_DEV_CUES,
  COUNCIL_TEMPLATES,
  type CouncilRole,
  councilPillarOf,
} from '../../sim/encounters/smith_heart/council_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { fxAnchor } from '../attached_fx_anchor';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { getFlameTex } from '../ignivar_fire_vfx';
import { setRenderCategory } from '../renderer_diagnostics';
import { EngineParticles } from '../trash_engine_fx/engine_particles';
import {
  clearCouncilBodySockets,
  councilBodySockets,
  retryCouncilBodySockets,
} from './council_body_sockets';
import {
  COLUMN_DOWN_ORDER,
  COUNCIL_DEATH_END,
  COUNCIL_DEATH_GESTURES,
  COUNCIL_DEATH_POINTS,
  COUNCIL_DEATH_RATES,
  COUNCIL_DEATH_SHAKES,
  COUNCIL_END_SECONDS,
  COUNCIL_END_SOUNDS,
  COUNCIL_HUSK_EVERY,
  COUNCIL_REPLAY_STAGGER,
  type CouncilDeathSound,
  columnDownAt,
  councilDeathCrossed,
  councilDeathLight,
  councilDeathShake,
  councilDeathTime,
  councilEndLook,
  councilEndTime,
  councilPointFallback,
  councilReplaySeconds,
  GUARDIAN_DEATH,
  GUARDIAN_DEATH_SOUNDS,
  guardianDeathLook,
  newCouncilEndLook,
  newGuardianDeathLook,
  newSingerDeathLook,
  SINGER_DEATH_SOUNDS,
  singerDeathLook,
} from './council_death_core';
import { CouncilDeathCrystal } from './council_death_crystal';
import { LEAK_FRAG, LEAK_VERT } from './council_death_glsl';
import { type CouncilDeathBody, CouncilDeathStone } from './council_death_stone';
import { COLUMN_SHEATH, COUNCIL_ENTRANCE_GESTURES, QUARRY_CRYSTALS } from './council_entrance_core';
import { GLOW_FRAG, GLOW_VERT, SHEATH_FRAG, SHEATH_VERT } from './council_entrance_glsl';
import { inSmithHeartClaim } from './council_fx_core';
import { entranceBudgetNow } from './entrance_budget';
import { COUNCIL_DEATH_SECONDARY_LAYERS } from './entrance_budget_core';

const SCAN_SEC = 0.25;
/** Light cards a frame can draw (the Guardian's two per rock and its core,
 *  the Singer's one per crystal and her chest). */
const CARDS = 96;
const FLASHES = 4;
/** Shafts of light a frame can draw (the Guardian's and the Singer's). */
const SHAFTS = 32;
const ROLES: readonly CouncilRole[] = ['guardian', 'singer'];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _c = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _fb = { side: 0, fwd: 0, y: 0 };

/** One member's death as the painter tracks it. */
interface MemberRec {
  id: number;
  deadKnown: boolean;
  deadAt: number;
  seenAlive: boolean;
  /** A dev replay's start on this clock (-1 none). */
  replayAt: number;
  /** The scene's clock (-1 none) and last frame's. */
  t: number;
  prev: number;
  /** The replay's fall was sent (its stand is owed at its end). */
  fell: boolean;
  huskIn: number;
  body: CouncilDeathBody;
}

const newRec = (role: CouncilRole): MemberRec => ({
  id: -1,
  deadKnown: false,
  deadAt: 0,
  seenAlive: false,
  replayAt: -1,
  t: -1,
  prev: -1,
  fell: false,
  huskIn: 0,
  body: {
    x: 0,
    y: 0,
    z: 0,
    facing: 0,
    pts: new Float32Array(COUNCIL_DEATH_POINTS[role].length * 3),
  },
});

export class CouncilDeathFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  /** The quarry's middle (instance-local yards for the columns and the
   *  room's crystals). */
  private readonly pit = new THREE.Group();
  readonly uTime = { value: 0 };
  readonly density: number;
  private readonly secondary: boolean;
  readonly particles: EngineParticles;
  readonly geometries: THREE.BufferGeometry[] = [];
  readonly materials: THREE.Material[] = [];
  private readonly stone: CouncilDeathStone;
  private readonly crystal: CouncilDeathCrystal;
  private readonly cards: THREE.InstancedMesh;
  private readonly flashes: THREE.InstancedMesh;
  private readonly shafts: THREE.InstancedMesh;
  private shaftN = 0;
  private readonly sheaths: THREE.InstancedMesh;
  private readonly flares: THREE.InstancedMesh;
  private cardN = 0;
  private flashN = 0;
  private readonly recs: Record<CouncilRole, MemberRec> = {
    guardian: newRec('guardian'),
    singer: newRec('singer'),
  };
  private readonly gLook = newGuardianDeathLook();
  private readonly sLook = newSingerDeathLook();
  private readonly endLook = newCouncilEndLook();
  private endT = -1;
  private endPrev = -1;
  /** Which carved columns stand (a fallen one has none to power down). */
  private readonly standing: boolean[] = QUARRY_PILLAR_SPOTS.map(() => true);
  private placedX = Number.NaN;
  private placedZ = Number.NaN;
  private rosterSeen = Number.NaN;
  private scanTimer = 0;
  private settleDebt = 0;
  private clock = 0;
  private seed = 0x6d17;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly ground: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly motionReduced: () => boolean = () => false,
    private readonly shakeSink?: (amount: number) => void,
    private readonly playGesture?: (entityId: number, gesture: string) => void,
  ) {
    this.root.name = 'smith-heart-council-death';
    setRenderCategory(this.root, 'ui3d');
    this.pit.name = 'smithHeartCouncilDeathPit';
    this.pit.visible = false;
    this.root.add(this.pit);
    const budget = entranceBudgetNow('council');
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
    this.stone = new CouncilDeathStone(this.root, this);
    this.crystal = new CouncilDeathCrystal(this.root, this);
    // ---- light cards: the bodies' light, the flashes (the entrance's) ----
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
    const cards = (name: string, depthTest: boolean, n: number) => {
      const mesh = new THREE.InstancedMesh(card, glowMat(name, depthTest), n);
      mesh.name = name;
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < n; i++) {
        mesh.setMatrixAt(i, _zero);
        mesh.setColorAt(i, _c.setRGB(0, 0, 0));
      }
      this.root.add(mesh);
      return mesh;
    };
    this.cards = cards('smithHeartCouncilDeathLight', true, CARDS);
    // Depth-tested: a burst on its body, never a wash over the floor's
    // marks round the member still fighting.
    this.flashes = cards('smithHeartCouncilDeathFlash', true, FLASHES);
    this.flashes.renderOrder = 10_000;
    // ---- the shafts of light: open cones, root narrow, mouth wide ----
    const coneGeo = new THREE.CylinderGeometry(1, 0.22, 1, 10, 1, true).translate(0, 0.5, 0);
    this.geometries.push(coneGeo);
    const leakMat = new THREE.ShaderMaterial({
      name: 'smithHeartCouncilDeathShaftMat',
      uniforms: { uTime: this.uTime },
      vertexShader: LEAK_VERT,
      fragmentShader: LEAK_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.materials.push(leakMat);
    this.shafts = new THREE.InstancedMesh(coneGeo, leakMat, SHAFTS);
    this.shafts.name = 'smithHeartCouncilDeathShafts';
    this.shafts.frustumCulled = false;
    this.shafts.visible = false;
    this.shafts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < SHAFTS; i++) {
      this.shafts.setMatrixAt(i, _zero);
      this.shafts.setColorAt(i, _c.setRGB(0, 0, 0));
    }
    this.root.add(this.shafts);
    // ---- the columns' runes (the entrance's sheath) and the room's crystals ----
    const sheathGeo = new THREE.CylinderGeometry(Math.SQRT2, Math.SQRT2, 1, 4, 1, true)
      .rotateY(Math.PI / 4)
      .translate(0, 0.5, 0);
    this.geometries.push(sheathGeo);
    const sheathMat = new THREE.ShaderMaterial({
      name: 'smithHeartCouncilDeathColumnsMat',
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
    this.sheaths.name = 'smithHeartCouncilDeathColumns';
    this.sheaths.frustumCulled = false;
    this.sheaths.visible = false;
    for (let i = 0; i < QUARRY_PILLAR_SPOTS.length; i++) {
      this.sheaths.setMatrixAt(i, _zero);
      this.sheaths.setColorAt(i, _c.setRGB(0, 0, 0));
    }
    this.pit.add(this.sheaths);
    this.flares = new THREE.InstancedMesh(
      card,
      glowMat(COUNCIL_DEATH_SECONDARY_LAYERS[0], true),
      QUARRY_CRYSTALS.length,
    );
    this.flares.name = COUNCIL_DEATH_SECONDARY_LAYERS[0];
    this.flares.frustumCulled = false;
    this.flares.visible = false;
    for (let i = 0; i < QUARRY_CRYSTALS.length; i++) {
      this.flares.setMatrixAt(i, _zero);
      this.flares.setColorAt(i, _c.setRGB(0, 0, 0));
    }
    this.pit.add(this.flares);
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  // ---- the parts' host -----------------------------------------------------------------------

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

  card(x: number, y: number, z: number, size: number, r: number, g: number, b: number): void {
    if (this.cardN >= CARDS) return;
    _m.compose(_p.set(x, y, z), _q.identity(), _s.setScalar(size));
    this.cards.setMatrixAt(this.cardN, _m);
    this.cards.setColorAt(this.cardN, _c.setRGB(r, g, b));
    this.cardN++;
  }

  shaft(
    x: number,
    y: number,
    z: number,
    yaw: number,
    pitch: number,
    len: number,
    width: number,
    level: number,
    seed: number,
  ): void {
    if (this.shaftN >= SHAFTS) return;
    _v.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    _q.setFromUnitVectors(_up, _v);
    _m.compose(_p.set(x, y, z), _q, _s.set(width, len, width));
    this.shafts.setMatrixAt(this.shaftN, _m);
    this.shafts.setColorAt(this.shaftN, _c.setRGB(level, seed, 0));
    this.shaftN++;
  }

  flash(x: number, y: number, z: number, size: number, r: number, g: number, b: number): void {
    // A flash is a burst: its light lives on as a card the next frames fade
    // (this.flashLife), under reduced motion smaller and dimmer.
    const i = this.flashN++ % FLASHES;
    const calm = this.motionReduced();
    const k = calm ? 0.55 : 1;
    this.flashAt[i * 8] = x;
    this.flashAt[i * 8 + 1] = y;
    this.flashAt[i * 8 + 2] = z;
    this.flashAt[i * 8 + 3] = size * (calm ? 0.7 : 1);
    this.flashAt[i * 8 + 4] = r * k;
    this.flashAt[i * 8 + 5] = g * k;
    this.flashAt[i * 8 + 6] = b * k;
    this.flashAt[i * 8 + 7] = this.clock;
  }
  /** Each flash slot: x, y, z, size, r, g, b, born. */
  private readonly flashAt = new Float32Array(FLASHES * 8).fill(-99);

  thud(amount: number, reach: number, x: number, z: number): void {
    const me = this.world?.entities.get(this.world.playerId);
    if (!this.shakeSink || !me) return;
    const k = councilDeathShake(
      amount,
      reach,
      Math.hypot(me.pos.x - x, me.pos.z - z),
      this.motionReduced(),
    );
    if (k > 0) this.shakeSink(k);
  }

  // ---- the events ----------------------------------------------------------------------------

  /** Claims only the dev replay cue (a presentation trigger with no draw of
   *  its own); the fight's cues are never claimed. */
  handleEvent(ev: SimEvent): boolean {
    if (!this.world || this.disposed) return false;
    if (ev.type !== 'spellfx' || ev.ability !== COUNCIL_DEV_CUES.deathReplay) return false;
    const e = this.world.entities.get(ev.sourceId);
    const role =
      e?.templateId === COUNCIL_TEMPLATES.guardian
        ? 'guardian'
        : e?.templateId === COUNCIL_TEMPLATES.singer
          ? 'singer'
          : null;
    if (!e || !role || e.dead) return true;
    const rec = this.recs[role];
    if (rec.id !== e.id) this.take(role, e.id);
    // Both replayed at once: the Singer follows, so the end beat is hers.
    const g = this.recs.guardian;
    const stagger =
      role === 'singer' && g.replayAt >= 0 && Math.abs(this.clock - g.replayAt) < 0.25
        ? COUNCIL_REPLAY_STAGGER
        : 0;
    rec.replayAt = this.clock + stagger;
    rec.fell = false;
    if (role === 'guardian') this.stone.reset();
    else this.crystal.reset();
    return true;
  }

  // ---- the frame -----------------------------------------------------------------------------

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
    this.cardN = 0;
    this.shaftN = 0;
    const g = this.step(world, 'guardian', dt);
    const s = this.step(world, 'singer', dt);
    this.particles.update(this.clock);
    // The Guardian.
    const gr = this.recs.guardian;
    if (g && gr.t >= 0) {
      const replay = !gr.deadKnown;
      const look = guardianDeathLook(gr.t, replay, this.gLook);
      // A replay sinks its rubble as it ends; a corpse keeps it.
      // While the Singer still fights, the slabs sink into the floor once the
      // scene is over, so no rubble covers a mark on the floor under them.
      const left = replay
        ? councilReplaySeconds('guardian') - gr.t
        : s && !s.dead
          ? GUARDIAN_DEATH.end - gr.t
          : 1;
      const sink = Math.max(0, Math.min(1, left / 0.8));
      this.stone.paint(look, gr.body, gr.t, gr.prev, dt, sink);
      this.sounds(GUARDIAN_DEATH_SOUNDS, gr, gr.t, gr.prev);
    } else this.stone.hide();
    // The Singer.
    const sr = this.recs.singer;
    if (s && sr.t >= 0) {
      const look = singerDeathLook(sr.t, !sr.deadKnown, this.sLook);
      this.crystal.paint(look, sr.body, sr.t, sr.prev, dt);
      this.sounds(SINGER_DEATH_SOUNDS, sr, sr.t, sr.prev);
    } else this.crystal.hide();
    // The end, once both have fallen.
    this.endPrev = this.endT;
    this.endT = councilEndTime(gr.t, sr.t);
    this.paintEnd(dt, g ?? s);
    this.paintCards();
    gr.prev = gr.t;
    sr.prev = sr.t;
  }

  /** One member this frame: its death's clock off IWorld (or a replay), its
   *  points, its gestures. The body (null when out of view). */
  private step(world: IWorld, role: CouncilRole, dt: number): Entity | null {
    const rec = this.recs[role];
    const e = rec.id >= 0 ? (world.entities.get(rec.id) ?? null) : null;
    // Out of view and not dying: a death that happens unseen is a husk when
    // it comes back, never a scene replayed late.
    if (!e && !rec.deadKnown) rec.seenAlive = false;
    if (e) {
      if (e.dead) {
        if (!rec.deadKnown) {
          rec.deadKnown = true;
          rec.deadAt = rec.seenAlive ? this.clock : this.clock - COUNCIL_DEATH_END[role] - 30;
          rec.replayAt = -1;
          if (role === 'guardian') this.stone.reset();
          else this.crystal.reset();
        }
      } else {
        if (rec.deadKnown) {
          // Stood up again (a wipe): whole at once, the rubble gone.
          rec.deadKnown = false;
          if (role === 'guardian') this.stone.hide();
          else this.crystal.hide();
        }
        rec.seenAlive = true;
      }
    }
    const t = councilDeathTime(role, this.clock, rec.deadAt, rec.replayAt, rec.deadKnown);
    // A replay over: the body stands, the clock is spent.
    if (!rec.deadKnown && rec.replayAt >= 0 && t < 0 && this.clock >= rec.replayAt) {
      rec.replayAt = -1;
      if (rec.fell && e && !e.dead) this.send(e.id, this.stand(role));
      rec.fell = false;
    }
    rec.t = t;
    if (!e) return null;
    // The bones are read only while its scene runs (never through the fight).
    if (rec.t >= 0) this.readBody(role, e, rec.body);
    this.gestures(role, rec, e, dt);
    return e;
  }

  /** The body's feet, facing and points (its sockets, or the plan's). */
  private readBody(role: CouncilRole, e: Entity, out: CouncilDeathBody): void {
    const at = fxAnchor(e);
    out.x = at.x;
    out.y = at.y;
    out.z = at.z;
    out.facing = e.facing;
    const set = councilBodySockets(role);
    const pts = COUNCIL_DEATH_POINTS[role];
    const sin = Math.sin(e.facing);
    const cos = Math.cos(e.facing);
    for (let i = 0; i < pts.length; i++) {
      const sock = set?.points[i];
      if (sock) {
        sock.getWorldPosition(_v);
        out.pts[i * 3] = _v.x;
        out.pts[i * 3 + 1] = _v.y;
        out.pts[i * 3 + 2] = _v.z;
        continue;
      }
      councilPointFallback(role, i, _fb);
      // forward (sin f, cos f); the body's left (cos f, -sin f).
      out.pts[i * 3] = at.x + sin * _fb.fwd + cos * _fb.side;
      out.pts[i * 3 + 1] = at.y + _fb.y;
      out.pts[i * 3 + 2] = at.z + cos * _fb.fwd - sin * _fb.side;
    }
  }

  /** The husk's shade re-sent while it holds; a replay's fall once. */
  private gestures(role: CouncilRole, rec: MemberRec, e: Entity, dt: number): void {
    if (rec.t < 0) {
      rec.huskIn = 0;
      return;
    }
    if (!rec.deadKnown && !rec.fell && rec.t >= 0) {
      rec.fell = true;
      this.send(
        e.id,
        role === 'guardian'
          ? COUNCIL_DEATH_GESTURES.guardianFall
          : COUNCIL_DEATH_GESTURES.singerFall,
      );
    }
    const husk =
      role === 'guardian'
        ? guardianDeathLook(rec.t, !rec.deadKnown, this.gLook).husk
        : singerDeathLook(rec.t, !rec.deadKnown, this.sLook).husk;
    if (!husk) {
      rec.huskIn = 0;
      return;
    }
    rec.huskIn -= dt;
    if (rec.huskIn <= 0) {
      rec.huskIn = COUNCIL_HUSK_EVERY;
      this.send(
        e.id,
        role === 'guardian'
          ? COUNCIL_DEATH_GESTURES.guardianHusk
          : COUNCIL_DEATH_GESTURES.singerHusk,
      );
    }
  }

  private stand(role: CouncilRole): string {
    return role === 'guardian'
      ? COUNCIL_ENTRANCE_GESTURES.guardianStand
      : COUNCIL_ENTRANCE_GESTURES.singerStand;
  }

  private send(id: number, gesture: string): void {
    this.playGesture?.(id, gesture);
  }

  // ---- the scan --------------------------------------------------------------------------------

  private scan(world: IWorld): void {
    retryCouncilBodySockets();
    const me = world.entities.get(world.playerId);
    if (!me || !inSmithHeartClaim(me.pos.x, me.pos.z)) {
      if (this.recs.guardian.id >= 0 || this.recs.singer.id >= 0) this.release();
      return;
    }
    this.place(me);
    // The columns matter only once someone has fallen (or a replay plays).
    if (this.recs.guardian.t >= 0 || this.recs.singer.t >= 0) this.readColumns(world);
    if (world.entityRosterVersion === this.rosterSeen) return;
    this.rosterSeen = world.entityRosterVersion;
    for (const e of world.entities.values()) {
      if (e.kind !== 'mob') continue;
      const role =
        e.templateId === COUNCIL_TEMPLATES.guardian
          ? 'guardian'
          : e.templateId === COUNCIL_TEMPLATES.singer
            ? 'singer'
            : null;
      if (role && this.recs[role].id !== e.id) this.take(role, e.id);
    }
  }

  /** Track a member's body (a new run's: its record starts afresh). */
  private take(role: CouncilRole, id: number): void {
    const rec = this.recs[role];
    rec.id = id;
    rec.deadKnown = false;
    rec.deadAt = 0;
    rec.seenAlive = false;
    rec.replayAt = -1;
    rec.t = -1;
    rec.prev = -1;
    rec.fell = false;
    rec.huskIn = 0;
  }

  private release(): void {
    for (const role of ROLES) this.take(role, -1);
    this.rosterSeen = Number.NaN;
    this.placedX = Number.NaN;
    this.placedZ = Number.NaN;
    this.endT = -1;
    this.endPrev = -1;
    this.stone.hide();
    this.crystal.hide();
    this.pit.visible = false;
    this.cards.visible = false;
    this.flashes.visible = false;
    this.shafts.visible = false;
    this.particles.hideRings();
  }

  /** The pit's stage on the claim's quarry; the columns' sheaths laid once
   *  per claim. */
  private place(me: Entity): void {
    const def = DUNGEONS.smith_heart;
    if (!def) return;
    const o = instanceOrigin(def.index, instanceSlotForZ(me.pos.z));
    if (o.x === this.placedX && o.z === this.placedZ) return;
    this.placedX = o.x;
    this.placedZ = o.z;
    const px = o.x + HAMMER_PIT.x;
    const pz = o.z + HAMMER_PIT.z;
    const py = this.ground(px, pz);
    this.pit.position.set(px, py, pz);
    this.pit.updateMatrixWorld();
    for (let i = 0; i < QUARRY_PILLAR_SPOTS.length; i++) {
      const c = QUARRY_PILLAR_SPOTS[i];
      _p.set(
        c.x - HAMMER_PIT.x,
        this.ground(o.x + c.x, o.z + c.z) - py + COLUMN_SHEATH.foot,
        c.z - HAMMER_PIT.z,
      );
      _q.setFromAxisAngle(_up, c.rot);
      _s.set(COLUMN_SHEATH.half, COLUMN_SHEATH.height, COLUMN_SHEATH.half);
      _m.compose(_p, _q, _s);
      this.sheaths.setMatrixAt(i, _m);
    }
    this.sheaths.instanceMatrix.needsUpdate = true;
  }

  /** Which columns stand now (a carved column's object near its socket). */
  private readColumns(world: IWorld): void {
    if (!Number.isFinite(this.placedX)) return;
    this.standing.fill(false);
    for (const e of world.entities.values()) {
      if (e.kind !== 'object' || !councilPillarOf(e.templateId)) continue;
      for (let i = 0; i < QUARRY_PILLAR_SPOTS.length; i++) {
        const c = QUARRY_PILLAR_SPOTS[i];
        if (Math.hypot(e.pos.x - this.placedX - c.x, e.pos.z - this.placedZ - c.z) < 4)
          this.standing[i] = true;
      }
    }
  }

  // ---- the end -------------------------------------------------------------------------------

  private paintEnd(dt: number, near: Entity | null): void {
    const t = this.endT;
    const L = councilEndLook(t, this.endLook);
    if (!L.active || !Number.isFinite(this.placedX)) {
      if (this.pit.visible) this.pit.visible = false;
      return;
    }
    this.pit.visible = true;
    const reduced = this.motionReduced();
    let any = false;
    for (let i = 0; i < QUARRY_PILLAR_SPOTS.length; i++) {
      const on = this.standing[i];
      const glow = on ? councilDeathLight(L.glow[i], reduced) : 0;
      this.sheaths.setColorAt(i, _c.setRGB(L.climb[i], glow * 2.2, 0));
      if (glow > 0.001) {
        any = true;
        // The light's front sinking down the column, a glow at its crown
        // while it is lit to the top.
        const c = QUARRY_PILLAR_SPOTS[i];
        const cx = this.placedX + c.x;
        const cz = this.placedZ + c.z;
        const base = this.ground(cx, cz) + COLUMN_SHEATH.foot;
        const fy = base + COLUMN_SHEATH.height * L.climb[i];
        this.card(cx, fy, cz, 5.5, 1.1 * glow, 0.62 * glow, 0.2 * glow);
      }
      if (on && councilDeathCrossed(this.endPrev, t, columnDownAt(i))) this.columnOut(i);
    }
    this.sheaths.visible = any;
    if (any && this.sheaths.instanceColor) this.sheaths.instanceColor.needsUpdate = true;
    // The room's crystals settling dark with the columns (a cosmetic double
    // over the columns' own light: the low tier keeps the columns only).
    let anyFlare = false;
    const f = councilDeathLight(L.crystals, reduced);
    for (let i = 0; this.secondary && i < QUARRY_CRYSTALS.length; i++) {
      const k = QUARRY_CRYSTALS[i];
      if (f <= 0.01) {
        this.flares.setMatrixAt(i, _zero);
        continue;
      }
      anyFlare = true;
      _p.set(
        k.x - HAMMER_PIT.x,
        this.ground(this.placedX + k.x, this.placedZ + k.z) - this.pit.position.y + k.lift,
        k.z - HAMMER_PIT.z,
      );
      _m.compose(_p, _q.identity(), _s.setScalar(k.size * (0.7 + 0.4 * f)));
      this.flares.setMatrixAt(i, _m);
      this.flares.setColorAt(i, _c.setRGB(0.9 * f, 0.58 * f, 0.26 * f));
    }
    this.flares.visible = anyFlare;
    if (anyFlare) {
      this.flares.instanceMatrix.needsUpdate = true;
      if (this.flares.instanceColor) this.flares.instanceColor.needsUpdate = true;
    }
    // The surge's thud, the last dust settling over the quarry.
    if (councilDeathCrossed(this.endPrev, t, 0.02) && near)
      this.thud(
        COUNCIL_DEATH_SHAKES.surge.amount,
        COUNCIL_DEATH_SHAKES.surge.reach,
        near.pos.x,
        near.pos.z,
      );
    if (L.settle > 0.01) {
      this.settleDebt += dt * COUNCIL_DEATH_RATES.settleDust * this.density * L.settle;
      if (this.settleDebt > 6) this.settleDebt = 6;
      while (this.settleDebt >= 1) {
        this.settleDebt -= 1;
        const a = this.rand() * Math.PI * 2;
        const r = Math.sqrt(this.rand()) * 30;
        const x = this.pit.position.x + Math.sin(a) * r;
        const z = this.pit.position.z + Math.cos(a) * r;
        SETTLE.floor = this.ground(x, z) + 0.1;
        this.particles.puff(x, this.pit.position.y + 9 + this.rand() * 8, z, 1, SETTLE);
      }
    }
    // The end's sounds (at the quarry's middle).
    if (this.endPrev >= 0 && t > this.endPrev) {
      for (const snd of COUNCIL_END_SOUNDS) {
        if (!councilDeathCrossed(this.endPrev, t, snd.at)) continue;
        sfx.playAt(snd.key, this.pit.position.x, this.pit.position.y + 2, this.pit.position.z, {
          gain: snd.gain,
          rate: snd.rate,
          cooldown: 0.05,
          jitter: false,
          priority: true,
        });
      }
    }
  }

  /** A column goes dark: its light falling off it in motes, a breath of dust
   *  at its foot. */
  private columnOut(i: number): void {
    const c = QUARRY_PILLAR_SPOTS[i];
    const x = this.placedX + c.x;
    const z = this.placedZ + c.z;
    const y = this.ground(x, z);
    this.particles.puff(
      x,
      y + COLUMN_SHEATH.foot + COLUMN_SHEATH.height * 0.9,
      z,
      16,
      FALLING_MOTE,
    );
    this.particles.puff(x, y + 0.4, z, 10, COLUMN_DUST);
    this.particles.shockRing(x, z, 0xffa040, 6, 0.9, { wake: 0.3, crest: 0.15, strength: 0.6 });
  }

  // ---- the light cards -----------------------------------------------------------------------

  private paintCards(): void {
    for (let i = this.shaftN; i < SHAFTS; i++) this.shafts.setMatrixAt(i, _zero);
    if (this.shaftN > 0 || this.shafts.visible) {
      this.shafts.instanceMatrix.needsUpdate = true;
      if (this.shafts.instanceColor) this.shafts.instanceColor.needsUpdate = true;
    }
    this.shafts.visible = this.shaftN > 0;
    for (let i = this.cardN; i < CARDS; i++) this.cards.setMatrixAt(i, _zero);
    this.cards.visible = this.cardN > 0;
    if (this.cardN > 0 || this.cards.visible) {
      this.cards.instanceMatrix.needsUpdate = true;
      if (this.cards.instanceColor) this.cards.instanceColor.needsUpdate = true;
    }
    // The flashes: a burst that fades over half a second.
    let anyFlash = false;
    for (let i = 0; i < FLASHES; i++) {
      const o = i * 8;
      const age = this.clock - this.flashAt[o + 7];
      if (age < 0 || age > 0.55) {
        this.flashes.setMatrixAt(i, _zero);
        continue;
      }
      anyFlash = true;
      const k = Math.min(1, age / 0.04) * (1 - age / 0.55) ** 2;
      _m.compose(
        _p.set(this.flashAt[o], this.flashAt[o + 1], this.flashAt[o + 2]),
        _q.identity(),
        _s.setScalar(this.flashAt[o + 3] * (0.75 + 0.25 * k)),
      );
      this.flashes.setMatrixAt(i, _m);
      this.flashes.setColorAt(
        i,
        _c.setRGB(this.flashAt[o + 4] * k, this.flashAt[o + 5] * k, this.flashAt[o + 6] * k),
      );
    }
    this.flashes.visible = anyFlash;
    if (anyFlash) {
      this.flashes.instanceMatrix.needsUpdate = true;
      if (this.flashes.instanceColor) this.flashes.instanceColor.needsUpdate = true;
    }
  }

  /** A scene's sounds on their beats (only for a scene seen crossing them). */
  private sounds(
    list: readonly CouncilDeathSound[],
    rec: MemberRec,
    t: number,
    prev: number,
  ): void {
    if (prev < 0 || t <= prev) return;
    const b = rec.body;
    for (const snd of list) {
      if (!councilDeathCrossed(prev, t, snd.at)) continue;
      sfx.playAt(snd.key, b.x, b.y + 4, b.z, {
        gain: snd.gain,
        rate: snd.rate,
        cooldown: 0.05,
        jitter: false,
        priority: true,
      });
    }
  }

  /** The scene's clock for `role` (tests read it). */
  sceneTime(role: CouncilRole): number {
    return this.recs[role].t;
  }

  /** The end beat's clock (tests read it). */
  get endTime(): number {
    return this.endT;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
    this.root.removeFromParent();
    this.particles.dispose();
    // An instanced mesh frees its instance buffers only on its own dispose.
    for (const mesh of [this.cards, this.flashes, this.shafts, this.sheaths, this.flares])
      mesh.dispose();
    this.stone.dispose();
    this.crystal.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    clearCouncilBodySockets();
  }
}

/** The end beat's length (tests read it). */
export const COUNCIL_DEATH_END_SECONDS = COUNCIL_END_SECONDS;
/** The Guardian's split (tests read it). */
export const COUNCIL_DEATH_SPLIT = GUARDIAN_DEATH.splitAt;
/** The order the columns go out (tests read it). */
export const COUNCIL_DEATH_COLUMN_ORDER = COLUMN_DOWN_ORDER;

// ---- particles' options (written in place) -----------------------------------------------------

const SETTLE = {
  speed: 0.3,
  up: -1.4,
  life: 3,
  size: [0.6, 1.8] as [number, number],
  color: [0.62, 0.52, 0.4] as [number, number, number],
  alpha: 0.28,
  drag: 0.3,
  floor: 0,
};
const FALLING_MOTE = {
  speed: 0.6,
  up: -2.2,
  life: 1.6,
  size: [0.35, 0.06] as [number, number],
  color: [1.0, 0.7, 0.34] as [number, number, number],
  alpha: 1,
  pool: 'glow' as const,
  radius: 1.8,
  drag: 0.3,
  gravity: 3,
};
const COLUMN_DUST = {
  speed: 3,
  up: 0.6,
  life: 1.6,
  size: [1.2, 3.4] as [number, number],
  color: [0.55, 0.46, 0.36] as [number, number, number],
  alpha: 0.35,
  drag: 1.4,
  radius: 2.4,
};
