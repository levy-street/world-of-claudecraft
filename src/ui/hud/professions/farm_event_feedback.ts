// Farming's seven SimEvent feedback arms (plant, harvest, wither, deny, husk
// trade, the ready notice, and the feast placement), the first five extracted
// whole from the HUD's event switch at the v0.38.0 release sync (the
// monolith-ratchet heal) and the rest landed here directly: the
// event-to-line doctrine lives here and
// the HUD's switch keeps a one-call thin arm. The split of duties is
// unchanged: the PURE resolution (which line key, which item token id, the
// deny toast plan) stays in farming_view.ts, the pure core a Vitest drives
// directly; this module is the thin consumer that localizes, formats, and
// pushes through the host seam. The host is the Hud itself (its log /
// showSelfNote / showError are public and structurally satisfy the
// interface), so tests drive this module with a recording host instead.

import { audio } from '../../../game/audio';
import { FARM_COMPOST_ITEM_ID, FARM_WITHERED_HUSK_ITEM_ID } from '../../../sim/professions/farming';
import type { SimEvent } from '../../../sim/types';
import { grantItemToken, grantQtyText } from '../../grant_line_view';
import { formatNumber, t } from '../../i18n';
import { farmDenialLine } from './denial_line_core';
import {
  farmFineLineKey,
  farmHarvestLineKey,
  farmHusksConvertedLineKey,
  farmPlantedTokenId,
  farmSeedBackLineKey,
  farmWitheredLineKey,
} from './farming_view';
import { PROF_LOG_GRANT, PROF_LOG_MISS, PROF_LOG_NEWS } from './profession_log_tones';

/** The seven farming events, narrowed from the shared SimEvent union. */
export type FarmEvent = Extract<
  SimEvent,
  {
    type:
      | 'farmPlanted'
      | 'farmHarvested'
      | 'farmWithered'
      | 'farmDenied'
      | 'farmHusksConverted'
      | 'farmReady'
      | 'farmFeastPlaced';
  }
>;

/** The four HUD feedback surfaces the farming arms write to. The Hud class
 *  satisfies this structurally; keep the member shapes assignable from its
 *  public methods. `showBanner` takes only the text because every later
 *  parameter of the Hud's own method is defaulted (and its default
 *  `bannerClass` is the ambient one this notice wants), so the seam stays a
 *  one-argument call and hud.ts gains nothing. */
export interface FarmFeedbackHost {
  log(text: string, color: string): void;
  showSelfNote(text: string): void;
  showError(text: string): void;
  showBanner(text: string): void;
}

/** One half of a ready notice's bed count, normalized before anything is said
 *  about it: only a FINITE positive number is a count worth a sentence.
 *
 *  The positive test was always there (the emitter omits a zero, and a
 *  malformed zero from a stale or foreign server must print nothing rather
 *  than "0 crops"); what it could not catch is a non-finite count, because
 *  `Infinity > 0` is true and formatNumber renders it as the locale's infinity
 *  symbol, so such a frame reached the banner, the log and the cue with a
 *  sentence about beds that do not exist. That is the same wrong-and-loud
 *  outcome the zero guard exists to prevent, so it takes the same answer:
 *  treat it as nothing to announce.
 *  NaN already fell through both comparisons; it is normalized here too so the
 *  refusal is spelled rather than inherited from an accident of `>`. Applied
 *  per HALF, never per event, so a frame with one malformed count still tells
 *  the player about the other. */
function farmNoticeCount(raw: number | undefined): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 0;
}

export function handleFarmEvent(ev: FarmEvent, host: FarmFeedbackHost): void {
  switch (ev.type) {
    case 'farmPlanted': {
      // A crop went into a bed (Farming, the growth-engine phase). The
      // event is text-free and id-carrying, so the pure core resolves
      // which item the line names (the crop's seed, the one it consumed)
      // and the crop-drift fallback with it. The cue is a PLACEHOLDER (the
      // procedural soil scrape in scripts/sfx/ui_sfx.mjs) rather than a
      // borrowed recording, so the sound engineer's real take drops into the
      // same key and nothing here changes. The audio facade is imported
      // directly, the src/ui precedent: routing it through FarmFeedbackHost
      // would push new members into hud.ts, which has no ceiling headroom.
      audio.farmPlant();
      host.log(
        t('hudChrome.farming.plantLine', {
          name: grantItemToken(farmPlantedTokenId(ev.cropId)),
        }),
        PROF_LOG_NEWS,
      );
      break;
    }
    case 'farmHarvested': {
      // The produce a ready plot paid. These are the ONLY lines for the
      // grant (the farming resolver emits its hub grants callerLogs, the
      // #2430 one-line rule), so they carry the quantity. The fine-grade
      // twin takes a second line for the same reason a Pristine specimen
      // does: it is a different item granted BESIDE the plain produce, so
      // one line would read as the same yield reported twice.
      // One cue for the whole event, fired ONCE up front: the fine twin and
      // the seed-back are extra LINES of the same harvest, never extra
      // harvests, so layering a second cue on them would double the sound.
      audio.farmHarvest();
      host.log(
        t(farmHarvestLineKey(ev.count), {
          name: grantItemToken(ev.itemId),
          qty: grantQtyText(ev.count),
        }),
        PROF_LOG_GRANT,
      );
      // Both halves demanded, not just the id: the emitter always writes
      // the pair together (a present pair means a MIXED harvest), but the
      // wire type declares them as independent optionals, and a half-pair
      // from a stale or foreign server would otherwise render an implicit
      // "x1" for a real multi-unit fine yield. A malformed half-pair
      // renders nothing rather than something wrong.
      if (ev.fineItemId !== undefined && ev.fineCount !== undefined) {
        host.log(
          t(farmFineLineKey(ev.fineCount), {
            name: grantItemToken(ev.fineItemId),
            qty: grantQtyText(ev.fineCount),
          }),
          PROF_LOG_GRANT,
        );
      }
      // The tier 3/4 seed-back sentence, only when the event carries a
      // POSITIVE count (the emitter omits zero; the positive guard also
      // drops a malformed zero from a stale or foreign server rather
      // than printing "x0"). The seed item resolves client-side from the
      // crop id through the same shared hop the plant line uses.
      if (ev.seedBackCount !== undefined && ev.seedBackCount > 0) {
        host.log(
          t(farmSeedBackLineKey(ev.seedBackCount), {
            name: grantItemToken(farmPlantedTokenId(ev.cropId)),
            qty: grantQtyText(ev.seedBackCount),
          }),
          PROF_LOG_GRANT,
        );
      }
      // The golden-harvest BONUS line (Phase 11f). Rendered only when the
      // event names an item, which only a golden win does, and it is the
      // ONLY feedback for that grant: the bonus is force-added silently like
      // every other leg of the harvest, so without this line a player would
      // receive an item with nothing said about it. Green, the grant
      // register, and no second celebration beat: the golden windfall's own
      // zone announce already fired above.
      if (ev.goldenBonusItemId !== undefined) {
        host.log(
          t('hudChrome.farming.goldenBonusLine', {
            name: grantItemToken(ev.goldenBonusItemId),
          }),
          PROF_LOG_GRANT,
        );
      }
      // The last-charge signal (the gatherResult arm's farming twin):
      // the harvest that spent the slotted effect's final charge
      // announces it as an FCT self-note. ONE surface on purpose: the
      // professions window's charge row is the durable record, so a log
      // line here would be the double-feedback trap.
      if (ev.effectDepleted) {
        host.showSelfNote(t('hudChrome.professions.toolEffectDepleted'));
      }
      break;
    }
    case 'farmWithered': {
      // The plot lost its survival pre-roll and paid husks instead. Grey,
      // the no-cost-miss register (gotAwayLine): a withered crop costs the
      // seed and the wait, never the bed, and the line says so plainly
      // rather than dressing a failure as a yield.
      // Its OWN cue, not the harvest one it borrowed through the interim
      // (the deferred Phase 8/10 sting, landed at the Phase 18 sweep): the
      // player took the identical action, so the sound keeps the harvest's
      // vocabulary, but its tail falls where the harvest's lifts, because
      // what came back was husks. Never a silent arm: silence would read as
      // an input that never registered.
      audio.farmWithered();
      host.log(
        t(farmWitheredLineKey(ev.count), {
          name: grantItemToken(FARM_WITHERED_HUSK_ITEM_ID),
          qty: grantQtyText(ev.count),
        }),
        PROF_LOG_MISS,
      );
      // The seed-back consolation on a failed high-tier crop (the roll
      // fires on BOTH outcomes): a real grant, so it keeps the grant
      // green rather than the failure grey, and the same positive guard
      // as the harvested arm above.
      if (ev.seedBackCount !== undefined && ev.seedBackCount > 0) {
        host.log(
          t(farmSeedBackLineKey(ev.seedBackCount), {
            name: grantItemToken(farmPlantedTokenId(ev.cropId)),
            qty: grantQtyText(ev.seedBackCount),
          }),
          PROF_LOG_GRANT,
        );
      }
      break;
    }
    case 'farmFeastPlaced': {
      // The shared feast went out (Phase 12). The placer's confirmation: the
      // placement cue (ungated, the farmPlant direct-affordance register)
      // plus ONE transient self-note toast. Deliberately no log line and no
      // banner: the standing table, its flourish, and its composed title are
      // the durable record, so a second written surface would be the
      // double-feedback trap. The event carries only ids (pid, feastId); the
      // sentence is entirely client-side.
      audio.farmFeast();
      host.showSelfNote(t('hudChrome.farming.feastPlacedLine'));
      break;
    }
    case 'farmDenied': {
      // A refused plant, harvest or husk trade: an error toast ONLY, no
      // line, no cue, no other state (the gatherDenied pattern). The sim
      // event is text-free; the shared denial pattern (denial_line_core.ts,
      // the ONE shape crafting's deny arm also extends) resolves the key
      // through the pure core and spells the 'tool' reason's tier (the
      // tierRequired.farming line, node-path parity), so this render is
      // exactly the crafting call site's: t(line.key, line.params).
      const line = farmDenialLine(ev.reason, ev.cropId);
      host.showError(t(line.key, line.params));
      break;
    }
    case 'farmHusksConverted': {
      // The husk trade (the knobs phase). The event owns both halves of
      // the feedback (the compost grant rides its hub loot event silent +
      // callerLogs, the #2430 one-line rule), so this one line names both
      // sides of the trade AS ITEM TOKENS: the husks spent and the
      // compost gained, each through grantItemToken so neither can drift
      // from its localized item name. Same grant green as the harvest
      // line. Still no cue after the render / juice phase: the trade is a
      // menu conversion, not a world action, so it stays in the same silent
      // register as the refusals rather than borrowing the harvest sound.
      host.log(
        t(farmHusksConvertedLineKey(ev.compost), {
          husksName: grantItemToken(FARM_WITHERED_HUSK_ITEM_ID),
          husks: grantQtyText(ev.husks),
          name: grantItemToken(FARM_COMPOST_ITEM_ID),
          qty: grantQtyText(ev.compost),
        }),
        PROF_LOG_GRANT,
      );
      break;
    }
    case 'farmReady': {
      // One or more plots FINISHED (the ready-notice phase): the sim's 1 Hz
      // sweep and its login check both emit this once per plot per growth
      // cycle, so every surface here is a one-shot nudge rather than a
      // repeating reminder. COUNTS ONLY on the wire, so the lines say how
      // many beds are waiting and the plot rows themselves stay the fplot
      // projection's job (the farming window and the map pins read those).
      //
      // The plural split is written here rather than through the grant-line
      // family in farming_view.ts on purpose: this is a count of BEDS, with
      // no item and no quantity token, so isMultiUnitGrant's grant contract
      // does not describe it and borrowing it would tie a plot count to the
      // rules for " xN" on a stack.
      //
      // Each half is resolved ONCE and only when its count is POSITIVE, so a
      // mixed notice reports both outcomes honestly instead of rounding a
      // failed crop into "ready", and a malformed zero from a stale or
      // foreign server prints nothing rather than "0 crops".
      const readyCount = farmNoticeCount(ev.ready);
      const witheredCount = farmNoticeCount(ev.withered);
      const readyText =
        readyCount > 0
          ? t(readyCount > 1 ? 'hudChrome.farming.readyLineQty' : 'hudChrome.farming.readyLine', {
              count: formatNumber(readyCount, { maximumFractionDigits: 0 }),
            })
          : null;
      const witheredText =
        witheredCount > 0
          ? t(
              witheredCount > 1
                ? 'hudChrome.farming.readyWitheredLineQty'
                : 'hudChrome.farming.readyWitheredLine',
              { count: formatNumber(witheredCount, { maximumFractionDigits: 0 }) },
            )
          : null;
      // The banner leads with the READY sentence, the actionable half, and
      // falls back to the withered one only when nothing is waiting to be
      // brought in. Ambient (the showBanner default), so it replaces rather
      // than queues, IN BOTH DIRECTIONS: a zone name or a prompt is welcome to
      // take the slot back, and this notice may equally pre-empt an ambient
      // banner the player was mid-read of. Both are accepted because nothing
      // actionable lives only on the banner: the log lines below are the
      // durable record, and the journal, pins, and plot status all show the
      // same truth.
      const bannerText = readyText ?? witheredText;
      // An all-zero notice cannot come from this sim, so it is a stale or
      // foreign server: say nothing and make no sound rather than announce an
      // empty sentence.
      if (!bannerText) break;
      // ONE cue for the whole event, like the harvest arm: a notice about four
      // beds is still one notice (the #2430 one-cue rule).
      audio.farmReady();
      host.showBanner(bannerText);
      // The plant line's pale green, not the grant green: nothing was granted
      // here, this is news about the player's own beds. The withered half
      // keeps the grey no-cost-miss register of the withered harvest line
      // (the crop was lost, the bed was not).
      if (readyText) host.log(readyText, PROF_LOG_NEWS);
      if (witheredText) host.log(witheredText, PROF_LOG_MISS);
      break;
    }
    default: {
      // Exhaustiveness tripwire: a farm SimEvent added to the FarmEvent
      // union with no arm here stops compiling, instead of shipping as a
      // silently unhandled event (the cross-platform review's ask).
      const unhandled: never = ev;
      void unhandled;
    }
  }
}
