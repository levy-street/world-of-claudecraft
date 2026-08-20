// Render-side detection of a teleport-class ARRIVAL: the local player moved
// farther between two frames than locomotion can carry it, so the camera was
// dropped somewhere new (a hearth, a portal exit, a dungeon door, a dev
// command). The client's zone transition policy makes the same call for the
// warm-up mode; the renderer cannot import it (render never imports game/),
// so the threshold is mirrored here and pinned equal by
// tests/arrival_event_core.test.ts.
//
// Pure core contract: no three import, no DOM, no clocks, no randomness.
// Registered in RENDER_PURE_CORES (tests/architecture.test.ts).

/** Mirrors TELEPORT_DISPLACEMENT_YD in src/game/zone_transition.ts: the
 *  largest per-frame displacement (yards) still attributable to movement. */
export const ARRIVAL_TELEPORT_DISPLACEMENT_YD = 30;

export function isTeleportDisplacement(dx: number, dz: number): boolean {
  return dx * dx + dz * dz > ARRIVAL_TELEPORT_DISPLACEMENT_YD * ARRIVAL_TELEPORT_DISPLACEMENT_YD;
}

export interface ArrivalDetector {
  /** Feed the local player's position once per frame; true on the frame the
   *  displacement from the previous frame classifies as a teleport. The
   *  first observation only sets the baseline. */
  observe(x: number, z: number): boolean;
}

export function createArrivalDetector(): ArrivalDetector {
  let hasLast = false;
  let lastX = 0;
  let lastZ = 0;
  return {
    observe(x, z) {
      const arrived = hasLast && isTeleportDisplacement(x - lastX, z - lastZ);
      hasLast = true;
      lastX = x;
      lastZ = z;
      return arrived;
    },
  };
}
