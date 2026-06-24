// Delve system, spatial band, lifecycle, death rules, and pet stow (Phase 1).

import { describe, expect, it } from 'vitest';
import { delveChestItemsForTier } from '../src/sim/content/delves/lockpick_tiers';
import {
  ARENA_X,
  ARENA_X_MIN,
  DELVE_BAND_X_MIN,
  DELVE_LIST,
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
import { DELVE_MODULE_LAYOUTS } from '../src/sim/delve_layout';

import { createMob } from '../src/sim/entity';
import { solveLockActions } from '../src/sim/lockpick';
import { Rng } from '../src/sim/rng';
import { DELVE_IMPLEMENTED_AFFIXES, Sim } from '../src/sim/sim';
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
    expect(sim.petOf(sim.playerId)?.templateId).toBe('imp');
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
    const plate = run.objectIds
      .map((id) => ({ id, state: run.objectState[id] }))
      .find((o) => o.state?.kind === 'pressure_plate');
    const plateEnt = sim.entities.get(plate!.id)!;
    sim.player.pos = { ...plateEnt.pos };
    sim.player.prevPos = { ...plateEnt.pos };
    sim.tick();
    expect(run.exitPortalOpen).toBe(true);
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
  });

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
    sim.tick();
    return boss;
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
    killBoss(sim, run);

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

    expect(run.completed).toBe(true);
    // base clear (+1 mark) + premium ante bonus (+2 marks)
    expect(sim.delveMarksFor(sim.playerId)).toBe(marksBefore + 3);
    expect(run.objectState[chestId].looted).toBe(true);
    expect(run.objectState[chestId].open).toBe(true);
    expect(run.objectState[chestId].lootedTier).toBe('premium');
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

describe('delve module containment (no backtrack / no out-of-map escape)', () => {
  const R = 0.5;

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
