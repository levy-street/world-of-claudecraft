// #96 — players must not damage or hostile-CC each other outside an accepted
// duel/PvP. These lock the invariant so the "killed in the starter village /
// polymorphed into a baby llama" griefing path can never regress.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Entity, Vec3 } from '../src/sim/types';
import { dist2d } from '../src/sim/types';

function twoPlayers(clsA = 'mage', clsB = 'warrior') {
  const sim = new Sim({
    seed: 42,
    playerClass: clsA as any,
    playerName: 'Caster',
    autoEquip: true,
  });
  const aPid = sim.primaryId;
  const bPid = sim.addPlayer(clsB as any, 'Victim', { autoEquip: true });
  const a = sim.entities.get(aPid)!;
  const b = sim.entities.get(bPid)!;
  // stand them next to each other and face A at B
  b.pos = { ...a.pos, x: a.pos.x + 3 };
  b.prevPos = { ...b.pos };
  a.facing = Math.atan2(b.pos.x - a.pos.x, b.pos.z - a.pos.z);
  sim.setPlayerLevel(12, aPid);
  sim.setPlayerLevel(12, bPid);
  return { sim, aPid, bPid, a, b };
}

function startDuel(clsA = 'mage', clsB = 'warrior', level = 20) {
  const setup = twoPlayers(clsA, clsB);
  const { sim, aPid, bPid, a, b } = setup;
  sim.setPlayerLevel(level, aPid);
  sim.setPlayerLevel(level, bPid);
  a.resource = a.maxResource;
  a.facing = Math.atan2(b.pos.x - a.pos.x, b.pos.z - a.pos.z);
  sim.duelRequest(bPid, aPid);
  sim.duelAccept(bPid);
  for (let i = 0; i < 20 * 5; i++) {
    sim.tick();
    if (sim.duelFor(aPid)?.state === 'active') break;
  }
  sim.targetEntity(bPid, aPid);
  return setup;
}

function finishCast(sim: Sim, pid: number) {
  for (let i = 0; i < 20 * 4; i++) {
    sim.tick();
    if (!sim.entities.get(pid)!.castingAbility) break;
  }
  // A spell's effects now land when its projectile reaches the target
  // (projectile_travel), a few ticks after the cast bar empties: tick until the
  // in-flight bolt has resolved so the debuff/CC is actually applied.
  for (let i = 0; i < 20 * 3 && (sim as any).pendingProjectiles.length > 0; i++) sim.tick();
}

const pos = (e: Entity): Vec3 => ({ ...e.pos });

const hasCc = (e: Entity) =>
  e.auras.some(
    (au) =>
      au.kind === 'polymorph' ||
      au.kind === 'stun' ||
      au.kind === 'incapacitate' ||
      au.kind === 'root',
  );

describe('PvP safety outside duels (#96)', () => {
  it('a player cannot polymorph another player', () => {
    const { sim, aPid, bPid, b } = twoPlayers('mage', 'warrior');
    sim.targetEntity(bPid, aPid);
    sim.castAbility('polymorph', aPid);
    expect(b.auras.some((au) => au.kind === 'polymorph')).toBe(false);
    expect(hasCc(b)).toBe(false);
  });

  it('a player cannot auto-attack another player', () => {
    const { sim, aPid, bPid, b } = twoPlayers('warrior', 'mage');
    const startHp = b.hp;
    sim.targetEntity(bPid, aPid);
    sim.startAutoAttack(aPid);
    for (let i = 0; i < 20 * 4; i++) sim.tick();
    expect(b.hp).toBe(startHp); // never took a hit
  });

  it('a player AoE (Frost Nova) does not root or damage a nearby player', () => {
    const { sim, aPid, b } = twoPlayers('mage', 'warrior');
    const startHp = b.hp;
    sim.castAbility('frost_nova', aPid); // self-centred AoE root, B is 3yd away
    for (let i = 0; i < 5; i++) sim.tick();
    expect(b.hp).toBe(startHp);
    expect(hasCc(b)).toBe(false);
  });

  it('an accepted duel DOES allow combat between the two players (positive control)', () => {
    const { sim, aPid, bPid, a, b } = twoPlayers('warrior', 'mage');
    sim.duelRequest(bPid, aPid);
    sim.duelAccept(bPid);
    // run out the countdown so the duel goes active
    for (let i = 0; i < 20 * 5; i++) sim.tick();
    const duel = sim.duelFor(aPid);
    expect(duel?.state).toBe('active');
    const startHp = b.hp;
    a.facing = Math.atan2(b.pos.x - a.pos.x, b.pos.z - a.pos.z);
    sim.targetEntity(bPid, aPid);
    sim.startAutoAttack(aPid);
    for (let i = 0; i < 20 * 6; i++) sim.tick();
    expect(b.hp).toBeLessThan(startHp); // duel combat works
  });
});

describe('PvP control abilities in active duels', () => {
  it.each([
    { cls: 'mage', ability: 'polymorph', aura: 'polymorph' },
    { cls: 'warlock', ability: 'fear', aura: 'incapacitate' },
    { cls: 'paladin', ability: 'hammer_of_justice', aura: 'stun' },
    { cls: 'druid', ability: 'entangling_roots', aura: 'root' },
  ])('$ability works on hostile players', ({ cls, ability, aura }) => {
    const { sim, aPid, b } = startDuel(cls, 'warrior');
    if (ability === 'polymorph') b.hp = Math.max(1, b.maxHp - 120);

    sim.castAbility(ability, aPid);
    finishCast(sim, aPid);

    expect(b.auras.some((au) => au.kind === aura)).toBe(true);
    if (ability === 'polymorph') expect(b.hp).toBe(b.maxHp);
  });

  it('does not polymorph non-hostile NPCs', () => {
    const sim = new Sim({ seed: 42, playerClass: 'mage', playerName: 'Caster', autoEquip: true });
    const npc = [...sim.entities.values()].find((e) => e.kind === 'npc');
    expect(npc).toBeDefined();
    sim.setPlayerLevel(20);
    sim.player.resource = sim.player.maxResource;
    sim.targetEntity(npc!.id);

    sim.castAbility('polymorph');
    finishCast(sim, sim.primaryId);

    expect(npc!.auras.some((au) => au.kind === 'polymorph')).toBe(false);
  });

  it('diminishes repeated duel Polymorphs to 10s, 5s, 1s and resets after 60s', () => {
    const { sim, aPid, b } = startDuel('mage', 'warrior', 20);

    // Polymorph is now a projectile whose hit roll happens on impact, so it can miss.
    // A miss does not consume a diminishing-returns stage (that only advances on a
    // landed application), so retry until the bolt connects to measure the DR ladder.
    const castPolymorph = () => {
      const mage = sim.entities.get(aPid)!;
      for (let attempt = 0; attempt < 12; attempt++) {
        b.auras = b.auras.filter((aura) => aura.kind !== 'polymorph');
        mage.gcdRemaining = 0;
        mage.cooldowns.delete('polymorph');
        mage.resource = mage.maxResource;
        sim.castAbility('polymorph', aPid);
        finishCast(sim, aPid);
        const applied = b.auras.find((aura) => aura.kind === 'polymorph');
        if (applied) return applied.duration;
      }
      return 0;
    };

    expect(castPolymorph()).toBe(10);
    expect(castPolymorph()).toBe(5);
    expect(castPolymorph()).toBe(1);

    b.auras = b.auras.filter((aura) => aura.kind !== 'polymorph');
    for (let i = 0; i < 20 * 61; i++) sim.tick();

    expect(castPolymorph()).toBe(10);
  });

  it('makes feared hostile players run in a deterministic panic direction', () => {
    const { sim, aPid, b } = startDuel('warlock', 'warrior', 20);

    const start = pos(b);
    sim.castAbility('fear', aPid);
    finishCast(sim, aPid);

    const fear = b.auras.find((aura) => aura.id === 'fear_incap' && aura.kind === 'incapacitate');
    expect(fear?.duration).toBe(8);

    for (let i = 0; i < 20; i++) sim.tick();

    expect(dist2d(start, b.pos)).toBeGreaterThan(2);
    expect(b.auras.some((aura) => aura.id === 'fear_incap')).toBe(true);
  });

  it('diminishes repeated duel Fears to 8s, 4s, 2s, 1s and resets after 60s', () => {
    const { sim, aPid, b } = startDuel('warlock', 'warrior', 20);

    const castFear = () => {
      // A resisted Fear applies nothing and does NOT advance diminishing returns
      // (the spell-hit roll precedes the DR bookkeeping in applyAbility), so retry
      // until it lands. This keeps the 8/4/2/1 sequence stable regardless of where
      // the shared world RNG stream happens to sit (new content shifts it).
      let dur = 0;
      for (let attempt = 0; attempt < 50 && dur === 0; attempt++) {
        b.auras = b.auras.filter((aura) => aura.id !== 'fear_incap');
        const warlock = sim.entities.get(aPid)!;
        warlock.gcdRemaining = 0;
        warlock.resource = warlock.maxResource;
        sim.castAbility('fear', aPid);
        finishCast(sim, aPid);
        dur = b.auras.find((aura) => aura.id === 'fear_incap')?.duration ?? 0;
      }
      return dur;
    };

    expect(castFear()).toBe(8);
    expect(castFear()).toBe(4);
    expect(castFear()).toBe(2);
    expect(castFear()).toBe(1);

    b.auras = b.auras.filter((aura) => aura.id !== 'fear_incap');
    for (let i = 0; i < 20 * 61; i++) sim.tick();

    expect(castFear()).toBe(8);
  });

  it('diminishes repeated duel stuns to full, half, quarter, then immune, resetting after 18s', () => {
    const { sim, aPid, b } = startDuel('paladin', 'warrior', 20);

    // Hammer of Justice at level 20 is rank 2: a 4s instant stun. As with Fear, a
    // resisted stun applies nothing and does NOT advance diminishing returns, so
    // retry until it lands to keep the sequence stable against shared-RNG drift.
    const castStun = () => {
      let dur: number | null = 0;
      for (let attempt = 0; attempt < 50 && dur === 0; attempt++) {
        b.auras = b.auras.filter((aura) => aura.id !== 'hammer_of_justice_stun');
        const pala = sim.entities.get(aPid)!;
        pala.gcdRemaining = 0;
        pala.resource = pala.maxResource;
        pala.cooldowns.delete('hammer_of_justice');
        sim.castAbility('hammer_of_justice', aPid);
        finishCast(sim, aPid);
        dur = b.auras.find((aura) => aura.id === 'hammer_of_justice_stun')?.duration ?? 0;
      }
      return dur;
    };

    expect(castStun()).toBe(4); // 100%
    expect(castStun()).toBe(2); // 50%
    expect(castStun()).toBe(1); // 25%

    // Fourth stun in the window is fully diminished: the target is immune, so no
    // stun aura lands at all (the chain-stun lock is broken).
    b.auras = b.auras.filter((aura) => aura.id !== 'hammer_of_justice_stun');
    const pala = sim.entities.get(aPid)!;
    pala.gcdRemaining = 0;
    pala.resource = pala.maxResource;
    pala.cooldowns.delete('hammer_of_justice');
    sim.castAbility('hammer_of_justice', aPid);
    finishCast(sim, aPid);
    expect(b.auras.some((aura) => aura.id === 'hammer_of_justice_stun')).toBe(false);

    // The category resets after the 18s window, restoring full duration.
    b.auras = b.auras.filter((aura) => aura.id !== 'hammer_of_justice_stun');
    for (let i = 0; i < 20 * 19; i++) sim.tick();
    expect(castStun()).toBe(4);
  });

  it('keeps opener and controlled stuns on independent DR chains (#1004)', () => {
    // Classic-style stun DR is not one bucket: a from-stealth opener (Cheap Shot,
    // Pounce) must not eat into a controlled stun's chain (Kidney Shot, Hammer of
    // Justice). Simulate a fully diminished OPENER chain on the target, then prove a
    // controlled stun still lands at full duration and diminishes only within its
    // own controlled bucket.
    const { sim, aPid, b } = startDuel('paladin', 'warrior', 20);

    // Pretend the target already burned its opener-stun chain to immunity.
    b.ccDr.set('openerStun', { stage: 3, resetAt: sim.time + 18 });

    const castStun = () => {
      let dur = 0;
      for (let attempt = 0; attempt < 50 && dur === 0; attempt++) {
        b.auras = b.auras.filter((aura) => aura.id !== 'hammer_of_justice_stun');
        const pala = sim.entities.get(aPid)!;
        pala.gcdRemaining = 0;
        pala.resource = pala.maxResource;
        pala.cooldowns.delete('hammer_of_justice');
        sim.castAbility('hammer_of_justice', aPid);
        finishCast(sim, aPid);
        dur = b.auras.find((aura) => aura.id === 'hammer_of_justice_stun')?.duration ?? 0;
      }
      return dur;
    };

    // The controlled stun is unaffected by the spent opener chain: full duration,
    // then diminishes only within its own controlled bucket.
    expect(castStun()).toBe(4); // 100%, not diminished by the opener bucket
    expect(castStun()).toBe(2); // 50%
    expect(castStun()).toBe(1); // 25%
  });

  it('does not diminish PvE stuns: a stun on a mob keeps full duration on repeat', () => {
    // DR is duel/PvP only (player source AND player target). A paladin stunning a
    // hostile mob must always land the full 4s, no matter how many times in a row.
    const sim = new Sim({
      seed: 7,
      playerClass: 'paladin' as any,
      playerName: 'Pala',
      autoEquip: true,
    });
    const pid = sim.primaryId;
    sim.setPlayerLevel(20, pid);
    const p = sim.entities.get(pid)!;
    // Find a hostile mob in the world near the player.
    let mob: Entity | undefined;
    for (const e of sim.entities.values()) {
      if (e.kind === 'mob' && e.hostile && e.ownerId === null && !e.dead) {
        mob = e;
        break;
      }
    }
    expect(mob).toBeDefined();
    const m = mob!;
    m.pos = { ...p.pos, x: p.pos.x + 3 };
    m.prevPos = { ...m.pos };
    p.facing = Math.atan2(m.pos.x - p.pos.x, m.pos.z - p.pos.z);
    sim.targetEntity(m.id, pid);

    const stunMob = () => {
      m.auras = m.auras.filter((aura) => aura.id !== 'hammer_of_justice_stun');
      p.gcdRemaining = 0;
      p.resource = p.maxResource;
      p.cooldowns.delete('hammer_of_justice');
      let dur = 0;
      for (let attempt = 0; attempt < 50 && dur === 0; attempt++) {
        m.auras = m.auras.filter((aura) => aura.id !== 'hammer_of_justice_stun');
        p.gcdRemaining = 0;
        p.resource = p.maxResource;
        p.cooldowns.delete('hammer_of_justice');
        sim.castAbility('hammer_of_justice', pid);
        finishCast(sim, pid);
        dur = m.auras.find((aura) => aura.id === 'hammer_of_justice_stun')?.duration ?? 0;
      }
      return dur;
    };

    expect(stunMob()).toBe(4);
    expect(stunMob()).toBe(4);
    expect(stunMob()).toBe(4);
    expect(stunMob()).toBe(4);
  });
});
