// Bout runners: one PvP duel or one PvE kill attempt per fresh Sim, metrics
// collected from the SimEvent stream (the same telemetry every host sees).
// Each bout is byte-deterministic in its seed; Monte Carlo variance comes from
// sweeping seeds, never from wall clock or Math.random.

import type { TalentAllocation } from '../../src/sim/content/talents';
import { MOBS } from '../../src/sim/data';
import { createMob } from '../../src/sim/entity';
import type { Sim } from '../../src/sim/sim';
import { DT, MAX_LEVEL, type SimEvent } from '../../src/sim/types';
import {
  ARENA_CENTRE,
  addFighter,
  face,
  makeArenaSim,
  releaseArenaWorld,
  runPrepull,
  teleport,
  topUp,
} from './arena';
import { driveFighter, underControl } from './policy';
import type { BalanceSpec } from './spec_catalog';

export interface FighterConfig {
  spec: BalanceSpec;
  level?: number;
  talents?: TalentAllocation;
}

export interface CombatantMetrics {
  key: string;
  damageDone: number;
  healingDone: number;
  damageTaken: number;
  // Ticks the OPPONENT spent under hard control while this fighter lived.
  controlTicksInflicted: number;
  castsByAbility: Record<string, number>;
  damageByAbility: Record<string, number>;
  hpFracEnd: number;
  diedForReal: boolean;
}

export type DuelEndReason = 'duelEnd' | 'stalemate' | 'timeout';

export interface DuelResult {
  winner: 'a' | 'b' | 'draw';
  endReason: DuelEndReason;
  seconds: number;
  a: CombatantMetrics;
  b: CombatantMetrics;
}

const COUNTDOWN_TICK_CAP = 20 * 6;
// A duel where neither fighter dips under this hp fraction for the whole window
// is a sustain stalemate; call it early instead of burning the full cap.
const STALEMATE_HP_FRAC = 0.85;
const STALEMATE_WINDOW_TICKS = 20 * 30;

function freshMetrics(key: string): CombatantMetrics {
  return {
    key,
    damageDone: 0,
    healingDone: 0,
    damageTaken: 0,
    controlTicksInflicted: 0,
    castsByAbility: {},
    damageByAbility: {},
    hpFracEnd: 1,
    diedForReal: false,
  };
}

function bump(rec: Record<string, number>, key: string, amount: number): void {
  rec[key] = (rec[key] ?? 0) + amount;
}

// Credit an entity's actions to the fighter that owns it (pets and imps count
// for their master, the same rule the duel system itself applies).
function creditOf(sim: Sim, entityId: number, pids: number[]): number | null {
  if (pids.includes(entityId)) return entityId;
  const owner = sim.entities.get(entityId)?.ownerId;
  return owner !== null && owner !== undefined && pids.includes(owner) ? owner : null;
}

function collect(
  sim: Sim,
  events: SimEvent[],
  byPid: Map<number, CombatantMetrics>,
  pids: number[],
): { duelEndWinner: string | null } {
  let duelEndWinner: string | null = null;
  for (const e of events) {
    if (e.type === 'damage' && e.kind === 'hit') {
      const credit = creditOf(sim, e.sourceId, pids);
      if (credit !== null && credit !== e.targetId) {
        const m = byPid.get(credit);
        if (m) {
          m.damageDone += e.amount;
          bump(m.damageByAbility, e.ability ?? 'auto_attack', e.amount);
        }
      }
      const taken = byPid.get(e.targetId);
      if (taken) taken.damageTaken += e.amount;
    } else if (e.type === 'heal2') {
      const credit = creditOf(sim, e.sourceId, pids);
      const m = credit === null ? undefined : byPid.get(credit);
      if (m) m.healingDone += e.amount;
    } else if (e.type === 'duelEnd') {
      duelEndWinner = e.winnerName;
    }
  }
  return { duelEndWinner };
}

export function runDuelBout(
  aCfg: FighterConfig,
  bCfg: FighterConfig,
  seed: number,
  maxSeconds = 180,
): DuelResult {
  const sim = makeArenaSim(seed);
  try {
    const a = addFighter(sim, aCfg.spec, 'BoutA', aCfg);
    const b = addFighter(sim, bCfg.spec, 'BoutB', bCfg);
    teleport(sim, a, ARENA_CENTRE.x - 5, ARENA_CENTRE.z);
    teleport(sim, b, ARENA_CENTRE.x + 5, ARENA_CENTRE.z);
    const ea = sim.entities.get(a)!;
    const eb = sim.entities.get(b)!;
    face(ea, eb);
    face(eb, ea);
    runPrepull(sim, aCfg.spec, a);
    runPrepull(sim, bCfg.spec, b);
    teleport(sim, a, ARENA_CENTRE.x - 5, ARENA_CENTRE.z);
    teleport(sim, b, ARENA_CENTRE.x + 5, ARENA_CENTRE.z);
    topUp(sim, a);
    topUp(sim, b);

    sim.duelRequest(b, a);
    sim.duelAccept(b);
    const duels = (sim as unknown as { duels: Map<number, { state: string }> }).duels;
    if (!duels.has(a) && !duels.has(b)) throw new Error('duel did not start');
    for (let i = 0; i < COUNTDOWN_TICK_CAP && duels.get(a)?.state !== 'active'; i++) sim.tick();
    if (duels.get(a)?.state !== 'active') throw new Error('duel never went active');

    const metrics = new Map<number, CombatantMetrics>([
      [a, freshMetrics(aCfg.spec.key)],
      [b, freshMetrics(bCfg.spec.key)],
    ]);
    const pids = [a, b];
    let winnerName: string | null = null;
    let ticks = 0;
    let calmTicks = 0;
    let endReason: DuelEndReason = 'timeout';
    const maxTicks = Math.round(maxSeconds / DT);
    const handleA = {
      pid: a,
      spec: aCfg.spec,
      onCast: (ability: string) => bump(metrics.get(a)!.castsByAbility, ability, 1),
    };
    const handleB = {
      pid: b,
      spec: bCfg.spec,
      onCast: (ability: string) => bump(metrics.get(b)!.castsByAbility, ability, 1),
    };
    for (; ticks < maxTicks; ticks++) {
      driveFighter(sim, handleA, b);
      driveFighter(sim, handleB, a);
      const { duelEndWinner } = collect(sim, sim.tick(), metrics, pids);
      if (underControl(eb) && !ea.dead) metrics.get(a)!.controlTicksInflicted++;
      if (underControl(ea) && !eb.dead) metrics.get(b)!.controlTicksInflicted++;
      if (duelEndWinner !== null) {
        winnerName = duelEndWinner;
        endReason = 'duelEnd';
        ticks++;
        break;
      }
      const calm = ea.hp / ea.maxHp > STALEMATE_HP_FRAC && eb.hp / eb.maxHp > STALEMATE_HP_FRAC;
      calmTicks = calm ? calmTicks + 1 : 0;
      if (calmTicks >= STALEMATE_WINDOW_TICKS) {
        endReason = 'stalemate';
        ticks++;
        break;
      }
    }

    const ma = metrics.get(a)!;
    const mb = metrics.get(b)!;
    ma.hpFracEnd = Math.max(0, ea.hp / ea.maxHp);
    mb.hpFracEnd = Math.max(0, eb.hp / eb.maxHp);
    ma.diedForReal = ea.dead;
    mb.diedForReal = eb.dead;
    const winner = winnerName === 'BoutA' ? 'a' : winnerName === 'BoutB' ? 'b' : 'draw';
    return { winner, endReason, seconds: ticks * DT, a: ma, b: mb };
  } finally {
    releaseArenaWorld();
  }
}

export interface PveTarget {
  key: string;
  templateId: string;
  // Level delta relative to the fighter (0 = at level).
  levelDelta?: number;
}

export interface PveResult {
  killed: boolean;
  playerDied: boolean;
  seconds: number;
  dps: number;
  fighter: CombatantMetrics;
}

export function runPveBout(
  cfg: FighterConfig,
  target: PveTarget,
  seed: number,
  maxSeconds = 180,
): PveResult {
  const template = MOBS[target.templateId];
  if (!template) throw new Error(`unknown mob template "${target.templateId}"`);
  const sim = makeArenaSim(seed);
  try {
    const pid = addFighter(sim, cfg.spec, 'BoutA', cfg);
    teleport(sim, pid, ARENA_CENTRE.x, ARENA_CENTRE.z);
    runPrepull(sim, cfg.spec, pid);
    teleport(sim, pid, ARENA_CENTRE.x, ARENA_CENTRE.z);
    topUp(sim, pid);
    const p = sim.entities.get(pid)!;
    const level = Math.max(
      1,
      Math.min(MAX_LEVEL + 2, (cfg.level ?? MAX_LEVEL) + (target.levelDelta ?? 0)),
    );
    const mob = createMob((sim as unknown as { nextId: number }).nextId++, template, level, {
      x: ARENA_CENTRE.x,
      y: p.pos.y,
      z: ARENA_CENTRE.z + 12,
    });
    mob.hostile = true;
    sim.addEntity(mob);
    mob.aggroTargetId = pid;
    face(p, mob);

    const metrics = new Map<number, CombatantMetrics>([[pid, freshMetrics(cfg.spec.key)]]);
    const handle = {
      pid,
      spec: cfg.spec,
      onCast: (ability: string) => bump(metrics.get(pid)!.castsByAbility, ability, 1),
    };
    let ticks = 0;
    const maxTicks = Math.round(maxSeconds / DT);
    for (; ticks < maxTicks && !mob.dead && !p.dead; ticks++) {
      driveFighter(sim, handle, mob.id);
      collect(sim, sim.tick(), metrics, [pid]);
    }
    const m = metrics.get(pid)!;
    m.hpFracEnd = Math.max(0, p.hp / p.maxHp);
    m.diedForReal = p.dead;
    const seconds = ticks * DT;
    return {
      killed: mob.dead,
      playerDied: p.dead,
      seconds,
      dps: seconds > 0 ? m.damageDone / seconds : 0,
      fighter: m,
    };
  } finally {
    releaseArenaWorld();
  }
}
