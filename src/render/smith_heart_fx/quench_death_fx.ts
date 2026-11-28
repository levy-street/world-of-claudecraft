// The Guardian of the Quench's death, "Frozen from within" (plan:
// quench_death_core.ts), hosted by ../rift_death_zone.ts and updated after
// her entrance and before QuenchBody (it holds its look through
// quench_death_state.ts, so her statue glaze, her heart and her mist ride its
// clock). It reads her death off IWorld (offline and online alike), runs the
// scene's clock (a death seen live plays it; a corpse first seen dead is the
// husk in the calm; a dev replay cue, `/dev heart quench death`, plays it on
// her living body and stands her back up) and draws:
//  - the freeze: frost racing out over her from her heart (glittering
//    streaks heart to limb), her heart's light blooming;
//  - the blades: her floating swords of ice (the entrance's crystal program)
//    falling one by one and spearing into the lake, each with a star of
//    cracks and a spray of ice;
//  - the crack: a lattice of glowing seams running over her from her heart
//    out (the Breath entrance's bolt strips, cold light), held a beat;
//  - the shatter: shards of the statue's shell bursting out, tumbling onto
//    the ice and melting away, frost mist, a burst of cold light, a ring;
//  - the calm: the web of cracks over the lake (the entrance's web) healing
//    from its tips back to her, the blades sinking away, the ice settling
//    into a still mirror-calm sheet, snow drifting down.
// No camera is taken, no control, nothing held back from loot or exit: her
// body stays where it fell, a husk of clear ice.
//
// Rules (src/render/CLAUDE.md): every geometry and material is built in the
// constructor under one root attached through attachSceneGroupGated; fixed
// pools, no light, no per-frame allocation. The particle pools build WORLD
// points and hang off the root at the origin; everything else hangs off the
// stage on her feet (unrotated). The low tier thins the particles and the
// shards and sheds the mirror sheet's glint double
// (`QUENCH_DEATH_SECONDARY_LAYERS`); every beat plays on every tier; reduced
// motion takes the thuds, steadies the seams and calms the light.

import * as THREE from 'three';
import { sfx } from '../../game/sfx';
import { QUENCH_DEV_CUES } from '../../sim/encounters/smith_heart/quench_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { fxAnchor } from '../attached_fx_anchor';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { attachSceneGroupGated } from '../gated_scene_attach';
import type { SanctumPuffOptions } from '../gravewyrm_sanctum_fx/sanctum_fx_core';
import { setRenderCategory } from '../renderer_diagnostics';
import { EngineParticles } from '../trash_engine_fx/engine_particles';
import { BreathEntranceBolts } from './breath_entrance_bolts';
import { GLOW_FRAG, GLOW_VERT } from './council_entrance_glsl';
import { inSmithHeartClaim } from './council_fx_core';
import { entranceBudgetNow } from './entrance_budget';
import { QUENCH_DEATH_SECONDARY_LAYERS } from './entrance_budget_core';
import { moltenDecal } from './heat_molten_decal';
import {
  QUENCH_BODY_GESTURES,
  QUENCH_GUARDIAN,
  QUENCH_SOCKETS,
  QUENCH_YD_PER_UNIT,
  quenchSocketIndex,
} from './quench_body_core';
import { quenchBodySockets } from './quench_body_sockets';
import {
  newQuenchDeathBodyLook,
  QUENCH_DEATH,
  QUENCH_DEATH_BLADES,
  QUENCH_DEATH_GESTURES,
  QUENCH_DEATH_HEART,
  QUENCH_DEATH_RATES,
  QUENCH_DEATH_SHAKES,
  QUENCH_DEATH_SOUNDS,
  QUENCH_FROST_TARGETS,
  QUENCH_SEAMS,
  QUENCH_SHARDS,
  quenchBladeAt,
  quenchDeathBodyLook,
  quenchDeathCrossed,
  quenchDeathKept,
  quenchDeathLake,
  quenchDeathLight,
  quenchDeathShake,
  quenchDeathTime,
  quenchFrostReach,
  quenchSeamAt,
  quenchSeamLevel,
  quenchShardAt,
} from './quench_death_core';
import { MIRROR_FRAG, MIRROR_VERT } from './quench_death_glsl';
import { holdQuenchDeath } from './quench_death_state';
import { ENTRANCE_WEB, QUENCH_ENTRANCE_BLADES, WEB_VERTICES } from './quench_entrance_core';
import {
  BLADE_FRAG,
  BLADE_VERT,
  bladeGeometry,
  layWebStrips,
  STAR_FRAG,
  STAR_VERT,
  STRIP_VERT,
  WEB_FRAG,
  webGeometry,
} from './quench_ice_kit';

const SCAN_SEC = 0.25;
const CARDS = 16;
const U = QUENCH_YD_PER_UNIT;
const BL = QUENCH_ENTRANCE_BLADES.length;
const NB = QUENCH_DEATH_BLADES.length;
/** The calm sheet's radius (yards). */
const MIRROR_R = 34;
const SEAM_IDS: readonly [number, number][] = QUENCH_SEAMS.map(([a, b]) => [
  quenchSocketIndex(a),
  quenchSocketIndex(b),
]);

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _c = new THREE.Color();
const _axis = new THREE.Vector3();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _blade = { y: 0, tilt: 0, wobble: 0, struck: false, since: 0, sink: 0 };
const _shard = { out: 0, y: 0, turn: 0, landed: false, scale: 0 };
const _lake = { grow: 0, glow: 0, calm: 0, snow: 0, flash: 0 };

const FROST: readonly [number, number, number] = [0.72, 0.93, 1];
const MIST: readonly [number, number, number] = [0.58, 0.78, 1];
const SNOW: readonly [number, number, number] = [0.95, 0.98, 1];
const GLINT: readonly [number, number, number] = [0.7, 0.92, 1];

export class QuenchDeathFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  /** Laid on her feet, unrotated (the blades, the web, the sheet, the
   *  shards, the seams, the cards). */
  private readonly stage = new THREE.Group();
  readonly uTime = { value: 0 };
  private readonly density: number;
  private readonly secondary: boolean;
  private readonly particles: EngineParticles;
  readonly geometries: THREE.BufferGeometry[] = [];
  readonly materials: THREE.Material[] = [];
  private readonly seams: BreathEntranceBolts;
  private readonly blades: THREE.InstancedMesh;
  private readonly stars: THREE.InstancedMesh;
  private readonly shards: THREE.InstancedMesh;
  private readonly shardPicks: number[] = [];
  private readonly shardBirth: Float32Array;
  private shardsBorn = false;
  private readonly webGeo: THREE.BufferGeometry;
  private readonly web: THREE.Mesh;
  private readonly webMat: THREE.ShaderMaterial;
  private readonly mirror: THREE.Mesh;
  private readonly mirrorMat: THREE.ShaderMaterial;
  private readonly sheen: THREE.Mesh;
  private readonly sheenMat: THREE.ShaderMaterial;
  private readonly cards: THREE.InstancedMesh;
  private readonly flash: THREE.InstancedMesh;
  private readonly look = newQuenchDeathBodyLook();
  private holding = false;
  private rested = false;
  private cardN = 0;
  private readonly sock: THREE.Vector3[] = QUENCH_SOCKETS.map(() => new THREE.Vector3());
  /** The stage was laid for this scene (the web on the lake where she fell). */
  private laid = false;
  /** Her facing when the stage was laid (the blades' bearings are off it). */
  private yaw = 0;
  private entityId = -1;
  private deadKnown = false;
  private deadAt = 0;
  private seenAlive = false;
  private replayAt = -1;
  private fell = false;
  private t = -1;
  private prev = -1;
  private rosterSeen = Number.NaN;
  private scanTimer = 0;
  private clock = 0;
  private seed = 0x9e1c;
  private frostDebt = 0;
  private snowDebt = 0;
  private mistDebt = 0;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    private readonly shakeSink?: (amount: number) => void,
    private readonly playGesture?: (entityId: number, gesture: string) => void,
  ) {
    this.root.name = 'smith-heart-quench-death';
    setRenderCategory(this.root, 'ui3d');
    this.stage.name = 'smithHeartQuenchDeathStage';
    this.stage.visible = false;
    this.root.add(this.stage);
    const budget = entranceBudgetNow('quench');
    this.secondary = budget.secondary;
    this.density = budget.share;
    // The pools draw world points and ignore a parent: on the root.
    this.particles = new EngineParticles(
      this.root,
      this.uTime,
      this.density,
      (x, z) => this.groundY(x, z),
      () => this.rand(),
      () => this.reducedMotion(),
      null,
    );
    // ---- the lattice of seams over her: cold light strips ----
    this.seams = new BreathEntranceBolts(this.stage, this);
    // ---- the blades: the entrance's swords of lake ice ----
    const bladeGeo = bladeGeometry();
    this.geometries.push(bladeGeo);
    const bladeMat = new THREE.ShaderMaterial({
      name: 'smithHeartQuenchDeathBlades',
      uniforms: { uTime: this.uTime },
      vertexShader: BLADE_VERT,
      fragmentShader: BLADE_FRAG,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.materials.push(bladeMat);
    this.blades = this.instanced(bladeGeo, bladeMat, NB, 'smithHeartQuenchDeathBlades');
    // ---- the shards of the statue's shell (the blades' crystal program) ----
    const shardGeo = new THREE.OctahedronGeometry(1, 0).toNonIndexed();
    shardGeo.scale(0.5, 1, 0.32);
    shardGeo.computeVertexNormals();
    {
      const n = shardGeo.getAttribute('position').count;
      const hh = new Float32Array(n).fill(0.5);
      const cc = new Float32Array(n);
      for (let v = 0; v < n; v++) cc[v] = v % 3 === 0 ? 0 : 1;
      shardGeo.setAttribute('aH', new THREE.BufferAttribute(hh, 1));
      shardGeo.setAttribute('aCore', new THREE.BufferAttribute(cc, 1));
    }
    this.geometries.push(shardGeo);
    for (let i = 0; i < QUENCH_SHARDS.length; i++)
      if (quenchDeathKept(i, this.density)) this.shardPicks.push(i);
    this.shards = this.instanced(
      shardGeo,
      bladeMat,
      this.shardPicks.length,
      'smithHeartQuenchDeathShards',
    );
    // Every shard's light, once (the crystal program reads it).
    for (let j = 0; j < this.shardPicks.length; j++) this.shards.setColorAt(j, _c.setRGB(1, 1, 1));
    this.shardBirth = new Float32Array(QUENCH_SHARDS.length * 3);
    // ---- the stars of cracks where the blades strike ----
    const starGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.geometries.push(starGeo);
    const starMat = new THREE.ShaderMaterial({
      name: 'smithHeartQuenchDeathBladeCracks',
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.materials.push(starMat);
    this.stars = this.instanced(starGeo, starMat, NB, 'smithHeartQuenchDeathBladeCracks');
    this.stars.renderOrder = floorVfxRenderOrder('encounter', 12);
    // ---- the web of cracks over the lake (the entrance's own) ----
    this.webGeo = webGeometry(ENTRANCE_WEB, WEB_VERTICES);
    this.geometries.push(this.webGeo);
    const web = moltenDecal(
      {
        name: 'smithHeartQuenchDeathWeb',
        geometry: this.webGeo,
        vertexShader: STRIP_VERT,
        fragmentShader: WEB_FRAG,
        uniforms: { uGrow: { value: 0 }, uGlow: { value: 0 }, uTime: this.uTime },
        charStep: 3,
        glowStep: 10,
      },
      this.materials,
    );
    this.web = web.mesh;
    this.webMat = web.mat;
    this.stage.add(this.web);
    // ---- the mirror-calm sheet, and its glint double ----
    const disc = new THREE.CircleGeometry(MIRROR_R, 96).rotateX(-Math.PI / 2);
    this.geometries.push(disc);
    const mirrorMat = (name: string, blending: THREE.Blending) => {
      const m = new THREE.ShaderMaterial({
        name,
        uniforms: {
          uAlpha: { value: 0 },
          uRadius: { value: MIRROR_R },
          uTime: this.uTime,
        },
        vertexShader: MIRROR_VERT,
        fragmentShader: MIRROR_FRAG,
        transparent: true,
        depthWrite: false,
        blending,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      this.materials.push(m);
      return m;
    };
    this.mirrorMat = mirrorMat('smithHeartQuenchDeathMirrorMat', THREE.NormalBlending);
    this.mirror = new THREE.Mesh(disc, this.mirrorMat);
    this.mirror.name = 'smithHeartQuenchDeathMirror';
    this.sheenMat = mirrorMat(`${QUENCH_DEATH_SECONDARY_LAYERS[0]}Mat`, THREE.AdditiveBlending);
    this.sheen = new THREE.Mesh(disc, this.sheenMat);
    this.sheen.name = QUENCH_DEATH_SECONDARY_LAYERS[0];
    for (const m of [this.mirror, this.sheen]) {
      m.frustumCulled = false;
      m.visible = false;
      m.renderOrder = floorVfxRenderOrder('encounter', 1);
      this.stage.add(m);
    }
    // ---- light cards and the shatter's flash ----
    const card = new THREE.PlaneGeometry(1, 1);
    this.geometries.push(card);
    const cardMat = new THREE.ShaderMaterial({
      name: 'smithHeartQuenchDeathLightMat',
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.materials.push(cardMat);
    this.cards = this.instanced(card, cardMat, CARDS, 'smithHeartQuenchDeathLight');
    // The shatter's burst draws over her body (a bounded card on her heart).
    const flashMat = cardMat.clone();
    flashMat.name = 'smithHeartQuenchDeathFlashMat';
    flashMat.depthTest = false;
    this.materials.push(flashMat);
    this.flash = this.instanced(card, flashMat, 1, 'smithHeartQuenchDeathFlash');
    this.flash.renderOrder = 10_000;
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  private instanced(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    n: number,
    name: string,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < n; i++) {
      mesh.setMatrixAt(i, _zero);
      mesh.setColorAt(i, _c.setRGB(0, 0, 0));
    }
    if (mesh.instanceColor) mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.stage.add(mesh);
    return mesh;
  }

  rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  /** The scene's clock (tests read it). */
  get sceneTime(): number {
    return this.t;
  }

  // ---- the events ----------------------------------------------------------------------------

  /** Claims only the dev replay cue (a presentation trigger with no draw of
   *  its own); the fight's cues are never claimed. */
  handleEvent(ev: SimEvent): boolean {
    if (!this.world || this.disposed) return false;
    if (ev.type !== 'spellfx' || ev.ability !== QUENCH_DEV_CUES.deathReplay) return false;
    const e = this.world.entities.get(ev.sourceId);
    if (!e || e.templateId !== QUENCH_GUARDIAN || e.dead) return true;
    if (this.entityId !== e.id) this.take(e.id);
    this.replayAt = this.clock;
    this.fell = false;
    this.laid = false;
    this.shardsBorn = false;
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
    const e = this.entityId >= 0 ? (world.entities.get(this.entityId) ?? null) : null;
    // Out of view and not dying: a death that happens unseen is the husk in
    // the calm when it comes back, never a scene played late.
    if (!e && !this.deadKnown) this.seenAlive = false;
    if (e) {
      if (e.dead) {
        if (!this.deadKnown) {
          this.deadKnown = true;
          this.deadAt = this.seenAlive ? this.clock : this.clock - QUENCH_DEATH.end - 30;
          this.replayAt = -1;
          this.laid = false;
          this.shardsBorn = false;
        }
      } else {
        if (this.deadKnown) {
          // Up again (a wipe): whole at once.
          this.deadKnown = false;
          this.laid = false;
        }
        this.seenAlive = true;
      }
    }
    this.prev = this.t;
    this.t = quenchDeathTime(this.clock, this.deadAt, this.replayAt, this.deadKnown);
    // A replay over (its span spent): she stands.
    if (!this.deadKnown && this.replayAt >= 0 && this.t < 0 && this.clock >= this.replayAt) {
      this.replayAt = -1;
      if (this.fell && e && !e.dead) this.playGesture?.(e.id, QUENCH_BODY_GESTURES.stand);
      this.fell = false;
    }
    this.particles.update(this.clock);
    this.cardN = 0;
    this.seams.begin();
    if (!e || this.t < 0) {
      this.letGo(e);
      this.seams.end();
      this.paintCards();
      return;
    }
    // A husk long past its scene keeps its look held: nothing to draw.
    const rest = this.deadKnown && this.t > QUENCH_DEATH.end + 1;
    if (rest && this.rested) {
      holdQuenchDeath(e.id, this.look);
      this.holding = true;
      this.seams.end();
      return;
    }
    this.rested = rest;
    quenchDeathBodyLook(this.t, this.look);
    holdQuenchDeath(e.id, this.look);
    this.holding = true;
    if (!this.deadKnown && !this.fell) {
      this.fell = true;
      this.playGesture?.(e.id, QUENCH_DEATH_GESTURES.fall);
    }
    this.readSockets(e);
    if (!this.laid) this.lay(e);
    this.stage.visible = true;
    if (rest) this.hideScene();
    else this.paint(e, dt);
    this.seams.end();
    this.paintCards();
  }

  /** Stand the stage on her feet and lay the web on the lake (once a scene). */
  private lay(e: Entity): void {
    const at = fxAnchor(e);
    const sy = this.groundY(at.x, at.z);
    this.stage.position.set(at.x, sy, at.z);
    this.stage.updateMatrixWorld();
    this.yaw = e.facing;
    layWebStrips(this.webGeo, ENTRANCE_WEB, (x, z) => this.groundY(at.x + x, at.z + z) - sy);
    this.mirror.position.set(0, 0.07, 0);
    this.sheen.position.set(0, 0.08, 0);
    this.laid = true;
  }

  private letGo(e: Entity | null): void {
    // By the tracked id: a body out of view still lets its hold go.
    if (this.holding && this.entityId >= 0) holdQuenchDeath(e?.id ?? this.entityId, null);
    this.holding = false;
    this.rested = false;
    this.hideScene();
    if (this.t < 0) this.stage.visible = false;
  }

  private hideScene(): void {
    for (const m of [this.blades, this.stars, this.shards, this.mirror, this.sheen, this.flash])
      m.visible = false;
    this.web.visible = false;
    for (const c of this.web.children) c.visible = false;
  }

  private readSockets(e: Entity): void {
    const set = quenchBodySockets();
    const at = fxAnchor(e);
    const sin = Math.sin(e.facing);
    const cos = Math.cos(e.facing);
    for (let i = 0; i < QUENCH_SOCKETS.length; i++) {
      const p = set?.points[i];
      if (p) {
        p.getWorldPosition(this.sock[i]);
        continue;
      }
      const a = QUENCH_SOCKETS[i].at;
      const x = a[0] * U;
      const z = a[2] * U;
      this.sock[i].set(at.x + x * cos + z * sin, at.y + a[1] * U, at.z - x * sin + z * cos);
    }
  }

  // ---- the paint -----------------------------------------------------------------------------

  private paint(e: Entity, dt: number): void {
    const t = this.t;
    const prev = this.prev;
    const D = QUENCH_DEATH;
    const reduced = this.reducedMotion();
    const crossed = (at: number) => quenchDeathCrossed(prev, t, at);
    const sx = this.stage.position.x;
    const sy = this.stage.position.y;
    const sz = this.stage.position.z;
    const heart = this.sock[QUENCH_DEATH_HEART];
    const hx = heart.x - sx;
    const hy = heart.y - sy;
    const hz = heart.z - sz;
    const L = this.look;
    // ---- her heart blooming cold, out at the shatter ----
    const hk = quenchDeathLight(0.25 * L.heart * L.life, reduced);
    if (hk > 0.02) this.card(hx, hy, hz, 4 + 1.5 * L.heart, 0.55 * hk, 0.85 * hk, hk);
    // ---- the frost racing out over her from the heart ----
    const reach = quenchFrostReach(t);
    if (reach >= 0 && reach < 1) {
      this.frostDebt += dt * QUENCH_DEATH_RATES.frost * this.density;
      if (this.frostDebt > 20) this.frostDebt = 20;
      while (this.frostDebt >= 1) {
        this.frostDebt -= 1;
        const target =
          this.sock[QUENCH_FROST_TARGETS[Math.floor(this.rand() * QUENCH_FROST_TARGETS.length)]];
        const k = reach * (0.75 + 0.25 * this.rand());
        _v.copy(heart).lerp(target, k);
        this.particles.puff(_v.x, _v.y, _v.z, 1, FROST_RACE);
      }
      // The racing front's light at a few of her limbs.
      for (let i = 0; i < 4; i++) {
        const target = this.sock[QUENCH_FROST_TARGETS[(i * 5) % QUENCH_FROST_TARGETS.length]];
        _v.copy(heart).lerp(target, reach);
        const k = quenchDeathLight(0.45 * (1 - reach), reduced);
        this.card(_v.x - sx, _v.y - sy, _v.z - sz, 2.4, 0.6 * k, 0.9 * k, k);
      }
    }
    if (crossed(0.03)) this.particles.puff(heart.x, heart.y, heart.z, 26, HEART_GLINT);
    // ---- the blades falling and spearing into the lake ----
    this.paintBlades(t, prev, e, reduced);
    // ---- the lattice of seams over her ----
    const seamLv = quenchSeamLevel(t);
    if (seamLv > 0.01) {
      const pulse = reduced ? 1 : 0.8 + 0.2 * Math.sin(t * 18);
      for (let i = 0; i < SEAM_IDS.length; i++) {
        const on = t - quenchSeamAt(i);
        if (on < 0) continue;
        const grow = Math.min(1, on / 0.12);
        const a = this.sock[SEAM_IDS[i][0]];
        const b = this.sock[SEAM_IDS[i][1]];
        const ax = a.x - sx;
        const ay = a.y - sy;
        const az = a.z - sz;
        const light = quenchDeathLight(0.85 * seamLv * pulse, reduced);
        this.seams.draw(
          i * 31 + 3,
          ax,
          ay,
          az,
          ax + (b.x - sx - ax) * grow,
          ay + (b.y - sy - ay) * grow,
          az + (b.z - sz - az) * grow,
          0.06,
          0.32,
          light,
        );
      }
      if (seamLv > 0.3) {
        const k = quenchDeathLight(0.5 * seamLv, reduced);
        this.card(hx, hy, hz, 9, 0.4 * k, 0.75 * k, k);
      }
    }
    if (crossed(D.crackAt)) {
      this.thud(QUENCH_DEATH_SHAKES.crack.amount, QUENCH_DEATH_SHAKES.crack.reach, e);
      this.particles.puff(heart.x, heart.y, heart.z, 18, HEART_GLINT);
    }
    // ---- the shatter ----
    if (crossed(D.shatterAt)) {
      this.thud(QUENCH_DEATH_SHAKES.shatter.amount, QUENCH_DEATH_SHAKES.shatter.reach, e);
      this.particles.shockRing(sx, sz, 0xb8ecff, 22, 1, { wake: 0.35, crest: 0.14, strength: 0.8 });
      this.particles.puff(heart.x, heart.y - 2, heart.z, 80, SHATTER_GLINT);
      this.particles.puff(heart.x, heart.y - 3, heart.z, 34, SHATTER_MIST);
    }
    this.paintShards(t);
    // ---- the lake: the web healing, the calm sheet, the snow ----
    const lake = quenchDeathLake(t, _lake);
    const webOn = lake.grow > 0.005;
    this.web.visible = webOn;
    for (const c of this.web.children) c.visible = webOn;
    if (webOn) {
      this.webMat.uniforms.uGrow.value = lake.grow;
      this.webMat.uniforms.uGlow.value = quenchDeathLight(lake.glow, reduced);
    }
    this.mirror.visible = lake.calm > 0.005;
    this.mirrorMat.uniforms.uAlpha.value = lake.calm;
    this.sheen.visible = this.secondary && lake.calm > 0.005;
    this.sheenMat.uniforms.uAlpha.value = 0.12 * lake.calm;
    if (lake.snow > 0.02) {
      this.snowDebt += dt * QUENCH_DEATH_RATES.snow * lake.snow * this.density;
      if (this.snowDebt > 10) this.snowDebt = 10;
      SNOWFLAKE.floor = sy + 0.05;
      while (this.snowDebt >= 1) {
        this.snowDebt -= 1;
        const a = this.rand() * Math.PI * 2;
        const r = Math.sqrt(this.rand()) * 26;
        this.particles.puff(
          sx + Math.sin(a) * r,
          sy + 7 + this.rand() * 8,
          sz + Math.cos(a) * r,
          1,
          SNOWFLAKE,
        );
      }
    }
    // The mist rolling off her husk, low over the ice.
    if (L.mist > 0.05) {
      this.mistDebt += dt * 7 * L.mist * this.density;
      if (this.mistDebt > 6) this.mistDebt = 6;
      while (this.mistDebt >= 1) {
        this.mistDebt -= 1;
        const a = this.rand() * Math.PI * 2;
        const r = 2 + this.rand() * 4;
        this.particles.puff(sx + Math.sin(a) * r, sy + 0.5, sz + Math.cos(a) * r, 1, LOW_MIST);
      }
    }
    // The shatter's burst of cold light (never a white-out).
    const fk = quenchDeathLight(lake.flash * 1.2, reduced);
    this.flash.visible = fk > 0.01;
    if (this.flash.visible) {
      _m.compose(_p.set(hx, hy - 1, hz), _q.identity(), _s.setScalar(22 * (0.7 + 0.3 * fk)));
      this.flash.setMatrixAt(0, _m);
      this.flash.setColorAt(0, _c.setRGB(0.6 * fk, 0.85 * fk, fk));
      this.flash.instanceMatrix.needsUpdate = true;
      if (this.flash.instanceColor) this.flash.instanceColor.needsUpdate = true;
    }
    this.sounds(t, prev, e);
  }

  /** Her blades: hanging and trembling, falling point first, speared into
   *  the lake (a star of cracks and a spray), sunk away into the calm. */
  private paintBlades(t: number, prev: number, e: Entity, reduced: boolean): void {
    const sx = this.stage.position.x;
    const sy = this.stage.position.y;
    const sz = this.stage.position.z;
    let anyBlade = false;
    let anyStar = false;
    for (let i = 0; i < NB; i++) {
      const b = QUENCH_DEATH_BLADES[i];
      const f = quenchBladeAt(b, t, _blade);
      const ang = b.angle + this.yaw;
      const bx = Math.sin(ang) * b.r;
      const bz = Math.cos(ang) * b.r;
      const floor = this.groundY(sx + bx, sz + bz) - sy;
      if (f.sink >= 1) {
        this.blades.setMatrixAt(i, _zero);
      } else {
        anyBlade = true;
        // Point down, leaning out from her by its tilt; a tremble as it lets go.
        const shake = reduced ? 0 : f.wobble * 0.06 * Math.sin(t * 60 + i);
        _axis.set(Math.cos(ang), 0, -Math.sin(ang));
        _q.setFromAxisAngle(_axis, Math.PI + f.tilt + shake);
        // The point at (bx, floor + y, bz); the pommel a blade's length up.
        _v.set(0, BL, 0).applyQuaternion(_q);
        _p.set(bx - _v.x, floor + f.y - _v.y, bz - _v.z);
        _m.compose(_p, _q, _s.setScalar(1));
        this.blades.setMatrixAt(i, _m);
        const light = quenchDeathLight(
          f.struck ? Math.exp(-f.since * 1.5) * 0.8 + 0.2 : 0.7,
          reduced,
        );
        this.blades.setColorAt(i, _c.setRGB(light, light, light));
        // Its point's glint while it hangs.
        if (!f.struck) this.card(bx, floor + f.y + 0.3, bz, 2.2, 0.4, 0.7, 1);
      }
      // The star of cracks where it struck (healing with the web).
      if (f.struck) {
        const heal = 1 - Math.min(1, Math.max(0, (t - QUENCH_DEATH.healFrom) / 2));
        const reveal = Math.min(1, f.since / 0.35);
        if (heal > 0.01) {
          anyStar = true;
          _m.compose(_p.set(bx, floor + 0.08, bz), _q.identity(), _s.setScalar(6.5));
          this.stars.setMatrixAt(i, _m);
          this.stars.setColorAt(i, _c.setRGB(reveal, quenchDeathLight(0.9 * heal, reduced), 0));
        } else this.stars.setMatrixAt(i, _zero);
        if (quenchDeathCrossed(prev, t, t - f.since)) {
          this.particles.puff(sx + bx, sy + floor + 0.3, sz + bz, 22, STRIKE_SPRAY);
          this.particles.puff(sx + bx, sy + floor + 0.3, sz + bz, 10, STRIKE_GLINT);
          this.thud(QUENCH_DEATH_SHAKES.blade.amount, QUENCH_DEATH_SHAKES.blade.reach, e);
        }
      } else this.stars.setMatrixAt(i, _zero);
    }
    // Uploaded only while drawn (or on the frame they go).
    if (anyBlade || this.blades.visible) {
      this.blades.instanceMatrix.needsUpdate = true;
      if (this.blades.instanceColor) this.blades.instanceColor.needsUpdate = true;
    }
    this.blades.visible = anyBlade;
    if (anyStar || this.stars.visible) {
      this.stars.instanceMatrix.needsUpdate = true;
      if (this.stars.instanceColor) this.stars.instanceColor.needsUpdate = true;
    }
    this.stars.visible = anyStar;
  }

  /** The statue's shell burst into shards: tumbling out, skittering over
   *  the ice, melting away. */
  private paintShards(t: number): void {
    const since = t - QUENCH_DEATH.shatterAt;
    if (since < 0 || since > 4.5) {
      this.shards.visible = false;
      if (since < 0) this.shardsBorn = false;
      return;
    }
    const sx = this.stage.position.x;
    const sy = this.stage.position.y;
    const sz = this.stage.position.z;
    if (!this.shardsBorn) {
      for (let i = 0; i < QUENCH_SHARDS.length; i++) {
        const p = this.sock[QUENCH_SHARDS[i].socket];
        this.shardBirth[i * 3] = p.x - sx;
        this.shardBirth[i * 3 + 1] = p.y - sy;
        this.shardBirth[i * 3 + 2] = p.z - sz;
      }
      this.shardsBorn = true;
    }
    let any = false;
    for (let j = 0; j < this.shardPicks.length; j++) {
      const i = this.shardPicks[j];
      const s = QUENCH_SHARDS[i];
      const bx = this.shardBirth[i * 3];
      const by = this.shardBirth[i * 3 + 1];
      const bz = this.shardBirth[i * 3 + 2];
      const floor = this.groundY(sx + bx, sz + bz) - sy;
      const f = quenchShardAt(s, since, by - floor - 0.15, _shard);
      if (f.scale <= 0.01) {
        this.shards.setMatrixAt(j, _zero);
        continue;
      }
      any = true;
      _axis.set(Math.sin(i * 1.7), 0.5, Math.cos(i * 2.3)).normalize();
      _q.setFromAxisAngle(_axis, f.turn);
      _m.compose(
        _p.set(bx + Math.sin(s.angle) * f.out, by + f.y, bz + Math.cos(s.angle) * f.out),
        _q,
        _s.setScalar(f.scale),
      );
      this.shards.setMatrixAt(j, _m);
    }
    if (any || this.shards.visible) this.shards.instanceMatrix.needsUpdate = true;
    this.shards.visible = any;
  }

  private card(
    x: number,
    y: number,
    z: number,
    size: number,
    r: number,
    g: number,
    b: number,
  ): void {
    if (this.cardN >= CARDS) return;
    _m.compose(_p.set(x, y, z), _q.identity(), _s.setScalar(size));
    this.cards.setMatrixAt(this.cardN, _m);
    this.cards.setColorAt(this.cardN, _c.setRGB(r, g, b));
    this.cardN++;
  }

  private paintCards(): void {
    const was = this.cards.visible;
    for (let i = this.cardN; i < CARDS; i++) this.cards.setMatrixAt(i, _zero);
    this.cards.visible = this.cardN > 0;
    if (this.cardN > 0 || was) {
      this.cards.instanceMatrix.needsUpdate = true;
      if (this.cards.instanceColor) this.cards.instanceColor.needsUpdate = true;
    }
  }

  private thud(amount: number, reach: number, e: Entity): void {
    const me = this.world?.entities.get(this.world.playerId);
    if (!this.shakeSink || !me) return;
    const k = quenchDeathShake(
      amount,
      reach,
      Math.hypot(me.pos.x - e.pos.x, me.pos.z - e.pos.z),
      this.reducedMotion(),
    );
    if (k > 0) this.shakeSink(k);
  }

  private sounds(t: number, prev: number, e: Entity): void {
    if (prev < 0 || t <= prev) return;
    for (const snd of QUENCH_DEATH_SOUNDS) {
      if (!quenchDeathCrossed(prev, t, snd.at)) continue;
      sfx.playAt(snd.key, e.pos.x, e.pos.y + 5, e.pos.z, {
        gain: snd.gain,
        rate: snd.rate,
        cooldown: 0.05,
        jitter: false,
        priority: true,
      });
    }
  }

  // ---- the scan --------------------------------------------------------------------------------

  private scan(world: IWorld): void {
    const me = world.entities.get(world.playerId);
    if (!me || !inSmithHeartClaim(me.pos.x, me.pos.z)) {
      if (this.entityId >= 0) this.release();
      return;
    }
    if (world.entityRosterVersion === this.rosterSeen) return;
    this.rosterSeen = world.entityRosterVersion;
    for (const e of world.entities.values()) {
      if (e.kind !== 'mob' || e.templateId !== QUENCH_GUARDIAN) continue;
      if (e.id !== this.entityId) this.take(e.id);
      break;
    }
  }

  /** Track her body (a new run's: its record starts afresh). */
  private take(id: number): void {
    if (this.holding && this.entityId >= 0 && this.entityId !== id)
      holdQuenchDeath(this.entityId, null);
    if (this.entityId !== id) this.holding = false;
    this.entityId = id;
    this.deadKnown = false;
    this.deadAt = 0;
    this.seenAlive = false;
    this.replayAt = -1;
    this.fell = false;
    this.laid = false;
    this.shardsBorn = false;
    this.t = -1;
    this.prev = -1;
  }

  private release(): void {
    if (this.holding && this.entityId >= 0) holdQuenchDeath(this.entityId, null);
    this.holding = false;
    this.take(-1);
    this.rosterSeen = Number.NaN;
    this.stage.visible = false;
    this.hideScene();
    this.particles.hideRings();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
    this.root.removeFromParent();
    this.particles.dispose();
    for (const m of [this.blades, this.stars, this.shards, this.cards, this.flash]) m.dispose();
    this.seams.glows.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}

// ---- particles' options -----------------------------------------------------------------------

const FROST_RACE: SanctumPuffOptions = {
  speed: 0.4,
  life: 0.7,
  size: [0.7, 0.15],
  color: FROST,
  alpha: 1,
  pool: 'glow',
  drag: 1.5,
  floor: -1e6,
};
const HEART_GLINT: SanctumPuffOptions = {
  speed: 6,
  life: 0.8,
  size: [0.6, 0.1],
  color: GLINT,
  alpha: 1,
  pool: 'glow',
  drag: 1.4,
  radius: 0.8,
  floor: -1e6,
};
const STRIKE_SPRAY: SanctumPuffOptions = {
  speed: 6,
  up: 5,
  life: 1.1,
  size: [1.2, 3],
  color: MIST,
  alpha: 0.55,
  gravity: 6,
  drag: 1.2,
  radius: 0.8,
};
const STRIKE_GLINT: SanctumPuffOptions = {
  speed: 7,
  up: 6,
  life: 0.9,
  size: [0.5, 0.1],
  color: GLINT,
  alpha: 1,
  pool: 'glow',
  gravity: 14,
  drag: 0.6,
  radius: 0.5,
};
const SHATTER_GLINT: SanctumPuffOptions = {
  speed: 13,
  up: 4,
  life: 1.6,
  size: [0.7, 0.12],
  color: GLINT,
  alpha: 1,
  pool: 'glow',
  gravity: 9,
  drag: 0.7,
  radius: 2.5,
};
const SHATTER_MIST: SanctumPuffOptions = {
  speed: 7,
  up: 1.5,
  life: 3,
  size: [4, 12],
  color: MIST,
  alpha: 0.5,
  drag: 1,
  radius: 3,
  floor: -1e6,
};
const SNOWFLAKE: SanctumPuffOptions & { floor: number } = {
  speed: 0.5,
  up: -1.4,
  life: 6,
  size: [0.3, 0.25],
  color: SNOW,
  alpha: 0.9,
  drag: 0.3,
  floor: -1e6,
};
const LOW_MIST: SanctumPuffOptions = {
  speed: 1.2,
  up: 0.2,
  life: 3.2,
  size: [2.5, 6],
  color: MIST,
  alpha: 0.22,
  drag: 0.6,
};
