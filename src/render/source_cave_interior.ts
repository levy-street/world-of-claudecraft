// Source Cave interior render: builds the cave's module stack (the Collapsed
// Reliquary's four module types, cave-appropriate dressing per DELVE_MODULE_VARIANT
// in delve_interiors.ts) at whichever claimed instance slot the local player is
// standing in, the same way delve_interiors.ts + renderer.ts's
// ensureDelveInteriorsNear do for a live DelveRun.
//
// The cave has no DelveRun-shaped IWorld member (world.sourceCaveInfo() carries the
// static module-type SEQUENCE instead, since the cave's roster/layout is the same
// for every instance, only the viewer's own progress differs), so this is a small
// parallel driver over the SAME per-module geometry builder (buildDelveModule) that
// delve_interiors.ts already exports; it never forks or duplicates that builder.
// Informational/visual only, never authoritative: sim/colliders.ts resolves the
// cave's real collision the same way it resolves any other delve module.

import type * as THREE from 'three';
import {
  DELVE_MODULE_Z_START,
  delveModuleStackEndRelZ,
  delveModuleZOffset,
  delveOrigin,
  delveSlotAt,
} from '../sim/data';
import type { DelveModuleId } from '../sim/delve_layout';
import { isSourceCavePos, SOURCE_CAVE_DELVE_INDEX } from '../sim/source_cave';
import type { SourceCaveInfo } from '../world_api';
import { buildDelveModule } from './delve_interiors';
import type { DungeonInteriors } from './dungeon';
import { ensureDelveInteriorKit } from './interior_kit';
import { SourceCaveSealRenderer } from './source_cave_seal';

// Slot origins are spaced far apart on world x/z; a coarse x check first (mirrors
// renderer.ensureDelveInteriorsNear) avoids ever building the wrong slot's copy.
const SLOT_X_TOLERANCE = 120;
// How far south of the module-0 z-start the player can stand and still trigger a
// build. Must clear the arena's own entrance/exit (source_cave/spec.ts's
// sourceCaveEntryZ/sourceCaveExitZ), which sit south of the arena centre by an
// amount that scales with the roster (worst case, the 60-roster cap, is ~52u
// south of the module z-start): a margin sized for the OLD compact reliquary
// module chain's entrance (only ~9-17u south) left the arena entirely unbuilt
// (walls/floor/pillars/torches never render, only entities like mobs/the chest
// do) while the player stood at the door. Matches clear.ts's occupancy south
// margin for the same reason.
const STACK_START_MARGIN = 70;

export class SourceCaveInteriors {
  private readonly builtInteriors = new Set<string>();
  // Module builds are async; track in-flight keys so a per-frame ensureNear does
  // not re-schedule a build mid-load (mirrors renderer.ts's pendingInteriors set).
  private readonly pendingInteriors = new Set<string>();
  private readonly seal: SourceCaveSealRenderer;

  constructor(scene: THREE.Scene) {
    this.seal = new SourceCaveSealRenderer(scene);
  }

  private scheduleModuleBuild(
    dungeons: DungeonInteriors,
    key: string,
    moduleId: DelveModuleId,
    ox: number,
    oz: number,
  ): void {
    if (this.builtInteriors.has(key) || this.pendingInteriors.has(key)) return;
    this.pendingInteriors.add(key);
    void buildDelveModule(dungeons, moduleId, ox, oz)
      .then(() => {
        this.builtInteriors.add(key);
        this.pendingInteriors.delete(key);
      })
      .catch((err) => {
        this.pendingInteriors.delete(key);
        if (import.meta.env?.DEV) {
          console.warn('Failed to build source cave interior:', moduleId, 'at', ox, oz, err);
        }
      });
  }

  private buildAllModules(
    dungeons: DungeonInteriors,
    slot: number,
    origin: { x: number; z: number },
    modules: readonly DelveModuleId[],
  ): void {
    void ensureDelveInteriorKit().catch(() => undefined);
    for (let mi = 0; mi < modules.length; mi++) {
      const moduleId = modules[mi];
      const key = `sourcecave:${slot}:${mi}:${moduleId}`;
      if (this.builtInteriors.has(key) || this.pendingInteriors.has(key)) continue;
      const zOff = delveModuleZOffset(modules, mi);
      this.scheduleModuleBuild(dungeons, key, moduleId, origin.x, origin.z + zOff);
    }
  }

  /**
   * Build the cave's module stack near (px, pz) once the local player enters the
   * cave's reserved delve sub-band. `modules` is world.sourceCaveInfo()?.modules,
   * the ordered module-type sequence (same for every instance); a null/empty list
   * is a no-op (no cave, or the snapshot has not shipped it yet). Cheap to call
   * every frame: bails immediately outside the cave's x band.
   */
  ensureNear(
    dungeons: DungeonInteriors,
    px: number,
    pz: number,
    modules: readonly string[] | undefined,
    info: SourceCaveInfo,
  ): void {
    if (!modules || modules.length === 0) return;
    if (!isSourceCavePos(px)) return;
    const mods = modules as DelveModuleId[];
    const slot = delveSlotAt(SOURCE_CAVE_DELVE_INDEX, pz, mods);
    const origin = delveOrigin(SOURCE_CAVE_DELVE_INDEX, slot);
    if (Math.abs(px - origin.x) >= SLOT_X_TOLERANCE) return;
    const stackEndZ = origin.z + delveModuleStackEndRelZ(mods);
    if (pz < origin.z + DELVE_MODULE_Z_START - STACK_START_MARGIN || pz > stackEndZ) return;
    this.seal.ensureNear(px, pz, modules, info);
    this.buildAllModules(dungeons, slot, origin, mods);
  }
}
