import { describe, expect, it } from 'vitest';
import { castAbility, updateCasting } from '../src/sim/combat/casting_lifecycle';
import { dealDamage } from '../src/sim/combat/damage';
import { gainRuin, spendRuin } from '../src/sim/combat/destruction';
import { consumeFreeCostFor } from '../src/sim/combat/empower_next';
import { onCastCompleted } from '../src/sim/combat/talent_procs';
import { canUseForbiddenReflection } from '../src/sim/combat/warlock_talents';
import { ABILITIES } from '../src/sim/content/classes';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { advancePendingProjectiles } from '../src/sim/projectile_travel';
import { Sim } from '../src/sim/sim';
import { DT, type Entity } from '../src/sim/types';
import { abilityDisplayDescription } from '../src/ui/ability_description';

function rig(rows: Record<number, string>, spec: string | null = 'destruction') {
  const sim = new Sim({ seed: 73, playerClass: 'warlock', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows })).toBe(true);
  sim.player.resource = sim.player.maxResource;
  return { sim, player: sim.player };
}

function addTarget(sim: Sim, z = 6, id = 9901): Entity {
  const player = sim.player;
  const mob = createMob(id, MOBS.forest_wolf, 20, {
    x: player.pos.x,
    y: player.pos.y,
    z: player.pos.z + z,
  });
  mob.hostile = true;
  mob.maxHp = mob.hp = 10000;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  sim.targetEntity(mob.id);
  player.facing = 0;
  return mob;
}

function ctxOf(sim: Sim) {
  return (sim as unknown as { ctx: Parameters<typeof onCastCompleted>[0] }).ctx;
}

function tick(sim: Sim, count: number): void {
  for (let i = 0; i < count; i++) sim.tick();
}

describe('warlock class talent tree', () => {
  it('offers sustained health-paid movement instead of another blink', () => {
    const { sim, player } = rig({ 5: 'wlk_r5_improved_immolate' });
    const hpBefore = player.hp;
    const positionBefore = { ...player.pos };

    sim.castAbility('sacrilegious_march');
    expect(player.pos).toEqual(positionBefore);
    expect(player.auras.find((aura) => aura.id === 'sacrilegious_march')).toMatchObject({
      kind: 'buff_speed',
      value: 1.35,
    });
    tick(sim, 20);
    expect(player.hp).toBe(hpBefore - Math.round(player.maxHp * 0.02));

    sim.castAbility('sacrilegious_march');
    expect(player.auras.some((aura) => aura.id === 'sacrilegious_march')).toBe(false);

    player.gcdRemaining = 0;
    player.hp = Math.ceil(player.maxHp * 0.21);
    player.inCombat = true;
    player.combatTimer = 0;
    sim.castAbility('sacrilegious_march');
    tick(sim, 20);
    expect(player.hp).toBe(Math.ceil(player.maxHp * 0.2));
    expect(player.auras.some((aura) => aura.id === 'sacrilegious_march')).toBe(false);
  });

  it('makes Leaden Hex a 30% maximum snare followed by a 3.5 sec root', () => {
    const { sim, player } = rig({ 8: 'wlk_r8_curse_of_exhaustion' });
    const target = addTarget(sim);

    for (let i = 0; i < 3; i++) onCastCompleted(ctxOf(sim), player, 'shadow_bolt', target);
    expect(target.auras.find((aura) => aura.id === 'wlk_leaden_hex_slow')).toMatchObject({
      kind: 'slow',
      value: 0.7,
      stacks: 3,
    });

    onCastCompleted(ctxOf(sim), player, 'shadow_bolt', target);
    expect(target.auras.some((aura) => aura.id === 'wlk_leaden_hex_slow')).toBe(false);
    expect(target.auras.find((aura) => aura.id === 'wlk_leaden_hex_root')).toMatchObject({
      kind: 'root',
      remaining: 3.5,
    });
    expect(target.auras.find((aura) => aura.id === 'wlk_leaden_hex_root_lock')).toMatchObject({
      kind: 'internal_cd',
      remaining: 15,
    });
    for (let i = 0; i < 4; i++) onCastCompleted(ctxOf(sim), player, 'shadow_bolt', target);
    expect(target.auras.filter((aura) => aura.id === 'wlk_leaden_hex_root')).toHaveLength(1);

    for (const [index, abilityId] of [
      'litany_of_guilt',
      'reaping_command',
      'abyssal_rift',
    ].entries()) {
      const extraTarget = addTarget(sim, 7 + index, 9910 + index);
      onCastCompleted(ctxOf(sim), player, abilityId, extraTarget);
      expect(extraTarget.auras.find((aura) => aura.id === 'wlk_leaden_hex_slow')).toMatchObject({
        stacks: 1,
      });
    }
  });

  it('holds the Leaden Hex slow while Blackrot ticks, but only a cast stacks or roots', () => {
    // A warlock with no specialization is the one that knows Blackrot.
    const { sim, player } = rig({ 8: 'wlk_r8_curse_of_exhaustion' }, null);
    const target = addTarget(sim);
    player.hitBonus = 1;
    sim.castAbility('corruption');
    // Finish the cast; the DoT then lands at once (no travel time).
    for (let i = 0; i < 20 * 5 && player.castingAbility; i++) sim.tick();
    expect(
      target.auras.some((aura) => aura.id === 'corruption' && aura.sourceId === player.id),
    ).toBe(true);
    const slow = () => target.auras.find((aura) => aura.id === 'wlk_leaden_hex_slow');
    expect(slow()).toMatchObject({ stacks: 1, value: 0.9 });

    // Well past the 5 sec slow: Blackrot's 3 sec ticks keep it on, at one stack.
    tick(sim, 20 * 12);
    expect(slow()).toMatchObject({ stacks: 1, value: 0.9 });
    expect(target.auras.some((aura) => aura.id === 'wlk_leaden_hex_root')).toBe(false);

    // A stack the ticks are holding still roots on the next cast at three.
    onCastCompleted(ctxOf(sim), player, 'shadow_bolt', target);
    onCastCompleted(ctxOf(sim), player, 'shadow_bolt', target);
    expect(slow()).toMatchObject({ stacks: 3 });
    tick(sim, 20 * 7);
    expect(slow()).toMatchObject({ stacks: 3 });
    expect(target.auras.some((aura) => aura.id === 'wlk_leaden_hex_root')).toBe(false);
    onCastCompleted(ctxOf(sim), player, 'shadow_bolt', target);
    expect(target.auras.some((aura) => aura.id === 'wlk_leaden_hex_root')).toBe(true);
  });

  it('lets the Leaden Hex slow wear off without a sustaining DoT', () => {
    const { sim, player } = rig({ 8: 'wlk_r8_curse_of_exhaustion' }, 'affliction');
    const target = addTarget(sim);
    onCastCompleted(ctxOf(sim), player, 'needle_of_fate', target);
    expect(target.auras.some((aura) => aura.id === 'wlk_leaden_hex_slow')).toBe(true);
    tick(sim, 20 * 6);
    expect(target.auras.some((aura) => aura.id === 'wlk_leaden_hex_slow')).toBe(false);
  });

  it('does not aggro an idle mob until a Leaden Hex-triggering bolt actually lands', () => {
    const { sim, player } = rig({ 8: 'wlk_r8_curse_of_exhaustion' });
    const target = addTarget(sim, 6);
    const meta = sim.players.get(player.id);
    if (!meta) throw new Error('missing player meta');
    expect(target.aiState).toBe('idle');

    // Drive the cast directly through castAbility/updateCasting (not sim.tick()) so
    // this stays isolated from the rest of the live world simulation, matching the
    // pattern in tests/spell_resist.test.ts.
    castAbility(ctxOf(sim), 'shadow_bolt', player.id);
    let guard = 0;
    while (player.castingAbility && guard++ < 1000) updateCasting(ctxOf(sim), player, meta);

    // The cast has completed: Leaden Hex's slow applies immediately (by design), but
    // shadow_bolt fires a homing projectile, so the bolt is still in flight here. The
    // mob must not have been pulled into combat yet.
    expect(target.auras.some((aura) => aura.id === 'wlk_leaden_hex_slow')).toBe(true);
    expect(target.aiState).toBe('idle');
    expect(target.inCombat).toBe(false);
    expect(player.inCombat).toBe(false);

    for (let i = 0; i < 200 && ctxOf(sim).pendingProjectiles.length > 0; i++) {
      advancePendingProjectiles(ctxOf(sim));
    }

    // Once the bolt actually lands, the hit resolves normally and engages combat.
    expect(target.inCombat).toBe(true);
    expect(target.aiState).not.toBe('idle');
  });

  it('keeps the class interrupt and grants its level 8 control version', () => {
    expect(rig({}).sim.resolvedAbility('spell_lock')).not.toBeNull();
    expect(rig({ 8: 'wlk_r8_voidfeast' }).sim.resolvedAbility('spell_lock')).toMatchObject({
      cooldown: 24,
      effects: [
        { type: 'interrupt', lockout: 4 },
        { type: 'silence', duration: 4 },
      ],
    });
  });

  it('implements Sanguine Covenant', () => {
    const pact = rig({ 11: 'wlk_r11_fel_concentration' });
    const hpBefore = pact.player.hp;
    pact.sim.castAbility('dark_pact');
    expect(pact.player.hp).toBe(hpBefore - Math.round(hpBefore * 0.1));
    expect(pact.player.auras.find((aura) => aura.id === 'dark_pact')).toMatchObject({
      kind: 'absorb',
      value: Math.round(pact.player.maxHp * 0.3),
      remaining: 30,
    });
    expect(pact.player.cooldowns.get('dark_pact')).toBe(30);
  });

  it('makes Pact Deepened double Fiendhide armor', () => {
    expect(ABILITIES.demon_skin.description).toContain(
      'Pact Deepened can double this armor and reduce magic damage taken while Fiendhide is active',
    );
    const base = rig({});
    const deepened = rig({ 11: 'wlk_r11_improved_life_tap' });
    const baseArmor = base.player.stats.armor;
    const deepenedArmor = deepened.player.stats.armor;

    base.sim.castAbility('demon_skin');
    deepened.sim.castAbility('demon_skin');

    // 88/176, not the authored 80/160: Fiendhide's armor is a flat-magnitude
    // buff kind, which deliberately scales with the destruction viability
    // floor's spellDmgPct 0.1 (SCALABLE_BUFF_KINDS in content/classes.ts).
    expect(base.player.stats.armor - baseArmor).toBe(88);
    expect(deepened.player.stats.armor - deepenedArmor).toBe(176);
    expect(base.player.auras.find((aura) => aura.id === 'demon_skin')?.value2).toBeUndefined();
    expect(deepened.player.auras.find((aura) => aura.id === 'demon_skin')).toMatchObject({
      value: 176,
      value2: 0.05,
    });
  });

  it('keeps Cruel Pact a 10% health for 20% mana trade under the viability floors', () => {
    // The 2026-08-23 spellDmgPct floors must not reach the mana economy: scaleEffect
    // passes the Cruel Pact effect through untouched, so the tooltip's percentages hold.
    const { sim, player } = rig({});
    expect(sim.resolvedAbility('life_tap')?.def.name).toBe('Cruel Pact');
    const effect = sim
      .resolvedAbility('life_tap')
      ?.effects.find((candidate) => candidate.type === 'afflictionCruelPact');
    expect(effect).toMatchObject({ healthPct: 0.1, manaPctMax: 0.2, doom: 0 });

    player.resource = 0;
    const hpBefore = player.hp;
    sim.castAbility('life_tap');
    expect(player.hp).toBe(hpBefore - Math.round(player.maxHp * 0.1));
    expect(player.resource).toBe(Math.round(player.maxResource * 0.2));
    expect(player.cooldowns.has('life_tap')).toBe(false);
    // It grants no Condemnation.
    expect(player.auras.some((aura) => aura.kind === 'affliction_doom')).toBe(false);
  });

  it('gives Hexcraft the shared Cruel Pact and retires its own', () => {
    const { sim } = rig({}, 'affliction');
    const known = sim.players.get(sim.playerId)?.known.map((ability) => ability.def.id);
    expect(known).toEqual(expect.arrayContaining(['life_tap', 'hard_bargain']));
    expect(known).not.toContain('cruel_pact');
    expect(ABILITIES.cruel_pact.hiddenFromPlayer).toBe(true);
  });

  it('makes Blood Credit raise Cruel Pact and Hard Bargain to 30%, tooltips included', () => {
    const base = rig({});
    const baseTap = base.sim.resolvedAbility('life_tap');
    const baseBargain = base.sim.resolvedAbility('hard_bargain');
    if (!baseTap || !baseBargain) throw new Error('missing pacts');
    expect(abilityDisplayDescription(baseTap, '')).toContain('restore 20% of your maximum mana');
    expect(abilityDisplayDescription(baseBargain, '')).toContain(
      'restore 20% of your maximum health',
    );

    const { sim, player } = rig({ 14: 'wlk_r14_ruin' });
    const tap = sim.resolvedAbility('life_tap');
    const bargain = sim.resolvedAbility('hard_bargain');
    if (!tap || !bargain) throw new Error('missing pacts');
    expect(tap.effects.find((e) => e.type === 'afflictionCruelPact')).toMatchObject({
      manaPctMax: 0.3,
    });
    expect(bargain.effects.find((e) => e.type === 'hardBargain')).toMatchObject({
      healPctMax: 0.3,
    });
    expect(abilityDisplayDescription(tap, '')).toContain('restore 30% of your maximum mana');
    expect(abilityDisplayDescription(bargain, '')).toContain('restore 30% of your maximum health');

    player.resource = player.maxResource;
    player.hp = Math.round(player.maxHp / 2);
    const hpBefore = player.hp;
    sim.castAbility('hard_bargain');
    expect(player.hp).toBe(hpBefore + Math.round(player.maxHp * 0.3));
  });

  it('makes Hard Bargain trade 20% of max mana for 20% of max health on the GCD', () => {
    const { sim, player } = rig({});
    expect(sim.resolvedAbility('hard_bargain')?.def.name).toBe('Hard Bargain');

    player.resource = player.maxResource;
    player.hp = Math.round(player.maxHp / 2);
    const hpBefore = player.hp;
    sim.castAbility('hard_bargain');
    expect(player.resource).toBe(player.maxResource - Math.round(player.maxResource * 0.2));
    expect(player.hp).toBe(hpBefore + Math.round(player.maxHp * 0.2));
    expect(player.gcdRemaining).toBeGreaterThan(0);
    expect(player.cooldowns.has('hard_bargain')).toBe(false);

    // Short on mana: refused before the GCD, nothing spent or healed.
    player.gcdRemaining = 0;
    player.resource = Math.round(player.maxResource * 0.2) - 1;
    const hpShort = player.hp;
    sim.castAbility('hard_bargain');
    expect(player.resource).toBe(Math.round(player.maxResource * 0.2) - 1);
    expect(player.hp).toBe(hpShort);
    expect(player.gcdRemaining).toBe(0);

    // Full health: refused too, so a stray press costs no mana.
    player.resource = player.maxResource;
    player.hp = player.maxHp;
    sim.castAbility('hard_bargain');
    expect(player.resource).toBe(player.maxResource);
    expect(player.gcdRemaining).toBe(0);
  });

  it('makes Pact Deepened reduce magic damage by 5% only while Fiendhide is active', () => {
    const { sim, player } = rig({ 11: 'wlk_r11_improved_life_tap' });
    const source = addTarget(sim);
    const hpBefore = player.hp;

    dealDamage(sim.ctx, source, player, 100, false, 'fire', 'Test Flame', 'hit');
    expect(player.hp).toBe(hpBefore - 100);

    player.hp = hpBefore;
    sim.castAbility('demon_skin');
    dealDamage(sim.ctx, source, player, 100, false, 'fire', 'Test Flame', 'hit');
    expect(player.hp).toBe(hpBefore - 95);

    player.hp = hpBefore;
    dealDamage(sim.ctx, source, player, 100, false, 'physical', 'Test Strike', 'hit');
    expect(player.hp).toBe(hpBefore - 100);
  });

  it('keeps an active Fiendhide aura synchronized when Pact Deepened changes', () => {
    const { sim, player } = rig({});
    const baseArmor = player.stats.armor;
    sim.castAbility('demon_skin');
    // 88/176 through the destruction viability floor, same reasoning as the
    // Pact Deepened doubling test above.
    expect(player.auras.find((aura) => aura.id === 'demon_skin')).toMatchObject({
      value: 88,
      value2: undefined,
    });

    expect(
      sim.applyTalents({
        spec: 'destruction',
        rows: { 11: 'wlk_r11_improved_life_tap' },
      }),
    ).toBe(true);
    expect(player.auras.find((aura) => aura.id === 'demon_skin')).toMatchObject({
      value: 176,
      value2: 0.05,
    });
    expect(player.stats.armor - baseArmor).toBe(176);

    expect(sim.applyTalents({ spec: 'destruction', rows: {} })).toBe(true);
    expect(player.auras.find((aura) => aura.id === 'demon_skin')).toMatchObject({
      value: 88,
      value2: undefined,
    });
    expect(player.stats.armor - baseArmor).toBe(88);
  });

  it('awards one or two Shadow Credit charges from real specialization spending', () => {
    const { sim, player } = rig({ 14: 'wlk_r14_shadow_mastery' });
    const ctx = ctxOf(sim);
    gainRuin(ctx, player, 4);
    expect(spendRuin(ctx, player, 4)).toBe(true);
    expect(player.auras.find((aura) => aura.id === 'wlk_shadow_credit')?.charges).toBe(2);
    expect(consumeFreeCostFor(ctx, player, 'shadow_bolt')).toBe(true);
    expect(player.auras.find((aura) => aura.id === 'wlk_shadow_credit')?.charges).toBe(1);
    expect(consumeFreeCostFor(ctx, player, 'shadow_bolt')).toBe(true);
    expect(consumeFreeCostFor(ctx, player, 'shadow_bolt')).toBe(false);
  });

  it('speeds a generator only after standing still for a full second', () => {
    const { sim, player } = rig({ 17: 'wlk_r17_improved_fear' }, 'affliction');
    const target = addTarget(sim);
    tick(sim, 20);
    const base = sim.resolvedAbility('needle_of_fate')?.castTime ?? 0;
    sim.castAbility('needle_of_fate');
    expect(player.castTargetId).toBe(target.id);
    expect(player.castTotal).toBeCloseTo(base * 0.8);
  });

  it('reduces class and specialization cooldowns while casting', () => {
    const { sim, player } = rig({ 20: 'wlk_r20_chaos_bolt' }, 'affliction');
    addTarget(sim);
    player.cooldowns.set('umbral_anchor', 10);
    player.cooldowns.set('hex_of_violence', 10);
    sim.castAbility('needle_of_fate');
    tick(sim, 20);
    expect(player.cooldowns.get('umbral_anchor')).toBeCloseTo(8.5);
    expect(player.cooldowns.get('hex_of_violence')).toBeCloseTo(8.5);
  });

  it('reduces Possess the Evil Eye and Hour of Judgment while casting', () => {
    const { sim, player } = rig({ 20: 'wlk_r20_chaos_bolt' }, 'affliction');
    addTarget(sim);
    player.cooldowns.set('possess_evil_eye', 10);
    player.cooldowns.set('hour_of_judgment', 10);

    sim.castAbility('needle_of_fate');
    tick(sim, 20);

    expect(player.cooldowns.get('possess_evil_eye')).toBeCloseTo(8.5);
    expect(player.cooldowns.get('hour_of_judgment')).toBeCloseTo(8.5);
  });

  it('includes specialization signatures in Unbroken Ritual', () => {
    expect(ABILITIES.conflagrate.specs).toEqual(['destruction']);
    expect(ABILITIES.metamorphosis.specs).toEqual(['demonology']);

    const { sim, player } = rig({ 20: 'wlk_r20_chaos_bolt' }, 'destruction');
    addTarget(sim);
    player.cooldowns.set('umbral_anchor', 10);
    player.cooldowns.set('conflagrate', 10);
    sim.castAbility('shadow_bolt');
    tick(sim, 20);

    expect(player.cooldowns.get('umbral_anchor')).toBeCloseTo(8.5);
    expect(player.cooldowns.get('conflagrate')).toBeCloseTo(8.5);
  });

  it('lets Forbidden Reflection repeat a specialization signature', () => {
    const { sim, player } = rig({ 20: 'wlk_r20_grimoire_of_haste' }, 'demonology');
    sim.castAbility('metamorphosis');
    expect(canUseForbiddenReflection(player, 'metamorphosis')).toBe(true);
    tick(sim, 30);
    const remaining = player.cooldowns.get('metamorphosis') ?? 0;

    sim.castAbility('metamorphosis');

    expect(player.cooldowns.get('metamorphosis')).toBeCloseTo(remaining);
    expect(canUseForbiddenReflection(player, 'metamorphosis')).toBe(false);
  });

  it('lets Forbidden Reflection repeat one shared cooldown without restarting it', () => {
    const { sim, player } = rig({
      11: 'wlk_r11_fel_concentration',
      20: 'wlk_r20_grimoire_of_haste',
    });
    sim.castAbility('dark_pact');
    expect(player.auras.some((aura) => aura.id === 'wlk_forbidden_reflection')).toBe(true);
    tick(sim, 30);
    const remaining = player.cooldowns.get('dark_pact') ?? 0;
    const hpBeforeCopy = player.hp;
    sim.castAbility('dark_pact');
    expect(player.hp).toBe(hpBeforeCopy - Math.round(hpBeforeCopy * 0.1));
    expect(player.cooldowns.get('dark_pact')).toBeCloseTo(remaining);
    expect(player.auras.some((aura) => aura.id === 'wlk_forbidden_reflection')).toBe(false);
  });

  it('does not waste Forbidden Reflection on Soulwell', () => {
    const { sim, player } = rig({ 20: 'wlk_r20_grimoire_of_haste' });

    sim.castAbility('soulwell');
    tick(sim, 80);

    expect(player.cooldowns.has('soulwell')).toBe(true);
    expect(player.auras.some((aura) => aura.id === 'wlk_forbidden_reflection')).toBe(false);
    expect(player.auras.some((aura) => aura.id === 'wlk_forbidden_reflection_lock')).toBe(false);
  });

  it('does not let Forbidden Reflection duplicate Army of the Dead', () => {
    const { sim, player } = rig({ 20: 'wlk_r20_grimoire_of_haste' }, 'demonology');
    player.resource = player.maxResource;

    sim.castAbility('army_of_the_dead');
    tick(sim, 40);

    expect(player.cooldowns.has('army_of_the_dead')).toBe(true);
    expect(canUseForbiddenReflection(player, 'army_of_the_dead')).toBe(false);
    expect(player.auras.some((aura) => aura.id === 'wlk_forbidden_reflection')).toBe(false);
    expect(player.auras.some((aura) => aura.id === 'wlk_forbidden_reflection_lock')).toBe(false);
  });

  it('removes transient talent state when the selected rows change', () => {
    const { sim, player } = rig({
      5: 'wlk_r5_improved_immolate',
      11: 'wlk_r11_fel_concentration',
      14: 'wlk_r14_shadow_mastery',
      20: 'wlk_r20_grimoire_of_haste',
    });
    const ctx = ctxOf(sim);
    sim.castAbility('sacrilegious_march');
    gainRuin(ctx, player, 4);
    expect(spendRuin(ctx, player, 4)).toBe(true);
    player.gcdRemaining = 0;
    sim.castAbility('dark_pact');
    expect(canUseForbiddenReflection(player, 'dark_pact')).toBe(true);

    expect(
      sim.applyTalents({
        spec: 'destruction',
        rows: {
          5: 'wlk_r5_bane',
          11: 'wlk_r11_fel_concentration',
          14: 'wlk_r14_ruin',
          20: 'wlk_r20_curse_mastery',
        },
      }),
    ).toBe(true);

    expect(player.auras.some((aura) => aura.id === 'sacrilegious_march')).toBe(false);
    expect(player.auras.some((aura) => aura.id === 'wlk_shadow_credit')).toBe(false);
    expect(canUseForbiddenReflection(player, 'dark_pact')).toBe(false);
    const hpAfterRespec = player.hp;
    tick(sim, 20);
    expect(player.hp).toBe(hpAfterRespec);
    expect(consumeFreeCostFor(ctx, player, 'shadow_bolt')).toBe(false);
  });

  it('pulls, damages, and stuns with Abyssal Rift', () => {
    const { sim, player } = rig({ 20: 'wlk_r20_curse_mastery' });
    const target = addTarget(sim, 12);
    const center = { x: player.pos.x, z: player.pos.z + 10 };
    const beforeDistance = Math.hypot(target.pos.x - center.x, target.pos.z - center.z);
    const hpBefore = target.hp;
    sim.castAbility('abyssal_rift', undefined, center);
    expect(target.hp).toBeLessThan(hpBefore);
    expect(player.cooldowns.get('abyssal_rift')).toBe(45);
    expect(Math.hypot(target.pos.x - center.x, target.pos.z - center.z)).toBeLessThan(
      beforeDistance,
    );
    expect(target.auras.find((aura) => aura.id === 'abyssal_rift_stun')).toMatchObject({
      kind: 'stun',
      remaining: 2,
    });

    player.gcdRemaining = 0;
    player.resource = player.maxResource;
    const hpDuringCooldown = target.hp;
    sim.castAbility('abyssal_rift', undefined, center);
    expect(target.hp).toBe(hpDuringCooldown);

    target.hostile = false;
    player.maxHp = player.hp = 1_000_000;
    tick(sim, 20 * 45 - 1);
    expect(player.cooldowns.get('abyssal_rift')).toBeGreaterThan(0);
    tick(sim, 1);
    expect(player.cooldowns.get('abyssal_rift')).toBeLessThan(DT);
    tick(sim, 1);
    expect(player.cooldowns.has('abyssal_rift')).toBe(false);

    target.hostile = true;
    player.gcdRemaining = 0;
    player.resource = player.maxResource;
    sim.castAbility('abyssal_rift', undefined, center);
    expect(player.cooldowns.get('abyssal_rift')).toBe(45);
  });

  it('damages bosses with Abyssal Rift without pulling or stunning them', () => {
    const { sim, player } = rig({ 20: 'wlk_r20_curse_mastery' });
    const boss = createMob(9902, MOBS.nythraxis_scourge_of_thornpeak, 20, {
      x: player.pos.x,
      y: player.pos.y,
      z: player.pos.z + 12,
    });
    boss.hostile = true;
    boss.maxHp = boss.hp = 10000;
    (sim as unknown as { addEntity(entity: Entity): void }).addEntity(boss);
    const positionBefore = { ...boss.pos };
    const hpBefore = boss.hp;

    sim.castAbility('abyssal_rift', undefined, {
      x: player.pos.x,
      z: player.pos.z + 10,
    });

    expect(boss.hp).toBeLessThan(hpBefore);
    expect(boss.pos).toEqual(positionBefore);
    expect(boss.auras.some((aura) => aura.id === 'abyssal_rift_stun')).toBe(false);
  });

  it('damages a fixed practice dummy with Abyssal Rift without dragging it off its marker', () => {
    const { sim, player } = rig({ 20: 'wlk_r20_curse_mastery' });
    const dummyTemplate = Object.values(MOBS).find((template) => template.dummy === true);
    if (!dummyTemplate) throw new Error('The mob registry has no dummy fixture.');
    const dummy = createMob(9903, dummyTemplate, 20, {
      x: player.pos.x,
      y: player.pos.y,
      z: player.pos.z + 12,
    });
    dummy.hostile = true;
    dummy.maxHp = dummy.hp = 999999;
    (sim as unknown as { addEntity(entity: Entity): void }).addEntity(dummy);
    const positionBefore = { ...dummy.pos };
    const hpBefore = dummy.hp;

    sim.castAbility('abyssal_rift', undefined, {
      x: player.pos.x,
      z: player.pos.z + 10,
    });

    expect(dummy.hp).toBeLessThan(hpBefore);
    expect(dummy.pos).toEqual(positionBefore);
  });
});
