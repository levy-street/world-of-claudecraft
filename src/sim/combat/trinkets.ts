// The trinkets' mechanics (the data is src/sim/content/trinkets.ts): using the
// equipped trinket from the action bar, and the passives a worn trinket runs off
// the combat hooks the gear procs already ride.
//
// Using: useItem (src/sim/items.ts) routes a use of the item worn in the trinket
// slot here instead of to the bag-consumable arms. The use is off the global
// cooldown and rides the wearer's own cooldown map under trinketCooldownKey, so
// the client mirror and the relog persistence treat it like an ability's.
//
// Passives: called from the hooks the set and weapon procs already use (a weapon
// hit, a weapon crit, a spell cast, a kill), from dealDamage after the hit lands,
// and from applyHeal after the heal lands. Every hook returns before touching the
// rng unless the entity wears a trinket whose passive listens to it, so every
// character without one plays exactly as before.
//
// State lives in auras on the wearer (the tally marks, the storm charges, the
// hourglass's stored healing, the echo's remaining casts), so the buff bar shows
// it and nothing new rides the entity or the wire.

import { isPlayerRemovableAura } from '../aura_classify';
import {
  GAMBLE,
  GAMBLE_FORTUNES,
  TRINKET_AURA,
  TRINKET_SPECS,
  type TrinketPassive,
  type TrinketSpec,
  trinketCooldownKey,
  trinketSpec,
} from '../content/trinkets';
import { ITEMS } from '../data';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { duelJustEndedBetween } from '../social/duel';
import { type Aura, type Entity, MELEE_RANGE } from '../types';
import { meleeSwing } from './auto_attack';
import { isUnbreakableControlAura } from './cc';
import { applyHeal } from './heal';
import { relocateSwept } from './heroic_leap';

/** The control kinds the Mooring Stone shrugs off and the Medallion breaks. */
const CONTROL_KINDS: ReadonlySet<string> = new Set([
  'stun',
  'root',
  'slow',
  'incapacitate',
  'polymorph',
  'forced_move',
  'silence',
  'blind',
  'hex',
  'disarm',
]);

/** The trinket an entity wears, with its spec, if it wears one that does
 *  something. Only players wear trinkets. */
export function wornTrinket(
  ctx: SimContext,
  e: Entity,
): { itemId: string; spec: TrinketSpec } | null {
  if (e.kind !== 'player') return null;
  const itemId = ctx.players.get(e.id)?.equipment?.trinket ?? null;
  const spec = trinketSpec(itemId);
  return itemId && spec ? { itemId, spec } : null;
}

function passiveOf(ctx: SimContext, e: Entity): TrinketPassive | undefined {
  return wornTrinket(ctx, e)?.spec.passive;
}

function findAura(e: Entity, id: string): Aura | undefined {
  for (const aura of e.auras) if (aura.id === id && aura.sourceId === e.id) return aura;
  return undefined;
}

function removeAura(ctx: SimContext, e: Entity, id: string): void {
  const index = e.auras.findIndex((aura) => aura.id === id && aura.sourceId === e.id);
  if (index < 0) return;
  const [aura] = e.auras.splice(index, 1);
  ctx.emit({ type: 'aura', targetId: e.id, name: aura.name, gained: false });
}

/** A counter the wearer keeps on its buff bar (tally marks, storm charges). */
function addStack(
  ctx: SimContext,
  e: Entity,
  id: string,
  name: string,
  max: number,
  duration: number,
): void {
  const held = findAura(e, id);
  const stacks = Math.min(max, (held?.stacks ?? 0) + 1);
  ctx.applyAura(e, {
    id,
    name,
    kind: 'internal_cd',
    remaining: duration,
    duration,
    value: stacks,
    stacks,
    sourceId: e.id,
    school: 'physical',
  });
}

function marker(e: Entity, id: string, name: string, duration: number, value = 0): Aura {
  return {
    id,
    name,
    kind: 'internal_cd',
    remaining: duration,
    duration,
    value,
    sourceId: e.id,
    school: 'arcane',
  };
}

// ---- using the trinket --------------------------------------------------------

/** Whether `itemId` is the trinket the player wears (useItem routes it here). */
export function isWornTrinket(meta: PlayerMeta, itemId: string): boolean {
  return meta.equipment.trinket === itemId && trinketSpec(itemId) !== undefined;
}

/** The hostile, living target the player has selected within `range`, if any. */
function hostileTarget(ctx: SimContext, p: Entity, range: number): Entity | null {
  const target = p.targetId === null ? undefined : ctx.entities.get(p.targetId);
  if (!target || target.dead || target.id === p.id || !ctx.isHostileTo(p, target)) return null;
  if (Math.hypot(target.pos.x - p.pos.x, target.pos.z - p.pos.z) > range) return null;
  return target;
}

/** The party (with the player) standing within `range` of the player, alive. */
function alliesNear(ctx: SimContext, p: Entity, range: number): Entity[] {
  const ids = ctx.partyOf(p.id)?.members ?? [p.id];
  const out: Entity[] = [];
  for (const id of ids.includes(p.id) ? ids : [...ids, p.id]) {
    const ally = ctx.entities.get(id);
    if (!ally || ally.dead) continue;
    if (Math.hypot(ally.pos.x - p.pos.x, ally.pos.z - p.pos.z) > range) continue;
    out.push(ally);
  }
  return out;
}

function isStunned(p: Entity): boolean {
  return p.auras.some(
    (aura) =>
      aura.kind === 'stun' ||
      aura.kind === 'incapacitate' ||
      aura.kind === 'polymorph' ||
      aura.kind === 'stasis',
  );
}

/** Seconds a freshly equipped trinket waits before it can be used (the classic
 *  on-equip lockout), so swapping trinkets can never chain two uses. */
export const TRINKET_EQUIP_LOCKOUT = 30;

/** A trinket just went into the slot (items.ts equipItem): start its use
 *  cooldown at the longest of its own remaining wait, the equip lockout, and
 *  the wait left on the trinket it replaced. Swapping out a trinket that was
 *  just used therefore hands its cooldown to the new one. No rng. */
export function onTrinketEquipped(p: Entity, itemId: string, replacedId?: string): void {
  if (!trinketSpec(itemId)) return;
  const key = trinketCooldownKey(itemId);
  const inherited =
    replacedId && replacedId !== itemId
      ? (p.cooldowns.get(trinketCooldownKey(replacedId)) ?? 0)
      : 0;
  p.cooldowns.set(key, Math.max(p.cooldowns.get(key) ?? 0, TRINKET_EQUIP_LOCKOUT, inherited));
}

/** Use the worn trinket. Returns false (and says why) when it cannot be used now;
 *  a refused use costs no cooldown. */
export function useWornTrinket(
  ctx: SimContext,
  meta: PlayerMeta,
  p: Entity,
  itemId: string,
): boolean {
  const spec = trinketSpec(itemId);
  const def = ITEMS[itemId];
  if (!spec || !def) return false;
  if (p.dead) {
    ctx.error(meta.entityId, 'You are dead.');
    return false;
  }
  const key = trinketCooldownKey(itemId);
  if ((p.cooldowns.get(key) ?? 0) > 0) {
    ctx.error(meta.entityId, 'That item is not ready yet.');
    return false;
  }
  // Only the Medallion of Defiance works while you cannot act: it is what frees you.
  if (spec.use.kind !== 'defiance' && isStunned(p)) {
    ctx.error(meta.entityId, "Can't do that while incapacitated.");
    return false;
  }
  let cooldown = spec.cooldown;
  const use = spec.use;
  switch (use.kind) {
    case 'retaliate': {
      ctx.applyAura(
        p,
        marker(p, TRINKET_AURA.retaliate, 'Retaliation Ward', use.duration, use.reflect),
      );
      fx(ctx, p, 'physical', 'trinket_bastion_sigil');
      break;
    }
    case 'anchor': {
      ctx.applyAura(p, marker(p, TRINKET_AURA.anchor, 'Moored', use.duration, use.speed));
      ctx.applyAura(p, {
        id: TRINKET_AURA.anchorGuard,
        name: 'Moored',
        kind: 'shield_wall',
        remaining: use.duration,
        duration: use.duration,
        value: use.reduction,
        sourceId: p.id,
        school: 'physical',
      });
      ctx.applyAura(p, {
        id: `${TRINKET_AURA.anchor}_slow`,
        name: 'Moored',
        kind: 'slow',
        remaining: use.duration,
        duration: use.duration,
        value: use.speed,
        sourceId: p.id,
        school: 'physical',
      });
      breakControl(ctx, p);
      fx(ctx, p, 'physical', 'trinket_mooring_stone');
      break;
    }
    case 'hourglass': {
      const store = findAura(p, TRINKET_AURA.hourglass);
      const stored = Math.round(store?.value ?? 0);
      if (stored <= 0) {
        ctx.error(meta.entityId, 'The hourglass is empty.');
        return false;
      }
      let lowest: Entity | null = null;
      for (const ally of alliesNear(ctx, p, use.range)) {
        if (!lowest || ally.hp / ally.maxHp < lowest.hp / lowest.maxHp) lowest = ally;
      }
      if (!lowest) return false;
      removeAura(ctx, p, TRINKET_AURA.hourglass);
      ctx.applyAura(lowest, {
        id: TRINKET_AURA.hourglassShield,
        name: "Mender's Hourglass",
        kind: 'absorb',
        remaining: use.duration,
        duration: use.duration,
        value: stored,
        sourceId: p.id,
        school: 'holy',
      });
      fx(ctx, lowest, 'holy', 'trinket_menders_hourglass');
      break;
    }
    case 'wellspring': {
      const tick = Math.round(use.tick + use.coef * p.healPower);
      for (const ally of alliesNear(ctx, p, use.radius)) {
        ctx.applyAura(ally, {
          id: TRINKET_AURA.wellspring,
          name: 'Wellspring',
          kind: 'hot',
          remaining: use.duration,
          duration: use.duration,
          value: tick,
          tickInterval: use.every,
          tickTimer: use.every,
          sourceId: p.id,
          school: 'nature',
        });
      }
      ctx.emit({
        type: 'spellfxAt',
        x: p.pos.x,
        z: p.pos.z,
        school: 'nature',
        fx: 'nova',
        ability: 'trinket_wellspring_seed',
        radius: use.radius,
        sourceId: p.id,
      });
      break;
    }
    case 'bleedEdge': {
      ctx.applyAura(p, marker(p, TRINKET_AURA.bleedEdge, 'Paired Talons', use.duration));
      fx(ctx, p, 'physical', 'trinket_paired_talons');
      break;
    }
    case 'tallyStrike': {
      const marks = findAura(p, TRINKET_AURA.tally)?.stacks ?? 0;
      if (marks <= 0) {
        ctx.error(meta.entityId, 'You have no tally marks to spend.');
        return false;
      }
      const target = hostileTarget(ctx, p, use.range);
      if (!target) {
        ctx.error(meta.entityId, 'You have no target.');
        return false;
      }
      removeAura(ctx, p, TRINKET_AURA.tally);
      const damage = Math.round(marks * (use.perMark + use.coef * p.attackPower));
      ctx.dealDamage(p, target, damage, false, 'physical', "Hunter's Tally", 'hit');
      fxOn(ctx, p, target, 'physical', 'trinket_hunters_tally');
      break;
    }
    case 'stormjar': {
      const charges = findAura(p, TRINKET_AURA.storm)?.stacks ?? 0;
      if (charges <= 0) {
        ctx.error(meta.entityId, 'The jar holds no charge.');
        return false;
      }
      const first = hostileTarget(ctx, p, use.range);
      if (!first) {
        ctx.error(meta.entityId, 'You have no target.');
        return false;
      }
      removeAura(ctx, p, TRINKET_AURA.storm);
      const damage = Math.round(charges * (use.perCharge + use.coef * p.spellPower));
      const struck = new Set<number>();
      let from: Entity = p;
      let at: Entity | null = first;
      for (let jump = 0; jump < use.jumps && at; jump++) {
        struck.add(at.id);
        fxOn(ctx, from, at, 'nature', 'trinket_stormjar');
        ctx.dealDamage(p, at, damage, false, 'nature', 'Stormjar', 'hit');
        from = at;
        at = nearestHostile(ctx, p, from, use.jumpRange, struck);
      }
      break;
    }
    case 'echo': {
      ctx.applyAura(p, {
        ...marker(p, TRINKET_AURA.echo, 'Echoing Lens', use.duration, use.echo),
        stacks: use.casts,
      });
      fx(ctx, p, 'arcane', 'trinket_echoing_lens');
      break;
    }
    case 'gamble': {
      const fortune = GAMBLE_FORTUNES[ctx.rng.int(0, GAMBLE_FORTUNES.length - 1)];
      if (fortune === 'keenEdge') {
        ctx.applyAura(p, {
          id: TRINKET_AURA.fortune,
          name: 'Keen Edge',
          kind: 'buff_dmg_done',
          remaining: use.duration,
          duration: use.duration,
          value: GAMBLE.keenEdgeDamage,
          sourceId: p.id,
          school: 'physical',
        });
      } else if (fortune === 'luckyHeal') {
        const ticks = Math.max(1, Math.floor(use.duration / 3));
        ctx.applyAura(p, {
          id: TRINKET_AURA.fortune,
          name: 'Lucky Streak',
          kind: 'hot',
          remaining: use.duration,
          duration: use.duration,
          value: Math.round((p.maxHp * GAMBLE.luckyHealShare) / ticks),
          tickInterval: 3,
          tickTimer: 3,
          sourceId: p.id,
          school: 'nature',
        });
      } else if (fortune === 'gildedGuard') {
        ctx.applyAura(p, {
          id: TRINKET_AURA.fortune,
          name: 'Gilded Guard',
          kind: 'absorb',
          remaining: use.duration,
          duration: use.duration,
          value: Math.round(p.maxHp * GAMBLE.gildedGuardShare),
          sourceId: p.id,
          school: 'holy',
        });
      } else {
        cooldown = Math.round(cooldown * (1 - GAMBLE.snakeEyesRefund));
      }
      ctx.emit({ type: 'trinketGamble', fortune, pid: meta.entityId });
      fx(ctx, p, 'arcane', 'trinket_gamblers_die');
      break;
    }
    case 'blink': {
      relocateSwept(ctx, p, {
        x: p.pos.x + Math.sin(p.facing) * use.yards,
        y: p.pos.y,
        z: p.pos.z + Math.cos(p.facing) * use.yards,
      });
      ctx.emit({
        type: 'spellfx',
        sourceId: p.id,
        targetId: p.id,
        school: 'arcane',
        fx: 'blinkStep',
        ability: 'trinket_sundered_prism',
      });
      ctx.applyAura(p, {
        id: TRINKET_AURA.riftGuard,
        name: 'Sundered Prism',
        kind: 'shield_wall',
        remaining: use.guard,
        duration: use.guard,
        value: use.reduction,
        sourceId: p.id,
        school: 'arcane',
      });
      break;
    }
    case 'sprint': {
      ctx.applyAura(p, {
        id: TRINKET_AURA.sprint,
        name: "Wayfarer's Stride",
        kind: 'buff_speed',
        remaining: use.duration,
        duration: use.duration,
        value: use.speed,
        sourceId: p.id,
        school: 'nature',
      });
      fx(ctx, p, 'nature', 'trinket_wayfarers_lodestone');
      break;
    }
    case 'defiance': {
      breakControl(ctx, p);
      fx(ctx, p, 'holy', 'trinket_medallion_of_defiance');
      break;
    }
    case 'brand': {
      const target = hostileTarget(ctx, p, use.range);
      if (!target || target.kind !== 'player') {
        ctx.error(meta.entityId, 'You need an enemy player as your target.');
        return false;
      }
      ctx.applyAura(target, {
        id: TRINKET_AURA.brand,
        name: "Duelist's Brand",
        kind: 'mortal_wound',
        remaining: use.duration,
        duration: use.duration,
        value: use.cut,
        sourceId: p.id,
        school: 'shadow',
      });
      fxOn(ctx, p, target, 'shadow', 'trinket_duelists_brand');
      break;
    }
    case 'temper': {
      // Every heat stack the forge holds is spent into the temper; the count
      // rides the temper aura's value for the whole burn.
      const heat = findAura(p, TRINKET_AURA.heat)?.stacks ?? 0;
      if (heat > 0) removeAura(ctx, p, TRINKET_AURA.heat);
      ctx.applyAura(p, marker(p, TRINKET_AURA.temper, 'Tempered', use.duration, heat));
      fx(ctx, p, 'fire', 'trinket_forgefathers_temper');
      break;
    }
    case 'kindlingOrb': {
      // The renderer draws the floating orb while this aura is up: keep its id.
      ctx.applyAura(p, marker(p, TRINKET_AURA.kindlingOrb, 'Kindling Orb', use.duration));
      fx(ctx, p, 'fire', 'trinket_kindling_orb');
      break;
    }
    case 'pierce': {
      ctx.applyAura(p, marker(p, TRINKET_AURA.pierce, 'Molten Fletching', use.duration, use.share));
      fx(ctx, p, 'fire', 'trinket_molten_fletching');
      break;
    }
    case 'lantern': {
      placeLantern(ctx, p, use);
      break;
    }
    case 'heartNova': {
      const stacks = findAura(p, TRINKET_AURA.guardHeat)?.stacks ?? 0;
      if (stacks <= 0) {
        ctx.error(meta.entityId, 'Your heart holds no heat.');
        return false;
      }
      removeAura(ctx, p, TRINKET_AURA.guardHeat);
      heartNova(ctx, p, use, stacks);
      break;
    }
  }
  p.cooldowns.set(key, cooldown);
  return true;
}

function fx(ctx: SimContext, e: Entity, school: string, ability: string): void {
  ctx.emit({ type: 'spellfx', sourceId: e.id, targetId: e.id, school, fx: 'selfCast', ability });
}

function fxOn(ctx: SimContext, from: Entity, to: Entity, school: string, ability: string): void {
  const kind = school === 'nature' ? 'lightning' : 'dotApply';
  ctx.emit({ type: 'spellfx', sourceId: from.id, targetId: to.id, school, fx: kind, ability });
}

function nearestHostile(
  ctx: SimContext,
  p: Entity,
  from: Entity,
  range: number,
  skip: ReadonlySet<number>,
): Entity | null {
  let best: Entity | null = null;
  let bestD2 = Number.POSITIVE_INFINITY;
  ctx.grid.forEachInRadius(from.pos.x, from.pos.z, range, (e, d2) => {
    if (e.dead || skip.has(e.id) || e.id === p.id || d2 >= bestD2) return;
    if (!ctx.isHostileTo(p, e)) return;
    // Ties go to the lower id, so the chain is the same on every host.
    if (d2 === bestD2 && best && e.id > best.id) return;
    best = e;
    bestD2 = d2;
  });
  return best;
}

/** Strip every player-removable control aura off the wearer. */
function breakControl(ctx: SimContext, p: Entity): void {
  for (let i = p.auras.length - 1; i >= 0; i--) {
    const aura = p.auras[i];
    if (!CONTROL_KINDS.has(aura.kind) || aura.sourceId === p.id) continue;
    if (!isPlayerRemovableAura(aura)) continue;
    p.auras.splice(i, 1);
    ctx.emit({ type: 'aura', targetId: p.id, name: aura.name, gained: false });
  }
}

// ---- the Mooring Stone's hold -------------------------------------------------

/** Whether the Mooring Stone keeps a control aura off its wearer (Sim.applyAura). */
export function mooringBlocksAura(target: Entity, aura: Aura): boolean {
  if (target.kind !== 'player' || aura.sourceId === target.id) return false;
  if (!CONTROL_KINDS.has(aura.kind) || isUnbreakableControlAura(aura)) return false;
  return target.auras.some((held) => held.id === TRINKET_AURA.anchor);
}

/** Whether the Mooring Stone holds its wearer against a knockback. */
export function isMoored(target: Entity): boolean {
  return target.auras.some((held) => held.id === TRINKET_AURA.anchor);
}

// ---- passives off the gear-proc hooks -----------------------------------------

export type TrinketTrigger = 'weaponHit' | 'weaponCrit' | 'spellCast' | 'kill';

/** Called from the set-proc and weapon-proc hooks (set_procs.ts, equip_procs.ts). */
export function runTrinketTrigger(
  ctx: SimContext,
  source: Entity,
  target: Entity | null,
  trigger: TrinketTrigger,
): void {
  if (source.kind !== 'player' || source.dead) return;
  const worn = wornTrinket(ctx, source);
  if (!worn) return;
  const passive = worn.spec.passive;
  // The killing blow of a duel leaves no lingering bleed or extra swing behind
  // (the same gate runWeaponProcs keeps for its persistent effects).
  if (
    trigger === 'weaponHit' &&
    target &&
    !target.dead &&
    !duelJustEndedBetween(ctx, target, source)
  ) {
    const edge = findAura(source, TRINKET_AURA.bleedEdge);
    if (edge && worn.spec.use.kind === 'bleedEdge') applyBleed(ctx, source, target, worn.spec.use);
    if (passive?.kind === 'twinStrike') twinStrike(ctx, source, target, passive);
    // Last, so an earlier rider never lands on a target the fire just killed.
    if (worn.spec.use.kind === 'temper') temperStrike(ctx, source, target, worn.spec.use);
  }
  if (trigger === 'weaponHit' && passive?.kind === 'heat') {
    addStack(ctx, source, TRINKET_AURA.heat, 'Forge Heat', passive.max, passive.duration);
  }
  if (
    trigger === 'weaponCrit' &&
    passive?.kind === 'ignite' &&
    target &&
    !target.dead &&
    !duelJustEndedBetween(ctx, target, source)
  ) {
    applyIgnite(ctx, source, target, passive);
  }
  if (trigger === 'kill' && worn.spec.use.kind === 'temper') extendTemper(source, worn.spec.use);
  if ((trigger === 'weaponCrit' || trigger === 'kill') && passive?.kind === 'tally') {
    addStack(ctx, source, TRINKET_AURA.tally, "Hunter's Tally", passive.max, passive.duration);
  }
  if (trigger === 'spellCast' && passive?.kind === 'storm') {
    addStack(ctx, source, TRINKET_AURA.storm, 'Stormjar', passive.max, passive.duration);
  }
  if (trigger === 'spellCast' && target && worn.spec.use.kind === 'kindlingOrb') {
    kindlingBolt(ctx, source, target, worn.spec.use);
  }
}

/** The power a weapon-driven trinket scales with: melee Attack Power, or a
 *  hunter's ranged Attack Power when that is the higher (their shots count). */
function weaponPower(p: Entity): number {
  return Math.max(p.attackPower, p.rangedPower);
}

type UseOf<K extends TrinketSpec['use']['kind']> = Extract<TrinketSpec['use'], { kind: K }>;

/** Forgefather's Temper: while it burns, a weapon hit adds its fire. Dealt as
 *  incidental (non-direct) damage, so it never echoes, reflects, or re-enters a
 *  weapon hook. */
function temperStrike(ctx: SimContext, p: Entity, target: Entity, use: UseOf<'temper'>): void {
  const temper = findAura(p, TRINKET_AURA.temper);
  if (!temper) return;
  const damage = Math.round(
    (use.flat + use.coef * weaponPower(p)) * (1 + use.perHeat * temper.value),
  );
  ctx.dealDamage(
    p,
    target,
    Math.max(1, damage),
    false,
    'fire',
    "Forgefather's Temper",
    'hit',
    true,
    undefined,
    false,
  );
}

/** A kill while the temper burns stretches it by `killExtend`, never past
 *  `maxDuration` from the use: the aura's duration is its whole life so far. */
function extendTemper(p: Entity, use: UseOf<'temper'>): void {
  const temper = findAura(p, TRINKET_AURA.temper);
  if (!temper) return;
  const total = Math.min(use.maxDuration, temper.duration + use.killExtend);
  temper.remaining += total - temper.duration;
  temper.duration = total;
}

/** Molten Fletching: a weapon crit sets the target alight (refreshed, never stacked). */
function applyIgnite(
  ctx: SimContext,
  p: Entity,
  target: Entity,
  passive: Extract<TrinketPassive, { kind: 'ignite' }>,
): void {
  const every = 2;
  ctx.applyAura(target, {
    id: TRINKET_AURA.ignite,
    name: 'Molten Ignite',
    kind: 'dot',
    remaining: passive.ticks * every,
    duration: passive.ticks * every,
    value: Math.max(1, Math.round(passive.flat + passive.coef * weaponPower(p))),
    tickInterval: every,
    tickTimer: every,
    sourceId: p.id,
    school: 'fire',
  });
}

/** The control kinds a stray bolt must not break on a hostile target. */
const DAMAGE_BREAKS: ReadonlySet<string> = new Set(['polymorph', 'incapacitate', 'blind']);

/** Kindling Orb: a spell cast at a hostile target looses the orb's bolt at it.
 *  Incidental (non-direct) damage: it never counts as a cast or echoes. */
function kindlingBolt(ctx: SimContext, p: Entity, target: Entity, use: UseOf<'kindlingOrb'>): void {
  if (!findAura(p, TRINKET_AURA.kindlingOrb)) return;
  if (target.dead || target.id === p.id || !ctx.isHostileTo(p, target)) return;
  // A crowd-control spell on a hostile is still a cast: the orb holds its fire
  // rather than break a polymorph, sap or blind the target is under.
  if (target.auras.some((aura) => DAMAGE_BREAKS.has(aura.kind))) return;
  ctx.emit({
    type: 'spellfx',
    sourceId: p.id,
    targetId: target.id,
    school: 'fire',
    fx: 'projectile',
    ability: 'trinket_kindling_orb_bolt',
  });
  ctx.dealDamage(
    p,
    target,
    Math.max(1, Math.round(use.flat + use.coef * p.spellPower)),
    false,
    'fire',
    'Kindling Orb',
    'hit',
    true,
    undefined,
    false,
  );
}

// ---- Heart of the Crucible ----------------------------------------------------

/** A parry, dodge or block the wearer makes as the defender (the mob swing shell
 *  on Sim and the player melee shell in auto_attack.ts). Draws no rng. */
export function onTrinketAvoidance(ctx: SimContext, defender: Entity): void {
  if (defender.kind !== 'player' || defender.dead) return;
  const passive = passiveOf(ctx, defender);
  if (passive?.kind !== 'guardHeat') return;
  addStack(ctx, defender, TRINKET_AURA.guardHeat, 'Crucible Heat', passive.max, passive.duration);
}

function heartNova(ctx: SimContext, p: Entity, use: UseOf<'heartNova'>, stacks: number): void {
  const damage = Math.max(1, Math.round((use.flat + use.coef * p.attackPower) * stacks));
  ctx.emit({
    type: 'spellfxAt',
    x: p.pos.x,
    z: p.pos.z,
    school: 'fire',
    fx: 'nova',
    ability: 'trinket_heart_of_the_crucible',
    radius: use.radius,
    sourceId: p.id,
  });
  for (const hostile of ctx.hostilesInRadius(p, p.pos, use.radius)) {
    if (hostile.dead) continue;
    ctx.dealDamage(p, hostile, damage, false, 'fire', 'Heart of the Crucible', 'hit');
    // The same shared taunt as an area taunt (effect_dispatch.ts aoeTaunt).
    if (hostile.kind === 'mob' && !hostile.dead) ctx.applyTaunt(p, hostile);
  }
}

// ---- Last Flame Lantern -------------------------------------------------------

/** The lantern is an aura on the wearer carrying where it stands: value is the
 *  splash share, value2/value3 the x/z it was set at (both ride the aura wire).
 *  It burns out with the aura (its timer, or the wearer's death). */
function placeLantern(ctx: SimContext, p: Entity, use: UseOf<'lantern'>): void {
  ctx.applyAura(p, {
    ...marker(p, TRINKET_AURA.lantern, 'Last Flame Lantern', use.duration, use.share),
    value2: p.pos.x,
    value3: p.pos.z,
    school: 'fire',
  });
  ctx.emit({
    type: 'spellfxAt',
    x: p.pos.x,
    z: p.pos.z,
    school: 'fire',
    fx: 'nova',
    ability: 'trinket_last_flame_lantern',
    radius: use.radius,
    sourceId: p.id,
  });
}

/** A cast heal on an ally in a lantern's light splashes a share of it onto the
 *  most wounded other party member in that light. The lantern is looked for in
 *  the healed ally's own party (its wearer is that ally's ally); the first lit
 *  lantern in party order splashes, once per heal. */
function lanternSplash(ctx: SimContext, healer: Entity, target: Entity, effective: number): void {
  const use = TRINKET_SPECS.last_flame_lantern?.use;
  if (use?.kind !== 'lantern') return;
  const party = ctx.partyOf(target.id)?.members ?? [target.id];
  for (const wearerId of party) {
    const wearer = ctx.entities.get(wearerId);
    const lantern = wearer ? findAura(wearer, TRINKET_AURA.lantern) : undefined;
    if (!lantern || lantern.value2 === undefined || lantern.value3 === undefined) continue;
    const lx = lantern.value2;
    const lz = lantern.value3;
    const lit = (e: Entity) => Math.hypot(e.pos.x - lx, e.pos.z - lz) <= use.radius;
    if (!lit(target)) continue;
    let mostWounded: Entity | null = null;
    for (const id of party) {
      const ally = ctx.entities.get(id);
      if (!ally || ally.dead || ally.id === target.id || ally.hp >= ally.maxHp) continue;
      if (!lit(ally)) continue;
      if (!mostWounded || ally.hp / ally.maxHp < mostWounded.hp / mostWounded.maxHp) {
        mostWounded = ally;
      }
    }
    if (!mostWounded) return;
    ctx.emit({
      type: 'spellfx',
      sourceId: target.id,
      targetId: mostWounded.id,
      school: 'fire',
      fx: 'projectile',
      ability: 'trinket_last_flame_lantern_splash',
    });
    // An already-resolved copy: no crit, no multipliers, and it never comes
    // back through onTrinketHeal, so it cannot splash again.
    applyHeal(
      ctx,
      healer,
      mostWounded,
      Math.max(1, Math.round(effective * lantern.value)),
      'Last Flame Lantern',
      'trinket_last_flame_lantern',
      false,
      false,
      false,
      true,
    );
    return;
  }
}

function applyBleed(
  ctx: SimContext,
  p: Entity,
  target: Entity,
  use: Extract<TrinketSpec['use'], { kind: 'bleedEdge' }>,
): void {
  const perStack = Math.round(use.tick + use.coef * p.attackPower);
  const held = target.auras.find(
    (aura) => aura.id === TRINKET_AURA.bleed && aura.sourceId === p.id,
  );
  const stacks = Math.min(use.stacks, (held?.stacks ?? 0) + 1);
  ctx.applyAura(target, {
    id: TRINKET_AURA.bleed,
    name: 'Talon Wound',
    kind: 'dot',
    remaining: 6,
    duration: 6,
    value: perStack * stacks,
    stacks,
    tickInterval: 2,
    tickTimer: 2,
    sourceId: p.id,
    school: 'physical',
  });
}

function twinStrike(
  ctx: SimContext,
  p: Entity,
  target: Entity,
  passive: Extract<TrinketPassive, { kind: 'twinStrike' }>,
): void {
  if (findAura(p, TRINKET_AURA.twinStrikeIcd)) return;
  // A ranged shot (a hunter's auto-shot also lands as a weapon hit) never earns
  // a melee swing at a target out of reach.
  if (Math.hypot(target.pos.x - p.pos.x, target.pos.z - p.pos.z) > MELEE_RANGE + 2) return;
  if (!ctx.rng.chance(passive.chance)) return;
  // The inner cooldown is set BEFORE the extra swing, whose own hit lands back
  // here: it can never chain.
  ctx.applyAura(p, marker(p, TRINKET_AURA.twinStrikeIcd, 'Paired Talons', passive.icd));
  meleeSwing(ctx, p, target, 0, null, { autoAttackHand: 'mainhand', autoAttack: true });
}

// ---- passives off damage and healing ------------------------------------------

/** After damage lands (dealDamage): the Bastion Sigil's last stand and its
 *  retaliation, and the Echoing Lens's echo of a spell. */
export function onTrinketDamage(
  ctx: SimContext,
  source: Entity | null,
  target: Entity,
  hpLoss: number,
  school: string,
  direct: boolean,
  ability: string | null,
): void {
  if (hpLoss <= 0) return;
  // A killing hit reaches here before the death block marks the wearer dead:
  // hp <= 0 means no last stand and no reflect from the corpse.
  if (target.kind === 'player' && !target.dead && target.hp > 0) {
    const passive = passiveOf(ctx, target);
    if (
      passive?.kind === 'lastStand' &&
      target.hp / Math.max(1, target.maxHp) < passive.belowHp &&
      !findAura(target, TRINKET_AURA.lastStandIcd)
    ) {
      ctx.applyAura(
        target,
        marker(target, TRINKET_AURA.lastStandIcd, 'Bastion Sigil', passive.icd),
      );
      ctx.applyAura(target, {
        id: TRINKET_AURA.lastStand,
        name: 'Last Bastion',
        kind: 'absorb',
        remaining: passive.duration,
        duration: passive.duration,
        value: Math.round(target.maxHp * passive.absorb),
        sourceId: target.id,
        school: 'holy',
      });
      fx(ctx, target, 'holy', 'trinket_last_bastion');
    }
    const ward = findAura(target, TRINKET_AURA.retaliate);
    if (
      ward &&
      source &&
      direct &&
      source.id !== target.id &&
      !source.dead &&
      ability !== 'Retaliation'
    ) {
      ctx.dealDamage(
        target,
        source,
        Math.max(1, Math.round(hpLoss * ward.value)),
        false,
        'physical',
        'Retaliation',
        'hit',
        true,
        undefined,
        false,
      );
    }
  }
  // Molten Fletching's pierce: a direct physical hit (a weapon swing, a shot, a
  // weapon strike) carries on into the next enemy. The carried share is dealt
  // non-direct, so it never comes back here and never chains.
  if (source && source.kind === 'player' && school === 'physical' && direct) {
    const pierce = findAura(source, TRINKET_AURA.pierce);
    const use = pierce ? wornTrinket(ctx, source)?.spec.use : undefined;
    if (pierce && use?.kind === 'pierce' && source.id !== target.id) {
      const next = nearestHostile(ctx, source, target, use.reach, new Set([target.id]));
      if (next) {
        ctx.dealDamage(
          source,
          next,
          Math.max(1, Math.round(hpLoss * pierce.value)),
          false,
          'physical',
          'Molten Fletching',
          'hit',
          true,
          undefined,
          false,
        );
      }
    }
  }
  if (
    source &&
    source.kind === 'player' &&
    school !== 'physical' &&
    direct &&
    ability !== 'Echoing Lens'
  ) {
    const echo = findAura(source, TRINKET_AURA.echo);
    if (echo && (echo.stacks ?? 0) > 0 && source.id !== target.id && !target.dead) {
      spendEcho(ctx, source, echo);
      ctx.dealDamage(
        source,
        target,
        Math.max(1, Math.round(hpLoss * echo.value)),
        false,
        school,
        'Echoing Lens',
        'hit',
        true,
        undefined,
        false,
        false,
        true,
      );
    }
  }
}

/** After a heal lands (applyHeal): the Mender's Hourglass stores the overhealing,
 *  and the Echoing Lens echoes it. */
export function onTrinketHeal(
  ctx: SimContext,
  source: Entity,
  target: Entity,
  healed: number,
  overheal: number,
  ability: string,
  // False for derived heals (a weapon enchant's proc, a copied echo): they fill
  // the hourglass but never spend an Echoing Lens charge.
  castHeal = true,
): void {
  if (source.kind !== 'player' || ability === 'Echoing Lens') return;
  const passive = passiveOf(ctx, source);
  if (passive?.kind === 'hourglass' && overheal > 0) {
    const cap = Math.round(source.maxHp * passive.cap);
    const held = findAura(source, TRINKET_AURA.hourglass);
    const stored = Math.min(cap, Math.round((held?.value ?? 0) + overheal));
    if (stored > (held?.value ?? 0)) {
      ctx.applyAura(source, {
        ...marker(source, TRINKET_AURA.hourglass, "Mender's Hourglass", 60, stored),
      });
    }
  }
  const echo = findAura(source, TRINKET_AURA.echo);
  if (castHeal && echo && (echo.stacks ?? 0) > 0 && healed + overheal > 0 && !target.dead) {
    spendEcho(ctx, source, echo);
    applyHeal(
      ctx,
      source,
      target,
      Math.max(1, Math.round((healed + overheal) * echo.value)),
      'Echoing Lens',
      null,
      false,
      false,
      false,
      true,
    );
  }
  if (castHeal && healed + overheal > 0 && !target.dead) {
    lanternSplash(ctx, source, target, healed + overheal);
  }
}

function spendEcho(ctx: SimContext, p: Entity, echo: Aura): void {
  const left = (echo.stacks ?? 0) - 1;
  if (left <= 0) {
    removeAura(ctx, p, TRINKET_AURA.echo);
    return;
  }
  echo.stacks = left;
}
