// Source Cave clear detection: the reward chest, the daily-lockout grant, and the
// kill-progress SimEvents. Runs behind the SimContext seam like the rest of the cave
// controller (dungeon.ts). Two entry points delegate in:
//   - instances/dungeons.ts updateInstances() calls updateSourceCaveClear()/
//     sourceCaveInstanceOccupied() once a second per claimed cave slot;
//   - combat/damage.ts handleDeath() calls onSourceCaveMobKilled() when a cave mob dies.
// No circular import: this module resolves the instance origin through sourceCaveOrigin
// (runtime.ts), never instances/dungeons.ts (which imports this module through the barrel).
//
// CHEST LIFECYCLE: the reward chest is spawned SEALED at claim time in its own
// north-wall alcove, always visible in the room but quiet (the sealed template has
// no interact label and no sparkle client-side). Interacting with a sealed chest
// is denied ("Access denied." toast, interaction.ts routes through
// trySourceCaveChestDeny); once every required opponent is dead the 1 Hz pass ARMS it exactly
// once with a classic shared loot roll the party/raid distributes through the
// normal group-loot machinery (need/greed, master loot, round robin via
// tappedById + lootRecipientIds).
// ONCE-ONLY GUARD: arming swaps the templateId sealed -> armed, and nothing ever
// swaps it back within a claim (pruneCorpseLoot only nulls `loot`), so the pass
// can never re-arm an emptied or mid-roll chest. freeInstance despawns the chest
// with the slot's other objects, so a re-claimed slot gets a fresh sealed chest.
//
// OCCUPANCY (who is in the instance): NOT the generic updateInstances 250u z-box. The
// cave is one square arena room (source_cave_arena, see spec.ts): the entrance sits at
// the south wall, deliberately far from the boss/chest at the arena centre (the
// no-instant-aggro buffer), so a player standing right at the door is at z-relative
// ~-59 - outside a tight box. The cave uses an ASYMMETRIC z-band
// [origin - SOUTH, origin + delveModuleStackEndRelZ(modules)], generous enough on the
// south side to cover the whole entrance-to-centre walk, and stays clear of the
// 620u-spaced neighbor slots on the north side. This same recipient rule feeds the
// lockout grant, the chest's loot candidate set, the progress events, AND the cave's
// empty-timeout, so "who is in the instance" is one rule everywhere (see
// docs/the-source-cave/state.md).
//
// CLAMP: the arena is one fixed-size room (not roster-scaled like the old per-module
// stack), so delveModuleStackEndRelZ(modules) is a small constant today; the north-edge
// clamp to SOURCE_CAVE_OCCUPANCY_NORTH_MAX is kept as a defensive ceiling regardless (so
// this module can never cross-credit a neighboring instance even if the arena is resized
// later), currently inert since the real stack end sits far under it.

import { createGroundObject } from '../entity';
import type { InstanceSlot, PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { sourceCaveDefeatMobIds } from './encounter';
import { buildSourceCaveChestLoot } from './loot';
import { playersInSourceCaveInstance } from './occupancy';
import {
  isSourceCavePos,
  moduleWorldPoint,
  SOURCE_CAVE_DUNGEON_ID,
  type SourceCaveRuntime,
  sourceCaveOrigin,
} from './runtime';
import { sourceCaveChestLocalZ } from './spec';

/** Ground-object templateId for the ARMED reward chest (looted via lootCorpse). */
export const SOURCE_CAVE_CHEST_TEMPLATE = 'source_cave_chest';

/**
 * TemplateId of the chest while SEALED (from claim until the clear). A separate
 * template, not a flag, so every client surface derives the sealed look for
 * free over the wire `tid`: no interact label, no sparkle (the delve
 * plate/rope "sim swaps the template in place" idiom; the renderer rebuilds
 * the view on the swap).
 */
export const SOURCE_CAVE_CHEST_SEALED_TEMPLATE = 'source_cave_chest_sealed';
/** Source Cave mobs carry no corpse loot; clear their bodies from the arena quickly. */
export const SOURCE_CAVE_CORPSE_DESPAWN_SECONDS = 10;

// The chest lives in its own alcove against the NORTH wall (sourceCaveChestLocalZ,
// spec.ts), far across the room from the centre button: the generic interact
// command re-scans for the nearest lootable object, so when the two stood a few
// yards apart a click on the chest could resolve onto the BUTTON and fire the
// reboot (user report). The full room between them makes that impossible.

/** Is anyone physically inside this cave instance (the empty-timeout occupancy test)? */
export function sourceCaveInstanceOccupied(ctx: SimContext, inst: InstanceSlot): boolean {
  return playersInSourceCaveInstance(ctx, inst).length > 0;
}

// A mob id counts as dead for clear purposes when its entity is already despawned
// (undefined) OR flagged dead (a corpse still lingering in ctx.entities). Encounter waves
// are the authoritative normal-pacing roster; a breach additionally requires every
// overflow guardian that has not already retired.
function allMobsDead(ctx: SimContext, inst: InstanceSlot): boolean {
  for (const id of sourceCaveDefeatMobIds(inst)) {
    const e = ctx.entities.get(id);
    if (e && !e.dead) return false;
  }
  return true;
}

/** The claimed slot's reward chest entity (spawned at claim time), if alive. */
export function sourceCaveChestOf(ctx: SimContext, inst: InstanceSlot): Entity | null {
  for (const id of inst.objectIds) {
    const e = ctx.entities.get(id);
    if (
      e?.templateId === SOURCE_CAVE_CHEST_TEMPLATE ||
      e?.templateId === SOURCE_CAVE_CHEST_SEALED_TEMPLATE
    )
      return e;
  }
  return null;
}

/**
 * Spawn the SEALED reward chest at claim time, in the north-wall alcove.
 * It is `lootable` (so the interact command reaches it) but deliberately quiet:
 * the sealed template carries no interact label and no sparkle client-side, and
 * interaction.ts denies it via trySourceCaveChestDeny until the clear pass arms
 * it (which swaps the template to SOURCE_CAVE_CHEST_TEMPLATE). Draws no rng.
 */
export function spawnSourceCaveChest(
  ctx: SimContext,
  cave: SourceCaveRuntime,
  inst: InstanceSlot,
): Entity {
  const origin = sourceCaveOrigin(inst.slot);
  const lastModule = cave.spec.modules.length - 1;
  const pos = moduleWorldPoint(
    ctx,
    cave,
    origin,
    lastModule,
    cave.spec.chestPos.x,
    sourceCaveChestLocalZ(),
  );
  const chest = createGroundObject(ctx.nextId++, '', `${cave.def.name} Cache`, pos);
  chest.templateId = SOURCE_CAVE_CHEST_SEALED_TEMPLATE;
  chest.objectItemId = null;
  chest.lootable = true;
  // A one-shot reward, not a respawning node (world-boss corpse precedent,
  // combat/damage.ts): without this the generic per-tick object-respawn loop (sim.ts)
  // flips `lootable` back to true forever once every slot is emptied (respawnTimer
  // defaults to 0), re-highlighting an empty chest as lootable.
  chest.respawnTimer = Infinity;
  ctx.addEntity(chest);
  inst.objectIds.push(chest.id);
  return chest;
}

/** Still sealed: the clear pass has not armed this chest with loot yet. */
export function isSourceCaveChestSealed(chest: Entity): boolean {
  return chest.templateId === SOURCE_CAVE_CHEST_SEALED_TEMPLATE;
}

/**
 * Interaction gate for the chest (called from interaction.ts before lootCorpse):
 * a sealed chest denies with "Access denied." and returns true so the caller
 * stops. An armed chest returns false and loots through the normal machinery.
 */
export function trySourceCaveChestDeny(ctx: SimContext, chest: Entity, pid?: number): boolean {
  if (!isSourceCaveChestSealed(chest)) return false;
  const r = ctx.resolve(pid);
  if (r) ctx.error(r.meta.entityId, 'Access denied.');
  return true;
}

/**
 * Per-second cave-slot pass (called from updateInstances for cave instances): once
 * every required opponent is dead AND at least one player is present, ARM the sealed reward
 * chest exactly once with a classic shared loot roll and lock every player currently
 * inside out until the daily reset. The sealed->armed template swap makes arming
 * once-per-claim; freeInstance despawns the chest on re-claim. Draws ctx.rng only
 * through buildSourceCaveChestLoot (the loot roll); detection + lockout draw none.
 */
export function updateSourceCaveClear(ctx: SimContext, inst: InstanceSlot): void {
  const cave = ctx.sourceCave;
  if (!cave || inst.partyKey === null) return;
  const chest = sourceCaveChestOf(ctx, inst);
  if (!chest || !isSourceCaveChestSealed(chest)) return; // no chest, or already cleared
  if (!allMobsDead(ctx, inst)) return;
  const recipients = playersInSourceCaveInstance(ctx, inst);
  // Nobody present yet: the reward belongs to the clearing group, so wait until a
  // recipient is in the room (the killer is at the finale, well inside the band).
  if (recipients.length === 0) return;
  armSourceCaveChest(ctx, chest, recipients);
  grantSourceCaveLockout(ctx, recipients);
}

// Arm the sealed chest with a classic shared drop: the group's own loot method
// (need/greed, master loot, round robin, looter-takes-all) distributes it via the
// standard corpse-loot machinery. tappedById anchors the party strategies lookup
// (recipients are entityId-sorted, so [0] is stable) and lootRecipientIds pins the
// kill-time eligible candidate set, exactly like a tapped mob corpse. The
// baseEntity default lootFfaTimer (Infinity) never counts down on an object, so
// the chest never opens to strangers via the FFA lapse.
function armSourceCaveChest(ctx: SimContext, chest: Entity, recipients: PlayerMeta[]): void {
  // The template swap IS the arming signal: sealed -> armed flips the client
  // look (label + sparkle appear) over the wire tid, and isSourceCaveChestSealed
  // stops matching, so the 1 Hz pass can never re-arm.
  chest.templateId = SOURCE_CAVE_CHEST_TEMPLATE;
  chest.loot = buildSourceCaveChestLoot(ctx);
  chest.tappedById = recipients[0].entityId;
  chest.lootRecipientIds = recipients.map((meta) => meta.entityId);
}

// Daily lockout grant, mirroring grantNythraxisLockout: every player inside the instance
// at clear time is locked until the host's next raid reset. Written to the FLAT
// SOURCE_CAVE_DUNGEON_ID key (no :heroic suffix) so isSourceCaveLocked (dungeon.ts)
// re-checks the exact same key at the door. Draws no rng.
function grantSourceCaveLockout(ctx: SimContext, recipients: PlayerMeta[]): void {
  const until = ctx.raidResetMs(ctx.lockoutNowMs());
  for (const meta of recipients) meta.raidLockouts.set(SOURCE_CAVE_DUNGEON_ID, until);
}

/**
 * Kill-progress hook (called from handleDeath when a cave mob dies): emit a personal
 * progress line to every player currently in the instance, and, when the last mob falls,
 * a distinct "cleared" line. The mob name is the contributor login, spliced verbatim
 * (D7). Draws no rng. The chest + lockout land on the next 1 Hz updateSourceCaveClear
 * pass; this is the instant on-death feedback.
 */
export function onSourceCaveMobKilled(ctx: SimContext, mob: Entity): void {
  // Cheap early-out for the global common case: every non-cave mob death reaches this
  // hook, but only cave mobs stand in the reserved cave x-lane, so skip the instance
  // scan for everything else.
  if (!isSourceCavePos(mob.pos.x)) return;
  const inst = ctx.instances.find(
    (i) => i.dungeonId === SOURCE_CAVE_DUNGEON_ID && i.mobIds.includes(mob.id),
  );
  if (!inst) return;
  mob.despawnTimer = SOURCE_CAVE_CORPSE_DESPAWN_SECONDS;
  const requiredMobIds = sourceCaveDefeatMobIds(inst);
  if (!requiredMobIds.includes(mob.id)) return;
  const totalCount = requiredMobIds.length;
  let killedCount = 0;
  for (const id of requiredMobIds) {
    const e = ctx.entities.get(id);
    if (!e || e.dead) killedCount++;
  }
  const recipients = playersInSourceCaveInstance(ctx, inst);
  for (const meta of recipients) {
    ctx.emit({
      type: 'log',
      text: `${mob.name} has fallen. (${killedCount} of ${totalCount} defeated in The Open Source)`,
      color: '#b9f',
      pid: meta.entityId,
    });
  }
  if (killedCount >= totalCount && totalCount > 0 && allMobsDead(ctx, inst)) {
    emitSourceCaveCleared(ctx, inst);
  }
}

function emitSourceCaveCleared(ctx: SimContext, inst: InstanceSlot): void {
  for (const meta of playersInSourceCaveInstance(ctx, inst)) {
    ctx.emit({
      type: 'log',
      text: 'The Open Source has been cleared.',
      color: '#fd6',
      pid: meta.entityId,
    });
  }
}
