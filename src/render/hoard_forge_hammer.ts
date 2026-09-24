// Emberforge's Hammer of the Forge, drawn from the authoritative hoard cues.
// WHEN things happen, where the ring is and where its doors stand is the shared
// sim core (src/sim/rift/hoard_forge_hammer_core.ts) sampled at the cue's own
// life, so the fire on screen is the fire that burns and a drawn door is a safe
// door; how it LOOKS is hoard_forge_hammer_core.ts beside this file.
//
// What is Blender and what is runtime: the hammer is a Blender model
// (docs/design/forge-hammer/). Everything that depends on the moment is code:
// the molten marker and the fall, the blow, the hammer drawn back up, the ring
// of fire (a floor band and a standing wall, cut open at the doors), the door
// lanes, the embers and the scorch.
//
// Performance contract (the siblings' contract): every geometry and material is
// built once here and attached through the scene gate, so nothing compiles
// mid-fight; no dynamic lights; nothing is allocated per frame; the idle frame
// is a few branches. The low tier sheds the embers, the wall's flicker and the
// scorch. It NEVER sheds what a player acts on: the marker, the hammer, the ring
// and its doors draw on every tier.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../game/ui_effects_profile';
import { FORGE_HAMMER, forgeGapAngle } from '../sim/rift/hoard_forge_hammer_core';
import type { HoardBossCueView } from '../world_api/dungeons';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { attachSceneGroupGated } from './gated_scene_attach';
import { GFX, type GfxTier, surfaceMat } from './gfx';
import { HoardForgeGate } from './hoard_forge_gate';
import {
  FORGE_GATE_LOOK,
  type ForgeGateFrame,
  forgeGateFrame,
  forgeGateRadius,
  writeRingEdge,
} from './hoard_forge_gate_core';
import {
  type HammerPose,
  hammerPose,
  FORGE_HAMMER_LOOK as LOOK,
  writeRingMask,
} from './hoard_forge_hammer_core';
import { glowMaterial, ribbonMaterial, sparkMaterial, strip } from './hoard_fx_materials';
import { setRenderCategory } from './renderer_diagnostics';

export const FORGE_HAMMER_ASSET_URL = '/vfx/forge-hammer/hammer.glb';
let source: THREE.Group | undefined;
let loading: Promise<THREE.Group | undefined> | undefined;
function loadSource(): Promise<THREE.Group | undefined> {
  loading ??= loadGltf(FORGE_HAMMER_ASSET_URL)
    .then((gltf) => {
      source = gltf.scene;
      return source;
    })
    .catch(() => undefined);
  return loading;
}
if (typeof window !== 'undefined') registerDeferredPreload(loadSource);

/** Strikes alive at once: a strike outlives a few beats of two alternating
 *  hammers. Pinned against the sim's own clocks (tests/hoard_forge_hammer_render). */
export const FORGE_HAMMER_RIGS = 6;
const RIGS = FORGE_HAMMER_RIGS;
const EMBERS = 260;
const SEGMENTS = LOOK.ringSegments;
const DOOR_SEGMENTS = 6;

interface StrikeRig {
  instanceId: number;
  cueId: number;
  seen: boolean;
  fresh: boolean;
  shown: boolean;
  x: number;
  z: number;
  ground: number;
  total: number;
  remaining: number;
  elapsed: number;
  landed: boolean;
  maskFor: number;
  hammer: THREE.Group;
  molten: THREE.MeshBasicMaterial;
  marker: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  markerRing: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  scorch: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  flash: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  band: ReturnType<typeof strip> & { mesh: THREE.Mesh; material: THREE.ShaderMaterial };
  wall: ReturnType<typeof strip> & { mesh: THREE.Mesh; material: THREE.ShaderMaterial };
  doors: Array<ReturnType<typeof strip> & { mesh: THREE.Mesh; material: THREE.ShaderMaterial }>;
  mask: Float32Array;
  /** Per column, how near a door the fire burns: it climbs toward the post. */
  edge: Float32Array;
  pose: HammerPose;
}

export class HoardForgeHammerFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private readonly low: boolean;
  private disposed = false;
  private time = 0;
  private seed = 11;
  private readonly rigs: StrikeRig[] = [];
  /** Every door's posts and marked way through (hoard_forge_gate.ts). */
  private readonly gate: HoardForgeGate;
  private readonly gateFrame: ForgeGateFrame = {
    middle: 0,
    radialX: 0,
    radialZ: 1,
    postA: 0,
    postB: 0,
    edgeA: 0,
    edgeB: 0,
    halfWidth: 1,
  };
  /** The model baked once and shared by every rig (and the stand-in likewise). */
  private bakedFor: THREE.Group | undefined;
  private readonly baked: Array<{ geometry: THREE.BufferGeometry; material: string }> = [];
  private standIn: { head: THREE.BufferGeometry; haft: THREE.BufferGeometry } | undefined;
  private readonly embers?: {
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
    this.root.name = 'hoard-forge-hammer';
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
    const ring = this.own(new THREE.RingGeometry(0.88, 1, 64).rotateX(-Math.PI / 2));
    for (let i = 0; i < RIGS; i++) this.rigs.push(this.makeRig(initial, card, disc, ring));
    this.gate = new HoardForgeGate(this.root, RIGS, !this.low);

    if (!this.low) {
      const geometry = this.own(new THREE.BufferGeometry());
      const position = new THREE.BufferAttribute(new Float32Array(EMBERS * 3), 3);
      const size = new THREE.BufferAttribute(new Float32Array(EMBERS), 1);
      const alpha = new THREE.BufferAttribute(new Float32Array(EMBERS), 1);
      const tint = new THREE.BufferAttribute(new Float32Array(EMBERS * 3), 3);
      position.setUsage(THREE.DynamicDrawUsage);
      size.setUsage(THREE.DynamicDrawUsage);
      alpha.setUsage(THREE.DynamicDrawUsage);
      const color = new THREE.Color(LOOK.fire);
      for (let i = 0; i < EMBERS; i++) tint.setXYZ(i, color.r, color.g, color.b);
      geometry.setAttribute('position', position);
      geometry.setAttribute('size', size);
      geometry.setAttribute('alpha', alpha);
      geometry.setAttribute('tint', tint);
      const points = new THREE.Points(geometry, this.keep(sparkMaterial()));
      points.visible = false;
      points.frustumCulled = false;
      points.renderOrder = 30;
      this.root.add(points);
      this.embers = {
        points,
        position,
        size,
        alpha,
        velocity: new Float32Array(EMBERS * 3),
        life: new Float32Array(EMBERS),
        span: new Float32Array(EMBERS),
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
          for (let i = 0; i < this.rigs.length; i++) this.buildHammer(this.rigs[i], loaded);
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

  private ribbon(
    segments: number,
    color: number,
    name: string,
    order: number,
  ): ReturnType<typeof strip> & { mesh: THREE.Mesh; material: THREE.ShaderMaterial } {
    const made = strip(segments);
    this.own(made.geometry);
    const material = this.keep(ribbonMaterial(color));
    const mesh = new THREE.Mesh(made.geometry, material);
    mesh.name = name;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    this.root.add(mesh);
    return { ...made, mesh, material };
  }

  private makeRig(
    asset: THREE.Group | undefined,
    card: THREE.BufferGeometry,
    disc: THREE.BufferGeometry,
    ring: THREE.BufferGeometry,
  ): StrikeRig {
    const doors: StrikeRig['doors'] = [];
    for (let gap = 0; gap < FORGE_HAMMER.gaps; gap++) {
      doors.push(this.ribbon(DOOR_SEGMENTS, LOOK.door, 'ForgeDoor', 19));
    }
    const rig: StrikeRig = {
      instanceId: -1,
      cueId: -1,
      seen: false,
      fresh: false,
      shown: false,
      x: 0,
      z: 0,
      ground: 0,
      total: 0,
      remaining: -1,
      elapsed: 0,
      landed: false,
      maskFor: -1,
      hammer: new THREE.Group(),
      molten: this.keep(new THREE.MeshBasicMaterial({ color: LOOK.molten, toneMapped: false })),
      marker: new THREE.Mesh(disc, this.keep(this.basic(LOOK.molten, 0, true))),
      markerRing: new THREE.Mesh(ring, this.keep(this.basic(LOOK.fireHot, 0, true))),
      scorch: new THREE.Mesh(disc, this.keep(this.basic(LOOK.scorch, 0, false))),
      flash: new THREE.Mesh(card, this.keep(glowMaterial(LOOK.fire, false))),
      band: this.ribbon(SEGMENTS, LOOK.fire, 'ForgeRing', 21),
      wall: this.ribbon(SEGMENTS, LOOK.fireHot, 'ForgeWall', 22),
      doors,
      mask: new Float32Array(SEGMENTS + 1),
      edge: new Float32Array(SEGMENTS + 1),
      pose: {
        shadow: 0,
        shadowScale: 1,
        visible: false,
        drop: 0,
        impact: 0,
        heat: 0,
        ringRadius: 0,
        ring: 0,
        doors: 0,
        scorch: 0,
      },
    };
    rig.hammer.name = 'ForgeHammer';
    rig.marker.name = 'ForgeMarker';
    rig.hammer.visible = false;
    this.root.add(rig.hammer);
    const floor = [rig.scorch, rig.marker, rig.markerRing, rig.flash];
    for (let i = 0; i < floor.length; i++) {
      floor[i].visible = false;
      floor[i].frustumCulled = false;
      floor[i].renderOrder = 16 + i;
      this.root.add(floor[i]);
    }
    rig.flash.renderOrder = 27;
    this.buildHammer(rig, asset);
    return rig;
  }

  /** The hammer: the Blender model in the game's own surface material for its
   *  iron and leather, on a material of ours wherever it is molten. A plain
   *  stand-in of the same footprint serves until (or unless) the asset arrives. */
  private buildHammer(rig: StrikeRig, asset: THREE.Group | undefined): void {
    rig.hammer.clear();
    const iron = surfaceMat({
      color: LOOK.iron,
      roughness: 0.5,
      metalness: 0.85,
      flatShading: true,
    });
    const worn = surfaceMat({
      color: LOOK.ironWorn,
      roughness: 0.6,
      metalness: 0.7,
      emissive: LOOK.molten,
      emissiveIntensity: 0.12,
      flatShading: true,
    });
    const leather = surfaceMat({ color: LOOK.leather, roughness: 0.9, flatShading: true });
    const pick = (name: string): THREE.Material =>
      name === 'Molten'
        ? rig.molten
        : name === 'ForgeIronWorn'
          ? worn
          : name === 'Leather'
            ? leather
            : iron;
    const holder = asset?.getObjectByName('ForgeHammer_ROOT');
    if (!holder) {
      // Owned like everything else and freed once at dispose: when the late asset
      // replaces it the stand-in is only detached, never separately released.
      // Built ONCE and shared by every rig.
      this.standIn ??= {
        head: this.own(new THREE.BoxGeometry(5, 3.4, 3.2).translate(0, 1.7, 0)),
        haft: this.own(new THREE.CylinderGeometry(0.4, 0.4, 8, 8).translate(0, 7.4, 0)),
      };
      rig.hammer.add(
        new THREE.Mesh(this.standIn.head, iron),
        new THREE.Mesh(this.standIn.haft, worn),
      );
      return;
    }
    // The model is baked ONCE, whichever rig asks first: every rig draws the same
    // geometry (position and index only: every lit material here is flatShading,
    // which derives its normals in the shader), so the late asset costs one bake
    // and one upload, not one per rig.
    if (this.bakedFor !== asset) {
      this.bakedFor = asset;
      this.baked.length = 0;
      holder.updateWorldMatrix(true, true);
      const inverse = new THREE.Matrix4().copy(holder.matrixWorld).invert();
      const local = new THREE.Matrix4();
      const v = new THREE.Vector3();
      holder.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        // The shipped GLB is quantized: positions are normalized integers the NODE
        // transform scales back up. Bake through fromBufferAttribute, into floats.
        local.multiplyMatrices(inverse, mesh.matrixWorld);
        const from = mesh.geometry.getAttribute('position');
        const positions = new Float32Array(from.count * 3);
        for (let n = 0; n < from.count; n++) {
          v.fromBufferAttribute(from, n).applyMatrix4(local);
          positions[n * 3] = v.x;
          positions[n * 3 + 1] = v.y;
          positions[n * 3 + 2] = v.z;
        }
        const geometry = this.own(new THREE.BufferGeometry());
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const index = mesh.geometry.getIndex();
        if (index) geometry.setIndex(Array.from(index.array));
        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        this.baked.push({ geometry, material: material.name });
      });
    }
    for (let n = 0; n < this.baked.length; n++) {
      const part = this.baked[n];
      const made = new THREE.Mesh(part.geometry, pick(part.material));
      made.castShadow = part.material !== 'Molten';
      rig.hammer.add(made);
    }
  }

  sync(cues: readonly HoardBossCueView[]): void {
    if (this.disposed) return;
    for (let i = 0; i < this.rigs.length; i++) this.rigs[i].seen = false;
    for (let c = 0; c < cues.length; c++) {
      const cue = cues[c];
      if (cue.remaining <= 0 || cue.variant !== 'ember-hammer-strike') continue;
      let rig: StrikeRig | undefined;
      let free: StrikeRig | undefined;
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
        // A rig is reused across strikes, casts and whole runs: start it clean.
        rig.cueId = cue.cueId;
        rig.instanceId = cue.instanceId;
        rig.remaining = -1;
        rig.landed = false;
        rig.maskFor = -1;
        rig.ground = this.groundY(cue.x, cue.z);
        // The second of two alternating hammers burns a little whiter.
        rig.molten.color.setHex((cue.innerRadius ?? 0) >= 1 ? LOOK.fireHot : LOOK.molten);
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
    for (let i = 0; i < this.rigs.length; i++) if (!this.rigs[i].seen) this.rigs[i].cueId = -1;
  }

  update(dt: number): void {
    if (this.disposed) return;
    this.time += dt;
    for (let i = 0; i < this.rigs.length; i++) this.updateRig(this.rigs[i], i, dt);
    this.gate.commit();
    this.updateEmbers(dt);
  }

  private hideRig(rig: StrikeRig): void {
    if (!rig.shown) return;
    rig.shown = false;
    rig.hammer.visible = false;
    rig.marker.visible = false;
    rig.markerRing.visible = false;
    rig.scorch.visible = false;
    rig.flash.visible = false;
    rig.band.mesh.visible = false;
    rig.wall.mesh.visible = false;
    for (let d = 0; d < rig.doors.length; d++) rig.doors[d].mesh.visible = false;
  }

  private updateRig(rig: StrikeRig, slot: number, dt: number): void {
    if (!rig.seen || rig.cueId === -1) {
      this.hideRig(rig);
      this.gate.hide(slot);
      return;
    }
    rig.shown = true;
    // A cue that refreshed this frame already IS now: only a stale one is
    // carried forward, so the clock never double-steps.
    if (rig.fresh) rig.fresh = false;
    else rig.elapsed = Math.min(rig.total, rig.elapsed + dt);
    const pose = hammerPose(rig.elapsed, rig.pose);
    const still = this.reducedMotion();
    const ground = rig.ground;

    // ---- the molten marker: where it will land
    const warned = pose.shadow > 0;
    rig.marker.visible = warned;
    rig.markerRing.visible = warned;
    if (warned) {
      const pulse = still ? 1 : 1 + 0.06 * Math.sin(this.time * 17);
      rig.marker.position.set(rig.x, ground + 0.06, rig.z);
      rig.marker.scale.setScalar(FORGE_HAMMER.impactRadius * pose.shadowScale * pulse);
      rig.marker.material.opacity = 0.55 * pose.shadow;
      rig.markerRing.position.set(rig.x, ground + 0.09, rig.z);
      rig.markerRing.scale.setScalar(FORGE_HAMMER.impactRadius);
      rig.markerRing.material.opacity = 0.4 + 0.6 * pose.shadow;
      if (this.embers && !still && this.random() < 0.5 * pose.shadow) {
        const a = this.random() * Math.PI * 2;
        const r = this.random() * FORGE_HAMMER.impactRadius;
        this.emit(
          rig.x + Math.sin(a) * r,
          ground + 0.2,
          rig.z + Math.cos(a) * r,
          0,
          3.5,
          0,
          0.16,
          0.8,
        );
      }
    }

    // ---- the hammer
    rig.hammer.visible = pose.visible;
    if (pose.visible) {
      const jolt = still ? 0 : pose.impact * pose.impact * 0.22 * Math.sin(pose.impact * 26);
      rig.hammer.position.set(rig.x, ground + pose.drop + jolt, rig.z);
    }
    if (!rig.landed && pose.visible && pose.drop === 0 && pose.impact > 0) {
      rig.landed = true;
      if (pose.impact > 0.5) {
        this.burst(rig.x, ground + 0.5, rig.z, 70, 14, 11);
        if (!still && !this.low) this.shake?.(0.16);
      }
    }
    const flashing = pose.impact > 0.02;
    rig.flash.visible = flashing;
    if (flashing) {
      rig.flash.position.set(rig.x, ground + 2.2, rig.z);
      rig.flash.scale.setScalar(9 + 16 * (1 - pose.impact));
      rig.flash.material.uniforms.alpha.value = 0.9 * pose.impact * pose.impact;
    }
    const scorched = pose.scorch > 0.01 && !this.low;
    rig.scorch.visible = scorched;
    if (scorched) {
      rig.scorch.position.set(rig.x, ground + 0.04, rig.z);
      rig.scorch.scale.setScalar(FORGE_HAMMER.impactRadius * 1.15);
      rig.scorch.material.opacity = 0.55 * pose.scorch;
    }

    // ---- the ring and its doors
    if (rig.maskFor !== rig.cueId) {
      rig.maskFor = rig.cueId;
      writeRingMask(rig.cueId, rig.mask);
      writeRingEdge(rig.mask, rig.edge);
    }
    const burning = pose.ring > 0.01 && pose.ringRadius > FORGE_HAMMER.ringSafeRadius * 0.6;
    rig.band.mesh.visible = burning;
    rig.wall.mesh.visible = burning;
    if (burning) this.writeRing(rig, pose, still);
    const doorsShown = pose.doors > 0.01;
    if (doorsShown) this.writeDoors(rig, pose.ringRadius);
    for (let d = 0; d < rig.doors.length; d++) {
      rig.doors[d].mesh.visible = doorsShown;
      if (doorsShown) rig.doors[d].material.uniforms.gain.value = 0.45 * pose.doors;
    }
    this.gate.write(
      slot,
      rig.cueId,
      rig.x,
      rig.z,
      ground,
      pose.ringRadius,
      pose.doors,
      still ? 0 : this.time,
    );
    // Sparks off a post's hot head: richness only, the posts themselves are solid.
    if (this.embers && doorsShown && !still && this.random() < 0.3) {
      const radius = forgeGateRadius(pose.ringRadius);
      const gap = Math.floor(this.random() * FORGE_HAMMER.gaps);
      const frame = forgeGateFrame(rig.cueId, gap, radius, this.gateFrame);
      const bearing = this.random() < 0.5 ? frame.postA : frame.postB;
      this.emit(
        rig.x + Math.sin(bearing) * radius,
        ground + 2.3 * FORGE_GATE_LOOK.postScale,
        rig.z + Math.cos(bearing) * radius,
        (this.random() - 0.5) * 1.5,
        2 + this.random() * 3,
        (this.random() - 0.5) * 1.5,
        0.14,
        0.6,
      );
    }
  }

  /** The burning band on the floor and the wall standing over it, cut open at the
   *  doors. Written each frame: the ring is a moving thing, never a scaled disc,
   *  so its width stays the width the sim burns at. */
  private writeRing(rig: StrikeRig, pose: HammerPose, still: boolean): void {
    const half = FORGE_HAMMER.ringThickness / 2;
    const inner = Math.max(0, pose.ringRadius - half);
    const outer = pose.ringRadius + half;
    const y = rig.ground + 0.1;
    const band = rig.band;
    const wall = rig.wall;
    for (let column = 0; column <= SEGMENTS; column++) {
      const bearing = (column / SEGMENTS) * Math.PI * 2;
      const sx = Math.sin(bearing);
      const sz = Math.cos(bearing);
      const lit = rig.mask[column] * pose.ring;
      band.position.setXYZ(column * 2, rig.x + sx * inner, y, rig.z + sz * inner);
      band.position.setXYZ(column * 2 + 1, rig.x + sx * outer, y, rig.z + sz * outer);
      band.alpha.setX(column * 2, lit * 0.95);
      band.alpha.setX(column * 2 + 1, lit * 0.55);
      const lick = still || this.low ? 1 : 0.75 + 0.35 * Math.sin(this.time * 13 + column * 1.7);
      // Beside a door the fire climbs toward the post that ends it.
      const climb = 1 + FORGE_GATE_LOOK.edgeLift * rig.edge[column];
      const top = y + LOOK.wallHeight * lick * climb;
      const wx = rig.x + sx * pose.ringRadius;
      const wz = rig.z + sz * pose.ringRadius;
      wall.position.setXYZ(column * 2, wx, y, wz);
      wall.position.setXYZ(column * 2 + 1, wx, top, wz);
      wall.alpha.setX(column * 2, lit * 0.8);
      wall.alpha.setX(column * 2 + 1, 0);
    }
    band.position.needsUpdate = true;
    band.alpha.needsUpdate = true;
    wall.position.needsUpdate = true;
    wall.alpha.needsUpdate = true;
    if (this.embers && !still && this.random() < 0.8) {
      const column = Math.floor(this.random() * SEGMENTS);
      if (rig.mask[column] > 0) {
        const bearing = (column / SEGMENTS) * Math.PI * 2;
        this.emit(
          rig.x + Math.sin(bearing) * pose.ringRadius,
          y + 0.3,
          rig.z + Math.cos(bearing) * pose.ringRadius,
          Math.sin(bearing) * 2,
          3 + this.random() * 4,
          Math.cos(bearing) * 2,
          0.18,
          0.7,
        );
      }
    }
  }

  /** The doors: a short warm gate in each gap that TRAVELS WITH THE RING, fading
   *  out ahead of it, so the way through is marked where it matters and the rest
   *  of the floor stays clean. Through the marker it sits at the blow's edge: where
   *  to head is known before the fire exists. Written every frame it shows. */
  private writeDoors(rig: StrikeRig, ringRadius: number): void {
    const y = rig.ground + 0.07;
    const from = Math.max(FORGE_HAMMER.ringSafeRadius, ringRadius - 0.6);
    const to = Math.min(FORGE_HAMMER.ringMaxRadius, from + LOOK.doorReach);
    for (let d = 0; d < rig.doors.length; d++) {
      const door = rig.doors[d];
      const middle = forgeGapAngle(rig.cueId, d);
      const a = middle - FORGE_HAMMER.gapHalfAngle;
      const b = middle + FORGE_HAMMER.gapHalfAngle;
      for (let row = 0; row <= DOOR_SEGMENTS; row++) {
        const t = row / DOOR_SEGMENTS;
        const r = from + (to - from) * t;
        door.position.setXYZ(row * 2, rig.x + Math.sin(a) * r, y, rig.z + Math.cos(a) * r);
        door.position.setXYZ(row * 2 + 1, rig.x + Math.sin(b) * r, y, rig.z + Math.cos(b) * r);
        const fade = (1 - t) * (1 - t);
        door.alpha.setX(row * 2, fade);
        door.alpha.setX(row * 2 + 1, fade);
      }
      door.position.needsUpdate = true;
      door.alpha.needsUpdate = true;
    }
  }

  private burst(x: number, y: number, z: number, count: number, speed: number, lift: number): void {
    if (!this.embers) return;
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
        0.2 + this.random() * 0.25,
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
    const embers = this.embers;
    if (!embers) return;
    const i = embers.cursor;
    embers.cursor = (i + 1) % EMBERS;
    embers.position.setXYZ(i, x, y, z);
    embers.velocity[i * 3] = vx;
    embers.velocity[i * 3 + 1] = vy;
    embers.velocity[i * 3 + 2] = vz;
    embers.size.setX(i, size);
    embers.life[i] = life;
    embers.span[i] = life;
    embers.live++;
    embers.size.needsUpdate = true;
  }

  private updateEmbers(dt: number): void {
    const embers = this.embers;
    if (!embers || embers.live === 0) return;
    let alive = 0;
    for (let i = 0; i < EMBERS; i++) {
      if (embers.life[i] <= 0) continue;
      embers.life[i] -= dt;
      if (embers.life[i] <= 0) {
        embers.alpha.setX(i, 0);
        continue;
      }
      alive++;
      embers.velocity[i * 3 + 1] -= 9 * dt;
      embers.position.setXYZ(
        i,
        embers.position.getX(i) + embers.velocity[i * 3] * dt,
        embers.position.getY(i) + embers.velocity[i * 3 + 1] * dt,
        embers.position.getZ(i) + embers.velocity[i * 3 + 2] * dt,
      );
      embers.alpha.setX(i, Math.min(1, (embers.life[i] / embers.span[i]) * 1.6));
    }
    embers.live = alive;
    embers.points.visible = alive > 0;
    embers.position.needsUpdate = true;
    embers.alpha.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.gate.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.clear();
    this.materials.clear();
  }
}
