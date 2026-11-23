// Isolated UI-fixture visual capture, not a multiplayer or real-game smoke.
// Requires Vite. GAME_URL=http://127.0.0.1:5264 OUT=tmp/dungeon-groups node scripts/dungeon_expeditions_shot.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const url = process.env.GAME_URL ?? 'http://127.0.0.1:5264';
const out = process.env.OUT ?? 'tmp/dungeon-groups';
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: true,
  args: ['--disable-dev-shm-usage'],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Intercept just this private page's document; assets and source modules use Vite.
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      void request.respond({
        contentType: 'text/html',
        body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400..700&family=Alegreya:ital,wght@0,400;0,500;0,700;1,400&family=Alegreya+Sans:wght@400;500;700&display=swap" rel="stylesheet"></head><body><div id="dungeon-finder-window" class="window panel"></div></body></html>',
      });
    } else void request.continue();
  });
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(url);
  await page.evaluate(async () => {
    await import('/src/styles/index.css');
    const { DungeonFinderWindow } = await import('/src/ui/dungeon_finder_window.ts');
    const { knownItemIconHtml } = await import('/src/ui/unknown_item_icon.ts');
    const { TALENTS } = await import('/src/sim/content/talents.ts');
    const member = (pid, name, cls, role) => ({
      pid,
      name,
      cls,
      level: 20,
      role,
      roles: [role],
      spec: TALENTS[cls].specs.find((entry) => entry.role === role)?.id,
    });
    const members = [
      member(1, 'Aldric', 'warrior', 'tank'),
      member(2, 'Mira', 'priest', 'healer'),
      member(3, 'Vesper', 'priest', 'dps'),
      member(4, 'Elara', 'mage', 'dps'),
    ];
    const world = {
      partyInfo: null,
      player: { level: 20, guild: 'Nightwatch' },
      playerId: 1,
      cfg: { playerClass: 'warrior' },
      talentRole: 'tank',
      talentSpec: members[0].spec,
      raidLockouts: () => [],
      dungeonFinderBoard: [
        {
          id: 101,
          activityId: 'gravewyrm_sanctum_heroic',
          leaderName: 'Mira',
          tags: ['full_clear'],
          size: 2,
          capacity: 5,
          needed: { tank: 1, healer: 0, dps: 2 },
          members: members.slice(1, 3),
        },
        {
          id: 102,
          activityId: 'nythraxis_boss_arena_normal',
          leaderName: 'Elara',
          tags: ['learning'],
          size: 1,
          capacity: 10,
          needed: { tank: 2, healer: 2, dps: 5 },
          members: [members[3]],
        },
        {
          id: 103,
          activityId: 'sunken_bastion_normal',
          leaderName: 'Vesper',
          tags: ['guild_only', 'quest_run'],
          guild: 'Nightwatch',
          size: 3,
          capacity: 5,
          needed: { tank: 1, healer: 0, dps: 1 },
          members: members.slice(1, 4),
        },
      ],
      dungeonFinderInfo: {
        roles: ['tank'],
        eligibleRoles: ['tank', 'dps'],
        cooldown: 0,
        queue: null,
        proposal: null,
        myListing: null,
        myApplication: null,
        advert: { general: 0, discord: 24, discordAvailable: true },
      },
    };
    const panel = new DungeonFinderWindow({
      root: () => document.getElementById('dungeon-finder-window'),
      world: () => world,
      closeOthers: () => {},
      captureFocus: () => null,
      restoreFocus: () => {},
      hideTooltip: () => {},
      showOnMap: () => {},
      itemIcon: knownItemIconHtml,
      itemTooltip: () => '',
      moneyHtml: () => '',
      attachTooltip: () => {},
    });
    window.visualFixture = { world, panel, members };
    panel.open();
  });
  const shot = async (name) => {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images, (image) => image.decode().catch(() => {})));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await page.screenshot({ path: `${out}/${name}.png`, captureBeyondViewport: false });
  };
  for (const [name, width, height] of [
    ['desktop', 1440, 1000],
    ['mobile', 390, 844],
  ]) {
    await page.setViewport({ width, height });
    await page.evaluate(
      (mobile) => document.body.classList.toggle('mobile-touch', mobile),
      width < 600,
    );
    await shot(`after-${name}-groups`);
    await page.locator('[data-start-create]').click();
    await shot(`after-${name}-create`);
    await page.locator('[data-cancel-create]').click();
  }
  // The leader's party: the create form brings it along with role pickers.
  await page.evaluate(() => {
    const { world, panel, members } = window.visualFixture;
    world.partyInfo = { leader: 1, members };
    panel.render();
  });
  for (const [name, width, height] of [
    ['desktop', 1440, 1000],
    ['mobile', 390, 844],
  ]) {
    await page.setViewport({ width, height });
    await page.evaluate(
      (mobile) => document.body.classList.toggle('mobile-touch', mobile),
      width < 600,
    );
    await page.locator('[data-start-create]').click();
    await shot(`after-${name}-create-party`);
    await page.locator('[data-cancel-create]').click();
  }
  await page.evaluate(() => {
    const { world, panel, members } = window.visualFixture;
    world.dungeonFinderInfo.myListing = {
      id: 1,
      activityId: 'ignivar_raid_arena_heroic',
      tags: [],
      advertText: 'LFM - Crucible of the Last Spring - Heroic - 4/10 - Tank/Healer/DPS needed',
      partyRoles: [
        { pid: 2, role: 'healer' },
        { pid: 4, role: 'dps' },
      ],
      applicants: [{ ...members[3], pid: 15, name: 'Solara', gear: {} }],
    };
    panel.render();
  });
  for (const [name, width, height] of [
    ['desktop', 1440, 1000],
    ['mobile', 390, 844],
  ]) {
    await page.setViewport({ width, height });
    await page.evaluate(
      (mobile) => document.body.classList.toggle('mobile-touch', mobile),
      width < 600,
    );
    await shot(`after-${name}-members`);
  }
  assert.deepEqual(errors, []);
  console.log(`Groups UI fixture captured: ${out}`);
} finally {
  await browser.close();
}
