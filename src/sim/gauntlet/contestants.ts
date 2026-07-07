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
    script: { speed: 0, fumbleOnFlip: null },
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
// assign the rest a fumble flip; give survivors a green-light speed that
// finishes comfortably inside the clock so the trial can end early once every
// contestant has resolved.
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
    if (i < npcSurvivors) {
      // Survivor: crosses the field in roughly 35..60% of the clock (better
      // skill = faster), counting on green light being up about half the time.
      const crossFrac = 0.6 - 0.25 * c.skill;
      c.script = {
        speed: t.fieldLength / (t.durationS * crossFrac * 0.5),
        fumbleOnFlip: null,
      };
    } else {
      // Fumbler: keeps moving through a red flip early in the trial and poofs.
      c.script = {
        speed: t.fieldLength / (t.durationS * 0.5 * 0.5),
        fumbleOnFlip: run.rng.int(1, 6),
      };
    }
  }
}

// Per-tick cosmetic locomotion + scripted fumbles for the sentinel trial.
// Survivor NPCs advance during green and freeze on red; fumblers overrun the
// grace window on their scripted flip and are knocked out where they stand.
export function updateSentinelNpcs(
  ctx: SimContext,
  run: GauntletRun,
  trial: GauntletSentinelState,
  dt: number,
): void {
  const t = GAUNTLET.sentinel;
  for (const c of run.contestants) {
    if (c.player || c.eliminatedAtTrial !== null) continue;
    const e = ctx.entities.get(c.entityId);
    if (!e) continue;
    const lz = e.pos.z - run.origin.z;
    if (lz >= t.fieldLength) continue; // crossed; safe, stands past the line
    const fumbling =
      trial.light === 'red' && c.script.fumbleOnFlip !== null && c.script.fumbleOnFlip <= trial.flipCount;
    // A scripted fumbler dawdles short of the line until its flip arrives, so
    // it can never cross early and dodge its own script.
    const dawdling = c.script.fumbleOnFlip !== null && lz >= t.fieldLength * 0.9 && !fumbling;
    if ((trial.light === 'green' || fumbling) && !dawdling) {
      e.prevPos = { ...e.pos };
      e.pos.z += c.script.speed * dt;
      e.facing = 0; // faces the finish line while advancing
    }
    // The fumbler is caught once its overrun outlives the grace window.
    if (fumbling && ctx.time >= trial.graceUntil) {
      applyVitalityDamage(ctx, run, c, c.vitality, 'caught');
    }
  }
}
