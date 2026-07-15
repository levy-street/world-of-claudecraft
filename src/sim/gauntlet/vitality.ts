// The Gauntlet vitality pool + elimination handler. Vitality is the event's
// own normalized health pool (types.ts GauntletDef.vitalityMax): it lives on
// the run's contestant records, never on entity hp, so class, level, gear,
// heals, and potions cannot touch it. Zero vitality knocks a contestant out
// (a stylized poof, never gore): NPCs despawn, players park on the spectator
// platform and may watch the rest of the run or leave any time.
//
// The score-to-damage curves are pure and Node-tested directly.

import { GAUNTLET, GAUNTLET_LAYOUT } from '../content/gauntlet';
import type { SimContext } from '../sim_context';
import type { GauntletDamageCause } from '../types';
import type { GauntletContestant, GauntletRun } from './state';

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// End-of-trial vitality damage from a 0..1+ performance score: a perfect (or
// bonus-boosted) score takes nothing, a zero score takes the trial's damageMax.
export function trialDamageFromScore(score: number, damageMax: number): number {
  return Math.round(damageMax * (1 - clamp01(score)));
}

// Sentinel-trial performance score: field progress, plus a finish bonus that
// scales with how much of the clock was left (crossing the line always clears
// 1.0, so a finisher never takes end-of-trial damage).
export function sentinelScore(
  bestZ: number,
  finished: boolean,
  clockLeftFrac: number,
  fieldLength: number,
  finishBonusMax: number,
): number {
  if (finished) return 1 + finishBonusMax * clamp01(clockLeftFrac);
  return clamp01(bestZ / fieldLength);
}

export function aliveContestants(run: GauntletRun): GauntletContestant[] {
  return run.contestants.filter((c) => c.eliminatedAtTrial === null);
}

// Emit a personal copy of an event to every player still attached to the run
// (spectators included: they are watching for exactly these).
export function emitToRunPlayers(
  ctx: SimContext,
  run: GauntletRun,
  ev: (pid: number) => Parameters<SimContext['emit']>[0],
): void {
  for (const pid of run.playerStates.keys()) ctx.emit(ev(pid));
}

// Deal vitality damage to one contestant, knocking them out at zero. Returns
// true when the hit eliminated them.
export function applyVitalityDamage(
  ctx: SimContext,
  run: GauntletRun,
  c: GauntletContestant,
  amount: number,
  cause: GauntletDamageCause,
): boolean {
  if (c.eliminatedAtTrial !== null || amount <= 0) return false;
  c.vitality = Math.max(0, c.vitality - Math.round(amount));
  if (c.player) {
    ctx.emit({
      type: 'gauntletDamage',
      amount: Math.round(amount),
      cause,
      vitality: c.vitality,
      pid: c.entityId,
    });
  }
  if (c.vitality > 0) return false;
  eliminateContestant(ctx, run, c);
  return true;
}

// End-of-trial NPC attrition: thin the surviving NPC field toward the trial's
// targetSurvivorsPerTrial entry (players are never culled by targets). The
// least skilled fall first, with a seeded jitter so the order never reads as a
// fixed sort. Every trial module calls this as it resolves.
export function cullNpcsToward(ctx: SimContext, run: GauntletRun): void {
  const target = GAUNTLET.targetSurvivorsPerTrial[run.trialIndex] ?? 0;
  const alive = aliveContestants(run);
  const alivePlayers = alive.filter((c) => c.player).length;
  const npcs = alive.filter((c) => !c.player);
  const keep = Math.max(0, target - alivePlayers);
  if (npcs.length <= keep) return;
  const ranked = npcs
    .map((c) => ({ c, rank: c.skill + run.rng.range(-0.15, 0.15) }))
    .sort((a, b) => a.rank - b.rank)
    .map((r) => r.c);
  for (let i = 0; i < ranked.length - keep; i++) {
    applyVitalityDamage(ctx, run, ranked[i], ranked[i].vitality, 'trial');
  }
}

// Knock a contestant out. `parkPlayer` (default true) moves a fallen player to
// the spectator platform; the forfeit paths (leave command, disconnect, died
// or teleported out of the band by some other system) pass false because the
// player is leaving the run entirely.
export function eliminateContestant(
  ctx: SimContext,
  run: GauntletRun,
  c: GauntletContestant,
  parkPlayer = true,
): void {
  if (c.eliminatedAtTrial !== null) return;
  c.eliminatedAtTrial = run.trialIndex;
  run.prizePool += GAUNTLET.prizePerElimination;
  const e = ctx.entities.get(c.entityId);
  const at = e ? { x: e.pos.x, z: e.pos.z } : { x: run.origin.x, z: run.origin.z };
  const survivors = aliveContestants(run).length;
  emitToRunPlayers(ctx, run, (pid) => ({
    type: 'gauntletPoof',
    entityId: c.entityId,
    name: c.name,
    x: at.x,
    z: at.z,
    survivors,
    pid,
  }));
  if (!c.player) {
    if (ctx.entities.has(c.entityId)) ctx.dropEntity(c.entityId);
    return;
  }
  // Player knockout: park them on the spectator platform beside the field.
  // They keep watching (all run events still reach them) and can leave any
  // time via gauntletLeave.
  const ps = run.playerStates.get(c.entityId);
  if (ps) {
    ps.spectating = true;
    ps.heldAt = null;
    ps.momentumX = 0;
    ps.momentumZ = 0;
  }
  if (parkPlayer && e) {
    e.pos = ctx.groundPos(
      run.origin.x + GAUNTLET_LAYOUT.spectatorX,
      run.origin.z + GAUNTLET_LAYOUT.spectatorZ,
    );
    e.prevPos = { ...e.pos };
    ctx.rebucket(e);
  }
  // Hand the entity hp back to the real world: the vitality mirror only
  // tracks live contestants, and a spectator showing an empty bar reads as a
  // corpse.
  if (ps && e && !e.dead) e.hp = Math.max(1, Math.min(ps.savedHp, e.maxHp));
  ctx.emit({ type: 'gauntletEliminated', trialIndex: run.trialIndex, pid: c.entityId });
}
