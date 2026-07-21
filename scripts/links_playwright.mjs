// Playwright cross-device test for the official-links page (public/links.html).
// Uses playwright-core driving the system Chrome (no bundled-browser download),
// serves public/ with the /links pretty-URL alias, runs assertions on desktop +
// several mobile device profiles, and saves screenshots to tmp/links-playwright/.
//
//   npm install --no-save playwright-core   # one-time, not added to package.json
//   node scripts/links_playwright.mjs
//
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright-core';
import { BROWSER_PATH } from './browser_path.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'tmp', 'links-playwright');
fs.mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};
const ALIASES = new Set(['/links', '/links/', '/social', '/social/', '/social-media-links', '/social-media-links/']);
const server = http.createServer((req, res) => {
  let u = (req.url ?? '/').split('?')[0];
  if (ALIASES.has(u) || u === '/') u = '/links.html';
  const f = path.join(PUBLIC, path.normalize(u).replace(/^(\.\.[/\\])+/, ''));
  if (!f.startsWith(PUBLIC) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] ?? 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

const EXPECTED_LINKS = [
  'https://worldofclaudecraft.com/',
  'https://x.com/WoClaudecraft',
  'https://www.instagram.com/worldofclaudecraft/',
  'https://www.tiktok.com/@worldofclaudecraft',
  'https://www.youtube.com/@WoClaudeCraft',
  'https://www.reddit.com/r/WorldofClaudecraft/',
  'https://github.com/levy-street/world-of-claudecraft',
];

const problems = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) problems.push(msg); };

// Device matrix: one desktop + a spread of real mobile/tablet profiles.
const TARGETS = [
  { name: 'desktop-1440', kind: 'web', context: { viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2 } },
  { name: 'laptop-1280', kind: 'web', context: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 } },
  { name: 'mobile-iphone13', kind: 'mobile', context: devices['iPhone 13'] },
  { name: 'mobile-iphone-se', kind: 'mobile', context: devices['iPhone SE'] },
  { name: 'mobile-pixel7', kind: 'mobile', context: devices['Pixel 7'] },
  { name: 'tablet-ipad', kind: 'mobile', context: devices['iPad (gen 7)'] },
  { name: 'narrow-320', kind: 'mobile', context: { viewport: { width: 320, height: 720 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
];

async function main() {
  await new Promise((r) => server.listen(8802, r));
  const base = 'http://127.0.0.1:8802';
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, args: ['--no-sandbox'] });

  for (const t of TARGETS) {
    const context = await browser.newContext(t.context);
    const page = await context.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

    // Navigate via the pretty alias to exercise the static-route rewrite.
    await page.goto(`${base}/links`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500); // settle web fonts

    ok(errs.length === 0, `[${t.name}] no console/page errors`);

    // Core structural assertions (run on every device).
    ok((await page.title()) === 'World of ClaudeCraft - Official Links', `[${t.name}] localized title`);
    ok((await page.locator('h1').count()) === 1, `[${t.name}] exactly one h1`);
    ok((await page.locator('h2').count()) === 1, `[${t.name}] exactly one h2`);
    ok((await page.locator('a.btn').count()) === 7, `[${t.name}] 7 link buttons`);

    const hrefs = await page.locator('a.btn').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
    ok(EXPECTED_LINKS.every((u) => hrefs.includes(u)), `[${t.name}] all official URLs present`);

    const allBlankSafe = await page.locator('a.btn').evaluateAll((els) =>
      els.every((e) => e.getAttribute('target') === '_blank' && /noopener/.test(e.getAttribute('rel') || '') && /noreferrer/.test(e.getAttribute('rel') || '')));
    ok(allBlankSafe, `[${t.name}] every link target=_blank rel=noopener noreferrer`);

    // Wax seal renders red (CSS token, not unresolved var()).
    const seal = await page.locator('.btn__seal .seal-disc').first().evaluate((c) => getComputedStyle(c).fill);
    ok(seal === 'rgb(124, 31, 26)', `[${t.name}] verified seal fills red (${seal})`);

    // No horizontal overflow at any size.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(overflow <= 1, `[${t.name}] no horizontal overflow (delta ${overflow}px)`);

    // Hero label must wrap, never truncate (scrollWidth > clientWidth ⇒ ellipsis clip).
    const heroClip = await page.locator('.btn--hero .btn__label').evaluate((el) => el.scrollWidth - el.clientWidth);
    ok(heroClip <= 1, `[${t.name}] hero label not clipped (overflow ${heroClip}px)`);

    // Tap targets large enough on touch devices.
    if (t.kind === 'mobile') {
      const minH = await page.locator('a.btn').evaluateAll((els) => Math.min(...els.map((e) => e.getBoundingClientRect().height)));
      ok(minH >= 44, `[${t.name}] min tap target >= 44px (${Math.round(minH)}px)`);
    }

    // Keyboard focus ring visible on the first link.
    await page.locator('a.btn').first().focus();
    const outline = await page.locator('a.btn').first().evaluate((a) => {
      const s = getComputedStyle(a);
      return parseFloat(s.outlineWidth) > 0 && s.outlineStyle !== 'none';
    });
    ok(outline, `[${t.name}] focus-visible outline present`);

    await page.screenshot({ path: path.join(OUT, `${t.name}.png`), fullPage: t.kind === 'mobile' });

    // Capture a focused-hero state for the primary desktop profile.
    if (t.name === 'desktop-1440') {
      await page.locator('a.btn--hero').focus();
      await page.screenshot({ path: path.join(OUT, 'desktop-hero-focus.png') });
    }

    await context.close();
  }

  await browser.close();
  server.close();

  console.log(`\nScreenshots saved under ${OUT}`);
  for (const f of fs.readdirSync(OUT)) console.log(`  - ${path.join(OUT, f)}`);

  if (problems.length) {
    console.error(`\n${problems.length} check(s) FAILED:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('\nAll Playwright checks passed across web + mobile.');
}

main().catch((e) => { console.error(e); server.close(); process.exit(1); });
