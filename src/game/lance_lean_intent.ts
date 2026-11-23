// The Shardpike lean, as the client's movement intent carries it.
//
// A couched Shardpike (src/sim/lance_trial.ts) turns the player's left/right axis into a
// balance stick. The sim reads that stick from the strafe bits of the streamed MoveInput,
// and that is exactly where the original trial broke for real players: the keybind sweep
// UNBINDS strafe the moment Q or E moves onto the action bar (a very common layout), so a
// player like that had no stick at all and the beam fell over every time.
//
// This leaf fixes it on the client side, where the keys live, with no new wire traffic:
//   - while braced, the TURN keys (A/D and the arrows by default) lean too. A braced player
//     cannot turn anyway (the brace owns movement), and turning online is streamed as a
//     HEADING rather than as flags (keyboard_turn_facing.ts), so the turn keys have to be
//     folded into the strafe bits here or the server would never see them;
//   - the two on-screen lean keycaps above the balance beam (src/ui/hud/shardpike/) press
//     and hold `hold`, so the trial is playable with ANY bindings, and on a touch screen.
// Outside a brace this is a no-op, so ordinary movement is untouched.
//
// `lanceLeanIntent` is the one shared instance: the HUD's Shardpike bar writes `braced`
// every frame it paints and `hold` from the keycaps, and Input.readMoveInput folds it in.

/** The movement bits the fold reads and writes (a structural subset of MoveInput). */
export interface LeanMoveBits {
  strafeLeft: boolean;
  strafeRight: boolean;
  turnLeft: boolean;
  turnRight: boolean;
}

export interface LanceLeanIntent {
  /** A Shardpike is couched right now (the HUD sets this from the live trial). */
  braced: boolean;
  /** The on-screen keycaps: -1 left held, 1 right held, 0 neither. */
  hold: -1 | 0 | 1;
}

export const lanceLeanIntent: LanceLeanIntent = { braced: false, hold: 0 };

/**
 * Fold the lean into a move input, in place, and return it.
 *
 * While braced: strafe OR turn OR the held keycap leans, and the turn bits are cleared so
 * no host rotates a body that is supposed to be planted. Unbraced: untouched, and a stale
 * keycap hold is dropped so it can never leak into the next brace.
 */
export function applyLanceLean<T extends LeanMoveBits>(mi: T, intent: LanceLeanIntent): T {
  if (!intent.braced) {
    intent.hold = 0;
    return mi;
  }
  mi.strafeLeft = mi.strafeLeft || mi.turnLeft || intent.hold === -1;
  mi.strafeRight = mi.strafeRight || mi.turnRight || intent.hold === 1;
  mi.turnLeft = false;
  mi.turnRight = false;
  return mi;
}
