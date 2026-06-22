// Browser E2E + screenshots for the curated Guide (/wiki). Needs `npm run dev`.
// Override the base with GUIDE_URL= (default http://localhost:5173).
// Confirms the SPA mounts, client-side routing works, focus moves to <main>, and the
// page is free of console/page errors. Writes screenshots (desktop + mobile) to tmp/.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const BASE = process.env.GUIDE_URL ?? 'http://localhost:5173';
mkdirSync('tmp', { recursive: true });

let fail = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`);
  if (!cond) fail++;
};

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--use-angle=swiftshader', '--no-sandbox'],
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  // Home / overview.
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
  await page.goto(`${BASE}/wiki`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.guide-hero-title', { timeout: 8000 });
  const heroText = await page.$eval('.guide-hero-title', (el) => el.textContent.trim());
  check('home hero renders', /World of ClaudeCraft/i.test(heroText), heroText);
  check('top nav present', (await page.$$('.guide-nav-link')).length >= 4);
  check('Play CTA points at /play', (await page.$eval('.guide-cta', (el) => el.getAttribute('href'))) === '/play');
  check('home hides the docs sidebar', await page.$eval('#guide-sidebar', (el) => el.hidden));
  check('html lang set', (await page.$eval('html', (el) => el.lang)).length > 0);
  check('what-it-is pillars (3)', (await page.$$('.guide-pillar')).length === 3);
  check('nine class chips', (await page.$$('.guide-class-chip')).length === 9);
  check('three zone cards', (await page.$$('.guide-zone-card')).length === 3);
  check('faq disclosures (>=4)', (await page.$$('.guide-faq-item')).length >= 4);
  check('single h1 on the page', (await page.$$('.guide-main h1')).length === 1);
  await page.screenshot({ path: 'tmp/wiki-home.png', fullPage: true });

  // Client-side navigation to a docs section (placeholder this phase).
  await page.click('.guide-nav-link[data-sub="how-to-play"]');
  await page.waitForFunction(() => location.pathname === '/wiki/how-to-play');
  await page.waitForSelector('.guide-main h1');
  check('SPA navigated to How to Play', (await page.url()).endsWith('/wiki/how-to-play'));
  check('docs sidebar now visible', !(await page.$eval('#guide-sidebar', (el) => el.hidden)));
  check('focus moved to main', await page.evaluate(() => document.activeElement?.id === 'guide-main'));

  // Built section pages render real content (not the placeholder).
  for (const sub of ['how-to-play', 'reference/combat', 'reference/controls', 'reference/glossary', 'faq']) {
    await page.goto(`${BASE}/wiki/${sub}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.guide-article h1');
    const placeholder = await page.$('.guide-placeholder');
    check(`content page renders: ${sub}`, !placeholder);
  }
  await page.goto(`${BASE}/wiki/how-to-play`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.guide-steps li');
  await page.screenshot({ path: 'tmp/wiki-howtoplay.png', fullPage: true });
  await page.goto(`${BASE}/wiki/reference/controls`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.guide-keytable');
  await page.screenshot({ path: 'tmp/wiki-controls.png', fullPage: true });

  // Classes index + a class detail page.
  await page.goto(`${BASE}/wiki/classes`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.guide-class-card');
  check('classes index lists nine classes', (await page.$$('.guide-class-card')).length === 9);
  const crestSrc = await page.$eval('.guide-class-crest', (el) => el.getAttribute('src') || '');
  check('class crest is a procedural data URL', crestSrc.startsWith('data:image'));
  await page.screenshot({ path: 'tmp/wiki-classes.png', fullPage: true });

  await page.goto(`${BASE}/wiki/classes/warrior`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.guide-class-hero');
  check('class page hero renders', (await page.$eval('.guide-class-hero-name', (el) => el.textContent.trim())).length > 0);
  check('class page shows specs', (await page.$$('.guide-spec-card')).length >= 1);
  check('class page shows signature abilities', (await page.$$('.guide-kit-item')).length >= 1);
  check('class page title is the class name', /Warrior/i.test(await page.title()));
  await page.screenshot({ path: 'tmp/wiki-class-warrior.png', fullPage: true });

  await page.goto(`${BASE}/wiki/classes/notaclass`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.guide-article');
  check('invalid class id renders not-found', !!(await page.$('.guide-notfound')));

  // Phase 04 pages.
  await page.goto(`${BASE}/wiki/bestiary`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.guide-family');
  check('bestiary lists creature families', (await page.$$('.guide-family')).length >= 8);
  check('bestiary shows creatures', (await page.$$('.guide-creature')).length > 10);
  await page.screenshot({ path: 'tmp/wiki-bestiary.png', fullPage: true });

  await page.goto(`${BASE}/wiki/world`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.guide-zone-card');
  check('world shows three zones', (await page.$$('.guide-zone-card')).length === 3);

  await page.goto(`${BASE}/wiki/quests`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.guide-article h1');
  check('quests page renders', !(await page.$('.guide-placeholder')));

  await page.goto(`${BASE}/wiki/dungeons`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.guide-dungeon-card');
  check('dungeons shows teaser cards', (await page.$$('.guide-dungeon-card')).length >= 5);
  await page.screenshot({ path: 'tmp/wiki-dungeons.png', fullPage: true });

  // Class chooser (filterable index).
  await page.goto(`${BASE}/wiki/classes`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.guide-chooser');
  check('class chooser present', !!(await page.$('.guide-chooser')));
  await page.click('.guide-chip[data-group="role"][data-value="healer"]');
  const healerVisible = await page.$$eval('.guide-class-card', (els) => els.filter((e) => !e.hidden).length);
  check('chooser filters the grid', healerVisible > 0 && healerVisible < 9, `visible=${healerVisible}`);
  await page.click('.guide-chooser-clear');
  const allVisible = await page.$$eval('.guide-class-card', (els) => els.filter((e) => !e.hidden).length);
  check('chooser clear restores all nine', allVisible === 9);

  // Site search.
  await page.type('#guide-search-input', 'warrior');
  await page.waitForSelector('.guide-search-opt');
  check('search returns results', (await page.$$('.guide-search-opt')).length > 0);

  // New pages render (not the placeholder).
  for (const [path, sel] of [['reference/talents', '.guide-talents'], ['arena', '.guide-arena'], ['wish-i-knew', '.guide-wish']]) {
    await page.goto(`${BASE}/wiki/${path}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.guide-article h1');
    check(`new page renders: ${path}`, !!(await page.$(sel)) && !(await page.$('.guide-placeholder')));
  }

  // Navigation aids: breadcrumb, prev/next, and the scrollspy TOC. The TOC only appears
  // on pages with at least three section headings, so use Combat (four sections).
  await page.goto(`${BASE}/wiki/how-to-play`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.guide-breadcrumb');
  check('breadcrumb present on content page', !!(await page.$('.guide-breadcrumb')));
  check('prev/next sequence present', !!(await page.$('.guide-seq')));
  await page.goto(`${BASE}/wiki/reference/combat`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.guide-toc');
  check('table of contents present on a multi-section page', (await page.$$('.guide-toc a')).length >= 3);

  // Deep link + 404.
  await page.goto(`${BASE}/wiki/nope-not-real`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.guide-notfound');
  check('unknown route renders notFound', !!(await page.$('.guide-notfound')));

  // Skip link must scroll/focus #guide-main, NOT route to notFound (regression).
  await page.goto(`${BASE}/wiki`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.guide-skip');
  await page.keyboard.press('Tab'); // focus the skip link
  await page.keyboard.press('Enter'); // activate it
  check('skip link does not break the page', !(await page.$('.guide-notfound')));
  check('skip link lands focus on main', await page.evaluate(() => document.activeElement?.id === 'guide-main'));

  // Mobile viewport screenshot.
  const mobile = await browser.newPage();
  mobile.on('pageerror', (e) => errors.push(`pageerror(m): ${e.message}`));
  await mobile.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true });
  await mobile.goto(`${BASE}/wiki`, { waitUntil: 'networkidle0' });
  await mobile.waitForSelector('.guide-hero-title');
  await mobile.screenshot({ path: 'tmp/wiki-home-mobile.png' });
  check('mobile menu toggle visible', await mobile.$eval('.guide-menu-toggle', (el) => getComputedStyle(el).display !== 'none'));

  check('no console / page errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}

console.log(fail ? `\n${fail} check(s) failed` : '\nAll checks passed');
process.exit(fail > 0 ? 1 : 0);
