import { describe, expect, it } from 'vitest';
import {
  allocRiftCollisionToken,
  clearRiftRegion,
  resolveMovement,
  resolvePosition,
  setRiftRegion,
} from '../src/sim/colliders';
import { BUILTIN_WORLD, isRiftPos, riftInstanceOrigin } from '../src/sim/data';
import { layoutColliders } from '../src/sim/dungeon_layout';
import { generateRiftFloor } from '../src/sim/rift/rift_gen';
import { Sim } from '../src/sim/sim';
import { dist2d, type Entity, type SimEvent, type WorldContent } from '../src/sim/types';

const SEED = 4242;

// Rift geometry and collision are generated in the instance band. Ambient
// overworld entities are irrelevant, especially to the 30-seed clearance sweep.
const RIFT_SIM_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

function makeSim(seed = SEED) {
  return new Sim({
    seed,
    playerClass: 'warrior',
    autoEquip: true,
    devCommands: true,
    world: RIFT_SIM_TEST_WORLD,
  });
}

// Tick while keeping the player alive, so the dev tester survives the elites long
// enough to exercise the gate/descent flow (a dead, unreleased player cannot move).
function tickAlive(sim: Sim, n: number): void {
  for (let i = 0; i < n; i++) {
    sim.player.hp = sim.player.maxHp;
    sim.tick();
  }
}

function killTrash(sim: Sim): void {
  const inst = sim.riftInstances.find((i) => i.partyKey !== null);
  if (!inst) return;
  for (const id of inst.mobIds) {
    if (id === inst.bossId) continue;
    const e = sim.entities.get(id);
    if (e) {
      e.hp = 0;
      e.dead = true;
    }
  }
}

function killAll(sim: Sim): void {
  const inst = sim.riftInstances.find((i) => i.partyKey !== null);
  if (!inst) return;
  for (const id of inst.mobIds) {
    const e = sim.entities.get(id);
    if (e) {
      e.hp = 0;
      e.dead = true;
    }
  }
}

describe('rift sim: dev portal + entry', () => {
  it('/dev portal spawns a walk-through rift portal', () => {
    const sim = makeSim();
    sim.chat('/dev portal 555 12', sim.player.id);
    const portal = [...sim.entities.values()].find((e) => e.templateId === 'rift_portal');
    expect(portal).toBeTruthy();
    expect(portal?.riftSeed).toBe(555);
    expect(portal?.riftBaseLevel).toBe(12);
  });

  // The rank letter IS the difficulty. It used to set only the badge while the
  // instance opened at the player's level (rank C at the cap), which silently
  // downgraded every ranked playtest. The letter now selects the canonical
  // baseLevel for that rank, and the badge always derives from the final
  // baseLevel, so the two can never disagree.
  it('/dev portal rank letter selects the canonical baseLevel for that rank', () => {
    const sim = makeSim();
    sim.setPlayerLevel(20);
    sim.chat('/dev portal 700 S', sim.player.id);
    const portal = [...sim.entities.values()].find(
      (e) => e.templateId === 'rift_portal' && e.riftSeed === 700,
    );
    expect(portal?.riftBaseLevel).toBe(28);
    expect(portal?.riftTier).toBe('S');
  });

  it('/dev portal rank letter overrides a conflicting explicit level', () => {
    const sim = makeSim();
    sim.setPlayerLevel(20);
    sim.chat('/dev portal 701 20 S', sim.player.id);
    const portal = [...sim.entities.values()].find(
      (e) => e.templateId === 'rift_portal' && e.riftSeed === 701,
    );
    expect(portal?.riftBaseLevel).toBe(28);
    expect(portal?.riftTier).toBe('S');
  });

  it('/dev portal with only a level derives a truthful badge, never a random one', () => {
    const sim = makeSim();
    sim.chat('/dev portal 702 24', sim.player.id);
    const portal = [...sim.entities.values()].find(
      (e) => e.templateId === 'rift_portal' && e.riftSeed === 702,
    );
    expect(portal?.riftBaseLevel).toBe(24);
    expect(portal?.riftTier).toBe('B');
  });

  it('/dev portal with no args opens at the player level with the matching badge', () => {
    const sim = makeSim();
    sim.setPlayerLevel(20);
    sim.chat('/dev portal', sim.player.id);
    const portal = [...sim.entities.values()].find((e) => e.templateId === 'rift_portal');
    expect(portal?.riftBaseLevel).toBe(20);
    expect(portal?.riftTier).toBe('C');
  });

  it('walking into a letter-ranked dev portal enters an instance at that difficulty', () => {
    const sim = makeSim();
    sim.setPlayerLevel(20);
    sim.chat('/dev portal 703 A', sim.player.id);
    const portal = [...sim.entities.values()].find(
      (e) => e.templateId === 'rift_portal' && e.riftSeed === 703,
    )!;
    sim.player.pos = { ...portal.pos };
    sim.player.prevPos = { ...portal.pos };
    sim.tick();
    const inst = sim.riftInstances.find((i) => i.partyKey !== null)!;
    expect(inst.baseLevel).toBe(25);
  });

  it('walking into the portal enters a generated floor with spawned mobs', () => {
    const sim = makeSim();
    sim.enterRift(SEED, 15, sim.player.id);
    const inst = sim.riftInstances.find((i) => i.partyKey !== null);
    expect(inst).toBeTruthy();
    expect(isRiftPos(sim.player.pos.x)).toBe(true);
    expect(inst?.mobIds.length ?? 0).toBeGreaterThan(0);
    // Spawned mobs are real, alive, and near the instance origin.
    const origin = riftInstanceOrigin(inst!.slot, inst!.floorIndex);
    for (const id of inst!.mobIds) {
      const m = sim.entities.get(id) as Entity;
      expect(m.kind).toBe('mob');
      expect(Math.abs(m.pos.x - origin.x)).toBeLessThan(60);
    }
  });

  it('registers generated collision (walls push the player back inside)', () => {
    const sim = makeSim();
    sim.enterRift(SEED, 15, sim.player.id);
    const inst = sim.riftInstances.find((i) => i.partyKey !== null)!;
    const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);
    // A swept move from the centre spine outward must be stopped by the side wall
    // (max wall centre is |x|=28), not tunnel through to the target.
    const resolved = resolveMovement(
      SEED,
      origin.x,
      origin.z + 20,
      origin.x + 40,
      origin.z + 20,
      0.6,
      false,
      undefined,
      undefined,
      sim.riftCollisionToken,
    );
    expect(resolved.x).toBeLessThan(origin.x + 30);
  });

  it('two same-seed Sims keep isolated rift collision (regression: shared registry)', () => {
    const simA = makeSim();
    const simB = makeSim();
    expect(simA.riftCollisionToken).not.toBe(simB.riftCollisionToken);
    simA.enterRift(777, 15, simA.player.id);
    const instA = simA.riftInstances.find((i) => i.partyKey !== null)!;
    const origin = riftInstanceOrigin(instA.slot, instA.floorIndex);
    const probe = (token: number) =>
      resolvePosition(SEED, origin.x + 40, origin.z + 20, 0.6, false, undefined, undefined, token);
    const before = probe(simA.riftCollisionToken);
    // Sim B enters a DIFFERENT rift; Sim A's collision must not change at all,
    // and Sim B's token must not resolve against Sim A's region.
    simB.enterRift(31337, 15, simB.player.id);
    const after = probe(simA.riftCollisionToken);
    expect(after).toEqual(before);
    // Both Sims allocate the same slot origin, so before this fix Sim B's
    // registration overwrote Sim A's region under the shared seed key.
    const instB = simB.riftInstances.find((i) => i.partyKey !== null)!;
    expect(riftInstanceOrigin(instB.slot, instB.floorIndex)).toEqual(origin);
  });
});

describe('rift sim: floor progression', () => {
  it('opens the descent only after the floor is cleared, then descends', () => {
    const sim = makeSim();
    sim.enterRift(SEED, 15, sim.player.id);
    const inst = sim.riftInstances.find((i) => i.partyKey !== null)!;
    expect(inst.floorIndex).toBe(0);
    expect(inst.descentOpen).toBe(false);

    // Before clearing (mobs alive): the descent stays closed.
    tickAlive(sim, 21);
    expect(inst.descentOpen).toBe(false);

    // Clear trash (and light any pylons) then tick: the descent opens.
    killTrash(sim);
    inst.litPylons = new Set(inst.pylonIds);
    inst.puzzleSolved = true; // dedicated puzzle tests cover solving; force the gate here
    tickAlive(sim, 21);
    expect(inst.descentOpen).toBe(true);
    expect(inst.descentId).not.toBeNull();

    // Walk onto the descent -> next floor.
    const desc = sim.entities.get(inst.descentId!)!;
    sim.player.pos = { ...desc.pos };
    sim.player.hp = sim.player.maxHp;
    sim.tick();
    expect(inst.floorIndex).toBe(1);
  });

  it('reaches the boss floor, and the exit opens only after the boss dies', () => {
    const sim = makeSim();
    sim.enterRift(SEED, 15, sim.player.id);
    const inst = sim.riftInstances.find((i) => i.partyKey !== null)!;

    // Descend until the boss floor (bounded loop).
    for (let guard = 0; guard < 10 && inst.floorIndex < inst.floorCount - 1; guard++) {
      killTrash(sim);
      inst.litPylons = new Set(inst.pylonIds);
      inst.puzzleSolved = true; // dedicated puzzle tests cover solving; force the gate here
      tickAlive(sim, 21);
      if (inst.descentId === null) break;
      const desc = sim.entities.get(inst.descentId)!;
      sim.player.pos = { ...desc.pos };
      sim.player.hp = sim.player.maxHp;
      sim.tick();
    }
    expect(inst.floorIndex).toBe(inst.floorCount - 1);
    expect(inst.bossId).not.toBeNull();

    // Boss alive: no exit yet.
    tickAlive(sim, 21);
    expect(inst.exitId).toBeNull();

    // Kill the boss: the exit opens.
    killAll(sim);
    tickAlive(sim, 21);
    expect(inst.exitId).not.toBeNull();

    // Walk into the exit -> back to the overworld.
    const exit = sim.entities.get(inst.exitId!)!;
    sim.player.pos = { ...exit.pos };
    sim.player.hp = sim.player.maxHp;
    sim.tick();
    expect(isRiftPos(sim.player.pos.x)).toBe(false);
  });
});

describe('rift sim: leaving never bounces the player back in (regression)', () => {
  it('walking out of the final exit lands clear of the portal and stays out', () => {
    const sim = makeSim();
    sim.setPlayerLevel(20);
    sim.chat('/dev portal 991 20', sim.player.id);
    const portal = [...sim.entities.values()].find((e) => e.templateId === 'rift_portal')!;
    // Walk in standing dead-centre on the portal (the worst-case return spot).
    sim.player.pos = { ...portal.pos };
    sim.player.prevPos = { ...portal.pos };
    sim.tick();
    const inst = sim.riftInstances.find((i) => i.partyKey !== null)!;
    // Force to the boss floor and kill everything so the exit opens.
    for (let guard = 0; guard < 10 && inst.floorIndex < inst.floorCount - 1; guard++) {
      killTrash(sim);
      inst.litPylons = new Set(inst.pylonIds);
      inst.puzzleSolved = true; // dedicated puzzle tests cover solving; force the gate here
      tickAlive(sim, 21);
      if (inst.descentId === null) break;
      const desc = sim.entities.get(inst.descentId)!;
      sim.player.pos = { ...desc.pos };
      sim.player.prevPos = { ...desc.pos };
      tickAlive(sim, 1);
    }
    killAll(sim);
    tickAlive(sim, 21);
    expect(inst.exitId).not.toBeNull();
    // Walk into the exit: back to the overworld...
    const exit = sim.entities.get(inst.exitId!)!;
    sim.player.pos = { ...exit.pos };
    sim.player.prevPos = { ...exit.pos };
    tickAlive(sim, 1);
    expect(isRiftPos(sim.player.pos.x)).toBe(false);
    // ...landing OUTSIDE the portal's walk-in radius, and staying out for the
    // following seconds (before the fix this re-entered on the next tick).
    expect(dist2d(sim.player.pos, portal.pos)).toBeGreaterThan(2.2);
    tickAlive(sim, 80);
    expect(isRiftPos(sim.player.pos.x)).toBe(false);
  });
});

describe('rift sim: death returns to the entry zone cemetery', () => {
  function dieAndRelease(sim: Sim): void {
    sim.player.gm = false;
    sim.dealDamage(null, sim.player, 999999, false, 'physical', 'test', 'hit');
    expect(sim.player.dead).toBe(true);
    sim.releaseSpirit(sim.player.id);
    expect(sim.player.ghost).toBe(true);
  }

  it('a rift entered from Eastbrook sends the spirit to an Eastbrook graveyard (not Thornpeak)', () => {
    const sim = makeSim();
    // Enter with an Eastbrook-Vale overworld return position (zone 1, z ~ 0).
    sim.enterRift(SEED, 20, sim.player.id, { x: 0, z: 0 });
    expect(isRiftPos(sim.player.pos.x)).toBe(true);
    dieAndRelease(sim);
    // Eastbrook graveyards sit at z ~ -14/-56; Thornpeak's are z ~ 645+.
    expect(sim.player.pos.z).toBeLessThan(100);
    expect(isRiftPos(sim.player.pos.x)).toBe(false);
  });

  it('a rift entered from Thornpeak sends the spirit to a Thornpeak graveyard', () => {
    const sim = makeSim();
    // Enter with a Thornpeak-Heights overworld return position (zone 3, z ~ 838).
    sim.enterRift(SEED, 20, sim.player.id, { x: 138, z: 838 });
    dieAndRelease(sim);
    expect(sim.player.pos.z).toBeGreaterThan(500);
  });
});

describe('rift sim: generator clearance matches runtime collision', () => {
  it('spawned mobs sit on genuinely clear tiles (the real pushOut resolver does not move them)', () => {
    // Covers many floor-0 shapes (incl. tilted-wall apse/rotunda/cavern), so a
    // mismatch between the generator's isClear and colliders.ts pushOut (e.g. a
    // rotated-OBB sign flip) would surface as a spawn getting shoved on tick 1.
    const token = allocRiftCollisionToken();
    const origin = riftInstanceOrigin(0, 0);
    try {
      for (let seed = 0; seed < 30; seed++) {
        const floor = generateRiftFloor(seed, 20, 0);
        // This is the exact publication path spawnRiftFloor uses at runtime.
        setRiftRegion(token, origin.x, origin.z, layoutColliders(floor.layout));
        for (const spawn of floor.spawns) {
          const x = origin.x + spawn.x;
          const z = origin.z + spawn.z;
          const res = resolvePosition(seed, x, z, 0.6, false, undefined, undefined, token);
          const moved = Math.hypot(res.x - x, res.z - z);
          expect(
            moved,
            `seed ${seed} mob ${spawn.templateId} @${x},${z} pushed ${moved}`,
          ).toBeLessThan(0.1);
        }
      }
    } finally {
      clearRiftRegion(token, origin.x, origin.z);
    }
  });
});

describe('rift sim: /dev smite one-shots mobs', () => {
  it('a smiting player deletes any mob in one hit, but the toggle is off by default', () => {
    const sim = makeSim();
    sim.enterRift(SEED, 20, sim.player.id);
    const inst = sim.riftInstances.find((i) => i.partyKey !== null)!;
    const mob = sim.entities.get(inst.mobIds[0])!;
    // Without smite, a small hit barely dents a raid-tier mob.
    sim.dealDamage(sim.player, mob, 5, false, 'physical', 'test', 'hit');
    expect(mob.dead).toBe(false);
    // Toggle smite on: the same small hit one-shots it.
    sim.chat('/dev smite', sim.player.id);
    expect(sim.player.oneShot).toBe(true);
    sim.dealDamage(sim.player, mob, 5, false, 'physical', 'test', 'hit');
    expect(mob.dead).toBe(true);
  });
});

describe('rift sim: giga bosses', () => {
  it('the final boss is huge and raid-tier tanky', () => {
    const sim = makeSim();
    sim.enterRift(SEED, 20, sim.player.id);
    const inst = sim.riftInstances.find((i) => i.partyKey !== null)!;
    // Descend to the boss floor.
    for (let guard = 0; guard < 10 && inst.floorIndex < inst.floorCount - 1; guard++) {
      for (const id of inst.mobIds) {
        if (id === inst.bossId) continue;
        const e = sim.entities.get(id);
        if (e) {
          e.hp = 0;
          e.dead = true;
        }
      }
      inst.litPylons = new Set(inst.pylonIds);
      inst.puzzleSolved = true; // dedicated puzzle tests cover solving; force the gate here
      for (let i = 0; i < 21; i++) {
        sim.player.hp = sim.player.maxHp;
        sim.tick();
      }
      if (inst.descentId === null) break;
      const desc = sim.entities.get(inst.descentId)!;
      sim.player.pos = { ...desc.pos };
      sim.player.hp = sim.player.maxHp;
      sim.tick();
    }
    const boss = sim.entities.get(inst.bossId!)!;
    expect(boss.scale).toBeGreaterThan(2.4); // towering
    expect(boss.maxHp).toBeGreaterThan(2500); // raid-tier at this level
  });
});

describe('rift sim: client-sync event', () => {
  it('emits a riftState event on entry with the descriptor', () => {
    const sim = makeSim();
    let evt: Extract<SimEvent, { type: 'riftState' }> | undefined;
    // enterRift emits during the call; capture via the next tick's drained events
    // is not possible (emit happens synchronously), so drive it through a portal.
    sim.setPlayerLevel(20); // all portal entries are level-20 gated
    sim.chat('/dev portal 91 18', sim.player.id);
    const portal = [...sim.entities.values()].find((e) => e.templateId === 'rift_portal')!;
    sim.player.pos = { ...portal.pos };
    const events = sim.tick();
    for (const e of events) if (e.type === 'riftState') evt = e;
    expect(evt).toBeTruthy();
    expect(evt?.active).toBe(true);
    expect(evt?.seed).toBe(91);
    expect(evt?.baseLevel).toBe(18);
    expect(evt?.floorIndex).toBe(0);
    expect(evt?.floorCount).toBeGreaterThanOrEqual(3);
    // A /dev portal has no backing RiftEvent (race.ts: dev portals are
    // "deliberately outside the global race"), so it carries no closing timer;
    // the HUD must degrade to floor-progress-only rather than show a bogus timer.
    expect(evt?.expiresAtMs).toBeNull();
    expect(sim.riftEventMsRemaining()).toBeNull();
  });

  it('carries a live expiresAtMs deadline for a real portal, ticking down but re-emitted unchanged on descent', () => {
    const sim = makeSim();
    sim.setPlayerLevel(20);
    // A /dev portal has no riftEventId by default (see the previous case); give
    // this one a real backing RiftEvent so enterRift takes the ranked-event
    // path (eventId = portal.riftEventId), exactly like a natural world portal.
    sim.chat('/dev portal 91 18', sim.player.id);
    const portal = [...sim.entities.values()].find((e) => e.templateId === 'rift_portal')!;
    const eventId = 'test-rift-event';
    const lifetimeSecs = 3600; // RIFT_PORTAL_LIFETIME
    portal.riftEventId = eventId;
    sim.riftEvents.push({
      eventId,
      ordinal: 1,
      portalId: portal.id,
      status: 'open',
      tier: 'C',
      zoneId: 'test_zone',
      zoneName: 'Test Zone',
      riftName: 'Test Rift',
      seed: 91,
      baseLevel: 18,
      openedAt: sim.time,
      expiresAt: sim.time + lifetimeSecs,
      position: { x: portal.pos.x, z: portal.pos.z },
      contentId: 'test',
      contentHash: 'test',
      contentLocked: false,
      upgradeStatus: 'heuristic',
      upgrade: null,
      assetPipeline: { status: 'none', jobId: null, requestIds: [] },
      firstClear: null,
    });

    sim.player.pos = { ...portal.pos };
    const entryEvents = sim.tick();
    const entryEvt = entryEvents.find((e) => e.type === 'riftState') as
      | Extract<SimEvent, { type: 'riftState' }>
      | undefined;
    expect(entryEvt).toBeTruthy();
    expect(entryEvt?.eventId).toBe(eventId);
    expect(entryEvt?.expiresAtMs).not.toBeNull();
    // Right at entry, the deadline should sit close to the full lifetime out
    // from the moment the event opened (a couple ticks of DT=1/20s tolerance).
    expect(Math.abs((entryEvt?.expiresAtMs as number) - lifetimeSecs * 1000)).toBeLessThan(500);

    const inst = sim.riftInstances.find((i) => i.partyKey !== null)!;
    expect(inst.eventId).toBe(eventId);

    const firstMs = sim.riftEventMsRemaining();
    expect(firstMs).not.toBeNull();
    expect(Math.abs((firstMs as number) - lifetimeSecs * 1000)).toBeLessThan(500);

    // Advance real sim-clock time: the locally-derived remaining value ticks
    // down (the whole point of the fix: no snapshot round trip needed for this).
    tickAlive(sim, 20 * 30); // 30 sim-seconds
    const laterMs = sim.riftEventMsRemaining();
    expect(laterMs).not.toBeNull();
    expect(laterMs as number).toBeLessThan(firstMs as number);
    expect(Math.abs((firstMs as number) - (laterMs as number) - 30_000)).toBeLessThan(200);

    // Descend a floor: emitRiftState fires again (runs.ts descend call site).
    // Same backing event, same clock conversion: the wire deadline comes back
    // unchanged (an event's expiresAt does not move just because a party
    // descends), not decremented by the elapsed time like a countdown would be.
    killTrash(sim);
    inst.litPylons = new Set(inst.pylonIds);
    inst.puzzleSolved = true;
    tickAlive(sim, 21);
    expect(inst.descentId).not.toBeNull();
    const desc = sim.entities.get(inst.descentId!)!;
    sim.player.pos = { ...desc.pos };
    sim.player.hp = sim.player.maxHp;
    const descendEvents = sim.tick();
    const descendEvt = descendEvents.find((e) => e.type === 'riftState') as
      | Extract<SimEvent, { type: 'riftState' }>
      | undefined;
    expect(descendEvt).toBeTruthy();
    expect(descendEvt?.expiresAtMs).not.toBeNull();
    expect(
      Math.abs((descendEvt?.expiresAtMs as number) - (entryEvt?.expiresAtMs as number)),
    ).toBeLessThan(500);
  });
});
