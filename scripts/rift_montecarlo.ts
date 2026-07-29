// Monte Carlo: RIFT ranks (C/B/A/S) against a standard five-man. The rift
// sibling of scripts/healing_montecarlo.ts (best-in-slot vs heroic dungeons)
// and scripts/sanctum_fresh_montecarlo.ts (fresh-capped vs normal dungeons),
// built for the 2026-07-26 rank recalibration onto the v0.30 dungeon ladder.
//
// Rank is the ONLY difficulty axis, so the GROUP is the constant and the RANK
// is the variable: every bench runs the same five-man shape at every rank, and
// what varies is gear tier, not party size. Audience per rank (decided
// 2026-07-26): C is for a freshly-capped level-20 group in quest greens and
// blues, exactly the normal Gravewyrm Sanctum audience; B, A and S are all
// benched at best-in-slot.
//
// Everything runs inside a REAL rift instance (sim.enterRift, walked down to
// the boss floor) rather than an arena spawn, because three rank behaviors only
// exist in-instance: capRiftNonLethalMechanicDamage (no mechanic may one-shot
// from full health), the rank mechanic budget (C=1 .. S=4 of a boss's kit), and
// the rank hazard gate. An arena bench would over-report every rank.
//
// Three benches:
//   A) intake: per-hit distribution and DTPS on an immortal-probe tank, for the
//      boss alone and for a real trash pack, both sides pinned to full HP so
//      the distribution is not censored by death or enrage
//   B) survival: real tank + real healer + a modeled group-dps drain fight the
//      boss for real. Reports TIME TO FIRST DEATH (the Gravebreaker failure
//      mode: nothing may kill before a heal can land), kill rate, kill time,
//      healer coverage as a percent of incoming, and healer time-to-OOM
//   C) clear time and the anti-solo line: walk an entire rift floor by floor
//      with the modeled group drain for a real end-to-end clear time, and read
//      a best-in-slot solo warrior's intake against his self-heal ceiling
//
// Run: npx tsx scripts/rift_montecarlo.ts [--runs N] [--quick] [--ranks C,B]
// Writes tmp/rift_mc/report.json and prints the digest tables.
//
// Two traps inherited from the sibling harnesses: bench kills must park
// respawnTimer at Infinity or mob/locomotion.ts revives the mob in place, and
// the harness plays perfectly, so it reads roughly 20-25% above live parses.

import { mkdirSync, writeFileSync } from 'node:fs';
import { MOBS } from '../src/sim/data';
import { RIFT_RANK_BASE_LEVEL, riftRankForBaseLevel } from '../src/sim/rift/ranks';
import { isSetPieceSeed } from '../src/sim/rift/rift_gen';
import type { RiftInstance } from '../src/sim/rift/types';
import { Sim } from '../src/sim/sim';
import { dist2d, type Entity, MELEE_RANGE, type RiftTier } from '../src/sim/types';
import {
  applyTankRaidBuffs,
  cast,
  face,
  HEALER_SPECS,
  healTick,
  round1,
  type Spec,
  summarize,
  TANK_SPEC,
} from './healing_montecarlo';
import { addTierPlayer, type KitTier } from './sanctum_fresh_montecarlo';

function must<T>(value: T | undefined | null, label = 'expected value'): T {
  if (value === undefined || value === null) throw new Error(`must: ${label} was missing`);
  return value;
}

/** summarize() over an empty sample returns zeros, which reads as a real
 * measurement (a 0s kill time, a 0s death time). Print those as n/a. */
function p50Text(stats: { p50: number; n: number }, suffix = ''): string {
  return stats.n === 0 ? 'n/a' : `${stats.p50}${suffix}`;
}

// ---------------------------------------------------------------- CLI / knobs

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const runsFlag = args.indexOf('--runs');
const RUNS = runsFlag >= 0 ? Number(args[runsFlag + 1]) : QUICK ? 2 : 8;
const ranksFlag = args.indexOf('--ranks');
const RANKS: RiftTier[] = (
  ranksFlag >= 0 ? args[ranksFlag + 1].split(',') : ['C', 'B', 'A', 'S']
) as RiftTier[];
const INTAKE_SECONDS = QUICK ? 20 : 60;
const FIGHT_CAP_SECONDS = QUICK ? 90 : 300;
const CLEAR_CAP_SECONDS = QUICK ? 300 : 1500;
const BASE_SEED = 616100;

// The four rift seeds benched, one per run index. Set-piece seeds are skipped:
// the authored citadel is C-only content, so including it would make the ranks
// non-comparable (the whole point is that only the rank varies).
function benchSeeds(count: number): number[] {
  const out: number[] = [];
  for (let s = 101; out.length < count; s++) {
    if (!isSetPieceSeed(s)) out.push(s);
  }
  return out;
}

// Four best-in-slot damage dealers focus-killing beside the tank. A BiS fire
// mage sustains ~233 dps in the healing MC raid bench; four of them is the
// standard five-man drain this bench models. The fresh-capped tier lands well
// under half that (the sanctum fresh bench's per-head figure).
const GROUP_DPS_BIS = 900;
const GROUP_DPS_FRESH = 320;
// The strongest solo archetype's sustained self-heal, the same line the normal
// Sanctum retune is guarded against (tests/gravewyrm_normal_tuning.test.ts).
const SOLO_SELF_HEAL_CEILING = 140;

// Gear tier per rank: the decided audience statement.
const TIER_FOR_RANK: Record<RiftTier, KitTier> = { C: 'fresh', B: 'bis', A: 'bis', S: 'bis' };
const GROUP_DPS_FOR_TIER: Record<KitTier, number> = {
  fresh: GROUP_DPS_FRESH,
  bis: GROUP_DPS_BIS,
};

// Burst ceiling and sustain ceiling: the two healers that bracket the class
// range in the healing MC bench A.
const BENCH_HEALERS: Spec[] = [
  must(
    HEALER_SPECS.find((s) => s.key === 'holy_priest'),
    'holy_priest spec',
  ),
  must(
    HEALER_SPECS.find((s) => s.key === 'restoration_shaman'),
    'restoration_shaman spec',
  ),
];

// --------------------------------------------------------------- sim helpers

function activeInstance(sim: Sim): RiftInstance {
  return must(
    sim.riftInstances.find((i) => i.partyKey !== null),
    'active rift instance',
  );
}

function keepAlive(entities: Entity[]): void {
  for (const e of entities) {
    if (!e.dead) e.hp = e.maxHp;
  }
}

/** Kill everything on the floor except the ids in `keep`, parking the in-place
 * respawn (mob/locomotion.ts revives a dead mob when respawnTimer runs out). */
function cullFloor(sim: Sim, inst: RiftInstance, keep: Set<number>): void {
  for (const id of inst.mobIds) {
    if (keep.has(id)) continue;
    const mob = sim.entities.get(id);
    if (!mob || mob.dead) continue;
    mob.hp = 0;
    mob.dead = true;
    mob.respawnTimer = Infinity;
  }
}

// The ability label rift/runs.ts stamps on a death-zone detonation. Its amount
// is `p.hp + p.maxHp` by construction: a guaranteed kill, deliberately outside
// capRiftNonLethalMechanicDamage. It is a dodge check, not tank pressure, so
// the benches classify it separately instead of letting a scripted kill land in
// a damage-intake distribution (it read as a 6,444 "hit" on a 3,222 pool).
const DEATH_ZONE_ABILITY = 'Death Zone';

/** Pin a mob onto the tank without resetting its swing state machine. The AI
 * state has to follow RANGE, not just aggro: pinning 'attack' unconditionally
 * leaves a boss standing still when the tank steps out of a death zone, so it
 * never closes and the cell reads a collapsed dtps (A read 153, below B's 317,
 * purely from this). Mirrors the same choice in Sim.spawnBossAdds. */
function pinThreat(mob: Entity, tank: Entity): void {
  mob.aggroTargetId = tank.id;
  mob.threat.set(tank.id, 1e9);
  mob.inCombat = true;
  const chasing = dist2d(mob.pos, tank.pos) > MELEE_RANGE;
  mob.aiState = chasing ? 'chase' : 'attack';
}

function pull(sim: Sim, mob: Entity, tank: Entity): void {
  // Stand the tank in melee reach of the mob, not the other way round: the
  // rift floor's colliders own where a mob may legally stand.
  tank.pos = { x: mob.pos.x, y: mob.pos.y, z: mob.pos.z - (MELEE_RANGE - 1) };
  tank.prevPos = { ...tank.pos };
  face(tank, mob);
  pinThreat(mob, tank);
  sim.startAutoAttack(tank.id);
}

/** Step anyone standing in a live death zone out of it, at player run speed.
 *
 * Rift death zones are GUARANTEED kills by design (flat hp + maxHp, no
 * multiplier, deliberately outside capRiftNonLethalMechanicDamage) and are
 * telegraphed with a cast bar and a radius-true ground ring: the intended play
 * is to walk out, and every zone is dodgeable from its centre at run speed 7
 * (pinned by tests/rift_rank_tuning.test.ts). A probe that stands in one is not
 * measuring difficulty, it is measuring a scripted death: an A-rank cell read a
 * 6,444 "hit" on a 3,222 pool (hp + maxHp) and 129 of its 303 dtps was the zone.
 * So the benches dodge, exactly as the sanctum harness walks out of Grave
 * Inferno, and what is left is the sustained pressure this retune is about.
 * Returns true if anyone had to move (the boss fight loses uptime for it).
 */
function dodgeDeathZones(inst: RiftInstance, movers: Entity[]): boolean {
  if (inst.bossDeathZones.length === 0) return false;
  let moved = false;
  for (const e of movers) {
    if (e.dead) continue;
    for (const zone of inst.bossDeathZones) {
      const dx = e.pos.x - zone.x;
      const dz = e.pos.z - zone.z;
      const d = Math.hypot(dx, dz);
      const safe = zone.radius + 2;
      if (d >= safe) continue;
      // One tick of run speed toward the nearest edge (7 yd/s at 20 Hz).
      const out = Math.min(safe, d + 7 / 20);
      const scale = out / Math.max(0.5, d);
      e.pos = { x: zone.x + dx * scale, y: e.pos.y, z: zone.z + dz * scale };
      e.prevPos = { ...e.pos };
      moved = true;
      break;
    }
  }
  return moved;
}

/** Bring a party into a rift and walk it down to the boss floor, keeping every
 * member alive on the way (the descent is not what is being measured). */
function descendToBoss(sim: Sim, seed: number, baseLevel: number, party: Entity[]): RiftInstance {
  for (const member of party) sim.enterRift(seed, baseLevel, member.id);
  const inst = activeInstance(sim);
  for (let guard = 0; guard < 12 && inst.floorIndex < inst.floorCount - 1; guard++) {
    cullFloor(sim, inst, new Set(inst.bossId === null ? [] : [inst.bossId]));
    inst.litPylons = new Set(inst.pylonIds);
    inst.puzzleSolved = true;
    for (let t = 0; t < 25; t++) {
      keepAlive(party);
      sim.tick();
    }
    if (inst.descentId === null) break;
    const descent = must(sim.entities.get(inst.descentId), 'descent');
    for (const member of party) {
      member.pos = { ...descent.pos };
      member.prevPos = { ...member.pos };
    }
    keepAlive(party);
    sim.tick();
  }
  if (inst.floorIndex !== inst.floorCount - 1) {
    throw new Error(`descent stalled on floor ${inst.floorIndex} of ${inst.floorCount}`);
  }
  return inst;
}

function setupTank(sim: Sim, tier: KitTier): Entity {
  const pid = addTierPlayer(sim, TANK_SPEC, 'Tank', tier);
  const tank = must(sim.entities.get(pid), 'tank entity');
  for (const ability of TANK_SPEC.setup ?? []) cast(sim, pid, pid, ability);
  sim.tick();
  sim.tick();
  if (tier === 'bis') applyTankRaidBuffs(sim, pid);
  tank.hp = tank.maxHp;
  return tank;
}

// --------------------------------------------------------------- encounters

type Shape = 'boss' | 'trash_pack';

/** The mobs a shape fights on the boss floor: the boss alone, or the floor's
 * own trash pack (which is the generator's real pack, not a synthetic one). */
function shapeTargets(sim: Sim, inst: RiftInstance, shape: Shape): Entity[] {
  const alive = inst.mobIds
    .map((id) => sim.entities.get(id))
    .filter((e): e is Entity => !!e && !e.dead);
  if (shape === 'boss') return alive.filter((e) => e.id === inst.bossId);
  return alive.filter((e) => e.id !== inst.bossId).slice(0, 3);
}

// ------------------------------------------------------------------ bench A

interface IntakeRun {
  dtps: number;
  hits: number[];
  crits: number;
  avoided: number;
  byAbility: Record<string, { count: number; total: number; max: number }>;
  zoneDodgeSeconds: number;
  zoneHits: number;
  tankMaxHp: number;
  tankArmor: number;
  targets: string[];
}

function runIntake(tier: KitTier, baseLevel: number, shape: Shape, seed: number): IntakeRun {
  const sim = new Sim({ seed: BASE_SEED + seed, playerClass: 'warrior', noPlayer: true });
  const tank = setupTank(sim, tier);
  const inst = descendToBoss(sim, seed, baseLevel, [tank]);
  const targets = shapeTargets(sim, inst, shape);
  if (targets.length === 0) throw new Error(`no targets for shape ${shape}`);
  cullFloor(sim, inst, new Set(targets.map((m) => m.id)));
  pull(sim, targets[0], tank);
  for (const mob of targets) pinThreat(mob, tank);

  const hits: number[] = [];
  const byAbility: IntakeRun['byAbility'] = {};
  let crits = 0;
  let avoided = 0;
  let zoneDodges = 0;
  let zoneHits = 0;
  for (let tick = 0; tick < INTAKE_SECONDS * 20; tick++) {
    // Immortal probe: the full, uncensored distribution. Resurrecting matters
    // as much as topping up HP, because a death zone deals `hp + maxHp` in one
    // hit and flags the probe dead; a probe that stays dead drops combat and
    // the boss stops swinging for the rest of the run (that alone halved the
    // A and S melee counts, 51 landed swings against B's 118).
    if (tank.dead) {
      tank.dead = false;
      tank.ghost = false;
      // Death strips auras, including the raid buffs the bis tank is measured
      // with, so the pool would quietly drop 3,222 to 2,912 mid-run.
      if (tier === 'bis') applyTankRaidBuffs(sim, tank.id);
    }
    tank.hp = tank.maxHp;
    // Play the telegraph. While ANY zone is live, keep walking out and stay
    // out: a zone is cast on the tank, who is standing in melee, so re-closing
    // to melee before it detonates walks straight back into it (that
    // oscillation was reading a scripted 6,444 death as tank intake). The
    // uptime lost to standing off is real, and is what the dodge costs.
    if (inst.bossDeathZones.length > 0) {
      if (dodgeDeathZones(inst, [tank])) zoneDodges++;
    } else if (!targets[0].dead) {
      pull(sim, targets[0], tank);
    }
    for (const mob of targets) {
      if (mob.dead) continue;
      mob.hp = mob.maxHp; // no enrage, no summon thresholds, no death
      pinThreat(mob, tank);
    }
    sim.startAutoAttack(tank.id);
    for (const event of sim.tick()) {
      if (event.type !== 'damage' || event.targetId !== tank.id) continue;
      if (event.kind !== 'hit') {
        avoided++;
        continue;
      }
      if (event.ability === DEATH_ZONE_ABILITY) {
        // A telegraph the probe failed to clear (it can be cornered against a
        // wall by the collider push-out). Counted, never averaged in.
        zoneHits++;
        continue;
      }
      hits.push(event.amount);
      if (event.crit) crits++;
      const label = event.ability ?? 'melee';
      byAbility[label] ??= { count: 0, total: 0, max: 0 };
      const slot = byAbility[label];
      slot.count++;
      slot.total += event.amount;
      slot.max = Math.max(slot.max, event.amount);
    }
  }
  return {
    dtps: hits.reduce((a, b) => a + b, 0) / INTAKE_SECONDS,
    hits,
    crits,
    avoided,
    byAbility,
    zoneDodgeSeconds: round1(zoneDodges / 20),
    zoneHits,
    tankMaxHp: tank.maxHp,
    tankArmor: tank.stats.armor,
    targets: targets.map((m) => m.templateId),
  };
}

// ------------------------------------------------------------------ bench B

interface SurvivalRun {
  killed: boolean;
  killSeconds: number | null;
  firstDeathSeconds: number | null;
  firstDeathCause: 'pressure' | 'zone' | null;
  healerOomSeconds: number | null;
  minTankHpFrac: number;
  incoming: number;
  healed: number;
  zoneDodgeSeconds: number;
  bossHpFracAtEnd: number;
}

function runSurvival(
  tier: KitTier,
  baseLevel: number,
  healerSpec: Spec,
  seed: number,
): SurvivalRun {
  const sim = new Sim({ seed: BASE_SEED + seed, playerClass: 'warrior', noPlayer: true });
  const tank = setupTank(sim, tier);
  const healerPid = addTierPlayer(sim, healerSpec, 'Healer', tier);
  const healer = must(sim.entities.get(healerPid), 'healer entity');
  sim.partyInvite(healerPid, tank.id);
  sim.partyAccept(healerPid);
  const party = [tank, healer];
  const inst = descendToBoss(sim, seed, baseLevel, party);
  const boss = must(sim.entities.get(must(inst.bossId, 'bossId')), 'boss');
  cullFloor(sim, inst, new Set([boss.id]));
  // The healer stands at the back, out of melee but inside heal range.
  healer.pos = { x: boss.pos.x + 18, y: boss.pos.y, z: boss.pos.z - 18 };
  healer.prevPos = { ...healer.pos };
  pull(sim, boss, tank);

  const groupDps = GROUP_DPS_FOR_TIER[tier];
  let firstDeath: number | null = null;
  let killed: number | null = null;
  let healerOom: number | null = null;
  let minTankHpFrac = 1;
  let incoming = 0;
  let healed = 0;
  let zoneDodges = 0;
  let lastZoneHitTick = -1;
  let firstDeathCause: 'pressure' | 'zone' | null = null;
  for (let tick = 0; tick < FIGHT_CAP_SECONDS * 20; tick++) {
    if (boss.dead) {
      killed = tick / 20;
      break;
    }
    // The modeled dps drain focuses the boss; summoned adds are left for the
    // real fight to press with (they are wave pressure on the healer).
    boss.hp -= groupDps / 20;
    if (boss.hp <= 0) {
      boss.hp = 0;
      boss.dead = true;
      boss.respawnTimer = Infinity;
      killed = tick / 20;
      break;
    }
    for (const id of inst.mobIds) {
      const mob = sim.entities.get(id);
      if (mob && !mob.dead) pinThreat(mob, tank);
    }
    // Play the telegraph: both members walk out and STAY out until the zone
    // detonates, then the tank re-closes. Standing in one is a scripted death,
    // not sustained pressure, and it is not what this bench measures.
    if (inst.bossDeathZones.length > 0) {
      if (dodgeDeathZones(inst, [tank, healer])) zoneDodges++;
    } else if (!tank.dead && !boss.dead) {
      pull(sim, boss, tank);
    }
    if (!tank.dead) sim.startAutoAttack(tank.id);
    if (!healer.dead && tank.hp < tank.maxHp) {
      healTick(sim, healerPid, tank, healerSpec, healerSpec.healPriority ?? []);
    }
    if (healerOom === null && !healer.castingAbility && healer.resource < 25) {
      healerOom = tick / 20;
    }
    for (const event of sim.tick()) {
      if (event.type === 'damage' && (event.targetId === tank.id || event.targetId === healerPid)) {
        if (event.ability === DEATH_ZONE_ABILITY) {
          // A guaranteed-kill telegraph, not something a healer could have
          // covered: kept out of `incoming` so coverage stays a real ratio.
          lastZoneHitTick = tick;
        } else if (event.kind === 'hit') {
          incoming += event.amount;
        }
      } else if (event.type === 'heal2' && event.sourceId === healerPid) {
        // heal2 carries sourceId; the plain `heal` event does not, so healer
        // coverage would read zero off it (the healing MC hits the same trap).
        healed += event.amount;
      } else if (event.type === 'death' && firstDeath === null) {
        if (event.entityId === tank.id || event.entityId === healerPid) {
          firstDeath = tick / 20;
          firstDeathCause = lastZoneHitTick === tick ? 'zone' : 'pressure';
        }
      }
    }
    minTankHpFrac = Math.min(minTankHpFrac, Math.max(0, tank.hp) / tank.maxHp);
    // A dead tank is a wipe in a five-man: the modeled drain must not keep
    // "killing" the boss off a corpse, or a lost fight reports as a kill.
    if (tank.dead) break;
  }
  return {
    killed: killed !== null,
    killSeconds: killed,
    firstDeathSeconds: firstDeath,
    firstDeathCause,
    healerOomSeconds: healerOom,
    minTankHpFrac: round1(minTankHpFrac * 100) / 100,
    incoming,
    healed,
    zoneDodgeSeconds: round1(zoneDodges / 20),
    bossHpFracAtEnd: Math.max(0, boss.hp) / Math.max(1, boss.maxHp),
  };
}

// ------------------------------------------------------------------ bench C

interface ClearRun {
  cleared: boolean;
  clearSeconds: number | null;
  floors: number;
  mobs: number;
  trashSeconds: number;
  bossSeconds: number;
}

/** Walk a whole rift with the modeled group drain doing the killing and the
 * real tank taking the damage: an end-to-end clear time per rank. */
function runClear(tier: KitTier, baseLevel: number, seed: number): ClearRun {
  const sim = new Sim({ seed: BASE_SEED + seed, playerClass: 'warrior', noPlayer: true });
  const tank = setupTank(sim, tier);
  sim.enterRift(seed, baseLevel, tank.id);
  const inst = activeInstance(sim);
  const groupDps = GROUP_DPS_FOR_TIER[tier];
  let mobs = 0;
  let trashTicks = 0;
  let bossTicks = 0;
  let cleared: number | null = null;
  const floors = inst.floorCount;
  for (let tick = 0; tick < CLEAR_CAP_SECONDS * 20; tick++) {
    const alive = inst.mobIds
      .map((id) => sim.entities.get(id))
      .filter((e): e is Entity => !!e && !e.dead);
    if (alive.length === 0) {
      if (inst.floorIndex >= inst.floorCount - 1) {
        cleared = tick / 20;
        break;
      }
      inst.litPylons = new Set(inst.pylonIds);
      inst.puzzleSolved = true;
      tank.hp = tank.maxHp;
      sim.tick();
      if (inst.descentId !== null) {
        const descent = must(sim.entities.get(inst.descentId), 'descent');
        tank.pos = { ...descent.pos };
        tank.prevPos = { ...tank.pos };
        sim.tick();
      }
      continue;
    }
    // Focus the boss last: trash first, exactly as a group clears a floor.
    const target = alive.find((m) => m.id !== inst.bossId) ?? alive[0];
    if (target.id === inst.bossId) bossTicks++;
    else trashTicks++;
    target.hp -= groupDps / 20;
    if (target.hp <= 0) {
      target.hp = 0;
      target.dead = true;
      target.respawnTimer = Infinity;
      mobs++;
    }
    for (const mob of alive) pinThreat(mob, tank);
    // The clear bench measures TIME, not survival (bench B owns survival), so
    // the tank is immortal here and never stalls the walk on a death.
    tank.hp = tank.maxHp;
    sim.startAutoAttack(tank.id);
    sim.tick();
  }
  return {
    cleared: cleared !== null,
    clearSeconds: cleared,
    floors,
    mobs,
    trashSeconds: round1(trashTicks / 20),
    bossSeconds: round1(bossTicks / 20),
  };
}

// -------------------------------------------------------------------- main

function main(): void {
  const startedAt = Date.now();
  const seeds = benchSeeds(RUNS);
  console.log(
    `rift monte carlo: ranks=${RANKS.join(',')} runs=${RUNS} intake=${INTAKE_SECONDS}s ` +
      `fightCap=${FIGHT_CAP_SECONDS}s seeds=${seeds.join(',')}`,
  );

  const intake: Record<string, Record<string, unknown>> = {};
  const survival: Record<string, Record<string, unknown>> = {};
  const clear: Record<string, Record<string, unknown>> = {};
  const solo: Record<string, Record<string, unknown>> = {};

  for (const rank of RANKS) {
    const baseLevel = RIFT_RANK_BASE_LEVEL[rank];
    const tier = TIER_FOR_RANK[rank];
    if (riftRankForBaseLevel(baseLevel) !== rank) {
      throw new Error(`baseLevel ${baseLevel} does not encode rank ${rank}`);
    }

    // Bench A: intake, both shapes.
    for (const shape of ['boss', 'trash_pack'] as Shape[]) {
      const runs = seeds.map((s) => runIntake(tier, baseLevel, shape, s));
      const pool = runs[0].tankMaxHp;
      const allHits = runs.flatMap((r) => r.hits);
      const hitStats = summarize(allHits);
      const maxHit = allHits.length ? Math.max(...allHits) : 0;
      const dtps = summarize(runs.map((r) => r.dtps));
      const swings = runs.reduce((a, r) => a + r.hits.length + r.avoided, 0);
      const avoidedPct = round1(
        (100 * runs.reduce((a, r) => a + r.avoided, 0)) / Math.max(1, swings),
      );
      // Split the auto-attack line (what the rank floors are calibrated on)
      // from the mechanic tax (aoePulse and friends land unmitigated). Perfect
      // play dodges some of the second number; none of the first. Note the two
      // are on different statistics: `dtps` is a full p10/p50/p90 summary over
      // runs, `meleeDtps` is a MEAN, so they are not subtractable per run.
      const byAbility: Record<string, { count: number; mean: number; max: number }> = {};
      for (const run of runs) {
        for (const [label, slot] of Object.entries(run.byAbility)) {
          byAbility[label] ??= { count: 0, mean: 0, max: 0 };
          const agg = byAbility[label];
          agg.count += slot.count;
          agg.mean += slot.total;
          agg.max = Math.max(agg.max, slot.max);
        }
      }
      const meleeTotal = runs.reduce((a, r) => a + (r.byAbility.melee?.total ?? 0), 0);
      const meleeDtps = round1(meleeTotal / (INTAKE_SECONDS * runs.length));
      for (const agg of Object.values(byAbility))
        agg.mean = round1(agg.mean / Math.max(1, agg.count));
      intake[`${rank}__${shape}`] = {
        tier,
        pool,
        tankArmor: runs[0].tankArmor,
        targets: [...new Set(runs.flatMap((r) => r.targets))],
        hit: hitStats,
        maxHit,
        meanHitPctOfPool: round1((100 * hitStats.mean) / pool),
        maxHitPctOfPool: round1((100 * maxHit) / pool),
        dtps,
        meleeDtps,
        mechanicDtps: round1(dtps.mean - meleeDtps),
        byAbility,
        avoidedPct,
        crits: runs.reduce((a, r) => a + r.crits, 0),
        // Guaranteed-kill telegraphs the probe failed to clear, and the uptime
        // it spent walking out. Excluded from every number above.
        zoneHits: runs.reduce((a, r) => a + r.zoneHits, 0),
        zoneDodgeSeconds: summarize(runs.map((r) => r.zoneDodgeSeconds)),
      };
      console.log(
        `A ${rank} ${shape.padEnd(11)} ${tier.padEnd(5)} pool ${String(pool).padStart(4)} ` +
          `hit p50 ${String(hitStats.p50).padStart(4)} (${round1((100 * hitStats.p50) / pool)}% pool) ` +
          `max ${String(maxHit).padStart(4)} (${round1((100 * maxHit) / pool)}%) ` +
          `dtps p50 ${dtps.p50.toFixed(0).padStart(4)} (melee mean ${meleeDtps.toFixed(0)}) avoid ${avoidedPct}%`,
      );
    }

    // Bench B: survival vs the boss, one cell per healer.
    for (const healerSpec of BENCH_HEALERS) {
      const runs = seeds.map((s) => runSurvival(tier, baseLevel, healerSpec, s));
      const killedPct = round1((100 * runs.filter((r) => r.killed).length) / runs.length);
      const deaths = runs.filter((r) => r.firstDeathSeconds !== null);
      const deathTimes = summarize(deaths.map((r) => must(r.firstDeathSeconds, 'firstDeath')));
      const killTimes = summarize(
        runs.filter((r) => r.killSeconds !== null).map((r) => must(r.killSeconds, 'kill')),
      );
      const coverage = summarize(runs.map((r) => (100 * r.healed) / Math.max(1, r.incoming)));
      const oom = runs.filter((r) => r.healerOomSeconds !== null);
      survival[`${rank}__${healerSpec.key}`] = {
        tier,
        killedPct,
        deaths: deaths.length,
        firstDeathSeconds: deathTimes,
        killSeconds: killTimes,
        healerCoveragePct: coverage,
        healerOomRuns: oom.length,
        healerOomSeconds: summarize(oom.map((r) => must(r.healerOomSeconds, 'oom'))),
        // Sustained pressure killed the tank, or a missed telegraph did. Only
        // the first is what this recalibration moved.
        deathsFromPressure: runs.filter((r) => r.firstDeathCause === 'pressure').length,
        deathsFromZone: runs.filter((r) => r.firstDeathCause === 'zone').length,
        zoneDodgeSeconds: summarize(runs.map((r) => r.zoneDodgeSeconds)),
        minTankHpPct: summarize(runs.map((r) => r.minTankHpFrac * 100)),
        bossHpPctAtEnd: summarize(runs.map((r) => r.bossHpFracAtEnd * 100)),
      };
      console.log(
        `B ${rank} ${healerSpec.key.padEnd(20)} killed ${String(killedPct).padStart(5)}% ` +
          `deaths ${deaths.length}/${runs.length} firstDeath p50 ${p50Text(deathTimes, 's')} ` +
          `kill p50 ${p50Text(killTimes, 's')} coverage p50 ${coverage.p50}% oom ${oom.length}/${runs.length} ` +
          `(pressure ${runs.filter((r) => r.firstDeathCause === 'pressure').length}, zone ${runs.filter((r) => r.firstDeathCause === 'zone').length})`,
      );
    }

    // Bench C: end-to-end clear time, plus the solo line.
    const clears = seeds.map((s) => runClear(tier, baseLevel, s));
    const clearTimes = summarize(
      clears.filter((c) => c.cleared).map((c) => must(c.clearSeconds, 'clear')),
    );
    clear[rank] = {
      tier,
      clearedPct: round1((100 * clears.filter((c) => c.cleared).length) / clears.length),
      clearSeconds: clearTimes,
      floors: summarize(clears.map((c) => c.floors)),
      mobs: summarize(clears.map((c) => c.mobs)),
      trashSeconds: summarize(clears.map((c) => c.trashSeconds)),
      bossSeconds: summarize(clears.map((c) => c.bossSeconds)),
    };
    console.log(
      `C ${rank} clear p50 ${p50Text(clearTimes, 's')} (${round1(clearTimes.p50 / 60)}min) ` +
        `floors p50 ${summarize(clears.map((c) => c.floors)).p50} ` +
        `mobs p50 ${summarize(clears.map((c) => c.mobs)).p50} ` +
        `trash ${summarize(clears.map((c) => c.trashSeconds)).p50}s ` +
        `boss ${summarize(clears.map((c) => c.bossSeconds)).p50}s`,
    );

    // Anti-solo: a best-in-slot warrior's intake against his self-heal ceiling,
    // for BOTH shapes. Rifts must never be tuned to become solo content at any
    // rank (design constraint), so this reads at 'bis' even for C, and it reads
    // the trash pack as well as the boss: a rift is mostly trash, so a boss a
    // lone player could out-sustain does not make the rift soloable if the
    // packs in front of it cannot be.
    for (const shape of ['boss', 'trash_pack'] as Shape[]) {
      const soloRuns = seeds.map((s) => runIntake('bis', baseLevel, shape, s));
      const soloDtps = summarize(soloRuns.map((r) => r.dtps));
      solo[`${rank}__${shape}`] = {
        pool: soloRuns[0].tankMaxHp,
        dtps: soloDtps,
        selfHealCeiling: SOLO_SELF_HEAL_CEILING,
        soloDies: soloDtps.p10 > SOLO_SELF_HEAL_CEILING,
      };
      console.log(
        `S ${rank} ${shape.padEnd(11)} bis-warrior solo dtps p50 ${soloDtps.p50.toFixed(0)} ` +
          `(p10 ${soloDtps.p10.toFixed(0)}) vs ${SOLO_SELF_HEAL_CEILING} hps self-heal -> ` +
          `${soloDtps.p10 > SOLO_SELF_HEAL_CEILING ? 'solo still dies' : 'out-sustained'}`,
      );
    }
  }

  const report = {
    generated: new Date().toISOString(),
    config: {
      ranks: RANKS,
      runs: RUNS,
      seeds,
      intakeSeconds: INTAKE_SECONDS,
      fightCapSeconds: FIGHT_CAP_SECONDS,
      clearCapSeconds: CLEAR_CAP_SECONDS,
      groupDpsBis: GROUP_DPS_BIS,
      groupDpsFresh: GROUP_DPS_FRESH,
      tierForRank: TIER_FOR_RANK,
      baseSeed: BASE_SEED,
    },
    bossTemplates: Object.fromEntries(
      Object.entries(MOBS)
        .filter(([id, t]) => id.startsWith('rift_boss_') && t.boss)
        .map(([id, t]) => [id, { hpBase: t.hpBase, dmgBase: t.dmgBase }]),
    ),
    intake,
    survival,
    clear,
    solo,
  };
  mkdirSync('tmp/rift_mc', { recursive: true });
  writeFileSync('tmp/rift_mc/report.json', JSON.stringify(report, null, 2));
  console.log(`wrote tmp/rift_mc/report.json in ${Math.round((Date.now() - startedAt) / 1000)}s`);
}

if (process.argv[1]?.includes('rift_montecarlo.ts')) main();
