// Delve system, spatial band, lifecycle, death rules, and pet stow (Phase 1).

import { describe, expect, it } from 'vitest';
import { DELVE_AFFIXES } from '../src/sim/content/delves/affixes';
import { delveChestItemsForTier } from '../src/sim/content/delves/lockpick_tiers';
import {
  ARENA_X,
  ARENA_X_MIN,
  DELVE_BAND_X_MIN,
  DELVE_LIST,
  DELVE_MODULES,
  DELVE_X_MIN,
  DELVES,
  delveAt,
  delveModuleZOffset,
  delveOrigin,
  dungeonAt,
  isArenaPos,
  isDelvePos,
  MOBS,
} from '../src/sim/data';
import { DELVE_MODULE_LAYOUTS, delveModuleColliders } from '../src/sim/delve_layout';
import {
  LITANY_MODULE_IDS,
  litanyModuleGeometry,
  litanyModuleIsNonRectangular,
} from '../src/sim/delve_litany_layout';
import { isLitanyPuzzleKind, LITANY_PUZZLE_KINDS } from '../src/sim/delves/drowned_litany_rooms';
import { rollDelveAffixes } from '../src/sim/delves/runs';
import { createMob } from '../src/sim/entity';
import { polygonContainsPoint } from '../src/sim/geometry2d';
import { solveLockActions } from '../src/sim/lockpick';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import { Rng } from '../src/sim/rng';
import { DELVE_IMPLEMENTED_AFFIXES, Sim } from '../src/sim/sim';
import { DT } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

function makeSim(cls: 'warrior' | 'warlock' = 'warrior', seed = 42) {
  return new Sim({ seed, playerClass: cls, autoEquip: true });
}

function teleport(sim: Sim, x: number, z: number) {
  const p = sim.player;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = terrainHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

function enterReliquary(sim: Sim, tier: 'normal' | 'heroic' = 'normal') {
  // Heroic now has a hard minPlayerLevel gate (9); Normal uses the delve floor (7).
  const heroicTier = DELVES.collapsed_reliquary.tiers.find((t) => t.id === 'heroic');
  const level =
    tier === 'heroic'
      ? (heroicTier?.minPlayerLevel ?? DELVES.collapsed_reliquary.minLevel)
      : DELVES.collapsed_reliquary.minLevel;
  sim.setPlayerLevel(level);
  const door = DELVES.collapsed_reliquary.doorPos;
  teleport(sim, door.x, door.z);
  sim.enterDelve('collapsed_reliquary', tier);
}

function enterLitany(sim: Sim, tier: 'normal' | 'heroic' = 'normal') {
  const heroicTier = DELVES.drowned_litany.tiers.find((t) => t.id === 'heroic');
  const level =
    tier === 'heroic'
      ? (heroicTier?.minPlayerLevel ?? DELVES.drowned_litany.minLevel)
      : DELVES.drowned_litany.minLevel;
  sim.setPlayerLevel(level);
  const door = DELVES.drowned_litany.doorPos;
  teleport(sim, door.x, door.z);
  sim.enterDelve('drowned_litany', tier);
}

function castAndFinish(sim: Sim, id: string) {
  sim.castAbility(id);

  for (let i = 0; i < 20 * 12 && sim.player.castingAbility; i++) sim.tick();
}

function killPlayer(sim: Sim) {
  (sim as any).dealDamage(
    null,
    sim.player,
    sim.player.maxHp + 100,
    false,
    'physical',
    null,
    'hit',
    true,
  );
}

describe('delve spatial band', () => {
  it('DELVE_X_MIN is past the arena band', () => {
    expect(DELVE_X_MIN).toBeGreaterThan(ARENA_X);

    expect(DELVE_X_MIN).toBeGreaterThan(ARENA_X_MIN);
  });

  it('delveOrigin places instances at or beyond DELVE_X_MIN', () => {
    const o = delveOrigin(0, 0);

    expect(o.x).toBeGreaterThanOrEqual(DELVE_X_MIN);

    expect(delveOrigin(1, 2).x).toBe(DELVE_X_MIN + 600);
  });

  it('isDelvePos and delveAt agree; dungeonAt returns null for delve x', () => {
    const x = delveOrigin(0, 0).x;

    expect(isDelvePos(x)).toBe(true);

    expect(delveAt(x)?.id).toBe('collapsed_reliquary');

    expect(dungeonAt(x)).toBeNull();
  });

  it('arena and dungeon bands do not overlap delve band', () => {
    expect(isDelvePos(ARENA_X)).toBe(false);

    expect(isDelvePos(2700)).toBe(false);

    expect(isDelvePos(DELVE_X_MIN)).toBe(true);

    expect(isArenaPos(ARENA_X)).toBe(true);

    expect(isArenaPos(DELVE_X_MIN)).toBe(false);
  });

  it('isDelvePos covers the full room footprint west of DELVE_X_MIN (regression: camera yank bug)', () => {
    // Rooms are ~50 u wide, centred at DELVE_X_MIN (4800). Delve side walls sit at
    // instance-local |x| = 25 (delve_layout WALL_X), collider outer face at |x| = 26,
    // i.e. world-x = 4774 (slot 0). Before DELVE_BAND_X_MIN, the west half of the room
    // was misclassified as isArenaPos, yanking the camera toward the arena band.
    const origin = delveOrigin(0, 0); // { x: DELVE_X_MIN, z: ... }

    // West half of the room must still be a delve pos
    expect(isDelvePos(origin.x - 2)).toBe(true); // 4798, exact repro coordinate
    expect(isDelvePos(origin.x - 22)).toBe(true); // walkable west edge
    expect(isDelvePos(origin.x - 26)).toBe(true); // west wall outer face (4774)
    expect(isDelvePos(origin.x)).toBe(true); // room centre
    expect(isDelvePos(origin.x + 22)).toBe(true); // walkable east edge
    expect(isDelvePos(origin.x + 26)).toBe(true); // wall outer face east

    // isArenaPos must be false for all of the above
    expect(isArenaPos(origin.x - 2)).toBe(false);
    expect(isArenaPos(origin.x - 26)).toBe(false);
    expect(isArenaPos(origin.x)).toBe(false);

    // Bands are mutually exclusive, no x where both are true
    expect(isDelvePos(DELVE_BAND_X_MIN) && isArenaPos(DELVE_BAND_X_MIN)).toBe(false);
    expect(isDelvePos(DELVE_BAND_X_MIN - 1) && isArenaPos(DELVE_BAND_X_MIN - 1)).toBe(false);

    // delveAt resolves correctly across the whole west half of the room
    expect(delveAt(origin.x - 2)?.index).toBe(0); // DELVE_X_MIN - 2
    expect(delveAt(origin.x - 26)?.index).toBe(0); // west wall outer face (4774)
    expect(delveAt(origin.x)?.index).toBe(0); // room centre

    // Arena still classifies correctly (arena instances live at ARENA_X = 4200)
    expect(isArenaPos(ARENA_X)).toBe(true);
    expect(isDelvePos(ARENA_X)).toBe(false);
  });

  it('pins the absolute 4800 boundary against the arena seam (relocation regression)', () => {
    // DELVE_X_MIN moved 3600 -> 4800 when v0.10.0 pushed the arena to x=4200.
    // Pin the load-bearing constant and the exact arena/delve seam so a future
    // arena or delve respacing that re-introduces overlap fails here.
    expect(DELVE_X_MIN).toBe(4800);
    // The seam: DELVE_BAND_X_MIN is the first delve x; the x just below it is arena.
    expect(isArenaPos(DELVE_BAND_X_MIN - 1)).toBe(true);
    expect(isDelvePos(DELVE_BAND_X_MIN - 1)).toBe(false);
    expect(isDelvePos(DELVE_BAND_X_MIN)).toBe(true);
    expect(isArenaPos(DELVE_BAND_X_MIN)).toBe(false);
    // Keep a real gap between the arena anchor and the delve band.
    expect(DELVE_BAND_X_MIN - ARENA_X).toBeGreaterThanOrEqual(500);
  });

  it('a character saved inside a delve relogs at the board door, not a dungeon door (FR-1.6)', () => {
    // Regression: addPlayer's dungeon-sanitization branch ran first for ANY far-off
    // x (the delve band included). Because dungeonAt() returns null past the arena,
    // its `?? DUNGEON_LIST[0]` fallback ejected a delve-saved player to a dungeon
    // door and the delve branch (which never re-fired) was dead code. Delve wins now.
    const src = makeSim();
    const state = src.serializeCharacter(src.playerId)!;
    const origin = delveOrigin(0, 0);
    state.pos = { x: origin.x, z: origin.z + 20 }; // deep inside delve slot 0
    const dst = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true, noPlayer: true });
    const pid = dst.addPlayer('warrior', 'Relogged', { state });
    const e = (dst as any).entities.get(pid)!;
    const door = DELVES.collapsed_reliquary.doorPos; // Brother Halven board door {-5,-52}
    expect(Math.abs(e.pos.x - door.x)).toBeLessThan(1); // at the board door (-5), NOT a dungeon door (~80)
    expect(Math.abs(e.pos.z - (door.z - 4))).toBeLessThan(1); // z-4 eject offset
    expect(isDelvePos(e.pos.x)).toBe(false); // no longer stuck in the delve band
  });

  it('enterReliquary places player in delve band near instance origin', () => {
    const sim = makeSim();

    enterReliquary(sim);

    const run = sim.delveRunForPlayer(sim.playerId)!;

    const p = sim.player;

    expect(isDelvePos(p.pos.x)).toBe(true);

    expect(Math.abs(p.pos.x - run.origin.x)).toBeLessThan(200);

    expect(Math.abs(p.pos.z - run.origin.z)).toBeLessThan(250);

    expect(delveModuleZOffset(run.modules, 0)).toBe(8);
  });
});

describe('delve registry', () => {
  it('registers the Collapsed Reliquary delve', () => {
    expect(DELVES.collapsed_reliquary).toBeDefined();
    expect(DELVE_LIST.length).toBeGreaterThanOrEqual(1);
  });

  it('every shipped delve resolves all of its module layouts', () => {
    // A delve whose modules reference a layout id missing from
    // DELVE_MODULE_LAYOUTS crashes the shared sim loop the first time anyone
    // moves inside it (delveModuleColliders reads an undefined layout): a
    // realm-wide DoS. Guard it at the data layer so bad delve content fails
    // CI here instead of on the live tick.
    for (const delve of DELVE_LIST) {
      for (const modId of [...delve.modules, delve.finaleModuleId]) {
        expect(
          DELVE_MODULE_LAYOUTS[modId as keyof typeof DELVE_MODULE_LAYOUTS],
          `${delve.id} references module '${modId}' with no layout`,
        ).toBeDefined();
      }
    }
  });
});

describe('delve lifecycle', () => {
  it('more than six solo parties can hold their own Collapsed Reliquary run at once', () => {
    const sim = makeSim();
    const PARTIES = 8; // was capped at 6 concurrent delve runs before the bump
    const pids = [sim.playerId];
    for (let i = 1; i < PARTIES; i++) {
      pids.push(sim.addPlayer('warrior', `Delver${i}`));
    }

    for (const pid of pids) {
      sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel, pid);
      sim.drainEvents();
      sim.enterDelve('collapsed_reliquary', 'normal', pid);
      const events = sim.drainEvents();
      expect(
        events.some((e) => e.type === 'error' && /All instances of .* are busy/.test(e.text ?? '')),
      ).toBe(false);
    }

    const claimed = sim.delveRuns.filter(
      (run) => run.delveId === 'collapsed_reliquary' && run.partyKey !== null,
    );
    expect(claimed.length).toBe(PARTIES);
    // every claimed solo player landed in a distinct run slot (no double-booking)
    expect(new Set(claimed.map((run) => run.slot)).size).toBe(PARTIES);
  });

  it('refuses entry to a party of 3+ (delves are solo or duo only)', () => {
    const sim = makeSim();
    const p2 = sim.addPlayer('warrior', 'Duoist');
    const p3 = sim.addPlayer('warrior', 'ThirdWheel');
    sim.partyInvite(p2, sim.playerId);
    sim.partyAccept(p2);
    sim.partyInvite(p3, sim.playerId);
    sim.partyAccept(p3);
    for (const pid of [sim.playerId, p2, p3]) {
      sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel, pid);
    }
    sim.drainEvents();
    sim.enterDelve('collapsed_reliquary', 'normal');
    const events = sim.drainEvents();
    expect(events.some((e) => e.type === 'error' && /solo or duo/i.test(e.text ?? ''))).toBe(true);
    expect(sim.delveRunForPlayer(sim.playerId)).toBeNull();
  });

  it('allows a duo (party of 2) to enter together', () => {
    const sim = makeSim();
    const p2 = sim.addPlayer('warrior', 'Duoist');
    sim.partyInvite(p2, sim.playerId);
    sim.partyAccept(p2);
    for (const pid of [sim.playerId, p2]) {
      sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel, pid);
    }
    sim.drainEvents();
    sim.enterDelve('collapsed_reliquary', 'normal');
    const events = sim.drainEvents();
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(sim.delveRunForPlayer(sim.playerId)).not.toBeNull();
  });

  it('a duo entering the same delve does not land on top of each other', () => {
    const sim = makeSim();
    const p2 = sim.addPlayer('warrior', 'Duoist');
    sim.partyInvite(p2, sim.playerId);
    sim.partyAccept(p2);
    for (const pid of [sim.playerId, p2]) {
      sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel, pid);
    }
    sim.enterDelve('collapsed_reliquary', 'normal', sim.playerId);
    sim.enterDelve('collapsed_reliquary', 'normal', p2);
    const p1Pos = sim.player.pos;
    const p2Pos = sim.entities.get(p2)!.pos;
    expect(Math.hypot(p1Pos.x - p2Pos.x, p1Pos.z - p2Pos.z)).toBeGreaterThan(0.5);
  });

  it('a party member who never walked through the door is not pulled into the run', () => {
    const sim = makeSim();
    const afk = sim.addPlayer('warrior', 'AwayFromKeyboard');
    sim.partyInvite(afk, sim.playerId);
    sim.partyAccept(afk);
    // afk stays out in the overworld, never calling enterDelve.
    enterReliquary(sim);
    const run = sim.delveRunForPlayer(sim.playerId)!;
    const afkEntry = sim.entities.get(afk)!;
    const afkStartPos = { ...afkEntry.pos };
    expect(isDelvePos(afkEntry.pos.x)).toBe(false);
    // Advance far enough to open/traverse a module boundary if reachable; the afk
    // member must never be teleported in by a party-wide delve transition.
    (sim as any).advanceDelveModule(run);
    expect(afkEntry.pos).toEqual(afkStartPos);
    expect(isDelvePos(afkEntry.pos.x)).toBe(false);
  });

  it('enter and leave toggle delve position band', () => {
    const sim = makeSim();
    enterReliquary(sim);
    expect(isDelvePos(sim.player.pos.x)).toBe(true);
    const run = sim.delveRunForPlayer(sim.playerId);
    expect(run).not.toBeNull();
    expect(run?.modules.length).toBeGreaterThan(0);
    sim.leaveDelve();
    expect(isDelvePos(sim.player.pos.x)).toBe(false);
  });

  it('same seed picks the same module order', () => {
    const runModules = (seed: number) => {
      const sim = makeSim('warrior', seed);
      enterReliquary(sim);
      const run = sim.delveRunForPlayer(sim.playerId);
      if (run === null) {
        throw new Error('Expected active delve run');
      }
      return [...run.modules];
    };
    expect(runModules(100)).toEqual(runModules(100));
    expect(runModules(200)).toEqual(runModules(200));
  });
});

describe('delve death rules', () => {
  it('first death respawns at module entry with 50% HP', () => {
    const sim = makeSim();
    enterReliquary(sim);
    const entry = { ...sim.player.pos };
    killPlayer(sim);
    expect(sim.player.dead).toBe(true);
    sim.releaseSpirit();
    expect(sim.player.dead).toBe(false);
    expect(sim.player.hp).toBe(Math.round(sim.player.maxHp * 0.5));
    expect(isDelvePos(sim.player.pos.x)).toBe(true);
    expect(Math.abs(sim.player.pos.x - entry.x)).toBeLessThan(1);
  });

  it('second death fails the run and ejects to the board door', () => {
    const sim = makeSim();
    enterReliquary(sim);
    killPlayer(sim);
    sim.releaseSpirit();
    killPlayer(sim);
    sim.releaseSpirit();
    // failDelveRun emits delveFailed; it is queued and drained on the next tick.
    const events = sim.tick();
    expect(
      events.some((e) => e.type === 'delveFailed' && e.delveId === 'collapsed_reliquary'),
    ).toBe(true);
    expect(isDelvePos(sim.player.pos.x)).toBe(false);
    expect(sim.player.dead).toBe(false);
    expect(sim.player.hp).toBe(sim.player.maxHp);
    const door = DELVES.collapsed_reliquary.doorPos;
    expect(Math.hypot(sim.player.pos.x - door.x, sim.player.pos.z - (door.z - 4))).toBeLessThan(2);
  });
});

describe('delve pet stow', () => {
  it('stows warlock demon on enter and restores on leave', () => {
    const sim = makeSim('warlock');
    sim.setPlayerLevel(10);
    castAndFinish(sim, 'summon_imp');
    expect(sim.petOf(sim.playerId)).not.toBeNull();
    const door = DELVES.collapsed_reliquary.doorPos;
    teleport(sim, door.x, door.z);
    sim.enterDelve('collapsed_reliquary', 'normal');
    expect(sim.petOf(sim.playerId)).toBeNull();
    sim.leaveDelve();
    expect(sim.petOf(sim.playerId)).not.toBeNull();
    expect(sim.petOf(sim.playerId)?.templateId).toBe('emberkin');
  });

  it('trying to summon a stowed pet inside a delve explains why, instead of "you have no pet"', () => {
    const sim = makeSim('warlock');
    sim.setPlayerLevel(10);
    castAndFinish(sim, 'summon_imp');
    expect(sim.petOf(sim.playerId)).not.toBeNull();
    const door = DELVES.collapsed_reliquary.doorPos;
    teleport(sim, door.x, door.z);
    sim.enterDelve('collapsed_reliquary', 'normal');
    expect(sim.petOf(sim.playerId)).toBeNull();
    sim.drainEvents();
    sim.setPetMode('aggressive');
    const events = sim.drainEvents();
    expect(events.some((e) => e.type === 'error' && e.text === 'You have no pet.')).toBe(false);
    expect(
      events.some(
        (e) => e.type === 'error' && e.text === 'Pets are not allowed inside the delves.',
      ),
    ).toBe(true);
  });

  it('a petless pet command in the overworld still says "You have no pet."', () => {
    const sim = makeSim('warlock');
    sim.setPlayerLevel(10);
    expect(sim.petOf(sim.playerId)).toBeNull();
    sim.drainEvents();
    sim.setPetMode('aggressive');
    const events = sim.drainEvents();
    // The delve-aware arm must not leak outside: the plain message is the
    // overworld contract (a regression making noPetError unconditional on the
    // delve string would go uncaught without this arm).
    expect(events.some((e) => e.type === 'error' && e.text === 'You have no pet.')).toBe(true);
    expect(
      events.some(
        (e) => e.type === 'error' && e.text === 'Pets are not allowed inside the delves.',
      ),
    ).toBe(false);
  });

  it('restorePetFromDelveStash keeps the stash entry if the owner entity is not yet registered', () => {
    const sim = makeSim('warlock');
    sim.setPlayerLevel(10);
    castAndFinish(sim, 'summon_imp');
    const door = DELVES.collapsed_reliquary.doorPos;
    teleport(sim, door.x, door.z);
    sim.enterDelve('collapsed_reliquary', 'normal');
    expect((sim as any).delvePetStash.has(sim.playerId)).toBe(true);
    const removed = (sim as any).entities.get(sim.playerId);
    (sim as any).entities.delete(sim.playerId);
    (sim as any).restorePetFromDelveStash(sim.playerId);
    // The stash entry must survive since the entity wasn't there to restore onto.
    expect((sim as any).delvePetStash.has(sim.playerId)).toBe(true);
    (sim as any).entities.set(sim.playerId, removed);
    (sim as any).restorePetFromDelveStash(sim.playerId);
    expect((sim as any).delvePetStash.has(sim.playerId)).toBe(false);
    expect(sim.petOf(sim.playerId)).not.toBeNull();
  });
});

describe('delve interactables and affixes', () => {
  it('heroic affix roll is deterministic per seed', () => {
    const affixes = (seed: number) => {
      const sim = makeSim('warrior', seed);
      enterReliquary(sim, 'heroic');
      const run = sim.delveRunForPlayer(sim.playerId);
      if (run === null) {
        throw new Error('Expected active delve run');
      }
      return [...run.affixes];
    };
    expect(affixes(42)).toEqual(affixes(42));
    expect(affixes(42).length).toBe(1);
  });

  it('pressure plate opens linked door only after all plates triggered', () => {
    const sim = makeSim();
    enterReliquary(sim);
    const run = sim.delveRunForPlayer(sim.playerId)!;
    run.modules = ['reliquary_sunken_ossuary'];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);
    const plates = run.objectIds
      .map((id) => ({ id, state: run.objectState[id] }))
      .filter((o) => o.state?.kind === 'pressure_plate');
    const door = run.objectIds
      .map((id) => ({ id, state: run.objectState[id] }))
      .find((o) => o.state?.kind === 'locked_door');
    expect(plates.length).toBeGreaterThanOrEqual(2);
    expect(door).toBeDefined();
    expect(door?.state.open).toBe(false);
    // First plate: door still closed (requires all plates).
    const plate1Ent = sim.entities.get(plates[0]!.id)!;
    sim.player.pos = { ...plate1Ent.pos };
    sim.player.prevPos = { ...plate1Ent.pos };
    sim.tick();
    expect(run.objectState[door!.id].open).toBe(false);
    // Second plate: door now opens.
    const plate2Ent = sim.entities.get(plates[1]!.id)!;
    sim.player.pos = { ...plate2Ent.pos };
    sim.player.prevPos = { ...plate2Ent.pos };
    sim.tick();
    expect(run.objectState[door!.id].open).toBe(true);
  });

  it('grave interrupt cancels Raise Dead summon', () => {
    const sim = makeSim();
    enterReliquary(sim);
    const run = sim.delveRunForPlayer(sim.playerId)!;
    run.modules = ['reliquary_finale'];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);
    const boss = [...sim.entities.values()].find((e) => e.templateId === 'deacon_varric')!;
    boss.inCombat = true;
    boss.hp = Math.ceil(boss.maxHp * 0.55);
    (sim as any).updateBossMechanics(boss);
    expect(run.raiseDeadChannel).not.toBeNull();
    const graveId = run.raiseDeadChannel!.graveId;
    sim.player.pos = { ...sim.entities.get(graveId)!.pos };
    sim.player.prevPos = { ...sim.player.pos };
    sim.delveInteract(graveId);
    expect(run.raiseDeadChannel).toBeNull();
    const before = [...sim.entities.values()].filter(
      (e) => e.templateId === 'reliquary_bonewalker',
    ).length;
    for (let i = 0; i < 20 * 6; i++) sim.tick();
    const after = [...sim.entities.values()].filter(
      (e) => e.templateId === 'reliquary_bonewalker',
    ).length;
    expect(after).toBe(before);
  });

  it('clears trash and opens exit portal at module far end', () => {
    const sim = makeSim();
    enterReliquary(sim);
    const run = sim.delveRunForPlayer(sim.playerId)!;
    run.modules = ['reliquary_bell_niche', 'reliquary_finale'];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);
    const exitId = run.objectIds.find((id) => run.objectState[id]?.kind === 'module_exit');
    expect(exitId).toBeDefined();
    expect(run.exitPortalOpen).toBe(false);
    for (const id of [...run.mobIds]) {
      const mob = sim.entities.get(id);
      if (mob && !mob.dead)
        (sim as any).dealDamage(
          sim.player,
          mob,
          mob.maxHp + 1,
          false,
          'physical',
          null,
          'hit',
          true,
        );
    }
    sim.tick();
    expect(run.exitPortalOpen).toBe(true);
    const portal = sim.entities.get(exitId!)!;
    sim.player.pos = { ...portal.pos };
    sim.player.prevPos = { ...portal.pos };
    sim.tick();
    expect(run.moduleIndex).toBe(1);
    expect(run.modules[run.moduleIndex]).toBe('reliquary_finale');
  });

  it('pressure plate required before exit opens when module has one', () => {
    const sim = makeSim();
    enterReliquary(sim);
    const run = sim.delveRunForPlayer(sim.playerId)!;
    run.modules = ['reliquary_sunken_ossuary', 'reliquary_finale'];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);
    for (const id of [...run.mobIds]) {
      const mob = sim.entities.get(id);
      if (mob && !mob.dead)
        (sim as any).dealDamage(
          sim.player,
          mob,
          mob.maxHp + 1,
          false,
          'physical',
          null,
          'hit',
          true,
        );
    }
    sim.tick();
    expect(run.exitPortalOpen).toBe(false);
    // Every pressure plate in the module must be triggered before the exit opens.
    const plates = run.objectIds
      .map((id) => ({ id, state: run.objectState[id] }))
      .filter((o) => o.state?.kind === 'pressure_plate');
    expect(plates.length).toBeGreaterThan(1);
    for (let i = 0; i < plates.length; i++) {
      const plateEnt = sim.entities.get(plates[i].id)!;
      sim.player.pos = { ...plateEnt.pos };
      sim.player.prevPos = { ...plateEnt.pos };
      sim.tick();
      // Exit stays sealed until the LAST plate is stepped.
      expect(run.exitPortalOpen).toBe(i === plates.length - 1);
    }
  });

  it('restless_graves affix raises a reliquary_bonewalker a few seconds after trash dies', () => {
    const sim = makeSim();
    enterReliquary(sim);
    const run = sim.delveRunForPlayer(sim.playerId)!;
    run.affixes = ['restless_graves'];
    // Spawn a piece of trash registered to the run, then kill it.
    const origin = run.origin;
    const trash = createMob(920001, MOBS.reliquary_ledger_wraith, 7, {
      x: origin.x,
      y: 0,
      z: origin.z + 10,
    });
    (sim as any).addEntity(trash);
    run.mobIds.push(trash.id);
    (sim as any).dealDamage(
      sim.player,
      trash,
      trash.maxHp + 1,
      false,
      'physical',
      null,
      'hit',
      true,
    );
    sim.tick();
    const bonewalkers = () =>
      [...sim.entities.values()].filter((e) => e.templateId === 'reliquary_bonewalker').length;
    // Add is delayed ~3s, so none yet.
    expect(bonewalkers()).toBe(0);
    // The trash death queued a pending add (regression: it used to reference an
    // undefined mob id and silently spawn nothing).
    expect(run.restlessPending.length).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < 20 * 4; i++) sim.tick();
    expect(bonewalkers()).toBeGreaterThanOrEqual(1);
    // The WRITE half of the no-infinite-chain fix: the affix path itself must tag
    // what it raises (runs.ts tickDelveRestlessGraves sets affixSpawned), so a
    // naturally raised Bonewalker's own death queues nothing. Without this pin,
    // deleting that one line stays green while the shipped spawn chain returns.
    const raised = [...sim.entities.values()].find(
      (e) => e.templateId === 'reliquary_bonewalker' && !e.dead,
    )!;
    expect(raised.affixSpawned).toBe(true);
    const pendingBefore = run.restlessPending.length;
    (sim as any).dealDamage(
      sim.player,
      raised,
      raised.maxHp + 1,
      false,
      'physical',
      null,
      'hit',
      true,
    );
    sim.tick();
    expect(run.restlessPending.length).toBe(pendingBefore);
  });

  it('killing an affix-spawned Raised Bonewalker does not re-trigger restless_graves (no infinite chain)', () => {
    const sim = makeSim();
    enterReliquary(sim);
    const run = sim.delveRunForPlayer(sim.playerId)!;
    run.affixes = ['restless_graves'];
    const origin = run.origin;
    // Simulate an affix-spawned Bonewalker directly (as tickDelveRestlessGraves
    // would create it): it must carry affixSpawned so its own death cannot
    // queue another one.
    const bonewalker = createMob(920002, MOBS.reliquary_bonewalker, 7, {
      x: origin.x,
      y: 0,
      z: origin.z + 10,
    });
    bonewalker.affixSpawned = true;
    (sim as any).addEntity(bonewalker);
    run.mobIds.push(bonewalker.id);
    (sim as any).dealDamage(
      sim.player,
      bonewalker,
      bonewalker.maxHp + 1,
      false,
      'physical',
      null,
      'hit',
      true,
    );
    sim.tick();
    expect(run.restlessPending.length).toBe(0);
  });

  it('bad_air affix applies a periodic Bad Air DoT to the party (PRD §6.7)', () => {
    const sim = makeSim();
    enterReliquary(sim);
    const run = sim.delveRunForPlayer(sim.playerId)!;
    run.affixes = ['bad_air'];
    run.badAirTimer = 0;
    // Clear the module's trash so combat can't kill the player over the interval -
    // isolate the affix's periodic aura from any incidental damage.
    for (const id of [...run.mobIds]) (sim as any).dropEntity(id);
    run.mobIds = [];
    expect(sim.player.auras.some((a) => a.id === 'bad_air')).toBe(false);
    // DELVE_BAD_AIR_INTERVAL = 8s; tick just past it and the DoT lands.
    for (let i = 0; i < 20 * 9; i++) sim.tick();
    expect(sim.player.auras.some((a) => a.id === 'bad_air')).toBe(true);
  });

  it('candleblind affix cuts delve mob detect range to 0.65x (PRD §6.7)', () => {
    const sim = makeSim();
    enterReliquary(sim);
    const run = sim.delveRunForPlayer(sim.playerId)!;
    run.affixes = [];
    expect((sim as any).delveDetectMult(sim.player)).toBe(1);
    run.affixes = ['candleblind'];
    expect((sim as any).delveDetectMult(sim.player)).toBe(0.65);
  });

  it('rollDelveAffixes only draws implemented affixes (no inert Heroic affix)', () => {
    // Import the source-of-truth set rather than a local literal, so the two
    // can never drift (a hook-less affix added to the constant would still be
    // caught by that affix's own dedicated hook test, e.g. restless_graves above).
    // Try many seeds; every Heroic roll must be an implemented affix.
    for (let seed = 1; seed <= 200; seed++) {
      const sim = makeSim('warrior', seed);
      enterReliquary(sim, 'heroic');
      const run = sim.delveRunForPlayer(sim.playerId)!;
      for (const id of run.affixes) expect(DELVE_IMPLEMENTED_AFFIXES.has(id)).toBe(true);
      expect(run.affixes.length).toBe(1); // Heroic affixCount = 1
    }
    // 200 full Sim constructions: bump the timeout so it stays green under the
    // parallel-worker load of the whole suite (it runs well under this alone).
  }, 15000);

  it('Deacon Varric enrages on Heroic but not on Normal (PRD §7.4)', () => {
    for (const tier of ['normal', 'heroic'] as const) {
      const sim = makeSim();
      enterReliquary(sim, tier);
      const run = sim.delveRunForPlayer(sim.playerId)!;
      // Register a Varric in this run so delveRunForMob resolves him to its tier.
      const boss = createMob((sim as any).nextId++, MOBS.deacon_varric, 12, {
        x: run.origin.x,
        y: 0,
        z: run.origin.z,
      });
      (sim as any).addEntity(boss);
      run.mobIds.push(boss.id);
      boss.firedSummons = 2; // skip the Raise Dead / add-summon path; isolate enrage
      boss.hp = Math.max(1, Math.round(boss.maxHp * 0.1)); // below the 20% enrage threshold
      (sim as any).updateBossMechanics(boss);
      expect(boss.enraged).toBe(tier === 'heroic');
    }
  });
});

describe('delve reward chest + surface exit flow', () => {
  function enterFinale(sim: ReturnType<typeof makeSim>) {
    enterReliquary(sim);
    const run = sim.delveRunForPlayer(sim.playerId)!;
    // Pin the normal (non-Bountiful) chest so these fixtures aren't at the mercy of
    // the ultra-rare roll (seed 42 happens to roll Bountiful). The Bountiful-Coffer
    // tests below opt back in explicitly with `run.bountiful = true`.
    run.bountiful = false;
    // Jump straight to the finale as the only module
    run.modules = ['reliquary_finale'];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);
    return run;
  }

  function killBoss(sim: ReturnType<typeof makeSim>, _run: ReturnType<typeof enterFinale>) {
    const boss = [...sim.entities.values()].find((e) => e.templateId === 'deacon_varric')!;
    (sim as any).dealDamage(sim.player, boss, boss.maxHp + 1, false, 'physical', null, 'hit', true);
    const events = sim.tick();
    return { boss, events };
  }

  // Drive the lockpicking minigame to a flawless solve. Returns the chest id.
  function pickLockFlawless(
    sim: ReturnType<typeof makeSim>,
    run: ReturnType<typeof enterFinale>,
    ante: 1 | 2 | 3 = 1,
  ) {
    const chestId = run.rewardChestId!;
    const chestEnt = sim.entities.get(chestId)!;
    sim.player.pos = { ...chestEnt.pos };
    sim.player.prevPos = { ...chestEnt.pos };
    sim.lockpickEngage(chestId, ante);
    // Flawless multi-page solve: clear each lock board back-to-back.
    let guard = 0;
    while (run.lockpick && run.lockpick.state === 'IN_PROGRESS' && guard++ < 12) {
      const actions = solveLockActions(run.lockpick.pages[run.lockpick.pageIndex])!;
      for (const a of actions) sim.lockpickAction(a);
    }
    return chestId;
  }

  it('boss death spawns a locked chest (not ejecting the player) with an attempt available', () => {
    const sim = makeSim();
    sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel);
    const run = enterFinale(sim);
    const playerPosBefore = { ...sim.player.pos };
    const { events } = killBoss(sim, run);

    // run.completed still false, chest not yet opened
    expect(run.completed).toBe(false);
    // objective is marked complete
    expect(run.objective.complete).toBe(true);
    // player stays in the delve band, position unchanged (no teleport)
    expect(isDelvePos(sim.player.pos.x)).toBe(true);
    expect(Math.abs(sim.player.pos.x - playerPosBefore.x)).toBeLessThan(1);
    // a locked chest object exists with an attempt granted
    const chestId = run.objectIds.find((id) => run.objectState[id]?.kind === 'locked_chest');
    expect(chestId).toBeDefined();
    expect(run.rewardChestId).not.toBeNull();
    expect(events).toContainEqual({
      type: 'delveObjectiveComplete',
      delveId: 'collapsed_reliquary',
      tierId: 'normal',
      pid: sim.playerId,
    });
    expect(run.objectState[chestId!].attemptAvailable).toBe(true);
    expect(run.objectState[chestId!].open).toBe(false);
  });

  it('finale boss chest spawns south of dais, not on the sealed passage z', () => {
    const sim = makeSim();
    sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel);
    const run = enterFinale(sim);
    killBoss(sim, run);
    const layout = DELVE_MODULE_LAYOUTS.reliquary_finale;
    const zBase = (sim as any).delveModuleZOffset(run);
    const chest = sim.entities.get(run.rewardChestId!)!;
    const localZ = chest.pos.z - run.origin.z - zBase;
    // Sits toward the entrance (south) edge of the dais, facing the player.
    expect(localZ).toBe(layout.dais.z - 14);
    expect(chest.facing).toBe(Math.PI);
    expect(run.objectIds.some((id) => run.objectState[id]?.kind === 'module_exit')).toBe(false);
    expect(Math.hypot(chest.pos.x - run.origin.x, localZ - (layout.zMax - 6))).toBeGreaterThan(4);
  });

  it('boss death in a non-finale module does not spawn the reward chest', () => {
    const sim = makeSim();
    sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel);
    enterReliquary(sim);
    const run = sim.delveRunForPlayer(sim.playerId)!;
    run.modules = ['reliquary_saintless_hall', 'reliquary_finale'];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);
    const origin = run.origin;
    const boss = createMob(910001, MOBS.deacon_varric, 12, { x: origin.x, y: 0, z: origin.z + 40 });
    (sim as any).addEntity(boss);
    (sim as any).dealDamage(sim.player, boss, boss.maxHp + 1, false, 'physical', null, 'hit', true);
    sim.tick();
    expect(run.rewardChestId).toBeNull();
    expect(run.objectIds.some((id) => run.objectState[id]?.kind === 'locked_chest')).toBe(false);
  });

  it('interacting with the locked chest offers the ante selector (no grant yet)', () => {
    const sim = makeSim();
    sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel);
    const run = enterFinale(sim);
    killBoss(sim, run);
    const chestId = run.rewardChestId!;
    const chestEnt = sim.entities.get(chestId)!;
    sim.player.pos = { ...chestEnt.pos };
    sim.player.prevPos = { ...chestEnt.pos };

    sim.delveInteract(chestId);
    const events = sim.tick();
    const offer = events.find((e) => e.type === 'lockpickOffer');
    expect(offer).toBeDefined();
    // A normal (gold) chest is not a Coffer, the client shows every ante.
    expect(offer && (offer as Extract<typeof offer, { type: 'lockpickOffer' }>).bountiful).toBe(
      false,
    );
    expect(run.completed).toBe(false);
    expect(run.lockpick).toBeNull();
  });

  it('flawless solve grants marks (premium tier), completes the run, and spawns the surface exit', () => {
    const sim = makeSim();
    sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel);
    const run = enterFinale(sim);
    killBoss(sim, run);

    const marksBefore = sim.delveMarksFor(sim.playerId);
    const chestId = pickLockFlawless(sim, run, 1);
    const events = sim.drainEvents();

    expect(run.completed).toBe(true);
    // base clear (+1 mark) + premium ante bonus (+2 marks)
    expect(sim.delveMarksFor(sim.playerId)).toBe(marksBefore + 3);
    expect(run.objectState[chestId].looted).toBe(true);
    expect(run.objectState[chestId].open).toBe(true);
    expect(run.objectState[chestId].lootedTier).toBe('premium');
    expect(events).toContainEqual({
      type: 'delveChestLoot',
      chestId,
      delveId: 'collapsed_reliquary',
      tierId: 'normal',
      lootTier: 'premium',
      bountiful: false,
      items: run.objectState[chestId].pendingLoot,
      pid: sim.playerId,
    });
    expect(run.lockpick).toBeNull();
    // surface exit spawned
    expect(run.surfaceExitId).not.toBeNull();
    const exitObj = run.objectIds.find((id) => run.objectState[id]?.kind === 'surface_exit');
    expect(exitObj).toBeDefined();
    expect(run.objectState[exitObj!].open).toBe(true);
  });

  it('flawless solve stages class-tuned gear loot and collect grants it to inventory', () => {
    const sim = makeSim(); // warrior
    sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel);
    const run = enterFinale(sim);
    killBoss(sim, run);
    const chestId = pickLockFlawless(sim, run, 1);

    // Premium WAR loot is one signature gear piece (the rare helm or the plate chest).
    const loot = run.objectState[chestId].pendingLoot!;
    expect(loot.length).toBe(1);
    const lootedId = loot[0].itemId;
    expect(['deacon_reliquary_helm', 'reliquary_plate_chest']).toContain(lootedId);
    expect(loot[0].count).toBe(1);
    expect(sim.entities.get(chestId)?.templateId).toBe('delve_reward_chest');

    const countOf = (slots: typeof sim.inventory, id: string) =>
      slots.filter((s) => s?.itemId === id).reduce((n, s) => n + s.count, 0);
    // Disable auto-equip so the looted gear lands in bags (not equipped) for the count.
    (sim as any).players.get(sim.playerId).autoEquip = false;
    const before = countOf(sim.inventory, lootedId);
    sim.collectDelveChestLoot(chestId);
    expect(countOf(sim.inventory, lootedId) - before).toBe(1);
    expect(run.objectState[chestId].pendingLoot).toEqual([]);
  });

  // ----- §7.6 Bountiful Coffer (ultra-rare path) -----

  it('the Bountiful roll is deterministic for a given seed', () => {
    // Read the raw roll via enterReliquary (enterFinale pins it false). Same seed
    // ⇒ same outcome; seed 42 is known to roll Bountiful (drives the fixtures above).
    const rollFor = (seed: number) => {
      const s = makeSim('warrior', seed);
      s.setPlayerLevel(DELVES.collapsed_reliquary.minLevel);
      enterReliquary(s);
      return s.delveRunForPlayer(s.playerId)?.bountiful;
    };
    expect(rollFor(1234)).toBe(rollFor(1234));
    expect(rollFor(42)).toBe(true);
  });

  it('a Bountiful Coffer refuses the lower antes and only opens at Hard-tier + Premium ante', () => {
    const sim = makeSim();
    sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel);
    const run = enterFinale(sim);
    run.bountiful = true;
    killBoss(sim, run);
    const chestEnt = sim.entities.get(run.rewardChestId!)!;
    sim.player.pos = { ...chestEnt.pos };
    sim.player.prevPos = { ...chestEnt.pos };

    // Lower antes are refused outright, no session starts.
    sim.lockpickEngage(run.rewardChestId!, 3);
    expect(run.lockpick).toBeNull();
    sim.lockpickEngage(run.rewardChestId!, 2);
    expect(run.lockpick).toBeNull();

    // Premium ante (1) engages, forced onto the Hard (heroic) preset (16 cols).
    sim.lockpickEngage(run.rewardChestId!, 1);
    expect(run.lockpick).not.toBeNull();
    expect(run.lockpick?.ante).toBe(1);
    expect(run.lockpick?.lootTier).toBe('premium');
    expect(run.lockpick?.pages[0].tier.cols).toBe(16);
  });

  it('a Bountiful Coffer flags its lockpickOffer so the client forces Premium-only', () => {
    const sim = makeSim();
    sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel);
    const run = enterFinale(sim);
    run.bountiful = true;
    killBoss(sim, run);
    const chestEnt = sim.entities.get(run.rewardChestId!)!;
    sim.player.pos = { ...chestEnt.pos };
    sim.player.prevPos = { ...chestEnt.pos };

    sim.delveInteract(run.rewardChestId!);
    const offer = sim.tick().find((e) => e.type === 'lockpickOffer');
    expect(offer).toBeDefined();
    expect((offer as Extract<typeof offer, { type: 'lockpickOffer' }>).bountiful).toBe(true);
  });

  it('exposes the Bountiful flag on the delveRun wire for the renderer (purple coffer)', () => {
    const sim = makeSim();
    sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel);
    const run = enterFinale(sim);
    run.bountiful = true;
    expect(sim.delveRun?.bountiful).toBe(true);
    run.bountiful = false;
    expect(sim.delveRun?.bountiful).toBe(false);
  });

  it('a solved Bountiful Coffer guarantees the signature rare plus a premium green', () => {
    const sim = makeSim(); // warrior
    sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel);
    const run = enterFinale(sim);
    run.bountiful = true;
    killBoss(sim, run);
    const chestId = pickLockFlawless(sim, run, 1);
    const ids = run.objectState[chestId].pendingLoot!.map((s) => s.itemId);
    expect(ids).toContain('deacon_reliquary_helm'); // guaranteed rare (WAR)
    expect(ids).toContain('reliquary_plate_chest');
    expect(ids.length).toBe(2);
  });

  it('Bountiful loot guarantees the class-appropriate signature rare per archetype', () => {
    const rng = new Rng(99);
    expect(delveChestItemsForTier('premium', 'warrior', rng, true).map((s) => s.itemId)).toContain(
      'deacon_reliquary_helm',
    );
    expect(delveChestItemsForTier('premium', 'mage', rng, true).map((s) => s.itemId)).toContain(
      'varric_shadow_cowl',
    );
    // Rogue/hunter has no signature rare yet → the two best greens (content gap).
    expect(delveChestItemsForTier('premium', 'rogue', rng, true).map((s) => s.itemId)).toEqual([
      'reliquary_leather_chest',
      'reliquary_gloves_rog',
    ]);
  });

  it('interacting with an emptied chest says "chest is empty"', () => {
    const sim = makeSim();
    sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel);
    const run = enterFinale(sim);
    killBoss(sim, run);
    const chestId = pickLockFlawless(sim, run, 1);

    sim.delveInteract(chestId); // already looted
    const events = sim.tick();
    const emptyLog = events.find(
      (ev) => ev.type === 'log' && (ev as any).text === 'The chest is empty.',
    );
    expect(emptyLog).toBeDefined();
  });

  it('interacting with delve_exit ejects player and frees the run', () => {
    const sim = makeSim();
    sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel);
    const run = enterFinale(sim);
    killBoss(sim, run);
    pickLockFlawless(sim, run, 1); // open chest + spawn exit

    const exitId = run.surfaceExitId!;
    const exitEnt = sim.entities.get(exitId)!;
    sim.player.pos = { ...exitEnt.pos };
    sim.player.prevPos = { ...exitEnt.pos };
    sim.delveInteract(exitId);

    // Player is now outside the delve band
    expect(isDelvePos(sim.player.pos.x)).toBe(false);
    // Player is near the door
    const door = DELVES.collapsed_reliquary.doorPos;
    expect(Math.hypot(sim.player.pos.x - door.x, sim.player.pos.z - (door.z - 4))).toBeLessThan(2);
    // Run is freed (no active run for this player)
    expect(sim.delveRunForPlayer(sim.playerId)).toBeNull();
  });

  it('inter-module advance still works (non-finale modules not affected)', () => {
    const sim = makeSim();
    enterReliquary(sim);
    const run = sim.delveRunForPlayer(sim.playerId)!;
    run.modules = ['reliquary_bell_niche', 'reliquary_finale'];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);
    const exitId = run.objectIds.find((id) => run.objectState[id]?.kind === 'module_exit');
    expect(exitId).toBeDefined();
    // Kill all trash
    for (const id of [...run.mobIds]) {
      const mob = sim.entities.get(id);
      if (mob && !mob.dead)
        (sim as any).dealDamage(
          sim.player,
          mob,
          mob.maxHp + 1,
          false,
          'physical',
          null,
          'hit',
          true,
        );
    }
    sim.tick();
    expect(run.exitPortalOpen).toBe(true);
    // Walk into the portal to advance
    const portal = sim.entities.get(exitId!)!;
    sim.player.pos = { ...portal.pos };
    sim.player.prevPos = { ...portal.pos };
    sim.tick();
    expect(run.moduleIndex).toBe(1);
    expect(run.modules[run.moduleIndex]).toBe('reliquary_finale');
    // No reward chest exists yet (boss not killed)
    expect(run.rewardChestId).toBeNull();
  });

  // Clear the finale once and release the run slot so the next clear gets a fresh
  // run (enterDelve reuses the player's own run, and a completed run would not
  // re-spawn the chest). ante 3 = low tier = 0 bonus marks, isolating base marks.
  function clearOnce(sim: ReturnType<typeof makeSim>, ante: 1 | 2 | 3 = 3) {
    const run = enterFinale(sim);
    killBoss(sim, run);
    pickLockFlawless(sim, run, ante);
    return run;
  }

  it('daily reset + first-vs-repeat XP keys off the injected UTC day (deterministic)', () => {
    const sim = makeSim();
    sim.utcDay = '2026-06-18';
    sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel);
    const meta = (sim as any).players.get(sim.playerId);
    const rewards = DELVES.collapsed_reliquary.baseRewards;

    // Capture the XP granted by the delve clear (the last grantXp call in the path).
    let lastXp = 0;
    const realGrantXp = (sim as any).grantXp.bind(sim);
    (sim as any).grantXp = (xp: number, m: any) => {
      lastXp = xp;
      return realGrantXp(xp, m);
    };

    // First clear today: first-clear XP + clearKey recorded + markClears 1.
    let run = enterFinale(sim);
    killBoss(sim, run);
    lastXp = 0;
    pickLockFlawless(sim, run, 3);
    expect(lastXp).toBe(rewards.firstClearXp);
    expect(meta.delveDaily.firstClearXp.has('collapsed_reliquary:normal')).toBe(true);
    expect(meta.delveDaily.markClears).toBe(1);
    expect(meta.delveClears['collapsed_reliquary:normal']).toBe(1);
    (sim as any).freeDelveRun(run);

    // Second clear SAME day: repeat XP, markClears 2.
    run = enterFinale(sim);
    killBoss(sim, run);
    lastXp = 0;
    pickLockFlawless(sim, run, 3);
    expect(lastXp).toBe(rewards.repeatClearXp);
    expect(meta.delveDaily.markClears).toBe(2);
    (sim as any).freeDelveRun(run);

    // Day rollover: the daily window resets (firstClearXp cleared, markClears 0).
    sim.utcDay = '2026-06-19';
    run = enterFinale(sim);
    killBoss(sim, run);
    lastXp = 0;
    pickLockFlawless(sim, run, 3);
    expect(meta.delveDaily.date).toBe('2026-06-19');
    expect(meta.delveDaily.markClears).toBe(1); // reset to 0, then this clear
    expect(lastXp).toBe(rewards.firstClearXp); // first clear again after reset
  });

  it('refreshDelveDaily never reads the wall clock (no reset when utcDay unset)', () => {
    const sim = makeSim();
    // utcDay defaults to '' (deterministic / headless): the window must not roll over.
    expect(sim.utcDay).toBe('');
    sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel);
    const meta = (sim as any).players.get(sim.playerId);
    meta.delveDaily = { date: 'pinned', firstClearXp: new Set(['x']), markClears: 2 };
    (sim as any).refreshDelveDaily(meta);
    expect(meta.delveDaily.date).toBe('pinned'); // unchanged, no wall-clock read
    expect(meta.delveDaily.markClears).toBe(2);
  });

  it('delveMarkPayout follows the PRD §7.4 daily formula (1 Normal / 2 Heroic)', () => {
    const sim = makeSim();
    const meta = (sim as any).players.get(sim.playerId);
    meta.delveDaily.firstClearXp = new Set();
    const runN = { tierId: 'normal' } as any;
    const runH = { tierId: 'heroic' } as any;
    // First 3 completions/day (markClears < 3): full Marks, 1 Normal, 2 Heroic.
    for (const mc of [0, 1, 2]) {
      meta.delveDaily.markClears = mc;
      expect((sim as any).delveMarkPayout(runN, meta)).toBe(1);
      expect((sim as any).delveMarkPayout(runH, meta)).toBe(2);
    }
    // After 3: Heroic 1 guaranteed; Normal 50% (sampling sees both 0 and 1).
    meta.delveDaily.markClears = 3;
    expect((sim as any).delveMarkPayout(runH, meta)).toBe(1);
    const normalOutcomes = new Set<number>();
    for (let i = 0; i < 50; i++) {
      meta.delveDaily.markClears = 3;
      normalOutcomes.add((sim as any).delveMarkPayout(runN, meta));
    }
    expect(normalOutcomes.has(0)).toBe(true);
    expect(normalOutcomes.has(1)).toBe(true);
  });

  it('unlocks one lore journal entry per clear, capped at five (PRD §6.4)', () => {
    const sim = makeSim();
    sim.utcDay = '2026-06-18';
    sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel);
    const meta = (sim as any).players.get(sim.playerId);
    const order = [
      'eastbrook_ledger',
      'first_collapse',
      'gravecaller_mark',
      'bell_below',
      'tessa_note',
    ];
    for (let i = 1; i <= 6; i++) {
      const run = clearOnce(sim);
      expect(meta.delveLoreUnlocked.size).toBe(Math.min(i, 5));
      (sim as any).freeDelveRun(run);
    }
    expect([...meta.delveLoreUnlocked]).toEqual(order);
  });
});

describe('delve Heroic level gate (a L7 cannot run Heroic; L9+ can)', () => {
  function tryEnterHeroic(level: number): Sim {
    const sim = makeSim('warrior');
    sim.setPlayerLevel(level);
    const door = DELVES.collapsed_reliquary.doorPos;
    teleport(sim, door.x, door.z);
    sim.enterDelve('collapsed_reliquary', 'heroic');
    return sim;
  }

  it('blocks a level 7 player from entering Heroic', () => {
    const sim = tryEnterHeroic(7);
    expect(sim.delveRunForPlayer(sim.playerId)).toBeNull();
    expect(isDelvePos(sim.player.pos.x)).toBe(false);
  });

  it('blocks a level 8 player from entering Heroic', () => {
    const sim = tryEnterHeroic(8);
    expect(sim.delveRunForPlayer(sim.playerId)).toBeNull();
  });

  it('admits a level 9 player into Heroic', () => {
    const sim = tryEnterHeroic(9);
    const run = sim.delveRunForPlayer(sim.playerId);
    expect(run).not.toBeNull();
    expect(run?.tierId).toBe('heroic');
    expect(isDelvePos(sim.player.pos.x)).toBe(true);
  });

  it('Normal has no gate above the delve floor, a level 7 enters', () => {
    const sim = makeSim('warrior');
    sim.setPlayerLevel(7);
    const door = DELVES.collapsed_reliquary.doorPos;
    teleport(sim, door.x, door.z);
    sim.enterDelve('collapsed_reliquary', 'normal');
    expect(sim.delveRunForPlayer(sim.playerId)).not.toBeNull();
  });
});

describe('delve Heroic enemy level (+3 vs Normal +0)', () => {
  it('Heroic trash spawns at template.minLevel + 3', () => {
    const sim = makeSim('warrior');
    sim.setPlayerLevel(9);
    const door = DELVES.collapsed_reliquary.doorPos;
    teleport(sim, door.x, door.z);
    sim.enterDelve('collapsed_reliquary', 'heroic');
    const run = sim.delveRunForPlayer(sim.playerId)!;
    let checked = 0;
    for (const id of run.mobIds) {
      const mob = sim.entities.get(id);
      const tmpl = mob && MOBS[mob.templateId];
      if (!mob || !tmpl) continue;
      expect(mob.level).toBe(tmpl.minLevel + 3);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('Normal trash spawns at template.minLevel', () => {
    const sim = makeSim('warrior');
    enterReliquary(sim, 'normal');
    const run = sim.delveRunForPlayer(sim.playerId)!;
    let checked = 0;
    for (const id of run.mobIds) {
      const mob = sim.entities.get(id);
      const tmpl = mob && MOBS[mob.templateId];
      if (!mob || !tmpl) continue;
      expect(mob.level).toBe(tmpl.minLevel);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('Tessa percent-of-health heal + rank cap', () => {
  function healAmountAtRank(rank: number): { amount: number; maxHp: number } {
    const sim = makeSim('warrior');
    enterReliquary(sim); // solo at the delve floor; Tessa auto-spawns
    const run = sim.delveRunForPlayer(sim.playerId)!;
    expect(run.companion).toBeDefined();
    const meta = (sim as any).players.get(sim.playerId);
    meta.companionUpgrades = { companion_tessa: rank };
    // Clear trash so combat can't interfere, then wound the player to half.
    for (const id of [...run.mobIds]) (sim as any).dropEntity(id);
    run.mobIds = [];
    sim.player.hp = Math.floor(sim.player.maxHp * 0.5);
    const maxHp = sim.player.maxHp;
    const companionEnt = sim.entities.get(run.companion!.entityId)!;
    companionEnt.wanderTimer = 0;
    let amount = -1;
    for (let i = 0; i < 5 && amount < 0; i++) {
      const evs = sim.tick();
      const h = evs.find(
        (e: { type: string; targetId?: number }) =>
          e.type === 'heal' && e.targetId === sim.playerId,
      );
      if (h) amount = (h as { amount: number }).amount;
    }
    return { amount, maxHp };
  }

  it('rank 1 heals 6% of max HP per tick', () => {
    const { amount, maxHp } = healAmountAtRank(1);
    expect(amount).toBe(Math.round(maxHp * 0.06));
  });

  it('rank 3 heals 10% of max HP per tick (scales with HP, unlike the old flat heal)', () => {
    const { amount, maxHp } = healAmountAtRank(3);
    expect(amount).toBe(Math.round(maxHp * 0.1));
  });

  it('caps at rank 3; ranks 2 and 3 cost 3 then 5 Marks (no copper)', () => {
    const sim = makeSim('warrior');
    enterReliquary(sim);
    const meta = (sim as any).players.get(sim.playerId);
    meta.delveMarks = 100;
    meta.copper = 100;
    meta.companionUpgrades = { companion_tessa: 1 };
    sim.companionUpgrade('companion_tessa');
    expect(meta.companionUpgrades.companion_tessa).toBe(2);
    expect(meta.delveMarks).toBe(97);
    sim.companionUpgrade('companion_tessa');
    expect(meta.companionUpgrades.companion_tessa).toBe(3);
    expect(meta.delveMarks).toBe(92);
    expect(meta.copper).toBe(100); // Marks only, copper untouched
    sim.companionUpgrade('companion_tessa'); // already maxed
    expect(meta.companionUpgrades.companion_tessa).toBe(3);
    expect(meta.delveMarks).toBe(92);
  });
});

describe('The Drowned Litany (Phase 1 skeleton)', () => {
  it('registers the delve as index 1 with a kill_boss objective at the marsh level band', () => {
    const d = DELVES.drowned_litany;
    expect(d).toBeDefined();
    expect(d.index).toBe(1);
    expect(d.objective).toBe('kill_boss');
    expect(d.minLevel).toBe(12);
    expect(d.boardNpcId).toBe('brother_halven_marsh');
    expect(d.bosses).toEqual(['sister_nhalia_drowned_canticle']);
    // Its own band: delveAt resolves index 1 at the second delve x-offset.
    expect(delveAt(delveOrigin(1, 0).x)?.id).toBe('drowned_litany');
  });

  it('Normal has 0 affixes; Heroic has +3 enemy levels, 1 affix, and an L14 gate', () => {
    const d = DELVES.drowned_litany;
    const normal = d.tiers.find((t) => t.id === 'normal')!;
    const heroic = d.tiers.find((t) => t.id === 'heroic')!;
    expect(normal.affixCount).toBe(0);
    expect(normal.enemyLevelBonus).toBe(0);
    expect(heroic.affixCount).toBe(1);
    expect(heroic.enemyLevelBonus).toBe(3);
    expect(heroic.minPlayerLevel).toBe(14);
  });

  it('picks exactly 3 of the 6 trash modules with the boss apse always last', () => {
    const sim = makeSim('warrior', 7);
    enterLitany(sim);
    const run = sim.delveRunForPlayer(sim.playerId)!;
    expect(run.modules.length).toBe(4); // 3 trash + finale
    expect(run.modules[run.modules.length - 1]).toBe('litany_apse');
    const trash = run.modules.slice(0, 3);
    expect(new Set(trash).size).toBe(3); // no duplicates
    for (const m of trash) expect(DELVES.drowned_litany.modules).toContain(m);
  });

  it('same seed picks the same module order; different seeds can differ', () => {
    const order = (seed: number) => {
      const sim = makeSim('warrior', seed);
      enterLitany(sim);
      return [...sim.delveRunForPlayer(sim.playerId)!.modules];
    };
    expect(order(100)).toEqual(order(100));
    // Across many seeds at least one differs from seed 100 (selection is seeded).
    const base = order(100).join(',');
    let sawDifferent = false;
    for (let s = 101; s <= 130 && !sawDifferent; s++) sawDifferent = order(s).join(',') !== base;
    expect(sawDifferent).toBe(true);
  });

  it('enter places the player in the delve band and auto-spawns Edda solo', () => {
    const sim = makeSim('warrior');
    enterLitany(sim);
    const run = sim.delveRunForPlayer(sim.playerId)!;
    expect(isDelvePos(sim.player.pos.x)).toBe(true);
    expect(run.companion).toBeDefined();
    const companion = sim.entities.get(run.companion!.entityId)!;
    expect(companion.templateId).toBe('edda_reedhand');
  });

  it('blocks a level 13 player from Heroic but admits level 14', () => {
    const blocked = makeSim('warrior');
    blocked.setPlayerLevel(13);
    const door = DELVES.drowned_litany.doorPos;
    teleport(blocked, door.x, door.z);
    blocked.enterDelve('drowned_litany', 'heroic');
    expect(blocked.delveRunForPlayer(blocked.playerId)).toBeNull();

    const ok = makeSim('warrior');
    enterLitany(ok, 'heroic');
    expect(ok.delveRunForPlayer(ok.playerId)?.tierId).toBe('heroic');
  });

  it('killing Sister Nhalia in the apse completes the objective and spawns the Drowned Reliquary rite', () => {
    const sim = makeSim('warrior');
    enterLitany(sim);
    const run = sim.delveRunForPlayer(sim.playerId)!;
    run.bountiful = false;
    run.modules = ['litany_apse'];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);
    const boss = [...sim.entities.values()].find(
      (e) => e.templateId === 'sister_nhalia_drowned_canticle',
    )!;
    expect(boss).toBeDefined();
    (sim as any).dealDamage(sim.player, boss, boss.maxHp + 1, false, 'physical', null, 'hit', true);
    sim.tick();
    expect(run.objective.complete).toBe(true);
    expect(run.rewardChestId).not.toBeNull();
    expect(run.objectState[run.rewardChestId!]?.kind).toBe('drowned_reliquary');
    expect(run.drownedLitanyRite?.awaitingChoice).toBe(true); // rite waits for difficulty choice
    expect(run.objectIds.some((id) => run.objectState[id]?.kind === 'locked_chest')).toBe(false);
    expect(isDelvePos(sim.player.pos.x)).toBe(true); // not ejected
  });
});

describe('The Drowned Litany (Phase 2 marsh layouts: navigable, distinct)', () => {
  const LITANY_MODULES = LITANY_MODULE_IDS;
  // A generous player-body margin: the choke constraint is passages >= ~4u, i.e.
  // comfortably more than 2 * BODY_R. A* (findPlayerPath) uses a similar radius.
  const BODY_R = 0.9;

  // All delve colliders are rot:0, so circle = radius test and obb = AABB test.
  function blockedAt(
    cols: ReturnType<typeof delveModuleColliders>,
    x: number,
    z: number,
    r: number,
  ): boolean {
    for (const c of cols) {
      if (c.type === 'circle') {
        if (Math.hypot(x - c.x, z - c.z) < c.r + r) return true;
      } else if (c.type === 'obb') {
        if (Math.abs(x - c.x) < c.hw + r && Math.abs(z - c.z) < c.hd + r) return true;
      }
    }
    return false;
  }

  // 4-connected flood fill over an instance-local grid: is the dais reachable
  // from the entry spawn (0, zMin+8) without crossing an inflated collider?
  function daisReachableFromEntry(moduleId: (typeof LITANY_MODULES)[number]): boolean {
    const layout = DELVE_MODULE_LAYOUTS[moduleId];
    const cols = delveModuleColliders(moduleId);
    const cell = 0.5;
    const minX = -(layout.wallX ?? 25);
    const minZ = layout.zMin;
    const W = Math.ceil(((layout.wallX ?? 25) * 2) / cell);
    const H = Math.ceil((layout.zMax - layout.zMin) / cell);
    const idx = (gx: number, gz: number) => gz * W + gx;
    const openCell = (gx: number, gz: number) =>
      !blockedAt(cols, minX + (gx + 0.5) * cell, minZ + (gz + 0.5) * cell, BODY_R);
    const startGx = Math.floor((0 - minX) / cell);
    const startGz = Math.floor((layout.zMin + 8 - minZ) / cell);
    const goalGx = Math.floor((layout.dais.x - minX) / cell);
    const goalGz = Math.floor((layout.dais.z - minZ) / cell);
    if (!openCell(startGx, startGz)) return false; // entry spawn must be clear
    const seen = new Uint8Array(W * H);
    const stack: Array<[number, number]> = [[startGx, startGz]];
    seen[idx(startGx, startGz)] = 1;
    while (stack.length) {
      const [gx, gz] = stack.pop()!;
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = gx + dx;
        const nz = gz + dz;
        if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
        if (seen[idx(nx, nz)]) continue;
        seen[idx(nx, nz)] = 1;
        if (openCell(nx, nz)) stack.push([nx, nz]);
      }
    }
    return seen[idx(goalGx, goalGz)] === 1;
  }

  it('every marsh module is navigable from the entry spawn to the dais', () => {
    for (const m of LITANY_MODULES) {
      expect(daisReachableFromEntry(m), `${m} dais unreachable from entry`).toBe(true);
    }
  });

  it('the entry spawn (0, zMin+8) is clear of obstacles in every marsh module', () => {
    for (const m of LITANY_MODULES) {
      const layout = DELVE_MODULE_LAYOUTS[m];
      const cols = delveModuleColliders(m);
      expect(blockedAt(cols, 0, layout.zMin + 8, BODY_R), `${m} entry blocked`).toBe(false);
    }
  });

  it('Phase 2 replaced the placeholders: all 7 marsh layouts are distinct objects', () => {
    const litany = LITANY_MODULES.map((m) => DELVE_MODULE_LAYOUTS[m]);
    expect(new Set(litany).size).toBe(LITANY_MODULES.length);
    // and none is reused from the Collapsed Reliquary set
    const reliquary = [
      DELVE_MODULE_LAYOUTS.reliquary_sunken_ossuary,
      DELVE_MODULE_LAYOUTS.reliquary_bell_niche,
      DELVE_MODULE_LAYOUTS.reliquary_saintless_hall,
      DELVE_MODULE_LAYOUTS.reliquary_finale,
    ];
    for (const l of litany) expect(reliquary).not.toContain(l);
  });

  it('all seven Litany rooms have explicit non-rectangular geometry profiles', () => {
    const profiles = new Set<string>();
    for (const moduleId of LITANY_MODULES) {
      const geo = litanyModuleGeometry(moduleId)!;
      profiles.add(geo.profile);
      expect(geo.islands.length, `${moduleId} walkable islands`).toBeGreaterThan(0);
      expect(litanyModuleIsNonRectangular(moduleId), `${moduleId} non-rectangular footprint`).toBe(
        true,
      );
      expect(
        geo.hazards.some((h) => h.r >= 7),
        `${moduleId} larger Blackwater`,
      ).toBe(true);
    }
    expect(profiles.size).toBe(LITANY_MODULES.length);
  });

  it('the boss apse keeps a clear stomp ring of interior cover around the dais', () => {
    const layout = DELVE_MODULE_LAYOUTS.litany_apse;
    expect(layout.dais.r).toBeGreaterThanOrEqual(12);
    // Interior cover only: drop the room boundary walls (centred on a side wall
    // |x|=wallX or an end wall z=zMin/zMax) so we test placed obstacles, not the
    // shell the dais legitimately abuts.
    const wallX = layout.wallX ?? 25;
    const hazardSet = new Set(
      litanyModuleGeometry('litany_apse')!.hazards.map((h) => `${h.x},${h.z}`),
    );
    const interior = delveModuleColliders('litany_apse').filter(
      (c) =>
        Math.abs(c.x) < wallX - 2 &&
        c.z > layout.zMin + 2 &&
        c.z < layout.zMax - 2 &&
        !hazardSet.has(`${c.x},${c.z}`),
    );
    // No interior obstacle may intrude on the dais radius.
    for (let r = 0; r <= layout.dais.r; r += 2) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const x = layout.dais.x + Math.cos(a) * r;
        const z = layout.dais.z + Math.sin(a) * r;
        expect(blockedAt(interior, x, z, BODY_R), `apse stomp ring blocked at r=${r}`).toBe(false);
      }
    }
    // And all interior cover sits in the south half (design: z <= ~50).
    for (const c of interior) {
      expect(c.z, 'apse cover must stay in the south half').toBeLessThanOrEqual(50);
    }
  });
});

describe('The Drowned Litany (Phase 4 enemy kits)', () => {
  it('the Drowned Cantor is a ranged priority caster that heals allies', () => {
    // Stands off casting Drowned Dirge (petSpell) and heals wounded drowned (mendAlly).
    expect(MOBS.drowned_cantor.petSpell?.name).toBe('Drowned Dirge');
    expect(MOBS.drowned_cantor.petSpell?.range ?? 0).toBeGreaterThan(12); // true ranged, not melee
    expect(MOBS.drowned_cantor.mendAlly?.name).toBe('Litany Pulse');
    expect(MOBS.drowned_cantor.aoePulse).toBeUndefined();
  });

  it('the Reedbound Acolyte is a ranged attacker lobbing Rotwater Vials', () => {
    const m = MOBS.reedbound_acolyte;
    expect(m.petSpell?.name).toBe('Rotwater Vial');
    expect(m.petSpell?.school).toBe('nature');
    expect(m.petSpell?.range ?? 0).toBeGreaterThan(12); // holds at range, does not melee
    expect(m.aoePulse).toBeUndefined();
  });

  it('the Deepfen Spearjaw is a frenzying skirmisher (fast + frenzyOnHit)', () => {
    const m = MOBS.deepfen_spearjaw;
    expect(m.frenzyOnHit?.name).toBe('Feeding Frenzy');
    expect(m.frenzyOnHit?.hasteMult ?? 0).toBeGreaterThan(1);
    expect(m.moveSpeed).toBeGreaterThanOrEqual(8);
  });

  it('the Mirefen Widowling snares with a movement slow (Web Snare chillOnHit)', () => {
    const m = MOBS.mirefen_widowling;
    expect(m.chillOnHit?.name).toBe('Web Snare');
    expect(m.chillOnHit?.mult ?? 1).toBeLessThan(1); // slows movement
  });

  it('the Grave-Silt Bulwark cleaves, wards allies, and is a CC-immune elite', () => {
    const m = MOBS.grave_silt_bulwark;
    expect(m.cleave?.name).toBe('Silt Cleave');
    expect(m.wardAllies?.name).toBe('Silt Ward');
    expect(m.elite).toBe(true);
    expect(m.ccImmune).toBe(true);
  });

  it('the Sump Troll Devourer is a self-shielding elite with a stomp (Silt Hide + Sump Stomp)', () => {
    const m = MOBS.sump_troll_devourer;
    expect(m.elite).toBe(true);
    expect(m.stoneskin?.name).toBe('Silt Hide');
    expect(m.stoneskin?.amount ?? 0).toBeGreaterThan(0);
    expect(m.stomp?.name).toBe('Sump Stomp');
  });

  it('the Bog Thrall is a fragile swarm add with pack frenzy', () => {
    const m = MOBS.choir_thrall;
    expect(m.hpBase).toBeLessThan(MOBS.drowned_cantor.hpBase);
    expect(m.packFrenzy?.hasteMult ?? 1).toBeGreaterThan(1);
    expect(m.aoePulse).toBeUndefined();
    expect(m.cleave).toBeUndefined();
    expect(m.elite).toBeUndefined();
  });

  it('the Reedbound Acolyte fires Rotwater Vials from range and never closes to melee', () => {
    const sim = makeSim('warrior');
    enterLitany(sim);
    const run = sim.delveRunForPlayer(sim.playerId)!;
    const p = sim.player;
    // A lone acolyte 14 yards ahead: inside its 15y aggro + 22y cast range, well
    // beyond melee. A true ranged caster stands and casts; a melee mob would close.
    const acolyte = createMob(990301, MOBS.reedbound_acolyte, 13, {
      x: p.pos.x,
      y: 0,
      z: p.pos.z + 14,
    });
    (sim as any).addEntity(acolyte);
    run.mobIds.push(acolyte.id);
    const hp0 = p.hp;
    let minDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 20 * 12 && !acolyte.dead; i++) {
      sim.tick();
      minDist = Math.min(minDist, Math.hypot(acolyte.pos.x - p.pos.x, acolyte.pos.z - p.pos.z));
    }
    expect(p.hp, 'acolyte should land ranged Rotwater Vials').toBeLessThan(hp0);
    expect(minDist, 'acolyte should hold at range, never melee').toBeGreaterThan(8);
  });

  it('the Reedbound Acolyte telegraphs its vial: windup event, release exactly windup ticks later, cadence preserved', () => {
    const sim = makeSim('warrior');
    enterLitany(sim);
    const run = sim.delveRunForPlayer(sim.playerId)!;
    const p = sim.player;
    const acolyte = createMob(990302, MOBS.reedbound_acolyte, 13, {
      x: p.pos.x,
      y: 0,
      z: p.pos.z + 14,
    });
    (sim as any).addEntity(acolyte);
    run.mobIds.push(acolyte.id);

    const spell = MOBS.reedbound_acolyte.petSpell!;
    expect(spell.windup, 'the vial throw carries a windup for the cast animation').toBeCloseTo(
      0.85,
    );
    const windupTicks = Math.round((spell.windup ?? 0) / DT);
    const cadenceTicks = Math.round(spell.every / DT);

    // Record the tick of every windup / projectile spellfx the acolyte emits and
    // every damage event it lands on the player.
    const windups: number[] = [];
    const projectiles: number[] = [];
    const damages: number[] = [];
    for (let i = 0; i < 20 * 10 && projectiles.length < 2; i++) {
      // tick() drains and returns this tick's events (sim.events is reset).
      const evs = sim.tick() as any[];
      for (const ev of evs) {
        if (ev.type === 'spellfx' && ev.sourceId === acolyte.id) {
          if (ev.fx === 'windup') windups.push(i);
          if (ev.fx === 'projectile') projectiles.push(i);
        }
        if (ev.type === 'damage' && ev.sourceId === acolyte.id && ev.targetId === p.id) {
          damages.push(i);
        }
      }
    }

    expect(windups.length, 'a windup telegraph precedes each vial').toBeGreaterThanOrEqual(2);
    expect(projectiles.length).toBe(2);
    // The release (projectile + its damage) lands exactly the windup after the telegraph.
    expect(projectiles[0] - windups[0]).toBe(windupTicks);
    expect(projectiles[1] - windups[1]).toBe(windupTicks);
    expect(damages[0]).toBe(projectiles[0]);
    // Fire-to-fire cadence stays spell.every (one tick of float wobble on the
    // swing timer, same as the pre-windup path): the windup eats into the
    // cycle, it does not extend it to every + windup.
    expect(projectiles[1] - projectiles[0]).toBeGreaterThanOrEqual(cadenceTicks);
    expect(projectiles[1] - projectiles[0]).toBeLessThanOrEqual(cadenceTicks + 1);
  });
});

describe('The Drowned Litany (Phase 3 static Blackwater hazard)', () => {
  // World-space centre of a module's hazard zone for the active run.
  function hazardWorld(sim: Sim, moduleId: string, hazardIndex = 0) {
    const run = sim.delveRunForPlayer(sim.playerId)!;
    const zBase = delveModuleZOffset(run.modules, run.moduleIndex);
    const h = DELVE_MODULES[moduleId].hazards![hazardIndex];
    return { x: run.origin.x + h.x, z: run.origin.z + zBase + h.z, r: h.r, run, zBase };
  }

  function enterModule(sim: Sim, moduleId: string) {
    const run = sim.delveRunForPlayer(sim.playerId)!;
    run.modules = [moduleId];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);
    return run;
  }

  it('every Drowned Litany module defines at least one Blackwater hazard zone', () => {
    for (const m of DELVES.drowned_litany.modules) {
      expect(DELVE_MODULES[m].hazards?.length ?? 0).toBeGreaterThan(0);
    }
    expect(
      DELVE_MODULES[DELVES.drowned_litany.finaleModuleId].hazards?.length ?? 0,
    ).toBeGreaterThan(0);
  });

  it('damages a player standing in a Blackwater zone, but not one standing clear', () => {
    const sim = makeSim('warrior');
    enterLitany(sim);
    enterModule(sim, 'litany_baptistry');
    const hz = hazardWorld(sim, 'litany_baptistry');
    const p = sim.player;
    p.pos.x = hz.x;
    p.pos.z = hz.z;
    p.prevPos = { ...p.pos };
    const hp0 = p.hp;
    for (let i = 0; i < 20; i++) sim.tick(); // exactly one 1s pulse
    expect(p.hp).toBeLessThan(hp0);

    // Step out to the clear entry aisle: no further Blackwater damage. Count
    // the labelled damage events (an hp floor could be masked by regen).
    p.pos.x = hz.run.origin.x;
    p.pos.z = hz.run.origin.z + hz.zBase - 11; // entry spawn, away from all zones
    p.prevPos = { ...p.pos };
    let clearHits = 0;
    for (let i = 0; i < 60; i++) {
      for (const ev of sim.tick()) {
        if (ev.type === 'damage' && ev.targetId === p.id && ev.ability === 'Blackwater')
          clearHits++;
      }
    }
    expect(clearHits).toBe(0);
  });

  it('the apse moat is a true ellipse: rz bounds it tighter than rx, not a circle of radius rx', () => {
    const sim = makeSim('warrior');
    enterLitany(sim);
    enterModule(sim, 'litany_apse');
    const hz = hazardWorld(sim, 'litany_apse', 0); // shallow: rx 22, rz 17, r 22
    const p = sim.player;
    const hitsAt = (dx: number, dz: number) => {
      p.pos.x = hz.x + dx;
      p.pos.z = hz.z + dz;
      p.prevPos = { ...p.pos };
      let hit = false;
      for (let i = 0; i < 20; i++) {
        for (const ev of sim.tick()) {
          if (ev.type === 'damage' && ev.targetId === p.id && ev.ability === 'Blackwater')
            hit = true;
        }
      }
      return hit;
    };
    // dx=15,dz=15 sits inside a circle of radius rx=24 (15^2+15^2=450 <= 576) but
    // outside the true ellipse (15^2/24^2 + 15^2/17^2 ~= 1.17 > 1): if the sim
    // still used the old r-only circle check, this point would incorrectly hit.
    expect(hitsAt(15, 15)).toBe(false);
    // A pure-x offset well inside rx still hits: the moat is still a real (wide)
    // hazard along x, not accidentally shrunk to nothing.
    expect(hitsAt(20, 0)).toBe(true);
  });

  it('Heroic Blackwater hits harder than Normal', () => {
    const pulseDamage = (tier: 'normal' | 'heroic') => {
      const sim = makeSim('warrior');
      enterLitany(sim, tier);
      enterModule(sim, 'litany_baptistry');
      const hz = hazardWorld(sim, 'litany_baptistry');
      const p = sim.player;
      p.pos.x = hz.x;
      p.pos.z = hz.z;
      p.prevPos = { ...p.pos };
      const hp0 = p.hp;
      for (let i = 0; i < 20; i++) sim.tick();
      return hp0 - p.hp;
    };
    expect(pulseDamage('heroic')).toBeGreaterThan(pulseDamage('normal'));
  });

  it('is deterministic: the same seed takes the same Blackwater damage', () => {
    const run = () => {
      const sim = makeSim('warrior', 909);
      enterLitany(sim);
      enterModule(sim, 'litany_baptistry');
      const hz = hazardWorld(sim, 'litany_baptistry');
      const p = sim.player;
      p.pos.x = hz.x;
      p.pos.z = hz.z;
      p.prevPos = { ...p.pos };
      const hp0 = p.hp;
      for (let i = 0; i < 60; i++) sim.tick();
      return hp0 - p.hp;
    };
    expect(run()).toBe(run());
  });

  // Blackwater damage events aimed at the player over `ticks` ticks; `pre`
  // runs before each tick (e.g. to hold the player airborne).
  function countBlackwaterHits(sim: Sim, ticks: number, pre?: () => void): number {
    let hits = 0;
    for (let i = 0; i < ticks; i++) {
      pre?.();
      for (const ev of sim.tick()) {
        if (ev.type === 'damage' && ev.targetId === sim.playerId && ev.ability === 'Blackwater')
          hits++;
      }
    }
    return hits;
  }

  it('an airborne (jumping) player dodges the Blackwater tick entirely', () => {
    const sim = makeSim('warrior');
    enterLitany(sim);
    enterModule(sim, 'litany_baptistry');
    const hz = hazardWorld(sim, 'litany_baptistry');
    const p = sim.player;
    p.pos.x = hz.x;
    p.pos.z = hz.z;
    p.prevPos = { ...p.pos };
    // Hold the player genuinely airborne across two-plus pulses: physics keeps
    // `jumping` true while off the ground, and the boost prevents landing.
    const airborneHits = countBlackwaterHits(sim, 45, () => {
      p.onGround = false;
      p.jumping = true;
      p.vy = 3;
    });
    expect(airborneHits).toBe(0);
    // Grounded control at the same spot: the pulse does land.
    p.jumping = false;
    p.vy = 0;
    p.onGround = true;
    p.pos.x = hz.x;
    p.pos.z = hz.z;
    p.prevPos = { ...p.pos };
    expect(countBlackwaterHits(sim, 25)).toBeGreaterThan(0);
  });

  it('standing on a dry island inside a pool takes no damage; beside it, it does', () => {
    const sim = makeSim('warrior');
    enterLitany(sim);
    enterModule(sim, 'litany_causeway');
    const run = sim.delveRunForPlayer(sim.playerId)!;
    const hz = hazardWorld(sim, 'litany_causeway');
    const p = sim.player;
    // The causeway's deep pool (0,22,r4) is centred on the 2x2 island (0,22):
    // its centre is dry ground, its rim (off the island, inside the radius) is not.
    p.pos.x = run.origin.x + 0;
    p.pos.z = run.origin.z + hz.zBase + 22;
    p.prevPos = { ...p.pos };
    expect(countBlackwaterHits(sim, 45)).toBe(0);
    p.pos.x = run.origin.x + 3.2; // off the island (hw 2), inside the pool (r 4)
    p.pos.z = run.origin.z + hz.zBase + 22;
    p.prevPos = { ...p.pos };
    expect(countBlackwaterHits(sim, 25)).toBeGreaterThan(0);
    expect(p.dead).toBe(false);
  });

  it('the apse dais is dry ground even though the deep pool radius covers it', () => {
    const sim = makeSim('warrior');
    enterLitany(sim);
    enterModule(sim, 'litany_apse');
    const run = sim.delveRunForPlayer(sim.playerId)!;
    const hz = hazardWorld(sim, 'litany_apse');
    // Clear the room so only the hazard could deal damage during the window.
    for (const id of [...run.mobIds]) (sim as any).dropEntity(id);
    const p = sim.player;
    // Dais centre (0,72) sits inside the deep pool (0,56,r21): dry.
    p.pos.x = run.origin.x + 0;
    p.pos.z = run.origin.z + hz.zBase + 72;
    p.prevPos = { ...p.pos };
    expect(countBlackwaterHits(sim, 45)).toBe(0);
    // Dais-ONLY annulus point: (11.5,72) is inside the dais (r 12) but off every
    // island rect (the coincident (0,72,hw:11) island stops at |x|=11), so the
    // dais branch of standingOnLitanyDryGround is pinned independently; the
    // centre point above is also covered by that island.
    p.pos.x = run.origin.x + 11.5;
    p.pos.z = run.origin.z + hz.zBase + 72;
    p.prevPos = { ...p.pos };
    expect(countBlackwaterHits(sim, 45)).toBe(0);
    // Control: the west deep pocket (-12,22,r6) is genuinely wet.
    p.pos.x = run.origin.x - 12;
    p.pos.z = run.origin.z + hz.zBase + 22;
    p.prevPos = { ...p.pos };
    expect(countBlackwaterHits(sim, 25)).toBeGreaterThan(0);
  });

  it('the apse outer walkway ring has a dry flank path (no Blackwater on the ring)', () => {
    const sim = makeSim('warrior');
    enterLitany(sim, 'heroic');
    enterModule(sim, 'litany_apse');
    const run = sim.delveRunForPlayer(sim.playerId)!;
    const zBase = delveModuleZOffset(run.modules, run.moduleIndex);
    // Clear the room so only the hazard could deal damage during the window.
    for (const id of [...run.mobIds]) (sim as any).dropEntity(id);
    const p = sim.player;
    const ringHits = (localX: number, localZ: number) => {
      p.pos.x = run.origin.x + localX;
      p.pos.z = run.origin.z + zBase + localZ;
      p.prevPos = { ...p.pos };
      return countBlackwaterHits(sim, 45);
    };
    // The outer walkway ring reaches |x| ~= 23.8 at z 48 to 91 (the authored
    // safe path). One yard in from the wall on the east and west flanks at
    // z=56 must be dry: the shallow moat must not pinch the ring.
    expect(ringHits(22.8, 56)).toBe(0);
    expect(ringHits(-22.8, 56)).toBe(0);
    // Control: the central moat is still lethal (the fix must not neuter it).
    expect(ringHits(18, 56)).toBeGreaterThan(0);
  });

  it('the trash modules keep a dry wall-hugging walkway (shallow pools do not drown the ring)', () => {
    // The same class of bug as the apse moat: a shallow Blackwater pool authored
    // so its rim reaches the outer walkable-ring wall band drowns ground that
    // reads as clean walkway, dealing invisible damage. Each probe below is a
    // point ~1-2yd inside the side wall on the flank the pool overshot; it must
    // be dry. A same-module control confirms the pool still damages further in.
    const cases: Array<{
      moduleId: string;
      dry: [number, number];
      wet: [number, number];
    }> = [
      { moduleId: 'litany_sluice', dry: [13, 29], wet: [7, 33] },
      { moduleId: 'litany_baptistry', dry: [17, 18], wet: [12, 24] },
      { moduleId: 'litany_ledger', dry: [19, 18], wet: [9, 24] },
      { moduleId: 'litany_choir_loft', dry: [-18, 17], wet: [-12, 22] },
    ];
    for (const c of cases) {
      const sim = makeSim('warrior');
      enterLitany(sim, 'heroic');
      enterModule(sim, c.moduleId);
      const run = sim.delveRunForPlayer(sim.playerId)!;
      const zBase = delveModuleZOffset(run.modules, run.moduleIndex);
      for (const id of [...run.mobIds]) (sim as any).dropEntity(id);
      const p = sim.player;
      const hitsAt = (localX: number, localZ: number) => {
        p.pos.x = run.origin.x + localX;
        p.pos.z = run.origin.z + zBase + localZ;
        p.prevPos = { ...p.pos };
        return countBlackwaterHits(sim, 45);
      };
      expect(hitsAt(...c.dry), `${c.moduleId} wall-hug walkway must be dry`).toBe(0);
      expect(hitsAt(...c.wet), `${c.moduleId} interior pool must still damage`).toBeGreaterThan(0);
    }
  });

  it('pins the deep (2.0x) and shallow (0.35x) tier multipliers on the 4% Normal base', () => {
    const pulse = (localX: number, localZ: number) => {
      const sim = makeSim('warrior');
      enterLitany(sim);
      enterModule(sim, 'litany_sluice');
      const run = sim.delveRunForPlayer(sim.playerId)!;
      const hz = hazardWorld(sim, 'litany_sluice');
      const p = sim.player;
      p.pos.x = run.origin.x + localX;
      p.pos.z = run.origin.z + hz.zBase + localZ;
      p.prevPos = { ...p.pos };
      let amount = 0;
      for (let i = 0; i < 20 && amount === 0; i++) {
        for (const ev of sim.tick()) {
          if (ev.type === 'damage' && ev.targetId === p.id && ev.ability === 'Blackwater')
            amount = ev.amount;
        }
      }
      return { amount, maxHp: p.maxHp };
    };
    // Sluice pool pair at (-8,18): deep r5 inside shallow r8. The centre is
    // deep water; 6.5yd out is shallow-only. Literal pins: 4% Normal base,
    // 2.0x deep, 0.35x shallow.
    const deep = pulse(-8, 18);
    const shallow = pulse(-8 + 6.5, 18);
    expect(deep.amount).toBe(Math.max(1, Math.round(deep.maxHp * 0.04 * 2.0)));
    expect(shallow.amount).toBe(Math.max(1, Math.round(shallow.maxHp * 0.04 * 0.35)));
    expect(deep.amount).toBeGreaterThan(shallow.amount);
  });
});

describe('The Drowned Litany (Phase 5 room puzzles)', () => {
  const BODY_R = 0.9;

  // All delve colliders are rot:0, so circle = radius test and obb = AABB test.
  function plateBlocked(moduleId: string, x: number, z: number): boolean {
    for (const c of delveModuleColliders(moduleId as any)) {
      if (c.type === 'circle') {
        if (Math.hypot(x - c.x, z - c.z) < c.r + BODY_R) return true;
      } else if (c.type === 'obb') {
        if (Math.abs(x - c.x) < c.hw + BODY_R && Math.abs(z - c.z) < c.hd + BODY_R) return true;
      }
    }
    return false;
  }

  // Expected puzzle plate count per the handoff Room Pool. Causeway (room 6) has
  // no scripted puzzle: the layout is the puzzle.
  const PLATE_COUNTS: Record<string, number> = {
    litany_sluice: 2, // turn 2 sluice valves
    litany_ledger: 4, // activate 4 grave tablets
    litany_ring: 2, // light 2 corpse-candles
    litany_baptistry: 0, // 3 egg-sacs, but spawned as mobs (drowned_litany_rooms.ts), not interactableSlots
    litany_choir_loft: 2, // pull 2 bell ropes
    litany_causeway: 0, // no puzzle
  };

  function puzzleSlots(moduleId: string) {
    return DELVE_MODULES[moduleId].interactableSlots.filter((s) =>
      s.variants.some((v) => isLitanyPuzzleKind(v) || v === 'pressure_plate'),
    );
  }

  function enterModule(sim: Sim, moduleId: string) {
    const run = sim.delveRunForPlayer(sim.playerId)!;
    run.modules = [moduleId];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);
    return run;
  }

  it('each puzzle room defines the handoff plate count (causeway has none)', () => {
    for (const [m, count] of Object.entries(PLATE_COUNTS)) {
      expect(puzzleSlots(m).length, `${m} plate count`).toBe(count);
    }
  });

  it('litany puzzle slots use semantic object kinds, not pressure_plate', () => {
    for (const kind of LITANY_PUZZLE_KINDS) {
      expect(kind).not.toBe('pressure_plate');
    }
    for (const m of Object.keys(PLATE_COUNTS)) {
      if (PLATE_COUNTS[m] === 0) continue;
      for (const slot of puzzleSlots(m)) {
        expect(slot.variants.some((v) => isLitanyPuzzleKind(v))).toBe(true);
      }
    }
  });

  it('every puzzle plate sits on walkable floor, clear of obstacles and hazards', () => {
    for (const m of Object.keys(PLATE_COUNTS)) {
      const hazards = DELVE_MODULES[m].hazards ?? [];
      for (const slot of puzzleSlots(m)) {
        expect(plateBlocked(m, slot.x, slot.z), `${m} plate (${slot.x},${slot.z}) blocked`).toBe(
          false,
        );
        for (const h of hazards) {
          const d = Math.hypot(slot.x - h.x, slot.z - h.z);
          expect(d, `${m} plate (${slot.x},${slot.z}) inside hazard`).toBeGreaterThan(h.r + BODY_R);
        }
      }
    }
  });

  it('the exit stays sealed until every puzzle plate is triggered', () => {
    const sim = makeSim('warrior');
    enterLitany(sim);
    const run = sim.delveRunForPlayer(sim.playerId)!;
    run.modules = ['litany_sluice', 'litany_apse'];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);
    for (const id of [...run.mobIds]) {
      const mob = sim.entities.get(id);
      if (mob && !mob.dead)
        (sim as any).dealDamage(
          sim.player,
          mob,
          mob.maxHp + 1,
          false,
          'physical',
          null,
          'hit',
          true,
        );
    }
    sim.tick();
    expect(run.exitPortalOpen).toBe(false);
    const puzzles = run.objectIds
      .map((id) => ({ id, state: run.objectState[id] }))
      .filter((o) => o.state && isLitanyPuzzleKind(o.state.kind));
    expect(puzzles.length).toBe(PLATE_COUNTS.litany_sluice);
    for (let i = 0; i < puzzles.length; i++) {
      const puzzleEnt = sim.entities.get(puzzles[i].id)!;
      sim.player.pos = { ...puzzleEnt.pos };
      sim.player.prevPos = { ...puzzleEnt.pos };
      sim.tick();
      expect(run.exitPortalOpen, `after puzzle ${i + 1}/${puzzles.length}`).toBe(
        i === puzzles.length - 1,
      );
    }
  });

  it('the north-passage exit spawns on findable, walkable, hazard-clear ground in every trash module', () => {
    // Findability guard for the progression object (the module_exit "Sealed
    // Passage" the player walks into to advance): in every non-finale Drowned
    // Litany module it must be spawned, sit on the walkable polygon, be clear of
    // the shell/interior colliders (reachable, not walled off), and not sit under
    // a Blackwater hazard (a submerged or blocked exit reads as "no way forward").
    for (const moduleId of DELVES.drowned_litany.modules) {
      const sim = makeSim('warrior');
      enterLitany(sim);
      const run = sim.delveRunForPlayer(sim.playerId)!;
      // Two-module run so this module is NOT the finale (the finale has a boss,
      // not a north-passage exit).
      run.modules = [moduleId, 'litany_apse'];
      run.moduleIndex = 0;
      (sim as any).spawnDelveModule(run);
      const zBase = delveModuleZOffset(run.modules, 0);
      const exitId = run.objectIds.find((id) => run.objectState[id]?.kind === 'module_exit');
      expect(exitId, `${moduleId} spawns a module_exit`).toBeDefined();
      const exit = sim.entities.get(exitId!)!;
      const localX = exit.pos.x - run.origin.x;
      const localZ = exit.pos.z - run.origin.z - zBase;
      // On the authored walkable polygon (not off the mapped floor).
      const poly = litanyModuleGeometry(moduleId as any)!.walkable[0].points;
      expect(
        polygonContainsPoint(poly, localX, localZ),
        `${moduleId} exit (${localX.toFixed(1)},${localZ.toFixed(1)}) is inside the walkable polygon`,
      ).toBe(true);
      // Reachable: the exit body is not inside a movement collider (wall/pillar/
      // island). The exit portal radius is generous, so require the centre clear.
      expect(
        plateBlocked(moduleId, localX, localZ),
        `${moduleId} exit is walled off by a collider`,
      ).toBe(false);
      // Not under a Blackwater pool: a player standing on the exit takes no damage.
      const p = sim.player;
      for (const id of [...run.mobIds]) (sim as any).dropEntity(id);
      p.pos.x = exit.pos.x;
      p.pos.z = exit.pos.z;
      p.prevPos = { ...p.pos };
      let blackwaterHits = 0;
      for (let i = 0; i < 45; i++) {
        for (const ev of sim.tick()) {
          if (ev.type === 'damage' && ev.targetId === p.id && ev.ability === 'Blackwater')
            blackwaterHits++;
        }
      }
      expect(blackwaterHits, `${moduleId} exit sits under a Blackwater hazard`).toBe(0);
    }
  });

  it('bell ropes deal 18 damage to all living Drowned Cantors in combat', () => {
    const sim = makeSim('warrior');
    enterLitany(sim);
    const run = sim.delveRunForPlayer(sim.playerId)!;
    run.modules = ['litany_choir_loft'];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);
    const origin = run.origin;
    const zBase = delveModuleZOffset(run.modules, 0);
    const cantor = createMob(880001, MOBS.drowned_cantor, 12, {
      x: origin.x,
      y: 0,
      z: origin.z + zBase + 40,
    });
    cantor.inCombat = true;
    (sim as any).addEntity(cantor);
    run.mobIds.push(cantor.id);
    const hp0 = cantor.hp;
    const ropeId = run.objectIds.find((id) => run.objectState[id]?.kind === 'bell_rope');
    expect(ropeId).toBeDefined();
    const rope = sim.entities.get(ropeId!)!;
    sim.player.pos = { ...rope.pos };
    sim.player.prevPos = { ...sim.player.pos };
    // Standing on the rope does nothing: it is a deliberate F-pull, not a
    // walk-on plate.
    sim.tick();
    expect(run.objectState[ropeId!].triggered).toBe(false);
    expect(cantor.hp).toBe(hp0);
    sim.delveInteract(ropeId!);
    expect(run.objectState[ropeId!].triggered).toBe(true);
    expect(rope.templateId).toBe('delve_bell_rope_pulled');
    expect(hp0 - cantor.hp).toBe(18);
    // A second pull on a slack rope is inert.
    sim.drainEvents();
    sim.delveInteract(ropeId!);
    const events = sim.drainEvents();
    expect(events.some((e) => e.type === 'error' && e.text === 'Nothing happens.')).toBe(true);
    expect(hp0 - cantor.hp).toBe(18);
  });

  it('baptistry spawns three waves before egg-sacs appear', () => {
    const sim = makeSim('warrior');
    enterLitany(sim);
    const run = enterModule(sim, 'litany_baptistry');
    expect(run.litanyBaptistry?.wave).toBe(0);
    expect(run.litanyBaptistry?.eggsEnabled).toBe(false);
    expect(run.mobIds.length).toBe(6); // PRD wave 1: 4 widowlings + 2 spearjaws
    const eggSacs = () =>
      run.mobIds.filter((id) => sim.entities.get(id)?.templateId === 'spider_egg_sac').length;
    expect(eggSacs()).toBe(0);
    const killAll = () => {
      for (const id of [...run.mobIds]) {
        const mob = sim.entities.get(id);
        if (mob && !mob.dead)
          (sim as any).dealDamage(
            sim.player,
            mob,
            mob.maxHp + 1,
            false,
            'physical',
            null,
            'hit',
            true,
          );
      }
      sim.tick();
    };
    killAll();
    expect(run.mobIds.length).toBeGreaterThan(2);
    killAll();
    expect(run.mobIds.length).toBeGreaterThan(4);
    killAll();
    expect(run.litanyBaptistry?.eggsEnabled).toBe(true);
    expect(eggSacs()).toBe(3);
  });

  it('a spider egg-sac is a real 1hp combat target: one hit kills it and hatches 2 widowlings', () => {
    const sim = makeSim('warrior');
    enterLitany(sim);
    const run = enterModule(sim, 'litany_baptistry');
    run.litanyBaptistry!.wave = 2; // skip straight past the wave gate
    for (const id of [...run.mobIds]) {
      const mob = sim.entities.get(id);
      if (mob) mob.dead = true;
    }
    sim.tick(); // waves poll sees no living trash, enables the egg-sacs
    expect(run.litanyBaptistry?.eggsEnabled).toBe(true);
    const sacId = run.litanyBaptistry!.eggSacIds[0]!;
    const sac = sim.entities.get(sacId)!;
    expect(sac.templateId).toBe('spider_egg_sac');
    expect(sac.maxHp).toBe(1);
    sim.player.pos = { ...sac.pos };
    sim.player.prevPos = { ...sac.pos };
    const widowlingsBefore = run.mobIds.filter(
      (id) => sim.entities.get(id)?.templateId === 'mirefen_widowling',
    ).length;
    // A single hit, of any size, kills a 1hp target: this is the real combat
    // path a player's auto-attack/ability takes, not a bespoke destroy call.
    (sim as any).dealDamage(sim.player, sac, 1, false, 'physical', null, 'hit', true);
    sim.tick();
    expect(sac.dead).toBe(true);
    const widowlingsAfter = run.mobIds.filter(
      (id) => sim.entities.get(id)?.templateId === 'mirefen_widowling',
    ).length;
    expect(widowlingsAfter - widowlingsBefore).toBe(2);
  });

  it('an egg-sac kill pays no XP while the hatched widowlings pay normally', () => {
    const sim = makeSim('warrior');
    enterLitany(sim);
    const run = enterModule(sim, 'litany_baptistry');
    run.litanyBaptistry!.wave = 2;
    for (const id of [...run.mobIds]) {
      const mob = sim.entities.get(id);
      if (mob) mob.dead = true;
    }
    sim.tick();
    const meta = (sim as any).players.get(sim.playerId);
    const sac = sim.entities.get(run.litanyBaptistry!.eggSacIds[0]!)!;
    sim.player.pos = { ...sac.pos };
    sim.player.prevPos = { ...sac.pos };
    const xpBeforeSac = meta.xp;
    (sim as any).dealDamage(sim.player, sac, 1, false, 'physical', null, 'hit', true);
    sim.tick();
    expect(sac.dead).toBe(true);
    expect(meta.xp).toBe(xpBeforeSac); // xpMult 0: a one-hit puzzle object pays nothing
    // The hatchlings are the real fight and pay kill XP through the normal path.
    const widowling = run.mobIds
      .map((id) => sim.entities.get(id))
      .find((m) => m && !m.dead && m.templateId === 'mirefen_widowling')!;
    const xpBeforeWidow = meta.xp;
    (sim as any).dealDamage(
      sim.player,
      widowling,
      widowling.hp + 10,
      false,
      'physical',
      null,
      'hit',
      true,
    );
    expect(widowling.dead).toBe(true);
    expect(meta.xp).toBeGreaterThan(xpBeforeWidow);
  });

  it('hatched widowlings carry the Heroic level bonus like the waves', () => {
    const sim = makeSim('warrior');
    enterLitany(sim, 'heroic');
    const run = enterModule(sim, 'litany_baptistry');
    run.litanyBaptistry!.wave = 2;
    for (const id of [...run.mobIds]) {
      const mob = sim.entities.get(id);
      if (mob) mob.dead = true;
    }
    sim.tick();
    const sac = sim.entities.get(run.litanyBaptistry!.eggSacIds[0]!)!;
    sim.player.pos = { ...sac.pos };
    sim.player.prevPos = { ...sac.pos };
    (sim as any).dealDamage(sim.player, sac, 1, false, 'physical', null, 'hit', true);
    sim.tick();
    const hatched = run.mobIds
      .map((id) => sim.entities.get(id))
      .filter((m) => m && !m.dead && m.templateId === 'mirefen_widowling');
    expect(hatched.length).toBe(2);
    // widowling minLevel 12 + the Heroic enemyLevelBonus 3, same as the waves.
    for (const m of hatched) expect(m!.level).toBe(15);
  });

  it('hatched widowlings stay at base level on Normal (the bonus is tier-gated)', () => {
    const sim = makeSim('warrior');
    enterLitany(sim);
    const run = enterModule(sim, 'litany_baptistry');
    run.litanyBaptistry!.wave = 2;
    for (const id of [...run.mobIds]) {
      const mob = sim.entities.get(id);
      if (mob) mob.dead = true;
    }
    sim.tick();
    const sac = sim.entities.get(run.litanyBaptistry!.eggSacIds[0]!)!;
    sim.player.pos = { ...sac.pos };
    sim.player.prevPos = { ...sac.pos };
    (sim as any).dealDamage(sim.player, sac, 1, false, 'physical', null, 'hit', true);
    sim.tick();
    const hatched = run.mobIds
      .map((id) => sim.entities.get(id))
      .filter((m) => m && !m.dead && m.templateId === 'mirefen_widowling');
    expect(hatched.length).toBe(2);
    // A regression applying the +3 bonus unconditionally fails here.
    for (const m of hatched) expect(m!.level).toBe(12);
  });

  it('the sealed exit hints to destroy the spider sacs once they are up, generic otherwise', () => {
    const sim = makeSim('warrior');
    enterLitany(sim);
    const run = sim.delveRunForPlayer(sim.playerId)!;
    run.modules = ['litany_baptistry', 'litany_apse'];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);
    const exitId = run.objectIds.find((id) => run.objectState[id]?.kind === 'module_exit')!;
    const exit = sim.entities.get(exitId)!;
    sim.player.pos = { ...exit.pos };
    sim.player.prevPos = { ...exit.pos };
    sim.drainEvents();
    sim.delveInteract(exitId);
    let events = sim.drainEvents();
    expect(events.some((e) => e.type === 'error' && e.text === 'The passage is sealed.')).toBe(
      true,
    );
    run.litanyBaptistry!.wave = 2;
    for (const id of [...run.mobIds]) {
      const mob = sim.entities.get(id);
      if (mob) mob.dead = true;
    }
    sim.tick();
    expect(run.litanyBaptistry?.eggsEnabled).toBe(true);
    sim.drainEvents();
    sim.delveInteract(exitId);
    events = sim.drainEvents();
    expect(
      events.some(
        (e) => e.type === 'error' && e.text === 'You should try to destroy the spider sacs.',
      ),
    ).toBe(true);
  });

  it('the sealed exit hints per blocker: pull the ropes (choir loft) or apply pressure (valves)', () => {
    const sim = makeSim('warrior');
    enterLitany(sim);
    const run = sim.delveRunForPlayer(sim.playerId)!;
    run.modules = ['litany_choir_loft', 'litany_apse'];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);
    for (const id of [...run.mobIds]) {
      const mob = sim.entities.get(id);
      if (mob) mob.dead = true;
    }
    sim.tick();
    const exitId = run.objectIds.find((id) => run.objectState[id]?.kind === 'module_exit')!;
    const exit = sim.entities.get(exitId)!;
    sim.player.pos = { ...exit.pos };
    sim.player.prevPos = { ...exit.pos };
    sim.drainEvents();
    sim.delveInteract(exitId);
    let events = sim.drainEvents();
    expect(
      events.some((e) => e.type === 'error' && e.text === 'You should try pulling the bell ropes.'),
    ).toBe(true);
    const ropeIds = run.objectIds.filter((id) => run.objectState[id]?.kind === 'bell_rope');
    expect(ropeIds.length).toBe(2);
    for (const ropeId of ropeIds) {
      const rope = sim.entities.get(ropeId)!;
      sim.player.pos = { ...rope.pos };
      sim.player.prevPos = { ...rope.pos };
      sim.delveInteract(ropeId);
      sim.tick();
    }
    expect(run.exitPortalOpen).toBe(true);
    sim.player.pos = { ...exit.pos };
    sim.player.prevPos = { ...exit.pos };
    sim.drainEvents();
    sim.delveInteract(exitId);
    events = sim.drainEvents();
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('the sealed exit hints to apply pressure for walk-on puzzles (sluice valves)', () => {
    const sim = makeSim('warrior');
    enterLitany(sim);
    const run = sim.delveRunForPlayer(sim.playerId)!;
    run.modules = ['litany_sluice', 'litany_apse'];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);
    for (const id of [...run.mobIds]) {
      const mob = sim.entities.get(id);
      if (mob) mob.dead = true;
    }
    sim.tick();
    const exitId = run.objectIds.find((id) => run.objectState[id]?.kind === 'module_exit')!;
    const exit = sim.entities.get(exitId)!;
    sim.player.pos = { ...exit.pos };
    sim.player.prevPos = { ...exit.pos };
    sim.drainEvents();
    sim.delveInteract(exitId);
    const events = sim.drainEvents();
    expect(
      events.some(
        (e) =>
          e.type === 'error' &&
          e.text === 'You need to open the seal by applying pressure somewhere in the room.',
      ),
    ).toBe(true);
  });
});

describe('The Drowned Litany (Phase 7 heroic affixes)', () => {
  function enterModule(sim: Sim, moduleId: string) {
    const run = sim.delveRunForPlayer(sim.playerId)!;
    run.modules = [moduleId];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);
    return run;
  }

  it('high_water increases Blackwater pulse damage by 35%', () => {
    const pulse = (affixes: string[]) => {
      const sim = makeSim('warrior');
      enterLitany(sim, 'normal');
      const run = enterModule(sim, 'litany_baptistry');
      run.affixes = affixes;
      run.blackwaterTimer = 0;
      const h = DELVE_MODULES.litany_baptistry.hazards![0];
      const zBase = delveModuleZOffset(run.modules, 0);
      const p = sim.player;
      p.pos.x = run.origin.x + h.x;
      p.pos.z = run.origin.z + zBase + h.z;
      p.prevPos = { ...p.pos };
      const hp0 = p.hp;
      for (let i = 0; i < 20; i++) sim.tick();
      return hp0 - p.hp;
    };
    const base = pulse([]);
    const flooded = pulse(['high_water']);
    expect(flooded).toBeGreaterThan(base);
    expect(flooded / base).toBeCloseTo(1.35, 1);
  });

  it('belligerent_dead gives Grave-Silt Bulwark +10% maxHp on spawn', () => {
    const sim = makeSim('warrior');
    enterLitany(sim, 'heroic');
    const run = sim.delveRunForPlayer(sim.playerId)!;
    run.affixes = ['belligerent_dead'];
    run.modules = ['litany_choir_loft'];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);
    const bulwark = [...sim.entities.values()].find((e) => e.templateId === 'grave_silt_bulwark')!;
    const heroicTier = DELVES.drowned_litany.tiers.find((t) => t.id === 'heroic')!;
    const spawnLevel = MOBS.grave_silt_bulwark.minLevel + heroicTier.enemyLevelBonus;
    const base = createMob(880002, MOBS.grave_silt_bulwark, spawnLevel, { x: 0, y: 0, z: 0 });
    expect(bulwark.maxHp).toBe(Math.round(base.maxHp * 1.1));
  });

  it('belligerent_dead never rolls for the crypt delve, where its bulwark hook is inert', () => {
    expect(DELVE_AFFIXES.belligerent_dead.themes).toEqual(['ruin']);
    for (let seed = 1; seed <= 200; seed++) {
      expect(rollDelveAffixes(DELVES.collapsed_reliquary, 'heroic', seed)).not.toContain(
        'belligerent_dead',
      );
    }
  });

  it('lively_choir adds two Bog Thralls on cantor boss phases', () => {
    const sim = makeSim();
    enterLitany(sim);
    const run = sim.delveRunForPlayer(sim.playerId)!;
    run.affixes = ['lively_choir'];
    run.modules = ['litany_apse'];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);
    const boss = [...sim.entities.values()].find(
      (e) => e.templateId === 'sister_nhalia_drowned_canticle',
    )!;
    boss.inCombat = true;
    boss.hp = Math.ceil(boss.maxHp * 0.69);
    (sim as any).updateDelveRuns();
    const thralls = [...sim.entities.values()].filter((e) => e.templateId === 'choir_thrall');
    expect(thralls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('delve module containment (no backtrack / no out-of-map escape)', () => {
  const R = PLAYER_BODY_RADIUS;

  function activeModuleBounds(sim: Sim) {
    const run = sim.delveRunForPlayer(sim.playerId)!;
    const moduleId = run.modules[run.moduleIndex];
    const layout = DELVE_MODULE_LAYOUTS[moduleId as keyof typeof DELVE_MODULE_LAYOUTS];
    const zBase = delveModuleZOffset(run.modules, run.moduleIndex);
    const wallX = layout.wallX ?? 23;
    return {
      run,
      layout,
      ox: run.origin.x,
      oz: run.origin.z + zBase,
      halfX: wallX - 1, // DUNGEON_WALL_HW
    };
  }

  it('cannot walk sideways out through the side walls (no out-of-map escape)', () => {
    const sim = makeSim('warrior');
    enterReliquary(sim);
    const b = activeModuleBounds(sim);
    const p = sim.player;
    // March hard into the east wall and well past it.
    const res = (sim as any).resolveMove(p.pos.x, p.pos.z, b.ox + 200, p.pos.z, R, p);
    expect(res.x).toBeLessThanOrEqual(b.ox + b.halfX - R + 1e-6);
    expect(res.x).toBeGreaterThanOrEqual(b.ox - b.halfX + R - 1e-6);
  });

  it('cannot walk south out of the entrance room into the inter-module gap', () => {
    const sim = makeSim('warrior');
    enterReliquary(sim);
    const b = activeModuleBounds(sim);
    const p = sim.player;
    // Drive far south (toward the previous-room / gap void).
    const res = (sim as any).resolveMove(p.pos.x, p.pos.z, p.pos.x, b.oz - 300, R, p);
    expect(res.z).toBeGreaterThanOrEqual(b.oz + b.layout.zMin + 1 + R - 1e-6);
  });

  it('after transitioning forward, cannot backtrack south into the previous room', () => {
    const sim = makeSim('warrior');
    enterReliquary(sim);
    const run = sim.delveRunForPlayer(sim.playerId)!;
    // Force-open and advance one module (transition is teleport-based).
    expect(run.modules.length).toBeGreaterThan(1);
    run.exitPortalOpen = true;
    (sim as any).advanceDelveModule(run);
    expect(run.moduleIndex).toBe(1);
    const b = activeModuleBounds(sim);
    const p = sim.player;
    // The player is now in module 1; walking south must not re-enter module 0
    // or the gap between them.
    const res = (sim as any).resolveMove(p.pos.x, p.pos.z, p.pos.x, b.oz - 300, R, p);
    expect(res.z).toBeGreaterThanOrEqual(b.oz + b.layout.zMin + 1 + R - 1e-6);
  });
});

describe('The Drowned Litany Hunter LOS uses active module order', () => {
  it('blocks LOS with the active Litany module instead of default module order', () => {
    const sim = makeSim('warrior');
    enterLitany(sim);
    const run = sim.delveRunForPlayer(sim.playerId)!;
    run.modules = ['litany_ring', 'litany_apse'];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);
    const mob = createMob((sim as any).nextId++, MOBS.choir_thrall, 12, {
      x: run.origin.x,
      y: 0,
      z: run.origin.z + 72,
    });
    (sim as any).addEntity(mob);
    run.mobIds.push(mob.id);
    sim.player.pos.x = run.origin.x;
    sim.player.pos.z = run.origin.z + 12;
    mob.pos.x = run.origin.x;
    mob.pos.z = run.origin.z + 72;
    expect((sim as any).hasLineOfSight(sim.player, mob)).toBe(false);
    mob.pos.x = run.origin.x + 18;
    mob.pos.z = run.origin.z + 42;
    expect((sim as any).hasLineOfSight(sim.player, mob)).toBe(true);
  });
});

describe('The Drowned Litany (Phase 6 boss mechanics)', () => {
  function enterLitanyApse(sim: Sim) {
    enterLitany(sim);
    const run = sim.delveRunForPlayer(sim.playerId)!;
    run.modules = ['litany_apse'];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);
    return run;
  }

  function nhalia(sim: Sim) {
    return [...sim.entities.values()].find(
      (e) => e.templateId === 'sister_nhalia_drowned_canticle',
    )!;
  }

  it('Sister Nhalia has no generic stomp/summonAdds/enrage placeholder traits', () => {
    const m = MOBS.sister_nhalia_drowned_canticle;
    expect(m.stomp).toBeUndefined();
    expect(m.summonAdds).toBeUndefined();
    expect(m.enrage).toBeUndefined();
  });

  it('spawns 2 Drowned Cantors at 70% and 35% HP with a shield until both die', () => {
    const sim = makeSim();
    const run = enterLitanyApse(sim);
    const boss = nhalia(sim);
    boss.inCombat = true;

    boss.hp = Math.ceil(boss.maxHp * 0.69);
    (sim as any).updateDelveRuns();
    let cantors = [...sim.entities.values()].filter((e) => e.templateId === 'drowned_cantor');
    expect(cantors.length).toBe(2);
    expect(boss.auras.some((a) => a.id === 'nhalia_cantor_shield')).toBe(true);
    expect(run.nhaliaBoss?.firedCantorPhases).toBe(1);

    for (const c of cantors)
      (sim as any).dealDamage(sim.player, c, c.maxHp + 1, false, 'physical', null, 'hit', true);
    (sim as any).updateDelveRuns();
    expect(boss.auras.some((a) => a.id === 'nhalia_cantor_shield')).toBe(false);

    boss.hp = Math.ceil(boss.maxHp * 0.34);
    (sim as any).updateDelveRuns();
    cantors = [...sim.entities.values()].filter(
      (e) => e.templateId === 'drowned_cantor' && !e.dead,
    );
    expect(cantors.length).toBe(2);
    expect(run.nhaliaBoss?.firedCantorPhases).toBe(2);
    expect(boss.auras.some((a) => a.id === 'nhalia_cantor_shield')).toBe(true);
  });

  it('Final Bell at 10% HP spawns Bog Thralls and hits the party once', () => {
    const sim = makeSim();
    enterLitanyApse(sim);
    const boss = nhalia(sim);
    boss.inCombat = true;
    const run = sim.delveRunForPlayer(sim.playerId)!;
    run.nhaliaBoss!.firedCantorPhases = 2;
    const hp0 = sim.player.hp;
    boss.hp = Math.max(1, Math.round(boss.maxHp * 0.08));
    (sim as any).updateDelveRuns();
    expect(sim.delveRunForPlayer(sim.playerId)!.nhaliaBoss?.finalBellFired).toBe(true);
    const thralls = [...sim.entities.values()].filter((e) => e.templateId === 'choir_thrall');
    expect(thralls.length).toBeGreaterThanOrEqual(4);
    expect(hp0 - sim.player.hp).toBeGreaterThan(0);
    boss.hp = Math.max(1, Math.round(boss.maxHp * 0.05));
    (sim as any).updateDelveRuns();
    const thrallsAfter = [...sim.entities.values()].filter((e) => e.templateId === 'choir_thrall');
    expect(thrallsAfter.length).toBe(thralls.length);
  });

  it('Blackwater Mark puddles damage a standing player (driver path, not static hazard)', () => {
    const sim = makeSim();
    const run = enterLitanyApse(sim);
    const boss = nhalia(sim);
    boss.inCombat = true;
    run.nhaliaBoss!.markTimer = 0.001;
    (sim as any).updateDelveRuns();
    expect(run.nhaliaBoss!.marks.length).toBe(1);
    const mark = run.nhaliaBoss!.marks[0]!;
    sim.player.pos = { x: mark.x, y: sim.player.pos.y, z: mark.z };
    sim.player.prevPos = { ...sim.player.pos };
    const hp0 = sim.player.hp;
    for (let i = 0; i < 25; i++) (sim as any).updateDelveRuns();
    expect(sim.player.hp).toBeLessThan(hp0);
  });

  it('Blackwater Mark timing is deterministic for a fixed seed', () => {
    const runMark = (seed: number) => {
      const sim = makeSim('warrior', seed);
      const run = enterLitanyApse(sim);
      const boss = nhalia(sim);
      boss.inCombat = true;
      run.nhaliaBoss!.markTimer = 0.001;
      (sim as any).updateDelveRuns();
      return run.nhaliaBoss!.marks.map((m) => [Math.round(m.x * 10), Math.round(m.z * 10)]);
    };
    expect(runMark(42)).toEqual(runMark(42));
  });

  it('an evade re-arms the encounter to fresh-pull state and despawns bells and adds', () => {
    const sim = makeSim();
    const run = enterLitanyApse(sim);
    const boss = nhalia(sim);
    boss.inCombat = true;

    // First pull: below 70% fires the first Cantor phase; force a bell volley too.
    boss.hp = Math.ceil(boss.maxHp * 0.69);
    run.nhaliaBoss!.bellVolleyTimer = 0.001;
    (sim as any).updateDelveRuns();
    expect(run.nhaliaBoss?.firedCantorPhases).toBe(1);
    const bellIds = run.nhaliaBoss!.bells.map((b) => b.entityId);
    expect(bellIds.length).toBeGreaterThan(0);
    const cantorIds = [...sim.entities.values()]
      .filter((e) => e.templateId === 'drowned_cantor')
      .map((e) => e.id);
    expect(cantorIds.length).toBe(2);

    // Kited past the leash: the evade arrival reset (same entry the wipe path uses).
    (sim as any).resetEvadingMob(boss);

    expect(boss.hp).toBe(boss.maxHp);
    expect(boss.auras.some((a) => a.id === 'nhalia_cantor_shield')).toBe(false);
    expect(run.nhaliaBoss?.firedCantorPhases).toBe(0);
    expect(run.nhaliaBoss?.finalBellFired).toBe(false);
    expect(run.nhaliaBoss?.marks).toEqual([]);
    expect(run.nhaliaBoss?.bells).toEqual([]);
    expect(run.nhaliaBoss?.cantorShieldAdds).toEqual([]);
    for (const id of bellIds) expect(sim.entities.has(id)).toBe(false);
    for (const id of cantorIds) expect(sim.entities.has(id)).toBe(false);
  });

  it('a re-pull after an evade fires the 70% phase and the Final Bell again', () => {
    const sim = makeSim();
    const run = enterLitanyApse(sim);
    const boss = nhalia(sim);
    boss.inCombat = true;
    boss.hp = Math.ceil(boss.maxHp * 0.69);
    (sim as any).updateDelveRuns();
    expect(run.nhaliaBoss?.firedCantorPhases).toBe(1);

    (sim as any).resetEvadingMob(boss);
    expect(run.nhaliaBoss?.firedCantorPhases).toBe(0);

    // Re-pull: the 70% Cantor phase fires again, shield and all.
    boss.inCombat = true;
    boss.hp = Math.ceil(boss.maxHp * 0.69);
    (sim as any).updateDelveRuns();
    expect(run.nhaliaBoss?.firedCantorPhases).toBe(1);
    const cantors = [...sim.entities.values()].filter(
      (e) => e.templateId === 'drowned_cantor' && !e.dead,
    );
    expect(cantors.length).toBe(2);
    expect(boss.auras.some((a) => a.id === 'nhalia_cantor_shield')).toBe(true);

    // And the Final Bell still fires at 10% on the re-pull.
    run.nhaliaBoss!.firedCantorPhases = 2;
    boss.hp = Math.max(1, Math.round(boss.maxHp * 0.08));
    (sim as any).updateDelveRuns();
    expect(run.nhaliaBoss?.finalBellFired).toBe(true);
    const thralls = [...sim.entities.values()].filter(
      (e) => e.templateId === 'choir_thrall' && !e.dead,
    );
    expect(thralls.length).toBeGreaterThanOrEqual(4);
  });

  it('a player death clears in-flight bells and Blackwater marks so an in-delve respawn is not insta-killed', () => {
    const sim = makeSim();
    const run = enterLitanyApse(sim);
    const boss = nhalia(sim);
    boss.inCombat = true;

    // Force a bell volley: bells are now in flight.
    run.nhaliaBoss!.bellVolleyTimer = 0.001;
    (sim as any).updateDelveRuns();
    expect(run.nhaliaBoss!.bells.length).toBeGreaterThan(0);
    const bellIds = run.nhaliaBoss!.bells.map((b) => b.entityId);

    // Force a Blackwater mark: a puddle is now persisted at the player's position.
    run.nhaliaBoss!.markTimer = 0.001;
    (sim as any).updateDelveRuns();
    expect(run.nhaliaBoss!.marks.length).toBeGreaterThanOrEqual(1);

    // Kill the player and respawn in-delve (first death: 50% HP at the module entry).
    killPlayer(sim);
    expect(sim.player.dead).toBe(true);
    sim.releaseSpirit();
    expect(sim.player.dead).toBe(false);

    // The bell/mark lethal effects must not outlive the death: they are cleared
    // at respawn, so the entity ids are gone and the collections are empty.
    expect(run.nhaliaBoss!.bells).toEqual([]);
    expect(run.nhaliaBoss!.marks).toEqual([]);
    for (const id of bellIds) expect(sim.entities.has(id)).toBe(false);

    // The respawned player takes no further bell/mark damage: the loop is broken.
    const hpAfterRespawn = sim.player.hp;
    for (let i = 0; i < 20; i++) (sim as any).updateDelveRuns();
    expect(sim.player.hp).toBe(hpAfterRespawn);

    // The encounter itself is not re-armed by the death (unlike an evade reset):
    // Cantor phases / Final Bell progress and the volley timer are untouched.
    expect(run.nhaliaBoss!.bellVolleyTimer).toBeGreaterThan(0);
  });

  it('a player death clearing bells does not perturb the shared rng draw order', () => {
    const runOnce = (seed: number) => {
      const sim = makeSim('warrior', seed);
      const run = enterLitanyApse(sim);
      const boss = nhalia(sim);
      boss.inCombat = true;
      run.nhaliaBoss!.bellVolleyTimer = 0.001;
      (sim as any).updateDelveRuns();
      killPlayer(sim);
      sim.releaseSpirit();
      // A few more volleys/marks after the respawn to exercise further rng draws.
      for (let i = 0; i < 20 * 15; i++) (sim as any).updateDelveRuns();
      return {
        firedCantorPhases: run.nhaliaBoss!.firedCantorPhases,
        finalBellFired: run.nhaliaBoss!.finalBellFired,
        bells: run.nhaliaBoss!.bells.length,
        marks: run.nhaliaBoss!.marks.length,
        bellVolleyTimer: Math.round(run.nhaliaBoss!.bellVolleyTimer * 1000),
      };
    };
    expect(runOnce(42)).toEqual(runOnce(42));
  });
});

describe('The Drowned Litany (Phase 7 Drowned Reliquary Rite)', () => {
  function enterLitanyApse(sim: Sim) {
    enterLitany(sim);
    const run = sim.delveRunForPlayer(sim.playerId)!;
    run.bountiful = false;
    run.modules = ['litany_apse'];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);
    return run;
  }

  function killNhalia(sim: Sim) {
    const boss = [...sim.entities.values()].find(
      (e) => e.templateId === 'sister_nhalia_drowned_canticle',
    )!;
    (sim as any).dealDamage(sim.player, boss, boss.maxHp + 1, false, 'physical', null, 'hit', true);
    sim.tick();
  }

  function waitForRitePlayback(sim: Sim, run: ReturnType<typeof enterLitanyApse>) {
    let guard = 0;
    while (run.drownedLitanyRite?.sequencePlaying && guard++ < 200) sim.tick();
    expect(run.drownedLitanyRite?.sequencePlaying).toBe(false);
  }

  function clickShrine(sim: Sim, run: ReturnType<typeof enterLitanyApse>, kind: string) {
    const rite = run.drownedLitanyRite!;
    const id = rite.shrineEntityIds[kind as keyof typeof rite.shrineEntityIds];
    const ent = sim.entities.get(id)!;
    sim.player.pos = { ...ent.pos };
    sim.player.prevPos = { ...ent.pos };
    sim.delveInteract(id);
  }

  function clickWrongShrine(sim: Sim, run: ReturnType<typeof enterLitanyApse>) {
    const expected = run.drownedLitanyRite!.sequence[run.drownedLitanyRite!.currentIndex]!;
    const wrong = (
      ['rite_shrine_bell', 'rite_shrine_candle', 'rite_shrine_reed', 'rite_shrine_skull'] as const
    ).find((k) => k !== expected)!;
    clickShrine(sim, run, wrong);
  }

  function replaySequence(sim: Sim, run: ReturnType<typeof enterLitanyApse>) {
    for (const kind of run.drownedLitanyRite!.sequence) clickShrine(sim, run, kind);
  }

  function chooseRite(sim: Sim, intensity: 'easy' | 'medium' | 'hard') {
    // The difficulty commit is geo-gated to the reliquary (like the collect),
    // so stand on it before choosing, the way a real player would.
    const run = sim.delveRunForPlayer(sim.playerId)!;
    const reliquary = sim.entities.get(run.drownedLitanyRite!.reliquaryId)!;
    sim.player.pos = { ...reliquary.pos };
    sim.player.prevPos = { ...reliquary.pos };
    (sim as Sim).delveRiteChoose(intensity);
  }

  it('rejects a rite difficulty commit from a player away from the reliquary', () => {
    const sim = makeSim();
    const run = enterLitanyApse(sim);
    killNhalia(sim);
    expect(run.drownedLitanyRite?.awaitingChoice).toBe(true);
    const reliquary = sim.entities.get(run.drownedLitanyRite!.reliquaryId)!;
    // Stand well outside the plate radius and try to commit remotely.
    sim.player.pos = { x: reliquary.pos.x + 30, y: reliquary.pos.y, z: reliquary.pos.z + 30 };
    sim.player.prevPos = { ...sim.player.pos };
    sim.delveRiteChoose('hard');
    expect(run.drownedLitanyRite?.awaitingChoice).toBe(true); // still waiting
    expect(run.drownedLitanyRite?.sequence.length).toBe(0);
    // The prompt opens out to DELVE_INTERACT_RANGE (6yd), so a choose from
    // inside that radius (but off the reliquary itself) must be accepted.
    sim.player.pos = { x: reliquary.pos.x + 5.5, y: reliquary.pos.y, z: reliquary.pos.z };
    sim.player.prevPos = { ...sim.player.pos };
    sim.delveRiteChoose('hard');
    expect(run.drownedLitanyRite?.awaitingChoice).toBe(false);
    expect(run.drownedLitanyRite?.sequence.length).toBe(6);
  });

  it('rejects an unknown rite intensity outright (no medium coercion)', () => {
    const sim = makeSim();
    const run = enterLitanyApse(sim);
    killNhalia(sim);
    const reliquary = sim.entities.get(run.drownedLitanyRite!.reliquaryId)!;
    sim.player.pos = { ...reliquary.pos };
    sim.player.prevPos = { ...reliquary.pos };
    // 'nightmare' is a plain unknown; 'toString'/'constructor' would pass a
    // truthiness check via Object.prototype, hence the Object.hasOwn backstop.
    for (const bogus of ['nightmare', 'toString', 'constructor']) {
      sim.delveRiteChoose(bogus as never);
      expect(run.drownedLitanyRite?.awaitingChoice).toBe(true);
      expect(run.drownedLitanyRite?.sequence.length).toBe(0);
    }
  });

  it('awaits a difficulty choice after the boss dies (no playback yet)', () => {
    const sim = makeSim();
    const run = enterLitanyApse(sim);
    killNhalia(sim);
    expect(run.drownedLitanyRite?.awaitingChoice).toBe(true);
    expect(run.drownedLitanyRite?.sequence.length).toBe(0);
    expect(run.drownedLitanyRite?.sequencePlaying).toBe(false);
  });

  it('surfaces the rite phase on delveRun for the HUD guidance', () => {
    const sim = makeSim();
    const run = enterLitanyApse(sim);
    expect(sim.delveRun?.rite).toBeNull();
    killNhalia(sim);
    expect(sim.delveRun?.rite?.phase).toBe('choose');
    chooseRite(sim, 'easy');
    sim.tick();
    expect(sim.delveRun?.rite?.phase).toBe('playback');
    waitForRitePlayback(sim, run);
    expect(sim.delveRun?.rite?.phase).toBe('input');
    expect(sim.delveRun?.rite?.total).toBe(run.drownedLitanyRite!.sequence.length);
    replaySequence(sim, run);
    expect(sim.delveRun?.rite?.phase).toBe('open');
  });

  it('each intensity sets its sequence length, tries, and playback count', () => {
    const cfg = (intensity: 'easy' | 'medium' | 'hard') => {
      const sim = makeSim();
      const run = enterLitanyApse(sim);
      killNhalia(sim);
      chooseRite(sim, intensity);
      const st = run.drownedLitanyRite!;
      return {
        len: st.sequence.length,
        tries: st.tries,
        mistakes: st.mistakesAllowed,
        playbacks: st.playbacks,
      };
    };
    // tries = full attempts; mistakesAllowed (tries - 1) is the tolerated wrong touches.
    expect(cfg('easy')).toEqual({ len: 4, tries: 3, mistakes: 2, playbacks: 3 });
    expect(cfg('medium')).toEqual({ len: 5, tries: 2, mistakes: 1, playbacks: 2 });
    expect(cfg('hard')).toEqual({ len: 6, tries: 1, mistakes: 0, playbacks: 1 });
  });

  it('shows the sequence the chosen number of times before accepting input', () => {
    const sim = makeSim();
    const run = enterLitanyApse(sim);
    killNhalia(sim);
    chooseRite(sim, 'easy'); // 3 playbacks
    let pulses = 0;
    let guard = 0;
    while (run.drownedLitanyRite?.sequencePlaying && guard++ < 600) {
      for (const ev of sim.tick()) if (ev.type === 'delveRitePulse') pulses++;
    }
    expect(run.drownedLitanyRite?.sequencePlaying).toBe(false);
    expect(run.drownedLitanyRite?.playbackLoop).toBe(3);
    expect(pulses).toBe(4 * 3); // 4 symbols shown 3 times
  });

  it('generates the same sequence for the same seed + intensity', () => {
    const seqFor = (seed: number) => {
      const sim = makeSim('warrior', seed);
      const run = enterLitanyApse(sim);
      killNhalia(sim);
      chooseRite(sim, 'hard');
      return run.drownedLitanyRite!.sequence;
    };
    expect(seqFor(42)).toEqual(seqFor(42));
    expect(seqFor(99)).not.toEqual(seqFor(100));
  });

  it('spawns four shrines and no lockpick chest', () => {
    const sim = makeSim();
    const run = enterLitanyApse(sim);
    killNhalia(sim);
    const kinds = run.objectIds.map((id) => run.objectState[id]?.kind);
    expect(kinds.filter((k) => k?.startsWith('rite_shrine_')).length).toBe(4);
    expect(kinds.includes('locked_chest')).toBe(false);
    expect(kinds.includes('drowned_reliquary')).toBe(true);
  });

  it('Hard flawless grants premium loot and completes the run', () => {
    const sim = makeSim('warrior');
    const run = enterLitanyApse(sim);
    killNhalia(sim);
    chooseRite(sim, 'hard');
    waitForRitePlayback(sim, run);
    replaySequence(sim, run);
    const chestId = run.rewardChestId!;
    expect(run.completed).toBe(true);
    expect(run.objectState[chestId].lootedTier).toBe('premium');
    expect(run.surfaceExitId).not.toBeNull();
    const loot = run.objectState[chestId].partyLoot![sim.playerId]!;
    // Premium: guaranteed uncommon + 20% rare. At least 1 item, first is always uncommon.
    expect(loot.length).toBeGreaterThanOrEqual(1);
    expect(['siltguard_helm', 'bulwark_rusted_pauldrons']).toContain(loot[0].itemId);
    if (loot.length > 1) expect(loot[1].itemId).toBe('nhalias_bell_maul');
  });

  it('rite loot rolls independently per party member, each collecting their own share', () => {
    const sim = makeSim('warrior');
    const rival = sim.addPlayer('warrior', 'Duoist');
    sim.partyInvite(rival, sim.playerId);
    sim.partyAccept(rival);
    const run = enterLitanyApse(sim);
    // Party membership alone is not "in this delve run": the rival must
    // actually be inside the instance (not AFK elsewhere) to share in loot.
    const rivalEnt = sim.entities.get(rival)!;
    rivalEnt.pos = { ...sim.player.pos };
    rivalEnt.prevPos = { ...rivalEnt.pos };
    killNhalia(sim);
    // Hard flawless guarantees a premium (non-empty) roll for both members, unlike
    // low tier's 50% chance at nothing, so this test isn't seed-flaky.
    chooseRite(sim, 'hard');
    waitForRitePlayback(sim, run);
    replaySequence(sim, run);
    const chestId = run.rewardChestId!;
    const state = run.objectState[chestId];
    // Both party members rolled their own loot; neither's slice is empty.
    expect(state.partyLoot![sim.playerId]!.length).toBeGreaterThan(0);
    expect(state.partyLoot![rival]!.length).toBeGreaterThan(0);
    // A run-mate standing ON the chest collects their OWN slice, not the opener's.
    const chest = sim.entities.get(chestId)!;
    rivalEnt.pos = { ...chest.pos };
    rivalEnt.prevPos = { ...chest.pos };
    sim.drainEvents();
    sim.collectDelveChestLoot(chestId, rival);
    expect(state.partyLoot![rival]!.length).toBe(0);
    expect(state.partyLoot![sim.playerId]!.length).toBeGreaterThan(0);
    const refusals = sim.drainEvents().filter((e) => e.type === 'error');
    expect(refusals.some((e) => /nothing left to take/i.test(e.text ?? ''))).toBe(false);
    // The opener still collects their own share normally afterward.
    sim.player.pos = { ...chest.pos };
    sim.player.prevPos = { ...chest.pos };
    sim.collectDelveChestLoot(chestId);
    expect(state.partyLoot![sim.playerId]!.length).toBe(0);
  });

  it('F-interact at the reliquary collects loot stranded by the distance-gated window', () => {
    const sim = makeSim('warrior');
    const run = enterLitanyApse(sim);
    killNhalia(sim);
    // Hard flawless guarantees a premium (non-empty) roll, so this isn't seed-flaky.
    chooseRite(sim, 'hard');
    waitForRitePlayback(sim, run);
    // replaySequence completes the rite standing at the FINAL SHRINE, 8yd from the
    // reliquary: outside both the HUD loot window's 7yd auto-close radius and the
    // collect gate (DELVE_PLATE_RADIUS + 2). The real player is stuck exactly here.
    replaySequence(sim, run);
    const chestId = run.rewardChestId!;
    const state = run.objectState[chestId];
    expect(state.partyLoot![sim.playerId]!.length).toBeGreaterThan(0);
    // The loot window's take-all fires from the shrine and is rejected as too far.
    sim.drainEvents();
    sim.collectDelveChestLoot(chestId);
    const farRefusals = sim.drainEvents().filter((e) => e.type === 'error');
    expect(farRefusals.some((e) => /move closer/i.test(e.text ?? ''))).toBe(true);
    expect(state.partyLoot![sim.playerId]!.length).toBeGreaterThan(0); // not granted
    // Recovery: walk onto the reliquary and press F. Pre-fix this fell through to
    // "Nothing happens." and the items were stranded in partyLoot forever.
    const chest = sim.entities.get(chestId)!;
    sim.player.pos = { ...chest.pos };
    sim.player.prevPos = { ...chest.pos };
    sim.delveInteract(chestId);
    const events = sim.drainEvents();
    expect(events.some((e) => e.type === 'error' && /nothing happens/i.test(e.text ?? ''))).toBe(
      false,
    );
    expect(events.some((e) => e.type === 'loot' && /you receive/i.test(e.text ?? ''))).toBe(true);
    expect(state.partyLoot![sim.playerId]!.length).toBe(0);
    // A second interact reads as an emptied reliquary, not a dead object.
    sim.delveInteract(chestId);
    expect(
      sim.drainEvents().some((e) => e.type === 'log' && /reliquary is empty/i.test(e.text ?? '')),
    ).toBe(true);
  });

  it('Easy caps loot at low even with a flawless replay', () => {
    const sim = makeSim('warrior');
    const run = enterLitanyApse(sim);
    killNhalia(sim);
    chooseRite(sim, 'easy');
    waitForRitePlayback(sim, run);
    replaySequence(sim, run);
    expect(run.objectState[run.rewardChestId!].lootedTier).toBe('low');
  });

  it('a wrong touch on Hard exhausts the single try and opens on low loot', () => {
    const sim = makeSim('warrior');
    const run = enterLitanyApse(sim);
    killNhalia(sim);
    chooseRite(sim, 'hard'); // 1 try, no slack
    waitForRitePlayback(sim, run);
    clickWrongShrine(sim, run);
    expect(run.drownedLitanyRite?.opened).toBe(true);
    expect(run.objectState[run.rewardChestId!].lootedTier).toBe('low');
    expect(run.completed).toBe(true);
  });

  it('a wrong touch on Medium replays the sequence and a flawless retry still earns medium', () => {
    const sim = makeSim('warrior');
    const run = enterLitanyApse(sim);
    killNhalia(sim);
    chooseRite(sim, 'medium'); // 2 tries
    waitForRitePlayback(sim, run);
    clickWrongShrine(sim, run);
    // The failed attempt replays the sequence and restarts input from the top.
    expect(run.drownedLitanyRite?.opened).toBe(false);
    expect(run.drownedLitanyRite?.sequencePlaying).toBe(true);
    expect(run.drownedLitanyRite?.currentIndex).toBe(0);
    waitForRitePlayback(sim, run);
    replaySequence(sim, run);
    expect(run.objectState[run.rewardChestId!].lootedTier).toBe('medium');
  });

  it('using up every try on Medium opens on consolation low-tier loot', () => {
    const sim = makeSim('warrior');
    const run = enterLitanyApse(sim);
    killNhalia(sim);
    chooseRite(sim, 'medium'); // 2 tries
    waitForRitePlayback(sim, run);
    clickWrongShrine(sim, run); // try 1 failed
    waitForRitePlayback(sim, run);
    clickWrongShrine(sim, run); // try 2 failed: out of tries
    expect(run.drownedLitanyRite?.opened).toBe(true);
    expect(run.objectState[run.rewardChestId!].lootedTier).toBe('low');
    expect(run.completed).toBe(true);
  });
});
