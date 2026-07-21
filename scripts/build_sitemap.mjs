// Regenerates the /guide URL block of public/sitemap.xml from the Guide's route table
// (src/guide/routes.ts) and the nine class pages (src/guide/content.generated.ts), so the
// sitemap never drifts from the actual crawlable routes. Mirrors the esbuild-bundle
// pattern in scripts/wiki/build_content.mjs (never import raw .ts): routes.ts pulls a
// type-only import from ui/i18n, which esbuild erases, so the bundle is data-only.
//
// It REPLACES only the <url> entries whose <loc> contains "/guide", preserving every
// other entry (home, play, links, merch, legal pages) byte-for-byte. Deterministic:
// reads the route data + the existing sitemap, writes the file. Run via
// `node scripts/build_sitemap.mjs`; wired into `npm run build`.
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sitemapPath = path.join(root, 'public', 'sitemap.xml');
const ORIGIN = 'https://worldofclaudecraft.com';

const entrySource = `
  export { GUIDE_ROUTES, hrefFor } from './src/guide/routes.ts';
  export { GUIDE_CLASSES } from './src/guide/content.generated.ts';
`;

const built = await esbuild.build({
  stdin: { contents: entrySource, resolveDir: root, sourcefile: 'sitemap-entry.ts', loader: 'ts' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
});
const dataUrl = `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`;
const { GUIDE_ROUTES, hrefFor, GUIDE_CLASSES } = await import(dataUrl);

// Per-route crawl hints. The overview lands a notch above the section pages; class detail
// pages sit just below their index. Anything unlisted falls back to the section default.
const PRIORITY = { home: '0.7', section: '0.6', detail: '0.55' };
const CHANGEFREQ = { home: 'weekly', section: 'monthly', detail: 'monthly' };

function urlEntry(loc, changefreq, priority) {
  return [
    '  <url>',
    `    <loc>${loc}</loc>`,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    '  </url>',
  ].join('\n');
}

// Build the fresh guide block: every static route plus the nine /guide/classes/<id> pages.
const guideEntries = [];
for (const route of GUIDE_ROUTES) {
  const loc = ORIGIN + hrefFor(route.sub);
  const tier = route.id === 'home' ? 'home' : 'section';
  guideEntries.push(urlEntry(loc, CHANGEFREQ[tier], PRIORITY[tier]));
  // Class detail pages hang off the classes index.
  if (route.id === 'classes') {
    for (const c of GUIDE_CLASSES) {
      const detailLoc = ORIGIN + hrefFor(`classes/${c.id}`);
      guideEntries.push(urlEntry(detailLoc, CHANGEFREQ.detail, PRIORITY.detail));
    }
  }
}

// Read the existing sitemap and split its <url> blocks, keeping every non-guide entry
// exactly as-is. A guide entry is any <url> whose <loc> path is the guide base or a deep
// path under it. The guide now serves at /wiki; legacy /guide locs are matched too so a
// one-time regeneration replaces them cleanly (and re-runs stay idempotent).
const xml = readFileSync(sitemapPath, 'utf8');
const eol = xml.includes('\r\n') ? '\r\n' : '\n';
const normalized = xml.replace(/\r\n/g, '\n');

const blockRe = /[ \t]*<url>[\s\S]*?<\/url>/g;
const blocks = normalized.match(blockRe) ?? [];
const isGuideBlock = (block) => {
  const m = block.match(/<loc>\s*([^<]*?)\s*<\/loc>/);
  if (!m) return false;
  let pathPart;
  try {
    pathPart = new URL(m[1]).pathname;
  } catch {
    pathPart = m[1];
  }
  return (
    pathPart === '/wiki' || pathPart.startsWith('/wiki/') ||
    pathPart === '/guide' || pathPart.startsWith('/guide/')
  );
};

const nonGuide = blocks.filter((b) => !isGuideBlock(b));
// Place the regenerated guide block where the first guide entry used to be, so the file's
// ordering stays stable (home/links/merch/play, then guide, then legal pages).
const firstGuideIndex = blocks.findIndex(isGuideBlock);
const before = firstGuideIndex === -1 ? blocks : blocks.slice(0, firstGuideIndex).filter((b) => !isGuideBlock(b));
const after = firstGuideIndex === -1 ? [] : blocks.slice(firstGuideIndex).filter((b) => !isGuideBlock(b));
const merged = firstGuideIndex === -1
  ? [...nonGuide, ...guideEntries]
  : [...before, ...guideEntries, ...after];

const out = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...merged,
  '</urlset>',
  '',
].join('\n');

writeFileSync(sitemapPath, eol === '\r\n' ? out.replace(/\n/g, '\r\n') : out);

const guideCount = guideEntries.length;
const totalCount = merged.length;
console.log(`build_sitemap: wrote ${totalCount} urls (${guideCount} guide, ${nonGuide.length} preserved) to public/sitemap.xml`);
