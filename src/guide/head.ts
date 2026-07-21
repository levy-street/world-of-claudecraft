// Per-route head management for the Guide SPA: the single place that keeps the
// document title, meta description, canonical, OpenGraph/Twitter tags, the 14 hreflang
// alternates, and the JSON-LD structured-data block in sync on every navigation and
// language switch. Mirrors the homepage SEO pattern (index.html + main.ts
// updateSeoMetadata) so the guide's ~30 crawlable routes each get unique, localized,
// canonical metadata instead of all collapsing onto /guide.
//
// All writes are idempotent: each tag is queried (or created once) and updated in place,
// so re-running on a language switch never duplicates a node. Pure-ish: it only touches
// document.head and reads the route + the i18n runtime; no app state.

import {
  formatNumber,
  getLanguage,
  languageTag,
  supportedLanguages,
  type TranslationKey,
  t,
} from '../ui/i18n';
import { GUIDE_CLASSES } from './content.generated';
import { LEVEL_CAP } from './data';
import { GLOSSARY_TERMS } from './pages/glossary';
import { type GuideRoute, hrefFor } from './routes';

// The site origin. Matches index.html's canonical/og:url host exactly.
const ORIGIN = 'https://worldofclaudecraft.com';
const LOGO = `${ORIGIN}/woc_logo_square.webp`;
const GITHUB_URL = 'https://github.com/levy-street/world-of-claudecraft';
const DISCORD_URL = 'https://discord.com/invite/worldofclaudecraft';

// The newcomer FAQ on /guide/faq, kept in lockstep with pages/faq.ts so the FAQPage
// JSON-LD answers the same questions the visible page does. cap rows splice the level
// cap, exactly like the page (the cap value is resolved by the caller via the same key).
const FAQ_QA: { q: TranslationKey; a: TranslationKey; cap?: boolean }[] = [
  { q: 'guide.faqPage.q1', a: 'guide.faqPage.a1' },
  { q: 'guide.faqPage.q2', a: 'guide.faqPage.a2' },
  { q: 'guide.faqPage.q3', a: 'guide.faqPage.a3' },
  { q: 'guide.faqPage.q4', a: 'guide.faqPage.a4' },
  { q: 'guide.faqPage.q5', a: 'guide.faqPage.a5' },
  { q: 'guide.faqPage.q6', a: 'guide.faqPage.a6', cap: true },
  { q: 'guide.faqPage.q7', a: 'guide.faqPage.a7' },
  { q: 'guide.faqPage.q8', a: 'guide.faqPage.a8' },
  { q: 'guide.faqPage.q9', a: 'guide.faqPage.a9' },
  { q: 'guide.faqPage.q10', a: 'guide.faqPage.a10', cap: true },
  { q: 'guide.faqPage.q11', a: 'guide.faqPage.a11' },
];

// Class name + lore, resolved through the same i18n keys the class pages use. Inlined
// (one-line t() calls) so the head module does not pull in the icon-canvas machinery
// that class_view.ts carries.
const className = (id: string): string => t(`classes.${id}` as TranslationKey);
const classLore = (id: string): string => t(`classDetails.lore.${id}` as TranslationKey);

/** Absolute URL for a guide route path (the part after GUIDE_BASE, '' for home). */
function guideUrl(sub: string): string {
  return ORIGIN + hrefFor(sub);
}

/**
 * The 14 hreflang alternate hrefs for a guide route path, mirroring index.html's set:
 * en at /guide<path>, the 13 others at /guide<path>?lang=<locale>, plus x-default -> en.
 * `sub` is the route sub-path ('' for home), e.g. 'classes/warrior'.
 */
function guideAlternates(sub: string): { hreflang: string; href: string }[] {
  const base = guideUrl(sub);
  const out: { hreflang: string; href: string }[] = [];
  for (const lang of supportedLanguages) {
    const tag = languageTag(lang);
    if (lang === 'en') {
      out.push({ hreflang: tag, href: base });
    } else {
      out.push({ hreflang: tag, href: `${base}?lang=${lang}` });
    }
  }
  out.push({ hreflang: 'x-default', href: base });
  return out;
}

interface RouteHeadInput {
  /** The matched route, or null for the not-found page. */
  route: GuideRoute | null;
  /** Route sub-path after GUIDE_BASE ('' for home), including detail params. */
  sub: string;
  /** The fully computed document title (page - brand, or the brand on home). */
  title: string;
  /** The detail param (e.g. a class id) when on a detail page, else null. */
  detailId: string | null;
}

/** Resolve a route's meta description from its descKey, or '' when none. */
function descriptionForRoute(route: GuideRoute | null, detailId: string | null): string {
  if (!route) return t('guide.notFound.body');
  // Class detail pages: build from the class name + its lore (the character-creation copy).
  if (route.id === 'classes' && detailId && GUIDE_CLASSES.some((c) => c.id === detailId)) {
    return `${className(detailId)}: ${classLore(detailId)}`;
  }
  return route.descKey ? t(route.descKey) : t('guide.tagline');
}

/**
 * Apply all per-route head metadata. Called from the app on every navigation and after a
 * language switch. Idempotent and self-contained: safe to call repeatedly.
 */
export function applyRouteHead(input: RouteHeadInput): void {
  const { route, sub, title, detailId } = input;
  const lang = getLanguage();
  const inLanguage = languageTag(lang);
  // Only the classes route has real detail pages. A trailing param on any other route (or
  // an unknown class id) is a junk deep path, so canonicalize it back to the section rather
  // than self-canonicalizing onto the junk URL, and drop the junk breadcrumb leaf.
  const isClassDetail =
    route?.id === 'classes' && detailId != null && GUIDE_CLASSES.some((c) => c.id === detailId);
  const effectiveDetailId = isClassDetail ? detailId : null;
  const canonSub = route ? (isClassDetail ? `${route.sub}/${detailId}` : route.sub) : sub;
  const url = guideUrl(canonSub);
  const description = descriptionForRoute(route, effectiveDetailId);
  // og:/twitter: titles use the page title without the " - brand" suffix when we can,
  // but the full document title is a safe, descriptive social title, so reuse it.
  const socialTitle = title;

  document.title = title;
  setMetaName('description', description);
  setCanonical(url);
  setMetaProperty('og:url', url);
  setMetaProperty('og:title', socialTitle);
  setMetaProperty('og:description', description);
  setMetaName('twitter:title', socialTitle);
  setMetaName('twitter:description', description);
  applyAlternates(canonSub);
  setStructuredData(
    buildStructuredData(route, canonSub, url, description, inLanguage, effectiveDetailId),
  );
}

// ----- head node helpers (query-or-create, then update in place) -----

function setCanonical(href: string): void {
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'canonical';
    document.head.appendChild(link);
  }
  link.href = href;
}

function setMetaName(name: string, content: string): void {
  let meta = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', name);
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', content);
}

function setMetaProperty(property: string, content: string): void {
  let meta = document.head.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('property', property);
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', content);
}

// Refresh every hreflang alternate to the current route. We tag the runtime-managed
// links with data-guide-alt so we can clear and rewrite exactly our own set, never
// touching the static first-paint alternates' identity (we replace them wholesale).
function applyAlternates(sub: string): void {
  for (const stale of document.head.querySelectorAll('link[rel="alternate"][hreflang]')) {
    stale.remove();
  }
  const canonical = document.head.querySelector('link[rel="canonical"]');
  for (const { hreflang, href } of guideAlternates(sub)) {
    const link = document.createElement('link');
    link.rel = 'alternate';
    link.hreflang = hreflang;
    link.href = href;
    if (canonical) document.head.insertBefore(link, canonical);
    else document.head.appendChild(link);
  }
}

function setStructuredData(data: unknown): void {
  let script = document.getElementById('guide-structured-data') as HTMLScriptElement | null;
  if (!script) {
    script = document.createElement('script');
    script.id = 'guide-structured-data';
    script.type = 'application/ld+json';
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(data, null, 2);
}

// ----- JSON-LD builders (values via t() so they localize) -----

// The WebSite node with a guide search action: the sitewide discovery primitive, on
// every page so a crawler always sees the searchable site.
function webSiteNode(inLanguage: string): Record<string, unknown> {
  return {
    '@type': 'WebSite',
    name: t('guide.brand'),
    url: guideUrl(''),
    inLanguage,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${guideUrl('')}?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

// The VideoGame node (home), mirroring index.html's block, plus a sameAs trail and the
// /play url so answer engines can route players straight into the game.
function videoGameNode(description: string, inLanguage: string): Record<string, unknown> {
  return {
    '@type': 'VideoGame',
    name: t('guide.brand'),
    alternateName: 'World of Claudecraft',
    genre: t('seo.genre'),
    playMode: t('seo.playMode'),
    applicationCategory: t('seo.applicationCategory'),
    operatingSystem: t('seo.operatingSystem'),
    url: `${ORIGIN}/play`,
    image: LOGO,
    description,
    inLanguage,
    sameAs: [GITHUB_URL, DISCORD_URL],
  };
}

// The visible breadcrumb is Guide / Group / Page (+ leaf on a detail page). The group has
// no page of its own, so it is a name-only list item; the rest carry their absolute URL.
function breadcrumbNode(
  route: GuideRoute,
  sub: string,
  detailId: string | null,
): Record<string, unknown> {
  const items: Record<string, unknown>[] = [];
  let position = 1;
  items.push(crumb(position++, t('guide.breadcrumb.home'), guideUrl('')));
  if (route.group) {
    items.push(crumb(position++, t(`guide.groups.${route.group}` as TranslationKey), null));
  }
  const isDetail = detailId != null;
  // The section page (e.g. Classes) always gets a crumb; on a detail page it links back
  // to the section and the leaf is the detail title.
  items.push(crumb(position++, t(route.navKey), guideUrl(route.sub)));
  if (isDetail) {
    const leaf =
      route.id === 'classes' && GUIDE_CLASSES.some((c) => c.id === detailId)
        ? className(detailId)
        : detailId;
    items.push(crumb(position++, leaf, guideUrl(sub)));
  }
  return { '@type': 'BreadcrumbList', itemListElement: items };
}

function crumb(position: number, name: string, item: string | null): Record<string, unknown> {
  const node: Record<string, unknown> = { '@type': 'ListItem', position, name };
  if (item) node.item = item;
  return node;
}

// FAQPage from the existing q/a keys: the top generative-engine win, so an AI answer
// engine can lift the questions and answers verbatim.
function faqNode(): Record<string, unknown> {
  const cap = formatNumber(LEVEL_CAP);
  return {
    '@type': 'FAQPage',
    mainEntity: FAQ_QA.map(({ q, a, cap: hasCap }) => ({
      '@type': 'Question',
      name: t(q),
      acceptedAnswer: {
        '@type': 'Answer',
        text: hasCap ? t(a, { cap }) : t(a),
      },
    })),
  };
}

// DefinedTermSet of the glossary, each term @id'd to its #term-<slug> anchor on the page.
function glossaryNode(url: string, inLanguage: string): Record<string, unknown> {
  return {
    '@type': 'DefinedTermSet',
    name: t('guide.nav.glossary'),
    url,
    inLanguage,
    hasDefinedTerm: GLOSSARY_TERMS.map(({ slug, term, def }) => ({
      '@type': 'DefinedTerm',
      '@id': `${url}#term-${slug}`,
      name: t(term),
      description: t(def),
    })),
  };
}

function buildStructuredData(
  route: GuideRoute | null,
  sub: string,
  url: string,
  description: string,
  inLanguage: string,
  detailId: string | null,
): unknown {
  const graph: Record<string, unknown>[] = [webSiteNode(inLanguage)];
  if (route) {
    if (route.id === 'home') {
      graph.push(videoGameNode(description, inLanguage));
    } else {
      graph.push(breadcrumbNode(route, sub, detailId));
    }
    if (route.id === 'faq') graph.push(faqNode());
    if (route.id === 'glossary') graph.push(glossaryNode(url, inLanguage));
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}
