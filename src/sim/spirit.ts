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
// `src/sim`-pure: no DOM/Three/render/ui/game/net imports, no Math.random/Date.now.

import {
  dungeonAt,
  isDelvePos,
  OVERWORLD_GRAVEYARDS,
  SPIRIT_HEALER,
  SPIRIT_HEALER_NPC_ID,
} from './data';
import { createNpc, recalcPlayerStats } from './entity';
import { releaseSpiritInDelve } from './entity_roster';
import {
  aurasSurvivingDeath,
  RES_SICKNESS_STAT_MULT,
  RESURRECTION_SICKNESS_ID,
  resSicknessDuration,
} from './resurrection';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { dist2d, type Entity, type Vec3 } from './types';

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
// Resurrection Sickness (display "The Keeper's Toll"), its level-scaled duration, and the
// "survives death" predicate live in ./resurrection (a leaf module shared by every
// death/respawn site). Re-export the id so it stays importable from here.
export { RESURRECTION_SICKNESS_ID };

// --- graveyard selection ----------------------------------------------------

// Nearest overworld graveyard to a position (pure: a scan of the static list).
export function nearestOverworldGraveyard(x: number, z: number): { x: number; z: number } {
  let best = OVERWORLD_GRAVEYARDS[0];
  let bestD = Infinity;
  for (const g of OVERWORLD_GRAVEYARDS) {
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
function ghostGraveyard(p: Entity): { x: number; z: number } {
  const dungeon = dungeonAt(p.pos.x);
  if (dungeon) return nearestOverworldGraveyard(dungeon.doorPos.x, dungeon.doorPos.z);
  return nearestOverworldGraveyard(p.pos.x, p.pos.z);
}

// --- release / resurrect ----------------------------------------------------

// Release the spirit: leave the body where it fell and rise as a ghost at the
// nearest graveyard. Replaces the old instant-respawn-at-graveyard behavior.
export function releasePlayerSpirit(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  if (!p.dead || p.ghost) return; // not dead, or already a spirit
  if (ctx.arenaMatches.has(p.id)) return; // arena/fiesta run their own respawn
  if (isDelvePos(p.pos.x)) {
    // Delves keep their own bounded respawn rules (see entity_roster), no ghost run.
    releaseSpiritInDelve(ctx, meta.entityId);
    return;
  }
  // Mark where the body lies, then send the spirit to the graveyard.
  p.corpsePos = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
  p.ghost = true; // p.dead stays true
  const gy = ghostGraveyard(p);
  p.pos = ctx.groundPos(gy.x, gy.z);
  p.prevPos = { ...p.pos };
  ctx.rebucket(p);
  p.facing = 0;
  // The Keeper's Toll (Resurrection Sickness) persists through death and release: it
  // cannot be shed by dying. Every other aura clears when the spirit is released.
  p.auras = aurasSurvivingDeath(p.auras);
  p.ccDr.clear();
  recalcPlayerStats(p, meta.cls, meta.equipment, ctx.playerMods(meta));
  // A ghost shows a full (greyed) bar even though it is still `dead`. recalc forces
  // hp to 0 while dead, so set the display pools afterward.
  p.hp = p.maxHp;
  p.resource = p.resourceType === 'mana' ? p.maxResource : p.resourceType === 'energy' ? 100 : 0;
  p.targetId = null;
  p.autoAttack = false;
  p.queuedOnSwing = null;
  delete p.queuedOnSwingFree;
  p.queuedCastAbility = null;
  p.queuedCastAim = null;
  p.combatTimer = 99;
  p.inCombat = false;
  // No event: the client transitions to the ghost UI from the snapshot's ghost flag.
}

// Resurrect at the corpse (no penalty) once the ghost is within range of its body.
export function resurrectAtCorpse(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  if (!p.dead || !p.ghost || !p.corpsePos) return;
  // Server-authoritative range gate; the client only offers the button in range.
  if (dist2d(p.pos, p.corpsePos) > CORPSE_REZ_RANGE) return;
  // Revive where the ghost is standing (it ran back to within range of the body), not
  // teleported onto the exact corpse point.
  reviveAt(ctx, meta, p, p.pos, RES_HP_FRACTION, false);
  ctx.emit({ type: 'respawn', pid: meta.entityId });
}

// Resurrect at the Spirit Healer: instant, in place, but with Resurrection Sickness.
export function resurrectAtSpiritHealer(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  if (!p.dead || !p.ghost) return;
  if (!spiritHealerInRange(ctx, p)) return;
  // The Spirit Healer always inflicts Resurrection Sickness and returns you at only
  // RES_HEALER_HP_FRACTION of your pools (the corpse run is the penalty-free choice).
  reviveAt(ctx, meta, p, p.pos, RES_HEALER_HP_FRACTION, true);
  ctx.emit({ type: 'respawn', pid: meta.entityId });
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
  reviveAt(ctx, meta, p, pos, RES_HP_FRACTION, false);
  ctx.emit({ type: 'respawn', pid: meta.entityId });
}

// Whether a Spirit Healer NPC stands within reach of the spirit.
function spiritHealerInRange(ctx: SimContext, p: Entity): boolean {
  for (const e of ctx.entities.values()) {
    if (e.kind !== 'npc' || e.templateId !== SPIRIT_HEALER_NPC_ID) continue;
    if (dist2d(e.pos, p.pos) <= SPIRIT_HEALER_RANGE) return true;
  }
  return false;
}

// Shared resurrection: clear the ghost/corpse state, place the body, restore half
// pools, and (when penalized) apply Resurrection Sickness.
function reviveAt(
  ctx: SimContext,
  meta: PlayerMeta,
  p: Entity,
  pos: Vec3,
  hpFrac: number,
  sickness: boolean,
): void {
  p.dead = false;
  p.ghost = false;
  p.corpsePos = null;
  p.pos = ctx.groundPos(pos.x, pos.z);
  p.prevPos = { ...p.pos };
  ctx.rebucket(p);
  p.facing = 0;
  // Keep The Keeper's Toll across the revive (it persists through death); a healer
  // resurrection refreshes it to full duration via applyResurrectionSickness below.
  p.auras = aurasSurvivingDeath(p.auras);
  p.ccDr.clear();
  recalcPlayerStats(p, meta.cls, meta.equipment, ctx.playerMods(meta));
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
  if (sickness) applyResurrectionSickness(ctx, p);
}

// Apply Resurrection Sickness. Fresh application uses the level-scaled duration (nothing
// below RES_SICKNESS_MIN_LEVEL); a relog restore passes the SAVED remaining so the penalty
// resumes rather than resets.
export function applyResurrectionSickness(ctx: SimContext, p: Entity, remaining?: number): void {
  const dur = remaining ?? resSicknessDuration(p.level);
  if (dur <= 0) return;
  ctx.applyAura(p, {
    id: RESURRECTION_SICKNESS_ID,
    name: 'Resurrection Sickness',
    kind: 'buff_allstats_pct',
    remaining: dur,
    duration: dur,
    value: RES_SICKNESS_STAT_MULT,
    sourceId: p.id,
    school: 'shadow',
  });
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
export function spawnOverworldSpiritHealers(ctx: SimContext): void {
  for (const g of OVERWORLD_GRAVEYARDS) spawnSpiritHealerAt(ctx, g.x, g.z);
}
