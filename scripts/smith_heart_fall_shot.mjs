// Evidence captures of a quarter really falling in the Smith's Heart's Mythic hidden
// phase (docs/design/raid/smith_heart.md section 7.5): whole, mid-fall and after, from
// above and from low at the edge. Evidence tooling, not a repo test. Needs a dev Vite
// serving the worktree; real GPU, one headed Chrome.
//
//   node scripts/smith_heart_fall_shot.mjs <outDir>
//
// Env: SHOT_URL (http://127.0.0.1:5186/), SHOT_W / SHOT_H (1600x900), SHOT_PRESET (4),
// SHOT_SEQ: a JSON list of steps, each [kind, ...]:
//   ["cam", bearing, r, lookBearing, pitch, dist]  stand on the room's bearing, look on
//   ["dev", "<verb>", waitMs]                      /dev heart final <verb>
//   ["shot", "name"]                               capture
//   ["wait", ms]
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5186/';
const OUT = process.argv[2] ?? path.join('tmp', 'smith_heart_fall');
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROOM = { x: 188, z: 172 };
const ENTRY = { x: -196, z: -210 };

const SEQ = JSON.parse(process.env.SHOT_SEQ ?? '[]');
fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: false,
  args: [`--window-size=${W},${H + 100}`, '--use-angle=d3d11', '--ignore-gpu-blocklist'],
  defaultViewport: { width: W, height: H },
  protocolTimeout: 240000,
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || /THREE\.|shader|WebGL/i.test(m.text()))
      console.log('CONSOLE:', m.type(), m.text().slice(0, 400));
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
    charName: 'Heartwalker',
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
  const O = await page.evaluate(
    ([ex, ez]) => {
      const p = window.__game.world.player;
      return { x: p.pos.x - ex, z: p.pos.z - ez };
    },
    [ENTRY.x, ENTRY.z],
  );
  console.log('origin', O);
  await chat('/dev heart tp final', 2500);
  await page.waitForFunction(
    () => {
      let found = false;
      window.__game.renderer.scene.traverse((o) => {
        if (o.name === 'smithHeartFallRig') found = true;
      });
      return found;
    },
    { timeout: 180000, polling: 1000 },
  );
  await sleep(4000);
  await chat('/dev heart final mythic', 1200);
  await chat('/dev heart final pull', 2500);
  await page.addStyleTag({ content: '#ui { display: none !important; }' });
  const cam = (bearing, r, lookBearing, pitch, dist) =>
    page.evaluate(
      ([ox, oz, rx, rz, bearing, r, lookBearing, pitch, dist]) => {
        const w = window.__game.world;
        const p = w.player;
        const a = (bearing * Math.PI) / 180;
        const g = w.ctx.groundPos(ox + rx + Math.sin(a) * r, oz + rz + Math.cos(a) * r);
        p.pos = { ...g };
        p.prevPos = { ...g };
        p.facing = (lookBearing * Math.PI) / 180;
        p.prevFacing = p.facing;
        const input = window.__game.input;
        window.__shotHold = { yaw: p.facing, pitch, dist };
        if (!window.__shotHoldLoop) {
          window.__shotHoldLoop = true;
          const hold = () => {
            const h = window.__shotHold;
            if (h) {
              input.zoomMax = Math.max(input.zoomMax, h.dist);
              input.camYaw = h.yaw;
              input.camPitch = h.pitch;
              input.camDist = h.dist;
            }
            requestAnimationFrame(hold);
          };
          requestAnimationFrame(hold);
        }
      },
      [O.x, O.z, ROOM.x, ROOM.z, bearing, r, lookBearing, pitch, dist],
    );
  for (const step of SEQ) {
    const [kind, ...a] = step;
    if (kind === 'cam') {
      await cam(...a);
      await sleep(1200);
    } else if (kind === 'dev') {
      await chat(`/dev heart final ${a[0]}`, a[1] ?? 0);
    } else if (kind === 'shot') {
      const buf = await page.screenshot();
      fs.writeFileSync(path.join(OUT, `${a[0]}.png`), buf);
      console.log('shot', a[0]);
    } else if (kind === 'wait') {
      await sleep(a[0]);
    } else if (kind === 'hide') {
      await page.evaluate(
        (re, v) => {
          const rx = new RegExp(re);
          window.__game.renderer.scene.traverse((o) => {
            if (rx.test(o.name)) o.visible = v;
          });
        },
        a[0],
        a[1] ?? false,
      );
      await sleep(400);
    } else if (kind === 'ray') {
      // The first opaque triangle under a screen point (NDC), for hunting.
      console.log(
        'ray',
        await page.evaluate(
          (nx, ny) => {
            const R = window.__game.renderer;
            const cam = R.camera;
            const mul = (m, v) => {
              const e = m.elements;
              const w = e[3] * v[0] + e[7] * v[1] + e[11] * v[2] + e[15] * (v[3] ?? 1);
              return [
                (e[0] * v[0] + e[4] * v[1] + e[8] * v[2] + e[12] * (v[3] ?? 1)) / w,
                (e[1] * v[0] + e[5] * v[1] + e[9] * v[2] + e[13] * (v[3] ?? 1)) / w,
                (e[2] * v[0] + e[6] * v[1] + e[10] * v[2] + e[14] * (v[3] ?? 1)) / w,
              ];
            };
            const a = mul(cam.matrixWorld, mul(cam.projectionMatrixInverse, [nx, ny, -1]));
            const b = mul(cam.matrixWorld, mul(cam.projectionMatrixInverse, [nx, ny, 1]));
            const o = a;
            let d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
            const l = Math.hypot(...d);
            d = d.map((x) => x / l);
            const hits = [];
            R.scene.traverseVisible((m) => {
              if (!m.isMesh || m.isInstancedMesh || m.material?.transparent) return;
              const pos = m.geometry?.attributes?.position;
              const idx = m.geometry?.index;
              if (!pos || !idx) return;
              const st = m.geometry.drawRange.start;
              const en = Math.min(idx.count, st + m.geometry.drawRange.count);
              let best = 1e9;
              let at = null;
              const tv = (i) => mul(m.matrixWorld, [pos.getX(i), pos.getY(i), pos.getZ(i)]);
              for (let t = st; t + 2 < en; t += 3) {
                const A = tv(idx.getX(t));
                const B = tv(idx.getX(t + 1));
                const C = tv(idx.getX(t + 2));
                const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
                const e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
                const p = [
                  d[1] * e2[2] - d[2] * e2[1],
                  d[2] * e2[0] - d[0] * e2[2],
                  d[0] * e2[1] - d[1] * e2[0],
                ];
                const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
                if (det < 1e-7) continue;
                const s = [o[0] - A[0], o[1] - A[1], o[2] - A[2]];
                const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) / det;
                if (u < 0 || u > 1) continue;
                const q = [
                  s[1] * e1[2] - s[2] * e1[1],
                  s[2] * e1[0] - s[0] * e1[2],
                  s[0] * e1[1] - s[1] * e1[0],
                ];
                const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det;
                if (v < 0 || u + v > 1) continue;
                const hit = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
                if (hit > 0 && hit < best) {
                  best = hit;
                  at = o[1] + d[1] * hit;
                }
              }
              if (at !== null) hits.push([best.toFixed(1), m.name, m.parent?.name, at.toFixed(1)]);
            });
            hits.sort((p, q) => p[0] - q[0]);
            return JSON.stringify(hits.slice(0, 5));
          },
          a[0],
          a[1],
        ),
      );
    } else if (kind === 'near') {
      // What visible meshes reach a room-local point (bearing, r, y): for hunting.
      console.log(
        'near',
        await page.evaluate(
          (ox, oz, bearing, r, y) => {
            const R = window.__game.renderer;
            const b = (bearing * Math.PI) / 180;
            const P = { x: ox + Math.sin(b) * r, y, z: oz + Math.cos(b) * r };
            const out = [];
            R.scene.traverseVisible((o) => {
              if (!o.isMesh || !o.geometry?.boundingSphere) return;
              const c = o.geometry.boundingSphere.center;
              const e = o.matrixWorld.elements;
              const sc = Math.hypot(e[0], e[1], e[2]);
              const wx = e[0] * c.x + e[4] * c.y + e[8] * c.z + e[12];
              const wy = e[1] * c.x + e[5] * c.y + e[9] * c.z + e[13];
              const wz = e[2] * c.x + e[6] * c.y + e[10] * c.z + e[14];
              const d = Math.hypot(wx - P.x, wy - P.y, wz - P.z);
              if (d < o.geometry.boundingSphere.radius * sc)
                out.push(
                  `${o.name}|${o.parent?.name}|${o.material?.name}|${o.material?.transparent ? 'T' : 'O'}|${o.geometry.index?.count}`,
                );
            });
            return out.join(String.fromCharCode(10));
          },
          O.x + ROOM.x,
          O.z + ROOM.z,
          a[0],
          a[1],
          a[2],
        ),
      );
    } else if (kind === 'state') {
      console.log(
        'state',
        await page.evaluate(() => {
          const w = window.__game.world;
          let boss = null;
          for (const e of w.entities.values())
            if (/masterless|heart_final/i.test(e.templateId ?? '')) boss = e;
          const seen = {};
          window.__game.renderer.scene.traverse((o) => {
            if (/^heartFall(Whole|Stay)/.test(o.name)) seen[o.name] = o.visible;
          });
          return JSON.stringify({
            hp: boss && boss.hp / boss.maxHp,
            id: boss?.templateId,
            auras: boss?.auras
              ?.filter((x) => /heart_final/.test(x.id))
              .map((x) => [x.id, x.value, x.value2, x.value3]),
            seen,
          });
        }),
      );
    }
  }
  const perf = await page.evaluate(() => window.__game.renderer?.perfStats?.()?.gpuPrep ?? null);
  console.log('gpuPrep', JSON.stringify(perf)?.slice(0, 600));
} finally {
  await browser.close();
}
