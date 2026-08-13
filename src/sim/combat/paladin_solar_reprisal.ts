import type { PlayerMeta, ResolvedAbility } from '../sim';
import type { SimContext } from '../sim_context';
import type { Aura, Entity } from '../types';

export const SOLAR_REPRISAL_KIND = 'paladin_solar_reprisal' as const;
export const SOLAR_REPRISAL_DURATION = 8;
export const SOLAR_REPRISAL_BLOCK_CHANCE = 0.25;
export const SOLAR_REPRISAL_VOWKEEPER_CHANCE = 0.2;
export const SOLAR_REPRISAL_SUNWARD_DAMAGE_MULT = 1.2;

const SOLAR_REPRISAL_ID = 'solar_reprisal';
const SOLAR_REPRISAL_CONSUMERS = new Set(['sunward_disc', 'hammer_of_grace', 'holy_light']);

interface SolarReprisalAuraOwner {
  auras: readonly { kind: string }[];
}

function hasSolarReprisal(owner: SolarReprisalAuraOwner): boolean {
  return owner.auras.some((aura) => aura.kind === SOLAR_REPRISAL_KIND);
}

export function solarReprisalAbilityGlowActive(
  owner: SolarReprisalAuraOwner,
  abilityId: string,
): boolean {
  return SOLAR_REPRISAL_CONSUMERS.has(abilityId) && hasSolarReprisal(owner);
}

export function solarReprisalBypassesCooldown(
  owner: SolarReprisalAuraOwner,
  abilityId: string,
): boolean {
  return (
    (abilityId === 'sunward_disc' || abilityId === 'hammer_of_grace') && hasSolarReprisal(owner)
  );
}

export function solarReprisalMakesAbilityFree(
  owner: SolarReprisalAuraOwner,
  abilityId: string,
): boolean {
  return abilityId === 'sunward_disc' && hasSolarReprisal(owner);
}

function isProtectionPaladin(ctx: SimContext, p: Entity): boolean {
  const meta: PlayerMeta | undefined = p.kind === 'player' ? ctx.players.get(p.id) : undefined;
  return meta?.cls === 'paladin' && ctx.playerMods(meta).spec === 'protection';
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

export function grantSolarReprisal(ctx: SimContext, p: Entity): void {
  ctx.applyAura(p, {
    id: SOLAR_REPRISAL_ID,
    name: 'Solar Reprisal',
    kind: SOLAR_REPRISAL_KIND,
    remaining: SOLAR_REPRISAL_DURATION,
    duration: SOLAR_REPRISAL_DURATION,
    value: SOLAR_REPRISAL_SUNWARD_DAMAGE_MULT - 1,
    sourceId: p.id,
    school: 'holy',
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: p.id,
    targetId: p.id,
    school: 'holy',
    fx: 'procSurge',
    ability: SOLAR_REPRISAL_ID,
  });
}

export function tryGrantSolarReprisal(
  ctx: SimContext,
  p: Entity,
  source: 'block' | 'vowkeeper',
): boolean {
  if (!isProtectionPaladin(ctx, p)) return false;
  const chance = source === 'block' ? SOLAR_REPRISAL_BLOCK_CHANCE : SOLAR_REPRISAL_VOWKEEPER_CHANCE;
  if (!ctx.rng.chance(chance)) return false;
  grantSolarReprisal(ctx, p);
  return true;
}

export function applySolarReprisalOverride(
  ctx: SimContext,
  p: Entity,
  res: ResolvedAbility,
): ResolvedAbility {
  if (!SOLAR_REPRISAL_CONSUMERS.has(res.def.id)) return res;
  const index = p.auras.findIndex((aura) => aura.kind === SOLAR_REPRISAL_KIND);
  if (index < 0) return res;
  const [aura] = p.auras.splice(index, 1);
  emitFade(ctx, p, aura);

  if (res.def.id === 'sunward_disc') {
    return {
      ...res,
      cost: 0,
      cooldown: 0,
      effects: res.effects.map((effect) =>
        effect.type === 'directDamage' || effect.type === 'chainDamage'
          ? {
              ...effect,
              damageMult: (effect.damageMult ?? 1) * SOLAR_REPRISAL_SUNWARD_DAMAGE_MULT,
            }
          : effect,
      ),
    };
  }

  if (res.def.id === 'hammer_of_grace') {
    return {
      ...res,
      cooldown: 0,
      effects: res.effects.map((effect) =>
        effect.type === 'directDamage' ? { ...effect, selfHealDamageFrac: 1 } : effect,
      ),
    };
  }

  return { ...res, castTime: 0 };
}
