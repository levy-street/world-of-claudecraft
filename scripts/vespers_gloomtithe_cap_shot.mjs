// Live-browser proof for the Vespers priest Gloomtithe low-tier buff-cap fix
// (PR evidence, not a repo test).
//
// Bug: on the LOW graphics preset, src/ui/auras_painter.ts caps the rendered
// buff count at AURA_VISIBLE_CAP_LOW (8, src/game/ui_tier_knobs.ts) and sheds
// overflow buffs. The Vespers priest's Gloomtithe resource aura
// (id 'priest_gloomtithe', 1-5 stacks, gates casting Call Tithefiend) was not
// in auras_painter.ts's ALWAYS_VISIBLE_AURA_IDS allowlist, so a wall of raid
// buffs applied ahead of it (paladin/mage/warrior/druid buffs, exactly the
// class mix in the bug report) could push it past the cap and hide it, even
// though it is actionable resource info, the same shape as the already
// allowlisted shaman_thunder_charges/shaman_warspirit_cadence/moontide/
// old_blood/verdance banks.
//
// Boots an offline priest on the low graphics preset, then hand-applies
// exactly AURA_VISIBLE_CAP_LOW real raid-buff auras (battle_shout,
// arcane_intellect, blessing_of_might, power_word_fortitude, mark_of_the_wild,
// devotion_aura, thorns, frost_armor) followed by a 5-stack Gloomtithe aura as
// the (cap + 1)th buff, the worst case: every ordinary buff slot already
// spent before Gloomtithe lands. Auras are applied directly via
// world.applyAura (the same escape hatch scripts/direhowl_deathless_rage_shot.mjs
// uses), not by casting them, because this PR does not touch casting and a
// live raid of other players buffing the character is not reproducible
// offline.
//
//   node scripts/vespers_gloomtithe_cap_shot.mjs <before|after>
//
// The CALLER toggles the fix in/out of the worktree between the two
// invocations (this repo's own auras_painter.ts, one Set entry), so "before"
// and "after" differ only in whether ALWAYS_VISIBLE_AURA_IDS contains
// 'priest_gloomtithe', not in what the script does.
//
// Env: BROWSER_PATH, SHOT_PORT (5188).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const LABEL = process.argv[2];
if (LABEL !== 'before' && LABEL !== 'after') {
  throw new Error('usage: node scripts/vespers_gloomtithe_cap_shot.mjs <before|after>');
}
const PORT = Number(process.env.SHOT_PORT ?? 5188);
const OUT_DIR = path.join('docs', 'screenshots', 'vespers-gloomtithe-buff-cap');
fs.mkdirSync(OUT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The same 8 real raid-buff-shaped ability ids either PR revision renders
// identically (all under AURA_VISIBLE_CAP_LOW): battle_shout (warrior),
// arcane_intellect (mage), blessing_of_might (paladin), power_word_fortitude
// (priest), mark_of_the_wild (druid), devotion_aura (paladin), thorns
// (druid), frost_armor (mage). Real ids so the icons render with real art
// instead of the generic fallback, matching "every single buff possible"
// from the bug report.
const FILLER_BUFF_IDS = [
  'battle_shout',
  'arcane_intellect',
  'blessing_of_might',
  'power_word_fortitude',
  'mark_of_the_wild',
  'devotion_aura',
  'thorns',
  'frost_armor',
];

async function startVite() {
  const vite = spawn(
    process.execPath,
    [path.join('node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  vite.stdout.on('data', (chunk) => (output += chunk));
  vite.stderr.on('data', (chunk) => (output += chunk));
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (vite.exitCode !== null) throw new Error(`vite exited before ready:\n${output}`);
    try {
      const res = await fetch(`http://localhost:${PORT}/`);
      if (res.ok) return vite;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  vite.kill('SIGTERM');
  throw new Error(`vite not ready on :${PORT} within 30s:\n${output}`);
}

async function main() {
  const vite = await startVite();
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: ['--window-size=1280,800', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1280, height: 800 },
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
    // Lowest graphics preset, per the repo's standing capture rule -- and the
    // exact tier this bug requires (AURA_VISIBLE_CAP_LOW only bites on low).
    await page.evaluateOnNewDocument(() => {
      try {
        localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
      } catch {
        /* ignore */
      }
    });
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0', timeout: 30000 });
    const booted = await enterOfflineGame(page, { charClass: 'priest', charName: 'Vespers' });
    if (!booted) throw new Error('offline world did not boot');
    await sleep(500);

    const playerId = await page.evaluate(() => window.__game.world.player.id);
    // The bug only bites on the 'low' data-fx-level tier (AURA_VISIBLE_CAP_LOW,
    // src/game/ui_tier_knobs.ts); confirm the seeded preset actually resolved to it
    // before trusting anything the capture shows.
    const fxLevel = await page.evaluate(() => document.documentElement.dataset.fxLevel);
    if (fxLevel !== 'low') throw new Error(`expected data-fx-level=low, got ${fxLevel}`);

    // Apply the cap's-worth of ordinary buffs first (the worst case: every
    // budget slot already spent), then Gloomtithe last, so it is exactly the
    // (cap + 1)th buff -- the boundary the fix moves.
    const applied = await page.evaluate(
      (pid, fillerIds) => {
        const world = window.__game.world;
        const player = world.entities.get(pid);
        let sourceId = 9000;
        for (const id of fillerIds) {
          world.applyAura(player, {
            id,
            name: id,
            kind: 'buff_ap',
            remaining: 1800,
            duration: 1800,
            value: 10,
            sourceId: sourceId++,
            school: 'physical',
          });
        }
        world.applyAura(player, {
          id: 'priest_gloomtithe',
          name: 'Gloomtithe',
          kind: 'gloomtithe',
          remaining: 1800,
          duration: 1800,
          value: 0,
          stacks: 5,
          sourceId: pid,
          school: 'shadow',
        });
        return player.auras.map((a) => a.id);
      },
      playerId,
      FILLER_BUFF_IDS,
    );
    if (!applied.includes('priest_gloomtithe') || applied.length !== FILLER_BUFF_IDS.length + 1) {
      throw new Error(`unexpected aura set after apply: ${JSON.stringify(applied)}`);
    }
    console.log(`${LABEL}: applied ${applied.length} auras: ${applied.join(', ')}`);

    // Let the ambient HUD loop repaint (main.ts's own rAF, never a manual
    // world.tick() call racing it -- the same discipline direhowl_deathless_rage_shot.mjs
    // documents).
    await sleep(600);

    // Dismiss the software-rendering banner (this rig forces swiftshader):
    // real driver state, not part of the scenario, so keep it out of frame.
    await page.evaluate(() => {
      for (const btn of document.querySelectorAll('button')) {
        if (btn.textContent?.trim() === 'Dismiss') btn.click();
      }
    });
    await sleep(150);

    const clip = await page.evaluate(() => {
      const el = document.getElementById('buff-bar');
      const r = el.getBoundingClientRect();
      const pad = 24;
      return {
        x: Math.max(0, Math.round(r.left - pad)),
        y: Math.max(0, Math.round(r.top - pad)),
        width: Math.round(r.width + pad * 2),
        height: Math.round(r.height + pad * 2),
      };
    });
    // The painter's pooled nodes carry no id/data attribute (write-elision keeps
    // per-frame writes to background-image/classes/text only), so the reliable
    // DOM-level signal is the count of `.buff` children: 8 capped, 9 with
    // Gloomtithe surviving the cap. (#buff-bar also always carries its own
    // hidden "unlock interface" move/resize/label/glow chrome -- interface_unlock_core.ts
    // HUD_FRAME_SPECS registers every HUD frame including the buff row -- which is
    // NOT aura content, so it is excluded by the .buff class filter.)
    const buffNodeCount = await page.evaluate(
      () => document.querySelectorAll('#buff-bar > .buff').length,
    );
    console.log(`${LABEL}: #buff-bar rendered buff-icon count = ${buffNodeCount}`);

    const outFile = path.join(OUT_DIR, `${LABEL}-buff-bar-gloomtithe-cap.png`);
    await page.screenshot({ path: outFile, clip });
    console.log(`wrote ${outFile}`);
  } finally {
    await browser.close().catch(() => {});
    vite.kill('SIGTERM');
  }
}

await main();
