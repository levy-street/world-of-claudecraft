// Dev-build chat command that scrubs the world day/night cycle and lunar
// phase (extracted from the main.ts chat send path; main.ts is a firewall,
// not a home). See the usage lines below for the accepted forms.
import {
  dayNightPhaseOverride,
  setDayNightPhaseOverride,
  setLunarPhaseOverride,
} from '../render/day_night_clock';
import { phaseToCycleMs } from '../sim/day_night';
import { parseServerTimeCommand } from '../sim/dev/day_night_override';

/**
 * The UTC-anchored millisecond clock the OFFLINE sim's day/night cycle reads, honoring
 * the dev override: with no override it is the same Date.now the renderer's sky uses,
 * and under `/daynight <phase>` it is a synthesized instant inside the first cycle with
 * exactly that phase, so the sim's night is the sky's night either way. It lives beside
 * the override it reads, which is what keeps the scrub honest: scrubbing to night puts
 * the world boss to bed on screen rather than only repainting the sky above him.
 */
export function offlineDayNightNowMs(): number {
  const override = dayNightPhaseOverride();
  return override === null ? Date.now() : phaseToCycleMs(override);
}

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
 * OFFLINE `/dev servertime <arg>`: the offline sim's clock IS the sky's override
 * (offlineDayNightNowMs above), so there is one clock and this sets it, exactly as
 * /daynight does. Left to the sim, the command would wrap the offline clock in a fixed
 * offset that any later /daynight then shifted (the offset was anchored to the old
 * reading), landing a /daynight night on DAY and leaving Old Thatchgrin on his pole under
 * a midnight sky. Online the line is not touched here: it goes to the server, whose clock
 * the sky does not share. Returns true when it consumed the line.
 */
function tryOfflineServerTime(raw: string, hud: DayNightDevHud): boolean {
  const cmd = parseServerTimeCommand(raw.trim());
  if (cmd === null) return false;
  if (cmd === 'usage') {
    hud.log('[dev] usage: /dev servertime day|night|dawn|dusk|<0..1>|auto', '#ffcf6a');
    return true;
  }
  if (cmd.kind === 'auto') {
    setDayNightPhaseOverride(null);
    hud.log('[dev] offline world clock and sky back on real time', '#8fd0ff');
  } else {
    setDayNightPhaseOverride(cmd.phase);
    hud.log(
      `[dev] offline world clock and sky set to ${cmd.label} (phase ${cmd.phase.toFixed(2)}); /daynight moves the same clock`,
      '#8fd0ff',
    );
  }
  hud.refreshDayNightDial();
  return true;
}

export function tryDayNightDevCommand(
  raw: string,
  hud: DayNightDevHud,
  devCommandsAvailable = import.meta.env.DEV,
  offline = false,
): boolean {
  // Dev builds or realms advertising ALLOW_DEV_COMMANDS=1 (dev/PBE) only: a
  // per-client phase override is brighter-night-for-me, which is banned on
  // production realms where devCommandsAvailable is false.
  if (!import.meta.env.DEV && !devCommandsAvailable) return false;
  if (offline && tryOfflineServerTime(raw, hud)) return true;
  const m = raw.trim().match(/^\/(?:dev\s+time|dev\s+daynight|daynight)\b\s*(.*)$/i);
  if (!m) return false;
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
    const moonPhase = parsePhaseArg(moonWord, MOON_PRESETS);
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
  const phase = parsePhaseArg(arg, DAY_NIGHT_PRESETS);
  if (phase === null) {
    hud.log(`[dev] unknown time "${arg}" - try night|dawn|day|dusk|<0..1>|auto`, '#ffcf6a');
    return true;
  }
  setDayNightPhaseOverride(phase);
  hud.log(`[dev] time of day set to ${arg} (phase ${phase.toFixed(2)})`, '#8fd0ff');
  hud.refreshDayNightDial();
  return true;
}
