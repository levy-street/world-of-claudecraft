// Screenshot proof for Talents 2.0 caster form render tints.
// Boots fresh offline clients, casts the real form abilities, asserts the aura,
// and captures the resulting character view. Needs a running Vite client.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: [
    '--window-size=1400,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ],
  defaultViewport: { width: 1400, height: 900 },
});

async function click(page, selector) {
  await page.evaluate((s) => document.querySelector(s)?.click(), selector);
}

async function dismissTutorial(page) {
  await page.evaluate(() => {
    for (const button of document.querySelectorAll('button')) {
      if (/skip/i.test(button.textContent || '')) {
        button.click();
        return;
      }
    }
  });
}

async function bootOffline({ playerName, playerClass }) {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
    console.log('PAGEERROR:', err.message);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      pageErrors.push(msg.text());
      console.log('CONSOLE:', msg.text());
    }
  });
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('#btn-offline', { timeout: 30000 });
  await click(page, '#btn-offline');
  await sleep(300);
  await page.waitForSelector('#char-name', { timeout: 30000 });
  await page.type('#char-name', playerName);
  await click(page, `#offline-select .mini-class[data-class="${playerClass}"]`);
  await click(page, '#btn-start-offline');
  await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 60000 });
  await dismissTutorial(page);
  await sleep(1000);
  return { page, pageErrors };
}

async function captureForm(scene) {
  const { page, pageErrors } = await bootOffline(scene);
  await page.evaluate(({ spec, ability }) => {
    const g = window.__game;
    const sim = g.sim;
    const player = sim.player;
    sim.setPlayerLevel(20, player.id);
    if (!sim.setSpec(spec, player.id)) throw new Error(`setSpec failed: ${spec}`);
    player.resource = player.maxResource;
    player.gcdRemaining = 0;
    player.cooldowns.clear();
    if (g.input) {
      g.input.camDist = 6;
      g.input.camPitch = 0.24;
      g.input.recenterCameraBehind?.(player.facing);
    }
    if (g.renderer) {
      g.renderer.camDist = 6;
      g.renderer.camPitch = 0.24;
    }
    sim.castAbility(ability, player.id);
  }, scene);
  await page.waitForFunction(
    (kind) => window.__game.sim.player.auras.some((a) => a.kind === kind),
    { timeout: 5000 },
    scene.auraKind,
  );
  await sleep(800);
  const result = await page.evaluate((kind) => {
    const player = window.__game.sim.player;
    return {
      auraPresent: player.auras.some((a) => a.kind === kind),
      activeAuras: player.auras.map((a) => ({ id: a.id, kind: a.kind })),
      resource: player.resource,
      maxResource: player.maxResource,
    };
  }, scene.auraKind);
  if (!result.auraPresent) throw new Error(`${scene.label}: missing ${scene.auraKind}`);
  if (pageErrors.length > 0)
    throw new Error(`${scene.label}: page errors: ${pageErrors.join(' | ')}`);
  await page.screenshot({ path: scene.path });
  await page.close();
  console.log(`${scene.label}: aura ${scene.auraKind} present, wrote ${scene.path}`);
  return result;
}

try {
  const shadow = await captureForm({
    label: 'Shadowform',
    playerName: 'Shade',
    playerClass: 'priest',
    spec: 'shadow',
    ability: 'shadowform',
    auraKind: 'form_shadow',
    path: 'tmp/pr3_shadowform_purple_tint.png',
  });
  const moonkin = await captureForm({
    label: 'Moonkin Form',
    playerName: 'Moon',
    playerClass: 'druid',
    spec: 'balance',
    ability: 'moonkin_form',
    auraKind: 'form_moonkin',
    path: 'tmp/pr3_moonkin_translucent.png',
  });
  console.log('scene results:', JSON.stringify({ shadow, moonkin }));
} finally {
  await browser.close();
}
