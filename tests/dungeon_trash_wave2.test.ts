// The dungeon trash pass's second wave: the five mechanics that waited on the
// trash engine's line-of-sight rule (G6, kit_nova.ts) and its walker (G5,
// kit_walker.ts). Each is driven through tickTrashKits inside a real claimed
// dungeon: its trigger, every answer (a kick, a stun, a wall, a body), normal
// against heroic, and its landed numbers against the math its content states.
//
//   Gravecaller Adept   Gravespark Volley   (hollow_crypt_trash.ts, nova)
//   Bastion Revenant    Throatlight          (dungeons.ts, walker launch 'death')
//   Drowned Sergeant    Loose on My Mark     (sunken_bastion.ts, bastion_order.ts)
//   Moonlit Siren       Call of the Shallows (drowned_temple.ts, temple_lure.ts)
//   Moonmantle Ray      Heartpearl           (temple.ts, temple_pearl.ts, heroic)

import { describe, expect, it } from 'vitest';
import { HEROIC_DUNGEON_TUNING } from '../src/sim/content/dungeon_difficulty';
import { DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { applyDungeonMobTuning } from '../src/sim/instances/difficulty';
import { claimedInstanceAt } from '../src/sim/instances/dungeons';
import { SCRIPTED_INTERRUPTIBLE_CHANNELS } from '../src/sim/mob/healer_channel';
import { tickTrashKits } from '../src/sim/mob/trash_kit';
import {
  BASTION_DROWNED_SURGE,
  BASTION_LOOSE_ON_MY_MARK,
  BASTION_MARKED_BOLT,
  BASTION_MARKED_BOLT_BLOCKED,
  BASTION_THROATLIGHT_ORB,
} from '../src/sim/mob/trash_kit/bastion_cast_ids';
import { CRYPT_GRAVE_BOLT, CRYPT_GRAVESPARK_VOLLEY } from '../src/sim/mob/trash_kit/cast_ids';
import { spawnCombatWall } from '../src/sim/mob/trash_kit/combat_walls';
import {
  launchWalker,
  WALKER_FADE,
  walkerDefFor,
  walkerLaunchPoint,
} from '../src/sim/mob/trash_kit/kit_walker';
import { SANCTUM_ICE_SLAB } from '../src/sim/mob/trash_kit/sanctum_cast_ids';
import {
  TEMPLE_CALL_OF_THE_SHALLOWS,
  TEMPLE_HEARTPEARL_ORB,
  TEMPLE_HEARTPEARL_WARD,
  TEMPLE_NACRE_MANTLE,
  TEMPLE_SHALLOWS_BROKEN,
  TEMPLE_SHALLOWS_DRAW,
  TEMPLE_SONG_STRUCK,
} from '../src/sim/mob/trash_kit/temple_cast_ids';
import { TEMPLE_CARAPACE_AURA } from '../src/sim/mob/trash_kit/temple_kit';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { DT, dist2d, type Entity, type SimEvent } from '../src/sim/types';

type DungeonKey = 'hollow_crypt' | 'sunken_bastion' | 'drowned_temple';

const BENCH: Record<DungeonKey, { dev: string; dx: number; dz: number }> = {
  hollow_crypt: { dev: 'crypt', dx: 20, dz: -10 },
  sunken_bastion: { dev: 'bastion', dx: -10, dz: -200 },
  drowned_temple: { dev: 'temple', dx: 0, dz: -12 },
};

interface Room {
  sim: Sim;
  inst: InstanceSlot;
  me: Entity;
  dungeon: DungeonKey;
  events: SimEvent[];
}

function room(dungeon: DungeonKey, difficulty: 'normal' | 'heroic' = 'normal', seed = 97): Room {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.chat(`/dev ${BENCH[dungeon].dev} enter ${difficulty}`, sim.player.id);
  const inst = claimedInstanceAt(sim.ctx, sim.player.pos);
  if (!inst) throw new Error(`no ${dungeon} claim`);
  const me = sim.player;
  me.maxHp = 1e6;
  me.hp = 1e6;
  const o = instanceOrigin(DUNGEONS[dungeon].index, inst.slot);
  me.pos = sim.ctx.groundPos(o.x + BENCH[dungeon].dx, o.z + BENCH[dungeon].dz);
  me.prevPos = { ...me.pos };
  sim.drainEvents();
  return { sim, inst, me, dungeon, events: [] };
}

function engage(r: Room, templateId: string, dx: number, dz: number, packId?: string): Entity {
  const t = MOBS[templateId];
  const mob = createMob(r.sim.ctx.nextId++, t, t.minLevel, {
    ...r.sim.ctx.groundPos(r.me.pos.x + dx, r.me.pos.z + dz),
  });
  applyDungeonMobTuning(mob, r.dungeon, r.inst.difficulty);
  if (packId) mob.dungeonPackId = packId;
  r.sim.ctx.addEntity(mob);
  r.inst.mobIds.push(mob.id);
  mob.inCombat = true;
  mob.aiState = 'attack';
  mob.aggroTargetId = r.me.id;
  mob.facing = Math.atan2(r.me.pos.x - mob.pos.x, r.me.pos.z - mob.pos.z);
  return mob;
}

function addPlayer(r: Room, cls: 'mage' | 'priest', dx: number, dz: number): Entity {
  const pid = r.sim.addPlayer(cls, `W${cls}${dx}_${dz}`.replace(/[-.]/g, 'm'));
  const e = r.sim.ctx.entities.get(pid) as Entity;
  e.pos = r.sim.ctx.groundPos(r.me.pos.x + dx, r.me.pos.z + dz);
  e.prevPos = { ...e.pos };
  e.maxHp = 1e6;
  e.hp = 1e6;
  return e;
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

/** Run until `mob` starts `castId` (or fail after `limit` seconds). */
function runUntilCast(r: Room, mob: Entity, castId: string, mobs: Entity[], limit = 40): void {
  for (let t = 0; t < limit; t += DT) {
    run(r, DT, mobs);
    if (mob.castingAbility === castId) return;
  }
  throw new Error(`${mob.templateId} never cast ${castId}`);
}

function dealt(r: Room, targetId: number, ability: string): number[] {
  return r.events
    .filter(
      (e): e is Extract<SimEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.targetId === targetId && e.ability === ability,
    )
    .map((e) => e.amount);
}

function objects(r: Room, templateId: string): Entity[] {
  return r.inst.objectIds
    .map((id) => r.sim.ctx.entities.get(id))
    .filter((e): e is Entity => !!e && e.templateId === templateId);
}

function wall(r: Room, dx: number, dz: number, facing = 0): Entity {
  const w = spawnCombatWall(
    r.sim.ctx,
    r.inst,
    SANCTUM_ICE_SLAB,
    'Ice Slab',
    r.me.pos.x + dx,
    r.me.pos.z + dz,
    facing,
    60,
  );
  if (!w) throw new Error('no wall');
  tickTrashKits(r.sim.ctx);
  return w;
}

function aura(e: Entity, id: string) {
  return e.auras.find((a) => a.id === id);
}

// ---------------------------------------------------------------- the adept

describe('Gravecaller Adept: Gravespark Volley (G6 nova)', () => {
  const kit = MOBS.crypt_gravecaller_adept.trashKit;
  const nova = kit?.nova;

  it('is a kickable shadow volley; the Grave Bolt is heroic only', () => {
    expect(nova?.castId).toBe(CRYPT_GRAVESPARK_VOLLEY);
    expect(nova?.name).toBe('Gravespark Volley');
    expect(nova?.castTime).toBe(3);
    expect(nova?.radius).toBe(30);
    expect([nova?.min, nova?.max]).toEqual([12, 16]);
    expect(nova?.unstoppableCastId).toBeUndefined();
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[CRYPT_GRAVESPARK_VOLLEY]?.school).toBe('shadow');
    expect(kit?.bolt?.heroicOnly).toBe(true);
  });

  it('normal: only the volley, striking everyone who can see it, never behind a wall', () => {
    const r = room('hollow_crypt');
    const adept = engage(r, 'crypt_gravecaller_adept', 0, 12);
    wall(r, 0, 6);
    expect(r.sim.ctx.hasLineOfSight(adept, r.me)).toBe(false);
    // The cloister's own pillars stand round the bench: seat the second
    // player on the first spot the adept can see past the slab.
    const seen = addPlayer(r, 'mage', 8, 0);
    const spots = [
      [8, 0],
      [-8, 0],
      [6, 3],
      [-6, 3],
      [9, 6],
      [-9, 6],
      [5, -4],
      [-5, -4],
    ];
    const clear = spots.find(([dx, dz]) => {
      seen.pos = r.sim.ctx.groundPos(r.me.pos.x + dx, r.me.pos.z + dz);
      seen.prevPos = { ...seen.pos };
      return r.sim.ctx.hasLineOfSight(adept, seen);
    });
    expect(clear).toBeDefined();
    runUntilCast(r, adept, CRYPT_GRAVESPARK_VOLLEY, [adept]);
    run(r, nova!.castTime + DT, [adept]);
    const hits = dealt(r, seen.id, 'Gravespark Volley');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toBeGreaterThanOrEqual(12);
    expect(hits[0]).toBeLessThanOrEqual(16);
    expect(dealt(r, r.me.id, 'Gravespark Volley')).toEqual([]);
    // A long normal pull never starts a Grave Bolt.
    run(r, 40, [adept]);
    const casts = r.events.filter(
      (e) => e.type === 'spellfx' && e.sourceId === adept.id && e.ability === CRYPT_GRAVE_BOLT,
    );
    expect(casts).toEqual([]);
    expect(dealt(r, r.me.id, 'Grave Bolt')).toEqual([]);
    expect(dealt(r, seen.id, 'Grave Bolt')).toEqual([]);
  });

  it('a kick spares everyone', () => {
    const r = room('hollow_crypt');
    const adept = engage(r, 'crypt_gravecaller_adept', 0, 12);
    const seen = addPlayer(r, 'mage', 8, 0);
    runUntilCast(r, adept, CRYPT_GRAVESPARK_VOLLEY, [adept]);
    r.sim.ctx.cancelCast(adept);
    run(r, nova!.castTime + DT, [adept]);
    expect(dealt(r, seen.id, 'Gravespark Volley')).toEqual([]);
    expect(dealt(r, r.me.id, 'Gravespark Volley')).toEqual([]);
  });

  it('heroic: both casts, the volley on the adept x24 (288 to 384)', () => {
    const r = room('hollow_crypt', 'heroic');
    const adept = engage(r, 'crypt_gravecaller_adept', 0, 12);
    expect(adept.mechanicDamageMult).toBe(24);
    const seen = addPlayer(r, 'mage', 8, 0);
    run(r, 40, [adept]);
    const volley = dealt(r, seen.id, 'Gravespark Volley').concat(
      dealt(r, r.me.id, 'Gravespark Volley'),
    );
    expect(volley.length).toBeGreaterThan(0);
    for (const v of volley) {
      expect(v).toBeGreaterThanOrEqual(288);
      expect(v).toBeLessThanOrEqual(384);
    }
    const bolts = dealt(r, seen.id, 'Grave Bolt').concat(dealt(r, r.me.id, 'Grave Bolt'));
    expect(bolts.length).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------- the revenant

describe('Bastion Revenant: Throatlight (G5 walker on death)', () => {
  const def = MOBS.bastion_revenant.trashKit?.walker;

  it('is a death walker: heal only on normal, heal and a surge on heroic', () => {
    expect(def?.launch).toBe('death');
    expect(def?.objectTemplate).toBe(BASTION_THROATLIGHT_ORB);
    expect(def?.empower.healPct).toBe(0.15);
    expect(def?.empower.damagePct).toBe(0);
    expect(def?.empower.heroicDamagePct).toBe(0.2);
    expect(walkerDefFor(def!, false).empower.damagePct).toBe(0);
    expect(walkerDefFor(def!, true).empower.damagePct).toBe(0.2);
  });

  function pair(r: Room) {
    const dying = engage(r, 'bastion_revenant', 8, 0);
    const mate = engage(r, 'bastion_revenant', 8, 8);
    mate.hp = Math.round(mate.maxHp * 0.5);
    return { dying, mate };
  }

  it('normal: the orb drifts to the nearest packmate and heals it, no surge', () => {
    const r = room('sunken_bastion');
    const { dying, mate } = pair(r);
    run(r, DT, [dying, mate]);
    r.sim.ctx.handleDeath(dying, r.me);
    run(r, DT, [mate]);
    expect(objects(r, BASTION_THROATLIGHT_ORB)).toHaveLength(1);
    const before = mate.hp;
    run(r, 4, [mate]);
    expect(objects(r, BASTION_THROATLIGHT_ORB)).toHaveLength(0);
    expect(mate.hp - before).toBe(Math.round(mate.maxHp * 0.15));
    expect(aura(mate, BASTION_DROWNED_SURGE)).toBeUndefined();
  });

  it('heroic: the packmate is healed AND surges 20 percent for 12 s', () => {
    const r = room('sunken_bastion', 'heroic');
    const { dying, mate } = pair(r);
    run(r, DT, [dying, mate]);
    r.sim.ctx.handleDeath(dying, r.me);
    const before = mate.hp;
    run(r, 4, [mate]);
    // Healed on heroic too, the same 15 percent.
    expect(mate.hp - before).toBe(Math.round(mate.maxHp * 0.15));
    const surge = aura(mate, BASTION_DROWNED_SURGE);
    expect(surge?.kind).toBe('buff_dmg_done');
    expect(surge?.value).toBe(0.2);
    expect(surge?.duration).toBe(12);
  });

  it('a body in its path swallows it: a little damage, no heal (normal 10 to 14, heroic x18)', () => {
    for (const diff of ['normal', 'heroic'] as const) {
      const r = room('sunken_bastion', diff);
      const { dying, mate } = pair(r);
      const block = addPlayer(r, 'mage', 8, 4);
      run(r, DT, [dying, mate]);
      r.sim.ctx.handleDeath(dying, r.me);
      const before = mate.hp;
      run(r, 4, [mate]);
      expect(objects(r, BASTION_THROATLIGHT_ORB)).toHaveLength(0);
      expect(mate.hp).toBe(before);
      const took = dealt(r, block.id, 'Throatlight');
      expect(took).toHaveLength(1);
      const [lo, hi] = diff === 'normal' ? [10, 14] : [180, 252];
      expect(took[0]).toBeGreaterThanOrEqual(lo);
      expect(took[0]).toBeLessThanOrEqual(hi);
    }
  });

  it('the last of its pack sends nothing', () => {
    const r = room('sunken_bastion');
    const lone = engage(r, 'bastion_revenant', 8, 0);
    run(r, DT, [lone]);
    r.sim.ctx.handleDeath(lone, r.me);
    run(r, DT, []);
    expect(objects(r, BASTION_THROATLIGHT_ORB)).toHaveLength(0);
    // Not launched and faded the same tick: never launched at all.
    expect(r.events.some((e) => e.type === 'spellfxAt' && e.ability === WALKER_FADE)).toBe(false);
    const def = MOBS.bastion_revenant.trashKit?.walker;
    if (!def) throw new Error('walker');
    expect(launchWalker(r.sim.ctx, r.inst, lone, def)).toBeNull();
  });
});

// ------------------------------------------------------------- the sergeant

describe('Drowned Sergeant: Loose on My Mark (G6 + the pack arbalests)', () => {
  const def = MOBS.drowned_sergeant.trashKit?.bastion?.order;

  it('is a kickable shout that sends the pack arbalests', () => {
    expect(def?.castId).toBe(BASTION_LOOSE_ON_MY_MARK);
    expect(def?.castTime).toBe(2);
    expect(def?.shooters).toBe('fogbound_arbalest');
    expect([def?.min, def?.max]).toEqual([24, 30]);
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[BASTION_LOOSE_ON_MY_MARK]?.school).toBe('nature');
  });

  function tower(r: Room) {
    const sergeant = engage(r, 'drowned_sergeant', 0, 6, 'tw');
    const arbs = [
      engage(r, 'fogbound_arbalest', -10, 14, 'tw'),
      engage(r, 'fogbound_arbalest', 0, 16, 'tw'),
      engage(r, 'fogbound_arbalest', 10, 14, 'tw'),
    ];
    const mark = addPlayer(r, 'mage', 0, -6);
    return { sergeant, arbs, mark, all: [sergeant, ...arbs] };
  }

  it('marks a player past the tank; when it lands every arbalest looses at once', () => {
    const r = room('sunken_bastion');
    const { sergeant, mark, all } = tower(r);
    runUntilCast(r, sergeant, BASTION_LOOSE_ON_MY_MARK, all);
    expect(sergeant.castTargetId).toBe(mark.id);
    run(r, def!.castTime + DT, all);
    const bolts = dealt(r, mark.id, 'Rusted Bolt');
    expect(bolts).toHaveLength(3);
    for (const b of bolts) {
      expect(b).toBeGreaterThanOrEqual(24);
      expect(b).toBeLessThanOrEqual(30);
    }
    const sum = bolts.reduce((a, b) => a + b, 0);
    expect(sum).toBeLessThanOrEqual(90);
    expect(dealt(r, r.me.id, 'Rusted Bolt')).toEqual([]);
  });

  it('a wall stops the bolts it stands in front of', () => {
    const r = room('sunken_bastion');
    const { sergeant, arbs, mark, all } = tower(r);
    // A slab right in front of the mark, across the middle arbalest's line.
    wall(r, 0, -3);
    expect(r.sim.ctx.hasLineOfSight(arbs[1], mark)).toBe(false);
    runUntilCast(r, sergeant, BASTION_LOOSE_ON_MY_MARK, all);
    run(r, def!.castTime + DT, all);
    const blocked = r.events.filter(
      (e) => e.type === 'spellfx' && e.ability === BASTION_MARKED_BOLT_BLOCKED,
    );
    const struck = r.events.filter(
      (e) => e.type === 'spellfx' && e.ability === BASTION_MARKED_BOLT,
    );
    const clear = arbs.filter((a) => r.sim.ctx.hasLineOfSight(a, mark)).length;
    expect(struck).toHaveLength(clear);
    expect(blocked).toHaveLength(3 - clear);
    expect(dealt(r, mark.id, 'Rusted Bolt')).toHaveLength(clear);
  });

  it('a kick spares the mark', () => {
    const r = room('sunken_bastion');
    const { sergeant, mark, all } = tower(r);
    runUntilCast(r, sergeant, BASTION_LOOSE_ON_MY_MARK, all);
    r.sim.ctx.cancelCast(sergeant);
    run(r, def!.castTime + DT, all);
    expect(dealt(r, mark.id, 'Rusted Bolt')).toEqual([]);
  });

  it('a sergeant with no arbalests in its pack never shouts', () => {
    const r = room('sunken_bastion');
    const sergeant = engage(r, 'drowned_sergeant', 0, 6, 'alone');
    engage(r, 'fogbound_arbalest', 0, 16, 'other');
    addPlayer(r, 'mage', 0, -6);
    let shouted = false;
    for (let t = 0; t < 30; t += DT) {
      run(r, DT, [sergeant]);
      if (sergeant.castingAbility === BASTION_LOOSE_ON_MY_MARK) shouted = true;
    }
    expect(shouted).toBe(false);
    expect(sergeant.trashKit?.casts ?? 0).toBe(0);
    const bolts = r.events.filter((e) => e.type === 'spellfx' && e.ability === BASTION_MARKED_BOLT);
    expect(bolts).toEqual([]);
  });

  it('heroic: each bolt rides the ARBALEST x8 (192 to 240), three never a one-shot', () => {
    const r = room('sunken_bastion', 'heroic');
    const { sergeant, arbs, mark, all } = tower(r);
    expect(arbs[0].mechanicDamageMult).toBe(8);
    runUntilCast(r, sergeant, BASTION_LOOSE_ON_MY_MARK, all);
    run(r, def!.castTime + DT, all);
    const bolts = dealt(r, mark.id, 'Rusted Bolt');
    expect(bolts).toHaveLength(3);
    for (const b of bolts) {
      expect(b).toBeGreaterThanOrEqual(192);
      expect(b).toBeLessThanOrEqual(240);
    }
    // Under 60 percent of a ~1,250 heroic cloth wearer at worst.
    expect(bolts.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(720);
  });
});

// ---------------------------------------------------------------- the siren

describe('Moonlit Siren: Call of the Shallows (G6 sight break + the drag)', () => {
  const def = MOBS.moonlit_siren.trashKit?.temple?.lure;

  it('is a kickable arcane song, never the frost of Call the Tide', () => {
    expect(def?.castId).toBe(TEMPLE_CALL_OF_THE_SHALLOWS);
    expect(def?.castTime).toBe(3);
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[TEMPLE_CALL_OF_THE_SHALLOWS]?.school).toBe('arcane');
    expect(MOBS.moonlit_siren.trashKit?.call?.school).toBe('frost');
  });

  it('draws the victim in at 2 yd/s with half their own speed, then stuns 1.5 s', () => {
    const r = room('drowned_temple');
    const siren = engage(r, 'moonlit_siren', 0, 8);
    const victim = addPlayer(r, 'mage', 10, 0);
    runUntilCast(r, siren, TEMPLE_CALL_OF_THE_SHALLOWS, [siren]);
    expect(siren.castTargetId).toBe(victim.id);
    const start = dist2d(victim.pos, siren.pos);
    run(r, 1, [siren]);
    expect(aura(victim, TEMPLE_SHALLOWS_DRAW)?.kind).toBe('slow');
    expect(aura(victim, TEMPLE_SHALLOWS_DRAW)?.value).toBe(0.5);
    run(r, def!.castTime, [siren]);
    const moved = start - dist2d(victim.pos, siren.pos);
    expect(moved).toBeGreaterThan(5);
    expect(moved).toBeLessThanOrEqual(6.2);
    const stun = aura(victim, TEMPLE_SONG_STRUCK);
    expect(stun?.kind).toBe('stun');
    expect(stun?.duration).toBe(1.5);
  });

  it('drawn all the way to her, the song lands at once', () => {
    const r = room('drowned_temple');
    const siren = engage(r, 'moonlit_siren', 0, 8);
    const victim = addPlayer(r, 'mage', 0, 2.5);
    runUntilCast(r, siren, TEMPLE_CALL_OF_THE_SHALLOWS, [siren]);
    run(r, 2, [siren]);
    expect(aura(victim, TEMPLE_SONG_STRUCK)).toBeDefined();
    expect(siren.castingAbility).not.toBe(TEMPLE_CALL_OF_THE_SHALLOWS);
    expect(dist2d(victim.pos, siren.pos)).toBeLessThanOrEqual(def!.reach + 0.1);
  });

  it('out of her sight the song breaks: no stun, no more drag', () => {
    const r = room('drowned_temple');
    const siren = engage(r, 'moonlit_siren', 0, 8);
    const victim = addPlayer(r, 'mage', 10, 0);
    runUntilCast(r, siren, TEMPLE_CALL_OF_THE_SHALLOWS, [siren]);
    run(r, 0.5, [siren]);
    // A slab drops between them (the victim steps behind a column).
    const mid = { x: (siren.pos.x + victim.pos.x) / 2, z: (siren.pos.z + victim.pos.z) / 2 };
    const facing = Math.atan2(victim.pos.x - siren.pos.x, victim.pos.z - siren.pos.z);
    wall(r, mid.x - r.me.pos.x, mid.z - r.me.pos.z, facing);
    expect(r.sim.ctx.hasLineOfSight(siren, victim)).toBe(false);
    run(r, DT * 2, [siren]);
    expect(siren.castingAbility).not.toBe(TEMPLE_CALL_OF_THE_SHALLOWS);
    expect(r.events.some((e) => e.type === 'spellfx' && e.ability === TEMPLE_SHALLOWS_BROKEN)).toBe(
      true,
    );
    const at = { ...victim.pos };
    run(r, def!.castTime, [siren]);
    expect(aura(victim, TEMPLE_SONG_STRUCK)).toBeUndefined();
    expect(dist2d(victim.pos, at)).toBeLessThan(1e-6);
  });

  it('a kick or a stun on her frees the victim', () => {
    for (const answer of ['kick', 'stun'] as const) {
      const r = room('drowned_temple');
      const siren = engage(r, 'moonlit_siren', 0, 8);
      const victim = addPlayer(r, 'mage', 10, 0);
      runUntilCast(r, siren, TEMPLE_CALL_OF_THE_SHALLOWS, [siren]);
      if (answer === 'kick') r.sim.ctx.cancelCast(siren);
      else
        r.sim.ctx.applyAura(siren, {
          id: 'test_stun',
          name: 'Stun',
          kind: 'stun',
          remaining: 5,
          duration: 5,
          value: 0,
          sourceId: r.me.id,
          school: 'physical',
        });
      run(r, DT, [siren]);
      // Let go at once: no draw left on the victim.
      expect(aura(victim, TEMPLE_SHALLOWS_DRAW)).toBeUndefined();
      run(r, def!.castTime + DT, [siren]);
      expect(aura(victim, TEMPLE_SONG_STRUCK)).toBeUndefined();
    }
  });

  it('heroic: a harder draw (2.5 yd/s) and a 2 s stun', () => {
    const r = room('drowned_temple', 'heroic');
    const siren = engage(r, 'moonlit_siren', 0, 8);
    const victim = addPlayer(r, 'mage', 12, 0);
    runUntilCast(r, siren, TEMPLE_CALL_OF_THE_SHALLOWS, [siren]);
    const start = dist2d(victim.pos, siren.pos);
    run(r, def!.castTime + DT, [siren]);
    expect(start - dist2d(victim.pos, siren.pos)).toBeGreaterThan(6.5);
    expect(aura(victim, TEMPLE_SONG_STRUCK)?.duration).toBe(2);
  });
});

// ------------------------------------------------------------------ the ray

describe('Moonmantle Ray: Heartpearl (G5 walker when the cocoon breaks, heroic)', () => {
  const kit = MOBS.pearlguard_sentinel.trashKit;

  it('no shipped walker both arms and shields its ally (one aura id carries one)', () => {
    for (const t of Object.values(MOBS)) {
      const e = t.trashKit?.walker?.empower;
      if (!e || (e.shieldPct ?? 0) <= 0) continue;
      expect(e.damagePct, t.id).toBe(0);
      expect(e.heroicDamagePct ?? 0, t.id).toBe(0);
    }
  });

  it('is an event walker that rolls to a ray or a templeguard, lingers, and gifts the group', () => {
    expect(kit?.temple?.pearl?.heroicOnly).toBe(true);
    expect(kit?.walker?.launch).toBe('event');
    expect(kit?.walker?.allies).toEqual(['pearlguard_sentinel', 'drowned_templeguard']);
    expect(kit?.walker?.lingers).toBe(true);
    expect(kit?.walker?.eject).toBe(4);
    expect(kit?.walker?.intercept.groupShield?.radius).toBe(40);
    expect(kit?.walker?.empower.shieldPct).toBe(0.15);
    expect(kit?.walker?.intercept.max).toBe(0);
    expect(kit?.walker?.intercept.groupShield?.pctMaxHp).toBe(0.1);
  });

  /** Drop the ray under its cocoon line, then burst the cocoon. */
  function breakCocoon(r: Room, ray: Entity, mobs: Entity[]): void {
    ray.hp = Math.floor(ray.maxHp * 0.29);
    run(r, DT, mobs);
    const ward = aura(ray, TEMPLE_CARAPACE_AURA);
    expect(ward?.kind).toBe('absorb');
    r.sim.ctx.dealDamage(r.me, ray, (ward?.value ?? 0) + 5, false, 'physical', 'Test', 'hit', true);
    expect(aura(ray, TEMPLE_CARAPACE_AURA)).toBeUndefined();
  }

  it('heroic: a broken cocoon rolls the pearl out behind the ray, to its templeguard', () => {
    const r = room('drowned_temple', 'heroic');
    const ray = engage(r, 'pearlguard_sentinel', 0, 4);
    const guard = engage(r, 'drowned_templeguard', 10, 10);
    const mobs = [ray, guard];
    run(r, DT, mobs);
    breakCocoon(r, ray, mobs);
    run(r, DT, mobs);
    const pearls = objects(r, TEMPLE_HEARTPEARL_ORB);
    expect(pearls).toHaveLength(1);
    // Ejected 4 yd behind the ray, away from the one it fights (me).
    const expected = walkerLaunchPoint(r.sim.ctx, ray, kit!.walker!);
    expect(dist2d(pearls[0].pos, { x: expected.x, y: 0, z: expected.z })).toBeLessThan(0.3);
    expect(dist2d(pearls[0].pos, r.me.pos)).toBeGreaterThan(dist2d(ray.pos, r.me.pos));
    expect(dist2d(pearls[0].pos, ray.pos)).toBeCloseTo(4, 1);
    run(r, 8, mobs);
    const ward = aura(guard, TEMPLE_HEARTPEARL_WARD);
    expect(ward?.kind).toBe('absorb');
    expect(ward?.value).toBe(Math.round(guard.maxHp * 0.15));
    expect(objects(r, TEMPLE_HEARTPEARL_ORB)).toHaveLength(0);
  });

  it('a player who steps on it first takes it: the group gains the Nacre Mantle', () => {
    const r = room('drowned_temple', 'heroic');
    const ray = engage(r, 'pearlguard_sentinel', 0, 4);
    const guard = engage(r, 'drowned_templeguard', 10, 10);
    const mobs = [ray, guard];
    const healer = addPlayer(r, 'priest', -12, 0);
    // Out of the taker's 40 yd: no mantle for them.
    const far = addPlayer(r, 'mage', -60, 0);
    run(r, DT, mobs);
    breakCocoon(r, ray, mobs);
    // Stand the runner on the spot the pearl drops.
    const drop = walkerLaunchPoint(r.sim.ctx, ray, kit!.walker!);
    const runner = addPlayer(r, 'mage', drop.x - r.me.pos.x, drop.z - r.me.pos.z);
    run(r, 1, mobs);
    expect(objects(r, TEMPLE_HEARTPEARL_ORB)).toHaveLength(0);
    expect(aura(guard, TEMPLE_HEARTPEARL_WARD)).toBeUndefined();
    for (const p of [runner, healer, r.me]) {
      const mantle = aura(p, TEMPLE_NACRE_MANTLE);
      expect(mantle?.kind).toBe('absorb');
      // 10 percent of the 1,000,000 test pool each was given.
      expect(mantle?.value).toBe(100000);
    }
    expect(dealt(r, runner.id, 'Heartpearl')).toEqual([]);
    expect(aura(far, TEMPLE_NACRE_MANTLE)).toBeUndefined();
  });

  it('it rolls only to a ray or a templeguard, never to a nearer siren', () => {
    const r = room('drowned_temple', 'heroic');
    const ray = engage(r, 'pearlguard_sentinel', 0, 4);
    const siren = engage(r, 'moonlit_siren', -4, 9);
    const mate = engage(r, 'pearlguard_sentinel', 12, 12);
    const mobs = [ray, siren, mate];
    run(r, DT, mobs);
    breakCocoon(r, ray, mobs);
    run(r, 10, mobs);
    expect(aura(siren, TEMPLE_HEARTPEARL_WARD)).toBeUndefined();
    expect(aura(mate, TEMPLE_HEARTPEARL_WARD)?.kind).toBe('absorb');
  });

  it('alone in its pack the pearl lies for the taking, then fades', () => {
    const r = room('drowned_temple', 'heroic');
    const ray = engage(r, 'pearlguard_sentinel', 0, 4);
    run(r, DT, [ray]);
    breakCocoon(r, ray, [ray]);
    run(r, 3, [ray]);
    const pearls = objects(r, TEMPLE_HEARTPEARL_ORB);
    expect(pearls).toHaveLength(1);
    const at = { ...pearls[0].pos };
    run(r, 1, [ray]);
    expect(dist2d(pearls[0].pos, at)).toBeLessThan(1e-6);
    run(r, 3, [ray]);
    expect(objects(r, TEMPLE_HEARTPEARL_ORB)).toHaveLength(0);
  });

  it('a cocoon that runs out drops nothing, and normal never drops one', () => {
    {
      const r = room('drowned_temple', 'heroic');
      const ray = engage(r, 'pearlguard_sentinel', 0, 4);
      const guard = engage(r, 'drowned_templeguard', 10, 10);
      ray.hp = Math.floor(ray.maxHp * 0.29);
      run(r, DT, [ray, guard]);
      const ward = aura(ray, TEMPLE_CARAPACE_AURA);
      expect(ward).toBeDefined();
      // Its clock runs down (the aura tick), and it lapses with time spent.
      if (ward) ward.remaining = DT;
      run(r, DT, [ray, guard]);
      ray.auras = ray.auras.filter((a) => a.id !== TEMPLE_CARAPACE_AURA);
      run(r, 1, [ray, guard]);
      expect(objects(r, TEMPLE_HEARTPEARL_ORB)).toHaveLength(0);
    }
    {
      const r = room('drowned_temple');
      const ray = engage(r, 'pearlguard_sentinel', 0, 4);
      const guard = engage(r, 'drowned_templeguard', 10, 10);
      run(r, DT, [ray, guard]);
      breakCocoon(r, ray, [ray, guard]);
      run(r, 1, [ray, guard]);
      expect(objects(r, TEMPLE_HEARTPEARL_ORB)).toHaveLength(0);
    }
  });
});

// ------------------------------------------------------------ determinism

describe('the second wave replays exactly from one seed', () => {
  function trace(seed: number): string[] {
    const r = room('sunken_bastion', 'heroic', seed);
    const sergeant = engage(r, 'drowned_sergeant', 0, 6, 'tw');
    const arbs = [
      engage(r, 'fogbound_arbalest', -10, 14, 'tw'),
      engage(r, 'fogbound_arbalest', 10, 14, 'tw'),
    ];
    const rev = engage(r, 'bastion_revenant', 8, 0, 'tw');
    const mate = engage(r, 'bastion_revenant', 8, 8, 'tw');
    addPlayer(r, 'mage', 0, -6);
    addPlayer(r, 'priest', 8, 4);
    const all = [sergeant, ...arbs, rev, mate];
    run(r, 9, all);
    r.sim.ctx.handleDeath(rev, r.me);
    run(r, 5, all);
    return r.events
      .filter((e) => e.type === 'damage' || e.type === 'spellfx')
      .map((e) => JSON.stringify(e));
  }

  it('two runs from the same seed land the same beats', () => {
    const a = trace(5);
    expect(a.some((e) => e.includes('"Rusted Bolt"'))).toBe(true);
    expect(a.some((e) => e.includes('bastion_throatlight'))).toBe(true);
    expect(trace(5)).toEqual(a);
  });
});

// -------------------------------------------------------- the balance audit

/** A level 20 heroic cloth wearer (dungeon_difficulty.ts: "a missed trash
 *  dodge costs a cloth wearer about 40 percent (1,250 at level 20 heroic)";
 *  docs/design/class-health-table-2026-09-11.md: a level 20 mage at 1,135
 *  without epics, 1,345 at raid best). No single avoidable trash mechanic may
 *  take more than 60 percent of it. */
const HEROIC_CLOTH = 1250;
const HEROIC_CAP = 0.6 * HEROIC_CLOTH;

describe('the balance audit: heroic avoidables never one-shot a cloth wearer', () => {
  it('the Grave Rupture rides the necromancer x12, burst and pool together under the cap', () => {
    const r = room('hollow_crypt', 'heroic');
    const necro = engage(r, 'crypt_gravecaller_necromancer', 0, 8);
    expect(necro.mechanicDamageMult).toBe(12);
    // Its melee is priced apart (the heroic pack budget scaled its old x24
    // floor lift to x10.8); the rupture keeps its own x12.
    const crypt = HEROIC_DUNGEON_TUNING.hollow_crypt;
    expect(crypt.damageMultiplierByMob?.crypt_gravecaller_necromancer).toBe(10.8);
    // The wing bosses' own mechanic factors sit beside it (crypt bosses), with
    // the trash kits the pack budget held at their pre-budget factors.
    expect(crypt.mechanicDamageMultiplierByMob).toEqual({
      crypt_ossuary_warrior: 20,
      crypt_gravecaller_adept: 24,
      crypt_chapel_gargoyle: 20,
      crypt_ossuary_cutthroat: 23,
      crypt_ossuary_drake: 20,
      bonechill_widow: 20,
      crypt_crow_caller: 24,
      crypt_carrion_crow: 66,
      crypt_gravecaller_necromancer: 12,
      sexton_marrow: 6,
      rimeweb: 5,
      cantor_ilvane: 8,
      morthen: 9,
    });
    const def = MOBS.crypt_gravecaller_necromancer.trashKit?.rupture;
    if (!def) throw new Error('rupture');
    const burst = def.max * 12;
    const pool = def.pool.max * 12 * (def.pool.seconds / def.pool.tick);
    expect([def.min * 12, burst]).toEqual([264, 360]);
    expect(burst + pool).toBeLessThanOrEqual(HEROIC_CAP);
  });

  it('the Brine Column rides the acolyte x8: 72 to 104 a beat, four beats', () => {
    const r = room('sunken_bastion', 'heroic');
    const aco = engage(r, 'tidebound_acolyte', 10, 0);
    expect(aco.mechanicDamageMult).toBe(8);
    const mage = addPlayer(r, 'mage', -8, 0);
    const def = MOBS.tidebound_acolyte.trashKit?.column;
    if (!def) throw new Error('column');
    // The root re-derives the victim's stats (its pool falls back to its real
    // one): a level 20 cloth pool (~665 naked) outlasts the 416 worst case.
    r.sim.chat('/dev level 20', mage.id);
    mage.hp = mage.maxHp;
    runUntilCast(r, aco, def.castId, [aco]);
    run(r, def.castTime + DT, [aco]);
    const beats = dealt(r, mage.id, 'Brine Column');
    expect(beats).toHaveLength(4);
    for (const b of beats) {
      expect(b).toBeGreaterThanOrEqual(72);
      expect(b).toBeLessThanOrEqual(104);
    }
    expect(def.max * 8 * 4).toBeLessThanOrEqual(HEROIC_CAP);
  });

  it('a fully fed Brine Burst stays under the cap (25 percent a stack)', () => {
    const burst = MOBS.barnacle_crawler.trashKit?.deathBurst;
    const glut = MOBS.barnacle_crawler.trashKit?.gorge;
    if (!burst?.perStack || !glut) throw new Error('crawler');
    expect(burst.perStack.damage).toBe(0.25);
    const worst = burst.max * (1 + glut.maxStacks * burst.perStack.damage) * 8;
    expect(worst).toBe(560);
    expect(worst).toBeLessThanOrEqual(HEROIC_CAP);
  });

  it('every second-wave damage mechanic stays under the cap at its heroic factor', () => {
    const volley = MOBS.crypt_gravecaller_adept.trashKit?.nova;
    const order = MOBS.drowned_sergeant.trashKit?.bastion?.order;
    const throat = MOBS.bastion_revenant.trashKit?.walker;
    if (!volley || !order || !throat) throw new Error('wave 2');
    expect(volley.max * 24).toBeLessThanOrEqual(HEROIC_CAP);
    // Three arbalests in the r1 tower, each on its own x8.
    expect(order.max * 8 * 3).toBeLessThanOrEqual(HEROIC_CAP);
    expect(throat.intercept.max * 18).toBeLessThanOrEqual(HEROIC_CAP);
  });
});
