// Builds the static encyclopedia: one crawlable HTML page per article under /wiki, plus
// its search index, hover cards, sitemap and redirect table. The article markup comes
// from the same renderer the in-browser reader uses (mediawiki/reader/page_render.js),
// run once per page in a server-side DOM, so the static page and the reader agree.
//
//   node scripts/wiki_site/build.mjs [--generate] [--seed pages.xml] [--out dir]
//                                    [--template encyclopedia.html] [--update-registry]
//
// --generate   regenerate the seed from the game data first (what every deploy does).
// --template   the HTML shell; the production build passes vite's dist/encyclopedia.html
//              so the pages load the hashed bundle. Defaults to the source shell (dev).
// --update-registry  pin new page addresses in mediawiki/site_paths.json and move pages
//              that no longer exist to its redirects (as gone, until given a target).
// --consume-template  delete the template afterwards (the built shell has no article, so
//              it must not be served as a page of its own).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { describePage, headMarkup } from './head.mjs';
import { rewriteView, staticHref } from './links.mjs';
import { assignPaths, fileForPath, HOME_PATH, registryDrift, SITE_ORIGIN } from './paths.mjs';
import { pageKind, readSeed } from './seed.mjs';
import { sitemapXml } from './sitemap.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const REGISTRY_FILE = join(ROOT, 'mediawiki/site_paths.json');

function argValue(args, name) {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

export function readRegistry(file = REGISTRY_FILE) {
  if (!existsSync(file)) return { pages: {}, redirects: {} };
  const data = JSON.parse(readFileSync(file, 'utf8'));
  return { pages: data.pages ?? {}, redirects: data.redirects ?? {} };
}

/** Regenerates the seed from the current game data into a temporary folder. */
function generateSeed() {
  const dir = mkdtempSync(join(tmpdir(), 'woc-wiki-seed-'));
  const out = join(dir, 'pages.xml');
  execFileSync(process.execPath, [join(ROOT, 'scripts/mediawiki/build_seed.mjs')], {
    env: { ...process.env, MEDIAWIKI_SEED_OUT: out },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  return out;
}

/** Installs a server-side DOM as the globals the reader modules expect. */
function installDom() {
  const window = new Window({
    url: SITE_ORIGIN + HOME_PATH,
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableIframePageLoading: true,
    },
  });
  for (const name of ['document', 'DOMParser', 'Node', 'Element', 'HTMLElement', 'NodeFilter'])
    globalThis[name] = window[name];
  globalThis.window = window;
  return window;
}

const shortHash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 10);

/**
 * The page shell around the article: the source or built encyclopedia.html with its
 * title and description lifted out (each page writes its own) and relative asset
 * paths made absolute, since pages live at nested paths.
 */
export function shellTemplate(html, paths) {
  let shell = html
    .replace(/<title>[\s\S]*?<\/title>\s*/, '')
    .replace(/<meta name="description"[^>]*>\s*/, '')
    .replace(/(href|src)="\.\//g, '$1="/')
    .replace(/<main id="view"[^>]*>[\s\S]*?<\/main>/, '%%VIEW%%')
    .replace(/(<nav aria-label="Browse articles" id="navigation">)<\/nav>/, '$1%%NAV%%</nav>')
    .replace('</head>', '  %%HEAD%%\n</head>')
    .replace(/<body([^>]*)>/, '<body$1 %%BODY%%>');
  // Header and footer links use reader hashes too.
  shell = shell.replace(/href="(#[^"]+)"/g, (whole, hash) => {
    if (hash === '#view') return whole;
    const next = staticHref(hash, paths, '');
    return next ? `href="${next}"` : whole;
  });
  for (const mark of ['%%VIEW%%', '%%NAV%%', '%%HEAD%%', '%%BODY%%'])
    if (!shell.includes(mark)) throw new Error(`encyclopedia shell is missing its ${mark} slot`);
  return shell;
}

/** Fills the shell for one page. */
function pageDocument(shell, { head, nav, view, body }) {
  return shell
    .replace('%%HEAD%%', () => head)
    .replace('%%NAV%%', () => nav)
    .replace('%%VIEW%%', () => view)
    .replace('%%BODY%%', () => body);
}

export async function buildSite({
  seedFile,
  outDir,
  templateFile = join(ROOT, 'encyclopedia.html'),
  registry = readRegistry(),
  log = console.log,
} = {}) {
  const started = Date.now();
  let window = installDom();
  const {
    buildSite: siteFor,
    mainPageMarkup,
    navMarkup,
    renderArticle,
    pageParents,
  } = await import('../../mediawiki/reader/page_render.js');
  const { displayTitle } = await import('../../mediawiki/reader/browse.js');
  const { pages, tooltips } = readSeed(seedFile);
  const site = siteFor(pages);
  const { paths } = assignPaths(pages, registry);
  const pathOf = (title) => paths.get(title);

  // Data files the pages fetch on demand, content-hashed so they cache forever.
  const searchRows = site.all
    .filter((page) => page.title !== 'Main Page')
    .map((page) => [
      displayTitle(page.title),
      pathOf(page.title),
      page.art || '',
      page.categories[0] || '',
    ]);
  const searchJson = JSON.stringify(searchRows);
  const cards = {};
  for (const [title, card] of Object.entries(tooltips))
    if (paths.has(title)) cards[pathOf(title)] = card;
  const cardsJson = JSON.stringify(cards);
  const searchUrl = `/encyclopedia-data/search.${shortHash(searchJson)}.json`;
  const cardsUrl = `/encyclopedia-data/cards.${shortHash(cardsJson)}.json`;
  const redirects = {};
  for (const [from, title] of Object.entries(registry.redirects))
    redirects[from] = title === null ? null : (pathOf(title) ?? null);

  const shell = shellTemplate(readFileSync(templateFile, 'utf8'), paths);
  const navEl = window.document.createElement('nav');
  navEl.innerHTML = navMarkup(site, true);
  rewriteView(navEl, { paths, current: '' });
  const navHtml = navEl.innerHTML;
  const body = `data-wiki-page data-search-index="${searchUrl}" data-cards="${cardsUrl}"`;

  // The heading drops an index page's qualifier (Druid (Abilities index) reads Druid);
  // where that would give two pages one name, the title keeps it.
  const named = new Map();
  for (const title of pages.keys()) {
    const name = displayTitle(title);
    named.set(name, (named.get(name) ?? 0) + 1);
  }
  const pageName = (title) => {
    const name = displayTitle(title);
    return named.get(name) > 1 && name !== title ? title : name;
  };
  const broken = new Map();
  let written = 0;
  for (const page of site.all) {
    // A long-lived DOM keeps every page it has built; a fresh one per batch bounds memory.
    if (written && written % 200 === 0) {
      await window.happyDOM.close();
      window = installDom();
    }
    const doc = window.document;
    const { title } = page;
    const path = pathOf(title);
    const view = doc.createElement('main');
    view.id = 'view';
    view.tabIndex = -1;
    doc.body.replaceChildren(view);
    const home = title === 'Main Page';
    let directory = false;
    if (home) view.innerHTML = mainPageMarkup(site);
    else directory = renderArticle(view, site, title, true, { seeAllLinks: true });
    view.dataset.article = path;
    if (directory) view.dataset.directory = '';
    const shown = home ? 'Player Encyclopedia' : pageName(title);
    for (const missing of rewriteView(view, { paths, current: title, title: shown }))
      broken.set(missing, (broken.get(missing) ?? new Set()).add(title));
    const lead =
      view.querySelector('.wiki-lead')?.textContent ??
      view.querySelector('article > p:not(.hatnote)')?.textContent ??
      '';
    const description = home
      ? 'The World of ClaudeCraft player encyclopedia: every item, enemy, quest, zone, ability and game system, with sources, stats and maps.'
      : describePage({ title: shown, lead, kind: pageKind(page, directory) });
    const crumbs = home
      ? []
      : [
          { name: 'Encyclopedia', path: HOME_PATH },
          ...pageParents(site, title)
            .filter((crumb) => paths.has(crumb.title))
            .map((crumb) => ({ name: displayTitle(crumb.label), path: pathOf(crumb.title) })),
        ];
    const head = headMarkup({
      title: shown,
      description,
      path,
      image: page.model || (page.art?.startsWith('/') ? page.art : ''),
      crumbs,
      article: !directory && !home,
    });
    const nav = navHtml.replace(`href="${path}"`, `href="${path}" aria-current="page"`);
    const file = join(outDir, fileForPath(path));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, pageDocument(shell, { head, nav, view: view.outerHTML, body }));
    written++;
  }
  mkdirSync(join(outDir, 'encyclopedia-data'), { recursive: true });
  writeFileSync(join(outDir, searchUrl), searchJson);
  writeFileSync(join(outDir, cardsUrl), cardsJson);
  writeFileSync(join(outDir, 'encyclopedia-data/redirects.json'), JSON.stringify(redirects));
  writeFileSync(join(outDir, 'sitemap-wiki.xml'), sitemapXml([...paths.values()]));
  await window.happyDOM.close();
  log(
    `wiki site: ${written} pages in ${((Date.now() - started) / 1000).toFixed(1)}s, ` +
      `${broken.size} unknown link targets`,
  );
  return { paths, broken, written, searchUrl, cardsUrl };
}

async function main() {
  const args = process.argv.slice(2);
  const seedFile = args.includes('--generate')
    ? generateSeed()
    : resolve(argValue(args, '--seed') ?? join(ROOT, 'mediawiki/seed/pages.xml'));
  const outDir = resolve(argValue(args, '--out') ?? join(ROOT, '.wiki-site'));
  const templateFile = resolve(argValue(args, '--template') ?? join(ROOT, 'encyclopedia.html'));
  const registry = readRegistry();
  if (args.includes('--clean')) rmSync(join(outDir, 'wiki'), { recursive: true, force: true });
  const { paths, broken } = await buildSite({ seedFile, outDir, templateFile, registry });
  // A seed generated for this build lives in its own temporary folder.
  if (args.includes('--generate')) rmSync(dirname(seedFile), { recursive: true, force: true });
  if (args.includes('--consume-template')) rmSync(templateFile, { force: true });
  for (const [target, from] of broken)
    console.warn(`  no page for [[${target}]], linked from ${[...from].slice(0, 3).join('; ')}`);
  const drift = registryDrift(paths, registry);
  if (args.includes('--update-registry')) {
    const redirects = { ...registry.redirects };
    for (const title of drift.missing) redirects[registry.pages[title]] = null;
    const pages = Object.fromEntries([...paths].sort(([a], [b]) => (a < b ? -1 : 1)));
    writeFileSync(REGISTRY_FILE, JSON.stringify({ pages, redirects }, null, 1) + '\n');
    console.log(
      `site_paths.json: ${drift.added.length} new, ${drift.missing.length} moved to redirects`,
    );
  } else if (drift.added.length || drift.missing.length) {
    console.warn(
      `site_paths.json is out of date (${drift.added.length} new, ${drift.missing.length} gone); ` +
        'run npm run wiki:paths',
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
