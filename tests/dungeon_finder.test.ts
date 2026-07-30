// Dungeon Finder core coverage (src/sim/social/dungeon_finder.ts +
// src/sim/content/dungeon_finder.ts + the PartyMachine formation seam).
// Exercises the pure helpers directly and drives the machine through a real
// multi-player Sim, per docs/prd/dungeon-finder.md.

import { describe, expect, it } from 'vitest';
import {
  FINDER_ACTIVITIES,
  FINDER_PRE_SPEC_ROLES,
  finderActivity,
} from '../src/sim/content/dungeon_finder';
import { FIRST_TALENT_LEVEL, type Role, TALENTS } from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';
import {
  assignFinderRoles,
  compatibleFinderRoles,
  FINDER_DECLINE_COOLDOWN_SECONDS,
  FINDER_PROPOSAL_SECONDS,
  matchFinderRoles,
  normalizeFinderSelection,
} from '../src/sim/social/dungeon_finder';
import type { PlayerClass, SimEvent } from '../src/sim/types';

const FIVE = { tank: 1, healer: 1, dps: 3 };
const TEN = { tank: 2, healer: 2, dps: 6 };

const makeSim = (seed = 42) => new Sim({ seed, playerClass: 'warrior', noPlayer: true });

function specIdFor(cls: PlayerClass, role: Role): string {
  const specs = TALENTS[cls]?.specs ?? [];
  const spec = specs.find((s) => s.role === role);
  if (!spec) throw new Error(`no ${role} spec for ${cls}`);
  return spec.id;
}

interface Joined {
  sim: Sim;
  pids: number[];
  events: SimEvent[];
}

// Add `count` players of the given classes at `level`, select `roles` for each,
// and (at level >= FIRST_TALENT_LEVEL) pick a spec matching the first role.
function addPlayers(
  sim: Sim,
  defs: { cls: PlayerClass; roles: Role[]; level: number; name?: string }[],
): number[] {
  return defs.map((d, i) => {
    const pid = sim.addPlayer(d.cls, d.name ?? `P${i}`);
    sim.setPlayerLevel(d.level, pid);
    if (d.level >= FIRST_TALENT_LEVEL) sim.setSpec(specIdFor(d.cls, d.roles[0]), pid);
    sim.dungeonFinderSetRoles(d.roles, pid);
    return pid;
  });
}

function tickAll(sim: Sim, ticks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) out.push(...sim.tick());
  return out;
}

const errorsFor = (events: SimEvent[], pid: number) =>
  events
    .filter((e) => e.type === 'error' && e.pid === pid)
    .map((e) => (e as { text: string }).text);

// A standard eligible five for the Hollow Crypt (levels 7-10, spec roles).
function queueFive(sim: Sim): Joined {
  const pids = addPlayers(sim, [
    { cls: 'warrior', roles: ['tank'], level: 8 },
    { cls: 'priest', roles: ['healer'], level: 8 },
    { cls: 'mage', roles: ['dps'], level: 8 },
    { cls: 'rogue', roles: ['dps'], level: 8 },
    { cls: 'hunter', roles: ['dps'], level: 8 },
  ]);
  for (const pid of pids) sim.dungeonFinderQueueJoin(['hollow_crypt_normal'], pid);
  const events = tickAll(sim, 1);
  return { sim, pids, events };
}

function acceptAll(sim: Sim, pids: number[]): SimEvent[] {
  for (const pid of pids) sim.dungeonFinderRespond(true, pid);
  return tickAll(sim, 1);
}

// ---------------------------------------------------------------------------
// Catalogue metadata pins (the approved product table, literal by literal).
// ---------------------------------------------------------------------------

describe('finder catalogue metadata', () => {
  it('pins the 11 activity ids in catalogue order', () => {
    expect(FINDER_ACTIVITIES.map((a) => a.id)).toEqual([
      'hollow_crypt_normal',
      'sunken_bastion_normal',
      'drowned_temple_normal',
      'gravewyrm_sanctum_normal',
      'hollow_crypt_heroic',
      'sunken_bastion_heroic',
      'drowned_temple_heroic',
      'gravewyrm_sanctum_heroic',
      'nythraxis_crypt_normal',
      'nythraxis_boss_arena_normal',
      'nythraxis_boss_arena_heroic',
    ]);
  });

  it('pins the strict level bands (anti-boost)', () => {
    const bands = Object.fromEntries(
      FINDER_ACTIVITIES.map((a) => [a.id, [a.minLevel, a.maxLevel]]),
    );
    expect(bands).toEqual({
      hollow_crypt_normal: [7, 10],
      sunken_bastion_normal: [12, 13],
      drowned_temple_normal: [16, 18],
      gravewyrm_sanctum_normal: [19, 20],
      hollow_crypt_heroic: [20, 20],
      sunken_bastion_heroic: [20, 20],
      drowned_temple_heroic: [20, 20],
      gravewyrm_sanctum_heroic: [20, 20],
      nythraxis_crypt_normal: [20, 20],
      nythraxis_boss_arena_normal: [20, 20],
      nythraxis_boss_arena_heroic: [20, 20],
    });
  });

  it('pins composition, size, and auto-queue per activity kind', () => {
    for (const a of FINDER_ACTIVITIES) {
      if (a.kind === 'raid') {
        expect(a.size).toBe(10);
        expect(a.composition).toEqual(TEN);
        expect(a.autoQueue).toBe(true);
      } else if (a.kind === 'solo') {
        expect(a.id).toBe('nythraxis_crypt_normal');
        expect(a.size).toBe(5);
        expect(a.composition).toBeNull();
        expect(a.autoQueue).toBe(false);
      } else {
        expect(a.size).toBe(5);
        expect(a.composition).toEqual(FIVE);
        expect(a.autoQueue).toBe(true);
      }
    }
  });

  it('every catalogued dungeon id and encounter mob id exists in the content tables', async () => {
    const { DUNGEONS, MOBS } = await import('../src/sim/data');
    for (const a of FINDER_ACTIVITIES) {
      expect(DUNGEONS[a.dungeonId], a.dungeonId).toBeDefined();
      expect(DUNGEONS[a.entranceDungeonId], a.entranceDungeonId).toBeDefined();
      for (const e of a.encounters) expect(MOBS[e.mobId], e.mobId).toBeDefined();
      expect(a.encounters.some((e) => e.final)).toBe(true);
    }
  });

  it('the raid entrance points at the Abandoned Crypt overworld door', () => {
    expect(finderActivity('nythraxis_boss_arena_normal')?.entranceDungeonId).toBe(
      'nythraxis_crypt',
    );
    expect(finderActivity('nythraxis_boss_arena_heroic')?.entranceDungeonId).toBe(
      'nythraxis_crypt',
    );
  });

  it('heroics and the raid carry the daily lockout label; normals do not', () => {
    for (const a of FINDER_ACTIVITIES) {
      const daily = a.difficulty === 'heroic' || a.kind === 'raid';
      expect(a.lockout, a.id).toBe(daily ? 'daily' : 'none');
    }
  });
});

// ---------------------------------------------------------------------------
// Pure helpers.
// ---------------------------------------------------------------------------

describe('compatibleFinderRoles', () => {
  it('applies the fixed class table below level 5 (the spec unlock)', () => {
    expect(compatibleFinderRoles('warrior', 4, null)).toEqual(['tank', 'dps']);
    expect(compatibleFinderRoles('paladin', 4, null)).toEqual(['tank', 'healer', 'dps']);
    expect(compatibleFinderRoles('druid', 4, null)).toEqual(['tank', 'healer', 'dps']);
    expect(compatibleFinderRoles('priest', 4, null)).toEqual(['healer', 'dps']);
    expect(compatibleFinderRoles('shaman', 4, null)).toEqual(['healer', 'dps']);
    expect(compatibleFinderRoles('mage', 4, null)).toEqual(['dps']);
    expect(compatibleFinderRoles('rogue', 4, null)).toEqual(['dps']);
    expect(compatibleFinderRoles('hunter', 4, null)).toEqual(['dps']);
    expect(compatibleFinderRoles('warlock', 4, null)).toEqual(['dps']);
  });

  it('every class can dps below 5 (table completeness)', () => {
    expect(FINDER_PRE_SPEC_ROLES.dps).toHaveLength(9);
  });

  it('from level 5 the active spec role is the only compatible role', () => {
    expect(compatibleFinderRoles('warrior', 5, 'tank')).toEqual(['tank']);
    expect(compatibleFinderRoles('warrior', 10, 'tank')).toEqual(['tank']);
    expect(compatibleFinderRoles('druid', 20, 'healer')).toEqual(['healer']);
    expect(compatibleFinderRoles('mage', 20, 'dps')).toEqual(['dps']);
  });

  it('no active spec at level 5+ means no compatible roles; level 4 is not spec-gated', () => {
    expect(compatibleFinderRoles('warrior', 5, null)).toEqual([]);
    expect(compatibleFinderRoles('warrior', 10, null)).toEqual([]);
    expect(compatibleFinderRoles('druid', 20, null)).toEqual([]);
    // One level below the unlock the class table still applies unspecced.
    expect(compatibleFinderRoles('warrior', 4, null)).toEqual(['tank', 'dps']);
  });
});

describe('normalizeFinderSelection', () => {
  it('drops unknown ids and listing-only activities, dedupes, and re-orders to catalogue order', () => {
    expect(
      normalizeFinderSelection([
        'gravewyrm_sanctum_normal',
        'nope',
        'hollow_crypt_normal',
        'nythraxis_crypt_normal',
        'hollow_crypt_normal',
      ]),
    ).toEqual(['hollow_crypt_normal', 'gravewyrm_sanctum_normal']);
  });
});

describe('role assignment', () => {
  const m = (pid: number, ...roles: Role[]) => ({ pid, roles });

  it('assigns the exact 1/1/3 split', () => {
    const roles = assignFinderRoles(
      [m(1, 'tank'), m(2, 'healer'), m(3, 'dps'), m(4, 'dps'), m(5, 'dps')],
      FIVE,
    );
    expect(roles).not.toBeNull();
    expect(roles?.get(1)).toBe('tank');
    expect(roles?.get(2)).toBe('healer');
    expect(roles?.get(3)).toBe('dps');
  });

  it('reseats flexible members so an exact assignment is found (augmenting path)', () => {
    // Member 1 can tank or heal; member 2 can only tank. A greedy pass would
    // seat 1 as tank and fail; the matcher must reseat 1 as healer.
    const roles = assignFinderRoles(
      [m(1, 'tank', 'healer'), m(2, 'tank'), m(3, 'dps'), m(4, 'dps'), m(5, 'dps')],
      FIVE,
    );
    expect(roles?.get(1)).toBe('healer');
    expect(roles?.get(2)).toBe('tank');
  });

  it('returns null for impossible compositions', () => {
    expect(
      assignFinderRoles([m(1, 'tank'), m(2, 'tank'), m(3, 'dps'), m(4, 'dps'), m(5, 'dps')], FIVE),
    ).toBeNull();
    expect(assignFinderRoles([m(1, 'dps'), m(2, 'dps')], FIVE)).toBeNull();
  });

  it('fills the exact 2/2/6 raid split', () => {
    const members = [
      m(1, 'tank'),
      m(2, 'tank', 'dps'),
      m(3, 'healer'),
      m(4, 'healer', 'dps'),
      m(5, 'dps'),
      m(6, 'dps'),
      m(7, 'dps'),
      m(8, 'dps'),
      m(9, 'dps'),
      m(10, 'dps'),
    ];
    const roles = assignFinderRoles(members, TEN);
    expect(roles).not.toBeNull();
    const counts = { tank: 0, healer: 0, dps: 0 };
    for (const r of roles?.values() ?? []) counts[r]++;
    expect(counts).toEqual(TEN);
  });

  it('matchFinderRoles reports leftover capacity for partial rosters', () => {
    const match = matchFinderRoles([m(1, 'tank'), m(2, 'dps')], FIVE);
    expect(match.assigned.get(1)).toBe('tank');
    expect(match.open).toEqual({ tank: 0, healer: 1, dps: 2 });
  });
});

// ---------------------------------------------------------------------------
// Automatic queue: eligibility, matching, proposals, cooldowns.
// ---------------------------------------------------------------------------

describe('automatic queue', () => {
  it('matches five eligible solos into a full proposal with exact roles', () => {
    const sim = makeSim();
    const { pids } = queueFive(sim);
    const infos = pids.map((pid) => sim.dungeonFinderInfoFor(pid));
    for (const info of infos) {
      expect(info?.proposal).not.toBeNull();
      expect(info?.proposal?.activityId).toBe('hollow_crypt_normal');
      expect(info?.proposal?.size).toBe(5);
      expect(info?.proposal?.myResponse).toBe('pending');
      expect(info?.proposal?.remaining).toBeGreaterThan(FINDER_PROPOSAL_SECONDS - 2);
    }
    expect(infos[0]?.proposal?.role).toBe('tank');
    expect(infos[1]?.proposal?.role).toBe('healer');
    expect(infos[2]?.proposal?.role).toBe('dps');
  });

  it('forms the party only after every member accepts, led by the longest-waiting solo', () => {
    const sim = makeSim();
    const { pids } = queueFive(sim);
    // Four accepts: still no party.
    for (const pid of pids.slice(0, 4)) sim.dungeonFinderRespond(true, pid);
    tickAll(sim, 1);
    expect(sim.partyOf(pids[0])).toBeNull();
    const before = pids.map((pid) => ({ ...(sim.entities.get(pid)?.pos ?? { x: 0, y: 0, z: 0 }) }));
    sim.dungeonFinderRespond(true, pids[4]);
    tickAll(sim, 1);
    const party = sim.partyOf(pids[0]);
    expect(party).not.toBeNull();
    expect(party?.leader).toBe(pids[0]);
    expect(party?.members).toHaveLength(5);
    expect(party?.raid).toBe(false);
    // No teleport: everyone stands exactly where they were.
    pids.forEach((pid, i) => {
      expect(sim.entities.get(pid)?.pos).toEqual(before[i]);
    });
    // Queue state cleared for everyone.
    for (const pid of pids) {
      const info = sim.dungeonFinderInfoFor(pid);
      expect(info?.proposal).toBeNull();
      expect(info?.queue).toBeNull();
      expect(info?.cooldown).toBe(0);
    }
  });

  it('level range is strict at both ends', () => {
    const sim = makeSim();
    const [low, high] = addPlayers(sim, [
      { cls: 'warrior', roles: ['tank'], level: 6 },
      { cls: 'mage', roles: ['dps'], level: 11 },
    ]);
    sim.dungeonFinderQueueJoin(['hollow_crypt_normal'], low);
    sim.dungeonFinderQueueJoin(['hollow_crypt_normal'], high);
    const events = tickAll(sim, 1);
    expect(errorsFor(events, low)).toContain('You do not meet the level range for that activity.');
    expect(errorsFor(events, high)).toContain('You do not meet the level range for that activity.');
    expect(sim.dungeonFinderInfoFor(low)?.queue).toBeNull();
    expect(sim.dungeonFinderInfoFor(high)?.queue).toBeNull();
  });

  it('level 5+ without an active spec can neither select roles nor queue', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'NoSpec');
    sim.setPlayerLevel(20, pid);
    sim.dungeonFinderSetRoles(['tank'], pid);
    sim.dungeonFinderQueueJoin(['hollow_crypt_heroic'], pid);
    const events = tickAll(sim, 1);
    expect(errorsFor(events, pid)).toContain('Choose a specialization to use the Dungeon Finder.');
    expect(sim.dungeonFinderInfoFor(pid)?.eligibleRoles).toEqual([]);
    expect(sim.dungeonFinderInfoFor(pid)?.queue).toBeNull();
    // The gate starts exactly at the spec unlock (level 5)...
    const atFive = sim.addPlayer('warrior', 'AtFive');
    sim.setPlayerLevel(5, atFive);
    sim.dungeonFinderSetRoles(['tank'], atFive);
    const eventsAtFive = tickAll(sim, 1);
    expect(errorsFor(eventsAtFive, atFive)).toContain(
      'Choose a specialization to use the Dungeon Finder.',
    );
    expect(sim.dungeonFinderInfoFor(atFive)?.eligibleRoles).toEqual([]);
    // ...and level 4 is NOT spec-gated: the class table applies unspecced.
    const atFour = sim.addPlayer('warrior', 'AtFour');
    sim.setPlayerLevel(4, atFour);
    sim.dungeonFinderSetRoles(['tank'], atFour);
    const eventsAtFour = tickAll(sim, 1);
    expect(errorsFor(eventsAtFour, atFour)).toEqual([]);
    expect(sim.dungeonFinderInfoFor(atFour)?.eligibleRoles).toEqual(['tank', 'dps']);
    expect(sim.dungeonFinderInfoFor(atFour)?.roles).toEqual(['tank']);
  });

  it('rejects a role outside the class capability table', () => {
    const sim = makeSim();
    // Below the spec unlock the fixed class table applies: a mage cannot tank.
    const pid = sim.addPlayer('mage', 'M');
    sim.setPlayerLevel(4, pid);
    sim.dungeonFinderSetRoles(['tank'], pid);
    const events = tickAll(sim, 1);
    expect(errorsFor(events, pid)).toContain('You cannot fill that role.');
    // From the spec unlock the active spec's role is the whole capability set.
    const specced = sim.addPlayer('mage', 'M2');
    sim.setPlayerLevel(8, specced);
    sim.setSpec(specIdFor('mage', 'dps'), specced);
    sim.dungeonFinderSetRoles(['tank'], specced);
    const eventsSpecced = tickAll(sim, 1);
    expect(errorsFor(eventsSpecced, specced)).toContain('You cannot fill that role.');
  });

  it('assigns exactly one role to a multi-role selection (the active spec narrows it)', () => {
    const sim = makeSim();
    // A druid picks both tank and healer below the spec unlock; the sticky
    // selection survives leveling up, but from level 5 the active spec is the
    // whole capability set, so it collapses to one role at match time.
    const druid = sim.addPlayer('druid', 'P0');
    sim.setPlayerLevel(4, druid);
    sim.dungeonFinderSetRoles(['tank', 'healer'], druid);
    sim.setPlayerLevel(8, druid);
    sim.setSpec(specIdFor('druid', 'healer'), druid);
    const rest = addPlayers(sim, [
      { cls: 'warrior', roles: ['tank'], level: 8 },
      { cls: 'mage', roles: ['dps'], level: 8 },
      { cls: 'rogue', roles: ['dps'], level: 8 },
      { cls: 'hunter', roles: ['dps'], level: 8 },
    ]);
    const pids = [druid, ...rest];
    for (const pid of pids) sim.dungeonFinderQueueJoin(['hollow_crypt_normal'], pid);
    tickAll(sim, 1);
    // The restoration spec restricts the tank+healer selection to healing.
    expect(sim.dungeonFinderInfoFor(pids[0])?.proposal?.role).toBe('healer');
    expect(sim.dungeonFinderInfoFor(pids[1])?.proposal?.role).toBe('tank');
  });

  it('a decline returns accepted units to the queue with their original wait and locks out the decliner', () => {
    const sim = makeSim();
    const { pids } = queueFive(sim);
    // Let some queue time accrue before anyone answers.
    tickAll(sim, 20 * 5);
    for (const pid of pids.slice(0, 4)) sim.dungeonFinderRespond(true, pid);
    sim.dungeonFinderRespond(false, pids[4]);
    tickAll(sim, 1);
    // Decliner: out of the queue, on cooldown, cannot rejoin yet.
    const decliner = sim.dungeonFinderInfoFor(pids[4]);
    expect(decliner?.queue).toBeNull();
    expect(decliner?.cooldown).toBeGreaterThan(FINDER_DECLINE_COOLDOWN_SECONDS - 3);
    sim.dungeonFinderQueueJoin(['hollow_crypt_normal'], pids[4]);
    const events = tickAll(sim, 1);
    expect(errorsFor(events, pids[4])).toContain('You cannot join the queue again yet.');
    // The others are queued again and their wait includes the pre-proposal time.
    for (const pid of pids.slice(0, 4)) {
      const info = sim.dungeonFinderInfoFor(pid);
      expect(info?.queue).not.toBeNull();
      expect(info?.proposal).toBeNull();
      expect(info?.queue?.waited).toBeGreaterThanOrEqual(5);
      expect(info?.cooldown).toBe(0);
    }
    // After the cooldown passes, the decliner may queue again.
    tickAll(sim, 20 * (FINDER_DECLINE_COOLDOWN_SECONDS + 1));
    sim.dungeonFinderQueueJoin(['hollow_crypt_normal'], pids[4]);
    tickAll(sim, 1);
    expect(sim.dungeonFinderInfoFor(pids[4])?.queue).not.toBeNull();
  });

  it('a proposal expires after 30 seconds, penalizing only the non-responders', () => {
    const sim = makeSim();
    const { pids } = queueFive(sim);
    for (const pid of pids.slice(0, 3)) sim.dungeonFinderRespond(true, pid);
    tickAll(sim, 20 * (FINDER_PROPOSAL_SECONDS + 2));
    for (const pid of pids.slice(0, 3)) {
      expect(sim.dungeonFinderInfoFor(pid)?.queue).not.toBeNull();
      expect(sim.dungeonFinderInfoFor(pid)?.cooldown).toBe(0);
    }
    for (const pid of pids.slice(3)) {
      expect(sim.dungeonFinderInfoFor(pid)?.queue).toBeNull();
      expect(sim.dungeonFinderInfoFor(pid)?.cooldown).toBeGreaterThan(0);
    }
  });

  it("requires intersecting activity selections and picks the oldest unit's first activity", () => {
    const sim = makeSim();
    const pids = addPlayers(sim, [
      { cls: 'warrior', roles: ['tank'], level: 19 },
      { cls: 'priest', roles: ['healer'], level: 19 },
      { cls: 'mage', roles: ['dps'], level: 19 },
      { cls: 'rogue', roles: ['dps'], level: 19 },
      { cls: 'hunter', roles: ['dps'], level: 19 },
    ]);
    // Oldest unit wants only the Sanctum; the rest select both remaining
    // eligible activities. (Level 19 is only eligible for gravewyrm_sanctum_normal,
    // so disjointness is exercised with a second sim below.)
    for (const pid of pids) sim.dungeonFinderQueueJoin(['gravewyrm_sanctum_normal'], pid);
    tickAll(sim, 1);
    expect(sim.dungeonFinderInfoFor(pids[0])?.proposal?.activityId).toBe(
      'gravewyrm_sanctum_normal',
    );

    const sim2 = makeSim(7);
    const pids2 = addPlayers(sim2, [
      { cls: 'warrior', roles: ['tank'], level: 20 },
      { cls: 'priest', roles: ['healer'], level: 20 },
      { cls: 'mage', roles: ['dps'], level: 20 },
      { cls: 'rogue', roles: ['dps'], level: 20 },
      { cls: 'hunter', roles: ['dps'], level: 20 },
    ]);
    // Tank only wants the Sanctum; everyone else only heroic Hollow Crypt:
    // no intersection, no proposal.
    sim2.dungeonFinderQueueJoin(['gravewyrm_sanctum_normal'], pids2[0]);
    for (const pid of pids2.slice(1)) sim2.dungeonFinderQueueJoin(['hollow_crypt_heroic'], pid);
    tickAll(sim2, 1);
    for (const pid of pids2) expect(sim2.dungeonFinderInfoFor(pid)?.proposal ?? null).toBeNull();
    // The tank widens their selection: now the shared heroic can match, and the
    // chosen activity follows the OLDEST unit's ordered selection.
    sim2.dungeonFinderQueueLeave(pids2[0]);
    sim2.dungeonFinderQueueJoin(['hollow_crypt_heroic', 'gravewyrm_sanctum_heroic'], pids2[0]);
    tickAll(sim2, 1);
    expect(sim2.dungeonFinderInfoFor(pids2[1])?.proposal?.activityId).toBe('hollow_crypt_heroic');
  });

  it('is FIFO: the oldest compatible dps get the slots', () => {
    const sim = makeSim();
    const dps = addPlayers(
      sim,
      Array.from({ length: 5 }, (_, i) => ({
        cls: 'mage' as PlayerClass,
        roles: ['dps'] as Role[],
        level: 8,
        name: `D${i}`,
      })),
    );
    for (const pid of dps) {
      sim.dungeonFinderQueueJoin(['hollow_crypt_normal'], pid);
      tickAll(sim, 1); // strictly increasing join times
    }
    const [tank, healer] = addPlayers(sim, [
      { cls: 'warrior', roles: ['tank'], level: 8 },
      { cls: 'priest', roles: ['healer'], level: 8 },
    ]);
    sim.dungeonFinderQueueJoin(['hollow_crypt_normal'], tank);
    sim.dungeonFinderQueueJoin(['hollow_crypt_normal'], healer);
    tickAll(sim, 1);
    for (const pid of dps.slice(0, 3))
      expect(sim.dungeonFinderInfoFor(pid)?.proposal).not.toBeNull();
    for (const pid of dps.slice(3)) {
      expect(sim.dungeonFinderInfoFor(pid)?.proposal ?? null).toBeNull();
      expect(sim.dungeonFinderInfoFor(pid)?.queue).not.toBeNull();
    }
  });

  it('keeps premade parties indivisible and preserves their leader', () => {
    const sim = makeSim();
    const pids = addPlayers(sim, [
      { cls: 'warrior', roles: ['tank'], level: 8, name: 'Lead' },
      { cls: 'priest', roles: ['healer'], level: 8, name: 'Mate' },
      { cls: 'mage', roles: ['dps'], level: 8 },
      { cls: 'rogue', roles: ['dps'], level: 8 },
      { cls: 'hunter', roles: ['dps'], level: 8 },
    ]);
    // Solos queue FIRST, so the premade is the newest unit; its leader must
    // still lead the formed party.
    for (const pid of pids.slice(2)) sim.dungeonFinderQueueJoin(['hollow_crypt_normal'], pid);
    tickAll(sim, 1);
    sim.partyInvite(pids[1], pids[0]);
    sim.partyAccept(pids[1]);
    const premade = sim.partyOf(pids[0]);
    expect(premade?.leader).toBe(pids[0]);
    sim.dungeonFinderQueueJoin(['hollow_crypt_normal'], pids[0]);
    tickAll(sim, 1);
    for (const pid of pids) expect(sim.dungeonFinderInfoFor(pid)?.proposal).not.toBeNull();
    acceptAll(sim, pids);
    const party = sim.partyOf(pids[2]);
    expect(party?.id).toBe(premade?.id);
    expect(party?.leader).toBe(pids[0]);
    expect(party?.members).toHaveLength(5);
  });

  it('only the premade leader may queue or dequeue the unit', () => {
    const sim = makeSim();
    const [lead, mate] = addPlayers(sim, [
      { cls: 'warrior', roles: ['tank'], level: 8 },
      { cls: 'priest', roles: ['healer'], level: 8 },
    ]);
    sim.partyInvite(mate, lead);
    sim.partyAccept(mate);
    sim.dungeonFinderQueueJoin(['hollow_crypt_normal'], mate);
    let events = tickAll(sim, 1);
    expect(errorsFor(events, mate)).toContain('Only the party leader may use the Dungeon Finder.');
    sim.dungeonFinderQueueJoin(['hollow_crypt_normal'], lead);
    tickAll(sim, 1);
    expect(sim.dungeonFinderInfoFor(mate)?.queue).not.toBeNull();
    sim.dungeonFinderQueueLeave(mate);
    events = tickAll(sim, 1);
    expect(errorsFor(events, mate)).toContain('Only the party leader may use the Dungeon Finder.');
    expect(sim.dungeonFinderInfoFor(lead)?.queue).not.toBeNull();
  });

  it('every premade member must satisfy the level band (anti-boost)', () => {
    const sim = makeSim();
    const [lead, low] = addPlayers(sim, [
      { cls: 'warrior', roles: ['tank'], level: 8 },
      { cls: 'priest', roles: ['healer'], level: 5, name: 'Lowbie' },
    ]);
    sim.partyInvite(low, lead);
    sim.partyAccept(low);
    sim.dungeonFinderQueueJoin(['hollow_crypt_normal'], lead);
    const events = tickAll(sim, 1);
    expect(errorsFor(events, lead)).toContain(
      'Lowbie does not meet the level range for that activity.',
    );
    expect(sim.dungeonFinderInfoFor(lead)?.queue).toBeNull();
  });

  it('a full party cannot use the automatic queue', () => {
    const sim = makeSim();
    const pids = addPlayers(
      sim,
      Array.from({ length: 5 }, (_, i) => ({
        cls: 'druid' as PlayerClass,
        roles: ['tank', 'healer', 'dps'] as Role[],
        level: 8,
        name: `F${i}`,
      })),
    );
    for (const pid of pids.slice(1)) {
      sim.partyInvite(pid, pids[0]);
      sim.partyAccept(pid);
    }
    sim.dungeonFinderQueueJoin(['hollow_crypt_normal'], pids[0]);
    const events = tickAll(sim, 1);
    expect(errorsFor(events, pids[0])).toContain('Your group is too large for that activity.');
  });

  it('drops a queued unit when its party roster changes (sweep)', () => {
    const sim = makeSim();
    const [lead, mate, third] = addPlayers(sim, [
      { cls: 'warrior', roles: ['tank'], level: 8 },
      { cls: 'priest', roles: ['healer'], level: 8 },
      { cls: 'mage', roles: ['dps'], level: 8 },
    ]);
    sim.partyInvite(mate, lead);
    sim.partyAccept(mate);
    sim.dungeonFinderQueueJoin(['hollow_crypt_normal'], lead);
    tickAll(sim, 1);
    expect(sim.dungeonFinderInfoFor(lead)?.queue).not.toBeNull();
    // Roster change: a third member joins the party outside the finder.
    sim.partyInvite(third, lead);
    sim.partyAccept(third);
    tickAll(sim, 21); // cross a sweep boundary
    expect(sim.dungeonFinderInfoFor(lead)?.queue).toBeNull();
  });

  it('forms a 10-player raid (2/2/6) and converts the group to a raid with both subgroups capped', () => {
    const sim = makeSim();
    const defs: { cls: PlayerClass; roles: Role[]; level: number; name?: string }[] = [
      { cls: 'warrior', roles: ['tank'], level: 20, name: 'T1' },
      { cls: 'paladin', roles: ['tank'], level: 20, name: 'T2' },
      { cls: 'priest', roles: ['healer'], level: 20, name: 'H1' },
      { cls: 'shaman', roles: ['healer'], level: 20, name: 'H2' },
      ...Array.from({ length: 6 }, (_, i) => ({
        cls: 'mage' as PlayerClass,
        roles: ['dps'] as Role[],
        level: 20,
        name: `M${i}`,
      })),
    ];
    const pids = addPlayers(sim, defs);
    for (const pid of pids) sim.dungeonFinderQueueJoin(['nythraxis_boss_arena_normal'], pid);
    tickAll(sim, 1);
    const info = sim.dungeonFinderInfoFor(pids[0]);
    expect(info?.proposal?.size).toBe(10);
    acceptAll(sim, pids);
    const party = sim.partyOf(pids[0]);
    expect(party?.raid).toBe(true);
    expect(party?.members).toHaveLength(10);
    expect(party?.leader).toBe(pids[0]);
    const g1 = party?.members.filter((m) => (party?.raidGroups.get(m) ?? 1) === 1).length ?? 0;
    const g2 = party?.members.filter((m) => (party?.raidGroups.get(m) ?? 1) === 2).length ?? 0;
    expect(g1).toBeLessThanOrEqual(5);
    expect(g2).toBeLessThanOrEqual(5);
    expect(g1 + g2).toBe(10);
  });

  it('never changes loot settings or dungeon difficulty on formation', () => {
    const sim = makeSim();
    const { pids } = queueFive(sim);
    const before = pids.map((pid) => sim.dungeonDifficulty(pid));
    acceptAll(sim, pids);
    const party = sim.partyOf(pids[0]);
    expect(party?.lootStrategies.master.enabled).toBe(false);
    pids.forEach((pid, i) => {
      expect(sim.dungeonDifficulty(pid)).toBe(before[i]);
    });
  });

  it('cleans up on disconnect: queue unit, proposal, and cooldown-free return for the others', () => {
    const sim = makeSim();
    const { pids } = queueFive(sim);
    for (const pid of pids.slice(0, 4)) sim.dungeonFinderRespond(true, pid);
    sim.removePlayer(pids[4]);
    tickAll(sim, 1);
    for (const pid of pids.slice(0, 4)) {
      expect(sim.dungeonFinderInfoFor(pid)?.queue).not.toBeNull();
      expect(sim.dungeonFinderInfoFor(pid)?.cooldown).toBe(0);
    }
  });

  it('is deterministic: the same scenario yields the same assignments twice', () => {
    const run = () => {
      const sim = makeSim(1234);
      const { pids } = queueFive(sim);
      const roles = pids.map((pid) => sim.dungeonFinderInfoFor(pid)?.proposal?.role ?? null);
      acceptAll(sim, pids);
      const party = sim.partyOf(pids[0]);
      return { roles, leader: party?.leader, members: [...(party?.members ?? [])] };
    };
    expect(run()).toEqual(run());
  });
});

// ---------------------------------------------------------------------------
// Premade board: listings + applications.
// ---------------------------------------------------------------------------

describe('premade board', () => {
  function listedPair(sim: Sim): { leader: number; applicant: number } {
    const [leader, applicant] = addPlayers(sim, [
      { cls: 'warrior', roles: ['tank'], level: 8, name: 'Lead' },
      { cls: 'priest', roles: ['healer'], level: 8, name: 'App' },
    ]);
    sim.dungeonFinderListingCreate('hollow_crypt_normal', ['first_run'], leader);
    tickAll(sim, 1);
    return { leader, applicant };
  }

  it('publishes a listing with roster, needed roles, and structured tags', () => {
    const sim = makeSim();
    const { leader } = listedPair(sim);
    const board = sim.dungeonFinderBoardView();
    expect(board).toHaveLength(1);
    expect(board[0].activityId).toBe('hollow_crypt_normal');
    expect(board[0].leaderName).toBe('Lead');
    expect(board[0].tags).toEqual(['first_run']);
    expect(board[0].size).toBe(1);
    expect(board[0].capacity).toBe(5);
    expect(board[0].needed).toEqual({ tank: 0, healer: 1, dps: 3 });
    expect(board[0].members[0].role).toBe('tank');
    expect(sim.dungeonFinderInfoFor(leader)?.myListing?.id).toBe(board[0].id);
  });

  it('runs the application lifecycle: apply, leader sees it, accept forms the group', () => {
    const sim = makeSim();
    const { leader, applicant } = listedPair(sim);
    const listingId = sim.dungeonFinderBoardView()[0].id;
    sim.dungeonFinderApply(listingId, applicant);
    tickAll(sim, 1);
    const myListing = sim.dungeonFinderInfoFor(leader)?.myListing;
    expect(myListing?.applicants).toHaveLength(1);
    expect(myListing?.applicants[0].name).toBe('App');
    expect(myListing?.applicants[0].roles).toEqual(['healer']);
    expect(sim.dungeonFinderInfoFor(applicant)?.myApplication?.listingId).toBe(listingId);
    sim.dungeonFinderApplicationRespond(applicant, true, leader);
    tickAll(sim, 1);
    const party = sim.partyOf(leader);
    expect(party?.leader).toBe(leader);
    expect(party?.members).toEqual([leader, applicant]);
    expect(sim.dungeonFinderInfoFor(applicant)?.myApplication ?? null).toBeNull();
    // Listing remains open with one more member on the roster.
    const board = sim.dungeonFinderBoardView();
    expect(board[0].size).toBe(2);
    expect(board[0].needed).toEqual({ tank: 0, healer: 0, dps: 3 });
  });

  it('declining an application clears it without touching the party', () => {
    const sim = makeSim();
    const { leader, applicant } = listedPair(sim);
    const listingId = sim.dungeonFinderBoardView()[0].id;
    sim.dungeonFinderApply(listingId, applicant);
    sim.dungeonFinderApplicationRespond(applicant, false, leader);
    tickAll(sim, 1);
    expect(sim.partyOf(leader)).toBeNull();
    expect(sim.dungeonFinderInfoFor(applicant)?.myApplication ?? null).toBeNull();
    expect(sim.dungeonFinderInfoFor(leader)?.myListing?.applicants).toHaveLength(0);
  });

  it('enforces applicant eligibility: level band, party-free, role fit, one application', () => {
    const sim = makeSim();
    const { applicant } = listedPair(sim);
    const listingId = sim.dungeonFinderBoardView()[0].id;
    const [low, tank2, other] = addPlayers(sim, [
      { cls: 'mage', roles: ['dps'], level: 5 },
      { cls: 'paladin', roles: ['tank'], level: 8 },
      { cls: 'rogue', roles: ['dps'], level: 8 },
    ]);
    let events: SimEvent[];
    sim.dungeonFinderApply(listingId, low);
    events = tickAll(sim, 1);
    expect(errorsFor(events, low)).toContain('You do not meet the level range for that activity.');
    // The tank slot is taken by the leader, so a tank-only applicant cannot fit.
    sim.dungeonFinderApply(listingId, tank2);
    events = tickAll(sim, 1);
    expect(errorsFor(events, tank2)).toContain('That listing has no room for your roles.');
    // A party member cannot apply.
    sim.partyInvite(other, applicant);
    sim.partyAccept(other);
    sim.dungeonFinderApply(listingId, other);
    events = tickAll(sim, 1);
    expect(errorsFor(events, other)).toContain('Leave your party before applying to a listing.');
    // One live application at a time.
    sim.dungeonFinderApply(listingId, low);
    sim.dungeonFinderSetRoles(['dps'], low);
    sim.setPlayerLevel(8, low);
    sim.dungeonFinderApply(listingId, low);
    tickAll(sim, 1);
    sim.dungeonFinderApply(listingId, low);
    events = tickAll(sim, 1);
    expect(errorsFor(events, low)).toContain('You already have a pending application.');
  });

  it('closes the listing when it fills and notifies remaining applicants when it closes', () => {
    const sim = makeSim();
    const [leader, h, d1, d2, d3, extra] = addPlayers(sim, [
      { cls: 'warrior', roles: ['tank'], level: 8, name: 'Lead' },
      { cls: 'priest', roles: ['healer'], level: 8 },
      { cls: 'mage', roles: ['dps'], level: 8 },
      { cls: 'rogue', roles: ['dps'], level: 8 },
      { cls: 'hunter', roles: ['dps'], level: 8 },
      { cls: 'warlock', roles: ['dps'], level: 8 },
    ]);
    sim.dungeonFinderListingCreate('hollow_crypt_normal', [], leader);
    tickAll(sim, 1);
    const listingId = sim.dungeonFinderBoardView()[0].id;
    for (const pid of [h, d1, d2, d3, extra]) sim.dungeonFinderApply(listingId, pid);
    for (const pid of [h, d1, d2, d3]) sim.dungeonFinderApplicationRespond(pid, true, leader);
    tickAll(sim, 1);
    expect(sim.partyOf(leader)?.members).toHaveLength(5);
    expect(sim.dungeonFinderBoardView()).toHaveLength(0);
    expect(sim.dungeonFinderInfoFor(leader)?.myListing ?? null).toBeNull();
    // The extra applicant's pending application died with the listing.
    expect(sim.dungeonFinderInfoFor(extra)?.myApplication ?? null).toBeNull();
  });

  it('closes the listing when the leader disconnects', () => {
    const sim = makeSim();
    const { leader, applicant } = listedPair(sim);
    const listingId = sim.dungeonFinderBoardView()[0].id;
    sim.dungeonFinderApply(listingId, applicant);
    sim.removePlayer(leader);
    tickAll(sim, 1);
    expect(sim.dungeonFinderBoardView()).toHaveLength(0);
    expect(sim.dungeonFinderInfoFor(applicant)?.myApplication ?? null).toBeNull();
  });

  it('supports the solo crypt as a listing-only activity (no roles, level 20, never auto-queued)', () => {
    const sim = makeSim();
    const [leader, buddy] = addPlayers(sim, [
      { cls: 'warrior', roles: ['tank'], level: 20, name: 'Lead' },
      { cls: 'mage', roles: ['dps'], level: 20 },
    ]);
    // The crypt cannot be auto-queued.
    sim.dungeonFinderQueueJoin(['nythraxis_crypt_normal'], leader);
    const events = tickAll(sim, 1);
    expect(errorsFor(events, leader)).toContain('Select at least one activity to queue for.');
    // But it can be listed and joined through the board without role checks.
    sim.dungeonFinderListingCreate('nythraxis_crypt_normal', ['quest_run'], leader);
    tickAll(sim, 1);
    const board = sim.dungeonFinderBoardView();
    expect(board[0].needed).toBeNull();
    expect(board[0].capacity).toBe(5);
    sim.dungeonFinderApply(board[0].id, buddy);
    sim.dungeonFinderApplicationRespond(buddy, true, leader);
    tickAll(sim, 1);
    expect(sim.partyOf(leader)?.members).toEqual([leader, buddy]);
  });

  it('a raid listing converts the party to a raid on the first acceptance', () => {
    const sim = makeSim();
    const [leader, buddy] = addPlayers(sim, [
      { cls: 'warrior', roles: ['tank'], level: 20, name: 'Lead' },
      { cls: 'priest', roles: ['healer'], level: 20 },
    ]);
    sim.dungeonFinderListingCreate('nythraxis_boss_arena_normal', [], leader);
    tickAll(sim, 1);
    const listingId = sim.dungeonFinderBoardView()[0].id;
    sim.dungeonFinderApply(listingId, buddy);
    sim.dungeonFinderApplicationRespond(buddy, true, leader);
    tickAll(sim, 1);
    const party = sim.partyOf(leader);
    expect(party?.raid).toBe(true);
    expect(party?.leader).toBe(leader);
  });

  it('an out-of-range member invalidates the whole listing (anti-boost, sweep)', () => {
    const sim = makeSim();
    const { leader, applicant } = listedPair(sim);
    const listingId = sim.dungeonFinderBoardView()[0].id;
    sim.dungeonFinderApply(listingId, applicant);
    sim.dungeonFinderApplicationRespond(applicant, true, leader);
    tickAll(sim, 1);
    expect(sim.dungeonFinderBoardView()).toHaveLength(1);
    // The accepted healer outlevels the band: the listing must close.
    sim.setPlayerLevel(12, applicant);
    tickAll(sim, 21);
    expect(sim.dungeonFinderBoardView()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Dev seeding: "/dev lfg" (docs/prd/dungeon-finder.md tooling; devCommands only).
// ---------------------------------------------------------------------------

describe('/dev lfg seeding', () => {
  const makeDevSim = () => new Sim({ seed: 42, playerClass: 'warrior', devCommands: true });

  it('queue mode spawns the complementary bots so my join pops a proposal', () => {
    const sim = makeDevSim();
    sim.setPlayerLevel(8);
    sim.setSpec(specIdFor('warrior', 'tank'));
    sim.dungeonFinderSetRoles(['tank']);
    sim.chat('/dev lfg');
    tickAll(sim, 1);
    const bots = [...sim.players.values()].filter((m) => m.isDevBot);
    expect(bots).toHaveLength(4);
    sim.dungeonFinderQueueJoin(['hollow_crypt_normal']);
    tickAll(sim, 1);
    expect(sim.dungeonFinderInfo?.proposal).not.toBeNull();
    expect(sim.dungeonFinderInfo?.proposal?.role).toBe('tank');
    // The bots auto-accept, so the popup meters already show 4 of 5 and MY
    // single accept is all that is left to form the group.
    expect(sim.dungeonFinderInfo?.proposal?.accepted).toBe(4);
    sim.dungeonFinderRespond(true);
    tickAll(sim, 1);
    const party = sim.partyOf(sim.playerId);
    expect(party?.members).toHaveLength(5);
  });

  it('raid mode fills the 2/2/6 composition around my role at the cap', () => {
    const sim = makeDevSim();
    sim.setPlayerLevel(20);
    sim.setSpec(specIdFor('warrior', 'tank'));
    sim.dungeonFinderSetRoles(['tank']);
    sim.chat('/dev lfg raid');
    tickAll(sim, 1);
    expect([...sim.players.values()].filter((m) => m.isDevBot)).toHaveLength(9);
    sim.dungeonFinderQueueJoin(['nythraxis_boss_arena_normal']);
    tickAll(sim, 1);
    expect(sim.dungeonFinderInfo?.proposal?.size).toBe(10);
  });

  it('board mode publishes bot listings and sends my listing an applicant', () => {
    const sim = makeDevSim();
    sim.setPlayerLevel(8);
    sim.setSpec(specIdFor('warrior', 'tank'));
    sim.dungeonFinderSetRoles(['tank']);
    sim.dungeonFinderListingCreate('hollow_crypt_normal', ['first_run']);
    sim.chat('/dev lfg board');
    tickAll(sim, 1);
    expect(sim.dungeonFinderBoardView()).toHaveLength(3);
    expect(sim.dungeonFinderInfo?.myListing?.applicants).toHaveLength(1);
  });

  it('asks for a role first and is inert without devCommands', () => {
    const sim = makeDevSim();
    sim.setPlayerLevel(8);
    // Specced but no role selected: seeding must still refuse.
    sim.setSpec(specIdFor('warrior', 'tank'));
    sim.chat('/dev lfg');
    tickAll(sim, 1);
    expect([...sim.players.values()].filter((m) => m.isDevBot)).toHaveLength(0);
    const prod = new Sim({ seed: 42, playerClass: 'warrior' });
    prod.setPlayerLevel(8);
    prod.setSpec(specIdFor('warrior', 'tank'));
    prod.dungeonFinderSetRoles(['tank']);
    prod.chat('/dev lfg');
    tickAll(prod, 1);
    expect([...prod.players.values()].filter((m) => m.isDevBot)).toHaveLength(0);
  });
});

// The finder forms and dissolves groups through its OWN seam (formDungeonFinderGroup),
// so every party-side rule the invite path grows has to be mirrored here or it silently
// diverges. These three regressions all came in with the release/v0.26.0 merge.
describe('parity with the invite path (party-side rules)', () => {
  it('credits partiesJoined for every member of a finder-formed group', () => {
    const sim = makeSim();
    const { pids } = queueFive(sim);
    for (const pid of pids) {
      expect(sim.players.get(pid)?.deedStats.counters.partiesJoined).toBe(0);
    }
    acceptAll(sim, pids);
    expect(sim.partyOf(pids[0])).not.toBeNull();
    // The leader (a fresh party is created for them) and each joining member.
    for (const pid of pids) {
      expect(sim.players.get(pid)?.deedStats.counters.partiesJoined, `pid ${pid}`).toBe(1);
    }
  });

  it('clears a premade ready check when the finder dissolves its source party', () => {
    const sim = makeSim();
    const pids = addPlayers(sim, [
      { cls: 'warrior', roles: ['tank'], level: 8, name: 'Lead' },
      { cls: 'priest', roles: ['healer'], level: 8, name: 'Mate' },
      { cls: 'mage', roles: ['dps'], level: 8 },
      { cls: 'rogue', roles: ['dps'], level: 8 },
      { cls: 'hunter', roles: ['dps'], level: 8 },
    ]);
    for (const pid of pids.slice(2)) sim.dungeonFinderQueueJoin(['hollow_crypt_normal'], pid);
    tickAll(sim, 1);
    sim.partyInvite(pids[1], pids[0]);
    sim.partyAccept(pids[1]);
    const premadeId = sim.partyOf(pids[0])?.id;
    // The premade runs a ready check, THEN gets matched: its party id is about to die.
    sim.chat('/ready', pids[0]);
    tickAll(sim, 1);
    expect((sim as any).readyChecks.has(premadeId)).toBe(true);
    sim.dungeonFinderQueueJoin(['hollow_crypt_normal'], pids[0]);
    tickAll(sim, 1);
    acceptAll(sim, pids);
    const formed = sim.partyOf(pids[0]);
    expect(formed).not.toBeNull();
    // The source party is gone; no ready check may outlive it (its members now resolve
    // to the formed party, so they could never answer it).
    const stale = [...(sim as any).readyChecks.keys()].filter((id: number) => id !== formed?.id);
    expect(stale).toEqual([]);
  });

  it('never matches a player who is already leaving (the disconnect flag)', () => {
    const sim = makeSim();
    const { pids } = queueFive(sim);
    for (const pid of pids) expect(sim.dungeonFinderInfoFor(pid)?.proposal).not.toBeNull();
    // A proposal is live; one member disconnects. preparePlayerLeave runs BEFORE the
    // persistence await (and before removePlayer), so the finder must drop them here.
    sim.preparePlayerLeave(pids[4]);
    tickAll(sim, 1);
    for (const pid of pids) expect(sim.dungeonFinderInfoFor(pid)?.proposal).toBeNull();
    expect(sim.dungeonFinderInfoFor(pids[4])?.queue).toBeNull();
    // And a leaver still in players/entities can never be re-matched.
    for (const pid of pids.slice(0, 4)) sim.dungeonFinderQueueJoin(['hollow_crypt_normal'], pid);
    sim.dungeonFinderQueueJoin(['hollow_crypt_normal'], pids[4]);
    tickAll(sim, 2);
    expect(sim.dungeonFinderInfoFor(pids[0])?.proposal).toBeNull();
    expect(sim.partyOf(pids[0])).toBeNull();
  });
});
