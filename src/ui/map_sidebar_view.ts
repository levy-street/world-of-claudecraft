// Pure view model for the World Map atlas rail. The rail reads the same quest
// log insertion order as map_window_view so its numbers stay identical to the
// gold objective badges painted on the map. DOM and localization stay in the
// controller; this core only returns content identities, counts, and routes.
//
// Menu consolidation step 8 put the rail on a diet: it is the map's legend
// (the numbered tracked quests with Show Route, the layer filters, the zone
// summary) plus one link to the Quest Log. Untrack and the nearby offers moved
// to the Quest Log (offers: hud/quest/available_quests_view.ts) and the
// world-quest board to the Rewards hub.

import { QUESTS, type ZoneDef } from '../sim/data';
import { type QuestProgress, questObjectiveRequired } from '../sim/types';
import type { IWorld } from '../world_api';
import { ownEntry } from './known_item';
import { questNumbersByLog } from './map_quest_list_view';
import {
  liveNpcPosLookup,
  type QuestMapLocation,
  questMapLocation,
} from './quest_map_location_core';

export type MapAtlasFilterId = 'quests' | 'gather' | 'dungeons' | 'services' | 'players';

export interface MapAtlasFilters {
  quests: boolean;
  gather: boolean;
  dungeons: boolean;
  services: boolean;
  players: boolean;
}

/** Every layer on. The board draws Services off in its sample state, but the
 *  shipped map paints every marker family, so the opening state keeps them all
 *  and the chips are the player's own switch. */
export const DEFAULT_MAP_ATLAS_FILTERS: Readonly<MapAtlasFilters> = Object.freeze({
  quests: true,
  gather: true,
  dungeons: true,
  services: true,
  players: true,
});

export interface MapAtlasQuestRow {
  questId: string;
  number: number;
  ready: boolean;
  selected: boolean;
  objectiveIndex: number | null;
  current: number;
  required: number;
}

/** Where "Show Route" pans to. The resolution rule is shared with the quest log's
 *  "Show on Map" (quest_map_location_core), so the two controls never disagree. */
export type MapAtlasRoute = QuestMapLocation;

export interface MapSidebarView {
  zoneId: string;
  levelRange: readonly [number, number];
  landmarkCount: number;
  filters: Readonly<MapAtlasFilters>;
  quests: MapAtlasQuestRow[];
  selectedQuestId: string | null;
  route: MapAtlasRoute | null;
}

export interface MapSidebarViewInput {
  world: Pick<IWorld, 'questLog' | 'entities'>;
  zone: ZoneDef;
  filters: Readonly<MapAtlasFilters>;
  selectedQuestId: string | null;
  /** Quests this client has untracked (quest_tracking_core). Presentation only:
   *  the quest stays in the log and keeps its acceptance-order number, it just
   *  leaves this rail, the map badges, and the HUD tracker. */
  untrackedQuestIds?: ReadonlySet<string>;
}

export function toggleMapAtlasFilter(
  filters: Readonly<MapAtlasFilters>,
  id: MapAtlasFilterId,
): MapAtlasFilters {
  return { ...filters, [id]: !filters[id] };
}

/** The default tracking set: nothing untracked, so every accepted quest shows. */
const NO_UNTRACKED_QUESTS: ReadonlySet<string> = new Set<string>();

/**
 * Everything the rail's markup is derived from, as one comparable string: the
 * whole view plus the chrome state the view itself does not carry. Serialized wholesale rather than field by field
 * so a view field added later cannot silently fall out of the comparison and
 * leave the rail stale, and the i18n revision rides along because the markup
 * this gates resolves every label through t().
 */
export function mapSidebarSignature(
  view: MapSidebarView,
  chrome: {
    shownRouteQuestId: string | null;
    i18nRevision: number;
    trackingRevision: number;
    /** The player's own collapse choice: folded in because it changes the
     *  toggle button's aria-expanded and title text, which the view itself
     *  carries no field for. */
    sidebarCollapsed: boolean;
  },
): string {
  return JSON.stringify({ view, chrome });
}

function primaryObjective(progress: QuestProgress): {
  objectiveIndex: number | null;
  current: number;
  required: number;
} {
  const quest = ownEntry(QUESTS, progress.questId);
  if (!quest || quest.objectives.length === 0) {
    return { objectiveIndex: null, current: 0, required: 0 };
  }
  let objectiveIndex = quest.objectives.length - 1;
  for (let index = 0; index < quest.objectives.length; index++) {
    const required = questObjectiveRequired(quest, progress, index);
    if ((progress.counts[index] ?? 0) < required) {
      objectiveIndex = index;
      break;
    }
  }
  return {
    objectiveIndex,
    current: progress.counts[objectiveIndex] ?? 0,
    required: questObjectiveRequired(quest, progress, objectiveIndex),
  };
}

export function buildMapSidebarView(input: MapSidebarViewInput): MapSidebarView {
  const quests: MapAtlasQuestRow[] = [];
  const untracked = input.untrackedQuestIds ?? NO_UNTRACKED_QUESTS;
  // Resolved BEFORE the rows are built, so a selection that has left the log or
  // the tracked set can never mark a row selected on its way out.
  let selectedQuestId = input.selectedQuestId;
  if (
    selectedQuestId !== null &&
    (!input.world.questLog.has(selectedQuestId) || untracked.has(selectedQuestId))
  ) {
    selectedQuestId = null;
  }
  // The SAME numbering the map paints on its gold objective badges, so a rail
  // row and its badge can never drift apart. It is taken over the WHOLE log, so
  // an untracked quest leaves a gap rather than renumbering the ones after it.
  const numbers = questNumbersByLog(input.world.questLog);
  for (const progress of input.world.questLog.values()) {
    if (untracked.has(progress.questId)) continue;
    const objective = primaryObjective(progress);
    quests.push({
      questId: progress.questId,
      number: numbers.get(progress.questId) ?? 0,
      ready: progress.state === 'ready',
      selected: progress.questId === selectedQuestId,
      ...objective,
    });
  }
  return {
    zoneId: input.zone.id,
    levelRange: input.zone.levelRange,
    landmarkCount: input.zone.pois.filter((poi) => poi.hideOnMap !== true).length,
    filters: input.filters,
    quests,
    selectedQuestId,
    route: questMapLocation(
      selectedQuestId,
      input.world.questLog,
      liveNpcPosLookup(input.world.entities),
    ),
  };
}
