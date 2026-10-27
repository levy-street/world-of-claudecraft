// The Guardian of the Breath (docs/design/raid/smith_heart.md section 7.2):
// the Storm Cornice's boss, one body and two halves, with Captain Thessaly
// fighting beside the raid.
//
//   The Wind (100 to 50)   the bellows breathes across the Cornice in turn
//                          (breath_gale.ts: blows, calms, the rim's wall and
//                          its gaps, the indrawn breath and Bellows Gust,
//                          heroic's loose gales); Thessaly's circles of calm
//                          anchor three at a time (breath_thessaly.ts);
//                          Storm Lance stays the trash kit's own line.
//   The storm breaks (50)  the wind drawn in, the guardian frozen and torn
//                          open into a body of lightning, a barrage of strikes
//                          (breath_storm.ts).
//   The Storm (50 to 0)    the Leaping Bolt, the Thunder's Cradle, Drawn
//                          Lightning, the swelling storm; heroic's short gusts.
//   One wipe               the fight ends when the guardian stops fighting:
//                          the wind still, every circle, anchor, mark, gale,
//                          strike and patch gone, the lifted set down, the
//                          stone body back. The gaps stay what they are.
//   Its fall               lights the Breath vein and the seal's quarter as
//                          before (seal.ts reads the guardian's death).
//
// Difficulty: the claim's, with a dev switch for a run while the raid has no
// heroic tier of its own; mythic is a prototype behind its own switch and,
// for now, heroic whole (breath_ids.ts BREATH_DIFFICULTY).
//
// Deterministic: every pick is hashed or ordered; the only rng draws are the
// damage rolls, in claim-player order. Every visible state rides existing
// entity fields (breath_ids.ts says which), so the online client mirrors the
// whole fight with no wire or IWorld change; the push is the shared kernel's
// (src/sim/wind_drift.ts), predicted on both hosts.

import { setDownBody } from '../../carried_body';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { clearThreat } from '../../threat';
import { DT, type Entity } from '../../types';
import { claimBoss, clearCastIf } from '../sunken_bastion/claim';
import {
  clearGales,
  clearWindAuras,
  landGust,
  landInhale,
  setWind,
  startGales,
  startInhale,
  startWindBars,
  stepVoid,
  stepWind,
  stillWind,
  thessalyOf,
  windObject,
} from './breath_gale';
import { breathHash } from './breath_geometry';
import {
  BLOW_BEARINGS,
  BREATH_AURAS,
  BREATH_CASTS,
  BREATH_DIFFICULTY,
  BREATH_GUARDIAN,
  type BreathDifficulty,
  BREATH_TUNING as T,
} from './breath_ids';
import {
  type BreathScope,
  corniceListeners,
  cornicePlayers,
  dropAura,
  dropBreathObject,
  holdPlanted,
  living,
} from './breath_scope';
import type { BreathFightState } from './breath_state';
import {
  clearStorm,
  landCradle,
  landDrawn,
  landFork,
  landStorm,
  startCradle,
  startDrawn,
  startFork,
  startStorm,
  startStormBars,
  stepStorm,
  stormDue,
} from './breath_storm';
import { clearAnchors, clearCalm, plantCalm, stepThessaly } from './breath_thessaly';
import { breathSay, THESSALY_PULL_DELAY } from './breath_voice';

// ---- the dev difficulty switch ------------------------------------------------------------

/** Claims a dev playtest switched to heroic or mythic (`/dev heart breath
 *  heroic|mythic`), keyed by the claim's identity and its exit so a recycled
 *  slot never inherits it; one tier at a time. Dev-gated by its one caller
 *  (sim/dev/smith_heart_dev.ts). */
const devTier = new WeakMap<InstanceSlot, { exitId: number; tier: 'heroic' | 'mythic' }>();

export function setBreathDevTier(inst: InstanceSlot, tier: 'heroic' | 'mythic', on: boolean): void {
  if (on && inst.exitId !== null) devTier.set(inst, { exitId: inst.exitId, tier });
  else if (devTier.get(inst)?.tier === tier) devTier.delete(inst);
}

/** The fight's difficulty in a claim. */
export function breathDifficulty(inst: InstanceSlot): BreathDifficulty {
  const dev = inst.exitId !== null ? devTier.get(inst) : undefined;
  const tier = dev && dev.exitId === inst.exitId ? dev.tier : null;
  if (tier === 'mythic') return 'mythic';
  if (inst.difficulty === 'heroic') return 'heroic';
  return tier === 'heroic' ? 'heroic' : 'normal';
}

// ---- the body and the state ---------------------------------------------------------------

/** The claim's guardian (dead or alive), or null. */
export function breathGuardian(ctx: SimContext, inst: InstanceSlot): Entity | null {
  return claimBoss(ctx, inst, BREATH_GUARDIAN);
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

function freshState(boss: Entity, difficulty: BreathDifficulty): BreathFightState {
  return {
    kind: 'breath',
    difficulty,
    finished: false,
    clock: 0,
    half: 'wind',
    start: breathHash(boss.id, 17) % BLOW_BEARINGS.length,
    wind: { phase: 'calm', remaining: T.firstGather, total: T.firstGather, bearing: 0, blows: 0 },
    bar: null,
    gap: 0,
    inhaleTimer: T.inhaleFirst,
    circleTimer: T.circleFirst,
    calm: null,
    pinned: {},
    overLip: [],
    anchors: [],
    vortex: null,
    gales: [],
    barrage: null,
    spots: [],
    forkTimer: T.forkFirst,
    cradleTimer: T.cradleFirst,
    drawnTimer: T.drawnFirst,
    swellTimer: T.swellEvery,
    swellPulses: 0,
    gustTimer: T.gustFirst,
    cradle: null,
    drawn: null,
    casts: 0,
    said: {},
  };
}

function scopeOf(
  ctx: SimContext,
  inst: InstanceSlot,
  st: BreathFightState,
  boss: Entity,
): BreathScope {
  return {
    ctx,
    inst,
    st,
    boss,
    players: cornicePlayers(ctx, inst),
    rules: BREATH_DIFFICULTY[st.difficulty],
  };
}

// ---- the bar ------------------------------------------------------------------------------

function landBar(s: BreathScope): void {
  const bar = s.st.bar;
  if (!bar) return;
  s.st.bar = null;
  s.st.gap = T.barGap;
  switch (bar.castId) {
    case BREATH_CASTS.inhale:
      // The exhale follows at once (its own bar).
      s.st.gap = 0;
      landInhale(s);
      return;
    case BREATH_CASTS.gust:
      landGust(s);
      return;
    case BREATH_CASTS.storm:
      landStorm(s);
      return;
    case BREATH_CASTS.fork:
      landFork(s, bar.targetId);
      return;
    case BREATH_CASTS.cradle:
      landCradle(s, bar.targetId);
      return;
    case BREATH_CASTS.drawn:
      landDrawn(s, bar.targetId);
      return;
  }
}

/** The bar in flight: planted, counting down, landing. A bar cut by
 *  anything (an evade) is simply dropped; none of them is kicked. */
function stepBar(s: BreathScope): void {
  s.st.gap = Math.max(0, s.st.gap - DT);
  const bar = s.st.bar;
  if (!bar) return;
  const b = s.boss;
  if (b.castingAbility !== bar.castId) {
    s.st.bar = null;
    s.st.gap = T.barGap;
    return;
  }
  holdPlanted(s);
  b.swingTimer = Math.max(b.swingTimer, 0.6);
  if (bar.targetId !== null) {
    const t = s.ctx.entities.get(bar.targetId);
    if (t && !t.dead) b.facing = Math.atan2(t.pos.x - b.pos.x, t.pos.z - b.pos.z);
  }
  b.castRemaining = Math.max(0, b.castRemaining - DT);
  if (b.castRemaining > 1e-9) return;
  b.castingAbility = null;
  b.castRemaining = 0;
  b.castTotal = 0;
  b.castTargetId = null;
  landBar(s);
}

// ---- the start, the reset, the end --------------------------------------------------------

/** Everything the fight put on the Cornice goes; the wind falls still. */
function clearFight(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: BreathFightState | null,
): void {
  if (st) {
    clearCalm(ctx, inst, st);
    clearGales(ctx, inst, st);
    clearStorm(ctx, inst, st);
    dropBreathObject(ctx, inst, st.vortex?.objectId ?? null);
    st.vortex = null;
    st.pinned = {};
  }
  clearWindAuras(ctx, inst, boss.id);
  clearAnchors(corniceListeners(ctx, inst), st);
  // A lifted body whose cradle went without its fight (a dev reset) is set
  // down where it hangs.
  for (const p of corniceListeners(ctx, inst)) {
    dropAura(p, BREATH_AURAS.cradled);
    if (p.carriedBy !== undefined && !ctx.entities.has(p.carriedBy))
      setDownBody(p, ctx.groundPos(p.pos.x, p.pos.z).y);
  }
  clearCastIf(
    boss,
    BREATH_CASTS.inhale,
    BREATH_CASTS.gust,
    BREATH_CASTS.storm,
    BREATH_CASTS.fork,
    BREATH_CASTS.cradle,
    BREATH_CASTS.drawn,
  );
  dropAura(boss, BREATH_AURAS.stormForm);
  dropAura(boss, BREATH_AURAS.swell);
  stillWind(ctx, inst);
}

/** The fight ended without the kill: the Cornice as it was. */
function resetBreath(ctx: SimContext, inst: InstanceSlot, boss: Entity): void {
  const st = boss.smithHeartBreath ?? null;
  clearFight(ctx, inst, boss, st);
  boss.smithHeartBreath = undefined;
}

/** The guardian has fallen: the end is resolved once. */
function finishBreath(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: BreathFightState,
): void {
  st.finished = true;
  const s = scopeOf(ctx, inst, st, boss);
  breathSay(s, boss, 'guardian', 'death');
  breathSay(s, thessalyOf(ctx, inst), 'thessaly', 'victory');
  clearFight(ctx, inst, boss, st);
}

/** The pull: one state for the fight, the wind about to stir. */
function beginBreath(ctx: SimContext, inst: InstanceSlot, boss: Entity): BreathFightState {
  const st = freshState(boss, breathDifficulty(inst));
  boss.smithHeartBreath = st;
  setWind({ ctx, inst, st }, 'calm', T.firstGather, 0);
  breathSay({ ctx, inst, st }, boss, 'guardian', 'pull');
  return st;
}

/** One tick of the claim's Guardian of the Breath. */
export function tickBreathGuardian(ctx: SimContext, inst: InstanceSlot): void {
  const boss = breathGuardian(ctx, inst);
  if (!boss) return;
  const st0 = boss.smithHeartBreath ?? null;
  if (!living(boss)) {
    if (st0 && !st0.finished) finishBreath(ctx, inst, boss, st0);
    return;
  }
  if (!fighting(boss)) {
    if (st0) {
      // The raid lies dead on the Cornice: both say so.
      if (!st0.finished && cornicePlayers(ctx, inst).length === 0) {
        const s = scopeOf(ctx, inst, st0, boss);
        breathSay(s, boss, 'guardian', 'wipe');
        breathSay(s, thessalyOf(ctx, inst), 'thessaly', 'wipe');
      }
      resetBreath(ctx, inst, boss);
    }
    return;
  }
  const st = st0 ?? beginBreath(ctx, inst, boss);
  const s = scopeOf(ctx, inst, st, boss);
  st.clock += DT;
  if (st.clock + 1e-9 >= THESSALY_PULL_DELAY)
    breathSay(s, thessalyOf(ctx, inst), 'thessaly', 'pull');
  stepBar(s);
  if (stormDue(s)) startStorm(s);
  stepWind(s);
  stepThessaly(s);
  stepStorm(s);
  stepVoid(s);
  startWindBars(s);
  startStormBars(s);
}

// ---- dev ----------------------------------------------------------------------------------

/** The fight's scope for a dev command or a test (starting the fight state
 *  if none runs yet), or null when the claim holds no guardian. */
export function breathScopeForDev(ctx: SimContext, inst: InstanceSlot): BreathScope | null {
  const boss = breathGuardian(ctx, inst);
  if (!boss || !living(boss)) return null;
  const st = boss.smithHeartBreath ?? beginBreath(ctx, inst, boss);
  return scopeOf(ctx, inst, st, boss);
}

/** Compass words a dev line may name a blow by. */
const COMPASS: Readonly<Record<string, number>> = {
  n: 0,
  ne: 45,
  e: 90,
  se: 135,
  s: 180,
  sw: 225,
  w: 270,
  nw: 315,
};

/** Clear the bar in flight (a dev trigger takes the guardian's attention). */
function cutBar(s: BreathScope): void {
  if (s.st.bar) {
    clearCastIf(s.boss, s.st.bar.castId);
    s.st.bar = null;
  }
  s.st.gap = 0;
}

/** `/dev heart breath <what>`: the reply line, or null for an unknown verb. */
export function breathDevTrigger(ctx: SimContext, inst: InstanceSlot, what: string): string | null {
  const [verb, arg] = what.trim().split(/\s+/);
  if (verb === 'reset') {
    const boss = breathGuardian(ctx, inst);
    if (!boss) return 'This run holds no Guardian of the Breath.';
    resetBreath(ctx, inst, boss);
    if (boss.dead)
      return 'The Guardian of the Breath has fallen in this run (/dev heart reset for a fresh one).';
    boss.hp = boss.maxHp;
    boss.aiState = 'idle';
    boss.inCombat = false;
    boss.aggroTargetId = null;
    clearThreat(boss);
    boss.pos = { ...boss.spawnPos, y: ctx.groundPos(boss.spawnPos.x, boss.spawnPos.z).y };
    boss.prevPos = { ...boss.pos };
    ctx.rebucket(boss);
    return 'The Guardian of the Breath stands whole again; the wind is still.';
  }
  if (verb === 'heroic' || verb === 'mythic') {
    const on = arg !== 'off';
    setBreathDevTier(inst, verb, on);
    const boss = breathGuardian(ctx, inst);
    const live = boss?.smithHeartBreath;
    if (live) live.difficulty = breathDifficulty(inst);
    return on
      ? `The Guardian of the Breath fights on ${verb} for this run.`
      : `The Guardian of the Breath fights on ${breathDifficulty(inst)}.`;
  }
  const s = breathScopeForDev(ctx, inst);
  if (!s) return 'This run holds no living Guardian of the Breath.';
  const st = s.st;
  if (verb === 'phase2' || verb === 'p2' || verb === 'storm') {
    if (st.half !== 'wind') return 'The storm has already broken.';
    s.boss.hp = Math.min(s.boss.hp, Math.floor(s.boss.maxHp * T.stormAt));
    cutBar(s);
    clearCastIf(s.boss, s.boss.castingAbility ?? '');
    s.boss.castingAbility = null;
    startStorm(s);
    return 'The storm breaks (the guardian at half health).';
  }
  // A forced blow or calm takes the wind from an indrawn breath in flight.
  if (
    (verb === 'blow' || verb === 'calm') &&
    (st.wind.phase === 'inhale' || st.wind.phase === 'exhale')
  ) {
    cutBar(s);
    dropBreathObject(ctx, inst, st.vortex?.objectId ?? null);
    st.vortex = null;
  }
  if (verb === 'blow' || verb === 'gust') {
    const n = arg === undefined ? Number.NaN : (COMPASS[arg] ?? Number(arg));
    const bearing = Number.isFinite(n) ? ((Math.round(n) % 360) + 360) % 360 : st.wind.bearing;
    if (verb === 'gust') {
      setWind(s, 'gustgather', T.gustGather, bearing);
      return `A storm gust gathers toward ${bearing} degrees.`;
    }
    if (st.half !== 'wind') return 'The wind half is over (the storm has broken).';
    setWind(s, 'blow', T.blowSeconds, bearing);
    return `The bellows blows toward ${bearing} degrees.`;
  }
  if (verb === 'calm') {
    if (st.half !== 'wind') return 'The wind half is over (the storm has broken).';
    clearWindAuras(ctx, inst, s.boss.id);
    setWind(s, 'calm', Math.max(0.5, T.calmMax - T.gatherSeconds), st.wind.bearing);
    return 'The wind falls calm.';
  }
  if (verb === 'circle') {
    if (st.half !== 'wind') return 'Captain Thessaly plants nothing once the storm has broken.';
    return plantCalm(s)
      ? 'Captain Thessaly plants a circle of calm.'
      : 'Captain Thessaly is not here.';
  }
  if (verb === 'inhale') {
    if (st.half !== 'wind') return 'The wind half is over (the storm has broken).';
    cutBar(s);
    s.boss.castingAbility = null;
    return startInhale(s, true)
      ? 'The Guardian draws breath.'
      : 'The Guardian cannot draw breath now.';
  }
  if (verb === 'tornado' || verb === 'gale') {
    startGales(s);
    return 'Loose gales tear across the Cornice.';
  }
  if (verb === 'chain' || verb === 'fork') {
    cutBar(s);
    s.boss.castingAbility = null;
    return startFork(s) ? 'Leaping Bolt.' : 'Nobody on the Cornice to strike.';
  }
  if (verb === 'eye' || verb === 'cradle') {
    cutBar(s);
    s.boss.castingAbility = null;
    return startCradle(s) ? "Thunder's Cradle." : 'Nobody to lift (or a cradle already holds one).';
  }
  if (verb === 'conductor' || verb === 'drawn') {
    cutBar(s);
    s.boss.castingAbility = null;
    return startDrawn(s) ? 'Drawn Lightning.' : 'Nobody to mark (or one is already marked).';
  }
  return null;
}

/** The readout for `/dev heart breath` (state at a glance). */
export function breathReadout(ctx: SimContext, inst: InstanceSlot): string {
  const boss = breathGuardian(ctx, inst);
  if (!boss) return '[dev] This run holds no Guardian of the Breath.';
  const head = `[dev] Guardian of the Breath (${breathDifficulty(inst)}): ${boss.dead ? 'dead' : `${Math.round((boss.hp / boss.maxHp) * 100)}%`}`;
  const st = boss.smithHeartBreath;
  const obj = windObject(ctx, inst);
  if (!st) return `${head}; not fighting (wind ${obj?.templateId ?? 'missing'}).`;
  return `${head}; ${st.half}, wind ${st.wind.phase} toward ${st.wind.bearing} (${st.wind.remaining.toFixed(1)} s), blows ${st.wind.blows}, inhale in ${Math.max(0, st.inhaleTimer).toFixed(0)} s, swell ${st.swellPulses}.`;
}
