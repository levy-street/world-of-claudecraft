// Escort runs: a quest NPC that walks an authored waypoint path while scripted
// ambush waves attack it, the classic MMO escort quest. Defs are data-as-code
// (EscortDef in the realm content modules, merged into ESCORTS by data.ts);
// this module owns the whole lifecycle behind the SimContext seam:
//
//   idle -> (interact with the quest active) -> walking -> ambush (paused
//   until the wave is dead) -> ... -> final waypoint -> credit + despawn ->
//   respawn after def.respawnSeconds. Escortee death fails the run the same
//   respawn way, so the quest is simply retried.
//
// The escortee is an ordinary non-hostile mob entity, so it rides the normal
// entity snapshot to clients with no new wire plumbing. Players cannot attack
// it (isHostileTo returns target.hostile) but may heal it while a run is live
// (the escort arm in Sim.isFriendlyTo consults isActiveEscortee below). Ambush
// mobs are ordinary hostile mobs whose hate table is seeded on the escortee,
// mirroring social_aggro.ts: the pull-over rules then move them onto players
// who engage. Spawn placement and levels draw NO rng, so the shared draw order
// (and with it the parity goldens) is unchanged by an escort running.
//
// src/sim-pure: no DOM/render imports, no Math.random/Date.now; reads world
// state through the SimContext seam only.

import { ESCORTS, MOBS, QUESTS } from './data';
import { createMob } from './entity';
import { emitMobYell } from './mob/yells';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { addThreat } from './threat';
import {
  dist2d,
  type Entity,
  type EscortDef,
  type EscortRunState,
  INTERACT_RANGE,
  questObjectiveRequired,
} from './types';

// Escortee mob templates, for the inert-walker arm in mob/locomotion.ts: an
// escortee is moved only by the escort driver, never wanders or fights, and
// the leaked-mob safety net must not re-hostile it (the Yumi-cat pattern).
export const ESCORT_NPC_TEMPLATE_IDS: ReadonlySet<string> = new Set(
  Object.values(ESCORTS).map((def) => def.npcMobId),
);

export function isEscortNpcTemplate(templateId: string): boolean {
  return ESCORT_NPC_TEMPLATE_IDS.has(templateId);
}

// The escortee counts as arrived at a waypoint inside this range (yards).
export const ESCORT_ARRIVE_RANGE = 2.5;
// Stuck-advance: a walking escortee that has not moved this far in
// ESCORT_STUCK_TICKS consecutive ticks (a collider pinning the approach)
// counts its current waypoint as reached instead of wedging the run into the
// timeout. Waypoints hug authored roads, so a pin only ever happens on the
// final yards into a prop-dense camp.
const ESCORT_STUCK_MOVE_EPSILON = 0.05;
const ESCORT_STUCK_TICKS = 80; // 4 seconds at 20 Hz
// Default ambush spawn ring radius around the escortee (yards).
export const ESCORT_AMBUSH_RADIUS = 5;
// A run that has not finished after this many sim seconds fails (a blocked
// path or an abandoned wave can otherwise wedge the escortee forever).
export const ESCORT_RUN_TIMEOUT = 600;
// Threat seeded on the escortee at ambush spawn: enough that the wave commits
// to the walk target, small enough that one player hit takes it over.
const ESCORT_SEED_THREAT = 1;

function escortState(ctx: SimContext, escortId: string): EscortRunState {
  let state = ctx.escortRuns.get(escortId);
  if (!state) {
    state = { escortId, npcId: null, respawnAt: 0, run: null };
    ctx.escortRuns.set(escortId, state);
  }
  return state;
}

function spawnEscortee(ctx: SimContext, def: EscortDef, state: EscortRunState): void {
  const template = MOBS[def.npcMobId];
  if (!template) return;
  const npc = createMob(
    ctx.nextId++,
    template,
    template.minLevel,
    ctx.groundPos(def.start.x, def.start.z),
  );
  npc.hostile = false;
  ctx.addEntity(npc);
  state.npcId = npc.id;
  state.respawnAt = 0;
  state.run = null;
}

// World-init hook: spawn every escort def's idle escortee. Runs after the rest
// of world generation and draws no rng, so existing spawns stay byte-stable.
export function initEscorts(ctx: SimContext): void {
  for (const def of Object.values(ESCORTS)) {
    spawnEscortee(ctx, def, escortState(ctx, def.id));
  }
}

// True while this entity is an escortee with a live run (the heal-target arm
// in Sim.isFriendlyTo). The map is a handful of defs, so the walk is cheap.
export function isActiveEscortee(ctx: SimContext, e: Entity): boolean {
  for (const state of ctx.escortRuns.values()) {
    if (state.npcId === e.id && state.run !== null) return true;
  }
  return false;
}

function idleEscortDefFor(ctx: SimContext, e: Entity): EscortDef | null {
  for (const state of ctx.escortRuns.values()) {
    if (state.npcId !== e.id || state.run !== null) continue;
    return ESCORTS[state.escortId] ?? null;
  }
  return null;
}

// Interact hook: if this player stands near an idle escortee whose quest they
// have active, start the run. Called with the player's explicit target first,
// then with a proximity scan fallback (interaction.ts). Returns true when a
// run started (the interact is consumed).
export function tryStartEscort(ctx: SimContext, p: Entity, meta: PlayerMeta): boolean {
  let best: { def: EscortDef; npc: Entity } | null = null;
  let bestD2 = INTERACT_RANGE * INTERACT_RANGE;
  for (const state of ctx.escortRuns.values()) {
    if (state.npcId === null || state.run !== null) continue;
    const npc = ctx.entities.get(state.npcId);
    if (!npc || npc.dead) continue;
    const dx = npc.pos.x - p.pos.x;
    const dz = npc.pos.z - p.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= bestD2) continue;
    const def = ESCORTS[state.escortId];
    if (!def) continue;
    if (meta.questLog.get(def.questId)?.state !== 'active') continue;
    best = { def, npc };
    bestD2 = d2;
  }
  if (!best) return false;
  const state = escortState(ctx, best.def.id);
  state.run = {
    waypointIndex: 0,
    startedAt: ctx.time,
    ambushIds: [],
    fired: [],
    lastX: best.npc.pos.x,
    lastZ: best.npc.pos.z,
    stuckTicks: 0,
  };
  emitMobYell(ctx, best.npc, best.def.startText);
  return true;
}

function fireAmbushes(ctx: SimContext, def: EscortDef, state: EscortRunState, npc: Entity): void {
  const run = state.run;
  if (!run) return;
  for (let a = 0; a < def.ambushes.length; a++) {
    const ambush = def.ambushes[a];
    if (ambush.atWaypoint !== run.waypointIndex || run.fired[a]) continue;
    run.fired[a] = true;
    const template = MOBS[ambush.mobId];
    if (!template) continue;
    const radius = ambush.radius ?? ESCORT_AMBUSH_RADIUS;
    for (let i = 0; i < ambush.count; i++) {
      // Evenly spaced ring, rng-free (see the header note on draw order).
      const angle = (i / ambush.count) * Math.PI * 2;
      const pos = ctx.groundPos(
        npc.pos.x + Math.sin(angle) * radius,
        npc.pos.z + Math.cos(angle) * radius,
      );
      const mob = createMob(ctx.nextId++, template, template.minLevel, pos);
      ctx.addEntity(mob);
      // Commit the wave to the escortee, social_aggro-style; player damage
      // out-threats the seed immediately via the normal pull-over rules.
      mob.aiState = 'chase';
      mob.aggroTargetId = npc.id;
      mob.inCombat = true;
      mob.leashAnchor = { ...mob.pos };
      addThreat(mob, npc.id, ESCORT_SEED_THREAT);
      run.ambushIds.push(mob.id);
    }
  }
}

function liveAmbushCount(ctx: SimContext, run: NonNullable<EscortRunState['run']>): number {
  let live = 0;
  for (const id of run.ambushIds) {
    const mob = ctx.entities.get(id);
    if (mob && !mob.dead) live++;
  }
  return live;
}

function endRun(
  ctx: SimContext,
  def: EscortDef,
  state: EscortRunState,
  npc: Entity | null,
  outcome: 'success' | 'fail',
): void {
  if (npc) emitMobYell(ctx, npc, outcome === 'success' ? def.successText : def.failText);
  // Surviving ambush mobs leave with the run (a failed wave never lingers to
  // camp the respawned escortee).
  for (const id of state.run?.ambushIds ?? []) {
    const mob = ctx.entities.get(id);
    if (mob && !mob.dead) ctx.dropEntity(id);
  }
  if (state.npcId !== null) ctx.dropEntity(state.npcId);
  state.npcId = null;
  state.run = null;
  state.respawnAt = ctx.time + def.respawnSeconds;
}

function creditEscort(ctx: SimContext, def: EscortDef, npc: Entity): void {
  const quest = QUESTS[def.questId];
  if (!quest) return;
  const objectiveIndex = quest.objectives.findIndex(
    (o) => o.type === 'escort' && o.escortId === def.id,
  );
  if (objectiveIndex < 0) return;
  const objective = quest.objectives[objectiveIndex];
  for (const meta of ctx.players.values()) {
    const qp = meta.questLog.get(def.questId);
    if (!qp || qp.state !== 'active') continue;
    const p = ctx.entities.get(meta.entityId);
    if (!p || p.dead || dist2d(p.pos, npc.pos) > def.creditRadius) continue;
    const required = questObjectiveRequired(quest, qp, objectiveIndex);
    if ((qp.counts[objectiveIndex] ?? 0) >= required) continue;
    qp.counts[objectiveIndex] = required;
    meta.counters.questProgress++;
    ctx.emit({
      type: 'questProgress',
      questId: qp.questId,
      objectiveIndex,
      current: qp.counts[objectiveIndex],
      required,
      text: `${objective.label}: ${qp.counts[objectiveIndex]}/${required}`,
      pid: meta.entityId,
    });
    ctx.checkQuestReady(qp, meta);
  }
}

// Per-tick driver, called from the Sim tick body. Runs are rare and the def
// set is small, so the whole pass is a few map lookups per tick.
export function updateEscorts(ctx: SimContext): void {
  for (const state of ctx.escortRuns.values()) {
    const def = ESCORTS[state.escortId];
    if (!def) continue;
    if (state.npcId === null) {
      if (state.respawnAt > 0 && ctx.time >= state.respawnAt) spawnEscortee(ctx, def, state);
      continue;
    }
    const run = state.run;
    if (!run) continue;
    const npc = ctx.entities.get(state.npcId);
    if (!npc || npc.dead) {
      endRun(ctx, def, state, npc ?? null, 'fail');
      continue;
    }
    if (ctx.time - run.startedAt > ESCORT_RUN_TIMEOUT) {
      endRun(ctx, def, state, npc, 'fail');
      continue;
    }
    // An ambush wave holds the walk: the escortee waits while any of its
    // attackers still stands.
    if (liveAmbushCount(ctx, run) > 0) continue;
    // Past the last waypoint with every wave down (a final-waypoint ambush
    // resolves here on the tick after its wave dies): the escort succeeds.
    if (run.waypointIndex >= def.waypoints.length) {
      creditEscort(ctx, def, npc);
      endRun(ctx, def, state, npc, 'success');
      continue;
    }
    const wp = def.waypoints[run.waypointIndex];
    const moved = Math.hypot(npc.pos.x - run.lastX, npc.pos.z - run.lastZ);
    if (moved < ESCORT_STUCK_MOVE_EPSILON) run.stuckTicks++;
    else run.stuckTicks = 0;
    run.lastX = npc.pos.x;
    run.lastZ = npc.pos.z;
    const arrived =
      Math.hypot(npc.pos.x - wp.x, npc.pos.z - wp.z) <= ESCORT_ARRIVE_RANGE ||
      run.stuckTicks >= ESCORT_STUCK_TICKS;
    if (arrived) {
      run.stuckTicks = 0;
      fireAmbushes(ctx, def, state, npc);
      run.waypointIndex++;
      continue;
    }
    ctx.moveToward(npc, ctx.groundPos(wp.x, wp.z), def.moveSpeed);
  }
}
