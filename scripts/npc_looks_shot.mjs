// Visual QA catalog for the authored NPC looks (feature/npc-looks): boots the
// offline client, parks a stage NPC on a fixed sunny spot, cycles it through
// EVERY authored look id (retagging templateId and forcing the base-visual
// rebuild), and screenshots a full-body and a close framing of each, so every
// composed face, haircut and kit can be reviewed against the NPC's role.
//
//   node scripts/npc_looks_shot.mjs [--only id1,id2] [--url http://localhost:5173]
//
// Needs `npm run dev` (pass --url when the worktree's Vite picked another
// port). Writes PNGs to tmp/npc_looks/.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const args = process.argv.slice(2);
const argOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const BASE_URL = argOf('--url') ?? process.env.GAME_URL ?? 'http://localhost:5173';
// Low tier (SwiftShader's default) drops the outfit-dye shader layer by
// design; pass --gfx high to verify colorways at the tier real hardware runs.
const GFX = argOf('--gfx');
const URL = GFX ? `${BASE_URL}?gfx=${GFX}` : BASE_URL;
const ONLY = argOf('--only')?.split(',').filter(Boolean) ?? null;
// --town id1,id2: instead of the stage catalog, visit each named NPC at its
// real post and take one wide ensemble shot there (hub context check).
const TOWN = argOf('--town')?.split(',').filter(Boolean) ?? null;

fs.mkdirSync('tmp/npc_looks', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The roster comes from the real tables so the catalog cannot drift from the
// shipped data: every NPC_LOOKS id, with the NpcDef display name where one
// exists (the stage nameplate identifies each shot).
const tsxJson = (source) =>
  JSON.parse(execFileSync('npx', ['tsx', '-e', source], { encoding: 'utf8' }).trim());

// The roster comes from NPC_LOOKS so the catalog cannot drift from the shipped
// table. A checkout WITHOUT that module (the base commit, when capturing the
// before half of a PR comparison) has no roster to read, so an explicit --only
// list falls back to the sim's NPC names alone and shoots the same subjects
// wearing whatever rig that checkout gives them.
let roster;
try {
  roster = tsxJson(`
import { NPC_LOOKS } from './src/render/characters/npc_looks';
import { NPCS } from './src/sim/data';
const rows = Object.keys(NPC_LOOKS).map((id) => ({
  id,
  name: NPCS[id]?.name ?? id,
  title: NPCS[id]?.title ?? '',
}));
console.log(JSON.stringify(rows));
`);
} catch (err) {
  if (!ONLY) throw err;
  console.log('[npc-looks] no roster module here (base checkout?); using --only ids');
  roster = tsxJson(`
import { NPCS } from './src/sim/data';
const ids = ${JSON.stringify(ONLY)};
console.log(JSON.stringify(ids.map((id) => ({
  id,
  name: NPCS[id]?.name ?? id,
  title: NPCS[id]?.title ?? '',
}))));
`);
}

// --town visits placed NPCs by templateId and never reads the roster, so it
// can shoot an id the roster deliberately omits (Brother Aldric keeps his
// fixed rig, so verifying HIM is exactly a town shot).
const targets = ONLY ? roster.filter((r) => ONLY.includes(r.id)) : roster;
if (!TOWN && targets.length === 0) throw new Error('no targets matched');

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--window-size=1280,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
  defaultViewport: { width: 1280, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

// Standing capture rule: seed the LOWEST graphics preset before the app boots,
// so every rig shoots the same tier and an unseeded default cannot drift the
// comparison. Composed faces, hair, builds and props all read at this tier;
// the outfit-dye shader layer does not (it is a high-tier-only richness the
// player path sheds the same way), so use --gfx high to review colorways.
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
  } catch {
    /* ignore */
  }
});

await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
// The shared entry helper drives Play Offline through Enter World and
// dismisses the intro, tutorial, and camera-prompt overlays.
const booted = await enterOfflineGame(page, { charName: 'Lookwright', gameBootTimeoutMs: 60000 });
if (!booted) throw new Error('offline world did not boot');
await sleep(1000);

// Freeze the world at noon for even light across the whole catalog.
await page.evaluate(() => {
  const input = document.querySelector('#chat-input');
  input.value = '/daynight day';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
});
await sleep(300);

// Build the stage: repurpose one placed villager as the mannequin and park it
// on quiet flat grass away from towns and the Sowfield (the Vale Cup runs
// there on a schedule and floods the frame with actors and a betting banner).
// The spot is probed for flatness so the subject and dolly stand level.
const stage = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.world;
  const mannequin = [...sim.entities.values()].find(
    (e) => e.kind === 'npc' && e.templateId === 'fisherman_brandt',
  );
  if (!mannequin) return null;
  // Solved offline against the fixed offline seed (20061): dead flat, dry,
  // 35yd+ from every zone-1 camp, NPC post, the town and the Sowfield.
  const sx = -108;
  const sz = -80;
  mannequin.pos = { ...sim.groundPos(sx, sz) };
  mannequin.prevPos = { ...mannequin.pos };
  const p = sim.entities.get(sim.playerId);
  p.gm = true;
  // Dolly south of the stage, aimed back at it; NPC faces the camera. The
  // player's own rig is hidden per shot so the chase camera reads as free.
  p.pos = { ...sim.groundPos(sx, sz - 2.0) };
  p.prevPos = { ...p.pos };
  const yaw = Math.atan2(sx - p.pos.x, sz - p.pos.z);
  mannequin.facing = yaw + Math.PI;
  mannequin.prevFacing = mannequin.facing;
  p.facing = yaw;
  g.input.camYaw = yaw;
  g.input.camPitch = 0.12;
  g.input.camDist = 6;
  g.input.clickMoveTarget = null;
  return { stageId: mannequin.id };
}, undefined);
if (!stage) throw new Error('stage NPCs not found');

// Force frames so the teleport, camera and any rebuilds settle.
const settle = async (n = 3) => {
  for (let i = 0; i < n; i++) {
    await page.screenshot({ path: 'tmp/npc_looks/_settle.png' });
    await sleep(120);
  }
};
await settle(4);

if (TOWN) {
  for (const id of TOWN) {
    const ok = await page.evaluate((npcId) => {
      const g = window.__game;
      const sim = g.world;
      const npc = [...sim.entities.values()].find(
        (e) => e.kind === 'npc' && e.templateId === npcId,
      );
      if (!npc) return false;
      const p = sim.entities.get(sim.playerId);
      p.pos = { ...sim.groundPos(npc.pos.x + 2, npc.pos.z - 7) };
      p.prevPos = { ...p.pos };
      const yaw = Math.atan2(npc.pos.x - p.pos.x, npc.pos.z - p.pos.z);
      p.facing = yaw;
      g.input.camYaw = yaw;
      g.input.camPitch = 0.2;
      g.input.camDist = 11;
      const selfView = g.renderer.views?.get?.(sim.playerId);
      if (selfView) selfView.visualCompilePending = true;
      return true;
    }, id);
    if (!ok) {
      console.log(`TOWN MISS: ${id} not placed`);
      continue;
    }
    // A hub in another zone streams in after the teleport, and the loading
    // screen covers the canvas while it does: wait for the overlay to lift AND
    // the subject's own rig to exist, or the shot is a picture of the loader.
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await settle(1);
      ready = await page.evaluate((npcId) => {
        const g = window.__game;
        const npc = [...g.world.entities.values()].find(
          (e) => e.kind === 'npc' && e.templateId === npcId,
        );
        if (!npc) return false;
        const view = g.renderer.views?.get?.(npc.id);
        const screen = document.querySelector('#loading-screen');
        const covering = screen && getComputedStyle(screen).display !== 'none';
        return !!view?.visual && !covering;
      }, id);
    }
    if (!ready) console.log(`TOWN SLOW: ${id} never settled, shooting anyway`);
    // The crossing fade and the dolly's own rig both come back with the zone
    // (a rebuilt view drops the pending flag), so re-hide and let the curtain
    // finish before the frame that counts.
    await settle(10);
    await page.evaluate(() => {
      const g = window.__game;
      const selfView = g.renderer.views?.get?.(g.world.playerId);
      if (selfView) selfView.visualCompilePending = true;
    });
    await settle(2);
    await page.screenshot({ path: `tmp/npc_looks/town_${id}.png` });
    console.log(`town shot: ${id}`);
  }
  await browser.close();
  fs.rmSync('tmp/npc_looks/_settle.png', { force: true });
  process.exit(0);
}

let failures = 0;
for (const t of targets) {
  await page.evaluate(
    (stageId, id, name) => {
      const g = window.__game;
      const e = g.world.entities.get(stageId);
      e.templateId = id;
      e.name = name;
      // The graveyard angel's view is hidden from the living: only a ghost
      // sees her, so her portrait is taken through a spirit's eyes.
      g.world.entities.get(g.world.playerId).ghost = id === 'spirit_healer';
      // Clear the set: shove every mob within 60yd far away so no camp,
      // boss, or wandering boar photobombs the catalog (re-done per target;
      // respawn logic may drift some back over a long run).
      const s = e.pos;
      for (const other of g.world.entities.values()) {
        if (other.kind !== 'mob') continue;
        if (Math.hypot(other.pos.x - s.x, other.pos.z - s.z) > 60) continue;
        other.pos = { x: other.pos.x + 600, y: other.pos.y, z: other.pos.z + 600 };
        other.prevPos = { ...other.pos };
      }
      // The per-frame base-visual diff keys on the FIXED rig key, which two
      // NPCs can share; blank the stored key so the swap always rebuilds and
      // the composed look for the new templateId is what gets built.
      const v = g.renderer.views?.get?.(stageId);
      if (v) v.visualKey = '__npc_looks_shot__';
    },
    stage.stageId,
    t.id,
    t.name,
  );
  await settle(3);
  // Full body. The renderer re-asserts the self rig every frame via
  // setActive(base && !visualCompilePending), so the pending flag is the one
  // switch that keeps the dolly's body out of frame durably.
  await page.evaluate(() => {
    const g = window.__game;
    g.input.camDist = 4.4;
    g.input.camPitch = 0.14;
    const selfView = g.renderer.views?.get?.(g.world.playerId);
    if (selfView) selfView.visualCompilePending = true;
    for (const el of document.querySelectorAll('div')) {
      if (el.childElementCount <= 2 && /GPU acceleration/.test(el.textContent || '')) {
        el.style.display = 'none';
      }
      if (el.childElementCount <= 4 && /View bets and wager/.test(el.textContent || '')) {
        el.style.display = 'none';
      }
    }
  });
  await settle(1);
  await page.screenshot({ path: `tmp/npc_looks/${t.id}.png` });
  // Closer framing for the face (over the dolly's shoulder).
  await page.evaluate(() => {
    window.__game.input.camDist = 2.4;
    window.__game.input.camPitch = 0.04;
  });
  await settle(1);
  await page.screenshot({ path: `tmp/npc_looks/${t.id}_face.png` });
  const ok = await page.evaluate((stageId) => {
    const g = window.__game;
    const v = g.renderer.views?.get?.(stageId);
    return v && v.visualKey !== '__npc_looks_shot__';
  }, stage.stageId);
  if (!ok) {
    failures++;
    console.log(`REBUILD MISS: ${t.id}`);
  }
  console.log(`shot: ${t.id} (${t.name})`);
}

await browser.close();
fs.rmSync('tmp/npc_looks/_settle.png', { force: true });
console.log(`done: ${targets.length} looks, ${failures} rebuild misses -> tmp/npc_looks/`);
process.exit(failures ? 1 : 0);
