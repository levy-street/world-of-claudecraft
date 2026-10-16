// Close-up evidence shots of the Sunken Bastion's creatures next to the
// player: boots an offline world on an already-running dev server, enters the
// Bastion, clears it, then raises each creature (/dev bastion spawn) on the
// Lower Bailey paving and frames it beside the player. Evidence tooling, not a
// repo test.
//
//   node scripts/sunken_bastion_creature_shot.mjs [outDir] [type ...]
//
// Env: SHOT_URL (http://127.0.0.1:5199/), SHOT_PRESET (4), SHOT_W / SHOT_H
// (1600x900), SHOT_PREFIX (default "criatura_"), SHOT_WAIT (ms after the
// spawn, default 2600), SHOT_PULL=1 to let the creature engage (its attacks).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5199/';
const OUT = process.argv[2] ?? path.join('tmp', 'sunken_bastion_creatures');
const ONLY = process.argv.slice(3);
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const PREFIX = process.env.SHOT_PREFIX ?? 'criatura_';
const WAIT = Number(process.env.SHOT_WAIT ?? 2600);
const PULL = process.env.SHOT_PULL === '1';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TYPES = [
  'crawler',
  'warhound',
  'revenant',
  'watchman',
  'arbalest',
  'sergeant',
  'prisoner',
  'mistweaver',
];

async function main() {
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: [
      `--window-size=${W},${H}`,
      '--use-angle=d3d11',
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
    ],
    defaultViewport: { width: W, height: H },
    protocolTimeout: 240000,
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
    await page.evaluateOnNewDocument((preset) => {
      try {
        localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: preset }));
      } catch {
        /* ignore */
      }
    }, PRESET);
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 180000 });
    const booted = await enterOfflineGame(page, {
      charClass: 'warrior',
      charName: 'Tidewalker',
      gameBootTimeoutMs: 180000,
      selectorTimeoutMs: 90000,
      settleMs: 4000,
    });
    if (!booted) throw new Error('offline world did not boot');
    for (const cmd of [
      '/dev level 20',
      '/dev god',
      '/dev bastion enter',
      '/dev bastion gates',
      '/dev bastion kill all',
      '/dev bastion tp cisternyard',
    ]) {
      await page.evaluate((c) => window.__game.world.chat(c), cmd);
      await sleep(1300);
    }
    await page.waitForFunction(
      () => {
        let found = false;
        window.__game.renderer.scene.traverse((o) => {
          if (o.name === 'sunkenBastionField') found = true;
        });
        return found;
      },
      { timeout: 180000, polling: 1000 },
    );
    await sleep(5000);
    await page.addStyleTag({ content: '#ui, #nameplates { display: none !important; }' });
    for (const type of TYPES) {
      if (ONLY.length && !ONLY.includes(type)) continue;
      // Clear the stage: every earlier creature (and corpse) goes far away.
      await page.evaluate(() => {
        for (const e of window.__game.world.entities.values()) {
          if (e.kind !== 'mob') continue;
          e.pos.x += 400;
          e.prevPos = { ...e.pos };
          e.hp = 0;
        }
      });
      await sleep(600);
      await page.evaluate(() => {
        const p = window.__game.world.player;
        p.facing = 0;
        p.prevFacing = 0;
      });
      await page.evaluate((t) => window.__game.world.chat(`/dev bastion spawn ${t}`), type);
      await sleep(300);
      // Hold the creature 7 yd ahead, idle unless the shot wants it engaged.
      await page.evaluate((pull) => {
        const sim = window.__game.world;
        const me = sim.player;
        let mob = null;
        for (const e of sim.entities.values()) {
          if (e.kind === 'mob' && !e.dead && e.hp > 0) mob = e;
        }
        if (!mob) return;
        if (!pull) {
          mob.pos.x = me.pos.x + 1.5;
          mob.pos.z = me.pos.z + 7;
          mob.prevPos = { ...mob.pos };
          mob.aggroTargetId = null;
          mob.threat?.clear?.();
          mob.aiState = 'idle';
          mob.facing = Math.PI + 0.5;
          mob.prevFacing = mob.facing;
          me.devNoAggro = true;
        }
      }, PULL);
      await page.evaluate(
        ([yaw, dist]) => {
          const input = window.__game.input;
          input.camYaw = yaw;
          input.camPitch = 0.2;
          input.camDist = dist;
        },
        [Number(process.env.SHOT_YAW ?? 0.55), Number(process.env.SHOT_DIST ?? 12)],
      );
      await sleep(WAIT);
      const file = path.join(OUT, `${PREFIX}${type}.png`);
      await page.screenshot({ path: file });
      console.log('SHOT', file);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
