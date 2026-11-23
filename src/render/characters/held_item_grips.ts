export interface HandGrip {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: number;
}

/** Native sword mounting used when the exported rig omits accessory nodes. */
export const KAYKIT_ONE_HAND_SWORD_GRIP: { r: HandGrip; l: HandGrip } = {
  r: { position: [0, 0.555174, 0], quaternion: [0, 1, 0, 0], scale: 0.8876 },
  l: { position: [0, 0.555174, 0], quaternion: [0, 0, 0, 1], scale: 0.8876 },
};

export const KAYKIT_SHIELD_ACCESSORIES = {
  shield_round: 'Round_Shield',
  shield_square: 'Rectangle_Shield',
  shield_badge: 'Badge_Shield',
  varkhul_emberward: 'Varkhul_Bulwark',
  shield_starter: 'Starter_Shield',
  shield_field_steel: 'Heater_Shield',
  shield_rare_a_teal: 'Heater_Shield',
  shield_rare_a_violet: 'Heater_Shield',
  shield_rare_a_glacier: 'Heater_Shield',
  shield_rare_a_deepice: 'Heater_Shield',
  shield_rare_a_dawn: 'Heater_Shield',
  shield_rare_a_crucible: 'Heater_Shield',
  shield_rare_b_teal: 'Heater_Shield',
  shield_rare_b_ember: 'Heater_Shield',
  shield_rare_b_violet: 'Heater_Shield',
  shield_epic_votive_bone_votive: 'Heater_Shield',
  shield_epic_votive_ember_warden: 'Heater_Shield',
  shield_epic_crucible_heat_blue_iron: 'Tower_Shield',
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
  // Ignivar raid legendary (Varkhul drop). Not a KayKit accessory: the model is
  // origined at its back grip bar (tmp/varkhul_drops_build.mjs), so the hand
  // seats AT the origin and only a small clearance offset remains.
  Varkhul_Bulwark: {
    r: { position: [0, 0.017, 0.03], quaternion: [0, 1, 0, 0], scale: 1.1 },
    l: { position: [0, 0.017, 0.03], quaternion: [0, 0, 0, 1], scale: 1.1 },
  },
  // The starter buckler (warrior and paladin begin with it), shipped at its world
  // size, a little under the KayKit round shield's. Its origin is the rear handle,
  // which sits off the disc's centre, toward the rim. Seated at the hand with no
  // turn, the disc hung forward of the fist and off the arm (owner report). So it
  // is ROLLED about its face until the line from handle to centre lies along the
  // forearm (measured in each slot's own frame on the WOC rig: the elbow is at
  // +0.86, -0.51 of the left slot and -0.87, -0.50 of the right), then drawn a
  // hand's width back down the arm: the fist sits behind the lower third of the
  // disc and the forearm behind its middle. It stands 0.1 off the arm: at 0.05 the
  // male warrior's and paladin's plate gauntlets came through the face (owner
  // report; 0.09 was the first clean value in full plate, on both bodies). The face
  // points out along +Z on both slots, so neither row carries the kit rows' half turn.
  Starter_Shield: {
    r: { position: [0.074, 0.059, 0.1], quaternion: [0, 0, 0.9345, 0.3559], scale: 1 },
    l: { position: [-0.073, 0.06, 0.1], quaternion: [0, 0, -0.7777, 0.6286], scale: 1 },
  },
  // The pack shields (the field heater, the rare set's pointed and round shields, the epic
  // round one), shipped at their world size with the origin at the middle of the board.
  // A shield has an up, and the pose that decides it is the BATTLE STANCE, where the
  // shield is presented in front of the body: there it must stand straight up and down
  // (owner). The roll about the face is therefore the one that points the board's top at
  // world up in that stance, read off the WOC rig in the shield hand's own frame: up lies
  // 9 degrees off the slot's +Y there, the same on the male and female bodies (the kit
  // rows above carry no roll at all, 9 degrees from this).
  // Whatever that leaves in the idle hold is accepted: the forearm hangs the other way
  // up, so the board hangs with its top low and forward. Two earlier fits were tuned in
  // the idle (top up the forearm, then tipped forward) and both lay across the body in
  // the stance. Its middle sits on the arm's line, 0.08 up from the hand, and 0.13 off
  // the arm: at 0.10 a plate vambrace came through the face, 0.12 was the first clean
  // value. The right-hand row is the mirror.
  Heater_Shield: {
    r: { position: [-0.07, -0.04, 0.13], quaternion: [0, 0, -0.0787, 0.9969], scale: 1 },
    l: { position: [0.069, -0.041, 0.13], quaternion: [0, 0, 0.0787, 0.9969], scale: 1 },
  },
  // The epic tower shield: the same roll, for a board a unit and a half tall (the heater
  // is a unit and a fifth). Its middle sits 0.07 down the arm from the hand, where the
  // heater's sits 0.08 up. No item draws it yet.
  Tower_Shield: {
    r: { position: [0.061, 0.035, 0.13], quaternion: [0, 0, -0.0787, 0.9969], scale: 1 },
    l: { position: [-0.06, 0.036, 0.13], quaternion: [0, 0, 0.0787, 0.9969], scale: 1 },
  },
};
