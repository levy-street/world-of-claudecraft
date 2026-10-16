// Which keys lean a couched Shardpike, as the keycaps above the balance beam show them.
//
// The beam's stick is the left/right axis, and "which keys ARE that" is the one fact the
// trial never put on screen, which is how a player who had bound Q and E to the action bar
// (the keybind sweep then unbinds strafe) ended up holding keys that did nothing while the
// pike fell over. So the keycaps read the LIVE bindings every paint:
//   - strafe first, because it is the stick the trial was designed around and, where it is
//     bound, the key a player already reaches for sideways;
//   - the turn keys when strafe is unbound (the Q/E-on-the-action-bar case): while braced
//     they lean too (src/game/lance_lean_intent.ts), so A/D is the honest answer there;
//   - nothing at all when neither is bound, and the painter draws the bare arrow, since the
//     keycap itself is then the stick (it is a press-and-hold button).
//
// Pure and DOM-free (registered in tests/architecture.test.ts UI_PURE_CORES). The binding
// source and the label formatter are injected: a ui core may not import src/game, and the
// HUD hands in the live Keybinds and its keyLabel.

/** The slice of Keybinds this reads. */
export interface LeanBindingSource {
  codesForAction(id: string): string[];
}

/** The keycap text for each side ('' when no key leans that way). */
export interface ShardpikeLeanKeys {
  left: string;
  right: string;
}

/** Strafe first, then turn: the first bound code for a side, formatted by `label`. */
export function shardpikeLeanKeys(
  binds: LeanBindingSource | null | undefined,
  label: (combo: string) => string,
): ShardpikeLeanKeys {
  const pick = (strafe: string, turn: string): string => {
    if (!binds) return '';
    const code = binds.codesForAction(strafe)[0] ?? binds.codesForAction(turn)[0];
    return code ? label(code) : '';
  };
  return { left: pick('strafeLeft', 'turnLeft'), right: pick('strafeRight', 'turnRight') };
}
