// Client-side escort interaction (src/game/escort_interact.ts) and the two
// ladders it feeds: the Interact action (tryNearbyInteraction) and a right-click
// pick (handlePickedEntity).
//
// The bug this covers: an escortee is a MOB-kind entity, both ladders routed
// talkable entities by `kind === 'npc'`, and so no shipped client (desktop,
// mobile or gamepad) could dispatch the interact command that reaches the sim's
// tryStartEscort. The escort quest was uncompletable in-game while
// tests/escort.test.ts stayed green, because that suite calls sim.interact()
// directly. These tests deliberately enter through the CLIENT surface instead.
import { describe, expect, it, vi } from 'vitest';
import {
  decideEscortPress,
  ESCORT_POST_HINT_RANGE,
  ESCORT_POST_RADIUS,
  handleEscortPress,
  isEscorteeEntity,
} from '../src/game/escort_interact';
import { handlePickedEntity, hoverCursorKind } from '../src/game/interactions';
import { tryNearbyInteraction } from '../src/game/nearby_interaction';
import { ESCORTS } from '../src/sim/data';
import type { Entity, QuestProgress } from '../src/sim/types';

const WREN = ESCORTS.esc_fv_wren;
const AWAY_TEXT = 'escort away';

function entity(overrides: Partial<Entity> & Pick<Entity, 'id' | 'kind'>): Entity {
  return {
    templateId: 'test',
    pos: { x: 0, y: 0, z: 0 },
    dead: false,
    ghost: false,
    lootable: false,
    loot: null,
    harvestClaimedBy: null,
    dungeonId: null,
    hostile: false,
    ...overrides,
  } as Entity;
}

function playerAt(x: number, z: number): Entity {
  return entity({ id: 1, kind: 'player', pos: { x, y: 0, z } });
}

/** The escortee as the sim spawns her: a non-hostile mob on def.start. */
function escorteeAt(x = WREN.start.x, z = WREN.start.z, overrides: Partial<Entity> = {}): Entity {
  return entity({
    id: 2,
    kind: 'mob',
    templateId: WREN.npcMobId,
    pos: { x, y: 0, z },
    ...overrides,
  });
}

function activeLog(): Map<string, QuestProgress> {
  return new Map([[WREN.questId, { questId: WREN.questId, counts: [0], state: 'active' }]]);
}

function entities(...list: Entity[]): Map<number, Entity> {
  return new Map(list.map((e) => [e.id, e]));
}

describe('decideEscortPress', () => {
  it('starts the run for an idle escortee at her post while the quest is active', () => {
    const player = playerAt(WREN.start.x + 2, WREN.start.z);
    const wren = escorteeAt();

    expect(decideEscortPress(player.pos, entities(player, wren), activeLog())).toEqual({
      kind: 'start',
      entityId: wren.id,
    });
  });

  it('ignores the escortee entirely without the quest (she is scenery)', () => {
    const player = playerAt(WREN.start.x + 2, WREN.start.z);
    const wren = escorteeAt();

    for (const state of ['ready', 'done'] as const) {
      const log = new Map<string, QuestProgress>([
        [WREN.questId, { questId: WREN.questId, counts: [1], state }],
      ]);
      expect(decideEscortPress(player.pos, entities(player, wren), log)).toEqual({ kind: 'none' });
    }
    expect(decideEscortPress(player.pos, entities(player, wren), new Map())).toEqual({
      kind: 'none',
    });
  });

  it('stays silent, not "away", for a startable escortee who is merely out of reach', () => {
    // Regression: the post-proximity hint must not fire while she is standing
    // right there waiting. The player just needs to walk closer.
    const player = playerAt(WREN.start.x + 8, WREN.start.z);
    const wren = escorteeAt();

    expect(decideEscortPress(player.pos, entities(player, wren), activeLog())).toEqual({
      kind: 'none',
    });
  });

  it('reports away when the post is empty and the player is standing on it', () => {
    // The reported symptom: a live run (or a 30s respawn) leaves the spawn
    // empty, and the press used to fall through to "nothing to interact with".
    const player = playerAt(WREN.start.x, WREN.start.z + 2);

    expect(decideEscortPress(player.pos, entities(player), activeLog())).toEqual({ kind: 'away' });
  });

  it('reports away for an escortee already walking a live run', () => {
    const walking = escorteeAt(WREN.waypoints[0].x, WREN.waypoints[0].z);
    const player = playerAt(walking.pos.x + 1, walking.pos.z);

    expect(decideEscortPress(player.pos, entities(player, walking), activeLog())).toEqual({
      kind: 'away',
    });
  });

  it('says nothing at all far from both the post and the escortee', () => {
    const player = playerAt(WREN.start.x + 200, WREN.start.z + 200);
    const wren = escorteeAt();

    expect(decideEscortPress(player.pos, entities(player, wren), activeLog())).toEqual({
      kind: 'none',
    });
  });

  it('bounds the away hint by ESCORT_POST_HINT_RANGE', () => {
    const inside = playerAt(WREN.start.x + ESCORT_POST_HINT_RANGE - 1, WREN.start.z);
    const outside = playerAt(WREN.start.x + ESCORT_POST_HINT_RANGE + 1, WREN.start.z);

    expect(decideEscortPress(inside.pos, entities(inside), activeLog())).toEqual({ kind: 'away' });
    expect(decideEscortPress(outside.pos, entities(outside), activeLog())).toEqual({
      kind: 'none',
    });
  });

  it('treats an escortee past ESCORT_POST_RADIUS as off her post', () => {
    const player = playerAt(WREN.start.x, WREN.start.z);
    const atPost = escorteeAt(WREN.start.x + ESCORT_POST_RADIUS - 0.5, WREN.start.z);
    const offPost = escorteeAt(WREN.start.x + ESCORT_POST_RADIUS + 0.5, WREN.start.z);

    expect(decideEscortPress(player.pos, entities(player, atPost), activeLog())).toEqual({
      kind: 'start',
      entityId: atPost.id,
    });
    expect(decideEscortPress(player.pos, entities(player, offPost), activeLog())).toEqual({
      kind: 'away',
    });
  });

  it('ignores a dead escortee (a failed run despawns her; the post reads empty)', () => {
    const player = playerAt(WREN.start.x, WREN.start.z);
    const dead = escorteeAt(WREN.start.x, WREN.start.z, { dead: true });

    expect(decideEscortPress(player.pos, entities(player, dead), activeLog())).toEqual({
      kind: 'away',
    });
  });
});

// The fix is data-driven (the core reads ESCORTS), which is the whole point:
// four escort quests shipped with the same dead press, in four different zones,
// and only one of them was reported. Any escort added later is covered the
// moment its def lands, and this loop fails if that ever stops being true.
describe('every escort def in the game is startable from the client', () => {
  it.each(Object.values(ESCORTS).map((def) => [def.id, def] as const))('%s', (_id, def) => {
    const player = playerAt(def.start.x + 1, def.start.z);
    const escortee = entity({
      id: 2,
      kind: 'mob',
      templateId: def.npcMobId,
      pos: { x: def.start.x, y: 0, z: def.start.z },
    });
    const log = new Map([
      [def.questId, { questId: def.questId, counts: [0], state: 'active' as const }],
    ]);

    expect(decideEscortPress(player.pos, entities(player, escortee), log)).toEqual({
      kind: 'start',
      entityId: escortee.id,
    });
    // ...and the same press is inert for a player not on that quest.
    expect(decideEscortPress(player.pos, entities(player, escortee), new Map())).toEqual({
      kind: 'none',
    });
  });

  it('covers all four shipped escorts, so a fifth cannot be missed silently', () => {
    expect(Object.keys(ESCORTS).sort()).toEqual([
      'esc_fs_bram',
      'esc_fv_wren',
      'esc_pr_navigator',
      'esc_ww_mosley',
    ]);
  });
});

describe('handleEscortPress', () => {
  function rig() {
    const calls: string[] = [];
    const world = {
      targetEntity: (id: number | null) => calls.push(`target:${id}`),
      interact: () => calls.push('interact'),
    };
    const hud = { showError: (text: string) => calls.push(`error:${text}`) };
    return { world, hud, calls };
  }

  it('targets then interacts on start (the sim resolves the target first)', () => {
    const r = rig();

    expect(handleEscortPress(r.world, r.hud, { kind: 'start', entityId: 7 }, AWAY_TEXT)).toBe(true);
    expect(r.calls).toEqual(['target:7', 'interact']);
  });

  it('surfaces the away line and dispatches nothing', () => {
    const r = rig();

    expect(handleEscortPress(r.world, r.hud, { kind: 'away' }, AWAY_TEXT)).toBe(false);
    expect(r.calls).toEqual([`error:${AWAY_TEXT}`]);
  });

  it('does nothing at all for a none verdict', () => {
    const r = rig();

    expect(handleEscortPress(r.world, r.hud, { kind: 'none' }, AWAY_TEXT)).toBe(false);
    expect(r.calls).toEqual([]);
  });
});

describe('isEscorteeEntity', () => {
  it('recognizes a live escortee and nothing else', () => {
    expect(isEscorteeEntity(escorteeAt())).toBe(true);
    expect(isEscorteeEntity(escorteeAt(0, 0, { dead: true }))).toBe(false);
    expect(isEscorteeEntity(entity({ id: 3, kind: 'mob', templateId: 'snowdrift_wolf' }))).toBe(
      false,
    );
    expect(isEscorteeEntity(entity({ id: 4, kind: 'npc', templateId: 'aurorist_veyla' }))).toBe(
      false,
    );
    expect(isEscorteeEntity(undefined)).toBe(false);
  });

  it('shows the friendly hover cursor, so the escortee reads as interactive', () => {
    expect(hoverCursorKind(escorteeAt(), 1, new Set())).toBe('friendly');
    // An ordinary non-hostile mob is still just scenery.
    expect(
      hoverCursorKind(entity({ id: 3, kind: 'mob', templateId: 'ice_wisp' }), 1, new Set()),
    ).toBe('default');
  });
});

describe('the Interact action reaches the escort run (tryNearbyInteraction)', () => {
  function rig(list: Entity[], player: Entity, log = activeLog()) {
    const calls: string[] = [];
    const world = {
      playerId: player.id,
      player,
      entities: entities(player, ...list),
      questLog: log,
      targetEntity: (id: number | null) => {
        calls.push(`target:${id}`);
      },
      interact: () => {
        calls.push('interact');
      },
      lootCorpse: (id: number) => {
        calls.push(`loot:${id}`);
        return true;
      },
      harvestCorpse: () => {},
      delveInteract: () => false as const,
      enterDungeon: () => false as const,
      leaveDungeon: () => false as const,
      pickUpObject: () => false as const,
      nodeHarvestableByMe: () => true,
      harvestNode: (id: string) => {
        calls.push(`harvest:${id}`);
        return true;
      },
    };
    const hud = {
      openMailbox: () => {},
      openQuestDialog: (id: number) => calls.push(`quest:${id}`),
      openDelveBoard: () => {},
      showError: (text: string) => calls.push(`error:${text}`),
      requestSpiritHealerResurrect: () => {},
    };
    const press = (nodes: Parameters<typeof tryNearbyInteraction>[2] = []) =>
      tryNearbyInteraction(world, hud, nodes, null, 'too far', 'not ready', AWAY_TEXT, 'nothing');
    return { press, calls };
  }

  it('dispatches the interact command for an idle escortee (was: dead press)', () => {
    const wren = escorteeAt();
    const r = rig([wren], playerAt(WREN.start.x + 1, WREN.start.z));

    expect(r.press()).toBe(true);
    expect(r.calls).toEqual([`target:${wren.id}`, 'interact']);
  });

  it('explains an empty post instead of the generic nothing-to-interact line', () => {
    const r = rig([], playerAt(WREN.start.x, WREN.start.z));

    expect(r.press()).toBe(false);
    expect(r.calls).toEqual([`error:${AWAY_TEXT}`]);
  });

  it('never swallows a corpse press: looting the ambush wave still wins', () => {
    const wren = escorteeAt();
    const corpse = entity({
      id: 5,
      kind: 'mob',
      templateId: 'fen_sprite',
      dead: true,
      lootable: true,
      loot: { copper: 3, items: [] },
      pos: { x: WREN.start.x + 1, y: 0, z: WREN.start.z },
    });
    const r = rig([wren, corpse], playerAt(WREN.start.x + 1, WREN.start.z));

    expect(r.press()).toBe(true);
    expect(r.calls).toEqual(['loot:5']);
  });

  it('beats a gather node underfoot', () => {
    const wren = escorteeAt();
    const r = rig([wren], playerAt(WREN.start.x + 1, WREN.start.z));
    const node = {
      id: 'ore_1',
      type: 'ore',
      tier: 1,
      pos: { x: WREN.start.x + 1, z: WREN.start.z },
    } as const;

    expect(r.press([node])).toBe(true);
    expect(r.calls).toEqual([`target:${wren.id}`, 'interact']);
  });

  it('never eats another arm press while she is away: the node underfoot wins', () => {
    // Regression: the away line is a last resort, not a priority. Standing at
    // an empty post over an ore node must still harvest the node.
    const r = rig([], playerAt(WREN.start.x, WREN.start.z));
    const node = {
      id: 'ore_1',
      type: 'ore',
      tier: 1,
      pos: { x: WREN.start.x, z: WREN.start.z },
    } as const;

    expect(r.press([node])).toBe(true);
    expect(r.calls).toEqual(['harvest:ore_1']);
  });

  it('falls through to the generic line without the quest', () => {
    const wren = escorteeAt();
    const r = rig([wren], playerAt(WREN.start.x + 1, WREN.start.z), new Map());

    expect(r.press()).toBe(false);
    expect(r.calls).toEqual(['error:nothing']);
  });
});

describe('a right-click reaches the escort run (handlePickedEntity)', () => {
  function rig(wren: Entity, player: Entity, log = activeLog()) {
    const startAutoAttack = vi.fn();
    const interact = vi.fn();
    const world = {
      player,
      playerId: player.id,
      entities: entities(player, wren),
      questLog: log,
      targetEntity: vi.fn(),
      interact,
      enterDungeon: () => false as const,
      leaveDungeon: () => false as const,
      pickUpObject: () => false as const,
      startAutoAttack,
    };
    const hud = {
      openLoot: vi.fn(),
      openQuestDialog: vi.fn(),
      openDelveBoard: vi.fn(),
      openMailbox: vi.fn(),
      showError: vi.fn(),
      closeContextMenu: vi.fn(),
      requestSpiritHealerResurrect: vi.fn(),
    };
    return { world, hud, interact, startAutoAttack };
  }

  it('starts the run instead of only targeting her', () => {
    const wren = escorteeAt();
    const r = rig(wren, playerAt(WREN.start.x + 1, WREN.start.z));

    expect(handlePickedEntity(r.world, r.hud, wren.id, 2, 0, 0)).toBe(true);
    expect(r.world.targetEntity).toHaveBeenCalledWith(wren.id);
    expect(r.interact).toHaveBeenCalledTimes(1);
    // She is non-hostile, so the old path fell into the attackable branch and
    // did nothing at all.
    expect(r.startAutoAttack).not.toHaveBeenCalled();
  });

  it('reports too far beyond the click range', () => {
    const wren = escorteeAt();
    const r = rig(wren, playerAt(WREN.start.x + 30, WREN.start.z));

    expect(handlePickedEntity(r.world, r.hud, wren.id, 2, 0, 0)).toBe(false);
    expect(r.interact).not.toHaveBeenCalled();
    expect(r.hud.showError).toHaveBeenCalled();
  });

  it('only targets her without the quest', () => {
    const wren = escorteeAt();
    const r = rig(wren, playerAt(WREN.start.x + 1, WREN.start.z), new Map());

    expect(handlePickedEntity(r.world, r.hud, wren.id, 2, 0, 0)).toBe(false);
    expect(r.world.targetEntity).toHaveBeenCalledWith(wren.id);
    expect(r.interact).not.toHaveBeenCalled();
  });
});
