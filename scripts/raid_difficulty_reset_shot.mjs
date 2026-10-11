// Before/after capture for the raid difficulty-switch reset cooldown fix.
//
// Offline client, dev commands on (Vite dev build). `/dev nythraxisraid normal`
// forms the ten-player practice raid and claims the arena on Normal; everyone
// steps out, the leader flips to Heroic and resets, then flips straight back to
// Normal and resets again. Before the fix the second reset was refused with
// "Instances can only be reset once every 5 minutes."; after it, both resets
// succeed. Shoots the chat log where those lines land.
//
//   GAME_URL=http://localhost:5175 SHOT=after node scripts/raid_difficulty_reset_shot.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const SHOT = process.env.SHOT ?? 'after';
const OUT = process.env.SHOTS_DIR ?? 'tmp';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
// Standing capture rule: lowest graphics preset before boot.
await page.evaluateOnNewDocument(
  "try{localStorage.setItem('woc_settings',JSON.stringify({graphicsPreset:1,graphicsDefaultApplied:true}))}catch{}",
);
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
const booted = await enterOfflineGame(page, { charName: 'Raidlead', settleMs: 3000 });
console.log('booted:', booted);
// SwiftShader boots slowly: wait for the world hook past the helper's own timeout.
await page.waitForFunction('!!(window.__game && window.__game.sim && window.__game.sim.player)', {
  timeout: 120000,
  polling: 500,
});
await new Promise((r) => setTimeout(r, 2000));

const outcome = await page.evaluate(`(() => {
  const sim = window.__game.sim;
  const pid = sim.playerId;
  sim.chat('/dev nythraxisraid normal');
  const party = sim.partyOf(pid);
  if (!party || !party.raid) return { ok: false, why: 'no raid formed' };
  // Everyone steps out of the arena to the town so the reset's occupancy
  // walk sees an empty claim.
  sim.chat('/dev town eastbrook');
  const self = sim.entities.get(pid);
  for (const m of party.members) {
    if (m === pid) continue;
    const e = sim.entities.get(m);
    if (!e) continue;
    e.pos = { x: self.pos.x + 2, y: self.pos.y, z: self.pos.z + 2 };
    e.prevPos = { ...e.pos };
    sim.rebucket(e);
  }
  sim.drainEvents && void 0;
  sim.setDungeonDifficulty('heroic');
  sim.chat('/dungeon reset');
  sim.setDungeonDifficulty('normal');
  sim.chat('/dungeon reset');
  return { ok: true, members: party.members.length };
})()`);
console.log('staging:', JSON.stringify(outcome));
// The town teleport re-raises the loading curtain long after the chat lines
// landed; wait for it to stay down for a 3 s streak before shooting, and close
// the one-time software-GPU toast SwiftShader triggers so it stays out of the clip.
await page.waitForFunction(
  `(() => {
    const el = document.getElementById('loading-screen');
    if (!el) return false;
    const cs = getComputedStyle(el);
    const down = cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0;
    if (!down) { window.__curtainDownSince = 0; return false; }
    if (!window.__curtainDownSince) window.__curtainDownSince = Date.now();
    return Date.now() - window.__curtainDownSince > 3000;
  })()`,
  { timeout: 120000, polling: 250 },
);
await page.evaluate(
  "Array.from(document.querySelectorAll('button')).filter((b) => b.textContent.trim() === 'Dismiss').forEach((b) => b.click())",
);
await new Promise((r) => setTimeout(r, 800));

const lines = await page.evaluate(
  "Array.from(document.querySelectorAll('#chatlog .chat-line, #chatlog > *')).slice(-8).map((n) => n.textContent.trim())",
);
console.log('chat tail:\n' + lines.join('\n'));

await page.screenshot({ path: `${OUT}/${SHOT}-raid-reset-full.png` });
const box = await page.evaluate(
  "(() => { const r = document.querySelector('#chatlog-wrap').getBoundingClientRect(); return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), w: r.width + 16, h: r.height + 16 }; })()",
);
await page.screenshot({
  path: `${OUT}/${SHOT}-raid-reset-chat.png`,
  clip: { x: box.x, y: box.y, width: box.w, height: box.h },
});
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
