// The trinket auras' icons and hover tooltips (src/ui/trinket_aura_art.ts,
// src/ui/trinket_aura_effect.ts): every aura a trinket applies paints its
// trinket's own item icon on every aura surface, and its tooltip explains what
// it does with live numbers. The English text is pinned literally per aura,
// rendered exactly the way the HUD renders an aura effect line; the combat
// proofs drive a real Sim and compare the applied aura (or the damage it leads
// to) with the number the tooltip prints for that same character.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { onTrinketAvoidance, runTrinketTrigger } from '../src/sim/combat/trinkets';
import {
  TRINKET_ANCHOR_SLOW_AURA,
  TRINKET_AURA,
  TRINKET_AURA_ITEM,
  TRINKET_ITEMS,
} from '../src/sim/content/trinkets';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity, SimEvent } from '../src/sim/types';
import {
  type AuraEffectInput,
  auraEffectDescriptor,
  auraEffectMaximumFractionDigits,
} from '../src/ui/aura_effect';
import { resolveHudAuraIconId, resolveHudAuraIconUrl } from '../src/ui/aura_icon_runtime';
import { resolveAuraIconId } from '../src/ui/aura_icon_view';
import {
  ensureLocaleLoaded,
  formatNumber,
  setLanguage,
  type TranslationKey,
  t,
} from '../src/ui/i18n';
import {
  auraImageUrl,
  hasAbilityIconIdentity,
  hasAuraImageIdentity,
  hasAuraRecipe,
  itemImageUrl,
} from '../src/ui/icons';
import { TRINKET_AURA_IMAGE_URLS } from '../src/ui/trinket_aura_art';
import {
  isTrinketAuraId,
  type TrinketAuraViewer,
  trinketAuraEffectDescriptor,
} from '../src/ui/trinket_aura_effect';
import { trinketEquipLockoutText, trinketTooltipLines } from '../src/ui/trinket_tooltip_view';

afterEach(() => setLanguage('en'));

const ALL_TRINKET_AURAS = [...Object.values(TRINKET_AURA), TRINKET_ANCHOR_SLOW_AURA];

type TooltipAura = AuraEffectInput & { id: string; sourceId?: number };

/** The aura effect line exactly as Hud.auraEffectTooltipHtml renders it. */
function render(a: TooltipAura, viewer?: TrinketAuraViewer): string {
  const effect = auraEffectDescriptor(a, viewer);
  if (!effect) return '';
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(effect.nums ?? {})) {
    values[k] = formatNumber(v, { maximumFractionDigits: auraEffectMaximumFractionDigits(v) });
  }
  return t(effect.key as TranslationKey, values);
}

const VIEWER: TrinketAuraViewer = { id: 7, attackPower: 500, rangedPower: 0, spellPower: 300 };
const OTHER = 99;

const own = (a: Omit<TooltipAura, 'sourceId'>): TooltipAura => ({ ...a, sourceId: VIEWER.id });
const foreign = (a: Omit<TooltipAura, 'sourceId'>): TooltipAura => ({ ...a, sourceId: OTHER });

describe('trinket aura icons', () => {
  it('maps every trinket aura, and nothing else, to the trinket that applies it', () => {
    expect(Object.keys(TRINKET_AURA_ITEM).sort()).toEqual([...ALL_TRINKET_AURAS].sort());
    expect(TRINKET_AURA_ITEM).toEqual({
      trinket_last_stand_icd: 'bastion_sigil',
      trinket_last_stand: 'bastion_sigil',
      trinket_retaliate: 'bastion_sigil',
      trinket_anchor: 'mooring_stone',
      trinket_anchor_guard: 'mooring_stone',
      trinket_anchor_slow: 'mooring_stone',
      trinket_hourglass: 'menders_hourglass',
      trinket_hourglass_shield: 'menders_hourglass',
      trinket_wellspring: 'wellspring_seed',
      trinket_twin_strike_icd: 'paired_talons',
      trinket_bleed_edge: 'paired_talons',
      trinket_paired_talons_bleed: 'paired_talons',
      trinket_tally: 'hunters_tally',
      trinket_storm: 'stormjar',
      trinket_echo: 'echoing_lens',
      trinket_fortune: 'gamblers_die',
      trinket_rift_guard: 'sundered_prism',
      trinket_sprint: 'wayfarers_lodestone',
      trinket_brand: 'duelists_brand',
      trinket_forge_heat: 'forgefathers_temper',
      trinket_temper: 'forgefathers_temper',
      trinket_kindling_orb: 'kindling_orb',
      trinket_molten_ignite: 'molten_fletching',
      trinket_pierce: 'molten_fletching',
      trinket_lantern: 'last_flame_lantern',
      trinket_crucible_heat: 'heart_of_the_crucible',
    });
    // Every trinket with a use or passive aura owns at least one of them; the
    // Medallion of Defiance applies none (it only breaks control).
    const owners = new Set(Object.values(TRINKET_AURA_ITEM));
    expect(Object.keys(TRINKET_ITEMS).filter((id) => !owners.has(id))).toEqual([
      'medallion_of_defiance',
    ]);
  });

  it.each(ALL_TRINKET_AURAS)('%s paints its trinket item icon on every aura surface', (auraId) => {
    const itemId = TRINKET_AURA_ITEM[auraId];
    expect(TRINKET_ITEMS[itemId], itemId).toBeDefined();
    const itemUrl = itemImageUrl(itemId);
    expect(itemUrl).toBe(`/ui/items/${itemId}.webp`);
    expect(existsSync(path.join(process.cwd(), 'public', (itemUrl as string).slice(1)))).toBe(true);
    expect(TRINKET_AURA_IMAGE_URLS.get(auraId)).toBe(itemUrl);
    // The shared resolver answers the aura's own id, whatever its kind...
    for (const kind of ['internal_cd', 'absorb', 'dot', 'hot', 'shield_wall', 'slow'] as const) {
      expect(
        resolveAuraIconId(
          { id: auraId, kind },
          hasAbilityIconIdentity,
          hasAuraRecipe,
          hasAuraImageIdentity,
        ),
      ).toBe(auraId);
    }
    expect(hasAuraImageIdentity(auraId)).toBe(true);
    // ...and that id paints the item WebP (buff bar, target frame, party strips
    // and nameplates all resolve through these two).
    expect(auraImageUrl(auraId)).toBe(itemUrl);
    expect(resolveHudAuraIconId({ id: auraId, kind: 'internal_cd' })).toBe(auraId);
    expect(resolveHudAuraIconUrl(auraId)).toMatch(new RegExp(`^url\\(${itemUrl}\\), url\\(`));
  });
});

describe('trinket aura tooltips (English)', () => {
  it('describes only trinket auras', () => {
    for (const id of ALL_TRINKET_AURAS) expect(isTrinketAuraId(id)).toBe(true);
    expect(isTrinketAuraId('shield_wall')).toBe(false);
    expect(isTrinketAuraId(undefined)).toBe(false);
    expect(
      trinketAuraEffectDescriptor({ id: 'shield_wall', kind: 'shield_wall', value: 0.5 }),
    ).toBeNull();
  });

  const CASES: Array<[string, TooltipAura, string]> = [
    [
      'Bastion Sigil cooldown marker',
      own({ id: TRINKET_AURA.lastStandIcd, kind: 'internal_cd', value: 0 }),
      "Bastion Sigil's Last Bastion shield was used. Falling below 35% health cannot raise it again until this expires.",
    ],
    [
      'Last Bastion',
      own({ id: TRINKET_AURA.lastStand, kind: 'absorb', value: 750 }),
      'Absorbs 750 damage. Bastion Sigil raised it when you took damage below 35% health.',
    ],
    [
      'Retaliation Ward',
      own({ id: TRINKET_AURA.retaliate, kind: 'internal_cd', value: 0.3 }),
      'Enemies that hit you directly take Physical damage equal to 30% of the health that hit took from you. Periodic damage does not trigger it.',
    ],
    ...([TRINKET_AURA.anchor, TRINKET_ANCHOR_SLOW_AURA] as const).map(
      (id): [string, TooltipAura, string] => [
        `Moored (${id})`,
        own({ id, kind: id === TRINKET_AURA.anchor ? 'internal_cd' : 'slow', value: 0.7 }),
        'You take 20% less damage but move at 70% speed. You ignore stuns, roots, slows, fears, polymorphs, silences, blinds, hexes, disarms, incapacitating effects and knockbacks.',
      ],
    ),
    [
      'Moored (guard)',
      own({ id: TRINKET_AURA.anchorGuard, kind: 'shield_wall', value: 0.2 }),
      'You take 20% less damage but move at 70% speed. You ignore stuns, roots, slows, fears, polymorphs, silences, blinds, hexes, disarms, incapacitating effects and knockbacks.',
    ],
    [
      "Mender's Hourglass store",
      own({ id: TRINKET_AURA.hourglass, kind: 'internal_cd', value: 1234 }),
      `Holds ${formatNumber(1234)} healing stored from your overhealing. Use Mender's Hourglass to turn it into a shield on the party member within 40 yd with the lowest health percentage, you included.`,
    ],
    [
      "Mender's Hourglass shield",
      foreign({ id: TRINKET_AURA.hourglassShield, kind: 'absorb', value: 480 }),
      "Absorbs 480 damage. Made from the healing a Mender's Hourglass stored.",
    ],
    [
      'Wellspring',
      foreign({ id: TRINKET_AURA.wellspring, kind: 'hot', value: 66, tickInterval: 2 }),
      'Restores 66 health every 2 sec.',
    ],
    [
      'Paired Talons swing cooldown',
      own({ id: TRINKET_AURA.twinStrikeIcd, kind: 'internal_cd', value: 0 }),
      'Paired Talons just made an extra swing. It cannot make another until this expires.',
    ],
    [
      'Paired Talons edge (own: 4 + 3% of 500 AP = 19 per stack)',
      own({ id: TRINKET_AURA.bleedEdge, kind: 'internal_cd', value: 0 }),
      'Your auto-attack hits apply Talon Wound: 19 Physical damage per stack every 2 sec for 6 sec, stacking up to 5 times.',
    ],
    [
      'Paired Talons edge (another player)',
      foreign({ id: TRINKET_AURA.bleedEdge, kind: 'internal_cd', value: 0 }),
      'Auto-attack hits apply Talon Wound, a Physical bleed that stacks up to 5 times. Damage increases with Attack Power.',
    ],
    [
      'Talon Wound',
      foreign({ id: TRINKET_AURA.bleed, kind: 'dot', value: 57, stacks: 3, tickInterval: 2 }),
      'Deals 57 Physical damage every 2 sec (3/5 stacks). Each new stack adds damage and refreshes the duration.',
    ],
    [
      "Hunter's Tally (own: 3 x (10 + 8% of 500 AP) = 150)",
      own({ id: TRINKET_AURA.tally, kind: 'internal_cd', value: 3, stacks: 3 }),
      "Tally marks: 3/10. Use Hunter's Tally to spend them all on a strike at your target for 150 Physical damage (50 per mark).",
    ],
    [
      "Hunter's Tally (another player)",
      foreign({ id: TRINKET_AURA.tally, kind: 'internal_cd', value: 3, stacks: 3 }),
      "Tally marks: 3/10. Hunter's Tally spends them all on a Physical strike that deals more damage for each mark.",
    ],
    [
      'Stormjar (own: 4 x (8 + 7% of 300 SP) = 116)',
      own({ id: TRINKET_AURA.storm, kind: 'internal_cd', value: 4, stacks: 4 }),
      'Charges: 4/10. Use Stormjar to release them as a bolt that hits your target and up to 3 more enemies within 12 yd of each other for 116 Nature damage each (29 per charge).',
    ],
    [
      'Stormjar (another player)',
      foreign({ id: TRINKET_AURA.storm, kind: 'internal_cd', value: 4, stacks: 4 }),
      'Charges: 4/10. Stormjar releases them as a Nature bolt that hits the target and up to 3 more enemies, dealing more damage for each charge.',
    ],
    [
      'Echoing Lens',
      own({ id: TRINKET_AURA.echo, kind: 'internal_cd', value: 0.3, stacks: 2 }),
      'Your next 2 direct heals or direct non-Physical damage hits repeat for 30% of their amount.',
    ],
    [
      'Keen Edge',
      own({ id: TRINKET_AURA.fortune, kind: 'buff_dmg_done', value: 0.15 }),
      "Gambler's Die fortune: you deal 15% more damage.",
    ],
    [
      'Lucky Streak',
      own({ id: TRINKET_AURA.fortune, kind: 'hot', value: 300, tickInterval: 3 }),
      "Gambler's Die fortune: restores 300 health every 3 sec.",
    ],
    [
      'Gilded Guard',
      own({ id: TRINKET_AURA.fortune, kind: 'absorb', value: 1000 }),
      `Gambler's Die fortune: absorbs ${formatNumber(1000)} damage.`,
    ],
    [
      'Sundered Prism',
      own({ id: TRINKET_AURA.riftGuard, kind: 'shield_wall', value: 0.3 }),
      'You take 30% less damage.',
    ],
    [
      "Wayfarer's Stride",
      own({ id: TRINKET_AURA.sprint, kind: 'buff_speed', value: 1.6 }),
      'Movement speed increased by 60%. Does not stack with other speed increases.',
    ],
    [
      "Duelist's Brand",
      foreign({ id: TRINKET_AURA.brand, kind: 'mortal_wound', value: 0.5 }),
      'Healing received is reduced by 50%.',
    ],
    [
      'Forge Heat',
      own({ id: TRINKET_AURA.heat, kind: 'internal_cd', value: 3, stacks: 3 }),
      "Heat: 3/5. Using Forgefather's Temper spends it all, and its weapon fire deals 45% more damage.",
    ],
    [
      'Tempered (own: (6 + 8% of 500 AP) x 1.45 = 67)',
      own({ id: TRINKET_AURA.temper, kind: 'internal_cd', value: 3 }),
      'Your melee and ranged weapon hits deal 67 extra Fire damage (45% more from the heat spent). Each killing blow adds 2 sec, up to 20 sec in total.',
    ],
    [
      'Tempered (another player)',
      foreign({ id: TRINKET_AURA.temper, kind: 'internal_cd', value: 3 }),
      'Melee and ranged weapon hits deal extra Fire damage, 45% more from the heat spent. Damage increases with Attack Power or Ranged Attack Power, whichever is higher.',
    ],
    [
      'Kindling Orb (own: 12 + 12% of 300 SP = 48)',
      own({ id: TRINKET_AURA.kindlingOrb, kind: 'internal_cd', value: 0 }),
      'Each spell you cast at an enemy makes the orb fire a bolt at that enemy for 48 Fire damage. It holds its fire at a polymorphed, incapacitated or blinded enemy.',
    ],
    [
      'Kindling Orb (another player)',
      foreign({ id: TRINKET_AURA.kindlingOrb, kind: 'internal_cd', value: 0 }),
      'Each spell cast at an enemy makes the orb fire a bolt of Fire damage at that enemy. Damage increases with Spell Power.',
    ],
    [
      'Molten Ignite',
      foreign({ id: TRINKET_AURA.ignite, kind: 'dot', value: 19, tickInterval: 2 }),
      'Deals 19 Fire damage every 2 sec. Another weapon critical hit refreshes it.',
    ],
    [
      'Molten Fletching',
      own({ id: TRINKET_AURA.pierce, kind: 'internal_cd', value: 0.4 }),
      'Your auto-attacks, shots and physical abilities (not bleeds) also strike the enemy nearest your target within 8 yd for 40% of the damage dealt.',
    ],
    [
      'Last Flame Lantern',
      own({ id: TRINKET_AURA.lantern, kind: 'internal_cd', value: 0.25, value2: 10, value3: 20 }),
      'A direct heal from anyone on you or a party member within 12 yd of the lantern also heals the most wounded other party member in its light for 25% of the heal.',
    ],
    [
      'Crucible Heat (own: 4 x (8 + 5% of 500 AP) = 132)',
      own({ id: TRINKET_AURA.guardHeat, kind: 'internal_cd', value: 4, stacks: 4 }),
      'Heat: 4/10. Use Heart of the Crucible to spend it all on a fire nova that deals 132 Fire damage to each enemy within 10 yd and taunts every creature it hits.',
    ],
    [
      'Crucible Heat (another player)',
      foreign({ id: TRINKET_AURA.guardHeat, kind: 'internal_cd', value: 4, stacks: 4 }),
      'Heat: 4/10. Heart of the Crucible spends it all on a fire nova within 10 yd that deals more Fire damage for each stack and taunts every creature it hits.',
    ],
  ];

  it('covers every trinket aura id', () => {
    expect(new Set(CASES.map(([, a]) => a.id))).toEqual(new Set(ALL_TRINKET_AURAS));
  });

  it.each(CASES)('%s', (_label, a, expected) => {
    expect(render(a, VIEWER)).toBe(expected);
  });

  it('reads another player aura number-free even without a viewer', () => {
    const tally = own({ id: TRINKET_AURA.tally, kind: 'internal_cd', value: 3, stacks: 3 });
    expect(render(tally)).toBe(
      "Tally marks: 3/10. Hunter's Tally spends them all on a Physical strike that deals more damage for each mark.",
    );
  });

  it('takes precedence over the generic kind lines', () => {
    const shield = { id: TRINKET_AURA.hourglassShield, kind: 'absorb', value: 480 } as const;
    expect(render(shield)).not.toBe(render({ ...shield, id: 'some_other_absorb' }));
  });

  it('localizes through the catalog (a non-English locale renders its own words)', async () => {
    await ensureLocaleLoaded('es');
    setLanguage('es');
    expect(render(own({ id: TRINKET_AURA.heat, kind: 'internal_cd', value: 3, stacks: 3 }))).toBe(
      'Calor: 3/5. Usar el Temple del Padre de la Forja lo gasta todo, y su fuego de arma inflige un 45% más de daño.',
    );
  });
});

describe('trinket item tooltip: on-equip lockout note', () => {
  it('follows the Use line of every trinket, and only trinkets', () => {
    const note =
      'Equipping it starts a 30 sec cooldown on its use, or the cooldown left on the trinket it replaces if that is longer.';
    for (const id of Object.keys(TRINKET_ITEMS)) expect(trinketEquipLockoutText(id)).toBe(note);
    expect(trinketEquipLockoutText('not_an_item')).toBeNull();
    const viewer = { attackPower: 0, rangedPower: 0, spellPower: 0, healPower: 0, maxHp: 1000 };
    const html = trinketTooltipLines(TRINKET_ITEMS.stormjar, viewer);
    expect(html.endsWith(`<div class="tt-sub">${note}</div>`)).toBe(true);
    expect(html.indexOf('Use: ')).toBeLessThan(html.indexOf('Equipping it starts'));
  });
});

// ---- combat proofs ------------------------------------------------------------

function wearing(itemId: string, seed = 11): Sim {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(20);
  sim.addItem(itemId, 1);
  sim.equipItem(itemId);
  // Skip the on-equip lockout: these proofs exercise the use itself.
  sim.player.cooldowns.delete(`trinket:${itemId}`);
  expect(sim.equipment.trinket).toBe(itemId);
  sim.drainEvents();
  return sim;
}

function hostileWolf(sim: Sim): Entity {
  const p = sim.player;
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 20, { ...p.pos, z: p.pos.z + 3 });
  mob.hostile = true;
  mob.maxHp = 1_000_000;
  mob.hp = mob.maxHp;
  sim.addEntity(mob);
  return mob;
}

const findAura = (e: Entity, id: string): Aura | undefined => e.auras.find((a) => a.id === id);

function damageBy(events: SimEvent[], ability: string, target: Entity): number[] {
  const out: number[] = [];
  for (const ev of events) {
    if (ev.type === 'damage' && ev.ability === ability && ev.targetId === target.id) {
      out.push(ev.amount);
    }
  }
  return out;
}

/** The first whole number after `before` in the tooltip text. */
function shown(text: string, before: string): number {
  const at = text.indexOf(before);
  const m = at < 0 ? null : /^[\d,]+/.exec(text.slice(at + before.length));
  if (!m) throw new Error(`no number after "${before}" in: ${text}`);
  return Number(m[0].replace(/,/g, ''));
}

describe('trinket aura tooltip numbers match combat', () => {
  it('Tempered prints the Fire damage its next weapon hit deals', () => {
    for (const attackPower of [0, 600]) {
      const sim = wearing('forgefathers_temper');
      const p = sim.player;
      p.attackPower = attackPower;
      p.rangedPower = 0;
      const mob = hostileWolf(sim);
      for (let i = 0; i < 3; i++) runTrinketTrigger(sim.ctx, p, mob, 'weaponHit');
      const heat = findAura(p, TRINKET_AURA.heat);
      expect(heat?.stacks).toBe(3);
      expect(render(heat as TooltipAura, p)).toContain('its weapon fire deals 45% more damage');
      sim.useItem('forgefathers_temper');
      const temper = findAura(p, TRINKET_AURA.temper);
      expect(temper?.value).toBe(3);
      const text = render(temper as TooltipAura, p);
      sim.drainEvents();
      runTrinketTrigger(sim.ctx, p, mob, 'weaponHit');
      const dealt = damageBy(sim.drainEvents(), "Forgefather's Temper", mob);
      expect(dealt).toHaveLength(1);
      expect(shown(text, 'weapon hits deal ')).toBe(dealt[0]);
    }
  });

  it('Kindling Orb prints the bolt a spell cast looses', () => {
    for (const spellPower of [0, 400]) {
      const sim = wearing('kindling_orb');
      const p = sim.player;
      p.spellPower = spellPower;
      const mob = hostileWolf(sim);
      sim.useItem('kindling_orb');
      const orb = findAura(p, TRINKET_AURA.kindlingOrb);
      const text = render(orb as TooltipAura, p);
      sim.drainEvents();
      sim.ctx.applySetProcs(p, mob, 'spellCast');
      const dealt = damageBy(sim.drainEvents(), 'Kindling Orb', mob);
      expect(dealt).toHaveLength(1);
      expect(shown(text, 'bolt at that enemy for ')).toBe(dealt[0]);
    }
  });

  it('Crucible Heat prints the nova the Heart spends it on', () => {
    for (const attackPower of [0, 500]) {
      const sim = wearing('heart_of_the_crucible');
      const p = sim.player;
      p.attackPower = attackPower;
      const mob = hostileWolf(sim);
      for (let i = 0; i < 4; i++) onTrinketAvoidance(sim.ctx, p);
      const heat = findAura(p, TRINKET_AURA.guardHeat);
      expect(heat?.stacks).toBe(4);
      const text = render(heat as TooltipAura, p);
      sim.drainEvents();
      sim.useItem('heart_of_the_crucible');
      const dealt = damageBy(sim.drainEvents(), 'Heart of the Crucible', mob);
      expect(mob.dead).toBe(false);
      expect(dealt).toHaveLength(1);
      expect(shown(text, 'fire nova that deals ')).toBe(dealt[0]);
    }
  });

  it('Stormjar charges print the bolt the jar releases', () => {
    for (const spellPower of [0, 300]) {
      const sim = wearing('stormjar');
      const p = sim.player;
      p.spellPower = spellPower;
      const mob = hostileWolf(sim);
      for (let i = 0; i < 4; i++) sim.ctx.applySetProcs(p, mob, 'spellCast');
      const storm = findAura(p, TRINKET_AURA.storm);
      expect(storm?.stacks).toBe(4);
      const text = render(storm as TooltipAura, p);
      p.targetId = mob.id;
      sim.drainEvents();
      sim.useItem('stormjar');
      const dealt = damageBy(sim.drainEvents(), 'Stormjar', mob);
      expect(dealt).toHaveLength(1);
      expect(shown(text, 'enemies within 12 yd of each other for ')).toBe(dealt[0]);
    }
  });

  it('Talon Wound prints the tick its bleed deals', () => {
    const sim = wearing('paired_talons');
    const p = sim.player;
    p.attackPower = 400;
    const mob = hostileWolf(sim);
    sim.useItem('paired_talons');
    const edge = findAura(p, TRINKET_AURA.bleedEdge);
    const edgeText = render(edge as TooltipAura, p);
    runTrinketTrigger(sim.ctx, p, mob, 'weaponHit');
    runTrinketTrigger(sim.ctx, p, mob, 'weaponHit');
    const bleed = findAura(mob, TRINKET_AURA.bleed);
    expect(bleed?.stacks).toBe(2);
    expect(shown(edgeText, 'Talon Wound: ') * 2).toBe(bleed?.value);
    expect(render(bleed as TooltipAura, p)).toBe(
      `Deals ${bleed?.value} Physical damage every 2 sec (2/5 stacks). Each new stack adds damage and refreshes the duration.`,
    );
  });
});
