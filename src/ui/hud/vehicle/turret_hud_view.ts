import { TURRET_TIMING } from '../../../sim/content/turret_defense';
import type { TurretEvent } from '../../../sim/minigames/turret_defense';
import { turretChargesGiven } from '../../../sim/minigames/turret_defense_plan';
import { TURRET_POINTS, type TurretMedal } from '../../../sim/minigames/turret_result';
import { TICK_RATE } from '../../../sim/types';
import type { TurretSessionView } from '../../../world_api/vehicles';
import { fireAndFlyTrialName, isFireAndFlyMission } from '../../fire_and_fly_trial_view';
import { formatNumber, getI18nRevision, type TranslationKey, t } from '../../i18n';
import {
  type TurretWeaponKeys,
  turretFirstWaveHint,
  turretResupplyLine,
} from './turret_arsenal_banner';
import { TurretFeedbackReader } from './turret_feedback_reader_core';

/** Below this share of the bar, the rail turns to its danger colour. */
const LOW_INTEGRITY = 0.25;
/** The integrity shares the live region speaks when crossed, in the order they fall. */
export const TURRET_INTEGRITY_ALERTS = [0.5, LOW_INTEGRITY] as const;

/**
 * The result card's stat rows: kills, shots, accuracy, longest throw, longest airtime, the
 * Shockwaves and the fragmentation shells used of those given, tower. A weapon the trial
 * gives no charge of leaves its row blank (the painter hides it).
 */
export const TURRET_RESULT_ROWS = 8;
/**
 * The result card's points rows: kills, tower kept, keg kills, bowled over, the charges a
 * mission kept (blank on a trial: the painter hides it), then the total.
 */
export const TURRET_POINT_ROWS = 6;
/** The result card counts down the seat's own leave over its last this many seconds. */
export const TURRET_LEAVING_COUNTDOWN_SECONDS = 30;

export type { TurretWeaponKeys } from './turret_arsenal_banner';

const MEDAL_KEYS = {
  gold: 'hudChrome.turret.medalGold',
  silver: 'hudChrome.turret.medalSilver',
  bronze: 'hudChrome.turret.medalBronze',
} as const satisfies Record<TurretMedal, TranslationKey>;

export interface TurretStatRow {
  label: string;
  value: string;
}

export interface TurretHudResult {
  won: boolean;
  verdict: string;
  /** False while the view has no scored result (the medal line and points stay hidden). */
  scored: boolean;
  /** The medal earned, null for none: it only tints the line `medalText` names. */
  medal: TurretMedal | null;
  medalText: string;
  /** TURRET_RESULT_ROWS rows, in the order the card lists them. */
  readonly rows: readonly TurretStatRow[];
  /** TURRET_POINT_ROWS rows, in the order the card lists them. */
  readonly pointRows: readonly TurretStatRow[];
  /** The seat's own leave counting down, empty until its last half minute. */
  leaving: string;
}

/** The seat's fixed words, resolved with the frame so a language change reaches them. */
export interface TurretHudLabels {
  /** The strip's accessible name. */
  title: string;
  /** The result card's kicker: the trial's name, the title for a scenario without one. */
  trial: string;
  /** The integrity rail's accessible name. */
  meter: string;
  /** The integrity rail's visible caption. */
  caption: string;
  /** Leave's accessible name and tooltip, and its label on the result card. */
  leave: string;
  /** Leave's label on the strip. */
  leaveShort: string;
  /** Replay's label on the result card. */
  replay: string;
  /** Replay's tooltip: what the button does. */
  replayHint: string;
}

export interface TurretHudFrame {
  labels: TurretHudLabels;
  wave: string;
  /** The strip's middle slot: the monsters left in a wave, else the countdown; empty at the end. */
  slot: string;
  /** 0 to 1 of the plan's integrity. */
  integrity: number;
  /** `integrity` for the fill's CSS variable. */
  integrityFill: string;
  /** The points left, for the meter's aria-valuenow. */
  integrityNow: string;
  /** The plan's integrity (the scenario's tower points), for the meter's aria-valuemax. */
  integrityMax: string;
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

/**
 * Whole seconds left in a counted phase: the intro, the pause between waves, and an
 * ended run's last half minute before the seat leaves on its own. Null outside one or
 * without a clock to count from.
 */
function countdownSeconds(session: TurretSessionView, clock: number | null): number | null {
  const { phase, phaseEndTick } = session.defense;
  if (clock === null) return null;
  const secondsTo = (tick: number) => Math.max(0, Math.ceil((tick - clock) / TICK_RATE));
  if (phase === 'intro' || phase === 'between') return secondsTo(phaseEndTick);
  if (phase !== 'won' && phase !== 'lost') return null;
  const seconds = secondsTo(phaseEndTick + TURRET_TIMING.endedSeatTicks);
  return seconds <= TURRET_LEAVING_COUNTDOWN_SECONDS ? seconds : null;
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

/** The end of a run as the live region says it: the verdict, then any medal won. */
function endAnnouncement(session: TurretSessionView): string {
  const verdict = verdictText(session.defense.phase === 'won');
  const medal = session.defense.result?.medal;
  if (!medal) return verdict;
  return t('hudChrome.turret.endAnnouncement', { verdict, medal: t(MEDAL_KEYS[medal]) });
}

/** What the live region says as a phase starts: its countdown, its wave, or the result. */
function phaseAnnouncement(session: TurretSessionView, seconds: number | null): string {
  const { phase, wave } = session.defense;
  if (phase === 'wave') return waveBannerText(wave, session.waveCount);
  if (phase === 'won' || phase === 'lost') return endAnnouncement(session);
  return countdownLine(session, seconds);
}

/** How many integrity alerts `share` has crossed. */
function integrityBand(share: number): number {
  let band = 0;
  for (const alert of TURRET_INTEGRITY_ALERTS) if (share < alert) band++;
  return band;
}

/**
 * A weapon's "used / given" row (given counts the resupplies so far); blank when the
 * scenario gives none of it.
 */
function fillWeaponRow(row: TurretStatRow, label: string, used: number, given: number): void {
  row.label = given > 0 ? label : '';
  row.value =
    given > 0
      ? t('hudChrome.turret.statUsed', { used: formatNumber(used), given: formatNumber(given) })
      : '';
}

function fillResultRows(rows: TurretStatRow[], session: TurretSessionView, tower: string): void {
  const stats = session.defense.stats;
  const given = turretChargesGiven(session.defense.plan, stats.resupplies);
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
  fillWeaponRow(rows[5], t('hudChrome.turret.statShockwaves'), stats.shockwaves, given.shockwave);
  fillWeaponRow(rows[6], t('hudChrome.turret.statFrags'), stats.frags, given.fragmentation);
  rows[7].label = t('hudChrome.turret.tower');
  rows[7].value = tower;
}

const SIGNED_POINTS: Intl.NumberFormatOptions = { signDisplay: 'exceptZero' };

/** A term's points as an addition: a sign on any nonzero value, never a hand-built '+'. */
function addedPoints(points: number): string {
  return formatNumber(points, SIGNED_POINTS);
}

/**
 * The medal line and the points rows from the sim's result, each row naming what it
 * counts (the kills, the tower points kept); false when there is no result.
 */
function fillPoints(
  result: TurretHudResult,
  rows: TurretStatRow[],
  session: TurretSessionView,
  kept: number,
): boolean {
  const scored = session.defense.result;
  if (!scored) {
    result.medal = null;
    result.medalText = '';
    for (const row of rows) {
      row.label = '';
      row.value = '';
    }
    return false;
  }
  const { stats } = session.defense;
  const { breakdown } = scored;
  result.medal = scored.medal;
  result.medalText = t(scored.medal ? MEDAL_KEYS[scored.medal] : 'hudChrome.turret.noMedal');
  rows[0].label = t('hudChrome.turret.pointsKills', { count: formatNumber(stats.kills) });
  rows[0].value = addedPoints(breakdown.kills);
  rows[1].label = t('hudChrome.turret.pointsTower', { points: formatNumber(kept) });
  rows[1].value = addedPoints(breakdown.integrity);
  rows[2].label = t('hudChrome.turret.pointsKegKills', { count: formatNumber(stats.barrelKills) });
  rows[2].value = addedPoints(breakdown.kegKills);
  rows[3].label = t('hudChrome.turret.pointsBowled', { count: formatNumber(stats.bowled) });
  rows[3].value = addedPoints(breakdown.bowled);
  const bonus = session.defense.plan.chargeBonus && scored.won;
  const charges = breakdown.charges / TURRET_POINTS.unusedCharge;
  rows[4].label = bonus
    ? t('hudChrome.turretArsenal.pointsCharges', { count: formatNumber(charges) })
    : '';
  rows[4].value = bonus ? addedPoints(breakdown.charges) : '';
  rows[5].label = t('hudChrome.turret.pointsTotal');
  rows[5].value = formatNumber(scored.points);
  return true;
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
  private readonly pointRows: TurretStatRow[] = Array.from({ length: TURRET_POINT_ROWS }, () => ({
    label: '',
    value: '',
  }));
  private readonly result: TurretHudResult = {
    won: false,
    verdict: '',
    scored: false,
    medal: null,
    medalText: '',
    rows: this.rows,
    pointRows: this.pointRows,
    leaving: '',
  };
  private readonly frame: TurretHudFrame = {
    labels: {
      title: '',
      trial: '',
      meter: '',
      caption: '',
      leave: '',
      leaveShort: '',
      replay: '',
      replayHint: '',
    },
    wave: '',
    slot: '',
    integrity: 1,
    integrityFill: '1',
    integrityNow: '',
    integrityMax: '',
    integrityText: '',
    low: false,
    announce: '',
    result: null,
  };
  private lastSession: TurretSessionView | null = null;
  private lastSeconds: number | null = null;
  private lastLanguage = -1;
  /** The fixed labels change only with the language or the trial, not per session revision. */
  private labelLanguage = -1;
  private labelScenario = '';
  /** The phase and wave the live region last spoke for; a change is a phase start. */
  private lastPhase = '';
  private lastWave = -1;
  /** The integrity alerts crossed so far in the current phase. */
  private lastBand = 0;
  /** What the live region currently says: an integrity alert (a band), else the phase start. */
  private spokenBand = 0;
  private spokenSeconds: number | null = null;
  /** The leave countdown's first second, spoken once as it appears on an ended seat. */
  private spokenLeaving: number | null = null;

  /** Forget the seat: the next read rebuilds, and its phase is announced as new. */
  reset(): void {
    this.lastSession = null;
    this.lastPhase = '';
    this.lastWave = -1;
    this.lastBand = 0;
    this.spokenBand = 0;
    this.spokenSeconds = null;
    this.spokenLeaving = null;
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
    const max = defense.plan.integrity;
    const value = Math.max(0, Math.min(max, defense.integrity));
    const ended = defense.phase === 'won' || defense.phase === 'lost';
    const scenarioId = defense.plan.scenarioId;
    if (language !== this.labelLanguage || scenarioId !== this.labelScenario) {
      this.labelLanguage = language;
      this.labelScenario = scenarioId;
      const labels = frame.labels;
      labels.title = t('hudChrome.turret.title');
      labels.trial = fireAndFlyTrialName(scenarioId) ?? labels.title;
      labels.meter = t('hudChrome.turret.integrity');
      labels.caption = t('hudChrome.turret.tower');
      labels.leave = t('hudChrome.turret.leave');
      labels.leaveShort = t('hudChrome.turret.leaveShort');
      labels.replay = t('hudChrome.turret.replay');
      labels.replayHint = t(
        isFireAndFlyMission(scenarioId)
          ? 'hudChrome.turret.replayHintMission'
          : 'hudChrome.turret.replayHint',
      );
    }
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
    frame.integrityMax = String(max);
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
      result.scored = fillPoints(result, this.pointRows, session, value);
      result.leaving =
        seconds === null ? '' : t('hudChrome.turret.leavingIn', { seconds: formatNumber(seconds) });
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
      this.spokenLeaving = null;
    } else if (band > this.lastBand) {
      this.lastBand = band;
      this.spokenBand = band;
    }
    const ended = phase === 'won' || phase === 'lost';
    if (ended && seconds !== null && this.spokenLeaving === null) this.spokenLeaving = seconds;
    this.frame.announce =
      this.spokenBand > 0
        ? t('hudChrome.turret.integrityBelow', {
            percent: formatNumber(TURRET_INTEGRITY_ALERTS[this.spokenBand - 1], {
              style: 'percent',
            }),
          })
        : this.spokenLeaving !== null
          ? t('hudChrome.turret.leavingIn', { seconds: formatNumber(this.spokenLeaving) })
          : phaseAnnouncement(session, this.spokenSeconds);
  }
}

// A later-ranked event wins a batch: the end outranks the last wave's clear it lands with,
// and a resupply (after its clear) carries the clear's line with its own beneath.
const BANNER_RANK: Partial<Record<TurretEvent['type'], number>> = {
  waveCleared: 1,
  resupply: 1,
  waveStart: 2,
  ended: 3,
};

function bannerFor(
  event: TurretEvent,
  session: TurretSessionView,
  keys: (() => TurretWeaponKeys | null) | undefined,
): TurretBanner | null {
  const waveCount = session.waveCount;
  if (event.type === 'waveStart') {
    const banner: TurretBanner = { text: waveBannerText(event.wave, waveCount) };
    if (event.wave + 1 === waveCount) banner.subtext = t('hudChrome.turret.finalWave');
    else if (event.wave === 0) banner.subtext = turretFirstWaveHint(session.defense.plan, keys);
    return banner;
  }
  if (event.type === 'waveCleared')
    return { text: t('hudChrome.turret.clearedBanner', { wave: formatNumber(event.wave + 1) }) };
  if (event.type === 'resupply') {
    return {
      text: t('hudChrome.turret.clearedBanner', { wave: formatNumber(event.wave + 1) }),
      subtext: turretResupplyLine(event),
    };
  }
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
  /**
   * `keys` names the weapons' keys for the first wave's banner (null on touch), asked
   * only when it shows; without it the banner states the goal alone.
   */
  consume(
    session: TurretSessionView | null,
    keys?: () => TurretWeaponKeys | null,
  ): TurretBanner | null {
    if (!session) return null;
    let banner: TurretBanner | null = null;
    let rank = 0;
    let resupply: Extract<TurretEvent, { type: 'resupply' }> | null = null;
    for (const entry of this.reader.read(session)) {
      if (entry.event.type === 'resupply') resupply = entry.event;
      const entryRank = BANNER_RANK[entry.event.type] ?? 0;
      if (entryRank === 0 || entryRank < rank) continue;
      banner = bannerFor(entry.event, session, keys);
      rank = entryRank;
    }
    // A mission's overlapping wave sets off on its resupply's tick, with no clear between.
    if (banner && resupply && rank === BANNER_RANK.waveStart && !banner.subtext)
      banner.subtext = turretResupplyLine(resupply);
    return banner;
  }
}
