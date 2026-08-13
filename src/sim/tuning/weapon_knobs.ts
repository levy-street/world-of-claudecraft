// The class power tuner's WEAPON scope: auto-attack ("white") swing damage and
// swing timer, per weapon.
//
// White damage is not an ability. It comes from the `WeaponInfo` carried by the
// equipped item (`ITEMS[id].weapon`) or, for a hunter's Auto Shot and a caster's
// wand, by the class's own `CLASSES[cls].ranged`. Those two numbers drive every
// melee and ranged auto-attack (sim/combat/auto_attack.ts), so tuning them is
// how an operator moves a class's sustained baseline without touching a spell.
//
// Same shape as `ability_knobs.ts`: ONE traversal lists the knobs and applies
// them, so the sliders offered and the numbers changed cannot drift apart.
//
// Pure leaf: no SimContext, no rng, no clock.

import type { WeaponInfo } from '../types';
import type { TunedSite, TunedSiteVisitor } from './ability_knobs';
import { isEffectiveTuningSite, scaleTuningValue, type TuningChannel } from './channels';

// A weapon's swing damage roll and its seconds-per-swing. `speed` is LINEAR on
// purpose and rises with the factor: the slider reads "swing timer", so 1.2x is
// a slower weapon, which is the nerf direction the label implies.
/** The smallest swing timer the tuner will produce (one 20 Hz tick). */
export const MIN_SWING_SECONDS = 0.05;

const SWING_DAMAGE: { channel: TuningChannel; kind: 'linear' } = {
  channel: 'swing_damage',
  kind: 'linear',
};
const SWING_SPEED: { channel: TuningChannel; kind: 'linear' } = {
  channel: 'swing_speed',
  kind: 'linear',
};

/**
 * Visit the tunable numbers of one weapon profile. The visitor may return a
 * replacement; returning nothing leaves the number alone. Never mutates: an
 * untouched weapon comes back by reference.
 *
 * Generic in the profile type so a class's `ranged` (a `WeaponInfo` plus its
 * range band and wand flag) comes back as itself rather than being widened: the
 * clone already carries those extra fields, and the caller can assign the result
 * straight back without re-spreading the shipped profile over it.
 */
export function walkTunedWeapon<T extends WeaponInfo>(weapon: T, visit: TunedSiteVisitor): T {
  let changed = false;
  const take = (
    spec: { channel: TuningChannel; kind: 'linear' },
    path: string,
    value: number,
  ): number => {
    const next = visit({ channel: spec.channel, kind: spec.kind, path, value });
    if (typeof next !== 'number' || !Number.isFinite(next) || next === value) return value;
    changed = true;
    return next;
  };

  const out: T = { ...weapon };
  out.min = take(SWING_DAMAGE, 'min', weapon.min);
  out.max = take(SWING_DAMAGE, 'max', weapon.max);
  out.speed = take(SWING_SPEED, 'speed', weapon.speed);
  // A swing timer at or near zero would make the auto-attack loop fire every
  // tick, so the floor is one sim tick's worth of time however hard the slider
  // is pulled. Applied after the visit, so it binds the tuned value, not the
  // authored one (a shipped weapon is never this fast).
  if (out.speed < MIN_SWING_SECONDS) {
    if (out.speed !== weapon.speed) changed = true;
    out.speed = MIN_SWING_SECONDS;
  }
  return changed ? out : weapon;
}

/** Every knob this weapon exposes, dropping any a slider provably cannot move. */
export function weaponTuningKnobs(
  weapon: WeaponInfo,
  options: { includeInert?: boolean } = {},
): TunedSite[] {
  const sites: TunedSite[] = [];
  walkTunedWeapon(weapon, (site) => {
    if (options.includeInert || isEffectiveTuningSite(site.value, site.kind)) sites.push(site);
  });
  return sites;
}

/** The tuned clone of one weapon profile for its per-channel factors. */
export function applyWeaponTuning<T extends WeaponInfo>(
  weapon: T,
  factors: Readonly<Partial<Record<TuningChannel, number>>>,
): T {
  return walkTunedWeapon(weapon, (site) => {
    const factor = factors[site.channel];
    if (factor === undefined || factor === 1) return;
    return scaleTuningValue(site.value, factor, site.kind, site.channel);
  });
}

/** Average damage per second of a weapon profile, for the dashboard readout. */
export function weaponDps(weapon: WeaponInfo): number {
  if (weapon.speed <= 0) return 0;
  return Math.round(((weapon.min + weapon.max) / 2 / weapon.speed + Number.EPSILON) * 100) / 100;
}
