// The Abyssal Maw's Tentacles of the Abyss, drawn from the authoritative hoard
// cues. WHEN things happen and WHERE they hit is the shared sim core
// (src/sim/rift/hoard_tentacles_core.ts) sampled at each cue's own life, so the
// lane on the floor is the lane that hits and the arm on screen is the arm that
// sweeps; how it LOOKS and MOVES is hoard_tentacles_core.ts beside this file.
//
// What is Blender and what is runtime: the segment, the tip, the heaved
// flagstones and the pool are Blender models (docs/design/tentacles/). A
// tentacle is that ONE segment drawn many times along a chain this file bends
// every frame, so every motion (the rise, the sway, the rear and the lash, the
// turning sweep, the death throes) is code, never a baked clip. The floor
// telegraphs and the spray are runtime too. The attackable mob itself is an
// ordinary entity (its root collar, characters/manifest.ts): targeting, the
// nameplate and the health bar are never this file's business.
//
// Performance contract (the siblings' contract): every geometry and material is
// built once here and attached through the scene gate, so nothing compiles
// mid-fight; no dynamic lights; nothing is allocated per frame; every tentacle
// of the set shares the same few instanced draws; the idle frame is a few
// branches. The low tier sheds the spray, the pool and the sweep's wake. It
// NEVER sheds what a player acts on: the warning, the tentacle, the lash's lane
// and the sweep's ring and arm draw on every tier.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../game/ui_effects_profile';
import { TENTACLES } from '../sim/rift/hoard_tentacles_core';
import type { HoardBossCueView } from '../world_api/dungeons';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { attachSceneGroupGated } from './gated_scene_attach';
import { GFX, type GfxTier, surfaceMat } from './gfx';
import { ribbonMaterial, sparkMaterial, strip } from './hoard_fx_materials';
import {
  LINK_STRIDE,
  TENTACLE_LOOK as LOOK,
  linkBasis,
  makeTentaclePose,
  sweepTelegraph,
  type TentacleInput,
  type TentaclePose,
  tentaclePose,
  whipTelegraph,
  writeTentacleChain,
} from './hoard_tentacles_core';
import { setRenderCategory } from './renderer_diagnostics';

export const TENTACLE_ASSET_URL = '/vfx/tentacles/tentacle.glb';
let source: THREE.Group | undefined;
let loading: Promise<THREE.Group | undefined> | undefined;
function loadSource(): Promise<THREE.Group | undefined> {
  loading ??= loadGltf(TENTACLE_ASSET_URL)
    .then((gltf) => {
      source = gltf.scene;
      return source;
    })
    .catch(() => undefined);
  return loading;
}
if (typeof window !== 'undefined') registerDeferredPreload(loadSource);

const RIGS = TENTACLES.maxTentacles;
const LINKS = LOOK.links;
const SPRAY = 320;
const RING_SEGMENTS = 48;
const ARM_SEGMENTS = 6;
const WAKE_SEGMENTS = 12;
/** Any moment well past the rise: what a standing tentacle's clock reads. */
const STANDING_ELAPSED = TENTACLES.spawnWarningSec + TENTACLES.riseSec + 60;
/** The mark under whoever a grasp wants. */
const GRAB_MARK_RADIUS = 1.9;

type Ribbon = ReturnType<typeof strip> & { mesh: THREE.Mesh; material: THREE.ShaderMaterial };

/** The instanced parts: [node, material] as authored in Blender. */
const CHAIN_PARTS = [
  ['Tentacle_Seg', 'AbyssSkin'],
  ['Tentacle_Seg', 'AbyssUnder'],
  ['Tentacle_Seg', 'AbyssSucker'],
] as const;
const TIP_PARTS = [
  ['Tentacle_Tip', 'AbyssSkin'],
  ['Tentacle_Tip', 'AbyssUnder'],
  ['Tentacle_Tip', 'AbyssSucker'],
] as const;

interface TentacleRig {
  instanceId: number;
  cueId: number;
  seen: boolean;
  shown: boolean;
  fresh: boolean;
  x: number;
  z: number;
  ground: number;
  total: number;
  remaining: number;
  elapsed: number;
  falling: boolean;
  /** Risen and standing (its heartbeat cue): the rise clock no longer matters. */
  standing: boolean;
  /** A grasp: where whoever it wants is. */
  grabX: number;
  grabZ: number;
  /** The live attack cue on this trunk, its clock and what was written for it. */
  attackCueId: number;
  attackSeen: boolean;
  attackFresh: boolean;
  attackTotal: number;
  attackRemaining: number;
  laneFor: number;
  landed: boolean;
  erupted: boolean;
  died: boolean;
  input: TentacleInput;
  pose: TentaclePose;
  chain: Float32Array;
  tip: Float32Array;
  warnDisc: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  warnRing: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  lane: Ribbon;
  laneFill: Ribbon;
  ring: Ribbon;
  arm: Ribbon;
  wake?: Ribbon;
}

export class HoardTentaclesFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private readonly low: boolean;
  private disposed = false;
  private time = 0;
  private seed = 23;
  private readonly rigs: TentacleRig[] = [];
  private readonly chainParts: THREE.InstancedMesh[] = [];
  private readonly tipParts: THREE.InstancedMesh[] = [];
  private readonly rubble: THREE.InstancedMesh;
  private readonly pool?: THREE.InstancedMesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly color = new THREE.Color();
  private readonly calm = new THREE.Color(LOOK.sucker);
  private readonly angry = new THREE.Color(LOOK.suckerAngry);
  private readonly axis = new Float32Array(3);
  private readonly belly = new Float32Array(3);
  private readonly whip = { fill: 0, lane: 0, flash: 0 };
  private readonly sweep = { ring: 0, bearing: 0, arm: 0, wake: 0, fill: 0 };
  private drawn = false;
  private readonly spray?: {
    points: THREE.Points;
    position: THREE.BufferAttribute;
    size: THREE.BufferAttribute;
    alpha: THREE.BufferAttribute;
    velocity: Float32Array;
    life: Float32Array;
    span: Float32Array;
    cursor: number;
    live: number;
  };

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    private readonly shake?: (amount: number) => void,
    effectsTier: GfxTier = GFX.tier,
    asset: THREE.Group | Promise<THREE.Group | undefined> | undefined = source,
  ) {
    this.root.name = 'hoard-tentacles';
    setRenderCategory(this.root, 'ui3d');
    this.low =
      resolveUiEffectsProfile({ presetLabel: effectsTier, effectsQuality: 1, reduceMotion: false })
        .tier === 'low';
    const initial = asset instanceof Promise ? undefined : asset;
    const pending =
      asset instanceof Promise
        ? asset
        : !asset && typeof window !== 'undefined'
          ? loadSource()
          : Promise.resolve(initial);

    // ---- the chain: every tentacle of the set shares these few instanced draws
    // A hoard room is dim and this skin is dark: a little of its own colour as
    // emission keeps the silhouette readable against any floor.
    const skin = surfaceMat({
      color: LOOK.skin,
      roughness: 0.42,
      metalness: 0.1,
      flatShading: true,
      emissive: LOOK.skin,
      emissiveIntensity: 0.4,
    });
    const under = surfaceMat({
      color: LOOK.under,
      roughness: 0.6,
      flatShading: true,
      emissive: LOOK.under,
      emissiveIntensity: 0.25,
    });
    const glow = this.keep(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    const chainMaterials = [skin, under, glow];
    for (let part = 0; part < CHAIN_PARTS.length; part++) {
      const mesh = new THREE.InstancedMesh(
        this.partGeometry(initial, CHAIN_PARTS[part][0], CHAIN_PARTS[part][1], part),
        chainMaterials[part],
        RIGS * LINKS,
      );
      this.adopt(mesh, `TentacleChain_${CHAIN_PARTS[part][1]}`, part !== 2);
      // One matrix buffer for all three: they are the same links.
      if (part > 0) mesh.instanceMatrix = this.chainParts[0].instanceMatrix;
      this.chainParts.push(mesh);
    }
    for (let part = 0; part < TIP_PARTS.length; part++) {
      const mesh = new THREE.InstancedMesh(
        this.partGeometry(initial, TIP_PARTS[part][0], TIP_PARTS[part][1], part),
        chainMaterials[part],
        RIGS,
      );
      this.adopt(mesh, `TentacleTip_${TIP_PARTS[part][1]}`, part !== 2);
      if (part > 0) mesh.instanceMatrix = this.tipParts[0].instanceMatrix;
      this.tipParts.push(mesh);
    }
    // The suckers glow by instance colour: calm, then angry as it winds up.
    for (const mesh of [this.chainParts[2], this.tipParts[2]]) {
      for (let i = 0; i < mesh.instanceMatrix.count; i++) mesh.setColorAt(i, this.calm);
      mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
    }
    this.rubble = new THREE.InstancedMesh(
      this.partGeometry(initial, 'Tentacle_Rubble', 'AbyssStone', 3),
      surfaceMat({
        color: LOOK.stone,
        roughness: 0.9,
        flatShading: true,
        emissive: LOOK.stone,
        emissiveIntensity: 0.3,
      }),
      RIGS,
    );
    this.adopt(this.rubble, 'TentacleRubble', true);
    if (!this.low) {
      this.pool = new THREE.InstancedMesh(
        this.partGeometry(initial, 'Tentacle_Pool', 'AbyssWater', 4),
        this.keep(new THREE.MeshBasicMaterial({ color: LOOK.water, toneMapped: false })),
        RIGS,
      );
      this.adopt(this.pool, 'TentaclePool', false);
    }

    const disc = this.own(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2));
    const ring = this.own(new THREE.RingGeometry(0.9, 1, 56).rotateX(-Math.PI / 2));
    for (let i = 0; i < RIGS; i++) this.rigs.push(this.makeRig(i, disc, ring));

    if (!this.low) {
      const geometry = this.own(new THREE.BufferGeometry());
      const position = new THREE.BufferAttribute(new Float32Array(SPRAY * 3), 3);
      const size = new THREE.BufferAttribute(new Float32Array(SPRAY), 1);
      const alpha = new THREE.BufferAttribute(new Float32Array(SPRAY), 1);
      const tint = new THREE.BufferAttribute(new Float32Array(SPRAY * 3), 3);
      position.setUsage(THREE.DynamicDrawUsage);
      size.setUsage(THREE.DynamicDrawUsage);
      alpha.setUsage(THREE.DynamicDrawUsage);
      const color = new THREE.Color(LOOK.spray);
      for (let i = 0; i < SPRAY; i++) tint.setXYZ(i, color.r, color.g, color.b);
      geometry.setAttribute('position', position);
      geometry.setAttribute('size', size);
      geometry.setAttribute('alpha', alpha);
      geometry.setAttribute('tint', tint);
      const points = new THREE.Points(geometry, this.keep(sparkMaterial()));
      points.visible = false;
      points.frustumCulled = false;
      points.renderOrder = 30;
      this.root.add(points);
      this.spray = {
        points,
        position,
        size,
        alpha,
        velocity: new Float32Array(SPRAY * 3),
        life: new Float32Array(SPRAY),
        span: new Float32Array(SPRAY),
        cursor: 0,
        live: 0,
      };
    }

    // Compile with everything present and visible-capable, then idle hidden.
    this.readyForEntry = pending
      .catch(() => undefined)
      .then(async (loaded) => {
        if (this.disposed) return;
        if (loaded && loaded !== initial) {
          for (let part = 0; part < CHAIN_PARTS.length; part++) {
            this.chainParts[part].geometry = this.partGeometry(
              loaded,
              CHAIN_PARTS[part][0],
              CHAIN_PARTS[part][1],
              part,
            );
            this.tipParts[part].geometry = this.partGeometry(
              loaded,
              TIP_PARTS[part][0],
              TIP_PARTS[part][1],
              part,
            );
          }
          this.rubble.geometry = this.partGeometry(loaded, 'Tentacle_Rubble', 'AbyssStone', 3);
          if (this.pool)
            this.pool.geometry = this.partGeometry(loaded, 'Tentacle_Pool', 'AbyssWater', 4);
        }
        await attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed);
      })
      .catch(() => {});
  }

  private random(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  private own<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.add(geometry);
    return geometry;
  }

  private keep<T extends THREE.Material>(material: T): T {
    this.materials.add(material);
    return material;
  }

  private adopt(mesh: THREE.InstancedMesh, name: string, shadows: boolean): void {
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.castShadow = shadows;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    this.root.add(mesh);
  }

  private basic(color: number, additive: boolean): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      color,
      opacity: 0,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
  }

  private ribbon(
    segments: number,
    color: number,
    additive: boolean,
    name: string,
    order: number,
    depthTest = true,
  ): Ribbon {
    const made = strip(segments);
    this.own(made.geometry);
    const material = this.keep(ribbonMaterial(color, additive));
    material.depthTest = depthTest;
    const mesh = new THREE.Mesh(made.geometry, material);
    mesh.name = name;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    this.root.add(mesh);
    return { ...made, mesh, material };
  }

  /** One authored part, in the asset root's frame, as plain float geometry. The
   *  shipped GLB is quantized: positions are normalized integers the NODE
   *  transform scales back up, so they are baked through fromBufferAttribute. A
   *  plain stand-in serves until (or unless) the asset arrives. */
  private partGeometry(
    asset: THREE.Group | undefined,
    node: string,
    materialName: string,
    standIn: number,
  ): THREE.BufferGeometry {
    const holder = asset?.getObjectByName('Tentacle_ROOT');
    const part = holder?.getObjectByName(node);
    let found: THREE.Mesh | undefined;
    part?.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || found) return;
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (material.name === materialName) found = mesh;
    });
    if (!holder || !found) {
      if (standIn === 0)
        return this.own(new THREE.CylinderGeometry(0.95, 1, 1, 8, 1, true).translate(0, 0.5, 0));
      if (standIn === 3)
        return this.own(new THREE.TorusGeometry(2.1, 0.35, 4, 10).rotateX(Math.PI / 2));
      if (standIn === 4) return this.own(new THREE.CircleGeometry(2.1, 16).rotateX(-Math.PI / 2));
      // The belly and the suckers have no stand-in: an empty draw.
      const empty = this.own(new THREE.BufferGeometry());
      empty.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
      return empty;
    }
    holder.updateWorldMatrix(true, true);
    const local = new THREE.Matrix4().copy(holder.matrixWorld).invert().multiply(found.matrixWorld);
    const from = found.geometry.getAttribute('position');
    const positions = new Float32Array(from.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < from.count; i++) {
      v.fromBufferAttribute(from, i).applyMatrix4(local);
      positions[i * 3] = v.x;
      positions[i * 3 + 1] = v.y;
      positions[i * 3 + 2] = v.z;
    }
    const geometry = this.own(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const index = found.geometry.getIndex();
    if (index) geometry.setIndex(Array.from(index.array));
    return geometry;
  }

  private makeRig(
    index: number,
    disc: THREE.BufferGeometry,
    ring: THREE.BufferGeometry,
  ): TentacleRig {
    const rig: TentacleRig = {
      instanceId: -1,
      cueId: -1,
      seen: false,
      shown: false,
      fresh: false,
      x: 0,
      z: 0,
      ground: 0,
      total: 0,
      remaining: -1,
      elapsed: 0,
      falling: false,
      standing: false,
      grabX: 0,
      grabZ: 0,
      attackCueId: -1,
      attackSeen: false,
      attackFresh: false,
      attackTotal: 0,
      attackRemaining: -1,
      laneFor: -1,
      landed: false,
      erupted: false,
      died: false,
      input: {
        index,
        time: 0,
        elapsed: 0,
        facing: 0,
        attack: 0,
        attackElapsed: 0,
        attackFacing: 0,
        direction: 1,
        reachDistance: 0,
        holding: false,
        fall: -1,
        killed: false,
        still: false,
      },
      pose: makeTentaclePose(),
      chain: new Float32Array(LINKS * LINK_STRIDE),
      tip: new Float32Array(5),
      warnDisc: new THREE.Mesh(disc, this.keep(this.basic(LOOK.water, false))),
      warnRing: new THREE.Mesh(ring, this.keep(this.basic(LOOK.warn, true))),
      // The whip's lane is a flat quad over uneven floor: drawn as an overlay, so a
      // rise of the ground never cuts it (it flickered as the camera moved, playtest).
      lane: this.ribbon(1, LOOK.danger, false, 'TentacleLane', 18, false),
      laneFill: this.ribbon(1, LOOK.danger, true, 'TentacleLaneFill', 19, false),
      ring: this.ribbon(RING_SEGMENTS, LOOK.danger, false, 'TentacleSweepRing', 18),
      arm: this.ribbon(ARM_SEGMENTS, LOOK.danger, true, 'TentacleSweepArm', 20),
      wake: this.low ? undefined : this.ribbon(WAKE_SEGMENTS, LOOK.warn, true, 'TentacleWake', 19),
    };
    rig.warnDisc.name = 'TentacleWarning';
    for (const mesh of [rig.warnDisc, rig.warnRing]) {
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 17;
      this.root.add(mesh);
    }
    return rig;
  }

  sync(cues: readonly HoardBossCueView[]): void {
    if (this.disposed) return;
    for (let i = 0; i < this.rigs.length; i++) {
      this.rigs[i].seen = false;
      this.rigs[i].attackSeen = false;
    }
    // Trunks first, so an attack always finds the rig it belongs to.
    for (let c = 0; c < cues.length; c++) {
      const cue = cues[c];
      if (cue.remaining <= 0) continue;
      const fall = cue.variant === 'tide-tentacle-fall';
      const up = cue.variant === 'tide-tentacle-up';
      if (!fall && !up && cue.variant !== 'tide-tentacle') continue;
      let rig: TentacleRig | undefined;
      let free: TentacleRig | undefined;
      for (let i = 0; i < this.rigs.length; i++) {
        const candidate = this.rigs[i];
        if (candidate.cueId === cue.cueId && candidate.instanceId === cue.instanceId) {
          rig = candidate;
          break;
        }
        if (!free && candidate.cueId === -1) free = candidate;
      }
      if (!rig) {
        rig = free;
        if (!rig) continue;
        // A rig is reused across sets and whole runs: start it clean.
        rig.cueId = cue.cueId;
        rig.instanceId = cue.instanceId;
        rig.remaining = -1;
        rig.falling = false;
        rig.standing = false;
        rig.attackCueId = -1;
        rig.attackRemaining = -1;
        rig.laneFor = -1;
        rig.landed = false;
        rig.erupted = false;
        rig.died = false;
        rig.input.attack = 0;
        rig.input.fall = -1;
        rig.input.killed = false;
        rig.ground = this.groundY(cue.x, cue.z);
      }
      rig.seen = true;
      rig.x = cue.x;
      rig.z = cue.z;
      if (fall !== rig.falling) {
        // The same cue, now its fall: a new clock.
        rig.falling = fall;
        rig.remaining = -1;
      }
      // A client that first sees it standing (it joined late) never replays the rise.
      if (up) rig.standing = true;
      if (fall) rig.input.killed = (cue.halfAngle ?? 0) >= 0.5;
      else {
        rig.input.facing = cue.facing ?? 0;
        rig.input.index = Math.round(cue.halfAngle ?? 0);
      }
      rig.total = cue.total;
      if (rig.remaining !== cue.remaining) {
        rig.remaining = cue.remaining;
        rig.elapsed = Math.max(0, cue.total - cue.remaining);
        rig.fresh = true;
      }
    }
    for (let c = 0; c < cues.length; c++) {
      const cue = cues[c];
      if (cue.remaining <= 0) continue;
      const whip = cue.variant === 'tide-whip';
      const hold = cue.variant === 'tide-grab-hold';
      const grab = hold || cue.variant === 'tide-grab';
      if (!whip && !grab && cue.variant !== 'tide-sweep') continue;
      for (let i = 0; i < this.rigs.length; i++) {
        const rig = this.rigs[i];
        if (!rig.seen || rig.instanceId !== cue.instanceId) continue;
        // A lash or a sweep sits ON its trunk; a grasp rides its victim and says
        // which tentacle of the set is reaching.
        if (grab) {
          if (Math.round(cue.innerRadius ?? -1) !== rig.input.index) continue;
        } else if (Math.abs(rig.x - cue.x) > 0.05 || Math.abs(rig.z - cue.z) > 0.05) continue;
        if (rig.attackCueId !== cue.cueId) {
          rig.attackCueId = cue.cueId;
          rig.attackRemaining = -1;
          rig.landed = false;
        }
        rig.attackSeen = true;
        rig.input.attack = grab ? 3 : whip ? 1 : 2;
        if (grab) {
          rig.grabX = cue.x;
          rig.grabZ = cue.z;
          rig.input.holding = hold;
          rig.input.reachDistance = Math.hypot(cue.x - rig.x, cue.z - rig.z);
          rig.input.attackFacing = Math.atan2(cue.x - rig.x, cue.z - rig.z);
        } else {
          rig.input.attackFacing = cue.facing ?? 0;
          rig.input.direction = cue.radius < 0 ? -1 : 1;
        }
        rig.attackTotal = cue.total;
        if (rig.attackRemaining !== cue.remaining) {
          rig.attackRemaining = cue.remaining;
          rig.input.attackElapsed = Math.max(0, cue.total - cue.remaining);
          rig.attackFresh = true;
        }
        break;
      }
    }
    for (let i = 0; i < this.rigs.length; i++) {
      const rig = this.rigs[i];
      if (!rig.seen) rig.cueId = -1;
      if (!rig.attackSeen) {
        rig.attackCueId = -1;
        rig.input.attack = 0;
      }
    }
  }

  update(dt: number): void {
    if (this.disposed) return;
    this.time += dt;
    const still = this.reducedMotion();
    let links = 0;
    let tips = 0;
    let bases = 0;
    for (let i = 0; i < this.rigs.length; i++) {
      const rig = this.rigs[i];
      if (!rig.seen || rig.cueId === -1) {
        this.hideRig(rig);
        continue;
      }
      rig.shown = true;
      // A cue that refreshed this frame already IS now: only a stale one is
      // carried forward, so the clock never double-steps.
      if (rig.fresh) rig.fresh = false;
      else rig.elapsed = Math.min(rig.total, rig.elapsed + dt);
      if (rig.input.attack !== 0) {
        if (rig.attackFresh) rig.attackFresh = false;
        else rig.input.attackElapsed = Math.min(rig.attackTotal, rig.input.attackElapsed + dt);
      }
      const input = rig.input;
      input.time = this.time;
      input.still = still;
      input.elapsed = rig.falling ? -1 : rig.standing ? STANDING_ELAPSED : rig.elapsed;
      input.fall = rig.falling ? rig.elapsed : -1;
      const pose = tentaclePose(input, rig.pose);
      this.drawFloor(rig, pose, still);
      this.sideEffects(rig, pose, still);
      if (pose.grow <= 0.01 || pose.dissolve >= 0.99) continue;
      writeTentacleChain(input, pose, rig.chain, rig.tip);
      // Its suckers burn angrier the closer it is to striking.
      const anger = Math.max(pose.rear, pose.low, pose.slam, pose.reach);
      this.color.copy(this.calm).lerp(this.angry, anger);
      for (let link = 0; link < LINKS; link++) {
        const o = link * LINK_STRIDE;
        const radius = rig.chain[o + 5];
        if (radius <= 0.02) continue;
        linkBasis(rig.chain[o + 3], rig.chain[o + 4], this.axis, this.belly);
        // Links overlap a little so a bend never opens a seam.
        this.writeMatrix(
          this.chainParts[0],
          links,
          rig.x + rig.chain[o],
          rig.ground + rig.chain[o + 1],
          rig.z + rig.chain[o + 2],
          radius,
          rig.chain[o + 6] * 1.22,
        );
        this.chainParts[2].setColorAt(links, this.color);
        links++;
      }
      const last = (LINKS - 1) * LINK_STRIDE;
      const tipRadius = rig.chain[last + 5] * 0.94;
      if (tipRadius > 0.02) {
        linkBasis(rig.tip[3], rig.tip[4], this.axis, this.belly);
        this.writeMatrix(
          this.tipParts[0],
          tips,
          rig.x + rig.tip[0],
          rig.ground + rig.tip[1],
          rig.z + rig.tip[2],
          tipRadius,
          tipRadius,
        );
        this.tipParts[2].setColorAt(tips, this.color);
        tips++;
      }
    }
    for (let i = 0; i < this.rigs.length; i++) {
      const rig = this.rigs[i];
      if (!rig.shown || rig.pose.rubble <= 0.01) continue;
      // The floor breaks in a snap: a quick heave up out of flat.
      this.matrix.makeScale(1, rig.pose.rubble, 1);
      this.matrix.setPosition(rig.x, rig.ground, rig.z);
      this.rubble.setMatrixAt(bases, this.matrix);
      if (this.pool) {
        this.matrix.makeScale(rig.pose.rubble, 1, rig.pose.rubble);
        this.matrix.setPosition(rig.x, rig.ground + 0.02, rig.z);
        this.pool.setMatrixAt(bases, this.matrix);
      }
      bases++;
    }
    const drawing = links > 0 || tips > 0 || bases > 0;
    if (drawing || this.drawn) {
      for (let part = 0; part < this.chainParts.length; part++) {
        this.chainParts[part].count = links;
        this.tipParts[part].count = tips;
      }
      this.rubble.count = bases;
      if (this.pool) this.pool.count = bases;
      if (drawing) {
        this.chainParts[0].instanceMatrix.needsUpdate = true;
        this.tipParts[0].instanceMatrix.needsUpdate = true;
        this.rubble.instanceMatrix.needsUpdate = true;
        if (this.pool) this.pool.instanceMatrix.needsUpdate = true;
        const chainColor = this.chainParts[2].instanceColor;
        const tipColor = this.tipParts[2].instanceColor;
        if (chainColor) chainColor.needsUpdate = true;
        if (tipColor) tipColor.needsUpdate = true;
      }
      this.drawn = drawing;
    }
    this.updateSpray(dt);
  }

  /** One link's instance matrix, from the basis in `axis` and `belly`: X is their
   *  cross, Y the axis (scaled by the link's length), Z the belly. */
  private writeMatrix(
    mesh: THREE.InstancedMesh,
    slot: number,
    x: number,
    y: number,
    z: number,
    radius: number,
    length: number,
  ): void {
    const a = this.axis;
    const b = this.belly;
    const e = mesh.instanceMatrix.array as Float32Array;
    const o = slot * 16;
    e[o] = (a[1] * b[2] - a[2] * b[1]) * radius;
    e[o + 1] = (a[2] * b[0] - a[0] * b[2]) * radius;
    e[o + 2] = (a[0] * b[1] - a[1] * b[0]) * radius;
    e[o + 3] = 0;
    e[o + 4] = a[0] * length;
    e[o + 5] = a[1] * length;
    e[o + 6] = a[2] * length;
    e[o + 7] = 0;
    e[o + 8] = b[0] * radius;
    e[o + 9] = b[1] * radius;
    e[o + 10] = b[2] * radius;
    e[o + 11] = 0;
    e[o + 12] = x;
    e[o + 13] = y;
    e[o + 14] = z;
    e[o + 15] = 1;
  }

  private hideRig(rig: TentacleRig): void {
    if (!rig.shown) return;
    rig.shown = false;
    rig.pose.rubble = 0;
    rig.warnDisc.visible = false;
    rig.warnRing.visible = false;
    rig.lane.mesh.visible = false;
    rig.laneFill.mesh.visible = false;
    rig.ring.mesh.visible = false;
    rig.arm.mesh.visible = false;
    if (rig.wake) rig.wake.mesh.visible = false;
  }

  /** What a player reads off the floor: where it will rise, the lane it will
   *  lash, the ring it will sweep and the arm sweeping it. */
  private drawFloor(rig: TentacleRig, pose: TentaclePose, still: boolean): void {
    const warned = pose.warning > 0.01;
    const grabbing = rig.input.attack === 3;
    rig.warnDisc.visible = warned || grabbing;
    rig.warnRing.visible = warned || grabbing;
    if (grabbing) {
      // The mark under whoever it wants: it closes in as the grasp does, then
      // beats while they are held.
      const closing = rig.input.holding
        ? 0.75 + (still ? 0 : 0.12 * Math.sin(this.time * 9))
        : 1.5 - 0.75 * Math.min(1, rig.input.attackElapsed / TENTACLES.grabTelegraphSec);
      const ground = this.groundY(rig.grabX, rig.grabZ);
      rig.warnDisc.position.set(rig.grabX, ground + 0.05, rig.grabZ);
      rig.warnDisc.scale.setScalar(GRAB_MARK_RADIUS * closing);
      rig.warnDisc.material.opacity = 0.45;
      rig.warnRing.position.set(rig.grabX, ground + 0.08, rig.grabZ);
      rig.warnRing.scale.setScalar(GRAB_MARK_RADIUS * closing);
      rig.warnRing.material.color.setHex(LOOK.danger);
      rig.warnRing.material.opacity = 0.95;
    } else if (warned) {
      rig.warnRing.material.color.setHex(LOOK.warn);
      const pulse = still ? 1 : 1 + 0.05 * Math.sin(this.time * 15);
      rig.warnDisc.position.set(rig.x, rig.ground + 0.05, rig.z);
      rig.warnDisc.scale.setScalar(TENTACLES.eruptRadius * pulse);
      rig.warnDisc.material.opacity = 0.6 * pose.warning;
      rig.warnRing.position.set(rig.x, rig.ground + 0.08, rig.z);
      rig.warnRing.scale.setScalar(TENTACLES.eruptRadius);
      rig.warnRing.material.opacity = 0.9 * pose.warning;
    }
    const attack = rig.input.attack;
    const whipping = attack === 1;
    const sweeping = attack === 2;
    rig.lane.mesh.visible = whipping;
    rig.laneFill.mesh.visible = whipping;
    rig.ring.mesh.visible = sweeping;
    rig.arm.mesh.visible = sweeping;
    if (rig.wake) rig.wake.mesh.visible = false;
    if (whipping) {
      whipTelegraph(rig.input.attackElapsed, this.whip);
      if (rig.laneFor !== rig.attackCueId) {
        rig.laneFor = rig.attackCueId;
        this.writeLane(rig, rig.lane, 1, 0.55, 0.4);
      }
      this.writeLane(rig, rig.laneFill, this.whip.fill, 0.5, 0.5);
      rig.lane.material.uniforms.gain.value = this.whip.lane;
      rig.laneFill.material.uniforms.gain.value = this.whip.lane * 0.7 + this.whip.flash * 1.6;
    } else if (sweeping) {
      sweepTelegraph(
        rig.input.attackElapsed,
        rig.input.attackFacing,
        rig.input.direction,
        this.sweep,
      );
      if (rig.laneFor !== rig.attackCueId) {
        rig.laneFor = rig.attackCueId;
        this.writeRing(rig);
      }
      rig.ring.material.uniforms.gain.value = this.sweep.ring * (0.55 + 0.25 * this.sweep.fill);
      this.writeArc(
        rig,
        rig.arm,
        ARM_SEGMENTS,
        this.sweep.bearing - TENTACLES.sweepArmHalfAngle,
        this.sweep.bearing + TENTACLES.sweepArmHalfAngle,
        0.95,
        0.95,
      );
      rig.arm.material.uniforms.gain.value = this.sweep.arm;
      if (rig.wake && this.sweep.wake > 0.02 && !still) {
        rig.wake.mesh.visible = true;
        const behind = this.sweep.bearing - rig.input.direction * TENTACLES.sweepArmHalfAngle;
        this.writeArc(
          rig,
          rig.wake,
          WAKE_SEGMENTS,
          behind,
          behind - rig.input.direction * 1.3 * this.sweep.wake,
          0.6,
          0,
        );
        rig.wake.material.uniforms.gain.value = this.sweep.wake;
      }
    }
  }

  /** The lash's lane: the sim's own rectangle, out from the trunk along the aim. */
  private writeLane(
    rig: TentacleRig,
    lane: Ribbon,
    share: number,
    near: number,
    far: number,
  ): void {
    const facing = rig.input.attackFacing;
    const fx = Math.sin(facing);
    const fz = Math.cos(facing);
    const half = TENTACLES.whipHalfWidth;
    const length = TENTACLES.whipLength * share;
    const y = rig.ground + 0.09;
    lane.position.setXYZ(0, rig.x - fz * half, y, rig.z + fx * half);
    lane.position.setXYZ(1, rig.x + fz * half, y, rig.z - fx * half);
    lane.position.setXYZ(2, rig.x + fx * length - fz * half, y, rig.z + fz * length + fx * half);
    lane.position.setXYZ(3, rig.x + fx * length + fz * half, y, rig.z + fz * length - fx * half);
    lane.alpha.setX(0, near);
    lane.alpha.setX(1, near);
    lane.alpha.setX(2, far);
    lane.alpha.setX(3, far);
    lane.position.needsUpdate = true;
    lane.alpha.needsUpdate = true;
  }

  /** The whole ground the sweep will turn through: never the trunk's own. */
  private writeRing(rig: TentacleRig): void {
    this.writeArc(rig, rig.ring, RING_SEGMENTS, 0, Math.PI * 2, 0.42, 0.42);
  }

  private writeArc(
    rig: TentacleRig,
    ribbon: Ribbon,
    segments: number,
    from: number,
    to: number,
    alphaFrom: number,
    alphaTo: number,
  ): void {
    const y = rig.ground + 0.1;
    for (let column = 0; column <= segments; column++) {
      const t = column / segments;
      const bearing = from + (to - from) * t;
      const sx = Math.sin(bearing);
      const sz = Math.cos(bearing);
      ribbon.position.setXYZ(
        column * 2,
        rig.x + sx * TENTACLES.sweepInnerRadius,
        y,
        rig.z + sz * TENTACLES.sweepInnerRadius,
      );
      ribbon.position.setXYZ(
        column * 2 + 1,
        rig.x + sx * TENTACLES.sweepRadius,
        y,
        rig.z + sz * TENTACLES.sweepRadius,
      );
      const alpha = alphaFrom + (alphaTo - alphaFrom) * t;
      ribbon.alpha.setX(column * 2, alpha * 0.7);
      ribbon.alpha.setX(column * 2 + 1, alpha);
    }
    ribbon.position.needsUpdate = true;
    ribbon.alpha.needsUpdate = true;
  }

  /** The spray and the jolt: once per beat, from the pose's own edges. */
  private sideEffects(rig: TentacleRig, pose: TentaclePose, still: boolean): void {
    if (!rig.erupted && pose.rubble > 0) {
      rig.erupted = true;
      if (!rig.falling) {
        this.burst(rig.x, rig.ground + 0.3, rig.z, 60, 7, 12);
        if (!still && !this.low) this.shake?.(0.08);
      }
    }
    if (rig.falling && rig.input.killed && !rig.died) {
      rig.died = true;
      this.burst(rig.x, rig.ground + 2, rig.z, 50, 6, 8);
    }
    if (rig.input.attack === 1 && pose.impact > 0 && !rig.landed) {
      rig.landed = true;
      if (pose.impact > 0.4) {
        const fx = Math.sin(rig.input.attackFacing);
        const fz = Math.cos(rig.input.attackFacing);
        for (let n = 0; n < 6; n++) {
          const d = TENTACLES.whipLength * (0.15 + 0.14 * n);
          this.burst(rig.x + fx * d, rig.ground + 0.3, rig.z + fz * d, 12, 5, 8);
        }
        if (!still && !this.low) this.shake?.(0.1);
      }
    }
    if (rig.input.attack === 2 && this.sweep.wake > 0.2 && !still && this.random() < 0.9) {
      this.emit(
        rig.x + rig.tip[0],
        rig.ground + rig.tip[1] + 0.2,
        rig.z + rig.tip[2],
        (this.random() - 0.5) * 3,
        2 + this.random() * 4,
        (this.random() - 0.5) * 3,
        0.2,
        0.6,
      );
    }
  }

  private burst(x: number, y: number, z: number, count: number, speed: number, lift: number): void {
    if (!this.spray) return;
    for (let i = 0; i < count; i++) {
      const a = this.random() * Math.PI * 2;
      const s = speed * (0.3 + this.random() * 0.7);
      this.emit(
        x,
        y,
        z,
        Math.sin(a) * s,
        lift * (0.3 + this.random() * 0.7),
        Math.cos(a) * s,
        0.18 + this.random() * 0.22,
        0.6 + this.random() * 0.6,
      );
    }
  }

  private emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    size: number,
    life: number,
  ): void {
    const spray = this.spray;
    if (!spray) return;
    const i = spray.cursor;
    spray.cursor = (i + 1) % SPRAY;
    spray.position.setXYZ(i, x, y, z);
    spray.velocity[i * 3] = vx;
    spray.velocity[i * 3 + 1] = vy;
    spray.velocity[i * 3 + 2] = vz;
    spray.size.setX(i, size);
    spray.life[i] = life;
    spray.span[i] = life;
    spray.live++;
    spray.size.needsUpdate = true;
  }

  private updateSpray(dt: number): void {
    const spray = this.spray;
    if (!spray || spray.live === 0) return;
    let alive = 0;
    for (let i = 0; i < SPRAY; i++) {
      if (spray.life[i] <= 0) continue;
      spray.life[i] -= dt;
      if (spray.life[i] <= 0) {
        spray.alpha.setX(i, 0);
        continue;
      }
      alive++;
      spray.velocity[i * 3 + 1] -= 16 * dt;
      spray.position.setXYZ(
        i,
        spray.position.getX(i) + spray.velocity[i * 3] * dt,
        spray.position.getY(i) + spray.velocity[i * 3 + 1] * dt,
        spray.position.getZ(i) + spray.velocity[i * 3 + 2] * dt,
      );
      spray.alpha.setX(i, Math.min(1, (spray.life[i] / spray.span[i]) * 1.5) * 0.8);
    }
    spray.live = alive;
    spray.points.visible = alive > 0;
    spray.position.needsUpdate = true;
    spray.alpha.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    // An InstancedMesh owns GL buffers of its own (its instance matrix and
    // colour): only its own dispose() frees them.
    for (const mesh of this.chainParts) mesh.dispose();
    for (const mesh of this.tipParts) mesh.dispose();
    this.rubble.dispose();
    this.pool?.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.clear();
    this.materials.clear();
  }
}
