import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const key = process.argv[2];
const out = `E:/woc/entregas/santuario/trash/${key}`;
const html = fs.readFileSync(`${out}/index.html`, 'utf8');
const links = [...html.matchAll(/(?:href|src|poster)="([^"]+)"/g)].map((m) => m[1]);
for (const link of links)
  assert(fs.existsSync(path.join(out, link)), `Missing gallery link ${link}`);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(`file:///${out}/index.html`);
  await page.screenshot({ path: `${out}/gallery_desktop.png`, fullPage: true });
  const video = page.locator('video').first();
  await video.evaluate((v) => {
    v.muted = true;
    return v.play();
  });
  await page.waitForFunction(() => document.querySelector('video').currentTime > 0.1);
  await video.evaluate((v) => v.pause());
  await page.setViewportSize({ width: 414, height: 896 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: `${out}/gallery_mobile.png`, fullPage: true });
  assert.equal(errors.length, 0);
  fs.writeFileSync(
    `${out}/gallery_validation.json`,
    JSON.stringify(
      {
        status: 'PASS',
        links: links.length,
        errors,
        index_sha256: createHash('sha256').update(html).digest('hex'),
      },
      null,
      2,
    ),
  );
  console.log('GALLERY PASS', key);
} finally {
  await browser.close();
}
