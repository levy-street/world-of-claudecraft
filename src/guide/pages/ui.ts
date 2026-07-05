// Small shared building blocks for Guide article pages. Keeps page modules to content
// (which t() keys go where) rather than repeated markup. Catalog copy is passed as a
// TranslationKey (resolved through t()); already-localized or proper-noun strings (spec
// names, ability names, entity names) are passed as raw text to the *Text variants.
// All interpolation goes through esc().

import { t, type TranslationKey } from '../../ui/i18n';
import { esc } from '../../ui/esc';

// ------------------------------------------------------------------ headings
/** A page heading with an optional lead paragraph, both from catalog keys. */
export function pageHeader(titleKey: TranslationKey, leadKey?: TranslationKey): string {
  return `<h1>${esc(t(titleKey))}</h1>` + (leadKey ? lead(leadKey) : '');
}

export function lead(key: TranslationKey): string {
  return `<p class="guide-lead">${esc(t(key))}</p>`;
}
/** Lead paragraph from an already-localized string (e.g. a sim-sourced welcome line). */
export function leadText(text: string): string {
  return `<p class="guide-lead">${esc(text)}</p>`;
}

export function section(headingKey: TranslationKey, bodyHtml: string): string {
  return `<section class="guide-block"><h2>${esc(t(headingKey))}</h2>${bodyHtml}</section>`;
}
/** A block section whose heading is an already-localized string. */
export function sectionText(heading: string, bodyHtml: string): string {
  return `<section class="guide-block"><h2>${esc(heading)}</h2>${bodyHtml}</section>`;
}
/** The common "heading + one body paragraph" section, both from catalog keys. */
export function sectionPair(headingKey: TranslationKey, bodyKey: TranslationKey): string {
  return section(headingKey, p(bodyKey));
}

export function p(key: TranslationKey): string {
  return `<p>${esc(t(key))}</p>`;
}
export function pText(text: string): string {
  return `<p>${esc(text)}</p>`;
}

// An opt-in disclosure (theorycraft, spoilers, walkthroughs) with a neutral label.
export function reveal(summaryKey: TranslationKey, innerHtml: string): string {
  return `<details class="guide-reveal"><summary>${esc(t(summaryKey))}</summary><div class="guide-reveal-body">${innerHtml}</div></details>`;
}

// -------------------------------------------------------------------- images
/** A decorative procedural icon/crest. alt defaults to empty (the label is adjacent). */
export function crestImg(src: string, size: number, cls: string, alt = ''): string {
  return `<img class="${esc(cls)}" src="${esc(src)}" alt="${esc(alt)}" width="${size}" height="${size}" loading="lazy" decoding="async" />`;
}

// ------------------------------------------------------------- badges + tags
/** A pill badge. Pass a fully-qualified class (e.g. "guide-role-tank") for color. */
export function badge(label: string, cls = ''): string {
  return `<span class="guide-badge${cls ? ` ${esc(cls)}` : ''}">${esc(label)}</span>`;
}
/** A qualitative "shape" tag (melee/ranged, solo/group, complexity), label-first. */
export function tag(label: string, cls = ''): string {
  return `<span class="guide-tag${cls ? ` ${esc(cls)}` : ''}">${esc(label)}</span>`;
}
/** Wrap pre-rendered tags/badges in an inline-flex row. */
export function tagRow(inner: string): string {
  return `<div class="guide-tags">${inner}</div>`;
}

// --------------------------------------------------------------------- cards
/** A title + body card from catalog keys (landing-style group card by default). */
export function titleBodyCard(titleKey: TranslationKey, bodyKey: TranslationKey, cls = 'guide-group-card'): string {
  return `<div class="${esc(cls)}"><h3>${esc(t(titleKey))}</h3><p>${esc(t(bodyKey))}</p></div>`;
}

// ------------------------------------------------------------------ callouts
export interface CalloutOptions {
  variant?: 'tip' | 'note' | 'warn';
  titleKey?: TranslationKey;
}
/** A callout box that separates a must-know note from body text. */
export function callout(bodyHtml: string, opts: CalloutOptions = {}): string {
  const variantClass = opts.variant === 'note' ? ' guide-callout-note' : opts.variant === 'warn' ? ' guide-callout-warn' : '';
  const title = opts.titleKey ? `<span class="guide-callout-title">${esc(t(opts.titleKey))}</span>` : '';
  return `<div class="guide-callout${variantClass}">${title}${bodyHtml}</div>`;
}

// --------------------------------------------------------------- lore blocks
/** A pull quote with a speaker line, for hub greetings and in-world voices. The quote
 * body is a catalog key; the speaker (a proper noun) is passed as raw text. */
export function loreQuote(bodyKey: TranslationKey, speaker: string): string {
  return `<figure class="guide-quote">
    <blockquote>${esc(t(bodyKey))}</blockquote>
    <figcaption>${esc(speaker)}</figcaption>
  </figure>`;
}

/** A "who you will meet" character row: a proper-noun name, a role/where line (catalog
 * key), and a one-line description (catalog key). */
export function loreFigure(name: string, roleKey: TranslationKey, bodyKey: TranslationKey): string {
  return `<div class="guide-figure">
    <div class="guide-figure-head">
      <span class="guide-figure-name">${esc(name)}</span>
      <span class="guide-figure-role">${esc(t(roleKey))}</span>
    </div>
    <p class="guide-figure-line">${esc(t(bodyKey))}</p>
  </div>`;
}

/** A single titled "story beat" card, both strings from catalog keys. Used to lay out
 * the villain-ladder saga and quest-type breakdowns as an even row of cards. */
export function loreBeat(titleKey: TranslationKey, bodyKey: TranslationKey): string {
  return `<div class="guide-beat"><h3 class="guide-beat-h">${esc(t(titleKey))}</h3><p>${esc(t(bodyKey))}</p></div>`;
}

// ------------------------------------------------------------- related links
export interface RelatedLink { href: string; key: TranslationKey; }
/** A "Related" block of cross-links at the foot of a page. */
export function related(links: RelatedLink[]): string {
  if (!links.length) return '';
  const items = links
    .map((l) => `<li><a href="${esc(l.href)}">${esc(t(l.key))}</a></li>`)
    .join('');
  return `<nav class="guide-related" aria-label="${esc(t('guide.related'))}">
    <h2 class="guide-related-h">${esc(t('guide.related'))}</h2>
    <ul class="guide-related-list">${items}</ul>
  </nav>`;
}
