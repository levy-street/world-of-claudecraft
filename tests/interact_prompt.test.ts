// The interact prompt above the action bars: the scan it reads, the descriptor
// it builds, and the pure visibility/verb core the painter renders.
//
// The load-bearing claim these pin is AGREEMENT: the prompt must name exactly
// what the interact key would act on. That is why the first block drives
// scanNearbyInteraction and tryNearbyInteraction over the SAME fixtures and
// asserts the scan's pick matches the dispatch, rather than trusting that two
// priority lists were kept in step by hand.

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  INTERACT_PROMPT_SCAN_MS,
  InteractPromptScanGate,
  interactPromptTarget,
} from '../src/game/interact_prompt';
import { isInteractHighlightTarget } from '../src/game/interactions';
import { scanNearbyInteraction, tryNearbyInteraction } from '../src/game/nearby_interaction';
import type { Entity, GatherNodeDef, QuestProgress } from '../src/sim/types';
import { makeInteractPromptState, resolveInteractPrompt } from '../src/ui/interact_prompt_view';

function entity(overrides: Partial<Entity> & Pick<Entity, 'id' | 'kind'>): Entity {
  return {
    templateId: 'test',
    name: 'Test',
    pos: { x: 0, y: 0, z: 0 },
    dead: false,
    ghost: false,
    lootable: false,
    loot: null,
    harvestClaimedBy: null,
    dungeonId: null,
    ownerId: null,
    ...overrides,
  } as Entity;
}

function rig(
  targets: Entity[] = [],
  nodes: GatherNodeDef[] = [],
  playerOverrides: Partial<Entity> = {},
) {
  const player = entity({ id: 1, kind: 'player', ...playerOverrides });
  const calls: string[] = [];
  const world = {
    playerId: 1,
    player,
    entities: new Map<number, Entity>([
      [player.id, player],
      ...targets.map((target): [number, Entity] => [target.id, target]),
    ]),
    questLog: new Map<string, QuestProgress>(),
    targetEntity: () => {},
    interact: () => {},
    lootCorpse: (id: number) => {
      calls.push(`loot:${id}`);
      return true;
    },
    harvestCorpse: (id: number) => calls.push(`harvestCorpse:${id}`),
    delveInteract: (id: number) => {
      calls.push(`delve:${id}`);
      return true;
    },
    enterDungeon: (id: string) => {
      calls.push(`enter:${id}`);
      return true;
    },
    leaveDungeon: () => {
      calls.push('leave');
      return true;
    },
    pickUpObject: (id: number) => {
      calls.push(`pickup:${id}`);
      return true;
    },
    nodeHarvestableByMe: vi.fn(() => true),
    harvestNode: (id: string) => {
      calls.push(`harvest:${id}`);
      return true;
    },
  };
  const hud = {
    openMailbox: () => calls.push('mailbox'),
    openQuestDialog: (id: number) => calls.push(`quest:${id}`),
    openDelveBoard: (id: number) => calls.push(`board:${id}`),
    showError: (text: string) => calls.push(`error:${text}`),
    requestSpiritHealerResurrect: () => calls.push('requestResurrect'),
  };
  return { world, hud, nodes, calls };
}

function dispatch(r: ReturnType<typeof rig>): void {
  tryNearbyInteraction(
    r.world,
    r.hud,
    r.nodes,
    null,
    'too far',
    'not ready',
    'escort away',
    'nothing',
  );
}

const corpse = () =>
  entity({
    id: 2,
    kind: 'mob',
    dead: true,
    lootable: true,
    loot: { copper: 1, items: [] },
    pos: { x: 1, y: 0, z: 0 },
  });
const mailbox = () =>
  entity({
    id: 3,
    kind: 'object',
    templateId: 'mailbox',
    lootable: true,
    pos: { x: 1, y: 0, z: 0 },
  });
const questGiver = () =>
  entity({ id: 4, kind: 'npc', templateId: 'marshal_redbrook', pos: { x: 1, y: 0, z: 0 } });
const oreNode = (): GatherNodeDef => ({
  id: 'ore_1',
  type: 'ore',
  tier: 1,
  zoneId: 'eastbrook',
  level: 1,
  pos: { x: 1, z: 0 },
});

describe('scanNearbyInteraction agrees with what the key dispatches', () => {
  it.each([
    ['corpse', [corpse()], [], 'corpse', 'loot:2'],
    ['mailbox', [mailbox()], [], 'object', 'mailbox'],
    ['npc', [questGiver()], [], 'npc', 'quest:4'],
    ['gather node', [], [oreNode()], 'node', 'harvest:ore_1'],
  ] as const)('picks the %s the press acts on', (_label, targets, nodes, kind, call) => {
    const r = rig([...targets], [...nodes]);
    expect(scanNearbyInteraction(r.world, r.nodes)?.kind).toBe(kind);
    dispatch(r);
    expect(r.calls).toContain(call);
  });

  it('holds the corpse-over-node priority in BOTH halves', () => {
    const r = rig([corpse()], [oreNode()]);
    expect(scanNearbyInteraction(r.world, r.nodes)?.kind).toBe('corpse');
    dispatch(r);
    expect(r.calls).toEqual(['loot:2']);
  });

  it('scans nothing when the world is empty, and the press says so', () => {
    const r = rig();
    expect(scanNearbyInteraction(r.world, r.nodes)).toBeNull();
    dispatch(r);
    expect(r.calls).toEqual(['error:nothing']);
  });
});

describe('interactPromptTarget', () => {
  it('splits the object arm into the cases a player reads differently', () => {
    const r = rig([mailbox()]);
    const target = interactPromptTarget(scanNearbyInteraction(r.world, r.nodes), r.world.entities);
    expect(target).toEqual({ kind: 'mailbox', entityId: 3, nodeId: null, nodeType: null });
  });

  it('carries the node family so the prompt can name it', () => {
    const r = rig([], [oreNode()]);
    const target = interactPromptTarget(scanNearbyInteraction(r.world, r.nodes), r.world.entities);
    expect(target).toEqual({
      kind: 'gatherNode',
      entityId: null,
      nodeId: 'ore_1',
      nodeType: 'ore',
    });
  });

  it('names the graveyard angel a spirit healer, only for a ghost', () => {
    const healer = entity({
      id: 5,
      kind: 'npc',
      templateId: 'spirit_healer',
      pos: { x: 1, y: 0, z: 0 },
    });
    const ghost = rig([healer], [], { dead: true, ghost: true });
    expect(
      interactPromptTarget(scanNearbyInteraction(ghost.world, ghost.nodes), ghost.world.entities),
    ).toMatchObject({ kind: 'spiritHealer', entityId: 5 });
    const living = rig([healer]);
    expect(scanNearbyInteraction(living.world, living.nodes)).toBeNull();
  });

  it('shows nothing for the escort denial line (it is a toast, not a target)', () => {
    expect(interactPromptTarget({ kind: 'escortAway' }, new Map())).toBeNull();
  });

  it('shows nothing for an id that despawned between the scan and the paint', () => {
    expect(interactPromptTarget({ kind: 'npc', entityId: 99 }, new Map())).toBeNull();
  });
});

describe('InteractPromptScanGate', () => {
  it('re-scans on its own cadence, not per frame', () => {
    const gate = new InteractPromptScanGate();
    expect(gate.shouldScan(0)).toBe(true);
    expect(gate.shouldScan(INTERACT_PROMPT_SCAN_MS - 1)).toBe(false);
    expect(gate.shouldScan(INTERACT_PROMPT_SCAN_MS)).toBe(true);
  });
});

describe('resolveInteractPrompt', () => {
  const base = {
    enabled: true,
    touch: false,
    kind: 'npc',
    name: 'Marshal Redbrook',
    keyLabel: 'F',
  } as const;

  it('shows the name, the verb for the kind, and the bound keycap', () => {
    const state = resolveInteractPrompt({ ...base }, makeInteractPromptState());
    expect(state).toEqual({
      visible: true,
      name: 'Marshal Redbrook',
      verb: 'talk',
      keyLabel: 'F',
      unbound: false,
    });
  });

  it.each([
    ['corpse', 'loot'],
    ['mailbox', 'open'],
    ['pickup', 'take'],
    ['gatherNode', 'gather'],
    ['delveObject', 'interact'],
    // Named for the PLACE, so they take the travel words, not "Open".
    ['dungeonDoor', 'enter'],
    ['dungeonExit', 'leave'],
    ['spiritHealer', 'interact'],
    ['escort', 'talk'],
  ] as const)('maps %s to the %s verb', (kind, verb) => {
    expect(resolveInteractPrompt({ ...base, kind }, makeInteractPromptState()).verb).toBe(verb);
  });

  it('hides with the toggle off, on touch, and with nothing in range', () => {
    expect(
      resolveInteractPrompt({ ...base, enabled: false }, makeInteractPromptState()).visible,
    ).toBe(false);
    expect(resolveInteractPrompt({ ...base, touch: true }, makeInteractPromptState()).visible).toBe(
      false,
    );
    expect(resolveInteractPrompt({ ...base, kind: null }, makeInteractPromptState()).visible).toBe(
      false,
    );
  });

  it('reports an unbound interact action instead of drawing an empty keycap', () => {
    const state = resolveInteractPrompt({ ...base, keyLabel: '' }, makeInteractPromptState());
    expect(state.unbound).toBe(true);
    expect(state.keyLabel).toBe('');
  });

  it('reuses the caller-owned container instead of allocating per frame', () => {
    const out = makeInteractPromptState();
    expect(resolveInteractPrompt({ ...base }, out)).toBe(out);
    // A hidden frame clears the strings, so a stale name can never survive on a
    // container that is written every tick.
    resolveInteractPrompt({ ...base, kind: null }, out);
    expect(out.name).toBe('');
  });
});

describe('isInteractHighlightTarget', () => {
  const alive = { id: 1, dead: false, ghost: false };
  const dead = { id: 1, dead: true, ghost: false };
  const ghost = { id: 1, dead: true, ghost: true };

  it('marks a living NPC, a lootable corpse, and an interactable object', () => {
    expect(isInteractHighlightTarget(questGiver(), alive, 1)).toBe(true);
    expect(isInteractHighlightTarget(corpse(), alive, 1)).toBe(true);
    expect(isInteractHighlightTarget(mailbox(), alive, 1)).toBe(true);
  });

  it('is range-blind: a distant interactable still marks (a click walks you there)', () => {
    const farNpc = entity({ ...questGiver(), pos: { x: 400, y: 0, z: 0 } });
    expect(isInteractHighlightTarget(farNpc, alive, 1)).toBe(true);
  });

  it('never marks the local player, a live hostile, or an unlootable corpse', () => {
    expect(isInteractHighlightTarget(entity({ id: 1, kind: 'player' }), alive, 1)).toBe(false);
    expect(isInteractHighlightTarget(entity({ id: 7, kind: 'mob', hostile: true }), alive, 1)).toBe(
      false,
    );
    expect(
      isInteractHighlightTarget(
        entity({ id: 8, kind: 'mob', dead: true, lootable: false }),
        alive,
        1,
      ),
    ).toBe(false);
  });

  it('gives a ghost the spirit healer and nothing else', () => {
    const healer = entity({ id: 5, kind: 'npc', templateId: 'spirit_healer' });
    expect(isInteractHighlightTarget(healer, ghost, 1)).toBe(true);
    expect(isInteractHighlightTarget(healer, alive, 1)).toBe(false);
    expect(isInteractHighlightTarget(questGiver(), ghost, 1)).toBe(false);
    expect(isInteractHighlightTarget(mailbox(), dead, 1)).toBe(false);
  });
});

// BOTH entries that construct a Hud must carry the markup, and this is a boot
// gate, not a cosmetic one: Hud resolves its elements in FIELD INITIALIZERS via
// `$` (a bare querySelector cast), so a missing #interact-prompt makes the very
// next `.querySelector('.ip-name')` throw and the whole client fails to start.
// index.html was the only entry updated first; play.html is the DEPLOYED /play
// page and would have died on boot.
describe('interact prompt markup ships in every HUD host', () => {
  const html = {
    'index.html': readFileSync(new URL('../index.html', import.meta.url), 'utf8'),
    'play.html': readFileSync(new URL('../play.html', import.meta.url), 'utf8'),
  };

  for (const [entry, source] of Object.entries(html)) {
    it(`${entry} declares the prompt slot and all four painted nodes`, () => {
      expect(source).toContain('id="interact-prompt"');
      // The painter writes these three and never queries; the glyph placeholder
      // is hydrated by hydrateIcons, which is why the painter needs no innerHTML.
      for (const cls of ['ip-box', 'ip-name', 'ip-verb', 'ip-cap']) {
        expect(source, `${entry} is missing .${cls}`).toContain(`class="${cls}"`);
      }
      expect(source).toContain('class="ip-glyph" data-icon="keyboard"');
    });

    it(`${entry} docks the prompt directly above the ability rows`, () => {
      // Between the stance bar and the topmost ability row: the whole point is
      // that it reads as attached to the bars, not to the player frame.
      expect(source).toMatch(
        /<div id="stancebar"><\/div>\s*<div id="interact-prompt"[\s\S]*?<div id="actionbar3"/,
      );
    });
  }
});
