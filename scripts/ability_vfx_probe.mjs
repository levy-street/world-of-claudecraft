// Ability VFX coverage probe: proves every spec'd ability produces its FULL
// archetype read in the real client. Boots the offline game (dev server on
// :5173), then for EVERY id in ABILITY_VFX_SPECS synthesizes the render-side
// event the sim would emit (fx derived from projectileFx/castTime/archetype),
// reads the painter's dev stats hook (window.__game.abilityVfxStats), asserts
// the PER-ARCHETYPE minimum primitive bar (bolt/nova/shout >= 3, everything
// else >= 2, +1 when the full spec authors motifs), screenshots every 5th cast
// to tmp/vfx_ingame/, drives a real self-buff cast (orbit band) plus a melee
// auto-attack sequence, and writes tmp/vfx_ingame/report.json.
//
// Usage: npm run dev (":5173") in another terminal, then
//   node scripts/ability_vfx_probe.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT_DIR = 'tmp/vfx_ingame';
const CAST_SETTLE_MS = Number(process.env.VFX_PROBE_SETTLE_MS ?? 600);
fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const pageerrors = [];
page.on('pageerror', (e) => pageerrors.push(String(e.message ?? e)));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
const booted = await enterOfflineGame(page, { charClass: 'warrior', settleMs: 3000 });
if (!booted) {
  console.error('FAIL: world did not boot');
  await browser.close();
  process.exit(1);
}

// Position near a live mob so targeted events have a real victim in frame, and
// zoom the scene into a stable state.
const setup = await page.evaluate(() => {
  const g = window.__game;
  if (!g.abilityVfxProbe || !g.abilityVfxStats) return { ok: false, reason: 'no dev probe hook' };
  const sim = g.sim;
  const p = sim.player;
  let mob = null;
  let best = 1e9;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead && e.ownerId === null) {
      const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (d < best) {
        best = d;
        mob = e;
      }
    }
  }
  if (mob) {
    p.pos.x = mob.pos.x + 4;
    p.pos.z = mob.pos.z;
  }
  // Keep the probe screenshots clean: dismiss the software-GL notice if shown.
  document.querySelector('.gpu-notice-dismiss')?.click();
  return {
    ok: true,
    playerId: p.id,
    mobId: mob ? mob.id : p.id,
    specCount: Object.keys(g.abilityVfxProbe.specs).length,
  };
});
if (!setup.ok) {
  console.error('FAIL:', setup.reason);
  await browser.close();
  process.exit(1);
}
console.log(
  `probing ${setup.specCount} ability specs (player ${setup.playerId}, mob ${setup.mobId})`,
);
await new Promise((r) => setTimeout(r, 500));

const specIds = await page.evaluate(() => Object.keys(window.__game.abilityVfxProbe.specs).sort());

const results = {};
let shot = 0;
for (let i = 0; i < specIds.length; i++) {
  const id = specIds[i];
  const cast = await page.evaluate(
    (abilityId, playerId, mobId) => {
      const g = window.__game;
      const spec = g.abilityVfxProbe.specs[abilityId];
      const ab = g.abilityVfxProbe.abilities[abilityId];
      // Derive the fx kind the sim would emit for this ability: an authored
      // projectile override wins; timed casts launch projectiles; instants
      // read by archetype (novas/shouts pulse at the caster, the rest tick).
      const fx =
        ab?.projectileFx ??
        (ab && ab.castTime > 0
          ? 'projectile'
          : spec.a === 'nova' || spec.a === 'shout'
            ? 'nova'
            : 'tick');
      const school = ab?.school ?? 'nature';
      const selfCentered = fx === 'nova' || !ab || !ab.requiresTarget;
      // The boot-time mob can DIE mid-sweep (wildlife fights): re-pick the
      // nearest LIVING mob per cast so target-anchored impacts never fizzle.
      const p = g.sim.player;
      let liveMob = null;
      let best = 1e9;
      for (const e of g.sim.entities.values()) {
        if (e.kind === 'mob' && !e.dead && e.ownerId === null) {
          const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
          if (d < best) {
            best = d;
            liveMob = e;
          }
        }
      }
      const targetId = selfCentered ? playerId : liveMob ? liveMob.id : mobId;
      // Top the character up each cast so aggro cannot kill it mid-run (dev
      // harness convention: smoke scripts already write player state directly).
      p.maxHp = Math.max(p.maxHp, 4000);
      if (!p.dead) p.hp = p.maxHp;
      const before = g.abilityVfxStats()[abilityId] ?? { claimed: 0, primitives: 0 };
      g.renderer.handleEvent({
        type: 'spellfx',
        sourceId: playerId,
        targetId,
        school,
        fx,
        ability: abilityId,
      });
      return { fx, school, before };
    },
    id,
    setup.playerId,
    setup.mobId,
  );
  await new Promise((r) => setTimeout(r, CAST_SETTLE_MS));
  if (i % 5 === 0) {
    shot++;
    await page.screenshot({
      path: `${OUT_DIR}/${String(i).padStart(3, '0')}_${id}.png`,
    });
  }
  const after = await page.evaluate((abilityId) => {
    const st = window.__game.abilityVfxStats()[abilityId] ?? { claimed: 0, primitives: 0 };
    const full = window.__game.abilityVfxProbe.fullSpecs[abilityId];
    return {
      ...st,
      archetype: full?.archetype ?? 'unknown',
      hasMotifs: !!(full?.motifs && full.motifs.length > 0),
    };
  }, id);
  // The per-archetype minimum primitive bar: the big shapes must always fire;
  // motif-authored specs must additionally land their set piece.
  const baseMin = { bolt: 3, nova: 3, shout: 3 }[after.archetype] ?? 2;
  const minBar = baseMin + (after.hasMotifs ? 1 : 0);
  results[id] = {
    fx: cast.fx,
    school: cast.school,
    archetype: after.archetype,
    hasMotifs: after.hasMotifs,
    minBar,
    claimed: after.claimed - cast.before.claimed > 0,
    primitives: after.primitives - cast.before.primitives,
  };
}

// ---------------------------------------------------------------------------
// REAL-CAST section: actual sim.castAbility per class, end to end. One bolt,
// one buff (rim body glow), one strike where class-appropriate. Asserts the
// live glow level (abilityVfxGlow), projectile/sequence primitives, and the
// swing one-shot counter (abilityVfxAttackCount).
// Buffs the long-buff policy silences while worn (aura >= 300s,
// src/render/ability_vfx_longbuff_core.ts): the cast ceremony and the
// first-sighting gain swirl still register primitives, but no held band or
// ground disc may survive the settle window.
const LONG_SILENT_BUFFS = new Set([
  'arcane_intellect',
  'aspect_of_the_hawk',
  'battle_shout',
  'demon_skin',
  'lightning_shield',
  'mark_of_the_wild',
  'power_word_fortitude',
]);

const REAL_CASTS = {
  // spec: committed spec id, required for spec-gated kit (Blood Toll is
  // arms/prot-only). crusader_strike is talent-GRANTED, not base kit, so the
  // paladin asserts judgement instead.
  // warrior: talent GRANTS (meta.talentMods.grants) make Blood Toll and
  // Bladestorm castable while the base kit stays intact: committing a spec
  // would DROP heroic_strike, which every committed spec excludes.
  warrior: {
    grants: ['bloodrage', 'bladestorm'],
    buff: 'bloodrage',
    strike: 'heroic_strike',
    extraSpin: 'bladestorm',
  },
  mage: { bolt: 'frostbolt', bolt2: 'fireball', buff: 'arcane_intellect' },
  priest: { bolt: 'smite', buff: 'power_word_fortitude' },
  warlock: { bolt: 'shadow_bolt', buff: 'demon_skin' },
  druid: { bolt: 'wrath', buff: 'mark_of_the_wild' },
  shaman: { bolt: 'lightning_bolt', buff: 'lightning_shield' },
  hunter: { bolt: 'arcane_shot', buff: 'aspect_of_the_hawk', strike: 'raptor_strike' },
  paladin: { buff: 'seal_of_righteousness', bolt2: 'judgement' },
  rogue: { buff: 'evasion', strike: 'sinister_strike' },
};

async function realCastClass(cls, plan) {
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
  const ok = await enterOfflineGame(page, { charClass: cls, settleMs: 2600 });
  if (!ok) return { cls, error: 'boot failed' };
  const ids = await page.evaluate(
    (specId, grants) => {
      const g = window.__game;
      const sim = g.sim;
      const p = sim.player;
      // dev probe conventions: level up so the kit is known (meta.known is a
      // SNAPSHOT: refresh it the way levelUp does), commit a spec for
      // spec-gated kit, park by a mob, and widen the pools so rank-scaled
      // costs at 40 stay affordable
      p.level = 40;
      const meta = sim.players?.get?.(p.id);
      if (meta) {
        if (specId && meta.talentMods) meta.talentMods.spec = specId;
        if (grants.length > 0 && meta.talentMods) {
          meta.talentMods.grants = [
            ...(meta.talentMods.grants ?? []),
            ...grants.map((ability) => ({ ability })),
          ];
        }
        sim.refreshKnownAbilities?.(meta, false);
      }
      p.maxHp = Math.max(p.maxHp, 4000);
      p.maxResource = Math.max(p.maxResource, 4000);
      p.hp = p.maxHp;
      p.resource = p.maxResource;
      let mob = null;
      let best = 1e9;
      for (const e of sim.entities.values()) {
        if (e.kind === 'mob' && !e.dead && e.ownerId === null && e.hostile !== false) {
          const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
          if (d < best) {
            best = d;
            mob = e;
          }
        }
      }
      if (mob) {
        p.pos.x = mob.pos.x + 3;
        p.pos.z = mob.pos.z;
        sim.targetEntity(mob.id);
      }
      document.querySelector('.gpu-notice-dismiss')?.click();
      return { playerId: p.id, mobId: mob ? mob.id : p.id };
    },
    plan.spec ?? null,
    plan.grants ?? [],
  );
  const out = { cls };
  let retried = false;
  const castOne = async (kind, abilityId, settleMs, standOff = 3) => {
    if (!abilityId) return;
    const before = await page.evaluate(
      (id, playerId, dist) => {
        const g = window.__game;
        const sim = g.sim;
        const p = sim.player;
        p.hp = p.maxHp;
        p.resource = p.maxResource;
        // retarget the nearest LIVING mob at the requested stand-off: a rank-40
        // bolt one-shots level-3 mobs, and hunter shots have a min-range dead
        // zone, so each cast needs a fresh victim at the right distance
        let mob = null;
        let best = 1e9;
        for (const e of sim.entities.values()) {
          if (e.kind === 'mob' && !e.dead && e.ownerId === null && e.hostile !== false) {
            const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
            if (d < best) {
              best = d;
              mob = e;
            }
          }
        }
        if (mob) {
          p.pos.x = mob.pos.x + dist;
          p.pos.z = mob.pos.z;
          sim.targetEntity(mob.id);
        }
        const st = g.abilityVfxStats()[id] ?? { claimed: 0, primitives: 0 };
        const attacks = g.abilityVfxAttackCount();
        g.sim.castAbility(id);
        return { st, attacks, glow0: g.abilityVfxGlow(playerId) };
      },
      abilityId,
      ids.playerId,
      standOff,
    );
    await new Promise((r) => setTimeout(r, settleMs));
    const after = await page.evaluate(
      (id, playerId) => {
        const g = window.__game;
        const st = g.abilityVfxStats()[id] ?? { claimed: 0, primitives: 0 };
        return {
          st,
          attacks: g.abilityVfxAttackCount(),
          glow: g.abilityVfxGlow(playerId),
          groundAuras: g.abilityVfxGroundAuras(playerId),
        };
      },
      abilityId,
      ids.playerId,
    );
    const primitives = after.st.primitives - before.st.primitives;
    const attacksDelta = after.attacks - before.attacks;
    const entry = {
      ability: abilityId,
      primitives,
      attacksDelta,
      glow: after.glow,
      groundAuras: after.groundAuras,
    };
    if (kind === 'bolt' || kind === 'bolt2') entry.ok = primitives >= 3;
    else if (kind === 'buff')
      // Long-silenced buffs (the long-buff policy) keep the cast ceremony +
      // gain swirl but must hold NO ground disc through the settle; the glow
      // clause stays on short buffs only, because a silenced buff's only glow
      // is the application pulse, decayed to zero by the settle read.
      entry.ok = LONG_SILENT_BUFFS.has(abilityId)
        ? primitives >= 2 && after.groundAuras === 0
        : primitives >= 2 && after.glow > 0.05;
    else if (kind === 'strike') entry.ok = primitives >= 2 && attacksDelta >= 1;
    else if (kind === 'extraSpin') entry.ok = attacksDelta >= 1;
    // the offline world is a live ecosystem (wildlife fights, cooldown/GCD
    // races): one retry absorbs a transient cast refusal; a real regression
    // still fails twice
    if (entry.ok === false && !retried) {
      retried = true;
      return castOne(kind, abilityId, settleMs, standOff);
    }
    out[kind] = entry;
  };
  // bolts stand off (hunter dead zone is ~8 yd); waits absorb the cast bar
  // plus travel plus the previous cast's GCD
  await castOne('bolt', plan.bolt, 3600, cls === 'hunter' ? 15 : 9);
  retried = false;
  await castOne('bolt2', plan.bolt2, 3600, 9);
  retried = false;
  await castOne('buff', plan.buff, 1900);
  retried = false;
  await castOne('strike', plan.strike, 1200);
  retried = false;
  await castOne('extraSpin', plan.extraSpin, 1900);
  await page.screenshot({ path: `${OUT_DIR}/real_${cls}.png` });
  return out;
}

const realCasts = [];
for (const [cls, plan] of Object.entries(REAL_CASTS)) {
  let out = await realCastClass(cls, plan);
  if (out.error) out = await realCastClass(cls, plan); // one retry on a flaky boot
  realCasts.push(out);
}
const realCastFails = [];
for (const rc of realCasts) {
  for (const [kind, entry] of Object.entries(rc)) {
    if (kind === 'cls') continue;
    if (entry && typeof entry === 'object' && entry.ok === false)
      realCastFails.push(
        `${rc.cls}.${kind}(${entry.ability}) prim=${entry.primitives} atk=${entry.attacksDelta} glow=${entry.glow.toFixed(2)}`,
      );
  }
  if (rc.error) realCastFails.push(`${rc.cls}: ${rc.error}`);
}

// Back into a fresh warrior session for the aura-band and auto-attack checks.
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
await enterOfflineGame(page, { charClass: 'warrior', settleMs: 2600 });
await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  let mob = null;
  let best = 1e9;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead && e.ownerId === null) {
      const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (d < best) {
        best = d;
        mob = e;
      }
    }
  }
  if (mob) {
    p.pos.x = mob.pos.x + 3;
    p.pos.z = mob.pos.z;
  }
});

// A REAL self-buff cast through the sim proves the aura-driven gain read (no
// synthesized event involved): battle_shout applies its 30 min aura,
// syncEntity sees it, and under the long-buff policy the one-shot gain swirl
// registers while NO held band or ground disc survives the settle.
const buffBand = await page.evaluate(() => {
  const g = window.__game;
  const before = g.abilityVfxStats().battle_shout ?? { claimed: 0, primitives: 0 };
  g.sim.castAbility('battle_shout');
  return { before };
});
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: `${OUT_DIR}/buff_band_battle_shout.png` });
const buffBandAfter = await page.evaluate(
  (playerId) => ({
    st: window.__game.abilityVfxStats().battle_shout ?? { claimed: 0, primitives: 0 },
    groundAuras: window.__game.abilityVfxGroundAuras(playerId),
  }),
  setup.playerId,
);
const buffBandDelta = buffBandAfter.st.primitives - buffBand.before.primitives;

// Melee auto-attack sequence: a plain swing and a ranged-correlated one. The
// painter adds the subtle slash ribbon; meleeSpark and the swing anim are the
// pre-existing generic path (verified by absence of pageerrors + screenshot).
const auto = await page.evaluate(
  (playerId, mobId) => {
    const g = window.__game;
    const send = (extra) =>
      g.renderer.handleEvent({
        type: 'damage',
        sourceId: playerId,
        targetId: mobId,
        amount: 14,
        crit: false,
        school: 'physical',
        ability: null,
        kind: 'hit',
        ...extra,
      });
    send({});
    send({ attackAnimationStarted: true });
    return { sent: 2 };
  },
  setup.playerId,
  setup.mobId,
);
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: `${OUT_DIR}/auto_attack.png` });

const claimed = Object.values(results).filter((r) => r.claimed);
const withPrimitives = claimed.filter((r) => r.primitives > 0);
const failed = Object.entries(results).filter(([, r]) => !r.claimed || r.primitives < r.minBar);
const report = {
  url: URL,
  when: new Date().toISOString(),
  specCount: specIds.length,
  claimedCount: claimed.length,
  withPrimitivesCount: withPrimitives.length,
  failed: failed.map(([id, r]) => ({ id, ...r })),
  autoAttack: { ...auto, pageerrorsDuring: pageerrors.length },
  buffBand: {
    ability: 'battle_shout',
    primitives: buffBandDelta,
    groundAuras: buffBandAfter.groundAuras,
    ok: buffBandDelta >= 1 && buffBandAfter.groundAuras === 0,
  },
  realCasts,
  realCastFails,
  screenshots: shot + 1,
  pageerrors,
  abilities: results,
};
fs.writeFileSync(`${OUT_DIR}/report.json`, JSON.stringify(report, null, 2));
console.log(
  `coverage: ${specIds.length - failed.length}/${specIds.length} at the archetype bar, ` +
    `${claimed.length} claimed, ${withPrimitives.length} with primitives, ` +
    `${failed.length} below bar, buffBand=${buffBandDelta}, ` +
    `realCastFails=${realCastFails.length}, ${pageerrors.length} pageerrors`,
);
if (realCastFails.length > 0) console.log('real-cast failures:', realCastFails.join(' | '));
if (failed.length > 0)
  console.log(
    'below bar:',
    failed.map(([id, r]) => `${id}(${r.archetype} ${r.primitives}/${r.minBar})`).join(', '),
  );
await browser.close();
process.exit(
  failed.length > 0 || buffBandDelta < 2 || realCastFails.length > 0 || pageerrors.length > 0
    ? 2
    : 0,
);
