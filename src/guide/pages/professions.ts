import { esc } from '../../ui/esc';
import { type TranslationKey, t } from '../../ui/i18n';
import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { callout, lead, p, related, section } from './ui';

interface GuideCard {
  readonly title: TranslationKey;
  readonly body: TranslationKey;
}

interface ArchetypeCard extends GuideCard {
  readonly majors: TranslationKey;
  readonly hobbies: TranslationKey;
}

const GATHERING: readonly GuideCard[] = [
  {
    title: 'guide.professions.gathering.miningTitle',
    body: 'guide.professions.gathering.miningBody',
  },
  {
    title: 'guide.professions.gathering.loggingTitle',
    body: 'guide.professions.gathering.loggingBody',
  },
  {
    title: 'guide.professions.gathering.herbalismTitle',
    body: 'guide.professions.gathering.herbalismBody',
  },
];

const CRAFTS: readonly GuideCard[] = [
  {
    title: 'guide.professions.crafts.weaponcraftingTitle',
    body: 'guide.professions.crafts.weaponcraftingBody',
  },
  {
    title: 'guide.professions.crafts.armorcraftingTitle',
    body: 'guide.professions.crafts.armorcraftingBody',
  },
  {
    title: 'guide.professions.crafts.engineeringTitle',
    body: 'guide.professions.crafts.engineeringBody',
  },
  { title: 'guide.professions.crafts.alchemyTitle', body: 'guide.professions.crafts.alchemyBody' },
  { title: 'guide.professions.crafts.cookingTitle', body: 'guide.professions.crafts.cookingBody' },
  {
    title: 'guide.professions.crafts.leatherworkingTitle',
    body: 'guide.professions.crafts.leatherworkingBody',
  },
  {
    title: 'guide.professions.crafts.tailoringTitle',
    body: 'guide.professions.crafts.tailoringBody',
  },
  {
    title: 'guide.professions.crafts.inscriptionTitle',
    body: 'guide.professions.crafts.inscriptionBody',
  },
  {
    title: 'guide.professions.crafts.enchantingTitle',
    body: 'guide.professions.crafts.enchantingBody',
  },
  {
    title: 'guide.professions.crafts.jewelcraftingTitle',
    body: 'guide.professions.crafts.jewelcraftingBody',
  },
];

const ARCHETYPES: readonly ArchetypeCard[] = [
  {
    title: 'guide.professions.archetypes.smithTitle',
    majors: 'guide.professions.archetypes.smithMajors',
    hobbies: 'guide.professions.archetypes.smithHobbies',
    body: 'guide.professions.archetypes.smithBody',
  },
  {
    title: 'guide.professions.archetypes.cogsmithTitle',
    majors: 'guide.professions.archetypes.cogsmithMajors',
    hobbies: 'guide.professions.archetypes.cogsmithHobbies',
    body: 'guide.professions.archetypes.cogsmithBody',
  },
  {
    title: 'guide.professions.archetypes.bombardierTitle',
    majors: 'guide.professions.archetypes.bombardierMajors',
    hobbies: 'guide.professions.archetypes.bombardierHobbies',
    body: 'guide.professions.archetypes.bombardierBody',
  },
  {
    title: 'guide.professions.archetypes.apothecaryTitle',
    majors: 'guide.professions.archetypes.apothecaryMajors',
    hobbies: 'guide.professions.archetypes.apothecaryHobbies',
    body: 'guide.professions.archetypes.apothecaryBody',
  },
  {
    title: 'guide.professions.archetypes.trapperTitle',
    majors: 'guide.professions.archetypes.trapperMajors',
    hobbies: 'guide.professions.archetypes.trapperHobbies',
    body: 'guide.professions.archetypes.trapperBody',
  },
  {
    title: 'guide.professions.archetypes.outfitterTitle',
    majors: 'guide.professions.archetypes.outfitterMajors',
    hobbies: 'guide.professions.archetypes.outfitterHobbies',
    body: 'guide.professions.archetypes.outfitterBody',
  },
  {
    title: 'guide.professions.archetypes.mageweaverTitle',
    majors: 'guide.professions.archetypes.mageweaverMajors',
    hobbies: 'guide.professions.archetypes.mageweaverHobbies',
    body: 'guide.professions.archetypes.mageweaverBody',
  },
  {
    title: 'guide.professions.archetypes.arcanistTitle',
    majors: 'guide.professions.archetypes.arcanistMajors',
    hobbies: 'guide.professions.archetypes.arcanistHobbies',
    body: 'guide.professions.archetypes.arcanistBody',
  },
  {
    title: 'guide.professions.archetypes.gembinderTitle',
    majors: 'guide.professions.archetypes.gembinderMajors',
    hobbies: 'guide.professions.archetypes.gembinderHobbies',
    body: 'guide.professions.archetypes.gembinderBody',
  },
  {
    title: 'guide.professions.archetypes.bladewrightTitle',
    majors: 'guide.professions.archetypes.bladewrightMajors',
    hobbies: 'guide.professions.archetypes.bladewrightHobbies',
    body: 'guide.professions.archetypes.bladewrightBody',
  },
];

function cardGrid(cards: readonly GuideCard[]): string {
  const items = cards
    .map(
      (card) => `<li class="guide-basic">
        <h3>${esc(t(card.title))}</h3>
        <p>${esc(t(card.body))}</p>
      </li>`,
    )
    .join('');
  return `<ul class="guide-basics">${items}</ul>`;
}

function archetypeGrid(): string {
  const items = ARCHETYPES.map(
    (card) => `<li class="guide-basic">
      <h3>${esc(t(card.title))}</h3>
      <p><strong>${esc(t('guide.professions.archetypes.majorsLabel'))}</strong> ${esc(t(card.majors))}</p>
      <p><strong>${esc(t('guide.professions.archetypes.hobbiesLabel'))}</strong> ${esc(t(card.hobbies))}</p>
      <p>${esc(t(card.body))}</p>
    </li>`,
  ).join('');
  return `<ul class="guide-basics">${items}</ul>`;
}

export const professions: GuidePage = {
  titleKey: 'guide.nav.professions',
  render() {
    return `
      <article class="guide-article">
        <h1>${esc(t('guide.professions.heading'))}</h1>
        ${lead('guide.professions.intro')}

        ${section('guide.professions.glanceTitle', p('guide.professions.glanceBody') + p('guide.professions.specialistBody'))}

        ${section('guide.professions.gatheringTitle', p('guide.professions.gatheringBody') + cardGrid(GATHERING))}

        ${section('guide.professions.craftsTitle', p('guide.professions.craftsBody') + cardGrid(CRAFTS))}

        ${section(
          'guide.professions.wheelTitle',
          p('guide.professions.wheelBody') +
            p('guide.professions.commonFloorBody') +
            callout(esc(t('guide.professions.hobbyBody')), {
              variant: 'note',
              titleKey: 'guide.professions.hobbyTitle',
            }),
        )}

        ${section('guide.professions.archetypesTitle', p('guide.professions.archetypesBody') + archetypeGrid())}

        ${related([
          { href: hrefFor('gear'), key: 'guide.nav.gear' },
          { href: hrefFor('economy'), key: 'guide.nav.economy' },
          { href: hrefFor('reference/progression'), key: 'guide.nav.progression' },
        ])}
      </article>`;
  },
};
