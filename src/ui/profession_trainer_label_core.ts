// Pure core: npc id to the localized Profession Trainer label (and its
// nameplate form). Consumed by entity_display_core (dialogue and frame
// titles) and the nameplate painter; resolved per pass like npcDisplayName,
// so a language switch propagates without a cache to invalidate.
import { PROFESSION_TRAINERS } from '../sim/content/profession_trainers';
import { t } from './i18n';

export function professionTrainerLabel(npcId: string): string {
  if (!Object.hasOwn(PROFESSION_TRAINERS, npcId)) return '';
  const role = PROFESSION_TRAINERS[npcId as keyof typeof PROFESSION_TRAINERS];
  return t(`hudChrome.professionTrainers.${role}`);
}

export function professionTrainerNameplateLabel(npcId: string): string {
  const title = professionTrainerLabel(npcId);
  return title ? t('hudChrome.professionTrainers.nameplate', { title }) : '';
}
