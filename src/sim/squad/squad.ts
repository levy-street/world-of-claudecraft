// The Last Bell squad roster: N named actors that fight beside a party
// inside a story instance. Generalizes the delve companion's one-ally brain
// (src/sim/delves/companion.ts: follow, target pick, swing, heal, teleport
// recovery) into a directive-driven multi-actor system, following the escort
// module's house rules (src/sim/escort.ts): actors are ordinary non-hostile
// mob entities riding the normal snapshot wire, spawn placement and levels
// draw NO rng (fixed levels, evenly spaced ring), the generic mob AI never
// touches them (the inert arm in mob/locomotion.ts keys on squadActorId),
// and players heal them through a Sim.isFriendlyTo arm but can never attack
// them.
//
// Directives are the scenario sequencer's handle on an actor:
//   follow: trail a unit (a player, or the nearest living party member)
//   hold:   stand ground at a point, fighting what comes into reach
//   station: man a story object (the finale's ward stations): fight only in
//            self-defense reach and never leave the post
//
// The scripted floor (squadFloor, applied in combat/damage.ts) keeps a
// story-critical actor from dying to ambient damage: lethal damage clamps
// to 1 hp and marks the actor DOWNED (it stops acting until a living player
// comes within relief range). Q10's station-relief loop is this mechanic at
// full stakes. The floor is per-run and the scenario can drop it.
//
// Group scaling: an actor's outgoing damage is multiplied down as the human
// player count rises, so extra players never trivialize an encounter while
// the squad stays visibly competent (spec: the squad's damage SHARE falls).

import { LAST_BELL_SQUAD_ACTORS, LAST_BELL_SQUAD_MOBS } from '../content/last_bell_squad';
import { createMob } from '../entity';
import type { SimContext } from '../sim_context';
import { DT, dist2d, type Entity, MELEE_RANGE, steadyAngleTo } from '../types';

export type SquadDirective =
  | { kind: 'follow'; pid: number | null }
  | { kind: 'hold'; x: number; z: number }
  | { kind: 'station'; x: number; z: number; facing?: number };

export interface SquadRun {
  /** The owning instance claim identity (InstanceSlot.exitId). */
  claimId: number;
  dungeonId: string;
  /** actor id -> live entity id */
  actorIds: Map<string, number>;
  directives: Map<string, SquadDirective>;
  /** While true, lethal damage on any actor clamps to the 1 hp floor. */
  floorEnabled: boolean;
  /** Outgoing-damage multiplier from the human player count at spawn. */
  damageMult: number;
}

const SQUAD_FOLLOW_DISTANCE = 4.5;
// Actor templates carry moveSpeed 0 (the escortee contract: generic mob AI
// never moves them); the squad brain supplies the real walk speed.
const SQUAD_MOVE_SPEED = 9;
const SQUAD_TELEPORT_DISTANCE = 60;
const SQUAD_ENGAGE_RANGE = 30;
// A stationed actor never chases: it fights only what stands this close.
const SQUAD_STATION_LEASH = 10;
const SQUAD_RANGED_STANDOFF = 22;
const SQUAD_HEAL_RANGE = 22;
const SQUAD_HEAL_INTERVAL = 2.0;
const SQUAD_HEAL_PCT = 0.08;
// A downed actor is relieved by a living player standing this close.
export const SQUAD_RELIEF_RANGE = 3.0;
const SQUAD_RELIEF_HP_FRACTION = 0.35;
// The damage share falls as humans join: 1 player 1.0, 2 players ~0.74,
// 5 players ~0.42.
function squadDamageMultFor(humanCount: number): number {
  return 1 / (1 + 0.35 * (Math.max(1, humanCount) - 1));
}

export function spawnSquad(
  ctx: SimContext,
  opts: {
    claimId: number;
    dungeonId: string;
    anchor: { x: number; z: number };
    actorIds: readonly string[];
    humanCount: number;
    floorEnabled?: boolean;
  },
): SquadRun | null {
  if (ctx.squadRuns.has(opts.claimId)) return ctx.squadRuns.get(opts.claimId) ?? null;
  const run: SquadRun = {
    claimId: opts.claimId,
    dungeonId: opts.dungeonId,
    actorIds: new Map(),
    directives: new Map(),
    floorEnabled: opts.floorEnabled ?? true,
    damageMult: squadDamageMultFor(opts.humanCount),
  };
  for (let i = 0; i < opts.actorIds.length; i++) {
    const actorId = opts.actorIds[i];
    const def = LAST_BELL_SQUAD_ACTORS[actorId];
    const template = def ? LAST_BELL_SQUAD_MOBS[def.mobTemplateId] : undefined;
    if (!def || !template) continue;
    // Evenly spaced arc behind the anchor, rng-free (escort ambush pattern).
    const angle = Math.PI + ((i - (opts.actorIds.length - 1) / 2) * Math.PI) / 6;
    const pos = ctx.groundPos(
      opts.anchor.x + Math.sin(angle) * 3,
      opts.anchor.z + Math.cos(angle) * 3,
    );
    const actor = createMob(ctx.nextId++, template, template.minLevel, pos);
    actor.hostile = false;
    actor.squadActorId = actorId;
    actor.squadClaimId = opts.claimId;
    actor.squadFloor = run.floorEnabled;
    actor.squadDamageMult = run.damageMult;
    ctx.addEntity(actor);
    run.actorIds.set(actorId, actor.id);
    run.directives.set(actorId, { kind: 'follow', pid: null });
  }
  ctx.squadRuns.set(opts.claimId, run);
  return run;
}

export function despawnSquad(ctx: SimContext, claimId: number): void {
  const run = ctx.squadRuns.get(claimId);
  if (!run) return;
  for (const entityId of run.actorIds.values()) {
    if (ctx.entities.has(entityId)) ctx.dropEntity(entityId);
  }
  ctx.squadRuns.delete(claimId);
}

export function setSquadDirective(
  ctx: SimContext,
  claimId: number,
  actorId: string,
  directive: SquadDirective,
): void {
  ctx.squadRuns.get(claimId)?.directives.set(actorId, directive);
}

export function squadActorEntity(ctx: SimContext, claimId: number, actorId: string): Entity | null {
  const entityId = ctx.squadRuns.get(claimId)?.actorIds.get(actorId);
  return entityId !== undefined ? (ctx.entities.get(entityId) ?? null) : null;
}

// True while this entity is a live squad actor (the heal-target arm in
// Sim.isFriendlyTo: players can mend the squad, never strike it).
export function isSquadActor(e: Entity): boolean {
  return e.squadActorId !== undefined;
}

// Players inside this run's instance footprint: the squad's allies.
function squadAllies(ctx: SimContext, run: SquadRun): Entity[] {
  const out: Entity[] = [];
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (p && !p.dead && p.squadClaimId === undefined) out.push(p);
  }
  return out.filter((p) => nearRun(ctx, run, p));
}

function nearRun(ctx: SimContext, run: SquadRun, e: Entity): boolean {
  // Any run actor within interest range anchors "near": cheap and stable.
  for (const entityId of run.actorIds.values()) {
    const actor = ctx.entities.get(entityId);
    if (actor && dist2d(actor.pos, e.pos) < 130) return true;
  }
  return false;
}

function directiveAnchor(
  ctx: SimContext,
  run: SquadRun,
  actor: Entity,
  directive: SquadDirective,
): { x: number; z: number } | null {
  if (directive.kind === 'hold' || directive.kind === 'station') {
    return { x: directive.x, z: directive.z };
  }
  if (directive.pid !== null) {
    const unit = ctx.entities.get(directive.pid);
    if (unit && !unit.dead) return { x: unit.pos.x, z: unit.pos.z };
  }
  // follow with no explicit unit: the nearest living ally.
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const ally of squadAllies(ctx, run)) {
    const d = dist2d(actor.pos, ally.pos);
    if (d < bestD) {
      best = ally;
      bestD = d;
    }
  }
  return best ? { x: best.pos.x, z: best.pos.z } : null;
}

function pickTarget(ctx: SimContext, run: SquadRun, actor: Entity, leash: number): Entity | null {
  let best: Entity | null = null;
  let bestD = leash;
  for (const m of ctx.entities.values()) {
    if (m.kind !== 'mob' || m.dead || !m.hostile || m.squadActorId !== undefined) continue;
    const d = dist2d(actor.pos, m.pos);
    if (d >= bestD) continue;
    // Engage what is fighting the squad's fight: an ally (player or actor)
    // on its hate table or in its sights, or the mob pressing this actor.
    const engaged =
      m.aggroTargetId !== null &&
      (m.aggroTargetId === actor.id ||
        [...run.actorIds.values()].includes(m.aggroTargetId) ||
        ctx.players.has(m.aggroTargetId));
    const threatening = m.threat.size > 0;
    if (!engaged && !threatening) continue;
    best = m;
    bestD = d;
  }
  return best;
}

function relieveDownedActor(ctx: SimContext, actor: Entity): void {
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (!p || p.dead) continue;
    if (dist2d(p.pos, actor.pos) <= SQUAD_RELIEF_RANGE) {
      actor.squadDowned = false;
      actor.hp = Math.max(1, Math.round(actor.maxHp * SQUAD_RELIEF_HP_FRACTION));
      ctx.emit({ type: 'heal', targetId: actor.id, amount: actor.hp });
      return;
    }
  }
}

function updateActor(ctx: SimContext, run: SquadRun, actorId: string, actor: Entity): void {
  const def = LAST_BELL_SQUAD_ACTORS[actorId];
  if (!def) return;
  if (actor.dead) return;
  if (actor.squadDowned) {
    relieveDownedActor(ctx, actor);
    return;
  }
  const directive = run.directives.get(actorId) ?? { kind: 'follow' as const, pid: null };
  const anchor = directiveAnchor(ctx, run, actor, directive);
  actor.swingTimer = (actor.swingTimer ?? 0) - DT;

  // Healer duty runs on its own clock, whatever the stance.
  if (def.role === 'healer') {
    actor.wanderTimer = (actor.wanderTimer ?? 0) - DT;
    if (actor.wanderTimer <= 0) {
      actor.wanderTimer = SQUAD_HEAL_INTERVAL;
      const candidates: Entity[] = [...squadAllies(ctx, run)];
      for (const entityId of run.actorIds.values()) {
        const mate = ctx.entities.get(entityId);
        if (mate && !mate.dead && mate.id !== actor.id) candidates.push(mate);
      }
      let healTarget: Entity | null = null;
      let lowest = 1;
      for (const e of candidates) {
        const frac = e.hp / Math.max(1, e.maxHp);
        if (frac < 1 && frac < lowest && dist2d(actor.pos, e.pos) <= SQUAD_HEAL_RANGE) {
          healTarget = e;
          lowest = frac;
        }
      }
      if (healTarget) {
        const healed = Math.min(
          healTarget.maxHp - healTarget.hp,
          Math.round(healTarget.maxHp * SQUAD_HEAL_PCT),
        );
        healTarget.hp += healed;
        ctx.emit({ type: 'heal', targetId: healTarget.id, amount: healed });
        ctx.emit({
          type: 'spellfx',
          sourceId: actor.id,
          targetId: healTarget.id,
          school: 'holy',
          fx: 'tick',
        });
      }
    }
  }

  const leash = directive.kind === 'station' ? SQUAD_STATION_LEASH : SQUAD_ENGAGE_RANGE;
  const target = def.role === 'healer' ? null : pickTarget(ctx, run, actor, leash);
  if (target) {
    actor.inCombat = true;
    const ranged = def.role === 'ranged' && def.bolt;
    const reach = ranged ? SQUAD_RANGED_STANDOFF : MELEE_RANGE * 0.9;
    const d = dist2d(actor.pos, target.pos);
    if (ranged && d <= SQUAD_RANGED_STANDOFF + 6) {
      actor.facing = steadyAngleTo(actor.pos, target.pos, actor.facing);
      if (actor.swingTimer <= 0 && def.bolt) {
        ctx.updateRangedPetAttack(actor, target, def.bolt);
        actor.swingTimer = actor.weapon.speed * ctx.swingIntervalMult(actor);
      }
    } else if (d > reach) {
      // A stationed actor never chases past its post.
      if (directive.kind !== 'station' && !ctx.isRooted(actor)) {
        ctx.moveToward(actor, target.pos, SQUAD_MOVE_SPEED * ctx.moveSpeedMult(actor));
      }
    } else {
      actor.facing = steadyAngleTo(actor.pos, target.pos, actor.facing);
      if (actor.swingTimer <= 0) {
        ctx.mobSwing(actor, target);
        actor.swingTimer = actor.weapon.speed * ctx.swingIntervalMult(actor);
      }
    }
    if (directive.kind === 'follow') return; // fight where you stand
  } else {
    actor.inCombat = false;
  }

  if (!anchor) return;
  const d = Math.hypot(actor.pos.x - anchor.x, actor.pos.z - anchor.z);
  if (d > SQUAD_TELEPORT_DISTANCE) {
    actor.pos = ctx.groundPos(anchor.x, anchor.z);
    actor.prevPos = { ...actor.pos };
    ctx.rebucket(actor);
    return;
  }
  const settle = directive.kind === 'follow' ? SQUAD_FOLLOW_DISTANCE : 0.8;
  if (d > settle && !ctx.isRooted(actor) && !target) {
    ctx.moveToward(actor, ctx.groundPos(anchor.x, anchor.z), SQUAD_MOVE_SPEED);
  } else if (directive.kind === 'station' && directive.facing !== undefined && !target) {
    actor.facing = directive.facing;
  }
}

// Per-tick driver, called from the Sim tick body after escorts. Zero work
// (and zero rng) while no squad is live, so the shared draw order never
// moves for the existing world.
export function updateSquads(ctx: SimContext): void {
  for (const run of ctx.squadRuns.values()) {
    for (const [actorId, entityId] of run.actorIds) {
      const actor = ctx.entities.get(entityId);
      if (!actor) continue;
      updateActor(ctx, run, actorId, actor);
    }
  }
}
