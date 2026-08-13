import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GATHER_NODES } from '../src/sim/data';
import type { QuestObjectiveRef } from '../src/sim/quest_targets';
import type { QuestProgress } from '../src/sim/types';
import { MapMarkerTooltipContent } from '../src/ui/hud/map/map_marker_tooltip_content';
import { setLanguage } from '../src/ui/i18n';
import type {
  MapGatherNodeMarker,
  MapNpcMarker,
  MapServiceMarker,
  MapStationMarker,
} from '../src/ui/map_window_view';
import type { IWorld } from '../src/world_api';

const GATHER_NODE = GATHER_NODES[0];

function makeWorld(
  options: {
    questLog?: Map<string, QuestProgress>;
    harvestable?: (nodeId: string) => boolean;
    respawnSeconds?: (nodeId: string) => number | null;
  } = {},
): IWorld {
  return {
    questLog: options.questLog ?? new Map(),
    inventory: [],
    gatheringProficiency: {},
    toolEffectSlots: [],
    nodeHarvestableByMe: options.harvestable ?? (() => true),
    nodeRespawnSeconds: options.respawnSeconds ?? (() => null),
  } as unknown as IWorld;
}

beforeEach(() => {
  setLanguage('en');
});

describe('MapMarkerTooltipContent', () => {
  it('renders localized quest-giver titles, status tags, and level requirements', () => {
    const content = new MapMarkerTooltipContent(makeWorld());
    const marker = {
      mx: 100,
      my: 100,
      kind: 'ready',
      quests: [
        { questId: 'q_wolves', kind: 'ready' },
        { questId: 'q_spiders', kind: 'available' },
        { questId: 'q_supplies', kind: 'cooldown' },
      ],
    } satisfies MapNpcMarker;

    const html = content.npc(marker);

    expect(html).toContain('Wolves at the Door');
    expect(html).toContain('<span class="quest-complete">(Complete)</span>');
    expect(html).toContain('Sableweb Menace');
    expect(html).toContain('Requires Level 2');
    expect(html).toContain('Stolen Supplies');
    expect(html).toContain('<span class="quest-cooldown">(Available again soon)</span>');
    expect(html).toContain('Requires Level 3');
  });

  it('renders localized crafting-station and civic-service identities', () => {
    const content = new MapMarkerTooltipContent(makeWorld());
    const station = {
      mx: 100,
      my: 100,
      stationId: 'forge-eastbrook',
      type: 'forge',
    } satisfies MapStationMarker;
    const mailbox = { mx: 100, my: 100, kind: 'mailbox' } satisfies MapServiceMarker;
    const noticeboard = {
      mx: 100,
      my: 100,
      kind: 'noticeboard',
    } satisfies MapServiceMarker;

    expect(content.station(station)).toBe('<div class="tt-title">Forge</div>');
    expect(content.service(mailbox)).toBe('<div class="tt-title">Mailbox</div>');
    expect(content.service(noticeboard)).toBe('<div class="tt-title">Notice Board</div>');
  });

  it('memoizes a gather resolve until its owner clears the memo after state changes', () => {
    let ready = false;
    const harvestable = vi.fn(() => ready);
    const respawnSeconds = vi.fn(() => 65);
    const content = new MapMarkerTooltipContent(makeWorld({ harvestable, respawnSeconds }));
    const marker = {
      mx: 100,
      my: 100,
      nodeId: GATHER_NODE.id,
      type: GATHER_NODE.type,
      ready: false,
      locked: true,
    } satisfies MapGatherNodeMarker;

    const cooldownHtml = content.gather(marker);
    expect(cooldownHtml).toContain('<div class="tt-title">Ore Vein</div>');
    expect(cooldownHtml).toContain('Respawns in 1:05');
    expect(content.gather(marker)).toBe(cooldownHtml);
    expect(harvestable).toHaveBeenCalledTimes(1);
    expect(respawnSeconds).toHaveBeenCalledTimes(1);

    ready = true;
    expect(content.gather(marker)).toBe(cooldownHtml);
    expect(harvestable).toHaveBeenCalledTimes(1);

    content.clearMemo();
    const readyHtml = content.gather({ ...marker, ready: true });
    expect(readyHtml).toContain('<div class="tt-green">Ready</div>');
    expect(readyHtml).not.toContain('Respawns in');
    expect(harvestable).toHaveBeenCalledTimes(2);
    expect(respawnSeconds).toHaveBeenCalledTimes(1);
  });

  it('groups active objective rows under one quest title and honors the active ref count', () => {
    const questLog = new Map<string, QuestProgress>([
      ['q_spiders', { questId: 'q_spiders', counts: [3, 2], state: 'active' }],
      ['q_wolves', { questId: 'q_wolves', counts: [12], state: 'ready' }],
      ['q_supplies', { questId: 'q_supplies', counts: [1], state: 'active' }],
    ]);
    const content = new MapMarkerTooltipContent(makeWorld({ questLog }));
    const refs = [
      { questId: 'q_spiders', objectiveIndex: 0 },
      { questId: 'q_wolves', objectiveIndex: 0 },
      { questId: 'q_spiders', objectiveIndex: 1 },
      { questId: 'q_supplies', objectiveIndex: 0 },
    ] satisfies QuestObjectiveRef[];

    const html = content.questArea(refs, 3);

    expect(html.split('Sableweb Menace')).toHaveLength(2);
    expect(html).toContain('Sableweb Lurker slain: 3/6');
    expect(html).toContain('Sableweb Silk Gland: 2/4');
    expect(html).toContain('Wolves at the Door');
    expect(html).toContain('Forest Wolf slain: 8/8');
    expect(html).not.toContain('Stolen Supplies');
  });
});
