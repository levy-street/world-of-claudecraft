// Hourly skill events (src/sim/pvp/skill_events.ts, skill_event_rules.ts and
// the arenas in src/sim/content/skill_event_sites.ts): the rotation, the
// on-the-hour clock, the arenas, the King of the Hill keep-apart rule, joining,
// the undiminished kill bounty and the end-of-event payouts.

import { describe, expect, it } from 'vitest';
import { SKILL_EVENT_SITES } from '../src/sim/content/skill_event_sites';
import { WORLD_QUESTS } from '../src/sim/content/world_quests';
import { BUILTIN_WORLD, ZONES, zoneContaining } from '../src/sim/data';
import { HILL_RADIUS } from '../src/sim/pvp';
import { pickHillSpot, spawnHill } from '../src/sim/pvp/hill';
import {
  nextSkillEventStart,
  SKILL_EVENT_FIRST_START_SECONDS,
  SKILL_EVENT_HEART_GRACE_SECONDS,
  SKILL_EVENT_HEARTS,
  SKILL_EVENT_KILL_HONOR,
  SKILL_EVENT_KINDS,
  SKILL_EVENT_MIN_PRESENCE_SECONDS,
  SKILL_EVENT_PARTICIPATION_HONOR,
  SKILL_EVENT_PERIOD_SECONDS,
  SKILL_EVENT_PORTAL_RADIUS,
  SKILL_EVENT_PROMPT_MARGIN,
  SKILL_EVENT_RADIUS,
  SKILL_EVENT_WARNING_SECONDS,
  SKILL_EVENT_WIN_HONOR,
  skillEventKindFor,
  skillEventSitesAvoiding,
  spotTouchesSkillArena,
} from '../src/sim/pvp/skill_event_rules';
import {
  SKILL_EVENT_JOINED_LINE,
  SKILL_EVENT_NOT_YET_LINE,
  SKILL_EVENT_TOO_FAR_LINE,
  skillEventEndedLine,
  skillEventStartLine,
  skillEventWarningLine,
  skillEventWonLine,
} from '../src/sim/pvp/skill_events';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent, WorldContent } from '../src/sim/types';
import { DT } from '../src/sim/types';
import { inWispMazeFootprint } from '../src/sim/wisp_maze_ground';
import { groundHeight, inGardenMaze } from '../src/sim/world';
import { localizeSimText } from '../src/ui/sim_i18n';

const SEED = 7;
const EMPTY_WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };
const EXCLUDED_ZONES = [
  'proving_shore',
  'eastbrook_vale',
  'farshore_isle',
  'mirefen_marsh',
  'thornpeak_heights',
  // The King of the Hill zones host no skill event (owner review, 2026-11-12).
  'drakelands',
  'frostveil',
  'amberfall',
];

function world(): Sim {
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true, world: EMPTY_WORLD });
  sim.resetDay = '2026-11-12';
  return sim;
}
function ent(sim: Sim, pid: number): Entity {
  return sim.entities.get(pid)!;
}
function addPlayer(sim: Sim, name: string): number {
  const pid = sim.addPlayer('warrior', name, {
    autoEquip: true,
    characterId: 2000 + sim.players.size,
  });
  sim.setPlayerLevel(20, pid);
  ent(sim, pid).hp = ent(sim, pid).maxHp;
  return pid;
}
function place(sim: Sim, pid: number, x: number, z: number): void {
  const e = ent(sim, pid);
  e.pos = { x, y: groundHeight(x, z, SEED), z };
  e.prevPos = { ...e.pos };
}
function tickSeconds(sim: Sim, seconds: number): SimEvent[] {
  const seen: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) seen.push(...sim.tick());
  return seen;
}
function realmLines(events: SimEvent[]): string[] {
  return events
    .filter((ev): ev is Extract<SimEvent, { type: 'log' }> => ev.type === 'log')
    .filter((ev) => ev.pid === undefined)
    .map((ev) => ev.text);
}
/** Plan the next event to open its warning on the very next pass. */
function openSoon(sim: Sim, ordinal = 0): void {
  sim.skillEventState.plan = { ordinal, startsAt: sim.time + SKILL_EVENT_WARNING_SECONDS };
  tickSeconds(sim, 1.1);
}
function kill(sim: Sim, killer: number, victim: number): void {
  const v = ent(sim, victim);
  // In The Common Hand only a dealt ability hurts another fighter (a fixed
  // share of health): land the killing blow with the hand's attack.
  const hand = sim.skillEventState.active?.commonHand?.hand;
  if (hand) v.hp = 1;
  sim.ctx.dealDamage(
    ent(sim, killer),
    v,
    v.hp + 10_000,
    false,
    'physical',
    hand?.[0] ?? null,
    'hit',
  );
}

describe('skill event rotation and clock', () => {
  it('runs the five events in the fixed order 10, 11, 12, 13, 14', () => {
    expect([...SKILL_EVENT_KINDS]).toEqual([
      'riposte',
      'footprints',
      'tongues',
      'bankshot',
      'common_hand',
    ]);
    const order = [0, 1, 2, 3, 4, 5, 6].map(skillEventKindFor);
    expect(order).toEqual([
      'riposte',
      'footprints',
      'tongues',
      'bankshot',
      'common_hand',
      'riposte',
      'footprints',
    ]);
  });

  it('starts on the real hour with a host clock', () => {
    const hourMs = SKILL_EVENT_PERIOD_SECONDS * 1000;
    const nowMs = 500_000 * hourMs + 25 * 60 * 1000; // 25 minutes past an hour
    const next = nextSkillEventStart(100, nowMs);
    expect(next.ordinal).toBe(500_001);
    expect(next.startsAt).toBeCloseTo(100 + 35 * 60, 6);
    // Exactly on the hour, the event that starts now is already due: the next one waits an hour.
    expect(nextSkillEventStart(0, 7 * hourMs).startsAt).toBeCloseTo(SKILL_EVENT_PERIOD_SECONDS, 6);
  });

  it('counts from boot without a host clock', () => {
    expect(nextSkillEventStart(0, null)).toEqual({
      ordinal: 0,
      startsAt: SKILL_EVENT_FIRST_START_SECONDS,
    });
    const later = nextSkillEventStart(SKILL_EVENT_FIRST_START_SECONDS + 1, null);
    expect(later.ordinal).toBe(1);
    expect(later.startsAt).toBe(SKILL_EVENT_FIRST_START_SECONDS + SKILL_EVENT_PERIOD_SECONDS);
  });
});

describe('skill event arenas', () => {
  it('has no arena in an excluded zone and at least one in every other overworld zone', () => {
    const zones = new Set(SKILL_EVENT_SITES.map((site) => site.zoneId));
    for (const id of EXCLUDED_ZONES) expect(zones.has(id), id).toBe(false);
    for (const zone of ZONES) {
      if (EXCLUDED_ZONES.includes(zone.id)) continue;
      expect(zones.has(zone.id), zone.id).toBe(true);
    }
    expect(new Set(SKILL_EVENT_SITES.map((site) => site.id)).size).toBe(SKILL_EVENT_SITES.length);
  });

  it('keeps every arena circle inside its own zone', () => {
    for (const site of SKILL_EVENT_SITES) {
      for (let a = 0; a < 16; a++) {
        const angle = (a / 16) * Math.PI * 2;
        const x = site.x + Math.cos(angle) * SKILL_EVENT_RADIUS;
        const z = site.z + Math.sin(angle) * SKILL_EVENT_RADIUS;
        expect(zoneContaining(x, z)?.id, `${site.id} rim ${a}`).toBe(site.zoneId);
      }
    }
  });

  it('keeps every arena clear of the heart of every world quest area', () => {
    // The glider slalom is a sky course over the whole zone, not ground play.
    for (const quest of WORLD_QUESTS) {
      if (quest.objective.type === 'glider') continue;
      const area = (quest as { area?: { x: number; z: number; radius: number } }).area;
      if (!area) continue;
      for (const site of SKILL_EVENT_SITES) {
        const d = Math.hypot(area.x - site.x, area.z - site.z);
        expect(d, `${site.id} vs ${quest.id}`).toBeGreaterThanOrEqual(60);
        if (quest.objective.type === 'wisp_maze') {
          expect(d, `${site.id} vs ${quest.id}`).toBeGreaterThanOrEqual(area.radius + 40);
        }
      }
    }
  });

  it('keeps every arena circle out of the garden maze and the wisp maze', () => {
    // Sampled over the whole disc: an arena reaching into a maze is a bad
    // fight (owner review: Evergarden 3 sat in the Great Maze).
    for (const site of SKILL_EVENT_SITES) {
      for (let r = 0; r <= SKILL_EVENT_RADIUS; r += 5) {
        for (let a = 0; a < 24; a++) {
          const angle = (a / 24) * Math.PI * 2;
          const x = site.x + Math.cos(angle) * r;
          const z = site.z + Math.sin(angle) * r;
          expect(inGardenMaze(x, z), `${site.id} garden maze`).toBe(false);
          expect(inWispMazeFootprint(x, z, 0), `${site.id} wisp maze`).toBe(false);
        }
      }
    }
  });

  it('never lets a King of the Hill spot touch an arena', () => {
    for (const site of SKILL_EVENT_SITES) {
      expect(spotTouchesSkillArena(SKILL_EVENT_SITES, site.x, site.z, HILL_RADIUS)).toBe(true);
    }
    expect(spotTouchesSkillArena(SKILL_EVENT_SITES, 99_999, 99_999, HILL_RADIUS)).toBe(false);
    // The real picker, with an open probe, over many draws in every hill zone.
    const sim = world();
    const probe = {
      wet: () => false,
      steep: () => false,
      blocked: () => false,
      zoneIdAt: (x: number, z: number) => zoneContaining(x, z)?.id ?? null,
    };
    for (const zoneId of ['drakelands', 'frostveil', 'amberfall']) {
      const zone = ZONES.find((z) => z.id === zoneId)!;
      for (let seed = 1; seed <= 40; seed++) {
        const spot = pickHillSpot(sim.ctx, new Rng(seed), zone, probe);
        if (!spot) continue;
        expect(spotTouchesSkillArena(SKILL_EVENT_SITES, spot.x, spot.z, HILL_RADIUS)).toBe(false);
      }
    }
  });

  it('avoids the zone of an announced or standing hill', () => {
    const avoiding = skillEventSitesAvoiding(SKILL_EVENT_SITES, 'drakelands');
    expect(avoiding.length).toBeGreaterThan(0);
    expect(avoiding.some((site) => site.zoneId === 'drakelands')).toBe(false);
    expect(skillEventSitesAvoiding(SKILL_EVENT_SITES, null)).toEqual(SKILL_EVENT_SITES);
  });
});

describe('skill event flow', () => {
  it('warns, starts, and names the event and zone in localizable lines', () => {
    const sim = world();
    const warned = realmLines(tickSeconds(sim, 0));
    expect(warned).toEqual([]);
    sim.skillEventState.plan = { ordinal: 2, startsAt: sim.time + SKILL_EVENT_WARNING_SECONDS };
    const lines = realmLines(tickSeconds(sim, 1.1));
    const ev = sim.skillEventState.active!;
    expect(ev.kind).toBe('tongues');
    expect(ev.phase).toBe('warning');
    const zoneName = ZONES.find((z) => z.id === ev.zoneId)!.name;
    expect(lines).toContain(skillEventWarningLine('Rite of Tongues', zoneName, 5));
    ev.startsAt = sim.time;
    const started = realmLines(tickSeconds(sim, 1.1));
    expect(sim.skillEventState.active?.phase).toBe('running');
    expect(started).toContain(skillEventStartLine('Rite of Tongues', zoneName));
    // Every realm and player line re-localizes through the client matcher.
    for (const line of [
      skillEventWarningLine('Rite of Tongues', zoneName, 5),
      skillEventStartLine('Rite of Tongues', zoneName),
      skillEventWonLine('Rite of Tongues', 'Aleph'),
      skillEventEndedLine('Rite of Tongues'),
      SKILL_EVENT_JOINED_LINE,
      SKILL_EVENT_TOO_FAR_LINE,
      SKILL_EVENT_NOT_YET_LINE,
    ]) {
      expect(localizeSimText(line), line).not.toBeNull();
    }
  });

  it('offers the join prompt near the arena and joining raises the PvP flag', () => {
    const sim = world();
    const a = addPlayer(sim, 'Aleph');
    openSoon(sim);
    const ev = sim.skillEventState.active!;
    place(sim, a, ev.x + SKILL_EVENT_RADIUS + SKILL_EVENT_PROMPT_MARGIN + 30, ev.z);
    expect(sim.skillEventInfoFor(a)?.canJoin).toBe(false);
    sim.joinSkillEvent(a);
    expect(ev.participants).toEqual([]);
    place(sim, a, ev.x + SKILL_EVENT_RADIUS + SKILL_EVENT_PROMPT_MARGIN - 2, ev.z);
    expect(sim.skillEventInfoFor(a)?.canJoin).toBe(true);
    sim.joinSkillEvent(a);
    expect(ev.participants).toEqual([a]);
    expect(sim.worldPvpInfoFor(a)?.flagged).toBe(true);
    const info = sim.skillEventInfoFor(a)!;
    expect(info.joined).toBe(true);
    expect(info.canJoin).toBe(false);
  });

  it('pays 10 honor per kill with no diminishing returns, then 300 to the winner and 100 to the rest', () => {
    const sim = world();
    const a = addPlayer(sim, 'Aleph');
    const b = addPlayer(sim, 'Bet');
    const c = addPlayer(sim, 'Gimel');
    openSoon(sim, 4); // The Common Hand: first to 4 killing blows
    const ev = sim.skillEventState.active!;
    for (const pid of [a, b, c]) {
      place(sim, pid, ev.x, ev.z);
      sim.joinSkillEvent(pid);
    }
    ev.startsAt = sim.time;
    tickSeconds(sim, SKILL_EVENT_MIN_PRESENCE_SECONDS + 1.1);
    expect(ev.phase).toBe('running');
    const honorOf = (pid: number) => sim.players.get(pid)!.honor;
    const before = honorOf(a);
    // The same victim four times: every kill pays the full bounty.
    for (let i = 0; i < 3; i++) {
      kill(sim, a, b);
      expect(honorOf(a) - before).toBeGreaterThanOrEqual((i + 1) * SKILL_EVENT_KILL_HONOR);
      const victim = ent(sim, b);
      victim.dead = false;
      victim.hp = victim.maxHp;
    }
    const bBefore = honorOf(b);
    const cBefore = honorOf(c);
    const aBeforeWin = honorOf(a);
    kill(sim, a, c);
    expect(ev.winner).toBe(a);
    const lines = realmLines(tickSeconds(sim, 1.1));
    expect(sim.skillEventState.active).toBeNull();
    expect(lines).toContain(skillEventWonLine('The Common Hand', 'Aleph'));
    expect(honorOf(a) - aBeforeWin).toBeGreaterThanOrEqual(
      SKILL_EVENT_KILL_HONOR + SKILL_EVENT_WIN_HONOR,
    );
    expect(honorOf(b) - bBefore).toBe(SKILL_EVENT_PARTICIPATION_HONOR);
    expect(honorOf(c) - cBefore).toBeGreaterThanOrEqual(SKILL_EVENT_PARTICIPATION_HONOR);
  });

  it('a kill on a non-participant pays no event bounty', () => {
    const sim = world();
    const a = addPlayer(sim, 'Aleph');
    const b = addPlayer(sim, 'Bet');
    openSoon(sim);
    const ev = sim.skillEventState.active!;
    place(sim, a, ev.x, ev.z);
    sim.joinSkillEvent(a);
    ev.startsAt = sim.time;
    tickSeconds(sim, 1.1);
    kill(sim, a, b);
    expect(ev.kills.get(a) ?? 0).toBe(0);
  });

  it('ends with no winner at the hard cap and still pays participation', () => {
    const sim = world();
    const a = addPlayer(sim, 'Aleph');
    openSoon(sim, 1);
    const ev = sim.skillEventState.active!;
    place(sim, a, ev.x, ev.z);
    sim.joinSkillEvent(a);
    ev.startsAt = sim.time;
    tickSeconds(sim, SKILL_EVENT_MIN_PRESENCE_SECONDS + 1.1);
    const before = sim.players.get(a)!.honor;
    ev.endsAt = sim.time;
    const lines = realmLines(tickSeconds(sim, 1.1));
    expect(lines).toContain(skillEventEndedLine('Footprints in Ash'));
    expect(sim.players.get(a)!.honor - before).toBe(SKILL_EVENT_PARTICIPATION_HONOR);
  });

  it('pays nothing to a player who joins and walks away', () => {
    const sim = world();
    const a = addPlayer(sim, 'Aleph');
    openSoon(sim);
    const ev = sim.skillEventState.active!;
    place(sim, a, ev.x + SKILL_EVENT_RADIUS + 10, ev.z);
    sim.joinSkillEvent(a);
    expect(ev.participants).toEqual([a]);
    place(sim, a, ev.x + 400, ev.z);
    ev.startsAt = sim.time;
    tickSeconds(sim, SKILL_EVENT_MIN_PRESENCE_SECONDS + 5);
    const before = sim.players.get(a)!.honor;
    ev.endsAt = sim.time;
    tickSeconds(sim, 1.1);
    expect(sim.skillEventState.active).toBeNull();
    expect(sim.players.get(a)!.honor).toBe(before);
  });

  it('counts only kills made at the event', () => {
    const sim = world();
    const a = addPlayer(sim, 'Aleph');
    const b = addPlayer(sim, 'Bet');
    openSoon(sim, 4);
    const ev = sim.skillEventState.active!;
    for (const pid of [a, b]) {
      place(sim, pid, ev.x, ev.z);
      sim.joinSkillEvent(pid);
    }
    ev.startsAt = sim.time;
    tickSeconds(sim, 1.1);
    place(sim, a, ev.x + 300, ev.z);
    place(sim, b, ev.x + 302, ev.z);
    kill(sim, a, b);
    expect(ev.kills.get(a) ?? 0).toBe(0);
  });

  it('never draws an arena next to a live rift portal', () => {
    const site = SKILL_EVENT_SITES[0];
    const portal = { x: site.x + 5, z: site.z };
    const pool = skillEventSitesAvoiding(SKILL_EVENT_SITES, null, [portal]);
    expect(pool.some((s) => s.id === site.id)).toBe(false);
    expect(pool.length).toBe(SKILL_EVENT_SITES.length - 1);
    // A rift portal spot on an arena is refused by the same rule.
    expect(
      spotTouchesSkillArena(SKILL_EVENT_SITES, site.x, site.z, SKILL_EVENT_PORTAL_RADIUS),
    ).toBe(true);
  });

  it('keeps a new hill out of the zone of a running skill event', () => {
    const sim = world();
    openSoon(sim);
    const ev = sim.skillEventState.active!;
    ev.zoneId = 'drakelands';
    for (let attempt = 0; attempt < 12; attempt++) {
      const hill = spawnHill(sim.ctx, 3, { warnAt: 0, risesAt: 1, closesAt: 2 }, attempt);
      if (hill) expect(hill.zoneId).not.toBe('drakelands');
    }
  });

  it('puts hearts on every fighter in a heart event and takes them off at the end', () => {
    const sim = world();
    const a = addPlayer(sim, 'Aleph');
    const b = addPlayer(sim, 'Bet');
    openSoon(sim, 0); // Riposte: a heart event
    const ev = sim.skillEventState.active!;
    for (const pid of [a, b]) {
      place(sim, pid, ev.x, ev.z);
      sim.joinSkillEvent(pid);
    }
    expect(ent(sim, a).eventHearts).toBeUndefined(); // not before the start
    ev.startsAt = sim.time;
    tickSeconds(sim, 1.1);
    expect(ent(sim, a).eventHearts).toBe(SKILL_EVENT_HEARTS);
    expect(ent(sim, b).eventHearts).toBe(SKILL_EVENT_HEARTS);
    expect(sim.skillEventInfoFor(a)?.hearts).toBe(SKILL_EVENT_HEARTS);
    ev.endsAt = sim.time;
    tickSeconds(sim, 1.1);
    expect(ent(sim, a).eventHearts).toBeUndefined();
    expect(ent(sim, b).eventHearts).toBeUndefined();
  });

  it('keeps ordinary health in The Common Hand', () => {
    const sim = world();
    const a = addPlayer(sim, 'Aleph');
    openSoon(sim, 4);
    const ev = sim.skillEventState.active!;
    place(sim, a, ev.x, ev.z);
    sim.joinSkillEvent(a);
    ev.startsAt = sim.time;
    tickSeconds(sim, 1.1);
    expect(ent(sim, a).eventHearts).toBeUndefined();
    expect(sim.skillEventInfoFor(a)?.hearts).toBeNull();
  });

  /** Two fighters in a running Riposte, both on full hearts. */
  function heartFight(): { sim: Sim; a: number; b: number } {
    const sim = world();
    const a = addPlayer(sim, 'Aleph');
    const b = addPlayer(sim, 'Bet');
    openSoon(sim, 0);
    const ev = sim.skillEventState.active!;
    for (const pid of [a, b]) {
      place(sim, pid, ev.x, ev.z);
      sim.joinSkillEvent(pid);
    }
    ev.startsAt = sim.time;
    tickSeconds(sim, 1.1);
    return { sim, a, b };
  }
  /** A kit verb's hit, as a rule module lands it (verbHitFrom set around it). */
  function hit(sim: Sim, from: number, to: number, amount = 50): void {
    const ev = sim.skillEventState.active!;
    ev.verbHitFrom = from;
    sim.ctx.dealDamage(ent(sim, from), ent(sim, to), amount, false, 'physical', null, 'hit');
    ev.verbHitFrom = null;
  }

  it('ignores every hit between fighters that is not a kit verb (auto-attacks too)', () => {
    const { sim, a, b } = heartFight();
    const hpBefore = ent(sim, b).hp;
    sim.ctx.dealDamage(ent(sim, a), ent(sim, b), 120, false, 'physical', null, 'hit');
    expect(ent(sim, b).eventHearts).toBe(SKILL_EVENT_HEARTS);
    expect(ent(sim, b).hp).toBe(hpBefore);
  });

  it('a hit between fighters takes exactly one heart and no health', () => {
    const { sim, a, b } = heartFight();
    const hpBefore = ent(sim, b).hp;
    hit(sim, a, b, 9999);
    expect(ent(sim, b).eventHearts).toBe(SKILL_EVENT_HEARTS - 1);
    expect(ent(sim, b).hp).toBe(hpBefore);
    expect(ent(sim, b).dead).toBe(false);
  });

  it('loses at most one heart per grace window', () => {
    const { sim, a, b } = heartFight();
    hit(sim, a, b);
    hit(sim, a, b);
    hit(sim, a, b);
    expect(ent(sim, b).eventHearts).toBe(SKILL_EVENT_HEARTS - 1);
    tickSeconds(sim, SKILL_EVENT_HEART_GRACE_SECONDS + 0.05);
    hit(sim, a, b);
    expect(ent(sim, b).eventHearts).toBe(SKILL_EVENT_HEARTS - 2);
  });

  it('the last heart is a kill, credited to the killer', () => {
    const { sim, a, b } = heartFight();
    const ev = sim.skillEventState.active!;
    for (let i = 0; i < SKILL_EVENT_HEARTS; i++) {
      hit(sim, a, b);
      tickSeconds(sim, SKILL_EVENT_HEART_GRACE_SECONDS + 0.05);
    }
    expect(ent(sim, b).dead).toBe(true);
    expect(ent(sim, b).eventHearts).toBeUndefined();
    expect(ev.kills.get(a)).toBe(1);
  });

  it('nobody off hearts can hurt a fighter on hearts', () => {
    const { sim, b } = heartFight();
    const outsider = addPlayer(sim, 'Gimel');
    const hpBefore = ent(sim, b).hp;
    hit(sim, outsider, b, 500);
    sim.ctx.dealDamage(null, ent(sim, b), 500, false, 'fire', null, 'hit');
    expect(ent(sim, b).hp).toBe(hpBefore);
    expect(ent(sim, b).eventHearts).toBe(SKILL_EVENT_HEARTS);
  });

  it('runs no event on a realm whose World PvP switch is off', () => {
    const sim = new Sim({
      seed: SEED,
      playerClass: 'warrior',
      noPlayer: true,
      world: EMPTY_WORLD,
      worldPvpDisabled: true,
    });
    openSoon(sim);
    expect(sim.skillEventState.active).toBeNull();
  });
});
