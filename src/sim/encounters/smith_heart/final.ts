// The Masterless Strength (docs/design/raid/smith_heart.md section 7.5), part
// 1 of its mechanics: the quarter rules and the four quarter kits, on every
// difficulty. The strength without its master fights on the Anvil of the
// World; the quarter it stands in is the strength it drinks.
//
//   The rules     the Overload bars, Vein Shock (Heroic), Taking Root, Heart
//                 Unbound in the centre, the base form (final_rules.ts).
//   The Heat      dodge and place: Basalt Fist and its Molten Swells, Fire
//                 Whirls; Heroic's Ember Marks; Mythic's Forge Fire
//                 (final_heat.ts).
//   The Quench    stack: Quenching Cold, Encased in Rime; Heroic's Groaning
//                 Ice; Mythic's Numbing Frost (final_quench.ts).
//   The Breath    spread: Bellows Wind toward the rim, Leaping Bolt;
//                 Heroic's Drawn Lightning; Mythic's Storm Orbs
//                 (final_breath.ts).
//   The Hammer    the only group soak: Tremor Cracks, Weight of the Anvil;
//                 Heroic's Stone Shell and Crushed; Mythic's turning Anvil
//                 (final_hammer.ts).
//   One wipe      the fight ends when the boss stops fighting: every bar,
//                 footprint and mark gone.
//
// Not in this part (part 2): the intermissions at 70 and 40 percent and
// their adds, the final phase's mix at 15 percent, the Mythic hidden phase,
// loot. The pull's arrival scene, the body and the room's light are the
// renderer's (render/smith_heart_fx/final_fx.ts, render/smith_heart/).
//
// Difficulty: the claim's, with a dev switch for a run while the raid has no
// heroic or mythic tier of its own (FINAL_DIFFICULTY rows). Deterministic:
// every pick is hashed or ordered; the only rng draws are the damage rolls, in
// claim-player order. Every visible state rides existing entity fields
// (final_ids.ts says which): no wire or IWorld change.

import { HEART_ROOM, HEART_TERRACE } from '../../content/smith_heart_layout';
import { HEART_QUARTER_ORDER } from '../../content/smith_heart_quarters';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { clearThreat } from '../../threat';
import { DT, type Entity } from '../../types';
import { claimBoss, clearCastIf } from '../sunken_bastion/claim';
import {
  clearBreath,
  drawLightning,
  gatherWind,
  landBolt,
  raiseOrbs,
  startBolt,
  stepDrawn,
  stepOrbs,
  stepWind,
} from './final_breath';
import {
  clearHammer,
  crackTremors,
  landAnvil,
  startAnvil,
  stepAnvil,
  stepTremors,
  stoneShell,
} from './final_hammer';
import {
  clearFist,
  clearHeat,
  forgeFire,
  landFist,
  markEmbers,
  raiseWhirls,
  startFist,
  stepEmbersAndPools,
  stepSwells,
  stepWhirls,
} from './final_heat';
import {
  FINAL_AURAS,
  FINAL_BOSS,
  FINAL_CASTS,
  FINAL_CUES,
  FINAL_DIFFICULTY,
  FINAL_OVERLOAD,
  type FinalDifficulty,
  FINAL_TUNING as T,
} from './final_ids';
import { clearQuench, crackIce, encase, numbingFrost, stepCold, stepCracks } from './final_quench';
import {
  bossZone,
  burstBar,
  clearRules,
  endRoot,
  enterZone,
  followTank,
  holdRoot,
  showState,
  stepOverload,
  stepRoot,
  stepUnbound,
  takeRoot,
  veinShock,
} from './final_rules';
import {
  anvilPlayers,
  bossFree,
  cueOn,
  dropAura,
  dropFightObject,
  type FinalScope,
  heartListeners,
  holdPlanted,
  living,
} from './final_scope';
import type { FinalFightState, FinalKitClocks } from './final_state';

// ---- the dev difficulty switch ------------------------------------------------------------

/** Claims a dev playtest switched to heroic or mythic (`/dev heart final
 *  heroic|mythic`), keyed by the claim's identity and its exit so a recycled
 *  slot never inherits it. Dev-gated by its one caller. */
const devTier = new WeakMap<InstanceSlot, { exitId: number; tier: FinalDifficulty }>();

/** Set this claim's dev tier (`normal` clears it). */
export function setFinalDevTier(inst: InstanceSlot, tier: FinalDifficulty): void {
  if (tier !== 'normal' && inst.exitId !== null) devTier.set(inst, { exitId: inst.exitId, tier });
  else devTier.delete(inst);
}

/** The fight's difficulty in a claim. */
export function finalDifficulty(inst: InstanceSlot): FinalDifficulty {
  const dev = inst.exitId !== null ? devTier.get(inst) : undefined;
  if (dev && dev.exitId === inst.exitId) return dev.tier;
  return inst.difficulty === 'heroic' ? 'heroic' : 'normal';
}

// ---- the body and the state ---------------------------------------------------------------

/** The claim's boss (dead or alive), or null. */
export function finalBoss(ctx: SimContext, inst: InstanceSlot): Entity | null {
  return claimBoss(ctx, inst, FINAL_BOSS);
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

/** The active quarter's kit clocks, fresh on entering it. */
export function freshKit(): FinalKitClocks {
  return {
    fist: T.fistFirst,
    whirl: T.whirlFirst,
    ember: T.emberFirst,
    ice: T.iceFirst,
    wind: T.windFirst,
    bolt: T.boltFirst,
    drawn: T.drawnFirst,
    orb: T.orbFirst,
    tremor: T.tremorFirst,
    anvil: T.anvilFirst,
    shell: T.shellFirst,
  };
}

function freshState(difficulty: FinalDifficulty): FinalFightState {
  return {
    kind: 'final',
    difficulty,
    finished: false,
    clock: 0,
    zone: 'ring',
    baseForm: null,
    lastQuarter: null,
    overload: { breath: 0, quench: 0, hammer: 0, heat: 0 },
    pulseTimer: FINAL_OVERLOAD.pulseEvery,
    rootLeft: 0,
    rootAt: null,
    dragGrace: 0,
    overloadWarned: { breath: false, quench: false, hammer: false, heat: false },
    shakenLeft: 0,
    switches: 0,
    bursts: 0,
    unbound: 0,
    unboundTimer: T.unboundEvery,
    bar: null,
    gap: 0,
    kit: freshKit(),
    casts: 0,
    fist: null,
    swells: [],
    whirls: [],
    embers: [],
    pools: [],
    poolTick: T.poolTick,
    cold: {},
    frozen: {},
    cracks: [],
    wind: null,
    boltTarget: null,
    drawn: [],
    drawnTick: T.drawnTick,
    orbs: [],
    tremors: [],
    anvil: null,
    cleaveSeen: 0,
  };
}

function scopeOf(
  ctx: SimContext,
  inst: InstanceSlot,
  st: FinalFightState,
  boss: Entity,
): FinalScope {
  return {
    ctx,
    inst,
    st,
    boss,
    players: anvilPlayers(ctx, inst),
    rules: FINAL_DIFFICULTY[st.difficulty],
  };
}

// ---- the zone ------------------------------------------------------------------------------

/** Watch the zone the boss stands in: a change into a NEW quarter enters it
 *  (its root, its kit's fresh clocks, the switch's shock); back into the
 *  quarter it last stood in, its kit runs on where it was. */
function watchZone(s: FinalScope, first: boolean): void {
  const zone = bossZone(s, first);
  if (!first && zone === s.st.zone) return;
  if (zone !== 'ring' && zone !== s.st.lastQuarter) s.st.kit = freshKit();
  enterZone(s, zone);
}

// ---- the bar ------------------------------------------------------------------------------

function landBar(s: FinalScope, castId: string): void {
  s.st.bar = null;
  s.st.gap = T.barGap;
  if (castId === FINAL_CASTS.fist) landFist(s);
  else if (castId === FINAL_CASTS.bolt) landBolt(s);
  else if (castId === FINAL_CASTS.anvil) landAnvil(s);
}

/** The bar in flight: planted, counting down, landing. A bar cut by anything
 *  still lands (its footprint never strands). */
function stepBar(s: FinalScope): void {
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

// ---- the kits -----------------------------------------------------------------------------

/** One clock of the active kit: true when it ran out this tick. */
function due(s: FinalScope, key: keyof FinalKitClocks, needsBar = false): boolean {
  const k = s.st.kit;
  k[key] -= DT;
  if (k[key] > 1e-9) return false;
  if (needsBar && !bossFree(s)) {
    k[key] = 0;
    return false;
  }
  return true;
}

/** The active quarter's kit, each mechanic on its clock. */
function runKit(s: FinalScope): void {
  const r = s.rules;
  switch (s.st.zone) {
    case 'heat':
      if (due(s, 'fist', true)) startFist(s);
      if (due(s, 'whirl')) raiseWhirls(s);
      if (r.embers && due(s, 'ember')) markEmbers(s);
      return;
    case 'quench':
      if (r.breakingIce && due(s, 'ice')) crackIce(s);
      return;
    case 'breath':
      if (due(s, 'wind')) gatherWind(s);
      if (due(s, 'bolt', true)) startBolt(s);
      if (r.drawnLightning && due(s, 'drawn')) drawLightning(s);
      if (r.stormOrbs && due(s, 'orb')) raiseOrbs(s);
      return;
    case 'hammer':
      if (due(s, 'tremor')) crackTremors(s);
      if (due(s, 'anvil', true)) startAnvil(s);
      if (r.stoneShell && due(s, 'shell')) stoneShell(s);
      return;
    default:
  }
}

/** Mythic's watch on the frontal (Forge Fist, the swing cleave): a reset of
 *  its swing count is the cleave landing. */
function watchFrontal(s: FinalScope): void {
  const now = s.boss.swingCleaveCount ?? 0;
  const seen = s.st.cleaveSeen;
  s.st.cleaveSeen = now;
  if (!(now === 0 && seen > 0)) return;
  if (s.st.zone === 'heat' && s.rules.forgeFire) forgeFire(s);
  if (s.st.zone === 'quench' && s.rules.numbingFrost) numbingFrost(s);
}

// ---- the start, the reset, the end --------------------------------------------------------

/** The player marks the fight lays (cleared at its end). */
const PLAYER_MARKS = [
  FINAL_AURAS.shaken,
  FINAL_AURAS.cold,
  FINAL_AURAS.numbing,
  FINAL_AURAS.ember,
  FINAL_AURAS.drawn,
  FINAL_AURAS.crushed,
  FINAL_AURAS.shell,
] as const;

function clearFight(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: FinalFightState | null,
): void {
  const players = heartListeners(ctx, inst);
  if (st) {
    const s = { ctx, inst, st, boss };
    clearHeat(s);
    clearQuench(s, players);
    clearBreath(s, players);
    clearHammer(s, players);
  }
  for (const p of players) for (const id of PLAYER_MARKS) dropAura(p, id);
  clearCastIf(boss, FINAL_CASTS.fist, FINAL_CASTS.bolt, FINAL_CASTS.anvil);
  clearRules(boss);
}

/** The boss's authored home (world yards and facing): the middle of the
 *  Anvil, facing the terrace it is first seen from. The dungeon's spawn
 *  record (content/smith_heart.ts) puts it there; a reset, a wipe and the
 *  dev verbs bring it back here, never to wherever a dev move set it. */
export function finalHome(
  ctx: SimContext,
  inst: InstanceSlot,
): { x: number; y: number; z: number; facing: number } {
  const o = ctx.instanceOriginOf(inst);
  const g = ctx.groundPos(o.x + HEART_ROOM.x, o.z + HEART_ROOM.z);
  const facing = Math.atan2(HEART_TERRACE.x - HEART_ROOM.x, HEART_TERRACE.z - HEART_ROOM.z);
  return { x: g.x, y: g.y, z: g.z, facing };
}

/** Its home is its authored one again (a stale dev move undone), so the
 *  evade that ends a wipe walks it there. */
function reHome(ctx: SimContext, inst: InstanceSlot, boss: Entity): void {
  const h = finalHome(ctx, inst);
  boss.spawnPos = { x: h.x, y: h.y, z: h.z };
  if (boss.leashAnchor) boss.leashAnchor = { ...boss.spawnPos };
}

function resetFinal(ctx: SimContext, inst: InstanceSlot, boss: Entity): void {
  clearFight(ctx, inst, boss, boss.smithHeartFinal ?? null);
  boss.smithHeartFinal = undefined;
  reHome(ctx, inst, boss);
}

function finishFinal(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: FinalFightState): void {
  st.finished = true;
  cueOn(scopeOf(ctx, inst, st, boss), boss, FINAL_CUES.settle, 'arcane');
  clearFight(ctx, inst, boss, st);
}

function beginFinal(ctx: SimContext, inst: InstanceSlot, boss: Entity): FinalFightState {
  const st = freshState(finalDifficulty(inst));
  boss.smithHeartFinal = st;
  const s = scopeOf(ctx, inst, st, boss);
  watchZone(s, true);
  showState(s);
  return st;
}

/** One tick of the claim's Masterless Strength. */
export function tickFinalBoss(ctx: SimContext, inst: InstanceSlot): void {
  const boss = finalBoss(ctx, inst);
  if (!boss) return;
  const st0 = boss.smithHeartFinal ?? null;
  if (!living(boss)) {
    if (st0 && !st0.finished) finishFinal(ctx, inst, boss, st0);
    return;
  }
  if (!fighting(boss)) {
    if (st0) resetFinal(ctx, inst, boss);
    return;
  }
  const st = st0 ?? beginFinal(ctx, inst, boss);
  const s = scopeOf(ctx, inst, st, boss);
  st.clock += DT;
  stepBar(s);
  stepRoot(s);
  followTank(s);
  watchZone(s, false);
  stepOverload(s);
  stepUnbound(s);
  stepSwells(s);
  stepWhirls(s);
  stepEmbersAndPools(s);
  stepCold(s, st.zone === 'quench');
  stepCracks(s);
  stepWind(s);
  stepDrawn(s);
  stepOrbs(s);
  stepTremors(s);
  stepAnvil(s);
  watchFrontal(s);
  runKit(s);
  holdRoot(s);
  showState(s);
}

// ---- dev ----------------------------------------------------------------------------------

/** The fight's scope for a dev command or a test (starting the fight state
 *  if none runs yet), or null when the claim holds no living boss. */
/** A dev move of the boss mid-fight: its root lets go and its bar (and the
 *  bar's footprint) is dropped first, so nothing holds it where it was. */
export function releaseRootForDev(ctx: SimContext, inst: InstanceSlot): void {
  const boss = finalBoss(ctx, inst);
  const st = boss?.smithHeartFinal;
  if (!boss || !st) return;
  const s = scopeOf(ctx, inst, st, boss);
  endRoot(s);
  if (!st.bar) return;
  st.bar = null;
  st.boltTarget = null;
  clearFist(s);
  if (st.anvil) dropFightObject(ctx, inst, st.anvil.objectId);
  st.anvil = null;
  clearCastIf(boss, FINAL_CASTS.fist, FINAL_CASTS.bolt, FINAL_CASTS.anvil);
}

export function finalScopeForDev(ctx: SimContext, inst: InstanceSlot): FinalScope | null {
  const boss = finalBoss(ctx, inst);
  if (!boss || !living(boss)) return null;
  const st = boss.smithHeartFinal ?? beginFinal(ctx, inst, boss);
  return scopeOf(ctx, inst, st, boss);
}

/** The boss whole, home and out of its fight. Returns the reply. */
export function resetFinalForDev(ctx: SimContext, inst: InstanceSlot): string {
  const boss = finalBoss(ctx, inst);
  if (!boss) return 'This run holds no Masterless Strength.';
  resetFinal(ctx, inst, boss);
  if (boss.dead)
    return 'The Masterless Strength has fallen in this run (/dev heart reset for a fresh one).';
  // The shared evade reset (health, auras, threat, pins, the pull's own
  // state), then straight home: its authored spot and facing.
  ctx.resetEvadingMob(boss);
  boss.aggroTargetId = null;
  boss.castingAbility = null;
  boss.castRemaining = 0;
  boss.castTotal = 0;
  clearThreat(boss);
  const h = finalHome(ctx, inst);
  boss.pos = { x: h.x, y: h.y, z: h.z };
  boss.prevPos = { ...boss.pos };
  boss.facing = h.facing;
  boss.prevFacing = h.facing;
  ctx.rebucket(boss);
  return 'The Masterless Strength stands whole again, home and out of its fight.';
}

const VEINS: readonly string[] = HEART_QUARTER_ORDER;

/** `/dev heart final <what>` for player `pid` once a fight runs: the reply
 *  line, or null for an unknown verb. */
export function finalDevMechanic(
  ctx: SimContext,
  inst: InstanceSlot,
  what: string,
  pid: number,
): string | null {
  const [verb, arg, arg2] = what.trim().split(/\s+/);
  const s = finalScopeForDev(ctx, inst);
  if (!s) return 'This run holds no living Masterless Strength.';
  const me = ctx.entities.get(pid) ?? null;
  const o = ctx.instanceOriginOf(inst);
  const here = me ? { x: me.pos.x - o.x, z: me.pos.z - o.z } : undefined;
  const st = s.st;
  const clearBar = () => {
    st.bar = null;
    st.gap = 0;
    clearCastIf(s.boss, FINAL_CASTS.fist, FINAL_CASTS.bolt, FINAL_CASTS.anvil);
  };
  switch (verb) {
    case 'fill': {
      const pct = arg2 !== undefined ? Number(arg2) : Number(arg);
      const which = arg2 !== undefined || Number.isNaN(Number(arg)) ? arg : 'all';
      const share = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) / 100 : 0.95;
      const veins =
        which === 'all' || which === undefined ? VEINS : VEINS.filter((v) => v === which);
      if (veins.length === 0) return null;
      for (const v of veins) st.overload[v as keyof typeof st.overload] = share;
      return `Overload ${veins.join(', ')} set to ${Math.round(share * 100)}%.`;
    }
    case 'burst': {
      const v = st.zone === 'ring' ? 'heat' : st.zone;
      return `Overload Burst (${v}): ${burstBar(s, v).length} struck.`;
    }
    case 'shock':
      return `Vein Shock: ${veinShock(s).length} struck.`;
    case 'root':
      takeRoot(s);
      return `Taking Root: it holds where it stands for ${T.rootSeconds} s.`;
    case 'unroot':
      endRoot(s);
      return 'Taking Root ends.';
    case 'fist':
      clearBar();
      return startFist(s, here) ? 'Basalt Fist: it comes down where you stand in 3 s.' : null;
    case 'whirl':
    case 'whirls':
      return `${raiseWhirls(s)} Fire Whirls rise.`;
    case 'embers':
    case 'ember':
      return `Ember Mark on ${markEmbers(s).length} ranged players.`;
    case 'freeze':
      if (!me) return null;
      encase(s, me);
      return 'Encased in Rime.';
    case 'cold':
      if (!me) return null;
      st.cold[me.id] = Math.max(0, Math.min(T.coldMax - 1, Number(arg) || 0));
      return `Your cold set to ${Math.round(st.cold[me.id])}.`;
    case 'ice':
      return `Groaning Ice under ${crackIce(s).length} players.`;
    case 'wind': {
      const deg = Number(arg);
      gatherWind(s, Number.isFinite(deg) ? (deg * Math.PI) / 180 : undefined);
      return 'Bellows Wind gathers.';
    }
    case 'bolt':
      clearBar();
      return startBolt(s) ? 'Leaping Bolt: 2 s.' : null;
    case 'drawn':
      return `Drawn Lightning on ${drawLightning(s).length} players.`;
    case 'orbs':
    case 'orb':
      return `${raiseOrbs(s)} Storm Orbs.`;
    case 'tremor':
    case 'tremors':
      return `Tremor Cracks under ${crackTremors(s).length} players.`;
    case 'anvil':
      clearBar();
      return startAnvil(s, here) ? 'Weight of the Anvil: 6 s, on you.' : null;
    case 'shell':
      return `Stone Shell on ${stoneShell(s).length} players.`;
    default:
      return null;
  }
}

/** The readout for `/dev heart final` (state at a glance). */
export function finalReadout(ctx: SimContext, inst: InstanceSlot): string {
  const boss = finalBoss(ctx, inst);
  if (!boss) return '[dev] This run holds no Masterless Strength.';
  const head = `[dev] The Masterless Strength (${finalDifficulty(inst)}): ${boss.dead ? 'dead' : `${Math.round((boss.hp / boss.maxHp) * 100)}%`}`;
  const st = boss.smithHeartFinal;
  if (!st) return `${head}; not fighting.`;
  const bars = HEART_QUARTER_ORDER.map((v) => `${v} ${Math.round(st.overload[v] * 100)}`).join(
    ', ',
  );
  return `${head}; in ${st.zone} (base ${st.baseForm ?? 'none'}), root ${st.rootLeft.toFixed(0)} s, shaken ${st.shakenLeft.toFixed(0)} s, unbound ${st.unbound}; Overload ${bars}; switches ${st.switches}, bursts ${st.bursts}.`;
}
