// The whole Nythraxis fight, end to end, on both difficulties: the solo
// practice raid (/dev nythraxisraid) pulls him and a minimal scripted raid
// answers the mechanics the way a real raid would (kill the spikes, drag him
// onto every other sigil, channel the wards once, let the second Rage land,
// run the clock out at the end), while the boss's health is walked down at a
// steady pace so every phase is reached before the enrage. The assertion is
// the owner's question in one place: does every mechanic actually fire?
//
// No timers are forced except the enrage clock at the very end; every cast
// below fires on its own cadence.

import { describe, expect, it } from 'vitest';
import { NYTHRAXIS_BONE_SPIKE_ID } from '../src/sim/nythraxis_bone_spike';
import { NYTHRAXIS_ARENA_ID } from '../src/sim/nythraxis_dev_raid';
import { Sim } from '../src/sim/sim';
import { type Entity, NYTHRAXIS_ADD_ID, NYTHRAXIS_BOSS_ID, type SimEvent } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

type AnyEntity = Entity & Record<string, any>;

// Real fights run five to six minutes; the walk-down here lands the kill in
// about four and a half, comfortably inside the 6:00 / 5:00 clock.
const KILL_SECONDS = 270;
const MAX_SECONDS = 420;

interface FightReport {
  difficulty: 'normal' | 'heroic';
  killed: boolean;
  seconds: number;
  phases: Set<string>;
  callouts: Set<string>;
  damageAbilities: Set<string>;
  auras: Set<string>;
  mobTemplates: Set<string>;
  sigilsSeen: number;
}

function runFight(difficulty: 'normal' | 'heroic'): FightReport {
  const sim = new Sim({
    seed: 4242,
    playerClass: 'warrior',
    autoEquip: true,
    devCommands: true,
    world: EMPTY_TEST_WORLD,
  }) as Sim & Record<string, any>;
  sim.setPlayerLevel(20);
  sim.chat(`/dev nythraxisraid ${difficulty}`);
  sim.chat('/dev god');
  const instance = sim.instances.find(
    (candidate: any) =>
      candidate.dungeonId === NYTHRAXIS_ARENA_ID &&
      candidate.partyKey === sim.ctx.instanceKeyFor(sim.player.id),
  );
  if (!instance) throw new Error('practice arena missing');
  const boss = instance.mobIds
    .map((id: number) => sim.entities.get(id))
    .find((e: any) => e?.templateId === NYTHRAXIS_BOSS_ID && !e.dead) as AnyEntity;
  const tank = sim.player as AnyEntity;
  const place = (e: AnyEntity, x: number, z: number) => {
    e.pos = { ...e.pos, x, z };
    e.prevPos = { ...e.pos };
    sim.rebucket(e);
  };
  // Pull: the tank in melee, on the boss's threat table.
  place(tank, boss.pos.x, boss.pos.z - 4);
  boss.inCombat = true;
  boss.aiState = 'attack';
  boss.aggroTargetId = tank.id;
  boss.threat.set(tank.id, 1000);

  const report: FightReport = {
    difficulty,
    killed: false,
    seconds: 0,
    phases: new Set(),
    callouts: new Set(),
    damageAbilities: new Set(),
    auras: new Set(),
    mobTemplates: new Set(),
    sigilsSeen: 0,
  };
  const damagePerTick = boss.maxHp / (KILL_SECONDS * 20);
  let sigilId: number | null = null;
  let ragesSeen = 0;
  let wardsCompleted = false;
  let enragePoked = false;
  let rageCasting = false;

  for (let tick = 0; tick < MAX_SECONDS * 20 && !boss.dead; tick++) {
    const st = boss.nythraxis;
    if (st) {
      report.phases.add(String(st.phase));
      // The tank stays glued to him (he runs during Bone Storm; the tank catches up).
      if (
        Math.hypot(boss.pos.x - tank.pos.x, boss.pos.z - tank.pos.z) > 5 &&
        st.phase !== 'transition'
      ) {
        place(tank, boss.pos.x, boss.pos.z - 3);
      }
      // Steady raid damage, paused for the transition like a real raid's would
      // be. Health is walked down directly (no attacker modifiers, so the pace
      // is exactly KILL_SECONDS); the last point goes through dealDamage so the
      // kill resolves the way a real one does.
      if (st.phase !== 'transition' && st.phase !== 'dead') {
        if (boss.hp > damagePerTick + 1) boss.hp -= damagePerTick;
        else sim.dealDamage(tank, boss, boss.hp, false, 'physical', 'Practice DPS', 'hit', true);
      }
      // Damage dealers switch to every spike and shatter it in about three
      // seconds, and burn the heroic court down in about ten (Malric's Mending
      // would otherwise out-heal the walk-down, which is the court's whole
      // point).
      for (const id of [...instance.mobIds]) {
        const mob = sim.entities.get(id) as AnyEntity | undefined;
        if (!mob || mob.dead) continue;
        const spike = mob.templateId === NYTHRAXIS_BONE_SPIKE_ID;
        const court = /^nythraxis_heroic_/.test(mob.templateId);
        if (!spike && !court) continue;
        // Walked down directly, like the boss, so the pace is exact: a spike
        // lives three seconds (long enough for its drain to tick), a court
        // member ten.
        const step = mob.maxHp / (spike ? 60 : 200);
        if (mob.hp > step + 1) mob.hp -= step;
        else sim.dealDamage(tank, mob, mob.hp, false, 'physical', 'Practice DPS', 'hit', true);
      }
      // The drag: every other sigil is bound after a three second run; the rest lapse.
      const sigil = st.sigil ?? null;
      if (sigil && sigil.castKey !== sigilId) {
        sigilId = sigil.castKey;
        report.sigilsSeen++;
      }
      if (sigil && report.sigilsSeen % 2 === 1) {
        const bindWindow = difficulty === 'heroic' ? 12 : 15;
        if (sigil.remaining < bindWindow - 3) place(boss, sigil.x, sigil.z);
      }
      // The wards: three bots channel the first Rage; the second one lands.
      const casting = st.deathlessCastRemaining > 0;
      if (casting && !rageCasting) ragesSeen++;
      rageCasting = casting;
      if (casting && ragesSeen === 1 && !wardsCompleted) {
        sim.chat('/dev nyx wards');
        wardsCompleted = true;
      }
      // Once he is deep in phase 3, run the clock out so the enrage is exercised too.
      if (st.phase === 3 && !enragePoked && boss.hp < boss.maxHp * 0.12) {
        sim.chat('/dev nyx enrage 2');
        enragePoked = true;
      }
    }
    const events = sim.tick() as SimEvent[];
    for (const ev of events) {
      if (ev.type === 'nythraxisCallout') report.callouts.add(ev.call);
      if (ev.type === 'damage' && ev.ability) report.damageAbilities.add(ev.ability);
      if (ev.type === 'aura' && ev.gained) report.auras.add(ev.name);
    }
    for (const id of instance.mobIds) {
      const mob = sim.entities.get(id);
      if (mob?.kind === 'mob') report.mobTemplates.add(mob.templateId);
    }
    report.seconds = (tick + 1) / 20;
  }
  report.killed = boss.dead;
  return report;
}

const EXPECTED_CALLOUTS = [
  'impaled',
  'youAreImpaled',
  'spikeBroken',
  'dreadCurseSwap',
  'sigilAppears',
  'sigilBound',
  'sigilUnbound',
  'gravefireTarget',
  'kingsWrath',
  'boneStormBegins',
  'boneStormCharge',
  'boneStormEnds',
  'crownEndures',
];

const EXPECTED_DAMAGE = [
  'Dread Curse',
  'Bone Spike',
  'Grave Eruption',
  'Grave Flame',
  'Binding Sigil',
  'Gravefire',
  'Soul Rend',
  'Soulfire',
  'Deathless Rage',
  'Unbound',
  'Bone Storm',
  'Bone Slam',
];

const EXPECTED_AURAS = [
  'Dread Curse',
  'Impaled',
  'Deathless Ascension',
  'Bound',
  'Unbound',
  'Deathless Rage Interrupted',
  "King's Wrath",
  'Bone Storm',
  'The Crown Endures',
];

describe('Nythraxis full fight smoke (every mechanic fires)', () => {
  for (const difficulty of ['normal', 'heroic'] as const) {
    it(`${difficulty}: a scripted raid sees every phase and every mechanic, then kills him`, {
      timeout: 240_000,
    }, () => {
      const report = runFight(difficulty);
      const missing = (expected: readonly string[], seen: Set<string>) =>
        expected.filter((name) => !seen.has(name));
      // One line per difficulty so a red run shows what did and did not fire.
      console.log(
        `[nythraxis smoke] ${difficulty}: killed=${report.killed} in ${report.seconds}s; phases=${[...report.phases].join(',')}; sigils=${report.sigilsSeen}; callouts=${[...report.callouts].join(',')}; damage=${[...report.damageAbilities].join(',')}; auras=${[...report.auras].join(',')}; mobs=${[...report.mobTemplates].join(',')}`,
      );
      expect(report.killed, `killed in ${report.seconds}s`).toBe(true);
      // The kill tick ends the loop before the dead phase is sampled.
      expect([...report.phases].sort()).toEqual(['1', '2', '3', 'transition']);
      expect(missing(EXPECTED_CALLOUTS, report.callouts), 'callouts').toEqual([]);
      expect(
        missing(
          EXPECTED_DAMAGE.filter((a) => a !== 'Binding Sigil'),
          report.damageAbilities,
        ),
        'damage abilities',
      ).toEqual([]);
      expect(missing(EXPECTED_AURAS, report.auras), 'auras').toEqual([]);
      // The redo fields no adds (owner playtest call 2026-09-04): no guard wave
      // rose and no court followed the landed Rage, on either difficulty. The
      // spikes are the impale mechanic, not adds, and still shatter.
      expect(report.mobTemplates.has(NYTHRAXIS_ADD_ID)).toBe(false);
      expect(report.mobTemplates.has(NYTHRAXIS_BONE_SPIKE_ID)).toBe(true);
      expect(report.mobTemplates.has('nythraxis_heroic_priest_add')).toBe(false);
      expect(report.sigilsSeen).toBeGreaterThanOrEqual(2);
      expect(report.seconds).toBeLessThan(MAX_SECONDS);
    });
  }
});
