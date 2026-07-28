// Last Bell prop paths are authored beside the scene definitions but remain
// inert presentation data. The sim carries only each segment id on the prop
// wire op; the render client resolves the matching record.

export const LAST_BELL_CAST_OFF_SEGMENT_ID = 'cast_off';

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
  [LAST_BELL_CAST_OFF_SEGMENT_ID]: {
    start: { x: 0, y: 0, z: 0, yaw: 0 },
    end: { x: 26, y: 0, z: 0, yaw: 0.09 },
    duration: 16,
    ease: 'easeInQuad',
  },
  [LAST_BELL_VOYAGE_SEGMENT_IDS.out.castOff]: {
    start: { x: 0, y: 0, z: 0, yaw: 0 },
    end: { x: 22, y: 0, z: 3, yaw: -0.12 },
    duration: 4,
    ease: 'easeOutQuad',
  },
  [LAST_BELL_VOYAGE_SEGMENT_IDS.out.openWater]: {
    start: { x: 124.665, y: 0, z: -5.913, yaw: -1.910796 },
    end: { x: 242.374, y: 0, z: -3, yaw: -1.910796 },
    duration: 4.3,
    ease: 'linear',
  },
  [LAST_BELL_VOYAGE_SEGMENT_IDS.out.arrival]: {
    start: { x: -28, y: 0, z: 0, yaw: -0.05 },
    end: { x: 0, y: 0, z: 0, yaw: 0 },
    duration: 4.3,
    ease: 'easeInOutSine',
  },
  [LAST_BELL_VOYAGE_SEGMENT_IDS.back.castOff]: {
    start: { x: 0, y: 0, z: 0, yaw: 0 },
    end: { x: 22, y: 0, z: 0, yaw: -0.08 },
    duration: 4,
    ease: 'easeOutQuad',
  },
  [LAST_BELL_VOYAGE_SEGMENT_IDS.back.openWater]: {
    start: { x: 117.609, y: 0, z: -6.658, yaw: -0.371593 },
    end: { x: 230.693, y: 0, z: -5.65, yaw: -0.371593 },
    duration: 4.3,
    ease: 'linear',
  },
  [LAST_BELL_VOYAGE_SEGMENT_IDS.back.arrival]: {
    start: { x: -28, y: 0, z: 0, yaw: 0.05 },
    end: { x: 0, y: 0, z: 0, yaw: 0 },
    duration: 4.3,
    ease: 'easeInOutSine',
  },
} as const;
