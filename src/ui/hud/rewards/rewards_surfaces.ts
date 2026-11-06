// Composition of the Rewards hub (menu consolidation step 7): the hub
// controller and its three member windows, built in one place so the Hud
// coordinator holds one field and forwards a handful of calls. Each member
// keeps its own root, painter, focus return and close route; the hub shows one
// at a time behind the Rewards rail button (the generic hub family in
// src/ui/hud/hub/).

import type { IWorld } from '../../../world_api';
import type { PainterHostPresentation } from '../../painter_host';
import { WeeklyQuestsWindow } from '../../weekly_quests_window';
import type { WindowFocusBridge } from '../../window_focus';
import { WindowHubController } from '../hub/window_hub_controller';
import {
  REWARDS,
  type RewardsClaimCounts,
  type RewardsMapPoint,
  type RewardsTab,
  rewardsClaimCounts,
} from './rewards_view';
import { WeeklyVaultWindow } from './weekly_vault_window';
import { WorldQuestsWindow, worldQuestBoardView } from './world_quests_window';

export interface RewardsSurfaceHost {
  world(): IWorld;
  root(selector: string): HTMLElement;
  focus(selector: string): WindowFocusBridge;
  presentation: PainterHostPresentation;
  touch(): boolean;
  /** Close every other window before the hub opens (Hud.closeOtherWindows). */
  beforeOpen(): void;
  onInventoryChanged(): void;
  hideTooltip(): void;
  /** Pan the open map to a point (Hud.showFinderOnMap). */
  showOnMap(x: number, z: number): void;
  /** The map's world-quest pin selection, shared with the World Quests tab. */
  selectedWorldQuest(): string | null;
  selectWorldQuest(questId: string | null): void;
  confirmDialog(title: string, body: string, ok: string, cancel: string, onOk: () => void): void;
  nowMs(): number;
}

export interface RewardsSurfaces {
  readonly hub: WindowHubController<RewardsTab>;
  readonly vault: WeeklyVaultWindow;
  readonly weekly: WeeklyQuestsWindow;
  readonly worldQuests: WorldQuestsWindow;
  /** The rail pill's counts (the tabs read the same inputs), as of the last
   *  slow-band refresh. */
  claimCounts(): RewardsClaimCounts;
  /** Slow band: recount the pill (no DOM; the rail painter shows it). Each
   *  member refreshes on its own Hud row, behind its own signature. */
  recount(): void;
}

export function createRewardsSurfaces(host: RewardsSurfaceHost): RewardsSurfaces {
  const hub: WindowHubController<RewardsTab> = new WindowHubController(REWARDS, {
    members: () => ({ vault, weekly, worldQuests }),
    touch: () => host.touch(),
    beforeOpen: () => host.beforeOpen(),
  });
  const vault = new WeeklyVaultWindow({
    root: () => host.root('#weekly-vault-window'),
    world: () => host.world(),
    presentation: host.presentation,
    onInventoryChanged: () => host.onInventoryChanged(),
    hideTooltip: () => host.hideTooltip(),
    closeOthers: () => hub.prepare('vault'),
    ...host.focus('#weekly-vault-window'),
    hubStrip: hub.stripFor('vault'),
  });
  const weekly = new WeeklyQuestsWindow({
    root: () => host.root('#weekly-quests-window'),
    world: () => host.world(),
    closeOthers: () => hub.prepare('weekly'),
    ...host.focus('#weekly-quests-window'),
    hubStrip: hub.stripFor('weekly'),
    showOnMap: (x, z) => host.showOnMap(x, z),
  });
  const worldQuests = new WorldQuestsWindow({
    root: () => host.root('#world-quests-window'),
    world: () => host.world(),
    nowMs: () => host.nowMs(),
    selectedId: () => host.selectedWorldQuest(),
    select: (questId) => host.selectWorldQuest(questId),
    showOnMap: (questId: string, point: RewardsMapPoint) => {
      host.selectWorldQuest(questId);
      host.showOnMap(point.x, point.z);
    },
    confirmDialog: (title, body, ok, cancel, onOk) =>
      host.confirmDialog(title, body, ok, cancel, onOk),
    closeOthers: () => hub.prepare('worldQuests'),
    ...host.focus('#world-quests-window'),
    hubStrip: hub.stripFor('worldQuests'),
  });
  const recount = (): RewardsClaimCounts => {
    const world = host.world();
    return rewardsClaimCounts({
      vaultReadyWeeks: world.weeklyRewardInfo?.readyWeeks,
      weeklyQuest: world.weeklyQuest,
      worldQuestsCompleted: worldQuestBoardView(world, null).completed,
    });
  };
  let counts: RewardsClaimCounts | null = null;
  return {
    hub,
    vault,
    weekly,
    worldQuests,
    claimCounts: () => {
      counts ??= recount();
      return counts;
    },
    recount: () => {
      counts = recount();
    },
  };
}
