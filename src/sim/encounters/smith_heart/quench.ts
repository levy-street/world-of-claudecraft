// The Guardian of the Quench (docs/design/raid/smith_heart.md section 7.3):
// the Frozen Lake's boss. "Together, but not for too long": warmth comes from
// huddling, and huddling breaks the ice.
//
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
//   The blades wake    at half health the Smith's four blades tear free and
//                      float upright round the lake (quench_blades.ts).
//   The Echoes (50-0)  every breath and strike is repeated by each blade 3 s
//                      later (2 s below a quarter), facing the way the
//                      guardian's did: behind a blade is always safe. The
//                      cold deepens every 20 s (the soft enrage).
//   Heroic             the blades cross the lake in pairs (their lane strikes
//                      and cracks into holes); a shatter splashes further
//                      and harder (contagious cold).
//   One wipe           the fight ends when the guardian stops fighting: every
//                      bar, frost, crack, hole, echo and lane gone, the held
//                      climbed out, the blades sunk home, the shore ice down.
//   Its fall           lights the Quench vein and the seal's quarter as
//                      before (seal.ts reads the guardian's death); the shore
//                      ice falls and the lake refreezes whole.
//
// Difficulty: the claim's, with a dev switch for a run while the raid has no
// heroic tier of its own; mythic is a prototype behind its own switch and,
// for now, heroic whole (quench_ids.ts QUENCH_DIFFICULTY).
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
import { landBreath, startBreath, watchStrike } from './quench_attacks';
import {
  bladesAtHome,
  claimBlades,
  clearBladeMarks,
  clearBlades,
  dropBarEchoes,
  ensureBladeWalls,
  landWake,
  spawnEchoes,
  startCrossing,
  startWake,
  stepBlades,
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
import { dropRim, raiseRim, stepRim } from './quench_rim';
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
import type { QuenchFightState } from './quench_state';
import { quenchSay } from './quench_voice';

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
    cleaveSeen: boss.swingCleaveCount ?? 0,
    rim: { ids: [], rising: 0 },
    chill: {},
    strain: [],
    cracks: [],
    holes: [],
    trapped: {},
    grace: {},
    blades: bladesAtHome(ctx, inst),
    echoes: [],
    deepenTimer: T.deepenEvery,
    deepenStacks: 0,
    danceTimer: T.danceFirst,
    dances: 0,
    lastPair: -1,
    dance: null,
    casts: 0,
    said: {},
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
    // Its echoes are past the bar now: nothing can take them back.
    for (const ec of s.st.echoes) delete ec.ofBar;
  } else if (bar.castId === QUENCH_CASTS.wake) landWake(s);
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
    // The awakening always completes (a cut bar never strands the blades);
    // a cut breath takes its echoes with it.
    if (bar.castId === QUENCH_CASTS.wake) landWake(s);
    else if (bar.castId === QUENCH_CASTS.breath) dropBarEchoes(s);
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
  if (wakeDue(s, free)) {
    startWake(s);
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
    clearIce({ ctx, inst, st });
    clearBlades(ctx, inst, st);
    dropRim(ctx, inst, st);
    st.chill = {};
  } else {
    // No fight state (a dev reset before any pull): the blades home anyway.
    clearBlades(ctx, inst, freshState(ctx, inst, boss, 'normal'));
  }
  for (const p of lakeListeners(ctx, inst)) {
    clearColdMarks(p);
    dropAura(p, QUENCH_AURAS.trapped);
  }
  clearCastIf(boss, QUENCH_CASTS.breath, QUENCH_CASTS.wake);
  clearBladeMarks(boss);
  dropAura(boss, QUENCH_AURAS.deepening);
}

/** The fight ended without the kill: the lake as it was. */
function resetQuench(ctx: SimContext, inst: InstanceSlot, boss: Entity): void {
  const st = boss.smithHeartQuench ?? null;
  clearFight(ctx, inst, boss, st);
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
  boss.smithHeartQuench = st;
  const s = scopeOf(ctx, inst, st, boss);
  raiseRim(s);
  quenchSay(s, boss, 'pull');
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
  watchStrike(s);
  stepCold(s);
  stepIce(s);
  stepBlades(s);
  stepDeepening(s);
  startBars(s);
}

// ---- dev ----------------------------------------------------------------------------------

/** The fight's scope for a dev command or a test (starting the fight state
 *  if none runs yet), or null when the claim holds no living guardian. */
export function quenchScopeForDev(ctx: SimContext, inst: InstanceSlot): QuenchScope | null {
  const boss = quenchGuardian(ctx, inst);
  if (!boss || !living(boss)) return null;
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
  if (s.st.half === 'echoes') return;
  cutBar(s);
  s.boss.castingAbility = null;
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
  if (verb === 'reset') {
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
  const s = quenchScopeForDev(ctx, inst);
  if (!s) return 'This run holds no living Guardian of the Quench.';
  const me = ctx.entities.get(pid);
  if (verb === 'phase2' || verb === 'p2') {
    if (s.st.half !== 'lake') return 'The blades are already awake.';
    s.boss.hp = Math.min(s.boss.hp, Math.floor(s.boss.maxHp * T.wakeAt));
    cutBar(s);
    s.boss.castingAbility = null;
    startWake(s);
    return 'The guardian raises its arms: the blades tear free (the guardian at half health).';
  }
  if (verb === 'blades' || verb === 'wake') {
    if (s.st.half === 'echoes') return 'The blades are already awake.';
    wakeNow(s);
    return 'The four blades stand awake round the lake.';
  }
  if (verb === 'breath') {
    cutBar(s);
    s.boss.castingAbility = null;
    startBreath(s);
    return 'Quenching Breath.';
  }
  if (verb === 'echo') {
    if (s.st.half !== 'echoes') wakeNow(s);
    if (arg === 'strike') {
      const n = spawnEchoes(s, 'strike', s.boss.facing, T.echoDelay);
      return `Tempering Strike echoes at ${n} blades in ${T.echoDelay} s.`;
    }
    cutBar(s);
    s.boss.castingAbility = null;
    startBreath(s);
    return 'Quenching Breath, and every blade echoes it.';
  }
  if (verb === 'dance' || verb === 'cross') {
    if (s.st.half !== 'echoes') wakeNow(s);
    s.st.dance = null;
    return startCrossing(s) ? 'Two blades cross the lake.' : 'The blades cannot cross now.';
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
    return 'You freeze solid: the ice shatters in 4 s.';
  }
  if (verb === 'hole') {
    openHole(s, here.x, here.z);
    return 'The ice gives way under you.';
  }
  if (verb === 'crack') {
    startCrack(s, here.x, here.z);
    return 'The ice groans under you.';
  }
  return null;
}

/** The readout for `/dev heart quench` (state at a glance). */
export function quenchReadout(ctx: SimContext, inst: InstanceSlot, pid: number): string {
  const boss = quenchGuardian(ctx, inst);
  if (!boss) return '[dev] This run holds no Guardian of the Quench.';
  const head = `[dev] Guardian of the Quench (${quenchDifficulty(inst)}): ${boss.dead ? 'dead' : `${Math.round((boss.hp / boss.maxHp) * 100)}%`}`;
  const st = boss.smithHeartQuench;
  if (!st)
    return `${head}; not fighting (${claimBlades(ctx, inst).filter(Boolean).length} blades).`;
  const mine = st.chill[pid];
  return `${head}; ${st.half}, your cold ${mine ? Math.round(mine.cold) : 0}, holes ${st.holes.length}, cracks ${st.cracks.length}, breath in ${Math.max(0, st.breathTimer).toFixed(0)} s, deepening ${st.deepenStacks}.`;
}
