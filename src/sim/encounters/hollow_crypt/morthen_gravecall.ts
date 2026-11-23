// Morthen's Gravecall (docs/design/dungeon-rework/hollow_crypt.md 5.4, act 1):
// every few seconds a Bound Soul rises from the next sarcophagus alcove round
// the Rite Ring (clockwise from the north-east) and drifts to him; on arrival
// he is Gorged on the Dead (more damage done, a stack for the fight, and a
// heal). A player who stands in its path takes it instead (a bite of shadow):
// the body-block. The soul IS the trash engine's G5 walker
// (mob/trash_kit/kit_walker.ts): this module only launches it from the
// alcove ('event' launch), the engine's driver flies, intercepts and lands it.
//
// Zero rng: the alcove is the souls-sent count; the only draw is an
// interception's damage roll, made by the walker in its own pass.

import { spawnKitObject } from '../../mob/trash_kit/kit_objects';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import type { Entity, KitWalkerDef } from '../../types';
import {
  MORTHEN_GORGED,
  MORTHEN_GRAVECALL,
  MORTHEN_SOUL_TEMPLATE,
  MORTHEN_TUNING,
  RITE_ALCOVE_SPOTS,
} from './morthen_ids';

const T = MORTHEN_TUNING;

/** The Bound Soul as a G5 walker: it rolls to Morthen alone, a body in its
 *  way takes it, its arrival stacks Gorged on the Dead and heals him. */
export const BOUND_SOUL_WALKER: KitWalkerDef = {
  castId: MORTHEN_GRAVECALL,
  name: 'Bound Soul',
  objectTemplate: MORTHEN_SOUL_TEMPLATE,
  launch: 'event',
  school: 'shadow',
  speed: T.soulSpeed,
  interceptRadius: T.soulIntercept,
  reachRadius: T.soulReach,
  maxSeconds: T.soulSeconds,
  allies: ['morthen'],
  empower: {
    auraId: MORTHEN_GORGED,
    name: 'Gorged on the Dead',
    damagePct: T.gorgedPct,
    seconds: T.gorgedSeconds,
    healPct: T.gorgedHeal,
    maxStacks: T.gorgedMaxStacks,
  },
  intercept: { min: T.soulInterceptMin, max: T.soulInterceptMax },
};

/** The alcove (instance-local) the `n`-th soul rises from. Pure. */
export function soulAlcove(n: number): { x: number; z: number } {
  return RITE_ALCOVE_SPOTS[((n % 4) + 4) % 4];
}

/** Raise the next Bound Soul from its alcove toward Morthen. Returns the orb. */
export function launchBoundSoul(
  ctx: SimContext,
  inst: InstanceSlot,
  morthen: Entity,
  n: number,
): Entity {
  const o = ctx.instanceOriginOf(inst);
  const at = soulAlcove(n);
  const orb = spawnKitObject(
    ctx,
    inst,
    MORTHEN_SOUL_TEMPLATE,
    BOUND_SOUL_WALKER.name,
    o.x + at.x,
    o.z + at.z,
    1,
    Math.atan2(morthen.pos.x - (o.x + at.x), morthen.pos.z - (o.z + at.z)),
    {
      kind: 'walker',
      def: BOUND_SOUL_WALKER,
      sourceId: morthen.id,
      allyId: morthen.id,
      remaining: BOUND_SOUL_WALKER.maxSeconds,
      mechanicDamageMult: morthen.mechanicDamageMult ?? 1,
    },
  );
  ctx.emit({
    type: 'spellfx',
    sourceId: morthen.id,
    targetId: orb.id,
    school: 'shadow',
    fx: 'nova',
    ability: MORTHEN_GRAVECALL,
  });
  return orb;
}

/** Every Bound Soul still in flight in the claim. */
export function boundSouls(ctx: SimContext, inst: InstanceSlot): Entity[] {
  const out: Entity[] = [];
  for (const id of inst.objectIds) {
    const e = ctx.entities.get(id);
    if (e?.templateId === MORTHEN_SOUL_TEMPLATE && e.kitObject?.kind === 'walker') out.push(e);
  }
  return out;
}

/** Gorged on the Dead stacks Morthen carries (0: none). */
export function gorgedStacks(morthen: Entity): number {
  const a = morthen.auras.find((x) => x.id === MORTHEN_GORGED);
  return a ? (a.stacks ?? 1) : 0;
}
