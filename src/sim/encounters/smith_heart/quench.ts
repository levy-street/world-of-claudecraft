// The Guardian of the Quench (docs/design/raid/smith_heart.md section 7.3):
// the Frozen Lake's boss. "Together, but not for too long": warmth comes from
// huddling, and huddling breaks the ice.
//
//   The entrance       before all of it, the first time the raid steps onto
//                      the lake: she wakes under the ice, breaks out of it
//                      and calls her blades, held out of reach until her
//                      scene ends (quench_intro.ts).
//   The pull           the shore ice heaves up round the lake (quench_rim.ts):
//                      the whole fight is on the ice.
//   All fight          frostbite (quench_cold.ts): a cold bar on every
//                      player that rises alone and falls in a huddle; at full
//                      the player freezes solid, then shatters (a hit, cold
//                      splashed round, Frost-Brittle).
//   The Lake (100-50)  a huddle lingering on one spot cracks the ice and it
//                      opens into a hole of freezing water (quench_ice.ts):
//                      the holes stay, so the raid keeps moving its huddles.
//                      Quenching Breath and Tempering Strike stay
//                      (quench_attacks.ts).
//   The blades wake    two of the Smith's four blades tear free as the fight
//                      begins, the other two at half health (quench_blades.ts).
//   The slashes        every so often the awake blades mark players, in order,
//                      and fly at each down a line that follows them until it
//                      locks (quench_slash.ts): more marks with four blades
//                      awake, and on heroic.
//   Phase 2 (50-0)     all four blades awake; the cold deepens every 20 s (the
//                      soft enrage).
//   Living Rime        every 25 s a crust of living ice drinks the healing of
//                      1 (Heroic 2, Mythic 3) players (quench_rime.ts): heal
//                      it through in 10 s or its carrier freezes and the cold
//                      bursts round them (Heroic: it leaps on).
//   Living Warmth      healing a player receives lowers their cold
//                      (quench_life_warmth.ts; half on Heroic).
//   Heroic             a shatter splashes further and harder (contagious cold).
//   Mythic             one blade makes a whole round, each slash from where the
//                      last one ended; at a quarter health, The Blades Hunt
//                      (quench_flurry.ts).
//   One wipe           the fight ends when the guardian stops fighting: every
//                      bar, frost, crack, hole, mark and line gone, the held
//                      climbed out, the blades sunk home, the shore ice down.
//   Its fall           lights the Quench vein and the seal's quarter as
//                      before (seal.ts reads the guardian's death); the shore
//                      ice falls and the lake refreezes whole.
//
// Difficulty: the claim's, with a dev switch for a run while the raid has no
// heroic tier of its own; mythic is a prototype behind its own switch
// (quench_ids.ts QUENCH_DIFFICULTY).
//
// Deterministic: every pick is hashed or ordered; the only rng draws are the
// damage rolls, in claim-player order. Every visible state rides existing
// entity fields (quench_ids.ts says which), so the online client mirrors the
// whole fight with no wire or IWorld change.

import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { clearThreat } from '../../threat';
import { DT, type Entity } from '../../types';
import { claimBoss, clearCastIf } from '../sunken_bastion/claim';
import { settleSmithHeartFeat } from './feats';
import { landBreath, startBreath } from './quench_attacks';
import {
  bladesAtHome,
  claimBlades,
  clearBladeMarks,
  clearBlades,
  ensureBladeWalls,
  firstWakeDue,
  landWake,
  setBladeObject,
  startWake,
  wakeDue,
} from './quench_blades';
import {
  addCold,
  chillOf,
  clearColdMarks,
  freezePlayer,
  stepCold,
  stepDeepening,
} from './quench_cold';
import { quenchColdDev } from './quench_cold_dev';
import { clearFlurry, endFlurry, flurryDue, startFlurry, stepFlurry } from './quench_flurry';
import { clearIce, openHole, startCrack, stepIce } from './quench_ice';
import {
  QUENCH_AURAS,
  QUENCH_CASTS,
  QUENCH_CUES,
  QUENCH_DIFFICULTY,
  QUENCH_GUARDIAN,
  type QuenchDifficulty,
  QUENCH_TUNING as T,
} from './quench_ids';
import {
  quenchIntroJustSpoke,
  quenchIntroReadout,
  replayQuenchIntro,
  spendQuenchIntro,
  stepQuenchIntro,
} from './quench_intro';
import { stepLifeWarmth } from './quench_life_warmth';
import { dropRim, raiseRim, stepRim } from './quench_rim';
import { castRime, clearRime, clearRimeMarks, setRime, stepRime } from './quench_rime';
import {
  at,
  dropAura,
  guardianFree,
  holdPlanted,
  lakeListeners,
  lakePlayers,
  living,
  type QuenchScope,
} from './quench_scope';
import { clearSlashes, startSlashes, stepSlashes } from './quench_slash';
import type { QuenchFightState } from './quench_state';
import { watchStrikeWindup } from './quench_strike_windup';
import { quenchSay, watchQuenchSlain } from './quench_voice';
import { applyTierHealth, restoreTierHealth, tierPoolMult } from './tier_health';
import { freshSlainWatch } from './voice_slain';

// ---- the dev difficulty switch ------------------------------------------------------------

/** Claims a dev playtest switched to heroic or mythic (`/dev heart quench
 *  heroic|mythic`), keyed by the claim's identity and its exit so a recycled
 *  slot never inherits it; one tier at a time. Dev-gated by its one caller
 *  (sim/dev/smith_heart_dev.ts). */
const devTier = new WeakMap<InstanceSlot, { exitId: number; tier: 'heroic' | 'mythic' }>();

export function setQuenchDevTier(inst: InstanceSlot, tier: 'heroic' | 'mythic', on: boolean): void {
  if (on && inst.exitId !== null) devTier.set(inst, { exitId: inst.exitId, tier });
  else if (devTier.get(inst)?.tier === tier) devTier.delete(inst);
}

/** Claims a dev run switched Living Rime off in (`/dev heart quench rime
 *  off`: a bot raid's comparison run without it). Dev-gated by its caller. */
const devRimeOff = new WeakSet<InstanceSlot>();

/** The fight's difficulty in a claim. */
export function quenchDifficulty(inst: InstanceSlot): QuenchDifficulty {
  const dev = inst.exitId !== null ? devTier.get(inst) : undefined;
  const tier = dev && dev.exitId === inst.exitId ? dev.tier : null;
  if (tier === 'mythic') return 'mythic';
  if (inst.difficulty === 'heroic') return 'heroic';
  return tier === 'heroic' ? 'heroic' : 'normal';
}

// ---- the body and the state ---------------------------------------------------------------

/** The claim's guardian (dead or alive), or null. */
export function quenchGuardian(ctx: SimContext, inst: InstanceSlot): Entity | null {
  return claimBoss(ctx, inst, QUENCH_GUARDIAN);
}

/** In its fight: pulled, alive, not walking home. */
function fighting(e: Entity): boolean {
  return (
    living(e) &&
    e.inCombat &&
    e.aiState !== 'evade' &&
    (e.aiState === 'chase' || e.aiState === 'attack')
  );
}

function freshState(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  difficulty: QuenchDifficulty,
): QuenchFightState {
  return {
    kind: 'quench',
    difficulty,
    finished: false,
    clock: 0,
    half: 'lake',
    bar: null,
    gap: 0,
    breathTimer: T.breathFirst,
    rim: { ids: [], rising: 0 },
    chill: {},
    strain: [],
    cracks: [],
    holes: [],
    trapped: {},
    grace: {},
    blades: bladesAtHome(ctx, inst),
    deepenTimer: T.deepenEvery,
    deepenStacks: 0,
    slashTimer: T.slashFirst,
    slashes: 0,
    slash: null,
    flurry: null,
    flurryDone: false,
    rimeTimer: T.rimeFirst,
    rimeCasts: 0,
    ...(devRimeOff.has(inst) ? { rimeOff: true } : {}),
    rimes: [],
    rimeBreaks: 0,
    rimeBursts: 0,
    casts: 0,
    said: {},
    slain: freshSlainWatch(),
  };
}

function scopeOf(
  ctx: SimContext,
  inst: InstanceSlot,
  st: QuenchFightState,
  boss: Entity,
): QuenchScope {
  return {
    ctx,
    inst,
    st,
    boss,
    players: lakePlayers(ctx, inst),
    rules: QUENCH_DIFFICULTY[st.difficulty],
  };
}

// ---- the bar ------------------------------------------------------------------------------

function landBar(s: QuenchScope): void {
  const bar = s.st.bar;
  if (!bar) return;
  s.st.bar = null;
  s.st.gap = T.barGap;
  if (bar.castId === QUENCH_CASTS.breath) {
    landBreath(s, bar.facing);
  } else if (bar.castId === QUENCH_CASTS.wake) landWake(s);
  else if (bar.castId === QUENCH_CASTS.flurry) endFlurry(s);
}

/** The bar in flight: planted, counting down, landing. A bar cut by
 *  anything (an evade) is simply dropped; neither is kicked. */
function stepBar(s: QuenchScope): void {
  s.st.gap = Math.max(0, s.st.gap - DT);
  const bar = s.st.bar;
  if (!bar) return;
  const b = s.boss;
  if (b.castingAbility !== bar.castId) {
    s.st.bar = null;
    s.st.gap = T.barGap;
    // The awakening always completes (a cut bar never strands the blades).
    if (bar.castId === QUENCH_CASTS.wake) landWake(s);
    else if (bar.castId === QUENCH_CASTS.flurry) endFlurry(s);
    return;
  }
  holdPlanted(s);
  b.swingTimer = Math.max(b.swingTimer, 0.6);
  b.castRemaining = Math.max(0, b.castRemaining - DT);
  if (b.castRemaining > 1e-9) return;
  b.castingAbility = null;
  b.castRemaining = 0;
  b.castTotal = 0;
  b.castTargetId = null;
  landBar(s);
}

/** The guardian's next bar: the awakening when due, else the breath. */
function startBars(s: QuenchScope): void {
  s.st.breathTimer -= DT;
  const free = guardianFree(s);
  if (s.st.clock >= T.rimRise && firstWakeDue(s, free)) {
    startWake(s);
    return;
  }
  if (wakeDue(s, free)) {
    startWake(s);
    return;
  }
  if (flurryDue(s, free)) {
    startFlurry(s);
    return;
  }
  if (!free || s.st.half === 'wake') return;
  if (s.st.breathTimer <= 0) startBreath(s);
}

// ---- the start, the reset, the end --------------------------------------------------------

/** Everything the fight put on the lake goes. */
function clearFight(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: QuenchFightState | null,
): void {
  if (st) {
    // Everyone the fight marked, wherever they went (a player who left the
    // lake as it ended keeps no cold, warmth or trap in the open world).
    for (const key of [...Object.keys(st.chill), ...Object.keys(st.trapped)]) {
      const p = ctx.entities.get(Number(key));
      if (!p) continue;
      clearColdMarks(p);
      dropAura(p, QUENCH_AURAS.trapped);
    }
    clearRime({ ctx, st });
    clearIce({ ctx, inst, st });
    clearSlashes({ ctx, inst }, st);
    clearFlurry({ ctx, inst }, st);
    clearBlades(ctx, inst, st);
    dropRim(ctx, inst, st);
    st.chill = {};
  } else {
    // No fight state (a dev reset before any pull): the blades home anyway.
    clearBlades(ctx, inst, freshState(ctx, inst, boss, 'normal'));
  }
  for (const p of lakeListeners(ctx, inst)) {
    clearColdMarks(p);
    clearRimeMarks(p);
    dropAura(p, QUENCH_AURAS.trapped);
  }
  clearCastIf(boss, QUENCH_CASTS.breath, QUENCH_CASTS.wake, QUENCH_CASTS.flurry);
  boss.damageImmune = false;
  clearBladeMarks(boss);
  dropAura(boss, QUENCH_AURAS.deepening);
}

/** The fight ended without the kill: the lake as it was. */
function resetQuench(ctx: SimContext, inst: InstanceSlot, boss: Entity): void {
  const st = boss.smithHeartQuench ?? null;
  clearFight(ctx, inst, boss, st);
  restoreTierHealth(boss, st?.basePool);
  boss.smithHeartQuench = undefined;
}

/** The guardian has fallen: the end is resolved once. */
function finishQuench(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: QuenchFightState,
): void {
  st.finished = true;
  settleSmithHeartFeat(ctx, inst, { encounter: 'quench', st });
  const s = scopeOf(ctx, inst, st, boss);
  quenchSay(s, boss, 'death');
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'frost',
    fx: 'nova',
    ability: QUENCH_CUES.thaw,
  });
  clearFight(ctx, inst, boss, st);
}

/** The pull: one state for the fight, the shore ice rising. */
function beginQuench(ctx: SimContext, inst: InstanceSlot, boss: Entity): QuenchFightState {
  const st = freshState(ctx, inst, boss, quenchDifficulty(inst));
  st.basePool = applyTierHealth(
    boss,
    tierPoolMult(inst, QUENCH_DIFFICULTY[st.difficulty].healthMult),
  );
  boss.smithHeartQuench = st;
  const s = scopeOf(ctx, inst, st, boss);
  raiseRim(s);
  // Straight after her entrance the line would follow the entrance's own.
  if (!quenchIntroJustSpoke(ctx, boss)) quenchSay(s, boss, 'pull');
  return st;
}

/** The claim's object count when its blades' walls were last ensured. */
const bladeWallsSeen = new WeakMap<InstanceSlot, number>();

/** One tick of the claim's Guardian of the Quench. */
export function tickQuenchGuardian(ctx: SimContext, inst: InstanceSlot): void {
  const boss = quenchGuardian(ctx, inst);
  if (!boss) return;
  // The blades the claim spawned with stand as walls from its first tick
  // (looked at again only when the claim's object list changes).
  if (bladeWallsSeen.get(inst) !== inst.objectIds.length) {
    bladeWallsSeen.set(inst, inst.objectIds.length);
    ensureBladeWalls(ctx, inst);
  }
  const st0 = boss.smithHeartQuench ?? null;
  if (!living(boss)) {
    if (st0 && !st0.finished) finishQuench(ctx, inst, boss, st0);
    return;
  }
  // Her entrance holds her out of reach until the scene ends.
  if (stepQuenchIntro(ctx, inst, boss, fighting(boss))) return;
  if (!fighting(boss)) {
    if (st0) {
      if (!st0.finished && lakePlayers(ctx, inst).length === 0)
        quenchSay(scopeOf(ctx, inst, st0, boss), boss, 'wipe');
      resetQuench(ctx, inst, boss);
    }
    return;
  }
  const st = st0 ?? beginQuench(ctx, inst, boss);
  const s = scopeOf(ctx, inst, st, boss);
  st.clock += DT;
  stepRim(s);
  stepBar(s);
  stepLifeWarmth(s);
  stepCold(s);
  stepRime(s);
  stepIce(s);
  stepSlashes(s);
  stepFlurry(s);
  stepDeepening(s);
  watchQuenchSlain(s);
  startBars(s);
  watchStrikeWindup(s);
}

// ---- dev ----------------------------------------------------------------------------------

/** The fight's scope for a dev command or a test (starting the fight state
 *  if none runs yet), or null when the claim holds no living guardian. */
export function quenchScopeForDev(ctx: SimContext, inst: InstanceSlot): QuenchScope | null {
  const boss = quenchGuardian(ctx, inst);
  if (!boss || !living(boss)) return null;
  // A mechanic forced from the dev line starts the fight: no entrance left.
  spendQuenchIntro(ctx, boss);
  const st = boss.smithHeartQuench ?? beginQuench(ctx, inst, boss);
  return scopeOf(ctx, inst, st, boss);
}

/** Clear the bar in flight (a dev trigger takes the guardian's attention). */
function cutBar(s: QuenchScope): void {
  if (s.st.bar) {
    clearCastIf(s.boss, s.st.bar.castId);
    s.st.bar = null;
  }
  s.st.gap = 0;
}

/** Wake the blades at once (no bar), for a dev trigger that needs them. */
function wakeNow(s: QuenchScope): void {
  if (s.st.half === 'awake') return;
  cutBar(s);
  s.boss.castingAbility = null;
  s.st.half = 'wake';
  for (const b of s.st.blades) {
    const e = s.ctx.entities.get(b.objectId);
    if (e && !b.awake) setBladeObject(e, 'wake');
  }
  landWake(s);
}

/** `/dev heart quench <what>` for player `pid`: the reply line, or null for
 *  an unknown verb. */
export function quenchDevTrigger(
  ctx: SimContext,
  inst: InstanceSlot,
  what: string,
  pid: number,
): string | null {
  const [verb, arg] = what.trim().split(/\s+/);
  if (verb === 'reset' || verb === 'intro') {
    const boss = quenchGuardian(ctx, inst);
    if (!boss) return 'This run holds no Guardian of the Quench.';
    resetQuench(ctx, inst, boss);
    if (boss.dead)
      return 'The Guardian of the Quench has fallen in this run (/dev heart reset for a fresh one).';
    boss.hp = boss.maxHp;
    boss.aiState = 'idle';
    boss.inCombat = false;
    boss.aggroTargetId = null;
    clearThreat(boss);
    boss.pos = { ...boss.spawnPos, y: ctx.groundPos(boss.spawnPos.x, boss.spawnPos.z).y };
    boss.prevPos = { ...boss.pos };
    ctx.rebucket(boss);
    if (verb === 'intro') {
      replayQuenchIntro(boss);
      return 'The Guardian of the Quench sinks under the ice; she wakes again as the raid steps onto the lake.';
    }
    return 'The Guardian of the Quench stands whole again; the lake is whole.';
  }
  if (verb === 'heroic' || verb === 'mythic') {
    const on = arg !== 'off';
    setQuenchDevTier(inst, verb, on);
    const live = quenchGuardian(ctx, inst)?.smithHeartQuench;
    if (live) live.difficulty = quenchDifficulty(inst);
    return on
      ? `The Guardian of the Quench fights on ${verb} for this run.`
      : `The Guardian of the Quench fights on ${quenchDifficulty(inst)}.`;
  }
  if (verb === 'rime' && (arg === 'off' || arg === 'on')) {
    if (arg === 'off') devRimeOff.add(inst);
    else devRimeOff.delete(inst);
    const live = quenchGuardian(ctx, inst)?.smithHeartQuench;
    if (live) live.rimeOff = arg === 'off' ? true : undefined;
    return `Living Rime is ${arg} for this run.`;
  }
  const s = quenchScopeForDev(ctx, inst);
  if (!s) return 'This run holds no living Guardian of the Quench.';
  const me = ctx.entities.get(pid);
  if (verb === 'phase2' || verb === 'p2') {
    if (s.st.half !== 'lake') return 'The blades are already awake.';
    s.boss.hp = Math.min(s.boss.hp, Math.floor(s.boss.maxHp * T.wakeAt));
    cutBar(s);
    s.boss.castingAbility = null;
    // The first two up now if the fight has not raised them; the bar is the others'.
    if (!s.st.blades.some((b) => b.awake)) {
      startWake(s);
      cutBar(s);
      s.boss.castingAbility = null;
      landWake(s);
    }
    startWake(s);
    return 'The guardian raises its arms: the other blades tear free (the guardian at half health).';
  }
  if (verb === 'blades' || verb === 'wake') {
    if (s.st.half === 'awake') return 'The blades are already awake.';
    wakeNow(s);
    return 'All four blades stand awake round the lake.';
  }
  if (verb === 'breath') {
    cutBar(s);
    s.boss.castingAbility = null;
    startBreath(s);
    return 'Quenching Breath.';
  }
  if (verb === 'flurry' || verb === 'hunt') {
    if (s.st.half !== 'awake') wakeNow(s);
    cutBar(s);
    s.boss.castingAbility = null;
    return startFlurry(s) ? 'The Blades Hunt.' : 'It is under way, or a blade is in flight.';
  }
  if (verb === 'rime') {
    // `rime`: Living Rime on you; `rime cast`: her own cast, her own picks.
    if (arg === 'cast') {
      const took = castRime(s);
      return took.length > 0
        ? `Living Rime takes ${took.map((p) => p.name).join(', ')}.`
        : 'Nobody she may take stands on the lake.';
    }
    if (!me || me.dead) return 'You are not standing on the lake.';
    return setRime(s, me, s.boss)
      ? `Living Rime closes on you: heal through ${s.rules.rimeAbsorb} in ${T.rimeSeconds} s.`
      : 'It does not take (an immunity holds it off).';
  }
  if (verb === 'slash') {
    if (!s.st.blades.some((b) => b.awake)) wakeNow(s);
    return startSlashes(s) ? 'The blades mark their targets.' : 'A round is under way already.';
  }
  if (!me || me.dead) return 'You are not standing on the lake.';
  const here = at(s, me);
  if (verb === 'cold') {
    const n = Number(arg);
    if (!Number.isFinite(n)) return null;
    const c = chillOf(s, me.id);
    if (c.frozen > 0) return 'You are frozen solid.';
    c.cold = Math.max(0, Math.min(T.coldMax - 0.01, n));
    addCold(s, me, 0);
    return `Your cold is ${Math.round(c.cold)}.`;
  }
  if (verb === 'burst' || verb === 'freeze') {
    freezePlayer(s, me);
    return `You freeze solid: the ice shatters in ${T.freezeSeconds} s.`;
  }
  if (verb === 'hole') {
    openHole(s, here.x, here.z);
    return 'The ice gives way under you.';
  }
  if (verb === 'crack') {
    startCrack(s, here.x, here.z);
    return 'The ice groans under you.';
  }
  return quenchColdDev(s, me, verb, arg);
}

/** The readout for `/dev heart quench` (state at a glance). */
export function quenchReadout(ctx: SimContext, inst: InstanceSlot, pid: number): string {
  const boss = quenchGuardian(ctx, inst);
  if (!boss) return '[dev] This run holds no Guardian of the Quench.';
  const head = `[dev] Guardian of the Quench (${quenchDifficulty(inst)}): ${boss.dead ? 'dead' : `${Math.round((boss.hp / boss.maxHp) * 100)}%`}`;
  const st = boss.smithHeartQuench;
  if (!st)
    return `${head}; not fighting (${claimBlades(ctx, inst).filter(Boolean).length} blades; ${quenchIntroReadout(boss)}).`;
  const mine = st.chill[pid];
  return `${head}; ${st.half}, your cold ${mine ? Math.round(mine.cold) : 0}, holes ${st.holes.length}, cracks ${st.cracks.length}, breath in ${Math.max(0, st.breathTimer).toFixed(0)} s, deepening ${st.deepenStacks}, rime in ${Math.max(0, st.rimeTimer).toFixed(0)} s (on ${st.rimes.length}, healed ${st.rimeBreaks}, burst ${st.rimeBursts}).`;
}
