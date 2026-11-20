// Evidence captures for the Smith's Heart's big in-fight moments: the
// Masterless Strength's Weight of the Anvil (src/render/smith_heart_fx/
// final_anvil_core.ts) and the Hammer Council's Mountain's Wrath and
// Mountain's Rush (council_strike_core.ts), each forced through its real dev
// verb (`/dev heart final anvil`, `/dev heart council wrath`, `/dev heart
// council rush`) in a pulled fight with a small raid of dev-only stand-ins,
// and filmed as a burst of frames plus an mp4 of the burst when ffmpeg is at
// hand. Evidence tooling, not a repo test. Needs a dev Vite serving the
// worktree (ALLOW_DEV_COMMANDS is implied offline).
//
//   node scripts/smith_heart_mechanic_shot.mjs <outDir>
//
// Env: SHOT_URL (http://127.0.0.1:5196/), SHOT_W / SHOT_H (1600x900),
// SHOT_PRESET (4), SHOT_WHAT (anvil | wrath | rush), SHOT_SECONDS (by what),
// SHOT_VIEW (raid | high | close), SHOT_SETTLE (9000), SHOT_TAG (file prefix).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5196/';
const OUT = process.argv[2] ?? path.join('tmp', 'smith_heart_mechanic');
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const WHAT = process.env.SHOT_WHAT ?? 'anvil';
const VIEW = process.env.SHOT_VIEW ?? 'raid';
const TAG = process.env.SHOT_TAG ?? `${WHAT}_${VIEW}`;
const SECONDS = Number(
  process.env.SHOT_SECONDS ??
    {
      anvil: 9.5,
      wrath: 7,
      rush: 10,
      pillars: 5,
      storm: 9,
      blade: 6,
      tornado: 8,
      overload: 8,
      fusion_steam: 14,
      fusion_magma: 11,
      fusion_firestorm: 12,
      fusion_hail: 12,
      fusion_avalanche: 12,
      fusion_spires: 11,
      opposites: 11,
    }[WHAT] ??
    9,
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Per mechanic: the area to enter, the root that says its fx are built,
 *  the boss to stand off from (the witness and the raid stand `standOff`
 *  yards from it on `bearing`, or toward `toward`), the setup and the
 *  trigger. */
/** Each quarter's floor 30 yd out from the room's middle (instance-local). */
const QUARTER_SPOTS = {
  heat: { x: 159.6, z: 162.4 },
  quench: { x: 216.4, z: 181.6 },
  breath: { x: 178.4, z: 200.4 },
  hammer: { x: 197.6, z: 143.6 },
};
const PLANS = {
  anvil: {
    tp: 'final',
    fxRoot: 'smith-heart-final-kit-fx',
    /** Where the area sets us down, and the room's middle (instance-local):
     *  the witness stands off from the boss toward it. */
    anchor: { x: 128.25, z: 112.25 },
    toward: { x: 188, z: 172 },
    bossTemplate: 'heart_masterless_strength',
    standOff: 26,
    raid: 4,
    raidSpread: 2.2,
    setup: [
      '/dev heart final reset',
      '/dev heart final quarter hammer',
      '/dev heart final pull',
      '/dev heart final root',
    ],
    pre: ['/dev heart final root'],
    trigger: '/dev heart final anvil',
  },
  // The Masterless Strength's woken stars (the rework of 2026-11-18): the
  // Hammer's pillars rising, a Sky Strike by them (Arcing Stone, the pillar
  // Storm-Charged and pulsing), a Crossing Blade through the witness, the
  // Heat's Fire Whirls, and the Overload in the world (the body's strain, the
  // quarter's floor and wall erupting).
  pillars: {
    tp: 'final',
    fxRoot: 'smith-heart-final-kit-fx',
    anchor: { x: 128.25, z: 112.25 },
    toward: { x: 188, z: 172 },
    bossTemplate: 'heart_masterless_strength',
    standOff: 18,
    raid: 4,
    raidSpread: 6,
    setup: [
      '/dev heart final reset',
      '/dev heart final quarter hammer',
      '/dev heart final pull',
      '/dev heart final root',
    ],
    trigger: ['/dev heart final pillars 3'],
  },
  storm: {
    tp: 'final',
    fxRoot: 'smith-heart-final-kit-fx',
    anchor: { x: 128.25, z: 112.25 },
    toward: { x: 188, z: 172 },
    bossTemplate: 'heart_masterless_strength',
    standOff: 18,
    raid: 4,
    raidSpread: 6,
    setup: [
      '/dev heart final reset',
      '/dev heart final quarter hammer',
      '/dev heart final pull',
      '/dev heart final root',
      '/dev heart final pillars 2',
    ],
    trigger: [
      '/dev heart final wake breath',
      ['/dev heart final sky', 3000],
      '/dev heart final sky pillar',
    ],
    // In the Hammer's quarter (never the ring, where no pillar rises).
    spot: { x: 198.9, z: 139.8 },
  },
  arc: {
    tp: 'final',
    fxRoot: 'smith-heart-final-kit-fx',
    anchor: { x: 128.25, z: 112.25 },
    toward: { x: 188, z: 172 },
    bossTemplate: 'heart_masterless_strength',
    standOff: 20,
    raid: 4,
    raidSpread: 9,
    setup: [
      '/dev heart final reset',
      '/dev heart final quarter hammer',
      '/dev heart final pull',
      '/dev heart final root',
      '/dev heart final pillars 2',
    ],
    trigger: [['/dev heart final sky pillar', 2600], '/dev heart final sky pillar'],
    spot: { x: 198.9, z: 139.8 },
  },
  blade: {
    tp: 'final',
    fxRoot: 'smith-heart-final-kit-fx',
    anchor: { x: 128.25, z: 112.25 },
    toward: { x: 188, z: 172 },
    bossTemplate: 'heart_masterless_strength',
    standOff: 24,
    raid: 4,
    raidSpread: 8,
    setup: [
      '/dev heart final reset',
      '/dev heart final quarter hammer',
      '/dev heart final pull',
      '/dev heart final root',
      '/dev heart final pillars 3',
      '/dev heart final charge',
      '/dev heart final root',
    ],
    trigger: ['/dev heart final blades me'],
    // The witness leads its line through the nearest pillar (as the bots do),
    // so the flight is seen shattering it.
    steer: 'bladeThroughPillar',
    // The whole line from its blade on the rim across the room.
    views: { high: [0.0, 1.05, 78], raid: [0.7, 0.32, 36] },
  },
  tornado: {
    tp: 'final',
    fxRoot: 'smith-heart-final-kit-fx',
    anchor: { x: 128.25, z: 112.25 },
    toward: { x: 188, z: 172 },
    bossTemplate: 'heart_masterless_strength',
    standOff: 22,
    raid: 4,
    raidSpread: 7,
    setup: [
      '/dev heart final reset',
      '/dev heart final quarter heat',
      '/dev heart final pull',
      '/dev heart final root',
    ],
    trigger: ['/dev heart final tornado'],
  },
  overload: {
    tp: 'final',
    fxRoot: 'smith-heart-final-kit-fx',
    anchor: { x: 128.25, z: 112.25 },
    toward: { x: 188, z: 172 },
    bossTemplate: 'heart_masterless_strength',
    standOff: 26,
    raid: 4,
    raidSpread: 4,
    setup: [
      '/dev heart final reset',
      '/dev heart final quarter heat',
      '/dev heart final pull',
      '/dev heart final root',
      '/dev heart final fill heat 60',
    ],
    trigger: ['/dev heart final fill heat 82'],
  },
  // The boss's OWN elements (Jose's brief of 2026-11-19 (b)): Elemental
  // Strike on the witness (its tank) in each quarter's element, Elemental
  // Fusion's bar and each of its six combos in the quarter it entered, and
  // Opposing Elements (the boss handed to a raider so the witness can be
  // marked and see its own arrow).
  ...Object.fromEntries(
    ['heat', 'quench', 'breath', 'hammer'].map((v) => [
      `strike_${v}`,
      {
        tp: 'final',
        fxRoot: 'smith-heart-final-kit-fx',
        anchor: { x: 128.25, z: 112.25 },
        toward: { x: 188, z: 172 },
        bossTemplate: 'heart_masterless_strength',
        standOff: 9,
        raid: 4,
        raidSpread: 4.5,
        setup: ['/dev heart final reset', `/dev heart final quarter ${v}`, '/dev heart final pull'],
        // In the quarter (its element), the witness the boss's tank.
        spot: QUARTER_SPOTS[v],
        aggroTo: 'me',
        quiet: true,
        trigger: [
          ['/dev heart final strike 1', 1500],
          ['/dev heart final strike 1', 1500],
          ['/dev heart final strike 1', 1500],
          '/dev heart final strike 2',
        ],
        views: { close: [0.9, 0.22, 13], raid: [1.0, 0.12, 24] },
      },
    ]),
  ),
  ...Object.fromEntries(
    [
      ['steam', 'quench'],
      ['magma', 'hammer'],
      ['firestorm', 'breath'],
      ['hail', 'breath'],
      ['avalanche', 'hammer'],
      ['spires', 'hammer'],
    ].map(([combo, to]) => [
      `fusion_${combo}`,
      {
        tp: 'final',
        fxRoot: 'smith-heart-final-kit-fx',
        anchor: { x: 128.25, z: 112.25 },
        toward: { x: 188, z: 172 },
        bossTemplate: 'heart_masterless_strength',
        standOff: 8,
        raid: 6,
        raidSpread: 7,
        setup: [
          '/dev heart final reset',
          `/dev heart final quarter ${to}`,
          '/dev heart final pull',
        ],
        trigger: [`/dev heart final fusion ${combo}`],
        // Inside the quarter it enters, 30 yd out (the combo lands there).
        spot: QUARTER_SPOTS[to],
        quiet: true,
        views: {
          high: [0, 1.0, 46],
          raid: [0.6, 0.3, 32],
          close: [0.9, 0.3, 18],
          boss: [0, 0.12, 26],
        },
      },
    ]),
  ),
  opposites: {
    tp: 'final',
    fxRoot: 'smith-heart-final-kit-fx',
    anchor: { x: 128.25, z: 112.25 },
    toward: { x: 188, z: 172 },
    bossTemplate: 'heart_masterless_strength',
    standOff: 16,
    raid: 6,
    raidSpread: 8,
    setup: [
      '/dev heart final reset',
      '/dev heart final heroic',
      '/dev heart final quarter hammer',
      '/dev heart final pull',
    ],
    // The boss on Raider1 (its tank): the witness is free to be marked.
    aggroTo: 0,
    quiet: true,
    trigger: ['/dev heart final opposites'],
    // The marked meet: each walks to its opposite (Fire to Ice, Earth to
    // Lightning) after a few seconds.
    steer: 'polarityPairs',
    views: { high: [0.3, 0.7, 40], raid: [1.0, 0.16, 26], close: [0.9, 0.25, 16] },
  },
  wrath: {
    tp: 'gallery',
    fxRoot: 'smith-heart-council-fx',
    anchor: { x: -98, z: -232 },
    /** The pit's middle (instance-local): the witness stands there. */
    spot: { x: 8, z: -170 },
    bossTemplate: 'heart_hammer_guardian',
    standOff: 24,
    // The Quarry is walled in: the camera stays behind the witness.
    views: { raid: [0, 0.2, 24], high: [0.15, 0.75, 36], close: [0.35, 0.18, 18] },
    raid: 5,
    raidSpread: 7,
    setup: ['/dev heart council reset', '/dev heart council pull'],
    trigger: '/dev heart council wrath',
  },
  rush: {
    tp: 'gallery',
    fxRoot: 'smith-heart-council-fx',
    anchor: { x: -98, z: -232 },
    /** The pit's middle (instance-local): the witness stands there. */
    spot: { x: 8, z: -170 },
    bossTemplate: 'heart_hammer_guardian',
    standOff: 24,
    // The Quarry is walled in: the camera stays behind the witness.
    views: { raid: [0, 0.2, 24], high: [0.15, 0.75, 36], close: [0.35, 0.18, 18] },
    raid: 5,
    raidSpread: 7,
    setup: ['/dev heart council reset', '/dev heart council pull'],
    trigger: '/dev heart council rush',
  },
};
/** Camera holds per view: [yaw off the witness's facing, pitch (positive
 *  looks down), distance]. */
const VIEWS = {
  raid: [1.15, 0.06, 40],
  high: [0.3, 0.78, 52],
  close: [0.9, 0.28, 22],
};
const plan = PLANS[WHAT];
if (!plan) throw new Error(`SHOT_WHAT: one of ${Object.keys(PLANS).join(', ')}`);

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
    charName: 'Witness',
    gameBootTimeoutMs: 180000,
    selectorTimeoutMs: 90000,
    settleMs: 4000,
  });
  if (!booted) throw new Error('offline world did not boot');
  const chat = async (c, wait = 900) => {
    const reply = await page.evaluate((line) => window.__game.world.chat(line), c);
    if (reply) console.log(c, '->', String(reply).slice(0, 160));
    await sleep(wait);
  };
  for (const c of ['/dev level 20', '/dev god', '/dev heart enter']) await chat(c, 1500);
  await chat('/dev heart kill trash', 600);
  await chat('/dev heart gates', 600);
  await chat(`/dev heart tp ${plan.tp}`, 4000);
  await page.waitForFunction(
    (name) => {
      let found = false;
      window.__game.renderer.scene.traverse((o) => {
        if (o.name === name) found = true;
      });
      return found;
    },
    { timeout: 180000, polling: 1000 },
    plan.fxRoot,
  );
  await page.addStyleTag({ content: '#ui { display: none !important; }' });
  // The slot's origin from where the area set us down.
  const anchor = plan.anchor ?? { x: 0, z: 0 };
  const O = await page.evaluate(
    ([ax, az]) => {
      const p = window.__game.world.player;
      return { x: p.pos.x - ax, z: p.pos.z - az };
    },
    [anchor.x, anchor.z],
  );
  const toward = plan.toward ? { x: O.x + plan.toward.x, z: O.z + plan.toward.z } : null;
  const spot = plan.spot ? { x: O.x + plan.spot.x, z: O.z + plan.spot.z } : null;
  const views = { ...VIEWS, ...(plan.views ?? {}) };
  const [yaw, pitch, dist] = views[VIEW] ?? views.raid;
  const place = () =>
    page.evaluate(
      ([tmpl, standOff, bearing0, toward, spot, raid, spread, yaw, pitch, dist]) => {
        const w = window.__game.world;
        const p = w.player;
        let boss = null;
        for (const e of w.entities.values())
          if (e.kind === 'mob' && e.templateId === tmpl && !e.dead) boss = e;
        const bx = boss ? boss.pos.x : p.pos.x;
        const bz = boss ? boss.pos.z : p.pos.z;
        const bearing = toward ? Math.atan2(toward.x - bx, toward.z - bz) : bearing0;
        const sx = spot ? spot.x : bx + Math.sin(bearing) * standOff;
        const sz = spot ? spot.z : bz + Math.cos(bearing) * standOff;
        const move = (e, x, z) => {
          const g = w.ctx.groundPos(x, z);
          e.pos = { ...g };
          e.prevPos = { ...g };
          e.facing = Math.atan2(bx - x, bz - z);
          e.prevFacing = e.facing;
          w.ctx.rebucket(e);
        };
        move(p, sx, sz);
        window.__shotRaid ??= [];
        const classes = ['paladin', 'mage', 'priest', 'rogue', 'hunter', 'druid'].slice(0, raid);
        classes.forEach((c, i) => {
          let id = window.__shotRaid[i];
          if (id === undefined) {
            id = w.addPlayer(c, `Raider${i + 1}`);
            window.__shotRaid[i] = id;
          }
          const e = w.entities.get(id);
          e.devGod = true;
          const a = (i / raid) * Math.PI * 2 + 0.4;
          move(e, sx + Math.sin(a) * spread, sz + Math.cos(a) * spread);
        });
        if (!window.__shotHold) {
          window.__shotHold = true;
          const input = window.__game.input;
          const hold = () => {
            input.zoomMax = Math.max(input.zoomMax, dist);
            input.camYaw = p.facing + yaw;
            input.camPitch = pitch;
            input.camDist = dist;
            requestAnimationFrame(hold);
          };
          requestAnimationFrame(hold);
        }
      },
      [
        plan.bossTemplate,
        plan.standOff,
        plan.bearing ?? 0,
        toward,
        spot,
        plan.raid,
        plan.raidSpread,
        yaw,
        pitch,
        dist,
      ],
    );
  await place();
  await sleep(1500);
  await page.waitForFunction(
    () => !document.querySelector('#loading-screen')?.classList.contains('visible'),
    { timeout: 240000, polling: 500 },
  );
  for (const c of plan.setup) await chat(c, 1200);
  await place();
  // A quiet fight (the boss's own elements' captures): every other clock held
  // (the stars, the quarter kit, the Anvil, the strike and the polarity
  // rounds), re-held every half second, so the shot shows the one mechanic.
  if (plan.quiet)
    await page.evaluate((tmpl) => {
      const hold = () => {
        for (const e of window.__game.world.entities.values()) {
          const st = e.kind === 'mob' && e.templateId === tmpl ? e.smithHeartFinal : null;
          if (!st) continue;
          for (const v of ['heat', 'quench', 'breath', 'hammer']) st.stars.clock[v] = 1e9;
          st.anvilClock = 1e9;
          for (const k of Object.keys(st.kit)) if (typeof st.kit[k] === 'number') st.kit[k] = 1e9;
          st.elements.strikeClock = 1e9;
          st.elements.polarityClock = 1e9;
        }
      };
      hold();
      setInterval(hold, 500);
    }, plan.bossTemplate);
  if (plan.aggroTo !== undefined)
    await page.evaluate(
      ([tmpl, i]) => {
        const w = window.__game.world;
        const id = i === 'me' ? w.playerId : window.__shotRaid?.[i];
        for (const e of w.entities.values())
          if (e.kind === 'mob' && e.templateId === tmpl && !e.dead && id !== undefined) {
            e.threat.set(id, 1e9);
            e.forcedTargetId = id;
            e.forcedTargetTimer = 9999;
            e.aggroTargetId = id;
          }
      },
      [plan.bossTemplate, plan.aggroTo],
    );
  await sleep(Number(process.env.SHOT_SETTLE ?? 9000));
  await place();
  fs.mkdirSync(OUT, { recursive: true });
  for (const c of plan.pre ?? []) await chat(c, 100);
  // A trigger is one line, or a list of lines (a [line, ms] pair waits after it).
  for (const c of Array.isArray(plan.trigger) ? plan.trigger : [plan.trigger])
    if (Array.isArray(c)) await chat(c[0], c[1]);
    else await chat(c, 0);
  if (plan.steer === 'bladeThroughPillar')
    await page.evaluate(() => {
      const w = window.__game.world;
      const p = w.player;
      const until = Date.now() + 5000;
      const step = () => {
        if (Date.now() > until) return;
        let blade = null;
        for (const e of w.entities.values())
          if (e.kind === 'object' && e.templateId.startsWith('sh_final_blade_')) blade = e;
        if (!blade || blade.templateId.endsWith('fly')) {
          if (Date.now() < until) setTimeout(step, 100);
          return;
        }
        let best = null;
        let bestD = 1e9;
        for (const e of w.entities.values()) {
          if (e.kind !== 'object' || !e.templateId.startsWith('sh_final_pillar_')) continue;
          const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
          if (d < bestD) {
            bestD = d;
            best = e;
          }
        }
        if (best) {
          const dx = best.pos.x - blade.pos.x;
          const dz = best.pos.z - blade.pos.z;
          const L = Math.hypot(dx, dz) || 1;
          const g = w.ctx.groundPos(best.pos.x + (dx / L) * 6, best.pos.z + (dz / L) * 6);
          p.pos = { ...g };
          p.prevPos = { ...g };
          w.ctx.rebucket(p);
        }
        setTimeout(step, 100);
      };
      step();
    });
  if (plan.steer === 'polarityPairs')
    await page.evaluate(() => {
      const w = window.__game.world;
      const start = Date.now();
      const step = () => {
        const t = Date.now() - start;
        if (t > 9000) return;
        if (t > 3500) {
          const marked = [];
          for (const e of w.entities.values())
            if (e.kind === 'player' && !e.dead)
              for (const a of e.auras)
                if (a.id === 'heart_final_polarity')
                  marked.push({ e, v: Math.round(a.value ?? 0) });
          const opp = { 0: 1, 1: 0, 2: 3, 3: 2 };
          const used = new Set();
          for (const m of marked) {
            if (used.has(m.e.id)) continue;
            const o = marked.find((x) => !used.has(x.e.id) && x !== m && x.v === opp[m.v]);
            if (!o) continue;
            used.add(m.e.id);
            used.add(o.e.id);
            // The non-witness walks a step toward its partner each beat.
            const mover = o.e.id === w.playerId ? m.e : o.e;
            const goal = mover === m.e ? o.e : m.e;
            const dx = goal.pos.x - mover.pos.x;
            const dz = goal.pos.z - mover.pos.z;
            const L = Math.hypot(dx, dz);
            if (L > 1.5) {
              const k = Math.min(1, 0.7 / L);
              const g = w.ctx.groundPos(mover.pos.x + dx * k, mover.pos.z + dz * k);
              mover.prevPos = { ...mover.pos };
              mover.pos = { ...g };
              mover.facing = Math.atan2(dx, dz);
              w.ctx.rebucket(mover);
            }
          }
        }
        setTimeout(step, 100);
      };
      step();
    });
  const t0 = Date.now();
  const frames = [];
  while (Date.now() - t0 < SECONDS * 1000) {
    const t = (Date.now() - t0) / 1000;
    const file = path.join(
      OUT,
      `${TAG}_${String(frames.length).padStart(3, '0')}_${t.toFixed(2)}.jpg`,
    );
    fs.writeFileSync(file, await page.screenshot({ type: 'jpeg', quality: 90 }));
    frames.push({ file, t });
    // SHOT_PROBE=1: what the look drew a couple of seconds in (a dev read).
    if (process.env.SHOT_PROBE === '1' && frames.length === Number(process.env.SHOT_PROBE_AT ?? 30))
      console.log(
        'PROBE',
        await page.evaluate((re) => {
          const out = [];
          window.__game.renderer.scene.traverse((o) => {
            if (!new RegExp(re).test(o.name)) return;
            let v = true;
            for (let p = o; p; p = p.parent) if (!p.visible) v = false;
            const w = o.getWorldPosition(o.position.clone());
            out.push(
              `${o.name}:${v ? 'on' : 'off'}@${w.x.toFixed(1)},${w.y.toFixed(1)},${w.z.toFixed(1)}`,
            );
          });
          return out.join(' | ');
        }, process.env.SHOT_PROBE_RE ?? 'Strike|Anvil'),
      );
  }
  console.log('frames', frames.length);
  try {
    const require = createRequire(import.meta.url);
    const ffmpeg = require('ffmpeg-static');
    const list = path.join(OUT, `${TAG}_frames.txt`);
    const lines = [];
    for (let i = 0; i < frames.length; i++) {
      const d = i + 1 < frames.length ? frames[i + 1].t - frames[i].t : 0.2;
      lines.push(`file '${path.resolve(frames[i].file).replace(/\\/g, '/')}'`, `duration ${d}`);
    }
    lines.push(`file '${path.resolve(frames[frames.length - 1].file).replace(/\\/g, '/')}'`);
    fs.writeFileSync(list, lines.join('\n'));
    const video = path.join(OUT, `${TAG}.mp4`);
    execFileSync(ffmpeg, [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      list,
      '-vf',
      'fps=30,format=yuv420p',
      '-c:v',
      'libx264',
      '-crf',
      '20',
      video,
    ]);
    console.log('VIDEO', video);
  } catch (e) {
    console.log('no video:', e.message);
  }
} finally {
  await browser.close();
}
