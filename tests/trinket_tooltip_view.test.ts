// The trinkets' item-tooltip lines (src/ui/trinket_tooltip_view.ts): every one
// of the eighteen trinkets renders a Use line with its exact resolved numbers
// and cooldown, the ones with a passive render an Equip line first, the
// power-scaled numbers move with the viewer's power exactly as combat does, and
// the fortune notice names each Gambler's Die roll. The combat proofs drive a
// real Sim (the same useItem path the action bar presses) and compare the
// applied aura against the text the tooltip prints for that same character.
import { afterEach, describe, expect, it } from 'vitest';
import {
  GAMBLE_FORTUNES,
  type GambleFortune,
  TRINKET_AURA,
  TRINKET_ITEMS,
  TRINKET_SPECS,
  trinketCooldownKey,
} from '../src/sim/content/trinkets';
import { ITEMS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { ensureLocaleLoaded, formatNumber, setLanguage } from '../src/ui/i18n';
import { localizeSimAuraName, localizeSimText, tSim } from '../src/ui/sim_i18n';
import {
  KEEN_EDGE_DAMAGE_BONUS,
  luckyStreakTotal,
  type TrinketTooltipViewer,
  trinketGambleText,
  trinketTooltipLines,
  trinketTooltipLineTexts,
} from '../src/ui/trinket_tooltip_view';

const VIEWER: TrinketTooltipViewer = {
  attackPower: 500,
  rangedPower: 0,
  spellPower: 300,
  healPower: 400,
  maxHp: 5000,
};

const n = (v: number) => formatNumber(v, { maximumFractionDigits: 0 });

// The whole English line set per trinket for VIEWER, written out literally so a
// change to a number, a clause or the cooldown fails here.
const EXPECTED: Record<string, { equip?: string; use: string }> = {
  bastion_sigil: {
    equip:
      'Equip: Taking damage while below 35% health grants a shield that absorbs 750 damage (15% of your maximum health) for 10 sec. Can occur once every 90 sec.',
    use: 'Use: For 8 sec, an enemy that hits you directly takes Physical damage equal to 30% of the health that hit took from you. Periodic damage does not trigger it. (2 min cooldown)',
  },
  mooring_stone: {
    use: 'Use: For 8 sec, take 20% less damage but move at 70% speed. Removes stuns, roots, slows, fears, polymorphs, silences, blinds, hexes, disarms and incapacitating effects on you, and you ignore new ones and knockbacks while it lasts. (3 min cooldown)',
  },
  menders_hourglass: {
    equip: `Equip: Overhealing from your direct heals is stored in the hourglass, up to ${n(1500)} (30% of your maximum health). Stored healing fades 60 sec after it last grew.`,
    use: 'Use: Turn all stored healing into a shield on the party member within 40 yd with the lowest health percentage, you included. The shield lasts 12 sec. Requires stored healing. (90 sec cooldown)',
  },
  wellspring_seed: {
    use: 'Use: Heal you and party members within 10 yd for 18 (+48) every 2 sec for 10 sec. Healing increases with Healing Power. (2 min cooldown)',
  },
  paired_talons: {
    equip:
      'Equip: Your auto-attack hits have a 6% chance to make an extra main-hand melee swing. Can occur once every 3 sec.',
    use: 'Use: For 10 sec, your auto-attack hits apply Talon Wound, which deals 4 (+15) Physical damage per stack every 2 sec for 6 sec and stacks up to 5 times. Damage increases with Attack Power. (2 min cooldown)',
  },
  hunters_tally: {
    equip:
      'Equip: Your auto-attack critical hits and your killing blows each add a tally mark, up to 10. Marks last 30 sec, refreshed whenever you gain one.',
    use: 'Use: Spend all tally marks to strike your target within 30 yd for 10 (+40) Physical damage per mark (500 at 10 marks). Damage increases with Attack Power. Requires a tally mark. (1 min cooldown)',
  },
  stormjar: {
    equip:
      'Equip: Each spell you cast adds a charge, up to 10. Charges last 30 sec, refreshed whenever you gain one.',
    use: 'Use: Release all charges as a bolt at your target within 30 yd that jumps to up to 3 more enemies within 12 yd. Each enemy takes 8 (+21) Nature damage per charge (290 at 10 charges). Damage increases with Spell Power. Requires a charge. (90 sec cooldown)',
  },
  echoing_lens: {
    use: 'Use: For 12 sec, your next 3 direct heals or direct non-Physical damage hits repeat for 30% of their amount. (2 min cooldown)',
  },
  gamblers_die: {
    use: `Use: Roll one of four fortunes for 15 sec: Keen Edge (deal 15% more damage), Lucky Streak (heal ${n(1500)} over the duration), Gilded Guard (a shield that absorbs ${n(1000)} damage), or Snake Eyes (no effect, but this cooldown is halved). (2 min cooldown)`,
  },
  sundered_prism: {
    use: 'Use: Step 12 yd forward, then take 30% less damage for 3 sec. (90 sec cooldown)',
  },
  wayfarers_lodestone: {
    use: 'Use: Increase your movement speed by 60% for 8 sec. Does not stack with other speed increases. (2 min cooldown)',
  },
  medallion_of_defiance: {
    use: 'Use: Remove all stuns, roots, slows, fears, polymorphs, silences, blinds, hexes, disarms and incapacitating effects on you. Usable while stunned. (2 min cooldown)',
  },
  duelists_brand: {
    use: 'Use: Brand an enemy player within 30 yd, reducing the healing they receive by 50% for 8 sec. (1 min cooldown)',
  },
  forgefathers_temper: {
    equip:
      'Equip: Your melee and ranged weapon hits each add a heat stack, up to 5. Heat lasts 20 sec, refreshed whenever you gain a stack.',
    use: 'Use: Spend all heat stacks to temper your weapon for 10 sec. Your melee and ranged weapon hits deal 6 (+40) extra Fire damage, increased by 15% for each heat stack spent (up to 75% at 5 stacks). Each killing blow adds 2 sec, up to 20 sec in total. Damage increases with Attack Power or Ranged Attack Power, whichever is higher. (90 sec cooldown)',
  },
  kindling_orb: {
    use: 'Use: Summon an ember orb beside you for 12 sec. Each spell you cast at an enemy makes it fire a bolt at that enemy for 12 (+36) Fire damage. Damage increases with Spell Power. (2 min cooldown)',
  },
  molten_fletching: {
    equip:
      'Equip: Your melee and ranged weapon critical hits set the target alight, dealing 4 (+15) Fire damage every 2 sec for 6 sec. A new critical hit refreshes it. Damage increases with Attack Power or Ranged Attack Power, whichever is higher.',
    use: 'Use: For 10 sec, your auto-attacks, shots and physical abilities (not bleeds) also strike the enemy nearest your target within 8 yd for 40% of the damage dealt. (90 sec cooldown)',
  },
  last_flame_lantern: {
    use: 'Use: Set a lantern at your feet for 12 sec. A direct heal from anyone on you or a party member within 12 yd of it also heals the most wounded other party member in its light for 25% of the heal. (2 min cooldown)',
  },
  heart_of_the_crucible: {
    equip:
      'Equip: Each attack you parry, dodge or block adds a heat stack, up to 10. Heat lasts 30 sec, refreshed whenever you gain a stack.',
    use: 'Use: Spend all heat stacks on a fire nova that deals 8 (+25) Fire damage per stack (330 at 10 stacks) to each enemy within 10 yd and taunts every creature it hits. Damage increases with Attack Power. Requires a heat stack. (1 min cooldown)',
  },
};

function wearing(itemId: string, seed = 11): Sim {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(20);
  sim.addItem(itemId, 1);
  sim.equipItem(itemId);
  // Skip the 30 sec on-equip lockout: these tests exercise the use itself.
  sim.player.cooldowns.delete(`trinket:${itemId}`);
  expect(sim.equipment.trinket).toBe(itemId);
  sim.drainEvents();
  return sim;
}

const aura = (e: Entity, id: string) => e.auras.find((a) => a.id === id);

afterEach(() => setLanguage('en'));

/** The amount a scaled tooltip number stands for: "12 (+18)" reads 30. */
function shownTotal(text: string, before: string, after: string): number {
  const start = text.indexOf(before);
  const end = start < 0 ? -1 : text.indexOf(after, start + before.length);
  const m =
    end < 0 ? null : /^([\d,]+)(?: \(\+([\d,]+)\))?$/.exec(text.slice(start + before.length, end));
  if (!m) throw new Error(`no scaled number in: ${text}`);
  const num = (v: string | undefined) => Number((v ?? '0').replace(/,/g, ''));
  return num(m[1]) + num(m[2]);
}

describe('trinket tooltip lines', () => {
  it('covers exactly the eighteen trinkets', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(Object.keys(TRINKET_ITEMS).sort());
    expect(Object.keys(TRINKET_SPECS).sort()).toEqual(Object.keys(TRINKET_ITEMS).sort());
  });

  it.each(Object.keys(TRINKET_ITEMS))('%s renders its exact Equip and Use lines', (id) => {
    const lines = trinketTooltipLineTexts(id, VIEWER);
    const expected = EXPECTED[id];
    const passive = TRINKET_SPECS[id].passive;
    // An Equip line exactly when the trinket has a passive, always before the Use line.
    expect(lines.map((l) => l.kind)).toEqual(passive ? ['equip', 'use'] : ['use']);
    expect(expected.equip !== undefined).toBe(passive !== undefined);
    if (expected.equip) expect(lines[0].text).toBe(expected.equip);
    expect(lines[lines.length - 1].text).toBe(expected.use);
  });

  it('renders the lines as green tooltip rows, and nothing for a non-trinket', () => {
    const html = trinketTooltipLines(TRINKET_ITEMS.stormjar, VIEWER);
    expect(html.match(/<div class="tt-green">/g)).toHaveLength(2);
    const plain = Object.values(ITEMS).find((item) => item.kind === 'potion');
    expect(plain).toBeDefined();
    if (plain) expect(trinketTooltipLines(plain, VIEWER)).toBe('');
    expect(trinketTooltipLineTexts('not_an_item', VIEWER)).toEqual([]);
  });

  it('moves every power-scaled number with the viewer power, as combat resolves it', () => {
    const low = { ...VIEWER, attackPower: 100, spellPower: 100, healPower: 100 };
    const high = { ...VIEWER, attackPower: 900, spellPower: 700, healPower: 800 };
    const use = (id: string, v: TrinketTooltipViewer) =>
      trinketTooltipLineTexts(id, v).at(-1)?.text;
    // Wellspring: 18 + 12% of Healing Power per tick.
    expect(use('wellspring_seed', low)).toContain(' for 18 (+12) every 2 sec');
    expect(use('wellspring_seed', high)).toContain(' for 18 (+96) every 2 sec');
    // Talon Wound: 4 + 3% of Attack Power per stack per tick.
    expect(use('paired_talons', low)).toContain('deals 4 (+3) Physical damage per stack');
    expect(use('paired_talons', high)).toContain('deals 4 (+27) Physical damage per stack');
    // Hunter's Tally: 10 + 8% of Attack Power per mark, rounded once over the marks.
    expect(use('hunters_tally', low)).toContain(
      'for 10 (+8) Physical damage per mark (180 at 10 marks)',
    );
    expect(use('hunters_tally', high)).toContain(
      'for 10 (+72) Physical damage per mark (820 at 10 marks)',
    );
    // Stormjar: 8 + 7% of Spell Power per charge.
    expect(use('stormjar', low)).toContain(
      'takes 8 (+7) Nature damage per charge (150 at 10 charges)',
    );
    expect(use('stormjar', high)).toContain(
      'takes 8 (+49) Nature damage per charge (570 at 10 charges)',
    );
    // A fractional per-mark amount keeps one decimal; the total rounds like combat.
    const odd = { ...VIEWER, attackPower: 123 };
    expect(use('hunters_tally', odd)).toContain(
      'for 10 (+9.8) Physical damage per mark (198 at 10 marks)',
    );
    // Max-health amounts follow the viewer's own maximum health.
    const bigger = { ...VIEWER, maxHp: 8000 };
    expect(trinketTooltipLineTexts('bastion_sigil', bigger)[0].text).toContain(
      `absorbs ${n(1200)} damage`,
    );
    expect(use('gamblers_die', bigger)).toContain(`absorbs ${n(1600)} damage`);
  });

  it('moves the raid trinket numbers with the power combat reads', () => {
    const low = { ...VIEWER, attackPower: 100, spellPower: 100 };
    const high = { ...VIEWER, attackPower: 900, spellPower: 700 };
    const use = (id: string, v: TrinketTooltipViewer) =>
      trinketTooltipLineTexts(id, v).at(-1)?.text;
    const equip = (id: string, v: TrinketTooltipViewer) => trinketTooltipLineTexts(id, v)[0].text;
    // Forgefather's Temper: 6 + 8% of weapon power per hit before heat.
    expect(use('forgefathers_temper', low)).toContain('hits deal 6 (+8) extra Fire damage');
    expect(use('forgefathers_temper', high)).toContain('hits deal 6 (+72) extra Fire damage');
    // Molten Ignite: 4 + 3% of weapon power per tick.
    expect(equip('molten_fletching', low)).toContain('dealing 4 (+3) Fire damage every 2 sec');
    expect(equip('molten_fletching', high)).toContain('dealing 4 (+27) Fire damage every 2 sec');
    // Weapon power is the higher of melee and Ranged Attack Power (a hunter's shots).
    const hunter = { ...low, rangedPower: 900 };
    expect(use('forgefathers_temper', hunter)).toContain('hits deal 6 (+72) extra Fire damage');
    expect(equip('molten_fletching', hunter)).toContain('dealing 4 (+27) Fire damage');
    // Kindling Orb: 12 + 12% of Spell Power per bolt.
    expect(use('kindling_orb', low)).toContain('for 12 (+12) Fire damage');
    expect(use('kindling_orb', high)).toContain('for 12 (+84) Fire damage');
    // Heart of the Crucible: 8 + 5% of melee Attack Power per heat stack (ranged
    // power does not count), rounded once over the stacks.
    expect(use('heart_of_the_crucible', low)).toContain(
      'deals 8 (+5) Fire damage per stack (130 at 10 stacks)',
    );
    expect(use('heart_of_the_crucible', high)).toContain(
      'deals 8 (+45) Fire damage per stack (530 at 10 stacks)',
    );
    expect(use('heart_of_the_crucible', hunter)).toContain('deals 8 (+5) Fire damage per stack');
    expect(use('heart_of_the_crucible', { ...VIEWER, attackPower: 110 })).toContain(
      'deals 8 (+5.5) Fire damage per stack (135 at 10 stacks)',
    );
  });
});

describe('trinket tooltip numbers match combat', () => {
  it('Wellspring Seed heals each tick for the number its tooltip prints', () => {
    for (const healPower of [0, 250]) {
      const sim = wearing('wellspring_seed');
      sim.player.healPower = healPower;
      const text = trinketTooltipLineTexts('wellspring_seed', sim.player).at(-1)?.text ?? '';
      sim.useItem('wellspring_seed');
      const hot = aura(sim.player, TRINKET_AURA.wellspring);
      expect(hot?.kind).toBe('hot');
      expect(shownTotal(text, ' for ', ' every 2 sec')).toBe(hot?.value);
    }
  });

  it("every Gambler's Die fortune applies what the tooltip and the notice promise", () => {
    const seen = new Set<GambleFortune>();
    for (let seed = 1; seed <= 200 && seen.size < GAMBLE_FORTUNES.length; seed++) {
      const sim = wearing('gamblers_die', seed);
      const p = sim.player;
      const text = trinketTooltipLineTexts('gamblers_die', p).at(-1)?.text ?? '';
      sim.useItem('gamblers_die');
      const roll = sim.drainEvents().find((ev) => ev.type === 'trinketGamble') as
        | { type: 'trinketGamble'; fortune: GambleFortune }
        | undefined;
      expect(roll).toBeDefined();
      if (!roll) continue;
      seen.add(roll.fortune);
      const fortune = aura(p, TRINKET_AURA.fortune);
      const cd = p.cooldowns.get(trinketCooldownKey('gamblers_die'));
      if (roll.fortune === 'keenEdge') {
        expect(fortune?.value).toBe(KEEN_EDGE_DAMAGE_BONUS);
        expect(trinketGambleText('keenEdge')).toBe("Gambler's Die: Keen Edge!");
      } else if (roll.fortune === 'luckyHeal') {
        const ticks = Math.floor((fortune?.duration ?? 0) / (fortune?.tickInterval ?? 1));
        const total = (fortune?.value ?? 0) * ticks;
        expect(total).toBe(luckyStreakTotal(fortune?.duration ?? -1, p.maxHp));
        expect(text).toContain(`Lucky Streak (heal ${n(total)} over the duration)`);
        expect(trinketGambleText('luckyHeal')).toBe("Gambler's Die: Lucky Streak!");
      } else if (roll.fortune === 'gildedGuard') {
        expect(text).toContain(`a shield that absorbs ${n(fortune?.value ?? -1)} damage`);
        expect(trinketGambleText('gildedGuard')).toBe("Gambler's Die: Gilded Guard!");
      } else {
        expect(fortune).toBeUndefined();
        expect(cd).toBe(TRINKET_SPECS.gamblers_die.cooldown / 2);
        expect(trinketGambleText('snakeEyes')).toBe("Gambler's Die: Snake Eyes!");
      }
      if (roll.fortune !== 'snakeEyes') expect(cd).toBe(TRINKET_SPECS.gamblers_die.cooldown);
    }
    expect([...seen].sort()).toEqual([...GAMBLE_FORTUNES].sort());
  });

  it('Bastion Sigil raises a Last Bastion shield worth the absorb its Equip line prints', () => {
    const sim = wearing('bastion_sigil');
    const p = sim.player;
    const text = trinketTooltipLineTexts('bastion_sigil', p)[0].text;
    const mob = createMob(sim.nextId++, MOBS.forest_wolf, 20, { ...p.pos, z: p.pos.z + 3 });
    mob.hostile = true;
    sim.addEntity(mob);
    p.hp = Math.floor(p.maxHp * 0.2);
    // Any landed damage below the threshold raises the shield.
    sim.ctx.dealDamage(mob, p, 1, false, 'physical', 'Bite', 'hit');
    const shield = aura(p, TRINKET_AURA.lastStand);
    expect(shield?.kind).toBe('absorb');
    expect(text).toContain(`absorbs ${n(shield?.value ?? -1)} damage`);
  });
});

describe('raid trinket numbers match combat', () => {
  it('Molten Fletching ignites a crit target for the tick its Equip line prints', () => {
    for (const attackPower of [100, 600]) {
      const sim = wearing('molten_fletching');
      const p = sim.player;
      p.attackPower = attackPower;
      p.rangedPower = 0;
      const text = trinketTooltipLineTexts('molten_fletching', p)[0].text;
      const mob = createMob(sim.nextId++, MOBS.forest_wolf, 20, { ...p.pos, z: p.pos.z + 3 });
      mob.hostile = true;
      sim.addEntity(mob);
      sim.ctx.applySetProcs(p, mob, 'weaponCrit');
      const ignite = aura(mob, TRINKET_AURA.ignite);
      expect(ignite?.kind).toBe('dot');
      expect(ignite?.tickInterval).toBe(2);
      expect(shownTotal(text, 'dealing ', ' Fire damage every 2 sec')).toBe(ignite?.value);
      expect(text).toContain(`for ${n(ignite?.duration ?? -1)} sec`);
    }
  });

  it('Heart of the Crucible refuses with no heat, in the words the refusal key holds', () => {
    const sim = wearing('heart_of_the_crucible');
    sim.useItem('heart_of_the_crucible');
    const errors = sim
      .drainEvents()
      .filter((ev) => ev.type === 'error')
      .map((ev) => (ev as { text: string }).text);
    expect(errors).toContain(tSim('error.trinketNoHeat'));
  });
});

describe('trinket aura names and refusals localize', () => {
  it('names every aura and damage label the trinkets apply', () => {
    for (const name of [
      'Retaliation Ward',
      'Moored',
      "Mender's Hourglass",
      'Wellspring',
      'Paired Talons',
      'Talon Wound',
      "Hunter's Tally",
      'Stormjar',
      'Echoing Lens',
      'Keen Edge',
      'Lucky Streak',
      'Gilded Guard',
      'Sundered Prism',
      "Wayfarer's Stride",
      "Duelist's Brand",
      'Last Bastion',
      'Retaliation',
      'Bastion Sigil',
      'Tempered',
      'Forge Heat',
      "Forgefather's Temper",
      'Kindling Orb',
      'Molten Ignite',
      'Molten Fletching',
      'Last Flame Lantern',
      'Crucible Heat',
      'Heart of the Crucible',
    ]) {
      expect(localizeSimAuraName(name), name).toBe(name);
    }
  });

  it('re-localizes the auras, the item-named auras and the refusals in Spanish', async () => {
    await ensureLocaleLoaded('es');
    setLanguage('es');
    expect(localizeSimAuraName('Talon Wound')).toBe('Herida de garra');
    expect(localizeSimAuraName('Stormjar')).toBe('Jarra de tormenta');
    expect(localizeSimText('The hourglass is empty.')).toBe('El reloj de arena está vacío.');
    expect(localizeSimText('That item is not ready yet.')).toBe(tSim('error.trinketNotReady'));
    expect(trinketGambleText('snakeEyes')).toBe('Dado del apostador: ¡Ojos de serpiente!');
    expect(localizeSimAuraName('Crucible Heat')).toBe('Calor del crisol');
    expect(localizeSimAuraName('Kindling Orb')).toBe('Orbe de brasas');
    expect(localizeSimText('Your heart holds no heat.')).toBe('Tu corazón no guarda calor.');
    expect(trinketTooltipLineTexts('sundered_prism', VIEWER)[0].text).toBe(
      'Uso: Avanza 12 m y luego recibe un 30% menos de daño durante 3 s. (reutilización de 90 s)',
    );
  });
});
