// The map rail's world-quest section painter: a cold string builder the
// MapSidebarController splices between the tracked-quest actions and the
// "available nearby" list. Every value passes through esc() and every string is
// a catalog key; the row and buttons carry data attributes the controller's one
// click dispatcher reads (`data-map-wq`, `data-map-wq-track`, `data-map-wq-route`,
// `data-map-wq-reroll`). Track / Untrack and Show Route act on the selected row,
// the same pattern as the tracked-quest list above it.

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
    row.tracked ? 'is-tracked' : '',
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
/** The selected row's Track / Untrack and Show Route buttons (disabled with no
 *  selection, or once the selected quest is done). */
function selectionActionsHtml(view: WorldQuestRailView, routeShown: boolean): string {
  const sel = view.selection;
  const live = sel !== null && !sel.completed;
  const disabled = live ? '' : ' disabled';
  const trackKey: TranslationKey = sel?.tracked
    ? 'hudChrome.mapAtlas.untrack'
    : 'hudChrome.mapAtlas.track';
  const route = `<button type="button" class="map-atlas-route ui-btn ui-btn--red" data-map-wq-route aria-pressed="${live && routeShown}"${disabled}>${esc(t('hudChrome.mapAtlas.showRoute'))}</button>`;
  const track = `<button type="button" class="map-atlas-untrack ui-btn" data-map-wq-track aria-pressed="${sel?.tracked === true}"${disabled}>${esc(t(trackKey))}</button>`;
  return `<div class="map-atlas-actions map-atlas-wq-select-actions">${route}${track}</div>`;
}

/** `routeShown`: the map currently draws the route to the selected world quest. */
export function worldQuestRailSectionHtml(
  view: WorldQuestRailView,
  nowMs: number,
  routeShown = false,
): string {
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
  return `<section class="map-atlas-section map-atlas-wq-section"><h3 class="map-atlas-heading">${esc(t('hudChrome.mapAtlas.worldQuests.heading'))} <span class="map-atlas-wq-count">${esc(count)}</span></h3>${expiry}<div class="map-atlas-wq-list">${list}</div>${selectionActionsHtml(view, routeShown)}<div class="map-atlas-wq-actions">${button}<p class="map-atlas-wq-note ui-meta ui-muted">${esc(note)}</p></div></section>`;
}
