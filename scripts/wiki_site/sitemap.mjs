// The encyclopedia's own sitemap (sitemap-wiki.xml), listed in robots.txt beside the
// main sitemap. The Guide's /wiki routes stay in sitemap.xml (scripts/build_sitemap.mjs).
import { absolute } from './head.mjs';

/** The sitemap protocol's per-file URL limit. */
export const SITEMAP_URL_LIMIT = 50000;

const escapeXml = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch],
  );

/** A urlset for the given site paths, sorted so the file is stable between builds. */
export function sitemapXml(paths) {
  const unique = [...new Set(paths)].sort();
  if (unique.length > SITEMAP_URL_LIMIT)
    throw new Error(
      `sitemap-wiki.xml would list ${unique.length} URLs, over the ${SITEMAP_URL_LIMIT} limit`,
    );
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    unique.map((path) => `  <url><loc>${escapeXml(absolute(path))}</loc></url>\n`).join('') +
    '</urlset>\n'
  );
}
