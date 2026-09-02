// The zone-celebration fan-out shape (Phase 18, item zone-celebration-fanout-
// tenants): MEASURED, then kept. The four tenants (gatherRareEvent and
// masterworkZone in src/sim/professions/gather_events.ts, attunedZone in
// attunement_events.ts, legendaryForgedZone in perfecting.ts) mint one
// pid-scoped SimEvent per in-zone recipient through emitToZonePlayers, and
// server/event_frame.ts serializes each copy once. The recorded alternative (serialize the
// pid-independent fragment once, splice the pid per recipient) was benched on
// 2026-08-31 against the real payload shapes:
//   per recipient: mint + stringify 96 to 119 ns (137 to 192 bytes per copy);
//   shared-bytes splice 8 to 11 ns; saving 85 to 109 ns per recipient.
//   per celebration: 200 in-zone = 24 us today vs 2 us shared (22 us saved);
//   5,000 in one zone (the realm cap) = 594 us vs 53 us (541 us saved, once).
//   realm rate: 0.4 us per SECOND, derived below; at an implausible
//   10 celebrations per second with 1,000 in-zone it is 54 us per 50 ms tick
//   (0.11% of the budget); the absolute ceiling (2.5/s, all 5,000 players in
//   one zone) is 68 us per tick (0.14%).
// The win is negligible at every plausible rate, and the splice would buy a
// cross-module key-order invariant (pid must stay the second key in three sim
// literals) plus a second serialization path beside serializeEventFragments.
// REFUSED on the numbers.
//
// THE REALM-RATE DERIVATION (re-derived 2026-08-31 from the WIDEST tenant's
// own cadence, not from a celebration-shaped guess): gatherRareEvent is the
// fan-out's highest-frequency producer, and its cadence is
// GATHER_RARE_EVENT_CHANCE = 1/90 per harvest, drawn once per gather-node
// harvest (professions/gathering.ts) AND once per farming crop harvest
// (professions/farming.ts, the same shared constant by design). A saturated
// TUNED zone offers 18 nodes on a 240s respawn, so 1,200s / 240s x 18 = at
// most ~90 node harvests per zone per 20 minutes, and 90 x 1/90 = about ONE
// event per zone per 20 minutes. Twenty zones is 1 celebration per minute
// realm-wide; at the measured 200 in-zone that is ~24 us of stringify per
// celebration, hence 24 us / 60 s = 0.4 us per second. The farming crop
// harvest is a SECOND, unpriced stream on the same constant, so the true
// realm rate is higher than the node-only term above: the refusal does not
// rest on the exact figure, because the recorded headroom is three orders of
// magnitude (10 celebrations per SECOND, 25x the node-only realm rate per
// zone, still costs 0.11% of a tick). The pin below holds the cadence
// constant so a retune re-opens this paragraph rather than silently aging it.
//
// AMENDED 2026-08-31 (the Phase 18 hot-path review): the SERIALIZATION figures
// above are right, but they priced the wrong term. The dominant cost of a
// celebration was never stringifying it, it was ROUTING it: routeEvents gave
// every session a full walk of the whole batch with no per-pid index, so one
// celebration cost recipients x sessions selection iterations (200 in-zone at
// 1,000 sessions = 200,000 in one tick; the recorded 5,000 x 5,000 ceiling =
// 25 million), three to four orders of magnitude above the 24 us / 594 us
// stringify term it was being weighed against. That term is now gone rather
// than re-measured: server/event_pid_index.ts buckets the batch by pid ONCE and
// each session pays O(its own pid-scoped events + the broadcast set), pinned by
// the counting arms in tests/event_pid_index.test.ts. The splice refusal above
// stands on its own numbers, which is why the record is amended in place and
// not withdrawn.
//
// MEASURED 2026-09-02 (Phase 19E, qr-19-zone-celebration-fanout-shape): the half
// neither record above priced, the O(all players) walk in emitToZonePlayers with a
// zoneAt call per player. On this file's fixture shape (in-zone recipients at the
// zone-1 centre, the rest spread over the other fourteen zones, one in ten in instance
// space), Node v26, median of five: about 100 ns per non-home player (zoneAt is a
// linear early-return scan of the 15-entry ZONES list, so a player costs the index of
// the zone they stand in), which is 84 us per celebration at 1,000 players with 200
// in-zone, 471 us at the 5,000-player realm cap with 200 in-zone, and 165 us with all
// 5,000 in the celebration zone. That is about 20x the 24 us stringify term above and
// the leading per-celebration cost, but a per-celebration spike rather than a per-tick
// one: 1% of one 50 ms tick per celebration at the cap, 0.17% at 1,000 players, 8 us
// per second at the record's cadence. Two premises corrected while measuring: the
// realm rate is every tenant's cadence summed (the derivation above prices the widest
// tenant alone), and ZONES holds 15 where the derivation says twenty (conservative).
// A rect test against the celebration zone's own rect would cut the walk 12x (38 us at
// the cap) with no new state; a cached per-player zoneId does no better on the walk.
// RULED 2026-09-02 (Option 1): ACCEPTED ON THE NUMBER, no production code; the scan-premise
// arm at the bottom of this file pins the walk shape so an index, a bucket or a rect test
// re-opens this measurement here first.
//
// These pins hold the premises both records rest on: the payload stays small
// and flat, every copy differs from its siblings by the pid alone (so the day a
// tenant grows a large per-recipient payload or a second varying field, the
// serialization measurement re-opens here first), and the fan-out width itself
// is what the routing measurement was taken against (so a tenant that grows the
// recipient set past the measured shape re-opens THAT one here too).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DUNGEON_X_THRESHOLD, zoneAt } from '../src/sim/data';
import { announceAttunement } from '../src/sim/professions/attunement_events';
import {
  announceGatherRareEvent,
  announceMasterworkZone,
  announceZoneCelebration,
  GATHER_RARE_EVENT_CHANCE,
} from '../src/sim/professions/gather_events';
import type { PlayerMeta } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { SimEvent } from '../src/sim/types';
import { stripComments } from './helpers/strip_comments';

// The scan-premise arm at the bottom counts zoneAt calls, so the data module is
// wrapped (a partial mock that delegates to the real function): every importer,
// the fixture below and src/sim/professions/gather_events.ts alike, sees the
// same counted binding. Behaviour is unchanged; only the call count is observed.
vi.mock('../src/sim/data', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/sim/data')>();
  return { ...mod, zoneAt: vi.fn(mod.zoneAt) };
});

/** The small-flat-payload premise: every per-recipient copy of every tenant
 *  serializes under this many bytes (the bench's largest copy was 192). */
const CELEBRATION_COPY_MAX_BYTES = 256;

interface FakeWorld {
  ctx: SimContext;
  events: SimEvent[];
  zoneId: string;
  inZone: number[];
  farZone: number;
  instanced: number;
}

/** A minimal SimContext slice the fan-out reads: entities with positions,
 *  players keyed by pid with a name, emit, and the deed-stat bump the
 *  attunement producer calls before fanning out. */
function fakeWorld(inZoneCount: number): FakeWorld {
  const events: SimEvent[] = [];
  const entities = new Map<number, { pos: { x: number; z: number } }>();
  const players = new Map<number, { entityId: number; name: string }>();
  const zoneId = zoneAt(0, 0).id;
  const inZone: number[] = [];
  for (let i = 0; i < inZoneCount; i++) {
    const pid = 100 + i;
    entities.set(pid, { pos: { x: (i % 7) * 3, z: (i % 5) * 3 } });
    players.set(pid, { entityId: pid, name: `Celebrant${i}` });
    inZone.push(pid);
  }
  for (const pid of inZone) {
    const e = entities.get(pid) as { pos: { x: number; z: number } };
    if (zoneAt(e.pos.x, e.pos.z).id !== zoneId) throw new Error('fixture left the zone');
  }
  // One player in another overworld zone (walk z until the zone changes, the
  // masterwork_zone_broadcast idiom) and one in instance space.
  let z = 0;
  for (let i = 0; i < 400 && zoneAt(0, z).id === zoneId; i++) z += 50;
  if (zoneAt(0, z).id === zoneId) throw new Error('no second zone found along z');
  const farZone = 900;
  entities.set(farZone, { pos: { x: 0, z } });
  players.set(farZone, { entityId: farZone, name: 'Farhand' });
  const instanced = 901;
  entities.set(instanced, { pos: { x: DUNGEON_X_THRESHOLD + 100, z: 0 } });
  players.set(instanced, { entityId: instanced, name: 'Delver' });
  const ctx = {
    entities,
    players,
    emit: (ev: SimEvent) => {
      events.push(ev);
    },
    bumpDeedStat: () => {},
    // The gather tenant's finder-side mark hook (it fans out first, then
    // writes one visit mark); the fan-out itself never touches either.
    markVisited: () => {},
  } as unknown as SimContext;
  return { ctx, events, zoneId, inZone, farZone, instanced };
}

function stripPid(ev: SimEvent): string {
  const { pid: _pid, ...rest } = ev as SimEvent & { pid?: number };
  return JSON.stringify(rest);
}

function expectOneSmallCopyPerRecipient(world: FakeWorld, type: string): void {
  const copies = world.events.filter((ev) => ev.type === type);
  expect(copies).toHaveLength(world.inZone.length);
  const pids = copies.map((ev) => (ev as { pid?: number }).pid);
  expect([...pids].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(world.inZone);
  expect(pids).not.toContain(world.farZone);
  expect(pids).not.toContain(world.instanced);
  // Every copy is the SAME payload apart from the pid: the premise under
  // which a shared-bytes splice was even a candidate, and the one that keeps
  // the per-copy cost a constant.
  const shapes = new Set(copies.map(stripPid));
  expect(shapes.size).toBe(1);
  for (const ev of copies) {
    expect(Buffer.byteLength(JSON.stringify(ev))).toBeLessThanOrEqual(CELEBRATION_COPY_MAX_BYTES);
  }
}

/** The finder the gather tenant announces for. Its reliquary mark is
 *  pre-held, so noteReliquaryMark returns at its first line: this suite pins
 *  the FAN-OUT, and the deed/reliquary hooks that ride beside it have their
 *  own suites. */
function fakeFinder(entityId: number, name: string, flavor: string): PlayerMeta {
  return {
    entityId,
    name,
    reliquary: { marks: new Set([`gather_event:${flavor}`]) },
  } as unknown as PlayerMeta;
}

describe('zone celebration fan-out: one small pid-only-varying copy per in-zone recipient', () => {
  it('gatherRareEvent (the widest tenant: it fans out on the rare-event cadence)', () => {
    // The fourth tenant, and the one the realm-rate derivation above is taken
    // from. Unlike the other three it names its zone from the node or bed
    // rather than the celebrant's position, so it reaches emitToZonePlayers
    // directly instead of through announceZoneCelebration; the recipient rule
    // (in-zone, overworld only) is the same one.
    const world = fakeWorld(12);
    announceGatherRareEvent(
      world.ctx,
      fakeFinder(world.inZone[0], 'Celebrant0', 'golden_harvest'),
      { zoneId: world.zoneId, type: 'crop' },
      'golden_harvest',
      'vale_wheat',
    );
    expectOneSmallCopyPerRecipient(world, 'gatherRareEvent');
  });

  it('masterworkZone', () => {
    const world = fakeWorld(12);
    announceMasterworkZone(world.ctx, world.inZone[0], 'Grimmschaedel', {
      itemId: 'eastbrook_ritual_vestments',
      recipeId: 'recipe_eastbrook_ritual_vestments',
    } as Parameters<typeof announceMasterworkZone>[3]);
    expectOneSmallCopyPerRecipient(world, 'masterworkZone');
  });

  it('attunedZone (the personal attuned event rides beside it, once)', () => {
    const world = fakeWorld(12);
    announceAttunement(world.ctx, world.inZone[3], 'blacksmith_mining');
    expectOneSmallCopyPerRecipient(world, 'attunedZone');
    expect(world.events.filter((ev) => ev.type === 'attuned')).toHaveLength(1);
  });

  it('legendaryForgedZone through the shared prologue, with the perfecting literal shape', () => {
    // promotePerfectedCopy is internal to perfecting.ts; its fan-out call is
    // announceZoneCelebration with exactly this literal (pinned by the
    // perfecting suites), so the shape premise is measured through the same
    // prologue here.
    const world = fakeWorld(12);
    announceZoneCelebration(world.ctx, world.inZone[5], (recipientPid, zoneId) => ({
      type: 'legendaryForgedZone',
      pid: recipientPid,
      ownerPid: world.inZone[5],
      ownerName: 'Grimmschaedel',
      itemId: 'wyrmfall_pendant',
      itemName: 'Oath of the Dawnbreaker',
      zoneId,
    }));
    expectOneSmallCopyPerRecipient(world, 'legendaryForgedZone');
  });

  it('an instanced celebrant fans out nothing (the personal event alone fires)', () => {
    const world = fakeWorld(4);
    announceMasterworkZone(world.ctx, world.instanced, 'Delver', {
      itemId: 'eastbrook_ritual_vestments',
      recipeId: 'recipe_eastbrook_ritual_vestments',
    } as Parameters<typeof announceMasterworkZone>[3]);
    expect(world.events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The ROUTING measurement's own premises (the 2026-08-31 amendment). Both
// records above are products of two numbers: how many events one celebration
// puts in the batch, and how many sessions the batch is routed to. These pin
// both multiplicands, so a tenant that changes either re-opens the measurement
// here first rather than silently invalidating a recorded figure.
// ---------------------------------------------------------------------------

/** The sample the routing term was measured at: 200 in-zone, 1,000 sessions. */
const MEASURED_RECIPIENTS = 200;
const MEASURED_SESSIONS = 1_000;
/** The recorded absolute ceiling: a full realm, all of it in one zone. */
const CEILING_RECIPIENTS = 5_000;
const CEILING_SESSIONS = 5_000;

describe('the fan-out measurement premises (batch size x session count)', () => {
  it('the realm rate rests on the rare-event cadence, one draw per harvest', () => {
    // The third input, beside the two multiplicands below: how OFTEN a
    // celebration happens at all. The 0.4 us per second figure is derived from
    // this constant (see the derivation in this file's header), so a retune
    // moves the recorded rate and must re-open the record here first.
    expect(GATHER_RARE_EVENT_CHANCE).toBe(1 / 90);
    // Both harvest paths draw on the SAME constant (state.md D12: never a
    // farming copy of it), which is why the realm rate is the node term PLUS
    // an unpriced farming term rather than the node term alone. Read as source
    // text: a second constant, or a caller that stops sharing this one, is
    // exactly the change that would invalidate the derivation.
    const callers = ['src/sim/professions/gathering.ts', 'src/sim/professions/farming.ts'];
    for (const caller of callers) {
      // Comment-stripped: prose naming either symbol must not stand in for a
      // call site, in EITHER direction (the positive arm would pass on a
      // mention, the negative one would fail on one).
      const src = stripComments(readFileSync(resolve(process.cwd(), caller), 'utf8'));
      expect(src, `${caller} should still roll the shared rare-event cadence`).toContain(
        'rollGatherRareEvent(',
      );
      expect(src, `${caller} must not carry its own copy of the cadence`).not.toContain(
        'GATHER_RARE_EVENT_CHANCE =',
      );
    }
  });

  it('one celebration puts exactly ONE event per recipient in the batch, at every width', () => {
    // The first multiplicand. It is 1:1 and LINEAR, which is what makes
    // "recipients x sessions" the right arithmetic: a tenant that started
    // minting two events per recipient, or one shared event plus a per-recipient
    // rider, would double or bend the term and fails here.
    for (const recipients of [1, 12, 64]) {
      const world = fakeWorld(recipients);
      announceMasterworkZone(world.ctx, world.inZone[0], 'Grimmschaedel', {
        itemId: 'eastbrook_ritual_vestments',
        recipeId: 'recipe_eastbrook_ritual_vestments',
      } as Parameters<typeof announceMasterworkZone>[3]);
      expect(world.events).toHaveLength(recipients);
      expect(world.events.filter((ev) => ev.type === 'masterworkZone')).toHaveLength(recipients);
    }
  });

  it('the recorded ceiling is the realm admission cap on BOTH multiplicands', () => {
    // The second multiplicand, and the bound on the first: the recipient set is
    // "every player in the zone", so both ceilings are the realm admission cap.
    // Read as SOURCE TEXT rather than imported for the same reason
    // server/bank_vault_ledger_guard.ts mirrors it: server/http/config.ts fails
    // fast without DATABASE_URL and cannot be imported into a DB-less unit run.
    const config = readFileSync(resolve(process.cwd(), 'server/http/config.ts'), 'utf8');
    const match = config.match(/const DEFAULT_MAX_PLAYERS_PER_REALM = (\d+);/);
    expect(match, 'the realm admission cap default moved or was renamed').not.toBeNull();
    const realmCap = Number((match as RegExpMatchArray)[1]);
    expect(realmCap).toBe(CEILING_RECIPIENTS);
    expect(realmCap).toBe(CEILING_SESSIONS);
    // The measured sample sits inside that ceiling on both axes, so the two
    // recorded figures bracket the same space rather than describing two.
    expect(MEASURED_RECIPIENTS).toBeLessThan(CEILING_RECIPIENTS);
    expect(MEASURED_SESSIONS).toBeLessThan(CEILING_SESSIONS);
  });
});

// ---------------------------------------------------------------------------
// The SCAN premise (Phase 19E, qr-19-zone-celebration-fanout-shape). The half
// the two records above never priced is the walk itself: emitToZonePlayers
// visits EVERY player on the realm roster and resolves zoneAt for every
// overworld one, once per celebration. It was measured (header) and ACCEPTED
// on the number, so this arm pins the shape the number rests on: the day the
// walk is indexed, bucketed or rect-tested, this reds first and the
// measurement re-opens here rather than silently aging.
// ---------------------------------------------------------------------------

describe('the scan premise: one celebration walks the whole roster, one zoneAt per overworld player', () => {
  it('visits every roster entry once and resolves zoneAt once per non-instanced player, at every width', () => {
    for (const recipients of [1, 12, 64]) {
      const world = fakeWorld(recipients);
      // The roster the walk must cover: the recipients plus the far-zone
      // bystander plus the instanced player the fixture always adds.
      const roster = world.ctx.players.size;
      expect(roster).toBe(recipients + 2);
      // The one read the walk makes per player is entities.get; count it on the
      // fixture's own Map (an own property shadows the prototype method).
      let visits = 0;
      const entities = world.ctx.entities as Map<number, unknown>;
      const rawGet = entities.get.bind(entities);
      entities.get = ((id: number) => {
        visits++;
        return rawGet(id);
      }) as typeof entities.get;
      const counted = vi.mocked(zoneAt);
      counted.mockClear();
      announceMasterworkZone(world.ctx, world.inZone[0], 'Grimmschaedel', {
        itemId: 'eastbrook_ritual_vestments',
        recipeId: 'recipe_eastbrook_ritual_vestments',
      } as Parameters<typeof announceMasterworkZone>[3]);
      // announceZoneCelebration resolves the celebrant once (one read, one
      // zoneAt) before the walk; the walk then reads every roster entry once
      // and resolves zoneAt for every overworld player, skipping only the
      // instanced one on the x-threshold compare. A bucket, an index or a rect
      // test changes one of these two counts; the recipient set does not.
      expect(visits).toBe(1 + roster);
      expect(counted).toHaveBeenCalledTimes(1 + (roster - 1));
      expect(world.events.filter((ev) => ev.type === 'masterworkZone')).toHaveLength(recipients);
    }
  });
});
