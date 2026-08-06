// Pure, host-agnostic copy model for the two across-screen Thornhollow Fields
// CALLS that are not flag plays: the match-end verdict and the remaining-time
// warnings. Both ride the same banner family as the flag announcements; what
// lives here is only the decision of WHICH strings that banner and its durable
// combat-log twins carry.
//
// The `src/ui/honor_float_view.ts` shape exactly: DOM-free, allocation-light,
// and the i18n runtime is the only import (the key/label selection a registered
// UI pure core is allowed), so `Hud.handleEvents` resolves the copy here and
// hands it straight to the banner and the log. That keeps the whole decision
// unit-testable without a DOM, a Sim, or a painter, and keeps it OUT of the
// hud.ts coordinator, which owns none of the state it needs.
//
// The verdict is deliberately ONE BIG WORD reusing the scoreboard's own
// `resultVictory` / `resultDefeat` / `resultDraw` keys: the finish surface and
// the frozen result strip must not name the same outcome two different ways.
// Everything else drops to its own secondary LINE, each its own `t()` key,
// because those facts (the score plus rating swing, why the match ended, the
// first-win bonus) are independent sentences: concatenating them would be the
// exact thing the i18n contract forbids, and a locale that orders them
// differently could not.

import { formatNumber, type TranslationKey, t } from '../../i18n';

/** The `bgEnd` fields this core reads. A structural subset of the SimEvent, so
 *  a Vitest can drive it without building a whole event union member. */
export interface BgEndBannerInput {
  won: boolean;
  draw: boolean;
  scoreCrimson: number;
  scoreAzure: number;
  ratingBefore: number;
  ratingAfter: number;
  /** The wire union `'caps' | 'timer' | 'forfeit'`, typed WIDE on purpose: it is
   *  a server value a newer deploy can widen, and this core degrades to no cause
   *  line rather than throwing on a key it has never heard of. */
  ended: string;
  /** The first-win-of-the-day Honor bonus this result paid, or 0. */
  firstWinBonus: number;
}

/** What a combat-log twin is ABOUT, so the caller picks the color. The core
 *  never names a color: that is the consumer's token to resolve.
 *
 *  The result line splits win-vs-not rather than win/loss/draw, preserving the
 *  pre-extraction behavior exactly: the coordinator coloured it `ev.won ? green
 *  : red`, so a DRAW has always taken the not-a-win colour. Kept rather than
 *  quietly improved, because this change is not about that. */
export type BgEndLogTone = 'resultWin' | 'resultNotWin' | 'cause' | 'bonus';

export interface BgEndLogLine {
  text: string;
  tone: BgEndLogTone;
}

export interface BgEndBannerView {
  /** The one big word: Victory! / Defeat / Draw, localized. */
  verdict: string;
  /** The secondary lines under it, in reading order, already localized. Never
   *  empty (the score and rating line is unconditional). */
  lines: string[];
  /** The durable combat-log record. Always leads with the result line. */
  logLines: BgEndLogLine[];
  /** Which one-shot audio cue the moment deserves, or null for a draw. */
  cue: 'victory' | 'defeat' | null;
}

/**
 * Why the match ended, as the banner's cause line. `caps` maps to null and that
 * is not an omission: a match played to the capture target needs no explanation
 * beyond the score line the banner already carries. Keyed by the literal union,
 * so a fourth cause red-fails `tsc` here rather than throwing at runtime through
 * a constructed key.
 */
export const BG_END_CAUSE_KEYS: Record<'caps' | 'timer' | 'forfeit', TranslationKey | null> = {
  caps: null,
  timer: 'hudChrome.bg.endedTimer',
  forfeit: 'hudChrome.bg.endedForfeit',
};

/** The durable combat-log twin of each cause line, same total-map contract. */
export const BG_END_CAUSE_LOG_KEYS: Record<'caps' | 'timer' | 'forfeit', TranslationKey | null> = {
  caps: null,
  timer: 'hudChrome.bg.endedTimerLog',
  forfeit: 'hudChrome.bg.endedForfeitLog',
};

/** The cause key for a wire value, or null when there is nothing to say (a caps
 *  finish) OR the value is off the vocabulary this build knows (a newer server). */
function causeKeyFor(
  map: Record<'caps' | 'timer' | 'forfeit', TranslationKey | null>,
  ended: string,
): TranslationKey | null {
  return map[ended as 'caps' | 'timer' | 'forfeit'] ?? null;
}

const num = (n: number): string => formatNumber(n, { maximumFractionDigits: 0 });

export function buildBgEndBannerView(ev: BgEndBannerInput): BgEndBannerView {
  const params = {
    crimson: num(ev.scoreCrimson),
    azure: num(ev.scoreAzure),
    rating: num(ev.ratingAfter),
    // The rating swing reads as a signed delta. The sign is Intl's
    // (signDisplay: 'always'), never a concatenated ASCII '+': a locale that
    // writes its own plus sign, or puts it after the digits, gets that instead
    // of a hardcoded prefix.
    delta: formatNumber(ev.ratingAfter - ev.ratingBefore, {
      maximumFractionDigits: 0,
      signDisplay: 'always',
    }),
  };
  const bonus = num(ev.firstWinBonus);
  const paidBonus = ev.firstWinBonus > 0;
  const causeKey = causeKeyFor(BG_END_CAUSE_KEYS, ev.ended);
  const causeLogKey = causeKeyFor(BG_END_CAUSE_LOG_KEYS, ev.ended);
  return {
    verdict: ev.draw
      ? t('hudChrome.bg.resultDraw')
      : ev.won
        ? t('hudChrome.bg.resultVictory')
        : t('hudChrome.bg.resultDefeat'),
    lines: [
      ...(causeKey ? [t(causeKey)] : []),
      t('hudChrome.bg.endBannerDetail', params),
      ...(paidBonus ? [t('hudChrome.bg.firstWinBonusLine', { honor: bonus })] : []),
    ],
    logLines: [
      { text: t('hudChrome.bg.endLog', params), tone: ev.won ? 'resultWin' : 'resultNotWin' },
      ...(causeLogKey ? [{ text: t(causeLogKey), tone: 'cause' as const }] : []),
      ...(paidBonus
        ? [{ text: t('hudChrome.bg.firstWinBonusLog', { honor: bonus }), tone: 'bonus' as const }]
        : []),
    ],
    cue: ev.draw ? null : ev.won ? 'victory' : 'defeat',
  };
}

export interface BgTimeWarningView {
  /** The across-screen call, localized. */
  banner: string;
  /** Its durable combat-log twin. */
  log: string;
}

/**
 * The remaining-time call for one BG_TIME_WARNINGS threshold. One minute gets
 * its OWN key rather than a "1 minutes" plural, and the minutes form divides on
 * whole minutes because every threshold is a whole number of them; the count
 * goes through `formatNumber` like every other player-visible number, so a
 * locale with its own digits gets those.
 */
export function buildBgTimeWarningView(secondsLeft: number): BgTimeWarningView {
  if (secondsLeft <= 60) {
    return {
      banner: t('hudChrome.bg.timeWarningOneMinute'),
      log: t('hudChrome.bg.timeWarningOneMinuteLog'),
    };
  }
  const minutes = num(Math.round(secondsLeft / 60));
  return {
    banner: t('hudChrome.bg.timeWarningMinutes', { minutes }),
    log: t('hudChrome.bg.timeWarningMinutesLog', { minutes }),
  };
}
