// Screenshot for the Gravecaller Summoner crowd-control nerf (drop the fear/dread).
// Drives the offline world, repurposes a nearby mob into a Gravecaller Summoner in
// front of the player, lands its remaining Silencing Shriek (silence), and captures
// the "Silenced!" state plus the combat log. Also asserts the shipped summoner no
// longer carries dread and never applies a fear aura over a burst of swings, so the
// shot documents the kept kit (silence) and the removed one (fear).
// Requires `npm run dev` on :5173.
//
// Usage: node scripts/shot_summoner.mjs
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = 'http://localhost:5173/';
const OUT = 'tmp/shots';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});

let fail = 0;
const check = (name, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}`);
  if (!cond) fail++;
};

try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text());
  });
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle2' });

  // Offline flow: Play Offline -> name -> pick class -> Start. A mage so the
  // "Silenced!" spell-lockout is meaningful for the kept ability.
  await page.waitForSelector('#btn-offline', { timeout: 15000 });
  await page.evaluate(() => document.querySelector('#btn-offline').click());
  await new Promise((r) => setTimeout(r, 250));
  await page.type('#char-name', 'Hushward');
  await page.click('#offline-select .mini-class[data-class="mage"]');
  await page.click('#btn-start-offline');
  // swiftshader software rendering is slow: shader compile + the loading-screen
  // fade can take a while before main.ts sets window.__game.
  await page.waitForFunction(() => window.__game?.sim?.player, {
    timeout: 90000,
    polling: 500,
  });
  await new Promise((r) => setTimeout(r, 2000));

  // Dismiss the new-adventurer tutorial overlay so it does not cover the scene.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      /skip tutorial/i.test(b.textContent || ''),
    );
    btn?.click();
  });
  await new Promise((r) => setTimeout(r, 400));

  // Stage the scene: god-mode the player, repurpose a mob into a Gravecaller
  // Summoner two yards in front, pin its silence to land, clear any fear.
  await page.evaluate(() => {
    const sim = window.__game.sim;
    const p = sim.player;
    p.maxHp = 1_000_000;
    p.hp = p.maxHp;
    const mobs = [...sim.entities.values()].filter((e) => e.kind === 'mob' && !e.dead);
    const fx = p.pos.x + Math.sin(p.facing) * 6;
    const fz = p.pos.z + Math.cos(p.facing) * 6;
    const summoner = mobs[0];
    window.__summoner = summoner.id;
    summoner.templateId = 'gravecaller_summoner';
    summoner.name = 'Gravecaller Summoner';
    Object.assign(summoner.pos, sim.groundPos(fx, fz));
    summoner.prevPos = { ...summoner.pos };
    summoner.hostile = true;
    summoner.level = 12;
    // Face the player so the model is front-on to the camera.
    summoner.facing = Math.atan2(p.pos.x - summoner.pos.x, p.pos.z - summoner.pos.z);
  });

  // Swing the summoner at the player 40 times: its 30% Silencing Shriek lands with
  // overwhelming probability (~1 - 0.7^40). Track whether any fear aura ever appears
  // (it must not). A silence aura is guaranteed visible for the screenshot below.
  const result = await page.evaluate(() => {
    const sim = window.__game.sim;
    const p = sim.player;
    const summoner = sim.entities.get(window.__summoner);
    let silenced = false;
    let feared = false;
    for (let i = 0; i < 40; i++) {
      p.hp = p.maxHp;
      sim.mobSwing(summoner, p);
      silenced = silenced || p.auras.some((a) => a.kind === 'silence');
      feared = feared || p.auras.some((a) => a.id === 'fear_incap');
    }
    // Keep a silence aura live for the screenshot.
    if (!p.auras.some((a) => a.kind === 'silence')) {
      p.auras.push({
        id: 'silence_gravecaller_summoner',
        name: 'Silencing Shriek',
        kind: 'silence',
        remaining: 4,
        duration: 4,
        value: 0,
        sourceId: summoner.id,
        school: 'shadow',
      });
    }
    return { silenced, feared };
  });
  check('summoner lands its Silencing Shriek (silence kept)', result.silenced === true);
  check('summoner never applies a fear aura (dread removed)', result.feared === false);

  await new Promise((r) => setTimeout(r, 200));
  await page.screenshot({ path: `${OUT}/summoner-silence.png` });
  console.log('saved summoner-silence.png (full scene, player silenced by the summoner)');

  await page.screenshot({
    path: `${OUT}/summoner-silence-actors.png`,
    clip: { x: 430, y: 90, width: 470, height: 360 },
  });
  console.log('saved summoner-silence-actors.png (close-up)');

  await page.screenshot({
    path: `${OUT}/summoner-silence-log.png`,
    clip: { x: 8, y: 470, width: 560, height: 250 },
  });
  console.log('saved summoner-silence-log.png (combat log)');
} finally {
  await browser.close();
}
process.exit(fail > 0 ? 1 : 0);
