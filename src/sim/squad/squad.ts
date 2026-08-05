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
  /** Entity-id membership mirror for allocation-free hostile engagement tests. */
  actorEntityIds: Set<number>;
  directives: Map<string, SquadDirective>;
  /** While true, lethal damage on any actor clamps to the 1 hp floor. */
  floorEnabled: boolean;
  /** Outgoing-damage multiplier from the human player count at spawn. */
  damageMult: number;
  /** Per-run hot-path storage. State stays on Sim through squadRuns. */
  alliesScratch: Entity[];
  allyEntityIdsScratch: Set<number>;
  playerQueryScratch: Entity[];
  targetQueryScratch: Entity[];
  anchorScratch: { x: number; z: number };
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
const SQUAD_ALLY_RANGE = 130;
const SQUAD_ALLY_RANGE_SQ = SQUAD_ALLY_RANGE * SQUAD_ALLY_RANGE;
const entityIdOrder = (a: Entity, b: Entity): number => a.id - b.id;
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
    actorEntityIds: new Set(),
    directives: new Map(),
    floorEnabled: opts.floorEnabled ?? true,
    damageMult: squadDamageMultFor(opts.humanCount),
    alliesScratch: [],
    allyEntityIdsScratch: new Set(),
    playerQueryScratch: [],
    targetQueryScratch: [],
    anchorScratch: { x: 0, z: 0 },
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
    run.actorEntityIds.add(actor.id);
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

// Players inside this run's footprint, computed once per run/tick. Querying
// around each actor preserves the old "near any actor" shape without scanning
// the realm-wide player roster for every actor and healer duty.
function collectRunAllies(ctx: SimContext, run: SquadRun): Entity[] {
  const out = run.alliesScratch;
  const seen = run.allyEntityIdsScratch;
  out.length = 0;
  seen.clear();
  for (const entityId of run.actorIds.values()) {
    const actor = ctx.entities.get(entityId);
    if (!actor) continue;
    ctx.playerGrid.collectInRadius(
      actor.pos.x,
      actor.pos.z,
      SQUAD_ALLY_RANGE,
      run.playerQueryScratch,
    );
    for (const player of run.playerQueryScratch) {
      if (player.dead || player.squadClaimId !== undefined || seen.has(player.id)) continue;
      // SpatialGrid's radius edge is inclusive; the established squad ally
      // envelope is strict (< 130), so preserve the gameplay boundary.
      const dx = player.pos.x - actor.pos.x;
      const dz = player.pos.z - actor.pos.z;
      if (dx * dx + dz * dz >= SQUAD_ALLY_RANGE_SQ) continue;
      seen.add(player.id);
      out.push(player);
    }
  }
  // Spatial buckets are not insertion ordered. Entity ids are monotonic, so
  // this restores the former players-Map order for equal-distance ties.
  out.sort(entityIdOrder);
  return out;
}

function directiveAnchor(
  ctx: SimContext,
  run: SquadRun,
  actor: Entity,
  directive: SquadDirective,
  allies: readonly Entity[],
): { x: number; z: number } | null {
  const out = run.anchorScratch;
  if (directive.kind === 'hold' || directive.kind === 'station') {
    out.x = directive.x;
    out.z = directive.z;
    return out;
  }
  if (directive.pid !== null) {
    const unit = ctx.entities.get(directive.pid);
    if (unit && !unit.dead) {
      out.x = unit.pos.x;
      out.z = unit.pos.z;
      return out;
    }
  }
  // follow with no explicit unit: the nearest living ally.
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const ally of allies) {
    const d = dist2d(actor.pos, ally.pos);
    if (d < bestD) {
      best = ally;
      bestD = d;
    }
  }
  if (!best) return null;
  out.x = best.pos.x;
  out.z = best.pos.z;
  return out;
}

function pickTarget(ctx: SimContext, run: SquadRun, actor: Entity, leash: number): Entity | null {
  let best: Entity | null = null;
  let bestD = leash;
  const candidates = ctx.grid.collectInRadius(
    actor.pos.x,
    actor.pos.z,
    leash,
    run.targetQueryScratch,
  );
  candidates.sort(entityIdOrder);
  for (const m of candidates) {
    if (m.kind !== 'mob' || m.dead || !m.hostile || m.squadActorId !== undefined) continue;
    const d = dist2d(actor.pos, m.pos);
    if (d >= bestD) continue;
    // Engage what is fighting the squad's fight: an ally (player or actor)
    // on its hate table or in its sights, or the mob pressing this actor.
    const engaged =
      m.aggroTargetId !== null &&
      (m.aggroTargetId === actor.id ||
        run.actorEntityIds.has(m.aggroTargetId) ||
        ctx.players.has(m.aggroTargetId));
    const threatening = m.threat.size > 0;
    if (!engaged && !threatening) continue;
    best = m;
    bestD = d;
  }
  return best;
}

function relieveDownedActor(ctx: SimContext, run: SquadRun, actor: Entity): void {
  const players = ctx.playerGrid.collectInRadius(
    actor.pos.x,
    actor.pos.z,
    SQUAD_RELIEF_RANGE,
    run.playerQueryScratch,
  );
  for (const p of players) {
    if (!p.dead) {
      actor.squadDowned = false;
      actor.hp = Math.max(1, Math.round(actor.maxHp * SQUAD_RELIEF_HP_FRACTION));
      ctx.emit({ type: 'heal', targetId: actor.id, amount: actor.hp });
      return;
    }
  }
}

function updateActor(
  ctx: SimContext,
  run: SquadRun,
  actorId: string,
  actor: Entity,
  allies: readonly Entity[],
): boolean {
  const def = LAST_BELL_SQUAD_ACTORS[actorId];
  if (!def) return false;
  if (actor.dead) return false;
  if (actor.squadDowned) {
    relieveDownedActor(ctx, run, actor);
    return false;
  }
  const directive = run.directives.get(actorId) ?? { kind: 'follow' as const, pid: null };
  const anchor = directiveAnchor(ctx, run, actor, directive, allies);
  actor.swingTimer = (actor.swingTimer ?? 0) - DT;

  // Healer duty runs on its own clock, whatever the stance.
  if (def.role === 'healer') {
    actor.wanderTimer = (actor.wanderTimer ?? 0) - DT;
    if (actor.wanderTimer <= 0) {
      actor.wanderTimer = SQUAD_HEAL_INTERVAL;
      let healTarget: Entity | null = null;
      let lowest = 1;
      for (const e of allies) {
        const frac = e.hp / Math.max(1, e.maxHp);
        if (frac < 1 && frac < lowest && dist2d(actor.pos, e.pos) <= SQUAD_HEAL_RANGE) {
          healTarget = e;
          lowest = frac;
        }
      }
      for (const entityId of run.actorIds.values()) {
        const mate = ctx.entities.get(entityId);
        if (!mate || mate.dead || mate.id === actor.id) continue;
        const frac = mate.hp / Math.max(1, mate.maxHp);
        if (frac < 1 && frac < lowest && dist2d(actor.pos, mate.pos) <= SQUAD_HEAL_RANGE) {
          healTarget = mate;
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
    if (directive.kind === 'follow') return false; // fight where you stand
  } else {
    actor.inCombat = false;
  }

  if (!anchor) return false;
  const d = Math.hypot(actor.pos.x - anchor.x, actor.pos.z - anchor.z);
  if (d > SQUAD_TELEPORT_DISTANCE) {
    actor.pos = ctx.groundPos(anchor.x, anchor.z);
    actor.prevPos = { ...actor.pos };
    ctx.rebucket(actor);
    return true;
  }
  const settle = directive.kind === 'follow' ? SQUAD_FOLLOW_DISTANCE : 0.8;
  if (d > settle && !ctx.isRooted(actor) && !target) {
    ctx.moveToward(actor, ctx.groundPos(anchor.x, anchor.z), SQUAD_MOVE_SPEED);
  } else if (directive.kind === 'station' && directive.facing !== undefined && !target) {
    actor.facing = directive.facing;
  }
  return false;
}

// Per-tick driver, called from the Sim tick body after escorts. Zero work
// (and zero rng) while no squad is live, so the shared draw order never
// moves for the existing world.
export function updateSquads(ctx: SimContext): void {
  if (ctx.squadRuns.size === 0) return;
  for (const run of ctx.squadRuns.values()) {
    const allies = collectRunAllies(ctx, run);
    for (const [actorId, entityId] of run.actorIds) {
      const actor = ctx.entities.get(entityId);
      if (!actor) continue;
      // A hard catch-up can move an actor across the 130-yard run envelope.
      // Refresh only on that exceptional path so later actors retain the old
      // same-tick live view without restoring per-actor realm scans.
      if (updateActor(ctx, run, actorId, actor, allies)) collectRunAllies(ctx, run);
    }
  }
}
