// The WoW-style death loop (src/sim/spirit.ts): release the spirit to rise as a
// ghost at the nearest graveyard, run the ghost back to the corpse to resurrect
// penalty-free, or accept a Spirit Healer's resurrection (with Resurrection
// Sickness). Exercised against a real Sim so resolve/recalc/groundPos are real.

import { describe, expect, it } from 'vitest';
import {
  DELVES,
  DUNGEON_X_THRESHOLD,
  OVERWORLD_GRAVEYARDS,
  SPIRIT_HEALER_NPC_ID,
} from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import {
  CORPSE_REZ_RANGE,
  GHOST_RUN_MULT,
  RES_HEALER_HP_FRACTION,
  RES_HP_FRACTION,
  RESURRECTION_SICKNESS_ID,
  SPIRIT_HEALER_RANGE,
} from '../src/sim/spirit';
import { dist2d, type Entity } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

type AnyEntity = Entity & Record<string, any>;
type AnySim = Sim & Record<string, any>;

const makeSim = (cls: 'warrior' | 'rogue' | 'mage' = 'warrior', seed = 42): AnySim =>
  new Sim({ seed, playerClass: cls, autoEquip: true }) as AnySim;

// A Spirit Healer NPC within reach of a position (2D).
function healerInRange(
  sim: AnySim,
  pos: { x: number; z: number },
  range = SPIRIT_HEALER_RANGE,
): boolean {
  const r2 = range * range;
  for (const e of sim.entities.values() as IterableIterator<AnyEntity>) {
    if (e.kind !== 'npc' || e.templateId !== SPIRIT_HEALER_NPC_ID) continue;
    const dx = e.pos.x - pos.x;
    const dz = e.pos.z - pos.z;
    if (dx * dx + dz * dz <= r2) return true;
  }
  return false;
}

describe('spirit: world spawn', () => {
  it('spawns a Spirit Healer at every overworld graveyard', () => {
    const sim = makeSim();
    const healers = [...sim.entities.values()].filter(
      (e: AnyEntity) => e.kind === 'npc' && e.templateId === SPIRIT_HEALER_NPC_ID,
    );
    expect(healers.length).toBe(OVERWORLD_GRAVEYARDS.length);
    // each overworld graveyard has an angel standing on it
    for (const g of OVERWORLD_GRAVEYARDS) {
      expect(healerInRange(sim, g, 2)).toBe(true);
    }
  });
});

describe('spirit: release to ghost', () => {
  it('release leaves a corpse and rises as a ghost at a graveyard with an angel', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    const p = sim.player as AnyEntity;
    const deathPos = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
    p.hp = 1;
    p.dead = true;
    sim.releaseSpirit();

    // a ghost: still `dead`, but flagged a spirit, full (greyed) bar, out of combat
    expect(p.dead).toBe(true);
    expect(p.ghost).toBe(true);
    expect(p.hp).toBe(p.maxHp);
    expect(p.inCombat).toBe(false);
    // the body stays where it fell
    expect(p.corpsePos).toEqual(deathPos);
    // moved to a graveyard, where a Spirit Healer hovers
    expect(dist2d(p.pos, deathPos)).toBeGreaterThan(1);
    expect(healerInRange(sim, p.pos)).toBe(true);
  });

  it('a ghost runs faster and ignores slows', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    const p = sim.player as AnyEntity;
    p.dead = true;
    sim.releaseSpirit();
    expect(sim.moveSpeedMult(p)).toBe(GHOST_RUN_MULT);
    expect(GHOST_RUN_MULT).toBeGreaterThan(1);
  });

  it('release is a no-op for a player who is not dead, and for one already a ghost', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    const p = sim.player as AnyEntity;
    const posBefore = { ...p.pos };
    sim.releaseSpirit(); // alive -> nothing
    expect(p.ghost).toBe(false);
    expect(p.pos).toEqual(posBefore);

    p.dead = true;
    sim.releaseSpirit(); // -> ghost
    const ghostPos = { ...p.pos };
    sim.releaseSpirit(); // already a ghost -> nothing further
    expect(p.pos).toEqual(ghostPos);
  });
});

describe('spirit: resurrect at corpse', () => {
  it('resurrects penalty-free at the body when in range', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    const p = sim.player as AnyEntity;
    const fullStr = p.stats.str;
    p.dead = true;
    sim.releaseSpirit();
    const corpse = { ...(p.corpsePos as { x: number; y: number; z: number }) };
    // walk the ghost onto its corpse
    p.pos = { x: corpse.x, y: corpse.y, z: corpse.z };
    p.prevPos = { ...p.pos };
    sim.rebucket(p);
    sim.resurrectAtCorpse();

    expect(p.dead).toBe(false);
    expect(p.ghost).toBe(false);
    expect(p.corpsePos).toBeNull();
    expect(dist2d(p.pos, corpse)).toBeLessThan(2);
    expect(p.hp).toBe(Math.max(1, Math.round(p.maxHp * 0.5)));
    // no Resurrection Sickness on a corpse run
    expect(p.auras.some((a: any) => a.id === RESURRECTION_SICKNESS_ID)).toBe(false);
    expect(p.stats.str).toBe(fullStr);
  });

  it('revives where the ghost is standing, not teleported onto the corpse', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    const p = sim.player as AnyEntity;
    p.dead = true;
    sim.releaseSpirit();
    const corpse = { ...(p.corpsePos as { x: number; y: number; z: number }) };
    // stand the ghost away from the body but still within rez range
    const ghostSpot = { x: corpse.x + 20, y: corpse.y, z: corpse.z };
    p.pos = { ...ghostSpot };
    p.prevPos = { ...p.pos };
    sim.rebucket(p);
    expect(dist2d(p.pos, corpse)).toBeLessThan(CORPSE_REZ_RANGE);
    expect(dist2d(p.pos, corpse)).toBeGreaterThan(5);
    sim.resurrectAtCorpse();
    expect(p.dead).toBe(false);
    // revived at the ghost's spot, not on the corpse
    expect(Math.abs(p.pos.x - ghostSpot.x)).toBeLessThan(2);
    expect(dist2d(p.pos, corpse)).toBeGreaterThan(5);
  });

  it('does nothing when the ghost is too far from its corpse', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    const p = sim.player as AnyEntity;
    p.dead = true;
    sim.releaseSpirit();
    const corpse = p.corpsePos as { x: number; y: number; z: number };
    // walk the ghost well beyond rez range of its corpse
    p.pos = { x: corpse.x + CORPSE_REZ_RANGE + 50, y: corpse.y, z: corpse.z };
    p.prevPos = { ...p.pos };
    sim.rebucket(p);
    expect(dist2d(p.pos, corpse)).toBeGreaterThan(CORPSE_REZ_RANGE);
    sim.resurrectAtCorpse();
    expect(p.dead).toBe(true);
    expect(p.ghost).toBe(true);
  });
});

describe('spirit: resurrect at the Spirit Healer', () => {
  it('resurrects in place at reduced hp with Resurrection Sickness', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    const p = sim.player as AnyEntity;
    const fullStr = p.stats.str;
    p.dead = true;
    sim.releaseSpirit(); // ghost at a graveyard, an angel in reach
    expect(healerInRange(sim, p.pos)).toBe(true);
    expect(sim.resurrectAtSpiritHealer()).toBe(true);

    expect(p.dead).toBe(false);
    expect(p.ghost).toBe(false);
    expect(p.corpsePos).toBeNull();
    // returns at ~RES_HEALER_HP_FRACTION (the harsh option vs the penalty-free corpse run)
    expect(p.hp / p.maxHp).toBeCloseTo(RES_HEALER_HP_FRACTION, 1);
    const sickness = p.auras.find((a: any) => a.id === RESURRECTION_SICKNESS_ID);
    expect(sickness).toBeDefined();
    expect(sickness?.value).toBeLessThan(0); // a stat drain
    expect(p.stats.str).toBeLessThan(fullStr); // stats cut hard by the sickness
  });

  it('does not inflict Resurrection Sickness below level 10 (classic exemption)', () => {
    const sim = makeSim();
    sim.setPlayerLevel(5);
    const p = sim.player as AnyEntity;
    p.dead = true;
    sim.releaseSpirit();
    sim.resurrectAtSpiritHealer();
    expect(p.dead).toBe(false);
    expect(p.auras.some((a: any) => a.id === RESURRECTION_SICKNESS_ID)).toBe(false);
  });

  it('does nothing when no Spirit Healer is near the ghost', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    const p = sim.player as AnyEntity;
    p.dead = true;
    sim.releaseSpirit();
    // step the ghost far away from the graveyard angel
    p.pos = { x: p.pos.x + 200, y: p.pos.y, z: p.pos.z };
    p.prevPos = { ...p.pos };
    sim.rebucket(p);
    expect(healerInRange(sim, p.pos)).toBe(false);
    expect(sim.resurrectAtSpiritHealer()).toBe(false);
    expect(p.dead).toBe(true);
    expect(p.ghost).toBe(true);
  });
});

describe("spirit: The Keeper's Toll persistence", () => {
  it('survives a further death + release + corpse resurrect (not sheddable by dying)', () => {
    const sim = makeSim();
    sim.setPlayerLevel(12);
    const p = sim.player as AnyEntity;
    // take the Toll from a healer resurrection
    p.dead = true;
    sim.releaseSpirit();
    sim.resurrectAtSpiritHealer();
    expect(p.auras.some((a: any) => a.id === RESURRECTION_SICKNESS_ID)).toBe(true);
    // die again and take the penalty-free corpse run
    p.dead = true;
    sim.releaseSpirit();
    const corpse = { ...(p.corpsePos as { x: number; y: number; z: number }) };
    p.pos = { x: corpse.x, y: corpse.y, z: corpse.z };
    p.prevPos = { ...p.pos };
    sim.rebucket(p);
    sim.resurrectAtCorpse();
    // dying did not shed the Toll
    expect(p.auras.some((a: any) => a.id === RESURRECTION_SICKNESS_ID)).toBe(true);
  });

  it('survives a logout/login round-trip (cannot be shed by relogging)', () => {
    const sim = makeSim();
    sim.setPlayerLevel(12);
    const p = sim.player as AnyEntity;
    p.dead = true;
    sim.releaseSpirit();
    sim.resurrectAtSpiritHealer();
    const toll = p.auras.find((a: any) => a.id === RESURRECTION_SICKNESS_ID);
    expect(toll).toBeDefined();
    const remaining = toll?.remaining as number;
    const reducedMaxHp = p.maxHp;

    const state = sim.serializeCharacter(sim.player.id)!;
    expect(state.resSickness).toBe(remaining);

    // relog: a fresh Sim loads the saved character
    const sim2 = new Sim({ seed: 99, playerClass: 'warrior', noPlayer: true }) as AnySim;
    const pid2 = sim2.addPlayer('warrior', 'Toller', { state });
    const e2 = sim2.entities.get(pid2) as AnyEntity;
    const toll2 = e2.auras.find((a: any) => a.id === RESURRECTION_SICKNESS_ID);
    expect(toll2).toBeDefined();
    expect(toll2?.remaining).toBe(remaining);
    // maxHp still reduced by the restored Toll (not handed back at full)
    expect(e2.maxHp).toBe(reducedMaxHp);
  });
});

describe('spirit: dungeons', () => {
  it('a dungeon death rises as a ghost at an OUTDOOR graveyard, not inside the instance', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    const p = sim.player as AnyEntity;
    sim.enterDungeon('hollow_crypt');
    expect(p.pos.x).toBeGreaterThan(DUNGEON_X_THRESHOLD); // inside the instance
    // walk deeper into the instance, then die there
    p.pos = { x: p.pos.x, y: p.pos.y, z: p.pos.z + 30 };
    p.prevPos = { ...p.pos };
    sim.rebucket(p);
    p.dead = true;
    sim.releaseSpirit();
    expect(p.ghost).toBe(true);
    // the corpse stays inside the instance, but the ghost rises OUTSIDE at an overworld graveyard
    expect((p.corpsePos as { x: number }).x).toBeGreaterThan(DUNGEON_X_THRESHOLD);
    expect(p.pos.x).toBeLessThan(DUNGEON_X_THRESHOLD);
    // No Spirit Healer stands inside any instance: every angel is at an overworld
    // graveyard (there are exactly OVERWORLD_GRAVEYARDS of them, none past the threshold).
    const healers = [...sim.entities.values()].filter(
      (e: AnyEntity) => e.kind === 'npc' && e.templateId === SPIRIT_HEALER_NPC_ID,
    );
    expect(healers.length).toBe(OVERWORLD_GRAVEYARDS.length);
    expect(healers.every((h: AnyEntity) => h.pos.x < DUNGEON_X_THRESHOLD)).toBe(true);
  });

  it('a ghost that re-enters the instance resurrects at the entrance, penalty-free', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    const p = sim.player as AnyEntity;
    sim.enterDungeon('hollow_crypt');
    const entry = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
    // die deep inside and release to the outdoor graveyard
    p.pos = { x: p.pos.x, y: p.pos.y, z: p.pos.z + 30 };
    p.prevPos = { ...p.pos };
    sim.rebucket(p);
    p.dead = true;
    sim.releaseSpirit();
    expect(p.ghost).toBe(true);
    expect(p.pos.x).toBeLessThan(DUNGEON_X_THRESHOLD); // outside as a ghost
    // run the spirit back and re-enter: resurrects at the entry, no Resurrection Sickness
    sim.enterDungeon('hollow_crypt');
    expect(p.dead).toBe(false);
    expect(p.ghost).toBe(false);
    expect(p.corpsePos).toBeNull();
    expect(p.pos.x).toBeGreaterThan(DUNGEON_X_THRESHOLD); // back inside
    expect(dist2d(p.pos, entry)).toBeLessThan(3); // at the entrance
    expect(p.hp).toBe(Math.max(1, Math.round(p.maxHp * RES_HP_FRACTION))); // penalty-free half
    expect(p.auras.some((a: any) => a.id === RESURRECTION_SICKNESS_ID)).toBe(false);
  });
});

describe('spirit: delve respawn (unchanged bounded rules)', () => {
  it('first delve death respawns at 50% hp; a second fails the run', () => {
    const sim = makeSim('rogue', 99);
    const reliquary = DELVES.collapsed_reliquary;
    sim.setPlayerLevel(reliquary.minLevel);
    const p = sim.player as AnyEntity;
    p.pos = { x: reliquary.doorPos.x, y: 0, z: reliquary.doorPos.z };
    p.prevPos = { ...p.pos };
    sim.rebucket(p);
    sim.enterDelve('collapsed_reliquary', 'normal');
    const run = sim.delveRunForPlayer(sim.playerId) as any;
    expect(run, 'delve run started').toBeTruthy();
    run.modules = ['reliquary_finale'];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);

    p.dead = true;
    sim.releaseSpirit();
    expect(p.dead).toBe(false);
    expect(p.ghost).toBe(false); // delves have no ghost run
    expect(p.hp).toBe(Math.max(1, Math.round(p.maxHp * 0.5)));

    const e2 = sim.entities.get(sim.playerId) as AnyEntity;
    e2.dead = true;
    sim.releaseSpirit();
    const events = sim.tick();
    expect(events.some((ev: any) => ev.type === 'delveFailed')).toBe(true);
  });

  it('a delve respawn also clears a held movement key (#1651)', () => {
    const sim = makeSim('rogue', 99);
    const reliquary = DELVES.collapsed_reliquary;
    sim.setPlayerLevel(reliquary.minLevel);
    const p = sim.player as AnyEntity;
    p.pos = { x: reliquary.doorPos.x, y: 0, z: reliquary.doorPos.z };
    p.prevPos = { ...p.pos };
    sim.rebucket(p);
    sim.enterDelve('collapsed_reliquary', 'normal');
    const run = sim.delveRunForPlayer(sim.playerId) as any;
    run.modules = ['reliquary_finale'];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);

    sim.moveInput.strafeLeft = true;
    p.dead = true;
    sim.releaseSpirit();
    expect(p.dead).toBe(false);
    expect(sim.moveInput.strafeLeft).toBe(false);
  });

  it('a second delve death (run-failing eject to the door) also clears a held movement key', () => {
    const sim = makeSim('rogue', 99);
    const reliquary = DELVES.collapsed_reliquary;
    sim.setPlayerLevel(reliquary.minLevel);
    const p = sim.player as AnyEntity;
    p.pos = { x: reliquary.doorPos.x, y: 0, z: reliquary.doorPos.z };
    p.prevPos = { ...p.pos };
    sim.rebucket(p);
    sim.enterDelve('collapsed_reliquary', 'normal');
    const run = sim.delveRunForPlayer(sim.playerId) as any;
    run.modules = ['reliquary_finale'];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);

    p.dead = true;
    sim.releaseSpirit();
    expect(p.dead).toBe(false);

    const e2 = sim.entities.get(sim.playerId) as AnyEntity;
    sim.moveInput.back = true;
    e2.dead = true;
    sim.releaseSpirit();
    const events = sim.tick();
    expect(events.some((ev: any) => ev.type === 'delveFailed')).toBe(true);
    expect(sim.moveInput.back).toBe(false);
  });
});

describe('spirit: ghost movement (tick loop)', () => {
  it('a ghost runs on tick and stays a dead, unharmed spirit', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    const p = sim.player as AnyEntity;
    p.dead = true;
    sim.releaseSpirit();
    expect(p.ghost).toBe(true);
    // place the spirit on open ground and run it forward (facing 0 = +z)
    p.pos = { x: 0, y: terrainHeight(0, -120, sim.cfg.seed), z: -120 };
    p.prevPos = { ...p.pos };
    p.facing = 0;
    sim.rebucket(p);
    const startZ = p.pos.z;
    sim.moveInput.forward = true;
    for (let i = 0; i < 20; i++) sim.tick(); // 1s of running
    sim.moveInput.forward = false;
    // the ghost-tick branch actually moved the spirit forward
    expect(p.pos.z).toBeGreaterThan(startZ);
    // never resurrected or damaged by running
    expect(p.dead).toBe(true);
    expect(p.ghost).toBe(true);
    expect(p.hp).toBe(p.maxHp);
  });
});

describe('spirit: stale movement intent does not survive death (#1651)', () => {
  it('releasing the spirit clears a held movement key, so the ghost does not walk on its own', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    const p = sim.player as AnyEntity;
    // the player was holding "back" the instant they died
    sim.moveInput.back = true;
    p.dead = true;
    sim.releaseSpirit();
    expect(sim.moveInput).toEqual({
      forward: false,
      back: false,
      turnLeft: false,
      turnRight: false,
      strafeLeft: false,
      strafeRight: false,
      jump: false,
    });
    // ticking with the stale input gone, the ghost stays put
    const posAfterRelease = { ...p.pos };
    sim.tick();
    expect(dist2d(p.pos, posAfterRelease)).toBeLessThan(0.01);
  });

  it('resurrecting at the corpse clears a held movement key, so the revived body does not walk on its own', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    const p = sim.player as AnyEntity;
    p.dead = true;
    sim.releaseSpirit();
    const corpse = { ...(p.corpsePos as { x: number; y: number; z: number }) };
    p.pos = { x: corpse.x, y: corpse.y, z: corpse.z };
    p.prevPos = { ...p.pos };
    sim.rebucket(p);
    // a key held while running the ghost back must not survive into the revived body
    sim.moveInput.back = true;
    sim.resurrectAtCorpse();
    expect(p.dead).toBe(false);
    expect(sim.moveInput.back).toBe(false);
    const posAfterRevive = { ...p.pos };
    sim.tick();
    expect(dist2d(p.pos, posAfterRevive)).toBeLessThan(0.01);
  });

  it('resurrecting at the Spirit Healer also clears a held movement key', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    const p = sim.player as AnyEntity;
    p.dead = true;
    sim.releaseSpirit();
    sim.moveInput.forward = true;
    sim.resurrectAtSpiritHealer();
    expect(p.dead).toBe(false);
    expect(sim.moveInput.forward).toBe(false);
  });
});

describe('spirit: determinism', () => {
  it('same seed + same death -> identical ghost outcome', () => {
    const outcome = () => {
      const sim = makeSim('warrior', 7);
      sim.setPlayerLevel(10);
      const p = sim.player as AnyEntity;
      p.dead = true;
      sim.releaseSpirit();
      return {
        dead: p.dead,
        ghost: p.ghost,
        hp: p.hp,
        pos: { ...p.pos },
        corpse: { ...p.corpsePos },
      };
    };
    expect(outcome()).toEqual(outcome());
  });
});
