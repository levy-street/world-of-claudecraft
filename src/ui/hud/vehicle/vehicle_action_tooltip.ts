import { CANNON_ACTIONS, CANNON_TACTICS } from '../../../sim/content/cannon_encounter';
import { CANNON_RECOVERY_TICKS } from '../../../sim/minigames/cannon_encounter';
import { type CannonActionId, TICK_RATE } from '../../../sim/types';
import { esc } from '../../esc';
import { formatNumber, getLanguage, t } from '../../i18n';

const NAMES = {
  cannonball: 'hudChrome.vehicle.cannonball',
  grapeshot: 'hudChrome.vehicle.grapeshot',
  incendiary: 'hudChrome.vehicle.incendiary',
} as const;
let language = '';
const descriptions = new Map<CannonActionId, string>();

/** All amounts come from the same flat, gear-independent encounter definitions. */
export function vehicleActionDescription(action: CannonActionId): string {
  const nextLanguage = getLanguage();
  if (language !== nextLanguage) {
    language = nextLanguage;
    descriptions.clear();
  }
  const cached = descriptions.get(action);
  if (cached) return cached;
  const def = CANNON_ACTIONS[action];
  const lines = [
    t('hudChrome.vehicle.shotDamage', {
      damage: formatNumber(def.damage),
      radius: formatNumber(def.radius),
    }),
  ];
  if (def.slowTicks)
    lines.push(
      t('hudChrome.vehicle.shotSlow', {
        amount: formatNumber(1 - def.slowMultiplier, { style: 'percent' }),
        seconds: formatNumber(def.slowTicks / TICK_RATE),
      }),
    );
  if (def.burnTicks)
    lines.push(
      t('hudChrome.vehicle.shotBurn', {
        damage: formatNumber(def.burnDamage),
        seconds: formatNumber(def.burnTicks / TICK_RATE),
      }),
    );
  lines.push(
    t('hudChrome.vehicle.armorRules', {
      reduction: formatNumber(CANNON_TACTICS.armorReduction, { style: 'percent' }),
      bonus: formatNumber(CANNON_TACTICS.exposedFireMultiplier - 1, { style: 'percent' }),
    }),
    t('hudChrome.vehicle.barrelRules', {
      damage: formatNumber(CANNON_TACTICS.barrelDamage),
      radius: formatNumber(CANNON_TACTICS.barrelRadius),
    }),
    t('hudChrome.vehicle.shotTiming', {
      cooldown: formatNumber(def.cooldownTicks / TICK_RATE),
      flight: formatNumber(def.flightTicks / TICK_RATE),
      recovery: formatNumber(CANNON_RECOVERY_TICKS / TICK_RATE),
    }),
    t('hudChrome.vehicle.shotRules'),
  );
  const text = lines.join('\n');
  descriptions.set(action, text);
  return text;
}

export function vehicleActionTooltip(action: CannonActionId): string {
  return `<div class="tt-title">${esc(t(NAMES[action]))}</div><div class="tt-desc">${esc(vehicleActionDescription(action)).replace(/\n/g, '<br>')}</div>`;
}
