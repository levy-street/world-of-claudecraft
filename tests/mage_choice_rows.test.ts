// The owner's mage choice-row tree (bilingual Artifact calculator, 2026-07-11),
// which replaced the first-draft rows wholesale: one decisive test per working
// option, plus the coming-soon placeholders staying pickable. Follows the
// choice_rows_wave2 harness idiom (a real Sim, applyTalents with a rows map).

import { describe, expect, it } from 'vitest';
import { MAGE_CHOICE_ROWS } from '../src/sim/content/choice_rows_classic';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { rowTreeFor } from '../src/sim/content/talent_rows';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';

function rig(rows: Record<number, string>, level = 20) {
  const sim = new Sim({ seed: 17, playerClass: 'mage', autoEquip: true });
  sim.setPlayerLevel(level);
  // Frost-specced rig: the Chronomancy gating (mage-chronomancy.md Phase 1)
  // moved the offensive kit these rows exercise (Frostveil, the fire/frost
  // nukes) onto the two DPS specs, so a spec-less rig can no longer cast it.
  expect(sim.applyTalents({ spec: 'frost', rows })).toBe(true);
  const p = sim.player;
  p.resource = p.maxResource;
  return { sim, p };
}

function addTargetMob(sim: Sim, hp = 100000, dist = 10): Entity {
  const p = sim.player;
  // Stationary target: the harness wolf wanders (known gotcha); the dummy sits.
  const mob = createMob(9300, MOBS.training_dummy, 20, {
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

function tickFor(sim: Sim, seconds: number): void {
  for (let i = 0; i < Math.round(seconds * 20); i++) sim.tick();
}

describe('mage base kit', () => {
  it('Flickerstep (blink) is a BASE ability from level 5, matching its level-5 row modifiers', () => {
    // The level-5 choice row offers two blink-modifying picks (Double Blink, Blink
    // cast), so Blink must exist by level 5, not 10: they must not bank against an
    // ability the player cannot yet learn.
    const at5 = abilitiesKnownAt('mage', 5).map((k) => k.def.id);
    expect(at5).toContain('blink');
  });
});

describe('mage choice rows (owner tree)', () => {
  it('Ice Floes banks two protected casts; completing a hard cast spends one', () => {
    const { sim, p } = rig({ 5: 'mag_r5_ice_floes' });
    addTargetMob(sim);
    sim.castAbility('ice_floes');
    const floes = () => p.auras.find((a) => a.kind === 'ice_floes');
    expect(floes()?.value).toBe(2);
    sim.castAbility('fireball');
    tickFor(sim, 4); // the fireball hard cast completes
    expect(floes()?.value).toBe(1);
  });

  it('Double Blink banks 2 back-to-back uses on a 30% slower recharge', () => {
    const { sim, p } = rig({ 5: 'mag_r5_double_blink' });
    const res = (
      sim as unknown as {
        resolvedAbility(id: string, pid: number): { cooldown: number; charges?: number };
      }
    ).resolvedAbility('blink', p.id);
    expect(res.charges).toBe(2);
    expect(res.cooldown).toBeCloseTo(15 * 1.3, 5); // 30% slower recharge
    const full = p.resource;
    sim.castAbility('blink');
    (p as { gcdRemaining: number }).gcdRemaining = 0;
    sim.castAbility('blink'); // the banked second charge fires back to back
    expect(p.resource).toBe(full - 80); // both 40-mana blinks actually cast
    (p as { gcdRemaining: number }).gcdRemaining = 0;
    sim.castAbility('blink'); // no third charge: nothing is spent
    expect(p.resource).toBe(full - 80);
  });

  it('Warded cuts damage 15% while Frostveil is up and heals 39 when it breaks', () => {
    const { sim, p } = rig({ 8: 'mag_r8_warded' });
    const mob = addTargetMob(sim);
    sim.castAbility('ice_barrier'); // 130 absorb
    const deal = (n: number) =>
      (
        sim as unknown as {
          dealDamage(
            s: Entity,
            t: Entity,
            n: number,
            c: boolean,
            sc: string,
            a: string | null,
            k: string,
          ): void;
        }
      ).dealDamage(mob, p, n, false, 'physical', null, 'hit');
    p.hp -= 100; // the break heal resolves before the landing hit: leave room
    const hp0 = p.hp;
    deal(100); // cut to 85, fully soaked (barrier 130 -> 45)
    expect(p.hp).toBe(hp0);
    deal(100); // cut to 85, 45 soaked, the break heals 39, then 40 lands
    expect(p.hp).toBe(hp0 + 39 - 40);
    expect(p.auras.some((a) => a.id === 'ice_barrier' && a.kind === 'absorb')).toBe(false);
  });

  it('Temporal Rift cleanses the next stun instantly, then cools down 20 sec', () => {
    const { sim, p } = rig({ 8: 'mag_r8_temporal_rift' });
    const mob = addTargetMob(sim);
    const applyStun = () =>
      (sim as unknown as { applyAura(t: Entity, a: object): void }).applyAura(p, {
        id: 'test_stun',
        name: 'Test Stun',
        kind: 'stun',
        value: 0,
        remaining: 3,
        duration: 3,
        sourceId: mob.id,
        school: 'physical',
      });
    applyStun();
    expect(p.auras.some((a) => a.kind === 'stun')).toBe(false); // cleansed
    expect(p.auras.some((a) => a.id === 'temporal_rift_cd')).toBe(true);
    applyStun();
    expect(p.auras.some((a) => a.kind === 'stun')).toBe(true); // ICD running
  });

  it('Greater Invisibility strips 2 DoTs, vanishes, and cuts damage 90%', () => {
    const { sim, p } = rig({ 8: 'mag_r8_greater_invis' });
    const mob = addTargetMob(sim);
    for (const id of ['dot_a', 'dot_b', 'dot_c']) {
      (sim as unknown as { applyAura(t: Entity, a: object): void }).applyAura(p, {
        id,
        name: id,
        kind: 'dot',
        value: 5,
        remaining: 10,
        duration: 10,
        sourceId: mob.id,
        school: 'shadow',
      });
    }
    sim.castAbility('greater_invisibility');
    expect(p.auras.filter((a) => a.kind === 'dot')).toHaveLength(1); // 2 removed
    expect(p.stealthed).toBe(true);
    // The stealth kind doubles as a movement factor (rogues sneak slower); an
    // invisible mage keeps FULL speed (owner playtest: value 0 pinned them).
    expect(p.auras.find((a) => a.kind === 'stealth')?.value).toBe(1);
    const dr = p.auras.find((a) => a.id === 'greater_invisibility_dr');
    expect(dr?.kind).toBe('buff_dr');
    expect(dr?.value).toBeCloseTo(0.9);
    expect(dr?.duration).toBeCloseTo(23); // 20s vanish + 3s linger
  });

  it('Ring of Frost arms at the aimed point with a single charge', () => {
    const { sim, p } = rig({ 11: 'mag_r11_rings_of_frost' });
    const mob = addTargetMob(sim, 100000, 15);
    const center = { x: mob.pos.x, z: mob.pos.z };
    sim.castAbilityAt('rings_of_frost', center);
    tickFor(sim, 2); // the 1.5s cast is the arming delay
    expect(mob.auras.some((a) => a.kind === 'root')).toBe(false); // center is safe
    mob.pos.x = center.x + 5.3;
    mob.prevPos = { ...mob.pos };
    sim.tick();
    expect(mob.auras.some((a) => a.kind === 'root')).toBe(true);
    const res = (
      sim as unknown as {
        resolvedAbility(id: string, pid: number): { charges?: number; bonusCharges?: number };
      }
    ).resolvedAbility('rings_of_frost', p.id);
    expect(res.charges ?? 1).toBe(1);
    expect(res.bonusCharges ?? 0).toBe(0);
  });

  it('Snap Polymorph makes Bewitch instant on a real 20 sec cooldown', () => {
    const { sim, p } = rig({ 11: 'mag_r11_snap_polymorph' });
    const mob = addTargetMob(sim, 100000, 8);
    sim.castAbility('polymorph');
    // Instant: no cast bar, and the traded-in cooldown arms at once; the bolt
    // is a projectile, so the sheep lands when it arrives a few ticks later.
    expect(p.castingAbility).toBeNull();
    expect(p.cooldowns.get('polymorph')).toBe(20);
    tickFor(sim, 1.5);
    expect(mob.auras.some((a) => a.kind === 'polymorph')).toBe(true);
  });

  it('Twin Frost Nova stores 2 independent charges', () => {
    const { sim, p } = rig({ 11: 'mag_r11_twin_nova' });
    const res = (
      sim as unknown as {
        resolvedAbility(id: string, pid: number): { charges?: number; cost: number };
      }
    ).resolvedAbility('frost_nova', p.id);
    expect(res.charges).toBe(2);
    addTargetMob(sim, 100000, 3);
    const full = p.resource;
    sim.castAbility('frost_nova');
    (p as { gcdRemaining: number }).gcdRemaining = 0;
    sim.castAbility('frost_nova'); // the banked second charge fires back to back
    expect(p.resource).toBe(full - res.cost * 2);
  });

  it('Racing Mind is granted and arms the next-cast-instant window', () => {
    const { sim, p } = rig({ 14: 'mag_r14_presence_of_mind' });
    sim.castAbility('presence_of_mind');
    expect(p.auras.some((a) => a.kind === 'next_cast_instant')).toBe(true);
  });

  it('Cold Snap finishes the cooldowns of Flickerstep, Frostveil and Greater Invisibility', () => {
    const { sim, p } = rig({ 8: 'mag_r8_greater_invis', 17: 'mag_r17_cold_snap' });
    p.cooldowns.set('blink', 12);
    p.cooldowns.set('ice_barrier', 25);
    p.cooldowns.set('greater_invisibility', 100);
    sim.castAbility('cold_snap');
    expect(p.cooldowns.has('blink')).toBe(false);
    expect(p.cooldowns.has('ice_barrier')).toBe(false);
    expect(p.cooldowns.has('greater_invisibility')).toBe(false);
  });

  it('Mass Barrier shields the caster (and any nearby allies) for 130', () => {
    const { sim, p } = rig({ 17: 'mag_r17_mass_barrier' });
    sim.castAbility('mass_barrier');
    const shield = p.auras.find((a) => a.id === 'mass_barrier');
    expect(shield?.kind).toBe('absorb');
    expect(shield?.value).toBe(130);
  });

  it('Overflowing Power shaves defensive cooldowns as mana is spent, capped by the window', () => {
    const { sim, p } = rig({ 20: 'mag_r20_overflowing_power' });
    addTargetMob(sim, 100000, 3);
    p.cooldowns.set('blink', 15);
    const before = p.resource;
    // ice_lance: the frost rig's instant mana spender (arcane_explosion is
    // Chronomancer-only since the owner spec split 2026-07-14).
    sim.castAbility('ice_lance');
    const spent = before - p.resource;
    expect(spent).toBeGreaterThan(0);
    const shave = (spent / p.maxResource) * 10 * 2;
    expect(p.cooldowns.get('blink')).toBeCloseTo(15 - shave, 5);
    const cap = p.auras.find((a) => a.id === 'overflowing_power_cap');
    expect(cap?.value).toBeCloseTo(shave, 5);
  });

  it('Aetherwell channels mana and STACKS spell power the longer you channel', () => {
    const { sim, p } = rig({ 20: 'mag_r20_evocation' });
    p.resource = 10;
    const sp0 = p.spellPower;
    sim.castAbility('evocation');
    expect(p.castingAbility).toBe('evocation'); // a real channel, not a dump
    tickFor(sim, 2.2);
    const early = p.resource;
    expect(early).toBeGreaterThan(10); // mana pulses land while channeling
    const midAura = p.auras.find((a) => a.id === 'evocation');
    expect(midAura?.kind).toBe('buff_spellpower');
    const midValue = midAura?.value ?? 0;
    expect(midValue).toBeGreaterThanOrEqual(16); // two pulses banked already
    tickFor(sim, 5); // ride the channel out
    const aura = p.auras.find((a) => a.id === 'evocation');
    expect(aura?.value).toBe(48); // six pulses of 8: the full channel banked
    expect(aura?.stacks).toBe(6);
    expect(p.spellPower).toBe(sp0 + 48); // recalced live onto the sheet
    expect(p.resource - 10).toBeGreaterThanOrEqual(6 * 40); // the flat mana floor
  });

  it('Blink While Casting slips Flickerstep through the busy guard, keeping the cast', () => {
    const { sim, p } = rig({ 5: 'mag_r5_blink_cast' });
    addTargetMob(sim);
    sim.castAbility('fireball');
    expect(p.castingAbility).toBe('fireball');
    const z0 = p.pos.z;
    const mana0 = p.resource;
    sim.castAbility('blink');
    expect(p.castingAbility).toBe('fireball'); // the cast survives
    expect(p.resource).toBe(mana0 - 40); // the blink actually cast
    expect(p.pos.z).not.toBe(z0); // and actually moved
  });

  it('without the pick, a mid-cast Flickerstep press stays blocked', () => {
    const { sim, p } = rig({ 5: 'mag_r5_double_blink' });
    addTargetMob(sim);
    sim.castAbility('fireball');
    const mana0 = p.resource;
    const z0 = p.pos.z;
    sim.castAbility('blink');
    expect(p.resource).toBe(mana0); // nothing billed
    expect(p.pos.z).toBe(z0); // nothing moved
  });

  it('Overload arms an amplifier the next mana spell consumes at a 50% higher bill', () => {
    const { sim, p } = rig({ 14: 'mag_r14_overload' });
    addTargetMob(sim, 100000, 5);
    sim.castAbility('overload');
    expect(p.auras.some((a) => a.kind === 'overload')).toBe(true);
    const res = (
      sim as unknown as { resolvedAbility(id: string, pid: number): { cost: number } }
    ).resolvedAbility('ice_lance', p.id);
    const mana0 = p.resource;
    (p as { gcdRemaining: number }).gcdRemaining = 0;
    sim.castAbility('ice_lance');
    expect(p.resource).toBe(mana0 - Math.round(res.cost * 1.5)); // the steeper bill
    expect(p.auras.some((a) => a.kind === 'overload')).toBe(false); // consumed
  });

  it('Power Echo repeats the resolved hit at 50% on the same target, once', () => {
    const { sim, p } = rig({ 14: 'mag_r14_power_echo' });
    const mob = addTargetMob(sim, 100000, 5);
    sim.castAbility('power_echo');
    (p as { gcdRemaining: number }).gcdRemaining = 0;
    const hp0 = mob.hp;
    // ice_lance: frost-known instant (fire_blast is fire-only since the split).
    sim.castAbility('ice_lance');
    // The bolt is a projectile: fly it to impact, collecting the tick events.
    const collected: { type: string; amount?: number }[] = [];
    for (let i = 0; i < 30; i++) collected.push(...(sim.tick() as never[]));
    const events = collected.filter((e) => e.type === 'damage');
    expect(events).toHaveLength(2); // the hit and its echo
    const [hit, echo] = events as { amount: number }[];
    expect(echo.amount).toBe(Math.max(1, Math.round(hit.amount * 0.5)));
    expect(mob.hp).toBe(hp0 - hit.amount - echo.amount);
    expect(p.auras.some((a) => a.kind === 'power_echo')).toBe(false); // consumed
  });

  it('Power Echo also repeats a direct HEAL (Temporal Mend) at 50% on the same target, once', () => {
    // Arcane rig: Temporal Mend is the arcane-spec direct heal; Power Echo is the
    // class-wide row-14 grant. The echo must fire for heals, not only damage.
    const sim = new Sim({ seed: 17, playerClass: 'mage', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.applyTalents({ spec: 'arcane', rows: { 14: 'mag_r14_power_echo' } })).toBe(true);
    const p = sim.player;
    p.resource = p.maxResource;
    // Deep HP hole so neither the heal nor its echo overheals (which would clamp).
    p.maxHp = 100000;
    p.hp = 1;
    sim.castAbility('power_echo');
    (p as { gcdRemaining: number }).gcdRemaining = 0;
    sim.targetEntity(p.id); // Temporal Mend targets a friendly; heal self.
    sim.castAbility('temporal_mend');
    // Ride the 2s hard cast to completion, collecting heal events.
    const collected: { type: string; amount?: number; targetId?: number }[] = [];
    for (let i = 0; i < 60; i++) collected.push(...(sim.tick() as never[]));
    const heals = collected.filter((e) => e.type === 'heal2' && e.targetId === p.id);
    expect(heals).toHaveLength(2); // the heal and its echo
    const [heal, echo] = heals as { amount: number }[];
    expect(echo.amount).toBe(Math.max(1, Math.round(heal.amount * 0.5)));
    expect(p.auras.some((a) => a.kind === 'power_echo')).toBe(false); // consumed
  });

  it('Power Echo repeats Temporal Echo healing once and still places its mark', () => {
    const sim = new Sim({ seed: 17, playerClass: 'mage', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.applyTalents({ spec: 'arcane', rows: { 14: 'mag_r14_power_echo' } })).toBe(true);
    const p = sim.player;
    p.resource = p.maxResource;
    p.maxHp = 100000;
    p.hp = 1;
    sim.castAbility('power_echo');
    (p as { gcdRemaining: number }).gcdRemaining = 0;
    sim.targetEntity(p.id);
    sim.castAbility('temporal_echo');
    const heals = sim
      .tick()
      .filter((e) => e.type === 'heal2' && e.targetId === p.id)
      .map((e) => (e as { amount: number }).amount);
    expect(heals).toHaveLength(2);
    expect(heals[1]).toBe(Math.max(1, Math.round(heals[0] * 0.5)));
    expect(p.auras.some((a) => a.kind === 'temporal_echo' && a.sourceId === p.id)).toBe(true);
  });

  it('Power Echo heal copy does not roll a second on-heal weapon proc', () => {
    const sim = new Sim({ seed: 17, playerClass: 'mage', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.applyTalents({ spec: 'arcane', rows: { 14: 'mag_r14_power_echo' } })).toBe(true);
    const p = sim.player;
    p.resource = p.maxResource;
    p.maxHp = 100000;
    p.hp = 1;
    // Equip through the authoritative inventory path: cast setup refreshes stats
    // from PlayerMeta, so changing only the entity's display copy would be reset
    // to the starter staff before the heal resolves.
    sim.addItem('deathless_heartwood', 1);
    sim.equipItem('deathless_heartwood');
    sim.castAbility('power_echo');
    (p as { gcdRemaining: number }).gcdRemaining = 0;
    sim.targetEntity(p.id);
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    sim.castAbility('temporal_echo');
    sim.rng.setObserver(null);
    // One amount roll, one crit roll, and one Lifebloom proc roll. The echoed
    // heal reuses the resolved amount and must add no fourth draw.
    expect(draws).toBe(3);
  });

  it('Elemental Convergence opens the surge on a Fire-Frost alternation, once per 30 sec', () => {
    const { sim, p } = rig({ 17: 'mag_r17_convergence' });
    addTargetMob(sim, 100000, 5);
    // fireball: the base-kit fire school (fire_blast is fire-only since the split).
    sim.castAbility('fireball');
    tickFor(sim, 4); // ride the hard cast plus the bolt's flight
    expect(p.auras.some((a) => a.id === 'elemental_convergence')).toBe(false);
    (p as { gcdRemaining: number }).gcdRemaining = 0;
    sim.castAbility('frostbolt'); // base-kit frost (ice_lance is spec-gated)
    tickFor(sim, 4); // ride the hard cast plus the bolt's flight
    const surge = p.auras.find((a) => a.id === 'elemental_convergence');
    expect(surge?.kind).toBe('buff_dmg_done');
    expect(surge?.value).toBeCloseTo(0.15);
    expect(surge && auraEffectDescriptor(surge)).toEqual({
      key: 'hudChrome.auraEffect.dmgDone',
      nums: { pct: 15 },
    });
    expect(p.auras.some((a) => a.id === 'convergence_cd')).toBe(true);
    // Another alternation inside the internal cooldown re-arms nothing new.
    (p as { gcdRemaining: number }).gcdRemaining = 0;
    p.resource = p.maxResource;
    sim.castAbility('fireball');
    tickFor(sim, 4);
    (p as { gcdRemaining: number }).gcdRemaining = 0;
    sim.castAbility('frostbolt');
    tickFor(sim, 4);
    const cds = p.auras.filter((a) => a.id === 'convergence_cd');
    expect(cds).toHaveLength(1);
  });

  it('Rune of Power buffs allies standing near it and falls off after leaving', () => {
    const { sim, p } = rig({ 20: 'mag_r20_rune_of_power' });
    sim.castAbility('rune_of_power');
    tickFor(sim, 2.5); // first friendly pulse
    const rune = p.auras.find((a) => a.id === 'rune_of_power');
    expect(rune?.kind).toBe('buff_dmg_done');
    expect(rune?.value).toBeCloseTo(0.1);
    // Step far outside the 8 yd ring: the short pulse buff expires unrefreshed.
    p.pos.x += 30;
    p.prevPos = { ...p.pos };
    tickFor(sim, 4);
    expect(p.auras.some((a) => a.id === 'rune_of_power')).toBe(false);
  });

  it('overlapping Runes of Power refresh one shared buff instead of stacking', () => {
    const sim = new Sim({ seed: 18, playerClass: 'mage', noPlayer: true });
    const first = sim.addPlayer('mage', 'First');
    const second = sim.addPlayer('mage', 'Second');
    for (const pid of [first, second]) {
      sim.setPlayerLevel(20, pid);
      expect(sim.setSpec('frost', pid)).toBe(true);
      expect(sim.selectTalentRow(20, 'mag_r20_rune_of_power', pid)).toBe(true);
      const entity = sim.entities.get(pid);
      if (entity) entity.resource = entity.maxResource;
    }
    sim.partyInvite(second, first);
    sim.partyAccept(second);
    sim.castAbility('rune_of_power', first);
    sim.castAbility('rune_of_power', second);
    tickFor(sim, 2);

    const recipient = sim.entities.get(first);
    expect(recipient?.auras.filter((aura) => aura.id === 'rune_of_power')).toHaveLength(1);
    expect(recipient?.auras.find((aura) => aura.id === 'rune_of_power')?.remaining).toBeGreaterThan(
      2,
    );
  });
});

describe('the talents-window registry mirror', () => {
  it('ROW_TREES.mage stays in lockstep with MAGE_CHOICE_ROWS (id, name, level)', () => {
    const mirror = rowTreeFor('mage');
    expect(mirror).not.toBeNull();
    expect(mirror).toHaveLength(MAGE_CHOICE_ROWS.rows.length);
    MAGE_CHOICE_ROWS.rows.forEach((row, i) => {
      expect(mirror?.[i].level).toBe(row.level);
      expect(mirror?.[i].options.map((o) => o.id)).toEqual(row.options.map((o) => o.id));
      expect(mirror?.[i].options.map((o) => o.name)).toEqual(row.options.map((o) => o.name));
    });
  });

  it('the window flow works: a mage selectTalentRow pick applies its effect live', () => {
    const sim = new Sim({ seed: 17, playerClass: 'mage', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('frost')).toBe(true);
    const p = sim.player;
    // Level 8 = the survival row; the pick flows through the same
    // selectTalentRow path the talents window's Choices tab drives.
    expect(sim.selectTalentRow(8, 'mag_r8_temporal_rift')).toBe(true);
    (sim as unknown as { applyAura(t: Entity, a: object): void }).applyAura(p, {
      id: 'test_stun',
      name: 'Test Stun',
      kind: 'stun',
      value: 0,
      remaining: 3,
      duration: 3,
      sourceId: 424242,
      school: 'physical',
    });
    expect(p.auras.some((a) => a.kind === 'stun')).toBe(false); // cleansed
    expect(p.auras.some((a) => a.id === 'temporal_rift_cd')).toBe(true);
  });
});
