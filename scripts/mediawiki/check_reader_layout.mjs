// Exercise the hash-routed article reader (the offline export from
// scripts/mediawiki/export_reader.mjs), including nested overflow on narrow screens.
// The public static pages are audited by tests/wiki_site_audit.test.ts instead.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from '../browser_path.mjs';

const url = process.argv[2];
if (!url)
  throw Error('Pass the file URL of an offline export (scripts/mediawiki/export_reader.mjs).');
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: true,
  args: ['--disable-gpu', '--disable-ipc-flooding-protection'],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewport({ width: 320, height: 780 });
  await page.goto(url.split('#')[0] + '#All%20Pages');
  await page.waitForSelector('article a');
  await page.evaluate(() => document.fonts.ready);
  const all = await page.$$eval('article a', (links) => [
    ...new Set(links.map((a) => decodeURIComponent(a.hash.slice(1)))),
  ]);
  assert(all.length > 1000);
  const sample = [
    'Mending Light (Ability)',
    'Wolves at the Door',
    'Items',
    'Quests',
    'Gameplay Systems',
    'All Pages',
    'Main Page',
    'The Reliquary',
    'World quests',
    'Weekly quests',
    'Rifts',
    'Ashen Coliseum',
    'World Market',
    'Talent choices',
  ];
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewport({ width, height: 800 });
    const titles = width === 320 ? [...new Set([...all, ...sample])] : sample;
    let checked = 0;
    for (let i = 0; i < titles.length; i += 80) {
      const failures = await page.evaluate(
        (batch) => {
          const failures = [];
          for (const title of batch) {
            history.replaceState(null, '', '#' + encodeURIComponent(title));
            window.dispatchEvent(new HashChangeEvent('hashchange'));
            let first = null;
            if (
              document.querySelector('main')?.dataset.article !== title ||
              !document.querySelector('main h1')
            )
              throw Error('Navigation failed at ' + title);
            if (document.documentElement.scrollWidth > innerWidth + 1)
              first = 'page exceeds viewport';
            for (const el of document.querySelectorAll(
              'main, header, aside, nav, main :is(table,th,td,p,li,a,pre,code,h1,h2,h3,.scroll,.jump,.tags),header a,aside a',
            )) {
              if (!el.clientWidth || !el.textContent.trim()) continue;
              if (el.scrollWidth > el.clientWidth + 2) {
                first =
                  el.tagName +
                  '.' +
                  el.className +
                  ' (' +
                  el.clientWidth +
                  ' / ' +
                  el.scrollWidth +
                  ') ' +
                  el.textContent.slice(0, 50);
                break;
              }
            }
            if (first) failures.push({ title, first });
          }
          return failures;
        },
        titles.slice(i, i + 80),
      );
      checked += Math.min(80, titles.length - i);
      assert.deepEqual(
        failures,
        [],
        'Text overflow at ' + width + ' px: ' + JSON.stringify(failures.slice(0, 5)),
      );
    }
    console.log(width + ' px: ' + checked + ' article layouts fit.');
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
