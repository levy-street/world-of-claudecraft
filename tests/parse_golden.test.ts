// The parse-capture golden: a scripted deterministic scenario (an arena match
// with pet damage, aura enrichment, and overheal, then a dungeon boss pull
// with cast synthesis) must serialize to a byte-identical NDJSON record
// stream. This is the regression pin a sim or recorder change trips BEFORE
// anyone reads a dashboard, and the SAME fixture is the ingest test in
// woc-parse-service (contract/fixtures/, copied verbatim; both suites assert
// their own copy). Regenerate deliberately: UPDATE_PARSE_GOLDEN=1 npx vitest
// run tests/parse_golden.test.ts, then re-copy the fixture to the service.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import type { FightParticipant } from '../server/parse/contract';
import { createParseCounters } from '../server/parse/counters';
import { ParseRecorder } from '../server/parse/recorder';
import type { SimEvent } from '../src/sim/types';
import { FAKE_PARSE_FLAGS, type FakeSim, fakePlayer, fakeSim } from './helpers/parse_fake_sim';

const FIXTURE = path.join(__dirname, 'fixtures', 'parse_golden.ndjson');

function resolver(sim: FakeSim): (pid: number) => FightParticipant | null {
  return (pid) => {
    if (pid >= 100) return null;
    const entity = sim.entities.get(pid);
    if (entity === undefined) return null;
    return {
      entityId: pid,
      characterId: pid + 1000,
      name: `Char${pid}`,
      class: entity.templateId,
      spec: 'frost',
      level: entity.level,
      team: null,
      snapshot: { level: entity.level, class: entity.templateId },
    };
  };
}

function runScenario(): string {
  const sim = fakeSim();
  const records: Record<string, unknown>[] = [];
  let seq = 0;
  const recorder = new ParseRecorder({
    flags: FAKE_PARSE_FLAGS,
    sim,
    sink: { enqueue: (r) => records.push(r) },
    counters: createParseCounters(),
    resolveParticipant: resolver(sim),
    isBossTemplate: (t) => t === 'morthen',
    idFactory: () => `golden-${seq++}`,
    clock: () => 0,
  });
  const observe = (tick: number, events: SimEvent[] = []): void => {
    sim.tickCount = tick;
    recorder.observe(events);
  };

  // Arena 2v2: 5+6 vs 7+8, 5 owns pet 105.
  const match = {
    id: 1,
    format: '2v2',
    teamA: [5, 6],
    teamB: [7, 8],
    state: 'active',
    ratingA: 1512,
    ratingB: 1497,
    defeated: new Set<number>(),
  };
  for (const pid of [5, 6, 7, 8]) {
    sim.entities.set(pid, fakePlayer(pid));
    sim.arenaMatches.set(pid, match);
  }
  sim.entities.set(105, { id: 105, templateId: 'wolf', level: 20, ownerId: 5 });
  const targetSeven = sim.entities.get(7);
  if (targetSeven !== undefined) {
    (targetSeven as { auras: unknown }).auras = [
      { id: 'rend', name: 'Rend', sourceId: 6, stacks: 2 },
    ];
  }

  observe(100);
  observe(101, [
    {
      type: 'damage',
      sourceId: 5,
      targetId: 7,
      amount: 210,
      crit: false,
      school: 'frost',
      ability: 'Frostbolt',
      abilityId: 'frostbolt',
      kind: 'hit',
    },
    {
      type: 'damage',
      sourceId: 105,
      targetId: 7,
      amount: 40,
      crit: false,
      school: 'physical',
      ability: 'Bite',
      kind: 'hit',
    },
    {
      type: 'aura',
      targetId: 7,
      name: 'Rend',
      gained: true,
      sourceId: 6,
      abilityId: 'rend',
      stacks: 2,
    },
  ]);
  observe(102, [
    {
      type: 'heal2',
      sourceId: 8,
      targetId: 7,
      amount: 120,
      crit: false,
      ability: 'Renew',
      hot: true,
      abilityId: 'renew',
      overheal: 55,
    },
    {
      type: 'damage',
      sourceId: 6,
      targetId: 8,
      amount: 480,
      crit: true,
      school: 'physical',
      ability: 'Gravebreaker',
      kind: 'hit',
      absorbed: 60,
    },
  ]);
  match.defeated.add(7).add(8);
  (match as { state: string }).state = 'over';
  observe(140, [
    {
      type: 'damage',
      sourceId: 5,
      targetId: 7,
      amount: 900,
      crit: false,
      school: 'frost',
      ability: 'Ice Lance',
      kind: 'hit',
    },
    { type: 'death', entityId: 7, killerId: 5 },
    { type: 'death', entityId: 8, killerId: 6 },
  ]);

  // Dungeon boss pull with a synthesized interrupted cast, then the kill.
  sim.instances = [
    {
      dungeonId: 'hollow_crypt',
      difficulty: 'heroic',
      slot: 0,
      partyKey: 'party:9',
      mobIds: [500],
    },
  ];
  sim.entities.set(500, {
    id: 500,
    templateId: 'morthen',
    level: 20,
    hp: 5000,
    maxHp: 5000,
    dead: false,
    inCombat: true,
    threat: new Map([[5, 50]]),
  });
  observe(200);
  observe(201, [
    {
      type: 'damage',
      sourceId: 5,
      targetId: 500,
      amount: 300,
      crit: false,
      school: 'frost',
      ability: 'Frostbolt',
      abilityId: 'frostbolt',
      kind: 'hit',
    },
  ]);
  const boss = sim.entities.get(500);
  if (boss !== undefined) {
    boss.castingAbility = 'grave_bolt';
    boss.castTotal = 2.5;
    boss.castRemaining = 2.5;
  }
  observe(202);
  if (boss !== undefined) {
    boss.castingAbility = null;
    boss.castRemaining = 2.2;
  }
  observe(203);
  if (boss !== undefined) boss.dead = true;
  observe(240, [
    {
      type: 'damage',
      sourceId: 5,
      targetId: 500,
      amount: 4700,
      crit: true,
      school: 'frost',
      ability: 'Ice Lance',
      kind: 'hit',
    },
    { type: 'death', entityId: 500, killerId: 5 },
  ]);

  return `${records.map((r) => JSON.stringify(r)).join('\n')}\n`;
}

describe('parse capture golden', () => {
  test('the scripted scenario serializes byte-identically to the fixture', () => {
    const produced = runScenario();
    // Deliberate re-mints only: a MISSING fixture fails loudly instead of
    // self-healing, so the pin cannot silently evaporate.
    if (process.env.UPDATE_PARSE_GOLDEN === '1') {
      writeFileSync(FIXTURE, produced);
    }
    const golden = readFileSync(FIXTURE, 'utf8');

    expect(produced).toBe(golden);
  });

  test('two runs are byte-identical (the recorder itself is deterministic)', () => {
    expect(runScenario()).toBe(runScenario());
  });
});
