// Thin DOM painter for the Loot Settings window (#loot-settings-window). Paints an
// editable form for the leader and read-only labels for members from the pure
// LootSettingsModel. Owns no state; the Hud rebuilds it from authoritative party
// state whenever the settings signature changes. Interpolated names go through esc.

import type { MasterLootThreshold } from '../sim/types';
import { esc } from './esc';
import { type TranslationKey, t } from './i18n';
import type { LootSettingsModel } from './loot_settings_view';
import { svgIcon } from './ui_icons';

export interface LootSettingsWindowDeps {
  onChange: (enabled: boolean, looter: number, threshold: MasterLootThreshold) => void;
  onClose: () => void;
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
  root.innerHTML =
    `<div class="panel-title"><span id="loot-settings-title">${esc(t('hudChrome.lootSettings.title'))}</span>` +
    `<button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.lootSettings.close'))}">${svgIcon('close')}</button></div>` +
    `<div class="ls-body">${model.isLeader ? leaderBody(model) : memberBody(model)}</div>`;
  root.querySelector('[data-close]')?.addEventListener('click', () => deps.onClose());
  if (!model.isLeader) return;
  const method = root.querySelector<HTMLSelectElement>('#ls-method');
  const threshold = root.querySelector<HTMLSelectElement>('#ls-threshold');
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
