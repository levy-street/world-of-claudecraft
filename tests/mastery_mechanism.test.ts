// Mastery-application mechanism fixes from the codex pass over #1543:
//  - a global damage mult must not corrupt a utility rate/multiplier buff (F1)
//  - Demonology's redirected pet damage must not re-apply the source's output mods (F7)
// Plus the second-pass follow-ups (codex review of the fixes themselves):
//  - a flat DAMAGE-magnitude buff (thorns) must still scale, only rates are exempt
//  - a buff-strengthening talent must ride buffPct, not the (now buff-exempt) dmgPct
import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob, recalcPlayerStats } from '../src/sim/entity';
import type { ResolvedAbility } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { abilityScalingPower } from '../src/sim/spell_scaling';
import type { AbilityDef, Aura, Entity } from '../src/sim/types';
import { abilityDamageBonus } from '../src/ui/ability_damage';

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

describe('Gloamveil Form spell power is Shadow-school only (F6)', () => {
  it('adds its +15 to shadow spells only, not to the generic spell power or other schools', () => {
    const sim = new Sim({ seed: 1, playerClass: 'priest', autoEquip: true });
    sim.setPlayerLevel(20);
    const p = sim.entities.get(sim.playerId) as Entity;
    const meta = (sim as unknown as { players: Map<number, unknown> }).players.get(sim.playerId);
    const mods = (sim as unknown as { playerMods(m: unknown): unknown }).playerMods(meta);
    const eq = (meta as { equipment: unknown }).equipment;
    const eqi = (meta as { equipmentInstance: unknown }).equipmentInstance;

    const spBefore = p.spellPower;
    // Enter Gloamveil Form (form_shadow, value 15) and re-derive stats.
    p.auras.push({
      kind: 'form_shadow',
      name: 'Gloamveil Form',
      value: 15,
      remaining: 3600,
      duration: 3600,
      sourceId: p.id,
      school: 'shadow',
    } as Aura);
    recalcPlayerStats(p, 'priest', eq as never, mods as never, eqi as never);

    // The +15 lives in the shadow-only channel, NOT the generic spell power.
    expect(p.shadowSpellPowerBonus).toBe(15);
    expect(p.spellPower).toBe(spBefore);

    const shadowSpell = { school: 'shadow' } as AbilityDef;
    const holySpell = { school: 'holy' } as AbilityDef;
    expect(abilityScalingPower(p, shadowSpell)).toBe(p.spellPower + 15);
    expect(abilityScalingPower(p, holySpell)).toBe(p.spellPower);
  });

  it('the tooltip damage estimate carries the shadow bonus (AbilityScaling wiring)', () => {
    // The HUD derives shadowSpellPowerBonus from the synced form aura and passes it in
    // AbilityScaling, so the shadow-spell tooltip estimate reflects Gloamveil on both
    // hosts. A shadow direct nuke's estimated bonus must rise with the shadow SP.
    const res = {
      def: { school: 'shadow' },
      castTime: 1.5,
      effects: [{ type: 'directDamage', min: 50, max: 50 }],
    } as unknown as ResolvedAbility;
    const eff = res.effects[0];
    const base = { spellPower: 200, rangedPower: 0, attackPower: 0 };
    const withBonus = { ...base, shadowSpellPowerBonus: 15 };
    expect(abilityDamageBonus(res, eff, withBonus)).toBeGreaterThan(
      abilityDamageBonus(res, eff, base),
    );
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
