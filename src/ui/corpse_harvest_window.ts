// Thin DOM consumer for the per-corpse focus picker (#1142).
//
// Composed into hud.ts's existing loot window (openLoot) rather than a new
// window: a harvestable, unclaimed corpse gets an extra "Harvest" section
// appended below the loot rows, with one checkbox per tagged component and a
// Harvest button. It owns no state beyond the checked set it reports back
// through `onHarvest`; Hud tracks nothing extra and just re-renders the loot
// window like it already does for a plain loot-only corpse.

import type { CorpseHarvestViewModel } from './corpse_harvest_view';
import { esc } from './esc';
import { type TranslationKey, t } from './i18n';

export interface CorpseHarvestPainterDeps {
  /** Called with the checked component tags (may be empty = spread across all). */
  onHarvest(chosen: string[]): void;
}

const COMPONENT_LABEL_KEYS: Record<string, string> = {
  hide: 'hudChrome.corpseHarvest.components.hide',
  fang: 'hudChrome.corpseHarvest.components.fang',
  silk: 'hudChrome.corpseHarvest.components.silk',
  venomSac: 'hudChrome.corpseHarvest.components.venomSac',
  gills: 'hudChrome.corpseHarvest.components.gills',
  claw: 'hudChrome.corpseHarvest.components.claw',
  horn: 'hudChrome.corpseHarvest.components.horn',
  tusk: 'hudChrome.corpseHarvest.components.tusk',
};

function componentLabel(tag: string): string {
  const key = COMPONENT_LABEL_KEYS[tag];
  return key ? t(key as TranslationKey) : tag;
}

/** Append the harvest picker section into a container (the loot window body). */
export function renderCorpseHarvestPicker(
  container: HTMLElement,
  view: CorpseHarvestViewModel,
  deps: CorpseHarvestPainterDeps,
): void {
  if (view.rows.length === 0) return;
  const section = document.createElement('div');
  section.className = 'corpse-harvest';
  section.innerHTML = `<div class="corpse-harvest-title">${esc(t('hudChrome.corpseHarvest.title'))}</div>
    <div class="corpse-harvest-hint">${esc(t('hudChrome.corpseHarvest.concentrateHint'))}</div>`;
  const list = document.createElement('div');
  list.className = 'corpse-harvest-list';
  for (const row of view.rows) {
    const label = document.createElement('label');
    label.className = 'corpse-harvest-row';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'corpse-harvest-check';
    box.checked = row.checked;
    box.value = row.tag;
    box.setAttribute(
      'aria-label',
      t('hudChrome.corpseHarvest.componentAria', { component: componentLabel(row.tag) }),
    );
    const span = document.createElement('span');
    span.textContent = componentLabel(row.tag);
    label.appendChild(box);
    label.appendChild(span);
    list.appendChild(label);
  }
  section.appendChild(list);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn corpse-harvest-btn';
  btn.textContent = t('hudChrome.corpseHarvest.harvestButton');
  btn.title = t('hudChrome.corpseHarvest.harvestButtonTooltip');
  btn.disabled = view.harvestDisabled;
  btn.addEventListener('click', () => {
    const chosen = [...list.querySelectorAll<HTMLInputElement>('.corpse-harvest-check')]
      .filter((c) => c.checked)
      .map((c) => c.value);
    deps.onHarvest(chosen);
  });
  section.appendChild(btn);
  container.appendChild(section);
}
