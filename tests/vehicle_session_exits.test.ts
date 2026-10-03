// Live-realm reports against the world-quest cannon (src/sim/vehicles.ts):
//
// 1. A PvP-flagged (or free-for-all ground) defender manning the cannon was
//    thrown out of the minigame the moment another player hit them: the hit put
//    them in combat and tickVehicle's eligibility guard ended the session. A
//    player at the cannon is frozen and cannot fight back, so the world arm now
//    treats them like a prisoner or a battleground player: not a world target.
// 2. Endless waves: at the third endless round the commander spawns with more
//    health than the client decoder allowed, the client dropped the whole
//    session and lost the cannon, while the server kept the run (and the
//    movement lock) until the waves breached the line. The decoder bounds now
//    derive from the content, the client asks the server to release a session
//    it cannot mirror, and any exit from endless play posts its ladder row once.
import { describe, expect, it } from 'vitest';
import { type QuestWorldCommand, QuestWorldWireState } from '../src/net/quest_world_wire_state';
import { decodeVehicleSession } from '../src/net/vehicle_session_wire';
import { CANNON_ENEMIES } from '../src/sim/content/cannon_encounter';
import { NORTH_WATCH_CANNON } from '../src/sim/content/vehicle_stations';
import { WORLD_QUESTS_BY_ID } from '../src/sim/data';
import { createCannonEncounter, tickCannonEncounter } from '../src/sim/minigames/cannon_encounter';
import {
  beginCannonEndless,
  CANNON_ENDLESS,
  CANNON_MAX_ENEMY_HP,
  CANNON_MAX_LIVE_ENEMIES,
  cannonEndlessRound,
} from '../src/sim/minigames/cannon_endless';
import { Sim } from '../src/sim/sim';
import { type SimEvent, TICK_RATE, type VehicleSession } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';
import { worldQuestCycleOfferingQuest } from '../src/sim/world_quest_rotation';
import { WORLD_SEED } from '../src/sim/world_seed';

type ScoreEvent = Extract<SimEvent, { type: 'worldQuestScore' }>;
type ResultEvent = Extract<SimEvent, { type: 'cannonResult' }>;

function rig() {
  const station = NORTH_WATCH_CANNON;
  const sim = new Sim({ seed: WORLD_SEED, playerClass: 'mage' });
  const player = sim.player;
  const meta = sim.meta(player.id)!;
  sim.setPlayerLevel(Math.max(20, WORLD_QUESTS_BY_ID[station.questId].minLevel));
  meta.devWorldQuestCycle = worldQuestCycleOfferingQuest('wq3_0', station.questId);
  player.pos = {
    x: station.x,
    z: station.z + 2,
    y: terrainHeight(station.x, station.z + 2, WORLD_SEED),
  };
  player.prevPos = { ...player.pos };
  sim.tick();
  return { sim, player, meta };
}

/** Put a manned session straight into endless play with `waves` held. */
function makeEndless(sim: Sim, pid: number, waves: number): void {
  const encounter = sim.meta(pid)!.vehicle!.encounter;
  encounter.wave = waves - 1;
  encounter.wavesCleared = waves;
  beginCannonEndless(encounter, 'silver', 5 * TICK_RATE);
}

function sessionFor(encounter: VehicleSession['encounter']): VehicleSession {
  return {
    kind: 'cannon',
    stationId: NORTH_WATCH_CANNON.id,
    cycle: 'wq1_3',
    origin: { x: NORTH_WATCH_CANNON.x, y: 0, z: NORTH_WATCH_CANNON.z },
    encounter,
  };
}

function collect(events: SimEvent[], scores: ScoreEvent[], results: ResultEvent[]): void {
  for (const event of events) {
    if (event.type === 'worldQuestScore') scores.push(event as ScoreEvent);
    if (event.type === 'cannonResult') results.push(event as ResultEvent);
  }
}

describe('a manned cannon is not a world PvP target', () => {
  it('a flagged attacker cannot hit the gunner, and the session survives the attempt', () => {
    const { sim, player } = rig();
    const raider = sim.addPlayer('warrior', 'Raider', { autoEquip: true });
    sim.setPlayerLevel(20, raider);
    const attacker = sim.entities.get(raider)!;
    attacker.pos = { ...player.pos, x: player.pos.x + 2 };
    attacker.prevPos = { ...attacker.pos };
    sim.setWorldPvpFlag(true);
    sim.setWorldPvpFlag(true, raider);
    sim.tick();
    // Before manning the cannon the two are fair game to each other.
    expect(sim.isHostileTo(attacker, player)).toBe(true);
    expect(sim.enterVehicle(NORTH_WATCH_CANNON.id)).toBe(true);
    expect(sim.isHostileTo(attacker, player)).toBe(false);
    expect(sim.isHostileTo(player, attacker)).toBe(false);
    const hp = player.hp;
    sim.targetEntity(player.id, raider);
    sim.startAutoAttack(raider);
    for (let i = 0; i < 4 * TICK_RATE; i++) sim.tick();
    expect(player.hp).toBe(hp);
    expect(player.inCombat).toBe(false);
    expect(sim.vehicleSession?.stationId).toBe(NORTH_WATCH_CANNON.id);
    // Leaving the cannon hands the gunner back to the ordinary world rules.
    sim.leaveVehicle();
    expect(sim.isHostileTo(attacker, player)).toBe(true);
  }, 60_000);
});

describe('leaving endless play posts the ladder row exactly once', () => {
  it('an ejection mid-endless posts the waves held with the victory medal', () => {
    const { sim, player } = rig();
    expect(sim.enterVehicle(NORTH_WATCH_CANNON.id)).toBe(true);
    makeEndless(sim, player.id, 5);
    const scores: ScoreEvent[] = [];
    const results: ResultEvent[] = [];
    collect(sim.tick(), scores, results);
    expect(scores).toEqual([]);
    // Any displacement ends the session (tickVehicle's station guard).
    player.pos.x += 1;
    collect(sim.tick(), scores, results);
    expect(sim.vehicleSession).toBeNull();
    for (let i = 0; i < TICK_RATE; i++) collect(sim.tick(), scores, results);
    expect(scores).toEqual([
      {
        type: 'worldQuestScore',
        pid: player.id,
        board: 'north_watch_cannon',
        medal: 'silver',
        metric: 5,
      },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ pid: player.id, medal: 'silver', wavesCleared: 5 });
  }, 60_000);

  it('a voluntary leave posts once; a breach posts once; the authored defense posts nothing', () => {
    const { sim, player, meta } = rig();
    const scores: ScoreEvent[] = [];
    const results: ResultEvent[] = [];
    // Voluntary leave, twice (idempotent): one row.
    expect(sim.enterVehicle(NORTH_WATCH_CANNON.id)).toBe(true);
    makeEndless(sim, player.id, 7);
    sim.leaveVehicle();
    sim.leaveVehicle();
    collect(sim.tick(), scores, results);
    expect(scores.map((s) => s.metric)).toEqual([7]);
    // A breached endless line posts its row in tickVehicle and never again on the way out.
    scores.length = 0;
    results.length = 0;
    expect(sim.enterVehicle(NORTH_WATCH_CANNON.id)).toBe(true);
    makeEndless(sim, player.id, 6);
    const encounter = meta.vehicle!.encounter;
    encounter.phase = 'wave';
    encounter.integrity = CANNON_ENEMIES.infantry.breachDamage;
    encounter.spawnCursor = 999;
    encounter.enemies.push({
      id: 999,
      kind: 'infantry',
      hp: 100,
      x: NORTH_WATCH_CANNON.x,
      z: NORTH_WATCH_CANNON.field.maxZ - 0.001,
      slowUntilTick: 0,
    });
    collect(sim.tick(), scores, results);
    expect(sim.vehicleSession).toBeNull();
    for (let i = 0; i < TICK_RATE; i++) collect(sim.tick(), scores, results);
    expect(scores.map((s) => s.metric)).toEqual([6]);
    expect(results).toHaveLength(1);
    // Leaving the authored (pre-victory) defense is no ladder attempt at all.
    scores.length = 0;
    results.length = 0;
    expect(sim.enterVehicle(NORTH_WATCH_CANNON.id)).toBe(true);
    sim.leaveVehicle();
    for (let i = 0; i < TICK_RATE; i++) collect(sim.tick(), scores, results);
    expect(scores).toEqual([]);
    expect(results).toEqual([]);
  }, 60_000);
});

describe('the client mirrors every endless round the server can run', () => {
  it('decodes the third endless round, where the commander outgrows the authored health', () => {
    const encounter = createCannonEncounter();
    // The authored victory lands on wave index 2; round three is wave index 5,
    // the commander pattern, with every health bar scaled up.
    encounter.wave = 4;
    encounter.commanderKilled = true;
    beginCannonEndless(encounter, 'gold', 1);
    let commanderHp = 0;
    for (let i = 0; i < 120 * TICK_RATE && !commanderHp; i++) {
      encounter.integrity = 100; // the harness holds the line; only the roster matters
      tickCannonEncounter(encounter, NORTH_WATCH_CANNON.field);
      commanderHp = encounter.enemies.find((e) => e.kind === 'commander')?.hp ?? 0;
    }
    expect(cannonEndlessRound(encounter)).toBe(3);
    expect(commanderHp).toBeGreaterThan(CANNON_ENEMIES.commander.hp);
    const decoded = decodeVehicleSession(sessionFor(encounter));
    expect(decoded).not.toBeNull();
    expect(decoded?.encounter.enemies.find((e) => e.kind === 'commander')?.hp).toBe(commanderHp);
  });

  it('bounds enemy health and roster size by the content, still rejecting a forged row', () => {
    const top = Math.max(...Object.values(CANNON_ENEMIES).map((e) => e.hp));
    expect(CANNON_MAX_ENEMY_HP).toBeGreaterThanOrEqual(
      Math.round(top * (1 + CANNON_ENDLESS.hpPerRound * CANNON_ENDLESS.maxRounds)),
    );
    const encounter = createCannonEncounter();
    encounter.phase = 'wave';
    const row = (hp: number, id: number) => ({
      id,
      kind: 'commander' as const,
      hp,
      x: NORTH_WATCH_CANNON.x,
      z: NORTH_WATCH_CANNON.field.minZ,
      slowUntilTick: 0,
    });
    encounter.enemies = [row(CANNON_MAX_ENEMY_HP, 1)];
    expect(decodeVehicleSession(sessionFor(encounter))).not.toBeNull();
    encounter.enemies = [row(CANNON_MAX_ENEMY_HP + 1, 1)];
    expect(decodeVehicleSession(sessionFor(encounter))).toBeNull();
    encounter.enemies = Array.from({ length: CANNON_MAX_LIVE_ENEMIES }, (_, i) => row(100, i + 1));
    expect(decodeVehicleSession(sessionFor(encounter))).not.toBeNull();
    encounter.enemies.push(row(100, CANNON_MAX_LIVE_ENEMIES + 1));
    expect(decodeVehicleSession(sessionFor(encounter))).toBeNull();
  });
});

describe('a session the client cannot mirror is released, never left frozen', () => {
  class Probe extends QuestWorldWireState {
    sent: QuestWorldCommand[] = [];
    constructor() {
      super();
      this.bindQuestWorldWire('', (command) => this.sent.push(command));
    }
  }

  it('asks the server once to leave, and re-arms once the mirror recovers', () => {
    const probe = new Probe();
    const malformed = { kind: 'cannon', stationId: NORTH_WATCH_CANNON.id };
    probe.applyQuestSelfSnapshot({ vehicle: malformed });
    probe.applyQuestSelfSnapshot({ vehicle: malformed });
    expect(probe.vehicleSession).toBeNull();
    expect(probe.sent).toEqual([{ cmd: 'vehicle_leave' }]);
    // The server's release arrives as an explicit null; a later bad session asks again.
    probe.applyQuestSelfSnapshot({ vehicle: null });
    probe.applyQuestSelfSnapshot({ vehicle: malformed });
    expect(probe.sent).toHaveLength(2);
    // A session that decodes is never released by the mirror.
    const good = new Probe();
    good.applyQuestSelfSnapshot({ vehicle: sessionFor(createCannonEncounter()) });
    expect(good.vehicleSession).not.toBeNull();
    expect(good.sent).toEqual([]);
  });
});
