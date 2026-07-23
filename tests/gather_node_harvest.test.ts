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
import { ClientWorld } from '../src/net/online';
import { bagCapacity } from '../src/sim/bags';
import { GATHER_NODES, ITEMS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { completeFishing } from '../src/sim/professions/fishing';
import {
  MATERIAL_RARITY_MAX_PROFICIENCY,
  NODE_HARVEST_TABLE,
  nodeMaterialFor,
} from '../src/sim/professions/gathering';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

function mustMeta(sim: Sim, pid: number) {
  const meta = sim.players.get(pid);
  if (!meta) throw new Error(`missing player meta ${pid}`);
  return meta;
}

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
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

// Teleports a player entity onto a node's exact (x, z) so the distance check
// always passes; matches the teleportTo helper convention in sim.test.ts.
function teleportOntoNode(sim: Sim, pid: number, nodeId: string) {
  const node = GATHER_NODES.find((n) => n.id === nodeId);
  if (!node) throw new Error(`missing node ${nodeId}`);
  const p = mustEntity(sim, pid);
  p.pos.x = node.pos.x;
  p.pos.z = node.pos.z;
  p.pos.y = terrainHeight(node.pos.x, node.pos.z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
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

function castAndComplete(sim: Sim, nodeId: string, pid: number): boolean {
  despawnMobs(sim);
  if (!sim.harvestNode(nodeId, pid)) return false;
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
    const p = mustEntity(sim, pid);
    p.pos.x = -9999;
    p.pos.z = -9999;
    p.pos.y = terrainHeight(p.pos.x, p.pos.z, sim.cfg.seed);
    p.prevPos = { ...p.pos };

    const node = mustNode(NODE_ID);
    const entry = NODE_HARVEST_TABLE[node.type];
    const before = sim.countItem(NODE_MATERIAL.itemId, pid);
    expect(sim.harvestNode(NODE_ID, pid)).toBe(false);
    sim.tick();
    expect(sim.countItem(NODE_MATERIAL.itemId, pid)).toBe(before);
  });

  it("two players harvesting the same node each get their own respawn timer: A's harvest never blocks B", () => {
    const sim = makeWorld();
    const pidA = sim.addPlayer('warrior', 'PlayerA');
    const pidB = sim.addPlayer('warrior', 'PlayerB');
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
    teleportOntoNode(sim, pid, NODE_ID);
    const node = mustNode(NODE_ID);
    const entry = NODE_HARVEST_TABLE[node.type];

    expect(castAndComplete(sim, NODE_ID, pid)).toBe(true);
    expect(sim.countItem(NODE_MATERIAL.itemId, pid)).toBe(1);

    // Immediately harvesting again is denied: this player's own timer has not
    // elapsed yet (the deny fires at cast START; no cast ever begins).
    expect(sim.harvestNode(NODE_ID, pid)).toBe(false);
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
    expect(sim.harvestNode('not_a_real_node', pid)).toBe(false);
    sim.tick();
    expect(sim.nodeHarvestableByMeFor('not_a_real_node', pid)).toBe(false);
  });

  it('a harvest grants the matching gathering profession one point of skill', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Skiller');
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
    teleportOntoNode(sim, pid, NODE_ID);
    const meta = mustMeta(sim, pid);
    const before = meta.xp;

    expect(castAndComplete(sim, NODE_ID, pid)).toBe(true);

    expect(meta.xp).toBeGreaterThan(before);
  });

  it('a harvest of a node far below a high-level player grants zero XP (gray band)', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'MaxLevelMiner');
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
    teleportOntoNode(sim, pid, NODE_ID);
    const p = mustEntity(sim, pid);
    p.dead = true;

    const node = mustNode(NODE_ID);
    const entry = NODE_HARVEST_TABLE[node.type];
    const before = sim.countItem(NODE_MATERIAL.itemId, pid);
    sim.harvestNode(NODE_ID, pid);
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

    // Fill every bag slot with non-stacking instanced junk so canAddItem
    // denies regardless of the harvested item's own stack state (an
    // instanced slot, unlike a plain stack, never merges further adds).
    const meta = mustMeta(sim, pid);
    const capacity = bagCapacity(meta.bags);
    meta.inventory.length = 0;
    for (let i = 0; i < capacity; i++) {
      meta.inventory.push({ itemId: 'bone_fragments', count: 1, instance: { boundTo: pid } });
    }
    expect(sim.canAddItem(NODE_MATERIAL.itemId, 1, pid)).toBe(false);

    sim.harvestNode(NODE_ID, pid);
    sim.tick();
    expect(sim.nodeHarvestableByMeFor(NODE_ID, pid)).toBe(true);
  });

  it('spends exactly two rng draws on a granted harvest and none on any denial path', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'DrawCount');
    const fullBagsPid = sim.addPlayer('warrior', 'DrawCountFull');
    teleportOntoNode(sim, pid, NODE_ID);
    teleportOntoNode(sim, fullBagsPid, NODE_ID);
    const node = mustNode(NODE_ID);
    const entry = NODE_HARVEST_TABLE[node.type];

    // Stuff the second player's bags up front so the bags-full branch below
    // stays reachable while their own per-player node timer is still fresh
    // (the readiness check sits before the capacity check).
    const fullMeta = mustMeta(sim, fullBagsPid);
    fullMeta.inventory.length = 0;
    for (let i = 0; i < bagCapacity(fullMeta.bags); i++) {
      fullMeta.inventory.push({
        itemId: 'bone_fragments',
        count: 1,
        instance: { boundTo: fullBagsPid },
      });
    }
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

    sim.harvestNode(NODE_ID, pid); // granted: the cast starts, draw-free
    expect(draws).toBe(0);
    completeCastNow(sim, pid); // completion: the rarity draw plus the rare-event draw
    expect(draws).toBe(2);

    draws = 0;
    sim.harvestNode(NODE_ID, pid); // denied: not respawned for this player yet
    expect(draws).toBe(0);
    sim.harvestNode('no_such_node_id', pid); // denied: unknown node
    expect(draws).toBe(0);
    sim.harvestNode(NODE_ID, fullBagsPid); // denied: bags full
    expect(draws).toBe(0);
    const p = mustEntity(sim, pid);
    p.pos.x = node.pos.x + 100;
    p.prevPos = { ...p.pos };
    sim.harvestNode(NODE_ID, pid); // denied: too far away
    expect(draws).toBe(0);
    p.dead = true;
    sim.harvestNode(NODE_ID, pid); // denied: dead, the first guard in the chain
    expect(draws).toBe(0);
  });
});

describe('gather-completion event for audio (#1729)', () => {
  it('a granted harvest emits a personal gatherResult carrying node/profession/item/rarity', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Harvester');
    teleportOntoNode(sim, pid, NODE_ID);
    const node = mustNode(NODE_ID);
    const entry = NODE_HARVEST_TABLE[node.type];

    sim.drainEvents();
    sim.harvestNode(NODE_ID, pid);
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
    teleportOntoNode(sim, pid, NODE_ID);
    const node = mustNode(NODE_ID);
    const entry = NODE_HARVEST_TABLE[node.type];
    const meta = mustMeta(sim, pid);
    // At max proficiency the rarity ladder puts ZERO weight on common, so the
    // emitted rarity must be one of the four higher tiers. This proves the event
    // carries the value actually rolled, not a hard-coded 'common'.
    meta.gatheringProficiency[entry.professionId] = MATERIAL_RARITY_MAX_PROFICIENCY;

    sim.drainEvents();
    sim.harvestNode(NODE_ID, pid);
    completeCastNow(sim, pid);
    const gather = sim.drainEvents().find((e) => e.type === 'gatherResult');
    if (gather?.type !== 'gatherResult') throw new Error('expected a gatherResult event');
    expect(gather.rarity).not.toBe('common');
    expect(['uncommon', 'rare', 'epic', 'legendary']).toContain(gather.rarity);
  });

  it('no gatherResult is emitted on any denial path (too far, dead, unknown node)', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Denied');
    const p = mustEntity(sim, pid);
    // Too far from any node.
    p.pos.x = -9999;
    p.pos.z = -9999;
    p.pos.y = terrainHeight(p.pos.x, p.pos.z, sim.cfg.seed);
    p.prevPos = { ...p.pos };
    sim.drainEvents();
    sim.harvestNode(NODE_ID, pid);
    expect(sim.drainEvents().some((e) => e.type === 'gatherResult')).toBe(false);

    // Dead player standing on the node.
    teleportOntoNode(sim, pid, NODE_ID);
    p.dead = true;
    sim.drainEvents();
    sim.harvestNode(NODE_ID, pid);
    expect(sim.drainEvents().some((e) => e.type === 'gatherResult')).toBe(false);

    // Unknown node id.
    p.dead = false;
    sim.drainEvents();
    sim.harvestNode('not_a_real_node', pid);
    expect(sim.drainEvents().some((e) => e.type === 'gatherResult')).toBe(false);
  });

  it('the gatherResult event is deterministic across runs (same seed, same harvest)', () => {
    const run = () => {
      const sim = makeWorld();
      const pid = sim.addPlayer('warrior', 'Det');
      teleportOntoNode(sim, pid, NODE_ID);
      sim.drainEvents();
      sim.harvestNode(NODE_ID, pid);
      completeCastNow(sim, pid);
      return sim.drainEvents().find((e) => e.type === 'gatherResult');
    };
    expect(run()).toEqual(run());
  });
});

// The prime directive: every node def that shipped BEFORE the tool
// tier ramp keeps tier 1 and stays harvestable with no tool at all. The id
// list is LITERAL, never derived from GATHER_NODES (the FIELD_RECIPES
// tautology lesson): a future tier edit on any shipped node reds this pin
// decisively instead of silently re-deriving.
describe('lockout prevention: pre-phase nodes stay bare-hands harvestable', () => {
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

  it('all 24 pre-phase defs carry tier 1 and a bare-hands player harvests every one', () => {
    expect(PRE_PHASE_NODE_IDS).toHaveLength(24);
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'BareHands');
    const meta = mustMeta(sim, pid);
    // Genuinely bare-handed: the starting kit carries no gathering tool.
    expect(meta.inventory.some((s) => ITEMS[s.itemId]?.use?.type === 'gatherTool')).toBe(false);
    for (const id of PRE_PHASE_NODE_IDS) {
      expect(mustNode(id).tier, id).toBe(1);
      teleportOntoNode(sim, pid, id);
      sim.drainEvents();
      expect(sim.harvestNode(id, pid), id).toBe(true);
      expect(
        sim.drainEvents().some((e) => e.type === 'gatherDenied'),
        id,
      ).toBe(false);
      // A successful interaction STARTS a cast; drop it so the
      // next node's attempt is not denied as busy (this lockout pin is about
      // access, not grants).
      const p = mustEntity(sim, pid);
      p.castingAbility = null;
      p.castRemaining = 0;
      p.gatherCastNodeId = '';
    }
  });

  it('the ramp is purely additive: only the NEW _t2/_t3 veins carry tier 2 or higher', () => {
    const gated = GATHER_NODES.filter((n) => n.tier > 1)
      .map((n) => n.id)
      .sort();
    expect(gated).toEqual([
      'herb_mirefen_t2',
      'herb_thornpeak_t2',
      'herb_thornpeak_t3',
      'ore_mirefen_t2',
      'ore_thornpeak_t2',
      'ore_thornpeak_t3',
      'wood_mirefen_t2',
      'wood_thornpeak_t2',
      'wood_thornpeak_t3',
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
    expect(sim.harvestNode(T2, pid)).toBe(true);
    // Complete the cast: the respawn timer is consumed at completion
    // (inside resolveHarvest), never at the cast start.
    completeCastNow(sim, pid);
    // Drop the pick: the second attempt is both cooling AND tool-short.
    const meta = mustMeta(sim, pid);
    meta.inventory = meta.inventory.filter((s) => s.itemId !== 'iron_mining_pick');
    sim.drainEvents();
    expect(sim.harvestNode(T2, pid)).toBe(false);
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
    expect(sim.harvestNode(T2, pid)).toBe(false);
    const ev = sim.drainEvents();
    expect(ev.some((e) => e.type === 'gatherDenied')).toBe(true);
    expect(ev.some((e) => e.type === 'error' && e.text === 'Your bags are full.')).toBe(false);
  });

  it('a tier-1 harvest takes the untouched hot path: no gatherDenied, exactly the two pinned draws', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'HotPath');
    teleportOntoNode(sim, pid, NODE_ID);
    sim.drainEvents();
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      expect(sim.harvestNode(NODE_ID, pid)).toBe(true);
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
      sim.harvestNode('ore_mirefen_t2', pid); // denied: bare hands at a tier-2 vein
      sim.addItem('iron_mining_pick', 1, pid);
      sim.harvestNode('ore_mirefen_t2', pid); // granted: the cast starts
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

// A ClientWorld without the WebSocket plumbing, to drive applySnapshot
// directly (the bareClient idiom from tests/snapshots.test.ts).
function bareClient(pid: number): ClientWorld {
  const c: any = Object.create(ClientWorld.prototype);
  c.cfg = { seed: 20061, playerClass: 'warrior' };
  c.entities = new Map();
  c.playerId = pid;
  c.ownPlayerId = pid;
  c.ownPlayerClass = 'warrior';
  c.spectating = null;
  c.cupInfo = null;
  c.sportRole = null;
  c.moveInput = {};
  c.inventory = [];
  c.vendorBuyback = [];
  c.equipment = {};
  c.accountCosmetics = { completedQuestIds: [], mechChromaIds: [] };
  c.copper = 0;
  c.honor = 0;
  c.lifetimeHonor = 0;
  c.xp = 0;
  c.known = [];
  c.questLog = new Map();
  c.questsDone = new Set();
  c.pendingQuestCommands = new Map();
  c.partyInfo = null;
  c.selectedDungeonDifficulty = 'normal';
  c.tradeInfo = null;
  c.duelInfo = null;
  c.lastSnapAt = 0;
  c.snapInterval = 50;
  c.serverTickHz = null;
  c.missingSince = new Map();
  c.pendingFacingDelta = 0;
  c.connected = true;
  c.eventQueue = [];
  c.mouselookFacing = null;
  c.lastInputSentAt = 0;
  c.lastInputSig = '';
  c.inputSeq = 0;
  c.pendingInputSeqSentAt = new Map();
  c.ackedInputSeq = 0;
  c.inputEchoSamples = [];
  c.spectateFacingPending = false;
  c.pendingSpectateFacing = null;
  c.nodeCooldowns = new Map();
  return c;
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
    expect(server.sim.harvestNode('ore_mirefen_t2', sa.pid)).toBe(false);
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
    expect(server.sim.harvestNode('ore_mirefen_t2', sa.pid)).toBe(true);
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
});
