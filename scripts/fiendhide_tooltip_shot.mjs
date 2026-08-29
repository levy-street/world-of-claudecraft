// Before/after capture for the Fiendhide (Fiendhide/demon_skin) buff tooltip bug: the
// aura tooltip's $b splice re-resolved the ability through the VIEWER's own known
// abilities (talents included) instead of reading the actually-applied aura's value, so
// a stale or foreign talent state could show the wrong armor number.
//
// Single offline client capture (no second player needed): cast Fiendhide (rank 3,
// base armor 80) BEFORE learning Pact Deepened, then select Pact Deepened. Talent
// recompute reconciles the active aura, so the still-active buff updates from 80
// to 160 and the tooltip's prose and mechanical effect line should agree before
// and after the talent change.
//
// Usage: BROWSER_PATH=/path/to/chrome node scripts/fiendhide_tooltip_shot.mjs
// (needs `npm run dev` running on :5173)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const GAME_URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.SHOTS_DIR ?? 'docs/screenshots/fiendhide-armor-buff-tooltip';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function castDemonSkin(page) {
  return page.evaluate(async () => {
    const sim = window.__game.sim;
    const p = sim.player;
    sim.setPlayerLevel(20);
    p.hp = p.maxHp;
    p.resource = p.maxResource;
    p.gcdRemaining = 0;
    p.casting = null;
    p.inCombat = false;
    for (const ability of sim.known) p.cooldowns[ability.def.id] = 0;
    sim.castAbility('demon_skin');
    for (let i = 0; i < 40; i += 1) {
      sim.tick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return { auras: (p.auras ?? []).map((a) => ({ id: a.id, value: a.value })) };
  });
}

async function selectPactDeepened(page) {
  return page.evaluate(() => {
    const sim = window.__game.sim;
    return sim.selectTalentRow(11, 'wlk_r11_improved_life_tap');
  });
}

async function hoverBuffAndCapture(page, outFile) {
  await page.waitForSelector('#buff-bar', { visible: true, timeout: 5000 });
  const icon = await page.$('#buff-bar > *');
  if (!icon) throw new Error('no buff icon rendered');
  await icon.hover();
  await page.waitForSelector('#tooltip', { visible: true, timeout: 5000 });
  await sleep(200);
  const box = await page.$eval('#tooltip', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  await page.screenshot({
    path: outFile,
    clip: {
      x: Math.max(0, box.x - 8),
      y: Math.max(0, box.y - 8),
      width: box.width + 16,
      height: box.height + 16,
    },
  });
  return page.$eval('#tooltip', (el) => el.textContent ?? '');
}

function assertTooltipText(text, expected) {
  if (!text.includes(expected)) {
    throw new Error(`expected tooltip to include ${expected}, got: ${text}`);
  }
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: ['--use-angle=swiftshader', '--window-size=1280,800'],
    defaultViewport: { width: 1280, height: 800 },
  });
  try {
    const page = await browser.newPage();
    await page.goto(GAME_URL, { waitUntil: 'domcontentloaded' });
    await enterOfflineGame(page, { charClass: 'warlock', charName: 'Emberis' });

    const cast = await castDemonSkin(page);
    console.log('cast demon_skin:', cast);

    const beforeText = await hoverBuffAndCapture(page, `${OUT}/before-tooltip.png`);
    console.log('before:', beforeText);
    assertTooltipText(beforeText, '80');

    const sel = await selectPactDeepened(page);
    console.log('selectTalentRow Pact Deepened:', sel);
    await page.mouse.move(10, 10); // clear hover so mouseenter re-fires cleanly
    await sleep(100);

    const afterText = await hoverBuffAndCapture(page, `${OUT}/after-tooltip.png`);
    console.log('after:', afterText);
    assertTooltipText(afterText, '160');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
