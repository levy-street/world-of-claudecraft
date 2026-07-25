// Nythraxis raid healing bench (bench D of the healing monte carlo): runs the
// REAL encounter through the real raid path (attune, raid of 10, difficulty
// claim, enterDungeon), normal AND heroic, across seeds, sweeping healer
// count. Mechanics are PLAYED, not ignored (ported from nythraxis_matrix.ts):
// Soul Rend marks stack, Deathless Rage ward stones get channeled, the
// off-tank secures add waves, DPS focus the CC-able priest add first.
//
// Run: npx tsx scripts/healing_montecarlo_raid.ts [--runs N] [--quick]
// Writes tmp/healing_mc/raid_report.json and prints the digest.

import { mkdirSync, writeFileSync } from 'node:fs';

// Bench-script only: throws with a clear message rather than silently producing
// undefined. The sim contract guarantees these lookups succeed; if they do not
// the run is already broken and an early throw beats a cryptic downstream error.
function must<T>(value: T | undefined, label = 'expected value'): T {
  if (value === undefined) throw new Error(`must: ${label} was undefined`);
  return value;
}

import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { dist2d, type Entity, MELEE_RANGE } from '../src/sim/types';
import {
  addSpecPlayer,
  applyTankRaidBuffs,
  auraActive,
  cast,
  face,
  HEALER_SPECS,
  healTick,
  round1,
  type Spec,
  summarize,
  TANK_SPEC,
  teleport,
} from './healing_montecarlo';

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const runsFlag = args.indexOf('--runs');
const RUNS = runsFlag >= 0 ? Number(args[runsFlag + 1]) : QUICK ? 2 : 8;
const CAP_SECONDS = QUICK ? 90 : 300;
const BASE_SEED = 424200;

const RAID_DUNGEON = 'nythraxis_boss_arena';
const BOSS_ID = 'nythraxis_scourge_of_thornpeak';
const ADD_IDS = new Set([
  'nythraxis_skeleton_warrior',
  'nythraxis_heroic_warrior_add',
  'nythraxis_heroic_priest_add',
  'nythraxis_heroic_rogue_add',
]);
const PRIEST_ADD_ID = 'nythraxis_heroic_priest_add';

const OFFTANK_SPEC: Spec = {
  key: 'protection_paladin',
  cls: 'paladin',
  kind: 'tank',
  talents: {
    spec: 'protection',
    rows: {
      5: 'pal_r5_blessed_momentum',
      8: 'pal_r8_consecrated_ground',
      11: 'pal_r11_guardians_favor',
      14: 'pal_r14_righteous_cause',
      17: 'pal_r17_ardent_defender',
      20: 'pal_r20_avenging_wrath',
    },
  },
  setup: ['righteous_fury', 'devotion_aura', 'seal_of_righteousness'],
};

const MAGE_SPEC: Spec = {
  key: 'fire_mage',
  cls: 'mage',
  kind: 'caster',
  // A REAL build (the empty-rows version measured ~130 dps vs ~233 played
  // properly: Overload proc, Pyroblast, Evocation at low mana, no DoT clip).
  talents: {
    spec: 'fire',
    rows: {
      5: 'mag_r5_ice_floes',
      8: 'mag_r8_temporal_rift',
      11: 'mag_r11_twin_nova',
      14: 'mag_r14_overload',
      17: 'mag_r17_convergence',
      20: 'mag_r20_evocation',
    },
  },
};

// Rotations (bench D only; the five-man benches keep the tank passive).
const TANK_ROTATION = ['battle_shout', 'sunder_armor', 'shield_slam', 'thunder_clap'];
const OFFTANK_ROTATION = ['consecration', 'judgement'];
const MAGE_ROTATION = ['fire_blast', 'pyroblast', 'fireball', 'scorch'];
const SELF_BUFFS = new Set([
  'battle_shout',
  'defensive_stance',
  'righteous_fury',
  'devotion_aura',
  'seal_of_righteousness',
  'arcane_intellect',
]);

function shouldTry(caster: Entity, target: Entity, ability: string): boolean {
  if (SELF_BUFFS.has(ability) && auraActive(caster, ability)) return false;
  // Never clip a rolling Fireball DoT with a recast; scorch fills instead.
  if (ability === 'fireball' && auraActive(target, 'fireball', caster.id)) return false;
  if (ability === 'sunder_armor') {
    const stacks = target.auras.find((a) => a.kind === 'sunder')?.stacks ?? 0;
    if (stacks >= 5) return false;
  }
  if (ability === 'judgement' && !caster.auras.some((a) => a.kind === 'imbue')) return false;
  return true;
}

type RaidRun = {
  outcome: 'boss_dead' | 'wipe' | 'timecap';
  seconds: number;
  bossHpPct: number;
  playerDeaths: { spec: string; at: number }[];
  healerHps: number[];
  healerOom: (number | null)[];
  tankDtps: number;
  raidDtps: number;
  deathlessCasts: number;
  deathlessFailed: number;
};

function livingAdds(sim: Sim): Entity[] {
  return [...sim.entities.values()].filter(
    (e) => e.kind === 'mob' && ADD_IDS.has(e.templateId ?? '') && !e.dead,
  );
}

function runRaid(difficulty: 'normal' | 'heroic', healerSpecs: Spec[], seed: number): RaidRun {
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true });
  const specs: Spec[] = [
    TANK_SPEC,
    OFFTANK_SPEC,
    ...healerSpecs,
    ...Array.from({ length: 10 - 2 - healerSpecs.length }, () => MAGE_SPEC),
  ];
  const pids = specs.map((spec, i) => addSpecPlayer(sim, spec, `${spec.key}_${i}`));
  for (const pid of pids)
    must(sim.players.get(pid), `player ${pid}`).questsDone.add('q_nythraxis_bound_guardian');
  for (const pid of pids.slice(1)) {
    sim.partyInvite(pid, pids[0]);
    sim.partyAccept(pid);
  }
  sim.convertPartyToRaid(pids[0]);
  if (difficulty === 'heroic') sim.setDungeonDifficulty('heroic', pids[0]);
  sim.enterDungeon(RAID_DUNGEON, pids[0]);
  const leader = must(sim.entities.get(pids[0]), `leader entity ${pids[0]}`);
  const slot = sim.instanceSlotAt(leader.pos);
  const origin = instanceOrigin(DUNGEONS[RAID_DUNGEON].index, slot ?? 0);
  const boss = [...sim.entities.values()].find(
    (e) => e.kind === 'mob' && e.templateId === BOSS_ID && !e.dead,
  );
  if (!boss) throw new Error('boss not found after enterDungeon');

  const mtPid = pids[0];
  const otPid = pids[1];
  const healerPids = pids.slice(2, 2 + healerSpecs.length);
  const dpsPids = pids.slice(2 + healerSpecs.length);

  const homePos = new Map<number, { x: number; z: number }>();
  pids.forEach((pid, i) => {
    const spec = specs[i];
    const isTank = pid === mtPid;
    const range = isTank ? MELEE_RANGE - 1.4 : spec.kind === 'healer' ? 24 : 18;
    const angle = (Math.PI * 2 * i) / 10;
    const pos =
      pid === mtPid
        ? { x: boss.pos.x, z: boss.pos.z - (MELEE_RANGE - 1.4) }
        : { x: boss.pos.x + Math.sin(angle) * range, z: boss.pos.z - Math.cos(angle) * range };
    homePos.set(pid, pos);
    teleport(sim, pid, pos.x, pos.z);
    const e = must(sim.entities.get(pid), `player entity ${pid}`);
    e.targetId = boss.id;
    face(e, boss);
    for (const ability of specs[i].setup ?? []) cast(sim, pid, pid, ability);
    if (spec.key === 'fire_mage') cast(sim, pid, pid, 'arcane_intellect');
    if (spec.key === TANK_SPEC.key) cast(sim, pid, pid, 'defensive_stance');
  });

  applyTankRaidBuffs(sim, mtPid);
  applyTankRaidBuffs(sim, otPid);

  boss.inCombat = true;
  boss.aiState = 'attack';
  boss.aggroTargetId = mtPid;
  boss.threat.set(mtPid, 5000);

  let activeTankPid = mtPid;
  const deaths: RaidRun['playerDeaths'] = [];
  const healerHealing = healerPids.map(() => 0);
  const healerOom: (number | null)[] = healerPids.map(() => null);
  let tankDamage = 0;
  let tankAliveSeconds = 0;
  let raidDamage = 0;
  let deathlessCasts = 0;
  let deathlessFailed = 0;
  let deathlessHits = 0;
  let previousDeathlessRemaining = 0;
  let previousDeathlessHits = 0;
  let outcome: RaidRun['outcome'] = 'timecap';
  const ticks = CAP_SECONDS * 20;
  let tick = 0;

  for (; tick < ticks && !boss.dead; tick++) {
    const t = tick / 20;
    // Tank succession.
    const activeTank = sim.entities.get(activeTankPid);
    if (!activeTank || activeTank.dead) {
      const replacement = [mtPid, otPid].find((pid) => !sim.entities.get(pid)?.dead);
      if (replacement === undefined) {
        outcome = 'wipe';
        break;
      }
      activeTankPid = replacement;
      const top = Math.max(0, ...boss.threat.values());
      boss.threat.set(replacement, top + 10000);
      boss.aggroTargetId = replacement;
    }
    const tank = must(sim.entities.get(activeTankPid), `active tank ${activeTankPid}`);
    tankAliveSeconds += 1 / 20;

    // Off-tank secures add waves; DPS focus the priest add (Malric) first so
    // his escalating boss heal is answered the way a real raid answers it.
    const adds = livingAdds(sim);
    const otAlive = otPid !== activeTankPid && !sim.entities.get(otPid)?.dead;
    if (otAlive && adds.length) {
      const ot = must(sim.entities.get(otPid), `off-tank entity ${otPid}`);
      const focus = adds.find((a) => a.aggroTargetId !== otPid) ?? adds[0];
      for (const add of adds) {
        if (add.templateId === 'nythraxis_heroic_rogue_add') continue; // untauntable by design
        const next = Math.max(
          0,
          ...[...add.threat.entries()].filter(([p]) => p !== otPid).map(([, v]) => v),
        );
        if (add.aggroTargetId !== otPid || (add.threat.get(otPid) ?? 0) - next < 1500) {
          add.threat.set(otPid, next + 2500);
          add.aggroTargetId = otPid;
        }
      }
      if (focus && dist2d(ot.pos, focus.pos) > 5)
        teleport(sim, otPid, focus.pos.x, focus.pos.z - 3);
    }

    // Soul Rend: stack the marked players.
    if (boss.nythraxis?.soulRendMarks.length) {
      const stack = { x: origin.x - 12, z: origin.z + 72 };
      for (const mark of boss.nythraxis.soulRendMarks) {
        const e = sim.entities.get(mark.playerId);
        if (e && !e.dead) teleport(sim, e.id, stack.x, stack.z);
      }
    } else {
      // Drift home once marks clear so casters stay in range. Never move a
      // ward-stone channeler.
      for (const pid of [...healerPids, ...dpsPids]) {
        const e = sim.entities.get(pid);
        const home = homePos.get(pid);
        if (!e || e.dead || e.castingAbility === 'nythraxis_ward_channel') continue;
        if (home && dist2d(e.pos, boss.pos) > 26) teleport(sim, pid, home.x, home.z);
      }
    }

    // Deathless Rage: channel the ward stones (healers first, then DPS).
    const deathlessRemaining = boss.nythraxis?.deathlessCastRemaining ?? 0;
    if (deathlessRemaining > 0) {
      const wards = [...sim.entities.values()]
        .filter(
          (e) =>
            e.kind === 'object' &&
            e.objectItemId === 'bastion_ward_stone' &&
            dist2d(e.pos, boss.spawnPos) < 140,
        )
        .sort((a, b) => a.id - b.id);
      const livingHealers = healerPids.filter((pid) => !sim.entities.get(pid)?.dead);
      const livingDps = dpsPids.filter((pid) => !sim.entities.get(pid)?.dead);
      wards.forEach((obj, i) => {
        const pid = livingHealers[i] ?? livingDps[i];
        if (pid === undefined) return;
        const p = must(sim.entities.get(pid), `ward channeler entity ${pid}`);
        teleport(sim, pid, obj.pos.x, obj.pos.z);
        if (p.castingAbility !== 'nythraxis_ward_channel') {
          p.castingAbility = null;
          p.channeling = false;
          p.castRemaining = 0;
          p.castTotal = 0;
        }
        sim.pickUpObject(obj.id, pid);
      });
    }
    if (previousDeathlessRemaining <= 0 && deathlessRemaining > 0) deathlessCasts++;
    if (previousDeathlessRemaining > 0 && deathlessRemaining <= 0) {
      if (deathlessHits > previousDeathlessHits) deathlessFailed++;
      previousDeathlessHits = deathlessHits;
    }
    previousDeathlessRemaining = deathlessRemaining;

    // Healers: triage the lowest raider, else the active tank.
    const living = pids
      .map((pid) => must(sim.entities.get(pid), `raider entity ${pid}`))
      .filter((p) => !p.dead);
    const wounded = living
      .filter((p) => p.hp < p.maxHp * 0.85)
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
    const lowest = living.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    for (let i = 0; i < healerPids.length; i++) {
      const hpid = healerPids[i];
      const h = must(sim.entities.get(hpid), `healer entity ${hpid}`);
      if (h.dead || h.castingAbility === 'nythraxis_ward_channel') continue;
      const spec = healerSpecs[i];
      const target = lowest && lowest.hp / lowest.maxHp < 0.9 ? lowest : tank;
      if (target && target.hp < target.maxHp) {
        let priority = spec.healPriority ?? [];
        // Multi-target casts when the raid is broadly wounded.
        if (spec.cls === 'shaman' && wounded.length >= 2) priority = ['chain_heal', ...priority];
        if (spec.cls === 'priest' && wounded.length >= 3)
          priority = ['prayer_of_healing', ...priority];
        healTick(sim, hpid, target, spec, priority);
      }
      if (healerOom[i] === null && !h.castingAbility && h.resource < 25) healerOom[i] = t;
    }

    // Tanks and DPS act.
    for (const pid of [activeTankPid, otPid, ...dpsPids]) {
      const p = sim.entities.get(pid);
      if (!p || p.dead || p.castingAbility) continue;
      if (healerPids.includes(pid)) continue;
      const priestAdd = adds.find((a) => a.templateId === PRIEST_ADD_ID);
      const otFocus = adds.find((a) => a.aggroTargetId === otPid);
      const target =
        pid === activeTankPid
          ? boss
          : pid === otPid
            ? (otFocus ?? adds[0] ?? boss)
            : (priestAdd ?? otFocus ?? adds[0] ?? boss);
      if (target.dead) continue;
      const rotation =
        pid === activeTankPid || pid === mtPid
          ? TANK_ROTATION
          : pid === otPid
            ? OFFTANK_ROTATION
            : MAGE_ROTATION;
      // Evocation at low mana keeps the filler DPS sustained on long fights.
      if (rotation === MAGE_ROTATION && p.resource < 120 && cast(sim, pid, pid, 'evocation'))
        continue;
      const melee = pid === activeTankPid || pid === otPid;
      if (melee && dist2d(p.pos, target.pos) > MELEE_RANGE - 0.2)
        teleport(sim, pid, target.pos.x, target.pos.z - 3);
      p.targetId = target.id;
      face(p, target);
      sim.startAutoAttack(pid);
      for (const ability of rotation) {
        if (!shouldTry(p, target, ability)) continue;
        if (cast(sim, pid, target.id, ability)) break;
      }
    }

    const events = sim.tick();
    for (const event of events) {
      if (event.type === 'damage' && event.kind === 'hit' && pids.includes(event.targetId)) {
        raidDamage += event.amount;
        if (event.targetId === activeTankPid) tankDamage += event.amount;
        if (event.ability === 'Deathless Rage') deathlessHits++;
      }
      if (event.type === 'heal2') {
        const idx = healerPids.indexOf(event.sourceId);
        if (idx >= 0) healerHealing[idx] += event.amount;
      }
      if (event.type === 'death' && pids.includes(event.entityId)) {
        const idx = pids.indexOf(event.entityId);
        deaths.push({ spec: specs[idx].key, at: round1(tick / 20) });
      }
    }
    if (living.length <= 2) {
      outcome = 'wipe';
      break;
    }
  }
  if (boss.dead) outcome = 'boss_dead';
  const seconds = Math.max(1 / 20, tick / 20);
  return {
    outcome,
    seconds,
    bossHpPct: round1((100 * boss.hp) / boss.maxHp),
    playerDeaths: deaths,
    healerHps: healerHealing.map((h) => h / seconds),
    healerOom,
    tankDtps: tankDamage / Math.max(1 / 20, tankAliveSeconds),
    raidDtps: raidDamage / seconds,
    deathlessCasts,
    deathlessFailed,
  };
}

function main() {
  const startedAt = Date.now();
  const twoHealers = [HEALER_SPECS[0], HEALER_SPECS[3]]; // holy priest + resto shaman
  const threeHealers = [HEALER_SPECS[0], HEALER_SPECS[3], HEALER_SPECS[2]]; // + resto druid
  const fourHealers = [...threeHealers, HEALER_SPECS[4]]; // + holy paladin
  const cells: { key: string; difficulty: 'normal' | 'heroic'; healers: Spec[] }[] = [
    { key: 'normal_2healers', difficulty: 'normal', healers: twoHealers },
    { key: 'normal_3healers', difficulty: 'normal', healers: threeHealers },
    { key: 'heroic_2healers', difficulty: 'heroic', healers: twoHealers },
    { key: 'heroic_3healers', difficulty: 'heroic', healers: threeHealers },
    { key: 'heroic_4healers', difficulty: 'heroic', healers: fourHealers },
  ];
  console.log(`nythraxis raid bench: runs=${RUNS} cap=${CAP_SECONDS}s`);
  const rows: Record<string, unknown> = {};
  const allRuns: Record<string, RaidRun[]> = {};
  for (const cell of cells) {
    const runs: RaidRun[] = [];
    for (let r = 0; r < RUNS; r++) {
      runs.push(runRaid(cell.difficulty, cell.healers, BASE_SEED + r * 60013));
    }
    allRuns[cell.key] = runs;
    const wipes = runs.filter((r) => r.outcome === 'wipe');
    const kills = runs.filter((r) => r.outcome === 'boss_dead');
    const deathsPerRun = summarize(runs.map((r) => r.playerDeaths.length));
    const wipeTimes = summarize(wipes.map((r) => r.seconds));
    const bossHp = summarize(runs.map((r) => r.bossHpPct));
    const tankDtps = summarize(runs.map((r) => r.tankDtps));
    const raidDtps = summarize(runs.map((r) => r.raidDtps));
    const hps = summarize(runs.flatMap((r) => r.healerHps));
    const oomed = runs.flatMap((r) => r.healerOom).filter((v) => v !== null) as number[];
    rows[cell.key] = {
      wipePct: round1((100 * wipes.length) / runs.length),
      killPct: round1((100 * kills.length) / runs.length),
      wipeTimeP50: wipes.length ? wipeTimes.p50 : null,
      deathsPerRun,
      bossHpPctAtEnd: bossHp,
      tankDtps,
      raidDtps,
      healerHps: hps,
      oomCount: oomed.length,
      oomP50: oomed.length ? summarize(oomed).p50 : null,
      deathlessFailed: runs.reduce((a, r) => a + r.deathlessFailed, 0),
      deathlessCasts: runs.reduce((a, r) => a + r.deathlessCasts, 0),
    };
    console.log(
      `D ${cell.key.padEnd(18)} wipe ${String(round1((100 * wipes.length) / runs.length)).padStart(5)}%  ` +
        `deaths/run p50 ${deathsPerRun.p50}  wipe@ ${wipes.length ? wipeTimes.p50 : '-'}s  ` +
        `bossHp% ${bossHp.p50}  tankDtps ${tankDtps.p50.toFixed(0)}  raidDtps ${raidDtps.p50.toFixed(0)}  ` +
        `healerHps ${hps.p50.toFixed(0)}  oom ${oomed.length}`,
    );
  }
  mkdirSync('tmp/healing_mc', { recursive: true });
  writeFileSync(
    'tmp/healing_mc/raid_report.json',
    JSON.stringify(
      {
        generated: new Date().toISOString(),
        config: { runs: RUNS, capSeconds: CAP_SECONDS },
        rows,
        allRuns,
      },
      null,
      2,
    ),
  );
  console.log(
    `wrote tmp/healing_mc/raid_report.json in ${Math.round((Date.now() - startedAt) / 1000)}s`,
  );
}

main();
