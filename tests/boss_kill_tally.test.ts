// The lifetime boss kill tally behind IWorld.bossKills (src/sim/boss_kill_tally.ts):
// the death hub raises it at the real kill inside a claimed instance, a council
// counts once when its last member falls, the character save carries it (an old
// save without the field loads as no kills), and the `bkills` self key mirrors it
// to the online client reference-stably.
import { describe, expect, it } from 'vitest';
import { bossKillsWireJson } from '../server/dungeon_run_wire';
import { nextBossKills } from '../src/net/boss_kills_wire';
import {
  addBossKill,
  BOSS_KILL_COUNT_CAP,
  BOSS_KILL_ENCOUNTERS,
  bossKillCount,
  EMPTY_BOSS_KILLS,
  sanitizeBossKills,
  savedBossKills,
} from '../src/sim/boss_kill_tally';
import { FINDER_ACTIVITIES } from '../src/sim/content/dungeon_finder';
import {
  SMITH_HEART_COUNCIL,
  SMITH_HEART_DUNGEON,
  SMITH_HEART_FINAL_BOSS,
  SMITH_HEART_GUARDIANS,
} from '../src/sim/content/smith_heart';
import { BUILTIN_WORLD, DUNGEONS } from '../src/sim/data';
import {
  COUNCIL_GUARDIAN,
  COUNCIL_SEAM_SINGER,
} from '../src/sim/encounters/smith_heart/council_ids';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { type InstanceSlot, Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';
import { JOURNAL_INSTANCES, journalPageBodies } from '../src/ui/hud/journal/journal_catalog';

const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

function raid(seed = 31): { sim: Sim; inst: InstanceSlot; pid: number } {
  const sim = new Sim({
    seed,
    playerClass: 'warrior',
    noPlayer: true,
    world: WORLD,
    devCommands: true,
  });
  const pid = sim.addPlayer('warrior', 'Tallier');
  if (!enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pid)) throw new Error('enter');
  const inst = sim.ctx.instances.find(
    (i) => i.dungeonId === SMITH_HEART_DUNGEON && i.partyKey !== null,
  ) as InstanceSlot;
  return { sim, inst, pid };
}

function body(sim: Sim, inst: InstanceSlot, mobId: string): Entity {
  const index = DUNGEONS[inst.dungeonId].spawns.findIndex((s) => s.mobId === mobId);
  const mob = sim.ctx.entities.get(inst.mobIds[index]);
  if (!mob) throw new Error(`${mobId} not placed`);
  return mob;
}

function kill(sim: Sim, inst: InstanceSlot, pid: number, mobId: string): void {
  sim.ctx.handleDeath(body(sim, inst, mobId), sim.ctx.entities.get(pid) as Entity);
}

describe('boss kill tally: the tracked encounters', () => {
  it('tracks every Finder encounter and the Smith Heart route, the council as one', () => {
    for (const activity of FINDER_ACTIVITIES) {
      for (const encounter of activity.encounters) {
        expect(BOSS_KILL_ENCOUNTERS.get(encounter.mobId)?.mobId, encounter.mobId).toBe(
          encounter.mobId,
        );
      }
    }
    const council = BOSS_KILL_ENCOUNTERS.get(COUNCIL_SEAM_SINGER);
    expect(council?.mobId).toBe(COUNCIL_GUARDIAN);
    expect(council?.bodyIds).toEqual(SMITH_HEART_COUNCIL);
    expect(BOSS_KILL_ENCOUNTERS.get(COUNCIL_GUARDIAN)).toBe(council);
    for (const id of [
      SMITH_HEART_GUARDIANS.breath,
      SMITH_HEART_GUARDIANS.quench,
      SMITH_HEART_GUARDIANS.heat,
      SMITH_HEART_FINAL_BOSS,
    ]) {
      expect(BOSS_KILL_ENCOUNTERS.get(id)?.bodyIds).toEqual([id]);
    }
  });

  it('gives every Adventure Journal page a tracked body, so no page reads 0 forever', () => {
    const untracked: string[] = [];
    for (const instance of JOURNAL_INSTANCES) {
      for (const key of instance.source.bossKeys) {
        const bodies = journalPageBodies(instance.source, key);
        if (!bodies.some((mobId) => BOSS_KILL_ENCOUNTERS.has(mobId))) {
          untracked.push(`${instance.id}:${key}`);
        }
      }
    }
    expect(untracked).toEqual([]);
  });
});

describe('boss kill tally: the kill point (death hub)', () => {
  it('counts a guardian kill once, on the claim difficulty, for the credited player', () => {
    const { sim, inst, pid } = raid();
    expect(sim.bossKills).toBe(EMPTY_BOSS_KILLS);
    kill(sim, inst, pid, SMITH_HEART_GUARDIANS.breath);
    expect(sim.bossKills).toEqual({ [SMITH_HEART_GUARDIANS.breath]: 1 });
    expect(bossKillCount(sim.bossKills, SMITH_HEART_GUARDIANS.breath, 'normal')).toBe(1);
    expect(bossKillCount(sim.bossKills, SMITH_HEART_GUARDIANS.breath, 'heroic')).toBe(0);
    // The offline Sim and the meta read the same frozen object.
    expect(sim.bossKills).toBe(sim.meta(pid)?.bossKills);
    expect(Object.isFrozen(sim.bossKills)).toBe(true);
  });

  it('counts the council once, when its last member falls', () => {
    const { sim, inst, pid } = raid();
    kill(sim, inst, pid, COUNCIL_SEAM_SINGER);
    expect(sim.bossKills).toBe(EMPTY_BOSS_KILLS);
    kill(sim, inst, pid, COUNCIL_GUARDIAN);
    expect(sim.bossKills).toEqual({ [COUNCIL_GUARDIAN]: 1 });
  });

  it('keys a Heroic kill apart from Normal and adds across runs', () => {
    const { sim, inst, pid } = raid();
    kill(sim, inst, pid, SMITH_HEART_FINAL_BOSS);
    const afterNormal = sim.bossKills;
    const second = raid(32);
    second.inst.difficulty = 'heroic';
    // Carry the first character's record into the second world, then kill again.
    const state = sim.serializeCharacter(pid);
    if (!state) throw new Error('serialize');
    const pid2 = second.sim.addPlayer('warrior', 'Carrier', { state });
    if (!enterDungeon(second.sim.ctx, SMITH_HEART_DUNGEON, pid2)) throw new Error('enter');
    const claim = second.sim.ctx.instances.find(
      (i) => i.dungeonId === SMITH_HEART_DUNGEON && i.partyKey !== null && i !== second.inst,
    ) as InstanceSlot;
    claim.difficulty = 'heroic';
    kill(second.sim, claim, pid2, SMITH_HEART_FINAL_BOSS);
    const tally = second.sim.meta(pid2)?.bossKills ?? EMPTY_BOSS_KILLS;
    expect(tally).toEqual({
      [SMITH_HEART_FINAL_BOSS]: 1,
      [`${SMITH_HEART_FINAL_BOSS}:heroic`]: 1,
    });
    // The first world's record is untouched (copy on write, never mutated).
    expect(afterNormal).toEqual({ [SMITH_HEART_FINAL_BOSS]: 1 });
  });

  it('never counts trash, or a boss template outside a claimed instance', () => {
    const { sim, inst, pid } = raid();
    const trash = DUNGEONS[SMITH_HEART_DUNGEON].spawns.find(
      (s) => !BOSS_KILL_ENCOUNTERS.has(s.mobId),
    );
    if (!trash) throw new Error('no trash');
    kill(sim, inst, pid, trash.mobId);
    expect(sim.bossKills).toBe(EMPTY_BOSS_KILLS);
    // The same guardian body, its claim released: no instance, no count.
    const breath = body(sim, inst, SMITH_HEART_GUARDIANS.heat);
    inst.mobIds = inst.mobIds.filter((id) => id !== breath.id);
    sim.ctx.handleDeath(breath, sim.ctx.entities.get(pid) as Entity);
    expect(sim.bossKills).toBe(EMPTY_BOSS_KILLS);
  });
});

describe('boss kill tally: persistence', () => {
  it('round-trips through the character save', () => {
    const { sim, inst, pid } = raid();
    kill(sim, inst, pid, SMITH_HEART_GUARDIANS.quench);
    const state = sim.serializeCharacter(pid);
    expect(state?.bossKills).toEqual({ [SMITH_HEART_GUARDIANS.quench]: 1 });
    const restored = new Sim({ seed: 9, playerClass: 'warrior', noPlayer: true, world: WORLD });
    const back = restored.addPlayer('warrior', 'Tallier', { state: state ?? undefined });
    expect(restored.meta(back)?.bossKills).toEqual({ [SMITH_HEART_GUARDIANS.quench]: 1 });
    expect(Object.isFrozen(restored.meta(back)?.bossKills)).toBe(true);
  });

  it('loads an old save without the field as no kills, and saves it unchanged', () => {
    const { sim, pid } = raid();
    const state = sim.serializeCharacter(pid);
    if (!state) throw new Error('serialize');
    expect('bossKills' in state).toBe(false);
    const legacy = { ...state };
    delete legacy.bossKills;
    const restored = new Sim({ seed: 9, playerClass: 'warrior', noPlayer: true, world: WORLD });
    const back = restored.addPlayer('warrior', 'Tallier', { state: legacy });
    expect(restored.meta(back)?.bossKills).toBeUndefined();
    expect('bossKills' in (restored.serializeCharacter(back) ?? {})).toBe(false);
  });

  it('sanitizes a broken saved tally instead of trusting it', () => {
    expect(sanitizeBossKills(undefined)).toBe(EMPTY_BOSS_KILLS);
    expect(sanitizeBossKills(null)).toBe(EMPTY_BOSS_KILLS);
    expect(sanitizeBossKills([3])).toBe(EMPTY_BOSS_KILLS);
    expect(sanitizeBossKills('x')).toBe(EMPTY_BOSS_KILLS);
    expect(
      sanitizeBossKills({
        morthen: 4.7,
        'morthen:heroic': 2,
        'morthen:mythic': 1,
        'Bad Key': 3,
        zero: 0,
        negative: -2,
        nan: Number.NaN,
        text: '5',
        huge: 1e12,
      }),
    ).toEqual({ morthen: 4, 'morthen:heroic': 2, huge: BOSS_KILL_COUNT_CAP });
  });

  it('writes nothing for an empty tally and a sorted copy otherwise', () => {
    expect(savedBossKills({})).toEqual({});
    expect(savedBossKills({ bossKills: EMPTY_BOSS_KILLS })).toEqual({});
    const meta: { bossKills?: Readonly<Record<string, number>> } = {};
    addBossKill(meta, 'ysolei', 'heroic');
    addBossKill(meta, 'morthen', 'normal');
    addBossKill(meta, 'morthen', 'normal');
    expect(Object.keys(savedBossKills(meta).bossKills ?? {})).toEqual(['morthen', 'ysolei:heroic']);
    expect(savedBossKills(meta).bossKills).toEqual({ morthen: 2, 'ysolei:heroic': 1 });
  });
});

describe('boss kill tally: the bkills wire', () => {
  it('serializes once per tally and decodes reference-stably', () => {
    const { sim, inst, pid } = raid();
    expect(bossKillsWireJson(sim.ctx, pid)).toBe('{}');
    expect(bossKillsWireJson(sim.ctx, 999_999)).toBe('{}');
    kill(sim, inst, pid, SMITH_HEART_GUARDIANS.heat);
    const json = bossKillsWireJson(sim.ctx, pid);
    expect(JSON.parse(json)).toEqual({ [SMITH_HEART_GUARDIANS.heat]: 1 });
    // Built once per tally object: the same string until a count moves.
    expect(bossKillsWireJson(sim.ctx, pid)).toBe(json);

    const mirrored = nextBossKills(EMPTY_BOSS_KILLS, JSON.parse(json));
    expect(mirrored).toEqual(sim.bossKills);
    // A repeated frame keeps the held object; a malformed one decodes empty.
    expect(nextBossKills(mirrored, JSON.parse(json))).toBe(mirrored);
    expect(nextBossKills(mirrored, { [SMITH_HEART_GUARDIANS.heat]: 2 })).not.toBe(mirrored);
    expect(nextBossKills(mirrored, 'garbage')).toBe(EMPTY_BOSS_KILLS);
    expect(nextBossKills(EMPTY_BOSS_KILLS, {})).toBe(EMPTY_BOSS_KILLS);
  });
});
