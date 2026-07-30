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
  [LAST_BELL_VOYAGE_SEGMENT_IDS.out.castOff]: {
    start: { x: 0, y: 0.5, z: 4, yaw: 0 },
    end: { x: 22, y: 0.5, z: 7, yaw: 0 },
    duration: 4,
    ease: 'linear',
  },
  [LAST_BELL_VOYAGE_SEGMENT_IDS.out.openWater]: {
    start: { x: -0.480547, y: 0, z: -164.456482, yaw: -1.910796 },
    end: { x: 47.519453, y: 0, z: -164.456482, yaw: -1.910796 },
    duration: 4.3,
    ease: 'linear',
  },
  [LAST_BELL_VOYAGE_SEGMENT_IDS.out.arrival]: {
    start: { x: -48, y: 0.75, z: 0, yaw: -2.822845 },
    end: { x: 0, y: 0.75, z: 0, yaw: -2.822845 },
    duration: 15,
    ease: 'linear',
  },
  [LAST_BELL_VOYAGE_SEGMENT_IDS.back.castOff]: {
    start: { x: 0, y: 0.5, z: -4, yaw: 0 },
    end: { x: 22, y: 0.5, z: -7, yaw: 0 },
    duration: 4,
    ease: 'linear',
  },
  [LAST_BELL_VOYAGE_SEGMENT_IDS.back.openWater]: {
    start: { x: 170.151155, y: 0, z: -126.154286, yaw: -0.371593 },
    end: { x: 218.151155, y: 0, z: -126.154286, yaw: -0.371593 },
    duration: 4.3,
    ease: 'linear',
  },
  [LAST_BELL_VOYAGE_SEGMENT_IDS.back.arrival]: {
    start: { x: -140, y: 0.5, z: 0, yaw: 1.511606 },
    end: { x: 0, y: 0.5, z: 0, yaw: 1.511606 },
    duration: 16,
    ease: 'linear',
  },
} as const;

export type LastBellPropPathSegmentId = keyof typeof LAST_BELL_PROP_PATH_SEGMENTS;
export type LastBellPropCueId = keyof typeof LAST_BELL_PROP_PATH_SEGMENTS | typeof LB_PROP_CUE_PARK;
