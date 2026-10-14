// Boundary validators for the world-object wire commands the dispatchMessage
// switch (server/game.ts) answers with a command outcome: `loot` (a corpse),
// `pickup` (a ground object) and `buyplot` (a Tidehold housing deed, from the
// Studio merge). The bodies moved here whole so game.ts keeps one line per
// case (server/CLAUDE.md, "New WS/loop-side behavior"); the `case 'x':` labels
// stay in the switch, where tests/command_schema.test.ts scans them.
//
// Same short-circuit as before: a malformed payload field never reaches the
// sim. `pid` always comes from the caller's authenticated session, never the
// payload. Every rule past the type check is the sim's.

export interface WorldObjectCommandSim {
  lootCorpse(id: number, pid?: number): boolean;
  pickUpObject(id: number, pid?: number): boolean;
  buyPlot(deedId: string, pid?: number): boolean;
}

interface WorldObjectPayload {
  readonly id?: unknown;
  readonly plot?: unknown;
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

/** `buyplot`: buy a housing plot at its sign (src/sim/plots.ts owns the rules). */
export function buyPlotCommandOutcome(
  sim: WorldObjectCommandSim,
  msg: WorldObjectPayload,
  pid: number,
): boolean {
  return typeof msg.plot === 'string' && sim.buyPlot(msg.plot, pid);
}
