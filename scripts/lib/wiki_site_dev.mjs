// Path logic for serving the static encyclopedia from Vite (vite.config.ts
// wikiSitePlugin). `vite dev` serves the dev build in .wiki-site/ (written by
// scripts/wiki_site/build.mjs); `vite preview` serves the production build in dist/.
// Kept pure (the existence check is injected) so it is unit tested without a server.

/** The dev build's folder, relative to the project root. */
export const WIKI_DEV_DIR = '.wiki-site';

/**
 * The file a request maps to, as a path relative to the served root, or null to leave
 * the request alone. `exists(rel)` reports whether that relative file exists.
 *   /wiki/<path>         -> wiki/<path>/index.html (when it exists)
 *   /encyclopedia-data/x -> encyclopedia-data/x
 *   /sitemap-wiki.xml    -> sitemap-wiki.xml
 */
export function wikiSiteFile(pathname, exists) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('..') || decoded.includes('\\') || decoded.includes('\0')) return null;
  if (decoded === '/sitemap-wiki.xml')
    return exists('sitemap-wiki.xml') ? 'sitemap-wiki.xml' : null;
  if (decoded.startsWith('/encyclopedia-data/')) {
    const rel = decoded.slice(1);
    return exists(rel) ? rel : null;
  }
  if (!decoded.startsWith('/wiki/')) return null;
  const slashless = decoded.replace(/\/+$/, '');
  const last = slashless.slice(slashless.lastIndexOf('/') + 1);
  if (last.includes('.')) return null;
  const rel = `${slashless.slice(1)}/index.html`;
  return exists(rel) ? rel : null;
}
