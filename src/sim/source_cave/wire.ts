// Source Cave info projection: the render/HUD-facing view of the cave, mirroring
// delves/runs.ts's delveRunWire idiom (a pure read of existing state, NO ctx.rng).
// The mob roster + module count are STATIC (the same for every caller regardless of
// instance): the cave has one shared def, so the "what is in this cave" display never
// varies. Only `killed` (progress in the viewer's own claimed instance) and `cleared`
// (the viewer's active lockout) are per-player.
//
// Returns null when no cave exists (ctx.sourceCave is null), matching delveRunWire's
// null-when-nothing-exists contract; in practice only some test fixtures build a Sim
// without a cave.

import { devTierForMergedPrs } from '../dev_tier';
import type { SimContext } from '../sim_context';
import { sourceCaveDefeatMobIds } from './encounter';
import { sourceCaveInstanceForPlayer, sourceCaveSealPopulation } from './occupancy';
import { SOURCE_CAVE_DUNGEON_ID } from './runtime';

export function sourceCaveInfoWire(ctx: SimContext, pid: number): object | null {
  const cave = ctx.sourceCave;
  if (!cave) return null;

  const mobs = cave.spec.mobs.map((m) => ({
    login: m.login,
    elite: m.elite,
    boss: m.boss,
    combatant: m.combatant,
    // Prestige rung and combat role ride together because the nameplate shows a
    // DIFFERENT one per encounter phase (render/source_cave_nameplate_core.ts):
    // the rung while the contributors are still friendly, the role once the
    // reboot turns them hostile. Both are resolved here rather than shipping the
    // raw merged-PR count, matching how elite/boss already cross as decisions.
    tier: devTierForMergedPrs(m.mergedPrs)?.key ?? null,
    combatTier: m.combatTier,
  }));
  let totalMobs = cave.spec.mobs.filter((mob) => mob.combatant).length;
  const moduleCount = cave.spec.modules.length;
  // Static, zero new rng draws: cave.spec.modules is already computed at ctor time,
  // so this is a cheap read of a handful of short strings (render needs the actual
  // ordered module-type sequence to stack modules with the real per-type footprint).
  const modules = cave.spec.modules;

  let killed = 0;
  let cleared = false;
  let sealState: 'idle' | 'active' | 'breached' | 'cleared' = 'idle';
  let playersInsideSeal = 0;
  let playersInInstance = 0;
  let activeWave = 0;
  let totalWaves = 0;
  const r = ctx.resolve(pid);
  if (r) {
    // An active lockout means this player already cleared the cave recently (the
    // lockout is granted at clear time, so this holds whether or not they are still
    // inside). Mirrors dungeon.ts's isSourceCaveLocked comparison exactly.
    cleared = (r.meta.raidLockouts.get(SOURCE_CAVE_DUNGEON_ID) ?? 0) > ctx.lockoutNowMs();

    // Kill progress is scoped to the player's own claimed cave instance; count dead
    // mobs with the exact clear.ts liveness idiom (a mob id counts once its entity is
    // despawned OR flagged dead). No active instance means no progress to show.
    const inst = sourceCaveInstanceForPlayer(ctx, r.meta.entityId);
    if (inst) {
      const population = sourceCaveSealPopulation(ctx, inst);
      playersInsideSeal = population.inside;
      playersInInstance = population.eligible;
      const encounter = inst.sourceCaveEncounter;
      if (encounter) {
        totalWaves = encounter.waves.length;
        activeWave =
          encounter.activatedWaves.size === 0
            ? 0
            : Math.max(...encounter.activatedWaves.values()) + 1;
        sealState = encounter.cleared
          ? 'cleared'
          : encounter.breached
            ? 'breached'
            : encounter.started
              ? 'active'
              : 'idle';
      }
      const defeatMobIds = sourceCaveDefeatMobIds(inst);
      totalMobs = defeatMobIds.length;
      for (const id of defeatMobIds) {
        const e = ctx.entities.get(id);
        if (!e || e.dead) killed++;
      }
    }
  }

  return {
    moduleCount,
    modules,
    mobs,
    totalMobs,
    killed,
    cleared,
    sealState,
    playersInsideSeal,
    playersInInstance,
    activeWave,
    totalWaves,
  };
}
