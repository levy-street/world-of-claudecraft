// The encyclopedia pages' script (encyclopedia.html is only the bundling entry; the build
// writes one static page per article from it, see scripts/wiki_site/build.mjs).
import { mountCompanion } from './companion.js';
import { enhanceWikiPage } from './wiki_page.js';

mountCompanion();
enhanceWikiPage();
