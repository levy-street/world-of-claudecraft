import {
  OATHPYRE_2PC_BLOCK_CHANCE,
  OATHPYRE_2PC_VOWKEEPER_CHANCE,
  OATHPYRE_4PC_SHIELD_DURATION_SEC,
  OATHPYRE_4PC_SHIELD_PCT_MAX,
  setBonusFlag,
} from '../content/ignivar_set_bonuses';
import type { TalentModifiers } from '../content/talents';
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

function protectionPaladinMods(ctx: SimContext, p: Entity): TalentModifiers | null {
  const meta: PlayerMeta | undefined = p.kind === 'player' ? ctx.players.get(p.id) : undefined;
  if (meta?.cls !== 'paladin') return null;
  const mods = ctx.playerMods(meta);
  return mods.spec === 'protection' ? mods : null;
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
  const mods = protectionPaladinMods(ctx, p);
  if (mods === null) return false;
  // Oathpyre 2pc: the wearer's arm chances rise (vowkeeper 0.2 -> 0.3, block
  // 0.25 -> 0.4). The same single rng draw happens either way, only the
  // threshold moves, so neither wearers nor non-wearers shift the stream.
  // There is no internal cooldown: arming while already armed refreshes the
  // ONE aura (same id + source), the disclosed overwrite soft cap.
  const wornOathpyre2 = mods.selected[setBonusFlag('oathpyre', 2)] === true;
  const chance =
    source === 'block'
      ? wornOathpyre2
        ? OATHPYRE_2PC_BLOCK_CHANCE
        : SOLAR_REPRISAL_BLOCK_CHANCE
      : wornOathpyre2
        ? OATHPYRE_2PC_VOWKEEPER_CHANCE
        : SOLAR_REPRISAL_VOWKEEPER_CHANCE;
  if (!ctx.rng.chance(chance)) return false;
  grantSolarReprisal(ctx, p);
  return true;
}

/** Oathpyre 4pc: the fixed shield aura id, so all three consumers refresh ONE
 *  absorb (a refresh replaces the undrained remainder, same-id semantics). */
export const OATHPYRE_4PC_BULWARK_AURA_ID = 'oathpyre_bulwark';

// Oathpyre 4pc: consuming Solar Reprisal shields the wearer for 6 percent of
// max health for 10 sec. The aura NAME deliberately reuses the localized
// 'Solar Reprisal' string (the shield is the Reprisal's payoff and a new aura
// name would need a full sim_i18n dictionary row across every locale); the
// aura ID stays distinct so a fresh proc can never replace a running shield.
function grantOathpyreBulwark(ctx: SimContext, p: Entity): void {
  const meta: PlayerMeta | undefined = p.kind === 'player' ? ctx.players.get(p.id) : undefined;
  if (meta === undefined) return;
  if (ctx.playerMods(meta).selected[setBonusFlag('oathpyre', 4)] !== true) return;
  ctx.applyAura(p, {
    id: OATHPYRE_4PC_BULWARK_AURA_ID,
    name: 'Solar Reprisal',
    kind: 'absorb',
    value: Math.max(1, Math.round(p.maxHp * OATHPYRE_4PC_SHIELD_PCT_MAX)),
    remaining: OATHPYRE_4PC_SHIELD_DURATION_SEC,
    duration: OATHPYRE_4PC_SHIELD_DURATION_SEC,
    sourceId: p.id,
    school: 'holy',
  });
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
  // The 4pc shield rides EVERY consume, including the Mending Light route
  // (a deliberate shield-through-heal path, disclosed by the set doc).
  grantOathpyreBulwark(ctx, p);

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
