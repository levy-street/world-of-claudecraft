import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { isDispellableAura } from '../src/sim/aura_classify';
import { BG_GRAVEYARDS, BG_POWER_RUNES, BG_SPEED_RUNES } from '../src/sim/battleground_layout';
import { GREATER_INVISIBILITY_DR_AURA_ID } from '../src/sim/combat/greater_invisibility';
import { offerResurrection } from '../src/sim/combat/resurrection_offer';
import { battlegroundOrigin, DUNGEON_X_THRESHOLD, instanceOrigin, isBgPos } from '../src/sim/data';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { summonMountItem, toggleMount } from '../src/sim/mounts';
import {
  awardBattlegroundHonor,
  BATTLEGROUND_ASSIST_HONOR,
  BATTLEGROUND_FIRST_WIN_BONUS_HONOR,
  BATTLEGROUND_KILL_HONOR,
  BATTLEGROUND_LOSS_HONOR,
  BATTLEGROUND_WIN_HONOR,
} from '../src/sim/pvp';
import { eloDelta, Sim } from '../src/sim/sim';
import {
  BG_CAPS_TO_WIN,
  BG_CARRIER_VULN_DELAY,
  BG_CARRIER_VULN_INTERVAL,
  BG_END_HOLD,
  BG_FAIRNESS_MAX_WAIT,
  BG_MAX_DURATION,
  BG_MIN_LEVEL,
  BG_MIN_RATING,
  BG_POWER_RUNE_VALUE,
  BG_PREMADE_HOLD,
  BG_RATING_BAND,
  BG_TEAM_SIZE,
  BG_TIME_WARNINGS,
  BG_WAVE_OFFSET,
  BG_WAVE_PERIOD,
  type BgMatch,
  bgAllPids,
  bgCarryingFlag,
  bgQueueSize,
  bgResolveDesertion,
  bgRespond,
  CARRIED_FLAG_AURA_ID,
  devEndBg,
  devStartBg,
  endBgMatch,
  startBgMatch,
  updateBattleground,
} from '../src/sim/social/battleground';
import {
  BG_OUTCOME_LOG_CAP,
  createBgOutcomeLog,
  drainBgOutcomes,
  recordBgOutcome,
} from '../src/sim/social/battleground_outcomes';
import {
  BG_PROPOSAL_SECONDS,
  bgProposalFor,
  bgRequeueLockedUntil,
} from '../src/sim/social/battleground_proposal';
import { addThreat } from '../src/sim/threat';
import { DT, type SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { EMPTY_TEST_WORLD } from './sim_shared';

// The staged 5v5 arms (graveyard no-auto-release, the 720s cap, the fairness
// clocks, the honor-DR rollover) legitimately run 10 to 19s each and flake
// against the repo-wide 20s testTimeout under parallel suite load. Same
// remedy as the Vale Cup suites: a raised per-suite budget, not thinner arms.
vi.setConfig({ testTimeout: 30000 });

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, world: EMPTY_TEST_WORLD });
}

function tp(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos = { x, y: groundHeight(x, z, sim.cfg.seed), z };
  e.prevPos = { ...e.pos };
  sim.ctx.rebucket(e);
}

/** Answer a live queue-pop offer for every listed fighter. */
/** Answer a backfill offer and drain the tick it seats on, so a caller can
 *  assert on the events the seat emits. */
function acceptBackfillOffer(sim: Sim, pid: number): SimEvent[] {
  bgRespond(sim.ctx, true, pid);
  return sim.drainEvents();
}

function acceptBgOffer(sim: Sim, pids: number[]): void {
  for (const pid of pids) bgRespond(sim.ctx, true, pid);
}

/** Accept EVERY live offer, seating whatever the matchmaker just picked. For
 *  tests whose subject is the pick itself, which do not know the pids up front. */
function acceptAllBgOffers(sim: Sim): void {
  for (const proposal of [...sim.ctx.bgProposals]) {
    acceptBgOffer(sim, [...proposal.teams[0], ...proposal.teams[1]]);
  }
}

// Ten solo players, queued, offered, and accepted, so a 5v5 is live.
function tenInQueue(): { sim: Sim; pids: number[] } {
  const sim = makeWorld();
  const pids: number[] = [];
  const classes = ['warrior', 'mage', 'priest', 'rogue', 'hunter'] as const;
  for (let i = 0; i < 10; i++) {
    const pid = sim.addPlayer(classes[i % 5], `P${i}`);
    tp(sim, pid, (i % 5) * 2 - 4, -40);
    sim.entities.get(pid)!.level = 20; // the queue floor (BG_MIN_LEVEL)
    pids.push(pid);
  }
  for (const pid of pids) sim.bgQueueJoin(pid);
  // The pop lands as an OFFER now (battleground_proposal.ts); accepting it is
  // what seats the match, so every helper that wants a live 5v5 answers first.
  sim.tick();
  acceptBgOffer(sim, pids);
  return { sim, pids };
}

function toActive(sim: Sim, match: BgMatch) {
  for (let i = 0; i < 20 * 12 && match.state !== 'active'; i++) sim.tick();
}

// True when the entity stands inside its team's graveyard plot (world coords).
function inGraveyard(sim: Sim, match: BgMatch, pid: number, team: 0 | 1): boolean {
  const o = battlegroundOrigin(match.slot);
  const plot = BG_GRAVEYARDS[team];
  const e = sim.entities.get(pid)!;
  return (
    Math.abs(e.pos.x - (o.x + plot.x)) <= plot.hw && Math.abs(e.pos.z - (o.z + plot.z)) <= plot.hd
  );
}

function errorTexts(events: SimEvent[]): string[] {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error')
    .map((e) => e.text);
}

// Which pids received one exact log line, sorted: the fan-out question.
function logPidsFor(events: SimEvent[], text: string): number[] {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'log' }> => e.type === 'log' && e.text === text)
    .map((e) => e.pid ?? -1)
    .sort((a, b) => a - b);
}

const bgPartyJoinLine = (count: number): string =>
  `Your party of ${count} joins the Thornhollow Fields queue.`;

const joinInProgressLine = (team: string): string =>
  `Thornhollow Fields: you join a battle already under way for the ${team}. This match will not change your rating.`;

function kill(sim: Sim, pid: number, killerPid: number | null = null) {
  const e = sim.entities.get(pid)!;
  const killer = killerPid !== null ? sim.entities.get(killerPid)! : null;
  sim.ctx.dealDamage(killer, e, 9_999_999, false, 'physical', null, 'hit');
}

// Grab the enemy flag with a deliberate press, then run it home for a capture.
function captureOnce(sim: Sim, match: BgMatch, carrier: number) {
  const azure = match.flags[1];
  const crimsonHome = match.flags[0].home;
  tp(sim, carrier, azure.pos.x, azure.pos.z);
  sim.bgFlagAction(carrier);
  sim.tick();
  tp(sim, carrier, crimsonHome.x, crimsonHome.z);
  sim.tick();
}

describe('Thornhollow Fields: the whole match is fought on foot', () => {
  // Ten queued champions, one of them already riding (and mid-summon of a
  // second mount), NOT yet seated: the tick that follows is the one that seats
  // the teams, which is the moment under test.
  function tenQueuedWithRider(): { sim: Sim; pids: number[]; rider: number } {
    const sim = makeWorld();
    const pids: number[] = [];
    const classes = ['warrior', 'mage', 'priest', 'rogue', 'hunter'] as const;
    for (let i = 0; i < 10; i++) {
      const pid = sim.addPlayer(classes[i % 5], `P${i}`);
      tp(sim, pid, (i % 5) * 2 - 4, -40);
      sim.entities.get(pid)!.level = 20;
      pids.push(pid);
    }
    for (const pid of pids) sim.bgQueueJoin(pid);
    const rider = pids[0];
    const e = sim.entities.get(rider)!;
    e.mountKey = 'valorsteed';
    e.mountCastRemaining = 1.5;
    e.mountCastKey = 'valorsteed';
    return { sim, pids, rider };
  }

  it('dismounts every fighter the moment the match seats them on the field', () => {
    const { sim, rider } = tenQueuedWithRider();
    const e = sim.entities.get(rider)!;
    expect(e.mountKey, 'the fixture really did put them in the saddle').toBe('valorsteed');
    sim.tick(); // the pop lands as an offer...
    acceptAllBgOffers(sim);
    expect(sim.bgMatchFor(rider), 'the seat really happened').not.toBeNull();
    expect(e.mountKey, 'rode into the battleground').toBe('');
    expect(e.mountCastRemaining, 'a summon survived the seat').toBe(0);
    expect(e.mountCastKey).toBe('');
  });

  it('refuses the reins during form-up AND during the active match', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    expect(match.state, 'the form-up gate is where this starts').toBe('countdown');
    const pid = match.teams[0][0];
    const e = sim.entities.get(pid)!;
    sim.addItem('reins_valorsteed', 1, pid);
    // Riding is a permanent capability gate and answers first, so train the
    // rider: what is under test is the battleground rule.
    sim.players.get(pid)!.ridingTrained = true;

    expect(summonMountItem(sim.ctx, pid, 'valorsteed')).toBe(false);
    expect(errorTexts(sim.tick())).toContain("You can't ride in a battleground.");
    expect(e.mountKey).toBe('');

    toActive(sim, match);
    expect(match.state).toBe('active');
    expect(summonMountItem(sim.ctx, pid, 'valorsteed')).toBe(false);
    expect(errorTexts(sim.tick())).toContain("You can't ride in a battleground.");
    expect(e.mountKey).toBe('');
    // Not carrying anything: the old rule was about the flag, this one is not.
    expect(bgCarryingFlag(sim.ctx, pid)).toBe(false);
  });

  it('refuses the riding-lesson toggle in-match too', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const pid = match.teams[0][0];
    const e = sim.entities.get(pid)!;
    // The lesson branch is the one summon path with no reins to click, so it
    // carries its own copy of every gate.
    sim.players.get(pid)!.mountTraining = {
      sessionId: 'mt_test',
      ownerId: pid,
      anchor: { x: 0, z: 0 },
      state: 'IN_PROGRESS',
      phase: 'ride',
    };
    expect(toggleMount(sim.ctx, pid)).toBe(false);
    expect(errorTexts(sim.tick())).toContain("You can't ride in a battleground.");
    expect(e.mountKey).toBe('');
    expect(e.mountCastKey, 'no lesson summon channel started either').toBe('');
  });

  it('gives riding back once the match is over and the fighters go home', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const pid = match.teams[0][0];
    sim.addItem('reins_valorsteed', 1, pid);
    sim.players.get(pid)!.ridingTrained = true;
    expect(summonMountItem(sim.ctx, pid, 'valorsteed')).toBe(false);

    endBgMatch(sim.ctx, match, 0, 'caps');
    for (let i = 0; i < 20 * (BG_END_HOLD + 1); i++) sim.tick(); // run out the hold
    expect(sim.bgMatchFor(pid), 'released home').toBeNull();
    const e = sim.entities.get(pid)!;
    e.dead = false;
    e.ghost = false;
    e.inCombat = false;
    expect(summonMountItem(sim.ctx, pid, 'valorsteed')).toBe(true);
  });

  it('throws a mounted runner out of the saddle when they take the flag', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const crimson = match.teams[0][0];
    const e = sim.entities.get(crimson)!;
    // In the saddle, and mid-summon of another mount at the same time: both
    // have to be gone the moment the flag is in hand, or the grab lands the
    // runner back on a mount a second and a half later.
    e.mountKey = 'valorsteed';
    e.mountCastRemaining = 1.5;
    e.mountCastKey = 'valorsteed';
    const azure = match.flags[1];
    tp(sim, crimson, azure.pos.x, azure.pos.z);
    sim.bgFlagAction(crimson);
    sim.tick();
    expect(azure.carrier, 'the grab itself must land').toBe(crimson);
    expect(e.mountKey, 'still mounted while carrying the flag').toBe('');
    expect(e.mountCastRemaining, 'a summon survived the grab').toBe(0);
    expect(e.mountCastKey).toBe('');
  });

  // The carrier case is now a SUBSET of the whole-match rule, not a rule of its
  // own: dropping the flag no longer gives the saddle back, because the match
  // has not ended. This arm used to assert the narrower message.
  it('keeps refusing the saddle after the carrier drops the flag: the match is the rule', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const crimson = match.teams[0][0];
    const e = sim.entities.get(crimson)!;
    sim.addItem('reins_valorsteed', 1, crimson);
    // Riding is a permanent capability gate and answers before this one, so
    // train the rider: what is under test is the battleground rule.
    sim.players.get(crimson)!.ridingTrained = true;
    const azure = match.flags[1];
    tp(sim, crimson, azure.pos.x, azure.pos.z);
    sim.bgFlagAction(crimson);
    sim.tick();
    expect(azure.carrier).toBe(crimson);
    // Both mount entry points refuse: the item summon and the Mount toggle.
    expect(summonMountItem(sim.ctx, crimson, 'valorsteed')).toBe(false);
    expect(errorTexts(sim.tick())).toContain("You can't ride in a battleground.");
    expect(e.mountKey).toBe('');
    expect(toggleMount(sim.ctx, crimson)).toBe(false);
    expect(e.mountKey).toBe('');
    // Drop it (killing the carrier is how a flag comes loose) and revive the
    // body so the dead/ghost refusal is not what answers: still no saddle.
    kill(sim, crimson);
    sim.tick();
    expect(azure.carrier).toBeNull();
    expect(bgCarryingFlag(sim.ctx, crimson)).toBe(false);
    const revived = sim.entities.get(crimson)!;
    revived.dead = false;
    revived.ghost = false;
    revived.inCombat = false;
    expect(summonMountItem(sim.ctx, crimson, 'valorsteed')).toBe(false);
    expect(errorTexts(sim.tick())).toContain("You can't ride in a battleground.");
  });
});

describe('Thornhollow Fields: queue + matchmaking', () => {
  it('needs ten players; then forms two teams of five and seats them in the battleground band', () => {
    const sim = makeWorld();
    const pids: number[] = [];
    for (let i = 0; i < 9; i++) {
      const pid = sim.addPlayer('warrior', `W${i}`);
      tp(sim, pid, 0, -40);
      sim.entities.get(pid)!.level = BG_MIN_LEVEL;
      pids.push(pid);
      sim.bgQueueJoin(pid);
    }
    sim.tick();
    expect(sim.bgMatchFor(pids[0])).toBe(null); // 9 is not enough

    const tenth = sim.addPlayer('mage', 'Tenth');
    tp(sim, tenth, 0, -40);
    sim.entities.get(tenth)!.level = BG_MIN_LEVEL;
    sim.bgQueueJoin(tenth);
    sim.tick();
    acceptBgOffer(sim, [...pids, tenth]);
    const match = sim.bgMatchFor(pids[0])!;
    expect(match).toBeTruthy();
    expect(match.teams[0]).toHaveLength(5);
    expect(match.teams[1]).toHaveLength(5);
    for (const pid of [...match.teams[0], ...match.teams[1]]) {
      expect(isBgPos(sim.entities.get(pid)!.pos.x)).toBe(true);
    }
    expect(match.state).toBe('countdown');
  });

  it('keeps a queued party together on one team, filled with solos', () => {
    const sim = makeWorld();
    const leader = sim.addPlayer('warrior', 'Leader');
    tp(sim, leader, 0, -40);
    sim.entities.get(leader)!.level = BG_MIN_LEVEL;
    const party = [leader];
    for (let i = 0; i < 3; i++) {
      const m = sim.addPlayer('priest', `Mate${i}`);
      tp(sim, m, 0, -40);
      sim.entities.get(m)!.level = BG_MIN_LEVEL;
      sim.partyInvite(m, leader);
      sim.partyAccept(m);
      party.push(m);
    }
    const solos: number[] = [];
    for (let i = 0; i < 6; i++) {
      const s = sim.addPlayer('rogue', `Solo${i}`);
      tp(sim, s, 0, -40);
      sim.entities.get(s)!.level = BG_MIN_LEVEL;
      solos.push(s);
      sim.bgQueueJoin(s);
    }
    sim.bgQueueJoin(leader); // queues the whole party as one group
    // A four-stack against nothing but solos is held briefly for a
    // counterweight (BG_PREMADE_HOLD), so this ten does NOT seat on the tick.
    sim.tick();
    expect(sim.bgMatchFor(leader), 'a premade vs pugs must not seat instantly').toBeNull();
    // ...and then it seats anyway rather than stranding the queue.
    for (let i = 0; i < 20 * (BG_PREMADE_HOLD + 1) && !sim.bgMatchFor(leader); i++) {
      sim.tick();
      acceptAllBgOffers(sim);
    }
    const match = sim.bgMatchFor(leader)!;
    expect(match).toBeTruthy();
    const teamOfLeader = match.teams[0].includes(leader) ? 0 : 1;
    for (const m of party) expect(match.teams[teamOfLeader]).toContain(m);
  });

  it('queues while dead and from inside an instance, and still refuses a double queue', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'A');
    sim.entities.get(a)!.level = BG_MIN_LEVEL;
    const dungeonInstance = instanceOrigin(0, 0);
    tp(sim, a, dungeonInstance.x, dungeonInstance.z); // a dungeon instance band
    sim.bgQueueJoin(a);
    expect(sim.bgInfoFor(a)!.queued, 'a dungeon pull must not cost the spot').toBe(true);
    sim.bgQueueLeave(a);

    tp(sim, a, 0, -40);
    kill(sim, a);
    sim.bgQueueJoin(a);
    expect(sim.bgInfoFor(a)!.queued, 'a corpse run must not cost the spot').toBe(true);
    // The matchmaker tick is where the old eviction happened, so the wait has to
    // survive one: pressing Queue and being dropped a tick later is the bug.
    sim.tick();
    expect(sim.bgInfoFor(a)!.queued, 'the matchmaker tick must not evict a corpse').toBe(true);
    sim.bgQueueLeave(a);

    const b = sim.addPlayer('mage', 'B');
    tp(sim, b, 0, -40);
    sim.entities.get(b)!.level = BG_MIN_LEVEL;
    sim.bgQueueJoin(b);
    sim.bgQueueJoin(b); // idempotent re-queue
    expect(sim.bgInfoFor(b)!.queued).toBe(true);
    expect(sim.bgInfoFor(b)!.queueSize).toBe(1);
    sim.bgQueueLeave(b);
    expect(sim.bgInfoFor(b)!.queued).toBe(false);
  });
});

// Ten queued champions on ONE tick short of seating, so a caller can do
// something to one of them (kill them, walk them into a dungeon) and then let
// the pop land on that state.
function tenQueuedUnseated(): { sim: Sim; pids: number[] } {
  const sim = makeWorld();
  const pids: number[] = [];
  const classes = ['warrior', 'mage', 'priest', 'rogue', 'hunter'] as const;
  for (let i = 0; i < 10; i++) {
    const pid = sim.addPlayer(classes[i % 5], `Q${i}`);
    tp(sim, pid, (i % 5) * 2 - 4, -40);
    sim.entities.get(pid)!.level = BG_MIN_LEVEL;
    pids.push(pid);
    sim.bgQueueJoin(pid);
  }
  return { sim, pids };
}

describe('Thornhollow Fields: the queue survives the wait', () => {
  it('seats a fighter who died waiting, alive and whole rather than as a corpse', () => {
    const { sim, pids } = tenQueuedUnseated();
    const corpse = pids[3];
    kill(sim, corpse);
    const dead = sim.entities.get(corpse)!;
    expect(dead.dead, 'the arrangement itself must hold').toBe(true);

    sim.tick(); // the pop, which is now an OFFER (battleground_proposal.ts)
    acceptAllBgOffers(sim);
    const match = sim.bgMatchFor(corpse);
    expect(match, 'dying while waiting must not cost the seat').toBeTruthy();
    expect(bgAllPids(match!)).toContain(corpse);
    // Seated alive: every arm of the spirit state, since ghost implies dead
    // everywhere else and a stale corpsePos would strand a rez prompt on the field.
    expect(dead.dead).toBe(false);
    expect(dead.ghost).toBe(false);
    expect(dead.corpsePos).toBeNull();
    expect(dead.hp).toBe(dead.maxHp);
    expect(isBgPos(dead.pos.x)).toBe(true);

    // ...and they go home ALIVE, not back to the corpse they left behind. The
    // match is a parenthesis: pools are handed back as carried in, and a corpse
    // carried in nothing, so the floor of 1 hp is what they leave with. That is
    // the deliberate cost of the free trip past a corpse run, and the reason we
    // do not restore the death: a stale corpsePos outlives the body it named.
    endBgMatch(sim.ctx, match!, 0, 'caps');
    expect(dead.dead).toBe(false);
    expect(dead.ghost).toBe(false);
    expect(dead.hp).toBe(1);
    expect(isBgPos(dead.pos.x)).toBe(false);
  });

  it('holds the spot through a dungeon pull, then detaches the fighter at the door', () => {
    const { sim, pids } = tenQueuedUnseated();
    const diver = pids[6];
    enterDungeon(sim.ctx, 'gravewyrm_sanctum', diver);
    const e = sim.entities.get(diver)!;
    expect(e.pos.x, 'the arrangement itself must hold').toBeGreaterThan(DUNGEON_X_THRESHOLD);

    // Put the diver on a live hate table so the scrub has something to undo.
    const inst = sim.ctx.instances.find((i) => i.partyKey !== null)!;
    const mob = inst.mobIds.map((id) => sim.entities.get(id)).find((m) => m && !m.dead)!;
    addThreat(mob, diver, 500);
    expect(mob.threat.get(diver)).toBe(500);

    sim.tick(); // the pop, which is now an OFFER (battleground_proposal.ts)
    acceptAllBgOffers(sim);
    const match = sim.bgMatchFor(diver);
    expect(match, 'a dungeon pull must not cost the seat').toBeTruthy();
    expect(isBgPos(e.pos.x)).toBe(true);

    // Leaving through the battleground must cost exactly what leaving through
    // the door costs: the instance no longer holds any aggro on them.
    expect(mob.threat.has(diver), 'the pop must scrub instance threat').toBe(false);

    // ...and the return point is the door OUTSIDE, never the interior
    // coordinates, whose claim may be gone by the time the match ends.
    const ret = match!.returns.get(diver)!;
    expect(ret.x).toBeLessThanOrEqual(DUNGEON_X_THRESHOLD);
    endBgMatch(sim.ctx, match!, 0, 'caps');
    expect(e.pos.x, 'the fighter must not be sent back inside').toBeLessThanOrEqual(
      DUNGEON_X_THRESHOLD,
    );
    expect(e.dead).toBe(false);
  });

  it('still drops a waiting player who commits to an arena match, and says so', () => {
    const { sim, pids } = tenQueuedUnseated();
    const defector = pids[2];
    const opponent = sim.addPlayer('warrior', 'ArenaFoe');
    tp(sim, opponent, 0, -40);
    sim.entities.get(opponent)!.level = BG_MIN_LEVEL;
    sim.arenaQueueJoin(defector);
    sim.arenaQueueJoin(opponent);

    const events: SimEvent[] = [];
    for (let i = 0; i < 20 * 60 && !sim.ctx.arenaMatches.has(defector); i++) {
      events.push(...sim.tick());
    }
    expect(sim.ctx.arenaMatches.has(defector), 'the arrangement itself must hold').toBe(true);

    // The instance-position check used to do this job as a side effect (the
    // arena band sits past DUNGEON_X_THRESHOLD); it is now explicit, so pin it.
    expect(sim.bgInfoFor(defector)!.queued).toBe(false);
    expect(sim.bgMatchFor(defector)).toBeNull();
    expect(logPidsFor(events, 'You leave the Thornhollow Fields queue.')).toContain(defector);
    // Only the defector: the other nine keep waiting.
    for (const pid of pids.filter((p) => p !== defector)) {
      expect(sim.bgInfoFor(pid)!.queued).toBe(true);
    }
  });
});

describe('Thornhollow Fields: team parties for the match', () => {
  it('evicts a deserter who was the party BASE, not just an auto-added member', () => {
    // Review catch: formBgTeamParty returns everyone the formation ADDED, and
    // the base unit kept its own party object, so it never appears in
    // autoPartyPids. A base deserter was therefore left in the match party,
    // reading its chat and holding a frame for a fight they had walked out of.
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    const team = match.teams[0];
    // An all-solo side's party is entirely this system's invention, so EVERY
    // member is recorded as auto-added, base included. That is the arrangement
    // the fix rests on: the base is unwound by id rather than by inferring
    // "system-built" from who else sits in the party.
    expect(
      [...match.autoPartyPids[0]].sort((a, b) => a - b),
      'an all-solo side records its whole roster, base included',
    ).toEqual([...team].sort((a, b) => a - b));
    const base = team[0];

    bgResolveDesertion(sim.ctx, base);

    const stayer = team.find((p) => p !== base)!;
    const party = sim.partyOf(stayer);
    expect(party, 'the rest of the team keeps its party').toBeTruthy();
    expect(party!.members, 'the deserting base is out of it').not.toContain(base);
    expect(sim.partyOf(base), 'and holds no match party of their own').toBeNull();
  });

  it('leaves a PARTIAL premade deserter with their own friends', () => {
    // Review catch, and the reason the base rule is spelled by id rather than
    // inferred: formBgTeamParty picks the premade's own party as the base and
    // MERGES the solos into it. So on a partial premade the match party IS the
    // players' group and merely contains auto-added solos, and any rule that
    // read "shares a party with an auto-added member" as "system built" would
    // throw a deserting friend out of their own group.
    const sim = makeWorld();
    const leader = sim.addPlayer('warrior', 'Leader');
    tp(sim, leader, 0, -40);
    sim.entities.get(leader)!.level = BG_MIN_LEVEL;
    const friends = [leader];
    for (let i = 0; i < 2; i++) {
      const m = sim.addPlayer('priest', `Friend${i}`);
      tp(sim, m, 0, -40);
      sim.entities.get(m)!.level = BG_MIN_LEVEL;
      sim.partyInvite(m, leader);
      sim.partyAccept(m);
      friends.push(m);
    }
    for (let i = 0; i < 7; i++) {
      const s = sim.addPlayer('rogue', `Solo${i}`);
      tp(sim, s, 0, -40);
      sim.entities.get(s)!.level = BG_MIN_LEVEL;
      sim.bgQueueJoin(s);
    }
    sim.bgQueueJoin(leader);
    sim.tick();
    acceptAllBgOffers(sim);
    const match = sim.bgMatchFor(leader)!;
    const team = match.teams[0].includes(leader) ? 0 : 1;

    // The arrangement that makes this the partial case: the friends are the
    // base, so none of them is recorded as auto-added, and the party they kept
    // really does hold a solo.
    for (const f of friends) expect(match.autoPartyPids[team]).not.toContain(f);
    const merged = sim.partyOf(leader)!;
    expect(
      match.autoPartyPids[team].some((p) => merged.members.includes(p)),
      'the premade party really did absorb a solo',
    ).toBe(true);

    const deserter = friends[1];
    bgResolveDesertion(sim.ctx, deserter);

    const stillTogether = sim.partyOf(leader);
    expect(stillTogether, 'the friends keep their group').toBeTruthy();
    expect(
      stillTogether!.members,
      'a deserting friend stays with the friends they queued with',
    ).toContain(deserter);
  });

  it('welds each all-solo team into one party at start and disbands both at the end', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    for (const team of [0, 1] as const) {
      const roster = match.teams[team];
      const party = sim.partyOf(roster[0])!;
      expect(party).toBeTruthy();
      expect([...party.members].sort((a, b) => a - b)).toEqual([...roster].sort((a, b) => a - b));
      for (const pid of roster) expect(sim.partyOf(pid)?.id).toBe(party.id);
    }
    // two teams, two DIFFERENT parties: party chat can never leak cross-team
    expect(sim.partyOf(match.teams[0][0])!.id).not.toBe(sim.partyOf(match.teams[1][0])!.id);
    endBgMatch(sim.ctx, match, 0, 'caps');
    for (const pid of pids) expect(sim.partyOf(pid)).toBe(null);
  });

  it('a queued premade keeps its party id and leader; merged solos drop out at the end', () => {
    const sim = makeWorld();
    const leader = sim.addPlayer('warrior', 'Leader');
    tp(sim, leader, 0, -40);
    sim.entities.get(leader)!.level = BG_MIN_LEVEL;
    const premade = [leader];
    for (let i = 0; i < 2; i++) {
      const m = sim.addPlayer('priest', `Mate${i}`);
      tp(sim, m, 0, -40);
      sim.entities.get(m)!.level = BG_MIN_LEVEL;
      sim.partyInvite(m, leader);
      sim.partyAccept(m);
      premade.push(m);
    }
    const beforeId = sim.partyOf(leader)!.id;
    for (let i = 0; i < 7; i++) {
      const s = sim.addPlayer('rogue', `Solo${i}`);
      tp(sim, s, 0, -40);
      sim.entities.get(s)!.level = BG_MIN_LEVEL;
      sim.bgQueueJoin(s);
    }
    sim.bgQueueJoin(leader); // queues the whole premade as one group
    sim.tick();
    acceptAllBgOffers(sim);
    const match = sim.bgMatchFor(leader)!;
    const team = match.teams[0].includes(leader) ? 0 : 1;
    const party = sim.partyOf(leader)!;
    expect(party.id).toBe(beforeId); // the premade's party object survived
    expect(party.leader).toBe(leader);
    expect([...party.members].sort((a, b) => a - b)).toEqual(
      [...match.teams[team]].sort((a, b) => a - b),
    );
    endBgMatch(sim.ctx, match, null, 'timeout');
    const after = sim.partyOf(leader)!;
    expect(after.id).toBe(beforeId);
    expect([...after.members].sort((a, b) => a - b)).toEqual([...premade].sort((a, b) => a - b));
    for (const pid of match.teams[team]) {
      if (!premade.includes(pid)) expect(sim.partyOf(pid)).toBe(null);
    }
  });

  it('an auto-added deserter leaves the team party; the rest stay grouped', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    const roster = [...match.teams[0]];
    const deserter = roster[1]; // never the base solo the fresh party formed on
    bgResolveDesertion(sim.ctx, deserter);
    expect(sim.partyOf(deserter)).toBe(null);
    const party = sim.partyOf(roster[0])!;
    expect(party.members).toHaveLength(4);
    expect(party.members).not.toContain(deserter);
  });
});

describe('Thornhollow Fields: the post-match hold (frozen result screen)', () => {
  function playToCaps() {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const carrier = match.teams[0][0];
    for (let i = 0; i < 5; i++) captureOnce(sim, match, carrier);
    return { sim, pids, match, carrier };
  }

  it('winning on caps freezes the match: state ended, result resolved, combat off, nobody moved home yet', () => {
    const { sim, match, carrier } = playToCaps();
    expect(match.state).toBe('ended');
    expect(match.winner).toBe(0);
    expect(match.resultRecorded).toBe(true);
    // ratings + W/L landed at the freeze, not at the release
    expect(sim.players.get(carrier)!.bgWins).toBe(1);
    expect(sim.players.get(carrier)!.bgRating).toBeGreaterThan(1500);
    // everyone is still inside the band, and cross-team combat is off
    for (const pid of [...match.teams[0], ...match.teams[1]]) {
      expect(isBgPos(sim.entities.get(pid)!.pos.x)).toBe(true);
      expect(sim.bgMatchFor(pid)).toBe(match);
    }
    const enemy = match.teams[1][0];
    // The hostility arm requires state 'active': the two sides read friendly
    // again the moment the screen freezes, so no ability can target across.
    expect(sim.isHostileTo(sim.entities.get(carrier)!, sim.entities.get(enemy)!)).toBe(false);
    // the wire view carries the hold: state, winner, and the countdown slot
    const view = sim.bgInfoFor(carrier)!.match!;
    expect(view.state).toBe('ended');
    expect(view.winner).toBe(0);
    expect(view.countdown).toBeGreaterThan(0);
    expect(view.countdown).toBeLessThanOrEqual(BG_END_HOLD);
    // both flags came silently home for the screen
    expect(match.flags[0].state).toBe('home');
    expect(match.flags[1].state).toBe('home');
  });

  it('after the hold everyone is released home exactly once (parties unwound too)', () => {
    const { sim, pids, match } = playToCaps();
    for (let i = 0; i < 20 * (BG_END_HOLD + 1); i++) sim.tick();
    for (const pid of pids) {
      expect(sim.bgMatchFor(pid)).toBe(null);
      expect(isBgPos(sim.entities.get(pid)!.pos.x)).toBe(false);
      expect(sim.partyOf(pid)).toBe(null);
    }
    expect(match.fightersReleased).toBe(true);
  });

  it('a desertion-forfeit still ends immediately (no hold with an empty side)', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    for (const pid of [...match.teams[1]]) bgResolveDesertion(sim.ctx, pid);
    expect(match.resultRecorded).toBe(true);
    expect(match.fightersReleased).toBe(true);
    for (const pid of match.teams[0]) expect(sim.bgMatchFor(pid)).toBe(null);
  });
});

describe('Thornhollow Fields: release is never gated by a stale arena entry (playtest regression)', () => {
  it('releases into the team graveyard even while arenaMatches still holds an entry', () => {
    // The playtest bug: a leaked arenaMatches entry (jail/cross-queue holes)
    // made releasePlayerSpirit silently no-op for one player all match. The
    // bg membership must WIN over the arena guard.
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const victim = match.teams[0][1];
    kill(sim, victim, match.teams[1][0]);
    sim.tick();
    // The stale leak lands AFTER the death (no tick runs over the stub entry:
    // updateArena would choke on a shapeless match; the release path only
    // asks arenaMatches.has, which is exactly what the real leak exposed).
    sim.arenaMatches.set(victim, {} as never);
    sim.releaseSpirit(victim);
    const e = sim.entities.get(victim)!;
    expect(e.ghost).toBe(true);
    expect(inGraveyard(sim, match, victim, 0)).toBe(true);
    sim.arenaMatches.delete(victim);
  });

  it('refuses the Thornhollow Fields queue while in an arena match (the front door)', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'A');
    tp(sim, a, 0, -40);
    sim.entities.get(a)!.level = BG_MIN_LEVEL;
    sim.arenaMatches.set(a, {} as never);
    sim.bgQueueJoin(a);
    expect(sim.bgInfoFor(a)!.queued).toBe(false);
    sim.arenaMatches.delete(a);
    sim.bgQueueJoin(a);
    expect(sim.bgInfoFor(a)!.queued).toBe(true);
  });

  it('a fighter seated by the form-up never keeps ghost/corpse state into the battle', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    expect(match.state).toBe('countdown');
    const victim = match.teams[0][0];
    kill(sim, victim); // environmental death during the form-up
    sim.tick();
    sim.releaseSpirit(victim);
    expect(sim.entities.get(victim)!.ghost).toBe(true);
    toActive(sim, match);
    const e = sim.entities.get(victim)!;
    expect(e.dead).toBe(false);
    expect(e.ghost).toBe(false);
    expect(e.corpsePos).toBe(null);
  });
});

describe('Thornhollow Fields: dev-forced matches are unrated (jgyy review)', () => {
  it('a devStartBg match moves no rating, W/L, or honor on resolve', () => {
    const sim = makeWorld();
    const pids: number[] = [];
    for (let i = 0; i < 4; i++) {
      const pid = sim.addPlayer('warrior', `D${i}`);
      tp(sim, pid, 0, -40);
      sim.entities.get(pid)!.level = BG_MIN_LEVEL;
      pids.push(pid);
      sim.bgQueueJoin(pid);
    }
    devStartBg(sim.ctx);
    const match = sim.bgMatchFor(pids[0])!;
    expect(match.rated).toBe(false);
    toActive(sim, match);
    const carrier = match.teams[0][0];
    for (let i = 0; i < 5; i++) captureOnce(sim, match, carrier);
    expect(match.state).toBe('ended');
    for (const pid of pids) {
      expect(sim.meta(pid)!.bgRating).toBe(1500);
      expect(sim.meta(pid)!.bgWins).toBe(0);
      expect(sim.meta(pid)!.bgLosses).toBe(0);
      expect(sim.meta(pid)!.honor ?? 0).toBe(0);
    }
    // a queue-made match stays rated (the flag defaults true)
    const { sim: sim2, pids: pids2 } = tenInQueue();
    expect(sim2.bgMatchFor(pids2[0])!.rated).toBe(true);
  });
});

describe('Thornhollow Fields: /dev bg end (early resolve)', () => {
  it('resolves the match on the current score through the normal hold, once', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    captureOnce(sim, match, match.teams[0][0]);
    expect(devEndBg(sim.ctx, pids[0])).toBe(true);
    expect(match.state).toBe('ended');
    expect(match.winner).toBe(0); // 1:0 resolves for Crimson, not a draw
    expect(match.resultRecorded).toBe(true);
    expect(devEndBg(sim.ctx, pids[0])).toBe(false); // already resolved
    for (let i = 0; i < 20 * (BG_END_HOLD + 1); i++) sim.tick();
    expect(sim.bgMatchFor(pids[0])).toBe(null); // released home like any finish
  });
});

describe('Thornhollow Fields: the level 20 queue floor', () => {
  it('refuses an under-leveled solo queue and admits exactly BG_MIN_LEVEL', () => {
    expect(BG_MIN_LEVEL).toBe(20);
    const sim = makeWorld();
    const low = sim.addPlayer('warrior', 'Lowbie');
    sim.entities.get(low)!.level = BG_MIN_LEVEL - 1;
    sim.bgQueueJoin(low);
    expect(sim.bgInfoFor(low)!.queued).toBe(false);
    const ready = sim.addPlayer('mage', 'Ready');
    sim.entities.get(ready)!.level = BG_MIN_LEVEL;
    sim.bgQueueJoin(ready);
    expect(sim.bgInfoFor(ready)!.queued).toBe(true);
  });

  it('refuses a party containing a single under-leveled member', () => {
    const sim = makeWorld();
    const leader = sim.addPlayer('warrior', 'Leader');
    const buddy = sim.addPlayer('mage', 'Buddy');
    sim.entities.get(leader)!.level = BG_MIN_LEVEL;
    sim.entities.get(buddy)!.level = BG_MIN_LEVEL - 1;
    sim.partyInvite(buddy, leader);
    sim.partyAccept(buddy);
    sim.bgQueueJoin(leader);
    expect(sim.bgInfoFor(leader)!.queued).toBe(false);
    expect(sim.bgInfoFor(buddy)!.queued).toBe(false);
    // level the buddy and the same queue press works
    sim.entities.get(buddy)!.level = BG_MIN_LEVEL;
    sim.bgQueueJoin(leader);
    expect(sim.bgInfoFor(leader)!.queued).toBe(true);
    expect(sim.bgInfoFor(buddy)!.queued).toBe(true);
  });
});

describe('Thornhollow Fields: only the party leader queues the group', () => {
  // A three-stack, all at the queue floor, standing in the open world.
  function partyOfThree(): { sim: Sim; leader: number; members: number[] } {
    const sim = makeWorld();
    const leader = sim.addPlayer('warrior', 'Leader');
    tp(sim, leader, 0, -40);
    sim.entities.get(leader)!.level = BG_MIN_LEVEL;
    const members = [leader];
    for (let i = 0; i < 2; i++) {
      const m = sim.addPlayer('priest', `Mate${i}`);
      tp(sim, m, 0, -40);
      sim.entities.get(m)!.level = BG_MIN_LEVEL;
      sim.partyInvite(m, leader);
      sim.partyAccept(m);
      members.push(m);
    }
    return { sim, leader, members };
  }

  it('refuses a non-leader member with the leader-only error and leaves the queue untouched', () => {
    const { sim, leader, members } = partyOfThree();
    const member = members[1];
    expect(sim.partyOf(member)!.leader).toBe(leader);
    sim.events.length = 0;
    sim.bgQueueJoin(member);
    expect(errorTexts(sim.events)).toEqual([
      'Only the party leader may queue your team for Thornhollow Fields.',
    ]);
    // Nothing entered the queue: not the presser, not the party, not the leader.
    for (const m of members) expect(sim.bgInfoFor(m)!.queued).toBe(false);
    expect(sim.bgInfoFor(leader)!.queueSize).toBe(0);
    // The refusal is a toast, never a silent no-op with a queue line behind it.
    expect(logPidsFor(sim.events, bgPartyJoinLine(members.length))).toEqual([]);
  });

  it('queues the whole party for the leader; every member sees it and gets the join line', () => {
    const { sim, leader, members } = partyOfThree();
    sim.events.length = 0;
    sim.bgQueueJoin(leader);
    expect(errorTexts(sim.events)).toEqual([]);
    const sorted = [...members].sort((a, b) => a - b);
    // bgInfoFor is MEMBERSHIP-based, not caller-based: a member who never
    // pressed the button still reads their group's queued state.
    for (const m of members) {
      const info = sim.bgInfoFor(m)!;
      expect(info.queued, `member ${m} must see the queued group`).toBe(true);
      expect(info.queuedParty).toBe(members.length);
      expect(info.queueSize).toBe(members.length);
    }
    // ...and the chat line + the queued event fan out to the whole group.
    expect(logPidsFor(sim.events, bgPartyJoinLine(members.length))).toEqual(sorted);
    expect(
      sim.events
        .filter((e): e is Extract<SimEvent, { type: 'bgQueued' }> => e.type === 'bgQueued')
        .map((e) => e.pid ?? -1)
        .sort((a, b) => a - b),
    ).toEqual(sorted);
  });

  it('leaves solo queueing untouched', () => {
    const sim = makeWorld();
    const solo = sim.addPlayer('mage', 'Solo');
    tp(sim, solo, 0, -40);
    sim.entities.get(solo)!.level = BG_MIN_LEVEL;
    expect(sim.partyOf(solo)).toBe(null);
    sim.events.length = 0;
    sim.bgQueueJoin(solo);
    expect(errorTexts(sim.events)).toEqual([]);
    expect(sim.bgInfoFor(solo)!.queued).toBe(true);
    expect(sim.bgInfoFor(solo)!.queuedParty).toBe(1);
    expect(
      logPidsFor(
        sim.events,
        `You join the Thornhollow Fields queue. Need ${BG_TEAM_SIZE * 2} champions to start a match.`,
      ),
    ).toEqual([solo]);
  });

  it('still lets a non-leader member leave the queue (no leader gate on leave)', () => {
    const { sim, leader, members } = partyOfThree();
    sim.bgQueueJoin(leader);
    for (const m of members) expect(sim.bgInfoFor(m)!.queued).toBe(true);
    const member = members[2];
    sim.events.length = 0;
    sim.bgQueueLeave(member); // never the leader
    expect(errorTexts(sim.events)).toEqual([]);
    // Unchanged behaviour: the member's press pulls the whole group out.
    for (const m of members) expect(sim.bgInfoFor(m)!.queued).toBe(false);
    expect(sim.bgInfoFor(leader)!.queueSize).toBe(0);
    expect(logPidsFor(sim.events, 'You leave the Thornhollow Fields queue.')).toEqual(
      [...members].sort((a, b) => a - b),
    );
  });
});

describe('Thornhollow Fields: match tallies (kills, deaths, captures)', () => {
  it('counts deaths, credits only enemy killers, and counts captures on the wire rows', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const killer = match.teams[0][0];
    const victim = match.teams[1][0];
    kill(sim, victim, killer);
    sim.tick();
    let rows = sim.bgInfoFor(killer)!.match!.players;
    expect(rows.find((p) => p.pid === killer)).toMatchObject({ kills: 1, deaths: 0, captures: 0 });
    expect(rows.find((p) => p.pid === victim)).toMatchObject({ kills: 0, deaths: 1, captures: 0 });
    // a same-team death counts the death and credits nobody
    const tkVictim = match.teams[0][1];
    const tkDealer = match.teams[0][2];
    kill(sim, tkVictim, tkDealer);
    sim.tick();
    rows = sim.bgInfoFor(killer)!.match!.players;
    expect(rows.find((p) => p.pid === tkVictim)).toMatchObject({ deaths: 1 });
    expect(rows.find((p) => p.pid === tkDealer)).toMatchObject({ kills: 0 });
    // and NOBODY else picked the team kill up by mistake (jgyy review): the
    // only kill on the board is still the killer's first one.
    expect(rows.reduce((sum, p) => sum + p.kills, 0)).toBe(1);
    // a capture lands on the carrier's row
    captureOnce(sim, match, killer);
    rows = sim.bgInfoFor(killer)!.match!.players;
    expect(rows.find((p) => p.pid === killer)).toMatchObject({ kills: 1, captures: 1 });
  });

  it('feeds every match member a bgKill event with names and teams', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const killer = match.teams[0][0];
    const victim = match.teams[1][0];
    kill(sim, victim, killer);
    const evs = sim.tick().filter((e) => e.type === 'bgKill');
    expect(evs).toHaveLength(10); // one per match member, both teams
    const mine = evs.find((e) => 'pid' in e && e.pid === killer)!;
    expect(mine).toMatchObject({
      killerName: sim.players.get(killer)!.name,
      victimName: sim.players.get(victim)!.name,
      killerTeam: 0,
      victimTeam: 1,
    });
    // a team kill still feeds, unattributed: null killer, null killer team
    kill(sim, match.teams[0][1], match.teams[0][2]);
    const evs2 = sim.tick().filter((e) => e.type === 'bgKill');
    expect(evs2).toHaveLength(10);
    expect(evs2[0]).toMatchObject({ killerName: null, killerTeam: null, victimTeam: 0 });
  });
});

describe('Thornhollow Fields: power runes (Battle / Ward)', () => {
  it('opens both pads on the same seeded face, applies the right buff, and flips per claim', () => {
    // determinism: the same seed opens the same face
    const face = (seed: number) => {
      const sim = new Sim({
        seed,
        playerClass: 'warrior',
        noPlayer: true,
        world: EMPTY_TEST_WORLD,
      });
      const pids: number[] = [];
      const classes = ['warrior', 'mage', 'priest', 'rogue', 'hunter'] as const;
      for (let i = 0; i < 10; i++) {
        const pid = sim.addPlayer(classes[i % 5], `P${i}`);
        sim.entities.get(pid)!.level = 20;
        pids.push(pid);
        sim.bgQueueJoin(pid);
      }
      sim.tick();
      acceptBgOffer(sim, pids);
      return { sim, match: sim.bgMatchFor(pids[0])! };
    };
    // The sprint pads are spawned first, the power pads after, so the field's
    // own pad counts decide where the power block starts.
    const firstPower = BG_SPEED_RUNES.length;
    const a = face(42);
    const b = face(42);
    expect(a.match.runes.length).toBe(BG_SPEED_RUNES.length + BG_POWER_RUNES.length);
    expect(a.match.runes[firstPower].type).toBe(b.match.runes[firstPower].type);
    // every sprint pad stays sprint; all power pads share one opening face
    expect(a.match.runes.slice(0, firstPower).every((r) => r.type === 'sprint')).toBe(true);
    const powerFaces = a.match.runes.slice(firstPower).map((r) => r.type);
    expect(new Set(powerFaces).size).toBe(1);
    expect(['damage', 'defense']).toContain(powerFaces[0]);

    const { sim, match } = a;
    toActive(sim, match);
    const runner = match.teams[0][0];
    const power = match.runes[firstPower];
    const openingFace = power.type;
    tp(sim, runner, power.pos.x, power.pos.z);
    sim.tick();
    const e = sim.entities.get(runner)!;
    const expectedKind = openingFace === 'damage' ? 'buff_dmg_done' : 'shield_wall';
    const buff = e.auras.find((au) => au.kind === expectedKind);
    expect(buff).toBeTruthy();
    expect(buff!.value).toBeCloseTo(BG_POWER_RUNE_VALUE, 5);
    // the claimed pad flips its face for the next spawn
    expect(power.type).toBe(openingFace === 'damage' ? 'defense' : 'damage');
    expect(power.active).toBe(false);
  });
});

describe('Thornhollow Fields: the form-up hold', () => {
  it('a runner slipping out during the countdown is set back and told why', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    expect(match.state).toBe('countdown');
    const runner = match.teams[0][0];
    const o = battlegroundOrigin(match.slot);
    tp(sim, runner, o.x, o.z - 60); // out past the keep, into the field chamber
    const evs = sim.tick();
    const e = sim.entities.get(runner)!;
    const lz = e.pos.z - o.z;
    expect(lz).toBeGreaterThanOrEqual(-128); // back inside the Crimson keep box
    expect(lz).toBeLessThanOrEqual(-108);
    expect(
      evs.some(
        (v) =>
          v.type === 'error' &&
          v.pid === runner &&
          v.text === 'The gates open when the battle begins.',
      ),
    ).toBe(true);
  });
});

describe('Thornhollow Fields: the graveyard rite', () => {
  it('a corpse NEVER auto-releases (the press is the player own move); the ward binds the ghost', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const victim = match.teams[0][0];
    kill(sim, victim);
    sim.tick();
    const e = sim.entities.get(victim)!;
    // a full half minute (three whole waves) later, the corpse still lies
    // where it fell: no timer touches it, and no wave raises an unreleased body
    for (let i = 0; i < 20 * 30; i++) sim.tick();
    expect(e.dead).toBe(true);
    expect(e.ghost).toBeFalsy();
    // and the corpse shows NO respawn countdown (the wave readout is a ghost's)
    expect(sim.bgInfoFor(victim)!.match!.respawnIn).toBe(0);
    // the deliberate press releases into the plot...
    sim.releaseSpirit(victim);
    expect(e.ghost).toBe(true);
    expect(inGraveyard(sim, match, victim, 0)).toBe(true);
    // ...where the wave countdown NOW shows
    sim.tick();
    expect(sim.bgInfoFor(victim)!.match!.respawnIn).toBeGreaterThan(0);
    // the ward: teleport the spirit outside the plot and the next tick pulls
    // it back inside (a spirit cannot scout or leave before its wave)
    tp(sim, victim, 0, -40);
    sim.tick();
    expect(inGraveyard(sim, match, victim, 0)).toBe(true);
  });

  it('the wave raises only released spirits: an unreleased corpse waits for a later wave', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const a = match.teams[0][0];
    const b = match.teams[0][1];
    // die just before a wave, release only a: the wave raises the released
    // spirit and leaves the corpse untouched
    while (BG_WAVE_PERIOD - (match.timer % BG_WAVE_PERIOD) > 3) sim.tick();
    kill(sim, a);
    kill(sim, b);
    sim.tick();
    sim.releaseSpirit(a); // a releases immediately; b lies on its corpse
    const target = Math.ceil(match.timer / BG_WAVE_PERIOD) * BG_WAVE_PERIOD + 0.3;
    while (match.timer < target) sim.tick();
    expect(sim.entities.get(a)!.dead).toBe(false); // the released spirit rose
    expect(sim.entities.get(b)!.dead).toBe(true); // the corpse waited
    // b releases LATE and the following wave raises it too
    sim.releaseSpirit(b);
    while (sim.entities.get(b)!.dead && match.timer < 60) sim.tick();
    expect(sim.entities.get(b)!.dead).toBe(false);
    expect(inGraveyard(sim, match, b, 0)).toBe(true);
  });

  it('corpse and Spirit Healer resurrection are refused inside a match (wave-only)', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const victim = match.teams[0][0];
    kill(sim, victim);
    sim.tick();
    sim.releaseSpirit(victim);
    const e = sim.entities.get(victim)!;
    expect(e.ghost).toBe(true);
    // teleport the ghost onto its own corpse: the corpse rez still refuses
    if (e.corpsePos) tp(sim, victim, e.corpsePos.x, e.corpsePos.z);
    sim.resurrectAtCorpse(victim);
    expect(e.dead).toBe(true);
    expect(sim.resurrectAtSpiritHealer(victim)).toBe(false);
  });
});

describe('Thornhollow Fields: ghost-state teardown (review pins)', () => {
  it('a match ending while a spirit waits clears ghost and corpse state on the way home', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const victim = match.teams[1][0];
    kill(sim, victim);
    sim.tick();
    sim.releaseSpirit(victim);
    const e = sim.entities.get(victim)!;
    expect(e.ghost).toBe(true);
    updateBattleground(sim.ctx); // seat the release fully
    endBgMatch(sim.ctx, match, 0, 'caps');
    expect(e.dead).toBe(false);
    expect(e.ghost).toBe(false);
    expect(e.corpsePos).toBeNull();
    expect(isBgPos(e.pos.x)).toBe(false); // sent home, not stranded in the band
  });

  it('deserting while a spirit restores the body and sends it home', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const leaver = match.teams[1][0];
    kill(sim, leaver);
    sim.tick();
    sim.releaseSpirit(leaver);
    const e = sim.entities.get(leaver)!;
    expect(e.ghost).toBe(true);
    sim.bgResolveDesertion(leaver);
    expect(e.dead).toBe(false);
    expect(e.ghost).toBe(false);
    expect(e.corpsePos).toBeNull();
    expect(isBgPos(e.pos.x)).toBe(false);
  });

  it('a player-cast resurrection offer is refused in-match (the wave is the one way back)', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const caster = sim.entities.get(match.teams[0][0])!;
    const fallen = match.teams[0][1];
    kill(sim, fallen);
    sim.tick();
    const target = sim.entities.get(fallen)!;
    expect(offerResurrection(sim.ctx, caster, target, 1)).toBe(false);
    expect(sim.ctx.pendingResurrections.has(fallen)).toBe(false);
    expect(target.dead).toBe(true);
  });
});

describe('Thornhollow Fields: deliberate pickup + automatic return', () => {
  it('walking over a flag never picks it up; the deliberate press does', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    expect(match.state).toBe('active');
    const raider = match.teams[0][0];
    const azure = match.flags[1];
    tp(sim, raider, azure.pos.x, azure.pos.z);
    for (let i = 0; i < 10; i++) sim.tick();
    expect(match.flags[1].state).toBe('home'); // strafing through does nothing
    sim.bgFlagAction(raider);
    sim.tick();
    expect(match.flags[1].state).toBe('carried');
    expect(match.flags[1].carrier).toBe(raider);
  });

  it('the flag action errors politely with no flag in reach and never grabs the OWN flag', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const crimson = match.teams[0][0];
    // own flag: pressing on it does nothing (only a dropped own flag returns, by proximity)
    tp(sim, crimson, match.flags[0].home.x, match.flags[0].home.z);
    sim.bgFlagAction(crimson);
    sim.tick();
    expect(match.flags[0].state).toBe('home');
    expect(match.flags[1].state).toBe('home');
  });

  it('grab, run it home, score; first to BG_CAPS_TO_WIN captures wins and cleans up', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const carrier = match.teams[0][0];
    const returnPos = match.returns.get(carrier)!;

    let ended = false;
    for (let cap = 0; cap < BG_CAPS_TO_WIN; cap++) {
      captureOnce(sim, match, carrier);
      expect(match.scores[0]).toBe(cap + 1);
      // captured flag resets home, except on the winning capture
      if (cap < BG_CAPS_TO_WIN - 1) expect(match.flags[1].state).toBe('home');
    }
    // The WINNING capture freezes the match on the result screen first; the
    // release home comes only after the BG_END_HOLD lapses.
    expect(match.state).toBe('ended');
    expect(sim.bgMatchFor(carrier)).toBe(match);
    for (let i = 0; i < 20 * (BG_END_HOLD + 1); i++) sim.tick();
    ended = sim.bgMatchFor(carrier) === null;
    expect(ended).toBe(true);
    expect(match.scores[0]).toBe(BG_CAPS_TO_WIN);
    // restored to the overworld exactly where they queued
    const e = sim.entities.get(carrier)!;
    expect(isBgPos(e.pos.x)).toBe(false);
    expect(e.pos.x).toBeCloseTo(returnPos.x, 3);
    expect(e.pos.z).toBeCloseTo(returnPos.z, 3);
    // meta recorded the result + captures
    expect(sim.meta(carrier)!.bgWins).toBe(1);
    expect(sim.meta(carrier)!.bgCaptures).toBe(BG_CAPS_TO_WIN);
    expect(sim.meta(match.teams[1][0])!.bgLosses).toBe(1);
  });

  it('a dropped flag auto-returns home after 20 seconds untouched', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const enemy = match.teams[1][0];
    tp(sim, enemy, match.flags[0].home.x, match.flags[0].home.z);
    sim.bgFlagAction(enemy);
    sim.tick();
    // carry it away from everyone, then die
    tp(sim, enemy, match.flags[0].home.x + 10, match.flags[0].home.z + 20);
    sim.tick();
    kill(sim, enemy);
    sim.tick();
    expect(match.flags[0].state).toBe('dropped');
    // Decisive two-sided pin on the 20s timer: still dropped at 19s, home
    // once the clock passes 20s.
    for (let i = 0; i < 20 * 19; i++) sim.tick();
    expect(match.flags[0].state).toBe('dropped');
    for (let i = 0; i < 20 * 2; i++) sim.tick();
    expect(match.flags[0].state).toBe('home');
  });

  it('the flag OWN team returns a dropped flag by proximity, instantly', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const enemy = match.teams[1][0];
    tp(sim, enemy, match.flags[0].home.x, match.flags[0].home.z);
    sim.bgFlagAction(enemy);
    sim.tick();
    tp(sim, enemy, match.flags[0].home.x + 12, match.flags[0].home.z + 25);
    sim.tick();
    kill(sim, enemy);
    sim.tick();
    expect(match.flags[0].state).toBe('dropped');
    const defender = match.teams[0][1];
    tp(sim, defender, match.flags[0].pos.x, match.flags[0].pos.z);
    sim.tick();
    expect(match.flags[0].state).toBe('home'); // walk-over return, no press needed
  });

  it('same-tick race: an automatic return beats a pickup press', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const thief = match.teams[1][0];
    tp(sim, thief, match.flags[0].home.x, match.flags[0].home.z);
    sim.bgFlagAction(thief);
    sim.tick();
    tp(sim, thief, match.flags[0].home.x + 12, match.flags[0].home.z + 25);
    sim.tick();
    kill(sim, thief);
    sim.tick();
    expect(match.flags[0].state).toBe('dropped');
    const dropX = match.flags[0].pos.x;
    const dropZ = match.flags[0].pos.z;
    // a defender stands on it AND an enemy presses in the same tick
    const defender = match.teams[0][1];
    const secondThief = match.teams[1][1];
    tp(sim, defender, dropX, dropZ);
    tp(sim, secondThief, dropX, dropZ);
    sim.bgFlagAction(secondThief);
    sim.tick();
    expect(match.flags[0].state).toBe('home'); // the return won the race
    expect(match.flags[0].carrier).toBe(null);
  });

  it('flags and invisibility never mix: a grab reveals, going hidden drops', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const runner = match.teams[0][0];
    const e = sim.entities.get(runner)!;
    const hide = () =>
      sim.ctx.applyAura(e, {
        id: 'stealth',
        name: 'Stealth',
        kind: 'stealth',
        value: 0.5,
        remaining: 3600,
        duration: 3600,
        sourceId: e.id,
        school: 'physical',
      });
    // a stealthed runner CAN press the grab, but the grab is a revealing act:
    // the stealth aura is stripped in the same tick the carry starts
    hide();
    expect(e.stealthed).toBe(true);
    tp(sim, runner, match.flags[1].home.x, match.flags[1].home.z);
    sim.bgFlagAction(runner);
    sim.tick();
    expect(match.flags[1].carrier).toBe(runner);
    expect(e.stealthed).toBe(false);
    expect(e.auras.some((a) => a.kind === 'stealth')).toBe(false);
    // going hidden WHILE carrying (stealth, vanish, invisibility: every source
    // rides the stealth aura kind) drops the flag at the carrier's feet; the
    // runner stays hidden but flagless, so the enemy team never chases an
    // entity their snapshots cannot see
    hide();
    expect(e.stealthed).toBe(true);
    sim.tick();
    expect(match.flags[1].state).toBe('dropped');
    expect(match.flags[1].carrier).toBe(null);
    expect(e.stealthed).toBe(true); // the hide itself survives; the flag does not
    expect(match.flags[1].pos.x).toBeCloseTo(e.pos.x, 3);
    expect(match.flags[1].pos.z).toBeCloseTo(e.pos.z, 3);
    // and the dropped flag then behaves like any drop: an enemy re-press takes it
    const azure = match.teams[1].find((pid) => pid !== runner)!;
    tp(sim, azure, match.flags[1].pos.x, match.flags[1].pos.z);
    sim.bgFlagAction(azure);
    sim.tick();
    expect(match.flags[1].state).toBe('home'); // own team: proximity return wins
  });

  it('a grab out of Greater Invisibility still pays the aftereffect the vanish owes', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    // The mage vanish, shaped exactly as effect_dispatch applies it: the
    // configured damage cut rides in value2 and its duration in value3, so
    // every normal removal path can pay the same aftereffect.
    const vanish = (pid: number) =>
      sim.ctx.applyAura(sim.entities.get(pid)!, {
        id: 'greater_invisibility',
        name: 'Greater Invisibility',
        kind: 'stealth',
        value: 1,
        value2: 0.9,
        value3: 2,
        remaining: 20,
        duration: 20,
        sourceId: sim.entities.get(pid)!.id,
        school: 'arcane',
      });
    const runner = match.teams[0][0];
    const e = sim.entities.get(runner)!;
    vanish(runner);
    tp(sim, runner, match.flags[1].home.x, match.flags[1].home.z);
    sim.bgFlagAction(runner);
    sim.tick();
    expect(match.flags[1].carrier, 'the grab must land').toBe(runner);
    expect(e.stealthed).toBe(false);
    expect(e.auras.some((a) => a.kind === 'stealth')).toBe(false);
    const after = e.auras.find((a) => a.id === GREATER_INVISIBILITY_DR_AURA_ID);
    expect(after, 'a flag grab must not be the one path that eats the aftereffect').toBeTruthy();
    // ...and it is the SAME grant breaking the same vanish any other way makes
    // (the shared path an attack out of hiding takes), never a bespoke one.
    const other = match.teams[0][1];
    const oe = sim.entities.get(other)!;
    vanish(other);
    sim.ctx.breakStealth(oe);
    const reference = oe.auras.find((a) => a.id === GREATER_INVISIBILITY_DR_AURA_ID)!;
    expect(reference, 'the shared break is the reference grant').toBeTruthy();
    expect({ kind: after!.kind, value: after!.value, duration: after!.duration }).toEqual({
      kind: reference.kind,
      value: reference.value,
      duration: reference.duration,
    });
    expect(reference.value, 'the configured cut, pinned').toBe(0.9);
    expect(reference.duration).toBe(2);
  });
});

describe('Thornhollow Fields: death, release, and the team wave respawn', () => {
  it('carrier death drops the flag in place and releasing does nothing', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const carrier = match.teams[0][0];
    tp(sim, carrier, match.flags[1].home.x, match.flags[1].home.z);
    sim.bgFlagAction(carrier);
    sim.tick();
    expect(match.flags[1].carrier).toBe(carrier);
    kill(sim, carrier);
    sim.tick();
    const e = sim.entities.get(carrier)!;
    expect(e.dead).toBe(true);
    expect(match.flags[1].state).toBe('dropped');
    // The classic rite: releasing rises the spirit in the CRIMSON keep
    // graveyard plot; the dropped flag stays where it fell.
    sim.releaseSpirit(carrier);
    expect(e.dead).toBe(true);
    expect(e.ghost).toBe(true);
    expect(inGraveyard(sim, match, carrier, 0)).toBe(true);
    expect(match.flags[1].state).toBe('dropped');
  });

  it('wave respawn: 10s period, the two team clocks offset by 5s, whole wave together', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    expect(match.waveIn[0]).toBeCloseTo(BG_WAVE_PERIOD, 1);
    expect(match.waveIn[1]).toBeCloseTo(BG_WAVE_OFFSET, 1);
    // kill one member of each team plus a second Crimson a moment later
    const c1 = match.teams[0][0];
    const c2 = match.teams[0][1];
    const a1 = match.teams[1][0];
    kill(sim, c1);
    kill(sim, a1);
    sim.tick();
    sim.releaseSpirit(c1); // the wave raises released spirits (release first)
    sim.releaseSpirit(a1);
    for (let i = 0; i < 20; i++) sim.tick(); // 1s later
    kill(sim, c2);
    sim.tick();
    sim.releaseSpirit(c2);
    // Azure's first wave fires at 5s: a1 back up, both Crimson still down
    while (match.waveIn[1] < BG_WAVE_PERIOD - 0.5 || sim.entities.get(a1)!.dead) {
      sim.tick();
      if (match.timer > 6) break;
    }
    expect(sim.entities.get(a1)!.dead).toBe(false);
    expect(sim.entities.get(c1)!.dead).toBe(true);
    expect(sim.entities.get(c2)!.dead).toBe(true);
    // Crimson's wave fires at 10s: BOTH fallen Crimson respawn together
    while (sim.entities.get(c1)!.dead && match.timer < 11) sim.tick();
    expect(sim.entities.get(c1)!.dead).toBe(false);
    expect(sim.entities.get(c2)!.dead).toBe(false); // died later, joined the same wave
    // risen inside the keep graveyard plot (in place), not where they fell
    expect(isBgPos(sim.entities.get(c1)!.pos.x)).toBe(true);
    expect(inGraveyard(sim, match, c1, 0)).toBe(true);
    expect(inGraveyard(sim, match, c2, 0)).toBe(true);
  });

  it('a death just after a wave waits for the NEXT wave (never respawns instantly)', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const victim = match.teams[0][0];
    // wait for Crimson's first wave to fire, then die immediately after
    while (match.timer < BG_WAVE_PERIOD + 0.2) sim.tick();
    kill(sim, victim);
    sim.tick();
    sim.releaseSpirit(victim);
    expect(sim.entities.get(victim)!.dead).toBe(true);
    // still dead 8s later; alive after the full next tick at 20s
    while (match.timer < BG_WAVE_PERIOD + 8) sim.tick();
    expect(sim.entities.get(victim)!.dead).toBe(true);
    while (match.timer < BG_WAVE_PERIOD * 2 + 0.5) sim.tick();
    expect(sim.entities.get(victim)!.dead).toBe(false);
  });
});

describe('Thornhollow Fields: the classic capture gate', () => {
  it('a capture only resolves while your OWN flag is home, and fires the moment it returns', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const raider = match.teams[0][0]; // Crimson, carrying the Azure flag
    const thief = match.teams[1][0]; // Azure, stealing the Crimson flag
    tp(sim, thief, match.flags[0].home.x, match.flags[0].home.z);
    sim.bgFlagAction(thief);
    sim.tick();
    expect(match.flags[0].state).toBe('carried'); // Crimson's flag is OUT
    tp(sim, raider, match.flags[1].pos.x, match.flags[1].pos.z);
    sim.bgFlagAction(raider);
    sim.tick();
    expect(match.flags[1].state).toBe('carried');
    // at the stand with the enemy flag, but the own flag is stolen: NO capture
    tp(sim, raider, match.flags[0].home.x, match.flags[0].home.z);
    for (let i = 0; i < 20; i++) sim.tick();
    expect(match.scores[0]).toBe(0);
    expect(match.flags[1].state).toBe('carried'); // still waiting at the stand
    // the thief dies, a defender walk-over returns the Crimson flag home:
    // the waiting carrier captures AUTOMATICALLY on the next tick
    kill(sim, thief);
    sim.tick();
    const defender = match.teams[0][1];
    tp(sim, defender, match.flags[0].pos.x, match.flags[0].pos.z);
    sim.tick();
    expect(match.flags[0].state).toBe('home');
    sim.tick();
    expect(match.scores[0]).toBe(1); // the gated capture resolved itself
    expect(match.flags[1].state).toBe('home');
  });
});

describe('Thornhollow Fields: carrier vulnerability (Focused Assault lineage)', () => {
  it('stacks after the fatigue delay (75s), one more every 15s, and amplifies damage taken', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const carrier = match.teams[0][0];
    const attacker = match.teams[1][0];
    tp(sim, carrier, match.flags[1].home.x, match.flags[1].home.z);
    sim.bgFlagAction(carrier);
    sim.tick();
    tp(sim, carrier, match.flags[1].home.x + 6, match.flags[1].home.z - 8); // off the stand
    const e = sim.entities.get(carrier)!;
    expect(e.auras.some((a) => a.id === 'bg_carrier_vulnerability')).toBe(false);
    // fast-forward the hold clock to just before the threshold
    match.flags[1].carrySeconds = BG_CARRIER_VULN_DELAY - 0.2;
    for (let i = 0; i < 8; i++) sim.tick();
    let vuln = e.auras.find((a) => a.id === 'bg_carrier_vulnerability');
    expect(vuln).toBeTruthy();
    expect(vuln!.stacks).toBe(1);
    // one more interval, one more stack (uncapped)
    match.flags[1].carrySeconds += BG_CARRIER_VULN_INTERVAL;
    sim.tick();
    vuln = e.auras.find((a) => a.id === 'bg_carrier_vulnerability');
    expect(vuln!.stacks).toBe(2);
    expect(vuln!.value).toBeCloseTo(0.2, 5);
    // decisive damage check: two stacks take 20% more than clean (sub-lethal
    // amounts, or the overkill clamp equalizes both hits)
    const atk = sim.entities.get(attacker)!;
    e.hp = e.maxHp;
    sim.ctx.dealDamage(
      atk,
      e,
      40,
      false,
      'shadow',
      null,
      'hit',
      false,
      undefined,
      true,
      false,
      true,
    );
    const withVuln = e.maxHp - e.hp;
    expect(withVuln).toBeGreaterThan(0);
    expect(e.dead).toBe(false);
    // drop the flag (death), stacks clear, same hit lands clean
    kill(sim, carrier);
    sim.tick();
    expect(e.auras.some((a) => a.id === 'bg_carrier_vulnerability')).toBe(false);
    e.dead = false;
    e.hp = e.maxHp;
    sim.ctx.dealDamage(
      atk,
      e,
      40,
      false,
      'shadow',
      null,
      'hit',
      false,
      undefined,
      true,
      false,
      true,
    );
    const clean = e.maxHp - e.hp;
    expect(withVuln / clean).toBeCloseTo(1.2, 1);
  });

  it('clears on capture and on return', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const carrier = match.teams[0][0];
    tp(sim, carrier, match.flags[1].home.x, match.flags[1].home.z);
    sim.bgFlagAction(carrier);
    sim.tick();
    match.flags[1].carrySeconds = BG_CARRIER_VULN_DELAY + 1;
    sim.tick();
    const e = sim.entities.get(carrier)!;
    expect(e.auras.some((a) => a.id === 'bg_carrier_vulnerability')).toBe(true);
    // capture clears the stacks
    tp(sim, carrier, match.flags[0].home.x, match.flags[0].home.z);
    sim.tick();
    expect(match.scores[0]).toBe(1);
    expect(e.auras.some((a) => a.id === 'bg_carrier_vulnerability')).toBe(false);
  });
});

describe('Thornhollow Fields: the carried-flag buff and the voluntary drop', () => {
  // Seat a match, take the azure flag with the deliberate press, and hand back
  // everything an arm needs. The carrier is on team 0, so flags[1] (azure) is the
  // enemy flag they run and flags[0] (crimson) is their own stand.
  function carryingMatch() {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const carrier = match.teams[0][0];
    tp(sim, carrier, match.flags[1].home.x, match.flags[1].home.z);
    sim.bgFlagAction(carrier);
    sim.tick();
    // Off the stand, so nothing in an arm resolves as an incidental capture.
    tp(sim, carrier, match.flags[1].home.x + 6, match.flags[1].home.z - 8);
    return { sim, match, carrier, e: sim.entities.get(carrier)!, flag: match.flags[1] };
  }

  const hasFlagAura = (sim: Sim, pid: number) =>
    sim.entities.get(pid)!.auras.some((a) => a.id === CARRIED_FLAG_AURA_ID);

  it('is worn from the FIRST tick of the carry, not after the fatigue delay', () => {
    const { sim, carrier, e, flag } = carryingMatch();
    expect(flag.carrier).toBe(carrier);
    expect(hasFlagAura(sim, carrier)).toBe(true);
    // The point of the pair: fatigue is still 75s away, the carry buff is not.
    expect(e.auras.some((a) => a.id === 'bg_carrier_vulnerability')).toBe(false);
    const aura = e.auras.find((a) => a.id === CARRIED_FLAG_AURA_ID)!;
    expect(aura.name).toBe('Carrying the Flag');
    expect(aura.kind).toBe('flag_carried');
    // Longer than any match, so natural expiry can never take it mid-carry.
    expect(aura.remaining).toBe(BG_MAX_DURATION);
  });

  it('nobody else in the match wears it', () => {
    const { sim, match, carrier } = carryingMatch();
    for (const pid of [...match.teams[0], ...match.teams[1]]) {
      if (pid === carrier) continue;
      expect(hasFlagAura(sim, pid), `pid ${pid}`).toBe(false);
    }
  });

  // Every path the flag can leave the carrier by, each asserting the SAME
  // coupling: the buff is gone and the carry is over, together.
  it('leaves on a CAPTURE, together with the flag', () => {
    const { sim, match, carrier, flag } = carryingMatch();
    tp(sim, carrier, match.flags[0].home.x, match.flags[0].home.z);
    sim.tick();
    expect(match.scores[0]).toBe(1);
    expect(flag.state).toBe('home');
    expect(hasFlagAura(sim, carrier)).toBe(false);
  });

  it('leaves on DEATH, in the same call that drops the flag', () => {
    const { sim, carrier, flag } = carryingMatch();
    // handleDeath strips auras (aurasSurvivingDeath) BEFORE it calls the
    // battleground death hook, so this arm is what proves the two halves land
    // together rather than the aura outliving the carry by a tick.
    kill(sim, carrier);
    expect(flag.state).toBe('dropped');
    expect(flag.carrier).toBeNull();
    expect(hasFlagAura(sim, carrier)).toBe(false);
  });

  it('leaves on the STEALTH drop, together with the flag', () => {
    const { sim, carrier, e, flag } = carryingMatch();
    e.auras.push({
      id: 'stealth',
      name: 'Stealth',
      kind: 'stealth',
      value: 0,
      remaining: 60,
      duration: 60,
      sourceId: e.id,
      school: 'physical',
    });
    e.stealthed = true;
    sim.tick();
    expect(flag.state).toBe('dropped');
    expect(hasFlagAura(sim, carrier)).toBe(false);
  });

  it('leaves on DESERTION, together with the flag', () => {
    const { sim, carrier, flag } = carryingMatch();
    bgResolveDesertion(sim.ctx, carrier);
    expect(flag.state).toBe('dropped');
    expect(hasFlagAura(sim, carrier)).toBe(false);
  });

  it('leaves when the played-out match ENDS and the flags come home', () => {
    const { sim, carrier, flag } = carryingMatch();
    expect(devEndBg(sim.ctx, carrier)).toBe(true);
    expect(flag.state).toBe('home');
    expect(hasFlagAura(sim, carrier)).toBe(false);
  });

  it('leaves on the forfeit TEARDOWN, which never routes through returnFlag', () => {
    const { sim, match, carrier } = carryingMatch();
    // endBgMatch resolves and releases in one call: the flag entity is destroyed
    // rather than returned, so the teardown arm of clearCarrierAuras is the only
    // thing standing between a forfeited carrier and a permanent buff.
    endBgMatch(sim.ctx, match, 0, 'forfeit');
    expect(hasFlagAura(sim, carrier)).toBe(false);
  });

  it('no enemy dispel can take it (that would strip the buff and keep the flag)', () => {
    const { sim, carrier, e } = carryingMatch();
    const aura = e.auras.find((a) => a.id === CARRIED_FLAG_AURA_ID)!;
    // The physical school is what refuses it: an offensive dispel strips helpful
    // MAGIC only, so the one removal path a player could aim at it is the cancel.
    expect(isDispellableAura(aura, true)).toBe(false);
    expect(isDispellableAura(aura, false)).toBe(false);
    expect(hasFlagAura(sim, carrier)).toBe(true);
  });

  describe('right-clicking the buff drops the flag', () => {
    it('drops it at the carrier feet, catchable, on the existing dropped call', () => {
      const { sim, match, carrier, e, flag } = carryingMatch();
      const feet = { x: e.pos.x, y: e.pos.y, z: e.pos.z };
      sim.cancelAura(CARRIED_FLAG_AURA_ID, carrier);

      expect(flag.state).toBe('dropped');
      expect(flag.carrier).toBeNull();
      expect(flag.pos.x).toBeCloseTo(feet.x, 6);
      expect(flag.pos.z).toBeCloseTo(feet.z, 6);
      // Armed for the same 20s auto-return every other drop gets.
      expect(flag.dropTimer).toBe(20);
      expect(hasFlagAura(sim, carrier)).toBe(false);
      expect(bgCarryingFlag(sim.ctx, carrier)).toBe(false);
      // The ground entity followed it, so it is a real object on the field.
      const body = sim.entities.get(flag.entityId)!;
      expect(body.pos.x).toBeCloseTo(feet.x, 6);
      // ...and the state machine took no new cause: it is the ordinary drop.
      const events = sim.tick().filter((ev) => ev.type === 'bgFlag');
      expect(events.every((ev) => ev.action !== 'taken')).toBe(true);
      expect(match.scores).toEqual([0, 0]);
    });

    it('emits the ordinary dropped call to all ten', () => {
      const { sim, match, carrier } = carryingMatch();
      // Drain the pickup batch first so only the cancel's events are read.
      sim.tick();
      sim.cancelAura(CARRIED_FLAG_AURA_ID, carrier);
      const dropped = sim
        .tick()
        .filter((ev): ev is Extract<SimEvent, { type: 'bgFlag' }> => ev.type === 'bgFlag');
      expect(dropped.length).toBe(10);
      for (const ev of dropped) {
        expect(ev.action).toBe('dropped');
        expect(ev.team).toBe(1); // the azure flag's home team
      }
      expect(new Set(dropped.map((ev) => ev.pid)).size).toBe(10);
      expect(match.scores).toEqual([0, 0]);
    });

    it('the dropped flag is re-takeable by the enemy team', () => {
      const { sim, match, carrier, flag } = carryingMatch();
      sim.cancelAura(CARRIED_FLAG_AURA_ID, carrier);
      const mate = match.teams[0][1];
      tp(sim, mate, flag.pos.x, flag.pos.z);
      sim.bgFlagAction(mate);
      sim.tick();
      expect(flag.carrier).toBe(mate);
      expect(hasFlagAura(sim, mate)).toBe(true);
      expect(hasFlagAura(sim, carrier)).toBe(false);
    });

    it('the dropped flag is returnable by its own team walking over it', () => {
      const { sim, match, carrier, flag } = carryingMatch();
      sim.cancelAura(CARRIED_FLAG_AURA_ID, carrier);
      const owner = match.teams[1][0];
      tp(sim, owner, flag.pos.x, flag.pos.z);
      sim.tick();
      expect(flag.state).toBe('home');
      expect(hasFlagAura(sim, carrier)).toBe(false);
    });

    it('a NON-carrier cancelling the id is a no-op: the carry is untouched', () => {
      const { sim, match, carrier, flag } = carryingMatch();
      const bystander = match.teams[0][1];
      sim.cancelAura(CARRIED_FLAG_AURA_ID, bystander);
      expect(flag.state).toBe('carried');
      expect(flag.carrier).toBe(carrier);
      expect(hasFlagAura(sim, carrier)).toBe(true);
    });

    it('cancelling it outside a match is a no-op', () => {
      const { sim, match, carrier, flag } = carryingMatch();
      // Same runner, after the match is torn down: nothing to drop, nothing to throw.
      endBgMatch(sim.ctx, match, 0, 'forfeit');
      expect(bgCarryingFlag(sim.ctx, carrier)).toBe(false);
      expect(() => sim.cancelAura(CARRIED_FLAG_AURA_ID, carrier)).not.toThrow();
      expect(hasFlagAura(sim, carrier)).toBe(false);
      // The torn-down match object is discarded, so its flag body is gone from
      // the world rather than re-dropped by the stray cancel.
      expect(sim.entities.has(flag.entityId)).toBe(false);
    });

    it('a STALE aura with no flag to drop is spliced normally, never left stuck', () => {
      // The interception swallows the cancel ONLY on the arm that actually drops.
      // If the buff is somehow worn with no carry behind it (an inconsistency this
      // module's lifetime rules say cannot happen), splicing is exactly right:
      // swallowing there would turn a self-healing inconsistency into a buff the
      // player can never take off. No match, so nothing to drop.
      const sim = makeWorld();
      const pid = sim.addPlayer('warrior', 'Stranded');
      const e = sim.entities.get(pid)!;
      expect(sim.bgMatchFor(pid)).toBeNull();
      e.auras.push({
        id: CARRIED_FLAG_AURA_ID,
        name: 'Carrying the Flag',
        kind: 'flag_carried',
        value: 0,
        remaining: BG_MAX_DURATION,
        duration: BG_MAX_DURATION,
        sourceId: e.id,
        school: 'physical',
      });

      sim.cancelAura(CARRIED_FLAG_AURA_ID, pid);

      expect(e.auras.some((a) => a.id === CARRIED_FLAG_AURA_ID)).toBe(false);
      // ...and no drop happened, because there was no flag: no bgFlag event at all.
      expect(sim.tick().some((ev) => ev.type === 'bgFlag')).toBe(false);
    });

    it('a stale aura on a player whose match is no longer ACTIVE is also spliced', () => {
      // The other non-dropping arm: seated in a match that has ended. Same rule.
      const { sim, match, carrier, e } = carryingMatch();
      match.state = 'ended';
      expect(e.auras.some((a) => a.id === CARRIED_FLAG_AURA_ID)).toBe(true);
      sim.cancelAura(CARRIED_FLAG_AURA_ID, carrier);
      expect(e.auras.some((a) => a.id === CARRIED_FLAG_AURA_ID)).toBe(false);
    });

    it('the cancel never falls through to a raw splice that keeps the flag', () => {
      // The regression this whole interception exists for: if Sim.cancelAura had
      // reached removeCancelableAura, the buff would be gone (it is helpful and
      // player-removable) while flag.carrier stayed set. Assert the pair, not the
      // aura alone.
      const { sim, carrier, flag } = carryingMatch();
      sim.cancelAura(CARRIED_FLAG_AURA_ID, carrier);
      expect(hasFlagAura(sim, carrier)).toBe(false);
      expect(flag.carrier).toBeNull();
      expect(flag.state).toBe('dropped');
    });
  });
});

describe('Thornhollow Fields: runes, hostility, and the match clock', () => {
  it('pins the whole live tune as literals (re-pin deliberately when retuning)', () => {
    // The behavior suites use these constants symbolically, so THIS block is
    // what actually fails on a silent retune: every tuned number ships pinned.
    expect(BG_CARRIER_VULN_DELAY).toBe(75); // ~two 236yd flag runs
    expect(BG_CARRIER_VULN_INTERVAL).toBe(15);
    expect(BG_MAX_DURATION).toBe(720); // 12 minute cap, scaled with the field
    // Retuned from the launch value of 5 to the classic first-to-3 convention:
    // at 5, a dominating side still needed about 8 minutes, so the CLOCK rather
    // than the winning capture decided most matches.
    expect(BG_CAPS_TO_WIN).toBe(3);
    expect(BG_TIME_WARNINGS).toEqual([120, 60]);
    expect(BG_WAVE_PERIOD).toBe(10);
    expect(BG_WAVE_OFFSET).toBe(5);
    expect(BG_POWER_RUNE_VALUE).toBeCloseTo(0.15, 10);
    expect(BATTLEGROUND_WIN_HONOR).toBe(60);
    expect(BATTLEGROUND_LOSS_HONOR).toBe(20);
    // the one deliberate zero-sum exception: the loser-side rating floor
    expect(BG_MIN_RATING).toBe(100);
  });

  it('the rating floor holds a loss at BG_MIN_RATING while the winner keeps the full delta', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const winner = match.teams[0][0];
    const loser = match.teams[1][0];
    sim.meta(loser)!.bgRating = BG_MIN_RATING + 1; // one point above the floor
    for (let cap = 0; cap < BG_CAPS_TO_WIN; cap++) captureOnce(sim, match, winner);
    expect(sim.meta(loser)!.bgRating).toBe(BG_MIN_RATING); // clamped, not negative
    expect(sim.meta(winner)!.bgRating).toBeGreaterThan(1500); // winner unaffected
  });

  it('stepping on a sprint rune grants 1.4x haste for 10s and the rune recharges over 30s', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const runner = match.teams[0][0];
    const rune = match.runes[0];
    expect(rune.active).toBe(true);
    tp(sim, runner, rune.pos.x, rune.pos.z);
    sim.tick();
    const e = sim.entities.get(runner)!;
    const sprint = e.auras.find((a) => a.id === 'bg_sprint_rune');
    expect(sprint).toBeTruthy();
    expect(sprint!.value).toBeCloseTo(1.4, 5);
    expect(sprint!.duration).toBeCloseTo(10, 5);
    expect(rune.active).toBe(false); // consumed, now recharging
    tp(sim, runner, rune.pos.x + 20, rune.pos.z); // step away
    rune.cooldown = 0.1; // fast-forward the 30s recharge
    sim.tick();
    sim.tick();
    expect(match.runes[0].active).toBe(true);
    expect(match.runes[0].cooldown).toBeLessThanOrEqual(0);
  });

  it('enemies are hostile, teammates are not (and cannot be healed cross-team)', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const a = sim.entities.get(match.teams[0][0])!;
    const mate = sim.entities.get(match.teams[0][1])!;
    const foe = sim.entities.get(match.teams[1][0])!;
    expect(sim.isHostileTo(a, foe)).toBe(true);
    expect(sim.isHostileTo(a, mate)).toBe(false);
    expect(sim.isHostileTo(foe, a)).toBe(true);
  });

  it('an equal score at the 720s cap is a draw: Elo moves by the 0.5 draw math, no W/L', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    // skew the team averages so the draw math must move points
    for (const pid of match.teams[0]) sim.meta(pid)!.bgRating = 1600;
    for (const pid of match.teams[1]) sim.meta(pid)!.bgRating = 1400;
    match.ratingAvg = [1600, 1400];
    toActive(sim, match);
    captureOnce(sim, match, match.teams[0][0]);
    // give Azure an equalizer via the mirror path
    const azureRunner = match.teams[1][0];
    tp(sim, azureRunner, match.flags[0].pos.x, match.flags[0].pos.z);
    sim.bgFlagAction(azureRunner);
    sim.tick();
    tp(sim, azureRunner, match.flags[1].home.x, match.flags[1].home.z);
    sim.tick();
    expect(match.scores).toEqual([1, 1]);
    match.timer = BG_MAX_DURATION - 0.1;
    for (let i = 0; i < 5; i++) sim.tick();
    expect(match.state).toBe('ended'); // the cap freezes the result screen first
    for (let i = 0; i < 20 * (BG_END_HOLD + 1); i++) sim.tick();
    expect(sim.bgMatchFor(pids[0])).toBe(null);
    const expected = eloDelta(1600, 1400, 0.5); // negative: the favorite dropped a draw
    expect(expected).toBeLessThan(0);
    for (const pid of match.teams[0]) {
      expect(sim.meta(pid)!.bgRating).toBe(1600 + expected);
      expect(sim.meta(pid)!.bgWins).toBe(0);
      expect(sim.meta(pid)!.bgLosses).toBe(0);
    }
    for (const pid of match.teams[1]) expect(sim.meta(pid)!.bgRating).toBe(1400 - expected);
  });

  it('pins the decisive Elo delta to a literal (jgyy review: catches uniform scaling)', () => {
    // 1600 vs 1400, decisive win for the favorite: the exact arena-formula
    // output, pinned as a NUMBER so a K or curve change cannot pass silently.
    expect(eloDelta(1600, 1400, 1)).toBe(8);
    expect(eloDelta(1400, 1600, 1)).toBe(24); // the underdog's win pays more
  });

  it('team Elo is zero-sum on a decisive result', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const before = [...match.teams[0], ...match.teams[1]].reduce(
      (s, p) => s + sim.meta(p)!.bgRating,
      0,
    );
    const winners = [...match.teams[0]];
    const losers = [...match.teams[1]];
    for (let cap = 0; cap < BG_CAPS_TO_WIN; cap++) captureOnce(sim, match, winners[0]);
    const after = [...winners, ...losers].reduce((s, p) => s + sim.meta(p)!.bgRating, 0);
    expect(after).toBe(before); // zero-sum (no one near the floor)
    expect(sim.meta(winners[0])!.bgRating).toBeGreaterThan(1500);
    expect(sim.meta(losers[0])!.bgRating).toBeLessThan(1500);
  });

  it('a team that fully leaves forfeits: rating moves, no honor is paid', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const winners = [...match.teams[0]];
    const honorBefore = sim.meta(winners[0])!.honor;
    for (const pid of [...match.teams[1]]) sim.removePlayer(pid);
    expect(sim.bgMatchFor(winners[0])).toBe(null);
    expect(sim.meta(winners[0])!.bgRating).toBeGreaterThan(1500);
    expect(sim.meta(winners[0])!.bgWins).toBe(1);
    expect(sim.meta(winners[0])!.honor).toBe(honorBefore); // forfeits pay nothing
  });
});

describe('Thornhollow Fields: review-hardening pins', () => {
  it('the ACTIVE battleground phase draws ZERO rng (the one draw is at match start)', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    // Drive the phase DIRECTLY (not sim.tick, whose other phases draw) across
    // countdown tail, wave respawns, rune claims (sprint AND power, so the
    // face alternation is proven draw-free), and a capture: the observer must
    // count zero draws. (setObserver, not the private field: a field rename
    // must fail this test, never vacuously pass it.)
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    const runner = match.teams[0][0];
    const sprintRune = match.runes[0];
    tp(sim, runner, sprintRune.pos.x, sprintRune.pos.z);
    // a power-rune claim inside the window proves the alternation draws nothing.
    // Derived from the layout, never a bare index: the power pads follow the
    // speed runes in startBgMatch, so reordering that must fail here loudly.
    expect(match.runes).toHaveLength(BG_SPEED_RUNES.length + BG_POWER_RUNES.length);
    const powerRune = match.runes[BG_SPEED_RUNES.length];
    expect(powerRune.type, 'the first power pad, not a sprint rune').not.toBe('sprint');
    const faceBefore = powerRune.type;
    const powerRunner = match.teams[0][2];
    tp(sim, powerRunner, powerRune.pos.x, powerRune.pos.z);
    kill(sim, match.teams[1][1]);
    sim.releaseSpirit(match.teams[1][1]); // the wave raises released spirits only
    const timerBefore = match.timer;

    // 20s covers the worst chain: the 6s auto-release just missing a wave,
    // then the full 10s to the next one (release + ward + revive all inside
    // this phase, still zero draws).
    for (let i = 0; i < 20 * 20; i++) updateBattleground(sim.ctx);
    expect(draws).toBe(0); // zero draws across 20s of battleground
    expect(match.timer).toBeGreaterThan(timerBefore + 10); // and the phase really ran
    expect(sim.entities.get(match.teams[1][1])!.dead).toBe(false); // released + wave-raised
    // ...and both claims the zero-draw pin is about really happened: the two
    // runes were taken (still spent, the 30s recharge outlasts the window) and
    // the power pad flipped its face without asking the rng for one.
    expect(sprintRune.active, 'the sprint rune was claimed').toBe(false);
    expect(powerRune.active, 'the power rune was claimed').toBe(false);
    expect(powerRune.type, 'a claimed power pad flips its face').toBe(
      faceBefore === 'damage' ? 'defense' : 'damage',
    );

    // The remaining-time calls fire far past the 20s window above, so drive the
    // clock to a crossing INSIDE the observer: a phase that emits ten events is
    // exactly the shape that could quietly grow a draw later.
    match.timer = BG_MAX_DURATION - BG_TIME_WARNINGS[0] - DT;
    updateBattleground(sim.ctx);
    expect(match.timeWarningsFired.has(BG_TIME_WARNINGS[0]), 'the call really fired').toBe(true);
    expect(draws, 'the remaining-time call draws nothing either').toBe(0);
  });

  it('a single deserter takes the rating loss and the recorded L; the team fights on', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const leaver = match.teams[1][0];
    const stayer = match.teams[1][1];
    const before = sim.meta(leaver)!.bgRating;
    // the server's pre-save path resolves the desertion while the meta is live
    sim.bgResolveDesertion(leaver);
    expect(sim.meta(leaver)!.bgRating).toBeLessThan(before); // the loss delta landed
    expect(sim.meta(leaver)!.bgLosses).toBe(1);
    const afterFirst = sim.meta(leaver)!.bgRating;
    sim.bgResolveDesertion(leaver); // idempotent: already off the roster
    expect(sim.meta(leaver)!.bgRating).toBe(afterFirst);
    // the match continues a player down; nobody else was scored yet
    expect(sim.bgMatchFor(stayer)).toBe(match);
    expect(sim.bgMatchFor(leaver)).toBe(null);
    expect(match.teams[1]).toHaveLength(4);
    expect(sim.meta(stayer)!.bgLosses).toBe(0);
  });

  it('an over-size group (a raid) is refused with a message, never silently truncated', () => {
    const sim = makeWorld();
    const leader = sim.addPlayer('warrior', 'Leader');
    tp(sim, leader, 0, -40);
    const members = [leader];
    for (let i = 0; i < 5; i++) {
      const m = sim.addPlayer('priest', `Mate${i}`);
      tp(sim, m, 0, -40);
      members.push(m);
    }
    // assemble a six-member group directly on the PartyMachine (raid-size
    // groups exceed the normal invite cap; the offline staging precedent)
    const machine = (
      sim as unknown as {
        party: { parties: Map<number, unknown>; partyByPid: Map<number, number> };
      }
    ).party;
    machine.parties.set(77, { id: 77, leader, members: [...members] });
    for (const m of members) machine.partyByPid.set(m, 77);
    sim.bgQueueJoin(leader); // group of six
    expect(sim.bgInfoFor(leader)!.queued).toBe(false);
    expect(sim.bgInfoFor(leader)!.queueSize).toBe(0);
  });

  it('a queued player who walks into an instance keeps the spot, silently', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'A');
    tp(sim, a, 0, -40);
    sim.entities.get(a)!.level = BG_MIN_LEVEL;
    sim.bgQueueJoin(a);
    sim.tick();
    expect(sim.bgInfoFor(a)!.queued).toBe(true);
    const dungeonInstance = instanceOrigin(0, 0);
    tp(sim, a, dungeonInstance.x, dungeonInstance.z); // a dungeon instance band
    const evs = sim.tick();
    expect(sim.bgInfoFor(a)!.queued).toBe(true);
    // Nothing happened, so nothing is announced: the un-queue notice is now
    // reserved for the one cause that is still a real eviction (an arena match).
    expect(evs.some((e) => e.type === 'bgUnqueued' && e.pid === a)).toBe(false);
  });

  it('a live participant cannot enter a delve mid-match', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const pid = match.teams[0][0];
    sim.enterDelve('collapsed_reliquary', 'tier1', pid);
    sim.tick();
    expect(sim.bgMatchFor(pid)).toBe(match); // still in the match, not in a delve
    expect(isBgPos(sim.entities.get(pid)!.pos.x)).toBe(true);
  });

  it('the honor DR window round-trips through CharacterState and clears on UTC rollover', () => {
    const { sim, pids } = tenInQueue();
    sim.resetDay = '2026-07-26';
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const winner = match.teams[0][0];
    for (let cap = 0; cap < BG_CAPS_TO_WIN; cap++) captureOnce(sim, match, winner);
    const daily = sim.meta(winner)!.honorArenaDaily!;
    expect(daily.bgResultsByOpponent).toBeTruthy();
    expect(Object.values(daily.bgResultsByOpponent!)).toEqual([1]);
    expect(daily.date).toBe('2026-07-26');
    // ROLLOVER: the next award on a new UTC day re-keys the window and pays
    // the full price again (the reset arm in pvp/honor.ts dailyWindow)
    const honorAfterDayOne = sim.meta(winner)!.honor;
    for (let i = 0; i < 20 * (BG_END_HOLD + 1); i++) sim.tick(); // run out the result screen
    sim.resetDay = '2026-07-27';
    for (const pid of pids) sim.bgQueueJoin(pid);
    sim.tick();
    acceptAllBgOffers(sim);
    const rematch = sim.bgMatchFor(winner)!;
    toActive(sim, rematch);
    const rewinner = rematch.teams[0].includes(winner) ? winner : rematch.teams[1][0];
    for (let cap = 0; cap < BG_CAPS_TO_WIN; cap++) captureOnce(sim, rematch, rematch.teams[0][0]);
    const team0Won = rematch.teams[0].includes(rewinner);
    const meta = sim.meta(rewinner)!;
    expect(meta.honorArenaDaily!.date).toBe('2026-07-27'); // window re-keyed
    expect(Object.values(meta.honorArenaDaily!.bgResultsByOpponent ?? {})).toEqual([1]);
    // full price again, NOT the same-day repeat decay. A WIN on the new day
    // also re-arms the first-win-of-the-day bonus, so it pays base + bonus.
    const paid = meta.honor - (rewinner === winner ? honorAfterDayOne : 0);
    expect(paid).toBe(
      team0Won
        ? BATTLEGROUND_WIN_HONOR + BATTLEGROUND_FIRST_WIN_BONUS_HONOR
        : BATTLEGROUND_LOSS_HONOR,
    );
    // persists across a save/load round trip (the anti-win-trading window)
    const state = sim.serializeCharacter(winner)!;
    expect(state.honorArenaDaily!.bgResultsByOpponent).toEqual(daily.bgResultsByOpponent);
    const sim2 = makeWorld();
    const reloaded = sim2.addPlayer('warrior', 'Reload', { state });
    expect(sim2.meta(reloaded)!.honorArenaDaily!.bgResultsByOpponent).toEqual(
      daily.bgResultsByOpponent,
    );
  });
});

describe('Thornhollow Fields: matchmaking fairness', () => {
  const tenAtRatings = (ratings: number[]) => {
    const sim = makeWorld();
    const pids: number[] = [];
    for (let i = 0; i < ratings.length; i++) {
      const pid = sim.addPlayer('warrior', `R${i}`);
      tp(sim, pid, 0, -40);
      sim.entities.get(pid)!.level = BG_MIN_LEVEL;
      sim.meta(pid)!.bgRating = ratings[i];
      pids.push(pid);
    }
    return { sim, pids };
  };

  it('holds a lopsided ten, then seats it anyway rather than starving the queue', () => {
    // Five high and five low, all solo: no packing can close a gap this wide,
    // so the band refuses it at first.
    const { sim, pids } = tenAtRatings([2400, 2400, 2400, 2400, 2400, 900, 900, 900, 900, 900]);
    for (const pid of pids) sim.bgQueueJoin(pid);
    sim.tick();
    expect(sim.bgMatchFor(pids[0]), 'a gap far past the band must not seat at once').toBeNull();
    // The band widens with the wait and the hard release backs it up, so the
    // queue always drains: an empty battleground is the worse outcome.
    for (let i = 0; i < 20 * (BG_FAIRNESS_MAX_WAIT + 1) && !sim.bgMatchFor(pids[0]); i++) {
      sim.tick();
      acceptAllBgOffers(sim);
    }
    expect(sim.bgMatchFor(pids[0]), 'the queue must never starve').toBeTruthy();
  });

  it('ages a waiting group exactly one DT per tick, however many matches seat that tick', () => {
    // Fifteen eligible bodies: one ten seats on this tick and five are left in
    // line. The fairness clock is a TICK clock, so the leftovers have waited
    // exactly one tick, not one tick per match the retry loop seated.
    const sim = makeWorld();
    const pids: number[] = [];
    for (let i = 0; i < 15; i++) {
      const pid = sim.addPlayer('warrior', `Q${i}`);
      tp(sim, pid, 0, -40);
      sim.entities.get(pid)!.level = BG_MIN_LEVEL;
      pids.push(pid);
    }
    for (const pid of pids) sim.bgQueueJoin(pid);
    sim.tick();
    acceptAllBgOffers(sim);
    expect(sim.bgMatchFor(pids[0]), 'an even ten seats on the tick').toBeTruthy();
    const left = sim.ctx.bgQueue;
    expect(
      left.reduce((sum, g) => sum + g.pids.length, 0),
      'five bodies are left over',
    ).toBe(5);
    for (const g of left) {
      expect(g.waited, 'one tick of waiting is exactly DT, never DT per seated match').toBe(DT);
    }
  });

  it('reads the fairness clock off the ten being seated, not a stale unpackable group', () => {
    // Two five-stacks 300 rating apart, plus a three-stack that no packing can
    // seat behind them (both sides are already full when it is considered).
    // The three-stack ages forever; its clock must not widen the band, or
    // release the gates, for a ten it is not part of.
    const sim = makeWorld();
    const stack = (size: number, rating: number, tag: string): number[] => {
      const leader = sim.addPlayer('warrior', `${tag}0`);
      tp(sim, leader, 0, -40);
      sim.entities.get(leader)!.level = BG_MIN_LEVEL;
      sim.meta(leader)!.bgRating = rating;
      const members = [leader];
      for (let i = 1; i < size; i++) {
        const m = sim.addPlayer('warrior', `${tag}${i}`);
        tp(sim, m, 0, -40);
        sim.entities.get(m)!.level = BG_MIN_LEVEL;
        sim.meta(m)!.bgRating = rating;
        sim.partyInvite(m, leader);
        sim.partyAccept(m);
        members.push(m);
      }
      sim.bgQueueJoin(leader); // the whole party queues as one group
      return members;
    };
    const stale = stack(3, 1500, 'S');
    const high = stack(5, 1800, 'H');
    const low = stack(5, 1500, 'L');
    sim.tick();
    expect(sim.bgMatchFor(high[0]), 'a 300 gap is past the fresh band').toBeNull();
    expect(sim.bgMatchFor(stale[0]), 'the three-stack fits neither side').toBeNull();
    // Park the stale group's clock past every concession the gates make.
    const staleGroup = sim.ctx.bgQueue.find((g) => g.pids.includes(stale[0]))!;
    staleGroup.waited = BG_FAIRNESS_MAX_WAIT + 1;
    for (let i = 0; i < 20; i++) sim.tick(); // a full second of matchmaker passes
    expect(
      sim.bgMatchFor(high[0]),
      'a stale unpackable group must not release another ten from the rating band',
    ).toBeNull();
    expect(staleGroup.waited, 'and it is still the one doing the waiting').toBeGreaterThan(
      BG_FAIRNESS_MAX_WAIT,
    );
    // The seated ten still earns its own concession on its own clock, so the
    // queue never starves: the band widens until the 300 gap fits.
    for (let i = 0; i < 20 * (BG_FAIRNESS_MAX_WAIT + 1) && !sim.bgMatchFor(high[0]); i++) {
      sim.tick();
      acceptAllBgOffers(sim);
    }
    const match = sim.bgMatchFor(high[0])!;
    expect(match, 'the queue must never starve').toBeTruthy();
    for (const pid of stale) {
      expect(sim.bgMatchFor(pid), 'the unpackable three-stack is still waiting').toBeNull();
    }
  });

  it('seats an even ten immediately, and splits the two ratings across the teams', () => {
    // FOUR high and six low, which is the packable case: two high and three low
    // on each side closes the gap exactly, so there is no reason to wait. (Five
    // and five is NOT packable: one side must take three highs, so the best
    // possible gap is 300 and the test above is right to see it held.)
    const { sim, pids } = tenAtRatings([2400, 2400, 2400, 2400, 900, 900, 900, 900, 900, 900]);
    for (const pid of pids) sim.bgQueueJoin(pid);
    sim.tick();
    acceptAllBgOffers(sim);
    const match = sim.bgMatchFor(pids[0]);
    expect(match, 'a packable ten seats on the tick').toBeTruthy();
    const avg = (team: number[]) =>
      team.reduce((sum, p) => sum + sim.meta(p)!.bgRating, 0) / team.length;
    expect(Math.abs(avg(match!.teams[0]) - avg(match!.teams[1]))).toBeLessThanOrEqual(
      BG_RATING_BAND,
    );
  });
});

describe('Thornhollow Fields: the kill and assist honor drip', () => {
  it('pays the blow, pays the helpers less, and pays the helper only once', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const killer = match.teams[0][0];
    const helper = match.teams[0][1];
    const bystander = match.teams[0][2];
    const victim = match.teams[1][0];
    const honorOf = (pid: number) => sim.meta(pid)!.honor;
    const before = [honorOf(killer), honorOf(helper), honorOf(bystander)];
    // The helper softens the target, someone else lands the blow.
    sim.ctx.dealDamage(
      sim.entities.get(helper)!,
      sim.entities.get(victim)!,
      5,
      false,
      'physical',
      null,
      'hit',
    );
    kill(sim, victim, killer);
    sim.tick();
    expect(honorOf(killer) - before[0], 'the blow pays').toBe(BATTLEGROUND_KILL_HONOR);
    expect(honorOf(helper) - before[1], 'the assist pays less').toBe(BATTLEGROUND_ASSIST_HONOR);
    expect(honorOf(bystander) - before[2], 'a bystander is paid nothing').toBe(0);
    // The scoreboard shows the same story.
    expect(match.stats.get(killer)!.kills).toBe(1);
    expect(match.stats.get(helper)!.assists).toBe(1);
    expect(match.stats.get(helper)!.kills).toBe(0);
    expect(match.stats.get(bystander)!.assists).toBe(0);
  });

  it('decays a repeated victim, so a graveyard camp stops paying', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const killer = match.teams[0][0];
    const victim = match.teams[1][0];
    const gains: number[] = [];
    // Four kills on the SAME victim: the DR curve is 1, 0.5, 0.25, 0.
    for (let i = 0; i < 4; i++) {
      const before = sim.meta(killer)!.honor;
      const e = sim.entities.get(victim)!;
      e.dead = false;
      e.ghost = false;
      e.hp = e.maxHp;
      kill(sim, victim, killer);
      sim.tick();
      gains.push(sim.meta(killer)!.honor - before);
    }
    expect(gains[0]).toBe(BATTLEGROUND_KILL_HONOR);
    expect(gains[1]).toBe(Math.floor(BATTLEGROUND_KILL_HONOR * 0.5));
    expect(gains[2]).toBe(Math.floor(BATTLEGROUND_KILL_HONOR * 0.25));
    expect(gains[3], 'the fourth repeat pays nothing').toBe(0);
    // A DIFFERENT victim is its own counter, so honest fighting still pays.
    const other = match.teams[1][1];
    const before = sim.meta(killer)!.honor;
    kill(sim, other, killer);
    sim.tick();
    expect(sim.meta(killer)!.honor - before).toBe(BATTLEGROUND_KILL_HONOR);
  });

  it('pays the healer who kept the killer standing, and never the enemy healer', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const killer = match.teams[0][0];
    const healer = match.teams[0][1];
    const victim = match.teams[1][0];
    const enemyHealer = match.teams[1][1];
    // The enemy healer heals their OWN teammate: allied support, but for the
    // losing side, so it must never pay when that side takes the death.
    const victimEntity = sim.entities.get(victim)!;
    victimEntity.hp = Math.max(1, victimEntity.maxHp - 50);
    sim.ctx.applyHeal(sim.entities.get(enemyHealer)!, victimEntity, 10, 'test', null, false);
    // Our healer tops up the fighter who then lands the blow: that IS support.
    const killerEntity = sim.entities.get(killer)!;
    killerEntity.hp = Math.max(1, killerEntity.maxHp - 50);
    sim.ctx.applyHeal(sim.entities.get(healer)!, killerEntity, 10, 'test', null, false);
    const healerBefore = sim.meta(healer)!.honor;
    const enemyHealerBefore = sim.meta(enemyHealer)!.honor;
    kill(sim, victim, killer);
    sim.tick();
    expect(
      sim.meta(healer)!.honor - healerBefore,
      'a healer who never swung still earns from the kill they enabled',
    ).toBe(BATTLEGROUND_ASSIST_HONOR);
    expect(match.stats.get(healer)!.assists).toBe(1);
    expect(
      sim.meta(enemyHealer)!.honor - enemyHealerBefore,
      'the dead side is never paid for the death',
    ).toBe(0);
  });

  it('never pays a teammate, and never pays an unrated dev match', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const a = match.teams[0][0];
    const teammate = match.teams[0][1];
    const before = sim.meta(a)!.honor;
    kill(sim, teammate, a); // friendly fire earns nothing
    sim.tick();
    expect(sim.meta(a)!.honor).toBe(before);
    expect(match.stats.get(a)!.kills).toBe(0);
  });

  it('tallies assists in an UNRATED dev match too, while paying no honor for them', () => {
    // The scoreboard is not currency: an unrated match counts kills, deaths and
    // captures, so its assists column must not be the one blank row.
    const sim = makeWorld();
    const pids: number[] = [];
    for (let i = 0; i < 4; i++) {
      const pid = sim.addPlayer('warrior', `D${i}`);
      tp(sim, pid, 0, -40);
      sim.entities.get(pid)!.level = BG_MIN_LEVEL;
      pids.push(pid);
      sim.bgQueueJoin(pid);
    }
    devStartBg(sim.ctx);
    const match = sim.bgMatchFor(pids[0])!;
    expect(match.rated).toBe(false);
    toActive(sim, match);
    const killer = match.teams[0][0];
    const helper = match.teams[0][1];
    const victim = match.teams[1][0];
    const helperBefore = sim.meta(helper)!.honor ?? 0;
    const killerBefore = sim.meta(killer)!.honor ?? 0;
    sim.ctx.dealDamage(
      sim.entities.get(helper)!,
      sim.entities.get(victim)!,
      5,
      false,
      'physical',
      null,
      'hit',
    );
    kill(sim, victim, killer);
    sim.tick();
    expect(match.stats.get(killer)!.kills, 'kills count unrated').toBe(1);
    expect(match.stats.get(victim)!.deaths, 'deaths count unrated').toBe(1);
    expect(match.stats.get(helper)!.assists, 'and so do assists').toBe(1);
    expect(match.stats.get(killer)!.assists, 'the blow is never also an assist').toBe(0);
    // The honor half of the drip stays rated-only: a dev-forced match must
    // never move real currency.
    expect((sim.meta(helper)!.honor ?? 0) - helperBefore, 'no assist honor unrated').toBe(0);
    expect((sim.meta(killer)!.honor ?? 0) - killerBefore, 'no kill honor unrated').toBe(0);
  });
});

describe('Thornhollow Fields: honor + persistence', () => {
  it('a played-out win pays BATTLEGROUND_WIN_HONOR, the losers BATTLEGROUND_LOSS_HONOR, repeat-decayed', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const winner = match.teams[0][0];
    const loser = match.teams[1][0];
    for (let cap = 0; cap < BG_CAPS_TO_WIN; cap++) captureOnce(sim, match, winner);
    // This is also the day's FIRST win, so it carries the daily bonus; the
    // decay arm below is what this case is really about, and it is measured
    // against the win award alone once the bonus is spent.
    const firstDayWin = BATTLEGROUND_WIN_HONOR + BATTLEGROUND_FIRST_WIN_BONUS_HONOR;
    expect(sim.meta(winner)!.honor).toBe(firstDayWin);
    expect(sim.meta(winner)!.lifetimeHonor).toBe(firstDayWin);
    // A LOSS never arms or claims the daily bonus.
    expect(sim.meta(loser)!.honor).toBe(BATTLEGROUND_LOSS_HONOR);
    for (let i = 0; i < 20 * (BG_END_HOLD + 1); i++) sim.tick(); // run out the result screen

    // The SAME two teams meet again: the repeat pays half. Seated directly
    // rather than through the queue on purpose. The matchmaker now rebalances
    // by rating, and after one decided match the winners and losers have moved
    // apart, so re-queueing the same ten deliberately produces DIFFERENT teams
    // (a new opposing identity, which correctly pays full). What is under test
    // here is the repeat decay itself, so the rematch keeps the first rosters.
    const teamA = [...match.teams[0]];
    const teamB = [...match.teams[1]];
    startBgMatch(sim.ctx, teamA, teamB);
    const rematch = sim.bgMatchFor(winner)!;
    expect(rematch).toBeTruthy();
    expect(rematch.teams[0]).toEqual(teamA);
    expect(rematch.teams[1]).toEqual(teamB);
    toActive(sim, rematch);
    const winner2 = rematch.teams[0][0];
    for (let cap = 0; cap < BG_CAPS_TO_WIN; cap++) captureOnce(sim, rematch, winner2);
    const w2meta = sim.meta(winner2)!;
    // The second win of the same day pays the decayed base and NOTHING else:
    // the daily bonus was already claimed by the first win above.
    expect(w2meta.honor).toBe(firstDayWin + Math.floor(BATTLEGROUND_WIN_HONOR * 0.5));
  });

  it('battleground standing round-trips through CharacterState and stays absent until first result', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('druid', 'Keeper');
    // untouched standing: the save carries NO bg fields (byte-stable saves)
    const clean = sim.serializeCharacter(a)!;
    expect(clean.bgRating).toBeUndefined();
    expect(clean.bgWins).toBeUndefined();
    sim.meta(a)!.bgRating = 1633;
    sim.meta(a)!.bgWins = 7;
    sim.meta(a)!.bgCaptures = 19;
    const state = sim.serializeCharacter(a)!;
    expect(state.bgRating).toBe(1633);
    expect(state.bgWins).toBe(7);
    expect(state.bgLosses).toBe(0);
    expect(state.bgCaptures).toBe(19);
    const sim2 = makeWorld();
    const a2 = sim2.addPlayer('druid', 'Keeper', { state });
    expect(sim2.meta(a2)!.bgRating).toBe(1633);
    expect(sim2.meta(a2)!.bgWins).toBe(7);
    expect(sim2.meta(a2)!.bgCaptures).toBe(19);
  });
});

describe('Thornhollow Fields: the first win of the day pays a bonus', () => {
  // The bonus rides the honorArenaDaily window, which only rolls over when the
  // host supplies a calendar, so every arm here sets one explicitly.
  const bonusEvents = (evs: SimEvent[], pid: number) =>
    evs.filter(
      (e): e is Extract<SimEvent, { type: 'honor' }> =>
        e.type === 'honor' && e.pid === pid && e.reason === 'battleground_first_win',
    );

  function playedOutWin(sim: Sim, match: BgMatch, winner: number): SimEvent[] {
    const seen: SimEvent[] = [];
    const azure = match.flags[1];
    const crimsonHome = match.flags[0].home;
    for (let cap = 0; cap < BG_CAPS_TO_WIN; cap++) {
      tp(sim, winner, azure.pos.x, azure.pos.z);
      sim.bgFlagAction(winner);
      seen.push(...sim.tick());
      tp(sim, winner, crimsonHome.x, crimsonHome.z);
      seen.push(...sim.tick());
    }
    return seen;
  }

  it('the bonus is a flat authored award, not a multiple of the win', () => {
    // Pinned to the literal on purpose. The bonus used to be derived (win x 2 =
    // 120, so the day's first win paid 180, three times a routine one), which
    // paid "log in, win once, log off" better than it paid playing a session.
    // A flat 20 is a judgment about what a daily hook is worth, so asserting it
    // against BATTLEGROUND_WIN_HONOR would restate the shape that was removed.
    expect(BATTLEGROUND_FIRST_WIN_BONUS_HONOR).toBe(20);
    // The property that actually matters: first win to repeat win is 1.33x, in
    // line with the delve daily's ~1.6x rather than the old 3x.
    const firstWin = BATTLEGROUND_WIN_HONOR + BATTLEGROUND_FIRST_WIN_BONUS_HONOR;
    expect(firstWin).toBe(80);
    expect(firstWin / BATTLEGROUND_WIN_HONOR).toBeLessThan(1.5);
  });

  it('pays exactly once per reset day, under its own honor reason', () => {
    const { sim, pids } = tenInQueue();
    sim.resetDay = '2026-07-26';
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const winner = match.teams[0][0];
    const loser = match.teams[1][0];
    const evs = playedOutWin(sim, match, winner);

    const paid = bonusEvents(evs, winner);
    expect(paid.length, 'exactly one bonus grant').toBe(1);
    expect(paid[0].amount).toBe(BATTLEGROUND_FIRST_WIN_BONUS_HONOR);
    expect(sim.meta(winner)!.honor).toBe(
      BATTLEGROUND_WIN_HONOR + BATTLEGROUND_FIRST_WIN_BONUS_HONOR,
    );
    expect(sim.meta(winner)!.honorArenaDaily!.bgFirstWinClaimed).toBe(true);
    // The LOSING side neither claims nor is paid it.
    expect(bonusEvents(evs, loser).length).toBe(0);
    expect(sim.meta(loser)!.honorArenaDaily!.bgFirstWinClaimed).toBeUndefined();
    expect(sim.meta(loser)!.honor).toBe(BATTLEGROUND_LOSS_HONOR);
  });

  it('a SECOND win the same day pays the base award only', () => {
    const { sim, pids } = tenInQueue();
    sim.resetDay = '2026-07-26';
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const winner = match.teams[0][0];
    playedOutWin(sim, match, winner);
    const afterFirst = sim.meta(winner)!.honor;
    for (let i = 0; i < 20 * (BG_END_HOLD + 1); i++) sim.tick();

    // Fresh opposing identity so the repeat DR on the BASE award is not what is
    // being measured: only the bonus should be missing the second time.
    const fresh: number[] = [];
    for (let i = 0; i < 5; i++) {
      const p = sim.addPlayer('mage', `Fresh${i}`);
      tp(sim, p, 0, -40);
      sim.entities.get(p)!.level = BG_MIN_LEVEL;
      fresh.push(p);
    }
    startBgMatch(sim.ctx, [...match.teams[0]], fresh);
    const rematch = sim.bgMatchFor(winner)!;
    toActive(sim, rematch);
    const evs = playedOutWin(sim, rematch, winner);
    expect(bonusEvents(evs, winner).length, 'the day is spent').toBe(0);
    expect(sim.meta(winner)!.honor - afterFirst).toBe(BATTLEGROUND_WIN_HONOR);
  });

  it('the UTC rollover re-arms it, and the claim survives a save/load round trip', () => {
    const { sim, pids } = tenInQueue();
    sim.resetDay = '2026-07-26';
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const winner = match.teams[0][0];
    playedOutWin(sim, match, winner);

    // PERSISTENCE: the claimed flag is written and reloaded, so a relog on the
    // same day cannot re-earn it.
    const state = sim.serializeCharacter(winner)!;
    expect(state.honorArenaDaily!.bgFirstWinClaimed).toBe(true);
    const sim2 = makeWorld();
    sim2.resetDay = '2026-07-26';
    const reloaded = sim2.addPlayer('warrior', 'Reload', { state });
    expect(sim2.meta(reloaded)!.honorArenaDaily!.bgFirstWinClaimed).toBe(true);
    expect(sim2.bgInfoFor(reloaded)!.firstWinBonusReady, 'still spent after a relog').toBe(false);
    // ...and the NEXT day re-arms it without any award having run.
    sim2.resetDay = '2026-07-27';
    expect(sim2.bgInfoFor(reloaded)!.firstWinBonusReady).toBe(true);

    // A clean character writes NOTHING (byte-stable saves): absent until claimed.
    const sim3 = makeWorld();
    const clean = sim3.addPlayer('warrior', 'Clean');
    expect(sim3.serializeCharacter(clean)!.honorArenaDaily?.bgFirstWinClaimed).toBeUndefined();

    for (let i = 0; i < 20 * (BG_END_HOLD + 1); i++) sim.tick();
    sim.resetDay = '2026-07-27';
    expect(sim.bgInfoFor(winner)!.firstWinBonusReady, 'a new day re-arms the chip').toBe(true);
    const before = sim.meta(winner)!.honor;
    startBgMatch(sim.ctx, [...match.teams[0]], [...match.teams[1]]);
    const rematch = sim.bgMatchFor(winner)!;
    toActive(sim, rematch);
    const evs = playedOutWin(sim, rematch, winner);
    expect(bonusEvents(evs, winner).length).toBe(1);
    // The base award decays (same opponents, but the DR window rolled over too),
    // so the bonus is measured on its own.
    expect(sim.meta(winner)!.honor - before).toBe(
      BATTLEGROUND_WIN_HONOR + BATTLEGROUND_FIRST_WIN_BONUS_HONOR,
    );
  });

  it('re-arms on the RESET window, and never on the UTC calendar date alone', () => {
    // The reported bug: the banner read "First win of the day" at 6 PM Pacific to
    // a player who had already won that afternoon, because midnight UTC had
    // passed at 5 PM and rolled the window mid-evening. The two clocks are now
    // separate fields, so moving the calendar date must do nothing at all.
    const { sim, pids } = tenInQueue();
    sim.resetDay = '2026-08-07';
    sim.utcDay = '2026-08-07';
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const winner = match.teams[0][0];
    playedOutWin(sim, match, winner);
    expect(sim.bgInfoFor(winner)!.firstWinBonusReady, 'claimed by the win').toBe(false);

    // 6 PM Pacific: the UTC calendar has ticked over to the 8th, the realm's own
    // reset (3 AM Eastern) has not.
    sim.utcDay = '2026-08-08';
    expect(
      sim.bgInfoFor(winner)!.firstWinBonusReady,
      'a UTC rollover must not re-arm the day',
    ).toBe(false);
    expect(sim.meta(winner)!.honorArenaDaily!.bgFirstWinClaimed).toBe(true);

    // The realm's reset is what re-arms it.
    sim.resetDay = '2026-08-08';
    expect(sim.bgInfoFor(winner)!.firstWinBonusReady, 'the realm reset re-arms it').toBe(true);
  });

  it('an UNRATED dev match never claims it', () => {
    const sim = makeWorld();
    sim.resetDay = '2026-07-26';
    const pids: number[] = [];
    for (let i = 0; i < 4; i++) {
      const p = sim.addPlayer('warrior', `D${i}`);
      tp(sim, p, 0, -40);
      sim.entities.get(p)!.level = BG_MIN_LEVEL;
      sim.bgQueueJoin(p);
      pids.push(p);
    }
    devStartBg(sim.ctx);
    const match = sim.bgMatchFor(pids[0])!;
    expect(match.rated).toBe(false);
    toActive(sim, match);
    const winner = match.teams[0][0];
    const evs = [...sim.tick()];
    endBgMatch(sim.ctx, match, 0, 'caps');
    evs.push(...sim.tick());
    expect(bonusEvents(evs, winner).length).toBe(0);
    expect(sim.meta(winner)!.honorArenaDaily?.bgFirstWinClaimed).toBeUndefined();
    expect(sim.bgInfoFor(winner)!.firstWinBonusReady, 'still on the table').toBe(true);
  });

  it('a FORFEIT win never claims it (forfeits pay no honor at all)', () => {
    const { sim, pids } = tenInQueue();
    sim.resetDay = '2026-07-26';
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const winner = match.teams[0][0];
    const before = sim.meta(winner)!.honor;
    endBgMatch(sim.ctx, match, 0, 'forfeit');
    const evs = sim.tick();
    expect(bonusEvents(evs, winner).length).toBe(0);
    expect(sim.meta(winner)!.honor).toBe(before);
    expect(sim.meta(winner)!.honorArenaDaily?.bgFirstWinClaimed).toBeUndefined();
  });

  it('a DRAW never claims it', () => {
    const { sim, pids } = tenInQueue();
    sim.resetDay = '2026-07-26';
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const pid = match.teams[0][0];
    endBgMatch(sim.ctx, match, null, 'timeout');
    const evs = sim.tick();
    expect(bonusEvents(evs, pid).length).toBe(0);
    expect(sim.meta(pid)!.honorArenaDaily!.bgFirstWinClaimed).toBeUndefined();
    expect(sim.bgInfoFor(pid)!.firstWinBonusReady).toBe(true);
  });

  it('the bgEnd event carries the bonus so the finish surface can name it', () => {
    const { sim, pids } = tenInQueue();
    sim.resetDay = '2026-07-26';
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const winner = match.teams[0][0];
    const loser = match.teams[1][0];
    const evs = playedOutWin(sim, match, winner);
    const ends = evs.filter((e): e is Extract<SimEvent, { type: 'bgEnd' }> => e.type === 'bgEnd');
    expect(ends.find((e) => e.pid === winner)!.firstWinBonus).toBe(
      BATTLEGROUND_FIRST_WIN_BONUS_HONOR,
    );
    expect(ends.find((e) => e.pid === loser)!.firstWinBonus, 'a loss pays no bonus').toBe(0);
  });

  it('bgInfoFor REPORTS the window without rolling it over', () => {
    // The readout must never mutate the daily window it reports on: a stale
    // stored date reads as re-armed, and the stored date is left for the next
    // real award to roll over.
    const { sim, pids } = tenInQueue();
    sim.resetDay = '2026-07-26';
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const winner = match.teams[0][0];
    playedOutWin(sim, match, winner);
    sim.resetDay = '2026-07-27';
    expect(sim.bgInfoFor(winner)!.firstWinBonusReady).toBe(true);
    expect(sim.meta(winner)!.honorArenaDaily!.date, 'the read wrote nothing').toBe('2026-07-26');
    expect(sim.meta(winner)!.honorArenaDaily!.bgFirstWinClaimed).toBe(true);
  });
});

describe('Thornhollow Fields: the finish surface knows WHY the match ended', () => {
  const endsFor = (evs: SimEvent[], pid: number) =>
    evs.filter(
      (e): e is Extract<SimEvent, { type: 'bgEnd' }> => e.type === 'bgEnd' && e.pid === pid,
    );

  it("a match played to the capture target carries ended:'caps'", () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const winner = match.teams[0][0];
    const seen: SimEvent[] = [];
    const azure = match.flags[1];
    const crimsonHome = match.flags[0].home;
    for (let cap = 0; cap < BG_CAPS_TO_WIN; cap++) {
      tp(sim, winner, azure.pos.x, azure.pos.z);
      sim.bgFlagAction(winner);
      seen.push(...sim.tick());
      tp(sim, winner, crimsonHome.x, crimsonHome.z);
      seen.push(...sim.tick());
    }
    const end = endsFor(seen, winner);
    expect(end.length).toBe(1);
    expect(end[0].ended).toBe('caps');
    expect(end[0].won).toBe(true);
  });

  it("the match cap resolving on score carries ended:'timer', for all ten", () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    // One capture so the timeout resolves on SCORE rather than as a draw: the
    // cause must be 'timer' whichever way the score fell.
    captureOnce(sim, match, match.teams[0][0]);
    match.timer = BG_MAX_DURATION - DT;
    const evs = sim.tick();
    const ends = evs.filter((e): e is Extract<SimEvent, { type: 'bgEnd' }> => e.type === 'bgEnd');
    expect(ends.length, 'one per fighter').toBe(10);
    for (const e of ends) expect(e.ended).toBe('timer');
    expect(ends.filter((e) => e.won).length).toBe(5);
  });

  it("a forfeit carries ended:'forfeit'", () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const survivor = match.teams[0][0];
    endBgMatch(sim.ctx, match, 0, 'forfeit');
    expect(endsFor(sim.tick(), survivor)[0].ended).toBe('forfeit');
  });
});

describe('Thornhollow Fields: the clock calls out its last minutes', () => {
  const warnings = (evs: SimEvent[]) =>
    evs.filter(
      (e): e is Extract<SimEvent, { type: 'bgTimeWarning' }> => e.type === 'bgTimeWarning',
    );

  /** Wind the match clock to DT short of `secondsLeft` remaining, so the very
   *  next tick is the crossing tick. */
  function armAt(match: BgMatch, secondsLeft: number) {
    match.timer = BG_MAX_DURATION - secondsLeft - DT;
  }

  it('each threshold fires exactly once, on its crossing tick, to all ten', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const roster = bgAllPids(match);
    expect(roster.length).toBe(10);

    for (const mark of BG_TIME_WARNINGS) {
      armAt(match, mark);
      const before = warnings(sim.tick());
      expect(before.length, `the ${mark}s call fans to all ten`).toBe(10);
      for (const w of before) expect(w.secondsLeft).toBe(mark);
      expect([...before.map((w) => w.pid!)].sort((a, b) => a - b)).toEqual(
        [...roster].sort((a, b) => a - b),
      );
      // Rewinding the clock cannot make it speak twice: the once-only claim
      // lives on the match, not on the clock value.
      armAt(match, mark);
      expect(warnings(sim.tick()).length, `the ${mark}s call is once-only`).toBe(0);
    }
  });

  it('says nothing during the form-up countdown', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    expect(match.state).toBe('countdown');
    const seen: SimEvent[] = [];
    for (let i = 0; i < 20 * 12 && match.state !== 'active'; i++) seen.push(...sim.tick());
    expect(warnings(seen).length).toBe(0);
  });

  it('a match decided by captures before the threshold never announces it', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const winner = match.teams[0][0];
    const seen: SimEvent[] = [];
    for (let cap = 0; cap < BG_CAPS_TO_WIN; cap++) {
      const azure = match.flags[1];
      tp(sim, winner, azure.pos.x, azure.pos.z);
      sim.bgFlagAction(winner);
      seen.push(...sim.tick());
      tp(sim, winner, match.flags[0].home.x, match.flags[0].home.z);
      seen.push(...sim.tick());
    }
    expect(match.state).toBe('ended');
    // Run the whole end hold out: the hold reuses `timer` as a COUNTDOWN, which
    // is exactly the value that would look like "120s remaining" to a naive read.
    for (let i = 0; i < 20 * (BG_END_HOLD + 1); i++) seen.push(...sim.tick());
    expect(warnings(seen).length).toBe(0);
  });

  it('the one-minute call precedes the ended:timer result it warned about', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const seen: SimEvent[] = [];
    armAt(match, 60);
    seen.push(...sim.tick()); // the 60s call
    match.timer = BG_MAX_DURATION - DT;
    seen.push(...sim.tick()); // the cap resolves
    const warnAt = seen.findIndex((e) => e.type === 'bgTimeWarning');
    const endAt = seen.findIndex((e) => e.type === 'bgEnd');
    expect(warnAt).toBeGreaterThanOrEqual(0);
    expect(endAt).toBeGreaterThan(warnAt);
    expect((seen[endAt] as Extract<SimEvent, { type: 'bgEnd' }>).ended).toBe('timer');
  });

  it('a threshold already past at the first active tick is skipped, never fired late', () => {
    // The crossing rule, not a "remaining <= mark" read: a match seated with
    // less clock than a threshold must not open by announcing that threshold.
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    // Straight past the 120s mark without a tick in between, then cross 60s.
    match.timer = BG_MAX_DURATION - 61;
    const skipped = warnings(sim.tick());
    expect(skipped.length, 'the 120s mark was never crossed').toBe(0);
    armAt(match, 60);
    const spoke = warnings(sim.tick());
    expect(spoke.length).toBe(10);
    expect(spoke[0].secondsLeft).toBe(60);
    expect(match.timeWarningsFired.has(120)).toBe(false);
  });
});

describe('Thornhollow Fields: resolved matches leave one operator record', () => {
  it('writes exactly ONE record per resolved rated match, never one per fighter', () => {
    // The whole reason the record exists rather than a counter driven off the
    // bgEnd events: bgEnd is PERSONAL, so an event-driven counter would book
    // every match ten times.
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const winner = match.teams[0][0];
    for (let cap = 0; cap < BG_CAPS_TO_WIN - 1; cap++) captureOnce(sim, match, winner);
    // Wind the match clock rather than ticking five real minutes: the duration
    // recorded must be the ELAPSED active seconds, not a tick count.
    match.timer = 300;
    captureOnce(sim, match, winner);

    const drained = drainBgOutcomes(sim.bgOutcomes);
    expect(drained.length).toBe(1);
    expect(drained[0].matchId).toBe(match.id);
    expect(drained[0].ended).toBe('caps');
    expect(drained[0].scoreCrimson).toBe(BG_CAPS_TO_WIN);
    expect(drained[0].scoreAzure).toBe(0);
    expect(drained[0].durationSec).toBe(300);
    expect(drained[0].grouped, 'ten solo queuers were never grouped').toBe(false);
    // Drained means drained: a second drain sees nothing, so a per-tick host
    // cannot double-count the same match.
    expect(drainBgOutcomes(sim.bgOutcomes).length).toBe(0);
    // And the end hold running out records nothing further.
    for (let i = 0; i < 20 * (BG_END_HOLD + 1); i++) sim.tick();
    expect(drainBgOutcomes(sim.bgOutcomes).length).toBe(0);
  });

  it('records the timer ending and the elapsed active seconds', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    captureOnce(sim, match, match.teams[0][0]);
    match.timer = BG_MAX_DURATION - DT;
    sim.tick();
    const [record] = drainBgOutcomes(sim.bgOutcomes);
    expect(record.ended).toBe('timer');
    expect(record.durationSec).toBe(BG_MAX_DURATION);
  });

  it('writes NOTHING for an unrated /dev match', () => {
    const sim = makeWorld();
    const pids: number[] = [];
    for (let i = 0; i < 4; i++) {
      const p = sim.addPlayer('warrior', `D${i}`);
      tp(sim, p, 0, -40);
      sim.entities.get(p)!.level = BG_MIN_LEVEL;
      sim.bgQueueJoin(p);
      pids.push(p);
    }
    devStartBg(sim.ctx);
    const match = sim.bgMatchFor(pids[0])!;
    expect(match.rated).toBe(false);
    toActive(sim, match);
    endBgMatch(sim.ctx, match, 0, 'caps');
    expect(drainBgOutcomes(sim.bgOutcomes).length, 'a dev match must not skew the averages').toBe(
      0,
    );
  });

  it('marks a match seated from a real queued GROUP, and only that', () => {
    const sim = makeWorld();
    const leader = sim.addPlayer('warrior', 'Leader');
    tp(sim, leader, 0, -40);
    sim.entities.get(leader)!.level = BG_MIN_LEVEL;
    for (let i = 0; i < 2; i++) {
      const m = sim.addPlayer('priest', `Mate${i}`);
      tp(sim, m, 0, -40);
      sim.entities.get(m)!.level = BG_MIN_LEVEL;
      sim.partyInvite(m, leader);
      sim.partyAccept(m);
    }
    for (let i = 0; i < 7; i++) {
      const s = sim.addPlayer('rogue', `Solo${i}`);
      tp(sim, s, 0, -40);
      sim.entities.get(s)!.level = BG_MIN_LEVEL;
      sim.bgQueueJoin(s);
    }
    sim.bgQueueJoin(leader); // queues the whole premade as one group
    sim.tick();
    acceptAllBgOffers(sim);
    const match = sim.bgMatchFor(leader)!;
    // The flag is snapshotted at START, which is the only moment it is knowable:
    // by resolve time both teams are welded into match parties.
    expect(match.grouped).toBe(true);
    toActive(sim, match);
    endBgMatch(sim.ctx, match, 0, 'caps');
    const [record] = drainBgOutcomes(sim.bgOutcomes);
    expect(record.grouped).toBe(true);
  });

  it('reads the QUEUED group, not live party membership at match start', () => {
    // A solo queuer who accepts an invite while WAITING did not queue as a
    // group, and a live-partyOf read at start would mislabel the whole match.
    const { sim, pids } = tenInQueue();
    // tenInQueue already seated them; re-do it with a mid-wait party instead.
    const sim2 = makeWorld();
    const queued: number[] = [];
    for (let i = 0; i < 10; i++) {
      const p = sim2.addPlayer('warrior', `S${i}`);
      tp(sim2, p, 0, -40);
      sim2.entities.get(p)!.level = BG_MIN_LEVEL;
      sim2.bgQueueJoin(p); // every one of them SOLO
      queued.push(p);
    }
    // ...and only now do two of them party up, still in the queue.
    sim2.partyInvite(queued[1], queued[0]);
    sim2.partyAccept(queued[1]);
    sim2.tick();
    acceptAllBgOffers(sim2);
    const match2 = sim2.bgMatchFor(queued[0])!;
    expect(match2.grouped, 'nobody queued as a group').toBe(false);
    expect(sim.bgMatchFor(pids[0])!.grouped, 'the plain solo ten too').toBe(false);
  });

  it('a /dev forced ending writes NOTHING, even on a genuinely rated match', () => {
    // `rated` alone cannot keep it out: this is a real queued match whose clock
    // and ending are a dev's, so it would poison the caps-vs-timer ratio.
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    expect(match.rated).toBe(true);
    toActive(sim, match);
    expect(devEndBg(sim.ctx, pids[0])).toBe(true);
    expect(match.resultRecorded, 'the result itself still resolved').toBe(true);
    expect(drainBgOutcomes(sim.bgOutcomes).length).toBe(0);
  });

  it('records a forfeit during form-up as a zero duration, never a countdown value', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    expect(match.state).toBe('countdown');
    endBgMatch(sim.ctx, match, 0, 'forfeit');
    const [record] = drainBgOutcomes(sim.bgOutcomes);
    expect(record.ended).toBe('forfeit');
    expect(record.durationSec).toBe(0);
  });

  it('caps the undrained log so a host that never drains cannot leak', () => {
    // The offline and headless hosts never drain at all; the cap is what keeps
    // that a fixed, trivial tail instead of a slow leak.
    const log = createBgOutcomeLog();
    for (let i = 0; i < BG_OUTCOME_LOG_CAP + 25; i++) {
      recordBgOutcome(log, {
        matchId: i,
        durationSec: 100,
        scoreCrimson: 1,
        scoreAzure: 0,
        ended: 'caps',
        grouped: false,
      });
    }
    expect(log.length).toBe(BG_OUTCOME_LOG_CAP);
    // The OLDEST are the ones dropped: a stale record is worth less than a fresh one.
    expect(log[log.length - 1].matchId).toBe(BG_OUTCOME_LOG_CAP + 24);
    expect(log[0].matchId).toBe(25);
  });
});

describe('Thornhollow Fields: the honor award reports what it paid', () => {
  it('returns the base award and the bonus, and total is their sum', () => {
    // The bgEnd event needs the BONUS on its own (the finish surface names it),
    // and the caller needs the total to stay honest about what was credited.
    const sim = makeWorld();
    sim.resetDay = '2026-07-26';
    const pid = sim.addPlayer('warrior', 'Champ');
    const meta = sim.meta(pid)!;

    const first = awardBattlegroundHonor(sim.ctx, meta, 'team:enemies', 'win');
    expect(first.firstWinBonus).toBe(BATTLEGROUND_FIRST_WIN_BONUS_HONOR);
    expect(first.total).toBe(BATTLEGROUND_WIN_HONOR + BATTLEGROUND_FIRST_WIN_BONUS_HONOR);
    expect(meta.honor).toBe(first.total);

    // A different opposing identity, so the base award is undecayed and the
    // ONLY difference the second time is the spent daily bonus.
    const second = awardBattlegroundHonor(sim.ctx, meta, 'team:others', 'win');
    expect(second.firstWinBonus).toBe(0);
    expect(second.total).toBe(BATTLEGROUND_WIN_HONOR);
    expect(meta.honor).toBe(first.total + second.total);

    // A loss pays the completion award and never the bonus.
    const loss = awardBattlegroundHonor(sim.ctx, meta, 'team:third', 'loss');
    expect(loss.firstWinBonus).toBe(0);
    expect(loss.total).toBe(BATTLEGROUND_LOSS_HONOR);
  });

  it('does not burn the daily claim when the grant credits nothing', () => {
    // grantHonor credits zero once a purse is at the honor ceiling; spending the
    // day's one bonus for zero honor is the wrong way to lose that race.
    const sim = makeWorld();
    sim.resetDay = '2026-07-26';
    const pid = sim.addPlayer('warrior', 'Capped');
    const meta = sim.meta(pid)!;
    meta.honor = Number.MAX_SAFE_INTEGER;
    meta.lifetimeHonor = Number.MAX_SAFE_INTEGER;

    const award = awardBattlegroundHonor(sim.ctx, meta, 'team:enemies', 'win');
    expect(award.firstWinBonus).toBe(0);
    expect(meta.honorArenaDaily!.bgFirstWinClaimed, 'the claim is still armed').toBeUndefined();
  });
});

describe('the outcome log stays observability-only', () => {
  it('is reached by the write site, the leaf, the seam, and the host drain, and nothing else', () => {
    // `bgOutcomes` is deliberately HOST-DIVERGENT state: the authoritative
    // server drains it every tick and the offline / headless hosts never drain
    // at all, so its CONTENTS legitimately differ across the three hosts. That
    // is only safe while nothing gameplay-facing reads it, which no type can
    // express, so the reference set is pinned here.
    const root = new URL('..', import.meta.url);
    const hits = execFileSync('grep', ['-rl', 'bgOutcomes', 'src', 'server', 'headless'], {
      cwd: fileURLToPath(root),
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean)
      .sort();
    expect(hits).toEqual([
      'server/game.ts', // the one host that drains
      'src/sim/sim.ts', // the backing array + its ctx binding
      'src/sim/sim_context.ts', // the live view
      'src/sim/social/battleground.ts', // the one write site
    ]);
  });
});

describe('Thornhollow Fields: a queued solo backfills a deserted seat', () => {
  it('does not let one ineligible oldest solo starve the backfill behind them', () => {
    // Review catch: liveness used to be tested AFTER picking the oldest solo, so
    // an ineligible candidate made the loop skip to the next MATCH. A live 4v5
    // then stayed unfilled while perfectly good solos waited behind the stale
    // one. Selection now filters first.
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);

    // Queue both BEFORE any seat opens, so neither is backfilled early and the
    // older one genuinely carries the longer wait.
    const stale = sim.addPlayer('warrior', 'Stale');
    tp(sim, stale, 0, -40);
    sim.entities.get(stale)!.level = BG_MIN_LEVEL;
    sim.bgQueueJoin(stale);
    for (let i = 0; i < 20 * 3; i++) sim.tick();
    const fresh = sim.addPlayer('rogue', 'Fresh');
    tp(sim, fresh, 2, -40);
    sim.entities.get(fresh)!.level = BG_MIN_LEVEL;
    sim.bgQueueJoin(fresh);
    const staleGroup = sim.ctx.bgQueue.find((g) => g.pids.includes(stale))!;
    const freshGroup = sim.ctx.bgQueue.find((g) => g.pids.includes(fresh))!;
    expect(staleGroup.waited, 'the stale one really is the older candidate').toBeGreaterThan(
      freshGroup.waited,
    );

    // Make the OLDER one ineligible the way a real one is: already seated.
    sim.ctx.bgMatches.set(stale, match);
    // ...and only NOW open the seat.
    bgResolveDesertion(sim.ctx, match.teams[0][4]);
    expect(match.teams[0]).toHaveLength(BG_TEAM_SIZE - 1);

    sim.tick();
    bgRespond(sim.ctx, true, fresh); // the seat is an OFFER now

    expect(match.teams[0], 'the younger eligible solo filled the seat').toContain(fresh);
    expect(match.teams[0]).toHaveLength(BG_TEAM_SIZE);
  });

  // The leaver already pays (bgResolveDesertion charges rating and an L). This
  // is the other half: the four who stayed get their fifth back rather than
  // playing out a rated 4v5, which at BG_TEAM_SIZE 5 is most of a match.
  const staged = (): { sim: Sim; match: BgMatch; pids: number[] } => {
    const { sim, pids } = tenInQueue();
    const match = sim.ctx.bgMatches.get(pids[0])!;
    toActive(sim, match);
    return { sim, match, pids };
  };

  // One more level-20 solo waiting in the queue, ready to be seated.
  const queueSpare = (sim: Sim, name = 'Spare'): number => {
    const pid = sim.addPlayer('warrior', name);
    tp(sim, pid, 6, -40);
    sim.entities.get(pid)!.level = 20;
    sim.bgQueueJoin(pid);
    return pid;
  };

  it('seats the spare into the empty seat and tells both sides', () => {
    const { sim, match, pids } = staged();
    const deserter = match.teams[0][0];
    const spare = queueSpare(sim);
    bgResolveDesertion(sim.ctx, deserter);
    expect(match.teams[0]).toHaveLength(BG_TEAM_SIZE - 1);

    sim.tick(); // opens the OFFER
    const events = acceptBackfillOffer(sim, spare);
    expect(match.teams[0]).toHaveLength(BG_TEAM_SIZE);
    expect(match.teams[0]).toContain(spare);
    expect(sim.ctx.bgMatches.get(spare)).toBe(match);
    expect(sim.ctx.bgQueue).toHaveLength(0);
    // The seat carries the same per-fighter bookkeeping a start-of-match one
    // does, or the release path would strand them on the field.
    expect(match.returns.has(spare)).toBe(true);
    expect(match.preMatchPools.has(spare)).toBe(true);
    expect(match.stats.get(spare)).toEqual({ kills: 0, deaths: 0, captures: 0, assists: 0 });

    // Welded into the team's match party like everyone else, and recorded as an
    // auto-added link so the release path unwinds it (a silent false from
    // joinBgTeamParty would leave them fighting outside party chat and frames).
    const teamParty = sim.ctx.partyOf(match.teams[0][0]);
    expect(teamParty?.members).toContain(spare);
    expect(match.autoPartyPids[0]).toContain(spare);

    expect(logPidsFor(events, joinInProgressLine('Crimson'))).toEqual([spare]);
    // Everyone still in the match hears it except the joiner, who got their own line.
    expect(logPidsFor(events, 'A fresh fighter joins the Crimson.')).toEqual(
      bgAllPids(match)
        .filter((p) => p !== spare)
        .sort((a, b) => a - b),
    );
    expect(pids).toContain(deserter);
  });

  it('detaches a DUNGEON-STANDING backfill at the door, like a start-of-match seat', () => {
    // Post-#3122 the queue hygiene deliberately keeps a player queued through a
    // dungeon pull, so a backfill candidate really can be standing inside an
    // instance. startBgMatch detaches such a fighter and stores the DOOR as
    // their return point; the backfill seat has to do the same, or the match
    // ends by teleporting them back to interior coordinates whose claim may be
    // gone, with the instance still holding their aggro.
    const { sim, match } = staged();
    const deserter = match.teams[0][0];
    const spare = queueSpare(sim);
    enterDungeon(sim.ctx, 'gravewyrm_sanctum', spare);
    const e = sim.entities.get(spare)!;
    expect(e.pos.x, 'the arrangement itself must hold').toBeGreaterThan(DUNGEON_X_THRESHOLD);

    // Put them on a live hate table so the scrub has something to undo.
    const inst = sim.ctx.instances.find((i) => i.partyKey !== null)!;
    const mob = inst.mobIds.map((id) => sim.entities.get(id)).find((m) => m && !m.dead)!;
    addThreat(mob, spare, 500);
    expect(mob.threat.get(spare)).toBe(500);

    bgResolveDesertion(sim.ctx, deserter);
    sim.tick();
    bgRespond(sim.ctx, true, spare); // the seat is an OFFER now
    expect(match.teams[0], 'the arrangement needs the seat actually filled').toContain(spare);

    expect(mob.threat.has(spare), 'the seat must scrub instance threat').toBe(false);
    const ret = match.returns.get(spare)!;
    expect(ret.x, 'the return point must be the door, not the interior').toBeLessThanOrEqual(
      DUNGEON_X_THRESHOLD,
    );
    endBgMatch(sim.ctx, match, 0, 'caps');
    expect(e.pos.x, 'the fighter must not be sent back inside').toBeLessThanOrEqual(
      DUNGEON_X_THRESHOLD,
    );
    expect(e.dead).toBe(false);
  });

  it('leaves the backfilled fighter off the ladder while the rest are scored', () => {
    const { sim, match } = staged();
    const deserter = match.teams[0][0];
    const spare = queueSpare(sim);
    bgResolveDesertion(sim.ctx, deserter);
    sim.tick();
    bgRespond(sim.ctx, true, spare); // the seat is an OFFER now
    expect(match.backfilled.has(spare)).toBe(true);

    const stayer = match.teams[0].find((p) => p !== spare)!;
    const spareBefore = sim.ctx.players.get(spare)!.bgRating;
    const stayerBefore = sim.ctx.players.get(stayer)!.bgRating;
    endBgMatch(sim.ctx, match, 1, 'caps'); // the backfilled side LOSES

    const spareMeta = sim.ctx.players.get(spare)!;
    const stayerMeta = sim.ctx.players.get(stayer)!;
    expect(spareMeta.bgRating).toBe(spareBefore);
    expect(spareMeta.bgLosses).toBe(0);
    // Decisive only against a teammate who really did move: same match, same result.
    expect(stayerMeta.bgRating).toBeLessThan(stayerBefore);
    expect(stayerMeta.bgLosses).toBe(1);
  });

  it('records no DRAW for the backfilled fighter either, only for the rest', () => {
    // The interaction the W-L-D record creates with the unrated seat. A draw is
    // now a counter in its own right, so the ladder gate has to cover it too:
    // counting one here would put a backfilled fighter back on the record by the
    // side door, which is the whole thing the unrated seat promises it will not
    // do. Neither change could see this case on its own.
    const { sim, match } = staged();
    const deserter = match.teams[0][0];
    const spare = queueSpare(sim);
    bgResolveDesertion(sim.ctx, deserter);
    sim.tick();
    bgRespond(sim.ctx, true, spare);
    expect(match.backfilled.has(spare)).toBe(true);

    const stayer = match.teams[0].find((p) => p !== spare)!;
    endBgMatch(sim.ctx, match, null, 'caps'); // a DRAW: no winner

    const spareMeta = sim.ctx.players.get(spare)!;
    const stayerMeta = sim.ctx.players.get(stayer)!;
    expect(spareMeta.bgDraws).toBe(0);
    expect(spareMeta.bgWins).toBe(0);
    expect(spareMeta.bgLosses).toBe(0);
    // Decisive only against a teammate who really did record one: same match,
    // same result, same tick.
    expect(stayerMeta.bgDraws).toBe(1);
  });

  it('ASKS before seating, and an away player never consumes the seat', () => {
    // The reason the seat is an offer rather than a teleport. An away-but-
    // connected player is exactly who the queue-pop prompt exists to catch, and
    // a backfill is worse for them than a fresh pop: a filled side is never
    // offered a backfill again, and a body that never disconnects never
    // deserts, so a seat burned on someone at their desk-but-away could never
    // reopen. There is no idle desertion in a live match to recover it.
    const { sim, match } = staged();
    bgResolveDesertion(sim.ctx, match.teams[0][0]);
    const away = queueSpare(sim);
    sim.tick();

    // Offered, NOT seated.
    expect(bgProposalFor(sim.ctx, away), 'the candidate is holding an offer').toBeTruthy();
    expect(match.teams[0], 'and is not on the field yet').not.toContain(away);
    expect(match.teams[0]).toHaveLength(BG_TEAM_SIZE - 1);

    // Silence for the whole window is a decline, exactly as for a queue pop.
    for (let i = 0; i < 20 * (BG_PROPOSAL_SECONDS + 1); i++) sim.tick();
    expect(match.teams[0], 'silence never seats them').not.toContain(away);
    // Not merely "still exists": the point is the offer lapsed WITHOUT seating
    // them and without leaving a stale offer behind.
    expect(bgProposalFor(sim.ctx, away), 'the lapsed offer is gone').toBeNull();
    expect(sim.ctx.bgMatches.has(away), 'and never put them in the match').toBe(false);
  });

  it('holds ONE offer per match while a candidate is deciding', () => {
    // The seat stays open for the whole answer window, so the pass that reads
    // "this side is short" reads it again on every tick. Without a guard it
    // offers the chair to a second candidate, then a third, draining the queue
    // into competing invitations for one seat (and, found the hard way, slowing
    // the tick to a crawl as the proposals piled up).
    const { sim, match } = staged();
    bgResolveDesertion(sim.ctx, match.teams[0][0]);
    const first = queueSpare(sim);
    const second = queueSpare(sim);
    sim.tick();

    const offered = [first, second].filter((p) => bgProposalFor(sim.ctx, p));
    expect(offered, 'exactly one candidate is asked').toHaveLength(1);

    // Ticking through most of the window must not recruit the other one.
    for (let i = 0; i < 20 * (BG_PROPOSAL_SECONDS - 2); i++) sim.tick();
    expect(
      [first, second].filter((p) => bgProposalFor(sim.ctx, p)),
      'and still only one while they decide',
    ).toHaveLength(1);
    expect(sim.ctx.bgProposals.filter((p) => p.backfill?.match === match)).toHaveLength(1);
  });

  it('does not evict a partial premade friend when the NEXT backfill lands', () => {
    // The deferred half of the same eviction. joinBgTeamParty sweeps members
    // who have left the match so the merge is not refused for capacity, and
    // that sweep used to run over everyone present. On a partial premade the
    // departed friend is sitting in the party legitimately, so the first
    // accepted backfill threw them out: same eviction, later and conditional.
    const sim = makeWorld();
    const leader = sim.addPlayer('warrior', 'Leader');
    tp(sim, leader, 0, -40);
    sim.entities.get(leader)!.level = BG_MIN_LEVEL;
    const friends = [leader];
    for (let i = 0; i < 2; i++) {
      const m = sim.addPlayer('priest', `Friend${i}`);
      tp(sim, m, 0, -40);
      sim.entities.get(m)!.level = BG_MIN_LEVEL;
      sim.partyInvite(m, leader);
      sim.partyAccept(m);
      friends.push(m);
    }
    for (let i = 0; i < 7; i++) {
      const so = sim.addPlayer('rogue', `Solo${i}`);
      tp(sim, so, 0, -40);
      sim.entities.get(so)!.level = BG_MIN_LEVEL;
      sim.bgQueueJoin(so);
    }
    sim.bgQueueJoin(leader);
    sim.tick();
    acceptAllBgOffers(sim);
    const match = sim.bgMatchFor(leader)!;
    const team = match.teams[0].includes(leader) ? 0 : 1;
    toActive(sim, match);

    const deserter = friends[1];
    bgResolveDesertion(sim.ctx, deserter);
    expect(sim.partyOf(leader)!.members, 'the friend is still with their group').toContain(
      deserter,
    );

    // Now land a backfill on that same team, which is what runs the sweep.
    const spare = queueSpare(sim);
    sim.tick();
    if (bgProposalFor(sim.ctx, spare)) bgRespond(sim.ctx, true, spare);

    expect(sim.partyOf(leader)!.members, 'and is STILL with them after a backfill joins').toContain(
      deserter,
    );
    expect(match.teams[team].length + match.teams[1 - team].length).toBeGreaterThan(0);
  });

  it('charges a DECLINE nothing, and never re-asks that match', () => {
    // A queue pop charges a decline the lockout, because the fighter is
    // refusing the thing they queued for. A backfill is not that thing: it is
    // live, unrated, and carries a scoreline they had no part in. Charging the
    // whole wait for saying no to a different offer teaches people to stop
    // answering, and silence is already worse for the team.
    const { sim, match } = staged();
    bgResolveDesertion(sim.ctx, match.teams[0][0]);
    const picky = queueSpare(sim);
    sim.tick();
    expect(bgProposalFor(sim.ctx, picky)).toBeTruthy();

    bgRespond(sim.ctx, false, picky);

    expect(bgRequeueLockedUntil(sim.ctx, picky), 'no lockout for a decline').toBe(0);
    expect(
      sim.ctx.bgQueue.some((g) => g.pids.includes(picky)),
      'and they keep their place in line',
    ).toBe(true);

    // The seat is still open, so the pass runs again: it must not ask the same
    // person forever just because refusing was free.
    for (let i = 0; i < 20 * 3; i++) sim.tick();
    expect(bgProposalFor(sim.ctx, picky), 'this match does not ask them again').toBeNull();
    expect(match.teams[0], 'and they were never seated').not.toContain(picky);
  });

  it('charges SILENCE the lockout, and reopens the seat for the next candidate', () => {
    // The away player this whole prompt exists to catch. Unlike a decline, a
    // lapse costs the lockout, or an idle client would be re-offered the seat
    // every time it reopened and burn it indefinitely.
    const { sim, match } = staged();
    bgResolveDesertion(sim.ctx, match.teams[0][0]);
    const away = queueSpare(sim);
    sim.tick();
    expect(bgProposalFor(sim.ctx, away)).toBeTruthy();

    for (let i = 0; i < 20 * (BG_PROPOSAL_SECONDS + 1); i++) sim.tick();
    expect(bgRequeueLockedUntil(sim.ctx, away), 'silence costs the lockout').toBeGreaterThan(0);

    // ...and the seat is genuinely back on offer after a LAPSE, not only after
    // a decline, which was the arm with no coverage.
    const next = queueSpare(sim);
    sim.tick();
    expect(bgProposalFor(sim.ctx, next), 'the seat reopens for the next candidate').toBeTruthy();
    bgRespond(sim.ctx, true, next);
    expect(match.teams[0]).toContain(next);
  });

  it('gives a WHOLE premade no party seat for its backfill, and keeps them together', () => {
    // The premade arms so far are partial (3+2). A team that queued as one
    // whole five records no auto-added links at all, so the join has nothing to
    // sweep and correctly refuses for capacity rather than inventing a group or
    // evicting one of the five.
    const sim = makeWorld();
    const leader = sim.addPlayer('warrior', 'Cap');
    tp(sim, leader, 0, -40);
    sim.entities.get(leader)!.level = BG_MIN_LEVEL;
    const five = [leader];
    for (let i = 0; i < 4; i++) {
      const m = sim.addPlayer('priest', `Mate${i}`);
      tp(sim, m, 0, -40);
      sim.entities.get(m)!.level = BG_MIN_LEVEL;
      sim.partyInvite(m, leader);
      sim.partyAccept(m);
      five.push(m);
    }
    for (let i = 0; i < 5; i++) {
      const so = sim.addPlayer('rogue', `Sol${i}`);
      tp(sim, so, 0, -40);
      sim.entities.get(so)!.level = BG_MIN_LEVEL;
      sim.bgQueueJoin(so);
    }
    sim.bgQueueJoin(leader);
    // A whole five against five solos is the premade-vs-pugs shape the
    // matchmaker deliberately holds back, so wait it out rather than fighting
    // the fairness rule.
    for (let i = 0; i < 20 * (BG_PREMADE_HOLD + 2) && !sim.bgMatchFor(leader); i++) {
      sim.tick();
      acceptAllBgOffers(sim);
    }
    const match = sim.bgMatchFor(leader)!;
    expect(match, 'the arrangement needs a live match').toBeTruthy();
    const team = match.teams[0].includes(leader) ? 0 : 1;
    expect(match.autoPartyPids[team], 'a whole premade records no auto links').toEqual([]);
    toActive(sim, match);

    const deserter = five[2];
    bgResolveDesertion(sim.ctx, deserter);
    const spare = queueSpare(sim);
    sim.tick();
    if (bgProposalFor(sim.ctx, spare)) bgRespond(sim.ctx, true, spare);

    // The four who stayed still have their own group, with the deserter in it.
    const party = sim.partyOf(leader)!;
    expect(party.members, 'the friends are not broken up').toContain(deserter);
    expect(party.members, 'and the backfill got no seat in their group').not.toContain(spare);
  });

  it('does not seat into a match that ENDED while the offer was open', () => {
    // The blocker the offer design introduced. Teardown is once-only, so a
    // fighter seated after releaseBgFighters has run is in bgMatches with
    // nothing left to take them out: they can neither play nor queue again,
    // and the slot has already been freed for a fresh match on the same field.
    const { sim, match } = staged();
    bgResolveDesertion(sim.ctx, match.teams[0][0]);
    const spare = queueSpare(sim);
    sim.tick();
    expect(bgProposalFor(sim.ctx, spare), 'the offer is live').toBeTruthy();

    endBgMatch(sim.ctx, match, 1, 'caps');
    expect(match.fightersReleased, 'the arrangement really did tear the match down').toBe(true);

    bgRespond(sim.ctx, true, spare); // accept AFTER the end

    expect(sim.ctx.bgMatches.has(spare), 'the joiner is not stranded in a dead match').toBe(false);
    expect(match.teams[0], 'and never joined its roster').not.toContain(spare);
    // ...and it costs them nothing: the seat vanishing is not their fault.
    expect(bgQueueSize(sim.ctx), 'they keep their place in line').toBeGreaterThan(0);
    expect(sim.ctx.bgQueue.some((g) => g.pids.includes(spare))).toBe(true);
  });

  it('re-checks the seat rule at ACCEPT time, not only when the offer opened', () => {
    // Both cutoffs (a match not nearly over, a side not one capture from
    // losing) are read when the offer opens and can be 30 seconds stale by the
    // time it is answered. Here the enemy takes the deciding capture during
    // the window, which is exactly the loss nobody should be dropped into.
    const { sim, match } = staged();
    bgResolveDesertion(sim.ctx, match.teams[0][0]);
    const spare = queueSpare(sim);
    sim.tick();
    expect(bgProposalFor(sim.ctx, spare)).toBeTruthy();

    match.scores = match.scores[0] === undefined ? match.scores : [0, BG_CAPS_TO_WIN - 1];
    bgRespond(sim.ctx, true, spare);

    expect(match.teams[0], 'the seat is refused on the fresh numbers').not.toContain(spare);
    expect(
      sim.ctx.bgQueue.some((g) => g.pids.includes(spare)),
      'and they keep their place',
    ).toBe(true);
  });

  it('offers the seat to the NEXT candidate after one declines', () => {
    // The seat must survive a refusal, or declining would cost the four
    // remaining fighters their backfill entirely.
    const { sim, match } = staged();
    bgResolveDesertion(sim.ctx, match.teams[0][0]);
    const first = queueSpare(sim);
    sim.tick();
    expect(bgProposalFor(sim.ctx, first)).toBeTruthy();

    bgRespond(sim.ctx, false, first); // decline
    expect(match.teams[0], 'declining seats nobody').not.toContain(first);

    const second = queueSpare(sim);
    sim.tick();
    bgRespond(sim.ctx, true, second);
    expect(match.teams[0], 'the seat went to the next candidate').toContain(second);
    expect(match.teams[0]).toHaveLength(BG_TEAM_SIZE);
  });

  it('never frees the live match slot when a backfill offer lapses', () => {
    // A backfill offer reserves no slot: the match it fills is already standing
    // on one. Releasing it on teardown would hand a LIVE field to the matchmaker.
    const { sim, match } = staged();
    bgResolveDesertion(sim.ctx, match.teams[0][0]);
    const away = queueSpare(sim);
    sim.tick();
    expect(sim.ctx.bgBusySlots.has(match.slot), 'the match holds its slot').toBe(true);

    for (let i = 0; i < 20 * (BG_PROPOSAL_SECONDS + 1); i++) sim.tick();
    expect(sim.ctx.bgBusySlots.has(match.slot), 'and still holds it after the offer lapses').toBe(
      true,
    );
    expect(sim.ctx.bgMatches.has(away), 'and never seated the candidate').toBe(false);
  });

  it('charges a backfilled fighter nothing if they leave too', () => {
    const { sim, match } = staged();
    bgResolveDesertion(sim.ctx, match.teams[0][0]);
    const spare = queueSpare(sim);
    sim.tick();
    bgRespond(sim.ctx, true, spare); // the seat is an OFFER now
    expect(match.backfilled.has(spare)).toBe(true);

    const before = sim.ctx.players.get(spare)!.bgRating;
    bgResolveDesertion(sim.ctx, spare);
    expect(sim.ctx.players.get(spare)!.bgRating).toBe(before);
    expect(sim.ctx.players.get(spare)!.bgLosses).toBe(0);
  });

  it('refuses the seat once the short side is one capture from losing', () => {
    const { sim, match } = staged();
    bgResolveDesertion(sim.ctx, match.teams[0][0]);
    const spare = queueSpare(sim);
    match.scores[1] = BG_CAPS_TO_WIN - 1;

    sim.tick();
    expect(match.teams[0]).toHaveLength(BG_TEAM_SIZE - 1);
    expect(sim.ctx.bgMatches.has(spare)).toBe(false);
    // Still queued, not silently dropped: the match refused them, nothing else.
    expect(bgQueueSize(sim.ctx)).toBe(1);
  });

  it('never breaks up a queued pair to fill one seat', () => {
    const { sim, match } = staged();
    bgResolveDesertion(sim.ctx, match.teams[0][0]);
    const a = sim.addPlayer('warrior', 'PairA');
    const b = sim.addPlayer('priest', 'PairB');
    for (const pid of [a, b]) {
      tp(sim, pid, 8, -40);
      sim.entities.get(pid)!.level = 20;
    }
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    sim.bgQueueJoin(a);

    sim.tick();
    expect(match.teams[0]).toHaveLength(BG_TEAM_SIZE - 1);
    expect(sim.ctx.bgMatches.has(a)).toBe(false);
    expect(sim.ctx.bgMatches.has(b)).toBe(false);
  });
});

describe('Thornhollow Fields: a drawn match is recorded, not swallowed', () => {
  // A draw moved the ladder (eloDelta at score 0.5) but incremented no counter,
  // so the match vanished from the player's record entirely: someone with one
  // win and one draw read "1-0". It is now the third figure of W-L-D.
  it('counts a draw for every fighter and leaves wins and losses alone', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.ctx.bgMatches.get(pids[0])!;
    toActive(sim, match);
    const fighter = match.teams[0][0];
    const before = sim.ctx.players.get(fighter)!;
    expect(before.bgDraws).toBe(0);

    endBgMatch(sim.ctx, match, null, 'timeout'); // null winner = drawn

    for (const pid of pids) {
      const meta = sim.ctx.players.get(pid)!;
      expect(meta.bgDraws).toBe(1);
      // Decisive against the old behavior, which would have moved neither and
      // against a naive fix that counts a draw as a loss for one side.
      expect(meta.bgWins).toBe(0);
      expect(meta.bgLosses).toBe(0);
    }
  });

  it('surfaces the draw on the readout the record is rendered from', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.ctx.bgMatches.get(pids[0])!;
    toActive(sim, match);
    endBgMatch(sim.ctx, match, null, 'timeout');
    expect(sim.bgInfoFor(pids[0], [])!.draws).toBe(1);
  });

  it('persists the draw across a save and load', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.ctx.bgMatches.get(pids[0])!;
    toActive(sim, match);
    endBgMatch(sim.ctx, match, null, 'timeout');

    const state = sim.serializeCharacter(pids[0]);
    if (!state) throw new Error('failed to serialize the fighter');
    const restored = makeWorld();
    const reloaded = restored.addPlayer('warrior', 'Reloaded', { state });
    expect(restored.ctx.players.get(reloaded)!.bgDraws).toBe(1);
  });

  it('writes no draws field for a character who has never drawn', () => {
    // The saves of every existing character must stay byte-equal, which is the
    // parity-stable rule the battleground block already followed.
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Fresh');
    const state = sim.serializeCharacter(pid) as unknown as Record<string, unknown>;
    expect(state.bgDraws).toBeUndefined();
    expect(state.arena1v1Draws).toBeUndefined();
  });

  it('writes no draws field for a character with a record but no draw', () => {
    // The case above uses a FRESH character, whose battleground block is not
    // written at all, so it proves the outer gate rather than the conditional
    // spread inside it. This one has a real record, which is the population the
    // byte-equal promise actually matters for: their saves must not gain a key.
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Veteran');
    const meta = sim.ctx.players.get(pid)!;
    meta.bgWins = 1;
    meta.bgDraws = 0;
    meta.arenaWins = 1;
    meta.arenaDraws = 0;

    const state = sim.serializeCharacter(pid) as unknown as Record<string, unknown>;
    expect(state.bgWins, 'the arrangement really did write the block').toBe(1);
    expect(state.bgDraws, 'a zero draw count adds no key').toBeUndefined();
    expect(state.arena1v1Draws).toBeUndefined();
  });
});

describe('Thornhollow Fields: talents are the fighter own to change', () => {
  // A queue pop can catch a player in a farming build, and the match is rated,
  // so being seated in the wrong spec costs rating with no counterplay. Gear
  // was already swappable in here (equipItem carries no match gate at all), so
  // the talent block was the one half of a build a fighter could not fix.
  // Combat is still the line: the refusal moves from "during a battleground"
  // to the same in-combat rule that governs the open world.
  const seatedFighter = (): { sim: Sim; match: BgMatch; pid: number } => {
    const { sim, pids } = tenInQueue();
    const match = sim.ctx.bgMatches.get(pids[0])!;
    toActive(sim, match);
    return { sim, match, pid: pids[0] };
  };

  it('lets a fighter respec inside a live match while out of combat', () => {
    const { sim, match, pid } = seatedFighter();
    expect(match.state).toBe('active');
    expect(sim.ctx.bgMatches.has(pid)).toBe(true);
    const fighter = sim.entities.get(pid)!;
    fighter.inCombat = false;

    expect(sim.setSpec('fury', pid)).toBe(true);
    expect(sim.ctx.players.get(pid)!.talents.spec).toBe('fury');
    expect(sim.selectTalentRow(5, 'war_row_double_charge', pid)).toBe(true);
    expect(sim.ctx.players.get(pid)!.talents.rows[5]).toBe('war_row_double_charge');
    expect(sim.respec(pid)).toBe(true);
    expect(sim.ctx.players.get(pid)!.talents.rows[5]).toBeUndefined();
  });

  it('still refuses a respec in combat, and says so without naming the battleground', () => {
    const { sim, pid } = seatedFighter();
    const fighter = sim.entities.get(pid)!;
    fighter.inCombat = true;

    const before = sim.ctx.players.get(pid)!.talents.spec;
    expect(sim.setSpec('fury', pid)).toBe(false);
    expect(sim.respec(pid)).toBe(false);
    expect(sim.ctx.players.get(pid)!.talents.spec).toBe(before);
    // The refusal a fighter now sees is the plain combat rule. The old
    // battleground-specific line is gone from the emit surface entirely, which
    // is why its matcher entry is deleted in the same change.
    const texts = errorTexts(sim.tick());
    expect(texts).toContain('You cannot change talents in combat.');
    expect(texts).not.toContain('You cannot change talents during a battleground.');
  });

  it('leaves the arena lock alone', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'ArenaA');
    sim.entities.get(a)!.level = 20;
    sim.entities.get(a)!.inCombat = false;
    // Out of combat and out of any match, the same calls go through: that is
    // what makes the refusals below attributable to the arena entry alone.
    expect(sim.setSpec('fury', a)).toBe(true);
    expect(sim.respec(a)).toBe(true);

    // talentLockReason only asks arenaMatches.has(), so the membership is the
    // whole fixture; a full ArenaMatch would drag updateArena into the assert.
    sim.ctx.arenaMatches.set(a, {} as never);
    expect(sim.setSpec('arms', a)).toBe(false);
    expect(sim.respec(a)).toBe(false);
    expect(sim.ctx.players.get(a)!.talents.spec).toBe('fury');
  });
});
