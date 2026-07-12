import { beforeAll, describe, expect, it } from 'vitest';
import { onCastCompleted, onMeleeSwing } from '../src/sim/combat/talent_procs';
import type { ChoiceRowOption } from '../src/sim/content/choice_rows';
import { CHOICE_ROWS } from '../src/sim/content/choice_rows';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity, PlayerClass } from '../src/sim/types';
import { DT } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { tEntity } from '../src/ui/entity_i18n';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import { tTalent } from '../src/ui/talent_i18n';

const LEGACY_OR_FILLER_TITLES = new Set([
  'Adrenaline Junkie',
  'Aspect Mastery',
  'Battlemage Armor',
  'Blessed Recovery',
  'Cheat Death',
  'Colossus',
  'Crippling Blows',
  'Crippling Strikes',
  "Crusader's Zeal",
  'Curse Mastery',
  'Deadly Brew',
  'Demon Armor',
  'Divine Wisdom',
  'Elemental Attunement',
  'Elemental Warding',
  'Empowered Touch',
  'Endurance',
  'Executioner',
  'Firestarter',
  'Fist of Justice',
  'Greater Blessing',
  'Greater Heal',
  'Ice Nova',
  'Imbue Mastery',
  'Inner Fire',
  'Mana Attunement',
  'Master Assassin',
  'Master Tamer',
  'Mind Melt',
  "Nature's Bounty",
  'Netherwind',
  'Opportunist',
  'Pain and Suffering',
  'Quick Shots',
  'Rapid Killing',
  'Savage Fury',
  "Serpent's Venom",
  'Sniper Training',
  'Survival of the Fittest',
  'Tidal Waves',
  'War Drums',
]);

function changesPlayPattern(choice: ChoiceRowOption): boolean {
  if (choice.effect.grant || choice.effect.proc || choice.effect.global) return true;
  return (choice.effect.ability ?? []).some(
    (mod) =>
      (mod.bonusCharges ?? 0) > 0 ||
      mod.castWhileMoving === true ||
      (mod.addEffects?.length ?? 0) > 0 ||
      mod.dmgPctVsDotted !== undefined,
  );
}

function simWithRows(cls: PlayerClass, rows: Record<number, string>): Sim {
  const sim = new Sim({ seed: 41, playerClass: cls, autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec: null, rows })).toBe(true);
  return sim;
}

function addTarget(sim: Sim, id = 9900, distance = 3): Entity {
  const x = sim.player.pos.x;
  const z = sim.player.pos.z + distance;
  const target = createMob(id, MOBS.forest_wolf, 20, {
    x,
    y: groundHeight(x, z, sim.cfg.seed),
    z,
  });
  target.hostile = true;
  target.moveSpeed = 0;
  target.maxHp = target.hp = 100_000;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(target);
  sim.targetEntity(target.id);
  return target;
}

function settle(sim: Sim, seconds = 2): void {
  for (let i = 0; i < Math.ceil(seconds / DT); i++) sim.tick();
}

describe('all-class choice-row proper pass', () => {
  beforeAll(async () => {
    await ensureLocaleLoaded('en');
    setLanguage('en');
  });

  it('removes Improved filler and the legacy titles replaced by this pass', () => {
    const bad: string[] = [];
    for (const [cls, rows] of Object.entries(CHOICE_ROWS)) {
      for (const row of rows.rows) {
        for (const choice of row.options) {
          if (/^Improved\b/.test(choice.name) || LEGACY_OR_FILLER_TITLES.has(choice.name)) {
            bad.push(`${cls}:${row.level}:${choice.name}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('gives every row at least two behavior-changing options', () => {
    const weak = Object.entries(CHOICE_ROWS)
      .flatMap(([cls, rows]) =>
        rows.rows.map((row) => ({
          id: `${cls}:${row.level}`,
          count: row.options.filter(changesPlayPattern).length,
        })),
      )
      .filter((row) => row.count < 2);
    expect(weak).toEqual([]);
  });

  it('keeps replaced legacy spell names out of authored choice copy', () => {
    const stale = /\b(?:Smite|Volley|Hurricane|Claw|Rip|Colossus|War Drums|Gag Order)\b/;
    const bad = Object.entries(CHOICE_ROWS).flatMap(([cls, rows]) =>
      rows.rows.flatMap((row) =>
        row.options
          .filter((choice) => stale.test(choice.description))
          .map((choice) => `${cls}:${row.level}:${choice.description}`),
      ),
    );
    expect(bad).toEqual([]);
  });

  it('does not revive discarded spell names through locale overrides', async () => {
    const renamed = {
      aura_surge: 'Dawnward Ricochet',
      smite: 'Scouring Hymn',
      volley: 'Arrowfall',
      hurricane: 'Galeheart',
      claw: 'Rendclaw',
      rip: 'Bloodrift',
      holy_nova: 'Sunburst Canticle',
      aspect_of_the_wild: 'Wildfang Rally',
      avatar: 'Siegeborn',
      bloodlust: 'Storm Chorus',
      chain_lightning: 'Skybranch',
      death_coil: 'Morrowlash',
      howl_of_terror: 'Dread Chorus',
      psychic_scream: 'Terror Canticle',
      silence: 'Hushword',
      spell_lock: 'Tonguebind',
    } as const;

    await ensureLocaleLoaded('es');
    setLanguage('es');
    for (const [id, name] of Object.entries(renamed)) {
      expect(tEntity({ kind: 'ability', id, field: 'name' })).toBe(name);
    }

    const nativeChecks = [
      ['zh_CN', 'aura_surge', '黎明圣盾弹射'],
      ['zh_CN', 'smite', '涤罪圣咏'],
      ['zh_TW', 'silence', '緘言'],
      ['ja_JP', 'holy_nova', '陽光炸裂の聖歌'],
      ['ko_KR', 'bloodlust', '폭풍의 합창'],
      ['ru_RU', 'spell_lock', 'Оковы языка'],
    ] as const;
    for (const [lang, id, name] of nativeChecks) {
      await ensureLocaleLoaded(lang);
      setLanguage(lang);
      expect(tEntity({ kind: 'ability', id, field: 'name' })).toBe(name);
    }
    setLanguage('en');
  });

  it('renders granted spells as their real behavior, not a redundant Grants line', () => {
    const bad: string[] = [];
    for (const [cls, rows] of Object.entries(CHOICE_ROWS)) {
      for (const row of rows.rows) {
        for (const choice of row.options) {
          if (!choice.effect.grant) continue;
          const rendered = tTalent({ kind: 'talentChoice', choice, field: 'description' });
          if (/\bGrants\b/.test(rendered) || /\((?:\w+ )?(?:talent|signature)\)/i.test(rendered)) {
            bad.push(`${cls}:${row.level}:${choice.id}:${rendered}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('warrior Grave Omen makes one full-health Early Grave free and legal', () => {
    const sim = simWithRows('warrior', { 17: 'war_r17_red_harvest' });
    const target = addTarget(sim);
    for (let i = 0; i < 3; i++) {
      sim.player.resource = sim.player.maxResource;
      sim.castAbility('hamstring');
      settle(sim);
    }
    expect(sim.player.auras.some((a) => a.kind === 'next_execute_free')).toBe(true);
    sim.player.resource = 0;
    sim.castAbility('execute');
    expect(target.hp).toBeLessThan(target.maxHp);
    expect(sim.player.auras.some((a) => a.kind === 'next_execute_free')).toBe(false);
  });

  it('paladin control choices bank a second gavel or root Holy Ground', () => {
    const charges = simWithRows('paladin', { 8: 'pal_r8_fist_of_justice' });
    expect(charges.resolvedAbility('hammer_of_justice')?.bonusCharges).toBe(1);

    const snare = simWithRows('paladin', { 8: 'pal_r8_consecrated_ground' });
    const target = addTarget(snare, 9901);
    snare.player.resource = snare.player.maxResource;
    snare.castAbility('consecration');
    expect(target.auras.some((a) => a.kind === 'root')).toBe(true);
  });

  it('hunter Splitshot lands at the chosen area and Twin Fletching stores two uses', () => {
    const sim = simWithRows('hunter', {
      5: 'hun_r5_quick_shots',
      14: 'hun_r14_multi_shot',
    });
    expect(sim.resolvedAbility('arcane_shot')?.bonusCharges).toBe(1);
    const distant = addTarget(sim, 9902, 20);
    const nearCaster = addTarget(sim, 9903, 3);
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('multi_shot', undefined, { x: distant.pos.x, z: distant.pos.z });
    expect(distant.hp).toBeLessThan(distant.maxHp);
    expect(nearCaster.hp).toBe(nearCaster.maxHp);
  });

  it('rogue Ceaseless Cuts restores energy on every third Wicked Slash', () => {
    const sim = simWithRows('rogue', { 5: 'rog_r5_relentless_strikes' });
    const target = addTarget(sim, 9904);
    sim.player.resource = 0;
    for (let i = 0; i < 3; i++) onCastCompleted(sim.ctx, sim.player, 'sinister_strike', target);
    expect(target.dead).toBe(false);
    expect(sim.player.resource).toBe(30);
  });

  it('priest Twin Fracture and mage Twin Embers each add a stored use', () => {
    const priest = simWithRows('priest', { 14: 'pri_r14_mind_melt' });
    const mage = simWithRows('mage', { 5: 'mag_r5_impulse' });
    expect(priest.resolvedAbility('mind_blast')?.bonusCharges).toBe(1);
    expect(mage.resolvedAbility('fire_blast')?.bonusCharges).toBe(1);
  });

  it('shaman Imbued Lifeblood heals only while an imbue is active', () => {
    const sim = simWithRows('shaman', { 5: 'sha_r5_imbue_mastery' });
    const rng = sim.ctx.rng as typeof sim.ctx.rng & { chance(probability: number): boolean };
    rng.chance = () => false;
    sim.player.hp = sim.player.maxHp - 20;
    onMeleeSwing(sim.ctx, sim.player);
    expect(sim.player.hp).toBe(sim.player.maxHp - 20);
    const imbue: Aura = {
      id: 'test_imbue',
      name: 'Test Imbue',
      kind: 'imbue',
      remaining: 10,
      duration: 10,
      value: 1,
      sourceId: sim.player.id,
      school: 'nature',
    };
    sim.player.auras.push(imbue);
    onMeleeSwing(sim.ctx, sim.player);
    expect(sim.player.hp).toBe(sim.player.maxHp - 12);
  });

  it('warlock Walking Hunger makes Consume mobile', () => {
    const sim = simWithRows('warlock', { 11: 'wlk_r11_fel_concentration' });
    expect(sim.resolvedAbility('drain_life')?.castWhileMoving).toBe(true);
  });

  it('druid Headbutt and Red Haze are usable while shifted', () => {
    const sim = simWithRows('druid', {
      8: 'dru_r8_skull_bash',
      20: 'dru_r20_berserk',
    });
    addTarget(sim, 9905);
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('cat_form');
    settle(sim);
    expect(sim.player.auras.some((a) => a.kind === 'form_cat')).toBe(true);
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('skull_bash');
    expect(sim.player.cooldowns.has('skull_bash')).toBe(true);
    settle(sim);
    sim.castAbility('berserk');
    expect(sim.player.auras.some((a) => a.id === 'berserk')).toBe(true);
  });
});
