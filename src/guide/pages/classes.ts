// Classes: the index (a filterable chooser over all nine, with crests, role badges, and
// the canonical class description) and the rich per-class page (/guide/classes/<id>).
//
// Data sources, all live from the project so nothing drifts:
//  - structure + icons: content.generated.ts (roles, resource, specs, signature kit, full kit)
//  - canonical class description: classDetails.lore.* (the SAME copy as character creation)
//  - armor / weapons: CLASS_DETAILS (the char-select showcase data) + classDetails.* labels
//  - spec + mastery prose, role badges, crests, tags: ../class_view (shared with Talents)
// Spoiler-safe: no balance numbers; ability "what it's for" lines are authored guide keys,
// never the number-laden sim ability descriptions.

import type { PlayerClass } from '../../sim/types';
import { CLASS_DETAILS } from '../../ui/class_details_data';
import { esc } from '../../ui/esc';
import { formatNumber, type TranslationKey, t } from '../../ui/i18n';
import { iconDataUrl } from '../../ui/icons';
import { CLASS_META } from '../class_meta';
import {
  abilityHook,
  classCrest,
  classLore,
  className,
  classTags,
  roleBadges,
  specCardHtml,
} from '../class_view';
import { GUIDE_CLASSES, GUIDE_WARLOCK_PETS, type GuideClassInfo } from '../content.generated';
import { hrefFor } from '../routes';
import { modelViewerEmbed, wireModelViewers } from '../viewer';
import type { GuidePage, PageContext } from './types';
import { badge, crestImg, related } from './ui';

// ---------------------------------------------------------------- index + chooser
const FILTER_GROUPS: {
  group: string;
  labelKey: TranslationKey;
  options: { value: string; labelKey: TranslationKey }[];
}[] = [
  {
    group: 'role',
    labelKey: 'guide.chooser.role',
    options: [
      { value: 'tank', labelKey: 'guide.role.tank' },
      { value: 'healer', labelKey: 'guide.role.healer' },
      { value: 'dps', labelKey: 'guide.role.damage' },
    ],
  },
  {
    group: 'style',
    labelKey: 'guide.chooser.style',
    options: [
      { value: 'melee', labelKey: 'guide.tag.melee' },
      { value: 'ranged', labelKey: 'guide.tag.ranged' },
    ],
  },
  {
    group: 'resource',
    labelKey: 'guide.chooser.resource',
    options: [
      { value: 'rage', labelKey: 'guide.resourceName.rage' },
      { value: 'mana', labelKey: 'guide.resourceName.mana' },
      { value: 'energy', labelKey: 'guide.resourceName.energy' },
    ],
  },
  {
    group: 'complexity',
    labelKey: 'guide.chooser.complexity',
    options: [
      { value: 'low', labelKey: 'guide.tag.simple' },
      { value: 'med', labelKey: 'guide.tag.moderate' },
      { value: 'high', labelKey: 'guide.tag.complex' },
    ],
  },
];

function chip(group: string, value: string, label: string): string {
  return `<button type="button" class="guide-chip" data-group="${esc(group)}" data-value="${esc(value)}" aria-pressed="false">${esc(label)}</button>`;
}

function chooserHtml(): string {
  const groups = FILTER_GROUPS.map(
    (g) => `
    <div class="guide-filter-group" role="group" aria-label="${esc(t(g.labelKey))}">
      <span class="guide-filter-label">${esc(t(g.labelKey))}</span>
      <div class="guide-chips">${g.options.map((o) => chip(g.group, o.value, t(o.labelKey))).join('')}</div>
    </div>`,
  ).join('');
  return `
    <section class="guide-chooser" aria-labelledby="guide-chooser-h">
      <h2 class="guide-chooser-h" id="guide-chooser-h">${esc(t('guide.chooser.heading'))}</h2>
      <p class="guide-chooser-sub">${esc(t('guide.chooser.intro'))}</p>
      <div class="guide-chooser-filters">
        ${groups}
        <div class="guide-filter-group guide-filter-group-toggle">
          <button type="button" class="guide-chip guide-chip-first" data-group="first" data-value="true" aria-pressed="false">${esc(t('guide.chooser.goodFirst'))}</button>
          <button type="button" class="guide-chooser-clear" data-clear>${esc(t('guide.chooser.clear'))}</button>
        </div>
      </div>
      <p class="guide-chooser-count" data-count aria-live="polite"></p>
    </section>`;
}

function classCard(c: GuideClassInfo): string {
  const m = CLASS_META[c.id];
  const data = m
    ? ` data-roles="${esc(c.roles.join(' '))}" data-resource="${esc(c.resource)}" data-style="${esc(m.style)}" data-complexity="${esc(m.complexity)}" data-first="${m.goodFirst}"`
    : ` data-roles="${esc(c.roles.join(' '))}" data-resource="${esc(c.resource)}"`;
  // Show the actual class figure (the pre-rendered character still) as the card image, the
  // same subject the detail page turntable spins; fall back to the procedural class crest only
  // if a still is somehow absent (the guide.test asset guard makes that a build failure). The
  // image is decorative here (alt=""): the whole card is a link the adjacent name span already
  // labels, so a non-empty alt would double the link's accessible name ("Warrior Warrior...").
  const figure = c.still
    ? `<div class="guide-class-card-portrait">
        <img class="guide-class-card-still" src="${esc(c.still)}" alt="" width="88" height="88" loading="lazy" decoding="async" />
      </div>`
    : crestImg(classCrest(c.id, 128), 64, 'guide-class-crest');
  return `
    <a class="guide-class-card" href="${esc(hrefFor(`classes/${c.id}`))}" style="--class-color:${esc(c.color)}"${data}>
      ${figure}
      <span class="guide-class-card-name">${esc(className(c.id))}</span>
      <span class="guide-badges">${roleBadges(c.roles)}</span>
      <span class="guide-class-card-hook">${esc(classLore(c.id))}</span>
    </a>`;
}

function indexHtml(): string {
  const cards = GUIDE_CLASSES.map(classCard).join('');
  return `
    <div class="guide-article guide-classes-index">
      <h1>${esc(t('guide.classList.heading'))}</h1>
      <p class="guide-lead">${esc(t('guide.classList.sub'))}</p>
      ${chooserHtml()}
      <div class="guide-class-cards" data-class-grid>${cards}</div>
      <p class="guide-chooser-none" data-none hidden>${esc(t('guide.chooser.none'))}</p>
    </div>`;
}

// Client-side facet filter over the nine cards. Multi-select OR within a group, AND across
// groups; a "both" class matches either melee or ranged. Pure DOM, cleaned up on navigate.
function mountChooser(root: HTMLElement): (() => void) | undefined {
  const chooser = root.querySelector<HTMLElement>('.guide-chooser');
  const grid = root.querySelector<HTMLElement>('[data-class-grid]');
  if (!chooser || !grid) return;
  const cards = Array.from(grid.querySelectorAll<HTMLElement>('.guide-class-card'));
  const total = cards.length;
  const countEl = chooser.querySelector<HTMLElement>('[data-count]');
  const noneEl = root.querySelector<HTMLElement>('[data-none]');

  const apply = () => {
    const pressed = (group: string) =>
      Array.from(
        chooser.querySelectorAll<HTMLElement>(
          `.guide-chip[data-group="${group}"][aria-pressed="true"]`,
        ),
      ).map((b) => b.dataset.value ?? '');
    const roles = pressed('role');
    const styles = pressed('style');
    const resources = pressed('resource');
    const complexities = pressed('complexity');
    const firstOnly = pressed('first').length > 0;

    let shown = 0;
    for (const card of cards) {
      const cardRoles = (card.dataset.roles ?? '').split(' ');
      const cardStyle = card.dataset.style ?? '';
      const roleOk = roles.length === 0 || roles.some((r) => cardRoles.includes(r));
      const styleOk =
        styles.length === 0 || styles.some((s) => s === cardStyle || cardStyle === 'both');
      const resOk = resources.length === 0 || resources.includes(card.dataset.resource ?? '');
      const cxOk =
        complexities.length === 0 || complexities.includes(card.dataset.complexity ?? '');
      const firstOk = !firstOnly || card.dataset.first === 'true';
      const show = roleOk && styleOk && resOk && cxOk && firstOk;
      card.hidden = !show;
      if (show) shown += 1;
    }
    if (countEl)
      countEl.textContent = t('guide.chooser.results', {
        count: formatNumber(shown),
        total: formatNumber(total),
      });
    if (noneEl) noneEl.hidden = shown !== 0;
  };

  const onClick = (e: Event) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('.guide-chip, [data-clear]');
    if (!target) return;
    if (target.hasAttribute('data-clear')) {
      chooser.querySelectorAll<HTMLElement>('.guide-chip[aria-pressed="true"]').forEach((b) => {
        b.setAttribute('aria-pressed', 'false');
      });
    } else {
      target.setAttribute(
        'aria-pressed',
        target.getAttribute('aria-pressed') === 'true' ? 'false' : 'true',
      );
    }
    apply();
  };
  chooser.addEventListener('click', onClick);
  apply();
  return () => chooser.removeEventListener('click', onClick);
}

// ----------------------------------------------------------------- class detail
function notFoundInline(): string {
  return `<article class="guide-article guide-notfound">
    <h1>${esc(t('guide.notFound.title'))}</h1>
    <p class="guide-lead">${esc(t('guide.notFound.body'))}</p>
    <p><a class="guide-cta" href="${esc(hrefFor('classes'))}">${esc(t('guide.classPage.back'))}</a></p>
  </article>`;
}

function factsHtml(c: GuideClassInfo): string {
  const details = CLASS_DETAILS[c.id as PlayerClass];
  const rows: [TranslationKey, string][] = [
    ['classDetails.labels.resource', t(`guide.resourceName.${c.resource}` as TranslationKey)],
  ];
  if (details) {
    rows.unshift(['classDetails.labels.weapons', t(details.weaponsKey)]);
    rows.unshift(['classDetails.labels.armor', t(details.armorKey)]);
  }
  const cells = rows
    .map(
      ([labelKey, value]) =>
        `<div class="guide-fact"><dt>${esc(t(labelKey))}</dt><dd>${esc(value)}</dd></div>`,
    )
    .join('');
  return `<dl class="guide-class-facts">${cells}</dl>`;
}

function signatureKitHtml(c: GuideClassInfo): string {
  const items = c.signatureAbilities
    .map(
      (a) => `
      <li class="guide-kit-item">
        ${crestImg(iconDataUrl('ability', a.id, 56), 48, 'guide-ability-icon')}
        <div class="guide-kit-text">
          <span class="guide-kit-name">${esc(a.name)}</span>
          <span class="guide-kit-line">${esc(abilityHook(a.id))}</span>
        </div>
      </li>`,
    )
    .join('');
  return `
    <section class="guide-block">
      <h2>${esc(t('guide.classPage.abilitiesHeading'))}</h2>
      <p>${esc(t('guide.classPage.abilitiesNote'))}</p>
      <ul class="guide-kit">${items}</ul>
    </section>`;
}

function specsHtml(c: GuideClassInfo): string {
  const items = c.specs.map((sp) => specCardHtml(c.id, sp)).join('');
  return `
    <section class="guide-block">
      <h2>${esc(t('guide.classPage.specsHeading'))}</h2>
      <ul class="guide-spec-list">${items}</ul>
    </section>`;
}

function fullKitHtml(c: GuideClassInfo): string {
  const items = c.abilities
    .map(
      (a) => `
      <li class="guide-ability">
        ${crestImg(iconDataUrl('ability', a.id, 56), 48, 'guide-ability-icon')}
        <span class="guide-ability-name">${esc(a.name)}</span>
      </li>`,
    )
    .join('');
  return `
    <section class="guide-block">
      <h2>${esc(t('guide.classPage.fullKitHeading'))}</h2>
      <p>${esc(t('guide.classPage.fullKitNote'))}</p>
      <ul class="guide-ability-strip">${items}</ul>
    </section>`;
}

function warlockPetsHtml(): string {
  const items = GUIDE_WARLOCK_PETS.map(
    (pet) => `
      <li class="guide-pet">
        ${modelViewerEmbed({ modelKey: pet.model, tint: pet.tint, name: pet.name, still: pet.still })}
        <span class="guide-pet-name">${esc(pet.name)}</span>
        <span class="guide-pet-line">${esc(t(`guide.petHook.${pet.id}` as TranslationKey))}</span>
      </li>`,
  ).join('');
  return `
    <section class="guide-block">
      <h2>${esc(t('guide.classPage.petsHeading'))}</h2>
      <p>${esc(t('guide.classPage.petsNote'))}</p>
      <ul class="guide-pet-list">${items}</ul>
    </section>`;
}

function detailHtml(id: string): string {
  const c = GUIDE_CLASSES.find((x) => x.id === id);
  if (!c) return notFoundInline();
  return `
    <article class="guide-article guide-class-page" style="--class-color:${esc(c.color)}">
      <p class="guide-section-more"><a href="${esc(hrefFor('classes'))}">${esc(t('guide.classPage.back'))}</a></p>
      <header class="guide-class-hero">
        <div class="guide-class-portrait">
          ${modelViewerEmbed({ modelKey: c.model, tint: c.tint, name: className(c.id), still: c.still, poster: classCrest(c.id, 192), posterSize: 160, variant: 'feature', autoplay: true })}
        </div>
        <div class="guide-class-hero-text">
          <h1 class="guide-class-hero-name">${esc(className(c.id))}</h1>
          <div class="guide-badges">
            ${roleBadges(c.roles)}
            ${badge(t(`guide.resourceName.${c.resource}` as TranslationKey), 'guide-badge-resource')}
          </div>
          ${classTags(c.id)}
        </div>
      </header>
      <p class="guide-lead">${esc(classLore(c.id))}</p>
      ${factsHtml(c)}
      ${signatureKitHtml(c)}
      ${specsHtml(c)}
      ${c.id === 'warlock' ? warlockPetsHtml() : ''}
      ${fullKitHtml(c)}
      ${related([
        { href: hrefFor('reference/talents'), key: 'guide.nav.talents' },
        { href: hrefFor('how-to-play'), key: 'guide.nav.howToPlay' },
        { href: hrefFor('reference/combat'), key: 'guide.nav.combat' },
      ])}
    </article>`;
}

export const classes: GuidePage = {
  titleKey: 'guide.nav.classes',
  titleFor(ctx: PageContext) {
    const id = ctx.params[0];
    return id && GUIDE_CLASSES.some((c) => c.id === id)
      ? className(id)
      : t('guide.classList.heading');
  },
  render(ctx: PageContext) {
    const id = ctx.params[0];
    return id ? detailHtml(id) : indexHtml();
  },
  mount(root: HTMLElement, ctx: PageContext) {
    if (ctx.params[0]) return wireModelViewers(root); // class portrait + warlock demons
    return mountChooser(root);
  },
};
