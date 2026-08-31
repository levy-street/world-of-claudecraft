// The Forge-Lift: the raid family's first room, a sealed car between two
// portals. The overworld keep door teleports the raid in; for a fixed ride
// the exit gate stays a locked object (a sealed room, no sightline and no
// crossing), then it swaps into an ordinary room-crossing portal to the
// Halls through the same unlock the Sealed Herald Gate uses.
import { describe, expect, it } from 'vitest';
import { DUNGEONS } from '../src/sim/data';
import { IGNIVAR_LIFT_RIDE_SECONDS, ignivarLiftArrived } from '../src/sim/ignivar_forge_lift';
import {
  IGNIVAR_FORGE_APPROACH_ID,
  IGNIVAR_LIFT_GATE_LOCKED_TEMPLATE,
  IGNIVAR_LIFT_ROOM_ID,
  ignivarPreviousRaidRoom,
} from '../src/sim/ignivar_raid_ids';
import { enterDungeon, updateDoorTriggers } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';

function boardLift() {
  const sim = new Sim({ seed: 4711, playerClass: 'warrior', devCommands: true });
  const allyPid = sim.addPlayer('paladin', 'Lift Ally');
  const raid = sim.ctx.formDungeonFinderGroup(
    [sim.player.id, allyPid].map((pid) => ({ partyId: null, leaderPid: pid, members: [pid] })),
    { raid: true },
  );
  if (!raid) throw new Error('lift test raid did not form');
  if (!enterDungeon(sim.ctx, IGNIVAR_LIFT_ROOM_ID, sim.player.id, true))
    throw new Error('could not board the forge-lift');
  const inst = sim.instances.find(
    (candidate) => candidate.dungeonId === IGNIVAR_LIFT_ROOM_ID && candidate.partyKey !== null,
  );
  if (!inst) throw new Error('no lift claim formed');
  const gate = () => {
    for (const id of inst.objectIds) {
      const entity = sim.entities.get(id);
      if (
        entity &&
        (entity.templateId === IGNIVAR_LIFT_GATE_LOCKED_TEMPLATE ||
          entity.templateId === 'dungeon_door')
      )
        return entity;
    }
    throw new Error('no lift gate in the claim');
  };
  return { sim, inst, gate };
}

describe('the Forge-Lift room', () => {
  it('is the raid chain head: keep door in, the Halls chained behind it', () => {
    expect(ignivarPreviousRaidRoom(IGNIVAR_LIFT_ROOM_ID)).toBeNull();
    expect(ignivarPreviousRaidRoom(IGNIVAR_FORGE_APPROACH_ID)).toBe(IGNIVAR_LIFT_ROOM_ID);
    expect(DUNGEONS[IGNIVAR_LIFT_ROOM_ID]).toMatchObject({
      doorPos: { x: 503.05, z: 2243.7 },
      interior: 'ignivar_lift',
      guideVisible: false,
      suggestedPlayers: 10,
    });
    // The Eastbrook walk-up testing door is retired: the Halls are an
    // interior-only room, so the lift's exit portal is the chain's only
    // way in and its gate seal governs first entry.
    expect(DUNGEONS[IGNIVAR_FORGE_APPROACH_ID].overworldDoor).toBe(false);
  }, 40000);

  it('seals the car through the ride: locked gate, no walk-through, entry refused', () => {
    const { sim, gate } = boardLift();
    expect(gate().templateId).toBe(IGNIVAR_LIFT_GATE_LOCKED_TEMPLATE);
    expect(gate().lootable).toBe(false);
    expect(sim.ctx.dungeonDoorIds ?? []).not.toContain(gate().id);
    // standing ON the sealed gate triggers nothing (it is not a door yet)
    const p = sim.player;
    p.pos.x = gate().pos.x;
    p.pos.z = gate().pos.z;
    p.prevPos = { ...p.pos };
    updateDoorTriggers(sim.ctx, p);
    expect(sim.instanceInfoAt(p.pos)?.dungeonId).toBe(IGNIVAR_LIFT_ROOM_ID);
    // and the chained Halls refuse a live entry while the gate is sealed
    expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, p.id, false)).toBe(false);
  }, 40000);

  it('arrives: the gate becomes the portal into the Halls and the walk-in works', () => {
    const { sim, gate } = boardLift();
    let grind = false;
    let arrivalLog = false;
    for (let tick = 0; tick < 20 * (IGNIVAR_LIFT_RIDE_SECONDS + 2); tick++) {
      for (const event of sim.tick()) {
        if (event.type === 'spellfxAt' && event.sfxKey === 'rift_gate_grind') grind = true;
        if (event.type === 'log' && event.text === 'The forge-lift settles; its gate grinds open.')
          arrivalLog = true;
      }
    }
    expect(gate().templateId).toBe('dungeon_door');
    expect(gate().dungeonId).toBe(IGNIVAR_FORGE_APPROACH_ID);
    expect(gate().lootable).toBe(true);
    expect(sim.ctx.dungeonDoorIds ?? []).toContain(gate().id);
    expect(grind).toBe(true);
    expect(arrivalLog).toBe(true);
    // stepping into the opened portal crosses into the Halls
    const p = sim.player;
    p.pos.x = gate().pos.x;
    p.pos.z = gate().pos.z;
    p.prevPos = { ...p.pos };
    updateDoorTriggers(sim.ctx, p);
    expect(sim.instanceInfoAt(p.pos)?.dungeonId).toBe(IGNIVAR_FORGE_APPROACH_ID);
  }, 40000);

  it('the lift exit IS the dungeon entrance: leaving lands you at the keep door', () => {
    const { sim, inst } = boardLift();
    const exit = inst.exitId !== null ? sim.entities.get(inst.exitId) : null;
    if (!exit) throw new Error('no lift exit portal');
    // the exit portal rides inside the car, opposite the sealed gate
    const p = sim.player;
    p.pos.x = exit.pos.x;
    p.pos.z = exit.pos.z;
    p.prevPos = { ...p.pos };
    updateDoorTriggers(sim.ctx, p);
    // back OUTSIDE, beside the keep facade the raid walked in through
    const door = DUNGEONS[IGNIVAR_LIFT_ROOM_ID].doorPos;
    expect(Math.hypot(p.pos.x - door.x, p.pos.z - door.z)).toBeLessThan(8);
  }, 40000);

  it('exposes the ride predicate for the sweep', () => {
    expect(IGNIVAR_LIFT_RIDE_SECONDS).toBe(9);
    expect(ignivarLiftArrived(undefined, 100)).toBe(false);
    expect(ignivarLiftArrived(10, 10 + IGNIVAR_LIFT_RIDE_SECONDS - 0.5)).toBe(false);
    expect(ignivarLiftArrived(10, 10 + IGNIVAR_LIFT_RIDE_SECONDS)).toBe(true);
  }, 40000);
});
