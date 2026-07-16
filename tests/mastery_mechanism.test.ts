// Mastery-application mechanism fixes from the codex pass over #1543:
//  - a global damage mult must not corrupt a utility rate/multiplier buff (F1)
//  - Demonology's redirected pet damage must not re-apply the source's output mods (F7)
// Plus the second-pass follow-ups (codex review of the fixes themselves):
//  - a flat DAMAGE-magnitude buff (thorns) must still scale, only rates are exempt
//  - a buff-strengthening talent must ride buffPct, not the (now buff-exempt) dmgPct
// Plus Gloamveil Form: a +15% Shadow-school damage amplifier (not flat spell power),
//  and healing ends the form.
import { describe, expect, it } from 'vitest';
import { spellDamageMultFromAuras } from '../src/sim/combat/spell_combat';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob, recalcPlayerStats } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity, PlayerClass } from '../src/sim/types';

describe('mastery does not corrupt utility rate buffs (F1)', () => {
  it("an Elemental shaman's spell-damage mastery leaves Ghost Wolf's 1.4x speed intact", () => {
    const sim = new Sim({ seed: 1, playerClass: 'shaman', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('elemental')).toBe(true); // mastery = +15% spell damage
    // Ghost Wolf is a nature-school selfBuff whose value (1.4) is a movement-speed
    // MULTIPLIER, not a magnitude. The old `value < 1` guard scaled it by the spell
    // mastery mult and rounded 1.4 -> 2; it must now pass through untouched.
    const gw = sim.resolvedAbility('ghost_wolf', sim.playerId);
    const buff = gw?.effects.find((e) => e.type === 'selfBuff');
    expect(buff && 'value' in buff ? buff.value : null).toBe(1.4);
  });

  it('a flat DAMAGE buff (Retribution Aura thorns) still scales with the ret mastery', () => {
    // thorns is flat reflect DAMAGE, so a damage-power mastery must still scale it (it is
    // in SCALABLE_BUFF_KINDS). The rate-buff fix must not have swept it up as a rate.
    const base = abilitiesKnownAt('paladin', 20, undefined).find(
      (a) => a.def.id === 'retribution_aura',
    );
    const baseThorns = base?.effects.find((e) => e.type === 'selfBuff' && e.kind === 'thorns');
    expect(baseThorns && 'value' in baseThorns ? baseThorns.value : null).toBe(5);

    const retMods = computeTalentModifiers(
      'paladin',
      { spec: 'retribution', ranks: {}, choices: {} },
      20,
    );
    const ret = abilitiesKnownAt('paladin', 20, retMods).find(
      (a) => a.def.id === 'retribution_aura',
    );
    const retThorns = ret?.effects.find((e) => e.type === 'selfBuff' && e.kind === 'thorns');
    // 5 * 1.2 (ret meleeDmgPct 0.2) = 6, not 5 (the pre-fix regression left it at 5).
    expect(retThorns && 'value' in retThorns ? retThorns.value : null).toBe(6);
  });

  it('Improved Wildward strengthens its stat buff via buffPct, not the buff-exempt dmgPct', () => {
    // The talent buffs a percent stat buff; with damage mods no longer scaling percent
    // buffs, it must ride buffPct. 2 ranks (buffPct 0.4) scale the +5% buff to +7%.
    const mods = computeTalentModifiers(
      'druid',
      { spec: null, ranks: { dru_imp_mark: 2 }, choices: {} },
      20,
    );
    const motw = abilitiesKnownAt('druid', 20, mods).find((a) => a.def.id === 'mark_of_the_wild');
    const buff = motw?.effects.find((e) => e.type === 'buffTarget' && e.kind === 'buff_stats_pct');
    expect(buff && 'value' in buff ? buff.value : null).toBe(7);
  });
});

describe('Gloamveil Form amplifies Shadow damage by 15%', () => {
  // Build a priest and a hostile dummy; return the damage a raw dealDamage of the given
  // school does, optionally while the priest is in Gloamveil Form (form_shadow, value 15).
  const hit = (school: string, inForm: boolean): number => {
    const sim = new Sim({ seed: 1, playerClass: 'priest', autoEquip: true });
    sim.setPlayerLevel(20);
    const p = sim.entities.get(sim.playerId) as Entity;
    if (inForm) {
      p.auras.push({
        kind: 'form_shadow',
        name: 'Gloamveil Form',
        value: 15,
        remaining: 3600,
        duration: 3600,
        sourceId: p.id,
        school: 'shadow',
      } as Aura);
    }
    const dummy = createMob(
      (sim as unknown as { nextId: number }).nextId++,
      MOBS.ridge_stalker,
      20,
      {
        x: p.pos.x,
        y: p.pos.y,
        z: p.pos.z + 3,
      },
    );
    dummy.maxHp = dummy.hp = 5_000_000;
    dummy.hostile = true;
    (sim as unknown as { addEntity(e: Entity): void }).addEntity(dummy);
    (sim as unknown as { dealDamage: Sim['dealDamage'] }).dealDamage(
      p,
      dummy,
      1000,
      false,
      school,
      'test',
      'hit',
    );
    return dummy.maxHp - dummy.hp;
  };

  it('a shadow hit deals 15% more in the form; a holy hit is unaffected', () => {
    // 1000 shadow -> 1150 in form (round(1000 * 1.15)); holy is not a shadow school.
    expect(hit('shadow', false)).toBe(1000);
    expect(hit('shadow', true)).toBe(1150);
    expect(hit('holy', false)).toBe(1000);
    expect(hit('holy', true)).toBe(1000);
  });

  it('amplifies periodic Shadow damage too (a Shadow Word: Pain DoT tick is +15%)', () => {
    // Every shadow damage path funnels through dealDamage, so the DoT ticks benefit like
    // direct hits. Same seed, only the form differs.
    const dotDamage = (inForm: boolean): number => {
      const sim = new Sim({ seed: 3, playerClass: 'priest', autoEquip: true });
      sim.setPlayerLevel(20);
      const p = sim.entities.get(sim.playerId) as Entity;
      p.facing = 0;
      p.resource = p.maxResource;
      if (inForm) {
        p.auras.push({
          kind: 'form_shadow',
          name: 'Gloamveil Form',
          value: 15,
          remaining: 3600,
          duration: 3600,
          sourceId: p.id,
          school: 'shadow',
        } as Aura);
      }
      const dummy = createMob(
        (sim as unknown as { nextId: number }).nextId++,
        MOBS.ridge_stalker,
        20,
        {
          x: p.pos.x,
          y: p.pos.y,
          z: p.pos.z + 3,
        },
      );
      dummy.maxHp = dummy.hp = 5_000_000;
      dummy.hostile = true;
      (sim as unknown as { addEntity(e: Entity): void }).addEntity(dummy);
      sim.targetEntity(dummy.id, sim.playerId);
      sim.castAbility('shadow_word_pain', sim.playerId);
      for (let i = 0; i < 120; i++) sim.tick();
      return dummy.maxHp - dummy.hp;
    };
    const plain = dotDamage(false);
    const inForm = dotDamage(true);
    expect(plain).toBeGreaterThan(0);
    expect(inForm).toBe(Math.round(plain * 1.15));
  });

  it('casting a heal ends Gloamveil Form (so the amplifier stops)', () => {
    // The form forbids healing: any heal/hot/aoeHeal drops form_shadow. This is enforced
    // in effect_dispatch; pin it so the "healing takes you out of the form" rule holds.
    const sim = new Sim({ seed: 2, playerClass: 'priest', autoEquip: true });
    sim.setPlayerLevel(20);
    const p = sim.entities.get(sim.playerId) as Entity;
    p.facing = 0;
    p.resource = p.maxResource;
    p.auras.push({
      kind: 'form_shadow',
      name: 'Gloamveil Form',
      value: 15,
      remaining: 3600,
      duration: 3600,
      sourceId: p.id,
      school: 'shadow',
    } as Aura);
    // Cast a heal (Lesser Heal, a ~2 s cast). When it resolves, the form must drop.
    sim.castAbility('lesser_heal', sim.playerId);
    for (let i = 0; i < 60 && p.auras.some((a) => a.kind === 'form_shadow'); i++) sim.tick();
    expect(p.auras.some((a) => a.kind === 'form_shadow')).toBe(false);
  });
});

describe('Balance druid permanent spell-damage stack matches the priest template', () => {
  // Balance is the caster analogue of Shadow priest: a permanent form plus a caster
  // mastery. It was overtuned because BOTH ran at full strength (form +20%, mastery
  // +15%) where the priest was deliberately discounted (form +15%, mastery +10%). These
  // pin the two levers at the priest-template values so the permanent stack (form x
  // mastery) lands near the sibling spec instead of well above it.
  it('Moonkin Form amplifies spell damage by 15% (not 20%)', () => {
    // The form bonus is carried on the form aura itself and read by every spell hit via
    // spellDamageMultFromAuras, so this one function is the whole form-damage lever.
    const p = { auras: [] as Aura[] } as unknown as Entity;
    expect(spellDamageMultFromAuras(p)).toBe(1);
    p.auras.push({
      kind: 'form_moonkin',
      name: 'Moonwing Form',
      value: 0,
      remaining: 3600,
      duration: 3600,
      sourceId: 0,
    } as Aura);
    expect(spellDamageMultFromAuras(p)).toBe(1.15);
  });

  it('the Moonrage mastery grants +10% spell damage (not +15%)', () => {
    // The spec mastery folds into the flat global mods at allocation time. With no talent
    // points spent, the balance mastery is the only contributor to global spell damage.
    const mods = computeTalentModifiers('druid', { spec: 'balance', ranks: {}, choices: {} }, 20);
    expect(mods.global.spellDmgPct ?? 0).toBe(0.1);
    // Haste is unchanged by this pass.
    expect(mods.global.spellHastePct ?? 0).toBe(0.1);
  });

  it('the two levers COMPOSE on one cast: specced-in-form vs specless is ~1.265x, not 1.38x', () => {
    // End-to-end stack proof through the real cast pipeline: a Lunar Tempest (instant, so
    // the mastery's haste cannot shift the cast tick) from a balance druid in Moonkin Form
    // vs the identical specless druid on the SAME seed. The mastery (+10%) scales the
    // resolved effect min/max at cast; the form (+15%) multiplies per hit in
    // effect_dispatch, so the composed hit is 1.10 x 1.15 = ~1.265x the baseline, where
    // the pre-fix pair (form 1.20 x mastery 1.15) landed at ~1.38x.
    //
    // Determinism: neither setSpec nor the pushed auras draw rng and no tick runs before
    // the cast, so both sims' rng streams stay draw-for-draw aligned through the bolt's
    // landing tick and the base damage rolls share the same uniform draw. Rank-3 Lunar
    // Tempest rolls range(28, 34); the mastery-resolved copy rolls range(31, 37) (same
    // width 6), so the specced roll is EXACTLY the specless roll + 3 before the form's
    // 1.15x.
    const drive = (specced: boolean): number => {
      const sim = new Sim({ seed: 7, playerClass: 'druid', autoEquip: false });
      sim.setPlayerLevel(20);
      if (specced) expect(sim.setSpec('balance')).toBe(true);
      const p = sim.entities.get(sim.playerId) as Entity;
      p.facing = 0;
      p.maxHp = p.hp = 5_000_000;
      p.resource = p.maxResource;
      // Cancel the int-derived Spell Power rider (it is mastery-exempt, so it would
      // dilute the headline ratio) and force crits off; BOTH druids get both auras.
      p.auras.push({
        kind: 'buff_spellpower',
        name: 'test-no-sp',
        value: -100000,
        remaining: 60,
        duration: 60,
        sourceId: p.id,
        school: 'arcane',
      } as Aura);
      p.auras.push({
        kind: 'buff_spellcrit',
        name: 'test-no-crit',
        value: -5,
        remaining: 60,
        duration: 60,
        sourceId: p.id,
        school: 'arcane',
      } as Aura);
      if (specced) {
        // The form toggle is rng-free; push the aura directly (the signature test above
        // covers the castAbility path) so the two rng streams stay aligned.
        p.auras.push({
          kind: 'form_moonkin',
          name: 'Moonwing Form',
          value: 0,
          remaining: 3600,
          duration: 3600,
          sourceId: p.id,
        } as Aura);
      }
      // Fold the pushed auras into the derived stats now (recalc floors Spell Power at
      // 0), the same recalc the sim runs when an aura is gained through a cast.
      const meta = (sim as unknown as { players: Map<number, { cls: PlayerClass }> }).players.get(
        sim.playerId,
      ) as {
        cls: PlayerClass;
        equipment: Record<string, string>;
        equipmentInstance: Record<string, unknown>;
      };
      recalcPlayerStats(
        p,
        meta.cls,
        meta.equipment as never,
        (sim as unknown as { playerMods(m: unknown): undefined }).playerMods(meta),
        meta.equipmentInstance as never,
      );
      expect(p.spellPower).toBe(0);
      const dummy = createMob(
        (sim as unknown as { nextId: number }).nextId++,
        MOBS.ridge_stalker,
        20,
        { x: p.pos.x, y: p.pos.y, z: p.pos.z + 3 },
      );
      dummy.maxHp = dummy.hp = 5_000_000;
      dummy.hostile = true;
      (sim as unknown as { addEntity(e: Entity): void }).addEntity(dummy);
      sim.targetEntity(dummy.id, sim.playerId);
      sim.castAbility('moonfire', sim.playerId);
      // 1 s: enough for the bolt to land (3 yd at 26 yd/s), short enough that the rider
      // DoT (first tick 3 s after application) contributes nothing; only the direct hit
      // is measured.
      for (let i = 0; i < 20; i++) sim.tick();
      return dummy.maxHp - dummy.hp;
    };
    const plain = drive(false);
    const stacked = drive(true);
    // Specless: round(roll), roll in [28, 34] (rider and crit are cancelled).
    expect(plain).toBeGreaterThanOrEqual(28);
    expect(plain).toBeLessThanOrEqual(34);
    // The composed prediction, exact up to two roundings: specced roll = specless roll
    // + 3, then the form's 1.15x per-hit multiplier. round() slop on plain (0.5 * 1.15)
    // plus on stacked (0.5) bounds the error at 1.075.
    expect(Math.abs(stacked - (plain + 3) * 1.15)).toBeLessThanOrEqual(1.1);
    // And the headline ratio: ~1.265 (1.10 mastery x 1.15 form), decisively below the
    // pre-fix ~1.38 and above either lever alone.
    const ratio = stacked / plain;
    expect(ratio).toBeGreaterThan(1.2);
    expect(ratio).toBeLessThan(1.31);
  });
});

describe('channeled spell crits take the spell crit-damage mastery', () => {
  it("a Fire mage's Aether Darts channel crits harder than a specless mage's (same rolls)", () => {
    // Drive the channeled directDamage tick path (casting_lifecycle) with a guaranteed
    // crit. Two identical mages on the same seed: only the Fire spec's +50% spell crit
    // damage differs, so its total channel damage must exceed the specless baseline.
    const drive = (spec: 'fire' | null): number => {
      const sim = new Sim({ seed: 9, playerClass: 'mage', autoEquip: true });
      sim.setPlayerLevel(20);
      if (spec) expect(sim.setSpec(spec)).toBe(true);
      const p = sim.entities.get(sim.playerId) as Entity;
      p.facing = 0;
      p.maxHp = p.hp = 5_000_000; // survive the dummy's melee during the channel
      p.castPushbackReduction = 1; // pushback-immune so the channel runs all 3 ticks
      p.resource = p.maxResource;
      // Force every tick to crit via an aura (survives the recalc-on-cast that would
      // reset a raw stat override). spellCrit reads this bonus live, so >1 = always crit.
      p.auras.push({
        kind: 'buff_spellcrit',
        name: 'test-forced-crit',
        value: 5,
        remaining: 60,
        duration: 60,
        sourceId: p.id,
        school: 'arcane',
      } as Aura);
      const dummy = createMob(
        (sim as unknown as { nextId: number }).nextId++,
        MOBS.ridge_stalker,
        20,
        {
          x: p.pos.x,
          y: p.pos.y,
          z: p.pos.z + 3, // close, so caster-to-target line of sight is clear on any seed
        },
      );
      dummy.maxHp = dummy.hp = 5_000_000;
      dummy.hostile = true;
      (sim as unknown as { addEntity(e: Entity): void }).addEntity(dummy);
      sim.targetEntity(dummy.id, sim.playerId);
      sim.castAbility('arcane_missiles', sim.playerId);
      // The channel is 3 ticks over 3 s (about 60 sim ticks); drive well past it.
      for (let i = 0; i < 20 * 5; i++) sim.tick();
      return dummy.maxHp - dummy.hp;
    };
    const fire = drive('fire');
    const plain = drive(null);
    expect(fire).toBeGreaterThan(0);
    expect(plain).toBeGreaterThan(0);
    // Fire crits at 1.5 + 0.5 = 2.0x, specless at 1.5x, over the same rolls.
    expect(fire).toBeGreaterThan(plain);
  });
});

describe('crit-damage masteries are scoped to their channel (F4)', () => {
  it("a Holy paladin's heal-crit mastery does not leak into damage crits", () => {
    const sim = new Sim({ seed: 3, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('holy')).toBe(true);
    const p = sim.entities.get(sim.playerId) as Entity;
    // Holy mastery boosts HEAL crits only; the spell and physical crit channels stay 0,
    // so the paladin's Holy Shock / Crusader Strike crits are not amplified.
    expect(p.critDmgHealBonus).toBeCloseTo(0.5);
    expect(p.critDmgSpellBonus).toBe(0);
    expect(p.critDmgPhysBonus).toBe(0);
  });
});

describe('Demonology damage redirect is not double-modified (F7)', () => {
  it("a source's Defensive Stance cut is applied once, not again on the pet's share", () => {
    const sim = new Sim({ seed: 1, playerClass: 'warlock', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('demonology')).toBe(true); // mastery = 20% damage redirected to pet
    const wl = sim.entities.get(sim.playerId) as Entity;
    wl.maxHp = wl.hp = 1_000_000;
    wl.resource = wl.maxResource;
    // Bring up the demon: the summon is a multi-second cast, so tick past it.
    sim.castAbility('summon_voidwalker', sim.playerId);
    for (let i = 0; i < 20 * 12 && sim.player.castingAbility; i++) sim.tick();
    const pet = sim.petOf(sim.playerId) as Entity;
    expect(pet).toBeTruthy();
    pet.maxHp = pet.hp = 1_000_000;

    // A source in Defensive Stance (deals 10% less). createMob is hostile.
    const source = createMob(
      (sim as unknown as { nextId: number }).nextId++,
      MOBS.ridge_stalker,
      20,
      {
        x: wl.pos.x,
        y: wl.pos.y,
        z: wl.pos.z + 3,
      },
    );
    source.auras.push({ kind: 'defensive_stance', value: 0, remaining: 60, duration: 60 } as Aura);
    (sim as unknown as { addEntity(e: Entity): void }).addEntity(source);

    const wl0 = wl.hp;
    const pet0 = pet.hp;
    // 100 raw -> source Defensive Stance x0.9 -> 90 to the warlock, of which 20% (18)
    // is redirected to the pet. The pet's 18 must NOT be cut by Defensive Stance again.
    (sim as any).dealDamage(source, wl, 100, false, 'physical', null, 'hit');
    expect(pet0 - pet.hp).toBe(18); // not 16 (would be 18 * 0.9 double-cut)
    expect(wl0 - wl.hp).toBe(72); // 90 - 18
  });
});

describe('caster mastery outliers trimmed to sibling parity', () => {
  it('Shadow Vespers is a single DoT lever (no spellDmgPct triple-stack with form)', () => {
    // Gloamveil Form already amplifies ALL shadow damage +15% (school-scoped, damage.ts),
    // so a mastery spellDmgPct compounded into form x spellDmg x dotDmg = ~1.45 on DoTs, an
    // outlier matching the pre-fix balance druid. The mastery now carries only dotDmgPct, so
    // the form is the general shadow multiplier and the mastery is the DoT specialization.
    const mods = computeTalentModifiers('priest', { spec: 'shadow', ranks: {}, choices: {} }, 20);
    expect(mods.global.dotDmgPct ?? 0).toBe(0.15);
    expect(mods.global.spellDmgPct ?? 0).toBe(0);
  });

  it('Frost Cryomancy mastery gives +15% on frostbolt (caster parity), not +25%', () => {
    // Every other caster mastery is +15% on its primary; frost was +25% on frostbolt, the only
    // permanent single-nuke outlier. Ability-scoping is kept (off-school mage spells untouched),
    // only the magnitude drops to match arcane/elemental's 0.15.
    const base = abilitiesKnownAt('mage', 20, undefined).find((a) => a.def.id === 'frostbolt');
    const baseDd = base?.effects.find((e) => e.type === 'directDamage');
    const mods = computeTalentModifiers('mage', { spec: 'frost', ranks: {}, choices: {} }, 20);
    const frost = abilitiesKnownAt('mage', 20, mods).find((a) => a.def.id === 'frostbolt');
    const frostDd = frost?.effects.find((e) => e.type === 'directDamage');
    const baseMin = baseDd && 'min' in baseDd ? baseDd.min : 0;
    const frostMin = frostDd && 'min' in frostDd ? frostDd.min : 0;
    expect(baseMin).toBeGreaterThan(0);
    expect(frostMin / baseMin).toBeCloseTo(1.15, 2); // not 1.25
  });
});
