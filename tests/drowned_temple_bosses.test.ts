// The Drowned Temple bosses (src/sim/encounters/drowned_temple): each core, its
// counterplay, its heroic twists and the reset on a wipe, plus the Mere Hydra
// showpiece. Driven through full Sim ticks inside a real claimed Temple with a
// real party, the trash cleared so nothing else joins the fight.

import { describe, expect, it } from 'vitest';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  BRINE_SPIT_TEMPLATE,
  CHORUS_ECHO_TEMPLATE,
  COLOSSUS_ID,
  COLOSSUS_MOONLIGHT_LANCE,
  COLOSSUS_PRISM_FLARE,
  COLOSSUS_PRISM_WARD,
  COLOSSUS_TUNING,
  HYDRA_BRINE_SPIT,
  HYDRA_CENTER_ID,
  HYDRA_ENRAGED,
  HYDRA_LEFT_ID,
  HYDRA_RIGHT_ID,
  HYDRA_TIDE_BREATH,
  HYDRA_TUNING,
  MOONSPAWN_ID,
  REFLECTION_ID,
  RIPTIDE_TEMPLATE,
  SELTHE_CHORUS_MARK,
  SELTHE_ID,
  SELTHE_SOLO_MARK,
  SELTHE_TUNING,
  TIDE_HALF_SPOTS,
  TIDE_TEMPLATES,
  YSOLEI_FLOODED,
  YSOLEI_ID,
  YSOLEI_TUNING,
  YSOLEI_UNDERTOW,
} from '../src/sim/encounters/drowned_temple';
import { claimedInstanceAt, enterDungeon } from '../src/sim/instances/dungeons';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { DT, type Entity } from '../src/sim/types';

interface Fight {
  sim: Sim;
  inst: InstanceSlot;
  ox: number;
  oz: number;
  tank: Entity;
  others: Entity[];
}

const BOSSES = new Set([
  SELTHE_ID,
  COLOSSUS_ID,
  YSOLEI_ID,
  HYDRA_LEFT_ID,
  HYDRA_CENTER_ID,
  HYDRA_RIGHT_ID,
]);

function fight(difficulty: 'normal' | 'heroic' = 'normal', extra = 2): Fight {
  const sim = new Sim({ seed: 17, playerClass: 'warrior', autoEquip: false, devCommands: true });
  const tank = sim.player;
  sim.chat('/dev level 20', tank.id);
  const ids: number[] = [];
  for (let i = 0; i < extra; i++) {
    const pid = sim.addPlayer('mage', `Moonwader${i}`);
    sim.partyInvite(pid, tank.id);
    sim.partyAccept(pid);
    ids.push(pid);
  }
  sim.chat(`/dev temple enter ${difficulty}`, tank.id);
  for (const pid of ids) enterDungeon(sim.ctx, 'drowned_temple', pid);
  const inst = claimedInstanceAt(sim.ctx, tank.pos);
  if (!inst) throw new Error('no temple claim');
  // Clear every pack so the bosses fight alone.
  for (const id of inst.mobIds) {
    const e = sim.ctx.entities.get(id);
    if (e && !e.dead && !BOSSES.has(e.templateId)) sim.ctx.handleDeath(e, tank);
  }
  const others = ids.map((pid) => sim.ctx.entities.get(pid) as Entity);
  for (const p of [tank, ...others]) {
    p.maxHp = 1e7;
    p.hp = 1e7;
  }
  const o = instanceOrigin(DUNGEONS.drowned_temple.index, inst.slot);
  sim.drainEvents();
  return { sim, inst, ox: o.x, oz: o.z, tank, others };
}

function boss(f: Fight, id: string): Entity {
  for (const mid of f.inst.mobIds) {
    const e = f.sim.ctx.entities.get(mid);
    if (e?.templateId === id) return e;
  }
  throw new Error(`no ${id}`);
}

function put(f: Fight, e: Entity, x: number, z: number): void {
  e.pos = f.sim.ctx.groundPos(f.ox + x, f.oz + z);
  e.prevPos = { ...e.pos };
}

function local(f: Fight, e: Entity): { x: number; z: number } {
  return { x: e.pos.x - f.ox, z: e.pos.z - f.oz };
}

function run(f: Fight, seconds: number, keep: () => void = () => {}): void {
  for (let t = 0; t < seconds - DT * 0.5; t += DT) {
    for (const p of [f.tank, ...f.others]) if (p.hp < 1e5) p.hp = 1e6;
    keep();
    f.sim.tick();
  }
  f.sim.drainEvents();
}

function engage(f: Fight, b: Entity): void {
  b.maxHp = Math.max(b.maxHp, 1e6);
  b.hp = b.maxHp;
  f.sim.ctx.aggroMob(b, f.tank, false);
}

/** Everyone falls back out of reach and the boss walks home: a wipe. */
function wipe(f: Fight, b: Entity): void {
  for (const p of [f.tank, ...f.others]) put(f, p, 0, -230);
  b.inCombat = false;
  b.aggroTargetId = null;
  b.aiState = 'evade';
}

function objects(f: Fight, template: string): Entity[] {
  const out: Entity[] = [];
  for (const id of f.inst.objectIds) {
    const e = f.sim.ctx.entities.get(id);
    if (e?.templateId === template) out.push(e);
  }
  return out;
}

function hasAura(e: Entity, id: string): boolean {
  return e.auras.some((a) => a.id === id);
}

/** Damage each player takes over `seconds`, measured off a full top-up. */
function damageOver(f: Fight, seconds: number, keep: () => void = () => {}): Map<number, number> {
  const out = new Map<number, number>();
  const all = [f.tank, ...f.others];
  for (const p of all) p.hp = 1e6;
  for (let t = 0; t < seconds - DT * 0.5; t += DT) {
    keep();
    f.sim.tick();
    for (const p of all) {
      out.set(p.id, (out.get(p.id) ?? 0) + (1e6 - p.hp));
      p.hp = 1e6;
    }
  }
  f.sim.drainEvents();
  return out;
}

// ---------------------------------------------------------------------------
describe('Choirmother Selthe: stack for Chorus, spread for Solo', () => {
  function seltheFight(difficulty: 'normal' | 'heroic' = 'normal'): { f: Fight; b: Entity } {
    const f = fight(difficulty);
    const b = boss(f, SELTHE_ID);
    put(f, f.tank, 0, 6);
    put(f, f.others[0], -10, -4);
    put(f, f.others[1], 10, -4);
    engage(f, b);
    return { f, b };
  }

  it('marks a Chorus at 10 s, never on the tank while others stand in the court', () => {
    const { f } = seltheFight();
    run(f, SELTHE_TUNING.chorusFirst + 0.1);
    const marked = [f.tank, ...f.others].filter((p) => hasAura(p, SELTHE_CHORUS_MARK));
    expect(marked).toHaveLength(1);
    expect(marked[0].id).not.toBe(f.tank.id);
  });

  it('splits the Chorus among everyone stacked on the mark, and a lone mark takes it all', () => {
    const stacked = seltheFight();
    run(stacked.f, SELTHE_TUNING.chorusFirst + 0.1);
    const mark = [stacked.f.tank, ...stacked.f.others].find((p) =>
      hasAura(p, SELTHE_CHORUS_MARK),
    ) as Entity;
    // Everyone gathers on the mark.
    const at = local(stacked.f, mark);
    const others = [stacked.f.tank, ...stacked.f.others].filter((p) => p !== mark);
    const dmg = damageOver(stacked.f, SELTHE_TUNING.markSeconds, () => {
      for (const p of others) put(stacked.f, p, at.x + 1, at.z);
    });
    // Three players share 400: about 133 each (plus the Sea-Song and swings).
    const markTook = dmg.get(mark.id) ?? 0;
    expect(markTook).toBeGreaterThan(120);
    expect(markTook).toBeLessThan(260);

    const alone = seltheFight();
    run(alone.f, SELTHE_TUNING.chorusFirst + 0.1);
    const lone = [alone.f.tank, ...alone.f.others].find((p) =>
      hasAura(p, SELTHE_CHORUS_MARK),
    ) as Entity;
    // Everyone else runs far from the mark.
    const far = local(alone.f, lone).x > 0 ? -18 : 18;
    const rest = [alone.f.tank, ...alone.f.others].filter((p) => p !== lone);
    const dmg2 = damageOver(alone.f, SELTHE_TUNING.markSeconds, () => {
      for (const p of rest) put(alone.f, p, far, 0);
    });
    expect(dmg2.get(lone.id) ?? 0).toBeGreaterThanOrEqual(SELTHE_TUNING.chorusTotal);
  });

  it('lands a Solo on its mark and on everyone within 8 yd of it', () => {
    const { f } = seltheFight();
    run(f, SELTHE_TUNING.chorusFirst + SELTHE_TUNING.soloOffset + 0.1);
    const mark = [f.tank, ...f.others].find((p) => hasAura(p, SELTHE_SOLO_MARK)) as Entity;
    expect(mark).toBeDefined();
    const at = local(f, mark);
    const near = [f.tank, ...f.others].find((p) => p !== mark) as Entity;
    const safe = [f.tank, ...f.others].find((p) => p !== mark && p !== near) as Entity;
    const dmg = damageOver(f, SELTHE_TUNING.markSeconds, () => {
      put(f, near, at.x + 3, at.z);
      put(f, safe, at.x > 0 ? -20 : 20, 0);
      put(f, mark, at.x, at.z);
    });
    expect(dmg.get(mark.id) ?? 0).toBeGreaterThanOrEqual(SELTHE_TUNING.soloDamage);
    expect(dmg.get(near.id) ?? 0).toBeGreaterThanOrEqual(SELTHE_TUNING.soloDamage);
    expect(dmg.get(safe.id) ?? 0).toBeLessThan(SELTHE_TUNING.soloDamage);
  });

  it('heroic Duet: the Chorus and the Solo land together on two different players', () => {
    const { f } = seltheFight('heroic');
    run(f, SELTHE_TUNING.chorusFirst + 0.1);
    const chorus = [f.tank, ...f.others].filter((p) => hasAura(p, SELTHE_CHORUS_MARK));
    const solo = [f.tank, ...f.others].filter((p) => hasAura(p, SELTHE_SOLO_MARK));
    expect(chorus).toHaveLength(1);
    expect(solo).toHaveLength(1);
    expect(chorus[0].id).not.toBe(solo[0].id);
  });

  it('heroic Echo: each mark sings again where it fell, 4 s later', () => {
    const { f } = seltheFight('heroic');
    run(f, SELTHE_TUNING.chorusFirst + SELTHE_TUNING.markSeconds + 0.2);
    expect(objects(f, CHORUS_ECHO_TEMPLATE)).toHaveLength(1);
    run(f, SELTHE_TUNING.echoAfter);
    expect(objects(f, CHORUS_ECHO_TEMPLATE)).toHaveLength(0);
  });

  it('never echoes on normal', () => {
    const { f } = seltheFight();
    run(f, SELTHE_TUNING.chorusFirst + SELTHE_TUNING.markSeconds + 0.2);
    expect(objects(f, CHORUS_ECHO_TEMPLATE)).toHaveLength(0);
  });

  it('a wipe clears the marks and the fight state', () => {
    const { f, b } = seltheFight();
    run(f, SELTHE_TUNING.chorusFirst + 0.1);
    wipe(f, b);
    run(f, 0.1);
    expect(b.templeFight).toBeUndefined();
    for (const p of [f.tank, ...f.others]) expect(hasAura(p, SELTHE_CHORUS_MARK)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('the Mere Hydra: three heads, one moon pool', () => {
  function hydraFight(difficulty: 'normal' | 'heroic' = 'normal'): {
    f: Fight;
    heads: Entity[];
  } {
    const f = fight(difficulty);
    const heads = [HYDRA_LEFT_ID, HYDRA_CENTER_ID, HYDRA_RIGHT_ID].map((id) => boss(f, id));
    put(f, f.tank, 0, 90);
    put(f, f.others[0], -12, 80);
    put(f, f.others[1], 12, 80);
    for (const h of heads) engage(f, h);
    return { f, heads };
  }

  it('shares ONE fight state across the three heads', () => {
    const { f, heads } = hydraFight();
    run(f, 0.2);
    expect(heads[0].templeFight).toBeDefined();
    expect(heads[0].templeFight).toBe(heads[1].templeFight);
    expect(heads[1].templeFight).toBe(heads[2].templeFight);
  });

  it('only the ice head (the left) breathes, on its own beat', () => {
    const { f, heads } = hydraFight();
    const starts: number[] = [];
    const breathers = new Set<string>();
    let was = false;
    run(f, HYDRA_TUNING.breathFirst + HYDRA_TUNING.breathEvery + 0.5, () => {
      const now = heads.some((h) => h.castingAbility === HYDRA_TIDE_BREATH);
      for (const h of heads)
        if (h.castingAbility === HYDRA_TIDE_BREATH) breathers.add(h.templateId);
      if (now && !was) starts.push(f.sim.ctx.time);
      was = now;
    });
    expect([...breathers]).toEqual([HYDRA_LEFT_ID]);
    expect(starts).toHaveLength(2);
    expect(starts[1] - starts[0]).toBeCloseTo(HYDRA_TUNING.breathEvery, 1);
  });

  it('the breath burns only the cone it locked on when the bar began', () => {
    const { f, heads } = hydraFight();
    run(f, HYDRA_TUNING.breathFirst + 0.05);
    const left = heads[0];
    expect(left.castingAbility).toBe(HYDRA_TIDE_BREATH);
    const victim = f.sim.ctx.entities.get(left.castTargetId as number) as Entity;
    // The victim sidesteps well out of the cone; a second player walks into it.
    const aim = left.facing;
    const into = [f.tank, ...f.others].find((p) => p !== victim && p !== f.tank) ?? f.tank;
    const lx = left.pos.x - f.ox + Math.sin(aim) * 10;
    const lz = left.pos.z - f.oz + Math.cos(aim) * 10;
    const dmg = damageOver(f, HYDRA_TUNING.breathCast, () => {
      put(f, victim, lx + Math.cos(aim) * 14, lz - Math.sin(aim) * 14);
      put(f, into, lx, lz);
    });
    expect(dmg.get(into.id) ?? 0).toBeGreaterThanOrEqual(HYDRA_TUNING.breathMin);
    expect(dmg.get(victim.id) ?? 0).toBeLessThan(HYDRA_TUNING.breathMin);
  });

  it('the centre head spits three brine pools that burst 1.5 s later', () => {
    const { f } = hydraFight();
    let seen = 0;
    run(f, HYDRA_TUNING.spitFirst + 0.1, () => {
      seen = Math.max(seen, objects(f, BRINE_SPIT_TEMPLATE).length);
    });
    expect(seen).toBe(3);
    run(f, HYDRA_TUNING.spitWarn + 0.1);
    expect(objects(f, BRINE_SPIT_TEMPLATE)).toHaveLength(0);
    void HYDRA_BRINE_SPIT;
  });

  it('each fallen head enrages the others by 15 percent, stacking', () => {
    const { f, heads } = hydraFight();
    run(f, 0.2);
    f.sim.ctx.handleDeath(heads[0], f.tank);
    run(f, 0.1);
    const one = heads[1].auras.find((a) => a.id === HYDRA_ENRAGED);
    expect(one?.value).toBeCloseTo(0.15, 5);
    f.sim.ctx.handleDeath(heads[2], f.tank);
    run(f, 0.1);
    expect(heads[1].auras.find((a) => a.id === HYDRA_ENRAGED)?.value).toBeCloseTo(0.3, 5);
  });

  it('a lone right head breathes the ice once the left and centre are dead', () => {
    const { f, heads } = hydraFight();
    f.sim.ctx.handleDeath(heads[0], f.tank);
    f.sim.ctx.handleDeath(heads[1], f.tank);
    let breathed = false;
    run(f, HYDRA_TUNING.breathFirst + 1, () => {
      if (heads[2].castingAbility === HYDRA_TIDE_BREATH) breathed = true;
    });
    expect(breathed).toBe(true);
  });

  it('holds the centre head first loot through a regrowth and pays it at the kill', () => {
    // The centre head carries the fight's one boss roll (content/drowned_temple.ts,
    // content/heroic_loot.ts). Felled first, it grows back while a sibling lives;
    // the loot it rolled must survive that (held, unlootable while it stands) and
    // come back with its corpse when the last head falls.
    const { f, heads } = hydraFight();
    run(f, 0.2);
    const [left, centre, right] = heads;
    f.sim.ctx.handleDeath(centre, f.tank);
    const first = centre.loot;
    expect(first).toBeTruthy();
    expect(centre.lootable).toBe(true);
    run(f, HYDRA_TUNING.regrowAfter + 0.5);
    expect(centre.dead).toBe(false);
    expect(centre.lootable).toBe(false);
    expect(centre.loot).toBe(first);
    for (const h of [centre, left, right]) f.sim.ctx.handleDeath(h, f.tank);
    run(f, 0.2);
    expect(centre.loot).toBe(first);
    expect(centre.lootable).toBe(true);
  });

  it('a wipe keeps the centre head held loot for the attempt that kills the Hydra', () => {
    const { f, heads } = hydraFight();
    run(f, 0.2);
    const [left, centre, right] = heads;
    f.sim.ctx.handleDeath(centre, f.tank);
    const first = centre.loot;
    expect(first).toBeTruthy();
    // The group falls back: the fight resets and the fallen centre head grows
    // back whole, holding the loot it already rolled.
    wipe(f, left);
    wipe(f, right);
    run(f, 3);
    expect(centre.dead).toBe(false);
    expect(centre.lootable).toBe(false);
    expect(centre.loot).toBe(first);
    // The next attempt brings all three down: the held loot comes back.
    for (const h of heads) engage(f, h);
    run(f, 0.2);
    for (const h of [centre, left, right]) f.sim.ctx.handleDeath(h, f.tank);
    run(f, 0.2);
    expect(centre.loot).toBe(first);
    expect(centre.lootable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('the Tideglass Colossus: kill each other’s reflections', () => {
  function colossusFight(difficulty: 'normal' | 'heroic' = 'normal'): {
    f: Fight;
    b: Entity;
  } {
    const f = fight(difficulty);
    const b = boss(f, COLOSSUS_ID);
    put(f, f.tank, 86, 204);
    put(f, f.others[0], 76, 200);
    put(f, f.others[1], 96, 200);
    engage(f, b);
    return { f, b };
  }

  function reflections(f: Fight): Entity[] {
    const out: Entity[] = [];
    for (const id of f.inst.mobIds) {
      const e = f.sim.ctx.entities.get(id);
      if (e && !e.dead && e.templateId.startsWith(REFLECTION_ID)) out.push(e);
    }
    return out;
  }

  it('flares at 75 percent and raises one Reflection per player, bound to its owner', () => {
    const { f, b } = colossusFight();
    run(f, 0.2);
    b.hp = Math.floor(b.maxHp * 0.74);
    run(f, 0.1);
    expect(b.castingAbility).toBe(COLOSSUS_PRISM_FLARE);
    run(f, COLOSSUS_TUNING.flareCast + 0.1);
    const refl = reflections(f);
    expect(refl).toHaveLength(3);
    const owners = new Set(refl.map((r) => r.mirrorOwnerId));
    expect(owners).toEqual(new Set([f.tank.id, ...f.others.map((p) => p.id)]));
    for (const r of refl) {
      expect(r.forcedTargetId).toBe(r.mirrorOwnerId);
      expect(r.maxHp).toBe(Math.round(b.maxHp * COLOSSUS_TUNING.reflectionShare));
    }
    // Each living Reflection wards the Colossus 10 percent.
    expect(b.auras.find((a) => a.id === COLOSSUS_PRISM_WARD)?.value).toBeCloseTo(0.3, 5);
  });

  it('a Reflection takes nothing from its owner and full damage from anyone else', () => {
    const { f, b } = colossusFight();
    run(f, 0.2);
    b.hp = Math.floor(b.maxHp * 0.74);
    run(f, COLOSSUS_TUNING.flareCast + 0.3);
    const r = reflections(f)[0];
    const owner = f.sim.ctx.entities.get(r.mirrorOwnerId as number) as Entity;
    const friend = [f.tank, ...f.others].find((p) => p.id !== owner.id) as Entity;
    const before = r.hp;
    expect(f.sim.ctx.dealDamage(owner, r, 100, false, 'physical', 'Test', 'hit')).toBe(0);
    expect(r.hp).toBe(before);
    expect(f.sim.ctx.dealDamage(friend, r, 100, false, 'physical', 'Test', 'hit')).toBeGreaterThan(
      0,
    );
    expect(r.hp).toBeLessThan(before);
  });

  it('the ward falls as the Reflections break', () => {
    const { f, b } = colossusFight();
    run(f, 0.2);
    b.hp = Math.floor(b.maxHp * 0.74);
    run(f, COLOSSUS_TUNING.flareCast + 0.3);
    for (const r of reflections(f)) f.sim.ctx.handleDeath(r, f.tank);
    run(f, 0.1);
    expect(b.auras.some((a) => a.id === COLOSSUS_PRISM_WARD)).toBe(false);
  });

  it('the Moonlight Lance hits only the lane it locked', () => {
    const { f, b } = colossusFight();
    run(f, COLOSSUS_TUNING.lanceFirst + 0.1);
    expect(b.castingAbility).toBe(COLOSSUS_MOONLIGHT_LANCE);
    const victim = f.sim.ctx.entities.get(b.castTargetId as number) as Entity;
    const yaw = b.facing;
    const bx = b.pos.x - f.ox;
    const bz = b.pos.z - f.oz;
    const bystander = [f.tank, ...f.others].find((p) => p !== victim && p !== f.tank) ?? f.tank;
    const dmg = damageOver(f, COLOSSUS_TUNING.lanceCast, () => {
      // The victim steps out sideways; the bystander walks into the lane.
      put(
        f,
        victim,
        bx + Math.sin(yaw) * 12 + Math.cos(yaw) * 6,
        bz + Math.cos(yaw) * 12 - Math.sin(yaw) * 6,
      );
      put(f, bystander, bx + Math.sin(yaw) * 16, bz + Math.cos(yaw) * 16);
    });
    expect(dmg.get(bystander.id) ?? 0).toBeGreaterThanOrEqual(COLOSSUS_TUNING.lanceMin * 0.8);
    expect(dmg.get(victim.id) ?? 0).toBeLessThan(COLOSSUS_TUNING.lanceMin * 0.8);
  });

  it('heroic Swapped Images: the Reflections pass to the next owner every 8 s', () => {
    const { f, b } = colossusFight('heroic');
    run(f, 0.2);
    b.hp = Math.floor(b.maxHp * 0.74);
    run(f, COLOSSUS_TUNING.flareCast + 0.3);
    const before = new Map(reflections(f).map((r) => [r.id, r.mirrorOwnerId]));
    run(f, COLOSSUS_TUNING.swapEvery);
    let moved = 0;
    for (const r of reflections(f)) {
      if (before.get(r.id) !== r.mirrorOwnerId) moved++;
      expect(r.forcedTargetId).toBe(r.mirrorOwnerId);
    }
    expect(moved).toBe(3);
  });

  it('normal never swaps', () => {
    const { f, b } = colossusFight();
    run(f, 0.2);
    b.hp = Math.floor(b.maxHp * 0.74);
    run(f, COLOSSUS_TUNING.flareCast + 0.3);
    const before = new Map(reflections(f).map((r) => [r.id, r.mirrorOwnerId]));
    run(f, COLOSSUS_TUNING.swapEvery + 1);
    for (const r of reflections(f)) expect(r.mirrorOwnerId).toBe(before.get(r.id));
  });

  it('heroic Shattering Glass: a breaking Reflection hurts whoever stands on it', () => {
    const { f, b } = colossusFight('heroic');
    run(f, 0.2);
    b.hp = Math.floor(b.maxHp * 0.74);
    run(f, COLOSSUS_TUNING.flareCast + 0.3);
    const r = reflections(f)[0];
    const near = [f.tank, ...f.others].find((p) => p.id !== r.mirrorOwnerId) as Entity;
    const at = local(f, r);
    put(f, near, at.x + 1, at.z);
    near.hp = 1e6;
    f.sim.ctx.handleDeath(r, near);
    f.sim.tick();
    expect(near.hp).toBeLessThan(1e6);
  });

  it('a wipe dissolves every Reflection', () => {
    const { f, b } = colossusFight();
    run(f, 0.2);
    b.hp = Math.floor(b.maxHp * 0.74);
    run(f, COLOSSUS_TUNING.flareCast + 0.3);
    wipe(f, b);
    run(f, 0.1);
    expect(reflections(f)).toHaveLength(0);
    expect(b.templeFight).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe('Ysolei: run out of the undertow toward the dry half', () => {
  function ysoleiFight(difficulty: 'normal' | 'heroic' = 'normal'): { f: Fight; b: Entity } {
    const f = fight(difficulty);
    const b = boss(f, YSOLEI_ID);
    put(f, f.tank, -24, 206);
    put(f, f.others[0], -40, 196);
    put(f, f.others[1], -40, 216);
    engage(f, b);
    return { f, b };
  }

  it('the Undertow drags a standing player in; a runner still gains ground', () => {
    const { f, b } = ysoleiFight();
    run(f, YSOLEI_TUNING.undertowFirst + 0.05);
    expect(b.castingAbility).toBe(YSOLEI_UNDERTOW);
    const stander = f.others[0];
    const runner = f.others[1];
    const bx = b.pos.x;
    const bz = b.pos.z;
    const d0 = Math.hypot(stander.pos.x - bx, stander.pos.z - bz);
    const r0 = Math.hypot(runner.pos.x - bx, runner.pos.z - bz);
    run(f, 1, () => {
      // The runner steps 7 yd a second straight away from her.
      const dx = runner.pos.x - bx;
      const dz = runner.pos.z - bz;
      const len = Math.hypot(dx, dz) || 1;
      runner.pos.x += (dx / len) * 7 * DT;
      runner.pos.z += (dz / len) * 7 * DT;
    });
    const d1 = Math.hypot(stander.pos.x - bx, stander.pos.z - bz);
    const r1 = Math.hypot(runner.pos.x - bx, runner.pos.z - bz);
    expect(d0 - d1).toBeGreaterThan(YSOLEI_TUNING.undertowPull * 0.8);
    expect(r1).toBeGreaterThan(r0);
  });

  it('the Tidal Crash hits everyone within 12 yd when the Undertow ends', () => {
    const { f, b } = ysoleiFight();
    run(f, YSOLEI_TUNING.undertowFirst + 0.05);
    const at = local(f, b);
    const dmg = damageOver(f, YSOLEI_TUNING.undertowSeconds + 0.1, () => {
      put(f, f.others[0], at.x + 4, at.z);
      put(f, f.others[1], at.x - 20, at.z);
    });
    expect(dmg.get(f.others[0].id) ?? 0).toBeGreaterThanOrEqual(YSOLEI_TUNING.crashMin);
    expect(dmg.get(f.others[1].id) ?? 0).toBeLessThan(YSOLEI_TUNING.crashMin);
  });

  it('under 66 percent one half floods: frost and a slow there, nothing on the dry half', () => {
    const { f, b } = ysoleiFight();
    run(f, 0.2);
    b.hp = Math.floor(b.maxHp * 0.6);
    run(f, 0.1);
    const st = b.templeFight;
    expect(st?.kind === 'ysolei' && st.tide !== null).toBe(true);
    if (st?.kind !== 'ysolei' || !st.tide) return;
    const wet = TIDE_HALF_SPOTS[st.tide.half];
    const dry = TIDE_HALF_SPOTS[st.tide.half === 'north' ? 'south' : 'north'];
    const dmg = damageOver(f, 2, () => {
      put(f, f.others[0], wet.x - 6, wet.z);
      put(f, f.others[1], dry.x - 6, dry.z);
    });
    expect(dmg.get(f.others[0].id) ?? 0).toBeGreaterThanOrEqual(YSOLEI_TUNING.floodPerSecond);
    expect(hasAura(f.others[0], YSOLEI_FLOODED)).toBe(true);
    expect(hasAura(f.others[1], YSOLEI_FLOODED)).toBe(false);
  });

  it('the tide warns the dry half for 10 s, then switches halves every 30 s', () => {
    const { f, b } = ysoleiFight();
    run(f, 0.2);
    b.hp = Math.floor(b.maxHp * 0.6);
    run(f, 0.1);
    const st = b.templeFight;
    if (st?.kind !== 'ysolei' || !st.tide) throw new Error('no tide');
    const first = st.tide.half;
    const other = first === 'north' ? 'south' : 'north';
    const objectFor = (half: 'north' | 'south'): Entity | undefined => {
      const s = TIDE_HALF_SPOTS[half];
      for (const id of f.inst.objectIds) {
        const e = f.sim.ctx.entities.get(id);
        if (e && Math.abs(e.pos.x - f.ox - s.x) < 0.75 && Math.abs(e.pos.z - f.oz - s.z) < 0.75)
          return e;
      }
      return undefined;
    };
    expect(objectFor(first)?.templateId).toBe(TIDE_TEMPLATES.flood);
    expect(objectFor(other)?.templateId).toBe(TIDE_TEMPLATES.dry);
    run(f, YSOLEI_TUNING.tideEvery - YSOLEI_TUNING.tideWarn + 0.2);
    expect(objectFor(other)?.templateId).toBe(TIDE_TEMPLATES.warn);
    run(f, YSOLEI_TUNING.tideWarn);
    expect(st.tide.half).toBe(other);
    expect(objectFor(other)?.templateId).toBe(TIDE_TEMPLATES.flood);
    expect(objectFor(first)?.templateId).toBe(TIDE_TEMPLATES.dry);
  });

  it('heroic Riptide: every Undertow leaves whirls where the players stood', () => {
    const { f } = ysoleiFight('heroic');
    run(f, YSOLEI_TUNING.undertowFirst + YSOLEI_TUNING.undertowSeconds + 0.2);
    expect(objects(f, RIPTIDE_TEMPLATE).length).toBeGreaterThanOrEqual(3);
    run(f, YSOLEI_TUNING.riptideSeconds);
    expect(objects(f, RIPTIDE_TEMPLATE)).toHaveLength(0);
  });

  it('normal leaves no Riptide', () => {
    const { f } = ysoleiFight();
    run(f, YSOLEI_TUNING.undertowFirst + YSOLEI_TUNING.undertowSeconds + 0.2);
    expect(objects(f, RIPTIDE_TEMPLATE)).toHaveLength(0);
  });

  it('heroic Drowned Moon: a Moonspawn climbs out of the flood every 20 s', () => {
    const { f, b } = ysoleiFight('heroic');
    run(f, 0.2);
    b.hp = Math.floor(b.maxHp * 0.62);
    run(f, 0.1);
    const count = (): number =>
      f.inst.mobIds.filter((id) => {
        const e = f.sim.ctx.entities.get(id);
        return e && !e.dead && e.templateId === MOONSPAWN_ID;
      }).length;
    const before = count();
    run(f, YSOLEI_TUNING.drownedMoonEvery + 0.2);
    expect(count()).toBeGreaterThan(before);
  });

  it('a wipe drains the island dry', () => {
    const { f, b } = ysoleiFight();
    run(f, 0.2);
    b.hp = Math.floor(b.maxHp * 0.6);
    run(f, 0.1);
    wipe(f, b);
    run(f, 0.1);
    expect(b.templeFight).toBeUndefined();
    for (const id of f.inst.objectIds) {
      const e = f.sim.ctx.entities.get(id);
      if (e && e.templateId.startsWith('temple_tide_'))
        expect(e.templateId).toBe(TIDE_TEMPLATES.dry);
    }
  });
});

// ---------------------------------------------------------------------------
describe('the Drowned Temple deeds, granted to the claim at the kill', () => {
  function earned(f: Fight, e: Entity, deed: string): boolean {
    return f.sim.players.get(e.id)?.deedsEarned.has(deed) ?? false;
  }

  function killHeadsApart(gap: number): Fight {
    const f = fight();
    const heads = [HYDRA_LEFT_ID, HYDRA_CENTER_ID, HYDRA_RIGHT_ID].map((id) => boss(f, id));
    put(f, f.tank, 0, 90);
    for (const h of heads) engage(f, h);
    run(f, 0.2);
    for (const h of heads) {
      f.sim.ctx.handleDeath(h, f.tank);
      run(f, gap);
    }
    return f;
  }

  it('All Heads Down: three heads within 10 s earn it, a slow kill does not', () => {
    const quick = killHeadsApart(4);
    expect(earned(quick, quick.tank, 'dgn_mere_hydra')).toBe(true);
    expect(earned(quick, quick.others[0], 'dgn_mere_hydra')).toBe(true);
    const slow = killHeadsApart(6);
    expect(earned(slow, slow.tank, 'dgn_mere_hydra')).toBe(false);
  });

  it('Every Voice in Tune: a clean kill earns it, a lone Chorus spoils it', () => {
    const clean = fight();
    const b = boss(clean, SELTHE_ID);
    put(clean, clean.tank, 0, 6);
    engage(clean, b);
    run(clean, 1);
    clean.sim.ctx.handleDeath(b, clean.tank);
    run(clean, 0.2);
    expect(earned(clean, clean.tank, 'dgn_selthe_pitch')).toBe(true);

    const f = fight();
    const b2 = boss(f, SELTHE_ID);
    put(f, f.tank, 0, 6);
    put(f, f.others[0], -10, -4);
    put(f, f.others[1], 10, -4);
    engage(f, b2);
    run(f, SELTHE_TUNING.chorusFirst + 0.1);
    const lone = [f.tank, ...f.others].find((p) => hasAura(p, SELTHE_CHORUS_MARK)) as Entity;
    const far = local(f, lone).x > 0 ? -18 : 18;
    const rest = [f.tank, ...f.others].filter((p) => p !== lone);
    run(f, SELTHE_TUNING.markSeconds, () => {
      for (const p of rest) put(f, p, far, 0);
    });
    f.sim.ctx.handleDeath(b2, f.tank);
    run(f, 0.2);
    expect(earned(f, f.tank, 'dgn_selthe_pitch')).toBe(false);
  });

  it('Break the Glass: Reflections broken at once earn it, a kill with no flare does not', () => {
    const f = fight();
    const b = boss(f, COLOSSUS_ID);
    put(f, f.tank, 86, 204);
    engage(f, b);
    run(f, 0.2);
    b.hp = Math.floor(b.maxHp * 0.74);
    run(f, COLOSSUS_TUNING.flareCast + 0.3);
    for (const id of f.inst.mobIds) {
      const e = f.sim.ctx.entities.get(id);
      if (e && !e.dead && e.templateId.startsWith(REFLECTION_ID)) f.sim.ctx.handleDeath(e, f.tank);
    }
    run(f, 0.2);
    f.sim.ctx.handleDeath(b, f.tank);
    run(f, 0.2);
    expect(earned(f, f.tank, 'dgn_colossus_mirror')).toBe(true);

    const g = fight();
    const b2 = boss(g, COLOSSUS_ID);
    put(g, g.tank, 86, 204);
    engage(g, b2);
    run(g, 0.5);
    g.sim.ctx.handleDeath(b2, g.tank);
    run(g, 0.2);
    expect(earned(g, g.tank, 'dgn_colossus_mirror')).toBe(false);
  });

  it('High and Dry: nobody under the Tidal Crash earns it, one caught player spoils it', () => {
    const f = fight();
    const b = boss(f, YSOLEI_ID);
    put(f, f.tank, -24, 206);
    engage(f, b);
    run(f, 1);
    f.sim.ctx.handleDeath(b, f.tank);
    run(f, 0.2);
    expect(earned(f, f.tank, 'dgn_ysolei_high_and_dry')).toBe(true);

    const g = fight();
    const b2 = boss(g, YSOLEI_ID);
    put(g, g.tank, -24, 206);
    engage(g, b2);
    run(g, YSOLEI_TUNING.undertowFirst + 0.05);
    const at = local(g, b2);
    run(g, YSOLEI_TUNING.undertowSeconds + 0.1, () => {
      put(g, g.others[0], at.x + 4, at.z);
    });
    g.sim.ctx.handleDeath(b2, g.tank);
    run(g, 0.2);
    expect(earned(g, g.tank, 'dgn_ysolei_high_and_dry')).toBe(false);
  });
});
