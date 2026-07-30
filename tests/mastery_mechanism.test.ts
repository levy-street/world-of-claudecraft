// Mastery-application mechanism fixes from the codex pass over #1543:
//  - a global damage mult must not corrupt a utility rate/multiplier buff (F1)
//  - Demonology's redirected pet damage must not re-apply the source's output mods (F7)
// Plus the second-pass follow-ups (codex review of the fixes themselves):
//  - a flat DAMAGE-magnitude buff (thorns) must still scale, only rates are exempt
//  - a buff-strengthening talent must ride buffPct, not the (now buff-exempt) dmgPct
// Plus Gloamveil Form: a +15% Shadow-school damage amplifier (not flat spell power),
//  and healing ends the form.
import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob, recalcPlayerStats } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';

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

  it('Resolve Unbroken strengthens its stat buff via buffPct, not the buff-exempt dmgPct', () => {
    // The active Talents V2 row buffs a percent stat buff; with damage mods no longer
    // scaling percent buffs, it must ride buffPct. The row's 50% modifier scales the
    // +5% base buff to the authored +7.5%, without rounding the percentage to 8%.
    const mods = computeTalentModifiers(
      'priest',
      { spec: null, rows: { 17: 'pri_r17_improved_fortitude' } },
      20,
    );
    const fortitude = abilitiesKnownAt('priest', 20, mods).find(
      (a) => a.def.id === 'power_word_fortitude',
    );
    const buff = fortitude?.effects.find(
      (e) => e.type === 'buffTarget' && e.kind === 'buff_sta_pct',
    );
    expect(buff && 'value' in buff ? buff.value : null).toBe(7.5);
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

describe('channeled spell crits take the spell crit-damage mastery', () => {
  it('a spell crit-damage mastery makes the Aether Darts channel crit harder (same rolls)', () => {
    // Drive the channeled directDamage tick path (casting_lifecycle) with a guaranteed
    // crit. The mage rework gated Aether Darts to Chronomancy and swapped the fire
    // spec's Afterflame (+50% spell crit damage) mastery for Ignition, so no spec that
    // knows a channeled directDamage spell carries critDmgSpellPct anymore (Ruination
    // still does, but warlocks have no such channel). Pin the mechanism itself: two
    // identical Chronomancy mages on the same seed, one with the 0.5 critDmgSpellPct
    // (Afterflame's and Ruination's exact value) injected through the talent-mods slot
    // recalcPlayerStats bakes onto critDmgSpellBonus.
    const drive = (mastery: boolean): number => {
      const sim = new Sim({ seed: 9, playerClass: 'mage', autoEquip: true });
      sim.setPlayerLevel(20);
      expect(sim.setSpec('arcane')).toBe(true); // Aether Darts is Chronomancy-gated
      const p = sim.entities.get(sim.playerId) as Entity;
      if (mastery) {
        const meta = sim.players.get(sim.playerId);
        if (!meta) throw new Error('missing player meta');
        // Mutating the mods (not the raw entity field) means any mid-drive recalc
        // re-derives the same bonus instead of wiping it.
        meta.talentMods.global.critDmgSpellPct = 0.5;
        recalcPlayerStats(p, meta.cls, meta.equipment, meta.talentMods, meta.equipmentInstance);
      }
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
    const boosted = drive(true);
    const plain = drive(false);
    expect(boosted).toBeGreaterThan(0);
    expect(plain).toBeGreaterThan(0);
    // The mastery crits at 1.5 + 0.5 = 2.0x, the baseline at 1.5x, over the same rolls.
    expect(boosted).toBeGreaterThan(plain);
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

  it("a source's Battle Combat Mastery bonus is applied once before the pet share", () => {
    const sim = new Sim({ seed: 2, playerClass: 'warlock', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('demonology')).toBe(true);
    const wl = sim.player;
    wl.maxHp = wl.hp = 1_000_000;
    wl.resource = wl.maxResource;
    sim.castAbility('summon_voidwalker');
    for (let i = 0; i < 20 * 12 && wl.castingAbility; i++) sim.tick();
    const pet = sim.petOf(sim.playerId) as Entity;
    expect(pet).toBeTruthy();
    pet.maxHp = pet.hp = 1_000_000;

    const warriorId = sim.addPlayer('warrior', 'BattleRedirect');
    sim.setPlayerLevel(20, warriorId);
    expect(sim.setSpec('arms', warriorId)).toBe(true);
    expect(sim.selectTalentRow(14, 'war_row_blood_offering', warriorId)).toBe(true);
    sim.castAbility('battle_stance', warriorId);
    const warrior = sim.entities.get(warriorId) as Entity;

    const wl0 = wl.hp;
    const pet0 = pet.hp;
    // 100 * 1.15 Combat Mastery = 115, then Demonology redirects 20% (23).
    // The redirected share is already source-final and must not receive another 15%.
    sim.dealDamage(warrior, wl, 100, true, 'physical', 'Maiming Strike', 'hit');
    expect(wl0 - wl.hp).toBe(92);
    expect(pet0 - pet.hp).toBe(23);
    expect(wl0 - wl.hp + (pet0 - pet.hp)).toBe(115);
  });
});
