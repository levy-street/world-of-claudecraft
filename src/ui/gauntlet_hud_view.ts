// Pure view-core for the Gauntlet HUD cluster (the vitality bar, phase countdown,
// survivor/prize chips, and the sentinel light pill). DOM/Three/i18n-free and
// deterministic: it maps the viewer-scoped run projection plus the current sim
// time into a flat render model, and the painter (gauntlet_hud_painter.ts) turns
// that model into DOM through the elided writers, resolving every label / number /
// money through t()/formatNumber/formatMoney on its side.
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
import type { GauntletPhase, GauntletRunView } from '../sim/types';

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
  survivors: number;
  total: number;
  /** Prize pool in raw copper; the painter formats it with formatMoney. */
  prizePool: number;
  /** The sentinel light during the red-light/green-light trial, else null. */
  light: 'green' | 'red' | null;
  showLight: boolean;
  /** The Keeper's Wager strip during a live wager round, else null. The duel
   *  itself plays on the table (marbles, stones, pebbles); the strip carries
   *  only the stake stepper and the round clock. The stake is a LOCAL UI value
   *  (the wire never projects it; the server re-clamps every send), passed in
   *  through the input and clamped here against the live purses. */
  wager: {
    stake: number;
    canDec: boolean;
    canInc: boolean;
    /** Raw remaining round seconds (the painter ceils + formats). */
    roundSeconds: number;
  } | null;
  /** The Final Court shove prompt during the court trial, else null. */
  court: {
    /** True while the viewer holds the attacker role this swap window. */
    attacker: boolean;
    /** The shove is off cooldown (time >= shoveReadyAt). */
    shoveReady: boolean;
    /** Remaining cooldown as a 0..1 fraction (0 when ready), for the fill. */
    cooldownFrac: number;
  } | null;
  /** The viewer was knocked out and is watching. */
  spectating: boolean;
  /** The viewer crossed the finish line this trial. */
  finished: boolean;
  /** Podium standings once the run resolves (proper nouns, not translated). */
  podium: { first: string; second: string; third: string } | null;
}

/** The per-frame input: the viewer's run projection and the current sim time,
 * plus the hud-held local stake pick for the wager strip. */
export interface GauntletHudInput {
  run: GauntletRunView | null;
  time: number;
  wagerStake?: number;
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
  survivors: 0,
  total: 0,
  prizePool: 0,
  light: null,
  showLight: false,
  wager: null,
  court: null,
  spectating: false,
  finished: false,
  podium: null,
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
        case 'wager':
          return GAUNTLET.wager.durationS;
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
  const wager =
    run.wager && run.wager.stage !== 'done'
      ? (() => {
          const cap = Math.max(
            1,
            Math.min(GAUNTLET.wager.maxWager, run.wager.mine, run.wager.theirs),
          );
          const stake = Math.max(1, Math.min(cap, Math.floor(input.wagerStake ?? 1)));
          return {
            stake,
            canDec: stake > 1,
            canInc: stake < cap,
            roundSeconds: Math.max(0, run.wager.roundEndsAt - time),
          };
        })()
      : null;
  const court = run.court
    ? {
        attacker: run.court.attacker,
        shoveReady: time >= run.court.shoveReadyAt,
        cooldownFrac:
          GAUNTLET.court.shoveCooldownS > 0
            ? clamp01(Math.max(0, run.court.shoveReadyAt - time) / GAUNTLET.court.shoveCooldownS)
            : 0,
      }
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
    survivors: run.survivors,
    total: run.total,
    prizePool: run.prizePool,
    light: run.sentinel ? run.sentinel.light : null,
    showLight: run.sentinel !== null,
    wager,
    court,
    spectating: run.spectating,
    finished: run.finished,
    podium: run.podium,
  };
}
