// The per-tick "which players are in combat" derivation, the classic hate-table
// rule: a player is in combat while ANY living hostile mob still carries them
// (or their pet) on its hate table, not only while they are that mob's current
// target. Healing threat lands the healer on the table too, so a raid healer
// stays in combat for the whole fight. The flag only clears when the mob dies,
// evades home (which wipes its table), the player dies (dropped off every table
// by combat/damage.ts), or an escape like Vanish deliberately strips them from
// the tables (combat/effect_dispatch.ts), or they leave the fight behind: in
// the open world that is getting further than THREAT_DROP_RANGE from the mob,
// inside a claimed instance slot it is leaving the slot (the door, a raid room
// crossing, any teleport out), and never distance, so kiting a dungeon around
// sheds nothing (instances/instance_combat_hold.ts). The same walk drops the
// departed attacker off the table (releasing any taunt lock or current-target
// pointer at them), the classic map-change threat drop, so leaving a fight
// never leaves a player stuck in combat either.
//
// Boss encounters add the raid-boss "zone in combat" rule: an engaged boss holds
// every living, nearby member of its attackers' groups in combat even if they
// never acted, so a member who parks at the back cannot drop combat and raise
// the raid through a "cannot be cast in combat" gate mid-fight. Trash mobs keep
// the plain hate-table rule (a bystander who never acted is never pulled in).
//
// Reads mob AND pet state after both updated this tick, so it runs from the
// coordinator's engaged pass (sim.ts), never from a slice that ticks earlier.
// The walk is a derivation with one deliberate mutation: an attacker who left
// the fight is dropped off the table here (taunt lock and current-target
// pointer released with it) rather than in the mob AI's own target pass
// (mob/targeting.ts), because this walk is the one that visits EVERY entry of
// every engaged mob each tick, including a scripted boss parked at idle whose
// AI skips its target pass; a mob whose current target was dropped carries a
// null pointer for the rest of this tick and retargets on its next engaged
// tick (combat_profile.ts). Draws no rng. The hate-table walks bump ctx.mobScanCounters.threatEntryVisits
// like the mob-AI walks in mob/targeting.ts, so the perf heartbeat's
// threatVisits token keeps counting every table entry visited per tick.
import { MOBS } from '../data';
import { attackerLeftInstance, claimedSlotOf } from '../instances/instance_combat_hold';
import { questGateBlocksAggro } from '../mob/quest_gated_aggro';
import type { MobScanCounters } from '../mob/scan_counters';
import type { InstanceSlot } from '../sim';
import type { SimContext } from '../sim_context';
import { beyondThreatRange, dropThreat, THREAT_DROP_RANGE } from '../threat';
import type { Entity, MobTemplate } from '../types';
import { dist2d } from '../types';

// A pet only keeps its OWNER flagged in combat while it is actively trading blows
// (its combatTimer resets to 0 on every hit dealt/taken). A pet that merely holds a
// target it is chasing or can't reach stops dragging the owner into perpetual combat
// past this window, so the owner's out-of-combat health regen resumes. Matches the
// 5s combat-linger used for the owner's own inCombat flag.
export const PET_COMBAT_LINGER = 5;

// How far (yards, 2D) from an engaged boss a member of an attacker's group is
// held in combat: the same reach an attacker drops off a hate table at, so a
// raider is either inside the fight (held) or outside it (released) by one
// number. Comfortably past every heal / resurrection reach (40 yd) so nobody can
// stand just outside it and still act on the fight; bounded so a group member
// elsewhere in the world is never flagged; under the instance slot pitch, so it
// never reaches a neighbouring instance. Measured flat (dist2d), so a member on
// another floor of the same instance still counts.
export const BOSS_ENCOUNTER_COMBAT_RANGE = THREAT_DROP_RANGE;

/** A live wild mob that is engaged: in combat, or actively chasing / attacking /
 *  fleeing (what the coordinator's old target-only rule keyed on), and not
 *  walking home. Field reads only, so the idle crowd never pays a template
 *  lookup. */
function mobEngaged(mob: Entity): boolean {
  if (!mob.hostile) return false;
  // A mob walking home is out of the fight.
  if (mob.aiState === 'evade' || mob.aiState === 'dead') return false;
  const active = mob.aiState === 'chase' || mob.aiState === 'attack' || mob.aiState === 'flee';
  // A scripted boss parked at 'idle' for an intermission stays inCombat, and
  // keeps holding the raid through it.
  return active || mob.inCombat;
}

function isEncounterBoss(template: MobTemplate | undefined): boolean {
  return template?.boss === true || template?.worldBoss === true;
}

/** The player behind a resolved hate-table entry: the player itself, or the
 *  LIVING player who owns a pet entry (a pet still trading blows after its owner
 *  died must not re-flag the corpse). A mob-owned add or an NPC entry resolves
 *  to nobody. */
function playerBehind(ctx: SimContext, entry: Entity): number | null {
  if (entry.kind === 'player') return entry.id;
  if (entry.ownerId === null) return null;
  const owner = ctx.entities.get(entry.ownerId);
  return owner?.kind === 'player' && !owner.dead ? owner.id : null;
}

// Is this group member part of the boss's encounter: inside the boss's slot
// (the whole raid room) when the boss fights in an instance, else within the
// open-world encounter radius.
function memberInEncounter(boss: Entity, bossSlot: InstanceSlot | null, member: Entity): boolean {
  if (bossSlot !== null) return !attackerLeftInstance(bossSlot, member);
  return dist2d(member.pos, boss.pos) <= BOSS_ENCOUNTER_COMBAT_RANGE;
}

function holdEncounterGroup(
  ctx: SimContext,
  boss: Entity,
  bossSlot: InstanceSlot | null,
  pid: number,
  seenParties: Set<number>,
  out: Set<number>,
): void {
  const party = ctx.partyOf(pid);
  if (!party || seenParties.has(party.id)) return;
  seenParties.add(party.id);
  for (const memberId of party.members) {
    const member = ctx.entities.get(memberId);
    if (!member || member.dead) continue;
    if (!memberInEncounter(boss, bossSlot, member)) continue;
    // A quest-gated boss never pulls a member its own damage gate would refuse
    // (the same rule healing threat applies in combat/heal.ts).
    if (questGateBlocksAggro(ctx.players, boss, member)) continue;
    out.add(memberId);
  }
}

// Has this attacker left the mob's fight: out of the slot for an instance mob,
// beyond THREAT_DROP_RANGE in the open world. A chain-pulled mob crossing to
// its puller is meant to arrive (mob/chain_pull_transit.ts suspends its leash
// the same way), so the open-world reach waits until it has spent that grace.
function attackerLeftFight(mob: Entity, mobSlot: InstanceSlot | null, entry: Entity): boolean {
  if (mobSlot !== null) return attackerLeftInstance(mobSlot, entry);
  return !mob.chainPullInbound && beyondThreatRange(mob, entry);
}

// One walk of the mob's hate table: an entry that left the fight is dropped (the
// mob's next target pass swings to whoever is left, or it evades home on an
// empty table); every other entry (and the player behind a pet entry) is held,
// and for an encounter boss each attacker's group is held too.
function holdHateTable(
  ctx: SimContext,
  mob: Entity,
  encounterBoss: boolean,
  out: Set<number>,
  counters: MobScanCounters,
): void {
  // Allocated per engaged BOSS per tick only (never per add or per entry), so it
  // is deliberately a local rather than a hoisted scratch structure.
  const seenParties = encounterBoss ? new Set<number>() : null;
  // Resolved once per mob: the claimed slot it fights in, or null in the open
  // world (a cheap x-band early-out there).
  const mobSlot = claimedSlotOf(ctx, mob);
  for (const id of mob.threat.keys()) {
    counters.threatEntryVisits++;
    // One lookup per entry: the reach test, the owner resolution, and the
    // hold all read this same entity.
    const entry = ctx.entities.get(id);
    if (entry && attackerLeftFight(mob, mobSlot, entry)) {
      // Deleting the current key mid-iteration is safe on a Map. dropThreat also
      // releases a taunt lock on the dropped id; the target pointer goes with it.
      dropThreat(mob, id);
      if (mob.aggroTargetId === id) mob.aggroTargetId = null;
      continue;
    }
    out.add(id);
    if (!entry) continue;
    const pid = playerBehind(ctx, entry);
    if (pid === null) continue;
    out.add(pid);
    if (seenParties) holdEncounterGroup(ctx, mob, mobSlot, pid, seenParties, out);
  }
  // The current target is normally on the table already (aggro seeds it); keep
  // it explicitly so a table pruned this tick cannot open a one-tick gap.
  if (mob.aggroTargetId !== null) {
    out.add(mob.aggroTargetId);
    const target = ctx.entities.get(mob.aggroTargetId);
    const pid = target ? playerBehind(ctx, target) : null;
    if (pid !== null) out.add(pid);
  }
}

/**
 * Fill `out` with every entity id an engaged mob or fighting pet holds in combat
 * this tick, dropping out-of-reach attackers off the hate tables on the way.
 * One pass over the entities instead of one scan per player; the coordinator
 * then sets each player's `inCombat` from the set plus their own 5s linger. The
 * set may carry pet, mob, or departed ids too: readers only ever ask
 * `has(playerId)`.
 */
export function collectEngagedPids(ctx: SimContext, out: Set<number>): void {
  out.clear();
  // Resolved once per pass, not per entry: the ctx member is a live getter chain.
  const counters = ctx.mobScanCounters;
  for (const e of ctx.entities.values()) {
    if (e.kind !== 'mob' || e.dead) continue;
    if (e.ownerId !== null) {
      // A player's pet that is actively fighting keeps its owner in combat. A
      // pet merely holding a target it is not trading blows with (out of reach,
      // stale) must not freeze the owner's health regen indefinitely.
      if (e.aggroTargetId !== null && e.combatTimer < PET_COMBAT_LINGER) out.add(e.ownerId);
      continue;
    }
    if (!mobEngaged(e)) continue;
    const template = MOBS[e.templateId];
    // A practice dummy never fights back; it must not hold anyone past the linger.
    if (template?.dummy === true) continue;
    holdHateTable(ctx, e, isEncounterBoss(template), out, counters);
  }
}

/**
 * Whether an enemy held this player in combat on the most recent tick (as
 * opposed to the player's own post-event linger). Reads the coordinator's
 * cached pass output, so a command-driven readout never re-walks the world.
 */
export function isHeldInCombat(ctx: SimContext, playerId: number): boolean {
  return ctx.engagedPids.has(playerId);
}
