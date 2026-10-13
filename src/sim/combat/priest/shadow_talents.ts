import {
  SHADOW_CHOIR_DURATION,
  SHADOW_CHOIR_HEAL_FRACTION,
  SHADOW_LIVING_COVENANT_EXTENSION,
  SHADOW_LIVING_COVENANT_MAX_EXTENSION,
  SHADOW_SECOND_VERSE_TICKS,
} from '../../content/priest_shadow_tuning';
import type { PlayerMeta, ResolvedAbility } from '../../sim';
import type { DamageResolution, SimContext } from '../../sim_context';
import type { Aura, Entity } from '../../types';
import { CAST_COMPLETE_EPS } from '../../types';
import { periodicHarmStands } from '../periodic_harm';
import { shadowPeriodicHit } from './periodic_crit';
import { EFFIGY_AURA_ID } from './presentation';
import { PRIEST_TALENT_IDS } from './talents';
import { healShadowGroupBudget, healVampiricTouch } from './vampiric_touch';

const CHOIR_TALENT_ID = 'pri_r17_choir_of_deliverance';

export function hasShadowTalent(ctx: SimContext, source: Entity | null, id: string): boolean {
  if (!source || source.dead || source.kind !== 'player') return false;
  const meta = ctx.players.get(source.id);
  return Boolean(
    meta?.cls === 'priest' && meta.talents.spec === 'shadow' && ctx.playerMods(meta).selected[id],
  );
}

/** Copy both the admission definition and effects; never change the shared catalog. */
export function resolveShadowChoir(
  resolved: ResolvedAbility,
  meta: Pick<PlayerMeta, 'cls' | 'talents'>,
): ResolvedAbility {
  if (
    meta.cls !== 'priest' ||
    meta.talents.spec !== 'shadow' ||
    resolved.def.id !== 'choir_of_deliverance'
  )
    return resolved;
  const effects: ResolvedAbility['effects'] = [
    {
      type: 'selfBuff',
      kind: 'buff_dmg_done',
      duration: SHADOW_CHOIR_DURATION,
      value: 0,
    },
  ];
  return {
    ...resolved,
    def: { ...resolved.def, school: 'shadow', channel: undefined, effects },
    castTime: 0,
    effects,
  };
}

export function extendShadowPrimaryDots(ctx: SimContext, priest: Entity, target: Entity): void {
  if (!hasShadowTalent(ctx, priest, PRIEST_TALENT_IDS.livingCovenant)) return;
  const effigy = target.auras.find((a) => a.id === EFFIGY_AURA_ID && a.sourceId === priest.id);
  if (!effigy) return;
  for (const dot of target.auras) {
    if (
      dot.sourceId !== priest.id ||
      dot.kind !== 'dot' ||
      (dot.id !== 'shadow_word_pain' && dot.id !== 'vampiric_touch')
    )
      continue;
    const extra = Math.min(
      SHADOW_LIVING_COVENANT_EXTENSION,
      SHADOW_LIVING_COVENANT_MAX_EXTENSION - (dot.extendedBy ?? 0),
    );
    if (extra <= 0) continue;
    dot.extendedBy = (dot.extendedBy ?? 0) + extra;
    dot.remaining += extra;
    dot.duration += extra;
    if (dot.id === 'shadow_word_pain') {
      effigy.remaining = dot.remaining;
      effigy.duration = dot.duration;
    }
  }
}

/** Freeze eligibility before reverse expiry can remove a same-tick Effigy. */
export function prepareShadowSecondVerse(ctx: SimContext, snapshot: readonly Aura[]): void {
  for (const dot of snapshot) {
    if (dot.id !== 'vampiric_touch') continue;
    const priest = ctx.entities.get(dot.sourceId) ?? null;
    if (!hasShadowTalent(ctx, priest, PRIEST_TALENT_IDS.secondVerse)) continue;
    dot.shadowVerseEffigyTick = snapshot.some(
      (aura) =>
        aura.id === EFFIGY_AURA_ID &&
        aura.sourceId === dot.sourceId &&
        aura.remaining > CAST_COMPLETE_EPS,
    )
      ? ctx.tickCount
      : undefined;
  }
}

/** Count only natural pulses on this caster's Effigy, not the bonus pulse itself. */
export function shadowSecondVerseTick(ctx: SimContext, target: Entity, dot: Aura): void {
  if (dot.id !== 'vampiric_touch' || target.dead) return;
  const priest = ctx.entities.get(dot.sourceId) ?? null;
  if (
    !hasShadowTalent(ctx, priest, PRIEST_TALENT_IDS.secondVerse) ||
    !priest ||
    dot.shadowVerseEffigyTick !== ctx.tickCount ||
    !periodicHarmStands(ctx, priest, target)
  )
    return;
  dot.shadowVerseTicks = (dot.shadowVerseTicks ?? 0) + 1;
  if (dot.shadowVerseTicks % SHADOW_SECOND_VERSE_TICKS !== 0) return;
  const hit = shadowPeriodicHit(ctx, priest, dot.id, dot.value);
  const resolution: DamageResolution = { landedHpLoss: 0 };
  ctx.dealDamage(
    priest,
    target,
    hit.amount,
    hit.crit,
    dot.school,
    dot.name,
    'hit',
    true,
    undefined,
    false,
    false,
    false,
    null,
    false,
    resolution,
  );
  healVampiricTouch(ctx, priest, dot, resolution.landedHpLoss);
}

/** Convert actual HP removed, including terminal PvP hits. No healing crit roll. */
export function shadowChoirDamage(
  ctx: SimContext,
  source: Entity | null,
  target: Entity,
  hpLoss: number,
  school: string,
  copiedHit = false,
): void {
  if (
    school !== 'shadow' ||
    hpLoss <= 0 ||
    copiedHit ||
    !source ||
    source.id === target.id ||
    !hasShadowTalent(ctx, source, CHOIR_TALENT_ID) ||
    !source.auras.some((a) => a.id === 'choir_of_deliverance' && a.sourceId === source.id)
  )
    return;
  healShadowGroupBudget(
    ctx,
    source,
    Math.round(hpLoss * SHADOW_CHOIR_HEAL_FRACTION),
    'Choir of Deliverance',
    'choir_of_deliverance',
  );
}
