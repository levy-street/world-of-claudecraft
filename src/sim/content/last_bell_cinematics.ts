// Last Bell prop paths are authored beside the scene definitions but remain
// inert presentation data. The sim carries only each segment id on the prop
// wire op; the render client resolves the matching record. Cinematic
// compression may reposition the ferry between cuts, but motion visible
// inside one shot stays below this world-space speed.
export const LAST_BELL_CINEMATIC_SHIP_SPEED_CAP_YARDS_PER_SEC = 12;

// cueHarborShip deliberately treats an unknown cue as its documented park
// arm. This named unknown id resets the ship and disposes its deck stand-in
// under the arrival fade before the real player is framed.
export const LB_PROP_CUE_PARK = 'lb_prop_cue_park';

export const LAST_BELL_VOYAGE_SEGMENT_IDS = {
  out: {
    castOff: 'lb_voyage_out_cast_off',
    openWater: 'lb_voyage_out_open_water',
    arrival: 'lb_voyage_out_arrival',
  },
  back: {
    castOff: 'lb_voyage_back_cast_off',
    openWater: 'lb_voyage_back_open_water',
    arrival: 'lb_voyage_back_arrival',
  },
} as const;

export const LAST_BELL_PROP_PATH_SEGMENTS = {
  // Cast-off glides start at scene open (the voyage cuts straight into the
  // shot, no opening fade) and run until the cut to open water is fully
  // black, so the vessel never stops on camera: cue at 0, black from 6.5,
  // cue switch at 7.
  [LAST_BELL_VOYAGE_SEGMENT_IDS.out.castOff]: {
    start: { x: 0, y: 0, z: 0, yaw: 0 },
    end: { x: 22, y: 0, z: 7, yaw: 0 },
    duration: 6.8,
    ease: 'linear',
  },
  // The open-water legs ride the old crossing track (360,-8) to (470,34),
  // deep water the whole way, so the Old Beacon lighthouse on the Galecrest
  // headland stands on the horizon behind the beam shot. World spans:
  // out (390.83, 3.77) to (439.41, 22.32); back the same water sailed the
  // other way. Pose positions rotate by the COMBINED yaw (base plus pose)
  // in composeHarborShipAttachFrame, so these locals bake that in.
  [LAST_BELL_VOYAGE_SEGMENT_IDS.out.openWater]: {
    start: { x: 157.48, y: 0, z: -8.994, yaw: -1.935526 },
    end: { x: 209.481, y: 0, z: -8.995, yaw: -1.935526 },
    duration: 5.7,
    ease: 'linear',
  },
  // Arrival glides (J9): a long shallow bow-first slide into the berth,
  // 0.3 rad of total yaw decaying to 0 at the parked pose, so the attached
  // camera sees the berth drift into frame and grow instead of the whole
  // world pivoting through an 80 degree parking manoeuvre. Both approaches
  // run down the hull's parked axis with a seaward lateral bias that keeps
  // the whole swept hull clear of the pier rails while the yaw unwinds (the
  // local z here; the world path bows because pose positions rotate by the
  // COMBINED yaw in composeHarborShipAttachFrame). Gullhaven from the north
  // bay (world start (694, 160)), the mainland from the north strait side
  // (world start (258, -4)); the J9 basin stamps in harbor_layout carve the
  // stern-reach water at both starts.
  [LAST_BELL_VOYAGE_SEGMENT_IDS.out.arrival]: {
    start: { x: -43.351, y: 0, z: -6.478, yaw: -0.3 },
    end: { x: 0, y: 0, z: 0, yaw: 0 },
    duration: 6,
    ease: 'linear',
  },
  [LAST_BELL_VOYAGE_SEGMENT_IDS.back.castOff]: {
    start: { x: 0, y: 0, z: 0, yaw: 0 },
    end: { x: 22, y: 0, z: -7, yaw: 0 },
    duration: 6.8,
    ease: 'linear',
  },
  [LAST_BELL_VOYAGE_SEGMENT_IDS.back.openWater]: {
    start: { x: 290.615, y: 0, z: -5.869, yaw: 1.206066 },
    end: { x: 342.615, y: 0, z: -5.868, yaw: 1.206066 },
    duration: 5.7,
    ease: 'linear',
  },
  [LAST_BELL_VOYAGE_SEGMENT_IDS.back.arrival]: {
    start: { x: -43.385, y: 0, z: 4.898, yaw: 0.3 },
    end: { x: 0, y: 0, z: 0, yaw: 0 },
    duration: 6,
    ease: 'linear',
  },
} as const;

export type LastBellPropPathSegmentId = keyof typeof LAST_BELL_PROP_PATH_SEGMENTS;
export type LastBellPropCueId = keyof typeof LAST_BELL_PROP_PATH_SEGMENTS | typeof LB_PROP_CUE_PARK;
