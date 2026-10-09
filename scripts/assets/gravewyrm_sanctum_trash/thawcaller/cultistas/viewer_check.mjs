import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { chromium } from 'playwright';

const key = process.argv[2],
  out = `E:/woc/entregas/santuario/trash/${key}`;
const hash = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const html = fs.readFileSync(`${out}/viewer.html`, 'utf8'),
  embedded = JSON.parse(html.match(/window.ASSET=(.*?)<\/script>/s)[1]);
assert(Buffer.from(embedded.glb, 'base64').equals(fs.readFileSync(`${out}/${key}.glb`)));
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(`file:///${out}/viewer.html`);
  await page.waitForFunction(() => window.assetReview?.ready, null, { timeout: 60000 });
  const data = await page.evaluate(() => ({
    clips: window.assetReview.clips,
    compressed: window.assetReview.compressedMaterials,
  }));
  assert(data.compressed >= 4);
  for (const c of data.clips)
    for (const fraction of [0, 0.25, 0.5, 0.75, 1])
      await page.evaluate(({ name, t }) => window.assetReview.sample(name, t), {
        name: c.name,
        t: c.duration * fraction,
      });
  const contacts = JSON.parse(fs.readFileSync(`${out}/source_metrics.json`)).contacts;
  fs.mkdirSync(`${out}/reviews/r3`, { recursive: true });
  for (const clip of data.clips) {
    const time = contacts[clip.name] ? (contacts[clip.name] - 1) / 30 : clip.duration * 0.5;
    await page.evaluate(
      ({ name, t }) => {
        document.querySelector('select').value = name;
        window.assetReview.sample(name, t);
      },
      { name: clip.name, t: time },
    );
    const pixels = await page.evaluate(() => window.assetReview.pixelStats());
    assert(
      !pixels.lost && pixels.colors > 32 && pixels.glError === 0,
      `Blank or lost WebGL frame ${clip.name}: ${JSON.stringify(pixels)}`,
    );
    await page.screenshot({ path: `${out}/reviews/r3/GLB_${clip.name}.png` });
  }
  await page.evaluate(() => {
    document.querySelector('select').value = 'Idle';
  });
  await page.evaluate(() => window.assetReview.sample('Idle', 0));
  await page.screenshot({ path: `${out}/webgl_desktop.png` });
  await page.setViewportSize({ width: 414, height: 896 });
  await page.screenshot({ path: `${out}/webgl_mobile.png` });
  assert.equal(errors.length, 0);
  fs.writeFileSync(
    `${out}/webgl_validation.json`,
    JSON.stringify(
      {
        status: 'PASS',
        ...data,
        errors,
        glb_sha256: hash(`${out}/${key}.glb`),
        viewer_sha256: hash(`${out}/viewer.html`),
      },
      null,
      2,
    ),
  );
  console.log('WEBGL KTX2 PASS', key, data.compressed);
} finally {
  await browser.close();
}
