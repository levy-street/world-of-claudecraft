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
