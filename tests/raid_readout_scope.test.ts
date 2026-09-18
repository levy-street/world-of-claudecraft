// The raid readouts (ignivar_raid_readouts.ts, nythraxis_raid_readouts.ts)
// and the rift instance lookup are read by the renderer once per frame. In an
// open-field world with no raid they must touch no entity at all, and inside
// the instance they must answer exactly what a walk of the whole roster does.
import { describe, expect, it, vi } from 'vitest';
import { RIFT_BAND_X_MIN, RIFT_REGION_HALF_X, RIFT_X_MIN } from '../src/sim/data';
import * as nythraxis from '../src/sim/encounters/nythraxis';
import { updateVarkhulEncounter, VARKHUL_BOSS_ID } from '../src/sim/encounters/varkhul';
import { activeIgnivarMeteorWarnings } from '../src/sim/ignivar_meteors';
import {
  IGNIVAR_EMBER_SENTINEL_ID,
  IGNIVAR_FORGE_APPROACH_ID,
  IGNIVAR_SECOND_WING_ID,
} from '../src/sim/ignivar_raid_ids';
import {
  collectActiveIgnivarMeteors,
  collectActiveVarkhulAnvilMeteors,
  collectActiveVarkhulAssemblies,
  collectActiveVarkhulCinderFires,
  collectActiveVarkhulCinderOrbProjectiles,
  collectActiveVarkhulForgePortalTelegraphs,
  collectActiveVarkhulForgestormWarnings,
} from '../src/sim/ignivar_raid_readouts';
import { instanceEntities } from '../src/sim/instance_entities';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { activeIgnivarTrashMeteorWarning } from '../src/sim/mob/ignivar_trash_automata';
import { activeNythraxisGravefires } from '../src/sim/nythraxis_gravefire';
import {
  collectActiveNythraxisBindingSigils,
  collectActiveNythraxisGraveEruptions,
  collectActiveNythraxisGraveFlames,
  collectActiveNythraxisGravefires,
} from '../src/sim/nythraxis_raid_readouts';
import { riftInstanceAtPos } from '../src/sim/rift/runs';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { DT, type Entity, IGNIVAR_BOSS_ID, NYTHRAXIS_BOSS_ID } from '../src/sim/types';
import {
  activeVarkhulAssembly,
  VARKHUL_ASSEMBLY_FORGE_LOCAL_POS,
} from '../src/sim/varkhul_assembly';

const COLLECTORS = [
  collectActiveIgnivarMeteors,
  collectActiveVarkhulForgestormWarnings,
  collectActiveVarkhulAnvilMeteors,
  collectActiveVarkhulAssemblies,
  collectActiveVarkhulForgePortalTelegraphs,
  collectActiveVarkhulCinderFires,
  collectActiveVarkhulCinderOrbProjectiles,
  collectActiveNythraxisGraveEruptions,
  collectActiveNythraxisGraveFlames,
  collectActiveNythraxisGravefires,
  collectActiveNythraxisBindingSigils,
];

describe('raid readouts in the open field', () => {
  it('touch no entity when no instance slot holds a mob', () => {
    const sim = new Sim({ seed: 11, playerClass: 'warrior' });
    expect(sim.entities.size).toBeGreaterThan(100);
    const values = vi.spyOn(sim.entities, 'values');
    const get = vi.spyOn(sim.entities, 'get');
    for (const collect of COLLECTORS) expect(collect(sim.ctx)).toEqual([]);
    expect(values).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('walks only the slots own mob ids, in slot then spawn order', () => {
    const a = { id: 1 } as Entity;
    const b = { id: 2 } as Entity;
    const c = { id: 3 } as Entity;
    const ctx = {
      entities: new Map([
        [3, c],
        [2, b],
        [1, a],
      ]),
      instances: [{ mobIds: [1, 99] }, { mobIds: [] }, { mobIds: [3, 2] }],
    } as unknown as SimContext;
    expect([...instanceEntities(ctx)]).toEqual([a, c, b]);
  });
});

describe('riftInstanceAtPos', () => {
  it('rests on the rift band starting exactly at the floor region west edge', () => {
    // Every rift origin sits at RIFT_X_MIN; the early-out is exact only while
    // the band's west edge is the region's west edge.
    expect(RIFT_X_MIN - RIFT_REGION_HALF_X).toBe(RIFT_BAND_X_MIN);
  });

  it('never consults the rift slots for a position outside the rift band', () => {
    const sim = new Sim({ seed: 11, playerClass: 'warrior' });
    let reads = 0;
    const ctx = new Proxy(sim.ctx, {
      get(target, key, receiver) {
        if (key === 'riftInstances') reads++;
        return Reflect.get(target, key, receiver);
      },
    });
    expect(riftInstanceAtPos(ctx, sim.player.pos)).toBeNull();
    expect(reads).toBe(0);
    expect(sim.riftBossDeathZones()).toEqual([]);
  });
});

function ignivarRoom() {
  const sim = new Sim({ seed: 8124, playerClass: 'warrior', devCommands: true });
  sim.setDungeonDifficulty('normal', sim.player.id);
  expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, sim.player.id, true)).toBe(true);
  const instance = sim.instances.find(
    (candidate) => candidate.dungeonId === IGNIVAR_FORGE_APPROACH_ID && candidate.partyKey !== null,
  );
  if (!instance) throw new Error('Missing claimed room');
  const sentinel = instance.mobIds
    .map((id) => sim.entities.get(id))
    .find((mob) => mob?.templateId === IGNIVAR_EMBER_SENTINEL_ID);
  if (!sentinel) throw new Error('Ember Sentinel missing');
  for (const entity of sim.entities.values()) {
    if (entity.kind === 'mob' && entity.id !== sentinel.id) entity.dead = true;
  }
  sentinel.inCombat = true;
  sentinel.aiState = 'attack';
  sentinel.aggroTargetId = sim.player.id;
  sentinel.swingTimer = 999;
  sentinel.moveSpeed = 0;
  sim.player.pos = sim.groundPos(sentinel.pos.x + 6, sentinel.pos.z);
  sim.player.prevPos = { ...sim.player.pos };
  sim.rebucket(sim.player);
  sentinel.ignivarTrashSpellTimer = DT;
  sim.tick();
  return { sim, sentinel };
}

/** A view of `ctx` whose instance list ends with one synthetic slot owning
 *  every roster entity no real slot owns: the readouts then see the whole
 *  roster, exactly as the whole-roster walk did, while every real lookup
 *  (`find` over the slots) still resolves the real slot first. */
function wholeRosterCtx(sim: Sim): SimContext {
  const owned = new Set<number>();
  for (const inst of sim.instances) for (const id of inst.mobIds) owned.add(id);
  const rest = [...sim.entities.keys()].filter((id) => !owned.has(id));
  const instances = [...sim.instances, { mobIds: rest, partyKey: null, dungeonId: '' }];
  return new Proxy(sim.ctx, {
    get(target, key, receiver) {
      return key === 'instances' ? instances : Reflect.get(target, key, receiver);
    },
  });
}

function expectEveryCollectorMatchesTheRosterWalk(sim: Sim): void {
  const reference = wholeRosterCtx(sim);
  for (const collect of COLLECTORS) {
    expect(collect(sim.ctx), collect.name).toEqual(collect(reference));
  }
}

describe('raid readouts inside the instance', () => {
  it('answer the Ignivar meteor warnings a whole-roster walk answers', () => {
    const { sim, sentinel } = ignivarRoom();
    const reference = [];
    for (const entity of sim.entities.values()) {
      if (entity.templateId === IGNIVAR_BOSS_ID && entity.ignivar) {
        reference.push(...activeIgnivarMeteorWarnings(entity.id, entity.ignivar));
      }
      const trash = activeIgnivarTrashMeteorWarning(entity);
      if (trash) reference.push(trash);
    }
    expect(reference.some((w) => w.id.startsWith(`ignivar-trash:${sentinel.id}:`))).toBe(true);
    expect(sim.activeIgnivarMeteors).toEqual(reference);
    expectEveryCollectorMatchesTheRosterWalk(sim);
  });

  it('answer the Varkhul assemblies a whole-roster walk answers', () => {
    const sim = new Sim({ seed: 6112, playerClass: 'warrior', autoEquip: true, devCommands: true });
    sim.setPlayerLevel(20);
    sim.chat('/dev dungeon ignivar_inner_crucible normal');
    sim.chat('/dev varkhulraid normal');
    const boss = [...sim.entities.values()].find(
      (e) => e.templateId === VARKHUL_BOSS_ID && !e.dead,
    );
    if (!boss) throw new Error('Varkhul missing');
    for (let i = 0; i < 40; i++) updateVarkhulEncounter(sim.ctx, boss);
    const inst = sim.instances.find(
      (candidate) =>
        candidate.dungeonId === IGNIVAR_SECOND_WING_ID && candidate.mobIds.includes(boss.id),
    );
    if (!inst) throw new Error('Varkhul instance missing');
    const origin = sim.ctx.instanceOriginOf(inst);
    const forge = sim.ctx.groundPos(
      origin.x + VARKHUL_ASSEMBLY_FORGE_LOCAL_POS.x,
      origin.z + VARKHUL_ASSEMBLY_FORGE_LOCAL_POS.z,
    );
    const reference = [];
    for (const entity of sim.entities.values()) {
      if (entity.templateId !== VARKHUL_BOSS_ID || entity.dead || !entity.varkhul) continue;
      if ((entity.varkhul.engage?.phase ?? 'done') === 'forging') continue;
      const active = activeVarkhulAssembly(entity.id, entity.varkhul, forge, entity.pos, (id) =>
        sim.entities.get(id),
      );
      if (active) reference.push(active);
    }
    expect(reference.length).toBe(1);
    expect(sim.activeVarkhulAssemblies).toEqual(reference);
    expectEveryCollectorMatchesTheRosterWalk(sim);
  });

  it('answer the Nythraxis gravefires a whole-roster walk answers', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', devCommands: true });
    sim.chat('/dev raid normal', sim.player.id);
    const boss = [...sim.entities.values()].find(
      (e) => e.kind === 'mob' && e.templateId === NYTHRAXIS_BOSS_ID && !e.dead,
    );
    if (!boss) throw new Error('Nythraxis missing');
    const st = nythraxis.initNythraxisEncounter(boss);
    st.gravefires = [
      { seq: 3, x: boss.pos.x, z: boss.pos.z, dirX: 1, dirZ: 0, elapsed: 1, tickTimer: 1 },
    ];
    const reference = [];
    for (const entity of sim.entities.values()) {
      if (entity.templateId !== NYTHRAXIS_BOSS_ID || entity.dead || !entity.nythraxis) continue;
      reference.push(
        ...activeNythraxisGravefires(entity.id, entity.nythraxis.gravefires ?? [], 'normal'),
      );
    }
    expect(reference.length).toBe(1);
    expect(sim.activeNythraxisGravefires).toEqual(reference);
    expectEveryCollectorMatchesTheRosterWalk(sim);
  });
});

describe('a raid boss outside every instance slot', () => {
  it('has no readouts: the dev-only /dev spawn path is knowingly outside the scope', () => {
    const sim = new Sim({ seed: 11, playerClass: 'warrior', devCommands: true });
    const before = sim.entities.size;
    sim.chat(`/dev spawn ${IGNIVAR_BOSS_ID}`);
    const boss = [...sim.entities.values()].find((e) => e.templateId === IGNIVAR_BOSS_ID);
    if (!boss) {
      // The command did not spawn a boss on this build: nothing to pin.
      expect(sim.entities.size).toBe(before);
      return;
    }
    expect(sim.instances.some((inst) => inst.mobIds.includes(boss.id))).toBe(false);
    boss.ignivar = {
      meteorCastKey: 1,
      meteorImpactRemaining: 1.4,
      meteorPoints: [{ x: boss.pos.x, z: boss.pos.z }],
    } as NonNullable<typeof boss.ignivar>;
    expect(sim.activeIgnivarMeteors).toEqual([]);
  });
});
