import * as THREE from "three";
import type { ActiveTemporalHourglass } from "../world_api";
import { surfaceMat } from "./gfx";
import { cloneMaterialWithHooks } from "./material_clone_hooks";
import { HourglassFieldVisual } from "./hourglass_field_visual";
import { hourglassSandFraction } from "./hourglass_field_core";

export type TemporalHourglassMode = "hostile" | "protective" | "unknown";

const BASE_GEOMETRY = new THREE.CylinderGeometry(0.34, 0.38, 0.08, 12);
const PILLAR_GEOMETRY = new THREE.CylinderGeometry(0.025, 0.025, 0.66, 6);
const GLASS_GEOMETRY = new THREE.ConeGeometry(0.22, 0.34, 12, 1, true);
const SAND_GEOMETRY = new THREE.ConeGeometry(0.17, 0.2, 10);
const RING_GEOMETRY = new THREE.TorusGeometry(0.43, 0.018, 6, 24);
const STREAM_GEOMETRY = new THREE.CylinderGeometry(0.009, 0.009, 0.21, 6);

function buildClockTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - size / 2;
      const dy = y - size / 2;
      const radius = Math.sqrt(dx * dx + dy * dy);
      const ring = Math.abs(radius - 25) <= 2;
      const longHand = Math.abs(dx) <= 1.5 && dy >= -18 && dy <= 1;
      const shortHand = Math.abs(dy) <= 1.5 && dx >= 0 && dx <= 15;
      if (!ring && !longHand && !shortHand) continue;
      const offset = (y * size + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = ring ? 220 : 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

const CLOCK_TEXTURE = buildClockTexture();

export interface TemporalHourglassMaterials {
  gold: THREE.Material;
  glass: THREE.Material;
  protectiveEnergy: THREE.Material;
  hostileEnergy: THREE.Material;
  unknownEnergy: THREE.Material;
}

let profileMaterials: TemporalHourglassMaterials | null = null;

export function temporalHourglassMaterials(): TemporalHourglassMaterials {
  if (profileMaterials) return profileMaterials;
  const glass = cloneMaterialWithHooks(
    surfaceMat({
      color: 0x9befff,
      emissive: 0x1757a0,
      emissiveIntensity: 0.38,
      roughness: 0.08,
      side: THREE.DoubleSide,
    }),
  );
  glass.transparent = true;
  glass.opacity = 0.28;
  glass.depthWrite = false;
  profileMaterials = {
    gold: surfaceMat({
      color: 0xd8a83e,
      emissive: 0x6b3f08,
      emissiveIntensity: 0.35,
      roughness: 0.3,
      metalness: 0.72,
    }),
    glass,
    protectiveEnergy: surfaceMat({
      color: 0x8ff7ff,
      emissive: 0x20b5ff,
      emissiveIntensity: 1.2,
      roughness: 0.22,
    }),
    hostileEnergy: surfaceMat({
      color: 0xff7d9b,
      emissive: 0xb3206b,
      emissiveIntensity: 1.2,
      roughness: 0.22,
    }),
    unknownEnergy: surfaceMat({
      color: 0xd4bc83,
      emissive: 0x6b5021,
      emissiveIntensity: 0.8,
      roughness: 0.3,
    }),
  };
  return profileMaterials;
}

export function resetTemporalHourglassProfileCaches(): void {
  profileMaterials = null;
}

/** Small physical hourglass placed at the controlled character's feet. */
export class TemporalHourglassVisual {
  readonly group = new THREE.Group();
  private readonly materials = temporalHourglassMaterials();
  private readonly energy: THREE.Group;
  private readonly overheadClock: THREE.Sprite;
  private mode: TemporalHourglassMode | null = null;
  private time = 0;
  private disposed = false;
  private readonly upperSand: THREE.Mesh;
  private readonly lowerSand: THREE.Mesh;

  constructor(showOverhead = true) {
    this.group.name = "temporal-hourglass-visual";
    this.group.visible = false;

    for (const [name, y] of [
      ["bottom", 0.06],
      ["top", 0.76],
    ] as const) {
      const base = new THREE.Mesh(BASE_GEOMETRY, this.materials.gold);
      base.name = `temporal-hourglass-${name}`;
      base.position.y = y;
      this.group.add(base);
    }

    for (let index = 0; index < 3; index++) {
      const angle = (index / 3) * Math.PI * 2;
      const pillar = new THREE.Mesh(PILLAR_GEOMETRY, this.materials.gold);
      pillar.name = `temporal-hourglass-pillar-${index}`;
      pillar.position.set(Math.cos(angle) * 0.28, 0.41, Math.sin(angle) * 0.28);
      this.group.add(pillar);
    }

    const upperGlass = new THREE.Mesh(GLASS_GEOMETRY, this.materials.glass);
    upperGlass.name = "temporal-hourglass-upper-glass";
    upperGlass.position.y = 0.57;
    upperGlass.rotation.z = Math.PI;
    this.group.add(upperGlass);
    const lowerGlass = new THREE.Mesh(GLASS_GEOMETRY, this.materials.glass);
    lowerGlass.name = "temporal-hourglass-lower-glass";
    lowerGlass.position.y = 0.25;
    lowerGlass.rotation.z = 0;
    this.group.add(lowerGlass);

    this.energy = new THREE.Group();
    this.energy.name = "temporal-hourglass-energy";
    const upperSand = new THREE.Mesh(
      SAND_GEOMETRY,
      this.materials.protectiveEnergy,
    );
    this.upperSand = upperSand;
    upperSand.name = "temporal-hourglass-upper-sand";
    upperSand.position.y = 0.57;
    upperSand.rotation.z = Math.PI;
    const lowerSand = new THREE.Mesh(
      SAND_GEOMETRY,
      this.materials.protectiveEnergy,
    );
    this.lowerSand = lowerSand;
    lowerSand.name = "temporal-hourglass-lower-sand";
    lowerSand.position.y = 0.19;
    lowerSand.rotation.z = 0;
    const ring = new THREE.Mesh(RING_GEOMETRY, this.materials.protectiveEnergy);
    ring.name = "temporal-hourglass-ring";
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.035;
    const stream = new THREE.Mesh(
      STREAM_GEOMETRY,
      this.materials.protectiveEnergy,
    );
    stream.name = "temporal-hourglass-sand-stream";
    stream.position.y = 0.39;
    this.energy.add(upperSand, lowerSand, ring, stream);
    this.group.add(this.energy);

    this.overheadClock = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: CLOCK_TEXTURE,
        color: 0x8ff7ff,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.overheadClock.name = "temporal-hourglass-overhead-clock";
    this.overheadClock.visible = showOverhead;
    this.overheadClock.scale.set(0.9, 0.9, 1);
    if (showOverhead) this.group.add(this.overheadClock);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mode = null;
    this.group.visible = false;
    this.group.removeFromParent();
    this.overheadClock.material.dispose();
  }

  update(
    mode: TemporalHourglassMode | null,
    dt: number,
    height = 1.8,
    remainingFraction = 1,
  ): void {
    if (this.disposed) return;
    this.mode = mode;
    this.group.visible = mode !== null;
    if (!mode) return;
    const material =
      mode === "protective"
        ? this.materials.protectiveEnergy
        : mode === "hostile"
          ? this.materials.hostileEnergy
          : this.materials.unknownEnergy;
    for (const child of this.energy.children)
      (child as THREE.Mesh).material = material;
    this.overheadClock.material.color.setHex(
      mode === "protective"
        ? 0x8ff7ff
        : mode === "hostile"
          ? 0xff7d9b
          : 0xd4bc83,
    );
    this.overheadClock.position.y = height + 0.65;
    this.time += Math.max(0, dt);
    this.group.rotation.y = this.time * (mode === "protective" ? 0.55 : -0.8);
    this.overheadClock.material.rotation =
      this.time * (mode === "protective" ? -2.2 : 3.4);
    const pulse = 1 + Math.sin(this.time * 5) * 0.045;
    // Pulse the overhead cue, never push sand through its glass container.
    this.overheadClock.scale.setScalar(0.9 * pulse);
    const sand = hourglassSandFraction(remainingFraction);
    this.upperSand.scale.setScalar(Math.cbrt(sand));
    this.upperSand.scale.x *= 0.72;
    this.upperSand.scale.z *= 0.72;
    this.lowerSand.scale.setScalar(Math.cbrt(hourglassSandFraction(1 - sand)));
    this.upperSand.position.y = 0.4 + 0.1 * this.upperSand.scale.y;
    this.lowerSand.position.y = 0.11 + 0.1 * this.lowerSand.scale.y;
  }

  currentMode(): TemporalHourglassMode | null {
    return this.mode;
  }
}

export function syncTemporalHourglassVisual(
  visual: TemporalHourglassVisual | null,
  parent: THREE.Group,
  mode: TemporalHourglassMode | null,
  dt: number,
  height = 1.8,
): TemporalHourglassVisual | null {
  let current = visual;
  if (mode && !current) {
    current = new TemporalHourglassVisual();
    parent.add(current.group);
  }
  current?.update(mode, dt, height);
  return current;
}

interface GroundHourglassVisual {
  visual: TemporalHourglassVisual;
  field: HourglassFieldVisual;
  mode: TemporalHourglassMode;
  duration: number;
  elapsed: number;
  lastRemaining: number;
}

export class TemporalHourglassGroundVisuals {
  private readonly active = new Map<string, GroundHourglassVisual>();
  private readonly pool: GroundHourglassVisual[] = [];
  private readonly ids = new Set<string>();
  private disposed = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
  ) {}

  sync(states: readonly ActiveTemporalHourglass[]): void {
    if (this.disposed) return;
    this.ids.clear();
    for (const state of states) {
      if (state.remaining <= 0) continue;
      this.ids.add(state.id);
      let current = this.active.get(state.id);
      if (!current) {
        current = this.pool.pop() ?? {
          visual: new TemporalHourglassVisual(false),
          field: new HourglassFieldVisual(),
          mode: "unknown",
          duration: 0,
          elapsed: 0,
          lastRemaining: -1,
        };
        current.field.invalidate();
        this.scene.add(current.visual.group, current.field.group);
        this.active.set(state.id, current);
        current.lastRemaining = -1;
      }
      current.mode = state.disposition;
      if (current.lastRemaining !== state.remaining) {
        current.duration = state.duration;
        current.elapsed = Math.max(0, state.duration - state.remaining);
        current.lastRemaining = state.remaining;
      }
      current.visual.group.position.set(
        state.x,
        this.groundY(state.x, state.z) + 0.04,
        state.z,
      );
      current.visual.update(
        current.mode,
        0,
        1.8,
        state.remaining / state.duration,
      );
      current.field.update(
        state.x,
        state.z,
        state.radius,
        current.mode,
        this.groundY,
      );
    }
    for (const [id, current] of this.active) {
      if (this.ids.has(id)) continue;
      current.visual.group.removeFromParent();
      current.field.group.removeFromParent();
      current.visual.update(null, 0);
      this.active.delete(id);
      if (this.pool.length < 32) this.pool.push(current);
      else {
        current.visual.dispose();
        current.field.dispose();
      }
    }
  }

  update(dt: number): void {
    if (this.disposed) return;
    for (const current of this.active.values()) {
      current.elapsed += Math.max(0, dt);
      current.visual.update(
        current.mode,
        dt,
        1.8,
        (current.duration - current.elapsed) / current.duration,
      );
      // The capture edge stays full-sized until the authoritative row retires.
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.sync([]);
    this.disposed = true;
    for (const current of this.pool) {
      current.visual.dispose();
      current.field.dispose();
    }
    this.pool.length = 0;
  }
}
