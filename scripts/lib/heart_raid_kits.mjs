// The Smith's Heart raid bots' class kits: each roster spec's talent rows, its
// pre-pull buffs, its damage rotation and (for the two healers) its healing
// priority, written against ONE small context (`c`) so the same rotation runs
// in the live bot raid (scripts/lib/heart_raid_bots.mjs, read from the snapshot)
// and in the headless probe (scripts/heart_raid_kit_probe.ts, read from a Sim).
//
// The rotations follow the class engines as they stand (Hot Streak, Redline,
// Ruin, the Thunder bank, Devotion, Mending Current, Seraphic Vigil...) and the
// reference rotations of the balance probes (scripts/owned_class_balance_probe.ts,
// scripts/rogue_dps_probe.ts, scripts/warlock_balance_probe.ts,
// scripts/hunter_dps_probe.ts). A bot plays a decent, not perfect, rotation.
//
// The ability table (cost, cast time, cooldown, cast-while-moving, off the GCD)
// comes from the sim's own resolution at level 20 with the rows below
// (`abilitiesKnownAt`), never from a hand-written copy.
//
// DEV ONLY tooling: nothing here ships in the game.

import { ABILITIES, abilitiesKnownAt } from '../../src/sim/content/classes';
import { computeTalentModifiers } from '../../src/sim/content/talents';

export const KIT_LEVEL = 20;

/** Talent rows per roster key (the choice rows at 5, 8, 11, 14, 17, 20). */
export const BUILDS = {
  mt: {
    spec: 'prot',
    rows: {
      5: 'war_row_double_charge',
      8: 'war_row_die_by_the_sword',
      11: 'war_row_storm_bolt',
      14: 'war_row_anger_management',
      17: 'war_row_avatar',
      20: 'war_row_colossal_might',
    },
  },
  arms: {
    spec: 'arms',
    rows: {
      5: 'war_row_double_charge',
      8: 'war_row_die_by_the_sword',
      11: 'war_row_storm_bolt',
      14: 'war_row_blood_offering',
      17: 'war_row_avatar',
      20: 'war_row_sanguine_aura',
    },
  },
  ot: {
    spec: 'protection',
    rows: {
      5: 'pal_r5_radiant_stride',
      8: 'pal_r8_enduring_protection',
      11: 'pal_r11_fist_of_justice',
      14: 'pal_r14_zeal',
      17: 'pal_r17_extended_dawn',
      20: 'pal_r20_dawn_echo',
    },
  },
  // Benison (holy priest): the owned-class healer probe's rows.
  h1: {
    spec: 'holy',
    rows: {
      5: 'pri_r5_improved_renew',
      8: 'pri_r17_inner_fire',
      11: 'pri_r11_vampiric_embrace',
      14: 'pri_r11_meditation',
      17: 'pri_r17_choir_of_deliverance',
      20: 'pri_r20_second_verse',
    },
  },
  // Spiritmend (restoration shaman): the owned-class healer probe's rows,
  // Flowing Elements for a Mending Waters on the move after a Jolt.
  h2: {
    spec: 'restoration',
    rows: {
      5: 'sha_r5_imbue_mastery',
      8: 'sha_r8_improved_earth_shock',
      11: 'sha_r11_ancestral_guidance',
      14: 'sha_r14_improved_flame_shock',
      17: 'sha_r17_earthbind',
      20: 'sha_r20_bloodlust',
    },
  },
  // Thuggery (combat rogue): La Luna's fight-6498 build (scripts/rogue_dps_probe.ts).
  rogue: {
    spec: 'combat',
    rows: {
      5: 'rog_r5_killers_pace',
      8: 'rog_r8_borrowed_breath',
      11: 'rog_r11_marked_prey',
      14: 'rog_r14_ceaseless_cuts',
      17: 'rog_r17_flurry_of_knives',
      20: 'rog_r20_second_shadow',
    },
  },
  mage: {
    spec: 'fire',
    rows: {
      5: 'mag_r5_ice_floes',
      8: 'mag_r8_warded',
      11: 'mag_r11_twin_nova',
      14: 'mag_r14_power_echo',
      17: 'mag_r17_mass_barrier',
      20: 'mag_r20_evocation',
    },
  },
  // Coldsight (marksmanship hunter): no pet, Lonely Soul's 10 percent.
  hunter: {
    spec: 'marksmanship',
    rows: {
      5: 'hun_r5_predators_pace',
      8: 'hun_r8_beastguard',
      11: 'hun_r11_double_hush',
      14: 'hun_r14_efficient_rhythm',
      17: 'hun_r17_apex_instinct',
      20: 'hun_r20_overdraw',
    },
  },
  lock: {
    spec: 'destruction',
    rows: {
      5: 'wlk_r5_bane',
      8: 'wlk_r8_voidfeast',
      11: 'wlk_r11_fel_concentration',
      14: 'wlk_r14_shadow_mastery',
      17: 'wlk_r17_improved_fear',
      20: 'wlk_r20_chaos_bolt',
    },
  },
  // Thundercall (elemental shaman): the owned-class probe's rows.
  ele: {
    spec: 'elemental',
    rows: {
      5: 'sha_r5_imbue_mastery',
      8: 'sha_r8_frost_bind',
      11: 'sha_r11_ancestral_guidance',
      14: 'sha_r14_improved_flame_shock',
      17: 'sha_r17_earthbind',
      20: 'sha_r20_elemental_fury',
    },
  },
};

/** The kit a roster entry resolves to at level 20 with its rows: id ->
 *  { cost, castTime, cooldown, moving, offGcd, range, channel, maxCharges }. */
export function kitTable(cls, key) {
  const build = BUILDS[key];
  const mods = computeTalentModifiers(cls, build, KIT_LEVEL);
  const out = new Map();
  for (const k of abilitiesKnownAt(cls, KIT_LEVEL, mods)) {
    const d = k.def;
    out.set(d.id, {
      cost: k.cost,
      castTime: k.castTime,
      cooldown: k.cooldown,
      moving: !!(k.castWhileMoving || d.castWhileMoving),
      offGcd: !!d.offGcd,
      range: d.range ?? 0,
      channel: d.channel?.duration ?? 0,
      maxCharges: d.maxCharges ?? 1,
    });
  }
  return out;
}

/** An ability's cast time from the static table (0 when unknown). */
export function castTimeOf(table, id) {
  return table.get(id)?.castTime ?? ABILITIES[id]?.castTime ?? 0;
}

/** Self buffs and imbues each spec puts up before the pull, in order
 *  ({ id, target: 'self' | 'each' }: 'each' casts it on every raid member). */
export const PREPULL = {
  mt: ['defensive_stance', 'battle_shout'],
  arms: ['battle_stance', 'battle_shout'],
  ot: ['righteous_fury', 'devotion_ward'],
  h1: ['power_word_fortitude*'],
  h2: ['lifespring_weapon', 'lightning_shield'],
  rogue: ['instant_poison'],
  mage: ['arcane_intellect'],
  hunter: ['aspect_of_the_hawk'],
  lock: ['summon_imp', 'demon_skin'],
  ele: ['flametongue_weapon', 'lightning_shield'],
};

// ---- damage rotations ------------------------------------------------------------------
//
// c.ready(id, opts?) is true when the ability is known, off cooldown, paid for,
// its cast fits the time the bot may stand still (unless it casts on the move
// or `opts.instant`), and the GCD allows it. Each rotation returns an id or null.

const pick = (c, list) => {
  for (const row of list) {
    const [id, ok, opts] = row;
    if (ok && c.ready(id, opts)) return id;
  }
  return null;
};

/** The slow or control each spec puts on an add a boss module wants slowed
 *  (`c.slow`: the Heat's Wellspawn walk slower when hit by any), first in its
 *  priority while the add wears none. */
export const SLOWS = {
  prot: ['hamstring'],
  arms: ['hamstring'],
  protection: ['hammer_of_justice'],
  marksmanship: ['concussive_shot'],
  elemental: ['frost_shock'],
  destruction: ['fear'],
  fire: ['frostbolt'],
};

/** The spec's rotation with its slow first when `c.slow` asks for one. */
export function rotate(spec, c) {
  if (c.slow) {
    for (const id of SLOWS[spec] ?? []) if (c.ready(id)) return id;
  }
  return ROTATIONS[spec]?.(c) ?? null;
}

export const ROTATIONS = {
  // Protection warrior: threat first, Shieldcrack on cooldown for rage, Quaking
  // Blow and Revenge to hold the adds, Armor Shear as the filler.
  prot: (c) =>
    pick(c, [
      ['bloodrage', c.res < 40 && c.age > 1],
      ['berserker_rage', c.res < 50],
      ['avatar', c.age > 4],
      ['raised_guard', c.hpPct < 0.75 && c.res >= 35],
      ['iron_resolve', c.hpPct < 0.6],
      ['die_by_sword', c.hpPct < 0.35],
      ['shield_slam', c.dist <= 5.5],
      ['execute', c.tPct < 0.2 && c.res >= 40 && c.dist <= 5.5],
      ['thunder_clap', c.dist <= 7 && c.res >= 20],
      ['revenge', c.dist <= 6 && c.res >= 30],
      ['sunder_armor', c.dist <= 5.5 && c.res >= 45],
    ]),
  // Arms warrior: Maiming Strike and Redhand on cooldown, Brute Swing as the
  // free rage builder, Early Grave below 20 percent, the cooldowns on pull.
  arms: (c) =>
    pick(c, [
      ['bloodrage', c.res < 50 && c.age > 1],
      ['berserker_rage', c.res < 60],
      ['avatar', c.age > 2],
      ['sanguine_aura', c.age > 2],
      ['recklessness', c.age > 2],
      ['breachmaker', c.dist <= 5.5],
      ['execute', c.tPct < 0.2 && c.dist <= 5.5],
      ['mortal_strike', c.dist <= 5.5],
      ['overpower', c.dist <= 5.5],
      ['slam', c.dist <= 5.5],
      ['cleave', c.res >= 70 && c.dist <= 5.5],
    ]),
  // Protection paladin (Faithwarden): Hallowed Wall on cooldown, Ascension on
  // a full Devotion, every Devotion builder on cooldown.
  protection: (c) =>
    pick(c, [
      ['holy_shield', true],
      ['avenging_wrath', c.age > 3],
      ['divine_ascension', c.devotion >= 20],
      ['divine_protection', c.hpPct < 0.45],
      ['bastion_rite', c.dist <= 6 && c.hpPct < 0.85],
      ['vowkeeper_strike', c.dist <= 5.5],
      ['bastion_sweep', c.dist <= 6],
      ['sunward_disc', c.manaPct > 0.15],
      ['hammer_of_grace', c.dist <= 19],
      ['consecration', c.dist <= 6 && c.manaPct > 0.3],
    ]),
  // Thuggery (combat rogue): the Redline spender rhythm of scripts/rogue_dps_probe.ts.
  combat: (c) => {
    if (c.dist > 5.5) return null;
    const redline = c.aura('redline');
    const opener = pick(c, [
      ['adrenaline_rush', c.age > 1],
      ['flurry_of_knives', true],
      ['blade_flurry', c.age > 1],
    ]);
    if (opener) return opener;
    if (redline) {
      const pips = redline.stacks ?? 1;
      const closing = redline.rem < 1.6;
      if (c.combo >= 5 && (pips >= 4 || closing)) return pick(c, [['eviscerate', true]]);
      if (c.combo >= 4 && closing) return pick(c, [['eviscerate', true]]);
      return pick(c, [['sinister_strike', true]]);
    }
    if (!c.aura('slice_and_dice') && c.combo >= 2) return pick(c, [['slice_and_dice', true]]);
    if (c.combo >= 5) return c.res >= 70 ? pick(c, [['eviscerate', true]]) : null;
    return pick(c, [['sinister_strike', true]]);
  },
  // Fire mage: Phoenix Trance and Cinderfall (a guaranteed crit) feed Hot
  // Streak; a Hot Streak's free instant Pyrelance first; Power Echo on
  // cooldown repeats the next big hit; Scald on the move or in the execute; Cinderbolt filler.
  fire: (c) => {
    const streak = c.aura('hot_streak') || c.aura('hot_streak_instant');
    return pick(c, [
      ['combustion', c.age > 4],
      ['pyroblast', !!streak, { instant: true }],
      ['power_echo', c.age > 4 && !streak],
      ['fire_blast', !!c.aura('heating_up') || c.aura('combustion')],
      ['meteor', !c.moving && c.age > 2],
      ['evocation', c.manaPct < 0.15 && !c.moving],
      ['scorch', c.tPct < 0.3 || c.moving || c.stillFor < 3.3],
      ['fireball', c.manaPct > 0.05],
      ['scorch', true],
    ]);
  },
  // Coldsight (marksmanship hunter): the owned-class probe's priority.
  marksmanship: (c) =>
    pick(c, [
      ['cold_focus', c.age > 1],
      ['rapid_fire', true],
      ['aimed_shot', true],
      ['arcane_shot', c.res >= 70 || c.moving],
      ['measured_shot', true],
    ]),
  // Ruination (destruction warlock): scripts/warlock_balance_probe.ts's priority.
  destruction: (c) => {
    const pact = c.tAura('immolate');
    return pick(c, [
      ['summon_infernal', c.age > 2],
      ['immolate', !pact || pact.rem < 3.5],
      ['conflagrate', !!pact],
      ['ruinous_brand', !!pact && pact.rem >= 6],
      ['shadowburn', c.ruin >= 2 && c.tPct < 0.25],
      ['chaos_bolt', c.ruin >= 3],
      // Life Tap spends health: only from a healthy pool (a raid-wide hit can come).
      ['life_tap', c.manaPct < 0.3 && c.hpPct > 0.85],
      ['shadow_bolt', true],
    ]);
  },
  // Thundercall (elemental shaman): the owned-class probe's priority.
  elemental: (c) => {
    const thunder = c.aura('shaman_thunder_charges')?.stacks ?? 0;
    const cinder = c.tAura('flame_shock');
    return pick(c, [
      ['primal_exaltation', c.age > 2],
      ['elemental_mastery', c.age > 2],
      ['thunderstorm', c.manaPct < 0.6],
      ['lava_burst', !!c.aura('shaman_magma_surge'), { instant: true }],
      ['earth_shock', thunder >= 5 && c.dist <= 19],
      ['flame_shock', (!cinder || cinder.rem <= 2) && thunder < 5 && c.dist <= 19],
      ['unleash_weapon', true],
      ['lava_burst', !!cinder],
      ['lightning_bolt', true],
      ['earth_shock', c.moving && thunder >= 2 && c.dist <= 19],
      ['flame_shock', c.moving && c.dist <= 19],
    ]);
  },
};

// ---- healing ---------------------------------------------------------------------------
//
// h.members: the living raid members this healer reaches and sees, each
//   { pid, frac (health fraction), tank, deficit (missing health), auras, near
//     (members within 10 yd of it, for a bounce or a splash) }
// h.ready(id, opts) as c.ready; h.mana (fraction); h.incoming(pid) a heal of ours
// already on its way; h.since(id) seconds since this healer last pressed id.
// Returns { id, target? } or null.

/** A member a heal absorb holds (Living Rime, Stone Shell): healing it
 *  through comes before anything but a dying tank, whatever its health (the
 *  absorb drinks a heal even at full health). The one with the least left
 *  first (the nearest to breaking). */
function crusted(members, h) {
  const held = members
    .map((p) => ({
      p,
      left: p.auras
        .filter((a) => a.kind === 'heal_absorb')
        .reduce((n, a) => n + Math.max(0, a.value ?? 0), 0),
    }))
    .filter((x) => x.left > 0 && !h.incoming(x.p.pid));
  held.sort((x, y) => x.left - y.left || x.p.pid - y.p.pid);
  return held[0]?.p ?? null;
}

const byNeed = (members, h) =>
  [...members].sort((x, y) => need(y, h) - need(x, h) || x.pid - y.pid);
function need(p, h) {
  return 1 - p.frac + (p.tank ? 0.12 : 0) + (p.urgency ?? 0) - (h.incoming(p.pid) ? 0.3 : 0);
}

export const HEALERS = {
  // Benison (holy priest): Seraphic Vigil kept on a tank, the Choir and
  // Choirmend when the raid is hurt together, Urgent Prayer for a spike,
  // Solemn Prayer (the efficient big heal) as the workhorse, Lingering Grace
  // on the tanks between casts, Psalm of Warding on a falling tank.
  holy: (h) => {
    const list = byNeed(h.members, h);
    const low = list[0];
    if (!low) return null;
    const hurt = h.members.filter((p) => p.frac < 0.8).length;
    const hurtBad = h.members.filter((p) => p.frac < 0.6).length;
    const tanks = list.filter((p) => p.tank);
    const vigilOn = h.members.some((p) => p.auras.some((a) => a.id === 'seraphic_vigil' && a.mine));
    const unvigiled = tanks.find((p) => !p.auras.some((a) => a.id === 'seraphic_vigil'));
    if (!vigilOn && unvigiled && h.ready('seraphic_vigil'))
      return { id: 'seraphic_vigil', target: unvigiled.pid };
    // A heal absorb on someone (Living Rime): break it now, the fast heal.
    const crust = crusted(h.members, h);
    if (crust && !(low.tank && low.frac < 0.3)) {
      if (h.ready('flash_heal')) return { id: 'flash_heal', target: crust.pid };
      if (h.ready('heal')) return { id: 'heal', target: crust.pid };
      // On the move: a Renew's ticks drink at the crust too.
      if (!crust.auras.some((a) => a.id === 'renew' && a.mine) && h.ready('renew'))
        return { id: 'renew', target: crust.pid };
    }
    if (hurtBad >= 4 && h.ready('choir_of_deliverance')) return { id: 'choir_of_deliverance' };
    // A raid-wide hit is coming: the group heal at two short, then the big
    // heal on anyone not full.
    if (h.topUp) {
      const short = h.members.filter((p) => p.frac < 0.95).length;
      if (short >= 2 && h.ready('prayer_of_healing')) return { id: 'prayer_of_healing' };
      if (low.frac < 0.95 && h.ready('heal')) return { id: 'heal', target: low.pid };
      if (low.frac < 0.95 && h.ready('flash_heal')) return { id: 'flash_heal', target: low.pid };
    }
    if (
      low.frac < 0.35 &&
      low.tank &&
      !low.auras.some((a) => a.id === 'power_word_shield') &&
      h.ready('power_word_shield')
    )
      return { id: 'power_word_shield', target: low.pid };
    if (low.frac < 0.4 && h.ready('flash_heal')) return { id: 'flash_heal', target: low.pid };
    // Choirmend heals the whole group: the raid-wide damage's answer.
    if (hurt >= 3 && h.ready('prayer_of_healing')) return { id: 'prayer_of_healing' };
    // On the move a human healer rolls Lingering Grace on the hurt (instant,
    // efficient); Sunburst Canticle (90 mana for ~55 a body) only when many
    // are hurt together.
    if (h.moving) {
      const roll = list.find(
        (p) => p.frac < 0.85 && !p.auras.some((a) => a.id === 'renew' && a.mine),
      );
      if (roll && h.ready('renew')) return { id: 'renew', target: roll.pid };
      if (hurt >= 4 && low.near >= 2 && h.mana > 0.4 && h.ready('holy_nova'))
        return { id: 'holy_nova' };
    }
    if (h.mana < 0.25 && h.ready('inner_focus')) return { id: 'inner_focus' };
    // Solemn Prayer (the efficient big heal) on anyone short of a big hit;
    // Urgent Prayer only when the cast must be short or the target is falling.
    if (low.frac < 0.55 && h.mana > 0.3 && h.ready('flash_heal') && !h.ready('heal'))
      return { id: 'flash_heal', target: low.pid };
    if (low.frac < 0.75 && h.ready('heal')) return { id: 'heal', target: low.pid };
    if (low.frac < 0.55 && h.ready('flash_heal')) return { id: 'flash_heal', target: low.pid };
    const renewTank = tanks.find(
      (p) => p.frac < 0.95 && !p.auras.some((a) => a.id === 'renew' && a.mine),
    );
    if (renewTank && h.mana > 0.3 && h.ready('renew'))
      return { id: 'renew', target: renewTank.pid };
    const renewAny = list.find(
      (p) => p.frac < 0.85 && !p.auras.some((a) => a.id === 'renew' && a.mine),
    );
    if (renewAny && h.mana > 0.45 && h.ready('renew')) return { id: 'renew', target: renewAny.pid };
    if (low.frac < 0.88 && h.mana > 0.35 && h.ready('heal')) return { id: 'heal', target: low.pid };
    return null;
  },
  // Spiritmend (restoration shaman): Primal Exaltation on cooldown, Stoneward
  // on the tank, Cascading Mend for a hurt cluster (it spends the Mending
  // Current the heals bank), Tidecall instant for a spike or on the move,
  // Mending Waters (cheap and strong) as the workhorse.
  restoration: (h) => {
    const list = byNeed(h.members, h);
    const low = list[0];
    if (!low) return null;
    const hurt = h.members.filter((p) => p.frac < 0.8);
    const tanks = list.filter((p) => p.tank);
    if (hurt.length >= 2 && h.ready('primal_exaltation')) return { id: 'primal_exaltation' };
    // One Stoneward per shaman (a new one moves it): on the main tank, renewed
    // when it lapses (60 s).
    const mainTank = tanks.find((p) => p.mainTank) ?? tanks[0];
    if (mainTank && h.since('stoneward') > 58 && h.ready('stoneward'))
      return { id: 'stoneward', target: mainTank.pid };
    // A heal absorb on someone (Living Rime): break it now, instant first.
    const crust = crusted(h.members, h);
    if (crust && !(low.tank && low.frac < 0.3)) {
      if (h.ready('tidecall')) return { id: 'tidecall', target: crust.pid };
      if (h.ready('healing_wave')) return { id: 'healing_wave', target: crust.pid };
    }
    if (low.frac < 0.45 && h.ready('tidecall')) return { id: 'tidecall', target: low.pid };
    // A raid-wide hit is coming: Cascading Mend over the hurt, then top-ups.
    if (h.topUp && low.frac < 0.97) {
      const short = h.members.filter((p) => p.frac < 0.95).length;
      if (short >= 2 && h.ready('chain_heal')) return { id: 'chain_heal', target: low.pid };
      if (h.ready('healing_wave')) return { id: 'healing_wave', target: low.pid };
    }
    const cluster = list.find((p) => p.frac < 0.8 && p.near >= 2);
    if (hurt.length >= 3 && cluster && h.ready('chain_heal'))
      return { id: 'chain_heal', target: cluster.pid };
    if (h.moving && low.frac < 0.8 && h.ready('tidecall'))
      return { id: 'tidecall', target: low.pid };
    // Mending Waters is cheap (39 mana): kept rolling on anyone short of 92 percent.
    if (low.frac < 0.92 && h.ready('healing_wave')) return { id: 'healing_wave', target: low.pid };
    if (hurt.length >= 2 && cluster && h.ready('chain_heal'))
      return { id: 'chain_heal', target: cluster.pid };
    if (low.frac < 0.92 && h.ready('tidecall')) return { id: 'tidecall', target: low.pid };
    return null;
  },
};
