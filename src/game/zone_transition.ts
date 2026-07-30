// Pure policy for how the client materializes a zone the player just entered
// unprepared. A WALKED boundary crossing warms up in the background (no
// loading screen, no input freeze: sim collision is procedural math, so
// gameplay on not-yet-rendered ground stays correct while the chunks nearest
// the player stream in first). A TELEPORT (rift exit, dungeon door,
// hearthstone, dev command) can land anywhere, so it keeps the classic
// blocking loading screen rather than dropping the player into a void.

/** Largest per-frame displacement (yards) still attributable to movement.
 *  Sim locomotion tops out around 14 yd/s (~0.7 yd per 20 Hz tick, a handful
 *  of yards even on a long stalled frame); anything bigger is a teleport. */
export const TELEPORT_DISPLACEMENT_YD = 30;

export type ZoneWarmupMode = 'background' | 'blocking';

/** Classify an unprepared-zone entry by how far the player moved this frame. */
export function zoneWarmupMode(displacementYd: number): ZoneWarmupMode {
  return displacementYd > TELEPORT_DISPLACEMENT_YD ? 'blocking' : 'background';
}
