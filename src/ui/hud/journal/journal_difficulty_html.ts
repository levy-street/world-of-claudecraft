// Markup for the Adventure Journal's difficulty selector (strings only, never
// DOM): one small crest per difficulty at the top right of the banner. Each
// crest is a shield wearing its danger skulls (Normal one, Heroic two in a
// row, Mythic two over one, the heraldic "two and one"), drawn in its own
// colour identity by CSS tokens (Normal a steady steel, Heroic a forge fire,
// Mythic an arcane violet); the selected one is lit. Mythic carries a small
// lock on its crest and the "coming soon" note under the row. The window
// (adventure_journal_window.ts) wires the clicks and the roving arrow keys.

import { esc } from '../../esc';
import { FOCUS_KEY_ATTR } from '../../focus_restore';
import { type TranslationKey, t } from '../../i18n';
import { svgIcon } from '../../ui_icons';
import type { JournalInstance, JournalTier } from './journal_catalog';

const TIER_KEYS: Readonly<Record<JournalTier, TranslationKey>> = {
  normal: 'hudChrome.raidBossGuide.normal',
  heroic: 'hudChrome.raidBossGuide.heroic',
  mythic: 'hudChrome.adventureJournal.mythic',
};

export function tierName(tier: JournalTier): string {
  return t(TIER_KEYS[tier]);
}

/** How many skulls each difficulty wears on its crest (Normal 1, Heroic 2,
 *  Mythic 3): the classic danger mark, decorative (the name says it). */
export const TIER_SKULLS: Readonly<Record<JournalTier, number>> = {
  normal: 1,
  heroic: 2,
  mythic: 3,
};

function crestHtml(tier: JournalTier): string {
  const count = TIER_SKULLS[tier];
  const lock = tier === 'mythic' ? `<span class="aj-crest-lock">${svgIcon('lock')}</span>` : '';
  return `<span class="aj-crest-wrap" aria-hidden="true"><span class="aj-crest"><span class="aj-crest-face"><span class="aj-skulls aj-skulls-${count}" aria-hidden="true">${svgIcon(
    'skull',
  ).repeat(count)}</span></span></span>${lock}</span>`;
}

/** The crest row and, where the instance lists Mythic, its Coming soon note. */
export function difficultyHtml(instance: JournalInstance, tier: JournalTier): string {
  const label = t('hudChrome.raidBossGuide.difficultyLabel');
  const soon = instance.tiers.includes('mythic')
    ? `<span class="aj-soon-note">${esc(t('hudChrome.adventureJournal.mythicSoon'))}</span>`
    : '';
  return `<div class="aj-diffbox"><div class="rbg-segmented aj-diff" role="group" aria-label="${esc(
    label,
  )}">${instance.tiers
    .map((entry) => {
      const selected = entry === tier;
      return `<button type="button" data-difficulty="${entry}" ${FOCUS_KEY_ATTR}="difficulty:${entry}" aria-pressed="${selected}" aria-label="${esc(
        t('hudChrome.raidBossGuide.chooseDifficulty', { difficulty: tierName(entry) }),
      )}" class="aj-tier aj-tier-${entry}${selected ? ' active' : ''}">${crestHtml(
        entry,
      )}<span class="aj-tier-name">${esc(tierName(entry))}</span></button>`;
    })
    .join('')}</div>${soon}</div>`;
}
