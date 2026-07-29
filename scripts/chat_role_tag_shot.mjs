// Captures the staff-role chat tags offline: synthetic chat events with
// server-shaped flair are pushed through the REAL hud.handleEvents path (the
// exact renderer online chat uses), so the lines show the colored [Levy St] /
// [Core Dev] / [Mod] disclosure tags beside sender names. Run with MODE=base
// on the base branch for the before shot (same events, no tags rendered).
// Needs the dev client running:  npm run dev
//   BROWSER_PATH=... node scripts/chat_role_tag_shot.mjs

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const MODE = process.env.MODE ?? 'branch';
const PREFIX = MODE === 'base' ? 'before' : 'after';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  protocolTimeout: 60000,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--window-size=1280,760',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: { width: 1280, height: 760, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
const booted = await enterOfflineGame(page, { charClass: 'warrior', charName: 'Thorgar' });
console.log('offline boot:', booted);
await page.evaluate(() => document.querySelector('.gpu-notice-dismiss')?.click());
await sleep(800);

// Push server-shaped chat events through the real event drain. The flair field
// is exactly what the online server stamps at fan-out.
await page.evaluate(() => {
  const hud = window.__game.hud;
  const lines = [
    { from: 'Sean', flair: { role: 'levyst' }, text: 'Welcome to the new patch!' },
    { from: 'Mira', flair: { role: 'coredevs' }, text: 'Server restart in 10 minutes.' },
    { from: 'Torv', flair: { role: 'mods' }, text: 'Keep general chat friendly please.' },
    { from: 'Impostor', text: 'i am also a dev btw (no tag: not verified)' },
    // Community roles (Artist/Content Creator/LEGEND/SHILL) are nameplate-only:
    // the server never stamps them onto chat, so this line renders bare even
    // though the sender holds a catalog role.
    { from: 'Caster', text: 'Streaming the raid tonight! (community role: no chat tag)' },
  ];
  hud.handleEvents(
    lines.map((l, i) => ({
      type: 'chat',
      fromPid: 9000 + i,
      from: l.from,
      text: l.text,
      channel: 'general',
      ...(l.flair ? { flair: l.flair } : {}),
    })),
  );
});
await sleep(600);

// Clip the chat log region (bottom-left).
const clip = await page.evaluate(() => {
  const el = document.querySelector('#chatlog');
  const r = el.getBoundingClientRect();
  return {
    x: Math.max(0, r.left - 6),
    y: Math.max(0, r.top - 6),
    width: r.width + 12,
    height: r.height + 12,
  };
});
await page.screenshot({ path: `tmp/chatrole-${PREFIX}.png`, clip });
console.log(`${PREFIX} chat shot`, clip);

await browser.close();
console.log('done');
