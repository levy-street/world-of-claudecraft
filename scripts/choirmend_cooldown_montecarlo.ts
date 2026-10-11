// Choirmend cooldown Monte Carlo: a level-20 best-in-slot holy priest on the REAL
// Sim, healing the Eastbrook Healing Training Ground (the five injured dummies)
// and a raid-sized bench of ten wounded allies, under the live-most-common holy
// build. Compares the shipped rotation (Choirmend back to back, no cooldown)
// against Choirmend on an N-second cooldown with Solemn Prayer as the filler,
// and reports throughput, overheal, casts per minute, mana spent and regained per
// minute, and time to out-of-mana.
//
// Run: npx tsx scripts/choirmend_cooldown_montecarlo.ts [--runs N] [--seconds S]
//   [--cooldowns 0,8,10,12,15] [--arena dummies,raid10] [--verbose]
// Writes tmp/choirmend_mc/report_<arenas>.json and prints the digest tables. Findings:
// docs/balance/choirmend-cooldown.md.

import { mkdirSync, writeFileSync } from 'node:fs';
import { ABILITIES } from '../src/sim/data';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import { type Entity, MAX_LEVEL } from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';
import { addSpecPlayer, cast, round1, type Spec, summarize, teleport } from './healing_montecarlo';

const args = process.argv.slice(2);
function flag(name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`);
  const value = i >= 0 ? args[i + 1] : undefined;
  if (value === undefined || value.startsWith('--')) return fallback;
  return value;
}
const RUNS = Number(flag('runs', '20'));
const SECONDS = Number(flag('seconds', '300'));
const COOLDOWNS = flag('cooldowns', '0,8,10,12,15').split(',').map(Number);
const ARENAS = flag('arena', 'dummies,raid10').split(',') as Arena[];
const VERBOSE = args.includes('--verbose');
const BASE_SEED = 424200;
const CHOIRMEND = 'prayer_of_healing';
const SOLEMN = 'heal';

// The most common live holy build on raid boss kills (Parses, builds 0.43 to 0.44,
// 21 of 153 priests; every row's plurality pick except row 20, where Second
// Verse repeats 40% of Choirmend healing and is the Choirmend-relevant choice).
const LIVE_HOLY: Spec = {
  key: 'holy_priest_live',
  cls: 'priest',
  kind: 'healer',
  talents: {
    spec: 'holy',
    rows: {
      5: 'pri_r5_searing_light',
      8: 'pri_r8_improved_shield',
      11: 'pri_r8_psychic_scream',
      14: 'pri_r11_meditation',
      17: 'pri_r17_martyrs_aegis',
      20: 'pri_r20_second_verse',
    },
  },
};

// Where tests/healing_training.test.ts stands the priest: within 30 yards of all
// five dummies (x = -76, z = -50 to -34).
const TRAINING_GROUND = { x: -82, z: -42 };
// Far from overworld content and every dungeon instance origin (healing_montecarlo.ts).
const RAID_ARENA = { x: -2000, z: 3000 };
const RAID_PATIENTS = 10;

type Arena = 'dummies' | 'raid10';

type Run = {
  rawHps: number;
  effHps: number;
  overhealPct: number;
  castsPerMin: Record<string, number>;
  rawByAbility: Record<string, number>;
  manaSpentPerMin: number;
  manaRegenPerMin: number;
  ttoomSeconds: number | null;
  manaEndPct: number;
  castingPct: number;
  choirmendTargets: number;
};

type Profile = {
  maxMana: number;
  healPower: number;
  int: number;
  spi: number;
  choirmend: { cost: number; castTime: number; cooldown: number };
  solemn: { cost: number; castTime: number; cooldown: number };
};

function lowestHpFraction(targets: Entity[]): Entity {
  let best = targets[0];
  for (const t of targets) if (t.hp / t.maxHp < best.hp / best.maxHp) best = t;
  return best;
}

function runOne(arena: Arena, cooldown: number, seed: number): { run: Run; profile: Profile } {
  // Deliberate, process-local mutation of the shared content table: each run sets
  // the value before addSpecPlayer resolves the priest's known abilities, and the
  // resolved cooldown is asserted below. Nothing else imports this script.
  ABILITIES[CHOIRMEND].cooldown = cooldown;
  // The shipped world (the training ground sits in Eastbrook, so terrain and line of
  // sight must be the live ones); only the dice vary between runs.
  const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', noPlayer: true });
  sim.rng = new Rng(seed);
  const pid = addSpecPlayer(sim, LIVE_HOLY, 'Cantor');
  const priest = sim.entities.get(pid);
  if (!priest) throw new Error('priest missing');

  let targets: Entity[];
  if (arena === 'dummies') {
    teleport(sim, pid, TRAINING_GROUND.x, TRAINING_GROUND.z);
    targets = [...sim.entities.values()].filter(
      (e) => e.templateId?.startsWith('healing_dummy_') && !e.dead,
    );
    if (targets.length !== 5)
      throw new Error(`expected 5 healing dummies, found ${targets.length}`);
  } else {
    teleport(sim, pid, RAID_ARENA.x, RAID_ARENA.z);
    targets = [];
    for (let i = 0; i < RAID_PATIENTS; i++) {
      const ppid = sim.addPlayer('warrior', `Patient${i}`);
      sim.setPlayerLevel(MAX_LEVEL, ppid);
      teleport(sim, ppid, RAID_ARENA.x + 3 + (i % 5) * 2, RAID_ARENA.z + Math.floor(i / 5) * 3);
      const patient = sim.entities.get(ppid);
      if (!patient) throw new Error('patient missing');
      // A bottomless wound, as in healing_montecarlo.ts bench A: raw output is the
      // measurement here; live overheal is applied in the parses projection.
      patient.maxHp = 5e8;
      targets.push(patient);
    }
  }

  const known = sim.meta(pid)?.known ?? [];
  const kc = known.find((k) => k.def.id === CHOIRMEND);
  const ks = known.find((k) => k.def.id === SOLEMN);
  if (!kc || !ks) throw new Error('priest does not know Choirmend / Solemn Prayer');
  if (kc.cooldown !== cooldown) throw new Error(`cooldown did not resolve: ${kc.cooldown}`);
  const profile: Profile = {
    maxMana: priest.maxResource,
    healPower: priest.healPower,
    int: priest.stats.int,
    spi: priest.stats.spi,
    choirmend: { cost: kc.cost, castTime: kc.castTime, cooldown: kc.cooldown },
    solemn: { cost: ks.cost, castTime: ks.castTime, cooldown: ks.cooldown },
  };
  const minCost = Math.min(kc.cost, ks.cost);

  let raw = 0;
  let eff = 0;
  const casts: Record<string, number> = {};
  const rawBy: Record<string, number> = {};
  let spent = 0;
  let regen = 0;
  let ttoom: number | null = null;
  let castingTicks = 0;
  let choirmendHits = 0;
  let prevMana = priest.resource;
  const ticks = SECONDS * 20;
  for (let tick = 0; tick < ticks; tick++) {
    if (arena === 'raid10') for (const t of targets) t.hp = Math.round(t.maxHp / 2);
    if (!priest.castingAbility) {
      const cmReady = (priest.cooldowns.get(CHOIRMEND) ?? 0) <= 0;
      let started = false;
      if (cmReady && priest.resource >= kc.cost) started = cast(sim, pid, targets[0].id, CHOIRMEND);
      if (!started && cooldown > 0 && priest.resource >= ks.cost) {
        cast(sim, pid, lowestHpFraction(targets).id, SOLEMN);
      }
    }
    const events = sim.tick();
    if (priest.castingAbility) castingTicks++;
    for (const ev of events) {
      if (ev.type === 'heal2' && ev.sourceId === pid) {
        const over = (ev as { overheal?: number }).overheal ?? 0;
        raw += ev.amount + over;
        eff += ev.amount;
        rawBy[ev.ability] = (rawBy[ev.ability] ?? 0) + ev.amount + over;
        if (ev.ability === ABILITIES[CHOIRMEND].name) choirmendHits++;
      }
      if (ev.type === 'castStart' && ev.entityId === pid) {
        casts[ev.ability] = (casts[ev.ability] ?? 0) + 1;
      }
    }
    const delta = priest.resource - prevMana;
    if (delta < 0) spent -= delta;
    else regen += delta;
    prevMana = priest.resource;
    if (ttoom === null && !priest.castingAbility && priest.resource < minCost) ttoom = tick / 20;
  }
  const minutes = SECONDS / 60;
  const cmCasts = casts[CHOIRMEND] ?? 0;
  return {
    run: {
      rawHps: raw / SECONDS,
      effHps: eff / SECONDS,
      overhealPct: raw > 0 ? (100 * (raw - eff)) / raw : 0,
      castsPerMin: Object.fromEntries(Object.entries(casts).map(([k, v]) => [k, v / minutes])),
      rawByAbility: rawBy,
      manaSpentPerMin: spent / minutes,
      manaRegenPerMin: regen / minutes,
      ttoomSeconds: ttoom,
      manaEndPct: (100 * priest.resource) / priest.maxResource,
      castingPct: (100 * castingTicks) / ticks,
      choirmendTargets: cmCasts > 0 ? choirmendHits / cmCasts : 0,
    },
    profile,
  };
}

function main() {
  const report: Record<string, unknown> = { runs: RUNS, seconds: SECONDS, arenas: {} };
  let profile: Profile | null = null;
  for (const arena of ARENAS) {
    const rows: Record<string, unknown>[] = [];
    console.log(`\n== ${arena} (${RUNS} runs x ${SECONDS}s, live holy build, BiS)`);
    console.log(
      'cd   rawHPS p10/50/90     effHPS p50  overheal  CM/min  SP/min  CM tgts  mana spent/min  regen/min  OOM at (p50)  end mana  casting%',
    );
    for (const cd of COOLDOWNS) {
      const runs: Run[] = [];
      for (let i = 0; i < RUNS; i++) {
        const out = runOne(arena, cd, BASE_SEED + i * 7919 + cd);
        runs.push(out.run);
        profile ??= out.profile;
        if (VERBOSE)
          console.log(
            `  run ${i} seed ${BASE_SEED + i * 7919 + cd}: raw ${round1(out.run.rawHps)} eff ${round1(out.run.effHps)} casts ${JSON.stringify(out.run.castsPerMin)} oom ${out.run.ttoomSeconds} targets ${round1(out.run.choirmendTargets)}`,
          );
      }
      const raw = summarize(runs.map((r) => r.rawHps));
      const eff = summarize(runs.map((r) => r.effHps));
      const over = summarize(runs.map((r) => r.overhealPct));
      const cm = summarize(runs.map((r) => r.castsPerMin[CHOIRMEND] ?? 0));
      const sp = summarize(runs.map((r) => r.castsPerMin[SOLEMN] ?? 0));
      const tg = summarize(runs.map((r) => r.choirmendTargets));
      const spend = summarize(runs.map((r) => r.manaSpentPerMin));
      const regen = summarize(runs.map((r) => r.manaRegenPerMin));
      const oomRuns = runs.filter((r) => r.ttoomSeconds !== null);
      const oom = summarize(oomRuns.map((r) => r.ttoomSeconds ?? 0));
      const end = summarize(runs.map((r) => r.manaEndPct));
      const casting = summarize(runs.map((r) => r.castingPct));
      const oomText =
        oomRuns.length === 0 ? 'never' : `${oom.p50}s (${oomRuns.length}/${runs.length} runs)`;
      console.log(
        `${String(cd).padEnd(4)} ${String(raw.p10).padStart(6)}/${String(raw.p50).padStart(6)}/${String(raw.p90).padStart(6)}   ${String(eff.p50).padStart(9)}  ${String(round1(over.p50)).padStart(6)}%  ${String(cm.p50).padStart(6)}  ${String(sp.p50).padStart(6)}  ${String(tg.p50).padStart(7)}  ${String(Math.round(spend.p50)).padStart(14)}  ${String(Math.round(regen.p50)).padStart(9)}  ${oomText.padStart(14)}  ${String(round1(end.p50)).padStart(7)}%  ${String(round1(casting.p50)).padStart(7)}%`,
      );
      rows.push({
        cooldown: cd,
        rawHps: raw,
        effHps: eff,
        overhealPct: over,
        choirmendPerMin: cm,
        solemnPerMin: sp,
        choirmendTargets: tg,
        manaSpentPerMin: spend,
        manaRegenPerMin: regen,
        ttoom: oomRuns.length ? oom : null,
        oomRuns: oomRuns.length,
        manaEndPct: end,
        castingPct: casting,
        rawByAbility: runs[0].rawByAbility,
      });
    }
    (report.arenas as Record<string, unknown>)[arena] = rows;
  }
  report.profile = profile;
  console.log('\nprofile', JSON.stringify(profile));
  mkdirSync('tmp/choirmend_mc', { recursive: true });
  writeFileSync(
    `tmp/choirmend_mc/report_${ARENAS.join('_')}.json`,
    JSON.stringify(report, null, 2),
  );
}

main();
