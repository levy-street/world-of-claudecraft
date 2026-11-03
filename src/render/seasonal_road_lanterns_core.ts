// The road lanterns' draw segments (pure, no Three): the resolved posts along the roads
// between the event cities (src/sim/seasonal_road_lanterns.ts) grouped into short runs,
// each drawn as one group the decor view shows only within reach of the player, the way
// each city's dressing is ranged. Posts come in route order, so a run is a stretch of
// one road; a run closes at SEGMENT_MAX posts, at a route change, or when the next post
// is farther than SEGMENT_SPAN from the run's first.
import type { SeasonalRoadLantern } from '../sim/seasonal_road_lanterns';

/** Posts per draw run at most. */
export const ROAD_SEGMENT_MAX = 6;
/** The longest stretch one run covers (yards from its first post). */
export const ROAD_SEGMENT_SPAN = 160;

export interface RoadLanternSegment {
  /** The run's centre (the mean of its posts), the point the view ranges by. */
  x: number;
  z: number;
  lanterns: SeasonalRoadLantern[];
}

export function roadLanternSegments(
  lanterns: readonly SeasonalRoadLantern[],
): RoadLanternSegment[] {
  const out: RoadLanternSegment[] = [];
  let run: SeasonalRoadLantern[] = [];
  const close = () => {
    if (run.length === 0) return;
    let x = 0;
    let z = 0;
    for (const l of run) {
      x += l.x;
      z += l.z;
    }
    out.push({ x: x / run.length, z: z / run.length, lanterns: run });
    run = [];
  };
  for (const l of lanterns) {
    const first = run[0];
    if (
      first &&
      (run.length >= ROAD_SEGMENT_MAX ||
        first.route !== l.route ||
        Math.hypot(l.x - first.x, l.z - first.z) > ROAD_SEGMENT_SPAN)
    ) {
      close();
    }
    run.push(l);
  }
  close();
  return out;
}
