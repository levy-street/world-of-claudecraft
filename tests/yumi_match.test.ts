// Protect Yumi match system (src/sim/social/yumi.ts): queue + matchmaking,
// the hostility matrix, teleport cadence, the 10s bench respawn, sudden
// death (guaranteed winner, unranked), win + cleanup, and determinism.

import { describe, expect, it } from 'vitest';
import { yumiMazeOrigin } from '../src/sim/data';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import {
  packYumiTeams,
  pickYumiCells,
  resolveYumiTiebreak,
  YUMI_RESPAWN_SECONDS,
  YUMI_SUDDEN_AT,
  YUMI_TELEPORT_EVERY,
} from '../src/sim/social/yumi';
import type { Entity, SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { teleportPoints, YUMI_TELEPORT_MIN_SEP, yumiMazeLayout } from '../src/sim/yumi_maze_layout';

function makeWorld(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true });
}

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as any).rebucket(e);
}

// Queue six solos for yumi3 and run the countdown out so the bout is live.
function startYumi3(seed = 42) {
  const sim = makeWorld(seed);
  const classes = ['warrior', 'mage', 'rogue', 'priest', 'hunter', 'druid'] as const;
  const pids = classes.map((c, i) => sim.addPlayer(c, `P${i}`));
  pids.forEach((p, i) => {
    teleport(sim, p, i * 4, -40);
  });
  pids.forEach((p) => {
    sim.arenaQueueJoin(p, 'yumi3');
  });
  sim.tick(); // matchmake
  for (let i = 0; i < 20 * 8; i++) {
    const m = sim.arenaMatchFor(pids[0]);
    if (m && m.state === 'active') break;
    sim.tick();
  }
  const match = sim.arenaMatchFor(pids[0])!;
  return { sim, match, pids };
}

function cats(sim: Sim, match: ReturnType<Sim['arenaMatchFor']> & object) {
  const y = (match as any).yumi;
  return {
    catA: sim.entities.get(y.yumiA) as Entity,
    catB: sim.entities.get(y.yumiB) as Entity,
  };
}

describe('yumi: queue and matchmaking', () => {
  it('seats six solo-queuers into one 3v3 match with two 5000 hp cats', () => {
    const { sim, match, pids } = startYumi3();
    expect(match.format).toBe('yumi3');
    expect((match as any).yumi).toBeTruthy();
    expect(match.teamA.length).toBe(3);
    expect(match.teamB.length).toBe(3);
    expect(new Set([...match.teamA, ...match.teamB])).toEqual(new Set(pids));
    expect(sim.arenaQueueYumi3.length).toBe(0);
    const { catA, catB } = cats(sim, match);
    expect(catA.hp).toBe(5000);
    expect(catB.hp).toBe(5000);
    expect(catA.templateId).toBe('yumi_cat');
    // teams placed at their maze spawn plazas (opposite corners)
    const origin = yumiMazeOrigin(match.slot);
    const a0 = sim.entities.get(match.teamA[0])!;
    const b0 = sim.entities.get(match.teamB[0])!;
    expect(a0.pos.x - origin.x).toBeLessThan(0);
    expect(b0.pos.x - origin.x).toBeGreaterThan(0);
  });

  it('seats ten players into a 5v5 and keeps the two yumi queues separate', () => {
    const sim = makeWorld();
    const pids = Array.from({ length: 10 }, (_, i) =>
      sim.addPlayer(i % 2 === 0 ? 'warrior' : 'priest', `Q${i}`),
    );
    pids.forEach((p, i) => {
      teleport(sim, p, i * 4, -40);
    });
    pids.forEach((p) => {
      sim.arenaQueueJoin(p, 'yumi5');
    });
    expect(sim.arenaQueueYumi5.length).toBe(10);
    expect(sim.arenaQueueYumi3.length).toBe(0);
    sim.tick();
    const match = sim.arenaMatchFor(pids[0])!;
    expect(match.format).toBe('yumi5');
    expect(match.teamA.length).toBe(5);
    expect(match.teamB.length).toBe(5);
  });

  it('queues a premade party as one unit via the leader only', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'A');
    const b = sim.addPlayer('mage', 'B');
    const c = sim.addPlayer('rogue', 'C');
    [a, b, c].forEach((p, i) => {
      teleport(sim, p, i * 4, -40);
    });
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    sim.partyInvite(c, a);
    sim.partyAccept(c);
    // A non-leader cannot queue the team.
    sim.arenaQueueJoin(b, 'yumi3');
    let evs = sim.tick();
    expect(
      evs.some(
        (e: SimEvent) =>
          e.type === 'error' &&
          (e as any).text === 'Only the party leader may queue your team for Protect Yumi.',
      ),
    ).toBe(true);
    expect(sim.arenaQueueYumi3.length).toBe(0);
    // The leader queues all three as one unit.
    sim.arenaQueueJoin(a, 'yumi3');
    evs = sim.tick();
    expect(sim.arenaQueueYumi3.length).toBe(1);
    expect(sim.arenaQueueYumi3[0].pids).toEqual([a, b, c]);
  });

  it('rejects a party larger than the team size', () => {
    const sim = makeWorld();
    const pids = ['warrior', 'mage', 'rogue', 'priest'].map((c, i) =>
      sim.addPlayer(c as any, `B${i}`),
    );
    pids.forEach((p, i) => {
      teleport(sim, p, i * 4, -40);
    });
    for (let i = 1; i < 4; i++) {
      sim.partyInvite(pids[i], pids[0]);
      sim.partyAccept(pids[i]);
    }
    sim.arenaQueueJoin(pids[0], 'yumi3');
    const evs = sim.tick();
    expect(
      evs.some(
        (e: SimEvent) =>
          e.type === 'error' &&
          (e as any).text === 'Protect Yumi 3v3 allows a party of up to three.',
      ),
    ).toBe(true);
    expect(sim.arenaQueueYumi3.length).toBe(0);
  });

  it('packs premades and solos FIFO first-fit', () => {
    const u = (n: number, ...pids: number[]) => ({ pids, rating: n });
    // premade of 3 fills team A; three solos fill team B
    const t1 = packYumiTeams([u(1, 1, 2, 3), u(2, 4), u(3, 5), u(4, 6)], 3)!;
    expect(t1.a.flatMap((x) => x.pids)).toEqual([1, 2, 3]);
    expect(t1.b.flatMap((x) => x.pids)).toEqual([4, 5, 6]);
    // a premade of 2 + solo per side
    const t2 = packYumiTeams([u(1, 1, 2), u(2, 3, 4), u(3, 5), u(4, 6)], 3)!;
    expect(t2.a.flatMap((x) => x.pids)).toEqual([1, 2, 5]);
    expect(t2.b.flatMap((x) => x.pids)).toEqual([3, 4, 6]);
    // not enough players: no match
    expect(packYumiTeams([u(1, 1, 2, 3), u(2, 4)], 3)).toBeNull();
  });
});

describe('yumi: hostility matrix', () => {
  it('enemy players attackable, own cat healable, enemy cat attackable, outsiders inert', () => {
    const { sim, match, pids } = startYumi3();
    const { catA, catB } = cats(sim, match);
    const a0 = sim.entities.get(match.teamA[0])!;
    const a1 = sim.entities.get(match.teamA[1])!;
    const b0 = sim.entities.get(match.teamB[0])!;
    const hostile = (x: Entity, y: Entity) => (sim as any).isHostileTo(x, y) as boolean;
    const friendly = (x: Entity, y: Entity) => (sim as any).isFriendlyTo(x, y) as boolean;
    // players
    expect(hostile(a0, b0)).toBe(true);
    expect(hostile(b0, a0)).toBe(true);
    expect(hostile(a0, a1)).toBe(false);
    // cats
    expect(hostile(a0, catB)).toBe(true);
    expect(hostile(a0, catA)).toBe(false);
    expect(hostile(b0, catA)).toBe(true);
    expect(hostile(b0, catB)).toBe(false);
    expect(friendly(a0, catA)).toBe(true);
    expect(friendly(a0, catB)).toBe(false);
    expect(friendly(b0, catB)).toBe(true);
    expect(friendly(b0, catA)).toBe(false);
    // an outsider (7th player, not in the match) gets nothing
    const out = sim.addPlayer('paladin', 'Out');
    teleport(sim, out, 40, -40);
    const outE = sim.entities.get(out)!;
    expect(hostile(outE, catA)).toBe(false);
    expect(hostile(outE, catB)).toBe(false);
    expect(friendly(outE, catA)).toBe(false);
    expect(hostile(outE, a0)).toBe(false);
    expect(pids.length).toBe(6);
  });

  it('per-dimension gates: countdown, a benched attacker, and over each block the cat arms', () => {
    // countdown: the enemy cat is not strikeable yet, but pre-shielding your
    // own already is (the documented asymmetry of the two arms)
    const sim = makeWorld();
    const classes = ['warrior', 'mage', 'rogue', 'priest', 'hunter', 'druid'] as const;
    const pids = classes.map((c, i) => sim.addPlayer(c, `G${i}`));
    pids.forEach((p, i) => {
      teleport(sim, p, i * 4, -40);
    });
    pids.forEach((p) => {
      sim.arenaQueueJoin(p, 'yumi3');
    });
    sim.tick(); // matchmake
    const match = sim.arenaMatchFor(pids[0])!;
    expect(match.state).toBe('countdown');
    const { catA, catB } = cats(sim, match);
    const a0 = sim.entities.get(match.teamA[0])!;
    const hostile = (x: Entity, y: Entity) => (sim as any).isHostileTo(x, y) as boolean;
    const friendly = (x: Entity, y: Entity) => (sim as any).isFriendlyTo(x, y) as boolean;
    expect(hostile(a0, catB)).toBe(false);
    expect(friendly(a0, catA)).toBe(true);
    for (let i = 0; i < 20 * 8 && match.state !== 'active'; i++) sim.tick();
    expect(match.state).toBe('active');
    expect(hostile(a0, catB)).toBe(true);
    // a benched (downed) controller loses the hostile arm while on the bench
    const b0 = sim.entities.get(match.teamB[0])!;
    expect(hostile(b0, catA)).toBe(true);
    (sim as any).dealDamage(a0, b0, 999999, false, 'physical', null, 'hit');
    expect((sim as any).arenaIsDown(match, b0.id)).toBe(true);
    expect(hostile(b0, catA)).toBe(false);
    // over: both arms drop for everyone, including live fighters
    (sim as any).dealDamage(a0, catB, 999999, false, 'physical', null, 'hit');
    expect(match.state).toBe('over');
    const b1 = sim.entities.get(match.teamB[1])!;
    expect(hostile(b1, catA)).toBe(false);
    expect(friendly(a0, catA)).toBe(false);
  });

  it('heals land on the own cat and absorb shields soak enemy hits', () => {
    const { sim, match } = startYumi3();
    const { catB } = cats(sim, match);
    const a0 = sim.entities.get(match.teamA[0])!;
    const b0 = sim.entities.get(match.teamB[0])!;
    // enemy hit damages the cat through the real damage hub
    (sim as any).dealDamage(a0, catB, 300, false, 'physical', null, 'hit');
    expect(catB.hp).toBe(4700);
    // own-team heal restores it (target validation asserted above)
    (sim as any).applyHeal(b0, catB, 200, 'Heal');
    expect(catB.hp).toBeGreaterThan(4700);
    expect(catB.hp).toBeLessThanOrEqual(4900 + 100); // crit heals at most 1.5x
    // a shield on the cat soaks before hp
    const hpBefore = catB.hp;
    (sim as any).applyAura(catB, {
      id: 'power_word_shield',
      name: 'Power Word: Shield',
      kind: 'absorb',
      remaining: 30,
      value: 500,
      sourceId: b0.id,
    });
    (sim as any).dealDamage(a0, catB, 400, false, 'physical', null, 'hit');
    expect(catB.hp).toBe(hpBefore);
  });

  it('the cat never aggros, wanders, or turns hostile', () => {
    const { sim, match } = startYumi3();
    const { catA } = cats(sim, match);
    const start = { x: catA.pos.x, z: catA.pos.z };
    for (let i = 0; i < 20 * 3; i++) sim.tick();
    expect(catA.pos.x).toBe(start.x);
    expect(catA.pos.z).toBe(start.z);
    expect(catA.hostile).toBe(false);
    expect(catA.aiState).toBe('idle');
  });
});

describe('yumi: teleports', () => {
  it('both cats teleport on the same tick to separated maze points', () => {
    const { sim, match } = startYumi3();
    const { catA, catB } = cats(sim, match);
    const before = { ax: catA.pos.x, az: catA.pos.z, bx: catB.pos.x, bz: catB.pos.z };
    match.timer = YUMI_TELEPORT_EVERY - 0.5;
    let events: SimEvent[] = [];
    for (let i = 0; i < 20 && events.filter((e) => e.type === 'yumiTeleport').length < 2; i++) {
      events = events.concat(sim.tick());
    }
    // Personal per participant: one event per cat per fighter (2 x 6).
    const tps = events.filter((e) => e.type === 'yumiTeleport');
    expect(tps.length).toBe(12);
    expect(new Set(tps.map((e) => (e as any).catId)).size).toBe(2);
    expect(tps.every((e) => e.pid !== undefined)).toBe(true);
    expect(catA.pos.x !== before.ax || catA.pos.z !== before.az).toBe(true);
    expect(catB.pos.x !== before.bx || catB.pos.z !== before.bz).toBe(true);
    // both landed on real teleport points of the maze
    const origin = yumiMazeOrigin(match.slot);
    const pts = teleportPoints(yumiMazeLayout());
    const onPoint = (c: Entity) =>
      pts.some(
        (p) =>
          Math.abs(origin.x + p.x - c.pos.x) < 0.01 && Math.abs(origin.z + p.z - c.pos.z) < 0.01,
      );
    expect(onPoint(catA)).toBe(true);
    expect(onPoint(catB)).toBe(true);
    const d = Math.hypot(catA.pos.x - catB.pos.x, catA.pos.z - catB.pos.z);
    expect(d).toBeGreaterThanOrEqual(YUMI_TELEPORT_MIN_SEP);
  });

  it('pickYumiCells enforces separation and survives a degenerate point set', () => {
    const pts = [
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 20, z: 0 },
      { x: 0, z: 20 },
    ];
    for (let seed = 1; seed <= 30; seed++) {
      const { a, b } = pickYumiCells(new Rng(seed), pts, 5);
      expect(a).not.toBe(b);
      const dx = pts[a].x - pts[b].x;
      const dz = pts[a].z - pts[b].z;
      expect(Math.hypot(dx, dz)).toBeGreaterThanOrEqual(5);
    }
    // all points closer than minSep: still never the same point
    const tight = [
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 0, z: 1 },
    ];
    for (let seed = 1; seed <= 30; seed++) {
      const { a, b } = pickYumiCells(new Rng(seed), tight, 5);
      expect(a).not.toBe(b);
    }
  });
});

describe('yumi: respawn', () => {
  it('a downed player benches 10s, then revives beside the own cat, never eliminated', () => {
    const { sim, match } = startYumi3();
    const a0 = sim.entities.get(match.teamA[0])!;
    const b0 = sim.entities.get(match.teamB[0])!;
    const evs: SimEvent[] = [];
    (sim as any).dealDamage(a0, b0, 999999, false, 'physical', null, 'hit');
    expect(b0.dead).toBe(true);
    expect(match.defeated.has(b0.id)).toBe(false); // benched, not eliminated
    expect((sim as any).arenaIsDown(match, b0.id)).toBe(true);
    for (let i = 0; i < 5; i++) evs.push(...sim.tick());
    const down = evs.find((e) => e.type === 'yumiDown');
    expect(down).toBeTruthy();
    expect((down as any).seconds).toBe(YUMI_RESPAWN_SECONDS);
    for (let i = 0; i < 20 * (YUMI_RESPAWN_SECONDS + 1); i++) sim.tick();
    expect(b0.dead).toBe(false);
    expect(b0.hp).toBe(b0.maxHp);
    const { catB } = cats(sim, match);
    const d = Math.hypot(b0.pos.x - catB.pos.x, b0.pos.z - catB.pos.z);
    expect(d).toBeLessThan(10);
  });
});

describe('yumi: respawn safety', () => {
  it('a fighter bottomed out by a non-cross-team source benches, never the graveyard flow', () => {
    const { sim, match } = startYumi3();
    const b0 = sim.entities.get(match.teamB[0])!;
    // self-damage (the fiesta precedent: a friendly DoT tail) bottoms b0 out
    // WITHOUT a cross-team takedown, hitting the damage-hub safety branch
    (sim as any).dealDamage(b0, b0, 999999, false, 'shadow', null, 'hit');
    expect(b0.dead).toBe(true);
    expect(match.defeated.has(b0.id)).toBe(false);
    expect((sim as any).arenaIsDown(match, b0.id)).toBe(true);
    expect(sim.arenaMatchFor(match.teamB[0])).toBe(match); // still in the bout
    for (let i = 0; i < 20 * (YUMI_RESPAWN_SECONDS + 2) && b0.dead; i++) sim.tick();
    expect(b0.dead).toBe(false); // revived on the bench timer, not a corpse run
    expect(b0.hp).toBe(b0.maxHp);
  });
});

describe('yumi: competitive constants', () => {
  it('pins the timing magnitudes (a balance edit must consciously land here too)', () => {
    expect(YUMI_RESPAWN_SECONDS).toBe(10);
    expect(YUMI_TELEPORT_EVERY).toBe(60);
    expect(YUMI_SUDDEN_AT).toBe(600);
  });
});

describe('yumi: sudden death', () => {
  it('latches once, freezes teleports, bleeds the cats, and always picks a winner, unranked', () => {
    const { sim, match } = startYumi3();
    const { catA, catB } = cats(sim, match);
    // uneven hp so the bleed decides without the coin
    catA.hp = 240;
    catB.hp = 120;
    // Jump to just before sudden death, keeping the teleport schedule
    // consistent with the jumped clock (in real play timer only ticks by DT;
    // the 600s boundary coincides with a teleport, which the latch freezes).
    match.timer = YUMI_SUDDEN_AT - 0.5;
    (match as any).yumi.nextTeleportAt = YUMI_SUDDEN_AT;
    const evs: SimEvent[] = [];
    for (let i = 0; i < 20 * 30 && match.state === 'active'; i++) evs.push(...sim.tick());
    expect(evs.filter((e) => e.type === 'yumiSuddenDeath').length).toBe(6); // once per player
    expect(evs.filter((e) => e.type === 'yumiTeleport').length).toBe(0); // frozen
    expect(match.state).toBe('over');
    const ends = evs.filter((e) => e.type === 'arenaEnd');
    expect(ends.length).toBe(6);
    for (const e of ends) {
      expect((e as any).draw).toBe(false);
      expect((e as any).ratingBefore).toBe((e as any).ratingAfter); // unranked
    }
    // team A's cat had more hp, so team A wins
    const a0End = ends.find((e) => e.pid === match.teamA[0]);
    expect((a0End as any).won).toBe(true);
  });

  it('a same-pulse double kill resolves by damage dealt: exactly one cat dies', () => {
    const { sim, match } = startYumi3();
    const { catA, catB } = cats(sim, match);
    const y = (match as any).yumi;
    // Equal hp below the first bleed pulse (50 at step 1), so BOTH would die
    // on the same pulse; team A dealt more to the ENEMY cat, so the resolver
    // must pick A deterministically without touching the coin.
    catA.hp = 30;
    catB.hp = 30;
    y.dmgToYumiB = 4970; // team A's damage (dealt to cat B)
    y.dmgToYumiA = 4000; // team B's damage (dealt to cat A)
    match.timer = YUMI_SUDDEN_AT - 0.5;
    y.nextTeleportAt = YUMI_SUDDEN_AT;
    const evs: SimEvent[] = [];
    for (let i = 0; i < 20 * 10 && match.state === 'active'; i++) evs.push(...sim.tick());
    expect(match.state).toBe('over');
    // The loser's cat died and the winner's is untouched: a winner/loser
    // inversion on the kill line flips every one of these.
    expect(catB.dead).toBe(true);
    expect(catA.dead).toBe(false);
    expect(catA.hp).toBe(30);
    const ends = evs.filter((e) => e.type === 'arenaEnd');
    expect(ends.length).toBe(6);
    for (const e of ends) expect((e as any).draw).toBe(false);
    expect((ends.find((e) => e.pid === match.teamA[0]) as any).won).toBe(true);
    expect((ends.find((e) => e.pid === match.teamB[0]) as any).won).toBe(false);
  });

  it('a full tie (equal hp, equal damage dealt) still kills exactly one cat via the coin', () => {
    const { sim, match } = startYumi3();
    const { catA, catB } = cats(sim, match);
    const y = (match as any).yumi;
    catA.hp = 30;
    catB.hp = 30;
    y.dmgToYumiA = 4970;
    y.dmgToYumiB = 4970;
    match.timer = YUMI_SUDDEN_AT - 0.5;
    y.nextTeleportAt = YUMI_SUDDEN_AT;
    const evs: SimEvent[] = [];
    for (let i = 0; i < 20 * 10 && match.state === 'active'; i++) evs.push(...sim.tick());
    expect(match.state).toBe('over');
    expect(catA.dead !== catB.dead).toBe(true); // exactly one dead, never both
    const ends = evs.filter((e) => e.type === 'arenaEnd');
    expect(ends.length).toBe(6);
    for (const e of ends) expect((e as any).draw).toBe(false);
    // the surviving cat's team is the team that won
    const winnerPid = catA.dead ? match.teamB[0] : match.teamA[0];
    expect((ends.find((e) => e.pid === winnerPid) as any).won).toBe(true);
  });

  it('resolveYumiTiebreak: hp first, then damage dealt, then the per-match coin', () => {
    const rng = new Rng(7);
    expect(resolveYumiTiebreak(rng, 100, 50, 0, 0)).toBe('A');
    expect(resolveYumiTiebreak(rng, 50, 100, 0, 0)).toBe('B');
    // equal hp: more damage dealt to the ENEMY cat wins (dmgToYumiB is team A's damage)
    expect(resolveYumiTiebreak(rng, 50, 50, 100, 300)).toBe('A');
    expect(resolveYumiTiebreak(rng, 50, 50, 300, 100)).toBe('B');
    // full tie: the coin decides, deterministically for a fixed stream
    const coin = resolveYumiTiebreak(new Rng(7), 50, 50, 100, 100);
    expect(resolveYumiTiebreak(new Rng(7), 50, 50, 100, 100)).toBe(coin);
  });
});

describe('yumi: win and cleanup', () => {
  it('killing the enemy cat wins the match; everything tears down', () => {
    const { sim, match, pids } = startYumi3();
    const { catB } = cats(sim, match);
    const a0 = sim.entities.get(match.teamA[0])!;
    const evs: SimEvent[] = [];
    (sim as any).dealDamage(a0, catB, 999999, false, 'physical', null, 'hit');
    for (let i = 0; i < 3; i++) evs.push(...sim.tick());
    expect(catB.dead).toBe(true);
    const ends = evs.filter((e) => e.type === 'arenaEnd');
    expect(ends.length).toBe(6);
    expect((ends.find((e) => e.pid === match.teamA[0]) as any).won).toBe(true);
    expect((ends.find((e) => e.pid === match.teamB[0]) as any).won).toBe(false);
    // aftermath, then everyone returns and the slot + cats free up
    for (let i = 0; i < 20 * 7; i++) sim.tick();
    for (const pid of pids) expect(sim.arenaMatchFor(pid)).toBeNull();
    expect(sim.entities.get((match as any).yumi.yumiA)).toBeUndefined();
    expect(sim.entities.get((match as any).yumi.yumiB)).toBeUndefined();
    // a fresh queue can start a new match (slot was freed)
    pids.forEach((p) => {
      sim.arenaQueueJoin(p, 'yumi3');
    });
    sim.tick();
    expect(sim.arenaMatchFor(pids[0])).toBeTruthy();
  });
});

describe('yumi: IWorld surface', () => {
  it('arenaInfoFor carries the yumi match snapshot for both teams', () => {
    const { sim, match } = startYumi3();
    const a0 = match.teamA[0];
    const b0 = match.teamB[0];
    const infoA = sim.arenaInfoFor(a0)!;
    const infoB = sim.arenaInfoFor(b0)!;
    expect(infoA.match?.format).toBe('yumi3');
    const ya = infoA.match?.yumi;
    const yb = infoB.match?.yumi;
    expect(ya).toBeTruthy();
    expect(ya!.team).toBe('A');
    expect(yb!.team).toBe('B');
    expect(ya!.size).toBe(3);
    expect(ya!.phase).toBe('active');
    // BOTH cats always present with live hp/coords (fairness invariant)
    expect(ya!.yumiA.hp).toBe(5000);
    expect(ya!.yumiB.hp).toBe(5000);
    expect(ya!.yumiA.alive).toBe(true);
    expect(ya!.teleportIn).toBeGreaterThan(0);
    expect(ya!.suddenDeathIn).toBeGreaterThan(0);
    expect(ya!.damageTakenMult).toBe(1);
    expect(ya!.teamA.length).toBe(3);
    expect(ya!.teamB.length).toBe(3);
    expect(ya!.teamA.find((p) => p.pid === a0)?.me).toBe(true);
    // queue readout formats resolve without a match too
    expect(infoA.standings.yumi3).toBeTruthy();
    expect(infoA.ladders.yumi5).toEqual([]);
  });
});

describe('yumi: determinism', () => {
  it('the same seed replays the same match trace', () => {
    const run = () => {
      const { sim, match } = startYumi3(123);
      const trace: unknown[] = [];
      match.timer = YUMI_TELEPORT_EVERY - 1;
      for (let i = 0; i < 20 * 10; i++) {
        for (const e of sim.tick()) {
          if (e.type === 'yumiTeleport')
            trace.push([(e as any).catId - match.teamA[0], (e as any).toX, (e as any).toZ]);
        }
      }
      const { catA, catB } = cats(sim, match);
      trace.push([catA.pos.x, catA.pos.z, catB.pos.x, catB.pos.z]);
      return trace;
    };
    expect(run()).toEqual(run());
  });
});
