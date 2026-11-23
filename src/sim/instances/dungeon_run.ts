// The dungeon run as a player reads it: which group dungeon they stand in, on
// what difficulty, and which of its bosses are down in THIS claim. It backs
// IWorld.dungeonRun (the HUD's dungeon objectives tracker) on every host: the
// offline Sim reads it directly, and the server ships it on the self record
// (`dgrun`) for the online mirror.
//
// WHAT COUNTS AS A BOSS is content, never a rule in here: a run's rows are the
// Dungeon Finder catalogue's own encounter list for that dungeon and
// difficulty (content/dungeon_finder.ts FINDER_ACTIVITIES), in its progression
// order, for the activities of kind 'dungeon'. Raids and the solo attunement
// crypt author encounters too, but they are deliberately left out: the
// Crucible's two bosses live in two different instance claims, and the crypt's
// are summoned by its relics, so neither is "one room's roster" and each needs
// a design of its own.
//
// A boss made of several placed bodies is content too: the encounter lists its
// further bodies (FinderEncounter.otherBodyIds, the Mere Hydra's other two
// heads) and is still ONE row, named for the encounter's own mob id.
//
// WHEN A ROW IS DONE is the claim's own roster, like the gates
// (dungeon_gates.ts): dead instance mobs stay dead until the claim is freed,
// so a boss's corpse IS the progress and nothing is stored, saved or ticked.
// One refinement, also read from content: a dungeon whose run does not end on
// its final boss names the body it does end on in `bossExitPortal.after` (the
// Hollow Crypt: Morthen's dying rite summons the Knellwyrm). That finale
// belongs to the final boss's row, so the row waits for it, and the list never
// reads complete while the last fight is still running.
//
// A several-bodied row is done only while EVERY body lies dead at once. The
// Hydra's heads grow back while another lives, and a wipe stands every fallen
// head up again (encounters/drowned_temple/hydra_regrowth.ts), so one or two
// fallen heads are never progress and the row stays open through all of it.
// Once the last head falls nothing regrows, so a finished row stays finished.
// The read is live all the same and never latched: a body that did stand
// again would reopen its row at once.
//
// Draws NO rng and mutates no sim state. The two WeakMaps are derived read
// caches keyed by the claim's slot record (one per world), so every caller in
// a tick, and every member of a party, is handed the same frozen view.

import type { DungeonRunBossView, DungeonRunView } from '../../world_api/dungeons';
import { finderActivity, finderEncounterBodyIds } from '../content/dungeon_finder';
import { DUNGEONS } from '../data';
import type { InstanceSlot } from '../sim';
import type { SimContext } from '../sim_context';
import type { DungeonDifficulty } from '../types';
import { dungeonPlacedBossDead } from './dungeon_gates';
import { claimedInstanceAt } from './dungeons';

/** One boss row of a dungeon's objectives, as content authors it. */
export interface DungeonRunPlanRow {
  /** The boss the row is named for (a mob the dungeon places). */
  mobId: string;
  /** Every placed body the row waits on: the boss itself first, then the
   *  further bodies of a several-bodied boss. All of them must be dead. */
  bodyIds: readonly string[];
  /** The summoned body whose death ends the encounter, when that is not the
   *  boss itself; null for every ordinary boss. */
  finaleId: string | null;
}

// Per difficulty, then per dungeon id: a lookup builds no key string.
const plans: Record<DungeonDifficulty, Map<string, readonly DungeonRunPlanRow[] | null>> = {
  normal: new Map(),
  heroic: new Map(),
};

/**
 * The boss rows of a dungeon at a difficulty, in route order, or null for a
 * dungeon that is not a tracked group dungeon. Derived once per (dungeon,
 * difficulty) from immutable content.
 */
export function dungeonRunPlan(
  dungeonId: string,
  difficulty: DungeonDifficulty,
): readonly DungeonRunPlanRow[] | null {
  const byDungeon = plans[difficulty];
  const cached = byDungeon.get(dungeonId);
  if (cached !== undefined) return cached;
  // The catalogue's stable activity id (content/dungeon_finder.ts).
  const activity = finderActivity(`${dungeonId}_${difficulty}`);
  const dungeon = DUNGEONS[dungeonId];
  let plan: readonly DungeonRunPlanRow[] | null = null;
  if (activity && dungeon && activity.kind === 'dungeon' && activity.encounters.length > 0) {
    const after = dungeon.bossExitPortal?.after;
    plan = activity.encounters.map((encounter) => ({
      mobId: encounter.mobId,
      bodyIds: finderEncounterBodyIds(encounter),
      finaleId:
        encounter.final === true && after !== undefined && after !== encounter.mobId ? after : null,
    }));
  }
  byDungeon.set(dungeonId, plan);
  return plan;
}

// The finale body of a claim, once its encounter has summoned it. Bound to the
// claim's identity (its exit entity id, recreated on every claim) so a freed
// and re-claimed slot never reads the last run's corpse.
const finaleBodies = new WeakMap<InstanceSlot, { claimId: number; mobId: number }>();

/** Is the summoned finale `templateId` of this claim dead? False until it exists. */
function finaleDead(ctx: SimContext, inst: InstanceSlot, templateId: string): boolean {
  const known = finaleBodies.get(inst);
  if (known && known.claimId === inst.exitId) {
    const body = ctx.entities.get(known.mobId);
    if (body) return body.dead;
    // The remembered body is gone (an encounter that drops and re-summons its
    // finale): forget it and look again, never answer for a missing body.
    finaleBodies.delete(inst);
  }
  // An encounter appends what it summons AFTER the placed roster (one mob per
  // DungeonSpawn, in order: claimInstance), so only that tail is searched, and
  // only until the body is found once.
  const placed = DUNGEONS[inst.dungeonId]?.spawns.length ?? 0;
  for (let i = placed; i < inst.mobIds.length; i++) {
    const mob = ctx.entities.get(inst.mobIds[i]);
    if (mob?.templateId !== templateId) continue;
    if (inst.exitId !== null) finaleBodies.set(inst, { claimId: inst.exitId, mobId: mob.id });
    return mob.dead;
  }
  return false;
}

function rowDefeated(ctx: SimContext, inst: InstanceSlot, row: DungeonRunPlanRow): boolean {
  for (const bodyId of row.bodyIds) {
    if (!dungeonPlacedBossDead(ctx, inst, bodyId)) return false;
  }
  return row.finaleId === null || finaleDead(ctx, inst, row.finaleId);
}

interface RunMemo {
  claimId: number;
  difficulty: DungeonDifficulty;
  /** Bit i is set while row i is defeated. */
  defeated: number;
  view: DungeonRunView;
}

const views = new WeakMap<InstanceSlot, RunMemo>();

/** The run of one live claim, or null when its dungeon is not tracked. */
export function dungeonRunForClaim(ctx: SimContext, inst: InstanceSlot): DungeonRunView | null {
  if (inst.partyKey === null || inst.exitId === null) return null;
  const plan = dungeonRunPlan(inst.dungeonId, inst.difficulty);
  if (!plan) return null;
  let defeated = 0;
  for (let i = 0; i < plan.length; i++) {
    if (rowDefeated(ctx, inst, plan[i])) defeated |= 1 << i;
  }
  const memo = views.get(inst);
  if (
    memo &&
    memo.claimId === inst.exitId &&
    memo.difficulty === inst.difficulty &&
    memo.defeated === defeated
  )
    return memo.view;
  const bosses: DungeonRunBossView[] = plan.map((row, i) =>
    Object.freeze({ mobId: row.mobId, defeated: (defeated & (1 << i)) !== 0 }),
  );
  const view: DungeonRunView = Object.freeze({
    dungeonId: inst.dungeonId,
    difficulty: inst.difficulty,
    bosses: Object.freeze(bosses),
  });
  views.set(inst, { claimId: inst.exitId, difficulty: inst.difficulty, defeated, view });
  return view;
}

/**
 * The run `pid` is physically standing in, or null. Physical presence, not
 * party membership, decides it: a member waiting in town has no run on screen,
 * and anyone inside the claim reads the same progress.
 */
export function dungeonRunForPlayer(ctx: SimContext, pid: number): DungeonRunView | null {
  const player = ctx.entities.get(pid);
  if (!player) return null;
  const inst = claimedInstanceAt(ctx, player.pos);
  return inst ? dungeonRunForClaim(ctx, inst) : null;
}
