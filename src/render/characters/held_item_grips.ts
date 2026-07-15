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
    l: { position: [0, 0.017, 0.1771], quaternion: [0, 0, 0, 1], scale: 0.4413 },
  },
  Rectangle_Shield: {
    r: { position: [0, 0.017, 0.1617], quaternion: [0, 1, 0, 0], scale: 0.5964 },
    l: { position: [0, 0.017, 0.1617], quaternion: [0, 0, 0, 1], scale: 0.5964 },
  },
  Badge_Shield: {
    r: { position: [0, -0.0123, 0.1341], quaternion: [0, 1, 0, 0], scale: 0.5108 },
    l: { position: [0, -0.0123, 0.1341], quaternion: [0, 0, 0, 1], scale: 0.5108 },
  },
};
