// Professions overview: gathering (Mining, Logging, Herbalism), the ten crafts on the
// ring, and the ten archetypes. Systems and direction only, no balance numbers (WoW-style
// altitude, same as economy.ts/gear.ts). Hand-authored prose (like economy/social/combat),
// not generated from src/sim/content/: this page documents a whole system's shape rather
// than an enumerable per-entity list.

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { lead, p, related, section } from './ui';

const GATHERING_BLOCKS = [
  ['guide.professions.gatherWhatTitle', 'guide.professions.gatherWhatBody'],
  ['guide.professions.gatherProficiencyTitle', 'guide.professions.gatherProficiencyBody'],
  ['guide.professions.gatherToolsTitle', 'guide.professions.gatherToolsBody'],
] as const;

const CRAFT_BLOCKS = [
  ['guide.professions.craftRingTitle', 'guide.professions.craftRingBody'],
  ['guide.professions.craftRecipesTitle', 'guide.professions.craftRecipesBody'],
  ['guide.professions.craftMasteryTitle', 'guide.professions.craftMasteryBody'],
  ['guide.professions.craftComboTitle', 'guide.professions.craftComboBody'],
] as const;

const ARCHETYPE_BLOCKS = [
  ['guide.professions.archetypeChooseTitle', 'guide.professions.archetypeChooseBody'],
  ['guide.professions.archetypeSwitchTitle', 'guide.professions.archetypeSwitchBody'],
  ['guide.professions.archetypeIdentityTitle', 'guide.professions.archetypeIdentityBody'],
] as const;

export const professions: GuidePage = {
  titleKey: 'guide.nav.professions',
  render() {
    const gatheringBlocks = GATHERING_BLOCKS.map(([title, body]) => section(title, p(body))).join(
      '',
    );
    const craftBlocks = CRAFT_BLOCKS.map(([title, body]) => section(title, p(body))).join('');
    const archetypeBlocks = ARCHETYPE_BLOCKS.map(([title, body]) => section(title, p(body))).join(
      '',
    );
    return `
      <article class="guide-article">
        <h1>${esc(t('guide.nav.professions'))}</h1>
        ${lead('guide.professions.intro')}

        <section class="guide-block">
          <h2>${esc(t('guide.professions.gatherTitle'))}</h2>
          <p>${esc(t('guide.professions.gatherIntro'))}</p>
        </section>
        ${gatheringBlocks}

        <section class="guide-block">
          <h2>${esc(t('guide.professions.craftTitle'))}</h2>
          <p>${esc(t('guide.professions.craftIntro'))}</p>
        </section>
        ${craftBlocks}

        <section class="guide-block">
          <h2>${esc(t('guide.professions.archetypeTitle'))}</h2>
          <p>${esc(t('guide.professions.archetypeIntro'))}</p>
        </section>
        ${archetypeBlocks}

        ${related([
          { href: hrefFor('gear'), key: 'guide.nav.gear' },
          { href: hrefFor('economy'), key: 'guide.nav.economy' },
          { href: hrefFor('world'), key: 'guide.nav.world' },
          { href: hrefFor('progression'), key: 'guide.nav.progression' },
        ])}
      </article>`;
  },
};
