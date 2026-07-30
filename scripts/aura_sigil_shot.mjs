// Visual proof of the aura sigil. Enters the offline game via the shared
// enterOfflineGame helper, puts one exclusive self-buff on the player, and
// captures the character three ways: sigils off (the current look), a holy
// paladin aura, and a physical warrior stance, so the PR shows both that the
// sigil appears and that its colour follows the aura's school.
//   node scripts/aura_sigil_shot.mjs [suffix]   (needs `npm run dev`)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const SUFFIX = process.argv[2] ?? 'after';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: [
    '--window-size=1600,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    // Chrome refuses to start as root. Opt in explicitly rather than
    // weakening the sandbox for everyone who runs this normally.
    ...(process.env.PUPPETEER_NO_SANDBOX ? ['--no-sandbox'] : []),
  ],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await enterOfflineGame(page, {
  charClass: 'paladin',
  charName: 'Sigil',
  gameBootTimeoutMs: Number(process.env.GAME_BOOT_TIMEOUT_MS ?? 60000),
});

// The debug handle is published a beat after first paint, inside main.ts s
// post-boot timeout, so wait for it rather than racing it.
await page.waitForFunction(() => window.__game !== undefined, { timeout: 60000 });

// Pull the camera in and level it so the ground disc and both crescents are in
// frame, then drop the HUD noise that would otherwise crowd a character shot.
await page.evaluate(() => {
  const g = window.__game;
  g.input.camDist = 6.5;
  for (const el of document.querySelectorAll('.toast, .perf-warning, [data-dismiss]')) el.remove();
});

const apply = (id, school) =>
  page.evaluate(
    (auraId, auraSchool) => {
      const sim = window.__game.sim;
      const p = sim.player;
      p.auras.length = 0;
      sim.applyAura(p, {
        id: auraId,
        name: auraId,
        kind: 'buff_armor_pct',
        remaining: 1750,
        duration: 1800,
        value: 10,
        sourceId: p.id,
        school: auraSchool,
      });
    },
    id,
    school,
  );

const SETTLE_MS = Number(process.env.SHOT_SETTLE_MS ?? 900);
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
// A tight box on the character; the sigil is a ground effect so the clip sits
// low enough to include the disc under the feet.
const CLIP = { x: 560, y: 210, width: 640, height: 520 };

const shot = async (name) => {
  await settle(SETTLE_MS);
  await page.screenshot({ path: `tmp/aura-sigil-${SUFFIX}-${name}.png`, clip: CLIP });
  console.log(`wrote tmp/aura-sigil-${SUFFIX}-${name}.png`);
};

// 1. the current look: an aura is running, nothing marks the ground
await apply('devotion_aura', 'holy');
await page.evaluate(() => {
  window.__game.renderer.showAuraSigils = false;
});
await shot('off');

// 2. holy: Steadfast Aura
await page.evaluate(() => {
  window.__game.renderer.showAuraSigils = true;
});
await shot('holy');

// 3. physical: a warrior stance, to show the school-keyed palette
await apply('battle_stance', 'physical');
await shot('physical');

const probe = await page.evaluate(() => {
  const r = window.__game.renderer;
  let found = 0;
  r.scene?.traverse?.((o) => {
    if (o.name === 'aura-sigil-visual' && o.visible) found++;
  });
  return { visibleSigils: found, setting: r.showAuraSigils };
});
console.log('probe:', JSON.stringify(probe));

await browser.close();
process.exit(0);
