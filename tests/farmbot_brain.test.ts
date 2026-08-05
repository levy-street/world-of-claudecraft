import { describe, expect, it } from 'vitest';
import {
  type BotWorld,
  type BrainDeps,
  type BrainState,
  createBrain,
  findFishingRod,
  findGatherTool,
  stepBrain,
} from '../farmbot/brain';
import { parseConfig } from '../farmbot/config';
import type { GrindTables } from '../farmbot/grind_circuits';
import type { ResolvedAbility } from '../src/sim/sim';
import {
  type Entity,
  type EquipSlot,
  type GatherNodeDef,
  type InvSlot,
  type ItemDef,
  type ItemInstancePayload,
  type MobTemplate,
  type MoveInput,
  mobXpValue,
  normAngle,
  type SimEvent,
  type ZoneDef,
} from '../src/sim/types';

// --- fakes ---------------------------------------------------------------

function makeEntity(over: Partial<Entity> & { id: number }): Entity {
  return {
    kind: 'mob',
    templateId: 'test_mob',
    name: `mob_${over.id}`,
    level: 3,
    pos: { x: 0, y: 0, z: 0 },
    facing: 0,
    hp: 30,
    maxHp: 30,
    resource: 100,
    maxResource: 100,
    resourceType: 'mana',
    hostile: true,
    dead: false,
    ghost: false,
    inCombat: false,
    targetId: null,
    aggroTargetId: null,
    castingAbility: null,
    vendorItems: [],
    auras: [],
    cooldowns: new Map<string, number>(),
    eating: null,
    drinking: null,
    corpsePos: null,
    mountKey: '',
    mountCastRemaining: 0,
    ...over,
  } as Entity;
}

class FakeWorld implements BotWorld {
  known: ResolvedAbility[] = [];
  copper = 0;
  xp = 0;
  lifetimeXp = 0;
  restedXp = 0;
  player: Entity = makeEntity({
    id: 1,
    kind: 'player',
    name: 'Farmhand',
    hostile: false,
    pos: { x: 0, y: 0, z: 0 },
  });
  entities = new Map<number, Entity>();
  inventory: InvSlot[] = [];
  bagCapacity = 4;
  nodeReady = new Map<string, boolean>();
  // command recording
  moveInput: Partial<MoveInput> = {};
  facing = 0;
  targets: (number | null)[] = [];
  autoAttackStarts = 0;
  autoAttackStops = 0;
  casts: number[] = [];
  itemsUsed: string[] = [];
  interacts = 0;
  autoLoots: number[] = [];
  harvests: string[] = [];
  releases = 0;
  resurrectCorpse = 0;
  resurrectHealer = 0;
  sellJunks = 0;
  sells: { itemId: string; count?: number }[] = [];
  logouts = 0;

  nodeHarvestableByMe(nodeId: string): boolean {
    return this.nodeReady.get(nodeId) ?? true;
  }
  setMoveInput(input: Partial<MoveInput>, facing?: number): void {
    Object.assign(this.moveInput, input);
    if (facing !== undefined) this.facing = facing;
  }
  setMouselookFacing(facing: number): void {
    this.facing = facing;
  }
  targetEntity(id: number | null): void {
    this.targets.push(id);
  }
  startAutoAttack(): void {
    this.autoAttackStarts += 1;
  }
  stopAutoAttack(): void {
    this.autoAttackStops += 1;
  }
  castAbilityBySlot(slot: number): void {
    this.casts.push(slot);
  }
  useItem(itemId: string): void {
    this.itemsUsed.push(itemId);
  }
  interact(): void {
    this.interacts += 1;
  }
  lootCorpses: number[] = [];
  lootCorpse(id: number): void {
    this.lootCorpses.push(id);
  }
  autoLoot(id: number): void {
    this.autoLoots.push(id);
  }
  harvestNode(nodeId: string): void {
    this.harvests.push(nodeId);
  }
  releaseSpirit(): void {
    this.releases += 1;
  }
  resurrectAtCorpse(): void {
    this.resurrectCorpse += 1;
  }
  resurrectAtSpiritHealer(): void {
    this.resurrectHealer += 1;
  }
  sellItem(itemId: string, count?: number): void {
    this.sells.push({ itemId, count });
  }
  abilityCasts: string[] = [];
  castAbility(id: string): void {
    this.abilityCasts.push(id);
  }
  onCasts: { id: string; targetId: number }[] = [];
  castAbilityOn(id: string, targetId: number): void {
    this.onCasts.push({ id, targetId });
  }
  discards: { itemId: string; count?: number }[] = [];
  discardItem(itemId: string, count?: number): void {
    this.discards.push({ itemId, count });
  }
  dungeonEnters: string[] = [];
  enterDungeon(dungeonId: string): void {
    this.dungeonEnters.push(dungeonId);
  }
  dungeonLeaves = 0;
  leaveDungeon(): void {
    this.dungeonLeaves += 1;
  }
  equipment: Partial<Record<EquipSlot, string>> = {};
  equips: { itemId: string; slot?: EquipSlot }[] = [];
  equipItem(itemId: string): void {
    this.equips.push({ itemId });
  }
  equipItemToSlot(itemId: string, slot: EquipSlot): void {
    this.equips.push({ itemId, slot });
  }
  marketListings: {
    itemId: string;
    count?: number;
    price: number;
    instance?: ItemInstancePayload;
  }[] = [];
  marketList(itemId: string, count: number, price: number): void {
    this.marketListings.push({ itemId, count, price });
  }
  marketListInstance(itemId: string, price: number, instance: ItemInstancePayload): void {
    this.marketListings.push({ itemId, price, instance });
  }
  marketCollects = 0;
  marketCollect(): void {
    this.marketCollects += 1;
  }
  riding = false;
  ridingTrained(): boolean {
    return this.riding;
  }
  mountToggles = 0;
  toggleMounted(): void {
    this.mountToggles += 1;
  }
  ridingLessons: number[] = [];
  learnRiding(npcId: number): void {
    this.ridingLessons.push(npcId);
  }
  sellAllJunk(): void {
    this.sellJunks += 1;
  }
  mails: { to: string; subject: string; body: string; copper: number; items: InvSlot[] }[] = [];
  mailSend(to: string, subject: string, body: string, copper: number, items: InvSlot[]): void {
    this.mails.push({ to, subject, body, copper, items });
  }
  sendLogout(): void {
    this.logouts += 1;
  }
}

const NODE_A: GatherNodeDef = {
  id: 'node_a',
  zoneId: 'test_zone',
  type: 'herb',
  pos: { x: 10, z: 0 },
  level: 4,
  tier: 1,
};
const NODE_B: GatherNodeDef = {
  id: 'node_b',
  zoneId: 'test_zone',
  type: 'ore',
  pos: { x: 40, z: 0 },
  level: 4,
  tier: 1,
};
const NODES = [NODE_A, NODE_B];

const ROD_DEF = { id: 'rod', name: 'Rod', use: { type: 'fishing' } } as unknown as ItemDef;
const PICK_DEF = {
  id: 'pick',
  name: 'Pick',
  use: { type: 'gatherTool', professionId: 'mining', tier: 1 },
} as unknown as ItemDef;
const ITEM_DEFS: Record<string, ItemDef> = {
  rod: ROD_DEF,
  pick: PICK_DEF,
  grey_a: { id: 'grey_a', name: 'Grey A', quality: 'poor' } as unknown as ItemDef,
  blue_bag: { id: 'blue_bag', name: 'Gravewoven Bag', quality: 'rare' } as unknown as ItemDef,
  grey_b: { id: 'grey_b', name: 'Grey B', quality: 'poor' } as unknown as ItemDef,
  copper_ore: { id: 'copper_ore', name: 'Copper Ore', quality: 'common' } as unknown as ItemDef,
  peacebloom: { id: 'peacebloom', name: 'Peacebloom', quality: 'common' } as unknown as ItemDef,
  bread: { id: 'bread', name: 'Bread', kind: 'food', quality: 'common' } as unknown as ItemDef,
  spring_water: {
    id: 'spring_water',
    name: 'Spring Water',
    kind: 'drink',
    quality: 'common',
    drinkMana: 76,
  } as unknown as ItemDef,
  conjured_water4: {
    id: 'conjured_water4',
    name: 'Conjured Springwater',
    kind: 'drink',
    quality: 'common',
    drinkMana: 1150,
  } as unknown as ItemDef,
  conjured_bread: {
    id: 'conjured_bread',
    name: 'Conjured Oatcake',
    kind: 'food',
    quality: 'common',
    foodHp: 61,
  } as unknown as ItemDef,
  conjured_bread2: {
    id: 'conjured_bread2',
    name: 'Conjured Black Loaf',
    kind: 'food',
    quality: 'common',
    foodHp: 243,
  } as unknown as ItemDef,
  health_potion: {
    id: 'health_potion',
    name: 'Health Potion',
    kind: 'potion',
    quality: 'common',
  } as unknown as ItemDef,
  minor_health_potion: {
    id: 'minor_health_potion',
    name: 'Minor Health Potion',
    kind: 'potion',
    quality: 'common',
    potionHp: 90,
  } as unknown as ItemDef,
  greater_health_potion: {
    id: 'greater_health_potion',
    name: 'Greater Health Potion',
    kind: 'potion',
    quality: 'common',
    potionHp: 250,
  } as unknown as ItemDef,
};
const itemDef = (id: string): ItemDef | undefined => ITEM_DEFS[id];

function makeBrain(
  over: Record<string, unknown> = {},
  deps: BrainDeps = {},
): { state: BrainState; world: FakeWorld } {
  const config = parseConfig({
    serverUrl: 'wss://example.test/ws',
    characterName: 'Farmhand',
    zoneId: 'test_zone',
    ...over,
  });
  return { state: createBrain(config, { nodes: NODES, itemDef, ...deps }), world: new FakeWorld() };
}

function step(
  state: BrainState,
  world: FakeWorld,
  nowMs: number,
  events: SimEvent[] = [],
): string[] {
  return stepBrain(state, world, events, nowMs);
}

// --- tests ---------------------------------------------------------------

describe('farmbot brain: travel and harvest', () => {
  it('travels to the priority-ready node, harvests, and moves on', () => {
    const { state, world } = makeBrain();
    // default nodePriority is the nodeTypes order ['ore','wood','herb'], so
    // node_b (ore) wins over the closer node_a (herb); both are due +x
    let logs = step(state, world, 0);
    expect(state.mode).toBe('TRAVEL');
    expect(world.moveInput.forward).toBe(true);
    expect(world.facing).toBeCloseTo(Math.PI / 2);
    expect(state.travelNodeId).toBe('node_b');

    // arrive: node within INTERACT_RANGE
    world.player.pos = { x: 37, y: 0, z: 0 };
    logs = step(state, world, 100);
    expect(state.mode).toBe('HARVEST');
    expect(world.harvests).toEqual(['node_b']);
    expect(logs.some((l) => l.includes('TRAVEL -> HARVEST'))).toBe(true);

    // gather cast starts, then completes
    world.player.castingAbility = 'gathering';
    step(state, world, 200);
    expect(state.mode).toBe('HARVEST');
    expect(world.harvests).toEqual(['node_b']); // not re-issued mid-cast
    world.player.castingAbility = null;
    world.nodeReady.set('node_b', false); // node is now on respawn
    logs = step(state, world, 3000);
    expect(state.mode).toBe('TRAVEL');
    expect(logs.some((l) => l.includes('harvested node_b'))).toBe(true);
    expect(state.stats.harvests).toBe(1);
    // next tick picks node_a (node_b not ready)
    step(state, world, 3100);
    expect(state.travelNodeId).toBe('node_a');
  });

  it('re-issues harvest if the cast never starts, then gives up', () => {
    const { state, world } = makeBrain();
    world.player.pos = { x: 37, y: 0, z: 0 };
    step(state, world, 0);
    expect(state.mode).toBe('HARVEST');
    step(state, world, 1100); // retry 1
    step(state, world, 2200); // retry 2
    step(state, world, 3300); // retry 3
    expect(world.harvests).toEqual(['node_b', 'node_b', 'node_b', 'node_b']);
    const logs = step(state, world, 4400);
    expect(state.mode).toBe('TRAVEL');
    expect(logs.some((l) => l.includes('harvest failed'))).toBe(true);
    expect(state.blacklist.has('node_b')).toBe(true);
  });

  it('blacklists the node on gatherDenied', () => {
    const { state, world } = makeBrain();
    world.player.pos = { x: 37, y: 0, z: 0 };
    step(state, world, 0);
    expect(state.mode).toBe('HARVEST');
    const logs = step(state, world, 100, [
      { type: 'gatherDenied', pid: 1, surface: 'node', requiredTier: 2 } as SimEvent,
    ]);
    expect(state.mode).toBe('TRAVEL');
    expect(state.blacklist.has('node_b')).toBe(true);
    expect(logs.some((l) => l.includes('harvest denied'))).toBe(true);
  });
});

describe('farmbot brain: combat, loot, resume', () => {
  it('aggro interrupts harvest; kill leads to loot and resume', () => {
    const { state, world } = makeBrain({ combat: { abilitySlots: [0, 1] } });
    world.player.pos = { x: 37, y: 0, z: 0 };
    step(state, world, 0);
    expect(state.mode).toBe('HARVEST');

    // a wolf aggros us
    const wolf = makeEntity({ id: 42, name: 'wolf', aggroTargetId: 1, pos: { x: 39, y: 0, z: 0 } });
    world.entities.set(42, wolf);
    world.player.inCombat = true;
    let logs = step(state, world, 100);
    expect(state.mode).toBe('COMBAT');
    expect(logs.some((l) => l.includes('aggro from wolf'))).toBe(true);
    expect(world.targets).toEqual([42]);
    expect(world.autoAttackStarts).toBe(1);
    expect(world.casts).toEqual([0]); // first rotation slot immediately

    // rotation advances no faster than one cast per 500ms
    step(state, world, 300);
    expect(world.casts).toEqual([0]);
    step(state, world, 600);
    expect(world.casts).toEqual([0, 1]);
    step(state, world, 1100);
    expect(world.casts).toEqual([0, 1, 0]);

    // wolf dies, combat flag clears: loot happens the same tick (corpse in
    // range), so the brain settles back on the route immediately.
    wolf.dead = true;
    world.player.inCombat = false;
    logs = step(state, world, 1600);
    expect(logs.some((l) => l.includes('kill wolf'))).toBe(true);
    expect(state.stats.kills).toBe(1);
    expect(logs.some((l) => l.includes('COMBAT -> LOOT'))).toBe(true);
    expect(world.autoAttackStops).toBe(1);
    expect(world.targets).toEqual([42, null]);
    expect(world.autoLoots).toEqual([42]);
    expect(logs.some((l) => l.includes('loot wolf'))).toBe(true);
    expect(logs.some((l) => l.includes('loot done'))).toBe(true);
    expect(state.mode).toBe('TRAVEL');
  });

  it('walks to an out-of-range corpse and gives up after the timeout', () => {
    const { state, world } = makeBrain();
    const wolf = makeEntity({ id: 7, name: 'wolf', aggroTargetId: 1, pos: { x: 50, y: 0, z: 0 } });
    world.entities.set(7, wolf);
    world.player.inCombat = true;
    step(state, world, 0);
    expect(state.mode).toBe('COMBAT');
    wolf.dead = true;
    world.player.inCombat = false;
    step(state, world, 100);
    expect(state.mode).toBe('LOOT');
    expect(world.moveInput.forward).toBe(true); // walking to the corpse
    const logs = step(state, world, 100 + 6000);
    expect(state.mode).toBe('TRAVEL');
    expect(logs.some((l) => l.includes('loot timed out'))).toBe(true);
    expect(world.autoLoots).toEqual([]);
  });
});

describe('farmbot brain: fishing', () => {
  function fishBrain(extra: Record<string, unknown> = {}) {
    const { state, world } = makeBrain({ fishing: { enabled: true, ...extra } });
    world.nodeReady.set('node_a', false);
    world.nodeReady.set('node_b', false);
    world.inventory = [{ itemId: 'rod', count: 1 }];
    return { state, world };
  }

  it('casts, reels on the bite, lands the catch, and recasts', () => {
    const { state, world } = fishBrain();
    let logs = step(state, world, 0);
    expect(state.mode).toBe('FISH_CAST'); // no nodes ready: fish instead
    logs = step(state, world, 100);
    expect(state.mode).toBe('FISH_WAIT_BITE');
    expect(world.itemsUsed).toEqual([]); // facing arms first, cast waits

    // the cast follows once the facing has had time to ride the input stream
    step(state, world, 450);
    expect(world.itemsUsed).toEqual(['rod']);

    // cast accepted
    world.player.castingAbility = 'fishing';
    step(state, world, 500);
    expect(state.mode).toBe('FISH_WAIT_BITE');
    expect(world.itemsUsed).toEqual(['rod']);

    // bite: exactly one reel press
    step(state, world, 600, [{ type: 'fishingBite', pid: 1 } as SimEvent]);
    expect(world.itemsUsed).toEqual(['rod', 'rod']);

    // catch lands
    world.player.castingAbility = null;
    logs = step(state, world, 700, [
      {
        type: 'fishingResult',
        pid: 1,
        itemId: 'fish_koi',
        quality: 'uncommon',
        zoneId: 'test_zone',
        band: 0,
      } as SimEvent,
    ]);
    expect(logs.some((l) => l.includes('catch: fish_koi'))).toBe(true);
    expect(state.stats.catches).toBe(1);
    expect(state.mode).toBe('FISH_CAST');
  });

  it('recasts on got-away and on empty hook', () => {
    const { state, world } = fishBrain();
    step(state, world, 0);
    step(state, world, 100);
    step(state, world, 450); // cast sent
    world.player.castingAbility = 'fishing';
    step(state, world, 500);
    let logs = step(state, world, 600, [
      { type: 'fishingGotAway', pid: 1, zoneId: 'test_zone', band: 0 } as SimEvent,
    ]);
    expect(logs.some((l) => l.includes('got away'))).toBe(true);
    expect(state.mode).toBe('FISH_CAST');
    step(state, world, 700);
    step(state, world, 1050); // recast sent
    expect(world.itemsUsed).toEqual(['rod', 'rod']);
    world.player.castingAbility = 'fishing';
    step(state, world, 1100);
    logs = step(state, world, 1200, [
      { type: 'fishingEmptyHook', pid: 1, zoneId: 'test_zone', band: 0 } as SimEvent,
    ]);
    expect(logs.some((l) => l.includes('empty hook'))).toBe(true);
    expect(state.mode).toBe('FISH_CAST');
  });

  it('rotates the facing probe on "face fishable water" and gives up after a circle', () => {
    const { state, world } = fishBrain();
    step(state, world, 0);
    expect(state.fishProbeFacing).toBe(0);
    for (let i = 0; i < 8; i++) {
      step(state, world, 100 + i * 500); // arms the probe facing
      step(state, world, 450 + i * 500); // sends the cast
      expect(world.itemsUsed.length).toBe(i + 1);
      const logs = step(state, world, 500 + i * 500, [
        { type: 'error', text: 'You need to face fishable water.' } as SimEvent,
      ]);
      if (i < 7) {
        expect(state.fishProbeFacing).toBeCloseTo(normAngle(((i + 1) * Math.PI) / 4));
        expect(state.mode).toBe('FISH_CAST');
      } else {
        expect(state.mode).toBe('TRAVEL');
        expect(logs.some((l) => l.includes('no fishable water'))).toBe(true);
        expect(state.fishUnavailableUntilMs).toBeGreaterThan(0);
      }
    }
  });

  it('aggro interrupts the bite wait', () => {
    const { state, world } = fishBrain();
    step(state, world, 0);
    step(state, world, 100);
    step(state, world, 450); // cast sent
    world.player.castingAbility = 'fishing';
    step(state, world, 500);
    expect(state.mode).toBe('FISH_WAIT_BITE');
    world.entities.set(
      9,
      makeEntity({ id: 9, name: 'murloc', aggroTargetId: 1, pos: { x: 3, y: 0, z: 0 } }),
    );
    world.player.castingAbility = null;
    step(state, world, 600, [{ type: 'castStop', entityId: 1, success: false } as SimEvent]);
    expect(state.mode).toBe('COMBAT');
  });

  it('returns to travel after castsPerSpot', () => {
    const { state, world } = fishBrain({ castsPerSpot: 1 });
    step(state, world, 0);
    step(state, world, 100);
    step(state, world, 450); // cast sent
    world.player.castingAbility = 'fishing';
    step(state, world, 500);
    const logs = step(state, world, 600, [
      { type: 'fishingEmptyHook', pid: 1, zoneId: 'test_zone', band: 0 } as SimEvent,
    ]);
    expect(state.mode).toBe('TRAVEL');
    expect(logs.some((l) => l.includes('casts per spot reached'))).toBe(true);
  });
});

describe('farmbot brain: modes, spot rotation, node filters', () => {
  function idleBrain(over: Record<string, unknown>, deps: BrainDeps = {}) {
    const { state, world } = makeBrain(over, deps);
    world.nodeReady.set('node_a', false);
    world.nodeReady.set('node_b', false);
    world.inventory = [{ itemId: 'rod', count: 1 }];
    return { state, world };
  }

  it("mode 'gather' never fishes even with a rod and no ready nodes", () => {
    const { state, world } = idleBrain({ mode: 'gather' });
    step(state, world, 0);
    step(state, world, 5000);
    expect(state.mode).toBe('TRAVEL');
    expect(world.itemsUsed).toEqual([]);
    expect(world.moveInput.forward).toBe(false);
  });

  it("mode 'gather-fish' without legacy fishing.enabled stays on dry land", () => {
    const { state, world } = idleBrain({}); // defaults: mode gather-fish, enabled false
    step(state, world, 0);
    expect(state.mode).toBe('TRAVEL');
    expect(world.itemsUsed).toEqual([]);
  });

  it("mode 'fish' skips node picking and casts", () => {
    // nodes ARE ready here: fish mode must ignore them
    const { state, world } = makeBrain({ mode: 'fish' });
    world.inventory = [{ itemId: 'rod', count: 1 }];
    const logs = step(state, world, 0);
    expect(state.mode).toBe('FISH_CAST');
    expect(logs.some((l) => l.includes('fish mode'))).toBe(true);
    step(state, world, 100);
    step(state, world, 450);
    expect(world.itemsUsed).toEqual(['rod']);
    expect(world.harvests).toEqual([]);
  });

  it('stops the spot walk at the fishable shoreline, not the tape', () => {
    const { state, world } = idleBrain(
      { fishing: { enabled: true, spots: [{ x: 50, z: 0 }] } },
      { fishableAt: (x) => x >= 42 }, // water "starts" at x 42; the spot is at 50
    );
    world.player.pos = { x: 40, y: 0, z: 0 };
    step(state, world, 0); // probe from 40 fails: keep walking
    expect(state.mode).toBe('TRAVEL');
    world.player.pos = { x: 43, y: 0, z: 0 };
    const logs = step(state, world, 100); // 7 yd short of the spot: probe passes
    expect(state.mode).toBe('FISH_CAST');
    expect(logs.some((l) => l.includes('at fish spot 0'))).toBe(true);
  });

  it('rotates through fishing.spots in order and wraps', () => {
    const { state, world } = idleBrain({
      fishing: {
        enabled: true,
        spots: [
          { x: 50, z: 0 },
          { x: 50, z: 50 },
        ],
        castsPerSpot: 1,
      },
    });
    // walk to spot 0 (gate-aware: (0,0) is inside the eastbrook wall, so the
    // first hop is the east gate crossing, not the straight line due +x)
    let logs = step(state, world, 0);
    expect(state.mode).toBe('TRAVEL');
    expect(world.moveInput.forward).toBe(true);
    const gate = { x: 27.443, z: 7.31 }; // real exported crossing (scaled to the radius)
    expect(world.facing).toBeCloseTo(Math.atan2(gate.x, gate.z), 2);
    world.player.pos = { x: 50, y: 0, z: 0 };
    logs = step(state, world, 100);
    expect(state.mode).toBe('FISH_CAST');
    expect(logs.some((l) => l.includes('at fish spot 0'))).toBe(true);

    // one cast, then the rotation advances
    step(state, world, 200);
    step(state, world, 550); // cast sent
    world.player.castingAbility = 'fishing';
    step(state, world, 600);
    logs = step(state, world, 700, [
      { type: 'fishingEmptyHook', pid: 1, zoneId: 'test_zone', band: 0 } as SimEvent,
    ]);
    expect(state.mode).toBe('TRAVEL');
    expect(state.fishSpotIndex).toBe(1);
    expect(logs.some((l) => l.includes('next spot 1'))).toBe(true);

    // walk to spot 1, cast once, wrap back to spot 0
    step(state, world, 800);
    expect(world.facing).toBeCloseTo(0); // spot 1 is due +z from spot 0
    world.player.pos = { x: 50, y: 0, z: 50 };
    logs = step(state, world, 900);
    expect(state.mode).toBe('FISH_CAST');
    expect(logs.some((l) => l.includes('at fish spot 1'))).toBe(true);
    step(state, world, 1000);
    step(state, world, 1350);
    world.player.castingAbility = 'fishing';
    step(state, world, 1400);
    step(state, world, 1500, [
      { type: 'fishingEmptyHook', pid: 1, zoneId: 'test_zone', band: 0 } as SimEvent,
    ]);
    expect(state.fishSpotIndex).toBe(0);
  });

  it('pre-validates spots with the injected probe and skips dead ones', () => {
    const { state, world } = idleBrain(
      {
        fishing: {
          enabled: true,
          spots: [
            { x: 10, z: 10 },
            { x: 50, z: 0 },
          ],
        },
      },
      { fishableAt: (x) => x === 50 },
    );
    const logs = step(state, world, 0);
    expect(logs.some((l) => l.includes('spot 0 not fishable locally, skipping'))).toBe(true);
    expect(state.fishSpotIndex).toBe(1);
    expect(world.moveInput.forward).toBe(true); // walking to spot 1
    // gate-aware walk: (0,0) is inside the eastbrook wall, so the first hop
    // is the east gate crossing
    const gate = { x: 27.443, z: 7.31 };
    expect(world.facing).toBeCloseTo(Math.atan2(gate.x, gate.z), 2);
  });

  it('pauses fishing when every rotation spot fails local validation', () => {
    const { state, world } = idleBrain(
      {
        fishing: {
          enabled: true,
          spots: [
            { x: 10, z: 10 },
            { x: 50, z: 0 },
          ],
        },
      },
      { fishableAt: () => false },
    );
    const logs = step(state, world, 0);
    expect(state.mode).toBe('TRAVEL');
    expect(world.moveInput.forward).toBe(false);
    expect(logs.some((l) => l.includes('no usable spot in the rotation'))).toBe(true);
    expect(state.fishUnavailableUntilMs).toBeGreaterThan(0);
  });

  it('honors the config node whitelist and blacklist', () => {
    // whitelist restricts to node_a even though ore (node_b) outranks it
    const white = makeBrain({ nodeWhitelist: ['node_a'] });
    step(white.state, white.world, 0);
    expect(white.state.travelNodeId).toBe('node_a');

    // blacklist removes node_b, leaving the herb node
    const black = makeBrain({ nodeBlacklist: ['node_b'] });
    step(black.state, black.world, 0);
    expect(black.state.travelNodeId).toBe('node_a');
  });
});

describe('farmbot brain: recover', () => {
  it('eats below the hp threshold and resumes when recovered', () => {
    const { state, world } = makeBrain({
      combat: { eatItemId: 'bread', eatBelowHpPct: 50 },
    });
    world.player.maxHp = 100;
    world.player.hp = 30; // 30%
    const logs = step(state, world, 0);
    expect(state.mode).toBe('RECOVER');
    expect(world.itemsUsed).toEqual(['bread']);
    expect(logs.some((l) => l.includes('using bread'))).toBe(true);
    expect(world.moveInput.forward).toBe(false);
    world.player.hp = 45; // still below threshold + buffer
    step(state, world, 500);
    expect(state.mode).toBe('RECOVER');
    world.player.hp = 60;
    const logs2 = step(state, world, 1000);
    expect(state.mode).toBe('TRAVEL');
    expect(logs2.some((l) => l.includes('recovered'))).toBe(true);
  });

  it('ignores the drink threshold for rage and energy classes', () => {
    const { state, world } = makeBrain({
      combat: { drinkItemId: 'water', drinkBelowManaPct: 40 },
    });
    world.player.resourceType = 'rage';
    world.player.resource = 0; // rage rests at zero: not a reason to drink
    step(state, world, 0);
    expect(state.mode).toBe('TRAVEL');
    expect(world.itemsUsed).toEqual([]);
  });

  it('drinks below the mana threshold and times out eventually', () => {
    const { state, world } = makeBrain({
      combat: { drinkItemId: 'water', drinkBelowManaPct: 40 },
    });
    world.player.resource = 10; // 10%
    step(state, world, 0);
    expect(state.mode).toBe('RECOVER');
    expect(world.itemsUsed).toEqual(['water']);
    const logs = step(state, world, 31_000);
    expect(state.mode).toBe('TRAVEL');
    expect(logs.some((l) => l.includes('recover timed out'))).toBe(true);
  });
});

describe('farmbot brain: bags full', () => {
  const JUNK: InvSlot[] = [
    { itemId: 'junk1', count: 1 },
    { itemId: 'junk2', count: 1 },
    { itemId: 'junk3', count: 1 },
    { itemId: 'junk4', count: 1 },
  ];

  it('sells junk at a nearby vendor and resumes', () => {
    const { state, world } = makeBrain();
    world.inventory = [...JUNK];
    world.entities.set(
      50,
      makeEntity({
        id: 50,
        kind: 'npc',
        name: 'vendor_bob',
        hostile: false,
        vendorItems: ['bread'],
        pos: { x: 3, y: 0, z: 0 },
      }),
    );
    let logs = step(state, world, 0);
    expect(state.mode).toBe('BAGS_FULL');
    expect(world.targets).toEqual([50]);
    expect(world.interacts).toBe(1);
    expect(logs.some((l) => l.includes('selling junk to vendor_bob'))).toBe(true);
    logs = step(state, world, 1100);
    expect(world.sellJunks).toBe(1);
    world.inventory = [{ itemId: 'junk1', count: 1 }]; // junk sold, room again
    logs = step(state, world, 1200);
    expect(state.mode).toBe('TRAVEL');
    expect(logs.some((l) => l.includes('bags have room'))).toBe(true);
  });

  it('walks to a vendor that is out of interact range', () => {
    const { state, world } = makeBrain();
    world.inventory = [...JUNK];
    world.entities.set(
      50,
      makeEntity({
        id: 50,
        kind: 'npc',
        name: 'vendor_bob',
        hostile: false,
        vendorItems: ['x'],
        pos: { x: 30, y: 0, z: 0 },
      }),
    );
    step(state, world, 0);
    expect(state.mode).toBe('BAGS_FULL');
    expect(world.moveInput.forward).toBe(true);
    expect(world.interacts).toBe(0);
  });

  it('logs out immediately under the stop policy', () => {
    const { state, world } = makeBrain({ bags: { fullPolicy: 'stop' } });
    world.inventory = [...JUNK];
    const logs = step(state, world, 0);
    expect(state.done).toBe(true);
    expect(world.logouts).toBe(1);
    expect(logs.some((l) => l.includes('bags full: logging out'))).toBe(true);
  });

  it('falls back to logout when no vendor is nearby', () => {
    const { state, world } = makeBrain(); // default sell-junk
    world.inventory = [...JUNK];
    step(state, world, 0);
    expect(state.mode).toBe('BAGS_FULL');
    expect(world.logouts).toBe(0);
    const logs = step(state, world, 31_000);
    expect(state.done).toBe(true);
    expect(world.logouts).toBe(1);
    expect(logs.some((l) => l.includes('no vendor nearby'))).toBe(true);
  });

  it('enters BAGS_FULL from the error event even before the mirror catches up', () => {
    const { state, world } = makeBrain();
    world.inventory = [...JUNK]; // full, but the point is the event also triggers it
    const logs = step(state, world, 0, [
      { type: 'error', text: 'Your bags are full.' } as SimEvent,
    ]);
    expect(state.mode).toBe('BAGS_FULL');
    expect(logs.some((l) => l.includes('BAGS_FULL'))).toBe(true);
    expect(world.logouts).toBe(0); // sell-junk policy: waits for a vendor first
  });
});

describe('farmbot brain: death', () => {
  it('releases, ghost-runs to the corpse, resurrects, and resumes', () => {
    const { state, world } = makeBrain();
    step(state, world, 0); // records lastAlivePos at (0,0)
    world.player.dead = true;
    let logs = step(state, world, 100);
    expect(state.mode).toBe('DEAD');
    expect(world.releases).toBe(1);
    expect(logs.some((l) => l.includes('releasing spirit'))).toBe(true);

    world.player.dead = false;
    world.player.ghost = true;
    world.player.pos = { x: 100, y: 0, z: 0 };
    step(state, world, 200);
    expect(world.moveInput.forward).toBe(true); // running back
    expect(world.resurrectHealer).toBe(0);

    world.player.pos = { x: 2, y: 0, z: 0 }; // at the corpse
    logs = step(state, world, 300);
    expect(world.resurrectCorpse).toBe(1);
    expect(logs.some((l) => l.includes('resurrecting at corpse'))).toBe(true);

    world.player.ghost = false;
    logs = step(state, world, 400);
    expect(state.mode).toBe('TRAVEL');
    expect(logs.some((l) => l.includes('resurrected'))).toBe(true);
  });

  it('uses the spirit healer when no corpse position is known', () => {
    const { state, world } = makeBrain();
    world.player.ghost = true; // first tick ever: no lastAlivePos recorded
    const logs = step(state, world, 0);
    expect(state.mode).toBe('DEAD');
    expect(world.resurrectHealer).toBe(1);
    expect(logs.some((l) => l.includes('spirit healer'))).toBe(true);
  });
});

describe('farmbot brain: death handling (phase 3)', () => {
  const DEATH = { type: 'playerDeath', pid: 1 } as SimEvent;

  function dieAndGhost(state: BrainState, world: FakeWorld, atMs: number): void {
    world.player.dead = true;
    step(state, world, atMs, [DEATH]);
    world.player.dead = false;
    world.player.ghost = true;
  }

  it('runs the ghost to corpsePos, not the last-alive pos', () => {
    const { state, world } = makeBrain();
    step(state, world, 0); // lastAlivePos (0,0)
    world.player.corpsePos = { x: 0, y: 0, z: 150 };
    dieAndGhost(state, world, 100);
    world.player.pos = { x: 100, y: 0, z: 100 };
    step(state, world, 200);
    expect(world.moveInput.forward).toBe(true);
    // toward (0,150) from (100,100): atan2(-100, 50)
    expect(world.facing).toBeCloseTo(Math.atan2(-100, 50));

    // 30 yd out from the body: inside CORPSE_REZ_RANGE (35)
    world.player.pos = { x: 0, y: 0, z: 120 };
    const logs = step(state, world, 300);
    expect(world.resurrectCorpse).toBe(1);
    expect(logs.some((l) => l.includes('resurrecting at corpse'))).toBe(true);
  });

  it('falls back to the last-alive pos when corpsePos is null', () => {
    const { state, world } = makeBrain();
    step(state, world, 0); // lastAlivePos (0,0)
    dieAndGhost(state, world, 100);
    world.player.pos = { x: 50, y: 0, z: 0 };
    step(state, world, 200);
    expect(world.facing).toBeCloseTo(-Math.PI / 2); // back toward (0,0)
  });

  it('rests after a revive: eats below full, waits out the channel, resumes', () => {
    const { state, world } = makeBrain({ combat: { eatItemId: 'bread' } });
    world.inventory = [{ itemId: 'bread', count: 2 }]; // configured item must be in the bags
    step(state, world, 0);
    world.player.corpsePos = { x: 0, y: 0, z: 0 };
    dieAndGhost(state, world, 100);
    world.player.ghost = false;
    world.player.corpsePos = null;
    world.player.maxHp = 100;
    world.player.hp = 50; // corpse res leaves us at half
    let logs = step(state, world, 200);
    expect(state.mode).toBe('REST');
    expect(logs.some((l) => l.includes('resurrected, resting'))).toBe(true);
    expect(world.itemsUsed).toEqual(['bread']);

    // the eating channel is live: no re-issue
    world.player.eating = {} as Entity['eating'];
    step(state, world, 300);
    expect(world.itemsUsed).toEqual(['bread']);
    // channel done, still short, throttle elapsed: eat again
    world.player.eating = null;
    step(state, world, 1300);
    expect(world.itemsUsed).toEqual(['bread', 'bread']);
    // full: back to the route
    world.player.hp = 96;
    logs = step(state, world, 1400);
    expect(state.mode).toBe('TRAVEL');
    expect(logs.some((l) => l.includes('rested'))).toBe(true);
  });

  it('rests on a plain wait when no food is configured', () => {
    const { state, world } = makeBrain();
    step(state, world, 0);
    dieAndGhost(state, world, 100);
    world.player.ghost = false;
    world.player.maxHp = 100;
    world.player.hp = 20; // healer res
    const logs = step(state, world, 200);
    expect(state.mode).toBe('REST');
    expect(world.itemsUsed).toEqual([]);
    world.player.hp = 97;
    step(state, world, 300);
    expect(state.mode).toBe('TRAVEL');
    expect(logs.some((l) => l.includes('resurrected, resting'))).toBe(true);
  });

  it('only waits on mana for mana classes, and drinks for them', () => {
    // rage class: empty resource bar must not hold the rest
    const rage = makeBrain();
    step(rage.state, rage.world, 0);
    dieAndGhost(rage.state, rage.world, 100);
    rage.world.player.ghost = false;
    rage.world.player.maxHp = 100;
    rage.world.player.hp = 96;
    rage.world.player.resourceType = 'rage';
    rage.world.player.resource = 0;
    step(rage.state, rage.world, 200);
    expect(rage.state.mode).toBe('TRAVEL'); // no REST at all

    // mana class: drinks and waits for the mana bar
    const { state, world } = makeBrain({ combat: { drinkItemId: 'water' } });
    world.inventory = [{ itemId: 'water', count: 2 }]; // configured item must be in the bags
    step(state, world, 0);
    dieAndGhost(state, world, 100);
    world.player.ghost = false;
    world.player.maxHp = 100;
    world.player.hp = 96;
    world.player.resource = 10; // 10%
    const logs = step(state, world, 200);
    expect(state.mode).toBe('REST');
    expect(world.itemsUsed).toEqual(['water']);
    expect(logs.some((l) => l.includes('resting: drinking water'))).toBe(true);
    world.player.resource = 96;
    step(state, world, 1300);
    expect(state.mode).toBe('TRAVEL');
  });

  it('logs resurrection sickness when the aura is present', () => {
    const { state, world } = makeBrain({ death: { waitUntilFull: false } });
    step(state, world, 0);
    dieAndGhost(state, world, 100);
    world.player.ghost = false;
    world.player.auras = [{ id: 'resurrection_sickness' } as Entity['auras'][number]];
    const logs = step(state, world, 200);
    expect(logs.some((l) => l.includes('resurrection sickness'))).toBe(true);
    expect(state.mode).toBe('TRAVEL'); // waitUntilFull off: straight back
  });

  it('avoids nodes near a fresh death spot, ignores other players deaths, expires', () => {
    const { state, world } = makeBrain();
    step(state, world, 0);
    // someone else dies: not ours, ignored
    step(state, world, 50, [{ type: 'playerDeath', pid: 999 } as SimEvent]);
    expect(state.deathCount).toBe(0);
    expect(state.deathSpots).toEqual([]);

    // we die next to node_b (40,0): it is excluded while the spot is fresh
    world.player.pos = { x: 38, y: 0, z: 0 };
    dieAndGhost(state, world, 100);
    world.player.ghost = false;
    step(state, world, 200);
    expect(state.deathCount).toBe(1);
    step(state, world, 300);
    expect(state.travelNodeId).toBe('node_a'); // node_b is 2 yd from the death spot
  });

  it('lets the route back in after avoidDeathSpotMinutes', () => {
    const { state, world } = makeBrain({ death: { avoidDeathSpotMinutes: 0.001 } }); // 60 ms
    step(state, world, 0);
    world.player.pos = { x: 38, y: 0, z: 0 };
    dieAndGhost(state, world, 100);
    world.player.ghost = false;
    step(state, world, 200);
    step(state, world, 5000); // spot long expired
    expect(state.travelNodeId).toBe('node_b');
    expect(state.deathSpots).toEqual([]); // expired entries are dropped
  });

  it('skips fish spots near a fresh death spot', () => {
    const { state, world } = makeBrain({
      fishing: {
        enabled: true,
        spots: [
          { x: 10, z: 10 },
          { x: 50, z: 0 },
        ],
      },
    });
    world.nodeReady.set('node_a', false);
    world.nodeReady.set('node_b', false);
    world.inventory = [{ itemId: 'rod', count: 1 }];
    step(state, world, 0);
    world.player.pos = { x: 12, y: 0, z: 10 }; // die 2 yd from spot 0
    dieAndGhost(state, world, 100);
    world.player.ghost = false;
    world.player.pos = { x: 0, y: 0, z: 0 };
    const logs = step(state, world, 200); // revive tick already re-runs TRAVEL
    expect(logs.some((l) => l.includes('spot 0 near a death spot, skipping'))).toBe(true);
    expect(state.fishSpotIndex).toBe(1);
    // walking to spot 1, gate-aware: the first hop is the east gate crossing
    const gate = { x: 27.443, z: 7.31 };
    expect(world.facing).toBeCloseTo(Math.atan2(gate.x, gate.z), 2);
  });

  it('trips the circuit breaker exactly at maxDeaths', () => {
    const { state, world } = makeBrain({ death: { maxDeaths: 2, waitUntilFull: false } });
    step(state, world, 0);
    dieAndGhost(state, world, 100);
    expect(state.deathCount).toBe(1);
    expect(state.done).toBe(false);
    expect(world.logouts).toBe(0);
    world.player.ghost = false;
    step(state, world, 200);
    world.player.dead = true;
    const logs = step(state, world, 300, [DEATH]);
    expect(state.deathCount).toBe(2);
    expect(state.done).toBe(true);
    expect(world.logouts).toBe(1);
    expect(logs.some((l) => l.includes('circuit breaker'))).toBe(true);
  });
});

describe('farmbot brain: runtime cap', () => {
  it('logs out when maxRuntimeMinutes elapses', () => {
    const { state, world } = makeBrain({ maxRuntimeMinutes: 1 });
    step(state, world, 0);
    expect(state.done).toBe(false);
    const logs = step(state, world, 61_000);
    expect(state.done).toBe(true);
    expect(world.logouts).toBe(1);
    expect(logs.some((l) => l.includes('max runtime'))).toBe(true);
  });
});

describe('farmbot brain: item helpers', () => {
  it('finds fishing rods and gather tools in the inventory', () => {
    const inv: InvSlot[] = [
      { itemId: 'junk', count: 3 },
      { itemId: 'rod', count: 1 },
      { itemId: 'pick', count: 1 },
    ];
    expect(findFishingRod(inv, itemDef)).toBe('rod');
    expect(findGatherTool(inv, itemDef, 'mining')).toBe('pick');
    expect(findGatherTool(inv, itemDef, 'herbalism')).toBeNull();
    expect(findFishingRod([{ itemId: 'junk', count: 1 }], itemDef)).toBeNull();
  });
});

describe('farmbot brain: safety (phase 4)', () => {
  const WHISPER = {
    type: 'chat',
    fromPid: 99,
    from: 'Stranger',
    text: 'hi there',
    channel: 'whisper',
  } as SimEvent;

  it('queues alerts at the alert-worthy sites', () => {
    // death + spirit healer
    const { state, world } = makeBrain();
    world.player.ghost = true;
    step(state, world, 0); // healer res: no corpse known
    expect(state.alerts.some((a) => a.kind === 'spirit-healer')).toBe(true);
    world.player.ghost = false;
    world.player.dead = true;
    step(state, world, 100, [{ type: 'playerDeath', pid: 1 } as SimEvent]);
    expect(state.alerts.some((a) => a.kind === 'death')).toBe(true);
    expect(state.stats.deaths).toBe(1);

    // circuit breaker
    const cb = makeBrain({ death: { maxDeaths: 1 } });
    cb.world.player.dead = true;
    step(cb.state, cb.world, 0, [{ type: 'playerDeath', pid: 1 } as SimEvent]);
    expect(cb.state.alerts.some((a) => a.kind === 'circuit-breaker')).toBe(true);

    // bags-full logout
    const bags = makeBrain({ bags: { fullPolicy: 'stop' } });
    bags.world.inventory = [
      { itemId: 'a', count: 1 },
      { itemId: 'b', count: 1 },
      { itemId: 'c', count: 1 },
      { itemId: 'd', count: 1 },
    ];
    step(bags.state, bags.world, 0);
    expect(bags.state.alerts.some((a) => a.kind === 'bags-full')).toBe(true);

    // max runtime
    const rt = makeBrain({ maxRuntimeMinutes: 1 });
    step(rt.state, rt.world, 0);
    step(rt.state, rt.world, 61_000);
    expect(rt.state.alerts.some((a) => a.kind === 'max-runtime')).toBe(true);
  });

  it("whisperAction 'log' only logs, 'alarm' alerts, 'logout' logs out", () => {
    const logOnly = makeBrain({ safety: { whisperAction: 'log' } });
    const logs = step(logOnly.state, logOnly.world, 0, [WHISPER]);
    expect(logs.some((l) => l.includes('whisper from Stranger'))).toBe(true);
    expect(logOnly.state.alerts).toEqual([]);
    expect(logOnly.state.done).toBe(false);

    const alarm = makeBrain({ safety: { whisperAction: 'alarm' } });
    step(alarm.state, alarm.world, 0, [WHISPER]);
    expect(alarm.state.alerts.some((a) => a.kind === 'whisper')).toBe(true);
    expect(alarm.state.done).toBe(false);

    const logout = makeBrain({ safety: { whisperAction: 'logout' } });
    const logoutLogs = step(logout.state, logout.world, 0, [WHISPER]);
    expect(logout.state.done).toBe(true);
    expect(logout.world.logouts).toBe(1);
    expect(logout.state.alerts.some((a) => a.kind === 'whisper')).toBe(true);
    expect(logoutLogs.some((l) => l.includes('whisper watch: logging out'))).toBe(true);
  });

  it('ignores the sender echo of an outgoing whisper', () => {
    const { state, world } = makeBrain({ safety: { whisperAction: 'logout' } });
    const echo = { ...WHISPER, to: 'SomeoneElse' } as SimEvent;
    const logs = step(state, world, 0, [echo]);
    expect(state.alerts).toEqual([]);
    expect(state.done).toBe(false);
    expect(logs.some((l) => l.includes('whisper from'))).toBe(false);
  });

  it('watches say only within 20 yd', () => {
    const { state, world } = makeBrain({ safety: { whisperAction: 'alarm' } });
    world.entities.set(
      60,
      makeEntity({
        id: 60,
        kind: 'player',
        name: 'Near',
        hostile: false,
        pos: { x: 10, y: 0, z: 0 },
      }),
    );
    world.entities.set(
      61,
      makeEntity({
        id: 61,
        kind: 'player',
        name: 'Far',
        hostile: false,
        pos: { x: 30, y: 0, z: 0 },
      }),
    );
    step(state, world, 0, [
      {
        type: 'chat',
        fromPid: 61,
        from: 'Far',
        text: 'distant',
        channel: 'say',
        entityId: 61,
      } as SimEvent,
    ]);
    expect(state.alerts).toEqual([]);
    step(state, world, 100, [
      {
        type: 'chat',
        fromPid: 60,
        from: 'Near',
        text: 'close',
        channel: 'say',
        entityId: 60,
      } as SimEvent,
    ]);
    expect(state.alerts.some((a) => a.kind === 'whisper' && a.text.includes('say from Near'))).toBe(
      true,
    );
  });

  it('pauses after the configured presence, lifts after a clear spell', () => {
    const { state, world } = makeBrain({
      safety: { playerPause: { enabled: true, radiusYd: 40, seconds: 2 } },
    });
    world.entities.set(
      70,
      makeEntity({
        id: 70,
        kind: 'player',
        name: 'Passerby',
        hostile: false,
        pos: { x: 10, y: 0, z: 0 },
      }),
    );
    step(state, world, 0);
    expect(state.mode).toBe('TRAVEL'); // presence timer just started
    step(state, world, 1000);
    expect(state.mode).toBe('TRAVEL');
    let logs = step(state, world, 2000);
    expect(state.mode).toBe('PAUSED');
    expect(world.moveInput.forward).toBe(false);
    expect(logs.some((l) => l.includes('player nearby'))).toBe(true);
    expect(state.alerts.some((a) => a.kind === 'player-pause')).toBe(true);

    world.entities.delete(70);
    step(state, world, 2100); // clear spell starts
    expect(state.mode).toBe('PAUSED');
    step(state, world, 5000);
    expect(state.mode).toBe('PAUSED');
    logs = step(state, world, 12100); // 10 s clear
    expect(state.mode).toBe('TRAVEL');
    expect(logs.some((l) => l.includes('area clear'))).toBe(true);
  });

  it('combat pre-empts the pause', () => {
    const { state, world } = makeBrain({
      safety: { playerPause: { enabled: true, radiusYd: 40, seconds: 1 } },
    });
    world.entities.set(
      70,
      makeEntity({
        id: 70,
        kind: 'player',
        name: 'Passerby',
        hostile: false,
        pos: { x: 10, y: 0, z: 0 },
      }),
    );
    step(state, world, 0);
    step(state, world, 1000);
    expect(state.mode).toBe('PAUSED');
    world.entities.set(
      71,
      makeEntity({ id: 71, name: 'wolf', aggroTargetId: 1, pos: { x: 5, y: 0, z: 0 } }),
    );
    world.player.inCombat = true;
    step(state, world, 1100);
    expect(state.mode).toBe('COMBAT');
  });

  it('takes idle schedule breaks and resumes with a fresh session clock', () => {
    const { state, world } = makeBrain({
      safety: { schedule: { sessionMinutes: 0.001, breakMinutes: 0.001, breakAction: 'idle' } },
    });
    step(state, world, 0);
    expect(state.mode).toBe('TRAVEL'); // 60 ms session not over
    let logs = step(state, world, 100);
    expect(state.mode).toBe('BREAK');
    expect(logs.some((l) => l.includes('session break'))).toBe(true);
    expect(state.alerts.some((a) => a.kind === 'break')).toBe(true);
    expect(world.moveInput.forward).toBe(false);
    step(state, world, 150);
    expect(state.mode).toBe('BREAK'); // 60 ms break not over
    logs = step(state, world, 200);
    expect(state.mode).toBe('TRAVEL');
    expect(logs.some((l) => l.includes('break over'))).toBe(true);
    logs = step(state, world, 300); // 60 ms into the new session
    expect(state.mode).toBe('BREAK'); // second cycle fires
    expect(logs.some((l) => l.includes('session break'))).toBe(true);
  });

  it("schedule breakAction 'logout' ends the session", () => {
    const { state, world } = makeBrain({
      safety: { schedule: { sessionMinutes: 0.001, breakAction: 'logout' } },
    });
    step(state, world, 0);
    const logs = step(state, world, 100);
    expect(state.done).toBe(true);
    expect(world.logouts).toBe(1);
    expect(logs.some((l) => l.includes('session break: logging out'))).toBe(true);
    expect(state.alerts.some((a) => a.kind === 'break')).toBe(true);
  });

  it('jitter spreads the node pick over the top 3 candidates', () => {
    const jitNodes: GatherNodeDef[] = [
      { id: 'j1', zoneId: 'test_zone', type: 'herb', pos: { x: 10, z: 0 }, level: 4, tier: 1 },
      { id: 'j2', zoneId: 'test_zone', type: 'herb', pos: { x: 20, z: 0 }, level: 4, tier: 1 },
      { id: 'j3', zoneId: 'test_zone', type: 'herb', pos: { x: 30, z: 0 }, level: 4, tier: 1 },
    ];
    const mk = (rng?: () => number) => {
      const config = parseConfig({ serverUrl: 'w', characterName: 'c', zoneId: 'test_zone' });
      const world = new FakeWorld();
      return { state: createBrain(config, { nodes: jitNodes, itemDef, rng }), world };
    };
    const plain = mk(); // no rng: deterministic best pick
    step(plain.state, plain.world, 0);
    expect(plain.state.travelNodeId).toBe('j1');
    const low = mk(() => 0); // first of the spread
    step(low.state, low.world, 0);
    expect(low.state.travelNodeId).toBe('j1');
    const high = mk(() => 0.99); // last of the spread
    step(high.state, high.world, 0);
    expect(high.state.travelNodeId).toBe('j3');
  });

  it('jitter gates the harvest action behind a short pause', () => {
    const { state, world } = makeBrain({}, { rng: () => 0 }); // 500 ms gate
    world.player.pos = { x: 37, y: 0, z: 0 }; // at node_b
    step(state, world, 0);
    expect(state.mode).toBe('TRAVEL'); // gate armed, not issued yet
    expect(world.harvests).toEqual([]);
    step(state, world, 400);
    expect(world.harvests).toEqual([]);
    step(state, world, 500);
    expect(world.harvests).toEqual(['node_b']);
    expect(state.mode).toBe('HARVEST');
  });

  it('rest times out instead of idling forever', () => {
    const { state, world } = makeBrain();
    step(state, world, 0);
    world.player.dead = true;
    step(state, world, 100, [{ type: 'playerDeath', pid: 1 } as SimEvent]);
    world.player.dead = false;
    world.player.ghost = false;
    world.player.maxHp = 100;
    world.player.hp = 20; // short, no food configured: plain wait
    step(state, world, 200);
    expect(state.mode).toBe('REST');
    const logs = step(state, world, 200 + 181_000);
    expect(state.mode).toBe('TRAVEL');
    expect(logs.some((l) => l.includes('rest timed out, resuming anyway'))).toBe(true);
  });
});

describe('farmbot brain: combat upgrade (phase 5)', () => {
  function knownAbility(id: string, cost = 10): ResolvedAbility {
    return {
      def: {
        id,
        name: id,
        class: 'warrior',
        cost,
        castTime: 0,
        cooldown: 0,
        range: 0,
        school: 'physical',
        requiresTarget: true,
      },
      rank: 1,
      cost,
      castTime: 0,
      cooldown: 0,
      effects: [{ type: 'weaponStrike', bonus: 0 }],
      threatFlat: 0,
      threatMult: 1,
    } as unknown as ResolvedAbility;
  }

  function withAttacker(world: FakeWorld, over: Partial<Entity> = {}) {
    const mob = makeEntity({
      id: 80,
      name: 'wolf',
      aggroTargetId: 1,
      pos: { x: 3, y: 0, z: 0 },
      ...over,
    });
    world.entities.set(80, mob);
    world.player.inCombat = true;
    return mob;
  }

  it('auto rotation picks the first ready slot and respects cooldowns', () => {
    const { state, world } = makeBrain({ combat: { rotationMode: 'auto' } });
    world.player.cooldowns = new Map();
    world.player.gcdRemaining = 0;
    world.player.resource = 100;
    world.known = [knownAbility('strike'), knownAbility('slam')];
    withAttacker(world);
    step(state, world, 0);
    expect(state.mode).toBe('COMBAT');
    expect(world.casts).toEqual([0]); // strike ready

    world.player.cooldowns.set('strike', 5);
    step(state, world, 600);
    expect(world.casts).toEqual([0, 1]); // slam next in slot order

    world.player.cooldowns.set('slam', 5);
    step(state, world, 1200);
    expect(world.casts).toEqual([0, 1]); // nothing ready: auto-attack only

    world.player.cooldowns.clear();
    step(state, world, 1800);
    expect(world.casts).toEqual([0, 1, 0]); // strike again
  });

  it('flees from an outleveled attacker, away vector math', () => {
    const { state, world } = makeBrain({
      combat: { flee: 'outleveled', fleeAboveLevelDelta: 3 },
    });
    world.player.level = 3;
    withAttacker(world, { level: 7, pos: { x: 10, y: 0, z: 0 } });
    const logs = step(state, world, 0);
    expect(state.mode).toBe('FLEE');
    expect(logs.some((l) => l.includes('outleveled'))).toBe(true);
    expect(world.autoAttackStarts).toBe(0);
    expect(world.moveInput.forward).toBe(true);
    expect(world.facing).toBeCloseTo(-Math.PI / 2); // directly away from +x threat
  });

  it('does not flee a same-level attacker', () => {
    const { state, world } = makeBrain({
      combat: { flee: 'outleveled', fleeAboveLevelDelta: 3 },
    });
    world.player.level = 3;
    withAttacker(world, { level: 6 }); // exactly at the delta: fight
    step(state, world, 0);
    expect(state.mode).toBe('COMBAT');
  });

  it('steers toward the zone hub when it is far', () => {
    const { state, world } = makeBrain(
      { combat: { flee: 'outleveled', fleeAboveLevelDelta: 3 } },
      { zoneHubAt: () => ({ x: 0, z: -100 }) },
    );
    world.player.level = 3;
    withAttacker(world, { level: 7, pos: { x: 10, y: 0, z: 0 } });
    step(state, world, 0);
    expect(state.mode).toBe('FLEE');
    expect(world.facing).toBeCloseTo(Math.PI); // hub-ward, not just away
  });

  it('resumes when aggro drops mid-flee, fights when the timeout expires', () => {
    const { state, world } = makeBrain({
      combat: { flee: 'outleveled', fleeAboveLevelDelta: 3 },
    });
    world.player.level = 3;
    const mob = withAttacker(world, { level: 7, pos: { x: 10, y: 0, z: 0 } });
    step(state, world, 0);
    expect(state.mode).toBe('FLEE');

    // leash breaks: mob loses interest, combat flag clears
    mob.aggroTargetId = null;
    world.player.inCombat = false;
    step(state, world, 1000);
    expect(state.mode).toBe('LOOT');
    step(state, world, 1100);
    expect(state.mode).toBe('TRAVEL');

    // second scenario: it never breaks, so the bot turns and fights
    const stuck = makeBrain({ combat: { flee: 'outleveled', fleeAboveLevelDelta: 3 } });
    stuck.world.player.level = 3;
    withAttacker(stuck.world, { level: 7, pos: { x: 10, y: 0, z: 0 } });
    step(stuck.state, stuck.world, 0);
    expect(stuck.state.mode).toBe('FLEE');
    const logs = step(stuck.state, stuck.world, 16_000);
    expect(stuck.state.mode).toBe('COMBAT'); // turned within the flee tick
    expect(logs.some((l) => l.includes('turning to fight'))).toBe(true);
    step(stuck.state, stuck.world, 16_100);
    expect(stuck.state.mode).toBe('COMBAT'); // latched: no second flee
    expect(stuck.world.targets).toEqual([80]);
  });

  it('grind pulls a nearby hostile when no node is ready, then loots and resumes', () => {
    const { state, world } = makeBrain({ combat: { grind: true } });
    world.nodeReady.set('node_a', false);
    world.nodeReady.set('node_b', false);
    const mob = makeEntity({ id: 90, name: 'boar', pos: { x: 20, y: 0, z: 0 } });
    world.entities.set(90, mob);
    let logs = step(state, world, 0);
    expect(state.mode).toBe('COMBAT');
    expect(logs.some((l) => l.includes('grind: pulling boar'))).toBe(true);
    expect(world.targets).toEqual([90]);
    expect(world.autoAttackStarts).toBe(1);

    // the pull lands: mob aggros, we kill it
    mob.aggroTargetId = 1;
    world.player.inCombat = true;
    step(state, world, 500);
    expect(state.mode).toBe('COMBAT');
    mob.dead = true;
    world.player.inCombat = false;
    logs = step(state, world, 1000);
    expect(state.mode).toBe('LOOT');
    expect(logs.some((l) => l.includes('kill boar'))).toBe(true);
    expect(world.moveInput.forward).toBe(true); // walking to the corpse (20 yd out)
    world.player.pos = { x: 18, y: 0, z: 0 };
    logs = step(state, world, 1100);
    expect(world.autoLoots).toEqual([90]);
    expect(logs.some((l) => l.includes('loot boar'))).toBe(true);
    step(state, world, 1300);
    expect(state.mode).toBe('TRAVEL');
  });

  it('does not grind by default, and not when a node is ready nearby', () => {
    // default off: mob in range, nodes dry, bot idles
    const off = makeBrain();
    off.world.nodeReady.set('node_a', false);
    off.world.nodeReady.set('node_b', false);
    off.world.entities.set(90, makeEntity({ id: 90, name: 'boar', pos: { x: 20, y: 0, z: 0 } }));
    step(off.state, off.world, 0);
    expect(off.state.mode).toBe('TRAVEL');
    expect(off.world.autoAttackStarts).toBe(0);

    // on, but node_b is ready within 30 yd: route wins over grinding
    const near = makeBrain({ combat: { grind: true } });
    near.world.player.pos = { x: 20, y: 0, z: 0 }; // node_b at (40,0) is 20 yd away
    near.world.entities.set(90, makeEntity({ id: 90, name: 'boar', pos: { x: 30, y: 0, z: 0 } }));
    step(near.state, near.world, 0);
    expect(near.state.mode).toBe('TRAVEL');
    expect(near.state.travelNodeId).toBe('node_b');
    expect(near.world.autoAttackStarts).toBe(0);
  });
});

describe('farmbot brain: bags offload (phase 6)', () => {
  function vendorAt(x: number) {
    return makeEntity({
      id: 50,
      kind: 'npc',
      name: 'vendor_bob',
      hostile: false,
      vendorItems: ['bread'],
      pos: { x, y: 0, z: 0 },
    });
  }
  function mailboxAt(x: number) {
    return makeEntity({
      id: 60,
      kind: 'object',
      templateId: 'mailbox',
      name: 'mailbox',
      hostile: false,
      pos: { x, y: 0, z: 0 },
    });
  }

  it('allowlist mode sells only listed greys and never calls sellAllJunk', () => {
    const { state, world } = makeBrain({ bags: { sellAllowlist: ['grey_a'] } });
    world.inventory = [
      { itemId: 'grey_a', count: 2 },
      { itemId: 'grey_b', count: 1 },
      { itemId: 'copper_ore', count: 5 },
      { itemId: 'bread', count: 1 },
    ];
    world.entities.set(50, vendorAt(3));
    step(state, world, 0);
    expect(state.mode).toBe('BAGS_FULL');
    expect(world.interacts).toBe(1);
    const logs = step(state, world, 1100);
    expect(world.sells).toEqual([{ itemId: 'grey_a', count: 2 }]);
    expect(world.sellJunks).toBe(0);
    expect(logs.some((l) => l.includes('sold 1 allowlisted stacks'))).toBe(true);

    // nothing sellable left but bags still full: note once, ride the timeout
    world.inventory = [
      { itemId: 'grey_b', count: 1 },
      { itemId: 'copper_ore', count: 5 },
      { itemId: 'bread', count: 1 },
      { itemId: 'rod', count: 1 },
    ];
    const logs2 = step(state, world, 2200);
    expect(world.sells.length).toBe(1);
    expect(logs2.some((l) => l.includes('nothing on the sell allowlist'))).toBe(true);
  });

  it('mails gathered mats to the alt, keeping rod, tools, food, and junk', () => {
    const { state, world } = makeBrain({
      bags: { mailTo: 'Bankalt' },
      combat: { eatItemId: 'bread' },
    });
    world.bagCapacity = 5;
    world.inventory = [
      { itemId: 'copper_ore', count: 5 },
      { itemId: 'grey_a', count: 1 },
      { itemId: 'rod', count: 1 },
      { itemId: 'pick', count: 1 },
      { itemId: 'bread', count: 1 },
    ];
    world.entities.set(60, mailboxAt(3));
    world.entities.set(50, vendorAt(4));
    const logs = step(state, world, 0);
    expect(state.mode).toBe('BAGS_FULL');
    expect(world.mails).toEqual([
      {
        to: 'Bankalt',
        subject: 'farm mats',
        body: '',
        copper: 0,
        items: [{ itemId: 'copper_ore', count: 5 }],
      },
    ]);
    expect(logs.some((l) => l.includes('mailing 5x copper_ore to Bankalt'))).toBe(true);
    expect(world.interacts).toBe(0); // vendor not engaged while mailing

    const logs2 = step(state, world, 100, [{ type: 'mailResult', code: 'sent' } as SimEvent]);
    expect(logs2.some((l) => l.includes('mail sent to Bankalt'))).toBe(true);
    expect(state.alerts.some((a) => a.kind === 'mail')).toBe(true);

    // mats gone from the bags: mail is done, room frees, back to the route
    world.inventory = [
      { itemId: 'grey_a', count: 1 },
      { itemId: 'rod', count: 1 },
      { itemId: 'pick', count: 1 },
      { itemId: 'bread', count: 1 },
    ];
    step(state, world, 200);
    expect(state.mode).toBe('TRAVEL');
  });

  it('walks to a mailbox that is out of range before sending', () => {
    const { state, world } = makeBrain({ bags: { mailTo: 'Bankalt' } });
    world.inventory = [
      { itemId: 'copper_ore', count: 5 },
      { itemId: 'grey_a', count: 1 },
      { itemId: 'grey_b', count: 1 },
      { itemId: 'bread', count: 1 },
    ];
    world.entities.set(60, mailboxAt(30));
    step(state, world, 0);
    expect(world.mails).toEqual([]);
    expect(world.moveInput.forward).toBe(true);
    // (0,0) is inside the eastbrook wall, the mailbox is outside: the walk
    // routes through the east gate crossing, not the fence line
    const gate = { x: 27.443, z: 7.31 }; // real exported crossing (scaled to the radius)
    expect(world.facing).toBeCloseTo(Math.atan2(gate.x, gate.z), 2);
    world.player.pos = { x: gate.x, y: 0, z: gate.z };
    step(state, world, 100);
    // at the crossing: the hop completes and the box becomes the next target
    expect(state.walkWaypoints).toEqual([{ x: 30, z: 0 }]);
    world.player.pos = { x: 28.5, y: 0, z: 0.5 }; // 1.6 yd from the box
    step(state, world, 200);
    expect(world.mails.length).toBe(1);
  });

  it('restricts the mail payload to bags.mailItems when a list is set', () => {
    const { state, world } = makeBrain({ bags: { mailTo: 'Bankalt', mailItems: ['peacebloom'] } });
    world.inventory = [
      { itemId: 'copper_ore', count: 3 },
      { itemId: 'peacebloom', count: 2 },
      { itemId: 'grey_a', count: 1 },
      { itemId: 'rod', count: 1 },
    ];
    world.entities.set(60, mailboxAt(3));
    step(state, world, 0);
    expect(world.mails[0].items).toEqual([{ itemId: 'peacebloom', count: 2 }]);
  });

  it('falls back to the vendor on a mail failure', () => {
    const { state, world } = makeBrain({ bags: { mailTo: 'Bankalt' } });
    world.inventory = [
      { itemId: 'copper_ore', count: 5 },
      { itemId: 'grey_a', count: 1 },
      { itemId: 'grey_b', count: 1 },
      { itemId: 'bread', count: 1 },
    ];
    world.entities.set(60, mailboxAt(3));
    world.entities.set(50, vendorAt(4));
    step(state, world, 0);
    expect(world.mails.length).toBe(1);
    const logs = step(state, world, 100, [{ type: 'mailResult', code: 'noRecipient' } as SimEvent]);
    expect(logs.some((l) => l.includes('mail failed'))).toBe(true);
    expect(world.interacts).toBe(1); // vendor engaged in the same tick
    expect(world.targets).toEqual([50]);
  });

  it('goes straight to the vendor when no mailbox is visible', () => {
    const { state, world } = makeBrain({ bags: { mailTo: 'Bankalt' } });
    world.inventory = [
      { itemId: 'copper_ore', count: 5 },
      { itemId: 'grey_a', count: 1 },
      { itemId: 'grey_b', count: 1 },
      { itemId: 'bread', count: 1 },
    ];
    world.entities.set(50, vendorAt(4));
    const logs = step(state, world, 0);
    expect(logs.some((l) => l.includes('no mailbox nearby'))).toBe(true);
    expect(world.mails).toEqual([]);
    expect(world.interacts).toBe(1);
  });
});

describe('farmbot brain: zone rotation (phase 7)', () => {
  const EB_NODE: GatherNodeDef = {
    id: 'eb_node',
    zoneId: 'eastbrook_vale',
    type: 'herb',
    pos: { x: 10, z: 0 },
    level: 4,
    tier: 1,
  };
  const MF_NODE: GatherNodeDef = {
    id: 'mf_node',
    zoneId: 'mirefen_marsh',
    type: 'ore',
    pos: { x: 0, z: 200 },
    level: 10,
    tier: 1,
  };
  const ROT_NODES = [EB_NODE, MF_NODE];
  // the fake world puts eastbrook below z=180 and mirefen above it
  const zoneIdAt = (_x: number, z: number) => (z > 180 ? 'mirefen_marsh' : 'eastbrook_vale');

  function rotationBrain(over: Record<string, unknown> = {}) {
    const { state, world } = makeBrain(
      { zones: ['eastbrook_vale', 'mirefen_marsh'], zoneId: 'eastbrook_vale', ...over },
      { nodes: ROT_NODES, zoneIdAt },
    );
    return { state, world };
  }

  it('advances to the next zone when the current one is dry and walks the pass', () => {
    const { state, world } = rotationBrain();
    world.nodeReady.set('eb_node', false); // eastbrook dry
    let logs = step(state, world, 0);
    expect(logs.some((l) => l.includes('zone rotation: heading to mirefen_marsh'))).toBe(true);
    expect(state.zonePath).toEqual([{ zoneId: 'mirefen_marsh', waypoint: { x: 0, z: 180 } }]);

    logs = step(state, world, 100);
    expect(world.moveInput.forward).toBe(true);
    expect(world.facing).toBeCloseTo(0); // the pass is due +z

    // cross the border: zoneIdAt flips, the leg completes
    world.player.pos = { x: 0, y: 0, z: 185 };
    logs = step(state, world, 200);
    expect(logs.some((l) => l.includes('entered mirefen_marsh'))).toBe(true);
    expect(state.zonePath).toBeNull();

    // normal farming resumes, now against mirefen nodes
    step(state, world, 300);
    expect(state.travelNodeId).toBe('mf_node');
  });

  it('does not rotate while fishing still has a lap to run', () => {
    const { state, world } = rotationBrain({
      fishing: {
        enabled: true,
        spots: [
          { x: 50, z: 0 },
          { x: 50, z: 50 },
        ],
        castsPerSpot: 1,
      },
    });
    world.nodeReady.set('eb_node', false);
    world.inventory = [{ itemId: 'rod', count: 1 }];
    step(state, world, 0);
    expect(state.zonePath).toBeNull(); // fishes first, no rotation yet
    expect(world.moveInput.forward).toBe(true); // walking to spot 0

    // finish the lap (both spots, one cast each)
    world.player.pos = { x: 50, y: 0, z: 0 };
    step(state, world, 100);
    step(state, world, 200);
    step(state, world, 550);
    world.player.castingAbility = 'fishing';
    step(state, world, 600);
    step(state, world, 700, [
      { type: 'fishingEmptyHook', pid: 1, zoneId: 'eastbrook_vale', band: 0 } as SimEvent,
    ]);
    expect(state.fishSpotIndex).toBe(1);
    expect(state.zonePath).toBeNull();
    world.player.pos = { x: 50, y: 0, z: 50 };
    step(state, world, 800);
    step(state, world, 900);
    step(state, world, 1250);
    world.player.castingAbility = 'fishing';
    step(state, world, 1300);
    step(state, world, 1400, [
      { type: 'fishingEmptyHook', pid: 1, zoneId: 'eastbrook_vale', band: 0 } as SimEvent,
    ]);
    expect(state.fishLapDone).toBe(true);

    const logs = step(state, world, 1500);
    expect(logs.some((l) => l.includes('zone rotation: heading to mirefen_marsh'))).toBe(true);
    expect(state.fishLapDone).toBe(false); // reset for the new zone
  });

  it('skips the leg instead of wedging when stuck en route', () => {
    const { state, world } = makeBrain(
      { zones: ['eastbrook_vale', 'mirefen_marsh', 'thornpeak_heights'], zoneId: 'eastbrook_vale' },
      { nodes: ROT_NODES, zoneIdAt },
    );
    world.nodeReady.set('eb_node', false);
    step(state, world, 0); // arms eastbrook -> mirefen (stuck not fed yet)
    expect(state.zonePath?.[0]?.zoneId).toBe('mirefen_marsh');
    step(state, world, 100); // first walk tick: anchors the stuck detector
    // Never move: quiet window (4s) + 5 held recoveries (1.8s) => blacklist.
    let logs = step(state, world, 13_100);
    expect(logs.some((l) => l.includes('stuck en route to mirefen_marsh, skipping'))).toBe(true);
    // re-armed toward thornpeak (path via the mirefen border then the thornpeak pass)
    expect(state.zonePath?.[state.zonePath.length - 1]?.zoneId).toBe('thornpeak_heights');
    logs = step(state, world, 13_200);
    expect(world.moveInput.forward).toBe(true);
  });

  it('empty zones list keeps the legacy single-zone behavior', () => {
    const { state, world } = makeBrain();
    world.nodeReady.set('node_a', false);
    world.nodeReady.set('node_b', false);
    step(state, world, 0);
    step(state, world, 1000);
    expect(state.zonePath).toBeNull();
    expect(state.mode).toBe('TRAVEL'); // just idles, no rotation
  });
});

describe('farmbot brain: gold mode (phase 10)', () => {
  const CRYPT_ORIGIN = { x: 100300, z: -1250 }; // instanceOrigin(0, 0)
  const insidePos = (lx: number, lz: number) => ({
    x: CRYPT_ORIGIN.x + lx,
    y: 0,
    z: CRYPT_ORIGIN.z + lz,
  });

  function goldBrain(over: Record<string, unknown> = {}) {
    return makeBrain({ mode: 'gold', ...over });
  }

  function goldMob(id: number, name: string, x: number, z: number, over: Partial<Entity> = {}) {
    return makeEntity({ id, name, kind: 'mob', pos: { x, y: 0, z }, ...over });
  }

  function healAbility(id: string): ResolvedAbility {
    return {
      def: {
        id,
        name: id,
        class: 'paladin',
        cost: 117,
        castTime: 2.5,
        cooldown: 0,
        range: 0,
        school: 'holy',
        requiresTarget: false,
      },
      rank: 1,
      cost: 117,
      castTime: 2.5,
      cooldown: 0,
      effects: [{ type: 'heal', min: 100, max: 120 }],
      threatFlat: 0,
      threatMult: 1,
    } as unknown as ResolvedAbility;
  }

  function knownAbility(id: string, cost = 10): ResolvedAbility {
    return {
      def: {
        id,
        name: id,
        class: 'paladin',
        cost,
        castTime: 0,
        cooldown: 0,
        range: 0,
        school: 'holy',
        requiresTarget: true,
      },
      rank: 1,
      cost,
      castTime: 0,
      cooldown: 0,
      effects: [{ type: 'weaponStrike', bonus: 0 }],
      threatFlat: 0,
      threatMult: 1,
    } as unknown as ResolvedAbility;
  }

  it('walks to the door, enters, and waits out the zone-in', () => {
    const { state, world } = goldBrain();
    world.player.pos = { x: 0, y: 0, z: 0 };
    let logs = step(state, world, 0);
    expect(state.goldPhase).toBe('door');
    expect(world.moveInput.forward).toBe(true);
    // (0,0) is inside the eastbrook wall and the crypt door is outside: the
    // first hop is the northeast gate crossing, not the straight fence line
    const gate = { x: 19.589, z: 20.563 }; // real exported crossing
    expect(world.facing).toBeCloseTo(Math.atan2(gate.x, gate.z), 2);

    world.player.pos = { x: gate.x, y: 0, z: gate.z };
    step(state, world, 100);
    // at the crossing: the hop completes and the door becomes the next target
    expect(state.walkWaypoints).toEqual([{ x: 80, z: 90 }]);

    world.player.pos = { x: 77, y: 0, z: 88 }; // 3.6 yd from the door
    logs = step(state, world, 200);
    expect(world.dungeonEnters).toEqual(['hollow_crypt']);
    expect(state.goldPhase).toBe('enter');
    expect(logs.some((l) => l.includes('gold: entering The Hollow Crypt'))).toBe(true);

    // not yet inside: holds the phase, then the teleport lands
    step(state, world, 200);
    expect(state.goldPhase).toBe('enter');
    world.player.pos = insidePos(0, -2);
    logs = step(state, world, 300);
    expect(state.goldPhase).toBe('clear');
    expect(logs.some((l) => l.includes('gold: inside, sweeping the nave'))).toBe(true);
  });

  it('re-approaches when the entry never lands', () => {
    const { state, world } = goldBrain();
    world.player.pos = { x: 77, y: 0, z: 88 };
    step(state, world, 0);
    expect(state.goldPhase).toBe('enter');
    step(state, world, 6000); // no teleport: entry timed out
    expect(state.goldPhase).toBe('door');
  });

  it('pulls with exorcism at 30 yd, walks closer when out of reach', () => {
    const { state, world } = goldBrain();
    world.player.pos = insidePos(0, 18);
    state.goldPhase = 'clear';
    const shambler = goldMob(90, 'crypt_shambler', CRYPT_ORIGIN.x + 2, CRYPT_ORIGIN.z + 55);
    world.entities.set(90, shambler);
    step(state, world, 0); // 37 yd out: walk closer, no cast
    expect(world.moveInput.forward).toBe(true);
    expect(world.abilityCasts).toEqual([]);

    step(state, world, 100); // still 37 yd (no movement): keep walking
    shambler.pos = { x: CRYPT_ORIGIN.x + 2, y: 0, z: CRYPT_ORIGIN.z + 40 }; // 22 yd now
    const logs = step(state, world, 700); // first pull waits out the cadence
    expect(world.moveInput.forward).toBe(false);
    expect(world.targets).toEqual([90]);
    expect(world.abilityCasts).toEqual(['exorcism']);
    expect(logs.some((l) => l.includes('gold: pulling crypt_shambler'))).toBe(true);
    expect(world.autoAttackStarts).toBe(0); // pulled by spell, not by melee

    // the pull lands: combat pre-empts, one mob at a time, and the retarget
    // branch starts the auto-attack (the pull must not suppress it)
    shambler.aggroTargetId = 1;
    world.player.inCombat = true;
    world.entities.set(91, goldMob(91, 'hollow_acolyte', CRYPT_ORIGIN.x + 4, CRYPT_ORIGIN.z + 42));
    step(state, world, 800);
    expect(state.mode).toBe('COMBAT');
    expect(world.abilityCasts).toEqual(['exorcism']); // no second pull mid-fight
    expect(world.autoAttackStarts).toBe(1);

    // kill: gold mode skips the auto-loot pass entirely
    shambler.dead = true;
    world.player.inCombat = false;
    step(state, world, 1400);
    expect(state.mode).toBe('TRAVEL');

    // the pull ability's own cooldown suppresses recast spam on the next pull
    expect(world.abilityCasts).toEqual(['exorcism', 'exorcism']); // pull on 91 landed at fight end
    world.player.cooldowns = new Map([['exorcism', 10]]);
    step(state, world, 1500);
    expect(world.abilityCasts).toEqual(['exorcism', 'exorcism']); // no recast while on cd
    world.player.cooldowns.clear();
    step(state, world, 2200);
    expect(world.abilityCasts).toEqual(['exorcism', 'exorcism', 'exorcism']);
  });

  it('gold combat uses crusader strike + holy ground, not the full auto rotation', () => {
    const { state, world } = goldBrain({ combat: { rotationMode: 'auto' } });
    world.player.pos = insidePos(0, 30);
    world.player.resource = 200;
    world.player.maxResource = 200;
    world.player.resourceType = 'mana';
    world.player.gcdRemaining = 0;
    world.player.cooldowns = new Map();
    world.player.auras = [
      {
        id: 'blessing_of_might',
        name: 'Oath of Iron',
        kind: 'buff_ap_pct',
        remaining: 100,
        duration: 1800,
        value: 10,
        sourceId: 1,
        school: 'holy',
      },
      {
        id: 'retribution_aura',
        name: 'Requital Aura',
        kind: 'thorns',
        remaining: 100,
        duration: 1800,
        value: 5,
        sourceId: 1,
        school: 'holy',
      },
    ] as Entity['auras'];
    world.known = [
      knownAbility('exorcism', 55),
      knownAbility('crusader_strike', 30),
      knownAbility('consecration', 60),
      knownAbility('judgement', 30),
    ];
    // mark consecration as no-target ground AoE so the gold picker accepts it
    const cons = world.known[2];
    (cons.def as { requiresTarget: boolean }).requiresTarget = false;
    cons.effects = [{ type: 'groundAoE', min: 1, max: 2, radius: 8, duration: 10, interval: 2 }];

    state.goldPhase = 'clear';
    const shambler = goldMob(90, 'crypt_shambler', CRYPT_ORIGIN.x + 1, CRYPT_ORIGIN.z + 32);
    shambler.aggroTargetId = 1;
    world.entities.set(90, shambler);
    world.player.inCombat = true;
    step(state, world, 0);
    expect(state.mode).toBe('COMBAT');
    expect(world.abilityCasts).toEqual(['crusader_strike']);
    expect(world.casts).toEqual([]); // never uses slot-based auto rotation

    // second attacker: Holy Ground
    world.player.gcdRemaining = 0;
    world.entities.set(
      91,
      goldMob(91, 'hollow_acolyte', CRYPT_ORIGIN.x + 2, CRYPT_ORIGIN.z + 33, {
        aggroTargetId: 1,
      }),
    );
    step(state, world, 600);
    expect(world.abilityCasts).toEqual(['crusader_strike', 'consecration']);
    // judgement / exorcism never enter the gold combat kit
    expect(world.abilityCasts.includes('exorcism')).toBe(false);
    expect(world.abilityCasts.includes('judgement')).toBe(false);
  });

  it('gold mode refreshes oath of iron and aura between pulls', () => {
    const { state, world } = goldBrain();
    world.player.pos = insidePos(0, 30);
    world.player.resource = 200;
    world.player.maxResource = 200;
    world.player.resourceType = 'mana';
    world.player.gcdRemaining = 0;
    world.player.auras = [];
    world.known = [knownAbility('blessing_of_might', 25), knownAbility('retribution_aura', 0)];
    const aura = world.known[1];
    (aura.def as { requiresTarget: boolean }).requiresTarget = false;
    state.goldPhase = 'clear';
    // no hostiles: maintain buffs before sweeping
    step(state, world, 0);
    expect(world.onCasts).toEqual([{ id: 'blessing_of_might', targetId: 1 }]);
    world.player.auras = [
      {
        id: 'blessing_of_might',
        name: 'Oath of Iron',
        kind: 'buff_ap_pct',
        remaining: 100,
        duration: 1800,
        value: 10,
        sourceId: 1,
        school: 'holy',
      },
    ] as Entity['auras'];
    step(state, world, 600);
    expect(world.abilityCasts).toEqual(['retribution_aura']);
  });

  it('stops pulling and recharges below the threshold, with paladin self-heal', () => {
    const { state, world } = goldBrain();
    world.player.pos = insidePos(0, 18);
    world.player.maxResource = 200;
    world.player.resource = 180;
    world.player.maxHp = 100;
    world.player.hp = 45; // below 50%
    world.known = [healAbility('holy_light')];
    state.goldPhase = 'clear';
    world.entities.set(90, goldMob(90, 'crypt_shambler', CRYPT_ORIGIN.x + 2, CRYPT_ORIGIN.z + 30));
    let logs = step(state, world, 0);
    expect(state.mode).toBe('REST');
    expect(logs.some((l) => l.includes('self-heal') || l.includes('gold: recharging'))).toBe(true);
    // the watch transitions and the same tick's dispatch casts immediately
    expect(world.onCasts).toEqual([{ id: 'holy_light', targetId: 1 }]);
    expect(logs.some((l) => l.includes('resting: casting holy_light'))).toBe(true);

    // mana too short for another heal: just waits
    world.player.resource = 50;
    step(state, world, 1200);
    expect(world.onCasts.length).toBe(1);
    expect(world.itemsUsed).toEqual([]);

    // topped up: back to the clear
    world.player.hp = 100;
    world.player.resource = 190;
    logs = step(state, world, 1300);
    expect(state.mode).toBe('TRAVEL');
    logs = step(state, world, 1400);
    expect(world.abilityCasts).toEqual(['exorcism']); // pulling resumes
  });

  it('recharges on low mana as well as low hp', () => {
    const { state, world } = goldBrain();
    world.player.pos = insidePos(0, 18);
    world.player.maxResource = 200;
    world.player.resource = 90; // 45%
    state.goldPhase = 'clear';
    world.entities.set(90, goldMob(90, 'crypt_shambler', CRYPT_ORIGIN.x + 2, CRYPT_ORIGIN.z + 30));
    step(state, world, 0);
    expect(state.mode).toBe('REST');
  });

  it('tracks session copper earned from purse increases in any mode', () => {
    const { state, world } = makeBrain();
    world.copper = 500;
    step(state, world, 0); // baselines lastCopper
    expect(state.stats.copperGained).toBe(0);
    world.copper = 750;
    step(state, world, 100);
    expect(state.stats.copperGained).toBe(250);
    world.copper = 700; // spend: re-baseline, do not erase earned
    step(state, world, 200);
    expect(state.stats.copperGained).toBe(250);
    world.copper = 800;
    step(state, world, 300);
    expect(state.stats.copperGained).toBe(350);
  });

  it('loots copper and blues, skips junk corpses, and discards the rest', () => {
    const { state, world } = goldBrain({ combat: { eatItemId: 'bread' } });
    world.player.pos = insidePos(0, 30);
    world.copper = 1000;
    world.bagCapacity = 20;
    state.goldPhase = 'clear';
    const rich = goldMob(90, 'crypt_shambler', CRYPT_ORIGIN.x + 1, CRYPT_ORIGIN.z + 31, {
      dead: true,
      lootable: true,
      loot: { copper: 90, items: [] },
    });
    const blue = goldMob(91, 'morthen', CRYPT_ORIGIN.x + 1, CRYPT_ORIGIN.z + 32, {
      dead: true,
      lootable: true,
      loot: { copper: 0, items: [{ itemId: 'blue_bag', count: 1 }] },
    });
    const junk = goldMob(92, 'hollow_acolyte', CRYPT_ORIGIN.x + 1, CRYPT_ORIGIN.z + 33, {
      dead: true,
      lootable: true,
      loot: { copper: 0, items: [{ itemId: 'grey_a', count: 1 }] },
    });
    world.entities.set(90, rich);
    world.entities.set(91, blue);
    world.entities.set(92, junk);
    world.inventory = [
      { itemId: 'grey_a', count: 3 },
      { itemId: 'blue_bag', count: 1 },
      { itemId: 'rod', count: 1 },
      { itemId: 'pick', count: 1 },
      { itemId: 'bread', count: 1 },
    ];
    const logs = step(state, world, 0);
    expect(world.lootCorpses).toEqual([90, 91]); // rich and blue, never the junk corpse
    expect(logs.some((l) => l.includes('gold: looted 90c from crypt_shambler'))).toBe(true);
    expect(logs.some((l) => l.includes('Gravewoven Bag'))).toBe(true);
    expect(logs.some((l) => l.includes('hollow_acolyte'))).toBe(false); // junk corpse skipped
    expect(state.stats.raresKept).toBe(1);
    // discard sweep: only the grey goes; tools, food, and the blue stay
    expect(world.discards).toEqual([{ itemId: 'grey_a', count: 3 }]);

    world.copper = 1090;
    step(state, world, 100);
    expect(state.stats.copperGained).toBe(90);
  });

  it('clears the nave, exits, rotates, and waits out the reset clock', () => {
    const { state, world } = goldBrain();
    world.player.pos = insidePos(0, 96);
    state.goldPhase = 'clear';
    state.goldAdvanceZ = 100;
    state.goldEntryKills = 0;
    state.stats.kills = 3; // this visit killed things
    step(state, world, 0); // anchors the quiet timer
    expect(state.goldPhase).toBe('clear');
    let logs = step(state, world, 7000);
    expect(state.goldPhase).toBe('exit');
    expect(logs.some((l) => l.includes('gold: The Hollow Crypt cleared'))).toBe(true);

    // walk to the exit and leave
    world.player.pos = insidePos(0, -7);
    step(state, world, 7100);
    expect(world.dungeonLeaves).toBe(1);
    world.player.pos = { x: 80, y: 0, z: 90 }; // back outside at the door
    logs = step(state, world, 7200);
    expect(state.goldIndex).toBe(1);
    expect(state.goldPhase).toBe('door');
    expect(logs.some((l) => l.includes('gold: rotating to The Sunken Bastion'))).toBe(true);
    expect(state.goldResetAtMs.hollow_crypt).toBe(7200 + 305_000);

    // rotation back to the crypt: the reset clock says wait
    state.goldIndex = 0;
    logs = step(state, world, 7300);
    expect(world.moveInput.forward).toBe(false);
    expect(logs.some((l) => l.includes('gold: waiting for The Hollow Crypt to reset'))).toBe(true);
    expect(world.dungeonEnters).toEqual([]);
  });

  it('quick-exits an unreset claim without touching the reset clock', () => {
    const { state, world } = goldBrain();
    // this visit simulates entering an early-rejoined claim and finding nothing
    world.player.pos = insidePos(0, -2);
    state.goldPhase = 'enter';
    step(state, world, 0);
    expect(state.goldPhase).toBe('clear');
    // sweep to the end with no mobs anywhere
    for (let t = 100; t <= 800; t += 100) step(state, world, t);
    expect(state.goldAdvanceZ).toBe(100);
    step(state, world, 900);
    step(state, world, 7000);
    expect(state.goldPhase).toBe('exit');
    world.player.pos = insidePos(0, -7);
    step(state, world, 7100);
    expect(world.dungeonLeaves).toBe(1);
    world.player.pos = { x: 80, y: 0, z: 90 };
    step(state, world, 7200);
    expect(state.goldResetAtMs.hollow_crypt).toBeUndefined(); // no kills, no clock
    expect(state.goldIndex).toBe(1);
  });

  it('death inside walks the ghost back to the door and re-enters', () => {
    const { state, world } = goldBrain();
    world.player.pos = insidePos(0, 50);
    step(state, world, 0);
    world.player.dead = true;
    world.player.corpsePos = insidePos(0, 50);
    step(state, world, 100, [{ type: 'playerDeath', pid: 1 } as SimEvent]);
    world.player.dead = false;
    world.player.ghost = true;
    world.player.pos = { x: 0, y: 0, z: 0 }; // spirit world, eastbrook
    step(state, world, 200);
    expect(world.moveInput.forward).toBe(true);
    expect(world.facing).toBeCloseTo(Math.atan2(80, 90)); // to the crypt door
    world.player.pos = { x: 78, y: 0, z: 89 };
    step(state, world, 300);
    expect(world.dungeonEnters).toEqual(['hollow_crypt']);
  });
});

describe('farmbot brain: village gate routing (bugfix)', () => {
  function vendorAt(x: number, z = 0) {
    return makeEntity({
      id: 50,
      kind: 'npc',
      name: 'vendor_bob',
      hostile: false,
      vendorItems: ['bread'],
      pos: { x, y: 0, z },
    });
  }

  it('routes the vendor walk through the wall gate when the vendor is inside', () => {
    const { state, world } = makeBrain();
    world.inventory = [
      { itemId: 'grey_a', count: 1 },
      { itemId: 'grey_b', count: 1 },
      { itemId: 'bread', count: 1 },
      { itemId: 'rod', count: 1 },
    ];
    world.player.pos = { x: 40, y: 0, z: 0 }; // outside the eastbrook wall
    world.entities.set(50, vendorAt(5)); // vendor inside the wall
    step(state, world, 0);
    expect(state.mode).toBe('BAGS_FULL');
    expect(world.moveInput.forward).toBe(true);
    // the walk targets the east gate crossing first, not the fence line
    expect(state.walkWaypoints.length).toBe(2);
    expect(state.walkWaypoints[0].x).toBeCloseTo(27.443, 2);
    expect(state.walkWaypoints[0].z).toBeCloseTo(7.31, 2);
    expect(world.facing).toBeCloseTo(Math.atan2(27.443 - 40, 7.31), 2);

    world.player.pos = { x: 27.443, y: 0, z: 7.31 }; // at the gate
    step(state, world, 100);
    expect(state.walkWaypoints).toEqual([{ x: 5, z: 0 }]); // vendor is next

    world.player.pos = { x: 6, y: 0, z: 1 }; // beside the vendor now
    step(state, world, 200);
    expect(world.interacts).toBe(1);
    expect(world.targets).toEqual([50]);
  });

  it('tries the next-best gate on a stuck walk, then gives up to the timeout', () => {
    const { state, world } = makeBrain();
    world.inventory = [
      { itemId: 'grey_a', count: 1 },
      { itemId: 'grey_b', count: 1 },
      { itemId: 'bread', count: 1 },
      { itemId: 'rod', count: 1 },
    ];
    world.player.pos = { x: 40, y: 0, z: 0 };
    world.entities.set(50, vendorAt(5));
    step(state, world, 0); // anchors the walk and the stuck detector
    expect(state.mode).toBe('BAGS_FULL');

    // Never moves. Default stuck kit: 4s quiet + 5 held recoveries (1.8s each)
    // then blacklist (blacklistAfter=6). Catch-up advances on a large time jump.
    let logs = step(state, world, 13_000);
    expect(logs.some((l) => l.includes('stuck reaching vendor, trying another gate'))).toBe(true);
    expect(state.walkWaypoints).toEqual([]); // replans next tick
    logs = step(state, world, 13_100);
    expect(state.walkWaypoints.length).toBe(2); // a different gate leads now
    expect(state.walkWaypoints[0].x).not.toBeCloseTo(27.443, 2);

    // Still stuck on the alternate gate: another full recovery cycle gives up.
    // Fresh anchor at 13100 + 4s + 5*1.8s => blacklist around 26100.
    logs = step(state, world, 26_100);
    expect(logs.some((l) => l.includes('stuck reaching vendor, giving up'))).toBe(true);
    logs = step(state, world, 26_200);
    expect(world.moveInput.forward).toBe(false); // gave up: no more grinding
    logs = step(state, world, 31_000);
    expect(logs.some((l) => l.includes('bags full: vendor unreachable'))).toBe(true);
    expect(state.done).toBe(true);
    expect(world.logouts).toBe(1);
  });
});

describe('farmbot brain: rest consumable auto-pick', () => {
  function restBrain(over: Record<string, unknown> = {}) {
    const { state, world } = makeBrain(over);
    world.player.maxHp = 100;
    world.player.maxResource = 200;
    state.mode = 'REST';
    state.restStartedAtMs = 0;
    return { state, world };
  }

  it('drinks the highest-drinkMana water in bags when unconfigured', () => {
    const { state, world } = restBrain();
    world.player.resource = 60; // 30%
    world.inventory = [
      { itemId: 'spring_water', count: 1 },
      { itemId: 'conjured_water4', count: 1 },
    ];
    const logs = step(state, world, 100);
    expect(world.itemsUsed).toEqual(['conjured_water4']);
    expect(logs.some((l) => l.includes('resting: drinking conjured_water4'))).toBe(true);
  });

  it('waits out the drink channel until mana is full before heals or re-actions', () => {
    const { state, world } = restBrain();
    world.player.hp = 40; // would otherwise self-heal
    world.player.resource = 40; // 20%
    world.player.resourceType = 'mana';
    world.player.gcdRemaining = 0;
    world.known = [
      {
        def: {
          id: 'holy_light',
          name: 'holy_light',
          class: 'paladin',
          cost: 117,
          castTime: 2.5,
          cooldown: 0,
          range: 0,
          school: 'holy',
          requiresTarget: false,
        },
        rank: 1,
        cost: 117,
        castTime: 2.5,
        cooldown: 0,
        effects: [{ type: 'heal', min: 100, max: 120 }],
        threatFlat: 0,
        threatMult: 1,
      } as unknown as ResolvedAbility,
      {
        def: {
          id: 'flash_of_light',
          name: 'flash_of_light',
          class: 'paladin',
          cost: 46,
          castTime: 1.5,
          cooldown: 0,
          range: 0,
          school: 'holy',
          requiresTarget: false,
        },
        rank: 1,
        cost: 46,
        castTime: 1.5,
        cooldown: 0,
        effects: [{ type: 'heal', min: 60, max: 80 }],
        threatFlat: 0,
        threatMult: 1,
      } as unknown as ResolvedAbility,
    ];
    world.inventory = [{ itemId: 'conjured_water4', count: 5 }];

    // First action: drink, never heal while mana is short.
    let logs = step(state, world, 100);
    expect(world.itemsUsed).toEqual(['conjured_water4']);
    expect(world.onCasts).toEqual([]);
    expect(logs.some((l) => l.includes('resting: drinking conjured_water4'))).toBe(true);

    // Channel live: no re-drink, no heal, no food, even after the throttle.
    world.player.drinking = {} as Entity['drinking'];
    step(state, world, 2000);
    step(state, world, 5000);
    expect(world.itemsUsed).toEqual(['conjured_water4']);
    expect(world.onCasts).toEqual([]);

    // Channel ends but mana still short: drink again, still no heal.
    world.player.drinking = null;
    world.player.resource = 80; // still below 95%
    logs = step(state, world, 6500);
    expect(world.itemsUsed).toEqual(['conjured_water4', 'conjured_water4']);
    expect(world.onCasts).toEqual([]);
    expect(logs.some((l) => l.includes('resting: drinking'))).toBe(true);

    // Mana full, HP still short: now the self-heal is allowed (past the
    // drink throttle and the holy_light cast-window gate).
    world.player.drinking = null;
    world.player.resource = 200;
    logs = step(state, world, 10_000);
    expect(world.onCasts).toEqual([{ id: 'holy_light', targetId: 1 }]);
    expect(logs.some((l) => l.includes('resting: casting holy_light'))).toBe(true);
  });

  it('lets the configured drinkItemId win when it is in the bags', () => {
    const { state, world } = restBrain({ combat: { drinkItemId: 'spring_water' } });
    world.player.resource = 60;
    world.inventory = [
      { itemId: 'spring_water', count: 1 },
      { itemId: 'conjured_water4', count: 1 },
    ];
    step(state, world, 100);
    expect(world.itemsUsed).toEqual(['spring_water']);
  });

  it('waits plainly when no drink is in the bags (and configured id absent)', () => {
    const { state, world } = restBrain({ combat: { drinkItemId: 'spring_water' } });
    world.player.resource = 60;
    world.inventory = [{ itemId: 'copper_ore', count: 5 }]; // no drinks at all
    step(state, world, 100);
    expect(state.mode).toBe('REST');
    expect(world.itemsUsed).toEqual([]);
  });

  it('eats the highest foodHp food in bags when unconfigured', () => {
    const { state, world } = restBrain();
    world.player.hp = 30;
    world.inventory = [
      { itemId: 'conjured_bread', count: 1 },
      { itemId: 'conjured_bread2', count: 1 },
    ];
    const logs = step(state, world, 100);
    expect(world.itemsUsed).toEqual(['conjured_bread2']);
    expect(logs.some((l) => l.includes('resting: eating conjured_bread2'))).toBe(true);
  });

  it('discard sweep keeps drinks, food, and potions while dropping junk', () => {
    const { state, world } = makeBrain({ mode: 'gold' });
    world.bagCapacity = 20;
    world.player.pos = { x: 100300, y: 0, z: -1220 };
    state.goldPhase = 'clear';
    world.entities.set(
      90,
      makeEntity({
        id: 90,
        name: 'crypt_shambler',
        kind: 'mob',
        dead: true,
        lootable: true,
        loot: { copper: 50, items: [] },
        pos: { x: 100301, y: 0, z: -1219 },
      }),
    );
    world.inventory = [
      { itemId: 'conjured_water4', count: 1 },
      { itemId: 'conjured_bread2', count: 1 },
      { itemId: 'health_potion', count: 1 },
      { itemId: 'grey_a', count: 2 },
      { itemId: 'blue_bag', count: 1 },
      { itemId: 'rod', count: 1 },
      { itemId: 'pick', count: 1 },
    ];
    step(state, world, 0);
    expect(world.lootCorpses).toEqual([90]);
    expect(world.discards).toEqual([{ itemId: 'grey_a', count: 2 }]); // only the junk goes
  });
});

describe('farmbot brain: general self-heal (out of combat)', () => {
  function paladinAbility(id: string, cost: number): ResolvedAbility {
    return {
      def: {
        id,
        name: id,
        class: 'paladin',
        cost,
        castTime: id === 'holy_light' ? 2.5 : 1.5,
        cooldown: 0,
        range: 0,
        school: 'holy',
        requiresTarget: false,
      },
      rank: 1,
      cost,
      castTime: 0,
      cooldown: 0,
      effects: [{ type: 'heal', min: 100, max: 120 }],
      threatFlat: 0,
      threatMult: 1,
    } as unknown as ResolvedAbility;
  }

  function hurtPaladin(over: Record<string, unknown> = {}) {
    const { state, world } = makeBrain(over);
    world.player.maxHp = 100;
    world.player.hp = 40; // below 50%
    world.player.maxResource = 200;
    world.player.resource = 200;
    world.player.resourceType = 'mana';
    world.known = [paladinAbility('holy_light', 117)];
    return { state, world };
  }

  it('stands and casts holy_light on self below 50% out of combat', () => {
    const { state, world } = hurtPaladin();
    const logs = step(state, world, 0);
    expect(state.mode).toBe('REST');
    expect(logs.some((l) => l.includes('self-heal'))).toBe(true);
    expect(world.moveInput.forward).toBe(false);
    expect(world.onCasts).toEqual([{ id: 'holy_light', targetId: 1 }]);
    expect(logs.some((l) => l.includes('resting: casting holy_light'))).toBe(true);
  });

  it('paces casts to the cast window and stops at 90%', () => {
    const { state, world } = hurtPaladin();
    step(state, world, 0);
    expect(world.onCasts.length).toBe(1);
    step(state, world, 1000);
    expect(world.onCasts.length).toBe(1); // mid-cast: no recast
    world.player.hp = 60;
    step(state, world, 2900);
    expect(world.onCasts.length).toBe(2); // window elapsed: heal again
    world.player.hp = 91;
    step(state, world, 5800);
    expect(world.onCasts.length).toBe(2); // at 90%+: no more heals, plain wait
    world.player.hp = 96;
    const logs = step(state, world, 5900);
    expect(state.mode).toBe('TRAVEL');
    expect(logs.some((l) => l.includes('rested'))).toBe(true);
  });

  it('falls back to flash_of_light when mana covers only that, then to plain wait', () => {
    const { state, world } = hurtPaladin();
    world.known = [paladinAbility('holy_light', 117), paladinAbility('flash_of_light', 46)];
    world.player.resource = 60; // >= 46, < 117
    const logs = step(state, world, 0);
    expect(world.onCasts).toEqual([{ id: 'flash_of_light', targetId: 1 }]);
    expect(logs.some((l) => l.includes('resting: casting flash_of_light'))).toBe(true);
    world.player.resource = 30; // < 46: nothing affordable
    step(state, world, 2000);
    expect(world.onCasts.length).toBe(1);
    expect(state.mode).toBe('REST'); // plain wait continues
  });

  it('respects cooldown and GCD on the heal', () => {
    const { state, world } = hurtPaladin();
    world.player.cooldowns = new Map([['holy_light', 5]]);
    step(state, world, 0);
    expect(state.mode).toBe('TRAVEL'); // nothing castable: no heal-hold
    expect(world.onCasts).toEqual([]);
    world.player.cooldowns.clear();
    world.player.gcdRemaining = 1.2;
    step(state, world, 100);
    expect(world.onCasts).toEqual([]);
  });

  it('leaves non-paladins exactly as before', () => {
    const { state, world } = hurtPaladin();
    world.known = []; // warrior: no heals in the spellbook
    step(state, world, 0);
    expect(state.mode).toBe('TRAVEL');
    expect(world.onCasts).toEqual([]);
    expect(world.moveInput.forward).toBe(true); // keeps farming
  });

  it('combat entry interrupts the heal-hold', () => {
    const { state, world } = hurtPaladin();
    step(state, world, 0);
    expect(state.mode).toBe('REST');
    world.entities.set(
      80,
      makeEntity({ id: 80, name: 'wolf', aggroTargetId: 1, pos: { x: 3, y: 0, z: 0 } }),
    );
    world.player.inCombat = true;
    step(state, world, 100);
    expect(state.mode).toBe('COMBAT');
  });

  it('works identically in gold mode', () => {
    const { state, world } = makeBrain({ mode: 'gold' });
    world.player.maxHp = 100;
    world.player.hp = 40;
    world.player.maxResource = 200;
    world.player.resource = 200;
    world.player.resourceType = 'mana';
    world.known = [paladinAbility('holy_light', 117)];
    step(state, world, 0);
    expect(state.mode).toBe('REST'); // gold door approach yields to the heal
    expect(world.onCasts).toEqual([{ id: 'holy_light', targetId: 1 }]);
  });
});

describe('farmbot brain: emergency buttons (survival)', () => {
  function survivalPaladinAbility(id: string): ResolvedAbility {
    return {
      def: {
        id,
        name: id === 'divine_protection' ? 'Ward of Faith' : 'Last Rite',
        class: 'paladin',
        cost: 0,
        castTime: 0,
        cooldown: 0,
        range: 0,
        school: 'holy',
        requiresTarget: id !== 'divine_protection',
      },
      rank: 1,
      cost: 0,
      castTime: 0,
      cooldown: 0,
      effects: [],
      threatFlat: 0,
      threatMult: 1,
    } as unknown as ResolvedAbility;
  }

  function inCombatWithWolf(world: FakeWorld, hp: number) {
    world.entities.set(
      80,
      makeEntity({ id: 80, name: 'wolf', aggroTargetId: 1, pos: { x: 3, y: 0, z: 0 } }),
    );
    world.player.inCombat = true;
    world.player.maxHp = 100;
    world.player.hp = hp;
  }

  it('fires Ward of Faith mid-COMBAT below 40% and skips the rotation cast', () => {
    const { state, world } = makeBrain({ combat: { abilitySlots: [0] } });
    world.known = [survivalPaladinAbility('divine_protection')];
    inCombatWithWolf(world, 30);
    const logs = step(state, world, 0);
    expect(state.mode).toBe('COMBAT');
    expect(world.abilityCasts).toEqual(['divine_protection']); // targetless cast
    expect(world.casts).toEqual([]); // rotation cast replaced this tick
    expect(logs.some((l) => l.includes('emergency: Ward of Faith'))).toBe(true);
    expect(world.autoAttackStarts).toBe(1); // auto-attack continues
  });

  it('fires Last Rite on self below 20% when Ward of Faith is on cooldown', () => {
    const { state, world } = makeBrain({ combat: { abilitySlots: [0] } });
    world.known = [
      survivalPaladinAbility('divine_protection'),
      survivalPaladinAbility('lay_on_hands'),
    ];
    world.player.cooldowns = new Map([['divine_protection', 60]]);
    inCombatWithWolf(world, 15);
    const logs = step(state, world, 0);
    expect(world.onCasts).toEqual([{ id: 'lay_on_hands', targetId: 1 }]); // friendly-targeted: cast on self
    expect(logs.some((l) => l.includes('emergency: Last Rite'))).toBe(true);
  });

  it('uses the best potion below 35% and honors the 120s cooldown', () => {
    const { state, world } = makeBrain({ combat: { abilitySlots: [0] } });
    inCombatWithWolf(world, 30);
    world.inventory = [
      { itemId: 'minor_health_potion', count: 1 },
      { itemId: 'greater_health_potion', count: 1 },
    ];
    let logs = step(state, world, 0);
    expect(world.itemsUsed).toEqual(['greater_health_potion']);
    expect(logs.some((l) => l.includes('emergency: Greater Health Potion'))).toBe(true);
    expect(state.lastPotionAtMs).toBe(0);
    logs = step(state, world, 600);
    expect(world.itemsUsed).toEqual(['greater_health_potion']); // cooldown: no second potion
    logs = step(state, world, 120_100);
    expect(world.itemsUsed).toEqual(['greater_health_potion', 'greater_health_potion']);
  });

  it('does nothing out of combat', () => {
    const { state, world } = makeBrain();
    world.player.maxHp = 100;
    world.player.hp = 10;
    world.known = [survivalPaladinAbility('divine_protection')];
    world.inventory = [{ itemId: 'greater_health_potion', count: 1 }];
    step(state, world, 0);
    expect(state.mode).toBe('TRAVEL'); // emergency buttons are combat/flee only
    expect(world.abilityCasts).toEqual([]);
    expect(world.itemsUsed).toEqual([]);
  });

  it('fires while fleeing too', () => {
    const { state, world } = makeBrain({ combat: { flee: 'outleveled', fleeAboveLevelDelta: 3 } });
    world.player.level = 3;
    world.player.maxHp = 100;
    world.player.hp = 30;
    world.known = [survivalPaladinAbility('divine_protection')];
    world.entities.set(
      80,
      makeEntity({ id: 80, name: 'wolf', level: 7, aggroTargetId: 1, pos: { x: 10, y: 0, z: 0 } }),
    );
    world.player.inCombat = true;
    const logs = step(state, world, 0);
    expect(state.mode).toBe('FLEE');
    expect(world.abilityCasts).toEqual(['divine_protection']);
    expect(logs.some((l) => l.includes('emergency: Ward of Faith'))).toBe(true);
  });
});

describe('farmbot brain: level mode (phase 12)', () => {
  function levelAbility(id: string): ResolvedAbility {
    return {
      def: {
        id,
        name: id,
        class: 'paladin',
        cost: 55,
        castTime: 0,
        cooldown: 15,
        range: 30,
        school: 'holy',
        requiresTarget: true,
      },
      rank: 1,
      cost: 55,
      castTime: 0,
      cooldown: 15,
      effects: [{ type: 'directDamage', min: 50, max: 60 }],
      threatFlat: 0,
      threatMult: 1,
    } as unknown as ResolvedAbility;
  }

  function levelTables(zoneId = 'zone_a'): GrindTables {
    return {
      camps: [
        { mobId: 'wolf', center: { x: 50, z: 0 }, radius: 20, count: 4 },
        { mobId: 'wolf', center: { x: 90, z: 0 }, radius: 20, count: 2 },
      ],
      mobs: {
        wolf: { id: 'wolf', name: 'wolf', minLevel: 5, maxLevel: 6 } as unknown as MobTemplate,
      },
      zoneIdAt: () => zoneId,
      xpValue: mobXpValue,
      zoneDefs: [
        { id: 'zone_a', levelRange: [1, 7] },
        { id: 'zone_b', levelRange: [6, 13] },
      ] as unknown as ZoneDef[],
    };
  }

  function levelBrain(over: Record<string, unknown> = {}, tables?: GrindTables) {
    const { state, world } = makeBrain(
      { mode: 'level', ...over },
      { grindTables: tables ?? levelTables() },
    );
    world.player.level = 5;
    return { state, world };
  }

  function levelMob(id: number, name: string, x: number, z: number, over: Partial<Entity> = {}) {
    return makeEntity({ id, name, kind: 'mob', level: 5, pos: { x, y: 0, z }, ...over });
  }

  it('travels to the best camp and pulls with the ranged ability when known', () => {
    const { state, world } = levelBrain();
    world.known = [levelAbility('exorcism')];
    world.player.pos = { x: 0, y: 0, z: 0 };
    let logs = step(state, world, 0);
    expect(world.moveInput.forward).toBe(true); // walking to the wolf camp
    // (0,0) sits inside the eastbrook wall, the camp is outside: the walk
    // routes through the east gate crossing first, not straight at the camp
    const gate = { x: 27.443, z: 7.31 }; // real exported crossing (scaled to the radius)
    expect(world.facing).toBeCloseTo(Math.atan2(gate.x, gate.z), 2);
    expect(state.levelCampKey).toBe('wolf@50,0');

    // at the camp with a mob visible beyond the 30 yd pull reach: close in
    world.player.pos = { x: 45, y: 0, z: 0 };
    const wolf = levelMob(90, 'wolf', 80, 0);
    world.entities.set(90, wolf);
    step(state, world, 100);
    expect(world.moveInput.forward).toBe(true); // 35 yd: closing in, not casting yet
    expect(world.abilityCasts).toEqual([]);
    // inside pull reach once the cadence gate has opened: stop and cast
    wolf.pos = { x: 70, y: 0, z: 0 };
    world.player.facing = Math.PI / 2; // the mirror echo of steering due +x
    logs = step(state, world, 700);
    expect(logs.some((l) => l.includes('level: pulling wolf'))).toBe(true);
    expect(world.targets).toEqual([90]);
    expect(world.abilityCasts).toEqual(['exorcism']);
  });

  it('holds the ranged pull while the pull ability cools down', () => {
    const { state, world } = levelBrain();
    world.known = [levelAbility('exorcism')];
    world.player.pos = { x: 45, y: 0, z: 0 };
    world.player.facing = Math.PI / 2; // mob is due +x
    world.player.cooldowns.set('exorcism', 10);
    world.entities.set(90, levelMob(90, 'wolf', 60, 0));
    const logs = step(state, world, 700); // cadence open, cooldown not
    expect(world.abilityCasts).toEqual([]);
    expect(logs.some((l) => l.includes('level: pulling'))).toBe(false);
    // cooled down: the next eligible tick casts
    world.player.cooldowns.set('exorcism', 0);
    step(state, world, 1400);
    expect(world.abilityCasts).toEqual(['exorcism']);
  });

  it('aims at the pull target before casting when facing is off', () => {
    const { state, world } = levelBrain();
    world.known = [levelAbility('exorcism')];
    world.player.pos = { x: 45, y: 0, z: 0 };
    world.player.facing = 0; // mob is due -x: bearing -PI/2, well off the arc
    world.entities.set(90, levelMob(90, 'wolf', 40, 0));
    const logs = step(state, world, 700);
    expect(world.abilityCasts).toEqual([]); // aimed instead of casting
    expect(logs.some((l) => l.includes('level: pulling'))).toBe(false);
    expect(world.facing).toBeCloseTo(-Math.PI / 2);
    // the facing echo lands on the mirror: the next tick casts
    world.player.facing = -Math.PI / 2;
    step(state, world, 800);
    expect(world.abilityCasts).toEqual(['exorcism']);
  });

  it('walk-aggros when no pull ability is known', () => {
    const { state, world } = levelBrain();
    world.player.pos = { x: 45, y: 0, z: 0 };
    world.player.facing = Math.PI / 2; // mob is due +x
    world.entities.set(90, levelMob(90, 'wolf', 60, 0));
    const logs = step(state, world, 700); // cadence: first pull allowed
    expect(logs.some((l) => l.includes('level: engaging wolf'))).toBe(true);
    expect(world.targets).toEqual([90]);
    expect(world.autoAttackStarts).toBe(1);
    expect(world.abilityCasts).toEqual([]);
  });

  it('marks a camp cleared after a quiet sweep and moves to the next one', () => {
    const { state, world } = levelBrain();
    world.player.pos = { x: 48, y: 0, z: 0 }; // inside camp 1
    step(state, world, 0); // anchors the quiet timer
    const logs = step(state, world, 9000);
    expect(logs.some((l) => l.includes('level: camp wolf cleared'))).toBe(true);
    expect(state.levelClearedAt['wolf@50,0']).toBe(9000);
    // next tick picks the second camp (the cleared one is on respawn cooldown)
    step(state, world, 9100);
    expect(state.levelCampKey).toBe('wolf@90,0');
  });

  it('zones up when every camp in the band is gray for the player', () => {
    // zone_a holds a level-2 camp (gray at 8); zone_b holds level-8 work.
    const tables: GrindTables = {
      camps: [
        { mobId: 'boar', center: { x: 10, z: 0 }, radius: 20, count: 4 },
        { mobId: 'bear', center: { x: 80, z: 0 }, radius: 20, count: 3 },
      ],
      mobs: {
        boar: { id: 'boar', name: 'boar', minLevel: 1, maxLevel: 2 } as unknown as MobTemplate,
        bear: { id: 'bear', name: 'bear', minLevel: 8, maxLevel: 8 } as unknown as MobTemplate,
      },
      zoneIdAt: (x) => (x >= 50 ? 'zone_b' : 'zone_a'),
      xpValue: mobXpValue,
      zoneDefs: [
        { id: 'zone_a', levelRange: [1, 7] },
        { id: 'zone_b', levelRange: [6, 13] },
      ] as unknown as ZoneDef[],
    };
    const { state, world } = levelBrain({}, tables);
    world.player.level = 8; // the zone_a boar camp is gray for 8
    world.player.pos = { x: 0, y: 0, z: 0 };
    const logs = step(state, world, 0);
    expect(logs.some((l) => l.includes('moving to zone_b'))).toBe(true);
    expect(state.levelZoneId).toBe('zone_b');
  });

  it('money-blues uses the gold loot rule and discard sweep', () => {
    const { state, world } = levelBrain();
    world.bagCapacity = 20;
    world.player.pos = { x: 48, y: 0, z: 0 };
    world.entities.set(
      90,
      levelMob(90, 'wolf', 49, 1, {
        dead: true,
        lootable: true,
        loot: { copper: 12, items: [{ itemId: 'grey_a', count: 1 }] },
      }),
    );
    const logs = step(state, world, 0);
    expect(world.lootCorpses).toEqual([90]);
    expect(logs.some((l) => l.includes('gold: looted 12c'))).toBe(true);
  });

  it('lootRule all rides the normal LOOT state instead of the gold filter', () => {
    const { state, world } = levelBrain({ levelGrind: { lootRule: 'all' } });
    const wolf = makeEntity({ id: 80, name: 'wolf', aggroTargetId: 1, pos: { x: 3, y: 0, z: 0 } });
    world.entities.set(80, wolf);
    world.player.inCombat = true;
    step(state, world, 0);
    expect(state.mode).toBe('COMBAT');
    wolf.dead = true;
    world.player.inCombat = false;
    step(state, world, 100);
    // the fight-end transition goes to LOOT (not the circuit), and the loot
    // pass auto-loots in the same tick before settling back to TRAVEL
    expect(world.autoLoots).toEqual([80]);
    expect(state.mode).toBe('TRAVEL');
  });

  it('tracks xp and levels from lifetimeXp, logs and alerts on level-up', () => {
    const { state, world } = levelBrain({ levelGrind: { targetLevel: 8 } });
    step(state, world, 0); // baseline
    expect(state.stats.levelsGained).toBe(0);
    world.lifetimeXp = 500;
    world.player.level = 6;
    const logs = step(state, world, 100);
    expect(state.stats.xpGained).toBe(500);
    expect(state.stats.levelsGained).toBe(1);
    expect(logs.some((l) => l.includes('level up: now level 6!'))).toBe(true);
    expect(state.alerts.some((a) => a.kind === 'level-up')).toBe(true);
  });

  it('logs the rested line once and stops at targetLevel', () => {
    const { state, world } = levelBrain({ levelGrind: { targetLevel: 6 } });
    world.restedXp = 100;
    let logs = step(state, world, 0);
    expect(logs.some((l) => l.includes('rested bonus active'))).toBe(true);
    logs = step(state, world, 100);
    expect(logs.some((l) => l.includes('rested bonus active'))).toBe(false);
    world.player.level = 6;
    logs = step(state, world, 200);
    expect(state.done).toBe(true);
    expect(world.logouts).toBe(1);
    expect(logs.some((l) => l.includes('target level 6 reached'))).toBe(true);
    expect(state.alerts.some((a) => a.kind === 'target-level')).toBe(true);
  });

  it('rests between pulls when below the threshold', () => {
    const { state, world } = levelBrain();
    world.player.pos = { x: 48, y: 0, z: 0 };
    world.player.maxHp = 100;
    world.player.hp = 40; // below the 50% rest gate
    const logs = step(state, world, 0);
    expect(state.mode).toBe('REST');
    expect(logs.some((l) => l.includes('level: recharging'))).toBe(true);
  });
});

describe('farmbot brain: combat intelligence (phase 13)', () => {
  const CRYPT = { x: 100300, z: -1250 }; // instanceOrigin(0, 0)
  const insidePos = (lx: number, lz: number) => ({ x: CRYPT.x + lx, y: 0, z: CRYPT.z + lz });

  function packMob(id: number, name: string, pos: { x: number; y: number; z: number }) {
    return makeEntity({ id, name, pos });
  }

  function interruptAbility(id: string, range = 0): ResolvedAbility {
    return {
      def: {
        id,
        name: id,
        class: 'paladin',
        cost: 10,
        castTime: 0,
        cooldown: 12,
        range,
        school: 'physical',
        requiresTarget: true,
      },
      rank: 1,
      cost: 10,
      castTime: 0,
      cooldown: 12,
      effects: [{ type: 'interrupt', lockout: 4 }],
      threatFlat: 0,
      threatMult: 1,
    } as unknown as ResolvedAbility;
  }

  function addAttacker(world: FakeWorld, id: number, over: Partial<Entity> = {}) {
    const mob = makeEntity({ id, aggroTargetId: 1, pos: { x: 3, y: 0, z: 0 }, ...over });
    world.entities.set(id, mob);
    return mob;
  }

  it('gold mode pulls into a 3-pack (dungeon packs are the farm, not a skip)', () => {
    const { state, world } = makeBrain({ mode: 'gold' });
    state.goldPhase = 'clear';
    world.player.pos = insidePos(0, 30);
    // Crypt-style pack of three (maxPullSize default is 2; gold must ignore it).
    world.entities.set(90, packMob(90, 'acolyte', insidePos(5, 32)));
    world.entities.set(91, packMob(91, 'acolyte', insidePos(8, 32)));
    world.entities.set(92, packMob(92, 'acolyte', insidePos(5, 35)));

    const logs = step(state, world, 700);
    expect(logs.some((l) => l.includes('gold: skipping'))).toBe(false);
    expect(logs.some((l) => l.includes('gold: pulling acolyte'))).toBe(true);
    expect(world.targets).toEqual([90]);
    expect(world.abilityCasts).toEqual(['exorcism']);
  });

  it('level mode skips the packed mob, not the camp', () => {
    const tables: GrindTables = {
      camps: [{ mobId: 'wolf', center: { x: 50, z: 0 }, radius: 20, count: 4 }],
      mobs: {
        wolf: { id: 'wolf', name: 'wolf', minLevel: 5, maxLevel: 6 } as unknown as MobTemplate,
      },
      zoneIdAt: () => 'zone_a',
      xpValue: mobXpValue,
      zoneDefs: [{ id: 'zone_a', levelRange: [1, 7] }] as unknown as ZoneDef[],
    };
    const { state, world } = makeBrain({ mode: 'level' }, { grindTables: tables });
    world.player.level = 5;
    world.player.pos = { x: 45, y: 0, z: 0 };
    world.player.facing = Math.PI / 2; // the loner is due +x
    world.entities.set(90, packMob(90, 'packwolf', { x: 48, y: 0, z: 0 }));
    world.entities.set(91, packMob(91, 'packwolf', { x: 48, y: 0, z: 5 }));
    world.entities.set(92, packMob(92, 'packwolf', { x: 48, y: 0, z: -5 }));
    world.entities.set(93, packMob(93, 'loner', { x: 60, y: 0, z: 0 })); // 12 yd off the pack

    let logs = step(state, world, 700);
    expect(logs.some((l) => l.includes('level: skipping packwolf, pack of 3'))).toBe(true);
    expect(state.levelCampKey).toBe('wolf@50,0'); // camp retained
    // the other two pack members are skipped in turn (one assessment per tick)
    step(state, world, 800);
    step(state, world, 900);
    logs = step(state, world, 1000);
    expect(logs.some((l) => l.includes('level: engaging loner'))).toBe(true);
    expect(world.targets).toEqual([93]);
  });

  it('grind mode ignores maxPullSize and pulls into the pack', () => {
    const { state, world } = makeBrain({ combat: { grind: true } });
    world.nodeReady.set('node_a', false);
    world.nodeReady.set('node_b', false);
    world.entities.set(90, packMob(90, 'boar', { x: 20, y: 0, z: 0 }));
    world.entities.set(91, packMob(91, 'boar', { x: 23, y: 0, z: 0 }));
    world.entities.set(92, packMob(92, 'boar', { x: 20, y: 0, z: 3 }));
    const logs = step(state, world, 0);
    expect(state.mode).toBe('COMBAT');
    expect(logs.some((l) => l.includes('grind: pulling boar'))).toBe(true);
    expect(world.targets).toEqual([90]);
  });

  it('flees 3+ attackers with flee outnumbered, exactly like the outleveled path', () => {
    const { state, world } = makeBrain({ combat: { flee: 'outnumbered' } });
    world.player.level = 3;
    addAttacker(world, 80, { level: 3, pos: { x: 10, y: 0, z: 0 } });
    addAttacker(world, 81, { level: 3, pos: { x: 12, y: 0, z: 0 } });
    addAttacker(world, 82, { level: 3, pos: { x: 11, y: 0, z: 2 } });
    const logs = step(state, world, 0);
    expect(state.mode).toBe('FLEE');
    expect(logs.some((l) => l.includes('outnumbered'))).toBe(true);
    expect(world.autoAttackStarts).toBe(0);
    expect(world.moveInput.forward).toBe(true);
    expect(world.facing).toBeCloseTo(-Math.PI / 2); // away from the +x pack
  });

  it('flee both trips on either rule, outleveled still ignores a same-level pack', () => {
    const both = makeBrain({ combat: { flee: 'both' } });
    addAttacker(both.world, 80, { level: 3, pos: { x: 10, y: 0, z: 0 } });
    addAttacker(both.world, 81, { level: 3, pos: { x: 12, y: 0, z: 0 } });
    addAttacker(both.world, 82, { level: 3, pos: { x: 11, y: 0, z: 2 } });
    const bothLogs = step(both.state, both.world, 0);
    expect(both.state.mode).toBe('FLEE');
    expect(bothLogs.some((l) => l.includes('outnumbered'))).toBe(true);

    const outleveled = makeBrain({ combat: { flee: 'outleveled', fleeAboveLevelDelta: 3 } });
    outleveled.world.player.level = 3;
    addAttacker(outleveled.world, 80, { level: 3 });
    addAttacker(outleveled.world, 81, { level: 3 });
    addAttacker(outleveled.world, 82, { level: 3 });
    step(outleveled.state, outleveled.world, 0);
    expect(outleveled.state.mode).toBe('COMBAT'); // 3 same-level attackers: stands
  });

  it('does not flee 2 attackers with flee outnumbered', () => {
    const { state, world } = makeBrain({ combat: { flee: 'outnumbered' } });
    addAttacker(world, 80, { level: 3 });
    addAttacker(world, 81, { level: 3 });
    step(state, world, 0);
    expect(state.mode).toBe('COMBAT');
  });

  it('interrupts a casting attacker when the class interrupt is known and in range', () => {
    const { state, world } = makeBrain({ combat: { rotationMode: 'slots', abilitySlots: [0] } });
    world.known = [interruptAbility('rebuke')];
    world.player.inCombat = true;
    addAttacker(world, 80, { castingAbility: 'fireball', castRemaining: 1.2 });
    const logs = step(state, world, 0);
    expect(world.onCasts).toEqual([{ id: 'rebuke', targetId: 80 }]);
    expect(logs.some((l) => l.includes('interrupt: fireball'))).toBe(true);
    expect(world.casts).toEqual([]); // the rotation slot yielded the tick
  });

  it('interrupts from range with a ranged interrupt', () => {
    const { state, world } = makeBrain({ combat: { rotationMode: 'slots', abilitySlots: [0] } });
    world.known = [interruptAbility('counterspell', 30)];
    world.player.inCombat = true;
    addAttacker(world, 80, {
      castingAbility: 'fireball',
      castRemaining: 2.0,
      pos: { x: 20, y: 0, z: 0 },
    });
    step(state, world, 0);
    expect(world.onCasts).toEqual([{ id: 'counterspell', targetId: 80 }]);
  });

  it('holds the interrupt when the cast is nearly done, on cooldown, or out of range', () => {
    // nearly done: 0.3s left is under the 0.4s window
    const late = makeBrain({ combat: { rotationMode: 'slots', abilitySlots: [0] } });
    late.world.known = [interruptAbility('rebuke')];
    late.world.player.inCombat = true;
    addAttacker(late.world, 80, { castingAbility: 'fireball', castRemaining: 0.3 });
    step(late.state, late.world, 0);
    expect(late.world.onCasts).toEqual([]);
    expect(late.world.casts).toEqual([0]); // rotation took the tick instead

    // on cooldown
    const cooling = makeBrain({ combat: { rotationMode: 'slots', abilitySlots: [0] } });
    cooling.world.known = [interruptAbility('rebuke')];
    cooling.world.player.inCombat = true;
    cooling.world.player.cooldowns.set('rebuke', 5);
    addAttacker(cooling.world, 80, { castingAbility: 'fireball', castRemaining: 1.2 });
    step(cooling.state, cooling.world, 0);
    expect(cooling.world.onCasts).toEqual([]);
    expect(cooling.world.casts).toEqual([0]);

    // out of range: melee rebuke cannot reach a caster 20 yd out
    const far = makeBrain({ combat: { rotationMode: 'slots', abilitySlots: [0] } });
    far.world.known = [interruptAbility('rebuke')];
    far.world.player.inCombat = true;
    addAttacker(far.world, 80, {
      castingAbility: 'fireball',
      castRemaining: 1.2,
      pos: { x: 20, y: 0, z: 0 },
    });
    step(far.state, far.world, 0);
    expect(far.world.onCasts).toEqual([]);
    expect(far.world.casts).toEqual([0]);
  });

  it('emergency outranks the interrupt, the interrupt outranks the rotation', () => {
    const { state, world } = makeBrain({ combat: { rotationMode: 'slots', abilitySlots: [0] } });
    world.known = [
      interruptAbility('divine_protection'), // Ward of Faith fixture (targetless)
      interruptAbility('rebuke'),
    ];
    (world.known[0].def as { requiresTarget: boolean }).requiresTarget = false;
    world.player.inCombat = true;
    world.player.maxHp = 100;
    world.player.hp = 30; // under the 40% Ward of Faith line
    addAttacker(world, 80, { castingAbility: 'fireball', castRemaining: 1.2 });
    step(state, world, 0);
    expect(world.abilityCasts).toEqual(['divine_protection']); // emergency first
    expect(world.onCasts).toEqual([]);

    // topped up next tick: the interrupt takes the slot before the rotation
    world.player.hp = 100;
    step(state, world, 600);
    expect(world.onCasts).toEqual([{ id: 'rebuke', targetId: 80 }]);
    expect(world.casts).toEqual([]);
  });
});

describe('farmbot brain: economy intelligence (phase 14)', () => {
  function econDef(id: string, over: Partial<ItemDef> = {}): ItemDef {
    return {
      id,
      name: id,
      kind: 'armor',
      slot: 'chest',
      sellValue: 5,
      quality: 'uncommon',
      ...over,
    } as ItemDef;
  }

  const ECON_DEFS: Record<string, ItemDef> = {
    worn_chest: econDef('worn_chest', { stats: { armor: 10 } }),
    drop_chest: econDef('drop_chest', { stats: { armor: 30 } }),
    better_chest: econDef('better_chest', { stats: { armor: 50 } }),
    weak_ring: econDef('weak_ring', { slot: 'ring', stats: { str: 2 } }),
    strong_ring: econDef('strong_ring', { slot: 'ring', stats: { str: 20 } }),
    drop_ring: econDef('drop_ring', { slot: 'ring', stats: { str: 10 } }),
    blue_sword: econDef('blue_sword', {
      kind: 'weapon',
      slot: 'mainhand',
      quality: 'rare',
      sellValue: 50,
    }),
    blue_ring: econDef('blue_ring', { slot: 'ring', quality: 'rare', sellValue: 5 }),
    grey_junk: econDef('grey_junk', { kind: 'junk', slot: undefined, quality: 'poor' }),
    reins_valorsteed: econDef('reins_valorsteed', {
      kind: 'mount',
      slot: undefined,
      quality: 'common',
    }),
  };
  const econItemDef = (id: string): ItemDef | undefined => ECON_DEFS[id] ?? itemDef(id);

  it('equips a strictly better drop after the loot pass, rings aimed at the weak slot', () => {
    const { state, world } = makeBrain({ gearUpgrades: true }, { itemDef: econItemDef });
    world.entities.set(
      80,
      makeEntity({ id: 80, name: 'wolf', aggroTargetId: 1, pos: { x: 3, y: 0, z: 0 } }),
    );
    world.player.inCombat = true;
    step(state, world, 0);
    expect(state.mode).toBe('COMBAT');
    // the fight ends; the loot mirror settles with the drops already in bags
    const wolf = world.entities.get(80);
    if (wolf) wolf.dead = true;
    world.player.inCombat = false;
    world.equipment = { chest: 'worn_chest', ring1: 'strong_ring', ring2: 'weak_ring' };
    world.inventory = [
      { itemId: 'drop_chest', count: 1 },
      { itemId: 'drop_ring', count: 1 },
    ];
    const logs = step(state, world, 100);
    expect(world.equips).toEqual([
      { itemId: 'drop_chest' },
      { itemId: 'drop_ring', slot: 'ring2' },
    ]);
    expect(logs.some((l) => l.includes('equipped drop_chest (upgrade)'))).toBe(true);
    expect(logs.some((l) => l.includes('equipped drop_ring (upgrade)'))).toBe(true);
  });

  it('never downgrades: a worse drop stays in the bags', () => {
    const { state, world } = makeBrain({ gearUpgrades: true }, { itemDef: econItemDef });
    const wolf = makeEntity({ id: 80, name: 'wolf', aggroTargetId: 1, pos: { x: 3, y: 0, z: 0 } });
    world.entities.set(80, wolf);
    world.player.inCombat = true;
    step(state, world, 0);
    wolf.dead = true;
    world.player.inCombat = false;
    world.equipment = { chest: 'better_chest' };
    world.inventory = [{ itemId: 'drop_chest', count: 1 }];
    step(state, world, 100);
    expect(world.equips).toEqual([]);
  });

  it('gold loot marks upgrades before the discard sweep, and protects them', () => {
    const { state, world } = makeBrain(
      { mode: 'gold', gearUpgrades: true },
      { itemDef: econItemDef },
    );
    state.goldPhase = 'clear';
    world.player.pos = { x: 100300, y: 0, z: -1250 + 30 }; // inside the crypt claim
    world.equipment = { chest: 'worn_chest' };
    world.inventory = [{ itemId: 'drop_chest', count: 1 }];
    world.entities.set(
      90,
      makeEntity({
        id: 90,
        name: 'shambler',
        dead: true,
        lootable: true,
        loot: { copper: 12, items: [] },
        pos: { x: 100301, y: 0, z: -1250 + 31 },
      }),
    );
    const logs = step(state, world, 0);
    expect(world.lootCorpses).toEqual([90]);
    expect(world.equips).toEqual([{ itemId: 'drop_chest' }]);
    expect(logs.some((l) => l.includes('equipped drop_chest (upgrade)'))).toBe(true);
    // an uncommon upgrade is not keep-quality: the sweep must not discard it
    expect(world.discards).toEqual([]);
  });

  it('market: collects proceeds once, then lists rares (fungible and instanced)', () => {
    const { state, world } = makeBrain({ bags: { marketSell: true } }, { itemDef: econItemDef });
    world.bagCapacity = 3;
    world.inventory = [
      { itemId: 'blue_sword', count: 1 },
      { itemId: 'blue_ring', count: 1, instance: { signer: 'Crafty' } },
      { itemId: 'grey_junk', count: 4 },
    ];
    world.entities.set(
      70,
      makeEntity({
        id: 70,
        name: 'merchant',
        kind: 'npc',
        templateId: 'the_merchant',
        hostile: false,
        pos: { x: 2, y: 0, z: 0 },
      }),
    );
    let logs = step(state, world, 0);
    expect(state.mode).toBe('BAGS_FULL');
    expect(world.marketCollects).toBe(1); // collect first, every visit
    expect(logs.some((l) => l.includes('market: collecting proceeds'))).toBe(true);
    logs = step(state, world, 100);
    expect(world.marketListings).toEqual([{ itemId: 'blue_sword', count: 1, price: 500 }]);
    logs = step(state, world, 200);
    expect(world.marketListings[1]).toEqual({
      itemId: 'blue_ring',
      price: 100, // sellValue 5 * 10 = 50, floored at 100
      instance: { signer: 'Crafty' },
    });
    // commons are never listed; with nothing left the visit falls through
    step(state, world, 300);
    step(state, world, 400);
    expect(world.marketListings.length).toBe(2);
    expect(world.marketCollects).toBe(1); // once per visit, not per tick
  });

  it('market: the session listing cap stops posting and falls back', () => {
    const { state, world } = makeBrain({ bags: { marketSell: true } }, { itemDef: econItemDef });
    state.marketListedCount = 10; // cap reached in an earlier session stretch
    world.bagCapacity = 1;
    world.inventory = [{ itemId: 'blue_sword', count: 1 }];
    world.entities.set(
      70,
      makeEntity({
        id: 70,
        name: 'merchant',
        kind: 'npc',
        templateId: 'the_merchant',
        hostile: false,
        pos: { x: 2, y: 0, z: 0 },
      }),
    );
    step(state, world, 0);
    step(state, world, 100);
    expect(world.marketCollects).toBe(1);
    expect(world.marketListings).toEqual([]);
  });

  it('market: no merchant nearby leaves the vendor flow untouched', () => {
    const { state, world } = makeBrain({ bags: { marketSell: true } }, { itemDef: econItemDef });
    world.bagCapacity = 1;
    world.inventory = [{ itemId: 'grey_junk', count: 4 }];
    world.entities.set(
      60,
      makeEntity({
        id: 60,
        name: 'vendor',
        kind: 'npc',
        hostile: false,
        vendorItems: ['bread'],
        pos: { x: 2, y: 0, z: 0 },
      }),
    );
    step(state, world, 0);
    step(state, world, 1100); // the sell rides the post-interact throttle
    expect(world.marketCollects).toBe(0);
    expect(world.sellJunks).toBe(1); // the normal sell-junk path ran
  });

  it('mount: summons for a long overworld leg when trained with reins in bags', () => {
    const { state, world } = makeBrain(
      { mode: 'gold', mount: { enabled: true } },
      { itemDef: econItemDef },
    );
    world.player.level = 20;
    world.riding = true;
    world.inventory = [{ itemId: 'reins_valorsteed', count: 1 }];
    world.player.pos = { x: 0, y: 0, z: 0 }; // the crypt door is ~120 yd out
    const logs = step(state, world, 0);
    expect(world.itemsUsed).toEqual(['reins_valorsteed']);
    expect(logs.some((l) => l.includes('mount: summoning'))).toBe(true);
  });

  it('mount: no summon without training, reins, level, or a long leg', () => {
    // untrained
    const untrained = makeBrain(
      { mode: 'gold', mount: { enabled: true } },
      { itemDef: econItemDef },
    );
    untrained.world.player.level = 20;
    untrained.world.riding = false;
    untrained.world.inventory = [{ itemId: 'reins_valorsteed', count: 1 }];
    step(untrained.state, untrained.world, 0);
    expect(untrained.world.itemsUsed).toEqual([]);

    // trained but no reins in bags
    const noReins = makeBrain({ mode: 'gold', mount: { enabled: true } }, { itemDef: econItemDef });
    noReins.world.player.level = 20;
    noReins.world.riding = true;
    step(noReins.state, noReins.world, 0);
    expect(noReins.world.itemsUsed).toEqual([]);

    // trained with reins but below the riding gate
    const low = makeBrain({ mode: 'gold', mount: { enabled: true } }, { itemDef: econItemDef });
    low.world.player.level = 19;
    low.world.riding = true;
    low.world.inventory = [{ itemId: 'reins_valorsteed', count: 1 }];
    step(low.state, low.world, 0);
    expect(low.world.itemsUsed).toEqual([]);
  });

  it('mount: dismounts on combat entry', () => {
    const { state, world } = makeBrain({ mount: { enabled: true } });
    world.player.mountKey = 'valorsteed';
    world.entities.set(
      80,
      makeEntity({ id: 80, name: 'wolf', aggroTargetId: 1, pos: { x: 3, y: 0, z: 0 } }),
    );
    const logs = step(state, world, 0);
    expect(state.mode).toBe('COMBAT');
    expect(world.mountToggles).toBe(1);
    expect(logs.some((l) => l.includes('mount: dismounting'))).toBe(true);
  });

  it('mount: buys riding training once when passing the stablemaster with 80g', () => {
    const { state, world } = makeBrain({ mount: { enabled: true, buyTraining: true } });
    world.player.level = 20;
    world.copper = 800_000;
    world.entities.set(
      60,
      makeEntity({
        id: 60,
        name: 'marla',
        kind: 'npc',
        templateId: 'stablemaster_marla',
        hostile: false,
        pos: { x: 2, y: 0, z: 0 },
      }),
    );
    const logs = step(state, world, 0);
    expect(world.ridingLessons).toEqual([60]);
    expect(logs.some((l) => l.includes('mount: learned riding'))).toBe(true);
    step(state, world, 100);
    expect(world.ridingLessons).toEqual([60]); // once per session

    // short on copper: no purchase
    const poor = makeBrain({ mount: { enabled: true, buyTraining: true } });
    poor.world.player.level = 20;
    poor.world.copper = 100;
    poor.world.entities.set(
      60,
      makeEntity({
        id: 60,
        name: 'marla',
        kind: 'npc',
        templateId: 'stablemaster_marla',
        hostile: false,
        pos: { x: 2, y: 0, z: 0 },
      }),
    );
    step(poor.state, poor.world, 0);
    expect(poor.world.ridingLessons).toEqual([]);
  });
});

describe('farmbot brain: target mode (phase 17)', () => {
  const TDEFS: Record<string, ItemDef> = {
    pole: { id: 'pole', name: 'pole', use: { type: 'fishing' } } as unknown as ItemDef,
    pick1: {
      id: 'pick1',
      name: 'pick1',
      use: { type: 'gatherTool', professionId: 'mining', tier: 1 },
    } as unknown as ItemDef,
  };
  const tItemDef = (id: string): ItemDef | undefined => TDEFS[id] ?? itemDef(id);

  const T_NODES: GatherNodeDef[] = [
    { id: 'ore_1', zoneId: 'zone_a', type: 'ore', pos: { x: 10, z: 0 }, level: 1, tier: 1 },
    { id: 'ore_2', zoneId: 'zone_a', type: 'ore', pos: { x: 40, z: 0 }, level: 1, tier: 1 },
    { id: 'herb_1', zoneId: 'zone_a', type: 'herb', pos: { x: 20, z: 0 }, level: 1, tier: 1 },
  ];
  const T_ZONES = [
    {
      id: 'zone_a',
      zMin: -100,
      zMax: 100,
      hub: { x: 0, z: 0, radius: 10, name: 'hub' },
      lakes: [{ x: 50, z: 0, radius: 10 }],
    },
  ] as unknown as ZoneDef[];

  function gatherDeps(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      nodes: T_NODES,
      nodeMaterialTable: {
        ore: { zone_a: { itemId: 'copper_ore', qtyByRarity: { common: 1 } } },
        wood: {},
        herb: {},
      },
      fishingTables: [{}],
      mobs: {},
      camps: [],
      zones: T_ZONES,
      items: TDEFS,
      inventory: [{ itemId: 'pick1', count: 1 }],
      proficiencies: {},
      playerLevel: 3,
      ...over,
    };
  }

  function gatherBrain(over: Record<string, unknown> = {}, depsOver: Record<string, unknown> = {}) {
    return makeBrain(
      { mode: 'target', target: { itemId: 'copper_ore', ...over } },
      { nodes: T_NODES, itemDef: tItemDef, targetDeps: gatherDeps(depsOver) as never },
    );
  }

  it('gather source restricts the node route to the source nodes', () => {
    const { state, world } = gatherBrain();
    expect(state.targetSource?.kind).toBe('gather');
    expect(state.nodes.map((n) => n.id)).toEqual(['ore_1', 'ore_2']); // herb_1 dropped
    step(state, world, 0);
    expect(state.travelNodeId).toBe('ore_1'); // nearest source node
    expect(world.moveInput.forward).toBe(true);
  });

  it('fish source injects the resolved spots and drives casts there', () => {
    const { state, world } = makeBrain(
      { mode: 'target', target: { itemId: 'raw_test_fish' } },
      {
        nodes: T_NODES,
        itemDef: tItemDef,
        targetDeps: gatherDeps({
          nodeMaterialTable: { ore: {}, wood: {}, herb: {} },
          fishingTables: [{ zone_a: [{ itemId: 'raw_test_fish', weight: 10 }] }],
          inventory: [{ itemId: 'pole', count: 1 }],
        }) as never,
      },
    );
    world.inventory = [{ itemId: 'pole', count: 1 }];
    expect(state.targetSource?.kind).toBe('fish');
    expect(state.config.fishing.enabled).toBe(true);
    expect(state.config.fishing.spots.length).toBe(3); // one lake, three arc points
    expect(state.nodes).toEqual([]); // no gathering on a fish target

    world.player.pos = { x: 0, y: 0, z: 0 };
    step(state, world, 0);
    expect(world.moveInput.forward).toBe(true); // walking to spot 0
    const spot = state.config.fishing.spots[0];
    world.player.pos = { x: spot.x, y: 0, z: spot.z };
    const logs = step(state, world, 100);
    expect(logs.some((l) => l.includes('at fish spot 0'))).toBe(true);
    expect(state.mode).toBe('FISH_CAST');
    step(state, world, 200);
    expect(state.mode).toBe('FISH_WAIT_BITE');
    step(state, world, 600); // FISH_ARM_MS passed: the cast goes out
    expect(world.itemsUsed).toEqual(['pole']);
  });

  it('mob source runs the camp loop even on gray mobs and counts the drop', () => {
    const { state, world } = makeBrain(
      { mode: 'target', target: { itemId: 'pelt' } },
      {
        nodes: T_NODES,
        itemDef: tItemDef,
        grindTables: {
          camps: [{ mobId: 'wolf', center: { x: 50, z: 0 }, radius: 20, count: 3 }],
          mobs: {
            wolf: {
              id: 'wolf',
              name: 'wolf',
              minLevel: 5,
              maxLevel: 6,
              loot: [{ itemId: 'pelt', chance: 0.5 }],
            } as unknown as MobTemplate,
          },
          zoneIdAt: () => 'zone_a',
          xpValue: mobXpValue,
          zoneDefs: [{ id: 'zone_a', levelRange: [1, 7] }] as unknown as ZoneDef[],
        },
        targetDeps: gatherDeps({
          nodeMaterialTable: { ore: {}, wood: {}, herb: {} },
          mobs: {
            wolf: {
              id: 'wolf',
              minLevel: 5,
              maxLevel: 6,
              loot: [{ itemId: 'pelt', chance: 0.5 }],
            },
          } as never,
          camps: [{ mobId: 'wolf', center: { x: 50, z: 0 }, radius: 20, count: 3 }],
          playerLevel: 20,
        }) as never,
      },
    );
    world.player.level = 20; // gray camp: still farmed for the drop
    expect(state.targetSource?.kind).toBe('mob');
    world.player.pos = { x: 0, y: 0, z: 0 };
    step(state, world, 0);
    expect(world.moveInput.forward).toBe(true); // walking to the camp

    world.player.pos = { x: 45, y: 0, z: 0 };
    world.player.facing = Math.PI / 2;
    const wolf = makeEntity({ id: 90, name: 'wolf', level: 5, pos: { x: 48, y: 0, z: 0 } });
    world.entities.set(90, wolf);
    let logs = step(state, world, 700);
    expect(logs.some((l) => l.includes('level: engaging wolf'))).toBe(true);
    wolf.aggroTargetId = 1;
    world.player.inCombat = true;
    step(state, world, 800);
    expect(state.mode).toBe('COMBAT');
    wolf.dead = true;
    world.player.inCombat = false;
    step(state, world, 900);
    expect(world.autoLoots).toEqual([90]); // lootRule all rides the LOOT pass
    // the corpse mirror settles with the pelt in the bags: counted via delta
    world.inventory = [{ itemId: 'pelt', count: 1 }];
    logs = step(state, world, 1000);
    expect(state.stats.targetCount).toBe(1);
  });

  it('counts gather/fish events without double counting the inventory delta', () => {
    const { state, world } = gatherBrain();
    step(state, world, 0); // baseline (empty bags)
    world.inventory = [{ itemId: 'copper_ore', count: 2 }];
    step(state, world, 100, [
      {
        type: 'gatherResult',
        nodeId: 'ore_1',
        nodeType: 'ore',
        professionId: 'mining',
        itemId: 'copper_ore',
        rarity: 'common',
        qty: 2,
      } as SimEvent,
    ]);
    expect(state.stats.targetCount).toBe(2); // event counted, delta suppressed
    world.inventory = [{ itemId: 'copper_ore', count: 5 }];
    step(state, world, 200); // +3 with no event (loot path)
    expect(state.stats.targetCount).toBe(5);
    step(state, world, 300, [
      {
        type: 'gatherResult',
        nodeId: 'ore_1',
        nodeType: 'ore',
        professionId: 'mining',
        itemId: 'iron_ore',
        rarity: 'common',
        qty: 9,
      } as SimEvent,
    ]);
    expect(state.stats.targetCount).toBe(5); // other items never count
    world.inventory = [{ itemId: 'copper_ore', count: 6 }];
    step(state, world, 400, [
      {
        type: 'fishingResult',
        pid: 1,
        itemId: 'copper_ore',
        quality: 'common',
        zoneId: 'zone_a',
        band: 0,
      } as SimEvent,
    ]);
    expect(state.stats.targetCount).toBe(6);
  });

  it('goal reached without mail stops the session with a log and alert', () => {
    const { state, world } = gatherBrain({ goal: 2 });
    step(state, world, 0);
    world.inventory = [{ itemId: 'copper_ore', count: 2 }];
    // the goal check rides the same tick the count lands on
    const logs = step(state, world, 100, [
      {
        type: 'gatherResult',
        nodeId: 'ore_1',
        nodeType: 'ore',
        professionId: 'mining',
        itemId: 'copper_ore',
        rarity: 'common',
        qty: 2,
      } as SimEvent,
    ]);
    expect(state.done).toBe(true);
    expect(world.logouts).toBe(1);
    expect(logs.some((l) => l.includes('target: goal 2 copper_ore reached'))).toBe(true);
    expect(state.alerts.some((a) => a.text.includes('goal 2'))).toBe(true);
  });

  it('goal with mailToWhenDone mails the stack before stopping', () => {
    const { state, world } = gatherBrain({ goal: 2, mailToWhenDone: 'Bankalt' });
    step(state, world, 0);
    world.inventory = [{ itemId: 'copper_ore', count: 2 }];
    world.entities.set(
      70,
      makeEntity({
        id: 70,
        kind: 'object',
        templateId: 'mailbox',
        hostile: false,
        pos: { x: 3, y: 0, z: 0 },
      }),
    );
    let logs = step(state, world, 100, [
      {
        type: 'gatherResult',
        nodeId: 'ore_1',
        nodeType: 'ore',
        professionId: 'mining',
        itemId: 'copper_ore',
        rarity: 'common',
        qty: 2,
      } as SimEvent,
    ]);
    expect(state.done).toBe(false);
    expect(state.targetPhase).toBe('mail');
    expect(logs.some((l) => l.includes('mailing copper_ore to Bankalt'))).toBe(true);
    step(state, world, 200);
    expect(world.mails.length).toBe(1);
    expect(world.mails[0].to).toBe('Bankalt');
    expect(world.mails[0].items).toEqual([{ itemId: 'copper_ore', count: 2 }]);
    world.inventory = []; // the letter is away (mirror settles)
    logs = step(state, world, 300);
    expect(state.done).toBe(true);
    expect(world.logouts).toBe(1);
  });

  it('goal 0 farms forever', () => {
    const { state, world } = gatherBrain({ goal: 0 });
    step(state, world, 0);
    world.inventory = [{ itemId: 'copper_ore', count: 5 }];
    step(state, world, 100);
    expect(state.stats.targetCount).toBe(5);
    expect(state.done).toBe(false);
    expect(world.logouts).toBe(0);
  });

  it('stops with a clear log when the item has no usable source', () => {
    const { state, world } = makeBrain(
      { mode: 'target', target: { itemId: 'not_a_mat' } },
      { nodes: T_NODES, itemDef: tItemDef, targetDeps: gatherDeps() as never },
    );
    const logs = step(state, world, 0);
    expect(state.done).toBe(true);
    expect(world.logouts).toBe(1);
    expect(logs.some((l) => l.includes('target: no usable source for not_a_mat'))).toBe(true);
  });
});
