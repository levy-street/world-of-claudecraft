// One subject: the night sky's two moons (src/render/twin_moons_core.ts): the
// mage's moon held opposite the sun and the natural moon beside it. Boots the
// offline client at the lowest graphics preset, scrubs the clock and the lunar
// phase through the real /daynight chat command, turns the camera up toward the
// moons and shoots each scene. Needs a dev client running (`npm run dev`).
//
//   GAME_URL=http://localhost:5173 OUT_DIR=tmp/twin-moons OUT_PREFIX=after \
//     SCENES=crescent,gibbous,eclipse,dusk node scripts/twin_moons_shot.mjs
//
// The eclipse scene uses `/daynight moon eclipse`, which only exists on a branch
// that has the two moons; on a base without it the scene is skipped.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT_DIR = process.env.OUT_DIR ?? 'tmp/twin-moons';
const PREFIX = process.env.OUT_PREFIX ?? 'shot';
const SOAK_MS = Number(process.env.SOAK_MS ?? 25_000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT_DIR, { recursive: true });

// day phase (0 midnight, 0.5 noon), lunar phase word, camera yaw and pitch
const ALL_SCENES = {
  crescent: { day: '0.83', moon: '0.18', yaw: Number(process.env.YAW ?? 0), pitch: -0.5 },
  gibbous: { day: 'midnight', moon: '0.42', yaw: Number(process.env.YAW ?? 0), pitch: -0.5 },
  eclipse: { day: 'midnight', moon: 'eclipse', yaw: Number(process.env.YAW ?? 0), pitch: -0.5 },
  dusk: { day: '0.785', moon: '0.3', yaw: Number(process.env.YAW ?? 1.1), pitch: -0.2 },
};
const scenes = (process.env.SCENES ?? Object.keys(ALL_SCENES).join(','))
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s in ALL_SCENES);

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 600_000,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--window-size=1600,900',
    // GL_ARGS=gpu draws on the machine's GPU (where software WebGL cannot make the
    // world's context); the default stays the portable SwiftShader path
    ...(process.env.GL_ARGS === 'gpu'
      ? ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu']
      : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
  ],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
// the standing capture rule: the lowest graphics preset, seeded before boot
await page.evaluateOnNewDocument(
  "try { localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 })); } catch {}",
);
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
// The landing page starts the client lazily, and a click on the hidden offline
// hook before it has loaded is dropped: keep clicking until the class cards show.
for (let i = 0; i < 30; i++) {
  const shown = await page.evaluate(() => {
    // each click mounts the creation preview's own WebGL context, so click only
    // while the cards are still hidden (a click storm exhausts the context cap)
    const up = () =>
      !!document.querySelector('#offline-select .mini-class')?.getClientRects().length;
    if (!up()) document.querySelector('#btn-offline')?.click();
    return up();
  });
  if (shown) break;
  await sleep(10_000);
}
page.on('pageerror', (e) => console.log(`PAGEERROR: ${e.message}`));
const booted = await enterOfflineGame(page, {
  charClass: 'warrior',
  charName: 'Moonwatch',
  gameBootTimeoutMs: 540_000,
  selectorTimeoutMs: 60_000,
}).catch(async (e) => {
  await page.screenshot({ path: `${OUT_DIR}/entry-failure.png` });
  throw e;
});
if (!booted) {
  await page.screenshot({ path: `${OUT_DIR}/entry-failure.png` });
  throw new Error('offline world did not boot');
}
await sleep(4000);
await page.evaluate(() => {
  for (const b of document.querySelectorAll('#tutorial-greeting button')) b.click();
});

async function chat(line) {
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Enter');
  await sleep(300);
  await page.evaluate((text) => {
    const c = document.querySelector('#chat-input');
    c.focus();
    c.value = text;
    c.dispatchEvent(new Event('input', { bubbles: true }));
  }, line);
  await page.keyboard.press('Enter');
  await page.evaluate(() => document.querySelector('#chat-input')?.blur());
  await sleep(300);
}

const hasEclipse = await page.evaluate(async () => {
  try {
    const m = await import('/src/render/day_night_clock.ts');
    return typeof m.setMoonLatitudeOverride === 'function';
  } catch {
    return false;
  }
});

for (const name of scenes) {
  const s = ALL_SCENES[name];
  if (s.moon === 'eclipse' && !hasEclipse) {
    console.log(`skip ${name}: this build has no /daynight moon eclipse`);
    continue;
  }
  await chat(`/daynight ${s.day}`);
  await chat(`/daynight moon ${s.moon}`);
  await page.evaluate(
    (yaw, pitch) => {
      const inp = window.__game.input;
      inp.camYaw = yaw;
      inp.camPitch = pitch;
      inp.camDist = 4;
    },
    s.yaw,
    s.pitch,
  );
  // the light grade eases toward the new time of day
  await sleep(SOAK_MS);
  const path = `${OUT_DIR}/${PREFIX}-${name}.png`;
  await page.screenshot({ path });
  console.log(`wrote ${path}`);
}
await browser.close();
