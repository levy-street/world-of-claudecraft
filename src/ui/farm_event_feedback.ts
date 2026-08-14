// Farming's five SimEvent feedback arms (plant, harvest, wither, deny, husk
// trade), extracted whole from the HUD's event switch at the v0.38.0 release
// sync (the monolith-ratchet heal): the event-to-line doctrine lives here and
// the HUD's switch keeps a one-call thin arm. The split of duties is
// unchanged: the PURE resolution (which line key, which item token id, the
// deny toast plan) stays in farming_view.ts, the pure core a Vitest drives
// directly; this module is the thin consumer that localizes, formats, and
// pushes through the host seam. The host is the Hud itself (its log /
// showSelfNote / showError are public and structurally satisfy the
// interface), so tests drive this module with a recording host instead.

import { audio } from '../game/audio';
import { FARM_COMPOST_ITEM_ID, FARM_WITHERED_HUSK_ITEM_ID } from '../sim/professions/farming';
import type { SimEvent } from '../sim/types';
import {
  farmDeniedToast,
  farmFineLineKey,
  farmHarvestLineKey,
  farmHusksConvertedLineKey,
  farmPlantedTokenId,
  farmSeedBackLineKey,
  farmWitheredLineKey,
} from './farming_view';
import { grantItemToken, grantQtyText } from './grant_line_view';
import { formatNumber, t } from './i18n';

/** The five farming events, narrowed from the shared SimEvent union. */
export type FarmEvent = Extract<
  SimEvent,
  {
    type: 'farmPlanted' | 'farmHarvested' | 'farmWithered' | 'farmDenied' | 'farmHusksConverted';
  }
>;

/** The three HUD feedback surfaces the farming arms write to. The Hud class
 *  satisfies this structurally; keep the member shapes assignable from its
 *  public methods. */
export interface FarmFeedbackHost {
  log(text: string, color: string): void;
  showSelfNote(text: string): void;
  showError(text: string): void;
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
        '#c8f7c5',
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
        '#7fdc4f',
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
          '#7fdc4f',
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
          '#7fdc4f',
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
      // The SAME harvest cue as the arm above on purpose: the player took the
      // identical action and it resolved, only unluckily. A distinct
      // disappointment sting is a later phase's call, not a silent arm here
      // (silence would read as an input that never registered).
      audio.farmHarvest();
      host.log(
        t(farmWitheredLineKey(ev.count), {
          name: grantItemToken(FARM_WITHERED_HUSK_ITEM_ID),
          qty: grantQtyText(ev.count),
        }),
        '#a8a8a8',
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
          '#7fdc4f',
        );
      }
      break;
    }
    case 'farmDenied': {
      // A refused plant, harvest or husk trade: an error toast ONLY, no
      // line, no cue, no other state (the gatherDenied pattern). The sim
      // event is text-free, so the pure core resolves the key, and for
      // the 'tool' reason also the tier the refused crop demands (the
      // tierRequired.farming line, node-path parity), which is formatted
      // HERE because the pure core stays formatter-free.
      const toast = farmDeniedToast(ev.reason, ev.cropId);
      host.showError(
        t(
          toast.key,
          toast.params
            ? { tier: formatNumber(toast.params.tier, { maximumFractionDigits: 0 }) }
            : undefined,
        ),
      );
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
        '#7fdc4f',
      );
      break;
    }
  }
}
