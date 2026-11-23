// Spore Burst (combat/druid_spore_burst.ts): the Moongrove and Groveheart
// ground mushroom. Pins the definition and spec gate, the 5 sec fuse from
// placement to burst, the uncapped heal-and-damage splash, the Groveheart
// Sporemending rider (and its single Verdance stage), the fizzle when the
// caster dies, the replicated readout every viewer reads, and the Nature's
// Boon windows both caster specs arm for it.
import { describe, expect, it } from 'vitest';
import { groundTelegraphWireJson } from '../server/ground_telegraph_wire';
import { decodeSporeBursts } from '../src/net/ground_telegraph_wire';
import { MOONTIDE_STAGES, VERDANCE_STAGES } from '../src/sim/combat/druid_engines';
import {
  GROVEHEART_BOON_ICD,
  MOONGROVE_BOON_ICD,
  NATURES_BOON_ID,
  NATURES_BOON_POWER,
  naturesBoonArmedFor,
  naturesBoonOnCast,
  naturesBoonOnHotTick,
} from '../src/sim/combat/druid_natures_boon';
import {
  SPORE_BURST_FULL_BANK_POWER,
  SPORE_BURST_ID,
  sporeBurstFullBankGlowActive,
} from '../src/sim/combat/druid_spore_burst';
import { ABILITIES } from '../src/sim/content/classes';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity, SimEvent } from '../src/sim/types';
import { DT } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { abilityDisplayDescription, abilityEffectText } from '../src/ui/ability_description';
import { OPEN_FIELD, placePlayerInOpenField } from './helpers/open_field';

const FUSE_TICKS = Math.round(5 / DT);

// biome-ignore lint/suspicious/noExplicitAny: the SimContext shape is internal to Sim.
function rawCtx(sim: Sim): any {
  return (sim as unknown as { ctx: unknown }).ctx;
}

function countDraws(sim: Sim, run: () => void): number {
  let draws = 0;
  rawCtx(sim).rng.setObserver(() => {
    draws++;
  });
  try {
    run();
  } finally {
    rawCtx(sim).rng.setObserver(null);
  }
  return draws;
}

function entity(sim: Sim, id: number): Entity {
  const e = sim.entities.get(id);
  if (!e) throw new Error(`no entity ${id}`);
  return e;
}

function place(sim: Sim, id: number, x: number, z: number): void {
  const e = entity(sim, id);
  e.pos = { x, y: groundHeight(x, z, sim.cfg.seed), z };
  e.prevPos = { ...e.pos };
}

function druid(spec: 'balance' | 'feral' | 'restoration', level = 20) {
  const sim = new Sim({ seed: 4412, playerClass: 'druid', noPlayer: true });
  const pid = sim.addPlayer('druid', 'Sporewright');
  placePlayerInOpenField(sim, pid);
  sim.setPlayerLevel(level, pid);
  if (!sim.setSpec(spec, pid)) throw new Error(`no ${spec} spec`);
  // Frozen AI: a wolf that aggroed during the 5 sec fuse would walk out of
  // the splash (or chew on the allies standing in it).
  sim.setDevMobsFrozen(true);
  const me = entity(sim, pid);
  me.resource = me.maxResource;
  return { sim, pid, me };
}

function ally(sim: Sim, x: number, z: number): Entity {
  const id = sim.addPlayer('warrior', `Ally${sim.entities.size}`);
  sim.setPlayerLevel(20, id);
  place(sim, id, x, z);
  const e = entity(sim, id);
  e.hp = Math.max(1, Math.round(e.maxHp / 4));
  return e;
}

function wolf(sim: Sim, x: number, z: number): Entity {
  const s = sim as unknown as { nextId: number; addEntity(e: Entity): void };
  const mob = createMob(s.nextId++, MOBS.forest_wolf, 20, {
    x,
    y: groundHeight(x, z, sim.cfg.seed),
    z,
  });
  mob.maxHp = 5000;
  mob.hp = 5000;
  mob.hostile = true;
  mob.aiState = 'idle';
  s.addEntity(mob);
  return mob;
}

function knownIds(sim: Sim, pid: number): string[] {
  return sim.players.get(pid)?.known.map((ability) => ability.def.id) ?? [];
}

function tickN(sim: Sim, n: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < n; i++) events.push(...sim.tick());
  return events;
}

const AIM = { x: OPEN_FIELD.x + 20, z: OPEN_FIELD.z };

describe('Spore Burst: definition and spec gate', () => {
  it('is a ground-aimed 40 yd, 90 mana, 30 sec Nature spell with a 5 sec fuse', () => {
    expect(ABILITIES.spore_burst).toMatchObject({
      id: 'spore_burst',
      name: 'Spore Burst',
      class: 'druid',
      specs: ['balance', 'restoration'],
      learnLevel: 10,
      cost: 90,
      castTime: 0,
      cooldown: 30,
      range: 40,
      school: 'nature',
      targetMode: 'position',
    });
    expect(ABILITIES.spore_burst.effects).toEqual([
      { type: 'sporeBurst', min: 250, max: 250, healMin: 250, healMax: 250, radius: 8, fuse: 5 },
    ]);
  });

  it('Moongrove and Groveheart learn it at level 10; Wildfang never does', () => {
    expect(knownIds(druid('balance', 10).sim, druid('balance', 10).pid)).toContain('spore_burst');
    const grove = druid('restoration', 10);
    expect(knownIds(grove.sim, grove.pid)).toContain('spore_burst');
    const low = druid('restoration', 9);
    expect(knownIds(low.sim, low.pid)).not.toContain('spore_burst');
    const fang = druid('feral');
    expect(knownIds(fang.sim, fang.pid)).not.toContain('spore_burst');
  });
});

describe('Spore Burst: the mushroom', () => {
  it('plants at the aimed point and spends the mana and the cooldown on the press', () => {
    const { sim, pid, me } = druid('balance');
    const mana = me.resource;
    sim.castAbility('spore_burst', pid, AIM);
    expect(me.resource).toBe(mana - 90);
    expect(me.cooldowns.get('spore_burst')).toBeCloseTo(30, 5);
    const [burst] = sim.activeSporeBursts;
    expect(burst).toMatchObject({ x: AIM.x, z: AIM.z, radius: 8, duration: 5, sourceId: pid });
    expect(burst.remaining).toBeCloseTo(5, 5);
  });

  it('bursts exactly 5 sec after placement, not a tick sooner', () => {
    const { sim, pid } = druid('balance');
    const target = wolf(sim, AIM.x + 1, AIM.z);
    sim.castAbility('spore_burst', pid, AIM);
    const early = tickN(sim, FUSE_TICKS - 1);
    expect(early.some((e) => e.type === 'spellfxAt' && e.fx === 'sporeBurst')).toBe(false);
    expect(target.hp).toBe(5000);
    expect(sim.activeSporeBursts).toHaveLength(1);
    const last = sim.tick();
    expect(last.some((e) => e.type === 'spellfxAt' && e.fx === 'sporeBurst')).toBe(true);
    expect(target.hp).toBeLessThan(5000);
    expect(sim.activeSporeBursts).toEqual([]);
  });

  it('heals every ally in 8 yd, with no target cap', () => {
    const { sim, pid } = druid('balance');
    const allies = Array.from({ length: 9 }, (_, i) => ally(sim, AIM.x + (i - 4), AIM.z + 2));
    const far = ally(sim, AIM.x + 12, AIM.z);
    const hpBefore = allies.map((a) => a.hp);
    sim.castAbility('spore_burst', pid, AIM);
    const events = tickN(sim, FUSE_TICKS);
    for (const [i, a] of allies.entries()) {
      expect(a.hp - hpBefore[i], `ally ${i}`).toBeGreaterThanOrEqual(250);
    }
    const healedIds = new Set(
      events.flatMap((e) => (e.type === 'heal2' && e.sourceId === pid ? [e.targetId] : [])),
    );
    for (const a of allies) expect(healedIds.has(a.id)).toBe(true);
    expect(healedIds.has(far.id)).toBe(false);
  });

  it('damages every enemy in 8 yd, with no target cap', () => {
    const { sim, pid } = druid('balance');
    const wolves = Array.from({ length: 9 }, (_, i) => wolf(sim, AIM.x + (i - 4), AIM.z - 2));
    const far = wolf(sim, AIM.x + 12, AIM.z);
    sim.castAbility('spore_burst', pid, AIM);
    tickN(sim, FUSE_TICKS);
    // Every struck wolf took at least the authored 250 (Moongrove's spec
    // damage bonus and the AoE Spell Power rider only add to it).
    for (const w of wolves) expect(5000 - w.hp).toBeGreaterThanOrEqual(250);
    expect(far.hp).toBe(5000);
  });

  it('Groveheart plants Sporemending on every ally it heals and banks one Verdance', () => {
    const { sim, pid, me } = druid('restoration');
    const allies = Array.from({ length: 4 }, (_, i) => ally(sim, AIM.x + i, AIM.z));
    sim.castAbility('spore_burst', pid, AIM);
    tickN(sim, FUSE_TICKS);
    for (const a of allies) {
      expect(
        a.auras.some(
          (aura) => aura.id === 'rejuvenation' && aura.kind === 'hot' && aura.sourceId === pid,
        ),
      ).toBe(true);
    }
    const verdance = me.auras.find((aura) => aura.id === 'verdance');
    expect(verdance?.stacks ?? 0).toBe(1);
  });

  it('Moongrove plants no Sporemending', () => {
    const { sim, pid } = druid('balance');
    const a = ally(sim, AIM.x, AIM.z);
    sim.castAbility('spore_burst', pid, AIM);
    tickN(sim, FUSE_TICKS);
    expect(a.auras.some((aura) => aura.id === 'rejuvenation')).toBe(false);
  });

  it('fizzles when the caster dies before the burst', () => {
    const { sim, pid, me } = druid('balance');
    const target = wolf(sim, AIM.x, AIM.z);
    sim.castAbility('spore_burst', pid, AIM);
    tickN(sim, 20);
    me.dead = true;
    me.hp = 0;
    const events = tickN(sim, FUSE_TICKS);
    expect(events.some((e) => e.type === 'spellfxAt' && e.fx === 'sporeBurst')).toBe(false);
    expect(target.hp).toBe(5000);
    expect(sim.activeSporeBursts).toEqual([]);
  });

  it('draws nothing while it grows', () => {
    const { sim, pid } = druid('balance');
    sim.castAbility('spore_burst', pid, AIM);
    const ground = rawCtx(sim).groundAoEs.find((g: { sporeBurst?: unknown }) => g.sporeBurst);
    expect(ground).toBeDefined();
    // Advance the fuse by hand through the roster tick: no rng while growing.
    const draws = countDraws(sim, () => {
      for (let i = 0; i < 10; i++) ground.remaining -= DT;
    });
    expect(draws).toBe(0);
  });
});

describe('Spore Burst: the replicated mushroom', () => {
  it('rides the ground-telegraph wire with its caster, and decodes back', () => {
    const { sim, pid } = druid('balance');
    sim.castAbility('spore_burst', pid, AIM);
    tickN(sim, 20);
    const json = groundTelegraphWireJson(
      {
        activeFrostRings: [],
        activeIgnivarMeteors: [],
        activeTemporalHourglasses: [],
        activeConsecrations: [],
        activeSporeBursts: sim.activeSporeBursts,
        varkhulEncounter: {
          activeVarkhulForgestormWarnings: [],
          activeVarkhulCinderFires: [],
          activeVarkhulCinderOrbProjectiles: [],
          activeVarkhulAnvilMeteors: [],
          activeVarkhulAssemblies: [],
        },
        nythraxisEncounter: {
          activeNythraxisGraveEruptions: [],
          activeNythraxisGraveFlames: [],
          activeNythraxisGravefires: [],
          activeNythraxisBindingSigils: [],
        },
        interestQueryRadius: 120,
        eventRadius: 120,
      },
      { x: AIM.x, z: AIM.z },
      120,
    );
    const frame = JSON.parse(`{${json.slice(1)}}`) as { sporeBursts: unknown };
    const [decoded] = decodeSporeBursts(frame.sporeBursts);
    expect(decoded).toMatchObject({ x: AIM.x, z: AIM.z, radius: 8, duration: 5, sourceId: pid });
    expect(decoded.remaining).toBeCloseTo(4, 1);
    // A malformed row is dropped, never rendered.
    expect(decodeSporeBursts([{ id: 'x', x: 1, z: 1, r: 8, dur: 5, rem: 2 }])).toEqual([]);
  });
});

describe("Spore Burst: Nature's Boon", () => {
  function armedFor(me: Entity): string[] {
    return me.auras.find((aura) => aura.id === NATURES_BOON_ID)?.empowerAbilities ?? [];
  }

  it('Moongrove: Wildbolt and Skyfall roll it behind a 10 sec cooldown; nothing else rolls', () => {
    const { sim, me } = druid('balance');
    const ctx = rawCtx(sim);
    expect(countDraws(sim, () => naturesBoonOnCast(ctx, me, 'moonfire'))).toBe(0);
    let casts = 0;
    while (armedFor(me).length === 0 && casts < 500) {
      naturesBoonOnCast(ctx, me, casts % 2 === 0 ? 'wrath' : 'starfire');
      casts++;
    }
    expect(armedFor(me)).toEqual(['spore_burst']);
    expect(me.procState?.icds.dru_moon_natures_boon).toBe(MOONGROVE_BOON_ICD);
    // Inside the cooldown the roll is not even drawn.
    expect(countDraws(sim, () => naturesBoonOnCast(ctx, me, 'wrath'))).toBe(0);
  });

  it('Groveheart: an owned HoT tick rolls it behind a 10 sec cooldown', () => {
    const { sim, me } = druid('restoration');
    const ctx = rawCtx(sim);
    const hot = { id: 'rejuvenation', kind: 'hot', sourceId: me.id } as Aura;
    let ticks = 0;
    while (armedFor(me).length === 0 && ticks < 500) {
      naturesBoonOnHotTick(ctx, me, hot);
      ticks++;
    }
    expect(armedFor(me)).toEqual(['spore_burst']);
    expect(me.procState?.icds.dru_grove_natures_boon).toBe(GROVEHEART_BOON_ICD);
  });

  it('neither hook draws for a Wildfang druid', () => {
    const { sim, me } = druid('feral');
    const ctx = rawCtx(sim);
    const hot = { id: 'rejuvenation', kind: 'hot', sourceId: me.id } as Aura;
    expect(
      countDraws(sim, () => {
        naturesBoonOnCast(ctx, me, 'wrath');
        naturesBoonOnHotTick(ctx, me, hot);
      }),
    ).toBe(0);
  });

  it('an armed window makes Spore Burst free and 25% stronger', () => {
    const plain = druid('balance');
    const plainWolf = wolf(plain.sim, AIM.x, AIM.z);
    plain.sim.castAbility('spore_burst', plain.pid, AIM);
    tickN(plain.sim, FUSE_TICKS);
    const plainDamage = 5000 - plainWolf.hp;

    const boon = druid('balance');
    const boonWolf = wolf(boon.sim, AIM.x, AIM.z);
    boon.me.auras.push({
      id: NATURES_BOON_ID,
      name: "Nature's Boon",
      kind: 'next_cast_free',
      remaining: 10,
      duration: 10,
      value: 0,
      sourceId: boon.pid,
      school: 'nature',
      empowerAbilities: ['spore_burst'],
    } as Aura);
    expect(naturesBoonArmedFor(boon.me.auras, SPORE_BURST_ID)).toBe(true);
    const mana = boon.me.resource;
    boon.sim.castAbility('spore_burst', boon.pid, AIM);
    expect(boon.me.resource).toBe(mana);
    expect(boon.me.auras.some((aura) => aura.id === NATURES_BOON_ID)).toBe(false);
    tickN(boon.sim, FUSE_TICKS);
    const boonDamage = 5000 - boonWolf.hp;
    // Same seed and actors, so only the multiplier differs (rounding aside).
    expect(boonDamage).toBeGreaterThanOrEqual(Math.round(plainDamage * NATURES_BOON_POWER) - 1);
    expect(boonDamage).toBeLessThanOrEqual(Math.round(plainDamage * NATURES_BOON_POWER) + 1);
  });
});

describe('Spore Burst: the full-bank payoff', () => {
  function bank(me: Entity, id: 'verdance' | 'moontide', stacks: number): void {
    me.auras.push({
      id,
      name: id === 'verdance' ? 'Verdance' : 'Moontide',
      kind: id,
      remaining: 3600,
      duration: 3600,
      value: 0,
      stacks,
      sourceId: me.id,
      school: 'nature',
    } as Aura);
  }

  function burstDamage(spec: 'balance' | 'restoration', stacks: number | null): number {
    const d = druid(spec);
    const target = wolf(d.sim, AIM.x, AIM.z);
    if (stacks !== null) bank(d.me, spec === 'balance' ? 'moontide' : 'verdance', stacks);
    d.sim.castAbility('spore_burst', d.pid, AIM);
    tickN(d.sim, FUSE_TICKS);
    return 5000 - target.hp;
  }

  it('3 Moontide makes it 25% stronger, spends the bank, and still costs its mana', () => {
    const plain = burstDamage('balance', null);
    const banked = burstDamage('balance', MOONTIDE_STAGES);
    expect(Math.abs(banked - Math.round(plain * SPORE_BURST_FULL_BANK_POWER))).toBeLessThanOrEqual(
      1,
    );
    const d = druid('balance');
    bank(d.me, 'moontide', MOONTIDE_STAGES);
    const mana = d.me.resource;
    d.sim.castAbility('spore_burst', d.pid, AIM);
    expect(d.me.resource).toBe(mana - 90);
    expect(d.me.auras.find((aura) => aura.id === 'moontide')?.stacks ?? 0).toBe(0);
  });

  it('full Verdance does the same for Groveheart; a partial bank does nothing', () => {
    const plain = burstDamage('restoration', null);
    expect(burstDamage('restoration', VERDANCE_STAGES - 1)).toBe(plain);
    const banked = burstDamage('restoration', VERDANCE_STAGES);
    expect(Math.abs(banked - Math.round(plain * SPORE_BURST_FULL_BANK_POWER))).toBeLessThanOrEqual(
      1,
    );
    const d = druid('restoration');
    bank(d.me, 'verdance', VERDANCE_STAGES);
    d.sim.castAbility('spore_burst', d.pid, AIM);
    expect(d.me.auras.find((aura) => aura.id === 'verdance')?.stacks ?? 0).toBe(0);
    // A partial bank is kept.
    const p = druid('restoration');
    bank(p.me, 'verdance', VERDANCE_STAGES - 1);
    p.sim.castAbility('spore_burst', p.pid, AIM);
    expect(p.me.auras.find((aura) => aura.id === 'verdance')?.stacks).toBe(VERDANCE_STAGES - 1);
  });

  it('the action bar glow reads the same full-bank predicate', () => {
    const owner = 7;
    const full = [{ id: 'moontide', stacks: MOONTIDE_STAGES, sourceId: owner }];
    expect(sporeBurstFullBankGlowActive(full, owner, 'spore_burst')).toBe(true);
    expect(sporeBurstFullBankGlowActive(full, owner, 'wrath')).toBe(false);
    expect(sporeBurstFullBankGlowActive(full, owner + 1, 'spore_burst')).toBe(false);
    expect(
      sporeBurstFullBankGlowActive(
        [{ id: 'verdance', stacks: VERDANCE_STAGES - 1, sourceId: owner }],
        owner,
        'spore_burst',
      ),
    ).toBe(false);
  });
});

describe("Nature's Boon: the spellbook passive", () => {
  it('every committed druid spec knows it at level 10 as a passive', () => {
    expect(ABILITIES.natures_boon).toMatchObject({ class: 'druid', passive: true, learnLevel: 10 });
    for (const spec of ['feral', 'balance', 'restoration'] as const) {
      const d = druid(spec);
      expect(knownIds(d.sim, d.pid)).toContain('natures_boon');
    }
  });

  it('teaches each spec its own trigger', () => {
    const def = ABILITIES.natures_boon;
    expect(def.specNotes?.feral).toContain('auto-attack');
    expect(def.specNotes?.balance).toContain('Wildbolt or Skyfall');
    expect(def.specNotes?.restoration).toContain('heal-over-time');
  });
});

describe('Spore Burst: tooltip', () => {
  it('prints the live fuse, heal and damage from the resolved ability', () => {
    const { sim, pid } = druid('balance');
    const res = sim.players.get(pid)?.known.find((ability) => ability.def.id === 'spore_burst');
    if (!res) throw new Error('spore_burst not known');
    const text = abilityDisplayDescription(res, abilityEffectText(res));
    expect(text).toContain('After 5 sec it bursts');
    expect(text).toContain('healing allies for 250');
    // Moongrove's spec damage bonus is baked into the resolved damage half
    // (250 x 1.23), exactly what a cast deals before Spell Power.
    expect(text).toContain('dealing 308 Nature damage');
    expect(text).toContain('within 8 yards');
  });
});
