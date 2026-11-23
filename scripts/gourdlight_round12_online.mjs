// ONLINE evidence for Gourdlight Eve round 12: two players (A and B) on a running local
// authoritative server (ALLOW_DEV_COMMANDS=1, local only), each in its own browser on the
// real GPU. Checks, each printed as a CHECK line and captured: B sees and drinks A's
// Gurglegreen Cauldron and both see B's goblin; the goblin counts for Boo!; Old Thatchgrin
// wakes at `/dev servertime night` and is back on his pole at day with nobody near; the
// broom rider's hands as the other client draws them; the whole-event meta deed progresses
// and grants the Gourdsworn title online. Evidence tooling, not a repo test.
//
//   GAME_URL=http://127.0.0.1:5214 node scripts/gourdlight_round12_online.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const GAME_URL = process.env.GAME_URL ?? 'http://127.0.0.1:5214';
const OUT = process.argv[2] ?? path.join('tmp', 'round12_online');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniq = Date.now()
  .toString(36)
  .slice(-5)
  .replace(/[0-9]/g, (d) => 'abcdefghij'[d]);
const SECTIONS = new Set((process.env.SECTIONS ?? 'town,scarecrow,broom,meta').split(','));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
};

async function loginAndEnter(page, username, charName, cls) {
  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('#btn-online', { timeout: 90000 });
  await sleep(1500);
  await page.evaluate(() => document.querySelector('#btn-online')?.click());
  await page.waitForSelector('#login-user', { visible: true, timeout: 60000 });
  let filled = false;
  for (let attempt = 0; attempt < 6 && !filled; attempt++) {
    filled = await page.evaluate(
      (u, p, mail) => {
        const form = document.querySelector('#login-panel');
        const userEl = document.querySelector('#login-user');
        const passEl = document.querySelector('#login-pass');
        const toggle = document.querySelector('#btn-auth-toggle');
        const submit = document.querySelector('#btn-login');
        if (!form || !userEl || !passEl || !toggle || !submit) return false;
        if (form.dataset.authMode !== 'register') toggle.click();
        const emailEl = document.querySelector('#login-email');
        userEl.value = u;
        passEl.value = p;
        if (emailEl) emailEl.value = mail;
        submit.click();
        return true;
      },
      username,
      'hunter22',
      `${username}@example.com`,
    );
    if (!filled) await sleep(400);
  }
  await page.waitForSelector('#realm-list .realm-row', { timeout: 30000 });
  await page.evaluate(() => document.querySelector('#realm-list .realm-row')?.click());
  await page.waitForFunction(
    () =>
      !document.querySelector('#charcreate-panel')?.hasAttribute('hidden') ||
      !document.querySelector('#charselect-panel')?.hasAttribute('hidden'),
    { timeout: 30000, polling: 200 },
  );
  const onCreate = await page.evaluate(
    () => !document.querySelector('#charcreate-panel')?.hasAttribute('hidden'),
  );
  if (!onCreate) {
    await page.evaluate(() => document.querySelector('#btn-new-character')?.click());
    await page.waitForFunction(
      () => !document.querySelector('#charcreate-panel')?.hasAttribute('hidden'),
      { timeout: 10000, polling: 200 },
    );
  }
  await page.evaluate(
    (name, c) => {
      document.querySelector('#new-char-name').value = name;
      document.querySelector(`#charcreate-panel .mini-class[data-class="${c}"]`)?.click();
      document.querySelector('#btn-create-char').click();
    },
    charName,
    cls,
  );
  await page.waitForFunction(
    () => !document.querySelector('#charselect-panel')?.hasAttribute('hidden'),
    { timeout: 20000, polling: 200 },
  );
  await sleep(800);
  await page.evaluate((name) => {
    const rows = [...document.querySelectorAll('#char-list .char-row')];
    const row =
      rows.find((r) => r.querySelector('.char-name')?.textContent?.trim() === name) ?? rows[0];
    row?.querySelector('.enter-world-btn')?.click();
  }, charName);
  await page.waitForFunction(() => window.__game?.world?.entities?.size >= 1, {
    timeout: 120000,
    polling: 500,
  });
}

function rig(page, tag) {
  const ev = (src) => page.evaluate(src);
  const chat = async (cmd, wait = 1200) => {
    await page.evaluate((c) => window.__game.world.chat(c), cmd);
    await sleep(wait);
  };
  const dismiss = () =>
    page.evaluate(() => {
      for (const b of document.querySelectorAll('button')) {
        const t = (b.textContent ?? '').trim().toLowerCase();
        if (t === 'understood' || t === 'close' || t === 'skip') b.click();
      }
    });
  const shot = async (name) => {
    await dismiss();
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file });
    console.log('SHOT', tag, file);
  };
  const cam = (yaw, pitch, dist) =>
    page.evaluate(
      (y, p, d) => {
        const input = window.__game.input;
        input.camYaw = y;
        input.camPitch = p;
        input.camDist = d;
      },
      yaw,
      pitch,
      dist,
    );
  /** Turn the camera to look from this player toward an entity (or a point). */
  const aimAt = (target, pitch, dist, side = 0) =>
    page.evaluate(
      (t, p, d, off) => {
        const w = window.__game.world;
        const e = typeof t === 'number' ? w.entities.get(t) : null;
        const tx = e ? e.pos.x : t.x;
        const tz = e ? e.pos.z : t.z;
        const me = w.player.pos;
        const input = window.__game.input;
        input.camYaw = Math.atan2(tx - me.x, tz - me.z) + off;
        input.camPitch = p;
        input.camDist = d;
      },
      target,
      pitch,
      dist,
      side,
    );
  /** Open the Book of Deeds on the Feats shelf, searched down to the Gourdlight rows. */
  const book = async () => {
    await page.evaluate(() => window.__game.hud.deedsWindow.open('feat'));
    await sleep(800);
    await page.evaluate(() => {
      const el = document.querySelector('.deed-search');
      if (!el) return;
      el.value = 'Gourdlight';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(1200);
    // the round 12 rows sit at the end of the shelf
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('.deeds-list, .deeds-list *')) {
        if (el.scrollHeight > el.clientHeight + 4) el.scrollTop = el.scrollHeight;
      }
      const cards = [...document.querySelectorAll('.deeds-list > *')];
      cards.at(-1)?.scrollIntoView({ block: 'end' });
    });
    await sleep(600);
  };
  return { ev, chat, shot, cam, dismiss, aimAt, book };
}

async function main() {
  const launch = () =>
    puppeteer.launch({
      executablePath: BROWSER_PATH,
      headless: 'new',
      args: [
        '--window-size=1280,760',
        '--use-angle=d3d11',
        '--ignore-gpu-blocklist',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
      ],
      defaultViewport: { width: 1280, height: 760 },
      protocolTimeout: 300000,
    });
  const [ba, bb] = [await launch(), await launch()];
  try {
    const pa = await ba.newPage();
    const pb = await bb.newPage();
    for (const [p, t] of [
      [pa, 'A'],
      [pb, 'B'],
    ])
      p.on('pageerror', (e) => console.log(`PAGEERROR ${t}:`, e.message));
    const nameA = `Ada${uniq}`;
    const nameB = `Bo${uniq}`;
    await loginAndEnter(pa, `ada${uniq}`, nameA, 'warrior');
    await loginAndEnter(pb, `bo${uniq}`, nameB, 'priest');
    await sleep(5000);
    const A = rig(pa, 'A');
    const B = rig(pb, 'B');
    for (const R of [A, B]) {
      await R.dismiss();
      for (const cmd of ['/dev level 20', '/dev god', '/dev noaggro', '/dev season on'])
        await R.chat(cmd, 1200);
    }
    const idOf = (R) => R.ev('window.__game.world.player.id');
    const idA = await idOf(A);
    const idB = await idOf(B);

    // ---- Eastbrook: the cauldron, the goblin, Boo! -------------------------------
    if (SECTIONS.has('town')) {
      await A.chat('/dev town eastbrook', 4000);
      await B.chat('/dev town eastbrook', 4000);
      // B stands two yards beside A
      const posA = JSON.parse(await A.ev('JSON.stringify(window.__game.world.player.pos)'));
      await B.chat(`/dev tp ${(posA.x + 2).toFixed(1)} ${posA.z.toFixed(1)}`, 3000);
      // B takes the Boo! errand from Hester
      await B.chat('/dev season daily q_gourdlight_daily_boo', 1500);
      const hester = await B.ev(
        `(()=>{const w=window.__game.world;const h=[...w.entities.values()].find(e=>e.templateId==='gourdlight_keeper');return h?JSON.stringify({id:h.id,x:h.pos.x,z:h.pos.z}):null})()`,
      );
      check('B sees Hester in Eastbrook', hester !== null, hester ?? '');
      if (hester) {
        const h = JSON.parse(hester);
        await B.chat(`/dev tp ${(h.x + 1.5).toFixed(1)} ${h.z.toFixed(1)}`, 3000);
        await B.ev(`window.__game.world.acceptQuest('q_gourdlight_daily_boo')`);
        await sleep(1500);
        await A.chat(`/dev tp ${(h.x + 3).toFixed(1)} ${(h.z + 2).toFixed(1)}`, 3000);
      }
      const booState = await B.ev(`window.__game.world.questState('q_gourdlight_daily_boo')`);
      check('B is on the Boo! errand', booState === 'active', booState);
      // A sets the cauldron down
      await A.chat('/dev give gurglegreen_cauldron', 1500);
      await A.ev(`window.__game.world.useItem('gurglegreen_cauldron')`);
      await sleep(2500);
      const potB = await B.ev(
        `(()=>{const w=window.__game.world;const p=[...w.entities.values()].find(e=>e.objectItemId==='gurglegreen_cauldron');return p?JSON.stringify({id:p.id,x:p.pos.x,z:p.pos.z}):null})()`,
      );
      check("B sees A's cauldron", potB !== null, potB ?? '');
      if (potB) {
        const p = JSON.parse(potB);
        await B.chat(`/dev tp ${(p.x + 5).toFixed(1)} ${(p.z + 3).toFixed(1)}`, 2500);
        await B.aimAt({ x: p.x, z: p.z }, 0.3, 4);
        await sleep(1200);
      }
      await B.shot('online-r12-b-sees-a-cauldron');
      if (potB) {
        const p = JSON.parse(potB);
        await B.chat(`/dev tp ${(p.x + 1.2).toFixed(1)} ${p.z.toFixed(1)}`, 2500);
        await B.ev(`window.__game.world.pickUpObject(${p.id})`);
        await sleep(3500);
      }
      const goblinSelf = await B.ev(
        `window.__game.world.player.auras.some(a=>a.id==='gourdlight_toy_gurglegreen')`,
      );
      const goblinSeenByA = await A.ev(
        `(()=>{const e=window.__game.world.entities.get(${idB});return !!e&&e.auras.some(a=>a.id==='gourdlight_toy_gurglegreen')})()`,
      );
      check('B drank: B is a goblin on its own client', goblinSelf === true);
      check("A sees B's goblin", goblinSeenByA === true);
      const pB = JSON.parse(await B.ev('JSON.stringify(window.__game.world.player.pos)'));
      await A.chat(`/dev tp ${(pB.x + 2.5).toFixed(1)} ${(pB.z - 3).toFixed(1)}`, 2500);
      await A.aimAt(idB, 0.3, 1.2, 0.3);
      await sleep(1200);
      await A.shot('online-r12-a-sees-b-goblin');
      await B.ev('window.__game.input.camPitch=0.3;window.__game.input.camDist=3.2;');
      await sleep(800);
      await B.shot('online-r12-b-goblin-self');
      // the goblin counts as a costume: a fright on an Eastbrook townsperson
      const folk = await B.ev(
        `(()=>{const w=window.__game.world;const n=[...w.entities.values()].find(e=>e.kind==='npc'&&e.templateId==='trader_wilkes');return n?JSON.stringify({id:n.id,x:n.pos.x,z:n.pos.z}):null})()`,
      );
      if (folk) {
        const f = JSON.parse(folk);
        await B.chat(`/dev tp ${(f.x + 1.5).toFixed(1)} ${f.z.toFixed(1)}`, 2500);
        await B.ev(`window.__game.world.trickOrTreat(${f.id}, true)`);
        await sleep(2000);
      }
      const booCount = await B.ev(
        `(()=>{const q=window.__game.world.questLog.get('q_gourdlight_daily_boo');return q?q.counts[0]:-1})()`,
      );
      check('the goblin counts for Boo! (errand count 1)', booCount === 1, String(booCount));
      const frightMark = await B.ev(
        `window.__game.world.deedStats.visited.has('gourdlight:boo:eastbrook_vale')`,
      );
      check('the fright marks Eastbrook on the whole-event checklist', frightMark === true);
      if (folk) await B.aimAt(JSON.parse(folk).id, 0.3, 4, Math.PI * 0.8);
      await sleep(400);
      await B.shot('online-r12-b-goblin-boo');
    }

    // ---- Old Thatchgrin: night wakes him, day with nobody near puts him back -------
    if (SECTIONS.has('scarecrow')) {
      await A.chat('/dev scarecrow', 4000);
      await B.chat('/dev scarecrow', 4000);
      await A.chat('/dev servertime night', 9000);
      await A.chat('/daynight night', 1500);
      const bossState = (R) =>
        R.ev(
          `(()=>{const b=[...window.__game.world.entities.values()].find(e=>e.templateId==='gourdlight_thatchgrin');return b?JSON.stringify({asleep:!!b.asleep,hostile:b.hostile,x:+b.pos.x.toFixed(2),z:+b.pos.z.toFixed(2)}):null})()`,
        );
      const night = await bossState(A);
      check(
        'Thatchgrin wakes at /dev servertime night',
        night !== null && JSON.parse(night).asleep === false,
        night ?? '',
      );
      if (night) {
        const n = JSON.parse(night);
        await A.chat(`/dev tp ${n.x.toFixed(1)} ${(n.z - 16).toFixed(1)}`, 2500);
        await A.aimAt({ x: n.x, z: n.z }, 0.15, 5);
        await sleep(1500);
      }
      await A.shot('online-r12-thatchgrin-awake-night');
      // both ride far away (Fenbridge, out of every interest radius), then day comes
      await A.chat('/dev town fenbridge', 4000);
      await B.chat('/dev town fenbridge', 4000);
      const seenFar = await A.ev(
        `[...window.__game.world.entities.values()].some(e=>e.templateId==='gourdlight_thatchgrin')`,
      );
      check('nobody is near him (he is out of the interest of A)', seenFar === false);
      await A.chat('/dev servertime day', 6000);
      await A.chat('/daynight day', 1000);
      await A.chat('/dev scarecrow', 600);
      // the very first snapshots that carry him: never awake by day
      let firstSeen = null;
      for (let i = 0; i < 40 && firstSeen === null; i++) {
        firstSeen = await bossState(A);
        if (firstSeen === null) await sleep(100);
      }
      check(
        'riding in by day finds him already on his pole',
        firstSeen !== null && JSON.parse(firstSeen).asleep === true,
        firstSeen ?? '',
      );
      await sleep(2500);
      if (firstSeen) {
        const n = JSON.parse(firstSeen);
        await A.chat(`/dev tp ${n.x.toFixed(1)} ${(n.z - 14).toFixed(1)}`, 2500);
        await A.aimAt({ x: n.x, z: n.z }, 0.12, 5);
        await sleep(1500);
      }
      await A.shot('online-r12-thatchgrin-pole-day-unwatched');
    }

    // ---- the broom rider's hands, as the other client draws them -------------------
    if (SECTIONS.has('broom')) {
      await A.chat('/dev scarecrow', 3000);
      await B.chat('/dev scarecrow', 3000);
      await A.chat('/dev mounts', 2000);
      await A.ev(`window.__game.world.useItem('reins_emberbristle_broom')`);
      await sleep(5000);
      const mountSeen = await B.ev(
        `(()=>{const e=window.__game.world.entities.get(${idA});return e?String(e.mountKey??''):null})()`,
      );
      check('B sees A on the Emberbristle Broom', !!mountSeen, mountSeen ?? '');
      const pA = JSON.parse(await A.ev('JSON.stringify(window.__game.world.player.pos)'));
      await B.chat(`/dev tp ${(pA.x + 4).toFixed(1)} ${(pA.z + 0.5).toFixed(1)}`, 8000);
      // the camera swung well off B's own shoulder, so A is in clear view beside B
      await B.aimAt(idA, 0.2, 3.5, -0.75);
      await sleep(2000);
      await B.shot('online-r12-b-sees-a-broom-hands');
    }

    // ---- the whole-event meta deed, online ----------------------------------------
    if (SECTIONS.has('meta')) {
      // the dev level-up fills the bags; a knock needs room for its sweets
      await A.ev(
        `(()=>{const w=window.__game.world;const ids=[...new Set(w.inventory.filter(s=>s&&s.itemId).map(s=>s.itemId))].slice(0,8);for(const id of ids)w.discardItem(id,999);})()`,
      );
      await sleep(1500);
      await A.chat('/dev town eastbrook', 4000);
      await A.chat('/dev season eve almost', 2500);
      const progress = await A.ev(
        `(()=>{const w=window.__game.world;const d=w.deedStats.visited;return [...d].filter(m=>m.startsWith('gourdlight:')).length})()`,
      );
      check(
        'the checklist progress reaches the client (26 of 27)',
        progress === 26,
        String(progress),
      );
      await A.book();
      await A.shot('online-r12-a-book-progress');
      await A.ev(`window.__game.hud.deedsWindow.close()`);
      const wilkes = await A.ev(
        `(()=>{const w=window.__game.world;const n=[...w.entities.values()].find(e=>e.kind==='npc'&&e.templateId==='trader_wilkes');return n?JSON.stringify({id:n.id,x:n.pos.x,z:n.pos.z}):null})()`,
      );
      if (wilkes) {
        const f = JSON.parse(wilkes);
        await A.chat('/dev season knocks', 800);
        await A.chat(`/dev tp ${(f.x + 1.5).toFixed(1)} ${f.z.toFixed(1)}`, 2500);
        await A.ev(`window.__game.world.trickOrTreat(${f.id})`);
        await sleep(3000);
      }
      const earned = await A.ev(
        `window.__game.world.deedsEarned.has('feat_gourdlight_eve_complete')`,
      );
      check('one real knock grants the meta online', earned === true);
      await A.ev(`window.__game.world.setActiveTitle('feat_gourdlight_eve_complete')`);
      await sleep(2000);
      await B.chat('/dev town eastbrook', 3500);
      const pA2 = JSON.parse(await A.ev('JSON.stringify(window.__game.world.player.pos)'));
      await B.chat(`/dev tp ${(pA2.x - 3).toFixed(1)} ${(pA2.z - 3).toFixed(1)}`, 3000);
      const titleSeen = await B.ev(
        `(()=>{const e=window.__game.world.entities.get(${idA});return e?String(e.title??''):null})()`,
      );
      check(
        'B sees A wearing the Gourdsworn title',
        titleSeen === 'feat_gourdlight_eve_complete',
        titleSeen ?? '',
      );
      await A.book();
      await A.shot('online-r12-a-title-unlocked');
      await A.ev(`window.__game.hud.deedsWindow.close()`);
      await B.aimAt(idA, 0.15, 2.5, 0.5);
      await sleep(800);
      await B.shot('online-r12-b-sees-a-title');
    }
  } finally {
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
    await ba.close();
    await bb.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
