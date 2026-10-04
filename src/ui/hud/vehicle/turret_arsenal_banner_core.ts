// Fire and Fly's arsenal lines on the seat's banners: the first wave's subtext, which
// presents a weapon the trial brings in (with its key) or else names the keys of the
// weapons the scenario gives, and a mission's resupply line under a cleared wave. A
// weapon the scenario does not give is never named. Pure: no DOM.
import { TURRET_SCENARIOS } from '../../../sim/content/fire_and_fly_scenarios';
import type { TurretEvent } from '../../../sim/minigames/turret_defense';
import type { TurretArsenal, TurretPlan } from '../../../sim/minigames/turret_defense_plan';
import { formatNumber, t } from '../../i18n';
import type { TurretWeaponKind } from './turret_weapon_tooltip';

/** The keys the first wave's banner names for the two weapons; null where there are none (touch). */
export interface TurretWeaponKeys {
  shock: string;
  frag: string;
}

function holds(arsenal: Partial<TurretArsenal> | undefined, weapon: TurretWeaponKind): boolean {
  return ((weapon === 'shock' ? arsenal?.shockwave : arsenal?.fragmentation) ?? 0) > 0;
}

/**
 * The weapon a trial brings in: the first one its plan's arsenal holds that the trial
 * before it (in the order they open) did not. Null for the first trial, a mission, or a
 * trial that adds none.
 */
export function turretIntroducedWeapon(
  plan: Pick<TurretPlan, 'scenarioId' | 'arsenal'>,
): TurretWeaponKind | null {
  const index = TURRET_SCENARIOS.findIndex((scenario) => scenario.id === plan.scenarioId);
  if (index <= 0) return null;
  const before = TURRET_SCENARIOS[index - 1].arsenal;
  const now = plan.arsenal;
  for (const weapon of ['shock', 'frag'] as const) {
    if (holds(now, weapon) && !holds(before, weapon)) return weapon;
  }
  return null;
}

function introLine(weapon: TurretWeaponKind, bound: TurretWeaponKeys | null): string {
  if (weapon === 'shock') {
    return bound
      ? t('hudChrome.turretArsenal.introShock', { shockKey: bound.shock })
      : t('hudChrome.turretArsenal.introShockTouch');
  }
  return bound
    ? t('hudChrome.turretArsenal.introFrag', { fragKey: bound.frag })
    : t('hudChrome.turretArsenal.introFragTouch');
}

function keysLine(arsenal: TurretArsenal, bound: TurretWeaponKeys | null): string {
  const shock = holds(arsenal, 'shock');
  const frag = holds(arsenal, 'frag');
  if (shock && frag) {
    return bound
      ? t('hudChrome.turret.weaponsHint', { shockKey: bound.shock, fragKey: bound.frag })
      : t('hudChrome.turret.weaponsHintTouch');
  }
  if (shock) {
    return bound
      ? t('hudChrome.turretArsenal.shockHint', { shockKey: bound.shock })
      : t('hudChrome.turretArsenal.shockHintTouch');
  }
  return bound
    ? t('hudChrome.turretArsenal.fragHint', { fragKey: bound.frag })
    : t('hudChrome.turretArsenal.fragHintTouch');
}

/**
 * The first wave's subtext: the goal alone when the scenario gives no weapon (or the
 * caller knows no input); a weapon the trial brings in, presented with its key; else
 * the keys of the weapons it gives. `keys` is null on touch, which has none.
 */
export function turretFirstWaveHint(
  plan: Pick<TurretPlan, 'scenarioId' | 'arsenal'>,
  keys: (() => TurretWeaponKeys | null) | undefined,
): string {
  const { arsenal } = plan;
  if (!keys || !(holds(arsenal, 'shock') || holds(arsenal, 'frag'))) {
    return t('hudChrome.turret.hint');
  }
  const bound = keys();
  const introduced = turretIntroducedWeapon(plan);
  return introduced ? introLine(introduced, bound) : keysLine(arsenal, bound);
}

const SIGNED: Intl.NumberFormatOptions = { signDisplay: 'exceptZero' };

/** A resupply's line: each weapon it gave a charge of, as an addition. */
export function turretResupplyLine(event: Extract<TurretEvent, { type: 'resupply' }>): string {
  const shock = formatNumber(event.shockwave, SIGNED);
  const frag = formatNumber(event.fragmentation, SIGNED);
  if (event.shockwave > 0 && event.fragmentation > 0) {
    return t('hudChrome.turretArsenal.resupplyBoth', { shock, frag });
  }
  return event.shockwave > 0
    ? t('hudChrome.turretArsenal.resupplyShock', { shock })
    : t('hudChrome.turretArsenal.resupplyFrag', { frag });
}
