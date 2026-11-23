// Gourdlight Eve's city dressing, as ANCHOR RULES (data only; the resolver is
// src/sim/seasonal_decor_layout.ts, the drawing src/render/seasonal_decor.ts).
//
// The cities change: open PRs add and move buildings all the time, so nothing
// here is a coordinate beside today's buildings. Every piece hangs off something
// that moves with the city:
//   - the town's streetlamps (the sim's lamp plan, src/sim/streetlamp_layout.ts):
//     a paper lantern on each post, a leaf garland wound round it, gourds at its foot;
//   - the event's trick-or-treat townsfolk (content/gourdlight_eve.ts): a lit
//     pumpkin at each knocking door, so the doors to knock on read at a glance;
//   - every other townsfolk in reach: a gourd pair at their side;
//   - the event keeper: her market stall (src/sim/seasonal_decor_stall.ts), its
//     footprint checked like everything else; a pile of gourds if it cannot fit;
//   - the shoulders of the town's own roads: corn shocks, hay bales and lit
//     pumpkins along the street between the lamps;
//   - the town hub (the zone's own centre): a ring of gourds in the square.
// The resolver nudges every piece off colliders, roads and NPC spots, and drops
// what it cannot seat; tests/seasonal_decor_layout.test.ts pins the result
// against the live world, so a city rework that buries a pumpkin turns red.
// A city rework that moves the square or the lamps needs no edit here at all.

export interface SeasonalCityDecorRule {
  /** The zone whose hub is the city (ZoneDef.id). */
  zoneId: string;
  /** Reach from the hub that counts as town for the lamp and NPC anchors (yards). */
  radius: number;
  /** Gourds in the square: how many, on what ring round the hub (yards). */
  square: { count: number; ring: number };
  /** Harvest pieces along the town's road shoulders: at most `max`, at least
   *  `spacing` yards apart (the anchor is the road itself). */
  street?: { max: number; spacing: number };
}

export const GOURDLIGHT_DECOR_CITIES: readonly SeasonalCityDecorRule[] = Object.freeze([
  {
    zoneId: 'eastbrook_vale',
    radius: 62,
    square: { count: 8, ring: 6.5 },
    street: { max: 11, spacing: 11 },
  },
  {
    zoneId: 'mirefen_marsh',
    radius: 62,
    square: { count: 6, ring: 5 },
    street: { max: 18, spacing: 8 },
  },
  {
    zoneId: 'thornpeak_heights',
    radius: 58,
    square: { count: 6, ring: 5.5 },
    street: { max: 11, spacing: 10 },
  },
]);

/** Where a road-lantern route ends: an event city (its zone id, the hub the city decor
 *  dresses) or Old Thatchgrin's field (seasonal/scarecrow_field.ts, resolved live). */
export type SeasonalRoadEnd = { zoneId: string } | { scarecrowField: true };

/** One road the event lights: the lanterns follow the world's own road network from
 *  one end to the other (src/sim/seasonal_road_lanterns.ts finds the way along the live
 *  roads), so a moved road moves its lanterns and nothing here is a coordinate. */
export interface SeasonalRoadLanternRoute {
  id: string;
  from: SeasonalRoadEnd;
  to: SeasonalRoadEnd;
}

/** Carved-pumpkin lanterns on short crook posts along the roads BETWEEN the event
 *  cities (the towns themselves are dressed above), and down the road to Old
 *  Thatchgrin's field past Boar Meadow. One every `spacing` yards (a hash picks the
 *  gap inside the range), alternating sides of the road. */
export const GOURDLIGHT_ROAD_LANTERNS = Object.freeze({
  routes: Object.freeze([
    {
      id: 'eastbrook_fenbridge',
      from: { zoneId: 'eastbrook_vale' },
      to: { zoneId: 'mirefen_marsh' },
    },
    {
      id: 'fenbridge_highwatch',
      from: { zoneId: 'mirefen_marsh' },
      to: { zoneId: 'thornpeak_heights' },
    },
    { id: 'eastbrook_field', from: { zoneId: 'eastbrook_vale' }, to: { scarecrowField: true } },
  ] as readonly SeasonalRoadLanternRoute[]),
  /** The gap between two lanterns along the road (yards, min and max). */
  spacing: Object.freeze([32, 46] as const),
});
