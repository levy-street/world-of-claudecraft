import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ALDRIC_FREE_PARK_POS,
  aldricSpawnStandingPos,
  attributeHitchGaps,
  combatHitchCost,
  compareNythraxisHitchLegs,
  DUNGEON_INSTANCE_X_MIN,
  encounterPrewarmQueryValue,
  formatHitchGapAttribution,
  formatNythraxisHitchCompare,
  HITCH_BACKGROUND_MARK_COUNT,
  HITCH_LONG_TASK_COVERAGE,
  isInsideNythraxisArena,
  MOB_INTEREST_RADIUS,
  NYTHRAXIS_ALDRIC_SPAWN_DIST,
  NYTHRAXIS_ALDRIC_TEMPLATE_ID,
  NYTHRAXIS_ALDRIC_VISUAL_KEY,
  NYTHRAXIS_ARENA_ENTRY_LOCAL,
  NYTHRAXIS_BOSS_SPAWN_LOCAL,
  NYTHRAXIS_BOSS_TEMPLATE_ID,
  NYTHRAXIS_DUNGEON_ID,
  NYTHRAXIS_HITCH_PHASES,
  NYTHRAXIS_PHASE_TWO_HP_PERCENT,
  nythraxisBossSpawnFromEntry,
  nythraxisHitchObserverUrl,
  parseNythraxisHitchLegs,
  planarDistance,
  summarizeHitchPhase,
  withinMobInterest,
} from '../scripts/lib/nythraxis_hitch_bench.mjs';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';

const SCRIPT = codeWithoutLineComments(
  readFileSync(new URL('../scripts/nythraxis_hitch_bench.mjs', import.meta.url), 'utf8'),
);

function phase(over = {}) {
  return {
    worstGaps: [over.worstGapMs ?? 10],
    stallsOver150: over.stallsOver150 ?? 0,
    stallsOver50: over.stallsOver50 ?? 0,
    programsDelta: over.programsDelta ?? 0,
    texturesDelta: over.texturesDelta ?? 0,
    visiblePlayers: over.visiblePlayers ?? 0,
    soulRendFlips: over.soulRendFlips ?? 0,
    aldricSeen: over.aldricSeen ?? 0,
  };
}

describe('nythraxis hitch bench helpers', () => {
  it('builds the observer URL with the encounter-prewarm kill switch on the cold leg', () => {
    expect(encounterPrewarmQueryValue(true)).toBeNull();
    expect(encounterPrewarmQueryValue(false)).toBe('0');
    expect(nythraxisHitchObserverUrl({ origin: 'http://localhost:5199/', gfx: 'insane' })).toBe(
      'http://localhost:5199/?perf=&perfTrace=1&gfx=insane',
    );
    expect(
      nythraxisHitchObserverUrl({
        origin: 'http://localhost:5199/',
        gfx: 'insane',
        prewarm: false,
      }),
    ).toBe('http://localhost:5199/?perf=&perfTrace=1&gfx=insane&encounterPrewarm=0');
  });

  it('parses cold/warm legs and rejects anything else', () => {
    expect(parseNythraxisHitchLegs(undefined)).toEqual(['cold', 'warm']);
    expect(parseNythraxisHitchLegs('warm')).toEqual(['warm']);
    expect(parseNythraxisHitchLegs('cold,cold,warm')).toEqual(['cold', 'warm']);
    expect(() => parseNythraxisHitchLegs('hot')).toThrow(/cold and\/or warm/);
  });

  it('treats Nythraxis arena membership as dungeon id or instance x', () => {
    expect(NYTHRAXIS_DUNGEON_ID).toBe('nythraxis_boss_arena');
    expect(isInsideNythraxisArena(null)).toBe(false);
    expect(isInsideNythraxisArena({ dungeonId: NYTHRAXIS_DUNGEON_ID, pos: { x: 0 } })).toBe(true);
    expect(isInsideNythraxisArena({ dungeonId: null, pos: { x: DUNGEON_INSTANCE_X_MIN } })).toBe(
      false,
    );
    expect(
      isInsideNythraxisArena({ dungeonId: null, pos: { x: DUNGEON_INSTANCE_X_MIN + 1 } }),
    ).toBe(true);
    const data = readFileSync(new URL('../src/sim/data.ts', import.meta.url), 'utf8');
    expect(data).toContain('export const INSTANCE_X_BASE = 99_400');
    expect(data).toContain('export const DUNGEON_X_THRESHOLD = INSTANCE_X_BASE + 600');
    expect(DUNGEON_INSTANCE_X_MIN).toBe(100_000);
  });

  it('adds arrival and soulRend into the mid-combat cost the A/B table highlights', () => {
    const cold = {
      entry: phase({ programsDelta: 40, worstGapMs: 200, stallsOver150: 1 }),
      arrival: phase({ programsDelta: 80, worstGapMs: 1800, stallsOver150: 2 }),
      boss: phase({ programsDelta: 6, worstGapMs: 263.4, stallsOver150: 1 }),
      aldric: phase({ programsDelta: 12, worstGapMs: 500, stallsOver150: 1 }),
      soulRend: phase({ programsDelta: 30, worstGapMs: 400, stallsOver150: 1 }),
    };
    const warm = {
      entry: phase({ programsDelta: 160, worstGapMs: 350, stallsOver150: 2 }),
      arrival: phase({ programsDelta: 3, worstGapMs: 40, stallsOver150: 0 }),
      boss: phase({ programsDelta: 6, worstGapMs: 256, stallsOver150: 1 }),
      aldric: phase({ programsDelta: 0, worstGapMs: 24, stallsOver150: 0 }),
      soulRend: phase({ programsDelta: 1, worstGapMs: 22, stallsOver150: 0 }),
    };
    expect(summarizeHitchPhase(cold.arrival).worstGapMs).toBe(1800);
    expect(combatHitchCost(cold)).toEqual({
      worstGapMs: 1800,
      stallsOver150: 3,
      stallsOver50: 0,
      programsDelta: 110,
      texturesDelta: 0,
    });
    const compare = compareNythraxisHitchLegs(cold, warm);
    expect(compare.combat.programsDelta).toEqual({ before: 110, after: 4, delta: -106 });
    expect(compare.aldric.programsDelta).toEqual({ before: 12, after: 0, delta: -12 });
    expect(compare.entry.programsDelta.delta).toBe(120);
    const table = formatNythraxisHitchCompare(compare);
    expect(table).toContain('combat (arrival+soulRend)');
    expect(table).toContain('aldric');
    expect(table).toContain('boss (first sight)');
    expect(table).toContain('-106');
    expect(table).toContain('+120');
    expect(table).toContain('-12');
    // The boss first sight is reported, never folded into the combat cost.
    expect(compare.boss.programsDelta).toEqual({ before: 6, after: 6, delta: 0 });
    expect(compare.combat.programsDelta.before).toBe(110);
    // Float noise never reaches the table: 256 - 263.4 prints as -7.4, not -7.399999999999977.
    expect(compare.boss.worstGapMs.delta).toBe(-7.4);
    expect(table).toContain('-7.4');
    expect(table).not.toMatch(/-7\.39999/);
  });

  it('separates a gap the main thread spent in JS from one it spent outside any task', () => {
    const gaps = [
      { at: 1000, ms: 200 }, // 800..1000, JS
      { at: 2000, ms: 200 }, // 1800..2000, nothing running
      { at: 3000, ms: 200 }, // 2800..3000, a sliver of JS only
    ];
    const longTasks = [
      { startTime: 810, duration: 180 },
      { startTime: 2820, duration: 20 },
    ];
    const marks = [
      { label: 'flip-start', at: 805 },
      { label: 'media-play:nythraxis_line.mp3', at: 1850 },
      { label: 'outside-every-gap', at: 4000 },
    ];
    const attributed = attributeHitchGaps({ gaps, longTasks, marks });
    expect(attributed[0]).toEqual({
      atMs: 1000,
      ms: 200,
      longTaskMs: 180,
      cause: 'long-task',
      marks: ['flip-start'],
      backgroundMarks: 0,
    });
    expect(attributed[1]).toEqual({
      atMs: 2000,
      ms: 200,
      longTaskMs: 0,
      cause: 'off-task',
      marks: ['media-play:nythraxis_line.mp3'],
      backgroundMarks: 0,
    });
    // A sliver of JS under the coverage bar is not an attribution.
    expect(attributed[2].cause).toBe('off-task');
    expect(attributed[2].longTaskMs).toBe(20);
    expect(HITCH_LONG_TASK_COVERAGE).toBeGreaterThan(0.5);
    expect(attributeHitchGaps({})).toEqual([]);
    const line = formatHitchGapAttribution(attributed);
    expect(line).toContain('200ms long-task (longTask 180ms) [flip-start]');
    expect(line).toContain('200ms off-task [media-play:nythraxis_line.mp3]');
    expect(formatHitchGapAttribution([])).toBe('no gap over the reporting floor');
  });

  it('never credits a mark that fires all window long, which is how the boss track misled a read', () => {
    // The boss element gets play() called about four times a second, so one of
    // its marks lands inside almost any gap. Naming it reads as an attribution
    // and is pure coincidence; the count is reported instead.
    const noisy = Array.from({ length: 12 }, (_, i) => ({
      label: 'media-play:dungeon-boss-fight.mp3',
      at: 900 + i * 20,
    }));
    const attributed = attributeHitchGaps({
      gaps: [{ at: 1200, ms: 400 }],
      longTasks: [{ startTime: 810, duration: 390 }],
      marks: [...noisy, { label: 'flip-start', at: 1000 }],
    });
    expect(attributed[0].marks).toEqual(['flip-start']);
    expect(attributed[0].backgroundMarks).toBe(12);
    expect(attributed[0].cause).toBe('long-task');
    expect(formatHitchGapAttribution(attributed)).toContain('(+12 background)');
    expect(formatHitchGapAttribution(attributed)).not.toContain('dungeon-boss-fight');
    // A label just under the floor is still a real signal and stays named.
    const sparse = Array.from({ length: HITCH_BACKGROUND_MARK_COUNT }, (_, i) => ({
      label: 'decodeAudioData',
      at: 1000 + i,
    }));
    const rare = attributeHitchGaps({
      gaps: [{ at: 1200, ms: 400 }],
      longTasks: [],
      marks: sparse,
    });
    expect(rare[0].marks).toEqual(sparse.map(() => 'decodeAudioData'));
    expect(rare[0].backgroundMarks).toBe(0);
  });

  it('walks the observer in: the entry pad is outside mob interest, the Aldric spawn point is inside', () => {
    const entry = { x: 103_300, z: -1246 };
    const bossSpawn = nythraxisBossSpawnFromEntry(entry);
    expect(bossSpawn).toEqual({ x: 103_300, z: -1154 });
    expect(planarDistance(entry, bossSpawn)).toBe(92);
    // The bug this phase exists for: standing on the entry pad, the boss is
    // never in world.entities, so the 70% transition can never be tripped.
    expect(withinMobInterest(entry, bossSpawn)).toBe(false);
    const walkIn = aldricSpawnStandingPos(bossSpawn, NYTHRAXIS_ALDRIC_SPAWN_DIST);
    expect(withinMobInterest(walkIn, bossSpawn)).toBe(true);
    expect(planarDistance(walkIn, bossSpawn)).toBe(NYTHRAXIS_ALDRIC_SPAWN_DIST);
    const layout = readFileSync(new URL('../src/sim/content/dungeons.ts', import.meta.url), 'utf8');
    expect(layout).toContain(
      `{ mobId: 'nythraxis_scourge_of_thornpeak', x: ${NYTHRAXIS_BOSS_SPAWN_LOCAL.x}, z: ${NYTHRAXIS_BOSS_SPAWN_LOCAL.z} }`,
    );
    expect(layout).toContain(
      `entry: { x: ${NYTHRAXIS_ARENA_ENTRY_LOCAL.x}, z: ${NYTHRAXIS_ARENA_ENTRY_LOCAL.z} }`,
    );
    const server = readFileSync(new URL('../server/game.ts', import.meta.url), 'utf8');
    expect(server).toContain('const INTEREST_RADIUS = PLAYER_INTEREST_RADIUS');
  });

  it('stands the observer on the live Aldric spawn and keeps that distance pinned to the encounter', () => {
    expect(NYTHRAXIS_HITCH_PHASES).toEqual(['entry', 'arrival', 'boss', 'aldric', 'soulRend']);
    expect(NYTHRAXIS_BOSS_TEMPLATE_ID).toBe('nythraxis_scourge_of_thornpeak');
    expect(NYTHRAXIS_ALDRIC_TEMPLATE_ID).toBe('brother_aldric_raid');
    expect(NYTHRAXIS_PHASE_TWO_HP_PERCENT / 100).toBeLessThanOrEqual(0.7);
    expect(aldricSpawnStandingPos({ x: 10, z: 80 })).toEqual({
      x: 10,
      z: 80 - NYTHRAXIS_ALDRIC_SPAWN_DIST,
    });
    const encounter = readFileSync(
      new URL('../src/sim/encounters/nythraxis.ts', import.meta.url),
      'utf8',
    );
    expect(encounter).toContain(`NYTHRAXIS_ALDRIC_SPAWN_DIST = ${NYTHRAXIS_ALDRIC_SPAWN_DIST}`);
    expect(encounter).toContain('NYTHRAXIS_PHASE_TWO_HP = 0.7');
    expect(encounter).toContain('spawnNythraxisAldric');
    expect(encounter).toContain('createNpc(');
  });
});

describe('nythraxis hitch bench script', () => {
  it('reuses the geared arrival roster, raid enter, and Soul Rend flip', () => {
    expect(SCRIPT).toContain("from './profiler/geared_arrival_roster.mjs'");
    expect(SCRIPT).toContain('new GearedArrivalRoster(');
    expect(SCRIPT).toContain("window.__game.world.chat('/dev raid normal')");
    expect(SCRIPT).toContain('visual.setSoulRend = () => orig(true)');
    expect(SCRIPT).toContain('__benchSoulRendPinned');
    expect(SCRIPT).toContain('nythraxisHitchObserverUrl({ origin, gfx: GFX, prewarm })');
    expect(SCRIPT).toContain('--disable-gpu-shader-disk-cache');
    expect(SCRIPT).toContain('assertLoopbackUrl(');
    expect(SCRIPT).toContain('assertLoopbackDatabaseUrl(');
    expect(SCRIPT).toContain('roster.close()');
    expect(SCRIPT).toContain('enterOnlineProfilerCharacter(page');
    expect(SCRIPT).toContain("page.on('dialog'");
    expect(SCRIPT).toContain('dialog.accept()');
  });

  it('caps the crowd and parks bots outside interest until the arrival wave', () => {
    expect(SCRIPT).toContain("throw new Error('BENCH_BOTS must be an integer from 1 to 40')");
    expect(SCRIPT).toContain('prepare({ center: GEARED_ARRIVAL_PEN })');
    expect(SCRIPT).toContain('roster.placeAll(arena)');
    expect(SCRIPT).toContain('roster.placeAll(GEARED_ARRIVAL_PEN)');
  });

  it('settles programs after the warm arrival wave so live Soul Rend compile is not in the flip window', () => {
    const arrivalAt = SCRIPT.indexOf("logPhase('arrival', arrival)");
    const bossAt = SCRIPT.indexOf("logPhase('boss', bossSight)");
    const aldricAt = SCRIPT.indexOf("logPhase('aldric', aldric)");
    const soulAt = SCRIPT.indexOf("logPhase('soulRend', soulRend)");
    expect(arrivalAt).toBeGreaterThan(-1);
    expect(bossAt).toBeGreaterThan(arrivalAt);
    expect(aldricAt).toBeGreaterThan(bossAt);
    expect(soulAt).toBeGreaterThan(aldricAt);
    expect(SCRIPT.slice(arrivalAt, bossAt)).toContain('settlePrograms(page)');
    expect(SCRIPT.slice(bossAt, aldricAt)).toContain('settlePrograms(page)');
    expect(SCRIPT.slice(aldricAt, soulAt)).toContain('settlePrograms(page)');
  });

  it('walks into mob interest before it looks the boss up, and measures that first sight', () => {
    const bossAt = SCRIPT.indexOf("logPhase('boss', bossSight)");
    const lookupAt = SCRIPT.indexOf('seenBoss = await awaitBossView(page');
    expect(lookupAt).toBeGreaterThan(-1);
    expect(lookupAt).toBeLessThan(bossAt);
    expect(SCRIPT).toContain('nythraxisBossSpawnFromEntry(arena)');
    expect(SCRIPT).toContain('teleportObserver(page, walkIn)');
    expect(SCRIPT).toContain('Nythraxis never entered interest from');
    // The lookup rides the measured window, so the first sight of the boss rig
    // is a reported phase rather than untimed setup.
    const measureAt = SCRIPT.indexOf('const bossSight = await measureWindow(');
    expect(measureAt).toBeGreaterThan(-1);
    expect(measureAt).toBeLessThan(lookupAt);
  });

  it('parks the observer in an Aldric-free start zone before every leg', async () => {
    const { NPCS, zoneAt } = await import('../src/sim/data');
    const park = zoneAt(ALDRIC_FREE_PARK_POS.x, ALDRIC_FREE_PARK_POS.z);
    expect(park.id).not.toBe('eastbrook_vale');
    // Decisive: world entry prewarms the spawn zone's static NPC models, so the
    // park zone must place no brother_aldric at all. Placing one there later
    // (a new hub NPC) fails here instead of silently voiding the aldric row.
    const aldricsInParkZone = Object.values(NPCS).filter(
      (npc) =>
        !npc.dynamic &&
        npc.pos &&
        zoneAt(npc.pos.x, npc.pos.z).id === park.id &&
        npc.id.startsWith('brother_aldric'),
    );
    expect(aldricsInParkZone).toEqual([]);
    // And the zones the observer would otherwise start in DO place one, which
    // is the whole reason the park exists.
    for (const zoneId of ['eastbrook_vale', 'mirefen_marsh', 'thornpeak_heights']) {
      const placed = Object.values(NPCS).filter(
        (npc) =>
          !npc.dynamic &&
          npc.pos &&
          zoneAt(npc.pos.x, npc.pos.z).id === zoneId &&
          npc.id.startsWith('brother_aldric'),
      );
      expect(placed.length).toBeGreaterThan(0);
    }

    const parkAt = SCRIPT.indexOf('await parkObserver(fixture, ALDRIC_FREE_PARK_POS)');
    const legAt = SCRIPT.indexOf('legs[name] = await runLeg(');
    expect(parkAt).toBeGreaterThan(-1);
    expect(parkAt).toBeLessThan(legAt);
    // Inside the leg loop, so the warm leg is parked too, not just the first.
    const loopAt = SCRIPT.indexOf('for (const name of LEGS) {');
    expect(loopAt).toBeGreaterThan(-1);
    expect(loopAt).toBeLessThan(parkAt);
    expect(SCRIPT).toContain('fixture.characterId = await createObserverCharacter(fixture)');
    expect(SCRIPT).toContain('worldAuthMessage(fixture.token, fixture.characterId)');
    expect(SCRIPT).toMatch(/\/dev tp \$\{pos\.x\} \$\{pos\.z\}/);
    expect(SCRIPT).toContain("JSON.stringify({ t: 'logout' })");
  });

  it('records that the entry zone already warmed the Aldric model, so the aldric row is not read as proof', () => {
    const manifest = readFileSync(
      new URL('../src/render/characters/manifest.ts', import.meta.url),
      'utf8',
    );
    // Eastbrook's brother_aldric is a static zone NPC and shares this key with
    // the raid Aldric, so world entry compiles it before any leg starts.
    expect(manifest).toContain(`${NYTHRAXIS_ALDRIC_TEMPLATE_ID}: '${NYTHRAXIS_ALDRIC_VISUAL_KEY}'`);
    expect(manifest).toContain(
      `if (e.templateId.startsWith('brother_aldric')) return '${NYTHRAXIS_ALDRIC_VISUAL_KEY}'`,
    );
    const zone1 = readFileSync(new URL('../src/sim/content/zone1.ts', import.meta.url), 'utf8');
    expect(zone1).toContain("id: 'brother_aldric'");
    // The encounter prewarm deliberately warms no NPC at all: this row is the
    // measurement that says Aldric never needed it.
    const prewarm = readFileSync(
      new URL('../src/render/interior_encounter_prewarm.ts', import.meta.url),
      'utf8',
    );
    expect(prewarm).not.toContain('npcTemplateIds');

    const probeAt = SCRIPT.indexOf('const aldricVisualWarmAtEntry = await page.evaluate(');
    const raidAt = SCRIPT.indexOf("window.__game.world.chat('/dev raid normal')");
    expect(probeAt).toBeGreaterThan(-1);
    expect(probeAt).toBeLessThan(raidAt);
    expect(SCRIPT).toContain('prewarmedNpcModels?.has(key)');
    expect(SCRIPT).toContain('aldricVisualWarmAtEntry');
    expect(SCRIPT).toContain('was already warm at world entry');
  });

  it('trips the live 70% Aldric NPC spawn instead of a /dev spawn stand-in', () => {
    expect(SCRIPT).toContain('NYTHRAXIS_PHASE_TWO_HP_PERCENT');
    expect(SCRIPT).toMatch(/\/dev hp \$\{percent\}/);
    expect(SCRIPT).toContain('NYTHRAXIS_ALDRIC_TEMPLATE_ID');
    expect(SCRIPT).toContain('NYTHRAXIS_BOSS_TEMPLATE_ID');
    expect(SCRIPT).toContain("entity.kind !== 'npc'");
    expect(SCRIPT).toContain("aldric.aldricKind !== 'npc'");
    expect(SCRIPT).toContain('aldricSpawnStandingPos(boss, NYTHRAXIS_ALDRIC_SPAWN_DIST)');
    expect(SCRIPT).toContain('window.__game.world.targetEntity(id)');
    expect(SCRIPT).not.toContain('/dev spawn brother_aldric');
  });
});
