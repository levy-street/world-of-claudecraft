import { describe, expect, it } from 'vitest';
import {
  BRUIN_RUSH_WINDOW_ID,
  BRUIN_RUSH_WINDOW_SECONDS,
  LOPING_STRIDE_DURATION,
  LOPING_STRIDE_ICD,
  LOPING_STRIDE_SPEED,
  longstrideMetrics,
  PIN_DURATION,
  PIN_ID,
  PIN_SLOW_MULT,
} from '../src/sim/combat/druid_engines';
import { lungePendingTargetId } from '../src/sim/combat/druid_lunge';
import { DRUID_CHOICE_ROWS } from '../src/sim/content/choice_rows_classic';
import { abilitiesKnownAt, CLASSES } from '../src/sim/content/classes';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { moveSpeedMult } from '../src/sim/player_motion';
import { Sim } from '../src/sim/sim';
import { stunDrCategory } from '../src/sim/stun_dr';
import { CAT_FORM_MOVE_MULT, dist2d, type Entity, MELEE_RANGE } from '../src/sim/types';
import { localizeSimAuraName } from '../src/ui/sim_i18n';

// Wildfang kit pass 2 (engage, control, opener): the baseline shift sprint and
// its Longstride talent, the Bruin Rush to Cat Form Pin rider, full-speed
// Stalk, the Lunge shape of Slinkstrike, and the Takedown finisher. Every
// case drives the real cast path (Sim.castAbility plus ticks) so the cost gate,
// the replacement resolver, and the aura funnels are the ones the game runs.

const LONGSTRIDE_ROW = 5;
const LONGSTRIDE_ID = 'dru_r5_ferocity';

function rig(rows: Record<number, string> = {}, spec: string | null = 'feral', seed = 29) {
  const sim = new Sim({ seed, playerClass: 'druid', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows })).toBe(true);
  const player = sim.player;
  player.resource = player.maxResource;
  return { sim, player };
}

function ticks(sim: Sim, seconds: number): void {
  for (let i = 0; i < Math.round(20 * seconds); i++) sim.tick();
}

function cast(sim: Sim, abilityId: string, settleSeconds = 0.05): void {
  sim.player.gcdRemaining = 0;
  sim.castAbility(abilityId);
  ticks(sim, settleSeconds);
}

function aura(entity: Entity, id: string) {
  return entity.auras.find((a) => a.id === id);
}

function inForm(entity: Entity, kind: 'form_bear' | 'form_cat'): boolean {
  return entity.auras.some((a) => a.kind === kind);
}

function dropAura(entity: Entity, id: string): void {
  entity.auras = entity.auras.filter((a) => a.id !== id);
}

// A hostile, effectively unkillable wolf dist yards in front of the druid,
// targeted and faced (the sim.test.ts idiom).
function addTargetMob(sim: Sim, dist: number, id = 9820): Entity {
  const player = sim.player;
  const mob = createMob(id, MOBS.forest_wolf, 20, {
    x: player.pos.x,
    y: player.pos.y,
    z: player.pos.z + dist,
  });
  mob.hostile = true;
  mob.maxHp = mob.hp = 1_000_000;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  sim.targetEntity(mob.id);
  player.facing = 0;
  return mob;
}

describe('Loping Stride is baseline and Longstride retunes it', () => {
  it('grants the sprint on any form shift with no talent selected', () => {
    const { sim, player } = rig();
    expect(moveSpeedMult(player)).toBe(1);
    cast(sim, 'bear_form');
    const stride = aura(player, 'loping_stride');
    expect(stride?.kind).toBe('buff_speed');
    expect(stride?.value).toBe(LOPING_STRIDE_SPEED);
    expect(stride?.duration).toBe(LOPING_STRIDE_DURATION);
    expect(moveSpeedMult(player)).toBeCloseTo(1.6);
  });

  it('holds the baseline 20 sec internal cooldown between shifts', () => {
    const { sim, player } = rig();
    cast(sim, 'cat_form');
    expect(aura(player, 'loping_stride')).toBeDefined();
    dropAura(player, 'loping_stride');
    cast(sim, 'bear_form');
    expect(aura(player, 'loping_stride')).toBeUndefined();
    // One tick short of the cooldown: still held.
    ticks(sim, LOPING_STRIDE_ICD - 1);
    cast(sim, 'cat_form');
    expect(aura(player, 'loping_stride')).toBeUndefined();
    ticks(sim, 1.1);
    cast(sim, 'bear_form');
    expect(aura(player, 'loping_stride')).toBeDefined();
  });

  it('Longstride makes the sprint last 5 sec on a 12 sec cooldown', () => {
    expect(longstrideMetrics()).toEqual({ duration: 5, icd: 12 });
    // Memoised: one read of the row table, the same object every call.
    expect(longstrideMetrics()).toBe(longstrideMetrics());
    const { sim, player } = rig({ [LONGSTRIDE_ROW]: LONGSTRIDE_ID });
    cast(sim, 'bear_form');
    const stride = aura(player, 'loping_stride');
    expect(stride?.duration).toBe(5);
    expect(stride?.value).toBe(LOPING_STRIDE_SPEED);
    dropAura(player, 'loping_stride');
    cast(sim, 'cat_form');
    expect(aura(player, 'loping_stride')).toBeUndefined();
    ticks(sim, 11);
    cast(sim, 'bear_form');
    expect(aura(player, 'loping_stride')).toBeUndefined();
    ticks(sim, 1.1);
    cast(sim, 'cat_form');
    expect(aura(player, 'loping_stride')?.duration).toBe(5);
  });

  it('reads the Longstride numbers from the row option so the tooltip cannot drift', () => {
    const row = DRUID_CHOICE_ROWS.rows.find((r) => r.level === LONGSTRIDE_ROW);
    const option = row?.options.find((o) => o.id === LONGSTRIDE_ID);
    expect(option?.name).toBe('Longstride');
    expect(option?.effect.intrinsic).toEqual({
      mechanic: 'druid_longstride',
      metrics: { duration: longstrideMetrics().duration, icd: longstrideMetrics().icd },
    });
    expect(option?.description).toContain(`${longstrideMetrics().duration} sec`);
    expect(option?.description).toContain(`${longstrideMetrics().icd} sec`);
  });
});

describe('Pin, the Bruin Rush to Cat Form rider', () => {
  function rushRig() {
    const { sim, player } = rig();
    const target = addTargetMob(sim, 12);
    cast(sim, 'bear_form');
    expect(inForm(player, 'form_bear')).toBe(true);
    return { sim, player, target };
  }

  it('makes Cat Form free inside the 3 sec window and Pins the Rush target', () => {
    const { sim, player, target } = rushRig();
    const parkedBefore = player.savedMana;
    cast(sim, 'bear_charge');
    expect(aura(player, BRUIN_RUSH_WINDOW_ID)?.value).toBe(target.id);
    expect(aura(player, BRUIN_RUSH_WINDOW_ID)?.duration).toBe(BRUIN_RUSH_WINDOW_SECONDS);
    // The displayed cost and the bill agree: both worlds read the same tail.
    expect(sim.resolvedAbility('cat_form')?.cost).toBe(0);
    ticks(sim, 1);
    cast(sim, 'cat_form');
    expect(inForm(player, 'form_cat')).toBe(true);
    expect(player.savedMana).toBe(parkedBefore);
    const pin = aura(target, PIN_ID);
    expect(pin?.kind).toBe('slow');
    expect(pin?.value).toBe(PIN_SLOW_MULT);
    expect(pin?.duration).toBe(PIN_DURATION);
    expect(pin?.sourceId).toBe(player.id);
    expect(moveSpeedMult(target)).toBeCloseTo(0.5);
    // The window is consumed by the shift.
    expect(aura(player, BRUIN_RUSH_WINDOW_ID)).toBeUndefined();
    expect(sim.resolvedAbility('bear_form')?.cost).toBe(30);
  });

  it('charges the full 30 mana and Pins nothing once the window has closed', () => {
    const { sim, player, target } = rushRig();
    cast(sim, 'bear_charge');
    ticks(sim, BRUIN_RUSH_WINDOW_SECONDS + 0.2);
    expect(aura(player, BRUIN_RUSH_WINDOW_ID)).toBeUndefined();
    expect(sim.resolvedAbility('cat_form')?.cost).toBe(30);
    const parkedBefore = player.savedMana;
    cast(sim, 'cat_form');
    expect(inForm(player, 'form_cat')).toBe(true);
    expect(player.savedMana).toBe(parkedBefore - 30);
    expect(aura(target, PIN_ID)).toBeUndefined();
  });

  it('Pins the Rushed target even when the druid has retargeted', () => {
    const { sim, player, target } = rushRig();
    const other = addTargetMob(sim, 5, 9821);
    sim.targetEntity(target.id);
    cast(sim, 'bear_charge');
    sim.targetEntity(other.id);
    cast(sim, 'cat_form');
    expect(aura(target, PIN_ID)).toBeDefined();
    expect(aura(other, PIN_ID)).toBeUndefined();
    expect(aura(player, BRUIN_RUSH_WINDOW_ID)).toBeUndefined();
  });

  it('closes the window on death and on leaving combat', () => {
    const { sim, player, target } = rushRig();
    const dealDamage = (sim as unknown as { dealDamage(...args: unknown[]): void }).dealDamage.bind(
      sim,
    );
    cast(sim, 'bear_charge');
    expect(aura(player, BRUIN_RUSH_WINDOW_ID)).toBeDefined();
    // Leaving combat: the Rush target dies, the hate table empties, and the
    // combat timer runs out; the engaged pass then closes the window.
    dealDamage(player, target, target.hp + 1, false, 'physical', null, 'hit');
    expect(target.dead).toBe(true);
    player.autoAttack = false;
    player.inCombat = false;
    player.combatTimer = 99;
    sim.tick();
    expect(player.inCombat).toBe(false);
    expect(aura(player, BRUIN_RUSH_WINDOW_ID)).toBeUndefined();

    const second = addTargetMob(sim, 12, 9822);
    player.cooldowns.delete('bear_charge');
    cast(sim, 'bear_charge');
    expect(aura(player, BRUIN_RUSH_WINDOW_ID)?.value).toBe(second.id);
    dealDamage(null, player, player.hp + 1, false, 'physical', null, 'hit');
    expect(player.dead).toBe(true);
    expect(aura(player, BRUIN_RUSH_WINDOW_ID)).toBeUndefined();
  });

  it('names the window after Bruin Rush and resolves that name through the ability catalog', () => {
    const { sim, player } = rig();
    addTargetMob(sim, 10);
    cast(sim, 'bear_form');
    cast(sim, 'bear_charge');
    const window = aura(player, BRUIN_RUSH_WINDOW_ID);
    expect(window?.name).toBe(ABILITIES.bear_charge.name);
    // The window's id is not an ABILITIES key, so the HUD's ability-name
    // fallback never fires for it: the sim aura localizer owns the name.
    expect(localizeSimAuraName(window?.name ?? '')).toBe(ABILITIES.bear_charge.name);
    expect(localizeSimAuraName('Lunge')).toBe(ABILITIES.lunge.name);
  });

  it('applies the same no-ladder rule as every other slow, so a repeat Pin is never diminished', () => {
    const { sim, player, target } = rushRig();
    cast(sim, 'bear_charge');
    cast(sim, 'cat_form');
    expect(aura(target, PIN_ID)?.duration).toBe(PIN_DURATION);
    dropAura(target, PIN_ID);
    player.cooldowns.delete('bear_charge');
    cast(sim, 'bear_form');
    cast(sim, 'bear_charge');
    cast(sim, 'cat_form');
    expect(aura(target, PIN_ID)?.duration).toBe(PIN_DURATION);
    // Hobbling Cut's slow aura is the reference: same kind, no DR category.
    expect(ABILITIES.hamstring.effects.some((e) => e.type === 'slow')).toBe(true);
  });
});

describe('Stalk moves at full speed', () => {
  it('stealths a Cat at 1.0x while rogue Duskveil keeps its 0.5x crawl', () => {
    const { sim, player } = rig();
    cast(sim, 'cat_form');
    expect(moveSpeedMult(player)).toBeCloseTo(1.6); // the shift's Loping Stride
    dropAura(player, 'loping_stride');
    cast(sim, 'prowl');
    const stealth = player.auras.find((a) => a.kind === 'stealth');
    expect(stealth?.value).toBe(1);
    // Full speed means the Cat Form passive (+15%, the mobility pass) is
    // untouched by stealth: 1.0 x CAT_FORM_MOVE_MULT.
    expect(moveSpeedMult(player)).toBeCloseTo(CAT_FORM_MOVE_MULT);

    const rogue = new Sim({ seed: 29, playerClass: 'rogue', autoEquip: true });
    rogue.setPlayerLevel(20);
    rogue.player.gcdRemaining = 0;
    rogue.castAbility('stealth');
    rogue.tick();
    const duskveil = rogue.player.auras.find((a) => a.kind === 'stealth');
    expect(duskveil?.value).toBe(0.5);
    expect(moveSpeedMult(rogue.player)).toBe(0.5);
    expect(ABILITIES.stealth.description).toContain('50% slower');
    expect(ABILITIES.prowl.description).not.toContain('slower');
  });
});

describe('Lunge, the out-of-stealth shape of Slinkstrike', () => {
  it('resolves the button to Slinkstrike when stealthed and to Lunge when not', () => {
    const { sim, player } = rig();
    cast(sim, 'cat_form');
    expect(sim.resolvedAbility('pounce')?.def.id).toBe('lunge');
    expect(sim.resolvedAbility('pounce')?.cost).toBe(40);
    cast(sim, 'prowl');
    expect(player.auras.some((a) => a.kind === 'stealth')).toBe(true);
    expect(sim.resolvedAbility('pounce')?.def.id).toBe('pounce');
    expect(sim.resolvedAbility('pounce')?.cost).toBe(50);
  });

  it('starts the route at cast and lands the strike and combo point on arrival, on its own 12 sec cooldown', () => {
    const { sim, player } = rig();
    const target = addTargetMob(sim, 10);
    cast(sim, 'cat_form');
    dropAura(player, 'loping_stride');
    player.resource = player.maxResource;
    const energyBefore = player.resource;
    const startDist = dist2d(player.pos, target.pos);
    player.gcdRemaining = 0;
    sim.castAbility('pounce'); // the button id; out of stealth it is Lunge
    const castTick = sim.tick();
    // The cast tick bills the energy and the cooldown and starts the route;
    // nothing has hit and no point is banked from 10 yd away.
    expect(castTick.some((e) => e.type === 'damage' && e.ability === 'Lunge')).toBe(false);
    expect(player.comboPoints).toBe(0);
    expect(player.resource).toBeLessThanOrEqual(energyBefore - 40 + 1);
    expect(player.cooldowns.get('lunge')).toBeCloseTo(12 - 0.05, 1);
    expect(player.cooldowns.has('pounce')).toBe(false);
    expect(player.chargeTargetId).toBe(target.id);
    expect(lungePendingTargetId(player)).toBe(target.id);
    // Run the route: the tick that arrives is the tick that strikes.
    let landed = false;
    for (let i = 0; i < 40 && !landed; i++) {
      landed = sim.tick().some((e) => e.type === 'damage' && e.ability === 'Lunge');
    }
    expect(landed).toBe(true);
    expect(player.chargeTargetId).toBeNull();
    expect(lungePendingTargetId(player)).toBeNull();
    expect(dist2d(player.pos, target.pos)).toBeLessThan(startDist);
    expect(dist2d(player.pos, target.pos)).toBeLessThan(MELEE_RANGE);
    expect(player.comboPoints).toBe(1);
    expect(target.auras.some((a) => a.kind === 'stun')).toBe(false);
    // The strike landed, so the cooldown stays armed.
    expect(player.cooldowns.get('lunge')).toBeGreaterThan(10);
  });

  it('a lunge from melee range settles on the first tick', () => {
    const { sim, player } = rig();
    const target = addTargetMob(sim, 2);
    cast(sim, 'cat_form');
    player.resource = player.maxResource;
    player.gcdRemaining = 0;
    sim.castAbility('pounce');
    const events = sim.tick();
    expect(events.some((e) => e.type === 'damage' && e.ability === 'Lunge')).toBe(true);
    expect(player.comboPoints).toBe(1);
    expect(player.chargeTargetId).toBeNull();
    expect(lungePendingTargetId(player)).toBeNull();
    expect(target.auras.some((a) => a.kind === 'stun')).toBe(false);
  });

  it('a lunge cut short strikes nothing and hands the cooldown back', () => {
    const { sim, player } = rig();
    const target = addTargetMob(sim, 10);
    cast(sim, 'cat_form');
    player.resource = player.maxResource;
    player.gcdRemaining = 0;
    sim.castAbility('pounce');
    sim.tick();
    expect(player.cooldowns.has('lunge')).toBe(true);
    expect(lungePendingTargetId(player)).toBe(target.id);
    // A root lands mid-route: the mover ends the charge short of the target.
    player.auras.push({
      id: 'test_root',
      name: 'Root',
      kind: 'root',
      remaining: 5,
      duration: 5,
      value: 1,
      sourceId: target.id,
      school: 'nature',
    });
    const events = sim.tick();
    expect(events.some((e) => e.type === 'damage' && e.ability === 'Lunge')).toBe(false);
    expect(player.chargeTargetId).toBeNull();
    expect(lungePendingTargetId(player)).toBeNull();
    expect(player.comboPoints).toBe(0);
    expect(player.cooldowns.has('lunge')).toBe(false);
    // The energy stays spent: the bill a dodged strike pays.
    expect(player.resource).toBeLessThan(player.maxResource);
  });

  it('a restealth Slinkstrike is never blocked by the Lunge cooldown', () => {
    const { sim, player } = rig();
    const target = addTargetMob(sim, 10);
    cast(sim, 'cat_form');
    cast(sim, 'pounce');
    expect(player.cooldowns.has('lunge')).toBe(true);
    ticks(sim, 2);
    // Stalk itself needs combat to end; the stealth aura is what the button
    // reads, so wear it directly and press the same button.
    player.auras.push({
      id: 'prowl',
      name: 'Stalk',
      kind: 'stealth',
      remaining: 3600,
      duration: 3600,
      value: 1,
      sourceId: player.id,
      school: 'physical',
    });
    expect(sim.resolvedAbility('pounce')?.def.id).toBe('pounce');
    player.resource = player.maxResource;
    player.gcdRemaining = 0;
    const events = [...(sim.castAbility('pounce'), sim.tick())];
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(target.auras.some((a) => a.id === 'pounce_stun' && a.kind === 'stun')).toBe(true);
    expect(player.comboPoints).toBe(2);
  });
});

describe('Takedown (id hamstring_bite), the Cat control finisher', () => {
  // The Low Blow numbers: 1 sec plus 1 sec per point, 6 sec at five.
  it.each([
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 5],
    [5, 6],
  ])(
    'stuns for %s combo points for %s sec, consumes the points, and starts a 20 sec cooldown',
    (points, seconds) => {
      const { sim, player } = rig();
      const target = addTargetMob(sim, 2);
      cast(sim, 'cat_form');
      player.comboPoints = points;
      player.comboUntil = sim.time + 30;
      player.resource = player.maxResource;
      cast(sim, 'hamstring_bite');
      const stun = target.auras.find((a) => a.id === 'hamstring_bite_stun');
      expect(stun?.kind).toBe('stun');
      expect(stun?.duration).toBeCloseTo(seconds);
      expect(stun?.sourceId).toBe(player.id);
      expect(player.comboPoints).toBe(0);
      expect(player.cooldowns.get('hamstring_bite')).toBeCloseTo(20 - 0.05, 1);
    },
  );

  it('does nothing without combo points', () => {
    const { sim, player } = rig();
    const target = addTargetMob(sim, 2);
    cast(sim, 'cat_form');
    player.comboPoints = 0;
    cast(sim, 'hamstring_bite');
    expect(target.auras.some((a) => a.kind === 'stun')).toBe(false);
  });

  it('diminishes on the controlled-stun ladder with Concuss and Low Blow', () => {
    // The sim keeps the classic split: from-stealth openers (Slinkstrike, Gut
    // Punch) diminish together, and deliberate stuns (Concuss, Low Blow,
    // Takedown) diminish together, so a Slinkstrike opener never eats
    // into the finisher stun that follows it.
    expect(stunDrCategory('hamstring_bite')).toBe('controlledStun');
    expect(stunDrCategory('bash')).toBe('controlledStun');
    expect(stunDrCategory('kidney_shot')).toBe('controlledStun');
    expect(stunDrCategory('pounce')).toBe('openerStun');
  });

  it('is learned at 12 as part of the Cat kit', () => {
    expect(CLASSES.druid.abilities).toContain('hamstring_bite');
    expect(abilitiesKnownAt('druid', 11).map((k) => k.def.id)).not.toContain('hamstring_bite');
    expect(abilitiesKnownAt('druid', 12).map((k) => k.def.id)).toContain('hamstring_bite');
    expect(ABILITIES.hamstring_bite.requiresForm).toBe('cat');
    expect(ABILITIES.hamstring_bite.spendsCombo).toBe(true);
    expect(ABILITIES.hamstring_bite.name).toBe('Takedown');
    expect(ABILITIES.hamstring_bite.description).toContain('(5 combo points: 6 sec)');
  });
});
