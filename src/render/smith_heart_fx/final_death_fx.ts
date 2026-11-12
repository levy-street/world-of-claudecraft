// The Masterless Strength's death, painted (plan: final_death_core.ts;
// shaders: final_death_glsl.ts, with the arrival's ribbon, pool and beam
// programs reused), hosted by final_fx.ts (the scene's clock off the boss's
// death in IWorld or a dev replay cue, the heart crystal torn out of the
// chest, the shared particles, flashes and camera thud are its):
//  - the kneel: light crawling over the stone into the chest, chips of rock
//    breaking off, the cracks blazing (the rig's glow pulse), a rumble;
//  - the tear: a burst of light and broken stone (one instanced draw of the
//    colossus's own chunks, thrown, tumbling, landing round the husk), the
//    husk going dark (a shade pulse re-sent while it holds);
//  - the four comets: a white head in its vein's halo, trailing its
//    element's sparks across the Anvil to its altar (the altar's flare),
//    then racing down its groove (one draw: final_groove_ribbon.ts's ribbon
//    burning behind the head, then cooling to embers);
//  - the well: the comets winding in, the merged core, the vortex turning
//    down into the pit, the pool of light, the plunge, the column thrown back
//    up, the four-colour shockwave and the thud; the last throb;
//  - the scene's sounds on their beats (existing samples).
// Cosmetic layers thin on the low tier (the particles, the debris share, the
// column's sheath and the comets' halos, `DEATH_SECONDARY_LAYERS`) and under
// reduced motion (the thuds, the flashes' size); every beat plays on every
// tier.
//
// Rules (src/render/CLAUDE.md): every material is built in the constructor
// under the host's root, before the host's gated attach (the compile gate
// links it with the arrival's); no light; fixed meshes and pools, no
// per-frame allocation; disposed with the host.

import * as THREE from 'three';
import { sfx } from '../../game/sfx';
import { HEART_ROOM } from '../../sim/content/smith_heart_layout';
import { sharedUniforms } from '../gfx';
import type { SanctumPuffOptions } from '../gravewyrm_sanctum_fx/sanctum_fx_core';
import { radialGlowTexture } from '../textures';
import { DEATH_SECONDARY_LAYERS } from './entrance_budget_core';
import type { FinalArrivalHost } from './final_arrival_beam';
import { arrivalVeinColor } from './final_arrival_core';
import {
  ARRIVAL_BEAM_VERT,
  ARRIVAL_CORE_FRAG,
  ARRIVAL_POOL_FRAG,
  ARRIVAL_POOL_VERT,
  ARRIVAL_STREAM_VERT,
  ARRIVAL_SWIRL_FRAG,
} from './final_arrival_glsl';
import {
  DEATH_DEBRIS,
  DEATH_END,
  DEATH_FUNNEL,
  DEATH_GATHER,
  DEATH_GESTURES,
  DEATH_GEYSER,
  DEATH_HUSK_EVERY,
  DEATH_IMPACT,
  DEATH_MERGE,
  DEATH_SHAKES,
  DEATH_SOUNDS,
  DEATH_SPLIT,
  DEATH_STRUGGLE_BEATS,
  DEATH_TEAR,
  DEATH_THROB,
  DEATH_VEINS,
  type DeathCometLook,
  type DeathCoreLook,
  type DeathTrailLook,
  type DeathWellLook,
  deathComet,
  deathCore,
  deathDebrisAt,
  deathDebrisKept,
  deathGroovePath,
  deathHoverPoint,
  deathHusk,
  deathLandAt,
  deathTrail,
  deathWell,
} from './final_death_core';
import { DEATH_FUNNEL_FRAG, DEATH_FUNNEL_VERT, DEATH_TRAIL_FRAG } from './final_death_glsl';
import { buildGrooveRibbon, type GrooveRibbon, layGrooveRibbon } from './final_groove_ribbon';
import { colossusChunk } from './final_kit_shapes';

/** What the host lends: the arrival's host (particles, flashes, the camera's
 *  thud, dice, the floor), the reduced-motion switch and the rig's gesture
 *  seam. */
export interface FinalDeathHost extends FinalArrivalHost {
  reducedMotion(): boolean;
  playGesture?: (entityId: number, gesture: string) => void;
}

/** The frame the host hands over: the scene's clock (`t`, -1 none) and the
 *  last frame's, whether it is a dev replay on a living body, the boss, the
 *  slot's origin, the body's feet (world yards) and its chest where the
 *  crystal tore from (instance-local), its facing. */
export interface FinalDeathFrame {
  t: number;
  prev: number;
  replay: boolean;
  bossId: number;
  ox: number;
  oz: number;
  footX: number;
  footY: number;
  footZ: number;
  chestX: number;
  chestY: number;
  chestZ: number;
  facing: number;
  dt: number;
}

const RIBBON = { half: 3.0, halfEnd: 2.1, lift: 0.14, veil: 4.2 } as const;
const VEIN_RGB = DEATH_VEINS.map((v) => {
  const c = new THREE.Color(arrivalVeinColor(v));
  return [c.r, c.g, c.b] as const;
});
const WHITE: readonly [number, number, number] = [1, 0.96, 0.88];
const EMBER: readonly [number, number, number] = [1, 0.42, 0.12];
const DUST: readonly [number, number, number] = [0.4, 0.36, 0.34];
const STONE: readonly [number, number, number] = [0.2, 0.17, 0.16];
const PATHS = DEATH_VEINS.map((_, i) => deathGroovePath(i));
const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _hover = { x: 0, y: 0, z: 0 };
const _chest = { x: 0, y: 0, z: 0 };
const _deb = { side: 0, fwd: 0, y: 0, scale: 0, turn: 0 };
/** Reused puff sizes and heading (no per-particle allocation). */
const SIZE_CRAWL: readonly [number, number] = [0.9, 0.15];
const SIZE_FLY: readonly [number, number] = [2.4, 0.25];
const SIZE_RUN: readonly [number, number] = [1.7, 0.2];
const SIZE_EMBER: readonly [number, number] = [0.45, 0.08];
const DIR: [number, number, number] = [0, 1, 0];

export class FinalDeathFx {
  private readonly group = new THREE.Group();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly ribbon: GrooveRibbon;
  private readonly trails: THREE.Mesh;
  private readonly trailMat: THREE.ShaderMaterial;
  private readonly pool: THREE.Mesh;
  private readonly poolMat: THREE.ShaderMaterial;
  private readonly funnel: THREE.Mesh;
  private readonly funnelMat: THREE.ShaderMaterial;
  private readonly geyserCore: THREE.Mesh;
  private readonly geyserCoreMat: THREE.ShaderMaterial;
  private readonly geyserSwirl: THREE.Mesh;
  private readonly geyserSwirlMat: THREE.ShaderMaterial;
  private readonly sheath: THREE.Sprite;
  private readonly heads: THREE.Sprite[] = [];
  private readonly halos: THREE.Sprite[] = [];
  private readonly core: THREE.Sprite;
  private readonly coreHalo: THREE.Sprite;
  private readonly debris: THREE.InstancedMesh;
  /** The low tier sheds the cosmetic doubles (entrance_budget_core.ts). */
  private readonly rich: boolean;
  private laidX = Number.NaN;
  private laidZ = Number.NaN;
  /** The floor's height at an instance-local point of the laid slot. */
  private readonly groundLocal = (x: number, z: number): number =>
    this.host.groundY(this.laidX + x, this.laidZ + z);
  private huskIn = 0;
  private readonly comet: DeathCometLook = {
    phase: 'off',
    x: 0,
    y: 0,
    z: 0,
    grounded: false,
    glow: 0,
    size: 0,
  };
  /** Each comet's world position last frame (its trail's sparks). */
  private readonly cometAt = DEATH_VEINS.map(() => ({ x: 0, y: 0, z: 0, set: false }));
  private readonly trail: DeathTrailLook = { front: -1, level: 0, head: 0, ember: 0 };
  private readonly coreLook: DeathCoreLook = { shown: false, y: 0, size: 0, glow: 0 };
  private readonly well: DeathWellLook = { pool: 0, funnel: 0, geyserTop: 0, geyserGlow: 0 };
  private readonly emitDebt = [0, 0, 0, 0];
  private crawlDebt = 0;
  private emberDebt = 0;
  private coreDebt = 0;
  /** The kneel's foot point and facing, held from the tear (the debris
   *  lands round where the body knelt). */
  private readonly torn = { x: 0, y: 0, z: 0, chestY: 0, facing: 0, set: false };
  private readonly puffO: SanctumPuffOptions = {
    speed: 3,
    life: 1,
    size: [1, 0.2],
    color: WHITE,
    alpha: 1,
    pool: 'glow',
  };

  constructor(
    root: THREE.Group,
    private readonly host: FinalDeathHost,
  ) {
    this.rich = host.secondary;
    this.group.name = 'smithHeartFinalDeath';
    this.group.visible = false;
    root.add(this.group);
    const colors = () => {
      const u: Record<string, { value: THREE.Color }> = {};
      DEATH_VEINS.forEach((v, i) => {
        u[`uC${i}`] = { value: new THREE.Color(arrivalVeinColor(v)) };
      });
      return u;
    };
    const additive = (
      name: string,
      vert: string,
      frag: string,
      uniforms: Record<string, { value: unknown }>,
      side: THREE.Side = THREE.FrontSide,
    ): THREE.ShaderMaterial => {
      const m = new THREE.ShaderMaterial({
        name,
        uniforms,
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        fog: false,
        side,
      });
      this.materials.push(m);
      return m;
    };
    // ---- the grooves the comets race down: one draw ----
    this.ribbon = buildGrooveRibbon(PATHS, RIBBON);
    this.geometries.push(this.ribbon.geometry);
    this.trailMat = additive(
      'smithHeartDeathTrails',
      ARRIVAL_STREAM_VERT,
      DEATH_TRAIL_FRAG,
      {
        ...colors(),
        uFront: { value: new THREE.Vector4(-1, -1, -1, -1) },
        uLevel: { value: new THREE.Vector4() },
        uHead: { value: new THREE.Vector4() },
        uEmber: { value: new THREE.Vector4() },
        uTime: sharedUniforms.uTime,
        uLength: { value: this.ribbon.length },
      },
      THREE.DoubleSide,
    );
    this.trailMat.polygonOffset = true;
    this.trailMat.polygonOffsetFactor = -2;
    this.trailMat.polygonOffsetUnits = -2;
    this.trails = new THREE.Mesh(this.ribbon.geometry, this.trailMat);
    this.trails.name = 'smithHeartDeathTrails';
    this.trails.frustumCulled = false;
    this.trails.renderOrder = 2;
    this.group.add(this.trails);
    // ---- the well: the pool, the vortex, the column thrown up ----
    const poolGeo = new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2);
    this.geometries.push(poolGeo);
    this.poolMat = additive('smithHeartDeathPool', ARRIVAL_POOL_VERT, ARRIVAL_POOL_FRAG, {
      ...colors(),
      uTime: sharedUniforms.uTime,
      uGlow: { value: 0 },
    });
    this.poolMat.polygonOffset = true;
    this.poolMat.polygonOffsetFactor = -3;
    this.poolMat.polygonOffsetUnits = -3;
    this.pool = new THREE.Mesh(poolGeo, this.poolMat);
    this.pool.name = 'smithHeartDeathPool';
    this.pool.frustumCulled = false;
    this.pool.renderOrder = 2;
    this.group.add(this.pool);
    const F = DEATH_FUNNEL;
    const funnelGeo = new THREE.CylinderGeometry(F.mouthR, F.throatR, F.height, 56, 10, true);
    funnelGeo.translate(0, F.height / 2, 0);
    this.geometries.push(funnelGeo);
    this.funnelMat = additive(
      'smithHeartDeathFunnel',
      DEATH_FUNNEL_VERT,
      DEATH_FUNNEL_FRAG,
      { ...colors(), uTime: sharedUniforms.uTime, uGlow: { value: 0 }, uSpin: { value: 2.5 } },
      THREE.DoubleSide,
    );
    this.funnel = new THREE.Mesh(funnelGeo, this.funnelMat);
    this.funnel.name = 'smithHeartDeathFunnel';
    this.funnel.frustumCulled = false;
    this.funnel.renderOrder = 3;
    this.group.add(this.funnel);
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 40, 16, true).translate(0, 0.5, 0);
    this.geometries.push(beamGeo);
    this.geyserSwirlMat = additive(
      'smithHeartDeathGeyserSwirl',
      ARRIVAL_BEAM_VERT,
      ARRIVAL_SWIRL_FRAG,
      {
        ...colors(),
        uTime: sharedUniforms.uTime,
        uHeight: { value: 1 },
        uGlow: { value: 0 },
        uDetail: { value: host.density >= 1 ? 1 : 0 },
      },
      THREE.DoubleSide,
    );
    this.geyserSwirl = new THREE.Mesh(beamGeo, this.geyserSwirlMat);
    this.geyserSwirl.name = 'smithHeartDeathGeyserSwirl';
    this.geyserSwirl.frustumCulled = false;
    this.geyserSwirl.renderOrder = 3;
    this.group.add(this.geyserSwirl);
    this.geyserCoreMat = additive(
      'smithHeartDeathGeyserCore',
      ARRIVAL_BEAM_VERT,
      ARRIVAL_CORE_FRAG,
      {
        uTime: sharedUniforms.uTime,
        uHeight: { value: 1 },
        uGlow: { value: 0 },
      },
    );
    this.geyserCore = new THREE.Mesh(beamGeo, this.geyserCoreMat);
    this.geyserCore.name = 'smithHeartDeathGeyserCore';
    this.geyserCore.frustumCulled = false;
    this.geyserCore.renderOrder = 4;
    this.group.add(this.geyserCore);
    // ---- the billboards: the column's sheath, the comets, the core ----
    const glowTex = typeof document !== 'undefined' ? radialGlowTexture() : null;
    const sprite = (name: string, color: number): THREE.Sprite => {
      const m = new THREE.SpriteMaterial({
        map: glowTex,
        color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        fog: false,
        name,
      });
      this.materials.push(m);
      const s = new THREE.Sprite(m);
      s.name = name;
      s.visible = false;
      s.frustumCulled = false;
      this.group.add(s);
      return s;
    };
    this.sheath = sprite(DEATH_SECONDARY_LAYERS[0], 0xfff2e0);
    for (let i = 0; i < DEATH_VEINS.length; i++) {
      this.halos.push(sprite(DEATH_SECONDARY_LAYERS[1], arrivalVeinColor(DEATH_VEINS[i])));
      this.heads.push(sprite('smithHeartDeathCometHead', 0xfff4e4));
    }
    this.coreHalo = sprite('smithHeartDeathCoreHalo', 0xffe2b8);
    this.core = sprite('smithHeartDeathCore', 0xfffaf0);
    // ---- the husk's broken stone: one instanced draw, lit like the body's
    // own orbiting rocks (final_body_fx.ts: the same material, one program) ----
    const rockGeo = colossusChunk();
    this.geometries.push(rockGeo);
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      emissive: 0x3a2410,
      emissiveIntensity: 0.3,
      roughness: 0.92,
      flatShading: true,
      name: 'smithHeartDeathDebris',
    });
    this.materials.push(rockMat);
    this.debris = new THREE.InstancedMesh(rockGeo, rockMat, DEATH_DEBRIS.length);
    this.debris.name = 'smithHeartDeathDebris';
    this.debris.frustumCulled = false;
    this.debris.castShadow = false;
    this.debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < DEATH_DEBRIS.length; i++) this.debris.setMatrixAt(i, _m.makeScale(0, 0, 0));
    this.debris.visible = false;
    this.group.add(this.debris);
  }

  /** Paint the scene at the frame's clock (the moments fire as they pass). */
  update(f: FinalDeathFrame): void {
    this.husk(f);
    const live = f.t >= 0 && f.t < DEATH_END;
    if (!live) {
      if (this.group.visible) this.group.visible = false;
      this.torn.set = false;
      for (const c of this.cometAt) c.set = false;
      return;
    }
    this.group.visible = true;
    if (f.ox !== this.laidX || f.oz !== this.laidZ) {
      this.laidX = f.ox;
      this.laidZ = f.oz;
      this.trails.position.set(f.ox, 0, f.oz);
      layGrooveRibbon(this.ribbon, f.ox, f.oz, (x, z) => this.host.groundY(x, z));
    }
    if (!this.torn.set || f.t < DEATH_TEAR) {
      this.torn.x = f.footX;
      this.torn.y = f.footY;
      this.torn.z = f.footZ;
      this.torn.chestY = f.chestY;
      this.torn.facing = f.facing;
      this.torn.set = true;
    }
    this.struggle(f);
    this.paintComets(f);
    this.paintTrails(f);
    this.paintWell(f);
    this.paintDebris(f);
    this.moments(f);
    this.sounds(f);
  }

  /** Nothing in view (no boss): the scene's draws off. */
  hide(): void {
    if (this.group.visible) this.group.visible = false;
  }

  /** The rig: the cracks blaze as it dies, the husk's shade re-sent while
   *  it holds (a corpse stays a husk; a replay gives the colour back). */
  private husk(f: FinalDeathFrame): void {
    const send = this.host.playGesture;
    if (!send || f.bossId < 0 || f.t < 0) {
      this.huskIn = 0;
      return;
    }
    if (f.prev < 0.02 && f.t >= 0.02 && f.t < 0.6) send(f.bossId, DEATH_GESTURES.blaze);
    if (!deathHusk(f.t, f.replay)) {
      this.huskIn = 0;
      return;
    }
    this.huskIn -= f.dt;
    if (this.huskIn <= 0) {
      this.huskIn = DEATH_HUSK_EVERY;
      send(f.bossId, DEATH_GESTURES.husk);
    }
  }

  /** The kneel: light crawling over the stone into the chest, chips of
   *  rock breaking away. */
  private struggle(f: FinalDeathFrame): void {
    if (f.t >= DEATH_TEAR) return;
    const h = this.host;
    const P = h.particles;
    const k = f.t / DEATH_TEAR;
    const cx = f.ox + f.chestX;
    const cz = f.oz + f.chestZ;
    const H = Math.max(4, f.chestY - f.footY);
    this.crawlDebt += f.dt * (70 + 120 * k) * h.density;
    const o = this.puffO;
    while (this.crawlDebt >= 1) {
      this.crawlDebt -= 1;
      const a = h.rand() * Math.PI * 2;
      const r = H * (0.25 + 0.25 * h.rand());
      const sx = f.footX + Math.cos(a) * r;
      const sz = f.footZ + Math.sin(a) * r;
      const sy = f.footY + H * (0.1 + 1.0 * h.rand());
      _v.set(cx - sx, f.chestY - sy, cz - sz);
      const len = _v.length() || 1;
      o.speed = len * 2.4;
      o.life = 0.42;
      o.size = SIZE_CRAWL;
      o.color = h.rand() < 0.25 ? WHITE : VEIN_RGB[Math.floor(h.rand() * 4) % 4];
      o.alpha = 1;
      o.pool = 'glow';
      DIR[0] = _v.x / len;
      DIR[1] = _v.y / len;
      DIR[2] = _v.z / len;
      o.dir = DIR;
      o.spread = 0.05;
      o.drag = 0.1;
      o.gravity = undefined;
      o.radius = undefined;
      o.up = undefined;
      o.floor = f.footY - 2;
      P.puff(sx, sy, sz, 1, o);
    }
    // Chips of the stone shell falling away.
    if (h.rand() < f.dt * 26 * h.density) {
      const a = h.rand() * Math.PI * 2;
      const r = H * 0.3;
      P.puff(
        f.footX + Math.cos(a) * r,
        f.footY + H * (0.3 + 0.8 * h.rand()),
        f.footZ + Math.sin(a) * r,
        2,
        {
          speed: 3,
          up: 2,
          life: 1.2,
          size: [0.5, 0.35],
          color: STONE,
          alpha: 1,
          gravity: 22,
        },
      );
    }
  }

  private paintComets(f: FinalDeathFrame): void {
    const h = this.host;
    deathHoverPoint(this.chestLocal(f, _chest), _hover);
    for (let i = 0; i < DEATH_VEINS.length; i++) {
      const c = deathComet(f.t, i, _hover, this.groundLocal, this.comet);
      const head = this.heads[i];
      const halo = this.halos[i];
      const on = c.phase !== 'off' && c.phase !== 'gone';
      head.visible = on;
      halo.visible = on && this.rich;
      const at = this.cometAt[i];
      if (!on) {
        at.set = false;
        continue;
      }
      const x = f.ox + c.x;
      const z = f.oz + c.z;
      const y = c.grounded ? h.groundY(x, z) + c.y : c.y;
      const flick = 0.85 + 0.15 * Math.sin(sharedUniforms.uTime.value * 31 + i * 2);
      head.position.set(x, y, z);
      head.scale.setScalar(c.size * 1.9 * flick);
      (head.material as THREE.SpriteMaterial).opacity = Math.min(1, c.glow);
      halo.position.set(x, y, z);
      // On the floor a wide halo would cut against the stone in a hard line
      // (a sprite through the floor plane): the groove's own light carries
      // the glow there, the halo stays tight.
      halo.scale.setScalar(c.size * (c.grounded ? 2.4 : 6.5) * flick);
      (halo.material as THREE.SpriteMaterial).opacity = 0.85 * Math.min(1, c.glow);
      this.cometSparks(f, i, x, y, z, c.phase);
      at.x = x;
      at.y = y;
      at.z = z;
      at.set = true;
    }
    // The merged core over the well and its dive.
    const k = deathCore(f.t, this.coreLook);
    this.core.visible = k.shown;
    this.coreHalo.visible = k.shown;
    if (k.shown) {
      const wx = f.ox + HEART_ROOM.x;
      const wz = f.oz + HEART_ROOM.z;
      const y = h.groundY(wx, wz) + k.y;
      const flick = 0.9 + 0.1 * Math.sin(sharedUniforms.uTime.value * 40);
      this.core.position.set(wx, y, wz);
      this.core.scale.setScalar(k.size * 1.6 * flick);
      (this.core.material as THREE.SpriteMaterial).opacity = Math.min(1, k.glow);
      this.coreHalo.position.set(wx, y, wz);
      this.coreHalo.scale.setScalar(k.size * 4.5 * flick);
      (this.coreHalo.material as THREE.SpriteMaterial).opacity = 0.7 * Math.min(1, k.glow);
      // Sparks of the four torn off it, hanging behind its dive.
      this.coreDebt += f.dt * 300 * h.density;
      const o = this.puffO;
      while (this.coreDebt >= 1) {
        this.coreDebt -= 1;
        o.speed = 2 + h.rand() * 3;
        o.up = 3;
        o.life = 0.7;
        o.size = SIZE_FLY;
        o.color = h.rand() < 0.3 ? WHITE : VEIN_RGB[Math.floor(h.rand() * 4) % 4];
        o.alpha = 1;
        o.pool = 'glow';
        o.dir = undefined;
        o.spread = undefined;
        o.drag = 1.2;
        o.gravity = undefined;
        o.radius = k.size * 0.3;
        o.floor = y - 40;
        h.particles.puff(wx, y, wz, 1, o);
      }
    }
  }

  /** The crystal's chest point (instance-local) the comets burst from. */
  private chestLocal(
    f: FinalDeathFrame,
    out: { x: number; y: number; z: number },
  ): { x: number; y: number; z: number } {
    out.x = f.chestX;
    out.y = f.chestY;
    out.z = f.chestZ;
    return out;
  }

  /** A comet's trail of its element's sparks (thinned by density). */
  private cometSparks(
    f: FinalDeathFrame,
    i: number,
    x: number,
    y: number,
    z: number,
    phase: DeathCometLook['phase'],
  ): void {
    const h = this.host;
    const P = h.particles;
    const prev = this.cometAt[i];
    const rate = phase === 'fly' ? 380 : phase === 'race' ? 260 : phase === 'gather' ? 220 : 60;
    this.emitDebt[i] += f.dt * rate * h.density;
    const o = this.puffO;
    const vein = DEATH_VEINS[i];
    while (this.emitDebt[i] >= 1) {
      this.emitDebt[i] -= 1;
      // Along the stretch it covered this frame, so a fast arc reads as a
      // streak, never as dots.
      const s = h.rand();
      const px = prev.set ? prev.x + (x - prev.x) * s : x;
      const py = prev.set ? prev.y + (y - prev.y) * s : y;
      const pz = prev.set ? prev.z + (z - prev.z) * s : z;
      o.speed = 1.5 + h.rand() * 2.5;
      o.up = vein === 'heat' ? 2.5 : vein === 'quench' ? -0.6 : 0.6;
      o.life = phase === 'race' ? 0.85 : 0.9;
      o.size = phase === 'fly' ? SIZE_FLY : SIZE_RUN;
      o.color = h.rand() < 0.22 ? WHITE : VEIN_RGB[i];
      o.alpha = 1;
      o.pool = vein === 'heat' && h.rand() < 0.4 ? 'pyre' : 'glow';
      o.dir = undefined;
      o.spread = undefined;
      o.drag = 1.1;
      o.gravity = vein === 'hammer' ? 9 : undefined;
      o.radius = 0.6;
      o.floor = phase === 'fly' ? py - 60 : undefined;
      P.puff(px, py, pz, 1, o);
    }
  }

  private paintTrails(f: FinalDeathFrame): void {
    const u = this.trailMat.uniforms;
    const front = u.uFront.value as THREE.Vector4;
    const level = u.uLevel.value as THREE.Vector4;
    const head = u.uHead.value as THREE.Vector4;
    const ember = u.uEmber.value as THREE.Vector4;
    let any = false;
    const h = this.host;
    for (let i = 0; i < DEATH_VEINS.length; i++) {
      const tr = deathTrail(f.t, i, this.trail);
      front.setComponent(i, tr.front);
      level.setComponent(i, tr.level);
      head.setComponent(i, tr.head);
      ember.setComponent(i, tr.ember);
      if (tr.front >= 0 && tr.level > 0.002) any = true;
      // Embers lifting off the cooling grooves.
      if (tr.ember > 0.05 && tr.level > 0.05) {
        this.emberDebt += f.dt * 10 * h.density * tr.level;
        while (this.emberDebt >= 1) {
          this.emberDebt -= 1;
          const p = PATHS[i];
          const k = Math.floor(h.rand() * (p.x.length - 1));
          const x = f.ox + p.x[k] + (h.rand() - 0.5) * 1.4;
          const z = f.oz + p.z[k] + (h.rand() - 0.5) * 1.4;
          const o = this.puffO;
          o.speed = 0.4;
          o.up = 1.6 + h.rand() * 1.4;
          o.life = 1.4 + h.rand();
          o.size = SIZE_EMBER;
          o.color = EMBER;
          o.alpha = 0.9;
          o.pool = 'glow';
          o.dir = undefined;
          o.spread = undefined;
          o.drag = 0.5;
          o.gravity = undefined;
          o.radius = undefined;
          o.floor = undefined;
          h.particles.puff(x, h.groundY(x, z) + 0.2, z, 1, o);
        }
      }
    }
    this.trails.visible = any;
  }

  private paintWell(f: FinalDeathFrame): void {
    const w = deathWell(f.t, this.well);
    const h = this.host;
    const wx = f.ox + HEART_ROOM.x;
    const wz = f.oz + HEART_ROOM.z;
    const wy = h.groundY(wx, wz);
    this.pool.visible = w.pool > 0.01;
    if (this.pool.visible) {
      const r = DEATH_GEYSER.poolR * (0.75 + 0.25 * Math.min(1, w.pool));
      this.pool.position.set(wx, wy + 0.2, wz);
      this.pool.scale.set(r, 1, r);
      this.poolMat.uniforms.uGlow.value = w.pool;
    }
    this.funnel.visible = w.funnel > 0.01;
    if (this.funnel.visible) {
      this.funnel.position.set(wx, wy - 1, wz);
      // The vortex tightens and quickens toward the plunge.
      const k = Math.max(0, Math.min(1, (f.t - DEATH_GATHER) / (DEATH_IMPACT - DEATH_GATHER)));
      const sx = 1 - 0.35 * k;
      this.funnel.scale.set(sx, 1 - 0.2 * k, sx);
      this.funnel.rotation.y = -sharedUniforms.uTime.value * (1.5 + 4 * k);
      this.funnelMat.uniforms.uGlow.value = w.funnel * (0.7 + 0.6 * k);
      this.funnelMat.uniforms.uSpin.value = 2.5 + 5 * k;
    }
    const on = w.geyserTop > 0.01;
    this.geyserCore.visible = on;
    this.geyserSwirl.visible = on;
    this.sheath.visible = on && this.rich;
    if (!on) return;
    const top = Math.max(0.5, w.geyserTop * DEATH_GEYSER.height);
    const sw = DEATH_GEYSER.swirlR * (0.6 + 0.4 * w.geyserTop);
    this.geyserSwirl.position.set(wx, wy - 2, wz);
    this.geyserSwirl.scale.set(sw, top, sw);
    this.geyserSwirlMat.uniforms.uHeight.value = top;
    this.geyserSwirlMat.uniforms.uGlow.value = w.geyserGlow;
    this.geyserCore.position.copy(this.geyserSwirl.position);
    this.geyserCore.scale.set(DEATH_GEYSER.coreR, top, DEATH_GEYSER.coreR);
    this.geyserCoreMat.uniforms.uHeight.value = top;
    this.geyserCoreMat.uniforms.uGlow.value = w.geyserGlow;
    this.sheath.position.set(wx, wy + top * 0.4, wz);
    this.sheath.scale.set(DEATH_GEYSER.swirlR * 4, top * 1.1, 1);
    (this.sheath.material as THREE.SpriteMaterial).opacity = 0.3 * Math.min(1, w.geyserGlow);
  }

  /** The husk's broken stone: thrown at the tear, tumbling, landing round
   *  where it knelt, sinking away at the scene's end. */
  private paintDebris(f: FinalDeathFrame): void {
    const age = f.t - DEATH_TEAR;
    if (age < 0) {
      this.debris.visible = false;
      return;
    }
    this.debris.visible = true;
    const T = this.torn;
    const s = Math.sin(T.facing);
    const c = Math.cos(T.facing);
    const H = Math.max(4, T.chestY - T.y);
    for (let i = 0; i < DEATH_DEBRIS.length; i++) {
      const piece = DEATH_DEBRIS[i];
      if (!deathDebrisKept(i, this.host.density)) {
        this.debris.setMatrixAt(i, _m.makeScale(0, 0, 0));
        continue;
      }
      const born = H * piece.from;
      const d = deathDebrisAt(piece, age, born - 0.4, _deb);
      // forward (sin f, cos f); the body's left (cos f, -sin f).
      const x = T.x + s * d.fwd + c * d.side;
      const z = T.z + c * d.fwd - s * d.side;
      _axis.set(Math.sin(i * 1.7), 0.6, Math.cos(i * 2.3)).normalize();
      _q.setFromAxisAngle(_axis, d.turn);
      _q2.setFromAxisAngle(UP, i * 0.9);
      _q.multiply(_q2);
      const sc = Math.max(0, d.scale);
      _m.compose(_v.set(x, T.y + born + d.y + sc * 0.3, z), _q, _s.set(sc, sc * 0.8, sc * 1.1));
      this.debris.setMatrixAt(i, _m);
    }
    this.debris.instanceMatrix.needsUpdate = true;
  }

  /** The beats as they pass (never replayed for a body first seen long
   *  dead: the host hands a clock long past them). */
  private moments(f: FinalDeathFrame): void {
    const prev = f.prev;
    const t = f.t;
    if (prev < 0 || t <= prev) return;
    const crossed = (at: number) => prev < at && t >= at && t - at < 0.5;
    const h = this.host;
    const P = h.particles;
    const rm = h.reducedMotion() ? 0.55 : 1;
    const cx = f.ox + f.chestX;
    const cz = f.oz + f.chestZ;
    const wx = f.ox + HEART_ROOM.x;
    const wz = f.oz + HEART_ROOM.z;
    // The knee striking the floor.
    if (crossed(0.65)) {
      P.puff(f.footX, f.footY + 0.4, f.footZ, Math.round(30 * h.density) + 6, {
        speed: 9,
        up: 1.5,
        life: 1.6,
        size: [2, 6],
        color: DUST,
        alpha: 0.45,
        drag: 1.4,
        radius: 3,
      });
      P.shockRing(f.footX, f.footZ, 0xffe6b8, 16, 0.6);
      h.shakeNear(f.footX, f.footZ, DEATH_SHAKES.struggle.amount * 2, DEATH_SHAKES.struggle.reach);
    }
    // The struggle's beats: the chest flaring in a colour, a rumble.
    DEATH_STRUGGLE_BEATS.forEach((b, i) => {
      if (!crossed(b)) return;
      h.flash(cx, f.chestY, cz, (12 + i * 4) * rm, 0.35, arrivalVeinColor(DEATH_VEINS[i % 4]));
      h.shakeNear(cx, cz, DEATH_SHAKES.struggle.amount, DEATH_SHAKES.struggle.reach);
    });
    if (crossed(DEATH_TEAR)) {
      // The crystal rips out: white light, the four colours, broken stone.
      h.flash(cx, f.chestY, cz, 34 * rm, 0.5, 0xffffff);
      h.flash(cx, f.chestY + 2, cz, 60 * rm, 0.8, 0xfff0d8);
      for (let i = 0; i < 4; i++)
        P.shockRing(
          f.footX,
          f.footZ,
          arrivalVeinColor(DEATH_VEINS[i]),
          18 + i * 7,
          0.7 + i * 0.15,
          {
            wake: 0.25,
            crest: 0.07,
            strength: 0.7,
          },
        );
      const fx = Math.sin(f.facing);
      const fz = Math.cos(f.facing);
      for (let i = 0; i < Math.round(80 * h.density) + 14; i++) {
        const a = h.rand() * Math.PI * 2;
        const fw = 0.6 + h.rand() * 0.6;
        P.puff(cx, f.chestY, cz, 1, {
          speed: 18 + h.rand() * 16,
          life: 0.9,
          size: [0.8, 0.12],
          color: i % 5 === 0 ? WHITE : VEIN_RGB[i % 4],
          alpha: 1,
          pool: 'glow',
          dir: [fx * fw + Math.cos(a) * 0.7, 0.1 + h.rand() * 0.8, fz * fw + Math.sin(a) * 0.7],
          spread: 0.15,
          drag: 0.8,
        });
      }
      P.puff(cx, f.chestY, cz, Math.round(30 * h.density) + 6, {
        speed: 8,
        up: 2,
        life: 1.6,
        size: [0.55, 0.4],
        color: STONE,
        alpha: 1,
        gravity: 24,
        radius: 1.5,
      });
      P.puff(cx, f.chestY - 1, cz, Math.round(24 * h.density) + 4, {
        speed: 7,
        up: 1,
        life: 2,
        size: [2.4, 6.5],
        color: DUST,
        alpha: 0.35,
        drag: 1.3,
        radius: 2,
      });
      h.shakeNear(cx, cz, DEATH_SHAKES.tear.amount, DEATH_SHAKES.tear.reach);
    }
    if (crossed(DEATH_SPLIT)) {
      // The crystal bursts into the four.
      deathHoverPoint(this.chestLocal(f, _chest), _hover);
      const x = f.ox + _hover.x;
      const z = f.oz + _hover.z;
      h.flash(x, _hover.y, z, 40 * rm, 0.55, 0xffffff);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        h.flash(
          x + Math.cos(a) * 1.4,
          _hover.y + Math.sin(a) * 1.2,
          z + Math.sin(a) * 1.4,
          22 * rm,
          0.7,
          arrivalVeinColor(DEATH_VEINS[i]),
        );
      }
      for (let i = 0; i < Math.round(70 * h.density) + 12; i++) {
        const a = h.rand() * Math.PI * 2;
        const e = h.rand() * 2 - 1;
        P.puff(x, _hover.y, z, 1, {
          speed: 14 + h.rand() * 12,
          life: 0.8,
          size: [0.7, 0.1],
          color: i % 4 === 0 ? WHITE : VEIN_RGB[i % 4],
          alpha: 1,
          pool: 'glow',
          dir: [Math.cos(a), e, Math.sin(a)],
          spread: 0.1,
          drag: 0.9,
          floor: f.footY - 1,
        });
      }
      h.shakeNear(x, z, DEATH_SHAKES.land.amount * 1.5, DEATH_SHAKES.tear.reach);
    }
    // Each comet landing at its altar: the altar flares in its colour.
    for (let i = 0; i < DEATH_VEINS.length; i++) {
      if (!crossed(deathLandAt(i))) continue;
      const p = PATHS[i];
      const x = f.ox + p.from.x;
      const z = f.oz + p.from.z;
      const y = h.groundY(x, z);
      const col = arrivalVeinColor(DEATH_VEINS[i]);
      h.flash(x, y + 3, z, 26 * rm, 0.8, col);
      h.flash(x, y + 9, z, 16 * rm, 1.1, col);
      P.shockRing(x, z, col, 12, 0.6, { wake: 0.2, crest: 0.08, strength: 0.8 });
      P.puff(x, y + 1, z, Math.round(26 * h.density) + 6, {
        speed: 7,
        up: 6,
        life: 1.1,
        size: [0.9, 0.12],
        color: VEIN_RGB[i],
        alpha: 1,
        pool: 'glow',
        radius: 1.2,
        drag: 0.9,
      });
      h.shakeNear(x, z, DEATH_SHAKES.land.amount, DEATH_SHAKES.land.reach);
    }
    if (crossed(DEATH_GATHER)) {
      h.flash(wx, h.groundY(wx, wz) + 3, wz, 24 * rm, 0.6, 0xfff0d8);
    }
    if (crossed(DEATH_MERGE)) {
      // The four are one: a white flash over the well.
      const y = h.groundY(wx, wz) + 4.5;
      h.flash(wx, y, wz, 30 * rm, 0.4, 0xffffff);
      for (let i = 0; i < 4; i++)
        h.flash(wx, y, wz, 18 * rm, 0.6, arrivalVeinColor(DEATH_VEINS[i]));
    }
    if (crossed(DEATH_IMPACT)) {
      // The plunge strikes the pit: the flash, the column thrown up, the
      // four-colour shockwave over the whole floor, dust, the thud.
      const y = h.groundY(wx, wz);
      h.flash(wx, y + 3, wz, 50 * rm, 0.6, 0xffffff);
      h.flash(wx, y + 16, wz, 90 * rm, 1.1, 0xfff0d8);
      for (let i = 0; i < 4; i++)
        P.shockRing(wx, wz, arrivalVeinColor(DEATH_VEINS[i]), 34 + i * 10, 1.0 + i * 0.25, {
          wake: 0.25,
          crest: 0.07,
          strength: 0.8,
        });
      // One faint ring rides out to the rim: a crest only, no broad wake
      // (a pale disc over the whole floor hides the raid: Jose's playtest
      // of the Overload Burst).
      P.shockRing(wx, wz, 0xfff0d0, HEART_ROOM.r, 1.9, { wake: 0.04, crest: 0.05, strength: 0.45 });
      for (let i = 0; i < Math.round(110 * h.density) + 16; i++) {
        const a = h.rand() * Math.PI * 2;
        const upr = h.rand();
        P.puff(wx, y + 1, wz, 1, {
          speed: 22 + h.rand() * 26,
          life: 1.4,
          size: [0.9, 0.14],
          color: i % 5 === 0 ? WHITE : VEIN_RGB[i % 4],
          alpha: 1,
          pool: 'glow',
          dir: [Math.cos(a) * (1 - upr), 0.2 + upr * 1.4, Math.sin(a) * (1 - upr)],
          spread: 0.1,
          drag: 0.7,
        });
      }
      P.puff(wx, y + 0.6, wz, Math.round(50 * h.density) + 8, {
        speed: 20,
        up: 1.5,
        life: 2,
        size: [2.6, 8],
        color: DUST,
        alpha: 0.4,
        drag: 1.3,
        radius: 5,
      });
      h.shakeNear(wx, wz, DEATH_SHAKES.impact.amount, DEATH_SHAKES.impact.reach);
    }
    if (crossed(DEATH_THROB)) {
      // One last slow beat from deep in the pit: it is not over.
      const y = h.groundY(wx, wz);
      h.flash(wx, y + 1, wz, 34 * rm, 1.4, 0xff5a1e);
      P.shockRing(wx, wz, 0xff7a3a, 18, 1.4, { wake: 0.3, crest: 0.1, strength: 0.5 });
      P.puff(wx, y + 0.5, wz, Math.round(30 * h.density) + 6, {
        speed: 1.5,
        up: 4,
        life: 2.2,
        size: [0.6, 0.1],
        color: EMBER,
        alpha: 1,
        pool: 'glow',
        radius: 6,
        drag: 0.5,
      });
    }
  }

  /** The sounds on their beats (only for a scene seen crossing them). */
  private sounds(f: FinalDeathFrame): void {
    const prev = f.prev;
    const t = f.t;
    if (prev < 0 || t <= prev) return;
    const h = this.host;
    for (const snd of DEATH_SOUNDS) {
      if (!(prev < snd.at && t >= snd.at && t - snd.at < 0.5)) continue;
      let x = f.footX;
      let y = f.footY + 4;
      let z = f.footZ;
      if (snd.where === 'crystal') {
        x = f.ox + f.chestX;
        y = f.chestY;
        z = f.oz + f.chestZ;
      } else if (snd.where === 'altar' && snd.vein !== undefined) {
        const p = PATHS[snd.vein];
        x = f.ox + p.from.x;
        z = f.oz + p.from.z;
        y = h.groundY(x, z) + 2;
      } else if (snd.where === 'well') {
        x = f.ox + HEART_ROOM.x;
        z = f.oz + HEART_ROOM.z;
        y = h.groundY(x, z) + 2;
      }
      sfx.playAt(snd.key, x, y, z, {
        gain: snd.gain,
        rate: snd.rate,
        cooldown: 0.05,
        jitter: false,
        priority: true,
      });
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    this.debris.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
