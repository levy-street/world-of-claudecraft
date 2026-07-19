import { describe, expect, it } from 'vitest';
import { bagCapacity } from '../src/sim/bags';
import { GATHER_NODES } from '../src/sim/content/gather_nodes';
import { zoneAt } from '../src/sim/data';
import {
  announceGatherRareEvent,
  GATHER_RARE_EVENT_CHANCE,
  GATHER_RARE_EVENT_YIELD_MULT,
  gatherRareEventFlavor,
  rollGatherRareEvent,
} from '../src/sim/professions/gather_events';
import { isSignableMaterialRarity, resolveHarvest } from '../src/sim/professions/gathering';
import { Rng } from '../src/sim/rng';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { GatherNodeType, GatherRareEventFlavor, SimEvent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const FLAVOR_BY_TYPE: Record<GatherNodeType, GatherRareEventFlavor> = {
  ore: 'pristine_vein',
  wood: 'ancient_heartwood',
  herb: 'moonlit_bloom',
};

// A minimal rng whose single next() returns a fixed value, for boundary pins.
function stubRng(value: number): Rng {
  return { next: () => value } as unknown as Rng;
}

function mustNode(nodeId: string) {
  const node = GATHER_NODES.find((n) => n.id === nodeId);
  if (!node) throw new Error(`missing node ${nodeId}`);
  return node;
}

describe('gather rare events: cadence knob + flavor mapping (Phase 4)', () => {
  it('pins the shared cadence and yield constants', () => {
    // Load-bearing tuning literals (state.md: roughly 1 rare event per zone
    // per 20 minutes at ~90 harvests per zone per 20 minutes); Phase 15 tunes
    // per family, so a change must consciously re-pin here.
    expect(GATHER_RARE_EVENT_CHANCE).toBe(1 / 90);
    expect(GATHER_RARE_EVENT_YIELD_MULT).toBe(5);
  });

  it('maps each node family to its own flavor', () => {
    expect(gatherRareEventFlavor('ore')).toBe('pristine_vein');
    expect(gatherRareEventFlavor('wood')).toBe('ancient_heartwood');
    expect(gatherRareEventFlavor('herb')).toBe('moonlit_bloom');
  });

  it('hits exactly when the draw lands strictly below the chance', () => {
    expect(rollGatherRareEvent(stubRng(0), 'ore')).toBe('pristine_vein');
    expect(rollGatherRareEvent(stubRng(GATHER_RARE_EVENT_CHANCE - 1e-9), 'wood')).toBe(
      'ancient_heartwood',
    );
    // At or above the threshold: a miss (strict <).
    expect(rollGatherRareEvent(stubRng(GATHER_RARE_EVENT_CHANCE), 'herb')).toBeNull();
    expect(rollGatherRareEvent(stubRng(0.9), 'ore')).toBeNull();
  });

  it('draws exactly one rng value on EVERY call, hit or miss (constant draw count)', () => {
    let draws = 0;
    const rng = new Rng(7);
    rng.setObserver(() => {
      draws++;
    });
    let hits = 0;
    const calls = 500;
    for (let i = 0; i < calls; i++) {
      if (rollGatherRareEvent(rng, 'ore')) hits++;
    }
    expect(draws).toBe(calls);
    // Sanity that both outcomes occurred inside the constant-draw window.
    expect(hits).toBeGreaterThan(0);
    expect(hits).toBeLessThan(calls);
  });
});

// The pinned determinism contract: once the harvest gate passes, resolveHarvest
// draws EXACTLY twice, draw #1 the rarity roll and draw #2 the rare-event roll.
// The order is made observable by hunting seeds whose two opening draws sit on
// opposite sides of the rare-event threshold: swapping the draws would flip the
// rareEvent outcome.
describe('resolveHarvest two-draw order pin', () => {
  const node = mustNode('ore_eastbrook_1');

  function freshMeta(): PlayerMeta {
    return {
      gatheringProficiency: { mining: 0, logging: 0, herbalism: 0 },
      nodeHarvestReadyAt: {},
      pendingGatherGrants: [],
    } as unknown as PlayerMeta;
  }

  function firstTwoDraws(seed: number): [number, number] {
    const rng = new Rng(seed);
    return [rng.next(), rng.next()];
  }

  function huntSeed(want: (d1: number, d2: number) => boolean): number {
    for (let seed = 1; seed < 200000; seed++) {
      const [d1, d2] = firstTwoDraws(seed);
      if (want(d1, d2)) return seed;
    }
    throw new Error('no seed found');
  }

  it('draw #1 feeds the rarity roll, draw #2 the rare-event roll (miss arm)', () => {
    // First draw BELOW the threshold, second at/above: with the pinned order
    // the rare event MISSES; a swapped order would hit off draw #1.
    const seed = huntSeed(
      (d1, d2) => d1 < GATHER_RARE_EVENT_CHANCE && d2 >= GATHER_RARE_EVENT_CHANCE,
    );
    const rng = new Rng(seed);
    let draws = 0;
    rng.setObserver(() => {
      draws++;
    });
    const result = resolveHarvest(freshMeta(), node, 0, rng);
    expect(result.granted).toBe(true);
    expect(draws).toBe(2);
    expect(result.rareEvent).toBeNull();
    expect(result.rarity).toBe('common'); // proficiency 0: always common
    expect(result.qty).toBe(1);
    expect(result.signed).toBe(false);
  });

  it('draw #2 below the threshold hits, multiplies the yield by 5, and forces signing (hit arm)', () => {
    const seed = huntSeed(
      (d1, d2) => d1 >= GATHER_RARE_EVENT_CHANCE && d2 < GATHER_RARE_EVENT_CHANCE,
    );
    const rng = new Rng(seed);
    let draws = 0;
    rng.setObserver(() => {
      draws++;
    });
    const result = resolveHarvest(freshMeta(), node, 0, rng);
    expect(result.granted).toBe(true);
    expect(draws).toBe(2);
    expect(result.rareEvent).toBe('pristine_vein');
    // Common rolled rarity (proficiency 0), so signing here is FORCED by the
    // rare event, not by the rarity floor; qty is the common unit times 5.
    expect(result.rarity).toBe('common');
    expect(result.signed).toBe(true);
    expect(result.qty).toBe(1 * GATHER_RARE_EVENT_YIELD_MULT);
  });

  it('the full resolution is reproducible from the same seed', () => {
    const run = () => resolveHarvest(freshMeta(), node, 0, new Rng(1234));
    expect(run()).toEqual(run());
  });
});

describe('announceGatherRareEvent: soft zone fanout + dormant deed mark', () => {
  const node = mustNode('ore_eastbrook_1');

  function fakeCtx() {
    const emitted: SimEvent[] = [];
    const marks: string[] = [];
    const players = new Map<number, PlayerMeta>();
    const entities = new Map<number, { pos: { x: number; y: number; z: number } }>();
    const addPlayer = (pid: number, name: string, z: number, x = 0) => {
      const meta = { entityId: pid, name } as unknown as PlayerMeta;
      players.set(pid, meta);
      entities.set(pid, { pos: { x, y: 0, z } });
      return meta;
    };
    const ctx = {
      players,
      entities,
      emit: (e: SimEvent) => emitted.push(e),
      markVisited: (_meta: PlayerMeta, markId: string) => marks.push(markId),
    } as unknown as SimContext;
    return { ctx, emitted, marks, addPlayer };
  }

  it('sanity: the fanout z positions used below sit in the intended zones', () => {
    expect(zoneAt(0).id).toBe('eastbrook_vale');
    expect(zoneAt(340).id).toBe('mirefen_marsh');
  });

  it('emits one pid-scoped copy per in-zone player (finder included), none out of zone', () => {
    const { ctx, emitted, addPlayer } = fakeCtx();
    const finder = addPlayer(1, 'Alba', 0);
    addPlayer(2, 'Bystander', 0); // same zone as the eastbrook node
    addPlayer(3, 'FarAway', 340); // mirefen_marsh: must not receive
    // Instance space: z overlaps the zone strip but x sits past
    // DUNGEON_X_THRESHOLD (600), so a dungeon/arena/delve runner is excluded.
    addPlayer(4, 'Delver', 0, 900);

    announceGatherRareEvent(ctx, finder, node, 'pristine_vein', 'copper_ore');

    const events = emitted.filter((e) => e.type === 'gatherRareEvent');
    expect(events.map((e) => e.pid).sort()).toEqual([1, 2]);
    for (const ev of events) {
      expect(ev.flavor).toBe('pristine_vein');
      expect(ev.finderName).toBe('Alba');
      expect(ev.finderPid).toBe(1);
      expect(ev.zoneId).toBe('eastbrook_vale');
      expect(ev.nodeType).toBe('ore');
      expect(ev.itemId).toBe('copper_ore');
    }
  });

  it('records the dormant per-flavor deed mark for the finder, one named mark per flavor', () => {
    for (const flavor of [
      'pristine_vein',
      'ancient_heartwood',
      'moonlit_bloom',
    ] as GatherRareEventFlavor[]) {
      const { ctx, marks, addPlayer } = fakeCtx();
      const finder = addPlayer(1, 'Alba', 0);
      announceGatherRareEvent(ctx, finder, node, flavor, 'copper_ore');
      expect(marks).toEqual([`gather_event:${flavor}`]);
    }
  });
});

// End-to-end through the real Sim command path: hunt the deterministic rng
// stream (fixed world seed, repeated harvests with the per-player cooldown
// cleared) until draw #2 hits, then pin the whole observable surface of the
// hit: both events, the x5 signed yield, and the deed mark.
describe('rare events through Sim.harvestNode (all three flavors)', () => {
  function huntHit(nodeId: string) {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Finder');
    const node = mustNode(nodeId);
    const p = sim.entities.get(pid);
    if (!p) throw new Error('missing player entity');
    p.pos.x = node.pos.x;
    p.pos.z = node.pos.z;
    p.pos.y = terrainHeight(node.pos.x, node.pos.z, sim.cfg.seed);
    p.prevPos = { ...p.pos };
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('missing player meta');
    for (let i = 0; i < 2000; i++) {
      // Reset the session-only cooldown and bag state so every iteration is a
      // clean granted harvest: the hunt advances ONLY the shared rng stream.
      meta.inventory.length = 0;
      delete meta.nodeHarvestReadyAt[nodeId];
      expect(sim.harvestNode(nodeId, pid)).toBe(true);
      const events = sim.drainEvents();
      const rare = events.find((e) => e.type === 'gatherRareEvent');
      if (rare && rare.type === 'gatherRareEvent') {
        const gather = events.find((e) => e.type === 'gatherResult');
        if (gather?.type !== 'gatherResult') throw new Error('expected gatherResult on the hit');
        return { sim, pid, meta, node, rare, gather, iteration: i };
      }
    }
    throw new Error(`no rare event within 2000 harvests of ${nodeId}`);
  }

  it('an ore node hit is a pristine vein: zone event, x5 yield, all units signed', () => {
    const { pid, meta, rare, gather, node } = huntHit('ore_eastbrook_1');
    expect(rare.flavor).toBe('pristine_vein');
    expect(rare.nodeType).toBe('ore');
    expect(rare.itemId).toBe('copper_ore');
    expect(rare.zoneId).toBe('eastbrook_vale');
    expect(rare.finderPid).toBe(pid);
    expect(rare.finderName).toBe('Finder');
    expect(rare.pid).toBe(pid); // the finder is part of their own zone fanout

    expect(gather.rareEvent).toBe('pristine_vein');
    expect(gather.nodeId).toBe(node.id);
    // Proficiency never drains without a tick, so the rolled rarity is common
    // and the x5 multiplier is the ONLY reason qty exceeds 1.
    expect(gather.rarity).toBe('common');
    expect(gather.qty).toBe(GATHER_RARE_EVENT_YIELD_MULT);

    // The yield landed as qty separate signed instances (forced signing on a
    // common roll: the rare event, not the rarity floor, drives it).
    const slots = meta.inventory.filter((s) => s.itemId === 'copper_ore');
    expect(slots).toHaveLength(GATHER_RARE_EVENT_YIELD_MULT);
    for (const slot of slots) {
      expect(slot.count).toBe(1);
      expect(slot.instance?.signer).toBe('Finder');
    }

    // The dormant per-flavor deed mark (Phase 15 registers the deed).
    expect(meta.deedStats.visited.has('gather_event:pristine_vein')).toBe(true);
  });

  it('a wood node hit is an ancient heartwood with the same signed x5 yield', () => {
    const { meta, rare, gather } = huntHit('wood_eastbrook_1');
    expect(rare.flavor).toBe('ancient_heartwood');
    expect(rare.itemId).toBe('ironbark_log');
    expect(gather.rareEvent).toBe('ancient_heartwood');
    expect(gather.qty).toBe(GATHER_RARE_EVENT_YIELD_MULT);
    const slots = meta.inventory.filter((s) => s.itemId === 'ironbark_log');
    expect(slots).toHaveLength(GATHER_RARE_EVENT_YIELD_MULT);
    for (const slot of slots) expect(slot.instance?.signer).toBe('Finder');
    expect(meta.deedStats.visited.has('gather_event:ancient_heartwood')).toBe(true);
  });

  it('a herb node hit is a moonlit bloom with the same signed x5 yield', () => {
    const { meta, rare, gather } = huntHit('herb_eastbrook_1');
    expect(rare.flavor).toBe('moonlit_bloom');
    expect(rare.itemId).toBe('silverleaf_herb');
    expect(gather.rareEvent).toBe('moonlit_bloom');
    expect(gather.qty).toBe(GATHER_RARE_EVENT_YIELD_MULT);
    const slots = meta.inventory.filter((s) => s.itemId === 'silverleaf_herb');
    expect(slots).toHaveLength(GATHER_RARE_EVENT_YIELD_MULT);
    for (const slot of slots) expect(slot.instance?.signer).toBe('Finder');
    expect(meta.deedStats.visited.has('gather_event:moonlit_bloom')).toBe(true);
  });

  it('same seed, same hunt: the hit lands on the same harvest with identical events', () => {
    const a = huntHit('ore_eastbrook_1');
    const b = huntHit('ore_eastbrook_1');
    expect(a.iteration).toBe(b.iteration);
    expect(a.rare).toEqual(b.rare);
    expect(a.gather).toEqual(b.gather);
  });

  it('every flavor pins to its family through the shared mapping table', () => {
    for (const type of ['ore', 'wood', 'herb'] as GatherNodeType[]) {
      expect(gatherRareEventFlavor(type)).toBe(FLAVOR_BY_TYPE[type]);
    }
  });
});

// The rarity-floor signing arm (no rare event involved): a rolled
// rare/epic/legendary yield lands as { signer } instances at its qtyByRarity
// count, while uncommon stays a plain fungible stack.
describe('rarity-floor signing through Sim.harvestNode', () => {
  function huntRarity(want: (rarity: string, rareEvent: unknown) => boolean) {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Prospector');
    const nodeId = 'ore_eastbrook_1';
    const node = mustNode(nodeId);
    const p = sim.entities.get(pid);
    if (!p) throw new Error('missing player entity');
    p.pos.x = node.pos.x;
    p.pos.z = node.pos.z;
    p.pos.y = terrainHeight(node.pos.x, node.pos.z, sim.cfg.seed);
    p.prevPos = { ...p.pos };
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('missing player meta');
    // Max proficiency: zero common weight, so rare-or-better shows up fast.
    meta.gatheringProficiency.mining = 100;
    for (let i = 0; i < 3000; i++) {
      meta.inventory.length = 0;
      delete meta.nodeHarvestReadyAt[nodeId];
      expect(sim.harvestNode(nodeId, pid)).toBe(true);
      const gather = sim.drainEvents().find((e) => e.type === 'gatherResult');
      if (gather?.type !== 'gatherResult') throw new Error('expected gatherResult');
      if (want(gather.rarity, gather.rareEvent)) return { meta, gather };
    }
    throw new Error('no matching harvest within 3000 attempts');
  }

  it('a rolled rare-or-better yield (rare event MISSED) is signed at its qtyByRarity count', () => {
    const QTY: Record<string, number> = { rare: 2, epic: 3, legendary: 4 };
    const { meta, gather } = huntRarity((rarity, rareEvent) => rareEvent === null && rarity in QTY);
    expect(gather.rareEvent).toBeNull();
    expect(gather.qty).toBe(QTY[gather.rarity]);
    const slots = meta.inventory.filter((s) => s.itemId === 'copper_ore');
    expect(slots).toHaveLength(QTY[gather.rarity]);
    for (const slot of slots) {
      expect(slot.count).toBe(1);
      expect(slot.instance?.signer).toBe('Prospector');
    }
  });

  it('a rolled uncommon yield (rare event missed) stays an unsigned fungible stack of 2', () => {
    const { meta, gather } = huntRarity(
      (rarity, rareEvent) => rareEvent === null && rarity === 'uncommon',
    );
    expect(gather.qty).toBe(2);
    const slots = meta.inventory.filter((s) => s.itemId === 'copper_ore');
    expect(slots).toHaveLength(1);
    expect(slots[0].count).toBe(2);
    expect(slots[0].instance).toBeUndefined();
  });
});

// The signing threshold itself, pinned tier by tier: the full-Sim hunts above
// nearly always surface 'rare' as the first signable tier, so epic and
// legendary signing are guarded here at the unit level.
describe('isSignableMaterialRarity threshold', () => {
  it('signs rare, epic, and legendary; never common or uncommon', () => {
    expect(isSignableMaterialRarity('common')).toBe(false);
    expect(isSignableMaterialRarity('uncommon')).toBe(false);
    expect(isSignableMaterialRarity('rare')).toBe(true);
    expect(isSignableMaterialRarity('epic')).toBe(true);
    expect(isSignableMaterialRarity('legendary')).toBe(true);
  });
});

// The command-boundary truncation: harvestNode owns capacity clamping because
// the Sim grant hubs never capacity-cap. Both branches (signed windfall and
// fungible stack fit) are exercised against genuinely full bags, and
// gatherResult.qty must report the GRANTED count, not the resolved one.
describe('grant truncation at the command boundary (full bags)', () => {
  function simAtOreNode() {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Packrat');
    const nodeId = 'ore_eastbrook_1';
    const node = mustNode(nodeId);
    const p = sim.entities.get(pid);
    if (!p) throw new Error('missing player entity');
    p.pos.x = node.pos.x;
    p.pos.z = node.pos.z;
    p.pos.y = terrainHeight(node.pos.x, node.pos.z, sim.cfg.seed);
    p.prevPos = { ...p.pos };
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('missing player meta');
    return { sim, pid, nodeId, meta };
  }

  it('an oversized rare-event windfall truncates to the free slots and reports the granted count', () => {
    const { sim, pid, nodeId, meta } = simAtOreNode();
    const capacity = bagCapacity(meta.bags);
    for (let i = 0; i < 2000; i++) {
      // Each attempt starts with exactly TWO free slots (filler is a
      // non-copper junk id so nothing merges with the harvest yield).
      meta.inventory.length = 0;
      for (let f = 0; f < capacity - 2; f++)
        meta.inventory.push({ itemId: 'bone_fragments', count: 1 });
      delete meta.nodeHarvestReadyAt[nodeId];
      expect(sim.harvestNode(nodeId, pid)).toBe(true);
      const events = sim.drainEvents();
      const gather = events.find((e) => e.type === 'gatherResult');
      if (gather?.type !== 'gatherResult') throw new Error('expected gatherResult');
      if (gather.rareEvent === null) continue;
      // The hit: resolved qty is at least x5, but only the two free slots
      // absorb signed instances (instances never merge into stacks).
      expect(gather.qty).toBe(2);
      expect(gather.qty).toBeLessThan(GATHER_RARE_EVENT_YIELD_MULT);
      const copper = meta.inventory.filter((s) => s.itemId === 'copper_ore');
      expect(copper).toHaveLength(2);
      for (const slot of copper) expect(slot.instance?.signer).toBe('Packrat');
      // Truncation, not overflow: the bag never exceeds capacity.
      expect(meta.inventory.length).toBe(capacity);
      return;
    }
    throw new Error('no rare event within 2000 harvests');
  });

  it('a signed roll with zero free slots grants unsigned into the stack, never past capacity', () => {
    const { sim, pid, nodeId, meta } = simAtOreNode();
    const capacity = bagCapacity(meta.bags);
    // Max proficiency so signed (rare-or-better) rolls appear quickly.
    meta.gatheringProficiency.mining = 100;
    for (let i = 0; i < 3000; i++) {
      // The crossing case: the bag is slot-full and the ONLY room is fungible
      // top-up on a partial copper stack. That room passes the capacity
      // pre-gate (ctx.canAddItem counts stack top-up), but a signed instance
      // needs a genuinely free slot (instances never merge), so a signed roll
      // here must fall back to an unsigned top-up grant, never overflow.
      meta.inventory.length = 0;
      for (let f = 0; f < capacity - 1; f++)
        meta.inventory.push({ itemId: 'bone_fragments', count: 1 });
      meta.inventory.push({ itemId: 'copper_ore', count: 15 });
      delete meta.nodeHarvestReadyAt[nodeId];
      if (!sim.harvestNode(nodeId, pid)) continue;
      const events = sim.drainEvents();
      const gather = events.find((e) => e.type === 'gatherResult');
      if (gather?.type !== 'gatherResult') throw new Error('expected gatherResult');
      // Truncation, not overflow, on EVERY iteration (fungible rolls included).
      expect(meta.inventory.length).toBeLessThanOrEqual(capacity);
      const wouldSign = gather.rareEvent !== null || isSignableMaterialRarity(gather.rarity);
      if (!wouldSign) continue;
      // The signed-roll arm: no instance landed, the stack absorbed the
      // granted count, and gatherResult.qty reports that granted count.
      expect(meta.inventory.length).toBe(capacity);
      expect(meta.inventory.filter((s) => s.itemId === 'copper_ore' && s.instance)).toHaveLength(0);
      const stack = meta.inventory.find((s) => s.itemId === 'copper_ore' && !s.instance);
      expect(gather.qty).toBeGreaterThanOrEqual(1);
      expect(stack?.count).toBe(15 + gather.qty);
      return;
    }
    throw new Error('no signed roll within 3000 attempts');
  });

  it('a fungible yield larger than the remaining stack room truncates to what fits', () => {
    const { sim, pid, nodeId, meta } = simAtOreNode();
    const capacity = bagCapacity(meta.bags);
    // Max proficiency so uncommon (qty 2, unsigned) rolls appear quickly.
    meta.gatheringProficiency.mining = 100;
    for (let i = 0; i < 3000; i++) {
      // Bag completely full, with the only room being ONE unit of top-up on
      // an existing copper stack (stack size 20).
      meta.inventory.length = 0;
      for (let f = 0; f < capacity - 1; f++)
        meta.inventory.push({ itemId: 'bone_fragments', count: 1 });
      meta.inventory.push({ itemId: 'copper_ore', count: 19 });
      delete meta.nodeHarvestReadyAt[nodeId];
      if (!sim.harvestNode(nodeId, pid)) continue;
      const events = sim.drainEvents();
      const gather = events.find((e) => e.type === 'gatherResult');
      if (gather?.type !== 'gatherResult') throw new Error('expected gatherResult');
      if (!(gather.rareEvent === null && gather.rarity === 'uncommon')) continue;
      // Resolved qty 2, but only 1 fits: granted count reported, stack capped.
      expect(gather.qty).toBe(1);
      const copper = meta.inventory.find((s) => s.itemId === 'copper_ore' && !s.instance);
      expect(copper?.count).toBe(20);
      expect(meta.inventory.length).toBe(capacity);
      return;
    }
    throw new Error('no plain uncommon harvest within 3000 attempts');
  });
});
