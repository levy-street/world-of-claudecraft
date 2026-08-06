import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BG_BASES,
  BG_FLAG_Z,
  BG_GRAVEYARDS,
  BG_HALF_X,
  BG_HALF_Z,
  BG_POWER_RUNES,
  BG_SPEED_RUNES,
  bgFieldPlanWalls,
} from '../src/sim/battleground_layout';
import { battlegroundOrigin } from '../src/sim/data';
import { BATTLEGROUND_FIRST_WIN_BONUS_HONOR } from '../src/sim/pvp';
import { BG_CAPS_TO_WIN, BG_TIME_WARNINGS } from '../src/sim/social/battleground';
import {
  BattlegroundScoreboard,
  BG_END_CAUSE_KEYS,
  BG_END_CAUSE_LOG_KEYS,
  BG_KILL_FEED_MAX,
  BG_KILL_FEED_TTL,
  type BgAllTimeEntry,
  type BgEndBannerInput,
  buildBgEndBannerView,
  buildBgMapModel,
  buildBgScoreboardView,
  buildBgTimeWarningView,
  buildBgWindowView,
  pruneBgKillLines,
  pushBgKillLine,
} from '../src/ui/hud/battleground';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';
import { makeWriterFacet } from '../src/ui/painter_host';
import type { BgInfo, BgMatchInfo, PartyInfo } from '../src/world_api';

const baseInfo = (over: Partial<BgInfo> = {}): BgInfo => ({
  rating: 1500,
  wins: 0,
  losses: 0,
  captures: 0,
  queued: false,
  queueSize: 0,
  queuedParty: 1,
  firstWinBonusReady: false,
  match: null,
  ladder: [],
  ...over,
});

const baseMatch = (over: Partial<BgMatchInfo> = {}): BgMatchInfo => ({
  state: 'active',
  myTeam: 0,
  capsToWin: BG_CAPS_TO_WIN,
  scores: [1, 2],
  flags: [
    { state: 'home', carrierPid: null, carrierName: null, carrierTeam: null },
    { state: 'carried', carrierPid: 7, carrierName: 'Ravven', carrierTeam: 0 },
  ],
  players: [
    {
      pid: 7,
      name: 'Ravven',
      cls: 'warrior',
      team: 0,
      carrying: true,
      dead: false,
      kills: 3,
      deaths: 1,
      captures: 2,
      assists: 4,
    },
    {
      pid: 8,
      name: 'Bryn',
      cls: 'mage',
      team: 0,
      carrying: false,
      dead: true,
      kills: 0,
      deaths: 4,
      captures: 0,
      assists: 1,
    },
    {
      pid: 9,
      name: 'Cael',
      cls: 'priest',
      team: 1,
      carrying: false,
      dead: false,
      kills: 5,
      deaths: 0,
      captures: 1,
      assists: 0,
    },
  ],
  countdown: 0,
  timeLeft: 605,
  waveIn: [10, 5],
  respawnIn: 0,
  winner: null,
  ...over,
});

// Every property path the `bg` self key ships, pinned to literals: the flat
// scalars bgInfoFor returns, the match core sharedMatchView builds, and the two
// nested record shapes (flags, players). `[]` stands for an array element, so
// one row covers every roster entry. Source of truth:
// src/sim/social/battleground.ts (bgInfoFor + sharedMatchView), serialized onto
// the snapshot by server/game.ts `maybe('bg', ...)`.
const BG_WIRE_KEYS = new Set<string>([
  ...[
    'rating',
    'wins',
    'losses',
    'captures',
    'queued',
    'queueSize',
    'queuedParty',
    'firstWinBonusReady',
    'match',
    'ladder',
  ].map((k) => `.${k}`),
  ...['pid', 'name', 'cls', 'rating', 'wins', 'losses'].map((k) => `ladder[].${k}`),
  ...[
    'state',
    'myTeam',
    'capsToWin',
    'scores',
    'flags',
    'players',
    'countdown',
    'timeLeft',
    'waveIn',
    'respawnIn',
    'winner',
  ].map((k) => `match.${k}`),
  ...['state', 'carrierPid', 'carrierName', 'carrierTeam'].map((k) => `match.flags[].${k}`),
  ...[
    'pid',
    'name',
    'cls',
    'team',
    'carrying',
    'dead',
    'kills',
    'deaths',
    'captures',
    'assists',
  ].map((k) => `match.players[].${k}`),
]);

/**
 * Wrap `value` so every named property read is recorded into `seen` as a path.
 * Array methods (`filter`, `map`, the iterator) are handed back unbound, so
 * `this` stays the proxy and their element reads are intercepted too; array
 * elements are wrapped under a shared `path[]` so one roster row speaks for all.
 */
function watchReads(value: unknown, path: string, seen: Set<string>): unknown {
  if (value === null || typeof value !== 'object') return value;
  const isArray = Array.isArray(value);
  return new Proxy(value as object, {
    get(target, prop, receiver) {
      const raw = Reflect.get(target, prop, receiver);
      if (typeof prop === 'symbol') return raw;
      if (isArray) {
        // Numeric indices only; `length` and the Array.prototype methods are
        // machinery, not wire fields.
        return /^\d+$/.test(prop) ? watchReads(raw, `${path}[]`, seen) : raw;
      }
      seen.add(`${path}.${prop}`);
      return watchReads(raw, path === '' ? prop : `${path}.${prop}`, seen);
    },
  });
}

describe('battleground window view (pure core)', () => {
  it('models offline, idle, queued, and in-match states', () => {
    expect(
      buildBgWindowView({
        info: null,
        playerName: 'X',
        playerLevel: 20,
        party: null,
        playerId: 1,
        allTime: null,
      }).kind,
    ).toBe('offline');
    const idle = buildBgWindowView({
      info: baseInfo(),
      playerName: 'X',
      playerLevel: 20,
      party: null,
      playerId: 1,
      allTime: null,
    });
    expect(idle.kind).toBe('live');
    if (idle.kind !== 'live') return;
    expect(idle.action).toEqual({
      kind: 'idle',
      partySize: 1,
      requiredLevel: 20,
      locked: false,
      queueDisabled: false,
    });
    // Under the floor: same idle affordance, locked, with the requirement.
    const low = buildBgWindowView({
      info: baseInfo(),
      playerName: 'X',
      playerLevel: 19,
      party: null,
      playerId: 1,
      allTime: null,
    });
    if (low.kind !== 'live') throw new Error('expected live');
    expect(low.action).toEqual({
      kind: 'idle',
      partySize: 1,
      requiredLevel: 20,
      locked: true,
      queueDisabled: false,
    });
    expect(low.sig).not.toBe(idle.sig); // the lock re-renders

    const queued = buildBgWindowView({
      info: baseInfo({ queued: true, queueSize: 7, queuedParty: 3 }),
      playerName: 'X',
      playerLevel: 20,
      party: null,
      playerId: 1,
      allTime: null,
    });
    if (queued.kind !== 'live') throw new Error('expected live');
    expect(queued.action).toEqual({ kind: 'queued', queueSize: 7, queuedParty: 3 });

    const inMatch = buildBgWindowView({
      info: baseInfo({ match: baseMatch() }),
      playerName: 'X',
      playerLevel: 20,
      party: null,
      playerId: 1,
      allTime: null,
    });
    if (inMatch.kind !== 'live') throw new Error('expected live');
    expect(inMatch.action).toEqual({ kind: 'in-match', scoreCrimson: 1, scoreAzure: 2 });
  });

  // The sim refuses a non-leader's party queue press (bgQueueJoin), so the
  // window must not offer a live button that can only ever fail. Mirrors the
  // arena arm's own queueDisabled leader gate (arena_window_view.ts).
  it('disables the queue button for a party member who is not the leader', () => {
    const party = (leader: number): PartyInfo =>
      ({
        leader,
        raid: false,
        members: [
          { pid: 1, name: 'P1', cls: 'warrior', level: 20 },
          { pid: 2, name: 'P2', cls: 'mage', level: 20 },
        ],
      }) as unknown as PartyInfo;
    const rest = { info: baseInfo(), playerName: 'P2', playerLevel: 20, allTime: null };
    const member = buildBgWindowView({ ...rest, party: party(1), playerId: 2 });
    if (member.kind !== 'live') throw new Error('expected live');
    expect(member.action).toEqual({
      kind: 'idle',
      partySize: 2,
      requiredLevel: 20,
      locked: false,
      queueDisabled: true,
    });
    // The leader of the same party keeps the live button...
    const leader = buildBgWindowView({ ...rest, party: party(2), playerId: 2 });
    if (leader.kind !== 'live') throw new Error('expected live');
    expect(leader.action).toMatchObject({ partySize: 2, queueDisabled: false });
    // ...and the gate re-renders, so a promotion is not stuck behind the sig.
    expect(member.sig).not.toBe(leader.sig);
    // Solo is never gated: no party at all, and a degenerate one-member party.
    const solo = buildBgWindowView({ ...rest, party: null, playerId: 2 });
    if (solo.kind !== 'live') throw new Error('expected live');
    expect(solo.action).toMatchObject({ partySize: 1, queueDisabled: false });
  });

  it('ranks the all-time board, marks me, and flags unknown classes for the painter', () => {
    const allTime: BgAllTimeEntry[] = [
      { name: 'High', class: 'mage', level: 20, rating: 1700, wins: 9, losses: 1 },
      { name: 'Me', class: 'not_a_class', level: 12, rating: 1500, wins: 2, losses: 2 },
    ];
    const v = buildBgWindowView({
      info: baseInfo(),
      playerName: 'Me',
      playerLevel: 20,
      party: null,
      playerId: 1,
      allTime,
    });
    if (v.kind !== 'live') throw new Error('expected live');
    expect(v.allTime).not.toBeNull();
    expect(v.allTime![0]).toMatchObject({ rank: 1, name: 'High', knownClass: true, me: false });
    expect(v.allTime![1]).toMatchObject({ rank: 2, name: 'Me', knownClass: false, me: true });
  });

  it('reads ONLY fields the `bg` wire key ships, and survives its JSON round trip', () => {
    // This replaces a pin that compared two identically-shaped inputs and so
    // could not fail. Two teeth instead, both of which move when the cores
    // reach past the wire:
    //
    // (1) FIELD DEPENDENCY. Every property read off the payload is recorded
    //     through a proxy and checked against BG_WIRE_KEYS, the key set the
    //     server's encoder really emits (bgInfoFor + sharedMatchView in
    //     src/sim/social/battleground.ts, JSON.stringify'd onto the snapshot's
    //     `bg` self key in server/game.ts). A core that read a Sim-only field
    //     would work offline and render undefined for every online player;
    //     here it fails by name.
    // (2) SERIALIZATION. The offline arm is the LIVE object the Sim hands the
    //     HUD, carrying things JSON cannot express (an undefined-valued key, a
    //     live Map, a prototype accessor); the online arm is that same object
    //     after the exact JSON.parse(JSON.stringify(...)) hop the wire does.
    //     The two views must be equal, so the shapes genuinely differ.
    const live = baseInfo({
      rating: 1616,
      wins: 4,
      match: baseMatch(),
      // Non-empty so the live-ladder rows are really walked by the proxy: an
      // empty array would let a misnamed row field pass unnoticed.
      ladder: [{ pid: 7, name: 'Ravven', cls: 'warrior', rating: 1616, wins: 4, losses: 1 }],
    }) as BgInfo & Record<string, unknown>;
    // Sim-side baggage the wire cannot carry, on the object AND on its prototype.
    live.simOnlyUndefined = undefined;
    live.simOnlyMap = new Map([[7, 'Ravven']]);
    Object.setPrototypeOf(live, {
      get simOnlyAccessor(): number {
        return 42;
      },
    });
    const wire = JSON.parse(JSON.stringify(live)) as BgInfo;
    expect(Object.hasOwn(wire, 'simOnlyUndefined')).toBe(false);
    expect((wire as unknown as Record<string, unknown>).simOnlyAccessor).toBeUndefined();

    const inputRest = { playerName: 'X', playerLevel: 20, party: null, playerId: 1, allTime: null };
    expect(buildBgWindowView({ info: live, ...inputRest })).toEqual(
      buildBgWindowView({ info: wire, ...inputRest }),
    );
    // The per-tick scoreboard core gets the same arm: it reads the deepest
    // nested wire structure (flags, players, personal readouts).
    expect(buildBgScoreboardView(live, 7)).toEqual(buildBgScoreboardView(wire, 7));

    const seen = new Set<string>();
    const watched = watchReads(wire, '', seen) as BgInfo;
    buildBgWindowView({ info: watched, ...inputRest });
    buildBgScoreboardView(watched, 7);
    // Non-vacuous: the cores really did read through the proxy.
    expect(seen.size).toBeGreaterThan(10);
    expect(seen).toContain('match.players[].pid');
    expect(seen).toContain('ladder[].rating');
    expect([...seen].filter((path) => !BG_WIRE_KEYS.has(path))).toEqual([]);
  });

  // The Thornhollow tab's LIVE online ladder, the arena tabs' section for the
  // other ranked mode. Ranked by the order the snapshot ships (the sim already
  // sorted), "me" resolved by PID (never by name, which two characters can
  // share), and unknown class ids flagged for the painter to fall back on.
  it('ranks the live online ladder, marks me by pid, and flags unknown classes', () => {
    const v = buildBgWindowView({
      info: baseInfo({
        ladder: [
          { pid: 4, name: 'Top', cls: 'mage', rating: 1800, wins: 12, losses: 3 },
          { pid: 9, name: 'Me', cls: 'warrior', rating: 1520, wins: 3, losses: 2 },
          {
            pid: 5,
            name: 'Odd',
            cls: 'not_a_class' as never,
            rating: 1400,
            wins: 0,
            losses: 5,
          },
        ],
      }),
      // Same NAME as the top row, a different pid: the live ladder marks me by
      // identity, so this row must NOT come back as me.
      playerName: 'Top',
      playerLevel: 20,
      party: null,
      playerId: 9,
      allTime: null,
    });
    if (v.kind !== 'live') throw new Error('expected live');
    expect(v.ladder.map((r) => [r.rank, r.name, r.me, r.knownClass])).toEqual([
      [1, 'Top', false, true],
      [2, 'Me', true, true],
      [3, 'Odd', false, false],
    ]);
    expect(v.ladder[1]).toMatchObject({ rating: 1520, wins: 3, losses: 2 });
    // A ladder move re-renders: the signature carries the raw rows.
    const moved = buildBgWindowView({
      info: baseInfo({
        ladder: [{ pid: 9, name: 'Me', cls: 'warrior', rating: 1520, wins: 3, losses: 2 }],
      }),
      playerName: 'Top',
      playerLevel: 20,
      party: null,
      playerId: 9,
      allTime: null,
    });
    if (moved.kind !== 'live') throw new Error('expected live');
    expect(moved.sig).not.toBe(v.sig);
  });

  // Rolling deploy: a client can mirror a `bg` payload from a server that
  // predates the field. The section renders empty instead of throwing.
  it('survives a snapshot with no ladder field at all', () => {
    const legacy = baseInfo();
    delete (legacy as Partial<BgInfo>).ladder;
    const v = buildBgWindowView({
      info: legacy,
      playerName: 'X',
      playerLevel: 20,
      party: null,
      playerId: 1,
      allTime: null,
    });
    if (v.kind !== 'live') throw new Error('expected live');
    expect(v.ladder).toEqual([]);
  });
});

describe('battleground scoreboard view (pure core)', () => {
  it('is inactive with no match and active with the full readout', () => {
    expect(buildBgScoreboardView(null, 7).active).toBe(false);
    expect(buildBgScoreboardView(baseInfo(), 7).active).toBe(false);
    const v = buildBgScoreboardView(baseInfo({ match: baseMatch() }), 7);
    expect(v.active).toBe(true);
    expect(v.scoreCrimson).toBe(1);
    expect(v.scoreAzure).toBe(2);
    expect(v.capsToWin).toBe(BG_CAPS_TO_WIN);
    expect(v.minutes).toBe(10);
    expect(v.seconds).toBe(5);
    expect(v.flagStates).toEqual(['home', 'carried']);
    // The strip names no player, so the view models flag STATE only and never
    // the wire's carrierName (see the painter's flag-line comment). The carrier
    // is readable on the board instead, off the roster's own `carrying` flag.
    expect('carrierNames' in v).toBe(false);
    expect(v.board.filter((r) => r.carrying).map((r) => r.pid)).toEqual([7]);
    // The expanded board: both rosters in team order with the match tallies.
    expect(v.board).toHaveLength(3);
    expect(v.board[0]).toMatchObject({
      pid: 7,
      me: true,
      team: 0,
      kills: 3,
      deaths: 1,
      captures: 2,
      assists: 4,
    });
    expect(v.board[2]).toMatchObject({
      pid: 9,
      team: 1,
      kills: 5,
      captures: 1,
      assists: 0,
      me: false,
    });
  });

  it('keeps the structural sig stable across score/clock/state changes and moves it on roster changes', () => {
    const a = buildBgScoreboardView(baseInfo({ match: baseMatch() }), 7);
    const b = buildBgScoreboardView(
      baseInfo({
        match: baseMatch({
          scores: [4, 4],
          timeLeft: 3,
          flags: a.flagStates.map(() => ({
            state: 'dropped',
            carrierPid: null,
            carrierName: null,
            carrierTeam: null,
          })) as BgMatchInfo['flags'],
        }),
      }),
      7,
    );
    expect(b.sig).toBe(a.sig);
    const c = buildBgScoreboardView(
      baseInfo({
        match: baseMatch({
          players: baseMatch().players.slice(0, 2),
        }),
      }),
      7,
    );
    expect(c.sig).not.toBe(a.sig);
  });

  it('surfaces the personal wave-respawn readout', () => {
    const v = buildBgScoreboardView(baseInfo({ match: baseMatch({ respawnIn: 7 }) }), 7);
    expect(v.respawnIn).toBe(7);
    const countdown = buildBgScoreboardView(
      baseInfo({ match: baseMatch({ state: 'countdown', countdown: 6 }) }),
      7,
    );
    expect(countdown.state).toBe('countdown');
    expect(countdown.countdown).toBe(6);
  });
});

describe('battleground kill feed (pure core)', () => {
  const kill = (n: number) => ({
    killerName: `K${n}`,
    victimName: `V${n}`,
    killerTeam: 0,
    victimTeam: 1,
  });

  it('stamps expiry, caps the stack at the max, oldest first out', () => {
    let lines: ReturnType<typeof pushBgKillLine> = [];
    for (let i = 0; i < BG_KILL_FEED_MAX + 2; i++) lines = pushBgKillLine(lines, kill(i), 100 + i);
    expect(lines).toHaveLength(BG_KILL_FEED_MAX);
    expect(lines[0].killerName).toBe('K2'); // the two oldest dropped
    expect(lines.at(-1)).toMatchObject({
      killerName: `K${BG_KILL_FEED_MAX + 1}`,
      expiresAt: 100 + BG_KILL_FEED_MAX + 1 + BG_KILL_FEED_TTL,
    });
  });

  it('prunes only lapsed lines and returns the SAME array when nothing lapsed (elision)', () => {
    let lines: ReturnType<typeof pushBgKillLine> = [];
    lines = pushBgKillLine(lines, kill(0), 100);
    lines = pushBgKillLine(lines, kill(1), 104);
    expect(pruneBgKillLines(lines, 101)).toBe(lines); // reference-equal: no repaint
    const pruned = pruneBgKillLines(lines, 100 + BG_KILL_FEED_TTL);
    expect(pruned).toHaveLength(1);
    expect(pruned[0].killerName).toBe('K1');
    expect(pruneBgKillLines(pruned, 104 + BG_KILL_FEED_TTL)).toHaveLength(0);
  });
});

describe('battleground map view (pure core)', () => {
  const origin = battlegroundOrigin(0);
  const worldSlice = (myTeam: number, players: BgMatchInfo['players']) => ({
    bgInfo: baseInfo({ match: baseMatch({ myTeam, players }) }),
    playerId: 7,
    player: { pos: { x: origin.x + 10, z: origin.z - 100 }, facing: 0.5 },
    entities: new Map([
      [8, { pos: { x: origin.x - 5, z: origin.z - 90 }, dead: true }],
      [9, { pos: { x: origin.x + 20, z: origin.z + 50 }, dead: false }],
    ]),
  });

  it('is inactive outside a match and outside the band', () => {
    expect(buildBgMapModel({ ...worldSlice(0, []), bgInfo: null }).active).toBe(false);
    const outside = worldSlice(0, []);
    outside.player.pos.x = 0; // open world
    expect(buildBgMapModel(outside).active).toBe(false);
  });

  it('maps TEAMMATES only (never enemies), field-local, oriented home-down', () => {
    const players = baseMatch().players; // 7,8 crimson; 9 azure
    const asCrimson = buildBgMapModel(worldSlice(0, players));
    expect(asCrimson.active).toBe(true);
    // teammate 8 present in field-local coords; enemy 9 NEVER mapped
    expect(asCrimson.mates).toHaveLength(1);
    expect(asCrimson.mates[0]).toMatchObject({ x: -5, z: -90, dead: true });
    expect(asCrimson.self).toMatchObject({ x: 10, z: -100, facing: 0.5 });
    // azure viewers see the SAME field flipped: their keep reads at the bottom
    const players2 = players.map((p) => ({ ...p, team: 1 - p.team }));
    const asAzure = buildBgMapModel(worldSlice(1, players2));
    expect(asAzure.self).toMatchObject({ x: -10, z: 100 });
    expect(asAzure.mates[0]).toMatchObject({ x: 5, z: 90 });
  });

  it('reads home-down for BOTH teams: standing on your own stand maps to the bottom', () => {
    // The orientation contract stated against the real Thornhollow anchors
    // rather than against fixture numbers: whichever team you are, your own
    // flag stand is at negative z (the bottom of the drawn plan) and inside
    // the rect the painter fits, and the enemy stand is the same distance up.
    for (const myTeam of [0, 1] as const) {
      const stand = BG_BASES[myTeam].flag;
      const model = buildBgMapModel({
        ...worldSlice(myTeam, baseMatch().players),
        player: { pos: { x: origin.x + stand.x, z: origin.z + stand.z }, facing: 0 },
      });
      expect(model.active).toBe(true);
      expect(model.self?.z).toBeCloseTo(-BG_FLAG_Z);
      expect(Math.abs(model.self?.z ?? 0)).toBeLessThan(model.halfZ);
      expect(Math.abs(model.self?.x ?? 0)).toBeLessThan(model.halfX);
    }
  });

  it('spans the authored field rect, and every mapped anchor falls inside it', () => {
    const model = buildBgMapModel(worldSlice(0, []));
    // Thornhollow Fields' own 100x280yd footprint: the map a player learns the field
    // by is the same shape the field has always been.
    expect([model.halfX, model.halfZ]).toEqual([BG_HALF_X, BG_HALF_Z]);
    expect(model.halfX * 2).toBe(100);
    expect(model.halfZ * 2).toBe(280);
    // Padded PER AXIS: a plot's own half-extents, not their sum, which would
    // bound a 18x12yd yard by 15yd in both directions and reject a legal one.
    const inside = (x: number, z: number, padX = 0, padZ = 0): boolean =>
      Math.abs(x) + padX <= model.halfX && Math.abs(z) + padZ <= model.halfZ;
    for (const base of BG_BASES) expect(inside(base.flag.x, base.flag.z)).toBe(true);
    for (const plot of BG_GRAVEYARDS) {
      expect(inside(plot.x, plot.z, plot.hw, plot.hd), `graveyard ${plot.x},${plot.z}`).toBe(true);
    }
  });

  it('emits no rune-pad markers: the map does not scout which pads are up', () => {
    // Pinned as an ABSENCE. The field really does place rune pads, and the map
    // deliberately carries none of them: a pad's live state is exactly the kind
    // of thing the no-scouting rule keeps off this surface, and a static pip for
    // one is a lie dressed as information. The model's whole surface is checked
    // rather than one field name, so a `pads` (or `runes`) table cannot be
    // reintroduced under any spelling without failing here.
    expect(BG_SPEED_RUNES.length + BG_POWER_RUNES.length).toBeGreaterThan(3);
    const model = buildBgMapModel(worldSlice(0, baseMatch().players));
    expect(model.active).toBe(true);
    expect(Object.keys(model).sort()).toEqual(
      ['active', 'halfX', 'halfZ', 'mates', 'myTeam', 'self'].sort(),
    );
  });

  it('draws a wall plan that reaches both keeps, stays inside the rect, and is rotated', () => {
    const model = buildBgMapModel(worldSlice(0, []));
    const walls = bgFieldPlanWalls();
    // The authored ramparts and keeps alone are hundreds of boxes; a plan that
    // collapsed to a handful means the projection dropped the real colliders.
    expect(walls.length).toBeGreaterThan(100);
    // Two kinds of box legitimately straddle the map edge: the perimeter
    // blockers, which are centred ON it and run its full length, and the mural
    // drums, which project from the rampart line the way a real tower does
    // (the widest is the corner drum, 3.33yd of radius past its centre). Use
    // the box's TRUE rotated extent, not the hw+hd bound, which is hopelessly
    // loose for a long wall laid along an axis.
    const EDGE_SLACK = 3.5;
    for (const w of walls) {
      const c = Math.abs(Math.cos(w.rot));
      const s = Math.abs(Math.sin(w.rot));
      const ex = w.hw * c + w.hd * s;
      const ez = w.hw * s + w.hd * c;
      expect(Math.abs(w.x) + ex).toBeLessThanOrEqual(model.halfX + EDGE_SLACK);
      expect(Math.abs(w.z) + ez).toBeLessThanOrEqual(model.halfZ + EDGE_SLACK);
      // Nothing may be centred outside the field at all.
      expect(Math.abs(w.x)).toBeLessThanOrEqual(model.halfX);
      expect(Math.abs(w.z)).toBeLessThanOrEqual(model.halfZ);
    }
    // Both keeps are walled, and it is the KEEP that has to show, not the
    // rampart behind it: only the keep enclosure has boxes this far down the
    // field AND inside the keep's own width.
    const inKeep = (w: (typeof walls)[number], sign: number) =>
      Math.sign(w.z) === sign && Math.abs(w.z) >= 108 && Math.abs(w.x) <= 20;
    expect(walls.some((w) => inKeep(w, -1))).toBe(true);
    expect(walls.some((w) => inKeep(w, 1))).toBe(true);
    // The walls are placed structures, not axis-aligned segments: a painter
    // that filled plain rects and ignored `rot` would draw a lie.
    expect(walls.some((w) => Math.abs(Math.sin(w.rot * 2)) > 1e-3)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The scoreboard PAINTER's mount-time a11y contract, its language switch, and
// its listener hygiene, driven through a hand-rolled fake DOM (the repo has no
// jsdom, the tiny-dependency invariant; same idiom as tests/hud_perf_budget).
// The strip is a self-mounting root minted ONCE, so anything written only in
// ensureRoot() is frozen for the session: that is exactly the class of bug
// these arms exist for.

interface FakeEl {
  id: string;
  tabIndex: number;
  textContent: string;
  innerHTML: string;
  style: Record<string, unknown>;
  attrs: Map<string, string>;
  /** Every setAttribute in call order, so an elided repeat is visible. */
  attrWrites: { name: string; value: string }[];
  classes: Set<string>;
  children: FakeEl[];
  parent: FakeEl | null;
  blurs: number;
  classList: {
    toggle(cls: string, on?: boolean): void;
    contains(cls: string): boolean;
    remove(cls: string): void;
  };
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  /** The element's own listener book, so a test can drive the real handlers
   *  (the pin toggle) rather than reaching into painter internals. */
  listeners: Map<string, Array<(ev: unknown) => void>>;
  addEventListener(type: string, fn: (ev: unknown) => void): void;
  dispatch(type: string, ev: unknown): void;
  appendChild(child: FakeEl): void;
  remove(): void;
  blur(): void;
  contains(node: unknown): boolean;
  querySelector(): null;
  querySelectorAll(): FakeEl[];
}

function fakeEl(): FakeEl {
  const el: FakeEl = {
    id: '',
    tabIndex: -1,
    textContent: '',
    innerHTML: '',
    style: { setProperty(): void {} },
    attrs: new Map(),
    attrWrites: [],
    classes: new Set(),
    children: [],
    parent: null,
    blurs: 0,
    classList: {
      toggle(cls: string, on?: boolean): void {
        const next = on ?? !el.classes.has(cls);
        if (next) el.classes.add(cls);
        else el.classes.delete(cls);
      },
      contains: (cls: string) => el.classes.has(cls),
      remove: (cls: string) => void el.classes.delete(cls),
    },
    setAttribute(name: string, value: string): void {
      el.attrs.set(name, value);
      el.attrWrites.push({ name, value });
    },
    getAttribute: (name: string) => el.attrs.get(name) ?? null,
    listeners: new Map(),
    addEventListener(type: string, fn: (ev: unknown) => void): void {
      const list = el.listeners.get(type) ?? [];
      list.push(fn);
      el.listeners.set(type, list);
    },
    dispatch(type: string, ev: unknown): void {
      for (const fn of el.listeners.get(type) ?? []) fn(ev);
    },
    appendChild(child: FakeEl): void {
      child.parent = el;
      el.children.push(child);
    },
    remove(): void {
      if (!el.parent) return;
      el.parent.children = el.parent.children.filter((c) => c !== el);
      el.parent = null;
    },
    blur(): void {
      el.blurs++;
    },
    contains: () => false,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  return el;
}

/** The document surface the painter touches, with its listener book visible. */
function fakeDocument() {
  const listeners = new Map<string, Array<(ev: unknown) => void>>();
  return {
    activeElement: null as unknown,
    listeners,
    createElement: () => fakeEl(),
    addEventListener(type: string, fn: (ev: unknown) => void): void {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    removeEventListener(type: string, fn: (ev: unknown) => void): void {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((f) => f !== fn),
      );
    },
  };
}

function mountScoreboard() {
  const doc = fakeDocument();
  vi.stubGlobal('document', doc);
  const layer = fakeEl();
  const painter = new BattlegroundScoreboard({
    layer: () => layer as unknown as HTMLElement,
    writers: makeWriterFacet(
      new Map(),
      new Map(),
      new Map(),
      new Map(),
      () => {},
      () => {},
    ),
  });
  painter.update(buildBgScoreboardView(baseInfo({ match: baseMatch() }), 7));
  const root = layer.children[0];
  return { doc, layer, painter, root };
}

describe('battleground scoreboard painter (DOM contract)', () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    await ensureLocaleLoaded('en');
    setLanguage('en');
  });

  it('mounts the strip as a real widget: focusable, role=button, named, collapsed', () => {
    const { root } = mountScoreboard();
    expect(root.id).toBe('bg-scoreboard');
    expect(root.tabIndex).toBe(0);
    // It is focusable and it handles Enter/Space as a disclosure toggle, so it
    // must ANNOUNCE as a button; a bare focusable div reads as plain text.
    expect(root.getAttribute('role')).toBe('button');
    expect(root.getAttribute('aria-expanded')).toBe('false');
    expect(root.getAttribute('aria-live')).toBe('off');
    expect(root.getAttribute('aria-label')).toBe(t('hudChrome.bg.boardToggleLabel'));
  });

  it('re-writes the toggle name on a language switch, through the elided writer', async () => {
    const { painter, root } = mountScoreboard();
    const english = root.getAttribute('aria-label');
    const writesFor = (name: string) => root.attrWrites.filter((w) => w.name === name).length;
    expect(writesFor('aria-label')).toBe(1);

    // Same language: the elided writer must skip, or the strip pays a DOM write
    // on every relocalize fan-out.
    painter.relocalize();
    expect(writesFor('aria-label')).toBe(1);

    await ensureLocaleLoaded('ja_JP');
    setLanguage('ja_JP');
    painter.relocalize();
    // The root is minted once and ensureRoot() early-returns forever, so this
    // is the ONLY thing that can move the screen-reader name off the old locale.
    expect(writesFor('aria-label')).toBe(2);
    expect(root.getAttribute('aria-label')).toBe(t('hudChrome.bg.boardToggleLabel'));
    expect(root.getAttribute('aria-label')).not.toBe(english);
  });

  it('owns its document-level listener and gives it back on dispose', () => {
    const { doc, layer, painter, root } = mountScoreboard();
    // The outside-click closer is on the DOCUMENT, so it outlives every root
    // the painter owns unless the painter takes it back.
    expect(doc.listeners.get('pointerdown')).toHaveLength(1);
    expect(layer.children).toContain(root);

    painter.dispose();
    expect(doc.listeners.get('pointerdown')).toHaveLength(0);
    expect(layer.children).toHaveLength(0);
    // Idempotent, and it re-mounts cleanly afterward (one listener, never two).
    painter.dispose();
    expect(doc.listeners.get('pointerdown')).toHaveLength(0);
    painter.update(buildBgScoreboardView(baseInfo({ match: baseMatch() }), 7));
    expect(doc.listeners.get('pointerdown')).toHaveLength(1);
  });
});

describe('the first-win-of-the-day bonus chip', () => {
  const liveView = (over: Partial<BgInfo> = {}) =>
    buildBgWindowView({
      info: baseInfo(over),
      playerName: 'Ravven',
      playerLevel: 30,
      party: null,
      playerId: 7,
      allTime: null,
    }) as Extract<ReturnType<typeof buildBgWindowView>, { kind: 'live' }>;

  it('offers the chip while the bonus is unclaimed, at the sim constant', () => {
    const view = liveView({ firstWinBonusReady: true });
    expect(view.firstWinBonus).toEqual({ honor: BATTLEGROUND_FIRST_WIN_BONUS_HONOR });
    // Not a UI-side literal: retuning the sim constant moves the chip with it.
    expect(BATTLEGROUND_FIRST_WIN_BONUS_HONOR).toBeGreaterThan(0);
  });

  it('drops the chip once today has claimed it', () => {
    expect(liveView({ firstWinBonusReady: false }).firstWinBonus).toBeNull();
  });

  it('omits the chip on a snapshot from a server that predates the field', () => {
    // A rolling deploy leaves it undefined; promising a bonus that side may not
    // pay is the dishonest degradation, so the read is `=== true`.
    const stale = baseInfo();
    delete (stale as Partial<BgInfo>).firstWinBonusReady;
    const view = buildBgWindowView({
      info: stale,
      playerName: 'Ravven',
      playerLevel: 30,
      party: null,
      playerId: 7,
      allTime: null,
    }) as Extract<ReturnType<typeof buildBgWindowView>, { kind: 'live' }>;
    expect(view.firstWinBonus).toBeNull();
  });

  it('the chip state is in the repaint signature, so it really disappears', () => {
    // Without this the panel would hold the stale chip until some OTHER field
    // moved, and the win that claims the bonus also moves the record, which
    // would hide the bug behind a coincidence.
    expect(liveView({ firstWinBonusReady: true }).sig).not.toBe(
      liveView({ firstWinBonusReady: false }).sig,
    );
  });

  it('the chip says everything it has to say VISIBLY, with no title tooltip', () => {
    // A `title` on a non-focusable div is unreachable by keyboard, unreliably
    // announced, and simply absent on touch, and this panel ships to phones.
    // (WHERE the chip is painted, relative to the queue button it invites a
    // click on, is pinned behaviorally in tests/arena_window.test.ts.)
    const src = readFileSync(new URL('../src/ui/arena_window.ts', import.meta.url), 'utf8');
    const chip = src.slice(
      src.indexOf('private bgFirstWinChipHtml'),
      src.indexOf('private bgOnlineLadderHtml'),
    );
    expect(chip.length).toBeGreaterThan(0);
    expect(chip).not.toContain('title=');
    // One key, reused by the verdict banner's bonus line: the sentence is
    // identical, so a second key would translate it twice in every locale.
    expect(chip).toContain("t('hudChrome.bg.firstWinBonusLine'");
    // The amount goes through the house formatter like every other number here.
    expect(chip).toContain('{ honor: num(bonus.honor) }');
    // The glyph is decoration beside real text, so it is hidden, never named.
    expect(chip).toContain('aria-hidden="true"');
  });
});

describe('the match-end verdict copy (pure core)', () => {
  const ev = (over: Partial<BgEndBannerInput> = {}): BgEndBannerInput => ({
    won: true,
    draw: false,
    scoreCrimson: 3,
    scoreAzure: 1,
    ratingBefore: 1500,
    ratingAfter: 1520,
    ended: 'caps',
    firstWinBonus: 0,
    ...over,
  });

  afterEach(async () => {
    await ensureLocaleLoaded('en');
    setLanguage('en');
  });

  it('leads with ONE big word, reusing the scoreboard result keys', () => {
    // The finish banner and the frozen result strip must not name the same
    // outcome two different ways.
    expect(buildBgEndBannerView(ev()).verdict).toBe(t('hudChrome.bg.resultVictory'));
    expect(buildBgEndBannerView(ev({ won: false })).verdict).toBe(t('hudChrome.bg.resultDefeat'));
    expect(buildBgEndBannerView(ev({ draw: true, won: false })).verdict).toBe(
      t('hudChrome.bg.resultDraw'),
    );
  });

  it('gives each fact its own line, never one concatenated sentence', () => {
    const view = buildBgEndBannerView(ev({ ended: 'timer', firstWinBonus: 120 }));
    expect(view.lines).toEqual([
      t('hudChrome.bg.endedTimer'),
      t('hudChrome.bg.endBannerDetail', {
        crimson: '3',
        azure: '1',
        rating: '1,520',
        delta: '+20',
      }),
      t('hudChrome.bg.firstWinBonusLine', { honor: '120' }),
    ]);
  });

  it('a caps finish adds no cause line: the score already says it', () => {
    const view = buildBgEndBannerView(ev({ ended: 'caps' }));
    expect(view.lines.length).toBe(1);
    expect(view.lines[0]).toContain('3');
    expect(view.lines).not.toContain(t('hudChrome.bg.endedTimer'));
  });

  it('a forfeit names itself, on the banner and in the durable log', () => {
    const view = buildBgEndBannerView(ev({ ended: 'forfeit' }));
    expect(view.lines[0]).toBe(t('hudChrome.bg.endedForfeit'));
    expect(view.logLines.map((l) => l.tone)).toEqual(['resultWin', 'cause']);
    expect(view.logLines[1].text).toBe(t('hudChrome.bg.endedForfeitLog'));
  });

  it('omits the bonus line entirely when this result paid none', () => {
    const view = buildBgEndBannerView(ev({ firstWinBonus: 0 }));
    expect(view.lines.some((l) => l.includes('First win'))).toBe(false);
    expect(view.logLines.map((l) => l.tone)).toEqual(['resultWin']);
  });

  it('degrades to no cause line for an ending a newer server invents', () => {
    // The wire union can widen and t() throws on an unknown key, so an
    // off-vocabulary value must lose the line, never kill the event batch.
    const view = buildBgEndBannerView(ev({ ended: 'surrendered' }));
    expect(view.lines.length).toBe(1);
    expect(view.logLines.map((l) => l.tone)).toEqual(['resultWin']);
  });

  it('the two cause maps are total over the wire union, caps deliberately silent', () => {
    expect(Object.keys(BG_END_CAUSE_KEYS).sort()).toEqual(['caps', 'forfeit', 'timer']);
    expect(Object.keys(BG_END_CAUSE_LOG_KEYS).sort()).toEqual(['caps', 'forfeit', 'timer']);
    expect(BG_END_CAUSE_KEYS.caps).toBeNull();
    expect(BG_END_CAUSE_LOG_KEYS.caps).toBeNull();
  });

  it('the result log line keeps its pre-extraction win-vs-not colour split', () => {
    // A DRAW has always taken the not-a-win colour (the coordinator coloured
    // this line `ev.won ? green : red`); preserved rather than quietly changed.
    expect(buildBgEndBannerView(ev()).logLines[0].tone).toBe('resultWin');
    expect(buildBgEndBannerView(ev({ won: false })).logLines[0].tone).toBe('resultNotWin');
    expect(buildBgEndBannerView(ev({ draw: true, won: false })).logLines[0].tone).toBe(
      'resultNotWin',
    );
  });

  it('names the audio cue for a win and a loss, and none for a draw', () => {
    expect(buildBgEndBannerView(ev()).cue).toBe('victory');
    expect(buildBgEndBannerView(ev({ won: false })).cue).toBe('defeat');
    expect(buildBgEndBannerView(ev({ draw: true, won: false })).cue).toBeNull();
  });

  it('formats every number, so a grouped locale groups and the delta signs itself', () => {
    const view = buildBgEndBannerView(ev({ ratingBefore: 1500, ratingAfter: 12345 }));
    expect(view.lines[0]).toContain('12,345');
    expect(view.lines[0]).toContain('+10,845');
    // A rating LOSS carries its own sign from Intl, never a hardcoded prefix.
    const down = buildBgEndBannerView(ev({ won: false, ratingBefore: 1520, ratingAfter: 1500 }));
    expect(down.lines[0]).toContain('-20');
  });

  it('localizes off the catalog, not English literals', async () => {
    await ensureLocaleLoaded('ru_RU');
    setLanguage('ru_RU');
    const view = buildBgEndBannerView(ev({ ended: 'timer', firstWinBonus: 120 }));
    expect(view.verdict).not.toBe('Victory!');
    expect(view.lines[0]).not.toBe('Time expired');
    expect(view.lines[0]).toBe(t('hudChrome.bg.endedTimer'));
  });
});

describe('the remaining-time call copy (pure core)', () => {
  afterEach(async () => {
    await ensureLocaleLoaded('en');
    setLanguage('en');
  });

  it('speaks whole minutes at the two-minute mark', () => {
    const call = buildBgTimeWarningView(120);
    expect(call.banner).toBe(t('hudChrome.bg.timeWarningMinutes', { minutes: '2' }));
    expect(call.log).toBe(t('hudChrome.bg.timeWarningMinutesLog', { minutes: '2' }));
  });

  it('the one-minute mark gets its own key, never a "1 minutes" plural', () => {
    const call = buildBgTimeWarningView(60);
    expect(call.banner).toBe(t('hudChrome.bg.timeWarningOneMinute'));
    expect(call.banner).not.toContain('1 ');
    expect(call.log).toBe(t('hudChrome.bg.timeWarningOneMinuteLog'));
  });

  it('every BG_TIME_WARNINGS threshold has copy, and it is localized', async () => {
    for (const mark of BG_TIME_WARNINGS) {
      expect(buildBgTimeWarningView(mark).banner.length, `${mark}s`).toBeGreaterThan(0);
    }
    await ensureLocaleLoaded('ja_JP');
    setLanguage('ja_JP');
    expect(buildBgTimeWarningView(120).banner).not.toContain('minutes');
  });
});

describe('the scoreboard opens itself over the frozen result screen', () => {
  const view = (state: 'active' | 'ended') =>
    buildBgScoreboardView(
      baseInfo({ match: baseMatch({ state, winner: state === 'ended' ? 0 : null }) }),
      7,
    );
  const gone = () => buildBgScoreboardView(baseInfo({ match: null }), 7);

  afterEach(() => vi.unstubAllGlobals());

  it('opens the full board without a click, then hands it back to the preference', () => {
    const { painter, root } = mountScoreboard();
    expect(root.classes.has('expanded')).toBe(false);

    painter.update(view('ended'));
    expect(root.classes.has('expanded'), 'the final board is readable at once').toBe(true);
    // The one source of truth: aria never disagrees with what is on screen.
    expect(root.getAttribute('aria-expanded')).toBe('true');

    painter.update(gone());
    expect(root.classes.has('expanded')).toBe(false);
    expect(root.getAttribute('aria-expanded')).toBe('false');
  });

  it('self-heals for a player who reconnects INTO the result hold', () => {
    // Snapshot-driven, not bgEnd-driven: someone who reconnects during the hold
    // never receives the one-shot event but must still see the final board.
    const { painter, root } = mountScoreboard();
    painter.update(view('ended')); // the very first snapshot this client sees
    expect(root.classes.has('expanded')).toBe(true);
  });

  it('never overwrites a player who had PINNED the board open', () => {
    const { painter, root } = mountScoreboard();
    root.dispatch('click', {}); // the player pins it
    expect(root.classes.has('expanded')).toBe(true);

    painter.update(view('ended'));
    expect(root.classes.has('expanded')).toBe(true);
    // Teardown drops the AUTO half only: the pin is the player's, and survives.
    painter.update(gone());
    expect(root.classes.has('expanded'), 'the pin outlives the match').toBe(true);
    expect(root.getAttribute('aria-expanded')).toBe('true');
  });

  it('a click away really dismisses the result board, and it stays dismissed', () => {
    const { doc, painter, root } = mountScoreboard();
    painter.update(view('ended'));
    expect(root.classes.has('expanded')).toBe(true);

    doc.listeners.get('pointerdown')?.[0]({ target: {} });
    expect(root.classes.has('expanded')).toBe(false);
    expect(root.getAttribute('aria-expanded')).toBe('false');
    // The next snapshot must NOT reopen it: the dismissal latches for this result.
    painter.update(view('ended'));
    expect(root.classes.has('expanded')).toBe(false);
    // ...and the latch clears with the match, so the NEXT one opens normally.
    painter.update(gone());
    painter.update(view('ended'));
    expect(root.classes.has('expanded')).toBe(true);
  });

  it('a mid-match glance away does NOT disarm the end-of-match board', () => {
    // The dismissal latch is about THIS RESULT. Latching it on any outside
    // click would mean a player who read the tallies at minute 2 silently
    // never sees the auto-opened final board, and the latch survives the
    // whole match, so nothing would restore it.
    const { doc, painter, root } = mountScoreboard();
    painter.update(view('active'));
    root.dispatch('click', {}); // pin it mid-match to read the tallies
    expect(root.classes.has('expanded')).toBe(true);
    doc.listeners.get('pointerdown')?.[0]({ target: {} }); // then click back into the fight
    expect(root.classes.has('expanded')).toBe(false);

    painter.update(view('ended'));
    expect(root.classes.has('expanded'), 'the result board still opens itself').toBe(true);
    expect(root.getAttribute('aria-expanded')).toBe('true');
  });

  it('elides: repeated identical snapshots write aria-expanded once', () => {
    const { painter, root } = mountScoreboard();
    const writes = () => root.attrWrites.filter((w) => w.name === 'aria-expanded').length;
    const atMount = writes();
    painter.update(view('ended'));
    expect(writes()).toBe(atMount + 1);
    painter.update(view('ended'));
    painter.update(view('ended'));
    expect(writes(), 'an unchanged state touches nothing').toBe(atMount + 1);
  });
});
