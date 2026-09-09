// v0.42.0 class balance: the three CUSTOM healing sources that bypass the
// generic effect_dispatch/casting_lifecycle primary-heal seam and therefore
// need their own explicit primaryHealingMultiplier wiring plus, for two of
// them, a real pre-existing bug reproduction:
//   - paladin_aegis.ts tickPaladinAegis/completePaladinAegis: the SP rider
//     historically omitted the resolved talent healing multiplier.
//   - druid_engines.ts replantWildbloom: the replant historically omitted
//     BOTH the talent healing multiplier and the hotHealPct global on its
//     Healing Power rider (tests/healing_power_readers.test.ts pins the old,
//     now-superseded, no-multiplier behavior and documents the change).
//   - paladin_talents.ts unleashPerpetualSun: a class-wide choice-row ability
//     whose flat heal must gain the Sunmender-only factor while its flat
//     damage is untouched, guarded per caster spec (not per ability).
//
// This depends on spec_output_tuning.ts primaryHealingMultiplier
// (src/sim/spec_output_tuning.ts): that module and its own suite
// (tests/spec_output_tuning.test.ts) are the durable source for the current
// per-spec factors if this file cannot resolve that import.
import { describe, expect, it } from 'vitest';
import { resolveDruidOverbloom } from '../src/sim/combat/druid_engines';
import { completePaladinAegis, tickPaladinAegis } from '../src/sim/combat/paladin_aegis';
import { unleashPerpetualSun } from '../src/sim/combat/paladin_talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { scalePrimaryHealing } from '../src/sim/primary_healing';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { fiestaApplyAugments } from '../src/sim/social/fiesta';
import { primaryHealingMultiplier } from '../src/sim/spec_output_tuning';
import { channelTickBonus, directHealBonus, hotTickBonus } from '../src/sim/spell_scaling';
import { resolveTalentHitMult } from '../src/sim/talent_hit_mult';
import type { AbilityEffect, Entity } from '../src/sim/types';

function ctxOf(sim: Sim): SimContext {
  return (sim as unknown as { ctx: SimContext }).ctx;
}

function partyAlly(sim: Sim, cls: 'priest' | 'warrior', level: number): Entity {
  const allyId = sim.addPlayer(cls, 'Ally');
  sim.setPlayerLevel(level, allyId);
  sim.partyInvite(allyId, sim.player.id);
  sim.partyAccept(allyId);
  const ally = sim.entities.get(allyId);
  if (!ally) throw new Error('missing ally');
  ally.pos = { ...sim.player.pos };
  return ally;
}

function hostileNear(sim: Sim, offset: number): Entity {
  const mob = createMob(9711, MOBS.ridge_stalker, 20, {
    x: sim.player.pos.x + offset,
    y: sim.player.pos.y,
    z: sim.player.pos.z,
  });
  mob.hostile = true;
  mob.maxHp = mob.hp = 1_000_000;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  return mob;
}

describe('Sunmender primary-healing factor: Aegis of the First Dawn', () => {
  it('pins Sunmender at 1.10 and every other paladin spec (and no spec) at 1', () => {
    expect(primaryHealingMultiplier('paladin', 'holy')).toBe(1.1);
    expect(primaryHealingMultiplier('paladin', 'retribution')).toBe(1);
    expect(primaryHealingMultiplier('paladin', null)).toBe(1);
  });

  it('reproduces and corrects the missing talent healing multiplier on the SP rider, then scales the complete tick and burst exactly once', () => {
    const sim = new Sim({ seed: 1701, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('holy')).toBe(true);
    const ally = partyAlly(sim, 'priest', 20);
    const p = sim.player;
    p.spellPower = 70;
    p.healPower = 70;
    sim.rng.next = () => 0.5; // pins ctx.rng.range to its exact midpoint

    const ctx = ctxOf(sim);
    const res = ctx.resolvedAbility('aegis_first_dawn', p.id);
    if (!res) throw new Error('missing resolved Aegis of the First Dawn');
    const meta = sim.players.get(p.id);
    if (!meta) throw new Error('missing player meta');
    const mods = ctx.playerMods(meta);

    // Holy carries no legacy spec_baselines.ts entry (Paladin is excluded by
    // design) and no row grants aegis_first_dawn a per-ability bonus, so the
    // multiplier this fix newly threads through is exactly 1 today; the
    // wiring is still real (see the wildbloom reproduction below for a case
    // where it is not 1) and must reach the rider regardless of its value.
    const talentHealMult = resolveTalentHitMult(res.def, mods).healMult;
    expect(talentHealMult).toBe(1);
    const healMultiplier = primaryHealingMultiplier(meta.cls, mods.spec);
    expect(healMultiplier).toBe(1.1);

    // Aegis' own radius includes the caster (dist2d(self, self) is always 0),
    // so the completion burst also self-heals and self-buffs the caster below;
    // that self-buff aura triggers recalcPlayerStats on the caster (an
    // existing, unrelated behavior of applyAura), which would rebuild
    // healPower from gear if read AFTER the call. Snapshot the expected
    // amounts from the pre-call healPower, exactly like the production code
    // does internally, rather than re-reading the (by-then-rebuilt) live stat.
    const tickBonus = channelTickBonus(p.healPower, res.def, talentHealMult);
    const expectedTick = scalePrimaryHealing(40 + tickBonus, healMultiplier);
    expect(expectedTick).toBe(59); // round((40 + 14) * 1.10)
    const finalBonus = directHealBonus(p.healPower, 0, true, talentHealMult);
    const expectedFinal = scalePrimaryHealing(135 + finalBonus, healMultiplier);
    expect(expectedFinal).toBe(171); // round((135 + 20) * 1.10)

    // Read emitted heal2 events rather than hp deltas: the burst also applies
    // a speed buff to every eligible ally (the caster included, since it sits
    // inside its own radius), and that applyAura call unconditionally runs
    // recalcPlayerStats on a player target, which rebuilds maxHp from gear and
    // then rescales hp to the SAME fraction against its (possibly poked)
    // maxHp, so a deliberately inflated maxHp would silently undo the hp
    // delta this reads back (existing behavior, unrelated to this fix). Keep
    // maxHp at its natural gear-derived value (well above either heal) and
    // just re-injure the ally between casts so neither heal clamps to zero.
    ally.hp = 1;
    tickPaladinAegis(ctx, p, res);
    ally.hp = 1;
    completePaladinAegis(ctx, p, res);
    const allyHeals = sim.events.flatMap((event) =>
      event.type === 'heal2' && event.targetId === ally.id && event.ability === res.def.name
        ? [event.amount]
        : [],
    );
    expect(allyHeals).toEqual([expectedTick, expectedFinal]);
  });
});

describe('Aegis reproduces a real non-1 talentHealMult (Fiesta healing augment)', () => {
  // Holy carries no legacy spec_baselines.ts entry and no row grants
  // aegis_first_dawn an ability-specific bonus, so every talent-tree path
  // leaves talentHealMult at exactly 1 (proven above). A live Fiesta match
  // is a REAL reachable source of a non-1 value for ANY spec: fiesta.ts's
  // fiestaApplyAugments layers a picked augment's global.healPct onto a
  // FRESH TalentModifiers (mergeAugmentMods) and stores it as meta.fiestaMods,
  // which sim.ts's playerMods(meta) (meta.fiestaMods ?? meta.talentMods) then
  // returns in place of the plain talent mods for every ctx.playerMods(meta)
  // caller, Aegis included. aug_mending (roles: ['healer'], global.healPct
  // +0.20) is the exact augment a holy paladin could pick mid-match. This
  // proves the resolveTalentHitMult wiring added to paladin_aegis.ts is not
  // dead code: it reaches the SP rider for a real, non-1 multiplier, on top
  // of (never instead of) the independent 1.10 Sunmender primary factor.
  it('threads aug_mending into the SP rider exactly once, alongside the independent Sunmender primary factor', () => {
    const sim = new Sim({ seed: 4242, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('holy')).toBe(true);
    const ally = partyAlly(sim, 'priest', 20);
    const p = sim.player;
    const meta = sim.players.get(p.id);
    if (!meta) throw new Error('missing player meta');

    meta.fiestaAugments = ['aug_mending'];
    fiestaApplyAugments(meta, p); // recalcPlayerStats runs here; poke stats AFTER
    p.spellPower = 70;
    p.healPower = 70;
    sim.rng.next = () => 0.5; // pins ctx.rng.range to its exact midpoint

    const ctx = ctxOf(sim);
    const mods = ctx.playerMods(meta);
    expect(mods).toBe(meta.fiestaMods); // confirms the augmented mods are actually live
    const res = ctx.resolvedAbility('aegis_first_dawn', p.id);
    if (!res) throw new Error('missing resolved Aegis of the First Dawn');

    const talentHealMult = resolveTalentHitMult(res.def, mods).healMult;
    expect(talentHealMult).toBeCloseTo(1.2, 5); // 1 + aug_mending's 0.20 healPct
    const healMultiplier = primaryHealingMultiplier(meta.cls, mods.spec);
    expect(healMultiplier).toBe(1.1); // Sunmender factor, independent of the augment

    // classes.ts's scaleEffect ALSO bakes healMult into the authored
    // tickMin/tickMax/finalMin/finalMax at resolve time (its own 'paladinAegis'
    // case, the same pattern every other heal-type effect already gets), so
    // the resolved base is no longer the raw authored 35-45/120-150 once
    // talentHealMult is not 1: read it from the resolved effect rather than
    // assuming the raw authored literals.
    const effect = res.effects.find(
      (e): e is Extract<AbilityEffect, { type: 'paladinAegis' }> => e.type === 'paladinAegis',
    );
    if (!effect) throw new Error('missing resolved paladinAegis effect');
    const tickBase = (effect.tickMin + effect.tickMax) / 2; // rng pinned at 0.5: exact midpoint
    const finalBase = (effect.finalMin + effect.finalMax) / 2;

    const tickBonus = channelTickBonus(p.healPower, res.def, talentHealMult);
    const expectedTick = scalePrimaryHealing(tickBase + tickBonus, healMultiplier);
    expect(expectedTick).toBe(72); // round((48 + 17) * 1.10); base 48 = avg(round(35*1.2), round(45*1.2))
    const finalBonus = directHealBonus(p.healPower, 0, true, talentHealMult);
    const expectedFinal = scalePrimaryHealing(finalBase + finalBonus, healMultiplier);
    expect(expectedFinal).toBe(205); // round((162 + 24) * 1.10); base 162 = avg(round(120*1.2), round(150*1.2))
    // Decisive: both differ from the mult-1 case pinned above (59/171), so
    // this is not a defaulted no-op pass-through.
    expect(expectedTick).not.toBe(59);
    expect(expectedFinal).not.toBe(171);

    // Deep deficit against the ally's real (natural, unpoked) maxHp: large
    // enough headroom that neither packet clamps and hides either factor.
    ally.hp = 1;
    tickPaladinAegis(ctx, p, res);
    ally.hp = 1;
    completePaladinAegis(ctx, p, res);
    const allyHeals = sim.events.flatMap((event) =>
      event.type === 'heal2' && event.targetId === ally.id && event.ability === res.def.name
        ? [event.amount]
        : [],
    );
    expect(allyHeals).toEqual([expectedTick, expectedFinal]);
  });
});

describe('Groveheart primary-healing factor: Wildbloom replant', () => {
  it('pins Groveheart at 1.05 and every other druid spec (and no spec) at 1', () => {
    // Retuned down from the initial 1.20 candidate (spec_output_tuning.ts):
    // combined with the corrected Wildbloom replant scaling below, the total
    // engine-profile increase already lands near +20% without stacking a
    // full second buff on top of the bug fix (class-balance-v042.md, "do not
    // silently stack a full buff on a large bug fix").
    expect(primaryHealingMultiplier('druid', 'restoration')).toBe(1.05);
    expect(primaryHealingMultiplier('druid', 'balance')).toBe(1);
    expect(primaryHealingMultiplier('druid', 'feral')).toBe(1);
    expect(primaryHealingMultiplier('druid', null)).toBe(1);
  });

  it('reproduces and corrects the missing talent/hotHealPct multiplier on the replant rider, then scales the complete tick exactly once', () => {
    const sim = new Sim({ seed: 29, playerClass: 'druid', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('restoration')).toBe(true);
    const p = sim.player;
    p.spellPower = 70;
    p.healPower = 70;

    const ctx = ctxOf(sim);
    const meta = sim.players.get(p.id);
    if (!meta) throw new Error('missing player meta');
    const mods = ctx.playerMods(meta);
    const resolved = ctx.resolvedAbility('rejuvenation', p.id);
    if (!resolved) throw new Error('missing resolved Rejuvenation');
    const hotEffect = resolved.effects.find((effect) => effect.type === 'hot');
    if (hotEffect?.type !== 'hot') throw new Error('missing hot effect');

    // Restoration's spec_baselines.ts entry (global healPct 0.08, rejuvenation
    // ability dmgPct 0.24) plus Grove's Gift mastery (hotHealPct 0.25) give a
    // non-1 multiplier here, unlike the holy paladin case above: this is the
    // scenario the historical bug actually mattered for.
    const talentHealMult = resolveTalentHitMult(resolved.def, mods).healMult;
    expect(talentHealMult).toBeCloseTo(1.32, 5);
    const combinedHotMult = talentHealMult * (1 + mods.global.hotHealPct);
    expect(combinedHotMult).toBeCloseTo(1.65, 5);

    const hotBase = Math.max(
      1,
      Math.round(hotEffect.total / (hotEffect.duration / hotEffect.interval)),
    );
    // Snapshot the expected SP rider from the pre-call healPower: replanting
    // onto the caster itself (castTarget === player, as resolveDruidOverbloom
    // does here) plants the HoT aura on the caster, and applyAura's existing
    // recalcPlayerStats-on-player-target behavior would otherwise rebuild
    // healPower from gear before this reads it.
    const hotSp = hotTickBonus(
      p.healPower,
      hotEffect.duration,
      hotEffect.interval,
      combinedHotMult,
    );
    const healMultiplier = primaryHealingMultiplier(meta.cls, mods.spec);
    expect(healMultiplier).toBe(1.05);
    const expected = scalePrimaryHealing(hotBase + hotSp, healMultiplier);
    expect(expected).toBe(121); // round((69 + 46) * 1.05)

    // harvestPct 0: no owned HoTs exist yet to harvest, isolating the replant.
    resolveDruidOverbloom(ctx, p, p, 0);
    const hot = p.auras.find((aura) => aura.id === 'rejuvenation' && aura.kind === 'hot');
    if (!hot) throw new Error('no replanted rejuvenation');
    expect(hot.duration).toBe(12);
    expect(hot.tickInterval).toBe(3);
    expect(hot.value).toBe(expected);
  });
});

describe('Sunmender-only heal on the class-wide Perpetual Sun', () => {
  function rig(spec: string): { sim: Sim; ally: Entity; enemy: Entity; ctx: SimContext } {
    const sim = new Sim({ seed: 5, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec(spec)).toBe(true);
    const ally = partyAlly(sim, 'warrior', 20);
    const enemy = hostileNear(sim, 5);
    ally.maxHp = 1_000_000;
    ally.hp = 1;
    enemy.maxHp = enemy.hp = 1_000_000;
    return { sim, ally, enemy, ctx: ctxOf(sim) };
  }

  it('scales the flat heal by 1.10 for holy while leaving the flat damage at its authored amount', () => {
    const { sim, ally, enemy, ctx } = rig('holy');
    unleashPerpetualSun(ctx, sim.player);
    expect(ally.hp - 1).toBe(165); // round(150 * 1.10)
    expect(enemy.maxHp - enemy.hp).toBe(150);
  });

  it('leaves the heal at the authored flat amount for every other paladin spec', () => {
    const { sim, ally, enemy, ctx } = rig('retribution');
    unleashPerpetualSun(ctx, sim.player);
    expect(ally.hp - 1).toBe(150);
    expect(enemy.maxHp - enemy.hp).toBe(150);
  });
});

// Once-only copy contract: Mending Current, Beacon, Dawn Echo, and Overbloom
// all inherit a stronger PRIMARY heal automatically once the primary is
// scaled; none of them may apply primaryHealingMultiplier a SECOND time on
// top of an already-resolved/already-stored amount (class-balance-v042.md,
// "Important copy cases"). These exercise the real dispatch path end to end
// (a real cast through effect_dispatch.ts's 'heal'/'hot' cases, which I do
// not own) specifically to prove the coordinator's copy sites stay
// once-only; the Aegis/Wildbloom/Perpetual Sun describes above already prove
// MY OWN custom sources apply their own factor exactly once.
describe('Beacon of Light copies the already-scaled effective heal exactly once', () => {
  it('transfers 50% of the Sunmender-scaled primary heal, not a second 1.10 factor on top', () => {
    const sim = new Sim({ seed: 4501, playerClass: 'paladin', noPlayer: true });
    const paladinId = sim.addPlayer('paladin', 'Aurelia');
    const allyId = sim.addPlayer('warrior', 'Borin');
    const beaconId = sim.addPlayer('priest', 'Celia');
    for (const id of [paladinId, allyId, beaconId]) sim.setPlayerLevel(20, id);
    expect(sim.setSpec('holy', paladinId)).toBe(true);
    sim.partyInvite(allyId, paladinId);
    sim.partyAccept(allyId);
    sim.partyInvite(beaconId, paladinId);
    sim.partyAccept(beaconId);
    const paladin = sim.entities.get(paladinId);
    const ally = sim.entities.get(allyId);
    const beacon = sim.entities.get(beaconId);
    if (!paladin || !ally || !beacon) throw new Error('missing entity');
    paladin.spellPower = 70;
    paladin.healPower = 70;

    const ctx = ctxOf(sim);
    // Mark Celia as the beacon holder directly (mirrors paladin_beacon.ts
    // startPaladinBeacon's own aura shape) rather than driving the full
    // beacon_of_light cast, keeping this test focused on the copy math.
    ctx.applyAura(beacon, {
      id: 'beacon_of_light',
      name: 'Beacon of Light',
      kind: 'beacon_of_light',
      remaining: 60,
      duration: 60,
      value: 0.5,
      sourceId: paladin.id,
      school: 'holy',
    });

    // Deep deficits on huge pools: neither the primary heal on Borin nor its
    // Beacon copy on Celia clamps against real headroom.
    ally.maxHp = 1_000_000;
    ally.hp = 1;
    beacon.maxHp = 1_000_000;
    beacon.hp = 1;

    sim.rng.range = () => 200; // within Mending Light rank4's 190-222 at level 20
    sim.rng.chance = () => false; // no crit

    const meta = sim.meta(paladinId);
    const resolved = sim.resolvedAbility('holy_light', paladinId);
    if (!meta || !resolved) throw new Error('missing meta/resolved Mending Light');
    ctx.runEffects(paladin, meta, ally, resolved);

    const primaryHeals = sim.events.flatMap((event) =>
      event.type === 'heal2' && event.targetId === ally.id && event.ability === 'Mending Light'
        ? [event.amount]
        : [],
    );
    expect(primaryHeals).toHaveLength(1);
    const primaryHeal = primaryHeals[0];
    // The primary itself already includes the Sunmender factor once (the
    // generic effect_dispatch.ts 'heal' case, not mine): confirm it is not
    // the raw round(200+60)=260 an unscaled packet would have landed.
    expect(primaryHeal).not.toBe(260);
    expect(primaryHeal).toBe(286); // round((200 + 60) * 1.10)

    const beaconHeals = sim.events.flatMap((event) =>
      event.type === 'heal2' && event.targetId === beacon.id && event.ability === 'Beacon of Light'
        ? [event.amount]
        : [],
    );
    expect(beaconHeals).toEqual([Math.round(primaryHeal * 0.5)]); // 143: half of the already-scaled 286
    // Decisive: a re-application of the 1.10 factor on the copy would land
    // 157, not 143.
    expect(beaconHeals).not.toEqual([Math.round(primaryHeal * 0.5 * 1.1)]);
  });
});

describe('Dawn Echo copies the already-scaled effective heal exactly once', () => {
  it("repeats 40% of the third proc's Sunmender-scaled effective heal, not a second 1.10 factor", () => {
    const sim = new Sim({ seed: 4701, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.applyTalents({ spec: 'holy', rows: { 20: 'pal_r20_dawn_echo' } })).toBe(true);
    const ally = partyAlly(sim, 'warrior', 20);
    const p = sim.player;
    p.spellPower = 70;
    p.healPower = 70;

    const ctx = ctxOf(sim);
    const meta = sim.meta(p.id);
    const resolved = sim.resolvedAbility('holy_light', p.id);
    if (!meta || !resolved) throw new Error('missing meta/resolved Mending Light');

    sim.rng.range = () => 200;
    sim.rng.chance = () => false;

    // Dawn Echo procs on the third Devotion-generating direct cast
    // (advancePaladinTalentCounter's every=3): three back-to-back real casts,
    // re-injuring the same ally each time so none of them clamp.
    for (let cast = 0; cast < 3; cast++) {
      ally.maxHp = 1_000_000;
      ally.hp = 1;
      p.spellPower = 70;
      p.healPower = 70;
      ctx.runEffects(p, meta, ally, resolved);
    }

    const primaryHeals = sim.events.flatMap((event) =>
      event.type === 'heal2' && event.targetId === ally.id && event.ability === 'Mending Light'
        ? [event.amount]
        : [],
    );
    expect(primaryHeals).toHaveLength(3);
    const thirdPrimary = primaryHeals[2];
    expect(thirdPrimary).toBe(286); // round((200 + 60) * 1.10), same packet as the Beacon case above

    const echoHeals = sim.events.flatMap((event) =>
      event.type === 'heal2' && event.targetId === ally.id && event.ability === 'Dawn Echo'
        ? [event.amount]
        : [],
    );
    expect(echoHeals).toEqual([Math.round(thirdPrimary * 0.4)]); // 114: 40% of the already-scaled 286
    // Decisive: a re-application of the 1.10 factor on the echo would land 126.
    expect(echoHeals).not.toEqual([Math.round(thirdPrimary * 0.4 * 1.1)]);
  });
});

describe('Groveheart Overbloom harvest copies the already-scaled stored HoT exactly once', () => {
  it('harvests 60% of the stored (already Groveheart-scaled) remaining HoT healing, not a second 1.05 factor', () => {
    const sim = new Sim({ seed: 4601, playerClass: 'druid', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('restoration')).toBe(true);
    const p = sim.player;
    p.spellPower = 70;
    p.healPower = 70;
    p.resource = p.maxResource;

    const ctx = ctxOf(sim);
    // A real self-cast Rejuvenation plants the HoT through the generic
    // effect_dispatch.ts 'hot' case (coordinator-owned, not mine), so its
    // stored tick value already carries the Groveheart 1.05 factor once.
    // ctx.applyAura's existing recalcPlayerStats-on-player-target behavior
    // fires here; poke the stat pair again AFTER, before reading it or
    // harvesting, same gotcha as the replant test above.
    sim.targetEntity(p.id);
    sim.castAbility('rejuvenation');
    p.spellPower = 70;
    p.healPower = 70;
    const hot = p.auras.find((aura) => aura.id === 'rejuvenation' && aura.kind === 'hot');
    if (!hot) throw new Error('no rejuvenation planted');
    expect(hot.duration).toBe(12);
    expect(hot.tickInterval).toBe(3);
    const hotValue = hot.value;
    expect(hotValue).toBeGreaterThan(0);

    // Deep deficit so the harvest heal on the caster itself does not clamp.
    p.maxHp = 1_000_000;
    p.hp = 1;

    // harvestPct 0.6 matches the real Overbloom ability's authored value.
    resolveDruidOverbloom(ctx, p, p, 0.6);

    const harvestHeals = sim.events.flatMap((event) =>
      event.type === 'heal2' && event.targetId === p.id && event.ability === 'Overbloom'
        ? [event.amount]
        : [],
    );
    expect(harvestHeals).toHaveLength(1);
    // remainingTicks() reads 4 immediately after a fresh 12s-duration/3s-interval
    // cast (1 + floor((12-3)/3)); apexMult is 1 (no Wild Apex row selected).
    const expectedHarvest = Math.round(hotValue * 4 * 0.6);
    expect(harvestHeals).toEqual([expectedHarvest]);
    // Decisive: a re-application of the Groveheart factor on the harvest
    // (whatever it is currently tuned to) would be this larger amount
    // instead. Read the live constant rather than a hardcoded literal so
    // this stays a real regression check across future retuning.
    const wrongDoubled = Math.round(
      hotValue * 4 * 0.6 * primaryHealingMultiplier('druid', 'restoration'),
    );
    expect(harvestHeals).not.toEqual([wrongDoubled]);
  });
});
