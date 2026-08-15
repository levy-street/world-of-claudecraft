// Gathering-tool item use (#2343): clicking a pick/axe/sickle works the
// nearest matching node like an interact press. Drives the sim command body
// (useGatherToolItem via Sim.useItem) end to end on a real Sim, plus the
// pure client helpers in src/game/gather_tool_use.ts that main.ts's bag-click
// hook composes (gatherToolProfessionFor / nearestGatherNodeForProfession).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  gatherToolProfessionFor,
  nearestGatherNodeForProfession,
} from '../src/game/gather_tool_use';
import { GATHER_NODES, ITEMS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { GATHER_CAST_ID } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function mustEntity(sim: Sim, pid: number) {
  const entity = sim.entities.get(pid);
  if (!entity) throw new Error(`missing entity ${pid}`);
  return entity;
}

function mustNode(nodeId: string) {
  const node = GATHER_NODES.find((n) => n.id === nodeId);
  if (!node) throw new Error(`missing node ${nodeId}`);
  return node;
}

function teleportOntoNode(sim: Sim, pid: number, nodeId: string) {
  const node = mustNode(nodeId);
  const p = mustEntity(sim, pid);
  p.pos.x = node.pos.x;
  p.pos.z = node.pos.z;
  p.pos.y = terrainHeight(node.pos.x, node.pos.z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

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

// The completeCastNow idiom from tests/gather_node_harvest.test.ts: resolve a
// running gather cast synchronously with zero world ticks in between.
function completeCastNow(sim: Sim, pid: number) {
  const p = mustEntity(sim, pid);
  const meta = sim.players.get(pid);
  if (!meta) throw new Error(`missing player meta ${pid}`);
  p.castingAbility = null;
  p.castRemaining = 0;
  sim.ctx.completeGatherCast(p, meta);
}

describe('useGatherToolItem via Sim.useItem (the sim command body)', () => {
  it('using a pick beside a ready vein starts the standard gather cast, draw-free', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prospector');
    teleportOntoNode(sim, pid, 'ore_eastbrook_1');
    sim.addItem('copper_mining_pick', 1, pid);
    despawnMobs(sim);
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      sim.useItem('copper_mining_pick', pid);
    } finally {
      sim.rng.setObserver(null);
    }
    const p = mustEntity(sim, pid);
    expect(p.castingAbility).toBe(GATHER_CAST_ID);
    expect(p.castTotal).toBe(2.5); // a tier-1 pick at a tier-1 vein: base cast
    expect(p.gatherCastNodeId).toBe('ore_eastbrook_1');
    expect(draws).toBe(0); // draws happen at completion, never at the click
  });

  it('prefers a ready node over a nearer one still respawning for this player', () => {
    // ore_eastbrook_1 (-70,-53) and ore_eastbrook_2 (-73,-49) sit exactly
    // 5yd apart, so standing ON node 1 keeps node 2 at INTERACT_RANGE
    // (inclusive). Harvest node 1, then click the pick again from the same
    // spot: the respawning node 1 is nearer, the ready node 2 must win.
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prospector');
    teleportOntoNode(sim, pid, 'ore_eastbrook_1');
    sim.addItem('copper_mining_pick', 1, pid);
    despawnMobs(sim);
    sim.useItem('copper_mining_pick', pid);
    completeCastNow(sim, pid);
    expect(sim.nodeHarvestableByMeFor('ore_eastbrook_1', pid)).toBe(false);
    sim.useItem('copper_mining_pick', pid);
    const p = mustEntity(sim, pid);
    expect(p.castingAbility).toBe(GATHER_CAST_ID);
    expect(p.gatherCastNodeId).toBe('ore_eastbrook_2');
  });

  it('no matching node in reach: one text-free gatherToolNoNode, no cast, zero draws, item kept', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prospector');
    sim.addItem('copper_mining_pick', 1, pid);
    sim.drainEvents();
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      sim.useItem('copper_mining_pick', pid);
    } finally {
      sim.rng.setObserver(null);
    }
    const events = sim.drainEvents().filter((ev) => ev.type === 'gatherToolNoNode');
    expect(events).toEqual([{ type: 'gatherToolNoNode', pid, professionId: 'mining' }]);
    expect(mustEntity(sim, pid).castingAbility).toBeNull();
    expect(sim.countItem('copper_mining_pick', pid)).toBe(1);
    expect(draws).toBe(0);
  });

  it('a wrong-profession tool beside a vein reports no timber in reach, never a harvest', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prospector');
    teleportOntoNode(sim, pid, 'ore_eastbrook_1');
    sim.addItem('handaxe', 1, pid);
    despawnMobs(sim);
    sim.drainEvents();
    sim.useItem('handaxe', pid);
    const events = sim.drainEvents().filter((ev) => ev.type === 'gatherToolNoNode');
    expect(events).toEqual([{ type: 'gatherToolNoNode', pid, professionId: 'logging' }]);
    expect(mustEntity(sim, pid).castingAbility).toBeNull();
  });

  it('a dead player gets the harvest gate answer, not a scan result', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prospector');
    teleportOntoNode(sim, pid, 'ore_eastbrook_1');
    sim.addItem('copper_mining_pick', 1, pid);
    despawnMobs(sim);
    mustEntity(sim, pid).dead = true;
    sim.drainEvents();
    sim.useItem('copper_mining_pick', pid);
    const events = sim.drainEvents();
    expect(
      events.some((ev) => ev.type === 'error' && ev.text === "You can't do that while dead."),
    ).toBe(true);
    expect(events.some((ev) => ev.type === 'gatherToolNoNode')).toBe(false);
  });

  it('re-clicking the pick mid-cast answers busy and keeps the running cast', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Prospector');
    teleportOntoNode(sim, pid, 'ore_eastbrook_1');
    sim.addItem('copper_mining_pick', 1, pid);
    despawnMobs(sim);
    sim.useItem('copper_mining_pick', pid);
    const p = mustEntity(sim, pid);
    expect(p.castingAbility).toBe(GATHER_CAST_ID);
    const before = p.castRemaining;
    sim.drainEvents();
    sim.useItem('copper_mining_pick', pid);
    expect(sim.drainEvents().some((ev) => ev.type === 'error' && ev.text === 'You are busy.')).toBe(
      true,
    );
    expect(p.castingAbility).toBe(GATHER_CAST_ID);
    expect(p.castRemaining).toBe(before);
  });
});

describe('client wiring source pins (the tests/client_shell.test.ts idiom)', () => {
  // Whole-line // comments only (the repo's raw-source pin idiom): a block
  // strip would misfire on /* sequences inside string and regex literals.
  const stripComments = (src: string) => src.replace(/^\s*\/\/.*$/gm, '');

  it('main.ts wires the hook through the interact machinery and the autorun stop', () => {
    const src = stripComments(readFileSync(path.join(__dirname, '../src/main.ts'), 'utf8'));
    const start = src.indexOf('hud.setGatherToolUseHook(');
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, start + 1200);
    // The no-node arm surfaces the localized toast and still consumes the click.
    expect(block).toContain('gatherToolNoNodeKey(professionId)');
    // The node arm rides the SAME interact plumbing as the F key and the node
    // click: handleGatherNodeInteract wrapped in the #1982 autorun stop.
    expect(block).toContain('stopAutorunForInteraction(');
    expect(block).toContain('handleGatherNodeInteract(');
    expect(block).toContain('gatherNodeToolGateFor(world, node)');
    // The R40 gate rides the bag-tool hook too (the phase 14 QA found only
    // the interact-key site pinned): a rod or pick used from bags reaches
    // the same confirm flow as the F key and the click.
    expect(block).toContain('gatherEffectConfirm');
  });

  it('the hud hotbar press tries the hook first and falls back to plain useItem', () => {
    const src = stripComments(readFileSync(path.join(__dirname, '../src/ui/hud.ts'), 'utf8'));
    expect(src).toContain('if (!this.tryGatherToolUse(action.id)) this.sim.useItem(action.id);');
  });
});

describe('gatherToolProfessionFor (the client hook item filter)', () => {
  it('resolves the three node professions and declines everything else', () => {
    expect(gatherToolProfessionFor(ITEMS.copper_mining_pick)).toBe('mining');
    expect(gatherToolProfessionFor(ITEMS.felling_axe)).toBe('logging');
    expect(gatherToolProfessionFor(ITEMS.gathering_sickle)).toBe('herbalism');
    // Fishing implements fall back to the plain useItem path (startFishing).
    expect(gatherToolProfessionFor(ITEMS.ironreel_fishing_rod)).toBeNull();
    expect(gatherToolProfessionFor(ITEMS.simple_fishing_pole)).toBeNull();
    // A non-tool item never routes here.
    expect(gatherToolProfessionFor(ITEMS.copper_ore)).toBeNull();
  });
});

describe('nearestGatherNodeForProfession (the client hook node pick)', () => {
  const AT_NODE_1 = { x: -70, z: -53 }; // ore_eastbrook_1; node 2 is exactly 5yd away

  function fakeWorld(pos: { x: number; z: number }, readyIds: (id: string) => boolean) {
    return {
      player: { pos: { x: pos.x, y: 0, z: pos.z } },
      nodeHarvestableByMe: readyIds,
    } as Parameters<typeof nearestGatherNodeForProfession>[0];
  }

  it('picks the nearest matching node when everything is ready', () => {
    const world = fakeWorld(AT_NODE_1, () => true);
    expect(nearestGatherNodeForProfession(world, 'mining')?.id).toBe('ore_eastbrook_1');
  });

  it('prefers a ready node over a nearer respawning one', () => {
    const world = fakeWorld(AT_NODE_1, (id) => id !== 'ore_eastbrook_1');
    expect(nearestGatherNodeForProfession(world, 'mining')?.id).toBe('ore_eastbrook_2');
  });

  it('falls back to the nearest respawning node when nothing is ready', () => {
    const world = fakeWorld(AT_NODE_1, () => false);
    expect(nearestGatherNodeForProfession(world, 'mining')?.id).toBe('ore_eastbrook_1');
  });

  it('returns null out of range and for professions with no matching node type', () => {
    expect(
      nearestGatherNodeForProfession(
        fakeWorld({ x: 2, z: -2 }, () => true),
        'mining',
      ),
    ).toBe(null);
    expect(
      nearestGatherNodeForProfession(
        fakeWorld(AT_NODE_1, () => true),
        'herbalism',
      ),
    ).toBe(null);
    expect(
      nearestGatherNodeForProfession(
        fakeWorld(AT_NODE_1, () => true),
        'fishing',
      ),
    ).toBe(null);
  });
});
