// Thin DOM painter for the Loot Settings window (#loot-settings-window). Paints an
// editable form for the leader and read-only labels for members from the pure
// LootSettingsModel. Owns no state; the Hud rebuilds it from authoritative party
// state whenever the settings signature changes. Interpolated names go through esc.
//
// Chrome comes from the shared window-frame builder (window_frame.ts): a titlebar
// with a close control and a scrollable body (a form, so no footer). The frame
// mounts on an inner container and is reused across repaints; only the .ls-body
// form refills per render. The root is the DIALOG: #loot-settings-window carries a
// static role="dialog" + aria-labelledby="loot-settings-title" in index.html and
// Hud focus-traps it, so the descriptor id is chosen so the frame's title id
// matches that target, and the frame's own redundant role/aria are stripped,
// leaving exactly one dialog (the root). The root keeps display:block, so Hud's
// open/close, focus trap, and auto-docking are unchanged.

import type { MasterLootThreshold } from '../sim/types';
import { esc } from './esc';
import { type TranslationKey, t } from './i18n';
import type { LootSettingsModel } from './loot_settings_view';
import { renderWindowFrame, type WindowFrameParts } from './window_frame';
import type { WindowFrameDescriptor } from './window_frame_view';

export interface LootSettingsWindowDeps {
  onChange: (enabled: boolean, looter: number, threshold: MasterLootThreshold) => void;
  onClose: () => void;
}

// Descriptor id 'loot-settings' derives the title id 'loot-settings-title', which
// is exactly the id the static root aria-labelledby points at; the frame's own
// role/aria are stripped below so the root stays the sole dialog.
const LOOT_SETTINGS_FRAME: WindowFrameDescriptor = {
  id: 'loot-settings',
  titleKey: 'hudChrome.lootSettings.title',
  closeLabelKey: 'hudChrome.lootSettings.close',
};

/**
 * Stamp the shared window frame cold on an inner mount, then reuse it. The frame
 * is visual chrome only: its role/aria-labelledby/aria-modal are stripped so the
 * static dialog identity on the #loot-settings-window root is preserved intact.
 */
function ensureFrame(el: HTMLElement, onClose: () => void): WindowFrameParts {
  const mounted = el.querySelector<HTMLElement>(':scope > .window-frame');
  const body = mounted?.querySelector<HTMLElement>('.window-body');
  if (mounted && body) {
    return { root: mounted, body, footer: null, tabButtons: [] };
  }
  const mount = document.createElement('div');
  const parts = renderWindowFrame(mount, LOOT_SETTINGS_FRAME, { onClose });
  mount.removeAttribute('role');
  mount.removeAttribute('aria-labelledby');
  mount.removeAttribute('aria-modal');
  el.replaceChildren(mount);
  return parts;
}

const THRESHOLDS: MasterLootThreshold[] = ['uncommon', 'rare', 'epic'];
const THRESHOLD_KEY: Record<MasterLootThreshold, TranslationKey> = {
  uncommon: 'hudChrome.masterLoot.thresholdUncommon',
  rare: 'hudChrome.masterLoot.thresholdRare',
  epic: 'hudChrome.masterLoot.thresholdEpic',
};

// The method <select> value scheme: 'group' = master off; otherwise the looter pid
// as a string ('0' = leader). Folds on/off into the single method control.
function methodValue(model: LootSettingsModel): string {
  return model.enabled ? String(model.looterPid) : 'group';
}

function leaderBody(model: LootSettingsModel): string {
  const opt = (value: string, label: string, on: boolean): string =>
    `<option value="${esc(value)}"${on ? ' selected' : ''}>${esc(label)}</option>`;
  const selected = methodValue(model);
  const methodOpts = [
    opt('group', t('hudChrome.lootSettings.groupLoot'), selected === 'group'),
    opt('0', t('hudChrome.lootSettings.leaderOption'), selected === '0'),
    ...model.memberOptions
      .filter((m) => m.pid !== 0)
      .map((m) =>
        opt(
          String(m.pid),
          t('hudChrome.lootSettings.masterOption', { name: m.name }),
          selected === String(m.pid),
        ),
      ),
  ].join('');
  const thrOpts = THRESHOLDS.map(
    (thr) =>
      `<option value="${thr}"${model.threshold === thr ? ' selected' : ''}>${esc(t(THRESHOLD_KEY[thr]))}</option>`,
  ).join('');
  const thrHidden = model.enabled ? '' : ' hidden';
  return `
    <div class="ls-row">
      <span class="ls-lbl">${esc(t('hudChrome.lootSettings.method'))}</span>
      <select id="ls-method">${methodOpts}</select>
    </div>
    <div class="ls-row" id="ls-threshold-row"${thrHidden}>
      <span class="ls-lbl">${esc(t('hudChrome.lootSettings.rollThreshold'))}</span>
      <select id="ls-threshold">${thrOpts}</select>
    </div>`;
}

function memberBody(model: LootSettingsModel): string {
  const row = (label: string, value: string): string =>
    `<div class="ls-row ls-ro"><span class="ls-lbl">${esc(label)}</span><span class="ls-val">${esc(value)}</span></div>`;
  if (!model.enabled)
    return row(t('hudChrome.lootSettings.method'), t('hudChrome.lootSettings.groupLoot'));
  return (
    row(t('hudChrome.lootSettings.method'), t('hudChrome.lootSettings.valueMaster')) +
    row(t('hudChrome.masterLoot.looterLabel'), model.looterName) +
    row(t('hudChrome.masterLoot.thresholdLabel'), t(THRESHOLD_KEY[model.threshold]))
  );
}

export function renderLootSettingsWindow(
  root: HTMLElement,
  model: LootSettingsModel,
  deps: LootSettingsWindowDeps,
): void {
  const { body } = ensureFrame(root, () => deps.onClose());
  body.innerHTML = `<div class="ls-body">${model.isLeader ? leaderBody(model) : memberBody(model)}</div>`;
  if (!model.isLeader) return;
  const method = body.querySelector<HTMLSelectElement>('#ls-method');
  const threshold = body.querySelector<HTMLSelectElement>('#ls-threshold');
  if (!method || !threshold) return;
  const apply = (): void => {
    const val = method.value;
    const enabled = val !== 'group';
    const looter = enabled ? Number(val) : 0;
    deps.onChange(enabled, looter, threshold.value as MasterLootThreshold);
  };
  method.addEventListener('change', apply);
  threshold.addEventListener('change', apply);
}
