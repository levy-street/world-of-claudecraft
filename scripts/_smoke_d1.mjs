// D1 offline smoke: boots the offline world, teleports to the mainland dock
// and Gullhaven, and screenshots both. Proves the relocated island boots and
// renders in a real browser. Needs `npm run dev`. Writes PNGs to tmp/.
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.URL || 'http://localhost:5173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ` :: ${extra}` : ''}`);
  if (!cond) fail++;
};

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.setViewport({ width: 1440, height: 810 });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  const booted = await enterOfflineGame(page, { charName: 'Bellwatch', settleMs: 4000 });
  check('offline world booted', booted);
  const run = (cmd) => page.evaluate((c) => window.__game.sim.chat(c), cmd);
  await run('/dev level 5');
  await run('/dev tp the_farshore_causeway');
  await sleep(4500);
  const dockPos = await page.evaluate(() => ({ ...window.__game.sim.player.pos }));
  check('at mainland dock', Math.abs(dockPos.x - 152) < 6 && Math.abs(dockPos.z + 48) < 6, JSON.stringify(dockPos));
  await page.screenshot({ path: 'tmp/d1_mainland_dock.png' });
  await run('/dev tp gullhaven');
  await sleep(5000);
  const townPos = await page.evaluate(() => ({ ...window.__game.sim.player.pos }));
  check('at gullhaven', Math.abs(townPos.x - 822) < 6 && Math.abs(townPos.z - 118) < 6, JSON.stringify(townPos));
  await page.screenshot({ path: 'tmp/d1_gullhaven.png' });
  await run('/dev tp the_breach');
  await sleep(4500);
  await page.screenshot({ path: 'tmp/d1_breach.png' });
  check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}
process.exit(fail ? 1 : 0);
