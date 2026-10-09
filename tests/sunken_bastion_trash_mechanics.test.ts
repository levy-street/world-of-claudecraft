// The Sunken Bastion trash mechanics pass (src/sim/mob/trash_kit/bastion_kit.ts;
// content in src/sim/content/sunken_bastion.ts and the Tidebound Acolyte in
// dungeons.ts): every mechanic's trigger, its counterplay, normal against
// heroic, and a same-seed replay. Driven through tickTrashKits inside a real
// claimed Bastion (tests/sunken_bastion_trash.test.ts's shape).

import { describe, expect, it } from 'vitest';
import { DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { applyDungeonMobTuning } from '../src/sim/instances/difficulty';
import { dungeonPacksDead } from '../src/sim/instances/dungeon_gates';
import { claimedInstanceAt } from '../src/sim/instances/dungeons';
import { SCRIPTED_INTERRUPTIBLE_CHANNELS } from '../src/sim/mob/healer_channel';
import { tickTrashKits } from '../src/sim/mob/trash_kit';
import {
  BASTION_BOATHOOK,
  BASTION_BRINE_COLUMN,
  BASTION_CARRION_GLUT,
  BASTION_FOG_BANK,
  BASTION_FOG_BANK_CLOUD,
  BASTION_FOG_SHROUD,
  BASTION_HALBERD_WALL,
  BASTION_SNAPPED_FETTERS,
} from '../src/sim/mob/trash_kit/bastion_cast_ids';
import { isPlantedCast } from '../src/sim/mob/trash_kit/cast_hold';
import { DEATH_BURST_RING } from '../src/sim/mob/trash_kit/death_burst';
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
  sim.chat(`/dev bastion enter ${difficulty}`, sim.player.id);
  const inst = claimedInstanceAt(sim.ctx, sim.player.pos);
  if (!inst) throw new Error('no bastion claim');
  const me = sim.player;
  me.maxHp = 1e6;
  me.hp = 1e6;
  const o = instanceOrigin(DUNGEONS.sunken_bastion.index, inst.slot);
  // The middle of the tidal flats, clear of every pack: a quiet test bench.
  me.pos = sim.ctx.groundPos(o.x - 10, o.z - 200);
  me.prevPos = { ...me.pos };
  sim.drainEvents();
  return { sim, inst, me };
}

function engage(r: Room, templateId: string, dx = 8, dz = 0): Entity {
  const t = MOBS[templateId];
  const mob = createMob(r.sim.ctx.nextId++, t, t.minLevel, {
    ...r.sim.ctx.groundPos(r.me.pos.x + dx, r.me.pos.z + dz),
  });
  applyDungeonMobTuning(mob, 'sunken_bastion', r.inst.difficulty);
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
      if (m.dead || !r.sim.ctx.entities.has(m.id) || m.encounterHeld) continue;
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

function objects(r: Room, templateId: string): Entity[] {
  return r.inst.objectIds
    .map((id) => r.sim.ctx.entities.get(id))
    .filter((e): e is Entity => !!e && e.templateId === templateId);
}

function kill(r: Room, mob: Entity): void {
  r.sim.ctx.handleDeath(mob, r.me);
  r.sim.drainEvents();
}

function stun(r: Room, mob: Entity, seconds: number): void {
  r.sim.ctx.applyAura(mob, {
    id: 'test_stun',
    name: 'Stun',
    kind: 'stun',
    remaining: seconds,
    duration: seconds,
    value: 0,
    sourceId: r.me.id,
    school: 'physical',
  });
}

describe('Bastion trash pass: the cast table', () => {
  it('kicks the fog and the column; the hook is dodged', () => {
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[BASTION_FOG_BANK]?.school).toBe('frost');
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[BASTION_BRINE_COLUMN]?.school).toBe('nature');
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[BASTION_BOATHOOK]).toBeUndefined();
    expect(isPlantedCast(MOBS.drowned_watchman, BASTION_BOATHOOK)).toBe(true);
    expect(MOBS.bastion_warhound.packFrenzy).toEqual({ radius: 15, hasteMult: 1.3, duration: 8 });
  });
});

describe('Bastion trash pass: Drowned Watchman, Boathook Drag', () => {
  const def = MOBS.drowned_watchman.trashKit?.hook;
  if (!def) throw new Error('hook');

  it('hooks the far player in its lane and drags them to its feet', () => {
    const r = room();
    const watch = engage(r, 'drowned_watchman', 0, 2);
    const far = addPlayer(r, 'mage', 0, -14);
    run(r, def.first + DT, [watch]);
    expect(watch.castingAbility).toBe(BASTION_BOATHOOK);
    expect(watch.castTargetId).toBe(far.id);
    const before = far.hp;
    run(r, def.castTime + def.pullSeconds + DT * 4, [watch]);
    expect(far.hp).toBeLessThan(before);
    const d = Math.hypot(far.pos.x - watch.pos.x, far.pos.z - watch.pos.z);
    expect(d).toBeLessThan(def.stop + 1);
  });

  it('a player who stepped out of the lane is neither hit nor dragged', () => {
    const r = room();
    const watch = engage(r, 'drowned_watchman', 0, 2);
    const far = addPlayer(r, 'mage', 0, -14);
    run(r, def.first + DT, [watch]);
    expect(watch.castTargetId).toBe(far.id);
    far.pos = r.sim.ctx.groundPos(far.pos.x + 5, far.pos.z);
    const at = { ...far.pos };
    const before = far.hp;
    run(r, def.castTime + def.pullSeconds + DT * 4, [watch]);
    expect(far.hp).toBe(before);
    expect(Math.hypot(far.pos.x - at.x, far.pos.z - at.z)).toBeLessThan(0.01);
  });

  it('heroic: the Halberd Sweep follows the drag at once; normal waits its turn', () => {
    for (const difficulty of ['normal', 'heroic'] as const) {
      const r = room(difficulty);
      const watch = engage(r, 'drowned_watchman', 0, 2);
      addPlayer(r, 'mage', 0, -14);
      watch.breathTimer = 30;
      run(r, def.first + def.castTime + DT * 2, [watch]);
      if (difficulty === 'heroic') expect(watch.breathTimer).toBeLessThanOrEqual(def.heroicSweepIn);
      else expect(watch.breathTimer).toBe(30);
    }
  });
});

describe('Bastion trash pass: Drowned Watchman, Halberd Wall (heroic)', () => {
  const def = MOBS.drowned_watchman.trashKit?.wall;
  if (!def) throw new Error('wall');

  it('two side by side ward each other; split, the ward fades', () => {
    const r = room('heroic');
    const a = engage(r, 'drowned_watchman', 4, 0);
    const b = engage(r, 'drowned_watchman', 4, 3);
    run(r, DT * 2, [a, b]);
    const ward = a.auras.find((x) => x.id === BASTION_HALBERD_WALL);
    expect(ward?.kind).toBe('shield_wall');
    expect(ward?.value).toBe(def.reduction);
    expect(b.auras.some((x) => x.id === BASTION_HALBERD_WALL)).toBe(true);
    // Split: the kit stops holding it, and the aura tick lets it lapse.
    b.pos = r.sim.ctx.groundPos(b.pos.x + 30, b.pos.z);
    b.prevPos = { ...b.pos };
    for (let t = 0; t < 1; t += DT) {
      run(r, DT, [a, b]);
      for (const m of [a, b]) {
        const w = m.auras.find((x) => x.id === BASTION_HALBERD_WALL);
        if (w) w.remaining -= DT;
      }
      for (const m of [a, b]) m.auras = m.auras.filter((x) => x.remaining > 0);
    }
    expect(a.auras.some((x) => x.id === BASTION_HALBERD_WALL)).toBe(false);
  });

  it('normal: no wall', () => {
    const r = room();
    const a = engage(r, 'drowned_watchman', 4, 0);
    const b = engage(r, 'drowned_watchman', 4, 3);
    run(r, 1, [a, b]);
    expect(a.auras.some((x) => x.id === BASTION_HALBERD_WALL)).toBe(false);
  });
});

describe('Bastion trash pass: Fogbound Arbalest, Fall Back', () => {
  const def = MOBS.fogbound_arbalest.trashKit?.fallBack;
  if (!def) throw new Error('fallBack');

  it('a melee closing in: it leaps straight back', () => {
    const r = room();
    const arb = engage(r, 'fogbound_arbalest', 2, 0);
    const from = { ...arb.pos };
    run(r, def.first + def.seconds + DT * 2, [arb]);
    const moved = Math.hypot(arb.pos.x - from.x, arb.pos.z - from.z);
    expect(moved).toBeGreaterThan(def.distance * 0.45);
    // Away from the player.
    expect(Math.hypot(arb.pos.x - r.me.pos.x, arb.pos.z - r.me.pos.z)).toBeGreaterThan(
      2 + moved * 0.9,
    );
  });

  it('a stun mid-leap drops it where it is', () => {
    const r = room();
    const arb = engage(r, 'fogbound_arbalest', 2, 0);
    const from = { ...arb.pos };
    run(r, def.first + DT * 3, [arb]);
    expect(arb.trashKit?.fall).toBeDefined();
    stun(r, arb, 1);
    run(r, DT, [arb]);
    expect(arb.trashKit?.fall).toBeUndefined();
    const moved = Math.hypot(arb.pos.x - from.x, arb.pos.z - from.z);
    expect(moved).toBeLessThan(def.distance * 0.5);
  });

  it('rooted or stunned, it cannot leap', () => {
    const r = room();
    const arb = engage(r, 'fogbound_arbalest', 2, 0);
    const from = { ...arb.pos };
    stun(r, arb, def.first + 2);
    run(r, def.first + 1, [arb]);
    expect(Math.hypot(arb.pos.x - from.x, arb.pos.z - from.z)).toBeLessThan(0.01);
  });
});

describe('Bastion trash pass: Barnacle Crawler, Carrion Glut', () => {
  const def = MOBS.barnacle_crawler.trashKit?.gorge;
  const burst = MOBS.barnacle_crawler.trashKit?.deathBurst;
  if (!def || !burst?.perStack) throw new Error('gorge');

  it('feeds beside a corpse up to its cap, and bursts wider and harder for it', () => {
    const r = room();
    const crab = engage(r, 'barnacle_crawler', 8, 0);
    const corpse = engage(r, 'bastion_revenant', 9, 1);
    kill(r, corpse);
    run(r, def.every * (def.maxStacks + 2), [crab]);
    expect(crab.trashLife?.gorge).toBe(def.maxStacks);
    expect(crab.auras.find((a) => a.id === BASTION_CARRION_GLUT)?.stacks).toBe(def.maxStacks);
    // A player outside the base ring, inside the fed one.
    const edge = burst.radius + 2;
    const near = addPlayer(r, 'mage', 8 - edge, 0);
    kill(r, crab);
    run(r, DT, [crab]);
    const per = burst.perStack ?? { radius: 0, damage: 0 };
    const [ring] = objects(r, DEATH_BURST_RING);
    expect(ring.scale).toBe(burst.radius + def.maxStacks * per.radius);
    const before = near.hp;
    run(r, burst.delay + DT, [crab]);
    const dealt = before - near.hp;
    expect(dealt).toBeGreaterThanOrEqual(
      Math.round(burst.min * (1 + def.maxStacks * per.damage)) - 1,
    );
    // Linear, 25 percent a stack (the balance audit): never compounded.
    expect(per.damage).toBe(0.25);
    expect(dealt).toBeLessThanOrEqual(Math.round(burst.max * (1 + def.maxStacks * 0.25)) + 1);
  });

  it('an evade forgets the feast: re-pulled, it bursts at its base size', () => {
    const r = room();
    const crab = engage(r, 'barnacle_crawler', 8, 0);
    const corpse = engage(r, 'bastion_revenant', 9, 1);
    kill(r, corpse);
    run(r, def.every * 2 + DT, [crab]);
    expect(crab.trashLife?.gorge).toBe(2);
    // The evade's reset strips its auras (mob/locomotion.ts resetEvadingMob).
    crab.auras = [];
    corpse.pos = r.sim.ctx.groundPos(corpse.pos.x + 40, corpse.pos.z);
    run(r, DT, [crab]);
    expect(crab.trashLife?.gorge).toBe(0);
    kill(r, crab);
    run(r, DT, [crab]);
    const [ring] = objects(r, DEATH_BURST_RING);
    expect(ring.scale).toBe(burst.radius);
  });

  it('a crawler away from the dead never feeds; its burst stays small', () => {
    const r = room();
    const crab = engage(r, 'barnacle_crawler', 8, 0);
    run(r, def.every * 3, [crab]);
    expect(crab.trashLife?.gorge ?? 0).toBe(0);
    const near = addPlayer(r, 'mage', 8 - (burst.radius + 2), 0);
    kill(r, crab);
    run(r, burst.delay + DT * 2, [crab]);
    expect(near.hp).toBe(near.maxHp);
  });
});

describe('Bastion trash pass: Bastion Warhound, Pack Frenzy', () => {
  it('a fallen hound quickens the hounds round it', () => {
    const r = room();
    const a = engage(r, 'bastion_warhound', 4, 0);
    const b = engage(r, 'bastion_warhound', 6, 2);
    kill(r, a);
    expect(b.auras.some((x) => x.kind === 'buff_haste' && x.value === 1.3)).toBe(true);
  });
});

describe('Bastion trash pass: Mist Chanter, Fog Bank', () => {
  const def = MOBS.mistweaver.trashKit?.fogBank;
  if (!def) throw new Error('fog');

  function setup(r: Room): { chanter: Entity; inside: Entity; outside: Entity } {
    const chanter = engage(r, 'mistweaver', 14, 0);
    // Hold the ward: this test reads the fog alone.
    run(r, DT, [chanter]);
    (chanter.trashKit as unknown as { timers: Record<string, number> }).timers.ward = 999;
    const inside = engage(r, 'bastion_revenant', 1, 1);
    const outside = engage(r, 'bastion_revenant', 1, (def?.radius ?? 4) + 4);
    return { chanter, inside, outside };
  }

  it('lays a fog patch under its foe; allies inside take less damage, not outside', () => {
    const r = room();
    const { chanter, inside, outside } = setup(r);
    run(r, def.first, [chanter, inside, outside]);
    expect(chanter.castingAbility).toBe(BASTION_FOG_BANK);
    run(r, def.castTime + DT * 2, [chanter, inside, outside]);
    const [cloud] = objects(r, BASTION_FOG_BANK_CLOUD);
    expect(cloud?.scale).toBe(def.radius);
    expect(Math.hypot(cloud.pos.x - r.me.pos.x, cloud.pos.z - r.me.pos.z)).toBeLessThan(0.01);
    expect(inside.auras.find((a) => a.id === BASTION_FOG_SHROUD)?.value).toBe(def.reduction);
    expect(outside.auras.some((a) => a.id === BASTION_FOG_SHROUD)).toBe(false);
    run(r, def.seconds, [chanter, inside, outside]);
    expect(objects(r, BASTION_FOG_BANK_CLOUD)).toHaveLength(0);
  });

  it('heroic fog is thicker', () => {
    const r = room('heroic');
    const { chanter, inside, outside } = setup(r);
    run(r, def.first + def.castTime + DT * 2, [chanter, inside, outside]);
    expect(inside.auras.find((a) => a.id === BASTION_FOG_SHROUD)?.value).toBe(def.heroicReduction);
  });

  it('a kick: no fog', () => {
    const r = room();
    const { chanter, inside, outside } = setup(r);
    run(r, def.first, [chanter, inside, outside]);
    r.sim.ctx.cancelCast(chanter);
    run(r, def.castTime + DT * 2, [chanter, inside, outside]);
    expect(objects(r, BASTION_FOG_BANK_CLOUD)).toHaveLength(0);
    expect(inside.auras.some((a) => a.id === BASTION_FOG_SHROUD)).toBe(false);
  });
});

describe('Bastion trash pass: Tidebound Acolyte, Brine Column', () => {
  const def = MOBS.tidebound_acolyte.trashKit?.column;
  if (!def) throw new Error('column');

  it('roots one player other than its foe and drowns them on the clock', () => {
    const r = room();
    const aco = engage(r, 'tidebound_acolyte', 10, 0);
    const mage = addPlayer(r, 'mage', -8, 0);
    run(r, def.first + DT, [aco]);
    expect(aco.castingAbility).toBe(BASTION_BRINE_COLUMN);
    expect(aco.castTargetId).toBe(mage.id);
    expect(aco.channeling).toBe(true);
    const root = mage.auras.find((a) => a.id === BASTION_BRINE_COLUMN && a.kind === 'root');
    // The root carries the drowning roll it ticks, for its tooltip.
    expect([root?.value2, root?.value3]).toEqual([def.min, def.max]);
    const before = mage.hp;
    run(r, def.castTime + DT, [aco]);
    const ticks = Math.round(def.castTime / def.tick);
    expect(before - mage.hp).toBeGreaterThanOrEqual(ticks * def.min);
    expect(before - mage.hp).toBeLessThanOrEqual(ticks * def.max);
    expect(mage.auras.some((a) => a.id === BASTION_BRINE_COLUMN)).toBe(false);
  });

  it('a stun on the acolyte frees the victim at once', () => {
    const r = room();
    const aco = engage(r, 'tidebound_acolyte', 10, 0);
    const mage = addPlayer(r, 'mage', -8, 0);
    run(r, def.first + DT, [aco]);
    stun(r, aco, 1);
    run(r, DT, [aco]);
    expect(aco.castingAbility).toBeNull();
    expect(mage.auras.some((a) => a.id === BASTION_BRINE_COLUMN)).toBe(false);
    const before = mage.hp;
    run(r, def.castTime, [aco]);
    expect(mage.hp).toBe(before);
  });
});

describe('Bastion trash pass: Shackled Prisoner, Snapped Fetters', () => {
  const def = MOBS.shackled_prisoner.trashKit?.unshackle;
  if (!def) throw new Error('unshackle');

  it('at a quarter health it stops fighting, untouchable, then leaves', () => {
    const r = room();
    const pris = engage(r, 'shackled_prisoner', 2, 0);
    run(r, DT, [pris]);
    pris.hp = Math.floor(pris.maxHp * def.belowHpPct);
    run(r, DT, [pris]);
    expect(pris.hostile).toBe(false);
    expect(pris.damageImmune).toBe(true);
    expect(pris.inCombat).toBe(false);
    expect(pris.auras.some((a) => a.id === BASTION_SNAPPED_FETTERS)).toBe(true);
    run(r, def.seconds, [pris]);
    expect(r.sim.ctx.entities.has(pris.id)).toBe(false);
  });

  it('a burst cannot kill it past the release: damage stops at the quarter', () => {
    const r = room();
    const pris = engage(r, 'shackled_prisoner', 2, 0);
    r.sim.ctx.dealDamage(r.me, pris, pris.maxHp * 4, false, 'physical', 'test', 'hit');
    expect(pris.dead).toBe(false);
    expect(pris.hp).toBe(Math.ceil(pris.maxHp * def.belowHpPct));
    run(r, DT, [pris]);
    expect(pris.auras.some((a) => a.id === BASTION_SNAPPED_FETTERS)).toBe(true);
  });

  it('a freed pack prisoner counts as cleared for its gate', () => {
    const r = room();
    const spawns = DUNGEONS.sunken_bastion.spawns;
    const ids = spawns
      .map((s, i) => (s.packId === 'g1' ? r.inst.mobIds[i] : -1))
      .filter((id) => id >= 0);
    const pack = ids.map((id) => r.sim.ctx.entities.get(id) as Entity);
    expect(pack.length).toBeGreaterThan(0);
    for (const p of pack) {
      p.inCombat = true;
      p.aiState = 'attack';
      p.aggroTargetId = r.me.id;
    }
    for (const p of pack) {
      if (p.templateId === 'shackled_prisoner') p.hp = 1;
      else kill(r, p);
    }
    run(r, DT, pack);
    expect(dungeonPacksDead(r.sim.ctx, r.inst, ['g1'])).toBe(false);
    run(r, def.seconds + DT, pack);
    expect(dungeonPacksDead(r.sim.ctx, r.inst, ['g1'])).toBe(true);
  });
});

describe('Bastion trash pass: determinism', () => {
  it('the same pull on the same seed lands the same world', () => {
    const trace = (): string => {
      const r = room('heroic', 7);
      const watch = engage(r, 'drowned_watchman', 0, 2);
      const aco = engage(r, 'tidebound_acolyte', 10, 0);
      const chanter = engage(r, 'mistweaver', 14, 4);
      const crab = engage(r, 'barnacle_crawler', 6, 6);
      const far = addPlayer(r, 'mage', 0, -14);
      run(r, 20, [watch, aco, chanter, crab]);
      return JSON.stringify({
        me: r.me.hp,
        far: [far.hp, Math.round(far.pos.x * 1e4), Math.round(far.pos.z * 1e4)],
        rng: r.sim.ctx.rng.range(0, 1e9),
      });
    };
    expect(trace()).toBe(trace());
  });
});

describe('Bastion trash pass: the marks say their rule', () => {
  it('each trash mark has its own line, numbers from the templates', () => {
    expect(
      auraEffectDescriptor({
        id: BASTION_BRINE_COLUMN,
        kind: 'root',
        value: 0,
        value2: 162,
        value3: 234,
      }),
    ).toEqual({
      key: 'hudChrome.auraEffect.bastion.brineColumn',
      nums: { min: 162, max: 234, tick: 1, seconds: 4 },
    });
    expect(
      auraEffectDescriptor({ id: BASTION_HALBERD_WALL, kind: 'shield_wall', value: 0.25 })?.nums,
    ).toEqual({ pct: 25, radius: 5 });
    expect(
      auraEffectDescriptor({ id: BASTION_FOG_SHROUD, kind: 'shield_wall', value: 0.5 })?.nums,
    ).toEqual({ pct: 50 });
    expect(
      auraEffectDescriptor({ id: BASTION_CARRION_GLUT, kind: 'buff_dr', value: 0, stacks: 2 })
        ?.nums,
    ).toEqual({ stacks: 2, max: 3, radius: 1.25, pct: 25 });
    expect(
      auraEffectDescriptor({ id: BASTION_SNAPPED_FETTERS, kind: 'buff_dr', value: 0 })?.key,
    ).toBe('hudChrome.auraEffect.bastion.snappedFetters');
  });
});
