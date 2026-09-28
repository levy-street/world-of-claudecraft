import { TURRET_TIMING } from '../../../sim/content/turret_defense';
import type { TurretEvent } from '../../../sim/minigames/turret_defense';
import { TICK_RATE } from '../../../sim/types';
import type { TurretSessionView } from '../../../world_api/vehicles';
import { formatNumber, getI18nRevision, t } from '../../i18n';
import { TurretFeedbackReader } from './turret_feedback_reader_core';

/** Below this share of the bar, the gauge turns to its danger colour. */
const LOW_INTEGRITY = 0.25;

/** The result panel's stat rows: kills, shots, accuracy, longest throw, longest airtime. */
export const TURRET_RESULT_LINES = 5;

export interface TurretHudResult {
  won: boolean;
  title: string;
  /** TURRET_RESULT_LINES rows, in the order the panel lists them. */
  readonly lines: string[];
}

export interface TurretHudFrame {
  wave: string;
  /** Empty outside a wave (nothing is left to count). */
  left: string;
  phase: string;
  /** 0 to 1 of TURRET_TIMING.integrity. */
  integrity: number;
  /** `integrity` for the fill's CSS variable. */
  integrityFill: string;
  /** The points left, for the meter's aria-valuenow. */
  integrityNow: string;
  integrityText: string;
  low: boolean;
  /** Set once the session ended. */
  result: TurretHudResult | null;
}

export interface TurretBanner {
  text: string;
  subtext?: string;
}

/** Whole seconds left in a counted phase; null outside one or without a clock to count from. */
function countdownSeconds(session: TurretSessionView, clock: number | null): number | null {
  const { phase, phaseEndTick } = session.defense;
  if (clock === null || (phase !== 'intro' && phase !== 'between')) return null;
  return Math.max(0, Math.ceil((phaseEndTick - clock) / TICK_RATE));
}

function phaseLine(session: TurretSessionView, seconds: number | null): string {
  const phase = session.defense.phase;
  if (phase === 'wave') return t('hudChrome.turret.hint');
  if (seconds === null) return '';
  const values = { seconds: formatNumber(seconds) };
  return t(phase === 'intro' ? 'hudChrome.turret.firstWave' : 'hudChrome.turret.nextWave', values);
}

function fillResultLines(lines: string[], session: TurretSessionView): void {
  const stats = session.defense.stats;
  const accuracy = stats.shots > 0 ? stats.hits / stats.shots : 0;
  lines[0] = t('hudChrome.turret.statKills', { count: formatNumber(stats.kills) });
  lines[1] = t('hudChrome.turret.statShots', { count: formatNumber(stats.shots) });
  lines[2] = t('hudChrome.turret.statAccuracy', {
    value: formatNumber(accuracy, { style: 'percent', maximumFractionDigits: 0 }),
  });
  lines[3] = t('hudChrome.turret.statThrow', {
    yards: formatNumber(stats.longestThrow, { maximumFractionDigits: 1 }),
  });
  lines[4] = t('hudChrome.turret.statAirtime', {
    seconds: formatNumber(stats.longestAirtime, { maximumFractionDigits: 1 }),
  });
}

/**
 * The seat's HUD text in one reused frame, rebuilt only when the session view, the
 * shown countdown second or the language changes (the view is identical between
 * reads until the sim changes it).
 */
export class TurretHudView {
  private readonly result: TurretHudResult = {
    won: false,
    title: '',
    lines: Array.from({ length: TURRET_RESULT_LINES }, () => ''),
  };
  private readonly frame: TurretHudFrame = {
    wave: '',
    left: '',
    phase: '',
    integrity: 1,
    integrityFill: '1',
    integrityNow: String(TURRET_TIMING.integrity),
    integrityText: '',
    low: false,
    result: null,
  };
  private lastSession: TurretSessionView | null = null;
  private lastSeconds: number | null = null;
  private lastLanguage = -1;

  tick(session: TurretSessionView, clock: number | null): TurretHudFrame {
    const frame = this.frame;
    const seconds = countdownSeconds(session, clock);
    const language = getI18nRevision();
    if (
      session === this.lastSession &&
      seconds === this.lastSeconds &&
      language === this.lastLanguage
    )
      return frame;
    this.lastSession = session;
    this.lastSeconds = seconds;
    this.lastLanguage = language;
    const defense = session.defense;
    const max = TURRET_TIMING.integrity;
    const value = Math.max(0, Math.min(max, defense.integrity));
    frame.wave = t('hudChrome.turret.wave', {
      wave: formatNumber(Math.min(defense.wave + 1, session.waveCount)),
      total: formatNumber(session.waveCount),
    });
    frame.left =
      defense.phase === 'wave'
        ? t('hudChrome.turret.left', { count: formatNumber(session.monstersLeft) })
        : '';
    frame.phase = phaseLine(session, seconds);
    frame.integrity = value / max;
    frame.integrityFill = String(frame.integrity);
    frame.integrityNow = String(value);
    frame.integrityText = t('hudChrome.turret.integrityValue', {
      value: formatNumber(value),
      max: formatNumber(max),
    });
    frame.low = frame.integrity < LOW_INTEGRITY;
    const won = defense.phase === 'won';
    if (won || defense.phase === 'lost') {
      const result = this.result;
      result.won = won;
      result.title = t(won ? 'hudChrome.turret.victory' : 'hudChrome.turret.defeat');
      fillResultLines(result.lines, session);
      frame.result = result;
    } else {
      frame.result = null;
    }
    return frame;
  }
}

// A later-ranked event wins a batch: the end outranks the last wave's clear it lands with.
const BANNER_RANK: Partial<Record<TurretEvent['type'], number>> = {
  waveCleared: 1,
  waveStart: 2,
  ended: 3,
};

function bannerFor(event: TurretEvent, waveCount: number): TurretBanner | null {
  if (event.type === 'waveStart') {
    const banner: TurretBanner = {
      text: t('hudChrome.turret.waveBanner', {
        wave: formatNumber(event.wave + 1),
        total: formatNumber(waveCount),
      }),
    };
    if (event.wave + 1 === waveCount) banner.subtext = t('hudChrome.turret.finalWave');
    return banner;
  }
  if (event.type === 'waveCleared')
    return { text: t('hudChrome.turret.clearedBanner', { wave: formatNumber(event.wave + 1) }) };
  if (event.type === 'ended')
    return {
      text: t(event.result === 'won' ? 'hudChrome.turret.victory' : 'hudChrome.turret.defeat'),
    };
  return null;
}

/**
 * Reads the seat's feedback ring once per entry (TurretFeedbackReader), and one batch
 * yields at most one banner. A missing view keeps the reader's place, so the same
 * seat seen again never replays a banner.
 */
export class TurretFeedbackCursor {
  private readonly reader = new TurretFeedbackReader();
  consume(session: TurretSessionView | null): TurretBanner | null {
    if (!session) return null;
    let banner: TurretBanner | null = null;
    let rank = 0;
    for (const entry of this.reader.read(session)) {
      const entryRank = BANNER_RANK[entry.event.type] ?? 0;
      if (entryRank === 0 || entryRank < rank) continue;
      banner = bannerFor(entry.event, session.waveCount);
      rank = entryRank;
    }
    return banner;
  }
}
