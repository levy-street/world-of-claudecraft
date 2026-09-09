import { audio } from '../../../game/audio';
import { ITEMS } from '../../../sim/data';
import type { HarvestPreference } from '../../../sim/professions/harvest_preference';
import { itemDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import { FOCUS_KEY_ATTR } from '../../focus_restore';
import { t } from '../../i18n';
import { knownItemDef } from '../../known_item';

/** Harvest entry controls open another window and never gather or spend.
 *  The one shape ProfessionsWindowDeps inherits rather than repeating, so the
 *  window's own dep bag and this controller's callback contract cannot
 *  drift apart. */
export interface HarvestEntryCallbacks {
  /** Open the corpse choice popup for the targeted or nearest body whose
   *  harvest is still open (intentional gathering PR1). The button is an
   *  EXAMINE: the host names the body and opens the popup, and only the
   *  popup's own Harvest control ever sends a harvest. Optional so a host
   *  that has not wired the entry paints no dead button. Painted in BOTH
   *  modes at any skill: Tab and pad targeting skip dead mobs, so this is
   *  the keyboard, pad and touch route to a body. */
  harvestBody?(): void;
  /** Open the Harvest Journal (the farming row's entry control). Optional so
   *  a host that has not wired the journal simply paints no button rather
   *  than a dead one. Not a command: the journal is a reader, so this window
   *  keeps its no-repaint-on-click contract. */
  openHarvestJournal?(): void;
  /** Open the shared corpse-harvest preference picker (the SAME picker the
   *  Field Kit's use opens; Intentional Gathering PR3). Never gathers or
   *  spends: a settings action, always general (no body context). Optional
   *  so a host that has not wired it paints no dead button, the
   *  harvestBody/openHarvestJournal shape. */
  openHarvestPreference?(): void;
}

/** The Harvest Preference entry's own subtitle rides no field on
 *  ProfessionsViewInput (this controller owns that world read elsewhere); it
 *  joins a caller's repaint signature through its `local` extension point
 *  instead, so a preference change alone (no craft/gathering data moved)
 *  still repaints the remembered choice. `preference` is read directly from
 *  `IWorld.harvestPreference`; `?? null` here (rather than at each call site)
 *  is what lets a stub IWorld in an older test that predates this field read
 *  as undefined and still join the signature exactly like a malformed (null)
 *  real preference, never throw. */
export function harvestPreferenceLocalSig(
  preference: HarvestPreference | null | undefined,
): readonly (string | number | boolean | null)[] {
  const pref = preference ?? null;
  if (pref === null) return [null, null];
  return [pref.kind, pref.kind === 'material' ? pref.itemId : null];
}

/** The remembered All/material/unknown choice, safe against a retired id
 *  shaped like a prototype member (the harvest_preference_picker.ts
 *  knownItemDef contract): never the raw internal id. A malformed (null)
 *  preference reads as unknownMaterial too, since there is no valid choice
 *  to name. */
function harvestPreferenceChoiceText(preference: HarvestPreference | null): string {
  if (preference === null) return t('hudChrome.harvestPreference.unknownMaterial');
  if (preference.kind === 'all') return t('hudChrome.harvestPreference.allLabel');
  const item = knownItemDef(ITEMS, preference.itemId);
  return item ? itemDisplayName(item) : t('hudChrome.harvestPreference.unknownMaterial');
}

export function harvestBodyEntryHtml(enabled: boolean): string {
  if (!enabled) return '';
  return (
    '<section class="prof-harvest-body">' +
    `<button type="button" class="btn prof-effect-btn" data-harvest-body ${FOCUS_KEY_ATTR}="harvestBody">${esc(t('hudChrome.professions.harvestBodyButton'))}</button>` +
    `<p class="prof-harvest-body-hint">${esc(t('hudChrome.professions.harvestBodyHint'))}</p></section>`
  );
}

export function harvestJournalEntryHtml(professionId: string, enabled: boolean): string {
  if (professionId !== 'farming' || !enabled) return '';
  return `<div class="prof-effect-actions"><button type="button" class="btn prof-effect-btn" data-harvest-journal ${FOCUS_KEY_ATTR}="harvestJournal">${esc(t('hudChrome.harvestJournal.title'))}</button></div>`;
}

/** The clearly-labelled Professions entry to the shared corpse-harvest
 *  preference picker (Intentional Gathering PR3): the SAME picker the Field
 *  Kit's use opens, always general (no body context). Shows the remembered
 *  All/material/unknown choice so a player never has to open it just to
 *  check. Painted at any skill, any body, always enabled when wired: unlike
 *  the Harvest Body entry, this is a setting, not a body examine. */
export function harvestPreferenceEntryHtml(
  preference: HarvestPreference | null,
  enabled: boolean,
): string {
  if (!enabled) return '';
  const choice = harvestPreferenceChoiceText(preference);
  return (
    '<div class="prof-effect-actions">' +
    `<button type="button" class="btn prof-effect-btn" data-harvest-preference ${FOCUS_KEY_ATTR}="harvestPreference">` +
    `${esc(t('hudChrome.harvestPreference.title'))}` +
    `<span class="prof-harvest-preference-current">${esc(t('hudChrome.harvestPreference.currentChoiceLabel', { choice }))}</span>` +
    '</button></div>'
  );
}

export function wireHarvestEntries(root: HTMLElement, callbacks: HarvestEntryCallbacks): void {
  root.querySelector('[data-harvest-body]')?.addEventListener('click', () => {
    audio.click();
    callbacks.harvestBody?.();
  });
  root.querySelector('[data-harvest-journal]')?.addEventListener('click', () => {
    audio.click();
    callbacks.openHarvestJournal?.();
  });
  root.querySelector('[data-harvest-preference]')?.addEventListener('click', () => {
    audio.click();
    callbacks.openHarvestPreference?.();
  });
}
