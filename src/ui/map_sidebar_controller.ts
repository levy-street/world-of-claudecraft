// Cold DOM adapter for the World Map atlas rail. Hud supplies the current
// world/zone whenever its existing map redraw path runs and may consume the
// filter and route callbacks without this module reaching into Hud.
//
// WHOLE-RAIL innerHTML, the documented exception: this adapter builds the whole
// rail as one string and swaps it in, rather than driving a keyed row pool
// through the PainterHost writers the way every per-frame painter does. The
// cadence is what makes that acceptable, and it is the whole argument: the rail
// repaints only when the map redraw path runs or the player clicks a chip, a
// quest row, Show Route or Untrack. It is never on the frame band, so there is
// no per-frame write budget to blow and no skip-rate to hold. `lastHtml` below
// is the write elision that keeps an unchanged rail free, and `lastSig` (the
// bucketed view plus the i18n revision) stops an unchanged rail from paying the
// markup mint at all (it is registered in
// tests/language_fanout_registry.test.ts as a write-elision memo, not a data
// signature, because the compared string is the freshly BUILT html with every
// t() value already resolved). What the swap DOES cost is the focused node, so
// the render path captures the active control's data-map-* identity and
// re-focuses the matching node after the swap; a keyboard or controller user
// keeps their place. If the rail ever moves onto the frame band, that is the
// signal to replace the string with a keyed row pool.

import { QUESTS, type ZoneDef } from '../sim/data';
import type { IWorld } from '../world_api';
import { questObjectiveLabel, questTitle } from './entity_display_core';
import { zoneDisplayName } from './entity_i18n';
import { esc } from './esc';
import { formatNumber, getI18nRevision, type TranslationKey, t } from './i18n';
import { ownEntry } from './known_item';
import {
  bucketMapAtlasDistance,
  buildMapSidebarView,
  DEFAULT_MAP_ATLAS_FILTERS,
  type MapAtlasFilterId,
  type MapAtlasFilters,
  type MapAtlasRoute,
  mapSidebarSignature,
  toggleMapAtlasFilter,
} from './map_sidebar_view';
import { type QuestTrackingState, sharedQuestTracking } from './quest_tracking_core';

const FILTERS: readonly MapAtlasFilterId[] = [
  'quests',
  'gather',
  'dungeons',
  'services',
  'players',
];

/** One explicit key per layer chip (one literal key per row, never a built template).
 *  A computed `filters.${id}` key hides a typo from both tsc and the i18n
 *  completeness sweep; spelling every key out puts it back in front of them. */
const FILTER_KEYS: Record<MapAtlasFilterId, TranslationKey> = {
  quests: 'hudChrome.mapAtlas.filters.quests',
  gather: 'hudChrome.mapAtlas.filters.gather',
  dungeons: 'hudChrome.mapAtlas.filters.dungeons',
  services: 'hudChrome.mapAtlas.filters.services',
  players: 'hudChrome.mapAtlas.filters.players',
};

/** The data-* attributes that identify an interactive rail control. Order is the
 *  match order, and every one of them is a literal from this list, so the
 *  attribute selector the focus restore builds can never carry player data. */
const FOCUS_ATTRS = [
  'data-map-filter',
  'data-map-quest',
  'data-map-route',
  'data-map-untrack',
] as const;

/** Which control held focus, as an attribute plus its value (null for the two
 *  valueless controls). Compared by getAttribute after the swap, so a quest id
 *  never has to be escaped into a selector. */
interface RailFocus {
  attr: (typeof FOCUS_ATTRS)[number];
  value: string | null;
}

function mapQuestTitle(questId: string): string {
  return ownEntry(QUESTS, questId)
    ? questTitle(questId)
    : t('questUi.tracker.unknownQuest', { id: questId });
}

export interface MapSidebarControllerDeps {
  root(): HTMLElement;
  click(): void;
  /** Repaint the open map: the layer chips and the tracking set both change what
   *  the canvas draws, and the rail cannot reach the canvas itself. */
  onRepaintMap(): void;
  onShowRoute(route: MapAtlasRoute): void;
  /** Injectable tracking set; production leaves it out and shares the HUD's one. */
  tracking?: QuestTrackingState;
}

export class MapSidebarController {
  private filters: MapAtlasFilters = { ...DEFAULT_MAP_ATLAS_FILTERS };
  private selectedQuestId: string | null = null;
  private route: MapAtlasRoute | null = null;
  private initializedSelection = false;
  private world: IWorld | null = null;
  private zone: ZoneDef | null = null;
  private mountedRoot: HTMLElement | null = null;
  // Write elision, not a data signature: the compared string is the freshly
  // BUILT html with every t() value already resolved, so a language switch
  // moves it and the rail repaints itself (see language_fanout_registry).
  private lastHtml = '';
  // The same elision one step earlier, so a walking player does not pay the
  // whole markup mint (dozens of t() and Intl formatNumber calls) per update
  // just to throw the result away. It carries getI18nRevision(), so a locale
  // switch moves it exactly like lastHtml does.
  private lastSig = '';

  constructor(private readonly deps: MapSidebarControllerDeps) {}

  /** Resolved per call rather than in a field, so the shared instance is not
   *  minted at construction time (field initializer order against the injected
   *  dep is not worth relying on). */
  private tracking(): QuestTrackingState {
    return this.deps.tracking ?? sharedQuestTracking();
  }

  filterState(): Readonly<MapAtlasFilters> {
    return this.filters;
  }

  shownRoute(): MapAtlasRoute | null {
    return this.route;
  }

  update(world: IWorld, zone: ZoneDef): void {
    this.world = world;
    this.zone = zone;
    this.tracking().useCharacter(world.cfg.playerClass, world.player.name);
    if (!this.initializedSelection) {
      this.selectedQuestId = this.firstTrackedQuestId(world);
      this.initializedSelection = true;
    }
    this.render();
  }

  /** The opening selection: the first quest the player still tracks, never an
   *  untracked one (which the view would drop again on the very next build). */
  private firstTrackedQuestId(world: IWorld): string | null {
    const tracking = this.tracking();
    for (const questId of world.questLog.keys()) {
      if (tracking.isTracked(questId)) return questId;
    }
    return null;
  }

  /** The data-map-* identity of the focused control, or null when focus is
   *  outside the rail (in which case the swap steals nothing and restoring
   *  would be the theft). */
  private capturedFocus(root: HTMLElement): RailFocus | null {
    const active = document.activeElement as HTMLElement | null;
    if (!active || active === root || !root.contains(active)) return null;
    for (const attr of FOCUS_ATTRS) {
      const control = active.closest<HTMLElement>(`[${attr}]`);
      if (control) return { attr, value: control.getAttribute(attr) };
    }
    return null;
  }

  private restoreFocus(root: HTMLElement, focus: RailFocus): void {
    for (const candidate of root.querySelectorAll<HTMLElement>(`[${focus.attr}]`)) {
      if (candidate.getAttribute(focus.attr) === focus.value) {
        candidate.focus();
        return;
      }
    }
  }

  private mount(): HTMLElement {
    const root = this.deps.root();
    if (this.mountedRoot === root) return root;
    this.mountedRoot?.removeEventListener('click', this.onClick);
    root.addEventListener('click', this.onClick);
    this.mountedRoot = root;
    return root;
  }

  private render(): void {
    const world = this.world;
    const zone = this.zone;
    if (!world || !zone) return;
    const tracking = this.tracking();
    const model = buildMapSidebarView({
      world,
      zone,
      filters: this.filters,
      selectedQuestId: this.selectedQuestId,
      untrackedQuestIds: tracking.untrackedIds(),
    });
    this.selectedQuestId = model.selectedQuestId;
    if (this.route !== null) {
      this.route = model.route?.questId === this.route.questId ? model.route : null;
    }
    const signature = mapSidebarSignature(model, {
      shownRouteQuestId: this.route?.questId ?? null,
      i18nRevision: getI18nRevision(),
      // Untracking moves nothing in the view a walking player also moves, so the
      // rail would keep painting the row it just dropped without this counter.
      trackingRevision: tracking.revision(),
    });
    if (signature === this.lastSig) return;
    this.lastSig = signature;
    const levelRange = t('hudChrome.continentMap.levels', {
      min: formatNumber(model.levelRange[0], { maximumFractionDigits: 0 }),
      max: formatNumber(model.levelRange[1], { maximumFractionDigits: 0 }),
    });
    const filters = FILTERS.map((id) => {
      const on = model.filters[id];
      return `<button type="button" class="map-atlas-filter ui-seg-tab${on ? ' is-on' : ''}" data-map-filter="${id}" aria-pressed="${on}">${esc(t(FILTER_KEYS[id]))}</button>`;
    }).join('');
    const quests = model.quests
      .map((quest) => {
        const title = mapQuestTitle(quest.questId);
        const objective =
          quest.ready || quest.objectiveIndex === null
            ? `<span class="map-atlas-ready ui-chip">${esc(t('questUi.tracker.complete'))}</span>`
            : `<span class="map-atlas-objective">${esc(
                t('questUi.detail.objectiveProgress', {
                  label: questObjectiveLabel(quest.questId, quest.objectiveIndex),
                  current: formatNumber(quest.current, { maximumFractionDigits: 0 }),
                  total: formatNumber(quest.required, { maximumFractionDigits: 0 }),
                }),
              )}</span>`;
        return `<button type="button" class="map-atlas-quest ui-card${quest.selected ? ' is-selected' : ''}${quest.ready ? ' is-ready' : ''}" data-map-quest="${esc(quest.questId)}" aria-pressed="${quest.selected}"><span class="map-atlas-quest-number">${formatNumber(quest.number, { maximumFractionDigits: 0 })}</span><span class="map-atlas-quest-copy"><span class="map-atlas-quest-title">${esc(title)}</span>${objective}</span></button>`;
      })
      .join('');
    const nearby = model.nearby
      .map((quest) => {
        const level =
          quest.minLevel === null
            ? ''
            : ` · ${esc(t('hudChrome.mapAtlas.level', { level: formatNumber(quest.minLevel, { maximumFractionDigits: 0 }) }))}`;
        return `<div class="map-atlas-nearby-row"><span>${esc(mapQuestTitle(quest.questId))}</span><span>${esc(zoneDisplayName(quest.zoneId))}${level} · ${esc(t('hudChrome.mapAtlas.distance', { distance: formatNumber(bucketMapAtlasDistance(quest.distance), { maximumFractionDigits: 0 }) }))}</span></div>`;
      })
      .join('');
    const root = this.mount();
    const html =
      `<header class="map-atlas-zone"><h2 class="ui-cin">${esc(zoneDisplayName(model.zoneId))}</h2><p class="ui-meta ui-muted">${esc(levelRange)} · ${esc(t('hudChrome.mapAtlas.landmarkCount', { count: formatNumber(model.landmarkCount, { maximumFractionDigits: 0 }) }))}</p></header>` +
      `<div class="map-atlas-filters ui-seg" role="group" aria-label="${esc(t('hudChrome.mapAtlas.filtersAria'))}">${filters}</div>` +
      `<section class="map-atlas-section"><h3 class="map-atlas-heading">${esc(t('hudChrome.mapAtlas.trackedQuests'))}</h3><div class="map-atlas-quest-list">${quests || `<p class="map-atlas-empty">${esc(t('hudChrome.mapAtlas.noTrackedQuests'))}</p>`}</div></section>` +
      `<div class="map-atlas-actions"><button type="button" class="map-atlas-route ui-btn ui-btn--red" data-map-route aria-pressed="${this.route?.questId === model.selectedQuestId}"${model.route ? '' : ' disabled'}>${esc(t('hudChrome.mapAtlas.showRoute'))}</button><button type="button" class="map-atlas-untrack ui-btn" data-map-untrack${model.selectedQuestId ? '' : ' disabled'}>${esc(t('hudChrome.mapAtlas.untrack'))}</button></div>` +
      `<section class="map-atlas-section map-atlas-nearby"><h3 class="map-atlas-heading is-secondary">${esc(t('hudChrome.mapAtlas.availableNearby'))}</h3>${nearby || `<p class="map-atlas-empty">${esc(t('hudChrome.mapAtlas.noNearbyQuests'))}</p>`}</section>` +
      `<footer class="map-atlas-legend"><span><i class="map-atlas-legend-mark is-dungeon" aria-hidden="true"></i>${esc(t('hudChrome.mapAtlas.legend.dungeon'))}</span><span><i class="map-atlas-legend-mark is-ore" aria-hidden="true"></i>${esc(t('hudChrome.mapAtlas.legend.ore'))}</span><span><i class="map-atlas-legend-mark is-herb" aria-hidden="true"></i>${esc(t('hudChrome.mapAtlas.legend.herb'))}</span><span><i class="map-atlas-legend-mark is-mail" aria-hidden="true"></i>${esc(t('hudChrome.mapAtlas.legend.mail'))}</span><span><i class="map-atlas-legend-mark is-passage" aria-hidden="true"></i>${esc(t('hudChrome.mapAtlas.legend.passage'))}</span></footer>`;
    if (html === this.lastHtml) return;
    this.lastHtml = html;
    const focus = this.capturedFocus(root);
    root.innerHTML = html;
    if (focus) this.restoreFocus(root, focus);
  }

  private readonly onClick = (event: Event): void => {
    const target = event.target as HTMLElement;
    const filter = target.closest<HTMLElement>('[data-map-filter]')?.dataset.mapFilter as
      | MapAtlasFilterId
      | undefined;
    if (filter && FILTERS.includes(filter)) {
      this.filters = toggleMapAtlasFilter(this.filters, filter);
      this.deps.click();
      this.deps.onRepaintMap();
      this.render();
      return;
    }
    const questId = target.closest<HTMLElement>('[data-map-quest]')?.dataset.mapQuest;
    if (questId) {
      this.selectedQuestId = questId;
      this.route = null;
      this.deps.click();
      this.render();
      return;
    }
    if (target.closest('[data-map-route]')) {
      const route =
        this.world && this.zone
          ? buildMapSidebarView({
              world: this.world,
              zone: this.zone,
              filters: this.filters,
              selectedQuestId: this.selectedQuestId,
              untrackedQuestIds: this.tracking().untrackedIds(),
            }).route
          : null;
      if (route) {
        this.route = route;
        this.deps.click();
        this.deps.onShowRoute(route);
        this.render();
      }
      return;
    }
    if (target.closest('[data-map-untrack]') && this.selectedQuestId !== null) {
      // Local tracking only: the quest stays accepted and keeps earning credit,
      // it just leaves this rail, the map badges, and the HUD tracker until the
      // player tracks it again from the quest log.
      this.tracking().setTracked(this.selectedQuestId, false);
      this.selectedQuestId = null;
      this.route = null;
      this.deps.click();
      this.deps.onRepaintMap();
      this.render();
    }
  };
}
