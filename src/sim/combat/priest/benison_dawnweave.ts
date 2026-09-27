import {
  BENISON_2PC_HEAL_PER_STACK,
  BENISON_2PC_MAX_STACKS,
  BENISON_4PC_WHISPER_HEAL_BONUS,
  BENISON_4PC_WHISPER_WINDOW_SEC,
} from '../../content/ignivar_set_bonuses';
import type { SimContext } from '../../sim_context';
import type { Entity } from '../../types';
import { wearsSetBonus } from '../set_bonus_wearer';

export const BENISON_PRAYER_AURA_ID = 'priest_benison_prayers';
export const BENISON_WHISPER_AURA_ID = 'priest_benison_whisper';
const BUILDERS: ReadonlySet<string> = new Set(['lesser_heal', 'heal', 'flash_heal']);

interface PrayerAura {
  id?: string;
  stacks?: number;
  remaining?: number;
}

/** The whole-heal multiplier shared with the tooltip, including Healing Power. */
export function benisonPrayerHealingMultiplier(
  auras: readonly PrayerAura[],
  abilityId: string,
): number {
  if (abilityId === 'prayer_of_healing') {
    const preparation = auras.find((aura) => aura.id === BENISON_PRAYER_AURA_ID);
    // The snapshot omits stacks for a single-stack aura.
    const stacks = preparation ? (preparation.stacks ?? 1) : 0;
    return 1 + Math.min(BENISON_2PC_MAX_STACKS, Math.max(0, stacks)) * BENISON_2PC_HEAL_PER_STACK;
  }
  if (
    abilityId === 'lesser_heal' &&
    auras.some((aura) => aura.id === BENISON_WHISPER_AURA_ID && (aura.remaining ?? 0) > 0)
  )
    return 1 + BENISON_4PC_WHISPER_HEAL_BONUS;
  return 1;
}

/** Called only for a primary direct heal, never its echoes or periodic ticks. */
export function buildBenisonPrayer(
  ctx: SimContext,
  priest: Entity,
  abilityId: string,
  effectiveHealing: number,
): boolean {
  if (
    !BUILDERS.has(abilityId) ||
    effectiveHealing <= 0 ||
    ctx.players.get(priest.id)?.talents.spec !== 'holy' ||
    !wearsSetBonus(ctx, priest, 'benison_dawnweave', 2)
  )
    return false;
  const existing = priest.auras.find((aura) => aura.id === BENISON_PRAYER_AURA_ID);
  const stacks = Math.min(BENISON_2PC_MAX_STACKS, (existing?.stacks ?? 0) + 1);
  if (existing?.stacks === stacks) return true;
  ctx.applyAura(priest, {
    id: BENISON_PRAYER_AURA_ID,
    name: 'Choirmend',
    kind: 'benison_prayers',
    stacks,
    value: stacks * BENISON_2PC_HEAL_PER_STACK,
    duration: 0,
    remaining: 0,
    permanent: true,
    sourceId: priest.id,
    school: 'holy',
  });
  return true;
}

/** Spend on completion so an interrupted Choirmend keeps its preparation. */
export function consumeBenisonPrayers(ctx: SimContext, priest: Entity, abilityId: string): number {
  if (
    abilityId !== 'prayer_of_healing' ||
    ctx.players.get(priest.id)?.talents.spec !== 'holy' ||
    !wearsSetBonus(ctx, priest, 'benison_dawnweave', 2)
  )
    return 1;
  const index = priest.auras.findIndex((aura) => aura.id === BENISON_PRAYER_AURA_ID);
  if (index < 0) return 1;
  const multiplier = benisonPrayerHealingMultiplier(priest.auras, abilityId);
  const [aura] = priest.auras.splice(index, 1);
  ctx.emit({
    type: 'aura',
    targetId: priest.id,
    name: aura.name,
    gained: false,
    auraKind: aura.kind,
  });
  if (
    (aura.stacks ?? 0) >= BENISON_2PC_MAX_STACKS &&
    wearsSetBonus(ctx, priest, 'benison_dawnweave', 4)
  ) {
    ctx.applyAura(priest, {
      id: BENISON_WHISPER_AURA_ID,
      name: 'Whispered Prayer',
      kind: 'next_cast_instant',
      empowerAbilities: ['lesser_heal'],
      value: BENISON_4PC_WHISPER_HEAL_BONUS,
      duration: BENISON_4PC_WHISPER_WINDOW_SEC,
      remaining: BENISON_4PC_WHISPER_WINDOW_SEC,
      sourceId: priest.id,
      school: 'holy',
    });
  }
  return multiplier;
}

/** Equipment recalculation owns tier loss; no new per-tick or realm scan. */
export function clearUnequippedBenisonPrayers(priest: Entity, pieces: number): void {
  if (pieces >= 4) return;
  for (let index = priest.auras.length - 1; index >= 0; index--) {
    const id = priest.auras[index].id;
    if (id === BENISON_WHISPER_AURA_ID || (pieces < 2 && id === BENISON_PRAYER_AURA_ID)) {
      priest.auras.splice(index, 1);
    }
  }
}
