export const NYTHRAXIS_DUNGEON_ID = 'nythraxis_boss_arena';
export const NYTHRAXIS_BOSS_TEMPLATE_ID = 'nythraxis_scourge_of_thornpeak';
export const NYTHRAXIS_ALDRIC_TEMPLATE_ID = 'brother_aldric_raid';
// Every brother_aldric* template shares this visual key, and the Eastbrook
// brother_aldric is a static zone NPC: a character that entered the world there
// already compiled it, so the catalog's Aldric arm is skipped and the aldric
// A/B row reads +0 on BOTH legs. The bench records the warm state so that row
// is never read as proof the prewarm did the work.
export const NYTHRAXIS_ALDRIC_VISUAL_KEY = 'npc_aldric';
export const NYTHRAXIS_ALDRIC_SPAWN_DIST = 50;
export const NYTHRAXIS_PHASE_TWO_HP_PERCENT = 50;
export const DUNGEON_INSTANCE_X_MIN = 100_000;
// Arena layout, mirrored from DUNGEON_DEFS.nythraxis_boss_arena (entry) and
// NYTHRAXIS_RAID_SPAWN_LIST (boss). The gap between them is 92 yd, wider than
// the mob interest radius, so an observer parked on the entry pad never sees
// the boss: the bench has to walk in before it can trip the 70% transition.
export const NYTHRAXIS_ARENA_ENTRY_LOCAL = Object.freeze({ x: 0, z: 4 });
export const NYTHRAXIS_BOSS_SPAWN_LOCAL = Object.freeze({ x: 0, z: 96 });
export const MOB_INTEREST_RADIUS = 90;
// Where the observer is parked between legs. World entry prewarms every static
// NPC MODEL of the spawn zone, and Eastbrook, Mirefen and Thornpeak each place
// a brother_aldric on the shared npc_aldric key, so a character that enters in
// any of them has Aldric linked before the leg starts and the aldric row
// measures nothing. Farshore Isle places none (pinned against the live NPC
// table), and it is a level 3 to 7 hub, so a geared observer parks there safely.
export const ALDRIC_FREE_PARK_POS = Object.freeze({ x: 296, z: 80 });
export const NYTHRAXIS_HITCH_PHASES = Object.freeze([
  'entry',
  'arrival',
  'boss',
  'aldric',
  'soulRend',
]);
export const NYTHRAXIS_HITCH_COMPARE_KEYS = Object.freeze([
  'worstGapMs',
  'stallsOver150',
  'programsDelta',
]);

export function encounterPrewarmQueryValue(prewarm) {
  return prewarm ? null : '0';
}

export function nythraxisHitchObserverUrl({ origin, gfx = 'insane', prewarm = true }) {
  const url = new URL(origin);
  url.searchParams.set('perf', '');
  url.searchParams.set('perfTrace', '1');
  url.searchParams.set('gfx', gfx);
  const kill = encounterPrewarmQueryValue(prewarm);
  if (kill !== null) url.searchParams.set('encounterPrewarm', kill);
  else url.searchParams.delete('encounterPrewarm');
  return url.toString();
}

export function parseNythraxisHitchLegs(raw) {
  const parts = String(raw ?? 'cold,warm')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const allowed = new Set(['cold', 'warm']);
  if (parts.length === 0 || parts.some((part) => !allowed.has(part))) {
    throw new Error('BENCH_LEGS must be a comma list of cold and/or warm');
  }
  return [...new Set(parts)];
}

export function aldricSpawnStandingPos(bossPos, dist = NYTHRAXIS_ALDRIC_SPAWN_DIST) {
  return { x: bossPos.x, z: bossPos.z - dist };
}

/** Where Nythraxis stands, derived from the arena entry pad the client reports. */
export function nythraxisBossSpawnFromEntry(entryPos) {
  return {
    x: entryPos.x + (NYTHRAXIS_BOSS_SPAWN_LOCAL.x - NYTHRAXIS_ARENA_ENTRY_LOCAL.x),
    z: entryPos.z + (NYTHRAXIS_BOSS_SPAWN_LOCAL.z - NYTHRAXIS_ARENA_ENTRY_LOCAL.z),
  };
}

export function planarDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** The server's mob interest gate: outside it the boss is absent from world.entities. */
export function withinMobInterest(viewerPos, entityPos, radius = MOB_INTEREST_RADIUS) {
  return planarDistance(viewerPos, entityPos) <= radius;
}

export function isInsideNythraxisArena(player) {
  if (!player) return false;
  if (player.dungeonId === NYTHRAXIS_DUNGEON_ID) return true;
  return Number(player.pos?.x) > DUNGEON_INSTANCE_X_MIN;
}

export function summarizeHitchPhase(sample) {
  const gaps = Array.isArray(sample?.worstGaps) ? sample.worstGaps : [];
  return {
    worstGapMs: Number(gaps[0] ?? 0) || 0,
    stallsOver150: Number(sample?.stallsOver150 ?? 0) || 0,
    stallsOver50: Number(sample?.stallsOver50 ?? 0) || 0,
    programsDelta: Number(sample?.programsDelta ?? 0) || 0,
    texturesDelta: Number(sample?.texturesDelta ?? 0) || 0,
    visiblePlayers: Number(sample?.visiblePlayers ?? 0) || 0,
    soulRendFlips: Number(sample?.soulRendFlips ?? 0) || 0,
    aldricSeen: Number(sample?.aldricSeen ?? 0) || 0,
    bossSeen: Number(sample?.bossSeen ?? 0) || 0,
  };
}

export function combatHitchCost(leg) {
  const arrival = summarizeHitchPhase(leg?.arrival);
  const soulRend = summarizeHitchPhase(leg?.soulRend);
  return {
    worstGapMs: Math.max(arrival.worstGapMs, soulRend.worstGapMs),
    stallsOver150: arrival.stallsOver150 + soulRend.stallsOver150,
    stallsOver50: arrival.stallsOver50 + soulRend.stallsOver50,
    programsDelta: arrival.programsDelta + soulRend.programsDelta,
    texturesDelta: arrival.texturesDelta + soulRend.texturesDelta,
  };
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

/** A gap the renderer does not explain is either JS on the main thread (a long
 * task covers it) or a pause outside any task at all (GC between tasks, media
 * decode, compositor, the process being descheduled). The classifier is the
 * difference between "our code is slow" and "the browser stopped for us". */
export const HITCH_LONG_TASK_COVERAGE = 0.6;
// A label that fires steadily through the whole window (the boss track calls
// play() about four times a second) lands inside almost any gap by chance, so
// crediting it reads as an attribution when it is only background. Only labels
// rare enough to mean something are attached; the rest are counted, not named.
export const HITCH_BACKGROUND_MARK_COUNT = 5;

export function attributeHitchGaps({ gaps = [], longTasks = [], marks = [] } = {}) {
  const labelCounts = new Map();
  for (const mark of marks) {
    labelCounts.set(mark.label, (labelCounts.get(mark.label) ?? 0) + 1);
  }
  const isBackground = (label) => (labelCounts.get(label) ?? 0) > HITCH_BACKGROUND_MARK_COUNT;
  return gaps.map((gap) => {
    const end = Number(gap.at) || 0;
    const start = end - (Number(gap.ms) || 0);
    let covered = 0;
    for (const task of longTasks) {
      const taskStart = Number(task.startTime) || 0;
      const taskEnd = taskStart + (Number(task.duration) || 0);
      covered += Math.max(0, Math.min(end, taskEnd) - Math.max(start, taskStart));
    }
    const ms = round1(Number(gap.ms) || 0);
    const inside = marks.filter((mark) => Number(mark.at) >= start && Number(mark.at) <= end);
    return {
      atMs: round1(end),
      ms,
      longTaskMs: round1(covered),
      cause: ms > 0 && covered / ms >= HITCH_LONG_TASK_COVERAGE ? 'long-task' : 'off-task',
      marks: inside.filter((mark) => !isBackground(mark.label)).map((mark) => mark.label),
      backgroundMarks: inside.filter((mark) => isBackground(mark.label)).length,
    };
  });
}

export function formatHitchGapAttribution(attributed) {
  if (!attributed || attributed.length === 0) return 'no gap over the reporting floor';
  return attributed
    .slice(0, 3)
    .map(
      (gap) =>
        `${gap.ms}ms ${gap.cause}${gap.longTaskMs > 0 ? ` (longTask ${gap.longTaskMs}ms)` : ''}${
          gap.marks.length ? ` [${gap.marks.join(',')}]` : ''
        }${gap.backgroundMarks ? ` (+${gap.backgroundMarks} background)` : ''}`,
    )
    .join('; ');
}

function deltaMetric(before, after) {
  return { before, after, delta: round1(after - before) };
}

function sectionDelta(before, after) {
  const out = {};
  for (const key of NYTHRAXIS_HITCH_COMPARE_KEYS) {
    out[key] = deltaMetric(before[key], after[key]);
  }
  return out;
}

export function compareNythraxisHitchLegs(cold, warm) {
  return {
    entry: sectionDelta(summarizeHitchPhase(cold?.entry), summarizeHitchPhase(warm?.entry)),
    arrival: sectionDelta(summarizeHitchPhase(cold?.arrival), summarizeHitchPhase(warm?.arrival)),
    boss: sectionDelta(summarizeHitchPhase(cold?.boss), summarizeHitchPhase(warm?.boss)),
    aldric: sectionDelta(summarizeHitchPhase(cold?.aldric), summarizeHitchPhase(warm?.aldric)),
    soulRend: sectionDelta(
      summarizeHitchPhase(cold?.soulRend),
      summarizeHitchPhase(warm?.soulRend),
    ),
    combat: sectionDelta(combatHitchCost(cold), combatHitchCost(warm)),
  };
}

function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text : ' '.repeat(width - text.length) + text;
}

function signed(value) {
  return value > 0 ? `+${value}` : String(value);
}

export function formatNythraxisHitchCompare(compare) {
  const rows = [
    ['entry', compare.entry],
    ['arrival', compare.arrival],
    ['boss (first sight)', compare.boss],
    ['aldric', compare.aldric],
    ['soulRend', compare.soulRend],
    ['combat (arrival+soulRend)', compare.combat],
  ];
  const lines = [
    'Nythraxis hitch A/B (cold = no encounter prewarm, warm = prewarm on)',
    `${pad('', 28)} ${pad('cold', 8)} ${pad('warm', 8)} ${pad('delta', 8)}`,
  ];
  for (const [label, section] of rows) {
    lines.push(label);
    for (const key of NYTHRAXIS_HITCH_COMPARE_KEYS) {
      const cell = section[key];
      lines.push(
        `  ${pad(key, 26)} ${pad(cell.before, 8)} ${pad(cell.after, 8)} ${pad(signed(cell.delta), 8)}`,
      );
    }
  }
  return lines.join('\n');
}
