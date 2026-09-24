import type { AbilityVfxFullSpec, AbilityVfxSpec } from './ability_vfx_core';

// Trinket on-use and proc identities. The sim (src/sim/combat/trinkets.ts)
// stamps every trinket cue with one of these display ids; they are not class
// abilities, so they live in this item-owned module and resolve through
// ability_vfx_registry.ts, never in the generated gallery tables.
//
// Every read here is composed from the pooled ability-VFX primitives (shells,
// rings, ribbons, overlay sprites, pillars, decals, the impact sheets), whose
// materials are all built in the AbilityVfxFx constructor and staged by the
// `vfx.ability-primitives` boot manifest entry. So this module mints no
// material and needs no prewarm home of its own: it is pure data.
//
// Tiers shed richness only. What a player acts on from a trinket (the ward,
// shield, brand and speed auras themselves) reads from the aura frames; the
// areas a trinket covers (the Wellspring Seed, Heart of the Crucible and Last
// Flame Lantern radii) are the draped telegraph ring the painter draws on
// every tier from the event's own radius, and the lantern's standing light
// circle is trinket_relics.ts's, also on every tier.

interface TrinketVfx {
  spec: AbilityVfxSpec;
  full: AbilityVfxFullSpec;
}

const TRINKET_VFX: Readonly<Record<string, TrinketVfx>> = {
  // Bastion Sigil on-use: a retaliation ward goes up. Steel plates snap into a
  // guarding arc and the gold-rimmed shell seals over the wearer.
  trinket_bastion_sigil: {
    spec: { c: '#c7ccd6', p: 'physical', pw: 0.9, sp: 12, vr: 1, li: 0.9, lg: 2, a: 'buff' },
    full: {
      archetype: 'buff',
      palette: 'physical',
      power: 0.9,
      barrier: true,
      buff: { style: 'raise', orbit: 'none', shellDur: 2 },
      motifs: ['barrier'],
      motifAt: 'caster',
      windupStyle: 'none',
      linger: 2,
      rim: '#e8c460',
      accent: '#f0c75a',
      impact: {
        flipbook: false,
        ring: false,
        vRing: 1.2,
        sparks: 12,
        debris: false,
        smoke: false,
        light: 0.9,
        liteAudio: true,
      },
    },
  },
  // Bastion Sigil passive: the emergency shield bursts on at low health. The
  // loudest defensive read of the set: a radiant gold shell with a cross flash.
  trinket_last_bastion: {
    spec: { c: '#ffd35c', p: 'holy', pw: 1.15, sp: 20, rg: 0, vr: 1, li: 2, lg: 2.5, a: 'buff' },
    full: {
      archetype: 'buff',
      palette: 'holy',
      power: 1.15,
      barrier: true,
      buff: { style: 'raise', orbit: 'none', shellDur: 2.5 },
      motifs: ['barrier', 'cross'],
      motifAt: 'caster',
      windupStyle: 'none',
      linger: 2.5,
      rim: '#fff0b0',
      accent: '#fff6d8',
      impact: {
        flipbook: true,
        ring: 1.1,
        vRing: true,
        sparks: 20,
        debris: false,
        smoke: false,
        light: 2,
      },
    },
  },
  // Mooring Stone: anchored. Grey-blue chains snap taut from the earth and a
  // cracked anchor ring slams into the ground around the wearer.
  trinket_mooring_stone: {
    spec: {
      c: '#8ea2b8',
      p: 'physical',
      pw: 1.05,
      sp: 14,
      db: 1,
      sm: 1,
      li: 0.8,
      lg: 2,
      a: 'buff',
    },
    full: {
      archetype: 'buff',
      palette: 'physical',
      power: 1.05,
      buff: { style: 'raise', orbit: 'none', shellDur: 1.4 },
      motifs: ['chains'],
      motifAt: 'caster',
      motifR: 1.4,
      windupStyle: 'none',
      decal: 'crack',
      linger: 2,
      rim: '#9fb4c9',
      accent: '#d4dee9',
      impact: {
        flipbook: false,
        ring: 1.4,
        vRing: false,
        sparks: 14,
        debris: true,
        smoke: true,
        light: 0.8,
      },
    },
  },
  // Mender's Hourglass: the stored healing pours into a shield on the lowest
  // ally. Golden sand streams arc onto the ally, then the shell seals.
  trinket_menders_hourglass: {
    spec: { c: '#e2b458', p: 'gold', pw: 0.95, sp: 10, li: 1.2, lg: 2.5, a: 'heal' },
    full: {
      archetype: 'heal',
      palette: 'gold',
      power: 0.95,
      shaft: 0.45,
      motifs: ['fountain', 'barrier'],
      motifAt: 'caster',
      windupStyle: 'none',
      linger: 2.5,
      rim: '#f4d58a',
      accent: '#fff0bc',
      impact: {
        flipbook: false,
        ring: false,
        vRing: false,
        sparks: 10,
        debris: false,
        smoke: false,
        light: 1.2,
        liteAudio: true,
      },
    },
  },
  // Wellspring Seed: a seed sprouts at the user's feet and a green-blue spring
  // ripples out. The area is the painter's draped ring at the event's radius.
  trinket_wellspring_seed: {
    spec: { c: '#46c6a4', p: 'nature', pw: 0.95, sp: 12, li: 1.1, lg: 3, a: 'heal' },
    full: {
      archetype: 'heal',
      palette: 'nature',
      power: 0.95,
      shaft: 0.5,
      motifs: ['vines', 'fountain'],
      windupStyle: 'none',
      decal: 'rune',
      linger: 3,
      rim: '#7fe0c8',
      accent: '#a6e8ff',
      impact: {
        flipbook: false,
        ring: 1.2,
        vRing: false,
        sparks: 12,
        debris: false,
        smoke: false,
        light: 1.1,
        liteAudio: true,
      },
    },
  },
  // Paired Talons: two blood-red claw slashes flash across the wearer.
  trinket_paired_talons: {
    spec: { c: '#b3182c', p: 'blood', pw: 0.85, sp: 12, bl: 1, li: 0.6, lg: 1.2, a: 'buff' },
    full: {
      archetype: 'buff',
      palette: 'blood',
      power: 0.85,
      buff: { style: 'raise', orbit: 'none' },
      motifs: ['claws', 'crescents'],
      motifAt: 'caster',
      windupStyle: 'none',
      linger: 1.2,
      rim: '#d23a3a',
      accent: '#ff7a64',
      impact: {
        flipbook: false,
        ring: false,
        vRing: false,
        sparks: 12,
        debris: false,
        smoke: false,
        blood: true,
        light: 0.6,
      },
    },
  },
  // Hunter's Tally: the spent marks come down on the target as one heavy
  // marked strike, a column slamming onto the victim sealed by the mark cross.
  // The event carries no mark count, so the notches are not counted out.
  trinket_hunters_tally: {
    spec: {
      c: '#e2692e',
      p: 'physical',
      pw: 1.2,
      sp: 20,
      vr: 1,
      db: 1,
      li: 1,
      lg: 1.2,
      a: 'burst',
    },
    full: {
      archetype: 'burst',
      palette: 'physical',
      power: 1.2,
      burst: { style: 'skybeam' },
      shaft: 0.55,
      motifs: ['cross'],
      motifAt: 'target',
      windupStyle: 'none',
      linger: 1.2,
      rim: '#ffb46a',
      accent: '#ffd9a0',
      impact: {
        flipbook: false,
        ring: false,
        vRing: true,
        sparks: 20,
        debris: true,
        smoke: false,
        light: 1,
        focused: true,
      },
    },
  },
  // Stormjar: the released charge chains enemy to enemy. The sim emits one
  // 'lightning' cue per jump, so each hop draws its own blue-white arc.
  trinket_stormjar: {
    spec: {
      c: '#9fd2ff',
      p: 'storm',
      pw: 1,
      sp: 16,
      li: 1.1,
      lg: 0.8,
      b: { j: 1 },
      a: 'burst',
    },
    full: {
      archetype: 'burst',
      palette: 'storm',
      power: 1,
      burst: { style: 'link' },
      windupStyle: 'none',
      linger: 0.8,
      rim: '#cfe8ff',
      accent: '#ffffff',
      impact: {
        flipbook: false,
        ring: false,
        vRing: false,
        sparks: 16,
        debris: false,
        smoke: false,
        light: 1.1,
        liteAudio: true,
      },
    },
  },
  // Echoing Lens: violet concentric lens rings, flat and upright, around the
  // wearer as the echo arms.
  trinket_echoing_lens: {
    spec: { c: '#a06cff', p: 'arcane', pw: 0.9, sp: 10, vr: 1, li: 1.2, lg: 2, a: 'buff' },
    full: {
      archetype: 'buff',
      palette: 'arcane',
      power: 0.9,
      buff: { style: 'raise', orbit: 'none', shellDur: 1.2 },
      windupStyle: 'none',
      decal: 'rune',
      linger: 2,
      rim: '#c9a6ff',
      accent: '#e4d0ff',
      impact: {
        flipbook: false,
        ring: 1,
        vRing: 1.3,
        sparks: 10,
        debris: false,
        smoke: false,
        light: 1.2,
        liteAudio: true,
      },
    },
  },
  // Gambler's Die: a golden flash as the die spins and lands; three gold orbs
  // circle in and strike one-two-three.
  trinket_gamblers_die: {
    spec: { c: '#f2c64a', p: 'gold', pw: 0.95, sp: 18, li: 1.4, lg: 1.5, a: 'buff' },
    full: {
      archetype: 'buff',
      palette: 'gold',
      power: 0.95,
      buff: { style: 'raise', orbit: 'none' },
      motifs: ['orbitals'],
      motifAt: 'caster',
      windupStyle: 'none',
      linger: 1.5,
      rim: '#ffe08a',
      accent: '#fff4c4',
      impact: {
        flipbook: true,
        ring: false,
        vRing: false,
        sparks: 18,
        debris: false,
        smoke: false,
        light: 1.4,
      },
    },
  },
  // Sundered Prism: the blink. A cracked violet prism implodes and shatters as
  // the wearer steps away; the brief guard it grants rides the shell flash.
  // Read off the 'blinkStep' cue, which the renderer's own arm still owns
  // (see trinketCueReadsAsSelfCast).
  trinket_sundered_prism: {
    spec: { c: '#9458ff', p: 'arcane', pw: 1, sp: 16, vr: 1, db: 1, li: 1.2, lg: 1.2, a: 'buff' },
    full: {
      archetype: 'buff',
      palette: 'arcane',
      power: 1,
      barrier: true,
      buff: { style: 'raise', orbit: 'none', shellDur: 1.5 },
      motifs: ['implosion'],
      motifAt: 'caster',
      windupStyle: 'none',
      decal: 'rune',
      linger: 1.2,
      rim: '#c9a6ff',
      accent: '#ead8ff',
      impact: {
        flipbook: false,
        ring: false,
        vRing: true,
        sparks: 16,
        debris: true,
        smoke: true,
        light: 1.2,
      },
    },
  },
  // Wayfarer's Lodestone: wind lines coil up the wearer and a pale gust rings
  // out at the feet as the speed burst kicks in.
  trinket_wayfarers_lodestone: {
    spec: { c: '#cfe7da', p: 'nature', pw: 0.8, sp: 8, sm: 1, li: 0.6, lg: 1.5, a: 'buff' },
    full: {
      archetype: 'buff',
      palette: 'nature',
      power: 0.8,
      buff: { style: 'raise', orbit: 'none', shellDur: 0.8 },
      motifs: ['vines'],
      motifAt: 'caster',
      windupStyle: 'none',
      linger: 1.5,
      rim: '#e4f3ec',
      accent: '#ffffff',
      impact: {
        flipbook: false,
        ring: 0.9,
        vRing: false,
        sparks: 8,
        debris: false,
        smoke: true,
        light: 0.6,
        liteAudio: true,
      },
    },
  },
  // Medallion of Defiance: the shackles shatter. Bright white-gold chains
  // flash taut, then break apart in a radiant burst.
  trinket_medallion_of_defiance: {
    spec: { c: '#fff0c4', p: 'holy', pw: 1.1, sp: 22, vr: 1, db: 1, li: 2.2, lg: 1.5, a: 'buff' },
    full: {
      archetype: 'buff',
      palette: 'holy',
      power: 1.1,
      buff: { style: 'raise', orbit: 'none', shellDur: 1 },
      motifs: ['chains'],
      motifAt: 'caster',
      windupStyle: 'none',
      linger: 1.5,
      rim: '#fff6dc',
      accent: '#ffffff',
      impact: {
        flipbook: true,
        ring: 1.2,
        vRing: true,
        sparks: 22,
        debris: true,
        smoke: false,
        light: 2.2,
      },
    },
  },
  // Duelist's Brand: an ember-red crossed-swords brand sears onto the enemy
  // player: a hot link from the user, the cross strokes and a scorch mark.
  trinket_duelists_brand: {
    spec: { c: '#e2401e', p: 'fire', pw: 1, sp: 14, li: 1, lg: 2, a: 'burst' },
    full: {
      archetype: 'burst',
      palette: 'fire',
      power: 1,
      burst: { style: 'link' },
      motifs: ['cross'],
      motifAt: 'target',
      windupStyle: 'none',
      decal: 'scorch',
      linger: 2,
      rim: '#ff7a3a',
      accent: '#ffb070',
      impact: {
        flipbook: false,
        ring: false,
        vRing: false,
        sparks: 14,
        debris: false,
        smoke: true,
        light: 1,
        focused: true,
      },
    },
  },
  // ---- The Crucible of the Last Spring raid trinkets ----------------------
  // Their bespoke scene objects (the spectral hammer, the floating Kindling
  // Orb and its bolts, the Last Flame Lantern and its light) are painted by
  // trinket_relics.ts over these ceremonies; the rows below stay pure data.
  //
  // Forgefather's Temper: the forge's heat is spent into the weapon. A
  // white-hot spectral hammer (trinket_relics.ts) comes down in front of the
  // wearer; this row is the strike's fire: a scorch, a flame ring and sparks.
  trinket_forgefathers_temper: {
    spec: {
      c: '#ff6a1e',
      p: 'fire',
      pw: 1.05,
      sp: 22,
      vr: 1,
      db: 1,
      sm: 1,
      li: 1.4,
      lg: 1.5,
      a: 'buff',
    },
    full: {
      archetype: 'buff',
      palette: 'fire',
      power: 1.05,
      buff: { style: 'raise', orbit: 'none', shellDur: 0.9 },
      motifAt: 'caster',
      windupStyle: 'none',
      decal: 'scorch',
      linger: 1.5,
      rim: '#ffb060',
      accent: '#ffd9a0',
      impact: {
        flipbook: true,
        ring: 1.1,
        vRing: true,
        sparks: 22,
        debris: true,
        smoke: true,
        light: 1.4,
      },
    },
  },
  // Kindling Orb: the orb kindles beside the wearer. A molten flare wheels in
  // (the orbitals) and settles at the shoulder, where trinket_relics.ts keeps
  // the Blender-modelled orb floating for the aura's whole life.
  trinket_kindling_orb: {
    spec: { c: '#ff8a2a', p: 'fire', pw: 0.9, sp: 14, li: 1.2, lg: 1.5, a: 'buff' },
    full: {
      archetype: 'buff',
      palette: 'fire',
      power: 0.9,
      buff: { style: 'raise', orbit: 'none', shellDur: 0.8 },
      motifs: ['orbitals'],
      motifAt: 'caster',
      windupStyle: 'none',
      linger: 1.5,
      rim: '#ffb870',
      accent: '#ffe0a8',
      impact: {
        flipbook: false,
        ring: false,
        vRing: 1,
        sparks: 14,
        debris: false,
        smoke: false,
        light: 1.2,
        liteAudio: true,
      },
    },
  },
  // Kindling Orb bolt: a small ember comet at the spell's target. While the
  // wearer's orb is on screen trinket_relics.ts flies it FROM the orb and
  // claims the cue; this row is the fallback read (orb off screen, cold cast
  // gate) and flies it from the wearer.
  trinket_kindling_orb_bolt: {
    spec: { c: '#ff9a3c', p: 'fire', pw: 0.6, sp: 10, b: { v: 26, h: 0.7 }, lg: 0.8, a: 'bolt' },
    full: {
      archetype: 'bolt',
      palette: 'fire',
      power: 0.6,
      filler: true,
      bolt: { speed: 26, headScale: 0.7, coils: false, jagged: false, forkEvery: 0 },
      windupStyle: 'none',
      linger: 0.8,
      impact: {
        flipbook: false,
        ring: false,
        vRing: false,
        sparks: 10,
        debris: false,
        smoke: false,
        light: 0.6,
        liteAudio: true,
      },
    },
  },
  // Molten Fletching: molten sparks spit off the wearer's weapon hand as the
  // piercing edge takes; trinket_relics.ts keeps a thin spark trickle at the
  // hand while the buff lasts.
  trinket_molten_fletching: {
    spec: { c: '#ff5a1a', p: 'fire', pw: 0.85, sp: 18, db: 1, li: 0.8, lg: 1.2, a: 'buff' },
    full: {
      archetype: 'buff',
      palette: 'fire',
      power: 0.85,
      buff: { style: 'raise', orbit: 'none', shellDur: 0.6 },
      motifs: ['crescents'],
      motifAt: 'caster',
      windupStyle: 'none',
      linger: 1.2,
      rim: '#ff9448',
      accent: '#ffc070',
      impact: {
        flipbook: false,
        ring: false,
        vRing: false,
        sparks: 18,
        debris: true,
        smoke: false,
        light: 0.8,
      },
    },
  },
  // Last Flame Lantern: set down at the wearer's feet. A warm golden bloom
  // rises and the painter's draped ring marks the light's exact radius; the
  // lantern and its standing light circle are trinket_relics.ts's, for the
  // aura's whole life, on every tier.
  trinket_last_flame_lantern: {
    spec: { c: '#ffc861', p: 'gold', pw: 0.9, sp: 12, li: 1.3, lg: 2.5, a: 'heal' },
    full: {
      archetype: 'heal',
      palette: 'gold',
      power: 0.9,
      shaft: 0.4,
      motifs: ['fountain'],
      windupStyle: 'none',
      decal: 'rune',
      linger: 2.5,
      rim: '#ffe0a0',
      accent: '#fff2cc',
      impact: {
        flipbook: false,
        ring: 1,
        vRing: false,
        sparks: 12,
        debris: false,
        smoke: false,
        light: 1.3,
        liteAudio: true,
      },
    },
  },
  // Last Flame Lantern splash: the share of a heal leaps from the healed ally
  // to the most wounded one in the light, a small golden flame arc.
  trinket_last_flame_lantern_splash: {
    spec: { c: '#ffd98a', p: 'gold', pw: 0.55, sp: 8, b: { v: 20, h: 0.6 }, lg: 1, a: 'bolt' },
    full: {
      archetype: 'bolt',
      palette: 'gold',
      power: 0.55,
      filler: true,
      bolt: { speed: 20, headScale: 0.6, style: 'wisp', coils: false, jagged: false, forkEvery: 0 },
      windupStyle: 'none',
      linger: 1,
      impact: {
        flipbook: false,
        ring: false,
        vRing: false,
        sparks: 8,
        debris: false,
        smoke: false,
        light: 0.8,
        liteAudio: true,
      },
    },
  },
  // Heart of the Crucible: every stored heat stack bursts out as a fire nova.
  // The painter's draped ring is the sim's exact radius (the event carries
  // it); the nova ring, cracked-earth decal and ember spray are the blast.
  trinket_heart_of_the_crucible: {
    spec: {
      c: '#ff4a12',
      p: 'fire',
      pw: 1.2,
      sp: 30,
      rg: 2.5,
      vr: 1,
      db: 1,
      sm: 1,
      li: 1.6,
      lg: 1.5,
      a: 'nova',
    },
    full: {
      archetype: 'nova',
      palette: 'fire',
      power: 1.2,
      nova: { radius: 10 },
      windupStyle: 'none',
      motifs: ['fissure'],
      motifAt: 'caster',
      decal: 'scorch',
      linger: 1.5,
      rim: '#ff9a4a',
      accent: '#ffd08a',
      impact: {
        flipbook: true,
        ring: 2.5,
        vRing: true,
        sparks: 30,
        debris: true,
        smoke: true,
        light: 1.6,
      },
    },
  },
};

export const TRINKET_VFX_SPECS: Readonly<Record<string, AbilityVfxSpec>> = Object.fromEntries(
  Object.entries(TRINKET_VFX).map(([id, row]) => [id, row.spec]),
);

export const TRINKET_VFX_FULL_SPECS: Readonly<Record<string, AbilityVfxFullSpec>> =
  Object.fromEntries(Object.entries(TRINKET_VFX).map(([id, row]) => [id, row.full]));

/** Trinket cues the sim emits on a kind the ability painter does not claim
 *  ('dotApply' for the targeted Hunter's Tally and Duelist's Brand,
 *  'blinkStep' for the Sundered Prism) read as the selfCast ceremony. The
 *  painter still returns false for 'blinkStep' so the renderer's blink arm
 *  keeps its position snap. */
export function trinketCueReadsAsSelfCast(ability: string, fx: string): boolean {
  return (fx === 'dotApply' || fx === 'blinkStep') && Object.hasOwn(TRINKET_VFX, ability);
}
