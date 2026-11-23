// Boundary validators for the world-object wire commands the dispatchMessage
// switch (server/game.ts) answers with a command outcome: `loot` (a corpse)
// and `pickup` (a ground object). The bodies moved here whole so game.ts
// keeps one line per case (server/CLAUDE.md, "New WS/loop-side behavior");
// the `case 'x':` labels stay in the switch, where
// tests/command_schema.test.ts scans them.
//
// Same short-circuit as before: a malformed payload field never reaches the
// sim. `pid` always comes from the caller's authenticated session, never the
// payload. Every rule past the type check is the sim's.

export interface WorldObjectCommandSim {
  lootCorpse(id: number, pid?: number): boolean;
  pickUpObject(id: number, pid?: number): boolean;
}

interface WorldObjectPayload {
  readonly id?: unknown;
}

/** `loot`: open a corpse's loot window. */
export function lootCommandOutcome(
  sim: WorldObjectCommandSim,
  msg: WorldObjectPayload,
  pid: number,
): boolean {
  return typeof msg.id === 'number' && sim.lootCorpse(msg.id, pid);
}

/** `pickup`: take a ground object. */
export function pickupCommandOutcome(
  sim: WorldObjectCommandSim,
  msg: WorldObjectPayload,
  pid: number,
): boolean {
  return typeof msg.id === 'number' && sim.pickUpObject(msg.id, pid);
}
