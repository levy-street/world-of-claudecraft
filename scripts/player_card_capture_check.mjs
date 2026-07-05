// Headless framing check for the player-card character capture.
//
// CharacterPreview.captureCloseup() (src/render/characters/preview.ts) is the
// load-bearing step behind the shareable card's character art: it must frame the
// WHOLE figure — feet to the top of a raised weapon/arms in the hero & victory
// poses — without clipping at the frame edges. That depends on the capture
// camera (z / lookAt), which has no unit coverage because it needs a real WebGL
// context. This drives the real preview in a headless browser, captures every
// CARD_POSE across several classes, and measures the alpha bounding box of each
// result, failing if the figure touches the top or bottom edge (a clip).
//
// Usage:
//   npm run dev                       # Vite client on :5173 (serves the ESM modules)
//   node scripts/player_card_capture_check.mjs
//
// Exits non-zero on any clipped, empty, OR under-framed (too-small) capture —
// the latter being the real downside of pulling the capture camera back too far,
// since drawCharacter() fits the whole capture, not the figure's bounding box.
import puppeteer from '../node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import { BROWSER_PATH } from './browser_path.mjs';

const BASE = process.env.WOC_DEV_BASE ?? 'http://localhost:5173';
const CLASSES = ['warrior', 'paladin', 'hunter', 'mage', 'rogue', 'priest'];
// The figure must occupy at least this fraction of the capture height/width, or
// the camera is pulled back too far (figure renders tiny + lost on the card).
const MIN_FILL_H = 0.5, MIN_FILL_W = 0.28;

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH, headless: true,
  args: ['--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 900, deviceScaleFactor: 1 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 45000 });

const results = await page.evaluate(async (CLASSES) => {
  const preload = await import('/src/render/assets/preload.ts');
  if (preload.assetsReady) await preload.assetsReady();
  const { CharacterPreview } = await import('/src/render/characters/index.ts');
  // Use the REAL card poses so the check can't drift from what the card renders.
  const { CARD_POSES } = await import('/src/ui/player_card.ts');

  const container = document.createElement('div');
  container.style.cssText = 'width:540px;height:720px;position:fixed;left:-9999px;top:0';
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);
  document.body.appendChild(container);
  const preview = new CharacterPreview(container, canvas);

  const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
  const measure = (dataUrl) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const W = 540, H = 720;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, W, H);
      const d = ctx.getImageData(0, 0, W, H).data;
      let top = -1, bottom = -1, left = W, right = -1, count = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (d[(y * W + x) * 4 + 3] > 16) {
          if (top < 0) top = y; bottom = y;
          if (x < left) left = x; if (x > right) right = x; count++;
        }
      }
      resolve({ top, bottom, left, right, count, W, H });
    };
    img.src = dataUrl;
  });

  const out = [];
  for (const cls of CLASSES) {
    preview.setClass(cls);
    await raf(); await raf(); await raf();
    for (const pose of CARD_POSES) {
      const url = preview.captureCloseup({ poseClips: pose.clips, poseFraction: pose.fraction });
      out.push({ cls, pose: pose.id, ...(await measure(url)) });
    }
  }
  return out;
}, CLASSES).catch((err) => { pageErrors.push(String(err)); return []; });

await browser.close();

let failed = pageErrors.length > 0;
for (const e of pageErrors) console.log(`❌ page error: ${e}`);
for (const m of results) {
  const empty = m.count < 500;
  const clipTop = m.top <= 0;
  const clipBottom = m.bottom >= m.H - 1;
  const fillH = empty ? 0 : (m.bottom - m.top + 1) / m.H;
  const fillW = empty ? 0 : (m.right - m.left + 1) / m.W;
  const tooSmall = !empty && (fillH < MIN_FILL_H || fillW < MIN_FILL_W);
  const ok = !empty && !clipTop && !clipBottom && !tooSmall;
  if (!ok) failed = true;
  const note = empty ? 'EMPTY capture'
    : clipTop ? 'CLIPPED at top'
    : clipBottom ? 'CLIPPED at bottom'
    : tooSmall ? `TOO SMALL (fillH=${(fillH * 100) | 0}% fillW=${(fillW * 100) | 0}%)`
    : `topMargin=${m.top} botMargin=${m.H - 1 - m.bottom} fillH=${(fillH * 100) | 0}%`;
  console.log(`${ok ? '✅' : '❌'} ${m.cls}/${m.pose}: ${note}`);
}
if (!results.length && !pageErrors.length) { console.log('❌ no captures produced'); failed = true; }
console.log(failed ? '\nFAIL: a capture was clipped, empty, or under-framed.' : '\nPASS: every pose frames the full figure well.');
process.exit(failed ? 1 : 0);
