// The encyclopedia is a website: the phone apps open it in the browser, so a native build
// drops its static pages, data and pictures from dist/ before Capacitor copies it.
// (The desktop build excludes the same paths in package.json build.files.)
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** dist/ paths that exist only for the web encyclopedia. */
export const WIKI_ONLY_PATHS = [
  'wiki',
  'encyclopedia-data',
  'encyclopedia-stills',
  'encyclopedia-attacks',
  'sitemap-wiki.xml',
];

const dist = resolve(process.argv[2] ?? 'dist');
for (const entry of WIKI_ONLY_PATHS) rmSync(join(dist, entry), { recursive: true, force: true });
console.log(`pruned the web encyclopedia from ${dist}`);
