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

  it('keeps the current 37-person roster fully combatant at the calibrated tier mix', () => {
    const spec = buildSourceCaveSpec(SOURCE_CAVE_PLACEHOLDER_ROSTER, 42);
    const combatants = spec.mobs.filter(
      (mob) => (mob as typeof mob & { combatant?: boolean }).combatant === true,
    );
    expect(combatants.length).toBe(37);
    expect(combatants.filter((mob) => mob.boss).length).toBe(1);
    expect(combatants.filter((mob) => !mob.boss && mob.combatTier === 'tinkerer')).toHaveLength(16);
    expect(combatants.filter((mob) => !mob.boss && mob.combatTier === 'artificer')).toHaveLength(8);
    expect(combatants.filter((mob) => !mob.boss && mob.combatTier === 'runesmith')).toHaveLength(6);
    expect(combatants.filter((mob) => !mob.boss && mob.combatTier === 'architect')).toHaveLength(5);
    expect(combatants.filter((mob) => !mob.boss && mob.combatTier === 'worldwright')).toHaveLength(
      1,
    );
  });

  it('caps a 60-person roster at the same combat budget and rotates overflow by seed', () => {
    const roster = [
      ...SOURCE_CAVE_PLACEHOLDER_ROSTER,
      ...Array.from({ length: 23 }, (_, i) => ({
        login: `newcomer-${i}`,
        mergedPrs: 1,
        rank: 38 + i,
      })),
    ];
    const combatantLogins = (seed: number, input = roster) =>
      buildSourceCaveSpec(input, seed)
        .mobs.filter((mob) => (mob as typeof mob & { combatant?: boolean }).combatant === true)
        .map((mob) => mob.login)
        .sort();

    const seedA = combatantLogins(42);
    const seedARepeat = combatantLogins(42);
    const seedB = combatantLogins(43);
    expect(seedA).toEqual(seedARepeat);
    expect(seedA.length).toBe(37);
    expect(seedB.length).toBe(37);
    expect(seedA).not.toEqual(seedB);
    expect(combatantLogins(42, [...roster].reverse())).toEqual(seedA);
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

    expect(combatants).toHaveLength(37);
    expect(budget(combatants)).toEqual(budget(baseline));
    expect(budget(combatants).roles).toEqual({
      worldwright: 2,
      architect: 5,
      runesmith: 6,
      artificer: 8,
      tinkerer: 16,
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
    expect(template.hpMult).toBe(4);
    expect(template.dmgMult).toBe(1.45);
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
  it('matches the complete 2026-07-11 developer leaderboard snapshot', () => {
    const roster = SOURCE_CAVE_PLACEHOLDER_ROSTER;
    expect(roster).toHaveLength(37);
    expect(
      roster.map((entry) => `${entry.rank}:${entry.login}:${entry.mergedPrs}`).join('\n'),
    ).toBe(`1:jgyy:204
2:Rubsey:125
3:TrevCavill:60
4:ryan-foo:44
5:madmatah:38
6:FernandoX7:36
7:EnriqueGF:35
8:gndk:23
9:Blaine1705:22
10:maxpolaczuk:22
11:patrick261:21
12:sf-chris:21
13:MasterZensei:15
14:jbaron34:12
15:daxdax89:11
16:nicadeddu:11
17:Donny-Deals:10
18:CharlieSaxton:9
19:Nervescraper:9
20:DaPandamonium:8
21:No898:5
22:ChrisDBaldwin:4
23:slonce70:4
24:aqn96:3
25:awidearray:3
26:jamiecypher:3
27:postoso:3
28:Steakmushroompie:3
29:Humpalumps:2
30:Pepijnvdliefvoort:2
31:a-aznar:1
32:AccompliceNZ:1
33:Dubtribe11:1
34:gurtymcburty:1
35:IMasterChiefI:1
36:SturdyStubs:1
37:zaidsinwan7474:1`);
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
