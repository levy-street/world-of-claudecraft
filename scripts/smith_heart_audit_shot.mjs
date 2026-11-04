// Evidence captures for the Smith's Heart's visual audit and for the before/after of the
// AAA pass that follows it (docs/design/raid/smith_heart.md): every room and link from the
// same fixed angles (entering, the main wall, high, floor and edge), each landmark, each
// boss's body and main mechanic, and the raid's main effects staged through /dev heart.
// Evidence tooling, not a repo test. Needs a dev Vite serving the worktree (offline world,
// where dev commands are implied). Real GPU, one headed Chrome kept off-screen, never
// activated: it captures through CDP, because puppeteer's page.screenshot() brings the
// window to the front.
//
//   node scripts/smith_heart_audit_shot.mjs <outDir>
//
// Env: SHOT_URL (http://127.0.0.1:5186/), SHOT_W / SHOT_H (1600x900), SHOT_PRESET (4),
// SHOT_ONLY (a regular expression over the capture names, to re-shoot some),
// SHOT_LIST=1 (print the names and stop), SHOT_HIDE (a regular expression over mesh
// names, hidden before each capture, to find what draws something), SHOT_NAMES=1 (print
// the visible mesh names at the end), SHOT_RAY (JSON: capture name to a list of [screenX,
// screenY] pixels; prints what lies under each pixel, to name a stray shape).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5186/';
const OUT = process.argv[2] ?? path.join('tmp', 'smith_heart_audit');
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const ONLY = process.env.SHOT_ONLY ? new RegExp(process.env.SHOT_ONLY) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wanted = (name) => !ONLY || ONLY.test(name);

const ENTRY = { x: -196, z: -210 };
const ROOM = { x: 188, z: 172 };
const LAKE = { x: 198, z: -2 };
const WELL = { x: -224, z: 0 };
const KITS = ['hammer', 'rock', 'ring', 'breath', 'quench', 'heat', 'heart', 'gate'];

// The fixed angles: [pitch, camera distance]. A room may widen `alto` with its own distance.
const ANGLE = {
  entrada: [0.07, 13],
  pared: [0.09, 13],
  alto: [0.72, 70],
  suelo: [0.34, 8],
};

// A point of the Heart's room by bearing (degrees clockwise from north) and radius.
const onRoom = (deg, r) => {
  const a = (deg * Math.PI) / 180;
  return [ROOM.x + Math.sin(a) * r, ROOM.z + Math.cos(a) * r];
};

// Each room: its four fixed angles [stand x z, look x z] plus extras [name, stand, look,
// pitch, dist]. `alto` takes a third value, the camera's distance.
const ROOMS = [
  {
    room: 'grieta',
    entrada: [
      [-196, -210],
      [-150, -226],
    ],
    pared: [
      [-194, -208],
      [-213, -225],
    ],
    alto: [[-196, -212], [-150, -226], 42],
    suelo: [
      [-188, -206],
      [-170, -200],
    ],
  },
  {
    room: 'galeria',
    entrada: [
      [-166, -218],
      [-98, -232],
    ],
    pared: [
      [-104, -228],
      [-96, -262],
    ],
    alto: [[-104, -226], [-60, -210], 70],
    suelo: [
      [-92, -240],
      [-90, -262],
    ],
    extra: [['galeria_derrumbe', [-84, -214], [-62, -196], 0.14, 8]],
  },
  {
    room: 'cantera',
    entrada: [
      [-30, -174],
      [8, -170],
    ],
    pared: [
      [8, -172],
      [44, -204],
    ],
    alto: [[-4, -170], [40, -180], 78],
    suelo: [
      [-30, -188],
      [-48, -206],
    ],
    extra: [['cantera_coloso', [28, -178], [60, -196], 0.16, 12]],
  },
  {
    room: 'losa',
    entrada: [
      [0, -146],
      [0, -124],
    ],
    pared: [
      [0, -72],
      [0, 0],
    ],
    alto: [[0, -92], [0, -30], 62],
    suelo: [
      [9, -84],
      [40, -84],
    ],
    extra: [['losa_escalera', [0, -40], [0, 0], 0.14, 10]],
  },
  {
    room: 'anillo',
    entrada: [
      [-46, -52],
      [-68, 0],
    ],
    pared: [
      [0, 66],
      [0, 0],
    ],
    alto: [[0, 0], [0, 40], 118],
    suelo: [
      [52, 40],
      [10, 8],
    ],
    extra: [
      ['anillo_sello', [0, -12], [0, 0], 0.3, 12],
      ['anillo_boca_aliento', [0, 58], [0, 104], 0.12, 10],
    ],
  },
  {
    room: 'enlace_aliento',
    entrada: [
      [0, 92],
      [0, 118],
    ],
    pared: [
      [-64, 112],
      [-101, 159],
    ],
    alto: [[-84, 140], [-101, 159], 60],
    suelo: [
      [-84, 136],
      [-116, 120],
    ],
  },
  {
    room: 'cornisa',
    entrada: [
      [-44, 196],
      [0, 196],
    ],
    pared: [
      [0, 192],
      [0, 240],
    ],
    alto: [[0, 188], [0, 214], 32],
    suelo: [
      [30, 200],
      [62, 208],
    ],
  },
  {
    room: 'enlace_temple',
    entrada: [
      [92, 2],
      [122, -48],
    ],
    pared: [
      [126, -66],
      [156, -86],
    ],
    alto: [[150, -82], [178, -72], 62],
    suelo: [
      [120, -40],
      [150, -30],
    ],
  },
  {
    room: 'temple',
    entrada: [
      [186, -38],
      [198, -2],
    ],
    pared: [
      [198, -12],
      [226, 34],
    ],
    alto: [[190, -14], [204, 16], 88],
    suelo: [
      [206, -38],
      [224, -56],
    ],
  },
  {
    room: 'enlace_calor',
    entrada: [
      [-82, 2],
      [-124, 0],
    ],
    pared: [
      [-136, 2],
      [-150, 36],
    ],
    alto: [[-132, 0], [-160, 0], 60],
    suelo: [
      [-146, 30],
      [-150, 60],
    ],
  },
  {
    room: 'hogar',
    entrada: [
      [-182, 0],
      [-214, 0],
    ],
    pared: [
      [-204, 0],
      [-263, 0],
    ],
    alto: [[-200, 0], [-240, 0], 82],
    suelo: [
      [-194, -36],
      [-180, -56],
    ],
    extra: [['hogar_boca', [-232, 22], [-263, 2], 0.12, 12]],
  },
  {
    room: 'corazon_terraza',
    entrada: [
      [122, 106],
      [188, 172],
    ],
    pared: [
      [130, 114],
      [188, 172],
    ],
    alto: [[136, 120], [188, 172], 52],
    suelo: [
      [132, 104],
      [112, 88],
    ],
    extra: [['corazon_puente', [139, 123], [158, 142], 0.12, 9]],
  },
  {
    room: 'corazon',
    entrada: [
      [150, 134],
      [188, 172],
    ],
    pared: [onRoom(330, 22), onRoom(0, 70)],
    alto: [[188, 172], [188, 200], 132],
    suelo: [onRoom(315, 52), onRoom(315, 80)],
    extra: [
      ['corazon_hito_aire', onRoom(0, 40), onRoom(0, 70), 0.1, 11],
      ['corazon_hito_hielo', onRoom(90, 40), onRoom(90, 70), 0.1, 11],
      ['corazon_hito_martillo', onRoom(180, 40), onRoom(180, 70), 0.1, 11],
      ['corazon_hito_calor', onRoom(270, 40), onRoom(270, 70), 0.1, 11],
      ['corazon_pozo', onRoom(135, 22), [188, 172], 0.28, 10],
      ['corazon_abismo', onRoom(45, 44), onRoom(45, 100), 0.62, 15],
    ],
  },
];

const roomRows = () => {
  const rows = [];
  for (const r of ROOMS) {
    for (const kind of ['entrada', 'pared', 'alto', 'suelo']) {
      const [at, look, far] = r[kind];
      const [pitch, dist] = ANGLE[kind];
      rows.push({ name: `${r.room}_${kind}`, at, look, pitch, dist: far ?? dist });
    }
    for (const [name, at, look, pitch, dist] of r.extra ?? [])
      rows.push({ name, at, look, pitch, dist });
  }
  return rows;
};

if (process.env.SHOT_LIST === '1') {
  for (const r of roomRows()) console.log(r.name);
  process.exit(0);
}

fs.mkdirSync(OUT, { recursive: true });
// SHOT_CONNECT (a DevTools URL such as http://127.0.0.1:9333): reuse one browser already
// running with remote debugging (real GPU), disconnecting at the end instead of closing it,
// so a long pass keeps one browser on a shared machine.
const CONNECT = process.env.SHOT_CONNECT ?? '';
const browser = CONNECT
  ? await puppeteer.connect({
      browserURL: CONNECT,
      defaultViewport: { width: W, height: H },
      protocolTimeout: 240000,
    })
  : await puppeteer.launch({
      executablePath: BROWSER_PATH,
      headless: false,
      args: [
        `--window-size=${W},${H + 100}`,
        '--window-position=-2400,0',
        '--use-angle=d3d11',
        '--ignore-gpu-blocklist',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--disable-background-timer-throttling',
      ],
      defaultViewport: { width: W, height: H },
      protocolTimeout: 240000,
    });
let count = 0;
try {
  // The window's own first tab: a new one would activate the window.
  // Connected: the browser's own tab (never a background or extension page).
  const pages = await browser.pages();
  const page = CONNECT
    ? (pages.find((p) => /^(about:blank|https?:)/.test(p.url())) ?? (await browser.newPage()))
    : pages[0];
  const cdp = await page.createCDPSession();
  const landed = new Set();
  page.on('response', (r) => {
    const m = /smith_heart_([a-z]+)_kit[^/]*\.glb/.exec(r.url());
    if (m && r.ok()) landed.add(m[1]);
  });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || /THREE\.|shader|WebGL/i.test(m.text()))
      console.log('CONSOLE:', m.type(), m.text().slice(0, 300));
  });
  await page.evaluateOnNewDocument((preset) => {
    try {
      localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: preset }));
    } catch {
      /* ignore */
    }
  }, PRESET);
  if (!CONNECT) {
    const { windowId, bounds } = await cdp.send('Browser.getWindowForTarget');
    console.log('window', JSON.stringify(bounds));
    if (bounds.left > -W) {
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: -2400, top: 0 } });
      console.log('window moved off-screen');
    }
  }
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 180000 });
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  console.log('gpu', gpu);
  if (/swiftshader|llvmpipe|software/i.test(gpu)) throw new Error(`software renderer: ${gpu}`);
  const booted = await enterOfflineGame(page, {
    charClass: 'warrior',
    charName: 'Heartwalker',
    gameBootTimeoutMs: 180000,
    selectorTimeoutMs: 90000,
    settleMs: 4000,
  });
  if (!booted) throw new Error('offline world did not boot');

  const chat = async (c, wait = 700, pid) => {
    await page.evaluate(
      ([line, pid]) => window.__game.world.chat(line, pid === null ? undefined : pid),
      [c, pid ?? null],
    );
    await sleep(wait);
  };
  const rays = JSON.parse(process.env.SHOT_RAY ?? '{}');
  const rayAt = (px, py) =>
    page.evaluate(
      (nx, ny) => {
        const R = window.__game.renderer;
        const cam = R.camera;
        const mulE = (e, v, h = 1) => {
          const w = e[3] * v[0] + e[7] * v[1] + e[11] * v[2] + e[15] * h || 1;
          return [
            (e[0] * v[0] + e[4] * v[1] + e[8] * v[2] + e[12] * h) / w,
            (e[1] * v[0] + e[5] * v[1] + e[9] * v[2] + e[13] * h) / w,
            (e[2] * v[0] + e[6] * v[1] + e[10] * v[2] + e[14] * h) / w,
          ];
        };
        const near = mulE(
          cam.matrixWorld.elements,
          mulE(cam.projectionMatrixInverse.elements, [nx, ny, -1]),
        );
        const far = mulE(
          cam.matrixWorld.elements,
          mulE(cam.projectionMatrixInverse.elements, [nx, ny, 1]),
        );
        let d = [far[0] - near[0], far[1] - near[1], far[2] - near[2]];
        const l = Math.hypot(...d);
        d = d.map((x) => x / l);
        const mult = (a, b) => {
          const o = new Array(16).fill(0);
          for (let c = 0; c < 4; c++)
            for (let r = 0; r < 4; r++)
              for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
          return o;
        };
        const hits = [];
        const testMesh = (m, world, inst) => {
          const g = m.geometry;
          const pos = g?.attributes?.position;
          if (!pos) return;
          if (!g.boundingSphere) g.computeBoundingSphere();
          const c = mulE(world, [
            g.boundingSphere.center.x,
            g.boundingSphere.center.y,
            g.boundingSphere.center.z,
          ]);
          const sc = Math.max(
            Math.hypot(world[0], world[1], world[2]),
            Math.hypot(world[4], world[5], world[6]),
            Math.hypot(world[8], world[9], world[10]),
          );
          const oc = [c[0] - near[0], c[1] - near[1], c[2] - near[2]];
          const t = oc[0] * d[0] + oc[1] * d[1] + oc[2] * d[2];
          const miss = Math.hypot(oc[0] - d[0] * t, oc[1] - d[1] * t, oc[2] - d[2] * t);
          if (miss > g.boundingSphere.radius * sc + 0.01) return;
          const idx = g.index;
          const count = idx ? idx.count : pos.count;
          const start = g.drawRange.start;
          const end = Math.min(count, start + g.drawRange.count);
          const vert = (i) => mulE(world, [pos.getX(i), pos.getY(i), pos.getZ(i)]);
          let best = 1e9;
          for (let k = start; k + 2 < end; k += 3) {
            const A = vert(idx ? idx.getX(k) : k);
            const B = vert(idx ? idx.getX(k + 1) : k + 1);
            const C = vert(idx ? idx.getX(k + 2) : k + 2);
            const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
            const e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
            const q = [
              d[1] * e2[2] - d[2] * e2[1],
              d[2] * e2[0] - d[0] * e2[2],
              d[0] * e2[1] - d[1] * e2[0],
            ];
            const det = e1[0] * q[0] + e1[1] * q[1] + e1[2] * q[2];
            if (Math.abs(det) < 1e-9) continue;
            const f = 1 / det;
            const so = [near[0] - A[0], near[1] - A[1], near[2] - A[2]];
            const u = f * (so[0] * q[0] + so[1] * q[1] + so[2] * q[2]);
            if (u < 0 || u > 1) continue;
            const r = [
              so[1] * e1[2] - so[2] * e1[1],
              so[2] * e1[0] - so[0] * e1[2],
              so[0] * e1[1] - so[1] * e1[0],
            ];
            const v = f * (d[0] * r[0] + d[1] * r[1] + d[2] * r[2]);
            if (v < 0 || u + v > 1) continue;
            const hit = f * (e2[0] * r[0] + e2[1] * r[1] + e2[2] * r[2]);
            if (hit > 0 && hit < best) best = hit;
          }
          if (best < 1e9) {
            const mat = Array.isArray(m.material) ? m.material[0] : m.material;
            hits.push([
              Number(best.toFixed(1)),
              m.name || '?',
              m.parent?.name || '?',
              mat?.name || mat?.type,
              mat?.transparent ? 'transparent' : 'opaque',
              inst,
            ]);
          }
        };
        R.scene.traverseVisible((m) => {
          if (!m.isMesh) return;
          const w = m.matrixWorld.elements;
          if (m.isInstancedMesh) {
            const a = m.instanceMatrix.array;
            for (let i = 0; i < m.count; i++)
              testMesh(m, mult(w, Array.from(a.subarray(i * 16, i * 16 + 16))), i);
          } else testMesh(m, Array.from(w), -1);
        });
        hits.sort((p, q) => p[0] - q[0]);
        return JSON.stringify(hits.slice(0, 5));
      },
      (px / W) * 2 - 1,
      1 - (py / H) * 2,
    );
  const shoot = async (name) => {
    for (const [px, py] of rays[name] ?? []) console.log('RAY', name, px, py, await rayAt(px, py));
    if (process.env.SHOT_HIDE) {
      await page.evaluate((re) => {
        const rx = new RegExp(re);
        window.__game.renderer.scene.traverse((o) => {
          // Shrunk as well as hidden: an effect's frame loop sets its meshes' visibility back.
          if (rx.test(o.name)) {
            o.visible = false;
            o.scale.setScalar(0.0001);
          }
        });
      }, process.env.SHOT_HIDE);
      await sleep(250);
    }
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width: W, height: H, scale: 1 },
    });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
    count++;
    console.log('SHOT', name);
  };

  for (const c of ['/dev level 20', '/dev god', '/dev heart enter', '/dev noaggro'])
    await chat(c, 1500);
  await page.waitForFunction(
    () => {
      let found = false;
      window.__game.renderer.scene.traverse((o) => {
        if (o.name === 'smithHeartField') found = true;
      });
      return found;
    },
    { timeout: 180000, polling: 1000 },
  );
  await page.addStyleTag({ content: '#ui { display: none !important; }' });
  const O = await page.evaluate(
    ([ex, ez]) => {
      const p = window.__game.world.player;
      return { x: p.pos.x - ex, z: p.pos.z - ez };
    },
    [ENTRY.x, ENTRY.z],
  );
  console.log('origin', JSON.stringify(O));

  // The kits land on their own after the interior is built: a capture before that shows
  // stand-ins. A kit that never lands is reported, never hidden.
  const untilKits = Date.now() + 120000;
  let missing = KITS;
  while (Date.now() < untilKits && missing.length > 0) {
    missing = KITS.filter((k) => !landed.has(k));
    if (missing.length > 0) await sleep(2000);
  }
  console.log('kits not seen landing:', JSON.stringify(missing));
  await sleep(12000);

  // A dead body reads as part of the shot, and a spot past a lip drops the body into the
  // void (the Cornice's gaps kill): revive first, and search outward for a floor.
  const place = async (at, look, pitch, dist, yaw = 0) => {
    const dead = await page.evaluate(() => {
      const p = window.__game.world.player;
      return !!(p.dead || p.ghost);
    });
    if (dead) {
      console.log('revived');
      await chat('/dev revive', 500);
    }
    return page.evaluate(
      ([ox, oz, x, z, fx, fz, yaw, pitch, dist]) => {
        const w = window.__game.world;
        const p = w.player;
        let g = w.ctx.groundPos(ox + x, oz + z);
        for (let r = 1; r < 40 && g.y <= -60; r++)
          for (let k = 0; k < 16 && g.y <= -60; k++) {
            const a = (k / 16) * Math.PI * 2;
            g = w.ctx.groundPos(ox + x + Math.sin(a) * r, oz + z + Math.cos(a) * r);
          }
        p.pos = { ...g };
        p.prevPos = { ...g };
        p.facing = Math.atan2(fx - x, fz - z);
        p.prevFacing = p.facing;
        w.ctx.rebucket(p);
        const input = window.__game.input;
        window.__shotHold = { yaw: p.facing + yaw, pitch, dist };
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
        return g.y;
      },
      [O.x, O.z, at[0], at[1], look[0], look[1], yaw, pitch, dist],
    );
  };
  const addRaid = () =>
    page.evaluate(() => {
      if (window.__raid) return;
      const w = window.__game.world;
      const classes = [
        'warrior',
        'paladin',
        'mage',
        'priest',
        'rogue',
        'hunter',
        'druid',
        'shaman',
      ];
      window.__raid = classes.map((c, i) => {
        const id = w.addPlayer(c, `Raider${i + 1}`);
        w.entities.get(id).devGod = true;
        return id;
      });
    });
  // A scene shot alone (SHOT_ONLY) may place a raider before any spread made the raid.
  const raider = async (i, x, z) => {
    await addRaid();
    return page.evaluate(
      ([ox, oz, i, x, z]) => {
        const w = window.__game.world;
        const e = w.entities.get(window.__raid[i]);
        const g = w.ctx.groundPos(ox + x, oz + z);
        e.pos = { ...g };
        e.prevPos = { ...g };
        w.ctx.rebucket(e);
      },
      [O.x, O.z, i, x, z],
    );
  };
  const raidId = async (i) => {
    await addRaid();
    return page.evaluate((i) => window.__raid[i], i);
  };
  /** Spread the raid round a point, so a fight's marks land on bodies in the arena. */
  const spreadRaid = async (cx, cz, r, from = 0) => {
    await addRaid();
    for (let i = from; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      await raider(i, cx + Math.sin(a) * r, cz + Math.cos(a) * r);
    }
  };
  /** An entity's instance-local spot by template id (null when absent). */
  const spotOf = (template) =>
    page.evaluate(
      ([ox, oz, template]) => {
        for (const e of window.__game.world.entities.values())
          if (e.templateId === template && !e.dead) return [e.pos.x - ox, e.pos.z - oz];
        return null;
      },
      [O.x, O.z, template],
    );
  /** Stand `back` yards from an entity on bearing `deg`, looking at it. */
  const faceBody = async (template, deg, back, pitch, dist) => {
    const s = await spotOf(template);
    if (!s) {
      console.log('NO BODY', template);
      return false;
    }
    const a = (deg * Math.PI) / 180;
    await place([s[0] + Math.sin(a) * back, s[1] + Math.cos(a) * back], s, pitch, dist);
    return true;
  };
  /** One capture of a staged scene, whose failure never loses the others. */
  const scene = async (name, run) => {
    if (!wanted(name)) return;
    try {
      await run();
      await shoot(name);
    } catch (e) {
      console.log('SCENE FAILED', name, e.message);
    }
  };

  // ---- a closed gate, before anything dies --------------------------------------------
  await scene('puerta_cerrada', async () => {
    await place([-150, 2], [-186, 0], 0.1, 10);
    await sleep(4000);
  });
  await chat('/dev heart kill trash', 800);
  await chat('/dev heart gates', 800);

  // ---- the rooms: the static world, the bosses asleep --------------------------------
  for (const row of roomRows()) {
    if (!wanted(row.name)) continue;
    const y = await place(row.at, row.look, row.pitch, row.dist);
    await sleep(row.name.startsWith('corazon') ? 7000 : 4500);
    console.log(row.name, 'floor', Number(y).toFixed(1));
    await shoot(row.name);
  }

  // ---- the seal's portal ---------------------------------------------------------------
  if (wanted('anillo_portal')) {
    await chat('/dev heart portal', 0);
    await place([0, -30], [0, 0], 0.16, 16);
    await sleep(9000);
    await shoot('anillo_portal');
  }

  // ---- the Hammer Council --------------------------------------------------------------
  await scene('consejo_cuerpo', async () => {
    await faceBody('heart_seam_singer', 290, 14, 0.06, 9);
    await sleep(3000);
  });
  await scene('consejo_mecanica', async () => {
    await spreadRaid(8, -170, 16);
    await chat('/dev noaggro', 200);
    await chat('/dev heart council pull', 2200);
    await chat('/dev heart council wrath', 2000);
    await place([-26, -170], [8, -170], 0.34, 26);
    await sleep(900);
  });
  await chat('/dev heart kill council', 500);

  // ---- the Breath ----------------------------------------------------------------------
  await scene('aliento_cuerpo', async () => {
    await chat('/dev heart breath reset', 500);
    await faceBody('heart_breath_guardian', 240, 15, 0.06, 9);
    await sleep(3000);
  });
  const breathPull = async (tier) => {
    await chat('/dev heart breath reset', 500);
    await chat(`/dev heart breath ${tier}`, 200);
    await spreadRaid(0, 190, 12);
    await chat('/dev heart breath pull', 2000);
  };
  await scene('aliento_tornados', async () => {
    await breathPull('heroic');
    await chat('/dev heart breath tornado', 3000);
    await place([0, 178], [0, 200], 0.5, 22);
    await sleep(500);
  });
  await scene('aliento_tornado_cerca', async () => {
    const g = await spotOf('sh_breath_loose_gale');
    console.log('gale', JSON.stringify(g));
    if (g) await place([g[0] - 11, g[1] - 7], g, 0.1, 9);
    await sleep(350);
  });
  await scene('aliento_tormenta', async () => {
    await breathPull('heroic off');
    await chat('/dev heart breath phase2', 4000);
    await place([0, 178], [0, 200], 0.34, 20);
    await sleep(600);
  });
  await scene('aliento_portales', async () => {
    await breathPull('mythic');
    await chat('/dev heart breath heart', 400);
    await raider(1, -13, 192);
    await raider(4, 13, 192);
    await chat('/dev heart breath portal a', 300, await raidId(1));
    await chat('/dev heart breath portal b', 1500, await raidId(4));
    await place([0, 176], [0, 192], 0.34, 16);
    await sleep(500);
  });
  await scene('aliento_bola', async () => {
    await breathPull('mythic');
    await chat('/dev heart breath heart', 2500);
    const k = await page.evaluate(
      ([ox, oz]) => {
        for (const e of window.__game.world.entities.values())
          if (/knot/i.test(e.templateId ?? '')) return [e.pos.x - ox, e.pos.z - oz];
        return null;
      },
      [O.x, O.z],
    );
    if (k) await place([k[0] - 9, k[1] - 7], k, 0.16, 9);
    else console.log('no knot found');
    await sleep(600);
  });
  await chat('/dev heart kill breath', 500);

  // ---- the Quench ----------------------------------------------------------------------
  const quenchPull = async (tier) => {
    await chat('/dev heart quench reset', 500);
    await chat(`/dev heart quench ${tier}`, 200);
    await spreadRaid(LAKE.x, LAKE.z, 13);
    await chat('/dev heart quench pull', 2400);
    await page.evaluate(() => {
      for (const e of window.__game.world.entities.values())
        if (e.smithHeartQuench) e.smithHeartQuench.breathTimer = 999;
    });
  };
  await scene('temple_cuerpo', async () => {
    await chat('/dev heart quench reset', 500);
    await faceBody('heart_quench_guardian', 200, 15, 0.06, 9);
    await sleep(3000);
  });
  await scene('temple_cono', async () => {
    await quenchPull('heroic off');
    await place([LAKE.x - 14, LAKE.z - 28], [LAKE.x, LAKE.z], 0.42, 26);
    await chat('/dev heart quench breath', 1800);
  });
  await scene('temple_agua', async () => {
    await quenchPull('heroic off');
    await raider(1, LAKE.x, LAKE.z - 24);
    await chat('/dev heart quench hole', 1500, await raidId(1));
    await place([LAKE.x - 7, LAKE.z - 27], [LAKE.x, LAKE.z - 24], 0.06, 5);
    await sleep(1000);
  });
  await scene('temple_agua_alto', async () => {
    await place([LAKE.x - 5, LAKE.z - 29], [LAKE.x, LAKE.z - 24], 0.75, 12);
    await sleep(700);
  });
  await scene('temple_grieta', async () => {
    await raider(2, LAKE.x + 4, LAKE.z - 16);
    await chat('/dev heart quench crack', 1400, await raidId(2));
    await place([LAKE.x - 4, LAKE.z - 28], [LAKE.x + 4, LAKE.z - 16], 0.45, 14);
    await sleep(500);
  });
  await scene('temple_tajos', async () => {
    await quenchPull('heroic off');
    await chat('/dev heart quench blades', 2500);
    await chat('/dev heart quench slash', 1500);
    await place([LAKE.x - 6, LAKE.z - 30], [LAKE.x, LAKE.z], 0.6, 44);
    await sleep(400);
  });
  await scene('temple_tajos_vuelo', async () => {
    // The strike itself, a moment after the marks.
    await sleep(1800);
  });
  await scene('temple_cuchilla_cerca', async () => {
    await quenchPull('heroic off');
    await chat('/dev heart quench blades', 3000);
    const b = await page.evaluate(
      ([ox, oz]) => {
        const out = [];
        for (const e of window.__game.world.entities.values())
          if (/blade/i.test(e.templateId ?? ''))
            out.push([e.pos.x - ox, e.pos.z - oz, e.templateId]);
        return out;
      },
      [O.x, O.z],
    );
    console.log('blades', JSON.stringify(b));
    if (b[0]) await place([b[0][0] - 8, b[0][1] - 6], [b[0][0], b[0][1]], 0.14, 8);
    await sleep(1200);
  });
  await scene('temple_cuchilla_alto', async () => {
    const b = await page.evaluate(
      ([ox, oz]) => {
        for (const e of window.__game.world.entities.values())
          if (/blade/i.test(e.templateId ?? '')) return [e.pos.x - ox, e.pos.z - oz];
        return null;
      },
      [O.x, O.z],
    );
    if (b) await place([b[0] - 5, b[1] - 4], b, 0.95, 16);
    await sleep(800);
  });
  // The blade's body through a whole slash, at the distance a body stands from it.
  if (['temple_tajo_cerca_1', 'temple_tajo_cerca_2', 'temple_tajo_cerca_3'].some(wanted)) {
    await quenchPull('heroic off');
    await chat('/dev heart quench blades', 3000);
    await chat('/dev heart quench slash', 300);
    for (const [i, wait] of [
      [1, 700],
      [2, 1100],
      [3, 1100],
    ]) {
      const b = await spotOf('sh_quench_blade_float');
      if (b) await place([b[0] - 9, b[1] - 6], [b[0], b[1]], 0.1, 8);
      await sleep(wait);
      await shoot(`temple_tajo_cerca_${i}`);
    }
  }
  // The same instant with and without the smoke pool, to name what draws the cut clouds.
  if (ONLY === null || ONLY.test('temple_nube_con_1')) {
    const smoke = (on) =>
      page.evaluate((on) => {
        window.__game.renderer.scene.traverse((o) => {
          // The material, never the mesh: the particle pool sets its mesh's visibility every frame.
          if (o.material?.name === 'trashEngineSmoke') o.material.visible = on;
        });
      }, on);
    for (const round of [1, 2]) {
      await quenchPull('heroic off');
      await chat('/dev heart quench blades', 3000);
      await chat('/dev heart quench slash', 300);
      // A fixed spot on the open ice: the blades' own spots can put the camera in a rock.
      await place([LAKE.x - 2, LAKE.z - 12], [LAKE.x + 20, LAKE.z - 12], 0.1, 9);
      await sleep(2900);
      await shoot(`temple_nube_con_${round}`);
      await smoke(false);
      await sleep(60);
      await shoot(`temple_nube_sin_${round}`);
      await smoke(true);
    }
  }
  await scene('temple_caza', async () => {
    await quenchPull('mythic');
    await chat('/dev heart quench flurry', 2600);
    await place([LAKE.x - 6, LAKE.z - 30], [LAKE.x, LAKE.z], 0.62, 46);
    await sleep(400);
  });
  await chat('/dev heart kill quench', 500);

  // ---- the Heat ------------------------------------------------------------------------
  const heatHold = () =>
    page.evaluate(() => {
      for (const e of window.__game.world.entities.values())
        if (e.smithHeartHeat) {
          const st = e.smithHeartHeat;
          st.fistTimer = 999;
          st.flareTimer = 999;
          st.seedTimer = 999;
          st.zoneTimer = 999;
          st.cinderTimer = 999;
        }
    });
  const heatPull = async (tier) => {
    await chat('/dev heart heat reset', 500);
    await chat(`/dev heart heat ${tier}`, 200);
    await spreadRaid(WELL.x + 18, WELL.z, 8);
    await chat('/dev heart heat pull', 2400);
    await heatHold();
  };
  await scene('calor_cuerpo', async () => {
    await chat('/dev heart heat reset', 500);
    await place([WELL.x + 20, WELL.z + 3], [WELL.x, WELL.z], 0.05, 9);
    await sleep(3500);
  });
  if (['calor_puno', 'calor_puno_cerca', 'calor_puno_golpe'].some(wanted)) {
    await heatPull('heroic off');
    const P = [WELL.x + 22, WELL.z + 12];
    await raider(2, P[0], P[1]);
    await place([P[0] + 16, P[1] - 10], P, 0.3, 22);
    await chat('/dev heart heat fist', 2000, await raidId(2));
    await shoot('calor_puno_cerca');
    await sleep(350);
    await shoot('calor_puno');
    await sleep(800);
    await shoot('calor_puno_golpe');
  }
  if (ONLY === null || ONLY.test('calor_puno_caida_1')) {
    await heatPull('heroic off');
    const P = [WELL.x + 30, WELL.z + 22];
    await raider(2, P[0], P[1]);
    await place([P[0] + 12, P[1] - 4], P, 0.02, 42);
    await chat('/dev heart heat fist', 1700, await raidId(2));
    for (let i = 1; i <= 6; i++) {
      await shoot(`calor_puno_caida_${i}`);
      await sleep(30);
    }
  }
  await scene('calor_rueda', async () => {
    await heatPull('mythic');
    await chat('/dev heart heat phase 2', 2500);
    await heatHold();
    await chat('/dev heart heat wheel', 2600);
    await place([WELL.x + 34, WELL.z - 8], [WELL.x, WELL.z], 0.62, 42);
    await sleep(300);
  });
  await scene('calor_estelas', async () => {
    await heatPull('heroic off');
    await chat('/dev heart heat zones', 3000);
    await place([WELL.x + 34, WELL.z - 8], [WELL.x, WELL.z], 0.55, 40);
    await sleep(300);
  });
  await chat('/dev heart kill guardians', 800);

  // ---- the final boss and the fall -----------------------------------------------------
  await scene('final_cuerpo', async () => {
    const id = await page.evaluate(() => {
      for (const e of window.__game.world.entities.values())
        if (/masterless|heart_final/i.test(e.templateId ?? '')) return e.templateId;
      return null;
    });
    console.log('final boss template', id);
    await place(onRoom(225, 20), [ROOM.x, ROOM.z], 0.06, 9);
    await sleep(6000);
  });
  await scene('final_mecanica', async () => {
    await spreadRaid(ROOM.x, ROOM.z, 20);
    await chat('/dev heart final normal', 200);
    await chat('/dev heart final quarter heat', 800);
    await chat('/dev heart final pull', 1500);
    await chat('/dev heart final whirl', 400);
    await chat('/dev heart final embers', 2400);
    await place(onRoom(100, 24), onRoom(270, 30), 0.42, 34);
    await sleep(500);
  });
  await scene('final_yunque', async () => {
    await chat('/dev heart final reset', 800);
    await chat('/dev heart final pull', 1000);
    await raider(3, ...onRoom(135, 34));
    await place(onRoom(100, 26), onRoom(135, 34), 0.34, 26);
    await chat('/dev heart final anvil', 2600, await raidId(3));
  });
  await scene('final_yunque_suelo', async () => {
    await sleep(1200);
    await place(onRoom(100, 26), onRoom(135, 34), 0.2, 20);
    await sleep(500);
  });
  if (ONLY === null || ONLY.test('final_yunque_caida_1')) {
    await chat('/dev heart final reset', 800);
    await chat('/dev heart final quarter hammer', 800);
    await chat('/dev heart final pull', 1000);
    const m = onRoom(45, 36);
    await raider(3, m[0], m[1]);
    await place(onRoom(45, 14), m, 0.1, 34);
    await chat('/dev heart final anvil', 3400, await raidId(3));
    for (let i = 1; i <= 6; i++) {
      const spot = await page.evaluate(
        ([ox, oz]) => {
          for (const e of window.__game.world.entities.values())
            if (/sh_final_anvil_/.test(e.templateId ?? '')) return [e.pos.x - ox, e.pos.z - oz];
          return null;
        },
        [O.x, O.z],
      );
      console.log('anvil mark', JSON.stringify(spot));
      await shoot(`final_yunque_caida_${i}`);
      await sleep(250);
    }
  }
  if (ONLY === null || ONLY.test('final_puno_caida_1')) {
    await chat('/dev heart final reset', 800);
    await chat('/dev heart final quarter hammer', 800);
    await chat('/dev heart final pull', 1000);
    const m = onRoom(45, 36);
    await raider(2, m[0], m[1]);
    await place(onRoom(45, 14), m, 0.02, 42);
    await chat('/dev heart final fist', 1700, await raidId(2));
    for (let i = 1; i <= 6; i++) {
      await shoot(`final_puno_caida_${i}`);
      await sleep(30);
    }
  }
  await scene('final_puno', async () => {
    await chat('/dev heart final reset', 800);
    await chat('/dev heart final pull', 1000);
    await raider(2, ...onRoom(135, 30));
    await place(onRoom(90, 24), onRoom(135, 30), 0.34, 28);
    await chat('/dev heart final fist', 2300, await raidId(2));
  });
  await scene('final_columna', async () => {
    await chat('/dev heart final reset', 800);
    await chat('/dev heart final quarter ring', 4000);
    await place(onRoom(225, 44), [ROOM.x, ROOM.z], 0.1, 16);
    await sleep(2500);
  });
  await scene('final_columna_alta', async () => {
    await place(onRoom(225, 44), [ROOM.x, ROOM.z], 0.5, 44);
    await sleep(800);
  });
  // The hidden phase: a quarter falls. The raid stands off the falling quarters.
  const fallCam = (deg, r, lookDeg, lookR, pitch, dist) =>
    place(onRoom(deg, r), onRoom(lookDeg, lookR), pitch, dist);
  if (ONLY === null || ONLY.test('final_caida_')) {
    await chat('/dev heart final reset', 800);
    await spreadRaid(...onRoom(20, 44), 4);
    await chat('/dev heart final mythic', 300);
    await chat('/dev heart final pull', 2000);
    await chat('/dev heart final collapse', 3500);
    await fallCam(270, 12, 90, 40, 0.5, 40);
    await sleep(500);
    await shoot('final_caida_aviso');
    await chat('/dev heart final fall quench', 1400);
    await fallCam(270, 12, 90, 40, 0.5, 40);
    await sleep(600);
    await shoot('final_caida_vuelo');
    await sleep(6000);
    await shoot('final_caida_fin');
    await fallCam(0, 16, 110, 30, 0.14, 8);
    await sleep(900);
    await shoot('final_caida_borde');
    await fallCam(0, 16, 90, 90, 0.1, 10);
    await sleep(900);
    await shoot('final_caida_pared');
    await fallCam(0, 16, 130, 75, 0.3, 24);
    await sleep(900);
    await shoot('final_caida_raiz');
    await chat('/dev heart final fall hammer', 500);
    await chat('/dev heart final fall heat', 8000);
    await fallCam(0, 16, 225, 90, 0.42, 34);
    await sleep(1000);
    await shoot('final_caida_puente');
    await fallCam(0, 16, 225, 90, 0.08, 10);
    await sleep(900);
    await shoot('final_caida_puente_baja');
  }
  if (process.env.SHOT_NAMES === '1')
    console.log(
      'meshes',
      await page.evaluate(() => {
        const seen = {};
        window.__game.renderer.scene.traverseVisible((o) => {
          if (o.isMesh || o.isSprite) seen[o.name || '?'] = (seen[o.name || '?'] ?? 0) + 1;
        });
        return JSON.stringify(seen);
      }),
    );
  console.log(
    'gpuPrep',
    JSON.stringify(
      await page.evaluate(() => window.__game.renderer?.perfStats?.()?.gpuPrep ?? null),
    )?.slice(0, 300),
  );
} finally {
  console.log('captures', count);
  if (CONNECT) await browser.disconnect();
  else await browser.close();
}
