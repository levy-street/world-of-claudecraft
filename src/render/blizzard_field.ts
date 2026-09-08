import * as THREE from 'three';
import type { ActiveBlizzard } from '../world_api/combat';

/** The outer edge is the actual reach. Fractures point inward, never imply extra range. */
export function blizzardPerimeter(
  x: number,
  z: number,
  radius: number,
  groundY: (x: number, z: number) => number,
): THREE.BufferGeometry {
  const vertices: number[] = [],
    indices: number[] = [];
  const segments = 96;
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const width = 0.14 + (i % 3 === 0 ? 0.36 : 0.1) + 0.07 * Math.sin(i * 2.3);
    for (const r of [radius, Math.max(0, radius - width)]) {
      const px = x + Math.cos(angle) * r,
        pz = z + Math.sin(angle) * r;
      vertices.push(px, groundY(px, pz) + 0.09, pz);
    }
    if (i < segments) {
      const k = i * 2;
      indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  return geometry;
}

interface Storm {
  snapshotOwned?: boolean;
  duration: number;
  elapsed: number;
  active: boolean;
}
/** Snapshot identity owns one field even when the placement event was missed.
 * Events with persistent IDs never spawn another copy; absent rows retire immediately. */
export class BlizzardFields<T extends Storm> {
  private readonly fields = new Map<string, T>();
  private readonly seen = new Set<string>();
  constructor(private readonly spawn: (row: ActiveBlizzard) => T | null) {}
  sync(rows: readonly ActiveBlizzard[]): void {
    this.seen.clear();
    for (const row of rows) {
      if (row.remaining <= 0 || this.seen.has(row.id)) continue;
      this.seen.add(row.id);
      let field = this.fields.get(row.id);
      if (!field) {
        field = this.spawn(row) ?? undefined;
        if (field) this.fields.set(row.id, field);
      }
      if (!field) continue;
      field.snapshotOwned = true;
      field.duration = row.duration;
      field.elapsed = Math.max(0, row.duration - row.remaining);
      field.active = row.active;
    }
    for (const [id, field] of this.fields)
      if (!this.seen.has(id)) {
        field.snapshotOwned = false;
        field.elapsed = field.duration;
        this.fields.delete(id);
      }
  }
  clear(): void {
    for (const field of this.fields.values()) {
      field.snapshotOwned = false;
      field.elapsed = field.duration;
    }
    this.fields.clear();
    this.seen.clear();
  }
}
