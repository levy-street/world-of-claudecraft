// The Deepglass flier's pose layers, pure: the travel-direction pitch and the
// dash flip. Three- and DOM-free; the renderer entity loop is the consumer and
// only calls these for a body in flooded flight (Entity.dgFlight).

// Flooded flight's own nose-over reference. The lake's 3.2 yd/s saturates on the
// first tick of a climb in here (the bell's boost cap is 26), which turned the
// pitch into an on/off switch; and 0.62 rad is a swimmer's polite tilt, where a
// body on a thrustpack should genuinely point down the line it is flying.
export const DG_PITCH_FULL_SPEED = 13;
/** Steepest the flier's body noses over/up, radians. In the bell the pose
 *  follows the direction of TRAVEL (see the entity loop), so a pure climb on
 *  the trim key is drawn nose-up rather than level, this is its ceiling. */
export const DG_PITCH_MAX = 1.25;
/** The deepball dash flip: seconds of full body rotation after a dash fires. */
export const DG_FLIP_SECS = 0.5;

/**
 * Flooded flight pitches the body to the DIRECTION it is travelling, not to a
 * vertical-speed ratio: a body climbing on the trim key alone was rising at
 * cruise and still drawn nose-forward, because vy over the reference speed
 * never reached the ceiling once forward motion shared the cap. The angle of
 * travel does, a pure climb is nose straight up. Expressed as the vertical
 * speed advanceSwimPitch maps to that angle. `dx`/`dz` are this frame's
 * displayed travel (yards), `vy` the vertical speed (yd/s).
 */
export function flightPoseVerticalSpeed(dx: number, dz: number, vy: number, dt: number): number {
  if (!(dt > 0)) return vy;
  const hs = Math.hypot(dx, dz) / dt;
  const angle = Math.hypot(hs, vy) > 1 ? Math.atan2(vy, hs) : 0;
  return Math.max(-1, Math.min(1, angle / DG_PITCH_MAX)) * DG_PITCH_FULL_SPEED;
}

/** Per-view dash-flip state (lives on the EntityView). */
export interface DashFlipState {
  /** Seconds since the last dash fired (>= DG_FLIP_SECS when idle). */
  dgFlipT: number;
  /** Which axis it left along (Entity.dgDashKind). */
  dgFlipKind: number;
  /** The last seen dgDashTicks, for the edge detect. */
  dgPrevDashTicks: number;
}

/** Pitch and roll the flip adds to the swim rig's pose channels this frame. */
export interface DashFlipOffset {
  pitch: number;
  roll: number;
}

/**
 * The deepball dash FLIP: a full 360 about the dash's own axis, layered onto
 * the pose channels the swim rig already owns (pitch for a front/back flip,
 * roll for the sides). Edge-detected off dgDashTicks, the sim's dash flare,
 * and integrated at frame rate so the spin is smooth at any fps. Writes the
 * offset into `out` (zeroed when idle) and advances `s` in place.
 */
export function advanceDashFlip(
  s: DashFlipState,
  dashTicks: number,
  dashKind: number,
  dt: number,
  out: DashFlipOffset,
): DashFlipOffset {
  out.pitch = 0;
  out.roll = 0;
  if (dashTicks > 0 && s.dgPrevDashTicks === 0) {
    s.dgFlipT = 0;
    s.dgFlipKind = dashKind;
  }
  s.dgPrevDashTicks = dashTicks;
  if (s.dgFlipT < DG_FLIP_SECS) {
    s.dgFlipT = Math.min(DG_FLIP_SECS, s.dgFlipT + dt);
    const ft = s.dgFlipT / DG_FLIP_SECS;
    // Smoothstep-eased full turn: launches hard, lands soft.
    const angle = Math.PI * 2 * (ft * ft * (3 - 2 * ft));
    if (s.dgFlipKind === 2)
      out.pitch = -angle; // back dash: backflip
    else if (s.dgFlipKind === 4)
      out.roll = angle; // left: roll left
    else if (s.dgFlipKind === 8)
      out.roll = -angle; // right: roll right
    else out.pitch = angle; // forward (and click): front flip
  }
  return out;
}

/** A body that left flooded flight: the flip is idle and re-arms. */
export function resetDashFlip(s: DashFlipState): void {
  s.dgPrevDashTicks = 0;
  s.dgFlipT = DG_FLIP_SECS;
}
