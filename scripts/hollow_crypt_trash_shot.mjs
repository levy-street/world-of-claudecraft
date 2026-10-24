// Screenshots of the Hollow Crypt trash in a live offline world: each pack in
// place, the gargoyles perched, the drake in flight, and the telegraphs (the
// Grave Cleave cone, the Barrowflame Breath, the Tail Lash, the shriek ring, the
// Raise Bones sigil, a Bone Burst). Evidence tooling, not a repo test.
//
//   node scripts/hollow_crypt_trash_shot.mjs [outDir] [shotId ...]
//
// Env: SHOT_URL (http://127.0.0.1:5198/), SHOT_W / SHOT_H (1600x900).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5198/';
const OUT = process.argv[2] ?? path.join('tmp', 'hollow_crypt_trash');
const ONLY = process.argv.slice(3);
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// kind 'pack': jump to a pack and frame it; 'spawn': raise one mob ahead and
// wait for `cast` to be on its bar (or `seconds`), then shoot.
export const SHOTS = [
  { id: 'grupo_c1_gargola', kind: 'pack', pack: 'c1', pitch: 0.2, dist: 16, yaw: 0.5 },
  { id: 'grupo_c3_arcada', kind: 'pack', pack: 'c3', pitch: 0.28, dist: 18, yaw: -0.7 },
  { id: 'grupo_c4_reja', kind: 'pack', pack: 'c4', pitch: 0.25, dist: 18, yaw: 0 },
  { id: 'dragon_en_vuelo', kind: 'sky', pitch: -0.12, dist: 6, yaw: 0, wait: 6000 },
  { id: 'grupo_w1_cuervos', kind: 'pack', pack: 'w1', pitch: 0.25, dist: 14, yaw: 0.4 },
  { id: 'bandada_patrulla', kind: 'pack', pack: 'w2', pitch: 0.12, dist: 18, yaw: 0, wait: 2500 },
  { id: 'grupo_q1_coro', kind: 'pack', pack: 'q1', pitch: 0.25, dist: 16, yaw: 0 },
  { id: 'grupo_s1_rellano', kind: 'pack', pack: 's1', pitch: 0.25, dist: 16, yaw: -0.4 },
  {
    id: 'tajo_frontal',
    kind: 'spawn',
    mob: 'warrior',
    cast: 'crypt_grave_cleave',
    pitch: 0.55,
    dist: 16,
  },
  {
    id: 'nigromante_alzar',
    kind: 'spawn',
    mob: 'necromancer',
    cast: 'crypt_raise_bones',
    pitch: 0.45,
    dist: 16,
  },
  {
    id: 'gargola_chillido',
    kind: 'spawn',
    mob: 'gargoyle',
    cast: 'crypt_stone_shriek',
    pitch: 0.5,
    dist: 20,
  },
  {
    id: 'gargola_picado',
    kind: 'spawn',
    mob: 'gargoyle',
    seconds: 0.4,
    pitch: 0.05,
    dist: 12,
    yaw: 2.6,
  },
  {
    id: 'dragon_aterriza',
    kind: 'spawn',
    mob: 'drake',
    seconds: 0.8,
    pitch: -0.1,
    dist: 20,
    yaw: 2.6,
  },
  {
    id: 'dragon_aliento',
    kind: 'spawn',
    mob: 'drake',
    cast: 'crypt_barrowflame_breath',
    pitch: 0.45,
    dist: 26,
  },
  {
    id: 'dragon_rafaga_alas',
    kind: 'spawn',
    mob: 'drake',
    cast: 'crypt_tail_lash',
    pitch: 0.5,
    dist: 26,
  },
  {
    id: 'cuervos_llamada',
    kind: 'spawn',
    mob: 'caller',
    cast: 'crypt_murder_call',
    pitch: 0.35,
    dist: 14,
  },
  { id: 'esbirro_estallido', kind: 'burst', pitch: 0.5, dist: 14 },
  {
    id: 'retrato_gargola',
    kind: 'spawn',
    mob: 'gargoyle',
    seconds: 2.5,
    pitch: 0.1,
    dist: 7,
    yaw: 2.5,
  },
  {
    id: 'retrato_cuervo',
    kind: 'spawn',
    mob: 'crow',
    seconds: 2.5,
    pitch: 0.05,
    dist: 4.5,
    yaw: 2.5,
  },
  {
    id: 'retrato_dragon',
    kind: 'spawn',
    mob: 'drake',
    seconds: 4,
    pitch: 0.14,
    dist: 17,
    yaw: 2.3,
  },
];

async function main() {
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: [`--window-size=${W},${H}`, '--use-angle=d3d11', '--ignore-gpu-blocklist'],
    defaultViewport: { width: W, height: H },
    protocolTimeout: 240000,
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
    await page.evaluateOnNewDocument(() => {
      try {
        localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 4 }));
      } catch {
        /* ignore */
      }
    });
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 120000 });
    const booted = await enterOfflineGame(page, {
      charClass: 'warrior',
      charName: 'Cryptwalker',
      gameBootTimeoutMs: 120000,
      selectorTimeoutMs: 60000,
      settleMs: 4000,
    });
    if (!booted) throw new Error('offline world did not boot');
    const chat = async (c) => {
      await page.evaluate((line) => window.__game.world.chat(line), c);
      await sleep(1300);
    };
    for (const c of ['/dev level 10', '/dev god', '/dev crypt enter']) await chat(c);
    await page.waitForFunction(
      () => {
        let found = false;
        window.__game.renderer.scene.traverse((o) => {
          if (o.name === 'hollowCryptField') found = true;
        });
        return found;
      },
      { timeout: 120000, polling: 1000 },
    );
    await sleep(5000);
    await page.addStyleTag({ content: '#ui { display: none !important; }' });
    const frame = async (s) =>
      page.evaluate((shot) => {
        const input = window.__game.input;
        input.camYaw = shot.yaw ?? 0;
        input.camPitch = shot.pitch;
        input.camDist = shot.dist;
      }, s);
    let noAggro = false;
    const setNoAggro = async (on) => {
      if (noAggro === on) return;
      await chat('/dev noaggro');
      noAggro = on;
    };
    for (const shot of SHOTS) {
      if (ONLY.length && !ONLY.includes(shot.id)) continue;
      await setNoAggro(shot.kind === 'pack' || shot.kind === 'sky');
      if (shot.kind === 'pack') {
        await chat(`/dev crypt pack ${shot.pack}`);
        // Face the pack.
        await page.evaluate((packId) => {
          const w = window.__game.world;
          const p = w.player;
          let best = null;
          for (const e of w.entities.values()) {
            if (e.kind !== 'mob' || e.dead) continue;
            const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
            if (d < 30 && (!best || d < best.d)) best = { e, d };
          }
          if (best) {
            p.facing = Math.atan2(best.e.pos.x - p.pos.x, best.e.pos.z - p.pos.z);
            p.prevFacing = p.facing;
          }
          void packId;
        }, shot.pack);
        await frame(shot);
        await sleep(shot.wait ?? 2200);
      } else if (shot.kind === 'sky') {
        // From the Grille, looking up the Processional at the drake on the wing.
        await chat('/dev crypt tp grille');
        await sleep(shot.wait ?? 2000);
        await page.evaluate(() => {
          const w = window.__game.world;
          const p = w.player;
          for (const e of w.entities.values()) {
            if (e.templateId !== 'crypt_ossuary_drake' || e.dead) continue;
            p.facing = Math.atan2(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
            p.prevFacing = p.facing;
          }
        });
        await frame(shot);
        await sleep(400);
      } else if (shot.kind === 'burst') {
        await chat('/dev crypt tp cloister');
        await chat('/dev crypt spawn minion');
        await frame(shot);
        await sleep(600);
        await page.evaluate(() => {
          const w = window.__game.world;
          for (const e of w.entities.values()) {
            if (e.templateId === 'crypt_bone_minion' && !e.dead) w.ctx.handleDeath(e, w.player);
          }
        });
        await sleep(700);
      } else {
        await chat('/dev crypt tp cloister');
        await chat(`/dev crypt spawn ${shot.mob}`);
        await frame(shot);
        if (shot.cast) {
          await page
            .waitForFunction(
              (cast) => {
                for (const e of window.__game.world.entities.values())
                  if (
                    e.castingAbility === cast &&
                    e.castTotal > 0 &&
                    e.castRemaining < e.castTotal * 0.5
                  )
                    return true;
                return false;
              },
              { timeout: 40000, polling: 50 },
              shot.cast,
            )
            .catch(() => console.log('NO CAST', shot.id));
        } else {
          await sleep((shot.seconds ?? 1) * 1000);
        }
      }
      // Re-aim just before the shot (combat turns the camera behind the player).
      await frame(shot);
      await sleep(150);
      const file = path.join(OUT, `pasada2_${shot.id}.png`);
      await page.screenshot({ path: file });
      console.log('SHOT', file);
      if (shot.kind !== 'pack') await chat('/dev crypt reset');
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
