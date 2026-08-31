import {
  COLDSIGHT_2PC_MEASURED_SHOT_FOCUS_BONUS,
  COLDSIGHT_4PC_CRIT_EXTENSION_SEC,
  COLDSIGHT_4PC_WINDOW_EXTENSION_CAP_SEC,
  setBonusFlag,
} from '../content/ignivar_set_bonuses';
import type { TalentModifiers } from '../content/talents';
import type { PlayerMeta, ResolvedAbility } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

export function resolveColdsightAbility(
  resolved: ResolvedAbility,
  hunter: Entity,
  meta: PlayerMeta,
  selected: TalentModifiers['selected'] = {},
): ResolvedAbility {
  if (meta.cls !== 'hunter') return resolved;
  return resolveColdsightAbilityForSpec(resolved, hunter, meta.talents.spec, selected);
}

export function resolveColdsightAbilityForSpec(
  resolved: ResolvedAbility,
  hunter: Entity,
  spec: string | null,
  selected: TalentModifiers['selected'] = {},
): ResolvedAbility {
  if (spec !== 'marksmanship') return resolved;
  const inWindow = hunter.auras.some((aura) => aura.kind === 'hunter_cold_focus');
  let out = resolved;
  if (inWindow && out.def.id === 'measured_shot') {
    out = {
      ...out,
      effects: out.effects.map((effect) =>
        effect.type === 'gainResource' ? { ...effect, amount: 30 } : effect,
      ),
    };
  }
  if (inWindow && out.def.id === 'aimed_shot') {
    out = {
      ...out,
      cost: Math.max(1, Math.round(out.cost * 0.75)),
      castTime: out.castTime * 0.7,
    };
  }
  // Coldsight 2pc: +5 Focus on Measured Shot, the named module hook AFTER the
  // Cold Focus absolute rewrite above (a pre-rewrite bump would be overwritten
  // by the absolute 30, and an addEffects row would double-map). Applies in
  // and out of the window (20 -> 25 / 30 -> 35); the shared resolver's
  // Harrier multiplier lands after, the set doc's disclosed 38/53.
  if (out.def.id === 'measured_shot' && selected[setBonusFlag('coldsight_trackers', 2)] === true) {
    out = {
      ...out,
      effects: out.effects.map((effect) =>
        effect.type === 'gainResource'
          ? { ...effect, amount: effect.amount + COLDSIGHT_2PC_MEASURED_SHOT_FOCUS_BONUS }
          : effect,
      ),
    };
  }
  return out;
}

// Coldsight 4pc: a Long Draw critical extends the RUNNING Cold Focus window
// by 2 sec, up to 6 sec per window. The per-window budget rides the aura's
// value2 slot, so a fresh window starts a fresh budget; the aura is mutated
// in place (the momentum-refresh precedent) and the granted seconds are
// returned so the caller can re-derive Apex Instinct alongside. Draws no rng:
// the crit was already rolled at the shared damage block and arrives here as
// one plumbed argument.
export function coldsightLongDrawCritExtensionSec(
  ctx: SimContext,
  hunter: Entity,
  abilityId: string,
  crit: boolean,
): number {
  if (!crit || abilityId !== 'aimed_shot') return 0;
  const meta = ctx.players.get(hunter.id);
  if (!meta || meta.cls !== 'hunter') return 0;
  if (ctx.playerMods(meta).selected[setBonusFlag('coldsight_trackers', 4)] !== true) return 0;
  const windowAura = hunter.auras.find((aura) => aura.kind === 'hunter_cold_focus');
  if (!windowAura) return 0;
  const used = windowAura.value2 ?? 0;
  const granted = Math.min(
    COLDSIGHT_4PC_CRIT_EXTENSION_SEC,
    COLDSIGHT_4PC_WINDOW_EXTENSION_CAP_SEC - used,
  );
  if (granted <= 0) return 0;
  windowAura.remaining += granted;
  windowAura.duration += granted;
  windowAura.value2 = used + granted;
  return granted;
}
