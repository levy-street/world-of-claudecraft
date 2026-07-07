// The Gauntlet NPC contestant field: seeded roster generation, spawning, the
// sentinel-trial performance scripts, and the cheap cosmetic locomotion that
// drives them. Contestants are lightweight friendly NPC entities steered by
// direct position writes from the run driver (never updateMob / pathfinding):
// their whole purpose is to make the field feel alive and to thin on schedule
// toward targetSurvivorsPerTrial.
//
// Every draw here comes from run.rng (the per-run stream), never the shared
// sim stream.

import {
  GAUNTLET,
  GAUNTLET_CONTESTANT_FIRST_NAMES,
  GAUNTLET_CONTESTANT_LAST_NAMES,
  GAUNTLET_CONTESTANT_NPC_ID,
  GAUNTLET_LAYOUT,
} from '../content/gauntlet';
import { NPCS } from '../data';
import { createNpc } from '../entity';
import type { SimContext } from '../sim_context';
import type { GauntletContestant, GauntletRun, GauntletSentinelState } from './state';
import { aliveContestants, applyVitalityDamage } from './vitality';

// Roll one NPC contestant record (no entity yet; spawnContestants creates
// those when the run starts).
export function rollNpcContestant(run: GauntletRun): GauntletContestant {
  const first = run.rng.pick([...GAUNTLET_CONTESTANT_FIRST_NAMES]);
  const last = run.rng.pick([...GAUNTLET_CONTESTANT_LAST_NAMES]);
  return {
    entityId: 0, // assigned at spawn
    player: false,
    name: `${first} ${last}`,
    vitality: GAUNTLET.vitalityMax,
    skill: run.rng.range(GAUNTLET.npcSkillMin, GAUNTLET.npcSkillMax),
    eliminatedAtTrial: null,
    script: idleScript(),
  };
}

// A blank script (players carry one too; only NPCs ever plan into it).
export function idleScript(): GauntletContestant['script'] {
  return {
    speed: 0,
    fumbleOnFlip: null,
    planKey: -1,
    goAt: 0,
    stopAt: 0,
    mult: 1,
    pauseAt: 0,
    pauseUntil: 0,
  };
}

// Spawn an entity for every NPC contestant, lined up on the staging area
// behind the players (who take the front line-up spots when the run driver
// teleports them in).
export function spawnNpcContestants(ctx: SimContext, run: GauntletRun, startIndex: number): void {
  const def = NPCS[GAUNTLET_CONTESTANT_NPC_ID];
  const npcs = run.contestants.filter((c) => !c.player);
  const total = run.contestants.length;
  for (let i = 0; i < npcs.length; i++) {
    const c = npcs[i];
    const pos = stagingSpot(run, startIndex + i, total);
    const e = createNpc(ctx.nextId++, def, pos);
    e.name = c.name;
    c.entityId = e.id;
    ctx.addEntity(e);
  }
}

// Teleport every attached PLAYER (and reposition every surviving NPC
// contestant) into a line-up centered on an instance-local arena anchor.
// Every trial module calls this at its start so the field arrives together;
// spectators stay parked on the terrace.
export function placeContestantsAt(
  ctx: SimContext,
  run: GauntletRun,
  anchorX: number,
  anchorZ: number,
  halfWidth: number,
): void {
  const alive = aliveContestants(run);
  for (let i = 0; i < alive.length; i++) {
    const c = alive[i];
    if (c.player && run.playerStates.get(c.entityId)?.spectating) continue;
    const e = ctx.entities.get(c.entityId);
    if (!e) continue;
    const perRow = Math.max(1, Math.ceil(alive.length / 3));
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const spread = (halfWidth * 2) / Math.max(1, perRow - 1 || 1);
    e.pos = {
      x: run.origin.x + anchorX - halfWidth + (perRow === 1 ? 0 : col * spread),
      y: 0,
      z: run.origin.z + anchorZ - row * 2,
    };
    e.prevPos = { ...e.pos };
    e.facing = 0;
    ctx.rebucket(e);
  }
}

// A deterministic line-up spot on the staging area for the i-th of n
// contestants: rows of even lateral spread south of the start line.
export function stagingSpot(
  run: GauntletRun,
  i: number,
  n: number,
): { x: number; y: number; z: number } {
  const perRow = Math.max(1, Math.ceil(n / 3));
  const row = Math.floor(i / perRow);
  const col = i % perRow;
  const spread = (GAUNTLET_LAYOUT.stagingHalfWidth * 2) / Math.max(1, perRow - 1 || 1);
  const x = run.origin.x - GAUNTLET_LAYOUT.stagingHalfWidth + (perRow === 1 ? 0 : col * spread);
  const z = run.origin.z + GAUNTLET_LAYOUT.stagingZ - row * 2.5;
  return { x, y: 0, z };
}

// Plan the sentinel trial for the NPC field: pick which NPCs survive (the
// most skilled, with a seeded jitter so it never reads as a fixed sort) and
// assign the rest a fumble flip. Everyone runs at a real footrace pace
// (skill-lerped between the npcSpeed bounds, in the same league as a player's
// RUN_SPEED); the per-window improv in updateSentinelNpcs supplies the human
// wobble on top.
export function planSentinelScripts(run: GauntletRun): void {
  const t = GAUNTLET.sentinel;
  const npcs = aliveContestants(run).filter((c) => !c.player);
  const target = GAUNTLET.targetSurvivorsPerTrial[run.trialIndex] ?? 0;
  const alivePlayers = aliveContestants(run).filter((c) => c.player).length;
  const npcSurvivors = Math.max(0, Math.min(npcs.length, target - alivePlayers));
  const ranked = npcs
    .map((c) => ({ c, rank: c.skill + run.rng.range(-0.15, 0.15) }))
    .sort((a, b) => b.rank - a.rank)
    .map((r) => r.c);
  for (let i = 0; i < ranked.length; i++) {
    const c = ranked[i];
    c.script = idleScript();
    c.script.speed = t.npcSpeedMin + (t.npcSpeedMax - t.npcSpeedMin) * c.skill;
    // Fumbler: keeps moving through a red flip early in the trial and poofs.
    if (i >= npcSurvivors) c.script.fumbleOnFlip = run.rng.int(1, 6);
  }
}

// Roll this light window's improv for one NPC: a start hesitation and maybe a
// mid-run stutter on green, a short stop lag on red. Every draw comes from
// run.rng, and every alive NPC replans on the same tick (the flip tick, in
// roster order), so the draw order stays deterministic.
function replanNpcWindow(
  run: GauntletRun,
  c: GauntletContestant,
  trial: GauntletSentinelState,
  key: number,
  now: number,
): void {
  const t = GAUNTLET.sentinel;
  const s = c.script;
  s.planKey = key;
  if (trial.light === 'green') {
    s.goAt = now + run.rng.range(t.npcReactMinS, t.npcReactMaxS);
    s.mult = run.rng.range(1 - t.npcSpeedJitter, 1 + t.npcSpeedJitter);
    if (run.rng.chance(t.npcHesitateChance)) {
      s.pauseAt = now + run.rng.range(0.8, 2.2);
      s.pauseUntil = s.pauseAt + run.rng.range(t.npcHesitateMinS, t.npcHesitateMaxS);
    } else {
      s.pauseAt = 0;
      s.pauseUntil = 0;
    }
  } else {
    s.stopAt = now + run.rng.range(0, t.npcStopLagMaxS);
  }
}

// Per-tick locomotion + scripted fumbles for the sentinel trial. Survivor
// NPCs sprint on green (late off the mark, sometimes stuttering mid-run,
// braking a beat after red); fumblers overrun the grace window on their
// scripted flip and are knocked out where they stand.
export function updateSentinelNpcs(
  ctx: SimContext,
  run: GauntletRun,
  trial: GauntletSentinelState,
  dt: number,
): void {
  const t = GAUNTLET.sentinel;
  const key = trial.flipCount * 2 + (trial.light === 'red' ? 1 : 0);
  for (const c of run.contestants) {
    if (c.player || c.eliminatedAtTrial !== null) continue;
    const e = ctx.entities.get(c.entityId);
    if (!e) continue;
    const lz = e.pos.z - run.origin.z;
    if (lz >= t.fieldLength) continue; // crossed; safe, stands past the line
    if (c.script.planKey !== key) replanNpcWindow(run, c, trial, key, ctx.time);
    const fumbling =
      trial.light === 'red' &&
      c.script.fumbleOnFlip !== null &&
      c.script.fumbleOnFlip <= trial.flipCount;
    // A scripted fumbler dawdles short of the line until its flip arrives, so
    // it can never cross early and dodge its own script.
    const dawdling = c.script.fumbleOnFlip !== null && lz >= t.fieldLength * 0.9 && !fumbling;
    const s = c.script;
    const pausing = s.pauseUntil > s.pauseAt && ctx.time >= s.pauseAt && ctx.time < s.pauseUntil;
    const advancing = fumbling
      ? true
      : trial.light === 'green'
        ? ctx.time >= s.goAt && !pausing
        : ctx.time < s.stopAt; // brake lag; scripts, not detection, catch NPCs
    if (advancing && !dawdling) {
      e.prevPos = { ...e.pos };
      e.pos.z += s.speed * s.mult * dt;
      e.facing = 0; // faces the finish line while advancing
    }
    // The fumbler is caught once its overrun outlives the grace window.
    if (fumbling && ctx.time >= trial.graceUntil) {
      applyVitalityDamage(ctx, run, c, c.vitality, 'caught');
    }
  }
}
