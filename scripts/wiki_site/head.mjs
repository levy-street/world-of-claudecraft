// The <head> of one static encyclopedia page: a unique title and description, the
// canonical address, social cards and schema.org data. Pure string building, so the
// SEO contract is unit tested without a browser.
import { HOME_PATH, SITE_ORIGIN } from './paths.mjs';

export const SITE_NAME = 'World of ClaudeCraft Wiki';
const DEFAULT_IMAGE = '/website-hero-eastbrook-v1.webp';
const DESCRIPTION_LIMIT = 155;

const escapeAttr = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );
// JSON inside a script element: no sequence that could close the element early.
const scriptJson = (data) => JSON.stringify(data).replace(/</g, '\\u003c');

/** Collapses whitespace and trims to a search-snippet length at a word boundary. */
export function clipDescription(text, limit = DESCRIPTION_LIMIT) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit - 3);
  const space = cut.lastIndexOf(' ');
  return (space > limit * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '') + '...';
}

/**
 * A page's description: its opening paragraph when it has a real one, otherwise a
 * sentence built from its title and what kind of page it is.
 */
export function describePage({ title, lead, kind }) {
  const opening = clipDescription(lead ?? '');
  if (opening.length >= 50) return opening;
  const what = kind ? kind.toLowerCase() : 'reference page';
  return clipDescription(
    `${title}: ${what} in World of ClaudeCraft. ${opening ? opening + ' ' : ''}Sources, stats and related pages in the player encyclopedia.`,
  );
}

/** The document title: the page name, then the site. */
export function documentTitle(title) {
  return `${title} | ${SITE_NAME}`;
}

/** Absolute URL for a site path. */
export const absolute = (path) => SITE_ORIGIN + path;

/**
 * The head tags for a page. `crumbs` is the trail of { name, path } above the page,
 * starting at the encyclopedia home; `image` a site path for the page's picture.
 */
export function headMarkup({ title, description, path, image, crumbs = [], article = true }) {
  const url = absolute(path);
  const picture = absolute(image || DEFAULT_IMAGE);
  const trail = [...crumbs, { name: title, path }];
  const graph = [
    {
      '@type': article ? 'Article' : 'CollectionPage',
      '@id': url + '#page',
      headline: title,
      name: title,
      description,
      url,
      image: picture,
      inLanguage: 'en',
      isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: absolute(HOME_PATH) },
      about: { '@type': 'VideoGame', name: 'World of ClaudeCraft', url: SITE_ORIGIN + '/' },
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: trail.map((crumb, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: crumb.name,
        item: absolute(crumb.path),
      })),
    },
  ];
  return [
    `<title>${escapeAttr(documentTitle(title))}</title>`,
    `<meta name="description" content="${escapeAttr(description)}">`,
    `<link rel="canonical" href="${escapeAttr(url)}">`,
    `<meta name="robots" content="index, follow, max-image-preview:large">`,
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:type" content="${article ? 'article' : 'website'}">`,
    `<meta property="og:title" content="${escapeAttr(title)}">`,
    `<meta property="og:description" content="${escapeAttr(description)}">`,
    `<meta property="og:url" content="${escapeAttr(url)}">`,
    `<meta property="og:image" content="${escapeAttr(picture)}">`,
    `<meta property="og:locale" content="en_US">`,
    `<meta name="twitter:card" content="${image ? 'summary' : 'summary_large_image'}">`,
    `<meta name="twitter:title" content="${escapeAttr(title)}">`,
    `<meta name="twitter:description" content="${escapeAttr(description)}">`,
    `<meta name="twitter:image" content="${escapeAttr(picture)}">`,
    `<script type="application/ld+json">${scriptJson({ '@context': 'https://schema.org', '@graph': graph })}</script>`,
  ].join('\n  ');
}
