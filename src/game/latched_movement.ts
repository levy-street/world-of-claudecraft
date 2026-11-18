// Latched movement is intent the player set once and is no longer holding:
// autorun and a click-to-move goal. It keeps moving the character with no key
// down, so it must not carry across an arrival the player did not steer.
//
// The case that shipped: a raider on autorun for the whole corpse run walks
// their spirit through a boss room door, is revived at the entrance still
// moving, and reaches the boss's aggro radius about a second and a half later
// (the Ignivar door sits 31 yd from him, his radius is 20 yd). To the raid it
// reads as the boss pulling the moment someone walked in. A HELD key is left
// alone on purpose: that is a player actively steering, and they can let go.

export interface LatchedMovementInput {
  setAutorun(on: boolean): boolean;
  clearClickMove(): void;
}

export interface LatchedMovementIndicator {
  syncAutorun(on: boolean): void;
}

/** Stop autorun and click-to-move, and bring the on-screen autorun control along. */
export function dropLatchedMovement(
  input: LatchedMovementInput,
  indicator: LatchedMovementIndicator,
): void {
  input.setAutorun(false);
  input.clearClickMove();
  indicator.syncAutorun(false);
}
