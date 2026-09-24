// Bonelord Xarreth's Wandering Scythe and Soul Harvest, drawn from the
// authoritative hoard cues. Where things ARE is the shared sim choreography
// (src/sim/rift/hoard_bone_reaper_core.ts) sampled at the cue's own clock, so the
// blade on screen is the blade that hits; how they LOOK is
// hoard_bone_reaper_core.ts beside this file.
//
// What is Blender and what is runtime: the scythe and the soul are Blender
// models (docs/design/bone-reaper/). Everything that depends on the moment is
// code: the double transform (the pivot travels, the blade turns about it), the
// lean, the spectral trail, the floor wake, scrape sparks, the assembly and the
// break-up, the souls' float and pull, and the two endings a soul can have.
//
// Performance contract (the siblings' contract): every geometry and material is
// built once here and attached through the scene gate, so nothing compiles
// mid-fight; no dynamic lights; no per-frame allocation; the idle frame is a few
// branches. The low tier sheds the trail, the wake, the sparks and the endings'
// motes. It NEVER sheds what a player acts on: the weapon, the blade's shadow on
// the floor, the reach ring, a soul and its floor marker draw on every tier.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../game/ui_effects_profile';
import {
  BONE_SCYTHE,
  decodeScytheFrame,
  HOARD_HARVESTED_SOUL_AURA_ID,
  SOUL_HARVEST,
  scythePatternOf,
  scythePivot,
} from '../sim/rift/hoard_bone_reaper_core';
import type { IWorld } from '../world_api';
import type { HoardBossCueView } from '../world_api/dungeons';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { attachSceneGroupGated } from './gated_scene_attach';
import { GFX, type GfxTier, surfaceMat } from './gfx';
import {
  type HarvestedLook,
  harvestedLook,
  BONE_REAPER_LOOK as LOOK,
  type ScythePose,
  type SoulPose,
  scythePose,
  scytheTipAt,
  soulEnding,
  soulPose,
} from './hoard_bone_reaper_core';
import { glowMaterial, ribbonMaterial, sparkMaterial, strip } from './hoard_fx_materials';
import { setRenderCategory } from './renderer_diagnostics';

export const BONE_REAPER_ASSET_URLS = [
  '/vfx/bone-reaper/scythe.glb',
  '/vfx/bone-reaper/soul.glb',
] as const;
let sources: readonly THREE.Group[] | undefined;
let loading: Promise<readonly THREE.Group[] | undefined> | undefined;
function loadSources(): Promise<readonly THREE.Group[] | undefined> {
  loading ??= Promise.all(BONE_REAPER_ASSET_URLS.map(async (url) => (await loadGltf(url)).scene))
    .then((loaded) => {
      sources = loaded;
      return loaded;
    })
    .catch(() => undefined);
  return loading;
}
if (typeof window !== 'undefined') registerDeferredPreload(loadSources);

const SOUL_SLOTS = 8;
const SOUL_PARTS = ['SpectralBody', 'SoulCore', 'OuterWisps', 'FaceHint'] as const;
const ENDINGS = 6;
const SPARKS = 96;
const TRAIL = LOOK.trailSamples;
const WAKE = LOOK.wakeSamples;
const SOUL_TRAIL_SEGMENTS = 5;

interface SoulSlot {
  instanceId: number;
  cueId: number;
  spawnX: number;
  spawnZ: number;
  total: number;
  remaining: number;
  elapsed: number;
  lastX: number;
  lastZ: number;
  seen: boolean;
  fresh: boolean;
}

interface Ending {
  age: number;
  absorbed: boolean;
  x: number;
  y: number;
  z: number;
  flash: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  ring: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
}

/** The blade's footprint on the floor: exactly the sim's hit sector. */
function bladeSectorGeometry(): THREE.BufferGeometry {
  const steps = 14;
  const from = -BONE_SCYTHE.bladeTrail;
  const to = BONE_SCYTHE.bladeArc;
  const positions: number[] = [];
  const index: number[] = [];
  for (let s = 0; s <= steps; s++) {
    const a = (from + ((to - from) * s) / steps) * BONE_SCYTHE.rotationDirection;
    for (const r of [BONE_SCYTHE.bladeInner, BONE_SCYTHE.reach]) {
      positions.push(Math.sin(a) * r, 0, Math.cos(a) * r);
    }
    if (s < steps) {
      const b = s * 2;
      index.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  return geometry;
}

/** Two at most: a full party in a rare enough hoard faces a mirrored pair
 *  (src/sim/rift/hoard_scaling.ts HOARD_DOUBLE_MECHANIC_INTENSITY). */
const SCYTHE_RIGS = 2;
type Ribbon = ReturnType<typeof strip> & { mesh: THREE.Mesh; material: THREE.ShaderMaterial };

/** One Wandering Scythe on screen: pivot -> (floorSpin | tilt -> spin -> weapon),
 *  its own materials (each rig fades on its own clock) and the cue it follows. */
interface ScytheRig {
  pivot: THREE.Group;
  floorSpin: THREE.Group;
  tilt: THREE.Group;
  spin: THREE.Group;
  weapon: THREE.Group;
  fragments: THREE.Group;
  glowMaterial: THREE.MeshBasicMaterial;
  sectorMaterial: THREE.MeshBasicMaterial;
  sectorEdgeMaterial: THREE.LineBasicMaterial;
  markerMaterial: THREE.MeshBasicMaterial;
  reachMaterial: THREE.MeshBasicMaterial;
  innerMaterial: THREE.MeshBasicMaterial;
  hubGlow: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  trail?: Ribbon;
  wake?: Ribbon;
  pose: ScythePose;
  scytheCueId: number;
  scytheInstanceId: number;
  scytheRemaining: number;
  scytheElapsed: number;
  scytheTotal: number;
  scytheX: number;
  scytheZ: number;
  scytheFacing: number;
  scytheRadius: number;
  scytheHalfAngle: number;
  scytheSeen: boolean;
  scytheFresh: boolean;
  scytheFrame: ReturnType<typeof decodeScytheFrame>;
  wasBroken: boolean;
  scrapeDebt: number;
}

export class HoardBoneReaperFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private readonly low: boolean;
  private disposed = false;
  private time = 0;

  // ---- the scythes
  private readonly rigs: ScytheRig[] = [];

  // ---- the souls
  private readonly soulSlots: SoulSlot[] = [];
  private readonly soulParts: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] =
    [];
  private readonly soulMarkers: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly soulHalos: THREE.InstancedMesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly soulTrails?: ReturnType<typeof strip> & {
    mesh: THREE.Mesh;
    material: THREE.ShaderMaterial;
  };
  private readonly soulPoseScratch: SoulPose = {
    x: 0,
    z: 0,
    y: 0,
    yaw: 0,
    scale: 0,
    glow: 0,
    stretch: 1,
    travelled: 0,
    drawn: false,
  };
  private harvestX = 0;
  private harvestZ = 0;
  private harvestSeen = false;
  private harvestCueId = -1;
  private bossId = -1;

  // ---- endings, sparks, the empowered boss
  private readonly endings: Ending[] = [];
  private readonly sparks?: {
    points: THREE.Points;
    position: THREE.BufferAttribute;
    size: THREE.BufferAttribute;
    alpha: THREE.BufferAttribute;
    tint: THREE.BufferAttribute;
    velocity: Float32Array;
    life: Float32Array;
    span: Float32Array;
    cursor: number;
    live: number;
  };
  private readonly ribs: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly aura: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly orbiters: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];
  private readonly lookScratch: HarvestedLook = { ribs: 0, veins: 0, aura: 0, orbiters: 0 };
  private stackPoll = 0;
  private stacks = 0;

  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private readonly tipA = { x: 0, z: 0 };
  private readonly tipB = { x: 0, z: 0 };
  private readonly past = { x: 0, z: 0 };

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    effectsTier: GfxTier = GFX.tier,
    assets:
      | readonly THREE.Group[]
      | Promise<readonly THREE.Group[] | undefined>
      | undefined = sources,
  ) {
    this.root.name = 'hoard-bone-reaper';
    setRenderCategory(this.root, 'ui3d');
    this.low =
      resolveUiEffectsProfile({ presetLabel: effectsTier, effectsQuality: 1, reduceMotion: false })
        .tier === 'low';
    const initial = assets instanceof Promise ? undefined : assets;
    const pending =
      assets instanceof Promise
        ? assets
        : !assets && typeof window !== 'undefined'
          ? loadSources()
          : Promise.resolve(initial);

    const card = this.own(new THREE.PlaneGeometry(1, 1));
    const sectorGeometry = this.own(bladeSectorGeometry());
    // The leading edge, where the blade is about to be: the line to stay ahead of.
    const lead = BONE_SCYTHE.bladeArc * BONE_SCYTHE.rotationDirection;
    const edgeGeometry = this.own(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(
          Math.sin(lead) * BONE_SCYTHE.bladeInner,
          0,
          Math.cos(lead) * BONE_SCYTHE.bladeInner,
        ),
        new THREE.Vector3(
          Math.sin(lead) * BONE_SCYTHE.reach,
          0,
          Math.cos(lead) * BONE_SCYTHE.reach,
        ),
      ]),
    );
    const rings = [
      this.flatRing(0.85, 1.25),
      this.flatRing(BONE_SCYTHE.reach - 0.07, BONE_SCYTHE.reach + 0.07),
      this.flatRing(BONE_SCYTHE.bladeInner - 0.05, BONE_SCYTHE.bladeInner + 0.05),
    ];
    for (let index = 0; index < SCYTHE_RIGS; index++)
      this.rigs.push(this.makeRig(initial?.[0], card, sectorGeometry, edgeGeometry, rings));

    // ---- souls: four instanced parts, a floor marker each, one shared tail strip
    const soulColors = [LOOK.soulDeep, LOOK.soulCore, LOOK.soul, 0x04161c];
    SOUL_PARTS.forEach((name, i) => {
      const material = this.keep(
        this.basic(soulColors[i], i === 3 ? 0.85 : i === 0 ? 0.5 : 0.9, i !== 3),
      );
      const mesh = new THREE.InstancedMesh(
        this.partGeometry(initial?.[1], name, i),
        material,
        SOUL_SLOTS,
      );
      mesh.name = `Soul_${name}`;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let s = 0; s < SOUL_SLOTS; s++) mesh.setColorAt(s, this.color.setRGB(1, 1, 1));
      mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
      mesh.renderOrder = i === 3 ? 27 : 25;
      mesh.count = 0;
      this.root.add(mesh);
      this.soulParts.push(mesh);
    });
    this.soulMarkers = new THREE.InstancedMesh(
      this.flatRing(SOUL_HARVEST.interactionRadius - 0.12, SOUL_HARVEST.interactionRadius),
      this.keep(this.basic(LOOK.soul, 0.5, true)),
      SOUL_SLOTS,
    );
    this.soulMarkers.frustumCulled = false;
    this.soulMarkers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let s = 0; s < SOUL_SLOTS; s++) this.soulMarkers.setColorAt(s, this.color.setRGB(1, 1, 1));
    this.soulMarkers.instanceColor?.setUsage(THREE.DynamicDrawUsage);
    this.soulMarkers.renderOrder = 21;
    this.soulMarkers.count = 0;
    this.root.add(this.soulMarkers);
    // A soft halo behind each soul: what makes one findable across the room.
    this.soulHalos = new THREE.InstancedMesh(
      card,
      this.keep(glowMaterial(LOOK.soul, true)),
      SOUL_SLOTS,
    );
    this.soulHalos.frustumCulled = false;
    this.soulHalos.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let s = 0; s < SOUL_SLOTS; s++) this.soulHalos.setColorAt(s, this.color.setRGB(1, 1, 1));
    this.soulHalos.instanceColor?.setUsage(THREE.DynamicDrawUsage);
    this.soulHalos.renderOrder = 24;
    this.soulHalos.count = 0;
    this.root.add(this.soulHalos);
    if (!this.low) {
      // Each soul owns a run of SOUL_TRAIL_SEGMENTS quads; a degenerate quad joins runs.
      const tails = strip(SOUL_SLOTS * (SOUL_TRAIL_SEGMENTS + 1) - 1);
      const material = this.keep(ribbonMaterial(LOOK.soul));
      const mesh = new THREE.Mesh(this.own(tails.geometry), material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 24;
      mesh.visible = false;
      this.root.add(mesh);
      this.soulTrails = { ...tails, mesh, material };
    }
    for (let s = 0; s < SOUL_SLOTS; s++)
      this.soulSlots.push({
        instanceId: -1,
        cueId: -1,
        spawnX: 0,
        spawnZ: 0,
        total: 0,
        remaining: -1,
        elapsed: 0,
        lastX: 0,
        lastZ: 0,
        seen: false,
        fresh: false,
      });

    // ---- endings, sparks, the empowered boss
    const ball = this.own(new THREE.IcosahedronGeometry(1, 2));
    const burstRing = this.flatRing(0.95, 1);
    for (let e = 0; e < ENDINGS; e++) {
      const flash = new THREE.Mesh(ball, this.keep(this.basic(LOOK.soulCore, 0, true)));
      const ring = new THREE.Mesh(burstRing, this.keep(this.basic(LOOK.soul, 0, true)));
      for (const mesh of [flash, ring]) {
        mesh.visible = false;
        mesh.frustumCulled = false;
        mesh.renderOrder = 28;
        this.root.add(mesh);
      }
      this.endings.push({ age: -1, absorbed: false, x: 0, y: 0, z: 0, flash, ring });
    }
    if (!this.low) {
      const geometry = this.own(new THREE.BufferGeometry());
      const position = new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3);
      const size = new THREE.BufferAttribute(new Float32Array(SPARKS), 1);
      const alpha = new THREE.BufferAttribute(new Float32Array(SPARKS), 1);
      const tint = new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3);
      for (const attribute of [position, size, alpha, tint])
        attribute.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('position', position);
      geometry.setAttribute('size', size);
      geometry.setAttribute('alpha', alpha);
      geometry.setAttribute('tint', tint);
      const points = new THREE.Points(geometry, this.keep(sparkMaterial()));
      points.frustumCulled = false;
      points.renderOrder = 29;
      points.visible = false;
      this.root.add(points);
      this.sparks = {
        points,
        position,
        size,
        alpha,
        tint,
        velocity: new Float32Array(SPARKS * 3),
        life: new Float32Array(SPARKS),
        span: new Float32Array(SPARKS),
        cursor: 0,
        live: 0,
      };
    }
    this.ribs = new THREE.Mesh(card, this.keep(glowMaterial(LOOK.absorb, false)));
    this.aura = new THREE.Mesh(this.flatRing(0.9, 1), this.keep(this.basic(LOOK.absorb, 0, true)));
    for (const mesh of [this.ribs, this.aura]) {
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 22;
      this.root.add(mesh);
    }
    for (let o = 0; o < 4; o++) {
      const orb = new THREE.Mesh(ball, this.keep(this.basic(LOOK.soul, 0.9, true)));
      orb.visible = false;
      orb.frustumCulled = false;
      orb.renderOrder = 26;
      this.root.add(orb);
      this.orbiters.push(orb);
    }

    // Compile with everything present and visible-capable, then idle hidden.
    this.readyForEntry = pending
      .catch(() => undefined)
      .then(async (loaded) => {
        if (this.disposed) return;
        if (loaded && loaded !== initial) {
          for (const rig of this.rigs) this.buildWeapon(rig, loaded[0]);
          SOUL_PARTS.forEach((name, i) => {
            this.soulParts[i].geometry = this.partGeometry(loaded[1], name, i);
          });
        }
        await attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed);
      })
      .catch(() => {});
  }

  private flatRing(inner: number, outer: number): THREE.BufferGeometry {
    return this.own(new THREE.RingGeometry(inner, outer, 72).rotateX(-Math.PI / 2));
  }

  /** Build one scythe rig. Geometry is shared between rigs; materials are per
   *  rig, because each fades on its own cue's clock. */
  private makeRig(
    asset: THREE.Group | undefined,
    card: THREE.BufferGeometry,
    sectorGeometry: THREE.BufferGeometry,
    edgeGeometry: THREE.BufferGeometry,
    rings: readonly THREE.BufferGeometry[],
  ): ScytheRig {
    const rig: ScytheRig = {
      pivot: new THREE.Group(),
      floorSpin: new THREE.Group(),
      tilt: new THREE.Group(),
      spin: new THREE.Group(),
      weapon: new THREE.Group(),
      fragments: new THREE.Group(),
      glowMaterial: this.keep(this.basic(LOOK.necro, 1, true)),
      sectorMaterial: this.keep(this.basic(0x04140e, 0.5, false)),
      sectorEdgeMaterial: this.keep(
        new THREE.LineBasicMaterial({
          color: LOOK.necro,
          transparent: true,
          opacity: 0.75,
          depthWrite: false,
        }),
      ),
      markerMaterial: this.keep(this.basic(LOOK.necro, 0.5, true)),
      reachMaterial: this.keep(this.basic(LOOK.necro, 0.26, true)),
      innerMaterial: this.keep(this.basic(LOOK.necroDeep, 0.2, true)),
      hubGlow: new THREE.Mesh(card, this.keep(glowMaterial(LOOK.necro, false))),
      pose: {
        x: 0,
        z: 0,
        angle: 0,
        formed: 0,
        lift: 0,
        leanX: 0,
        leanZ: 0,
        glow: 0,
        broken: 0,
        speed: 0,
        dirX: 0,
        dirZ: 0,
        active: false,
      },
      scytheCueId: -1,
      scytheInstanceId: -1,
      scytheRemaining: -1,
      scytheElapsed: 0,
      scytheTotal: 0,
      scytheX: 0,
      scytheZ: 0,
      scytheFacing: 0,
      scytheRadius: Number.NaN,
      scytheHalfAngle: Number.NaN,
      scytheSeen: false,
      scytheFresh: false,
      scytheFrame: decodeScytheFrame(0, BONE_SCYTHE.minDepth),
      wasBroken: false,
      scrapeDebt: 0,
    };
    rig.pivot.name = 'MovementPivot';
    rig.spin.name = 'RotationPivot';
    rig.pivot.add(rig.floorSpin, rig.tilt);
    rig.tilt.add(rig.spin);
    rig.spin.add(rig.weapon);
    this.root.add(rig.pivot);
    this.buildWeapon(rig, asset);
    const sector = new THREE.Mesh(sectorGeometry, rig.sectorMaterial);
    sector.position.y = 0.05;
    sector.renderOrder = 20;
    const edge = new THREE.Line(edgeGeometry, rig.sectorEdgeMaterial);
    edge.position.y = 0.07;
    rig.floorSpin.add(sector, edge);
    const ringMaterials = [rig.markerMaterial, rig.reachMaterial, rig.innerMaterial];
    rings.forEach((geometry, i) => {
      const mesh = new THREE.Mesh(geometry, ringMaterials[i]);
      mesh.position.y = 0.06;
      mesh.renderOrder = 21;
      rig.pivot.add(mesh);
    });
    // The pivot's own light: the eye finds the centre of the hazard first.
    rig.hubGlow.frustumCulled = false;
    rig.hubGlow.renderOrder = 24;
    rig.hubGlow.position.y = LOOK.bladeHeight + 0.4;
    rig.hubGlow.scale.setScalar(4.2);
    rig.pivot.add(rig.hubGlow);
    if (!this.low) {
      const ribbon = (segments: number, color: number): Ribbon => {
        const built = strip(segments);
        const material = this.keep(ribbonMaterial(color));
        const mesh = new THREE.Mesh(this.own(built.geometry), material);
        mesh.frustumCulled = false;
        mesh.renderOrder = 23;
        mesh.visible = false;
        this.root.add(mesh);
        return { ...built, mesh, material };
      };
      rig.trail = ribbon(TRAIL - 1, LOOK.necro);
      rig.wake = ribbon(WAKE - 1, LOOK.necroDeep);
    }
    rig.pivot.visible = false;
    return rig;
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

  /** The weapon: the Blender model in the game's own surface material, its two
   *  glowing parts on a material of ours so the glow can breathe. A plain
   *  stand-in of the same reach serves until (or unless) the asset arrives. */
  private buildWeapon(rig: ScytheRig, asset: THREE.Group | undefined): void {
    rig.weapon.clear();
    rig.fragments.clear();
    if (!asset) {
      const shaft = new THREE.Mesh(
        this.own(
          new THREE.BoxGeometry(0.4, 0.4, BONE_SCYTHE.reach).translate(0, 0, BONE_SCYTHE.reach / 2),
        ),
        surfaceMat({ color: LOOK.bone, roughness: 0.75 }),
      );
      rig.weapon.add(shaft);
      return;
    }
    const model = asset.clone(true);
    model.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.castShadow = true;
      const convert = (material: THREE.Material): THREE.Material => {
        if (material.name === 'NecroGlow') return rig.glowMaterial;
        const original = material as THREE.MeshStandardMaterial;
        return surfaceMat({
          color: original.color?.getHex(),
          metalness: original.metalness,
          roughness: original.roughness,
          // Lit a little in its own colour: it must read in a dark cavern.
          emissive: original.color?.getHex(),
          emissiveIntensity: 0.22,
        });
      };
      node.material = Array.isArray(node.material)
        ? node.material.map(convert)
        : convert(node.material);
    });
    rig.weapon.add(model);
    // The shipped GLB is quantized, which moves node origins, so the drifting
    // shards hang on a group of ours and only that group bobs.
    model.updateMatrixWorld(true);
    const shards = model.getObjectByName('Scythe_Fragments');
    if (shards) {
      rig.weapon.add(rig.fragments);
      rig.fragments.attach(shards);
    }
  }

  private partGeometry(
    source: THREE.Group | undefined,
    name: string,
    index: number,
  ): THREE.BufferGeometry {
    const node = source?.getObjectByName(name);
    let mesh: THREE.Mesh | undefined;
    node?.traverse((child) => {
      if (!mesh && (child as THREE.Mesh).isMesh) mesh = child as THREE.Mesh;
    });
    if (mesh) {
      // The shipped GLB is quantized: its positions are normalized integers that
      // the NODE transform scales back up. Bake through getX (which denormalizes)
      // into floats; applying the matrix to the integer buffer would crush it.
      mesh.updateWorldMatrix(true, false);
      const from = mesh.geometry.getAttribute('position');
      const baked = new Float32Array(from.count * 3);
      const v = new THREE.Vector3();
      for (let i = 0; i < from.count; i++) {
        v.fromBufferAttribute(from, i).applyMatrix4(mesh.matrixWorld);
        baked[i * 3] = v.x;
        baked[i * 3 + 1] = v.y;
        baked[i * 3 + 2] = v.z;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(baked, 3));
      const index = mesh.geometry.getIndex();
      if (index) geometry.setIndex(Array.from(index.array));
      return this.own(geometry);
    }
    // Stand-ins of about the right size: a body, a core, a ring of wisp, a face.
    if (index === 0) return this.own(new THREE.ConeGeometry(0.34, 2.2, 8).translate(0, 1.1, 0));
    if (index === 1) return this.own(new THREE.IcosahedronGeometry(0.2, 1).translate(0, 1.3, 0));
    if (index === 2)
      return this.own(
        new THREE.TorusGeometry(0.5, 0.03, 4, 16).rotateX(Math.PI / 2).translate(0, 1, 0),
      );
    return this.own(new THREE.PlaneGeometry(0.3, 0.3).translate(0, 2, 0.3));
  }

  sync(cues: readonly HoardBossCueView[]): void {
    if (this.disposed) return;
    for (const rig of this.rigs) rig.scytheSeen = false;
    this.harvestSeen = false;
    for (const slot of this.soulSlots) slot.seen = false;
    for (const cue of cues) {
      if (cue.remaining <= 0) continue;
      if (cue.variant === 'bone-scythe') {
        // The rig already following this cue, else a free one.
        let rig: ScytheRig | undefined;
        let free: ScytheRig | undefined;
        for (let i = 0; i < this.rigs.length; i++) {
          const candidate = this.rigs[i];
          if (
            candidate.scytheCueId === cue.cueId &&
            candidate.scytheInstanceId === cue.instanceId
          ) {
            rig = candidate;
            break;
          }
          if (!free && candidate.scytheCueId === -1) free = candidate;
        }
        rig ??= free;
        if (!rig) continue;
        rig.scytheSeen = true;
        if (rig.scytheCueId !== cue.cueId || rig.scytheInstanceId !== cue.instanceId) {
          rig.scytheCueId = cue.cueId;
          rig.scytheInstanceId = cue.instanceId;
          rig.scytheRemaining = -1;
          rig.wasBroken = false;
          rig.scrapeDebt = 0;
        }
        rig.scytheX = cue.x;
        rig.scytheZ = cue.z;
        rig.scytheFacing = cue.facing ?? 0;
        const halfAngle = cue.halfAngle ?? BONE_SCYTHE.minDepth;
        if (rig.scytheRadius !== cue.radius || rig.scytheHalfAngle !== halfAngle) {
          rig.scytheRadius = cue.radius;
          rig.scytheHalfAngle = halfAngle;
          rig.scytheFrame = decodeScytheFrame(cue.radius, halfAngle);
        }
        rig.scytheTotal = cue.total;
        if (rig.scytheRemaining !== cue.remaining) {
          rig.scytheRemaining = cue.remaining;
          rig.scytheElapsed = Math.max(0, cue.total - cue.remaining);
          rig.scytheFresh = true;
        }
      } else if (cue.variant === 'bone-harvest') {
        if (this.harvestCueId !== cue.cueId) {
          this.harvestCueId = cue.cueId;
          this.bossId = this.findBoss(cue.x, cue.z);
        }
        this.harvestSeen = true;
        this.harvestX = cue.x;
        this.harvestZ = cue.z;
      } else if (cue.variant === 'bone-soul') {
        // Indexed scans, no closures: this runs per soul per frame.
        let slot: SoulSlot | undefined;
        let free: SoulSlot | undefined;
        for (let i = 0; i < this.soulSlots.length; i++) {
          const candidate = this.soulSlots[i];
          if (candidate.instanceId === cue.instanceId && candidate.cueId === cue.cueId) {
            slot = candidate;
            break;
          }
          if (!free && candidate.instanceId === -1) free = candidate;
        }
        if (!slot) {
          slot = free;
          if (!slot) continue;
          slot.instanceId = cue.instanceId;
          slot.cueId = cue.cueId;
          slot.remaining = -1;
          slot.lastX = cue.x;
          slot.lastZ = cue.z;
        }
        slot.seen = true;
        slot.spawnX = cue.x;
        slot.spawnZ = cue.z;
        slot.total = cue.total;
        if (slot.remaining !== cue.remaining) {
          slot.remaining = cue.remaining;
          slot.elapsed = Math.max(0, cue.total - cue.remaining);
          slot.fresh = true;
        }
      }
    }
    for (const rig of this.rigs) if (!rig.scytheSeen) rig.scytheCueId = -1;
    for (const slot of this.soulSlots) {
      if (slot.seen || slot.instanceId === -1) continue;
      // Its cue is gone: released by a player, or taken by the boss.
      this.startEnding(slot);
      slot.instanceId = -1;
    }
  }

  /** The boss who cast the harvest: the bone boss nearest where it was cast. One
   *  scan per cast, never per frame. */
  private findBoss(x: number, z: number): number {
    let best = -1;
    let bestD = 64;
    for (const entity of this.world?.entities.values() ?? []) {
      if (entity.templateId !== 'rift_boss_necro' || entity.dead) continue;
      const d = (entity.pos.x - x) ** 2 + (entity.pos.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = entity.id;
      }
    }
    return best;
  }

  private startEnding(slot: SoulSlot): void {
    const ending = this.endings.find((e) => e.age < 0) ?? this.endings[0];
    const absorbed =
      soulEnding(slot.lastX, slot.lastZ, this.harvestX, this.harvestZ) === 'absorbed';
    ending.age = 0;
    ending.absorbed = absorbed;
    ending.x = absorbed ? this.harvestX : slot.lastX;
    ending.z = absorbed ? this.harvestZ : slot.lastZ;
    ending.y = this.groundY(ending.x, ending.z) + (absorbed ? this.bossChestHeight() : 1.3);
    const count = absorbed ? 22 : 14;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + slot.cueId;
      const lift = absorbed ? 0.6 : 2.4;
      const out = absorbed ? 4.5 : 1.6;
      this.emit(
        ending.x,
        ending.y,
        ending.z,
        Math.sin(a) * out,
        lift * (0.5 + ((i * 7) % 5) / 5),
        Math.cos(a) * out,
        absorbed ? 0.75 : 0.95,
        absorbed ? LOOK.absorb : LOOK.soulCore,
        absorbed ? 0.34 : 0.26,
      );
    }
  }

  private bossChestHeight(): number {
    const boss = this.bossId >= 0 ? this.world?.entities.get(this.bossId) : undefined;
    return 1.25 * (boss?.scale ?? 2.7);
  }

  private emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    color: number,
    size: number,
  ): void {
    const sparks = this.sparks;
    if (!sparks || this.reducedMotion()) return;
    const i = sparks.cursor;
    sparks.cursor = (sparks.cursor + 1) % SPARKS;
    sparks.position.setXYZ(i, x, y, z);
    sparks.velocity[i * 3] = vx;
    sparks.velocity[i * 3 + 1] = vy;
    sparks.velocity[i * 3 + 2] = vz;
    sparks.life[i] = life;
    sparks.span[i] = life;
    sparks.size.setX(i, size);
    this.color.setHex(color);
    sparks.tint.setXYZ(i, this.color.r, this.color.g, this.color.b);
    sparks.live = Math.max(sparks.live, 1);
    // Size and tint are written only here, so only here are they re-uploaded.
    sparks.size.needsUpdate = true;
    sparks.tint.needsUpdate = true;
  }

  update(dt: number): void {
    if (this.disposed) return;
    this.time += dt;
    for (const rig of this.rigs) this.updateScythe(rig, dt);
    this.updateSouls(dt);
    this.updateEndings(dt);
    this.updateBoss(dt);
    this.updateSparks(dt);
  }

  private updateScythe(rig: ScytheRig, dt: number): void {
    if (!rig.scytheSeen || rig.scytheCueId === -1) {
      if (rig.pivot.visible) {
        rig.pivot.visible = false;
        if (rig.trail) rig.trail.mesh.visible = false;
        if (rig.wake) rig.wake.mesh.visible = false;
      }
      return;
    }
    // A cue that refreshed this frame already IS now (online it refreshes every
    // frame): only a stale one is carried forward, so the clock never double-steps.
    if (rig.scytheFresh) rig.scytheFresh = false;
    else rig.scytheElapsed = Math.min(rig.scytheTotal, rig.scytheElapsed + dt);
    const elapsed = rig.scytheElapsed;
    const frame = rig.scytheFrame;
    const pattern = scythePatternOf(rig.scytheCueId);
    const pose = scythePose(
      rig.pose,
      rig.scytheX,
      rig.scytheZ,
      rig.scytheFacing,
      pattern,
      frame,
      elapsed,
    );
    const ground = this.groundY(pose.x, pose.z);
    rig.pivot.visible = true;
    rig.pivot.position.set(pose.x, ground, pose.z);
    rig.floorSpin.rotation.y = pose.angle;
    rig.spin.rotation.y = pose.angle;
    const still = this.reducedMotion();
    rig.tilt.rotation.set(still ? 0 : pose.leanX, 0, still ? 0 : pose.leanZ);
    rig.tilt.position.y = LOOK.bladeHeight + pose.lift;
    rig.weapon.scale.setScalar(Math.max(0.001, pose.formed));
    rig.fragments.position.y = still ? 0 : 0.14 * Math.sin(this.time * 1.7);
    rig.fragments.rotation.y = still ? 0 : 0.05 * Math.sin(this.time * 0.9);
    // The glow breathes; as the weapon fails it flares, then gutters out.
    const flare = pose.broken > 0 ? 1 + 1.6 * Math.sin(pose.broken * Math.PI) : 1;
    const breathe = still ? 1 : 0.86 + 0.14 * Math.sin(this.time * 4.2);
    rig.glowMaterial.color.setHex(LOOK.necro).multiplyScalar(pose.glow * flare * breathe);
    // The floor footprint only means "this will hurt" while it can: it is drawn
    // faint while the blade assembles, solid while it is live.
    const live = pose.active ? 1 : 0.35 * pose.glow;
    rig.sectorMaterial.opacity = 0.5 * live;
    rig.sectorEdgeMaterial.opacity = 0.75 * live;
    rig.markerMaterial.opacity = 0.5 * pose.glow;
    rig.hubGlow.material.uniforms.alpha.value = 0.75 * pose.glow * flare * breathe;
    rig.reachMaterial.opacity = (pose.active ? 0.3 : 0.16) * pose.glow;
    rig.innerMaterial.opacity = 0.2 * pose.glow;

    if (pose.broken > 0 && !rig.wasBroken) {
      rig.wasBroken = true;
      // It comes apart: bone and light thrown off along the blade.
      for (let i = 0; i < 40; i++) {
        const r =
          BONE_SCYTHE.bladeInner +
          (((i * 37) % 100) / 100) * (BONE_SCYTHE.reach - BONE_SCYTHE.bladeInner);
        const a =
          pose.angle +
          BONE_SCYTHE.rotationDirection * (((i * 53) % 100) / 100) * BONE_SCYTHE.bladeArc;
        this.emit(
          pose.x + Math.sin(a) * r,
          ground + LOOK.bladeHeight,
          pose.z + Math.cos(a) * r,
          Math.sin(a + 1.2) * 3,
          1.5 + ((i * 11) % 7) / 3,
          Math.cos(a + 1.2) * 3,
          0.9,
          i % 3 === 0 ? LOOK.necro : LOOK.bone,
          0.3,
        );
      }
    }
    if (pose.active && !still) {
      // The tip scrapes the floor: sparks thrown back along the turn.
      rig.scrapeDebt += dt * LOOK.scrapePerSec;
      while (rig.scrapeDebt >= 1) {
        rig.scrapeDebt -= 1;
        const tip = scytheTipAt(
          this.tipA,
          rig.scytheX,
          rig.scytheZ,
          rig.scytheFacing,
          pattern,
          frame,
          elapsed,
          BONE_SCYTHE.reach - 0.2,
        );
        const back = pose.angle - BONE_SCYTHE.rotationDirection * 1.1;
        const j = (this.time * 997) % 1;
        this.emit(
          tip.x,
          this.groundY(tip.x, tip.z) + 0.12,
          tip.z,
          Math.sin(back) * (2 + j * 3),
          1.2 + j * 1.8,
          Math.cos(back) * (2 + j * 3),
          0.4 + j * 0.3,
          j > 0.6 ? 0xfff0c0 : LOOK.necro,
          0.2,
        );
      }
    } else if (!pose.active && pose.broken === 0 && !still) {
      // Assembling: bone fragments drawn up out of the floor around the pivot.
      rig.scrapeDebt += dt * 22;
      while (rig.scrapeDebt >= 1) {
        rig.scrapeDebt -= 1;
        const a = this.time * 7.3 + rig.scrapeDebt * 5;
        const r = 1 + ((this.time * 131) % 1) * (BONE_SCYTHE.reach * 0.6);
        this.emit(
          pose.x + Math.sin(a) * r,
          ground + 0.1,
          pose.z + Math.cos(a) * r,
          -Math.sin(a) * 0.8,
          2.6,
          -Math.cos(a) * 0.8,
          0.7,
          LOOK.bone,
          0.24,
        );
      }
    }
    this.writeTrail(rig, pattern, frame, elapsed, pose);
  }

  /** The spectral trail (the blade's true recent path: both transforms) and the
   *  faint wake the pivot leaves on the floor. */
  private writeTrail(
    rig: ScytheRig,
    pattern: number,
    frame: ReturnType<typeof decodeScytheFrame>,
    elapsed: number,
    pose: ScythePose,
  ): void {
    const trail = rig.trail;
    const wake = rig.wake;
    if (!trail || !wake) return;
    const show = pose.active || pose.broken > 0;
    trail.mesh.visible = show;
    wake.mesh.visible = show;
    if (!show) return;
    const fade = 1 - pose.broken;
    for (let s = 0; s < TRAIL; s++) {
      const back = (s / (TRAIL - 1)) * LOOK.trailSec;
      const t = Math.max(BONE_SCYTHE.castSec, elapsed - back);
      const inner = scytheTipAt(
        this.tipA,
        rig.scytheX,
        rig.scytheZ,
        rig.scytheFacing,
        pattern,
        frame,
        t,
        BONE_SCYTHE.bladeInner + 0.5,
      );
      const outer = scytheTipAt(
        this.tipB,
        rig.scytheX,
        rig.scytheZ,
        rig.scytheFacing,
        pattern,
        frame,
        t,
        BONE_SCYTHE.reach,
      );
      const y = this.groundY(outer.x, outer.z) + LOOK.bladeHeight;
      trail.position.setXYZ(s * 2, inner.x, y, inner.z);
      trail.position.setXYZ(s * 2 + 1, outer.x, y, outer.z);
      const a = (1 - s / (TRAIL - 1)) ** 1.6 * 0.55 * fade;
      trail.alpha.setX(s * 2, a * 0.35);
      trail.alpha.setX(s * 2 + 1, a);
    }
    trail.position.needsUpdate = true;
    trail.alpha.needsUpdate = true;
    for (let s = 0; s < WAKE; s++) {
      const back = (s / (WAKE - 1)) * LOOK.wakeSec;
      const t = Math.max(BONE_SCYTHE.castSec, elapsed - back);
      const at = scythePivot(rig.scytheX, rig.scytheZ, pattern, frame, t, this.past);
      const y = this.groundY(at.x, at.z) + 0.07;
      // Widened across the travel direction.
      const wx = -pose.dirZ * 0.7;
      const wz = pose.dirX * 0.7;
      wake.position.setXYZ(s * 2, at.x + wx, y, at.z + wz);
      wake.position.setXYZ(s * 2 + 1, at.x - wx, y, at.z - wz);
      const a = (1 - s / (WAKE - 1)) * 0.3 * fade * Math.min(1, pose.speed / 2);
      wake.alpha.setX(s * 2, a);
      wake.alpha.setX(s * 2 + 1, a);
    }
    wake.position.needsUpdate = true;
    wake.alpha.needsUpdate = true;
  }

  private updateSouls(dt: number): void {
    let count = 0;
    const tails = this.soulTrails;
    const still = this.reducedMotion();
    for (const slot of this.soulSlots) {
      if (slot.instanceId === -1) continue;
      if (slot.fresh) slot.fresh = false;
      else slot.elapsed = Math.min(slot.total, slot.elapsed + dt);
      const bossX = this.harvestSeen ? this.harvestX : slot.lastX;
      const bossZ = this.harvestSeen ? this.harvestZ : slot.lastZ;
      const pose = soulPose(
        this.soulPoseScratch,
        slot.spawnX,
        slot.spawnZ,
        bossX,
        bossZ,
        slot.elapsed,
        slot.total,
        slot.cueId,
      );
      slot.lastX = pose.x;
      slot.lastZ = pose.z;
      const ground = this.groundY(pose.x, pose.z);
      const dummy = this.dummy;
      for (let part = 0; part < this.soulParts.length; part++) {
        dummy.position.set(pose.x, ground + (still ? LOOK.soulFloat : pose.y), pose.z);
        dummy.rotation.set(
          0,
          pose.yaw + (part === 2 && !still ? this.time * 1.5 + slot.cueId : 0),
          0,
        );
        // Stretched along its heading as the boss takes it (the wisps spin, so they keep their shape).
        if (part === 2) dummy.scale.setScalar(pose.scale);
        else dummy.scale.set(pose.scale, pose.scale, pose.scale * pose.stretch);
        dummy.updateMatrix();
        this.soulParts[part].setMatrixAt(count, dummy.matrix);
        const pulse = still ? 1 : 0.85 + 0.15 * Math.sin(this.time * 5 + slot.cueId);
        const gain = part === 3 ? 1 : pose.glow * (part === 1 ? pulse * 1.2 : pulse);
        this.soulParts[part].setColorAt(count, this.color.setRGB(gain, gain, gain));
      }
      dummy.position.set(pose.x, ground + 0.06, pose.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      this.soulMarkers.setMatrixAt(count, dummy.matrix);
      const mark = 0.35 + 0.65 * pose.glow;
      this.soulMarkers.setColorAt(count, this.color.setRGB(mark, mark, mark));
      dummy.position.set(
        pose.x,
        ground + (still ? LOOK.soulFloat : pose.y) + 1.25 * pose.scale,
        pose.z,
      );
      dummy.scale.setScalar(3.4 * pose.scale);
      dummy.updateMatrix();
      this.soulHalos.setMatrixAt(count, dummy.matrix);
      const halo = 0.55 * pose.glow;
      this.soulHalos.setColorAt(count, this.color.setRGB(halo, halo, halo));
      if (tails) this.writeSoulTail(tails, count, slot, pose, ground);
      count++;
    }
    // An empty pool is hidden, not just emptied: a visible instanced mesh with no
    // instances still pays its program and binding setup every frame.
    for (const mesh of this.soulParts) {
      mesh.count = count;
      mesh.visible = count > 0;
      if (count > 0) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
    this.soulMarkers.count = count;
    this.soulHalos.count = count;
    this.soulMarkers.visible = count > 0;
    this.soulHalos.visible = count > 0;
    if (count > 0) {
      this.soulMarkers.instanceMatrix.needsUpdate = true;
      if (this.soulMarkers.instanceColor) this.soulMarkers.instanceColor.needsUpdate = true;
      this.soulHalos.instanceMatrix.needsUpdate = true;
      if (this.soulHalos.instanceColor) this.soulHalos.instanceColor.needsUpdate = true;
    }
    if (tails) {
      tails.mesh.visible = count > 0;
      if (count > 0) {
        // Park the unused runs as zero-alpha so stale tails never linger.
        for (let v = count * (SOUL_TRAIL_SEGMENTS + 1) * 2; v < tails.alpha.count; v++)
          tails.alpha.setX(v, 0);
        tails.position.needsUpdate = true;
        tails.alpha.needsUpdate = true;
      }
    }
  }

  /** A soul's tail: a ribbon back along the line it has walked, longer the
   *  further it has come, so the direction of travel is never in doubt. */
  private writeSoulTail(
    tails: NonNullable<HoardBoneReaperFx['soulTrails']>,
    index: number,
    slot: SoulSlot,
    pose: SoulPose,
    ground: number,
  ): void {
    const base = index * (SOUL_TRAIL_SEGMENTS + 1) * 2;
    const dx = slot.spawnX - pose.x;
    const dz = slot.spawnZ - pose.z;
    const walked = Math.hypot(dx, dz);
    const length = Math.min(3.4, walked) * (pose.drawn ? 1 : 0);
    const ux = walked > 1e-4 ? dx / walked : 0;
    const uz = walked > 1e-4 ? dz / walked : 0;
    for (let s = 0; s <= SOUL_TRAIL_SEGMENTS; s++) {
      const f = s / SOUL_TRAIL_SEGMENTS;
      const x = pose.x + ux * length * f;
      const z = pose.z + uz * length * f;
      const half = 0.3 * (1 - f * 0.85);
      const y = ground + pose.y + 1 * LOOK.soulScale;
      tails.position.setXYZ(base + s * 2, x, y + half, z);
      tails.position.setXYZ(base + s * 2 + 1, x, y - half, z);
      // The first and last columns are transparent, so neighbouring runs never join visibly.
      const a = s === 0 || s === SOUL_TRAIL_SEGMENTS ? 0 : (1 - f) * 0.5 * pose.glow;
      tails.alpha.setX(base + s * 2, a);
      tails.alpha.setX(base + s * 2 + 1, a);
    }
  }

  private updateEndings(dt: number): void {
    for (const ending of this.endings) {
      if (ending.age < 0) continue;
      ending.age += dt;
      const span = ending.absorbed ? LOOK.absorbBurstSec : LOOK.releaseBurstSec;
      const t = ending.age / span;
      if (t >= 1) {
        ending.age = -1;
        ending.flash.visible = false;
        ending.ring.visible = false;
        continue;
      }
      const ease = 1 - (1 - t) ** 3;
      ending.flash.visible = true;
      ending.ring.visible = true;
      ending.flash.position.set(ending.x, ending.y, ending.z);
      // Released: a clean bright pop. Absorbed: a heavier green bloom at his ribs.
      ending.flash.scale.setScalar(ending.absorbed ? 0.6 + 2.4 * ease : 0.3 + 1.2 * ease);
      ending.flash.material.color.setHex(ending.absorbed ? LOOK.absorb : LOOK.soulCore);
      ending.flash.material.opacity = (ending.absorbed ? 0.85 : 0.9) * (1 - t) ** 2;
      ending.ring.position.set(ending.x, this.groundY(ending.x, ending.z) + 0.08, ending.z);
      ending.ring.scale.setScalar(ending.absorbed ? 2 + 7 * ease : 0.5 + 2.6 * ease);
      ending.ring.material.color.setHex(ending.absorbed ? LOOK.absorb : LOOK.soul);
      ending.ring.material.opacity = (ending.absorbed ? 0.8 : 0.6) * (1 - t);
    }
  }

  /** The boss wears what he has eaten: ribs first, then an aura and orbiting wisps. */
  private updateBoss(dt: number): void {
    this.stackPoll -= dt;
    if (this.stackPoll <= 0) {
      this.stackPoll = 0.25;
      const boss = this.bossId >= 0 ? this.world?.entities.get(this.bossId) : undefined;
      let stacks = 0;
      if (boss && !boss.dead)
        for (let i = 0; i < boss.auras.length; i++)
          if (boss.auras[i].id === HOARD_HARVESTED_SOUL_AURA_ID) stacks = boss.auras[i].stacks ?? 1;
      this.stacks = stacks;
    }
    const boss =
      this.stacks > 0 && this.bossId >= 0 ? this.world?.entities.get(this.bossId) : undefined;
    if (!boss) {
      if (this.ribs.visible || this.aura.visible) {
        this.ribs.visible = false;
        this.aura.visible = false;
        for (const orb of this.orbiters) orb.visible = false;
      }
      return;
    }
    const look = harvestedLook(this.stacks, this.lookScratch);
    const still = this.reducedMotion();
    const ground = this.groundY(boss.pos.x, boss.pos.z);
    const chest = ground + this.bossChestHeight();
    const pulse = still ? 1 : 0.8 + 0.2 * Math.sin(this.time * 3.1);
    this.ribs.visible = true;
    this.ribs.position.set(boss.pos.x, chest, boss.pos.z);
    this.ribs.scale.setScalar((1.4 + 1.5 * look.ribs) * (boss.scale ?? 2.7) * 0.5);
    this.ribs.material.uniforms.alpha.value = 0.8 * look.ribs * pulse;
    this.aura.visible = look.aura > 0 && !this.low;
    if (this.aura.visible) {
      this.aura.position.set(boss.pos.x, ground + 0.07, boss.pos.z);
      this.aura.scale.setScalar(3.2 + 0.5 * (still ? 0 : Math.sin(this.time * 1.4)));
      this.aura.material.opacity = 0.45 * look.aura;
    }
    for (let o = 0; o < this.orbiters.length; o++) {
      const orb = this.orbiters[o];
      orb.visible = o < look.orbiters && !this.low;
      if (!orb.visible) continue;
      const a = (still ? 0 : this.time * 1.3) + (o / Math.max(1, look.orbiters)) * Math.PI * 2;
      orb.position.set(
        boss.pos.x + Math.sin(a) * 2.6,
        chest + 0.5 * Math.sin(a * 2 + o),
        boss.pos.z + Math.cos(a) * 2.6,
      );
      orb.scale.setScalar(0.2);
    }
  }

  private updateSparks(dt: number): void {
    const sparks = this.sparks;
    if (!sparks || sparks.live === 0) return;
    let alive = 0;
    for (let i = 0; i < SPARKS; i++) {
      if (sparks.life[i] <= 0) continue;
      sparks.life[i] -= dt;
      if (sparks.life[i] <= 0) {
        sparks.alpha.setX(i, 0);
        continue;
      }
      alive++;
      sparks.velocity[i * 3 + 1] -= 5.5 * dt;
      sparks.position.setXYZ(
        i,
        sparks.position.getX(i) + sparks.velocity[i * 3] * dt,
        sparks.position.getY(i) + sparks.velocity[i * 3 + 1] * dt,
        sparks.position.getZ(i) + sparks.velocity[i * 3 + 2] * dt,
      );
      sparks.alpha.setX(i, Math.min(1, (sparks.life[i] / sparks.span[i]) * 1.6));
    }
    sparks.live = alive;
    sparks.points.visible = alive > 0;
    sparks.position.needsUpdate = true;
    sparks.alpha.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    // An InstancedMesh owns GL buffers and binding states of its own (its
    // instance matrix and colour): only its own dispose() frees them.
    for (const mesh of this.soulParts) mesh.dispose();
    this.soulMarkers.dispose();
    this.soulHalos.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.clear();
    this.materials.clear();
  }
}
