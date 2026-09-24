// Blender-authored parts, instanced six times. Timings and impact centers come
// from the authoritative cue, never from callbacks or client combat decisions.
import * as THREE from 'three';
import {
  ORBITAL_LIGHTNING as C,
  orbitalShotTime,
  orbitalTarget,
} from '../sim/rift/hoard_orbital_lightning_core';
import type { HoardBossCueView } from '../world_api/dungeons';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { attachSceneGroupGated } from './gated_scene_attach';
import { GFX, type GfxTier } from './gfx';
import {
  type OrbitalOrbPose,
  orbitalBoltPoints,
  orbitalOrbPose,
} from './hoard_orbital_lightning_core';
import { setRenderCategory } from './renderer_diagnostics';

export const ORBITAL_ASSET_URLS = [
  '/vfx/orbital-lightning/orb.glb',
  '/vfx/orbital-lightning/impact.glb',
] as const;
let sources: readonly THREE.Group[] | undefined;
let loading: Promise<readonly THREE.Group[] | undefined> | undefined;
function loadOrbitalSources(): Promise<readonly THREE.Group[] | undefined> {
  loading ??= Promise.all(ORBITAL_ASSET_URLS.map(async (url) => (await loadGltf(url)).scene))
    .then((loaded) => {
      sources = loaded;
      return loaded;
    })
    .catch(() => undefined);
  return loading;
}
if (typeof window !== 'undefined') registerDeferredPreload(loadOrbitalSources);

const ORB_PARTS = ['Core', 'OuterEnergy', 'LocalArcs', 'Sparks'] as const;
const IMPACT_PARTS = ['ImpactCore', 'GroundArcs', 'Crown', 'RadialBurst', 'Sparks'] as const;
const SEGMENTS = 96;
const CAST_SLOTS = 2;
type Part = THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
interface CastSlot {
  root: THREE.Group;
  orbs: Part[];
  impacts: Part[];
  beam: Part;
  halo: Part;
  ring: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  targets: Float32Array;
  orbPositions: Float32Array;
  posed: boolean;
  instanceId: number;
  cueId: number;
  remaining: number;
  elapsed: number;
  facing: number;
  seen: boolean;
}

/** Asset failure has a small procedural fallback; ground warnings remain independent on every tier. */
export class HoardOrbitalLightning {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly slots: CastSlot[] = [];
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private readonly pose: OrbitalOrbPose = {
    x: 0,
    y: 0,
    z: 0,
    scale: 0,
    brightness: 0,
    spin: 0,
    shotAge: 0,
    shotWave: 0,
    impactScale: 0,
    impactBrightness: 0,
  };
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private readonly direction = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly points = new Float32Array(13 * 3);
  private readonly low: boolean;
  private disposed = false;
  private segments = 0;

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    tier: GfxTier = GFX.tier,
    assets:
      | readonly THREE.Group[]
      | Promise<readonly THREE.Group[] | undefined>
      | undefined = sources,
  ) {
    this.low = tier === 'low';
    this.root.name = 'hoard-orbital-lightning';
    setRenderCategory(this.root, 'ui3d');
    const initial = assets instanceof Promise ? undefined : assets;
    const pending =
      assets instanceof Promise
        ? assets
        : !assets && typeof window !== 'undefined'
          ? loadOrbitalSources()
          : Promise.resolve(initial);
    const orbGeometry = ORB_PARTS.map((name, i) => this.partGeometry(initial?.[0], name, i, false));
    const impactGeometry = IMPACT_PARTS.map((name, i) =>
      this.partGeometry(initial?.[1], name, i, true),
    );
    const cylinder = this.own(new THREE.CylinderGeometry(1, 1, 1, 5, 1, true));
    const ringGeometry = this.own(
      new THREE.RingGeometry(C.orbitRadius - 0.025, C.orbitRadius + 0.025, 64),
    );
    ringGeometry.rotateX(-Math.PI / 2);
    for (let slotIndex = 0; slotIndex < CAST_SLOTS; slotIndex++) {
      const group = new THREE.Group();
      group.name = `OrbitalCast_${slotIndex}`;
      const orbs = orbGeometry.map((geometry, i) =>
        this.instances(
          group,
          geometry,
          C.orbCount,
          `Orb_${ORB_PARTS[i]}`,
          i === 0 ? 0xdefaff : 0x369eff,
          i === 1 ? 0.36 : 0.9,
        ),
      );
      const impacts = impactGeometry.map((geometry, i) =>
        this.instances(
          group,
          geometry,
          C.orbCount,
          `Impact_${IMPACT_PARTS[i]}`,
          i === 0 ? 0xeaffff : 0x5bbcff,
          i === 0 ? 0.95 : 0.75,
        ),
      );
      const beam = this.instances(group, cylinder, SEGMENTS, 'BeamCore', 0xe8fcff, 0.95);
      const halo = this.instances(group, cylinder, SEGMENTS, 'BeamHalo', 0x2988ff, 0.22);
      const ring = new THREE.Mesh(ringGeometry, this.material(0x388bff, 0.2));
      ring.position.y = 0.14;
      group.add(ring);
      this.root.add(group);
      this.slots.push({
        root: group,
        orbs,
        impacts,
        beam,
        halo,
        ring,
        targets: new Float32Array(C.orbCount * C.waveCount * 3),
        orbPositions: new Float32Array(C.orbCount * 3),
        posed: false,
        instanceId: -1,
        cueId: -1,
        remaining: -1,
        elapsed: 0,
        facing: 0,
        seen: false,
      });
    }
    // Compile while all variants and instanceColor attributes are present, then hide idle pools.
    this.readyForEntry = pending
      .catch(() => undefined)
      .then(async (loaded) => {
        if (this.disposed) return;
        if (loaded && loaded !== initial) {
          const orbs = ORB_PARTS.map((name, i) => this.partGeometry(loaded[0], name, i, false));
          const impacts = IMPACT_PARTS.map((name, i) =>
            this.partGeometry(loaded[1], name, i, true),
          );
          for (const slot of this.slots) {
            slot.orbs.forEach((mesh, i) => {
              mesh.geometry = orbs[i];
            });
            slot.impacts.forEach((mesh, i) => {
              mesh.geometry = impacts[i];
            });
          }
        }
        await attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed);
      })
      .then(() => {
        for (const slot of this.slots) slot.root.visible = slot.instanceId !== -1;
      })
      .catch(() => {});
    for (const slot of this.slots) slot.root.visible = false;
  }

  private own<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.add(geometry);
    return geometry;
  }

  private material(color: number, opacity: number): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial({
      color,
      opacity,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.materials.add(material);
    return material;
  }

  private partGeometry(
    source: THREE.Group | undefined,
    name: string,
    index: number,
    impact: boolean,
  ): THREE.BufferGeometry {
    const node = source?.getObjectByName(name);
    let mesh: THREE.Mesh | undefined;
    node?.traverse((child) => {
      if (!mesh && (child as THREE.Mesh).isMesh) mesh = child as THREE.Mesh;
    });
    if (mesh) {
      mesh.updateWorldMatrix(true, false);
      return this.own(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
    }
    if (index === 0) return this.own(new THREE.IcosahedronGeometry(impact ? 0.25 : 0.175, 1));
    const geometry = new THREE.TorusGeometry(
      impact ? 0.8 : 0.46,
      index === 1 ? 0.012 : 0.018,
      3,
      24,
      index > 1 ? Math.PI * 1.6 : Math.PI * 2,
    );
    geometry.rotateX(impact ? Math.PI / 2 : index * 0.75);
    if (impact) geometry.translate(0, 0.06, 0);
    return this.own(geometry);
  }

  private instances(
    root: THREE.Group,
    geometry: THREE.BufferGeometry,
    count: number,
    name: string,
    color: number,
    opacity: number,
  ): Part {
    const mesh = new THREE.InstancedMesh(geometry, this.material(color, opacity), count);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < count; i++) mesh.setColorAt(i, this.color.setRGB(1, 1, 1));
    mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
    mesh.renderOrder = 24;
    root.add(mesh);
    return mesh;
  }

  sync(cues: readonly HoardBossCueView[]): void {
    if (this.disposed) return;
    for (const slot of this.slots) slot.seen = false;
    for (const cue of cues) {
      if (cue.variant !== 'storm-orbital' || cue.remaining <= 0) continue;
      let slot = this.slots.find((s) => s.instanceId === cue.instanceId && s.cueId === cue.cueId);
      if (!slot) {
        slot = this.slots.find((s) => s.instanceId === -1);
        if (!slot) continue;
        slot.instanceId = cue.instanceId;
        slot.cueId = cue.cueId;
        slot.remaining = -1;
        slot.posed = false;
        slot.facing = cue.facing ?? 0;
        const baseY = this.groundY(cue.x, cue.z);
        slot.root.position.set(cue.x, baseY, cue.z);
        for (let wave = 0; wave < C.waveCount; wave++) {
          for (let i = 0; i < C.orbCount; i++) {
            const target = orbitalTarget(i, slot.facing, wave);
            const offset = (wave * C.orbCount + i) * 3;
            slot.targets[offset] = target.x;
            slot.targets[offset + 1] =
              this.groundY(cue.x + target.x, cue.z + target.z) - baseY + 0.08;
            slot.targets[offset + 2] = target.z;
          }
        }
      }
      slot.seen = true;
      slot.root.visible = true;
      if (slot.remaining !== cue.remaining) {
        slot.remaining = cue.remaining;
        slot.elapsed = Math.max(0, cue.total - cue.remaining);
      }
    }
    for (const slot of this.slots)
      if (!slot.seen) {
        slot.instanceId = -1;
        slot.root.visible = false;
      }
  }

  update(dt: number): void {
    if (this.disposed) return;
    const calm = this.reducedMotion();
    for (const slot of this.slots) {
      if (slot.instanceId === -1) continue;
      // Online views already interpolate their countdown. Never advance it twice.
      const elapsed = Math.min(C.totalDuration, Math.round(slot.elapsed * 1e9) / 1e9);
      this.segments = 0;
      for (let i = 0; i < C.orbCount; i++) {
        const p = orbitalOrbPose(elapsed, i, slot.facing, calm, this.pose);
        // Smooth position toward (never ahead of) the authoritative pose. This
        // removes offline 20 Hz stepping without advancing the online shot clock.
        const blend = slot.posed && dt > 0 ? 1 - Math.exp(-30 * dt) : 1;
        const offset = i * 3;
        p.x = slot.orbPositions[offset] += (p.x - slot.orbPositions[offset]) * blend;
        p.y = slot.orbPositions[offset + 1] += (p.y - slot.orbPositions[offset + 1]) * blend;
        p.z = slot.orbPositions[offset + 2] += (p.z - slot.orbPositions[offset + 2]) * blend;
        for (let part = 0; part < slot.orbs.length; part++) {
          const mesh = slot.orbs[part];
          this.dummy.position.set(p.x, p.y, p.z);
          this.dummy.rotation.set(part === 0 ? 0 : p.spin * 0.6, p.spin, part * 0.7);
          this.dummy.scale.setScalar((p.scale * C.orbSize) / 0.46);
          this.dummy.updateMatrix();
          mesh.setMatrixAt(i, this.dummy.matrix);
          mesh.setColorAt(i, this.color.setRGB(p.brightness, p.brightness, p.brightness));
          mesh.visible = !this.low || part !== 3;
        }
        for (let part = 0; part < slot.impacts.length; part++) {
          const mesh = slot.impacts[part];
          this.dummy.position.fromArray(slot.targets, (p.shotWave * C.orbCount + i) * 3);
          this.dummy.rotation.set(0, i * 1.7, 0);
          this.dummy.scale.setScalar(p.impactScale);
          this.dummy.updateMatrix();
          mesh.setMatrixAt(i, this.dummy.matrix);
          mesh.setColorAt(
            i,
            this.color.setRGB(p.impactBrightness, p.impactBrightness, p.impactBrightness),
          );
          mesh.visible = !this.low || part < 2;
        }
        if (p.shotAge >= 0 && p.shotAge < C.shotDuration) this.bolt(slot, i, elapsed, calm);
        // Short formation tethers, not a permanent web obscuring the boss.
        if (elapsed > i * 0.055 && elapsed < i * 0.055 + 0.13)
          this.segment(slot, 0, 1.7, 0, p.x, p.y, p.z, 0.013);
      }
      for (const mesh of slot.orbs) this.flush(mesh);
      slot.posed = true;
      for (const mesh of slot.impacts) this.flush(mesh);
      slot.beam.count = slot.halo.count = this.segments;
      this.flush(slot.beam);
      this.flush(slot.halo);
      slot.halo.visible = !this.low;
      slot.ring.material.opacity =
        0.12 *
        Math.min(1, elapsed / C.summonDuration) *
        Math.max(0, 1 - Math.max(0, elapsed - orbitalShotTime(0)) / 1.8);
    }
  }

  private flush(mesh: Part): void {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  private bolt(slot: CastSlot, index: number, elapsed: number, calm: boolean): void {
    const offset = (this.pose.shotWave * C.orbCount + index) * 3;
    orbitalBoltPoints(
      this.pose.x,
      this.pose.y,
      this.pose.z,
      slot.targets[offset],
      slot.targets[offset + 1],
      slot.targets[offset + 2],
      index + slot.cueId,
      Math.floor(elapsed * (calm ? 2 : 24)),
      this.points,
    );
    for (let i = 1; i < this.points.length / 3; i++) {
      const a = (i - 1) * 3,
        b = i * 3;
      this.segment(
        slot,
        this.points[a],
        this.points[a + 1],
        this.points[a + 2],
        this.points[b],
        this.points[b + 1],
        this.points[b + 2],
        0.026,
      );
      if (!this.low && i % 3 === 0)
        this.segment(
          slot,
          this.points[b],
          this.points[b + 1],
          this.points[b + 2],
          this.points[b] + Math.sin(i * 7) * 0.65,
          this.points[b + 1] - 0.35,
          this.points[b + 2] + Math.cos(i * 5) * 0.6,
          0.011,
        );
    }
  }

  private segment(
    slot: CastSlot,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    width: number,
  ): void {
    if (this.segments >= SEGMENTS) return;
    this.direction.set(bx - ax, by - ay, bz - az);
    const length = this.direction.length();
    this.dummy.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    this.dummy.quaternion.setFromUnitVectors(this.up, this.direction.normalize());
    this.dummy.scale.set(width, length, width);
    this.dummy.updateMatrix();
    slot.beam.setMatrixAt(this.segments, this.dummy.matrix);
    this.dummy.scale.set(width * 3.5, length, width * 3.5);
    this.dummy.updateMatrix();
    slot.halo.setMatrixAt(this.segments++, this.dummy.matrix);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    for (const slot of this.slots) {
      for (const mesh of slot.orbs) mesh.dispose();
      for (const mesh of slot.impacts) mesh.dispose();
      slot.beam.dispose();
      slot.halo.dispose();
    }
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}
