// Node-harvest and corpse-harvest feedback (Professions 2.0 / #2457), extracted
// whole from the HUD's event switch (the monolith-ratchet heal, the
// farm_event_feedback.ts precedent): the event-to-line doctrine lives here,
// the HUD's switch keeps a one-call thin arm. The Hud itself is the host seam
// (its log / showSelfNote are public and structurally satisfy the interface),
// so tests drive this module with a recording host instead.

import { audio } from '../../../game/audio';
import type { SimEvent } from '../../../sim/types';
import { gatherLineKey, grantItemToken, grantQtyText, harvestLineKey } from '../../grant_line_view';
import { t } from '../../i18n';
import { QUALITY_COLOR } from '../../icons';
import { gatherRareTierFor } from './gathering_view';

/** The two HUD feedback surfaces these arms write to. */
export interface GatherResultFeedbackHost {
  log(text: string, color: string): void;
  showSelfNote(text: string): void;
}

export type GatherResultEvent = Extract<SimEvent, { type: 'gatherResult' }>;
export type HarvestResultEvent = Extract<SimEvent, { type: 'harvestResult' }>;

/** Harvest feedback line (Professions 2.0), colored by rolled material
 *  rarity. Identical on every graphics tier (player feedback is never
 *  profile-gated). This is the ONLY line for the harvest grant: the grant
 *  hub's own 'loot' event is emitted both silent and callerLogs for a gather
 *  grant (see gathering.ts harvestNode), so neither the generic ding nor the
 *  "You receive:" line stacks on top of this line and its dedicated
 *  node-type cue (#2430). The node-type impact always plays; a
 *  rare-or-better material roll (or any rare-event roll) layers one
 *  additional tiered stinger on top, never a replacement for the impact.
 *  The LINE color is the rolled rarity (the yield roll), while the item link
 *  inside it paints from the item's own def quality: the same Copper Ore is
 *  granted at every roll, only the qty scales, so the link must not claim
 *  the ore itself got rarer. */
export function handleGatherResult(ev: GatherResultEvent, host: GatherResultFeedbackHost): void {
  host.log(
    t(gatherLineKey(ev.qty), {
      name: grantItemToken(ev.itemId),
      qty: grantQtyText(ev.qty),
    }),
    QUALITY_COLOR[ev.rarity],
  );
  audio.gather(ev.nodeType);
  const gatherRareTier = gatherRareTierFor(ev.rarity, ev.rareEvent);
  if (gatherRareTier) audio.gatherRareTier(gatherRareTier);
  // The last-charge signal (the UX pass): the harvest that spent the
  // slotted effect's final charge announces it as an FCT self-note (which
  // also feeds the polite live region). ONE surface on purpose: the
  // professions window's charge row is the durable record, so a log line
  // here would be the double-feedback trap the arms above already avoid.
  if (ev.effectDepleted) {
    host.showSelfNote(t('hudChrome.professions.toolEffectDepleted'));
  }
}

/** Corpse-harvest feedback (#2457): ONE line per distinct granted item and
 *  exactly ONE cue for the whole command. Corpse harvest is the only
 *  profession flow whose single command grants several distinct items, so
 *  the sim sends a LIST and this arm walks it; before the event existed each
 *  of the six internal grants printed its own hub "You receive:" line and
 *  its own generic ding, so a two-component harvest burst two of each and a
 *  specimen proc four. Every grant behind this event is emitted silent +
 *  callerLogs (src/sim/interaction.ts harvestCorpse), so these lines and the
 *  one cue below are the whole of the harvest's feedback. The list is never
 *  empty (the sim skips the emit on a harvest that landed nothing), so the
 *  cue never fires for a no-op.
 *
 *  Line color is the ROLLED material rarity, the gatherResult rule: the item
 *  link inside paints from the item's own def quality, because the same
 *  Rough Hide is granted at every roll and the link must not claim the hide
 *  itself got rarer. */
export function handleHarvestResult(ev: HarvestResultEvent, host: GatherResultFeedbackHost): void {
  for (const y of ev.yields) {
    host.log(
      t(harvestLineKey(y), {
        name: grantItemToken(y.itemId),
        qty: grantQtyText(y.qty),
      }),
      QUALITY_COLOR[y.rarity],
    );
  }
  // The generic pickup ding, played ONCE for the command rather than once
  // per component. A node harvest has a dedicated per-node-type recording
  // (audio.gather above); a corpse harvest has never had one of its own, so
  // it keeps the sound it has always made and the fix here is purely that it
  // stops stacking.
  audio.lootItem();
}
