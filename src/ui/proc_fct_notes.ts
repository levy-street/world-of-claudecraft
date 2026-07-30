import type { AuraKind } from '../sim/types';
import { auraDisplayNameFromSource } from './aura_display_name';
import { isNextCastEmpowerKind } from './hud/action_bar/action_bar_view';
import { type TranslationKey, t } from './i18n';

const NEXT_CAST_CONSUME_LABEL_KEYS: Partial<Record<AuraKind, TranslationKey>> = {
  next_cast_free: 'hudChrome.discord.swag.free',
  next_execute_free: 'hudChrome.discord.swag.free',
  next_cast_instant: 'abilityUi.tooltip.instant',
  next_cast_cheap: 'hudChrome.fct.cheap',
};

export function procAuraGainSelfNoteText(name: string, kind: AuraKind | undefined): string | null {
  if (!kind || !isNextCastEmpowerKind(kind)) return null;
  return auraDisplayNameFromSource(name);
}

export function procAuraConsumeSelfNoteText(kind: AuraKind | undefined): string | null {
  if (!kind || !isNextCastEmpowerKind(kind)) return null;
  const key = NEXT_CAST_CONSUME_LABEL_KEYS[kind];
  return key ? t(key) : null;
}
