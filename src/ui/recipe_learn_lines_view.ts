// Learn-outcome chat lines: the pure line-building core behind the hud's
// trainResult and recipeScrollResult event arms. Extracted from the hud
// coordinator (the monolith ratchet's extraction rule) so both learn paths
// render through ONE set of training keys, and a Vitest exercises every
// reason arm directly. Returns null where the event renders nothing: the
// reason-less silent-deny arms (the malformed-recipe-id probe answer), and
// scroll_wrong_source (a scroll whose recipe does not list 'drop', an
// authoring error content guards pin out of shipped scrolls, never a
// player-actionable state).

import { recipeById } from '../sim/content/recipes';
import { ITEMS } from '../sim/data';
import { TIER_SKILL_STEP, tierForSkill } from '../sim/professions/wheel';
import { craftNameText } from './craft_name_view';
import { itemDisplayName } from './entity_i18n';
import { formatNumber, t } from './i18n';

export interface LearnResultLine {
  text: string;
  color: string;
}

const SUCCESS_COLOR = '#7fdc4f';
const DENY_COLOR = '#ff6b6b';

/** The ONE success surface for both learn paths: a chat line, no toast, no
 *  sound cue (the trainResult single-surface rule). The recipe name derives
 *  from the result item; an unresolvable id falls back to the raw id. */
function learnedLine(recipeId: string): LearnResultLine {
  const recipe = recipeById(recipeId);
  const item = recipe ? ITEMS[recipe.resultItemId] : undefined;
  return {
    text: t('hudChrome.training.learned', {
      recipe: item ? itemDisplayName(item) : recipeId,
    }),
    color: SUCCESS_COLOR,
  };
}

function tierUnmetLine(recipeId: string): LearnResultLine {
  const recipe = recipeById(recipeId);
  return {
    text: t('hudChrome.training.tierUnmet', {
      craft: craftNameText(recipe?.professionId ?? null),
      skill: formatNumber(tierForSkill(recipe?.skillReq ?? 0) * TIER_SKILL_STEP, {
        maximumFractionDigits: 0,
      }),
    }),
    color: DENY_COLOR,
  };
}

/** The trainResult chat line, or null for the reason-less silent-deny arm. */
export function trainResultLine(ev: {
  ok: boolean;
  recipeId: string;
  reason?:
    | 'train_already_known'
    | 'train_not_taught_here'
    | 'train_out_of_range'
    | 'train_tier_unmet'
    | 'train_cannot_afford';
}): LearnResultLine | null {
  if (ev.ok) return learnedLine(ev.recipeId);
  if (!ev.reason) return null;
  if (ev.reason === 'train_tier_unmet') return tierUnmetLine(ev.recipeId);
  return {
    text: t(
      ev.reason === 'train_cannot_afford'
        ? 'hudChrome.training.cannotAfford'
        : ev.reason === 'train_not_taught_here'
          ? 'hudChrome.training.notTaughtHere'
          : ev.reason === 'train_already_known'
            ? 'hudChrome.training.alreadyKnown'
            : 'hudChrome.training.outOfRange',
    ),
    color: DENY_COLOR,
  };
}

/** The recipeScrollResult chat line, or null where nothing renders (the
 *  reason-less unknown-id arm and scroll_wrong_source). Scroll denies reuse
 *  the training keys on purpose: same message, zero new locale rows. */
export function recipeScrollResultLine(ev: {
  ok: boolean;
  recipeId: string;
  reason?: 'scroll_already_known' | 'scroll_tier_unmet' | 'scroll_wrong_source';
}): LearnResultLine | null {
  if (ev.ok) return learnedLine(ev.recipeId);
  if (ev.reason === 'scroll_tier_unmet') return tierUnmetLine(ev.recipeId);
  if (ev.reason === 'scroll_already_known') {
    return { text: t('hudChrome.training.alreadyKnown'), color: DENY_COLOR };
  }
  return null;
}
