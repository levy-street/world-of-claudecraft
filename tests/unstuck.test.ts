import { afterEach, describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, DELVES, INSTANCE_X_BASE, setActiveWorldContent } from '../src/sim/data';
import { delveModuleEntry } from '../src/sim/delves/runs';
import { DUNGEON_WALL_X } from '../src/sim/dungeon_layout';
import { swimSurfaceY } from '../src/sim/player_motion';
import {
  RES_SICKNESS_STAT_MULT,
  RESURRECTION_SICKNESS_ID,
  UNSTUCK_SICKNESS_DURATION,
  UNSTUCK_SICKNESS_ID,
  unstuckSicknessDuration,
} from '../src/sim/resurrection';
import { Sim } from '../src/sim/sim';
import {
  applyResurrectionSickness,
  moveToGraveyardForUnstuck,
  nearestOverworldGraveyard,
  RES_HEALER_HP_FRACTION,
} from '../src/sim/spirit';
import { type BlockerDef, MAX_LEVEL, type SimEvent, type WorldContent } from '../src/sim/types';
import {
  UNSTUCK_COOLDOWN_ID,
  UNSTUCK_COUNTDOWN_SECONDS,
  UNSTUCK_RETRY_SECONDS,
  UNSTUCK_SUCCESS_COOLDOWN_SECONDS,
  unstuckLocationAt,
} from '../src/sim/unstuck';

type Event = Extract<SimEvent, { type: 'unstuck' }>;

const SEED = 42;
const START = { x: 0, z: -40 };
const WEDGE_WALL_Z = START.z + 0.4;
// A deep point inside Mirror Lake where the normal swim kernel can move.
// The lake's southeast rim shallowed when the respaced wolf camp's flatten
// apron reached it (PR #2584), so the point sits in the deep western core.
const WATER_TRAP = { x: -90, z: 91 };

function required<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(`Expected ${label}`);
  return value;
}

function makeWorld(blockers: BlockerDef[] = []): Sim {
  // A fresh content object keeps the collider cache isolated between tests.
  const world: WorldContent = {
    ...BUILTIN_WORLD,
    camps: [],
    npcs: {},
    groundObjects: [],
    blockers,
  };
  setActiveWorldContent(world);
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true, world });
  const pid = sim.addPlayer('warrior', 'Wayfinder');
  const p = required(sim.entities.get(pid), 'newly added player');
  p.pos = sim.groundPos(START.x, START.z);
  p.prevPos = { ...p.pos };
  p.vx = 0;
  p.vy = 0;
  p.vz = 0;
  p.onGround = true;
  p.jumping = false;
  p.combatTimer = 999;
  p.inCombat = false;
  sim.grid.update(p);
  sim.playerGrid.update(p);
  sim.drainEvents();
  return sim;
}

function makeWedgedWorld(): Sim {
  return makeWorld([{ x1: -10, z1: WEDGE_WALL_Z, x2: 10, z2: WEDGE_WALL_Z }]);
}

function placeInWaterTrap(sim: Sim): void {
  const p = sim.player;
  p.pos = {
    x: WATER_TRAP.x,
    y: swimSurfaceY(WATER_TRAP.x, WATER_TRAP.z, SEED),
    z: WATER_TRAP.z,
  };
  p.prevPos = { ...p.pos };
  p.vx = 0;
  p.vy = 0;
  p.vz = 0;
  p.onGround = true;
  p.jumping = false;
  sim.grid.update(p);
  sim.playerGrid.update(p);
}

function eventsOf(events: SimEvent[]): Event[] {
  return events.filter((event): event is Event => event.type === 'unstuck');
}

function tickMany(sim: Sim, count: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < count; i++) events.push(...sim.tick());
  return events;
}

function accepted(sim: Sim): {
  pid: number;
  player: Sim['player'];
  meta: NonNullable<ReturnType<Sim['meta']>>;
} {
  const pid = sim.player.id;
  const player = required(sim.entities.get(pid), 'primary player');
  const meta = required(sim.meta(pid), 'primary player metadata');
  expect(sim.unstuck(pid)).toBe(true);
  expect(eventsOf(sim.drainEvents())).toContainEqual({
    type: 'unstuck',
    phase: 'started',
    seconds: UNSTUCK_COUNTDOWN_SECONDS,
    pid,
  });
  return { pid, player, meta };
}

afterEach(() => {
  setActiveWorldContent(null);
});

describe('unstuck countdown and cancellation', () => {
  it('accepts an idle player, announces the countdown, and waits the full ten seconds', () => {
    const sim = makeWedgedWorld();
    const { player, meta } = accepted(sim);
    const origin = { ...player.pos };

    expect(meta.pendingUnstuck).toMatchObject({
      startedAt: 0,
      endsAt: UNSTUCK_COUNTDOWN_SECONDS,
      origin: { x: origin.x, y: origin.y, z: origin.z },
      lastAnnouncedSecond: UNSTUCK_COUNTDOWN_SECONDS,
    });
    expect(player.cooldowns.get(UNSTUCK_COOLDOWN_ID)).toBe(UNSTUCK_RETRY_SECONDS);

    const beforeCompletion = tickMany(sim, UNSTUCK_COUNTDOWN_SECONDS * 20 - 1);
    expect(meta.pendingUnstuck).not.toBeNull();
    expect(player.pos).toEqual(origin);
    expect(eventsOf(beforeCompletion).some((event) => event.phase === 'completed')).toBe(false);
    expect(
      eventsOf(beforeCompletion).some(
        (event) => event.phase === 'countdown' && event.seconds === 1,
      ),
    ).toBe(true);

    const completion = eventsOf(sim.tick()).find((event) => event.phase === 'completed');
    expect(completion?.phase).toBe('completed');
    expect(meta.pendingUnstuck).toBeNull();
  });

  it('cancels when movement input is applied', () => {
    const sim = makeWedgedWorld();
    const { meta } = accepted(sim);
    meta.moveInput.forward = true;

    const events = eventsOf(sim.tick());
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'unstuck', phase: 'cancelled', reason: 'moved' }),
    );
    expect(meta.pendingUnstuck).toBeNull();
  });

  it('cancels when the player takes damage during the countdown', () => {
    const sim = makeWedgedWorld();
    const { player, meta } = accepted(sim);

    sim.ctx.dealDamage(null, player, 1, false, 'physical', null, 'hit');
    const events = eventsOf(sim.tick());
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'unstuck', phase: 'cancelled', reason: 'damaged' }),
    );
    expect(meta.pendingUnstuck).toBeNull();
  });

  it('cancels when combat begins during the countdown', () => {
    const sim = makeWedgedWorld();
    const { player, meta } = accepted(sim);
    player.inCombat = true;
    player.combatTimer = 0;

    const events = eventsOf(sim.tick());
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'unstuck', phase: 'cancelled', reason: 'combat' }),
    );
    expect(meta.pendingUnstuck).toBeNull();
  });

  it('returns one disconnected terminal event and preserves the retry cooldown', () => {
    const sim = makeWedgedWorld();
    const { pid, meta } = accepted(sim);

    expect(sim.cancelUnstuckForDisconnect(pid)).toMatchObject({
      type: 'unstuck',
      phase: 'cancelled',
      reason: 'disconnected',
      pid,
    });
    expect(meta.pendingUnstuck).toBeNull();
    expect(
      required(sim.serializeCharacter(pid), 'cancelled character state').cooldowns?.abilities?.[
        UNSTUCK_COOLDOWN_ID
      ],
    ).toBe(UNSTUCK_RETRY_SECONDS);
    expect(sim.cancelUnstuckForDisconnect(pid)).toBeNull();
    expect(eventsOf(sim.drainEvents())).toHaveLength(1);

    sim.removePlayer(pid);
    expect(eventsOf(sim.drainEvents())).toEqual([]);
  });

  it('emits one disconnected terminal event when an offline host removes the player', () => {
    const sim = makeWedgedWorld();
    const { pid, meta, player } = accepted(sim);

    sim.removePlayer(pid);

    expect(meta.pendingUnstuck).toBeNull();
    expect(player.cooldowns.get(UNSTUCK_COOLDOWN_ID)).toBe(UNSTUCK_RETRY_SECONDS);
    expect(eventsOf(sim.drainEvents())).toEqual([
      expect.objectContaining({
        type: 'unstuck',
        phase: 'cancelled',
        reason: 'disconnected',
        pid,
      }),
    ]);
    sim.removePlayer(pid);
    expect(eventsOf(sim.drainEvents())).toEqual([]);
  });

  it('rejects a retry while the short cooldown remains', () => {
    const sim = makeWedgedWorld();
    const { player, meta, pid } = accepted(sim);
    meta.moveInput.forward = true;
    sim.tick();
    meta.moveInput.forward = false;

    expect(sim.unstuck(pid)).toBe(false);
    expect(eventsOf(sim.drainEvents())).toContainEqual({
      type: 'unstuck',
      phase: 'blocked',
      reason: 'cooldown',
      seconds: Math.ceil(required(player.cooldowns.get(UNSTUCK_COOLDOWN_ID), 'unstuck cooldown')),
      pid,
    });
  });

  it('persists the anti-relog cooldown while discarding the runtime countdown', () => {
    const sim = makeWedgedWorld();
    const { pid } = accepted(sim);
    const state = required(sim.serializeCharacter(pid), 'serialized character');

    const restored = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const restoredPid = restored.addPlayer('warrior', 'Wayfinder', { state });
    const restoredPlayer = required(restored.entities.get(restoredPid), 'restored player');
    const restoredMeta = required(restored.meta(restoredPid), 'restored player metadata');

    expect(restoredMeta.pendingUnstuck).toBeNull();
    expect(restoredPlayer.cooldowns.get(UNSTUCK_COOLDOWN_ID)).toBe(UNSTUCK_RETRY_SECONDS);
    expect(restored.unstuck(restoredPid)).toBe(false);
    expect(eventsOf(restored.drainEvents())).toContainEqual({
      type: 'unstuck',
      phase: 'blocked',
      reason: 'cooldown',
      seconds: UNSTUCK_RETRY_SECONDS,
      pid: restoredPid,
    });
  });

  it('keeps the hidden cooldown through Vale Cup practice reset and a relog', () => {
    const sim = makeWedgedWorld();
    const { pid, player } = accepted(sim);

    sim.chat('/cooldowns', pid);
    const readout = sim
      .drainEvents()
      .find((event): event is Extract<SimEvent, { type: 'error' }> => event.type === 'error');
    expect(readout?.text).toBe('No abilities are on cooldown.');
    expect(readout?.text).not.toContain(UNSTUCK_COOLDOWN_ID);

    sim.vcupPracticeStart(1, pid);
    expect(sim.vcup.practices).toHaveLength(1);
    const afterPracticeReset = required(
      player.cooldowns.get(UNSTUCK_COOLDOWN_ID),
      'practice-preserved unstuck cooldown',
    );
    expect(afterPracticeReset).toBe(UNSTUCK_RETRY_SECONDS);

    const state = required(sim.serializeCharacter(pid), 'practice character state');
    const restored = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const restoredPid = restored.addPlayer('warrior', 'Wayfinder', { state });
    const restoredPlayer = required(restored.entities.get(restoredPid), 'restored practice player');
    expect(restoredPlayer.cooldowns.get(UNSTUCK_COOLDOWN_ID)).toBe(afterPracticeReset);

    restored.drainEvents();
    restored.chat('/cooldowns', restoredPid);
    const restoredReadout = restored
      .drainEvents()
      .find((event): event is Extract<SimEvent, { type: 'error' }> => event.type === 'error');
    expect(restoredReadout?.text).toBe('No abilities are on cooldown.');
    expect(restored.unstuck(restoredPid)).toBe(false);
  });

  it('routes offline slash use exactly like the direct action without chat or away mutations', () => {
    const direct = makeWedgedWorld();
    const slash = makeWedgedWorld();
    const directPid = direct.player.id;
    const slashPid = slash.player.id;
    const slashMeta = required(slash.meta(slashPid), 'slash player metadata');
    slashMeta.away = { mode: 'dnd', message: 'Testing recovery' };
    slash.ctx.chatTokens.set(slashPid, { tokens: 0, at: slash.time });

    expect(direct.unstuck(directPid)).toBe(true);
    expect(slash.chat('  /UnStUcK  ', slashPid)).toBeNull();

    expect(slashMeta.away).toEqual({ mode: 'dnd', message: 'Testing recovery' });
    expect(slash.ctx.chatTokens.get(slashPid)).toEqual({ tokens: 0, at: slash.time });
    expect(slash.player.cooldowns).toEqual(direct.player.cooldowns);
    expect(slashMeta.pendingUnstuck).toEqual(
      required(direct.meta(directPid), 'direct metadata').pendingUnstuck,
    );
    expect(slash.drainEvents()).toEqual(direct.drainEvents());
  });
});

describe('unstuck graveyard move while alive', () => {
  function runCompletion(level = 10): {
    sim: Sim;
    player: Sim['player'];
    event: Extract<Event, { phase: 'completed' }>;
  } {
    const sim = makeWorld();
    sim.setPlayerLevel(level);
    const { player } = accepted(sim);
    const events = eventsOf(tickMany(sim, UNSTUCK_COUNTDOWN_SECONDS * 20));
    const event = events.find(
      (candidate): candidate is Extract<Event, { phase: 'completed' }> =>
        candidate.phase === 'completed',
    );
    expect(event).toBeDefined();
    expect(player.cooldowns.get(UNSTUCK_COOLDOWN_ID)).toBe(UNSTUCK_SUCCESS_COOLDOWN_SECONDS);
    return { sim, player, event: required(event, 'completed event') };
  }

  it('moves a living player to the nearest graveyard without killing them', () => {
    const { sim, player, event } = runCompletion();
    const graveyard = nearestOverworldGraveyard(START.x, START.z);

    expect(event.reason).toBe('moved_to_graveyard');
    expect(event.destination).toMatchObject(graveyard);
    expect(player.pos).toMatchObject(graveyard);
    expect(player.prevPos).toEqual(player.pos);
    expect(player.dead).toBe(false);
    expect(player.ghost).toBe(false);
    expect(player.corpsePos).toBeNull();
    expect(player.hp).toBeGreaterThan(0);
    // No death happened, so nothing may reach the death bookkeeping.
    expect(required(sim.meta(player.id), 'player metadata').counters.deaths).toBe(0);
    // Nor may the death loop offer itself: there is no corpse and no spirit to release.
    sim.releaseSpirit();
    expect(player.ghost).toBe(false);
  });

  it('charges Unstuck Sickness rather than The Keeper’s Toll, and clears momentum', () => {
    const { player } = runCompletion();

    expect(player.auras.some((aura) => aura.id === RESURRECTION_SICKNESS_ID)).toBe(false);
    const sickness = required(
      player.auras.find((aura) => aura.id === UNSTUCK_SICKNESS_ID),
      'unstuck sickness aura',
    );
    expect(sickness.kind).toBe('buff_allstats_pct');
    expect(sickness.value).toBe(RES_SICKNESS_STAT_MULT);
    expect(sickness.remaining).toBe(unstuckSicknessDuration(player.level));
    expect([player.vx, player.vy, player.vz]).toEqual([0, 0, 0]);
    expect(player.targetId).toBeNull();
    expect(player.autoAttack).toBe(false);
  });

  it('caps the sickness at five minutes and exempts characters below level 10', () => {
    const { player: capped } = runCompletion(MAX_LEVEL);
    expect(
      required(
        capped.auras.find((aura) => aura.id === UNSTUCK_SICKNESS_ID),
        'max-level unstuck sickness',
      ).duration,
    ).toBe(UNSTUCK_SICKNESS_DURATION);
    expect(UNSTUCK_SICKNESS_DURATION).toBe(5 * 60);

    const { player: exempt } = runCompletion(9);
    expect(exempt.auras.some((aura) => aura.id === UNSTUCK_SICKNESS_ID)).toBe(false);
    expect(exempt.dead).toBe(false);
  });

  it('never stacks a second whole-stat drain on top of The Keeper’s Toll', () => {
    const sim = makeWorld();
    sim.setPlayerLevel(MAX_LEVEL);
    const { player } = accepted(sim);
    applyResurrectionSickness(sim.ctx, player);
    const drained = player.stats.str;
    expect(drained).toBeGreaterThan(0);

    tickMany(sim, UNSTUCK_COUNTDOWN_SECONDS * 20);

    // The Toll is displaced rather than compounded: two -75% drains would leave
    // strength at a sixteenth of the base block instead of a quarter.
    expect(player.auras.filter((aura) => aura.kind === 'buff_allstats_pct')).toHaveLength(1);
    expect(player.auras.some((aura) => aura.id === RESURRECTION_SICKNESS_ID)).toBe(false);
    expect(player.auras.some((aura) => aura.id === UNSTUCK_SICKNESS_ID)).toBe(true);
    expect(player.stats.str).toBe(drained);
  });

  it('logs the displaced Keeper’s Toll fading, which no snapshot would reveal', () => {
    const sim = makeWorld();
    sim.setPlayerLevel(MAX_LEVEL);
    const { player } = accepted(sim);
    applyResurrectionSickness(sim.ctx, player);
    sim.drainEvents();

    const auraEvents = tickMany(sim, UNSTUCK_COUNTDOWN_SECONDS * 20).filter(
      (event): event is Extract<SimEvent, { type: 'aura' }> => event.type === 'aura',
    );

    // objectContaining: fade sites may gain attribution fields over time and
    // this assertion cares only about the fade itself.
    expect(auraEvents).toContainEqual(
      expect.objectContaining({
        type: 'aura',
        targetId: player.id,
        name: 'Resurrection Sickness',
        gained: false,
      }),
    );
    expect(auraEvents).toContainEqual(
      expect.objectContaining({ name: 'Unstuck Sickness', gained: true }),
    );
  });

  it('uses the same graveyard move for an idle swimmer', () => {
    const sim = makeWorld();
    sim.setPlayerLevel(10);
    placeInWaterTrap(sim);
    const player = sim.player;
    const graveyard = nearestOverworldGraveyard(WATER_TRAP.x, WATER_TRAP.z);

    expect(sim.ctx.isSwimming(player)).toBe(true);
    expect(sim.unstuck(player.id)).toBe(true);
    sim.drainEvents();
    const completed = eventsOf(tickMany(sim, UNSTUCK_COUNTDOWN_SECONDS * 20)).find(
      (event): event is Extract<Event, { phase: 'completed' }> => event.phase === 'completed',
    );

    expect(completed?.reason).toBe('moved_to_graveyard');
    expect(player.pos).toMatchObject(graveyard);
    expect(player.dead).toBe(false);
    expect(player.ghost).toBe(false);
    expect(player.corpsePos).toBeNull();
  });

  it('returns a delve player to the graveyard nearest the delve entrance, still alive', () => {
    const sim = makeWorld();
    const pid = sim.player.id;
    const delve = DELVES.collapsed_reliquary;
    sim.setPlayerLevel(delve.minLevel, pid);
    sim.enterDelve(delve.id, 'normal', pid);
    const graveyard = nearestOverworldGraveyard(delve.doorPos.x, delve.doorPos.z);

    expect(sim.unstuck(pid)).toBe(true);
    sim.drainEvents();
    tickMany(sim, UNSTUCK_COUNTDOWN_SECONDS * 20);

    expect(sim.player.pos).toMatchObject(graveyard);
    expect(sim.player.dead).toBe(false);
    expect(sim.player.ghost).toBe(false);
    expect(sim.player.corpsePos).toBeNull();
  });

  it('settles the landing like a portal teleport, so a stale jump arc cannot deal fall damage', () => {
    const sim = makeWorld();
    // Below the sickness floor, so the hp math stays untouched by the aura.
    sim.setPlayerLevel(9);
    const player = sim.player;
    // Emulate the state the countdown gates currently forbid (a mid-air invoker with a
    // high fall origin): the settle contract must hold on its own, not lean on the gates.
    player.jumping = true;
    player.onGround = false;
    player.fallStartY = player.pos.y + 100;

    moveToGraveyardForUnstuck(sim.ctx, player.id);

    const graveyard = nearestOverworldGraveyard(START.x, START.z);
    expect(player.pos).toMatchObject(graveyard);
    expect(player.jumping).toBe(false);
    expect(player.onGround).toBe(true);
    expect(player.fallStartY).toBe(player.pos.y);

    const hpBefore = player.hp;
    tickMany(sim, 20);
    expect(player.hp).toBe(hpBefore);
    expect(player.onGround).toBe(true);
  });

  it("swaps Unstuck Sickness for The Keeper's Toll at a Spirit Healer, never stacking them", () => {
    const { sim, player } = runCompletion(MAX_LEVEL);
    const drained = player.stats.str;
    expect(player.auras.some((aura) => aura.id === UNSTUCK_SICKNESS_ID)).toBe(true);

    sim.ctx.dealDamage(null, player, player.maxHp * 10, false, 'physical', null, 'hit');
    expect(player.dead).toBe(true);
    sim.releaseSpirit();
    expect(player.ghost).toBe(true);
    // Dying sheds nothing: the unstuck drain survives to the healer.
    expect(player.auras.some((aura) => aura.id === UNSTUCK_SICKNESS_ID)).toBe(true);

    sim.resurrectAtSpiritHealer();
    expect(player.dead).toBe(false);

    // The healer's Toll displaces the Unstuck drain rather than compounding with it:
    // strength stays at the quarter either drain produces alone, not a sixteenth.
    expect(player.auras.filter((aura) => aura.kind === 'buff_allstats_pct')).toHaveLength(1);
    expect(player.auras.some((aura) => aura.id === RESURRECTION_SICKNESS_ID)).toBe(true);
    expect(player.auras.some((aura) => aura.id === UNSTUCK_SICKNESS_ID)).toBe(false);
    expect(player.stats.str).toBe(drained);
  });

  it('resumes the sickness with its saved remaining after a relog', () => {
    const { sim, player } = runCompletion(MAX_LEVEL);
    tickMany(sim, 40); // burn two seconds off the debuff
    const remaining = required(
      player.auras.find((aura) => aura.id === UNSTUCK_SICKNESS_ID),
      'unstuck sickness aura',
    ).remaining;
    expect(remaining).toBeLessThan(UNSTUCK_SICKNESS_DURATION);
    const state = required(sim.serializeCharacter(player.id), 'serialized character');
    expect(state.unstuckSickness).toBe(remaining);

    const restored = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const restoredPid = restored.addPlayer('warrior', 'Wayfinder', { state });
    const restoredPlayer = required(restored.entities.get(restoredPid), 'restored player');

    expect(
      required(
        restoredPlayer.auras.find((aura) => aura.id === UNSTUCK_SICKNESS_ID),
        'restored unstuck sickness',
      ).remaining,
    ).toBe(remaining);
    expect(restoredPlayer.hp).toBeLessThanOrEqual(restoredPlayer.maxHp);
  });
});

describe('unstuck while dead', () => {
  // Kill the player outright. A sourceless killing blow starts no combat, so the
  // body lands out of combat and the combat gate is exercised on its own below.
  function killed(sim: Sim): Sim['player'] {
    const p = sim.player;
    sim.ctx.dealDamage(null, p, p.maxHp * 10, false, 'physical', null, 'hit');
    expect(p.dead).toBe(true);
    sim.drainEvents();
    return p;
  }

  function completionOf(sim: Sim): Extract<Event, { phase: 'completed' }> | undefined {
    return eventsOf(tickMany(sim, UNSTUCK_COUNTDOWN_SECONDS * 20)).find(
      (event): event is Extract<Event, { phase: 'completed' }> => event.phase === 'completed',
    );
  }

  it('revives an unreleased body at the nearest graveyard under Unstuck Sickness', () => {
    const sim = makeWorld();
    sim.setPlayerLevel(10);
    const player = killed(sim);
    const graveyard = nearestOverworldGraveyard(START.x, START.z);
    expect(player.ghost).toBe(false);

    expect(sim.unstuck(player.id)).toBe(true);
    sim.drainEvents();
    const completed = completionOf(sim);

    expect(completed?.reason).toBe('revived_at_graveyard');
    expect(completed?.destination).toMatchObject(graveyard);
    expect(player.pos).toMatchObject(graveyard);
    expect(player.prevPos).toEqual(player.pos);
    expect(player.dead).toBe(false);
    expect(player.ghost).toBe(false);
    expect(player.corpsePos).toBeNull();
    expect(player.auras.some((aura) => aura.id === UNSTUCK_SICKNESS_ID)).toBe(true);
    expect(player.auras.some((aura) => aura.id === RESURRECTION_SICKNESS_ID)).toBe(false);
    expect(player.hp).toBe(Math.max(1, Math.round(player.maxHp * RES_HEALER_HP_FRACTION)));
    expect(player.cooldowns.get(UNSTUCK_COOLDOWN_ID)).toBe(UNSTUCK_SUCCESS_COOLDOWN_SECONDS);
  });

  it('emits a respawn event so a mirroring client leaves the ghost UI', () => {
    const sim = makeWorld();
    sim.setPlayerLevel(10);
    const player = killed(sim);

    expect(sim.unstuck(player.id)).toBe(true);
    sim.drainEvents();
    const events = tickMany(sim, UNSTUCK_COUNTDOWN_SECONDS * 20);

    expect(events).toContainEqual({ type: 'respawn', pid: player.id });
  });

  it('revives a released ghost that cannot reach its corpse or a Pale Keeper', () => {
    const sim = makeWorld();
    sim.setPlayerLevel(10);
    const player = killed(sim);
    sim.releaseSpirit();
    sim.drainEvents();
    expect(player.ghost).toBe(true);
    const graveyard = nearestOverworldGraveyard(player.pos.x, player.pos.z);

    expect(sim.unstuck(player.id)).toBe(true);
    sim.drainEvents();
    const completed = completionOf(sim);

    expect(completed?.reason).toBe('revived_at_graveyard');
    expect(player.pos).toMatchObject(graveyard);
    expect(player.dead).toBe(false);
    expect(player.ghost).toBe(false);
    expect(player.corpsePos).toBeNull();
    expect(player.auras.some((aura) => aura.id === UNSTUCK_SICKNESS_ID)).toBe(true);
  });

  it('accepts a body frozen mid-fall, whose physics fields never tick again', () => {
    const sim = makeWorld();
    const player = killed(sim);
    player.onGround = false;
    player.jumping = true;
    player.vy = -12;

    // The tick runs no movement for a dead, unreleased body, so these stay set
    // forever: gating on them would strand exactly the player Unstuck is for.
    tickMany(sim, 20);
    expect(player.onGround).toBe(false);
    expect(player.vy).toBe(-12);

    expect(sim.unstuck(player.id)).toBe(true);
    sim.drainEvents();
    expect(completionOf(sim)?.reason).toBe('revived_at_graveyard');

    // The whole point of rescuing this body is that it stops falling. The stale mid-fall
    // velocity must not carry into the revive and drop the player through the graveyard.
    const graveyard = nearestOverworldGraveyard(START.x, START.z);
    const landed = { ...player.pos };
    tickMany(sim, 20);
    expect(player.pos).toMatchObject(graveyard);
    expect(player.pos.y).toBeCloseTo(landed.y, 5);
    expect(player.onGround).toBe(true);
  });

  it('still blocks a body that died in combat until the five seconds elapse', () => {
    const sim = makeWorld();
    const player = killed(sim);
    player.inCombat = true;
    player.combatTimer = 0;

    expect(sim.unstuck(player.id)).toBe(false);
    expect(eventsOf(sim.drainEvents())).toContainEqual(
      expect.objectContaining({ type: 'unstuck', phase: 'blocked', reason: 'combat' }),
    );

    // updateTimers runs for the dead too, so the corpse leaves combat normally.
    tickMany(sim, 6 * 20);
    sim.drainEvents();
    expect(player.inCombat).toBe(false);
    expect(sim.unstuck(player.id)).toBe(true);
  });

  it('cancels when the body is resurrected during the countdown', () => {
    const sim = makeWorld();
    sim.setPlayerLevel(10);
    const player = killed(sim);
    const meta = required(sim.meta(player.id), 'player metadata');

    expect(sim.unstuck(player.id)).toBe(true);
    sim.drainEvents();
    sim.revivePlayerAt(player.id, player.pos);

    expect(eventsOf(sim.tick())).toContainEqual(
      expect.objectContaining({ type: 'unstuck', phase: 'cancelled', reason: 'state_changed' }),
    );
    expect(meta.pendingUnstuck).toBeNull();
  });

  it('cancels a living attempt that dies mid-countdown rather than switching outcome', () => {
    const sim = makeWorld();
    sim.setPlayerLevel(10);
    const { player, meta } = accepted(sim);

    sim.ctx.dealDamage(null, player, player.maxHp * 10, false, 'physical', null, 'hit');

    // Lethal damage trips the damage-taken guard first; either way the living
    // attempt must not silently become a revive.
    const cancelled = eventsOf(sim.tick()).find((event) => event.phase === 'cancelled');
    expect(cancelled).toBeDefined();
    expect(meta.pendingUnstuck).toBeNull();
    expect(player.dead).toBe(true);
    expect(player.ghost).toBe(false);
  });
});

describe('unstuck area identity', () => {
  it('reports content-local positions for dungeon, delve, and procedural rift clones', () => {
    const dungeon = makeWorld();
    dungeon.enterDungeon('hollow_crypt', dungeon.player.id);
    const dungeonLocation = required(
      unstuckLocationAt(dungeon.ctx, dungeon.player.id, dungeon.player.pos),
      'dungeon location',
    );
    expect(dungeonLocation.area).toMatchObject({
      kind: 'dungeon',
      id: 'hollow_crypt',
      instanceId: expect.any(String),
      slot: expect.any(Number),
    });
    expect(Math.abs(dungeonLocation.point.localX)).toBeLessThan(300);
    expect(Math.abs(dungeonLocation.point.x)).toBeGreaterThan(600);

    const delve = makeWorld();
    delve.setPlayerLevel(DELVES.collapsed_reliquary.minLevel, delve.player.id);
    delve.enterDelve('collapsed_reliquary', 'normal', delve.player.id);
    const delveLocation = required(
      unstuckLocationAt(delve.ctx, delve.player.id, delve.player.pos),
      'delve location',
    );
    const run = required(delve.delveRunForPlayer(delve.player.id), 'active delve run');
    const firstModuleId = required(run.modules[run.moduleIndex], 'active delve module id');
    expect(delveLocation.area).toMatchObject({
      kind: 'delve',
      id: `collapsed_reliquary:module:${firstModuleId}`,
      instanceId: `seed:${run.seed >>> 0}:tier:normal`,
      slot: expect.any(Number),
    });
    expect(Math.abs(delveLocation.point.localX)).toBeLessThan(300);

    const originalSeed = run.seed;
    run.seed = (run.seed + 1) >>> 0;
    const sameModuleOtherSeed = required(
      unstuckLocationAt(delve.ctx, delve.player.id, delve.player.pos),
      'same module with another run seed',
    );
    expect(sameModuleOtherSeed.area.id).toBe(delveLocation.area.id);
    expect(sameModuleOtherSeed.area.instanceId).not.toBe(delveLocation.area.instanceId);
    run.seed = originalSeed;

    run.moduleIndex = 1;
    const secondModuleId = required(run.modules[run.moduleIndex], 'second delve module id');
    delve.player.pos = delveModuleEntry(delve.ctx, run);
    delve.player.prevPos = { ...delve.player.pos };
    const secondModule = required(
      unstuckLocationAt(delve.ctx, delve.player.id, delve.player.pos),
      'second delve module location',
    );
    expect(secondModule.area.id).toBe(`collapsed_reliquary:module:${secondModuleId}`);
    expect(secondModule.area.id).not.toBe(delveLocation.area.id);
    expect(Math.abs(secondModule.point.localZ)).toBeLessThan(100);

    const rift = makeWorld();
    rift.enterRift(12345, 20, rift.player.id);
    const riftLocation = required(
      unstuckLocationAt(rift.ctx, rift.player.id, rift.player.pos),
      'rift location',
    );
    expect(riftLocation.area).toMatchObject({
      kind: 'rift',
      id: 'seed:12345:floor:0',
      instanceId: expect.any(String),
      slot: expect.any(Number),
    });
    expect(Math.abs(riftLocation.point.localX)).toBeLessThan(300);
  });

  it('requires a live owned dungeon claim and cancels when its identity changes', () => {
    const sim = makeWorld();
    const owner = sim.player.id;
    const foreign = sim.addPlayer('warrior', 'Stranger');
    sim.enterDungeon('hollow_crypt', owner);
    const ownerPlayer = required(sim.entities.get(owner), 'dungeon owner');
    const foreignPlayer = required(sim.entities.get(foreign), 'foreign player');
    const claim = required(
      sim.instances.find((instance) => instance.partyKey !== null),
      'owned dungeon claim',
    );
    const dungeonOrigin = sim.ctx.instanceOriginOf(claim);
    ownerPlayer.pos = sim.groundPos(dungeonOrigin.x + DUNGEON_WALL_X, dungeonOrigin.z - 2);
    ownerPlayer.prevPos = { ...ownerPlayer.pos };
    foreignPlayer.pos = { ...ownerPlayer.pos };
    foreignPlayer.prevPos = { ...foreignPlayer.pos };

    expect(unstuckLocationAt(sim.ctx, foreign, foreignPlayer.pos)).toBeNull();
    expect(sim.unstuck(owner)).toBe(true);
    sim.drainEvents();
    claim.exitId = required(claim.exitId, 'original claim id') + 10_000;
    expect(eventsOf(sim.tick())).toContainEqual(
      expect.objectContaining({ type: 'unstuck', phase: 'cancelled', reason: 'state_changed' }),
    );

    claim.partyKey = null;
    expect(unstuckLocationAt(sim.ctx, owner, ownerPlayer.pos)).toBeNull();
  });

  it('uses the live Nythraxis claim for its wide floor, ownership, and outside edge', () => {
    const sim = makeWorld();
    const owner = sim.player.id;
    for (let i = 0; i < 4; i++) {
      const member = sim.addPlayer('priest', `Raider${i}`);
      sim.partyInvite(member, owner);
      sim.partyAccept(member);
    }
    sim.convertPartyToRaid(owner);
    required(sim.meta(owner), 'raid owner metadata').questsDone.add('q_nythraxis_bound_guardian');
    sim.enterDungeon('nythraxis_boss_arena', owner);

    const claim = required(
      sim.instances.find(
        (instance) => instance.dungeonId === 'nythraxis_boss_arena' && instance.partyKey !== null,
      ),
      'live Nythraxis claim',
    );
    const origin = sim.ctx.instanceOriginOf(claim);
    const widePoint = sim.groundPos(origin.x + 210, origin.z + 20);
    const ownerPlayer = required(sim.entities.get(owner), 'raid owner');
    ownerPlayer.pos = { ...widePoint };
    ownerPlayer.prevPos = { ...widePoint };
    ownerPlayer.vx = 0;
    ownerPlayer.vy = 0;
    ownerPlayer.vz = 0;
    ownerPlayer.onGround = true;
    ownerPlayer.jumping = false;
    ownerPlayer.inCombat = false;
    ownerPlayer.combatTimer = 999;
    sim.grid.update(ownerPlayer);
    sim.playerGrid.update(ownerPlayer);

    // instanceInfoAt shares the CLAIM envelope (not the narrower generic 120-yard
    // rectangle) since the v0.30.0 raid-room widening, so the side wings resolve to
    // this instance for the raid gates built on it too, and still to this slot rather
    // than the arena slot 500 yards away.
    expect(sim.instanceInfoAt(widePoint)).toMatchObject({
      slot: claim.slot,
      dungeonId: 'nythraxis_boss_arena',
    });
    expect(sim.instanceClaimIdAt(widePoint)).toBe(claim.exitId);
    expect(unstuckLocationAt(sim.ctx, owner, widePoint)?.area).toMatchObject({
      kind: 'dungeon',
      id: 'nythraxis_boss_arena',
      instanceId: String(claim.exitId),
      slot: claim.slot,
    });

    const foreign = sim.addPlayer('warrior', 'Uninvited');
    const foreignPlayer = required(sim.entities.get(foreign), 'uninvited player');
    foreignPlayer.pos = { ...widePoint };
    foreignPlayer.prevPos = { ...widePoint };
    expect(unstuckLocationAt(sim.ctx, foreign, foreignPlayer.pos)).toBeNull();

    const outside = sim.groundPos(origin.x + 270, origin.z + 96);
    expect(sim.instanceClaimIdAt(outside)).toBeNull();
    // The widened envelope still has an edge: past it neither lookup resolves.
    expect(sim.instanceInfoAt(outside)).toBeNull();
    expect(unstuckLocationAt(sim.ctx, owner, outside)).toBeNull();

    // The side-wing tomb is a real collider outside the generic 120-yard
    // instance rectangle, so successful admission here exercises the full
    // request path rather than only the location helper.
    expect(sim.unstuck(owner)).toBe(true);
    expect(eventsOf(sim.drainEvents())).toContainEqual({
      type: 'unstuck',
      phase: 'started',
      seconds: UNSTUCK_COUNTDOWN_SECONDS,
      pid: owner,
    });
  });

  it('never classifies unrecognized private instance bands as overworld', () => {
    const sim = makeWorld();
    const privateBand = sim.groundPos(INSTANCE_X_BASE + 7_000, -1_000);
    expect(unstuckLocationAt(sim.ctx, sim.player.id, privateBand)).toBeNull();
  });
});
