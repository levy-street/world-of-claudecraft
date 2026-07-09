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
  GAUNTLET_CONTESTANT_CLASSES,
  GAUNTLET_CONTESTANT_FIRST_NAMES,
  GAUNTLET_CONTESTANT_LAST_NAMES,
  GAUNTLET_CONTESTANT_NPC_ID,
  GAUNTLET_LAYOUT,
  gauntletContestantNpcId,
} from '../content/gauntlet';
import { SKIN_COUNTS } from '../content/skins';
import { NPCS } from '../data';
import { createNpc } from '../entity';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import type { GauntletContestant, GauntletRun, GauntletSentinelState } from './state';
import { aliveContestants, applyVitalityDamage } from './vitality';

// Roll one NPC contestant record (no entity yet; spawnContestants creates
// those when the run starts). The adventurer kit rolls last: name, skill,
// class, skin, all from the per-run stream in a fixed order.
export function rollNpcContestant(run: GauntletRun): GauntletContestant {
  const first = run.rng.pick([...GAUNTLET_CONTESTANT_FIRST_NAMES]);
  const last = run.rng.pick([...GAUNTLET_CONTESTANT_LAST_NAMES]);
  const skill = run.rng.range(GAUNTLET.npcSkillMin, GAUNTLET.npcSkillMax);
  const cls = run.rng.pick([...GAUNTLET_CONTESTANT_CLASSES]);
  return {
    entityId: 0, // assigned at spawn
    player: false,
    name: `${first} ${last}`,
    vitality: GAUNTLET.vitalityMax,
    skill,
    cls,
    skin: run.rng.int(0, SKIN_COUNTS[cls] - 1),
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
    weavePhase: 0,
    overshoot: 0,
  };
}

// Spawn an entity for every NPC contestant, lined up on the staging area
// behind the players (who take the front line-up spots when the run driver
// teleports them in).
export function spawnNpcContestants(ctx: SimContext, run: GauntletRun, startIndex: number): void {
  const npcs = run.contestants.filter((c) => !c.player);
  const total = run.contestants.length;
  for (let i = 0; i < npcs.length; i++) {
    const c = npcs[i];
    const pos = stagingSpot(run, startIndex + i, total);
    // The rolled class picks the kit def; the rolled skin its appearance.
    const def = NPCS[gauntletContestantNpcId(c.cls)] ?? NPCS[GAUNTLET_CONTESTANT_NPC_ID];
    const e = createNpc(ctx.nextId++, def, pos);
    e.name = c.name;
    e.skin = c.skin;
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
    e.pos = ctx.groundPos(
      run.origin.x + anchorX - halfWidth + (perRow === 1 ? 0 : col * spread),
      run.origin.z + anchorZ - row * 2,
    );
    e.prevPos = { ...e.pos };
    e.facing = 0;
    ctx.rebucket(e);
  }
}

// Seat every live, non-spectating player at a per-index station spot (the
// desk-trial seating: the trial module authors the spots, runs.ts pins the
// players there for the trial). NPC crowd placement stays with
// placeContestantsAt; iteration is playerStates insertion order, and no rng
// is drawn. spot(i, n) returns instance-local x/z plus the facing to hold.
export function seatLivePlayersAt(
  ctx: SimContext,
  run: GauntletRun,
  spot: (i: number, n: number) => { x: number; z: number; facing: number },
): void {
  const live: number[] = [];
  for (const [pid, ps] of run.playerStates) {
    if (ps.spectating) continue;
    const c = run.contestants.find((k) => k.entityId === pid);
    if (!c || c.eliminatedAtTrial !== null) continue;
    live.push(pid);
  }
  for (let i = 0; i < live.length; i++) {
    const e = ctx.entities.get(live[i]);
    if (!e) continue;
    const s = spot(i, live.length);
    // groundPos, not y 0: a station can sit on a walk-on platform (the
    // etching dais carries real height).
    e.pos = ctx.groundPos(run.origin.x + s.x, run.origin.z + s.z);
    e.prevPos = { ...e.pos };
    e.facing = s.facing;
    ctx.rebucket(e);
  }
}

// Seat every alive, non-spectating contestant (players AND the NPC field) at a
// per-index station spot, auto-assigning stations in aliveContestants order.
// The echo desk trial calls this so its whole field sits at its own apparatus
// rather than a lone table plus an audience; spot(i, n) returns instance-local
// x/z plus the facing to hold. No rng is drawn (aliveContestants is a stable
// order), so the draw stream is untouched.
export function seatAllContestantsAt(
  ctx: SimContext,
  run: GauntletRun,
  spot: (i: number, n: number) => { x: number; z: number; facing: number },
): void {
  const seated = aliveContestants(run).filter(
    (c) => !(c.player && run.playerStates.get(c.entityId)?.spectating),
  );
  for (let i = 0; i < seated.length; i++) {
    const e = ctx.entities.get(seated[i].entityId);
    if (!e) continue;
    const s = spot(i, seated.length);
    e.pos = ctx.groundPos(run.origin.x + s.x, run.origin.z + s.z);
    e.prevPos = { ...e.pos };
    e.facing = s.facing;
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
    // Human-feel seeds (cosmetic): a per-NPC weave phase so the running sway is
    // desynced across the pack, and how far past the finish line this bot
    // coasts before it settles into the end-zone mill. Drawn once here from the
    // per-run stream, so the locomotion needs no per-tick rng.
    c.script.weavePhase = run.rng.range(0, Math.PI * 2);
    c.script.overshoot = run.rng.range(t.npcOvershootMin, t.npcOvershootMax);
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
// braking a beat after red), weaving a little as they go; fumblers overrun the
// grace window on their scripted flip and are knocked out where they stand.
// Once a bot crosses it coasts a couple yards past the line and mills there,
// so the field never freezes in a row on the finish mark.
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
    const s = c.script;
    const lz = e.pos.z - run.origin.z;
    // Past the line + its overshoot: mill in the end zone (a small idle lateral
    // sway, never dipping back below the finish line so the trial still
    // resolves) instead of standing frozen on the mark.
    if (lz >= t.fieldLength + s.overshoot) {
      millPastLine(ctx, run, c, e, dt);
      continue;
    }
    if (s.planKey !== key) replanNpcWindow(run, c, trial, key, ctx.time);
    const fumbling =
      trial.light === 'red' && s.fumbleOnFlip !== null && s.fumbleOnFlip <= trial.flipCount;
    // A scripted fumbler dawdles short of the line until its flip arrives, so
    // it can never cross early and dodge its own script.
    const dawdling = s.fumbleOnFlip !== null && lz >= t.fieldLength * 0.9 && !fumbling;
    // Once over the line a survivor is safe: it keeps coasting to its overshoot
    // mark regardless of the light (the red catch is a player-only rule).
    const crossedLine = lz >= t.fieldLength;
    const pausing = s.pauseUntil > s.pauseAt && ctx.time >= s.pauseAt && ctx.time < s.pauseUntil;
    const advancing = crossedLine
      ? true
      : fumbling
        ? true
        : trial.light === 'green'
          ? ctx.time >= s.goAt && !pausing
          : ctx.time < s.stopAt; // brake lag; scripts, not detection, catch NPCs
    if (advancing && !dawdling) {
      e.prevPos = { ...e.pos };
      e.pos.z += s.speed * s.mult * dt;
      // Weave: a small lateral sway while genuinely running forward (on green,
      // or coasting past the line), never while stopped on red (that would read
      // as moving on the red light). Forward z pace is untouched, so the weave
      // is purely cosmetic curvature, not slower progress.
      if (crossedLine || (trial.light === 'green' && !fumbling)) {
        const sway = Math.sin(ctx.time * t.npcWeaveFreq + s.weavePhase) * t.npcWeaveAmp * dt;
        e.pos.x = clampFieldX(run, e.pos.x + sway, t.fieldHalfWidth);
      }
      // Face where the body is actually moving, so the slight weave shows as a
      // gentle turn rather than a straight-ahead slide.
      e.facing = Math.atan2(e.pos.x - e.prevPos.x, e.pos.z - e.prevPos.z);
    }
    // The fumbler is caught once its overrun outlives the grace window.
    if (fumbling && ctx.time >= trial.graceUntil) {
      applyVitalityDamage(ctx, run, c, c.vitality, 'caught');
    }
  }
}

// The end-zone mill for a bot that has crossed and overshot the line: a gentle
// lateral sway around its current lane (Math.sin off the seeded phase, so no
// rng and fully deterministic), clamped to the field width and never allowed
// back over the finish line. Cosmetic only; z holds where it settled.
function millPastLine(
  ctx: SimContext,
  run: GauntletRun,
  c: GauntletContestant,
  e: Entity,
  dt: number,
): void {
  const t = GAUNTLET.sentinel;
  const s = c.script;
  const sway = Math.cos(ctx.time * t.npcWeaveFreq * 0.5 + s.weavePhase) * t.npcMillAmp * dt;
  e.prevPos = { ...e.pos };
  e.pos.x = clampFieldX(run, e.pos.x + sway, t.fieldHalfWidth);
  e.facing = Math.atan2(e.pos.x - e.prevPos.x, e.pos.z - e.prevPos.z);
}

// Keep a contestant within the field's lateral bounds (instance-local |x| <=
// halfWidth), the same clamp the player detection applies in trial_sentinel.
function clampFieldX(run: GauntletRun, x: number, halfWidth: number): number {
  const lo = run.origin.x - halfWidth;
  const hi = run.origin.x + halfWidth;
  return x < lo ? lo : x > hi ? hi : x;
}
