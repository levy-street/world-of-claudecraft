// The Gauntlet run (tutorial island): sim-side, server-authoritative credit
// for q_ps_the_gauntlet. The quest's one objective is an 'interact' keyed on
// the sentinel ps_gauntlet_flag with NO live ground entity (the
// mounts_training riding-lesson idiom): the flags a player sees are pure
// decorProps dressing, and this sweep credits the objective directly when
// the player passes each flag IN RUNNING ORDER, one count per flag. The
// objective's count doubles as the next-flag index, so run progress is
// persisted, wire-synced to the HUD tracker, and shared with the bootcamp
// coachmark, which mirrors the same count instead of keeping its own tally.
//
// Cost shape: flag tags need per-tick sampling (a sprinting player crosses a
// flag's 4 yd radius in about a second), but discovering WHO is mid-run does
// not, so the sweep runs two cadences. Once a second it rescans the player
// list for active runners into a module-scope roster (rebuilt from scratch,
// so it self-heals across joins, loads, aborts and multiple Sim instances);
// every tick it walks only that roster, which is empty for a realm with
// nobody on the rail. Zero rng (it only credits counts and emits events), so
// its position in the tick cannot fork the deterministic draw order: the
// roster is derived state rebuilt from the same tickCount on every host.
// `src/sim`-pure: no DOM/render/ui/game/net imports, no Math.random/Date.now
// (tests/architecture.test.ts).

import { BOOTCAMP_COURSE_CHECKPOINTS, isOnProvingShore } from '../content/proving_shore';
import { QUESTS } from '../data';
import { emitQuestProgress } from '../quests/quest_credit';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';

export const GAUNTLET_QUEST_ID = 'q_ps_the_gauntlet';
export const GAUNTLET_FLAG_ITEM_ID = 'ps_gauntlet_flag';
/** How close (yards) a runner must pass to the NEXT flag to be credited.
 *  Matches the bootcamp overlay's radius so the card and the quest tracker
 *  can never disagree about a tag. */
export const GAUNTLET_FLAG_RADIUS_YD = 4;

/** How often (ticks) the full player list is rescanned for active runners:
 *  the 1 Hz bookkeeping cadence. A fresh accept is picked up within a second,
 *  well inside the run from Warden Tam to the first flag. */
const RUNNER_RESCAN_TICKS = 20;

// The active-runner roster, keyed per live SimContext so parallel Sims (the
// offline world and a test Sim in one process) never share state. Entries are
// pids; the per-tick walk drops any that stopped qualifying between rescans.
const runnersBySim = new WeakMap<object, Set<number>>();

function isActiveRunner(meta: PlayerMeta): boolean {
  const qp = meta.questLog.get(GAUNTLET_QUEST_ID);
  return qp !== undefined && qp.state === 'active';
}

function creditNextFlag(ctx: SimContext, meta: PlayerMeta): boolean {
  const qp = meta.questLog.get(GAUNTLET_QUEST_ID);
  if (!qp || qp.state !== 'active') return false;
  const quest = QUESTS[GAUNTLET_QUEST_ID];
  const objective = quest?.objectives[0];
  if (!objective || objective.type !== 'interact') return false;
  const next = qp.counts[0] ?? 0;
  if (next >= objective.count) return true;
  const flag = BOOTCAMP_COURSE_CHECKPOINTS[next];
  if (!flag) return true;
  const e = ctx.entities.get(meta.entityId);
  if (!e || e.dead) return true;
  if (!isOnProvingShore(e.pos.x, e.pos.z)) return true;
  if (Math.hypot(e.pos.x - flag.x, e.pos.z - flag.z) > GAUNTLET_FLAG_RADIUS_YD) return true;
  qp.counts[0] = next + 1;
  meta.counters.questProgress++;
  emitQuestProgress(ctx, meta, qp, objective, 0);
  ctx.checkQuestReady(qp, meta);
  return true;
}

/** The per-tick sweep (called from Sim.tick beside updateTutorialGreeting):
 *  advance every active runner's next-flag check. */
export function updateGauntletRuns(ctx: SimContext): void {
  let runners = runnersBySim.get(ctx.players);
  if (!runners || ctx.tickCount % RUNNER_RESCAN_TICKS === 0) {
    runners = runners ?? new Set();
    runners.clear();
    for (const meta of ctx.players.values()) {
      if (isActiveRunner(meta)) runners.add(meta.entityId);
    }
    runnersBySim.set(ctx.players, runners);
  }
  for (const pid of runners) {
    const meta = ctx.players.get(pid);
    if (!meta || !creditNextFlag(ctx, meta)) runners.delete(pid);
  }
}
