// Grask's Rolling Boulder, drawn from the authoritative hoard cues. WHERE the
// boulder is and who counts as standing with its mark is the shared sim core
// (src/sim/rift/hoard_boulder_core.ts) sampled at each cue's own life, so the
// rock on screen is the rock that hits and the ring on the floor is the ring
// that counts; how it LOOKS is hoard_boulder_core.ts beside this file.
//
// What is Blender and what is runtime: the boulder and the pieces it breaks into
// are a Blender model (docs/design/boulder/). Everything that depends on the
// moment is code: the heft, the throw down, the roll and its skips, the throw
// back, the break, the ring and its pips, the lone player's lane, the dust.
//
// Performance contract (the siblings' contract): every geometry and material is
// built once here and attached through the scene gate, so nothing compiles
// mid-fight; no dynamic lights; nothing is allocated per frame; the idle frame
// is a few branches. The low tier sheds the dust, and nothing else. It NEVER sheds
// what a player acts on: the boulder, the ring, its pips and the lane draw on
// every tier.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../game/ui_effects_profile';
import { BOULDER, standsWith } from '../sim/rift/hoard_boulder_core';
import type { IWorld } from '../world_api';
import type { HoardBossCueView } from '../world_api/dungeons';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { attachSceneGroupGated } from './gated_scene_attach';
import { GFX, type GfxTier, surfaceMat } from './gfx';
import {
  type BoulderPose,
  boulderPose,
  boulderReturnPose,
  BOULDER_LOOK as LOOK,
  makeBoulderPose,
  shardFlight,
  supportRing,
} from './hoard_boulder_core';
import { ribbonMaterial, sparkMaterial, strip } from './hoard_fx_materials';
import { setRenderCategory } from './renderer_diagnostics';

export const BOULDER_ASSET_URL = '/vfx/boulder/boulder.glb';
let source: THREE.Group | undefined;
let loading: Promise<THREE.Group | undefined> | undefined;
function loadSource(): Promise<THREE.Group | undefined> {
  loading ??= loadGltf(BOULDER_ASSET_URL)
    .then((gltf) => {
      source = gltf.scene;
      return source;
    })
    .catch(() => undefined);
  return loading;
}
if (typeof window !== 'undefined') registerDeferredPreload(loadSource);

/** Two boulders at most are ever in play. */
const RIGS = 2;
const DUST = 220;
const RING_SEGMENTS = 48;
/** Seconds between counts of who stands in a ring. */
const COUNT_EVERY = 0.1;

type Ribbon = ReturnType<typeof strip> & { mesh: THREE.Mesh; material: THREE.ShaderMaterial };
type Phase = 'rolling' | 'returning' | 'broken';

interface BoulderRig {
  instanceId: number;
  cueId: number;
  seen: boolean;
  shown: boolean;
  fresh: boolean;
  phase: Phase;
  x: number;
  z: number;
  fromX: number;
  fromZ: number;
  hasFrom: boolean;
  /** Which boulder of the cast it is (0 first): its cue id's place after the carrier. */
  order: number;
  ground: number;
  total: number;
  remaining: number;
  elapsed: number;
  needed: number;
  targetId: number;
  standing: number;
  countIn: number;
  hit: boolean;
  broke: boolean;
  ringFor: number;
  laneFor: number;
  /** Where the ring was last written: a mark that is knocked about re-writes it. */
  ringX: number;
  ringZ: number;
  body: THREE.Group;
  shards: THREE.Mesh[];
  glow: THREE.MeshBasicMaterial;
  shadow?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  ring: Ribbon;
  lane: Ribbon;
  pips: Array<THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>;
  pose: BoulderPose;
}

export class HoardBoulderFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private readonly low: boolean;
  private disposed = false;
  private time = 0;
  private seed = 31;
  private readonly rigs: BoulderRig[] = [];
  /** Where each shard sat in the whole rock (x, y, z per shard). */
  private readonly homes = new Float32Array(LOOK.shards * 3);
  private readonly axis = new THREE.Vector3();
  /** The model baked once and shared by every rig (and the stand-in likewise). */
  private bakedFor: THREE.Group | undefined;
  private readonly bakedBody: Array<{ geometry: THREE.BufferGeometry; material: string }> = [];
  private readonly bakedShards: THREE.BufferGeometry[] = [];
  private standIn: { lump: THREE.BufferGeometry; chip: THREE.BufferGeometry } | undefined;
  private readonly flight = { x: 0, y: 0, z: 0, spin: 0, scale: 1 };
  private readonly ringLook = { ring: 0, answered: 0, pips: 0 };
  private readonly dust?: {
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
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    private readonly shake?: (amount: number) => void,
    effectsTier: GfxTier = GFX.tier,
    asset: THREE.Group | Promise<THREE.Group | undefined> | undefined = source,
  ) {
    this.root.name = 'hoard-boulder';
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

    const disc = this.own(new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2));
    for (let i = 0; i < RIGS; i++) this.rigs.push(this.makeRig(initial, disc));

    if (!this.low) {
      const geometry = this.own(new THREE.BufferGeometry());
      const position = new THREE.BufferAttribute(new Float32Array(DUST * 3), 3);
      const size = new THREE.BufferAttribute(new Float32Array(DUST), 1);
      const alpha = new THREE.BufferAttribute(new Float32Array(DUST), 1);
      const tint = new THREE.BufferAttribute(new Float32Array(DUST * 3), 3);
      position.setUsage(THREE.DynamicDrawUsage);
      size.setUsage(THREE.DynamicDrawUsage);
      alpha.setUsage(THREE.DynamicDrawUsage);
      const color = new THREE.Color(LOOK.dust);
      for (let i = 0; i < DUST; i++) tint.setXYZ(i, color.r, color.g, color.b);
      geometry.setAttribute('position', position);
      geometry.setAttribute('size', size);
      geometry.setAttribute('alpha', alpha);
      geometry.setAttribute('tint', tint);
      const points = new THREE.Points(geometry, this.keep(sparkMaterial()));
      points.visible = false;
      points.frustumCulled = false;
      points.renderOrder = 30;
      this.root.add(points);
      this.dust = {
        points,
        position,
        size,
        alpha,
        velocity: new Float32Array(DUST * 3),
        life: new Float32Array(DUST),
        span: new Float32Array(DUST),
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
          for (let i = 0; i < this.rigs.length; i++) this.buildBoulder(this.rigs[i], loaded);
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

  private basic(color: number, opacity: number, additive: boolean): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      color,
      opacity,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
  }

  private ribbon(segments: number, color: number, additive: boolean, name: string): Ribbon {
    const made = strip(segments);
    this.own(made.geometry);
    const material = this.keep(ribbonMaterial(color, additive));
    const mesh = new THREE.Mesh(made.geometry, material);
    mesh.name = name;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 18;
    this.root.add(mesh);
    return { ...made, mesh, material };
  }

  /** The lane is one long flat quad over uneven floor: at ground height it fought
   *  the floor for depth and flickered as the camera moved (playtest). */
  private lane(): Ribbon {
    const made = this.ribbon(1, LOOK.lane, false, 'BoulderLane');
    // A flat quad over uneven floor: no depth bias stops it dipping under a rise
    // of the ground, so it is drawn as an overlay, always on top of the floor.
    made.material.depthTest = false;
    return made;
  }

  private makeRig(asset: THREE.Group | undefined, disc: THREE.BufferGeometry): BoulderRig {
    const rig: BoulderRig = {
      instanceId: -1,
      cueId: -1,
      seen: false,
      shown: false,
      fresh: false,
      phase: 'rolling',
      x: 0,
      z: 0,
      fromX: 0,
      fromZ: 0,
      hasFrom: false,
      order: 0,
      ground: 0,
      total: 0,
      remaining: -1,
      elapsed: 0,
      needed: 0,
      targetId: -1,
      standing: 0,
      countIn: 0,
      hit: false,
      broke: false,
      ringFor: -1,
      laneFor: -1,
      ringX: 0,
      ringZ: 0,
      body: new THREE.Group(),
      shards: [],
      glow: this.keep(new THREE.MeshBasicMaterial({ color: LOOK.glow, toneMapped: false })),
      // On every tier: it says where an airborne boulder is over the floor.
      shadow: new THREE.Mesh(disc, this.keep(this.basic(0x000000, 0, false))),
      ring: this.ribbon(RING_SEGMENTS, LOOK.stand, false, 'BoulderRing'),
      lane: this.lane(),
      pips: [],
      pose: makeBoulderPose(),
    };
    rig.body.name = 'Boulder';
    rig.body.visible = false;
    this.root.add(rig.body);
    if (rig.shadow) {
      rig.shadow.name = 'BoulderShadow';
      rig.shadow.visible = false;
      rig.shadow.frustumCulled = false;
      rig.shadow.renderOrder = 16;
      this.root.add(rig.shadow);
    }
    for (let p = 0; p < LOOK.pips; p++) {
      const pip = new THREE.Mesh(disc, this.keep(this.basic(LOOK.stand, 0, true)));
      pip.name = 'BoulderPip';
      pip.visible = false;
      pip.frustumCulled = false;
      pip.renderOrder = 20;
      this.root.add(pip);
      rig.pips.push(pip);
    }
    this.buildBoulder(rig, asset);
    return rig;
  }

  /** One authored mesh as plain float geometry in the asset root's frame (position
   *  and index only: every lit material here is flatShading, which derives its
   *  normals in the shader and never reads a `normal` attribute). The
   *  shipped GLB is quantized: positions are normalized integers the NODE
   *  transform scales back up, so they are baked through fromBufferAttribute. */
  private bake(holder: THREE.Object3D, mesh: THREE.Mesh, recentre: boolean, home?: THREE.Vector3) {
    const local = new THREE.Matrix4().copy(holder.matrixWorld).invert().multiply(mesh.matrixWorld);
    const from = mesh.geometry.getAttribute('position');
    const positions = new Float32Array(from.count * 3);
    const v = new THREE.Vector3();
    const centre = new THREE.Vector3();
    for (let i = 0; i < from.count; i++) {
      v.fromBufferAttribute(from, i).applyMatrix4(local);
      positions[i * 3] = v.x;
      positions[i * 3 + 1] = v.y;
      positions[i * 3 + 2] = v.z;
      centre.add(v);
    }
    if (recentre && from.count > 0) {
      // A shard tumbles about its OWN middle, and is thrown from where it sat.
      centre.divideScalar(from.count);
      for (let i = 0; i < from.count; i++) {
        positions[i * 3] -= centre.x;
        positions[i * 3 + 1] -= centre.y;
        positions[i * 3 + 2] -= centre.z;
      }
      home?.copy(centre);
    }
    const geometry = this.own(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const index = mesh.geometry.getIndex();
    if (index) geometry.setIndex(Array.from(index.array));
    return geometry;
  }

  /** The boulder: the Blender model in the game's own surface material for its
   *  stone and iron, on a material of ours where it glows. A plain stand-in of
   *  the same size serves until (or unless) the asset arrives. */
  private buildBoulder(rig: BoulderRig, asset: THREE.Group | undefined): void {
    rig.body.clear();
    for (const shard of rig.shards) shard.removeFromParent();
    rig.shards.length = 0;
    const stone = surfaceMat({ color: LOOK.stone, roughness: 0.92, flatShading: true });
    const iron = surfaceMat({
      color: LOOK.iron,
      roughness: 0.55,
      metalness: 0.8,
      flatShading: true,
    });
    const holder = asset?.getObjectByName('Boulder_ROOT');
    if (!holder) {
      // Owned like everything else and freed once at dispose: when the late asset
      // replaces it the stand-in is only detached, never separately released.
      // Built ONCE and shared by every rig.
      if (!this.standIn) {
        this.standIn = {
          lump: this.own(new THREE.IcosahedronGeometry(BOULDER.boulderRadius, 1)),
          chip: this.own(new THREE.IcosahedronGeometry(BOULDER.boulderRadius * 0.4, 0)),
        };
        for (let n = 0; n < LOOK.shards; n++) {
          const a = (n / LOOK.shards) * Math.PI * 2;
          this.homes[n * 3] = Math.sin(a) * 1.1;
          this.homes[n * 3 + 1] = ((n % 3) - 1) * 0.7;
          this.homes[n * 3 + 2] = Math.cos(a) * 1.1;
        }
      }
      rig.body.add(new THREE.Mesh(this.standIn.lump, stone));
      for (let n = 0; n < LOOK.shards; n++) this.addShard(rig, this.standIn.chip, stone);
      return;
    }
    // The model is baked ONCE, whichever rig asks first: every rig draws the same
    // geometry, so the late asset costs one bake and one upload, not one per rig.
    if (this.bakedFor !== asset) {
      this.bakedFor = asset;
      this.bakedBody.length = 0;
      this.bakedShards.length = 0;
      holder.updateWorldMatrix(true, true);
      const home = new THREE.Vector3();
      const shards: Array<{ name: string; mesh: THREE.Mesh }> = [];
      holder.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        // A single-primitive mesh IS its named node; a split one hangs under it.
        const name = mesh.name.startsWith('Boulder_') ? mesh.name : (mesh.parent?.name ?? '');
        if (name.startsWith('Boulder_Shard_')) {
          shards.push({ name, mesh });
          return;
        }
        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        this.bakedBody.push({ geometry: this.bake(holder, mesh, false), material: material.name });
      });
      shards.sort((a, b) => (a.name < b.name ? -1 : 1));
      for (let n = 0; n < shards.length && n < LOOK.shards; n++) {
        this.bakedShards.push(this.bake(holder, shards[n].mesh, true, home));
        this.homes[n * 3] = home.x;
        this.homes[n * 3 + 1] = home.y;
        this.homes[n * 3 + 2] = home.z;
      }
    }
    for (let n = 0; n < this.bakedBody.length; n++) {
      const part = this.bakedBody[n];
      const baked = new THREE.Mesh(
        part.geometry,
        part.material === 'BoulderGlow' ? rig.glow : part.material === 'BoulderIron' ? iron : stone,
      );
      baked.castShadow = part.material !== 'BoulderGlow';
      rig.body.add(baked);
    }
    for (let n = 0; n < this.bakedShards.length; n++)
      this.addShard(rig, this.bakedShards[n], stone);
  }

  private addShard(
    rig: BoulderRig,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
  ): void {
    const shard = new THREE.Mesh(geometry, material);
    shard.name = 'BoulderShard';
    shard.visible = false;
    shard.castShadow = true;
    this.root.add(shard);
    rig.shards.push(shard);
  }

  sync(cues: readonly HoardBossCueView[]): void {
    if (this.disposed) return;
    for (let i = 0; i < this.rigs.length; i++) this.rigs[i].seen = false;
    for (let c = 0; c < cues.length; c++) {
      const cue = cues[c];
      if (cue.remaining <= 0) continue;
      const phase: Phase | undefined =
        cue.variant === 'brute-boulder'
          ? 'rolling'
          : cue.variant === 'brute-boulder-return'
            ? 'returning'
            : cue.variant === 'brute-boulder-crush'
              ? 'broken'
              : undefined;
      if (!phase) continue;
      let rig: BoulderRig | undefined;
      let free: BoulderRig | undefined;
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
        // A rig is reused across casts and whole runs: start it clean.
        rig.cueId = cue.cueId;
        rig.instanceId = cue.instanceId;
        rig.phase = phase;
        rig.remaining = -1;
        rig.hasFrom = false;
        rig.order = 0;
        rig.standing = 0;
        rig.countIn = 0;
        rig.broke = false;
        rig.ringFor = -1;
        rig.laneFor = -1;
        rig.hit = false;
        rig.needed = 0;
        rig.targetId = -1;
        rig.ground = this.groundY(cue.x, cue.z);
      }
      if (rig.phase !== phase) {
        // The same cue, its next beat: a new clock.
        rig.phase = phase;
        rig.remaining = -1;
        rig.broke = false;
      }
      rig.seen = true;
      rig.x = cue.x;
      rig.z = cue.z;
      if (phase === 'rolling') {
        rig.needed = Math.round(cue.innerRadius ?? 0);
        rig.targetId = cue.targetId ?? -1;
        if (!rig.hasFrom) this.findStart(rig, cues);
      } else if (phase === 'broken') {
        rig.hit = (cue.innerRadius ?? 0) >= 0.5;
      }
      rig.total = cue.total;
      if (rig.remaining !== cue.remaining) {
        rig.remaining = cue.remaining;
        rig.elapsed = Math.max(0, cue.total - cue.remaining);
        rig.fresh = true;
      }
    }
    for (let i = 0; i < this.rigs.length; i++) if (!this.rigs[i].seen) this.rigs[i].cueId = -1;
  }

  /** Every boulder starts in his hands: the carrier's place. Its id is the one
   *  (or two) below the boulder's own. */
  private findStart(rig: BoulderRig, cues: readonly HoardBossCueView[]): void {
    for (let c = 0; c < cues.length; c++) {
      const cue = cues[c];
      if (cue.variant !== 'brute-boulder-throw' || cue.instanceId !== rig.instanceId) continue;
      if (cue.cueId >= rig.cueId || cue.cueId < rig.cueId - RIGS) continue;
      rig.fromX = cue.x;
      rig.fromZ = cue.z;
      rig.order = rig.cueId - cue.cueId - 1;
      rig.hasFrom = true;
      return;
    }
  }

  update(dt: number): void {
    if (this.disposed) return;
    this.time += dt;
    const still = this.reducedMotion();
    for (let i = 0; i < this.rigs.length; i++) this.updateRig(this.rigs[i], dt, still);
    this.updateDust(dt);
  }

  private hideRig(rig: BoulderRig): void {
    if (!rig.shown) return;
    rig.shown = false;
    rig.body.visible = false;
    if (rig.shadow) rig.shadow.visible = false;
    rig.ring.mesh.visible = false;
    rig.lane.mesh.visible = false;
    for (let p = 0; p < rig.pips.length; p++) rig.pips[p].visible = false;
    for (let s = 0; s < rig.shards.length; s++) rig.shards[s].visible = false;
  }

  private updateRig(rig: BoulderRig, dt: number, still: boolean): void {
    if (!rig.seen || rig.cueId === -1) {
      this.hideRig(rig);
      return;
    }
    rig.shown = true;
    // A cue that refreshed this frame already IS now: only a stale one is
    // carried forward, so the clock never double-steps.
    if (rig.fresh) rig.fresh = false;
    else rig.elapsed = Math.min(rig.total, rig.elapsed + dt);

    if (rig.phase === 'broken') {
      this.drawBreak(rig, still);
      return;
    }
    for (let s = 0; s < rig.shards.length; s++) rig.shards[s].visible = false;
    const fromX = rig.phase === 'rolling' ? rig.fromX : rig.x;
    const fromZ = rig.phase === 'rolling' ? rig.fromZ : rig.z;
    const toX = rig.phase === 'rolling' ? rig.x : rig.fromX;
    const toZ = rig.phase === 'rolling' ? rig.z : rig.fromZ;
    const distance = Math.hypot(toX - fromX, toZ - fromZ);
    const pose =
      rig.phase === 'rolling'
        ? boulderPose(rig.elapsed, rig.total, this.travelOf(rig), distance, rig.pose)
        : boulderReturnPose(rig.elapsed, rig.total, distance, rig.pose);

    // ---- the boulder
    const drawn = rig.hasFrom && pose.scale > 0.01;
    rig.body.visible = drawn;
    if (rig.shadow) rig.shadow.visible = drawn;
    if (drawn) {
      const x = fromX + (toX - fromX) * pose.progress;
      const z = fromZ + (toZ - fromZ) * pose.progress;
      const ground = this.groundY(x, z);
      const tremble = still || pose.progress > 0 ? 0 : 0.05 * Math.sin(this.time * 38) * pose.scale;
      rig.body.position.set(x + tremble, ground + pose.height, z);
      rig.body.scale.setScalar(pose.scale);
      if (distance > 1e-3) {
        // Rolling forward turns it about the axis across its path.
        this.axis.set((toZ - fromZ) / distance, 0, -(toX - fromX) / distance);
        rig.body.quaternion.setFromAxisAngle(this.axis, pose.roll);
      }
      rig.glow.color.setHex(LOOK.glow).multiplyScalar(0.35 + 0.65 * pose.heat);
      if (rig.shadow) {
        const high = Math.max(0, pose.height - BOULDER.boulderRadius);
        rig.shadow.position.set(x, ground + 0.05, z);
        rig.shadow.scale.setScalar(BOULDER.boulderRadius * pose.scale * (1 + high * 0.04));
        rig.shadow.material.opacity = 0.5 / (1 + high * 0.18);
      }
      if (this.dust && !still && pose.dust > 0 && this.random() < pose.dust) {
        this.emit(
          x + (this.random() - 0.5) * 2.4,
          ground + 0.2,
          z + (this.random() - 0.5) * 2.4,
          (this.random() - 0.5) * 3,
          1.5 + this.random() * 3,
          (this.random() - 0.5) * 3,
          0.3 + this.random() * 0.3,
          0.7,
        );
      }
    }

    // ---- what the party reads off the floor
    const group = rig.phase === 'rolling' && rig.needed > 0;
    const alone = rig.phase === 'rolling' && rig.needed <= 0 && rig.hasFrom;
    rig.ring.mesh.visible = group;
    rig.lane.mesh.visible = alone;
    if (group) {
      rig.countIn -= dt;
      if (rig.countIn <= 0) {
        rig.countIn = COUNT_EVERY;
        rig.standing = this.countStanding(rig);
      }
      supportRing(rig.elapsed, rig.needed, rig.standing, this.ringLook);
      // The ring drawn, the pips drawn and the ring counted are ONE circle: it is
      // re-written whenever the mark it rides has moved.
      if (rig.ringFor !== rig.cueId || rig.ringX !== rig.x || rig.ringZ !== rig.z) {
        rig.ringFor = rig.cueId;
        rig.ringX = rig.x;
        rig.ringZ = rig.z;
        this.writeRing(rig);
      }
      const pulse = still ? 1 : 0.85 + 0.15 * Math.sin(this.time * 7);
      rig.ring.material.uniforms.gain.value =
        this.ringLook.ring * (0.45 + 0.4 * this.ringLook.answered) * pulse;
      for (let p = 0; p < rig.pips.length; p++) {
        const pip = rig.pips[p];
        const used = p < this.ringLook.pips;
        pip.visible = used;
        if (!used) continue;
        const bearing = (p / this.ringLook.pips) * Math.PI * 2 + Math.PI / 4;
        pip.position.set(
          rig.x + Math.sin(bearing) * BOULDER.supportRadius,
          rig.ground + 0.12,
          rig.z + Math.cos(bearing) * BOULDER.supportRadius,
        );
        const lit = p < rig.standing;
        pip.scale.setScalar(lit ? 0.85 : 0.55);
        pip.material.color.setHex(lit ? LOOK.stand : LOOK.standDim);
        pip.material.opacity = this.ringLook.ring * (lit ? 1 : 0.7);
      }
    } else {
      for (let p = 0; p < rig.pips.length; p++) rig.pips[p].visible = false;
    }
    if (alone) {
      if (rig.laneFor !== rig.cueId) {
        rig.laneFor = rig.cueId;
        this.writeLane(rig);
      }
      rig.lane.material.uniforms.gain.value = Math.min(1, rig.elapsed / 0.2);
    }
  }

  /** The roll's share of a rolling cue: what is left after the warning, and
   *  after the stagger a second boulder waits out (its place after the carrier
   *  says which it is). Exactly the sim's number, whatever rarity pressed it to. */
  private travelOf(rig: BoulderRig): number {
    return Math.max(1e-3, rig.total - BOULDER.warningSec - rig.order * BOULDER.doubleStaggerSec);
  }

  private countStanding(rig: BoulderRig): number {
    const world = this.world;
    if (!world) return 0;
    let standing = 0;
    for (const entity of world.entities.values()) {
      if (entity.kind !== 'player' || entity.dead || entity.id === rig.targetId) continue;
      if (standsWith(rig.x, rig.z, entity.pos.x, entity.pos.z)) standing++;
    }
    return standing;
  }

  private writeRing(rig: BoulderRig): void {
    const y = rig.ground + 0.08;
    const inner = BOULDER.supportRadius - 0.55;
    for (let column = 0; column <= RING_SEGMENTS; column++) {
      const bearing = (column / RING_SEGMENTS) * Math.PI * 2;
      const sx = Math.sin(bearing);
      const sz = Math.cos(bearing);
      rig.ring.position.setXYZ(column * 2, rig.x + sx * inner, y, rig.z + sz * inner);
      rig.ring.position.setXYZ(
        column * 2 + 1,
        rig.x + sx * BOULDER.supportRadius,
        y,
        rig.z + sz * BOULDER.supportRadius,
      );
      rig.ring.alpha.setX(column * 2, 0.25);
      rig.ring.alpha.setX(column * 2 + 1, 1);
    }
    rig.ring.position.needsUpdate = true;
    rig.ring.alpha.needsUpdate = true;
  }

  /** Alone there is no ring: the lane the boulder will run, as wide as it is. */
  private writeLane(rig: BoulderRig): void {
    const dx = rig.x - rig.fromX;
    const dz = rig.z - rig.fromZ;
    const length = Math.max(1e-6, Math.hypot(dx, dz));
    const px = (dz / length) * BOULDER.boulderRadius;
    const pz = (-dx / length) * BOULDER.boulderRadius;
    const y = rig.ground + 0.22;
    rig.lane.position.setXYZ(0, rig.fromX - px, y, rig.fromZ - pz);
    rig.lane.position.setXYZ(1, rig.fromX + px, y, rig.fromZ + pz);
    rig.lane.position.setXYZ(2, rig.x - px, y, rig.z - pz);
    rig.lane.position.setXYZ(3, rig.x + px, y, rig.z + pz);
    for (let i = 0; i < 4; i++) rig.lane.alpha.setX(i, i < 2 ? 0.3 : 0.55);
    rig.lane.position.needsUpdate = true;
    rig.lane.alpha.needsUpdate = true;
  }

  private drawBreak(rig: BoulderRig, still: boolean): void {
    rig.body.visible = false;
    if (rig.shadow) rig.shadow.visible = false;
    rig.ring.mesh.visible = false;
    rig.lane.mesh.visible = false;
    for (let p = 0; p < rig.pips.length; p++) rig.pips[p].visible = false;
    if (!rig.broke) {
      rig.broke = true;
      this.burst(rig.x, rig.ground + 1, rig.z, 70, 9, 7);
      if (rig.hit && !still && !this.low) this.shake?.(0.14);
    }
    for (let s = 0; s < rig.shards.length; s++) {
      const shard = rig.shards[s];
      shardFlight(
        s,
        rig.elapsed,
        this.homes[s * 3],
        this.homes[s * 3 + 1],
        this.homes[s * 3 + 2],
        this.flight,
      );
      shard.visible = this.flight.scale > 0.01;
      if (!shard.visible) continue;
      shard.position.set(
        rig.x + this.flight.x,
        rig.ground + BOULDER.boulderRadius + this.flight.y,
        rig.z + this.flight.z,
      );
      shard.rotation.set(this.flight.spin, this.flight.spin * 0.7, 0);
      shard.scale.setScalar(this.flight.scale);
    }
  }

  private burst(x: number, y: number, z: number, count: number, speed: number, lift: number): void {
    if (!this.dust) return;
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
        0.3 + this.random() * 0.35,
        0.7 + this.random() * 0.6,
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
    const dust = this.dust;
    if (!dust) return;
    const i = dust.cursor;
    dust.cursor = (i + 1) % DUST;
    dust.position.setXYZ(i, x, y, z);
    dust.velocity[i * 3] = vx;
    dust.velocity[i * 3 + 1] = vy;
    dust.velocity[i * 3 + 2] = vz;
    dust.size.setX(i, size);
    dust.life[i] = life;
    dust.span[i] = life;
    dust.live++;
    dust.size.needsUpdate = true;
  }

  private updateDust(dt: number): void {
    const dust = this.dust;
    if (!dust || dust.live === 0) return;
    let alive = 0;
    for (let i = 0; i < DUST; i++) {
      if (dust.life[i] <= 0) continue;
      dust.life[i] -= dt;
      if (dust.life[i] <= 0) {
        dust.alpha.setX(i, 0);
        continue;
      }
      alive++;
      dust.velocity[i * 3 + 1] -= 7 * dt;
      dust.position.setXYZ(
        i,
        dust.position.getX(i) + dust.velocity[i * 3] * dt,
        dust.position.getY(i) + dust.velocity[i * 3 + 1] * dt,
        dust.position.getZ(i) + dust.velocity[i * 3 + 2] * dt,
      );
      dust.alpha.setX(i, Math.min(1, (dust.life[i] / dust.span[i]) * 1.5) * 0.45);
    }
    dust.live = alive;
    dust.points.visible = alive > 0;
    dust.position.needsUpdate = true;
    dust.alpha.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.clear();
    this.materials.clear();
  }
}
