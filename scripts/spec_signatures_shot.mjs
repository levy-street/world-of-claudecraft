// Live-client screenshots for the "spec update" pass: the impactful spec masteries
// (Talents window), a reworked signature tooltip, and the new shapeshift visuals
// (Moonkin Form violet tint, Metamorphosis demon). Drives the REAL offline client.
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
  // Skip the intro cinematic so the HUD (#ui) becomes visible; without this every
  // window lays out at 0x0 inside the still-hidden shell.
  await page.keyboard.press('Escape');
  await sleep(700);
  return page;
}

// Pull the camera in close on the player so a shapeshift visual fills the frame.
async function zoomIn(page, dist = 7) {
  await page.evaluate((d) => {
    const c = window.__game.controller;
    if (c && 'camDist' in c) c.camDist = d;
  }, dist);
  await sleep(600);
}

const results = [];

// Scene 1: the Talents & Specializations window for a Frost mage, showing the
// retuned mastery ("+25% spell damage") and the spec picker.
{
  const page = await enterGame('mage', 'Frostcaller');
  const ok = await page.evaluate(() => {
    const sim = window.__game.sim;
    sim.setSpec('frost');
    window.__game.hud.toggleTalents();
    // Switch to the Specialization tab so the retuned Frost mastery (+25% spell damage) shows.
    const specTab = [...document.querySelectorAll('#talents-window .tal-tab')].find((t) =>
      /Specialization/i.test(t.textContent || ''),
    );
    specTab?.click();
    const w = document.querySelector('#talents-window');
    return !!w && getComputedStyle(w).display !== 'none';
  });
  await sleep(900);
  await page.screenshot({ path: `${OUT}/spec-mastery-frost.png` });
  results.push(`spec-mastery-frost.png (panel=${ok})`);
  await page.close();
}

// Scene 2: a reworked signature tooltip (Metamorphosis) in the spellbook.
{
  const page = await enterGame('warlock', 'Feldemon');
  const info = await page.evaluate(() => {
    const sim = window.__game.sim;
    sim.setSpec('demonology');
    window.__game.hud.toggleSpellbook();
    const w = document.querySelector('#spellbook');
    return { spellbook: !!w && getComputedStyle(w).display !== 'none' };
  });
  await sleep(800);
  // hover the metamorphosis entry if present
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('[data-ability-id], .spellbook-entry, .ability')].find(
      (n) => /metamorph/i.test(n.getAttribute('data-ability-id') || n.textContent || ''),
    );
    if (el) {
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    }
  });
  await sleep(700);
  await page.screenshot({ path: `${OUT}/signature-spellbook-warlock.png` });
  results.push(`signature-spellbook-warlock.png (spellbook=${info.spellbook})`);
  await page.close();
}

// Scene 3: Moonkin Form visual (violet tint on the druid).
{
  const page = await enterGame('druid', 'Owlbeast');
  const cast = await page.evaluate(() => {
    const sim = window.__game.sim;
    sim.setSpec('balance');
    const me = sim.player;
    me.resource = me.maxResource;
    me.gcdRemaining = 0;
    sim.castAbility('moonkin_form');
    return me.auras.some((a) => a.kind === 'form_moonkin');
  });
  await zoomIn(page, 7);
  await sleep(3500); // let the star-mote aura accumulate particles
  await page.screenshot({ path: `${OUT}/moonkin-form-visual.png` });
  results.push(`moonkin-form-visual.png (inForm=${cast})`);
  await page.close();
}

// Scene 4: Metamorphosis visual (bigger, dark fel demon).
{
  const page = await enterGame('warlock', 'Fellord');
  const cast = await page.evaluate(() => {
    const sim = window.__game.sim;
    sim.setSpec('demonology');
    const me = sim.player;
    me.resource = me.maxResource;
    me.gcdRemaining = 0;
    sim.castAbility('metamorphosis');
    return {
      inForm: me.auras.some((a) => a.kind === 'form_metamorph'),
      scale: Math.round((me.scale ?? 1) * 100) / 100,
    };
  });
  await zoomIn(page, 8);
  await sleep(3500); // let the fire aura accumulate particles
  await page.screenshot({ path: `${OUT}/metamorphosis-visual.png` });
  results.push(`metamorphosis-visual.png (inForm=${cast.inForm}, scale=${cast.scale})`);
  await page.close();
}

// Scene 5: Shadowform visual (Vesper Form: gloom tint + shadow wisp aura).
{
  const page = await enterGame('priest', 'Gloamys');
  const cast = await page.evaluate(() => {
    const sim = window.__game.sim;
    sim.setSpec('shadow');
    const me = sim.player;
    me.resource = me.maxResource;
    me.gcdRemaining = 0;
    sim.castAbility('shadowform');
    return me.auras.some((a) => a.kind === 'form_shadow');
  });
  await zoomIn(page, 7);
  await sleep(3500); // let the continuous wisp aura accumulate particles
  await page.screenshot({ path: `${OUT}/shadowform-visual.png` });
  results.push(`shadowform-visual.png (inForm=${cast})`);
  await page.close();
}

await browser.close();
for (const r of results) console.log('shot:', r);
console.log('done; shots in', OUT);
