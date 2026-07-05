// App-level navigation aids that wrap every content page: a breadcrumb trail, a
// previous/next sequence through the sidebar order, and an auto "on this page" table of
// contents with scrollspy. Derived entirely from the route list and the page's own
// headings, so pages stay free of navigation chrome. The TOC is a DOM enhancement the app
// mounts after render and tears down on navigate.

import { t, type TranslationKey } from '../ui/i18n';
import { esc } from '../ui/esc';
import { GUIDE_BASE, hrefFor, groupedRoutes, type GuideRoute, type GuideGroup } from './routes';

const groupLabel = (g: GuideGroup): string => t(`guide.groups.${g}` as TranslationKey);

/** Breadcrumb trail: Guide / Group / Page (and the leaf title on a detail page). */
export function breadcrumbHtml(route: GuideRoute, isDetail: boolean, leafTitle: string): string {
  const crumbs = [`<li><a href="${esc(GUIDE_BASE)}">${esc(t('guide.breadcrumb.home'))}</a></li>`];
  if (route.group) crumbs.push(`<li>${esc(groupLabel(route.group))}</li>`);
  if (isDetail) {
    crumbs.push(`<li><a href="${esc(hrefFor(route.sub))}">${esc(t(route.navKey))}</a></li>`);
    crumbs.push(`<li aria-current="page">${esc(leafTitle)}</li>`);
  } else {
    crumbs.push(`<li aria-current="page">${esc(t(route.navKey))}</li>`);
  }
  return `<nav class="guide-breadcrumb" aria-label="${esc(t('guide.breadcrumb.label'))}"><ol>${crumbs.join('')}</ol></nav>`;
}

// The sidebar groups flattened into one linear reading order for prev/next.
function linearRoutes(): GuideRoute[] {
  return groupedRoutes().flatMap((g) => g.routes);
}

/** Previous/next links through the flattened sidebar order. Empty on a detail page. */
export function sequenceHtml(route: GuideRoute): string {
  const seq = linearRoutes();
  const i = seq.findIndex((r) => r.id === route.id);
  if (i === -1) return '';
  const prev = seq[i - 1];
  const next = seq[i + 1];
  if (!prev && !next) return '';
  const link = (r: GuideRoute | undefined, dir: 'prev' | 'next'): string => r
    ? `<a class="guide-seq-link guide-seq-${dir}" href="${esc(hrefFor(r.sub))}">
        <span class="guide-seq-dir">${esc(t(`guide.seq.${dir}` as TranslationKey))}</span>
        <span class="guide-seq-name">${esc(t(r.navKey))}</span>
      </a>`
    : '<span class="guide-seq-spacer"></span>';
  return `<nav class="guide-seq" aria-label="${esc(t('guide.seq.label'))}">${link(prev, 'prev')}${link(next, 'next')}</nav>`;
}

/**
 * Build an "on this page" table of contents from the article's section headings and wire
 * scrollspy. Only shown when there are enough sections to be worth it. Returns a cleanup
 * that disconnects the observer.
 */
export function mountToc(main: HTMLElement): (() => void) | void {
  const article = main.querySelector('.guide-article');
  if (!article) return;
  const heads = Array.from(article.querySelectorAll<HTMLHeadingElement>(':scope > h2, :scope > section > h2'));
  if (heads.length < 3) return;

  heads.forEach((h, idx) => { if (!h.id) h.id = `sec-${idx + 1}`; });
  const items = heads
    .map((h) => `<li><a href="#${esc(h.id)}" data-toc="${esc(h.id)}">${esc(h.textContent ?? '')}</a></li>`)
    .join('');
  const toc = document.createElement('nav');
  toc.className = 'guide-toc';
  toc.setAttribute('aria-label', t('guide.toc.heading'));
  toc.innerHTML = `<span class="guide-toc-h">${esc(t('guide.toc.heading'))}</span><ul>${items}</ul>`;

  const h1 = article.querySelector(':scope > h1');
  if (h1) h1.insertAdjacentElement('afterend', toc);
  else article.prepend(toc);

  const links = new Map(
    Array.from(toc.querySelectorAll<HTMLAnchorElement>('[data-toc]')).map((a) => [a.dataset.toc ?? '', a]),
  );
  const setActive = (id: string) => {
    links.forEach((a) => a.classList.remove('is-active'));
    links.get(id)?.classList.add('is-active');
  };
  if (typeof IntersectionObserver === 'undefined') return;
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries.filter((e) => e.isIntersecting);
      if (visible.length) setActive((visible[0].target as HTMLElement).id);
    },
    { rootMargin: '-15% 0px -75% 0px' },
  );
  heads.forEach((h) => observer.observe(h));
  return () => observer.disconnect();
}
