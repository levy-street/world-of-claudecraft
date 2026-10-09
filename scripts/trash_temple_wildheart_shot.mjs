// Evidence shots and frame strips of the Drowned Temple and Wildheart Basin
// trash mechanics pass in a live offline world: each mechanic staged beside
// the player (its mobs spawned with the dev commands, helper players added to
// the offline Sim, the kit's clock wound so the wanted cast opens at once),
// then a few frames captured as it plays out. Evidence tooling, not a repo test.
//
//   node scripts/trash_temple_wildheart_shot.mjs [outRoot] [shotId ...]
//
// Writes <outRoot>/templo/*.png and <outRoot>/wildheart/*.png (one file per
// frame: <id>_<n>.png). Env: SHOT_URL (http://127.0.0.1:5250/), BROWSER_PATH,
// SHOT_PRESET (4), SHOT_W / SHOT_H (1600x900), SHOT_GPU=0 for SwiftShader.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5250/';
const ROOT = process.argv[2] ?? path.join('tmp', 'trash_temple_wildheart');
const ONLY = process.argv.slice(3);
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A phase is one dungeon run at one difficulty; its bench is an
// instance-local spot clear of every pack (found from the dev landing).
const PHASES = [
  {
    id: 'temple_normal',
    dir: 'templo',
    enter: ['/dev temple enter normal', '/dev temple gates', '/dev temple kill trash'],
    landing: '/dev temple tp landing',
    landingLocal: [0, -230],
    bench: [0, -12],
    keep: /^(choirmother_selthe|tideglass_colossus|ysolei|mere_hydra_head_)/,
  },
  {
    id: 'temple_heroic',
    dir: 'templo',
    // Select heroic first, then reset: the fresh claim takes the selection.
    enter: [
      '/dev temple enter heroic',
      '/dev temple reset',
      '/dev temple gates',
      '/dev temple kill trash',
    ],
    landing: '/dev temple tp landing',
    landingLocal: [0, -230],
    bench: [0, -12],
    keep: /^(choirmother_selthe|tideglass_colossus|ysolei|mere_hydra_head_)/,
  },
  {
    id: 'wildheart_normal',
    dir: 'wildheart',
    enter: ['/dev wildheart enter normal', '/dev wildheart gates', '/dev wildheart kill trash'],
    landing: '/dev wildheart tp island',
    // The dev arrival is the causeway foot (0, -44); the bench is the
    // Central Island's flat middle (the sim tests' bench).
    landingLocal: [0, -44],
    bench: [0, 16],
    keep: /^(great_saurian|wildheart_beastmaster|fanglord_jaguar|the_gorgebloom|wildheart_high_priest)/,
  },
];

// A shot: `spawn` [devSpawnKey, dx, dz][] (dx/dz relative to the player, who
// faces +z); `bots` [class, dx, dz][]; `stage` an in-page verb run after the
// spawn (force a cast, drop health, kill one); `frames` ms after the stage.
// Camera: yaw/pitch/dist (yaw relative to the player's facing).
const SHOTS = [
  // ---- Temple, normal
  {
    phase: 'temple_normal',
    id: 'velo_santuario',
    spawn: [
      ['acolyte', 0, 8],
      ['pilgrim', -3, 6],
      ['pilgrim', 3, 6],
    ],
    stage: 'tank',
    frames: [1200, 2400],
    cam: { yaw: 0.5, pitch: 0.32, dist: 13 },
  },
  {
    phase: 'temple_normal',
    id: 'velo_roto',
    spawn: [
      ['acolyte', 0, 8],
      ['pilgrim', -3, 6],
      ['pilgrim', 3, 6],
    ],
    stage: 'tank',
    stage2: 'kill:drowned_pilgrim',
    stage2Wait: 1200,
    frames: [80, 400, 900],
    cam: { yaw: 0.5, pitch: 0.32, dist: 13 },
  },
  {
    phase: 'temple_normal',
    id: 'destello_prisma',
    spawn: [['lurker', 0, 7]],
    stage: 'cast:glimmerscale_lurker:gaze',
    frames: [500, 1300, 1950, 2300, 2900],
    cam: { yaw: 0.6, pitch: 0.25, dist: 12 },
  },
  {
    phase: 'temple_normal',
    id: 'remolino_espiral',
    spawn: [['snapper', 0, 6]],
    bots: [
      ['mage', -5, 9],
      ['priest', 5, 3],
    ],
    stage: 'low:lagoon_snapper:0.3',
    frames: [500, 1500, 3000],
    cam: { yaw: 0.4, pitch: 0.55, dist: 18 },
  },
  {
    phase: 'temple_normal',
    id: 'chispa_saltarina',
    spawn: [['eel', 0, 10]],
    bots: [
      ['mage', -3, -2],
      ['priest', 2, -3],
      ['warrior', -1, -6],
    ],
    stage: 'cast:ice_wraith:spark',
    frames: [900],
    // A screenshot takes about 0.45 s: catch the 0.5 s arcs by polling for
    // the landing and shooting at once.
    land: 'ice_wraith',
    landFrames: 2,
    cam: { yaw: 0.9, pitch: 0.4, dist: 17 },
  },
  {
    phase: 'temple_normal',
    id: 'espiritu_escarcha',
    spawn: [['wisp', 0, 4]],
    stage: 'tank',
    frames: [300, 700, 1300],
    cam: { yaw: 0.6, pitch: 0.3, dist: 11 },
  },
  // ---- Temple, heroic
  {
    phase: 'temple_heroic',
    id: 'juramento_guardian',
    spawn: [
      ['acolyte', 0, 9],
      ['templeguard', 3, 7],
    ],
    bots: [['mage', -8, -6]],
    stage: 'cast:pale_choir_acolyte:lullaby',
    frames: [500, 1200],
    cam: { yaw: 0.8, pitch: 0.3, dist: 15 },
  },
  {
    phase: 'temple_heroic',
    id: 'eco_nana',
    spawn: [['acolyte', 0, 9]],
    bots: [
      ['mage', -8, -6],
      ['priest', -6, -8],
      ['warrior', -11, -4],
    ],
    stage: 'cast:pale_choir_acolyte:lullaby',
    frames: [1500, 2300, 3200, 4200],
    cam: { yaw: -0.4, pitch: 0.42, dist: 18 },
  },
  {
    phase: 'temple_heroic',
    id: 'marea_hinchada',
    spawn: [
      ['wisp', -1, 12],
      ['wisp', 1, 12],
    ],
    stage: 'tank',
    frames: [200, 900, 1800],
    cam: { yaw: 0.6, pitch: 0.28, dist: 13 },
  },
  // ---- Wildheart, normal
  {
    phase: 'wildheart_normal',
    id: 'frenesi_manada',
    spawn: [
      ['raptor', -3, 5],
      ['raptor', 3, 5],
      ['raptor', 0, 7],
      ['raptor', 0, 4],
    ],
    stage: 'tank',
    stage2: 'kill:basin_raptor',
    stage2Wait: 1000,
    frames: [150, 700, 2000],
    cam: { yaw: 0.5, pitch: 0.3, dist: 14 },
  },
  {
    phase: 'wildheart_normal',
    id: 'marca_presa',
    spawn: [
      ['stalker', 0, 14],
      ['raptor', -2, 4],
      ['raptor', 2, 4],
    ],
    bots: [['priest', -10, -8]],
    stage: 'cast:wildheart_stalker:mark',
    frames: [700, 1550, 2300, 3200],
    cam: { yaw: -0.7, pitch: 0.4, dist: 20 },
  },
  {
    phase: 'wildheart_normal',
    id: 'rugido_guerra',
    spawn: [
      ['ravager', -2, 5],
      ['ravager', 3, 6],
    ],
    stage: 'low:wildheart_ravager:0.25',
    frames: [700, 1600, 2200, 3000],
    cam: { yaw: 0.6, pitch: 0.35, dist: 18 },
  },
  {
    phase: 'wildheart_normal',
    id: 'maleficio_sapo',
    spawn: [['hexcaller', 0, 10]],
    bots: [['mage', -6, -6]],
    stage: 'cast:wildheart_hexcaller:hex',
    frames: [900, 2200, 3000],
    cam: { yaw: -0.5, pitch: 0.3, dist: 14 },
  },
  {
    phase: 'wildheart_normal',
    id: 'totem_pavor',
    spawn: [['dreadtotem', 0, 4]],
    bots: [
      ['mage', -3, 2],
      ['priest', 3, 1],
    ],
    stage: 'cast:sunbone_dread_totem:dread',
    frames: [600, 1500, 2150, 2800],
    cam: { yaw: 0.5, pitch: 0.45, dist: 17 },
  },
  {
    phase: 'wildheart_normal',
    id: 'lengua_atrapadora',
    spawn: [['toad', 0, 4]],
    bots: [['mage', 0, -12]],
    stage: 'cast:spore_toad:tongue',
    frames: [700],
    land: 'spore_toad',
    landFrames: 3,
    cam: { yaw: 1.4, pitch: 0.35, dist: 18 },
  },
  // The Blender bodies (feature/wildheart-models): the raptor's leap, the
  // Binder planting a totem, the Sunbone Totem rising and mending, the spore
  // toad bursting.
  {
    phase: 'wildheart_normal',
    id: 'raptor_salto',
    spawn: [['raptor', 0, 14]],
    stage: 'cast:basin_raptor:leap',
    frames: [120, 320, 560, 1000],
    cam: { yaw: 1.3, pitch: 0.25, dist: 16 },
  },
  {
    phase: 'wildheart_normal',
    id: 'atador_totem',
    spawn: [['binder', 0, 6]],
    stage: 'cast:sunbone_totem_binder:totems',
    frames: [700, 1350, 1650, 2300, 3200],
    cam: { yaw: 0.9, pitch: 0.3, dist: 16 },
  },
  {
    phase: 'wildheart_normal',
    id: 'totem_sol',
    spawn: [['totem', 0, 6]],
    stage: 'tank',
    frames: [250, 700, 1600, 2300],
    cam: { yaw: 0.5, pitch: 0.3, dist: 16 },
  },
  {
    phase: 'wildheart_normal',
    id: 'sapo_revienta',
    spawn: [['toad', 0, 6]],
    stage: 'kill:spore_toad',
    frames: [250, 650, 1100, 2000],
    cam: { yaw: 0.8, pitch: 0.3, dist: 15 },
  },
  {
    phase: 'wildheart_normal',
    id: 'corteza_espinosa',
    spawn: [['lasher', 0, 3]],
    stage: 'swing:vine_lasher',
    frames: [1500, 2100, 2600, 3200],
    cam: { yaw: 0.7, pitch: 0.25, dist: 11 },
  },
];

/** In-page: run one stage verb. Returns a short probe string. */
function pageStage(verb) {
  const sim = window.__game.world;
  const me = sim.player;
  const [what, id, arg] = verb.split(':');
  const nearest = (templateId) => {
    let best = null;
    let bestD = Infinity;
    for (const e of sim.entities.values()) {
      if (e.kind !== 'mob' || e.dead || e.templateId !== templateId) continue;
      const d = Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  };
  me.hp = me.maxHp;
  if (what === 'tank') return 'ok';
  const mob = nearest(id);
  if (!mob) return `no ${id}`;
  if (what === 'kill') {
    sim.ctx.handleDeath(mob, me);
    return `killed ${mob.id}`;
  }
  if (what === 'swing') {
    // Melee it: the player's own swings (the Snarlbark pricks them).
    mob.maxHp = 1e6;
    mob.hp = 1e6;
    sim.targetEntity(mob.id);
    sim.startAutoAttack();
    return `swing ${mob.id}`;
  }
  if (what === 'low') {
    mob.hp = Math.max(1, Math.floor(mob.maxHp * Number(arg)));
    return `low ${mob.id}`;
  }
  if (what === 'cast') {
    const st = mob.trashKit;
    if (!st) return `no kit on ${mob.id}`;
    for (const k of Object.keys(st.timers)) st.timers[k] = 99;
    st.timers[arg] = 0;
    // Drop a bar already running, so the wanted cast opens on the next tick.
    st.cast = null;
    mob.castingAbility = null;
    mob.castRemaining = 0;
    mob.castTotal = 0;
    mob.castTargetId = null;
    const inst = sim.ctx.instances.find((i) => i.mobIds.includes(mob.id));
    return `cast ${arg} on ${mob.id} (${inst?.difficulty ?? '?'})`;
  }
  return `unknown ${verb}`;
}

async function main() {
  const gpu = process.env.SHOT_GPU !== '0';
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: [
      `--window-size=${W},${H}`,
      ...(gpu
        ? ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']
        : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    ],
    defaultViewport: { width: W, height: H },
    protocolTimeout: 240000,
  });
  const chat = (page, c) => page.evaluate((cmd) => window.__game.world.chat(cmd), c);
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 300));
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
      charName: 'Tidewader',
      gameBootTimeoutMs: 180000,
      selectorTimeoutMs: 90000,
      settleMs: 4000,
    });
    if (!booted) throw new Error('offline world did not boot');
    for (const c of ['/dev level 20', '/dev god']) {
      await chat(page, c);
      await sleep(1000);
    }
    await page.addStyleTag({ content: '#nameplates { display: none !important; }' });
    let bots = 0;
    for (const phase of PHASES) {
      const shots = SHOTS.filter(
        (s) => s.phase === phase.id && (ONLY.length === 0 || ONLY.includes(s.id)),
      );
      if (shots.length === 0) continue;
      for (const c of phase.enter) {
        await chat(page, c);
        await sleep(1500);
      }
      await sleep(6000);
      await chat(page, phase.landing);
      await sleep(1500);
      const base = await page.evaluate(() => {
        const p = window.__game.world.player;
        return { x: p.pos.x, z: p.pos.z };
      });
      const origin = phase.landingLocal
        ? { x: base.x - phase.landingLocal[0], z: base.z - phase.landingLocal[1] }
        : { x: base.x, z: base.z };
      const outDir = path.join(ROOT, phase.dir);
      fs.mkdirSync(outDir, { recursive: true });
      for (const shot of shots) {
        // A clean bench: every stray mob dies, every helper player leaves.
        await page.evaluate((keepSrc) => {
          const sim = window.__game.world;
          const keep = new RegExp(keepSrc);
          for (const e of [...sim.entities.values()]) {
            if (e.kind === 'mob' && !e.dead && !keep.test(e.templateId))
              sim.ctx.handleDeath(e, sim.player);
            if (e.kind === 'player' && e.id !== sim.player.id) sim.removePlayer?.(e.id);
          }
          for (const id of [...sim.ctx.entities.keys()]) {
            const e = sim.ctx.entities.get(id);
            if (e?.kind === 'mob' && e.dead && !keep.test(e.templateId)) sim.ctx.dropEntity(id);
          }
        }, phase.keep.source);
        await sleep(800);
        await chat(page, `/dev tp ${origin.x + phase.bench[0]} ${origin.z + phase.bench[1]}`);
        await sleep(900);
        // Face +z so the spawns' dx/dz read as authored.
        await page.evaluate(() => {
          const p = window.__game.world.player;
          p.facing = 0;
          p.prevFacing = 0;
        });
        const prefix = phase.dir === 'templo' ? 'temple' : 'wildheart';
        for (const [key, dx, dz] of shot.spawn ?? []) {
          await chat(page, `/dev ${prefix} spawn ${key}`);
          await sleep(250);
          await page.evaluate(
            ([ddx, ddz]) => {
              const sim = window.__game.world;
              const me = sim.player;
              let newest = null;
              for (const e of sim.entities.values())
                if (e.kind === 'mob' && !e.dead && (!newest || e.id > newest.id)) newest = e;
              if (!newest) return;
              const g = sim.ctx.groundPos(me.pos.x + ddx, me.pos.z + ddz);
              newest.pos = g;
              newest.prevPos = { ...g };
              newest.leashAnchor = { ...g };
            },
            [dx, dz],
          );
        }
        for (const [cls, dx, dz] of shot.bots ?? []) {
          await page.evaluate(
            ([c, ddx, ddz, n]) => {
              const sim = window.__game.world;
              const me = sim.player;
              const pid = sim.addPlayer(c, `Helper${n}`);
              const e = sim.ctx.entities.get(pid);
              const g = sim.ctx.groundPos(me.pos.x + ddx, me.pos.z + ddz);
              e.pos = g;
              e.prevPos = { ...g };
              e.maxHp = 1e6;
              e.hp = 1e6;
              e.facing = Math.PI;
            },
            [cls, dx, dz, bots++],
          );
        }
        await sleep(700);
        if (shot.stage) console.log('STAGE', shot.id, await page.evaluate(pageStage, shot.stage));
        if (process.env.SHOT_PROBE) {
          await sleep(400);
          console.log(
            'PROBE',
            shot.id,
            await page.evaluate(() => {
              const sim = window.__game.world;
              const out = [];
              for (const e of sim.entities.values())
                if (e.kind === 'mob' && !e.dead && e.trashKit)
                  out.push(
                    `${e.templateId} ai=${e.aiState} cast=${e.castingAbility} t=${JSON.stringify(e.trashKit.timers)}`,
                  );
              return out.join(' | ');
            }),
          );
        }
        if (shot.stage2) {
          await sleep(shot.stage2Wait ?? 800);
          console.log('STAGE2', shot.id, await page.evaluate(pageStage, shot.stage2));
        }
        await page.evaluate((cam) => {
          const input = window.__game.input;
          input.camYaw = cam.yaw ?? 0;
          input.camPitch = cam.pitch;
          input.camDist = cam.dist;
        }, shot.cam);
        let last = 0;
        for (let n = 0; n < shot.frames.length; n++) {
          await sleep(Math.max(0, shot.frames[n] - last));
          last = shot.frames[n];
          const file = path.join(outDir, `${shot.id}_${n + 1}.png`);
          await page.screenshot({ path: file });
          console.log('SHOT', file);
        }
        if (shot.land) {
          await page.waitForFunction(
            (id) => {
              const sim = window.__game.world;
              for (const e of sim.entities.values())
                if (e.templateId === id && !e.dead && e.castingAbility !== null) return false;
              return true;
            },
            { timeout: 8000, polling: 16 },
            shot.land,
          );
          for (let k = 0; k < shot.landFrames; k++) {
            const file = path.join(outDir, `${shot.id}_${shot.frames.length + k + 1}.png`);
            await page.screenshot({ path: file });
            console.log('SHOT', file);
          }
        }
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
