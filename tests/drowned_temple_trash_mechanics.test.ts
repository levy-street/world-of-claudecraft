// The Drowned Temple trash mechanics pass (the Temple's own kit block,
// MobTemplate.trashKit.temple, run by src/sim/mob/trash_kit/temple_extension.ts
// through temple_choir.ts and temple_tide.ts): the Shrine Vigil the pilgrims
// keep round their singer, the heroic Moonset Oath, the heroic Lullaby Echo,
// the Lurker's Prism Glare, the Snapper's Spiral Whirlpool, the Eel's Arcing
// Spark, the Tidewisp's chill and its heroic Swollen Tide. Each is driven
// through tickTrashKits inside a real claimed Temple: the trigger, the
// counterplay, normal against heroic, and the same world from the same seed.

import { describe, expect, it } from 'vitest';
import { DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { applyDungeonMobTuning } from '../src/sim/instances/difficulty';
import { claimedInstanceAt } from '../src/sim/instances/dungeons';
import { SCRIPTED_INTERRUPTIBLE_CHANNELS } from '../src/sim/mob/healer_channel';
import { tickTrashKits } from '../src/sim/mob/trash_kit';
import { TRASH_WITHDRAW_AURA } from '../src/sim/mob/trash_kit/support';
import {
  TEMPLE_ARCING_SPARK,
  TEMPLE_LULLABY,
  TEMPLE_LULLABY_ECHO,
  TEMPLE_LULLABY_SLEEP,
  TEMPLE_MOONSET_OATH,
  TEMPLE_OATH_KEEPER,
  TEMPLE_PRISM_DAZZLE,
  TEMPLE_PRISM_GLARE,
  TEMPLE_PRISM_STUMBLE,
  TEMPLE_SHRINE_VIGIL,
  TEMPLE_SPIRAL_WHIRLPOOL,
  TEMPLE_SWOLLEN_TIDE,
  TEMPLE_TIDEWISP_CHILL,
  TEMPLE_VIGIL_PRAYER,
} from '../src/sim/mob/trash_kit/temple_cast_ids';
import { facesToward, sparkChain, swellOf } from '../src/sim/mob/trash_kit/temple_tide';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type SimEvent } from '../src/sim/types';

interface Room {
  sim: Sim;
  inst: InstanceSlot;
  me: Entity;
  events: SimEvent[];
}

function room(difficulty: 'normal' | 'heroic' = 'normal', seed = 93): Room {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.chat(`/dev temple enter ${difficulty}`, sim.player.id);
  const inst = claimedInstanceAt(sim.ctx, sim.player.pos);
  if (!inst) throw new Error('no temple claim');
  const me = sim.player;
  me.maxHp = 1e6;
  me.hp = 1e6;
  const o = instanceOrigin(DUNGEONS.drowned_temple.index, inst.slot);
  // The Choir Court's stage, clear of every pack: a quiet test bench.
  me.pos = sim.ctx.groundPos(o.x, o.z - 12);
  me.prevPos = { ...me.pos };
  sim.drainEvents();
  return { sim, inst, me, events: [] };
}

function engage(r: Room, templateId: string, dx = 6, dz = 0): Entity {
  const mob = createMob(r.sim.ctx.nextId++, MOBS[templateId], MOBS[templateId].minLevel, {
    ...r.sim.ctx.groundPos(r.me.pos.x + dx, r.me.pos.z + dz),
  });
  applyDungeonMobTuning(mob, 'drowned_temple', r.inst.difficulty);
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
  const pid = r.sim.addPlayer(cls, `T${cls}${dx}${dz}`);
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

/** A big arcane hit from me on `target` (no armor step), returning the
 *  health it lost. */
function strike(r: Room, target: Entity, amount = 1000): number {
  // A deep pool, so the whole hit always fits.
  if (target.maxHp < 1e5) {
    target.maxHp = 1e5;
    target.hp = 1e5;
  }
  const before = target.hp;
  r.sim.ctx.dealDamage(r.me, target, amount, false, 'arcane', 'Test Strike', 'hit', true);
  return before - target.hp;
}

describe('Temple trash mechanics: the content', () => {
  it('authors every new key on the right template', () => {
    expect(MOBS.pale_choir_acolyte.trashKit?.temple?.vigil?.guardian).toBe('drowned_pilgrim');
    expect(MOBS.moonlit_siren.trashKit?.temple?.vigil?.guardian).toBe('drowned_pilgrim');
    expect(MOBS.pale_choir_acolyte.trashKit?.temple?.lullabyEcho?.radius).toBe(5);
    expect(MOBS.drowned_templeguard.trashKit?.temple?.guard?.share).toBe(0.5);
    expect(MOBS.glimmerscale_lurker.trashKit?.temple?.gaze?.castId).toBe(TEMPLE_PRISM_GLARE);
    expect(MOBS.lagoon_snapper.trashKit?.temple?.whirlpool?.radius).toBe(8);
    expect(MOBS.ice_wraith.trashKit?.temple?.spark?.castId).toBe(TEMPLE_ARCING_SPARK);
    expect(MOBS.tidewisp.trashKit?.detonate?.slow).toEqual({ mult: 0.5, seconds: 2 });
    expect(MOBS.tidewisp.trashKit?.temple?.merge?.max).toBe(2);
  });

  it('kicks the Arcing Spark; the Prism Glare is no kick (turn your back)', () => {
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[TEMPLE_ARCING_SPARK]?.school).toBe('nature');
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[TEMPLE_PRISM_GLARE]).toBeUndefined();
  });
});

describe('Shrine Vigil: the pilgrims ward their singer', () => {
  it('two kneeling pilgrims turn 75 percent of her damage; one dead and it falls', () => {
    const r = room();
    const acolyte = engage(r, 'pale_choir_acolyte', 8, 0);
    const a = engage(r, 'drowned_pilgrim', 10, 3);
    const b = engage(r, 'drowned_pilgrim', 10, -3);
    run(r, DT, [acolyte, a, b]);
    expect(has(acolyte, TEMPLE_SHRINE_VIGIL)).toBe(true);
    expect(has(a, TEMPLE_VIGIL_PRAYER) && has(b, TEMPLE_VIGIL_PRAYER)).toBe(true);
    expect(strike(r, acolyte)).toBe(250);
    // The prayer is a bare marker: it never reads as a slow or a chill.
    expect(a.auras.find((x) => x.id === TEMPLE_VIGIL_PRAYER)?.kind).toBe('internal_cd');
    r.sim.ctx.handleDeath(b, r.me);
    run(r, 2 * DT, [acolyte, a]);
    expect(has(acolyte, TEMPLE_SHRINE_VIGIL)).toBe(false);
    expect(strike(r, acolyte)).toBe(1000);
  });

  it('a pilgrim beyond 15 yd keeps no vigil; the siren wears it too', () => {
    const r = room();
    const siren = engage(r, 'moonlit_siren', 8, 0);
    const near = engage(r, 'drowned_pilgrim', 10, 3);
    const far = engage(r, 'drowned_pilgrim', 8, 20);
    run(r, DT, [siren, near, far]);
    expect(has(siren, TEMPLE_SHRINE_VIGIL)).toBe(false);
    far.pos = r.sim.ctx.groundPos(siren.pos.x + 2, siren.pos.z - 4);
    run(r, DT, [siren, near, far]);
    expect(has(siren, TEMPLE_SHRINE_VIGIL)).toBe(true);
  });

  it('heroic turns 85 percent', () => {
    const r = room('heroic');
    const acolyte = engage(r, 'pale_choir_acolyte', 8, 0);
    const a = engage(r, 'drowned_pilgrim', 10, 3);
    const b = engage(r, 'drowned_pilgrim', 10, -3);
    run(r, DT, [acolyte, a, b]);
    expect(strike(r, acolyte)).toBe(150);
  });
});

describe('Moonset Oath (heroic): the stair guard shields a casting singer', () => {
  function setup(difficulty: 'normal' | 'heroic', guardDx = 10) {
    const r = room(difficulty);
    const acolyte = engage(r, 'pale_choir_acolyte', 8, 0);
    const guard = engage(r, 'drowned_templeguard', guardDx, 2);
    // Her Lullaby bar opens on its first beat.
    const first = MOBS.pale_choir_acolyte.trashKit?.lullaby?.first ?? 5;
    const mage = addPlayer(r, 'mage', -12, 0);
    run(r, first + 0.1, [acolyte, guard]);
    return { r, acolyte, guard, mage };
  }

  it('on heroic the guard takes half of every hit she takes while she casts', () => {
    const { r, acolyte, guard } = setup('heroic');
    expect(acolyte.castingAbility).not.toBeNull();
    run(r, DT, [acolyte, guard]);
    expect(has(acolyte, TEMPLE_MOONSET_OATH)).toBe(true);
    expect(has(guard, TEMPLE_OATH_KEEPER)).toBe(true);
    const guardBefore = guard.hp;
    expect(strike(r, acolyte)).toBe(500);
    expect(guardBefore - guard.hp).toBeGreaterThan(0);
  });

  it('never on normal', () => {
    const { r, acolyte, guard } = setup('normal');
    expect(acolyte.castingAbility).not.toBeNull();
    run(r, DT, [acolyte, guard]);
    expect(has(acolyte, TEMPLE_MOONSET_OATH)).toBe(false);
    expect(strike(r, acolyte)).toBe(1000);
  });

  it('a stunned guard, or one pulled beyond 8 yd, keeps no oath', () => {
    const { r, acolyte, guard } = setup('heroic');
    r.sim.ctx.applyAura(guard, {
      id: 'test_stun',
      name: 'Test Stun',
      kind: 'stun',
      remaining: 5,
      duration: 5,
      value: 0,
      sourceId: r.me.id,
      school: 'physical',
    });
    run(r, 3 * DT, [acolyte, guard]);
    expect(has(acolyte, TEMPLE_MOONSET_OATH)).toBe(false);
    expect(strike(r, acolyte)).toBe(1000);
    guard.auras = guard.auras.filter((a) => a.id !== 'test_stun');
    guard.pos = r.sim.ctx.groundPos(acolyte.pos.x + 12, acolyte.pos.z);
    run(r, 3 * DT, [acolyte, guard]);
    expect(has(acolyte, TEMPLE_MOONSET_OATH)).toBe(false);
  });

  it('an idle singer (no bar) is never sheltered', () => {
    const r = room('heroic');
    const acolyte = engage(r, 'pale_choir_acolyte', 8, 0);
    const guard = engage(r, 'drowned_templeguard', 10, 2);
    run(r, 1, [acolyte, guard]);
    expect(acolyte.castingAbility).toBeNull();
    expect(has(acolyte, TEMPLE_MOONSET_OATH)).toBe(false);
  });
});

describe('Lullaby Echo (heroic): the sleep spreads off its sleeper', () => {
  function sing(difficulty: 'normal' | 'heroic') {
    const r = room(difficulty);
    const acolyte = engage(r, 'pale_choir_acolyte', 8, 0);
    // The tank is me; the song goes to the mage (the only one past the tank).
    const mage = addPlayer(r, 'mage', -10, 0);
    const def = MOBS.pale_choir_acolyte.trashKit?.lullaby;
    if (!def) throw new Error('lullaby');
    run(r, def.first + 0.05, [acolyte]);
    expect(acolyte.castingAbility).toBe(TEMPLE_LULLABY);
    expect(acolyte.castTargetId).toBe(mage.id);
    return { r, acolyte, mage, def };
  }

  it('on heroic a beat after it lands everyone within 5 yd of the sleeper falls asleep', () => {
    const { r, acolyte, mage, def } = sing('heroic');
    const near = addPlayer(r, 'priest', -10, 3);
    const far = addPlayer(r, 'warrior', -10, 9);
    run(r, def.castTime + 0.05, [acolyte]);
    expect(has(mage, TEMPLE_LULLABY_SLEEP)).toBe(true);
    expect(has(mage, TEMPLE_LULLABY_ECHO)).toBe(true);
    expect(has(near, TEMPLE_LULLABY_SLEEP)).toBe(false);
    run(r, 1.05, [acolyte]);
    expect(has(near, TEMPLE_LULLABY_SLEEP)).toBe(true);
    expect(has(far, TEMPLE_LULLABY_SLEEP)).toBe(false);
  });

  it('never echoes on normal', () => {
    const { r, acolyte, mage, def } = sing('normal');
    const near = addPlayer(r, 'priest', -10, 3);
    run(r, def.castTime + 1.5, [acolyte]);
    expect(has(mage, TEMPLE_LULLABY_SLEEP)).toBe(true);
    expect(has(mage, TEMPLE_LULLABY_ECHO)).toBe(false);
    expect(has(near, TEMPLE_LULLABY_SLEEP)).toBe(false);
  });

  it('a kicked song never echoes; a woken sleeper ends the echo', () => {
    const kicked = sing('heroic');
    const near = addPlayer(kicked.r, 'priest', -10, 3);
    kicked.r.sim.ctx.cancelCast(kicked.acolyte);
    run(kicked.r, kicked.def.castTime + 1.5, [kicked.acolyte]);
    expect(has(kicked.mage, TEMPLE_LULLABY_SLEEP)).toBe(false);
    expect(has(near, TEMPLE_LULLABY_SLEEP)).toBe(false);

    const woken = sing('heroic');
    const near2 = addPlayer(woken.r, 'priest', -10, 3);
    run(woken.r, woken.def.castTime + 0.05, [woken.acolyte]);
    // A tap wakes the sleeper before the echo's first beat.
    woken.r.sim.ctx.dealDamage(woken.r.me, woken.mage, 5, false, 'physical', 'Tap', 'hit', true);
    expect(has(woken.mage, TEMPLE_LULLABY_SLEEP)).toBe(false);
    run(woken.r, 1.5, [woken.acolyte]);
    expect(has(woken.mage, TEMPLE_LULLABY_ECHO)).toBe(false);
    expect(has(near2, TEMPLE_LULLABY_SLEEP)).toBe(false);
  });
});

describe('Prism Glare: turn your back on the lurker', () => {
  it('reads a front arc of 60 degrees either side', () => {
    const r = room();
    const lurker = engage(r, 'glimmerscale_lurker', 0, 10);
    r.me.facing = 0; // +z: toward the lurker
    expect(facesToward(r.me, lurker, 60)).toBe(true);
    r.me.facing = Math.PI;
    expect(facesToward(r.me, lurker, 60)).toBe(false);
    r.me.facing = Math.PI / 2;
    expect(facesToward(r.me, lurker, 60)).toBe(false);
  });

  function glare(difficulty: 'normal' | 'heroic') {
    const r = room(difficulty);
    const lurker = engage(r, 'glimmerscale_lurker', 0, 10);
    const st = () => lurker.trashKit;
    const facer = addPlayer(r, 'mage', 4, 0);
    const turned = addPlayer(r, 'priest', -4, 0);
    const def = MOBS.glimmerscale_lurker.trashKit?.temple?.gaze;
    if (!def) throw new Error('gaze');
    run(r, DT, [lurker]);
    const kit = st();
    if (!kit) throw new Error('kit');
    // Keep its leap and bolt out of the way: only the gaze is on the clock.
    kit.timers.leap = 99;
    kit.timers.bolt = 99;
    kit.timers.gaze = 0;
    run(r, DT, [lurker]);
    expect(lurker.castingAbility).toBe(TEMPLE_PRISM_GLARE);
    return { r, lurker, facer, turned, def };
  }

  it('dazzles whoever faces it when the bar ends, never whoever turned away', () => {
    const { r, lurker, facer, turned, def } = glare('normal');
    run(r, def.castTime - 0.2, [lurker]);
    facer.facing = Math.atan2(lurker.pos.x - facer.pos.x, lurker.pos.z - facer.pos.z);
    // Back to the lurker: facing straight away from it.
    turned.facing = Math.atan2(turned.pos.x - lurker.pos.x, turned.pos.z - lurker.pos.z);
    run(r, 0.3, [lurker]);
    expect(has(facer, TEMPLE_PRISM_DAZZLE)).toBe(true);
    expect(has(facer, TEMPLE_PRISM_STUMBLE)).toBe(true);
    expect(facer.auras.find((a) => a.id === TEMPLE_PRISM_DAZZLE)?.duration).toBe(3);
    expect(hitsOn(r, facer.id, 'Prism Glare')).toHaveLength(1);
    expect(has(turned, TEMPLE_PRISM_DAZZLE)).toBe(false);
    expect(hitsOn(r, turned.id, 'Prism Glare')).toHaveLength(0);
  });

  it('dazzles for 4 s on heroic', () => {
    const { r, lurker, facer, def } = glare('heroic');
    facer.facing = Math.atan2(lurker.pos.x - facer.pos.x, lurker.pos.z - facer.pos.z);
    run(r, def.castTime + 0.1, [lurker]);
    expect(facer.auras.find((a) => a.id === TEMPLE_PRISM_DAZZLE)?.duration).toBe(4);
  });

  it('a stun breaks the bar', () => {
    const { r, lurker, facer, def } = glare('normal');
    facer.facing = Math.atan2(lurker.pos.x - facer.pos.x, lurker.pos.z - facer.pos.z);
    r.sim.ctx.applyAura(lurker, {
      id: 'test_stun',
      name: 'Test Stun',
      kind: 'stun',
      remaining: 3,
      duration: 3,
      value: 0,
      sourceId: r.me.id,
      school: 'physical',
    });
    run(r, def.castTime + 0.1, [lurker]);
    expect(has(facer, TEMPLE_PRISM_DAZZLE)).toBe(false);
  });
});

describe('Spiral Whirlpool: walk out of the shell spin', () => {
  function shell(difficulty: 'normal' | 'heroic') {
    const r = room(difficulty);
    const snapper = engage(r, 'lagoon_snapper', 0, 10);
    snapper.hp = Math.floor(snapper.maxHp * 0.3);
    const ringer = addPlayer(r, 'mage', 0, 4); // 6 yd off the shell
    const core = addPlayer(r, 'priest', 1, 10); // 1 yd off it
    const clear = addPlayer(r, 'warrior', 0, -4); // 14 yd off it
    run(r, 2 * DT, [snapper]);
    return { r, snapper, ringer, core, clear };
  }

  it('drags the ring in, bites the core each second, leaves the rest alone', () => {
    const { r, snapper, ringer, core, clear } = shell('normal');
    expect(has(snapper, TEMPLE_SPIRAL_WHIRLPOOL)).toBe(true);
    const d0 = Math.hypot(ringer.pos.x - snapper.pos.x, ringer.pos.z - snapper.pos.z);
    const c0 = { ...clear.pos };
    run(r, 1, [snapper]);
    const d1 = Math.hypot(ringer.pos.x - snapper.pos.x, ringer.pos.z - snapper.pos.z);
    expect(d0 - d1).toBeGreaterThan(2);
    expect(d0 - d1).toBeLessThan(3);
    expect(clear.pos).toEqual(c0);
    expect(hitsOn(r, core.id, 'Spiral Whirlpool').length).toBeGreaterThanOrEqual(1);
    expect(hitsOn(r, clear.id, 'Spiral Whirlpool')).toHaveLength(0);
    // The spin stops the tick the shell opens (the harness never ages
    // auras, so the shell is lifted by hand).
    snapper.auras = snapper.auras.filter((a) => a.id !== TRASH_WITHDRAW_AURA);
    run(r, DT, [snapper]);
    expect(has(snapper, TEMPLE_SPIRAL_WHIRLPOOL)).toBe(false);
  });

  it('pulls harder on heroic, still slower than a run', () => {
    const { r, snapper, ringer } = shell('heroic');
    const d0 = Math.hypot(ringer.pos.x - snapper.pos.x, ringer.pos.z - snapper.pos.z);
    run(r, 1, [snapper]);
    const d1 = Math.hypot(ringer.pos.x - snapper.pos.x, ringer.pos.z - snapper.pos.z);
    expect(d0 - d1).toBeGreaterThan(3);
    expect(d0 - d1).toBeLessThan(7);
  });
});

describe('Arcing Spark: the lightning leaps through a bunched group', () => {
  it('picks the chain nearest first, up to four, within 6 yd hops', () => {
    const r = room();
    const a = addPlayer(r, 'mage', 0, 0);
    const b = addPlayer(r, 'priest', 4, 0);
    const c = addPlayer(r, 'warrior', 8, 0);
    const d = addPlayer(r, 'mage', 20, 0);
    expect(sparkChain(a, [a, b, c, d], 6, 4).map((p) => p.id)).toEqual([a.id, b.id, c.id]);
  });

  function spark(spread: number) {
    const r = room();
    const eel = engage(r, 'ice_wraith', 0, 12);
    const players = [r.me, ...[1, 2, 3].map((k) => addPlayer(r, 'mage', k * spread, 0))];
    run(r, DT, [eel]);
    const kit = eel.trashKit;
    if (!kit) throw new Error('kit');
    kit.timers.screech = 99;
    kit.timers.line = 99;
    kit.timers.spark = 0;
    run(r, DT, [eel]);
    expect(eel.castingAbility).toBe(TEMPLE_ARCING_SPARK);
    return { r, eel, players };
  }

  it('bunched within 6 yd, every one of them is struck', () => {
    // 2 yd apart: from any first victim the leaps reach all four.
    const { r, eel, players } = spark(2);
    run(r, 2.1, [eel]);
    for (const p of players) expect(hitsOn(r, p.id, 'Arcing Spark'), `${p.id}`).toHaveLength(1);
  });

  it('spread out, only the first is struck', () => {
    const { r, eel, players } = spark(9);
    run(r, 2.1, [eel]);
    const struck = players.filter((p) => hitsOn(r, p.id, 'Arcing Spark').length > 0);
    expect(struck).toHaveLength(1);
  });

  it('a kick stops it', () => {
    const { r, eel, players } = spark(2);
    r.sim.ctx.cancelCast(eel);
    run(r, 2.1, [eel]);
    for (const p of players) expect(hitsOn(r, p.id, 'Arcing Spark')).toHaveLength(0);
  });
});

describe('the Tidewisp: a chilling burst, and the heroic Swollen Tide', () => {
  it('its burst chills whoever it catches: half speed for 2 s', () => {
    const r = room();
    const wisp = engage(r, 'tidewisp', 1.5, 0);
    run(r, 2 * DT, [wisp]);
    const chill = r.me.auras.find((a) => a.id === TEMPLE_TIDEWISP_CHILL);
    expect(chill?.kind).toBe('slow');
    expect([chill?.value, chill?.duration]).toEqual([0.5, 2]);
  });

  it('the live mob AI closes a wisp on a standing player until it bursts', () => {
    const r = room();
    const wisp = engage(r, 'tidewisp', 6, 0);
    r.sim.aggroMob(wisp, r.me, false);
    let burst = false;
    for (let i = 0; i < 20 * 4 && !burst; i++) {
      r.sim.tick();
      r.events.push(...r.sim.drainEvents());
      burst = !r.sim.ctx.entities.has(wisp.id);
    }
    expect(burst).toBe(true);
    // It burst on reaching me (its chill is the burst's mark), never by
    // dying to a swing.
    expect(wisp.dead).toBe(false);
    expect(r.me.auras.some((a) => a.id === TEMPLE_TIDEWISP_CHILL)).toBe(true);
  });

  it('two wisps that touch merge on heroic: pooled health, one swell, a wider burst', () => {
    const r = room('heroic');
    const a = engage(r, 'tidewisp', 8, 0);
    const b = engage(r, 'tidewisp', 8.8, 0);
    const pooled = a.maxHp + b.maxHp;
    run(r, DT, [a, b]);
    expect(r.sim.ctx.entities.has(b.id)).toBe(false);
    expect(a.maxHp).toBe(pooled);
    expect(swellOf(a)).toBe(1);
    expect(has(a, TEMPLE_SWOLLEN_TIDE)).toBe(true);
    // Its burst reaches 4 yd now (3 + 1): a bystander at 3.6 yd is caught.
    const near = addPlayer(r, 'mage', 0, 3.6);
    a.pos = r.sim.ctx.groundPos(r.me.pos.x + 1.5, r.me.pos.z);
    run(r, 2 * DT, [a]);
    expect(hitsOn(r, near.id, 'Tidewisp Burst')).toHaveLength(1);
  });

  it('never merges on normal', () => {
    const r = room('normal');
    const a = engage(r, 'tidewisp', 8, 0);
    const b = engage(r, 'tidewisp', 8.8, 0);
    run(r, DT, [a, b]);
    expect(r.sim.ctx.entities.has(b.id)).toBe(true);
    expect(swellOf(a)).toBe(0);
  });
});

describe('determinism', () => {
  function trace(seed: number): string {
    const r = room('heroic', seed);
    const mobs = [
      engage(r, 'pale_choir_acolyte', 8, 0),
      engage(r, 'drowned_pilgrim', 10, 3),
      engage(r, 'drowned_pilgrim', 10, -3),
      engage(r, 'drowned_templeguard', 9, 4),
      engage(r, 'glimmerscale_lurker', -6, 8),
      engage(r, 'ice_wraith', 6, 12),
      engage(r, 'lagoon_snapper', -4, -6),
    ];
    addPlayer(r, 'mage', -10, 0);
    addPlayer(r, 'priest', -8, 3);
    mobs[6].hp = Math.floor(mobs[6].maxHp * 0.3);
    run(r, 20, mobs);
    return JSON.stringify(
      r.events.filter((e) => e.type === 'damage' || e.type === 'spellfx' || e.type === 'aura'),
    );
  }

  it('the same seed plays the same pull', () => {
    expect(trace(7)).toBe(trace(7));
  });
});
