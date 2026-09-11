import { describe, expect, it } from 'vitest';
import { NPCS, QUESTS, zoneAt } from '../src/sim/data';
import type { QuestProgress } from '../src/sim/types';
import {
  buildMapSidebarView,
  DEFAULT_MAP_ATLAS_FILTERS,
  toggleMapAtlasFilter,
} from '../src/ui/map_sidebar_view';
import type { IWorld } from '../src/world_api';

function progress(questId: string, state: QuestProgress['state'], current = 0): QuestProgress {
  return { questId, counts: [current], state };
}

function world(questLog: Map<string, QuestProgress>, available = new Set<string>()): IWorld {
  const giver = NPCS[QUESTS.q_wolves.giverNpcId];
  return {
    player: { name: 'Adventurer', pos: { x: giver.pos.x, y: 0, z: giver.pos.z } },
    questLog,
    questState: (questId: string) => (available.has(questId) ? 'available' : 'unavailable'),
  } as unknown as IWorld;
}

/**
 * The OFFLINE arm: the Sim hands the rail its live PlayerMeta quest log, one Map
 * that is mutated in place, so both the Map and every QuestProgress in it keep
 * their identity from one build to the next.
 */
function offlineWorld(entries: readonly QuestProgress[], available = new Set<string>()): IWorld {
  return world(new Map(entries.map((entry) => [entry.questId, entry])), available);
}

/**
 * The ONLINE arm: ClientWorld rebuilds `questLog` from the snapshot's `qlog`
 * array every time the field arrives (src/net/online.ts,
 * `new Map(s.qlog.map((q) => [q.questId, q]))`), so the rail sees a FRESH Map of
 * FRESH progress objects on each mirror, ordered by the server's array rather
 * than by a local accept order. Same input, therefore, but none of the identity
 * the offline arm has: the numbering has to come from the order alone.
 */
function mirroredWorld(qlog: readonly QuestProgress[], available = new Set<string>()): IWorld {
  const snapshot = qlog.map((entry) => ({ ...entry, counts: [...entry.counts] }));
  return world(new Map(snapshot.map((entry) => [entry.questId, entry])), available);
}

type Zone = ReturnType<typeof zoneAt>;

/** The NPCs standing inside `zone`, in the content order the rail reads them in. */
function npcsInZone(zone: Zone) {
  return Object.values(NPCS).filter(
    (npc) =>
      npc.pos.x >= (zone.xMin ?? Number.NEGATIVE_INFINITY) &&
      npc.pos.x < (zone.xMax ?? Number.POSITIVE_INFINITY) &&
      npc.pos.z >= zone.zMin &&
      npc.pos.z < zone.zMax,
  );
}

/** Every known quest the zone's own NPCs can offer. */
function zoneOfferIds(zone: Zone): string[] {
  const out = new Set<string>();
  for (const npc of npcsInZone(zone)) {
    for (const questId of npc.questIds) if (Object.hasOwn(QUESTS, questId)) out.add(questId);
  }
  return [...out];
}

/**
 * The rail's nearby rule, derived here from the content tables rather than read
 * back off the model: nearest four offers to `from`, one row per quest (the first
 * NPC that offers it wins), ties broken by questId.
 */
function nearestOffers(
  zone: Zone,
  from: { x: number; z: number },
  available: ReadonlySet<string>,
): string[] {
  const seen = new Set<string>();
  const rows: Array<{ questId: string; distance: number }> = [];
  for (const npc of npcsInZone(zone)) {
    for (const questId of npc.questIds) {
      if (seen.has(questId) || !available.has(questId) || !Object.hasOwn(QUESTS, questId)) continue;
      seen.add(questId);
      rows.push({ questId, distance: Math.hypot(npc.pos.x - from.x, npc.pos.z - from.z) });
    }
  }
  rows.sort((a, b) => a.distance - b.distance || a.questId.localeCompare(b.questId));
  return rows.slice(0, 4).map((row) => row.questId);
}

describe('map sidebar view', () => {
  it('keeps quest numbers in log order and selects the first incomplete objective', () => {
    const log = new Map([
      ['q_wolves', progress('q_wolves', 'active', 2)],
      ['q_boars', progress('q_boars', 'ready', 8)],
    ]);
    const w = world(log);
    const zone = zoneAt(w.player.pos.x, w.player.pos.z);

    const model = buildMapSidebarView({
      world: w,
      zone,
      filters: DEFAULT_MAP_ATLAS_FILTERS,
      selectedQuestId: 'q_wolves',
    });

    expect(model.quests.map((quest) => [quest.questId, quest.number])).toEqual([
      ['q_wolves', 1],
      ['q_boars', 2],
    ]);
    expect(model.quests[0]).toMatchObject({ selected: true, current: 2, objectiveIndex: 0 });
    expect(model.quests[1]).toMatchObject({ ready: true, selected: false });
    expect(model.route).toMatchObject({ questId: 'q_wolves' });
  });

  it('lists the closest available offers in the current zone without mutating the log', () => {
    const w = world(new Map(), new Set(['q_wolves']));
    const zone = zoneAt(w.player.pos.x, w.player.pos.z);

    const model = buildMapSidebarView({
      world: w,
      zone,
      filters: DEFAULT_MAP_ATLAS_FILTERS,
      selectedQuestId: null,
    });

    expect(model.nearby.some((quest) => quest.questId === 'q_wolves')).toBe(true);
    expect(model.nearby.find((quest) => quest.questId === 'q_wolves')?.zoneId).toBe(zone.id);
    expect(w.questLog.size).toBe(0);
  });

  it('keeps an unknown accepted quest in the numbered rail for stale-client parity', () => {
    const unknown = progress('q_future_content', 'active');
    const w = world(new Map([[unknown.questId, unknown]]));
    const zone = zoneAt(w.player.pos.x, w.player.pos.z);

    const model = buildMapSidebarView({
      world: w,
      zone,
      filters: DEFAULT_MAP_ATLAS_FILTERS,
      selectedQuestId: unknown.questId,
    });

    expect(model.quests[0]).toMatchObject({
      questId: 'q_future_content',
      number: 1,
      objectiveIndex: null,
    });
    expect(model.route).toBeNull();
  });

  it('opens with every marker family the shipped map paints', () => {
    expect(Object.values(DEFAULT_MAP_ATLAS_FILTERS).every(Boolean)).toBe(true);
  });

  it('toggles only the requested atlas layer', () => {
    const next = toggleMapAtlasFilter(DEFAULT_MAP_ATLAS_FILTERS, 'services');
    expect(next.services).toBe(false);
    expect(next.quests).toBe(true);
    expect(DEFAULT_MAP_ATLAS_FILTERS.services).toBe(true);
  });
});

// The rail runs on both hosts, so the core is driven from BOTH IWorld shapes: the
// offline Sim's live in-place quest log and the online ClientWorld's per-snapshot
// rebuild. The two arms assert the same answers, which is the parity claim.
describe.each([
  ['offline Sim', offlineWorld],
  ['online ClientWorld mirror', mirroredWorld],
])('map sidebar view on the %s IWorld', (_name, makeWorld) => {
  it('numbers tracked quests in log order and resolves the selected route', () => {
    const w = makeWorld([
      progress('q_wolves', 'active', 2),
      progress('q_boars', 'ready', 8),
      progress('q_bandits', 'active', 1),
    ]);
    const zone = zoneAt(w.player.pos.x, w.player.pos.z);

    const model = buildMapSidebarView({
      world: w,
      zone,
      filters: DEFAULT_MAP_ATLAS_FILTERS,
      selectedQuestId: 'q_wolves',
    });

    expect(model.quests.map((quest) => [quest.questId, quest.number])).toEqual([
      ['q_wolves', 1],
      ['q_boars', 2],
      ['q_bandits', 3],
    ]);
    expect(model.quests.map((quest) => quest.selected)).toEqual([true, false, false]);
    expect(model.quests[1].ready).toBe(true);
    expect(model.route).toMatchObject({ questId: 'q_wolves' });
  });

  it('lists the closest available offers in the current zone', () => {
    // Every offer the zone can hand out, so the nearest-four cut and the questId
    // tie-break both decide the answer instead of being assumed.
    const anchor = makeWorld([]).player.pos;
    const zone = zoneAt(anchor.x, anchor.z);
    const available = new Set(zoneOfferIds(zone));
    const w = makeWorld([], available);

    const model = buildMapSidebarView({
      world: w,
      zone,
      filters: DEFAULT_MAP_ATLAS_FILTERS,
      selectedQuestId: null,
    });

    const expected = nearestOffers(zone, w.player.pos, available);
    expect(available.size, 'the zone has more offers than the rail can show').toBeGreaterThan(4);
    expect(expected).toHaveLength(4);
    expect(model.nearby.map((quest) => quest.questId)).toEqual(expected);
    expect(model.nearby.every((quest) => quest.zoneId === zone.id)).toBe(true);
    // An offer already in the log is an offer no longer: only `available` shows.
    const withoutWolves = new Set([...available].filter((id) => id !== 'q_wolves'));
    const accepted = buildMapSidebarView({
      world: makeWorld([progress('q_wolves', 'active', 1)], withoutWolves),
      zone,
      filters: DEFAULT_MAP_ATLAS_FILTERS,
      selectedQuestId: null,
    }).nearby;
    expect(accepted.map((quest) => quest.questId)).toEqual(
      nearestOffers(zone, w.player.pos, withoutWolves),
    );
    expect(accepted.some((quest) => quest.questId === 'q_wolves')).toBe(false);
  });

  it('drops a selection the log no longer carries', () => {
    const w = makeWorld([progress('q_boars', 'active', 1)]);
    const zone = zoneAt(w.player.pos.x, w.player.pos.z);

    const model = buildMapSidebarView({
      world: w,
      zone,
      filters: DEFAULT_MAP_ATLAS_FILTERS,
      selectedQuestId: 'q_wolves',
    });

    expect(model.selectedQuestId).toBeNull();
    expect(model.quests.every((quest) => !quest.selected)).toBe(true);
    expect(model.route).toBeNull();
  });

  it('drops an untracked quest from the rail while it keeps its acceptance number', () => {
    const w = makeWorld([progress('q_wolves', 'active', 2), progress('q_boars', 'active', 1)]);
    const zone = zoneAt(w.player.pos.x, w.player.pos.z);

    const model = buildMapSidebarView({
      world: w,
      zone,
      filters: DEFAULT_MAP_ATLAS_FILTERS,
      selectedQuestId: 'q_boars',
      untrackedQuestIds: new Set(['q_wolves']),
    });

    expect(model.quests.map((quest) => quest.questId)).toEqual(['q_boars']);
    // The numbering is taken over the WHOLE log, so q_boars keeps the 2 that its
    // gold badge on the map still paints.
    expect(model.quests[0].number).toBe(2);
    expect(model.selectedQuestId).toBe('q_boars');
    // The quest is untracked, not abandoned: the log is untouched.
    expect(w.questLog.has('q_wolves')).toBe(true);
  });

  it('drops a selection (and its route) the moment that quest is untracked', () => {
    const w = makeWorld([progress('q_wolves', 'active', 2)]);
    const zone = zoneAt(w.player.pos.x, w.player.pos.z);

    const model = buildMapSidebarView({
      world: w,
      zone,
      filters: DEFAULT_MAP_ATLAS_FILTERS,
      selectedQuestId: 'q_wolves',
      untrackedQuestIds: new Set(['q_wolves']),
    });

    expect(model.quests).toEqual([]);
    expect(model.selectedQuestId).toBeNull();
    expect(model.route).toBeNull();
  });
});

// The online-only hazard the shared arms above cannot show: ClientWorld hands the
// rail a brand new Map of brand new QuestProgress objects on every snapshot, so a
// core that leaned on object identity would renumber or lose the selection between
// two mirrors of the SAME server state.
describe('map sidebar view across consecutive ClientWorld mirrors', () => {
  it('keeps numbering and selection stable when every progress object is replaced', () => {
    const qlog = [progress('q_wolves', 'active', 2), progress('q_boars', 'active', 1)];
    const first = mirroredWorld(qlog);
    const second = mirroredWorld(qlog);
    const zone = zoneAt(first.player.pos.x, first.player.pos.z);
    const build = (w: IWorld) =>
      buildMapSidebarView({
        world: w,
        zone,
        filters: DEFAULT_MAP_ATLAS_FILTERS,
        selectedQuestId: 'q_boars',
      });

    expect(second.questLog.get('q_wolves')).not.toBe(first.questLog.get('q_wolves'));
    expect(build(second)).toEqual(build(first));
    expect(build(second).selectedQuestId).toBe('q_boars');
  });
});
