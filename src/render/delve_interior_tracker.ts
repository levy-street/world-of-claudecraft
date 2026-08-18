// Schedules delve module interior builds and retires stale geometry. Extracted
// out of renderer.ts (the monolith ratchet) rather than grown there.
import type * as THREE from 'three';
import { delveModuleZOffset } from '../sim/data';
import type { DelveModuleId } from '../sim/delve_layout';
import { type DelveInteriorPlacement, delveInteriorBuildAction } from './delve_interior_cache_core';
import { buildDelveModule } from './delve_interiors';
import type { DungeonInteriors } from './dungeon';
import { ensureDelveInteriorKit } from './interior_kit';

/**
 * Delve interiors are keyed by z-stacked POSITION (delveId:slot:moduleIndex),
 * not moduleId: pickDelveModules randomizes which module occupies which
 * position every run, so the same slot's position can host a different room
 * shape next run. Tracking per position lets a later run detect that mismatch
 * and retire the stale geometry instead of leaving it standing (walls in the
 * wrong place while this run's mobs/puzzle/boss spawn against the true,
 * current module).
 */
export class DelveInteriorTracker {
  private pending = new Set<string>();
  private placementAt = new Map<string, DelveInteriorPlacement>();
  private groups = new Map<string, THREE.Group>();

  constructor(
    private readonly dungeons: () => DungeonInteriors,
    private readonly retire: (group: THREE.Group) => void,
    // Shared with the renderer's other interior kinds (dungeon/arena/rift),
    // so a build here also marks the shared "has this key been built" cache.
    private readonly built: Set<string>,
  ) {}

  private schedule(key: string, moduleId: DelveModuleId, ox: number, oz: number): void {
    const placement: DelveInteriorPlacement = { moduleId, ox, oz };
    const action = delveInteriorBuildAction(
      this.placementAt.get(key),
      placement,
      this.pending.has(key),
    );
    if (action === 'skip') return;
    if (action === 'rebuild') {
      const stale = this.groups.get(key);
      if (stale) this.retire(stale);
      this.placementAt.delete(key);
      this.groups.delete(key);
      this.built.delete(key);
    }
    this.pending.add(key);
    void buildDelveModule(this.dungeons(), moduleId, ox, oz)
      .then((group) => {
        this.placementAt.set(key, placement);
        this.groups.set(key, group);
        this.built.add(key);
        this.pending.delete(key);
      })
      .catch((err) => {
        this.pending.delete(key);
        if (import.meta.env?.DEV) {
          console.warn('Failed to build delve interior:', moduleId, 'at', ox, oz, err);
        }
      });
  }

  /** Build every module in a delve run at its stacked z offset (parallel async). */
  buildAll(
    delveId: string,
    slot: number,
    origin: { x: number; z: number },
    modules: readonly DelveModuleId[],
  ): void {
    void ensureDelveInteriorKit().catch(() => undefined);
    for (let mi = 0; mi < modules.length; mi++) {
      const moduleId = modules[mi];
      const key = `delve:${delveId}:${slot}:${mi}`;
      const zOff = delveModuleZOffset(modules, mi);
      this.schedule(key, moduleId, origin.x, origin.z + zOff);
    }
  }
}
