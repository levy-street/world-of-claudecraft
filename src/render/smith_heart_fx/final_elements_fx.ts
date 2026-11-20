// The Masterless Strength's OWN elements' look (plan: final_elements_fx_core.ts;
// Jose's brief of 2026-11-19 (b), design doc 7.5 "Its own elements"), a part
// of FinalKitFx (final_kit_fx.ts owns the root, the particles, the floor
// telegraph and the stars' bolts and rings, and lends them in as the host).
// Read from IWorld through the kit (the objects, the auras, the cues), so
// offline and online look the same:
//   - Elemental Strike on the tank: the element's shell round the body, fire
//     licking up it, frost crystals crusting it, violet forks crawling it or
//     cracked stone plates clinging to it, growing with the stacks and
//     pulsing a warning from the swap's count; Static Charge's arcs leap from
//     the tank to the allies it strikes;
//   - Elemental Fusion: the two quarters' elements swelling in its two fists
//     through the bar, drawn together at its end, a two-coloured burst;
//   - Scalding Steam: thick churning white billows over a pale scald on the
//     floor, drifting with their cloud;
//   - Magma Rift: the mark's molten ring under its player, the eruption, then
//     a lava pool of black crust over the melt, bubbling;
//   - Firestorm: its lane on the floor, then a real WALL of flame sweeping it
//     at the sim's own speed, the floor burnt behind it;
//   - Hailstorm: each stone's small circle filling, the ice ball dropping out
//     of the sky onto it and shattering;
//   - Avalanche: its lanes, then spikes of ice and rock bursting up along
//     each lane behind the front and sinking back;
//   - Storm Spires: dark stone spires rising, their violet veins lighting
//     from the foot as they charge, the links shown on the floor, lightning
//     leaping spire to spire on each discharge;
//   - Mythic's residue: the element left on the floor;
//   - Opposing Elements: on EVERY marked player, seen by everyone on every
//     tier (actionable): the sigil over the head (a flame, a snowflake, a
//     mountain, a lightning bolt) and the body's dress (rising flames, frost
//     crystals and cold mist, orbiting rocks, crawling sparks); the meeting's
//     burst, the clash's explosion. No tether between partners (Jose: no).
// The footprints, the sigils, the shells, the walls, the spires, the spikes and
// the stones draw on every tier; the particles thin with the host's density and
// the shakes go under reduced motion.
//
// Rules (src/render/CLAUDE.md): every geometry and material is built in the
// constructor under the host's root (one gated attach, the kit's); fixed
// pools; no light; no per-frame allocation; every floor piece on the kit's
// rungs (the lanes on `lane`; the fans the kit's own).

import * as THREE from 'three';
import type { SmithHeartVein } from '../../sim/content/smith_heart_layout';
import {
  ELEMENT_TUNING as E,
  ELEMENT_AURAS,
  ELEMENT_CUES,
  elementLaneOf,
  FUSION_COMBOS,
  hailOf,
  polarityOf,
  STRIKE_AURAS,
  spireLinks,
  spireOf,
} from '../../sim/encounters/smith_heart/final_elements_ids';
import { finalZoneOf } from '../../sim/encounters/smith_heart/final_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { fxAnchor } from '../attached_fx_anchor';
import {
  TELEGRAPH_THREAT_COLORS,
  type TelegraphKit,
  type TelegraphLane,
  type TelegraphStyle,
} from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import type { EngineParticles } from '../trash_engine_fx/engine_particles';
import { FINAL_BODY_HEIGHT, finalBodyPoint } from './final_body_core';
import {
  ELEMENT_FX_COLORS as C,
  type ElementObjectKind,
  elementObjectKind,
  flameWall,
  fusionOrbLook,
  hailFall,
  laneFront,
  linkFill,
  orbitPiece,
  ELEMENT_FX_POOLS as P,
  POLARITY_LOOKS,
  STACK_PIP_COLORS,
  sigilLook,
  spikeRise,
  spireGlow,
  stackPip,
  steamPuff,
  strikeAuraLook,
  veinColor,
  veinRgb,
} from './final_elements_fx_core';
import {
  AURA_FRAG,
  BILL_VERT,
  GLOW_FRAG,
  LAVA_FRAG,
  SIGIL_FRAG,
  SOLID_FRAG,
  SOLID_VERT,
  SPIRE_FRAG,
  STEAM_FRAG,
  WALL_FRAG,
  WALL_VERT,
} from './final_elements_glsl';
import { KIT_UV_VERT } from './final_kit_glsl';
import type { FinalElement, FinalTelegraphKind } from './final_telegraph_core';
import type { FinalTelegraphLane, FinalTelegraphs } from './final_telegraphs';
import { fxHash } from './hammer_fx_core';

/** What FinalKitFx lends its elements' painter. */
export interface FinalElementsHost {
  root: THREE.Group;
  uTime: { value: number };
  particles: EngineParticles;
  kit: TelegraphKit;
  groundY: (x: number, z: number) => number;
  rand: () => number;
  density: number;
  reducedMotion: () => boolean;
  shake: (x: number, z: number, amount: number, reach?: number) => void;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  /** The kit's dressed floor fan for `key` this frame (its element paint). */
  foot: (
    key: number,
    kind: FinalTelegraphKind,
    style: TelegraphStyle,
    x: number,
    z: number,
    radius: number,
    fill: number,
    moving: boolean,
  ) => void;
  /** The stars' bolt between two world points, and their floor ring. */
  leap: (
    x: number,
    y: number,
    z: number,
    x2: number,
    y2: number,
    z2: number,
    life?: number,
    jag?: number,
  ) => void;
  wave: (x: number, z: number, radius: number, seconds: number, color: number) => void;
  /** A footprint's warning sound as it first appears. */
  sound: (kind: string, x: number, y: number, z: number) => void;
  laneRung: number;
  /** The lava crust's floor rung (under the fans' glows, over the floor). */
  crustRung: number;
  /** The kit's element telegraphs: the lanes and links dressed in their
   *  element's paint (the fans' char rung). */
  tele: FinalTelegraphs;
  charRung: number;
}

const T = TELEGRAPH_THREAT_COLORS;
const STYLES = {
  steam: { color: T.danger, accent: 0xf4f7fa },
  lava: { color: T.danger, accent: 0xff5a14 },
  magmaMark: { color: T.danger, accent: 0xff7a24 },
  hail: { color: T.danger, accent: 0xc8eaff },
  residue: { color: T.danger, accent: 0xffd0a0 },
  fireLane: { color: T.danger, accent: 0xff7a24 },
  avalancheLane: { color: T.danger, accent: 0xbfe6ff },
  link: { color: T.danger, accent: 0xb07cff },
} as const satisfies Record<string, TelegraphStyle>;

const VEIN_KIND: Readonly<Record<SmithHeartVein, number>> = {
  heat: 0,
  quench: 1,
  breath: 2,
  hammer: 3,
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();
const _a = { x: 0, y: 0, z: 0 };
const _b = { x: 0, y: 0, z: 0 };
const _mid = { x: 0, y: 0, z: 0 };
const _pa = { x: 0, y: 0, z: 0 };
const _pb = { x: 0, y: 0, z: 0 };
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

interface Uni {
  [k: string]: THREE.IUniform;
}

interface LaneSlot {
  d: FinalTelegraphLane;
  lane: TelegraphLane;
  id: number;
  seen: boolean;
}

interface Wall {
  planes: THREE.Mesh[];
  u: Uni;
  id: number;
  seen: boolean;
}

interface Spire {
  mesh: THREE.Mesh;
  u: Uni;
  id: number;
  seen: boolean;
}

interface Cloud {
  billows: THREE.Mesh[];
  u: Uni;
  id: number;
  seen: boolean;
  seed: number;
}

export class FinalElementsFx {
  private clock = 0;
  private dt = 0;
  /** First sight and state change of each object (painter clocks). */
  private readonly born = new Map<number, number>();
  private readonly stateAt = new Map<number, { state: string; at: number }>();
  private readonly seenNow = new Set<number>();
  // ---- the tanks ----
  private readonly shells: { mesh: THREE.Mesh; u: Uni }[] = [];
  private shellUsed = 0;
  private readonly tankPieces: THREE.InstancedMesh;
  private tankPieceUsed = 0;
  /** Searing Burn's column of flame round the tank's body (by tank slot). */
  private readonly burnColumns: { mesh: THREE.Mesh; u: Uni }[] = [];
  /** The stack count's gems orbiting each tank's head. */
  private readonly pips: THREE.InstancedMesh;
  private pipUsed = 0;
  private readonly lastPulse = new Map<number, number>();
  // ---- the marks ----
  private readonly sigils: { mesh: THREE.Mesh; u: Uni }[] = [];
  private sigilUsed = 0;
  private readonly markPieces: THREE.InstancedMesh;
  private markPieceUsed = 0;
  // ---- the fusion ----
  private readonly orbs: { mesh: THREE.Mesh; u: Uni; glow: THREE.Mesh; gu: Uni }[] = [];
  private fusionSeen = false;
  private readonly fusionAt = {
    x: 0,
    y: 0,
    z: 0,
    from: 'heat' as SmithHeartVein,
    to: 'quench' as SmithHeartVein,
  };
  // ---- the combos ----
  private readonly clouds: Cloud[] = [];
  private readonly walls: Wall[] = [];
  private readonly lanes: LaneSlot[] = [];
  private readonly spires: Spire[] = [];
  private readonly hailBalls: THREE.InstancedMesh;
  private hailUsed = 0;
  private readonly spikes: THREE.InstancedMesh;
  /** The lava pools' crust discs (Magma Rift). */
  private readonly crusts: { mesh: THREE.Mesh; u: Uni; id: number; seen: boolean }[] = [];
  private spikeUsed = 0;
  /** Which burn columns were drawn this frame (by tank slot). */
  private readonly burnSeen: boolean[] = [false, false, false];
  /** The spires seen this frame by group: their places in index order. */
  private readonly groups = new Map<
    number,
    { x: number; y: number; z: number; count: number; age: number; fire: boolean }[]
  >();

  constructor(private readonly h: FinalElementsHost) {
    const shader = (
      name: string,
      uniforms: Uni,
      vertexShader: string,
      fragmentShader: string,
      extra: Partial<THREE.ShaderMaterialParameters> = {},
    ) => {
      const m = new THREE.ShaderMaterial({
        name,
        uniforms,
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        ...extra,
      });
      h.materials.push(m);
      return m;
    };
    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, name: string) => {
      const m = new THREE.Mesh(geo, mat);
      m.name = name;
      m.visible = false;
      m.frustumCulled = false;
      h.root.add(m);
      return m;
    };
    const card = new THREE.PlaneGeometry(2, 2);
    const ball = new THREE.SphereGeometry(1, 28, 20);
    h.geometries.push(card, ball);

    // ---- the tanks' shells (Elemental Strike) ----
    for (let i = 0; i < P.tanks; i++) {
      const u: Uni = {
        uTime: h.uTime,
        uKind: { value: 0 },
        uStrength: { value: 0 },
        uFill: { value: 0 },
        uColor: { value: new THREE.Color(C.heat) },
      };
      const m = mesh(
        ball,
        shader('smithHeartFinalStrikeShell', u, KIT_UV_VERT, AURA_FRAG, {
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        }),
        'smithHeartFinalStrikeShell',
      );
      this.shells.push({ mesh: m, u });
    }
    // The instanced solids: crystals, rocks, plates, hailstones, spikes.
    const solid = (name: string, ice: number) =>
      shader(
        name,
        { uTime: h.uTime, uIce: { value: ice }, uAlpha: { value: 1 } },
        SOLID_VERT,
        SOLID_FRAG,
        {
          transparent: false,
          depthWrite: true,
        },
      );
    const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number, name: string) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.name = name;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < n; i++) {
        m.setMatrixAt(i, ZERO);
        m.setColorAt(i, _c.setRGB(1, 1, 1));
      }
      m.visible = false;
      h.root.add(m);
      return m;
    };
    const crystal = new THREE.OctahedronGeometry(1, 0).scale(0.45, 1.1, 0.45);
    const rock = new THREE.DodecahedronGeometry(1, 0);
    const spikeGeo = new THREE.ConeGeometry(0.7, 1, 6, 1).translate(0, 0.5, 0);
    const hailGeo = new THREE.IcosahedronGeometry(1, 1);
    h.geometries.push(crystal, rock, spikeGeo, hailGeo);
    // Searing Burn: a column of flame tongues wrapping the tank (its shape
    // reads where the colour alone would not, in the Heat's own orange).
    const columnGeo = new THREE.CylinderGeometry(1, 0.8, 1, 28, 1, true).translate(0, 0.5, 0);
    h.geometries.push(columnGeo);
    for (let i = 0; i < P.tanks; i++) {
      const u: Uni = {
        uTime: h.uTime,
        uAlpha: { value: 0 },
        uSeed: { value: i * 4.1 },
        uWrap: { value: 1 },
      };
      const m = mesh(
        columnGeo,
        shader('smithHeartFinalBurnColumn', u, WALL_VERT, WALL_FRAG, {
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        }),
        'smithHeartFinalBurnColumn',
      );
      this.burnColumns.push({ mesh: m, u });
    }
    const pipGeo = new THREE.OctahedronGeometry(0.16, 0).scale(1, 1.6, 1);
    h.geometries.push(pipGeo);
    this.pips = instanced(
      pipGeo,
      solid('smithHeartFinalStackPips', 0),
      P.tanks * P.pips,
      'smithHeartFinalStackPips',
    );
    this.tankPieces = instanced(
      crystal,
      solid('smithHeartFinalStrikePieces', 1),
      P.tanks * P.tankPieces,
      'smithHeartFinalStrikePieces',
    );
    this.markPieces = instanced(
      rock,
      solid('smithHeartFinalPolarityPieces', 1),
      P.marks * P.markPieces,
      'smithHeartFinalPolarityPieces',
    );
    this.hailBalls = instanced(
      hailGeo,
      solid('smithHeartFinalHail', 1),
      P.hail,
      'smithHeartFinalHail',
    );
    this.spikes = instanced(
      spikeGeo,
      solid('smithHeartFinalSpikes', 1),
      P.spikeLanes * P.spikesPerLane,
      'smithHeartFinalSpikes',
    );

    // ---- the sigils (Opposing Elements) ----
    for (let i = 0; i < P.marks; i++) {
      const u: Uni = {
        uTime: h.uTime,
        uShape: { value: 0 },
        uPulse: { value: 1 },
        uColor: { value: new THREE.Color(0xffffff) },
      };
      // Over the world (the marks are actionable: never hidden by a body).
      const m = mesh(
        card,
        shader('smithHeartFinalSigil', u, BILL_VERT, SIGIL_FRAG, { depthTest: false }),
        'smithHeartFinalSigil',
      );
      m.renderOrder = 9000;
      this.sigils.push({ mesh: m, u });
    }

    // ---- the fusion's orbs ----
    for (let i = 0; i < 2; i++) {
      const u: Uni = {
        uTime: h.uTime,
        uKind: { value: 0 },
        uStrength: { value: 1 },
        uFill: { value: 1 },
        uColor: { value: new THREE.Color(C.heat) },
      };
      const m = mesh(
        ball,
        shader('smithHeartFinalFusionOrb', u, KIT_UV_VERT, AURA_FRAG, {
          blending: THREE.AdditiveBlending,
        }),
        'smithHeartFinalFusionOrb',
      );
      const gu: Uni = { uColor: { value: new THREE.Color(C.heat) }, uAlpha: { value: 0.6 } };
      // The orb's glow: a soft card in its colour, facing the camera.
      const glow = mesh(
        card,
        shader('smithHeartFinalFusionGlow', gu, BILL_VERT, GLOW_FRAG, {
          blending: THREE.AdditiveBlending,
        }),
        'smithHeartFinalFusionGlow',
      );
      this.orbs.push({ mesh: m, u, glow, gu });
    }

    // ---- the steam's billows ----
    for (let i = 0; i < P.clouds; i++) {
      const u: Uni = {
        uTime: h.uTime,
        uAlpha: { value: 0 },
        uSeed: { value: i * 1.7 },
        uHot: { value: 0.6 },
      };
      const mat = shader('smithHeartFinalSteam', u, BILL_VERT, STEAM_FRAG);
      const billows: THREE.Mesh[] = [];
      for (let k = 0; k < P.billows; k++)
        billows.push(mesh(card, mat, 'smithHeartFinalSteamBillow'));
      this.clouds.push({ billows, u, id: -1, seen: false, seed: i * 0.37 });
    }

    // ---- the flame walls ----
    const wallGeo = new THREE.PlaneGeometry(1, 1, 1, 1).translate(0, 0.5, 0);
    h.geometries.push(wallGeo);
    for (let i = 0; i < P.walls; i++) {
      const u: Uni = {
        uTime: h.uTime,
        uAlpha: { value: 0 },
        uSeed: { value: i * 5.3 },
        uWrap: { value: 0 },
      };
      const mat = shader('smithHeartFinalFlameWall', u, WALL_VERT, WALL_FRAG, {
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const planes: THREE.Mesh[] = [];
      // Three across the lane (its face, read from along it) and three along
      // it (its flanks, read from the side): a wall of flame from any camera.
      for (let k = 0; k < 6; k++) planes.push(mesh(wallGeo, mat, 'smithHeartFinalFlameWall'));
      this.walls.push({ planes, u, id: -1, seen: false });
    }

    // ---- the lanes: Firestorm's, Avalanche's, the spires' links ----
    // Each in its element's paint (never the plain threat orange): the
    // Firestorm's molten basalt, the Avalanche's frost, the links' storm.
    const lanePool: [FinalElement, number][] = [
      ['fire', P.walls],
      ['frost', P.spikeLanes],
      ['storm', P.spires + 2],
    ];
    for (const [el, n] of lanePool)
      for (let i = 0; i < n; i++) {
        const d = h.tele.lane(el, h.charRung);
        this.lanes.push({ d, lane: d.lane, id: -1, seen: false });
      }
    for (const l of this.lanes) l.lane.group.visible = false;

    // ---- the lava pools' crust ----
    const disc = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
    h.geometries.push(disc);
    for (let i = 0; i < P.lava; i++) {
      const u: Uni = { uTime: h.uTime, uAlpha: { value: 0 }, uSeed: { value: i * 1.9 } };
      const m = mesh(
        disc,
        shader('smithHeartFinalLavaCrust', u, KIT_UV_VERT, LAVA_FRAG),
        'smithHeartFinalLavaCrust',
      );
      m.renderOrder = floorVfxRenderOrder('encounter', h.crustRung);
      this.crusts.push({ mesh: m, u, id: -1, seen: false });
    }

    // ---- the Storm Spires ----
    const spireGeo = spireGeometry();
    h.geometries.push(spireGeo);
    for (let i = 0; i < P.spires; i++) {
      const u: Uni = {
        uTime: h.uTime,
        uVeins: { value: 0 },
        uFire: { value: 0 },
        uSeed: { value: i * 2.3 },
        uVein: { value: new THREE.Color(C.spireVein) },
      };
      const m = mesh(
        spireGeo,
        shader('smithHeartFinalSpire', u, KIT_UV_VERT, SPIRE_FRAG, {
          transparent: false,
          depthWrite: true,
        }),
        'smithHeartFinalSpire',
      );
      this.spires.push({ mesh: m, u, id: -1, seen: false });
    }
  }

  // ---- the frame -------------------------------------------------------------------

  begin(clock: number, dt: number): void {
    this.clock = clock;
    this.dt = dt;
    this.seenNow.clear();
    this.shellUsed = 0;
    this.tankPieceUsed = 0;
    this.pipUsed = 0;
    this.sigilUsed = 0;
    this.markPieceUsed = 0;
    this.hailUsed = 0;
    this.spikeUsed = 0;
    this.fusionSeen = false;
    this.groups.clear();
    for (const c of this.clouds) c.seen = false;
    for (const w of this.walls) w.seen = false;
    for (const l of this.lanes) l.seen = false;
    for (const s of this.spires) s.seen = false;
    for (const c of this.crusts) c.seen = false;
  }

  /** Is `templateId` one of the elements' objects? */
  kindOf(templateId: string): ElementObjectKind | null {
    return elementObjectKind(templateId);
  }

  /** One of the elements' objects this frame. */
  seeObject(e: Entity, kind: ElementObjectKind): void {
    const H = this.h;
    this.seenNow.add(e.id);
    let born = this.born.get(e.id);
    if (born === undefined) {
      born = this.clock;
      this.born.set(e.id, born);
      H.sound(kind, e.pos.x, H.groundY(e.pos.x, e.pos.z), e.pos.z);
    }
    const st = this.stateAt.get(e.id);
    if (!st || st.state !== kind) this.stateAt.set(e.id, { state: kind, at: this.clock });
    const since = this.clock - (this.stateAt.get(e.id)?.at ?? this.clock);
    const age = this.clock - born;
    const at = fxAnchor(e);
    const r = e.scale || 1;
    switch (kind) {
      case 'steamWarn':
      case 'steam':
        this.paintSteam(
          e,
          at.x,
          at.z,
          r,
          kind === 'steam' ? 1 : Math.min(1, age / E.steamWarn),
          kind === 'steam',
        );
        break;
      case 'lava': {
        H.foot(e.id, 'lava', STYLES.lava, at.x, at.z, r, 1, false);
        let c = this.crusts.find((k) => k.id === e.id);
        if (!c) {
          c = this.crusts.find((k) => k.id === -1 && !k.seen);
          if (c) c.id = e.id;
        }
        if (c) {
          c.seen = true;
          c.mesh.position.set(at.x, H.groundY(at.x, at.z) + 0.05, at.z);
          c.mesh.scale.setScalar(r * 0.97);
          c.u.uAlpha.value = Math.min(1, age / 0.4);
          c.mesh.visible = true;
        }
        this.bubble(at.x, at.z, r, C.fireRgb, 1.4);
        if (H.rand() < 3 * this.dt * H.density)
          H.particles.puff(at.x, H.groundY(at.x, at.z) + 0.4, at.z, 1, {
            speed: 0.5,
            up: 1.8,
            life: 2.2,
            size: [1.2, 3.2],
            color: [0.12, 0.09, 0.08],
            alpha: 0.4,
            pool: 'smoke',
            radius: r * 0.6,
          });
        break;
      }
      case 'residueFire':
      case 'residueFrost':
      case 'residueStorm':
      case 'residueStone': {
        const tk = kind as FinalTelegraphKind;
        H.foot(e.id, tk, STYLES.residue, at.x, at.z, r, 0.55, false);
        const rgb =
          kind === 'residueFire'
            ? C.fireRgb
            : kind === 'residueFrost'
              ? C.frostRgb
              : kind === 'residueStorm'
                ? C.stormRgb
                : C.stoneRgb;
        this.bubble(at.x, at.z, r, rgb, 0.35);
        break;
      }
      case 'fireWarn':
      case 'fireBurn':
        this.paintFireLane(e, kind === 'fireBurn', age, since);
        break;
      case 'avalancheWarn':
      case 'avalancheRun':
        this.paintAvalanche(e, kind === 'avalancheRun', age, since);
        break;
      case 'hail':
        this.paintHail(e, at.x, at.z, r, age);
        break;
      case 'spireCharge':
      case 'spireFire':
        this.paintSpire(e, kind === 'spireFire', age, since);
        break;
    }
  }

  /** An orb's place: from its fist toward the middle by `draw` (into `out`). */
  private orbPos(
    e: { x: number; y: number; z: number },
    draw: number,
    height: number,
    out: { x: number; y: number; z: number },
  ): { x: number; y: number; z: number } {
    const mid = _mid;
    out.x = e.x + (mid.x - e.x) * draw;
    out.y = e.y + height * 0.05 + (mid.y - e.y) * draw;
    out.z = e.z + (mid.z - e.z) * draw;
    return out;
  }

  /** One player this frame: their strike stacks, their polarity, their
   *  Magma Rift mark. */
  seePlayer(p: Entity): void {
    if (p.dead) return;
    for (const a of p.auras) {
      if (a.id === ELEMENT_AURAS.polarity)
        this.paintPolarity(p, a.value ?? 0, a.remaining, a.duration);
      else if (a.id === ELEMENT_AURAS.magmaMark) {
        const at = fxAnchor(p);
        const fill = a.duration > 0 ? 1 - a.remaining / a.duration : 1;
        this.h.foot(
          -(p.id * 8 + 6),
          'magmaMark',
          STYLES.magmaMark,
          at.x,
          at.z,
          E.magmaR,
          fill,
          true,
        );
        if (this.h.rand() < 0.7 * this.h.density) this.bubble(at.x, at.z, 1.2, C.emberRgb, 1);
      }
    }
    for (const v of ['heat', 'quench', 'breath', 'hammer'] as const) {
      const a = p.auras.find((x) => x.id === STRIKE_AURAS[v]);
      if (a) {
        this.paintStrike(p, v, Math.max(1, a.stacks ?? 1));
        break;
      }
    }
  }

  /** The boss this frame: Elemental Fusion in its fists. */
  seeBoss(boss: Entity): void {
    if (boss.dead) return;
    const a = boss.auras.find((x) => x.id === ELEMENT_AURAS.fusion);
    if (!a) return;
    const from = finalZoneOf(a.value ?? 0);
    const to = finalZoneOf(a.value2 ?? 0);
    if (from === 'ring' || to === 'ring') return;
    this.fusionSeen = true;
    const fill =
      boss.castTotal > 0
        ? 1 - boss.castRemaining / boss.castTotal
        : a.duration > 0
          ? 1 - a.remaining / a.duration
          : 1;
    const look = fusionOrbLook(fill);
    const at = fxAnchor(boss);
    const y = this.h.groundY(at.x, at.z);
    const height = FINAL_BODY_HEIGHT * (boss.scale || 3.6);
    const facing = boss.facing;
    finalBodyPoint('fistL', at.x, y, at.z, facing, height, _a);
    finalBodyPoint('fistR', at.x, y, at.z, facing, height, _b);
    // Held out and up, drawn in together at the end.
    const mid = _mid;
    mid.x = (_a.x + _b.x) / 2;
    mid.y = Math.max(_a.y, _b.y) + height * 0.12;
    mid.z = (_a.z + _b.z) / 2;
    this.fusionAt.x = mid.x;
    this.fusionAt.y = mid.y;
    this.fusionAt.z = mid.z;
    this.fusionAt.from = from;
    this.fusionAt.to = to;
    // The two elements reaching for each other: lightning between the orbs,
    // quicker as the bar runs out.
    if (this.h.rand() < (2 + 10 * fill) * this.dt) {
      const pa = this.orbPos(_a, look.draw, height, _pa);
      const pb = this.orbPos(_b, look.draw, height, _pb);
      this.h.leap(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z, 0.18, 0.9 + 1.2 * (1 - look.draw));
    }
    for (let i = 0; i < 2; i++) {
      const o = this.orbs[i];
      const vein = i === 0 ? from : to;
      const op = this.orbPos(i === 0 ? _a : _b, look.draw, height, _pa);
      const px = op.x;
      const py = op.y;
      const pz = op.z;
      const s = look.size * (height / 20);
      o.mesh.position.set(px, py, pz);
      o.mesh.scale.setScalar(s);
      o.mesh.rotation.y = this.clock * (i === 0 ? 1.4 : -1.4);
      o.u.uKind.value = VEIN_KIND[vein];
      o.u.uStrength.value = look.glow;
      (o.u.uColor.value as THREE.Color).setHex(veinColor(vein));
      o.mesh.visible = true;
      o.glow.position.set(px, py, pz);
      o.glow.scale.setScalar(s * 3.4);
      (o.gu.uColor.value as THREE.Color).setHex(veinColor(vein));
      o.gu.uAlpha.value = 0.6 + 0.6 * look.glow;
      o.glow.visible = true;
      // Its element streaming off it.
      if (this.h.rand() < (0.6 + fill) * this.h.density)
        this.h.particles.puff(px, py, pz, 1, {
          speed: 1.5 + 2 * fill,
          up: vein === 'heat' ? 3 : 0.5,
          life: 0.6,
          size: [0.7, 0.15],
          color: veinRgb(vein),
          alpha: 1,
          pool: vein === 'heat' ? 'pyre' : 'glow',
          radius: s * 0.8,
          drag: 1,
        });
    }
  }

  end(): void {
    // Hide what was not seen; forget objects gone.
    for (const id of this.born.keys())
      if (!this.seenNow.has(id)) {
        this.born.delete(id);
        this.stateAt.delete(id);
      }
    for (const c of this.clouds)
      if (!c.seen) {
        c.id = -1;
        for (const b of c.billows) b.visible = false;
      }
    for (const w of this.walls)
      if (!w.seen) {
        w.id = -1;
        for (const p of w.planes) p.visible = false;
      }
    this.paintLinks();
    for (const l of this.lanes)
      if (!l.seen) {
        l.id = -1;
        l.lane.group.visible = false;
      }
    for (const s of this.spires)
      if (!s.seen) {
        s.id = -1;
        s.mesh.visible = false;
      }
    for (const c of this.crusts)
      if (!c.seen) {
        c.id = -1;
        c.mesh.visible = false;
      }
    for (let i = this.shellUsed; i < this.shells.length; i++) this.shells[i].mesh.visible = false;
    for (let i = 0; i < this.burnColumns.length; i++)
      if (!this.burnSeen[i]) this.burnColumns[i].mesh.visible = false;
    this.burnSeen.fill(false);
    for (let i = this.sigilUsed; i < this.sigils.length; i++) this.sigils[i].mesh.visible = false;
    if (!this.fusionSeen)
      for (const o of this.orbs) {
        o.mesh.visible = false;
        o.glow.visible = false;
      }
    this.flush(this.tankPieces, this.tankPieceUsed);
    this.flush(this.pips, this.pipUsed);
    this.flush(this.markPieces, this.markPieceUsed);
    this.flush(this.hailBalls, this.hailUsed);
    this.flush(this.spikes, this.spikeUsed);
  }

  private flush(m: THREE.InstancedMesh, used: number): void {
    const was = (m.userData.used as number | undefined) ?? 0;
    for (let i = used; i < was; i++) m.setMatrixAt(i, ZERO);
    m.userData.used = used;
    if (used > 0 || was > 0) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    m.visible = used > 0;
  }

  private piece(
    m: THREE.InstancedMesh,
    i: number,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    rx: number,
    ry: number,
    rz: number,
    color: number,
  ): void {
    _q.setFromEuler(_e.set(rx, ry, rz));
    m.setMatrixAt(i, _m.compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz)));
    m.setColorAt(i, _c.setHex(color));
  }

  // ---- Elemental Strike ------------------------------------------------------------

  private paintStrike(p: Entity, vein: SmithHeartVein, stacks: number): void {
    const H = this.h;
    const look = strikeAuraLook(stacks);
    const at = fxAnchor(p);
    const y = H.groundY(at.x, at.z);
    const sh = this.shells[this.shellUsed++];
    if (sh) {
      sh.mesh.position.set(at.x, y + 1.15, at.z);
      sh.mesh.scale.set(look.radius, 1.25 + look.radius * 0.45, look.radius);
      sh.u.uKind.value = VEIN_KIND[vein];
      sh.u.uStrength.value =
        look.strength + (look.danger ? 0.25 * (0.5 + 0.5 * Math.sin(this.clock * 7)) : 0);
      (sh.u.uColor.value as THREE.Color).setHex(veinColor(vein));
      sh.mesh.visible = true;
    }
    const rgb = veinRgb(vein);
    const slot = this.shellUsed - 1;
    // The count, as gems orbiting over the head: one per stack.
    for (let k = 0; k < stacks && k < P.pips; k++) {
      const pp = stackPip(this.clock, k, Math.min(stacks, P.pips));
      const i = slot * P.pips + k;
      this.piece(
        this.pips,
        i,
        at.x + Math.cos(pp.angle) * 0.7,
        y + pp.height,
        at.z + Math.sin(pp.angle) * 0.7,
        1,
        1,
        1,
        0,
        pp.angle,
        0,
        STACK_PIP_COLORS[vein],
      );
      this.pipUsed = Math.max(this.pipUsed, i + 1);
    }
    // Searing Burn: the flame column round the body, taller per stack, its
    // dark smoke plume over the head (contrast against the Heat's orange).
    if (vein === 'heat' && slot >= 0 && slot < this.burnColumns.length) {
      const col = this.burnColumns[slot];
      col.mesh.position.set(at.x, y - 0.1, at.z);
      col.mesh.scale.set(look.radius * 0.95, 2.3 + 0.42 * Math.min(stacks, 8), look.radius * 0.95);
      col.u.uAlpha.value = 0.65 + 0.35 * look.strength;
      col.mesh.visible = true;
      this.burnSeen[slot] = true;
      if (H.rand() < (4 + 3 * stacks) * this.dt * H.density)
        H.particles.puff(at.x, y + 2.6 + 0.3 * stacks, at.z, 1, {
          speed: 0.6,
          up: 2.4,
          life: 1.8,
          size: [1.0, 2.8],
          color: [0.09, 0.07, 0.06],
          alpha: 0.6,
          pool: 'smoke',
          radius: 0.4,
        });
    }
    // The pieces it wears: frost crystals crusting it, stone plates clinging.
    if (vein === 'quench' || vein === 'hammer') {
      const base = (this.shellUsed - 1) * P.tankPieces;
      for (let k = 0; k < look.pieces && k < P.tankPieces; k++) {
        const a = (k / look.pieces) * Math.PI * 2 + fxHash(p.id, k) * 0.8;
        const hgt = 0.25 + 1.7 * fxHash(p.id + 7, k);
        const rr = 0.55 + 0.15 * fxHash(p.id + 3, k);
        const s =
          vein === 'quench' ? 0.38 + 0.12 * fxHash(p.id, k + 9) : 0.28 + 0.1 * fxHash(p.id, k + 9);
        const tilt = (fxHash(p.id, k + 4) - 0.5) * 1.2;
        this.piece(
          this.tankPieces,
          base + k,
          at.x + Math.cos(a) * rr,
          y + hgt,
          at.z + Math.sin(a) * rr,
          vein === 'quench' ? s : s * 1.2,
          vein === 'quench' ? s : s * 0.55,
          vein === 'quench' ? s : s * 1.0,
          tilt,
          a,
          tilt * 0.5,
          vein === 'quench' ? 0x9fdcff : 0x6a5236,
        );
      }
      this.tankPieceUsed = Math.max(this.tankPieceUsed, base + look.pieces);
    }
    // The element rising off it, more with each stack.
    const n = Math.round(look.rate * this.dt * H.density + H.rand() * 0.6);
    for (let i = 0; i < n; i++) {
      const a = H.rand() * Math.PI * 2;
      const rr = look.radius * (0.5 + 0.5 * H.rand());
      const px = at.x + Math.cos(a) * rr;
      const pz = at.z + Math.sin(a) * rr;
      if (vein === 'heat')
        H.particles.puff(px, y + 0.2 + H.rand() * 0.6, pz, 1, {
          speed: 0.6,
          up: 3 + H.rand() * 2,
          life: 0.7,
          size: [1.2, 0.3],
          color: C.fireRgb,
          alpha: 1,
          pool: 'pyre',
        });
      else if (vein === 'quench')
        H.particles.puff(px, y + 0.3 + H.rand() * 1.5, pz, 1, {
          speed: 0.4,
          up: -0.3,
          life: 1.3,
          size: [0.9, 1.6],
          color: [0.82, 0.92, 1.0],
          alpha: 0.35,
          drag: 1.5,
        });
      else if (vein === 'breath')
        H.particles.puff(px, y + 0.4 + H.rand() * 1.8, pz, 1, {
          speed: 4,
          up: 1,
          life: 0.25,
          size: [0.35, 0.05],
          color: rgb,
          alpha: 1,
          pool: 'glow',
          drag: 2,
        });
      else
        H.particles.puff(px, y + 0.4 + H.rand() * 1.2, pz, 1, {
          speed: 0.8,
          up: -1,
          life: 0.9,
          size: [0.5, 0.9],
          color: [0.5, 0.42, 0.32],
          alpha: 0.5,
          gravity: 4,
        });
    }
    // Static Charge's crawl: short forks over the body from its third stack.
    if (vein === 'breath' && stacks >= E.arcFrom && H.rand() < 6 * this.dt) {
      const a = H.rand() * Math.PI * 2;
      H.leap(
        at.x,
        y + 0.4 + H.rand(),
        at.z,
        at.x + Math.cos(a) * 0.8,
        y + 1.2 + H.rand(),
        at.z + Math.sin(a) * 0.8,
        0.12,
        0.25,
      );
    }
    // From the swap's count: its warning beat on the floor every second.
    if (look.danger) {
      const last = this.lastPulse.get(p.id) ?? -9;
      if (this.clock - last >= 1) {
        this.lastPulse.set(p.id, this.clock);
        H.particles.shockRing(at.x, at.z, veinColor(vein), 2.4, 0.5);
      }
    }
  }

  // ---- Opposing Elements -----------------------------------------------------------

  private paintPolarity(p: Entity, code: number, left: number, total: number): void {
    const H = this.h;
    const pol = polarityOf(code);
    const look = POLARITY_LOOKS[pol];
    const at = fxAnchor(p);
    const y = H.groundY(at.x, at.z);
    const sg = this.sigils[this.sigilUsed++];
    if (sg) {
      const s = sigilLook(this.clock, left, total, H.reducedMotion());
      sg.mesh.position.set(at.x, y + s.lift, at.z);
      sg.mesh.scale.setScalar(s.size * 0.8);
      sg.u.uShape.value = look.shape;
      sg.u.uPulse.value = s.pulse;
      (sg.u.uColor.value as THREE.Color).setHex(look.color);
      sg.mesh.visible = true;
    }
    const base = (this.sigilUsed - 1) * P.markPieces;
    if (look.body === 'crystals' || look.body === 'rocks') {
      for (let k = 0; k < P.markPieces; k++) {
        const o = orbitPiece(this.clock, k, P.markPieces, look.body === 'rocks' ? 1.3 : 0.7);
        const s = look.body === 'rocks' ? o.size : o.size * 0.9;
        this.piece(
          this.markPieces,
          base + k,
          at.x + Math.cos(o.angle) * o.radius,
          y + o.height,
          at.z + Math.sin(o.angle) * o.radius,
          s,
          look.body === 'crystals' ? s * 1.8 : s,
          s,
          this.clock * 1.3 + k,
          o.angle,
          k * 0.7,
          look.body === 'crystals' ? 0x9fe0ff : 0x8a6430,
        );
      }
      this.markPieceUsed = Math.max(this.markPieceUsed, base + P.markPieces);
    }
    const n = Math.round(14 * this.dt * H.density + H.rand() * 0.5);
    for (let i = 0; i < n; i++) {
      const a = H.rand() * Math.PI * 2;
      const rr = 0.35 + 0.45 * H.rand();
      const px = at.x + Math.cos(a) * rr;
      const pz = at.z + Math.sin(a) * rr;
      if (look.body === 'flames')
        H.particles.puff(px, y + 0.15, pz, 1, {
          speed: 0.5,
          up: 3.5 + H.rand() * 2,
          life: 0.6,
          size: [1.0, 0.25],
          color: look.rgb,
          alpha: 1,
          pool: 'pyre',
        });
      else if (look.body === 'crystals')
        H.particles.puff(px, y + 0.2 + H.rand() * 0.6, pz, 1, {
          speed: 0.3,
          up: 0.2,
          life: 1.4,
          size: [0.8, 1.5],
          color: [0.78, 0.9, 1.0],
          alpha: 0.4,
          drag: 1.5,
        });
      else if (look.body === 'rocks')
        H.particles.puff(px, y + 0.1, pz, 1, {
          speed: 0.6,
          up: 0.6,
          life: 0.9,
          size: [0.6, 1.1],
          color: [0.55, 0.45, 0.3],
          alpha: 0.4,
          drag: 1.2,
        });
      else
        H.particles.puff(px, y + 0.3 + H.rand() * 1.7, pz, 1, {
          speed: 3.5,
          up: 0.8,
          life: 0.22,
          size: [0.32, 0.05],
          color: look.rgb,
          alpha: 1,
          pool: 'glow',
          drag: 2,
        });
    }
    if (look.body === 'sparks' && H.rand() < 5 * this.dt) {
      const a = H.rand() * Math.PI * 2;
      H.leap(
        at.x,
        y + 0.3 + H.rand() * 1.4,
        at.z,
        at.x + Math.cos(a) * 0.7,
        y + 0.6 + H.rand() * 1.4,
        at.z + Math.sin(a) * 0.7,
        0.12,
        0.25,
      );
    }
  }

  // ---- the combos ------------------------------------------------------------------

  private paintSteam(
    e: Entity,
    x: number,
    z: number,
    r: number,
    fill: number,
    live: boolean,
  ): void {
    const H = this.h;
    H.foot(e.id, 'steam', STYLES.steam, x, z, r, fill, true);
    let c = this.clouds.find((k) => k.id === e.id);
    if (!c) {
      c = this.clouds.find((k) => k.id === -1 && !k.seen);
      if (!c) return;
      c.id = e.id;
    }
    c.seen = true;
    const y = H.groundY(x, z);
    c.u.uAlpha.value = live ? 0.78 : 0.15 + 0.45 * fill;
    for (let k = 0; k < c.billows.length; k++) {
      const b = steamPuff(this.clock, k, c.billows.length, r, c.seed);
      const grow = live ? 1 : 0.4 + 0.6 * fill;
      const size = b.size * (0.55 + 0.45 * grow);
      // Never cut by the floor: a billow's foot stays over it.
      c.billows[k].position.set(x + b.x, y + Math.max(b.y * grow, size * 1.0), z + b.z);
      c.billows[k].scale.setScalar(size);
      c.billows[k].visible = true;
    }
    // Steam boiling up off the scald, thick while it is live.
    const n = Math.round((live ? 26 : 8) * this.dt * H.density + H.rand() * 0.7);
    for (let i = 0; i < n; i++)
      // Born a body's height up so no puff is ever cut by the floor.
      H.particles.puff(x + (H.rand() - 0.5) * r * 1.5, y + 2.6, z + (H.rand() - 0.5) * r * 1.5, 1, {
        speed: 0.6,
        up: 2.2 + H.rand() * 1.5,
        life: 2.6,
        size: [1.8, 4.6],
        color: C.steamRgb,
        alpha: live ? 0.7 : 0.4,
        drag: 0.5,
      });
  }

  private paintFireLane(e: Entity, burn: boolean, age: number, since: number): void {
    const H = this.h;
    const info = elementLaneOf('sh_final_firestorm_', e.templateId);
    if (!info) return;
    const at = fxAnchor(e);
    const dx = Math.sin(e.facing);
    const dz = Math.cos(e.facing);
    const sx = at.x - dx * info.length * 0.5;
    const sz = at.z - dz * info.length * 0.5;
    const lane = this.laneFor(e.id, 'fireLane');
    const run = info.length / E.fireSpeed;
    const front = burn ? laneFront(since, info.length, run) : 0;
    if (lane) {
      H.kit.drapeLane(
        lane.lane,
        H.groundY,
        sx,
        H.groundY(sx, sz),
        sz,
        e.facing,
        info.length,
        info.half,
        STYLES.fireLane,
      );
      H.kit.paintLane(lane.lane, {
        fill: burn ? 1 : Math.min(1, age / E.fireWarn),
        clock: this.clock,
        range: info.length,
      });
      lane.lane.group.visible = true;
    }
    if (!burn) return;
    let w = this.walls.find((k) => k.id === e.id);
    if (!w) {
      w = this.walls.find((k) => k.id === -1 && !k.seen);
      if (!w) return;
      w.id = e.id;
    }
    w.seen = true;
    const fw = flameWall(since);
    w.u.uAlpha.value = front >= info.length - 0.01 ? Math.max(0, 1 - (since - run) * 4) : fw.alpha;
    // Three planes across the lane a stride apart (the face) and three along
    // it behind the front (the flanks and the heart): a wall with depth that
    // reads from any camera.
    const depth = 6;
    for (let k = 0; k < w.planes.length; k++) {
      const pl = w.planes[k];
      const across = k < 3;
      const off = across ? front - k * 1.6 : front - depth / 2;
      const lateral = across ? 0 : (k - 4) * info.half * 0.85;
      const px = sx + dx * Math.max(0, off) + dz * lateral;
      const pz = sz + dz * Math.max(0, off) - dx * lateral;
      pl.position.set(px, H.groundY(px, pz) - 0.2, pz);
      pl.rotation.set(0, across ? e.facing : e.facing + Math.PI / 2, 0);
      const hgt = fw.height * (across ? 1 - k * 0.12 : k === 4 ? 1.05 : 0.85);
      pl.scale.set(across ? info.half * 2.2 : Math.min(depth, Math.max(0.5, front)), hgt, 1);
      pl.visible = off > 0 || (!across && front > 0.5);
    }
    // The fire it drags along and the burnt floor behind.
    const n = Math.round(60 * this.dt * H.density + H.rand());
    const px = sx + dx * front;
    const pz = sz + dz * front;
    const py = H.groundY(px, pz);
    for (let i = 0; i < n; i++) {
      const side = (H.rand() * 2 - 1) * info.half;
      H.particles.puff(px + dz * side, py + 0.3, pz - dx * side, 1, {
        speed: 1.5,
        up: 6 + H.rand() * 5,
        life: 0.8,
        size: [2.2, 0.6],
        color: H.rand() < 0.3 ? C.fireCoreRgb : C.fireRgb,
        alpha: 1,
        pool: 'pyre',
        dir: [dx, 0.5, dz],
        spread: 0.4,
      });
    }
    if (H.rand() < 20 * this.dt * H.density)
      H.particles.puff(px, py + 6, pz, 1, {
        speed: 1,
        up: 4,
        life: 2,
        size: [3, 6],
        color: [0.12, 0.1, 0.09],
        alpha: 0.45,
        pool: 'smoke',
      });
  }

  private paintAvalanche(e: Entity, run: boolean, age: number, since: number): void {
    const H = this.h;
    const info = elementLaneOf('sh_final_avalanche_', e.templateId);
    if (!info) return;
    const at = fxAnchor(e);
    const dx = Math.sin(e.facing);
    const dz = Math.cos(e.facing);
    const sx = at.x - dx * info.length * 0.5;
    const sz = at.z - dz * info.length * 0.5;
    const lane = this.laneFor(e.id, 'avalancheLane');
    if (lane) {
      H.kit.drapeLane(
        lane.lane,
        H.groundY,
        sx,
        H.groundY(sx, sz),
        sz,
        e.facing,
        info.length,
        info.half,
        STYLES.avalancheLane,
      );
      H.kit.paintLane(lane.lane, {
        fill: run ? 1 : Math.min(1, age / E.avalancheWarn),
        clock: this.clock,
        range: info.length,
      });
      lane.lane.group.visible = true;
    }
    if (!run) {
      // The ground groaning: frost and grit along the lane.
      if (H.rand() < 8 * this.dt * H.density) {
        const t = H.rand() * info.length;
        H.particles.puff(sx + dx * t, H.groundY(sx + dx * t, sz + dz * t) + 0.2, sz + dz * t, 1, {
          speed: 0.6,
          up: 1.5,
          life: 0.8,
          size: [0.7, 1.2],
          color: [0.8, 0.88, 0.95],
          alpha: 0.4,
        });
      }
      return;
    }
    const front = laneFront(since, info.length, E.avalancheRun);
    const speed = info.length / E.avalancheRun;
    const n = P.spikesPerLane;
    for (let k = 0; k < n; k++) {
      const d = ((k + 0.5) / n) * info.length;
      const rise = spikeRise(d, front, since - d / speed);
      if (rise <= 0.01) continue;
      const i = this.spikeUsed;
      if (i >= P.spikeLanes * P.spikesPerLane) break;
      const side = (fxHash(e.id, k) - 0.5) * info.half * 1.1;
      const px = sx + dx * d + dz * side;
      const pz = sz + dz * d - dx * side;
      const ice = k % 2 === 0;
      const hgt = (3.4 + 2.2 * fxHash(e.id, k + 3)) * rise;
      const lean = (fxHash(e.id, k + 5) - 0.5) * 0.5;
      this.piece(
        this.spikes,
        i,
        px,
        H.groundY(px, pz) - 0.3,
        pz,
        ice ? 1.35 : 1.7,
        hgt,
        ice ? 1.35 : 1.7,
        lean,
        fxHash(e.id, k + 7) * 6,
        -lean,
        ice ? 0xa8dcff : 0x6b5a48,
      );
      this.spikeUsed++;
      // The burst as it breaks the floor.
      if (since - d / speed < this.dt * 1.5)
        H.particles.puff(px, H.groundY(px, pz) + 0.3, pz, Math.round(5 * H.density) + 1, {
          speed: 3,
          up: 5,
          life: 0.7,
          size: [0.45, 0.15],
          color: ice ? C.frostRgb : [0.55, 0.45, 0.35],
          alpha: 1,
          pool: ice ? 'glow' : undefined,
          gravity: 14,
        });
    }
  }

  private paintHail(e: Entity, x: number, z: number, r: number, age: number): void {
    const H = this.h;
    const warn = hailOf(e.templateId) ?? E.hailWarn;
    H.foot(e.id, 'hail', STYLES.hail, x, z, r, Math.min(1, age / Math.max(0.1, warn)), false);
    const f = hailFall(warn - age, warn);
    if (!f.shown || this.hailUsed >= P.hail) return;
    const y = H.groundY(x, z) + f.height + 0.6;
    this.piece(
      this.hailBalls,
      this.hailUsed++,
      x,
      y,
      z,
      0.75,
      0.9,
      0.75,
      this.clock * 3 + e.id,
      e.id,
      0,
      0xcdeeff,
    );
    if (H.rand() < 0.8 * H.density)
      H.particles.puff(x, y + 1, z, 1, {
        speed: 0.3,
        up: 6,
        life: 0.4,
        size: [0.5, 0.1],
        color: C.frostRgb,
        alpha: 0.8,
        pool: 'glow',
      });
  }

  private paintSpire(e: Entity, fire: boolean, age: number, since: number): void {
    const H = this.h;
    const info = spireOf(e.templateId);
    if (!info) return;
    let s = this.spires.find((k) => k.id === e.id);
    if (!s) {
      s = this.spires.find((k) => k.id === -1 && !k.seen);
      if (!s) return;
      s.id = e.id;
    }
    s.seen = true;
    const at = fxAnchor(e);
    const y = H.groundY(at.x, at.z);
    const g = spireGlow(age);
    const scale = 1;
    s.mesh.position.set(at.x, y - 12 * (1 - g.rise), at.z);
    s.mesh.scale.setScalar(scale);
    s.mesh.rotation.y = fxHash(e.id, 1) * Math.PI;
    s.u.uVeins.value = fire ? 1 : g.veins;
    s.u.uFire.value = fire ? Math.max(0, 1 - since * 2.5) : 0;
    s.mesh.visible = true;
    if (age < 0.7 && H.rand() < 30 * this.dt * H.density)
      H.particles.puff(at.x, y + 0.3, at.z, 1, {
        speed: 4,
        up: 3,
        life: 1,
        size: [0.8, 1.8],
        color: [0.35, 0.32, 0.36],
        alpha: 0.6,
        radius: 1.2,
        gravity: 6,
      });
    if (H.rand() < g.veins * 10 * this.dt * H.density)
      H.particles.puff(at.x, y + 2 + H.rand() * 9, at.z, 1, {
        speed: 2.5,
        up: 1,
        life: 0.3,
        size: [0.4, 0.06],
        color: C.stormRgb,
        alpha: 1,
        pool: 'glow',
        radius: 0.9,
      });
    let list = this.groups.get(info.group);
    if (!list) {
      list = [];
      this.groups.set(info.group, list);
    }
    list[info.index] = { x: at.x, y, z: at.z, count: info.count, age, fire };
  }

  /** The spires' links on the floor, from `spireShowAt` into the charge. */
  private paintLinks(): void {
    const H = this.h;
    for (const [group, list] of this.groups) {
      const n = list.length;
      const first = list.find((q) => q);
      if (!first || first.fire || first.count !== n) continue;
      if (!spireGlow(first.age).links) continue;
      for (const [a, b] of spireLinks(n)) {
        const A = list[a];
        const B = list[b];
        if (!A || !B) continue;
        const key = -(100000 + group * 16 + a);
        const lane = this.laneFor(key, 'spireLink');
        if (!lane) continue;
        const len = Math.hypot(B.x - A.x, B.z - A.z);
        const yaw = Math.atan2(B.x - A.x, B.z - A.z);
        H.kit.drapeLane(
          lane.lane,
          H.groundY,
          A.x,
          A.y,
          A.z,
          yaw,
          len,
          E.spireLinkHalf,
          STYLES.link,
        );
        H.kit.paintLane(lane.lane, { fill: linkFill(first.age), clock: this.clock, range: len });
        lane.lane.group.visible = true;
      }
    }
  }

  private laneFor(id: number, kind: 'fireLane' | 'avalancheLane' | 'spireLink'): LaneSlot | null {
    const el: FinalElement =
      kind === 'fireLane' ? 'fire' : kind === 'avalancheLane' ? 'frost' : 'storm';
    let l = this.lanes.find((k) => k.id === id);
    if (!l) {
      l = this.lanes.find((k) => k.id === -1 && !k.seen && k.d.element === el);
      if (!l) return null;
      l.id = id;
    }
    l.seen = true;
    this.h.tele.setLook(l.d, kind);
    return l;
  }

  private bubble(
    x: number,
    z: number,
    r: number,
    rgb: readonly [number, number, number],
    rate: number,
  ): void {
    const H = this.h;
    if (H.rand() > rate * 8 * this.dt * H.density) return;
    const a = H.rand() * Math.PI * 2;
    const rr = H.rand() * r * 0.85;
    const px = x + Math.cos(a) * rr;
    const pz = z + Math.sin(a) * rr;
    H.particles.puff(px, H.groundY(px, pz) + 0.15, pz, 1, {
      speed: 0.4,
      up: 1.6,
      life: 0.7,
      size: [0.5, 0.15],
      color: rgb,
      alpha: 1,
      pool: 'glow',
    });
  }

  // ---- the moments -----------------------------------------------------------------

  /** A cue of its own elements (claimed by the kit). */
  handle(ev: SimEvent, world: IWorld): void {
    if (ev.type !== 'spellfx' && ev.type !== 'spellfxAt') return;
    const H = this.h;
    const fx = H.particles;
    if (ev.type === 'spellfxAt') {
      const x = ev.x;
      const z = ev.z;
      const y = H.groundY(x, z);
      const r = ev.radius ?? 3;
      switch (ev.ability) {
        case ELEMENT_CUES.magma:
          fx.puff(x, y + 0.5, z, Math.round(40 * H.density) + 8, {
            speed: 4,
            up: 13,
            life: 1,
            size: [1.6, 0.4],
            color: C.fireRgb,
            alpha: 1,
            pool: 'pyre',
            radius: r * 0.5,
            gravity: 10,
          });
          fx.puff(x, y + 2, z, Math.round(14 * H.density) + 3, {
            speed: 2,
            up: 5,
            life: 2.4,
            size: [2.5, 6],
            color: [0.1, 0.08, 0.07],
            alpha: 0.6,
            pool: 'smoke',
            radius: r * 0.6,
          });
          fx.shockRing(x, z, C.magma, r * 1.5, 0.55);
          H.wave(x, z, r * 1.8, 0.6, C.magma);
          H.shake(x, z, 0.35, 45);
          break;
        case ELEMENT_CUES.firestorm:
          fx.puff(x, y + 1, z, Math.round(30 * H.density) + 6, {
            speed: 5,
            up: 9,
            life: 0.8,
            size: [2, 0.5],
            color: C.fireCoreRgb,
            alpha: 1,
            pool: 'pyre',
            radius: r,
          });
          H.shake(x, z, 0.3, 60);
          break;
        case ELEMENT_CUES.hail:
          fx.puff(x, y + 0.5, z, Math.round(18 * H.density) + 4, {
            speed: 5,
            up: 5,
            life: 0.7,
            size: [0.5, 0.15],
            color: C.frostRgb,
            alpha: 1,
            pool: 'glow',
            gravity: 16,
          });
          fx.puff(x, y + 0.4, z, Math.round(5 * H.density) + 1, {
            speed: 1.5,
            up: 1,
            life: 1,
            size: [1, 2.2],
            color: [0.85, 0.93, 1],
            alpha: 0.5,
          });
          fx.shockRing(x, z, 0xcdeeff, r * 1.2, 0.35);
          break;
        case ELEMENT_CUES.avalanche:
          fx.puff(x, y + 0.5, z, Math.round(24 * H.density) + 4, {
            speed: 4,
            up: 4,
            life: 1.4,
            size: [1.2, 3],
            color: [0.78, 0.82, 0.86],
            alpha: 0.5,
            radius: r,
          });
          H.shake(x, z, 0.4, 60);
          break;
        case ELEMENT_CUES.balance: {
          // Two opposites meet: the colours swirl into a white-gold burst.
          fx.puff(x, y + 1.2, z, Math.round(36 * H.density) + 8, {
            speed: 5,
            up: 4,
            life: 0.8,
            size: [0.6, 0.1],
            color: [1, 0.95, 0.75],
            alpha: 1,
            pool: 'glow',
            drag: 1.2,
          });
          fx.shockRing(x, z, 0xfff0c0, 6, 0.6);
          H.wave(x, z, 7, 0.7, 0xffe6a0);
          break;
        }
        case ELEMENT_CUES.clash:
          fx.puff(x, y + 1, z, Math.round(60 * H.density) + 12, {
            speed: 9,
            up: 6,
            life: 0.9,
            size: [0.9, 0.2],
            color: [1, 0.35, 0.85],
            alpha: 1,
            pool: 'glow',
            drag: 1,
          });
          fx.puff(x, y + 1, z, Math.round(16 * H.density) + 4, {
            speed: 3,
            up: 3,
            life: 1.6,
            size: [2, 5],
            color: [0.35, 0.12, 0.3],
            alpha: 0.6,
            pool: 'smoke',
          });
          fx.shockRing(x, z, 0xff4fd8, r * 1.4, 0.6);
          H.wave(x, z, r * 1.6, 0.7, 0xff4fd8);
          H.shake(x, z, 0.5, 60);
          break;
        default:
      }
      return;
    }
    const target = world.entities.get(ev.targetId);
    const source = world.entities.get(ev.sourceId);
    switch (ev.ability) {
      case ELEMENT_CUES.staticArc:
      case ELEMENT_CUES.spire: {
        if (!source || !target) return;
        const sa = fxAnchor(source);
        const ta = fxAnchor(target);
        const spire = ev.ability === ELEMENT_CUES.spire;
        const sy = H.groundY(sa.x, sa.z) + (spire ? 9.5 : 1.4);
        const ty = H.groundY(ta.x, ta.z) + (spire ? 9.5 : 1.3);
        H.leap(sa.x, sy, sa.z, ta.x, ty, ta.z, spire ? 0.45 : 0.25, spire ? 1.6 : 0.6);
        if (spire) {
          H.leap(sa.x, sy - 2, sa.z, ta.x, ty - 2, ta.z, 0.35, 2.2);
          // The line on the floor flares under it.
          const n = Math.round(14 * H.density) + 3;
          for (let i = 0; i < n; i++) {
            const t = H.rand();
            const px = sa.x + (ta.x - sa.x) * t;
            const pz = sa.z + (ta.z - sa.z) * t;
            fx.puff(px, H.groundY(px, pz) + 0.3, pz, 1, {
              speed: 3,
              up: 3,
              life: 0.4,
              size: [0.5, 0.08],
              color: C.stormRgb,
              alpha: 1,
              pool: 'glow',
            });
          }
          H.shake(sa.x, sa.z, 0.25, 50);
        } else
          fx.puff(ta.x, ty, ta.z, Math.round(8 * H.density) + 2, {
            speed: 4,
            up: 2,
            life: 0.35,
            size: [0.4, 0.06],
            color: C.stormRgb,
            alpha: 1,
            pool: 'glow',
          });
        return;
      }
      default:
    }
    if (!target) return;
    const ta = fxAnchor(target);
    const ty = H.groundY(ta.x, ta.z);
    switch (ev.ability) {
      case ELEMENT_CUES.strike: {
        const school = ev.school;
        const rgb =
          school === 'fire'
            ? C.fireRgb
            : school === 'frost'
              ? C.frostRgb
              : school === 'nature'
                ? C.stormRgb
                : C.stoneRgb;
        const hex =
          school === 'fire'
            ? C.heat
            : school === 'frost'
              ? C.quench
              : school === 'nature'
                ? C.breath
                : C.hammer;
        fx.puff(ta.x, ty + 1.3, ta.z, Math.round(26 * H.density) + 6, {
          speed: 6,
          up: 3,
          life: 0.55,
          size: [0.7, 0.12],
          color: rgb,
          alpha: 1,
          pool: 'glow',
          drag: 1.2,
        });
        fx.shockRing(ta.x, ta.z, hex, 3.4, 0.4);
        H.shake(ta.x, ta.z, 0.2, 25);
        break;
      }
      case ELEMENT_CUES.frozen:
        fx.puff(ta.x, ty + 1, ta.z, Math.round(30 * H.density) + 6, {
          speed: 3,
          up: 2,
          life: 1,
          size: [0.6, 0.15],
          color: C.frostRgb,
          alpha: 1,
          pool: 'glow',
          gravity: 6,
        });
        fx.shockRing(ta.x, ta.z, C.quench, 3, 0.5);
        break;
      case ELEMENT_CUES.fusionStart:
        fx.shockRing(ta.x, ta.z, 0xffffff, 8, 0.6);
        break;
      case ELEMENT_CUES.fusion: {
        // The two elements meet: a burst in both colours over the boss and
        // their two rings racing out over the floor.
        const fa = this.fusionAt;
        const px = fa.x || ta.x;
        const py = fa.y || ty + 12;
        const pz = fa.z || ta.z;
        for (const v of [fa.from, fa.to]) {
          fx.puff(px, py, pz, Math.round(40 * H.density) + 8, {
            speed: 10,
            up: 2,
            life: 0.9,
            size: [1.1, 0.2],
            color: veinRgb(v),
            alpha: 1,
            pool: v === 'heat' ? 'pyre' : 'glow',
            drag: 1.4,
          });
          H.wave(ta.x, ta.z, 26, 1.1, veinColor(v));
        }
        H.shake(ta.x, ta.z, 0.45, 90);
        break;
      }
      case ELEMENT_CUES.steam:
        fx.puff(ta.x, ty + 0.8, ta.z, Math.round(6 * H.density) + 2, {
          speed: 1,
          up: 2,
          life: 1.2,
          size: [1, 2.4],
          color: C.steamRgb,
          alpha: 0.6,
        });
        break;
      case ELEMENT_CUES.firestormHit:
        fx.puff(ta.x, ty + 1, ta.z, Math.round(16 * H.density) + 4, {
          speed: 3,
          up: 6,
          life: 0.6,
          size: [1.1, 0.3],
          color: C.fireRgb,
          alpha: 1,
          pool: 'pyre',
        });
        break;
      case ELEMENT_CUES.unbalanced:
        fx.puff(ta.x, ty + 1.3, ta.z, Math.round(30 * H.density) + 6, {
          speed: 7,
          up: 4,
          life: 0.7,
          size: [0.8, 0.15],
          color: [1, 0.35, 0.85],
          alpha: 1,
          pool: 'glow',
        });
        fx.shockRing(ta.x, ta.z, 0xff4fd8, 5, 0.5);
        break;
      default:
    }
    void FUSION_COMBOS;
  }

  dispose(): void {
    for (const m of [this.tankPieces, this.pips, this.markPieces, this.hailBalls, this.spikes])
      m.dispose();
  }

  hide(): void {
    this.begin(this.clock, 0);
    this.end();
    this.born.clear();
    this.stateAt.clear();
    this.lastPulse.clear();
  }
}

/** A Storm Spire: a tall dark obelisk with a broken crown, its foot at 0. */
function spireGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const prof: [number, number][] = [
    [1.55, 0],
    [1.4, 0.6],
    [1.15, 1.4],
    [1.05, 4],
    [0.92, 7],
    [0.78, 9.4],
    [0.95, 10.1],
    [0.55, 11.3],
    [0.12, 12.4],
  ];
  for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(pts, 6);
}
