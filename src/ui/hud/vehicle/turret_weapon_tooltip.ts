// The Fire and Fly limited weapons' tooltips: every number is resolved from the
// weapon content and the current wave's shell damage, the one the engine's blasts
// scale from (the Shockwave's ring, each bomblet). Cached per language and damage.
import { TURRET_FRAGMENTATION, TURRET_SHOCKWAVE } from '../../../sim/content/turret_defense';
import { TURRET_BOMBLETS } from '../../../sim/minigames/turret_fragmentation';
import { TICK_RATE } from '../../../sim/types';
import type { TurretSessionView } from '../../../world_api/vehicles';
import { esc } from '../../esc';
import { formatNumber, getI18nRevision, t } from '../../i18n';

export type TurretWeaponKind = 'shock' | 'frag';

/** The current wave's shell core damage (the last wave's after the run), as the engine reads it. */
export function turretWaveCoreDamage(session: TurretSessionView): number {
  const { plan, wave } = session.defense;
  const current = plan.waves[Math.min(wave, plan.waves.length - 1)];
  return current ? current.coreDamage : 0;
}

/** A blast's damage on a body at full strength, rounded as the engine rounds each hit. */
function fullHit(damage: number): number {
  return Math.max(1, Math.round(damage));
}

/** The Shockwave's hit on a monster inside its core, in the current wave. */
export function turretShockwaveHitDamage(coreDamage: number): number {
  return fullHit(coreDamage * TURRET_SHOCKWAVE.damageScale);
}

/** A bomblet's hit on a monster inside its core, in the current wave. */
export function turretBombletHitDamage(coreDamage: number): number {
  return fullHit(coreDamage * TURRET_FRAGMENTATION.damageScale);
}

const seconds = (ticks: number) => formatNumber(ticks / TICK_RATE, { maximumFractionDigits: 1 });

function shockwaveDescription(coreDamage: number): string {
  const s = TURRET_SHOCKWAVE;
  return [
    t('hudChrome.turret.shockwaveTip', {
      reach: formatNumber(s.reach),
      seconds: seconds(s.rollTicks),
      damage: formatNumber(turretShockwaveHitDamage(coreDamage)),
      core: formatNumber(s.falloffCore),
    }),
    t('hudChrome.turret.shockwaveRules', { seconds: seconds(s.rearmTicks) }),
  ].join('\n');
}

function fragDescription(coreDamage: number): string {
  const f = TURRET_FRAGMENTATION;
  return [
    t('hudChrome.turret.fragTip', {
      count: formatNumber(TURRET_BOMBLETS),
      outer: formatNumber(f.outerCount),
      radius: formatNumber(f.outerRadius),
      damage: formatNumber(turretBombletHitDamage(coreDamage)),
      blast: formatNumber(f.blastRadius),
    }),
    t('hudChrome.turret.fragRules'),
  ].join('\n');
}

let revision = -1;
const cache = new Map<string, string>();

/** The weapon's rules for the given wave damage (the socket's aria description). */
export function turretWeaponDescription(weapon: TurretWeaponKind, coreDamage: number): string {
  const current = getI18nRevision();
  if (current !== revision) {
    revision = current;
    cache.clear();
  }
  const key = `${weapon}|${coreDamage}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const text = weapon === 'shock' ? shockwaveDescription(coreDamage) : fragDescription(coreDamage);
  cache.set(key, text);
  return text;
}

export function turretWeaponName(weapon: TurretWeaponKind): string {
  return t(weapon === 'shock' ? 'hudChrome.turret.shockwave' : 'hudChrome.turret.frag');
}

/** The socket's tooltip: the name, the rules, then the charges left as the player sees them. */
export function turretWeaponTooltip(
  weapon: TurretWeaponKind,
  coreDamage: number,
  charges: number,
): string {
  const rules = esc(turretWeaponDescription(weapon, coreDamage)).replace(/\n/g, '<br>');
  const left = esc(t('hudChrome.turret.chargesLeft', { count: formatNumber(charges) }));
  return `<div class="tt-title">${esc(turretWeaponName(weapon))}</div><div class="tt-desc">${rules}</div><div class="tt-desc">${left}</div>`;
}
