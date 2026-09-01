// Visual proof for the paladin-party-aura-leave hardening work (six prior fixes for
// this bug class, most recently 835a635496 / v0.39.0; this change only adds test
// coverage for the untested exit paths, so this capture closes the one thing that
// work never verified live: that the receiving party member's OWN buff bar clears
// Requital Aura immediately, with no client-side/wire staleness, not just that the
// sim's internal aura list is correct. Boots the offline game as the receiving
// party member, adds a bot paladin directly to the Sim, has it cast Requital Aura
// (a real party:true effect broadcast, not a hand-applied aura), screenshots the
// buff bar with the icon up, then has the paladin leave the party through the real
// partyLeave path and screenshots the buff bar again. Needs `npm run dev` on :5173.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';
import { suppressGpuNotice } from './lib/gpu_notice_suppress.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.SHOTS_DIR ?? 'docs/screenshots/paladin-party-aura-leave-hardening';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROFILE =
  process.env.CHROME_PROFILE_DIR ?? `${process.env.TMPDIR ?? '/tmp'}/pal-aura-profile`;
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 120000,
  userDataDir: PROFILE,
  args: [
    '--window-size=1366,820',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--disable-breakpad',
    '--disable-crash-reporter',
    '--disable-dev-shm-usage',
  ],
  defaultViewport: { width: 1366, height: 820 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

// Standing capture rule: seed the lowest graphics preset before the app boots.
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
  } catch {}
});
await suppressGpuNotice(page);

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await enterOfflineGame(page, { charClass: 'warrior', charName: 'Member' });

// Add a bot paladin directly to the Sim and place the two of them in a real
// party (assembling the Party struct directly, like scripts/raid_to_party_shot.mjs:
// going through invite/accept in a single-HUD offline session queues a stale
// invite card that would clutter the shot for no reason). Casting through the
// real castAbility path exercises the same party:true effect broadcast a live
// paladin uses, not a hand-applied aura, so the "before" state is authentic.
const before = await page.evaluate(() => {
  const sim = window.__game.sim;
  const me = sim.primaryId;
  const p = sim.player;
  const paladin = sim.addPlayer('paladin', 'Bulwark');
  const pe = sim.entities.get(paladin);
  if (pe) {
    pe.pos = { x: p.pos.x + 1.5, y: p.pos.y, z: p.pos.z + 1.5 };
    pe.prevPos = { ...pe.pos };
  }
  sim.setPlayerLevel(16, paladin);
  // Leader is the paladin, not the receiving member: the HUD auto-opens the Loot
  // Settings window the instant the LOCAL player becomes party leader
  // (hud.ts becameLeader), which would clutter this shot with an unrelated panel.
  const party = {
    id: sim.party.nextPartyId++,
    leader: paladin,
    members: [me, paladin],
    raid: false,
    raidGroups: new Map([
      [me, 1],
      [paladin, 1],
    ]),
    lootStrategies: {
      currency: 'fair-split',
      commonItems: 'round-robin',
      premiumItems: 'need-greed',
      master: { enabled: false, looter: 0, threshold: 'uncommon' },
    },
  };
  sim.party.parties.set(party.id, party);
  sim.party.partyByPid.set(me, party.id);
  sim.party.partyByPid.set(paladin, party.id);
  sim.castAbility('retribution_aura', paladin);
  const mine = sim.entities.get(me)?.auras.find((a) => a.id === 'retribution_aura');
  return {
    paladin,
    hasAura: !!mine,
    myAuraIds: sim.entities.get(me)?.auras.map((a) => a.id),
  };
});
console.log('before:', JSON.stringify(before));
await sleep(500);

await page.screenshot({ path: `${OUT}/before-buff-bar.png` });
const clipBuffBar = async (path) => {
  const box = await page.evaluate(() => {
    const el = document.querySelector('#buff-bar');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: Math.max(0, r.x - 60),
      y: Math.max(0, r.y - 60),
      width: r.width + 120,
      height: Math.max(r.height, 48) + 120,
    };
  });
  console.log('buff bar clip box:', JSON.stringify(box));
  if (box && box.width > 10) await page.screenshot({ path, clip: box });
};
await clipBuffBar(`${OUT}/before-buff-bar-clip.png`);

// The paladin leaves the party through the real partyLeave path (the exact
// exit that shipped the original bug report); the receiving member never
// touches the party command themselves.
const after = await page.evaluate((paladin) => {
  const sim = window.__game.sim;
  const me = sim.primaryId;
  sim.partyLeave(paladin);
  const mine = sim.entities.get(me)?.auras.find((a) => a.id === 'retribution_aura');
  return {
    partyGone: sim.partyOf(me) === null,
    hasAura: !!mine,
    myAuraIds: sim.entities.get(me)?.auras.map((a) => a.id),
  };
}, before.paladin);
console.log('after:', JSON.stringify(after));
await sleep(600);

await page.screenshot({ path: `${OUT}/after-buff-bar.png` });
await clipBuffBar(`${OUT}/after-buff-bar-clip.png`);

console.log(before.hasAura && !after.hasAura ? 'PALADIN AURA LEAVE OK' : 'PALADIN AURA LEAVE FAIL');
await browser.close();
