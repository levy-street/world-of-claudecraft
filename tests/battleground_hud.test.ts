import { describe, expect, it } from 'vitest';
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
import {
  BG_KILL_FEED_MAX,
  BG_KILL_FEED_TTL,
  type BgAllTimeEntry,
  buildBgMapModel,
  buildBgScoreboardView,
  buildBgWindowView,
  pruneBgKillLines,
  pushBgKillLine,
} from '../src/ui/hud/battleground';
import type { BgInfo, BgMatchInfo } from '../src/world_api';

const baseInfo = (over: Partial<BgInfo> = {}): BgInfo => ({
  rating: 1500,
  wins: 0,
  losses: 0,
  captures: 0,
  queued: false,
  queueSize: 0,
  queuedParty: 1,
  match: null,
  ...over,
});

const baseMatch = (over: Partial<BgMatchInfo> = {}): BgMatchInfo => ({
  state: 'active',
  myTeam: 0,
  capsToWin: 5,
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
    },
  ],
  countdown: 0,
  timeLeft: 605,
  waveIn: [10, 5],
  respawnIn: 0,
  winner: null,
  ...over,
});

describe('battleground window view (pure core)', () => {
  it('models offline, idle, queued, and in-match states', () => {
    expect(
      buildBgWindowView({
        info: null,
        playerName: 'X',
        playerLevel: 20,
        party: null,
        allTime: null,
      }).kind,
    ).toBe('offline');
    const idle = buildBgWindowView({
      info: baseInfo(),
      playerName: 'X',
      playerLevel: 20,
      party: null,
      allTime: null,
    });
    expect(idle.kind).toBe('live');
    if (idle.kind !== 'live') return;
    expect(idle.action).toEqual({ kind: 'idle', partySize: 1, requiredLevel: 20, locked: false });
    // Under the floor: same idle affordance, locked, with the requirement.
    const low = buildBgWindowView({
      info: baseInfo(),
      playerName: 'X',
      playerLevel: 19,
      party: null,
      allTime: null,
    });
    if (low.kind !== 'live') throw new Error('expected live');
    expect(low.action).toEqual({ kind: 'idle', partySize: 1, requiredLevel: 20, locked: true });
    expect(low.sig).not.toBe(idle.sig); // the lock re-renders

    const queued = buildBgWindowView({
      info: baseInfo({ queued: true, queueSize: 7, queuedParty: 3 }),
      playerName: 'X',
      playerLevel: 20,
      party: null,
      allTime: null,
    });
    if (queued.kind !== 'live') throw new Error('expected live');
    expect(queued.action).toEqual({ kind: 'queued', queueSize: 7, queuedParty: 3 });

    const inMatch = buildBgWindowView({
      info: baseInfo({ match: baseMatch() }),
      playerName: 'X',
      playerLevel: 20,
      party: null,
      allTime: null,
    });
    if (inMatch.kind !== 'live') throw new Error('expected live');
    expect(inMatch.action).toEqual({ kind: 'in-match', scoreCrimson: 1, scoreAzure: 2 });
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
      allTime,
    });
    if (v.kind !== 'live') throw new Error('expected live');
    expect(v.allTime).not.toBeNull();
    expect(v.allTime![0]).toMatchObject({ rank: 1, name: 'High', knownClass: true, me: false });
    expect(v.allTime![1]).toMatchObject({ rank: 2, name: 'Me', knownClass: false, me: true });
  });

  it('is identical for a Sim-built and a wire-mirror-shaped snapshot', () => {
    // The Sim-shaped input comes from the typed literal; the mirror-shaped one
    // is authored as the JSON the server actually ships on the `bg` self key
    // (plain parsed JSON, string keys, no prototypes), including the wire's
    // online-only null carrier fields.
    const simShaped = baseInfo({ rating: 1616, wins: 4, match: baseMatch() });
    const wireShaped = JSON.parse(
      '{"rating":1616,"wins":4,"losses":0,"captures":0,"queued":false,' +
        '"queueSize":0,"queuedParty":1,"match":{"state":"active","myTeam":0,' +
        '"capsToWin":5,"scores":[1,2],"flags":[{"state":"home","carrierPid":null,' +
        '"carrierName":null,"carrierTeam":null},{"state":"carried","carrierPid":7,' +
        '"carrierName":"Ravven","carrierTeam":0}],"players":[{"pid":7,"name":"Ravven",' +
        '"cls":"warrior","team":0,"carrying":true,"dead":false,"kills":3,"deaths":1,"captures":2},' +
        '{"pid":8,"name":"Bryn","cls":"mage","team":0,"carrying":false,"dead":true,"kills":0,"deaths":4,"captures":0},' +
        '{"pid":9,"name":"Cael","cls":"priest","team":1,' +
        '"carrying":false,"dead":false,"kills":5,"deaths":0,"captures":1}],"countdown":0,' +
        '"timeLeft":605,"waveIn":[10,5],"respawnIn":0,"winner":null}}',
    ) as BgInfo;
    const inputRest = { playerName: 'X', playerLevel: 20, party: null, allTime: null };
    expect(buildBgWindowView({ info: simShaped, ...inputRest })).toEqual(
      buildBgWindowView({ info: wireShaped, ...inputRest }),
    );
    // The per-tick scoreboard core gets the same dual-shape arm: it reads the
    // deepest nested wire structure (flags, players, personal readouts).
    expect(buildBgScoreboardView(simShaped, 7)).toEqual(buildBgScoreboardView(wireShaped, 7));
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
    expect(v.capsToWin).toBe(5);
    expect(v.minutes).toBe(10);
    expect(v.seconds).toBe(5);
    expect(v.flagStates).toEqual(['home', 'carried']);
    expect(v.carrierNames[1]).toBe('Ravven');
    expect(v.flagStates).toEqual(['home', 'carried']);
    expect(v.carrierNames).toEqual([null, 'Ravven']);
    // The expanded board: both rosters in team order with the match tallies.
    expect(v.board).toHaveLength(3);
    expect(v.board[0]).toMatchObject({
      pid: 7,
      me: true,
      team: 0,
      kills: 3,
      deaths: 1,
      captures: 2,
    });
    expect(v.board[2]).toMatchObject({ pid: 9, team: 1, kills: 5, captures: 1, me: false });
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

  it('spans the authored Thornhollow rect, and every mapped anchor falls inside it', () => {
    const model = buildBgMapModel(worldSlice(0, []));
    // The 240x452yd field, not the old code-defined 100x280 one.
    expect([model.halfX, model.halfZ]).toEqual([BG_HALF_X, BG_HALF_Z]);
    expect(model.halfX * 2).toBe(240);
    expect(model.halfZ * 2).toBe(452);
    const inside = (x: number, z: number, pad = 0): boolean =>
      Math.abs(x) + pad <= model.halfX && Math.abs(z) + pad <= model.halfZ;
    for (const base of BG_BASES) expect(inside(base.flag.x, base.flag.z)).toBe(true);
    for (const plot of BG_GRAVEYARDS) expect(inside(plot.x, plot.z, plot.hw + plot.hd)).toBe(true);
    for (const pad of [...BG_SPEED_RUNES, ...BG_POWER_RUNES]) {
      expect(inside(pad.x, pad.z)).toBe(true);
    }
  });

  it('draws a wall plan that reaches both keeps, stays inside the rect, and is rotated', () => {
    const model = buildBgMapModel(worldSlice(0, []));
    const walls = bgFieldPlanWalls();
    // The authored keeps alone are hundreds of boxes; a plan that collapsed to
    // a handful means the projection dropped the real colliders.
    expect(walls.length).toBeGreaterThan(100);
    // The perimeter blockers are centred ON the map edge and run its full
    // length, so their own depth legitimately straddles it; everything else
    // must sit inside the rect. Use the box's TRUE rotated extent, not the
    // hw+hd bound, which is hopelessly loose for a long wall laid along an axis.
    const EDGE_SLACK = 1.5;
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
    // Both keeps are walled: the keep rects start at |z| 130 and each carries
    // real boxes past that line, which is what the plan must show at the two
    // ends of the map.
    const keepLineZ = 130;
    expect(walls.some((w) => w.z <= -keepLineZ)).toBe(true);
    expect(walls.some((w) => w.z >= keepLineZ)).toBe(true);
    // Thornhollow's walls are placed structures, not axis-aligned segments: a
    // painter that filled plain rects and ignored `rot` would draw a lie.
    expect(walls.some((w) => Math.abs(Math.sin(w.rot * 2)) > 1e-3)).toBe(true);
  });
});
