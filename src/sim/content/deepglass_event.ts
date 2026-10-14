// The Deepglass city event: the crowd and market that make the arena feel
// like a festival day OUTSIDE the bell, and vanish the moment a real bout
// starts (src/sim/deepglass/crowd.ts owns spawning, pacing and the despawn,
// src/render/deepglass_crowd_fx.ts owns the cheering; this module is data).
//
// Twenty spectators plus three market stallkeepers. The crowd reads as a
// CROWD rather than a patrol: most of it stands and cheers at the bell, and
// only four of the twenty (one in five) pace a few yards back and forth, which
// is what a knot of people waiting for a fixture actually looks like. Twelve
// of the twenty are up in the seating bowl, so the stands read occupied from
// the plaza below.
//
// Every def is dynamic and registered in the global NPCS table like the
// marshal: the arena's own WorldContent lists them, so no other world ever
// spawns one, and the gossip dialog can still resolve their vendor stock and
// names by templateId.

import type { NpcDef, ZonePropsDef } from '../types';

/** Reserved entity id blocks (see social/vale_cup.ts for the doctrine).
 *  Spectators take 200..219 in DG_SPECTATORS order; stallkeepers 230..232
 *  in DG_STALLKEEPER_IDS order. */
export const DG_CROWD_BASE_ENTITY_ID = 1_000_000_200;
export const DG_STALLKEEPER_BASE_ENTITY_ID = 1_000_000_230;

/**
 * What a spectator does with itself.
 *
 * `pace`  a short back-and-forth walk along the concourse apron (one in five).
 * `stand` planted on the plaza or the market avenue, watching the bell.
 * `tier`  standing up in the seating bowl, on its deck.
 *
 * All three cheer; only `pace` moves.
 */
export type DgSpectatorRole = 'pace' | 'stand' | 'tier';

export interface DgSpectatorSpot {
  npcId: string;
  role: DgSpectatorRole;
  x: number;
  z: number;
  /** `tier` only: which seating tier, 0-based. Deck y comes from the tier. */
  tier?: 0 | 1 | 2;
  /** `pace` only: the concourse ring angle the walk is tangent to. */
  paceAngle?: number;
}

// -- the concourse apron ------------------------------------------------------
// The flat pale ring between the bell and the seating bowl (r 53.4 to 63.4 in
// deepglass_stadium.ts), so r 58 is its middle: walkable, collider-free, and
// the natural promenade.
//
// The market stalls stand at |x| 13 to 16 around z 50 to 66, which the ring
// crosses near angles 1.2 to 1.95. Pacers keep out of that arc: the earlier
// full-ring patrol walked its waypoints straight into the stall colliders and
// bunched up against them.
export const DG_WALKER_RING_R = 58;
/** How far along the ring a pacer walks from its spawn, each way (yards). */
export const DG_PACE_HALF_SPAN = 3.5;

const ringPos = (a: number): { x: number; z: number } => ({
  x: Math.cos(a) * DG_WALKER_RING_R,
  z: Math.sin(a) * DG_WALKER_RING_R,
});

// -- the seating bowl ---------------------------------------------------------
// The bowl is render-only geometry (no collision) over a dead-flat terrace, so
// a spectator up there has its y AUTHORED and re-pinned every tick rather than
// sampled from the heightfield. Deck y = 4.5 * (tier + 1) and the front seat
// row of tier t sits at r = 63.4 + t * 6 + 2.04 (deepglass_stadium.ts).
//
// Angles avoid the bowl's north entrance gap (centred on pi/2, half-width 0.42
// rad, widened to 0.65 here for clearance) so nobody stands in thin air.
export const DG_SEAT_TIER_ROW_R = [65.4, 71.4, 77.4] as const;
export const DG_SEAT_TIER_DECK_Y = [4.5, 9.0, 13.5] as const;

const tierPos = (a: number, tier: 0 | 1 | 2): { x: number; z: number } => ({
  x: Math.cos(a) * DG_SEAT_TIER_ROW_R[tier],
  z: Math.sin(a) * DG_SEAT_TIER_ROW_R[tier],
});

/** Face the bell at the origin: facing f points along (sin f, cos f). */
const faceCenter = (x: number, z: number): number => Math.atan2(-x, -z);

// -- the roster ---------------------------------------------------------------
// ORDER IS FROZEN: a spectator's reserved entity id is
// DG_CROWD_BASE_ENTITY_ID + its index here, so rows are appended, never
// inserted or reordered.
const PACE_ANGLES = [0.6, 2.6, 3.9, 5.3] as const;
const YARD_SPOTS: readonly { x: number; z: number }[] = [
  // On the market avenue and the plaza mouth, clear of the stalls (|x| >= 13)
  // and of the paired avenue lamps (x = +/-7 at z 69.4, 58.4 and 47.4).
  { x: -5, z: 63 },
  { x: 5, z: 60 },
  { x: -5, z: 52 },
  { x: 5, z: 46 },
];
const TIER_SPOTS: readonly { angle: number; tier: 0 | 1 | 2 }[] = [
  { angle: 2.5, tier: 0 },
  { angle: 3.4, tier: 0 },
  { angle: 4.3, tier: 0 },
  { angle: 5.6, tier: 0 },
  { angle: 2.8, tier: 1 },
  { angle: 3.9, tier: 1 },
  { angle: 4.9, tier: 1 },
  { angle: 0.3, tier: 1 },
  { angle: 2.4, tier: 2 },
  { angle: 3.3, tier: 2 },
  { angle: 4.6, tier: 2 },
  { angle: 5.9, tier: 2 },
];

interface SpectatorSeed {
  id: string;
  name: string;
  greeting: string;
}

/** The four who pace the apron. */
const PACERS: readonly SpectatorSeed[] = [
  {
    id: 'dg_spectator_pace1',
    name: 'Merri Sallow',
    greeting: 'They say the ball sings if you hit it hard enough. I came to hear it.',
  },
  {
    id: 'dg_spectator_pace2',
    name: 'Josson Brill',
    greeting:
      'I cannot sit still before a fixture. Never could. Ask my wife, she is up in the tiers.',
  },
  {
    id: 'dg_spectator_pace3',
    name: 'Petta Wavecrest',
    greeting: 'Three lengths of the apron and back is exactly one bout of nerves. I have measured.',
  },
  {
    id: 'dg_spectator_pace4',
    name: 'Tam Groundswell',
    greeting:
      'Keep to the apron and mind the parapet. The first step off the terrace is a long one.',
  },
];

/** The four planted on the plaza and the market avenue. */
const YARD_FOLK: readonly SpectatorSeed[] = [
  {
    id: 'dg_spectator_yard1',
    name: 'Old Cormorant',
    greeting:
      'In my day the water was colder and the goals were smaller. Everything else I approve of.',
  },
  {
    id: 'dg_spectator_yard2',
    name: 'Harrow Finch',
    greeting: 'I bet three silver on the away side. The pies are how I am coping.',
  },
  {
    id: 'dg_spectator_yard3',
    name: 'Corbin Ashvane',
    greeting: 'A bald wizard sold me a portal ride up here. Best copper I ever spent.',
  },
  {
    id: 'dg_spectator_yard4',
    name: 'Sesi Brine',
    greeting:
      'Match days are the only days the chasm wind smells like fried bread. Follow your nose.',
  },
];

/** The twelve up in the bowl. */
const TIER_FOLK: readonly SpectatorSeed[] = [
  {
    id: 'dg_spectator_tier1',
    name: 'Bela Rimeglass',
    greeting: 'Best seat in the bowl. You can see the whole bell shiver when it takes a hit.',
  },
  {
    id: 'dg_spectator_tier2',
    name: 'Ferrin Saltcask',
    greeting: 'I have held this row since dawn and I will hold it through the whistle.',
  },
  {
    id: 'dg_spectator_tier3',
    name: 'Nim Pearlover',
    greeting:
      'When the water goes still right before kickoff, the whole stadium holds its breath with it.',
  },
  {
    id: 'dg_spectator_tier4',
    name: 'Goodwife Alder',
    greeting: 'My husband thinks I am at the temple. The temple thinks I am with my husband.',
  },
  {
    id: 'dg_spectator_tier5',
    name: 'Skipper Vell',
    greeting:
      'Sailed every sea there is, and the strangest water I know is hanging right up there.',
  },
  {
    id: 'dg_spectator_tier6',
    name: 'Ivo Lanternwake',
    greeting: 'Higher tier, thinner air, better view. The climb is part of the ticket.',
  },
  {
    id: 'dg_spectator_tier7',
    name: 'Maud Threadneedle',
    greeting: 'I knit a row every time the ball changes hands. Finished a whole scarf last bout.',
  },
  {
    id: 'dg_spectator_tier8',
    name: 'Pello the Hoarse',
    greeting: 'Lost my voice at the last fixture. Worth it. Will do it again today.',
  },
  {
    id: 'dg_spectator_tier9',
    name: 'Liva Undertow',
    greeting: 'Do not stand under the bell when a goal collapses. Trust me on the first part.',
  },
  {
    id: 'dg_spectator_tier10',
    name: 'Danna Kelp-Braid',
    greeting:
      'The pylons hum before a match. Put your hand on one and you can feel the fixtures coming.',
  },
  {
    id: 'dg_spectator_tier11',
    name: 'Marlo Spume',
    greeting: 'Sixteen lamps and not one moth. Highest lamps in the world, I reckon.',
  },
  {
    id: 'dg_spectator_tier12',
    name: 'Wenna Tidelace',
    greeting: 'I come for the swimming. I stay because the causeway back down is very long.',
  },
];

function spectatorSpot(seed: SpectatorSeed, i: number): DgSpectatorSpot {
  if (i < PACERS.length) {
    const angle = PACE_ANGLES[i];
    const p = ringPos(angle);
    return { npcId: seed.id, role: 'pace', x: p.x, z: p.z, paceAngle: angle };
  }
  if (i < PACERS.length + YARD_FOLK.length) {
    const p = YARD_SPOTS[i - PACERS.length];
    return { npcId: seed.id, role: 'stand', x: p.x, z: p.z };
  }
  const spot = TIER_SPOTS[i - PACERS.length - YARD_FOLK.length];
  const p = tierPos(spot.angle, spot.tier);
  return { npcId: seed.id, role: 'tier', x: p.x, z: p.z, tier: spot.tier };
}

const SPECTATOR_SEEDS: readonly SpectatorSeed[] = [...PACERS, ...YARD_FOLK, ...TIER_FOLK];

/** Every spectator's post, in reserved-id order. */
export const DG_SPECTATORS: readonly DgSpectatorSpot[] = SPECTATOR_SEEDS.map(spectatorSpot);

/** Spectator templateIds in reserved-id order (base + index). */
export const DG_SPECTATOR_IDS: readonly string[] = SPECTATOR_SEEDS.map((s) => s.id);

const SPECTATORS: [string, NpcDef][] = SPECTATOR_SEEDS.map((seed, i) => {
  const spot = DG_SPECTATORS[i];
  const def: NpcDef = {
    id: seed.id,
    name: seed.name,
    title: 'Deepglass Spectator',
    pos: { x: spot.x, z: spot.z },
    facing: faceCenter(spot.x, spot.z),
    color: 0xd8e6f2,
    questIds: [],
    dynamic: true,
    greeting: seed.greeting,
  };
  // A pacer's walk lives on the DEF, so it reaches every world shape: the
  // code-built arena's reserved-id spawner reads it, and a Studio document of
  // the venue (whose surface loop places this roster itself) round-trips it
  // through map_doc's sanitizeNpc. Same there-and-back the crowd spawner
  // used to compute privately: tangent to the concourse ring at the post.
  if (spot.role === 'pace' && spot.paceAngle !== undefined) {
    const tx = -Math.sin(spot.paceAngle);
    const tz = Math.cos(spot.paceAngle);
    def.route = {
      mode: 'pingpong',
      speed: 1.1,
      points: [
        { x: spot.x + tx * DG_PACE_HALF_SPAN, z: spot.z + tz * DG_PACE_HALF_SPAN, wait: 3 },
        { x: spot.x - tx * DG_PACE_HALF_SPAN, z: spot.z - tz * DG_PACE_HALF_SPAN, wait: 4 },
      ],
    };
  }
  return [seed.id, def];
});

// -- the market ---------------------------------------------------------------
// Six stalls flanking the arrival avenue between the causeway and the plaza,
// three keepers working them. The concourse promenade runs BETWEEN the rows,
// so the crowd streams past the counters like a market street.
export const DG_MARKET_STALLS: ZonePropsDef['stalls'] = [
  { x: -13, z: 66, rot: Math.PI / 2, r: 2.6 },
  { x: 13, z: 66, rot: -Math.PI / 2, r: 2.6 },
  { x: -15, z: 58, rot: Math.PI / 2, r: 2.6 },
  { x: 15, z: 58, rot: -Math.PI / 2, r: 2.6 },
  { x: -13, z: 50, rot: Math.PI / 2, r: 2.6 },
  { x: 13, z: 50, rot: -Math.PI / 2, r: 2.6 },
];

const STALLKEEPERS: [string, NpcDef][] = [
  [
    'dg_stallkeeper_pies',
    {
      id: 'dg_stallkeeper_pies',
      name: 'Pieman Roldo',
      title: 'Match-Day Provisions',
      pos: { x: -16.5, z: 58 },
      facing: Math.PI / 2,
      color: 0xf2c98a,
      questIds: [],
      dynamic: true,
      vendorItems: ['baked_bread', 'roasted_boar', 'tough_jerky', 'spring_water'],
      greeting:
        'Hot pies, cold water, and jerky that outlasts the queue. Eat before the whistle, ' +
        'friend, the second half waits for no stomach.',
    },
  ],
  [
    'dg_stallkeeper_tonics',
    {
      id: 'dg_stallkeeper_tonics',
      name: 'Sella Phial',
      title: 'Tonics and Drams',
      pos: { x: 16.5, z: 58 },
      facing: -Math.PI / 2,
      color: 0xa9e8c8,
      questIds: [],
      dynamic: true,
      vendorItems: ['minor_healing_potion', 'minor_mana_potion', 'spring_water'],
      greeting:
        'Bruise tonic, nerve tonic, and a dram for the drop off the causeway. The players ' +
        'buy the first two. The spectators buy the third.',
    },
  ],
  [
    'dg_stallkeeper_favors',
    {
      id: 'dg_stallkeeper_favors',
      name: 'Banner-Hag Wynn',
      title: 'Favors and Flags',
      pos: { x: -16.5, z: 66 },
      facing: Math.PI / 2,
      color: 0xd6a5e8,
      questIds: [],
      dynamic: true,
      vendorItems: ['linen_pouch', 'travelers_knapsack'],
      greeting:
        'A pouch for your winnings and a bag for your doubts. Buy the pouch, dear, it is ' +
        'the optimistic purchase.',
    },
  ],
];

export const DG_STALLKEEPER_IDS: readonly string[] = STALLKEEPERS.map(([id]) => id);

/** Every event NPC, keyed by templateId, for NPCS registration and the arena
 *  roster (all dynamic; src/sim/deepglass/crowd.ts spawns them). */
export const DEEPGLASS_EVENT_NPCS: Record<string, NpcDef> = Object.fromEntries([
  ...SPECTATORS,
  ...STALLKEEPERS,
]);
