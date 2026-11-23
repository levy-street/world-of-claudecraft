// The Gravewyrm Sanctum's three heroic trinkets (data in src/sim/content/
// trinkets.ts, docs/design/dungeon-rework/gravewyrm_sanctum.md 9.2), split out
// of combat/trinkets.ts, whose useWornTrinket switch calls the three use arms.
//
//   Foreman's Last Link (tether): a chain to an ally. The ally wears the
//     tether aura (sourceId = the wearer); while it holds, a share of the
//     damage that reaches the ally's health moves to the wearer instead
//     (dealDamage calls tetherRedirect beside the Affliction transfer). The
//     share is moved, never removed, and is dealt already final (no second
//     mitigation, no second redirect).
//   Phial of the Tithe (harvest): for its window every hostile mob that dies
//     within the radius pays the wearer a share of its maximum health and mana
//     (dealDamage's death block calls onHarvestDeath, the one place every
//     death resolves).
//   Quenchwater Flask (quench): charges on the wearer; each weapon hit spends
//     one for bonus frost damage, and the last one quenches the target (its
//     attacks slow). Rides the weaponHit trinket trigger.
//
// Determinism: no rng draws (every amount is fixed by the spec and the
// wearer's live stats); players are visited in the sim's own player order.

import { TRINKET_AURA, type TrinketUse } from '../content/trinkets';
import type { SimContext } from '../sim_context';
import type { Aura, Entity } from '../types';
import { applyHeal } from './heal';

type UseOf<K extends TrinketUse['kind']> = Extract<TrinketUse, { kind: K }>;

/** The ability names the three trinkets deal and heal under (localized
 *  through the trinket's own item name, TRINKET_NAMED_AURA_ITEM_IDS). */
export const LAST_LINK_NAME = "Foreman's Last Link";
export const TITHE_NAME = 'Phial of the Tithe';
export const QUENCH_NAME = 'Quenchwater Flask';
/** The quench's attack slow aura name. */
export const QUENCHED_NAME = 'Quenched';
/** The redirected share's ability id, so it never redirects again. */
const TETHER_REDIRECT_ID = 'sanctum_tether_redirect';

function ownAura(e: Entity, id: string): Aura | undefined {
  for (const aura of e.auras) if (aura.id === id && aura.sourceId === e.id) return aura;
  return undefined;
}

function fx(ctx: SimContext, from: Entity, to: Entity, school: string, ability: string): void {
  ctx.emit({
    type: 'spellfx',
    sourceId: from.id,
    targetId: to.id,
    school,
    fx: 'selfCast',
    ability,
  });
}

// ---- Foreman's Last Link ------------------------------------------------------

/** The ally the wearer can chain: a living friendly player other than the
 *  wearer, selected, within `range`. */
export function tetherTarget(ctx: SimContext, p: Entity, range: number): Entity | null {
  const ally = p.targetId === null ? undefined : ctx.entities.get(p.targetId);
  if (!ally || ally.dead || ally.id === p.id || ally.kind !== 'player') return null;
  if (!ctx.isFriendlyTo(p, ally)) return null;
  if (Math.hypot(ally.pos.x - p.pos.x, ally.pos.z - p.pos.z) > range) return null;
  return ally;
}

/** Chain the wearer to the ally: the tether on the ally (the share it moves)
 *  and the link marker on the wearer (whom it is chained to). */
export function applyTether(ctx: SimContext, p: Entity, ally: Entity, use: UseOf<'tether'>): void {
  ctx.applyAura(ally, {
    id: TRINKET_AURA.tether,
    name: LAST_LINK_NAME,
    kind: 'internal_cd',
    remaining: use.duration,
    duration: use.duration,
    value: use.share,
    sourceId: p.id,
    school: 'physical',
  });
  ctx.applyAura(p, {
    id: TRINKET_AURA.tetherLink,
    name: LAST_LINK_NAME,
    kind: 'internal_cd',
    remaining: use.duration,
    duration: use.duration,
    value: ally.id,
    sourceId: p.id,
    school: 'physical',
  });
  fx(ctx, p, ally, 'physical', 'trinket_foremans_last_link');
}

/** The share of `amount` (damage about to reach `target`'s health) the tether
 *  moves to its wearer, dealt to the wearer now; returns what is left for the
 *  target. A self hit, a sourceless hit, a dead or absent wearer, or a share
 *  already redirected moves nothing. */
export function tetherRedirect(
  ctx: SimContext,
  source: Entity | null,
  target: Entity,
  amount: number,
  school: string,
  abilityId: string | null,
): number {
  if (amount <= 0 || !source || source.id === target.id || abilityId === TETHER_REDIRECT_ID)
    return amount;
  if (target.kind !== 'player' || target.auras.length === 0) return amount;
  const tether = target.auras.find((a) => a.id === TRINKET_AURA.tether);
  if (!tether || tether.sourceId === target.id) return amount;
  const wearer = ctx.entities.get(tether.sourceId);
  if (!wearer || wearer.dead || wearer.hp <= 0) return amount;
  const share = Math.min(amount, Math.round(amount * tether.value));
  if (share <= 0) return amount;
  ctx.dealDamage(
    null,
    wearer,
    share,
    false,
    school,
    LAST_LINK_NAME,
    'hit',
    true,
    undefined,
    false,
    false,
    true,
    TETHER_REDIRECT_ID,
  );
  return amount - share;
}

// ---- Phial of the Tithe -------------------------------------------------------

export function applyHarvest(ctx: SimContext, p: Entity, use: UseOf<'harvest'>): void {
  ctx.applyAura(p, {
    id: TRINKET_AURA.harvest,
    name: TITHE_NAME,
    kind: 'internal_cd',
    remaining: use.duration,
    duration: use.duration,
    value: use.restore,
    // The radius rides the aura so the death hook needs no spec lookup.
    value2: use.radius,
    sourceId: p.id,
    school: 'shadow',
  });
  fx(ctx, p, p, 'shadow', 'trinket_phial_of_the_tithe');
}

/** A creature died (dealDamage's death block): every Phial wearer within its
 *  radius who counts it an enemy is paid its share of health and mana. */
export function onHarvestDeath(ctx: SimContext, dead: Entity): void {
  if (dead.kind !== 'mob' || dead.ownerId !== null) return;
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (!p || p.dead || p.auras.length === 0) continue;
    const harvest = ownAura(p, TRINKET_AURA.harvest);
    if (!harvest) continue;
    const radius = harvest.value2 ?? 0;
    if (Math.hypot(dead.pos.x - p.pos.x, dead.pos.z - p.pos.z) > radius) continue;
    if (!ctx.isHostileTo(p, dead)) continue;
    const health = Math.round(p.maxHp * harvest.value);
    if (health > 0 && p.hp < p.maxHp)
      applyHeal(ctx, p, p, health, TITHE_NAME, null, false, false, false, true);
    if (p.resourceType === 'mana' && p.maxResource > 0)
      p.resource = Math.min(p.maxResource, p.resource + Math.round(p.maxResource * harvest.value));
    fx(ctx, dead, p, 'shadow', 'trinket_tithe_paid');
  }
}

// ---- Quenchwater Flask --------------------------------------------------------

export function applyQuench(ctx: SimContext, p: Entity, use: UseOf<'quench'>): void {
  ctx.applyAura(p, {
    id: TRINKET_AURA.quench,
    name: QUENCH_NAME,
    kind: 'internal_cd',
    remaining: use.duration,
    duration: use.duration,
    value: use.hits,
    stacks: use.hits,
    sourceId: p.id,
    school: 'frost',
  });
  fx(ctx, p, p, 'frost', 'trinket_quenchwater_flask');
}

/** One quench strike's frost damage for a wearer of this Attack Power. */
export function quenchDamage(use: UseOf<'quench'>, attackPower: number): number {
  return Math.max(1, Math.round(use.flat + use.coef * attackPower));
}

/** The swing-interval stretch the quench lays on its target (slower attacks
 *  by `slow`: the interval x 1 / (1 - slow)). */
export function quenchSlowMult(use: UseOf<'quench'>): number {
  return 1 / (1 - use.slow);
}

/** A weapon hit landed while the flask is charged: spend one charge for the
 *  frost; the last charge quenches the target. */
export function quenchStrike(
  ctx: SimContext,
  p: Entity,
  target: Entity,
  use: UseOf<'quench'>,
): void {
  const charges = ownAura(p, TRINKET_AURA.quench);
  if (!charges || (charges.stacks ?? 0) <= 0) return;
  const left = (charges.stacks ?? 0) - 1;
  if (left <= 0) {
    const i = p.auras.indexOf(charges);
    if (i >= 0) p.auras.splice(i, 1);
    ctx.emit({ type: 'aura', targetId: p.id, name: charges.name, gained: false });
  } else {
    charges.stacks = left;
    charges.value = left;
  }
  ctx.dealDamage(
    p,
    target,
    quenchDamage(use, Math.max(p.attackPower, p.rangedPower)),
    false,
    'frost',
    QUENCH_NAME,
    'hit',
    true,
    undefined,
    false,
  );
  if (left > 0 || target.dead) return;
  ctx.applyAura(target, {
    id: TRINKET_AURA.quenched,
    name: QUENCHED_NAME,
    kind: 'attackspeed',
    remaining: use.slowDuration,
    duration: use.slowDuration,
    value: quenchSlowMult(use),
    sourceId: p.id,
    school: 'frost',
  });
  fx(ctx, p, target, 'frost', 'trinket_quenched');
}
