// Live-client screenshots for the spec identity pass (PR B): the Specialization tab
// showing four redesigned masteries (Discipline absorb, Combat attack-speed tradeoff,
// Affliction DoT, Restoration druid HoT). Drives the REAL offline client.
// Needs `npm run dev` (GAME_URL overrides the port). Shots land in docs/screenshots/.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'docs/screenshots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});

const jsClick = (page, sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);

async function enterGame(cls, name) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 180000 });
  await page.waitForSelector('#btn-offline', { timeout: 60000 });
  await jsClick(page, '#btn-offline');
  await sleep(400);
  await page.waitForSelector('#char-name', { timeout: 30000 });
  await page.type('#char-name', name);
  await jsClick(page, `#offline-select .mini-class[data-class="${cls}"]`);
  await sleep(300);
  await jsClick(page, '#btn-start-offline');
  await page.bringToFront();
  await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 60000 });
  await sleep(1500);
  await page.evaluate(() => {
    window.__game.sim.setPlayerLevel(20);
    document.querySelector('#tutorial-hint .btn, #tutorial-hint button')?.click();
  });
  // Skip the intro cinematic so the HUD (#ui) becomes visible.
  await page.keyboard.press('Escape');
  await sleep(700);
  return page;
}

async function masteryPanelShot(cls, charName, spec, outName) {
  const page = await enterGame(cls, charName);
  const ok = await page.evaluate((specId) => {
    const sim = window.__game.sim;
    sim.setSpec(specId);
    window.__game.hud.toggleTalents();
    const specTab = [...document.querySelectorAll('#talents-window .tal-tab')].find((t) =>
      /Specialization/i.test(t.textContent || ''),
    );
    specTab?.click();
    const w = document.querySelector('#talents-window');
    return !!w && getComputedStyle(w).display !== 'none';
  }, spec);
  await sleep(900);
  await page.screenshot({ path: `${OUT}/${outName}` });
  await page.close();
  return `${outName} (panel=${ok})`;
}

const results = [];
results.push(
  await masteryPanelShot('priest', 'Wardkeeper', 'discipline', 'spec-mastery-discipline.png'),
);
results.push(await masteryPanelShot('rogue', 'Scrapfighter', 'combat', 'spec-mastery-combat.png'));
results.push(
  await masteryPanelShot('warlock', 'Rotweaver', 'affliction', 'spec-mastery-affliction.png'),
);
results.push(
  await masteryPanelShot('druid', 'Groveheart', 'restoration', 'spec-mastery-resto-druid.png'),
);

await browser.close();
for (const r of results) console.log('shot:', r);
console.log('done; shots in', OUT);
