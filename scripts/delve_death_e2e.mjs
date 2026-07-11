// REAL end-to-end for the death-related Drowned Litany (Heroic) fixes. Offline
// only; needs `npm run dev` (:5173). Drives the actual offline sim through
// window.__game.sim, exercising the real death/respawn seams (dealDamage ->
// handleDeath, releaseSpirit -> releaseSpiritInDelve), the real boss driver
// (updateDelveRuns -> tickDrownedLitanyBoss), and the real static Blackwater
// hazard tick (tickDelveBlackwater). It asserts three fixes:
//
//   (a) COMPANION RESPAWN: the auto-companion (Edda Reedhand) respawns after the
//       owner dies and releases in-delve, and a spent once-per-run rank-3 revive
//       (run.companionReviveUsed) survives the respawn un-reset.
//   (b) BELL DEATH LOOP: a Tolling Bells volley in flight (plus a Blackwater
//       Mark puddle) is cleared on player death, so an in-delve respawn is not
//       killed again by pending lethal effects. Negative control: a volley in
//       flight DOES damage a live player, so the clear check is decisive.
//   (c) HAZARD WALKWAY SAFETY: an authored WALKABLE point clear of every hazard
//       zone in the apse takes zero Blackwater damage over ~4s of ticks, while a
//       point authored INSIDE a hazard zone does take ticks. Both points are
//       derived from the litany layout data itself, not hardcoded coordinates,
//       so the test survives retuning of the pool placement.
//
// The layout is imported in-page through the vite dev server (dynamic import of
// the TS source), never into Node. Everything else drives real sim methods.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('tmp', { recursive: true });

let pass = 0,
  fail = 0;
const check = (name, cond, extra = '') => {
  cond
    ? (pass++, console.log(`  PASS ${name}${extra ? `: ${extra}` : ''}`))
    : (fail++, console.log(`  FAIL ${name}${extra ? `: ${extra}` : ''}`));
};

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 60000,
  userDataDir: `C:/Users/Sud0S/AppData/Local/Temp/woc-delve-death-e2e-${Date.now()}`,
  args: [
    '--window-size=1280,800',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-first-run',
    '--no-default-browser-check',
    // __game is published behind a setTimeout(LOADING_FADE_MS) after the loading
    // fade; an occluded headless page freezes timers, so keep the page active.
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
const errors = [];
// Offline `npm run dev` has no server, so the homepage's /api project-stats fetch
// 502s, unrelated to these fixes. Ignore that one known-benign noise.
const benign = (t) => /502|Bad Gateway|project stats/i.test(t);
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !benign(m.text())) errors.push(`CONSOLE: ${m.text()}`);
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
// Settle before clicking so the boot handlers are attached (clicking the moment
// the node exists in the DOM is a no-op and stalls the boot).
await sleep(2500);
await page.evaluate(() => {
  document.querySelector('.server-select-option[data-mode="offline"]')?.click();
  document.querySelector('#btn-play')?.click();
});
await sleep(1200);
await page.evaluate(() => {
  const name = document.querySelector('#char-name');
  if (name) name.value = 'Deathcheck';
  document.querySelector('#offline-select .mini-class[data-class="warrior"]')?.click();
  document.querySelector('#btn-start-offline')?.click();
});
await page.waitForFunction(() => window.__game?.sim?.player?.pos, { timeout: 30000, polling: 200 });
await sleep(1500);

// Publish the litany layout helpers into the page from the TS source (through the
// vite dev server). We only need pure data/geometry accessors here.
await page.evaluate(async () => {
  const lay = await import('/src/sim/delve_litany_layout.ts');
  const data = await import('/src/sim/data.ts');
  const geo2d = await import('/src/sim/geometry2d.ts');
  window.__litanyGeometry = lay.litanyModuleGeometry;
  window.__delveModuleZOffset = data.delveModuleZOffset;
  window.__polygonXAtZ = geo2d.polygonXAtZ;
});

// -------------------------------------------------------------------------
// (a) COMPANION RESPAWN after an in-delve player death + release.
// -------------------------------------------------------------------------
const companion = await page.evaluate(() => {
  const sim = window.__game.sim;
  const p = sim.player;
  // Clean any prior run so the enter claims a fresh solo instance.
  const prev = sim.delveRunForPlayer(p.id);
  if (prev) {
    sim.leaveDelve();
    sim.freeDelveRun(prev);
  }
  // Heroic gate is level 9+; use a comfortable level.
  sim.setPlayerLevel(14);
  sim.enterDelve('drowned_litany', 'heroic');
  const run = sim.delveRunForPlayer(p.id);
  if (!run) return { err: 'no delve run after enterDelve' };

  const solo = !!run.partyKey && run.partyKey.startsWith('solo:');
  const spawnedCompanion = run.companion ? run.companion.entityId : null;
  const companionAliveOnSpawn =
    spawnedCompanion != null &&
    !!sim.entities.get(spawnedCompanion) &&
    !sim.entities.get(spawnedCompanion).dead;

  // Mark the once-per-run rank-3 revive as already spent, to prove the respawn
  // does not recharge it (the fix must preserve companionReviveUsed).
  run.companionReviveUsed = true;

  // Kill the player through the real death path (dealDamage -> handleDeath),
  // not a raw hp write, so p.dead is set exactly as combat sets it.
  sim.dealDamage(null, p, p.maxHp + 1000, false, 'physical', null, 'hit', true);
  const diedProperly = p.dead === true && p.ghost !== true;

  // Advance a couple of real ticks so the mob-AI pass runs the owner-dead arm of
  // updateDelveCompanion, which despawns the companion while the owner is dead
  // (this mirrors the live sequence the fix must recover from).
  sim.tick();
  sim.tick();
  const companionGoneWhileDead = spawnedCompanion != null && !sim.entities.has(spawnedCompanion);

  // Perform the normal in-delve respawn the game offers (the client calls
  // releaseSpirit; it routes to releaseSpiritInDelve for delve positions).
  sim.releaseSpirit();
  const aliveAfterRespawn = p.dead === false;

  const respawnedCompanion = run.companion ? run.companion.entityId : null;
  const companionEntity = respawnedCompanion != null ? sim.entities.get(respawnedCompanion) : null;

  return {
    solo,
    spawnedCompanion,
    companionAliveOnSpawn,
    diedProperly,
    companionGoneWhileDead,
    aliveAfterRespawn,
    respawnedCompanion,
    respawnedCompanionAlive: !!companionEntity && companionEntity.dead === false,
    respawnedCompanionIsNew: respawnedCompanion != null && respawnedCompanion !== spawnedCompanion,
    companionStateNotNull: sim.companionState != null,
    reviveStillUsed: run.companionReviveUsed === true,
  };
});
console.log('(a) companion:', JSON.stringify(companion));
check('(a) entered drowned_litany solo (heroic)', companion.solo === true);
check('(a) auto-companion spawned + alive on entry', companion.companionAliveOnSpawn === true);
check('(a) player died through the real death path', companion.diedProperly === true);
check('(a) companion despawned while owner dead', companion.companionGoneWhileDead === true);
check('(a) player alive after in-delve respawn', companion.aliveAfterRespawn === true);
check(
  '(a) companion respawned (new entity) and alive',
  companion.respawnedCompanion != null &&
    companion.respawnedCompanionAlive === true &&
    companion.respawnedCompanionIsNew === true,
  `id ${companion.spawnedCompanion}->${companion.respawnedCompanion}`,
);
check('(a) companionState is populated after respawn', companion.companionStateNotNull === true);
check(
  '(a) spent rank-3 revive (companionReviveUsed) survives the respawn un-reset',
  companion.reviveStillUsed === true,
);

// -------------------------------------------------------------------------
// (b) BELL DEATH LOOP: a volley in flight kills the player once, then is cleared
//     on death so the respawn is not killed again. Negative control included.
// -------------------------------------------------------------------------
const bells = await page.evaluate(() => {
  const sim = window.__game.sim;
  const p = sim.player;

  // Advance only the delve-run systems (boss driver + Blackwater hazard) one
  // tick and return the emitted events, without a full sim.tick() moving the
  // player. updateDelveRuns() emits into sim.events; drainEvents() returns +
  // clears that buffer (both are on the real sim, mirroring the unit tests that
  // drive (sim as any).updateDelveRuns() directly).
  const stepDelve = () => {
    sim.updateDelveRuns();
    return sim.drainEvents();
  };

  // Fresh run: free the prior instance (check (a) already spent a death on it;
  // a second death on the same run would trip the two-strike failDelveRun rule
  // and eject the player, tearing down run.nhaliaBoss). A fresh solo enter resets
  // deathsThisRun so this scenario's single death takes the normal in-delve
  // respawn path we want to test.
  const prev = sim.delveRunForPlayer(p.id);
  if (prev) {
    sim.leaveDelve();
    sim.freeDelveRun(prev);
  }
  sim.setPlayerLevel(14);
  sim.enterDelve('drowned_litany', 'heroic');
  const run = sim.delveRunForPlayer(p.id);
  if (!run) return { err: 'no delve run after enterDelve' };

  // Jump straight to the finale module (litany_apse) and spawn it, the same way
  // the unit-test enterLitanyApse helper does. spawnDelveModule spawns the boss.
  const finaleId = 'litany_apse';
  run.modules = [finaleId];
  run.moduleIndex = 0;
  sim.spawnDelveModule(run);
  const onFinale = run.modules[run.moduleIndex] === finaleId;

  // Find Sister Nhalia and put her in combat so the boss driver ticks mechanics.
  const boss = [...sim.entities.values()].find(
    (e) => e.templateId === 'sister_nhalia_drowned_canticle' && !e.dead,
  );
  if (!boss) return { err: 'no Sister Nhalia in apse', onFinale };
  boss.inCombat = true;

  // Move the player onto the altar center so an outbound volley is guaranteed to
  // pass through the player's hit radius on its way out (bells spawn at the altar
  // and fly radially outward). The altar is at room-local (0, 72).
  const zBase = window.__delveModuleZOffset(run.modules, run.moduleIndex);
  const placeAtAltar = () => {
    p.pos.x = run.origin.x + 0;
    p.pos.z = run.origin.z + zBase + 72;
    p.prevPos = { ...p.pos };
  };

  // Ensure boss state exists (inits on the first finale tick).
  sim.updateDelveRuns();
  if (!run.nhaliaBoss) return { err: 'nhaliaBoss state did not init', onFinale };

  // NEGATIVE CONTROL: a volley in flight DOES hurt a live player. Full-heal, put
  // the player on the altar, fire a volley, and tick until a bell contacts.
  p.dead = false;
  p.hp = p.maxHp;
  placeAtAltar();
  run.nhaliaBoss.bellVolleyTimer = 0.001;
  sim.updateDelveRuns(); // fires the volley (bells now in flight)
  const volleyBellCount = run.nhaliaBoss.bells.length;
  const hpBeforeControl = p.hp;
  let controlBellHit = false;
  for (let i = 0; i < 20 * 3; i++) {
    placeAtAltar(); // hold the player in the bell path
    for (const ev of stepDelve()) {
      if (
        ev.type === 'damage' &&
        ev.targetId === p.id &&
        (ev.ability === 'Tolling Bell' || ev.ability === 'Blackwater Mark')
      )
        controlBellHit = true;
    }
    if (controlBellHit) break;
  }
  const controlHpDrop = hpBeforeControl - p.hp;

  // MAIN SCENARIO: fire a fresh volley AND a Blackwater mark, both now in flight.
  // Then kill the player and respawn; the fix clears pending bell/mark lethal
  // effects on death, so the freshly respawned player takes no further damage.
  p.dead = false;
  p.hp = p.maxHp;
  placeAtAltar();
  run.nhaliaBoss.bellVolleyTimer = 0.001;
  sim.updateDelveRuns(); // volley in flight
  run.nhaliaBoss.markTimer = 0.001;
  sim.updateDelveRuns(); // a Blackwater Mark puddle now persisted
  const bellsInFlight = run.nhaliaBoss.bells.length;
  const marksInFlight = run.nhaliaBoss.marks.length;
  const bellIds = run.nhaliaBoss.bells.map((b) => b.entityId);
  const volleyTimerBeforeDeath = run.nhaliaBoss.bellVolleyTimer;
  const firedCantorBeforeDeath = run.nhaliaBoss.firedCantorPhases;

  // Kill the player through the real death path, then respawn in-delve.
  sim.dealDamage(null, p, p.maxHp + 1000, false, 'physical', null, 'hit', true);
  const diedProperly = p.dead === true && p.ghost !== true;
  sim.releaseSpirit();
  const aliveAfterRespawn = p.dead === false;

  const bellsClearedOnDeath = run.nhaliaBoss.bells.length === 0;
  const marksClearedOnDeath = run.nhaliaBoss.marks.length === 0;
  const bellEntitiesDropped = bellIds.every((id) => !sim.entities.has(id));

  // Isolate the fix under test: the PRE-DEATH volley/mark must not damage the
  // respawned player. The boss keeps fighting for a live party, so a brand-new
  // volley fired after respawn IS correct behavior and would be a false failure
  // here; push the volley/mark timers out past the observation window so ONLY
  // an effect that survived the death (the bug) could land a hit.
  run.nhaliaBoss.bellVolleyTimer = 999;
  run.nhaliaBoss.markTimer = 999;

  // Discard every event emitted before this point (the setup volleys/marks and
  // the kill blow pushed Tolling Bell / Blackwater damage into sim.events but
  // were never drained). Otherwise the first post-respawn stepDelve() would drain
  // that stale backlog and miscount a pre-death hit as a post-respawn one.
  sim.drainEvents();

  // Over the next several real seconds, the respawned player takes NO bell/mark
  // damage: the death loop is broken. Hold the player where they respawned.
  const hpAfterRespawn = p.hp;
  let postRespawnBellHits = 0;
  const postHitDetail = [];
  for (let i = 0; i < 20 * 5; i++) {
    for (const ev of stepDelve()) {
      if (
        ev.type === 'damage' &&
        ev.targetId === p.id &&
        (ev.ability === 'Tolling Bell' || ev.ability === 'Blackwater Mark')
      ) {
        postRespawnBellHits++;
        if (postHitDetail.length < 4)
          postHitDetail.push({ i, ability: ev.ability, amount: ev.amount ?? ev.value ?? null });
      }
    }
  }
  const hpUnchangedAfterRespawn = p.hp >= hpAfterRespawn; // may regen up, never bell-damaged down

  // The death must NOT re-arm the encounter (unlike an evade reset): the volley
  // timer and Cantor-phase progress are untouched by the clear.
  const encounterNotRearmed =
    run.nhaliaBoss.firedCantorPhases === firedCantorBeforeDeath &&
    run.nhaliaBoss.bellVolleyTimer > 0;
  void volleyTimerBeforeDeath;

  return {
    onFinale,
    volleyBellCount,
    controlBellHit,
    controlHpDrop,
    bellsInFlight,
    marksInFlight,
    diedProperly,
    aliveAfterRespawn,
    bellsClearedOnDeath,
    marksClearedOnDeath,
    bellEntitiesDropped,
    postRespawnBellHits,
    postHitDetail,
    hpUnchangedAfterRespawn,
    encounterNotRearmed,
  };
});
console.log('(b) bells:', JSON.stringify(bells));
if (bells.err) {
  check('(b) bell scenario reached the apse finale', false, bells.err);
} else {
  check('(b) reached the litany_apse finale via advanceDelveModule', bells.onFinale === true);
  check('(b) a volley fires bells into flight', bells.volleyBellCount > 0);
  check(
    '(b) NEGATIVE CONTROL: a volley in flight damages a live player',
    bells.controlBellHit === true && bells.controlHpDrop > 0,
    `hp drop ${bells.controlHpDrop}`,
  );
  check(
    '(b) bells + a Blackwater mark are in flight before death',
    bells.bellsInFlight > 0 && bells.marksInFlight > 0,
  );
  check('(b) player died through the real death path', bells.diedProperly === true);
  check('(b) player alive after in-delve respawn', bells.aliveAfterRespawn === true);
  check('(b) in-flight bells cleared on death', bells.bellsClearedOnDeath === true);
  check('(b) in-flight Blackwater marks cleared on death', bells.marksClearedOnDeath === true);
  check('(b) bell projectile entities dropped on death', bells.bellEntitiesDropped === true);
  check(
    '(b) respawned player takes NO further bell/mark damage over ~5s',
    bells.postRespawnBellHits === 0 && bells.hpUnchangedAfterRespawn === true,
    `postRespawnBellHits=${bells.postRespawnBellHits}`,
  );
  check('(b) player death does not re-arm the encounter', bells.encounterNotRearmed === true);
}

// -------------------------------------------------------------------------
// (c) HAZARD WALKWAY SAFETY: an authored walkable point clear of every hazard is
//     dry over ~4s; a point inside a hazard zone takes ticks. Points derived
//     from the layout data itself.
// -------------------------------------------------------------------------
const hazard = await page.evaluate(() => {
  const sim = window.__game.sim;
  const p = sim.player;

  // Advance only the delve-run systems one tick and return the emitted events
  // (see the bell scenario for why we avoid a full sim.tick() here).
  const stepDelve = () => {
    sim.updateDelveRuns();
    return sim.drainEvents();
  };

  // Fresh run so this check is independent of the death count the bell scenario
  // spent (keeps the whole script green on a back-to-back re-run).
  const prev = sim.delveRunForPlayer(p.id);
  if (prev) {
    sim.leaveDelve();
    sim.freeDelveRun(prev);
  }
  sim.setPlayerLevel(14);
  sim.enterDelve('drowned_litany', 'heroic');
  const run = sim.delveRunForPlayer(p.id);
  if (!run) return { err: 'no delve run after enterDelve' };

  const moduleId = 'litany_apse';
  run.modules = [moduleId];
  run.moduleIndex = 0;
  sim.spawnDelveModule(run);
  // Clear the room so ONLY the static hazard could deal Blackwater damage, and
  // make sure the boss is not tossing marks/bells during this window.
  for (const id of [...run.mobIds]) sim.dropEntity(id);
  if (run.nhaliaBoss) {
    run.nhaliaBoss.bells = [];
    run.nhaliaBoss.marks = [];
  }

  const geo = window.__litanyGeometry(moduleId);
  if (!geo) return { err: 'no apse geometry' };
  const poly = geo.walkable[0].points;
  const hazards = geo.hazards;

  // Point-in-polygon (even-odd), matching src/sim/geometry2d.polygonContainsPoint.
  const inPoly = (pts, x, z) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const pi = pts[i];
      const pj = pts[j];
      const hit = pi.z > z !== pj.z > z && x < ((pj.x - pi.x) * (z - pi.z)) / (pj.z - pi.z) + pi.x;
      if (hit) inside = !inside;
    }
    return inside;
  };
  // Inside-any-hazard uses the SAME ellipse test tickDelveBlackwater uses
  // (rx/rz per-axis, r/r fallback). A small dry-margin buffer keeps the derived
  // walkable probe clear of the very hazard edge so it is unambiguously dry.
  const hazardScore = (x, z, buffer) => {
    let worst = 0; // 0 = clear, 1 = inside some ellipse (with buffer)
    for (const h of hazards) {
      const rx = (h.rx ?? h.r) + buffer;
      const rz = (h.rz ?? h.r) + buffer;
      const dx = x - h.x;
      const dz = z - h.z;
      if ((dx * dx) / (rx * rx) + (dz * dz) / (rz * rz) <= 1) worst = 1;
    }
    return worst;
  };

  // Dais and islands are authored dry ground (tickDelveBlackwater exempts them);
  // skip a candidate that lands on one so the "walkable and dry" point is a real
  // Blackwater-tick candidate that only the hazard geometry keeps dry.
  const onDryGround = (x, z) => {
    if (Math.hypot(x - geo.dais.x, z - geo.dais.z) <= geo.dais.r) return true;
    for (const isl of geo.islands) {
      if (Math.abs(x - isl.x) <= isl.hw && Math.abs(z - isl.z) <= isl.hd) return true;
    }
    return false;
  };

  // Derive a WALKABLE + hazard-clear point by scanning the polygon bounding box
  // on a grid and picking the interior point farthest from every hazard edge (a
  // robust "middle of the dry walkway"), requiring a >=2yd dry buffer.
  let xMin = Infinity,
    xMax = -Infinity,
    zMin = Infinity,
    zMax = -Infinity;
  for (const pt of poly) {
    xMin = Math.min(xMin, pt.x);
    xMax = Math.max(xMax, pt.x);
    zMin = Math.min(zMin, pt.z);
    zMax = Math.max(zMax, pt.z);
  }
  const clearMargin = (x, z) => {
    let m = Infinity;
    for (const h of hazards) {
      const rx = h.rx ?? h.r;
      const rz = h.rz ?? h.r;
      const dx = x - h.x;
      const dz = z - h.z;
      // Signed distance-ish to the ellipse boundary in normalized space, mapped
      // back to yards using the smaller radius as the scale.
      const nd = Math.sqrt((dx * dx) / (rx * rx) + (dz * dz) / (rz * rz));
      const yards = (nd - 1) * Math.min(rx, rz);
      m = Math.min(m, yards);
    }
    return m; // positive = outside every hazard by this many yards
  };
  let best = null;
  for (let x = Math.ceil(xMin); x <= Math.floor(xMax); x++) {
    for (let z = Math.ceil(zMin); z <= Math.floor(zMax); z++) {
      if (!inPoly(poly, x, z)) continue;
      if (onDryGround(x, z)) continue; // must be a real hazard-tick candidate
      const m = clearMargin(x, z);
      if (m < 2) continue; // require a comfortable dry buffer
      if (best === null || m > best.m) best = { x, z, m };
    }
  }
  if (!best) return { err: 'no walkable hazard-clear point found in apse polygon' };

  // Derive a point INSIDE a hazard zone that the Blackwater tick will actually
  // damage: it must be inside a hazard ellipse AND on the walkable polygon AND
  // NOT on a dry island/dais (tickDelveBlackwater exempts island/dais ground, so
  // a hazard centre that happens to sit under the altar island reads as dry).
  // Scan the grid for the point deepest inside a hazard that clears dry ground,
  // preferring a deep-tier zone (2.0x, unambiguously lethal) when one qualifies.
  const insideHazardTier = (x, z) => {
    let tier = null; // 'deep' beats 'shallow'
    for (const h of hazards) {
      const rx = h.rx ?? h.r;
      const rz = h.rz ?? h.r;
      const dx = x - h.x;
      const dz = z - h.z;
      if ((dx * dx) / (rx * rx) + (dz * dz) / (rz * rz) <= 1) {
        const t = h.tier ?? 'deep';
        if (t === 'deep') return 'deep';
        if (tier === null) tier = 'shallow';
      }
    }
    return tier;
  };
  let wetBest = null;
  for (let x = Math.ceil(xMin); x <= Math.floor(xMax); x++) {
    for (let z = Math.ceil(zMin); z <= Math.floor(zMax); z++) {
      if (!inPoly(poly, x, z)) continue;
      if (onDryGround(x, z)) continue; // exempted by the tick: not a real wet probe
      const tier = insideHazardTier(x, z);
      if (!tier) continue;
      // Prefer the most-inside deep point; -clearMargin is how deep we are.
      const depth = -clearMargin(x, z);
      const rank = (tier === 'deep' ? 1000 : 0) + depth;
      if (wetBest === null || rank > wetBest.rank) wetBest = { x, z, tier, rank };
    }
  }
  if (!wetBest) return { err: 'no wet hazard point clear of dry ground found', dry: best };
  const wet = { x: wetBest.x, z: wetBest.z, tier: wetBest.tier };
  const wetInsidePoly = inPoly(poly, wet.x, wet.z);
  const wetScore = hazardScore(wet.x, wet.z, 0);
  const dryScore = hazardScore(best.x, best.z, 2); // still clear with a 2yd buffer

  const zBase = window.__delveModuleZOffset(run.modules, run.moduleIndex);
  const toWorld = (lx, lz) => ({
    x: run.origin.x + lx,
    z: run.origin.z + zBase + lz,
  });

  const countBlackwater = (localX, localZ, ticks) => {
    const w = toWorld(localX, localZ);
    p.dead = false;
    p.hp = p.maxHp;
    p.jumping = false;
    p.pos.x = w.x;
    p.pos.z = w.z;
    p.prevPos = { ...p.pos };
    let hits = 0;
    for (let i = 0; i < ticks; i++) {
      // Re-plant every tick so nothing can nudge the player off the probe point.
      p.pos.x = w.x;
      p.pos.z = w.z;
      p.prevPos = { ...p.pos };
      for (const ev of stepDelve()) {
        if (ev.type === 'damage' && ev.targetId === p.id && ev.ability === 'Blackwater') hits++;
      }
    }
    return hits;
  };

  // ~4 real seconds of ticks (80 ticks at 20 Hz) covers multiple hazard pulses.
  const dryHits = countBlackwater(best.x, best.z, 80);
  const wetHits = countBlackwater(wet.x, wet.z, 80);

  // Decisive walkway-ring probe: the specific bug this fix addresses is the moat
  // rim reaching the OUTER walkway ring and drowning the authored safe flank at
  // the moat's z-center. Derive that flank straight from the polygon boundary
  // (polygonXAtZ) 1yd inside the wall on each side, at the moat centre z. Post-
  // fix these are dry; if the moat rx regressed to reach the wall they would take
  // ticks. The apse hazard[0] is the moat; use its z-center.
  const moatZ = hazards[0].z;
  const westWallX = window.__polygonXAtZ(poly, moatZ, -1);
  const eastWallX = window.__polygonXAtZ(poly, moatZ, 1);
  const ringProbes =
    westWallX != null && eastWallX != null ? { west: westWallX + 1, east: eastWallX - 1 } : null;
  const ringWestHits = ringProbes ? countBlackwater(ringProbes.west, moatZ, 80) : -1;
  const ringEastHits = ringProbes ? countBlackwater(ringProbes.east, moatZ, 80) : -1;

  return {
    dry: { x: best.x, z: best.z, margin: Number(best.m.toFixed(2)) },
    wet,
    wetInsidePoly,
    wetScore,
    dryScore,
    dryHits,
    wetHits,
    ringProbes: ringProbes
      ? {
          west: Number(ringProbes.west.toFixed(1)),
          east: Number(ringProbes.east.toFixed(1)),
          z: moatZ,
        }
      : null,
    ringWestHits,
    ringEastHits,
  };
});
console.log('(c) hazard:', JSON.stringify(hazard));
if (hazard.err) {
  check('(c) hazard scenario derived probe points from layout', false, hazard.err);
} else {
  check(
    '(c) derived a walkable point clear of every hazard (from layout data)',
    hazard.dryScore === 0,
    `dry local (${hazard.dry.x},${hazard.dry.z}) margin ${hazard.dry.margin}yd`,
  );
  check(
    '(c) derived a point inside an authored hazard zone (from layout data)',
    hazard.wetScore === 1,
    `wet local (${hazard.wet.x},${hazard.wet.z})`,
  );
  check(
    '(c) walkable dry point takes ZERO Blackwater damage over ~4s',
    hazard.dryHits === 0,
    `hits=${hazard.dryHits}`,
  );
  check(
    '(c) hazard-zone point DOES take Blackwater ticks within the interval',
    hazard.wetHits > 0,
    `hits=${hazard.wetHits}`,
  );
  check(
    '(c) authored outer walkway ring flanks stay dry at the moat z-center',
    hazard.ringProbes != null && hazard.ringWestHits === 0 && hazard.ringEastHits === 0,
    hazard.ringProbes
      ? `ring z${hazard.ringProbes.z} west x${hazard.ringProbes.west} (${hazard.ringWestHits}) east x${hazard.ringProbes.east} (${hazard.ringEastHits})`
      : 'polygon has no boundary at moat z',
  );
}

console.log(`\nerrors: ${errors.length ? errors.slice(0, 6).join(' | ') : 'none'}`);
console.log(`\n=== ${pass} passed, ${fail} failed ===`);
await browser.close();
process.exit(fail > 0 || errors.length > 0 ? 1 : 0);
