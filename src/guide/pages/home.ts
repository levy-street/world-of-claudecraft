// Home / overview landing. A cinematic hero over the game's loading art, then sparse
// teasers for classes, the world, group content, and a short FAQ, in the spirit of
// kintara.gg. Every string is a t() key; every number goes through formatNumber.

import { t, formatNumber } from '../../ui/i18n';
import { esc } from '../../ui/esc';
import { hrefFor } from '../routes';
import { CLASS_CHIPS, ZONE_TEASERS, LEVEL_CAP } from '../data';
import type { GuidePage } from './types';

function heroHtml(): string {
  return `
    <section class="guide-hero" aria-labelledby="guide-hero-title">
      <div class="guide-hero-inner">
        <p class="guide-eyebrow">${esc(t('guide.home.eyebrow'))}</p>
        <h1 class="guide-hero-title" id="guide-hero-title">${esc(t('guide.home.title'))}</h1>
        <p class="guide-hero-sub">${esc(t('guide.home.subtitle'))}</p>
        <div class="guide-hero-cta">
          <a class="guide-cta" href="/play">${esc(t('guide.home.ctaPlay'))}</a>
          <a class="guide-cta guide-cta-ghost" href="${esc(hrefFor('how-to-play'))}">${esc(t('guide.home.ctaLearn'))}</a>
        </div>
      </div>
    </section>`;
}

function pillarsHtml(): string {
  const pillars = [
    ['guide.home.what.pillarPlayTitle', 'guide.home.what.pillarPlayBody'],
    ['guide.home.what.pillarClassesTitle', 'guide.home.what.pillarClassesBody'],
    ['guide.home.what.pillarOpenTitle', 'guide.home.what.pillarOpenBody'],
  ] as const;
  const cards = pillars
    .map(([title, body]) => `
      <div class="guide-pillar">
        <h3>${esc(t(title))}</h3>
        <p>${esc(t(body))}</p>
      </div>`)
    .join('');
  return `
    <section class="guide-section" aria-labelledby="guide-what-h">
      <h2 class="guide-section-h" id="guide-what-h">${esc(t('guide.home.what.heading'))}</h2>
      <div class="guide-pillars">${cards}</div>
    </section>`;
}

function classesHtml(): string {
  const chips = CLASS_CHIPS
    .map((c) => `
      <a class="guide-class-chip" href="${esc(hrefFor('classes'))}" style="--class-color:${esc(c.color)}">
        <span class="guide-class-name">${esc(t(c.nameKey))}</span>
      </a>`)
    .join('');
  return `
    <section class="guide-section" aria-labelledby="guide-classes-h">
      <h2 class="guide-section-h" id="guide-classes-h">${esc(t('guide.home.classes.heading'))}</h2>
      <p class="guide-section-sub">${esc(t('guide.home.classes.sub'))}</p>
      <div class="guide-class-grid">${chips}</div>
      <p class="guide-section-more"><a href="${esc(hrefFor('classes'))}">${esc(t('guide.home.classes.cta'))}</a></p>
    </section>`;
}

function worldHtml(): string {
  const cards = ZONE_TEASERS
    .map((z) => `
      <a class="guide-zone-card guide-zone-${esc(z.id)}" href="${esc(hrefFor('world'))}">
        <div class="guide-zone-body">
          <span class="guide-zone-band">${esc(t('guide.home.world.levels', { min: formatNumber(z.min), max: formatNumber(z.max) }))}</span>
          <h3 class="guide-zone-name">${esc(t(z.nameKey))}</h3>
          <p class="guide-zone-blurb">${esc(t(z.blurbKey))}</p>
        </div>
      </a>`)
    .join('');
  return `
    <section class="guide-section" aria-labelledby="guide-world-h">
      <h2 class="guide-section-h" id="guide-world-h">${esc(t('guide.home.world.heading'))}</h2>
      <p class="guide-section-sub">${esc(t('guide.home.world.sub'))}</p>
      <div class="guide-zone-grid">${cards}</div>
      <p class="guide-section-more"><a href="${esc(hrefFor('world'))}">${esc(t('guide.home.world.cta'))}</a></p>
    </section>`;
}

function groupHtml(): string {
  const cards = [
    ['guide.home.group.dungeonsTitle', 'guide.home.group.dungeonsBody'],
    ['guide.home.group.raidTitle', 'guide.home.group.raidBody'],
    ['guide.home.group.arenaTitle', 'guide.home.group.arenaBody'],
  ] as const;
  const html = cards
    .map(([title, body]) => `
      <div class="guide-group-card">
        <h3>${esc(t(title))}</h3>
        <p>${esc(t(body))}</p>
      </div>`)
    .join('');
  return `
    <section class="guide-section" aria-labelledby="guide-group-h">
      <h2 class="guide-section-h" id="guide-group-h">${esc(t('guide.home.group.heading'))}</h2>
      <p class="guide-section-sub">${esc(t('guide.home.group.sub'))}</p>
      <div class="guide-group-grid">${html}</div>
      <p class="guide-section-more"><a href="${esc(hrefFor('dungeons'))}">${esc(t('guide.home.group.cta'))}</a></p>
    </section>`;
}

function faqHtml(): string {
  const qa = [
    ['guide.home.faq.q1', t('guide.home.faq.a1')],
    ['guide.home.faq.q2', t('guide.home.faq.a2')],
    ['guide.home.faq.q3', t('guide.home.faq.a3')],
    ['guide.home.faq.q4', t('guide.home.faq.a4', { cap: formatNumber(LEVEL_CAP) })],
  ] as const;
  const items = qa
    .map(([q, a]) => `
      <details class="guide-faq-item">
        <summary>${esc(t(q))}</summary>
        <p>${esc(a)}</p>
      </details>`)
    .join('');
  return `
    <section class="guide-section" aria-labelledby="guide-faq-h">
      <h2 class="guide-section-h" id="guide-faq-h">${esc(t('guide.home.faq.heading'))}</h2>
      <div class="guide-faq">${items}</div>
    </section>`;
}

function communityHtml(): string {
  return `
    <section class="guide-section guide-community" aria-labelledby="guide-community-h">
      <h2 class="guide-section-h" id="guide-community-h">${esc(t('guide.home.community.heading'))}</h2>
      <p class="guide-section-sub">${esc(t('guide.home.community.body'))}</p>
      <div class="guide-community-cta">
        <a class="guide-cta" href="/play">${esc(t('guide.home.community.play'))}</a>
        <a class="guide-cta guide-cta-ghost" href="https://discord.gg/GjhnUsBtw" target="_blank" rel="noopener">${esc(t('guide.home.community.discord'))}</a>
        <a class="guide-cta guide-cta-ghost" href="https://github.com/levy-street/world-of-claudecraft" target="_blank" rel="noopener">${esc(t('guide.home.community.github'))}</a>
      </div>
    </section>`;
}

export const home: GuidePage = {
  titleKey: 'guide.home.title',
  render() {
    return [
      heroHtml(),
      pillarsHtml(),
      classesHtml(),
      worldHtml(),
      groupHtml(),
      faqHtml(),
      communityHtml(),
    ].join('');
  },
};
