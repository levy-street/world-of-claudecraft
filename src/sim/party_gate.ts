// Party gates: the mage Grand Portal and the warlock Hellgate, on the Soulwell
// doctrine (soulwell.ts): a summoned interactable whose eligible roster is
// captured at cast and widened by later joins, the server owning every
// decision. A portal moves an eligible clicker; a gate pulls the owner's
// eligible TARGET to it. Pure sim module: no rng, no clock, no DOM.

import { isBlocked } from './colliders';
import { GRAND_PORTAL_OBJECT_ITEM_ID, grandTeleportDestination } from './content/grand_teleports';
import { HELLGATE_BLEED_AURA_ID, HELLGATE_OBJECT_ITEM_ID } from './content/hellgate';
import { displacePlayer } from './displacement';
import { createGroundObject } from './entity';
import type { SimContext } from './sim_context';
import type { Entity, Vec3 } from './types';
import { vaultDrawBlocked } from './vault_craft_gate';

/** On an instanced plane (dungeon, arena, battleground, delve)? A gate never
 *  carries anyone into or out of one. vault_craft_gate.ts owns the sim's one
 *  plane classifier; this wrapper names the travel question so the two rules
 *  can part ways deliberately, never by drift. */
function onInstancedPlane(ctx: SimContext, pid: number): boolean {
  return vaultDrawBlocked(ctx, pid);
}

export const GRAND_PORTAL_TEMPLATE_ID = 'grand_portal';
export const HELLGATE_TEMPLATE_ID = 'hellgate';
export const PARTY_GATE_FOOTPRINT_RADIUS = 1.6;

type PartyGateState = NonNullable<Entity['partyGate']>;

// The Soulwell placement fan: front first, then a fixed ring of offsets at
// growing distances, in a deterministic order for parity.
const SPAWN_DISTANCES = [2.6, 3.4, 4.2, 4.8] as const;
const SPAWN_ANGLE_OFFSETS = [0, 0.5, -0.5, 1, 0.25, -0.25, 0.75, -0.75].map((k) => k * Math.PI);

function overlapsGroundObject(
  ctx: SimContext,
  casterId: number,
  x: number,
  z: number,
  footprint: number,
): boolean {
  for (const entity of ctx.entities.values()) {
    if (entity.id === casterId || entity.kind !== 'object') continue;
    if (Math.hypot(entity.pos.x - x, entity.pos.z - z) < footprint + 0.8) return true;
  }
  return false;
}

function gateSpawnPosition(ctx: SimContext, caster: Entity, footprint: number): Vec3 | null {
  for (const distance of SPAWN_DISTANCES) {
    for (const offset of SPAWN_ANGLE_OFFSETS) {
      const angle = caster.facing + offset;
      const x = caster.pos.x + Math.sin(angle) * distance;
      const z = caster.pos.z + Math.cos(angle) * distance;
      if (
        !isBlocked(ctx.cfg.seed, x, z, footprint) &&
        !overlapsGroundObject(ctx, caster.id, x, z, footprint)
      ) {
        return ctx.groundPos(x, z);
      }
    }
  }
  // No reachable footprint: refuse rather than intersect scenery (the caller
  // refunds the cast and reports the missing room).
  return null;
}

function isOwnedGate(entity: Entity, objectItemId: string, ownerId: number): boolean {
  return (
    entity.kind === 'object' &&
    entity.objectItemId === objectItemId &&
    entity.partyGate?.ownerId === ownerId
  );
}

function summonGate(
  ctx: SimContext,
  caster: Entity,
  objectItemId: string,
  name: string,
  templateId: string,
  duration: number,
  destination?: string,
): Entity | null {
  const spawnPosition = gateSpawnPosition(ctx, caster, PARTY_GATE_FOOTPRINT_RADIUS);
  if (!spawnPosition) return null;
  // One live gate of each kind per caster: the old one leaves the roster
  // before the new one enters it, so clients never see two usable gates.
  for (const entity of [...ctx.entities.values()]) {
    if (isOwnedGate(entity, objectItemId, caster.id)) ctx.dropEntity(entity.id);
  }
  const gate = createGroundObject(ctx.nextId++, objectItemId, name, spawnPosition);
  gate.templateId = templateId;
  gate.despawnTimer = duration;
  const party = ctx.partyOf(caster.id);
  const state: PartyGateState = {
    ownerId: caster.id,
    partyId: party?.id ?? null,
    eligiblePlayerIds: [...new Set([caster.id, ...(party?.members ?? [])])],
  };
  if (destination !== undefined) state.destination = destination;
  gate.partyGate = state;
  ctx.addEntity(gate);
  return gate;
}

export function summonGrandPortal(
  ctx: SimContext,
  caster: Entity,
  destination: string,
  duration: number,
): Entity | null {
  if (!grandTeleportDestination(destination)) return null;
  return summonGate(
    ctx,
    caster,
    GRAND_PORTAL_OBJECT_ITEM_ID,
    'Grand Portal',
    GRAND_PORTAL_TEMPLATE_ID,
    duration,
    destination,
  );
}

export function summonHellgate(ctx: SimContext, caster: Entity, duration: number): Entity | null {
  return summonGate(
    ctx,
    caster,
    HELLGATE_OBJECT_ITEM_ID,
    'Hellgate',
    HELLGATE_TEMPLATE_ID,
    duration,
  );
}

function rememberEligiblePlayer(state: PartyGateState, playerId: number): void {
  if (!state.eligiblePlayerIds.includes(playerId)) state.eligiblePlayerIds.push(playerId);
}

/** Party join hook (social/party.ts): a late joiner of the owner's group may use the gate. */
export function rememberPartyGateEligibility(
  ctx: SimContext,
  party: { members: readonly number[] },
): void {
  for (const entity of ctx.entities.values()) {
    const state = entity.partyGate;
    if (!state || !party.members.includes(state.ownerId)) continue;
    for (const memberId of party.members) rememberEligiblePlayer(state, memberId);
  }
}

/** The Soulwell eligibility rule: captured at cast, or still in the owner's
 *  ORIGINAL party (same party id) right now. */
function isEligible(ctx: SimContext, state: PartyGateState, playerId: number): boolean {
  if (state.eligiblePlayerIds.includes(playerId)) return true;
  const ownerParty = ctx.partyOf(state.ownerId);
  const isOriginalPartyMember =
    state.partyId !== null &&
    ownerParty?.id === state.partyId &&
    ownerParty.members.includes(playerId);
  if (!isOriginalPartyMember) return false;
  if (ownerParty) rememberPartyGateEligibility(ctx, ownerParty);
  return true;
}

function interactGrandPortal(
  ctx: SimContext,
  gate: Entity,
  state: PartyGateState,
  actorId: number,
): void {
  if (!isEligible(ctx, state, actorId)) {
    ctx.error(actorId, 'That ally is not in your group.');
    return;
  }
  const actor = ctx.entities.get(actorId);
  if (actor?.kind !== 'player' || actor.dead) return;
  if (actor.inCombat) {
    ctx.error(actorId, "You can't do that while in combat.");
    return;
  }
  // The portal only carries people OUT of the open world: an instance,
  // arena, battleground or delve never gets a free exit (or entry) this way.
  if (onInstancedPlane(ctx, actorId)) {
    ctx.error(actorId, 'You cannot step through from here.');
    return;
  }
  const dest = state.destination ? grandTeleportDestination(state.destination) : undefined;
  if (!dest) {
    // A gate without a resolvable destination is a corrupt record: drop it.
    ctx.dropEntity(gate.id);
    return;
  }
  displacePlayer(ctx, actor, dest.landing, `You step through the portal to ${dest.town}.`);
}

function interactHellgate(
  ctx: SimContext,
  gate: Entity,
  state: PartyGateState,
  actorId: number,
): void {
  if (actorId !== state.ownerId) {
    ctx.error(actorId, 'Only the warlock who opened the gate can use it.');
    return;
  }
  const owner = ctx.entities.get(actorId);
  if (!owner || owner.dead) return;
  if (owner.inCombat) {
    ctx.error(actorId, "You can't do that while in combat.");
    return;
  }
  const targetId = owner.targetId;
  const target = targetId === null ? undefined : ctx.entities.get(targetId);
  if (target?.kind !== 'player' || target.id === owner.id || !isEligible(ctx, state, target.id)) {
    ctx.error(actorId, 'Target a group member to summon them.');
    return;
  }
  if (target.dead || onInstancedPlane(ctx, target.id)) {
    ctx.error(actorId, 'That ally cannot be summoned from where they are.');
    return;
  }
  displacePlayer(
    ctx,
    target,
    { x: gate.pos.x, z: gate.pos.z, facing: target.facing },
    'You are pulled through the Hellgate.',
  );
}

/**
 * Returns false only when `object` is not a party gate. A true result means
 * the gate owned the interaction, including a safely refused attempt.
 */
export function interactPartyGate(ctx: SimContext, object: Entity, actorId: number): boolean {
  const state = object.partyGate;
  if (object.kind !== 'object' || !state) return false;
  if (object.objectItemId === GRAND_PORTAL_OBJECT_ITEM_ID) {
    interactGrandPortal(ctx, object, state, actorId);
    return true;
  }
  if (object.objectItemId === HELLGATE_OBJECT_ITEM_ID) {
    interactHellgate(ctx, object, state, actorId);
    return true;
  }
  return false;
}

/**
 * Per-tick sweep (sim.ts, right after runDespawnDecay): a Hellgate dies with
 * its warlock. When the owner is gone, dead, or otherwise out of the world
 * the gate drops and the owner's toll aura ends early with it. A Grand Portal
 * deliberately outlives its mage: the group it was opened for keeps the exit.
 * Cost: one pass over the entity map (the same walk runDespawnDecay just made)
 * with a two-field reject per entity and no allocation until a gate is doomed;
 * a standing Hellgate is rare, so the owner lookup is the only extra read.
 * Draws no rng.
 */
export function updatePartyGates(ctx: SimContext): void {
  const doomed: Entity[] = [];
  for (const entity of ctx.entities.values()) {
    if (!entity.partyGate || entity.objectItemId !== HELLGATE_OBJECT_ITEM_ID) continue;
    const owner = ctx.entities.get(entity.partyGate.ownerId);
    if (owner?.kind === 'player' && !owner.dead && owner.hp > 0) continue;
    doomed.push(entity);
  }
  if (doomed.length === 0) return;
  for (const gate of doomed) {
    ctx.dropEntity(gate.id);
    const owner = ctx.entities.get(gate.partyGate?.ownerId ?? -1);
    if (!owner) continue;
    const idx = owner.auras.findIndex((a) => a.id === HELLGATE_BLEED_AURA_ID);
    if (idx >= 0) {
      const [aura] = owner.auras.splice(idx, 1);
      ctx.emit({ type: 'aura', targetId: owner.id, name: aura.name, gained: false });
    }
  }
}
