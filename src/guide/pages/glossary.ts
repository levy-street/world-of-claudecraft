// Glossary: short, plain definitions of the terms used across the guide and in chat.

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import { GLOSSARY_TERMS } from '../glossary_terms';
import type { GuidePage } from './types';
import { lead } from './ui';

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
