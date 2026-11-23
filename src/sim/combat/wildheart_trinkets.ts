// The Wildheart Basin's two heroic trinkets (data in src/sim/content/trinkets.ts,
// docs/design/dungeon-rework/wildheart_basin.md 8.2), split out of
// combat/trinkets.ts, whose useWornTrinket switch calls these two arms.
//
//   Fanglord's Whistle (spiritPack): a spirit jaguar fights beside the wearer,
//     a melee guardian on the shared guardian seam (combat/guardians.ts), its
//     bite snapshotting the wearer's Attack Power the way the Packlord Stampede
//     snapshots Ranged Attack Power (combat/hunter_packlord.ts).
//   Gorgebloom Seedpod (seedburst): a seed planted on the target bursts later
//     where the target stands, or where it died. The pending seed lives in the
//     sim's delayed-event queue (one self-rescheduling step per tick that
//     tracks the target), never only on the target, whose death clears its
//     auras: the seed outlives its host by design.
//
// Determinism: the only rng draw is the jaguar bite's damage roll (the
// guardian seam's own draw); the seed draws none.

import { TRINKET_AURA, type TrinketUse } from '../content/trinkets';
import type { SimContext } from '../sim_context';
import { type Entity, MELEE_RANGE, type Vec3 } from '../types';
import { guardianOf, summonGuardian } from './guardians';

type UseOf<K extends TrinketUse['kind']> = Extract<TrinketUse, { kind: K }>;

/** The spirit jaguar's guardian key (its template id is `guardian_<key>`, which
 *  the renderer's manifest maps to the jade spirit-cat look). */
export const SPIRIT_JAGUAR_GUARDIAN_KEY = 'fanglords_spirit_jaguar';
/** The jaguar's entity name (localized client-side through the aura-name map). */
export const SPIRIT_JAGUAR_NAME = 'Spirit Jaguar';
/** The jaguar bites within the reach a melee pet closes to (pet/pet_ai.ts). */
export const SPIRIT_JAGUAR_REACH = MELEE_RANGE * 0.8;

/** The power the jaguar's bite scales with: melee Attack Power, or Ranged
 *  Attack Power when that is higher (a hunter), like the weapon trinkets. */
export function spiritPackPower(p: Pick<Entity, 'attackPower' | 'rangedPower'>): number {
  return Math.max(p.attackPower, p.rangedPower);
}

/** The bite's damage range for a wearer of this power, snapshotted at summon. */
export function spiritJaguarBite(
  use: Pick<UseOf<'spiritPack'>, 'min' | 'max' | 'coef'>,
  power: number,
): { min: number; max: number } {
  const bonus = use.coef * power;
  const min = Math.max(1, Math.round(use.min + bonus));
  return { min, max: Math.max(min, Math.round(use.max + bonus)) };
}

/** The burst damage per enemy from a planted (snapshotted) base, raised by
 *  `deathBonus` when the target died before it burst. */
export function seedDamageFromBase(base: number, deathBonus: number, targetDied: boolean): number {
  return Math.max(1, Math.round(base * (targetDied ? 1 + deathBonus : 1)));
}

/** The seed's burst damage per enemy for a planter of this Spell Power. */
export function seedburstDamage(
  use: Pick<UseOf<'seedburst'>, 'flat' | 'coef' | 'deathBonus'>,
  spellPower: number,
  targetDied: boolean,
): number {
  return seedDamageFromBase(use.flat + use.coef * spellPower, use.deathBonus, targetDied);
}

/** Fanglord's Whistle: summon the spirit jaguar onto `target`. */
export function summonSpiritJaguar(
  ctx: SimContext,
  p: Entity,
  target: Entity,
  use: UseOf<'spiritPack'>,
): void {
  const bite = spiritJaguarBite(use, spiritPackPower(p));
  summonGuardian(ctx, p, {
    key: SPIRIT_JAGUAR_GUARDIAN_KEY,
    name: SPIRIT_JAGUAR_NAME,
    color: 0x5fe0a0,
    scale: 1,
    remaining: use.duration,
    attackInterval: use.attackInterval,
    minDamage: bite.min,
    maxDamage: bite.max,
    school: 'physical',
    abilityId: 'fanglords_whistle',
    abilityName: "Fanglord's Whistle",
    preferredTargetId: target.id,
    maxRange: use.range,
    dismissWhenUntargeted: false,
    melee: { moveSpeed: use.moveSpeed, reach: SPIRIT_JAGUAR_REACH },
  });
  // The wearer's buff bar shows the jaguar's time left and its bite.
  ctx.applyAura(p, {
    id: TRINKET_AURA.spiritPack,
    name: "Fanglord's Whistle",
    kind: 'internal_cd',
    remaining: use.duration,
    duration: use.duration,
    value: bite.min,
    value2: bite.max,
    sourceId: p.id,
    school: 'nature',
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: p.id,
    targetId: p.id,
    school: 'nature',
    fx: 'selfCast',
    ability: 'trinket_fanglords_whistle',
  });
}

/** The live spirit jaguar a wearer has out, if any. */
export function spiritJaguarOf(ctx: SimContext, ownerId: number): Entity | null {
  return guardianOf(ctx, ownerId, SPIRIT_JAGUAR_GUARDIAN_KEY);
}

/** A seed in the ground: where it will burst and what it knows so far. */
interface PendingSeed {
  ownerId: number;
  targetId: number;
  burstAt: number;
  base: number;
  died: boolean;
  pos: Vec3;
}

/** Gorgebloom Seedpod: plant the seed on `target`. */
export function plantSeedpod(
  ctx: SimContext,
  p: Entity,
  target: Entity,
  use: UseOf<'seedburst'>,
): void {
  const seed: PendingSeed = {
    ownerId: p.id,
    targetId: target.id,
    burstAt: ctx.time + use.delay,
    // Spell Power is snapshotted as it is planted; the death bonus multiplies
    // this at the burst.
    base: use.flat + use.coef * p.spellPower,
    died: false,
    pos: { x: target.pos.x, y: target.pos.y, z: target.pos.z },
  };
  // The seed shows on the target's frame while it lives (the aura dies with
  // the target; the burst does not depend on it).
  ctx.applyAura(target, {
    id: TRINKET_AURA.seedburst,
    name: 'Gorgebloom Seedpod',
    kind: 'internal_cd',
    remaining: use.delay,
    duration: use.delay,
    // The unrounded planted base: the tooltip rounds it the way the burst does.
    value: seed.base,
    sourceId: p.id,
    school: 'nature',
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: p.id,
    targetId: target.id,
    school: 'nature',
    fx: 'dotApply',
    ability: 'trinket_gorgebloom_seedpod',
  });
  scheduleSeedStep(ctx, seed, use);
}

/** One tick of the pending seed: follow the target while it lives, note its
 *  death (its corpse keeps the spot), and burst when the time comes. */
function scheduleSeedStep(ctx: SimContext, seed: PendingSeed, use: UseOf<'seedburst'>): void {
  ctx.delayedEvents.push({
    at: Math.min(seed.burstAt, ctx.time + 1e-6),
    resolve: () => {
      const target = ctx.entities.get(seed.targetId);
      // Once the target has died the spot is fixed: a slain player's released
      // spirit runs off, but the seed stays where the body fell.
      if (target && !seed.died) {
        seed.pos.x = target.pos.x;
        seed.pos.y = target.pos.y;
        seed.pos.z = target.pos.z;
        if (target.dead) seed.died = true;
      }
      if (ctx.time + 1e-9 < seed.burstAt) scheduleSeedStep(ctx, seed, use);
      else burstSeed(ctx, seed, use);
    },
  });
}

function burstSeed(ctx: SimContext, seed: PendingSeed, use: UseOf<'seedburst'>): void {
  const owner = ctx.entities.get(seed.ownerId);
  // A seed whose planter has died or left withers unburst.
  if (!owner || owner.dead) return;
  const damage = seedDamageFromBase(seed.base, use.deathBonus, seed.died);
  ctx.emit({
    type: 'spellfxAt',
    x: seed.pos.x,
    z: seed.pos.z,
    school: 'nature',
    fx: 'nova',
    ability: 'trinket_gorgebloom_seedpod_burst',
    radius: use.radius,
    sourceId: owner.id,
  });
  for (const hostile of ctx.hostilesInRadius(owner, seed.pos, use.radius)) {
    if (hostile.dead) continue;
    ctx.dealDamage(owner, hostile, damage, false, 'nature', 'Gorgebloom Seedpod', 'hit');
  }
}
