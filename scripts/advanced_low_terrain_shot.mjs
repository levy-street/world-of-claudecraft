// Graphics-comparison rig for the Advanced mix's Terrain Detail Low: shoots
// the Thornpeak Heights hub at a frozen day/night phase under the Low preset
// and under the Advanced mix with every dial at its floor (the profile that
// used to render the terrain black). Keeps its own presets on purpose: the
// shot IS the graphics comparison (see the pr-screenshots skill).
//
//   OUT=tmp/adv-low PHASE=dusk ONLY=low,adv0 node scripts/advanced_low_terrain_shot.mjs
//
// PHASE takes any /daynight preset (dusk, day, dawn, night) or a 0..1 phase.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.OUT ?? 'tmp/adv-low';
const PHASE = process.env.PHASE ?? 'dusk';
// The hub's training-dummy field, where the report's screenshots were taken.
const PX = Number(process.env.PX ?? -17);
const PZ = Number(process.env.PZ ?? 689);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const floor = {
  terrainDetail: 0,
  foliageDensity: 0,
  surfaceDetail: 0,
  effectsQuality: 0,
  shadowQuality: 0,
  antiAliasing: 0,
  bloomQuality: 0,
  ambientOcclusion: 0,
  viewDistance: 0,
  waterQuality: 0,
  characterDetail: 0,
  dynamicLights: 0,
  particleEffects: 0,
};
const variants = {
  low: { graphicsPreset: 1 },
  adv0: { graphicsPreset: 5, ...floor },
  adv_terrainMed: { graphicsPreset: 5, ...floor, terrainDetail: 0.5 },
  // The realistic report: Advanced defaults with ONLY Terrain Detail lowered,
  // so the standard-material grass carpet sits on the boosted Lambert ground.
  adv_terrainLow: { graphicsPreset: 5, terrainDetail: 0 },
};
const only = process.env.ONLY ? process.env.ONLY.split(',') : Object.keys(variants);

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1280,720', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 720 },
});
for (const name of only) {
  // graphicsDefaultApplied stops the first-boot device classification from
  // overwriting the seeded preset (main.ts firstRunGraphicsPreset).
  const settings = { ...variants[name], graphicsDefaultApplied: true };
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.evaluateOnNewDocument(
    `try{localStorage.setItem('woc_settings', ${JSON.stringify(JSON.stringify(settings))})}catch{}`,
  );
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
  const booted = await enterOfflineGame(page, { charClass: 'warrior', charName: 'Gfx' });
  if (!booted) {
    console.log(name, 'offline world did not boot');
    await page.close();
    continue;
  }
  await sleep(3000);
  await page.evaluate(
    `(()=>{const s=window.__game.sim;const me=s.entities.get(s.playerId);me.pos.x=${PX};me.pos.z=${PZ};me.pos.y+=20;me.prevPos={...me.pos};if(s.setPlayerLevel)s.setPlayerLevel(60);})()`,
  );
  await page.evaluate(
    `(()=>{const i=document.querySelector('#chat-input');i.value='/daynight ${PHASE}';i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`,
  );
  await sleep(6000);
  // Headless only paints when asked; a few discarded frames let the teleport,
  // the phase override and the terrain stream settle.
  for (let i = 0; i < 6; i++) {
    await page.screenshot({ path: `${OUT}/_frame.png` });
    await sleep(250);
  }
  await page.screenshot({ path: `${OUT}/${name}-${PHASE}.png` });
  console.log(name, PHASE, 'done');
  await page.close();
}
await browser.close();
