// Chat report formatter for combat meters.
// Produces clean, single-line party/raid summaries matching WoW Details! conventions.

import { t } from './i18n';
import type { Encounter } from './meters';
import { fmtDuration, fmtNum, fmtPerSecond } from './meters_format';
import { buildMeterRows, type MeterTab } from './meters_rows_view';

export function formatChatReport(
  enc: Encounter,
  tab: MeterTab,
  viewName: string,
  limit = 5,
): string {
  const dur = Math.max(1, enc?.duration ?? 0);
  const rows = enc?.tallies
    ? buildMeterRows({
        tallies: enc.tallies.values(),
        tab,
        liveThreat: null,
        petsByOwner: null,
        mainMobId: enc.mainMobId,
        aggroPid: null,
      }).slice(0, limit)
    : [];

  const tabLabels: Record<MeterTab, string> = {
    dmg: t('hud.meters.damage'),
    heal: t('hud.meters.healing'),
    dmgTaken: t('hud.meters.damageTaken'),
    interrupts: t('hud.meters.interrupts'),
    deaths: t('hud.meters.deaths'),
    threat: t('hud.meters.threat'),
  };
  const metric = tabLabels[tab] ?? tab;
  const label = enc.label && enc.label !== 'Combat' ? enc.label : viewName;

  if (rows.length === 0) {
    return `[WoC] ${metric} (${label}): ${t('hudChrome.meters.reportNoData')}`;
  }

  const parts = rows.map((r, i) => {
    const pct = Math.round(r.percent * 100);
    const val = fmtNum(r.value);
    if (tab === 'interrupts' || tab === 'deaths') {
      return `${i + 1}. ${r.tally.name} ${val}`;
    }
    const dps = fmtPerSecond(r.value / dur);
    return `${i + 1}. ${r.tally.name} ${val} (${dps}, ${pct}%)`;
  });

  return `[WoC] ${metric} (${label} - ${fmtDuration(dur)}): ${parts.join(' | ')}`;
}
