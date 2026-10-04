// Fire and Fly missions, data only: the four runs a recruited gunner can take any
// day (fire_and_fly_recruitment.ts unlocks them), each built around one idea and
// carrying the weapon that idea asks for. Every number here is a first value:
// mini-game tuning, not classic-era formulas. A tuning change after boards open mints
// a new board version. Each runs eight waves on one curve: a warm-up, a fast climb,
// then the last two or three waves pushing its idea to the extreme, each wave setting
// off on the tick the one before is cleared. Every tower holds 70 points (The Cracked
// Tower's 7 are its idea) under one medal rule (turret_defense.ts). The Pack is set (lot
// R5b) against the field-aware policy of the scenarios file at a 0.4 s pace: a member
// falls to two good shells, a leader to five or six, and at the worst moment of a run
// three to five monsters stand at the tower's foot (median; up to eight); that player golds
// about nine runs in ten reading the field exactly and three to four in five reading it
// 0.4 s late (a few points lost in the last two waves), while a 0.8 s player wins with
// silver or bronze and a 1 s player loses nearly half its runs. The other three were tuned (lot N2d) for a strike 1.5 s after a monster
// reaches the tower; at the 0.8 s strike of lot R4 they are far harder until their own
// redesign.

import {
  DT,
  type TurretGapDef,
  type TurretGroupDef,
  type TurretKegLotDef,
  type TurretScenarioDef,
  type TurretSidesDef,
  type TurretWaveDef,
  type TurretWaveEntry,
} from '../types';
import {
  TURRET_BARREL_RING,
  TURRET_MEDALS,
  TURRET_TOWER_POINTS,
  turretKegRing,
} from './turret_defense';

const ticks = (seconds: number): number => Math.round(seconds / DT);
const gap = (min: number, max: number) =>
  ({ gapMinTicks: ticks(min), gapMaxTicks: ticks(max) }) as const;

/**
 * Every mission is resupplied as its third, fifth and seventh waves end, so its finale always
 * starts with charges, and a won one scores the charges it leaves: each mission's arsenal is
 * its signature, the weapon its idea asks for.
 */
const MISSION_SUPPLY = { resupplyAfterWaves: [3, 5, 7], unusedChargeBonus: true } as const;
const KEGS = (count: number) => turretKegRing(count);

/** One group of walkers: from the whole ring, or from the sides given. */
const walkers = (
  entries: readonly TurretWaveEntry[],
  gaps: TurretGapDef,
  sides?: TurretSidesDef,
): TurretGroupDef => ({ brick: 'walkers', entries, ...gaps, ...(sides ? { sides } : {}) });

/** Bunches of `size` from a side each, `bunchGap` (s) between bunches. */
const bunches = (
  entries: readonly TurretWaveEntry[],
  gaps: TurretGapDef,
  size: number,
  bunchGap: number,
  widthTurn: number,
): TurretGroupDef => ({
  brick: 'smallGroup',
  entries,
  ...gaps,
  size,
  bunchGapTicks: ticks(bunchGap),
  widthTurn,
});

/** A member's own pace on its way to its rally: from its template's to a third quicker. */
const MUSTER = { speedScale: 1, speedScaleMax: 1.35 } as const;
/** Light, quick monsters that gather with the pack and break out at the departure. */
const SCOUT = { role: 'scout', speedScale: 2.2, speedScaleMax: 2.6 } as const;
/** The wave-8 pincer: a sprint group's monsters, that never gather and run straight in. */
const SPRINT = { speedScale: 2.4 } as const;
/**
 * The last three waves: every monster a tenth quicker to its rally or the tower, never
 * tougher than its template. Their difficulty is in the packs, not in the health.
 */
const LATE = 1.1;
const late = <T extends { speedScale: number; speedScaleMax?: number }>(role: T) => ({
  ...role,
  speedScale: role.speedScale * LATE,
  ...(role.speedScaleMax !== undefined ? { speedScaleMax: role.speedScaleMax * LATE } : {}),
});
const MUSTER_LATE = late(MUSTER);
const SCOUT_LATE = late(SCOUT);
type PathPlacement = 'front' | 'side';
const FRONT: PathPlacement = 'front';
const SIDE: PathPlacement = 'side';

/** A hunt wave's pack: its members, its advance scale, the kegs on its path and its delay (s). */
interface PackSpec {
  entries: readonly TurretWaveEntry[];
  advanceScale: number;
  kegs: readonly PathPlacement[];
  delay: number;
}
const pack = (
  entries: readonly TurretWaveEntry[],
  advanceScale: number,
  kegs: readonly PathPlacement[],
  delay = 0,
): PackSpec => ({ entries, advanceScale, kegs, delay });

/** The gathering: members spawn over 2 s on an arc of their pack's side, then walk to its rally. */
const SPREAD = ticks(2);
const WIDTH = 0.1;

/**
 * A hunt wave: its packs in order, each gathering at a rally in the band and waiting up to
 * `holdSeconds` for its last member, the kegs on their paths, then a sprint group (if any)
 * setting off `sprint.delay` s in. A hunt wave lays its kegs on its packs' paths, none on
 * the ring.
 */
function huntWave(
  coreDamage: number,
  band: readonly [number, number],
  holdSeconds: number,
  packs: readonly PackSpec[],
  sprint?: { entries: readonly TurretWaveEntry[]; delay: number },
): TurretWaveDef {
  const groups: TurretGroupDef[] = packs.map((p) => ({
    brick: 'pack',
    entries: p.entries,
    minRadius: band[0],
    maxRadius: band[1],
    holdTicks: ticks(holdSeconds),
    spreadTicks: SPREAD,
    widthTurn: WIDTH,
    advanceScale: p.advanceScale,
    ...(p.delay ? { delayTicks: ticks(p.delay) } : {}),
  }));
  if (sprint)
    groups.push({
      brick: 'sprint',
      entries: sprint.entries,
      spreadTicks: SPREAD,
      widthTurn: WIDTH,
      delayTicks: ticks(sprint.delay),
    });
  const kegs: TurretKegLotDef[] = packs.flatMap((p, group) =>
    p.kegs.map((placement) => ({ mode: 'path' as const, group, placement })),
  );
  return { groups, coreDamage, kegs };
}
/**
 * The rally bands: far enough that a front keg, a dozen yards and more tower-side of its
 * rally, still stands outside the keg ring's inner edge.
 */
const FIELD = [30, 36] as const;
const CLOSE = [30, 33] as const;

/**
 * The hunt. Each wave comes as packs: the members walk in dispersed from their pack's
 * side, each at its own pace, to a rally in the field, and stand there; once all of them
 * stand (or the hold timer since the first arrival runs out) the leader cries and, a
 * second later, the pack advances on the tower together at one walking pace, past the keg
 * laid on its path, while its scouts break out at a run. The rallies carry no marker: the
 * standing pack and the cry are the telegraph. One pack, then scouts, then two packs and
 * three, the gathering windows closing as the hold timer shortens from 6 s to 2.5 s; the
 * finale adds a sprint group that never gathers. A monster at the tower's foot strikes
 * fast, so the hunt is won in the field: the keg as a pack walks past it, the frag on a
 * pack standing clear of any keg, the shells on the scouts. No monster is tougher than its
 * template: each wave's shell damage, matched to its members' health, fells a member in
 * two good hits and a leader in five or six, so the last two waves are four packs at
 * once, not a crowd of sponges at the tower's foot.
 */
export const TURRET_MISSION_PACK: TurretScenarioDef = {
  id: 'fire_and_fly_pack',
  boardKey: 'pack',
  integrity: TURRET_TOWER_POINTS,
  medals: TURRET_MEDALS,
  // The frag is its signature; a recruited gunner carries the Shockwave too.
  arsenal: { shockwave: 1, fragmentation: 5 },
  supply: MISSION_SUPPLY,
  waves: [
    huntWave(45, FIELD, 6, [
      pack([{ templateId: 'forest_wolf', count: 8, level: 2, ...MUSTER, leads: true }], 1.1, [
        FRONT,
      ]),
    ]),
    huntWave(52, FIELD, 6, [
      pack(
        [
          { templateId: 'forest_wolf', count: 5, level: 2, ...MUSTER, leads: true },
          { templateId: 'wild_boar', count: 4, level: 3, ...MUSTER },
          { templateId: 'forest_wolf', count: 2, level: 2, ...SCOUT },
        ],
        1.15,
        [FRONT],
      ),
    ]),
    huntWave(
      71,
      FIELD,
      4,
      [0, 1].map((p) =>
        pack(
          [
            { templateId: 'webwood_spider', count: 3, level: 4, ...MUSTER, leads: true },
            { templateId: 'vale_bandit', count: 4, level: 5, ...MUSTER },
            { templateId: 'tunnel_rat', count: 2, level: 6, ...SCOUT },
          ],
          1.2,
          [p === 0 ? FRONT : SIDE],
          p === 0 ? 0 : 7,
        ),
      ),
    ),
    huntWave(
      89,
      FIELD,
      4,
      [0, 1].map((p) =>
        pack(
          [
            { templateId: 'tunnel_rat', count: 5, level: 6, ...MUSTER },
            { templateId: 'vale_bandit', count: 2, level: 5, ...MUSTER },
            { templateId: 'fen_troll', count: 1, level: 12, ...MUSTER, leads: true },
            { templateId: 'tunnel_rat', count: 2, level: 6, ...SCOUT },
          ],
          1.2,
          p === 0 ? [FRONT] : [],
          p === 0 ? 0 : 0.5,
        ),
      ),
    ),
    huntWave(
      261,
      FIELD,
      4,
      [0, 1].map((p) =>
        pack(
          [
            { templateId: 'deeprock_kobold', count: 3, level: 15, ...MUSTER },
            { templateId: 'boneclad_revenant', count: 4, level: 19, ...MUSTER },
            { templateId: 'thornpeak_ogre', count: 1, level: 16, ...MUSTER, leads: true },
            { templateId: 'tunnel_rat', count: 2, level: 6, ...SCOUT },
          ],
          1.25,
          [FRONT],
          p === 0 ? 0 : 2,
        ),
      ),
    ),
    huntWave(
      256,
      FIELD,
      3,
      (
        [
          [[FRONT], 0],
          [[SIDE], 3],
          [[], 6],
        ] as const
      ).map(([kegs, delay]) =>
        pack(
          [
            { templateId: 'boneclad_revenant', count: 3, level: 19, ...MUSTER_LATE },
            { templateId: 'deeprock_kobold', count: 2, level: 15, ...MUSTER_LATE },
            { templateId: 'frostmane_yeti', count: 1, level: 19, ...MUSTER_LATE, leads: true },
            { templateId: 'tunnel_rat', count: 2, level: 6, ...SCOUT_LATE },
          ],
          1.25,
          kegs,
          delay,
        ),
      ),
    ),
    huntWave(
      96,
      CLOSE,
      2,
      (
        [
          [[FRONT], 0],
          [[FRONT], 1.5],
          [[], 3],
          [[SIDE], 4.5],
        ] as const
      ).map(([kegs, delay]) =>
        pack(
          [
            { templateId: 'tunnel_rat', count: 2, level: 6, ...MUSTER_LATE },
            { templateId: 'vale_bandit', count: 2, level: 5, ...MUSTER_LATE },
            { templateId: 'thornpeak_ogre', count: 1, level: 16, ...MUSTER_LATE, leads: true },
            { templateId: 'tunnel_rat', count: 2, level: 6, ...SCOUT_LATE },
          ],
          1.3,
          kegs,
          delay,
        ),
      ),
    ),
    huntWave(
      256,
      CLOSE,
      2,
      (
        [
          [[FRONT], 0],
          [[SIDE], 1],
          [[], 2],
          [[FRONT], 3],
        ] as const
      ).map(([kegs, delay]) =>
        pack(
          [
            { templateId: 'boneclad_revenant', count: 2, level: 19, ...MUSTER_LATE },
            { templateId: 'deeprock_kobold', count: 2, level: 15, ...MUSTER_LATE },
            { templateId: 'frostmane_yeti', count: 1, level: 19, ...MUSTER_LATE, leads: true },
            { templateId: 'tunnel_rat', count: 2, level: 6, ...SCOUT_LATE },
          ],
          1.35,
          kegs,
          delay,
        ),
      ),
      { entries: [{ templateId: 'tunnel_rat', count: 6, level: 6, ...late(SPRINT) }], delay: 3 },
    ),
  ],
};

const FRAIL = 0.8;

/**
 * A tide of small beasts that never lets the gunner settle: varied waves of walkers, small
 * groups and a pack, quicker than any other mission's, with a monster or two surging in from
 * a side away from the fight, and two surges as its strong moments (the fourth wave's from one
 * side, the last wave's from two). A Fen Troll walking in with its escort is the one big
 * monster. A small beast falls to one or two good shells; kegs stand spaced, a crown of them
 * where the Shockwave throws the small ones, a cluster now and then.
 */
const TIDE_GAP = gap(0.35, 0.55);
const spaced = (count: number, cluster?: 2 | 3): TurretKegLotDef => ({
  mode: 'random',
  count,
  ...TURRET_BARREL_RING,
  spaced: true,
  ...(cluster ? { cluster } : {}),
});
const smallCrown = (count: number): TurretKegLotDef => ({ mode: 'crown', count, size: 'small' });
const front = (group: number, cluster?: 2 | 3): TurretKegLotDef => ({
  mode: 'path',
  group,
  placement: 'front',
  spaced: true,
  ...(cluster ? { cluster } : {}),
});
const surgers = (
  entries: readonly TurretWaveEntry[],
  sides: number,
  delay: number,
): TurretGroupDef => ({
  brick: 'surgers',
  entries,
  sides,
  widthTurn: 0.04,
  ...gap(0.4, 0.8),
  delayTicks: ticks(delay),
});
const QUICK = { speedScale: 1.6, speedScaleMax: 2 } as const;
const RUNNER = { speedScale: 2.2, speedScaleMax: 2.4 } as const;

export const TURRET_MISSION_DELUGE: TurretScenarioDef = {
  id: 'fire_and_fly_deluge',
  boardKey: 'deluge',
  integrity: TURRET_TOWER_POINTS,
  medals: TURRET_MEDALS,
  arsenal: { shockwave: 3, fragmentation: 2 },
  supply: MISSION_SUPPLY,
  waves: [
    {
      // The tide rises: wolves walking in from all around.
      groups: [
        walkers(
          [{ templateId: 'forest_wolf', count: 8, level: 2, speedScale: 1.1, speedScaleMax: 1.3 }],
          gap(1, 1.6),
        ),
      ],
      coreDamage: 60,
      kegs: [spaced(2)],
    },
    {
      // Boars walking, then two quick bunches of wolves.
      groups: [
        walkers([{ templateId: 'wild_boar', count: 6, level: 3, speedScale: 1.1 }], gap(1, 1.5)),
        {
          ...bunches(
            [{ templateId: 'forest_wolf', count: 8, level: 2, ...QUICK }],
            gap(0.2, 0.35),
            4,
            5,
            0.06,
          ),
          delayTicks: ticks(6),
        },
      ],
      coreDamage: 60,
      kegs: [spaced(2)],
    },
    {
      // Bunches from three sides, then the first monster surging in from behind.
      groups: [
        bunches(
          [
            {
              templateId: 'webwood_spider',
              count: 8,
              level: 3,
              speedScale: 1.3,
              speedScaleMax: 1.6,
            },
            {
              templateId: 'tunnel_rat',
              count: 7,
              level: 5,
              speedScale: 1.3,
              speedScaleMax: 1.6,
              hpScale: FRAIL,
            },
          ],
          gap(0.2, 0.35),
          5,
          4,
          0.06,
        ),
        surgers([{ templateId: 'forest_wolf', count: 1, level: 2, ...RUNNER }], 1, 10),
      ],
      coreDamage: 60,
      kegs: [front(0)],
    },
    {
      // The first surge: a few walkers, then a score of quick beasts from one side.
      groups: [
        walkers(
          [{ templateId: 'forest_wolf', count: 6, level: 2, speedScale: 1.2 }],
          gap(0.8, 1.2),
        ),
        {
          brick: 'surge',
          sides: 1,
          widthTurn: 0.08,
          entries: [
            {
              templateId: 'tunnel_rat',
              count: 10,
              level: 5,
              speedScale: 1.9,
              speedScaleMax: 2.3,
              hpScale: FRAIL,
            },
            { templateId: 'forest_wolf', count: 8, level: 2, speedScale: 1.9, speedScaleMax: 2.3 },
          ],
          ...TIDE_GAP,
          delayTicks: ticks(5),
        },
      ],
      coreDamage: 60,
      kegs: [smallCrown(2)],
    },
    {
      // A false lull: slow boars, a pack of them gathering, and two beasts surging in.
      groups: [
        walkers(
          [{ templateId: 'wild_boar', count: 5, level: 3, speedScale: 0.9, speedScaleMax: 1 }],
          gap(1.2, 1.8),
        ),
        {
          brick: 'pack',
          minRadius: 28,
          maxRadius: 34,
          holdTicks: ticks(4),
          spreadTicks: ticks(2),
          widthTurn: 0.1,
          advanceScale: 1.1,
          entries: [{ templateId: 'wild_boar', count: 7, level: 3, ...MUSTER, leads: true }],
          delayTicks: ticks(3),
        },
        surgers([{ templateId: 'forest_wolf', count: 2, level: 2, ...RUNNER }], 2, 12),
      ],
      coreDamage: 60,
      kegs: [front(1, 2)],
    },
    {
      // Bunches from three sides, beasts surging in, then boars from all around.
      groups: [
        bunches(
          [
            {
              templateId: 'webwood_spider',
              count: 9,
              level: 4,
              speedScale: 1.4,
              speedScaleMax: 1.8,
              hpScale: FRAIL,
            },
            {
              templateId: 'tunnel_rat',
              count: 9,
              level: 5,
              speedScale: 1.4,
              speedScaleMax: 1.8,
              hpScale: FRAIL,
            },
          ],
          gap(0.2, 0.35),
          6,
          3,
          0.06,
        ),
        surgers([{ templateId: 'forest_wolf', count: 2, level: 2, ...RUNNER }], 2, 8),
        {
          ...walkers(
            [{ templateId: 'wild_boar', count: 6, level: 3, speedScale: 1.2, speedScaleMax: 1.4 }],
            gap(0.7, 1.1),
          ),
          delayTicks: ticks(14),
        },
      ],
      coreDamage: 60,
      kegs: [spaced(2), front(0)],
    },
    {
      // A quick stream from all around, a beast from behind, then the Fen Troll and its escort.
      groups: [
        walkers(
          [
            { templateId: 'forest_wolf', count: 7, level: 2, ...QUICK },
            { templateId: 'tunnel_rat', count: 7, level: 5, ...QUICK, hpScale: FRAIL },
          ],
          gap(0.5, 0.8),
        ),
        surgers([{ templateId: 'forest_wolf', count: 1, level: 2, ...RUNNER }], 1, 6),
        {
          brick: 'bigOne',
          widthTurn: 0.05,
          ...gap(0.4, 0.7),
          entries: [
            { templateId: 'fen_troll', count: 1, level: 10, bossLast: true },
            { templateId: 'wild_boar', count: 3, level: 3, speedScale: 1.1 },
          ],
          delayTicks: ticks(10),
        },
      ],
      coreDamage: 60,
      kegs: [smallCrown(2), spaced(1, 3)],
    },
    {
      // The great surge from two sides, beasts surging in between, then the tide all around.
      groups: [
        {
          brick: 'surge',
          sides: 2,
          widthTurn: 0.08,
          entries: [
            { templateId: 'forest_wolf', count: 6, level: 2, speedScale: 2, speedScaleMax: 2.4 },
            {
              templateId: 'webwood_spider',
              count: 6,
              level: 4,
              speedScale: 2,
              speedScaleMax: 2.4,
              hpScale: FRAIL,
            },
            {
              templateId: 'tunnel_rat',
              count: 6,
              level: 5,
              speedScale: 2,
              speedScaleMax: 2.4,
              hpScale: FRAIL,
            },
          ],
          ...gap(0.4, 0.6),
        },
        surgers([{ templateId: 'forest_wolf', count: 2, level: 2, ...RUNNER }], 2, 10),
        {
          ...walkers(
            [
              { templateId: 'wild_boar', count: 6, level: 3, ...QUICK },
              { templateId: 'webwood_spider', count: 6, level: 4, ...QUICK, hpScale: FRAIL },
            ],
            gap(0.6, 0.9),
          ),
          delayTicks: ticks(16),
        },
      ],
      coreDamage: 60,
      kegs: [smallCrown(2), spaced(2)],
    },
  ],
};

const STEADY_GAP = gap(0.9, 1.7);

/**
 * The tower holds only 7 points and the dead march on it: restless bones, hollow acolytes,
 * crypt shamblers and revenants, shadow hounds running at their heels. Its accent is the
 * fragility: a small strike costs 1 or 2 points, a medium one up to 4, so every leak counts
 * and a hound surging in from a side away from the fight is a real threat. No large monster
 * comes. The waves vary: walkers, small groups, a procession of shamblers gathering as a
 * pack, hounds surging in, and a great procession of two packs at the end. No sponge: a
 * medium dead falls to two or three good shells.
 */
const DEAD = { speedScale: 0.9, speedScaleMax: 1.05 } as const;
const HOUND = { speedScale: 1.6, speedScaleMax: 1.9 } as const;
const HOUND_RUN = { speedScale: 2, speedScaleMax: 2.3 } as const;
const HOUND_SCOUT = { role: 'scout', speedScale: 2, speedScaleMax: 2.3 } as const;
const procession = (entries: readonly TurretWaveEntry[], delay: number): TurretGroupDef => ({
  brick: 'pack',
  minRadius: 30,
  maxRadius: 36,
  holdTicks: ticks(4),
  spreadTicks: ticks(2),
  widthTurn: 0.1,
  advanceScale: 1.05,
  entries,
  delayTicks: ticks(delay),
});

export const TURRET_MISSION_BRITTLE: TurretScenarioDef = {
  id: 'fire_and_fly_brittle',
  boardKey: 'brittle',
  integrity: 7,
  medals: { gold: { minIntegrityShare: 1 }, silver: TURRET_MEDALS.silver },
  arsenal: { shockwave: 3, fragmentation: 1 },
  supply: MISSION_SUPPLY,
  waves: [
    {
      // Restless bones walking in slowly from all around.
      groups: [walkers([{ templateId: 'tunnel_rat', count: 8, level: 4, ...DEAD }], gap(1.2, 1.8))],
      coreDamage: 60,
      kegs: [spaced(2)],
    },
    {
      // More bones, then two quick bunches of shadow hounds.
      groups: [
        walkers([{ templateId: 'tunnel_rat', count: 6, level: 4, ...DEAD }], gap(1, 1.5)),
        {
          ...bunches(
            [{ templateId: 'wild_boar', count: 6, level: 2, ...HOUND }],
            gap(0.2, 0.35),
            3,
            5,
            0.06,
          ),
          delayTicks: ticks(6),
        },
      ],
      coreDamage: 60,
      kegs: [spaced(2)],
    },
    {
      // Hollow acolytes from two sides, then the first hound surging in from behind.
      groups: [
        walkers([{ templateId: 'vale_bandit', count: 8, level: 4, ...DEAD }], gap(1, 1.5), {
          kind: 'flanks',
          count: 2,
          widthTurn: 0.1,
        }),
        surgers([{ templateId: 'wild_boar', count: 1, level: 2, ...HOUND_RUN }], 1, 10),
      ],
      coreDamage: 60,
      kegs: [front(0)],
    },
    {
      // The procession: a few bones, then crypt shamblers gathering as a pack, hounds ahead.
      groups: [
        walkers([{ templateId: 'tunnel_rat', count: 4, level: 4, ...DEAD }], gap(1, 1.4)),
        procession(
          [
            { templateId: 'deeprock_kobold', count: 6, level: 14, ...MUSTER, leads: true },
            { templateId: 'wild_boar', count: 2, level: 2, ...HOUND_SCOUT },
          ],
          3,
        ),
      ],
      coreDamage: 150,
      kegs: [front(1, 2)],
    },
    {
      // A false lull: slow bones, and two hounds surging in from two sides.
      groups: [
        walkers(
          [{ templateId: 'tunnel_rat', count: 6, level: 4, speedScale: 0.85 }],
          gap(1.2, 1.8),
        ),
        surgers([{ templateId: 'wild_boar', count: 2, level: 2, ...HOUND_RUN }], 2, 8),
      ],
      coreDamage: 60,
      kegs: [spaced(2)],
    },
    {
      // Small groups of acolytes and revenants from three sides, one after another.
      groups: [
        bunches(
          [
            { templateId: 'vale_bandit', count: 6, level: 5, ...DEAD },
            { templateId: 'boneclad_revenant', count: 6, level: 18, ...DEAD },
          ],
          gap(0.3, 0.5),
          4,
          5,
          0.06,
        ),
      ],
      coreDamage: 200,
      kegs: [front(0), spaced(1)],
    },
    {
      // The dead walking in from everywhere, and two hounds surging in.
      groups: [
        walkers(
          [
            { templateId: 'vale_bandit', count: 6, level: 5, ...DEAD },
            { templateId: 'deeprock_kobold', count: 4, level: 14, ...DEAD },
          ],
          gap(0.9, 1.4),
        ),
        surgers([{ templateId: 'wild_boar', count: 2, level: 2, ...HOUND_RUN }], 2, 7),
      ],
      coreDamage: 160,
      kegs: [spaced(1, 3)],
    },
    {
      // The great procession: two packs of the dead gathering on opposite sides, hounds
      // surging in, and bones walking in around them.
      groups: [
        procession(
          [
            { templateId: 'deeprock_kobold', count: 5, level: 14, ...MUSTER, leads: true },
            { templateId: 'wild_boar', count: 2, level: 2, ...HOUND_SCOUT },
          ],
          0,
        ),
        procession(
          [
            { templateId: 'boneclad_revenant', count: 4, level: 18, ...MUSTER, leads: true },
            { templateId: 'vale_bandit', count: 2, level: 5, ...MUSTER },
            { templateId: 'wild_boar', count: 2, level: 2, ...HOUND_SCOUT },
          ],
          4,
        ),
        {
          ...walkers([{ templateId: 'tunnel_rat', count: 6, level: 4, ...DEAD }], gap(0.9, 1.3)),
          delayTicks: ticks(10),
        },
        surgers([{ templateId: 'wild_boar', count: 2, level: 2, ...HOUND_RUN }], 2, 14),
      ],
      coreDamage: 200,
      kegs: [front(0), front(1)],
    },
  ],
};

/**
 * The powder store overflows: more kegs than anywhere, laid on purpose, and the forge's own
 * coming for them (emberkin, cinder artificers, coinsack scurriers, ember fiends, a magma
 * brute). Varied waves of walkers, small groups and packs, kegs on their paths and in
 * clusters, a crown where the Shockwave throws the small ones; two strong moments where the
 * kegs stand close in the lanes and go up in chains (the fourth wave and the last), and the
 * brute as the one big monster, with a keg on its road. No sponge: a forge creature falls to
 * two or three good shells, the brute to a handful.
 */
const POWDER_CAP = 12;
/** A powder field: kegs in the lanes, close enough to chain (no spacing). */
const powderField = (count: number): TurretKegLotDef => ({
  mode: 'random',
  count,
  ...TURRET_BARREL_RING,
  lanes: true,
});
const FORGE = { speedScale: 1, speedScaleMax: 1.25 } as const;
const EMBER_SCOUT = { role: 'scout', speedScale: 2, speedScaleMax: 2.3 } as const;
const EMBER_RUN = { speedScale: 2, speedScaleMax: 2.3 } as const;
const forgePack = (entries: readonly TurretWaveEntry[], delay: number): TurretGroupDef => ({
  brick: 'pack',
  minRadius: 30,
  maxRadius: 36,
  holdTicks: ticks(4),
  spreadTicks: ticks(2),
  widthTurn: 0.1,
  advanceScale: 1.1,
  entries,
  delayTicks: ticks(delay),
});

export const TURRET_MISSION_POWDER: TurretScenarioDef = {
  id: 'fire_and_fly_powder',
  boardKey: 'powder',
  integrity: TURRET_TOWER_POINTS,
  medals: TURRET_MEDALS,
  arsenal: { shockwave: 1, fragmentation: 3 },
  supply: MISSION_SUPPLY,
  waves: [
    {
      // Emberkin walking in from one side, kegs waiting for them.
      groups: [
        walkers([{ templateId: 'tunnel_rat', count: 8, level: 4, ...FORGE }], gap(1, 1.5), {
          kind: 'arc',
          widthTurn: 0.25,
        }),
      ],
      coreDamage: 60,
      kegs: [front(0), spaced(2)],
      kegCap: POWDER_CAP,
    },
    {
      // Scurriers walking, then two bunches of emberkin past a pair of kegs.
      groups: [
        walkers([{ templateId: 'vale_bandit', count: 6, level: 4, ...FORGE }], gap(1, 1.5)),
        {
          ...bunches(
            [{ templateId: 'tunnel_rat', count: 8, level: 4, speedScale: 1.3 }],
            gap(0.2, 0.35),
            4,
            5,
            0.06,
          ),
          delayTicks: ticks(5),
        },
      ],
      coreDamage: 60,
      kegs: [front(1, 2), spaced(2)],
      kegCap: POWDER_CAP,
    },
    {
      // Cinder artificers gathering as a pack, emberkin running ahead, a cluster on their road.
      groups: [
        walkers([{ templateId: 'tunnel_rat', count: 4, level: 4, ...FORGE }], gap(1, 1.4)),
        forgePack(
          [
            { templateId: 'deeprock_kobold', count: 6, level: 14, ...MUSTER, leads: true },
            { templateId: 'tunnel_rat', count: 2, level: 4, ...EMBER_SCOUT },
          ],
          3,
        ),
      ],
      coreDamage: 130,
      kegs: [front(1, 3), spaced(1)],
      kegCap: POWDER_CAP,
    },
    {
      // The first powder field: kegs packed in the lanes, the forge's own walking through from
      // two sides, an emberkin surging in from behind.
      groups: [
        walkers(
          [
            { templateId: 'tunnel_rat', count: 8, level: 4, ...FORGE },
            { templateId: 'vale_bandit', count: 6, level: 5, ...FORGE },
          ],
          gap(0.7, 1.1),
          { kind: 'flanks', count: 2, widthTurn: 0.12 },
        ),
        surgers([{ templateId: 'tunnel_rat', count: 1, level: 4, ...EMBER_RUN }], 1, 9),
      ],
      coreDamage: 70,
      kegs: [powderField(6)],
      kegCap: POWDER_CAP,
    },
    {
      // A lull: scurriers walking slowly, two emberkin surging in, a crown for the Shockwave.
      groups: [
        walkers(
          [{ templateId: 'vale_bandit', count: 6, level: 5, speedScale: 0.9 }],
          gap(1.2, 1.8),
        ),
        surgers([{ templateId: 'tunnel_rat', count: 2, level: 4, ...EMBER_RUN }], 2, 8),
      ],
      coreDamage: 70,
      kegs: [smallCrown(2), spaced(1)],
      kegCap: POWDER_CAP,
    },
    {
      // Ember fiends and emberkin in small groups from three sides, one after another.
      groups: [
        bunches(
          [
            { templateId: 'boneclad_revenant', count: 6, level: 18, ...FORGE },
            { templateId: 'tunnel_rat', count: 6, level: 4, ...FORGE },
          ],
          gap(0.3, 0.5),
          4,
          5,
          0.06,
        ),
      ],
      coreDamage: 200,
      kegs: [front(0, 2), spaced(2)],
      kegCap: POWDER_CAP,
    },
    {
      // The magma brute walks in with its escort, a keg on its road; emberkin around.
      groups: [
        walkers(
          [{ templateId: 'tunnel_rat', count: 8, level: 4, speedScale: 1.3, speedScaleMax: 1.6 }],
          gap(0.7, 1.1),
        ),
        {
          brick: 'bigOne',
          widthTurn: 0.05,
          ...gap(0.4, 0.7),
          entries: [
            { templateId: 'thornpeak_ogre', count: 1, level: 15, bossLast: true },
            { templateId: 'vale_bandit', count: 3, level: 5, ...FORGE },
          ],
          delayTicks: ticks(6),
        },
        surgers([{ templateId: 'tunnel_rat', count: 1, level: 4, ...EMBER_RUN }], 1, 12),
      ],
      coreDamage: 140,
      kegs: [{ mode: 'path', group: 1, placement: 'axis', fromTower: 18, spaced: true }, spaced(2)],
      kegCap: POWDER_CAP,
    },
    {
      // The last powder field: two packs of the forge gathering, kegs packed in the lanes and a
      // cluster on each road, emberkin surging in.
      groups: [
        forgePack(
          [
            { templateId: 'deeprock_kobold', count: 5, level: 14, ...MUSTER, leads: true },
            { templateId: 'tunnel_rat', count: 2, level: 4, ...EMBER_SCOUT },
          ],
          0,
        ),
        forgePack(
          [
            { templateId: 'boneclad_revenant', count: 4, level: 18, ...MUSTER, leads: true },
            { templateId: 'vale_bandit', count: 3, level: 5, ...MUSTER },
            { templateId: 'tunnel_rat', count: 2, level: 4, ...EMBER_SCOUT },
          ],
          4,
        ),
        {
          ...walkers(
            [{ templateId: 'tunnel_rat', count: 8, level: 4, speedScale: 1.3, speedScaleMax: 1.6 }],
            gap(0.6, 0.9),
          ),
          delayTicks: ticks(10),
        },
        surgers([{ templateId: 'tunnel_rat', count: 2, level: 4, ...EMBER_RUN }], 2, 14),
      ],
      coreDamage: 200,
      kegs: [front(0, 2), front(1, 2), powderField(4)],
      kegCap: POWDER_CAP,
    },
  ],
};

/** In the order Master Gunner Alder offers them. */
export const TURRET_MISSIONS: readonly TurretScenarioDef[] = [
  TURRET_MISSION_PACK,
  TURRET_MISSION_DELUGE,
  TURRET_MISSION_BRITTLE,
  TURRET_MISSION_POWDER,
];
