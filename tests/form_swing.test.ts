import { describe, expect, it } from 'vitest';
import {
  baseSwingSpeed,
  CAT_FORM_DAMAGE_MULT,
  CAT_FORM_LEGACY_SWING_SPEED,
  CAT_FORM_SWING_SPEED,
  ROGUE_BASE_SWING_SPEED,
} from '../src/sim/combat/form_swing';
import { CLASSES, ITEMS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { type AuraKind, armorReduction } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

// Mirror tests/form_command.ts: forms are a 3600s toggle aura on the player.
function giveForm(sim: Sim, pid: number, kind: AuraKind, name: string) {
  const e = sim.entities.get(pid)!;
  e.auras.push({
    id: name.toLowerCase().replace(/\s+/g, '_'),
    name,
    kind,
    remaining: 3600,
    duration: 3600,
    value: 1,
    sourceId: pid,
    school: 'physical',
  });
}

describe('Wolf Form swing speed', () => {
  it('pins the classic fast paw cadence at 1.0s', () => {
    expect(CAT_FORM_SWING_SPEED).toBe(1.0);
    // The rogue baseline constant is untouched by the cat cadence change: it
    // still mirrors the rogue's starting dagger.
    const rogueWeapon = ITEMS[CLASSES.rogue.startWeapon].weapon!;
    expect(ROGUE_BASE_SWING_SPEED).toBe(rogueWeapon.speed);
    expect(CAT_FORM_SWING_SPEED).toBeLessThan(ROGUE_BASE_SWING_SPEED);
  });

  it('a druid in Wolf Form swings at the fixed cat cadence, ignoring its weapon', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('druid', 'Bet');
    sim.tick();
    const druid = sim.entities.get(a)!;

    // The druid's caster weapon is slower than the cat cadence: that slow speed
    // is exactly what used to leak into Wolf Form's auto-attacks (the bug).
    expect(druid.weapon.speed).toBeGreaterThan(CAT_FORM_SWING_SPEED);

    giveForm(sim, a, 'form_cat', 'Wolf Form');
    expect(baseSwingSpeed(druid)).toBe(CAT_FORM_SWING_SPEED);
  });

  it('a druid out of form swings at its own weapon speed', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('druid', 'Dalet');
    sim.tick();
    const druid = sim.entities.get(a)!;
    expect(baseSwingSpeed(druid)).toBe(druid.weapon.speed);
  });

  it('Bruin Form keeps weapon-speed swings (out of the cat cadence scope)', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('druid', 'Heth');
    sim.tick();
    const druid = sim.entities.get(a)!;
    giveForm(sim, a, 'form_bear', 'Bruin Form');
    expect(baseSwingSpeed(druid)).toBe(druid.weapon.speed);
  });

  it('a rogue is unaffected (no form aura): own weapon speed', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('rogue', 'Gimel');
    sim.tick();
    const rogue = sim.entities.get(a)!;
    expect(baseSwingSpeed(rogue)).toBe(rogue.weapon.speed);
    expect(rogue.weapon.speed).toBe(ROGUE_BASE_SWING_SPEED);
  });

  // Land the first white-hit auto-attack a player scores on an immortal,
  // unarmored dummy, returning the dealt amount plus the runtime attack power and
  // armor reduction in effect, so the test can predict the amount exactly even as
  // recalcPlayerStats refreshes AP every tick. Crit is zeroed; the weapon damage
  // roll is pinned via min == max (an rng draw still happens, but its value is
  // exact), so the hit reduces to a closed-form expectation.
  function firstWhiteHit(
    sim: Sim,
    pid: number,
    weaponRoll: { min: number; max: number; speed: number } | null = { min: 0, max: 0, speed: 0 },
  ): { amount: number; ap: number; dr: number } {
    const p = sim.entities.get(pid)!;
    p.critChance = 0;
    if (weaponRoll) {
      p.weapon = {
        ...p.weapon,
        min: weaponRoll.min,
        max: weaponRoll.max,
        ...(weaponRoll.speed > 0 ? { speed: weaponRoll.speed } : {}),
      };
    }
    const dummy = [...sim.entities.values()].find((e) => e.kind === 'mob' && !e.dead)!;
    dummy.level = 1;
    dummy.stats.armor = 0;
    dummy.hostile = true;
    p.pos.x = dummy.pos.x + 1;
    p.pos.z = dummy.pos.z;
    p.pos.y = dummy.pos.y;
    p.prevPos = { ...p.pos };
    p.targetId = dummy.id;
    sim.startAutoAttack(pid);
    for (let i = 0; i < 400; i++) {
      dummy.hp = dummy.maxHp = 1e9;
      dummy.dead = false;
      dummy.pos.x = p.pos.x - 1;
      dummy.pos.z = p.pos.z;
      p.facing = Math.atan2(dummy.pos.x - p.pos.x, dummy.pos.z - p.pos.z);
      const evs = sim.tick();
      const hit = evs.find(
        (e) => e.type === 'damage' && e.sourceId === pid && e.ability == null && e.kind === 'hit',
      );
      if (hit && hit.type === 'damage') {
        // biome-ignore lint/suspicious/noExplicitAny: reach private helpers for an exact expectation
        const s = sim as any;
        const dr = armorReduction(s.effectiveArmor(dummy), p.level);
        return { amount: hit.amount, ap: s.effectiveAttackPower(p), dr };
      }
    }
    throw new Error('no white hit landed');
  }

  it('Wolf Form normalizes swing DAMAGE to the cat cadence (no AP double-dip)', () => {
    const expectAt = (ap: number, speed: number, dr: number, formMult = 1) =>
      Math.max(1, Math.round((ap / 14) * speed * formMult * (1 - dr)));

    const sim = makeWorld();
    const a = sim.addPlayer('druid', 'Feral');
    sim.setPlayerLevel(20, a);
    sim.tick();
    const staffSpeed = sim.entities.get(a)!.weapon.speed;
    giveForm(sim, a, 'form_cat', 'Wolf Form');
    const wolf = firstWhiteHit(sim, a);

    // The control druid on the same staff in BEAR form: a melee shapeshift that
    // keeps the weapon cadence, so its AP is normalized by the slow staff. (It
    // used to be an un-shifted druid, but a caster-form druid now auto-attacks
    // with the class wand at any range, wand-style, so it never lands a melee
    // white hit; bear form preserves the staff-speed control this test needs.)
    const sim2 = makeWorld();
    const b = sim2.addPlayer('druid', 'Bruin');
    sim2.setPlayerLevel(20, b);
    sim2.tick();
    giveForm(sim2, b, 'form_bear', 'Bruin Form');
    const staff = firstWhiteHit(sim2, b);

    // Wolf Form's per-swing AP uses the fixed cat cadence (1.0) and the feral
    // form damage multiplier; the bear druid's uses the staff, no multiplier.
    expect(wolf.amount).toBe(
      expectAt(wolf.ap, CAT_FORM_SWING_SPEED, wolf.dr, CAT_FORM_DAMAGE_MULT),
    );
    expect(staff.amount).toBe(expectAt(staff.ap, staffSpeed, staff.dr));
    // The bug would have been Wolf Form normalizing by the slow staff instead: prove
    // the fixed cadence value is genuinely smaller, so a faster swing hits softer.
    expect(staffSpeed).toBeGreaterThan(CAT_FORM_SWING_SPEED);
    expect(wolf.amount).toBeLessThan(expectAt(wolf.ap, staffSpeed, wolf.dr, CAT_FORM_DAMAGE_MULT));
  });

  it('Wolf Form auto weapon rolls are normalized to authored DPS: two speeds, one result', () => {
    // Two weapons authored at the SAME dps (20) but different speeds: a fast 2.0
    // (40 per swing) and a slow 3.0 (60 per swing). Under the cat cadence the
    // roll is rescaled by CAT_FORM_SWING_SPEED / speed, so both swings must deal
    // the exact same white damage on identical stats: white DPS equals the
    // weapon's AUTHORED dps (times the feral form damage multiplier), never the
    // per-swing number a slow weapon happens to be written with.
    const hitWith = (speed: number, perSwing: number) => {
      const sim = makeWorld();
      const a = sim.addPlayer('druid', 'Paw');
      sim.setPlayerLevel(20, a);
      sim.tick();
      giveForm(sim, a, 'form_cat', 'Wolf Form');
      return firstWhiteHit(sim, a, { min: perSwing, max: perSwing, speed });
    };
    const fast = hitWith(2.0, 40);
    const slow = hitWith(3.0, 60);
    expect(fast.ap).toBe(slow.ap);
    expect(fast.dr).toBe(slow.dr);
    const expected = (perSwing: number, speed: number, ap: number, dr: number) =>
      Math.max(
        1,
        Math.round(
          (perSwing * (CAT_FORM_SWING_SPEED / Math.max(0.1, speed)) +
            (ap / 14) * CAT_FORM_SWING_SPEED) *
            CAT_FORM_DAMAGE_MULT *
            (1 - dr),
        ),
      );
    expect(fast.amount).toBe(expected(40, 2.0, fast.ap, fast.dr));
    expect(slow.amount).toBe(expected(60, 3.0, slow.ap, slow.dr));
    // Identical authored dps -> identical white hit at the identical 1.0s
    // cadence, so white DPS is weapon-speed independent.
    expect(fast.amount).toBe(slow.amount);
  });

  // A flat on-every-landed-swing adder (Requital Aura, the paladin party
  // buff): at the 1.0s cat cadence a cat lands ~80% more swings, so the flat
  // per-swing value is rescaled by the cadence ratio to keep its damage per
  // second unchanged by the standardization. Bear (weapon cadence) keeps the
  // full authored value.
  function firstRequitalHit(sim: Sim, pid: number, form: AuraKind, formName: string): number {
    const p = sim.entities.get(pid)!;
    giveForm(sim, pid, form, formName);
    p.auras.push({
      id: 'retribution_aura',
      name: 'Requital Aura',
      kind: 'thorns',
      remaining: 3600,
      duration: 3600,
      value: 22,
      sourceId: pid,
      school: 'holy',
    });
    p.critChance = 0;
    p.weapon = { ...p.weapon, min: 0, max: 0 };
    const dummy = [...sim.entities.values()].find((e) => e.kind === 'mob' && !e.dead)!;
    dummy.level = 1;
    dummy.stats.armor = 0;
    dummy.hostile = true;
    p.pos.x = dummy.pos.x + 1;
    p.pos.z = dummy.pos.z;
    p.pos.y = dummy.pos.y;
    p.prevPos = { ...p.pos };
    p.targetId = dummy.id;
    sim.startAutoAttack(pid);
    for (let i = 0; i < 400; i++) {
      dummy.hp = dummy.maxHp = 1e9;
      dummy.dead = false;
      dummy.pos.x = p.pos.x - 1;
      dummy.pos.z = p.pos.z;
      p.facing = Math.atan2(dummy.pos.x - p.pos.x, dummy.pos.z - p.pos.z);
      const evs = sim.tick();
      const hit = evs.find(
        (e) => e.type === 'damage' && e.sourceId === pid && e.ability === 'Requital Aura',
      );
      if (hit && hit.type === 'damage') return hit.amount;
    }
    throw new Error('no Requital hit landed');
  }

  it('rescales the flat Requital Aura per-swing adder to the cat cadence', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('druid', 'Vav');
    sim.setPlayerLevel(20, a);
    sim.tick();
    const wolf = firstRequitalHit(sim, a, 'form_cat', 'Wolf Form');
    // The ratio denominator is the FROZEN legacy cadence, deliberately not the
    // rogue content lookup, so a rogue starting-weapon retune can never move a
    // druid's Requital damage.
    expect(CAT_FORM_LEGACY_SWING_SPEED).toBe(1.8);
    expect(wolf).toBe(Math.round(22 * (CAT_FORM_SWING_SPEED / CAT_FORM_LEGACY_SWING_SPEED)));

    const sim2 = makeWorld();
    const b = sim2.addPlayer('druid', 'Zayin');
    sim2.setPlayerLevel(20, b);
    sim2.tick();
    expect(firstRequitalHit(sim2, b, 'form_bear', 'Bruin Form')).toBe(22);
  });

  it('a Wolf Form cat lands about one auto swing per second over time', () => {
    // The cadence over TIME, not just the scalar: 10 seconds of auto-attacks
    // at the fixed 1.0s paw speed must land ~10 swing attempts (every
    // hit/miss/dodge/parry resets the timer). This pins the swing-timer
    // wiring in updatePlayerAutoAttack end to end.
    const sim = makeWorld();
    const a = sim.addPlayer('druid', 'Cadence');
    sim.setPlayerLevel(20, a);
    sim.tick();
    const p = sim.entities.get(a)!;
    giveForm(sim, a, 'form_cat', 'Wolf Form');
    p.weapon = { ...p.weapon, min: 1, max: 1 };
    const dummy = [...sim.entities.values()].find((e) => e.kind === 'mob' && !e.dead)!;
    dummy.level = 1;
    dummy.hostile = true;
    p.pos.x = dummy.pos.x + 1;
    p.pos.z = dummy.pos.z;
    p.pos.y = dummy.pos.y;
    p.prevPos = { ...p.pos };
    p.targetId = dummy.id;
    sim.startAutoAttack(a);
    let swings = 0;
    for (let i = 0; i < 200; i++) {
      dummy.hp = dummy.maxHp = 1e9;
      dummy.dead = false;
      dummy.pos.x = p.pos.x - 1;
      dummy.pos.z = p.pos.z;
      p.hp = p.maxHp;
      p.facing = Math.atan2(dummy.pos.x - p.pos.x, dummy.pos.z - p.pos.z);
      const evs = sim.tick();
      swings += evs.filter(
        (e) => e.type === 'damage' && e.sourceId === a && e.ability == null,
      ).length;
    }
    expect(swings).toBeGreaterThanOrEqual(9);
    expect(swings).toBeLessThanOrEqual(11);
  });

  it('a cat weaponStrike special keeps its raw roll: AP term at the cat cadence, form mult, no roll rescale', () => {
    // Rendclaw (claw, rank 1: weaponStrike bonus 25) in Wolf Form on a slow
    // 3.0-speed weapon pinned at 60 per swing. The special's weapon roll is
    // deliberately NOT rescaled (only the mainhand AUTO arm normalizes), its
    // AP-per-swing term follows baseSwingSpeed (the 1.0s cat cadence), the
    // form damage multiplier covers the roll + AP subtotal, and the flat
    // ability bonus lands after the multiplier, before armor.
    const sim = makeWorld();
    const a = sim.addPlayer('druid', 'Fang');
    sim.setPlayerLevel(5, a);
    sim.tick();
    const p = sim.entities.get(a)!;
    giveForm(sim, a, 'form_cat', 'Wolf Form');
    p.critChance = 0;
    p.weapon = { ...p.weapon, min: 60, max: 60, speed: 3.0 };
    const dummy = [...sim.entities.values()].find((e) => e.kind === 'mob' && !e.dead)!;
    dummy.level = 1;
    dummy.stats.armor = 0;
    dummy.hostile = true;
    dummy.hp = dummy.maxHp = 1e9;
    p.pos.x = dummy.pos.x + 1;
    p.pos.z = dummy.pos.z;
    p.pos.y = dummy.pos.y;
    p.prevPos = { ...p.pos };
    p.targetId = dummy.id;
    p.facing = Math.atan2(dummy.pos.x - p.pos.x, dummy.pos.z - p.pos.z);
    p.resource = p.maxResource;
    sim.castAbility('claw', a);
    for (let i = 0; i < 40; i++) {
      const evs = sim.tick();
      const hit = evs.find(
        (e) =>
          e.type === 'damage' && e.sourceId === a && e.ability === 'Rendclaw' && e.kind === 'hit',
      );
      if (hit && hit.type === 'damage') {
        // biome-ignore lint/suspicious/noExplicitAny: reach private helpers for an exact expectation
        const s = sim as any;
        const dr = armorReduction(s.effectiveArmor(dummy), p.level);
        const ap = s.effectiveAttackPower(p);
        expect(hit.amount).toBe(
          Math.max(
            1,
            Math.round(
              ((60 + (ap / 14) * CAT_FORM_SWING_SPEED) * CAT_FORM_DAMAGE_MULT + 25) * (1 - dr),
            ),
          ),
        );
        return;
      }
      p.resource = p.maxResource;
    }
    throw new Error('Rendclaw never landed');
  });

  it('a non-cat auto swing keeps the raw per-swing roll (no normalization)', () => {
    // A bear on a slow 3.0-speed weapon authored at 60 per swing: the raw
    // per-swing contract (auto_attack.ts header) means the roll lands as
    // written, and the AP term uses the real weapon speed.
    const sim = makeWorld();
    const a = sim.addPlayer('druid', 'Claw');
    sim.setPlayerLevel(20, a);
    sim.tick();
    giveForm(sim, a, 'form_bear', 'Bruin Form');
    const hit = firstWhiteHit(sim, a, { min: 60, max: 60, speed: 3.0 });
    expect(hit.amount).toBe(Math.max(1, Math.round((60 + (hit.ap / 14) * 3.0) * (1 - hit.dr))));
  });
});
