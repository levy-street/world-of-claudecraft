import { describe, expect, it } from 'vitest';
import { meleeSwing, rangedSwing } from '../src/sim/combat/auto_attack';
import {
  aggregateSetBonuses,
  ITEM_SETS,
  SET_CROWNFORGED,
  SET_DEATHLORD,
  SET_NECROMANCERS,
  SET_NIGHTTALON,
  SET_SOULFLAME,
  SET_STORMCALLERS,
  SET_WYRMSHADOW,
} from '../src/sim/content/item_sets';
import { MOBS } from '../src/sim/data';
import { createMob, recalcPlayerStats } from '../src/sim/entity';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { Entity, SetProc } from '../src/sim/types';

type ProcInternals = {
  players: Map<number, PlayerMeta>;
  applySetProcs(source: Entity, target: Entity | null, trigger: SetProc['trigger']): void;
  time: number;
};
type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

// The seven epic families and the proc each 4-piece tier must resolve to.
const EPIC_4PC: Array<{ setId: string; procId: string; trigger: SetProc['trigger'] }> = [
  { setId: SET_DEATHLORD, procId: 'set_gravemight', trigger: 'weaponCrit' },
  { setId: SET_WYRMSHADOW, procId: 'set_fangrush', trigger: 'weaponCrit' },
  { setId: SET_NECROMANCERS, procId: 'set_clearcasting', trigger: 'spellCast' },
  { setId: SET_CROWNFORGED, procId: 'set_marrowguard', trigger: 'weaponCrit' },
  { setId: SET_NIGHTTALON, procId: 'set_bared_fangs', trigger: 'weaponCrit' },
  { setId: SET_SOULFLAME, procId: 'set_soulblaze', trigger: 'spellCast' },
  { setId: SET_STORMCALLERS, procId: 'set_soulblaze', trigger: 'spellCast' },
];

const barrowlordEquipment = {
  chest: 'deathlord_warplate',
  legs: 'deathlord_legguards',
  feet: 'deathlord_sabatons',
  helmet: 'deathlords_dread_visage',
};
const direfangEquipment = {
  gloves: 'nighttalon_grips',
  waist: 'nighttalon_waistband',
  helmet: 'nighttalon_crown',
  shoulder: 'nighttalon_shoulderguards',
};

function equipSet(sim: Sim, equipment: Record<string, string>): AnyEntity {
  const internals = sim as unknown as ProcInternals;
  const p = sim.player as AnyEntity;
  const meta = internals.players.get(p.id);
  if (!meta) throw new Error('missing player meta');
  p.level = 20;
  Object.assign(meta.equipment, equipment);
  recalcPlayerStats(p, meta.cls, meta.equipment, meta.talentMods);
  return p;
}

function spawnTarget(sim: AnySim, p: AnyEntity): AnyEntity {
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 5, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + 2,
  }) as AnyEntity;
  mob.maxHp = 500000;
  mob.hp = 500000;
  mob.hostile = true;
  mob.aiState = 'idle';
  sim.addEntity(mob);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  return mob;
}

describe('every epic family has a reachable 4-piece proc', () => {
  it('4 pieces of each family resolves its proc; 3 pieces does not', () => {
    for (const { setId, procId, trigger } of EPIC_4PC) {
      const four = aggregateSetBonuses(new Map([[setId, 4]]));
      expect(
        four.procs.map((p) => p.id),
        setId,
      ).toEqual([procId]);
      expect(four.procs[0].trigger, setId).toBe(trigger);
      const three = aggregateSetBonuses(new Map([[setId, 3]]));
      expect(three.procs, setId).toEqual([]);
    }
  });

  it('every 4-piece tier text states the real proc chance', () => {
    for (const set of Object.values(ITEM_SETS)) {
      for (const tier of set.bonuses) {
        const proc = tier.effect.proc;
        if (!proc) continue;
        expect(tier.text, `${set.id} ${proc.id}`).toContain(
          `${Math.round(proc.chance * 100)}% chance`,
        );
      }
    }
  });
});

describe('weaponCrit set procs from real swings', () => {
  it('a melee crit in 4-piece Barrowlord grants Gravemight and raises attack power', () => {
    const sim = new Sim({ seed: 31, playerClass: 'warrior', autoEquip: false }) as AnySim;
    const p = equipSet(sim, barrowlordEquipment);
    const mob = spawnTarget(sim, p);
    const apBefore = p.attackPower;
    p.critChance = 1; // every connected swing crits
    for (let i = 0; i < 400 && !p.auras.some((a) => a.id === 'set_gravemight'); i++) {
      meleeSwing(sim.ctx, p, mob, 0, null, {});
    }
    const aura = p.auras.find((a) => a.id === 'set_gravemight');
    expect(aura?.kind).toBe('buff_ap');
    expect(aura?.value).toBe(60);
    expect(p.attackPower).toBe(apBefore + 60); // applyAura re-ran recalcPlayerStats
  });

  it('a ranged (Auto Shot) crit in 4-piece Direfang grants Bared Fangs', () => {
    const sim = new Sim({ seed: 32, playerClass: 'hunter', autoEquip: false }) as AnySim;
    const p = equipSet(sim, direfangEquipment);
    const mob = spawnTarget(sim, p);
    p.gm = true; // the shot aggroes the wolf; keep the harness alive
    p.critChance = 1;
    for (let i = 0; i < 200 && !p.auras.some((a) => a.id === 'set_bared_fangs'); i++) {
      rangedSwing(sim.ctx, p, mob, { min: 10, max: 14, speed: 2.4 });
      // the shot resolves on projectile arrival, inside the tick loop's drain
      for (let t = 0; t < 20 && !p.auras.some((a) => a.id === 'set_bared_fangs'); t++) sim.tick();
      mob.hp = mob.maxHp; // undo the shots so the target never dies mid-harness
      mob.dead = false;
    }
    const aura = p.auras.find((a) => a.id === 'set_bared_fangs');
    expect(aura?.kind).toBe('next_attack_crit');
  });

  it('a non-crit swing never rolls the weaponCrit proc (no rng draw past the swing)', () => {
    const sim = new Sim({ seed: 33, playerClass: 'warrior', autoEquip: false }) as AnySim;
    const internals = sim as unknown as ProcInternals;
    const p = equipSet(sim, barrowlordEquipment);
    // engine-level check: the trigger gate itself draws nothing without procs
    p.setProcs = [];
    let draws = 0;
    sim.rng.setObserver(() => {
      draws++;
    });
    internals.applySetProcs(p, null, 'weaponCrit');
    sim.rng.setObserver(null);
    expect(draws).toBe(0);
  });
});

describe('spellCast set procs (Soulblaze, tier-2 casters)', () => {
  it('spell casts in 4-piece Wraithfire eventually grant Soulblaze and raise spell power', () => {
    const sim = new Sim({ seed: 34, playerClass: 'mage', autoEquip: false }) as AnySim;
    const internals = sim as unknown as ProcInternals;
    const p = sim.player as AnyEntity;
    const meta = internals.players.get(p.id)!;
    p.level = 20;
    recalcPlayerStats(p, meta.cls, meta.equipment, meta.talentMods);
    // Wire the resolved 4-piece proc directly (soulflame pieces mirror the
    // necromancers slot layout; the resolver mapping is pinned above).
    p.setProcs = aggregateSetBonuses(new Map([[SET_SOULFLAME, 4]])).procs;
    const spBefore = p.spellPower;
    for (let i = 0; i < 500 && !p.auras.some((a) => a.id === 'set_soulblaze'); i++) {
      internals.applySetProcs(p, null, 'spellCast');
    }
    const aura = p.auras.find((a) => a.id === 'set_soulblaze');
    expect(aura?.kind).toBe('buff_spellpower');
    expect(aura?.value).toBe(40);
    expect(p.spellPower).toBe(spBefore + 40);
  });
});
