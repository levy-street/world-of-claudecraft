// Personal seasonal exploration progress shared by desktop and touch trackers.
import { GOURDLIGHT_PUMPKINS } from '../sim/content/gourdlight_pumpkins';
import { zoneDisplayName } from './entity_i18n';
import type { TrackedQuest } from './hud/quest/quest_tracker';
import { formatNumber, t } from './i18n';

export const HAUNTED_PUMPKIN_TRACKER_ID = 'seasonal:haunted-pumpkins';

export function hauntedPumpkinTrackerRow(
  event: string | null | undefined,
  found: readonly string[],
  zoneId: string,
): TrackedQuest | null {
  if (event !== 'gourdlight_eve') return null;
  const discovered = new Set(found);
  const zone = GOURDLIGHT_PUMPKINS.filter((pumpkin) => pumpkin.zoneId === zoneId);
  const progress = (label: string, pumpkins: typeof GOURDLIGHT_PUMPKINS) => {
    const current = pumpkins.filter((pumpkin) => discovered.has(pumpkin.id)).length;
    const total = pumpkins.length;
    return {
      label: t('seasonal.pumpkins.progress', {
        label,
        current: formatNumber(current),
        total: formatNumber(total),
      }),
      current,
      total,
      instruction: true,
    };
  };
  return {
    id: HAUNTED_PUMPKIN_TRACKER_ID,
    number: 0,
    title: t('seasonal.pumpkins.title'),
    complete: false,
    objectives: [
      ...(zone.length ? [progress(zoneDisplayName(zoneId), zone)] : []),
      progress(t('seasonal.pumpkins.world'), GOURDLIGHT_PUMPKINS),
    ],
  };
}
