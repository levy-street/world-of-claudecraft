import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed for the online-routing
// suite at the bottom (the corpse_harvest_sim.test.ts idiom); the offline
// suites above it never touch the server.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
}));

import { type ClientSession, GameServer } from '../server/game';
import { bagCapacity } from '../src/sim/bags';
import { GATHER_NODES, ITEMS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { PLAYER_SWIM_DEPTH } from '../src/sim/pathfind';
import { completeFishing } from '../src/sim/professions/fishing';
import {
  effectiveGradeToolTier,
  gatherNodeById,
  harvestYieldItemId,
  MATERIAL_RARITY_MAX_PROFICIENCY,
  NODE_HARVEST_TABLE,
  nodeMaterialFor,
} from '../src/sim/professions/gathering';
import {
  TIER2_TOOL_WIELD_PROFICIENCY,
  TIER3_TOOL_WIELD_PROFICIENCY,
  wieldRequirementForTier,
} from '../src/sim/professions/wield_gate';
import { Sim } from '../src/sim/sim';
import { type Entity, INTERACT_RANGE, xpForLevel } from '../src/sim/types';
import { groundHeight, terrainHeight, waterLevelAt } from '../src/sim/world';
import { bareClient } from './helpers/bare_client';
import { placeAtHarvestSpot } from './helpers/harvest_spot';

function mustMeta(sim: Sim, pid: number) {
  const meta = sim.players.get(pid);
  if (!meta) throw new Error(`missing player meta ${pid}`);
  return meta;
}

function makeWorld(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true });
}

function mustEntity(sim: Sim, pid: number): Entity {
  const entity = sim.entities.get(pid);
  if (!entity) throw new Error(`missing entity ${pid}`);
  return entity;
}

function mustNode(nodeId: string) {
  const node = GATHER_NODES.find((n) => n.id === nodeId);
  if (!node) throw new Error(`missing node ${nodeId}`);
  return node;
}

// Teleports a player entity onto a node (or, for a swim-deep waterline node,
// the nearest wading spot inside interact range): the shared helper, also
// consumed by tests/gather_rare_events.test.ts.
function teleportOntoNode(sim: Sim, pid: number, nodeId: string) {
  placeAtHarvestSpot(sim, pid, nodeId);
}

// A harvest is a short cast, not an instant grant. These helpers
// drive both shapes: castAndComplete runs the REAL loop (harvestNode starts
// the cast, the tick path routes completion), with mobs despawned first
// because mob damage cancels a gather cast mid-drive; completeCastNow mirrors
// the lifecycle completion arm synchronously (clear the cast fields exactly
// as updateCasting does, then route to ctx.completeGatherCast) so draw-count
// and event-shape pins stay on the untouched deterministic rng stream with
// zero world ticks in between.
function despawnMobs(sim: Sim) {
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob') continue;
    e.dead = true;
    e.hp = 0;
    e.aiState = 'dead';
    e.respawnTimer = 9999;
    e.corpseTimer = 9999;
    e.inCombat = false;
  }
}

function castAndComplete(
  sim: Sim,
  nodeId: string,
  pid: number,
  confirmEffectUse?: boolean,
): boolean {
  despawnMobs(sim);
  if (!sim.harvestNode(nodeId, confirmEffectUse, pid)) return false;
  const p = mustEntity(sim, pid);
  for (let i = 0; i < 80 && p.castingAbility; i++) sim.tick();
  if (p.castingAbility) throw new Error('gather cast never completed');
  sim.tick(); // drain the completion tick's queued proficiency grant
  return true;
}

function completeCastNow(sim: Sim, pid: number) {
  const p = mustEntity(sim, pid);
  const meta = mustMeta(sim, pid);
  p.castingAbility = null;
  p.castRemaining = 0;
  sim.ctx.completeGatherCast(p, meta);
}

const NODE_ID = GATHER_NODES[0].id;

// Which material this node grants (zone x type matrix): the
// harvest tuning row (NODE_HARVEST_TABLE) no longer carries an itemId.
const NODE_MATERIAL = nodeMaterialFor(GATHER_NODES[0].type, GATHER_NODES[0].zoneId);

describe('gather node harvest (#1121)', () => {
  it('a player near a node receives the material item on harvest', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Miner');
    sim.addItem('copper_mining_pick', 1, pid); // tier-1 pick: bare hands never harvest (#2343)
    teleportOntoNode(sim, pid, NODE_ID);

    const node = mustNode(NODE_ID);
    const entry = NODE_HARVEST_TABLE[node.type];

    const before = sim.countItem(NODE_MATERIAL.itemId, pid);
    expect(castAndComplete(sim, NODE_ID, pid)).toBe(true);
    expect(sim.countItem(NODE_MATERIAL.itemId, pid)).toBe(before + 1);
  });

  it('denies harvest when the player is too far from the node', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'FarAway');
    // Tool in bags (#2343) so the too-far arm is decisively the denier.
    sim.addItem('copper_mining_pick', 1, pid);
    const p = mustEntity(sim, pid);
    p.pos.x = -9999;
    p.pos.z = -9999;
    p.pos.y = terrainHeight(p.pos.x, p.pos.z, sim.cfg.seed);
    p.prevPos = { ...p.pos };

    const node = mustNode(NODE_ID);
    const entry = NODE_HARVEST_TABLE[node.type];
    const before = sim.countItem(NODE_MATERIAL.itemId, pid);
    expect(sim.harvestNode(NODE_ID, undefined, pid)).toBe(false);
    sim.tick();
    expect(sim.countItem(NODE_MATERIAL.itemId, pid)).toBe(before);
  });

  it("two players harvesting the same node each get their own respawn timer: A's harvest never blocks B", () => {
    // Seed 2 keeps both harvests on the ordinary one-item outcome (re-hunted
    // after the procedural-dungeons merge shifted the camp-driven world-gen
    // draw sequence). That keeps this timer-isolation case independent of the
    // valid five-item rare event.
    const sim = makeWorld(2);
    const pidA = sim.addPlayer('warrior', 'PlayerA');
    const pidB = sim.addPlayer('warrior', 'PlayerB');
    // Each carries their own tier-1 pick: bare hands never harvest (#2343).
    sim.addItem('copper_mining_pick', 1, pidA);
    sim.addItem('copper_mining_pick', 1, pidB);
    teleportOntoNode(sim, pidA, NODE_ID);
    teleportOntoNode(sim, pidB, NODE_ID);

    const node = mustNode(NODE_ID);
    const entry = NODE_HARVEST_TABLE[node.type];

    // Player A harvests first (the full cast-to-completion loop).
    expect(castAndComplete(sim, NODE_ID, pidA)).toBe(true);
    expect(sim.countItem(NODE_MATERIAL.itemId, pidA)).toBe(1);
    // Player A's own node is now on cooldown for A.
    expect(sim.nodeHarvestableByMeFor(NODE_ID, pidA)).toBe(false);

    // Player B, who never harvested yet, is still able to harvest the SAME
    // node: A's harvest never touched B's timer (no gather rush denial).
    expect(sim.nodeHarvestableByMeFor(NODE_ID, pidB)).toBe(true);
    expect(castAndComplete(sim, NODE_ID, pidB)).toBe(true);
    expect(sim.countItem(NODE_MATERIAL.itemId, pidB)).toBe(1);
    // B is now on cooldown for B; A's cooldown is unaffected by B harvesting:
    // it stays on the same denial it already had before B ever harvested.
    expect(sim.nodeHarvestableByMeFor(NODE_ID, pidB)).toBe(false);
    expect(sim.nodeHarvestableByMeFor(NODE_ID, pidA)).toBe(false);
  });

  it('denies a second harvest by the SAME player before their own timer elapses, allows it after', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Repeat');
    sim.addItem('copper_mining_pick', 1, pid);
    teleportOntoNode(sim, pid, NODE_ID);
    const node = mustNode(NODE_ID);
    const entry = NODE_HARVEST_TABLE[node.type];

    expect(castAndComplete(sim, NODE_ID, pid)).toBe(true);
    expect(sim.countItem(NODE_MATERIAL.itemId, pid)).toBe(1);

    // Immediately harvesting again is denied: this player's own timer has not
    // elapsed yet (the deny fires at cast START; no cast ever begins).
    expect(sim.harvestNode(NODE_ID, undefined, pid)).toBe(false);
    sim.tick();
    expect(sim.countItem(NODE_MATERIAL.itemId, pid)).toBe(1);

    // Fast-forward past the node's respawn window by advancing the sim clock
    // directly (sim.time, not wall-clock) rather than looping thousands of
    // ticks: only the deterministic clock value matters to the readiness
    // check, and a real tick still runs afterward to prove the transition.
    sim.time += entry.respawnSeconds + 1;
    sim.tick();
    expect(sim.nodeHarvestableByMeFor(NODE_ID, pid)).toBe(true);
    expect(castAndComplete(sim, NODE_ID, pid)).toBe(true);
    expect(sim.countItem(NODE_MATERIAL.itemId, pid)).toBe(2);
  });

  it('determinism: the same seed and same sequence of harvests yields the same result', () => {
    // A richer observable than "granted or not": the exact sim-time at which
    // the node becomes harvestable again (drives from ctx.time + a fixed
    // respawnSeconds, no rng, so it must land on the exact same tick every
    // run) plus the settled gathering-profession skill value, so a
    // regression that shifts either the timer or the grant amount is caught.
    const run = () => {
      const sim = makeWorld();
      const pid = sim.addPlayer('warrior', 'Det');
      sim.addItem('copper_mining_pick', 1, pid);
      teleportOntoNode(sim, pid, NODE_ID);
      castAndComplete(sim, NODE_ID, pid);
      const node = mustNode(NODE_ID);
      const entry = NODE_HARVEST_TABLE[node.type];
      // Advance to just short of the respawn window and record readiness,
      // then past it, so both edges of the timer are part of the observable.
      sim.time += entry.respawnSeconds - 1;
      sim.tick();
      const notYetReady = sim.nodeHarvestableByMeFor(NODE_ID, pid);
      sim.time += 2;
      sim.tick();
      const nowReady = sim.nodeHarvestableByMeFor(NODE_ID, pid);
      const skill = sim
        .professionsStateFor(pid)
        .skills.find((s) => s.professionId === entry.professionId)?.skill;
      return {
        count: sim.countItem(NODE_MATERIAL.itemId, pid),
        notYetReady,
        nowReady,
        skill,
      };
    };
    expect(run()).toEqual(run());
  });

  it('an unknown node id is denied without throwing', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Unknown');
    expect(sim.harvestNode('not_a_real_node', undefined, pid)).toBe(false);
    sim.tick();
    expect(sim.nodeHarvestableByMeFor('not_a_real_node', pid)).toBe(false);
  });

  it('a harvest grants the matching gathering profession one point of skill', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Skiller');
    sim.addItem('copper_mining_pick', 1, pid);
    teleportOntoNode(sim, pid, NODE_ID);
    const node = mustNode(NODE_ID);
    const entry = NODE_HARVEST_TABLE[node.type];

    const before = sim
      .professionsStateFor(pid)
      .skills.find((s) => s.professionId === entry.professionId)?.skill;
    // The grant is queued at cast COMPLETION and drained on the tick path
    // (same cadence as every other pendingGatherGrant drain); castAndComplete
    // ticks through the cast and that drain before asserting.
    expect(castAndComplete(sim, NODE_ID, pid)).toBe(true);
    const after = sim
      .professionsStateFor(pid)
      .skills.find((s) => s.professionId === entry.professionId)?.skill;
    expect(after).toBe((before ?? 0) + 1);
  });

  it('a harvest grants character XP scaled to the node level (profession XP)', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'XpMiner');
    sim.addItem('copper_mining_pick', 1, pid);
    teleportOntoNode(sim, pid, NODE_ID);
    const meta = mustMeta(sim, pid);
    const before = meta.xp;

    expect(castAndComplete(sim, NODE_ID, pid)).toBe(true);

    expect(meta.xp).toBeGreaterThan(before);
  });

  it('a harvest of a node far below a high-level player grants zero XP (gray band)', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'MaxLevelMiner');
    sim.addItem('copper_mining_pick', 1, pid);
    teleportOntoNode(sim, pid, NODE_ID);
    sim.setPlayerLevel(20);
    const meta = mustMeta(sim, pid);
    const before = meta.xp;

    expect(castAndComplete(sim, NODE_ID, pid)).toBe(true);

    expect(meta.xp).toBe(before);
  });

  it('denies harvest for a dead player without granting the item or the timer', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Ghost');
    // Tool in bags (#2343) so the dead gate, not the tool gate, is the denier.
    sim.addItem('copper_mining_pick', 1, pid);
    teleportOntoNode(sim, pid, NODE_ID);
    const p = mustEntity(sim, pid);
    p.dead = true;

    const node = mustNode(NODE_ID);
    const entry = NODE_HARVEST_TABLE[node.type];
    const before = sim.countItem(NODE_MATERIAL.itemId, pid);
    sim.harvestNode(NODE_ID, undefined, pid);
    sim.tick();
    expect(sim.countItem(NODE_MATERIAL.itemId, pid)).toBe(before);
    expect(sim.nodeHarvestableByMeFor(NODE_ID, pid)).toBe(true);
  });

  it('denies harvest when the bag is full, without consuming the respawn timer', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'FullBags');
    teleportOntoNode(sim, pid, NODE_ID);
    const node = mustNode(NODE_ID);
    const entry = NODE_HARVEST_TABLE[node.type];

    // Fill all but one bag slot with non-stacking instanced junk so canAddItem
    // denies regardless of the harvested item's own stack state (an
    // instanced slot, unlike a plain stack, never merges further adds); the
    // tier-1 pick takes the last slot, so the tool gate (#2343) passes and
    // the bags-full arm below is really the denier.
    const meta = mustMeta(sim, pid);
    const capacity = bagCapacity(meta.bags);
    meta.inventory.length = 0;
    for (let i = 0; i < capacity - 1; i++) {
      meta.inventory.push({ itemId: 'bone_fragments', count: 1, instance: { boundTo: pid } });
    }
    sim.addItem('copper_mining_pick', 1, pid);
    expect(sim.canAddItem(NODE_MATERIAL.itemId, 1, pid)).toBe(false);

    sim.drainEvents();
    sim.harvestNode(NODE_ID, undefined, pid);
    const ev = sim.drainEvents();
    expect(ev.some((e) => e.type === 'error' && e.text === 'Your bags are full.')).toBe(true);
    expect(ev.some((e) => e.type === 'gatherDenied')).toBe(false);
    sim.tick();
    expect(sim.nodeHarvestableByMeFor(NODE_ID, pid)).toBe(true);
  });

  it('spends exactly two rng draws on a granted harvest and none on any denial path', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'DrawCount');
    const fullBagsPid = sim.addPlayer('warrior', 'DrawCountFull');
    // The tier-1 pick (#2343): the granted path needs it, and the bags-full
    // arm must reach PAST the tool gate to stay a bags-full denial.
    sim.addItem('copper_mining_pick', 1, pid);
    teleportOntoNode(sim, pid, NODE_ID);
    teleportOntoNode(sim, fullBagsPid, NODE_ID);
    const node = mustNode(NODE_ID);
    const entry = NODE_HARVEST_TABLE[node.type];

    // Stuff the second player's bags up front so the bags-full branch below
    // stays reachable while their own per-player node timer is still fresh
    // (the readiness check sits before the capacity check).
    const fullMeta = mustMeta(sim, fullBagsPid);
    fullMeta.inventory.length = 0;
    for (let i = 0; i < bagCapacity(fullMeta.bags) - 1; i++) {
      fullMeta.inventory.push({
        itemId: 'bone_fragments',
        count: 1,
        instance: { boundTo: fullBagsPid },
      });
    }
    // Their pick takes the last slot: still zero room for the material.
    sim.addItem('copper_mining_pick', 1, fullBagsPid);
    expect(sim.canAddItem(NODE_MATERIAL.itemId, 1, fullBagsPid)).toBe(false);

    // The harvest rolls pull from the SHARED sim rng, so a draw on a denial
    // would advance the whole sim's stream and desync every downstream roll.
    // harvestNode dispatches synchronously and nothing ticks inside this
    // bracket, so every counted draw belongs to the harvest path. The harvest
    // pair resolves at cast COMPLETION: the cast start is draw-free,
    // and completion spends exactly TWO draws, draw #1 the rarity roll
    // (#1122), draw #2 the rare-event roll (gather_events.ts), regardless of
    // the outcome of either.
    let draws = 0;
    (sim as unknown as { rng: { setObserver(fn: () => void): void } }).rng.setObserver(() => {
      draws++;
    });

    sim.harvestNode(NODE_ID, undefined, pid); // granted: the cast starts, draw-free
    expect(draws).toBe(0);
    completeCastNow(sim, pid); // completion: the rarity draw plus the rare-event draw
    expect(draws).toBe(2);

    draws = 0;
    sim.harvestNode(NODE_ID, undefined, pid); // denied: not respawned for this player yet
    expect(draws).toBe(0);
    sim.harvestNode('no_such_node_id', undefined, pid); // denied: unknown node
    expect(draws).toBe(0);
    sim.harvestNode(NODE_ID, undefined, fullBagsPid); // denied: bags full
    expect(draws).toBe(0);
    const p = mustEntity(sim, pid);
    p.pos.x = node.pos.x + 100;
    p.prevPos = { ...p.pos };
    sim.harvestNode(NODE_ID, undefined, pid); // denied: too far away
    expect(draws).toBe(0);
    p.dead = true;
    sim.harvestNode(NODE_ID, undefined, pid); // denied: dead, the first guard in the chain
    expect(draws).toBe(0);
  });
});

describe('gather-completion event for audio (#1729)', () => {
  it('a granted harvest emits a personal gatherResult carrying node/profession/item/rarity', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Harvester');
    sim.addItem('copper_mining_pick', 1, pid);
    teleportOntoNode(sim, pid, NODE_ID);
    const node = mustNode(NODE_ID);
    const entry = NODE_HARVEST_TABLE[node.type];

    sim.drainEvents();
    sim.harvestNode(NODE_ID, undefined, pid);
    completeCastNow(sim, pid);
    const gather = sim.drainEvents().find((e) => e.type === 'gatherResult');
    if (gather?.type !== 'gatherResult') throw new Error('expected a gatherResult event');
    // Personal: carries the acting player's pid so the server routes it only to
    // the harvester (delivered-to-acting-player acceptance criterion).
    expect(gather.pid).toBe(pid);
    expect(gather.nodeId).toBe(node.id);
    expect(gather.nodeType).toBe(node.type);
    expect(gather.professionId).toBe(entry.professionId);
    expect(gather.itemId).toBe(NODE_MATERIAL.itemId);
    // A proficiency-0 harvest always rolls common (the rarity ladder puts all
    // weight on common at proficiency 0), so this exact value is seed-independent.
    expect(gather.rarity).toBe('common');
    // Payload fields: seed 42's rare-event draw misses here, so the
    // yield is the common row's single unit and the event says so explicitly.
    expect(gather.rareEvent).toBeNull();
    expect(gather.qty).toBe(1);
  });

  it('the emitted rarity reflects the actual roll: a max-proficiency harvest never reports common', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Proficient');
    sim.addItem('copper_mining_pick', 1, pid);
    teleportOntoNode(sim, pid, NODE_ID);
    const node = mustNode(NODE_ID);
    const entry = NODE_HARVEST_TABLE[node.type];
    const meta = mustMeta(sim, pid);
    // At max proficiency the rarity ladder puts ZERO weight on common, so the
    // emitted rarity must be one of the four higher tiers. This proves the event
    // carries the value actually rolled, not a hard-coded 'common'.
    meta.gatheringProficiency[entry.professionId] = MATERIAL_RARITY_MAX_PROFICIENCY;

    sim.drainEvents();
    sim.harvestNode(NODE_ID, undefined, pid);
    completeCastNow(sim, pid);
    const gather = sim.drainEvents().find((e) => e.type === 'gatherResult');
    if (gather?.type !== 'gatherResult') throw new Error('expected a gatherResult event');
    expect(gather.rarity).not.toBe('common');
    expect(['uncommon', 'rare', 'epic', 'legendary']).toContain(gather.rarity);
  });

  it('no gatherResult is emitted on any denial path (too far, dead, unknown node)', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Denied');
    // Tool in bags (#2343): each arm's own gate, not the tool gate, denies.
    sim.addItem('copper_mining_pick', 1, pid);
    const p = mustEntity(sim, pid);
    // Too far from any node.
    p.pos.x = -9999;
    p.pos.z = -9999;
    p.pos.y = terrainHeight(p.pos.x, p.pos.z, sim.cfg.seed);
    p.prevPos = { ...p.pos };
    sim.drainEvents();
    sim.harvestNode(NODE_ID, undefined, pid);
    expect(sim.drainEvents().some((e) => e.type === 'gatherResult')).toBe(false);

    // Dead player standing on the node.
    teleportOntoNode(sim, pid, NODE_ID);
    p.dead = true;
    sim.drainEvents();
    sim.harvestNode(NODE_ID, undefined, pid);
    expect(sim.drainEvents().some((e) => e.type === 'gatherResult')).toBe(false);

    // Unknown node id.
    p.dead = false;
    sim.drainEvents();
    sim.harvestNode('not_a_real_node', undefined, pid);
    expect(sim.drainEvents().some((e) => e.type === 'gatherResult')).toBe(false);
  });

  it('the gatherResult event is deterministic across runs (same seed, same harvest)', () => {
    const run = () => {
      const sim = makeWorld();
      const pid = sim.addPlayer('warrior', 'Det');
      sim.addItem('copper_mining_pick', 1, pid);
      teleportOntoNode(sim, pid, NODE_ID);
      sim.drainEvents();
      sim.harvestNode(NODE_ID, undefined, pid);
      completeCastNow(sim, pid);
      return sim.drainEvents().find((e) => e.type === 'gatherResult');
    };
    expect(run()).toEqual(run());
  });
});

// The prime directive, inverted by #2343 (the RuneScape rule): every node
// def that shipped BEFORE the tool tier ramp keeps tier 1, and tier 1 now
// means "needs the matching TIER-1 tool", never bare hands: a toolless
// attempt is denied with requiredTier 1 ("no tool owned") and the tier-1
// tool restores access. The id list is LITERAL, never derived from
// GATHER_NODES (the FIELD_RECIPES tautology lesson): a future tier edit on
// any shipped node reds this pin decisively instead of silently re-deriving.
describe('the RuneScape rule (#2343): pre-phase nodes deny bare hands and need only a tier-1 tool', () => {
  const PRE_PHASE_NODE_IDS = [
    'ore_eastbrook_1',
    'ore_eastbrook_2',
    'ore_eastbrook_3',
    'wood_eastbrook_1',
    'wood_eastbrook_2',
    'wood_eastbrook_3',
    'herb_eastbrook_1',
    'herb_eastbrook_2',
    'herb_eastbrook_3',
    'ore_mirefen_1',
    'ore_mirefen_2',
    'ore_mirefen_3',
    'wood_mirefen_1',
    'wood_mirefen_2',
    'wood_mirefen_3',
    'herb_mirefen_1',
    'herb_mirefen_2',
    'herb_mirefen_3',
    'ore_thornpeak_1',
    'ore_thornpeak_2',
    'wood_thornpeak_1',
    'wood_thornpeak_2',
    'herb_thornpeak_1',
    'herb_thornpeak_2',
  ] as const;

  // The tier-1 tool per node type (content ids, src/sim/content/items.ts).
  const TIER1_TOOL_BY_NODE_TYPE = {
    ore: 'copper_mining_pick',
    wood: 'handaxe',
    herb: 'gathering_sickle',
  } as const;

  // Literal, deliberately NOT derived from NODE_HARVEST_TABLE (the table
  // production reads): an edit to the table must fail this pin, never move
  // the expectation and the behavior together.
  const PROFESSION_BY_NODE_TYPE = {
    ore: 'mining',
    wood: 'logging',
    herb: 'herbalism',
  } as const;

  it('all 24 pre-phase defs carry tier 1: bare hands deny with requiredTier 1 and zero draws, the matching tier-1 tool grants', () => {
    expect(PRE_PHASE_NODE_IDS).toHaveLength(24);
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'BareHands');
    const meta = mustMeta(sim, pid);
    // Genuinely bare-handed: the starting kit carries no gathering tool.
    expect(meta.inventory.some((s) => ITEMS[s.itemId]?.use?.type === 'gatherTool')).toBe(false);
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      for (const id of PRE_PHASE_NODE_IDS) {
        const node = mustNode(id);
        expect(node.tier, id).toBe(1);
        const professionId = PROFESSION_BY_NODE_TYPE[node.type];
        teleportOntoNode(sim, pid, id);
        sim.drainEvents();
        // Bare hands: denied, with exactly one gatherDenied whose
        // requiredTier 1 on a tier-1 node means "no tool owned at all";
        // no cast starts.
        expect(sim.harvestNode(id, undefined, pid), id).toBe(false);
        expect(
          sim.drainEvents().filter((e) => e.type === 'gatherDenied'),
          id,
        ).toEqual([{ type: 'gatherDenied', pid, surface: 'node', professionId, requiredTier: 1 }]);
        expect(mustEntity(sim, pid).castingAbility, id).toBe(null);
        // The matching tier-1 tool in bags grants the SAME node: the cast
        // starts and no denial fires.
        const toolId = TIER1_TOOL_BY_NODE_TYPE[node.type];
        sim.addItem(toolId, 1, pid);
        sim.drainEvents();
        expect(sim.harvestNode(id, undefined, pid), id).toBe(true);
        expect(
          sim.drainEvents().some((e) => e.type === 'gatherDenied'),
          id,
        ).toBe(false);
        // A successful interaction STARTS a cast; drop it, and the tool, so
        // the next node's attempt is bare-handed again and not denied as
        // busy (this pin is about access, not grants).
        const p = mustEntity(sim, pid);
        p.castingAbility = null;
        p.castRemaining = 0;
        p.gatherCastNodeId = '';
        meta.inventory = meta.inventory.filter((s) => s.itemId !== toolId);
      }
      // Every arm above, denial and cast start alike, is rng-draw-free.
      expect(draws).toBe(0);
    } finally {
      sim.rng.setObserver(null);
    }
  });

  it('the ramp is purely additive: only the _t2/_t3 veins carry tier 2 or higher', () => {
    // Re-minted from nine ids to eighteen when every zone went to six nodes per
    // type: Mirefen gained a second tier-2 vein of each type and Thornpeak a
    // second tier-2 AND a second tier-3, so no tier is carried by a single node
    // any more (a lone node's rate would have halved when respawn doubled). The
    // load-bearing claim is unchanged and is why the list is spelled out rather
    // than counted: every tier-2-or-higher node is a `_t2`/`_t3`-suffixed id, so
    // no zone-1 node and no plainly-numbered node ever needs a better tool. A
    // future tier bump on, say, ore_eastbrook_1 reds here rather than silently
    // locking the starting zone behind a 120-copper pick.
    const gated = GATHER_NODES.filter((n) => n.tier > 1)
      .map((n) => n.id)
      .sort();
    expect(gated).toEqual([
      'herb_mirefen_t2',
      'herb_mirefen_t2b',
      'herb_thornpeak_t2',
      'herb_thornpeak_t2b',
      'herb_thornpeak_t3',
      'herb_thornpeak_t3b',
      'ore_mirefen_t2',
      'ore_mirefen_t2b',
      'ore_thornpeak_t2',
      'ore_thornpeak_t2b',
      'ore_thornpeak_t3',
      'ore_thornpeak_t3b',
      'wood_mirefen_t2',
      'wood_mirefen_t2b',
      'wood_thornpeak_t2',
      'wood_thornpeak_t2b',
      'wood_thornpeak_t3',
      'wood_thornpeak_t3b',
    ]);
  });
});

// Deny ORDER pins: dead -> unknown node -> too far -> respawn ->
// tool gate -> bags full. Each case constructs the two competing denials at
// once, so the winning arm proves the order.
describe('node tool gate ordering', () => {
  const T2 = 'ore_mirefen_t2';

  it('the respawn deny fires before the tool gate: a cooling node never emits gatherDenied', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'OrderA');
    teleportOntoNode(sim, pid, T2);
    sim.addItem('iron_mining_pick', 1, pid);
    // The tier-2 pick must wield (R22) for the first harvest to start at all.
    mustMeta(sim, pid).gatheringProficiency.mining = TIER2_TOOL_WIELD_PROFICIENCY;
    expect(sim.harvestNode(T2, undefined, pid)).toBe(true);
    // Complete the cast: the respawn timer is consumed at completion
    // (inside resolveHarvest), never at the cast start.
    completeCastNow(sim, pid);
    // Drop the pick: the second attempt is both cooling AND tool-short.
    const meta = mustMeta(sim, pid);
    meta.inventory = meta.inventory.filter((s) => s.itemId !== 'iron_mining_pick');
    sim.drainEvents();
    expect(sim.harvestNode(T2, undefined, pid)).toBe(false);
    const ev = sim.drainEvents();
    expect(
      ev.some(
        (e) => e.type === 'error' && e.text === 'This resource node has not respawned for you yet.',
      ),
    ).toBe(true);
    expect(ev.some((e) => e.type === 'gatherDenied')).toBe(false);
  });

  it('the tool gate fires before the bags-full deny', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'OrderB');
    teleportOntoNode(sim, pid, T2);
    const meta = mustMeta(sim, pid);
    meta.inventory.length = 0;
    for (let i = 0; i < bagCapacity(meta.bags); i++) {
      meta.inventory.push({ itemId: 'bone_fragments', count: 1, instance: { boundTo: pid } });
    }
    expect(sim.canAddItem('iron_ore', 1, pid)).toBe(false);
    sim.drainEvents();
    expect(sim.harvestNode(T2, undefined, pid)).toBe(false);
    const ev = sim.drainEvents();
    expect(ev.some((e) => e.type === 'gatherDenied')).toBe(true);
    expect(ev.some((e) => e.type === 'error' && e.text === 'Your bags are full.')).toBe(false);
  });

  it('a tier-1 node with a tier-1 tool takes the untouched hot path: no gatherDenied, exactly the two pinned draws', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'HotPath');
    sim.addItem('copper_mining_pick', 1, pid);
    teleportOntoNode(sim, pid, NODE_ID);
    sim.drainEvents();
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      expect(sim.harvestNode(NODE_ID, undefined, pid)).toBe(true);
      expect(draws).toBe(0); // the cast start is draw-free
      completeCastNow(sim, pid);
    } finally {
      sim.rng.setObserver(null);
    }
    expect(draws).toBe(2);
    expect(sim.drainEvents().some((e) => e.type === 'gatherDenied')).toBe(false);
  });
});

// Same-seed determinism across every new gated path in one drive: a denied
// bare-hands attempt, a granted tier-2 harvest, a corpse harvest, and a
// tool-capped fishing catch. The observable is the full event stream plus the
// settled post-state, so an extra/removed rng draw or a reordered emit on any
// of these paths breaks the pin.
describe('gated-path determinism (same seed, same drive)', () => {
  it('two Sims produce identical event streams and post-state through the gated paths', () => {
    const run = () => {
      const sim = new Sim({ seed: 4242, playerClass: 'warrior', noPlayer: true });
      const pid = sim.addPlayer('warrior', 'Det');
      sim.tick();
      const meta = mustMeta(sim, pid);
      const events: unknown[] = [];
      teleportOntoNode(sim, pid, 'ore_mirefen_t2');
      sim.drainEvents();
      sim.harvestNode('ore_mirefen_t2', undefined, pid); // denied: bare hands at a tier-2 vein
      sim.addItem('iron_mining_pick', 1, pid);
      // The tier-2 pick must wield (R22). Set AFTER the bare-hands attempt
      // above so that denial stays the plain no-tool-owned arm.
      meta.gatheringProficiency.mining = TIER2_TOOL_WIELD_PROFICIENCY;
      sim.harvestNode('ore_mirefen_t2', undefined, pid); // granted: the cast starts
      completeCastNow(sim, pid); // the two draws and the grant land here
      // A wolf corpse harvest beside the vein (the tier-1 corpse path).
      const template = MOBS.forest_wolf;
      const p = mustEntity(sim, pid);
      const wolf = createMob(987654, template, template.maxLevel, { ...p.pos });
      wolf.dead = true;
      wolf.aiState = 'dead';
      wolf.corpseTimer = 9999;
      wolf.respawnTimer = 9999;
      sim.entities.set(wolf.id, wolf);
      sim.harvestCorpse(wolf.id, ['hide'], pid);
      // A band-capped catch: band-1 proficiency with no rod resolves band 0.
      // The draw count proves the arm is LIVE (completeFishing has no water
      // gate of its own, but an early-return regression would leave it 0).
      meta.gatheringProficiency.fishing = 150;
      let fishDraws = 0;
      sim.rng.setObserver(() => fishDraws++);
      try {
        completeFishing(sim.ctx, p, meta);
      } finally {
        sim.rng.setObserver(null);
      }
      events.push(...sim.drainEvents());
      sim.tick();
      return {
        events,
        fishDraws,
        ore: sim.countItem('iron_ore', pid),
        proficiency: { ...meta.gatheringProficiency },
        nodeReady: sim.nodeHarvestableByMeFor('ore_mirefen_t2', pid),
        inventory: JSON.parse(JSON.stringify(meta.inventory)),
      };
    };
    const a = run();
    expect(a).toEqual(run());
    // Non-degenerate: the drive really exercised the deny and grant arms.
    expect(a.events.some((e) => (e as { type: string }).type === 'gatherDenied')).toBe(true);
    expect(a.events.some((e) => (e as { type: string }).type === 'gatherResult')).toBe(true);
    expect(a.ore).toBeGreaterThanOrEqual(1);
    expect(a.nodeReady).toBe(false);
    // Non-degenerate fishing arm: exactly the one band-table draw ran.
    expect(a.fishDraws).toBe(1);
  });
});

// --- Online routing: the live GameServer router + snapshot
// pipeline, the professions_fishing pin-8 / corpse_harvest_sim idiom. The
// gatherDenied event is personal (routed generically by ev.pid, no server
// change), and a granted harvest still mirrors the per-player cooldown over
// the ncd self-delta.

interface FakeClient {
  sent: any[];
  ws: any;
}

function fakeWs(): FakeClient {
  const sent: any[] = [];
  return { sent, ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) } };
}

function joinServer(server: GameServer, fc: FakeClient, id: number, name: string): ClientSession {
  const session = server.join(fc.ws, id, id, name, 'warrior', null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

function deliveredEvents(fc: FakeClient): { type: string }[] {
  return fc.sent.filter((m) => m.t === 'events').flatMap((m) => m.list as { type: string }[]);
}

function lastSnap(sent: any[]): any {
  for (let i = sent.length - 1; i >= 0; i--) {
    if (sent[i].t === 'snap') return sent[i];
  }
  return null;
}

describe('node tool gating over the live server', () => {
  it('gatherDenied reaches the attempting session only; a granted harvest still mirrors ncd', () => {
    const server = new GameServer();
    const fcA = fakeWs();
    const fcB = fakeWs();
    const sa = joinServer(server, fcA, 71, 'Prospector');
    const sb = joinServer(server, fcB, 72, 'Bystander');
    const node = mustNode('ore_mirefen_t2');
    const e = server.sim.entities.get(sa.pid);
    if (!e) throw new Error('missing server entity');
    e.pos.x = node.pos.x;
    e.pos.z = node.pos.z;
    e.pos.y = terrainHeight(node.pos.x, node.pos.z, server.sim.cfg.seed);
    e.prevPos = { ...e.pos };
    server.sim.tick();
    fcA.sent.length = 0;
    fcB.sent.length = 0;

    // Bare hands: the deny is denied server-side and routed personally by
    // ev.pid through the generic router (no gatherDenied-specific wiring).
    expect(server.sim.harvestNode('ore_mirefen_t2', undefined, sa.pid)).toBe(false);
    (server as any).routeEvents(server.sim.drainEvents());
    expect(deliveredEvents(fcA).filter((ev) => ev.type === 'gatherDenied')).toEqual([
      {
        type: 'gatherDenied',
        pid: sa.pid,
        surface: 'node',
        professionId: 'mining',
        requiredTier: 2,
      },
    ]);
    // Bystander isolation: the personal denial never leaks to another session.
    expect(sb.pid).not.toBe(sa.pid);
    expect(deliveredEvents(fcB).some((ev) => ev.type === 'gatherDenied')).toBe(false);

    // Granted with the pick: the interact starts a gather cast whose
    // castStart routes over the wire (2.5 s: tier-2 pick at a tier-2 vein
    // buys nothing, band 0), and once the live loop completes the cast the
    // per-player cooldown mirrors over the ncd self-delta into the real
    // ClientWorld, exactly as for a tier-1 node.
    despawnMobs(server.sim);
    server.sim.addItem('iron_mining_pick', 1, sa.pid);
    // The tier-2 pick must wield (R22). Set after the bare-hands denial above
    // so that event keeps its no-tool-owned shape, and it stays inside band 0
    // (the 100 boundary), which is what holds the pinned 2.5 s duration.
    mustMeta(server.sim, sa.pid).gatheringProficiency.mining = TIER2_TOOL_WIELD_PROFICIENCY;
    expect(server.sim.harvestNode('ore_mirefen_t2', undefined, sa.pid)).toBe(true);
    (server as any).routeEvents(server.sim.drainEvents());
    expect(deliveredEvents(fcA)).toContainEqual(
      expect.objectContaining({ type: 'castStart', ability: 'gathering', time: 2.5 }),
    );
    for (let i = 0; i < 80 && e.castingAbility; i++) server.sim.tick();
    expect(e.castingAbility).toBe(null);
    server.sim.tick();
    (server as any).broadcastSnapshots();
    const client = bareClient(sa.pid);
    const snap = lastSnap(fcA.sent);
    expect(snap).not.toBeNull();
    (client as any).applySnapshot(snap);
    expect(client.nodeHarvestableByMe('ore_mirefen_t2')).toBe(false);
    expect(client.nodeHarvestableByMe('ore_mirefen_1')).toBe(true);
  });

  it('the R22 wield deny reaches the session with wieldProficiency intact', () => {
    // The arm above pins the no-tool shape, where wieldProficiency is ABSENT;
    // this pins it PRESENT over the SAME delivery path, so the field the
    // client's wield line reads is proven to survive routing and the
    // serialize-once fragment end to end. The emit itself is pinned offline in
    // tests/professions_tool_gate.test.ts; only the wire is new here.
    const server = new GameServer();
    const fc = fakeWs();
    const s = joinServer(server, fc, 73, 'Apprentice');
    const node = mustNode('ore_mirefen_t2');
    const e = server.sim.entities.get(s.pid);
    if (!e) throw new Error('missing server entity');
    e.pos.x = node.pos.x;
    e.pos.z = node.pos.z;
    e.pos.y = terrainHeight(node.pos.x, node.pos.z, server.sim.cfg.seed);
    e.prevPos = { ...e.pos };
    server.sim.tick();
    fc.sent.length = 0;

    // Covering but unwieldable: the tier-2 pick IS in the bags and mining sits
    // at 0, the state that splits the denial off the plain no-tool arm.
    server.sim.addItem('iron_mining_pick', 1, s.pid);
    expect(mustMeta(server.sim, s.pid).gatheringProficiency.mining).toBe(0);

    expect(server.sim.harvestNode('ore_mirefen_t2', undefined, s.pid)).toBe(false);
    (server as any).routeEvents(server.sim.drainEvents());
    expect(deliveredEvents(fc).filter((ev) => ev.type === 'gatherDenied')).toEqual([
      {
        type: 'gatherDenied',
        pid: s.pid,
        surface: 'node',
        professionId: 'mining',
        requiredTier: 2,
        wieldProficiency: 40,
      },
    ]);
    // 40 is spelled as a literal above on purpose: the pin is the VALUE that
    // reaches the client, not a restatement of the constant it comes from. A
    // ladder retune reds this line, which is the signal to re-record the wire
    // shape rather than to let a self-comparison absorb the change.
    expect(TIER2_TOOL_WIELD_PROFICIENCY).toBe(40);
  });

  it('the R40 confirmUse flag survives the real command router end to end', () => {
    // Through handleMessage (the t:cmd frame), not sim calls: the strict
    // boolean-true read in the harvest_node case is what is under test. A
    // confirmed frame fires the prompt slot (fine grade, charge spent); an
    // unconfirmed frame and a MALFORMED flag both take the fail-safe arm
    // (base grade, charge kept).
    const server = new GameServer();
    const fc = fakeWs();
    const s = joinServer(server, fc, 74, 'Prompter');
    despawnMobs(server.sim);
    const node = mustNode('ore_mirefen_t2');
    const e = server.sim.entities.get(s.pid);
    if (!e) throw new Error('missing server entity');
    e.pos.x = node.pos.x;
    e.pos.z = node.pos.z;
    e.pos.y = terrainHeight(node.pos.x, node.pos.z, server.sim.cfg.seed);
    e.prevPos = { ...e.pos };
    server.sim.addItem('iron_mining_pick', 1, s.pid);
    server.sim.addItem('artisans_eye', 1, s.pid);
    server.sim.slotToolEffect('mining', 'artisans_eye', 'prompt', s.pid);
    const meta = mustMeta(server.sim, s.pid);
    meta.gatheringProficiency.mining = TIER2_TOOL_WIELD_PROFICIENCY;
    const slot = meta.toolEffectSlots?.mining;
    if (!slot) throw new Error('prompt slot minted');
    expect(slot.confirmMode).toBe('prompt');

    const driveFrame = (extra: Record<string, unknown>) => {
      server.handleMessage(
        s,
        JSON.stringify({ t: 'cmd', cmd: 'harvest_node', node: 'ore_mirefen_t2', ...extra }),
      );
      for (let i = 0; i < 80 && e.castingAbility; i++) server.sim.tick();
      expect(e.castingAbility).toBe(null);
      server.sim.tick();
    };

    const charges = slot.durability;
    driveFrame({ confirmUse: true });
    expect(server.sim.countItem('fine_iron_ore', s.pid)).toBe(1);
    expect(slot.durability).toBe(charges - 1);

    meta.nodeHarvestReadyAt.ore_mirefen_t2 = server.sim.time;
    driveFrame({});
    expect(server.sim.countItem('iron_ore', s.pid)).toBe(2);
    expect(slot.durability).toBe(charges - 1);

    meta.nodeHarvestReadyAt.ore_mirefen_t2 = server.sim.time;
    driveFrame({ confirmUse: 'yes' });
    expect(server.sim.countItem('iron_ore', s.pid)).toBe(3);
    expect(slot.durability).toBe(charges - 1);
  });
});

// The fine-material axis (D8) through the LIVE harvest path: the pure rule is
// pinned in tests/material_grades.test.ts, this is the wiring that makes a
// real harvest hand over the other id. The mirefen ore family is the useful
// fixture because that zone ships both a tier-1 vein and a tier-2 one for the
// SAME material, so one tool can be above the material at one vein and not at
// the other without any content edit.
describe('fine material grades on the live harvest path', () => {
  const MIREFEN_T1 = 'ore_mirefen_1';
  const MIREFEN_T2 = 'ore_mirefen_t2';

  function harvestWith(nodeId: string, toolId: string) {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prospector');
    sim.addItem(toolId, 1, pid);
    // The tool must wield (R22): derive its own requirement from the def rather
    // than a bare number, so a fixture swapped to another tier stays honest.
    // Rods are exempt from the gate, so they are skipped here too.
    const use = ITEMS[toolId]?.use;
    if (use?.type === 'gatherTool' && use.professionId !== 'fishing') {
      mustMeta(sim, pid).gatheringProficiency[use.professionId] = wieldRequirementForTier(use.tier);
    }
    teleportOntoNode(sim, pid, nodeId);
    expect(castAndComplete(sim, nodeId, pid)).toBe(true);
    return { sim, pid };
  }

  it('the fixture nodes are the two tiers of one material, as the cases assume', () => {
    expect(mustNode(MIREFEN_T1).tier).toBe(1);
    expect(mustNode(MIREFEN_T2).tier).toBe(2);
    expect(mustNode(MIREFEN_T1).zoneId).toBe('mirefen_marsh');
    expect(mustNode(MIREFEN_T2).zoneId).toBe('mirefen_marsh');
    expect(nodeMaterialFor('ore', 'mirefen_marsh').itemId).toBe('iron_ore');
  });

  it('a tool AT the material tier yields the plain grade, even at the full-grade vein', () => {
    const { sim, pid } = harvestWith(MIREFEN_T2, 'iron_mining_pick'); // tier 2
    expect(sim.countItem('iron_ore', pid)).toBeGreaterThanOrEqual(1);
    expect(sim.countItem('fine_iron_ore', pid)).toBe(0);
  });

  it('a tool ABOVE the material tier yields the fine grade at the full-grade vein', () => {
    const { sim, pid } = harvestWith(MIREFEN_T2, 'mithril_mining_pick'); // tier 3
    expect(sim.countItem('fine_iron_ore', pid)).toBeGreaterThanOrEqual(1);
    expect(sim.countItem('iron_ore', pid)).toBe(0);
  });

  it('the same tool still yields the plain grade at the zone LOWER-tier vein', () => {
    // The arm that keeps the base material gatherable by the player who
    // out-tooled it: mirefen and thornpeak both keep low-tier veins on purpose.
    const { sim, pid } = harvestWith(MIREFEN_T1, 'mithril_mining_pick'); // tier 3
    expect(sim.countItem('iron_ore', pid)).toBeGreaterThanOrEqual(1);
    expect(sim.countItem('fine_iron_ore', pid)).toBe(0);
  });

  it("the grade reads the tool of the NODE's profession, not the best tool in the bag", () => {
    // A mixed toolbox is the discriminating case, and nothing else in the suite
    // has one: every other fixture is single-profession or gives all three
    // tools at the same tier, so a mining/logging/herbalism mix-up would read
    // identically. Here a tier-2 sickle works the tier-2 mirefen herb patch
    // (so the harvest is granted) while a tier-3 PICK sits in the same bag. The
    // pick outclasses the herb, but it is not the herb's tool.
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prospector');
    sim.addItem('bronze_sickle', 1, pid); // herbalism tier 2
    sim.addItem('mithril_mining_pick', 1, pid); // mining tier 3, wrong profession
    // BOTH tools must wield (R22), the pick included: an inert pick would fail
    // to leak its tier for the wrong reason and the case would stop
    // discriminating profession from tier.
    const meta = mustMeta(sim, pid);
    meta.gatheringProficiency.herbalism = TIER2_TOOL_WIELD_PROFICIENCY;
    meta.gatheringProficiency.mining = TIER3_TOOL_WIELD_PROFICIENCY;
    teleportOntoNode(sim, pid, 'herb_mirefen_t2');
    expect(castAndComplete(sim, 'herb_mirefen_t2', pid)).toBe(true);

    // The sickle is AT the material tier, so the plain grade, and the pick's
    // tier must not leak across professions.
    expect(sim.countItem('goldleaf_herb', pid)).toBeGreaterThanOrEqual(1);
    expect(sim.countItem('fine_goldleaf_herb', pid)).toBe(0);
  });

  it('the same patch DOES upgrade once the herbalism tool itself outclasses it', () => {
    // The positive control for the case above: swapping only the sickle tier
    // flips the grade, so the previous test is about the PROFESSION, not about
    // mirefen herb patches never upgrading.
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prospector');
    sim.addItem('silverleaf_sickle', 1, pid); // herbalism tier 3
    // The tier-3 sickle must wield (R22).
    mustMeta(sim, pid).gatheringProficiency.herbalism = TIER3_TOOL_WIELD_PROFICIENCY;
    teleportOntoNode(sim, pid, 'herb_mirefen_t2');
    expect(castAndComplete(sim, 'herb_mirefen_t2', pid)).toBe(true);

    expect(sim.countItem('fine_goldleaf_herb', pid)).toBeGreaterThanOrEqual(1);
    expect(sim.countItem('goldleaf_herb', pid)).toBe(0);
  });

  it('the upgrade costs no extra rng draw: still exactly two per granted harvest', () => {
    // The pinned two-draw contract has to survive the grade choice, which is
    // why the choice is a pure bag scan and not a roll.
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prospector');
    sim.addItem('mithril_mining_pick', 1, pid);
    // The tier-3 pick must wield (R22).
    mustMeta(sim, pid).gatheringProficiency.mining = TIER3_TOOL_WIELD_PROFICIENCY;
    teleportOntoNode(sim, pid, MIREFEN_T2);
    let draws = 0;
    (sim as any).rng.setObserver(() => {
      draws++;
    });
    expect(castAndComplete(sim, MIREFEN_T2, pid)).toBe(true);
    expect(sim.countItem('fine_iron_ore', pid)).toBeGreaterThanOrEqual(1);
    expect(draws).toBe(2);
  });

  it('the full-bag pre-gate reserves room for the grade it is about to grant', () => {
    // The pre-gate runs before both draws, so it must name the SAME id the
    // grant mints. The fixture is the discriminating one: every slot is used,
    // but one holds a PARTIAL plain-grade stack. There is room for another
    // plain iron ore (stack top-up) and none at all for the fine grade, so a
    // gate still checking the plain id would wave this harvest through.
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prospector');
    sim.addItem('mithril_mining_pick', 1, pid);
    const meta = mustMeta(sim, pid);
    // The tier-3 pick must wield (R22), or the tool gate would deny ahead of
    // the capacity pre-gate this case is about and the arm would pass blind.
    meta.gatheringProficiency.mining = TIER3_TOOL_WIELD_PROFICIENCY;
    const capacity = bagCapacity(meta.bags);
    const fillerStack = ITEMS.bone_fragments.stackSize ?? 20;
    while (meta.inventory.length < capacity - 1) sim.addItem('bone_fragments', fillerStack, pid);
    sim.addItem('iron_ore', 1, pid); // the partial stack, in the last free slot
    expect(meta.inventory.length).toBe(capacity);
    // The premise, asserted rather than assumed: plain fits, fine does not.
    expect(sim.ctx.canAddItem('iron_ore', 1, pid)).toBe(true);
    expect(sim.ctx.canAddItem('fine_iron_ore', 1, pid)).toBe(false);

    teleportOntoNode(sim, pid, MIREFEN_T2);
    let draws = 0;
    (sim as any).rng.setObserver(() => {
      draws++;
    });
    // Denied at the pre-gate, before the cast even starts, and rng-free, and
    // denied FOR THE RIGHT REASON: pin the bags-full text (the deny-arm case
    // below does the same) so a wield-gate or tier refusal cannot stand in for
    // the capacity pre-gate this case exists to prove.
    sim.drainEvents();
    expect(sim.harvestNode(MIREFEN_T2, undefined, pid)).toBe(false);
    expect(
      sim.drainEvents().some((e) => e.type === 'error' && e.text === 'Your bags are full.'),
    ).toBe(true);
    expect(draws).toBe(0);
    expect(sim.countItem('fine_iron_ore', pid)).toBe(0);
    // The denial did not spend the player's timer either.
    expect(sim.nodeHarvestableByMeFor(MIREFEN_T2, pid)).toBe(true);
  });

  it('the bags can fill DURING the cast, and completion re-gates on the fine grade', () => {
    // completeGatherCast re-checks capacity because the world moves during a
    // cast. It has to re-check it against the GRADE, not the plain id: the
    // grant hub never capacity-caps, so a completion gate that asked about
    // plain ore would wave this through and mint a fine ore into a full bag.
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prospector');
    sim.addItem('mithril_mining_pick', 1, pid);
    // The tier-3 pick must wield (R22).
    mustMeta(sim, pid).gatheringProficiency.mining = TIER3_TOOL_WIELD_PROFICIENCY;
    teleportOntoNode(sim, pid, MIREFEN_T2);

    // Room for everything at cast start, so the cast really does begin.
    expect(sim.harvestNode(MIREFEN_T2, undefined, pid)).toBe(true);

    // Now fill the bags mid-cast, leaving a PARTIAL plain-grade stack: room
    // for more plain ore, no room at all for the fine grade.
    const meta = mustMeta(sim, pid);
    const capacity = bagCapacity(meta.bags);
    const fillerStack = ITEMS.bone_fragments.stackSize ?? 20;
    while (meta.inventory.length < capacity - 1) sim.addItem('bone_fragments', fillerStack, pid);
    sim.addItem('iron_ore', 1, pid);
    expect(meta.inventory.length).toBe(capacity);
    expect(sim.ctx.canAddItem('iron_ore', 1, pid)).toBe(true);
    expect(sim.ctx.canAddItem('fine_iron_ore', 1, pid)).toBe(false);

    completeCastNow(sim, pid);
    sim.tick();

    // Refused, and nothing was minted past capacity.
    expect(sim.countItem('fine_iron_ore', pid)).toBe(0);
    expect(sim.countItem('iron_ore', pid)).toBe(1);
    expect(meta.inventory.length).toBe(capacity);
  });

  it('the pre-gate reads the SLOTTED quality effect, not the raw tool tier (deny arm)', () => {
    // A tier-2 pick AT the material tier would mint plain ore, but a slotted
    // Artisan's Eye lifts the effective tier to 3, so the grant mints FINE.
    // The fixture leaves room for plain and none for fine: a pre-gate reading
    // the raw tool tier resolves the plain id, waves the cast through, and the
    // player eats the whole cast for a late "Your bags are full." The gate
    // must resolve through the effect, the same resolver the grant uses.
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prospector');
    sim.addItem('iron_mining_pick', 1, pid); // tier 2, AT the material tier
    sim.addItem('artisans_eye', 1, pid); // the charm the slot consumes
    sim.slotToolEffect('mining', 'artisans_eye', undefined, pid);
    const meta = mustMeta(sim, pid);
    // The tier-2 pick must wield (R22), or the tool gate denies ahead of the
    // bags-full pre-gate this case pins.
    meta.gatheringProficiency.mining = TIER2_TOOL_WIELD_PROFICIENCY;
    expect(meta.toolEffectSlots?.mining?.effectId).toBe('artisans_eye');
    const capacity = bagCapacity(meta.bags);
    const fillerStack = ITEMS.bone_fragments.stackSize ?? 20;
    while (meta.inventory.length < capacity - 1) sim.addItem('bone_fragments', fillerStack, pid);
    sim.addItem('iron_ore', 1, pid); // partial plain stack in the last slot
    expect(meta.inventory.length).toBe(capacity);
    // The premise, asserted rather than assumed: plain fits, fine does not.
    expect(sim.ctx.canAddItem('iron_ore', 1, pid)).toBe(true);
    expect(sim.ctx.canAddItem('fine_iron_ore', 1, pid)).toBe(false);

    teleportOntoNode(sim, pid, MIREFEN_T2);
    let draws = 0;
    (sim as any).rng.setObserver(() => {
      draws++;
    });
    // Denied at the pre-gate, before the cast starts, rng-free, timer intact,
    // and denied FOR THE RIGHT REASON: pin the bags-full text so an unrelated
    // future refusal cannot mask a regressed pre-gate.
    sim.drainEvents();
    expect(sim.harvestNode(MIREFEN_T2, undefined, pid)).toBe(false);
    const ev = sim.drainEvents();
    expect(ev.some((e) => e.type === 'error' && e.text === 'Your bags are full.')).toBe(true);
    expect(draws).toBe(0);
    expect(sim.nodeHarvestableByMeFor(MIREFEN_T2, pid)).toBe(true);
  });

  it('the pre-gate and the grant agree for every confirm mode and consent (R40)', () => {
    // The one-resolver rule along the confirm axis: both cast-end pre-gates
    // and the grant now thread the SAME per-use consent through
    // harvestYieldItemId, so for every loadable mode and either consent the
    // id the pre-gate reserves room for is the id the grant actually mints.
    // 'always' ignores the flag; 'prompt' upgrades only when confirmed, and
    // an unconfirmed prompt use keeps its charge (the R40 fail-safe).
    const arms = [
      { confirmMode: 'always', confirm: undefined, fine: true },
      { confirmMode: 'always', confirm: true, fine: true },
      { confirmMode: 'prompt', confirm: undefined, fine: false },
      { confirmMode: 'prompt', confirm: true, fine: true },
    ] as const;
    for (const arm of arms) {
      const label = `mode ${arm.confirmMode}, confirm ${String(arm.confirm)}`;
      const sim = makeWorld();
      const pid = sim.addPlayer('warrior', 'Prospector');
      sim.addItem('iron_mining_pick', 1, pid);
      sim.addItem('artisans_eye', 1, pid); // the charm the slot consumes
      sim.slotToolEffect('mining', 'artisans_eye', undefined, pid);
      const meta = mustMeta(sim, pid);
      // The tier-2 pick must wield (R22).
      meta.gatheringProficiency.mining = TIER2_TOOL_WIELD_PROFICIENCY;
      const slot = meta.toolEffectSlots?.mining;
      expect(slot).toBeDefined();
      if (!slot) continue;
      slot.confirmMode = arm.confirmMode; // as a persisted row would load
      const chargesBefore = slot.durability;
      const node = gatherNodeById(MIREFEN_T2);
      expect(node).toBeDefined();
      if (!node) continue;
      const reserved = harvestYieldItemId(meta, node, arm.confirm === true);
      expect(reserved, label).toBe(arm.fine ? 'fine_iron_ore' : 'iron_ore');
      teleportOntoNode(sim, pid, MIREFEN_T2);
      expect(castAndComplete(sim, MIREFEN_T2, pid, arm.confirm)).toBe(true);
      expect(sim.countItem(reserved, pid), label).toBeGreaterThanOrEqual(1);
      // The charge follows the consent: a fired quality bonus spends (the
      // grade genuinely changed on this node), an unfired one keeps.
      expect(slot.durability, label).toBe(arm.fine ? chargesBefore - 1 : chargesBefore);
    }
  });

  it('an unconfirmed prompt cast reserves the BASE grade at both capacity gates (R40)', () => {
    // The consent THREADING pin the four-arm table cannot see (its bags
    // always have room): with a prompt-mode slot left unconfirmed, both the
    // cast-start pre-gate and the completion re-gate must reserve room for
    // the BASE grade the grant will actually mint. The fixture has room for
    // plain ore and none for fine, so a pre-gate that lost the consent
    // argument (falling back to the effect-assisted reader default) would
    // deny this harvest "Your bags are full." at either end of the cast.
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prospector');
    sim.addItem('iron_mining_pick', 1, pid);
    sim.addItem('artisans_eye', 1, pid);
    sim.slotToolEffect('mining', 'artisans_eye', undefined, pid);
    const meta = mustMeta(sim, pid);
    meta.gatheringProficiency.mining = TIER2_TOOL_WIELD_PROFICIENCY;
    const slot = meta.toolEffectSlots?.mining;
    expect(slot).toBeDefined();
    if (!slot) return;
    slot.confirmMode = 'prompt'; // as a persisted row would load
    const chargesBefore = slot.durability;
    const capacity = bagCapacity(meta.bags);
    const fillerStack = ITEMS.bone_fragments.stackSize ?? 20;
    while (meta.inventory.length < capacity - 1) sim.addItem('bone_fragments', fillerStack, pid);
    sim.addItem('iron_ore', 1, pid); // partial plain stack: room for base only
    expect(meta.inventory.length).toBe(capacity);
    expect(sim.ctx.canAddItem('iron_ore', 1, pid)).toBe(true);
    expect(sim.ctx.canAddItem('fine_iron_ore', 1, pid)).toBe(false);

    teleportOntoNode(sim, pid, MIREFEN_T2);
    sim.drainEvents();
    // The cast STARTS: the start pre-gate reserved the base grade.
    expect(sim.harvestNode(MIREFEN_T2, undefined, pid)).toBe(true);
    completeCastNow(sim, pid);
    sim.tick();
    // And COMPLETES: the completion re-gate reserved the same base grade,
    // the grant minted it, and the unfired prompt effect kept its charge.
    expect(sim.countItem('iron_ore', pid)).toBe(2);
    expect(sim.countItem('fine_iron_ore', pid)).toBe(0);
    expect(
      sim.drainEvents().some((e) => e.type === 'error' && e.text === 'Your bags are full.'),
    ).toBe(false);
    expect(slot.durability).toBe(chargesBefore);
  });

  it('a mid-cast mint on a DIFFERENT profession leaves the live cast consent intact (R40)', () => {
    // The phase 14 QA finding: slotToolEffectAction cleared the consent
    // capture unconditionally, so slotting an herbalism charm during a
    // confirmed mining cast silently revoked the mining consent and the
    // confirmed use minted base grade. The clear is now scoped to the
    // casting profession.
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prospector');
    sim.addItem('iron_mining_pick', 1, pid);
    sim.addItem('artisans_eye', 1, pid);
    sim.slotToolEffect('mining', 'artisans_eye', undefined, pid);
    const meta = mustMeta(sim, pid);
    meta.gatheringProficiency.mining = TIER2_TOOL_WIELD_PROFICIENCY;
    const slot = meta.toolEffectSlots?.mining;
    expect(slot).toBeDefined();
    if (!slot) return;
    slot.confirmMode = 'prompt';
    const chargesBefore = slot.durability;
    // The unrelated profession's kit, minted MID-CAST below.
    sim.addItem('gathering_sickle', 1, pid);
    sim.addItem('gatherers_cache', 1, pid);

    teleportOntoNode(sim, pid, MIREFEN_T2);
    expect(sim.harvestNode(MIREFEN_T2, true, pid)).toBe(true);
    sim.slotToolEffect('herbalism', 'gatherers_cache', undefined, pid);
    completeCastNow(sim, pid);
    sim.tick();

    // The confirmed mining use survived the herbalism mint: fine grade
    // minted, mining charge spent.
    expect(sim.countItem('fine_iron_ore', pid)).toBe(1);
    expect(slot.durability).toBe(chargesBefore - 1);
  });

  it('a mid-cast mint on the SAME profession still retires the consent (the R47 clear)', () => {
    // The scoped clear keeps its original purpose: replacing the CASTING
    // profession's slot mid-cast retires both captures, so the freshly
    // minted prompt slot cannot inherit consent given for the old one.
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prospector');
    sim.addItem('iron_mining_pick', 1, pid);
    sim.addItem('artisans_eye', 2, pid);
    // First slot stays 'always' so the mid-cast re-slot below is a REAL
    // mode gain (the no_gain conjunct would refuse a same-mode remint and
    // the clear under test would never run).
    sim.slotToolEffect('mining', 'artisans_eye', undefined, pid);
    const meta = mustMeta(sim, pid);
    meta.gatheringProficiency.mining = TIER2_TOOL_WIELD_PROFICIENCY;
    expect(meta.toolEffectSlots?.mining?.confirmMode).toBe('always');

    teleportOntoNode(sim, pid, MIREFEN_T2);
    expect(sim.harvestNode(MIREFEN_T2, true, pid)).toBe(true);
    // Replace the casting profession's own slot mid-cast, prompt-mode mint.
    sim.slotToolEffect('mining', 'artisans_eye', 'prompt', pid);
    const minted = meta.toolEffectSlots?.mining;
    expect(minted?.confirmMode).toBe('prompt');
    const mintedCharges = minted?.durability ?? 0;
    completeCastNow(sim, pid);
    sim.tick();

    // Consent retired with the old slot: the new prompt slot did not fire,
    // the harvest minted base grade, and the fresh charge is intact.
    expect(sim.countItem('fine_iron_ore', pid)).toBe(0);
    expect(sim.countItem('iron_ore', pid)).toBe(1);
    expect(minted?.durability).toBe(mintedCharges);
  });

  it('the consent defaults split by caller class: readers effect-assisted, commands fail-safe', () => {
    // The documented asymmetry, pinned so a future caller omitting the
    // argument gets exactly the intended answer: harvestYieldItemId (and
    // effectiveGradeToolTier under it) default confirmed=true, the
    // out-of-command reader view; the command path defaults false (the
    // four-arm table's undefined-consent rows pin the grant half).
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prospector');
    sim.addItem('iron_mining_pick', 1, pid);
    sim.addItem('artisans_eye', 1, pid);
    sim.slotToolEffect('mining', 'artisans_eye', undefined, pid);
    const meta = mustMeta(sim, pid);
    meta.gatheringProficiency.mining = TIER2_TOOL_WIELD_PROFICIENCY;
    const slot = meta.toolEffectSlots?.mining;
    expect(slot).toBeDefined();
    if (!slot) return;
    slot.confirmMode = 'prompt';
    const node = gatherNodeById(MIREFEN_T2);
    expect(node).toBeDefined();
    if (!node) return;
    // Reader default: the omitted argument previews the effect-assisted id.
    expect(harvestYieldItemId(meta, node)).toBe('fine_iron_ore');
    expect(harvestYieldItemId(meta, node, false)).toBe('iron_ore');
  });

  it('the pre-gate reads the SLOTTED quality effect (allow arm: room for fine only)', () => {
    // The mirror case: every plain stack is FULL (no room for plain ore) but a
    // partial FINE stack can top up. A raw-tool pre-gate resolves the plain id
    // and falsely denies a harvest whose grant fits. With the effect-aware
    // resolver the cast starts, completes, and mints the fine grade.
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prospector');
    sim.addItem('iron_mining_pick', 1, pid); // tier 2, AT the material tier
    sim.addItem('artisans_eye', 1, pid); // the charm the slot consumes
    sim.slotToolEffect('mining', 'artisans_eye', undefined, pid);
    const meta = mustMeta(sim, pid);
    // The tier-2 pick must wield (R22).
    meta.gatheringProficiency.mining = TIER2_TOOL_WIELD_PROFICIENCY;
    const capacity = bagCapacity(meta.bags);
    const oreStack = ITEMS.iron_ore.stackSize ?? 20;
    while (meta.inventory.length < capacity - 1) sim.addItem('iron_ore', oreStack, pid);
    sim.addItem('fine_iron_ore', 1, pid); // partial fine stack in the last slot
    expect(meta.inventory.length).toBe(capacity);
    expect(sim.ctx.canAddItem('iron_ore', 1, pid)).toBe(false);
    expect(sim.ctx.canAddItem('fine_iron_ore', 1, pid)).toBe(true);

    teleportOntoNode(sim, pid, MIREFEN_T2);
    expect(castAndComplete(sim, MIREFEN_T2, pid)).toBe(true);
    expect(sim.countItem('fine_iron_ore', pid)).toBeGreaterThanOrEqual(2);
  });

  it('a slotted-effect owner still draws exactly two at the COMMAND boundary', () => {
    // The unit-level pin (professions_rarity_roll.test.ts) drives
    // resolveHarvest directly, so a draw added on the command path AROUND it
    // (the pre-gate resolver, the depletion arm, the cast lifecycle) would
    // slip past. Drive the real command with an effect slotted: the whole
    // harvestNode -> cast -> completeGatherCast chain must stay at the pinned
    // two draws, and the charge spend proves the effect actually fired
    // (deterministic depletion, not a third roll).
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prospector');
    sim.addItem('iron_mining_pick', 1, pid);
    sim.addItem('artisans_eye', 1, pid); // the charm the slot consumes
    sim.slotToolEffect('mining', 'artisans_eye', undefined, pid);
    const meta = mustMeta(sim, pid);
    // The tier-2 pick must wield (R22).
    meta.gatheringProficiency.mining = TIER2_TOOL_WIELD_PROFICIENCY;
    const chargesBefore = meta.toolEffectSlots?.mining?.durability ?? 0;
    expect(chargesBefore).toBeGreaterThan(0);
    teleportOntoNode(sim, pid, MIREFEN_T2);
    let draws = 0;
    (sim as any).rng.setObserver(() => {
      draws++;
    });
    expect(castAndComplete(sim, MIREFEN_T2, pid)).toBe(true);
    expect(draws).toBe(2);
    expect(sim.countItem('fine_iron_ore', pid)).toBeGreaterThanOrEqual(1);
    expect(meta.toolEffectSlots?.mining?.durability).toBe(chargesBefore - 1);
  });

  it('a quality effect keeps its charge where the fine grade is unreachable (starter zones)', () => {
    // The v0.32.0 expansion's starter nodes are tier 1 while their materials
    // sit at rung 2 and 3 (veiled_hollow grants thorium_ore, gatherTier 3),
    // so yieldsFineGrade is false there at EVERY tool tier and a quality
    // charge can never pay off. The use-time gate (gathering.ts, the R9
    // zero-benefit refusal) must keep the charge: the harvest still grants
    // the plain material, still at two draws, and the slot is untouched. The
    // spend arm on a reachable node is the exactly-two-draws test above.
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prospector');
    sim.addItem('copper_mining_pick', 1, pid); // tier 1: opens the tier-1 vein
    sim.addItem('artisans_eye', 1, pid); // the charm the slot consumes
    sim.slotToolEffect('mining', 'artisans_eye', undefined, pid);
    const meta = mustMeta(sim, pid);
    const chargesBefore = meta.toolEffectSlots?.mining?.durability ?? 0;
    expect(chargesBefore).toBeGreaterThan(0);
    const STARTER = 'ore_veiled_hollow_1';
    teleportOntoNode(sim, pid, STARTER);
    let draws = 0;
    (sim as any).rng.setObserver(() => {
      draws++;
    });
    expect(castAndComplete(sim, STARTER, pid)).toBe(true);
    (sim as any).rng.setObserver(null);
    expect(draws).toBe(2);
    expect(sim.countItem('thorium_ore', pid)).toBeGreaterThanOrEqual(1);
    expect(sim.countItem('fine_thorium_ore', pid)).toBe(0);
    expect(meta.toolEffectSlots?.mining?.durability).toBe(chargesBefore);
  });

  it('a QUANTITY effect still spends and pays in a starter zone (the gate is quality-only)', () => {
    // The use-time charge gate is a conjunction on the effect KIND: deleting
    // its quality-only conjunct would silently stop quantity effects from
    // spending (and paying) in all eleven starter zones with every other
    // arm green. Gatherer's Cache adds +1 unit regardless of grade
    // reachability, so on the same starter vein it must spend the charge
    // AND grant base quantity plus one.
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prospector');
    sim.addItem('copper_mining_pick', 1, pid);
    sim.addItem('gatherers_cache', 1, pid); // the charm the slot consumes
    sim.slotToolEffect('mining', 'gatherers_cache', undefined, pid);
    const meta = mustMeta(sim, pid);
    const chargesBefore = meta.toolEffectSlots?.mining?.durability ?? 0;
    expect(chargesBefore).toBeGreaterThan(0);
    const STARTER = 'ore_veiled_hollow_1';
    teleportOntoNode(sim, pid, STARTER);
    const before = sim.countItem('thorium_ore', pid);
    // The two-draw contract holds on the quantity-mattered arm too, so the
    // R42 settle family is draw-count-pinned in every direction.
    let draws = 0;
    (sim as any).rng.setObserver(() => {
      draws++;
    });
    expect(castAndComplete(sim, STARTER, pid)).toBe(true);
    (sim as any).rng.setObserver(null);
    expect(draws).toBe(2);
    expect(sim.countItem('thorium_ore', pid)).toBeGreaterThanOrEqual(before + 2);
    expect(meta.toolEffectSlots?.mining?.durability).toBe(chargesBefore - 1);
  });

  it('R42: a quality charge is KEPT when the raw tool already earns the fine grade', () => {
    // The redundancy case the ruling exists for: a mithril pick (tier 3) at a
    // Mirefen t2 iron vein sits STRICTLY above the material rung, so the fine
    // grade mints with or without the Eye and the +1 changed nothing. The
    // boundary settle must compare the granted id against the same-draw base
    // and keep the charge, still at exactly two draws, with the fine grade
    // granted as ever.
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prospector');
    sim.addItem('mithril_mining_pick', 1, pid);
    sim.addItem('artisans_eye', 1, pid); // the charm the slot consumes
    sim.slotToolEffect('mining', 'artisans_eye', undefined, pid);
    const meta = mustMeta(sim, pid);
    // The tier-3 pick must wield (R22): it is the raw tool whose own tier
    // already earns the fine grade, which is the whole premise here.
    meta.gatheringProficiency.mining = TIER3_TOOL_WIELD_PROFICIENCY;
    const chargesBefore = meta.toolEffectSlots?.mining?.durability ?? 0;
    expect(chargesBefore).toBeGreaterThan(0);
    teleportOntoNode(sim, pid, MIREFEN_T2);
    let draws = 0;
    (sim as any).rng.setObserver(() => {
      draws++;
    });
    expect(castAndComplete(sim, MIREFEN_T2, pid)).toBe(true);
    (sim as any).rng.setObserver(null);
    expect(draws).toBe(2);
    expect(sim.countItem('fine_iron_ore', pid)).toBeGreaterThanOrEqual(1);
    expect(meta.toolEffectSlots?.mining?.durability).toBe(chargesBefore);
  });

  it('R42: a quantity charge is KEPT when capacity clips the grant to the base count', () => {
    // The truncation case: bags hold room for exactly ONE more copper ore, so
    // whatever the Cache added, the player walks away with what the plain
    // harvest would have granted. The boundary settle compares the GRANTED
    // count against the same-draw base and keeps the charge. Proficiency 0
    // rolls common (base 1) deterministically; a rare-event draw only raises
    // the base, so the clipped grant stays at or below it either way.
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prospector');
    sim.addItem('copper_mining_pick', 1, pid);
    sim.addItem('gatherers_cache', 1, pid); // the charm the slot consumes
    sim.slotToolEffect('mining', 'gatherers_cache', undefined, pid);
    const meta = mustMeta(sim, pid);
    const chargesBefore = meta.toolEffectSlots?.mining?.durability ?? 0;
    expect(chargesBefore).toBeGreaterThan(0);
    const capacity = bagCapacity(meta.bags);
    const fillerStack = ITEMS.bone_fragments.stackSize ?? 20;
    while (meta.inventory.length < capacity - 1) sim.addItem('bone_fragments', fillerStack, pid);
    const oreStack = (ITEMS.copper_ore.stackSize ?? 20) - 1;
    sim.addItem('copper_ore', oreStack, pid); // room for exactly one more
    expect(meta.inventory.length).toBe(capacity);
    expect(sim.ctx.canAddItem('copper_ore', 1, pid)).toBe(true);
    expect(sim.ctx.canAddItem('copper_ore', 2, pid)).toBe(false);
    const NODE = 'ore_eastbrook_1';
    teleportOntoNode(sim, pid, NODE);
    let draws = 0;
    (sim as any).rng.setObserver(() => {
      draws++;
    });
    expect(castAndComplete(sim, NODE, pid)).toBe(true);
    (sim as any).rng.setObserver(null);
    expect(draws).toBe(2);
    // Exactly the one unit landed (the base grant), and the charge survived.
    expect(sim.countItem('copper_ore', pid)).toBe(oreStack + 1);
    expect(meta.toolEffectSlots?.mining?.durability).toBe(chargesBefore);
  });

  it('R47: gathering with the bonus latches the ceiling to the tool actually carried', () => {
    // The mint-low arbitrage the fix review found: mint the slot with the
    // epic pick stashed (ceiling 20, dust prices), then gather with the pick
    // carried and refill at the dust rung forever. The use-time ratchet
    // closes it: the effect firing while a better tool is OWNED is the
    // pricing moment (read at BOTH ends of the cast, see the mid-cast arm
    // below), so the first bonus-bearing harvest re-prices the slot and the
    // next refill bills shards whatever pick is in hand at the command.
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prospector');
    sim.addItem('copper_mining_pick', 1, pid);
    sim.addItem('gatherers_cache', 1, pid);
    sim.slotToolEffect('mining', 'gatherers_cache', undefined, pid);
    const meta = mustMeta(sim, pid);
    const slot = meta.toolEffectSlots?.mining;
    if (!slot) throw new Error('slot minted');
    expect(slot.maxDurability).toBe(20); // minted low, pick stashed
    sim.addItem('arcanite_mining_pick', 1, pid);
    teleportOntoNode(sim, pid, 'ore_eastbrook_1');
    expect(castAndComplete(sim, 'ore_eastbrook_1', pid)).toBe(true);
    // One bonus-bearing harvest with the epic pick in bags: ceiling latched.
    expect(slot.maxDurability).toBe(50);
    // The refill now prices in shards even with the pick banked again.
    sim.removeItem('arcanite_mining_pick', 1, pid);
    slot.durability = 5;
    sim.addItem('arcane_dust', 10, pid);
    sim.addItem('arcane_shard', 10, pid);
    sim.rechargeToolEffect('mining', pid);
    sim.tick();
    expect(sim.countItem('arcane_dust', pid)).toBe(10);
    expect(sim.countItem('arcane_shard', pid)).toBe(8);
    expect(slot.durability).toBe(20);
    expect(slot.maxDurability).toBe(50);
  });

  it('R47: the ceiling ratchet is raise-only: a later lesser-tool harvest cannot lower it', () => {
    // The arbitrage's comeback route: if one cheap-pick harvest could RESET
    // the ceiling, the shard rung would be escapable without the re-slot
    // toll. Mutating ratchetCeilingForUse into an unconditional assignment
    // must fail here.
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prospector');
    sim.addItem('copper_mining_pick', 1, pid);
    sim.addItem('gatherers_cache', 1, pid);
    sim.slotToolEffect('mining', 'gatherers_cache', undefined, pid);
    const slot = mustMeta(sim, pid).toolEffectSlots?.mining;
    if (!slot) throw new Error('slot minted');
    sim.addItem('arcanite_mining_pick', 1, pid);
    teleportOntoNode(sim, pid, 'ore_eastbrook_1');
    expect(castAndComplete(sim, 'ore_eastbrook_1', pid)).toBe(true);
    expect(slot.maxDurability).toBe(50);
    // Epic pick gone, common pick carried: the next applied use (a FRESH
    // node; the first one is on its per-player respawn timer) must be a
    // no-op raise, never a write-down.
    sim.removeItem('arcanite_mining_pick', 1, pid);
    teleportOntoNode(sim, pid, 'ore_eastbrook_2');
    expect(castAndComplete(sim, 'ore_eastbrook_2', pid)).toBe(true);
    expect(slot.maxDurability).toBe(50);
  });

  it('R42 x R47: a DEPLETED slot neither applies nor latches, whatever tool is carried', () => {
    // effectApplied gates the ratchet: a slot with no charges gives no bonus,
    // so it must not re-price itself either (a spent slot in the bags of an
    // epic-pick owner stays at its minted rung until a real use).
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prospector');
    sim.addItem('copper_mining_pick', 1, pid);
    sim.addItem('gatherers_cache', 1, pid);
    sim.slotToolEffect('mining', 'gatherers_cache', undefined, pid);
    const slot = mustMeta(sim, pid).toolEffectSlots?.mining;
    if (!slot) throw new Error('slot minted');
    slot.durability = 0;
    sim.addItem('arcanite_mining_pick', 1, pid);
    teleportOntoNode(sim, pid, 'ore_eastbrook_1');
    expect(castAndComplete(sim, 'ore_eastbrook_1', pid)).toBe(true);
    expect(slot.maxDurability).toBe(20);
    expect(slot.durability).toBe(0);
  });

  it('the last-charge signal: gatherResult carries effectDepleted exactly on the emptying spend', () => {
    // The UX pass: depleteEffect's return used to be discarded, so an effect
    // expired silently. The flag must ride ONLY the harvest whose spend
    // reached zero: absent (not false) on every other event, so the wire
    // stays byte-identical for non-final harvests.
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prospector');
    sim.addItem('copper_mining_pick', 1, pid);
    sim.addItem('gatherers_cache', 1, pid); // quantity: every uncapped grant matters
    sim.slotToolEffect('mining', 'gatherers_cache', undefined, pid);
    const slot = mustMeta(sim, pid).toolEffectSlots?.mining;
    if (!slot) throw new Error('slot minted');

    // The completeCastNow idiom (the event-shape tests above): zero ticks
    // between completion and drain, so the emitted event is still queued.
    const harvestOnce = () => {
      mustMeta(sim, pid).nodeHarvestReadyAt.ore_eastbrook_1 = sim.time;
      sim.drainEvents();
      expect(sim.harvestNode('ore_eastbrook_1', undefined, pid)).toBe(true);
      completeCastNow(sim, pid);
      const ev = sim.drainEvents().find((e) => e.type === 'gatherResult');
      if (ev?.type !== 'gatherResult') throw new Error('missing gatherResult');
      return ev;
    };

    // Two charges left: the spend that lands on 1 must NOT carry the flag.
    slot.durability = 2;
    teleportOntoNode(sim, pid, 'ore_eastbrook_1');
    const notLast = harvestOnce();
    expect(slot.durability).toBe(1);
    expect('effectDepleted' in notLast).toBe(false);

    // The final charge: the same command now announces the depletion.
    const last = harvestOnce();
    expect(slot.durability).toBe(0);
    expect(last.effectDepleted).toBe(true);

    // Spent slot: further harvests apply nothing and never re-announce.
    const after = harvestOnce();
    expect('effectDepleted' in after).toBe(false);
  });

  it('the last-charge signal never fires on a KEPT charge (R42: the bonus did not matter)', () => {
    // A quality charm on a fine-unreachable starter node keeps its charge
    // (the R9 use-time suppression), so even at one remaining charge the
    // event must not claim a depletion that never happened.
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prospector');
    sim.addItem('copper_mining_pick', 1, pid);
    sim.addItem('artisans_eye', 1, pid);
    sim.slotToolEffect('mining', 'artisans_eye', undefined, pid);
    const slot = mustMeta(sim, pid).toolEffectSlots?.mining;
    if (!slot) throw new Error('slot minted');
    slot.durability = 1;
    // veiled_hollow's tier-1 node grants a rung-3 material: fine unreachable.
    teleportOntoNode(sim, pid, 'ore_veiled_hollow_1');
    sim.drainEvents();
    expect(sim.harvestNode('ore_veiled_hollow_1', undefined, pid)).toBe(true);
    completeCastNow(sim, pid);
    const ev = sim.drainEvents().find((e) => e.type === 'gatherResult');
    if (ev?.type !== 'gatherResult') throw new Error('missing gatherResult');
    expect(slot.durability).toBe(1);
    expect('effectDepleted' in ev).toBe(false);
  });

  it('R47: handing the good pick away MID-CAST still latches: the cast-start capture', () => {
    // Trade has no casting gate (deliberately), so the completion-time bag
    // scan alone was dodgeable: start the cast with the epic pick carried,
    // move the pick away during the 2 s cast, and the quantity bonus still
    // fires with only the common pick in bags. The harvestNode capture plus
    // the max(start, completion) ratchet close the whole handoff class
    // (trade, bank, mail, solo or two-client) without gating trade itself.
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prospector');
    sim.addItem('copper_mining_pick', 1, pid);
    sim.addItem('gatherers_cache', 1, pid);
    sim.slotToolEffect('mining', 'gatherers_cache', undefined, pid);
    const slot = mustMeta(sim, pid).toolEffectSlots?.mining;
    if (!slot) throw new Error('slot minted');
    expect(slot.maxDurability).toBe(20);
    sim.addItem('arcanite_mining_pick', 1, pid);
    teleportOntoNode(sim, pid, 'ore_eastbrook_1');
    despawnMobs(sim);
    expect(sim.harvestNode('ore_eastbrook_1', undefined, pid)).toBe(true);
    const p = mustEntity(sim, pid);
    expect(p.castingAbility).not.toBeNull();
    // Two ticks into the cast, the pick leaves the bags (the trade shape).
    sim.tick();
    sim.tick();
    sim.removeItem('arcanite_mining_pick', 1, pid);
    for (let i = 0; i < 80 && p.castingAbility; i++) sim.tick();
    if (p.castingAbility) throw new Error('gather cast never completed');
    sim.tick();
    // The bonus fired (a charge state moved or the grant landed) and the
    // ceiling latched off the CAST-START capture despite common-only
    // completion bags.
    expect(slot.maxDurability).toBe(50);
    // And the transient capture field is inert again after completion, so
    // it can never leak into a later cast or an at-rest parity sample.
    expect(p.gatherCastToolRarity).toBe('');
  });

  it('R47: a fresh mid-cast re-slot RETIRES the stale capture: the toll buys the downgrade', () => {
    // The re-slot toll is the sanctioned way DOWN off a price rung, paid at
    // any moment including mid-cast. Without the capture clear on the mint,
    // a cast started under the epic pick would re-latch the FRESH slot's
    // ceiling at completion, clawing back the downgrade the player just
    // paid a whole charm for.
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prospector');
    sim.addItem('copper_mining_pick', 1, pid);
    sim.addItem('arcanite_mining_pick', 1, pid);
    sim.addItem('gatherers_cache', 2, pid);
    sim.slotToolEffect('mining', 'gatherers_cache', undefined, pid);
    const meta = mustMeta(sim, pid);
    expect(meta.toolEffectSlots?.mining?.maxDurability).toBe(50); // minted on the epic pick
    teleportOntoNode(sim, pid, 'ore_eastbrook_1');
    despawnMobs(sim);
    expect(sim.harvestNode('ore_eastbrook_1', undefined, pid)).toBe(true);
    const p = mustEntity(sim, pid);
    expect(p.gatherCastToolRarity).toBe('epic'); // captured at cast start
    sim.tick();
    sim.tick();
    // Mid-cast: the epic pick leaves AND the player pays the re-slot toll.
    sim.removeItem('arcanite_mining_pick', 1, pid);
    sim.slotToolEffect('mining', 'gatherers_cache', undefined, pid);
    const fresh = meta.toolEffectSlots?.mining;
    if (!fresh) throw new Error('slot minted');
    expect(fresh.maxDurability).toBe(20); // the downgrade the charm bought
    expect(p.gatherCastToolRarity).toBe(''); // the stale capture retired
    for (let i = 0; i < 80 && p.castingAbility; i++) sim.tick();
    if (p.castingAbility) throw new Error('gather cast never completed');
    sim.tick();
    // Completion must NOT re-latch the fresh slot off the old capture.
    expect(fresh.maxDurability).toBe(20);
  });

  it('the quantity bonus is exactly plus one against the SAME seed without the effect', () => {
    // The floor above (>= before + 2) is satisfiable with the slotted effect
    // deleted: an uncommon-or-better rarity roll or a rare event pays 2+ on
    // its own (MATERIAL_QTY_BY_RARITY climbs, GATHER_RARE_EVENT_YIELD_MULT
    // multiplies). The seed PAIR is what makes the bonus decisive: same
    // seed, same node, same draw stream either side (slotting draws
    // nothing), so the two grants differ by exactly the Cache's +1.
    const run = (slotted: boolean): number => {
      const sim = makeWorld();
      const pid = sim.addPlayer('warrior', 'Prospector');
      sim.addItem('copper_mining_pick', 1, pid);
      // The charm the slot consumes, granted only on the slotted side so the
      // two runs end the fixture with IDENTICAL bags (slotting eats it).
      if (slotted) {
        sim.addItem('gatherers_cache', 1, pid);
        sim.slotToolEffect('mining', 'gatherers_cache', undefined, pid);
      }
      const STARTER = 'ore_veiled_hollow_1';
      teleportOntoNode(sim, pid, STARTER);
      expect(castAndComplete(sim, STARTER, pid)).toBe(true);
      return sim.countItem('thorium_ore', pid);
    };
    expect(run(true)).toBe(run(false) + 1);
  });

  it('the grade PREVIEW suppresses a quality slot exactly where the grant does', () => {
    // effectiveGradeToolTier and resolveHarvest both read
    // usableToolEffectSlot: on a starter node the preview must not advertise
    // the +1 the grant refuses (a tooltip promising a bonus the sim never
    // pays), and on a fine-grade-reachable node it must keep it.
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prospector');
    sim.addItem('copper_mining_pick', 1, pid);
    sim.addItem('artisans_eye', 1, pid); // the charm the slot consumes
    sim.slotToolEffect('mining', 'artisans_eye', undefined, pid);
    const meta = mustMeta(sim, pid);
    const starter = gatherNodeById('ore_veiled_hollow_1');
    const reachable = gatherNodeById('ore_mirefen_t2');
    if (!starter || !reachable) throw new Error('missing fixture node');
    expect(effectiveGradeToolTier(meta, 'mining', starter)).toBe(1);
    expect(effectiveGradeToolTier(meta, 'mining', reachable)).toBe(2);
  });

  it('no skilling while dead: a dead player cannot start a harvest at all (R31)', () => {
    // Already enforced (the vendor-family dead gate at the top of
    // harvestNode); pinned here so it cannot rot, because R31 records the
    // Thornpeak tier-1 faucet as ACCEPTED partly on the strength of "a zone
    // lethal to a level-1 while ALIVE", which assumes death really stops the
    // farming.
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prospector');
    sim.addItem('iron_mining_pick', 1, pid);
    // The tier-2 pick must wield (R22), so the live control below really is
    // the dead gate lifting and not a tool the player could never swing.
    mustMeta(sim, pid).gatheringProficiency.mining = TIER2_TOOL_WIELD_PROFICIENCY;
    teleportOntoNode(sim, pid, MIREFEN_T2);
    const p = mustEntity(sim, pid);
    p.dead = true;
    p.hp = 0;
    let draws = 0;
    (sim as any).rng.setObserver(() => {
      draws++;
    });
    sim.drainEvents();
    expect(sim.harvestNode(MIREFEN_T2, undefined, pid)).toBe(false);
    const ev = sim.drainEvents();
    expect(ev.some((e) => e.type === 'error' && e.text === "You can't do that while dead.")).toBe(
      true,
    );
    expect(p.castingAbility).toBeNull();
    expect(draws).toBe(0);
    // And the denial spent nothing: the personal respawn timer is untouched.
    expect(sim.nodeHarvestableByMeFor(MIREFEN_T2, pid)).toBe(true);
    // Live control in the SAME fixture: revive, and the identical harvest
    // starts. Dead-ness was the operative cause, not a broken premise
    // (wrong tool, wrong zone, spent timer) that would deny anybody.
    p.dead = false;
    p.hp = p.maxHp;
    expect(sim.harvestNode(MIREFEN_T2, undefined, pid)).toBe(true);
  });
});

describe('harvest denies in combat and while swimming (the startFishing pair)', () => {
  const MIREFEN_T2 = 'ore_mirefen_t2';

  it('in combat: exact literal, zero draws, timer untouched, then the live control grants', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prospector');
    sim.addItem('iron_mining_pick', 1, pid);
    // The tier-2 pick must wield (R22), so the live control below really is
    // combat lifting and not a tool the player could never swing.
    mustMeta(sim, pid).gatheringProficiency.mining = TIER2_TOOL_WIELD_PROFICIENCY;
    teleportOntoNode(sim, pid, MIREFEN_T2);
    const p = mustEntity(sim, pid);
    p.inCombat = true;
    let draws = 0;
    (sim as any).rng.setObserver(() => draws++);
    sim.drainEvents();
    expect(sim.harvestNode(MIREFEN_T2, undefined, pid)).toBe(false);
    (sim as any).rng.setObserver(null);
    const ev = sim.drainEvents();
    expect(
      ev.some((e) => e.type === 'error' && e.text === "You can't do that while in combat."),
    ).toBe(true);
    expect(p.castingAbility).toBeNull();
    expect(draws).toBe(0);
    expect(sim.nodeHarvestableByMeFor(MIREFEN_T2, pid)).toBe(true);
    // Live control in the SAME fixture: combat was the operative cause.
    p.inCombat = false;
    expect(sim.harvestNode(MIREFEN_T2, undefined, pid)).toBe(true);
  });

  it('swimming: exact literal, zero draws, then the live control grants', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prospector');
    sim.addItem('copper_mining_pick', 1, pid);
    const p = mustEntity(sim, pid);
    // Vale lake center: deep water, the professions_fishing swim-deny spot.
    p.pos.x = -92;
    p.pos.z = 88;
    p.pos.y = terrainHeight(-92, 88, sim.cfg.seed);
    p.prevPos = { ...p.pos };
    expect(sim.ctx.isSwimming(p)).toBe(true);
    let draws = 0;
    (sim as any).rng.setObserver(() => draws++);
    sim.drainEvents();
    expect(sim.harvestNode(NODE_ID, undefined, pid)).toBe(false);
    (sim as any).rng.setObserver(null);
    const ev = sim.drainEvents();
    expect(
      ev.some((e) => e.type === 'error' && e.text === "You can't do that while swimming."),
    ).toBe(true);
    expect(p.castingAbility).toBeNull();
    expect(draws).toBe(0);
    // Live control: back on dry land at the node, the harvest starts.
    teleportOntoNode(sim, pid, NODE_ID);
    expect(sim.ctx.isSwimming(p)).toBe(false);
    expect(sim.harvestNode(NODE_ID, undefined, pid)).toBe(true);
  });

  it('a waterline stand denies from a swim-deep cast spot and grants from its dry footing', () => {
    // The pre-v0.32.0 shape of this fixture stood the player ON a node that
    // sat in swim-deep water (herb_eastbrook_1 at seed 42); the merged world
    // reshaped every shore this suite hunted, and no shipped node sits over
    // swim depth at any nearby seed now. The acceptance shape survives
    // inverted: wood_thornpeak_1 keeps a swim-deep pocket INSIDE
    // INTERACT_RANGE at seed 1, so casting from the water is denied while
    // the node's own dry footing grants. The node stays farmable, the swim
    // route does not.
    const WATERLINE = 'wood_thornpeak_1';
    const DEEP = { x: -61.3, z: 766.8 };
    const node = mustNode(WATERLINE);
    const sim = makeWorld(1);
    expect(
      groundHeight(DEEP.x, DEEP.z, sim.cfg.seed) < waterLevelAt(DEEP.x, DEEP.z) - PLAYER_SWIM_DEPTH,
    ).toBe(true);
    expect(Math.hypot(DEEP.x - node.pos.x, DEEP.z - node.pos.z)).toBeLessThanOrEqual(
      INTERACT_RANGE,
    );
    const pid = sim.addPlayer('warrior', 'Wader');
    sim.addItem('handaxe', 1, pid);
    const p = mustEntity(sim, pid);
    p.pos.x = DEEP.x;
    p.pos.z = DEEP.z;
    p.pos.y = terrainHeight(DEEP.x, DEEP.z, sim.cfg.seed);
    p.prevPos = { ...p.pos };
    expect(sim.ctx.isSwimming(p)).toBe(true);
    sim.drainEvents();
    expect(sim.harvestNode(WATERLINE, undefined, pid)).toBe(false);
    expect(
      sim
        .drainEvents()
        .some((e) => e.type === 'error' && e.text === "You can't do that while swimming."),
    ).toBe(true);
    // The node's own dry footing (teleportOntoNode) grants the same node.
    teleportOntoNode(sim, pid, WATERLINE);
    expect(sim.ctx.isSwimming(p)).toBe(false);
    expect(sim.harvestNode(WATERLINE, undefined, pid)).toBe(true);
  });
});

describe('harvest breaks stealth and action-locked forms refuse it', () => {
  it('an action-locked form refuses with the shapeshifted literal, zero draws, and shifting out grants', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Shifter');
    sim.addItem('copper_mining_pick', 1, pid);
    teleportOntoNode(sim, pid, NODE_ID);
    const p = mustEntity(sim, pid);
    p.auras.push({
      id: 'bear_form',
      name: 'Bruin Form',
      kind: 'form_bear',
      value: 0,
      remaining: 600,
      duration: 600,
      sourceId: pid,
      school: 'physical',
    } as Entity['auras'][number]);
    let draws = 0;
    (sim as any).rng.setObserver(() => draws++);
    sim.drainEvents();
    expect(sim.harvestNode(NODE_ID, undefined, pid)).toBe(false);
    (sim as any).rng.setObserver(null);
    const ev = sim.drainEvents();
    expect(
      ev.some((e) => e.type === 'error' && e.text === "You can't do that while shapeshifted."),
    ).toBe(true);
    expect(p.castingAbility).toBeNull();
    expect(draws).toBe(0);
    expect(sim.nodeHarvestableByMeFor(NODE_ID, pid)).toBe(true);
    // Shift out in the SAME fixture: the form was the operative cause.
    p.auras.splice(0, p.auras.length);
    expect(sim.harvestNode(NODE_ID, undefined, pid)).toBe(true);
  });

  it('starting a harvest breaks stealth at the cast START', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('rogue', 'Shade');
    const meta = mustMeta(sim, pid);
    (sim as any).grantXp(xpForLevel(1) + xpForLevel(2) + 10, meta); // level 3, knows stealth
    sim.castAbility('stealth', pid);
    const p = mustEntity(sim, pid);
    expect(p.auras.some((a) => a.kind === 'stealth')).toBe(true);
    sim.addItem('copper_mining_pick', 1, pid);
    teleportOntoNode(sim, pid, NODE_ID);
    sim.drainEvents();
    let draws = 0;
    (sim as any).rng.setObserver(() => draws++);
    expect(sim.harvestNode(NODE_ID, undefined, pid)).toBe(true);
    (sim as any).rng.setObserver(null);
    // Broken at cast START, before any completion: aura gone, cache cleared,
    // the aura-lost event emitted, and the start still draws nothing.
    expect(p.castingAbility).not.toBeNull();
    expect(p.auras.some((a) => a.kind === 'stealth')).toBe(false);
    expect(p.stealthed).toBe(false);
    expect(sim.drainEvents().some((e) => e.type === 'aura' && e.gained === false)).toBe(true);
    expect(draws).toBe(0);
  });

  it('a DENIED harvest never breaks stealth', () => {
    // Bare hands: the tool gate refuses, and the refusal must not reveal the
    // player (a denial has no side effects).
    const sim = makeWorld();
    const pid = sim.addPlayer('rogue', 'Shade');
    const meta = mustMeta(sim, pid);
    (sim as any).grantXp(xpForLevel(1) + xpForLevel(2) + 10, meta);
    sim.castAbility('stealth', pid);
    const p = mustEntity(sim, pid);
    expect(p.auras.some((a) => a.kind === 'stealth')).toBe(true);
    teleportOntoNode(sim, pid, NODE_ID);
    sim.drainEvents();
    expect(sim.harvestNode(NODE_ID, undefined, pid)).toBe(false);
    expect(p.auras.some((a) => a.kind === 'stealth')).toBe(true);
  });

  it('a prowling druid shape is refused and its stealth survives', () => {
    // Cat form plus stealth (Stalk): the form refusal fires FIRST and the
    // denial leaves the stealth untouched.
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prowler');
    sim.addItem('copper_mining_pick', 1, pid);
    teleportOntoNode(sim, pid, NODE_ID);
    const p = mustEntity(sim, pid);
    p.auras.push(
      {
        id: 'cat_form',
        name: 'Wolf Form',
        kind: 'form_cat',
        value: 0,
        remaining: 600,
        duration: 600,
        sourceId: pid,
        school: 'physical',
      } as Entity['auras'][number],
      {
        id: 'prowl',
        name: 'Stalk',
        kind: 'stealth',
        value: 0,
        remaining: 600,
        duration: 600,
        sourceId: pid,
        school: 'physical',
      } as Entity['auras'][number],
    );
    sim.drainEvents();
    expect(sim.harvestNode(NODE_ID, undefined, pid)).toBe(false);
    expect(
      sim
        .drainEvents()
        .some((e) => e.type === 'error' && e.text === "You can't do that while shapeshifted."),
    ).toBe(true);
    expect(p.auras.some((a) => a.kind === 'stealth')).toBe(true);
  });
});

// The countdown read of the per-player respawn timer (IWorldProfessions
// nodeRespawnSeconds, the UX pass): the read half of the same
// nodeHarvestReadyAt entry the harvest gate checks, so the two can never
// disagree about readiness.
describe('nodeRespawnSeconds (the tooltip countdown read)', () => {
  it('null when ready, the live remaining after a harvest, and null again once elapsed', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Miner');
    sim.addItem('copper_mining_pick', 1, pid);
    teleportOntoNode(sim, pid, NODE_ID);
    const node = mustNode(NODE_ID);
    const respawn = NODE_HARVEST_TABLE[node.type].respawnSeconds;

    expect(sim.nodeRespawnSecondsFor(NODE_ID, pid)).toBeNull();
    expect(castAndComplete(sim, NODE_ID, pid)).toBe(true);

    const remaining = sim.nodeRespawnSecondsFor(NODE_ID, pid);
    if (remaining === null) throw new Error('expected a live countdown after the harvest');
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(respawn);
    expect(sim.nodeHarvestableByMeFor(NODE_ID, pid)).toBe(false);

    sim.tick();
    const later = sim.nodeRespawnSecondsFor(NODE_ID, pid);
    if (later === null) throw new Error('one tick cannot drain a node respawn timer');
    expect(later).toBeLessThan(remaining);

    // Elapse the timer the way the D6 freeze/restore tests do (writing the
    // same field the gate reads) rather than ticking out minutes of world.
    mustMeta(sim, pid).nodeHarvestReadyAt[NODE_ID] = sim.time;
    expect(sim.nodeRespawnSecondsFor(NODE_ID, pid)).toBeNull();
    expect(sim.nodeHarvestableByMeFor(NODE_ID, pid)).toBe(true);
  });

  it('null for an unknown node id and for an unknown pid', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Miner');
    expect(sim.nodeRespawnSecondsFor('no_such_node', pid)).toBeNull();
    expect(sim.nodeRespawnSecondsFor(NODE_ID, 999999)).toBeNull();
  });
});
