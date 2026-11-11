// The Guardian of the Heat (docs/design/raid/smith_heart.md section 7.4): the
// Hearth's boss, a being of the first flame in crystal and basalt, "the well
// of the first flame". A giant sunk to its waist in the wellspring at the
// back of the Hearth, it never moves on any difficulty; the raid fights on
// the shore in front of it.
//
//   Phase 1 (100-70)   Basalt Fist and its Molten Swells (heat_fist.ts),
//                      Hearth Flare on everyone out of its reach
//                      (heat_flare.ts), Cinder Grip on the tank (the
//                      template's own stacking burn).
//   The overflows      at 70 and at 40 percent it sinks into the wellspring
//                      and the Hearth overflows: rivers of fire and Falling
//                      Cinders (heat_overflow.ts); heroic's Wellspawn walk to
//                      the wellspring, and at 40 its Wellkeepers mark players
//                      who trail fire (heat_wellspawn.ts). Then it rises.
//   Phase 2 (70-40)    Hearthseeds (heat_seeds.ts; heroic hatches
//                      Seedflames), Wakefire (heat_zones.ts), the fist.
//   Phase 3 (40-0)     the Rolling Cinders (heat_cinders.ts), Wakefire, the
//                      fist.
//   The entrance       before all of it, the first time the raid comes near:
//                      it wakes from cold coal, burns up and speaks, held out
//                      of reach until its scene ends (heat_intro.ts).
//   One wipe           the fight ends when the guardian stops fighting:
//                      every bar, footprint, add and mark gone, the
//                      wellspring calm.
//   Its fall           lights the Heat vein and the seal's quarter as before
//                      (seal.ts reads the guardian's death).
//
// Difficulty: the claim's, with a dev switch for a run while the raid has no
// heroic tier of its own. Heroic and mythic end with phase 3 like normal;
// their pressure is the overflows' adds, the Seedflames, faster cinders and a
// quarter more damage. Mythic is a prototype behind its own switch and, for
// heroic whole plus the Wheel of the Hearth (heat_ids.ts HEAT_DIFFICULTY, heat_wheel.ts).
//
// Deterministic: every pick is hashed or ordered; the only rng draws are the
// damage rolls, in claim-player order. Every visible state rides existing
// entity fields (heat_ids.ts says which), so the online client mirrors the
// whole fight with no wire or IWorld change.

import { HEARTH_WELL } from '../../content/smith_heart_layout';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { clearThreat } from '../../threat';
import { DT, type Entity } from '../../types';
import { claimBoss, clearCastIf } from '../sunken_bastion/claim';
import { settleSmithHeartFeat } from './feats';
import { callCinder, clearCinders, dropStrayHunted, stepCinders, syncHunted } from './heat_cinders';
import { clearFist, landFist, startFist, stepSwells, wakefireHoldsFist } from './heat_fist';
import { flare, stepFlare, stepWellFire } from './heat_flare';
import {
  HEAT_AURAS,
  HEAT_CASTS,
  HEAT_CUES,
  HEAT_DIFFICULTY,
  HEAT_GUARDIAN,
  HEAT_MOBS,
  HEAT_NAMES,
  HEAT_OBJECTS,
  HEAT_PHASE_KIT,
  HEAT_STAGES,
  type HeatDifficulty,
  type HeatPhase,
  type HeatStage,
  type HeatWellState,
  phaseFloor,
  HEAT_TUNING as T,
  wellTemplate,
} from './heat_ids';
import {
  heatIntroJustSpoke,
  heatIntroReadout,
  replayHeatIntro,
  spendHeatIntro,
  stepHeatIntro,
} from './heat_intro';
import { clearRivers, freshOverflow, stepFlood } from './heat_overflow';
import {
  auraOf,
  cueOnBoss,
  dropAura,
  dropHeatMob,
  guardianFree,
  type HeatScope,
  hearthListeners,
  hearthPlayers,
  holdPlanted,
  living,
  putMarker,
} from './heat_scope';
import { clearSeeds, dropSeeds, stepSeeds } from './heat_seeds';
import type { HeatFightState } from './heat_state';
import { heatSay, watchHeatSlain } from './heat_voice';
import {
  clearOverflowAdds,
  endOverflowAdds,
  overflowAddsGone,
  raiseKeepers,
  raiseWellspawn,
  stepKeepers,
  stepMarks,
  stepTrails,
  stepWellspawn,
} from './heat_wellspawn';
import { startWheel, stepWheel } from './heat_wheel';
import { clearZones, startZones, stepZones } from './heat_zones';
import { applyTierHealth, restoreTierHealth, tierPoolMult } from './tier_health';
import { freshSlainWatch } from './voice_slain';

// ---- the dev difficulty switch ------------------------------------------------------------

/** Claims a dev playtest switched to heroic or mythic (`/dev heart heat
 *  heroic|mythic`), keyed by the claim's identity and its exit so a recycled
 *  slot never inherits it; one tier at a time. Dev-gated by its one caller
 *  (sim/dev/smith_heart_dev.ts). */
const devTier = new WeakMap<InstanceSlot, { exitId: number; tier: 'heroic' | 'mythic' }>();

export function setHeatDevTier(inst: InstanceSlot, tier: 'heroic' | 'mythic', on: boolean): void {
  if (on && inst.exitId !== null) devTier.set(inst, { exitId: inst.exitId, tier });
  else if (devTier.get(inst)?.tier === tier) devTier.delete(inst);
}

/** The fight's difficulty in a claim. */
export function heatDifficulty(inst: InstanceSlot): HeatDifficulty {
  const dev = inst.exitId !== null ? devTier.get(inst) : undefined;
  const tier = dev && dev.exitId === inst.exitId ? dev.tier : null;
  if (tier === 'mythic') return 'mythic';
  if (inst.difficulty === 'heroic') return 'heroic';
  return tier === 'heroic' ? 'heroic' : 'normal';
}

// ---- the body and the state ---------------------------------------------------------------

/** The claim's guardian (dead or alive), or null. */
export function heatGuardian(ctx: SimContext, inst: InstanceSlot): Entity | null {
  return claimBoss(ctx, inst, HEAT_GUARDIAN);
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

function freshState(difficulty: HeatDifficulty): HeatFightState {
  return {
    kind: 'heat',
    difficulty,
    finished: false,
    clock: 0,
    phase: 1,
    stage: 'fight',
    stageLeft: 0,
    overflow: null,
    overflows: 0,
    bar: null,
    gap: 0,
    fistTimer: T.fistFirst,
    fistHeld: 0,
    fists: 0,
    fist: null,
    swells: [],
    flareTimer: T.flareEvery,
    wellTick: T.wellTick,
    seedTimer: T.seedFirst,
    seedWaves: 0,
    seeds: [],
    zoneTimer: T.zoneFirst,
    wheelTimer: T.wheelFirst,
    wheelRuns: 0,
    wheelSafes: [],
    wheelNext: 0,
    wheelRounds: [],
    zoneRun: null,
    zones: [],
    cinderTimer: T.cinderFirst,
    cindersCalled: 0,
    falls: [],
    scorches: [],
    cinders: [],
    spawn: [],
    keepers: [],
    marks: [],
    trails: [],
    sprouts: [],
    feeds: 0,
    casts: 0,
    said: {},
    slain: freshSlainWatch(),
  };
}

function scopeOf(ctx: SimContext, inst: InstanceSlot, st: HeatFightState, boss: Entity): HeatScope {
  return {
    ctx,
    inst,
    st,
    boss,
    players: hearthPlayers(ctx, inst),
    rules: HEAT_DIFFICULTY[st.difficulty],
  };
}

// ---- the wellspring and the guardian's stance ---------------------------------------------

/** The claim's wellspring object, or null. */
export function heatWell(ctx: SimContext, inst: InstanceSlot): Entity | null {
  for (const id of inst.objectIds) {
    const e = ctx.entities.get(id);
    if (e?.templateId.startsWith(HEAT_OBJECTS.wellPrefix)) return e;
  }
  return null;
}

function setWell(ctx: SimContext, inst: InstanceSlot, state: HeatWellState): void {
  const w = heatWell(ctx, inst);
  if (w && w.templateId !== wellTemplate(state)) w.templateId = wellTemplate(state);
}

/** The stage's length (the state aura's clock), 0 for an untimed one. */
function stageLength(stage: HeatStage): number {
  if (stage === 'sinking') return T.sinkSeconds;
  if (stage === 'rising') return T.riseSeconds;
  return 0;
}

/** Write the phase and stage onto the guardian's state aura (only when they
 *  change: what every client reads). */
function showState(s: HeatScope): void {
  const b = s.boss;
  const st = s.st;
  const code = HEAT_STAGES[st.stage];
  const a = auraOf(b, HEAT_AURAS.state);
  if (a && a.value === st.phase && a.value2 === code) return;
  const len = stageLength(st.stage);
  putMarker(b, HEAT_AURAS.state, HEAT_NAMES.state, len > 0 ? len : 3600, b.id, {
    permanent: len <= 0,
    value: st.phase,
    value2: code,
    school: 'fire',
  });
}

/** Out of reach while it sinks, stays under or rises: nobody's target,
 *  nothing harms it, no swing. The mob AI re-hostiles it before the
 *  encounter's pass, so this runs every tick. */
function holdStance(s: HeatScope): void {
  const b = s.boss;
  const away = s.st.stage !== 'fight';
  if (away) {
    b.hostile = false;
    b.damageImmune = true;
    b.swingTimer = Math.max(b.swingTimer, 0.6);
  } else if (b.damageImmune) {
    b.hostile = true;
    b.damageImmune = false;
  }
  // Sunk in the wellspring: it never steps out.
  {
    const o = s.ctx.instanceOriginOf(s.inst);
    const wx = o.x + HEARTH_WELL.x;
    const wz = o.z + HEARTH_WELL.z;
    if (b.pos.x !== wx || b.pos.z !== wz) {
      const g = s.ctx.groundPos(wx, wz);
      b.pos.x = g.x;
      b.pos.y = g.y;
      b.pos.z = g.z;
      s.ctx.rebucket(b);
    }
  }
  // The next threshold holds (an overflow is never skipped by a burst).
  const floor = s.st.stage === 'fight' ? phaseFloor(s.st.phase) : null;
  const want = floor === null ? undefined : Math.ceil(b.maxHp * floor);
  if (b.damageFloorHp !== want) b.damageFloorHp = want;
}

// ---- the overflows ---------------------------------------------------

/** The guardian sinks and the Hearth overflows (`n` 1 at 70 percent, 2 at
 *  40). Exported for the dev trigger. */
export function beginOverflow(s: HeatScope, n: 1 | 2): void {
  const st = s.st;
  clearFist(s);
  clearZones(s);
  st.bar = null;
  st.stage = 'sinking';
  st.stageLeft = T.sinkSeconds;
  st.overflow = freshOverflow(n);
  st.overflows++;
  setWell(s.ctx, s.inst, 'over');
  cueOnBoss(s, HEAT_CUES.sink);
  heatSay(s, s.boss, n === 1 ? 'sink' : 'sinkAgain');
}

/** The phase after an overflow begins: its clocks fresh. */
function enterPhase(s: HeatScope, phase: HeatPhase): void {
  const st = s.st;
  st.phase = phase;
  st.stage = 'fight';
  st.stageLeft = 0;
  st.overflow = null;
  st.fistTimer = Math.min(st.fistTimer, 6);
  st.seedTimer = T.seedFirst;
  st.zoneTimer = T.zoneFirst;
  st.wheelTimer = T.wheelFirst;
  st.cinderTimer = T.cinderFirst;
}

/** One tick of the overflow's stages. */
function stepOverflow(s: HeatScope): void {
  const st = s.st;
  const o = st.overflow;
  if (!o) return;
  if (st.stage === 'sinking') {
    st.stageLeft -= DT;
    if (st.stageLeft > 1e-9) return;
    st.stage = 'under';
    st.stageLeft = 0;
    if (s.rules.overflowAdds) {
      raiseWellspawn(s);
      if (o.n === 2) raiseKeepers(s);
    }
    return;
  }
  if (st.stage === 'under') {
    stepFlood(s, o);
    const done = s.rules.overflowAdds
      ? (o.clock >= T.overflowMin - 1e-9 && overflowAddsGone(s)) || o.clock >= T.overflowMax - 1e-9
      : o.clock >= T.overflowSeconds - 1e-9;
    if (!done) return;
    endOverflowAdds(s);
    clearRivers(s, o);
    st.stage = 'rising';
    st.stageLeft = T.riseSeconds;
    cueOnBoss(s, HEAT_CUES.rise);
    heatSay(s, s.boss, 'rise');
    return;
  }
  if (st.stage === 'rising') {
    st.stageLeft -= DT;
    if (st.stageLeft > 1e-9) return;
    setWell(s.ctx, s.inst, 'calm');
    enterPhase(s, o.n === 1 ? 2 : 3);
  }
}

// ---- the bar ------------------------------------------------------------------------------

function landBar(s: HeatScope, castId: string): void {
  s.st.bar = null;
  s.st.gap = T.barGap;
  if (castId === HEAT_CASTS.fist) landFist(s);
}

/** The bar in flight: planted, counting down, landing. A bar cut by anything
 *  still lands (the fist's spot never strands). */
function stepBar(s: HeatScope): void {
  s.st.gap = Math.max(0, s.st.gap - DT);
  const bar = s.st.bar;
  if (!bar) return;
  const b = s.boss;
  if (b.castingAbility !== bar.castId) {
    landBar(s, bar.castId);
    return;
  }
  holdPlanted(s);
  b.swingTimer = Math.max(b.swingTimer, 0.6);
  b.castRemaining = Math.max(0, b.castRemaining - DT);
  if (b.castRemaining > 1e-9) return;
  clearCastIf(b, bar.castId);
  landBar(s, bar.castId);
}

/** The thresholds: each overflow, once. */
function watchThresholds(s: HeatScope): void {
  const st = s.st;
  if (st.stage !== 'fight' || st.bar) return;
  const floor = phaseFloor(st.phase);
  if (floor === null) return;
  if (s.boss.hp > Math.ceil(s.boss.maxHp * floor)) return;
  if (st.phase === 1) beginOverflow(s, 1);
  else if (st.phase === 2) beginOverflow(s, 2);
}

/** The phase's mechanics, each on its clock. */
function startMechanics(s: HeatScope): void {
  const st = s.st;
  const kit = HEAT_PHASE_KIT[st.phase];
  const live = st.stage === 'fight';
  stepFlare(s, !live ? 'none' : kit.flare ? 'all' : 'target');
  if (!live) return;
  if (kit.seeds) {
    st.seedTimer -= DT;
    if (st.seedTimer <= 1e-9) dropSeeds(s);
  }
  if (kit.zones) {
    st.zoneTimer -= DT;
    if (st.zoneTimer <= 1e-9) startZones(s);
    if (s.rules.wheel) {
      st.wheelTimer -= DT;
      if (st.wheelTimer <= 1e-9) startWheel(s);
    }
  }
  if (kit.cinders) {
    st.cinderTimer -= DT;
    if (st.cinderTimer <= 1e-9) callCinder(s);
  }
  if (kit.fist) {
    st.fistTimer -= DT;
    // Due, it waits out Wakefire (heat_fist.ts wakefireHoldsFist), and
    // the wait comes off the next one's.
    if (st.fistTimer <= 1e-9 && guardianFree(s)) {
      if (wakefireHoldsFist(st, kit.zones)) st.fistHeld += DT;
      else startFist(s);
    }
  }
}

// ---- the start, the reset, the end --------------------------------------------------------

const HEAT_ADD_IDS: ReadonlySet<string> = new Set(Object.values(HEAT_MOBS));

/** The player auras the fight puts on (cleared at its end). */
const PLAYER_MARKS = [
  HEAT_AURAS.scorched,
  HEAT_AURAS.kindling,
  HEAT_AURAS.trail,
  HEAT_AURAS.hunted,
] as const;

/** Everything the fight put on the floor goes. */
function clearFight(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: HeatFightState | null,
): void {
  if (st) {
    const s = { ctx, inst, st, boss };
    clearFist(s);
    clearZones(s);
    clearSeeds(s);
    clearCinders(s);
    clearOverflowAdds(s);
    clearRivers(s, st.overflow);
  }
  // Every add the fight raised, dead or alive.
  for (const id of [...boss.summonedIds]) {
    const e = ctx.entities.get(id);
    if (e && HEAT_ADD_IDS.has(e.templateId)) dropHeatMob({ ctx, inst, boss }, id);
  }
  for (const p of hearthListeners(ctx, inst)) for (const id of PLAYER_MARKS) dropAura(p, id);
  // Hunted is permanent: off everyone this guardian ever marked, wherever.
  dropStrayHunted(ctx, boss.id, null);
  clearCastIf(boss, HEAT_CASTS.fist);
  dropAura(boss, HEAT_AURAS.state);
  boss.hostile = true;
  boss.damageImmune = false;
  boss.damageFloorHp = undefined;
  setWell(ctx, inst, 'calm');
}

/** The fight ended without the kill: the Hearth as it was. */
function resetHeat(ctx: SimContext, inst: InstanceSlot, boss: Entity): void {
  clearFight(ctx, inst, boss, boss.smithHeartHeat ?? null);
  restoreTierHealth(boss, boss.smithHeartHeat?.basePool);
  boss.smithHeartHeat = undefined;
}

/** The guardian has fallen: the end is resolved once. */
function finishHeat(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: HeatFightState): void {
  st.finished = true;
  settleSmithHeartFeat(ctx, inst, { encounter: 'heat', st });
  const s = scopeOf(ctx, inst, st, boss);
  heatSay(s, boss, 'death');
  cueOnBoss(s, HEAT_CUES.settle);
  clearFight(ctx, inst, boss, st);
}

/** The pull: one state for the fight. */
function beginHeat(ctx: SimContext, inst: InstanceSlot, boss: Entity): HeatFightState {
  const st = freshState(heatDifficulty(inst));
  st.basePool = applyTierHealth(
    boss,
    tierPoolMult(inst, HEAT_DIFFICULTY[st.difficulty].healthMult),
  );
  boss.smithHeartHeat = st;
  const s = scopeOf(ctx, inst, st, boss);
  showState(s);
  // Straight after its entrance the line would say the entrance's again.
  if (!heatIntroJustSpoke(ctx, boss)) heatSay(s, boss, 'pull');
  return st;
}

/** One tick of the claim's Guardian of the Heat. */
export function tickHeatGuardian(ctx: SimContext, inst: InstanceSlot): void {
  const boss = heatGuardian(ctx, inst);
  if (!boss) return;
  const st0 = boss.smithHeartHeat ?? null;
  if (!living(boss)) {
    if (st0 && !st0.finished) finishHeat(ctx, inst, boss, st0);
    return;
  }
  // Its entrance holds it out of reach until the scene ends.
  if (stepHeatIntro(ctx, inst, boss, fighting(boss))) return;
  if (!fighting(boss)) {
    if (st0) {
      if (!st0.finished && hearthPlayers(ctx, inst).length === 0)
        heatSay(scopeOf(ctx, inst, st0, boss), boss, 'wipe');
      resetHeat(ctx, inst, boss);
    }
    return;
  }
  const st = st0 ?? beginHeat(ctx, inst, boss);
  const s = scopeOf(ctx, inst, st, boss);
  st.clock += DT;
  stepBar(s);
  stepOverflow(s);
  holdStance(s);
  stepSwells(s);
  stepWellFire(s);
  stepSeeds(s);
  stepZones(s);
  stepWheel(s);
  stepCinders(s);
  stepWellspawn(s);
  stepKeepers(s);
  stepMarks(s);
  stepTrails(s);
  syncHunted(s);
  watchHeatSlain(s);
  watchThresholds(s);
  startMechanics(s);
  holdStance(s);
  showState(s);
}

// ---- dev ----------------------------------------------------------------------------------

/** The fight's scope for a dev command or a test (starting the fight state
 *  if none runs yet), or null when the claim holds no living guardian. */
export function heatScopeForDev(ctx: SimContext, inst: InstanceSlot): HeatScope | null {
  const boss = heatGuardian(ctx, inst);
  if (!boss || !living(boss)) return null;
  // A mechanic forced from the dev line starts the fight: no entrance left.
  spendHeatIntro(ctx, boss);
  const st = boss.smithHeartHeat ?? beginHeat(ctx, inst, boss);
  return scopeOf(ctx, inst, st, boss);
}

/** Jump the fight to phase `phase` (its health at the phase's top), every
 *  footprint of the old one cleared. Returns the reply. */
function jumpToPhase(s: HeatScope, phase: number): string | null {
  if (phase !== 1 && phase !== 2 && phase !== 3) return null;
  const b = s.boss;
  clearFist(s);
  clearZones(s);
  clearRivers(s, s.st.overflow);
  if (s.st.overflow) endOverflowAdds(s);
  s.st.bar = null;
  const top = {
    1: 1,
    2: T.overflowOneAt - 0.01,
    3: T.overflowTwoAt - 0.01,
  }[phase];
  b.hp = Math.max(1, Math.floor(b.maxHp * top));
  setWell(s.ctx, s.inst, 'calm');
  enterPhase(s, phase);
  s.st.fistTimer = T.fistFirst;
  s.st.fistHeld = 0;
  return `The Guardian of the Heat fights in phase ${phase}.`;
}

/** `/dev heart heat <what>` for player `pid`: the reply line, or null for an
 *  unknown verb. */
export function heatDevTrigger(
  ctx: SimContext,
  inst: InstanceSlot,
  what: string,
  pid: number,
): string | null {
  const [verb, arg] = what.trim().split(/\s+/);
  if (verb === 'reset' || verb === 'intro') {
    const boss = heatGuardian(ctx, inst);
    if (!boss) return 'This run holds no Guardian of the Heat.';
    resetHeat(ctx, inst, boss);
    if (boss.dead)
      return 'The Guardian of the Heat has fallen in this run (/dev heart reset for a fresh one).';
    boss.hp = boss.maxHp;
    boss.aiState = 'idle';
    boss.inCombat = false;
    boss.aggroTargetId = null;
    clearThreat(boss);
    boss.pos = { ...boss.spawnPos, y: ctx.groundPos(boss.spawnPos.x, boss.spawnPos.z).y };
    boss.prevPos = { ...boss.pos };
    ctx.rebucket(boss);
    if (verb === 'intro') {
      replayHeatIntro(boss);
      return 'The Guardian of the Heat goes cold; it wakes again as the raid comes near.';
    }
    return 'The Guardian of the Heat stands whole again in its wellspring; the Hearth is calm.';
  }
  if (verb === 'heroic' || verb === 'mythic') {
    const on = arg !== 'off';
    setHeatDevTier(inst, verb, on);
    const live = heatGuardian(ctx, inst)?.smithHeartHeat;
    if (live) live.difficulty = heatDifficulty(inst);
    return on
      ? `The Guardian of the Heat fights on ${verb} for this run.`
      : `The Guardian of the Heat fights on ${heatDifficulty(inst)}.`;
  }
  const s = heatScopeForDev(ctx, inst);
  if (!s) return 'This run holds no living Guardian of the Heat.';
  if (verb === 'phase') return jumpToPhase(s, Number(arg));
  if (verb === 'intermission' || verb === 'overflow') {
    if (s.st.stage !== 'fight') return 'The Hearth is already overflowing.';
    const n = s.st.phase >= 2 ? 2 : 1;
    beginOverflow(s, n);
    return `The guardian sinks: overflow ${n}.`;
  }
  if (verb === 'fist') {
    clearFist(s);
    s.st.bar = null;
    s.st.gap = 0;
    const me = ctx.entities.get(pid);
    const o = ctx.instanceOriginOf(inst);
    const spot = me ? { x: me.pos.x - o.x, z: me.pos.z - o.z } : undefined;
    return startFist(s, spot) ? 'Basalt Fist: it comes down where you stand in 3 s.' : null;
  }
  if (verb === 'flare') return `Hearth Flare (${flare(s).length} struck).`;
  if (verb === 'seeds') return `${dropSeeds(s)} Hearthseeds fall.`;
  if (verb === 'wheel') {
    startWheel(s);
    return 'The Wheel of the Hearth turns.';
  }
  if (verb === 'zones') {
    startZones(s);
    return 'Wakefire: the bands ignite one after another.';
  }
  if (verb === 'ember' || verb === 'cinder')
    return callCinder(s) ? 'A Rolling Cinder falls.' : 'No Rolling Cinder can fall now.';
  return null;
}

/** The readout for `/dev heart heat` (state at a glance). */
export function heatReadout(ctx: SimContext, inst: InstanceSlot, pid: number): string {
  const boss = heatGuardian(ctx, inst);
  if (!boss) return '[dev] This run holds no Guardian of the Heat.';
  const head = `[dev] Guardian of the Heat (${heatDifficulty(inst)}): ${boss.dead ? 'dead' : `${Math.round((boss.hp / boss.maxHp) * 100)}%`}`;
  const st = boss.smithHeartHeat;
  if (!st) return `${head}; not fighting (${heatIntroReadout(boss)}).`;
  const me = ctx.entities.get(pid);
  const grip = me ? (auraOf(me, HEAT_AURAS.grip)?.stacks ?? 0) : 0;
  const over = st.overflow ? `, overflow ${st.overflow.n} (${st.overflow.clock.toFixed(0)} s)` : '';
  return `${head}; phase ${st.phase} (${st.stage}${over}), next fist in ${Math.max(0, st.fistTimer).toFixed(0)} s${st.fistHeld > 0 ? ' (held by Wakefire)' : ''}, seeds ${st.seeds.length}, zones ${st.zones.length}, cinders ${st.cinders.length}, Wellspawn ${st.spawn.length}, keepers ${st.keepers.length}, fed ${st.feeds}, your Cinder Grip ${grip}.`;
}
