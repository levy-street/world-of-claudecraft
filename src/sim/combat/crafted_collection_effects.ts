// Shared two-piece crafting signatures. All transient state rides existing auras;
// no persistent counters, global state, or random draws. The damage and healing
// hubs report resolved results, including pets, periodic effects, and conversion.
import { crucibleCollectionFamilyForSet } from '../content/crucible_collections';
import type { SimContext } from '../sim_context';
import type { Aura, Entity } from '../types';

const PREFIX = 'crafted_collection_';
const TANK_COOLDOWN_ID = `${PREFIX}tank_cooldown`;
export const CRAFTED_CHARGES_REQUIRED = 6;
export const CRAFTED_CHARGE_INTERVAL = 1;
export const CRAFTED_CHARGE_LIFETIME = 8;
export const CRAFTED_DAMAGE_BONUS = 0.08;
export const CRAFTED_WINDOW_SECONDS = 6;
export const CRAFTED_TANK_DAMAGE_THRESHOLD = 0.4;
export const CRAFTED_TANK_BANK_SECONDS = 10;
export const CRAFTED_TANK_ABSORB_FRACTION = 0.08;
export const CRAFTED_TANK_COOLDOWN_SECONDS = 20;
export const CRAFTED_OVERHEAL_FRACTION = 0.2;
export const CRAFTED_OVERHEAL_CAP_FRACTION = 0.05;

export function isCraftedCollectionAura(id: string): boolean {
  return id.startsWith(PREFIX);
}

function stateId(entity: Entity, suffix: string): string {
  return `${PREFIX}${entity.craftedCollectionId}_${suffix}`;
}

function activeAura(entity: Entity, id: string): Aura | undefined {
  return entity.auras.find((aura) => aura.id === id && aura.remaining > 0);
}

function marker(entity: Entity, id: string, value: number, duration: number): void {
  const next: Aura = {
    id,
    name: 'Crafted Collection',
    kind: 'internal_cd',
    value,
    duration,
    remaining: duration,
    sourceId: entity.id,
    school: 'physical',
  };
  const index = entity.auras.findIndex((aura) => aura.id === id);
  if (index < 0) entity.auras.push(next);
  else entity.auras[index] = next;
}

/** Recalc-owned derived selection; switching gear cannot bank an offensive buff.
 * The fixed defensive cooldown survives gear swaps, including swaps in combat. */
export function resetCraftedCollectionState(entity: Entity, nextId: string | undefined): void {
  if (entity.craftedCollectionId === nextId) return;
  entity.craftedCollectionId = nextId;
  entity.auras = entity.auras.filter(
    (aura) =>
      !isCraftedCollectionAura(aura.id) ||
      aura.sourceId !== entity.id ||
      aura.id === TANK_COOLDOWN_ID,
  );
}

/** Recipient-side revalidation also runs before absorbs, so a gear change or
 * owner death cannot leave usable protection until the next recipient tick. */
export function cleanupCraftedCollectionAuras(ctx: SimContext, entity: Entity): void {
  let healingRoom = Math.max(0, Math.floor(entity.maxHp * CRAFTED_OVERHEAL_CAP_FRACTION));
  for (let index = entity.auras.length - 1; index >= 0; index--) {
    const aura = entity.auras[index];
    if (!isCraftedCollectionAura(aura.id) || aura.id === TANK_COOLDOWN_ID) continue;
    const source = ctx.entities.get(aura.sourceId);
    const valid =
      !entity.dead &&
      entity.inCombat &&
      source &&
      !source.dead &&
      source.inCombat &&
      source.craftedCollectionId &&
      aura.id.startsWith(`${PREFIX}${source.craftedCollectionId}_`);
    if (valid) {
      if (!aura.id.endsWith('_heal_ward')) continue;
      aura.value = Math.min(aura.value, healingRoom);
      healingRoom -= aura.value;
      if (aura.value > 0) continue;
    }
    entity.auras.splice(index, 1);
    if (aura.kind !== 'internal_cd') {
      ctx.emit({ type: 'aura', targetId: entity.id, name: aura.name, gained: false });
    }
  }
}

function collectionOwner(ctx: SimContext, source: Entity | null): Entity | undefined {
  if (!source || source.dead) return undefined;
  const owner =
    source.kind === 'player'
      ? source
      : source.ownerId !== null
        ? ctx.entities.get(source.ownerId)
        : undefined;
  return owner?.kind === 'player' && !owner.dead && owner.inCombat && owner.craftedCollectionId
    ? owner
    : undefined;
}

/** Same additive damage-done bucket as the wearer's buff, never a summon snapshot. */
export function craftedPetDamageMultiplier(ctx: SimContext, source: Entity): number {
  if (source.kind === 'player') return 1;
  const owner = collectionOwner(ctx, source);
  if (!owner) return 1;
  const powerAura = activeAura(owner, stateId(owner, 'power'));
  return powerAura ? 1 + powerAura.value : 1;
}

function advanceDamageWindow(ctx: SimContext, owner: Entity): void {
  if (activeAura(owner, stateId(owner, 'power')) || activeAura(owner, stateId(owner, 'rate')))
    return;
  const id = stateId(owner, 'charges');
  const count = (activeAura(owner, id)?.value ?? 0) + 1;
  if (count < CRAFTED_CHARGES_REQUIRED) {
    marker(owner, id, count, CRAFTED_CHARGE_LIFETIME);
    marker(owner, stateId(owner, 'rate'), 0, CRAFTED_CHARGE_INTERVAL);
    return;
  }
  owner.auras = owner.auras.filter((aura) => aura.id !== id);
  ctx.applyAura(owner, {
    id: stateId(owner, 'power'),
    name: 'Crafted Momentum',
    kind: 'buff_dmg_done',
    value: CRAFTED_DAMAGE_BONUS,
    remaining: CRAFTED_WINDOW_SECONDS,
    duration: CRAFTED_WINDOW_SECONDS,
    sourceId: owner.id,
    school: 'physical',
  });
}

function accumulateTankDamage(ctx: SimContext, target: Entity, hpLoss: number): void {
  if (
    target.hp <= 0 ||
    target.dead ||
    !target.inCombat ||
    !target.craftedCollectionId ||
    crucibleCollectionFamilyForSet(target.craftedCollectionId) !== 'tank' ||
    activeAura(target, TANK_COOLDOWN_ID)
  )
    return;
  const id = stateId(target, 'damage_bank');
  const bank = activeAura(target, id);
  const next = (bank?.value ?? 0) + hpLoss;
  if (next < target.maxHp * CRAFTED_TANK_DAMAGE_THRESHOLD) {
    marker(target, id, next, bank?.remaining ?? CRAFTED_TANK_BANK_SECONDS);
    return;
  }
  target.auras = target.auras.filter((aura) => aura.id !== id);
  marker(target, TANK_COOLDOWN_ID, 0, CRAFTED_TANK_COOLDOWN_SECONDS);
  ctx.applyAura(target, {
    id: stateId(target, 'tank_ward'),
    name: 'Crafted Shelter',
    kind: 'absorb',
    value: Math.round(target.maxHp * CRAFTED_TANK_ABSORB_FRACTION),
    remaining: CRAFTED_WINDOW_SECONDS,
    duration: CRAFTED_WINDOW_SECONDS,
    sourceId: target.id,
    school: 'physical',
  });
}

export function onCraftedCollectionDamage(
  ctx: SimContext,
  source: Entity | null,
  target: Entity,
  hpLoss: number,
  school: string,
  direct: boolean,
  alreadyResolved = false,
): void {
  if (
    !source ||
    source.id === target.id ||
    hpLoss <= 0 ||
    alreadyResolved ||
    // Sim's player-target hostility arm describes PvP. For unowned hostile
    // mobs, ask the player's targeting relation in the opposite direction.
    (!ctx.isHostileTo(source, target) &&
      !(source.kind === 'mob' && source.ownerId === null && ctx.isHostileTo(target, source)))
  )
    return;
  accumulateTankDamage(ctx, target, hpLoss);
  const owner = collectionOwner(ctx, source);
  if (!owner?.craftedCollectionId) return;
  const family = crucibleCollectionFamilyForSet(owner.craftedCollectionId);
  if (
    (family === 'physical' && direct && school === 'physical') ||
    (family === 'caster' && school !== 'physical')
  )
    advanceDamageWindow(ctx, owner);
}

export function onCraftedCollectionHeal(
  ctx: SimContext,
  source: Entity,
  target: Entity,
  overheal: number,
): void {
  if (
    overheal <= 0 ||
    source.dead ||
    target.dead ||
    !source.inCombat ||
    !target.inCombat ||
    !source.craftedCollectionId ||
    crucibleCollectionFamilyForSet(source.craftedCollectionId) !== 'healer'
  )
    return;
  cleanupCraftedCollectionAuras(ctx, target);
  const wards = target.auras.filter(
    (aura) =>
      isCraftedCollectionAura(aura.id) && aura.id.endsWith('_heal_ward') && aura.remaining > 0,
  );
  const total = wards.reduce((sum, aura) => sum + aura.value, 0);
  const added = Math.min(
    Math.floor(overheal * CRAFTED_OVERHEAL_FRACTION),
    Math.max(0, Math.floor(target.maxHp * CRAFTED_OVERHEAL_CAP_FRACTION) - total),
  );
  if (added <= 0) return;
  const id = stateId(source, 'heal_ward');
  const ownWard = wards.find((aura) => aura.id === id && aura.sourceId === source.id);
  // Additional healing may fill the original reserve, but cannot renew its age.
  // Other healers have their own expiry; nobody refreshes somebody else's ward.
  ctx.applyAura(target, {
    id,
    name: 'Crafted Preservation',
    kind: 'absorb',
    value: (ownWard?.value ?? 0) + added,
    remaining: ownWard?.remaining ?? CRAFTED_WINDOW_SECONDS,
    duration: CRAFTED_WINDOW_SECONDS,
    sourceId: source.id,
    school: 'holy',
  });
}
