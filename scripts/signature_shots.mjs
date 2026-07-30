// Screenshot every spec signature effect. Boots the offline client once per class,
// jumps to level 20, and for each of the class's 3 specs: selects the spec (granting the
// signature), spawns a pinned dummy in front, casts the signature, and captures the VFX.
// Writes docs/screenshots/signatures/<class>-<spec>-<signature>.png. Needs `npm run dev`.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=ultra';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = 'docs/screenshots/signatures';
fs.mkdirSync(OUT, { recursive: true });

const SPECS = {
  warrior: [
    ['arms', 'mortal_strike'],
    ['fury', 'bloodthirst'],
    ['prot', 'shield_slam'],
  ],
  paladin: [
    ['holy', 'holy_shock'],
    ['protection', 'holy_shield'],
    ['retribution', 'crusader_strike'],
  ],
  hunter: [
    ['beast_mastery', 'bestial_wrath'],
    ['marksmanship', 'trueshot_aura'],
    ['survival', 'wyvern_sting'],
  ],
  rogue: [
    ['assassination', 'cold_blood'],
    ['combat', 'blade_flurry'],
    ['subtlety', 'hemorrhage'],
  ],
  priest: [
    ['discipline', 'power_infusion'],
    ['holy', 'holy_nova'],
    ['shadow', 'shadowform'],
  ],
  shaman: [
    ['elemental', 'elemental_mastery'],
    ['enhancement', 'stormstrike'],
    ['restoration', 'chain_heal'],
  ],
  mage: [
    ['arcane', 'arcane_power'],
    ['fire', 'combustion'],
    ['frost', 'icy_veins'],
  ],
  warlock: [
    ['affliction', 'siphon_life'],
    ['demonology', 'metamorphosis'],
    ['destruction', 'conflagrate'],
  ],
  druid: [
    ['balance', 'moonkin_form'],
    ['feral', 'feral_charge'],
    ['restoration', 'swiftmend'],
  ],
};

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 60000,
  args: ['--window-size=1280,820', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 820 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 160)));

let shot = 0;
for (const [cls, specs] of Object.entries(SPECS)) {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(700);
  await page.evaluate(() => document.querySelector('#btn-offline')?.click());
  await sleep(300);
  await page.evaluate((c) => {
    document.querySelector(`#offline-select .mini-class[data-class="${c}"]`)?.click();
    const n = document.querySelector('#char-name');
    if (n) n.value = 'Sigtest';
    document.querySelector('#btn-start-offline')?.click();
  }, cls);
  await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 60000, polling: 300 });
  await page.evaluate(() => window.__game.sim.setPlayerLevel(20));
  await sleep(400);

  for (const [specId, sig] of specs) {
    const ok = await page.evaluate(
      (specId, sig) => {
        const g = window.__game;
        const sim = g.sim;
        const p = sim.player;
        sim.setSpec(specId);
        if (!sim.resolvedAbility(sig)) return false;
        // Spawn a pinned dummy in front by cloning the nearest mob template we can find,
        // else target the nearest existing hostile mob.
        const target = [...sim.entities.values()].find(
          (e) => e.kind === 'mob' && !e.dead && e.hostile,
        );
        if (target) {
          // move the player next to it so melee/ranged both land
          p.pos = { x: target.pos.x, y: target.pos.y, z: target.pos.z - 8 };
          p.prevPos = { ...p.pos };
          p.facing = 0;
          target.maxHp = target.hp = 1_000_000;
          sim.targetEntity(target.id);
        }
        p.resource = p.maxResource;
        p.hp = p.maxHp;
        p.comboPoints = 5;
        sim.castAbility(sig, p.id, target ? { x: target.pos.x, z: target.pos.z } : undefined);
        return true;
      },
      specId,
      sig,
    );
    // let the cast resolve + VFX play
    await page.evaluate(() => {
      for (let i = 0; i < 30; i++) window.__game.sim.tick();
    });
    await sleep(900);
    const name = `${cls}-${specId}-${sig}`;
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log(`${ok ? 'shot' : 'GRANT-FAIL'} ${name}`);
    shot++;
  }
}

await browser.close();
console.log(`done: ${shot} signature screenshots in ${OUT}`);
