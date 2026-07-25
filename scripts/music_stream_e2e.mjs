// E2E smoke for the streamed remastered soundtrack (src/game/music.ts +
// music_tracks.ts). Boots the offline game, then verifies against the LIVE
// MusicDirector that: world entry warms exactly the two battle themes and
// streams the spawn zone's remaster; a /dev tp across a zone border
// crossfades to the new zone's stream; mob aggro swaps the zone stream for
// one randomly picked battle theme and dropping aggro restores the zone; and
// every mp3 the director touched was actually fetched from
// /audio/music/. Needs `npm run dev` on :5173.
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--window-size=1280,800',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required',
  ],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
const musicRequests = new Set();
page.on('request', (req) => {
  const { pathname } = new globalThis.URL(req.url());
  if (pathname.startsWith('/audio/music/')) musicRequests.add(pathname);
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
const booted = await enterOfflineGame(page, { charName: 'Bard', gameBootTimeoutMs: 60000 });
check('world booted', booted);
if (!booted) {
  await browser.close();
  console.log('ABORTED: world never booted, remaining checks skipped');
  process.exit(1);
}

// Reach into the live director exactly the way the unit tests do.
const snap = () =>
  page.evaluate(() => {
    const music = window.__game.music;
    const zones = {};
    for (const [name, s] of Object.entries(music.zoneStreams)) {
      zones[name] = {
        target: s.target,
        paused: s.el ? s.el.paused : null,
        loop: s.el ? s.el.loop : null,
        preload: s.el ? s.el.preload : null,
        time: s.el ? s.el.currentTime : null,
      };
    }
    return {
      zones,
      combat: music.combatStreams.map((s) => ({
        target: s.target,
        paused: s.el ? s.el.paused : null,
        src: s.el ? new globalThis.URL(s.el.src).pathname : null,
      })),
    };
  });

// --- world entry: zone stream up, battle themes warmed but silent ----------
let s = await snap();
const activeZones = Object.entries(s.zones).filter(([, z]) => z.target === 1);
check(
  'exactly one zone stream active after entry',
  activeZones.length === 1,
  JSON.stringify(Object.keys(s.zones)),
);
const [entryZone, entryState] = activeZones[0] ?? ['none', {}];
check(`entry zone '${entryZone}' element is playing`, entryState.paused === false);
check('entry zone element loops', entryState.loop === true);
check('entry zone element streams progressively', entryState.preload === 'auto');
check('both battle themes are warmed', s.combat.length === 2, `combat streams: ${s.combat.length}`);
check(
  'battle themes are silent out of combat',
  s.combat.every((c) => c.target === 0),
);
check(
  'battle theme files were prefetched',
  musicRequests.has('/audio/music/combat_1.mp3') && musicRequests.has('/audio/music/combat_2.mp3'),
  [...musicRequests].join(', '),
);

// --- zone border crossfade -------------------------------------------------
await page.evaluate(() => window.__game.sim.chat('/dev tp 0 240')); // marsh wilds
await sleep(2500);
s = await snap();
check(
  'marsh stream takes over after teleport',
  s.zones.marsh?.target === 1,
  JSON.stringify(s.zones),
);
check(`previous zone '${entryZone}' faded out`, s.zones[entryZone]?.target === 0);
check('marsh remaster was fetched', musicRequests.has('/audio/music/marsh.mp3'));

await page.evaluate(() => window.__game.sim.chat('/dev tp 0 300')); // Fenbridge hub
await sleep(2500);
s = await snap();
check(
  'Fenbridge hub swaps to the town theme',
  s.zones.town_fenbridge?.target === 1,
  JSON.stringify(s.zones),
);

// --- combat: random battle theme replaces the zone, then hands back --------
await page.evaluate(() => {
  const sim = window.__game.sim;
  const p = sim.player.pos;
  // Aggro the NEAREST living mob: a distant one can leash-clear on the next
  // tick before the director ever sees the fight, flaking the checks below.
  let best = null;
  let bestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead) continue;
    const d = Math.hypot(e.pos.x - p.x, e.pos.z - p.z);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  if (best) best.aggroTargetId = sim.playerId;
});
await sleep(1200);
s = await snap();
const activeCombat = s.combat.filter((c) => c.target === 1);
check(
  'exactly one battle theme active in combat',
  activeCombat.length === 1,
  JSON.stringify(s.combat),
);
check(
  'picked battle theme is playing',
  activeCombat[0]?.paused === false,
  activeCombat[0]?.src ?? 'none',
);
check(
  'zone streams silent during combat',
  Object.values(s.zones).every((z) => z.target === 0),
);

await page.evaluate(() => {
  const sim = window.__game.sim;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob') e.aggroTargetId = null;
  }
});
await sleep(7000); // recent-combat linger is 5s
s = await snap();
check(
  'zone theme returns after combat',
  s.zones.town_fenbridge?.target === 1,
  JSON.stringify(s.zones),
);
check(
  'battle themes silent after combat',
  s.combat.every((c) => c.target === 0),
);

// --- efficiency: fully faded streams pause their download/decoding ---------
await sleep(4000); // > STREAM_PAUSE_AFTER_S past the fades
s = await snap();
const inactive = Object.entries(s.zones).filter(([, z]) => z.target === 0);
check(
  'faded zone streams are paused',
  inactive.every(([, z]) => z.paused === true),
  JSON.stringify(inactive),
);
check(
  'faded battle themes are paused',
  s.combat.every((c) => c.paused === true),
);

await browser.close();
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
