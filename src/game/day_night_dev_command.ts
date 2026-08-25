// The dev-only day/night scrub, and the offline sim's day/night clock.
//
// `/daynight night|dawn|day|dusk|<0..1>|auto` (also `/dev daynight`, `/dev time`) and
// `/daynight moon ...` override the shared render clock (render/day_night_clock.ts) so
// the sky, the minimap dial AND the offline sim jump to the chosen time of day together:
// `offlineDayNightNowMs` is the clock the offline Sim is handed (SimConfig.dayNightNowMs),
// and it reads the same override, so scrubbing to night puts the world boss to bed on
// screen. Lived in main.ts before; main.ts is a firewall, not a home, and a dev command
// handler is exactly the kind of bootstrap helper that belongs in a src/game sibling.
//
// Dev builds only, gated at the call site AND here: a per-client phase override is
// brighter-night-for-me, exactly the actionable-visibility class the graphics-fairness
// rule bans. The `[dev]` lines are dev-channel English by design (never a t() key).

import {
  dayNightPhaseOverride,
  setDayNightPhaseOverride,
  setLunarPhaseOverride,
} from '../render/day_night_clock';
import { phaseToCycleMs } from '../sim/day_night';

/** The two HUD touches the command makes; narrow so the module never imports Hud. */
export interface DayNightDevCommandDeps {
  log(text: string, color: string): void;
  refreshDayNightDial(): void;
}

export const MOON_PRESETS: Readonly<Record<string, number>> = {
  new: 0,
  crescent: 0.125,
  half: 0.25,
  quarter: 0.25,
  gibbous: 0.375,
  full: 0.5,
};

export const DAY_NIGHT_PRESETS: Readonly<Record<string, number>> = {
  midnight: 0,
  night: 0,
  dawn: 0.25,
  sunrise: 0.25,
  morning: 0.375,
  day: 0.5,
  noon: 0.5,
  midday: 0.5,
  afternoon: 0.625,
  dusk: 0.75,
  sunset: 0.75,
  evening: 0.8,
};

const RESUME_WORDS = ['auto', 'off', 'real', 'resume', 'clear'];

/** A preset name or a number in [0,1), wrapped; null when neither. */
export function parsePhaseArg(
  word: string,
  presets: Readonly<Record<string, number>>,
): number | null {
  if (word in presets) return presets[word];
  const n = Number.parseFloat(word);
  return Number.isFinite(n) ? ((n % 1) + 1) % 1 : null;
}

/**
 * The UTC-anchored millisecond clock the OFFLINE sim's day/night cycle reads, honoring
 * the dev override: with no override it is the same Date.now the renderer's sky uses,
 * and under `/daynight <phase>` it is a synthesized instant inside the first cycle
 * with exactly that phase, so the sim's night is the sky's night either way.
 */
export function offlineDayNightNowMs(): number {
  const override = dayNightPhaseOverride();
  return override === null ? Date.now() : phaseToCycleMs(override);
}

/**
 * Handle one chat line if it is the day/night scrub. Returns true when it consumed the
 * input (so the line is not also sent to chat), false for anything else.
 */
export function tryDayNightDevCommand(raw: string, deps: DayNightDevCommandDeps): boolean {
  const m = raw.trim().match(/^\/(?:dev\s+time|dev\s+daynight|daynight)\b\s*(.*)$/i);
  if (!m) return false;
  if (!import.meta.env.DEV) return false;
  const arg = m[1].trim().toLowerCase();
  if (!arg) {
    deps.log('[dev] usage: /daynight night|dawn|day|dusk|<0..1>|auto', '#ffcf6a');
    deps.log('[dev]        /daynight moon new|crescent|half|full|<0..1>|auto', '#ffcf6a');
    return true;
  }
  const moonArg = arg.match(/^moon\s*(.*)$/);
  if (moonArg) {
    const moonWord = moonArg[1].trim();
    if (!moonWord || RESUME_WORDS.includes(moonWord)) {
      setLunarPhaseOverride(null);
      deps.log('[dev] moon resumed (real lunar clock)', '#8fd0ff');
      return true;
    }
    const moonPhase = parsePhaseArg(moonWord, MOON_PRESETS);
    if (moonPhase === null) {
      deps.log(
        `[dev] unknown moon "${moonWord}" - try new|crescent|half|full|<0..1>|auto`,
        '#ffcf6a',
      );
      return true;
    }
    setLunarPhaseOverride(moonPhase);
    deps.log(`[dev] moon set to ${moonWord} (lunar phase ${moonPhase.toFixed(2)})`, '#8fd0ff');
    return true;
  }
  if (RESUME_WORDS.includes(arg)) {
    setDayNightPhaseOverride(null);
    deps.log('[dev] day/night resumed (real UTC clock)', '#8fd0ff');
    deps.refreshDayNightDial();
    return true;
  }
  const phase = parsePhaseArg(arg, DAY_NIGHT_PRESETS);
  if (phase === null) {
    deps.log(`[dev] unknown time "${arg}" - try night|dawn|day|dusk|<0..1>|auto`, '#ffcf6a');
    return true;
  }
  setDayNightPhaseOverride(phase);
  deps.log(`[dev] time of day set to ${arg} (phase ${phase.toFixed(2)})`, '#8fd0ff');
  deps.refreshDayNightDial();
  return true;
}
