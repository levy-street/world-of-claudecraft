import { beforeEach, describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/sim/types';
import { MeterData, Meters, MetersPanel } from '../src/ui/meters';
import { PlayerActivityTracker } from '../src/ui/meters_activity';
import { AuraUptimeTracker } from '../src/ui/meters_auras';
import { compareEncounters } from '../src/ui/meters_comparison';
import {
  buildDeathRecapRows,
  DeathRecapBuffer,
  type DeathRecapRecord,
} from '../src/ui/meters_death_recap';
import { buildAbilityBalanceStats } from '../src/ui/meters_dev_view';
import {
  EXPORT_SCHEMA_VERSION,
  exportEncounterAsJson,
  exportEncounterAsText,
} from '../src/ui/meters_export';
import { EncounterPhaseManager } from '../src/ui/meters_phases';
import { buildMeterRows } from '../src/ui/meters_rows_view';
import { buildTimelineRows, EncounterTimeline } from '../src/ui/meters_timeline';
import type { IWorld } from '../src/world_api';

function fakeWorld(): IWorld {
  const entities = new Map<number, any>();
  entities.set(1, {
    id: 1,
    kind: 'player',
    name: 'Warrior',
    templateId: 'warrior',
    hp: 1000,
    maxHp: 1000,
    dead: false,
  });
  entities.set(2, {
    id: 2,
    kind: 'player',
    name: 'Priest',
    templateId: 'priest',
    hp: 800,
    maxHp: 800,
    dead: false,
  });
  entities.set(3, {
    id: 3,
    kind: 'player',
    name: 'Hunter',
    templateId: 'hunter',
    hp: 850,
    maxHp: 850,
    dead: false,
  });
  entities.set(10, { id: 10, kind: 'mob', name: 'Wolf Pet', ownerId: 3, dead: false });
  entities.set(50, {
    id: 50,
    kind: 'mob',
    name: 'Ignivar',
    maxHp: 50000,
    dead: false,
    aggroTargetId: 1,
  });
  entities.set(51, {
    id: 51,
    kind: 'mob',
    name: 'Forged Add',
    maxHp: 10000,
    dead: false,
    aggroTargetId: 1,
  });

  return {
    entities,
    player: entities.get(1),
    partyInfo: {
      leader: 1,
      raid: false,
      members: [
        { pid: 2, name: 'Priest', cls: 'priest', group: 1 },
        { pid: 3, name: 'Hunter', cls: 'hunter', group: 1 },
      ],
    },
  } as unknown as IWorld;
}

const dmg = (
  sourceId: number,
  targetId: number,
  amount: number,
  ability: string | null = null,
  crit = false,
  absorbed = 0,
): SimEvent =>
  ({
    type: 'damage',
    sourceId,
    targetId,
    amount,
    crit,
    absorbed,
    school: 'physical',
    ability,
    kind: 'hit',
  }) as SimEvent;

const heal = (
  sourceId: number,
  targetId: number,
  amount: number,
  ability = 'Heal',
  overheal = 0,
): SimEvent =>
  ({
    type: 'heal2',
    sourceId,
    targetId,
    amount,
    crit: false,
    ability,
    overheal,
  }) as SimEvent;

describe('Advanced Combat Meters - Raid Analysis', () => {
  let w: IWorld;
  let party: Set<number>;
  let m: MeterData;

  beforeEach(() => {
    w = fakeWorld();
    party = new Set([1, 2, 3]);
    m = new MeterData(0);
  });

  describe('1. Damage Taken Breakdown with Sources', () => {
    it('records multiple sources for the same ability damaging a player', () => {
      // Ignivar hits Warrior with Fire Slam for 600
      m.onEvent(dmg(50, 1, 600, 'Fire Slam'), w, party, 1000);
      // Forged Add also hits Warrior with Fire Slam for 200
      m.onEvent(dmg(51, 1, 200, 'Fire Slam'), w, party, 2000);

      const warrior = m.current!.tallies.get(1)!;
      expect(warrior.dmgTaken).toBe(800);

      const entry = [...warrior.dmgTakenByAbility.values()].find((e) => e.ability === 'Fire Slam')!;
      expect(entry).toBeDefined();
      expect(entry.amount).toBe(800);
      expect(entry.hits).toBe(2);
      expect(entry.sources).toBeDefined();
      expect(entry.sources!.get('Ignivar')).toBe(600);
      expect(entry.sources!.get('Forged Add')).toBe(200);
    });
  });

  describe('2. Death Recap Buffer and Formatting', () => {
    it('buffers recent combat events and formats death recap with relative time and lethal hit', () => {
      const buffer = new DeathRecapBuffer();
      const pid = 1;

      // Event 1: 3.0s before death
      buffer.push(pid, {
        timestamp: 1000,
        type: 'damage',
        ability: 'Melee',
        sourceName: 'Ignivar',
        sourceId: 50,
        amount: 300,
        hpBefore: 1000,
        hpAfter: 700,
      });

      // Event 2: 1.5s before death, a heal landed
      buffer.push(pid, {
        timestamp: 2500,
        type: 'heal',
        ability: 'Flash Heal',
        sourceName: 'Priest',
        sourceId: 2,
        amount: 200,
        hpBefore: 700,
        hpAfter: 900,
      });

      // Event 3: lethal hit at t=4000ms
      buffer.push(pid, {
        timestamp: 4000,
        type: 'damage',
        ability: 'Magma Burst',
        sourceName: 'Ignivar',
        sourceId: 50,
        amount: 900,
        hpBefore: 900,
        hpAfter: 0,
        lethal: true,
      });

      const events = buffer.getRecentEvents(pid);
      expect(events).toHaveLength(3);

      const record: DeathRecapRecord = {
        pid,
        playerName: 'Warrior',
        deathTime: 4000,
        killerName: 'Ignivar',
        killerAbility: 'Magma Burst',
        events,
      };

      const rows = buildDeathRecapRows(record);
      expect(rows).toHaveLength(3);
      // Chronological order: first event is -3.0s, last is 0.0s
      expect(rows[0].timeRel).toBe('-3.0s');
      expect(rows[0].ability).toBe('Melee');
      expect(rows[0].amountStr).toBe('-300');
      expect(rows[0].hpStr).toBe('1000 -> 700 HP');
      expect(rows[0].lethal).toBe(false);

      expect(rows[1].timeRel).toBe('-1.5s');
      expect(rows[1].amountStr).toBe('+200');
      expect(rows[1].type).toBe('heal');

      expect(rows[2].timeRel).toBe(' 0.0s');
      expect(rows[2].ability).toBe('Magma Burst');
      expect(rows[2].amountStr).toBe('-900');
      expect(rows[2].hpStr).toBe('900 -> 0 HP');
      expect(rows[2].lethal).toBe(true);
    });

    it('enforces FIFO cap of 25 events in DeathRecapBuffer', () => {
      const buffer = new DeathRecapBuffer();
      for (let i = 0; i < 30; i++) {
        buffer.push(1, {
          timestamp: 1000 + i * 100,
          type: 'damage',
          ability: `Hit ${i}`,
          sourceName: 'Mob',
          sourceId: 50,
          amount: 10,
        });
      }
      const events = buffer.getRecentEvents(1);
      expect(events).toHaveLength(25);
      expect(events[0].ability).toBe('Hit 5');
      expect(events[24].ability).toBe('Hit 29');
    });
  });

  describe('3. Shield Absorb Credit as Healing', () => {
    it('credits absorbed damage as healing to the shielder under the shield ability name', () => {
      // Priest (id 2) shields Warrior (id 1) with Power Word: Shield
      const absorbEv: SimEvent = {
        type: 'absorb',
        sourceId: 2,
        targetId: 1,
        amount: 400,
        ability: 'Power Word: Shield',
        abilityId: 'power_word_shield',
      };
      m.onEvent(absorbEv, w, party, 1000);

      const priest = m.current!.tallies.get(2)!;
      expect(priest.heal).toBe(400);
      const shieldEntry = [...priest.healByAbility.values()].find(
        (e) => e.ability === 'Power Word: Shield',
      );
      expect(shieldEntry).toBeDefined();
      expect(shieldEntry!.amount).toBe(400);
    });

    it('ranks healers including shield absorb credit on heal tab', () => {
      // Priest absorbs 400 with shield
      m.onEvent(
        {
          type: 'absorb',
          sourceId: 2,
          targetId: 1,
          amount: 400,
          ability: 'Power Word: Shield',
          abilityId: 'power_word_shield',
        },
        w,
        party,
        1000,
      );
      // Warrior heals 100 with Bloodthirst
      m.onEvent(
        {
          type: 'heal2',
          sourceId: 1,
          targetId: 1,
          amount: 100,
          crit: false,
          ability: 'Bloodthirst',
          abilityId: 'bloodthirst',
        },
        w,
        party,
        2000,
      );

      const rows = buildMeterRows({
        tallies: m.current!.tallies.values(),
        tab: 'heal',
        liveThreat: null,
        petsByOwner: null,
        mainMobId: 50,
        aggroPid: null,
      });

      expect(rows).toHaveLength(2);
      expect(rows[0].tally.name).toBe('Priest');
      expect(rows[0].value).toBe(400);
      expect(rows[1].tally.name).toBe('Warrior');
      expect(rows[1].value).toBe(100);
    });
  });

  describe('4. Advanced Spell Breakdown & Deep Stats', () => {
    it('tracks hits, crits, min/max hit, and overhealing', () => {
      // Warrior lands normal hit 100, crit 250, normal hit 150
      m.onEvent(dmg(1, 50, 100, 'Mortal Strike', false), w, party, 1000);
      m.onEvent(dmg(1, 50, 250, 'Mortal Strike', true), w, party, 2000);
      m.onEvent(dmg(1, 50, 150, 'Mortal Strike', false), w, party, 3000);

      const warrior = m.current!.tallies.get(1)!;
      const ms = [...warrior.dmgByAbility.values()].find((e) => e.ability === 'Mortal Strike')!;
      expect(ms).toBeDefined();
      expect(ms.hits).toBe(3);
      expect(ms.crits).toBe(1);
      expect(ms.minHit).toBe(100);
      expect(ms.maxHit).toBe(250);
      expect(ms.hitTotal).toBe(250);
      expect(ms.critTotal).toBe(250);
      expect(ms.amount).toBe(500);

      // Priest heals Warrior for 400 with 150 overheal
      m.onEvent(heal(2, 1, 400, 'Greater Heal', 150), w, party, 4000);
      const priest = m.current!.tallies.get(2)!;
      const gh = [...priest.healByAbility.values()].find((e) => e.ability === 'Greater Heal')!;
      expect(gh).toBeDefined();
      expect(gh.amount).toBe(400);
      expect(gh.overheal).toBe(150);
    });
  });

  describe('5. Target Breakdown', () => {
    it('records targets per ability and aggregates target damage received across party', () => {
      // Warrior attacks Ignivar for 400 and Forged Add for 150 with Whirlwind
      m.onEvent(dmg(1, 50, 400, 'Whirlwind'), w, party, 1000);
      m.onEvent(dmg(1, 51, 150, 'Whirlwind'), w, party, 1500);
      // Hunter attacks Ignivar for 300 with Auto Shot
      m.onEvent(dmg(3, 50, 300, 'Auto Shot'), w, party, 2000);

      const ww = [...m.current!.tallies.get(1)!.dmgByAbility.values()].find(
        (e) => e.ability === 'Whirlwind',
      )!;
      expect(ww).toBeDefined();
      expect(ww.targets!.get('Ignivar')).toBe(400);
      expect(ww.targets!.get('Forged Add')).toBe(150);

      // Check targetDamageReceived on Encounter
      const ignivarReceived = m.current!.targetDamageReceived.get('Ignivar')!;
      expect(ignivarReceived.get(1)).toBe(400); // Warrior
      expect(ignivarReceived.get(3)).toBe(300); // Hunter
    });
  });

  describe('6. Activity & Active Time Calculation', () => {
    it('merges action windows within 3.5s grace period and calculates activity percent', () => {
      const tracker = new PlayerActivityTracker();
      const pid = 1;

      // 3 actions clustered at t=10s, 12s, 14s (window merges from 10s to 17.5s = 7.5s active)
      tracker.recordAction(pid, 10);
      tracker.recordAction(pid, 12);
      tracker.recordAction(pid, 14);

      // Fight is from t=0s to t=20s (duration 20s)
      const res = tracker.calculateActivity(pid, 0, 20);
      expect(res.activeSeconds).toBeCloseTo(7.5, 1);
      expect(res.activityPercent).toBeCloseTo((7.5 / 20) * 100, 1);
    });
  });

  describe('7. Buff / Debuff Uptime Tracker', () => {
    it('tracks aura uptime duration and percentage across encounter', () => {
      const auras = new AuraUptimeTracker();
      const pid = 1;

      // Battle Shout gained at t=5s, faded at t=25s
      auras.recordAura(pid, 'Warrior', 'Battle Shout', true, 5, true);
      auras.recordAura(pid, 'Warrior', 'Battle Shout', false, 25, true);

      const entries = auras.getEntries(pid, 40, 40, true);
      expect(entries).toHaveLength(1);
      expect(entries[0].uptimeSeconds).toBe(20);
      expect(entries[0].uptimePercent).toBe(50);
      expect(entries[0].applications).toBe(1);
    });
  });

  describe('8. Interrupt Details', () => {
    it('records interrupted spells and lockout ability', () => {
      // Warrior interrupts Ignivar casting Fire Blast
      (w.entities.get(50) as any).castingAbility = 'Fire Blast';
      const interruptEv: SimEvent = {
        type: 'aura',
        gained: true,
        auraKind: 'lockout',
        sourceId: 1,
        targetId: 50,
        name: 'Pummel',
      };
      m.onEvent(interruptEv, w, party, 1000);

      const warrior = m.current!.tallies.get(1)!;
      expect(warrior.interrupts).toBe(1);
      const pummel = [...warrior.interruptsByAbility.values()].find((e) => e.ability === 'Pummel')!;
      expect(pummel).toBeDefined();
      expect(pummel.interruptedSpells!.get('Fire Blast')).toBe(1);
    });
  });

  describe('9. Pet Attribution & Inspection', () => {
    it('folds pet output into owner row without double counting while keeping pet ability label', () => {
      // Hunter deals 300 with Auto Shot
      m.onEvent(dmg(3, 50, 300, 'Auto Shot'), w, party, 1000);
      // Hunter's pet (Wolf Pet, entity 10) deals 150 with Bite
      m.onEvent(dmg(10, 50, 150, 'Bite'), w, party, 2000);

      const hunter = m.current!.tallies.get(3)!;
      expect(hunter.dmg).toBe(450); // 300 + 150 folded
      expect([...hunter.dmgByAbility.values()].some((e) => e.ability === 'Auto Shot')).toBe(true);
      expect(
        [...hunter.dmgByAbility.values()].some(
          (e) => e.ability === 'Bite' && e.petName === 'Wolf Pet',
        ),
      ).toBe(true);

      // Meter rows on dmg tab show Hunter once with 450 total
      const rows = buildMeterRows({
        tallies: m.current!.tallies.values(),
        tab: 'dmg',
        liveThreat: null,
        petsByOwner: null,
        mainMobId: 50,
        aggroPid: null,
      });
      const hunterRow = rows.find((r) => r.tally.pid === 3);
      expect(hunterRow).toBeDefined();
      expect(hunterRow!.value).toBe(450);
    });
  });

  describe('10. Boss Phase Filtering', () => {
    it('partitions combat tallies into phases and supports phase inspection', () => {
      // Phase 1 damage
      m.onEvent(dmg(1, 50, 500, 'Strike'), w, party, 1000);
      expect(m.current!.phases.currentPhase).toBe('Phase 1');

      // Transition to Intermission
      m.markPhase('Intermission', 5);
      expect(m.current!.phases.currentPhase).toBe('Intermission');
      m.onEvent(dmg(1, 51, 300, 'Cleave'), w, party, 6000);

      // Transition to Phase 2
      m.markPhase('Phase 2', 10);
      m.onEvent(dmg(1, 50, 700, 'Execute'), w, party, 11000);

      const warrior = m.current!.tallies.get(1)!;
      expect(warrior.dmg).toBe(1500); // total 500 + 300 + 700

      expect(warrior.phaseTallies.get('Phase 1')?.dmg).toBe(500);
      expect(warrior.phaseTallies.get('Intermission')?.dmg).toBe(300);
      expect(warrior.phaseTallies.get('Phase 2')?.dmg).toBe(700);
    });
  });

  describe('11. Fight Comparison', () => {
    it('compares two encounters and computes differential metrics', () => {
      // Encounter A: 10s duration, 1000 dmg, 1 death
      const encA = m.current!;
      m.onEvent(dmg(1, 50, 1000, 'Strike'), w, party, 1000);
      m.onEvent({ type: 'playerDeath', pid: 1 }, w, party, 5000);
      m.update(w, party, 11000);

      // Close encounter A
      m.endEncounter();
      expect(m.history).toHaveLength(1);

      // Encounter B: 10s duration, 1500 dmg, 0 deaths
      m.onEvent(dmg(1, 50, 1500, 'Strike'), w, party, 20000);
      m.update(w, party, 30000);
      m.endEncounter();
      expect(m.history).toHaveLength(2);

      const comp = compareEncounters(m.history[1], m.history[0]);
      expect(comp.metrics).toBeDefined();

      const dpsMetric = comp.metrics.find((x) => x.name.includes('DPS'));
      expect(dpsMetric).toBeDefined();
      expect(dpsMetric!.better).toBe('B'); // Fight B had higher DPS

      const deathsMetric = comp.metrics.find(
        (x) => x.name.includes('Muertes') || x.name.includes('Deaths'),
      );
      expect(deathsMetric).toBeDefined();
      expect(deathsMetric!.better).toBe('B'); // Fight B had fewer deaths
    });
  });

  describe('12. Combat Timeline', () => {
    it('captures key encounter timeline milestones', () => {
      const timeline = new EncounterTimeline();
      timeline.addEvent({ timeSec: 10, type: 'phase', label: 'Phase 2: Adds' });
      timeline.addEvent({ timeSec: 25, type: 'interrupt', label: 'Pummel', target: 'Ignivar' });
      timeline.addEvent({ timeSec: 42, type: 'death', label: 'Warrior', source: 'Ignivar' });

      const rows = buildTimelineRows(timeline.getEvents(), 0);
      expect(rows).toHaveLength(3);
      expect(rows[0].timeFormatted).toBe('10s');
      expect(rows[0].icon).toBe('[P]');
      expect(rows[1].icon).toBe('[Int]');
      expect(rows[2].icon).toBe('[D]');
    });
  });

  describe('13. Developer Balance Analysis', () => {
    it('summarizes ability statistics across all raid members', () => {
      // Warrior deals 500 with Mortal Strike (2 hits, 1 crit)
      m.onEvent(dmg(1, 50, 200, 'Mortal Strike', false), w, party, 1000);
      m.onEvent(dmg(1, 50, 300, 'Mortal Strike', true), w, party, 2000);
      // Hunter also deals 400 with Mortal Strike (1 hit)
      m.onEvent(dmg(3, 50, 400, 'Mortal Strike', false), w, party, 3000);

      const stats = buildAbilityBalanceStats(m.current!);
      const msStat = stats.find((s) => s.ability === 'Mortal Strike');
      expect(msStat).toBeDefined();
      expect(msStat!.totalDamage).toBe(900);
      expect(msStat!.hits).toBe(3);
      expect(msStat!.crits).toBe(1);
      expect(msStat!.critRate).toBeCloseTo(33.3, 1);
      expect(msStat!.minHit).toBe(200);
      expect(msStat!.maxHit).toBe(400);
    });
  });

  describe('14. Encounter Data Export (Text & JSON)', () => {
    it('exports encounter as formatted text summary', () => {
      m.onEvent(dmg(1, 50, 1000, 'Mortal Strike'), w, party, 1000);
      m.onEvent(dmg(50, 1, 300, 'Magma Pool'), w, party, 2000); // avoidable
      m.onEvent({ type: 'playerDeath', pid: 1 }, w, party, 3000);

      const text = exportEncounterAsText(m.current!);
      expect(text).toContain('Damage Done:');
      expect(text).toContain('Warrior');
      expect(text).toContain('Deaths:');
    });

    it('exports encounter as structured JSON with schemaVersion', () => {
      m.onEvent(dmg(1, 50, 1000, 'Mortal Strike'), w, party, 1000);
      const jsonStr = exportEncounterAsJson(m.current!);
      const data = JSON.parse(jsonStr);

      expect(data.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
      expect(data.encounter).toBeDefined();
      expect(data.players).toBeInstanceOf(Array);
      expect(data.players[0].name).toBe('Warrior');
      expect(data.players[0].dmg).toBe(1000);
    });
  });
});
