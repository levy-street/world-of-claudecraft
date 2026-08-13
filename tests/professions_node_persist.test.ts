// Per-player gather-node readiness persistence (D6): a relog can no longer
// reset a node respawn timer. Readiness persists as REMAINING-time deltas
// (src/sim/professions/node_persist.ts, the cooldown_persist.ts scheme), so a
// timer freezes at the logout frame and resumes against the loading sim's
// clock. Zero-default omission is load-bearing throughout: a character with
// every node ready serializes byte-identically to a pre-D6 save.
import { describe, expect, it } from 'vitest';
import { GATHER_NODES } from '../src/sim/content/gather_nodes';
import {
  isNodeHarvestableBy,
  NODE_HARVEST_TABLE,
  resolveHarvest,
} from '../src/sim/professions/gathering';
import { applyNodeReadiness, serializeNodeReadiness } from '../src/sim/professions/node_persist';
import { Rng } from '../src/sim/rng';
import { type CharacterState, type PlayerMeta, Sim } from '../src/sim/sim';
import { EMPTY_TEST_WORLD } from './sim_shared';

// Node readiness is keyed off GATHER_NODES (static content) and the caller's
// own explicit Rng, never off the Sim's ambient world: every Sim here only
// needs a player and its clock, so EMPTY_TEST_WORLD (no camps, npcs, or
// ground objects) skips the built-in world's population cost for free.
const makeSim = (seed = 11) =>
  new Sim({ seed, playerClass: 'warrior', autoEquip: false, world: EMPTY_TEST_WORLD });
const metaOf = (sim: Sim): PlayerMeta => sim.meta(sim.playerId) as PlayerMeta;

// A real shipped node: the load filter keeps live ids only, so every arm below
// runs against content that actually exists. Respawn is 240 seconds
// (NODE_HARVEST_TABLE), pinned literally where the delta value matters.
const NODE = GATHER_NODES.find((n) => n.type === 'ore' && n.zoneId === 'eastbrook_vale');
if (!NODE) throw new Error('no eastbrook ore node in content');
// A second live node for the multi-entry arms: truncation regressions
// (first-entry-only, break-after-first-surviving-write) are invisible to
// single-survivor fixtures in either direction.
const NODE2 = GATHER_NODES.find((n) => n.type === 'wood' && n.zoneId === 'eastbrook_vale');
if (!NODE2) throw new Error('no eastbrook wood node in content');
const RESPAWN_SECONDS = 240;

describe('the pure remaining-delta round trip (no Sim)', () => {
  it('serializes only still-running timers, as remaining seconds', () => {
    // readyAt 10 at now 5 is 5 seconds remaining; readyAt exactly now is
    // elapsed and must NOT serialize (absent means ready on load).
    expect(serializeNodeReadiness({ [NODE.id]: 10, other: 5 }, 5)).toEqual({ [NODE.id]: 5 });
  });

  it('returns undefined (field omission) when nothing is running', () => {
    expect(serializeNodeReadiness({}, 0)).toBeUndefined();
    expect(serializeNodeReadiness({ [NODE.id]: 3 }, 9)).toBeUndefined();
  });

  it('rounds a persisted remaining to two decimals (the ncd wire precision)', () => {
    // sim.time is an accumulated DT sum, so a raw delta serializes at up to
    // 18 characters; persistence carries wire precision instead.
    expect(serializeNodeReadiness({ [NODE.id]: 219.44999999999973 }, 0)).toEqual({
      [NODE.id]: 219.45,
    });
    // A remaining that rounds to zero omits rather than writing a dead key.
    expect(serializeNodeReadiness({ [NODE.id]: 0.004 }, 0)).toBeUndefined();
  });

  it('re-anchors a saved delta onto the loading clock', () => {
    expect(applyNodeReadiness({ [NODE.id]: 30 }, 100)).toEqual({ [NODE.id]: 130 });
  });

  it('loads an absent field as the everything-ready default', () => {
    expect(applyNodeReadiness(undefined, 7)).toEqual({});
    expect(applyNodeReadiness(null, 7)).toEqual({});
  });

  it('drops a retired node id on load rather than persisting it forever', () => {
    expect(GATHER_NODES.some((n) => n.id === 'legacy_node')).toBe(false);
    expect(applyNodeReadiness({ legacy_node: 100, [NODE.id]: 50 }, 0)).toEqual({ [NODE.id]: 50 });
  });

  it('an unknown id with a running timer serializes verbatim (anti-tamper is load-side)', () => {
    // The serialize side deliberately neither clamps nor filters (see the
    // serializeNodeReadiness doc): the one live writer only ever writes live
    // ids, so a write-side copy of the load allowlist would only mask a
    // writer bug. This arm makes that a CONTRACT: adding a serialize-side
    // filter must consciously flip it.
    // The live-id value sits far above one respawn, pinning the no-CLAMP half
    // of the contract in the same arm as the no-filter half.
    expect(serializeNodeReadiness({ not_a_live_node: 50, [NODE.id]: 999999 }, 0)).toEqual({
      not_a_live_node: 50,
      [NODE.id]: 999999,
    });
  });

  it('several running timers all survive both directions (no truncation)', () => {
    // Serialize: two running entries, both written.
    expect(serializeNodeReadiness({ [NODE.id]: 100, [NODE2.id]: 50 }, 0)).toEqual({
      [NODE.id]: 100,
      [NODE2.id]: 50,
    });
    // Load: a dropped id BETWEEN two survivors, so first-entry-only AND
    // break-after-first-surviving-write both go red (a gatherer logs out
    // with a whole circuit cooling down, not one node).
    expect(applyNodeReadiness({ [NODE.id]: 50, legacy_node: 100, [NODE2.id]: 30 }, 7)).toEqual({
      [NODE.id]: 57,
      [NODE2.id]: 37,
    });
  });

  it('drops malformed values and clamps a tampered remaining to one respawn', () => {
    expect(applyNodeReadiness({ [NODE.id]: Number.NaN }, 0)).toEqual({});
    expect(applyNodeReadiness({ [NODE.id]: -5 }, 0)).toEqual({});
    expect(applyNodeReadiness({ [NODE.id]: Number.POSITIVE_INFINITY }, 0)).toEqual({});
    // A hand-edited save cannot lock a node for longer than one real respawn.
    expect(applyNodeReadiness({ [NODE.id]: 999999 }, 0)).toEqual({ [NODE.id]: RESPAWN_SECONDS });
  });
});

describe('the write ceiling, the load clamp, and the record bound stay coupled', () => {
  it('every live node writes exactly the ceiling the load clamp enforces', () => {
    // Coincidence guard: ore, wood and herb all respawn in 240 seconds
    // today, which is the only reason the clamp arms above can assert one
    // literal. When a node type's respawn diverges, this pin goes red and
    // the clamp arms must gain a per-type case.
    expect(new Set(Object.values(NODE_HARVEST_TABLE).map((e) => e.respawnSeconds))).toEqual(
      new Set([RESPAWN_SECONDS]),
    );
    // Write-versus-load coupling, per node: the readiness resolveHarvest
    // actually writes equals the ceiling applyNodeReadiness clamps a
    // tampered save to. If a future modifier (event, debuff, tool penalty)
    // ever writes LONGER than the table, this sweep reds instead of the
    // load clamp silently shortening the timer on the next relog.
    const meta = metaOf(makeSim(16));
    for (const node of GATHER_NODES) {
      expect(resolveHarvest(meta, node, 0, new Rng(17)).granted, node.id).toBe(true);
      expect(meta.nodeHarvestReadyAt[node.id], node.id).toBe(
        applyNodeReadiness({ [node.id]: 999999 }, 0)[node.id],
      );
    }
    // The every-node record (all live nodes cooling at once): every entry
    // serializes, and the JSON stays small enough to ride every
    // characters.state row. Integer-valued here (each entry is the flat 240);
    // real records carry two-decimal values and run roughly 13 percent
    // larger, still inside the ceiling. Content growth that trips the byte
    // literal is a deliberate blob-size decision, not an accident: the
    // ceiling moved 2048 to 4096 at the v0.32.0 merge, when the expansion's
    // eleven starter zones took the live node count 54 to 120 (integer
    // record measured 2784, so the two-decimal worst case sits near 3150
    // and the new ceiling keeps the same order of headroom the old one had).
    // It moved 4096 to 8192 at the phase 20 density pass, when the +36
    // bottom-three additions took the count 120 to 156: the integer record
    // measured 3,648, still under the old pin, but the two-decimal
    // real-record form crossed it at 4,116 (and the wire twin's thirty-day
    // form in tests/professions_wire_budget.test.ts crossed outright at
    // 4,740), so BOTH files took the natural doubling step together. Sizing
    // note, corrected at the phase 20 review round: the +132 full-D5
    // follow-on measures 7,684 bytes in THIS two-decimal persist form (so it
    // fits the 8192 persist pin), but its wire twin adds four bytes per
    // entry and lands near 8,850, so the WIRE arm takes a third move at that
    // content (docs/design/professions-tuning-packet-review.md, the phase 20
    // build record's premise correction on Q11's recorded number).
    const all = serializeNodeReadiness(meta.nodeHarvestReadyAt, 0);
    expect(all && Object.keys(all).length).toBe(GATHER_NODES.length);
    expect(JSON.stringify(all).length).toBeLessThanOrEqual(8192);
    // The two-decimal REAL-record form, the shape live saves actually carry
    // and the number the raise was decided on: one twentieth of a second
    // after the harvests every remaining serializes as 239.95. This is what
    // makes the 8192 pin load-bearing in both directions here: reverting it
    // to 4096 reds on the 4,116-byte measurement below.
    const twoDecimal = serializeNodeReadiness(meta.nodeHarvestReadyAt, 0.05);
    expect(twoDecimal && Object.keys(twoDecimal).length).toBe(GATHER_NODES.length);
    const twoDecimalBytes = JSON.stringify(twoDecimal).length;
    expect(twoDecimalBytes).toBeGreaterThan(4096);
    expect(twoDecimalBytes).toBeLessThanOrEqual(8192);
    // Form ordering, kept live (the QA round): the integer bound above is
    // strictly subsumed by the two-decimal bound, and this is the assertion
    // that says so, so the wider-form premise behind the wire twin's
    // plus-four-bytes-per-entry arithmetic cannot rot silently. Holds while
    // every respawnSeconds stays integral; a fractional respawn would
    // genuinely break the premise, and this line is what says so.
    expect(twoDecimalBytes).toBeGreaterThan(JSON.stringify(all).length);
    // The load side must survive the same scale: no cap, break, or dedupe may
    // shrink a full record on the way back in.
    expect(Object.keys(applyNodeReadiness(all, 0)).length).toBe(GATHER_NODES.length);
  });
});

describe('the real save/load path closes the relog exploit', () => {
  it('a harvest-consumed timer survives serialize, addPlayer, and a second save', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    // The REAL write: resolveHarvest consumes this player's timer for the node
    // (nodeHarvestReadyAt[id] = now + respawn) exactly as a live harvest does.
    const result = resolveHarvest(meta, NODE, sim.time, new Rng(3));
    expect(result.granted).toBe(true);
    const state = sim.serializeCharacter(sim.playerId) as CharacterState;
    // Full remaining at save time, pinned to the literal respawn (sim.time is
    // still 0: no ticks ran between the harvest and the save).
    expect(state.nodeHarvestCooldowns).toEqual({ [NODE.id]: RESPAWN_SECONDS });

    // The logout gap: the loading sim has its own clock, already advanced.
    // The delta FROZE during logout, so the timer resumes with its full
    // remaining anchored at load time rather than expiring on wall time.
    const reloaded = makeSim(12);
    for (let i = 0; i < 10; i++) reloaded.tick();
    const pid = reloaded.addPlayer('warrior', 'Returner', { state });
    const meta2 = reloaded.meta(pid) as PlayerMeta;
    expect(meta2.nodeHarvestReadyAt[NODE.id]).toBeCloseTo(reloaded.time + RESPAWN_SECONDS, 6);
    // The exploit pin itself: the relog did NOT hand the node back.
    expect(isNodeHarvestableBy(meta2, NODE.id, reloaded.time)).toBe(false);

    // Fixed point: an immediate re-save carries the same delta forward (pinned
    // to the FIRST literal, so a serializer that stopped emitting the field
    // cannot satisfy the equality with undefined on both sides).
    const resaved = reloaded.serializeCharacter(pid) as CharacterState;
    expect(resaved.nodeHarvestCooldowns).toEqual({ [NODE.id]: RESPAWN_SECONDS });
  });

  it('a partially elapsed timer saves only its remaining, never the full respawn', () => {
    const sim = makeSim();
    metaOf(sim).nodeHarvestReadyAt[NODE.id] = sim.time + 30;
    const state = sim.serializeCharacter(sim.playerId) as CharacterState;
    expect(state.nodeHarvestCooldowns).toEqual({ [NODE.id]: 30 });
    const reloaded = makeSim(13);
    const pid = reloaded.addPlayer('warrior', 'Partway', { state });
    const meta2 = reloaded.meta(pid) as PlayerMeta;
    expect(meta2.nodeHarvestReadyAt[NODE.id]).toBeCloseTo(reloaded.time + 30, 6);
  });

  it('a fresh character and an all-elapsed map both omit the field entirely', () => {
    const fresh = makeSim();
    // KEY absence, not undefined: `in` distinguishes a missing key from one
    // present with an explicit undefined value, and the omission is what
    // keeps a clean character byte-identical to a pre-D6 save.
    const clean = fresh.serializeCharacter(fresh.playerId);
    expect(clean && 'nodeHarvestCooldowns' in clean).toBe(false);
    metaOf(fresh).nodeHarvestReadyAt[NODE.id] = fresh.time - 1;
    const elapsed = fresh.serializeCharacter(fresh.playerId);
    expect(elapsed && 'nodeHarvestCooldowns' in elapsed).toBe(false);
  });

  it('a later save carries the smaller remaining, so the freshest save wins', () => {
    // The sim-side half of the linkdead story: while a character stays in
    // the world its timers keep counting in live sim time, so a LATER save
    // (the grace-expiry one) records strictly less remaining than an earlier
    // one (the drop-time safety flush), and whichever save lands last is
    // what the next load honors.
    const sim = makeSim();
    expect(resolveHarvest(metaOf(sim), NODE, sim.time, new Rng(3)).granted).toBe(true);
    const flush = sim.serializeCharacter(sim.playerId) as CharacterState;
    expect(flush.nodeHarvestCooldowns).toEqual({ [NODE.id]: RESPAWN_SECONDS });
    for (let i = 0; i < 20; i++) sim.tick(); // one second of live sim time
    const later = sim.serializeCharacter(sim.playerId) as CharacterState;
    expect(later.nodeHarvestCooldowns).toEqual({ [NODE.id]: RESPAWN_SECONDS - 1 });
  });

  it('a pre-D6 save (no field) loads with every node ready', () => {
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.playerId) as CharacterState;
    delete state.nodeHarvestCooldowns;
    const reloaded = makeSim(14);
    const pid = reloaded.addPlayer('warrior', 'Legacy', { state });
    const meta2 = reloaded.meta(pid) as PlayerMeta;
    expect(meta2.nodeHarvestReadyAt).toEqual({});
    expect(isNodeHarvestableBy(meta2, NODE.id, reloaded.time)).toBe(true);
  });

  it('a retired id self-heals out of the save on the next round trip', () => {
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.playerId) as CharacterState;
    state.nodeHarvestCooldowns = { legacy_node: 100, [NODE.id]: 50 };
    const reloaded = makeSim(15);
    const pid = reloaded.addPlayer('warrior', 'Healed', { state });
    const meta2 = reloaded.meta(pid) as PlayerMeta;
    expect(meta2.nodeHarvestReadyAt).toEqual({ [NODE.id]: reloaded.time + 50 });
    // The re-save carries only the live id: the retired key is gone for good.
    expect(reloaded.serializeCharacter(pid)?.nodeHarvestCooldowns).toEqual({ [NODE.id]: 50 });
  });
});
