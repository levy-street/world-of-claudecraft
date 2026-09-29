import { TURRET_TIMING } from '../../../sim/content/turret_defense';
import type { TurretEvent } from '../../../sim/minigames/turret_defense';
import { TICK_RATE } from '../../../sim/types';
import type { TurretSessionView } from '../../../world_api/vehicles';
import { formatNumber, getI18nRevision, t } from '../../i18n';
import { TurretFeedbackReader } from './turret_feedback_reader_core';

/** Below this share of the bar, the rail turns to its danger colour. */
const LOW_INTEGRITY = 0.25;
/** The integrity shares the live region speaks when crossed, in the order they fall. */
export const TURRET_INTEGRITY_ALERTS = [0.5, LOW_INTEGRITY] as const;

/** The result card's stat rows: kills, shots, accuracy, longest throw, longest airtime, tower. */
export const TURRET_RESULT_ROWS = 6;

export interface TurretStatRow {
  label: string;
  value: string;
}

export interface TurretHudResult {
  won: boolean;
  verdict: string;
  /** TURRET_RESULT_ROWS rows, in the order the card lists them. */
  readonly rows: readonly TurretStatRow[];
}

/** The seat's fixed words, resolved with the frame so a language change reaches them. */
export interface TurretHudLabels {
  /** The strip's accessible name and the result card's header. */
  title: string;
  /** The integrity rail's accessible name. */
  meter: string;
  /** The integrity rail's visible caption. */
  caption: string;
  /** Leave's accessible name and tooltip, and its label on the result card. */
  leave: string;
  /** Leave's label on the strip. */
  leaveShort: string;
}

export interface TurretHudFrame {
  labels: TurretHudLabels;
  wave: string;
  /** The strip's middle slot: the monsters left in a wave, else the countdown; empty at the end. */
  slot: string;
  /** 0 to 1 of TURRET_TIMING.integrity. */
  integrity: number;
  /** `integrity` for the fill's CSS variable. */
  integrityFill: string;
  /** The points left, for the meter's aria-valuenow. */
  integrityNow: string;
  integrityText: string;
  low: boolean;
  /**
   * The polite live region's line: a phase start (countdown, wave, result) or an integrity
   * alert. It changes only on those moments, never on a kill.
   */
  announce: string;
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

function countdownLine(session: TurretSessionView, seconds: number | null): string {
  if (seconds === null) return '';
  const values = { seconds: formatNumber(seconds) };
  const key =
    session.defense.phase === 'intro' ? 'hudChrome.turret.firstWave' : 'hudChrome.turret.nextWave';
  return t(key, values);
}

function waveBannerText(wave: number, waveCount: number): string {
  return t('hudChrome.turret.waveBanner', {
    wave: formatNumber(wave + 1),
    total: formatNumber(waveCount),
  });
}

function verdictText(won: boolean): string {
  return t(won ? 'hudChrome.turret.victory' : 'hudChrome.turret.defeat');
}

/** What the live region says as a phase starts: its countdown, its wave, or the result. */
function phaseAnnouncement(session: TurretSessionView, seconds: number | null): string {
  const { phase, wave } = session.defense;
  if (phase === 'wave') return waveBannerText(wave, session.waveCount);
  if (phase === 'won' || phase === 'lost') return verdictText(phase === 'won');
  return countdownLine(session, seconds);
}

/** How many integrity alerts `share` has crossed. */
function integrityBand(share: number): number {
  let band = 0;
  for (const alert of TURRET_INTEGRITY_ALERTS) if (share < alert) band++;
  return band;
}

function fillResultRows(rows: TurretStatRow[], session: TurretSessionView, tower: string): void {
  const stats = session.defense.stats;
  const accuracy = stats.shots > 0 ? stats.hits / stats.shots : 0;
  rows[0].label = t('hudChrome.turret.statKills');
  rows[0].value = formatNumber(stats.kills);
  rows[1].label = t('hudChrome.turret.statShots');
  rows[1].value = formatNumber(stats.shots);
  rows[2].label = t('hudChrome.turret.statAccuracy');
  rows[2].value = formatNumber(accuracy, { style: 'percent', maximumFractionDigits: 0 });
  rows[3].label = t('hudChrome.turret.statThrow');
  rows[3].value = t('hudChrome.turret.statYards', {
    yards: formatNumber(stats.longestThrow, { maximumFractionDigits: 1 }),
  });
  rows[4].label = t('hudChrome.turret.statAirtime');
  rows[4].value = t('hudChrome.turret.statSeconds', {
    seconds: formatNumber(stats.longestAirtime, { maximumFractionDigits: 1 }),
  });
  rows[5].label = t('hudChrome.turret.tower');
  rows[5].value = tower;
}

/**
 * The seat's HUD text in one reused frame, rebuilt only when the session view, the
 * shown countdown second or the language changes (the view is identical between
 * reads until the sim changes it).
 */
export class TurretHudView {
  private readonly rows: TurretStatRow[] = Array.from({ length: TURRET_RESULT_ROWS }, () => ({
    label: '',
    value: '',
  }));
  private readonly result: TurretHudResult = { won: false, verdict: '', rows: this.rows };
  private readonly frame: TurretHudFrame = {
    labels: { title: '', meter: '', caption: '', leave: '', leaveShort: '' },
    wave: '',
    slot: '',
    integrity: 1,
    integrityFill: '1',
    integrityNow: String(TURRET_TIMING.integrity),
    integrityText: '',
    low: false,
    announce: '',
    result: null,
  };
  private lastSession: TurretSessionView | null = null;
  private lastSeconds: number | null = null;
  private lastLanguage = -1;
  /** The phase and wave the live region last spoke for; a change is a phase start. */
  private lastPhase = '';
  private lastWave = -1;
  /** The integrity alerts crossed so far in the current phase. */
  private lastBand = 0;
  /** What the live region currently says: an integrity alert (a band), else the phase start. */
  private spokenBand = 0;
  private spokenSeconds: number | null = null;

  /** Forget the seat: the next read rebuilds, and its phase is announced as new. */
  reset(): void {
    this.lastSession = null;
    this.lastPhase = '';
    this.lastWave = -1;
    this.lastBand = 0;
    this.spokenBand = 0;
    this.spokenSeconds = null;
  }

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
    const ended = defense.phase === 'won' || defense.phase === 'lost';
    const labels = frame.labels;
    labels.title = t('hudChrome.turret.title');
    labels.meter = t('hudChrome.turret.integrity');
    labels.caption = t('hudChrome.turret.tower');
    labels.leave = t('hudChrome.turret.leave');
    labels.leaveShort = t('hudChrome.turret.leaveShort');
    frame.wave = t('hudChrome.turret.wave', {
      wave: formatNumber(Math.min(defense.wave + 1, session.waveCount)),
      total: formatNumber(session.waveCount),
    });
    frame.slot =
      defense.phase === 'wave'
        ? t('hudChrome.turret.left', { count: formatNumber(session.monstersLeft) })
        : ended
          ? ''
          : countdownLine(session, seconds);
    frame.integrity = value / max;
    frame.integrityFill = String(frame.integrity);
    frame.integrityNow = String(value);
    frame.integrityText = t('hudChrome.turret.integrityValue', {
      value: formatNumber(value),
      max: formatNumber(max),
    });
    frame.low = frame.integrity < LOW_INTEGRITY;
    this.updateAnnouncement(session, seconds, integrityBand(frame.integrity));
    if (ended) {
      const result = this.result;
      result.won = defense.phase === 'won';
      result.verdict = verdictText(result.won);
      fillResultRows(this.rows, session, frame.integrityText);
      frame.result = result;
    } else {
      frame.result = null;
    }
    return frame;
  }

  private updateAnnouncement(session: TurretSessionView, seconds: number | null, band: number) {
    const { phase, wave } = session.defense;
    if (phase !== this.lastPhase || wave !== this.lastWave) {
      this.lastPhase = phase;
      this.lastWave = wave;
      this.lastBand = band;
      this.spokenBand = 0;
      this.spokenSeconds = seconds;
    } else if (band > this.lastBand) {
      this.lastBand = band;
      this.spokenBand = band;
    }
    this.frame.announce =
      this.spokenBand > 0
        ? t('hudChrome.turret.integrityBelow', {
            percent: formatNumber(TURRET_INTEGRITY_ALERTS[this.spokenBand - 1], {
              style: 'percent',
            }),
          })
        : phaseAnnouncement(session, this.spokenSeconds);
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
    const banner: TurretBanner = { text: waveBannerText(event.wave, waveCount) };
    if (event.wave + 1 === waveCount) banner.subtext = t('hudChrome.turret.finalWave');
    else if (event.wave === 0) banner.subtext = t('hudChrome.turret.hint');
    return banner;
  }
  if (event.type === 'waveCleared')
    return { text: t('hudChrome.turret.clearedBanner', { wave: formatNumber(event.wave + 1) }) };
  if (event.type === 'ended') return { text: verdictText(event.result === 'won') };
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
