import { describe, expect, it, vi } from 'vitest';
import { tryNearbyInteraction } from '../src/game/nearby_interaction';
import { ITEMS } from '../src/sim/data';
import type { Entity, QuestProgress } from '../src/sim/types';
import type { FarmPatchDef, FarmPlotStatus, FarmPlotView } from '../src/world_api/farming';

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
    ...overrides,
  } as Entity;
}

// Every gathering command the generic press must never send (intentional
// gathering: nodes, corpse components and crops are explicit actions only).
const GATHERING_COMMANDS = /^(harvest|harvestCorpse|harvestCrop):/;
const gatheringCalls = (calls: readonly string[]) =>
  calls.filter((call) => GATHERING_COMMANDS.test(call));

function rig(targets: Entity[] = []) {
  const player = entity({ id: 1, kind: 'player' });
  const calls: string[] = [];
  const world = {
    playerId: 1,
    player,
    entities: new Map<number, Entity>([
      [player.id, player],
      ...targets.map((target): [number, Entity] => [target.id, target]),
    ]),
    questLog: new Map<string, QuestProgress>(),
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
    // The gathering commands stay on the fixture (the live world carries
    // them) so a regression that reaches for one is recorded as a call,
    // never a TypeError that hides the intent.
    harvestCorpse: (id: number) => {
      calls.push(`harvestCorpse:${id}`);
    },
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
    resurrectAtSpiritHealer: () => {
      calls.push('resurrect');
      return true;
    },
    nodeHarvestableByMe: vi.fn(() => true),
    // Phase 9b bed-arm seam members: inert by default (the bed-arm describe
    // below overrides them per test).
    farmPatches: [] as readonly FarmPatchDef[],
    myFarmPlots: [] as readonly FarmPlotView[],
    harvestCrop: (bedId: string) => {
      calls.push(`harvestCrop:${bedId}`);
    },
    // Phase 12 feast-arm seam member (the feast describe below exercises it).
    consumeFeast: (feastId: number) => {
      calls.push(`consumeFeast:${feastId}`);
    },
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
    // Phase 9b bed-arm seam member: inert here (lane A's arms exercise it).
    openPlantSheet: (bedId: string) => calls.push(`plantSheet:${bedId}`),
  };
  return { world, hud, calls, player };
}

function interact(r: ReturnType<typeof rig>) {
  return tryNearbyInteraction(r.world, r.hud, 'escort away', 'nothing');
}

describe('tryNearbyInteraction', () => {
  it('dispatches the nearest visible corpse loot', () => {
    const fartherCorpse = entity({
      id: 2,
      kind: 'mob',
      dead: true,
      lootable: true,
      loot: { copper: 1, items: [] },
      pos: { x: 3, y: 0, z: 0 },
    });
    const nearerCorpse = entity({
      id: 3,
      kind: 'mob',
      dead: true,
      lootable: true,
      loot: { copper: 1, items: [] },
      pos: { x: 1, y: 0, z: 0 },
    });
    const r = rig([fartherCorpse, nearerCorpse]);

    expect(interact(r)).toBe(true);
    expect(r.calls).toEqual(['loot:3']);
  });

  it('skips corpse loot that is personal to another player', () => {
    const corpse = entity({
      id: 2,
      kind: 'mob',
      dead: true,
      lootable: true,
      loot: { copper: 0, items: [{ itemId: 'wolf_fang', count: 1, personalFor: [9] }] },
      pos: { x: 1, y: 0, z: 0 },
    });
    const r = rig([corpse]);

    expect(interact(r)).toBe(false);
    expect(r.calls).toEqual(['error:nothing']);
  });

  it.each([
    [
      'door',
      entity({
        id: 2,
        kind: 'object',
        templateId: 'dungeon_door',
        dungeonId: 'crypt',
        lootable: true,
      }),
      'enter:crypt',
    ],
    [
      'exit',
      entity({ id: 2, kind: 'object', templateId: 'dungeon_exit', lootable: true }),
      'leave',
    ],
    [
      'mailbox',
      entity({ id: 2, kind: 'object', templateId: 'mailbox', lootable: true }),
      'mailbox',
    ],
    ['pickup', entity({ id: 2, kind: 'object', lootable: true }), 'pickup:2'],
  ])('dispatches a nearby %s object', (_name, target, expected) => {
    const r = rig([target]);

    expect(interact(r)).toBe(true);
    expect(r.calls).toEqual([expected]);
  });

  it.each([
    ['inside', 3.99, true, ['pickup:2']],
    ['exactly at', 4, true, ['pickup:2']],
    ['outside', 4.01, false, ['error:nothing']],
  ] as const)(
    'uses the authored noticeboard radius when the board is %s the boundary',
    (_position, distance, expectedOutcome, expectedCalls) => {
      const board = entity({
        id: 2,
        kind: 'object',
        templateId: 'noticeboard_eastbrook',
        lootable: true,
        pos: { x: distance, y: 0, z: 0 },
      });
      const r = rig([board]);

      expect(interact(r)).toBe(expectedOutcome);
      expect(r.calls).toEqual(expectedCalls);
    },
  );

  it('does not let an out-of-range noticeboard mask a closer valid NPC', () => {
    const board = entity({
      id: 2,
      kind: 'object',
      templateId: 'noticeboard_eastbrook',
      lootable: true,
      pos: { x: 4.5, y: 0, z: 0 },
    });
    const npc = entity({
      id: 3,
      kind: 'npc',
      templateId: 'elder_maren',
      pos: { x: 2, y: 0, z: 0 },
    });
    const r = rig([board, npc]);

    expect(interact(r)).toBe(true);
    expect(r.calls).toEqual(['quest:3']);
  });

  it('preserves the generic five-yard object interaction range', () => {
    const object = entity({
      id: 2,
      kind: 'object',
      lootable: true,
      pos: { x: 4.5, y: 0, z: 0 },
    });
    const r = rig([object]);

    expect(interact(r)).toBe(true);
    expect(r.calls).toEqual(['pickup:2']);
  });

  it.each([
    ['quest', 'elder_maren', 'quest:2'],
    ['delve board', 'brother_halven_marsh', 'board:2'],
  ])('opens the nearby %s interaction', (_name, templateId, expected) => {
    const r = rig([entity({ id: 2, kind: 'npc', templateId })]);

    expect(interact(r)).toBe(true);
    expect(r.calls).toEqual([expected]);
  });

  it('never reads node readiness or sends harvestNode: the press knows no nodes', () => {
    // The generic press takes no node list at all; a ready node underfoot is
    // gathered only through the explicit node click. So nothing here can
    // consult readiness, show the not-ready line, or send the harvest.
    const r = rig();
    expect(interact(r)).toBe(false);
    expect(r.calls).toEqual(['error:nothing']);
    expect(r.world.nodeHarvestableByMe).not.toHaveBeenCalled();
    expect(gatheringCalls(r.calls)).toEqual([]);
  });

  it('keeps corpse, delve, object, npc priority stable and ends at the nothing line', () => {
    const npc = entity({ id: 2, kind: 'npc', templateId: 'elder_maren' });
    const object = entity({ id: 3, kind: 'object', lootable: true });
    const delve = entity({ id: 4, kind: 'object', templateId: 'delve_chest', lootable: true });
    const corpse = entity({
      id: 5,
      kind: 'mob',
      dead: true,
      lootable: true,
      loot: { copper: 1, items: [] },
    });
    const cases = [
      { targets: [corpse, delve, object, npc], expected: 'loot:5', outcome: true },
      { targets: [delve, object, npc], expected: 'delve:4', outcome: true },
      { targets: [object, npc], expected: 'pickup:3', outcome: true },
      { targets: [npc], expected: 'quest:2', outcome: true },
      { targets: [], expected: 'error:nothing', outcome: false },
    ];

    for (const { targets, expected, outcome } of cases) {
      const r = rig(targets);
      expect(interact(r)).toBe(outcome);
      expect(r.calls).toEqual([expected]);
    }
  });

  it('resurrects a ghost at a spirit healer and ignores all other dead-player actions', () => {
    const healer = entity({ id: 2, kind: 'npc', templateId: 'spirit_healer' });
    const competingNpc = entity({ id: 3, kind: 'npc', templateId: 'elder_maren' });
    const competingObject = entity({ id: 4, kind: 'object', lootable: true });
    const competingCorpse = entity({
      id: 5,
      kind: 'mob',
      dead: true,
      lootable: true,
      loot: { copper: 1, items: [] },
    });
    const ghost = rig([healer, competingNpc, competingObject, competingCorpse]);
    ghost.player.dead = true;
    ghost.player.ghost = true;
    expect(interact(ghost)).toBe(true);
    // The interact key opens the HUD confirm gate; the resurrect command
    // itself is only sent from the dialog's OK, never directly from here.
    expect(ghost.calls).toEqual(['requestResurrect']);

    const corpse = entity({
      id: 3,
      kind: 'mob',
      dead: true,
      lootable: true,
      loot: { copper: 1, items: [] },
    });
    const dead = rig([corpse]);
    dead.player.dead = true;
    expect(interact(dead)).toBe(false);
    expect(dead.calls).toEqual(['error:nothing']);
  });

  it('returns false and shows feedback when there is no eligible target', () => {
    const r = rig();

    expect(interact(r)).toBe(false);
    expect(r.calls).toEqual(['error:nothing']);
  });

  it('returns a rejected authoritative pickup result', async () => {
    const target = entity({ id: 2, kind: 'object', lootable: true });
    const r = rig([target]);
    (r.world as any).pickUpObject = async (id: number) => {
      r.calls.push(`pickup:${id}`);
      return false;
    };

    await expect(interact(r)).resolves.toBe(false);
    expect(r.calls).toEqual(['pickup:2']);
  });
});

// Intentional gathering: the generic press is ordinary loot ONLY. A corpse is
// selected by hasLoot (what this viewer may actually take), never by its
// harvest half, and the press sends lootCorpse alone. Corpse components are an
// explicit action elsewhere.
describe('tryNearbyInteraction corpse press is ordinary loot only', () => {
  function wolfCorpse(overrides: Partial<Entity> = {}): Entity {
    return entity({
      id: 2,
      kind: 'mob',
      // forest_wolf carries componentTags (#1140): a harvestable corpse.
      templateId: 'forest_wolf',
      dead: true,
      lootable: true,
      loot: { copper: 1, items: [] },
      pos: { x: 1, y: 0, z: 0 },
      ...overrides,
    });
  }

  it('sends loot alone on a corpse with loot and an unclaimed harvest', () => {
    const r = rig([wolfCorpse()]);
    expect(interact(r)).toBe(true);
    expect(r.calls).toEqual(['loot:2']);
  });

  it('sends loot once the harvest claim is taken', () => {
    const r = rig([wolfCorpse({ harvestClaimedBy: 9 })]);
    expect(interact(r)).toBe(true);
    expect(r.calls).toEqual(['loot:2']);
  });

  it('a harvest-only corpse is no target: no harvest, no loot, the nothing line', () => {
    const r = rig([wolfCorpse({ loot: null })]);
    expect(interact(r)).toBe(false);
    expect(r.calls).toEqual(['error:nothing']);
  });

  it('a harvest-only corpse never swallows an eligible ordinary interaction behind it', () => {
    const npc = entity({
      id: 3,
      kind: 'npc',
      templateId: 'elder_maren',
      pos: { x: 3, y: 0, z: 0 },
    });
    const r = rig([wolfCorpse({ loot: null }), npc]);
    expect(interact(r)).toBe(true);
    expect(r.calls).toEqual(['quest:3']);
  });

  it('dispatches nothing on a claimed lootless corpse', () => {
    const r = rig([wolfCorpse({ loot: null, harvestClaimedBy: 9 })]);
    expect(interact(r)).toBe(false);
    expect(r.calls).toEqual(['error:nothing']);
  });

  it('normal material and quest loot on a corpse still opens', () => {
    const r = rig([
      wolfCorpse({
        loot: {
          copper: 0,
          items: [
            { itemId: 'wolf_fang', count: 1 },
            { itemId: 'supply_crate', count: 1, personalFor: [1] },
          ],
        },
      }),
    ]);
    expect(interact(r)).toBe(true);
    expect(r.calls).toEqual(['loot:2']);
  });

  it('a stranger-tapped corpse under owner lock stays off limits', () => {
    const r = rig([
      wolfCorpse({
        tappedById: 9,
        lootFfaTimer: 60,
        harvestClaimedBy: 9,
        loot: { copper: 12, items: [{ itemId: 'wolf_fang', count: 1 }] },
      }),
    ]);
    expect(interact(r)).toBe(false);
    expect(r.calls).toEqual(['error:nothing']);
  });

  describe('repeated presses with a delayed snapshot send zero gathering commands', () => {
    const readyBed: FarmPatchDef = {
      id: 'patch_press',
      zoneId: 'eastbrook_vale',
      tier: 1,
      x: 2,
      z: 0,
      beds: [{ id: 'bed_press_1', x: 2, z: 0 }],
    };
    const plot = (status: FarmPlotStatus): FarmPlotView => ({
      bedId: 'bed_press_1',
      cropId: 'vale_wheat',
      plantedAtMs: 0,
      readyAtMs: 1000,
      compost: false,
      watch: false,
      tonic: false,
      notified: false,
      status,
    });

    it.each(['ready', 'growing'] as const)(
      'a corpse emptied by the delayed snapshot, beside a %s crop',
      (status) => {
        const corpse = wolfCorpse();
        const r = rig([corpse]);
        r.world.farmPatches = [readyBed];
        r.world.myFarmPlots = [plot(status)];

        // Press 1: the snapshot has not caught up, the corpse still shows loot.
        expect(interact(r)).toBe(true);
        expect(interact(r)).toBe(true);
        expect(r.calls).toEqual(['loot:2', 'loot:2']);

        // The delayed snapshot lands: loot gone, harvest half still unclaimed.
        // The press now falls to the bed arm, which OPENS the sheet for my plot
        // (whatever its status) and sends no gathering command.
        r.world.entities.set(corpse.id, { ...corpse, loot: null });
        r.calls.length = 0;
        expect(interact(r)).toBe(true);
        expect(interact(r)).toBe(true);
        expect(r.calls).toEqual(['plantSheet:bed_press_1', 'plantSheet:bed_press_1']);
        expect(gatheringCalls(r.calls)).toEqual([]);
      },
    );

    it.each(['ready', 'growing'] as const)(
      'a corpse removed by the delayed snapshot, beside a %s crop',
      (status) => {
        const corpse = wolfCorpse();
        const r = rig([corpse]);
        r.world.farmPatches = [readyBed];
        r.world.myFarmPlots = [plot(status)];

        expect(interact(r)).toBe(true);
        expect(r.calls).toEqual(['loot:2']);

        r.world.entities.delete(corpse.id);
        r.calls.length = 0;
        expect(interact(r)).toBe(true);
        expect(interact(r)).toBe(true);
        expect(interact(r)).toBe(true);
        expect(r.calls).toEqual([
          'plantSheet:bed_press_1',
          'plantSheet:bed_press_1',
          'plantSheet:bed_press_1',
        ]);
        expect(gatheringCalls(r.calls)).toEqual([]);
      },
    );
  });
});

// The interact key must agree with what the viewer can actually see. A quest
// collectable the player is not on the quest for is withheld from the scene
// entirely (src/render/quest_object_gate_core.ts over the sim's ground-object
// gate), so pressing Use near one must behave as if it were not there.
describe('tryNearbyInteraction: off-quest collectables are not there', () => {
  const SUPPLY_QUEST = (() => {
    const id = ITEMS.supply_crate?.questId;
    if (!id) throw new Error('expected supply_crate to name its quest');
    return id;
  })();
  const crate = (x: number) =>
    entity({
      id: 2,
      kind: 'object',
      templateId: 'ground_supply_crate',
      objectItemId: 'supply_crate',
      lootable: true,
      pos: { x, y: 0, z: 0 },
    });
  const active = (): QuestProgress => ({
    questId: SUPPLY_QUEST,
    counts: [0],
    state: 'active',
  });

  it('never spends the press on a collectable the viewer cannot see', () => {
    const r = rig([crate(1)]);
    expect(interact(r)).toBe(false);
    expect(r.calls).toEqual(['error:nothing']);
  });

  it('picks up that same collectable once the quest is on the log', () => {
    const r = rig([crate(1)]);
    r.world.questLog.set(SUPPLY_QUEST, active());
    expect(interact(r)).toBe(true);
    expect(r.calls).toEqual(['pickup:2']);
  });

  it('lets a visible npc further away outrank a hidden collectable underfoot', () => {
    const npc = entity({ id: 3, kind: 'npc', pos: { x: 2, y: 0, z: 0 } });
    const r = rig([crate(1), npc]);
    expect(interact(r)).toBe(true);
    expect(r.calls).toEqual(['quest:3']);
  });

  it('still prefers the nearer collectable over that npc while the quest runs', () => {
    const npc = entity({ id: 3, kind: 'npc', pos: { x: 2, y: 0, z: 0 } });
    const r = rig([crate(1), npc]);
    r.world.questLog.set(SUPPLY_QUEST, active());
    expect(interact(r)).toBe(true);
    expect(r.calls).toEqual(['pickup:2']);
  });
});

// Two reaches meet on the npc arm. The nearest-wins scan has always accepted an
// npc just past INTERACT_RANGE (its sentinel is INTERACT_RANGE + 1, so a keypress
// reaches six yards), while a promotion names an npc the player selected rather
// than walked up to, so it stops at INTERACT_RANGE.
describe('tryNearbyInteraction npc reach', () => {
  const npcAt = (id: number, x: number) =>
    entity({ id, kind: 'npc', templateId: 'elder_maren', pos: { x, y: 0, z: 0 } });

  const interactPreferring = (r: ReturnType<typeof rig>, preferNpcId: number | null) =>
    tryNearbyInteraction(r.world, r.hud, 'escort away', 'nothing', true, preferNpcId);

  it('talks to an npc standing just past the five yard interact range', () => {
    const r = rig([npcAt(2, 5.5)]);
    expect(interact(r)).toBe(true);
    expect(r.calls).toEqual(['quest:2']);
  });

  it('stops the scan at the six yard sentinel', () => {
    const r = rig([npcAt(2, 6)]);
    expect(interact(r)).toBe(false);
    expect(r.calls).toEqual(['error:nothing']);
  });

  it('promotes a selected npc that is farther than the nearest but still in reach', () => {
    const near = () => npcAt(2, 1);
    const selected = () => npcAt(3, 4.5);
    for (const targets of [
      [near(), selected()],
      [selected(), near()],
    ]) {
      const r = rig(targets);
      expect(interactPreferring(r, 3)).toBe(true);
      expect(r.calls).toEqual(['quest:3']);
    }
  });

  it('refuses to promote a selected npc past the interact range', () => {
    const near = () => npcAt(2, 1);
    const selected = () => npcAt(3, 5.5);
    for (const targets of [
      [near(), selected()],
      [selected(), near()],
    ]) {
      const r = rig(targets);
      expect(interactPreferring(r, 3)).toBe(true);
      expect(r.calls).toEqual(['quest:2']);
    }
  });

  it('promotes a selected npc standing exactly ON the interact range', () => {
    // The inclusive edge of that reach check: at five yards the promotion still
    // holds, so the comparison cannot quietly narrow to a strict less-than.
    const near = () => npcAt(2, 1);
    const selected = () => npcAt(3, 5);
    for (const targets of [
      [near(), selected()],
      [selected(), near()],
    ]) {
      const r = rig(targets);
      expect(interactPreferring(r, 3)).toBe(true);
      expect(r.calls).toEqual(['quest:3']);
    }
  });

  it('still lets the scan reach an npc the promotion refused', () => {
    const r = rig([npcAt(3, 5.5)]);
    expect(interactPreferring(r, 3)).toBe(true);
    expect(r.calls).toEqual(['quest:3']);
  });
});

describe('the garden-bed arm (Phase 9b)', () => {
  const bedPatch: FarmPatchDef = {
    id: 'patch_test',
    zoneId: 'eastbrook_vale',
    tier: 1,
    x: 2,
    z: 0,
    beds: [{ id: 'bed_test_1', x: 2, z: 0 }],
  };

  function myPlot(status: FarmPlotStatus): FarmPlotView {
    return {
      bedId: 'bed_test_1',
      cropId: 'vale_wheat',
      plantedAtMs: 0,
      readyAtMs: 1000,
      compost: false,
      watch: false,
      tonic: false,
      notified: false,
      status,
    };
  }

  function bedRig(status: FarmPlotStatus | null, targets: Entity[] = []) {
    const r = rig(targets);
    r.world.farmPatches = [bedPatch];
    r.world.myFarmPlots = status === null ? [] : [myPlot(status)];
    return r;
  }

  // Intentional gathering PR1: the generic press OPENS the bed sheet for an
  // occupied bed too (the sheet paints harvest mode from the live plot), but it
  // NEVER sends harvestCrop: the sheet's explicit Harvest control is the only
  // send, whatever the plot's status and however often the key is pressed.
  it.each(['ready', 'withered', 'growing'] as const)(
    'opens the sheet beside my %s plot on every press and never sends harvest',
    (status) => {
      const r = bedRig(status);
      expect(interact(r)).toBe(true);
      expect(interact(r)).toBe(true);
      expect(r.calls).toEqual(['plantSheet:bed_test_1', 'plantSheet:bed_test_1']);
      expect(gatheringCalls(r.calls)).toEqual([]);
    },
  );

  it('an NPC in range keeps the press over a free bed (the farmer-at-the-beds collision)', () => {
    // The real layout this pins: Farmer Jessica stands about 4 yd from
    // bed_eastbrook_2, so both are routinely in reach at once. The NPC arm
    // sits above the bed arm; a press beside both must open the dialog,
    // never the sheet (the sheet is one more press after stepping clear).
    const npc = entity({
      id: 9,
      kind: 'npc',
      templateId: 'farmer_jessica',
      pos: { x: 1, y: 0, z: 0 },
    });
    const r = bedRig(null, [npc]);
    expect(interact(r)).toBe(true);
    expect(r.calls).toEqual(['quest:9']);
  });

  it('opens the plant sheet once beside a free bed and never sends harvest', () => {
    const r = bedRig(null);
    expect(interact(r)).toBe(true);
    expect(r.calls).toEqual(['plantSheet:bed_test_1']);
  });

  it('lets a corpse in range keep winning the press over a bed', () => {
    const corpse = entity({
      id: 2,
      kind: 'mob',
      dead: true,
      lootable: true,
      loot: { copper: 1, items: [] },
      pos: { x: 1, y: 0, z: 0 },
    });
    const r = bedRig('ready', [corpse]);
    expect(interact(r)).toBe(true);
    expect(r.calls).toEqual(['loot:2']);
  });

  it('falls through to the nothing-to-interact line when every bed is out of range', () => {
    const r = rig();
    r.world.farmPatches = [{ ...bedPatch, beds: [{ id: 'bed_test_1', x: 10, z: 0 }] }];
    r.world.myFarmPlots = [myPlot('ready')];
    expect(interact(r)).toBe(false);
    expect(r.calls).toEqual(['error:nothing']);
  });

  it('never fires for a dead player standing on a free bed', () => {
    const r = bedRig(null);
    r.player.dead = true;
    expect(interact(r)).toBe(false);
    expect(r.calls).toEqual(['error:nothing']);
  });
});

describe('the feast arm (Phase 12)', () => {
  // The templateId stays the LITERAL here (never the sim constant): the wire
  // rows carry this exact string, so a constant-value drift must red.
  const feast = (id: number, x = 2) =>
    entity({ id, kind: 'object', templateId: 'farm_feast', pos: { x, y: 0, z: 0 } });

  it('presses consume exactly once beside a placed feast', () => {
    const r = rig([feast(12)]);
    expect(interact(r)).toBe(true);
    expect(r.calls).toEqual(['consumeFeast:12']);
  });

  it('sends the press even when this player already ate: the sim answers feast_eaten', () => {
    // The (bp) doctrine: the ledger never crosses the wire, so the client has
    // nothing to read and must not invent a prediction. The press always
    // sends; the sim is the refusing authority.
    const r = rig([feast(12)]);
    expect(interact(r)).toBe(true);
    expect(interact(r)).toBe(true);
    expect(r.calls).toEqual(['consumeFeast:12', 'consumeFeast:12']);
  });

  it('a placed feast wins the press over a garden bed, and the bed takes it back once the feast is gone (ruling 11b-R3c-1, both directions)', () => {
    // The placed TRANSIENT outranks permanent world furniture: a feast
    // despawns on a timer and is what the player just walked to, so with
    // both in reach the press bites the feast. The second direction in the
    // SAME rig: the feast despawns (the entity leaves the roster) and the
    // identical press now opens the bed, so the bed arm is proven live
    // below the feast rather than swallowed by it. Mobile crafting stations
    // take no press at all today (proximity-activated), so the ruling's
    // station half has no arm to pin until one gains a press.
    const r = rig([feast(12)]);
    r.world.farmPatches = [
      {
        id: 'patch_test',
        zoneId: 'eastbrook_vale',
        tier: 1,
        x: 2,
        z: 0,
        beds: [{ id: 'bed_test_1', x: 2, z: 0 }],
      },
    ];
    expect(interact(r)).toBe(true);
    expect(r.calls).toEqual(['consumeFeast:12']);

    r.calls.length = 0;
    r.world.entities = new Map();
    expect(interact(r)).toBe(true);
    expect(r.calls).toEqual(['plantSheet:bed_test_1']);
  });

  it('falls through to the nothing-to-interact line when the feast is out of range', () => {
    const r = rig([feast(12, 10)]);
    expect(interact(r)).toBe(false);
    expect(r.calls).toEqual(['error:nothing']);
  });

  it('never fires for a dead player beside a feast', () => {
    const r = rig([feast(12)]);
    r.player.dead = true;
    expect(interact(r)).toBe(false);
    expect(r.calls).toEqual(['error:nothing']);
  });
});
