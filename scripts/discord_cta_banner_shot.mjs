// Visual check for the unlinked "Link your Discord" CTA banner across viewports.
// Renders the REAL banner markup (lifted from index.html) with the REAL CSS rules
// (lifted from src/styles/index.extra.css) so we exercise the shipped styles, then
// screenshots a portrait phone, a landscape phone, and a desktop width.
import { mkdirSync, readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

mkdirSync('tmp', { recursive: true });

// Pull just the banner block out of index.html. Terminate on the close button so the
// capture ends at the banner's own closing </div> and does not spill into the markup
// that follows it.
const html = readFileSync('index.html', 'utf8');
const bannerMatch = html.match(
  /<div id="discord-cta-banner"[\s\S]*?id="discord-cta-close"[\s\S]*?<\/button>\s*<\/div>/,
);
if (!bannerMatch) throw new Error('could not find #discord-cta-banner in index.html');
// Drop the `hidden` attribute so it renders, and seed the stats text.
const banner = bannerMatch[0]
  .replace(' hidden>', '>')
  .replace(
    '<span class="dc-cta-stats" id="discord-cta-stats"></span>',
    '<span class="dc-cta-stats" id="discord-cta-stats">299 online · 1,369 members in the server</span>',
  );

// Pull the banner CSS (the first banner rule through the trailing media query, which
// runs to EOF) straight out of index.extra.css so we render the shipped styles.
const css = readFileSync('src/styles/index.extra.css', 'utf8');
const fullCss = css.slice(css.indexOf('#discord-cta-banner {'));

const page = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<style>
* { box-sizing: border-box; }
html,body { margin:0; background:#15171c; min-height:100vh; font-family: system-ui, sans-serif; }
.spacer { height: 220px; }
${fullCss}
</style></head><body><div class="spacer"></div>${banner}</body></html>`;

// The portrait bug made the banner a tall one-word-per-line column; assert a sane
// height ceiling and that it never overflows the viewport width.
const MAX_BANNER_HEIGHT = 160;
let fail = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`);
  if (!cond) fail++;
};

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader'],
});
try {
  const viewports = [
    { name: 'portrait-iphone', width: 393, height: 852, touch: true },
    { name: 'landscape-phone', width: 740, height: 393, touch: true },
    { name: 'landscape-phone-se', width: 667, height: 375, touch: true },
    { name: 'desktop', width: 1280, height: 720, touch: false },
  ];
  for (const vp of viewports) {
    const p = await browser.newPage();
    await p.setViewport({
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 2,
      hasTouch: vp.touch,
      isMobile: vp.touch,
    });
    await p.setContent(page, { waitUntil: 'load' });
    const out = `tmp/discord_cta_${vp.name}.png`;
    await p.screenshot({ path: out });
    const box = await p.$eval('#discord-cta-banner', (el) => {
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) };
    });
    console.log(`${vp.name}: ${out}  banner=${box.w}x${box.h}`);
    check(`${vp.name} height <= ${MAX_BANNER_HEIGHT}px`, box.h <= MAX_BANNER_HEIGHT, `h=${box.h}`);
    check(
      `${vp.name} fits viewport width`,
      box.right <= vp.width + 1,
      `right=${box.right}/${vp.width}`,
    );
    await p.close();
  }
} finally {
  await browser.close();
}

process.exit(fail > 0 ? 1 : 0);
