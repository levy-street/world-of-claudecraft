// The renderer-side scheduler for delve module interiors.
//
// A delve run is a STACK of authored modules built at one origin with each
// module offset down z, and the renderer reaches that stack from two very
// different directions: once eagerly when the run starts (the delveStarted
// event), and again every frame the player stands inside a delve band. Both
// paths must agree on the same key space and the same in-flight set or the
// per-frame path re-schedules a build the event path already started.
//
// `renderer.ts` still owns the interior key sets (its arena, rift and dungeon
// paths share them) and the one lazily-built DungeonInteriors; this module owns
// the scheduling rules over them.
//
// Extracted from `renderer.ts` under the monolith ratchet (tests/monolith_budget).
import {
  DELVE_MODULE_Z_START,
  defaultDelveModules,
  delveAt,
  delveModuleStackEndRelZ,
  delveModuleZOffset,
  delveOrigin,
  delveSlotAt,
} from '../sim/data';
import type { DelveModuleId } from '../sim/delve_layout';
import type { DelveRunInfo } from '../world_api/delves';
import { buildDelveModule } from './delve_interiors';
import type { DungeonInteriors } from './dungeon';
import { ensureDelveInteriorKit } from './interior_kit';

/**
 * The renderer state this scheduler reads and writes. Held as one long-lived
 * object on the renderer rather than rebuilt per call: the near-check runs
 * every frame the player is inside a delve, so a fresh literal there would
 * allocate on the per-frame path.
 */
export interface DelveInteriorCtx {
  /** The renderer's one DungeonInteriors, built on first use. */
  dungeons: () => DungeonInteriors;
  /** Interior keys already built. Shared with the arena, rift and dungeon paths. */
  built: Set<string>;
  /** Interior keys with a build in flight, so the per-frame path cannot double-schedule. */
  pending: Set<string>;
  /** The live delve run, or null outside one. */
  run: () => DelveRunInfo | null;
}

export function scheduleDelveModuleBuild(
  ctx: DelveInteriorCtx,
  key: string,
  moduleId: DelveModuleId,
  ox: number,
  oz: number,
): void {
  if (ctx.built.has(key) || ctx.pending.has(key)) return;
  ctx.pending.add(key);
  void buildDelveModule(ctx.dungeons(), moduleId, ox, oz)
    .then(() => {
      ctx.built.add(key);
      ctx.pending.delete(key);
    })
    .catch((err) => {
      ctx.pending.delete(key);
      if (import.meta.env?.DEV) {
        console.warn('Failed to build delve interior:', moduleId, 'at', ox, oz, err);
      }
    });
}

/** Build every module in a delve run at its stacked z offset (parallel async). */
export function buildAllDelveModules(
  ctx: DelveInteriorCtx,
  delveId: string,
  slot: number,
  origin: { x: number; z: number },
  modules: readonly DelveModuleId[],
): void {
  void ensureDelveInteriorKit().catch(() => undefined);
  for (let mi = 0; mi < modules.length; mi++) {
    const moduleId = modules[mi];
    const key = `delve:${delveId}:${slot}:${moduleId}`;
    if (ctx.built.has(key) || ctx.pending.has(key)) continue;
    const zOff = delveModuleZOffset(modules, mi);
    scheduleDelveModuleBuild(ctx, key, moduleId, origin.x, origin.z + zOff);
  }
}

/** Prebuild the full module stack when a delve run starts (offline + online). */
export function prebuildDelveInteriors(ctx: DelveInteriorCtx, delveId: string): void {
  const run = ctx.run();
  if (!run || run.delveId !== delveId || !run.modules.length) return;
  buildAllDelveModules(ctx, delveId, run.slot, run.origin, run.modules as DelveModuleId[]);
}

export function ensureDelveInteriorsNear(ctx: DelveInteriorCtx, px: number, pz: number): void {
  const delve = delveAt(px);
  if (!delve) return;
  const run = ctx.run();
  const modules = (
    run?.delveId === delve.id && run.modules.length ? run.modules : defaultDelveModules(delve.id)
  ) as DelveModuleId[];
  const slot = run?.delveId === delve.id ? run.slot : delveSlotAt(delve.index, pz, modules);
  const origin = run?.delveId === delve.id ? run.origin : delveOrigin(delve.index, slot);
  // Slot origins are 500u apart on z; nearest-slot heuristics mis-pick slot 1+
  // once the player advances past module 1 (interiors build at the wrong oz).
  if (Math.abs(px - origin.x) >= 120) return;
  const stackEndZ = origin.z + delveModuleStackEndRelZ(modules);
  if (pz < origin.z + DELVE_MODULE_Z_START - 30 || pz > stackEndZ) return;
  buildAllDelveModules(ctx, delve.id, slot, origin, modules);
}
