// The one-time word from Master Gunner Alder as the Veterans' Test's win recruits the
// character. The recruitment only moves on a won instructor seat, so the watch only
// fires on a seat seen on the frame before still unrecruited: a login, a reconnect or a
// fresh seat of a recruit sees the flag already set and says nothing. Pure.

import { FIRE_AND_FLY_NPC_DEF } from '../../../sim/content/world_quest_fire_and_fly';
import { tEntity } from '../../entity_i18n';
import { t } from '../../i18n';
import type { TurretBanner } from './turret_hud_view';

export class FireAndFlyRecruitmentWatch {
  /** The flag on the last frame seen seated; null off the seat. */
  private seatedRecruited: boolean | null = null;

  /** True on the one frame a seated character's recruitment turns on. */
  observe(seated: boolean, recruited: boolean): boolean {
    const was = this.seatedRecruited;
    this.seatedRecruited = seated ? recruited : null;
    return seated && recruited && was === false;
  }
}

export function fireAndFlyRecruitedBanner(): TurretBanner {
  return {
    text: t('hudChrome.turret.recruitedBanner'),
    subtext: t('hudChrome.turret.recruitedLine', {
      name: tEntity({ kind: 'npc', id: FIRE_AND_FLY_NPC_DEF.id, field: 'name' }),
    }),
  };
}
