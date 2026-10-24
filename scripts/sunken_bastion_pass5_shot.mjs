// Evidence shots of the Sunken Bastion's fifth pass in a live offline world,
// each beside the player: the Gaol Turnkey miniboss and its Iron Cage (the
// shadow, the drop, the escape prompt filling as the key is mashed, the cage
// bursting), Gaoler Ossick's Drowned Anchor (the mark, the drag, the hot
// chain, the chain alert) and Shackle Pair (strained and calm, with the
// alert), and Vael the reaper (his look, the Shadow Crossing: the vanish, the
// pool behind his mark, the rise, the sweep; his shadow copies and the
// beacon's beam). A party warrior (Ironjaw) holds each boss so the
// player-picked mechanics can fall on the local player; every ally is in god
// mode and the claim's trash is cleared first. Evidence tooling, not a repo
// test.
//
//   node scripts/sunken_bastion_pass5_shot.mjs <outDir> [turnkey|ossick|vael|veil|all] [before]
//
// `veil` frames the Fog Veil alone: the four figures rising, then the beam
// finding the real Vael.
//
// `before` runs the same framing against a build without the fifth pass (the
// old mechanics' triggers). Env: SHOT_URL (http://127.0.0.1:5200/), SHOT_W /
// SHOT_H (1600x900), SHOT_PRESET (4).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5200/';
const OUT = process.argv[2] ?? path.join('tmp', 'sunken_bastion_pass5');
const MODE = process.argv[3] ?? 'all';
const BEFORE = process.argv[4] === 'before';
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PACKS = ['f1', 'f2', 'fa', 'fb', 'f3', 'b1', 'b2', 'hermit', 'bc', 'r1', 'r2', 'rc'];
const GAOL = ['g1', 'g2', 'g3', 'gd'];
const KEEP = ['k1', 'k2', 'k3', 'kc'];

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
    charName: 'Gaolbreaker',
    gameBootTimeoutMs: 180000,
    selectorTimeoutMs: 90000,
    settleMs: 4000,
  });
  if (!booted) throw new Error('offline world did not boot');
  const chat = async (c, wait = 900) => {
    await page.evaluate((line) => window.__game.world.chat(line), c);
    await sleep(wait);
  };
  for (const c of ['/dev level 20', '/dev bastion enter', '/dev bastion gates'])
    await chat(c, 1300);
  for (const p of [...PACKS, ...GAOL, ...KEEP]) await chat(`/dev bastion kill ${p}`, 120);
  await chat('/dev bastion kill olen', 200);
  await chat('/dev bastion tp turnkey', 2500);
  // The claim's origin, read off the Turnkey's authored post (-24, 102).
  const O = await page.evaluate(() => {
    const w = window.__game.world;
    for (const e of w.ctx.entities.values())
      if (e.templateId === 'gaol_turnkey') return { x: e.pos.x + 24, z: e.pos.z - 102 };
    const p = w.player;
    return { x: p.pos.x + 12, z: p.pos.z - 92 };
  });
  // Every trash mob left in the claim (the patrols the pack kills miss, the
  // gaol's held prisoners) goes, so nothing but the bosses joins a shot.
  await page.evaluate(
    ([ox, oz]) => {
      const w = window.__game.world;
      const bosses = new Set([
        'knight_commander_olen',
        'gaol_turnkey',
        'gaoler_ossick',
        'vael_the_mistcaller',
      ]);
      for (const e of [...w.ctx.entities.values()]) {
        if (e.kind !== 'mob' || e.dead || bosses.has(e.templateId)) continue;
        if (Math.abs(e.pos.x - ox) > 260 || Math.abs(e.pos.z - oz) > 320) continue;
        w.ctx.handleDeath(e, w.player);
      }
    },
    [O.x, O.z],
  );
  await chat('/dev god', 400);
  const hideUi = await page.addStyleTag({ content: '#ui { display: none !important; }' });
  const showUi = async (on) =>
    page.evaluate((on) => {
      for (const s of document.querySelectorAll('style'))
        if (s.textContent?.includes('#ui { display: none')) s.disabled = on;
    }, on);
  void hideUi;
  /** Stand the player at local (x, z) facing (fx, fz); the camera orbits behind
   *  at yaw offset `yaw`, pitch and distance. */
  const stand = async (x, z, fx, fz, yaw, pitch, dist) =>
    page.evaluate(
      ([ox, oz, x, z, fx, fz, yaw, pitch, dist]) => {
        const w = window.__game.world;
        const p = w.player;
        const g = w.ctx.groundPos(ox + x, oz + z);
        if (Math.abs(g.y - p.pos.y) > 4) g.y = p.pos.y;
        p.pos = { ...g };
        p.prevPos = { ...g };
        p.facing = Math.atan2(fx - x, fz - z);
        p.prevFacing = p.facing;
        const input = window.__game.input;
        input.camYaw = p.facing + yaw;
        input.camPitch = pitch;
        input.camDist = dist;
      },
      [O.x, O.z, x, z, fx, fz, yaw, pitch, dist],
    );
  const shot = async (name) => {
    // The party's loot settings window pops open when the first ally joins.
    await page.evaluate(() => {
      const ui = document.getElementById('ui');
      let win = document.getElementById('loot-settings-title');
      while (win?.parentElement && win.parentElement !== ui && win.parentElement !== document.body)
        win = win.parentElement;
      if (win) win.style.display = 'none';
    });
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file });
    console.log('SHOT', file);
  };
  /** Pull a boss onto the player (or onto `tankId`), with a deep pool so the
   *  fight runs on. */
  const engage = async (templateId, x, z, tankId = -1) =>
    page.evaluate(
      ([ox, oz, id, x, z, tankId]) => {
        const w = window.__game.world;
        const tank = w.ctx.entities.get(tankId) ?? w.player;
        for (const e of w.ctx.entities.values()) {
          if (e.kind !== 'mob' || e.templateId !== id || e.dead) continue;
          const g = w.ctx.groundPos(ox + x, oz + z);
          if (Math.abs(g.y - e.pos.y) > 4) g.y = e.pos.y;
          e.pos = { ...g };
          e.prevPos = { ...g };
          e.maxHp = 1e6;
          e.hp = 1e6;
          w.ctx.aggroMob(e, tank, false);
          return e.id;
        }
        return -1;
      },
      [O.x, O.z, templateId, x, z, tankId],
    );
  /** A party warrior at (x, z) who holds a boss's attention, so the boss's
   *  player-picked mechanics fall on the local player. */
  const tankAlly = async (x, z) =>
    page.evaluate(
      ([ox, oz, x, z]) => {
        const w = window.__game.world;
        const pid = w.addPlayer('warrior', 'Ironjaw');
        w.partyInvite(pid, w.player.id);
        w.partyAccept(pid);
        w.chat('/dev bastion enter', pid);
        w.chat('/dev god', pid);
        const e = w.ctx.entities.get(pid);
        const g = w.ctx.groundPos(ox + x, oz + z);
        if (Math.abs(g.y - w.player.pos.y) > 4) g.y = w.player.pos.y;
        e.pos = { ...g };
        e.prevPos = { ...g };
        e.maxHp = 1e7;
        e.hp = 1e7;
        return pid;
      },
      [O.x, O.z, x, z],
    );
  /** Two party members standing where the mechanics can take them. */
  const allies = async (spots) =>
    page.evaluate(
      ([ox, oz, spots]) => {
        const w = window.__game.world;
        const me = w.player.id;
        const ids = [];
        for (const [i, [x, z]] of spots.entries()) {
          const pid = w.addPlayer(i % 2 ? 'priest' : 'mage', i % 2 ? 'Saltmarrow' : 'Tidewren');
          w.partyInvite(pid, me);
          w.partyAccept(pid);
          w.chat('/dev bastion enter', pid);
          w.chat('/dev god', pid);
          w.chat('/dev god', pid);
          const e = w.ctx.entities.get(pid);
          const g = w.ctx.groundPos(ox + x, oz + z);
          if (Math.abs(g.y - w.player.pos.y) > 4) g.y = w.player.pos.y;
          e.pos = { ...g };
          e.prevPos = { ...g };
          e.maxHp = 1e7;
          e.hp = 1e7;
          ids.push(pid);
        }
        return ids;
      },
      [O.x, O.z, spots],
    );
  /** The id of a party member added earlier by name (null when absent). */
  const partyId = (name) =>
    page.evaluate((name) => {
      for (const e of window.__game.world.ctx.entities.values())
        if (e.kind === 'player' && e.name === name) return e.id;
      return null;
    }, name);
  const placeById = (id, x, z) =>
    page.evaluate(
      ([ox, oz, id, x, z]) => {
        const w = window.__game.world;
        const e = w.ctx.entities.get(id);
        if (!e) return;
        const g = w.ctx.groundPos(ox + x, oz + z);
        if (Math.abs(g.y - w.player.pos.y) > 4) g.y = w.player.pos.y;
        e.pos = { ...g };
        e.prevPos = { ...g };
      },
      [O.x, O.z, id, x, z],
    );
  /** Fire a dev trigger until the boss's bar for it is running (the boss may
   *  be mid-swing or mid-cast when first asked). */
  const triggerUntil = async (what, bossId, castId) => {
    for (let i = 0; i < 20; i++) {
      await chat(`/dev bastion trigger ${what}`, 150);
      const running = await page.evaluate(
        ([bossId, castId]) => {
          for (const e of window.__game.world.ctx.entities.values())
            if (e.templateId === bossId && !e.dead && e.castingAbility === castId) return true;
          return false;
        },
        [bossId, castId],
      );
      if (running) return true;
      await sleep(250);
    }
    console.log(
      `trigger ${what} never started:`,
      await page.evaluate((bossId) => {
        const out = [];
        for (const e of window.__game.world.ctx.entities.values())
          if (e.templateId === bossId)
            out.push(
              `#${e.id} dead=${e.dead} ai=${e.aiState} combat=${e.inCombat} cast=${e.castingAbility} fight=${e.bastionFight?.kind} aggro=${e.aggroTargetId}`,
            );
        return out.join(' | ');
      }, bossId),
    );
    return false;
  };
  const keepAlive = () =>
    page.evaluate(() => {
      for (const e of window.__game.world.ctx.entities.values())
        if (e.kind === 'player' && e.hp < e.maxHp * 0.5) e.hp = e.maxHp;
    });

  if (MODE === 'turnkey' || MODE === 'all') {
    await stand(-15, 92, -24, 102, 0.3, 0.2, 10);
    await sleep(3500);
    await shot('turnkey_01_miniboss_junto_al_jugador');
    await stand(-10, 87, -24, 102, 0.45, 0.32, 18);
    await sleep(1200);
    await shot('turnkey_02_miniboss_de_lejos');
    if (!BEFORE) {
      const ironjaw = await tankAlly(-21, 100);
      await engage('gaol_turnkey', -23, 102, ironjaw);
      await sleep(1200);
      await stand(-14, 92, -23, 102, 0.35, 0.5, 13);
      await chat('/dev bastion trigger cage', 100);
      await sleep(900);
      await shot('turnkey_03_sombra_de_la_jaula');
      await sleep(900);
      await shot('turnkey_04_jaula_cae');
      await sleep(600);
      await stand(-14, 92, -23, 102, 0.35, 0.35, 11);
      await showUi(true);
      await sleep(500);
      await shot('turnkey_05_atrapado_con_aviso');
      for (let i = 0; i < 8; i++) {
        await page.evaluate(() => window.__game.world.interact());
        await sleep(150);
      }
      await shot('turnkey_06_machacando_tecla');
      await showUi(false);
      await stand(-14, 92, -23, 102, Math.PI - 0.7, 0.15, 7);
      await sleep(300);
      await shot('turnkey_07_jaula_de_cerca');
      await stand(-14, 92, -23, 102, 0.35, 0.35, 11);
      await showUi(true);
      for (let i = 0; i < 30; i++) {
        await page.evaluate(() => window.__game.world.interact());
        await sleep(130);
      }
      await showUi(false);
      await sleep(200);
      await shot('turnkey_08_jaula_rota');
      await keepAlive();
    }
  }

  if (MODE === 'ossick' || MODE === 'all') {
    await chat('/dev bastion kill turnkey', 300);
    const ironjaw = (await partyId('Ironjaw')) ?? (await tankAlly(-2, 9));
    await placeById(ironjaw, -2, 9);
    await allies([
      [-14, 36],
      [10, 38],
    ]);
    await stand(4, 4, -2, 12, 0.35, 0.2, 10);
    await sleep(2500);
    await shot('ossick_01_carcelero_junto_al_jugador');
    await engage('gaoler_ossick', -2, 12, ironjaw);
    await sleep(800);
    if (BEFORE) {
      await chat('/dev bastion trigger hook', 100);
      await stand(8, 34, -2, 20, 0, 0.6, 20);
      await sleep(2600);
      await shot('ossick_02_gancho_y_postes');
    } else {
      await stand(4, 38, -2, 22, 0.4, 0.62, 19);
      await triggerUntil('anchor', 'gaoler_ossick', 'bastion_drowned_anchor_cast');
      await sleep(1000);
      await shot('ossick_02_marca_del_ancla');
      await sleep(1200);
      await shot('ossick_03_ancla_cae');
      await stand(4, 38, -2, 22, Math.PI - 0.6, 0.25, 8);
      await sleep(300);
      await shot('ossick_04_ancla_de_cerca');
      await stand(4, 38, -2, 22, 0.4, 0.62, 19);
      await showUi(true);
      await sleep(1600);
      await shot('ossick_05_arrastrado_con_aviso');
      await sleep(2200);
      await shot('ossick_06_cadena_al_rojo');
      await showUi(false);
      await sleep(4500);
      await keepAlive();
      // Nobody hurts him in these shots, so he drifts out of the fight: pull again.
      await engage('gaoler_ossick', -2, 12, ironjaw);
      await sleep(600);
      await triggerUntil('shackle', 'gaoler_ossick', 'bastion_shackle_pair');
      await sleep(1600);
      // Stretch the pair past the chain's reach, then bring them together.
      const pair = (spread) =>
        page.evaluate(
          ([ox, oz, spread]) => {
            const w = window.__game.world;
            const ids = [];
            for (const e of w.ctx.entities.values())
              if (e.kind === 'player' && e.auras.some((a) => a.id === 'bastion_shackled'))
                ids.push(e.id);
            ids.forEach((id, i) => {
              const e = w.ctx.entities.get(id);
              const g = w.ctx.groundPos(ox + 2 + (i === 0 ? -spread : spread), oz + 38);
              e.pos = { ...g };
              e.prevPos = { ...g };
            });
            return ids.includes(w.player.id);
          },
          [O.x, O.z, spread],
        );
      const mine = await pair(6);
      if (mine) {
        const x = await page.evaluate((ox) => window.__game.world.player.pos.x - ox, O.x);
        await stand(x, 38, 2, 26, 0.9, 0.95, 14);
      } else await stand(2, 44, 2, 26, 0.9, 0.95, 14);
      await pair(6);
      await showUi(true);
      await sleep(1600);
      await shot('ossick_07_grilletes_tensos');
      await pair(1.5);
      if (mine) {
        const x = await page.evaluate((ox) => window.__game.world.player.pos.x - ox, O.x);
        await stand(x, 38, 2, 26, 0.9, 0.95, 14);
        await pair(1.5);
      }
      await sleep(1400);
      await shot('ossick_08_grilletes_juntos');
      await showUi(false);
    }
    await keepAlive();
  }

  if (MODE === 'vael' || MODE === 'veil' || MODE === 'all') {
    await chat('/dev bastion kill ossick', 400);
    await chat('/dev bastion tp crown', 2500);
    const ironjaw = (await partyId('Ironjaw')) ?? (await tankAlly(-4, 222));
    await placeById(ironjaw, -4, 222);
    // The arena is the ring round the Fogbeacon (centre -4, 208): every camera
    // stands on the ring's open side, never behind the tower.
    await stand(8, 222, -4, 226, 0.35, 0.15, 10);
    await sleep(3500);
    await shot('vael_01_la_muerte_junto_al_jugador');
    await stand(2, 223, -4, 226, 0.25, -0.3, 7);
    await sleep(800);
    await shot('vael_02_rostro_de_cerca');
    const ids = await page.evaluate(() =>
      [...window.__game.world.ctx.entities.values()]
        .filter(
          (e) =>
            e.kind === 'player' && e.id !== window.__game.world.player.id && e.name !== 'Ironjaw',
        )
        .map((e) => e.id),
    );
    if (ids.length === 0)
      await allies([
        [6, 214],
        [-14, 214],
      ]);
    else for (const [i, id] of ids.entries()) await placeById(id, i % 2 ? -14 : 6, 214);
    await engage('vael_the_mistcaller', -4, 226, ironjaw);
    await stand(12, 222, -4, 218, 0.5, 0.85, 24);
    await sleep(1500);
    if (!BEFORE && MODE !== 'veil') {
      await triggerUntil('reap', 'vael_the_mistcaller', 'bastion_shadowstep');
      await sleep(250);
      await shot('vael_03_se_hunde_en_la_sombra');
      await sleep(900);
      await shot('vael_04_charco_detras_del_objetivo');
      await sleep(700);
      await shot('vael_05_arco_de_la_guadana');
      await sleep(700);
      await shot('vael_06_emerge_detras');
      await sleep(450);
      await shot('vael_07_barrido');
      await sleep(3000);
      await keepAlive();
      await engage('vael_the_mistcaller', -4, 226, ironjaw);
      await sleep(600);
    }
    if (MODE === 'veil') {
      // The Fog Veil up close: the four figures rising out of the roof, then
      // the beam's sweep until it finds the real one (his lantern flares).
      await stand(-4, 196, -4, 208, 0, 0.5, 38);
      await sleep(600);
      await chat('/dev bastion trigger veil', 0);
      for (const ms of [100, 400, 800]) {
        await sleep(ms === 100 ? 100 : 200);
        await shot(`vael_veil_alza_${ms}ms`);
      }
      for (let i = 0; i < 16; i++) {
        await sleep(350);
        const lit = await page.evaluate(() => {
          const w = window.__game.world;
          let vael = null;
          let lamp = null;
          for (const e of w.ctx.entities.values()) {
            if (e.templateId === 'vael_the_mistcaller' && !e.dead) vael = e;
            if (e.templateId === 'bastion_beacon_lamp') lamp = e;
          }
          if (!vael || !lamp) return false;
          const a = Math.atan2(vael.pos.x - lamp.pos.x, vael.pos.z - lamp.pos.z);
          let d = a - lamp.facing;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          return Math.abs(d) < 0.6;
        });
        if (lit) {
          // Frame the real one up close: his lantern flares.
          const at = await page.evaluate(
            ([ox, oz]) => {
              const w = window.__game.world;
              for (const e of w.ctx.entities.values())
                if (e.templateId === 'vael_the_mistcaller' && !e.dead)
                  return { x: e.pos.x - ox, z: e.pos.z - oz };
              return null;
            },
            [O.x, O.z],
          );
          if (at) {
            const dx = -4 - at.x;
            const dz = 208 - at.z;
            const d = Math.hypot(dx, dz) || 1;
            await stand(at.x + (dx / d) * 7, at.z + (dz / d) * 7, at.x, at.z, 0.5, 0.2, 9);
          }
          await sleep(200);
          await shot('vael_veil_farol_revela_al_real');
          console.log(
            'REVEAL',
            await page.evaluate(() => {
              const out = [];
              window.__game.renderer.scene.traverse((o) => {
                if (!o.isSprite || !o.visible) return;
                const c = o.material.color.getHex().toString(16);
                if (c === 'ffc56a' || c === 'fff8e8' || c === '9dffc6')
                  out.push(`${c}@${o.position.y.toFixed(1)} a${o.material.opacity.toFixed(2)}`);
              });
              const w = window.__game.world;
              let info = '';
              for (const e of w.ctx.entities.values()) {
                if (e.templateId === 'vael_the_mistcaller')
                  info += ` vael auras=${e.auras.map((a) => a.id).join(',')} cast=${e.castingAbility}`;
                if (e.templateId === 'bastion_beacon_lamp')
                  info += ` lamp kind=${e.kind} facing=${e.facing.toFixed(2)}`;
              }
              let sprites = 0;
              const colors = new Set();
              window.__game.renderer.scene.traverse((o) => {
                if (o.isSprite) {
                  sprites++;
                  colors.add(o.material.color.getHex().toString(16));
                }
              });
              return `${out.join(' | ')} ${info} sprites=${sprites} colors=${[...colors].slice(0, 30).join(',')}`;
            }),
          );
          break;
        }
      }
    } else {
      await chat('/dev bastion trigger veil', 100);
      await stand(-4, 196, -4, 208, 0, 0.5, 38);
      await sleep(1500);
      await shot('vael_08_copias_en_la_niebla');
      await sleep(1400);
      await shot('vael_09_el_faro_revela');
      await sleep(1400);
      await shot('vael_10_el_faro_revela_2');
    }
  }
} finally {
  await browser.close();
}
