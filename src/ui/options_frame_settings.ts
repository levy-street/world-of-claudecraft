import { SETTING_RANGES } from '../game/settings';
import { captureFocusKey, findFocusKey } from './focus_restore';
import { frameSettingRelated } from './frame_menu_core';
import { renderFrameSettingsRows } from './frame_menu_rows';
import { type FramePresetControlsDeps, renderFramePresets } from './frame_presets_controls';
import { t } from './i18n';
import {
  buildFramesMenuSelects,
  buildFramesMenuToggles,
  type FramesMenuSettingsHooks,
} from './interface_unlock_menu_core';
import type { OptionsControl } from './options_view';

/** Disclosure state belongs to the options visit, not to a rebuilt DOM subtree. */
export class OptionsFrameSections {
  private disposePresets?: () => void;
  constructor(
    private readonly presetDeps?: FramePresetControlsDeps,
    private readonly applied?: () => void,
  ) {}

  private framesOpen = true;
  private frames: HTMLDetailsElement | null = null;
  private partyOpen = false;
  private party: HTMLDetailsElement | null = null;

  dispose(): void {
    this.disposePresets?.();
    this.disposePresets = undefined;
  }

  render(
    body: HTMLElement,
    controls: OptionsControl[],
    hooks: FramesMenuSettingsHooks,
    frameId: string | null,
    apply: (root: HTMLElement, controls: OptionsControl[]) => void,
    showAll: () => void,
  ): void {
    if (this.frames) this.framesOpen = this.frames.open;
    if (this.party) this.partyOpen = this.party.open;
    this.party = null;
    this.dispose();
    if (!frameId) this.disposePresets = renderFramePresets(body, this.presetDeps, this.applied);
    if (frameId) {
      const all = document.createElement('button');
      all.type = 'button';
      all.className = 'btn ui-btn';
      all.textContent = t('hudChrome.frameMenus.allOptions');
      all.addEventListener('click', showAll);
      body.appendChild(all);
    }
    const shared = document.createElement('details');
    shared.className = 'interface-frame-options';
    shared.open = !!frameId || this.framesOpen;
    const heading = document.createElement('summary');
    heading.textContent = t('hudChrome.interfaceUnlock.framesMenu');
    heading.tabIndex = 0;
    shared.appendChild(heading);
    this.frames = shared;
    body.appendChild(shared);
    const rows = document.createElement('div');
    shared.appendChild(rows);
    const partyControls = controls.filter(
      (control) => 'key' in control && control.key.startsWith('partyFrame'),
    );
    const otherControls = controls.filter((control) => !partyControls.includes(control));
    apply(shared, otherControls);
    const partyRows = document.createElement('div');
    if (partyControls.length) {
      const party = document.createElement('details');
      party.className = 'interface-party-options';
      party.open = frameId === 'partyFrames' || this.partyOpen;
      const summary = document.createElement('summary');
      summary.textContent = t('hudChrome.partyFrames.optionsSection');
      summary.tabIndex = 0;
      party.appendChild(summary);
      body.appendChild(party);
      this.party = party;
      apply(party, partyControls);
      party.appendChild(partyRows);
    }
    const paint = () => {
      const focus = captureFocusKey(body);
      const scrollTop = body.scrollTop;
      rows.replaceChildren();
      partyRows.replaceChildren();
      const relevant = (key: string) => !frameId || frameSettingRelated(frameId, key);
      const partySetting = (key: string) =>
        partyControls.length > 0 && (key.startsWith('partyFrame') || key === 'mouseoverCast');
      const toggles = buildFramesMenuToggles(
        hooks,
        !!hooks.settings.get('combineActionBars'),
      ).filter((row) => relevant(row.id));
      const selects = buildFramesMenuSelects(hooks, SETTING_RANGES).filter((row) =>
        relevant(row.id),
      );
      for (const [root, isParty] of [
        [rows, false],
        [partyRows, true],
      ] as const)
        renderFrameSettingsRows(
          document,
          root,
          toggles.filter((row) => partySetting(row.id) === isParty),
          selects.filter((row) => partySetting(row.id) === isParty),
          paint,
        );
      if (focus) findFocusKey(body, focus)?.focus({ preventScroll: true });
      body.scrollTop = scrollTop;
    };
    paint();
  }
}
