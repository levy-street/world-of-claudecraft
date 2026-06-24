// Proof shot for the Skyward Trials questline: opens Skymaster Vael's quest
// dialog at the Vale Skytrial rings, showing the "First Flight" offer (NPC name,
// quest title + flavour all resolved through the entity i18n catalog).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'docs/screenshots/mounts';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH, headless: 'new',
  args: ['--window-size=1100,860', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1100, height: 860 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('#btn-offline', { timeout: 15000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(200);
await page.type('#char-name', 'Aviar');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await sleep(2800);

const offered = await page.evaluate(() => {
  const g = window.__game; const p = g.sim.player;
  g.sim.setPlayerLevel(20, p.id);
  p.gm = true; p.maxHp = 99999; p.hp = 99999; p.mountTier = 11;
  let npc = null;
  for (const e of g.sim.entities.values()) if (e.templateId === 'skytrial_master') npc = e;
  if (!npc) return 'NPC NOT SPAWNED';
  p.pos.x = npc.pos.x + 2; p.pos.z = npc.pos.z; p.pos.y = npc.pos.y; p.prevPos = { ...p.pos };
  for (const e of g.sim.entities.values()) if (e.kind === 'mob') { e.hostile = false; e.aiState = 'idle'; }
  g.input.camDist = 12; g.input.camPitch = 0.35;
  g.hud.openQuestDialog(npc.id);
  return `${g.sim.questState('q_skyward_first_flight')} / ${g.sim.questState('q_skyward_time_trial')}`;
});
console.log('quest states (first/time):', offered);
await sleep(700);
await page.screenshot({ path: `${OUT}/skyward-quest.png` });
console.log(`done -> ${OUT}/skyward-quest.png`);
await browser.close();
