// The WoW-style death loop: ghost release, the corpse run, and the two ways back
// to life. A self-contained game system behind the SimContext seam (it holds only
// functions; the ghost/corpse state lives on the Entity, set/cleared here).
//
// Flow:
//  1. A player dies (combat/damage.ts handleDeath): `dead = true`. The body lies
//     where it fell; another player could still resurrect it in place.
//  2. releasePlayerSpirit: the spirit leaves the body. `dead` stays true but
//     `ghost` becomes true (a ghost cannot fight or be hit, but it CAN move, runs
//     faster, and is rendered translucent), and `corpsePos` records where the body
//     is. The spirit appears at the nearest graveyard, where a Spirit Healer hovers.
//  3a. resurrectAtCorpse: run the ghost back to its body; within CORPSE_REZ_RANGE
//      it can resurrect with no penalty (RES_HP_FRACTION of its pools).
//  3b. resurrectAtSpiritHealer: accept the angel's resurrection instead, instant and
//      in place, at the cost of Resurrection Sickness (RES_SICKNESS_*). For corpses
//      that are unreachable.
//
// Sitting beside that loop but NOT part of it: the two /unstuck outcomes
// (moveToGraveyardForUnstuck / reviveAtGraveyardForUnstuck). Unstuck never kills and never
// leaves a corpse; it moves the player to the nearest graveyard, raises them if they were
// down, and charges Unstuck Sickness instead of routing them through the Pale Keeper.
//
// `src/sim`-pure: no DOM/Three/render/ui/game/net imports, no Math.random/Date.now.

import { BG_GRAVEYARDS } from './battleground_layout';
import {
  battlegroundOrigin,
  DELVES,
  dungeonAt,
  isDelvePos,
  isRiftPos,
  OVERWORLD_GRAVEYARDS,
  PLAYER_START,
  RIFT_REGION_HALF_X,
  RIFT_REGION_HALF_Z,
  riftInstanceOrigin,
  SPIRIT_HEALER,
  SPIRIT_HEALER_NPC_ID,
} from './data';
import { createNpc, recalcPlayerStats } from './entity';
import { releaseSpiritInDelve } from './entity_roster';
import { cancelProfessionSessionOnDisplacement } from './professions/session_teardown';
import {
  aurasSurvivingDeath,
  RES_SICKNESS_STAT_MULT,
  RESURRECTION_SICKNESS_ID,
  resSicknessDuration,
  SICKNESS_AURA_IDS,
  UNSTUCK_SICKNESS_ID,
  UNSTUCK_SICKNESS_STAT_MULT,
  unstuckSicknessDuration,
} from './resurrection';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { BgMatch } from './social/battleground';
import { dist2d, type Entity, emptyMoveInput, type Vec3 } from './types';

// --- tuning -----------------------------------------------------------------
// A released spirit runs faster than the living, ignoring slows (a ghost cannot be
// snared): the classic ghost-run feel. Effective ghost speed is RUN_SPEED * this.
export const GHOST_RUN_MULT = 1.25;
// How close the ghost must be to its corpse to resurrect there (yards). The client
// only surfaces the "Resurrect" button inside this range; the server re-checks it.
export const CORPSE_REZ_RANGE = 35;
// How close the ghost must stand to a Spirit Healer to accept its resurrection.
export const SPIRIT_HEALER_RANGE = 8;
// Fraction of max hp/mana restored on a corpse-run resurrection (no penalty: half).
export const RES_HP_FRACTION = 0.5;
// A Spirit Healer resurrection is the worse option: it returns you at only this much
// hp/mana AND inflicts Resurrection Sickness, so the penalty-free corpse run is the
// reward for running your spirit all the way back.
export const RES_HEALER_HP_FRACTION = 0.2;
// Resurrection Sickness (display "The Keeper's Toll"), Unstuck Sickness, their
// level-scaled durations, and the "survives death" predicate live in ./resurrection (a leaf
// module shared by every death/respawn site). Re-export the ids so they stay importable
// from here.
export { RESURRECTION_SICKNESS_ID, UNSTUCK_SICKNESS_ID };

// --- graveyard selection ----------------------------------------------------

// Nearest overworld graveyard to a position. Worlds without authored graveyards
// fall back to their own start point rather than leaking a built-in town anchor.
export function nearestOverworldGraveyard(
  x: number,
  z: number,
  graveyards: readonly { x: number; z: number }[] = OVERWORLD_GRAVEYARDS,
  fallback: { x: number; z: number } = PLAYER_START,
): { x: number; z: number } {
  let best: { x: number; z: number } = fallback;
  let bestD = Infinity;
  for (const g of graveyards) {
    const dx = g.x - x;
    const dz = g.z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = g;
    }
  }
  return { x: best.x, z: best.z };
}

// The graveyard a released spirit appears at. A dungeon/raid death sends the spirit OUT
// to the overworld graveyard nearest the instance door (never inside the instance): the
// ghost runs its spirit back to the door and re-enters to resurrect at the entrance, so
// no Spirit Healer stands inside an instance. Outdoors it is the nearest overworld
// graveyard to where the body fell.
function ghostGraveyard(
  ctx: SimContext,
  p: Entity,
  graveyards: readonly { x: number; z: number }[] = OVERWORLD_GRAVEYARDS,
  fallback: { x: number; z: number } = PLAYER_START,
): { x: number; z: number } {
  // Thornhollow Fields keeps the classic release: the spirit rises in its own
  // team's keep graveyard plot and waits there for the wave, never walking out
  // to an overworld yard. Checked FIRST, so a live match outranks every band
  // rule below it.
  const bgMatch = ctx.bgMatches.get(p.id) ?? null;
  if (bgMatch) return bgGraveyardSpot(bgMatch, p.id);
  const dungeon = dungeonAt(p.pos.x);
  if (dungeon) {
    return nearestOverworldGraveyard(dungeon.doorPos.x, dungeon.doorPos.z, graveyards, fallback);
  }
  const delve = ctx.delveRunForPlayer(p.id);
  if (delve && isDelvePos(p.pos.x)) {
    const door = DELVES[delve.delveId]?.doorPos;
    if (door) return nearestOverworldGraveyard(door.x, door.z, graveyards, fallback);
  }
  // A rift death returns the spirit to the overworld graveyard nearest where the
  // player STEPPED THROUGH the portal (the instance's returnPos), not the far-off
  // rift band (which would resolve to whatever zone happens to be nearest in raw
  // world space). Scanned off ctx.riftInstances to avoid a rift/runs import cycle.
  if (isRiftPos(p.pos.x)) {
    for (const inst of ctx.riftInstances) {
      if (inst.partyKey === null) continue;
      const o = riftInstanceOrigin(inst.slot, inst.floorIndex);
      if (
        Math.abs(p.pos.x - o.x) <= RIFT_REGION_HALF_X &&
        Math.abs(p.pos.z - o.z) <= RIFT_REGION_HALF_Z
      ) {
        return nearestOverworldGraveyard(inst.returnPos.x, inst.returnPos.z, graveyards, fallback);
      }
    }
  }
  return nearestOverworldGraveyard(p.pos.x, p.pos.z, graveyards, fallback);
}

// --- release / resurrect ----------------------------------------------------

// Release the spirit: leave the body where it fell and rise as a ghost at the
// nearest graveyard. Replaces the old instant-respawn-at-graveyard behavior.
export function releasePlayerSpirit(
  ctx: SimContext,
  pid?: number,
  graveyards: readonly { x: number; z: number }[] = OVERWORLD_GRAVEYARDS,
  fallback: { x: number; z: number } = PLAYER_START,
): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  if (!p.dead || p.ghost) return; // not dead, or already a spirit
  // Arena/fiesta run their own respawn, BUT a live Thornhollow Fields membership wins:
  // a stale arenaMatches entry (jail/cross-queue leaks) once held this gate
  // shut for a whole bg match, so the guard must never outrank the bg arm.
  if (ctx.arenaMatches.has(p.id) && !ctx.bgMatches.has(p.id)) return;
  if (isDelvePos(p.pos.x)) {
    // Delves keep their own bounded respawn rules (see entity_roster), no ghost run.
    releaseSpiritInDelve(ctx, meta.entityId);
    return;
  }
  releaseAtNearestGraveyard(ctx, meta, p, graveyards, fallback);
}

/**
 * Finish Unstuck for a LIVING player: move them to the nearest graveyard and leave them
 * alive. No death and no corpse; the whole price is Unstuck Sickness. The graveyard (rather
 * than a nearby safe spot) is the destination because it is the one point in every zone
 * guaranteed to be reachable open ground.
 *
 * The countdown's own gates (blockedReason/cancelReason in ./unstuck) guarantee that a
 * player who reaches this point is out of combat, standing still, and not casting, eating,
 * sitting, charging, or following, so none of that state needs unwinding here.
 */
export function moveToGraveyardForUnstuck(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r || r.e.dead || r.e.ghost) return;
  const { meta, e: p } = r;
  // The unstuck gates reject a casting player, so no live gather or fishing
  // session can reach this today; the shared displacement teardown still
  // runs because EVERY living-player teleport routes through it (the
  // professions doctrine), keeping this path safe if a session state ever
  // stops riding castingAbility.
  cancelProfessionSessionOnDisplacement(ctx, p);
  // Resolve the graveyard before the move takes the player out of its instance band.
  const gy = ghostGraveyard(ctx, p);
  p.pos = ctx.groundPos(gy.x, gy.z);
  p.prevPos = { ...p.pos };
  ctx.rebucket(p);
  p.facing = 0;
  // Whatever keys were held when the countdown finished must not carry over, or the
  // player walks off the graveyard in the last held direction the instant they land
  // (the same reason the release and revive paths below clear this).
  Object.assign(meta.moveInput, emptyMoveInput());
  p.vx = 0;
  p.vy = 0;
  p.vz = 0;
  // Land settled, the same recipe as the portal teleport (see portals.ts): no carried-over
  // jump arc or fall origin from the old position, so a move off a high ledge can never
  // deal fall damage on arrival.
  p.jumping = false;
  p.onGround = true;
  p.fallStartY = p.pos.y;
  // Everything that pointed at where they used to be is now out of range.
  p.targetId = null;
  p.autoAttack = false;
  p.queuedOnSwing = null;
  delete p.queuedOnSwingFree;
  delete p.queuedOnSwingCostMultiplier;
  p.queuedCastAbility = null;
  p.queuedCastAim = null;
  // Applied last: the sickness drains stamina, so recalcPlayerStats (via applyAura) rebuilds
  // the pools and carries the current hp/mana FRACTIONS into the reduced maxima. A player at
  // full health arrives at full health of a smaller bar rather than over the top of it.
  applyUnstuckSickness(ctx, p);
}

/**
 * Finish Unstuck for a player who was dead or a released ghost: pull them to the nearest
 * graveyard and raise them there at RES_HEALER_HP_FRACTION of their pools. This is the
 * escape hatch for a spirit that cannot reach its corpse or an angel. It charges Unstuck
 * Sickness, not The Keeper's Toll, so it is a shorter penalty than walking to the Pale
 * Keeper would have been but it is never free.
 */
export function reviveAtGraveyardForUnstuck(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r?.e.dead) return;
  const { meta, e: p } = r;
  // Resolve the graveyard before the revive moves the body out of its instance band.
  const gy = ghostGraveyard(ctx, p);
  reviveAt(ctx, meta, p, { x: gy.x, y: p.pos.y, z: gy.z }, RES_HEALER_HP_FRACTION, 'unstuck');
  ctx.emit({ type: 'respawn', pid: meta.entityId });
}

function releaseAtNearestGraveyard(
  ctx: SimContext,
  meta: PlayerMeta,
  p: Entity,
  graveyards: readonly { x: number; z: number }[] = OVERWORLD_GRAVEYARDS,
  fallback: { x: number; z: number } = PLAYER_START,
): void {
  // Resolve the graveyard before moving the entity out of its instance band.
  const gy = ghostGraveyard(ctx, p, graveyards, fallback);
  p.corpsePos = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
  p.corpseInstanceId = ctx.instanceClaimIdAt(p.pos);
  p.ghost = true; // p.dead stays true
  p.pos = ctx.groundPos(gy.x, gy.z);
  p.prevPos = { ...p.pos };
  ctx.rebucket(p);
  // prevFacing pairs with facing on every forced-facing site in the sim (see
  // mob/lifecycle.ts, sim.ts, social/arena.ts): leaving it stale here made the
  // render-interpolated facing sweep from the pre-death heading to 0 over the
  // next tick window instead of landing on 0 immediately.
  p.facing = 0;
  p.prevFacing = 0;
  // Whatever movement keys were held at the moment of death must not carry over: the
  // ghost is teleported to the graveyard and should sit still until the player actually
  // presses a key again, not keep walking in the last held direction.
  Object.assign(meta.moveInput, emptyMoveInput());
  // The Keeper's Toll (Resurrection Sickness) persists through death and release: it
  // cannot be shed by dying. Every other aura clears when the spirit is released.
  p.auras = aurasSurvivingDeath(p.auras);
  p.ccDr.clear();
  recalcPlayerStats(p, meta.cls, meta.equipment, ctx.playerMods(meta), meta.equipmentInstance);
  // A ghost shows a full (greyed) bar even though it is still `dead`. recalc forces
  // hp to 0 while dead, so set the display pools afterward.
  p.hp = p.maxHp;
  p.resource =
    p.resourceType === 'mana'
      ? p.maxResource
      : p.resourceType === 'energy' || p.resourceType === 'focus'
        ? 100
        : 0;
  p.targetId = null;
  p.autoAttack = false;
  p.queuedOnSwing = null;
  delete p.queuedOnSwingFree;
  delete p.queuedOnSwingCostMultiplier;
  p.queuedCastAbility = null;
  p.queuedCastAim = null;
  p.combatTimer = 99;
  p.inCombat = false;
  // No event: the client transitions to the ghost UI from the snapshot's ghost flag.
}

// The waiting spot inside the team's graveyard plot: a small deterministic
// grid keyed by roster index, mirrored between teams like the plot itself.
export function bgGraveyardSpot(match: BgMatch, pid: number): { x: number; z: number } {
  const team = match.teams[1].includes(pid) ? 1 : 0;
  const origin = battlegroundOrigin(match.slot);
  const plot = BG_GRAVEYARDS[team];
  const idx = Math.max(0, match.teams[team].indexOf(pid));
  const m = team === 0 ? 1 : -1;
  const dx = ((idx % 2) * 6 - 3) * m;
  const dz = (Math.floor(idx / 2) - 1) * 3 * m;
  return { x: origin.x + plot.x + dx, z: origin.z + plot.z + dz };
}

// Resurrect at the corpse (no penalty) once the ghost is within range of its body.
export function resurrectAtCorpse(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  if (!p.dead || !p.ghost || !p.corpsePos) return;
  if (ctx.bgMatches.has(p.id)) return; // Thornhollow Fields revives on the wave only
  // Server-authoritative range gate; the client only offers the button in range.
  if (dist2d(p.pos, p.corpsePos) > CORPSE_REZ_RANGE) return;
  // Revive where the ghost is standing (it ran back to within range of the body), not
  // teleported onto the exact corpse point.
  reviveAt(ctx, meta, p, p.pos, RES_HP_FRACTION, 'none');
  ctx.emit({ type: 'respawn', pid: meta.entityId });
}

// Resurrect at the Spirit Healer: instant, in place, but with Resurrection Sickness.
export function resurrectAtSpiritHealer(ctx: SimContext, pid?: number): boolean {
  const r = ctx.resolve(pid);
  if (!r) return false;
  const { meta, e: p } = r;
  if (!p.dead || !p.ghost) return false;
  if (ctx.bgMatches.has(p.id)) return false; // Thornhollow Fields revives on the wave only
  if (!spiritHealerInRange(ctx, p)) return false;
  // The Spirit Healer always inflicts Resurrection Sickness and returns you at only
  // RES_HEALER_HP_FRACTION of your pools (the corpse run is the penalty-free choice).
  reviveAt(ctx, meta, p, p.pos, RES_HEALER_HP_FRACTION, 'resurrection');
  ctx.emit({ type: 'respawn', pid: meta.entityId });
  return true;
}

// Resurrect a ghost that ran its spirit back and re-entered its instance: penalty-free,
// at the entry it just crossed. Re-entering IS the corpse run under the instance death
// model (no Spirit Healer inside an instance), so it carries no Resurrection Sickness.
// Called from enterDungeon when a ghost walks back through the door.
export function resurrectOnInstanceReentry(
  ctx: SimContext,
  meta: PlayerMeta,
  p: Entity,
  pos: Vec3,
): void {
  // Only a spirit whose body actually lies inside an instance revives on re-entry, so
  // walking a ghost through an unrelated door is not a free resurrection.
  if (!p.corpsePos || p.corpseInstanceId === null) return;
  reviveAt(ctx, meta, p, pos, RES_HP_FRACTION, 'none');
  ctx.emit({ type: 'respawn', pid: meta.entityId });
}

export function revivePlayerAt(ctx: SimContext, pid: number, pos: Vec3, hpFrac = 1): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const wasDead = r.e.dead || r.e.ghost;
  reviveAt(ctx, r.meta, r.e, pos, hpFrac, 'none');
  if (wasDead) ctx.emit({ type: 'respawn', pid: r.meta.entityId });
}

// Whether a Spirit Healer NPC stands within reach of the spirit.
function spiritHealerInRange(ctx: SimContext, p: Entity): boolean {
  for (const e of ctx.entities.values()) {
    if (e.kind !== 'npc' || e.templateId !== SPIRIT_HEALER_NPC_ID) continue;
    if (dist2d(e.pos, p.pos) <= SPIRIT_HEALER_RANGE) return true;
  }
  return false;
}

/** Which sickness a revive charges: none, The Keeper's Toll, or the shorter Unstuck one. */
type SicknessKind = 'none' | 'resurrection' | 'unstuck';

// Shared resurrection: clear the ghost/corpse state, place the body, restore half
// pools, and (when penalized) apply the named sickness.
function reviveAt(
  ctx: SimContext,
  meta: PlayerMeta,
  p: Entity,
  pos: Vec3,
  hpFrac: number,
  sickness: SicknessKind,
): void {
  p.dead = false;
  p.ghost = false;
  p.corpsePos = null;
  p.corpseInstanceId = null;
  // revivePlayerAt teleports even a LIVE target (wasDead only gates the
  // respawn event), so a running gather/fishing session must end here too.
  cancelProfessionSessionOnDisplacement(ctx, p);
  p.pos = ctx.groundPos(pos.x, pos.z);
  p.prevPos = { ...p.pos };
  ctx.rebucket(p);
  // See releasePlayerSpirit above: pair prevFacing with the forced facing reset.
  p.facing = 0;
  p.prevFacing = 0;
  // As with the release above: a held movement key at the moment the revive lands must
  // not carry over, or the freshly-revived body immediately walks off in whatever
  // direction was last held (this is what made revived players drift with no input).
  Object.assign(meta.moveInput, emptyMoveInput());
  // Keep both sicknesses across the revive (they persist through death); a healer
  // resurrection refreshes The Keeper's Toll to full duration via the apply below.
  p.auras = aurasSurvivingDeath(p.auras);
  p.ccDr.clear();
  recalcPlayerStats(p, meta.cls, meta.equipment, ctx.playerMods(meta), meta.equipmentInstance);
  p.hp = Math.max(1, Math.round(p.maxHp * hpFrac));
  p.resource = p.resourceType === 'mana' ? Math.round(p.maxResource * hpFrac) : 0;
  p.targetId = null;
  p.autoAttack = false;
  p.queuedOnSwing = null;
  p.queuedCastAbility = null;
  p.queuedCastAim = null;
  p.combatTimer = 99;
  p.inCombat = false;
  // Apply sickness last: applyAura -> recalcPlayerStats preserves the hp/resource
  // fractions just set, so hp settles at RES_HP_FRACTION of the reduced max.
  if (sickness === 'resurrection') applyResurrectionSickness(ctx, p);
  else if (sickness === 'unstuck') applyUnstuckSickness(ctx, p);
}

// Apply one of the two sicknesses, dropping the other first. Both are `buff_allstats_pct`
// and recalcPlayerStats multiplies every such aura in turn, so letting them coexist would
// compound two -75% drains into -93.75%. A player only ever owes the most recent one.
function applySickness(
  ctx: SimContext,
  p: Entity,
  id: string,
  name: string,
  value: number,
  dur: number,
): void {
  if (dur <= 0) return;
  const other = p.auras.findIndex((a) => SICKNESS_AURA_IDS.has(a.id) && a.id !== id);
  if (other >= 0) {
    // Emit the fade the client cannot infer, exactly as applyAura does for its own
    // same-id displacements: the buff bar rebuilds from the snapshot either way, but
    // without this the combat log never shows the old sickness lifting.
    const displaced = p.auras[other];
    p.auras.splice(other, 1);
    ctx.emit({ type: 'aura', targetId: p.id, name: displaced.name, gained: false });
  }
  ctx.applyAura(p, {
    id,
    name,
    kind: 'buff_allstats_pct',
    remaining: dur,
    duration: dur,
    value,
    sourceId: p.id,
    school: 'shadow',
    // The penalty is the whole point of both sicknesses, so no player counter may take
    // it off: a dispel (warlock Voidfeast, paladin Cleansing Verdict), a cleanse (mage
    // Cold Coffin), and the buff-bar right-click all skip it, exactly as dying and
    // relogging already do (aurasSurvivingDeath). Only the timer clears it.
    undispellable: true,
  });
}

// Apply Resurrection Sickness. Fresh application uses the level-scaled duration (nothing
// below RES_SICKNESS_MIN_LEVEL); a relog restore passes the SAVED remaining so the penalty
// resumes rather than resets.
export function applyResurrectionSickness(ctx: SimContext, p: Entity, remaining?: number): void {
  applySickness(
    ctx,
    p,
    RESURRECTION_SICKNESS_ID,
    'Resurrection Sickness',
    RES_SICKNESS_STAT_MULT,
    remaining ?? resSicknessDuration(p.level),
  );
}

// Apply Unstuck Sickness, the price of a completed /unstuck. Same shape as The Keeper's
// Toll (level-scaled, nothing below UNSTUCK_SICKNESS_MIN_LEVEL, saved remaining on a relog
// restore) but capped at 5 minutes rather than 10.
export function applyUnstuckSickness(ctx: SimContext, p: Entity, remaining?: number): void {
  applySickness(
    ctx,
    p,
    UNSTUCK_SICKNESS_ID,
    'Unstuck Sickness',
    UNSTUCK_SICKNESS_STAT_MULT,
    remaining ?? unstuckSicknessDuration(p.level),
  );
}

// --- spawning the angels ----------------------------------------------------

// Spawn one Spirit Healer at a world position, returning its entity id. Reused by
// the overworld ctor pass and by the per-instance dungeon/raid spawn. createNpc
// draws no rng, so call order is determinism-neutral.
export function spawnSpiritHealerAt(ctx: SimContext, x: number, z: number): number {
  const npc = createNpc(ctx.nextId++, SPIRIT_HEALER, ctx.groundPos(x, z));
  ctx.addEntity(npc);
  return npc.id;
}

// Place an angel at every overworld graveyard. Called once from the Sim ctor.
export function spawnOverworldSpiritHealers(
  ctx: SimContext,
  graveyards: readonly { x: number; z: number }[] = OVERWORLD_GRAVEYARDS,
): void {
  for (const g of graveyards) {
    spawnSpiritHealerAt(ctx, g.x, g.z);
  }
}
