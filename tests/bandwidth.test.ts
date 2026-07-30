import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { GameServer, wireEntity } from '../server/game';
import { VALE_CUP_BALL_TEMPLATE_ID } from '../src/sim/content/vale_cup';
import type { Entity } from '../src/sim/types';
import { STABLE_TIMER_WIRE_VERSION } from '../src/world_api';

const LEGACY_INTEREST_RADIUS = 120;
const SNAPSHOTS_PER_SECOND = 20;
const PLAYERS = 30;
const WARMUP_TICKS = 5;
const MEASURE_TICKS = 200;

// Interest-scan constants re-typed from server/game.ts (module-private there). The
// inline reference below reproduces the exact per-viewer scan the shared-candidate
// path replaced, so it must use the same radii/rates the real body uses.
const INTEREST_RADIUS = 90;
const INTEREST_DROP_RADIUS = 100;
const NPC_INTEREST_RADIUS = 120;
const NPC_DROP_RADIUS = 130;
const INTEREST_QUERY_RADIUS = NPC_DROP_RADIUS; // widest radius any kind needs
const FULL_RATE_RADIUS_SQ = 55 * 55;
const HALF_RATE_RADIUS_SQ = 80 * 80;
const HALF_RATE_DIVISOR = 2;
const QUARTER_RATE_DIVISOR = 4;

interface RefSent {
  idVer: number;
  dynVer: number;
  auraVer: number;
  sentAtTick: number;
  settled: boolean;
}

// interestLimitSq re-typed verbatim from server/game.ts.
function refInterestLimitSq(e: Entity, known: boolean): number {
  if (e.kind === 'npc') {
    return known ? NPC_DROP_RADIUS * NPC_DROP_RADIUS : NPC_INTEREST_RADIUS * NPC_INTEREST_RADIUS;
  }
  return known ? INTEREST_DROP_RADIUS * INTEREST_DROP_RADIUS : INTEREST_RADIUS * INTEREST_RADIUS;
}

// isUpdateDue re-typed verbatim from server/game.ts.
function refIsUpdateDue(
  tick: number,
  e: Entity,
  d2: number,
  viewer: Entity,
  sentAtTick: number,
): boolean {
  if (e.templateId === VALE_CUP_BALL_TEMPLATE_ID) return true;
  if (d2 <= FULL_RATE_RADIUS_SQ) return true;
  if (viewer.targetId === e.id || e.aggroTargetId === viewer.id) return true;
  const divisor = d2 <= HALF_RATE_RADIUS_SQ ? HALF_RATE_DIVISOR : QUARTER_RATE_DIVISOR;
  return tick - sentAtTick >= divisor;
}

// The OLD per-viewer interest scan, replicated inline against the live grid: gather
// exactly what grid.forEachInRadius(anchor.pos, INTEREST_QUERY_RADIUS) used to gather
// and run the unchanged snapshot body over its own shadow sentEnts (never the real
// session.sentEnts). It calls the REAL private canObserveEntity/wireCacheFor via the
// cast server, so it produces the exact wire JSON the real broadcast produces; only
// the GATHERING differs (old per-viewer scan here vs shared per-cell in the server).
// If the shared path is byte-neutral, the emitted ents/keep must match tick for tick.
// gatherRadius overrides the scan radius for the decisiveness self-check only.
function referenceEntsKeep(
  server: any,
  anchor: Entity,
  stableTimerWire: boolean,
  shadow: Map<number, RefSent>,
  tick: number,
  gatherRadius = INTEREST_QUERY_RADIUS,
): { ents: string[]; keep: number[] } {
  const ents: string[] = [];
  const keep: number[] = [];
  const present = new Set<number>();
  const queryLimitSq = INTEREST_QUERY_RADIUS * INTEREST_QUERY_RADIUS;
  server.sim.grid.forEachInRadius(
    anchor.pos.x,
    anchor.pos.z,
    gatherRadius,
    (e: Entity, d2: number) => {
      if (d2 > queryLimitSq) return;
      if (e.id === anchor.id) return;
      if (!server.canObserveEntity(anchor, e, d2)) return;
      const known = shadow.get(e.id);
      const limitSq =
        anchor.targetId === e.id
          ? NPC_DROP_RADIUS * NPC_DROP_RADIUS
          : refInterestLimitSq(e, known !== undefined);
      if (d2 > limitSq) return;
      present.add(e.id);
      const cache = server.wireCacheFor(e, stableTimerWire);
      if (known === undefined) {
        ents.push(stableTimerWire ? cache.fullAuraJson : cache.fullJson);
        shadow.set(e.id, {
          idVer: cache.idVer,
          dynVer: cache.dynVer,
          auraVer: cache.auraVer,
          sentAtTick: tick,
          settled: true,
        });
        return;
      }
      const auraChanged = stableTimerWire && known.auraVer !== cache.auraVer;
      if (known.idVer !== cache.idVer) {
        ents.push(auraChanged ? cache.fullAuraJson : cache.fullJson);
        known.idVer = cache.idVer;
        known.dynVer = cache.dynVer;
        known.auraVer = cache.auraVer;
        known.sentAtTick = tick;
        known.settled = false;
        return;
      }
      if (
        !refIsUpdateDue(tick, e, d2, anchor, known.sentAtTick) ||
        (known.dynVer === cache.dynVer && !auraChanged && known.settled)
      ) {
        keep.push(e.id);
        return;
      }
      known.settled = known.dynVer === cache.dynVer;
      known.dynVer = cache.dynVer;
      known.auraVer = cache.auraVer;
      known.sentAtTick = tick;
      ents.push(auraChanged ? cache.liteAuraJson : cache.liteJson);
    },
  );
  for (const id of shadow.keys()) {
    if (!present.has(id)) shadow.delete(id);
  }
  return { ents, keep };
}

interface CrowdMember {
  pid: number;
  characterId: number;
  session: any;
  lastFrame: string;
  shadow: Map<number, RefSent>;
}

// Join a session whose fake socket records its latest raw snapshot frame, and place
// its entity at (x, z). Positions are re-bucketed by the caller (a tick, or an
// explicit grid.refresh) before the scan reads them.
function joinAt(server: GameServer, characterId: number, name: string, x: number, z: number) {
  const member: CrowdMember = {
    pid: 0,
    characterId,
    session: null,
    lastFrame: '',
    shadow: new Map(),
  };
  const ws = {
    readyState: 1,
    send: (payload: string) => {
      const snap = JSON.parse(payload);
      if (snap.t === 'snap') member.lastFrame = payload;
    },
  };
  const session = server.join(ws as any, characterId, characterId, name, 'warrior', null);
  if ('error' in session) throw new Error(session.error);
  member.pid = session.pid;
  member.session = session;
  session.blockListLoaded = true;
  const e = server.sim.entities.get(session.pid)!;
  e.pos.x = x;
  e.pos.z = z;
  return member;
}

function refreshGrids(server: GameServer): void {
  server.sim.grid.refresh(server.sim.entities.values());
  server.sim.playerGrid.refresh((server as any).sim.playerEntities());
}

function stableWire(session: any): boolean {
  return session.timerWireVersion === STABLE_TIMER_WIRE_VERSION;
}

// Byte-exact assertion that the real frame's ents array equals the reference's, plus
// its keep list. The ents array appears verbatim as `"ents":[...]` in the raw frame,
// so a substring match is byte-exact; keep is compared as a parsed array (order and
// membership both matter).
function expectFrameMatches(member: CrowdMember, ref: { ents: string[]; keep: number[] }): void {
  expect(member.lastFrame).toContain(`"ents":[${ref.ents.join(',')}]`);
  const snap = JSON.parse(member.lastFrame);
  expect(snap.keep ?? []).toEqual(ref.keep);
}

// deterministic LCG so the walk pattern is reproducible
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

describe('crowd bandwidth', () => {
  it('cuts entity-stream bytes by more than half for a walking town crowd', () => {
    const server = new GameServer();
    const rng = makeRng(42);
    const sessions: { pid: number; bytes: number }[] = [];

    for (let i = 0; i < PLAYERS; i++) {
      const holder = { pid: 0, bytes: 0 };
      const ws = {
        readyState: 1,
        send: (payload: string) => {
          const snap = JSON.parse(payload);
          if (snap.t !== 'snap') return;
          // measure only the entity stream; self is identical in both protocols
          holder.bytes +=
            JSON.stringify(snap.ents).length + (snap.keep ? JSON.stringify(snap.keep).length : 0);
        },
      };
      const session = server.join(ws as any, i + 1, i + 1, `Walker${i}`, 'warrior', null);
      if ('error' in session) throw new Error(session.error);
      holder.pid = session.pid;
      sessions.push(holder);
      // every player walks in their own direction across the starter town
      const meta = server.sim.meta(session.pid)!;
      meta.moveInput.forward = true;
      const e = server.sim.entities.get(session.pid)!;
      e.facing = rng() * Math.PI * 2;
    }

    const broadcast = () => (server as any).broadcastSnapshots();
    for (let i = 0; i < WARMUP_TICKS; i++) {
      server.sim.tick();
      broadcast();
    }
    for (const s of sessions) s.bytes = 0;

    let legacyBytes = 0;
    for (let i = 0; i < MEASURE_TICKS; i++) {
      server.sim.tick();
      // legacy protocol: every entity within 120yd, full record, every tick
      for (const s of sessions) {
        const p = server.sim.entities.get(s.pid)!;
        const ents: string[] = [];
        server.sim.grid.forEachInRadius(p.pos.x, p.pos.z, LEGACY_INTEREST_RADIUS, (e) => {
          if (e.id === s.pid) return;
          ents.push(JSON.stringify(wireEntity(e)));
        });
        legacyBytes += `[${ents.join(',')}]`.length;
      }
      broadcast();
    }

    const newBytes = sessions.reduce((sum, s) => sum + s.bytes, 0);
    const seconds = MEASURE_TICKS / SNAPSHOTS_PER_SECOND;
    const perClient = (b: number) => b / PLAYERS / seconds / 1024;
    console.log(
      `entity-stream bandwidth, ${PLAYERS} players walking in town: ` +
        `legacy ${perClient(legacyBytes).toFixed(1)} KB/s/client -> ` +
        `new ${perClient(newBytes).toFixed(1)} KB/s/client ` +
        `(${(100 - (newBytes / legacyBytes) * 100).toFixed(0)}% reduction)`,
    );

    expect(newBytes).toBeLessThan(legacyBytes * 0.5);
  }, 30000);
});

// The set of entity ids a session currently sees: those streamed in full/lite (ents)
// plus those kept alive by a bare id (keep).
function framePresentIds(frame: string): Set<number> {
  const snap = JSON.parse(frame);
  const ids = new Set<number>();
  for (const e of snap.ents ?? []) ids.add(e.id);
  for (const id of snap.keep ?? []) ids.add(id);
  return ids;
}

// Count grid.forEachInRadius calls during exactly one broadcast pass. The interest
// scan is the only grid query in the pass (frost rings / hourglasses are plain array
// filters, not grid queries), so this counts distinct occupied anchor cells: one per
// session when sparse, fewer when co-located viewers share a cell.
function countGridQueries(server: GameServer): number {
  const grid = (server as any).sim.grid;
  const orig = grid.forEachInRadius.bind(grid);
  let count = 0;
  grid.forEachInRadius = (x: number, z: number, r: number, cb: unknown) => {
    count++;
    return orig(x, z, r, cb);
  };
  try {
    (server as any).broadcastSnapshots();
  } finally {
    grid.forEachInRadius = orig;
  }
  return count;
}

describe('shared interest-candidate gathering', () => {
  // The shared per-cell query replaces the per-viewer grid scan. Each test drives the
  // real GameServer.broadcastSnapshots and pins its per-session ents/keep byte-for-byte
  // against an inline reference that gathers the OLD per-viewer way and runs the exact
  // unchanged body (calling the real private canObserveEntity/wireCacheFor) over its own
  // shadow sentEnts. Byte-identity proves the gathering change is output-neutral.
  it('is byte-identical to the per-viewer scan for a co-located crowd across ticks', () => {
    const server = new GameServer();
    const rng = makeRng(7);
    // 8 players spread across two adjacent cells (cellSize 32): x in {0,20,40,60}.
    const crowd: CrowdMember[] = [];
    for (let i = 0; i < 8; i++) {
      const m = joinAt(server, i + 1, `Dense${i}`, (i % 4) * 20, Math.floor(i / 4) * 20);
      server.sim.meta(m.pid)!.moveInput.forward = true;
      server.sim.entities.get(m.pid)!.facing = rng() * Math.PI * 2;
      crowd.push(m);
    }
    for (let t = 0; t < 12; t++) {
      server.sim.tick();
      // reference first: it primes the tick-memoized wire cache identically, then the
      // real broadcast reads the same memoized JSON.
      const refs = crowd.map((m) =>
        referenceEntsKeep(
          server,
          server.sim.entities.get(m.pid)!,
          stableWire(m.session),
          m.shadow,
          server.sim.tickCount,
        ),
      );
      (server as any).broadcastSnapshots();
      crowd.forEach((m, i) => {
        expectFrameMatches(m, refs[i]);
      });
    }
  });

  it('still matches the per-viewer scan after a same-tick displacement across a cell boundary', () => {
    const server = new GameServer();
    const viewer = joinAt(server, 1, 'Viewer', 0, 0);
    const target = joinAt(server, 2, 'Target', 31, 0); // cell 0 (x < 32)
    const other = joinAt(server, 3, 'Other', 5, 5);
    const all = [viewer, target, other];
    const runTick = () => {
      const refs = all.map((m) =>
        referenceEntsKeep(
          server,
          server.sim.entities.get(m.pid)!,
          stableWire(m.session),
          m.shadow,
          server.sim.tickCount,
        ),
      );
      (server as any).broadcastSnapshots();
      all.forEach((m, i) => {
        expectFrameMatches(m, refs[i]);
      });
    };
    for (let t = 0; t < 3; t++) {
      server.sim.tick();
      runTick();
    }
    // Same-tick displacement: advance the tick, then shove the target across the x=32
    // cell boundary and re-bucket (the end-of-tick refresh the real server relies on)
    // BEFORE this tick's first broadcast, so the wire re-serializes the new position.
    server.sim.tick();
    const cellSize = server.sim.grid.cellSize;
    const te = server.sim.entities.get(target.pid)!;
    const beforeCx = Math.floor(te.pos.x / cellSize);
    te.pos.x = 60; // cell 1
    // exercise the real displacement mechanism too: applyKnockback walks pos directly
    // with no grid call of its own, relying on the same end-of-tick refresh below.
    (server as any).sim.applyKnockback(
      server.sim.entities.get(viewer.pid),
      server.sim.entities.get(other.pid),
      3,
    );
    refreshGrids(server);
    expect(Math.floor(te.pos.x / cellSize)).not.toBe(beforeCx); // crossed a cell boundary
    runTick();
    // decisive: the displaced target (now ~60yd from the viewer) is still found by the
    // viewer's shared-cell query.
    expect(framePresentIds(viewer.lastFrame).has(target.pid)).toBe(true);
  });

  it('preserves stealth visibility (a party mate sees the sneak, a distant viewer does not)', () => {
    const server = new GameServer();
    const sneak = joinAt(server, 1, 'Sneak', 0, 0);
    const mate = joinAt(server, 2, 'Mate', 10, 0); // same party, close
    const stranger = joinAt(server, 3, 'Stranger', 110, 0); // not party, beyond stealth detection
    server.sim.partyInvite(mate.pid, sneak.pid);
    server.sim.partyAccept(mate.pid);
    const all = [sneak, mate, stranger];
    for (let t = 0; t < 4; t++) {
      server.sim.tick();
      // updateAuras recomputes e.stealthed from auras each tick; force it on after the
      // tick and before the scan so the scenario stays stealthed.
      server.sim.entities.get(sneak.pid)!.stealthed = true;
      const refs = all.map((m) =>
        referenceEntsKeep(
          server,
          server.sim.entities.get(m.pid)!,
          stableWire(m.session),
          m.shadow,
          server.sim.tickCount,
        ),
      );
      (server as any).broadcastSnapshots();
      all.forEach((m, i) => {
        expectFrameMatches(m, refs[i]);
      });
    }
    // decisive: the shared path did not change who can observe a stealthed player.
    expect(framePresentIds(mate.lastFrame).has(sneak.pid)).toBe(true);
    expect(framePresentIds(stranger.lastFrame).has(sneak.pid)).toBe(false);
  });

  it('anchors a spectator on its target: its stream matches a viewer at the target position', () => {
    const server = new GameServer();
    const target = joinAt(server, 1, 'Target', 50, 50);
    const bystander = joinAt(server, 2, 'Bystand', 60, 55); // near the target, shares its cell region
    const mod = joinAt(server, 3, 'Mod', 500, 500); // far from the target
    // mod spectates target: its interest anchor becomes the target entity.
    mod.session.spectating = {
      characterId: target.characterId,
      name: 'Target',
      savedPos: { ...server.sim.entities.get(mod.pid)!.pos },
      priorGm: false,
      stowedPet: null,
    };
    for (let t = 0; t < 4; t++) {
      server.sim.tick();
      // the spectator's reference anchor is the TARGET entity, not mod's own.
      const modRef = referenceEntsKeep(
        server,
        server.sim.entities.get(target.pid)!,
        stableWire(mod.session),
        mod.shadow,
        server.sim.tickCount,
      );
      const bystanderRef = referenceEntsKeep(
        server,
        server.sim.entities.get(bystander.pid)!,
        stableWire(bystander.session),
        bystander.shadow,
        server.sim.tickCount,
      );
      (server as any).broadcastSnapshots();
      expectFrameMatches(mod, modRef);
      expectFrameMatches(bystander, bystanderRef);
    }
  });

  it('issues one grid query per occupied cell: one per viewer when sparse, shared when dense', () => {
    // sparse: each anchor in a distinct, non-adjacent cell -> one query per viewer, no
    // overhead versus the old one-query-per-viewer cost.
    const sparse = new GameServer();
    const sparseCrowd = [0, 1, 2, 3].map((i) => joinAt(sparse, i + 1, `Far${i}`, i * 500, 0));
    refreshGrids(sparse);
    expect(countGridQueries(sparse)).toBe(sparseCrowd.length);

    // dense: every anchor in one cell -> a single shared query for all of them.
    const dense = new GameServer();
    const denseCrowd = [0, 1, 2, 3, 4, 5].map((i) => joinAt(dense, i + 1, `Near${i}`, i * 4, 0));
    refreshGrids(dense);
    const denseQueries = countGridQueries(dense);
    expect(denseQueries).toBe(1);
    expect(denseQueries).toBeLessThan(denseCrowd.length);
  });

  it('reveals a moderator leaving spectate to co-located viewers this tick (new hoisted ordering)', () => {
    // The one intentional non-byte-identical behavior change: hoisting all anchor
    // resolution (including the vanished-spectate exitSpectate fallback) ahead of the
    // shared-candidate build makes a moderator leaving spectate limbo visible to
    // co-located viewers one tick earlier, never later. Gameplay-neutral. This pin is
    // DECISIVE against the hoist because the NEIGHBOR joins BEFORE the moderator: under
    // the old single-pass inline ordering the neighbor's snapshot is built while the
    // moderator is still in limbo (its exitSpectate fallback runs later, during the
    // moderator's own iteration), so it would NOT see the moderator this tick. Only the
    // hoisted resolve pass, which restores the moderator before any snapshot builds,
    // reveals it now, so the final assertion passes only with the hoist in place.
    const server = new GameServer();
    const neighbor = joinAt(server, 1, 'Neighbor', 18, 18); // joins FIRST, near mod's savedPos
    const mod = joinAt(server, 2, 'Mod', 20, 20);
    const target = joinAt(server, 3, 'Target', 400, 400);
    (server as any).enterSpectate(mod.session, target.session); // mod -> limbo, savedPos = (20,20)
    // while spectating, the moderator sits in limbo and the neighbor cannot see it.
    server.sim.tick();
    (server as any).broadcastSnapshots();
    expect(framePresentIds(neighbor.lastFrame).has(mod.pid)).toBe(false);
    // target goes offline this tick: mod's broadcast-pass exitSpectate fallback restores
    // mod to savedPos in the hoisted resolve pass, before the neighbor's snapshot builds.
    target.session.left = true;
    server.sim.tick();
    (server as any).broadcastSnapshots();
    expect(framePresentIds(neighbor.lastFrame).has(mod.pid)).toBe(true);
  });

  it('isolates a per-session throw across both the resolve and build passes', () => {
    // The rewire split the single guarded snapshot loop into two guarded passes
    // (anchor resolve, then build), each with its own onError. A throw building one
    // session's anchor or snapshot must not starve any other session this tick, and the
    // build-pass handler now reports resolved.session.pid. Force a throw in EACH pass
    // and confirm a clean co-located sibling still gets its frame and both handlers fire.
    const server = new GameServer();
    const resolveThrower = joinAt(server, 1, 'BadResolve', 0, 0);
    const buildThrower = joinAt(server, 2, 'BadBuild', 4, 0);
    const sibling = joinAt(server, 3, 'Sibling', 8, 0); // co-located, joins LAST
    // pass 1 (anchor resolution) throws for resolveThrower: reading spectating.name throws.
    (resolveThrower.session as any).spectating = {
      get name() {
        throw new Error('resolve boom');
      },
    };
    // pass 2 (build) throws for buildThrower: sentEnts.get throws mid-build.
    (buildThrower.session as any).sentEnts = {
      get() {
        throw new Error('build boom');
      },
    };
    refreshGrids(server);
    server.sim.tick();
    refreshGrids(server);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => (server as any).broadcastSnapshots()).not.toThrow();
      // the clean sibling still received its snapshot despite both throwers.
      expect(sibling.lastFrame).not.toBe('');
      // both guarded passes reported their failure (build handler via resolved.session.pid).
      const messages = errSpy.mock.calls.map((c) => String(c[0]));
      expect(messages.some((m) => m.includes('failed to resolve anchor'))).toBe(true);
      expect(messages.some((m) => m.includes('failed to build snapshot'))).toBe(true);
    } finally {
      errSpy.mockRestore();
    }
  });

  it('counts bcVisits as the exact per-viewer in-range set (self included), invariant to sharing', () => {
    const server = new GameServer();
    const crowd = [0, 1, 2, 3, 4, 5].map((i) =>
      joinAt(server, i + 1, `V${i}`, (i % 3) * 15, Math.floor(i / 3) * 15),
    );
    refreshGrids(server);
    server.sim.tick();
    refreshGrids(server);
    // independent expectation: entities within INTEREST_QUERY_RADIUS of each anchor,
    // self included (grid's own d2 <= radius^2 cutoff, and d2(self) = 0).
    let expected = 0;
    for (const m of crowd) {
      const a = server.sim.entities.get(m.pid)!;
      server.sim.grid.forEachInRadius(a.pos.x, a.pos.z, INTEREST_QUERY_RADIUS, () => {
        expected++;
      });
    }
    (server as any).perfDetailActive = true;
    (server as any).bcVisits = 0;
    (server as any).broadcastSnapshots();
    expect((server as any).bcVisits).toBe(expected);
  });

  it('is decisive: shrinking the reference gather radius diverges from the real frames', () => {
    // Guards against a vacuous pin: with a deliberately too-small gather radius the
    // reference misses in-interest candidates the real shared path still finds, so the
    // frames must NOT match. If this ever passes, the equality pins above prove nothing.
    const server = new GameServer();
    const crowd = [0, 1, 2].map((i) => joinAt(server, i + 1, `S${i}`, i * 40, 0)); // 0, 40, 80
    refreshGrids(server);
    server.sim.tick();
    (server as any).broadcastSnapshots();
    let anyMismatch = false;
    for (const m of crowd) {
      const shrunk = referenceEntsKeep(
        server,
        server.sim.entities.get(m.pid)!,
        stableWire(m.session),
        new Map(),
        server.sim.tickCount,
        INTEREST_QUERY_RADIUS - 75, // 55: drops the far-but-in-interest neighbor at 80yd
      );
      if (!m.lastFrame.includes(`"ents":[${shrunk.ents.join(',')}]`)) anyMismatch = true;
    }
    expect(anyMismatch).toBe(true);
  });
});
