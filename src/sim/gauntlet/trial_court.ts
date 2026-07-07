// Trial 6, The Final Court: the closing squid-court duel. Each surviving player
// fights in their own lane. The ATTACKER tries to walk the length of the court
// and plant a foot in the head zone at the far end; the DEFENDER tries to shove
// them out of bounds (a fighter pushed outside the court loses outright). Roles
// swap on a timer, so both sides play both parts. Two live players share one
// lane (each is the other's rival); a solo player duels the strongest surviving
// NPC. Damage lands on the run's event vitality, never entity hp.
//
// Instance-local geometry, anchored on GAUNTLET_VENUE.court. Determinism: every
// draw comes from run.rng (the first-attacker coin at setup, the NPC shove
// jitter mid-trial), in fixed duel-insertion order; the shared sim stream is
// never touched. Movement is direct entity-position writes (the contestant
// idiom), post-processed after the core movement pass exactly like the sentinel
// trial (prevPos is the tick-start position, so displacement is this tick's
// move).

import { GAUNTLET, GAUNTLET_VENUE } from '../content/gauntlet';
import type { SimContext } from '../sim_context';
import type { Entity, Vec3 } from '../types';
import { placeContestantsAt } from './contestants';
import type {
  GauntletContestant,
  GauntletCourtDuel,
  GauntletCourtState,
  GauntletRun,
} from './state';
import { aliveContestants, applyVitalityDamage, cullNpcsToward } from './vitality';

// Lateral spacing between duel lanes (yards). Not a court balance knob: pure
// venue geometry so parallel duels never overlap, so it lives here, not in
// GAUNTLET.court.
const LANE_SPACING = 18;
// Base NPC rival move speed (yards/sec), in the same league as a player's
// RUN_SPEED. Also geometry/AI feel rather than a court balance knob, so local.
const NPC_DUEL_SPEED = 4.5;

// The instance-local z of the court entry line (z0) and head-zone line (z1).
// The court runs along +z: attacker starts near z0, the head zone is the far
// 2yd-deep strip at z1.
function courtZ(): { z0: number; z1: number } {
  const t = GAUNTLET.court;
  const z0 = GAUNTLET_VENUE.court.z - t.courtLength / 2;
  return { z0, z1: z0 + t.courtLength };
}

function laneXFor(k: number, duelCount: number): number {
  return GAUNTLET_VENUE.court.x + (k - (duelCount - 1) / 2) * LANE_SPACING;
}

export function startCourt(ctx: SimContext, run: GauntletRun): GauntletCourtState {
  const t = GAUNTLET.court;
  const anchor = GAUNTLET_VENUE.court;
  placeContestantsAt(ctx, run, anchor.x, anchor.z, 6);
  const trial: GauntletCourtState = { kind: 'court', duels: new Map() };

  const players = aliveContestants(run).filter(
    (c) => c.player && !run.playerStates.get(c.entityId)?.spectating,
  );
  // Strongest surviving NPCs first: solo players draw their rival off the top.
  const npcs = aliveContestants(run)
    .filter((c) => !c.player)
    .sort((a, b) => b.skill - a.skill);

  // Pair players two at a time; an odd/solo player duels the strongest NPC.
  const pairings: { a: GauntletContestant; b: GauntletContestant | null }[] = [];
  for (let i = 0; i < players.length; i += 2) {
    pairings.push({ a: players[i], b: players[i + 1] ?? null });
  }
  const duelCount = pairings.length;
  const usedNpc = new Set<number>();
  let npcCursor = 0;
  for (let k = 0; k < pairings.length; k++) {
    const { a, b } = pairings[k];
    const laneX = laneXFor(k, duelCount);
    if (b) {
      // Two players share the lane: one duel, two mirrored entries. A coin
      // picks who attacks first (the only setup draw for a player pairing).
      const aAttacks = run.rng.chance(0.5);
      trial.duels.set(
        a.entityId,
        newDuel(ctx, a.entityId, b.entityId, b.entityId, aAttacks, laneX),
      );
      trial.duels.set(
        b.entityId,
        newDuel(ctx, b.entityId, a.entityId, a.entityId, !aAttacks, laneX),
      );
    } else {
      // Solo player: duel the strongest unused NPC and attack first (better
      // feel). Rare edge (a field with no NPCs left): the player has no rival,
      // which resolves the trial immediately with them as champion.
      const rival = npcs[npcCursor++];
      if (!rival) continue;
      usedNpc.add(rival.entityId);
      trial.duels.set(a.entityId, newDuel(ctx, a.entityId, rival.entityId, null, true, laneX));
    }
  }

  for (const duel of trial.duels.values()) placeDuelFighters(ctx, run, duel);
  // Every NPC not drafted as a rival just watches from behind the entry line.
  poseWatchers(ctx, run, usedNpc);
  return trial;
}

function newDuel(
  ctx: SimContext,
  pid: number,
  rivalId: number,
  rivalPid: number | null,
  attacker: boolean,
  laneX: number,
): GauntletCourtDuel {
  const t = GAUNTLET.court;
  return {
    pid,
    rivalId,
    rivalPid,
    attacker,
    swapAt: ctx.time + t.roleSwapS,
    shoveReadyAt: 0,
    // A short opening beat before the NPC rival can first shove.
    rivalShoveAt: ctx.time + t.rivalReactionS * 2,
    laneX,
    done: false,
    won: false,
  };
}

// The player's shove command. Off-cooldown, if the rival is within range,
// knock them back and chip their vitality; a whiff still starts the cooldown.
export function gauntletCourtShove(
  ctx: SimContext,
  run: GauntletRun,
  trial: GauntletCourtState,
  pid: number,
): void {
  const duel = trial.duels.get(pid);
  if (!duel || duel.done) return;
  if (ctx.time < duel.shoveReadyAt) return; // still cooling down
  const t = GAUNTLET.court;
  duel.shoveReadyAt = ctx.time + t.shoveCooldownS; // whiffs are punished too
  const e = ctx.entities.get(pid);
  const rival = ctx.entities.get(duel.rivalId);
  if (!e || !rival) return;
  const d = Math.hypot(rival.pos.x - e.pos.x, rival.pos.z - e.pos.z);
  if (d > t.shoveRange) return; // out of range: cooldown already spent
  pushAway(ctx, rival, e.pos.x, e.pos.z, t.shovePush);
  const rivalC = run.contestants.find((c) => c.entityId === duel.rivalId);
  if (rivalC) applyVitalityDamage(ctx, run, rivalC, t.shoveDamage, 'caught');
}

export function updateCourt(ctx: SimContext, run: GauntletRun, dt: number): boolean {
  const trial = run.trial;
  if (!trial || trial.kind !== 'court') return true;

  // Trial cap: resolve every open duel by position. SIMPLEST DETERMINISTIC
  // RULE: the current ATTACKER wins if their progress has passed the neck,
  // else the DEFENDER wins. Then cull and end.
  if (ctx.time >= run.phaseEndsAt) {
    for (const duel of trial.duels.values()) {
      if (!duel.done) resolveByCap(ctx, run, trial, duel);
    }
    cullNpcsToward(ctx, run);
    return true;
  }

  for (const duel of trial.duels.values()) {
    if (duel.done) continue;
    // NPC rival AI moves first so positions are current for resolution.
    if (duel.rivalPid === null) updateNpcRival(ctx, run, duel, dt);
    // The pre-neck one-foot rule for a PLAYER attacker.
    if (duel.attacker) clampPreNeckPlayer(ctx, run, duel);
    resolveByPosition(ctx, run, trial, duel);
    if (duel.done) continue;
    // Role swap: flip sides and reset to the opening poses.
    if (ctx.time >= duel.swapAt) {
      duel.attacker = !duel.attacker;
      duel.swapAt += GAUNTLET.court.roleSwapS;
      placeDuelFighters(ctx, run, duel);
    }
  }

  let allDone = true;
  for (const duel of trial.duels.values()) if (!duel.done) allDone = false;
  if (allDone) {
    // Losers are already knocked out; thin the watching field to one champion.
    cullNpcsToward(ctx, run);
    return true;
  }
  return false;
}

// The pre-neck penalty: while the attacker's progress from z0 is short of the
// neck, scale this tick's displacement back to preNeckSpeedMult (post-process
// like the sentinel momentum code). A PLAYER attacker only.
function clampPreNeckPlayer(ctx: SimContext, run: GauntletRun, duel: GauntletCourtDuel): void {
  const t = GAUNTLET.court;
  const { z0 } = courtZ();
  const e = ctx.entities.get(duel.pid);
  if (!e) return;
  const startProg = e.prevPos.z - run.origin.z - z0;
  if (startProg >= t.neckZ) return; // past the neck: full speed
  e.pos.x = e.prevPos.x + (e.pos.x - e.prevPos.x) * t.preNeckSpeedMult;
  e.pos.z = e.prevPos.z + (e.pos.z - e.prevPos.z) * t.preNeckSpeedMult;
  e.pos.y = ctx.groundPos(e.pos.x, e.pos.z).y;
  ctx.rebucket(e);
}

// One NPC rival's tick: move toward its objective, then shove the player when
// in range and off its own reaction cooldown.
function updateNpcRival(
  ctx: SimContext,
  run: GauntletRun,
  duel: GauntletCourtDuel,
  dt: number,
): void {
  const t = GAUNTLET.court;
  const { z0, z1 } = courtZ();
  const npc = ctx.entities.get(duel.rivalId);
  const player = ctx.entities.get(duel.pid);
  if (!npc || !player) return;
  const rivalAttacks = !duel.attacker; // the rival's role is the player's opposite
  let tx: number;
  let tz: number;
  let speed: number;
  if (rivalAttacks) {
    // Advance up the lane toward the head zone, obeying the pre-neck rule.
    const prog = npc.pos.z - run.origin.z - z0;
    speed = NPC_DUEL_SPEED * (prog < t.neckZ ? t.preNeckSpeedMult : 1);
    tx = run.origin.x + duel.laneX;
    tz = run.origin.z + z1;
  } else {
    // Defend: hold a point between the player and the head zone to intercept.
    speed = NPC_DUEL_SPEED;
    tx = run.origin.x + duel.laneX;
    tz = (player.pos.z + (run.origin.z + z1)) / 2;
  }
  stepToward(ctx, npc, tx, tz, speed * dt);

  if (ctx.time < duel.rivalShoveAt) return;
  const d = Math.hypot(player.pos.x - npc.pos.x, player.pos.z - npc.pos.z);
  if (d > t.shoveRange) return;
  pushAway(ctx, player, npc.pos.x, npc.pos.z, t.shovePush);
  const pc = run.contestants.find((c) => c.entityId === duel.pid);
  if (pc) applyVitalityDamage(ctx, run, pc, t.shoveDamage, 'caught');
  // One jitter draw per landed shove for texture (deterministic order).
  duel.rivalShoveAt = ctx.time + t.shoveCooldownS + run.rng.range(0, t.rivalReactionS);
}

// Head-zone win + out-of-bounds loss for one duel this tick.
function resolveByPosition(
  ctx: SimContext,
  run: GauntletRun,
  trial: GauntletCourtState,
  duel: GauntletCourtDuel,
): void {
  const t = GAUNTLET.court;
  const { z0, z1 } = courtZ();
  // Head zone: the ATTACKER reaching z >= z1 inside the lane width wins.
  const attackerId = duel.attacker ? duel.pid : duel.rivalId;
  const ae = ctx.entities.get(attackerId);
  if (ae) {
    const lz = ae.pos.z - run.origin.z;
    const lx = ae.pos.x - run.origin.x;
    if (lz >= z1 && Math.abs(lx - duel.laneX) <= t.courtHalfWidth) {
      resolveDuel(ctx, run, trial, duel, duel.attacker); // attacker wins
      return;
    }
  }
  // Out of bounds: whichever fighter left the court loses outright.
  const fighters: [number, boolean][] = [
    [duel.pid, true], // the player
    [duel.rivalId, false], // the rival
  ];
  for (const [fid, isPlayer] of fighters) {
    const e = ctx.entities.get(fid);
    if (!e) continue;
    const lz = e.pos.z - run.origin.z;
    const lx = e.pos.x - run.origin.x;
    const out = Math.abs(lx - duel.laneX) > t.courtHalfWidth || lz < z0 - 2 || lz > z1 + 2;
    if (!out) continue;
    // The fighter who left takes the out chunk, then the duel goes against them.
    const c = run.contestants.find((k) => k.entityId === fid);
    if (c) applyVitalityDamage(ctx, run, c, t.outDamage, 'caught');
    resolveDuel(ctx, run, trial, duel, !isPlayer); // the player wins iff the rival went out
    return;
  }
}

// The cap tie-break: attacker wins iff past the neck, else the defender wins.
function resolveByCap(
  ctx: SimContext,
  run: GauntletRun,
  trial: GauntletCourtState,
  duel: GauntletCourtDuel,
): void {
  const t = GAUNTLET.court;
  const { z0 } = courtZ();
  const attackerId = duel.attacker ? duel.pid : duel.rivalId;
  const ae = ctx.entities.get(attackerId);
  const attackerWins = ae ? ae.pos.z - run.origin.z - z0 >= t.neckZ : false;
  resolveDuel(ctx, run, trial, duel, duel.attacker ? attackerWins : !attackerWins);
}

// Close a duel: knock out the loser (their remaining vitality, as 'trial'),
// mark the winner's finish, and mirror the outcome onto the rival's entry when
// the rival is another player.
function resolveDuel(
  ctx: SimContext,
  run: GauntletRun,
  trial: GauntletCourtState,
  duel: GauntletCourtDuel,
  pidWon: boolean,
): void {
  if (duel.done) return;
  duel.done = true;
  duel.won = pidWon;
  const playerC = run.contestants.find((c) => c.entityId === duel.pid);
  const rivalC = run.contestants.find((c) => c.entityId === duel.rivalId);
  if (pidWon) {
    markFinished(ctx, run, duel.pid);
    if (rivalC) applyVitalityDamage(ctx, run, rivalC, rivalC.vitality, 'trial');
    closeMirror(ctx, run, trial, duel.rivalPid, false);
  } else {
    if (playerC) applyVitalityDamage(ctx, run, playerC, playerC.vitality, 'trial');
    closeMirror(ctx, run, trial, duel.rivalPid, true);
  }
}

function markFinished(ctx: SimContext, run: GauntletRun, pid: number): void {
  const ps = run.playerStates.get(pid);
  if (ps && ps.finishedAt === null) ps.finishedAt = ctx.time;
}

// Close the paired player's mirror entry with the opposite result (PvP only).
function closeMirror(
  ctx: SimContext,
  run: GauntletRun,
  trial: GauntletCourtState,
  rivalPid: number | null,
  rivalWon: boolean,
): void {
  if (rivalPid === null) return;
  const rd = trial.duels.get(rivalPid);
  if (!rd || rd.done) return;
  rd.done = true;
  rd.won = rivalWon;
  if (rivalWon) markFinished(ctx, run, rivalPid);
}

// Place both fighters of a duel at their opening poses: attacker just inside
// the entry line, defender mid-court, facing each other. Only the NPC rival is
// repositioned here; a player rival has its own entry that poses it.
function placeDuelFighters(ctx: SimContext, run: GauntletRun, duel: GauntletCourtDuel): void {
  poseFighter(ctx, run, duel.pid, duel.laneX, duel.attacker);
  if (duel.rivalPid === null) poseFighter(ctx, run, duel.rivalId, duel.laneX, !duel.attacker);
}

function poseFighter(
  ctx: SimContext,
  run: GauntletRun,
  id: number,
  laneX: number,
  attacker: boolean,
): void {
  const t = GAUNTLET.court;
  const { z0 } = courtZ();
  const e = ctx.entities.get(id);
  if (!e) return;
  const localZ = attacker ? z0 + 1 : z0 + t.courtLength / 2;
  e.pos = ctx.groundPos(run.origin.x + laneX, run.origin.z + localZ);
  e.prevPos = cloneVec(e.pos);
  e.facing = attacker ? 0 : Math.PI; // attacker faces +z (the head zone), defender faces it back
  ctx.rebucket(e);
}

// Cosmetic: park the undrafted NPCs in rows behind the entry line, out of every
// lane's play bounds, facing the court. Deterministic (no rng).
function poseWatchers(ctx: SimContext, run: GauntletRun, usedNpc: Set<number>): void {
  const anchor = GAUNTLET_VENUE.court;
  const { z0 } = courtZ();
  const watchers = aliveContestants(run).filter((c) => !c.player && !usedNpc.has(c.entityId));
  for (let i = 0; i < watchers.length; i++) {
    const e = ctx.entities.get(watchers[i].entityId);
    if (!e) continue;
    const row = Math.floor(i / 8);
    const col = i % 8;
    e.pos = ctx.groundPos(
      run.origin.x + anchor.x + (col - 3.5) * 3,
      run.origin.z + z0 - 6 - row * 2.5,
    );
    e.prevPos = cloneVec(e.pos);
    e.facing = 0;
    ctx.rebucket(e);
  }
}

// Step an entity toward a world point by up to `dist` yards, facing the move.
function stepToward(ctx: SimContext, e: Entity, tx: number, tz: number, dist: number): void {
  const dx = tx - e.pos.x;
  const dz = tz - e.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6 || dist <= 0) return;
  const step = Math.min(dist, d);
  e.prevPos = cloneVec(e.pos);
  e.pos.x += (dx / d) * step;
  e.pos.z += (dz / d) * step;
  e.pos.y = ctx.groundPos(e.pos.x, e.pos.z).y;
  e.facing = Math.atan2(dx, dz);
  ctx.rebucket(e);
}

// Knock an entity `dist` yards directly away from a source point on the xz
// plane (a shove). Overlapping fighters get a stable default push (+z).
function pushAway(ctx: SimContext, e: Entity, fromX: number, fromZ: number, dist: number): void {
  let dx = e.pos.x - fromX;
  let dz = e.pos.z - fromZ;
  let d = Math.hypot(dx, dz);
  if (d < 1e-6) {
    dx = 0;
    dz = 1;
    d = 1;
  }
  e.prevPos = cloneVec(e.pos);
  e.pos.x += (dx / d) * dist;
  e.pos.z += (dz / d) * dist;
  e.pos.y = ctx.groundPos(e.pos.x, e.pos.z).y;
  ctx.rebucket(e);
}

function cloneVec(v: Vec3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}
