// Keeping mounted appearance customizers in the player's language.
//
// THE BUG THIS EXISTS FOR. mountAppearanceCustomizer owns its DOM and bakes
// every label through t() at mount; its rows carry no `data-i18n`, so the
// translatePage sweep cannot find them. The create panel mounts during boot,
// BEFORE the lazy locale chunk resolves, so its labels come out English and
// STAY English for every non-English player.
//
// THE PROBE IS RESOLVED TEXT, NOT THE LANGUAGE ID. This is the part that is
// easy to get wrong: the language id is already the player's choice at boot, so
// it does not change when the table lands and a language comparison sees
// nothing. What arrives late is the TABLE BEHIND it. Comparing a couple of
// resolved labels catches both that and a deliberate language switch, and stays
// equal for English players so they never pay a rebuild.
//
// Every panel that mounts a customizer registers here, so relocalizing is one
// call and a new panel cannot forget to be relocalized by simply not knowing
// about the boot race.

import { getLanguage, t } from './i18n';

/** How a registered panel rebuilds itself. Called only when its labels are
 *  stale; it is expected to re-mount the customizer (labels are baked, so
 *  relabelling IS a rebuild). */
type RebuildFn = () => void;

const panels = new Map<string, { probe: string; rebuild: RebuildFn }>();

/** The signature a mounted customizer is compared against: language plus two
 *  resolved labels, so an unchanged language with a newly-loaded table still
 *  reads as stale. */
export function appearanceLocaleProbe(): string {
  return `${getLanguage()}|${t('auth.appearance')}|${t('auth.earrings')}`;
}

/** Record that `panelId` has a customizer mounted against the CURRENT locale,
 *  and how to rebuild it when that stops being true. */
export function noteAppearancePanelMounted(panelId: string, rebuild: RebuildFn): void {
  panels.set(panelId, { probe: appearanceLocaleProbe(), rebuild });
}

/** Drop a panel from the sweep when its customizer is torn down, so a closed
 *  editor is never rebuilt into a host that is no longer on screen. */
export function forgetAppearancePanel(panelId: string): void {
  panels.delete(panelId);
}

/** Whether this panel's baked labels no longer match the resolved table.
 *  Unregistered panels read as stale: nothing is mounted, so a caller asking
 *  the question wants to build. */
export function appearancePanelIsStale(panelId: string): boolean {
  return panels.get(panelId)?.probe !== appearanceLocaleProbe();
}

/** Rebuild every mounted appearance customizer whose labels are now stale.
 *  Called when the boot locale chunk lands, and again on a language switch. */
export function relocalizeAppearancePanels(): void {
  for (const [panelId, entry] of [...panels]) {
    if (entry.probe !== appearanceLocaleProbe()) entry.rebuild();
  }
}

/** Forget every registration (test-only: the map is module state). */
export function resetAppearancePanelsForTests(): void {
  panels.clear();
}
