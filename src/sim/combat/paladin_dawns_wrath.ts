import type { PlayerMeta, ResolvedAbility } from '../sim';
import type { SimContext } from '../sim_context';
import type { Aura, Entity } from '../types';

export const DAWNS_WRATH_KIND = 'paladin_dawns_wrath' as const;
export const DAWNS_WRATH_DURATION = 8;
export const DAWNS_WRATH_PROC_CHANCE = 0.15;
export const DAWNS_WRATH_DAMAGE_MULT = 1.2;

const DAWNS_WRATH_ID = 'dawns_wrath';
const HAMMER_OF_WRATH_ID = 'hammer_of_wrath';

interface DawnsWrathAuraOwner {
  auras: readonly { kind: string }[];
}

function hasDawnsWrath(owner: DawnsWrathAuraOwner): boolean {
  return owner.auras.some((aura) => aura.kind === DAWNS_WRATH_KIND);
}

export function dawnsWrathHammerActive(owner: DawnsWrathAuraOwner, abilityId: string): boolean {
  return abilityId === HAMMER_OF_WRATH_ID && hasDawnsWrath(owner);
}

function isRetributionPaladin(ctx: SimContext, p: Entity): boolean {
  const meta: PlayerMeta | undefined = p.kind === 'player' ? ctx.players.get(p.id) : undefined;
  return meta?.cls === 'paladin' && ctx.playerMods(meta).spec === 'retribution';
}

function emitFade(ctx: SimContext, p: Entity, aura: Aura): void {
  ctx.emit({
    type: 'aura',
    targetId: p.id,
    name: aura.name,
    gained: false,
    auraKind: aura.kind,
  });
}

export function grantDawnsWrath(ctx: SimContext, p: Entity): void {
  ctx.applyAura(p, {
    id: DAWNS_WRATH_ID,
    name: "Dawn's Wrath",
    kind: DAWNS_WRATH_KIND,
    remaining: DAWNS_WRATH_DURATION,
    duration: DAWNS_WRATH_DURATION,
    value: DAWNS_WRATH_DAMAGE_MULT - 1,
    sourceId: p.id,
    school: 'holy',
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: p.id,
    targetId: p.id,
    school: 'holy',
    fx: 'procSurge',
    ability: DAWNS_WRATH_ID,
  });
}

export function tryGrantDawnsWrath(ctx: SimContext, p: Entity): boolean {
  if (!isRetributionPaladin(ctx, p)) return false;
  if (!ctx.rng.chance(DAWNS_WRATH_PROC_CHANCE)) return false;
  grantDawnsWrath(ctx, p);
  return true;
}

export function applyDawnsWrathOverride(
  ctx: SimContext,
  p: Entity,
  res: ResolvedAbility,
): ResolvedAbility {
  if (res.def.id !== HAMMER_OF_WRATH_ID) return res;
  const index = p.auras.findIndex((aura) => aura.kind === DAWNS_WRATH_KIND);
  if (index < 0) return res;
  const [aura] = p.auras.splice(index, 1);
  emitFade(ctx, p, aura);

  return {
    ...res,
    cooldown: 0,
    effects: res.effects.map((effect) =>
      effect.type === 'directDamage'
        ? {
            ...effect,
            damageMult: (effect.damageMult ?? 1) * DAWNS_WRATH_DAMAGE_MULT,
          }
        : effect,
    ),
  };
}
