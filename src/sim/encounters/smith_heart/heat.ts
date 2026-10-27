// The Guardian of the Heat (docs/design/raid/smith_heart.md section 7.4): the
// Hearth's boss, a being of the first flame in crystal and basalt. "The flame
// that grows": one phase, no change at half health. A PROPOSAL built as a
// playable prototype (the designer has not approved it yet).
//
//   The heat           0 to 100 on the guardian, rising on its own; the
//                      hotter, the heavier the Hearth Pulse on the whole
//                      raid; from 90 the overheat winds up, at 100
//                      Hearthburst (heat_gauge.ts). Stoked Hearth: the heat
//                      rises faster every 40 s (the soft enrage).
//   The crystals       Shed Heat raises Kindled Crystals whose rays burn the
//                      nearest player and cool the Hearth, or go back into it
//                      and heat it when nobody is near (heat_crystals.ts).
//   The channel        the first flame runs across the floor and splits it in
//                      two for a few seconds (heat_channel.ts).
//   Molten Pour and    the kit's lane and stun stay (the trash engine runs
//   Searing Knell      them); heroic's knell leaves embers (heat_knell.ts).
//   Heroic             three crystals, burns fade slower, Knell Embers.
//   One wipe           the fight ends when the guardian stops fighting: every
//                      bar, crystal, burn, ember and marker gone, the heat
//                      back to nothing, the channel still.
//   Its fall           lights the Heat vein and the seal's quarter as before
//                      (seal.ts reads the guardian's death).
//
// Difficulty: the claim's, with a dev switch for a run while the raid has no
// heroic tier of its own; mythic is a prototype behind its own switch and,
// for now, heroic whole (heat_ids.ts HEAT_DIFFICULTY).
//
// Deterministic: every pick is hashed or ordered; the only rng draws are the
// damage rolls, in claim-player order. Every visible state rides existing
// entity fields (heat_ids.ts says which), so the online client mirrors the
// whole fight with no wire or IWorld change.

import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { clearThreat } from '../../threat';
import { DT, type Entity } from '../../types';
import { claimBoss, clearCastIf } from '../sunken_bastion/claim';
import { brimNow, clearChannel, freshChannel, layChannel, stepChannel } from './heat_channel';
import {
  addBurn,
  clearCrystals,
  landShed,
  riseNow,
  startShed,
  stepBurns,
  stepCrystals,
} from './heat_crystals';
import { clearHeatMarks, hearthburst, setHeat, showHeat, stepHeat } from './heat_gauge';
import {
  HEAT_AURAS,
  HEAT_CASTS,
  HEAT_CUES,
  HEAT_DIFFICULTY,
  HEAT_GUARDIAN,
  type HeatDifficulty,
  HEAT_TUNING as T,
} from './heat_ids';
import { clearEmbers, layEmbers, stepEmbers, watchKnell } from './heat_knell';
import {
  at,
  cueOnBoss,
  dropAura,
  guardianFree,
  type HeatScope,
  hearthListeners,
  hearthPlayers,
  holdPlanted,
  living,
} from './heat_scope';
import type { HeatFightState } from './heat_state';
import { heatSay } from './heat_voice';

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
    heat: T.heatStart,
    heatRef: T.heatStart,
    trend: 1,
    trendTimer: 1,
    windup: false,
    overheats: 0,
    pulseTimer: T.pulseEvery,
    stokeTimer: T.stokeEvery,
    stokeStacks: 0,
    bar: null,
    gap: 0,
    shedTimer: T.shedFirst,
    sheds: 0,
    rises: [],
    crystals: [],
    burns: {},
    channel: freshChannel(),
    embers: [],
    knellAt: {},
    marked: {},
    rays: 0,
    raysBack: 0,
    casts: 0,
    said: {},
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

// ---- the bar ------------------------------------------------------------------------------

/** The bar in flight: planted, counting down, landing. A bar cut by
 *  anything still raises its crystals (the rise spots never strand). */
function stepBar(s: HeatScope): void {
  s.st.gap = Math.max(0, s.st.gap - DT);
  const bar = s.st.bar;
  if (!bar) return;
  const b = s.boss;
  if (b.castingAbility !== bar.castId) {
    s.st.bar = null;
    s.st.gap = T.barGap;
    if (bar.castId === HEAT_CASTS.shed) landShed(s);
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
  s.st.bar = null;
  s.st.gap = T.barGap;
  if (bar.castId === HEAT_CASTS.shed) landShed(s);
}

/** The guardian's next bar: Shed Heat on its clock. */
function startBars(s: HeatScope): void {
  s.st.shedTimer -= DT;
  if (s.st.shedTimer > 0 || !guardianFree(s)) return;
  startShed(s);
}

// ---- the start, the reset, the end --------------------------------------------------------

/** Everything the fight put on the floor goes. */
function clearFight(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: HeatFightState | null,
): void {
  if (st) {
    for (const key of [...Object.keys(st.marked), ...Object.keys(st.burns)]) {
      const p = ctx.entities.get(Number(key));
      if (p) clearHeatMarks(p);
    }
    const s = { ctx, inst, st };
    clearCrystals(s);
    clearChannel(s);
    clearEmbers(s);
    st.marked = {};
  }
  for (const p of hearthListeners(ctx, inst)) clearHeatMarks(p);
  clearCastIf(boss, HEAT_CASTS.shed);
  dropAura(boss, HEAT_AURAS.stoked);
  dropAura(boss, HEAT_AURAS.overheating);
  boss.resource = 0;
}

/** The fight ended without the kill: the Hearth as it was. */
function resetHeat(ctx: SimContext, inst: InstanceSlot, boss: Entity): void {
  clearFight(ctx, inst, boss, boss.smithHeartHeat ?? null);
  boss.smithHeartHeat = undefined;
}

/** The guardian has fallen: the end is resolved once. */
function finishHeat(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: HeatFightState): void {
  st.finished = true;
  const s = scopeOf(ctx, inst, st, boss);
  heatSay(s, boss, 'death');
  cueOnBoss(s, HEAT_CUES.settle);
  clearFight(ctx, inst, boss, st);
}

/** The pull: one state for the fight, the channel's bed laid. */
function beginHeat(ctx: SimContext, inst: InstanceSlot, boss: Entity): HeatFightState {
  const st = freshState(heatDifficulty(inst));
  boss.smithHeartHeat = st;
  const s = scopeOf(ctx, inst, st, boss);
  layChannel(s);
  showHeat(s);
  heatSay(s, boss, 'pull');
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
  stepCrystals(s);
  stepBurns(s);
  stepChannel(s);
  watchKnell(s);
  stepEmbers(s);
  stepHeat(s);
  startBars(s);
}

// ---- dev ----------------------------------------------------------------------------------

/** The fight's scope for a dev command or a test (starting the fight state
 *  if none runs yet), or null when the claim holds no living guardian. */
export function heatScopeForDev(ctx: SimContext, inst: InstanceSlot): HeatScope | null {
  const boss = heatGuardian(ctx, inst);
  if (!boss || !living(boss)) return null;
  const st = boss.smithHeartHeat ?? beginHeat(ctx, inst, boss);
  return scopeOf(ctx, inst, st, boss);
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
  if (verb === 'reset') {
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
    return 'The Guardian of the Heat stands whole again; the Hearth is calm.';
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
  if (verb === 'heat') {
    const n = Number(arg);
    if (!Number.isFinite(n)) return null;
    setHeat(s, n);
    return `The Hearth's heat is ${Math.round(s.st.heat)}.`;
  }
  if (verb === 'crystals' || verb === 'shed') {
    if (verb === 'shed' && guardianFree(s)) {
      startShed(s);
      return 'Shed Heat: the crystals rise in 2.5 s.';
    }
    return `${riseNow(s)} Kindled Crystals rise now.`;
  }
  if (verb === 'channel') {
    brimNow(s);
    return 'The channel brims: it flows in 4 s.';
  }
  if (verb === 'overheat' || verb === 'burst') {
    const n = hearthburst(s).length;
    showHeat(s);
    return `Hearthburst (${n} struck).`;
  }
  const me = ctx.entities.get(pid);
  if (!me || me.dead) return 'You are not standing in the Hearth.';
  if (verb === 'burn') {
    const n = arg === undefined ? 5 : Number(arg);
    if (!Number.isFinite(n)) return null;
    return `Crystal Burn: ${addBurn(s, me, Math.round(n))} stacks.`;
  }
  if (verb === 'embers') {
    const here = at(s, me);
    layEmbers(s, here.x, here.z);
    return 'Knell Embers under you.';
  }
  return null;
}

/** The readout for `/dev heart heat` (state at a glance). */
export function heatReadout(ctx: SimContext, inst: InstanceSlot, pid: number): string {
  const boss = heatGuardian(ctx, inst);
  if (!boss) return '[dev] This run holds no Guardian of the Heat.';
  const head = `[dev] Guardian of the Heat (${heatDifficulty(inst)}): ${boss.dead ? 'dead' : `${Math.round((boss.hp / boss.maxHp) * 100)}%`}`;
  const st = boss.smithHeartHeat;
  if (!st) return `${head}; not fighting.`;
  const burn = st.burns[pid]?.stacks ?? 0;
  return `${head}; heat ${Math.round(st.heat)} (${st.trend > 0 ? 'rising' : 'falling'}), stoked ${st.stokeStacks}, crystals ${st.crystals.length}, next Shed Heat in ${Math.max(0, st.shedTimer).toFixed(0)} s, channel ${st.channel.state} (${Math.max(0, st.channel.remaining).toFixed(0)} s), your burn ${burn}, rays ${st.rays} taken / ${st.raysBack} back, overheats ${st.overheats}.`;
}
