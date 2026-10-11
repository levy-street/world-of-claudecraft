import type { CannonEncounterState, CannonResult } from '../../../sim/types';
import { formatNumber, t } from '../../i18n';

export function cannonTacticsHint(state: CannonEncounterState): string {
  if (state.enemies.some((e) => e.kind === 'sapper')) return t('hudChrome.vehicle.sapperWarning');
  if (state.commanderCharging && !state.commanderKilled)
    return t('hudChrome.vehicle.chargeWarning');
  if (state.enemies.some((e) => e.kind === 'armored' && !e.armorBroken))
    return t('hudChrome.vehicle.armorHint');
  if (state.enemies.some((e) => e.kind === 'armored' && e.armorBroken))
    return t('hudChrome.vehicle.exposedHint');
  return t('hudChrome.vehicle.barrelHint');
}

export function cannonResultText(result: CannonResult): string | null {
  if (
    ![null, 'bronze', 'silver', 'gold'].includes(result.medal) ||
    !Number.isInteger(result.integrity) ||
    result.integrity < 0 ||
    result.integrity > 100 ||
    !Number.isSafeInteger(result.shotsFired) ||
    result.shotsFired < 0 ||
    result.shotsFired > 1000000 ||
    !Number.isSafeInteger(result.shotsHit) ||
    result.shotsHit < 0 ||
    result.shotsHit > result.shotsFired ||
    (result.wavesCleared !== undefined &&
      (!Number.isSafeInteger(result.wavesCleared) ||
        result.wavesCleared < 0 ||
        result.wavesCleared > 1000))
  )
    return null;
  const line = t('hudChrome.vehicle.result', {
    medal: t(
      result.medal === 'gold'
        ? 'hudChrome.vehicle.gold'
        : result.medal === 'silver'
          ? 'hudChrome.vehicle.silver'
          : result.medal === 'bronze'
            ? 'hudChrome.vehicle.bronze'
            : 'hudChrome.vehicle.failed',
    ),
    integrity: formatNumber(result.integrity / 100, { style: 'percent' }),
    accuracy: formatNumber(result.shotsFired ? result.shotsHit / result.shotsFired : 0, {
      style: 'percent',
    }),
  });
  // Endless play reports the waves held after the authored three.
  return result.wavesCleared !== undefined && result.wavesCleared > 3
    ? `${line} ${t('hudChrome.vehicle.resultWaves', { waves: formatNumber(result.wavesCleared) })}`
    : line;
}
