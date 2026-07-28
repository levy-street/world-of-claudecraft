// Last Bell prop paths are authored beside the scene definitions but remain
// inert presentation data. The sim carries only each segment id on the prop
// wire op; the render client resolves the matching record.

export const LAST_BELL_CAST_OFF_SEGMENT_ID = 'cast_off';

export const LAST_BELL_PROP_PATH_SEGMENTS = {
  [LAST_BELL_CAST_OFF_SEGMENT_ID]: {
    start: { x: 0, y: 0, z: 0, yaw: 0 },
    end: { x: 26, y: 0, z: 0, yaw: 0.09 },
    duration: 16,
    ease: 'easeInQuad',
  },
} as const;
