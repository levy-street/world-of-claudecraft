// Renders public/links.html in a headless browser at desktop + mobile sizes,
// screenshots both, and asserts the key correctness/accessibility requirements.
// Serves public/ via a tiny static server (incl. the /links pretty-URL alias),
// so it exercises the page exactly as shipped without booting the full game.
//
//   node scripts/links_verify.mjs
//
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'tmp');
fs.mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};
const ALIASES = new Set(['/links', '/links/', '/social', '/social/', '/social-media-links', '/social-media-links/']);

const server = http.createServer((req, res) => {
  let urlPath = (req.url ?? '/').split('?')[0];
  if (ALIASES.has(urlPath) || urlPath === '/') urlPath = '/links.html';
  const file = path.join(PUBLIC, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const PORT = 8799;
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

async function main() {
  await new Promise((r) => server.listen(PORT, r));
  const base = `http://127.0.0.1:${PORT}`;
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });

  try {
    // ---- Desktop ----
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
    // Navigate via the pretty alias to prove the static-route rewrite works.
    await page.goto(`${base}/links`, { waitUntil: 'networkidle2', timeout: 20000 });
    await new Promise((r) => setTimeout(r, 600)); // let fonts settle

    ok(errors.length === 0, `no page/console errors (got: ${JSON.stringify(errors)})`);

    const title = await page.title();
    ok(title === 'World of ClaudeCraft - Official Links', `document.title is localized ("${title}")`);

    const htmlLang = await page.evaluate(() => document.documentElement.lang);
    ok(htmlLang === 'en', `html lang = en (got "${htmlLang}")`);

    const counts = await page.evaluate(() => ({
      h1: document.querySelectorAll('h1').length,
      h2: document.querySelectorAll('h2').length,
      main: document.querySelectorAll('main').length,
      nav: document.querySelectorAll('nav').length,
    }));
    ok(counts.h1 === 1, `exactly one h1 (got ${counts.h1})`);
    ok(counts.h2 === 1, `exactly one h2 (got ${counts.h2})`);
    ok(counts.main === 1 && counts.nav === 1, `one main + one nav`);

    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a.btn')).map((a) => ({
        href: a.getAttribute('href'),
        target: a.getAttribute('target'),
        rel: a.getAttribute('rel'),
        hasNewTabHint: /opens in new tab/i.test(a.textContent),
      })),
    );
    ok(links.length === 7, `7 link buttons (got ${links.length})`);
    for (const want of EXPECTED_LINKS) {
      ok(links.some((l) => l.href === want), `link present: ${want}`);
    }
    ok(links.every((l) => l.target === '_blank'), `every link target=_blank`);
    ok(links.every((l) => (l.rel || '').includes('noopener') && (l.rel || '').includes('noreferrer')), `every link rel=noopener noreferrer`);
    ok(links.every((l) => l.hasNewTabHint), `every link has a "(opens in new tab)" hint`);

    // House rule: no em dash, no emoji in visible text.
    const visibleText = await page.evaluate(() => document.body.innerText);
    const EM_DASH = String.fromCharCode(8212);
    ok(!visibleText.includes(EM_DASH), `no em dash in visible text`);
    ok(!/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(visibleText), `no emoji in visible text`);

    // Focus ring is present on the first link when focused.
    const outline = await page.evaluate(() => {
      const a = document.querySelector('a.btn');
      a.focus();
      const s = getComputedStyle(a);
      return { width: s.outlineWidth, style: s.outlineStyle };
    });
    ok(parseFloat(outline.width) > 0 && outline.style !== 'none', `focus-visible outline on link (${outline.width} ${outline.style})`);

    // Every data-i18n* key referenced in the DOM resolves (no leftover key text).
    const i18nMissing = await page.evaluate(() => {
      const keys = new Set();
      for (const el of document.querySelectorAll('[data-i18n],[data-i18n-html],[data-i18n-alt],[data-i18n-aria]')) {
        for (const attr of ['data-i18n', 'data-i18n-html', 'data-i18n-alt', 'data-i18n-aria']) {
          const k = el.getAttribute(attr);
          if (k) keys.add(k);
        }
      }
      return Array.from(keys);
    });
    ok(i18nMissing.length >= 20, `i18n keys wired (${i18nMissing.length} keys)`);

    // Structured data (JSON-LD) parses and declares all official channels via sameAs.
    const ld = await page.evaluate(() => {
      const el = document.querySelector('script[type="application/ld+json"]');
      if (!el) return null;
      try { return JSON.parse(el.textContent); } catch (e) { return 'INVALID'; }
    });
    ok(ld && ld !== 'INVALID', `JSON-LD present and valid`);
    const sameAs = ld && ld !== 'INVALID' ? (ld.about?.sameAs ?? []) : [];
    ok(EXPECTED_LINKS.filter((u) => u !== 'https://worldofclaudecraft.com/').every((u) => sameAs.includes(u)),
      `JSON-LD sameAs lists all 6 social profiles (${sameAs.length})`);

    // Verified wax seals must render as red discs (literal hex, not unresolved var()).
    const sealFill = await page.evaluate(() => {
      const c = document.querySelector('.btn__seal circle');
      return c ? getComputedStyle(c).fill : null;
    });
    ok(sealFill === 'rgb(124, 31, 26)', `wax seal disc fills red #7c1f1a (got ${sealFill})`);

    await page.screenshot({ path: path.join(OUT, 'links_desktop.png') });

    // Desktop: no horizontal overflow.
    const dOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(dOverflow <= 1, `no horizontal overflow on desktop (delta ${dOverflow}px)`);

    // ---- Mobile (iPhone 12-ish) ----
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 400));
    const mOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(mOverflow <= 1, `no horizontal overflow on mobile 390px (delta ${mOverflow}px)`);

    const tap = await page.evaluate(() => {
      const rects = Array.from(document.querySelectorAll('a.btn')).map((a) => a.getBoundingClientRect().height);
      return Math.min(...rects);
    });
    ok(tap >= 44, `min tap-target height >= 44px (got ${tap}px)`);

    await page.screenshot({ path: path.join(OUT, 'links_mobile.png'), fullPage: true });

    // ---- Narrow 320px reflow ----
    await page.setViewport({ width: 320, height: 720, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.reload({ waitUntil: 'networkidle2' });
    const nOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(nOverflow <= 1, `no horizontal overflow at 320px (delta ${nOverflow}px)`);

    console.log(`\nScreenshots written to ${OUT}/links_desktop.png, links_mobile.png`);
  } finally {
    await browser.close();
    server.close();
  }

  if (problems.length) {
    console.error(`\n${problems.length} check(s) FAILED:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('\nAll checks passed.');
}

main().catch((e) => { console.error(e); server.close(); process.exit(1); });
