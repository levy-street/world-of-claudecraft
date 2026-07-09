import type { CastBarInterrupt, CastBarKind, CastBarSource, CastBarState } from '../render/cast_bar';
import { ABILITIES } from '../sim/data';
import { DEMON_HEAL_CAST_ID, FISHING_CAST_ID } from '../sim/types';
import { tEntity } from './entity_i18n';
import { t } from './i18n';

const SPECIAL_CAST_LABELS: Record<string, Parameters<typeof t>[0]> = {
  [FISHING_CAST_ID]: 'abilityUi.cast.fishing',
  [DEMON_HEAL_CAST_ID]: 'abilityUi.cast.demonHeal',
  thunzharr_stormcall: 'abilityUi.cast.thunzharrStormcall',
  nythraxis_deathless_rage: 'abilityUi.cast.nythraxisDeathlessRage',
  nythraxis_ward_channel: 'abilityUi.cast.nythraxisWardChannel',
};

export interface CastCueOptions {
  showInterruptCues?: boolean;
}

export function castDisplayName(id: string): string {
  const specialKey = SPECIAL_CAST_LABELS[id];
  if (specialKey) return t(specialKey);
  return ABILITIES[id] ? tEntity({ kind: 'ability', id, field: 'name' }) : id;
}

export function castCueText(
  st: Pick<CastBarState, 'kind' | 'source' | 'interrupt' | 'important'>,
  opts: CastCueOptions = {},
): string {
  return castCueParts(st.kind, st.source, st.interrupt, st.important, opts).join(', ');
}

export function castCueParts(
  kind: CastBarKind,
  source: CastBarSource,
  interrupt: CastBarInterrupt,
  important: boolean,
  opts: CastCueOptions = {},
): string[] {
  const cues: string[] = [];
  if (source === 'pet') cues.push(t('hudChrome.castBar.pet'));
  if (kind === 'channel') cues.push(t('hudChrome.castBar.channeling'));
  if (important) cues.push(t('hudChrome.castBar.danger'));
  if (opts.showInterruptCues !== false && source !== 'pet') {
    if (interrupt === 'uninterruptible') cues.push(t('hudChrome.castBar.cannotInterrupt'));
    else if (interrupt === 'interruptible') cues.push(t('hudChrome.castBar.interruptible'));
  }
  return cues;
}

export function castLabelWithCue(label: string, cue: string): string {
  return cue ? t('hudChrome.castBar.labelWithCue', { cue, label }) : label;
}
