// Escort quest runs (src/sim/escort.ts) through the real Sim on the shipped
// Frostveil content: idle spawn, quest-gated start, the waypoint walk, ambush
// waves that attack the escortee and pause the walk, failure + respawn, and
// the success credit that readies the quest.
import { describe, expect, it } from 'vitest';
import { ESCORTS, MOBS, NPCS, QUESTS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';

const ESCORT_ID = 'esc_fv_wren';
const QUEST_ID = 'q_fv_seeing_wren_home';
const ESCORTEE_TEMPLATE = 'apprentice_wren';

function makeSim(): Sim {
  const sim = new Sim({ seed: 424242, playerClass: 'warrior', playerName: 'Escorter' });
  sim.player.level = 20;
  return sim;
}

function findEscortee(sim: Sim): Entity | undefined {
  return [...sim.entities.values()].find(
    (e) => e.kind === 'mob' && e.templateId === ESCORTEE_TEMPLATE && !e.dead,
  );
}

function teleportTo(sim: Sim, x: number, z: number): void {
  const pos = sim.groundPos(x, z);
  sim.player.pos = { ...pos };
  sim.player.prevPos = { ...pos };
}

function activateQuest(sim: Sim): void {
  sim.questLog.set(QUEST_ID, { questId: QUEST_ID, counts: [0], state: 'active' });
}

// The run's own ambush wave (never the zone's natural camps of the same
// template: the Shiverfen has a resident fen_sprite camp).
function liveAmbushers(sim: Sim): Entity[] {
  const ids = sim.escortRuns.get(ESCORT_ID)?.run?.ambushIds ?? [];
  return ids.map((id) => sim.entities.get(id)).filter((e): e is Entity => !!e && !e.dead);
}

function tickMany(sim: Sim, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...sim.tick());
  return events;
}

describe('escort content integrity', () => {
  it('resolves every escort def against the content tables', () => {
    expect(Object.keys(ESCORTS).length).toBeGreaterThan(0);
    for (const def of Object.values(ESCORTS)) {
      expect(MOBS[def.npcMobId], `${def.id} escortee template`).toBeTruthy();
      // The run drives all movement; wander AI must never move the escortee.
      expect(MOBS[def.npcMobId].moveSpeed).toBe(0);
      expect(MOBS[def.npcMobId].aggroRadius).toBe(0);
      const quest = QUESTS[def.questId];
      expect(quest, `${def.id} quest`).toBeTruthy();
      const objective = quest.objectives.find((o) => o.type === 'escort' && o.escortId === def.id);
      expect(objective, `${def.id} quest escort objective`).toBeTruthy();
      expect(objective?.count).toBe(1);
      expect(def.waypoints.length).toBeGreaterThan(0);
      // Faster than the stuck-advance epsilon (0.05 yd per 1/20s tick = 1 yd/s):
      // a slower def would register as permanently stuck and skip every waypoint
      // instead of walking (see ESCORT_STUCK_MOVE_EPSILON in src/sim/escort.ts).
      expect(def.moveSpeed).toBeGreaterThan(1.0);
      for (const ambush of def.ambushes) {
        expect(MOBS[ambush.mobId], `${def.id} ambush ${ambush.mobId}`).toBeTruthy();
        expect(ambush.atWaypoint).toBeGreaterThanOrEqual(0);
        expect(ambush.atWaypoint).toBeLessThan(def.waypoints.length);
      }
    }
  });
});

describe('escort run lifecycle', () => {
  it('spawns the idle escortee at the def start, non-hostile and unattackable by players', () => {
    const sim = makeSim();
    const def = ESCORTS[ESCORT_ID];
    const wren = findEscortee(sim);
    expect(wren).toBeTruthy();
    expect(wren?.hostile).toBe(false);
    expect(
      Math.hypot((wren?.pos.x ?? 0) - def.start.x, (wren?.pos.z ?? 0) - def.start.z),
    ).toBeLessThan(2);
  });

  it('does not start without the quest, and starts (with a bark) with it active', () => {
    const sim = makeSim();
    const def = ESCORTS[ESCORT_ID];
    teleportTo(sim, def.start.x, def.start.z);
    sim.interact();
    expect(sim.escortRuns.get(ESCORT_ID)?.run ?? null).toBeNull();

    activateQuest(sim);
    sim.interact();
    const state = sim.escortRuns.get(ESCORT_ID);
    expect(state?.run).toBeTruthy();
    const events = tickMany(sim, 1);
    expect(
      events.some(
        (e) =>
          e.type === 'chat' && 'channel' in e && e.channel === 'yell' && e.text === def.startText,
      ),
    ).toBe(true);
  });

  it('walks the waypoints, fires the ambush wave onto the escortee, and pauses until it dies', () => {
    const sim = makeSim();
    const def = ESCORTS[ESCORT_ID];
    teleportTo(sim, def.start.x, def.start.z);
    activateQuest(sim);
    sim.interact();
    const wren = findEscortee(sim);
    expect(wren).toBeTruthy();
    if (!wren) return;
    const startDist = Math.hypot(wren.pos.x - def.waypoints[0].x, wren.pos.z - def.waypoints[0].z);

    // Walk until the first ambush fires (waypoint 0), bounded by a generous cap.
    let sprites: Entity[] = [];
    for (let i = 0; i < 60 * 20 && sprites.length === 0; i++) {
      sim.tick();
      sprites = liveAmbushers(sim);
    }
    expect(sprites.length).toBe(3);
    expect(sprites.every((s) => s.templateId === 'fen_sprite')).toBe(true);
    const movedDist = Math.hypot(wren.pos.x - def.waypoints[0].x, wren.pos.z - def.waypoints[0].z);
    expect(movedDist).toBeLessThan(startDist);
    // The wave opens on the escortee (seeded threat), not the far-away player.
    for (const sprite of sprites) expect(sprite.aggroTargetId).toBe(wren.id);

    // The walk holds while the wave lives, and the wave actually hurts her.
    const held = { x: wren.pos.x, z: wren.pos.z };
    tickMany(sim, 20 * 8);
    expect(Math.hypot(wren.pos.x - held.x, wren.pos.z - held.z)).toBeLessThan(4);
    expect(wren.hp).toBeLessThan(wren.maxHp);
  });

  it('fails the run when the ambush kills the escortee, then respawns it at the start', () => {
    const sim = makeSim();
    const def = ESCORTS[ESCORT_ID];
    teleportTo(sim, def.start.x, def.start.z);
    activateQuest(sim);
    sim.interact();
    const wren = findEscortee(sim);
    expect(wren).toBeTruthy();
    if (!wren) return;

    // Walk to the first ambush, then leave Wren nearly dead so the wave kills
    // her through the real mob-swing damage path.
    for (let i = 0; i < 60 * 20 && liveAmbushers(sim).length === 0; i++) sim.tick();
    expect(liveAmbushers(sim).length).toBe(3);
    const waveIds = [...(sim.escortRuns.get(ESCORT_ID)?.run?.ambushIds ?? [])];
    wren.hp = 5;
    const events: SimEvent[] = [];
    for (let i = 0; i < 30 * 20 && (sim.escortRuns.get(ESCORT_ID)?.run ?? null) !== null; i++) {
      events.push(...sim.tick());
    }
    expect(wren.dead).toBe(true);
    expect(
      events.some(
        (e) =>
          e.type === 'chat' && 'channel' in e && e.channel === 'yell' && e.text === def.failText,
      ),
    ).toBe(true);
    expect(sim.escortRuns.get(ESCORT_ID)?.run ?? null).toBeNull();
    expect(sim.questLog.get(QUEST_ID)?.counts[0]).toBe(0);
    // The failed wave leaves with the run instead of camping the respawn.
    for (const id of waveIds) {
      const mob = sim.entities.get(id);
      expect(!mob || mob.dead).toBe(true);
    }

    // Respawns at the start after the cooldown, ready for a retry.
    tickMany(sim, Math.ceil(def.respawnSeconds * 20) + 5);
    const again = findEscortee(sim);
    expect(again).toBeTruthy();
    expect(
      Math.hypot((again?.pos.x ?? 0) - def.start.x, (again?.pos.z ?? 0) - def.start.z),
    ).toBeLessThan(2);
    expect(sim.escortRuns.get(ESCORT_ID)?.run ?? null).toBeNull();
  });

  it('credits the quest for the nearby escorting player at the final waypoint', () => {
    const sim = makeSim();
    const def = ESCORTS[ESCORT_ID];
    teleportTo(sim, def.start.x, def.start.z);
    activateQuest(sim);
    sim.interact();
    const wren = findEscortee(sim);
    expect(wren).toBeTruthy();
    if (!wren) return;

    // Drive the whole walk: whenever a wave spawns, cut it down (the test digs
    // the escort logic, not the combat math) and keep the player near the NPC.
    let credited = false;
    for (let i = 0; i < 240 * 20 && !credited; i++) {
      for (const mob of liveAmbushers(sim)) {
        mob.hp = 0;
        mob.dead = true;
        // Park the generic camp respawn so the test kill stays dead.
        mob.respawnTimer = 99999;
      }
      teleportTo(sim, wren.pos.x + 2, wren.pos.z + 2);
      const events = sim.tick();
      credited = events.some((e) => e.type === 'questReady' && e.questId === QUEST_ID);
    }
    expect(credited).toBe(true);
    expect(sim.questLog.get(QUEST_ID)?.state).toBe('ready');
    expect(sim.questLog.get(QUEST_ID)?.counts[0]).toBe(1);
    // The escortee has left the world and its def is on respawn cooldown.
    expect(findEscortee(sim)).toBeUndefined();

    // Turn-in at Aurorist Veyla (the destination) completes the chain.
    const veyla = NPCS.aurorist_veyla;
    teleportTo(sim, veyla.pos.x, veyla.pos.z);
    const npcEntity = [...sim.entities.values()].find(
      (e) => e.kind === 'npc' && e.templateId === 'aurorist_veyla',
    );
    expect(npcEntity).toBeTruthy();
    if (!npcEntity) return;
    sim.talkToNpc(npcEntity.id);
    expect(sim.questLog.get(QUEST_ID)?.state ?? 'done').toBe('done');
  });
});

describe('escort run guards', () => {
  it('fails a run that outlives the timeout', () => {
    const sim = makeSim();
    const def = ESCORTS[ESCORT_ID];
    teleportTo(sim, def.start.x, def.start.z);
    activateQuest(sim);
    sim.interact();
    const state = sim.escortRuns.get(ESCORT_ID);
    expect(state?.run).toBeTruthy();
    if (!state?.run) return;
    // Backdate the start beyond the run timeout: the next driver tick fails it.
    state.run.startedAt = -10000;
    const events = tickMany(sim, 1);
    expect(
      events.some(
        (e) =>
          e.type === 'chat' && 'channel' in e && e.channel === 'yell' && e.text === def.failText,
      ),
    ).toBe(true);
    expect(sim.escortRuns.get(ESCORT_ID)?.run ?? null).toBeNull();
  });

  it('stuck-advances a walker pinned in place instead of wedging the run', () => {
    const sim = makeSim();
    const def = ESCORTS[ESCORT_ID];
    teleportTo(sim, def.start.x, def.start.z);
    activateQuest(sim);
    sim.interact();
    const wren = findEscortee(sim);
    const state = sim.escortRuns.get(ESCORT_ID);
    expect(wren && state?.run).toBeTruthy();
    if (!wren || !state?.run) return;
    // Pin the walker: undo whatever the driver moved every tick, simulating a
    // collider that absorbs all progress. After ESCORT_STUCK_TICKS the driver
    // must count the waypoint as reached rather than stalling to the timeout.
    const pin = { x: wren.pos.x, z: wren.pos.z };
    const before = state.run.waypointIndex;
    for (let i = 0; i < 120 && state.run && state.run.waypointIndex === before; i++) {
      sim.tick();
      wren.pos.x = pin.x;
      wren.pos.z = pin.z;
    }
    expect(state.run?.waypointIndex ?? before + 1).toBeGreaterThan(before);
  });
});

// Every authored escort route must be WALKABLE in the real world: the escortee
// has to reach its final waypoint against real terrain and colliders (a
// waypoint inside a rock or across deep water would strand every run at the
// timeout). Drives each def's full walk with waves auto-culled.
describe('every escort route completes in the real world', () => {
  for (const def of Object.values(ESCORTS)) {
    it(`${def.id} walks its full route to credit`, () => {
      const sim = makeSim();
      teleportTo(sim, def.start.x, def.start.z);
      sim.questLog.set(def.questId, { questId: def.questId, counts: [0], state: 'active' });
      sim.interact();
      const state = sim.escortRuns.get(def.id);
      expect(state?.run, `${def.id} run started`).toBeTruthy();
      const npcId = state?.npcId;
      const npc = npcId !== null && npcId !== undefined ? sim.entities.get(npcId) : undefined;
      expect(npc).toBeTruthy();
      if (!npc) return;
      let credited = false;
      for (let i = 0; i < 300 * 20 && !credited; i++) {
        const run = sim.escortRuns.get(def.id)?.run;
        for (const id of run?.ambushIds ?? []) {
          const mob = sim.entities.get(id);
          if (mob && !mob.dead) {
            mob.hp = 0;
            mob.dead = true;
            mob.respawnTimer = 99999;
          }
        }
        teleportTo(sim, npc.pos.x + 2, npc.pos.z + 2);
        const events = sim.tick();
        credited = events.some((e) => e.type === 'questReady' && e.questId === def.questId);
      }
      expect(credited, `${def.id} reached its destination`).toBe(true);
    });
  }
});
