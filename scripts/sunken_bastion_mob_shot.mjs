// In-game evidence of one Sunken Bastion trash creature beside the player: boots
// an offline world on an already-running dev server, enters the Sunken Bastion,
// clears it and raises one creature (/dev bastion spawn <type>) on the Cistern
// Yard paving, then captures it idle (from the normal MMO camera, close, face on
// and from the side), walking up to the player, swinging, struck, and dying.
// Evidence tooling, not a repo test.
//
//   node scripts/sunken_bastion_mob_shot.mjs <type> [outDir] [prefix]
//
// <type> is a /dev bastion spawn name (revenant, warhound, watchman, ...), or
// boss:<templateId> (knight_commander_olen, gaoler_ossick) to bring that boss
// of the instance over instead of raising a trash mob.
//
// Env: SHOT_URL (http://127.0.0.1:5241/), SHOT_PRESET (4), SHOT_W / SHOT_H
// (1600x900), SHOT_ONLY (comma list of shot names), SHOT_TP (the /dev bastion
// tp place, cisternyard; a boss leashed to its arena needs its own, e.g. olen),
// SHOT_TRIGGER (a /dev bastion trigger mechanic: the `cast` shot catches it
// SHOT_CAST_MS into its bar (a comma list of times shoots each); a comma list of
// mechanics shoots cast_<mechanic> for each),
// SHOT_FIGHT_DIST (16: how far off the fighting shots raise the body).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5241/';
const TYPE = process.argv[2] ?? 'revenant';
const OUT = process.argv[3] ?? path.join('tmp', `bastion_${TYPE}`);
const PREFIX = process.argv[4] ?? '';
const DIST = Number(process.env.SHOT_DIST ?? 7);
const CAM_K = Number(process.env.SHOT_CAM_K ?? 1);
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const ONLY = (process.env.SHOT_ONLY ?? '').split(',').filter(Boolean);
const BOSS = TYPE.startsWith('boss:') ? TYPE.slice(5) : null;
const TP = process.env.SHOT_TP ?? 'cisternyard';
const TRIGGERS = (process.env.SHOT_TRIGGER ?? '').split(',').filter(Boolean);
const CAST_MS = (process.env.SHOT_CAST_MS ?? '1200').split(',').map(Number);
const FIGHT_DIST = Number(process.env.SHOT_FIGHT_DIST ?? 16);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const want = (name) => !ONLY.length || ONLY.includes(name);

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
    const chat = (c) => page.evaluate((cmd) => window.__game.world.chat(cmd), c);
    for (const cmd of [
      '/dev level 20',
      '/dev god',
      '/dev bastion enter',
      '/dev bastion gates',
      '/dev bastion kill all',
      `/dev bastion tp ${TP}`,
    ]) {
      await chat(cmd);
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
    const camera = (yaw, pitch, dist) =>
      page.evaluate(
        ([y, p, d, k]) => {
          const input = window.__game.input;
          input.camYaw = y;
          input.camPitch = p;
          input.camDist = d * k;
        },
        [yaw, pitch, dist, CAM_K],
      );
    const shot = async (name) => {
      const file = path.join(OUT, `${PREFIX}${name}.png`);
      await page.screenshot({ path: file });
      console.log('SHOT', file);
    };
    const clear = () =>
      page.evaluate((boss) => {
        for (const e of window.__game.world.entities.values()) {
          if (e.kind !== 'mob') continue;
          if (boss && e.templateId === boss) {
            e.dead = false;
            e.hp = e.maxHp;
            continue;
          }
          e.pos.x += 400;
          e.prevPos = { ...e.pos };
          e.hp = 0;
        }
      }, BOSS);
    const spawn = async (dist, pull) => {
      await clear();
      await sleep(500);
      await page.evaluate(() => {
        const p = window.__game.world.player;
        p.facing = 0;
        p.prevFacing = 0;
        p.devNoAggro = false;
      });
      if (!BOSS) await chat(`/dev bastion spawn ${TYPE}`);
      await sleep(300);
      return page.evaluate(
        ([d, pl, boss]) => {
          const sim = window.__game.world;
          const me = sim.player;
          let mob = null;
          for (const e of sim.entities.values()) {
            if (e.kind === 'mob' && !e.dead && e.hp > 0 && (!boss || e.templateId === boss))
              mob = e;
          }
          if (!mob) return -1;
          mob.pos.x = me.pos.x + 1.0;
          mob.pos.z = me.pos.z + d;
          mob.prevPos = { ...mob.pos };
          mob.facing = Math.atan2(me.pos.x - mob.pos.x, me.pos.z - mob.pos.z);
          mob.prevFacing = mob.facing;
          if (!pl) {
            mob.aggroTargetId = null;
            mob.threat?.clear?.();
            mob.aiState = 'idle';
            me.devNoAggro = true;
          }
          me.targetId = mob.id;
          // A boss is not pulled by a spawn: a first blow engages it.
          if (pl && boss) {
            sim.dealDamage(me, mob, 1, false, 'physical', 'Strike', 'hit');
            mob.aggroTargetId = me.id;
            mob.inCombat = true;
            mob.aiState = 'chase';
          }
          return mob.id;
        },
        [dist, pull, BOSS],
      );
    };

    // Hold the idle body where the shot wants it, facing the player.
    const pin = () =>
      page.evaluate((dist) => {
        const sim = window.__game.world;
        const me = sim.player;
        const mob = sim.entities.get(me.targetId);
        if (!mob) return;
        mob.pos.x = me.pos.x + 1.0;
        mob.pos.z = me.pos.z + dist;
        mob.prevPos = { ...mob.pos };
        mob.vx = 0;
        mob.vz = 0;
        mob.facing = Math.atan2(me.pos.x - mob.pos.x, me.pos.z - mob.pos.z);
        mob.prevFacing = mob.facing;
        mob.homePos = { ...mob.pos };
        if (mob.home) mob.home = { ...mob.pos };
      }, DIST);
    if (want('idle_mmo') || want('idle_close') || want('idle_side') || want('face')) {
      await spawn(DIST, false);
      await chat('/dev freezemobs on');
      await pin();
      await camera(0.55, 0.32, 12);
      await sleep(2600);
      if (want('idle_mmo')) await shot('idle_mmo');
      await pin();
      await camera(0.35, 0.12, 8);
      await sleep(900);
      if (want('idle_close')) await shot('idle_close');
      await pin();
      await camera(0.0, 0.02, 5.5);
      await sleep(900);
      if (want('face')) await shot('face');
      await camera(-1.2, 0.18, 10);
      await sleep(900);
      if (want('idle_side')) await shot('idle_side');
      await chat('/dev freezemobs off');
    }
    if (want('walk') || want('attack') || want('cast') || want('struck') || want('death')) {
      await spawn(FIGHT_DIST, true);
      await camera(0.9, 0.3, 13);
      await sleep(700);
      if (want('walk')) await shot('walk');
      await sleep(2600);
      if (want('attack')) await shot('attack');
      if (want('cast')) {
        for (const mech of TRIGGERS) {
          await chat(`/dev bastion trigger ${mech}`);
          let at = 0;
          for (const ms of CAST_MS) {
            await sleep(ms - at);
            at = ms;
            console.log(
              'CAST',
              mech,
              ms,
              await page.evaluate(() => {
                const sim = window.__game.world;
                const mob = sim.entities.get(sim.player.targetId);
                const visual = window.__game.renderer.views.get(mob?.id)?.visual;
                const cur = visual?.current;
                let slung = null;
                visual?.model?.traverse?.((n) => {
                  if (n.name === 'OssickAnchorBack') slung = n.visible;
                });
                return JSON.stringify({
                  slungAnchor: slung,
                  cast: mob?.castingAbility ?? null,
                  left: mob?.castRemaining ?? null,
                  clip: cur?.getClip?.().name ?? null,
                  t: cur?.time ?? null,
                });
              }),
            );
            const tag = TRIGGERS.length > 1 ? `cast_${mech}` : 'cast';
            await shot(CAST_MS.length > 1 ? `${tag}_${ms}` : tag);
          }
          await sleep(2600);
        }
      }
      // The player swings back (auto attack on) at a body that cannot fall yet.
      await page.evaluate(() => {
        const sim = window.__game.world;
        const mob = sim.entities.get(sim.player.targetId);
        if (mob) {
          mob.maxHp = 1e6;
          mob.hp = 1e6;
        }
        sim.startAutoAttack?.();
      });
      await sleep(1100);
      // Land two heavy blows through the sim (a crit among them) and catch the spray.
      await page.evaluate(() => {
        const sim = window.__game.world;
        const mob = sim.entities.get(sim.player.targetId);
        if (!mob) return;
        sim.dealDamage(sim.player, mob, 40, true, 'physical', 'Strike', 'hit');
        sim.dealDamage(sim.player, mob, 25, false, 'physical', 'Strike', 'hit');
      });
      await sleep(140);
      if (want('struck')) await shot('struck');
      await chat('/dev killtarget');
      await sleep(300);
      if (want('death')) await shot('death');
      await sleep(1600);
      if (want('death')) await shot('death_late');
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
