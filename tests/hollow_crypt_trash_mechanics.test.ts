// The Hollow Crypt trash mechanics pass (src/sim/mob/trash_kit/crypt_kit.ts,
// crypt_hooks.ts; content in src/sim/content/hollow_crypt_trash.ts and the
// Bonechill Widow in dungeons.ts): every mechanic's trigger, its counterplay,
// normal against heroic, and a same-seed replay. Driven through tickTrashKits
// inside a real claimed crypt (tests/trash_kit.test.ts's shape).

import { describe, expect, it } from 'vitest';
import { DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { applyDungeonMobTuning } from '../src/sim/instances/difficulty';
import { claimedInstanceAt } from '../src/sim/instances/dungeons';
import { SCRIPTED_INTERRUPTIBLE_CHANNELS } from '../src/sim/mob/healer_channel';
import { tickBreathConeBar } from '../src/sim/mob/mob_cast_bars';
import { tickTrashKits } from '../src/sim/mob/trash_kit';
import { isPlantedCast } from '../src/sim/mob/trash_kit/cast_hold';
import {
  CRYPT_BARROW_EMBERS,
  CRYPT_BONE_PILE,
  CRYPT_CARRION_EYE,
  CRYPT_CRACKED_STONE,
  CRYPT_GRANITE_SKIN,
  CRYPT_GRAVE_RUPTURE,
  CRYPT_MARROW_CRUSH,
  CRYPT_RIMESILK_SPIT,
  CRYPT_RUPTURE_POOL,
  CRYPT_RUPTURE_RING,
  CRYPT_TORN_TENDON,
} from '../src/sim/mob/trash_kit/cast_ids';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { DT, type Entity } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';

interface Room {
  sim: Sim;
  inst: InstanceSlot;
  me: Entity;
}

function room(difficulty: 'normal' | 'heroic' = 'normal', seed = 91): Room {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.chat(`/dev crypt enter ${difficulty}`, sim.player.id);
  const inst = claimedInstanceAt(sim.ctx, sim.player.pos);
  if (!inst) throw new Error('no crypt claim');
  const me = sim.player;
  me.maxHp = 1e6;
  me.hp = 1e6;
  const o = instanceOrigin(DUNGEONS.hollow_crypt.index, inst.slot);
  me.pos = sim.ctx.groundPos(o.x + 20, o.z - 10);
  me.prevPos = { ...me.pos };
  sim.drainEvents();
  return { sim, inst, me };
}

/** A kit mob at an offset from the player, engaged on it, in pack `pack`. */
function engage(r: Room, templateId: string, dx = 8, dz = 0, pack = 'tp'): Entity {
  const t = MOBS[templateId];
  const mob = createMob(r.sim.ctx.nextId++, t, t.minLevel, {
    ...r.sim.ctx.groundPos(r.me.pos.x + dx, r.me.pos.z + dz),
  });
  applyDungeonMobTuning(mob, 'hollow_crypt', r.inst.difficulty);
  mob.dungeonPackId = pack;
  r.sim.ctx.addEntity(mob);
  r.inst.mobIds.push(mob.id);
  mob.inCombat = true;
  mob.aiState = 'attack';
  mob.aggroTargetId = r.me.id;
  mob.facing = Math.atan2(r.me.pos.x - mob.pos.x, r.me.pos.z - mob.pos.z);
  return mob;
}

/** Run only the kit for `seconds`, holding every listed living mob engaged. */
function run(r: Room, seconds: number, mobs: Entity[]): void {
  for (let t = 0; t < seconds - DT * 0.5; t += DT) {
    for (const m of mobs) {
      if (m.dead || !r.sim.ctx.entities.has(m.id)) continue;
      m.inCombat = true;
      m.aiState = 'attack';
      m.aggroTargetId ??= r.me.id;
    }
    tickTrashKits(r.sim.ctx);
    r.sim.drainEvents();
  }
}

function addPlayer(r: Room, cls: 'mage' | 'priest' | 'warrior', dx: number, dz: number): Entity {
  const pid = r.sim.addPlayer(cls, `T${cls}${dx}${dz}`);
  const e = r.sim.ctx.entities.get(pid) as Entity;
  e.pos = r.sim.ctx.groundPos(r.me.pos.x + dx, r.me.pos.z + dz);
  e.prevPos = { ...e.pos };
  e.maxHp = 1e6;
  e.hp = 1e6;
  return e;
}

/** The claim's living mobs of a template. */
function living(r: Room, templateId: string): Entity[] {
  return r.inst.mobIds
    .map((id) => r.sim.ctx.entities.get(id))
    .filter((e): e is Entity => !!e && !e.dead && e.templateId === templateId);
}

function objects(r: Room, templateId: string): Entity[] {
  return r.inst.objectIds
    .map((id) => r.sim.ctx.entities.get(id))
    .filter((e): e is Entity => !!e && e.templateId === templateId);
}

function kill(r: Room, mob: Entity): void {
  r.sim.ctx.handleDeath(mob, r.me);
  r.sim.drainEvents();
}

describe('crypt trash pass: the cast table', () => {
  it('kicks the rupture and the eye; the crush and the web are dodged', () => {
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[CRYPT_GRAVE_RUPTURE]?.school).toBe('shadow');
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[CRYPT_CARRION_EYE]?.school).toBe('nature');
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[CRYPT_MARROW_CRUSH]).toBeUndefined();
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[CRYPT_RIMESILK_SPIT]).toBeUndefined();
    expect(MOBS.crypt_bone_brute.breathCone?.castId).toBe(CRYPT_MARROW_CRUSH);
    expect(MOBS.bonechill_widow.trashKit?.line?.root).toBe(2);
    expect(isPlantedCast(MOBS.bonechill_widow, CRYPT_RIMESILK_SPIT)).toBe(true);
    expect(isPlantedCast(MOBS.crypt_bone_brute, CRYPT_MARROW_CRUSH)).toBe(true);
    // The rupture rings a corpse, never its caster: never planted.
    expect(isPlantedCast(MOBS.crypt_gravecaller_necromancer, CRYPT_GRAVE_RUPTURE)).toBe(false);
    expect(MOBS.crypt_carrion_crow.blind?.name).toBe('Gouging Beak');
  });
});

describe('crypt trash pass: Ossuary Warrior, Reassemble', () => {
  const def = MOBS.crypt_ossuary_warrior.trashKit?.reassemble;
  if (!def) throw new Error('reassemble');

  it('falls beside a living necromancer: a pile lies, and the warrior stands again once', () => {
    const r = room();
    const necro = engage(r, 'crypt_gravecaller_necromancer', 12, 0);
    const warrior = engage(r, 'crypt_ossuary_warrior', 3, 0);
    kill(r, warrior);
    run(r, DT, [necro]);
    const [pile] = living(r, CRYPT_BONE_PILE);
    expect(pile).toBeDefined();
    expect(pile.trashLife?.pile?.corpseId).toBe(warrior.id);
    expect(Math.hypot(pile.pos.x - warrior.pos.x, pile.pos.z - warrior.pos.z)).toBeLessThan(0.01);
    expect(warrior.dead).toBe(true);
    run(r, def.seconds, [necro]);
    expect(warrior.dead).toBe(false);
    expect(warrior.regrown).toBe(true);
    expect(warrior.hp).toBe(Math.round(warrior.maxHp * def.hpPct));
    expect(warrior.inCombat).toBe(true);
    expect(living(r, CRYPT_BONE_PILE)).toHaveLength(0);
    // Normal: once. The second fall lays no pile.
    kill(r, warrior);
    run(r, DT, [necro]);
    expect(living(r, CRYPT_BONE_PILE)).toHaveLength(0);
    run(r, def.seconds + 1, [necro]);
    expect(warrior.dead).toBe(true);
  });

  it('a risen warrior pays nothing twice, and gives its first loot back when it falls', () => {
    const r = room();
    const meta = r.sim.ctx.players.get(r.me.id);
    if (!meta) throw new Error('meta');
    const necro = engage(r, 'crypt_gravecaller_necromancer', 12, 0);
    const warrior = engage(r, 'crypt_ossuary_warrior', 3, 0);
    kill(r, warrior);
    const kills = meta.counters.kills;
    const loot = warrior.loot;
    const lootable = warrior.lootable;
    run(r, def.seconds + DT, [necro]);
    expect(warrior.dead).toBe(false);
    // Standing, it cannot be looted.
    expect(warrior.lootable).toBe(false);
    kill(r, warrior);
    expect(meta.counters.kills).toBe(kills);
    run(r, DT, [necro]);
    expect(warrior.lootable).toBe(lootable);
    expect(warrior.loot).toBe(loot);
  });

  it('killing the necromancer first keeps the bones down', () => {
    const r = room();
    const necro = engage(r, 'crypt_gravecaller_necromancer', 12, 0);
    const warrior = engage(r, 'crypt_ossuary_warrior', 3, 0);
    kill(r, warrior);
    run(r, 2, [necro]);
    expect(living(r, CRYPT_BONE_PILE)).toHaveLength(1);
    kill(r, necro);
    run(r, DT, []);
    expect(living(r, CRYPT_BONE_PILE)).toHaveLength(0);
    run(r, def.seconds + 1, []);
    expect(warrior.dead).toBe(true);
  });

  it('breaking the pile keeps the bones down', () => {
    const r = room();
    const necro = engage(r, 'crypt_gravecaller_necromancer', 12, 0);
    const warrior = engage(r, 'crypt_ossuary_warrior', 3, 0);
    kill(r, warrior);
    run(r, DT, [necro]);
    const [pile] = living(r, CRYPT_BONE_PILE);
    expect(pile.maxHp).toBeLessThan(warrior.maxHp / 4);
    r.sim.ctx.dealDamage(r.me, pile, pile.maxHp, false, 'physical', 'test', 'hit');
    expect(pile.dead).toBe(true);
    run(r, def.seconds + 1, [necro]);
    expect(warrior.dead).toBe(true);
    expect(r.sim.ctx.entities.has(pile.id)).toBe(false);
  });

  it('a warrior with no necromancer in its pack stays down', () => {
    const r = room();
    engage(r, 'crypt_gravecaller_necromancer', 12, 0, 'other');
    const warrior = engage(r, 'crypt_ossuary_warrior', 3, 0);
    kill(r, warrior);
    run(r, def.seconds + 1, []);
    expect(living(r, CRYPT_BONE_PILE)).toHaveLength(0);
    expect(warrior.dead).toBe(true);
  });

  it('heroic: it stands with half its health, and can stand twice', () => {
    const r = room('heroic');
    const necro = engage(r, 'crypt_gravecaller_necromancer', 12, 0);
    const warrior = engage(r, 'crypt_ossuary_warrior', 3, 0);
    kill(r, warrior);
    run(r, def.seconds + DT, [necro]);
    expect(warrior.dead).toBe(false);
    expect(warrior.hp).toBe(Math.round(warrior.maxHp * def.heroicHpPct));
    kill(r, warrior);
    run(r, def.seconds + DT, [necro]);
    expect(warrior.dead).toBe(false);
    kill(r, warrior);
    run(r, def.seconds + DT, [necro]);
    expect(warrior.dead).toBe(true);
    expect(warrior.trashLife?.rises).toBe(def.heroicRises);
  });
});

describe('crypt trash pass: Gravecaller Necromancer, Grave Rupture', () => {
  const def = MOBS.crypt_gravecaller_necromancer.trashKit?.rupture;
  if (!def) throw new Error('rupture');

  /** A necromancer whose raise is spent (two minions up), beside a fallen
   *  adept of its pack 4 yards east of the player. */
  function setup(r: Room): { necro: Entity; corpse: Entity } {
    const necro = engage(r, 'crypt_gravecaller_necromancer', 14, 0);
    const corpse = engage(r, 'crypt_gravecaller_adept', 0, 0);
    kill(r, corpse);
    // The raise waits while two minions stand (they are out of the fight's way).
    for (let i = 0; i < 2; i++) {
      const m = engage(r, 'crypt_bone_minion', 40 + i * 3, 40);
      necro.summonedIds.push(m.id);
    }
    return { necro, corpse };
  }

  it('rings a fallen packmate and bursts it on whoever stands in the ring', () => {
    const r = room();
    const { necro, corpse } = setup(r);
    const outside = addPlayer(r, 'mage', 0, def.radius + 3);
    run(r, def.first + DT, [necro]);
    expect(necro.castingAbility).toBe(CRYPT_GRAVE_RUPTURE);
    const [ring] = objects(r, CRYPT_RUPTURE_RING);
    expect(ring).toBeDefined();
    expect(ring.scale).toBe(def.radius);
    expect(Math.hypot(ring.pos.x - corpse.pos.x, ring.pos.z - corpse.pos.z)).toBeLessThan(0.01);
    const inBefore = r.me.hp;
    const outBefore = outside.hp;
    run(r, def.castTime + DT, [necro]);
    expect(r.me.hp).toBeLessThan(inBefore);
    expect(inBefore - r.me.hp).toBeLessThanOrEqual(def.max);
    expect(outside.hp).toBe(outBefore);
    expect(objects(r, CRYPT_RUPTURE_RING)).toHaveLength(0);
    expect(corpse.trashLife?.ruptured).toBe(true);
    // Normal leaves no pool, and a burst corpse is never marked again.
    expect(objects(r, CRYPT_RUPTURE_POOL)).toHaveLength(0);
    run(r, def.every + DT, [necro]);
    expect(necro.castingAbility).not.toBe(CRYPT_GRAVE_RUPTURE);
  });

  it('a kick lifts the ring and nothing bursts', () => {
    const r = room();
    const { necro, corpse } = setup(r);
    run(r, def.first + DT, [necro]);
    expect(necro.castingAbility).toBe(CRYPT_GRAVE_RUPTURE);
    const before = r.me.hp;
    r.sim.ctx.cancelCast(necro);
    run(r, DT, [necro]);
    expect(objects(r, CRYPT_RUPTURE_RING)).toHaveLength(0);
    run(r, def.castTime, [necro]);
    expect(r.me.hp).toBe(before);
    expect(corpse.trashLife?.ruptured).toBeUndefined();
  });

  it('heroic: the burst rides the necromancer x12 (the balance audit), 264 to 360', () => {
    const r = room('heroic');
    const { necro } = setup(r);
    expect(necro.mechanicDamageMult).toBe(12);
    run(r, def.first + DT, [necro]);
    expect(necro.castingAbility).toBe(CRYPT_GRAVE_RUPTURE);
    const before = r.me.hp;
    run(r, def.castTime + DT, [necro]);
    const burst = before - r.me.hp;
    expect(burst).toBeGreaterThanOrEqual(def.min * 12);
    expect(burst).toBeLessThanOrEqual(def.max * 12);
  });

  it('heroic: the corpse burns on, a pool that ticks then lifts', () => {
    const r = room('heroic');
    const { necro } = setup(r);
    run(r, def.first + def.castTime + DT * 2, [necro]);
    expect(objects(r, CRYPT_RUPTURE_POOL)).toHaveLength(1);
    const before = r.me.hp;
    run(r, def.pool.seconds, [necro]);
    expect(r.me.hp).toBeLessThan(before);
    expect(objects(r, CRYPT_RUPTURE_POOL)).toHaveLength(0);
  });
});

describe('crypt trash pass: Bone Minion, Splinter Burst', () => {
  it("the minion's burst cuts the skeletons in its ring, never killing one", () => {
    const r = room();
    const shrapnel = MOBS.crypt_bone_minion.deathThroes?.shrapnel;
    if (!shrapnel) throw new Error('shrapnel');
    const minion = engage(r, 'crypt_bone_minion', 5, 0);
    const near = engage(r, 'crypt_ossuary_warrior', 6, 1, 'other');
    const far = engage(r, 'crypt_ossuary_warrior', 5, 12, 'other');
    const frail = engage(r, 'crypt_ossuary_warrior', 4, -1, 'other');
    frail.hp = 3;
    // An unpulled skeleton in the ring is never pre-cut.
    const idle = engage(r, 'crypt_ossuary_warrior', 5, 1, 'idle');
    idle.inCombat = false;
    kill(r, minion);
    const nearBefore = near.hp;
    r.sim.ctx.detonateCorpse(minion);
    expect(nearBefore - near.hp).toBe(Math.round(near.maxHp * shrapnel.maxHpPct));
    expect(far.hp).toBe(far.maxHp);
    expect(idle.hp).toBe(idle.maxHp);
    expect(frail.dead).toBe(false);
    expect(frail.hp).toBeGreaterThanOrEqual(1);
  });
});

describe('crypt trash pass: Bone Brute, Marrow Crush', () => {
  it('smashes the narrow cone in front and nobody beside it', () => {
    const r = room();
    const brute = engage(r, 'crypt_bone_brute', 0, 4);
    const crush = MOBS.crypt_bone_brute.breathCone;
    if (!crush) throw new Error('crush');
    // A mage 40 degrees off the brute's line: outside the 50 degree cone.
    const side = addPlayer(
      r,
      'mage',
      Math.sin((40 * Math.PI) / 180) * 4,
      4 - Math.cos((40 * Math.PI) / 180) * 4,
    );
    brute.facing = Math.atan2(r.me.pos.x - brute.pos.x, r.me.pos.z - brute.pos.z);
    brute.castingAbility = crush.castId;
    brute.castRemaining = DT;
    brute.castTotal = crush.castTime;
    const front = r.me.hp;
    const sideBefore = side.hp;
    tickBreathConeBar(r.sim.ctx, brute, crush);
    expect(front - r.me.hp).toBeGreaterThanOrEqual(crush.min);
    expect(side.hp).toBe(sideBefore);
  });
});

describe('crypt trash pass: Chapel Gargoyle, Granite Skin', () => {
  const def = MOBS.crypt_chapel_gargoyle.trashKit?.granite;
  if (!def) throw new Error('granite');

  it('thickens every few seconds to its cap; a stun shatters it into Cracked Stone', () => {
    const r = room();
    const garg = engage(r, 'crypt_chapel_gargoyle', 4, 0);
    run(r, def.every * 2 + DT, [garg]);
    let skin = garg.auras.find((a) => a.id === CRYPT_GRANITE_SKIN);
    expect(skin?.stacks).toBe(2);
    expect(skin?.kind).toBe('shield_wall');
    expect(skin?.value).toBeCloseTo(def.perStack * 2, 5);
    run(r, def.every * 6, [garg]);
    skin = garg.auras.find((a) => a.id === CRYPT_GRANITE_SKIN);
    expect(skin?.stacks).toBe(def.maxStacks);
    // A stun: the stone shatters, the gargoyle takes more damage a while.
    r.sim.ctx.applyAura(garg, {
      id: 'test_stun',
      name: 'Stun',
      kind: 'stun',
      remaining: 1,
      duration: 1,
      value: 0,
      sourceId: r.me.id,
      school: 'physical',
    });
    run(r, DT, [garg]);
    expect(garg.auras.find((a) => a.id === CRYPT_GRANITE_SKIN)).toBeUndefined();
    const crack = garg.auras.find((a) => a.id === CRYPT_CRACKED_STONE);
    expect(crack?.kind).toBe('vulnerability');
    expect(crack?.value).toBe(def.cracked.taken);
    // No stone grows back while it is cracked.
    run(r, def.cracked.seconds - 1, [garg]);
    expect(garg.auras.find((a) => a.id === CRYPT_GRANITE_SKIN)).toBeUndefined();
  });

  it('heroic stone is thicker per layer', () => {
    const r = room('heroic');
    const garg = engage(r, 'crypt_chapel_gargoyle', 4, 0);
    run(r, def.every + DT, [garg]);
    const skin = garg.auras.find((a) => a.id === CRYPT_GRANITE_SKIN);
    expect(skin?.value).toBeCloseTo(def.heroicPerStack, 5);
  });
});

describe('crypt trash pass: Crow Caller, Carrion Eye', () => {
  const def = MOBS.crypt_crow_caller.trashKit?.eye;
  if (!def) throw new Error('eye');

  function flock(r: Room): { caller: Entity; crows: Entity[]; mage: Entity } {
    const caller = engage(r, 'crypt_crow_caller', 12, 0);
    const crows = [0, 1, 2].map((i) => engage(r, 'crypt_carrion_crow', 3, i - 1));
    const mage = addPlayer(r, 'mage', -10, 0);
    return { caller, crows, mage };
  }

  it('marks a player other than its own foe, and every crow hunts them', () => {
    const r = room();
    const { caller, crows, mage } = flock(r);
    // Hold the Murder Call back: this test reads the eye alone.
    caller.trashKit = undefined;
    run(r, DT, [caller, ...crows]);
    const st = caller.trashKit as unknown as { timers: Record<string, number> };
    st.timers.call = 999;
    run(r, def.first, [caller, ...crows]);
    expect(caller.castingAbility).toBe(CRYPT_CARRION_EYE);
    expect(caller.castTargetId).toBe(mage.id);
    run(r, def.castTime + DT, [caller, ...crows]);
    const mark = mage.auras.find((a) => a.id === CRYPT_CARRION_EYE);
    // A mark that changes nothing and no freedom effect sheds (never a slow).
    expect(mark?.kind).toBe('vulnerability');
    expect(mark?.value).toBe(0);
    for (const c of crows) {
      expect(c.forcedTargetId).toBe(mage.id);
      expect(c.forcedTargetTimer).toBeGreaterThan(def.seconds - 0.2);
    }
  });

  it('a kick spares the mark', () => {
    const r = room();
    const { caller, crows, mage } = flock(r);
    run(r, DT, [caller, ...crows]);
    (caller.trashKit as unknown as { timers: Record<string, number> }).timers.call = 999;
    run(r, def.first, [caller, ...crows]);
    expect(caller.castingAbility).toBe(CRYPT_CARRION_EYE);
    r.sim.ctx.cancelCast(caller);
    run(r, def.castTime + DT, [caller, ...crows]);
    expect(mage.auras.some((a) => a.id === CRYPT_CARRION_EYE)).toBe(false);
    for (const c of crows) expect(c.forcedTargetId).not.toBe(mage.id);
  });
});

describe('crypt trash pass: Ossuary Cutthroat, Torn Tendon', () => {
  const leap = MOBS.crypt_ossuary_cutthroat.trashKit?.leap;
  if (!leap?.slow) throw new Error('leap');

  it('its leap halves the victim run speed for the fixate', () => {
    const r = room();
    const cut = engage(r, 'crypt_ossuary_cutthroat', 2, 0);
    const mage = addPlayer(r, 'mage', -16, 0);
    run(r, leap.first + leap.seconds + DT * 2, [cut]);
    const slow = mage.auras.find((a) => a.id === CRYPT_TORN_TENDON);
    expect(slow?.kind).toBe('slow');
    expect(slow?.value).toBe(leap.slow?.mult);
  });

  it('heroic: unanswered, it leaps again at the next caster; normal never does', () => {
    for (const difficulty of ['normal', 'heroic'] as const) {
      const r = room(difficulty);
      const cut = engage(r, 'crypt_ossuary_cutthroat', 2, 0);
      const mage = addPlayer(r, 'mage', -16, 0);
      const priest = addPlayer(r, 'priest', 0, -14);
      run(r, leap.first + leap.seconds + DT * 2, [cut]);
      const first = cut.forcedTargetId;
      expect(first).toBe(mage.id);
      // Stand the victim still; nobody answers the fixate.
      run(r, leap.fixate + leap.seconds + DT * 4, [cut]);
      const second = Math.hypot(cut.pos.x - priest.pos.x, cut.pos.z - priest.pos.z) < 3;
      expect(second, difficulty).toBe(difficulty === 'heroic');
    }
  });

  it('heroic: a stun on the leaper answers it, and it does not leap again', () => {
    const r = room('heroic');
    const cut = engage(r, 'crypt_ossuary_cutthroat', 2, 0);
    addPlayer(r, 'mage', -16, 0);
    const priest = addPlayer(r, 'priest', 0, -14);
    run(r, leap.first + leap.seconds + DT * 2, [cut]);
    r.sim.ctx.applyAura(cut, {
      id: 'test_stun',
      name: 'Stun',
      kind: 'stun',
      remaining: 0.5,
      duration: 0.5,
      value: 0,
      sourceId: r.me.id,
      school: 'physical',
    });
    run(r, leap.fixate + leap.seconds + DT * 4, [cut]);
    expect(Math.hypot(cut.pos.x - priest.pos.x, cut.pos.z - priest.pos.z)).toBeGreaterThan(3);
  });
});

describe('crypt trash pass: Ossuary Drake, Barrow Embers', () => {
  const def = MOBS.crypt_ossuary_drake.trashKit?.scorch;
  const breath = MOBS.crypt_ossuary_drake.breathCone;
  if (!def || !breath) throw new Error('scorch');

  function breathe(r: Room): Entity {
    const drake = engage(r, 'crypt_ossuary_drake', 0, 6);
    run(r, DT, [drake]);
    drake.trashKit = drake.trashKit ?? undefined;
    if (drake.trashKit) drake.trashKit.descent = null;
    drake.facing = Math.atan2(r.me.pos.x - drake.pos.x, r.me.pos.z - drake.pos.z);
    drake.castingAbility = breath?.castId ?? null;
    drake.castRemaining = DT;
    drake.castTotal = breath?.castTime ?? 1;
    if (breath) tickBreathConeBar(r.sim.ctx, drake, breath);
    return drake;
  }

  it('heroic: the breath leaves its cone burning; whoever stands in it burns', () => {
    const r = room('heroic');
    const drake = breathe(r);
    run(r, DT, [drake]);
    const [embers] = objects(r, CRYPT_BARROW_EMBERS);
    expect(embers).toBeDefined();
    expect(embers.scale).toBe(breath.range);
    const before = r.me.hp;
    run(r, def.seconds, [drake]);
    expect(r.me.hp).toBeLessThan(before);
    expect(objects(r, CRYPT_BARROW_EMBERS)).toHaveLength(0);
  });

  it('normal: the breath leaves nothing burning', () => {
    const r = room();
    const drake = breathe(r);
    run(r, def.seconds, [drake]);
    expect(objects(r, CRYPT_BARROW_EMBERS)).toHaveLength(0);
  });
});

describe('crypt trash pass: Bonechill Widow, Rimesilk Spit', () => {
  it('roots whoever stays in its lane, and nobody who stepped out', () => {
    const r = room();
    const line = MOBS.bonechill_widow.trashKit?.line;
    if (!line) throw new Error('line');
    const widow = engage(r, 'bonechill_widow', 10, 0);
    run(r, line.first + DT, [widow]);
    expect(widow.castingAbility).toBe(CRYPT_RIMESILK_SPIT);
    const aside = addPlayer(r, 'mage', 0, 6);
    run(r, line.castTime + DT, [widow]);
    expect(
      r.me.auras.some((a) => a.id === `${CRYPT_RIMESILK_SPIT}_root` && a.kind === 'root'),
    ).toBe(true);
    expect(aside.auras.some((a) => a.kind === 'root')).toBe(false);
  });
});

describe('crypt trash pass: determinism', () => {
  it('the same pull on the same seed lands the same world', () => {
    const trace = (): string => {
      const r = room('heroic', 7);
      const necro = engage(r, 'crypt_gravecaller_necromancer', 12, 0);
      const warrior = engage(r, 'crypt_ossuary_warrior', 3, 0);
      const adept = engage(r, 'crypt_gravecaller_adept', 0, 0);
      const garg = engage(r, 'crypt_chapel_gargoyle', 5, 5);
      addPlayer(r, 'mage', -12, 0);
      kill(r, adept);
      kill(r, warrior);
      run(r, 20, [necro, garg, warrior]);
      return JSON.stringify({
        me: r.me.hp,
        warrior: [warrior.dead, warrior.hp],
        garg: garg.auras.map((a) => [a.id, a.stacks ?? 0]),
        rng: r.sim.ctx.rng.range(0, 1e9),
      });
    };
    expect(trace()).toBe(trace());
  });
});

describe('crypt trash pass: the marks say their rule', () => {
  it('the Carrion Eye is a hunt, never a 0% slow; Granite Skin says its stone', () => {
    const eye = auraEffectDescriptor({ id: CRYPT_CARRION_EYE, kind: 'vulnerability', value: 0 });
    expect(eye?.key).toBe('hudChrome.auraEffect.crypt.carrionEye');
    expect(eye?.nums?.seconds).toBe(MOBS.crypt_crow_caller.trashKit?.eye?.seconds);
    const skin = auraEffectDescriptor({
      id: CRYPT_GRANITE_SKIN,
      kind: 'shield_wall',
      value: 0.18,
      stacks: 3,
    });
    expect(skin?.key).toBe('hudChrome.auraEffect.crypt.graniteSkin');
    expect(skin?.nums).toEqual({ pct: 18, every: 3, max: 5, cracked: 25, seconds: 6 });
  });
});
