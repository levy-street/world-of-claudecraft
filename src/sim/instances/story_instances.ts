// Last Bell story instances: private story spaces on the shared dungeon
// instance pool. A story space is a DungeonDef with interior
// 'farshore_story' (src/sim/content/last_bell.ts); this module owns HOW a
// claim is made, which is the only way a story space differs from a dungeon
// at the plumbing level:
//   - no overworld door: entry is always a scripted call (a quest
//     interaction, the scenario sequencer, or /dev story), never a walk-in
//     door sweep, so eligibility is decided by the caller's quest gate
//   - solo-always areas (Q0's Tidemill, The Last Watch, the Willowfen
//     epilogue) claim per DURABLE character even when the player is in a
//     party: the moment must be earned personally, and a relog resumes the
//     same live claim (the same durable-key rule dungeons use for solo runs)
//   - no difficulty, no lockouts, no reset surface: claims are always
//     'normal' and recycle through the shared updateInstances idle sweep
// Leaving reuses leaveDungeon unchanged (exit portal walk-in, threat scrub,
// doorPos return). Population is the scenario's job: story defs declare
// spawns: [], so claiming draws no rng and never shifts the global stream.

import { DUNGEONS } from '../data';
import { LAST_BELL_AREAS } from '../last_bell_field';
import type { SimContext } from '../sim_context';
import { arenaQueueLeave } from '../social/arena';
import { resurrectOnInstanceReentry } from '../spirit';
import { claimInstance, instanceKeyFor, instanceOriginOf } from './dungeons';

export function isStoryDungeonId(dungeonId: string): boolean {
  return DUNGEONS[dungeonId]?.interior === 'farshore_story';
}

// Party key for group areas; durable character key for solo-always areas.
export function storyInstanceKeyFor(ctx: SimContext, pid: number, dungeonId: string): string {
  if (LAST_BELL_AREAS[dungeonId]?.soloClaim) {
    const durable = ctx.players.get(pid)?.characterId;
    return durable !== undefined ? `solo:char:${durable}` : `solo:${pid}`;
  }
  return instanceKeyFor(ctx, pid);
}

export function enterStoryInstance(ctx: SimContext, dungeonId: string, pid?: number): boolean {
  const r = ctx.resolve(pid);
  const dungeon = DUNGEONS[dungeonId];
  if (!r || !dungeon || dungeon.interior !== 'farshore_story') return false;
  // A living player enters; a ghost that ran its spirit back re-enters to
  // resurrect at the entrance (same rule as dungeons). A fresh corpse cannot
  // move and never reaches an entry interaction.
  if (r.e.dead && !r.e.ghost) return false;
  const key = storyInstanceKeyFor(ctx, r.meta.entityId, dungeonId);
  let inst = ctx.instances.find((i) => i.dungeonId === dungeonId && i.partyKey === key);
  if (!inst) {
    inst = ctx.instances.find((i) => i.dungeonId === dungeonId && i.partyKey === null);
    if (!inst) {
      ctx.error(r.meta.entityId, `All instances of ${dungeon.name} are busy. Try again soon.`);
      return false;
    }
    claimInstance(ctx, inst, key, 'normal');
  }
  const origin = instanceOriginOf(inst);
  const p = r.e;
  p.pos = ctx.groundPos(origin.x + dungeon.entry.x, origin.z + dungeon.entry.z);
  p.prevPos = { ...p.pos };
  ctx.rebucket(p);
  p.facing = 0;
  p.targetId = null;
  p.autoAttack = false;
  inst.emptyFor = 0;
  inst.enteredBy.add(r.meta.entityId);
  // Stepping inside removes you from any arena queue, exactly as dungeons do.
  arenaQueueLeave(ctx, r.meta.entityId);
  if (p.ghost) resurrectOnInstanceReentry(ctx, r.meta, p, p.pos);
  ctx.emit({ type: 'log', text: dungeon.enterText, color: '#b9f', pid: r.meta.entityId });
  return true;
}
