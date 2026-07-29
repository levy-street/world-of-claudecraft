export interface HandGrip {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: number;
}

export const KAYKIT_SHIELD_ACCESSORIES = {
  shield_round: 'Round_Shield',
  shield_square: 'Rectangle_Shield',
  shield_badge: 'Badge_Shield',
} as const;

// Extracted from the authored accessory nodes in the original KayKit knight
// rig. Left-hand shields sit flat against the forearm; the right-hand rows are
// their exact table-convention mirrors.
export const KAYKIT_SHIELD_GRIPS: Readonly<Record<string, { r: HandGrip; l: HandGrip }>> = {
  Round_Shield: {
    r: { position: [0, 0.017, 0.1771], quaternion: [0, 1, 0, 0], scale: 0.4413 },
    // Half turn about the hand's up axis: the knight-rig row was identity here,
    // which on the Mixamo-rigged player bodies presented the shield's inner face
    // (it read as strapped on backwards). The z is negated from the right-hand
    // row too: measured against the live bind pose, this bone's local -Z is the
    // character's LEFT (outboard for the left hand), so +z pinned the disc on the
    // inner face of the forearm. Both live here rather than on the per-class
    // attach because offhandAttachDef drops every per-attach grip modifier once a
    // real offhand is equipped.
    l: { position: [0, 0.017, -0.1771], quaternion: [0, 1, 0, 0], scale: 0.4413 },
  },
  Rectangle_Shield: {
    r: { position: [0, 0.017, 0.1617], quaternion: [0, 1, 0, 0], scale: 0.5964 },
    // same left-hand correction as Round_Shield above
    l: { position: [0, 0.017, -0.1617], quaternion: [0, 1, 0, 0], scale: 0.5964 },
  },
  Badge_Shield: {
    r: { position: [0, -0.0123, 0.1341], quaternion: [0, 1, 0, 0], scale: 0.5108 },
    // same left-hand correction as Round_Shield above
    l: { position: [0, -0.0123, -0.1341], quaternion: [0, 1, 0, 0], scale: 0.5108 },
  },
};
