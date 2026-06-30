// Glossary: short, plain definitions of the terms used across the guide and in chat.

import { esc } from '../../ui/esc';
import { type TranslationKey, t } from '../../ui/i18n';
import type { GuidePage } from './types';
import { lead } from './ui';

// Each term carries a slug for a stable per-term anchor (#term-<slug>), so other pages
// can deep-link a piece of jargon to its definition. Exported so site search can index it.
export const GLOSSARY_TERMS: { slug: string; term: TranslationKey; def: TranslationKey }[] = [
  { slug: 'aggro', term: 'guide.glossary.aggroTerm', def: 'guide.glossary.aggroDef' },
  { slug: 'threat', term: 'guide.glossary.threatTerm', def: 'guide.glossary.threatDef' },
  { slug: 'gcd', term: 'guide.glossary.gcdTerm', def: 'guide.glossary.gcdDef' },
  { slug: 'dps', term: 'guide.glossary.dpsTerm', def: 'guide.glossary.dpsDef' },
  { slug: 'buff', term: 'guide.glossary.buffTerm', def: 'guide.glossary.buffDef' },
  { slug: 'debuff', term: 'guide.glossary.debuffTerm', def: 'guide.glossary.debuffDef' },
  { slug: 'dot', term: 'guide.glossary.dotTerm', def: 'guide.glossary.dotDef' },
  { slug: 'cc', term: 'guide.glossary.ccTerm', def: 'guide.glossary.ccDef' },
  { slug: 'proc', term: 'guide.glossary.procTerm', def: 'guide.glossary.procDef' },
  { slug: 'elite', term: 'guide.glossary.eliteTerm', def: 'guide.glossary.eliteDef' },
  { slug: 'rare', term: 'guide.glossary.rareTerm', def: 'guide.glossary.rareDef' },
  { slug: 'mob', term: 'guide.glossary.mobTerm', def: 'guide.glossary.mobDef' },
  { slug: 'tank', term: 'guide.glossary.tankTerm', def: 'guide.glossary.tankDef' },
  { slug: 'healer', term: 'guide.glossary.healerTerm', def: 'guide.glossary.healerDef' },
  { slug: 'spec', term: 'guide.glossary.specTerm', def: 'guide.glossary.specDef' },
  { slug: 'pull', term: 'guide.glossary.pullTerm', def: 'guide.glossary.pullDef' },
  { slug: 'instance', term: 'guide.glossary.instanceTerm', def: 'guide.glossary.instanceDef' },
  { slug: 'raid', term: 'guide.glossary.raidTerm', def: 'guide.glossary.raidDef' },
  { slug: 'delve', term: 'guide.glossary.delveTerm', def: 'guide.glossary.delveDef' },
  { slug: 'augment', term: 'guide.glossary.augmentTerm', def: 'guide.glossary.augmentDef' },
];

export const glossary: GuidePage = {
  titleKey: 'guide.nav.glossary',
  render() {
    const items = GLOSSARY_TERMS.map(
      ({ slug, term, def }) =>
        `<div class="guide-term" id="term-${esc(slug)}"><dt>${esc(t(term))}</dt><dd>${esc(t(def))}</dd></div>`,
    ).join('');
    return `
      <article class="guide-article">
        <h1>${esc(t('guide.nav.glossary'))}</h1>
        ${lead('guide.glossary.intro')}
        <dl class="guide-glossary">${items}</dl>
      </article>`;
  },
};
