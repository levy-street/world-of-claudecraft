import { describe, expect, it } from 'vitest';
import { onCastCompleted } from '../src/sim/combat/talent_procs';
import { CHOICE_ROWS } from '../src/sim/content/choice_rows';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, PlayerClass, SimEvent } from '../src/sim/types';

// The rogue v0.29 row redesign (docs/design/rogue-v029-class-design.md): themed
// tiers ending in a capstone. This suite pins the grid shape and gives every new
// mechanic a decisive assertion that fails on regression.

function rig(rows: Record<number, string>, spec: string | null = null) {
  const sim = new Sim({ seed: 17, playerClass: 'rogue' as PlayerClass, autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows })).toBe(true);
  const p = sim.player;
  p.resource = p.maxResource;
  return { sim, p };
}

function addTargetMob(sim: Sim, hp = 100000, dist = 3, id = 9200): Entity {
  const p = sim.player;
  const mob = createMob(id, MOBS.forest_wolf, 20, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + dist,
  });
  mob.hostile = true;
  mob.maxHp = mob.hp = hp;
  (sim as unknown as { addEntity(e: Entity): void }).addEntity(mob);
  sim.targetEntity(mob.id);
  p.facing = 0;
  return mob;
}

// Stealth tests stage the mob outside aggro range, enter Duskveil in peace, then
// step into melee for the strike (the wolf would otherwise break stealth first).
function stepIntoMelee(sim: Sim, mob: Entity): void {
  sim.player.pos.x = mob.pos.x;
  sim.player.pos.z = mob.pos.z - 2;
  sim.player.facing = 0;
}

function simDealDamage(sim: Sim, source: Entity | null, target: Entity, amount: number): void {
  (
    sim as unknown as {
      dealDamage(
        s: Entity | null,
        t: Entity,
        n: number,
        c: boolean,
        sc: string,
        a: string | null,
        k: string,
      ): void;
    }
  ).dealDamage(source, target, amount, false, 'physical', null, 'hit');
}

// A melee special can miss or be dodged on the fixed test seed; retry until the
// predicate holds so the assertions test the mechanic, not one hit-table roll.
function castUntil(sim: Sim, ability: string, ok: () => boolean, combo = 0): void {
  for (let attempt = 0; attempt < 6 && !ok(); attempt++) {
    if (combo > 0) sim.player.comboPoints = combo;
    sim.player.resource = sim.player.maxResource;
    sim.castAbility(ability);
    sim.player.autoAttack = false;
    for (let i = 0; i < 5; i++) sim.tick();
  }
  expect(ok()).toBe(true);
}

function completeCast(sim: Sim, ability: string, target: Entity | null = null): void {
  onCastCompleted(
    (sim as unknown as { ctx: Parameters<typeof onCastCompleted>[0] }).ctx,
    sim.player,
    ability,
    target,
  );
}

describe('rogue v0.29 row grid', () => {
  it('publishes exactly the six themed rows and eighteen approved options', () => {
    const rows = CHOICE_ROWS.rogue.rows;
    expect(rows.map((row) => row.level)).toEqual([5, 8, 11, 14, 17, 20]);
    expect(rows.map((row) => row.theme)).toEqual([
      'movement',
      'defense',
      'control',
      'kit_management',
      'major_window',
      'capstone',
    ]);
    expect(rows.map((row) => row.options.map((option) => option.id))).toEqual([
      ['rog_r5_shadeslip', 'rog_r5_killers_pace', 'rog_r5_slipstream'],
      ['rog_r8_borrowed_breath', 'rog_r8_ghostfoot_ward', 'rog_r8_smoke_screen'],
      ['rog_r11_marked_prey', 'rog_r11_foul_play', 'rog_r11_cheap_trick'],
      ['rog_r14_dusk_economy', 'rog_r14_venom_dividend', 'rog_r14_ceaseless_cuts'],
      ['rog_r17_flurry_of_knives', 'rog_r17_ghostfoot_gambit', 'rog_r17_thieves_chorus'],
      ['rog_r20_second_shadow', 'rog_r20_deathmark', 'rog_r20_kill_chain'],
    ]);
  });

  it('the capstone row grants no new action and the movement row adds no damage', () => {
    const rows = CHOICE_ROWS.rogue.rows;
    const capstone = rows.find((row) => row.level === 20);
    for (const option of capstone?.options ?? []) {
      expect(option.effect.grant, `${option.id} must not grant a button`).toBeUndefined();
    }
    const movement = rows.find((row) => row.level === 5);
    for (const option of movement?.options ?? []) {
      expect(option.effect.global?.meleeDmgPct ?? 0).toBe(0);
      for (const mod of option.effect.ability ?? []) {
        expect(mod.dmgPct ?? 0).toBe(0);
      }
    }
  });
});

describe('Kill Chain (capstone)', () => {
  it('killing blows grant 5 combo points and refresh Smokestep; without the option neither happens', () => {
    const { sim, p } = rig({ 20: 'rog_r20_kill_chain' });
    const victim = addTargetMob(sim, 10, 3);
    p.cooldowns.set('vanish', 200);
    p.comboPoints = 0;
    simDealDamage(sim, p, victim, 50);
    expect(victim.dead).toBe(true);
    expect(p.comboPoints).toBe(5);
    expect(p.cooldowns.has('vanish')).toBe(false);

    const plain = rig({});
    const victim2 = addTargetMob(plain.sim, 10, 3, 9300);
    plain.p.cooldowns.set('vanish', 200);
    plain.p.comboPoints = 0;
    simDealDamage(plain.sim, plain.p, victim2, 50);
    expect(victim2.dead).toBe(true);
    expect(plain.p.comboPoints).toBe(0);
    expect(plain.p.cooldowns.has('vanish')).toBe(true);
  });
});

describe('Second Shadow (capstone)', () => {
  function finisherEvents(
    rows: Record<number, string>,
    combo: number,
  ): { events: SimEvent[]; playerId: number } {
    const { sim, p } = rig(rows);
    addTargetMob(sim, 100000, 3);
    p.comboPoints = combo;
    p.resource = p.maxResource;
    // sim.events is a per-tick buffer, so collect it after the synchronous cast
    // and again after every tick.
    sim.events.length = 0;
    sim.castAbility('eviscerate');
    const collected: SimEvent[] = [...sim.events];
    for (let i = 0; i < 5; i++) {
      sim.tick();
      collected.push(...sim.events);
    }
    return { events: collected, playerId: p.id };
  }

  it('a 5-combo Dirt Nap strikes again at the shipped fraction of the resolved hit, never critting', () => {
    const { events, playerId } = finisherEvents({ 20: 'rog_r20_second_shadow' }, 5);
    const hits = events.filter(
      (
        e,
      ): e is SimEvent & {
        amount: number;
        crit: boolean;
        ability: string | null;
        sourceId: number;
      } => e.type === 'damage' && (e as { sourceId?: number }).sourceId === playerId,
    );
    const main = hits.find((e) => e.ability !== 'Second Shadow');
    const echo = hits.find((e) => e.ability === 'Second Shadow');
    expect(main).toBeDefined();
    expect(echo).toBeDefined();
    expect(echo?.crit).toBe(false);
    expect(echo?.amount).toBe(Math.round((main?.amount ?? 0) * 0.75));
  });

  it('a 4-combo Dirt Nap does not echo, and without the option 5 combo does not echo', () => {
    const four = finisherEvents({ 20: 'rog_r20_second_shadow' }, 4);
    expect(four.events.some((e) => e.type === 'damage' && e.ability === 'Second Shadow')).toBe(
      false,
    );
    const untalented = finisherEvents({}, 5);
    expect(
      untalented.events.some((e) => e.type === 'damage' && e.ability === 'Second Shadow'),
    ).toBe(false);
  });
});

describe('Grave Brand (capstone)', () => {
  it('a Duskveil opener brands the target; only the brander deals 12% more to it', () => {
    const { sim, p } = rig({ 20: 'rog_r20_deathmark' });
    const mob = addTargetMob(sim, 100000, 30);
    sim.castAbility('stealth');
    for (let i = 0; i < 25; i++) sim.tick();
    expect(p.auras.some((a) => a.kind === 'stealth')).toBe(true);
    stepIntoMelee(sim, mob);
    p.resource = p.maxResource;
    sim.castAbility('cheap_shot');
    for (let i = 0; i < 5; i++) sim.tick();
    const brand = mob.auras.find((a) => a.id === 'deathmark');
    expect(brand?.kind).toBe('vuln_source');
    expect(brand?.value).toBeCloseTo(0.12);
    expect(brand?.sourceId).toBe(p.id);

    const before = mob.hp;
    simDealDamage(sim, p, mob, 1000);
    expect(before - mob.hp).toBe(1120);

    const neutral = mob.hp;
    simDealDamage(sim, null, mob, 1000);
    expect(neutral - mob.hp).toBe(1000);
  });
});

describe('Dusk Economy (kit management)', () => {
  it('halves energy costs in Duskveil, keeps them halved for the 6 sec linger, then reverts', () => {
    const { sim, p } = rig({ 14: 'rog_r14_dusk_economy' });
    const mob = addTargetMob(sim, 100000, 30);
    sim.castAbility('stealth');
    for (let i = 0; i < 25; i++) sim.tick();
    expect(p.auras.some((a) => a.kind === 'stealth')).toBe(true);
    stepIntoMelee(sim, mob);

    // Wicked Slash costs 45; from Duskveil it bills ceil(45 * 0.5) = 23 and the
    // damage breaks stealth, which starts the linger aura.
    p.resource = 100;
    sim.castAbility('sinister_strike');
    for (let i = 0; i < 3; i++) sim.tick();
    expect(p.resource).toBeGreaterThanOrEqual(100 - 23 - 2); // regen jitter tolerance
    expect(p.resource).toBeLessThan(100 - 16);
    expect(p.auras.some((a) => a.id === 'dusk_economy')).toBe(true);

    // Inside the linger window the discount persists.
    for (let i = 0; i < 20; i++) sim.tick(); // 1 sec into the 6 sec window
    p.resource = 100;
    sim.castAbility('sinister_strike');
    for (let i = 0; i < 3; i++) sim.tick();
    expect(p.resource).toBeGreaterThanOrEqual(100 - 23 - 2);

    // After the linger expires the full cost returns.
    for (let i = 0; i < 20 * 7; i++) sim.tick();
    expect(p.auras.some((a) => a.id === 'dusk_economy')).toBe(false);
    p.resource = 100;
    sim.castAbility('sinister_strike');
    for (let i = 0; i < 3; i++) sim.tick();
    expect(p.resource).toBeLessThanOrEqual(100 - 45 + 4); // full 45 spent, minus tick regen
  });
});

describe('Cheap Trick (control)', () => {
  it('Gut Punch works unstealthed with the option and is rejected without it', () => {
    const { sim, p } = rig({ 11: 'rog_r11_cheap_trick' });
    const mob = addTargetMob(sim, 100000, 2);
    expect(p.auras.some((a) => a.kind === 'stealth')).toBe(false);
    p.resource = p.maxResource;
    sim.castAbility('cheap_shot');
    for (let i = 0; i < 5; i++) sim.tick();
    expect(mob.auras.some((a) => a.kind === 'stun')).toBe(true);
    expect(p.comboPoints).toBe(2);

    const plain = rig({});
    addTargetMob(plain.sim, 100000, 2, 9310);
    plain.p.resource = plain.p.maxResource;
    const spent = plain.p.resource;
    plain.sim.castAbility('cheap_shot');
    for (let i = 0; i < 5; i++) plain.sim.tick();
    expect(plain.p.comboPoints).toBe(0);
    expect(plain.p.resource).toBeGreaterThanOrEqual(spent - 2); // nothing was billed
  });
});

describe('Foul Play (control)', () => {
  it('Eye Jab costs no energy, survives the caster dot tick, and still breaks on a direct hit', () => {
    const { sim, p } = rig({ 11: 'rog_r11_foul_play' });
    const mob = addTargetMob(sim, 100000, 2);
    // The caster's own bleed, ticking every 2 sec. White swings are direct hits
    // and would break the incap, so auto-attack stays off (castUntil does both).
    castUntil(sim, 'rupture', () => mob.auras.some((a) => a.kind === 'dot'), 5);

    p.resource = p.maxResource;
    const beforeGouge = p.resource;
    castUntil(sim, 'gouge', () => mob.auras.some((a) => a.kind === 'incapacitate'));
    expect(p.resource).toBeGreaterThanOrEqual(beforeGouge - 2); // free cast

    // Ride out at least one full bleed interval (2 sec ticks) while staying
    // inside the 4 sec incapacitate: the caster's own dot must not break it.
    for (let i = 0; i < 45; i++) sim.tick();
    expect(mob.auras.some((a) => a.kind === 'incapacitate')).toBe(true);

    // A direct hit still breaks the incapacitate.
    simDealDamage(sim, p, mob, 50);
    expect(mob.auras.some((a) => a.kind === 'incapacitate')).toBe(false);
  });

  it("without Foul Play the caster's own dot tick breaks Eye Jab", () => {
    const { sim } = rig({});
    const mob = addTargetMob(sim, 100000, 2, 9320);
    castUntil(sim, 'rupture', () => mob.auras.some((a) => a.kind === 'dot'), 5);
    castUntil(sim, 'gouge', () => mob.auras.some((a) => a.kind === 'incapacitate'));
    for (let i = 0; i < 20 * 4 && mob.auras.some((a) => a.kind === 'incapacitate'); i++) {
      sim.tick();
    }
    expect(mob.auras.some((a) => a.kind === 'incapacitate')).toBe(false);
  });
});

describe('Marked Prey (control)', () => {
  it('a Low Blow stun brands the target so everyone deals 10% more to it for the window', () => {
    const { sim, p } = rig({ 11: 'rog_r11_marked_prey' });
    const mob = addTargetMob(sim, 100000, 2);
    p.comboPoints = 5;
    p.resource = p.maxResource;
    sim.castAbility('kidney_shot');
    for (let i = 0; i < 5; i++) sim.tick();
    const mark = mob.auras.find((a) => a.id === 'marked_prey');
    expect(mark?.kind).toBe('vulnerability');
    expect(mark?.value).toBeCloseTo(0.1);

    const before = mob.hp;
    simDealDamage(sim, null, mob, 1000); // an unrelated source benefits too
    expect(before - mob.hp).toBe(1100);
  });
});

describe('Ghostfoot Ward (defense)', () => {
  it('Ghostfoot also carries a 30% damage cut for its full duration', () => {
    const { sim, p } = rig({ 8: 'rog_r8_ghostfoot_ward' });
    addTargetMob(sim, 100000, 30);
    // Small calibrated hits: a level 20 rogue has ~510 max health, so measure
    // the cut as a ratio of a 200 control hit with a heal between.
    const controlBefore = p.hp;
    simDealDamage(sim, null, p, 200);
    const unwarded = controlBefore - p.hp;
    expect(unwarded).toBeGreaterThan(0);
    p.hp = p.maxHp;

    sim.castAbility('evasion');
    for (let i = 0; i < 3; i++) sim.tick();
    const ward = p.auras.find((a) => a.kind === 'shield_wall');
    const dodge = p.auras.find((a) => a.kind === 'buff_dodge' && a.id === 'evasion');
    expect(ward?.value).toBeCloseTo(0.3);
    expect(ward?.duration).toBe(dodge?.duration);

    const before = p.hp;
    simDealDamage(sim, null, p, 200);
    const warded = before - p.hp;
    expect(Math.abs(warded - Math.round(unwarded * 0.7))).toBeLessThanOrEqual(2);
  });
});

describe("Quickstep and Killer's Pace (movement)", () => {
  it('a landed builder grants the speed burst once per 8 sec internal cooldown', () => {
    const { sim, p } = rig({ 5: 'rog_r5_slipstream' });
    completeCast(sim, 'sinister_strike');
    const burst = p.auras.find((a) => a.id === 'rog_slipstream');
    expect(burst?.kind).toBe('buff_speed');
    expect(burst?.value).toBeCloseTo(1.2);
    // Inside the internal cooldown a second builder must not refresh the aura.
    for (let i = 0; i < 20; i++) sim.tick(); // 1 sec: aura runs down toward expiry
    const remainingBefore = p.auras.find((a) => a.id === 'rog_slipstream')?.remaining ?? 0;
    completeCast(sim, 'sinister_strike');
    const remainingAfter = p.auras.find((a) => a.id === 'rog_slipstream')?.remaining ?? 0;
    expect(remainingAfter).toBeLessThanOrEqual(remainingBefore);
  });

  it('a killing blow grants the pursuit speed burst', () => {
    const { sim, p } = rig({ 5: 'rog_r5_killers_pace' });
    const victim = addTargetMob(sim, 10, 3);
    simDealDamage(sim, p, victim, 50);
    expect(victim.dead).toBe(true);
    const pursuit = p.auras.find((a) => a.id === 'pursuit');
    expect(pursuit?.kind).toBe('buff_speed');
    expect(pursuit?.value).toBeCloseTo(1.4);
  });
});

describe('the level 17 grants', () => {
  it('Flurry of Knives lashes every nearby enemy and awards 2 combo points', () => {
    const { sim, p } = rig({ 17: 'rog_r17_flurry_of_knives' });
    const near = addTargetMob(sim, 100000, 3);
    const alsoNear = addTargetMob(sim, 100000, 4, 9330);
    sim.targetEntity(near.id);
    p.comboPoints = 0;
    p.resource = p.maxResource;
    sim.castAbility('flurry_of_knives');
    for (let i = 0; i < 5; i++) sim.tick();
    expect(near.hp).toBeLessThan(near.maxHp);
    expect(alsoNear.hp).toBeLessThan(alsoNear.maxHp);
    expect(p.comboPoints).toBe(2);
  });

  it("Thieves' Chorus hastes the caster and applies the shared exhaustion", () => {
    const { sim, p } = rig({ 17: 'rog_r17_thieves_chorus' });
    p.resource = p.maxResource;
    sim.castAbility('thieves_chorus');
    for (let i = 0; i < 3; i++) sim.tick();
    const haste = p.auras.find((a) => a.id === 'thieves_chorus');
    expect(haste?.value).toBeCloseTo(1.1);
    expect(p.auras.some((a) => a.kind === 'sated')).toBe(true);
  });
});
