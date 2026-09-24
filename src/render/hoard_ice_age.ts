// Hoarfrost's Ice Age, drawn from the authoritative hoard cues. WHEN things
// happen is the shared sim clock (src/sim/rift/hoard_ice_age_core.ts) sampled at
// the cue's own life, and the lee painted on the floor is the sim's own cover
// test, so what reads as safe IS safe; how it LOOKS is hoard_ice_age_core.ts
// beside this file.
//
// What is Blender and what is runtime: the pillars are Blender models, three
// variants, each pre-fractured into chunks (docs/design/ice-age/). Everything
// that depends on the moment is code: the shadow and the fall, the landing, the
// lee, the gathering cast, the wind that splits round the pillars, the pressure
// wave, the strain in the seams and the scripted break-up. No physics.
//
// Performance contract (the siblings' contract): every geometry and material is
// built once here and attached through the scene gate, so nothing compiles
// mid-fight; no dynamic lights; no per-frame allocation; the idle frame is a few
// branches. The low tier sheds the dust, the bursts, the mist, the floor frost and
// most of the gusts. It NEVER sheds what a player acts on: the shadow, the pillar,
// the lee and the storm's wave and snow draw on every tier.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../game/ui_effects_profile';
import {
  ICE_AGE,
  ICE_PILLAR_VARIANTS,
  icePillarCovers,
  icePillarVariantOf,
} from '../sim/rift/hoard_ice_age_core';
import type { HoardBossCueView } from '../world_api/dungeons';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { attachSceneGroupGated } from './gated_scene_attach';
import { GFX, type GfxTier, surfaceMat } from './gfx';
import { glowMaterial, ribbonMaterial, sparkMaterial, strip } from './hoard_fx_materials';
import {
  type ChunkFlight,
  chunkFlight,
  type IciclePose,
  iciclePose,
  ICE_AGE_LOOK as LOOK,
  type StormPose,
  stormPose,
  writeLeeStrip,
} from './hoard_ice_age_core';
import { setRenderCategory } from './renderer_diagnostics';

export const ICE_AGE_ASSET_URL = '/vfx/ice-age/pillars.glb';
const VARIANT_LETTERS = ['A', 'B', 'C'] as const;
let source: THREE.Group | undefined;
let loading: Promise<THREE.Group | undefined> | undefined;
function loadSource(): Promise<THREE.Group | undefined> {
  loading ??= loadGltf(ICE_AGE_ASSET_URL)
    .then((gltf) => {
      source = gltf.scene;
      return source;
    })
    .catch(() => undefined);
  return loading;
}
if (typeof window !== 'undefined') registerDeferredPreload(loadSource);

const BURSTS = 240;
const SNOW = 520;
const SNOW_LOW = 150;
const GUSTS = 170;
const GUSTS_LOW = 48;
const WIND_REACH = 58;

interface Chunk {
  node: THREE.Group;
  restX: number;
  restY: number;
  restZ: number;
  /** Unit radial direction off the pillar's axis, and a per-chunk 0.7 to 1.3. */
  radialX: number;
  radialZ: number;
  vigor: number;
}

interface PillarRig {
  instanceId: number;
  cueId: number;
  seen: boolean;
  fresh: boolean;
  x: number;
  z: number;
  ground: number;
  total: number;
  remaining: number;
  elapsed: number;
  landed: boolean;
  struck: boolean;
  broke: boolean;
  leeFor: number;
  /** Whether any of this rig's pieces may be visible: the one hide guard. */
  shown: boolean;
  root: THREE.Group;
  body: THREE.Group;
  chunks: Chunk[];
  extras: THREE.Group;
  cracks: THREE.MeshBasicMaterial;
  shadow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  shadowRing: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  shock: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  frost: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  mist: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  lee: ReturnType<typeof strip> & { mesh: THREE.Mesh; material: THREE.ShaderMaterial };
  leeEdge: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  pose: IciclePose;
}

function emptyPose(): IciclePose {
  return {
    shadow: 0,
    shadowScale: 1,
    dust: 0,
    visible: false,
    drop: 0,
    impact: 0,
    lee: 0,
    crack: 0,
    shake: 0,
    shatter: 0,
    mist: 0,
  };
}

export class HoardIceAgeFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private readonly low: boolean;
  private disposed = false;
  private time = 0;
  private seed = 1;

  private readonly rigs: PillarRig[] = [];

  // ---- the storm (the carrier cue)
  private stormCueId = -1;
  private stormInstanceId = -1;
  private stormSeen = false;
  private stormFresh = false;
  private stormX = 0;
  private stormZ = 0;
  private stormGround = 0;
  private stormTotal = 0;
  private stormRemaining = -1;
  private stormElapsed = 0;
  private stormBlasted = false;
  /** Whether any storm piece may be visible: the one hide guard. */
  private stormShown = false;
  private readonly storm: StormPose = {
    gather: 0,
    frostRadius: 0,
    frost: 0,
    windSpeed: 0,
    wind: 0,
    waveRadius: 0,
    wave: 0,
    sheltering: false,
  };
  private readonly gather: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly floorFrost?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly wave: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly waveGlow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

  // ---- wind: snow that runs from the boss, and the gusts that carry it
  private readonly snowCount: number;
  private readonly snow: {
    points: THREE.Points;
    position: THREE.BufferAttribute;
    size: THREE.BufferAttribute;
    alpha: THREE.BufferAttribute;
    angle: Float32Array;
    distance: Float32Array;
    height: Float32Array;
    pace: Float32Array;
  };
  private readonly gustCount: number;
  private readonly gusts: {
    mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    position: THREE.BufferAttribute;
    alpha: THREE.BufferAttribute;
    angle: Float32Array;
    distance: Float32Array;
    height: Float32Array;
    pace: Float32Array;
    length: Float32Array;
    width: Float32Array;
  };

  // ---- bursts: landing shards, storm spray, break-up motes
  private readonly bursts?: {
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

  private readonly flight: ChunkFlight = { x: 0, y: 0, z: 0, spin: 0, scale: 1 };
  private readonly leeScratch = new Float32Array((LOOK.leeSegments + 1) * 4);

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    private readonly shake?: (amount: number) => void,
    effectsTier: GfxTier = GFX.tier,
    asset: THREE.Group | Promise<THREE.Group | undefined> | undefined = source,
  ) {
    this.root.name = 'hoard-ice-age';
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

    const card = this.own(new THREE.PlaneGeometry(1, 1));
    const disc = this.own(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2));
    const ring = this.own(new THREE.RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2));
    const band = this.own(new THREE.RingGeometry(0.72, 1, 72).rotateX(-Math.PI / 2));

    for (let v = 0; v < ICE_PILLAR_VARIANTS; v++) {
      this.rigs.push(this.makeRig(initial, v, card, disc, ring));
    }

    this.gather = new THREE.Mesh(card, this.keep(glowMaterial(LOOK.glow, false)));
    this.gather.visible = false;
    this.gather.frustumCulled = false;
    this.gather.renderOrder = 27;
    this.root.add(this.gather);
    if (!this.low) {
      this.floorFrost = new THREE.Mesh(disc, this.keep(this.basic(LOOK.chill, 0, false)));
      this.floorFrost.visible = false;
      this.floorFrost.frustumCulled = false;
      this.floorFrost.renderOrder = 16;
      this.root.add(this.floorFrost);
    }
    this.wave = new THREE.Mesh(ring, this.keep(this.basic(0xffffff, 0, true)));
    this.wave.name = 'IceAgeWave';
    this.waveGlow = new THREE.Mesh(band, this.keep(this.basic(LOOK.wave, 0, false)));
    for (const mesh of [this.wave, this.waveGlow]) {
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 24;
      this.root.add(mesh);
    }

    // ---- snow
    this.snowCount = this.low ? SNOW_LOW : SNOW;
    {
      const geometry = this.own(new THREE.BufferGeometry());
      const position = new THREE.BufferAttribute(new Float32Array(this.snowCount * 3), 3);
      const size = new THREE.BufferAttribute(new Float32Array(this.snowCount), 1);
      const alpha = new THREE.BufferAttribute(new Float32Array(this.snowCount), 1);
      const tint = new THREE.BufferAttribute(new Float32Array(this.snowCount * 3), 3);
      position.setUsage(THREE.DynamicDrawUsage);
      alpha.setUsage(THREE.DynamicDrawUsage);
      const angle = new Float32Array(this.snowCount);
      const distance = new Float32Array(this.snowCount);
      const height = new Float32Array(this.snowCount);
      const pace = new Float32Array(this.snowCount);
      const color = new THREE.Color(LOOK.storm);
      for (let i = 0; i < this.snowCount; i++) {
        angle[i] = this.random() * Math.PI * 2;
        distance[i] = this.random() * WIND_REACH;
        height[i] = 0.3 + this.random() * this.random() * 9;
        pace[i] = 0.7 + this.random() * 0.6;
        size.setX(i, 0.3 + this.random() * 0.45);
        tint.setXYZ(i, color.r, color.g, color.b);
      }
      geometry.setAttribute('position', position);
      geometry.setAttribute('size', size);
      geometry.setAttribute('alpha', alpha);
      geometry.setAttribute('tint', tint);
      const points = new THREE.Points(geometry, this.keep(sparkMaterial()));
      points.name = 'IceAgeSnow';
      points.visible = false;
      points.frustumCulled = false;
      points.renderOrder = 28;
      this.root.add(points);
      this.snow = { points, position, size, alpha, angle, distance, height, pace };
    }
    // ---- gusts (fewer on the low tier, never none: they ARE the storm on snow)
    this.gustCount = this.low ? GUSTS_LOW : GUSTS;
    {
      const count = this.gustCount;
      const geometry = this.own(new THREE.BufferGeometry());
      const position = new THREE.BufferAttribute(new Float32Array(count * 12), 3);
      const alpha = new THREE.BufferAttribute(new Float32Array(count * 4), 1);
      position.setUsage(THREE.DynamicDrawUsage);
      alpha.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('position', position);
      geometry.setAttribute('alpha', alpha);
      const index: number[] = [];
      for (let i = 0; i < count; i++) {
        const v = i * 4;
        index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
      geometry.setIndex(index);
      const angle = new Float32Array(count);
      const distance = new Float32Array(count);
      const height = new Float32Array(count);
      const pace = new Float32Array(count);
      const length = new Float32Array(count);
      const width = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        angle[i] = this.random() * Math.PI * 2;
        distance[i] = this.random() * WIND_REACH;
        height[i] = 0.35 + this.random() * 3.4;
        pace[i] = 0.75 + this.random() * 0.5;
        length[i] = 3 + this.random() * 6.5;
        width[i] = 0.3 + this.random() * 0.6;
      }
      const mesh = new THREE.Mesh(geometry, this.keep(ribbonMaterial(LOOK.gust, false)));
      mesh.name = 'IceAgeGusts';
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 27;
      this.root.add(mesh);
      this.gusts = { mesh, position, alpha, angle, distance, height, pace, length, width };
    }
    if (!this.low) {
      const burstGeometry = this.own(new THREE.BufferGeometry());
      const burstPosition = new THREE.BufferAttribute(new Float32Array(BURSTS * 3), 3);
      const burstSize = new THREE.BufferAttribute(new Float32Array(BURSTS), 1);
      const burstAlpha = new THREE.BufferAttribute(new Float32Array(BURSTS), 1);
      const burstTint = new THREE.BufferAttribute(new Float32Array(BURSTS * 3), 3);
      burstPosition.setUsage(THREE.DynamicDrawUsage);
      burstSize.setUsage(THREE.DynamicDrawUsage);
      burstAlpha.setUsage(THREE.DynamicDrawUsage);
      const frost = new THREE.Color(LOOK.frost);
      for (let i = 0; i < BURSTS; i++) burstTint.setXYZ(i, frost.r, frost.g, frost.b);
      burstGeometry.setAttribute('position', burstPosition);
      burstGeometry.setAttribute('size', burstSize);
      burstGeometry.setAttribute('alpha', burstAlpha);
      burstGeometry.setAttribute('tint', burstTint);
      const points = new THREE.Points(burstGeometry, this.keep(sparkMaterial()));
      points.visible = false;
      points.frustumCulled = false;
      points.renderOrder = 29;
      this.root.add(points);
      this.bursts = {
        points,
        position: burstPosition,
        size: burstSize,
        alpha: burstAlpha,
        velocity: new Float32Array(BURSTS * 3),
        life: new Float32Array(BURSTS),
        span: new Float32Array(BURSTS),
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
          this.rigs.forEach((rig, v) => {
            this.buildBody(rig, loaded, v);
          });
        }
        await attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed);
      })
      .catch(() => {});
  }

  /** A small deterministic generator: the look never needs the sim's rng, and a
   *  seeded stream keeps a captured frame reproducible. */
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

  private makeRig(
    asset: THREE.Group | undefined,
    variant: number,
    card: THREE.BufferGeometry,
    disc: THREE.BufferGeometry,
    ring: THREE.BufferGeometry,
  ): PillarRig {
    const lee = strip(LOOK.leeSegments);
    this.own(lee.geometry);
    const leeMaterial = this.keep(ribbonMaterial(LOOK.lee, false));
    const leeMesh = new THREE.Mesh(lee.geometry, leeMaterial);
    // Its outline: a dark line that reads on snow where a soft fill alone would not.
    const edgeGeometry = this.own(new THREE.BufferGeometry());
    const edgePosition = new THREE.BufferAttribute(
      new Float32Array((LOOK.leeSegments + 1) * 2 * 3),
      3,
    );
    edgePosition.setUsage(THREE.DynamicDrawUsage);
    edgeGeometry.setAttribute('position', edgePosition);
    const leeEdge = new THREE.LineLoop(
      edgeGeometry,
      this.keep(
        new THREE.LineBasicMaterial({
          color: LOOK.leeEdge,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          toneMapped: false,
        }),
      ),
    );
    leeEdge.visible = false;
    leeEdge.frustumCulled = false;
    leeEdge.renderOrder = 21;
    const rig: PillarRig = {
      instanceId: -1,
      cueId: -1,
      seen: false,
      fresh: false,
      x: 0,
      z: 0,
      ground: 0,
      total: 0,
      remaining: -1,
      elapsed: 0,
      landed: false,
      struck: false,
      broke: false,
      leeFor: -1,
      shown: false,
      root: new THREE.Group(),
      body: new THREE.Group(),
      chunks: [],
      extras: new THREE.Group(),
      cracks: this.keep(this.basic(LOOK.glow, 0.2, true)),
      shadow: new THREE.Mesh(disc, this.keep(this.basic(LOOK.shadow, 0, false))),
      shadowRing: new THREE.Mesh(ring, this.keep(this.basic(LOOK.glow, 0, true))),
      shock: new THREE.Mesh(ring, this.keep(this.basic(LOOK.wave, 0, false))),
      frost: new THREE.Mesh(disc, this.keep(this.basic(LOOK.chill, 0, false))),
      mist: new THREE.Mesh(card, this.keep(glowMaterial(LOOK.frost, false))),
      lee: { ...lee, mesh: leeMesh, material: leeMaterial },
      leeEdge,
      pose: emptyPose(),
    };
    rig.root.name = 'IcePillar';
    rig.shadow.name = 'IcicleShadow';
    leeMesh.name = 'IceLee';
    rig.root.visible = false;
    rig.root.add(rig.body, rig.mist);
    rig.body.add(rig.extras);
    for (const mesh of [rig.shadow, rig.shadowRing, rig.shock, rig.frost]) {
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.root.add(mesh);
    }
    // Near-coplanar, depth-write-free layers: each its own order, so the stack
    // never reshuffles as the camera orbits.
    rig.frost.renderOrder = 17;
    rig.shadow.renderOrder = 18;
    rig.shadowRing.renderOrder = 19;
    rig.shock.renderOrder = 22;
    rig.mist.visible = false;
    rig.mist.frustumCulled = false;
    rig.mist.renderOrder = 26;
    leeMesh.visible = false;
    leeMesh.frustumCulled = false;
    leeMesh.renderOrder = 20;
    this.root.add(leeMesh, leeEdge, rig.root);
    this.buildBody(rig, asset, variant);
    return rig;
  }

  /** The pillar: the Blender chunks in the game's own surface material, the
   *  seams on a material of ours so they can strain. A plain stand-in of the same
   *  footprint serves until (or unless) the asset arrives. */
  private buildBody(rig: PillarRig, asset: THREE.Group | undefined, variant: number): void {
    rig.body.clear();
    rig.extras.clear();
    rig.body.add(rig.extras);
    rig.chunks.length = 0;
    const ice = surfaceMat({
      color: LOOK.ice,
      roughness: 0.2,
      emissive: LOOK.ice,
      emissiveIntensity: 0.34,
      flatShading: true,
    });
    const deep = surfaceMat({
      color: LOOK.iceDeep,
      roughness: 0.3,
      emissive: LOOK.iceDeep,
      emissiveIntensity: 0.7,
      flatShading: true,
    });
    const frost = surfaceMat({
      color: LOOK.frost,
      roughness: 0.9,
      emissive: LOOK.frost,
      emissiveIntensity: 0.18,
      flatShading: true,
    });
    const pick = (name: string): THREE.Material =>
      name === 'IceGlow' ? rig.cracks : name === 'IceDeep' ? deep : name === 'Frost' ? frost : ice;
    const holder = asset?.getObjectByName(`IcePillar_${VARIANT_LETTERS[variant]}_ROOT`);
    if (!holder) {
      // Owned like everything else and freed once at dispose: when the late asset
      // replaces it the stand-in is only detached, never separately released.
      const stand = new THREE.Mesh(
        this.own(new THREE.ConeGeometry(ICE_AGE.pillarRadius * 0.9, 10, 6).translate(0, 5, 0)),
        ice,
      );
      const node = new THREE.Group();
      node.add(stand);
      rig.body.add(node);
      rig.chunks.push({ node, restX: 0, restY: 0, restZ: 0, radialX: 0, radialZ: 1, vigor: 1 });
      return;
    }
    holder.updateWorldMatrix(true, true);
    const inverse = new THREE.Matrix4().copy(holder.matrixWorld).invert();
    const v = new THREE.Vector3();
    const local = new THREE.Matrix4();
    for (const part of holder.children) {
      const meshes: THREE.Mesh[] = [];
      part.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh);
      });
      if (meshes.length === 0) continue;
      const isChunk = part.name.includes('_Chunk_');
      // The shipped GLB is quantized: its positions are normalized integers that
      // the NODE transform scales back up. Bake through fromBufferAttribute (which
      // denormalizes) into floats, in the pillar's own frame.
      const baked: Array<{ positions: Float32Array; index: number[] | null; name: string }> = [];
      let cx = 0;
      let cy = 0;
      let cz = 0;
      let count = 0;
      for (const mesh of meshes) {
        local.multiplyMatrices(inverse, mesh.matrixWorld);
        const from = mesh.geometry.getAttribute('position');
        const positions = new Float32Array(from.count * 3);
        for (let i = 0; i < from.count; i++) {
          v.fromBufferAttribute(from, i).applyMatrix4(local);
          positions[i * 3] = v.x;
          positions[i * 3 + 1] = v.y;
          positions[i * 3 + 2] = v.z;
          cx += v.x;
          cy += v.y;
          cz += v.z;
          count++;
        }
        const index = mesh.geometry.getIndex();
        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        baked.push({
          positions,
          index: index ? Array.from(index.array) : null,
          name: material.name,
        });
      }
      cx /= Math.max(1, count);
      cy /= Math.max(1, count);
      cz /= Math.max(1, count);
      const node = new THREE.Group();
      // A chunk turns about its own middle when it is thrown; the rest stay put.
      if (isChunk) node.position.set(cx, cy, cz);
      for (const entry of baked) {
        if (isChunk) {
          for (let i = 0; i < entry.positions.length; i += 3) {
            entry.positions[i] -= cx;
            entry.positions[i + 1] -= cy;
            entry.positions[i + 2] -= cz;
          }
        }
        const geometry = this.own(new THREE.BufferGeometry());
        geometry.setAttribute('position', new THREE.BufferAttribute(entry.positions, 3));
        if (entry.index) geometry.setIndex(entry.index);
        const mesh = new THREE.Mesh(geometry, pick(entry.name));
        mesh.castShadow = entry.name !== 'IceGlow';
        if (entry.name === 'IceGlow') mesh.renderOrder = 23;
        node.add(mesh);
      }
      if (!isChunk) {
        rig.extras.add(node);
        continue;
      }
      rig.body.add(node);
      const away = Math.hypot(cx, cz);
      const bearing = this.random() * Math.PI * 2;
      rig.chunks.push({
        node,
        restX: cx,
        restY: cy,
        restZ: cz,
        radialX: away > 0.05 ? cx / away : Math.sin(bearing),
        radialZ: away > 0.05 ? cz / away : Math.cos(bearing),
        vigor: 0.75 + this.random() * 0.55,
      });
    }
  }

  sync(cues: readonly HoardBossCueView[]): void {
    if (this.disposed) return;
    this.stormSeen = false;
    for (let i = 0; i < this.rigs.length; i++) this.rigs[i].seen = false;
    for (let c = 0; c < cues.length; c++) {
      const cue = cues[c];
      if (cue.remaining <= 0) continue;
      if (cue.variant === 'frost-iceage') {
        this.stormSeen = true;
        if (this.stormCueId !== cue.cueId || this.stormInstanceId !== cue.instanceId) {
          this.stormCueId = cue.cueId;
          this.stormInstanceId = cue.instanceId;
          this.stormRemaining = -1;
          this.stormBlasted = false;
          this.stormGround = this.groundY(cue.x, cue.z);
        }
        this.stormX = cue.x;
        this.stormZ = cue.z;
        this.stormTotal = cue.total;
        if (this.stormRemaining !== cue.remaining) {
          this.stormRemaining = cue.remaining;
          this.stormElapsed = Math.max(0, cue.total - cue.remaining);
          this.stormFresh = true;
        }
      } else if (cue.variant === 'frost-pillar') {
        // The rig already following this cue, else the one its variant names,
        // else any free one.
        let rig: PillarRig | undefined;
        for (let i = 0; i < this.rigs.length; i++) {
          const candidate = this.rigs[i];
          if (candidate.cueId === cue.cueId && candidate.instanceId === cue.instanceId) {
            rig = candidate;
            break;
          }
        }
        if (!rig) {
          const named = this.rigs[icePillarVariantOf(cue.cueId)];
          if (named.cueId === -1) rig = named;
          else
            for (let i = 0; i < this.rigs.length && !rig; i++) {
              if (this.rigs[i].cueId === -1) rig = this.rigs[i];
            }
          if (!rig) continue;
          rig.cueId = cue.cueId;
          rig.instanceId = cue.instanceId;
          rig.remaining = -1;
          rig.landed = false;
          // The lee is written once per ACQUISITION: cue ids restart with every
          // hoard, so a strip kept by id alone could paint another room's cover.
          rig.leeFor = -1;
          rig.struck = false;
          rig.broke = false;
          rig.ground = this.groundY(cue.x, cue.z);
        }
        rig.seen = true;
        rig.x = cue.x;
        rig.z = cue.z;
        rig.total = cue.total;
        if (rig.remaining !== cue.remaining) {
          rig.remaining = cue.remaining;
          rig.elapsed = Math.max(0, cue.total - cue.remaining);
          rig.fresh = true;
        }
      }
    }
    if (!this.stormSeen) this.stormCueId = -1;
    for (let i = 0; i < this.rigs.length; i++) if (!this.rigs[i].seen) this.rigs[i].cueId = -1;
  }

  update(dt: number): void {
    if (this.disposed) return;
    this.time += dt;
    this.updateStorm(dt);
    for (let i = 0; i < this.rigs.length; i++) this.updatePillar(this.rigs[i], dt);
    this.updateBursts(dt);
  }

  private hidePillar(rig: PillarRig): void {
    if (!rig.shown) return;
    rig.shown = false;
    rig.root.visible = false;
    rig.shadow.visible = false;
    rig.shadowRing.visible = false;
    rig.shock.visible = false;
    rig.frost.visible = false;
    rig.mist.visible = false;
    rig.lee.mesh.visible = false;
    rig.leeEdge.visible = false;
  }

  private updatePillar(rig: PillarRig, dt: number): void {
    if (!rig.seen || rig.cueId === -1) {
      this.hidePillar(rig);
      return;
    }
    // A cue that refreshed this frame already IS now (online it refreshes every
    // frame): only a stale one is carried forward, so the clock never double-steps.
    rig.shown = true;
    if (rig.fresh) rig.fresh = false;
    else rig.elapsed = Math.min(rig.total, rig.elapsed + dt);
    const pose = iciclePose(rig.elapsed, rig.total, rig.pose);
    const still = this.reducedMotion();
    const ground = rig.ground;

    // ---- the shadow: where it will land, and how close it is
    const warned = pose.shadow > 0;
    rig.shadow.visible = warned;
    rig.shadowRing.visible = warned;
    if (warned) {
      const radius = ICE_AGE.impactRadius * pose.shadowScale;
      rig.shadow.position.set(rig.x, ground + 0.06, rig.z);
      rig.shadow.scale.set(radius, 1, radius);
      rig.shadow.material.opacity = pose.shadow;
      rig.shadowRing.position.set(rig.x, ground + 0.08, rig.z);
      rig.shadowRing.scale.set(ICE_AGE.impactRadius, 1, ICE_AGE.impactRadius);
      rig.shadowRing.material.opacity = 0.35 + 0.5 * pose.shadow;
      if (pose.dust > 0 && this.bursts && this.random() < pose.dust * 0.6) {
        const a = this.random() * Math.PI * 2;
        const r = this.random() * ICE_AGE.impactRadius * 0.8;
        this.emit(
          rig.x + Math.sin(a) * r,
          ground + 9 + this.random() * 5,
          rig.z + Math.cos(a) * r,
          0,
          -9,
          0,
          0.16,
          0.9,
        );
      }
    }

    // ---- the icicle, then the pillar
    rig.root.visible = pose.visible;
    if (pose.visible) {
      const jitter = still ? 0 : pose.shake;
      rig.root.position.set(
        rig.x + (jitter ? Math.sin(this.time * 71) * jitter : 0),
        ground + pose.drop,
        rig.z + (jitter ? Math.cos(this.time * 83) * jitter : 0),
      );
      const squash = still ? 0 : pose.impact * pose.impact * 0.07 * Math.sin(pose.impact * 22);
      rig.body.scale.set(1 - squash * 0.5, 1 + squash, 1 - squash * 0.5);
      rig.cracks.opacity = Math.min(1, pose.crack * (0.85 + 0.15 * Math.sin(this.time * 9)));
      this.poseChunks(rig, pose.shatter);
    }

    // ---- the landing
    // Landed is a fact of the clock, never of having watched it land: a client
    // that arrives mid-cast still gets a pillar that splits the wind.
    if (!rig.landed && pose.visible && pose.drop === 0) {
      rig.landed = true;
      if (pose.impact > 0.5) {
        this.burst(rig.x, ground + 0.4, rig.z, 46, 11, 9, 0.34, 1.1);
        if (!still && !this.low) this.shake?.(0.1);
      }
    }
    const ringing = pose.impact > 0 && pose.shatter === 0;
    rig.shock.visible = ringing;
    if (ringing) {
      const spread = ICE_AGE.impactRadius * (0.5 + 1.9 * (1 - pose.impact));
      rig.shock.position.set(rig.x, ground + 0.1, rig.z);
      rig.shock.scale.set(spread, 1, spread);
      rig.shock.material.opacity = 0.85 * pose.impact * pose.impact;
    }
    const frosted = rig.landed && !this.low;
    rig.frost.visible = frosted;
    if (frosted) {
      const fade = 1 - pose.shatter;
      rig.frost.position.set(rig.x, ground + 0.05, rig.z);
      const reach = ICE_AGE.impactRadius * (1.05 + 0.25 * (1 - pose.impact));
      rig.frost.scale.set(reach, 1, reach);
      rig.frost.material.opacity = 0.3 * fade;
    }

    // ---- the lee: THIS is cover
    const sheltering = pose.lee > 0 && this.stormCueId !== -1;
    if (sheltering && rig.leeFor !== rig.cueId && this.writeLee(rig)) rig.leeFor = rig.cueId;
    // Never a strip this cue did not write.
    const drawn = sheltering && rig.leeFor === rig.cueId;
    rig.lee.mesh.visible = drawn;
    rig.leeEdge.visible = drawn;
    if (drawn) {
      rig.lee.material.uniforms.gain.value =
        pose.lee * (0.78 + (still ? 0.06 : 0.08 * Math.sin(this.time * 4.2)));
      rig.leeEdge.material.opacity = Math.min(1, pose.lee * 1.3);
    }

    // ---- the storm against it, and the break-up
    if (!rig.struck && pose.crack >= 1) {
      rig.struck = true;
      this.sprayFront(rig, 30);
    } else if (rig.struck && pose.shatter === 0 && !this.low) {
      this.sprayFront(rig, 3);
    }
    if (!rig.broke && pose.shatter > 0) {
      rig.broke = true;
      this.burst(rig.x, ground + 4, rig.z, 70, 13, 8, 0.4, 1.3);
    }
    const misty = pose.mist > 0.01 && !this.low;
    rig.mist.visible = misty;
    if (misty) {
      rig.mist.position.set(0, 3.2 - pose.drop, 0);
      rig.mist.scale.setScalar(9 + 9 * pose.shatter);
      rig.mist.material.uniforms.alpha.value = 0.4 * pose.mist;
    }
  }

  private poseChunks(rig: PillarRig, shatter: number): void {
    const intact = shatter <= 0;
    // Downwind: the storm throws the pieces away from the boss.
    let windX = rig.x - this.stormX;
    let windZ = rig.z - this.stormZ;
    const far = Math.hypot(windX, windZ) || 1;
    windX /= far;
    windZ /= far;
    for (let i = 0; i < rig.chunks.length; i++) {
      const chunk = rig.chunks[i];
      if (intact) {
        chunk.node.position.set(chunk.restX, chunk.restY, chunk.restZ);
        chunk.node.rotation.set(0, 0, 0);
        chunk.node.scale.setScalar(1);
        chunk.node.visible = true;
        continue;
      }
      let outX = chunk.radialX * 0.75 + windX * 0.65;
      let outZ = chunk.radialZ * 0.75 + windZ * 0.65;
      const length = Math.hypot(outX, outZ) || 1;
      outX /= length;
      outZ /= length;
      const flight = chunkFlight(shatter, outX, outZ, chunk.restY, chunk.vigor, this.flight);
      chunk.node.position.set(
        chunk.restX + flight.x,
        chunk.restY + flight.y,
        chunk.restZ + flight.z,
      );
      chunk.node.rotation.set(outZ * flight.spin, flight.spin * 0.35, -outX * flight.spin);
      chunk.node.scale.setScalar(Math.max(0.001, flight.scale));
      chunk.node.visible = flight.scale > 0.001;
    }
    // The spires and the snow at its foot sink away with it.
    const left = intact ? 1 : Math.max(0.001, 1 - Math.min(1, shatter * 1.5));
    rig.extras.scale.set(1, left, 1);
    rig.extras.visible = left > 0.002;
  }

  /** Returns false when there is no lee to draw (a pillar on the storm's origin). */
  private writeLee(rig: PillarRig): boolean {
    const rows = writeLeeStrip(this.stormX, this.stormZ, rig.x, rig.z, this.leeScratch);
    if (rows === 0) return false;
    const { position, alpha } = rig.lee;
    for (let row = 0; row < rows; row++) {
      const t = row / Math.max(1, rows - 1);
      for (let side = 0; side < 2; side++) {
        const x = this.leeScratch[row * 4 + side * 2];
        const z = this.leeScratch[row * 4 + side * 2 + 1];
        position.setXYZ(row * 2 + side, x, this.groundY(x, z) + 0.12, z);
        // Strongest just behind the pillar, thinning toward the reach's end.
        alpha.setX(row * 2 + side, 0.85 * (1 - 0.6 * t));
      }
    }
    // The outline runs down the left edge and back up the right.
    const edge = rig.leeEdge.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let row = 0; row < rows; row++) {
      edge.setXYZ(
        row,
        position.getX(row * 2),
        position.getY(row * 2) + 0.03,
        position.getZ(row * 2),
      );
      const back = rows * 2 - 1 - row;
      edge.setXYZ(
        back,
        position.getX(row * 2 + 1),
        position.getY(row * 2 + 1) + 0.03,
        position.getZ(row * 2 + 1),
      );
    }
    edge.needsUpdate = true;
    position.needsUpdate = true;
    alpha.needsUpdate = true;
    return true;
  }

  /** Storm spray off the pillar's windward face, torn away to either side. */
  private sprayFront(rig: PillarRig, count: number): void {
    if (!this.bursts) return;
    let ux = rig.x - this.stormX;
    let uz = rig.z - this.stormZ;
    const far = Math.hypot(ux, uz) || 1;
    ux /= far;
    uz /= far;
    for (let i = 0; i < count; i++) {
      const side = this.random() < 0.5 ? -1 : 1;
      const across = side * (0.4 + this.random() * 0.8) * ICE_AGE.pillarRadius;
      const speed = 12 + this.random() * 12;
      this.emit(
        rig.x - ux * ICE_AGE.pillarRadius * 0.9 + uz * across,
        rig.ground + 0.6 + this.random() * 7,
        rig.z - uz * ICE_AGE.pillarRadius * 0.9 - ux * across,
        (ux * 0.8 + uz * side * 0.6) * speed,
        1 + this.random() * 3,
        (uz * 0.8 - ux * side * 0.6) * speed,
        0.26,
        0.55,
      );
    }
  }

  private updateStorm(dt: number): void {
    if (!this.stormSeen || this.stormCueId === -1) {
      if (this.stormShown) {
        this.stormShown = false;
        this.snow.points.visible = false;
        this.gather.visible = false;
        this.wave.visible = false;
        this.waveGlow.visible = false;
        if (this.floorFrost) this.floorFrost.visible = false;
        this.gusts.mesh.visible = false;
      }
      return;
    }
    this.stormShown = true;
    if (this.stormFresh) this.stormFresh = false;
    else this.stormElapsed = Math.min(this.stormTotal, this.stormElapsed + dt);
    const pose = stormPose(this.stormElapsed, this.stormTotal, this.storm);
    const still = this.reducedMotion();
    const ground = this.stormGround;

    if (!this.stormBlasted && pose.wave > 0) {
      this.stormBlasted = true;
      if (!still && !this.low) this.shake?.(0.24);
    }

    this.gather.visible = pose.gather > 0;
    if (pose.gather > 0) {
      this.gather.position.set(this.stormX, ground + 3.4, this.stormZ);
      this.gather.scale.setScalar(5 + 13 * pose.gather + (still ? 0 : Math.sin(this.time * 14)));
      this.gather.material.uniforms.alpha.value = 0.25 + 0.6 * pose.gather;
    }
    if (this.floorFrost) {
      this.floorFrost.visible = pose.frost > 0.005;
      if (this.floorFrost.visible) {
        this.floorFrost.position.set(this.stormX, ground + 0.04, this.stormZ);
        this.floorFrost.scale.set(pose.frostRadius, 1, pose.frostRadius);
        this.floorFrost.material.opacity = 0.5 * pose.frost;
      }
    }
    const waving = pose.wave > 0;
    this.wave.visible = waving;
    this.waveGlow.visible = waving;
    if (waving) {
      this.wave.position.set(this.stormX, ground + 0.5, this.stormZ);
      this.wave.scale.set(pose.waveRadius, 1, pose.waveRadius);
      this.waveGlow.position.set(this.stormX, ground + 0.5, this.stormZ);
      this.waveGlow.scale.set(pose.waveRadius, 1, pose.waveRadius);
      this.wave.material.opacity = 0.9 * pose.wave;
      this.waveGlow.material.opacity = Math.min(1, 1.3 * pose.wave);
    }

    // ---- the wind: everything it carries runs OUT from the boss, and goes dark
    // in a standing pillar's lee, so the storm is seen to split round cover.
    const blowing = pose.wind > 0.01;
    this.snow.points.visible = blowing;
    this.gusts.mesh.visible = blowing;
    if (!blowing) return;
    const { position, alpha, angle, distance, height, pace } = this.snow;
    const step = (still ? 0.35 : 1) * pose.windSpeed * dt;
    for (let i = 0; i < this.snowCount; i++) {
      let d = distance[i] + step * pace[i];
      if (d > WIND_REACH) d -= WIND_REACH;
      distance[i] = d;
      const sx = Math.sin(angle[i]);
      const sz = Math.cos(angle[i]);
      const x = this.stormX + sx * d;
      const z = this.stormZ + sz * d;
      const y = ground + height[i];
      let shown = pose.wind * Math.min(1, d / 5) * Math.min(1, (WIND_REACH - d) / 8);
      if (shown > 0 && pose.sheltering) {
        for (let r = 0; r < this.rigs.length; r++) {
          const rig = this.rigs[r];
          if (rig.cueId === -1 || !rig.landed) continue;
          if (icePillarCovers(this.stormX, this.stormZ, rig.x, rig.z, x, z)) {
            shown = 0;
            break;
          }
        }
      }
      position.setXYZ(i, x, y, z);
      alpha.setX(i, shown);
    }
    position.needsUpdate = true;
    alpha.needsUpdate = true;
    this.updateGusts(pose, step, ground);
  }

  /** The gusts: long blue-grey sheets of driven snow lying flat in the wind, so
   *  they read from the chase camera and on a white floor. They run out from the
   *  boss, stretch with the wind's pace, and break off in a standing lee. */
  private updateGusts(pose: StormPose, step: number, ground: number): void {
    const gusts = this.gusts;
    const stretch = Math.min(1.6, 0.45 + pose.windSpeed / 60);
    for (let i = 0; i < this.gustCount; i++) {
      let d = gusts.distance[i] + step * gusts.pace[i];
      if (d > WIND_REACH) d -= WIND_REACH;
      gusts.distance[i] = d;
      const sx = Math.sin(gusts.angle[i]);
      const sz = Math.cos(gusts.angle[i]);
      const x = this.stormX + sx * d;
      const z = this.stormZ + sz * d;
      const y = ground + gusts.height[i];
      let shown = pose.wind * Math.min(1, d / 6) * Math.min(1, (WIND_REACH - d) / 10) * 0.8;
      if (shown > 0 && pose.sheltering) {
        for (let r = 0; r < this.rigs.length; r++) {
          const rig = this.rigs[r];
          if (rig.cueId === -1 || !rig.landed) continue;
          if (icePillarCovers(this.stormX, this.stormZ, rig.x, rig.z, x, z)) {
            shown = 0;
            break;
          }
        }
      }
      const half = gusts.width[i] / 2;
      const tail = Math.min(d, gusts.length[i] * stretch);
      const tx = x - sx * tail;
      const tz = z - sz * tail;
      // Across the bearing: (sz, -sx).
      gusts.position.setXYZ(i * 4, x - sz * half, y, z + sx * half);
      gusts.position.setXYZ(i * 4 + 1, x + sz * half, y, z - sx * half);
      gusts.position.setXYZ(i * 4 + 2, tx - sz * half * 0.3, y, tz + sx * half * 0.3);
      gusts.position.setXYZ(i * 4 + 3, tx + sz * half * 0.3, y, tz - sx * half * 0.3);
      gusts.alpha.setX(i * 4, shown);
      gusts.alpha.setX(i * 4 + 1, shown);
    }
    gusts.position.needsUpdate = true;
    gusts.alpha.needsUpdate = true;
  }

  private burst(
    x: number,
    y: number,
    z: number,
    count: number,
    speed: number,
    lift: number,
    size: number,
    life: number,
  ): void {
    if (!this.bursts) return;
    for (let i = 0; i < count; i++) {
      const a = this.random() * Math.PI * 2;
      const s = speed * (0.35 + this.random() * 0.65);
      this.emit(
        x,
        y + this.random() * 2,
        z,
        Math.sin(a) * s,
        lift * (0.3 + this.random() * 0.7),
        Math.cos(a) * s,
        size * (0.6 + this.random() * 0.7),
        life * (0.6 + this.random() * 0.4),
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
    const bursts = this.bursts;
    if (!bursts) return;
    const i = bursts.cursor;
    bursts.cursor = (i + 1) % BURSTS;
    bursts.position.setXYZ(i, x, y, z);
    bursts.velocity[i * 3] = vx;
    bursts.velocity[i * 3 + 1] = vy;
    bursts.velocity[i * 3 + 2] = vz;
    bursts.size.setX(i, size);
    bursts.life[i] = life;
    bursts.span[i] = life;
    bursts.live++;
    bursts.size.needsUpdate = true;
  }

  private updateBursts(dt: number): void {
    const bursts = this.bursts;
    if (!bursts || bursts.live === 0) return;
    let alive = 0;
    for (let i = 0; i < BURSTS; i++) {
      if (bursts.life[i] <= 0) continue;
      bursts.life[i] -= dt;
      if (bursts.life[i] <= 0) {
        bursts.alpha.setX(i, 0);
        continue;
      }
      alive++;
      bursts.velocity[i * 3 + 1] -= 14 * dt;
      bursts.position.setXYZ(
        i,
        bursts.position.getX(i) + bursts.velocity[i * 3] * dt,
        bursts.position.getY(i) + bursts.velocity[i * 3 + 1] * dt,
        bursts.position.getZ(i) + bursts.velocity[i * 3 + 2] * dt,
      );
      bursts.alpha.setX(i, Math.min(1, (bursts.life[i] / bursts.span[i]) * 1.6));
    }
    bursts.live = alive;
    bursts.points.visible = alive > 0;
    bursts.position.needsUpdate = true;
    bursts.alpha.needsUpdate = true;
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
