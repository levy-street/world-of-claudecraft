// The craft row's own words: the role and ceiling chip labels, and the
// next-unlock line under each skill bar. Text resolution the professions
// window used to carry inline; its own module so the window composes it (the
// window is on the monolith ratchet, tests/monolith_budget.test.ts) and a test
// can drive the wording without a DOM.

import { formatNumber, type TranslationKey, t } from '../../i18n';
import type { EmpowermentCeiling, ProfessionRole } from './profession_identity_view';
import type { CraftNextUnlock } from './professions_view';

const ROLE_LABEL_KEYS: Record<ProfessionRole, TranslationKey> = {
  major: 'hudChrome.professions.roleMajor',
  hobby: 'hudChrome.professions.roleHobby',
  dormant: 'hudChrome.professions.roleDormant',
  unattuned: 'hudChrome.professions.roleUnattuned',
};

const CEILING_LABEL_KEYS: Record<EmpowermentCeiling, TranslationKey> = {
  unlimited: 'hudChrome.professions.ceilingUnlimited',
  rare: 'hudChrome.professions.ceilingRare',
  common: 'hudChrome.professions.ceilingCommon',
};

function points(n: number): string {
  return formatNumber(n, { maximumFractionDigits: 0 });
}

/** The role chip: how this craft is being carried right now. */
export function craftRoleLabel(role: ProfessionRole): string {
  return t(ROLE_LABEL_KEYS[role]);
}

/** The ceiling chip: how far empowerment can take this craft. */
export function craftCeilingLabel(ceiling: EmpowermentCeiling): string {
  return t(CEILING_LABEL_KEYS[ceiling]);
}

/** The line under the skill bar: what the next point of skill buys. */
export function craftNextUnlockText(unlock: CraftNextUnlock): string {
  if (unlock.kind === 'mastered') return t('hudChrome.professions.nextUnlockMastered');
  if (unlock.kind === 'specialized')
    return t('hudChrome.professions.nextUnlockSpecialized', {
      points: points(unlock.pointsRemaining),
    });
  return t('hudChrome.professions.nextUnlockTier', { points: points(unlock.pointsRemaining) });
}
