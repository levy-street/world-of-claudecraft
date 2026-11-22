/** Body proportions, selected once before studio effects are constructed.
 * Ground damage radii and target impacts deliberately do not use this fit. */
export const LEGACY_PALADIN_FIT = {
  shieldCenter: 0.46,
  shieldHalfHeight: 0.39,
  shieldFront: 0.36,
  shieldWidth: 0.32,
  wingRoot: 0.62,
  lowerWingDrop: 0.3,
  wingScale: 0.8,
  sigilHalf: 0.42,
  sigilLift: 0.32,
  wardRadius: 0.85,
  wardCenter: 0.5,
  healChest: 0.55,
  aegisCrownLift: 0,
};

/** Native WOC shoulders are at .791h and chest at .695h. The wing mesh
 * supplies its own small shoulder rise. Shield point clears the boots while
 * its crown reaches the helmet; both Covenant and Debt use this same frame. */
export const WOC_PALADIN_FIT: typeof LEGACY_PALADIN_FIT = {
  shieldCenter: 0.53,
  shieldHalfHeight: 0.4,
  shieldFront: 0.28,
  shieldWidth: 0.29,
  wingRoot: 0.74,
  lowerWingDrop: 0.2,
  wingScale: 0.72,
  sigilHalf: 0.34,
  sigilLift: 0.26,
  wardRadius: 0.74,
  wardCenter: 0.57,
  healChest: 0.66,
  aegisCrownLift: 0.45,
};

export const PALADIN_BODY_FIT = { ...LEGACY_PALADIN_FIT };

/** The workshop has one fixed rig family. Game entry keeps the legacy fit. */
export function configurePaladinBodyFit(woc: boolean): void {
  Object.assign(PALADIN_BODY_FIT, woc ? WOC_PALADIN_FIT : LEGACY_PALADIN_FIT);
}
