// Turns a rendered reader view into static-site markup. The reader addresses articles
// as #Title (and sections as #Title#slug); the static site gives each its own path, so
// every in-wiki link is rewritten to that path. A link to a title with no page becomes
// plain text and is reported, so a static page never ships a dead link.

/** The article (and section) a reader hash link points at, or null for a plain anchor. */
export function hashTarget(hash) {
  if (!hash.startsWith('#')) return null;
  const split = hash.indexOf('#', 1);
  try {
    const title = decodeURIComponent(hash.slice(1, split < 0 ? undefined : split));
    const section = split < 0 ? '' : decodeURIComponent(hash.slice(split + 1));
    return title ? { title, section } : null;
  } catch {
    return null;
  }
}

/**
 * The static href for a reader hash link, or undefined when it names no page. `current`
 * is the title of the page the link sits on, so a section link stays in-page.
 */
export function staticHref(hash, paths, current) {
  const target = hashTarget(hash);
  if (!target) return hash;
  const anchor = target.section ? '#section-' + target.section : '';
  if (target.title === current && anchor) return anchor;
  const path = paths.get(target.title);
  return path ? path + anchor : undefined;
}

/**
 * Rewrites every link and picture under `root` in place. Returns the titles of links
 * that named no page. `artUrl` maps a game art path to the URL to load it from.
 */
export function rewriteView(root, { paths, current, artUrl = (path) => path, title }) {
  const doc = root.ownerDocument;
  const broken = [];
  for (const a of root.querySelectorAll('a[href^="#"]')) {
    const raw = a.getAttribute('href');
    // An in-page jump (the directory "On this page" list) targets its heading id.
    if (a.dataset.part) {
      a.setAttribute('href', '#' + a.dataset.part);
      delete a.dataset.part;
      continue;
    }
    // A plain fragment for an element on this page (the skip link, a heading) stays.
    if (doc.getElementById(raw.slice(1)) || /^#(?:part|section)-/.test(raw)) continue;
    const next = staticHref(raw, paths, current);
    if (next !== undefined) {
      a.setAttribute('href', next);
      continue;
    }
    broken.push(hashTarget(raw)?.title ?? raw);
    const span = doc.createElement('span');
    span.className = a.className;
    span.append(...a.childNodes);
    a.replaceWith(span);
  }
  for (const img of root.querySelectorAll('img[data-game-art]')) {
    img.setAttribute('src', artUrl(img.dataset.gameArt));
    delete img.dataset.gameArt;
    // The page's own picture is described by the page; small icons stay decorative.
    if (img.matches('.article-art')) {
      if (title && !img.getAttribute('alt')) img.setAttribute('alt', title);
      // It is the first thing on screen, so it loads at once rather than lazily.
      img.removeAttribute('loading');
      img.setAttribute('fetchpriority', 'high');
    }
  }
  return broken;
}
