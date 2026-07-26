import { describe, expect, it } from 'vitest';
import { DELVE_BAND_X_MIN, DELVE_LIST, isDelvePos, VC_PRACTICE_BAND_X_MIN } from '../src/sim/data';
import { DELVE_MODULE_LAYOUTS } from '../src/sim/delve_layout';
import { devTierIndexForMergedPrs } from '../src/sim/dev_tier';
import {
  buildSourceCaveSpec,
  SOURCE_CAVE_DELVE_INDEX,
  SOURCE_CAVE_MOB_MIN_DIST,
  SOURCE_CAVE_PLACEHOLDER_ROSTER,
  type SourceCaveRosterEntry,
  sourceCaveArenaUsableRadius,
  sourceCaveEntryZ,
  sourceCaveExitZ,
  sourceCaveMobProfileForMergedPrs,
  sourceCaveMobProfileForTier,
  sourceCaveMobTemplate,
  sourceCaveOrigin,
} from '../src/sim/source_cave';

const SOURCE_CAVE_ARENA_MODULE = 'source_cave_arena';

function makeRoster(n: number): SourceCaveRosterEntry[] {
  const out: SourceCaveRosterEntry[] = [];
  for (let i = 0; i < n; i++) {
    // rank 1 is the most-merged contributor; mergedPrs fans across the tiers.
    out.push({ login: `contributor-${i}`, mergedPrs: (n - i) * 3, rank: i + 1 });
  }
  return out;
}

function dist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function radius(m: { x: number; z: number }): number {
  return Math.hypot(m.x, m.z);
}

describe('the cave lane stays inside the delve collider band', () => {
  // The cave has no colliders of its own: it borrows the delve resolver, which
  // only engages where isDelvePos() is true (src/sim/colliders.ts
  // resolvePosition). Its reserved lane has twice been swallowed by a
  // neighbouring band growing west (the Yumi Maze band, then the Vale Cup
  // practice band becoming isDelvePos()'s east cap), and the symptom both times
  // was silent: walls stop holding while everything else still works. Assert the
  // whole footprint, not just the centre, so the next band move reds here.
  const CAVE_HALF_WIDTH = 26; // delve side-wall centre 25 + the collider's 1u outer face

  it('covers the cave centre and both side-wall faces with isDelvePos', () => {
    const x = sourceCaveOrigin(0).x;
    expect(isDelvePos(x)).toBe(true);
    expect(isDelvePos(x - CAVE_HALF_WIDTH)).toBe(true);
    expect(isDelvePos(x + CAVE_HALF_WIDTH)).toBe(true);
    // Every slot shares this x (slots stack along z), so one slot proves them all.
    expect(sourceCaveOrigin(7).x).toBe(x);
  });

  it('keeps a full lane of clearance between the cave and the next band', () => {
    const x = sourceCaveOrigin(0).x;
    expect(x).toBeGreaterThan(DELVE_BAND_X_MIN);
    // A lane is 600u; the neighbouring band must not creep to within one of it.
    expect(VC_PRACTICE_BAND_X_MIN - (x + CAVE_HALF_WIDTH)).toBeGreaterThanOrEqual(
      600 - CAVE_HALF_WIDTH,
    );
  });

  it('reserves the first lane past the real delves', () => {
    // Real delves hold indices 0 and 1; the cave takes 2. A new delve landing on
    // this index must move the cave deliberately, which this pin forces.
    expect(SOURCE_CAVE_DELVE_INDEX).toBe(2);
    expect(DELVE_LIST.every((d) => d.index !== SOURCE_CAVE_DELVE_INDEX)).toBe(true);
  });
});

describe('buildSourceCaveSpec determinism', () => {
  it('produces a deep-equal spec for the same roster and seed', () => {
    const roster = makeRoster(12);
    expect(buildSourceCaveSpec(roster, 123)).toEqual(buildSourceCaveSpec(roster, 123));
  });

  it('does not depend on the roster array order', () => {
    const roster = makeRoster(12);
    const reversed = [...roster].reverse();
    expect(buildSourceCaveSpec(reversed, 123)).toEqual(buildSourceCaveSpec(roster, 123));
  });

  it('stays order-independent when ranks tie, via the login tiebreak', () => {
    // makeRoster gives unique ranks, so the sort alone fixes the order and the
    // login tiebreak never runs. Equal ranks exercise it: without the tiebreak a
    // stable sort would keep input order, so reversing the input would reorder the
    // mobs. Deep equality across both input orders proves the tiebreak holds.
    const tied: SourceCaveRosterEntry[] = [
      { login: 'mallow', mergedPrs: 40, rank: 2 },
      { login: 'cobble', mergedPrs: 12, rank: 2 },
      { login: 'sable', mergedPrs: 33, rank: 2 },
      { login: 'thrift', mergedPrs: 4, rank: 2 },
    ];
    const reversed = [...tied].reverse();
    expect(buildSourceCaveSpec(reversed, 5)).toEqual(buildSourceCaveSpec(tied, 5));
  });

  it('places mobs differently for a different seed, isolated from the arena itself', () => {
    // The cave is always the one arena room, so the module list is seed-invariant
    // and only the ring placement can differ: this pins placement, not room choice.
    const roster = makeRoster(4);
    const a = buildSourceCaveSpec(roster, 1);
    const b = buildSourceCaveSpec(roster, 2);
    expect(a.modules).toEqual(b.modules);
    expect(a.mobs.map((m) => [m.x, m.z])).not.toEqual(b.mobs.map((m) => [m.x, m.z]));
  });

  it('produces a JSON-serializable spec (no NaN, cycles, or class instances)', () => {
    const spec = buildSourceCaveSpec(SOURCE_CAVE_PLACEHOLDER_ROSTER, 7);
    expect(JSON.parse(JSON.stringify(spec))).toEqual(spec);
  });
});

describe('buildSourceCaveSpec roster sizes', () => {
  it('builds a minimal valid cave for an empty roster', () => {
    const spec = buildSourceCaveSpec([], 5);
    expect(spec.mobs).toEqual([]);
    expect(spec.modules).toEqual([SOURCE_CAVE_ARENA_MODULE]);
    const arena = DELVE_MODULE_LAYOUTS[SOURCE_CAVE_ARENA_MODULE];
    expect(spec.chestPos).toEqual({ x: arena.dais.x, z: arena.dais.z });
  });

  it('is always the single arena room, regardless of roster size', () => {
    for (const n of [1, 12, 60]) {
      const spec = buildSourceCaveSpec(makeRoster(n), 42);
      expect(spec.mobs.length).toBe(n);
      expect(spec.modules).toEqual([SOURCE_CAVE_ARENA_MODULE]);
      for (const m of spec.mobs) expect(m.moduleIndex).toBe(0);
    }
  });

  it('fills the calibrated tier mix from the live roster', () => {
    const spec = buildSourceCaveSpec(SOURCE_CAVE_PLACEHOLDER_ROSTER, 42);
    const combatants = spec.mobs.filter(
      (mob) => (mob as typeof mob & { combatant?: boolean }).combatant === true,
    );
    expect(combatants.length).toBe(42);
    expect(combatants.filter((mob) => mob.boss).length).toBe(1);
    expect(combatants.filter((mob) => !mob.boss && mob.combatTier === 'tinkerer')).toHaveLength(18);
    expect(combatants.filter((mob) => !mob.boss && mob.combatTier === 'artificer')).toHaveLength(8);
    expect(combatants.filter((mob) => !mob.boss && mob.combatTier === 'runesmith')).toHaveLength(6);
    expect(combatants.filter((mob) => !mob.boss && mob.combatTier === 'architect')).toHaveLength(8);
    expect(combatants.filter((mob) => !mob.boss && mob.combatTier === 'worldwright')).toHaveLength(
      1,
    );
  });

  it('caps a 60-person roster at the combat budget, cutting only the leaderboard tail', () => {
    const roster = [
      ...SOURCE_CAVE_PLACEHOLDER_ROSTER,
      ...Array.from({ length: 60 - SOURCE_CAVE_PLACEHOLDER_ROSTER.length }, (_, i) => ({
        login: `newcomer-${i}`,
        mergedPrs: 1,
        rank: SOURCE_CAVE_PLACEHOLDER_ROSTER.length + 1 + i,
      })),
    ];
    const combatantLogins = (seed: number, input = roster) =>
      buildSourceCaveSpec(input, seed)
        .mobs.filter((mob) => (mob as typeof mob & { combatant?: boolean }).combatant === true)
        .map((mob) => mob.login)
        .sort();

    const seedA = combatantLogins(42);
    expect(seedA.length).toBe(42);
    // Membership is a pure function of the roster: neither the seed nor the input
    // order can shuffle a contributor out of the fight (and into the overflow
    // guardians the encounter retires wave by wave).
    expect(combatantLogins(42)).toEqual(seedA);
    expect(combatantLogins(43)).toEqual(seedA);
    expect(combatantLogins(42, [...roster].reverse())).toEqual(seedA);
    // The cut falls exactly at rank 42: everybody above fights, nobody below does.
    expect(seedA).toEqual(
      roster
        .filter((entry) => entry.rank <= 42)
        .map((entry) => entry.login)
        .sort(),
    );
  });

  it('never demotes a heavier contributor below a lighter one, at any seed', () => {
    // The regression this pins: an earlier build bucketed candidates by their own
    // merged-PR rung and shuffled the rungs that overflowed their cap, so three of
    // the five 70+ contributors could be cut while one-PR newcomers fought. Rank
    // order is now total, over membership AND power role.
    const roster = [
      ...SOURCE_CAVE_PLACEHOLDER_ROSTER,
      ...Array.from({ length: 60 - SOURCE_CAVE_PLACEHOLDER_ROSTER.length }, (_, i) => ({
        login: `newcomer-${i}`,
        mergedPrs: 1,
        rank: SOURCE_CAVE_PLACEHOLDER_ROSTER.length + 1 + i,
      })),
    ];
    const strength: Record<string, number> = {
      worldwright: 5,
      architect: 4,
      runesmith: 3,
      artificer: 2,
      tinkerer: 1,
      unranked: 0,
    };
    for (const seed of [1, 42, 4242]) {
      const byRank = [...buildSourceCaveSpec(roster, seed).mobs].sort((a, b) => a.rank - b.rank);
      const power = byRank.map((mob) =>
        mob.combatant && mob.combatTier ? strength[mob.combatTier] + (mob.boss ? 10 : 0) : -1,
      );
      for (let i = 1; i < power.length; i++) {
        expect(
          power[i],
          `rank ${byRank[i].rank} vs ${byRank[i - 1].rank} at seed ${seed}`,
        ).toBeLessThanOrEqual(power[i - 1]);
      }
      // The five 70+ contributors all fight; the tail carries the whole overflow.
      const overflow = byRank.filter((mob) => !mob.combatant);
      expect(overflow.length).toBe(roster.length - 42);
      expect(Math.min(...overflow.map((mob) => mob.rank))).toBe(43);
      expect(overflow.every((mob) => mob.mergedPrs <= 1)).toBe(true);
    }
  });

  it('keeps headcount, HP, damage and affix roles exact when contributors are promoted', () => {
    const baseline = buildSourceCaveSpec(SOURCE_CAVE_PLACEHOLDER_ROSTER, 42).mobs.filter(
      (mob) => mob.combatant,
    );
    const promoted = SOURCE_CAVE_PLACEHOLDER_ROSTER.map((entry) => ({
      ...entry,
      mergedPrs: entry.rank === 1 ? entry.mergedPrs : entry.mergedPrs + 100,
    }));
    const combatants = buildSourceCaveSpec(promoted, 42).mobs.filter((mob) => mob.combatant);
    const budget = (mobs: typeof combatants) =>
      mobs.reduce(
        (sum, mob) => {
          if (!mob.combatTier) throw new Error('combatant role missing');
          const profile = sourceCaveMobProfileForTier(mob.combatTier, mob.boss);
          sum.hp += profile.hpMult;
          sum.damage += profile.dmgMult;
          sum.roles[profile.key] = (sum.roles[profile.key] ?? 0) + 1;
          return sum;
        },
        { hp: 0, damage: 0, roles: {} as Record<string, number> },
      );

    expect(combatants).toHaveLength(42);
    expect(budget(combatants)).toEqual(budget(baseline));
    expect(budget(combatants).roles).toEqual({
      worldwright: 2,
      architect: 8,
      runesmith: 6,
      artificer: 8,
      tinkerer: 18,
    });
  });

  it('does not change combat power across the 29->30 and 69->70 PR thresholds', () => {
    const roster = SOURCE_CAVE_PLACEHOLDER_ROSTER.map((entry, i) => ({
      ...entry,
      mergedPrs: i === 0 ? entry.mergedPrs : i % 2 === 0 ? 29 : 69,
    }));
    const before = buildSourceCaveSpec(roster, 19);
    const after = buildSourceCaveSpec(
      roster.map((entry) => ({
        ...entry,
        mergedPrs: entry.mergedPrs === 29 ? 30 : entry.mergedPrs === 69 ? 70 : entry.mergedPrs,
      })),
      19,
    );
    expect(after.mobs.map((mob) => [mob.login, mob.combatant, mob.combatTier])).toEqual(
      before.mobs.map((mob) => [mob.login, mob.combatant, mob.combatTier]),
    );
  });

  it('builds runtime stats and affixes from a fixed role after promotion', () => {
    const promoted = SOURCE_CAVE_PLACEHOLDER_ROSTER.map((entry) => ({
      ...entry,
      mergedPrs: entry.rank === 1 ? entry.mergedPrs : entry.mergedPrs + 100,
    }));
    const architect = buildSourceCaveSpec(promoted, 42).mobs.find(
      (mob) => !mob.boss && mob.combatTier === 'architect' && mob.mergedPrs >= 70,
    );
    if (!architect) throw new Error('promoted architect combat role missing');
    const template = sourceCaveMobTemplate(architect);
    expect(template.hpMult).toBe(5.65);
    expect(template.dmgMult).toBe(1.75);
    expect(template.cleave).toBeDefined();
    expect(template.rampage).toBeUndefined();
    expect(template.visualKey).toBe('dev_hacker');
    expect(template.color).toBe(0xf0c454);
    expect(template.scale).toBe(1.3);
    expect(template.attackSpeed).toBe(2.3);
    expect(template.mainhandItemId).toBeUndefined();
  });
});

describe('buildSourceCaveSpec tier profile and boss mapping', () => {
  it('flags elite at the exact dev-tier thresholds', () => {
    // Elite iff dev tier index >= 3, i.e. mergedPrs >= 15 (runesmith and up
    // since the raid retuning). Boundaries covered: 4/5 (tier 1 vs 2), 14/15
    // (the elite flip), 29/30 (tier 3 vs 4), 69/70 (tier 4 vs 5), all elite.
    const roster: SourceCaveRosterEntry[] = [
      { login: 'a70', mergedPrs: 70, rank: 1 },
      { login: 'b69', mergedPrs: 69, rank: 2 },
      { login: 'c30', mergedPrs: 30, rank: 3 },
      { login: 'd29', mergedPrs: 29, rank: 4 },
      { login: 'h15', mergedPrs: 15, rank: 5 },
      { login: 'i14', mergedPrs: 14, rank: 6 },
      { login: 'e5', mergedPrs: 5, rank: 7 },
      { login: 'f4', mergedPrs: 4, rank: 8 },
      { login: 'g0', mergedPrs: 0, rank: 9 },
    ];
    const byLogin = new Map(buildSourceCaveSpec(roster, 9).mobs.map((m) => [m.login, m]));
    expect(byLogin.get('a70')?.elite).toBe(true);
    expect(byLogin.get('b69')?.elite).toBe(true);
    expect(byLogin.get('c30')?.elite).toBe(true);
    expect(byLogin.get('d29')?.elite).toBe(true);
    expect(byLogin.get('h15')?.elite).toBe(true);
    expect(byLogin.get('i14')?.elite).toBe(false);
    expect(byLogin.get('e5')?.elite).toBe(false);
    expect(byLogin.get('f4')?.elite).toBe(false);
    expect(byLogin.get('g0')?.elite).toBe(false);
    // The mob echoes its roster mergedPrs faithfully (not a constant).
    expect(byLogin.get('c30')?.mergedPrs).toBe(30);
    expect(byLogin.get('d29')?.mergedPrs).toBe(29);
  });

  it('flags exactly the rank-1 contributor as the boss, ringed around the centre', () => {
    const spec = buildSourceCaveSpec(makeRoster(12), 3);
    const bosses = spec.mobs.filter((m) => m.boss);
    expect(bosses.length).toBe(1);
    expect(bosses[0].rank).toBe(1);
    expect(bosses[0].moduleIndex).toBe(0);
    expect(radius(bosses[0])).toBeGreaterThan(0);
  });

  it('keeps mob level non-increasing across rings, from the boss outward', () => {
    // Pins the tier-profile gradient (not just the boss): a placement regression
    // that scrambled the ring order is caught here, since a mob in a clearly
    // farther ring must never out-level one in a clearly closer ring. A same-ring
    // pair can differ by tier while sharing near-identical radius (rounding noise
    // from the integer-coordinate wire parity below), so the comparison only
    // applies once the radius gap clears that noise (RING_TOLERANCE), which keeps
    // every compared pair in genuinely different rings.
    const spec = buildSourceCaveSpec(makeRoster(60), 3);
    const nonBoss = spec.mobs.filter((m) => !m.boss && m.combatant);
    const RING_TOLERANCE = 3;
    for (const a of nonBoss) {
      for (const b of nonBoss) {
        if (radius(b) - radius(a) > RING_TOLERANCE) {
          expect(a.level).toBeGreaterThanOrEqual(b.level);
        }
      }
    }
  });

  it('keeps exactly one boss even for off-contract rosters', () => {
    // Ranks that do not start at 1: the top (lowest-rank) contributor is the boss.
    const noRank1 = buildSourceCaveSpec(
      [
        { login: 'x', mergedPrs: 40, rank: 3 },
        { login: 'y', mergedPrs: 20, rank: 4 },
        { login: 'z', mergedPrs: 10, rank: 5 },
      ],
      2,
    );
    const noRank1Bosses = noRank1.mobs.filter((m) => m.boss);
    expect(noRank1Bosses.length).toBe(1);
    expect(noRank1Bosses[0].rank).toBe(3);

    // Duplicate rank-1 entries still yield exactly one boss (deterministic pick).
    const dupRank1 = buildSourceCaveSpec(
      [
        { login: 'alpha', mergedPrs: 90, rank: 1 },
        { login: 'bravo', mergedPrs: 88, rank: 1 },
        { login: 'charlie', mergedPrs: 12, rank: 3 },
      ],
      2,
    );
    expect(dupRank1.mobs.filter((m) => m.boss).length).toBe(1);
  });

  it('keeps levels in the cited band and derives them from the contributor profile', () => {
    const spec = buildSourceCaveSpec(makeRoster(12), 11);
    for (const m of spec.mobs) {
      const profile = sourceCaveMobProfileForMergedPrs(m.mergedPrs, m.boss);
      expect(m.level).toBeGreaterThanOrEqual(19);
      expect(m.level).toBeLessThanOrEqual(20);
      expect(m.level).toBe(profile.level);
      expect(m.elite).toBe(profile.elite);
      expect(m.boss).toBe(profile.boss);
    }
  });

  it('keeps profile levels when ranks are degenerate (single entry or all equal)', () => {
    // Single entry: rank no longer forces level. The contributor profile does.
    const single = buildSourceCaveSpec([{ login: 'solo', mergedPrs: 12, rank: 1 }], 4);
    expect(single.mobs).toHaveLength(1);
    expect(single.mobs[0].level).toBe(sourceCaveMobProfileForMergedPrs(12, true).level);
    expect(single.mobs[0].boss).toBe(true);

    // All-equal ranks: deterministic login tiebreak picks one boss, while each
    // mob keeps the level/elite/boss flags of its own merged-PR profile.
    const flat = buildSourceCaveSpec(
      [
        { login: 'p', mergedPrs: 8, rank: 2 },
        { login: 'q', mergedPrs: 16, rank: 2 },
        { login: 'r', mergedPrs: 4, rank: 2 },
      ],
      4,
    );
    for (const m of flat.mobs) {
      const profile = sourceCaveMobProfileForMergedPrs(m.mergedPrs, m.boss);
      expect(m.level).toBe(profile.level);
      expect(m.elite).toBe(profile.elite);
      expect(m.boss).toBe(profile.boss);
    }
    expect(flat.mobs.filter((m) => m.boss).length).toBe(1);
  });
});

describe('buildSourceCaveSpec placement (concentric rings)', () => {
  it('pins the advertised minimum mob distance', () => {
    // Guards the self-comparison trap: the spacing guarantee scales with this
    // constant, so the min-distance assertion below cannot catch a change to it.
    expect(SOURCE_CAVE_MOB_MIN_DIST).toBe(6);
  });

  it('pins the arena usable placement radius', () => {
    // Walls at +-48 (shrunk when the entry buffer was removed), minus the 5u
    // wall clearance = 43: just enough for the worst-case outer ring (38).
    expect(sourceCaveArenaUsableRadius()).toBe(43);
  });

  it('keeps the roster-cap entrance/exit inside the wall with the ring gap intact', () => {
    // The door (exit portal) hugs the wall by design; the SPAWN yields its
    // preferred 14u camera depth to a worst-case roster's outer ring, backing
    // toward the wall while keeping the 4u ring gap. The arena's own size
    // (delve_layout.ts) is the smallest value provably safe for this; this is
    // the regression guard for that derivation if any constant changes.
    const spec = buildSourceCaveSpec(makeRoster(60), 42);
    const layout = DELVE_MODULE_LAYOUTS[SOURCE_CAVE_ARENA_MODULE];
    const outer = Math.max(...spec.mobs.map(radius));
    expect(sourceCaveExitZ(spec)).toBe(layout.zMin + 3);
    expect(sourceCaveEntryZ(spec)).toBe(-(outer + 4));
    expect(sourceCaveEntryZ(spec)).toBeGreaterThan(layout.zMin + 3); // north of the portal
  });

  it('throws when the roster cannot fit inside the arena', () => {
    // Roster max is 60 (server/main.ts), comfortably inside the arena's capacity;
    // this pins the defensive guard for a roster far past any real cap.
    expect(() => buildSourceCaveSpec(makeRoster(500), 1)).toThrow();
  });

  it('places up to the real roster cap (60) without throwing', () => {
    const spec = buildSourceCaveSpec(makeRoster(60), 42);
    expect(spec.mobs.length).toBe(60);
  });

  it('spreads a large roster around the arena above the min distance', () => {
    const spec = buildSourceCaveSpec(makeRoster(60), 99);
    expect(spec.mobs.length).toBe(60);
    for (let i = 0; i < spec.mobs.length; i++) {
      for (let j = i + 1; j < spec.mobs.length; j++) {
        expect(dist(spec.mobs[i], spec.mobs[j])).toBeGreaterThanOrEqual(SOURCE_CAVE_MOB_MIN_DIST);
      }
    }
  });

  it('never emits negative-zero coordinates (wire round-trip parity)', () => {
    // roundCoord normalizes -0 to 0 so JSON/wire round-trips match on every host.
    // toEqual and JSON.stringify both hide -0, so a regression that drops the
    // normalization is invisible to the other tests; Object.is exposes it.
    const spec = buildSourceCaveSpec(makeRoster(60), 99);
    for (const m of spec.mobs) {
      expect(Object.is(m.x, -0)).toBe(false);
      expect(Object.is(m.z, -0)).toBe(false);
    }
  });

  it('keeps every mob strictly inside the arena walls', () => {
    const layout = DELVE_MODULE_LAYOUTS[SOURCE_CAVE_ARENA_MODULE];
    const spec = buildSourceCaveSpec(makeRoster(60), 8);
    for (const m of spec.mobs) {
      expect(Math.abs(m.x)).toBeLessThan(layout.wallX ?? Number.POSITIVE_INFINITY);
      expect(m.z).toBeGreaterThan(layout.zMin);
      expect(m.z).toBeLessThan(layout.zMax);
    }
  });

  it('spawns 14u deep for normal rosters and yields to the rings at the cap, door at the wall', () => {
    // Two-arm behavior: the door/exit visual always hugs the wall (zMin+3); the
    // spawn prefers 14u of depth (camera clearance behind the player), giving
    // way toward the wall only when an oversized roster's outer ring needs the
    // space, never closer than 4u to the ring.
    const arena = DELVE_MODULE_LAYOUTS[SOURCE_CAVE_ARENA_MODULE];
    for (const n of [3, 12]) {
      const spec = buildSourceCaveSpec(makeRoster(n), 3);
      expect(sourceCaveEntryZ(spec)).toBe(arena.zMin + 14);
      expect(sourceCaveExitZ(spec)).toBe(arena.zMin + 3);
    }
    const capped = buildSourceCaveSpec(makeRoster(60), 3);
    const outer = Math.max(...capped.mobs.map(radius));
    expect(sourceCaveEntryZ(capped)).toBe(-(outer + 4));
    for (const n of [3, 12, 60]) {
      const spec = buildSourceCaveSpec(makeRoster(n), 3);
      const outerRadius = spec.mobs.length > 0 ? Math.max(...spec.mobs.map(radius)) : 0;
      expect(Math.abs(sourceCaveEntryZ(spec)) - outerRadius).toBeGreaterThanOrEqual(4);
    }
  });

  it('keeps the centre dais free of mobs for the reboot button and reward chest', () => {
    const spec = buildSourceCaveSpec(makeRoster(12), 8);
    const arena = DELVE_MODULE_LAYOUTS[SOURCE_CAVE_ARENA_MODULE];
    expect(spec.chestPos).toEqual({ x: arena.dais.x, z: arena.dais.z });
    for (const mob of spec.mobs) {
      expect(dist(mob, spec.chestPos)).toBeGreaterThanOrEqual(SOURCE_CAVE_MOB_MIN_DIST);
    }
  });
});

describe('SOURCE_CAVE_PLACEHOLDER_ROSTER', () => {
  it('matches the complete 2026-07-26 developer leaderboard snapshot', () => {
    const roster = SOURCE_CAVE_PLACEHOLDER_ROSTER;
    expect(roster).toHaveLength(44);
    expect(
      roster.map((entry) => `${entry.rank}:${entry.login}:${entry.mergedPrs}`).join('\n'),
    ).toBe(`1:jgyy:289
2:Rubsey:173
3:FernandoX7:117
4:TrevCavill:74
5:ryan-foo:72
6:EnriqueGF:51
7:seanghods:42
8:madmatah:38
9:maxpolaczuk:31
10:jamiecypher:28
11:Blaine1705:26
12:sf-chris:24
13:gndk:23
14:patrick261:21
15:daxdax89:17
16:MasterZensei:17
17:CharlieSaxton:12
18:jbaron34:12
19:Donny-Deals:11
20:nicadeddu:11
21:No898:11
22:Nervescraper:9
23:DaPandamonium:8
24:awidearray:4
25:ChrisDBaldwin:4
26:Humpalumps:4
27:slonce70:4
28:Steakmushroompie:4
29:aqn96:3
30:postoso:3
31:Pepijnvdliefvoort:2
32:Wmedrado:2
33:a-aznar:1
34:AccompliceNZ:1
35:dems3398:1
36:Dubtribe11:1
37:gurtymcburty:1
38:IMasterChiefI:1
39:jfconde:1
40:raidolo:1
41:snipercup:1
42:SturdyStubs:1
43:troypolaczuk:1
44:zaidsinwan7474:1`);
    const tiers = new Set(roster.map((r) => devTierIndexForMergedPrs(r.mergedPrs)));
    for (const t of [1, 2, 3, 4, 5]) expect(tiers.has(t)).toBe(true);
    expect(roster.some((r) => r.mergedPrs >= 70)).toBe(true);
    expect(roster.filter((r) => r.rank === 1).length).toBe(1);
  });

  it('builds a valid cave with a single boss', () => {
    const spec = buildSourceCaveSpec(SOURCE_CAVE_PLACEHOLDER_ROSTER, 1);
    expect(spec.mobs.length).toBe(SOURCE_CAVE_PLACEHOLDER_ROSTER.length);
    expect(spec.mobs.filter((m) => m.boss).length).toBe(1);
  });
});
