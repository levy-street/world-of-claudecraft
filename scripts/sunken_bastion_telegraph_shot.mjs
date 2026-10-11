// Evidence shots of the shared dungeon floor telegraphs in the Sunken Bastion:
// boots an offline world on an already-running dev server, clears the Bastion,
// raises a watchman (Halberd Sweep cone), an arbalest (Piercing Bolt lane), a
// Mist Chanter (Fog Ward kick glyph), the Hermit (Shell Slam ring) and a dead
// crawler (Brine Burst fuse) on the Lower Bailey, holds each cast at a chosen
// fill of its bar, and frames them from above. Evidence tooling, not a test.
//
//   node scripts/sunken_bastion_telegraph_shot.mjs [outDir]
//
// Env: SHOT_URL (http://127.0.0.1:5199/), SHOT_PRESET (4; 0 is the low tier),
// SHOT_PREFIX (default "telegrafos_"), SHOT_FILLS ("0.35,0.9").
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5199/';
const OUT = process.argv[2] ?? path.join('tmp', 'sunken_bastion_telegraphs');
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const PREFIX = process.env.SHOT_PREFIX ?? 'telegrafos_';
const FILLS = (process.env.SHOT_FILLS ?? '0.35,0.9').split(',').map(Number);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// [spawn type, instance-local offset from the player, facing, cast id, cast seconds]
const STAGE = [
  ['watchman', [-9, 8], Math.PI * 0.85, 'bastion_halberd_sweep', 1.5],
  ['arbalest', [10, 4], -Math.PI / 2 - 0.3, 'bastion_piercing_bolt', 2],
  ['mistweaver', [0, 16], Math.PI, 'bastion_fog_ward', 2],
  ['hermit', [16, 22], Math.PI, 'bastion_shell_slam', 1.5],
  ['crawler', [-6, -4], 0, null, 0],
];

async function main() {
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: ['--window-size=1600,900', '--use-angle=d3d11', '--ignore-gpu-blocklist'],
    defaultViewport: { width: 1600, height: 900 },
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
    if (
      !(await enterOfflineGame(page, {
        charClass: 'warrior',
        charName: 'Tidewalker',
        gameBootTimeoutMs: 180000,
        selectorTimeoutMs: 90000,
        settleMs: 4000,
      }))
    )
      throw new Error('offline world did not boot');
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
    await sleep(6000);
    await page.addStyleTag({ content: '#ui, #nameplates { display: none !important; }' });
    await page.evaluate(() => {
      const p = window.__game.world.player;
      p.facing = 0;
      p.prevFacing = 0;
      p.devNoAggro = true;
      for (const e of window.__game.world.entities.values()) {
        if (e.kind === 'mob') {
          e.pos.x += 400;
          e.prevPos = { ...e.pos };
        }
      }
    });
    for (const [type] of STAGE) {
      await page.evaluate((t) => window.__game.world.chat(`/dev bastion spawn ${t}`), type);
      await sleep(250);
    }
    for (const fill of FILLS) {
      // Hold every actor on its mark, its cast at `fill` of the bar.
      await page.evaluate(
        ([stage, fill]) => {
          const sim = window.__game.world;
          const me = sim.player;
          clearInterval(window.__telegraphHold);
          const live = [...sim.entities.values()].filter(
            (e) => e.kind === 'mob' && Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z) < 60,
          );
          const byType = {
            watchman: 'drowned_watchman',
            arbalest: 'fogbound_arbalest',
            mistweaver: 'mistweaver',
            hermit: 'turretback_hermit',
            crawler: 'barnacle_crawler',
          };
          const hold = () => {
            for (const [type, [dx, dz], facing, cast, total] of stage) {
              const mob = live.find((e) => e.templateId === byType[type]);
              if (!mob) continue;
              mob.pos.x = me.pos.x + dx;
              mob.pos.z = me.pos.z + dz;
              mob.prevPos = { ...mob.pos };
              mob.facing = facing;
              mob.prevFacing = facing;
              mob.aggroTargetId = null;
              if (cast) {
                mob.castingAbility = cast;
                mob.castTotal = total;
                mob.castRemaining = total * (1 - fill);
              } else if (!mob.dead) {
                mob.hp = 0;
                sim.ctx?.handleDeath?.(mob, me);
              }
            }
          };
          hold();
          window.__telegraphHold = setInterval(hold, 10);
        },
        [STAGE, fill],
      );
      await page.evaluate(() => {
        const input = window.__game.input;
        input.camYaw = 0.35;
        input.camPitch = 0.72;
        input.camDist = 30;
      });
      await sleep(1200);
      const file = path.join(OUT, `${PREFIX}${Math.round(fill * 100)}.png`);
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
