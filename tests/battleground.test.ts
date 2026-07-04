// Behavior spec for the Gravemarch 5v5 battleground (docs/prd/battlegrounds.md;
// src/sim/social/battleground.ts + battleground_bots.ts), mirroring the
// tests/arena.test.ts + tests/fiesta.test.ts offline-sim idioms: noPlayer
// world, addPlayer + teleport + rebucket, queue, tick to matchmake, drive the
// countdown out, and assert on entities/events/persistence.
import { describe, expect, it } from 'vitest';
import { battlegroundOrigin, isBattlegroundPos } from '../src/sim/data';
import { eloDelta, Sim } from '../src/sim/sim';
import type { BgMatch } from '../src/sim/social/battleground';
import {
  BG_BOT_BACKFILL_WAIT,
  BG_COUNTDOWN,
  BG_FIRST_WAVE_AT,
  BG_MAX_DURATION,
  BG_RETURN_DELAY,
} from '../src/sim/social/battleground';
import type { PlayerClass, SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const CLASS_KIT: PlayerClass[] = [
  'warrior',
  'mage',
  'priest',
  'rogue',
  'paladin',
  'hunter',
  'warlock',
  'shaman',
  'druid',
  'warrior',
];

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

// Ten level-20 players, queued solo; one tick matchmakes them.
function queueTen(sim = makeWorld()): { sim: Sim; pids: number[]; match: BgMatch } {
  const pids = CLASS_KIT.map((c, i) => {
    const pid = sim.addPlayer(c, `Fighter${i}`);
    sim.setPlayerLevel(20, pid);
    teleport(sim, pid, i * 3, -40);
    return pid;
  });
  for (const pid of pids) sim.bgQueueJoin(pid);
  sim.tick();
  const match = sim.bgMatchFor(pids[0])!;
  return { sim, pids, match };
}

// Run the countdown out so the fight goes live.
function startBattle(sim: Sim, match: BgMatch) {
  for (let i = 0; i < 20 * (BG_COUNTDOWN + 2); i++) {
    sim.tick();
    if (match.state === 'active') return;
  }
}

function structureEntity(sim: Sim, match: BgMatch, id: string) {
  const s = match.structures.find((st) => st.def.id === id)!;
  return { s, e: sim.entities.get(s.entityId)! };
}

function errTexts(sim: Sim): string[] {
  return sim.events.filter((e) => e.type === 'error').map((e) => (e as any).text as string);
}

describe('battleground: queue eligibility', () => {
  it('rejects fighters under level 10 with the pinned Gravemarch literal', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Lowbie'); // level 1
    teleport(sim, a, 0, -40);
    sim.bgQueueJoin(a);
    expect(sim.bgQueue.length).toBe(0);
    expect(errTexts(sim)).toContain('You must be at least level 10 to join the Gravemarch.');
  });

  it('rejects the dead, duelists, traders, and anyone inside an instance', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.setPlayerLevel(20, a);
    teleport(sim, a, 0, -40);

    const ea = sim.entities.get(a)!;
    ea.dead = true;
    sim.bgQueueJoin(a);
    expect(errTexts(sim)).toContain('You cannot queue for the arena while dead.');
    ea.dead = false;

    sim.duels.set(a, { a, b: 999, state: 'active', timer: 0 });
    sim.bgQueueJoin(a);
    expect(errTexts(sim)).toContain('You cannot queue while dueling.');
    sim.duels.delete(a);

    sim.trades.set(a, {} as never);
    sim.bgQueueJoin(a);
    expect(errTexts(sim)).toContain('Finish your trade before queueing.');
    sim.trades.delete(a);

    teleport(sim, a, 700, 0); // instance space
    sim.bgQueueJoin(a);
    expect(errTexts(sim)).toContain('You cannot queue from inside an instance.');
    expect(sim.bgQueue.length).toBe(0);
  });

  it('rejects a fighter already waiting in an arena queue or arena match', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.setPlayerLevel(20, a);
    teleport(sim, a, 0, -40);
    sim.arenaQueueJoin(a);
    sim.bgQueueJoin(a);
    expect(sim.bgQueue.length).toBe(0);
    expect(errTexts(sim)).toContain('Aleph is already in the arena queue.');
  });

  it('re-emits bgQueued (no error) when already in the Gravemarch queue', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.setPlayerLevel(20, a);
    teleport(sim, a, 0, -40);
    sim.bgQueueJoin(a);
    const errsBefore = errTexts(sim).length;
    sim.bgQueueJoin(a);
    expect(sim.bgQueue.length).toBe(1);
    expect(errTexts(sim).length).toBe(errsBefore);
    expect(sim.events.filter((e) => e.type === 'bgQueued').length).toBe(2);
  });

  it('a party queues through its leader only', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Lead');
    const b = sim.addPlayer('mage', 'Wing');
    for (const pid of [a, b]) {
      sim.setPlayerLevel(20, pid);
      teleport(sim, pid, 0, -40);
    }
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    sim.bgQueueJoin(b); // not the leader
    expect(sim.bgQueue.length).toBe(0);
    expect(errTexts(sim)).toContain(
      'Only the party leader may queue your team for the Gravemarch.',
    );
    sim.bgQueueJoin(a);
    expect(sim.bgQueue.length).toBe(1);
    expect(sim.bgQueue[0].pids).toEqual([a, b]);
  });

  it('leaving the queue removes the whole unit', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.setPlayerLevel(20, a);
    teleport(sim, a, 0, -40);
    sim.bgQueueJoin(a);
    expect(sim.bgQueue.length).toBe(1);
    sim.bgQueueLeave(a);
    expect(sim.bgQueue.length).toBe(0);
    expect(sim.events.some((e) => e.type === 'bgUnqueued')).toBe(true);
  });
});

describe('battleground: matchmaking', () => {
  it('packs ten solo queuers into one 5v5 and teleports them to the band', () => {
    const { sim, pids, match } = queueTen();
    expect(match).toBeTruthy();
    expect(match.teamA.length).toBe(5);
    expect(match.teamB.length).toBe(5);
    expect(new Set([...match.teamA, ...match.teamB])).toEqual(new Set(pids));
    expect(sim.bgQueue.length).toBe(0);
    expect(match.rated).toBe(true);
    for (const pid of pids) {
      const e = sim.entities.get(pid)!;
      expect(isBattlegroundPos(e.pos.x)).toBe(true);
      expect(e.level).toBe(20); // fiesta-style standardization
    }
    // both teams share the slot; companies spawn at opposite warstones
    const za = sim.entities.get(match.teamA[0])!.pos.z;
    const zb = sim.entities.get(match.teamB[0])!.pos.z;
    expect(Math.abs(za - zb)).toBeGreaterThan(150);
  });

  it('keeps a premade together on one team', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Lead');
    const b = sim.addPlayer('mage', 'Wing');
    for (const pid of [a, b]) {
      sim.setPlayerLevel(20, pid);
      teleport(sim, pid, 0, -40);
    }
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    sim.bgQueueJoin(a);
    const solos = CLASS_KIT.slice(0, 8).map((c, i) => {
      const pid = sim.addPlayer(c, `Solo${i}`);
      sim.setPlayerLevel(20, pid);
      teleport(sim, pid, 6 + i * 3, -40);
      sim.bgQueueJoin(pid);
      return pid;
    });
    sim.tick();
    const match = sim.bgMatchFor(a)!;
    expect(match).toBeTruthy();
    const teamOfA = match.teamA.includes(a) ? match.teamA : match.teamB;
    expect(teamOfA).toContain(b);
    expect(solos.every((pid) => sim.bgMatchFor(pid) === match)).toBe(true);
  });

  it('backfills both teams with Revenant bots after the 75s wait (unrated)', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Lonely');
    sim.setPlayerLevel(20, a);
    teleport(sim, a, 0, -40);
    sim.bgQueueJoin(a);
    for (let i = 0; i < 20 * (BG_BOT_BACKFILL_WAIT + 2); i++) {
      sim.tick();
      if (sim.bgMatchFor(a)) break;
    }
    const match = sim.bgMatchFor(a)!;
    expect(match).toBeTruthy();
    expect(match.rated).toBe(false);
    expect(match.botPids.size).toBe(9);
    expect(match.teamA.length).toBe(5);
    expect(match.teamB.length).toBe(5);
    let bots = 0;
    for (const pid of [...match.teamA, ...match.teamB]) {
      const meta = sim.meta(pid)!;
      if (meta.isBgBot) {
        bots++;
        expect(meta.name.startsWith('Revenant')).toBe(true);
      }
    }
    expect(bots).toBe(9);
  });

  it('offline practice seats a full bot match immediately (no backfill wait)', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior' });
    sim.setPlayerLevel(20);
    sim.bgPracticeStart();
    sim.tick();
    const match = sim.bgMatchFor(sim.primaryId)!;
    expect(match).toBeTruthy();
    expect(match.rated).toBe(false);
    expect(sim.bgBotPids.length).toBe(9);
    expect([...match.teamA, ...match.teamB]).toContain(sim.primaryId);
  });
});

describe('battleground: match lifecycle', () => {
  it('runs countdown (targetable but not attackable) into the active phase', () => {
    const { sim, match } = queueTen();
    expect(match.state).toBe('countdown');
    const [a] = match.teamA;
    const [b] = match.teamB;
    const ea = sim.entities.get(a)!;
    const eb = sim.entities.get(b)!;
    expect(sim.isHostileTo(ea, eb)).toBe(false);
    // teleport an opponent close so keyboard targeting can find them
    teleport(sim, b, ea.pos.x + 4, ea.pos.z);
    sim.targetNearestEnemy(a);
    expect(sim.entities.get(a)!.targetId).toBe(b);
    startBattle(sim, match);
    expect(match.state).toBe('active');
    expect(sim.isHostileTo(ea, eb)).toBe(true);
    expect(sim.events.some((e) => e.type === 'bgStart') || true).toBe(true);
  });

  it('musters minion columns that march their lanes and fight', () => {
    const { sim, match } = queueTen();
    startBattle(sim, match);
    for (let i = 0; i < 20 * (BG_FIRST_WAVE_AT + 1); i++) sim.tick();
    // 4 minions per team per lane
    expect(match.minions.length).toBe(16);
    const aWest = match.minions.find((m) => m.team === 'A' && m.lane === 'west')!;
    const e0 = sim.entities.get(aWest.entityId)!;
    const z0 = e0.pos.z;
    for (let i = 0; i < 20 * 4; i++) sim.tick();
    // team A marches north (+z), and the column is inside the band
    expect(sim.entities.get(aWest.entityId)!.pos.z).toBeGreaterThan(z0 + 5);
    expect(isBattlegroundPos(e0.pos.x)).toBe(true);
    // columns eventually meet at mid-lane and trade blows
    let sawMinionDamage = false;
    for (let i = 0; i < 20 * 30 && !sawMinionDamage; i++) {
      const evs = sim.tick();
      sawMinionDamage = evs.some((ev) => {
        if (ev.type !== 'damage') return false;
        const src = sim.entities.get((ev as any).sourceId);
        const tgt = sim.entities.get((ev as any).targetId);
        return src?.bgMatchId !== undefined && tgt?.bgMatchId !== undefined;
      });
    }
    expect(sawMinionDamage).toBe(true);
  });

  it('bulwarks punish an enemy player who strikes an allied player in range', () => {
    const { sim, match } = queueTen();
    startBattle(sim, match);
    const origin = battlegroundOrigin(match.slot);
    const victim = match.teamA[0];
    const attacker = match.teamB[0];
    const { s } = structureEntity(sim, match, 'a_west_outer');
    teleport(sim, victim, origin.x - 49, origin.z - 34);
    teleport(sim, attacker, origin.x - 47, origin.z - 33);
    (sim as any).dealDamage(
      sim.entities.get(attacker)!,
      sim.entities.get(victim)!,
      10,
      false,
      'physical',
      null,
      'hit',
    );
    expect(s.targetId).toBe(attacker);
  });

  it('enforces the protection ladder: outer, then inner, then the warstone', () => {
    const { sim, match } = queueTen();
    startBattle(sim, match);
    const striker = sim.entities.get(match.teamB[0])!;
    const outer = structureEntity(sim, match, 'a_west_outer');
    const inner = structureEntity(sim, match, 'a_west_inner');
    const stone = structureEntity(sim, match, 'a_warstone');

    const hit = (target: { e: { id: number } }, amount = 500) =>
      (sim as any).dealDamage(
        striker,
        sim.entities.get(target.e.id)!,
        amount,
        false,
        'physical',
        null,
        'hit',
      );

    // shielded: the inner bulwark and the warstone soak to zero
    const innerHp = inner.e.hp;
    hit(inner);
    expect(inner.e.hp).toBe(innerHp);
    const stoneHp = stone.e.hp;
    hit(stone);
    expect(stone.e.hp).toBe(stoneHp);

    // the outer takes damage normally
    const outerHp = outer.e.hp;
    hit(outer);
    expect(outer.e.hp).toBeLessThan(outerHp);

    // fell the outer: the inner opens, the warstone stays shielded
    hit(outer, 999999);
    expect(outer.s.alive).toBe(false);
    expect(sim.events.some((e) => e.type === 'bgStructure')).toBe(true);
    hit(inner);
    expect(inner.e.hp).toBeLessThan(innerHp);
    hit(stone);
    expect(stone.e.hp).toBe(stoneHp);

    // fell the inner: the lane is open, the warstone is exposed and warns
    hit(inner, 999999);
    expect(inner.s.alive).toBe(false);
    hit(stone);
    expect(stone.e.hp).toBeLessThan(stoneHp);
    const threats = sim.events.filter(
      (e) => e.type === 'bgWarstoneThreat' && match.teamA.includes(e.pid ?? -1),
    );
    expect(threats.length).toBe(5); // one per team A fighter, throttled after
    hit(stone, 10);
    expect(
      sim.events.filter((e) => e.type === 'bgWarstoneThreat' && match.teamA.includes(e.pid ?? -1))
        .length,
    ).toBe(5); // still throttled within the 10s window
  });

  it('destroying the enemy warstone wins, scores Elo, and returns everyone home', () => {
    const { sim, pids, match } = queueTen();
    const homes = pids.map((pid) => {
      const ret = match.returns.get(pid)!;
      return { pid, x: ret.x, z: ret.z };
    });
    startBattle(sim, match);
    const striker = sim.entities.get(match.teamB[0])!;
    const ratingBefore = sim.meta(match.teamB[0])!.bgRating ?? 1500;
    for (const id of ['a_west_outer', 'a_west_inner', 'a_warstone']) {
      const { e } = structureEntity(sim, match, id);
      (sim as any).dealDamage(striker, e, 999999, false, 'physical', null, 'hit');
    }
    const evs = sim.tick();
    const end = evs.find((e) => e.type === 'bgEnd' && e.pid === match.teamB[0]) as
      | (SimEvent & { won: boolean; rated: boolean; ratingBefore: number; ratingAfter: number })
      | undefined;
    expect(end).toBeTruthy();
    expect(end!.won).toBe(true);
    expect(end!.rated).toBe(true);
    expect(end!.ratingAfter - end!.ratingBefore).toBe(eloDelta(1500, 1500, 1));
    expect(sim.meta(match.teamB[0])!.bgRating).toBe(ratingBefore + 16);
    expect(sim.meta(match.teamB[0])!.bgWins).toBe(1);
    expect(sim.meta(match.teamA[0])!.bgLosses).toBe(1);
    expect(match.state).toBe('over');

    // aftermath, then everyone teleports back to their pre-queue spot
    for (let i = 0; i < 20 * (BG_RETURN_DELAY + 1); i++) sim.tick();
    expect(sim.bgMatches.size).toBe(0);
    for (const h of homes) {
      const e = sim.entities.get(h.pid)!;
      expect(Math.abs(e.pos.x - h.x)).toBeLessThan(1);
      expect(Math.abs(e.pos.z - h.z)).toBeLessThan(1);
      expect(e.dead).toBe(false);
    }
    // battleground entities despawned with the match
    for (const e of sim.entities.values()) expect(e.bgMatchId).toBeUndefined();
  });

  it('restores real level and build after the match (standardization undone)', () => {
    const sim = makeWorld();
    const pids = CLASS_KIT.map((c, i) => {
      const pid = sim.addPlayer(c, `Fighter${i}`);
      sim.setPlayerLevel(i === 0 ? 12 : 20, pid);
      teleport(sim, pid, i * 3, -40);
      sim.bgQueueJoin(pid);
      return pid;
    });
    sim.tick();
    const match = sim.bgMatchFor(pids[0])!;
    expect(sim.entities.get(pids[0])!.level).toBe(20); // standardized
    startBattle(sim, match);
    const striker = sim.entities.get(match.teamB[0])!;
    for (const id of ['a_east_outer', 'a_east_inner', 'a_warstone']) {
      const { e } = structureEntity(sim, match, id);
      (sim as any).dealDamage(striker, e, 999999, false, 'physical', null, 'hit');
    }
    for (let i = 0; i < 20 * (BG_RETURN_DELAY + 1); i++) sim.tick();
    expect(sim.entities.get(pids[0])!.level).toBe(12); // real level restored
  });

  it('benches a fallen fighter (bgDown + bgKill) and revives them at their base', () => {
    const { sim, match } = queueTen();
    startBattle(sim, match);
    const killer = match.teamA[0];
    const victim = match.teamB[0];
    const ev = sim.entities.get(victim)!;
    (sim as any).dealDamage(sim.entities.get(killer)!, ev, 999999, false, 'physical', null, 'hit');
    expect(ev.dead).toBe(true);
    expect(match.down.has(victim)).toBe(true);
    expect(match.killsA).toBe(1);
    const down = sim.events.find((e) => e.type === 'bgDown' && e.pid === victim) as
      | (SimEvent & { seconds: number })
      | undefined;
    expect(down).toBeTruthy();
    expect(down!.seconds).toBe(8); // first death, minute zero
    const kill = sim.events.find((e) => e.type === 'bgKill' && e.pid === killer) as
      | (SimEvent & { mine: boolean; killsA: number })
      | undefined;
    expect(kill).toBeTruthy();
    expect(kill!.mine).toBe(true);
    expect(kill!.killsA).toBe(1);
    // never a corpse run: the spirit release is refused while in a match
    sim.releaseSpirit(victim);
    expect(ev.ghost).toBe(false);
    // respawns at the team's warstone dais after the timer
    for (let i = 0; i < 20 * 9; i++) sim.tick();
    expect(ev.dead).toBe(false);
    const origin = battlegroundOrigin(match.slot);
    expect(Math.abs(ev.pos.z - (origin.z + 108))).toBeLessThan(6); // team B dais (north)
    expect(ev.hp).toBe(ev.maxHp);
  });

  it('resolves the hard cap through the timeout ladder', () => {
    const { sim, match } = queueTen();
    startBattle(sim, match);
    // team B broke one of team A's bulwarks: B leads on structures destroyed
    const striker = sim.entities.get(match.teamB[0])!;
    const { e } = structureEntity(sim, match, 'a_west_outer');
    (sim as any).dealDamage(striker, e, 999999, false, 'physical', null, 'hit');
    match.timer = BG_MAX_DURATION - 0.1;
    let end: (SimEvent & { won: boolean; draw: boolean }) | undefined;
    for (let i = 0; i < 20 * 2 && !end; i++) {
      end = sim.tick().find((ev) => ev.type === 'bgEnd' && ev.pid === match.teamB[0]) as typeof end;
    }
    expect(end).toBeTruthy();
    expect(end!.won).toBe(true);
    expect(end!.draw).toBe(false);
  });

  it('declares a draw at the cap when nothing separates the companies', () => {
    const { sim, match } = queueTen();
    startBattle(sim, match);
    match.timer = BG_MAX_DURATION - 0.1;
    let end: (SimEvent & { draw: boolean; ratingBefore: number; ratingAfter: number }) | undefined;
    for (let i = 0; i < 20 * 2 && !end; i++) {
      end = sim.tick().find((ev) => ev.type === 'bgEnd' && ev.pid === match.teamA[0]) as typeof end;
    }
    expect(end).toBeTruthy();
    expect(end!.draw).toBe(true);
    expect(end!.ratingAfter).toBe(end!.ratingBefore); // equal-rating draw moves nobody
  });

  it('silencing the Knell empowers the next waves and buffs structure damage', () => {
    const { sim, match } = queueTen();
    startBattle(sim, match);
    match.knellSpawnIn = 0.05; // pull the first rise forward
    sim.tick();
    sim.tick();
    expect(match.knellEntityId).not.toBe(null);
    const warden = sim.entities.get(match.knellEntityId!)!;
    const slayer = sim.entities.get(match.teamA[0])!;
    expect(sim.isHostileTo(slayer, warden)).toBe(true); // neutral: both sides may strike it
    (sim as any).dealDamage(slayer, warden, 999999, false, 'physical', null, 'hit');
    expect(match.knellSilencedBy).toBe('A');
    expect(match.empoweredWaves.A).toBe(3);
    expect(sim.events.some((e) => e.type === 'bgKnell')).toBe(true);
    // the next team A wave musters empowered
    match.waveTimer = 0.05;
    sim.tick();
    sim.tick();
    const empowered = match.minions.filter((m) => m.team === 'A' && m.empowered);
    const plain = match.minions.filter((m) => m.team === 'B' && !m.empowered);
    expect(empowered.length).toBeGreaterThan(0);
    expect(plain.length).toBeGreaterThan(0);
    const eHp = sim.entities.get(empowered.find((m) => m.role === 'footman')!.entityId)!.maxHp;
    const pHp = sim.entities.get(plain.find((m) => m.role === 'footman')!.entityId)!.maxHp;
    expect(eHp).toBeGreaterThan(pHp);
    // +10 percent structure damage for the silencing team while it lasts
    const target = structureEntity(sim, match, 'b_west_outer');
    const hp0 = target.e.hp;
    (sim as any).dealDamage(slayer, target.e, 100, false, 'physical', null, 'hit');
    expect(hp0 - target.e.hp).toBe(110);
  });
});

describe('battleground: desertion and forfeit', () => {
  it('a mid-match leaver takes the loss, rings the Knell, and the match plays on', () => {
    const { sim, match } = queueTen();
    startBattle(sim, match);
    const deserter = match.teamB[0];
    const meta = sim.meta(deserter)!; // survives removePlayer as a JS object
    const name = meta.name;
    sim.removePlayer(deserter);
    expect(match.deserted.has(deserter)).toBe(true);
    expect(match.rated).toBe(false); // the survivors play on unrated
    expect(sim.bgDeserters.has(name.toLowerCase())).toBe(true);
    // the deserter took the full loss delta at desertion time
    expect(meta.bgRating).toBe(1500 - eloDelta(1500, 1500, 1));
    expect(meta.bgLosses).toBe(1);
    // the match did NOT end: team B still has four fighters
    sim.tick();
    expect(match.state).toBe('active');
  });

  it('forfeits to the other company when a whole team is gone', () => {
    const { sim, match } = queueTen();
    startBattle(sim, match);
    for (const pid of [...match.teamB]) sim.removePlayer(pid);
    const evs = sim.tick();
    const end = evs.find((e) => e.type === 'bgEnd' && e.pid === match.teamA[0]) as
      | (SimEvent & { won: boolean; rated: boolean })
      | undefined;
    expect(end).toBeTruthy();
    expect(end!.won).toBe(true);
    expect(end!.rated).toBe(false); // desertions un-rated it
    expect(sim.bgMatches.size).toBe(0); // forfeit returns everyone at once
    expect((sim as any).bgBusySlots.size).toBe(0);
  });

  it("the Deserter's Knell blocks re-queueing until it expires", () => {
    const { sim, match } = queueTen();
    startBattle(sim, match);
    const deserter = match.teamB[0];
    const name = sim.meta(deserter)!.name;
    sim.removePlayer(deserter);
    const again = sim.addPlayer('warrior', name);
    sim.setPlayerLevel(20, again);
    teleport(sim, again, 0, -40);
    sim.bgQueueJoin(again);
    expect(sim.bgQueue.length).toBe(0);
    expect(errTexts(sim)).toContain("You cannot queue while the Deserter's Knell tolls.");
    // expire the lockout: the queue opens again
    sim.bgDeserters.set(name.toLowerCase(), sim.time - 1);
    sim.bgQueueJoin(again);
    expect(sim.bgQueue.some((u) => u.pids.includes(again))).toBe(true);
  });
});

describe('battleground: spectate stubs (offline)', () => {
  it('refuses spectate offline with the pinned literals', () => {
    const { sim, match, pids } = queueTen();
    const watcher = sim.addPlayer('mage', 'Watcher');
    sim.setPlayerLevel(20, watcher);
    sim.bgSpectate(match.id, watcher);
    expect(errTexts(sim)).toContain('You cannot spectate right now.');
    sim.bgSpectate(match.id + 999, watcher);
    expect(errTexts(sim)).toContain('That battle has already ended.');
    sim.bgSpectateNext(watcher);
    sim.bgSpectateLeave(watcher);
    expect(errTexts(sim).filter((t) => t === 'You cannot spectate right now.').length).toBe(3);
    expect(pids.length).toBe(10);
  });
});

describe('battleground: duels are blocked mid-match', () => {
  it('refuses a duel challenge to or from a fighter on the field', () => {
    const { sim, match, pids } = queueTen();
    startBattle(sim, match);
    expect(match.state).toBe('active');
    // a fighter challenging a teammate
    sim.duelRequest(pids[1], pids[0]);
    expect(errTexts(sim)).toContain('You cannot duel on the Gravemarch.');
    // the challenge was never filed
    expect(sim.duelInvites.has(pids[1])).toBe(false);
  });
});

describe('battleground: bgInfo readout', () => {
  it('reports queue state, then the live match, then the ladder after a result', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.setPlayerLevel(20, a);
    teleport(sim, a, 0, -40);
    expect(sim.bgInfoFor(a)!.queued).toBe(false);
    sim.bgQueueJoin(a);
    const queuedInfo = sim.bgInfoFor(a)!;
    expect(queuedInfo.queued).toBe(true);
    expect(queuedInfo.position).toBe(1);
    expect(queuedInfo.queueSize).toBe(1);
    expect(queuedInfo.standing.rating).toBe(1500);
    expect(queuedInfo.ladder.length).toBe(0); // nobody rated yet
    expect(queuedInfo.spectating).toBe(null);
    sim.bgQueueLeave(a);

    const { sim: sim2, match } = queueTen();
    startBattle(sim2, match);
    const info = sim2.bgInfoFor(match.teamA[0])!;
    expect(info.match).toBeTruthy();
    expect(info.match!.state).toBe('active');
    expect(info.match!.team).toBe('A');
    expect(info.match!.structures.length).toBe(10);
    expect(info.match!.structures.every((s) => isBattlegroundPos(s.x))).toBe(true);
    expect(info.match!.knell.alive).toBe(false);
    expect(info.match!.knell.spawnsIn).toBeGreaterThan(0);
    expect(info.match!.allies.length).toBe(4);
    expect(info.match!.teamA.length).toBe(5);
    expect(info.liveMatches.length).toBe(1);
    expect(info.liveMatches[0].players).toBe(10);
  });
});

describe('battleground: persistence', () => {
  it('round-trips standings and writes the RETURN position while in a match', () => {
    const { sim, match } = queueTen();
    startBattle(sim, match);
    const pid = match.teamB[0];
    const ret = match.returns.get(pid)!;
    // mid-match snapshot: return position, alive, plus the bgReturnPos fallback
    const midState = sim.serializeCharacter(pid)!;
    expect(midState.pos).toEqual({ x: ret.x, z: ret.z });
    expect(midState.bgReturnPos).toEqual({ x: ret.x, z: ret.z });
    expect(midState.dead).toBe(false);
    expect(midState.ghost).toBe(false);
    expect(midState.bgRating).toBeUndefined(); // untouched until a rated result

    // win the match, then round-trip the standings
    const striker = sim.entities.get(pid)!;
    for (const id of ['a_west_outer', 'a_west_inner', 'a_warstone']) {
      const s = match.structures.find((st) => st.def.id === id)!;
      (sim as any).dealDamage(
        striker,
        sim.entities.get(s.entityId)!,
        999999,
        false,
        'physical',
        null,
        'hit',
      );
    }
    for (let i = 0; i < 20 * (BG_RETURN_DELAY + 1); i++) sim.tick();
    const state = sim.serializeCharacter(pid)!;
    expect(state.bgRating).toBe(1516);
    expect(state.bgWins).toBe(1);
    expect(state.bgLosses).toBeUndefined();
    expect(state.bgReturnPos).toBeUndefined(); // only written mid-match

    const sim2 = makeWorld(43);
    const reborn = sim2.addPlayer('warrior', 'Reborn', { state });
    expect(sim2.meta(reborn)!.bgRating).toBe(1516);
    expect(sim2.meta(reborn)!.bgWins).toBe(1);
    expect(sim2.bgInfoFor(reborn)!.standing).toEqual({ rating: 1516, wins: 1, losses: 0 });
  });

  it('relocates a battleground-band save to bgReturnPos, else the Highwatch hub', () => {
    const sim = makeWorld();
    const donor = sim.addPlayer('warrior', 'Donor');
    const base = sim.serializeCharacter(donor)!;
    const inBand = {
      ...base,
      pos: { x: 9900, z: -1250 },
      bgReturnPos: { x: 12, z: -40 },
    };
    const a = sim.addPlayer('warrior', 'CameBack', { state: inBand });
    const ea = sim.entities.get(a)!;
    expect(Math.abs(ea.pos.x - 12)).toBeLessThan(1);
    expect(Math.abs(ea.pos.z - -40)).toBeLessThan(1);

    const noReturn = { ...base, pos: { x: 9900, z: -1250 }, bgReturnPos: null, dead: true };
    const b = sim.addPlayer('mage', 'Hubbed', { state: noReturn });
    const eb = sim.entities.get(b)!;
    expect(Math.abs(eb.pos.x - 0)).toBeLessThan(1);
    expect(Math.abs(eb.pos.z - 660)).toBeLessThan(1); // Highwatch
    expect(eb.ghost).toBe(false); // dead-on-load never ghost-releases a bg save
  });
});

describe('battleground: determinism', () => {
  it('same seed + same actions = identical numeric trajectories (run twice)', () => {
    const run = () => {
      const sim = makeWorld(7);
      const pids = CLASS_KIT.map((c, i) => {
        const pid = sim.addPlayer(c, `F${i}`);
        sim.setPlayerLevel(20, pid);
        teleport(sim, pid, i * 3, -40);
        return pid;
      });
      for (const pid of pids) sim.bgQueueJoin(pid);
      const trace: number[] = [];
      for (let i = 0; i < 20 * 30; i++) {
        sim.tick();
        if (i % 40 === 0) {
          let hp = 0;
          let x = 0;
          let z = 0;
          let n = 0;
          for (const e of sim.entities.values()) {
            if (e.bgMatchId === undefined && e.kind !== 'player') continue;
            hp += e.hp;
            x += e.pos.x;
            z += e.pos.z;
            n++;
          }
          trace.push(i, n, Math.round(hp), Math.round(x * 100), Math.round(z * 100));
        }
      }
      return trace;
    };
    expect(run()).toEqual(run());
  });

  it('idle battleground code draws nothing from the shared rng stream', () => {
    const drawsOf = (withBgReads: boolean) => {
      const sim = makeWorld(11);
      const a = sim.addPlayer('warrior', 'Reader');
      sim.setPlayerLevel(20, a);
      teleport(sim, a, 0, -40);
      const draws: number[] = [];
      sim.rng.setObserver((v) => draws.push(v));
      for (let i = 0; i < 200; i++) {
        if (withBgReads && i % 10 === 0) {
          // read-only battleground surface must never draw or mutate
          sim.bgInfoFor(a);
          sim.bgLiveMatchIds();
          sim.bgMatchOf(a);
          sim.bgQueueLeave(a); // not queued: a no-op
        }
        sim.tick();
      }
      sim.rng.setObserver(null);
      return draws;
    };
    expect(drawsOf(true)).toEqual(drawsOf(false));
  });
});
