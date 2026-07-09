// Pure view-core for the Gauntlet HUD cluster (the phase caption, the phase
// countdown, the Keeper's Echo strip, and the Final Court role). DOM/Three/i18n-free
// and deterministic: it maps the viewer-scoped run projection plus the current sim
// time into a flat render model, and the painter (gauntlet_hud_painter.ts) turns
// that model into DOM through the elided writers, resolving every label / number
// through t()/formatNumber on its side.
//
// Deadlines inside GauntletRunView are ABSOLUTE sim time (`endsAt`, `sentinel.until`);
// countdowns derive from `time` here, so a quiet wire tick (the view is delta-elided
// server-side) still animates the timer client-side.
//
// The countdown FRACTION needs a phase-window denominator the wire view does not
// carry, so it reads the shipped pacing from the one source of truth (the GAUNTLET
// content record). This is presentation-only and gameplay-neutral: the bar's fill
// smoothness is the only thing that depends on it, while the authoritative seconds
// text always comes from the real absolute `endsAt`, so a pacing tweak can never
// desync the visible countdown.

import { GAUNTLET } from '../sim/content/gauntlet';
import type { GauntletPhase, GauntletRunView, GauntletTrialKind } from '../sim/types';

/** Which one-line teaching hint the pre-trial tutorial banner shows (the painter
 * resolves the matching hudChrome.gauntlet.hint.* key; this core stays i18n-free).
 * The echo splits by phase (watch while the stones flash, answer once the input
 * window opens); the tutorial teaches its watch phase. */
export type GauntletHudHint =
  | 'sentinel'
  | 'sigils'
  | 'pull'
  | 'echoWatch'
  | 'echoAnswer'
  | 'span'
  | 'court';

// The big centered tutorial banner (the UPCOMING trial's teaching line) is tied
// to the between-games cooldown bar: it shows for the WHOLE staging and every
// interlude, i.e. the entire time the countdown bar is up before you are
// transported into the next trial. No separate lead window.

/** The flat render model the gauntlet HUD painter consumes. */
export interface GauntletHudModel {
  /** Whether the cluster shows at all (a run is live). */
  visible: boolean;
  phase: GauntletPhase;
  /** 0-based current trial and the run's trial count (for a "Trial N of M" label). */
  trialIndex: number;
  trialCount: number;
  /** The viewer's event vitality, as a clamped 0..1 fraction plus the raw values
   *  (the painter formats "value / max" via formatNumber). */
  vitalityFrac: number;
  vitalityValue: number;
  vitalityMax: number;
  /** The current phase deadline, as a clamped 0..1 remaining fraction (cosmetic bar
   *  fill) plus the raw remaining seconds (the painter ceils + formats). */
  countdownFrac: number;
  countdownSeconds: number;
  /** False only once the run is over (phase 'done'); every live phase has a deadline. */
  showCountdown: boolean;
  /** The Keeper's Echo strip during a live duel, else null. The duel itself
   *  plays on the table (the flashing rune stones); the strip carries only
   *  the round counter and the answer clock. */
  echo: {
    /** 1-based round for display, and the total to clear. */
    round: number;
    rounds: number;
    /** Raw remaining answer seconds once the input window is open, else null
     *  (the stones are still flashing; the painter hides the clock). */
    answerSeconds: number | null;
  } | null;
  /** The viewer was knocked out and is watching. */
  spectating: boolean;
  /** The viewer crossed the finish line this trial. */
  finished: boolean;
  /** Podium standings once the run resolves (proper nouns, not translated). */
  podium: { first: string; second: string; third: string } | null;
  /** The pre-trial tutorial banner: the UPCOMING trial's teaching line, shown
   *  for the WHOLE staging and every interlude (tied to the cooldown bar; the
   *  painter renders it big and centered), or null. Spectators see none. */
  tutorial: GauntletHudHint | null;
}

/** The per-frame input: the viewer's run projection and the current sim time. */
export interface GauntletHudInput {
  run: GauntletRunView | null;
  time: number;
}

// The teaching line for a trial KIND (the echo teaches its watch phase: by
// the time the answer window opens the in-trial hint has taken over).
function hintForKind(kind: GauntletTrialKind): GauntletHudHint {
  return kind === 'echo' ? 'echoWatch' : kind;
}

// The pre-trial tutorial: the UPCOMING trial's teaching line, live for the
// WHOLE staging (trial 1) and every interlude, matching the cooldown bar that
// counts down to the transport into the next trial. Spectators just watch, so
// they get none.
function tutorialFor(run: GauntletRunView): GauntletHudHint | null {
  if (run.spectating) return null;
  if (run.phase !== 'staging' && run.phase !== 'interlude') return null;
  const idx = run.phase === 'staging' ? run.trialIndex : run.trialIndex + 1;
  const kind = GAUNTLET.trials[idx];
  return kind ? hintForKind(kind) : null;
}

const HIDDEN: GauntletHudModel = {
  visible: false,
  phase: 'done',
  trialIndex: 0,
  trialCount: 0,
  vitalityFrac: 0,
  vitalityValue: 0,
  vitalityMax: 0,
  countdownFrac: 0,
  countdownSeconds: 0,
  showCountdown: false,
  echo: null,
  spectating: false,
  finished: false,
  podium: null,
  tutorial: null,
};

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

// The nominal length (seconds) of the run's current phase, the denominator for the
// cosmetic countdown-bar fill. Trial phases use the current trial's tuning duration.
// Exported so the HUD's countdown estimator (gauntlet_clock.ts) anchors to the same
// window without re-deriving it.
export function gauntletPhaseWindowSeconds(run: GauntletRunView): number {
  switch (run.phase) {
    case 'lobby':
      return GAUNTLET.lobbyFillS;
    case 'staging':
      return GAUNTLET.stagingS;
    case 'interlude':
      return GAUNTLET.interludeS;
    case 'podium':
      return GAUNTLET.podiumS;
    case 'trial':
      // Each game's own clock is the denominator.
      switch (GAUNTLET.trials[run.trialIndex]) {
        case 'sigils':
          return GAUNTLET.sigils.durationS;
        case 'pull':
          return GAUNTLET.pull.durationS;
        case 'echo':
          return GAUNTLET.echo.durationS;
        case 'span':
          return GAUNTLET.span.durationS;
        case 'court':
          return GAUNTLET.court.durationS;
        default:
          return GAUNTLET.sentinel.durationS;
      }
    default:
      return 0;
  }
}

/** Map the viewer's run projection + sim time into the flat HUD render model. */
export function gauntletHudModel(input: GauntletHudInput): GauntletHudModel {
  const { run, time } = input;
  if (!run) return HIDDEN;
  const remaining = Math.max(0, run.endsAt - time);
  const window = gauntletPhaseWindowSeconds(run);
  const vitalityFrac = clamp01(run.vitalityMax > 0 ? run.vitality / run.vitalityMax : 0);
  const echo =
    run.echo && !run.echo.done
      ? (() => {
          const showEndsAt = run.echo.showStartAt + run.echo.seq.length * run.echo.stepS;
          return {
            round: run.echo.round + 1,
            rounds: run.echo.rounds,
            answerSeconds: time >= showEndsAt ? Math.max(0, run.echo.inputEndsAt - time) : null,
          };
        })()
      : null;
  return {
    visible: true,
    phase: run.phase,
    trialIndex: run.trialIndex,
    trialCount: run.trialCount,
    vitalityFrac,
    vitalityValue: run.vitality,
    vitalityMax: run.vitalityMax,
    countdownFrac: window > 0 ? clamp01(remaining / window) : 0,
    countdownSeconds: remaining,
    showCountdown: run.phase !== 'done',
    echo,
    spectating: run.spectating,
    finished: run.finished,
    podium: run.podium,
    tutorial: tutorialFor(run),
  };
}
