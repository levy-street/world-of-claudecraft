// Thin painter for the death screens: resolves the static death/ghost markup in
// index.html once and paints a DeathPromptView (death_prompt_view.ts decides)
// through the HUD's write-elided setDisplay. Owns no state and no decisions.

import type { PainterHostWriters } from '../../painter_host';
import type { DeathPromptView } from './death_prompt_view';

export interface DeathScreenEls {
  overlay: HTMLElement;
  pvpResurrectBtn: HTMLElement;
  ghostHint: HTMLElement;
  ghostPrompt: HTMLElement;
  ghostRecapBtn: HTMLElement;
}

/** Resolve the death-screen elements once (they are static markup). */
export function deathScreenEls(doc: Pick<Document, 'getElementById'>): DeathScreenEls {
  const el = (id: string) => doc.getElementById(id) as HTMLElement;
  return {
    overlay: el('death-overlay'),
    pvpResurrectBtn: el('pvp-resurrect-btn'),
    ghostHint: el('ghost-hint'),
    ghostPrompt: el('ghost-prompt'),
    ghostRecapBtn: el('ghost-recap-btn'),
  };
}

/** Paint this frame's death surfaces; repeats elide in the shared write cache. */
export function paintDeathScreens(
  w: Pick<PainterHostWriters, 'setDisplay'>,
  els: DeathScreenEls,
  view: DeathPromptView,
): void {
  w.setDisplay(els.overlay, view.overlay ? 'flex' : 'none');
  w.setDisplay(els.pvpResurrectBtn, view.pvpResurrect ? '' : 'none');
  w.setDisplay(els.ghostHint, view.ghostHint ? 'block' : 'none');
  w.setDisplay(els.ghostPrompt, view.ghostPrompt ? 'flex' : 'none');
  w.setDisplay(els.ghostRecapBtn, view.ghostRecap ? '' : 'none');
}
