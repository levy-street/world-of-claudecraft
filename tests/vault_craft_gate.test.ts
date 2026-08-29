// The Materials Vault craft gate (src/sim/vault_craft_gate.ts): may this
// player's craft reach into their vault from where they are standing?
//
// THE OPEN WORLD IS THE ONLY ALLOWED CONTEXT. Every instanced context refuses,
// so a party cannot resupply a raid consumable from a pocket stockpile
// mid-clear and a rated bout cannot be decided by who banked more reagents.
//
// What each case here can and cannot prove, stated up front because the
// predicate is deliberately redundant and a reader will otherwise over-credit
// the six context cases:
//
// - Every POSITION-KEYED arm (dungeon, raid, delve, rift) is provably subsumed
//   by the geometry backstop: instanceInfoAt, delveRunForPlayer and
//   riftInstanceAtPos each require the body to sit inside a footprint that is
//   itself east of DUNGEON_X_THRESHOLD. So the six per-context cases pin the
//   COMPOSITE answer for each shipped context (a refactor that swapped the one
//   backstop for seven band predicates and forgot one turns them red), not the
//   individual arm. Deleting one of those arms alone leaves them green, and
//   that is the module's stated design ("belt-and-braces rather than
//   duplication"), not a hole in the suite.
// - The two MEMBERSHIP arms (battleground, arena) CAN diverge from geometry,
//   in the pre-teleport and post-match frames. The divergence cases below are
//   the decisive pins for those two arms: delete either arm and only they fail.
// - The geometry backstop has its own decisive pin, at x = 100001: one yard
//   east of the threshold and 179 yards west of the nearest dungeon footprint,
//   so no membership or footprint arm can answer for it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  arenaOrigin,
  battlegroundOrigin,
  DUNGEON_X_THRESHOLD,
  DUNGEONS,
  instanceOrigin,
  RIFT_BAND_X_MIN,
  RIFT_REGION_HALF_X,
  RIFT_X_MIN,
} from '../src/sim/data';
import { enterDungeon, instanceInfoAt } from '../src/sim/instances/dungeons';
import { craftVaultDrawBlockedFor, craftVaultStockFor } from '../src/sim/materials_vault';
import { Sim } from '../src/sim/sim';
import type { DungeonDef, Entity, Vec3 } from '../src/sim/types';
import { vaultDrawBlocked, vaultDrawStock } from '../src/sim/vault_craft_gate';
import {
  placeInArena,
  placeInBattleground,
  placeInDelve,
  placeInDungeon,
  placeInOpenWorld,
  placeInRaid,
  placeInRift,
} from './helpers/instanced_contexts';
import { EMPTY_TEST_WORLD } from './sim_shared';

// The gate reads position and two membership maps and nothing else, so the
// world is trimmed to terrain: no camps, npcs or ground objects to spawn.
function makeSim(seed = 42): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false, world: EMPTY_TEST_WORLD });
}

function entityOf(sim: Sim, pid: number): Entity {
  const e = sim.ctx.entities.get(pid);
  if (!e) throw new Error(`missing entity ${pid}`);
  return e;
}

/** Park a body at an exact far-east coordinate with no membership anywhere:
 *  the geometry arm's input, isolated. */
function parkAt(sim: Sim, pid: number, x: number, z: number): Vec3 {
  const e = entityOf(sim, pid);
  e.pos = sim.ctx.groundPos(x, z);
  e.prevPos = { ...e.pos };
  sim.ctx.rebucket(e);
  return e.pos;
}

function stockOf(sim: Sim, pid: number): Record<string, number> {
  const meta = sim.meta(pid);
  if (!meta) throw new Error(`missing meta ${pid}`);
  return meta.vault.stock;
}

describe('vaultDrawBlocked: the six instanced contexts each refuse', () => {
  // Each case asserts the OPEN-WORLD premise first. Without it a predicate
  // stuck at true would pass every case here, and the suite would pin nothing.
  it('refuses inside a dungeon instance', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    placeInOpenWorld(sim, pid);
    expect(vaultDrawBlocked(sim.ctx, pid)).toBe(false);

    const placement = placeInDungeon(sim, pid);

    expect(placement.dungeonId).toBe('hollow_crypt'); // the placement really claimed a slot
    expect(vaultDrawBlocked(sim.ctx, pid)).toBe(true);
  });

  it('refuses inside a raid instance', () => {
    // The raid-REQUIRED wing through the real raid flow (attune, five-strong
    // group, convert, zone in), so this is a raid rather than a solo claim on
    // a raid-allowed id. Pins the dungeon arm's raid half.
    const sim = makeSim();
    const pid = sim.playerId;
    placeInOpenWorld(sim, pid);
    expect(vaultDrawBlocked(sim.ctx, pid)).toBe(false);

    const placement = placeInRaid(sim, pid);

    expect(placement.dungeonId).toBe('nythraxis_boss_arena');
    expect(placement.raiders.length).toBe(5);
    expect(vaultDrawBlocked(sim.ctx, pid)).toBe(true);

    // A second raider who zones in is refused too, so the answer is not
    // special to whoever claimed the slot.
    const second = placement.raiders[1];
    expect(enterDungeon(sim.ctx, placement.dungeonId, second)).toBe(true);
    expect(vaultDrawBlocked(sim.ctx, second)).toBe(true);

    // But a raider still standing in town is ALLOWED. The gate is about where
    // a player stands, never about who they grouped with: raid membership is
    // not itself a refusal, and a predicate that keyed on the party would fail
    // here. (The battleground and arena arms key on the roster precisely
    // because those two have no in-town half.)
    const inTown = placement.raiders[2];
    expect(vaultDrawBlocked(sim.ctx, inTown)).toBe(false);
  });

  it('refuses inside a delve run', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    placeInOpenWorld(sim, pid);
    expect(vaultDrawBlocked(sim.ctx, pid)).toBe(false);

    const { run } = placeInDelve(sim, pid);

    expect(run.delveId).toBe('collapsed_reliquary');
    expect(sim.delveRunForPlayer(pid)).not.toBeNull(); // ctx.delveRunForPlayer, the arm's authority
    expect(vaultDrawBlocked(sim.ctx, pid)).toBe(true);
  });

  it('refuses inside a rift floor', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    placeInOpenWorld(sim, pid);
    expect(vaultDrawBlocked(sim.ctx, pid)).toBe(false);

    const { instance } = placeInRift(sim, pid);

    expect(instance.partyKey).not.toBeNull(); // a live claim, not a free slot
    expect(vaultDrawBlocked(sim.ctx, pid)).toBe(true);
  });

  it('refuses inside a battleground match', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    placeInOpenWorld(sim, pid);
    expect(vaultDrawBlocked(sim.ctx, pid)).toBe(false);

    const { opponent } = placeInBattleground(sim, pid);

    expect(sim.ctx.bgMatches.has(pid)).toBe(true); // ctx.bgMatches, the arm's authority
    expect(vaultDrawBlocked(sim.ctx, pid)).toBe(true);
    expect(vaultDrawBlocked(sim.ctx, opponent)).toBe(true); // both teams, not just team 0
  });

  it('refuses inside an arena match', () => {
    // Arena is the deliberate SIXTH context: ranked bouts postdate the
    // five-context ruling and inherit its competitive-parity rationale.
    const sim = makeSim();
    const pid = sim.playerId;
    placeInOpenWorld(sim, pid);
    expect(vaultDrawBlocked(sim.ctx, pid)).toBe(false);

    const { opponent } = placeInArena(sim, pid);

    expect(sim.ctx.arenaMatches.has(pid)).toBe(true); // ctx.arenaMatches, the arm's authority
    expect(vaultDrawBlocked(sim.ctx, pid)).toBe(true);
    expect(vaultDrawBlocked(sim.ctx, opponent)).toBe(true);
  });
});

describe('vaultDrawBlocked: the open world allows the draw', () => {
  it('allows a plain open-world position', () => {
    const sim = makeSim();
    placeInOpenWorld(sim, sim.playerId);
    expect(vaultDrawBlocked(sim.ctx, sim.playerId)).toBe(false);
  });

  it('allows a body exactly ON the instance threshold and refuses one yard east', () => {
    // The boundary sits ON the comparison: the arm is `pos.x > threshold`, so
    // the threshold itself is still the open world. The east probe is 179 yards
    // west of the nearest dungeon footprint (origin x 100300, half width 120),
    // so ONLY the geometry backstop can answer for it: this is that arm's
    // decisive pin.
    const sim = makeSim();
    const pid = sim.playerId;
    // The literal the comment above derives every distance from. Pinned so the
    // arithmetic in that comment (and the 100001 probe below) cannot quietly
    // stop describing the code.
    expect(DUNGEON_X_THRESHOLD).toBe(100_000);

    parkAt(sim, pid, DUNGEON_X_THRESHOLD, -1250);
    expect(vaultDrawBlocked(sim.ctx, pid)).toBe(false);

    parkAt(sim, pid, DUNGEON_X_THRESHOLD + 1, -1250);
    expect(vaultDrawBlocked(sim.ctx, pid)).toBe(true);
  });

  it('refuses in the far-east void beyond every band', () => {
    // Where a half-finished teleport or a hand-edited save parks a character:
    // east of the battleground band, inside no instance at all.
    const sim = makeSim();
    const pid = sim.playerId;
    parkAt(sim, pid, 200_000, 0);
    expect(sim.ctx.bgMatches.has(pid)).toBe(false);
    expect(vaultDrawBlocked(sim.ctx, pid)).toBe(true);
  });
});

describe('vaultDrawBlocked: membership and geometry disagree', () => {
  it('refuses a battleground member whose body is outside the band', () => {
    // THE DECISIVE PIN for the bgMatches arm. The roster entry survives while
    // the body reads as open world (the pre-teleport and post-match frames):
    // drop the membership arm and geometry alone answers false here.
    const sim = makeSim();
    const pid = sim.playerId;
    placeInBattleground(sim, pid);
    placeInOpenWorld(sim, pid);

    expect(sim.ctx.bgMatches.has(pid)).toBe(true);
    expect(entityOf(sim, pid).pos.x).toBeLessThanOrEqual(DUNGEON_X_THRESHOLD); // geometry says open world
    expect(vaultDrawBlocked(sim.ctx, pid)).toBe(true);
  });

  it('refuses a body inside the battleground band with no match', () => {
    // The other direction: a slot freed the moment a wipe resolved. Geometry
    // answers alone here, because no roster entry exists.
    const sim = makeSim();
    const pid = sim.playerId;
    const origin = battlegroundOrigin(0);
    parkAt(sim, pid, origin.x, origin.z);

    expect(sim.ctx.bgMatches.has(pid)).toBe(false);
    expect(vaultDrawBlocked(sim.ctx, pid)).toBe(true);
  });

  it('refuses an arena member whose body is outside the band', () => {
    // THE DECISIVE PIN for the arenaMatches arm, the same shape as the
    // battleground one above.
    const sim = makeSim();
    const pid = sim.playerId;
    placeInArena(sim, pid);
    placeInOpenWorld(sim, pid);

    expect(sim.ctx.arenaMatches.has(pid)).toBe(true);
    expect(entityOf(sim, pid).pos.x).toBeLessThanOrEqual(DUNGEON_X_THRESHOLD);
    expect(vaultDrawBlocked(sim.ctx, pid)).toBe(true);
  });

  it('refuses a body inside the arena band with no match', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const origin = arenaOrigin(0);
    parkAt(sim, pid, origin.x, origin.z);

    expect(sim.ctx.arenaMatches.has(pid)).toBe(false);
    expect(vaultDrawBlocked(sim.ctx, pid)).toBe(true);
  });
});

describe('vaultDrawBlocked: fail-closed inputs', () => {
  it('refuses an unresolvable pid', () => {
    // A draw we cannot place is a draw we do not perform.
    const sim = makeSim();
    expect(vaultDrawBlocked(sim.ctx, 999_999)).toBe(true);
  });

  it('refuses a non-finite position', () => {
    // Decisive: every comparison against NaN is false, so without the finite
    // guard a corrupt x would slip past the band comparison and read as the
    // open world.
    const sim = makeSim();
    const pid = sim.playerId;
    placeInOpenWorld(sim, pid);
    expect(vaultDrawBlocked(sim.ctx, pid)).toBe(false);

    entityOf(sim, pid).pos.x = Number.NaN;

    expect(vaultDrawBlocked(sim.ctx, pid)).toBe(true);
  });

  it('refuses a non-finite Z even when X reads as the open world', () => {
    // The separate half of the guard, and the one a single-axis check misses:
    // the band comparison only ever looks at x, so a corrupt z would sail
    // through it and read as the open world while every footprint arm above
    // silently answered no (each compares z, and every comparison against NaN
    // is false). BOTH axes are consumed, so both are checked.
    const sim = makeSim();
    const pid = sim.playerId;
    placeInOpenWorld(sim, pid);
    expect(vaultDrawBlocked(sim.ctx, pid)).toBe(false);
    expect(Number.isFinite(entityOf(sim, pid).pos.x)).toBe(true); // x stays sane

    entityOf(sim, pid).pos.z = Number.NaN;

    expect(vaultDrawBlocked(sim.ctx, pid)).toBe(true);
  });
});

describe('vaultDrawBlocked: the footprint arms decide on their own', () => {
  // ARM LIVENESS. Every shipped instance footprint sits east of
  // DUNGEON_X_THRESHOLD, so in the live world the geometry backstop answers
  // first and the footprint arms are never the deciding vote (the header note
  // on subsumption). These two cases are the ONLY construction that makes them
  // decide: a claim whose footprint has been moved WEST of the threshold, so
  // the backstop provably cannot answer and a deleted arm turns the case red.
  //
  // Synthetic by necessity, and that is the point rather than a caveat. The
  // arms exist so the gate stays correct independently of where the band
  // layout happens to sit today; a future band placed west of the threshold is
  // exactly the case the module's own comment warns about. Pinning them here
  // means the layout can move without the gate quietly losing its teeth.
  const QA_WEST_DUNGEON = '__vault_qa_west_dungeon';
  const QA_WEST_INDEX = -100; // instanceOrigin x = INSTANCE_X_BASE + 900 + index * 600

  beforeAll(() => {
    (DUNGEONS as Record<string, DungeonDef>)[QA_WEST_DUNGEON] = {
      ...DUNGEONS.hollow_crypt,
      id: QA_WEST_DUNGEON,
      index: QA_WEST_INDEX,
      spawns: [],
    };
  });
  afterAll(() => {
    delete (DUNGEONS as Record<string, DungeonDef>)[QA_WEST_DUNGEON];
  });

  it('refuses inside a claimed dungeon slot whose footprint sits west of the threshold', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const origin = instanceOrigin(QA_WEST_INDEX, 0);
    // Premise: the backstop cannot be what answers below.
    expect(origin.x).toBeLessThan(DUNGEON_X_THRESHOLD);

    // Clone a real pool slot so every field (including combatExitMemory) is
    // the shipped shape, then claim it for the synthetic westward dungeon.
    const template = sim.ctx.instances[0];
    sim.ctx.instances.push({
      ...template,
      dungeonId: QA_WEST_DUNGEON,
      slot: 0,
      partyKey: 'solo:qa',
      exitId: 999,
      clearedBy: new Set<number>(),
      enteredBy: new Set<number>(),
    });
    parkAt(sim, pid, origin.x, origin.z);

    expect(entityOf(sim, pid).pos.x).toBeLessThan(DUNGEON_X_THRESHOLD);
    expect(instanceInfoAt(sim.ctx, entityOf(sim, pid).pos)?.dungeonId).toBe(QA_WEST_DUNGEON);
    expect(vaultDrawBlocked(sim.ctx, pid)).toBe(true);
  });

  it('a corrupt (NaN) position never binds to its party live delve run', () => {
    // The regression class the loop's negated continues exist for: NaN fails
    // BOTH `<= 120` and `> 120`, so a band test written with the bare `>`
    // sense would fall through and report the corrupt position as inside the
    // run from anywhere. The membership read must match nothing, and the
    // gate's own non-finite guard must still refuse ahead of it.
    const sim = makeSim();
    const pid = sim.playerId;
    placeInDelve(sim, pid);
    const p = entityOf(sim, pid);
    p.pos.x = Number.NaN;
    p.pos.z = Number.NaN;
    expect(sim.delveRunForPlayer(pid)).toBeNull();
    expect(vaultDrawBlocked(sim.ctx, pid)).toBe(true);
  });

  it('refuses inside a delve run whose box sits west of the threshold', () => {
    // The delve arm's own liveness case. A DelveRun carries its origin as
    // stored state, so the run can be moved without touching content.
    const sim = makeSim();
    const pid = sim.playerId;
    const { run } = placeInDelve(sim, pid);
    run.origin.x = 500;
    run.origin.z = 500;
    parkAt(sim, pid, 500, 500);

    expect(entityOf(sim, pid).pos.x).toBeLessThan(DUNGEON_X_THRESHOLD);
    expect(sim.delveRunForPlayer(pid)).not.toBeNull();
    expect(vaultDrawBlocked(sim.ctx, pid)).toBe(true);
  });

  // The RIFT arm has no equivalent case and deliberately gets none: every rift
  // floor origin is riftInstanceOrigin(slot, floorIndex), whose x is the
  // constant RIFT_X_MIN regardless of slot, so no rift footprint can be moved
  // west of the threshold without editing data.ts. Its coverage stays the
  // composite per-context case above, plus the source pin below, plus the
  // alignment pins here, which give the fast path's static rift band term the
  // same data-derived discipline the dungeon half gets from claimWestReach.
  it('the fast-path rift band term stays aligned with the rift claim geometry', () => {
    // The band's west edge must contain the westmost reach a rift floor's
    // detection region can have (RIFT_X_MIN - RIFT_REGION_HALF_X): a region
    // half-width grown past the band margin would let a rift claim answer
    // where isRiftPos reads false, and the arm's band guard would skip it.
    expect(RIFT_BAND_X_MIN).toBeLessThanOrEqual(RIFT_X_MIN - RIFT_REGION_HALF_X);
    // And the whole reachable rift geometry sits east of the threshold, the
    // premise the fast path's static term (RIFT_BAND_X_MIN >
    // DUNGEON_X_THRESHOLD) compiles in: derived here from the same symbols
    // the region read uses, so moving the band or growing the region reddens
    // this pin instead of silently widening the fast path.
    expect(RIFT_X_MIN - RIFT_REGION_HALF_X).toBeGreaterThan(DUNGEON_X_THRESHOLD);
    expect(RIFT_BAND_X_MIN).toBeGreaterThan(DUNGEON_X_THRESHOLD);
  });
});

describe('vaultDrawBlocked keeps all six arms', () => {
  it('asks each authority exactly once, in one predicate', () => {
    // A SOURCE pin, which is the weaker instrument, used here because for one
    // arm it is the ONLY instrument. Behaviourally, the four position-keyed
    // arms are subsumed by the geometry backstop (the header note); the two
    // membership arms and the backstop have decisive behavioural pins; and the
    // RIFT arm has neither, because riftInstanceOrigin pins every floor's x to
    // the constant RIFT_X_MIN, so no rift footprint can sit west of the
    // threshold for a behavioural case to catch a deleted arm. Deleting the
    // rift arm today changes NO observable answer, which is exactly why this
    // pin exists: the arms are there so the gate survives a band layout that
    // moves, and a silently dropped arm would only be discovered by the
    // content change that makes it load-bearing again.
    //
    // Comments are blanked first (preserving line structure), so a comment
    // naming an arm can never stand in for the call itself.
    const src = readFileSync(
      fileURLToPath(new URL('../src/sim/vault_craft_gate.ts', import.meta.url)),
      'utf8',
    );
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const start = stripped.indexOf('export function vaultDrawBlocked(');
    expect(start).toBeGreaterThanOrEqual(0);
    const end = stripped.indexOf('\n}', start);
    expect(end).toBeGreaterThan(start);
    const body = stripped.slice(start, end);

    // One occurrence each: a second copy of an arm would mean two answers for
    // one question, and zero means the arm is gone.
    for (const token of [
      'ctx.bgMatches.has(', // battleground membership
      'ctx.arenaMatches.has(', // arena membership, the deliberate sixth context
      'ctx.delveRunForPlayer(', // delve run registry
      'instanceInfoAt(', // dungeon AND raid, one claim-footprint read
      'riftInstanceAtPos(', // rift floors, the arm with no behavioural pin
      'DUNGEON_X_THRESHOLD', // the geometry backstop
    ]) {
      expect(body.split(token).length - 1, `${token} inside vaultDrawBlocked`).toBe(1);
    }

    // The round-4 hoist re-anchor: the backstop must stay AHEAD of the two
    // pool scans. East of the threshold every scan outcome already ended in
    // true, so the order is behavior-neutral (the behavioural cases live
    // above: open world, exact threshold, threshold + 1, far-east void, NaN);
    // what the order carries is the perf contract, no instance-slot walk per
    // broadcast for a session standing inside an instance. Unambiguous
    // because the loop above just proved each token occurs exactly once.
    const backstopAt = body.indexOf('DUNGEON_X_THRESHOLD');
    expect(backstopAt).toBeLessThan(body.indexOf('instanceInfoAt('));
    expect(backstopAt).toBeLessThan(body.indexOf('riftInstanceAtPos('));
  });
});

describe('vaultDrawStock and craftVaultStockFor', () => {
  it('hands back null everywhere a draw is refused', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    stockOf(sim, pid).copper_ore = 12;
    placeInOpenWorld(sim, pid);
    // Premise: the stock IS readable out here, so null below means the gate.
    expect(vaultDrawStock(sim.ctx, pid)).not.toBeNull();
    expect(craftVaultStockFor(sim.ctx, pid)).toEqual({ copper_ore: 12 });

    placeInDungeon(sim, pid);

    expect(vaultDrawStock(sim.ctx, pid)).toBeNull();
    expect(craftVaultStockFor(sim.ctx, pid)).toBeNull();
  });

  it('craftVaultDrawBlockedFor agrees with the projection over the real gate arms', () => {
    // The cvault wire signature stands the gate-only probe in for the
    // projection every snapshot (server/vault_wire.ts): blocked must imply a
    // null projection and an open-world stocked player must read unblocked
    // with a non-null projection, over the REAL arms rather than a fake. A
    // divergence here is exactly the class the hand-written wire fakes
    // cannot catch.
    const sim = makeSim();
    const pid = sim.playerId;
    stockOf(sim, pid).copper_ore = 5;
    placeInOpenWorld(sim, pid);
    expect(craftVaultDrawBlockedFor(sim.ctx, pid)).toBe(false);
    expect(craftVaultStockFor(sim.ctx, pid)).toEqual({ copper_ore: 5 });

    placeInDungeon(sim, pid);
    expect(craftVaultDrawBlockedFor(sim.ctx, pid)).toBe(true);
    expect(craftVaultStockFor(sim.ctx, pid)).toBeNull();

    // A membership arm on a FRESH world (a delve cannot be entered from
    // inside the dungeon claim above).
    const delveSim = makeSim();
    const delvePid = delveSim.playerId;
    stockOf(delveSim, delvePid).copper_ore = 5;
    placeInDelve(delveSim, delvePid);
    expect(craftVaultDrawBlockedFor(delveSim.ctx, delvePid)).toBe(true);
    expect(craftVaultStockFor(delveSim.ctx, delvePid)).toBeNull();

    // An unresolvable pid is blocked (the fail-closed arm) and null.
    expect(craftVaultDrawBlockedFor(sim.ctx, 999_999)).toBe(true);
    expect(craftVaultStockFor(sim.ctx, 999_999)).toBeNull();
  });

  it('clones only the drawable rows, filtering every degenerate count', () => {
    // A corrupt row STAYS DORMANT: never counted, never spent, never deleted.
    // Each of these is a distinct way a hand-edited or future-shaped save can
    // present a count, and each is listed so a filter that dropped one arm
    // (say, kept 1e21) fails on that key by name.
    const sim = makeSim();
    const pid = sim.playerId;
    placeInOpenWorld(sim, pid);
    const stock = stockOf(sim, pid);
    stock.copper_ore = 7; // the one good row
    stock.iron_ore = Number.NaN;
    stock.silverleaf_herb = Number.POSITIVE_INFINITY;
    stock.spider_leg = 2.5;
    stock.arcane_dust = -3;
    stock.smithing_flux = 1e21; // past MAX_SAFE_INTEGER: a decrement would be a float no-op
    stock.ironbark_log = 0;
    // The ruled boundary is INCLUSIVE (positive integer <= MAX_SAFE_INTEGER),
    // so the exact boundary value is a positive control: a filter tightened
    // to >= (excluding the last safe integer) reds on this key by name.
    stock.wolf_fang = Number.MAX_SAFE_INTEGER;

    const clone = craftVaultStockFor(sim.ctx, pid);

    expect(clone).toEqual({ copper_ore: 7, wolf_fang: Number.MAX_SAFE_INTEGER });
    expect(Object.keys(clone ?? {}).sort()).toEqual(['copper_ore', 'wolf_fang']);
    // And the live record is untouched: dormant, not destroyed.
    expect(Object.hasOwn(stock, 'smithing_flux')).toBe(true);
    expect(stock.ironbark_log).toBe(0);
  });

  it('copies an own __proto__ row as inert data, never as a prototype', () => {
    // sanitizeVaultState DEFINES a dormant own '__proto__' row rather than
    // dropping it, so the clone must be built through fromEntries: a keyed
    // `clone[id] = n` onto a plain object would reach the inherited setter,
    // silently losing the row (or re-parenting the clone).
    const sim = makeSim();
    const pid = sim.playerId;
    placeInOpenWorld(sim, pid);
    const stock = stockOf(sim, pid);
    Object.defineProperty(stock, '__proto__', {
      value: 4,
      enumerable: true,
      writable: true,
      configurable: true,
    });
    stock.copper_ore = 1;

    const clone = craftVaultStockFor(sim.ctx, pid);

    expect(clone).not.toBeNull();
    expect(Object.getPrototypeOf(clone)).toBe(Object.prototype); // never re-parented
    expect(Object.hasOwn(clone as object, '__proto__')).toBe(true); // the row survived the copy
    expect(Object.keys(clone as object).sort()).toEqual(['__proto__', 'copper_ore']);
  });

  it('is a fresh clone: mutating it never reaches the live vault', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    placeInOpenWorld(sim, pid);
    const stock = stockOf(sim, pid);
    stock.copper_ore = 5;

    const clone = craftVaultStockFor(sim.ctx, pid);
    expect(clone).not.toBe(stock); // not the live record by reference
    if (clone) {
      clone.copper_ore = 999;
      clone.silverleaf_herb = 42;
    }

    expect(stock.copper_ore).toBe(5);
    expect(Object.hasOwn(stock, 'silverleaf_herb')).toBe(false);
  });

  it('vaultDrawStock hands back the LIVE record, so sequential reagents see each spend', () => {
    // The consume path plans one reagent, spends it, then plans the next: a
    // second reagent naming the same material must see the first one's spend.
    // This is the deliberate difference from craftVaultStockFor's clone.
    const sim = makeSim();
    const pid = sim.playerId;
    placeInOpenWorld(sim, pid);
    const stock = stockOf(sim, pid);
    stock.copper_ore = 5;

    expect(vaultDrawStock(sim.ctx, pid)).toBe(stock);
  });
});
