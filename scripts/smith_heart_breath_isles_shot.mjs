// Evidence captures for the Guardian of the Breath's Islands of the Wind (the
// 50 percent phase; the polish pass of 2026-11-18): Skyrend Nova half and
// fully gathered, the Gale Cocoon shattering, Mending Gale between a Mender
// and a Sentinel standing together, and the Gust Herald's Shoving Gale lane
// from above. Evidence tooling, not a repo test. Needs a dev Vite serving the
// worktree (ALLOW_DEV_COMMANDS is implied offline).
//
//   node scripts/smith_heart_breath_isles_shot.mjs <outDir>
//
// Env: SHOT_URL (http://127.0.0.1:5192/), SHOT_W / SHOT_H (1600x900),
// SHOT_PRESET (4), SHOT_ONLY (comma list of scene names), SHOT_PREFIX.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5192/';
const OUT = process.argv[2] ?? path.join('tmp', 'smith_heart_breath_isles');
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const ONLY = process.env.SHOT_ONLY ? new Set(process.env.SHOT_ONLY.split(',')) : null;
const PREFIX = process.env.SHOT_PREFIX ?? '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BOSS = { x: 0, z: 198 };
const ENTRY = { x: 0, z: 100 };

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
  page.on('console', (m) => {
    if (m.type() === 'error' && /shader|WebGL|THREE/i.test(m.text()))
      console.log('CONSOLE:', m.text().slice(0, 400));
  });
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
    charName: 'Islewalker',
    gameBootTimeoutMs: 180000,
    selectorTimeoutMs: 90000,
    settleMs: 4000,
  });
  if (!booted) throw new Error('offline world did not boot');
  const chat = async (c, wait = 900) => {
    await page.evaluate((line) => window.__game.world.chat(line), c);
    await sleep(wait);
  };
  for (const c of ['/dev level 20', '/dev god', '/dev heart enter']) await chat(c, 1500);
  await chat('/dev heart kill trash', 600);
  await chat('/dev heart gates', 600);
  await chat('/dev heart tp breath', 4000);
  const O = await page.evaluate(
    ([ex, ez]) => {
      const p = window.__game.world.player;
      return { x: p.pos.x - ex, z: p.pos.z - ez };
    },
    [ENTRY.x, ENTRY.z],
  );
  await page.addStyleTag({ content: '#ui { display: none !important; }' });
  await page.waitForFunction(
    () => !document.querySelector('#loading-screen')?.classList.contains('visible'),
    { timeout: 240000, polling: 500 },
  );
  /** The camera held on the player: [yaw off its facing, pitch, distance]. */
  const hold = (yaw, pitch, dist) =>
    page.evaluate(
      ([yaw, pitch, dist]) => {
        const p = window.__game.world.player;
        window.__shotHold = { yaw: p.facing + yaw, pitch, dist };
        if (!window.__shotHoldLoop) {
          window.__shotHoldLoop = true;
          const input = window.__game.input;
          const step = () => {
            const h = window.__shotHold;
            if (h) {
              input.zoomMax = Math.max(input.zoomMax, h.dist);
              input.camYaw = h.yaw;
              input.camPitch = h.pitch;
              input.camDist = h.dist;
            }
            requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        }
      },
      [yaw, pitch, dist],
    );
  const placeMe = (x, z, fx, fz) =>
    page.evaluate(
      ([ox, oz, x, z, fx, fz]) => {
        const w = window.__game.world;
        const p = w.player;
        const g = w.ctx.groundPos(ox + x, oz + z);
        p.pos = { ...g };
        p.prevPos = { ...g };
        p.facing = Math.atan2(fx - x, fz - z);
        p.prevFacing = p.facing;
        w.ctx.rebucket(p);
      },
      [O.x, O.z, x, z, fx, fz],
    );
  const freeze = (on) =>
    page.evaluate((on) => {
      const w = window.__game.world;
      if (on && !w.__realTick) {
        w.__realTick = w.tick.bind(w);
        w.tick = () => [];
      } else if (!on && w.__realTick) {
        w.tick = w.__realTick;
        w.__realTick = null;
      }
    }, on);
  /** The guardian's fight state and the isles' (null out of the fight). */
  const isles = () =>
    page.evaluate(() => {
      for (const e of window.__game.world.entities.values())
        if (e.smithHeartBreath) return e.smithHeartBreath.isles;
      return null;
    });
  /** A fresh phase: pulled, reset, the isles begun. */
  const phase = async () => {
    await freeze(false);
    await chat('/dev heart breath reset', 1200);
    await chat('/dev heart breath pull', 1200);
    await chat('/dev heart breath isles', 1500);
  };
  /** Skyrend Nova `share` of the way gathered. */
  const charge = (share) =>
    page.evaluate((share) => {
      for (const e of window.__game.world.entities.values())
        if (e.smithHeartBreath) {
          const isl = e.smithHeartBreath.isles;
          const whole = e.castTotal > 0 ? e.castTotal : 150;
          isl.elapsed = whole * share;
        }
    }, share);
  const shoot = async (name) => {
    const buf = await page.screenshot({ type: 'jpeg', quality: 90 });
    fs.mkdirSync(OUT, { recursive: true });
    const file = path.join(OUT, `${PREFIX}${name}.jpg`);
    fs.writeFileSync(file, buf);
    console.log('SHOT', file);
  };
  /** The isle adds' records and bodies (role, entity id, world spot). */
  const adds = () =>
    page.evaluate(() => {
      const w = window.__game.world;
      for (const e of w.entities.values())
        if (e.smithHeartBreath)
          return e.smithHeartBreath.isles.adds.map((a) => {
            const b = w.entities.get(a.id);
            return { id: a.id, isle: a.isle, role: a.role, pos: b ? b.pos : null };
          });
      return [];
    });
  /** Bring the player to isle `i` (riding the dev gale) and wait for the landing. */
  const ride = async (i) => {
    await chat(`/dev heart breath ride ${i}`, 300);
    await sleep(4500);
  };

  // Settle on the Cornice once before the first scene.
  await placeMe(0, 172, BOSS.x, BOSS.z);
  await hold(0, 0.12, 22);
  await sleep(6000);

  const scenes = {
    async b01_nova() {
      await phase();
      await placeMe(0, 168, BOSS.x, BOSS.z);
      await hold(0, 0.1, 24);
      await charge(0.5);
      await sleep(600);
      await freeze(true);
      await sleep(900);
      await shoot('b01_nova_mitad');
      await freeze(false);
      await charge(0.97);
      await sleep(600);
      await freeze(true);
      await sleep(900);
      await shoot('b02_nova_carga_completa');
      await hold(0.5, -0.05, 14);
      await sleep(900);
      await shoot('b02b_nova_carga_completa_cerca');
      await freeze(false);
    },
    async b03_shatter() {
      await phase();
      await placeMe(0, 172, BOSS.x, BOSS.z);
      await hold(0.15, 0.08, 20);
      await sleep(1500);
      await chat('/dev heart breath still', 350);
      await shoot('b03_capullo_estalla');
      await sleep(500);
      await shoot('b03b_capullo_esquirlas');
      await sleep(700);
      await shoot('b03c_esquirlas_caen');
    },
    async b04_mend() {
      await phase();
      await ride(0);
      const list = await adds();
      const mender = list.find((a) => a.role === 'mender' && a.isle === 0);
      const sentinel = list.find((a) => a.role === 'sentinel' && a.isle === 0);
      if (!mender || !sentinel || !mender.pos) throw new Error('no mender on isle 0');
      // The Sentinel shoulder to shoulder with the Mender; the Mender channels.
      // Every other add of the isle shoulder to shoulder with the Mender.
      const others = list.filter((a) => a.isle === 0 && a.id !== mender.id).map((a) => a.id);
      await page.evaluate(
        ([mid, ids]) => {
          const w = window.__game.world;
          const m = w.entities.get(mid);
          ids.forEach((id, k) => {
            const s = w.entities.get(id);
            if (!s) return;
            const a = 0.9 + k * 1.3;
            s.pos = { x: m.pos.x + Math.sin(a) * 1.4, y: m.pos.y, z: m.pos.z + Math.cos(a) * 1.4 };
            s.prevPos = { ...s.pos };
            w.ctx.rebucket(s);
          });
          for (const e of w.entities.values())
            if (e.smithHeartBreath)
              for (const a of e.smithHeartBreath.isles.adds) if (a.id === mid) a.next = 0.2;
        },
        [mender.id, others],
      );
      const me = await page.evaluate(() => window.__game.world.player.pos);
      await page.evaluate(
        ([mx, mz]) => {
          const p = window.__game.world.player;
          p.facing = Math.atan2(mx - p.pos.x, mz - p.pos.z);
        },
        [mender.pos.x, mender.pos.z],
      );
      void me;
      await hold(0.6, 0.15, 13);
      await sleep(1300);
      await shoot('b04_mending_gale_juntos');
      if (process.env.SHOT_DEBUG)
        console.log(
          'DEBUG',
          await page.evaluate((mid) => {
            const out = [];
            const m = window.__game.world.entities.get(mid);
            out.push(`mender ${m.pos.x.toFixed(1)},${m.pos.y.toFixed(1)},${m.pos.z.toFixed(1)}`);
            window.__game.renderer.scene.traverse((o) => {
              if (!o.visible || !o.geometry) return;
              o.geometry.computeBoundingBox();
              const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
              const h = b.max.y - b.min.y;
              const near = Math.hypot(
                (b.min.x + b.max.x) / 2 - m.pos.x,
                (b.min.z + b.max.z) / 2 - m.pos.z,
              );
              if ((o.name.includes('Mend') || (h > 12 && near < 8)) && o.name)
                out.push(
                  `${o.name} h=${h.toFixed(1)} near=${near.toFixed(1)} y=${b.min.y.toFixed(1)}..${b.max.y.toFixed(1)}`,
                );
            });
            return out.join(' | ');
          }, mender.id),
        );
      await hold(-0.4, 0.5, 16);
      await sleep(500);
      await shoot('b04b_mending_gale_juntos_alto');
    },
    async b05_herald() {
      await phase();
      await ride(0);
      await chat('/dev heart breath killisle 0', 1500);
      await ride(1);
      const list = await adds();
      const herald = list.find((a) => a.role === 'herald' && a.isle === 1);
      if (!herald) throw new Error('no herald on isle 1');
      // Its gale begun now (as stepHerald begins it: toward the player).
      await page.evaluate((hid) => {
        const w = window.__game.world;
        const h = w.entities.get(hid);
        const p = w.player;
        const dx = p.pos.x - h.pos.x;
        const dz = p.pos.z - h.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        for (const e of w.entities.values())
          if (e.smithHeartBreath)
            for (const a of e.smithHeartBreath.isles.adds)
              if (a.id === hid) {
                a.dir = { ux: dx / d, uz: dz / d };
                a.at = { ...h.pos };
              }
        h.facing = Math.atan2(dx, dz);
        h.castingAbility = 'heart_breath_shoving_gale';
        h.castTargetId = p.id;
        h.castTotal = 2.5;
        h.castRemaining = 1.4;
      }, herald.id);
      await hold(0.2, 1.25, 30);
      await sleep(400);
      await shoot('b05_heraldo_carril_desde_arriba');
      await hold(0.6, 0.35, 18);
      await sleep(250);
      await shoot('b05b_heraldo_carril_lateral');
    },
  };
  for (const [name, fn] of Object.entries(scenes)) {
    if (ONLY && !ONLY.has(name)) continue;
    try {
      await fn();
    } catch (e) {
      console.log('SCENE FAILED', name, e.message);
    }
  }
} finally {
  await browser.close();
}
