// The success moment, in one place.
//
// A landed Barrowglass Thrust is the whole point of the trial and it used to produce a single
// chat line. Three feedbacks replace it, and each answers a DIFFERENT question, which is why
// none of them is redundant with the others: the banner says it worked, the float says how
// many you have landed (the only number telling a low-level player their part mattered), and
// the renderer's reticle burst says where it landed. The sim's chat line stays the durable
// record underneath all three.
//
// Lives here rather than as a case body in hud.ts for the reason the whole directory exists:
// the trial's presentation is one subsystem, and the coordinator should know only that it
// has feedback to fire.

import { t } from '../../i18n';

/** What the feedback needs from the HUD, and nothing more. */
export interface ShardpikeFeedbackHost {
  showBanner(text: string): void;
  showSelfNote(text: string): void;
}

/**
 * Fire the full success moment for a thrust that broke the ward.
 *
 * On the drill yard's effigy (`effigy`, src/sim/muster_effigy.ts) the banner is the lesson
 * itself, and there is no tally: a lantern on straw is practice, not an eye put out.
 */
export function shardpikeBlindFeedback(
  host: ShardpikeFeedbackHost,
  ev: { count: number; effigy?: boolean },
): void {
  if (ev.effigy) {
    host.showBanner(t('hudChrome.shardpike.effigyBanner'));
    return;
  }
  host.showBanner(t('hudChrome.shardpike.blindBanner'));
  host.showSelfNote(t('hudChrome.shardpike.promptTally', { count: String(ev.count) }));
}
