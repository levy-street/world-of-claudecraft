// The one stat-profile pick shared by the scaling armour and the Staff of Changing:
// a role override (tanks, healers, the bear) first, then the spec's primary stat,
// then the class default before a specialization is chosen.
import { MEMBERSHIP_DEFAULT_PROFILE, MEMBERSHIP_SPEC_PROFILE } from './content/membership';
import { SPEC_PRIMARY_STAT, type SpecPrimaryStat } from './content/spec_primary_stat';
import type { PlayerClass } from './types';

const PRIMARY_PROFILE: Readonly<Record<SpecPrimaryStat, string>> = {
  str: 'strength',
  agi: 'agility',
  int: 'caster',
};

export function membershipProfile(cls: PlayerClass, spec: string | null | undefined): string {
  const override = MEMBERSHIP_SPEC_PROFILE[`${cls}_${spec}`];
  if (override) return override;
  const primary = spec ? SPEC_PRIMARY_STAT[cls]?.[spec] : undefined;
  return primary ? PRIMARY_PROFILE[primary] : MEMBERSHIP_DEFAULT_PROFILE[cls];
}
