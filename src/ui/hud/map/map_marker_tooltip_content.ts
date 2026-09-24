// Localized HTML for map marker tooltips. This domain helper owns the gather
// resolve memo and quest grouping so Hud only supplies the current IWorld and
// routes the finished string to the shared tooltip painter. A world quest marker
// paints the rich hover card (world_quest_tooltip_view.ts + _html.ts).

import { QUESTS } from '../../../sim/data';
import type { QuestObjectiveRef } from '../../../sim/quest_targets';
import { type ItemDef, questObjectiveRequired } from '../../../sim/types';
import type { IWorld } from '../../../world_api';
import { tEntity } from '../../entity_i18n';
import { esc } from '../../esc';
import { gatherNodeTooltipHtml } from '../../gather_node_tooltip_controller';
import { formatNumber, t } from '../../i18n';
import { type MapGatherTipMemo, resolveGatherTipMemo } from '../../map_gather_tip_memo';
import type {
  MapFarmPatchMarker,
  MapGatherNodeMarker,
  MapNpcMarker,
  MapServiceMarker,
  MapStationMarker,
  MapWorldBossMarker,
  MapWorldQuestMarker,
} from '../../map_window_view';
import { questMarkerTooltipTag } from '../../quest_marker_tags';
import {
  worldQuestDef,
  worldQuestDisplayName,
  worldQuestObjectiveLabel,
  worldQuestRewardLine,
  worldQuestTimeRemainingText,
} from '../../world_quest_view';
import { stationNameText } from '../professions/crafting_window';
import { buildGatherNodeTooltip } from '../professions/gathering_view';
import { worldQuestTooltipHtml } from './world_quest_tooltip_html';
import { buildWorldQuestTooltip } from './world_quest_tooltip_view';

function questTitle(questId: string): string {
  return tEntity({ kind: 'quest', id: questId, field: 'title' });
}

function questObjectiveLabel(questId: string, objectiveIndex: number): string {
  return tEntity({
    kind: 'questObjective',
    questId,
    objectiveIndex,
    field: 'label',
  });
}

function questNumber(value: number): string {
  return formatNumber(value, { maximumFractionDigits: 0 });
}

function questProgressText(label: string, current: number, total: number): string {
  return t('questUi.detail.objectiveProgress', {
    label,
    current: questNumber(current),
    total: questNumber(total),
  });
}

/** Host-supplied presentation the tooltips embed but this module cannot build. */
export interface MapMarkerTooltipContentDeps {
  /** The shared item tooltip card (Hud.itemTooltip); a world quest item reward
   *  embeds it. Without it the reward shows its name and item level only. */
  itemTooltip?(item: ItemDef): string;
}

export class MapMarkerTooltipContent {
  private gatherMemo: MapGatherTipMemo | null = null;

  constructor(
    private readonly world: IWorld,
    private readonly deps: MapMarkerTooltipContentDeps = {},
  ) {}

  clearMemo(): void {
    this.gatherMemo = null;
  }

  npc(marker: MapNpcMarker): string {
    let html = '';
    for (const ref of marker.quests) {
      const quest = QUESTS[ref.questId];
      if (!quest) continue;
      const tag = questMarkerTooltipTag(ref.kind);
      const tagHtml = tag ? ` <span class="${tag.cls}">(${esc(t(tag.key))})</span>` : '';
      html += `<div class="tt-title">${esc(questTitle(ref.questId))}${tagHtml}</div>`;
      if (quest.minLevel) {
        html += `<div class="tt-quest-req">${esc(
          t('questUi.detail.requiresLevel', { level: questNumber(quest.minLevel) }),
        )}</div>`;
      }
    }
    return html;
  }

  station(marker: MapStationMarker): string {
    return `<div class="tt-title">${esc(stationNameText(marker.type))}</div>`;
  }

  service(marker: MapServiceMarker): string {
    const key =
      marker.kind === 'mailbox' ? 'worldContent.mailboxName' : 'worldContent.noticeboardName';
    return `<div class="tt-title">${esc(t(key))}</div>`;
  }

  // Every farming patch is the same kind of place, one per farming hub, so the
  // pin needs no per-site name: the zone map is already zone-scoped, which is
  // what tells the four sites apart. Same shape as service() above.
  farm(_marker: MapFarmPatchMarker): string {
    return `<div class="tt-title">${esc(t('worldContent.farmPatchName'))}</div>`;
  }

  navigation(text: string): string {
    return `<div class="tt-title">${esc(text)}</div>`;
  }

  gather(marker: MapGatherNodeMarker): string {
    this.gatherMemo = resolveGatherTipMemo(this.gatherMemo, marker.nodeId, (nodeId) => {
      const model = buildGatherNodeTooltip(this.world, nodeId);
      return model ? gatherNodeTooltipHtml(model) : '';
    });
    return this.gatherMemo.html;
  }

  worldQuest(marker: MapWorldQuestMarker, nowMs: number): string {
    const quest = worldQuestDef(marker.questId);
    if (!quest) return '';
    const model = buildWorldQuestTooltip({
      quest,
      progressCount: this.world.worldQuestLog.get(marker.questId)?.count ?? 0,
      playerLevel: this.world.player.level,
      expiresAtMs: this.world.worldQuestExpiresAtMs,
      nowMs,
    });
    return worldQuestTooltipHtml(model, this.deps);
  }

  /** Plain-text counterpart used by the map's always-present screen-reader summary. */
  worldQuestSemantic(questId: string, nowMs: number): string {
    const quest = worldQuestDef(questId);
    if (!quest) return questId;
    const progress = this.world.worldQuestLog.get(questId);
    const current = Math.min(progress?.count ?? 0, quest.count);
    const values = {
      name: worldQuestDisplayName(questId),
      progress: questProgressText(worldQuestObjectiveLabel(questId), current, quest.count),
      reward: worldQuestRewardLine(quest, this.world.player.level),
    };
    const time = worldQuestTimeRemainingText(this.world.worldQuestExpiresAtMs, nowMs);
    return time
      ? t('questUi.worldQuest.semanticSummaryTimed', { ...values, time })
      : t('questUi.worldQuest.semanticSummary', values);
  }

  worldBoss(marker: MapWorldBossMarker): string {
    const name = tEntity({ kind: 'mob', id: marker.bossId, field: 'name' });
    return `<div class="tt-title">${esc(name)}</div>`;
  }

  questArea(refs: readonly QuestObjectiveRef[], activeCount: number): string {
    const byQuest = new Map<string, number[]>();
    for (let refIndex = 0; refIndex < activeCount; refIndex++) {
      const ref = refs[refIndex];
      const list = byQuest.get(ref.questId);
      if (list) list.push(ref.objectiveIndex);
      else byQuest.set(ref.questId, [ref.objectiveIndex]);
    }
    let html = '';
    for (const [questId, objectiveIndexes] of byQuest) {
      const quest = QUESTS[questId];
      const progress = this.world.questLog.get(questId);
      if (!quest || !progress) continue;
      let lines = '';
      for (const objectiveIndex of objectiveIndexes) {
        const objective = quest.objectives[objectiveIndex];
        if (!objective) continue;
        const required = questObjectiveRequired(quest, progress, objectiveIndex);
        const current = Math.min(progress.counts[objectiveIndex] ?? 0, required);
        lines += `<div>${esc(
          questProgressText(questObjectiveLabel(questId, objectiveIndex), current, required),
        )}</div>`;
      }
      if (lines) html += `<div class="tt-title">${esc(questTitle(questId))}</div>${lines}`;
    }
    return html;
  }
}
