import * as THREE from 'three';
import { OVERLAY_CELL } from './fx_textures';
import type { OverlaySprites } from './overlay_sprites';
import type { AbilityVfxRibbons } from './ribbons';

// A cast footprint, not a root/slow timer. Those cues follow the live auras below.
export const SHAMAN_GRIP_FOOTPRINT_LIFE = 0.7;

interface BoundEntity {
  readonly id: number;
  readonly dead?: boolean;
  readonly hp?: number;
  readonly auras: readonly { id: string; remaining?: number; kind?: string }[];
}
interface QuakeEvent {
  readonly ability?: string;
  readonly fx: string;
  readonly sourceId?: number;
  readonly x: number;
  readonly z: number;
  readonly radius?: number;
  readonly duration?: number;
}
interface FieldHost {
  anchorOf(id: number, fraction: number, out: THREE.Vector3): unknown;
  groundYAt(x: number, z: number): number;
}
interface Quake {
  active: boolean;
  source: number;
  x: number;
  z: number;
  radius: number;
  start: number;
  end: number;
  boundaryReady: boolean;
  transient: boolean;
  boundary: THREE.Vector3[][];
  mineral: THREE.Vector3[][];
  widths: number[];
  groundY: number;
}
interface Binding {
  id: number;
  frame: number;
  root: boolean;
  slow: boolean;
}

/** Terrain detail borrows prepared buffers; it allocates no geometry or timed
 * ribbon slots. Quakes require the producer's duration. Roots follow live auras,
 * including diminished durations and dispels, rather than a cast-time estimate.
 * Event-only quake visibility cannot reconstruct fields cast before joining. */
export class ShamanFields {
  private readonly quakes: Quake[] = Array.from({ length: 8 }, () => ({
    active: false,
    source: -1,
    x: 0,
    z: 0,
    radius: 0,
    start: 0,
    end: 0,
    boundaryReady: false,
    transient: false,
    boundary: Array.from({ length: 12 }, () =>
      Array.from({ length: 5 }, () => new THREE.Vector3()),
    ),
    mineral: Array.from({ length: 12 }, () => Array.from({ length: 3 }, () => new THREE.Vector3())),
    widths: Array.from({ length: 12 }, () => 0),
    groundY: 0,
  }));
  private readonly bindings: Binding[] = Array.from({ length: 24 }, () => ({
    id: -1,
    frame: -1,
    root: false,
    slow: false,
  }));
  private readonly points = Array.from({ length: 7 }, () => new THREE.Vector3());
  private readonly frontPoints = Array.from({ length: 7 }, () => new THREE.Vector3());
  private readonly origin = new THREE.Vector3();
  private disposed = false;

  /** worldTime is the host's presentation clock, advanced with displayed frames.
   * Tick/echo events cannot restart the lifetime. The caller clears on reset. */
  quake(ev: QuakeEvent, worldTime: number): boolean {
    if (this.disposed || ev.ability !== 'earthquake' || ev.fx !== 'nova') return false;
    return this.admit(ev, worldTime, ev.duration, false);
  }

  grip(ev: QuakeEvent, worldTime: number): boolean {
    if (this.disposed || ev.ability !== 'earthbind' || ev.fx !== 'nova') return false;
    return this.admit(ev, worldTime, SHAMAN_GRIP_FOOTPRINT_LIFE, true);
  }

  private admit(
    ev: QuakeEvent,
    worldTime: number,
    duration: number | undefined,
    transient: boolean,
  ): boolean {
    const radius = ev.radius;
    if (
      !Number.isFinite(worldTime) ||
      !Number.isFinite(ev.x) ||
      !Number.isFinite(ev.z) ||
      radius === undefined ||
      !Number.isFinite(radius) ||
      radius <= 0 ||
      duration === undefined ||
      !Number.isFinite(duration) ||
      duration <= 0
    )
      return false;
    let slot: Quake | undefined;
    for (const candidate of this.quakes) {
      if (!candidate.active || candidate.end <= worldTime) {
        slot = candidate;
        break;
      }
    }
    // Saturation drops secondary dressing, never claims extra gameplay space.
    if (!slot) return false;
    slot.active = true;
    slot.source = ev.sourceId ?? 0;
    slot.x = ev.x;
    slot.z = ev.z;
    slot.radius = radius;
    slot.start = worldTime;
    slot.end = worldTime + duration;
    slot.transient = transient;
    slot.boundaryReady = false;
    return true;
  }

  syncEntity(frame: number, entity: BoundEntity): void {
    if (this.disposed) return;
    let root = false,
      slow = false;
    if (!entity.dead && (entity.hp ?? 1) > 0)
      for (const aura of entity.auras) {
        if (!((aura.remaining ?? 0) > 0)) continue;
        if (aura.id === 'earthbind_root' && aura.kind === 'root') root = true;
        if (aura.id === 'earthbind_slow' && aura.kind === 'slow') slow = true;
      }
    let slot: Binding | undefined;
    let vacancy: Binding | undefined;
    for (const binding of this.bindings) {
      if (binding.id === entity.id) slot = binding;
      if (!vacancy && (binding.id < 0 || binding.frame < frame - 1)) vacancy = binding;
    }
    if (!root && !slow) {
      if (slot) slot.id = -1;
      return;
    }
    if (!slot) slot = vacancy;
    if (!slot) return;
    slot.id = entity.id;
    slot.frame = frame;
    slot.root = root;
    slot.slow = slow;
  }

  /** Call within AbilityVfxRibbons.update's held callback, before overlay commit. */
  draw(
    frame: number,
    worldTime: number,
    reducedMotion: boolean,
    quality: number,
    host: FieldHost,
    ribbons: Pick<AbilityVfxRibbons, 'appendHeld'>,
    overlay: Pick<OverlaySprites, 'push'>,
  ): void {
    if (this.disposed) return;
    for (const field of this.quakes) {
      if (!field.active) continue;
      if (worldTime >= field.end || worldTime < field.start) {
        field.active = false;
        continue;
      }
      const detail = quality > 0;
      const fade = field.transient
        ? Math.min(1, (field.end - worldTime) / (SHAMAN_GRIP_FOOTPRINT_LIFE * 0.65))
        : 1;
      if (!field.boundaryReady) this.prepareBoundary(field, host);
      // The footprint is a persistent gameplay read on every quality level.
      // Unequal stone brackets leave intentional gaps; mineral veins sit inside
      // their middle facets, not a continuous luminous circumference.
      for (let bracket = 0; bracket < 12; bracket++) {
        ribbons.appendHeld(
          field.boundary[bracket],
          5,
          field.widths[bracket],
          0x85918e,
          0.85 * fade,
        );
        if (detail)
          ribbons.appendHeld(
            field.mineral[bracket],
            3,
            Math.min(field.radius * 0.008, 0.035 + (bracket % 3) * 0.009),
            0xc4a675,
            0.65 * fade,
          );
      }
      const n = detail ? 8 : 4;
      const phase = reducedMotion ? 0 : worldTime * 3;
      const age = worldTime - field.start;
      // Interrupted, angular seams, never a uniform disc or expanding ring.
      for (let branch = 0; branch < n; branch++) {
        const angle = branch * 2.399963 + field.source * 0.37;
        // Fractures gather unevenly before the delayed eruption. This is inner
        // dressing only: the true-radius boundary above is never delayed.
        const opening =
          reducedMotion || field.transient
            ? 1
            : Math.min(1, Math.max(0, (age - (branch % 4) * 0.045) / 0.65));
        const growth = 0.08 + 0.92 * opening * opening * (3 - 2 * opening);
        const reach = field.radius * (0.68 + (branch % 3) * 0.15) * growth;
        for (let k = 0; k < 7; k++) {
          const u = k / 6;
          const a = angle + Math.sin(branch * 4.1 + k * 2.3) * (1 - u) * 0.22;
          const x = field.x + Math.cos(a) * reach * u;
          const z = field.z + Math.sin(a) * reach * u;
          const y = host.groundYAt(x, z);
          this.points[k].set(x, (Number.isFinite(y) ? y : field.groundY) + 0.055, z);
        }
        ribbons.appendHeld(this.points, 7, detail ? 0.06 : 0.05, 0x6c7777, 0.24 * fade);
        // A short pressure front travels along the opened fault. The dark seam
        // remains behind it; the entire vein never flashes in unison.
        if (detail) {
          const travel =
            reducedMotion || field.transient
              ? 0.72
              : (Math.max(0, age - 0.28) * 0.85 + branch * 0.13) % 1;
          for (let k = 0; k < 7; k++) {
            const u = Math.max(0, Math.min(1, travel - 0.16 + k * 0.045));
            const segment = Math.min(5, Math.floor(u * 6));
            const front = this.frontPoints[k].lerpVectors(
              this.points[segment],
              this.points[segment + 1],
              u * 6 - segment,
            );
            const y = host.groundYAt(front.x, front.z);
            front.y = (Number.isFinite(y) ? y : field.groundY) + 0.055;
          }
          ribbons.appendHeld(
            this.frontPoints,
            7,
            0.019 + (branch % 3) * 0.006,
            0xe2c391,
            (0.2 + opening * 0.36 + Math.sin(phase + branch * 1.9) * 0.08) * fade,
          );
        }
        const tip = (detail ? this.frontPoints : this.points)[4 + (branch % 3)];
        overlay.push(
          tip.x,
          tip.y + 0.025,
          tip.z,
          0xc2ac89,
          0.12 + (branch % 3) * 0.045,
          OVERLAY_CELL.spark,
          0.55 * fade,
          0.6,
        );
      }
    }
    for (const binding of this.bindings) {
      if (binding.id < 0 || binding.frame !== frame) continue;
      if (!host.anchorOf(binding.id, 0, this.origin)) continue;
      const n = quality > 0 ? 5 : 3;
      for (let ridge = 0; ridge < n; ridge++) {
        const angle = ridge * 2.399963 + binding.id * 0.43;
        // Root: angular stone fingers grip the feet. Slow only: ground grit,
        // deliberately no enclosing fingers that falsely promise immobilization.
        for (let k = 0; k < 5; k++) {
          const u = k / 4;
          const radius = binding.root ? 0.74 - u * 0.45 : 0.3 + u * 0.46;
          const a = angle + (k % 2 ? 0.12 : -0.08);
          const x = this.origin.x + Math.cos(a) * radius;
          const z = this.origin.z + Math.sin(a) * radius;
          const rise = binding.root
            ? Math.sin(u * Math.PI * 0.78) * (0.48 + (ridge % 2) * 0.17)
            : 0;
          this.points[k].set(x, host.groundYAt(x, z) + 0.04 + rise, z);
        }
        ribbons.appendHeld(this.points, 5, binding.root ? 0.13 : 0.038, 0x828775, 0.7);
        if (quality > 0 && binding.root) ribbons.appendHeld(this.points, 5, 0.024, 0xc4ba8b, 0.85);
      }
    }
  }

  private prepareBoundary(field: Quake, host: FieldHost): void {
    const centreY = host.groundYAt(field.x, field.z);
    const fallbackY = Number.isFinite(centreY) ? centreY : 0;
    field.groundY = fallbackY;
    for (let bracket = 0; bracket < 12; bracket++) {
      const width = Math.min(field.radius * 0.065, 0.24 + ((bracket * 7) % 12) * 0.018);
      field.widths[bracket] = width;
      const angle = (bracket * Math.PI) / 6 + field.source * 0.37;
      const span = 0.31 + ((bracket * 5) % 12) * 0.01;
      // A ribbon can extend half its width in any camera-facing direction.
      // Insetting its centreline by that exact amount keeps every vertex inside
      // the producer's radius; the middle facet reaches the full outer boundary.
      for (let k = 0; k < 5; k++) {
        const a = angle + (k / 4 - 0.5) * span;
        const bevel = k === 0 || k === 4 ? width * (1.05 + (bracket % 3) * 0.15) : 0;
        const r = field.radius - width * 0.5 - bevel;
        const x = field.x + Math.cos(a) * r;
        const z = field.z + Math.sin(a) * r;
        const y = host.groundYAt(x, z);
        field.boundary[bracket][k].set(x, (Number.isFinite(y) ? y : fallbackY) + 0.055, z);
        if (k > 0 && k < 4) {
          const inner = r - width * 0.4;
          const ix = field.x + Math.cos(a) * inner;
          const iz = field.z + Math.sin(a) * inner;
          const iy = host.groundYAt(ix, iz);
          field.mineral[bracket][k - 1].set(ix, (Number.isFinite(iy) ? iy : fallbackY) + 0.055, iz);
        }
      }
    }
    field.boundaryReady = true;
  }

  clear(): void {
    for (const q of this.quakes) q.active = false;
    for (const b of this.bindings) b.id = -1;
  }

  dispose(): void {
    this.clear();
    this.disposed = true;
  }
}
