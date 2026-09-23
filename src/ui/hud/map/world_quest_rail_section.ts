// The map rail's world-quest section painter: a cold string builder the
// MapSidebarController splices between the tracked-quest actions and the
// "available nearby" list. Every value passes through esc() and every string is
// a catalog key; the row and button carry data attributes the controller's one
// click dispatcher reads (`data-map-wq`, `data-map-wq-reroll`).

import { zoneDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import { formatNumber, type TranslationKey, t } from '../../i18n';
import { worldQuestDisplayName, worldQuestTimeRemainingText } from '../../world_quest_view';
import type { WorldQuestRailRow, WorldQuestRailView } from './world_quest_rail_view';

const whole = (value: number): string => formatNumber(value, { maximumFractionDigits: 0 });
const factionKey = (id: WorldQuestRailRow['factionId']): TranslationKey =>
  `hudChrome.reputation.faction.${id}` as TranslationKey;
const stateKey = (state: WorldQuestRailRow['state']): TranslationKey =>
  `hudChrome.mapAtlas.worldQuests.state.${state}` as TranslationKey;

function rowHtml(row: WorldQuestRailRow): string {
  const classes = [
    'map-atlas-wq',
    'ui-card',
    `is-${row.state}`,
    row.selected ? 'is-selected' : '',
    row.belowLevel ? 'is-below-level' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const chip =
    row.state === 'available'
      ? ''
      : `<span class="map-atlas-wq-state ui-chip">${esc(t(stateKey(row.state)))}</span>`;
  const replaced = row.replacement
    ? `<span class="map-atlas-wq-replaced">${esc(t('hudChrome.mapAtlas.worldQuests.replacement'))}</span>`
    : '';
  return `<button type="button" class="${classes}" data-map-wq="${esc(row.questId)}" aria-pressed="${row.selected}"><span class="map-atlas-wq-copy"><span class="map-atlas-wq-title">${esc(worldQuestDisplayName(row.questId))}</span><span class="map-atlas-wq-meta"><span>${esc(zoneDisplayName(row.zoneId))}</span><span class="map-atlas-wq-faction is-${esc(row.factionId)}">${esc(t(factionKey(row.factionId)))}</span></span></span>${chip}${replaced}</button>`;
}

/** The section's markup: heading with the day's count, the rows, the reroll control. */
export function worldQuestRailSectionHtml(view: WorldQuestRailView, nowMs: number): string {
  const count = t('hudChrome.mapAtlas.worldQuests.count', {
    done: whole(view.completed),
    total: whole(view.total),
  });
  const expiry =
    view.expiresAtMs > nowMs
      ? `<p class="map-atlas-wq-expiry ui-meta ui-muted">${esc(worldQuestTimeRemainingText(view.expiresAtMs, nowMs))}</p>`
      : '';
  const rows = view.rows.map(rowHtml).join('');
  const list =
    rows || `<p class="map-atlas-empty">${esc(t('hudChrome.mapAtlas.worldQuests.empty'))}</p>`;
  const reroll = view.reroll;
  const note = reroll.usedToday
    ? t('hudChrome.mapAtlas.worldQuests.rerollUsed')
    : reroll.questId && !reroll.canReroll && reroll.reason
      ? t(`hudChrome.mapAtlas.worldQuests.rerollReason.${reroll.reason}` as TranslationKey)
      : t('hudChrome.mapAtlas.worldQuests.rerollNote');
  const button = `<button type="button" class="map-atlas-wq-reroll ui-btn ui-btn--gold" data-map-wq-reroll="${esc(reroll.questId ?? '')}"${reroll.canReroll ? '' : ' disabled'}>${esc(t('hudChrome.mapAtlas.worldQuests.reroll'))}</button>`;
  return `<section class="map-atlas-section map-atlas-wq-section"><h3 class="map-atlas-heading">${esc(t('hudChrome.mapAtlas.worldQuests.heading'))} <span class="map-atlas-wq-count">${esc(count)}</span></h3>${expiry}<div class="map-atlas-wq-list">${list}</div><div class="map-atlas-wq-actions">${button}<p class="map-atlas-wq-note ui-meta ui-muted">${esc(note)}</p></div></section>`;
}
