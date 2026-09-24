// Nyxaris's Bound Pulsars, drawn from what already reaches the client: two boss
// auras (how many orbs ride him; his ward), the orbs' own mobs, and the hoard
// cues. WHERE an orb rides, where it takes station and where its beam burns is
// the shared sim core (src/sim/rift/hoard_pulsars_core.ts), so the beam on screen
// is the beam that hits; how it all LOOKS is hoard_pulsars_core.ts beside this
// file.
//
// What is Blender and what is runtime: the orb is a Blender model with every
// moving part its own node (docs/design/pulsars/). Everything that depends on
// the moment is code: the hover and the spin, the flight off his shoulder, the
// links that ward him, the targeting line, the chasing beam and its trail, the
// wounds, the death and the reforming.
//
// While an orb is ACTIVE its nucleus is the mob's own body (the character
// system draws, targets and health-bars it); this file draws everything round
// it. Dormant, leaving, dying or reforming there is no mob, so the nucleus here
// is shown instead.
//
// Performance contract (the siblings' contract): every geometry and material is
// built once here and attached through the scene gate, so nothing compiles
// mid-fight; no dynamic lights; nothing is allocated per frame. Outside a rift
// floor the idle frame is a few branches; inside one the boss is looked for on a
// slow poll (an entity scan every 0.4 s), and each active orb's mob is found by
// one scan and then read by id. The low tier sheds the beam's trail, the sparks, the arcs and the
// orbiting runes. It NEVER sheds what a player acts on: the orbs, the targeting
// line, the beam and its floor mark, and the ward's links draw on every tier.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../game/ui_effects_profile';
import {
  HOARD_BOUND_PULSARS_AURA_ID,
  HOARD_PULSAR_TEMPLATE,
  PULSARS,
  pulsarAnchor,
} from '../sim/rift/hoard_pulsars_core';
import type { IWorld } from '../world_api';
import type { HoardBossCueView } from '../world_api/dungeons';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { attachSceneGroupGated } from './gated_scene_attach';
import { GFX, type GfxTier, surfaceMat } from './gfx';
import { glowMaterial, ribbonMaterial, sparkMaterial, strip } from './hoard_fx_materials';
import {
  activationEnergy,
  bossLocalToWorld,
  dormantEnergy,
  PULSAR_LOOK as LOOK,
  type OrbDeath,
  type OrbEnergy,
  type OrbReform,
  type OrbStrain,
  orbDeath,
  orbReform,
  orbStrain,
} from './hoard_pulsars_core';
import { setRenderCategory } from './renderer_diagnostics';

export const PULSAR_ASSET_URL = '/vfx/pulsars/orb.glb';
export const PULSAR_BOSS_TEMPLATE = 'rift_boss_arcane';
let source: THREE.Group | undefined;
let loading: Promise<THREE.Group | undefined> | undefined;
function loadSource(): Promise<THREE.Group | undefined> {
  loading ??= loadGltf(PULSAR_ASSET_URL)
    .then((gltf) => {
      source = gltf.scene;
      return source;
    })
    .catch(() => undefined);
  return loading;
}
if (typeof window !== 'undefined') registerDeferredPreload(loadSource);

const RIGS = PULSARS.orbCountLegendary;
const FRAGMENTS = ['Fragment_01', 'Fragment_02', 'Fragment_03', 'Fragment_04'] as const;
const SPARKS = 180;
const LINK_SEGMENTS = 10;
const BOSS_CHEST = 1.1; // in units of the boss's own scale
const PULSES = 3;

type OrbMode = 'hidden' | 'dormant' | 'active' | 'dying' | 'reforming';

interface Plate {
  node: THREE.Group;
  outX: number;
  outY: number;
  outZ: number;
}

interface OrbRig {
  index: number;
  mode: OrbMode;
  age: number;
  // ---- its cue (active), and the beam or lock that shares the next id
  instanceId: number;
  cueId: number;
  seen: boolean;
  fresh: boolean;
  total: number;
  remaining: number;
  elapsed: number;
  stationX: number;
  stationZ: number;
  beamSeen: boolean;
  beamFiring: boolean;
  beamAge: number;
  cueAimX: number;
  cueAimZ: number;
  aimX: number;
  aimZ: number;
  aimSet: boolean;
  trailClock: number;
  trailHead: number;
  trailLive: number;
  /** The orb's own mob, polled now and then for its health. */
  health: number;
  healthPoll: number;
  mobId: number;
  // ---- where it is now
  x: number;
  y: number;
  z: number;
  // ---- the model
  root: THREE.Group;
  spin: THREE.Group;
  core: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  jets: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  plates: Plate[];
  ringA: THREE.Group;
  ringB: THREE.Group;
  runes: THREE.Group;
  arcs: THREE.Group;
  emitter: THREE.Group;
  glowMaterial: THREE.MeshBasicMaterial;
  arcMaterial: THREE.MeshBasicMaterial;
  halo: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  // ---- the beam
  beamCore: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  beamInner: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  beamOuter: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  impact: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  impactGlow: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  lockLine: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  lockMark: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** The ring a dying orb throws. */
  nova: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** Bright bands that run down the beam from the orb: it is alive, never a tube. */
  pulses: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
  trail?: ReturnType<typeof strip> & { mesh: THREE.Mesh; material: THREE.ShaderMaterial };
  trailX: Float32Array;
  trailZ: Float32Array;
  link: ReturnType<typeof strip> & { mesh: THREE.Mesh; material: THREE.ShaderMaterial };
}

export class HoardPulsarFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private readonly low: boolean;
  private disposed = false;
  private time = 0;
  private seed = 7;

  private readonly rigs: OrbRig[] = [];

  // ---- the boss: found now and then, followed smoothly
  private bossId = -1;
  private bossPoll = 0;
  private bossX = 0;
  private bossY = 0;
  private bossZ = 0;
  private bossFacing = 0;
  private bossSet = false;
  private bossScale = 1;
  private wardFall = -1;
  private riding = 0;
  private warded = false;
  private wardSeen = false;
  private readonly ward: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly wardGlow: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;

  private readonly sparks?: {
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

  private readonly energy: OrbEnergy = {
    charge: 0,
    travel: 0,
    spin: 1,
    link: 0,
    pulse: 0,
    open: 1,
  };
  private readonly strain: OrbStrain = {
    instability: 0,
    shake: 0,
    flickerHz: 0,
    flickerDepth: 0,
    cracks: 0,
  };
  private readonly death: OrbDeath = {
    coreScale: 1,
    flash: 0,
    nova: 0,
    scatter: 0,
    fade: 1,
    done: false,
  };
  private readonly reform: OrbReform = { gather: 0, plates: 0, core: 1, done: false };
  private readonly anchor = { x: 0, y: 0, z: 0 };
  private readonly at = { x: 0, y: 0, z: 0 };

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
    this.root.name = 'hoard-pulsars';
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
    const ring = this.own(new THREE.RingGeometry(0.78, 1, 48).rotateX(-Math.PI / 2));
    // A unit beam: from its root at the origin along +Z, so a mesh is placed at
    // the orb, aimed with lookAt, and stretched to the aim point.
    const beam = this.own(
      new THREE.CylinderGeometry(1, 1, 1, 12, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2),
    );

    for (let index = 0; index < RIGS; index++) {
      this.rigs.push(this.makeRig(index, initial, card, ring, beam));
    }

    this.ward = new THREE.Mesh(ring, this.keep(this.basic(LOOK.glow, 0, true)));
    this.ward.name = 'PulsarWard';
    this.wardGlow = new THREE.Mesh(card, this.keep(glowMaterial(LOOK.glow, false)));
    for (const mesh of [this.ward, this.wardGlow]) {
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 23;
      this.root.add(mesh);
    }

    if (!this.low) {
      const geometry = this.own(new THREE.BufferGeometry());
      const position = new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3);
      const size = new THREE.BufferAttribute(new Float32Array(SPARKS), 1);
      const alpha = new THREE.BufferAttribute(new Float32Array(SPARKS), 1);
      const tint = new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3);
      position.setUsage(THREE.DynamicDrawUsage);
      size.setUsage(THREE.DynamicDrawUsage);
      alpha.setUsage(THREE.DynamicDrawUsage);
      const color = new THREE.Color(LOOK.core);
      for (let i = 0; i < SPARKS; i++) tint.setXYZ(i, color.r, color.g, color.b);
      geometry.setAttribute('position', position);
      geometry.setAttribute('size', size);
      geometry.setAttribute('alpha', alpha);
      geometry.setAttribute('tint', tint);
      const points = new THREE.Points(geometry, this.keep(sparkMaterial()));
      points.visible = false;
      points.frustumCulled = false;
      points.renderOrder = 30;
      this.root.add(points);
      this.sparks = {
        points,
        position,
        size,
        alpha,
        velocity: new Float32Array(SPARKS * 3),
        life: new Float32Array(SPARKS),
        span: new Float32Array(SPARKS),
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
          for (let i = 0; i < this.rigs.length; i++) this.buildOrb(this.rigs[i], loaded);
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

  private makeRig(
    index: number,
    asset: THREE.Group | undefined,
    card: THREE.BufferGeometry,
    ring: THREE.BufferGeometry,
    beam: THREE.BufferGeometry,
  ): OrbRig {
    const link = strip(LINK_SEGMENTS);
    this.own(link.geometry);
    const linkMaterial = this.keep(ribbonMaterial(LOOK.glow));
    const linkMesh = new THREE.Mesh(link.geometry, linkMaterial);
    linkMesh.name = 'PulsarLink';
    let trail: OrbRig['trail'];
    if (!this.low) {
      const made = strip(LOOK.trailSamples - 1);
      this.own(made.geometry);
      const material = this.keep(ribbonMaterial(LOOK.glow));
      const mesh = new THREE.Mesh(made.geometry, material);
      mesh.name = 'PulsarTrail';
      trail = { ...made, mesh, material };
    }
    const solid = (color: number): THREE.MeshBasicMaterial =>
      this.keep(new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    const rig: OrbRig = {
      index,
      mode: 'hidden',
      age: 0,
      instanceId: -1,
      cueId: -1,
      seen: false,
      fresh: false,
      total: 0,
      remaining: -1,
      elapsed: 0,
      stationX: 0,
      stationZ: 0,
      beamSeen: false,
      beamFiring: false,
      beamAge: 0,
      cueAimX: 0,
      cueAimZ: 0,
      aimX: 0,
      aimZ: 0,
      aimSet: false,
      trailClock: 0,
      trailHead: 0,
      trailLive: 0,
      health: 1,
      healthPoll: 0,
      mobId: -1,
      x: 0,
      y: 0,
      z: 0,
      root: new THREE.Group(),
      spin: new THREE.Group(),
      core: new THREE.Mesh(card, solid(LOOK.core)),
      jets: new THREE.Mesh(card, solid(LOOK.core)),
      plates: [],
      ringA: new THREE.Group(),
      ringB: new THREE.Group(),
      runes: new THREE.Group(),
      arcs: new THREE.Group(),
      emitter: new THREE.Group(),
      glowMaterial: solid(LOOK.glow),
      arcMaterial: this.keep(this.basic(LOOK.core, 0.9, true)),
      halo: new THREE.Mesh(card, this.keep(glowMaterial(LOOK.glow, false))),
      beamCore: new THREE.Mesh(beam, this.keep(this.basic(0xffffff, 0, true))),
      beamInner: new THREE.Mesh(beam, this.keep(this.basic(LOOK.glow, 0, true))),
      beamOuter: new THREE.Mesh(beam, this.keep(this.basic(LOOK.deep, 0, true))),
      impact: new THREE.Mesh(ring, this.keep(this.basic(LOOK.core, 0, true))),
      impactGlow: new THREE.Mesh(card, this.keep(glowMaterial(LOOK.glow, false))),
      lockLine: new THREE.Mesh(beam, this.keep(this.basic(LOOK.core, 0, true))),
      lockMark: new THREE.Mesh(ring, this.keep(this.basic(LOOK.core, 0, true))),
      nova: new THREE.Mesh(ring, this.keep(this.basic(LOOK.core, 0, true))),
      pulses: [],
      trail,
      trailX: new Float32Array(LOOK.trailSamples),
      trailZ: new Float32Array(LOOK.trailSamples),
      link: { ...link, mesh: linkMesh, material: linkMaterial },
    };
    rig.root.name = 'PulsarOrb';
    rig.nova.name = 'PulsarNova';
    rig.beamInner.name = 'PulsarBeam';
    rig.lockLine.name = 'PulsarLock';
    rig.root.visible = false;
    rig.root.add(rig.spin, rig.halo);
    rig.halo.frustumCulled = false;
    rig.halo.renderOrder = 25;
    this.root.add(rig.root);
    if (!this.low) {
      const pulseMaterial = this.keep(this.basic(0xffffff, 0.85, true));
      for (let p = 0; p < PULSES; p++) rig.pulses.push(new THREE.Mesh(beam, pulseMaterial));
    }
    const floating = [
      rig.nova,
      ...rig.pulses,
      rig.beamOuter,
      rig.beamInner,
      rig.beamCore,
      rig.impact,
      rig.impactGlow,
      rig.lockLine,
      rig.lockMark,
      linkMesh,
    ];
    for (let i = 0; i < floating.length; i++) {
      floating[i].visible = false;
      floating[i].frustumCulled = false;
      floating[i].renderOrder = 24 + i;
      this.root.add(floating[i]);
    }
    if (trail) {
      trail.mesh.visible = false;
      trail.mesh.frustumCulled = false;
      trail.mesh.renderOrder = 22;
      this.root.add(trail.mesh);
    }
    this.buildOrb(rig, asset);
    return rig;
  }

  /** Bake one named part of the (quantized) asset into float geometry in the
   *  orb's own frame, one mesh per material it carries. */
  private bakePart(
    asset: THREE.Group,
    name: string,
    into: THREE.Group,
    pick: (material: string) => THREE.Material,
  ): boolean {
    const part = asset.getObjectByName(name);
    if (!part) return false;
    part.updateWorldMatrix(true, true);
    const v = new THREE.Vector3();
    part.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      // The shipped GLB is quantized: positions are normalized integers the NODE
      // transform scales back up. Bake through fromBufferAttribute, into floats.
      const from = mesh.geometry.getAttribute('position');
      const positions = new Float32Array(from.count * 3);
      for (let i = 0; i < from.count; i++) {
        v.fromBufferAttribute(from, i).applyMatrix4(mesh.matrixWorld);
        positions[i * 3] = v.x;
        positions[i * 3 + 1] = v.y;
        positions[i * 3 + 2] = v.z;
      }
      const geometry = this.own(new THREE.BufferGeometry());
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const index = mesh.geometry.getIndex();
      if (index) geometry.setIndex(Array.from(index.array));
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      into.add(new THREE.Mesh(geometry, pick(material.name)));
    });
    return true;
  }

  /** The orb: the Blender model in the game's own surface material for its
   *  crystal plates, on materials of ours wherever it glows. Plain stand-ins of the same
   *  size serve until (or unless) the asset arrives. */
  private buildOrb(rig: OrbRig, asset: THREE.Group | undefined): void {
    rig.spin.clear();
    rig.plates.length = 0;
    for (const group of [rig.ringA, rig.ringB, rig.runes, rig.arcs, rig.emitter]) group.clear();
    const shell = surfaceMat({
      color: LOOK.shell,
      roughness: 0.3,
      metalness: 0.1,
      emissive: LOOK.glow,
      emissiveIntensity: 0.45,
      flatShading: true,
    });
    const rune = surfaceMat({
      color: LOOK.rune,
      roughness: 0.4,
      metalness: 0.6,
      emissive: LOOK.glow,
      emissiveIntensity: 0.5,
      flatShading: true,
    });
    const pick = (name: string): THREE.Material =>
      name === 'PulsarShell'
        ? shell
        : name === 'PulsarRune'
          ? rune
          : name === 'PulsarCore'
            ? rig.core.material
            : rig.glowMaterial;
    if (!asset?.getObjectByName('CoreEnergy')) {
      rig.core.geometry = this.own(new THREE.IcosahedronGeometry(0.44, 1));
      rig.jets.geometry = this.own(new THREE.CylinderGeometry(0.02, 0.08, 3, 4));
      const ringGeometry = this.own(new THREE.TorusGeometry(0.75, 0.04, 4, 24));
      rig.ringA.add(new THREE.Mesh(ringGeometry, rig.glowMaterial));
    } else {
      const core = new THREE.Group();
      const jets = new THREE.Group();
      this.bakePart(asset, 'CoreEnergy', core, pick);
      this.bakePart(asset, 'CoreJets', jets, pick);
      const coreMesh = core.children[0] as THREE.Mesh | undefined;
      const jetsMesh = jets.children[0] as THREE.Mesh | undefined;
      if (coreMesh) rig.core.geometry = coreMesh.geometry;
      if (jetsMesh) rig.jets.geometry = jetsMesh.geometry;
      for (const name of FRAGMENTS) {
        const node = new THREE.Group();
        if (!this.bakePart(asset, name, node, pick)) continue;
        // Which way this plate stands off the nucleus: its own middle, outward.
        const box = new THREE.Box3().setFromObject(node);
        const out = box.getCenter(new THREE.Vector3()).normalize();
        rig.plates.push({ node, outX: out.x, outY: out.y, outZ: out.z });
        rig.spin.add(node);
      }
      this.bakePart(asset, 'EnergyRing_A', rig.ringA, pick);
      this.bakePart(asset, 'EnergyRing_B', rig.ringB, pick);
      this.bakePart(asset, 'BeamEmitter', rig.emitter, pick);
      if (!this.low) {
        this.bakePart(asset, 'RuneFragments', rig.runes, pick);
        this.bakePart(asset, 'ArcSegments', rig.arcs, () => rig.arcMaterial);
      }
    }
    rig.spin.add(rig.core, rig.jets, rig.ringA, rig.ringB, rig.runes, rig.arcs);
    rig.root.add(rig.emitter);
  }

  sync(cues: readonly HoardBossCueView[]): void {
    if (this.disposed) return;
    this.wardSeen = false;
    for (let i = 0; i < this.rigs.length; i++) {
      this.rigs[i].seen = false;
      this.rigs[i].beamSeen = false;
    }
    // Orbs first, so a beam can find the orb whose id sits just under its own.
    for (let c = 0; c < cues.length; c++) {
      const cue = cues[c];
      if (cue.remaining <= 0) continue;
      if (cue.variant === 'arcane-pulsar-ward') {
        this.wardSeen = true;
        continue;
      }
      if (cue.variant !== 'arcane-pulsar') continue;
      const rig = this.rigs[Math.max(0, Math.min(RIGS - 1, Math.round(cue.radius)))];
      rig.seen = true;
      if (rig.cueId !== cue.cueId || rig.instanceId !== cue.instanceId) {
        this.resetRig(rig);
        rig.cueId = cue.cueId;
        rig.instanceId = cue.instanceId;
        rig.mode = 'active';
      }
      rig.stationX = cue.x;
      rig.stationZ = cue.z;
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
      const firing = cue.variant === 'arcane-pulsar-beam';
      if (!firing && cue.variant !== 'arcane-pulsar-lock') continue;
      for (let i = 0; i < this.rigs.length; i++) {
        const rig = this.rigs[i];
        if (!rig.seen || rig.instanceId !== cue.instanceId || rig.cueId + 1 !== cue.cueId) continue;
        rig.beamSeen = true;
        if (rig.beamFiring !== firing) {
          rig.beamFiring = firing;
          rig.beamAge = 0;
          rig.aimSet = false;
          rig.trailLive = 0;
        }
        rig.cueAimX = cue.x;
        rig.cueAimZ = cue.z;
        break;
      }
    }
    for (let i = 0; i < this.rigs.length; i++) {
      const rig = this.rigs[i];
      if (rig.seen || rig.cueId === -1) continue;
      // Its cue is gone: destroyed by the players, or burst at the deadline.
      rig.cueId = -1;
      if (rig.mode !== 'active') continue;
      // Killed (it was wounded when last seen) or burst at the deadline: it dies
      // on screen. Anything else is the encounter resetting under a healthy orb
      // (a wipe, a leash, leaving the hoard): it just goes, with no burst and no
      // shake for an orb nobody destroyed.
      const destroyed = rig.health <= 0.5 || rig.elapsed >= rig.total - 0.5;
      if (!destroyed) {
        rig.mode = 'hidden';
        this.hideOrb(rig);
        continue;
      }
      rig.mode = 'dying';
      rig.age = 0;
      this.burst(rig.x, rig.y, rig.z, 110, 13);
      if (!this.low && !this.reducedMotion()) this.shake?.(0.12);
    }
  }

  update(dt: number): void {
    if (this.disposed) return;
    this.time += dt;
    this.followBoss(dt);
    for (let i = 0; i < this.rigs.length; i++) this.updateOrb(this.rigs[i], dt);
    this.updateWard(dt);
    this.updateSparks(dt);
  }

  /** The boss whose orbs these are: found on a slow poll, followed every frame. */
  private followBoss(dt: number): void {
    const world = this.world;
    if (!world) return;
    // Only ever inside a rift floor (a hoard is one): out in the world this whole
    // module is three hidden rigs and this one branch, with no entity scan.
    if (!world.riftFloor) {
      if (this.bossSet || this.bossId !== -1) {
        this.bossId = -1;
        this.bossSet = false;
        this.riding = 0;
        this.warded = false;
        this.wardFall = -1;
      }
      return;
    }
    this.bossPoll -= dt;
    if (this.bossPoll <= 0) {
      this.bossPoll = 0.4;
      let found = -1;
      const held = this.bossId === -1 ? undefined : world.entities.get(this.bossId);
      if (held && !held.dead && held.templateId === PULSAR_BOSS_TEMPLATE) found = held.id;
      else {
        for (const entity of world.entities.values()) {
          if (entity.templateId !== PULSAR_BOSS_TEMPLATE || entity.dead) continue;
          found = entity.id;
          break;
        }
      }
      if (found !== this.bossId) this.bossSet = false;
      this.bossId = found;
    }
    const boss = this.bossId === -1 ? undefined : world.entities.get(this.bossId);
    if (!boss || boss.dead) {
      this.riding = 0;
      this.warded = false;
      this.bossSet = false;
      this.wardFall = -1;
      return;
    }
    let riding = 0;
    for (let i = 0; i < boss.auras.length; i++) {
      if (boss.auras[i].id === HOARD_BOUND_PULSARS_AURA_ID) riding = boss.auras[i].stacks ?? 1;
    }
    this.riding = riding;
    if (this.warded && !this.wardSeen) this.wardFall = 0;
    this.warded = this.wardSeen;
    this.bossScale = boss.scale > 0 ? boss.scale : 1;
    const y = this.groundY(boss.pos.x, boss.pos.z);
    if (!this.bossSet) {
      this.bossSet = true;
      this.bossX = boss.pos.x;
      this.bossY = y;
      this.bossZ = boss.pos.z;
      this.bossFacing = boss.facing;
      return;
    }
    // The sim steps him twenty times a second: glide between, never jump.
    const k = Math.min(1, dt * 12);
    this.bossX += (boss.pos.x - this.bossX) * k;
    this.bossY += (y - this.bossY) * k;
    this.bossZ += (boss.pos.z - this.bossZ) * k;
    let turn = boss.facing - this.bossFacing;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    this.bossFacing += turn * k;
  }

  /** A rig is keyed by orb index, so it is reused across cues, instances and
   *  whole hoard runs: a new cue starts it clean, with nothing of the last orb
   *  (its dying ring, its beam's age, its trail, its mob) left showing. */
  private resetRig(rig: OrbRig): void {
    rig.remaining = -1;
    rig.age = 0;
    rig.health = 1;
    rig.healthPoll = 0;
    rig.mobId = -1;
    rig.beamFiring = false;
    rig.beamAge = 0;
    rig.aimSet = false;
    rig.trailClock = 0;
    rig.trailHead = 0;
    rig.trailLive = 0;
    rig.nova.visible = false;
    this.hideBeam(rig);
  }

  private hideOrb(rig: OrbRig): void {
    rig.root.visible = false;
    rig.nova.visible = false;
    rig.link.mesh.visible = false;
    this.hideBeam(rig);
  }

  private hideBeam(rig: OrbRig): void {
    rig.beamCore.visible = false;
    rig.beamInner.visible = false;
    rig.beamOuter.visible = false;
    rig.impact.visible = false;
    rig.impactGlow.visible = false;
    rig.lockLine.visible = false;
    rig.lockMark.visible = false;
    for (let p = 0; p < rig.pulses.length; p++) rig.pulses[p].visible = false;
    if (rig.trail) rig.trail.mesh.visible = false;
  }

  private updateOrb(rig: OrbRig, dt: number): void {
    const still = this.reducedMotion();
    // ---- which state it is in
    if (rig.mode !== 'active' && rig.mode !== 'dying') {
      const rides = this.bossSet && rig.index < this.riding;
      if (!rides) rig.mode = 'hidden';
      else if (rig.mode === 'hidden') {
        rig.mode = 'reforming';
        rig.age = 0;
      }
    }
    if (rig.mode === 'hidden') {
      if (rig.root.visible || rig.link.mesh.visible || rig.beamInner.visible) this.hideOrb(rig);
      return;
    }
    rig.age += dt;
    const bob = still ? 0 : Math.sin(this.time * 1.7 + rig.index * 2.1) * PULSARS.orbHoverAmount;

    let scale: number = LOOK.dormantScale;
    let energy = dormantEnergy(this.energy);
    let coreShown = 1;
    let plateOff = 0;
    let fade = 1;
    const anchor = pulsarAnchor(rig.index, this.bossScale, this.anchor);
    const ride = bossLocalToWorld(
      this.bossX,
      this.bossY,
      this.bossZ,
      this.bossFacing,
      anchor.x,
      anchor.y + bob,
      anchor.z,
      this.at,
    );

    if (rig.mode === 'active') {
      // A cue that refreshed this frame already IS now: only a stale one is
      // carried forward, so the clock never double-steps.
      if (rig.fresh) rig.fresh = false;
      else rig.elapsed = Math.min(rig.total, rig.elapsed + dt);
      energy = activationEnergy(rig.elapsed, this.energy);
      const stationY = this.groundY(rig.stationX, rig.stationZ) + PULSARS.stationHeight;
      const t = this.bossSet ? energy.travel : 1;
      rig.x = ride.x + (rig.stationX - ride.x) * t;
      rig.y = ride.y + (stationY + bob * 0.6 - ride.y) * t;
      rig.z = ride.z + (rig.stationZ - ride.z) * t;
      scale = LOOK.dormantScale + (LOOK.activeScale - LOOK.dormantScale) * energy.travel;
      // Once it is a mob, the mob's own body IS the nucleus.
      coreShown = rig.elapsed >= PULSARS.activationCastSec ? 0 : 1;
      this.pollHealth(rig, dt);
    } else if (rig.mode === 'dying') {
      const death = orbDeath(rig.age, this.death);
      if (death.done) {
        rig.mode = 'hidden';
        this.hideOrb(rig);
        return;
      }
      scale = LOOK.activeScale;
      coreShown = death.coreScale;
      rig.nova.visible = death.nova > 0;
      if (rig.nova.visible) {
        rig.nova.position.set(rig.x, rig.y, rig.z);
        rig.nova.scale.setScalar(0.5 + LOOK.novaRadius * death.nova);
        rig.nova.material.opacity = 0.95 * (1 - death.nova) ** 1.4;
      }
      plateOff = death.scatter;
      fade = death.fade;
      energy.charge = 1;
      energy.spin = 5;
    } else {
      rig.x = ride.x;
      rig.y = ride.y;
      rig.z = ride.z;
      if (rig.mode === 'reforming') {
        const reform = orbReform(rig.age, this.reform);
        coreShown = reform.core;
        plateOff = reform.plates * 1.6;
        energy.charge = 0.5 * reform.gather;
        if (reform.done) rig.mode = 'dormant';
      }
    }

    const strain = orbStrain(rig.mode === 'active' ? rig.health : 1, this.strain);
    const gutter =
      strain.flickerHz === 0 || still
        ? 1
        : 1 - strain.flickerDepth * (0.5 + 0.5 * Math.sin(this.time * strain.flickerHz * 6.283));
    const jitter = still ? 0 : strain.shake;
    rig.root.visible = true;
    rig.root.position.set(
      rig.x + (jitter ? Math.sin(this.time * 67 + rig.index) * jitter : 0),
      rig.y + (jitter ? Math.sin(this.time * 59 + rig.index * 3) * jitter : 0),
      rig.z + (jitter ? Math.cos(this.time * 73 + rig.index) * jitter : 0),
    );
    rig.root.scale.setScalar(scale);

    // ---- the parts
    const turn = (still ? 0.25 : 1) * energy.spin * dt;
    rig.spin.rotation.y += turn * 0.5;
    rig.ringA.rotation.y += turn * 1.9;
    rig.ringB.rotation.x -= turn * 1.4;
    rig.runes.rotation.y -= turn * 0.8;
    rig.jets.rotation.z = 0.42;
    rig.jets.rotation.y += turn * 2.6;
    rig.jets.scale.set(1, 0.75 + 0.5 * energy.charge, 1);
    rig.core.visible = coreShown > 0.01;
    rig.jets.visible = rig.core.visible;
    if (rig.core.visible)
      rig.core.scale.setScalar(coreShown * (1 + 0.06 * Math.sin(this.time * 9)));
    const open = (energy.open - 1) * 0.6 + plateOff;
    for (let p = 0; p < rig.plates.length; p++) {
      const plate = rig.plates[p];
      plate.node.position.set(plate.outX * open, plate.outY * open, plate.outZ * open);
      plate.node.rotation.set(plateOff * plate.outZ * 1.7, 0, -plateOff * plate.outX * 1.7);
      plate.node.scale.setScalar(Math.max(0.001, fade));
    }
    rig.ringA.scale.setScalar(Math.max(0.001, fade));
    rig.ringB.scale.setScalar(Math.max(0.001, fade));
    rig.runes.scale.setScalar(Math.max(0.001, fade * (1 + plateOff * 0.4)));
    rig.emitter.visible = fade > 0.5;
    const lit = (0.45 + 0.55 * energy.charge) * gutter;
    rig.glowMaterial.color.setHex(LOOK.glow).multiplyScalar(0.55 + 0.9 * lit);
    rig.core.material.color.setHex(LOOK.core).multiplyScalar(0.7 + 0.5 * lit);
    rig.arcs.visible = !still && (energy.charge > 0.3 || strain.cracks > 0) && fade > 0.5;
    if (rig.arcs.visible) {
      rig.arcs.rotation.set(this.time * 3.1, this.time * 2.3, 0);
      rig.arcMaterial.opacity = (0.35 + 0.65 * Math.max(energy.charge, strain.cracks)) * gutter;
    }
    rig.halo.scale.setScalar(
      (2.2 +
        2.6 * energy.charge +
        3 * energy.pulse +
        (rig.mode === 'dying' ? 9 * this.death.flash : 0)) /
        scale,
    );
    rig.halo.material.uniforms.alpha.value =
      (0.22 +
        0.5 * energy.charge +
        0.5 * energy.pulse +
        (rig.mode === 'dying' ? this.death.flash : 0)) *
      gutter *
      (rig.mode === 'dying' ? 1 : fade);

    this.updateLink(rig, rig.mode === 'active' ? energy.link : 0);
    if (rig.mode === 'active' && rig.beamSeen) this.updateBeam(rig, dt);
    else if (rig.beamInner.visible || rig.lockLine.visible) this.hideBeam(rig);
  }

  /** The orb's mob, for its health: found near the station, read now and then. */
  private pollHealth(rig: OrbRig, dt: number): void {
    rig.healthPoll -= dt;
    if (rig.healthPoll > 0 || !this.world) return;
    rig.healthPoll = 0.2;
    let mob = rig.mobId === -1 ? undefined : this.world.entities.get(rig.mobId);
    if (!mob || mob.dead) {
      // One scan to find it (the mob standing on this station), then it is read by id.
      rig.mobId = -1;
      mob = undefined;
      for (const entity of this.world.entities.values()) {
        if (entity.templateId !== HOARD_PULSAR_TEMPLATE || entity.dead) continue;
        if ((entity.pos.x - rig.stationX) ** 2 + (entity.pos.z - rig.stationZ) ** 2 > 4) continue;
        rig.mobId = entity.id;
        mob = entity;
        break;
      }
      if (!mob) return;
    }
    const health = mob.hp / Math.max(1, mob.maxHp);
    if (health < rig.health - 1e-6) this.burst(rig.x, rig.y, rig.z, 5, 4);
    rig.health = health;
  }

  /** Energy flowing from the orb into the boss: THIS is why he cannot be hurt. */
  private updateLink(rig: OrbRig, amount: number): void {
    const shown = amount > 0.01 && this.bossSet;
    rig.link.mesh.visible = shown;
    if (!shown) return;
    const { position, alpha } = rig.link;
    const bx = this.bossX;
    const by = this.bossY + BOSS_CHEST * this.bossScale;
    const bz = this.bossZ;
    const dx = bx - rig.x;
    const dz = bz - rig.z;
    const length = Math.hypot(dx, dz) || 1;
    const px = -dz / length;
    const pz = dx / length;
    for (let s = 0; s <= LINK_SEGMENTS; s++) {
      const t = s / LINK_SEGMENTS;
      const sag = Math.sin(Math.PI * t);
      const wave = this.reducedMotion()
        ? 0
        : Math.sin(t * 9 - this.time * 7 + rig.index) * 0.18 * sag;
      const x = rig.x + dx * t + px * wave;
      const y = rig.y + (by - rig.y) * t + sag * 0.9;
      const z = rig.z + dz * t + pz * wave;
      const half = 0.1 + 0.12 * sag;
      position.setXYZ(s * 2, x, y - half, z);
      position.setXYZ(s * 2 + 1, x, y + half, z);
      // Light that RUNS toward him, so the eye reads the direction of the ward.
      const run = 0.55 + 0.45 * Math.sin(t * 14 - this.time * 11);
      alpha.setX(s * 2, amount * run * 0.9);
      alpha.setX(s * 2 + 1, amount * run * 0.9);
    }
    position.needsUpdate = true;
    alpha.needsUpdate = true;
  }

  private updateBeam(rig: OrbRig, dt: number): void {
    rig.beamAge += dt;
    const still = this.reducedMotion();
    // Offline the aim point moves every frame; online it arrives ten times a
    // second. Either way the drawn point glides after it, never jumps.
    if (!rig.aimSet) {
      rig.aimSet = true;
      rig.aimX = rig.cueAimX;
      rig.aimZ = rig.cueAimZ;
    } else {
      const k = Math.min(1, dt * 16);
      rig.aimX += (rig.cueAimX - rig.aimX) * k;
      rig.aimZ += (rig.cueAimZ - rig.aimZ) * k;
    }
    const floor = this.groundY(rig.aimX, rig.aimZ);
    const ax = rig.aimX;
    const ay = floor + 0.35;
    const az = rig.aimZ;
    const length = Math.hypot(ax - rig.x, ay - rig.y, az - rig.z);
    // The orb turns its lens on whoever it hunts.
    rig.emitter.rotation.y = Math.atan2(ax - rig.x, az - rig.z);

    if (!rig.beamFiring) {
      this.hideBeamFire(rig);
      // The targeting line: thin, harmless, and unmistakably pointed at someone.
      const pulse = 0.55 + 0.45 * Math.sin(rig.beamAge * 26);
      rig.lockLine.visible = true;
      rig.lockLine.position.set(rig.x, rig.y, rig.z);
      rig.lockLine.lookAt(ax, ay, az);
      rig.lockLine.scale.set(0.07, 0.07, length);
      rig.lockLine.material.opacity = 0.75 * pulse;
      rig.lockMark.visible = true;
      rig.lockMark.position.set(ax, floor + 0.1, az);
      const close = 1 - Math.min(1, rig.beamAge / PULSARS.targetWarningSec);
      rig.lockMark.scale.setScalar(PULSARS.beamWidth * (1 + 1.6 * close));
      rig.lockMark.material.opacity = 0.9;
      return;
    }
    rig.lockLine.visible = false;
    rig.lockMark.visible = false;
    const surge = Math.min(1, rig.beamAge / 0.18);
    const throb = still
      ? 1
      : 1 + 0.1 * Math.sin(rig.beamAge * 38) + 0.05 * Math.sin(rig.beamAge * 91);
    const width = PULSARS.beamWidth * surge;
    this.placeBeam(rig.beamOuter, rig, ax, ay, az, length, width * 1.55 * throb, 0.2 * surge);
    this.placeBeam(rig.beamInner, rig, ax, ay, az, length, width * throb, 0.6 * surge);
    this.placeBeam(rig.beamCore, rig, ax, ay, az, length, width * 0.42, 0.95 * surge);
    for (let p = 0; p < rig.pulses.length; p++) {
      const band = rig.pulses[p];
      const along = ((rig.beamAge * 1.6 + p / rig.pulses.length) % 1) * Math.max(0, length - 1.6);
      band.visible = !still && length > 3;
      if (!band.visible) continue;
      const k = along / length;
      band.position.set(
        rig.x + (ax - rig.x) * k,
        rig.y + (ay - rig.y) * k,
        rig.z + (az - rig.z) * k,
      );
      band.lookAt(ax, ay, az);
      band.scale.set(width * 1.25, width * 1.25, 1.4);
    }
    rig.impact.visible = true;
    rig.impact.position.set(ax, floor + 0.12, az);
    rig.impact.scale.setScalar(
      PULSARS.beamWidth * (1.15 + (still ? 0 : 0.2 * Math.sin(rig.beamAge * 30))),
    );
    rig.impact.material.opacity = 0.9 * surge;
    rig.impactGlow.visible = true;
    rig.impactGlow.position.set(ax, floor + 0.7, az);
    rig.impactGlow.scale.setScalar(4.6 * throb);
    rig.impactGlow.material.uniforms.alpha.value = 0.75 * surge;
    if (this.sparks && !still && this.random() < 0.7) {
      const a = this.random() * Math.PI * 2;
      const s = 3 + this.random() * 5;
      this.emit(
        ax,
        floor + 0.2,
        az,
        Math.sin(a) * s,
        3 + this.random() * 5,
        Math.cos(a) * s,
        0.2,
        0.45,
      );
    }
    this.updateTrail(rig, dt, floor);
  }

  private hideBeamFire(rig: OrbRig): void {
    rig.beamCore.visible = false;
    rig.beamInner.visible = false;
    rig.beamOuter.visible = false;
    rig.impact.visible = false;
    rig.impactGlow.visible = false;
    for (let p = 0; p < rig.pulses.length; p++) rig.pulses[p].visible = false;
    if (rig.trail) rig.trail.mesh.visible = false;
  }

  private placeBeam(
    mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>,
    rig: OrbRig,
    ax: number,
    ay: number,
    az: number,
    length: number,
    radius: number,
    opacity: number,
  ): void {
    mesh.visible = true;
    mesh.position.set(rig.x, rig.y, rig.z);
    mesh.lookAt(ax, ay, az);
    mesh.scale.set(radius, radius, length);
    mesh.material.opacity = opacity;
  }

  /** Residual light along where the beam has just been: a short, fading ribbon
   *  on the floor behind the aim point. Flourish only. */
  private updateTrail(rig: OrbRig, dt: number, floor: number): void {
    const trail = rig.trail;
    if (!trail) return;
    const samples = LOOK.trailSamples;
    rig.trailClock -= dt;
    if (rig.trailClock <= 0 || rig.trailLive === 0) {
      rig.trailClock = LOOK.trailEverySec;
      rig.trailHead = (rig.trailHead + 1) % samples;
      rig.trailX[rig.trailHead] = rig.aimX;
      rig.trailZ[rig.trailHead] = rig.aimZ;
      if (rig.trailLive < samples) rig.trailLive++;
    }
    trail.mesh.visible = rig.trailLive > 2;
    if (!trail.mesh.visible) return;
    const half = PULSARS.beamWidth * 0.55;
    for (let s = 0; s < samples; s++) {
      const age = Math.min(s, rig.trailLive - 1);
      const at = (rig.trailHead - age + samples * 2) % samples;
      const next = (rig.trailHead - Math.max(0, age - 1) + samples * 2) % samples;
      let dx = rig.trailX[next] - rig.trailX[at];
      let dz = rig.trailZ[next] - rig.trailZ[at];
      const d = Math.hypot(dx, dz);
      if (d < 1e-5) {
        dx = 1;
        dz = 0;
      } else {
        dx /= d;
        dz /= d;
      }
      const x = rig.trailX[at];
      const z = rig.trailZ[at];
      trail.position.setXYZ(s * 2, x - dz * half, floor + 0.09, z + dx * half);
      trail.position.setXYZ(s * 2 + 1, x + dz * half, floor + 0.09, z - dx * half);
      const fade = s >= rig.trailLive ? 0 : 0.5 * (1 - s / samples) ** 1.6;
      trail.alpha.setX(s * 2, fade);
      trail.alpha.setX(s * 2 + 1, fade);
    }
    trail.position.needsUpdate = true;
    trail.alpha.needsUpdate = true;
  }

  /** The ward on the boss: a ring at his feet and a shimmer, never a bubble that
   *  hides him. */
  private updateWard(dt: number): void {
    const on = this.warded && this.bossSet;
    // The last orb died: the ward does not just vanish, it BREAKS.
    if (this.wardFall >= 0) {
      this.wardFall += dt;
      if (this.wardFall >= LOOK.wardCollapseSec || !this.bossSet) this.wardFall = -1;
    }
    const falling = this.wardFall >= 0;
    this.ward.visible = on || falling;
    this.wardGlow.visible = on || falling;
    if (!on && !falling) return;
    const reach = 1.4 * this.bossScale;
    const pulse = this.reducedMotion() ? 1 : 1 + 0.06 * Math.sin(this.time * 5);
    this.ward.position.set(this.bossX, this.bossY + 0.12, this.bossZ);
    this.wardGlow.position.set(this.bossX, this.bossY + BOSS_CHEST * this.bossScale, this.bossZ);
    if (falling) {
      const t = this.wardFall / LOOK.wardCollapseSec;
      this.ward.scale.setScalar(reach * (1 + 3.2 * t));
      this.ward.material.opacity = 0.9 * (1 - t);
      this.wardGlow.scale.setScalar(reach * (3 + 5 * t));
      this.wardGlow.material.uniforms.alpha.value = 0.9 * (1 - t) ** 2;
      return;
    }
    this.ward.scale.setScalar(reach * pulse);
    this.ward.material.opacity = 0.7;
    this.wardGlow.scale.setScalar(reach * 2.6 * pulse);
    this.wardGlow.material.uniforms.alpha.value = 0.3;
  }

  private burst(x: number, y: number, z: number, count: number, speed: number): void {
    if (!this.sparks) return;
    for (let i = 0; i < count; i++) {
      const a = this.random() * Math.PI * 2;
      const up = this.random() * 2 - 1;
      const flat = Math.sqrt(Math.max(0, 1 - up * up));
      const s = speed * (0.4 + this.random() * 0.6);
      this.emit(
        x,
        y,
        z,
        Math.sin(a) * flat * s,
        up * s,
        Math.cos(a) * flat * s,
        0.18 + this.random() * 0.2,
        0.5 + this.random() * 0.5,
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
    const sparks = this.sparks;
    if (!sparks) return;
    const i = sparks.cursor;
    sparks.cursor = (i + 1) % SPARKS;
    sparks.position.setXYZ(i, x, y, z);
    sparks.velocity[i * 3] = vx;
    sparks.velocity[i * 3 + 1] = vy;
    sparks.velocity[i * 3 + 2] = vz;
    sparks.size.setX(i, size);
    sparks.life[i] = life;
    sparks.span[i] = life;
    sparks.live++;
    sparks.size.needsUpdate = true;
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
      sparks.velocity[i * 3 + 1] -= 7 * dt;
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
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.clear();
    this.materials.clear();
  }
}
