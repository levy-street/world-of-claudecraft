// Mobile HUD overlap audit for World of ClaudeCraft.
//
// PURPOSE
//   Sibling gate to mobile_cluster_layout_check.mjs. The cluster check gates the
//   thumb-control clusters in isolation; this audit gates the FULL populated HUD:
//   the unit frames, buff/debuff bars, minimap, quest tracker, meters, and the
//   pop-up windows, all with real state (a 4-member party, a forced target, a
//   populated buff bar). It measures REAL getBoundingClientRect geometry (never
//   CSS text) with the shared gap math in ./lib/overlap_geometry.mjs.
//
// TWO PASSES
//   A) Persistent-chrome pass (STRICT, the repeatable pre-release gate): per
//      device profile it builds a party, forces a target (so #party-frames gains
//      the .below-target offset), populates the buff bar, then pairwise-checks
//      the always-on chrome (#target-frame, #party-frames, #buff-bar, #debuff-bar,
//      #minimap-wrap, #quest-tracker, #player-frame, #meters-window) against each
//      other and against the thumb controls. Chrome-vs-chrome readability pairs
//      need gap >= 0; any pair where one element is interactive needs gap >= 4.
//      Violations exit 1 by default (like the cluster check).
//   B) Window-open matrix (AUDIT mode by default: report + screenshots, exit 0;
//      pass --gate to make its violations exit 1 too). For each HUD window toggle
//      it opens the window, asserts the box is fully on-screen and its close
//      control is >= 40px and on-screen, then closeAll() and asserts the
//      body.mobile-window-open class clears. The vendor+bags co-open pair is a
//      special case (windows legitimately cover chrome otherwise, so window-over-
//      chrome overlap is NOT flagged here except that pair).
//
// USAGE
//   Needs a dev server. URL overrides the target (default http://localhost:5173/):
//     URL=http://localhost:5174/ node scripts/mobile_hud_overlap_audit.mjs
//     URL=http://localhost:5174/ node scripts/mobile_hud_overlap_audit.mjs --gate
//   Pass A runs the full six-profile sweep; pass B runs the window matrix at
//   844x390 (every window) plus 932x430 and 1280x720 spot-checks, to keep runtime
//   sane. Screenshots land in tmp/mobile-hud-audit/ under the worktree (git-ignored).
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';
import { controlGap, PROFILES } from './lib/overlap_geometry.mjs';

const URL = process.env.URL || 'http://localhost:5173/';
const GATE = process.argv.includes('--gate');
// Opt-in full sweep (env MATRIX_ALL=1): Pass B runs EVERY window toggle (and the
// vendor+bags co-open) at EVERY profile in PROFILES, instead of each window's own
// short `widths` list. Default (unset) keeps the exact per-window widths below.
const MATRIX_ALL = process.env.MATRIX_ALL === '1';
const SHOT_DIR = 'tmp/mobile-hud-audit';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IGNORED_CONSOLE = /502|Bad Gateway|fetch project stats/i;

// The thumb controls (measured as neighbours of the chrome in pass A). Same set
// the cluster check measures; here they are the interactive neighbours the
// always-on chrome must not crowd.
const CONTROL_IDS = [
  'mobile-action-attack',
  'mobile-target-cycle',
  'mobile-action-page-toggle',
  'mobile-autorun',
  'mobile-interact',
  'mobile-jump',
  'mobile-chat',
  'mobile-social',
  'mobile-more',
  'mobile-consumables-toggle',
];

// Always-on chrome measured in pass A. Frames/bars are readability surfaces;
// #minimap-wrap hosts the interactive zoom buttons so it counts as interactive.
// #party-chip is the mobile collapse chip (a tap target: interactive, 40px floor).
const CHROME_IDS = [
  'target-frame',
  'party-frames',
  'party-chip',
  'buff-bar',
  'debuff-bar',
  'minimap-wrap',
  'quest-tracker',
  'player-frame',
  'meters-window',
];

// Interactive classification for the >= 4px vs >= 0px rule. The thumb ring
// controls plus minimap-zoom / minimap-wrap are things a finger taps; frames and
// bars are read, not tapped, so two of them only need to not visually collide.
const INTERACTIVE_IDS = new Set([...CONTROL_IDS, 'minimap-wrap', 'party-chip']);
// Toggled overlay PANELS (class="panel", not always-on chrome): the player opens
// #meters-window deliberately and it has its own close button, so like a Pass-B
// window it may legitimately sit over the passive readability frames/bars when the
// short-landscape viewport has no other room. It is therefore NOT hard-failed for
// overlapping a readability surface (that pair is NOTED), but it still MUST stay
// clear of the interactive thumb controls and the minimap (an overlay must never
// cover a tap target) and stay on-screen: those pairs keep the normal >= 4px rule.
const OVERLAY_CHROME_IDS = new Set(['meters-window']);
// The ring controls are true circles (border-radius: 50% clips the hit-test too),
// so their mis-tap distance is centre-to-centre minus radii, not box separation.
const CIRCLE_IDS = new Set([
  'mobile-action-attack',
  'mobile-target-cycle',
  'mobile-interact',
  'mobile-action-page-toggle',
  'mobile-autorun',
  'mobile-jump',
]);

const TOUCH_FLOOR = 40;
const MIN_GAP_INTERACTIVE = 4; // px between any pair where one element is interactive
const MIN_GAP_CHROME = 0; // chrome-vs-chrome only needs to not visually overlap

// The window toggles to sweep in pass B, each with the window id it opens and the
// viewport widths to test it at. Every window runs at 844x390; a couple of the
// larger windows also spot-check 932x430 and 1280x720.
const SPOT = [844, 932, 1280];
const WINDOW_MATRIX = [
  { toggle: 'toggleQuestLog', id: 'quest-log-window', widths: SPOT },
  { toggle: 'toggleBags', id: 'bags', widths: SPOT },
  { toggle: 'toggleCrafting', id: 'crafting-window', widths: [844] },
  { toggle: 'toggleCalendar', id: 'calendar-window', widths: [844] },
  { toggle: 'toggleArena', id: 'arena-window', widths: [844] },
  { toggle: 'toggleValeCup', id: 'valecup-window', widths: [844] },
  { toggle: 'toggleLeaderboard', id: 'leaderboard-window', widths: [844] },
  { toggle: 'toggleSocial', id: 'social-window', widths: SPOT },
  { toggle: 'toggleMap', id: 'map-window', widths: [844] },
  { toggle: 'toggleTalents', id: 'talents-window', widths: [844] },
  { toggle: 'toggleChar', id: 'char-window', widths: [844] },
  { toggle: 'toggleSpellbook', id: 'spellbook', widths: [844] },
  { toggle: 'toggleMeters', id: 'meters-window', widths: [844] },
];

const failures = [];
const notes = [];
const fail = (msg) => {
  failures.push(msg);
  console.error(`FAIL ${msg}`);
};
const note = (msg) => {
  notes.push(msg);
  console.log(`NOTE ${msg}`);
};

// In-page rect grab: null for missing / zero-size / display:none / hidden.
function collectRects(page, ids) {
  return page.evaluate((elIds) => {
    const grab = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return null;
      return {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        w: r.width,
        h: r.height,
      };
    };
    const out = { rects: {}, vw: window.innerWidth, vh: window.innerHeight };
    for (const id of elIds) out.rects[id] = grab(document.getElementById(id));
    out.belowTarget = !!document.getElementById('party-frames')?.classList.contains('below-target');
    out.windowOpenClass = document.body.classList.contains('mobile-window-open');
    // Diagnostics for the quest tracker, which the landscape media block hides by
    // design: report whether its STATE populated (rows built) and its display, so a
    // "not measurable" note can say "populated but display:none in landscape" (a real
    // skip) versus "empty" (a broken injection).
    const qt = document.getElementById('quest-tracker');
    out.questTracker = {
      display: qt ? getComputedStyle(qt).display : 'missing',
      rows: document.querySelectorAll('#quest-tracker .qt-title').length,
      htmlLen: qt ? qt.innerHTML.length : -1,
    };
    return out;
  }, ids);
}

// Deterministic mobile viewport flip: raw CDP device metrics (puppeteer omits
// screenWidth/Height and headless then fit-scales a narrower viewport), then wait
// until the tier class and a laid-out control are both real before measuring.
async function flipViewport(page, media, w, h, dsf, expectedTier) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await media.send('Emulation.setDeviceMetricsOverride', {
      width: w,
      height: h,
      deviceScaleFactor: dsf,
      mobile: true,
      screenWidth: w,
      screenHeight: h,
      positionX: 0,
      positionY: 0,
    });
    await media.send('Emulation.resetPageScaleFactor').catch(() => {});
    await sleep(150);
    const inner = await page.evaluate(() => [window.innerWidth, window.innerHeight]);
    if (Math.abs(inner[0] - w) <= 2 && Math.abs(inner[1] - h) <= 2) break;
    if (attempt === 3) fail(`flipViewport(${w}x${h}): page reports ${inner[0]}x${inner[1]}`);
  }
  await page.evaluate(() => {
    document.body.classList.add('mobile-touch', 'game-active');
    window.dispatchEvent(new Event('resize'));
  });
  await sleep(400);
  await page.evaluate(() => document.body.classList.add('mobile-touch', 'game-active'));
  if (expectedTier) {
    const settled = await page
      .waitForFunction(
        (tier) => {
          if (!document.body.classList.contains(tier)) return false;
          const attack = document.getElementById('mobile-action-attack');
          return !!attack && attack.getBoundingClientRect().width > 0;
        },
        { timeout: 12000 },
        expectedTier,
      )
      .then(
        () => true,
        () => false,
      );
    if (!settled) fail(`flipViewport: tier/${expectedTier} or controls never settled`);
  }
  await sleep(250);
}

// Deterministically wait for the party/target HUD to SETTLE before measuring,
// instead of a fixed sleep (a fixed sleep raced the HUD's own repaint cadence and
// flaked with spurious target / below-target violations on iphone-13-landscape).
// Settled means: while #target-frame is visible, #party-frames carries the
// .below-target offset class, AND two consecutive rect samples of #target-frame and
// #party-frames are byte-identical (the frames have stopped moving). If a target is
// not expected (no hostile mob), we only require two stable #party-frames samples.
// Returns { settled, note }; a bounded timeout resolves settled:false with a note.
async function settleFrames(page, { expectTarget }) {
  const DEADLINE = 4000;
  const INTERVAL = 120;
  const start = Date.now();
  let prev = null;
  const sampleOf = () =>
    page.evaluate(() => {
      const grab = (id) => {
        const el = document.getElementById(id);
        if (!el) return null;
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      };
      const pf = document.getElementById('party-frames');
      return {
        target: grab('target-frame'),
        party: grab('party-frames'),
        belowTarget: !!pf?.classList.contains('below-target'),
      };
    });
  while (Date.now() - start < DEADLINE) {
    const s = await sampleOf();
    const targetReady = expectTarget ? !!s.target && s.belowTarget : true;
    // `same` compares this sample to the PREVIOUS one, so it is true only when two
    // consecutive samples are byte-identical (the frames have stopped moving). With
    // targetReady also satisfied, the HUD has settled: measure now.
    const same = prev !== null && JSON.stringify(prev) === JSON.stringify(s);
    if (same && targetReady) return { settled: true, note: null };
    prev = s;
    await sleep(INTERVAL);
  }
  const last = await sampleOf();
  return {
    settled: false,
    note:
      `SETTLE-TIMEOUT after ${DEADLINE}ms (expectTarget=${expectTarget}, ` +
      `target=${last.target ? 'shown' : 'absent'}, belowTarget=${last.belowTarget})`,
  };
}

// Build a real 4-member party alongside the local player. On this branch
// (release/v0.23.0, post-SimContext) the raw sim.parties / sim.partyByPid Maps
// the raid_to_party_shot recipe hand-assembled no longer exist; party state now
// lives behind the party subsystem. The real invite/accept API is the supported
// path and builds a clean 5-member (leader + 4) non-raid party with no stale
// invite cards: addPlayer, then partyInvite + partyAccept each bot.
async function buildParty(page) {
  return page.evaluate(() => {
    const sim = window.__game.sim;
    const p = sim.player;
    const roster = [
      ['Brightoak', 'druid'],
      ['Stormcaller', 'shaman'],
      ['Nightblade', 'rogue'],
      ['Emberlyn', 'mage'],
    ];
    const pids = roster.map(([name, cls], i) => {
      const pid = sim.addPlayer(cls, name);
      const e = sim.entities.get(pid);
      if (e) {
        e.pos = { x: p.pos.x + (i % 4) * 2 - 3, y: p.pos.y, z: p.pos.z + 2 };
        e.prevPos = { ...e.pos };
      }
      return pid;
    });
    let err = null;
    try {
      for (const pid of pids) {
        sim.partyInvite(pid);
        sim.partyAccept(pid);
      }
    } catch (e) {
      err = String(e).slice(0, 150);
    }
    const info = sim.partyInfo;
    return { members: info?.members?.length ?? 0, raid: info?.raid ?? null, err };
  });
}

// Force a target: find a nearby hostile mob (kind 'mob', hostile, not dead) and
// call sim.targetEntity(id). Returns the id or null.
async function forceTarget(page) {
  return page.evaluate(() => {
    const sim = window.__game.sim;
    const p = sim.player;
    let best = null;
    let bestD = Infinity;
    for (const [id, e] of sim.entities.entries()) {
      if (e.kind !== 'mob' || !e.hostile || e.dead) continue;
      const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    if (best !== null) sim.targetEntity(best);
    return best;
  });
}

// Populate the buff bar best-effort: push a synthetic aura onto player.auras (the
// same array the buff-bar painter reads). Returns true if the bar has children.
async function populateBuffBar(page) {
  return page.evaluate(() => {
    const sim = window.__game.sim;
    const p = sim.player;
    if (!Array.isArray(p.auras)) return false;
    if (!p.auras.some((a) => a.id === 'audit-buff')) {
      // Idempotent, matching the debuff helper: re-calling per profile must not
      // stack duplicate buff-bar entries (which would grow the bar's width).
      p.auras.push({
        id: 'audit-buff',
        name: 'Audit Vigor',
        kind: 'buff_ap',
        remaining: 300,
        duration: 300,
        value: 15,
        sourceId: sim.primaryId,
        school: 'physical',
      });
    }
    // Honest result, mirroring the debuff helper: true only if the marker aura
    // actually sits on the player (a skipped push must not read as populated).
    return p.auras.some((a) => a.id === 'audit-buff');
  });
}

// Accept a quest so #quest-tracker renders. sim.acceptQuest requires the player to
// stand next to the quest's giver NPC, which we cannot arrange blind; the tracker
// reads world.questLog directly, so inject a single active entry into that Map (the
// same deterministic bypass scripts/quest_collapse_verify_shot.mjs uses). q_wolves
// is a single-objective zone1 quest, so counts is a one-element array. Returns the
// active-quest count on the world after injection.
async function acceptQuest(page) {
  try {
    return await page.evaluate(() => {
      const ql = window.__game?.world?.questLog; // === sim.questLog offline
      // Guarded like the other state helpers: a missing or non-Map questLog must
      // fail this step cleanly, never throw and abort the whole audit run.
      if (!ql || typeof ql.set !== 'function' || typeof ql.get !== 'function') return 0;
      ql.set('q_wolves', { questId: 'q_wolves', counts: [0], state: 'active' });
      // Meaningful success check: the entry must be retained and active, not
      // merely have been passed to set().
      const entry = ql.get('q_wolves');
      return entry && entry.state === 'active' ? ql.size : 0;
    });
  } catch {
    return 0;
  }
}

// Populate the debuff bar: push a synthetic harmful aura onto player.auras. The
// buff/debuff split (src/ui/auras_view.ts isAuraDebuff) keys on aura.kind, not a
// harmful flag; 'sunder' is in DEBUFF_AURA_KINDS and, unlike 'dot', does not tick,
// so it stays an inert render-only marker for the audit. Well-formed against the
// Aura interface (src/sim/types.ts). Returns true if the aura array now holds it.
async function populateDebuffBar(page) {
  return page.evaluate(() => {
    const sim = window.__game.sim;
    const p = sim.player;
    if (Array.isArray(p.auras)) {
      // Idempotent: only push if the marker aura is not already present, so
      // re-calling per profile never stacks duplicate debuff-bar entries.
      if (!p.auras.some((a) => a.id === 'audit-debuff')) {
        p.auras.push({
          id: 'audit-debuff',
          name: 'Audit Sunder',
          kind: 'sunder',
          remaining: 300,
          duration: 300,
          value: 10,
          sourceId: sim.primaryId,
          school: 'physical',
        });
      }
      return p.auras.some((a) => a.id === 'audit-debuff');
    }
    return false;
  });
}

// Open the meters window (#meters-window) so it is a laid-out, measurable chrome
// neighbour during pass A. It is persistent-chrome-adjacent by design (docks near
// the bottom-right joystick), so it must not crowd the thumb controls either.
// Returns true if hud.toggleMeters exists and the window is now display:block.
async function openMeters(page) {
  return page.evaluate(() => {
    const hud = window.__game.hud;
    if (typeof hud?.toggleMeters !== 'function') return false;
    const el = document.getElementById('meters-window');
    // toggleMeters flips display; only open it if it is not already open.
    if (!el || getComputedStyle(el).display !== 'block') hud.toggleMeters();
    const now = document.getElementById('meters-window');
    return !!now && getComputedStyle(now).display === 'block';
  });
}

// Find any npc entity id (for the vendor co-open pair). Returns id or null.
async function findNpc(page) {
  return page.evaluate(() => {
    const sim = window.__game.sim;
    for (const [id, e] of sim.entities.entries()) {
      if (e.kind === 'npc') return id;
    }
    return null;
  });
}

// Read the mobile party-collapse chip state: whether the chip exists + is laid out,
// its box, and whether the #party-frames container is expanded (member rows shown).
async function readPartyChipState(page) {
  return page.evaluate(() => {
    const chip = document.getElementById('party-chip');
    const pf = document.getElementById('party-frames');
    const box = (el) => {
      if (!el) return null;
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        w: r.width,
        h: r.height,
      };
    };
    return {
      chip: box(chip),
      expanded: !!pf?.classList.contains('party-expanded'),
      frameCount: document.querySelectorAll('#party-frames .party-frame').length,
      // A visible member row's box, to prove the expanded stack really lays out.
      firstFrame: box(document.querySelector('#party-frames .party-frame')),
    };
  });
}

// Tap the party chip via a HIT-TESTED coordinate tap, NOT a bare chip.click(): a
// chip.click() dispatches straight to the element and bypasses hit-testing, so an overlay
// sitting over the chip would go unnoticed. Here we hit-test the chip's centre with
// elementFromPoint and only tap when the chip (or one of its children) is the TOPMOST
// element there; an overlay covering the chip would be topmost instead, so this returns
// false and the expand assertion that follows fails (the class of bug the check guards). A
// raw CDP touch tap does not synthesize a click in this headless env, so we click the
// hit-tested topmost node (a click on the chip's label / chevron child bubbles to the
// chip's own click listener). The HUD picks up the persisted flip on its next update.
async function tapPartyChip(page) {
  const tapped = await page.evaluate(() => {
    const chip = document.getElementById('party-chip');
    if (!chip) return false;
    const r = chip.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    if (!top || (top !== chip && !chip.contains(top))) return false; // covered by an overlay
    top.click();
    window.__game.hud?.update?.(0.05);
    return true;
  });
  await sleep(200);
  return tapped;
}

// Drive the real mobile chat toggle by dispatching TOUCH pointer events on the Chat
// button (bindChatButton listens on pointerdown/pointerup with a long-press timer, NOT
// a synthesized click, so a bare .click() is a no-op). A quick pointerdown->pointerup
// under the long-press threshold is a tap: first tap opens (log + composer via
// enterChatReply/onChat), a later tap closes. Then nudge one HUD update so the party UI
// yields/restores this frame.
async function toggleMobileChat(page) {
  await page.evaluate(() => {
    const btn = document.getElementById('mobile-chat');
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const opts = {
      pointerId: 77,
      pointerType: 'touch',
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
      bubbles: true,
      cancelable: true,
    };
    btn.dispatchEvent(new PointerEvent('pointerdown', opts));
    btn.dispatchEvent(new PointerEvent('pointerup', opts));
    window.__game.hud?.update?.(0.05);
  });
  // The long-press timer is well above a synchronous down->up, so this is always a tap.
  await sleep(120);
  return page.evaluate(() => document.body.classList.contains('mobile-chat-open'));
}

// updatePartyFrames runs on the HUD's ~4Hz mediumHud band, so the chat-open yield lands
// on the NEXT band tick, not the same frame. Pump a few HUD updates across that band and
// wait until the party chip's presence matches the expected state (bounded), so the read
// never races the band. Returns whether the expected state was reached.
async function waitForChipPresence(page, wantChip) {
  for (let i = 0; i < 12; i++) {
    const has = await page.evaluate(() => {
      window.__game.hud?.update?.(0.05);
      const chip = document.getElementById('party-chip');
      if (!chip) return false;
      const s = getComputedStyle(chip);
      return s.display !== 'none' && s.visibility !== 'hidden';
    });
    if (has === wantChip) return true;
    await sleep(80);
  }
  return false;
}

// Read the chat overlay's boxes (log wrap + composer) while chat is open.
async function readChatBoxes(page) {
  return page.evaluate(() => {
    const box = (id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        w: r.width,
        h: r.height,
      };
    };
    return {
      chatOpen: document.body.classList.contains('mobile-chat-open'),
      log: box('chatlog-wrap'),
      tabs: box('chatlog-tabs'),
      frame: box('chatlog-frame'),
      input: box('chat-input'),
      inputInsideLog: document.getElementById('chat-input')?.parentElement?.id === 'chatlog-wrap',
      dismiss: box('chat-dismiss'),
      inputFocused: document.activeElement === document.getElementById('chat-input'),
    };
  });
}

// Simulate the on-screen keyboard rising: the same body class + viewport var the real
// keyboard_viewport applier sets off visualViewport (the proven PR #1578 pattern), so
// the composer + dismiss chevron take their keyboard-open seats without a real keyboard.
// The var is written INLINE ON BODY exactly as keyboard_viewport_applier.ts writes it
// (doc.body.style.setProperty, re-run on every resize). Writing it on documentElement
// instead would be SHADOWED by body's own value for #chat-input / #chat-dismiss (both
// descendants of body), so the docked keyboard seats would never engage in the audit.
async function simulateKeyboardOpen(page, visibleVh) {
  await page.evaluate((vh) => {
    document.body.classList.add('mobile-keyboard-open');
    document.body.style.setProperty('--mobile-keyboard-visible-vh', `${vh}px`);
  }, visibleVh);
  await sleep(120);
}

async function simulateKeyboardClose(page) {
  await page.evaluate(() => {
    document.body.classList.remove('mobile-keyboard-open');
    document.body.style.removeProperty('--mobile-keyboard-visible-vh');
  });
  await sleep(120);
}

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});
try {
  mkdirSync(SHOT_DIR, { recursive: true });
  const page = await browser.newPage();
  page.on('pageerror', (err) => fail(`pageerror: ${String(err).slice(0, 200)}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !IGNORED_CONSOLE.test(msg.text())) {
      fail(`console error: ${msg.text().slice(0, 200)}`);
    }
  });
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluate(() => {}).catch(() => {});
  await page.goto(URL, { waitUntil: 'networkidle2' });
  // Suppress the tutorial before entry so its cards do not overlay the chrome.
  await page.evaluate(() => localStorage.setItem('woc.tutorial.v1', 'done')).catch(() => {});
  await enterOfflineGame(page, { charClass: 'warrior', charName: 'Auditor', settleMs: 1500 });

  const media = await page.createCDPSession();
  await media.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'pointer', value: 'coarse' },
      { name: 'hover', value: 'none' },
    ],
  });
  await media.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  // Keep the character alive: the blind state setup should never let camp wolves
  // kill it mid-audit (death clears frames and would read as a bogus miss).
  await page.evaluate(() => {
    const p = window.__game.sim.player;
    p.maxHp = 99999;
    p.hp = 99999;
  });
  await page.evaluate(() => document.querySelector('.tut-skip')?.click());

  // ---- PASS A: persistent-chrome sweep across all six profiles. ----
  console.log('\n=== PASS A: persistent-chrome overlap sweep (STRICT) ===');
  const partyBuilt = await buildParty(page);
  console.log(`party built: ${JSON.stringify(partyBuilt)}`);
  if (partyBuilt.members !== 5) {
    fail(`pass A setup: party has ${partyBuilt.members} members (expected 5: leader + 4)`);
  }
  // Forming a party as leader pops a one-off Loot Settings dialog; close it so it
  // does not sit over the persistent chrome under measurement (it is not in the
  // measured id set, but closing it keeps the state clean and the shots readable).
  await page.evaluate(() => window.__game.hud.closeAll?.());

  // Populate the three previously-skipped chrome surfaces ONCE (all persist across
  // viewport flips, like the party): accept a quest so #quest-tracker renders,
  // apply a debuff so #debuff-bar renders, and open the meters window so
  // #meters-window is a measured neighbour. Done AFTER closeAll (which would have
  // closed the meters window). Each is measured for real in every profile below.
  const questAccepted = await acceptQuest(page);
  const debuffOk = await populateDebuffBar(page);
  const metersOpen = await openMeters(page);
  console.log(
    `state extras: questLog size=${questAccepted}, debuffApplied=${debuffOk}, ` +
      `metersOpen=${metersOpen}`,
  );
  if (!questAccepted) fail('pass A setup: quest injection left an empty questLog');
  if (!debuffOk) fail('pass A setup: debuff aura was not applied to the player');
  if (!metersOpen) fail('pass A setup: #meters-window did not open (hud.toggleMeters)');

  // F6: hard AGGREGATE floor for the mobile-chat cycle. Per-profile chat failures degrade
  // to a NOTE (the synthetic pointer tap can miss on a single flaky profile), but a TOTAL
  // mobile-chat-tap regression (chat never opens/yields/closes anywhere) must NOT exit 0.
  // Count the profiles where the full open -> yield -> close -> restore cycle actually ran,
  // and fail() below if that count is zero.
  let chatCyclesCompleted = 0;
  // Count the resting chat-open profiles where the promoted HARD log-vs-composer pair was
  // actually measured (not skipped because chat failed to open), so the run can prove the
  // pair was exercised rather than silently absent.
  let chatRestingPairsChecked = 0;

  for (const prof of PROFILES) {
    await flipViewport(page, media, prof.w, prof.h, prof.dsf, prof.tier);
    const targetId = await forceTarget(page);
    if (targetId === null) {
      note(`${prof.name}: no hostile mob found to target; #target-frame will be absent`);
    }
    const buffOk = await populateBuffBar(page);
    // Re-assert the debuff + open meters window each profile: the aura array and
    // the quest log survive a viewport flip, but re-pushing the debuff if a tick
    // consumed it and re-opening meters if a resize repaint closed it keeps every
    // profile measuring the full populated chrome set.
    await populateDebuffBar(page);
    await openMeters(page);
    // Nudge the HUD to repaint the frames/bars/target after the state change.
    await page.evaluate(() => {
      window.__game.hud?.update?.(0.05);
      window.dispatchEvent(new Event('resize'));
    });
    // Deterministic settle instead of a fixed sleep: wait for the party/target
    // frames to stop moving and #party-frames to gain .below-target (bounded).
    const settle = await settleFrames(page, { expectTarget: targetId !== null });
    if (!settle.settled) note(`${prof.name}: ${settle.note}`);

    // Forming a party as leader auto-opens the Loot Settings window (once, on becoming
    // leader), which sits over the top-left and COVERS the collapse chip. A real player
    // would close it before tapping the chip; close it here (targeted, so the measured
    // #meters-window stays open) so the chip is genuinely tap-reachable. Without this the
    // hit-tested chip tap correctly refuses to tap the covered chip and the expand fails.
    await page.evaluate(() => window.__game.hud?.closeLootSettings?.());
    await sleep(120);

    // ---- Mobile party-collapse chip: collapsed by default -> expand -> collapse. ----
    // (1) COLLAPSED (the default): only the compact chip shows; the member rows are
    // hidden. Assert the chip is present, meets the 40px floor, and the frames are
    // hidden (frameCount rows exist in the DOM but none are laid out / visible). The
    // chip is created on the mediumHud band after the viewport flip, so pump until it
    // appears (bounded) before reading.
    await waitForChipPresence(page, true);
    const collapsed = await readPartyChipState(page);
    if (!collapsed.chip) {
      fail(`${prof.name}: party chip not present/visible while in a party on mobile (collapsed)`);
    } else {
      if (collapsed.chip.w < TOUCH_FLOOR - 0.5 || collapsed.chip.h < TOUCH_FLOOR - 0.5) {
        fail(
          `${prof.name}: party chip below the ${TOUCH_FLOOR}px floor ` +
            `(${collapsed.chip.w.toFixed(1)}x${collapsed.chip.h.toFixed(1)})`,
        );
      }
      if (collapsed.expanded || collapsed.firstFrame) {
        fail(`${prof.name}: party frames are visible while collapsed (expected chip-only)`);
      }
    }
    if (prof.w === 844) {
      await page.screenshot({ path: `${SHOT_DIR}/passA_partychip_collapsed_${prof.w}.png` });
    }
    // (2) EXPAND via a real tap on the chip, then assert the member stack lays out.
    await tapPartyChip(page);
    const expanded = await readPartyChipState(page);
    if (!expanded.expanded || !expanded.firstFrame) {
      fail(
        `${prof.name}: party chip tap did not expand the member stack ` +
          `(expanded=${expanded.expanded}, firstFrame=${!!expanded.firstFrame})`,
      );
    }
    // Re-settle the now-expanded stack before the existing overlap measurements below.
    await settleFrames(page, { expectTarget: targetId !== null });

    // F1: PER-ROW chip clearance. The pairwise sweep below EXEMPTS the chip-vs-#party-frames
    // pair (nested parent/child), which would otherwise mask a member frame flowing beside
    // or under the collapse chip (the pre-restructure grid bug: a member auto-flowed into the
    // grid cell next to the chip). So measure the chip against EACH member frame's own box:
    // every frame must clear the chip by >= the interactive gap (both are tap targets).
    const chipRows = await page.evaluate(() => {
      const box = (el) => {
        if (!el) return null;
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') return null;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return null;
        return {
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
          w: r.width,
          h: r.height,
        };
      };
      const chip = box(document.getElementById('party-chip'));
      const frames = [...document.querySelectorAll('#party-frames .party-frame')]
        .map(box)
        .filter(Boolean);
      return { chip, frames };
    });
    if (chipRows.chip && chipRows.frames.length) {
      chipRows.frames.forEach((fr, i) => {
        const gap = controlGap('party-chip', chipRows.chip, 'party-frame', fr, CIRCLE_IDS);
        if (gap < MIN_GAP_INTERACTIVE) {
          fail(
            `${prof.name}: party chip vs member frame #${i} gap ${gap.toFixed(1)}px < ` +
              `${MIN_GAP_INTERACTIVE}px (a member frame flows beside/under the collapse chip)`,
          );
        }
      });
    } else {
      note(
        `${prof.name}: chip-vs-frame rows not measurable ` +
          `(chip=${!!chipRows.chip}, frames=${chipRows.frames.length})`,
      );
    }

    // Re-open the Loot Settings window before the pairwise measurement, restoring the
    // ORIGINAL measurement context: a leader in a party has a .window open, which sets
    // body.mobile-window-open and hides #mobile-autorun (it is a movement satellite the HUD
    // hides whenever a window is up). We only closed it above so the chip was tap-reachable;
    // measuring the pairwise gaps with autorun visible would surface a pre-existing
    // meters/party-vs-autorun overlap that never occurs in real play (autorun is hidden
    // while a window is open). Re-opening (non-explicit, so it closes nothing else) keeps
    // the chip's own box measurable through the occlusion. Closed again before the recollapse
    // tap below.
    await page.evaluate(() => window.__game.hud?.openLootSettings?.(false));
    await sleep(150);

    const allIds = [...CHROME_IDS, ...CONTROL_IDS];
    const g = await collectRects(page, allIds);
    if (process.env.DEBUG_RECTS) {
      console.log(`${prof.name} rects: ${JSON.stringify(g.rects)}`);
    }

    // Assert #party-frames carries .below-target while the target frame shows.
    const targetShown = !!g.rects['target-frame'];
    if (targetShown && !g.belowTarget) {
      fail(`${prof.name}: #party-frames lacks .below-target while #target-frame is visible`);
    }
    if (!targetShown) {
      note(`${prof.name}: #target-frame not visible (skipping below-target assertion)`);
    }

    // Note any chrome that is display:none in this state (not measured). The quest
    // tracker gets a precise reason: the landscape media block hides it by design
    // (short landscape phones show quests via the map badges instead), so it is a
    // deliberate skip on every (all-landscape) audit profile, NOT a broken state.
    // We still assert its STATE populated (rows built from the injected questLog),
    // so a genuinely empty tracker would fail rather than pass as a silent skip.
    for (const id of CHROME_IDS) {
      if (g.rects[id]) continue;
      if (id === 'quest-tracker') {
        const qt = g.questTracker;
        if (qt.rows < 1 || qt.htmlLen < 1) {
          fail(
            `${prof.name}: #quest-tracker has no content despite the injected quest ` +
              `(rows=${qt.rows}, htmlLen=${qt.htmlLen}); the questLog injection is broken`,
          );
        } else {
          note(
            `${prof.name}: #quest-tracker populated (rows=${qt.rows}) but display:${qt.display} ` +
              `-- hidden by the landscape media block by design; SKIPPED (not measurable in landscape)`,
          );
        }
        continue;
      }
      note(`${prof.name}: #${id} not measurable (display:none / empty)`);
    }
    if (!g.rects['buff-bar']) {
      note(`${prof.name}: #buff-bar empty despite populate attempt (buffOk=${buffOk}); SKIPPED`);
    }
    if (!g.rects['debuff-bar']) {
      note(`${prof.name}: #debuff-bar empty despite debuff apply (debuffOk=${debuffOk}); SKIPPED`);
    }

    // Pairwise gap check across every visible chrome + control rect.
    const entries = allIds.map((id) => [id, g.rects[id]]).filter(([, r]) => r);
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [idA, a] = entries[i];
        const [idB, b] = entries[j];
        // #party-chip is a CHILD of #party-frames (the collapse header seated inside the
        // container), so their boxes nest by design; skip that parent/child pair (it is
        // not a mis-tap / readability collision). Every other party-chip pair is checked.
        const nested =
          (idA === 'party-chip' && idB === 'party-frames') ||
          (idA === 'party-frames' && idB === 'party-chip');
        if (nested) continue;
        const interactive = INTERACTIVE_IDS.has(idA) || INTERACTIVE_IDS.has(idB);
        const gap = controlGap(idA, a, idB, b, CIRCLE_IDS);
        // A toggled overlay panel (meters) over a passive readability surface is
        // allowed (NOTE, like a Pass-B window over chrome); its interactive-control
        // and minimap pairs still enforce the normal gap.
        const overlayVsReadable =
          (OVERLAY_CHROME_IDS.has(idA) || OVERLAY_CHROME_IDS.has(idB)) && !interactive;
        if (overlayVsReadable) {
          if (gap < MIN_GAP_CHROME) {
            note(
              `${prof.name}: #${idA} vs #${idB} overlap ${(-gap).toFixed(1)}px ` +
                `(toggled overlay over readability surface; allowed)`,
            );
          }
          continue;
        }
        const req = interactive ? MIN_GAP_INTERACTIVE : MIN_GAP_CHROME;
        if (gap < req) {
          fail(
            `${prof.name}: #${idA} vs #${idB} gap ${gap.toFixed(1)}px < ${req}px ` +
              `(${interactive ? 'interactive' : 'chrome'} pair)`,
          );
        }
      }
    }

    // Touch floor for the interactive chrome (minimap-wrap hosts zoom buttons).
    for (const id of CHROME_IDS) {
      const r = g.rects[id];
      if (r && INTERACTIVE_IDS.has(id) && (r.w < TOUCH_FLOOR - 0.5 || r.h < TOUCH_FLOOR - 0.5)) {
        fail(`${prof.name}: #${id} below the ${TOUCH_FLOOR}px touch floor (${r.w}x${r.h})`);
      }
    }

    // A toggled overlay panel is not gated against the frames, but it must still
    // sit fully on-screen (a half-off overlay is a real bug on any viewport).
    for (const id of OVERLAY_CHROME_IDS) {
      const r = g.rects[id];
      if (r && (r.left < -0.5 || r.top < -0.5 || r.right > g.vw + 0.5 || r.bottom > g.vh + 0.5)) {
        fail(
          `${prof.name}: overlay #${id} leaves the viewport ` +
            `(l=${r.left.toFixed(1)} t=${r.top.toFixed(1)} r=${r.right.toFixed(1)} ` +
            `b=${r.bottom.toFixed(1)} vs ${g.vw}x${g.vh})`,
        );
      }
    }

    await page.screenshot({ path: `${SHOT_DIR}/passA_${prof.name}.png` });
    if (prof.w === 844) {
      await page.screenshot({ path: `${SHOT_DIR}/passA_partychip_expanded_${prof.w}.png` });
    }

    // (3) COLLAPSE again via a real tap; assert the member stack hides (chip-only).
    // Close the Loot Settings window again first so the hit-tested tap reaches the chip
    // (it was re-opened for the pairwise measurement above).
    await page.evaluate(() => window.__game.hud?.closeLootSettings?.());
    await sleep(120);
    await tapPartyChip(page);
    const recollapsed = await readPartyChipState(page);
    if (recollapsed.expanded || recollapsed.firstFrame) {
      fail(`${prof.name}: party chip tap did not re-collapse the member stack`);
    }
    if (!recollapsed.chip) {
      fail(`${prof.name}: party chip vanished after re-collapse (expected chip-only)`);
    }

    // ---- Chat-open yield: the party UI yields while mobile chat is open. ----
    // Open the real mobile chat, then assert (a) the party UI yielded (chip + frames
    // hidden), and (b) the chat log + composer are clear of the party container, the
    // target frame, and each other. Then close chat and assert the party stack restored
    // to its PRE-chat state (collapsed here, since we re-collapsed above).
    await toggleMobileChat(page);
    await sleep(200);
    // Re-verify chat is actually open (the synthetic tap can miss on some profiles);
    // only assert the yield when chat genuinely opened, else NOTE and skip.
    const chatOpened = await page.evaluate(() =>
      document.body.classList.contains('mobile-chat-open'),
    );
    if (!chatOpened) {
      note(`${prof.name}: mobile chat did not open (skipping chat-yield assertions)`);
    } else {
      // The yield lands on the next mediumHud band tick; pump updates until the chip is
      // gone (bounded) so the read never races the ~4Hz party-frames cadence.
      await waitForChipPresence(page, false);
      const yielded = await readPartyChipState(page);
      // HARD CHECK (this PR's feature): the party UI yields entirely while chat is open,
      // so the chat overlay owns the top-left. Chip + frames must be gone.
      if (yielded.chip || yielded.expanded || yielded.firstFrame) {
        fail(
          `${prof.name}: party UI did not yield while chat is open ` +
            `(chip=${!!yielded.chip}, expanded=${yielded.expanded}, frame=${!!yielded.firstFrame})`,
        );
      }
      const chat = await readChatBoxes(page);
      // The chat log + composer clearance vs the (yielded) party container, the target
      // frame, and each other. The party frames are hidden, but check the container box
      // too (a stray container box must not sit under chat). NOTE-only: the chat log /
      // composer SEATS are pre-existing (unchanged by this PR), so a residual overlap on
      // a very short landscape viewport (the composer is bottom-anchored, the target
      // frame top-left) is a pre-existing spatial constraint, surfaced but not gated here
      // -- this PR's contract is that the PARTY UI yields (asserted above), which frees
      // the top-left the owner's screenshot flagged.
      const targetRect = g.rects['target-frame'];
      const partyRect = await page.evaluate(() => {
        const el = document.getElementById('party-frames');
        if (!el) return null;
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') return null;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return null;
        return {
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
          w: r.width,
          h: r.height,
        };
      });
      const chatSurfaces = [
        ['chatlog-wrap', chat.log],
        ['chat-input', chat.input],
      ].filter(([, r]) => r);
      const neighbours = [
        ['target-frame', targetRect],
        ['party-frames', partyRect],
      ].filter(([, r]) => r);
      for (const [cid, crect] of chatSurfaces) {
        for (const [nid, nrect] of neighbours) {
          const gap = controlGap(cid, crect, nid, nrect, CIRCLE_IDS);
          if (gap < MIN_GAP_CHROME) {
            note(
              `${prof.name}: chat #${cid} overlaps #${nid} by ${(-gap).toFixed(1)}px while chat open ` +
                `(pre-existing chat seat on a short viewport; party UI yielded)`,
            );
          }
        }
      }
      // HARD (real-device chat-overlap fix): the RESTING chat log and composer must not
      // overlap. Older mobile chat kept the composer outside #chatlog-wrap, so the whole
      // wrap had to clear it. The centered flow-panel model moves the composer inside the
      // wrap as its first child; in that model the load-bearing pair is the log frame vs
      // the composer, because parent-vs-child overlap is expected.
      const chatReadPair = chat.inputInsideLog ? chat.frame : chat.log;
      const chatReadPairId = chat.inputInsideLog ? 'chatlog-frame' : 'chatlog-wrap';
      if (chatReadPair && chat.input) {
        // Counted on MEASUREMENT, not on pass: the zero-floor below means "the
        // pair was never even measured", and a measured-but-failing pair already
        // fails loudly on its own.
        chatRestingPairsChecked++;
        const gap = controlGap(chatReadPairId, chatReadPair, 'chat-input', chat.input, CIRCLE_IDS);
        if (gap < MIN_GAP_INTERACTIVE) {
          fail(
            `${prof.name}: resting chat ${chatReadPairId}/composer gap ${gap.toFixed(1)}px ` +
              `< ${MIN_GAP_INTERACTIVE}px (the composer must clear the readable log area)`,
          );
        }
        // Column order: the tab strip sits at the TOP of the wrap, above the log frame, so
        // the two never meaningfully overlap. The tabs carry a deliberate margin-bottom of
        // -1px (a classic border-merge with the frame's top edge), so tolerate ~1px; a real
        // overflow (the old keyboard-open bug rode the frame tens of px up over the tabs) is
        // gated.
        if (chat.tabs && chat.frame) {
          const tabsGap = controlGap(
            'chatlog-tabs',
            chat.tabs,
            'chatlog-frame',
            chat.frame,
            CIRCLE_IDS,
          );
          if (tabsGap < -2) {
            fail(
              `${prof.name}: resting chat tab strip overlaps the log frame by ` +
                `${(-tabsGap).toFixed(1)}px (tabs must sit above the log, never over it)`,
            );
          }
        }
      }
      // Screenshot the yield state on the primary profile (wake the chrome first so the
      // chat text is at full contrast, not mid idle-fade).
      if (prof.w === 844) {
        await page.evaluate(() => window.dispatchEvent(new Event('touchstart')));
        await sleep(120);
        await page.screenshot({ path: `${SHOT_DIR}/passA_chat_yield_${prof.w}.png` });
      }
      // Close chat and assert the party stack restored to its PRE-chat state (collapsed:
      // chip back, frames still hidden), proving the yield never overwrote the pref.
      // Retry the close once if the first synthetic tap did not land (the tap can miss on
      // some profiles), then only assert restore when chat genuinely closed.
      await toggleMobileChat(page);
      await sleep(200);
      let chatStillOpen = await page.evaluate(() =>
        document.body.classList.contains('mobile-chat-open'),
      );
      if (chatStillOpen) {
        await toggleMobileChat(page);
        await sleep(200);
        chatStillOpen = await page.evaluate(() =>
          document.body.classList.contains('mobile-chat-open'),
        );
      }
      if (chatStillOpen) {
        note(`${prof.name}: mobile chat did not close (skipping the restore assertion)`);
        // Force it closed for a clean state before the next profile.
        await page.evaluate(() => {
          document.body.classList.remove('mobile-chat-open', 'mobile-chat-reply');
          window.__game.hud?.update?.(0.05);
        });
        await sleep(120);
        continue;
      }
      // The restore also lands on the next mediumHud band tick; pump until the chip is
      // back (bounded) before asserting.
      await waitForChipPresence(page, true);
      const restored = await readPartyChipState(page);
      if (!restored.chip) {
        fail(`${prof.name}: party chip did not restore after chat closed`);
      }
      if (restored.expanded || restored.firstFrame) {
        fail(
          `${prof.name}: party stack over-restored (expanded) after chat closed (pref was collapsed)`,
        );
      }
      // The full open -> yield -> close -> restore cycle ran on this profile (F6 floor).
      chatCyclesCompleted++;
    }

    console.log(`checked ${prof.name} (${prof.w}x${prof.h}, target=${targetId})`);
  }

  // F6 aggregate floor: chat must have completed a full cycle on at least one profile.
  // Per-profile misses are tolerated (noted) above, but a total regression fails hard.
  if (chatCyclesCompleted === 0) {
    fail(
      'mobile chat cycle never completed on ANY profile (open/yield/close/restore) ' +
        '-- a total mobile-chat-tap regression',
    );
  }
  // Prove the promoted RESTING log-vs-composer HARD pair was actually measured on at least
  // one profile (else the "hard" check is vacuously passing because chat never opened).
  if (chatRestingPairsChecked === 0) {
    fail(
      'resting chat log-vs-composer pair was never measured on ANY profile ' +
        '(the promoted hard check would pass vacuously)',
    );
  }
  console.log(
    `resting chat log-vs-composer HARD pair measured on ${chatRestingPairsChecked} profile(s)`,
  );

  // ---- Chat keyboard-dismiss: drop the keyboard WITHOUT closing chat. ----
  // On the primary 844 profile: open chat, simulate the on-screen keyboard rising (the
  // same body class + viewport var the real visualViewport handler sets, the proven PR
  // #1578 pattern), focus the composer, then tap the dismiss chevron. Assert chat is
  // STILL open, the composer is unfocused (keyboard dropped), and the log + composer
  // sit at their resting seat (on-screen). Screenshot the just-dismissed state.
  console.log('\n=== Chat keyboard-dismiss (drop keyboard, keep chat open) ===');
  await flipViewport(page, media, 844, 390, 3, 'hud-mobile-compact');
  const dismissOpened = await toggleMobileChat(page);
  if (!dismissOpened) {
    note('chat keyboard-dismiss: chat did not open; NOT COVERED');
  } else {
    // Focus the composer, capture its RESTING seat, then raise the simulated keyboard
    // (visible area shrinks to ~180px).
    await page.evaluate(() => document.getElementById('chat-input')?.focus());
    const restingChat = await readChatBoxes(page);
    const KBD_VH = 180;
    await simulateKeyboardOpen(page, KBD_VH);
    const beforeDismiss = await readChatBoxes(page);
    // F5: the composer must actually DOCK above the keyboard when it opens, which only
    // happens if the simulated --mobile-keyboard-visible-vh lands on the SAME element the
    // real applier writes (body). Its docked bottom sits at the keyboard's top edge
    // (viewport bottom - visibleVh), i.e. measured from the top rect.bottom ~= visibleVh.
    // If the var were shadowed off body (the pre-fix bug), the seat would fall back to
    // 100vh and the composer would sit at rect.bottom ~= vh - 8, at the very bottom UNDER
    // the keyboard. So the docked bottom clearing the keyboard line (<= visibleVh) is itself
    // the proof the var landed on body: a shadowed seat sits FAR below it. (A separate
    // "moved from the resting seat" heuristic used to back this up, but the resting composer
    // now seats near the keyboard line too, so the docked-bottom test carries it alone.)
    if (restingChat.input && beforeDismiss.input) {
      const docked = beforeDismiss.input.bottom <= KBD_VH + 2;
      if (!docked) {
        fail(
          `chat keyboard-dismiss: composer did not dock above the keyboard on open ` +
            `(resting top=${restingChat.input.top.toFixed(1)}, open top=${beforeDismiss.input.top.toFixed(1)}, ` +
            `open bottom=${beforeDismiss.input.bottom.toFixed(1)} vs visibleVh=${KBD_VH}); ` +
            `--mobile-keyboard-visible-vh is likely shadowed off body`,
        );
      }
    } else {
      note(
        'chat keyboard-dismiss: composer not measurable before/after keyboard open (docking check skipped)',
      );
    }
    if (!beforeDismiss.dismiss && !beforeDismiss.inputInsideLog) {
      fail('chat keyboard-dismiss: #chat-dismiss chevron not visible while chat open');
    } else if (
      beforeDismiss.dismiss &&
      (beforeDismiss.dismiss.w < TOUCH_FLOOR - 0.5 || beforeDismiss.dismiss.h < TOUCH_FLOOR - 0.5)
    ) {
      fail(
        `chat keyboard-dismiss: dismiss chevron below the ${TOUCH_FLOOR}px floor ` +
          `(${beforeDismiss.dismiss.w.toFixed(1)}x${beforeDismiss.dismiss.h.toFixed(1)})`,
      );
    }
    // Tap the dismiss chevron when the legacy docked-composer model exposes one.
    // The centered flow-panel model hides it and relies on the OS keyboard hide key,
    // so blur the composer to simulate that path while keeping chat open.
    if (beforeDismiss.dismiss) {
      await page.evaluate(() => document.getElementById('chat-dismiss')?.click());
    } else {
      note('chat keyboard-dismiss: flow-panel composer has no chevron; using blur path');
      await page.evaluate(() => document.getElementById('chat-input')?.blur());
    }
    // The real keyboard would then close; simulate that (visualViewport grows back).
    await simulateKeyboardClose(page);
    await sleep(200);
    const afterDismiss = await readChatBoxes(page);
    // Chat STAYS open, the composer is UNFOCUSED (keyboard dropped), and the log +
    // composer are laid out on-screen at their resting seat.
    if (!afterDismiss.chatOpen) {
      fail('chat keyboard-dismiss: chat closed on dismiss (expected it to stay open)');
    }
    if (afterDismiss.inputFocused) {
      fail('chat keyboard-dismiss: composer still focused after dismiss (keyboard not dropped)');
    }
    if (!afterDismiss.log || !afterDismiss.input) {
      fail('chat keyboard-dismiss: log/composer not laid out after dismiss (chat not at rest)');
    } else {
      const vp = await page.evaluate(() => [window.innerWidth, window.innerHeight]);
      for (const [id, r] of [
        ['chatlog-wrap', afterDismiss.log],
        ['chat-input', afterDismiss.input],
      ]) {
        if (r.left < -0.5 || r.top < -0.5 || r.right > vp[0] + 0.5 || r.bottom > vp[1] + 0.5) {
          fail(`chat keyboard-dismiss: #${id} off-screen after dismiss`);
        }
      }
    }
    await page.evaluate(() => window.dispatchEvent(new Event('touchstart')));
    await sleep(120);
    await page.screenshot({ path: `${SHOT_DIR}/passA_chat_keyboard_dismiss_844.png` });
    console.log('chat keyboard-dismiss: ok (chat open, composer unfocused, at rest)');
    // Close chat to leave a clean state for Pass B. bindChatButton (mobile_controls.ts)
    // listens on pointerdown/pointerup, NOT click, so a bare #mobile-chat.click() is a
    // NO-OP that would leave chat OPEN and run all of Pass B under the chat overlay. Drive
    // the real pointer tap (toggleMobileChat), then force the chat/keyboard classes off if
    // the tap missed (the force-remove fallback the chat-yield section uses above).
    if (await page.evaluate(() => document.body.classList.contains('mobile-chat-open'))) {
      await toggleMobileChat(page);
      await sleep(150);
    }
    await page.evaluate(() => {
      document.body.classList.remove(
        'mobile-chat-open',
        'mobile-chat-reply',
        'mobile-keyboard-open',
      );
      document.body.style.removeProperty('--mobile-keyboard-visible-vh');
      window.__game.hud?.update?.(0.05);
    });
    await sleep(120);
  }

  // ---- Chat keyboard-OPEN docked layout (real-device overlap fix). ----
  // The owner's screenshot bug: while typing with the on-screen keyboard up, the docked
  // chat log's lower lines rendered UNDER the composer (two texts interleaved). The fix
  // re-lays the keyboard-open chat as one non-overlapping column: tab strip at the top,
  // the log frame flexing to fill only the space between the tabs and a RESERVED composer,
  // the composer docked just above the keyboard line with the dismiss chevron centred in
  // its row. This section drives the REAL chat toggle (so the log frame is populated), then
  // simulates the keyboard rising (the proven body-class + --mobile-keyboard-visible-vh
  // recipe) and HARD-checks the column at three landscape sizes. These pairs were NOTE-only
  // (or unmeasured) before the fix; they are gated now.
  console.log('\n=== Chat keyboard-open docked column (log/composer/tabs/chevron) ===');
  const KB_PROFILES = [
    { w: 844, h: 390, dsf: 3, tier: 'hud-mobile-compact', kbvh: 195 },
    { w: 740, h: 360, dsf: 3, tier: 'hud-mobile-compact', kbvh: 180 },
    { w: 932, h: 430, dsf: 3, tier: 'hud-mobile-compact', kbvh: 215 },
  ];
  let kbLayoutChecked = 0;
  for (const kp of KB_PROFILES) {
    await flipViewport(page, media, kp.w, kp.h, kp.dsf, kp.tier);
    const opened = await toggleMobileChat(page);
    if (!opened) {
      note(`chat keyboard-open @${kp.w}: chat did not open; NOT COVERED`);
      continue;
    }
    await page.evaluate(() => document.getElementById('chat-input')?.focus());
    await sleep(120);
    await simulateKeyboardOpen(page, kp.kbvh);
    // Type a real value so the composer carries text over the log lines, exactly like the
    // owner's screenshot (the overlap only reads as "interleaved text" with content in both).
    // The message is long enough to SATURATE the autosize cap (main.ts CHAT_INPUT_MAX_H,
    // 110px) on every profile and font, so the measured geometry is deterministic (the
    // composer is exactly cap-height) and the check exercises the worst case the CSS
    // reservation (126px = cap + gap + dock) must absorb, not a font-metric-dependent
    // partial wrap.
    await page.evaluate(() => {
      const i = document.getElementById('chat-input');
      if (i) {
        i.value = 'typing a long message that would ride over the chat log lines below it '.repeat(
          6,
        );
        i.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await sleep(120);
    const c = await readChatBoxes(page);
    const kbLine = kp.kbvh; // the keyboard's top edge (visible-vh from the top)
    // Guard the docked state actually engaged (the composer moved up to the keyboard line);
    // if the simulated keyboard did not take (var shadowing etc.), skip rather than false-pass.
    if (!c.input || c.input.bottom > kbLine + 3) {
      note(
        `chat keyboard-open @${kp.w}: composer did not dock above the keyboard ` +
          `(input.bottom=${c.input ? c.input.bottom.toFixed(1) : 'n/a'} vs kbLine=${kbLine}); NOT COVERED`,
      );
    } else if (!c.log || !c.frame) {
      // The composer docked but the log box did not render: the overlap pair cannot be
      // measured, so this size is NOT COVERED (fail loudly rather than pass vacuously if it
      // happens on ALL sizes, via the kbLayoutChecked floor below).
      note(
        `chat keyboard-open @${kp.w}: docked composer but log wrap/frame not measurable ` +
          `(log=${!!c.log} frame=${!!c.frame}); NOT COVERED`,
      );
    } else {
      kbLayoutChecked++;
      // (1) HARD: the log frame must not overlap the composer. This is the exact bug: the
      // old height:100% frame plus the tab strip overflowed ~53px DOWN into the composer.
      {
        const gap = controlGap('chatlog-frame', c.frame, 'chat-input', c.input, CIRCLE_IDS);
        if (gap < MIN_GAP_INTERACTIVE) {
          fail(
            `chat keyboard-open @${kp.w}: docked log frame/composer gap ${gap.toFixed(1)}px ` +
              `< ${MIN_GAP_INTERACTIVE}px (the log must reserve the composer, not overlap it)`,
          );
        }
      }
      // Also gate the wrap (the whole log box) vs the composer when they are siblings.
      // In the flow-panel model the composer is inside the wrap, so the frame check
      // above is the meaningful non-overlap assertion.
      if (!c.inputInsideLog) {
        const gap = controlGap('chatlog-wrap', c.log, 'chat-input', c.input, CIRCLE_IDS);
        if (gap < MIN_GAP_INTERACTIVE) {
          fail(
            `chat keyboard-open @${kp.w}: docked log wrap/composer gap ${gap.toFixed(1)}px ` +
              `< ${MIN_GAP_INTERACTIVE}px`,
          );
        }
      }
      // (2) HARD: the tab strip sits above the log frame (column order), never over it
      // (tolerating the tabs' deliberate -1px border-merge margin), and is not cut off the
      // top of the viewport (respecting safe-area-inset-top; horizontal scroll is fine).
      if (c.tabs && c.frame) {
        const tabsGap = controlGap('chatlog-tabs', c.tabs, 'chatlog-frame', c.frame, CIRCLE_IDS);
        if (tabsGap < -2) {
          fail(
            `chat keyboard-open @${kp.w}: docked tab strip overlaps the log by ` +
              `${(-tabsGap).toFixed(1)}px (tabs must sit above the log frame)`,
          );
        }
        if (c.tabs.top < -0.5) {
          fail(
            `chat keyboard-open @${kp.w}: tab strip cut off the top of the viewport ` +
              `(tabs top=${c.tabs.top.toFixed(1)}, must respect safe-area-inset-top)`,
          );
        }
      }
      // (3) HARD: when present, the dismiss chevron sits INSIDE the composer's vertical
      // band. The flow-panel model hides this button and uses the OS keyboard hide path.
      if (c.dismiss) {
        if (c.dismiss.top < c.input.top - 0.5 || c.dismiss.bottom > c.input.bottom + 0.5) {
          fail(
            `chat keyboard-open @${kp.w}: dismiss chevron outside the composer row ` +
              `(chevron top=${c.dismiss.top.toFixed(1)} bottom=${c.dismiss.bottom.toFixed(1)}, ` +
              `composer top=${c.input.top.toFixed(1)} bottom=${c.input.bottom.toFixed(1)})`,
          );
        }
      } else if (!c.inputInsideLog) {
        fail(`chat keyboard-open @${kp.w}: dismiss chevron not visible while typing`);
      }
      // (4) HARD: nothing in the docked column dips below the keyboard's top edge (which
      // the keyboard would cover). The composer bottom is the lowest element.
      for (const [id, r] of [
        ['chatlog-wrap', c.log],
        ['chat-input', c.input],
        ['chat-dismiss', c.dismiss],
      ]) {
        if (r && r.bottom > kbLine + 3) {
          fail(
            `chat keyboard-open @${kp.w}: #${id} bottom ${r.bottom.toFixed(1)} dips below the ` +
              `keyboard line ${kbLine} (would be hidden under the keyboard)`,
          );
        }
      }
    }
    if (kp.w === 844) {
      await page.evaluate(() => window.dispatchEvent(new Event('touchstart')));
      await sleep(120);
      await page.screenshot({ path: `${SHOT_DIR}/passA_chat_keyboard_open_844.png` });
    }
    // Clean state for the next size: drop the keyboard sim + close chat (force the classes
    // off if the pointer tap missed, matching the other chat sections).
    await simulateKeyboardClose(page);
    if (await page.evaluate(() => document.body.classList.contains('mobile-chat-open'))) {
      await toggleMobileChat(page);
      await sleep(120);
    }
    await page.evaluate(() => {
      document.body.classList.remove(
        'mobile-chat-open',
        'mobile-chat-reply',
        'mobile-keyboard-open',
      );
      document.body.style.removeProperty('--mobile-keyboard-visible-vh');
      window.__game.hud?.update?.(0.05);
    });
    await sleep(120);
  }
  if (kbLayoutChecked === 0) {
    fail(
      'chat keyboard-open docked column was never measured on ANY size ' +
        '(the promoted hard checks would pass vacuously)',
    );
  }
  console.log(`chat keyboard-open docked column HARD-checked on ${kbLayoutChecked} size(s)`);

  // Close the meters overlay before Pass B: it is a toggled panel (not a .window),
  // so Pass B's closeAll() would leave it open and its own toggleMeters check would
  // then TOGGLE it shut and mis-read as "did not open". Close it here explicitly.
  await page.evaluate(() => {
    const el = document.getElementById('meters-window');
    if (el && getComputedStyle(el).display === 'block') window.__game.hud.toggleMeters?.();
  });

  // ---- PASS B: window-open matrix (AUDIT by default; --gate to enforce). ----
  console.log(`\n=== PASS B: window-open matrix (${GATE ? 'GATE' : 'AUDIT'} mode) ===`);
  // In gate mode a pass-B miss is a hard failure; in audit mode it is reported
  // and screenshotted but never flips the exit code.
  const bViolation = (msg) => {
    if (GATE) {
      fail(msg);
    } else {
      console.error(`AUDIT ${msg}`);
      notes.push(`AUDIT ${msg}`);
    }
  };

  for (const w of WINDOW_MATRIX) {
    const exists = await page.evaluate(
      (t) => typeof window.__game?.hud?.[t] === 'function',
      w.toggle,
    );
    if (!exists) {
      note(`window ${w.toggle}: method missing on hud; NOT COVERED`);
      continue;
    }
    // Default: the window's own short `widths` list (each resolved to a profile by
    // width). MATRIX_ALL: sweep the window across every profile in PROFILES, so a
    // window is opened at all six/seven device landscapes, not just its spot widths.
    const bProfiles = MATRIX_ALL
      ? PROFILES
      : w.widths.map((width) => PROFILES.find((p) => p.w === width) || PROFILES[0]);
    for (const prof of bProfiles) {
      const width = prof.w;
      await flipViewport(page, media, width, prof.h, prof.dsf, prof.tier);
      // Open the window through the real hud path.
      const opened = await page.evaluate(
        (t, id) => {
          window.__game.hud.closeAll?.();
          window.__game.hud[t]();
          const el = document.getElementById(id);
          if (!el) return { open: false };
          const style = getComputedStyle(el);
          return { open: style.display !== 'none' && style.visibility !== 'hidden' };
        },
        w.toggle,
        w.id,
      );
      await sleep(300);
      if (!opened.open) {
        note(`window ${w.toggle} @${width}: #${w.id} did not open; NOT COVERED`);
        await page.evaluate(() => window.__game.hud.closeAll?.());
        continue;
      }

      const box = await page.evaluate((id) => {
        const el = document.getElementById(id);
        const r = el.getBoundingClientRect();
        const close = el.querySelector('[data-close], .x-btn');
        const cr = close?.getBoundingClientRect() ?? null;
        return {
          win: {
            left: r.left,
            top: r.top,
            right: r.right,
            bottom: r.bottom,
            w: r.width,
            h: r.height,
          },
          close: cr
            ? {
                left: cr.left,
                top: cr.top,
                right: cr.right,
                bottom: cr.bottom,
                w: cr.width,
                h: cr.height,
              }
            : null,
          vw: window.innerWidth,
          vh: window.innerHeight,
        };
      }, w.id);

      // (1) window fully within the viewport.
      const win = box.win;
      if (
        win.left < -0.5 ||
        win.top < -0.5 ||
        win.right > box.vw + 0.5 ||
        win.bottom > box.vh + 0.5
      ) {
        bViolation(
          `window ${w.toggle} @${width}: #${w.id} leaves viewport ` +
            `(l=${win.left.toFixed(1)} t=${win.top.toFixed(1)} r=${win.right.toFixed(1)} ` +
            `b=${win.bottom.toFixed(1)} vs ${box.vw}x${box.vh})`,
        );
      }
      // (2) close control on-screen and >= 40px.
      if (!box.close) {
        bViolation(
          `window ${w.toggle} @${width}: #${w.id} has no [data-close]/.x-btn close control`,
        );
      } else {
        const c = box.close;
        if (c.left < -0.5 || c.top < -0.5 || c.right > box.vw + 0.5 || c.bottom > box.vh + 0.5) {
          bViolation(`window ${w.toggle} @${width}: close control off-screen`);
        }
        if (c.w < TOUCH_FLOOR - 0.5 || c.h < TOUCH_FLOOR - 0.5) {
          bViolation(
            `window ${w.toggle} @${width}: close control below ${TOUCH_FLOOR}px ` +
              `(${c.w.toFixed(1)}x${c.h.toFixed(1)})`,
          );
        }
      }

      await page.screenshot({ path: `${SHOT_DIR}/passB_${w.toggle}_${width}.png` });

      // (3) closeAll clears mobile-window-open.
      const cleared = await page.evaluate(() => {
        window.__game.hud.closeAll();
        return !document.body.classList.contains('mobile-window-open');
      });
      if (!cleared) {
        bViolation(
          `window ${w.toggle} @${width}: body.mobile-window-open not cleared after closeAll()`,
        );
      }
      console.log(`window ${w.toggle} @${width}: ok (open + close-control + closeAll checked)`);
    }
  }

  // Special case: vendor + bags co-open (the one window-over-chrome overlap pair
  // we DO care about). Needs an npc entity to open the vendor offline. NOTE: even
  // when openVendor runs cleanly on a valid npc offline, the #vendor-window and
  // #bags panels render with ZERO geometry (no real width/height), so there is
  // nothing to measure. We require real, laid-out geometry on BOTH panels before
  // claiming coverage; otherwise this is honestly NOT COVERED offline.
  // Default: one flip to 844x390. MATRIX_ALL: the co-open pair at every profile.
  const vendorProfiles = MATRIX_ALL
    ? PROFILES
    : [{ name: 'iphone-13-landscape', w: 844, h: 390, dsf: 3, tier: 'hud-mobile-compact' }];
  for (const vprof of vendorProfiles) {
    await flipViewport(page, media, vprof.w, vprof.h, vprof.dsf, vprof.tier);
    const npcId = await findNpc(page);
    if (npcId === null) {
      note(`vendor+bags @${vprof.w}: no npc entity reachable offline; NOT COVERED`);
      continue;
    }
    const vendorState = await page.evaluate((id) => {
      window.__game.hud.closeAll?.();
      let openErr = null;
      try {
        window.__game.hud.openVendor(id);
      } catch (e) {
        openErr = String(e).slice(0, 150);
      }
      const box = (elId) => {
        const el = document.getElementById(elId);
        if (!el) return null;
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') return null;
        const r = el.getBoundingClientRect();
        return {
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
          w: r.width,
          h: r.height,
        };
      };
      return {
        openErr,
        vendorOpenClass: document.body.classList.contains('vendor-open'),
        vendor: box('vendor-window'),
        bags: box('bags'),
      };
    }, npcId);
    const v = vendorState.vendor;
    const b = vendorState.bags;
    if (process.env.DEBUG_RECTS)
      console.log(`vendor state @${vprof.w}: ${JSON.stringify(vendorState)}`);
    // Both panels must be real, laid-out, AND actually overlapping the game area
    // (not a zero-origin degenerate box). Offline, openVendor engages the class but
    // the panels do not paint, so guard on a non-trivial box that starts on-screen.
    const laidOut = (r) => r && r.w >= 80 && r.h >= 80 && r.right > 0 && r.bottom > 0;
    if (!vendorState.vendorOpenClass || vendorState.openErr) {
      note(
        `vendor+bags @${vprof.w}: openVendor did not engage ` +
          `${JSON.stringify(vendorState)}; NOT COVERED`,
      );
    } else if (!laidOut(v) || !laidOut(b)) {
      note(
        `vendor+bags @${vprof.w}: panels have no real geometry offline ` +
          `(vendor=${v ? `${v.w.toFixed(0)}x${v.h.toFixed(0)}` : 'null'}, ` +
          `bags=${b ? `${b.w.toFixed(0)}x${b.h.toFixed(0)}` : 'null'}); NOT COVERED offline`,
      );
    } else {
      const gap = controlGap('vendor-window', v, 'bags', b, CIRCLE_IDS);
      if (gap < 0) {
        bViolation(
          `vendor+bags @${vprof.w}: #vendor-window overlaps #bags by ${(-gap).toFixed(1)}px`,
        );
      } else {
        console.log(`vendor+bags @${vprof.w}: co-open clear (gap ${gap.toFixed(1)}px)`);
      }
      await page.screenshot({ path: `${SHOT_DIR}/passB_vendor_bags_${vprof.w}.png` });
    }
    await page.evaluate(() => window.__game.hud.closeAll?.());
  }

  // ---- Verdict. ----
  console.log(`\n=== AUDIT SUMMARY ===`);
  console.log(`${notes.length} note(s), ${failures.length} strict violation(s).`);
  if (notes.length) console.log(`Notes:\n${notes.map((n) => `  - ${n}`).join('\n')}`);
  if (failures.length) {
    console.error(`\n${failures.length} violation(s).`);
    process.exit(1);
  }
  console.log('\nAll mobile HUD overlap checks passed.');
} finally {
  await browser.close();
}
