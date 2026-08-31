// Dev-build chat command that scrubs the world day/night cycle and lunar
// phase (extracted from the main.ts chat send path; main.ts is a firewall,
// not a home). See the usage lines below for the accepted forms.
import { setDayNightPhaseOverride, setLunarPhaseOverride } from '../render/day_night_clock';

export interface DayNightDevHud {
  log(text: string, color?: string): void;
  refreshDayNightDial(): void;
}

// Dev-only chat command to scrub the world day/night cycle for testing:
//   /daynight night|dawn|day|dusk|<0..1>|auto   (also /dev daynight, /dev time)
//   /daynight moon new|crescent|half|full|<0..1>|auto   (the lunar phase)
// Render-only: it just overrides the shared clock phase (day_night_clock), so
// the sky lighting and the minimap dial both jump to the chosen time of day.
// Returns true when it handled the input (so it is not also sent to chat).
const MOON_PRESETS: Record<string, number> = {
  new: 0,
  crescent: 0.125,
  half: 0.25,
  quarter: 0.25,
  gibbous: 0.375,
  full: 0.5,
};
const DAY_NIGHT_PRESETS: Record<string, number> = {
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
export function tryDayNightDevCommand(raw: string, hud: DayNightDevHud): boolean {
  const m = raw.trim().match(/^\/(?:dev\s+time|dev\s+daynight|daynight)\b\s*(.*)$/i);
  if (!m) return false;
  // Dev builds only: a per-client phase override is brighter-night-for-me,
  // exactly the actionable-visibility class the graphics-fairness rule bans.
  // Harmless while DAY_ONLY pins day, but gate it before that ever flips.
  if (!import.meta.env.DEV) return false;
  const arg = m[1].trim().toLowerCase();
  if (!arg) {
    hud.log('[dev] usage: /daynight night|dawn|day|dusk|<0..1>|auto', '#ffcf6a');
    hud.log('[dev]        /daynight moon new|crescent|half|full|<0..1>|auto', '#ffcf6a');
    return true;
  }
  const moonArg = arg.match(/^moon\s*(.*)$/);
  if (moonArg) {
    const moonWord = moonArg[1].trim();
    if (!moonWord || ['auto', 'off', 'real', 'resume', 'clear'].includes(moonWord)) {
      setLunarPhaseOverride(null);
      hud.log('[dev] moon resumed (real lunar clock)', '#8fd0ff');
      return true;
    }
    let moonPhase: number | null = moonWord in MOON_PRESETS ? MOON_PRESETS[moonWord] : null;
    if (moonPhase === null) {
      const n = Number.parseFloat(moonWord);
      if (Number.isFinite(n)) moonPhase = ((n % 1) + 1) % 1;
    }
    if (moonPhase === null) {
      hud.log(
        `[dev] unknown moon "${moonWord}" - try new|crescent|half|full|<0..1>|auto`,
        '#ffcf6a',
      );
      return true;
    }
    setLunarPhaseOverride(moonPhase);
    hud.log(`[dev] moon set to ${moonWord} (lunar phase ${moonPhase.toFixed(2)})`, '#8fd0ff');
    return true;
  }
  if (['auto', 'off', 'real', 'resume', 'clear'].includes(arg)) {
    setDayNightPhaseOverride(null);
    hud.log('[dev] day/night resumed (real UTC clock)', '#8fd0ff');
    hud.refreshDayNightDial();
    return true;
  }
  let phase: number | null = arg in DAY_NIGHT_PRESETS ? DAY_NIGHT_PRESETS[arg] : null;
  if (phase === null) {
    const n = Number.parseFloat(arg);
    if (Number.isFinite(n)) phase = ((n % 1) + 1) % 1;
  }
  if (phase === null) {
    hud.log(`[dev] unknown time "${arg}" - try night|dawn|day|dusk|<0..1>|auto`, '#ffcf6a');
    return true;
  }
  setDayNightPhaseOverride(phase);
  hud.log(`[dev] time of day set to ${arg} (phase ${phase.toFixed(2)})`, '#8fd0ff');
  hud.refreshDayNightDial();
  return true;
}
