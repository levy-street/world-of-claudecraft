// The Wildheart Basin trash mechanics pass (the Basin's own kit block,
// MobTemplate.trashKit.wildheart, run by
// src/sim/mob/trash_kit/wildheart_extension.ts through wildheart_hunt.ts, plus
// two template fields the engine already knew): the raptors' Pack Frenzy, the
// stalker's Quarry Mark, the ravager's War Roar, the hexcaller's Toad Hex, the
// binder's alternating totems and the Dread Totem's Rattling Dread, the toad's
// Snaring Tongue and the lasher's Snarlbark. Driven through tickTrashKits
// inside a real claimed Basin: the trigger, the counterplay, normal against
// heroic, and the same world from the same seed.

import { describe, expect, it } from 'vitest';
import { meleeSwing } from '../src/sim/combat/auto_attack';
import { SHARED_FEAR_AURA_ID } from '../src/sim/combat/cc';
import { DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { applyDungeonMobTuning } from '../src/sim/instances/difficulty';
import { claimedInstanceAt } from '../src/sim/instances/dungeons';
import { SCRIPTED_INTERRUPTIBLE_CHANNELS } from '../src/sim/mob/healer_channel';
import { tickTrashKits } from '../src/sim/mob/trash_kit';
import {
  WILDHEART_ANCESTRAL_SAP,
  WILDHEART_QUARRY,
  WILDHEART_QUARRY_MARK,
  WILDHEART_RATTLING_DREAD,
  WILDHEART_ROAR_FRENZY,
  WILDHEART_ROAR_HASTE,
  WILDHEART_SNARING_TONGUE,
  WILDHEART_TOAD_HEX,
  WILDHEART_TOADED,
  WILDHEART_WAR_ROAR,
} from '../src/sim/mob/trash_kit/wildheart_cast_ids';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { angleTo, DT, type Entity, type SimEvent } from '../src/sim/types';

const DUNGEON = 'wildheart_basin';
/** The packmates' haste aura (mob/lifecycle.ts frenzyPackmates). */
const PACK_FRENZY_AURA_ID = 'pack_frenzy';

interface Room {
  sim: Sim;
  inst: InstanceSlot;
  me: Entity;
  events: SimEvent[];
}

function room(difficulty: 'normal' | 'heroic' = 'normal', seed = 93): Room {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.chat(`/dev wildheart enter ${difficulty}`, sim.player.id);
  const inst = claimedInstanceAt(sim.ctx, sim.player.pos);
  if (!inst) throw new Error('no wildheart claim');
  const me = sim.player;
  me.maxHp = 1e6;
  me.hp = 1e6;
  const o = instanceOrigin(DUNGEONS[DUNGEON].index, inst.slot);
  // The middle of the Central Island, a wide flat bench.
  me.pos = sim.ctx.groundPos(o.x, o.z + 16);
  me.prevPos = { ...me.pos };
  sim.drainEvents();
  return { sim, inst, me, events: [] };
}

function engage(r: Room, templateId: string, dx = 6, dz = 0): Entity {
  const mob = createMob(r.sim.ctx.nextId++, MOBS[templateId], MOBS[templateId].minLevel, {
    ...r.sim.ctx.groundPos(r.me.pos.x + dx, r.me.pos.z + dz),
  });
  applyDungeonMobTuning(mob, DUNGEON, r.inst.difficulty);
  r.sim.ctx.addEntity(mob);
  r.inst.mobIds.push(mob.id);
  mob.inCombat = true;
  mob.aiState = 'attack';
  mob.aggroTargetId = r.me.id;
  mob.facing = Math.atan2(r.me.pos.x - mob.pos.x, r.me.pos.z - mob.pos.z);
  return mob;
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
  const pid = r.sim.addPlayer(cls, `W${cls}${dx}${dz}`);
  const e = r.sim.ctx.entities.get(pid) as Entity;
  e.pos = r.sim.ctx.groundPos(r.me.pos.x + dx, r.me.pos.z + dz);
  e.prevPos = { ...e.pos };
  e.maxHp = 1e6;
  e.hp = 1e6;
  return e;
}

function has(e: Entity, id: string): boolean {
  return e.auras.some((a) => a.id === id);
}

function hitsOn(r: Room, targetId: number, name: string): number[] {
  return r.events
    .filter(
      (e): e is Extract<SimEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.targetId === targetId && e.ability === name,
    )
    .map((e) => e.amount);
}

/** Hold every kit cast of `mob` but `key`, and open `key` now. */
function only(r: Room, mob: Entity, key: string): void {
  run(r, DT, [mob]);
  const st = mob.trashKit;
  if (!st) throw new Error(`${mob.templateId} has no kit state`);
  for (const k of Object.keys(st.timers)) st.timers[k] = 99;
  st.timers[key] = 0;
}

describe('Basin trash mechanics: the content and the kick table', () => {
  it('authors every new key on the right template', () => {
    expect(MOBS.basin_raptor.packFrenzy).toEqual({ radius: 20, hasteMult: 1.3, duration: 8 });
    expect(MOBS.wildheart_stalker.trashKit?.wildheart?.mark?.hunter).toBe('basin_raptor');
    expect(MOBS.wildheart_ravager.trashKit?.wildheart?.roar?.castId).toBe(WILDHEART_WAR_ROAR);
    expect(MOBS.wildheart_hexcaller.trashKit?.wildheart?.hex?.castId).toBe(WILDHEART_TOAD_HEX);
    expect(MOBS.sunbone_dread_totem.trashKit?.wildheart?.dread?.castId).toBe(
      WILDHEART_RATTLING_DREAD,
    );
    expect(MOBS.spore_toad.trashKit?.wildheart?.tongue?.castId).toBe(WILDHEART_SNARING_TONGUE);
    expect(MOBS.vine_lasher.thorns).toEqual({ value: 10, school: 'nature', name: 'Snarlbark' });
    // The Howdah Hexcaller keeps its Saurian job untouched.
    expect(MOBS.howdah_hexcaller.trashKit?.wildheart).toBeUndefined();
  });

  it('kicks the roar and the hex (on their own schools); never the spear, the dread or the tongue', () => {
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[WILDHEART_WAR_ROAR]).toBeDefined();
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[WILDHEART_TOAD_HEX]?.school).toBe('shadow');
    // One kick on the Sap never locks the hex: different schools.
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[WILDHEART_ANCESTRAL_SAP]?.school).not.toBe('shadow');
    for (const id of [WILDHEART_QUARRY_MARK, WILDHEART_RATTLING_DREAD, WILDHEART_SNARING_TONGUE])
      expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[id], id).toBeUndefined();
  });
});

describe('Pack Frenzy: each fallen raptor drives the rest wild', () => {
  it('the survivors swing 30 percent faster for 8 s', () => {
    const r = room();
    const pack = [0, 3, 6, 9].map((dz) => engage(r, 'basin_raptor', 6, dz));
    r.sim.ctx.handleDeath(pack[0], r.me);
    for (const m of pack.slice(1)) {
      const fr = m.auras.find((a) => a.id === PACK_FRENZY_AURA_ID);
      expect([fr?.kind, fr?.value, fr?.duration]).toEqual(['buff_haste', 1.3, 8]);
    }
  });
});

describe('Quarry Mark: the stalker sets its raptors on someone past the tank', () => {
  it('marks a player past the tank and turns every raptor near on them', () => {
    const r = room();
    const healer = addPlayer(r, 'priest', -14, 0);
    const stalker = engage(r, 'wildheart_stalker', 10, 4);
    const raptors = [engage(r, 'basin_raptor', 4, 0), engage(r, 'basin_raptor', 4, 3)];
    only(r, stalker, 'mark');
    run(r, DT, [stalker, ...raptors]);
    expect(stalker.castingAbility).toBe(WILDHEART_QUARRY_MARK);
    expect(stalker.castTargetId).toBe(healer.id);
    run(r, 1.6, [stalker, ...raptors]);
    expect(has(healer, WILDHEART_QUARRY)).toBe(true);
    for (const m of raptors) {
      expect(m.forcedTargetId).toBe(healer.id);
      expect(m.forcedTargetTimer).toBeGreaterThan(3.5);
      expect(m.forcedTargetTimer).toBeLessThanOrEqual(4);
    }
  });

  it('holds the hunt 6 s on heroic', () => {
    const r = room('heroic');
    const healer = addPlayer(r, 'priest', -14, 0);
    const stalker = engage(r, 'wildheart_stalker', 10, 4);
    const raptor = engage(r, 'basin_raptor', 4, 0);
    only(r, stalker, 'mark');
    run(r, 1.7, [stalker, raptor]);
    expect(raptor.forcedTargetId).toBe(healer.id);
    expect(raptor.forcedTargetTimer).toBeGreaterThan(5.5);
    expect(healer.auras.find((a) => a.id === WILDHEART_QUARRY)?.duration).toBe(6);
    // A second spear refreshes the one mark, never stacks a second.
    only(r, stalker, 'mark');
    run(r, 1.7, [stalker, raptor]);
    expect(healer.auras.filter((a) => a.id === WILDHEART_QUARRY)).toHaveLength(1);
  });

  it('a raptor the tank holds with a running taunt stays on the tank', () => {
    const r = room();
    const healer = addPlayer(r, 'priest', -14, 0);
    const stalker = engage(r, 'wildheart_stalker', 10, 4);
    const held = engage(r, 'basin_raptor', 4, 0);
    const free = engage(r, 'basin_raptor', 4, 3);
    held.forcedTargetId = r.me.id;
    held.forcedTargetTimer = 3;
    only(r, stalker, 'mark');
    run(r, 1.7, [stalker, held, free]);
    expect(free.forcedTargetId).toBe(healer.id);
    expect(held.forcedTargetId).toBe(r.me.id);
    // The quarry marker is a bare marker: it never reads as a slow.
    expect(healer.auras.find((a) => a.id === WILDHEART_QUARRY)?.kind).toBe('internal_cd');
  });

  it('with no raptor in the fight it never throws', () => {
    const r = room();
    addPlayer(r, 'priest', -14, 0);
    const stalker = engage(r, 'wildheart_stalker', 10, 4);
    only(r, stalker, 'mark');
    run(r, 1, [stalker]);
    expect(stalker.castingAbility).toBeNull();
  });
});

describe('War Roar: kick it, or every ravager near it frenzies', () => {
  function low(difficulty: 'normal' | 'heroic' = 'normal') {
    const r = room(difficulty);
    const roarer = engage(r, 'wildheart_ravager', 6, 0);
    const mate = engage(r, 'wildheart_ravager', 6, 6);
    const far = engage(r, 'wildheart_ravager', 6, 30);
    roarer.hp = Math.floor(roarer.maxHp * 0.25);
    run(r, DT, [roarer, mate, far]);
    expect(roarer.castingAbility).toBe(WILDHEART_WAR_ROAR);
    return { r, roarer, mate, far };
  }

  it('above 30 percent it never roars', () => {
    const r = room();
    const rav = engage(r, 'wildheart_ravager', 6, 0);
    run(r, 3, [rav]);
    expect(rav.castingAbility).toBeNull();
    // Never started at all (a roar that began and landed inside the 3 s would
    // leave the bar idle again): no cast counted.
    expect(rav.trashKit?.casts ?? 0).toBe(0);
  });

  it('a landed roar frenzies every ravager within 15 yd for the pull', () => {
    const { r, roarer, mate, far } = low();
    run(r, 2.1, [roarer, mate, far]);
    for (const m of [roarer, mate]) {
      expect(m.auras.find((a) => a.id === WILDHEART_ROAR_FRENZY)?.value).toBe(0.3);
      expect(m.auras.find((a) => a.id === WILDHEART_ROAR_HASTE)?.value).toBe(1.15);
    }
    expect(has(far, WILDHEART_ROAR_FRENZY)).toBe(false);
  });

  it('an evade ends the frenzy', () => {
    const { r, roarer, mate, far } = low();
    run(r, 2.1, [roarer, mate, far]);
    expect(has(mate, WILDHEART_ROAR_FRENZY)).toBe(true);
    mate.inCombat = false;
    mate.aiState = 'evade';
    mate.aggroTargetId = null;
    tickTrashKits(r.sim.ctx);
    expect(has(mate, WILDHEART_ROAR_FRENZY)).toBe(false);
    expect(has(mate, WILDHEART_ROAR_HASTE)).toBe(false);
  });

  it('a kicked roar is spent: no frenzy, and it never comes again', () => {
    const { r, roarer, mate, far } = low();
    r.sim.ctx.cancelCast(roarer);
    run(r, 20, [roarer, mate, far]);
    expect(has(roarer, WILDHEART_ROAR_FRENZY)).toBe(false);
    expect(has(mate, WILDHEART_ROAR_FRENZY)).toBe(false);
    expect(roarer.castingAbility).toBeNull();
  });

  it('a stun breaks it too', () => {
    const { r, roarer, mate, far } = low();
    r.sim.ctx.applyAura(roarer, {
      id: 'test_stun',
      name: 'Test Stun',
      kind: 'stun',
      remaining: 3,
      duration: 3,
      value: 0,
      sourceId: r.me.id,
      school: 'physical',
    });
    run(r, 2.1, [roarer, mate, far]);
    expect(has(mate, WILDHEART_ROAR_FRENZY)).toBe(false);
  });
});

describe('Toad Hex: kick it, or tap the toad free', () => {
  function hex(difficulty: 'normal' | 'heroic') {
    const r = room(difficulty);
    const mage = addPlayer(r, 'mage', -12, 0);
    const caller = engage(r, 'wildheart_hexcaller', 8, 0);
    only(r, caller, 'hex');
    run(r, DT, [caller]);
    expect(caller.castingAbility).toBe(WILDHEART_TOAD_HEX);
    expect(caller.castTargetId).toBe(mage.id);
    return { r, mage, caller };
  }

  it('makes a toad of someone past the tank for 5 s; any hit frees them', () => {
    const { r, mage, caller } = hex('normal');
    run(r, 2.1, [caller]);
    const toad = mage.auras.find((a) => a.id === WILDHEART_TOADED);
    expect([toad?.kind, toad?.duration, toad?.breaksOnDamage]).toEqual(['polymorph', 5, true]);
    r.sim.ctx.dealDamage(r.me, mage, 5, false, 'physical', 'Tap', 'hit', true);
    expect(has(mage, WILDHEART_TOADED)).toBe(false);
  });

  it('lasts 6 s on heroic', () => {
    const { r, mage, caller } = hex('heroic');
    run(r, 2.1, [caller]);
    expect(mage.auras.find((a) => a.id === WILDHEART_TOADED)?.duration).toBe(6);
  });

  it('a kick stops it', () => {
    const { r, mage, caller } = hex('normal');
    r.sim.ctx.cancelCast(caller);
    run(r, 2.1, [caller]);
    expect(has(mage, WILDHEART_TOADED)).toBe(false);
  });
});

describe('the Sunbone Dread Totem: Rattling Dread', () => {
  function dread(difficulty: 'normal' | 'heroic') {
    const r = room(difficulty);
    const binder = engage(r, 'sunbone_totem_binder', 20, 0);
    const near = addPlayer(r, 'mage', 0, 4);
    const far = addPlayer(r, 'priest', 0, -12);
    const totem = engage(r, 'sunbone_dread_totem', 0, 0);
    binder.summonedIds.push(totem.id);
    totem.summonedAdd = true;
    only(r, totem, 'dread');
    run(r, DT, [binder, totem]);
    expect(totem.castingAbility).toBe(WILDHEART_RATTLING_DREAD);
    return { r, binder, totem, near, far };
  }

  it('everyone within 8 yd flees straight away from it for 2 s; the rest stay', () => {
    const { r, binder, totem, near, far } = dread('normal');
    run(r, 2.1, [binder, totem]);
    const fear = near.auras.find((a) => a.id === SHARED_FEAR_AURA_ID);
    expect([fear?.kind, fear?.duration, fear?.breaksOnDamage]).toEqual(['incapacitate', 2, true]);
    expect(fear?.value).toBeCloseTo(angleTo(totem.pos, near.pos), 6);
    // I stand on it, and I flee too: the tank holds the pack away from it.
    expect(has(r.me, SHARED_FEAR_AURA_ID)).toBe(true);
    expect(has(far, SHARED_FEAR_AURA_ID)).toBe(false);
  });

  it('3 s on heroic', () => {
    const { r, binder, totem, near } = dread('heroic');
    run(r, 2.1, [binder, totem]);
    expect(near.auras.find((a) => a.id === SHARED_FEAR_AURA_ID)?.duration).toBe(3);
  });

  it('crumbles with its binder', () => {
    const { r, binder, totem } = dread('normal');
    r.sim.ctx.handleDeath(binder, r.me);
    run(r, 2 * DT, [totem]);
    expect(totem.dead).toBe(true);
  });
});

describe('Snaring Tongue: step out of the lane, or be reeled in', () => {
  function tongue() {
    const r = room();
    const toad = engage(r, 'spore_toad', 0, 0);
    const caught = addPlayer(r, 'mage', 0, -14);
    only(r, toad, 'tongue');
    run(r, DT, [toad]);
    expect(toad.castingAbility).toBe(WILDHEART_SNARING_TONGUE);
    expect(toad.castTargetId).toBe(caught.id);
    return { r, toad, caught };
  }

  it('strikes whoever stands in the lane and reels them to its mouth', () => {
    const { r, toad, caught } = tongue();
    run(r, 1.5, [toad]);
    expect(hitsOn(r, caught.id, 'Snaring Tongue')).toHaveLength(1);
    run(r, 1, [toad]);
    const d = Math.hypot(caught.pos.x - toad.pos.x, caught.pos.z - toad.pos.z);
    expect(d).toBeLessThan(3);
  });

  it('the toad plants for the bar: the lane lands where it was drawn', () => {
    const { r, toad } = tongue();
    const at = { ...toad.pos };
    // The mob AI would walk it; the kit's area hold puts it back each tick.
    for (let i = 0; i < 10; i++) {
      toad.pos = r.sim.ctx.groundPos(toad.pos.x + 0.5, toad.pos.z);
      tickTrashKits(r.sim.ctx);
    }
    expect(Math.hypot(toad.pos.x - at.x, toad.pos.z - at.z)).toBeLessThan(1e-6);
  });

  it('two toads tugging one player let go once a lane has had time to reel', () => {
    const r = room();
    const a = engage(r, 'spore_toad', 0, 12);
    const b = engage(r, 'spore_toad', 0, -12);
    const def = MOBS.spore_toad.trashKit?.wildheart?.tongue;
    if (!def) throw new Error('tongue');
    run(r, DT, [a, b]);
    for (const t of [a, b]) {
      const st = t.trashKit;
      if (!st) throw new Error('kit');
      st.wildheart = { reels: [{ id: r.me.id, left: def.length / def.reel + 0.25 }] };
    }
    run(r, def.length / def.reel + 0.4, [a, b]);
    expect(a.trashKit?.wildheart?.reels).toBeUndefined();
    expect(b.trashKit?.wildheart?.reels).toBeUndefined();
    const at = { ...r.me.pos };
    run(r, 0.5, [a, b]);
    expect(r.me.pos).toEqual(at);
  });

  it('a sidestep out of the locked lane escapes it', () => {
    const { r, toad, caught } = tongue();
    run(r, 0.5, [toad]);
    caught.pos = r.sim.ctx.groundPos(caught.pos.x + 5, caught.pos.z);
    const at = { ...caught.pos };
    run(r, 1.5, [toad]);
    expect(hitsOn(r, caught.id, 'Snaring Tongue')).toHaveLength(0);
    expect(caught.pos).toEqual(at);
  });
});

describe('Snarlbark: the lasher pricks its melee', () => {
  function pricks(difficulty: 'normal' | 'heroic'): number[] {
    const r = room(difficulty);
    const lasher = engage(r, 'vine_lasher', 2, 0);
    lasher.maxHp = 1e7;
    lasher.hp = 1e7;
    for (let i = 0; i < 40; i++) meleeSwing(r.sim.ctx, r.me, lasher, 0, null, {});
    r.events.push(...r.sim.drainEvents());
    return hitsOn(r, r.me.id, 'Snarlbark');
  }

  it('10 a landed swing on normal, three times that on heroic', () => {
    const normal = pricks('normal');
    expect(normal.length).toBeGreaterThan(5);
    expect(new Set(normal)).toEqual(new Set([10]));
    const heroic = pricks('heroic');
    expect(heroic.length).toBeGreaterThan(5);
    expect(Math.min(...heroic)).toBeGreaterThan(10);
  });
});

describe('determinism', () => {
  function trace(seed: number): string {
    const r = room('heroic', seed);
    addPlayer(r, 'mage', -12, 0);
    addPlayer(r, 'priest', 0, -14);
    const mobs = [
      engage(r, 'wildheart_stalker', 10, 4),
      engage(r, 'basin_raptor', 4, 0),
      engage(r, 'basin_raptor', 4, 3),
      engage(r, 'wildheart_ravager', 6, -6),
      engage(r, 'wildheart_hexcaller', 8, 0),
      engage(r, 'sunbone_totem_binder', 12, -3),
      engage(r, 'spore_toad', 0, 6),
    ];
    mobs[3].hp = Math.floor(mobs[3].maxHp * 0.25);
    run(r, 20, mobs);
    return JSON.stringify(
      r.events.filter((e) => e.type === 'damage' || e.type === 'spellfx' || e.type === 'aura'),
    );
  }

  it('the same seed plays the same pull', () => {
    expect(trace(11)).toBe(trace(11));
  });
});
