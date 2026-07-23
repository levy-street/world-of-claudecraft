// Professions 2.0 (Gathering rhythm): the cross-cutting pins the
// phase file's tests deliverable names beyond the re-pinned appendix set.
// The bite-delay draw-and-bounds contract, the rod synergy on both the delay
// ceiling and the reel window, the reel deadline boundary, the hidden-state
// wire invariant (no broadcast field carries bite information), the gather
// cast duration formula and its live castTotal binding, the completion
// re-validation arms, the free move-cancel, the same-seed determinism of the
// whole rhythm loop, the silence/lockout/interrupt exemptions with their
// demon-heal fold byte-identity arms, and damage-cancels-not-pushback.
import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed for the wire-invariant suite
// (the corpse_harvest_sim.test.ts idiom); the offline suites never touch it.
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
import { cancelCast, updateCasting } from '../src/sim/combat/casting_lifecycle';
import { runEffects } from '../src/sim/combat/effect_dispatch';
import { GATHER_NODES } from '../src/sim/content/gather_nodes';
import { ABILITIES, LAKE, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import {
  FISH_BITE_DELAY_MAX_SEC,
  FISH_BITE_DELAY_MIN_SEC,
  startFishing,
} from '../src/sim/professions/fishing';
import {
  drainGatheringGrants,
  gatherCastDurationSec,
  nodeMaterialFor,
} from '../src/sim/professions/gathering';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import { readyArenaFighter } from '../src/sim/social/arena';
import { fiestaDownEntity } from '../src/sim/social/fiesta';
import {
  type Aura,
  DEMON_HEAL_CAST_ID,
  DT,
  type Entity,
  FISHING_CAST_ID,
  GATHER_CAST_ID,
} from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const NODE = GATHER_NODES[0]; // ore_eastbrook_1, tier 1
const NODE_MATERIAL = nodeMaterialFor(NODE.type, NODE.zoneId);

function makeSim(seed = 4242): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true });
}

function teleportTo(sim: Sim, x: number, z: number): void {
  const p = sim.player;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = terrainHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

function teleportToValeShore(sim: Sim): void {
  const pz = LAKE.z - LAKE.radius - 2;
  teleportTo(sim, LAKE.x, pz);
  sim.player.facing = Math.atan2(0, LAKE.z - pz);
}

function teleportOntoNode(sim: Sim, pid: number, nodeId: string): void {
  const node = GATHER_NODES.find((n) => n.id === nodeId);
  if (!node) throw new Error(`missing node ${nodeId}`);
  const p = sim.entities.get(pid);
  if (!p) throw new Error(`missing entity ${pid}`);
  p.pos.x = node.pos.x;
  p.pos.z = node.pos.z;
  p.pos.y = terrainHeight(node.pos.x, node.pos.z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

// Mob damage cancels both non-spell casts; drives that tick the live world
// silence the mobs first (the sim.test.ts despawnMobs idiom).
function despawnMobs(sim: Sim): void {
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

// Mirrors the lifecycle completion arm synchronously (clear the cast fields,
// then route), so completion-denial pins can count draws with no world noise.
function completeCastNow(sim: Sim, pid: number): void {
  const p = sim.entities.get(pid);
  const meta = sim.players.get(pid);
  if (!p || !meta) throw new Error('missing player');
  p.castingAbility = null;
  p.castRemaining = 0;
  sim.ctx.completeGatherCast(p, meta);
}

const mustMeta = (sim: Sim, pid: number): PlayerMeta => {
  const meta = sim.players.get(pid);
  if (!meta) throw new Error('missing meta');
  return meta;
};

describe('bite delay draw contract and rod-tiered bounds', () => {
  // Delay ticks = ceil(delaySec / DT), delaySec in [MIN, effMax): tier 1
  // covers [60, 160] ticks, the tier-3 rod pulls effMax from 8 to 5 s, so
  // [60, 100]; MIN never moves. Sampled over 40 seeded casts per arm.
  function delays(rod: string | null, n: number): number[] {
    const sim = makeSim(4242);
    const meta = mustMeta(sim, sim.playerId);
    if (rod) sim.addItem(rod, 1);
    teleportToValeShore(sim);
    const out: number[] = [];
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      for (let i = 0; i < n; i++) {
        const p = sim.player;
        const before = draws;
        startFishing(sim.ctx, p, meta);
        expect(draws - before).toBe(1); // exactly one draw per cast start
        out.push(p.fishBiteAtTick - sim.tickCount);
        p.castingAbility = null; // cancel-and-recast between samples
        p.castRemaining = 0;
        p.fishBiteAtTick = 0;
      }
    } finally {
      sim.rng.setObserver(null);
    }
    return out;
  }

  it('bare hands: one draw per cast, every delay in [60, 160] ticks, and the tail above 100 is live', () => {
    expect(Math.ceil(FISH_BITE_DELAY_MIN_SEC / DT)).toBe(60);
    expect(Math.ceil(FISH_BITE_DELAY_MAX_SEC / DT)).toBe(160);
    const ticks = delays(null, 40);
    for (const t of ticks) {
      expect(t).toBeGreaterThanOrEqual(60);
      expect(t).toBeLessThanOrEqual(160);
    }
    // The upper half of the tier-1 range actually occurs, so the tier-3
    // ceiling below is a real shrink, not a vacuous bound.
    expect(ticks.some((t) => t > 100)).toBe(true);
  });

  it('the tier-3 rod shrinks the ceiling to 100 ticks and never moves the floor', () => {
    const ticks = delays('silverstream_fishing_rod', 40);
    for (const t of ticks) {
      expect(t).toBeGreaterThanOrEqual(60);
      expect(t).toBeLessThanOrEqual(100);
    }
  });

  it('the reel window arms at bite time with the rod-widened width', () => {
    for (const [rod, windowTicks] of [
      [null, 60],
      ['ironreel_fishing_rod', 75],
      ['silverstream_fishing_rod', 90],
    ] as [string | null, number][]) {
      const sim = makeSim(4242);
      const meta = mustMeta(sim, sim.playerId);
      if (rod) sim.addItem(rod, 1);
      teleportToValeShore(sim);
      const p = sim.player;
      startFishing(sim.ctx, p, meta);
      sim.tickCount = p.fishBiteAtTick;
      updateCasting(sim.ctx, p, meta);
      expect(p.fishBiteAtTick).toBe(0);
      expect(p.fishReelDeadlineTick - sim.tickCount, rod ?? 'bare').toBe(windowTicks);
    }
  });
});

describe('reel deadline boundary', () => {
  it('a re-press at exactly the deadline tick lands the catch (and pre-bite re-press stays busy)', () => {
    const sim = makeSim(4242);
    const meta = mustMeta(sim, sim.playerId);
    teleportToValeShore(sim);
    const p = sim.player;
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      startFishing(sim.ctx, p, meta);
      // Pre-bite re-press: the reel window is not armed, so the busy error
      // holds and the session continues.
      sim.events = [];
      startFishing(sim.ctx, p, meta);
      expect(sim.events).toContainEqual(
        expect.objectContaining({ type: 'error', text: 'You are busy.' }),
      );
      expect(p.castingAbility).toBe(FISHING_CAST_ID);
      sim.tickCount = p.fishBiteAtTick;
      updateCasting(sim.ctx, p, meta); // the bite
      sim.tickCount = p.fishReelDeadlineTick; // the LAST valid reel tick
      sim.events = [];
      startFishing(sim.ctx, p, meta);
    } finally {
      sim.rng.setObserver(null);
    }
    expect(draws).toBe(2); // delay + the landed table draw
    expect(p.castingAbility).toBe(null);
    expect(sim.events).toContainEqual(expect.objectContaining({ type: 'castStop', success: true }));
  });

  it('one tick past the deadline the tick phase misses first; a re-press then starts a FRESH cast', () => {
    const sim = makeSim(4242);
    const meta = mustMeta(sim, sim.playerId);
    teleportToValeShore(sim);
    const p = sim.player;
    startFishing(sim.ctx, p, meta);
    sim.tickCount = p.fishBiteAtTick;
    updateCasting(sim.ctx, p, meta);
    // AT the deadline tick the window is still open: the tick phase must NOT
    // miss yet (kills a `>` -> `>=` regression in the miss comparison, which
    // would steal the last valid reel tick from the player).
    sim.tickCount = p.fishReelDeadlineTick;
    sim.events = [];
    updateCasting(sim.ctx, p, meta);
    expect(sim.events).not.toContainEqual(expect.objectContaining({ type: 'fishingGotAway' }));
    expect(p.castingAbility).toBe(FISHING_CAST_ID);
    expect(p.fishReelDeadlineTick).toBeGreaterThan(0);
    sim.tickCount = p.fishReelDeadlineTick + 1;
    sim.events = [];
    updateCasting(sim.ctx, p, meta); // the miss fires here, before any press
    expect(sim.events).toContainEqual({ type: 'fishingGotAway', pid: sim.playerId });
    expect(p.castingAbility).toBe(null);
    expect(p.fishReelDeadlineTick).toBe(0);
    // The very next press starts a fresh session, not a reel.
    sim.events = [];
    startFishing(sim.ctx, p, meta);
    expect(p.castingAbility).toBe(FISHING_CAST_ID);
    expect(p.fishBiteAtTick).toBeGreaterThan(sim.tickCount);
    expect(sim.events).toContainEqual(
      expect.objectContaining({ type: 'castStart', ability: FISHING_CAST_ID }),
    );
  });
});

describe('hidden-state wire invariant', () => {
  it('castRem/castTot are identical across sims whose drawn bite delays differ', () => {
    // The broadcast pair must carry ZERO bite information: two seeds that
    // draw different delays walk byte-identical castTotal/castRemaining
    // streams for the whole pre-miss window.
    const run = (seed: number) => {
      const sim = makeSim(seed);
      const meta = mustMeta(sim, sim.playerId);
      teleportToValeShore(sim);
      startFishing(sim.ctx, sim.player, meta);
      const delay = sim.player.fishBiteAtTick - sim.tickCount;
      const stream: [number, number][] = [];
      for (let i = 0; i < 115; i++) {
        sim.tickCount += 1;
        updateCasting(sim.ctx, sim.player, meta);
        stream.push([sim.player.castTotal, sim.player.castRemaining]);
      }
      return { delay, stream };
    };
    const a = run(4242);
    const b = run(777);
    expect(a.delay).not.toBe(b.delay); // genuinely different hidden delays
    expect(a.stream).toEqual(b.stream); // identical broadcastable fields
    expect(a.stream[0][0]).toBe(15);
    expect(a.stream[114][0]).toBe(15);
  });

  it('no wire snapshot carries fishBiteAtTick, fishReelDeadlineTick, or gatherCastNodeId', () => {
    interface FakeClient {
      sent: any[];
      ws: any;
    }
    const fakeWs = (): FakeClient => {
      const sent: any[] = [];
      return {
        sent,
        ws: { readyState: 1, send: (payload: string) => sent.push(payload) },
      };
    };
    const server = new GameServer();
    const fcA = fakeWs();
    const fcB = fakeWs();
    const join = (fc: FakeClient, id: number, name: string): ClientSession => {
      const session = server.join(fc.ws, id, id, name, 'warrior', null);
      if ('error' in session) throw new Error(session.error);
      session.blockListLoaded = true;
      return session;
    };
    const sa = join(fcA, 81, 'HiddenAngler');
    const sb = join(fcB, 82, 'HiddenGatherer');
    despawnMobs(server.sim);
    const angler = server.sim.entities.get(sa.pid);
    if (!angler) throw new Error('missing angler');
    server.sim.addItem('simple_fishing_pole', 1, sa.pid);
    // Probe a fishable shore spot with the real use_item dispatch.
    let started = false;
    for (let r = LAKE.radius * 0.7; r <= LAKE.radius * 1.8 && !started; r += 1) {
      for (let i = 0; i < 72 && !started; i++) {
        const a = (i / 72) * Math.PI * 2;
        const x = LAKE.x + Math.cos(a) * r;
        const z = LAKE.z + Math.sin(a) * r;
        angler.pos.x = x;
        angler.pos.z = z;
        angler.pos.y = terrainHeight(x, z, server.sim.cfg.seed);
        angler.prevPos = { ...angler.pos };
        angler.facing = Math.atan2(LAKE.x - x, LAKE.z - z);
        server.sim.useItem('simple_fishing_pole', sa.pid);
        started = angler.castingAbility === FISHING_CAST_ID;
      }
    }
    expect(started).toBe(true);
    // Second session mid-GATHER-cast, so gatherCastNodeId is live too.
    const gatherer = server.sim.entities.get(sb.pid);
    if (!gatherer) throw new Error('missing gatherer');
    gatherer.pos.x = NODE.pos.x;
    gatherer.pos.z = NODE.pos.z;
    gatherer.pos.y = terrainHeight(NODE.pos.x, NODE.pos.z, server.sim.cfg.seed);
    gatherer.prevPos = { ...gatherer.pos };
    expect(server.sim.harvestNode(NODE.id, sb.pid)).toBe(true);
    server.sim.tick(); // both casts mid-flight
    // The hidden fields ARE nonzero right now, so an accidental broadcast
    // would be visible in this exact snapshot.
    expect(angler.fishBiteAtTick).toBeGreaterThan(0);
    expect(gatherer.gatherCastNodeId).toBe(NODE.id);
    (server as any).broadcastSnapshots();
    const payload = fcA.sent.join('\n') + fcB.sent.join('\n');
    // Sanity: we are scanning real snapshot payloads with live cast fields.
    expect(payload).toContain('castRem');
    expect(payload.includes('fishBiteAtTick')).toBe(false);
    expect(payload.includes('fishReelDeadlineTick')).toBe(false);
    expect(payload.includes('gatherCastNodeId')).toBe(false);
    // Second scan AFTER the bite fires, so the reel deadline is provably
    // NONZERO at snapshot time too (the review coverage pass: a value-gated
    // leak that serialized the deadline only while armed would have slipped
    // the first scan, where it was still 0).
    const biteTick = angler.fishBiteAtTick;
    while (server.sim.tickCount <= biteTick) server.sim.tick();
    expect(angler.fishReelDeadlineTick).toBeGreaterThan(0);
    fcA.sent.length = 0;
    fcB.sent.length = 0;
    (server as any).broadcastSnapshots();
    const biterPayload = fcA.sent.join('\n') + fcB.sent.join('\n');
    expect(biterPayload).toContain('castRem');
    expect(biterPayload.includes('fishBiteAtTick')).toBe(false);
    expect(biterPayload.includes('fishReelDeadlineTick')).toBe(false);
    expect(biterPayload.includes('gatherCastNodeId')).toBe(false);
  });
});

describe('gather cast duration', () => {
  it('gatherCastDurationSec: tool-above-tier and band reductions, floored, never above base', () => {
    expect(gatherCastDurationSec(1, 1, 0)).toBe(2.5);
    // Owning exactly the required tier buys nothing.
    expect(gatherCastDurationSec(2, 2, 0)).toBe(2.5);
    // A tool BELOW the node tier never slows past base (the gate already
    // denies such casts; the formula clamps at zero surplus).
    expect(gatherCastDurationSec(3, 1, 0)).toBe(2.5);
    expect(gatherCastDurationSec(1, 3, 0)).toBeCloseTo(1.7, 10);
    expect(gatherCastDurationSec(1, 1, 2)).toBeCloseTo(2.2, 10);
    expect(gatherCastDurationSec(2, 3, 1)).toBeCloseTo(1.95, 10);
    // The floor: 2.5 - 4 * 0.4 - 2 * 0.15 would be 0.6.
    expect(gatherCastDurationSec(1, 5, 2)).toBe(1.5);
  });

  it('a started gather cast pins castTotal to the formula output (live)', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Timed');
    teleportOntoNode(sim, pid, 'ore_mirefen_t2'); // tier-2 vein
    sim.addItem('mithril_mining_pick', 1, pid); // mining tier 3
    mustMeta(sim, pid).gatheringProficiency.mining = 150; // band 1
    sim.drainEvents();
    expect(sim.harvestNode('ore_mirefen_t2', pid)).toBe(true);
    const p = sim.entities.get(pid);
    if (!p) throw new Error('missing entity');
    // 2.5 - (3 - 2) * 0.4 - 1 * 0.15, independently computed (closeTo: the
    // float subtraction chain lands within 1e-10 of the exact 1.95).
    expect(p.castTotal).toBeCloseTo(1.95, 10);
    expect(p.castRemaining).toBeCloseTo(1.95, 10);
    expect(p.castTotal).toBe(gatherCastDurationSec(2, 3, 1));
    const start = sim.drainEvents().find((e) => e.type === 'castStart');
    if (start?.type !== 'castStart') throw new Error('expected a castStart');
    expect(start.ability).toBe(GATHER_CAST_ID);
    expect(start.time).toBeCloseTo(1.95, 10);
  });
});

describe('gather completion re-validation', () => {
  function simMidCast() {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Revalidated');
    teleportOntoNode(sim, pid, NODE.id);
    expect(sim.harvestNode(NODE.id, pid)).toBe(true);
    sim.drainEvents();
    return { sim, pid, meta: mustMeta(sim, pid) };
  }

  function denialAtCompletion(sim: Sim, pid: number, text: string): void {
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      completeCastNow(sim, pid);
    } finally {
      sim.rng.setObserver(null);
    }
    // The two-draw pair lives in resolveHarvest, AFTER re-validation: a
    // completion denial draws NOTHING and grants nothing.
    expect(draws).toBe(0);
    expect(sim.drainEvents()).toContainEqual(expect.objectContaining({ type: 'error', text }));
    expect(sim.countItem(NODE_MATERIAL.itemId, pid)).toBe(0);
  }

  it('node made unready mid-cast: the respawn literal, zero draws, no grant', () => {
    const { sim, pid, meta } = simMidCast();
    meta.nodeHarvestReadyAt[NODE.id] = sim.time + 999; // own-timer rewound mid-cast
    denialAtCompletion(sim, pid, 'This resource node has not respawned for you yet.');
  });

  it('bags filled mid-cast: the bags literal, zero draws, no grant', () => {
    const { sim, pid, meta } = simMidCast();
    meta.inventory.length = 0;
    for (let i = 0; i < bagCapacity(meta.bags); i++) {
      meta.inventory.push({ itemId: 'bone_fragments', count: 1, instance: { boundTo: pid } });
    }
    denialAtCompletion(sim, pid, 'Your bags are full.');
    expect(meta.inventory).toHaveLength(bagCapacity(meta.bags));
  });

  it('teleported out of range mid-cast: too far, zero draws, no grant, timer untouched', () => {
    const { sim, pid } = simMidCast();
    const p = sim.entities.get(pid);
    if (!p) throw new Error('missing entity');
    p.pos.x += 100; // direct teleport: input movement would cancel instead
    p.prevPos = { ...p.pos };
    denialAtCompletion(sim, pid, 'Too far away.');
    // The respawn timer is only set inside resolveHarvest, which never ran.
    expect(sim.nodeHarvestableByMeFor(NODE.id, pid)).toBe(true);
  });
});

describe('node-tier-relative proficiency gain through the live cast loop', () => {
  // The resolveHarvest call site queues gatherNodeGainMultiplier(proficiency,
  // node.tier) instead of the old flat 1. NODE is tier 1, so mining 50 sits
  // two gain tiers above it (green, 0.25) and mining 75 grays it out
  // entirely (queueGatheringGrant drops the 0: nothing is queued).
  function harvestAt(proficiency: number): { queued: number[]; settled: number } {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Curved');
    const meta = mustMeta(sim, pid);
    meta.gatheringProficiency.mining = proficiency;
    teleportOntoNode(sim, pid, NODE.id);
    expect(sim.harvestNode(NODE.id, pid)).toBe(true);
    completeCastNow(sim, pid);
    const queued = meta.pendingGatherGrants.map((g) => g.amount);
    drainGatheringGrants(meta);
    return { queued, settled: meta.gatheringProficiency.mining };
  }

  it('a t1 harvest at mining 50 queues the minimal 0.25 and settles at 50.25', () => {
    // 50 + gatherNodeGainMultiplier(50, 1) = 50 + 0.25 (green: two tiers below).
    expect(harvestAt(50)).toEqual({ queued: [0.25], settled: 50.25 });
  });

  it('a t1 harvest at mining 75 is gray: queues nothing, proficiency stays 75', () => {
    expect(harvestAt(75)).toEqual({ queued: [], settled: 75 });
  });
});

describe('move cancel is free', () => {
  it('moving cancels the gather cast: castStop false, zero draws, timer untouched, no grant', () => {
    const sim = makeSim(42);
    despawnMobs(sim); // a mob-dead world ticks draw-free, so the observer is decisive
    const pid = sim.playerId;
    teleportOntoNode(sim, pid, NODE.id);
    expect(sim.harvestNode(NODE.id, pid)).toBe(true);
    sim.moveInput.forward = true;
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    let events: ReturnType<Sim['tick']>;
    try {
      events = sim.tick();
    } finally {
      sim.rng.setObserver(null);
    }
    expect(sim.player.castingAbility).toBe(null);
    expect(events).toContainEqual(expect.objectContaining({ type: 'castStop', success: false }));
    expect(draws).toBe(0);
    expect(sim.countItem(NODE_MATERIAL.itemId, pid)).toBe(0);
    // A cancelled cast never touched the respawn timer (resolveHarvest sets
    // it at completion only): the node is immediately available again.
    expect(sim.nodeHarvestableByMeFor(NODE.id, pid)).toBe(true);
    expect(sim.player.gatherCastNodeId).toBe('');
  });
});

describe('same-seed determinism across the whole rhythm loop', () => {
  it('gather cast plus bite-and-reel: identical events, draws, and settled state', () => {
    const run = () => {
      const sim = makeSim(4242);
      despawnMobs(sim);
      const pid = sim.playerId;
      const meta = mustMeta(sim, pid);
      const events: unknown[] = [];
      let draws = 0;
      sim.rng.setObserver(() => draws++);
      try {
        teleportOntoNode(sim, pid, NODE.id);
        sim.harvestNode(NODE.id, pid);
        for (let i = 0; i < 60 && sim.player.castingAbility; i++) events.push(...sim.tick());
        events.push(...sim.drainEvents());
        teleportToValeShore(sim);
        sim.addItem('simple_fishing_pole', 1, pid);
        sim.useItem('simple_fishing_pole');
        for (
          let i = 0;
          i < 200 && !events.some((e) => (e as { type: string }).type === 'fishingBite');
          i++
        ) {
          events.push(...sim.tick());
        }
        sim.useItem('simple_fishing_pole'); // the reel
        events.push(...sim.drainEvents());
        events.push(...sim.tick());
      } finally {
        sim.rng.setObserver(null);
      }
      return {
        events,
        draws,
        ore: sim.countItem(NODE_MATERIAL.itemId, pid),
        proficiency: { ...meta.gatheringProficiency },
        nodeReady: sim.nodeHarvestableByMeFor(NODE.id, pid),
        inventory: JSON.parse(JSON.stringify(meta.inventory)),
      };
    };
    const a = run();
    expect(a).toEqual(run());
    // Non-degenerate: the drive really ran both loops end to end.
    expect(a.events.some((e) => (e as { type: string }).type === 'gatherResult')).toBe(true);
    expect(a.events.some((e) => (e as { type: string }).type === 'fishingBite')).toBe(true);
    expect(a.ore).toBeGreaterThanOrEqual(1);
    expect(a.nodeReady).toBe(false);
    expect(a.draws).toBeGreaterThanOrEqual(3); // 2 gather + at least the bite delay
  });
});

describe('silence and lockout exemptions (with the demon-heal fold, byte-identical)', () => {
  function silencedCaster(castId: string, channeling: boolean): { sim: Sim; e: Entity } {
    const sim = new Sim({ seed: 42, playerClass: 'mage', noPlayer: true });
    const pid = sim.addPlayer('mage', 'Muted');
    sim.tick();
    const e = sim.entities.get(pid);
    if (!e) throw new Error('missing entity');
    e.castingAbility = castId;
    e.castTotal = 10;
    e.castRemaining = 8;
    e.channeling = channeling;
    if (channeling) {
      e.channelTickEvery = 1;
      e.channelTickTimer = 1;
    }
    return { sim, e };
  }

  it('a silence breaks a spell cast but never fishing, gathering, or the demon-heal channel', () => {
    const cases: [string, boolean, boolean][] = [
      ['fireball', false, true], // the control: a fire spell cancels
      [FISHING_CAST_ID, false, false],
      [GATHER_CAST_ID, false, false],
      [DEMON_HEAL_CAST_ID, true, false], // folded: already exempt pre-12b
    ];
    for (const [castId, channeling, cancels] of cases) {
      const { sim, e } = silencedCaster(castId, channeling);
      e.auras.push({ kind: 'silence', name: 'Silence', duration: 5 } as unknown as Aura);
      updateCasting(sim.ctx, e, mustMeta(sim, e.id));
      expect(e.castingAbility, castId).toBe(cancels ? null : castId);
    }
  });

  it('a fire school lockout breaks the fire cast but never fishing, gathering, or demon heal', () => {
    const cases: [string, boolean, boolean][] = [
      ['fireball', false, true],
      [FISHING_CAST_ID, false, false],
      [GATHER_CAST_ID, false, false],
      [DEMON_HEAL_CAST_ID, true, false],
    ];
    for (const [castId, channeling, cancels] of cases) {
      const { sim, e } = silencedCaster(castId, channeling);
      e.auras.push({
        kind: 'lockout',
        name: 'Lockout',
        duration: 4,
        school: 'fire',
      } as unknown as Aura);
      updateCasting(sim.ctx, e, mustMeta(sim, e.id));
      expect(e.castingAbility, castId).toBe(cancels ? null : castId);
    }
  });
});

describe('interrupt immunity and damage-cancels-not-pushback', () => {
  it('an interrupt effect stops a mob spell cast but never a fishing or gather cast', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const kicker = sim.addPlayer('warrior', 'Kicker');
    const caster = sim.entities.get(kicker);
    const casterMeta = mustMeta(sim, kicker);
    if (!caster) throw new Error('missing caster');
    const pummel = {
      def: ABILITIES.pummel,
      effects: ABILITIES.pummel.effects,
    } as unknown as Parameters<typeof runEffects>[4];
    // Control arm: a mob mid-spell IS interrupted through the same call.
    const template = MOBS.forest_wolf;
    const mob = createMob(999901, template, template.maxLevel, { ...caster.pos });
    sim.entities.set(mob.id, mob);
    mob.castingAbility = 'fireball';
    mob.castTotal = 2.5;
    mob.castRemaining = 2;
    runEffects(sim.ctx, caster, casterMeta, mob, pummel);
    expect(mob.castingAbility).toBe(null);
    // Immunity arms: the non-spell sentinels survive the identical effect.
    for (const castId of [FISHING_CAST_ID, GATHER_CAST_ID]) {
      const victimPid = sim.addPlayer('warrior', `Victim${castId}`);
      const victim = sim.entities.get(victimPid);
      if (!victim) throw new Error('missing victim');
      victim.castingAbility = castId;
      victim.castTotal = 15;
      victim.castRemaining = 10;
      runEffects(sim.ctx, caster, casterMeta, victim, pummel);
      expect(victim.castingAbility, castId).toBe(castId);
    }
  });

  it('damage CANCELS a gather cast outright rather than pushing it back', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Struck');
    teleportOntoNode(sim, pid, NODE.id);
    expect(sim.harvestNode(NODE.id, pid)).toBe(true);
    const p = sim.entities.get(pid);
    if (!p) throw new Error('missing entity');
    const template = MOBS.forest_wolf;
    const wolf = createMob(999902, template, template.maxLevel, { ...p.pos });
    sim.entities.set(wolf.id, wolf);
    sim.drainEvents();
    sim.dealDamage(wolf, p, 5, false, 'physical', null, 'hit', true);
    // Cancelled, not pushed back: the cast is gone entirely (a pushback
    // would leave castingAbility set with castRemaining extended).
    expect(p.castingAbility).toBe(null);
    expect(p.gatherCastNodeId).toBe('');
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({ type: 'castStop', success: false }),
    );
    expect(sim.countItem(NODE_MATERIAL.itemId, pid)).toBe(0);
    expect(sim.nodeHarvestableByMeFor(NODE.id, pid)).toBe(true);
  });
});

describe('the reel window follows the rod held at BITE time, not cast start', () => {
  // The window re-scans the rod when the bite fires (fishing.ts documents the
  // re-scan); these two arms kill a cached-at-cast-start implementation from
  // both directions.
  it('a rod dropped between cast start and the bite arms only the base window', () => {
    const sim = makeSim(4242);
    const meta = mustMeta(sim, sim.playerId);
    sim.addItem('silverstream_fishing_rod', 1);
    teleportToValeShore(sim);
    const p = sim.player;
    startFishing(sim.ctx, p, meta);
    sim.removeItem('silverstream_fishing_rod', 1);
    sim.tickCount = p.fishBiteAtTick;
    updateCasting(sim.ctx, p, meta);
    expect(p.fishReelDeadlineTick - sim.tickCount).toBe(60);
  });

  it('a rod picked up between cast start and the bite widens the window', () => {
    const sim = makeSim(4242);
    const meta = mustMeta(sim, sim.playerId);
    teleportToValeShore(sim);
    const p = sim.player;
    startFishing(sim.ctx, p, meta);
    sim.addItem('silverstream_fishing_rod', 1);
    sim.tickCount = p.fishBiteAtTick;
    updateCasting(sim.ctx, p, meta);
    expect(p.fishReelDeadlineTick - sim.tickCount).toBe(90);
  });
});

describe('every gather start-deny arm leaves no cast and draws nothing', () => {
  // The review coverage pass found the start-deny arms pinned only the false
  // return; a deny that erroneously left castingAbility set would have slipped
  // every arm but the tool gate. Each arm here asserts the full deny shape:
  // false, no cast, no hidden node id, zero draws.
  function expectDenied(sim: Sim, pid: number, nodeId: string): void {
    const p = sim.entities.get(pid);
    if (!p) throw new Error('missing entity');
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      expect(sim.harvestNode(nodeId, pid)).toBe(false);
    } finally {
      sim.rng.setObserver(null);
    }
    expect(draws).toBe(0);
    expect(p.castingAbility).toBe(null);
    expect(p.gatherCastNodeId).toBe('');
  }

  it('dead, unknown node, too far, respawn-not-ready, bags-full: no cast, zero draws', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Denied');
    const p = sim.entities.get(pid);
    const meta = mustMeta(sim, pid);
    if (!p) throw new Error('missing entity');
    teleportOntoNode(sim, pid, NODE.id);
    // dead
    p.dead = true;
    expectDenied(sim, pid, NODE.id);
    p.dead = false;
    // unknown node
    expectDenied(sim, pid, 'no_such_node');
    // too far
    p.pos.x += 50;
    expectDenied(sim, pid, NODE.id);
    p.pos.x -= 50;
    // respawn not ready (their own timer)
    meta.nodeHarvestReadyAt[NODE.id] = sim.time + 60;
    expectDenied(sim, pid, NODE.id);
    delete meta.nodeHarvestReadyAt[NODE.id];
    // bags full of an unstackable the material cannot top up
    const capacity = bagCapacity(meta.bags);
    while (meta.inventory.length < capacity) {
      sim.addItemInstance('wolf_fang', { signer: 'Denied' }, pid);
    }
    expectDenied(sim, pid, NODE.id);
  });

  it('busy: a mid-cast re-press denies without touching the running cast', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Busy');
    const p = sim.entities.get(pid);
    if (!p) throw new Error('missing entity');
    teleportOntoNode(sim, pid, NODE.id);
    expect(sim.harvestNode(NODE.id, pid)).toBe(true);
    const total = p.castTotal;
    const nodeId = p.gatherCastNodeId;
    sim.drainEvents();
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      expect(sim.harvestNode(NODE.id, pid)).toBe(false);
    } finally {
      sim.rng.setObserver(null);
    }
    expect(draws).toBe(0);
    // The original cast is untouched by the denied re-press.
    expect(p.castingAbility).toBe(GATHER_CAST_ID);
    expect(p.castTotal).toBe(total);
    expect(p.gatherCastNodeId).toBe(nodeId);
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({ type: 'error', text: 'You are busy.' }),
    );
  });
});

describe('death clears the hidden cast state (review fix)', () => {
  // Sourceless damage skips the cancel-not-pushback arm (it requires a source
  // and kind hit), so a lethal environmental tick reaches handleDeath with the
  // cast still live; death itself must return the hidden fields to inert (the
  // parity samplers rely on inert values at every sampled frame, dead players
  // included).
  it('a sourceless lethal blow mid-fishing leaves every hidden field inert', () => {
    const sim = makeSim(4242);
    const meta = mustMeta(sim, sim.playerId);
    teleportToValeShore(sim);
    startFishing(sim.ctx, sim.player, meta);
    expect(sim.player.fishBiteAtTick).toBeGreaterThan(0);
    sim.dealDamage(null, sim.player, sim.player.maxHp + 50, false, 'physical', null, 'hit');
    expect(sim.player.dead).toBe(true);
    expect(sim.player.castingAbility).toBe(null);
    expect(sim.player.fishBiteAtTick).toBe(0);
    expect(sim.player.fishReelDeadlineTick).toBe(0);
    expect(sim.player.gatherCastNodeId).toBe('');
  });

  it('a sourceless lethal blow mid-gather-cast leaves every hidden field inert', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Slain');
    const p = sim.entities.get(pid);
    if (!p) throw new Error('missing entity');
    teleportOntoNode(sim, pid, NODE.id);
    expect(sim.harvestNode(NODE.id, pid)).toBe(true);
    expect(p.gatherCastNodeId).toBe(NODE.id);
    sim.dealDamage(null, p, p.maxHp + 50, false, 'physical', null, 'hit');
    expect(p.dead).toBe(true);
    expect(p.castingAbility).toBe(null);
    expect(p.gatherCastNodeId).toBe('');
    expect(p.fishBiteAtTick).toBe(0);
    expect(p.fishReelDeadlineTick).toBe(0);
  });
});

describe('every other cast-end path returns the hidden fields to inert (QA pins)', () => {
  // The build pinned the death clear; these pin the remaining end paths the
  // storage decision names (cancelCast, arena reset, fiesta down, the
  // defensive session-cap end), each mutation-decisive: deleting the clear
  // under test reds exactly its arm.
  it('a fresh entity starts with all three hidden fields inert', () => {
    const sim = makeSim(4242);
    expect(sim.player.gatherCastNodeId).toBe('');
    expect(sim.player.fishBiteAtTick).toBe(0);
    expect(sim.player.fishReelDeadlineTick).toBe(0);
  });

  it('cancelCast inside the armed reel window clears both fishing fields, so the next session cannot instant-reel off a stale deadline', () => {
    const sim = makeSim(4242);
    const meta = mustMeta(sim, sim.playerId);
    teleportToValeShore(sim);
    const p = sim.player;
    startFishing(sim.ctx, p, meta);
    sim.tickCount = p.fishBiteAtTick;
    updateCasting(sim.ctx, p, meta); // the bite arms the window
    expect(p.fishReelDeadlineTick).toBeGreaterThan(sim.tickCount);
    cancelCast(sim.ctx, p);
    expect(p.castingAbility).toBe(null);
    expect(p.fishBiteAtTick).toBe(0);
    expect(p.fishReelDeadlineTick).toBe(0);
    // Without the cancelCast clears, this recast would still see the OLD
    // deadline armed and the immediate re-press would land a catch with no
    // bite: the re-press must stay the busy error instead.
    startFishing(sim.ctx, p, meta);
    expect(p.castingAbility).toBe(FISHING_CAST_ID);
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    sim.events = [];
    try {
      startFishing(sim.ctx, p, meta);
    } finally {
      sim.rng.setObserver(null);
    }
    expect(draws).toBe(0);
    expect(p.castingAbility).toBe(FISHING_CAST_ID);
    expect(sim.events).toContainEqual(
      expect.objectContaining({ type: 'error', text: 'You are busy.' }),
    );
  });

  it('the arena fighter reset clears the hidden fields', () => {
    const sim = makeSim(4242);
    const meta = mustMeta(sim, sim.playerId);
    teleportToValeShore(sim);
    startFishing(sim.ctx, sim.player, meta);
    expect(sim.player.fishBiteAtTick).toBeGreaterThan(0);
    sim.player.gatherCastNodeId = NODE.id; // belt-and-braces: all three clear
    readyArenaFighter(sim.ctx, sim.player, { clearPrep: false });
    expect(sim.player.gatherCastNodeId).toBe('');
    expect(sim.player.fishBiteAtTick).toBe(0);
    expect(sim.player.fishReelDeadlineTick).toBe(0);
  });

  it('the fiesta down path clears the hidden fields', () => {
    const sim = makeSim(4242);
    const meta = mustMeta(sim, sim.playerId);
    teleportToValeShore(sim);
    startFishing(sim.ctx, sim.player, meta);
    expect(sim.player.fishBiteAtTick).toBeGreaterThan(0);
    sim.player.gatherCastNodeId = NODE.id;
    fiestaDownEntity(sim.ctx, sim.player, null);
    expect(sim.player.gatherCastNodeId).toBe('');
    expect(sim.player.fishBiteAtTick).toBe(0);
    expect(sim.player.fishReelDeadlineTick).toBe(0);
  });

  it('the defensive session-cap end gets away with zero draws and clears the hidden fields', () => {
    // Unreachable in real flow (max delay + max window end well before the
    // 15 s cap); reachable by the parity cancel drives and any future
    // direct-assigned cast. Shape: the last DT of castRemaining expires with
    // the bite still pending.
    const sim = makeSim(4242);
    const meta = mustMeta(sim, sim.playerId);
    teleportToValeShore(sim);
    const p = sim.player;
    startFishing(sim.ctx, p, meta);
    p.castRemaining = DT; // exhaust the cap on the next lifecycle tick
    p.fishBiteAtTick = sim.tickCount + 999; // bite still pending, window unarmed
    sim.events = [];
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    try {
      updateCasting(sim.ctx, p, meta);
    } finally {
      sim.rng.setObserver(null);
    }
    expect(draws).toBe(0);
    expect(sim.events).toContainEqual({ type: 'fishingGotAway', pid: sim.playerId });
    expect(sim.events).toContainEqual(
      expect.objectContaining({ type: 'castStop', success: false }),
    );
    expect(p.castingAbility).toBe(null);
    expect(p.fishBiteAtTick).toBe(0);
    expect(p.fishReelDeadlineTick).toBe(0);
  });
});

describe('the widened useItem busy guard covers the gather cast (QA pin)', () => {
  it('a potion press mid-gather-cast denies busy and leaves the cast untouched', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Sipper');
    const p = sim.entities.get(pid);
    if (!p) throw new Error('missing entity');
    sim.addItem('minor_mana_potion', 1, pid);
    teleportOntoNode(sim, pid, NODE.id);
    expect(sim.harvestNode(NODE.id, pid)).toBe(true);
    const nodeId = p.gatherCastNodeId;
    sim.drainEvents();
    sim.useItem('minor_mana_potion', pid);
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({ type: 'error', text: 'You are busy.' }),
    );
    expect(p.castingAbility).toBe(GATHER_CAST_ID);
    expect(p.gatherCastNodeId).toBe(nodeId);
    expect(sim.countItem('minor_mana_potion', pid)).toBe(1);
  });
});

describe('rod synergy is literal-pinned on one shared draw (QA pins)', () => {
  // The same seed-4242 first draw walks all three rod arms, so these three
  // literals pin FISH_BITE_DELAY_MIN_SEC and the 1.5 s/tier max-side
  // reduction in BOTH directions (the sampled-bounds arms above catch only
  // a shrink of the reduction, not a growth).
  it('first-cast delay ticks at seed 4242: bare 127, tier-2 rod 107, tier-3 rod 87', () => {
    for (const [rod, ticks] of [
      [null, 127],
      ['ironreel_fishing_rod', 107],
      ['silverstream_fishing_rod', 87],
    ] as [string | null, number][]) {
      const sim = makeSim(4242);
      const meta = mustMeta(sim, sim.playerId);
      if (rod) sim.addItem(rod, 1);
      teleportToValeShore(sim);
      const p = sim.player;
      startFishing(sim.ctx, p, meta);
      expect(p.fishBiteAtTick - sim.tickCount, rod ?? 'bare').toBe(ticks);
    }
  });
});
