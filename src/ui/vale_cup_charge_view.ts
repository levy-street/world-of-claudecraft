// Pure, host-agnostic view model for the Vale Cup shoot power meter (the
// hold-to-charge shoot; docs/prd/vale-cup.md).
//
// The charge TIMING stays on the Hud (the slot press/release input state and its
// performance.now clock are private input plumbing); this core takes the already
// computed charge fraction and decides everything paintable: visibility, the
// fill fraction, and the tint band (safe -> ideal -> over) so the player can
// feel the sweet spot and the "too much" zone. It also decides `cancel`: a
// charge held while the match ended or the holder died must be dropped by the
// Hud this frame so the meter never sticks.
//
// DOM-free and i18n-free (UI_PURE_CORES, tests/architecture.test.ts); driven
// directly by tests/vale_cup_charge_view.test.ts.

// Band thresholds on the 0..1 charge fraction: ideal is the sweet spot band,
// over is the over-power band. UI-local feel tuning: the sim scales shot power
// and loft linearly with the fraction (no threshold of its own); these bands
// just teach the player where a hard shot starts sailing over the bar.
export const SHOOT_IDEAL_FRAC = 0.6;
export const SHOOT_OVER_FRAC = 0.85;

export interface VcupChargeView {
  /** The Hud must drop its charge state this frame (match over or holder dead). */
  cancel: boolean;
  visible: boolean;
  /** Charge fraction 0..1 (clamped); the painter renders it as the fill width. */
  frac: number;
  /** Sweet-spot band: SHOOT_IDEAL_FRAC < frac <= SHOOT_OVER_FRAC. */
  ideal: boolean;
  /** Over-power band: frac > SHOOT_OVER_FRAC. */
  over: boolean;
}

const HIDDEN: VcupChargeView = {
  cancel: false,
  visible: false,
  frac: 0,
  ideal: false,
  over: false,
};
const CANCELLED: VcupChargeView = {
  cancel: true,
  visible: false,
  frac: 0,
  ideal: false,
  over: false,
};

export function buildVcupChargeView(
  charging: boolean,
  inMatch: boolean,
  dead: boolean,
  frac: number,
): VcupChargeView {
  if (!charging) return HIDDEN;
  if (!inMatch || dead) return CANCELLED;
  const f = Math.max(0, Math.min(1, frac));
  return {
    cancel: false,
    visible: true,
    frac: f,
    ideal: f > SHOOT_IDEAL_FRAC && f <= SHOOT_OVER_FRAC,
    over: f > SHOOT_OVER_FRAC,
  };
}
