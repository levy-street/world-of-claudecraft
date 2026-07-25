import { describe, expect, it } from 'vitest';
import { delveModuleZOffset } from '../src/sim/data';
import { updateInstances } from '../src/sim/instances/dungeons';
import { interact } from '../src/sim/interaction';
import { Sim } from '../src/sim/sim';
import type { SourceCaveRosterEntry } from '../src/sim/source_cave';
import {
  onSourceCaveMobKilled,
  SOURCE_CAVE_CHEST_SEALED_TEMPLATE,
  SOURCE_CAVE_CHEST_TEMPLATE,
  SOURCE_CAVE_DUNGEON_ID,
  sourceCaveChestLocalZ,
  sourceCaveOrigin,
} from '../src/sim/source_cave';
import type { Entity, SimEvent } from '../src/sim/types';
import { INSTANCE_EMPTY_TIMEOUT } from '../src/sim/types';

// biome-ignore lint/suspicious/noExplicitAny: tests reach ctx / private helpers.
type AnySim = Sim & any;

function makeSim(seed = 1234, sourceCaveRoster?: SourceCaveRosterEntry[]): AnySim {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true, sourceCaveRoster }) as AnySim;
}

function addLvl20(sim: AnySim, name: string): number {
  const pid = sim.addPlayer('warrior', name);
  sim.setPlayerLevel(20, pid);
  return pid;
}

function teleport(sim: AnySim, e: Entity, x: number, z: number): void {
  e.pos = { x, y: e.pos.y, z };
  e.prevPos = { ...e.pos };
  sim.rebucket(e);
}

function claimedCave(sim: AnySim) {
  return sim.instances.find(
    (i: { dungeonId: string; partyKey: string | null }) =>
      i.dungeonId === SOURCE_CAVE_DUNGEON_ID && i.partyKey !== null,
  );
}

function killAll(sim: AnySim, inst: { mobIds: number[] }): void {
  for (const id of inst.mobIds) {
    const e = sim.entities.get(id) as Entity;
    e.dead = true;
    e.hp = 0;
  }
}

function chestsIn(sim: AnySim, inst: { objectIds: number[] }): Entity[] {
  return inst.objectIds
    .map((id: number) => sim.entities.get(id) as Entity | undefined)
    .filter(
      (e): e is Entity =>
        !!e &&
        (e.templateId === SOURCE_CAVE_CHEST_TEMPLATE ||
          e.templateId === SOURCE_CAVE_CHEST_SEALED_TEMPLATE),
    );
}

// The chest stands sealed from claim time; the clear pass ARMS it (the sealed ->
// armed template swap, plus loot + lootRecipientIds). Armed = the clear fired.
function armedChestsIn(sim: AnySim, inst: { objectIds: number[] }): Entity[] {
  return chestsIn(sim, inst).filter((e) => e.templateId === SOURCE_CAVE_CHEST_TEMPLATE);
}

function lockedOut(sim: AnySim, pid: number): boolean {
  return (sim.players.get(pid).raidLockouts as Map<string, number>).has(SOURCE_CAVE_DUNGEON_ID);
}

// tick() is never called in these tests, so tickCount stays 0 (0 % 20 === 0), which
// is exactly when updateInstances runs its once-a-second pass.
function pass(sim: AnySim): void {
  updateInstances(sim.ctx);
}

describe('source cave clear: reward chest arming + once-only guard', () => {
  it('the sealed chest stands in its north-wall alcove from claim time', () => {
    const sim = makeSim();
    const pid = addLvl20(sim, 'Alice');
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const inst = claimedCave(sim);
    const spec = sim.sourceCave.spec;
    const origin = sourceCaveOrigin(inst.slot);

    const chests = chestsIn(sim, inst);
    expect(chests.length).toBe(1);
    const chest = chests[0];
    expect(chest.kind).toBe('object');
    // The sealed template is its own wire-visible identity (no label, no
    // sparkle client-side); arming swaps it to SOURCE_CAVE_CHEST_TEMPLATE.
    expect(chest.templateId).toBe(SOURCE_CAVE_CHEST_SEALED_TEMPLATE);
    expect(chest.lootable).toBe(true); // interactable (the deny path), just sealed
    expect(chest.loot).toBeNull();
    expect(chest.lootRecipientIds).toBeUndefined();

    // Positioned in the dedicated alcove against the NORTH wall (zMax - 6),
    // the full room away from the centre button: a click near the chest must
    // never resolve onto the button through the interact nearest-scan.
    const lastModule = spec.modules.length - 1;
    const zBase = delveModuleZOffset(spec.modules, lastModule);
    expect(chest.pos.x).toBe(origin.x + spec.chestPos.x);
    expect(chest.pos.z).toBe(origin.z + zBase + sourceCaveChestLocalZ());
    // Pin the alcove anchor to its literal (zMax 48 - inset 6 = 42) so an
    // inset drift is caught, and prove the button/chest separation dwarfs the
    // interact range (INTERACT_RANGE ~5; anything past ~2x cannot cross-pick).
    expect(sourceCaveChestLocalZ()).toBe(42);
    const button = inst.objectIds
      .map((id: number) => sim.entities.get(id) as Entity | undefined)
      .find((e: Entity | undefined) => e?.templateId === 'source_cave_reboot') as Entity;
    expect(button).toBeDefined();
    const separation = Math.hypot(chest.pos.x - button.pos.x, chest.pos.z - button.pos.z);
    expect(separation).toBeGreaterThan(30);
  });

  it('a partial clear arms no chest and grants no lockout', () => {
    const sim = makeSim();
    const pid = addLvl20(sim, 'Alice');
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const inst = claimedCave(sim);
    expect(inst.mobIds.length).toBeGreaterThan(1);

    // Kill every mob but one.
    for (let i = 1; i < inst.mobIds.length; i++) {
      const e = sim.entities.get(inst.mobIds[i]) as Entity;
      e.dead = true;
      e.hp = 0;
    }
    pass(sim);
    pass(sim);

    expect(chestsIn(sim, inst).length).toBe(1); // the sealed chest is always there
    expect(armedChestsIn(sim, inst).length).toBe(0);
    expect(lockedOut(sim, pid)).toBe(false);
  });

  it('a full clear arms exactly one chest with shared loot, even across several passes', () => {
    const sim = makeSim();
    const pid = addLvl20(sim, 'Alice');
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const inst = claimedCave(sim);

    killAll(sim, inst);
    pass(sim);
    pass(sim);
    pass(sim);

    const chests = armedChestsIn(sim, inst);
    expect(chests.length).toBe(1);
    const chest = chests[0];
    expect(chest.templateId).toBe(SOURCE_CAVE_CHEST_TEMPLATE); // sealed -> armed swap
    expect(chest.lootable).toBe(true);
    expect(chest.loot).not.toBeNull();
    // Classic shared drop: tapped for the clearing group, no personalFor slots.
    expect(chest.tappedById).toBe(pid);
    expect(chest.lootRecipientIds).toEqual([pid]);
    const loot = chest.loot as { items: { personalFor?: number[] }[] };
    expect(loot.items.length).toBeGreaterThan(0);
    for (const slot of loot.items) expect(slot.personalFor).toBeUndefined();

    // Global uniqueness: exactly one chest entity in the whole world.
    const allChests = [...sim.entities.values()].filter(
      (e: Entity) => e.templateId === SOURCE_CAVE_CHEST_TEMPLATE,
    );
    expect(allChests.length).toBe(1);
  });

  it('arms after every selected combatant dies while visible spectators remain alive', () => {
    const sourceCaveRoster: SourceCaveRosterEntry[] = Array.from({ length: 60 }, (_, i) => ({
      login: `contributor-${i}`,
      mergedPrs: i === 0 ? 90 : i < 7 ? 30 : i < 13 ? 15 : i < 21 ? 5 : 1,
      rank: i + 1,
    }));
    const sim = makeSim(1234, sourceCaveRoster);
    const pid = addLvl20(sim, 'Alice');
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const inst = claimedCave(sim);
    const combatIds = new Set<number>(inst.sourceCaveEncounter.waves.flat());
    const spectatorIds = inst.mobIds.filter((id: number) => !combatIds.has(id));
    expect(combatIds.size).toBe(37);
    expect(spectatorIds.length).toBe(23);

    for (const id of combatIds) {
      const mob = sim.entities.get(id) as Entity;
      mob.dead = true;
      mob.hp = 0;
    }
    pass(sim);

    expect(armedChestsIn(sim, inst).length).toBe(1);
    expect(lockedOut(sim, pid)).toBe(true);
    expect(spectatorIds.every((id: number) => sim.entities.get(id)?.dead === false)).toBe(true);
  });

  it('requires every remaining overflow guardian after a breach', () => {
    const roster: SourceCaveRosterEntry[] = Array.from({ length: 60 }, (_, i) => ({
      login: `contributor-${i}`,
      mergedPrs: i === 0 ? 90 : i < 7 ? 30 : i < 13 ? 15 : i < 21 ? 5 : 1,
      rank: i + 1,
    }));
    const sim = makeSim(1234, roster);
    const pid = addLvl20(sim, 'Alice');
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const inst = claimedCave(sim);
    const combatIds = new Set<number>(inst.sourceCaveEncounter.combatMobIds);
    const overflowIds = inst.mobIds.filter((id: number) => !combatIds.has(id));
    inst.sourceCaveEncounter.breached = true;

    for (const id of combatIds) {
      const mob = sim.entities.get(id) as Entity;
      mob.dead = true;
      mob.hp = 0;
    }
    pass(sim);
    expect(armedChestsIn(sim, inst)).toHaveLength(0);
    expect(lockedOut(sim, pid)).toBe(false);

    for (const id of overflowIds) {
      const mob = sim.entities.get(id) as Entity;
      mob.dead = true;
      mob.hp = 0;
    }
    pass(sim);
    expect(armedChestsIn(sim, inst)).toHaveLength(1);
    expect(lockedOut(sim, pid)).toBe(true);
  });

  it('a player standing right at the entrance, the far edge of the occupancy band, still counts as present', () => {
    // Regression guard: the entrance sits south of the arena centre (the deliberate
    // no-instant-aggro buffer between the door and the outermost mob ring, scaled to
    // the actual roster by sourceCaveEntryZ, spec.ts). If clear detection used a tight
    // symmetric box instead of the asymmetric south margin, a party finishing the
    // fight while someone idles back at the door would be invisible: no chest, no
    // lockout.
    const sim = makeSim();
    const pid = addLvl20(sim, 'Alice');
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const inst = claimedCave(sim);
    const origin = sourceCaveOrigin(inst.slot);

    // The player has not moved since entering: they are exactly at the spawn point
    // (just south of the outer ring since the empty entrance buffer was removed).
    const p = sim.entities.get(pid) as Entity;
    expect(p.pos.z - origin.z).toBeLessThan(-10); // confirms the entrance really is south of centre

    killAll(sim, inst);
    pass(sim);

    expect(armedChestsIn(sim, inst).length).toBe(1);
    expect(lockedOut(sim, pid)).toBe(true);
  });
});

describe('source cave clear: occupancy band is clamped for an oversized cave', () => {
  it('a player past the clamp is treated as outside, never as the neighbor slot occupant', () => {
    // Regression guard: buildSourceCaveSpec grows one module per 4 roster entries with no
    // cap (O1 is still open), so a large enough roster would push
    // delveModuleStackEndRelZ(modules) past DELVE_SLOT_SPACING (620) and, unclamped, the
    // occupancy band would reach into the next cave slot's own south margin. Simulate an
    // oversized cave by padding the spec's module list well past what any wired roster
    // produces today, and confirm a player standing where the UNCLAMPED band would have
    // reached (dz > 620 - 40 = 580) is NOT credited: no lockout, no chest recipient.
    const sim = makeSim();
    const pid = addLvl20(sim, 'Alice');
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const inst = claimedCave(sim);
    const origin = sourceCaveOrigin(inst.slot);
    const spec = sim.sourceCave.spec;

    const paddedModules = Array.from({ length: 6 }, () => spec.modules).flat();
    const unclampedNorth = delveModuleZOffset(paddedModules, paddedModules.length - 1) + 91 + 40;
    expect(unclampedNorth).toBeGreaterThan(580); // the oversized cave really does exceed the clamp
    spec.modules = paddedModules;

    // Just past the clamp, but still short of where the padded (unclamped) band would end.
    const p = sim.entities.get(pid) as Entity;
    teleport(sim, p, origin.x, origin.z + 590);

    killAll(sim, inst);
    pass(sim);

    expect(armedChestsIn(sim, inst).length).toBe(0); // no recipient present -> not armed yet
    expect(lockedOut(sim, pid)).toBe(false);
  });

  // The prior test only proves the clamp exists (590 is 10u past it); these two pin the
  // exact boundary value (580 = DELVE_SLOT_SPACING(620) - SOURCE_CAVE_OCCUPANCY_SOUTH(40))
  // so a regression that drifts the clamp by a few units, not just one that removes it,
  // is caught.
  function paddedCave(sim: AnySim) {
    const pid = addLvl20(sim, 'Alice');
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const inst = claimedCave(sim);
    const spec = sim.sourceCave.spec;
    spec.modules = Array.from({ length: 6 }, () => spec.modules).flat();
    return { pid, inst };
  }

  it('a player 1u inside the clamp (dz=549) is still credited', () => {
    const sim = makeSim();
    const { pid, inst } = paddedCave(sim);
    const origin = sourceCaveOrigin(inst.slot);
    teleport(sim, sim.entities.get(pid) as Entity, origin.x, origin.z + 549);
    killAll(sim, inst);
    pass(sim);
    expect(armedChestsIn(sim, inst).length).toBe(1);
    expect(lockedOut(sim, pid)).toBe(true);
  });

  it('a player exactly at the clamp (dz=550) is excluded', () => {
    const sim = makeSim();
    const { pid, inst } = paddedCave(sim);
    const origin = sourceCaveOrigin(inst.slot);
    teleport(sim, sim.entities.get(pid) as Entity, origin.x, origin.z + 550);
    killAll(sim, inst);
    pass(sim);
    expect(armedChestsIn(sim, inst).length).toBe(0);
    expect(lockedOut(sim, pid)).toBe(false);
  });
});

describe('source cave clear: occupancy predicate per-dimension negatives', () => {
  it('a player south of the entrance margin is excluded', () => {
    const sim = makeSim();
    const pid = addLvl20(sim, 'Alice');
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const inst = claimedCave(sim);
    const origin = sourceCaveOrigin(inst.slot);
    teleport(sim, sim.entities.get(pid) as Entity, origin.x, origin.z - 80); // past the -70 margin
    killAll(sim, inst);
    pass(sim);
    expect(armedChestsIn(sim, inst).length).toBe(0); // no recipient present -> not armed yet
    expect(lockedOut(sim, pid)).toBe(false);
  });

  it('a player outside the x-band is excluded even at a credited z', () => {
    const sim = makeSim();
    const pid = addLvl20(sim, 'Alice');
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const inst = claimedCave(sim);
    const origin = sourceCaveOrigin(inst.slot);
    // Same z as the finale-dais test above, but well outside the 120u x-band.
    teleport(sim, sim.entities.get(pid) as Entity, origin.x + 200, origin.z + 100);
    killAll(sim, inst);
    pass(sim);
    expect(armedChestsIn(sim, inst).length).toBe(0);
    expect(lockedOut(sim, pid)).toBe(false);
  });
});

describe('source cave clear: lockout grant recipients', () => {
  it('the grant applies to everyone inside at clear time, and to nobody outside', () => {
    const sim = makeSim();
    const a = addLvl20(sim, 'Alice');
    const b = addLvl20(sim, 'Bob');
    const c = addLvl20(sim, 'Cara');
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, a);
    const inst = claimedCave(sim);
    const pa = sim.entities.get(a) as Entity;

    // Bob is physically inside Alice's instance; Cara stays out in the overworld.
    teleport(sim, sim.entities.get(b) as Entity, pa.pos.x, pa.pos.z);
    // Cara is left at her overworld spawn (well outside the cave x-band).
    expect((sim.entities.get(c) as Entity).pos.x).toBeLessThan(4000);

    killAll(sim, inst);
    pass(sim);

    expect(armedChestsIn(sim, inst).length).toBe(1);
    expect(lockedOut(sim, a)).toBe(true);
    expect(lockedOut(sim, b)).toBe(true);
    expect(lockedOut(sim, c)).toBe(false);
  });

  it('leave-then-clear: a player who left before the clear is not locked, one who stayed is', () => {
    const sim = makeSim();
    const a = addLvl20(sim, 'Alice');
    const b = addLvl20(sim, 'Bob');
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, a);
    const inst = claimedCave(sim);
    const pa = sim.entities.get(a) as Entity;
    const pb = sim.entities.get(b) as Entity;

    // Both inside, then Bob leaves (walks back out to the overworld) before the clear.
    teleport(sim, pb, pa.pos.x, pa.pos.z);
    teleport(sim, pb, 0, 0); // overworld

    killAll(sim, inst);
    pass(sim);

    expect(armedChestsIn(sim, inst).length).toBe(1);
    expect(lockedOut(sim, a)).toBe(true);
    expect(lockedOut(sim, b)).toBe(false);
  });

  it('a player entering after the chest has already spawned gets no lockout (nor a second chest)', () => {
    const sim = makeSim();
    const a = addLvl20(sim, 'Alice');
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, a);
    const inst = claimedCave(sim);

    killAll(sim, inst);
    pass(sim);
    expect(armedChestsIn(sim, inst).length).toBe(1);
    expect(lockedOut(sim, a)).toBe(true);

    // Bob steps into the same (still-claimed) instance only after the clear already fired.
    const b = addLvl20(sim, 'Bob');
    const origin = sourceCaveOrigin(inst.slot);
    teleport(sim, sim.entities.get(b) as Entity, origin.x, origin.z);
    pass(sim);

    expect(lockedOut(sim, b)).toBe(false);
    expect(chestsIn(sim, inst).length).toBe(1); // still exactly one chest entity
    expect(armedChestsIn(sim, inst).length).toBe(1); // and it was armed exactly once
  });
});

describe('source cave clear: guard resets when the instance frees', () => {
  it('a re-claimed slot spawns a fresh chest (objectIds guard is self-resetting)', () => {
    const sim = makeSim();
    const a = addLvl20(sim, 'Alice');
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, a);
    const inst = claimedCave(sim);

    killAll(sim, inst);
    pass(sim);
    const firstChests = armedChestsIn(sim, inst);
    expect(firstChests.length).toBe(1);
    const firstChestId = firstChests[0].id;

    // Empty the instance so it frees on the next pass: move Alice out and age it out.
    teleport(sim, sim.entities.get(a) as Entity, 0, 0);
    inst.emptyFor = INSTANCE_EMPTY_TIMEOUT - 1;
    pass(sim);
    expect(inst.partyKey).toBeNull();
    expect(inst.objectIds.length).toBe(0);
    expect(inst.mobIds.length).toBe(0);
    expect(sim.entities.get(firstChestId)).toBeUndefined(); // old chest dropped

    // A fresh (never-locked) player re-claims a cave slot and clears it.
    const d = addLvl20(sim, 'Dana');
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, d);
    const inst2 = claimedCave(sim);
    expect(inst2).toBeDefined();
    killAll(sim, inst2);
    pass(sim);

    const secondChests = armedChestsIn(sim, inst2);
    expect(secondChests.length).toBe(1);
    expect(secondChests[0].id).not.toBe(firstChestId); // a genuinely new chest
    expect(lockedOut(sim, d)).toBe(true);
  });
});

describe('source cave clear: kill-progress SimEvents', () => {
  function progressLines(events: SimEvent[]): string[] {
    return events
      .filter((e): e is SimEvent & { type: 'log'; text: string } => e.type === 'log')
      .map((e) => e.text);
  }

  it('each cave-mob kill emits a verbatim-login progress line to those inside', () => {
    const sim = makeSim();
    const pid = addLvl20(sim, 'Alice');
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const inst = claimedCave(sim);
    const total = inst.mobIds.length;
    sim.drainEvents(); // clear enter/setup emits

    for (let i = 0; i < total; i++) {
      const mob = sim.entities.get(inst.mobIds[i]) as Entity;
      mob.dead = true; // handleDeath sets this before calling the hook
      mob.hp = 0;
      onSourceCaveMobKilled(sim.ctx, mob);
      const lines = progressLines(sim.drainEvents());
      const killed = i + 1;
      const progress = lines.find((l) => l.includes('has fallen.'));
      expect(progress, `progress line for kill ${killed}`).toBe(
        `${mob.name} has fallen. (${killed} of ${total} defeated in the Source Cave)`,
      );
      // The distinct clear line appears only on the final kill.
      const cleared = lines.includes('The Source Cave has been cleared.');
      expect(cleared).toBe(killed === total);
    }
  });

  it('the progress hook is wired into handleDeath and is a no-op for non-cave mobs', () => {
    const sim = makeSim();
    const pid = addLvl20(sim, 'Alice');
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const inst = claimedCave(sim);
    const killer = sim.entities.get(pid) as Entity;
    sim.drainEvents();

    const mob = sim.entities.get(inst.mobIds[0]) as Entity;
    const login = mob.name;
    sim.handleDeath(mob, killer);
    const lines = progressLines(sim.drainEvents());
    expect(
      lines.some(
        (l) =>
          l === `${login} has fallen. (1 of ${inst.mobIds.length} defeated in the Source Cave)`,
      ),
    ).toBe(true);
  });

  it('ignores a visible non-combatant death in progress and clear accounting', () => {
    const sourceCaveRoster: SourceCaveRosterEntry[] = Array.from({ length: 60 }, (_, i) => ({
      login: `contributor-${i}`,
      mergedPrs: i === 0 ? 90 : i < 7 ? 30 : i < 13 ? 15 : i < 21 ? 5 : 1,
      rank: i + 1,
    }));
    const sim = makeSim(1234, sourceCaveRoster);
    const pid = addLvl20(sim, 'Alice');
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const inst = claimedCave(sim);
    const combatIds = new Set<number>(inst.sourceCaveEncounter.waves.flat());
    const spectatorId = inst.mobIds.find((id: number) => !combatIds.has(id)) as number;
    const spectator = sim.entities.get(spectatorId) as Entity;
    sim.drainEvents();

    spectator.dead = true;
    spectator.hp = 0;
    onSourceCaveMobKilled(sim.ctx, spectator);

    expect(progressLines(sim.drainEvents())).toEqual([]);
    expect(combatIds.size).toBe(37);
  });
});

describe('source cave clear: looting the reward chest', () => {
  it('interacting with the sealed chest is denied with "Access denied." and grants nothing', () => {
    const sim = makeSim();
    const pid = addLvl20(sim, 'Alice');
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const inst = claimedCave(sim);

    const chest = chestsIn(sim, inst)[0];
    expect(chest).toBeDefined();
    const p = sim.entities.get(pid) as Entity;
    teleport(sim, p, chest.pos.x, chest.pos.z);
    p.targetId = chest.id;
    sim.drainEvents();
    interact(sim.ctx, pid);

    const events = sim.drainEvents() as SimEvent[];
    expect(events.some((e: SimEvent) => e.type === 'error' && e.text === 'Access denied.')).toBe(
      true,
    );
    // Nothing granted, nothing consumed: the chest is untouched and still sealed.
    expect(chest.loot).toBeNull();
    expect(chest.lootable).toBe(true);
    expect(chest.templateId).toBe(SOURCE_CAVE_CHEST_SEALED_TEMPLATE);
    expect(chest.lootRecipientIds).toBeUndefined();
  });

  it('the interact command loots the armed chest (shared classic loot), not pickUpObject', () => {
    const sim = makeSim();
    const pid = addLvl20(sim, 'Alice');
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const inst = claimedCave(sim);
    killAll(sim, inst);
    updateInstances(sim.ctx);

    const chest = armedChestsIn(sim, inst)[0];
    expect(chest).toBeDefined();
    expect(chest.loot).not.toBeNull();
    const loot = chest.loot as { items: { itemId: string; personalFor?: number[] }[] };
    const before = [...loot.items.map((s) => s.itemId)];
    expect(before.length).toBeGreaterThan(0);

    // Target the chest and interact (current-target path); chest is a null-objectItemId
    // object, so pickUpObject would no-op: only the lootCorpse route grants the item.
    // Alice is solo, so the shared slots resolve looter-takes-all directly into her bags.
    const p = sim.entities.get(pid) as Entity;
    teleport(sim, p, chest.pos.x, chest.pos.z);
    p.targetId = chest.id;
    interact(sim.ctx, pid);

    for (const itemId of before) {
      expect(sim.countItem(itemId, pid)).toBeGreaterThanOrEqual(1);
    }
    expect(chest.loot).toBeNull(); // fully consumed and pruned
  });

  it('an emptied chest never re-highlights as lootable (respawnTimer is Infinity, not 0)', () => {
    // Regression guard: object entities default to respawnTimer 0. The generic per-tick
    // object-respawn loop (sim.ts) flips a non-lootable object back to lootable once its
    // respawnTimer counts down past 0, which happens on the VERY NEXT tick if the chest
    // never sets its own respawnTimer. Without spawnSourceCaveChest's explicit
    // `respawnTimer = Infinity` (world-boss corpse precedent), a fully-looted chest would
    // reappear as lootable-but-empty forever, one tick after being emptied.
    const sim = makeSim();
    const pid = addLvl20(sim, 'Alice');
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const inst = claimedCave(sim);
    killAll(sim, inst);
    updateInstances(sim.ctx);

    const chest = armedChestsIn(sim, inst)[0];
    const p = sim.entities.get(pid) as Entity;
    teleport(sim, p, chest.pos.x, chest.pos.z);
    p.targetId = chest.id;
    interact(sim.ctx, pid); // Alice is the only recipient: this empties every slot.

    expect(chest.loot).toBeNull();
    expect(chest.lootable).toBe(false);

    for (let i = 0; i < 40; i++) sim.tick(); // 2 in-game seconds of the per-tick object loop
    expect(chest.lootable).toBe(false);
    expect(chest.loot).toBeNull();
  });
});
