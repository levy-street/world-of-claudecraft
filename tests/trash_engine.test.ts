// The trash engine's generic pieces (src/sim/mob/trash_kit/CLAUDE.md "Engine
// pieces"), driven inside a real claimed Gravewyrm Sanctum (the Sanctum
// trash test's shape): G3 usable encounter bodies (encounter_use.ts, through
// the ordinary interact press the server runs), temporary combat walls
// (combat_walls.ts and the per-slot collision view
// instances/combat_wall_state.ts: movement AND line of sight), the
// freeze-at-N-stacks slow (freeze_stacks.ts), G6's line-of-sight nova
// (kit_nova.ts), G5's walker (kit_walker.ts), the split (kit_split.ts), the
// hazard pools (kit_hazard.ts), the reanimate rite (reanimate.ts) and the
// brand with its quench zones (brand.ts); then determinism over a seeded run.

import { afterEach, describe, expect, it } from 'vitest';
import { syncClientCombatWalls } from '../src/net/combat_wall_wire';
import { resolvePosition } from '../src/sim/colliders';
import { updateCasting } from '../src/sim/combat/casting_lifecycle';
import { DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import {
  COMBAT_WALL_SHAPES,
  clearCombatWallStateForTest,
  combatWallsAt,
  isCombatWallTemplate,
} from '../src/sim/instances/combat_wall_state';
import { applyDungeonMobTuning } from '../src/sim/instances/difficulty';
import { claimedInstanceAt, freeInstance } from '../src/sim/instances/dungeons';
import { entityLineOfSightClear } from '../src/sim/line_of_sight_elevation';
import { SCRIPTED_INTERRUPTIBLE_CHANNELS } from '../src/sim/mob/healer_channel';
import { tickTrashKits } from '../src/sim/mob/trash_kit';
import { spawnCombatWall } from '../src/sim/mob/trash_kit/combat_walls';
import { kitUseOf, tryStartKitUse } from '../src/sim/mob/trash_kit/encounter_use';
import {
  TRASH_DEMO_EMPOWERED,
  TRASH_DEMO_NOVA,
  TRASH_DEMO_NOVA_UNSTOPPABLE,
  TRASH_DEMO_WALKER_ORB,
  TRASH_ENGINE_DEMO_KIT,
} from '../src/sim/mob/trash_kit/engine_demo';
import {
  applyFreezeStack,
  freezeStackSlow,
  freezeStacksOf,
} from '../src/sim/mob/trash_kit/freeze_stacks';
import { spawnKitHazard } from '../src/sim/mob/trash_kit/kit_hazard';
import { novaCastIdFor } from '../src/sim/mob/trash_kit/kit_nova';
import { kitObjectsOf } from '../src/sim/mob/trash_kit/kit_objects';
import { launchWalker, WALKER_ARM_SECONDS } from '../src/sim/mob/trash_kit/kit_walker';
import {
  SANCTUM_ICE_SLAB,
  SANCTUM_SPILLED_SOULFIRE,
  SANCTUM_TOPPLE_BRAZIER,
} from '../src/sim/mob/trash_kit/sanctum_cast_ids';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import {
  DT,
  type Entity,
  type FreezeStackDef,
  isKitUseCast,
  isNonSpellCast,
  type KitHazardDef,
  type SimEvent,
} from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';

const DUNGEON = 'gravewyrm_sanctum';

interface Room {
  sim: Sim;
  inst: InstanceSlot;
  me: Entity;
  events: SimEvent[];
}

function room(difficulty: 'normal' | 'heroic' = 'normal', seed = 93): Room {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.chat(`/dev sanctum enter ${difficulty}`, sim.player.id);
  const inst = claimedInstanceAt(sim.ctx, sim.player.pos);
  if (!inst) throw new Error('no sanctum claim');
  const me = sim.player;
  me.maxHp = 1e6;
  me.hp = 1e6;
  const o = instanceOrigin(DUNGEONS[DUNGEON].index, inst.slot);
  // The Thaw Works' upper terrace: a wide flat floor (the mob AI never runs
  // here; only the trash pass and the casting update are driven).
  me.pos = sim.ctx.groundPos(o.x, o.z + 42);
  me.prevPos = { ...me.pos };
  me.facing = 0;
  sim.drainEvents();
  return { sim, inst, me, events: [] };
}

function pull(r: Room, mob: Entity, victim: Entity = r.me): Entity {
  mob.inCombat = true;
  mob.aiState = 'attack';
  mob.aggroTargetId = victim.id;
  mob.facing = Math.atan2(victim.pos.x - mob.pos.x, victim.pos.z - mob.pos.z);
  return mob;
}

function engage(r: Room, templateId: string, dx = 6, dz = 0): Entity {
  const mob = createMob(r.sim.ctx.nextId++, MOBS[templateId], MOBS[templateId].minLevel, {
    ...r.sim.ctx.groundPos(r.me.pos.x + dx, r.me.pos.z + dz),
  });
  applyDungeonMobTuning(mob, DUNGEON, r.inst.difficulty);
  r.sim.ctx.addEntity(mob);
  r.inst.mobIds.push(mob.id);
  return pull(r, mob);
}

function run(r: Room, seconds: number, mobs: Entity[]): void {
  for (let t = 0; t < seconds - DT * 0.5; t += DT) {
    for (const m of mobs) {
      if (m.dead || !r.sim.ctx.entities.has(m.id)) continue;
      m.inCombat = true;
      m.aiState = 'attack';
      m.aggroTargetId ??= r.me.id;
    }
    tickTrashKits(r.sim.ctx);
    r.events.push(...r.sim.drainEvents());
  }
}

function addPlayer(r: Room, cls: 'mage' | 'priest' | 'warrior', dx: number, dz: number): Entity {
  const pid = r.sim.addPlayer(cls, `E${cls}${dx}${dz}`);
  const e = r.sim.ctx.entities.get(pid) as Entity;
  e.pos = r.sim.ctx.groundPos(r.me.pos.x + dx, r.me.pos.z + dz);
  e.prevPos = { ...e.pos };
  e.maxHp = 1e6;
  e.hp = 1e6;
  return e;
}

function dealt(r: Room, targetId: number, ability: string): number[] {
  return r.events
    .filter(
      (e): e is Extract<SimEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.targetId === targetId && e.ability === ability,
    )
    .map((e) => e.amount);
}

function origin(r: Room): { x: number; z: number } {
  return instanceOrigin(DUNGEONS[DUNGEON].index, r.inst.slot);
}

/** Drive one player's casting update (the per-player phase of the tick). */
function castTick(r: Room, p: Entity, seconds: number): void {
  const meta = r.sim.ctx.players.get(p.id);
  if (!meta) throw new Error('no meta');
  for (let t = 0; t < seconds - DT * 0.5; t += DT) {
    updateCasting(r.sim.ctx, p, meta);
    r.events.push(...r.sim.drainEvents());
  }
}

afterEach(() => clearCombatWallStateForTest());

describe('G3: a usable encounter body (the Soul Brazier)', () => {
  it('the use rides the non-spell family and carries a prefixed cast id', () => {
    const def = MOBS.soul_brazier.trashKit?.usable;
    expect(def?.castId).toBe(SANCTUM_TOPPLE_BRAZIER);
    expect(isKitUseCast(SANCTUM_TOPPLE_BRAZIER)).toBe(true);
    expect(isNonSpellCast(SANCTUM_TOPPLE_BRAZIER)).toBe(true);
    expect(isKitUseCast('sanctum_goad')).toBe(false);
  });

  it('the interact press on a targeted brazier starts a 1 s use, then topples it onto the pack', () => {
    const r = room();
    const brazier = engage(r, 'soul_brazier', 3, 0);
    const kicker = addPlayer(r, 'mage', 0, 0.5);
    const ogre = engage(r, 'ogre_sledge_hauler', 5, 0);
    const thaw = engage(r, 'broodsworn_thawcaller', 5.5, 1.5);
    kicker.targetId = brazier.id;
    // The server's interact command is exactly this call (server/game.ts).
    r.sim.interact(kicker.id);
    expect(kicker.castingAbility).toBe(SANCTUM_TOPPLE_BRAZIER);
    expect(kicker.castTargetId).toBe(brazier.id);
    castTick(r, kicker, 1);
    expect(kicker.castingAbility).toBeNull();
    expect(brazier.dead).toBe(true);
    const pools = kitObjectsOf(r.sim.ctx, r.inst, 'hazard');
    expect(pools).toHaveLength(1);
    expect(pools[0].templateId).toBe(SANCTUM_SPILLED_SOULFIRE);
    // It spills past the brazier, away from the kicker.
    expect(pools[0].pos.x).toBeGreaterThan(brazier.pos.x);
    const ogreHp = ogre.hp;
    const thawHp = thaw.hp;
    run(r, 3, [ogre, thaw]);
    // 4 percent of each mob's own health a second, the first beat 1 s in.
    const ogreBurns = dealt(r, ogre.id, 'Spilled Soulfire');
    expect(ogreBurns).toHaveLength(3);
    expect(ogreBurns[0]).toBe(Math.round(ogre.maxHp * 0.04));
    expect(ogre.hp).toBe(ogreHp - ogreBurns.reduce((a, b) => a + b, 0));
    expect(thaw.hp).toBeLessThan(thawHp);
    // Never the players standing in it.
    expect(dealt(r, kicker.id, 'Spilled Soulfire')).toEqual([]);
    expect(dealt(r, r.me.id, 'Spilled Soulfire')).toEqual([]);
    // It lifts after its 8 s.
    run(r, 5.1, [ogre, thaw]);
    expect(kitObjectsOf(r.sim.ctx, r.inst, 'hazard')).toHaveLength(0);
  });

  it('refuses a press from out of reach, a dead body, or a busy player, and validates on the server', () => {
    const r = room();
    const brazier = engage(r, 'soul_brazier', 9, 0);
    const kicker = addPlayer(r, 'mage', 0, 0);
    kicker.targetId = brazier.id;
    // Forged from 9 yd: the sim refuses it (the client is never trusted).
    expect(tryStartKitUse(r.sim.ctx, brazier, kicker)).toBe(true);
    expect(kicker.castingAbility).toBeNull();
    expect(r.sim.drainEvents().some((e) => e.type === 'error' && e.text === 'Too far away.')).toBe(
      true,
    );
    // In reach but already casting: busy.
    kicker.pos = r.sim.ctx.groundPos(brazier.pos.x - 2, brazier.pos.z);
    kicker.castingAbility = 'fireball';
    expect(tryStartKitUse(r.sim.ctx, brazier, kicker)).toBe(true);
    expect(kicker.castingAbility).toBe('fireball');
    kicker.castingAbility = null;
    // A body that is not usable lets the press fall through.
    const ogre = engage(r, 'ogre_sledge_hauler', 4, 4);
    expect(kitUseOf(ogre)).toBeNull();
    expect(tryStartKitUse(r.sim.ctx, ogre, kicker)).toBe(false);
    // A dead brazier cannot be kicked.
    brazier.dead = true;
    expect(tryStartKitUse(r.sim.ctx, brazier, kicker)).toBe(false);
  });

  it('a landed hit, a step out of reach, or the body falling breaks the use', () => {
    const r = room();
    const brazier = engage(r, 'soul_brazier', 3, 0);
    const kicker = addPlayer(r, 'mage', 0.5, 0);
    const ogre = engage(r, 'ogre_sledge_hauler', 3, 3);
    kicker.targetId = brazier.id;
    r.sim.interact(kicker.id);
    castTick(r, kicker, 0.4);
    expect(kicker.castingAbility).toBe(SANCTUM_TOPPLE_BRAZIER);
    // Any hit that lands breaks a non-spell activity.
    r.sim.ctx.dealDamage(ogre, kicker, 50, false, 'physical', 'Melee', 'hit', false);
    expect(kicker.castingAbility).toBeNull();
    expect(brazier.dead).toBe(false);
    // Again, then walk away.
    r.sim.interact(kicker.id);
    expect(kicker.castingAbility).toBe(SANCTUM_TOPPLE_BRAZIER);
    kicker.pos = r.sim.ctx.groundPos(brazier.pos.x - 8, brazier.pos.z);
    castTick(r, kicker, 0.1);
    expect(kicker.castingAbility).toBeNull();
    // Again, then the brazier dies under it.
    kicker.pos = r.sim.ctx.groundPos(brazier.pos.x - 2, brazier.pos.z);
    r.sim.interact(kicker.id);
    expect(kicker.castingAbility).toBe(SANCTUM_TOPPLE_BRAZIER);
    brazier.dead = true;
    castTick(r, kicker, 0.1);
    expect(kicker.castingAbility).toBeNull();
    expect(kitObjectsOf(r.sim.ctx, r.inst, 'hazard')).toHaveLength(0);
  });

  it('a pool turned on the mobs never burns a boss or a control-immune great body', () => {
    const r = room();
    const spill = MOBS.soul_brazier.trashKit?.usable?.effect;
    const def = (spill?.kind === 'topple' ? spill.hazard : undefined) as KitHazardDef;
    const tusker = engage(r, 'sledge_tusker', 4, 0);
    const splinter = engage(r, 'glacier_splinter', 5, 1);
    spawnKitHazard(r.sim.ctx, r.inst, r.me, def, r.me.pos.x + 4.5, r.me.pos.z);
    run(r, 2, [tusker, splinter]);
    expect(dealt(r, tusker.id, def.name)).toEqual([]);
    expect(dealt(r, splinter.id, def.name).length).toBe(2);
  });
});

describe('temporary combat walls', () => {
  it('an Ice Slab blocks movement and line of sight, then shatters and frees both', () => {
    const r = room();
    const ctx = r.sim.ctx;
    const o = origin(r);
    expect(isCombatWallTemplate(SANCTUM_ICE_SLAB)).toBe(true);
    const mage = addPlayer(r, 'mage', 0, 10);
    // Before: a clear line and a clear path.
    expect(entityLineOfSightClear(r.sim.cfg.seed, r.me, mage)).toBe(true);
    const wall = spawnCombatWall(
      ctx,
      r.inst,
      SANCTUM_ICE_SLAB,
      'Ice Slab',
      r.me.pos.x,
      r.me.pos.z + 5,
      0,
      15,
    );
    expect(wall).not.toBeNull();
    tickTrashKits(ctx);
    // The slot's view carries the wall.
    expect(combatWallsAt(o.x, o.z)).toHaveLength(1);
    // Sight across it is blocked.
    expect(entityLineOfSightClear(r.sim.cfg.seed, r.me, mage)).toBe(false);
    // A body pushed into its centre comes back out of its footprint.
    const into = resolvePosition(r.sim.cfg.seed, r.me.pos.x, r.me.pos.z + 5, 0.5);
    const shape = COMBAT_WALL_SHAPES[SANCTUM_ICE_SLAB];
    const out =
      Math.abs(into.z - (r.me.pos.z + 5)) >= shape.hd || Math.abs(into.x - r.me.pos.x) >= shape.hw;
    expect(out).toBe(true);
    // 15 s later it shatters: the line and the floor are clear again.
    for (let t = 0; t < 15 + DT; t += DT) tickTrashKits(ctx);
    expect(ctx.entities.has((wall as Entity).id)).toBe(false);
    expect(combatWallsAt(o.x, o.z)).toHaveLength(0);
    expect(entityLineOfSightClear(r.sim.cfg.seed, r.me, mage)).toBe(true);
  });

  it('a freed claim drops its walls from the collision view', () => {
    const r = room();
    const o = origin(r);
    spawnCombatWall(
      r.sim.ctx,
      r.inst,
      SANCTUM_ICE_SLAB,
      'Ice Slab',
      r.me.pos.x,
      r.me.pos.z + 5,
      0,
      15,
    );
    tickTrashKits(r.sim.ctx);
    expect(combatWallsAt(o.x, o.z)).toHaveLength(1);
    freeInstance(r.sim.ctx, r.inst);
    tickTrashKits(r.sim.ctx);
    expect(combatWallsAt(o.x, o.z)).toHaveLength(0);
  });

  it('a new world claiming a slot never collides with a wall another world left there', () => {
    const a = room();
    const o = origin(a);
    spawnCombatWall(
      a.sim.ctx,
      a.inst,
      SANCTUM_ICE_SLAB,
      'Ice Slab',
      a.me.pos.x,
      a.me.pos.z + 5,
      0,
      15,
    );
    expect(combatWallsAt(o.x, o.z)).toHaveLength(1);
    // A second world in the same process (the headless env's reset, the
    // suites) claims the same slot while A's wall still stands.
    const b = room();
    expect(origin(b)).toEqual(o);
    expect(combatWallsAt(o.x, o.z)).toHaveLength(0);
    const mage = addPlayer(b, 'mage', 0, 10);
    expect(entityLineOfSightClear(b.sim.cfg.seed, b.me, mage)).toBe(true);
  });

  it('the online client rebuilds the walls from the wall objects it mirrors, and drops them on leaving', () => {
    const r = room();
    const o = origin(r);
    const wall = spawnCombatWall(
      r.sim.ctx,
      r.inst,
      SANCTUM_ICE_SLAB,
      'Ice Slab',
      r.me.pos.x,
      r.me.pos.z + 5,
      0.4,
      15,
    ) as Entity;
    const serverView = combatWallsAt(o.x, o.z)[0];
    clearCombatWallStateForTest();
    // The client's mirror: the same entity fields the wire carries.
    const mirrored = new Map<number, Entity>([[wall.id, { ...wall }]]);
    syncClientCombatWalls({ entities: mirrored, player: r.me });
    expect(combatWallsAt(o.x, o.z)).toEqual([serverView]);
    // The player walks out of the dungeon: the mirror clears its slot.
    syncClientCombatWalls({ entities: mirrored, player: { ...r.me, pos: { x: 0, y: 0, z: 0 } } });
    expect(combatWallsAt(o.x, o.z)).toHaveLength(0);
  });

  it('refuses a template that names no wall shape', () => {
    const r = room();
    expect(
      spawnCombatWall(r.sim.ctx, r.inst, 'not_a_wall', 'Nothing', r.me.pos.x, r.me.pos.z, 0, 5),
    ).toBeNull();
  });
});

describe('freeze at N stacks', () => {
  const def: FreezeStackDef = {
    auraId: 'test_chill',
    name: 'Test Chill',
    perStack: 0.08,
    maxStacks: 5,
    seconds: 8,
    freezeAuraId: 'test_frozen',
    freezeName: 'Test Frozen',
    freezeSeconds: 2,
  };

  it('each stack slows a step more; the fifth freezes and clears them', () => {
    const r = room();
    const whelp = engage(r, 'rime_whelp');
    for (let i = 1; i <= 4; i++) {
      expect(applyFreezeStack(r.sim.ctx, whelp, r.me, def, 'frost')).toBe('stack');
      expect(freezeStacksOf(r.me, def)).toBe(i);
      const aura = r.me.auras.find((a) => a.id === def.auraId);
      expect(aura?.kind).toBe('slow');
      expect(aura?.value).toBeCloseTo(freezeStackSlow(def, i), 9);
    }
    expect(applyFreezeStack(r.sim.ctx, whelp, r.me, def, 'frost')).toBe('frozen');
    expect(freezeStacksOf(r.me, def)).toBe(0);
    const frozen = r.me.auras.find((a) => a.id === def.freezeAuraId);
    expect(frozen?.kind).toBe('stun');
    expect(frozen?.remaining).toBe(2);
    expect(r.sim.ctx.isStunned(r.me)).toBe(true);
    // The count starts over.
    expect(applyFreezeStack(r.sim.ctx, whelp, r.me, def, 'frost')).toBe('stack');
    expect(freezeStacksOf(r.me, def)).toBe(1);
  });

  it('a slow-immune body takes no stacks', () => {
    const r = room();
    const brazier = engage(r, 'soul_brazier');
    expect(applyFreezeStack(r.sim.ctx, r.me, brazier, def, 'frost')).toBe('immune');
    expect(freezeStacksOf(brazier, def)).toBe(0);
  });
});

describe('G6: the line-of-sight nova (the engine demo kit)', () => {
  it('kicks the nova, never its unstoppable twin; every third bar is unstoppable', () => {
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[TRASH_DEMO_NOVA]).toBeDefined();
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[TRASH_DEMO_NOVA_UNSTOPPABLE]).toBeUndefined();
    const def = TRASH_ENGINE_DEMO_KIT.nova;
    if (!def) throw new Error('no nova');
    expect([0, 1, 2, 3, 4, 5].map((n) => novaCastIdFor(def, n))).toEqual([
      TRASH_DEMO_NOVA,
      TRASH_DEMO_NOVA,
      TRASH_DEMO_NOVA_UNSTOPPABLE,
      TRASH_DEMO_NOVA,
      TRASH_DEMO_NOVA,
      TRASH_DEMO_NOVA_UNSTOPPABLE,
    ]);
  });

  it('strikes everyone in its radius who can see the caster, and spares whoever hides behind a wall', () => {
    const r = room();
    const caster = engage(r, 'broodsworn_thawcaller', 0, 10);
    caster.devTrashKit = TRASH_ENGINE_DEMO_KIT;
    const seen = addPlayer(r, 'mage', 6, 4);
    const hidden = addPlayer(r, 'priest', 0, -2);
    // An Ice Slab between the caster and the hider (and the tank behind it).
    spawnCombatWall(
      r.sim.ctx,
      r.inst,
      SANCTUM_ICE_SLAB,
      'Ice Slab',
      r.me.pos.x,
      r.me.pos.z + 4,
      0,
      30,
    );
    tickTrashKits(r.sim.ctx);
    expect(entityLineOfSightClear(r.sim.cfg.seed, caster, hidden)).toBe(false);
    expect(entityLineOfSightClear(r.sim.cfg.seed, caster, seen)).toBe(true);
    run(r, 3 + 2.5 + DT * 2, [caster]);
    expect(dealt(r, seen.id, 'Test Nova')).toHaveLength(1);
    expect(dealt(r, hidden.id, 'Test Nova')).toEqual([]);
    // It silences whoever it struck.
    expect(seen.auras.some((a) => a.kind === 'silence')).toBe(true);
  });

  it('a kick (a school lockout) breaks the kickable bar', () => {
    const r = room();
    const caster = engage(r, 'broodsworn_thawcaller', 0, 10);
    caster.devTrashKit = TRASH_ENGINE_DEMO_KIT;
    addPlayer(r, 'mage', 4, 4);
    run(r, 3 + DT * 2, [caster]);
    expect(caster.castingAbility).toBe(TRASH_DEMO_NOVA);
    // What an interrupt does to a scripted bar: the cast clears.
    r.sim.ctx.cancelCast(caster);
    run(r, 3, [caster]);
    expect(dealt(r, r.me.id, 'Test Nova')).toEqual([]);
  });
});

describe('G5: the walker', () => {
  it('drifts to its nearest fighting ally and empowers it on arrival', () => {
    const r = room();
    const sender = engage(r, 'broodsworn_thawcaller', 0, 10);
    const ally = engage(r, 'ogre_sledge_hauler', 12, 10);
    const def = TRASH_ENGINE_DEMO_KIT.walker;
    if (!def) throw new Error('no walker');
    const orb = launchWalker(r.sim.ctx, r.inst, sender, def);
    expect(orb?.templateId).toBe(TRASH_DEMO_WALKER_ORB);
    run(r, 3.5, [sender, ally]);
    expect(ally.auras.some((a) => a.id === TRASH_DEMO_EMPOWERED)).toBe(true);
    expect(kitObjectsOf(r.sim.ctx, r.inst, 'walker')).toHaveLength(0);
  });

  it('a player standing in its path takes it instead (and the empower), once it has flown clear', () => {
    const r = room();
    const sender = engage(r, 'broodsworn_thawcaller', 0, 10);
    const ally = engage(r, 'ogre_sledge_hauler', 12, 10);
    const blocker = addPlayer(r, 'warrior', 6, 10);
    // A melee standing on the sender never eats it on its first tick.
    const hugger = addPlayer(r, 'priest', 0.5, 10);
    const def = TRASH_ENGINE_DEMO_KIT.walker;
    if (!def) throw new Error('no walker');
    launchWalker(r.sim.ctx, r.inst, sender, def);
    run(r, WALKER_ARM_SECONDS - DT, [sender, ally]);
    expect(kitObjectsOf(r.sim.ctx, r.inst, 'walker')).toHaveLength(1);
    hugger.pos = r.sim.ctx.groundPos(hugger.pos.x - 20, hugger.pos.z);
    run(r, 3, [sender, ally]);
    expect(dealt(r, blocker.id, 'Test Orb')).toHaveLength(1);
    expect(blocker.auras.some((a) => a.id === TRASH_DEMO_EMPOWERED)).toBe(true);
    expect(ally.auras.some((a) => a.id === TRASH_DEMO_EMPOWERED)).toBe(false);
  });

  it('a healing walker mends the ally it reaches (the Last Breath shape)', () => {
    const r = room();
    const sender = engage(r, 'broodsworn_thawcaller', 0, 10);
    const ally = engage(r, 'ogre_sledge_hauler', 8, 10);
    const base = TRASH_ENGINE_DEMO_KIT.walker;
    if (!base) throw new Error('no walker');
    const def = { ...base, empower: { ...base.empower, damagePct: 0, healPct: 0.2 } };
    ally.hp = Math.round(ally.maxHp * 0.5);
    const before = ally.hp;
    launchWalker(r.sim.ctx, r.inst, sender, def);
    run(r, 3, [sender, ally]);
    expect(ally.hp - before).toBe(Math.round(ally.maxHp * 0.2));
    // No damage aura when the def carries none.
    expect(ally.auras.some((a) => a.id === TRASH_DEMO_EMPOWERED)).toBe(false);
  });

  it('fades when no ally is left to reach', () => {
    const r = room();
    const sender = engage(r, 'broodsworn_thawcaller', 0, 10);
    const ally = engage(r, 'ogre_sledge_hauler', 16, 10);
    const def = TRASH_ENGINE_DEMO_KIT.walker;
    if (!def) throw new Error('no walker');
    launchWalker(r.sim.ctx, r.inst, sender, def);
    ally.dead = true;
    ally.hp = 0;
    run(r, 0.2, [sender]);
    expect(kitObjectsOf(r.sim.ctx, r.inst, 'walker')).toHaveLength(0);
  });
});

describe('the split (the Glacier Splinter)', () => {
  it('splits once under half health into two smaller halves of 60 percent of what was left', () => {
    const r = room();
    const splinter = engage(r, 'glacier_splinter');
    const full = splinter.maxHp;
    const scale = splinter.scale;
    run(r, 0.2, [splinter]);
    splinter.hp = Math.floor(full * 0.45);
    const left = splinter.hp;
    run(r, DT, [splinter]);
    const half = Math.ceil(left * 0.6);
    expect(splinter.kitSplit?.role).toBe('parent');
    expect(splinter.maxHp).toBe(half);
    expect(splinter.hp).toBe(half);
    expect(splinter.scale).toBeCloseTo(MOBS.glacier_splinter.scale * 0.72, 9);
    const copy = r.inst.mobIds
      .map((id) => r.sim.ctx.entities.get(id))
      .find((e) => e?.kitSplit?.role === 'child');
    expect(copy?.templateId).toBe('glacier_splinter');
    expect(copy?.hp).toBe(half);
    expect(copy?.summonedAdd).toBe(true);
    expect(copy?.aggroTargetId).toBe(r.me.id);
    // Neither splits again.
    splinter.hp = 1;
    if (copy) copy.hp = 1;
    run(r, DT * 3, [splinter, ...(copy ? [copy] : [])]);
    expect(
      r.inst.mobIds.map((id) => r.sim.ctx.entities.get(id)).filter((e) => e?.kitSplit),
    ).toHaveLength(2);
    // An evade gives the original its pool and size back.
    splinter.inCombat = false;
    splinter.aiState = 'evade';
    tickTrashKits(r.sim.ctx);
    expect(splinter.maxHp).toBe(full);
    expect(splinter.scale).toBe(scale);
    expect(splinter.kitSplit).toBeUndefined();
  });

  it('a split body Shatters smaller', () => {
    const r = room();
    const splinter = engage(r, 'glacier_splinter', 2, 0);
    run(r, 0.2, [splinter]);
    splinter.hp = Math.floor(splinter.maxHp * 0.4);
    run(r, DT, [splinter]);
    splinter.dead = true;
    splinter.hp = 0;
    run(r, 2.2, []);
    const hits = dealt(r, r.me.id, 'Shatter');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toBeLessThanOrEqual(Math.round(180 * 0.6));
    // Its ring was drawn at the shrunken radius (3.6 yd): 4 yd away is safe.
    const r2 = room();
    const s2 = engage(r2, 'glacier_splinter', 4, 0);
    run(r2, 0.2, [s2]);
    s2.hp = Math.floor(s2.maxHp * 0.4);
    run(r2, DT, [s2]);
    s2.dead = true;
    s2.hp = 0;
    run(r2, 2.2, []);
    expect(dealt(r2, r2.me.id, 'Shatter')).toEqual([]);
  });
});

describe('hazard pools', () => {
  it('a player pool rolls on its beat (the first one tick in), only inside its radius, then lifts', () => {
    const r = room();
    const def = MOBS.sanctum_drakonid.trashKit?.breathPool?.hazard as KitHazardDef;
    const scaleguard = engage(r, 'sanctum_drakonid', 0, 8);
    const inside = addPlayer(r, 'mage', 0, 3);
    const outside = addPlayer(r, 'priest', 5, 3);
    spawnKitHazard(r.sim.ctx, r.inst, scaleguard, def, r.me.pos.x, r.me.pos.z + 3);
    run(r, 1 - DT, [scaleguard]);
    expect(dealt(r, inside.id, def.name)).toEqual([]);
    run(r, def.seconds, [scaleguard]);
    const burns = dealt(r, inside.id, def.name);
    expect(burns).toHaveLength(def.seconds);
    for (const b of burns) {
      expect(b).toBeGreaterThanOrEqual(def.min);
      expect(b).toBeLessThanOrEqual(def.max);
    }
    expect(dealt(r, outside.id, def.name)).toEqual([]);
    expect(kitObjectsOf(r.sim.ctx, r.inst, 'hazard')).toHaveLength(0);
  });
});

describe('determinism', () => {
  function trace(seed: number): string {
    const r = room('normal', seed);
    const splinter = engage(r, 'glacier_splinter', 3, 2);
    const caster = engage(r, 'broodsworn_thawcaller', 0, 10);
    caster.devTrashKit = TRASH_ENGINE_DEMO_KIT;
    const whelp = engage(r, 'rime_whelp', 0, 2);
    const ogre = engage(r, 'ogre_sledge_hauler', -8, 6);
    addPlayer(r, 'mage', 6, 4);
    addPlayer(r, 'priest', -14, 10);
    const mobs = [splinter, caster, whelp, ogre];
    run(r, 8, mobs);
    splinter.hp = Math.floor(splinter.maxHp * 0.4);
    run(r, 14, mobs);
    return JSON.stringify(
      r.events
        .filter((e) => e.type === 'damage' || e.type === 'spellfx')
        .map((e) => [e.type, 'ability' in e ? e.ability : '', 'amount' in e ? e.amount : 0]),
    );
  }

  it('the same seed gives the same fight, mechanic for mechanic', () => {
    const a = trace(WORLD_SEED);
    const b = trace(WORLD_SEED);
    expect(a.length).toBeGreaterThan(50);
    expect(a).toBe(b);
  });
});
